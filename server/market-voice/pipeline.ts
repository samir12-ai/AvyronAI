import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { marketVoiceEvidence, marketVoiceDiscoveryJobs, marketVoiceDiscoveryResults, type EvidenceManifest } from "@shared/schema";
import { loadMarketVoicePlannerContext, planMarketVoiceSearchIntents } from "./search-planner";
import { executeMarketVoiceDiscoveryJob } from "./discovery-engine";
import { executeMarketVoiceEvidencePhase } from "./evidence-engine";
import { resolveCurrentBusinessUnderstandingOrThrow } from "../business-understanding/resolver";
import { evaluateCombinedEvidenceReadiness } from "../shared/combined-readiness";

export interface RunMarketVoicePipelineOptions {
  accountId: string;
  campaignId: string;
  campaignOfferingId?: string;
  forceRefresh?: boolean;
  jobId?: string;
  evidenceManifest?: EvidenceManifest | null;
}

export interface MarketVoiceSubPhaseTimings {
  contextPlanningMs: number;
  searchDiscoveryMs: number;
  evidenceFetchAndVerifyMs: number;
  totalMs: number;
}

export interface DiscoverySourceDiversityReport {
  isLowDiversity: boolean;
  totalUrls: number;
  customerVoiceUrlCount: number;
  customerVoiceDomainCount: number;
  commercialUrlCount: number;
  customerVoiceRatio: number;
  commercialRatio: number;
  customerVoiceDomains: string[];
  summary: string;
}

/**
 * Evaluates the quality and diversity of discovered customer voice sources.
 * Detects low customer voice yield, commercial over-concentration, or single-source dependency.
 */
export function assessDiscoverySourceDiversity(
  results: Array<{ url: string; sourcePlatform?: string | null; discoveredType?: string | null }>
): DiscoverySourceDiversityReport {
  const uniqueUrls = new Set<string>();
  const customerVoiceUrls = new Set<string>();
  const customerVoiceDomains = new Set<string>();
  let commercialUrlCount = 0;

  for (const r of results) {
    const urlStr = r.url?.trim();
    if (!urlStr) continue;
    uniqueUrls.add(urlStr);

    let hostname = "";
    try {
      hostname = new URL(urlStr).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      hostname = urlStr.split("/")[0].toLowerCase();
    }

    const isReddit = hostname.includes("reddit.com") || r.sourcePlatform === "reddit";
    const isForumOrCommunity = 
      r.discoveredType === "FORUM_THREAD" || 
      r.sourcePlatform === "web_community" ||
      /forum|community|boards?|discuss|threads?|topic|quora\.com/i.test(urlStr);
    const isReviewSite = /review|reviews|trustpilot|yelp|tripadvisor|influenster|consumeraffairs/i.test(urlStr);

    const isCustomerVoice = isReddit || isForumOrCommunity || isReviewSite;

    if (isCustomerVoice) {
      customerVoiceUrls.add(urlStr);
      customerVoiceDomains.add(hostname);
    } else {
      const isCommercial = 
        /shop|store|product|item|collection|collections|category|categories|buy|cart|checkout|dp\/|p\//i.test(urlStr) ||
        /amazon\.|ebay\.|walmart\.|asos\.|target\.|etsy\.|aliexpress\.|modanisa\.|nordstrom\.|shein\.|zara\.|hm\./i.test(hostname) ||
        hostname.startsWith("shop.") || hostname.startsWith("store.");
      if (isCommercial) {
        commercialUrlCount++;
      }
    }
  }

  const totalUrls = uniqueUrls.size;
  const customerVoiceUrlCount = customerVoiceUrls.size;
  const customerVoiceDomainCount = customerVoiceDomains.size;
  const customerVoiceRatio = totalUrls > 0 ? customerVoiceUrlCount / totalUrls : 0;
  const commercialRatio = totalUrls > 0 ? commercialUrlCount / totalUrls : 0;

  let isLowDiversity = false;
  let summary = "";

  if (totalUrls >= 5) {
    if (customerVoiceUrlCount < 3 || customerVoiceDomainCount <= 1 || customerVoiceRatio < 0.20) {
      isLowDiversity = true;
      summary = `Commercial-heavy discovery yield: high commercial/editorial URL concentration (${commercialUrlCount}/${totalUrls}) with limited customer discussion sources (only ${customerVoiceUrlCount} customer voice sources across ${customerVoiceDomainCount} domain(s)).`;
    } else {
      summary = `Healthy source diversity: ${customerVoiceUrlCount} customer discussion sources across ${customerVoiceDomainCount} domains (${(customerVoiceRatio * 100).toFixed(1)}% customer voice yield).`;
    }
  } else if (totalUrls > 0 && customerVoiceUrlCount === 0) {
    isLowDiversity = true;
    summary = `Zero customer voice sources discovered (${totalUrls} total URLs).`;
  } else {
    summary = `Discovery yield: ${totalUrls} URLs with ${customerVoiceUrlCount} customer voice sources.`;
  }

  return {
    isLowDiversity,
    totalUrls,
    customerVoiceUrlCount,
    customerVoiceDomainCount,
    commercialUrlCount,
    customerVoiceRatio,
    commercialRatio,
    customerVoiceDomains: Array.from(customerVoiceDomains),
    summary,
  };
}

