import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  marketVoiceDiscoveryJobs,
  marketVoiceSearchIntents,
  campaignOfferings,
  offeringInputEvidence,
  businessUnderstandingSnapshots,
  growthCampaigns,
  businessDataLayer,
} from "@shared/schema";
import {
  MIN_SEARCH_INTENTS_PER_JOB,
  DEFAULT_MAX_SEARCH_INTENTS_PER_JOB,
  generateDiscoveryJobId,
  generateSearchIntentId,
  type MarketVoicePlannerContext,
  type SearchIntentCategory,
  type SearchIntentPlatform,
  type SearchIntentDraft,
  type SearchPlanPackage,
  type SearchPlanJudgeDecision,
  type SearchPlanJudgeReport,
  type SearchPlanValidationResult,
} from "@shared/contracts/market-voice";
import { aiChat, resolveModelForTier } from "../ai-client";

export const ALLOWED_INTENT_CATEGORIES: SearchIntentCategory[] = [
  "CUSTOMER_DISCUSSION",
  "CUSTOMER_EXPERIENCE",
  "CUSTOMER_QUESTION",
  "PRODUCT_REVIEW",
  "COMPARISON",
  "RECOMMENDATION",
  "CATEGORY_DISCUSSION",
  "COMPETITOR_DISCOVERY",
];

export const ALLOWED_PLATFORMS: SearchIntentPlatform[] = [
  "GOOGLE_SEARCH",
  "REDDIT",
  "WEB_FORUMS",
];

export class SearchPlanSchemaError extends Error {
  public errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "SearchPlanSchemaError";
    this.errors = errors;
  }
}

/**
 * Detects whether an offering name is a generic placeholder/season label rather than a precise Hero Product.
 */
export function isWeakOfferingLabel(name: string): boolean {
  if (!name || name.trim().length === 0) return true;
  const normalized = name.trim().toLowerCase();
  const weakExact = [
    "summer",
    "winter",
    "spring",
    "fall",
    "autumn",
    "product",
    "general",
    "campaign",
    "campaign 1",
    "offering",
    "offering 1",
    "test",
    "demo",
    "sample",
    "item",
    "default",
    "general commerce",
  ];
  if (weakExact.includes(normalized)) return true;
  if (/^campaign\s*\d+$/i.test(normalized)) return true;
  if (/^offering\s*\d+$/i.test(normalized)) return true;
  return false;
}

/**
 * Strict production schema validator for Search Planner LLM output.
 * Rejects invalid enums, missing fields, or malformed market scopes without silent fallbacks.
 */
