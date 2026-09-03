import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import {
  campaignOfferings,
  campaignSelections,
  offeringInputEvidence,
  websiteSnapshots,
} from "@shared/schema";
import { resolveCurrentBusinessUnderstanding } from "../business-understanding/resolver";
import { aiChat } from "../ai-client";
import { DISCOVERY_MODEL_TIERS, resolveModelForTier } from "./model-router";
import { fetchGoogleSearchEvidence } from "../acquisition/multi-source-providers";
import { executeRedditSearch, executeWebForumsSearch } from "../market-voice/provider-router";
import { onboardCompetitorWithMultiSourceDiscovery } from "../competitive-intelligence/source-discovery";
import {
  type DiscoveryMission,
  type CandidateProvenance,
  type DiscoveredCompetitorCandidate,
  type IdentityVerificationResult,
  type RelevanceVerificationResult,
  type FinalJudgeDecision,
  type CompetitorDiscoveryReport,
  type CompetitorClassification,
  type CompetitorTier,
  type JudgeVerdict,
} from "@shared/contracts/discovery-contracts";
import {
  verifyCompetitorIdentity,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
} from "./competitor-quality-pipeline";

const EXCLUDED_PLATFORM_DOMAINS = new Set([
  "google.com", "google.ae", "google.com.lb", "google.co.uk", "google.ca",
  "youtube.com", "facebook.com", "tiktok.com", "instagram.com", "pinterest.com",
  "wikipedia.org", "reddit.com", "tripadvisor.com", "amazon.com", "amazon.ae",
  "ebay.com", "linkedin.com", "twitter.com", "x.com", "etsy.com", "aliexpress.com",
  "shein.com", "temu.com", "walmart.com", "alibaba.com", "quora.com", "medium.com"
]);

export function cleanDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlStr.toLowerCase().trim();
  }
}