export interface MarketVoiceAcquisitionResult {
  discoveryJobId?: string;
  intentsPlanned: number;
  resultsFetched: number;
  evidenceUnitsPersisted: number;
  approvedEvidenceIds: string[];
  evidenceItems: any[];
  subPhaseTimings: MarketVoiceSubPhaseTimings;
  diversityReport?: DiscoverySourceDiversityReport;
}

export interface MarketVoicePipelineResult {
  status: "COMPLETE" | "REUSED" | "INCOMPLETE";
  discoveryJobId?: string;
  intentsPlanned: number;
  resultsFetched: number;
  evidenceUnitsPersisted: number;
  approvedEvidenceIds: string[];
  evidenceUnits?: any[];
  subPhaseTimings?: MarketVoiceSubPhaseTimings;
  statusMessage?: string;
  diversityReport?: DiscoverySourceDiversityReport;
}

/**
 * Pre-freeze acquisition: plans search intents, runs discovery, evaluates diversity,
 * fetches source content, verifies authorship, audits with Hostile Evidence Judge,
 * and persists verified quotes to marketVoiceEvidence.
 */
export async function executeMarketVoiceAcquisition(
  options: RunMarketVoicePipelineOptions
): Promise<MarketVoiceAcquisitionResult> {
  const { accountId, campaignId, campaignOfferingId, forceRefresh = false, jobId } = options;
  const pipelineStartedAt = Date.now();

  console.log(`[MarketVoiceAcquisition] Starting acquisition for account=${accountId}, campaign=${campaignId}, jobId=${jobId || "none"}`);

  const bu = await resolveCurrentBusinessUnderstandingOrThrow({
    accountId,
    campaignId,
    campaignOfferingId,
  });
  const offeringId = bu.campaignOfferingId;

  let contextPlanningMs = 0;
  const tPlanningStart = Date.now();
  let activeDiscoveryJobId = "";
  let activeIntentsPlanned = 0;
  let discoverySummary: any = { totalResultsDiscovered: 0, status: "NO_RESULTS" as any };
  let searchDiscoveryMs = 0;
  let plannerContext: any = null;

  try {
    plannerContext = await loadMarketVoicePlannerContext({
      accountId,
      campaignId,
      campaignOfferingId: offeringId,
    });

    const planResult = await planMarketVoiceSearchIntents(plannerContext);
    activeDiscoveryJobId = planResult.job.id;
    activeIntentsPlanned = planResult.intents.length;
    contextPlanningMs += (Date.now() - tPlanningStart);
    console.log(`[MarketVoiceAcquisition] Search intents planned: ${activeIntentsPlanned} in ${contextPlanningMs}ms (jobId=${activeDiscoveryJobId})`);

    const tDiscoveryStart = Date.now();
    console.log(`[MarketVoiceAcquisition] Executing discovery searches for jobId=${activeDiscoveryJobId}...`);
    discoverySummary = await executeMarketVoiceDiscoveryJob(activeDiscoveryJobId);
    searchDiscoveryMs += (Date.now() - tDiscoveryStart);
    console.log(`[MarketVoiceAcquisition] Discovery completed: ${discoverySummary.totalResultsDiscovered} occurrences discovered in ${searchDiscoveryMs}ms (status=${discoverySummary.status})`);
  } catch (discoveryErr: any) {
    console.error(`[MarketVoiceAcquisition] DISCOVERY_PHASE_FAILED | ${discoveryErr?.message || discoveryErr}`);
    return {
      discoveryJobId: activeDiscoveryJobId || undefined,
      intentsPlanned: activeIntentsPlanned,
      resultsFetched: 0,
      evidenceUnitsPersisted: 0,
      approvedEvidenceIds: [],
      evidenceItems: [],
      subPhaseTimings: {
        contextPlanningMs,
        searchDiscoveryMs,
        evidenceFetchAndVerifyMs: 0,
        totalMs: Date.now() - pipelineStartedAt,
      },
    };
  }

  // Source-Diversity Guard & Bounded 1-Retry Planner Repair
  const discoveredRows = await db
    .select({
      url: marketVoiceDiscoveryResults.url,
      sourcePlatform: marketVoiceDiscoveryResults.sourcePlatform,
      discoveredType: marketVoiceDiscoveryResults.discoveredType,
    })
    .from(marketVoiceDiscoveryResults)
    .where(eq(marketVoiceDiscoveryResults.discoveryJobId, activeDiscoveryJobId));

  let diversityReport = assessDiscoverySourceDiversity(discoveredRows);
  console.log(`[MarketVoiceAcquisition] Source diversity assessment: isLowDiversity=${diversityReport.isLowDiversity} (${diversityReport.summary})`);

  if (diversityReport.isLowDiversity) {
    console.log(`[MarketVoiceAcquisition] LOW_DIVERSITY detected. Triggering bounded search-planner repair cycle...`);
    const repairPrompt = `CRITICAL DISCOVERY SOURCE-DIVERSITY REPAIR: Previous discovery yielded high commercial store / catalog concentration (${diversityReport.commercialUrlCount}/${diversityReport.totalUrls} URLs) and insufficient customer discussion sources (${diversityReport.customerVoiceUrlCount} sources across ${diversityReport.customerVoiceDomainCount} domain(s)). Replan search intents with higher source-role diversity, prioritizing authentic customer discussion forums (WEB_FORUMS, REDDIT), user experiences, pre-purchase questions, and reviews using natural source-shaping keywords without pre-judging customer sentiment.`;

    const tRepairPlanStart = Date.now();
    try {
      const repairPlanResult = await planMarketVoiceSearchIntents(plannerContext, {
        repairInstructions: repairPrompt,
      });
      const repairJobId = repairPlanResult.job.id;
      activeIntentsPlanned += repairPlanResult.intents.length;
      const repairPlanMs = Date.now() - tRepairPlanStart;
      contextPlanningMs += repairPlanMs;
      console.log(`[MarketVoiceAcquisition] Repaired search intents planned: ${repairPlanResult.intents.length} in ${repairPlanMs}ms (jobId=${repairJobId})`);

      const tRepairDiscoveryStart = Date.now();
      const repairDiscoverySummary = await executeMarketVoiceDiscoveryJob(repairJobId);
      const repairDiscoveryMs = Date.now() - tRepairDiscoveryStart;
      searchDiscoveryMs += repairDiscoveryMs;
      console.log(`[MarketVoiceAcquisition] Repaired discovery completed: ${repairDiscoverySummary.totalResultsDiscovered} occurrences discovered in ${repairDiscoveryMs}ms`);

      if (repairDiscoverySummary.totalResultsDiscovered > 0) {
        activeDiscoveryJobId = repairJobId;
        discoverySummary = repairDiscoverySummary;

        const repairedDiscoveredRows = await db
          .select({
            url: marketVoiceDiscoveryResults.url,
            sourcePlatform: marketVoiceDiscoveryResults.sourcePlatform,
            discoveredType: marketVoiceDiscoveryResults.discoveredType,
          })
          .from(marketVoiceDiscoveryResults)
          .where(eq(marketVoiceDiscoveryResults.discoveryJobId, activeDiscoveryJobId));

        diversityReport = assessDiscoverySourceDiversity(repairedDiscoveredRows);
        console.log(`[MarketVoiceAcquisition] Post-repair source diversity: isLowDiversity=${diversityReport.isLowDiversity} (${diversityReport.summary})`);
      }
    } catch (repairErr: any) {
      console.warn(`[MarketVoiceAcquisition] Discovery repair attempt encountered error: ${repairErr?.message || repairErr}`);
    }
  }

  // Phase 4: Evidence Fetching, Verification, Judging, and Persistence
  const tEvidenceStart = Date.now();
  console.log(`[MarketVoiceAcquisition] Processing evidence quotes for jobId=${activeDiscoveryJobId}...`);
  let evidenceSummary: any = { canonicalEvidencePersisted: 0, evidenceItems: [] };
  try {
    evidenceSummary = await executeMarketVoiceEvidencePhase({
      accountId,
      campaignId,
      discoveryJobId: activeDiscoveryJobId,
      campaignOfferingId: offeringId,
      concurrencyLimit: 10,
    });
  } catch (evErr: any) {
    console.error(`[MarketVoiceAcquisition] EVIDENCE_PHASE_FAILED | ${evErr?.message || evErr}`);
  }
  const evidenceFetchAndVerifyMs = Date.now() - tEvidenceStart;
  const totalMs = Date.now() - pipelineStartedAt;

  console.log(`[MarketVoiceAcquisition] Evidence phase completed: ${evidenceSummary.canonicalEvidencePersisted} customer quotes persisted in ${evidenceFetchAndVerifyMs}ms`);

  const approvedEvidenceIds = (evidenceSummary.evidenceItems || [])
    .filter((e: any) => e.persisted)
    .map((e: any) => e.evidenceId);

  return {
    discoveryJobId: activeDiscoveryJobId,
    intentsPlanned: activeIntentsPlanned,
    resultsFetched: discoverySummary.totalOccurrencesDiscovered,
    evidenceUnitsPersisted: evidenceSummary.canonicalEvidencePersisted,
    approvedEvidenceIds,
    evidenceItems: evidenceSummary.evidenceItems || [],
    subPhaseTimings: {
      contextPlanningMs,
      searchDiscoveryMs,
      evidenceFetchAndVerifyMs,
      totalMs,
    },
    diversityReport,
  };
}