export function validateSearchPlanDraft(
  parsed: any,
  context: MarketVoicePlannerContext
): SearchPlanValidationResult {
  const errors: string[] = [];

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, errors: ["MALFORMED_PLAN: Root JSON is not an object"] };
  }

  if (!parsed.intents || !Array.isArray(parsed.intents) || parsed.intents.length === 0) {
    return { valid: false, errors: ["EMPTY_INTENTS: Planner generated zero search intents"] };
  }

  const validIntents: SearchIntentDraft[] = [];

  for (let idx = 0; idx < parsed.intents.length; idx++) {
    const item = parsed.intents[idx];
    const prefix = `Intent #${idx + 1}`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${prefix}: Intent draft is not an object`);
      continue;
    }

    // 1. intentCategory validation
    if (!item.intentCategory || !ALLOWED_INTENT_CATEGORIES.includes(item.intentCategory)) {
      errors.push(`${prefix}: INVALID_INTENT_CATEGORY "${item.intentCategory}". Allowed categories: ${ALLOWED_INTENT_CATEGORIES.join(", ")}`);
    }

    // 2. targetPlatform validation
    if (!item.targetPlatform || !ALLOWED_PLATFORMS.includes(item.targetPlatform)) {
      errors.push(`${prefix}: INVALID_PLATFORM "${item.targetPlatform}". Allowed platforms: ${ALLOWED_PLATFORMS.join(", ")}`);
    }

    // 3. marketScope & targetGeography validation
    if (item.marketScope !== "TARGET_MARKET" && item.marketScope !== "GLOBAL_CATEGORY") {
      errors.push(`${prefix}: INVALID_MARKET_SCOPE "${item.marketScope}". Must be TARGET_MARKET or GLOBAL_CATEGORY`);
    } else if (item.marketScope === "TARGET_MARKET") {
      const geo = item.targetGeography ? String(item.targetGeography).trim() : (context.targetMarketGeography || null);
      if (!geo) {
        errors.push(`${prefix}: MISSING_TARGET_GEOGRAPHY for TARGET_MARKET scope`);
      }
    } else if (item.marketScope === "GLOBAL_CATEGORY") {
      if (item.targetGeography !== null && item.targetGeography !== undefined && String(item.targetGeography).trim() !== "") {
        errors.push(`${prefix}: INVALID_GLOBAL_GEOGRAPHY - targetGeography must be null for GLOBAL_CATEGORY scope`);
      }
    }

    // 4. query validation
    const query = typeof item.query === "string" ? item.query.trim() : "";
    if (!query || query.length < 3) {
      errors.push(`${prefix}: MISSING_QUERY - query must be a non-empty string of at least 3 characters`);
    }

    // 5. metadata validation
    const reasonForSearch = typeof item.reasonForSearch === "string" ? item.reasonForSearch.trim() : "";
    if (!reasonForSearch) {
      errors.push(`${prefix}: MISSING_METADATA - reasonForSearch is required`);
    }

    const discoveryGoal = typeof item.discoveryGoal === "string" ? item.discoveryGoal.trim() : "";
    if (!discoveryGoal) {
      errors.push(`${prefix}: MISSING_METADATA - discoveryGoal is required`);
    }

    const languageHint = item.languageHint && typeof item.languageHint === "string" ? item.languageHint.trim() : null;

    if (
      ALLOWED_INTENT_CATEGORIES.includes(item.intentCategory) &&
      ALLOWED_PLATFORMS.includes(item.targetPlatform) &&
      (item.marketScope === "TARGET_MARKET" || item.marketScope === "GLOBAL_CATEGORY") &&
      query.length >= 3 &&
      reasonForSearch &&
      discoveryGoal &&
      ((item.marketScope === "TARGET_MARKET" && (item.targetGeography || context.targetMarketGeography)) ||
       (item.marketScope === "GLOBAL_CATEGORY" && (!item.targetGeography || item.targetGeography === null)))
    ) {
      validIntents.push({
        intentCategory: item.intentCategory,
        query,
        targetPlatform: item.targetPlatform,
        marketScope: item.marketScope,
        targetGeography: item.marketScope === "TARGET_MARKET" ? (item.targetGeography ? String(item.targetGeography).trim() : (context.targetMarketGeography || null)) : null,
        languageHint,
        reasonForSearch,
        discoveryGoal,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], intents: validIntents };
}

/**
 * Loads canonical campaign context for search planning from persisted authorities.
 * Strictly uses persisted Hero Product truth without semantic reconstruction or concatenation.
export interface LoadMarketVoicePlannerContextOptions {
  campaignId: string;
  campaignOfferingId: string;
  accountId?: string;
}

/**
 * Loads canonical campaign context for search planning from persisted authorities.
 * Strictly uses persisted Hero Product truth without semantic reconstruction or concatenation.
 * Fails closed with PLANNER_CONTEXT_INCOMPLETE if Hero Product is missing or incomplete.
 */
export async function loadMarketVoicePlannerContext(
  campaignIdOrOptions: string | LoadMarketVoicePlannerContextOptions,
  maybeCampaignOfferingId?: string,
  maybeExplicitAccountId?: string
): Promise<MarketVoicePlannerContext> {
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentYear = now.getFullYear();

  let campaignId: string;
  let campaignOfferingId: string;
  let explicitAccountId: string | undefined;

  if (typeof campaignIdOrOptions === "object" && campaignIdOrOptions !== null) {
    campaignId = campaignIdOrOptions.campaignId;
    campaignOfferingId = campaignIdOrOptions.campaignOfferingId;
    explicitAccountId = campaignIdOrOptions.accountId;
  } else {
    campaignId = campaignIdOrOptions;
    campaignOfferingId = maybeCampaignOfferingId!;
    explicitAccountId = maybeExplicitAccountId;
  }

  if (!campaignId || !campaignOfferingId) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: campaignId and campaignOfferingId are required for context resolution.`
    );
  }

  // 1. Fetch offering authority record
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(eq(campaignOfferings.id, campaignOfferingId), eq(campaignOfferings.campaignId, campaignId)));

  if (!offering) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Canonical offering not found for offeringId=${campaignOfferingId} campaignId=${campaignId}`
    );
  }

  // 1b. Verify structured USER_CONFIRMED authority and strict composite foreign key lineage from offering_input_evidence
  if (!offering.sourceInputEvidenceId) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Canonical offering ${campaignOfferingId} lacks sourceInputEvidenceId reference.`
    );
  }

  const [evidence] = await db
    .select()
    .from(offeringInputEvidence)
    .where(eq(offeringInputEvidence.id, offering.sourceInputEvidenceId));

  if (!evidence) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Source input evidence ${offering.sourceInputEvidenceId} not found for offeringId=${campaignOfferingId}.`
    );
  }

  // Strict lineage checks
  if (
    evidence.accountId !== offering.accountId ||
    evidence.campaignId !== offering.campaignId ||
    evidence.campaignOfferingId !== offering.id ||
    offering.campaignId !== campaignId ||
    offering.id !== campaignOfferingId
  ) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Lineage mismatch between offering_input_evidence and campaign_offerings for offeringId=${campaignOfferingId}.`
    );
  }

  // Strict structured authorityType check: Must be USER_CONFIRMED
  if (evidence.authorityType !== "USER_CONFIRMED") {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Canonical Hero Product lacks USER_CONFIRMED authority (found authority_type="${evidence.authorityType || "UNKNOWN"}") for offeringId=${campaignOfferingId}.`
    );
  }

  const accountId = explicitAccountId || offering.accountId;

  // 2. Fetch Business Understanding Snapshot matching current canonical offering
  const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
  const buRes = await resolveCurrentBusinessUnderstanding({
    accountId,
    campaignId,
    campaignOfferingId,
  });
  const buSnapshot = buRes ? buRes.snapshotRow : (await db
    .select()
    .from(businessUnderstandingSnapshots)
    .where(
      and(
        eq(businessUnderstandingSnapshots.campaignId, campaignId),
        eq(businessUnderstandingSnapshots.status, "COMPLETE")
      )
    )
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1))[0];

  // 3. Fetch campaign selections (for location/geography)
  let selection: any = null;
  try {
    const selRes = await db.execute(
      sql`SELECT * FROM campaign_selections WHERE selected_campaign_id = ${campaignId} LIMIT 1`
    );
    selection = selRes.rows[0];
  } catch (e) {}

  // 4. Fetch growthCampaigns & businessDataLayer if available
  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const [bdl] = await db
    .select()
    .from(businessDataLayer)
    .where(eq(businessDataLayer.accountId, accountId))
    .limit(1);

  const productAnchor = campaign?.productAnchor as any;
  const bu = (buSnapshot?.businessUnderstandingSnapshot || buSnapshot?.businessUnderstanding || (buSnapshot as any)?.snapshotData) as any;
  const buOffering = bu?.offeringUnderstanding || bu?.campaignOffering;
  const buTarget = bu?.targetUnderstanding;

  const category =
    buOffering?.category ||
    bu?.generalIndustry ||
    bu?.industry ||
    bdl?.industry ||
    (productAnchor?.type as string) ||
    null;

  let targetMarketGeography =
    selection?.campaign_location ||
    bdl?.geographicFocus ||
    (productAnchor?.targetGeography as string) ||
    null;

  if (targetMarketGeography) {
    const geoNorm = String(targetMarketGeography).trim().toLowerCase();
    if (geoNorm === "lebanon" || geoNorm === "lb") {
      targetMarketGeography = "LB";
    }
  }

  // Canonical Hero Product Resolution: NO SEMANTIC RECONSTRUCTION
  // Resolve exact persisted authority record and field
  const heroProductCanonicalText = offering.offeringName ? offering.offeringName.trim() : "";
  const heroProductAuthoritySource = "campaign_offerings";
  const heroProductAuthorityId = offering.id;

  // Secondary text quality guard: fail closed if weak/empty
  if (!heroProductCanonicalText || isWeakOfferingLabel(heroProductCanonicalText)) {
    throw new Error(
      `[SearchPlanner] PLANNER_CONTEXT_INCOMPLETE: Canonical Hero Product is missing or incomplete ("${heroProductCanonicalText || "undefined"}") for offeringId=${campaignOfferingId}. A user-confirmed canonical Hero Product is required.`
    );
  }

  const businessName =
    bu?.businessName ||
    bdl?.businessName ||
    (selection?.selected_campaign_name
      ? String(selection.selected_campaign_name).replace(/\s+Campaign$/i, "")
      : undefined);

  const targetAudience =
    buTarget?.targetRoles?.[0]?.roleTitle ||
    bdl?.targetAudience ||
    undefined;

  return {
    accountId,
    campaignId,
    campaignOfferingId: offering.id,
    offeringName: heroProductCanonicalText,
    heroProductCanonicalText,
    heroProductAuthoritySource,
    heroProductAuthorityId,
    category,
    targetMarketGeography,
    currentDate,
    currentYear,
    businessUnderstanding: {
      businessName,
      industry: category || undefined,
      coreOffering: heroProductCanonicalText,
      targetAudience,
      geographicFocus: targetMarketGeography || undefined,
    },
    productAnchor: productAnchor
      ? {
          name: productAnchor.name,
          type: productAnchor.type,
          keyAttributes: productAnchor.keyAttributes,
          problemSolved: productAnchor.problemSolved,
          uniqueMechanism: productAnchor.uniqueMechanism,
          differentiatingFeature: productAnchor.differentiatingFeature,
        }
      : null,
    maxIntentsPerJob: DEFAULT_MAX_SEARCH_INTENTS_PER_JOB,
  };
}

export function buildSearchPlannerPrompt(
  context: MarketVoicePlannerContext,
  repairInstructions?: string
): { system: string; user: string } {
  if (!context.heroProductCanonicalText || isWeakOfferingLabel(context.heroProductCanonicalText)) {
    throw new Error(
      `[SearchPlanner] FAIL-CLOSED: CANONICAL_HERO_PRODUCT_REQUIRED. Prompt assembly requires a valid canonical Hero Product.`
    );
  }

  const currentYear = context.currentYear || new Date().getFullYear();
  const currentDate = context.currentDate || new Date().toISOString().slice(0, 10);
  const minIntents = MIN_SEARCH_INTENTS_PER_JOB;
  const maxIntents = context.maxIntentsPerJob || DEFAULT_MAX_SEARCH_INTENTS_PER_JOB;

  const system = `You are the Avyron Market Voice Search Planner.
Your purpose is to plan WHERE to search across the web and communities to discover real customer voice and discover real commercial competitors in the market.

CURRENT RUNTIME CONTEXT:
- Execution Date: ${currentDate}
- Current Year: ${currentYear}
- Canonical Hero Product: ${context.heroProductCanonicalText}
- Hero Product Authority: ${context.heroProductAuthoritySource} (${context.heroProductAuthorityId})
- Category / Industry: ${context.category || "Unspecified"}
- Target Market Geography: ${context.targetMarketGeography || "Global / Unspecified"}

CORE CONSTITUTIONAL INVARIANTS:
1. STRICT NEUTRALITY: You discover where customers talk, what they ask, and what real buyers experience in the market. You DO NOT pre-judge or assume what they hate, struggle with, or complain about.
   - FORBIDDEN: Do NOT include pre-decided pain queries like "why customers hate [X]", "pricing problems with [X]", "bad quality [X]", or "[X] returns and fit complaints".
   - REQUIRED: Natural, unbiased search queries like "customer discussions on [X]", "recommendations for [X]", "[X] fabric wear review", "buying advice for [X]".
2. OFFERING SPECIFICITY (CRITICAL):
   - Queries MUST be specifically relevant to the canonical Hero Product: "${context.heroProductCanonicalText}"${context.category ? ` and Category: "${context.category}"` : ""}.
   - FORBIDDEN: Do NOT generate generic queries that drift into broad, unrelated concepts (e.g. DO NOT produce "best summer products", "summer shopping", "general retail deals").
   - REQUIRED: Ground queries in the actual product type (e.g. "summer modest dresses", "modest dresses fabric breathable review", "hijabi summer outfits styling").
3. TEMPORAL RELEVANCE & FRESHNESS:
   - This is a current-market discovery run for ${currentYear}.
   - FORBIDDEN: Do NOT include stale historical years (e.g. 2023, 2024, etc.) in search queries.
   - Natural timeless queries (e.g. "modest summer dresses reviews", "summer hijabi clothing reddit") or queries referencing current trends (${currentYear}) are valid.
4. DUAL MARKET SCOPE REPRESENTATION:
   ${context.targetMarketGeography ? `- When target market exists ("${context.targetMarketGeography}"):
     - Produce representation for BOTH "TARGET_MARKET" (at least 2-3 queries with targetGeography: "${context.targetMarketGeography}") AND "GLOBAL_CATEGORY" (at least 2-3 queries with targetGeography: null).
     - TARGET_MARKET queries must focus specifically on customer discussions, shopping experiences, recommendations, or community questions in "${context.targetMarketGeography}".
     - GLOBAL_CATEGORY queries seek global category-wide customer voice, reviews, and discussions without geographic restriction.` : `- Produce category-wide "GLOBAL_CATEGORY" queries with targetGeography: null.`}
5. CUSTOMER-AUTHORED VOICE RETRIEVAL FOCUS (CRITICAL):
   - Market Voice discovery is specifically designed to retrieve CUSTOMER-AUTHORED and PROSPECTIVE-BUYER discussions, reviews, recommendations, complaints, sizing/fit questions, and firsthand experiences.
   - FORBIDDEN: Do NOT generate commercial store/merchant discovery queries (e.g. DO NOT produce "clothing stores in [market]", "top brands to shop from", "where to buy online stores"). Commercial competitor discovery is a separate frozen engine.
   - REQUIRED: Generate queries targeting discussion threads, forum topics, buyer wear tests, reddit advice threads, and customer feedback.
6. INTENT CATEGORY TO DISCOVERY GOAL ALIGNMENT:
   - CUSTOMER_DISCUSSION: Community discussion topics & advice threads (e.g. "customer discussions on summer modest dresses", "modest dresses styling advice reddit").
   - CUSTOMER_EXPERIENCE: Firsthand buyer experience & wear feedback (e.g. "firsthand experiences wearing linen modest dresses in summer heat").
   - CUSTOMER_QUESTION: Pre-purchase buyer questions & sizing/styling advice (e.g. "questions about modest dress fabrics transparency").
   - PRODUCT_REVIEW: Customer reviews, unboxings, wear feedback (e.g. "summer modest dresses customer reviews wear test", "linen dresses feedback").
   - RECOMMENDATION: Seeking buying recommendations / advice from shoppers (e.g. "best summer modest dresses recommendations from shoppers").
   - COMPARISON: Product, material, or fit comparisons (e.g. "linen vs chiffon modest dresses summer comfort").
   - CATEGORY_DISCUSSION: Industry trend and fabric/style community discussions (e.g. "trends in modest summer dresses ${currentYear} discussion").
7. ALLOWED PLATFORMS: GOOGLE_SEARCH, REDDIT, WEB_FORUMS. Distribute queries across these platforms only. DO NOT use social media platforms (INSTAGRAM, TIKTOK, YOUTUBE_SEARCH) for broad market voice discovery.
8. PACKAGE BUDGET: Produce between 8 and 10 high-diversity search intents.
9. NO DETERMINISTIC FALLBACKS: Produce authentic natural search queries suited for real web/community search engines.

Return ONLY valid JSON matching this exact TypeScript structure:
{
  "plannerRationale": "string explaining the discovery strategy",
  "intents": [
    {
      "intentCategory": "CUSTOMER_DISCUSSION" | "CUSTOMER_EXPERIENCE" | "CUSTOMER_QUESTION" | "PRODUCT_REVIEW" | "COMPARISON" | "RECOMMENDATION" | "CATEGORY_DISCUSSION",
      "query": "string (natural search query targeting customer voice for the Hero Product)",
      "targetPlatform": "GOOGLE_SEARCH" | "REDDIT" | "WEB_FORUMS",
      "marketScope": "TARGET_MARKET" | "GLOBAL_CATEGORY",
      "targetGeography": "string or null",
      "languageHint": "en | ar | fr | string or null",
      "reasonForSearch": "short explanation of why this query discovers customer voice",
      "discoveryGoal": "what kind of customer evidence this query is designed to find"
    }
  ]
}`;

  const user = `CAMPAIGN OFFERING CONTEXT:
- Account ID: ${context.accountId}
- Campaign ID: ${context.campaignId}
- Campaign Offering ID: ${context.campaignOfferingId}
- Canonical Hero Product: ${context.heroProductCanonicalText} (Authority: ${context.heroProductAuthoritySource} / ${context.heroProductAuthorityId})
- Category / Industry: ${context.category || "Unspecified"}
- Target Market Geography: ${context.targetMarketGeography || "Global / Unspecified"}
- Execution Date: ${currentDate} (Year: ${currentYear})
- Business Details: ${JSON.stringify(context.businessUnderstanding || {})}
- Product Anchor / DNA: ${JSON.stringify(context.productAnchor || {})}

${repairInstructions ? `\nCRITICAL REPAIR INSTRUCTIONS FROM PREVIOUS AUDIT:\n${repairInstructions}\n` : ""}

Generate the bounded neutral search intent package now with 8 to 10 intents.`;

  return { system, user };
}

/**
 * Generates candidate search plan using LLM.
 */
export async function generateSearchPlanWithLLM(
  context: MarketVoicePlannerContext,
  discoveryJobId: string,
  repairInstructions?: string
): Promise<SearchPlanPackage> {
  const { system, user } = buildSearchPlannerPrompt(context, repairInstructions);

  const response = await aiChat({
    model: resolveModelForTier("HIGH_CAPABILITY"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 3000,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new SearchPlanSchemaError("Empty response received from LLM planner", ["EMPTY_LLM_RESPONSE"]);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    throw new SearchPlanSchemaError(`Failed to parse JSON response from LLM: ${err.message}`, ["INVALID_JSON"]);
  }

  const validation = validateSearchPlanDraft(parsed, context);
  if (!validation.valid || !validation.intents || validation.intents.length === 0) {
    throw new SearchPlanSchemaError(
      `Search plan failed schema validation: ${validation.errors.join("; ")}`,
      validation.errors
    );
  }

  return {
    discoveryJobId,
    accountId: context.accountId,
    campaignId: context.campaignId,
    campaignOfferingId: context.campaignOfferingId,
    intents: validation.intents,
    plannerRationale: String(parsed.plannerRationale || "Search plan for market voice discovery"),
  };
}

/**
 * Hostile Semantic Judge for Search Plan Packages.
 */
export async function judgeSearchPlanWithLLM(
  context: MarketVoicePlannerContext,
  packageDraft: SearchPlanPackage
): Promise<SearchPlanJudgeReport> {
  const maxBudget = context.maxIntentsPerJob || DEFAULT_MAX_SEARCH_INTENTS_PER_JOB;
  const budgetValid = packageDraft.intents.length <= maxBudget && packageDraft.intents.length >= MIN_SEARCH_INTENTS_PER_JOB;
  const currentYear = context.currentYear || new Date().getFullYear();
  const currentDate = context.currentDate || new Date().toISOString().slice(0, 10);

  const candidatePayload = packageDraft.intents.map((intent, idx) => ({
    candidateKey: `intent_${idx + 1}`,
    intentCategory: intent.intentCategory,
    query: intent.query,
    targetPlatform: intent.targetPlatform,
    marketScope: intent.marketScope,
    targetGeography: intent.targetGeography,
    reasonForSearch: intent.reasonForSearch,
    discoveryGoal: intent.discoveryGoal,
  }));

  if (!context.heroProductCanonicalText || isWeakOfferingLabel(context.heroProductCanonicalText)) {
    throw new Error(
      `[SearchPlanner] FAIL-CLOSED: CANONICAL_HERO_PRODUCT_REQUIRED. Judge prompt assembly requires a valid canonical Hero Product.`
    );
  }

  const system = `You are the Hostile Search Plan Judge for Avyron Market Voice.
Your mission is to rigorously evaluate candidate search intents before they are allowed into the discovery pipeline.

CURRENT RUNTIME CONTEXT:
- Execution Date: ${currentDate}
- Current Year: ${currentYear}
- Canonical Hero Product: ${context.heroProductCanonicalText}
- Hero Product Authority: ${context.heroProductAuthoritySource} (${context.heroProductAuthorityId})
- Category / Industry: ${context.category || "Unspecified"}
- Target Market Geography: ${context.targetMarketGeography || "Global / None"}

EVALUATION CRITERIA:
1. RELEVANCE & OFFERING SPECIFICITY:
   - Does the search query specifically relate to the canonical offering "${context.heroProductCanonicalText}"${context.category ? ` (${context.category})` : ""}?
   - REJECT generic queries that drift away from the specific offering (e.g. "summer products", "stuff to buy", "general accessories").
   - Set offeringSpecificity: true ONLY if the query is specifically about the offering or its category.
2. TEMPORAL RELEVANCE & FRESHNESS:
   - Is the query temporally fresh for ${currentYear}?
   - REJECT queries containing stale past years (e.g. 2023, 2024, etc.) unless explicitly historical.
   - Queries without years (e.g. "modest summer dresses reviews") are FRESH and VALID.
   - Set temporalRelevance: false if query has a stale year.
3. NEUTRALITY:
   - Does the query remain neutral and unbiased?
   - REJECT any query that pre-assumes customer complaints, defects, pricing friction, return issues, or poor quality (e.g. "why is [product] so expensive", "problems with [product]").
   - APPROVE queries that search for open customer discussions, reviews, recommendations, comparisons, and experiences.
4. DIVERSITY:
   - Are the queries meaningfully diverse across platforms, angles, and categories rather than repetitive rephrasings of the same search?
5. INTENT CATEGORY FIT (CRITICAL):
   - Does intentCategory accurately represent what the query is attempting to discover?
   - Brand / store / boutique / seller discovery queries MUST have intentCategory = "COMPETITOR_DISCOVERY".
   - Customer feedback / video wear reviews / try-ons MUST have intentCategory = "PRODUCT_REVIEW".
   - Shopper advice seeking / best suggestions MUST have intentCategory = "RECOMMENDATION".
   - Forum / community conversations MUST have intentCategory = "CUSTOMER_DISCUSSION".
   - Firsthand user experience reports MUST have intentCategory = "CUSTOMER_EXPERIENCE".
   - Pre-purchase buyer inquiries / questions MUST have intentCategory = "CUSTOMER_QUESTION".
   - Comparisons between fabrics/styles MUST have intentCategory = "COMPARISON".
   - Trend and material discussions MUST have intentCategory = "CATEGORY_DISCUSSION".
   - Set intentCategoryFit: true if intentCategory properly aligns with the query goal. Set intentCategoryFit: false and status: "REPAIR_REQUIRED" if miscategorized.
6. DUAL MARKET SCOPE MANDATE (CRITICAL - DO NOT REJECT GLOBAL_CATEGORY):
   - A complete package MUST contain BOTH TARGET_MARKET queries AND GLOBAL_CATEGORY queries.
   - For GLOBAL_CATEGORY queries: marketScope is "GLOBAL_CATEGORY" and targetGeography MUST BE NULL.
     DO NOT REJECT or penalize a GLOBAL_CATEGORY query for not targeting "${context.targetMarketGeography || "local market"}". Global category queries are REQUIRED and intentionally worldwide/non-local.
   - For TARGET_MARKET queries: marketScope is "TARGET_MARKET" and targetGeography MUST match "${context.targetMarketGeography || "LOCAL"}". They must explore the local target market.
7. PLATFORM FIT:
   - Does the platform choice make sense for the search goal (e.g. REDDIT/WEB_FORUMS for community discussions, GOOGLE_SEARCH for broad queries)? Social media platforms (INSTAGRAM, TIKTOK, YOUTUBE_SEARCH) are strictly FORBIDDEN in broad search and MUST be rejected with platformFit: false.

CRITICAL 1:1 DECISION CONTRACT:
- You MUST evaluate EVERY single candidate intent individually.
- The output "decisions" array MUST contain EXACTLY ${candidatePayload.length} items.
- Each item MUST match the candidateKey ("intent_1", "intent_2", ...) and intentQuery of the candidate intent.
- Do NOT skip, duplicate, or invent decisions.

Return ONLY valid JSON matching this exact structure:
{
  "overallDecision": "APPROVED" | "REPAIR_REQUIRED" | "REJECTED",
  "summary": "concise rationale of the verdict",
  "repairInstructions": "specific instructions if repair is required, or empty string",
  "decisions": [
    {
      "candidateKey": "intent_1",
      "intentQuery": "exact query string",
      "relevance": true | false,
      "offeringSpecificity": true | false,
      "temporalRelevance": true | false,
      "neutrality": true | false,
      "diversity": true | false,
      "marketScopeValid": true | false,
      "platformFit": true | false,
      "intentCategoryFit": true | false,
      "competitorDiscoverySeparation": true | false,
      "status": "APPROVED" | "REPAIR_REQUIRED" | "REJECTED",
      "critique": "brief feedback"
    }
  ]
}`;

  const user = `OFFERING CONTEXT:
- Hero Product: ${context.heroProductCanonicalText}
- Category: ${context.category || "General"}
- Target Market: ${context.targetMarketGeography || "Global"}
- Current Year: ${currentYear}
- Minimum Intents: ${MIN_SEARCH_INTENTS_PER_JOB}
- Max Budget: ${maxBudget}

CANDIDATE SEARCH PLAN (${candidatePayload.length} intents):
${JSON.stringify(candidatePayload, null, 2)}

Evaluate each intent 1:1 and the package as a whole.`;

  const response = await aiChat({
    model: resolveModelForTier("STRATEGIC_REASONING"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 8000,
    response_format: { type: "json_object" },
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: 0,
      decisions: [],
      summary: "JUDGE_OUTPUT_INVALID: Empty response received from Judge LLM",
      repairInstructions: "Judge failed to respond. Re-evaluate search plan package.",
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: any) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: 0,
      decisions: [],
      summary: `JUDGE_OUTPUT_INVALID: Failed to parse Judge JSON response: ${err.message}`,
      repairInstructions: "Judge output was not valid JSON. Re-evaluate search plan package.",
    };
  }

  return parseAndValidateJudgeReport(parsed, packageDraft, maxBudget, context);
}

/**
 * Strict 1:1 validation of Judge output.
 */
export function parseAndValidateJudgeReport(
  parsed: any,
  packageDraft: SearchPlanPackage,
  maxBudget: number,
  context?: MarketVoicePlannerContext
): SearchPlanJudgeReport {
  const budgetValid = packageDraft.intents.length <= maxBudget && packageDraft.intents.length >= MIN_SEARCH_INTENTS_PER_JOB;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: 0,
      decisions: [],
      summary: "JUDGE_OUTPUT_INVALID: Root Judge response is not an object",
      repairInstructions: "Judge must return a valid JSON object.",
    };
  }

  if (!parsed.decisions || !Array.isArray(parsed.decisions)) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: 0,
      decisions: [],
      summary: "JUDGE_OUTPUT_INVALID: decisions array is missing or not an array",
      repairInstructions: "Judge must return a decisions array matching candidate intents 1:1.",
    };
  }

  if (parsed.decisions.length !== packageDraft.intents.length) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: parsed.decisions.length,
      decisions: [],
      summary: `JUDGE_OUTPUT_INVALID: decisions count (${parsed.decisions.length}) does not match candidate intents count (${packageDraft.intents.length})`,
      repairInstructions: "Judge must evaluate every candidate intent with exactly one decision per intent.",
    };
  }

  const seenKeys = new Set<string>();
  const validatedDecisions: SearchPlanJudgeDecision[] = [];
  const allowedStatuses = ["APPROVED", "REPAIR_REQUIRED", "REJECTED"];
  let judgeContractValid = true;
  let contractError = "";

  for (let idx = 0; idx < packageDraft.intents.length; idx++) {
    const expectedKey = `intent_${idx + 1}`;
    const rawDecision = parsed.decisions[idx];
    const intentDraft = packageDraft.intents[idx];

    if (!rawDecision || typeof rawDecision !== "object" || Array.isArray(rawDecision)) {
      judgeContractValid = false;
      contractError = `Decision #${idx + 1} is not an object`;
      break;
    }

    const key = rawDecision.candidateKey || expectedKey;
    if (seenKeys.has(key)) {
      judgeContractValid = false;
      contractError = `Duplicate decision key: ${key}`;
      break;
    }
    seenKeys.add(key);

    if (!allowedStatuses.includes(rawDecision.status)) {
      judgeContractValid = false;
      contractError = `Invalid status in decision ${key}: ${rawDecision.status}`;
      break;
    }

    // 1. Programmatic freshness check against stale years
    const staleYearRegex = /\b(201\d|202[0-5])\b/;
    const hasStaleYear = staleYearRegex.test(intentDraft.query) && !/histor|timeline|archive|retrospective/i.test(intentDraft.query);

    let temporalRelevance = rawDecision.temporalRelevance !== undefined ? Boolean(rawDecision.temporalRelevance) : true;
    if (hasStaleYear) {
      temporalRelevance = false;
    }

    // 2. Offering Specificity check: reject generic queries like "summer products" or "summer shopping" when a specific category exists
    let offeringSpecificity = rawDecision.offeringSpecificity !== undefined 
      ? Boolean(rawDecision.offeringSpecificity) 
      : Boolean(rawDecision.relevance);

    if (/\bsummer (products?|shopping|items?|goods|deals)\b/i.test(intentDraft.query.trim()) && context?.category && !/modest|dress|hijab|abaya|fashion|clothing/i.test(intentDraft.query)) {
      offeringSpecificity = false;
    }

    // 3. Intent Category Fit check
    let intentCategoryFit = rawDecision.intentCategoryFit !== undefined ? Boolean(rawDecision.intentCategoryFit) : true;
    const isBrandDiscoveryQuery = 
      /\b(top|best|popular|leading|new|famous)\b.*\b(brands?|stores?|shops?|boutiques?|labels?|sellers?|companies)\b/i.test(intentDraft.query.trim()) ||
      /\b(alternatives?\s+to|competitors?\s+of|stores?\s+in|boutiques?\s+in|shops?\s+in)\b/i.test(intentDraft.query.trim());

    if (isBrandDiscoveryQuery && intentDraft.intentCategory !== "COMPETITOR_DISCOVERY" && intentDraft.intentCategory !== "RECOMMENDATION") {
      intentCategoryFit = false;
    }

    // 4. Market Scope & Geography check
    let marketScopeValid = true;
    if (intentDraft.marketScope === "TARGET_MARKET") {
      if (!intentDraft.targetGeography) {
        marketScopeValid = false;
      } else if (context?.targetMarketGeography && intentDraft.targetGeography !== context.targetMarketGeography) {
        marketScopeValid = false;
      } else {
        marketScopeValid = rawDecision.marketScopeValid !== undefined ? Boolean(rawDecision.marketScopeValid) : true;
      }
    } else if (intentDraft.marketScope === "GLOBAL_CATEGORY") {
      if (intentDraft.targetGeography !== null && intentDraft.targetGeography !== undefined) {
        marketScopeValid = false;
      } else {
        marketScopeValid = true;
      }
    }

    let status = rawDecision.status;
    let critique = rawDecision.critique ? String(rawDecision.critique) : undefined;

    if (!temporalRelevance) {
      status = "REPAIR_REQUIRED";
      critique = critique ? `${critique}; FRESHNESS_MISMATCH: Stale historical year detected in query` : "FRESHNESS_MISMATCH: Stale historical year detected in query";
    }
    if (!offeringSpecificity) {
      status = "REPAIR_REQUIRED";
      critique = critique ? `${critique}; GENERIC_DRIFT: Query lacks offering specificity` : "GENERIC_DRIFT: Query lacks offering specificity";
    }
    if (!intentCategoryFit) {
      status = "REPAIR_REQUIRED";
      critique = critique ? `${critique}; INTENT_CATEGORY_MISMATCH: Query discovery goal does not match assigned intentCategory` : "INTENT_CATEGORY_MISMATCH: Query discovery goal does not match assigned intentCategory";
    }
    if (!marketScopeValid) {
      status = "REPAIR_REQUIRED";
      critique = critique ? `${critique}; INVALID_SCOPE_GEOGRAPHY: Geography mismatch for market scope` : "INVALID_SCOPE_GEOGRAPHY: Geography mismatch for market scope";
    }

    // Reconcile status if Judge wrongly flagged a valid GLOBAL_CATEGORY query for not targeting the local market
    if (
      (status === "REPAIR_REQUIRED" || status === "REJECTED") &&
      temporalRelevance &&
      offeringSpecificity &&
      intentCategoryFit &&
      marketScopeValid &&
      Boolean(rawDecision.relevance) &&
      Boolean(rawDecision.neutrality) &&
      Boolean(rawDecision.platformFit)
    ) {
      if (
        critique &&
        /market scope is global|should be target_market|does not target the local market|market scope is invalid|local focus/i.test(critique) &&
        intentDraft.marketScope === "GLOBAL_CATEGORY"
      ) {
        status = "APPROVED";
      }
    }

    validatedDecisions.push({
      candidateKey: key,
      intentQuery: String(rawDecision.intentQuery || intentDraft.query),
      relevance: Boolean(rawDecision.relevance),
      offeringSpecificity,
      temporalRelevance,
      neutrality: Boolean(rawDecision.neutrality),
      diversity: Boolean(rawDecision.diversity),
      marketScopeValid,
      platformFit: Boolean(rawDecision.platformFit),
      intentCategoryFit,
      competitorDiscoverySeparation: Boolean(rawDecision.competitorDiscoverySeparation),
      status,
      critique,
    });
  }

  if (!judgeContractValid) {
    return {
      overallDecision: "REPAIR_REQUIRED",
      budgetValid,
      totalIntentsEvaluated: validatedDecisions.length,
      decisions: validatedDecisions,
      summary: `JUDGE_OUTPUT_INVALID: ${contractError}`,
      repairInstructions: "Re-evaluate all candidate search intents ensuring valid 1:1 decision mapping.",
    };
  }

  const approvedDecisions = validatedDecisions.filter(
    (d) => d.status === "APPROVED" && d.neutrality && d.relevance && d.offeringSpecificity && d.temporalRelevance && d.marketScopeValid && d.intentCategoryFit
  );
  const approvedIndices = new Set(
    validatedDecisions
      .map((d, i) => (d.status === "APPROVED" && d.neutrality && d.relevance && d.offeringSpecificity && d.temporalRelevance && d.marketScopeValid && d.intentCategoryFit ? i : -1))
      .filter((i) => i !== -1)
  );
  const approvedIntents = packageDraft.intents.filter((_, i) => approvedIndices.has(i));

  const targetMarketCount = approvedIntents.filter((i) => i.marketScope === "TARGET_MARKET").length;
  const globalCategoryCount = approvedIntents.filter((i) => i.marketScope === "GLOBAL_CATEGORY").length;
  const competitorDiscoveryCount = approvedIntents.filter((i) => i.intentCategory === "COMPETITOR_DISCOVERY").length;

  let packageGateValid = true;
  let packageGateError = "";

  if (approvedDecisions.length < MIN_SEARCH_INTENTS_PER_JOB) {
    packageGateValid = false;
    packageGateError = `INSUFFICIENT_SEARCH_COVERAGE: Package contains only ${approvedDecisions.length} approved search intents (minimum required is ${MIN_SEARCH_INTENTS_PER_JOB}).`;
  } else if (context?.targetMarketGeography) {
    if (targetMarketCount === 0) {
      packageGateValid = false;
      packageGateError = `TARGET_MARKET_REPRESENTATION_MISSING: Package contains 0 approved TARGET_MARKET search intents for target market "${context.targetMarketGeography}".`;
    } else if (globalCategoryCount === 0) {
      packageGateValid = false;
      packageGateError = `GLOBAL_CATEGORY_REPRESENTATION_MISSING: Package contains 0 approved GLOBAL_CATEGORY search intents.`;
    }
  }

  const rejectedCount = validatedDecisions.filter((d) => d.status === "REJECTED" || !d.neutrality || !d.relevance).length;
  const repairCount = validatedDecisions.filter((d) => d.status === "REPAIR_REQUIRED" || !d.offeringSpecificity || !d.temporalRelevance || !d.marketScopeValid || !d.intentCategoryFit).length;

  let overallDecision: "APPROVED" | "REPAIR_REQUIRED" | "REJECTED" = 
    allowedStatuses.includes(parsed.overallDecision) ? parsed.overallDecision : "REPAIR_REQUIRED";

  if (!budgetValid) {
    overallDecision = "REPAIR_REQUIRED";
  } else if (!packageGateValid) {
    overallDecision = "REPAIR_REQUIRED";
  } else if (rejectedCount > validatedDecisions.length / 2) {
    overallDecision = "REJECTED";
  } else if (rejectedCount > 0 || repairCount > 0 || approvedDecisions.length < MIN_SEARCH_INTENTS_PER_JOB) {
    overallDecision = "REPAIR_REQUIRED";
  } else if (overallDecision !== "APPROVED") {
    overallDecision = "APPROVED";
  }

  const summary = !packageGateValid
    ? packageGateError
    : String(parsed.summary || "Search plan package audit completed");

  const repairInstructions = !packageGateValid
    ? `${packageGateError} Generate at least ${MIN_SEARCH_INTENTS_PER_JOB} approved search intents covering TARGET_MARKET, GLOBAL_CATEGORY, and COMPETITOR_DISCOVERY.`
    : (parsed.repairInstructions ? String(parsed.repairInstructions) : undefined);

  return {
    overallDecision,
    budgetValid,
    totalIntentsEvaluated: validatedDecisions.length,
    decisions: validatedDecisions,
    summary,
    repairInstructions,
  };
}

