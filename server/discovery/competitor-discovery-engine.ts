import { db } from "../db";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  websiteSnapshots,
  competitorDiscoverySessions,
  campaignSelections,
  competitorRelevanceDecisions,
} from "@shared/schema";
import {
  resolvePinnedDiscoveryContext,
  verifyPinnedDiscoveryContextStillCurrent,
  checkDiscoverySessionCompatibility,
  type PinnedDiscoveryContext,
} from "./context-binder";
import { aiChat } from "../ai-client";
import { DISCOVERY_MODEL_TIERS, resolveModelForTier } from "./model-router";
import { fetchGoogleSearchEvidence } from "../acquisition/multi-source-providers";
import { executeRedditSearch, executeWebForumsSearch } from "../market-voice/provider-router";
import { onboardCompetitorWithMultiSourceDiscovery } from "../competitive-intelligence/source-discovery";
import {
  type DiscoveryMission,
  type CandidateProvenance,
  type DiscoveredCompetitorCandidate,
  type CompetitorDiscoveryReport,
  type CompetitorTier,
} from "@shared/contracts/discovery-contracts";
import {
  verifyCompetitorIdentity,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
  isExcludedPlatformDomain,
  classifyEvidenceSourceType,
  type CompetitorQualityCampaignContext,
} from "./competitor-quality-pipeline";
import { evaluateCompetitorDiscoveryReadiness } from "./discovery-readiness";
import { resolveMarketLocalization } from "../shared/market-localization";
import { extractAppListingIdentity, resolveCanonicalEntities } from "./entity-resolver";
import type { BusinessClassificationProfile } from "@shared/business-understanding-types";

export function cleanDomain(urlStr: string): string {
  const appListing = extractAppListingIdentity(urlStr);
  if (appListing.isAppListing && appListing.listingKey) {
    return appListing.listingKey;
  }
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : "https://" + urlStr);
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
  pinnedContext?: PinnedDiscoveryContext;
  resumeSession?: boolean;
  selectedDomains?: string[];
  skipPersistence?: boolean;
  rootUrlOverride?: string;
  existingSessionOverride?: any;
  customSearchExecutor?: (
    missions: DiscoveryMission[],
    budget: DiscoveryBudgetTracker
  ) => Promise<CandidateProvenance[]>;
}

export class DiscoveryBudgetTracker {
  public providerCallsMade = 0;
  public llmCallsMade = 0;
  public providerErrors = 0;
  public emptyResultMissions = 0;
  public budgetExhausted = false;
  public reusedCandidatesCount = 0;
  public maxProviderCalls: number;
  public startedAt = Date.now();
  public timeoutMs: number;

  constructor(maxProviderCalls = 18, timeoutMs = 120000) {
    this.maxProviderCalls = maxProviderCalls;
    this.timeoutMs = timeoutMs;
  }

  public canCallProvider(): boolean {
    if (this.providerCallsMade >= this.maxProviderCalls) {
      this.budgetExhausted = true;
      return false;
    }
    if (Date.now() - this.startedAt >= this.timeoutMs) {
      this.budgetExhausted = true;
      return false;
    }
    return true;
  }

  public recordProviderCall(): void {
    this.providerCallsMade++;
  }

  public recordProviderError(): void {
    this.providerErrors++;
  }

  public recordEmptyMission(): void {
    this.emptyResultMissions++;
  }

  public recordLlmCall(): void {
    this.llmCallsMade++;
  }

