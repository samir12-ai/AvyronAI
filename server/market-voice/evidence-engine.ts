import { db } from "../db";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import {
  marketVoiceDiscoveryJobs,
  marketVoiceSearchIntents,
  marketVoiceDiscoveryResults,
  marketVoiceEvidence,
  ciCompetitors,
  type MarketVoiceDiscoveryResult,
  type InsertMarketVoiceEvidence,
} from "@shared/schema";
import {
  type MarketVoicePhase4ExecutionSummary,
  type VerifiedEvidenceItemResult,
  generateMarketVoiceEvidenceId,
} from "@shared/contracts/market-voice";
import { normalizeCanonicalUrl } from "./provider-router";
import { resolveCurrentBusinessUnderstandingOrThrow } from "../business-understanding/resolver";
import { fetchSourceContent } from "./source-fetcher";
import {
  verifyAuthorshipRole,
  verifyCustomerVoiceEligibility,
  verifyBatchAuthorshipRole,
  verifyBatchCustomerVoiceEligibility,
  runFinalEvidenceJudge,
} from "./evidence-verifier";

export interface Phase4ExecutionOptions {
  accountId: string;
  campaignId: string;
  discoveryJobId: string;
  campaignOfferingId?: string;
  concurrencyLimit?: number;
  maxResultsToProcess?: number;
}

/**
 * Orchestrates Market Voice Phase 4:
 * Discovery Result -> Source Fetching -> Authorship Verification -> Customer Voice Eligibility -> Final Judge -> Canonical Evidence Persistence.
 * 
 * Strict Invariants:
 * 1. discoveryJobId is REQUIRED. Fail-closed on missing/invalid job.
 * 2. Consumes persisted discovery results for the exact job only (zero historical cross-job mixing).
 * 3. Search snippets are NEVER treated as evidence.
 * 4. Fetches real destination source content.
 * 5. Only Judge-APPROVED verbatim customer voice persists to market_voice_evidence.
 * 6. General customer voice -> market_voice_evidence (competitorId = NULL).
 * 7. Competitor-owned voice -> routed appropriately; never duplicated.
 * 8. NEVER touches Audience Engine or Strategy Root.
 * 9. 100% idempotent on repeated runs.
 */