export interface PlanMarketVoiceResult {
  success: boolean;
  job: typeof marketVoiceDiscoveryJobs.$inferSelect;
  intents: Array<typeof marketVoiceSearchIntents.$inferSelect>;
  judgeReport: SearchPlanJudgeReport;
  attempts: number;
}

export async function planMarketVoiceSearchIntents(
  rawContext: MarketVoicePlannerContext,
  options: { maxRetries?: number } = {}
): Promise<PlanMarketVoiceResult> {
  const maxRetries = options.maxRetries ?? 2;

  // 1. Fail-closed context validation & auto-hydration from canonical DB truth
  let context = rawContext;
  if (!context.heroProductCanonicalText || isWeakOfferingLabel(context.heroProductCanonicalText)) {
    if (context.campaignId && context.campaignOfferingId) {
      const hydrated = await loadMarketVoicePlannerContext({
        campaignId: context.campaignId,
        campaignOfferingId: context.campaignOfferingId,
        accountId: context.accountId,
      });
      context = {
        ...hydrated,
        ...context,
        heroProductCanonicalText: hydrated.heroProductCanonicalText,
        heroProductAuthoritySource: hydrated.heroProductAuthoritySource,
        heroProductAuthorityId: hydrated.heroProductAuthorityId,
        offeringName: hydrated.offeringName,
        category: hydrated.category,
        targetMarketGeography: hydrated.targetMarketGeography,
        businessUnderstanding: hydrated.businessUnderstanding,
        productAnchor: hydrated.productAnchor,
      };
    }
  }

  if (!context.heroProductCanonicalText || isWeakOfferingLabel(context.heroProductCanonicalText)) {
    throw new Error(
      `[SearchPlanner] FAIL-CLOSED: CANONICAL_HERO_PRODUCT_REQUIRED. Canonical Hero Product is missing or weak ("${context.heroProductCanonicalText || "undefined"}") for offeringId=${context.campaignOfferingId}. A user-confirmed canonical Hero Product is required.`
    );
  }

  const discoveryJobId = (context as any).discoveryJobId || generateDiscoveryJobId(context.campaignId, context.campaignOfferingId);

  let currentPackage: SearchPlanPackage | null = null;
  let judgeReport: SearchPlanJudgeReport | null = null;
  let repairPrompt: string | undefined = undefined;
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts++;
    try {
      currentPackage = await generateSearchPlanWithLLM(context, discoveryJobId, repairPrompt);
    } catch (err: any) {
      if (err instanceof SearchPlanSchemaError) {
        if (attempts <= maxRetries) {
          repairPrompt = `CRITICAL SCHEMA VALIDATION ERRORS:\n${err.errors.map((e) => `- ${e}`).join("\n")}\nGenerate a corrected search intent package fixing every error listed above.`;
          continue;
        }
      }
      break;
    }

    judgeReport = await judgeSearchPlanWithLLM(context, currentPackage);

    const seenKeys = new Set<string>();
    const uniqueIntents: SearchIntentDraft[] = [];
    for (const intent of currentPackage.intents) {
      const key = `${intent.targetPlatform}:${intent.query.trim().toLowerCase()}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueIntents.push(intent);
      }
    }

    // Budget & Coverage pre-checks on deduplicated package
    const maxBudget = context.maxIntentsPerJob || DEFAULT_MAX_SEARCH_INTENTS_PER_JOB;
    if (uniqueIntents.length > maxBudget) {
      if (attempts <= maxRetries) {
        repairPrompt = `BUDGET_CONTRACT_VIOLATION: Package contains ${uniqueIntents.length} intents which exceeds maximum budget of ${maxBudget}. Reduce intent count to <= ${maxBudget}.`;
        continue;
      }
      break;
    }

    if (uniqueIntents.length < MIN_SEARCH_INTENTS_PER_JOB) {
      if (attempts <= maxRetries) {
        repairPrompt = `INSUFFICIENT_SEARCH_COVERAGE: Deduplicated package contains only ${uniqueIntents.length} intents. Produce between ${MIN_SEARCH_INTENTS_PER_JOB} and ${maxBudget} search intents.`;
        continue;
      }
      break;
    }

    const hasTarget = uniqueIntents.some((i) => i.marketScope === "TARGET_MARKET");
    const hasGlobal = uniqueIntents.some((i) => i.marketScope === "GLOBAL_CATEGORY");

    if (context.targetMarketGeography && (!hasTarget || !hasGlobal)) {
      if (attempts <= maxRetries) {
        repairPrompt = `MISSING_MARKET_SCOPE_REPRESENTATION: Package must contain representation for both TARGET_MARKET (geography: "${context.targetMarketGeography}") and GLOBAL_CATEGORY (geography: null).`;
        continue;
      }
      break;
    }

    if (judgeReport.overallDecision === "APPROVED") {
      currentPackage = {
        ...currentPackage,
        intents: uniqueIntents,
      };
      break;
    }

    // Check if the approved subset of candidate intents is already sufficient and valid
    const approvedQueries = new Set(
      judgeReport.decisions
        .filter((d) => d.status === "APPROVED" && d.neutrality && d.relevance && d.offeringSpecificity && d.temporalRelevance && d.marketScopeValid && d.intentCategoryFit)
        .map((d) => d.intentQuery.trim().toLowerCase())
    );

    const validSubset = uniqueIntents.filter((intent) =>
      approvedQueries.has(intent.query.trim().toLowerCase())
    );

    const subsetHasTarget = validSubset.some((i) => i.marketScope === "TARGET_MARKET");
    const subsetHasGlobal = validSubset.some((i) => i.marketScope === "GLOBAL_CATEGORY");

    if (
      validSubset.length >= MIN_SEARCH_INTENTS_PER_JOB &&
      (!context.targetMarketGeography || (subsetHasTarget && subsetHasGlobal))
    ) {
      currentPackage = {
        ...currentPackage,
        intents: validSubset,
      };
      judgeReport = {
        ...judgeReport,
        overallDecision: "APPROVED",
      };
      break;
    }

    if (judgeReport.overallDecision === "REPAIR_REQUIRED" && attempts <= maxRetries) {
      repairPrompt = judgeReport.repairInstructions || judgeReport.summary;
      continue;
    }

    break;
  }

  if (!currentPackage || !judgeReport || judgeReport.overallDecision !== "APPROVED") {
    const [failedJob] = await db
      .insert(marketVoiceDiscoveryJobs)
      .values({
        id: discoveryJobId,
        accountId: context.accountId,
        campaignId: context.campaignId,
        campaignOfferingId: context.campaignOfferingId,
        status: "FAILED",
        errorMessage: judgeReport?.summary || "Search plan rejected by Hostile Judge after maximum retries",
        metadata: {
          attempts,
          judgeSummary: judgeReport?.summary,
        },
      })
      .onConflictDoUpdate({
        target: marketVoiceDiscoveryJobs.id,
        set: {
          status: "FAILED",
          errorMessage: judgeReport?.summary || "Search plan rejected by Hostile Judge",
        },
      })
      .returning();

    throw new Error(
      `[SearchPlanner] Search plan failed validation by Hostile Judge: ${judgeReport?.summary || "Validation failed"}`
    );
  }

  const finalIntents = currentPackage.intents;
  const maxBudget = context.maxIntentsPerJob || DEFAULT_MAX_SEARCH_INTENTS_PER_JOB;

  const [persistedJob] = await db
    .insert(marketVoiceDiscoveryJobs)
    .values({
      id: discoveryJobId,
      accountId: context.accountId,
      campaignId: context.campaignId,
      campaignOfferingId: context.campaignOfferingId,
      status: "RUNNING",
      searchPlannerPrompt: currentPackage.plannerRationale,
      budgetLimits: {
        maxSearchIntents: maxBudget,
      },
      metadata: {
        attempts,
        plannedIntentCount: finalIntents.length,
        judgeVerdict: judgeReport.overallDecision,
      },
    })
    .onConflictDoUpdate({
      target: marketVoiceDiscoveryJobs.id,
      set: {
        status: "RUNNING",
        searchPlannerPrompt: currentPackage.plannerRationale,
        metadata: {
          attempts,
          plannedIntentCount: finalIntents.length,
          judgeVerdict: judgeReport.overallDecision,
        },
      },
    })
    .returning();

  const intentRowsToInsert = finalIntents.map((draft) => {
    const intentId = generateSearchIntentId(discoveryJobId, draft.query, draft.targetPlatform);
    return {
      id: intentId,
      discoveryJobId: discoveryJobId,
      accountId: context.accountId,
      campaignId: context.campaignId,
      campaignOfferingId: context.campaignOfferingId,
      query: draft.query,
      intentCategory: draft.intentCategory,
      marketScope: draft.marketScope,
      targetPlatform: draft.targetPlatform,
      targetGeography: draft.targetGeography,
      languageHint: draft.languageHint,
      reasonForSearch: draft.reasonForSearch,
      discoveryGoal: draft.discoveryGoal,
      status: "PENDING" as const,
      resultsCount: 0,
    };
  });

  const persistedIntents = await db
    .insert(marketVoiceSearchIntents)
    .values(intentRowsToInsert)
    .onConflictDoNothing()
    .returning();

  return {
    success: true,
    job: persistedJob,
    intents: persistedIntents.length > 0 ? persistedIntents : (intentRowsToInsert as any),
    judgeReport,
    attempts,
  };
}