  public getElapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * Concurrency limiter helper to run async tasks with max concurrency.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Stage 1: Contextual LLM Search Mission Planner.
 * Determines search terms, language coverage, competitor categories, and market-service evidence strategy
 * from canonical Business Understanding, delivery model, B2B/B2C buyer segments, requested market, and remaining evidence gaps.
 * Contains zero hardcoded language percentages or physical retail assumptions.
 */
export async function planDiscoveryMissions(
  context: {
    accountId: string;
    campaignId: string;
    businessName: string;
    offeringName: string;
    category: string;
    generalIndustry?: string;
    targetMarket: string;
    businessModel?: string;
    offeringType?: string;
    pricingModel?: string;
    classificationProfile?: BusinessClassificationProfile;
    evidenceGaps?: string[];
    productTruthFacts?: string[];
    targetRoles?: string[];
    remainingEvidenceGaps?: string[];
    alreadyDiscoveredSummary?: string[];
    mentionedLeadsToVerify?: string[];
  },
  budget: DiscoveryBudgetTracker,
  minMissions = 4,
  maxMissions = 8,
  existingQueries: Set<string> = new Set()
): Promise<DiscoveryMission[]> {
  budget.recordLlmCall();

  const loc = resolveMarketLocalization(context.targetMarket);
  const deliveryCat =
    context.classificationProfile?.offeringAndDelivery?.value ||
    context.classificationProfile?.offeringAndDelivery?.category ||
    context.offeringType ||
    "UNCERTAIN";
  const deliveryReasoning =
    context.classificationProfile?.offeringAndDelivery?.summary ||
    context.classificationProfile?.offeringAndDelivery?.reasoning ||
    context.businessModel ||
    "";
  const buyerCat =
    context.classificationProfile?.buyerSegment?.value ||
    context.classificationProfile?.buyerSegment?.category ||
    "UNCERTAIN";
  const buyerReasoning =
    context.classificationProfile?.buyerSegment?.summary ||
    context.classificationProfile?.buyerSegment?.reasoning ||
    "";
  const monetizationCat =
    context.classificationProfile?.monetization?.value ||
    context.classificationProfile?.monetization?.category ||
    context.pricingModel ||
    "UNKNOWN";

  const prompt = [
    "You are Avyron's Contextual Competitor Discovery Strategist.",
    `Plan between ${minMissions} and ${maxMissions} high-precision search missions to discover real commercial competitors for this business and selected offering in the requested target market.`,
    "",
    "CANONICAL BUSINESS UNDERSTANDING & OFFERING CONTEXT:",
    `- Business Name: "${context.businessName}"`,
    `- Selected Offering: "${context.offeringName}"`,
    `- Industry / Category: "${context.category}" (General Industry: "${context.generalIndustry || context.category}")`,
    `- Business Model Summary: "${context.businessModel}"`,
    `- Offering & Delivery Dimension: ${deliveryCat} — ${deliveryReasoning}`,
    `- Buyer Segment Dimension (B2B / B2C): ${buyerCat} — ${buyerReasoning}`,
    `- Monetization Dimension: ${monetizationCat}`,
    `- Requested Target Market: "${context.targetMarket}" (ISO Country: ${loc.countryCode}, Regional Languages Available: ${loc.languageName})`,
    `- Canonical Product Truth Facts (${(context.productTruthFacts || []).length}): ${JSON.stringify(context.productTruthFacts || [])}`,
    `- Target Buyer Roles (${(context.targetRoles || []).length}): ${JSON.stringify(context.targetRoles || [])}`,
    ...(context.evidenceGaps && context.evidenceGaps.length > 0
      ? [`- Known Website/BU Evidence Gaps: ${JSON.stringify(context.evidenceGaps)}`]
      : []),
    ...(context.alreadyDiscoveredSummary && context.alreadyDiscoveredSummary.length > 0
      ? [`- Already Evaluated Competitors (do NOT repeat identical angles): ${JSON.stringify(context.alreadyDiscoveredSummary)}`]
      : []),
    ...(context.remainingEvidenceGaps && context.remainingEvidenceGaps.length > 0
      ? [`- Priority Evidence Gaps to Resolve in This Round: ${JSON.stringify(context.remainingEvidenceGaps)}`]
      : []),
    ...(context.mentionedLeadsToVerify && context.mentionedLeadsToVerify.length > 0
      ? [`- Unverified Competitor Leads Extracted from Prior Listicles (verify their official domains): ${JSON.stringify(context.mentionedLeadsToVerify)}`]
      : []),
    ...(existingQueries.size > 0
      ? [`- Previously Executed Search Queries (DO NOT repeat): ${JSON.stringify(Array.from(existingQueries))}`]
      : []),
    "",
    "CONTEXTUAL STRATEGY INSTRUCTIONS (NO FIXED RATIOS OR RETAIL ASSUMPTIONS):",
    "1. Match the Delivery Model:",
    "   - If the offering is SaaS, AI web application, or digital product/service (`SAAS_OR_WEB_APPLICATION` or `DIGITAL_PRODUCT_OR_SERVICE`), search for direct software/digital platforms, web apps, and online services that serve buyers in the target market (locally or cross-border), as well as local/regional agencies or studios that solve the same buyer use case. Do NOT use physical retail words ('stores', 'boutiques', 'shipping') unless the offering actually ships physical goods.",
    "   - If the offering is a physical product (`PHYSICAL_PRODUCT`), search for domestic brands, retailers, and cross-border sellers delivering to the target market.",
    "   - If the offering is a professional or local service (`PROFESSIONAL_OR_LOCAL_SERVICE`), search for agencies, studios, consultancies, and service providers active in the target market.",
    "2. Cover All Established Buyer Segments:",
    "   - If `buyerSegment` includes both B2B and B2C (`B2B_AND_B2C` or `HYBRID`) or `targetRoles` span consumer and commercial/corporate buyers, plan distinct missions for BOTH consumer use cases (B2C) and commercial/corporate/agency use cases (B2B).",
    "3. Choose Natural Search Languages Contextually:",
    "   - Choose `searchLanguage` ('en', 'ar', 'tr', 'de', 'fr', etc.) per mission based on how real B2B and B2C buyers in `" +
      context.targetMarket +
      "` actually search for `" +
      context.offeringName +
      "`. Never enforce an arbitrary language percentage.",
    "4. Balance Market-Specific and Category-Direct Discovery:",
    "   - Include missions that test target-market presence/availability (`marketScope: 'MARKET_SPECIFIC'`) AND missions that identify direct category platforms/tools serving buyers online (`marketScope: 'REGIONAL_OR_GLOBAL'`).",
    `5. Do NOT search for our own brand ("${context.businessName}").`,
    "6. Distribute across providers: GOOGLE (primary), plus REDDIT or WEB_FORUMS where buyer recommendations exist.",
    "",
    "Return ONLY valid JSON matching:",
    '{"missions": [{"id": "m_1", "title": "...", "targetProvider": "GOOGLE" | "REDDIT" | "WEB_FORUMS", "query": "...", "searchLanguage": "en", "marketScope": "MARKET_SPECIFIC" | "REGIONAL_OR_GLOBAL", "competitorCategoryTarget": "...", "buyerSegmentTarget": "B2C" | "B2B" | "B2B_AND_B2C", "rationale": "...", "priority": 1}]}',
  ].join("\n");

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.MISSION_PLANNER),
      messages: [
        {
          role: "system",
          content:
            "You are the Avyron Contextual Competitor Discovery Strategist. Adapt search terms, language, and competitor categories to the business's actual delivery model, buyer segments, and target market. Always return valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      accountId: context.accountId,
      campaignId: context.campaignId,
      operationType: "competitor_discovery",
      endpoint: "competitor-discovery-planner",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    if (Array.isArray(parsed?.missions) && parsed.missions.length > 0) {
      const filtered = parsed.missions
        .filter((m: any) => m.query && !existingQueries.has(m.query.toLowerCase().trim()))
        .slice(0, maxMissions)
        .map((m: any, idx: number) => ({
          id: m.id || "m_" + (existingQueries.size + idx + 1),
          title: m.title || "Mission " + (existingQueries.size + idx + 1),
          targetProvider: (["GOOGLE", "REDDIT", "WEB_FORUMS"].includes(m.targetProvider) ? m.targetProvider : "GOOGLE") as any,
          query: m.query.trim(),
          searchLanguage: typeof m.searchLanguage === "string" && m.searchLanguage.trim() ? m.searchLanguage.trim().toLowerCase() : loc.searchLanguage,
          marketScope: m.marketScope === "REGIONAL_OR_GLOBAL" ? "REGIONAL_OR_GLOBAL" : "MARKET_SPECIFIC",
          competitorCategoryTarget: typeof m.competitorCategoryTarget === "string" ? m.competitorCategoryTarget : undefined,
          buyerSegmentTarget: typeof m.buyerSegmentTarget === "string" ? m.buyerSegmentTarget : undefined,
          rationale: m.rationale || "Discover relevant competitors",
          priority: m.priority || idx + 1,
        }));

      if (filtered.length > 0) {
        return filtered;
      }
    }
  } catch (err: any) {
    console.warn("[CompetitorDiscovery] Contextual planner LLM error, falling back to context-derived queries:", err.message);
  }

  // Context-derived fallback when LLM is unreachable (adapts to delivery model & buyer segments without retail assumptions)
  const isMarketConfigured = context.targetMarket && context.targetMarket !== "Unspecified";
  const marketClause = isMarketConfigured ? " " + context.targetMarket : "";
  const isDigitalOrSaas =
    deliveryCat === "SAAS_OR_WEB_APPLICATION" ||
    deliveryCat === "DIGITAL_PRODUCT_OR_SERVICE" ||
    deliveryCat === "MARKETPLACE_OR_PLATFORM";
  const hasB2B = buyerCat === "B2B" || buyerCat === "B2B_AND_B2C" || buyerCat === "HYBRID";

  const fallbacks: DiscoveryMission[] = [
    {
      id: `m_${existingQueries.size + 1}`,
      title: `Direct ${context.offeringName} platforms and providers`,
      targetProvider: "GOOGLE",
      query: isDigitalOrSaas
        ? `${context.offeringName} platform software ${context.category}`
        : `${context.offeringName}${marketClause}`,
      searchLanguage: loc.searchLanguage,
      marketScope: isDigitalOrSaas ? "REGIONAL_OR_GLOBAL" : "MARKET_SPECIFIC",
      rationale: "Direct offering and category competitor discovery",
      priority: 1,
    },
    {
      id: `m_${existingQueries.size + 2}`,
      title: `Target market ${context.offeringName} solutions in ${context.targetMarket}`,
      targetProvider: "GOOGLE",
      query: `${context.offeringName}${marketClause}`,
      searchLanguage: loc.searchLanguage,
      marketScope: "MARKET_SPECIFIC",
      rationale: `Identify competitors serving ${context.targetMarket}`,
      priority: 2,
    },
    {
      id: `m_${existingQueries.size + 3}`,
      title: hasB2B
        ? `Commercial and business ${context.category} services in ${context.targetMarket}`
        : `Alternative ${context.category} services in ${context.targetMarket}`,
      targetProvider: "GOOGLE",
      query: hasB2B
        ? `${context.category} for business corporate agency${marketClause}`
        : `best ${context.offeringName} alternatives${marketClause}`,
      searchLanguage: loc.searchLanguage,
      marketScope: "MARKET_SPECIFIC",
      rationale: hasB2B ? "Cover B2B commercial buyer segment" : "Cover substitute and adjacent alternatives",
      priority: 3,
    },
    {
      id: `m_${existingQueries.size + 4}`,
      title: "Category benchmark and comparison alternatives",
      targetProvider: "GOOGLE",
      query: `best ${context.offeringName} ${context.category} platforms`,
      searchLanguage: "en",
      marketScope: "REGIONAL_OR_GLOBAL",
      rationale: "Identify category-leading direct and benchmark competitors",
      priority: 4,
    },
    {
      id: `m_${existingQueries.size + 5}`,
      title: "Buyer community discussions and recommendations",
      targetProvider: "REDDIT",
      query: `${context.offeringName} ${context.category}`,
      searchLanguage: "en",
      marketScope: "REGIONAL_OR_GLOBAL",
      rationale: "Organic buyer recommendations and alternatives",
      priority: 5,
    },
  ];

  return fallbacks.filter((m) => !existingQueries.has(m.query.toLowerCase().trim())).slice(0, maxMissions);
}

/**
 * Stage 2: Provider Execution.
 * Executes missions concurrently with BOUNDED concurrency (max 3 concurrent Apify runs)
 * and tracks provider errors, empty result missions, and budget exhaustion distinctly.
 */
async function executeDiscoveryMissions(
  missions: DiscoveryMission[],
  context: { accountId: string; campaignId: string; campaignOfferingId: string; targetMarket: string },
  budget: DiscoveryBudgetTracker
): Promise<CandidateProvenance[]> {
  const loc = resolveMarketLocalization(context.targetMarket);

  const results = await mapWithConcurrency(missions, 3, async (mission) => {
    if (!budget.canCallProvider()) {
      return [];
    }
    budget.recordProviderCall();

    const items: CandidateProvenance[] = [];
    const missionLang = mission.searchLanguage || loc.searchLanguage;

    try {
      if (mission.targetProvider === "GOOGLE") {
        const res = await fetchGoogleSearchEvidence({
          query: mission.query,
          campaignId: context.campaignId,
          accountId: context.accountId,
          maxResults: 10,
          budgetMs: 50000,
          countryCode: mission.marketScope === "REGIONAL_OR_GLOBAL" ? undefined : loc.countryCode,
          searchLanguage: missionLang,
          languageCode: missionLang === "ar" ? "ar-AE" : missionLang === "en" ? "en-US" : loc.languageCode,
        });

        if ((res as any)?.providerStatus === "ERROR" || (res as any)?.error) {
          budget.recordProviderError();
        }

        for (const item of res.items || []) {
          if (!item.url) continue;
          const domain = cleanDomain(item.url);
          if (!domain || isExcludedPlatformDomain(domain)) continue;

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

        if (items.length === 0 && !((res as any)?.providerStatus === "ERROR" || (res as any)?.error)) {
          budget.recordEmptyMission();
        }
      } else if (mission.targetProvider === "REDDIT") {
        const res = await executeRedditSearch(
          {
            accountId: context.accountId,
            campaignId: context.campaignId,
            campaignOfferingId: context.campaignOfferingId,
            discoveryJobId: "disc_" + context.campaignId,
            searchIntentId: mission.id,
            query: mission.query,
            targetPlatform: "REDDIT",
            marketScope: mission.marketScope === "REGIONAL_OR_GLOBAL" ? "GLOBAL_CATEGORY" : "TARGET_MARKET",
            limit: 10,
            budgetMs: 40000,
          },
          10
        );

        if ((res as any)?.status === "FAILED" || (res as any)?.error) {
          budget.recordProviderError();
        }

        for (const r of res.results || []) {
          if (!r.url) continue;
          const domain = cleanDomain(r.url);
          if (!domain || isExcludedPlatformDomain(domain)) continue;

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

        if (items.length === 0 && !((res as any)?.status === "FAILED" || (res as any)?.error)) {
          budget.recordEmptyMission();
        }
      } else if (mission.targetProvider === "WEB_FORUMS") {
        const res = await executeWebForumsSearch(
          {
            accountId: context.accountId,
            campaignId: context.campaignId,
            campaignOfferingId: context.campaignOfferingId,
            discoveryJobId: "disc_" + context.campaignId,
            searchIntentId: mission.id,
            query: mission.query,
            targetPlatform: "WEB_FORUMS",
            marketScope: mission.marketScope === "REGIONAL_OR_GLOBAL" ? "GLOBAL_CATEGORY" : "TARGET_MARKET",
            limit: 10,
            budgetMs: 40000,
          },
          10
        );

        if ((res as any)?.status === "FAILED" || (res as any)?.error) {
          budget.recordProviderError();
        }

        for (const r of res.results || []) {
          if (!r.url) continue;
          const domain = cleanDomain(r.url);
          if (!domain || isExcludedPlatformDomain(domain)) continue;

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

        if (items.length === 0 && !((res as any)?.status === "FAILED" || (res as any)?.error)) {
          budget.recordEmptyMission();
        }
      }
    } catch (err: any) {
      budget.recordProviderError();
      console.warn("[CompetitorDiscovery] Mission " + mission.id + " (" + mission.query + ") error:", err.message);
    }

    return items;
  });

  const provenances: CandidateProvenance[] = [];
  for (const list of results) {
    provenances.push(...list);
  }
  return provenances;
}

/**
 * Stage 3: Candidate Aggregation & Canonical Entity Resolution.
 * Deduplicates and groups candidates by canonical entity identity.
 */
function aggregateCandidates(
  provenances: CandidateProvenance[],
  campaignWebsiteUrl?: string
): DiscoveredCompetitorCandidate[] {
  const ownDomain = campaignWebsiteUrl ? cleanDomain(campaignWebsiteUrl) : "";
  const domainCandidateMap = new Map<string, DiscoveredCompetitorCandidate>();

  for (const prov of provenances) {
    const domain = prov.domain ? cleanDomain(prov.domain) : prov.url ? cleanDomain(prov.url) : "";
    if (!domain || domain === ownDomain || isExcludedPlatformDomain(domain)) {
      continue;
    }

    if (!domainCandidateMap.has(domain)) {
      const name = cleanCandidateName(prov.rawTitle, domain);
      const appListing = extractAppListingIdentity(prov.url || domain);
      let websiteUrl = appListing.isAppListing && appListing.canonicalListingUrl
        ? appListing.canonicalListingUrl
        : "https://" + domain;
      if (!appListing.isAppListing) {
        try {
          const parsed = new URL(prov.url);
          websiteUrl = parsed.protocol + "//" + parsed.hostname;
        } catch {}
      }

      domainCandidateMap.set(domain, {
        candidateKey: domain,
        name,
        domain,
        websiteUrl,
        occurrences: [prov],
      });
    } else {
      const existing = domainCandidateMap.get(domain)!;
      const isDuplicateOccurrence = existing.occurrences.some(
        (o) => o.url === prov.url && o.searchQuery === prov.searchQuery
      );
      if (!isDuplicateOccurrence) {
        existing.occurrences.push(prov);
      }
    }
  }

  // Resolve into canonical commercial entities (e.g. collapsing ubuy.* into 1 entity)
  return resolveCanonicalEntities(Array.from(domainCandidateMap.values()));
}

/**
 * Core Competitor Discovery Engine.
 * Executes the complete pipeline:
 * Contextual Planning → Provider Execution → Aggregation → Incremental Entity & Relevance Evaluation → Readiness Assessment → Session Persistence
 */
export async function runCompetitorDiscoveryEngine(
  options: CompetitorDiscoveryOptions
): Promise<CompetitorDiscoveryReport> {
  const { accountId, campaignId, autoOnboardApproved = false, resumeSession = false } = options;
  const budget = new DiscoveryBudgetTracker(options.maxProviderCalls || 18, options.timeoutMs || 120000);

  // 1. Resolve and Pin Immutable Discovery Context Exactly Once
  const pinned = options.pinnedContext || (await resolvePinnedDiscoveryContext({ accountId, campaignId }));

  const {
    targetMarket,
    offeringName,
    businessName,
    category,
    generalIndustry,
    businessModel,
    offeringType,
    pricingModel,
    classificationProfile,
    evidenceGaps,
    productTruthFacts,
    targetRoles,
  } = pinned;

  const website = options.rootUrlOverride
    ? { rootUrl: options.rootUrlOverride }
    : options.skipPersistence
      ? undefined
      : (
          await db
            .select()
            .from(websiteSnapshots)
            .where(and(eq(websiteSnapshots.accountId, accountId), eq(websiteSnapshots.campaignId, campaignId)))
            .orderBy(desc(websiteSnapshots.createdAt))
            .limit(1)
        )[0];

  if (!offeringName || offeringName.trim().length === 0) {
    const blockedReadiness = await evaluateCompetitorDiscoveryReadiness(
      {
        hasCanonicalBusinessUnderstanding: true,
        hasConfirmedOffering: false,
        businessName: businessName || "Unknown",
        offeringName: "",
        category: category || "Unspecified",
        targetMarket: targetMarket || "Unspecified",
        approvedCandidates: [],
      },
      { accountId, useLlmAssessment: false }
    );

    return {
      status: "INSUFFICIENT_CONTEXT",
      searchMissions: [],
      totalOccurrencesDiscovered: 0,
      uniqueCandidateCount: 0,
      approvedCandidates: [],
      rejectedCandidates: [],
      insufficientEvidenceCandidates: [],
      localCandidates: [],
      crossBorderCandidates: [],
      internationalReferenceCandidates: [],
      unverifiedMarketCandidates: [],
      pendingVerificationCandidates: [],
      localVerifiedCount: 0,
      requiredLocalCount: 0,
      shortfall: 0,
      isBuildEligible: false,
      readiness: blockedReadiness,
      candidates: [],
      onboardedCompetitors: [],
      message: blockedReadiness.reason,
      telemetry: {
        missionsPlanned: 0,
        missionsExecuted: 0,
        providerCallsMade: 0,
        llmCallsMade: 0,
        totalRuntimeMs: budget.getElapsedMs(),
        providerErrors: 0,
        emptyResultMissions: 0,
        budgetExhausted: false,
        reusedCandidatesCount: 0,
        contextCompatible: true,
      },
    };
  }

  const contextData: CompetitorQualityCampaignContext & {
    accountId: string;
    campaignId: string;
    generalIndustry?: string;
    remainingEvidenceGaps?: string[];
    alreadyDiscoveredSummary?: string[];
    mentionedLeadsToVerify?: string[];
  } = {
    accountId,
    campaignId,
    businessName,
    offeringName,
    category,
    generalIndustry,
    targetMarket,
    businessModel,
    offeringType,
    pricingModel,
    classificationProfile,
    evidenceGaps,
    productTruthFacts,
    targetRoles,
  };

  // 2. Check for existing session if resume ("Continue Discovery") was requested
  let existingSessionId: string | undefined;
  let accumulatedMissions: DiscoveryMission[] = [];
  let accumulatedProvenances: CandidateProvenance[] = [];
  const existingQueries = new Set<string>();
  const evaluatedCache = new Map<string, DiscoveredCompetitorCandidate>();
  const preservedSelectionMap = new Map<string, boolean>();
  const mentionedLeadsSet = new Set<string>();
  const crossCampaignIdentityMap = new Map<string, DiscoveredCompetitorCandidate>();

  if (!options.skipPersistence) {
    try {
      const otherCampaignSessions = await db
        .select()
        .from(competitorDiscoverySessions)
        .where(
          and(
            eq(competitorDiscoverySessions.accountId, accountId),
            ne(competitorDiscoverySessions.campaignId, campaignId)
          )
        )
        .orderBy(desc(competitorDiscoverySessions.createdAt))
        .limit(5);

      for (const sess of otherCampaignSessions) {
        if (Array.isArray(sess.candidates)) {
          for (const prev of sess.candidates as DiscoveredCompetitorCandidate[]) {
            const key = cleanDomain(prev.domain || prev.candidateKey || prev.websiteUrl || "");
            if (key && typeof prev.isCommercialBusiness === "boolean" && prev.entityRole && !crossCampaignIdentityMap.has(key)) {
              crossCampaignIdentityMap.set(key, prev);
            }
          }
        }
      }
    } catch {}
  }

  if (Array.isArray(options.selectedDomains)) {
    for (const dom of options.selectedDomains) {
      const clean = cleanDomain(dom);
      if (clean) preservedSelectionMap.set(clean, true);
    }
  }

  if (resumeSession) {
    const existingSession =
      options.existingSessionOverride !== undefined
        ? options.existingSessionOverride
        : options.skipPersistence
          ? undefined
          : (
              await db
                .select()
                .from(competitorDiscoverySessions)
                .where(eq(competitorDiscoverySessions.campaignId, campaignId))
                .orderBy(desc(competitorDiscoverySessions.createdAt))
                .limit(1)
            )[0];

    if (existingSession) {
      const compatibility = checkDiscoverySessionCompatibility(existingSession, {
        targetMarket,
        campaignOfferingId: pinned.campaignOfferingId,
        buSnapshotId: pinned.buSnapshotId,
      });

      if (compatibility.valid) {
        existingSessionId = existingSession.id;
        if (Array.isArray(existingSession.searchMissions)) {
          accumulatedMissions = existingSession.searchMissions as DiscoveryMission[];
          accumulatedMissions.forEach((m) => {
            if (m?.query) existingQueries.add(m.query.toLowerCase().trim());
          });
        }
        if (Array.isArray(existingSession.candidates)) {
          const priorCandidates = existingSession.candidates as DiscoveredCompetitorCandidate[];
          for (const prev of priorCandidates) {
            const key = cleanDomain(prev.domain || prev.candidateKey || prev.websiteUrl || "");
            if (!key) continue;
            evaluatedCache.set(key, prev);
            if (typeof prev.selected === "boolean" && !preservedSelectionMap.has(key)) {
              preservedSelectionMap.set(key, prev.selected);
            }
            if (Array.isArray(prev.occurrences)) {
              accumulatedProvenances.push(...prev.occurrences);
            }
            if (Array.isArray(prev.mentionedCompetitorLeads)) {
              for (const lead of prev.mentionedCompetitorLeads) {
                if (lead?.domain || lead?.name) {
                  mentionedLeadsSet.add(lead.domain ? `${lead.name} (${lead.domain})` : lead.name);
                }
              }
            }
          }

          const priorApproved = priorCandidates.filter((c) => c.judgeVerdict === "APPROVED");
          contextData.alreadyDiscoveredSummary = priorApproved.map(
            (c) => `${c.name} (${c.domain}): ${c.classification || "COMPETITOR"} / ${c.geographicClassification || "UNVERIFIED"}`
          );

          const priorReadiness = await evaluateCompetitorDiscoveryReadiness(
            {
              businessName,
              offeringName,
              category,
              businessModel,
              targetMarket,
              classificationProfile,
              productTruthFacts,
              targetRoles,
              evidenceGaps,
              approvedCandidates: priorApproved,
            },
            { accountId, useLlmAssessment: false }
          );

          const unverifiedDomains = priorApproved
            .filter((c) => !c.geographicClassification || c.geographicClassification === "UNVERIFIED")
            .map((c) => `${c.name} (${c.domain})`);

          contextData.remainingEvidenceGaps = [
            ...(priorReadiness.materialGaps || []),
            ...(unverifiedDomains.length > 0
              ? [`Verify whether these approved competitors actively serve ${targetMarket}: ${unverifiedDomains.slice(0, 5).join(", ")}`]
              : []),
          ];
          contextData.mentionedLeadsToVerify = Array.from(mentionedLeadsSet).slice(0, 8);
        }
      } else {
        console.log(
          `[CompetitorDiscoveryEngine] Existing session ${existingSession.id} is incompatible with current context (${compatibility.reason}). Starting fresh discovery session.`
        );
      }
    }
  }

  const runMissions = async (missionsToRun: DiscoveryMission[]) => {
    if (options.customSearchExecutor) {
      return options.customSearchExecutor(missionsToRun, budget);
    }
    return executeDiscoveryMissions(
      missionsToRun,
      { accountId, campaignId, campaignOfferingId: pinned.campaignOfferingId, targetMarket },
      budget
    );
  };

  // 3. Incremental Candidate Evaluation Helper (never re-runs LLM calls on already-settled domains)
  async function evaluateCandidateSetIncrementally(
    cList: DiscoveredCompetitorCandidate[]
  ): Promise<DiscoveredCompetitorCandidate[]> {
    return Promise.all(
      cList.map(async (candidate) => {
        const key = cleanDomain(candidate.domain || candidate.candidateKey || candidate.websiteUrl);
        const cached = evaluatedCache.get(key);
        const crossCampaignCached = crossCampaignIdentityMap.get(key);

        if (cached && cached.judgeVerdict) {
          const hadOccurrenceCount = Array.isArray(cached.occurrences) ? cached.occurrences.length : 0;
          const hasNewEvidence = candidate.occurrences.length > hadOccurrenceCount;
          const needsMarketReverification =
            hasNewEvidence &&
            ((cached.judgeVerdict === "APPROVED" &&
              (!cached.geographicClassification || cached.geographicClassification === "UNVERIFIED")) ||
              cached.judgeVerdict === "INSUFFICIENT_EVIDENCE");

          if (!needsMarketReverification) {
            budget.reusedCandidatesCount++;
            const merged: DiscoveredCompetitorCandidate = {
              ...cached,
              occurrences: candidate.occurrences.length >= hadOccurrenceCount ? candidate.occurrences : cached.occurrences,
              dataReuseStatus: "REUSED_FROM_CACHE",
              selected: preservedSelectionMap.has(key)
                ? preservedSelectionMap.get(key)
                : typeof cached.selected === "boolean"
                  ? cached.selected
                  : cached.judgeVerdict === "APPROVED",
            };
            evaluatedCache.set(key, merged);
            return merged;
          }
        }

        const snippets = candidate.occurrences
          .map((o) => "[" + o.searchProvider + "] " + o.rawTitle + ": " + o.rawSnippet + " (" + o.url + ")")
          .join("\n");

        const identitySource = cached && typeof cached.isCommercialBusiness === "boolean" && cached.entityRole
          ? cached
          : crossCampaignCached;
        const reusedCrossCampaignIdentity = !cached && !!crossCampaignCached;

        // Reuse prior identity if already verified on a previous round or another campaign in the workspace
        const identity = identitySource
          ? {
              candidateKey: candidate.candidateKey,
              canonicalEntityId: identitySource.canonicalEntityId,
              isRealBusiness: identitySource.isCommercialBusiness === true,
              entityRole: identitySource.entityRole!,
              entityRoleReasoning: identitySource.entityRoleReasoning || "",
              sourcePageType: identitySource.sourcePageType,
              mentionedCompetitorLeads: identitySource.mentionedCompetitorLeads,
              canonicalName: identitySource.name,
              canonicalDomain: candidate.domain,
              storefronts: identitySource.storefronts || candidate.storefronts,
              confidence: identitySource.identityConfidence || 0.85,
              reasoning: identitySource.identityReasoning || "Reused verified identity.",
            }
          : await verifyCompetitorIdentity(
              {
                candidateKey: candidate.candidateKey,
                name: candidate.name,
                domain: candidate.domain,
                websiteUrl: candidate.websiteUrl,
                evidenceText: snippets,
                storefronts: candidate.storefronts,
              },
              { accountId, campaignId, budget }
            );

        candidate.canonicalEntityId = identity.canonicalEntityId || candidate.canonicalEntityId;
        candidate.isCommercialBusiness = identity.isRealBusiness;
        candidate.entityRole = identity.entityRole;
        candidate.entityRoleReasoning = identity.entityRoleReasoning;
        candidate.sourcePageType = identity.sourcePageType;
        candidate.mentionedCompetitorLeads = identity.mentionedCompetitorLeads;
        candidate.identityConfidence = identity.confidence;
        candidate.identityReasoning = identity.reasoning;
        candidate.name = identity.canonicalName;
        candidate.storefronts = identity.storefronts || candidate.storefronts;
        candidate.evidenceSourceType = classifyEvidenceSourceType(candidate.occurrences, identity.sourcePageType);

        if (Array.isArray(identity.mentionedCompetitorLeads)) {
          for (const lead of identity.mentionedCompetitorLeads) {
            if (lead?.domain || lead?.name) {
              mentionedLeadsSet.add(lead.domain ? `${lead.name} (${lead.domain})` : lead.name);
            }
          }
        }

        // Optimization: Do not waste an LLM call on verifyCompetitorRelevance if identity already disqualified the entity
        const isDisqualifiedByIdentity =
          !identity.isRealBusiness ||
          (identity.sourcePageType !== "VENDOR_BLOG_OR_COMPARISON_POST" &&
            (identity.entityRole === "PURE_MARKETPLACE_PLATFORM" ||
              identity.entityRole === "MARKETPLACE_PLATFORM" ||
              identity.entityRole === "DIRECTORY_AGGREGATOR" ||
              identity.entityRole === "MEDIA_PUBLISHER" ||
              identity.entityRole === "COMMUNITY_FORUM"));

        const relevance = isDisqualifiedByIdentity
          ? {
              candidateKey: candidate.candidateKey,
              isRelevant: false,
              classification: "NOT_COMPETITOR" as const,
              competingOffering: "NONE",
              servesBuyerNeed: false,
              buyerNeedRationale: identity.entityRoleReasoning || identity.reasoning || "Non-competitor entity role.",
              competitorType: "EXCLUDED" as const,
              monitoredProductUrls: [],
              geographicClassification: "UNVERIFIED" as const,
              geographicReasoning: "Skipped relevance check because entity is not a commercial competitor.",
              tier: "B" as const,
              reason: identity.entityRoleReasoning || identity.reasoning || "Non-competitor entity role.",
            }
          : await verifyCompetitorRelevance(
              {
                candidateKey: candidate.candidateKey,
                name: candidate.name,
                domain: candidate.domain,
                websiteUrl: candidate.websiteUrl,
                evidenceText: snippets,
                occurrences: candidate.occurrences,
                storefronts: candidate.storefronts,
              },
              identity,
              contextData,
              { accountId, campaignId, budget }
            );

        candidate.classification = relevance.classification;
        candidate.relevanceReason = relevance.reason;
        candidate.competingOffering = relevance.competingOffering;
        candidate.servesBuyerNeed = relevance.servesBuyerNeed;
        candidate.buyerNeedRationale = relevance.buyerNeedRationale;
        candidate.competitorType = relevance.competitorType;
        candidate.monitoredProductUrls = relevance.monitoredProductUrls;
        candidate.geographicClassification = relevance.geographicClassification;
        candidate.geographicReasoning = relevance.geographicReasoning;
        candidate.marketAvailabilityUncertainty = relevance.marketAvailabilityUncertainty;
        candidate.tier = relevance.tier;

        const decision = runCompetitorFinalJudge(
          {
            candidateKey: candidate.candidateKey,
            name: candidate.name,
            domain: candidate.domain,
            websiteUrl: candidate.websiteUrl,
            evidenceText: candidate.occurrences.map((o) => o.rawSnippet).join(" "),
            storefronts: candidate.storefronts,
          },
          identity,
          relevance,
          { offeringName, targetMarket },
          { accountId, budget }
        );

        candidate.judgeVerdict = decision.verdict;
        candidate.judgeReason = decision.finalReason;
        candidate.strategicRole = decision.strategicRole;
        candidate.tier = decision.tier;
        candidate.geographicClassification = decision.geographicClassification;
        candidate.marketAvailabilityUncertainty =
          decision.marketAvailabilityUncertainty || candidate.marketAvailabilityUncertainty;
        candidate.dataReuseStatus =
          decision.verdict === "REJECTED"
            ? "EXCLUDED_IRRELEVANT_OR_STALE"
            : reusedCrossCampaignIdentity || !!cached
              ? "REVALIDATED"
              : "NEWLY_ACQUIRED";
        candidate.selected = preservedSelectionMap.has(key)
          ? preservedSelectionMap.get(key)
          : decision.verdict === "APPROVED";

        evaluatedCache.set(key, candidate);
        return candidate;
      })
    );
  }

  // 4. Plan and Execute Round 1 (or Incremental Continuation Round)
  const plannedMissions = await planDiscoveryMissions(
    contextData,
    budget,
    resumeSession ? (options.minParallelMissions || 3) : (options.minParallelMissions || 4),
    resumeSession ? (options.maxParallelMissions || 5) : (options.maxParallelMissions || 7),
    existingQueries
  );

  accumulatedMissions.push(...plannedMissions);
  plannedMissions.forEach((m) => existingQueries.add(m.query.toLowerCase().trim()));

  const round1Provenances = await runMissions(plannedMissions);
  accumulatedProvenances.push(...round1Provenances);

  let candidates = aggregateCandidates(accumulatedProvenances, website?.rootUrl);
  candidates = await evaluateCandidateSetIncrementally(candidates);

  // 5. Contextual Bounded Follow-Up Round (only when initial discovery found zero direct/relevant competitors and budget permits)
  const approvedAfterRound1 = candidates.filter((c) => c.judgeVerdict === "APPROVED");
  const directAfterRound1 = approvedAfterRound1.filter(
    (c) => c.classification === "DIRECT_COMPETITOR" || c.classification === "RELEVANT_COMPETITOR"
  );

  if (!resumeSession && directAfterRound1.length === 0 && budget.canCallProvider()) {
    contextData.alreadyDiscoveredSummary = approvedAfterRound1.map(
      (c) => `${c.name} (${c.domain}): ${c.classification} / ${c.geographicClassification}`
    );
    contextData.remainingEvidenceGaps = [
      `Round 1 found ${approvedAfterRound1.length} approved competitor(s) but 0 direct category matches for ${offeringName}. Search specifically for direct ${offeringName} (${category}) platforms, services, or providers serving ${targetMarket} or online buyers.`,
    ];
    contextData.mentionedLeadsToVerify = Array.from(mentionedLeadsSet).slice(0, 8);

    const round2Missions = await planDiscoveryMissions(
      contextData,
      budget,
      2,
      4,
      existingQueries
    );

    if (round2Missions.length > 0) {
      accumulatedMissions.push(...round2Missions);
      round2Missions.forEach((m) => existingQueries.add(m.query.toLowerCase().trim()));

      const round2Provenances = await runMissions(round2Missions);
      accumulatedProvenances.push(...round2Provenances);

      candidates = aggregateCandidates(accumulatedProvenances, website?.rootUrl);
      candidates = await evaluateCandidateSetIncrementally(candidates);
    }
  }

  // 6. Group into cohorts — keeping competitive relevance separate from market availability!
  const localCandidates = candidates.filter(
    (c) => c.judgeVerdict === "APPROVED" && c.geographicClassification === "LOCAL_MARKET"
  );
  const crossBorderCandidates = candidates.filter(
    (c) => c.judgeVerdict === "APPROVED" && c.geographicClassification === "CROSS_BORDER_SERVING_MARKET"
  );
  const unverifiedMarketCandidates = candidates.filter(
    (c) =>
      c.judgeVerdict === "APPROVED" &&
      (!c.geographicClassification || c.geographicClassification === "UNVERIFIED")
  );
  const internationalReferenceCandidates = candidates.filter(
    (c) => c.judgeVerdict === "APPROVED" && c.geographicClassification === "INTERNATIONAL_REFERENCE"
  );
  const pendingVerificationCandidates = candidates.filter(
    (c) => c.judgeVerdict === "INSUFFICIENT_EVIDENCE"
  );
  const rejectedCandidates = candidates.filter((c) => c.judgeVerdict === "REJECTED");

  // CRITICAL: Never drop approved relevant competitors whose market availability is UNVERIFIED!
  const approvedCandidates = [
    ...localCandidates,
    ...crossBorderCandidates,
    ...unverifiedMarketCandidates,
    ...internationalReferenceCandidates,
  ];

  // 7. Context Drift Guard
  if (!options.skipPersistence) {
    const contextCheck = await verifyPinnedDiscoveryContextStillCurrent(pinned);
    if (!contextCheck.valid) {
      throw new Error("[CompetitorDiscoveryEngine] Pinned context drift detected mid-run: " + contextCheck.reason);
    }
  }

  // 8. Canonical Onboarding if requested
  const onboardedList: Array<{
    id: string;
    name: string;
    websiteUrl: string;
    tier: CompetitorTier;
    isExisting: boolean;
  }> = [];

  if (autoOnboardApproved && approvedCandidates.length > 0 && !options.skipPersistence) {
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
        console.warn("[CompetitorDiscovery] Canonical onboarding error for " + appComp.name + ":", onboardErr.message);
      }
    }
  }

  // 9. Shared Contextual Readiness Evaluation (replaces universal 10-local-competitor rule)
  const providerUnavailable =
    budget.providerCallsMade > 0 &&
    budget.providerErrors >= budget.providerCallsMade &&
    approvedCandidates.length === 0;

  const readiness = await evaluateCompetitorDiscoveryReadiness(
    {
      hasCanonicalBusinessUnderstanding: true,
      hasConfirmedOffering: true,
      contextCompatible: true,
      providerUnavailable,
      providerErrorCount: budget.providerErrors,
      emptyResultMissionCount: budget.emptyResultMissions,
      budgetExhausted: budget.budgetExhausted,
      businessName,
      offeringName,
      category,
      businessModel,
      targetMarket,
      classificationProfile,
      productTruthFacts,
      targetRoles,
      evidenceGaps,
      approvedCandidates,
      selectedDomains: options.selectedDomains,
    },
    {
      accountId,
      recordLlmCall: () => budget.recordLlmCall(),
    }
  );

  const localVerifiedCount = localCandidates.length;
  const isBuildEligible = readiness.canProceed;
  const shortfall = 0;

  let status: CompetitorDiscoveryReport["status"] = "DISCOVERY_COMPLETE";
  if (providerUnavailable) {
    status = "SEARCH_PROVIDER_UNAVAILABLE";
  } else if (approvedCandidates.length === 0) {
    status = "NO_VERIFIED_COMPETITORS";
  } else if (!readiness.canProceed) {
    status = "VERIFIED_COMPETITOR_COUNT_INSUFFICIENT_FOR_BUILD_GATE";
  } else {
    status = "DISCOVERY_COMPLETE";
  }

  const message = readiness.reason;

  const telemetry = {
    missionsPlanned: accumulatedMissions.length,
    missionsExecuted: budget.providerCallsMade,
    providerCallsMade: budget.providerCallsMade,
    llmCallsMade: budget.llmCallsMade,
    totalRuntimeMs: budget.getElapsedMs(),
    providerErrors: budget.providerErrors,
    emptyResultMissions: budget.emptyResultMissions,
    budgetExhausted: budget.budgetExhausted,
    reusedCandidatesCount: budget.reusedCandidatesCount,
    contextCompatible: true,
    readiness,
  };

  // 10. Persist session to competitor_discovery_sessions
  let sessionId = existingSessionId;
  const sessionData = {
    accountId,
    campaignId,
    campaignOfferingId: pinned.campaignOfferingId,
    buSnapshotId: pinned.buSnapshotId,
    pinnedContext: pinned,
    targetMarket,
    status,
    searchMissions: accumulatedMissions,
    candidates,
    localVerifiedCount,
    crossBorderCount: crossBorderCandidates.length,
    internationalReferenceCount: internationalReferenceCandidates.length,
    shortfall,
    isBuildEligible,
    telemetry,
    updatedAt: new Date(),
  };

  if (!options.skipPersistence) {
    try {
      if (existingSessionId) {
        await db
          .update(competitorDiscoverySessions)
          .set(sessionData)
          .where(eq(competitorDiscoverySessions.id, existingSessionId));
      } else {
        const [inserted] = await db
          .insert(competitorDiscoverySessions)
          .values(sessionData)
          .returning({ id: competitorDiscoverySessions.id });
        sessionId = inserted?.id;
      }
    } catch (dbErr: any) {
      console.warn("[CompetitorDiscoveryEngine] Failed to persist discovery session:", dbErr.message);
    }

    try {
      await persistCompetitorRelevanceDecisions({
        accountId,
        campaignId,
        targetMarket,
        offeringName,
        candidates,
      });
    } catch (relErr: any) {
      console.warn("[CompetitorDiscoveryEngine] Failed to persist competitor relevance decisions:", relErr.message);
    }
  }

  return {
    status,
    discoverySessionId: sessionId,
    searchMissions: accumulatedMissions,
    totalOccurrencesDiscovered: accumulatedProvenances.length,
    uniqueCandidateCount: candidates.length,
    approvedCandidates,
    rejectedCandidates,
    insufficientEvidenceCandidates: pendingVerificationCandidates,
    localCandidates,
    crossBorderCandidates,
    internationalReferenceCandidates,
    unverifiedMarketCandidates,
    pendingVerificationCandidates,
    localVerifiedCount,
    requiredLocalCount: 0,
    shortfall,
    isBuildEligible,
    readiness,
    candidates,
    onboardedCompetitors: onboardedList,
    message,
    telemetry,
  };
}

export async function persistCompetitorRelevanceDecisions(params: {
  accountId: string;
  campaignId: string;
  businessId?: string | null;
  productId?: string | null;
  targetMarket: string;
  offeringName: string;
  candidates: DiscoveredCompetitorCandidate[];
}): Promise<void> {
  const { accountId, campaignId, targetMarket, offeringName, candidates } = params;

  let businessId = params.businessId ?? null;
  let productId = params.productId ?? null;
  if (!businessId || !productId) {
    const [campSel] = await db
      .select()
      .from(campaignSelections)
      .where(and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, campaignId)))
      .limit(1);
    if (campSel) {
      businessId = businessId || campSel.businessId || null;
      productId = productId || campSel.productId || null;
    }
  }