/**
 * Post-freeze analysis: consumes manifest-bound customer evidence, evaluates
 * combined customer evidence readiness across comments, reviews, and quotes.
 * CONTRACT: If !combinedReadiness.isSufficient, returns status: "INCOMPLETE".
 */
export async function executeMarketVoiceAnalysis(
  options: RunMarketVoicePipelineOptions & {
    acquisitionSummary?: Partial<MarketVoiceAcquisitionResult>;
  }
): Promise<MarketVoicePipelineResult> {
  const { accountId, campaignId, campaignOfferingId, forceRefresh = false, evidenceManifest, acquisitionSummary } = options;
  const pipelineStartedAt = Date.now();

  const bu = await resolveCurrentBusinessUnderstandingOrThrow({
    accountId,
    campaignId,
    campaignOfferingId,
  });
  const offeringId = bu.campaignOfferingId;

  // Determine approved Market Voice evidence IDs strictly from manifest if available
  let approvedEvidenceIds: string[] = [];
  if (evidenceManifest?.includedMarketVoiceIds && Array.isArray(evidenceManifest.includedMarketVoiceIds)) {
    approvedEvidenceIds = evidenceManifest.includedMarketVoiceIds as string[];
  } else if (acquisitionSummary?.approvedEvidenceIds) {
    approvedEvidenceIds = acquisitionSummary.approvedEvidenceIds;
  }

  // Evaluate combined customer evidence readiness with manifest constraint
  const combinedReadiness = await evaluateCombinedEvidenceReadiness({
    accountId,
    campaignId,
    campaignOfferingId: offeringId,
    approvedMarketVoiceEvidenceIds: approvedEvidenceIds.length > 0 ? approvedEvidenceIds : undefined,
    evidenceManifest,
    forceRefresh,
  });

  const subPhaseTimings: MarketVoiceSubPhaseTimings = acquisitionSummary?.subPhaseTimings || {
    contextPlanningMs: 0,
    searchDiscoveryMs: 0,
    evidenceFetchAndVerifyMs: 0,
    totalMs: Date.now() - pipelineStartedAt,
  };

  // CONTRACT FIX: If combined readiness is NOT sufficient, ALWAYS return INCOMPLETE
  if (!combinedReadiness.isSufficient) {
    const statusMessage = `PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient (${combinedReadiness.reason}).`;
    console.warn(`[MarketVoiceAnalysis] ${statusMessage}`);
    return {
      status: "INCOMPLETE",
      discoveryJobId: acquisitionSummary?.discoveryJobId,
      intentsPlanned: acquisitionSummary?.intentsPlanned || 0,
      resultsFetched: acquisitionSummary?.resultsFetched || 0,
      evidenceUnitsPersisted: acquisitionSummary?.evidenceUnitsPersisted || 0,
      approvedEvidenceIds,
      subPhaseTimings,
      diversityReport: acquisitionSummary?.diversityReport,
      statusMessage,
    };
  }

  // When sufficient, return COMPLETE
  const effectiveApprovedIds = approvedEvidenceIds.length > 0
    ? approvedEvidenceIds
    : combinedReadiness.units.map(u => u.evidenceId);

  return {
    status: "COMPLETE",
    discoveryJobId: acquisitionSummary?.discoveryJobId,
    intentsPlanned: acquisitionSummary?.intentsPlanned || 0,
    resultsFetched: acquisitionSummary?.resultsFetched || 0,
    evidenceUnitsPersisted: acquisitionSummary?.evidenceUnitsPersisted || 0,
    approvedEvidenceIds: effectiveApprovedIds,
    evidenceUnits: acquisitionSummary?.evidenceItems || [],
    subPhaseTimings,
    diversityReport: acquisitionSummary?.diversityReport,
    statusMessage: `Combined customer evidence corpus is semantically SUFFICIENT (${combinedReadiness.reason}).`,
  };
}