export function cleanCandidateName(title: string, domain: string): string {
  if (!title) {
    const base = domain.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  const parts = title.split(/[|\-–—:]/);
  const candidate = parts[0]?.trim();
  if (candidate && candidate.length > 2 && candidate.length < 50) {
    return candidate;
  }
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export interface CompetitorDiscoveryOptions {
  accountId: string;
  campaignId: string;
  minParallelMissions?: number;
  maxParallelMissions?: number;
  maxProviderCalls?: number;
  timeoutMs?: number;
  autoOnboardApproved?: boolean;
}

export class DiscoveryBudgetTracker {
  public providerCallsMade = 0;
  public llmCallsMade = 0;
  public maxProviderCalls: number;
  public startedAt = Date.now();
  public timeoutMs: number;

  constructor(maxProviderCalls = 15, timeoutMs = 90000) {
    this.maxProviderCalls = maxProviderCalls;
    this.timeoutMs = timeoutMs;
  }

  public canCallProvider(): boolean {
    if (this.providerCallsMade >= this.maxProviderCalls) return false;
    if (Date.now() - this.startedAt >= this.timeoutMs) return false;
    return true;
  }

  public recordProviderCall(): void {
    this.providerCallsMade++;
  }

  public recordLlmCall(): void {
    this.llmCallsMade++;
  }

  public getElapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * Stage 1: Dynamic Search Mission Planner.
 * Generates grounded search missions using high-capability LLM reasoning based on Business Understanding.
 * NO hardcoded niche strings.
 */
async function planDiscoveryMissions(
  context: {
    accountId: string;
    campaignId: string;
    offeringName: string;
    category: string;
    targetMarket: string;
    businessModel: string;
    productTruthFacts: string[];
    targetRoles: string[];
  },
  budget: DiscoveryBudgetTracker,
  minMissions = 4,
  maxMissions = 8
): Promise<DiscoveryMission[]> {
  budget.recordLlmCall();

  const prompt = `You are Avyron's Strategic Competitor Discovery Mission Planner.
Analyze the target business offering and generate between ${minMissions} and ${maxMissions} diverse, focused search missions to find REAL COMMERCIAL COMPETITORS.

CAMPAIGN CONTEXT:
- Hero Product: "${context.offeringName}"
- Industry / Category: "${context.category}"
- Target Geography / Market: "${context.targetMarket}"
- Business Model: "${context.businessModel}"
- Key Product Facts: ${JSON.stringify(context.productTruthFacts.slice(0, 5))}
- Target Audience: ${JSON.stringify(context.targetRoles.slice(0, 3))}

RULES:
1. Generate specific, natural search queries to discover actual competing brands, stores, boutiques, or service providers.
2. Target both local market competitors (${context.targetMarket}) and direct category alternatives.
3. Distribute missions across providers: GOOGLE (primary), REDDIT, WEB_FORUMS.
4. DO NOT hardcode queries for unrelated niches. Every mission must be tightly grounded in "${context.offeringName}".

Return ONLY valid JSON matching:
{
  "missions": [
    {
      "id": "m_1",
      "title": "Short descriptive mission title",
      "targetProvider": "GOOGLE" | "REDDIT" | "WEB_FORUMS",
      "query": "Specific search query string",
      "rationale": "Why this query identifies competitors",
      "priority": 1
    }
  ]
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.MISSION_PLANNER),
      messages: [
        { role: "system", content: "You are the Avyron Competitor Discovery Planner. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      accountId: context.accountId,
      endpoint: "competitor-discovery-planner",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(parsed?.missions) && parsed.missions.length > 0) {
      return parsed.missions.slice(0, maxMissions).map((m: any, idx: number) => ({
        id: m.id || `m_${idx + 1}`,
        title: m.title || `Mission ${idx + 1}`,
        targetProvider: (["GOOGLE", "REDDIT", "WEB_FORUMS"].includes(m.targetProvider) ? m.targetProvider : "GOOGLE") as any,
        query: m.query || `${context.offeringName} ${context.targetMarket}`,
        rationale: m.rationale || "Discover direct competitors",
        priority: m.priority || idx + 1,
      }));
    }
  } catch (err: any) {
    console.warn("[CompetitorDiscovery] Dynamic planner LLM error, falling back to grounded defaults:", err.message);
  }

  // Grounded dynamic fallback based on context (no hardcoded niche strings)
  return [
    {
      id: "m_1",
      title: "Direct offering in target market",
      targetProvider: "GOOGLE",
      query: `${context.offeringName} ${context.targetMarket}`,
      rationale: "Direct geographic competitor search",
      priority: 1,
    },
    {
      id: "m_2",
      title: "Category brands in target market",
      targetProvider: "GOOGLE",
      query: `${context.category || context.offeringName} brands in ${context.targetMarket}`,
      rationale: "Category player discovery",
      priority: 2,
    },
    {
      id: "m_3",
      title: "Online shop alternatives",
      targetProvider: "GOOGLE",
      query: `best ${context.offeringName} online shop ${context.targetMarket}`,
      rationale: "Commercial e-commerce competitor search",
      priority: 3,
    },
    {
      id: "m_4",
      title: "Community discussions and recommendations",
      targetProvider: "REDDIT",
      query: `where to buy ${context.offeringName} ${context.targetMarket}`,
      rationale: "Customer community recommendations",
      priority: 4,
    },
  ];
}

/**
 * Stage 2: Provider Execution.
 * Executes missions across real providers concurrently within budget limits.
 */
async function executeDiscoveryMissions(
  missions: DiscoveryMission[],
  context: { accountId: string; campaignId: string; campaignOfferingId: string },
  budget: DiscoveryBudgetTracker
): Promise<CandidateProvenance[]> {
  const provenances: CandidateProvenance[] = [];

  const results = await Promise.allSettled(
    missions.map(async (mission) => {
      if (!budget.canCallProvider()) {
        return [];
      }
      budget.recordProviderCall();

      const items: CandidateProvenance[] = [];

      try {
        if (mission.targetProvider === "GOOGLE") {
          const res = await fetchGoogleSearchEvidence({
            query: mission.query,
            campaignId: context.campaignId,
            accountId: context.accountId,
            maxResults: 10,
            budgetMs: 25000,
          });

          for (const item of res.items || []) {
            if (!item.url) continue;
            const domain = cleanDomain(item.url);
            if (!domain || EXCLUDED_PLATFORM_DOMAINS.has(domain)) continue;

            items.push({
              missionId: mission.id,
              searchProvider: "GOOGLE",
              searchQuery: mission.query,
              rawTitle: item.title || "",
              rawSnippet: item.text || "",
              url: item.url,
              domain,
              retrievedAt: item.fetchedAt || new Date().toISOString(),
            });
          }
        } else if (mission.targetProvider === "REDDIT") {
          const res = await executeRedditSearch(
            {
              accountId: context.accountId,
              campaignId: context.campaignId,
              campaignOfferingId: context.campaignOfferingId,
              discoveryJobId: `disc_${context.campaignId}`,
              searchIntentId: mission.id,
              query: mission.query,
              targetPlatform: "REDDIT",
              marketScope: "TARGET_MARKET",
              limit: 10,
              budgetMs: 25000,
            },
            10
          );

          for (const r of res.results || []) {
            if (!r.url) continue;
            const domain = cleanDomain(r.url);
            if (!domain || EXCLUDED_PLATFORM_DOMAINS.has(domain)) continue;

            items.push({
              missionId: mission.id,
              searchProvider: "REDDIT",
              searchQuery: mission.query,
              rawTitle: r.title || "",
              rawSnippet: r.snippet || "",
              url: r.url,
              domain,
              retrievedAt: new Date().toISOString(),
            });
          }
        } else if (mission.targetProvider === "WEB_FORUMS") {
          const res = await executeWebForumsSearch(
            {
              accountId: context.accountId,
              campaignId: context.campaignId,
              campaignOfferingId: context.campaignOfferingId,
              discoveryJobId: `disc_${context.campaignId}`,
              searchIntentId: mission.id,
              query: mission.query,
              targetPlatform: "WEB_FORUMS",
              marketScope: "TARGET_MARKET",
              limit: 10,
              budgetMs: 25000,
            },
            10
          );

          for (const r of res.results || []) {
            if (!r.url) continue;
            const domain = cleanDomain(r.url);
            if (!domain || EXCLUDED_PLATFORM_DOMAINS.has(domain)) continue;

            items.push({
              missionId: mission.id,
              searchProvider: "WEB_FORUMS",
              searchQuery: mission.query,
              rawTitle: r.title || "",
              rawSnippet: r.snippet || "",
              url: r.url,
              domain,
              retrievedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err: any) {
        console.warn(`[CompetitorDiscovery] Mission ${mission.id} (${mission.query}) warning:`, err.message);
      }

      return items;
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      provenances.push(...r.value);
    }
  }

  return provenances;
}

/**
 * Stage 3: Candidate Deduplication & Provenance Aggregation.
 * Deduplicates by domain while preserving ALL occurrence provenance.
 */
function aggregateCandidates(
  provenances: CandidateProvenance[],
  campaignWebsiteUrl?: string
): DiscoveredCompetitorCandidate[] {
  const ownDomain = campaignWebsiteUrl ? cleanDomain(campaignWebsiteUrl) : "";
  const candidateMap = new Map<string, DiscoveredCompetitorCandidate>();

  for (const prov of provenances) {
    const domain = prov.domain;
    if (!domain || domain === ownDomain || EXCLUDED_PLATFORM_DOMAINS.has(domain)) {
      continue;
    }

    if (!candidateMap.has(domain)) {
      const name = cleanCandidateName(prov.rawTitle, domain);
      let websiteUrl = `https://${domain}`;
      try {
        const parsed = new URL(prov.url);
        websiteUrl = `${parsed.protocol}//${parsed.hostname}`;
      } catch {}

      candidateMap.set(domain, {
        candidateKey: domain,
        name,
        domain,
        websiteUrl,
        occurrences: [prov],
      });
    } else {
      candidateMap.get(domain)!.occurrences.push(prov);
    }
  }

  return Array.from(candidateMap.values());
}

/**
 * Stage 4: Identity Verification.
 * Delegates to canonical shared quality pipeline.
 */
async function verifyCandidateIdentity(
  candidate: DiscoveredCompetitorCandidate,
  accountId: string,
  budget: DiscoveryBudgetTracker
): Promise<IdentityVerificationResult> {
  const snippets = candidate.occurrences.map((o) => `[${o.searchProvider}] ${o.rawTitle}: ${o.rawSnippet}`).join("\n");
  return verifyCompetitorIdentity(
    {
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      domain: candidate.domain,
      websiteUrl: candidate.websiteUrl,
      evidenceText: snippets,
    },
    { accountId, budget }
  );
}

/**
 * Stage 5: Relevance Verification.
 * Delegates to canonical shared quality pipeline.
 */
async function verifyCandidateRelevance(
  candidate: DiscoveredCompetitorCandidate,
  context: {
    offeringName: string;
    category: string;
    targetMarket: string;
    productTruthFacts: string[];
    targetRoles: string[];
  },
  accountId: string,
  budget: DiscoveryBudgetTracker
): Promise<RelevanceVerificationResult> {
  const snippets = candidate.occurrences.map((o) => o.rawSnippet).join(" ");
  return verifyCompetitorRelevance(
    {
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      domain: candidate.domain,
      websiteUrl: candidate.websiteUrl,
      evidenceText: snippets,
    },
    {
      candidateKey: candidate.candidateKey,
      isRealBusiness: candidate.isCommercialBusiness ?? true,
      entityRole: candidate.entityRole ?? "UNKNOWN",
      entityRoleReasoning: candidate.entityRoleReasoning ?? "",
      canonicalName: candidate.name,
      canonicalDomain: candidate.domain,
      confidence: candidate.identityConfidence ?? 0.8,
      reasoning: candidate.identityReasoning ?? "",
    },
    context,
    { accountId, budget }
  );
}

/**
 * Stage 6: Final Semantic Judge.
 * Delegates to canonical shared quality pipeline.
 */
async function judgeCandidate(
  candidate: DiscoveredCompetitorCandidate,
  identity: IdentityVerificationResult,
  relevance: RelevanceVerificationResult,
  context: { offeringName: string; targetMarket: string },
  accountId: string,
  budget: DiscoveryBudgetTracker
): Promise<FinalJudgeDecision> {
  return runCompetitorFinalJudge(
    {
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      domain: candidate.domain,
      websiteUrl: candidate.websiteUrl,
      evidenceText: candidate.occurrences.map((o) => o.rawSnippet).join(" "),
    },
    identity,
    relevance,
    context,
    { accountId, budget }
  );
}

/**
 * Core Competitor Discovery Engine.
 * Executes the complete 7-stage pipeline:
 * Dynamic Planning → Provider Execution → Aggregation → Identity Verify → Relevance Verify → Final Judge → Canonical Onboarding
 */
export async function runCompetitorDiscoveryEngine(
  options: CompetitorDiscoveryOptions
): Promise<CompetitorDiscoveryReport> {
  const { accountId, campaignId, autoOnboardApproved = false } = options;
  const budget = new DiscoveryBudgetTracker(options.maxProviderCalls || 15, options.timeoutMs || 90000);

  // 1. Resolve Target Market from Campaign Selection
  const [camp] = await db
    .select()
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, accountId),
      eq(campaignSelections.selectedCampaignId, campaignId)
    ))
    .limit(1);

  const targetMarket = camp?.campaignLocation || "United Arab Emirates";

  // 2. Fetch Authoritative User-Confirmed Hero Product / Offering
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(
      eq(campaignOfferings.accountId, accountId),
      eq(campaignOfferings.campaignId, campaignId)
    ))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  // 3. Resolve Supporting Canonical Business Understanding Context via hardened resolver
  const buResult = await resolveCurrentBusinessUnderstanding({
    accountId,
    campaignId,
    campaignOfferingId: offering?.id,
  });

  const bu: any = buResult?.snapshotRow?.businessUnderstanding || {};
  const offeringName = offering?.offeringName || bu.campaignOffering?.offeringName || "";
  const category = bu.campaignOffering?.category || bu.generalIndustry || "Commerce";
  const businessModel = bu.businessModel || "Direct-to-Consumer";
  const productTruthFacts = Array.isArray(bu.campaignOffering?.productTruthFacts)
    ? bu.campaignOffering.productTruthFacts.map((f: any) => f.factText || String(f))
    : [];
  const targetRoles = Array.isArray(bu.targetUnderstanding?.targetRoles)
    ? bu.targetUnderstanding.targetRoles.map((r: any) => r.roleTitle || String(r))
    : [];

  const [website] = await db
    .select()
    .from(websiteSnapshots)
    .where(and(
      eq(websiteSnapshots.accountId, accountId),
      eq(websiteSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(websiteSnapshots.createdAt))
    .limit(1);

  if (!offeringName || offeringName.trim().length === 0) {
    return {
      status: "INSUFFICIENT_CONTEXT",
      searchMissions: [],
      totalOccurrencesDiscovered: 0,
      uniqueCandidateCount: 0,
      approvedCandidates: [],
      rejectedCandidates: [],
      insufficientEvidenceCandidates: [],
      candidates: [],
      onboardedCompetitors: [],
      message: "No Hero Product or campaign focus has been confirmed.",
      telemetry: {
        missionsPlanned: 0,
        missionsExecuted: 0,
        providerCallsMade: 0,
        llmCallsMade: 0,
        totalRuntimeMs: budget.getElapsedMs(),
      },
    };
  }

  const contextData = {
    accountId,
    campaignId,
    offeringName,
    category,
    targetMarket,
    businessModel,
    productTruthFacts,
    targetRoles,
  };

  // Stage 1: Plan Dynamic Missions
  const missions = await planDiscoveryMissions(
    contextData,
    budget,
    options.minParallelMissions || 4,
    options.maxParallelMissions || 8
  );

  // Stage 2: Execute Missions across Real Providers
  const provenances = await executeDiscoveryMissions(
    missions,
    { accountId, campaignId, campaignOfferingId: offering?.id || "unknown" },
    budget
  );

  // Stage 3: Aggregate Candidates & Deduplicate Domains
  const rawCandidates = aggregateCandidates(provenances, website?.rootUrl);

  if (rawCandidates.length === 0) {
    return {
      status: budget.providerCallsMade === 0 ? "SEARCH_PROVIDER_UNAVAILABLE" : "NO_VERIFIED_COMPETITORS",
      searchMissions: missions,
      totalOccurrencesDiscovered: 0,
      uniqueCandidateCount: 0,
      approvedCandidates: [],
      rejectedCandidates: [],
      insufficientEvidenceCandidates: [],
      candidates: [],
      onboardedCompetitors: [],
      message: "Real provider search executed, but no candidate commercial domains were discovered.",
      telemetry: {
        missionsPlanned: missions.length,
        missionsExecuted: missions.length,
        providerCallsMade: budget.providerCallsMade,
        llmCallsMade: budget.llmCallsMade,
        totalRuntimeMs: budget.getElapsedMs(),
      },
    };
  }

  // Stages 4, 5, 6: Verify and Judge Candidates Concurrently (bounded)
  const approvedCandidates: DiscoveredCompetitorCandidate[] = [];
  const rejectedCandidates: DiscoveredCompetitorCandidate[] = [];
  const insufficientCandidates: DiscoveredCompetitorCandidate[] = [];

  const evaluatedCandidates = await Promise.allSettled(
    rawCandidates.map(async (candidate) => {
      // Stage 4: Identity Verification
      const identity = await verifyCandidateIdentity(candidate, accountId, budget);
      candidate.isCommercialBusiness = identity.isRealBusiness;
      candidate.entityRole = identity.entityRole;
      candidate.entityRoleReasoning = identity.entityRoleReasoning;
      candidate.identityConfidence = identity.confidence;
      candidate.identityReasoning = identity.reasoning;
      candidate.name = identity.canonicalName;

      // Stage 5: Relevance Verification
      const relevance = await verifyCandidateRelevance(candidate, contextData, accountId, budget);
      candidate.classification = relevance.classification;
      candidate.relevanceReason = relevance.reason;
      candidate.tier = relevance.tier;

      // Stage 6: Final Semantic Judge
      const decision = await judgeCandidate(candidate, identity, relevance, { offeringName, targetMarket }, accountId, budget);
      candidate.judgeVerdict = decision.verdict;
      candidate.judgeReason = decision.finalReason;
      candidate.tier = decision.tier;

      return candidate;
    })
  );

  for (const res of evaluatedCandidates) {
    if (res.status === "fulfilled") {
      const c = res.value;
      if (c.judgeVerdict === "APPROVED") {
        approvedCandidates.push(c);
      } else if (c.judgeVerdict === "REJECTED") {
        rejectedCandidates.push(c);
      } else {
        insufficientCandidates.push(c);
      }
    }
  }

  // Stage 7: Canonical Onboarding for Approved Candidates (EXACTLY ONCE)
  const onboardedList: Array<{
    id: string;
    name: string;
    websiteUrl: string;
    tier: CompetitorTier;
    isExisting: boolean;
  }> = [];

  if (autoOnboardApproved && approvedCandidates.length > 0) {
    for (const appComp of approvedCandidates) {
      try {
        const { competitor, isExisting } = await onboardCompetitorWithMultiSourceDiscovery({
          accountId,
          campaignId,
          name: appComp.name,
          websiteUrl: appComp.websiteUrl,
          tier: appComp.tier,
        });

        appComp.canonicalCompetitorId = competitor.id;
        appComp.isOnboarded = true;

        onboardedList.push({
          id: competitor.id,
          name: competitor.name,
          websiteUrl: competitor.websiteUrl || appComp.websiteUrl,
          tier: (competitor.tier as CompetitorTier) || appComp.tier || "B",
          isExisting: !!isExisting,
        });
      } catch (onboardErr: any) {
        console.warn(`[CompetitorDiscovery] Canonical onboarding error for ${appComp.name}:`, onboardErr.message);
      }
    }
  }

  const allCandidates = [...approvedCandidates, ...insufficientCandidates, ...rejectedCandidates];

  let status: CompetitorDiscoveryReport["status"] = "DISCOVERY_COMPLETE";
  let message = "";

  if (approvedCandidates.length >= 10) {
    status = "DISCOVERY_COMPLETE";
    message = `Discovered and verified ${approvedCandidates.length} high-quality competitors (minimum 10 requirement met).`;
  } else if (approvedCandidates.length > 0) {
    status = "VERIFIED_COMPETITOR_COUNT_INSUFFICIENT_FOR_BUILD_GATE";
    message = `${approvedCandidates.length} of 10 competitors verified. Avyron requires at least 10 approved competitors before strategy build.`;
  } else {
    status = "NO_VERIFIED_COMPETITORS";
    message = "Provider search executed, but no candidates met full identity and relevance approval criteria.";
  }

  return {
    status,
    searchMissions: missions,
    totalOccurrencesDiscovered: provenances.length,
    uniqueCandidateCount: rawCandidates.length,
    approvedCandidates,
    rejectedCandidates,
    insufficientEvidenceCandidates: insufficientCandidates,
    candidates: allCandidates,
    onboardedCompetitors: onboardedList,
    message,
    telemetry: {
      missionsPlanned: missions.length,
      missionsExecuted: missions.length,
      providerCallsMade: budget.providerCallsMade,
      llmCallsMade: budget.llmCallsMade,
      totalRuntimeMs: budget.getElapsedMs(),
    },
  };
}