  for (const cand of candidates) {
    const domain = cleanDomain(cand.domain || cand.candidateKey || cand.websiteUrl || "");
    if (!domain) continue;

    const decisionId = `crd_${campaignId}_${domain.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 120);
    const verdict =
      cand.judgeVerdict === "APPROVED"
        ? "INCLUDED"
        : cand.judgeVerdict === "INSUFFICIENT_EVIDENCE"
          ? "NEEDS_REVIEW"
          : "EXCLUDED";
    const competitorType =
      cand.competitorType ||
      (verdict === "EXCLUDED"
        ? "EXCLUDED"
        : verdict === "NEEDS_REVIEW"
          ? "INSUFFICIENT_EVIDENCE"
          : cand.classification === "DIRECT_COMPETITOR" || cand.classification === "RELEVANT_COMPETITOR"
            ? "DIRECT"
            : "INDIRECT_SUBSTITUTE");

    const inclusionEvidence = (cand.occurrences || []).slice(0, 6).map((occ) => ({
      url: occ.url,
      title: occ.rawTitle,
      snippet: occ.rawSnippet,
      provider: occ.searchProvider,
      query: occ.searchQuery,
    }));

    const monitoredProductUrls =
      Array.isArray(cand.monitoredProductUrls) && cand.monitoredProductUrls.length > 0
        ? cand.monitoredProductUrls
        : Array.from(
            new Set(
              (cand.occurrences || [])
                .map((o) => o.url)
                .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
            )
          );

    const unknownsAndGaps: string[] = [];
    if (cand.marketAvailabilityUncertainty) {
      unknownsAndGaps.push(cand.marketAvailabilityUncertainty);
    }
    if (cand.judgeVerdict === "INSUFFICIENT_EVIDENCE" && cand.judgeReason) {
      unknownsAndGaps.push(cand.judgeReason);
    }

    const rowData = {
      accountId,
      businessId,
      productId,
      campaignId,
      competitorId: cand.canonicalCompetitorId || null,
      candidateDomain: domain,
      candidateName: cand.name || domain,
      competingOffering:
        cand.competingOffering || (verdict === "INCLUDED" ? offeringName : "NONE"),
      servesBuyerNeed:
        typeof cand.servesBuyerNeed === "boolean"
          ? cand.servesBuyerNeed
          : verdict === "INCLUDED",
      buyerNeedRationale:
        cand.buyerNeedRationale || cand.relevanceReason || cand.judgeReason || "",
      targetMarket,
      targetMarketRelevance:
        cand.geographicClassification || "UNVERIFIED",
      competitorType,
      decisionVerdict: verdict,
      inclusionEvidence,
      unknownsAndGaps,
      exclusionReason:
        verdict === "EXCLUDED"
          ? cand.judgeReason || cand.relevanceReason || "Excluded by relevance verification."
          : null,
      dataReuseStatus: cand.dataReuseStatus || "NEWLY_ACQUIRED",
      monitoredProductUrls,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: competitorRelevanceDecisions.id })
      .from(competitorRelevanceDecisions)
      .where(
        and(
          eq(competitorRelevanceDecisions.campaignId, campaignId),
          eq(competitorRelevanceDecisions.candidateDomain, domain)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(competitorRelevanceDecisions)
        .set(rowData)
        .where(eq(competitorRelevanceDecisions.id, existing.id));
    } else {
      await db.insert(competitorRelevanceDecisions).values({
        id: decisionId,
        ...rowData,
      });
    }
  }
}