export async function executeMarketVoiceEvidencePhase(
  options: Phase4ExecutionOptions
): Promise<MarketVoicePhase4ExecutionSummary> {
  const {
    accountId,
    campaignId,
    discoveryJobId,
    concurrencyLimit = 5,
    maxResultsToProcess = 50,
  } = options;

  // 1. Fail closed if discoveryJobId is missing
  if (!discoveryJobId || typeof discoveryJobId !== "string" || discoveryJobId.trim().length === 0) {
    throw new Error(
      "[MarketVoiceEvidenceEngine] FAIL-CLOSED: MARKET_VOICE_DISCOVERY_JOB_REQUIRED. An explicit discoveryJobId is required to execute Phase 4."
    );
  }

  // 2. Resolve canonical Business Understanding authority
  const bu = await resolveCurrentBusinessUnderstandingOrThrow({
    accountId,
    campaignId,
    campaignOfferingId: options.campaignOfferingId,
  });
  const offeringId = bu.campaignOfferingId;
  const offeringName = bu.payload?.campaignOffering?.offeringName || bu.offeringName || "summer dresses";
  const category = bu.payload?.campaignOffering?.category || "Modest Fashion / Dresses";
  const targetMarket = bu.payload?.targetUnderstanding?.geography || "Lebanon / Middle East";
  const productTruthFacts = (bu.payload?.campaignOffering?.productTruthFacts || []).map((f: any) =>
    typeof f === "string" ? f : f.statement
  );

  // 3. Verify discovery job ownership and valid completed status
  const [job] = await db
    .select()
    .from(marketVoiceDiscoveryJobs)
    .where(and(
      eq(marketVoiceDiscoveryJobs.id, discoveryJobId),
      eq(marketVoiceDiscoveryJobs.accountId, accountId),
      eq(marketVoiceDiscoveryJobs.campaignId, campaignId),
      eq(marketVoiceDiscoveryJobs.campaignOfferingId, offeringId)
    ))
    .limit(1);

  if (!job) {
    throw new Error(
      `[MarketVoiceEvidenceEngine] FAIL-CLOSED: DISCOVERY_JOB_NOT_FOUND_FOR_LINEAGE. Discovery job "${discoveryJobId}" not found for accountId=${accountId}, campaignId=${campaignId}, offeringId=${offeringId}.`
    );
  }

  const validStatuses = ["COMPLETED", "COMPLETED_WITH_GAPS", "COMPLETED_WITH_BUDGET_LIMIT"];
  if (!validStatuses.includes(job.status)) {
    throw new Error(
      `[MarketVoiceEvidenceEngine] FAIL-CLOSED: DISCOVERY_JOB_INVALID_STATUS. Cannot process job "${discoveryJobId}" with status "${job.status}". Expected one of: ${validStatuses.join(", ")}.`
    );
  }

  // 4. Count total discovery results strictly for this exact discoveryJobId
  const [totalRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(marketVoiceDiscoveryResults)
    .where(and(
      eq(marketVoiceDiscoveryResults.accountId, accountId),
      eq(marketVoiceDiscoveryResults.campaignId, campaignId),
      eq(marketVoiceDiscoveryResults.campaignOfferingId, offeringId),
      eq(marketVoiceDiscoveryResults.discoveryJobId, discoveryJobId)
    ));
  const totalDiscoveryResults = totalRes?.count ?? 0;

  if (totalDiscoveryResults === 0) {
    return {
      discoveryJobId,
      totalDiscoveryResults: 0,
      fetchableResults: 0,
      fetchedContentItems: 0,
      customerCandidates: 0,
      judgeApproved: 0,
      rejected: 0,
      insufficient: 0,
      canonicalEvidencePersisted: 0,
      evidenceItems: [],
      rejectionBreakdown: {},
      fetchFailureBreakdown: {},
      batchCount: 0,
      batchSizes: [],
      unprocessedResults: 0,
    };
  }

  // 5. Load active canonical competitors to detect competitor-owned surfaces
  const activeCompetitors = await db
    .select()
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));

  const competitorDomainMap = new Map<string, string>();
  for (const comp of activeCompetitors) {
    const rawUrl = comp.websiteUrl || "";
    try {
      const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      const domain = u.hostname.replace(/^www\./, "").toLowerCase();
      competitorDomainMap.set(domain, comp.id);
    } catch {
      // Ignore invalid URL
    }
  }

  let fetchableResults = 0;
  let fetchedContentItemsCount = 0;
  let customerCandidatesCount = 0;
  let judgeApprovedCount = 0;
  let rejectedCount = 0;
  let insufficientCount = 0;
  let canonicalEvidencePersistedCount = 0;

  const rejectionBreakdown: Record<string, number> = {};
  const fetchFailureBreakdown: Record<string, number> = {};
  const evidenceItems: VerifiedEvidenceItemResult[] = [];

  const processedUrlCache = new Map<
    string,
    { finalStatus: string; matchedCompetitorId: string | null; extractedCount: number }
  >();
  const LLM_PACKED_BATCH_SIZE = 25;

  // Bounded worker pool execution for a chunk of discovery results with cross-URL item packing
  const processChunkOfResults = async (chunk: MarketVoiceDiscoveryResult[]) => {
    interface FetchedResultContext {
      res: MarketVoiceDiscoveryResult;
      isCompetitor: boolean;
      matchedCompetitorId: string | null;
      pageContext: { url: string; title: string; domain?: string; snippet?: string };
      items: Array<{ origItem: any; packedItem: any }>;
    }

    const toFetch: MarketVoiceDiscoveryResult[] = [];
    for (const res of chunk) {
      const canonKey = (res.canonicalUrl || res.url || "").trim().toLowerCase();
      const cachedUrlOutcome = canonKey ? processedUrlCache.get(canonKey) : undefined;
      if (cachedUrlOutcome) {
        await db
          .update(marketVoiceDiscoveryResults)
          .set({
            verificationStatus: cachedUrlOutcome.finalStatus as any,
            verifiedCompetitorId: cachedUrlOutcome.matchedCompetitorId,
            extractedCount: cachedUrlOutcome.extractedCount,
          })
          .where(eq(marketVoiceDiscoveryResults.id, res.id));
        continue;
      }
      toFetch.push(res);
    }

    if (toFetch.length === 0) return;

    const fetchedContexts: FetchedResultContext[] = [];
    await Promise.all(
      toFetch.map(async (res) => {
        try {
          let isCompetitor = false;
          let matchedCompetitorId: string | null = null;
          try {
            const u = new URL(res.canonicalUrl.startsWith("http") ? res.canonicalUrl : `https://${res.canonicalUrl}`);
            const domain = u.hostname.replace(/^www\./, "").toLowerCase();
            if (competitorDomainMap.has(domain)) {
              isCompetitor = true;
              matchedCompetitorId = competitorDomainMap.get(domain)!;
            }
          } catch {
            // Ignore
          }

          const fetchResult = await fetchSourceContent(res);
          if (fetchResult.fetchStatus !== "FETCHED" || fetchResult.contentItems.length === 0) {
            const failReason = fetchResult.fetchStatus;
            fetchFailureBreakdown[failReason] = (fetchFailureBreakdown[failReason] || 0) + 1;
            const canonKey = (res.canonicalUrl || res.url || "").trim().toLowerCase();
            if (canonKey) {
              processedUrlCache.set(canonKey, {
                finalStatus: "NO_CUSTOMER_VOICE",
                matchedCompetitorId,
                extractedCount: 0,
              });
            }
            await db
              .update(marketVoiceDiscoveryResults)
              .set({
                verificationStatus: "NO_CUSTOMER_VOICE",
                extractedCount: 0,
              })
              .where(eq(marketVoiceDiscoveryResults.id, res.id));
            return;
          }

          fetchableResults++;
          fetchedContentItemsCount += fetchResult.contentItems.length;

          const pageTitle = fetchResult.pageTitle || res.title || "";
          const pageContext = {
            url: res.canonicalUrl,
            title: pageTitle,
            domain: res.domain || undefined,
            snippet: res.snippet || undefined,
          };

          const items = fetchResult.contentItems.map((origItem, idx) => {
            const packedItemId = `${res.id}::${origItem.itemId || idx}`;
            return {
              origItem,
              packedItem: {
                ...origItem,
                itemId: packedItemId,
                sourceUrl: origItem.sourceUrl || res.canonicalUrl,
                metadata: {
                  ...(origItem.metadata || {}),
                  pageUrl: res.canonicalUrl,
                  pageTitle,
                  pageSnippet: res.snippet || undefined,
                },
              },
            };
          });

          fetchedContexts.push({
            res,
            isCompetitor,
            matchedCompetitorId,
            pageContext,
            items,
          });
        } catch (err: any) {
          console.warn(`[MarketVoiceEvidenceEngine] Error fetching result ${res.id}:`, err?.message);
          await db
            .update(marketVoiceDiscoveryResults)
            .set({
              verificationStatus: "NO_CUSTOMER_VOICE",
              extractedCount: 0,
            })
            .where(eq(marketVoiceDiscoveryResults.id, res.id));
          fetchFailureBreakdown["FETCH_FAILED"] = (fetchFailureBreakdown["FETCH_FAILED"] || 0) + 1;
        }
      })
    );

    if (fetchedContexts.length === 0) return;

    // Pack all extracted items across fetched URLs in this chunk into batches of up to 25 items
    const allPackedItems = fetchedContexts.flatMap((ctx) => ctx.items.map((x) => x.packedItem));
    const combinedAuthorshipMap = new Map<string, any>();
    const defaultPageCtx = fetchedContexts[0].pageContext;

    for (let i = 0; i < allPackedItems.length; i += LLM_PACKED_BATCH_SIZE) {
      const slice = allPackedItems.slice(i, i + LLM_PACKED_BATCH_SIZE);
      const batchMap = await verifyBatchAuthorshipRole(slice, defaultPageCtx, { accountId });
      for (const [k, v] of batchMap.entries()) {
        combinedAuthorshipMap.set(k, v);
      }
    }

    const allEligibilityCandidates = allPackedItems.map((packedItem) => ({
      item: packedItem,
      authorRole: combinedAuthorshipMap.get(packedItem.itemId)?.authorRole || "UNKNOWN",
    }));
    const combinedEligibilityMap = new Map<string, any>();

    for (let i = 0; i < allEligibilityCandidates.length; i += LLM_PACKED_BATCH_SIZE) {
      const slice = allEligibilityCandidates.slice(i, i + LLM_PACKED_BATCH_SIZE);
      const batchMap = await verifyBatchCustomerVoiceEligibility(
        slice,
        { offeringName, category, targetMarket, productTruthFacts },
        defaultPageCtx,
        { accountId }
      );
      for (const [k, v] of batchMap.entries()) {
        combinedEligibilityMap.set(k, v);
      }
    }

    // Finalize and persist per discovery result
    for (const ctx of fetchedContexts) {
      const { res, isCompetitor, matchedCompetitorId, items } = ctx;
      try {
        let approvedForThisResult = 0;
        for (const { origItem: item, packedItem } of items) {
          customerCandidatesCount++;

          const authorship = combinedAuthorshipMap.get(packedItem.itemId) || {
            authorRole: "UNKNOWN",
            confidence: 0,
            reasoning: "Missing authorship result",
            isCustomerAuthored: false,
          };

          const eligibility = combinedEligibilityMap.get(packedItem.itemId) || {
            eligibility: "NOT_CUSTOMER_VOICE",
            isEligible: false,
            reasoning: "Missing eligibility result",
          };

          const judge = runFinalEvidenceJudge(
            item,
            authorship,
            eligibility,
            { offeringName, category, targetMarket },
            { isCompetitor, competitorId: matchedCompetitorId }
          );

          if (judge.verdict === "APPROVE" && judge.canonicalOwner === "market_voice_evidence") {
            judgeApprovedCount++;
            approvedForThisResult++;

            const evidenceId = generateMarketVoiceEvidenceId(
              res.sourcePlatform,
              item.itemId || res.canonicalUrl,
              item.verbatimText
            );

            const [existing] = await db
              .select()
              .from(marketVoiceEvidence)
              .where(eq(marketVoiceEvidence.id, evidenceId))
              .limit(1);

            if (!existing) {
              await db.insert(marketVoiceEvidence).values({
                id: evidenceId,
                discoveryResultId: res.id,
                searchIntentId: res.searchIntentId,
                discoveryJobId: res.discoveryJobId,
                accountId,
                campaignId,
                campaignOfferingId: offeringId,
                verbatimText: item.verbatimText,
                sourceScope: judge.sourceScope,
                marketScope: judge.marketScope,
                platform: res.sourcePlatform,
                externalUrl: item.sourceUrl || res.url,
                externalId: item.itemId,
                authorHash: item.authorIdentifier ? item.authorIdentifier.slice(0, 16) : null,
                likesCount: item.likesCount || 0,
                publishedAt: item.publishedAt || null,
                geography: judge.geography,
                language: judge.language,
                semanticScope: judge.semanticScope,
                transferability: judge.transferability,
                eligibilityVerdict: judge.primaryEligibilityVerdict,
              });
              canonicalEvidencePersistedCount++;
            }

            evidenceItems.push({
              evidenceId,
              discoveryResultId: res.id,
              searchIntentId: res.searchIntentId,
              discoveryJobId: res.discoveryJobId,
              accountId,
              campaignId,
              campaignOfferingId: offeringId,
              verbatimText: item.verbatimText,
              sourceScope: judge.sourceScope,
              marketScope: judge.marketScope,
              platform: res.sourcePlatform,
              externalUrl: item.sourceUrl || res.url,
              externalId: item.itemId,
              authorHash: item.authorIdentifier ? item.authorIdentifier.slice(0, 16) : null,
              likesCount: item.likesCount || 0,
              publishedAt: item.publishedAt || null,
              geography: judge.geography,
              language: judge.language,
              judgeVerdict: "APPROVE",
              judgeReason: judge.finalReason,
              persisted: true,
            });
          } else {
            if (judge.verdict === "INSUFFICIENT_EVIDENCE") {
              insufficientCount++;
            } else {
              rejectedCount++;
            }

            const reason = judge.rejectionReason || "REJECTED";
            rejectionBreakdown[reason] = (rejectionBreakdown[reason] || 0) + 1;
          }
        }

        const finalStatus = isCompetitor
          ? "VERIFIED_COMPETITOR"
          : approvedForThisResult > 0
          ? "VERIFIED_CUSTOMER_SOURCE"
          : "NO_CUSTOMER_VOICE";

        const canonKey = (res.canonicalUrl || res.url || "").trim().toLowerCase();
        if (canonKey) {
          processedUrlCache.set(canonKey, {
            finalStatus,
            matchedCompetitorId,
            extractedCount: approvedForThisResult,
          });
        }

        await db
          .update(marketVoiceDiscoveryResults)
          .set({
            verificationStatus: finalStatus,
            verifiedCompetitorId: matchedCompetitorId,
            extractedCount: approvedForThisResult,
          })
          .where(eq(marketVoiceDiscoveryResults.id, res.id));
      } catch (err: any) {
        console.warn(`[MarketVoiceEvidenceEngine] Error finalizing result ${res.id}:`, err?.message);
        await db
          .update(marketVoiceDiscoveryResults)
          .set({
            verificationStatus: "NO_CUSTOMER_VOICE",
            extractedCount: 0,
          })
          .where(eq(marketVoiceDiscoveryResults.id, res.id));
      }
    }
  };

  // 6. Sequential bounded batch processing until 100% of discovered results are terminal
  const batchSize = Math.max(1, Math.min(maxResultsToProcess || 50, 100));
  let batchCount = 0;
  const batchSizes: number[] = [];
  const MAX_BATCHES = 50; // Safety guard: up to 2500-5000 results per job

  while (batchCount < MAX_BATCHES) {
    const batch = await db
      .select()
      .from(marketVoiceDiscoveryResults)
      .where(and(
        eq(marketVoiceDiscoveryResults.accountId, accountId),
        eq(marketVoiceDiscoveryResults.campaignId, campaignId),
        eq(marketVoiceDiscoveryResults.campaignOfferingId, offeringId),
        eq(marketVoiceDiscoveryResults.discoveryJobId, discoveryJobId),
        eq(marketVoiceDiscoveryResults.verificationStatus, "DISCOVERED")
      ))
      .orderBy(asc(marketVoiceDiscoveryResults.createdAt), asc(marketVoiceDiscoveryResults.id))
      .limit(batchSize);

    if (batch.length === 0) {
      break;
    }

    batchCount++;
    batchSizes.push(batch.length);

    // Run in chunks with bounded concurrency and cross-URL item packing
    for (let i = 0; i < batch.length; i += concurrencyLimit) {
      const chunk = batch.slice(i, i + concurrencyLimit);
      await processChunkOfResults(chunk);
    }
  }

  // 7. Verify zero unprocessed rows remain
  const [unprocessedRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(marketVoiceDiscoveryResults)
    .where(and(
      eq(marketVoiceDiscoveryResults.accountId, accountId),
      eq(marketVoiceDiscoveryResults.campaignId, campaignId),
      eq(marketVoiceDiscoveryResults.campaignOfferingId, offeringId),
      eq(marketVoiceDiscoveryResults.discoveryJobId, discoveryJobId),
      eq(marketVoiceDiscoveryResults.verificationStatus, "DISCOVERED")
    ));
  const unprocessedResults = unprocessedRes?.count ?? 0;

  return {
    discoveryJobId,
    totalDiscoveryResults,
    fetchableResults,
    fetchedContentItems: fetchedContentItemsCount,
    customerCandidates: customerCandidatesCount,
    judgeApproved: judgeApprovedCount,
    rejected: rejectedCount,
    insufficient: insufficientCount,
    canonicalEvidencePersisted: canonicalEvidencePersistedCount,
    evidenceItems,
    rejectionBreakdown,
    fetchFailureBreakdown,
    batchCount,
    batchSizes,
    unprocessedResults,
  };
}