/**
 * Executes the complete Market Voice pipeline.
 * If evidenceManifest is provided, executes post-freeze analysis strictly on the manifest.
 * Otherwise, performs pre-freeze acquisition followed by analysis.
 */
export async function runMarketVoicePipeline(
  options: RunMarketVoicePipelineOptions
): Promise<MarketVoicePipelineResult> {
  const { accountId, campaignId, campaignOfferingId, forceRefresh = false, jobId, evidenceManifest } = options;

  // 1. If an evidence manifest is already provided, skip live acquisition and perform strict manifest analysis
  if (evidenceManifest) {
    return executeMarketVoiceAnalysis(options);
  }

  // 2. Check for existing persisted evidence reuse if not forceRefresh
  if (!forceRefresh) {
    try {
      const bu = await resolveCurrentBusinessUnderstandingOrThrow({
        accountId,
        campaignId,
        campaignOfferingId,
      });
      const offeringId = bu.campaignOfferingId;

      const existingEvidence = await db
        .select()
        .from(marketVoiceEvidence)
        .where(and(
          eq(marketVoiceEvidence.accountId, accountId),
          eq(marketVoiceEvidence.campaignId, campaignId),
          eq(marketVoiceEvidence.campaignOfferingId, offeringId),
          eq(marketVoiceEvidence.eligibilityVerdict, "PRIMARY_ELIGIBLE")
        ));

      if (existingEvidence.length > 0) {
        const approvedIds = existingEvidence.map(e => e.id);
        const reuseReadiness = await evaluateCombinedEvidenceReadiness({
          accountId,
          campaignId,
          approvedMarketVoiceEvidenceIds: approvedIds,
        });

        if (reuseReadiness.isSufficient) {
          console.log(`[MarketVoicePipeline] REUSING_EXISTING_EVIDENCE | Reusing ${existingEvidence.length} primary eligible quotes`);
          return {
            status: "COMPLETE",
            discoveryJobId: existingEvidence[0].discoveryJobId || undefined,
            intentsPlanned: 0,
            resultsFetched: 0,
            evidenceUnitsPersisted: existingEvidence.length,
            approvedEvidenceIds: approvedIds,
            evidenceUnits: existingEvidence.map(e => ({
              evidenceId: e.id,
              verbatimText: e.verbatimText,
              sourceScope: e.sourceScope,
              marketScope: e.marketScope,
              platform: e.platform,
              url: e.externalUrl,
              persisted: true,
            })),
            statusMessage: `Reused ${existingEvidence.length} verified customer evidence units from canonical store.`,
          };
        }
      }
    } catch (reuseErr: any) {
      console.warn(`[MarketVoicePipeline] EVIDENCE_REUSE_CHECK_FAILED | ${reuseErr?.message || reuseErr}`);
    }
  }

  // 3. Perform acquisition, then analysis
  const acqResult = await executeMarketVoiceAcquisition(options);
  return executeMarketVoiceAnalysis({
    ...options,
    acquisitionSummary: acqResult,
  });
}
