import crypto from "crypto";
import { aiChat } from "../ai-client";
import { resolveModelForTier, DISCOVERY_MODEL_TIERS } from "../discovery/model-router";
import {
  type FetchedContentItem,
  type ContentAuthorRole,
  type CustomerVoiceEligibilityStatus,
  type AuthorshipVerificationResult,
  type CustomerVoiceEligibilityResult,
  type EvidenceJudgeDecision,
  type EvidenceJudgeVerdict,
  type SourceScope,
  type MarketScope,
  type PrimaryMarketVoiceEligibilityVerdict,
} from "@shared/contracts/market-voice";

const MV_VERIFIER_PROMPT_VERSION = "mv_verifier_v2.1";
const authorshipCache = new Map<string, AuthorshipVerificationResult>();
const eligibilityCache = new Map<string, CustomerVoiceEligibilityResult>();

function computeAuthorshipCacheKey(
  item: FetchedContentItem,
  pageContext: { url: string; title: string },
  accountId: string,
  model: string
): string {
  const url = item.sourceUrl || (item.metadata?.pageUrl as string) || pageContext.url || "";
  const title = (item.metadata?.pageTitle as string) || pageContext.title || "";
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: MV_VERIFIER_PROMPT_VERSION,
        accountId,
        model,
        url,
        title,
        platform: item.sourcePlatform || "",
        author: item.authorIdentifier || "",
        text: (item.verbatimText || "").trim(),
      })
    )
    .digest("hex");
}

function computeEligibilityCacheKey(
  item: FetchedContentItem,
  campaignContext: {
    offeringName: string;
    category: string;
    targetMarket: string;
    productTruthFacts: string[];
  },
  pageContext: { url: string; title: string; domain?: string; snippet?: string } | undefined,
  accountId: string,
  model: string
): string {
  const url = item.sourceUrl || (item.metadata?.pageUrl as string) || pageContext?.url || "";
  const title = (item.metadata?.pageTitle as string) || pageContext?.title || "";
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: MV_VERIFIER_PROMPT_VERSION,
        accountId,
        model,
        offering: campaignContext.offeringName,
        category: campaignContext.category,
        market: campaignContext.targetMarket,
        url,
        title,
        text: (item.verbatimText || "").trim(),
      })
    )
    .digest("hex");
}

export function __clearMarketVoiceVerifierCacheForTests(): void {
  authorshipCache.clear();
  eligibilityCache.clear();
}

/**
 * Stage 4.1: Authorship & Role Verification.
 * Determines if the content is authored by a genuine customer/community participant
 * versus a brand representative, SEO writer, affiliate promoter, or bot.
 */
export async function verifyAuthorshipRole(
  item: FetchedContentItem,
  pageContext: { url: string; title: string },
  options?: { accountId?: string }
): Promise<AuthorshipVerificationResult> {
  // Structural precondition: empty text is immediately unknown
  if (!item.verbatimText || item.verbatimText.trim().length === 0) {
    return {
      authorRole: "UNKNOWN",
      confidence: 1.0,
      reasoning: "Structural validation: text is empty.",
      isCustomerAuthored: false,
    };
  }

  const prompt = `You are Avyron's Customer Voice Authorship Verifier.
Analyze this text snippet extracted from a real web source and classify who authored it.

PAGE CONTEXT:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
- Source Platform: ${item.sourcePlatform}
- Author Handle/Name: ${item.authorIdentifier || "Unknown"}

CONTENT TO EVALUATE:
"""
${item.verbatimText.slice(0, 1000)}
"""

CLASSIFICATION OPTIONS:
1. CUSTOMER_COMMUNITY_USER: Genuine end-buyer, prospective customer, community forum participant, or review writer sharing personal experience, asking questions, or discussing needs. (NOTE: If this is an independent reader/customer comment posted in a publication's user comment section, classify as CUSTOMER_COMMUNITY_USER).
2. EDITORIAL_JOURNALIST: Journalist, staff writer, editor, columnist, or publication reviewer writing an article, review article, news story, or magazine editorial (e.g. Daily Beast, Vogue, Forbes, etc.). Article body prose or headlines from publications are EDITORIAL_JOURNALIST, NOT customer voice.
3. MARKET_RESEARCH_COMMENTATOR: Industry analyst, market research commentator, trend reporter, or consultant writing market commentary or category reports.
4. BRAND_REPRESENTATIVE: Official merchant, brand description, product marketing copy, store FAQ, or business representative.
5. SEO_CONTENT_WRITER: Commercial blog post, SEO listicle ("Top 10..."), affiliate article, or commercial affiliate writer.
6. SPAM_OR_BOT: Automated bot, link spam, affiliate promotion, or advertising spam.
7. UNKNOWN: Cannot determine author role from text.

Return ONLY valid JSON:
{
  "authorRole": "CUSTOMER_COMMUNITY_USER" | "EDITORIAL_JOURNALIST" | "MARKET_RESEARCH_COMMENTATOR" | "BRAND_REPRESENTATIVE" | "SEO_CONTENT_WRITER" | "SPAM_OR_BOT" | "UNKNOWN",
  "isCustomerAuthored": true | false,
  "confidence": 0.0 to 1.0,
  "reasoning": "Clear explanation of author classification based on text structure, tone, and source context"
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.IDENTITY_VERIFIER),
      messages: [
        { role: "system", content: "You are Avyron's Customer Voice Authorship Verifier. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      endpoint: "mv-authorship-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validRoles: ContentAuthorRole[] = [
      "CUSTOMER_COMMUNITY_USER",
      "BRAND_REPRESENTATIVE",
      "SEO_CONTENT_WRITER",
      "EDITORIAL_JOURNALIST",
      "MARKET_RESEARCH_COMMENTATOR",
      "SPAM_OR_BOT",
      "UNKNOWN",
    ];

    const authorRole: ContentAuthorRole = validRoles.includes(parsed.authorRole)
      ? parsed.authorRole
      : "UNKNOWN";

    const isCustomerAuthored = authorRole === "CUSTOMER_COMMUNITY_USER" && parsed.isCustomerAuthored === true;

    return {
      authorRole,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      reasoning: parsed.reasoning || `Classified as ${authorRole}.`,
      isCustomerAuthored,
    };
  } catch (err: any) {
    // Fail closed on model/runtime error without semantic guessing
    return {
      authorRole: "UNKNOWN",
      confidence: 0.0,
      reasoning: `Authorship verification failed closed due to model error: ${err?.message || "unknown"}`,
      isCustomerAuthored: false,
    };
  }
}

/**
 * Stage 4.1 (Batched): Preserves complete per-item context (itemId, verbatimText, authorIdentifier,
 * sourceUrl, parentContext/threadContext) across items from a single fetched source.
 */
export async function verifyBatchAuthorshipRole(
  items: FetchedContentItem[],
  pageContext: { url: string; title: string; domain?: string; snippet?: string },
  options?: { accountId?: string }
): Promise<Map<string, AuthorshipVerificationResult>> {
  const resultMap = new Map<string, AuthorshipVerificationResult>();
  if (!items || items.length === 0) return resultMap;

  const accountId = options?.accountId || "system";
  const model = resolveModelForTier(DISCOVERY_MODEL_TIERS.IDENTITY_VERIFIER);
  const itemsToQuery: FetchedContentItem[] = [];
  const itemCacheKeys = new Map<string, string>();

  for (const item of items) {
    if (!item.verbatimText || item.verbatimText.trim().length === 0) {
      resultMap.set(item.itemId, {
        authorRole: "UNKNOWN",
        confidence: 1.0,
        reasoning: "Structural validation: text is empty.",
        isCustomerAuthored: false,
      });
    } else {
      const cKey = computeAuthorshipCacheKey(item, pageContext, accountId, model);
      itemCacheKeys.set(item.itemId, cKey);
      const cached = authorshipCache.get(cKey);
      if (cached) {
        resultMap.set(item.itemId, cached);
      } else {
        itemsToQuery.push(item);
      }
    }
  }

  if (itemsToQuery.length === 0) return resultMap;

  // Format candidate items for batch prompt, preserving 100% per-item context
  const itemsBlock = itemsToQuery.map((item, idx) => {
    const parentContext = item.metadata?.parentContext || item.metadata?.threadContext || "N/A";
    const itemPageTitle = (item.metadata?.pageTitle as string) || pageContext.title || "N/A";
    return `[ITEM ${idx + 1}]
- itemId: "${item.itemId}"
- sourceUrl: "${item.sourceUrl || (item.metadata?.pageUrl as string) || pageContext.url}"
- pageTitle: "${itemPageTitle}"
- sourcePlatform: "${item.sourcePlatform}"
- authorIdentifier: "${item.authorIdentifier || "Unknown"}"
- parentContext / threadContext: "${parentContext}"
- verbatimText:
"""
${item.verbatimText.slice(0, 1000)}
"""`;
  }).join("\n\n");

  const prompt = `You are Avyron's Customer Voice Authorship Verifier.
Analyze the following candidate text items extracted from the web source(s) below, and classify who authored EACH item individually.

PAGE CONTEXT:
- URL: ${pageContext.url}
- Title: ${pageContext.title}
- Domain: ${pageContext.domain || "N/A"}

CLASSIFICATION OPTIONS:
1. CUSTOMER_COMMUNITY_USER: Genuine end-buyer, prospective customer, community forum participant, or review writer sharing personal experience, asking questions, or discussing needs. (NOTE: If this is an independent reader/customer comment posted in a publication's user comment section, classify as CUSTOMER_COMMUNITY_USER).
2. EDITORIAL_JOURNALIST: Journalist, staff writer, editor, columnist, or publication reviewer writing an article, review article, news story, or magazine editorial (e.g. Daily Beast, Vogue, Forbes, etc.). Article body prose or headlines from publications are EDITORIAL_JOURNALIST, NOT customer voice.
3. MARKET_RESEARCH_COMMENTATOR: Industry analyst, market research commentator, trend reporter, or consultant writing market commentary or category reports.
4. BRAND_REPRESENTATIVE: Official merchant, brand description, product marketing copy, store FAQ, or business representative.
5. SEO_CONTENT_WRITER: Commercial blog post, SEO listicle ("Top 10..."), affiliate article, or commercial affiliate writer.
6. SPAM_OR_BOT: Automated bot, link spam, affiliate promotion, or advertising spam.
7. UNKNOWN: Cannot determine author role from text.

ITEMS TO EVALUATE (${itemsToQuery.length} items):
${itemsBlock}

Return ONLY valid JSON matching this structure:
{
  "items": [
    {
      "itemId": string,
      "authorRole": "CUSTOMER_COMMUNITY_USER" | "EDITORIAL_JOURNALIST" | "MARKET_RESEARCH_COMMENTATOR" | "BRAND_REPRESENTATIVE" | "SEO_CONTENT_WRITER" | "SPAM_OR_BOT" | "UNKNOWN",
      "isCustomerAuthored": true | false,
      "confidence": 0.0 to 1.0,
      "reasoning": string
    }
  ]
}`;

  try {
    const res = await aiChat({
      model,
      messages: [
        { role: "system", content: "You are Avyron's Customer Voice Authorship Verifier. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 300 + itemsToQuery.length * 120,
      response_format: { type: "json_object" },
      accountId,
      endpoint: "mv-authorship-batch-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validRoles: ContentAuthorRole[] = [
      "CUSTOMER_COMMUNITY_USER",
      "BRAND_REPRESENTATIVE",
      "SEO_CONTENT_WRITER",
      "EDITORIAL_JOURNALIST",
      "MARKET_RESEARCH_COMMENTATOR",
      "SPAM_OR_BOT",
      "UNKNOWN",
    ];

    if (Array.isArray(parsed.items)) {
      for (const itemRes of parsed.items) {
        if (!itemRes || !itemRes.itemId) continue;
        const authorRole: ContentAuthorRole = validRoles.includes(itemRes.authorRole)
          ? itemRes.authorRole
          : "UNKNOWN";
        const isCustomerAuthored = authorRole === "CUSTOMER_COMMUNITY_USER" && itemRes.isCustomerAuthored === true;
        const entry: AuthorshipVerificationResult = {
          authorRole,
          confidence: typeof itemRes.confidence === "number" ? itemRes.confidence : 0.8,
          reasoning: itemRes.reasoning || `Classified as ${authorRole}.`,
          isCustomerAuthored,
        };
        resultMap.set(itemRes.itemId, entry);
        const cKey = itemCacheKeys.get(itemRes.itemId);
        if (cKey) authorshipCache.set(cKey, entry);
      }
    }
  } catch (err: any) {
    console.warn(`[MarketVoiceVerifier] verifyBatchAuthorshipRole batch failed: ${err?.message}; falling back to individual verification.`);
  }

  // Resilient per-item fallback for any missing items in batch response
  for (const item of itemsToQuery) {
    if (!resultMap.has(item.itemId)) {
      const fallback = await verifyAuthorshipRole(item, pageContext, options);
      resultMap.set(item.itemId, fallback);
      const cKey = itemCacheKeys.get(item.itemId);
      if (cKey && fallback.confidence > 0) authorshipCache.set(cKey, fallback);
    }
  }

  return resultMap;
}

/**
 * Stage 4.2: Source-Context & Customer Voice Eligibility Verification.
 * Evaluates whether customer-authored text AND its parent webpage/thread context
 * contain meaningful first-party customer language relevant to the campaign offering and category.
 */
export async function verifyCustomerVoiceEligibility(
  item: FetchedContentItem,
  authorRole: ContentAuthorRole,
  campaignContext: {
    offeringName: string;
    category: string;
    targetMarket: string;
    productTruthFacts: string[];
  },
  pageContext?: { url: string; title: string; domain?: string; snippet?: string },
  options?: { accountId?: string }
): Promise<CustomerVoiceEligibilityResult> {
  // Structural precondition: Non-customer authored items are immediately ineligible
  if (authorRole !== "CUSTOMER_COMMUNITY_USER") {
    return {
      eligibility: "NOT_CUSTOMER_VOICE",
      isEligible: false,
      reasoning: `Ineligible: Content authored by ${authorRole}, not customer or community user.`,
      primaryEligibility: {
        verdict: "AUTHORSHIP_UNRESOLVED",
        isPrimaryEligible: false,
        reasoning: `Ineligible author role: ${authorRole}`,
        semanticScope: "INSUFFICIENT_SCOPE",
        transferability: "IRRELEVANT_GEOGRAPHY",
      },
    };
  }

  // Structural precondition: Text too short to contain customer voice
  const clean = item.verbatimText.trim();
  if (clean.length < 15) {
    return {
      eligibility: "GENERIC_NOISE",
      isEligible: false,
      reasoning: "Ineligible: Text is too short to contain actionable customer voice.",
      primaryEligibility: {
        verdict: "IRRELEVANT",
        isPrimaryEligible: false,
        reasoning: "Text snippet too short.",
        semanticScope: "INSUFFICIENT_SCOPE",
        transferability: "IRRELEVANT_GEOGRAPHY",
      },
    };
  }

  const prompt = `You are Avyron's Hostile Source-Context & Customer Voice Eligibility Assessor.
Determine if this customer-authored snippet AND its parent source webpage contain meaningful first-party customer language relevant to the product category.

CAMPAIGN CONTEXT:
- Hero Product: "${campaignContext.offeringName}"
- Category: "${campaignContext.category}"
- Target Market: "${campaignContext.targetMarket}"

SOURCE WEBPAGE CONTEXT:
- Page / Thread URL: "${pageContext?.url || item.sourceUrl || "N/A"}"
- Page / Thread Title: "${pageContext?.title || "N/A"}"
- Search Snippet: "${pageContext?.snippet || "N/A"}"
- Source Platform: "${item.sourcePlatform}"

CUSTOMER TEXT TO EVALUATE:
"""
${clean.slice(0, 1200)}
"""

EVALUATION PRINCIPLES (APPLIES GENERICALLY ACROSS ALL INDUSTRIES):
1. SOURCE & THREAD RELEVANCE:
   - Examine the page title, URL, and discussion context. Does the webpage/thread topic actually belong to the product category/offering space?
   - If the webpage is about a completely unrelated domain (e.g. personal photo posts / selfie threads, car mechanics / automotive forums, politics, gaming, crypto, unrelated hobby forums) where common words appear incidentally or in casual conversation, you MUST REJECT as 'IRRELEVANT'.
2. FIRST-PARTY BUYER & PRODUCT EXPERIENCE:
   - Does the quote describe a real customer buying, testing, evaluating, wearing, using, expecting, or complaining about a category product?
   - If the quote is merely casual social conversation, flirting / compliments on personal physical appearance (e.g. 'looks good on you', 'hot here', 'nice photo'), or off-topic chat, you MUST REJECT as 'IRRELEVANT'.
3. SEMANTIC SCOPE:
   - 'CATEGORY_RECURRING': Broad category-level product truth (e.g. fabric sheer in sunlight, sizing standards).
   - 'MARKET_TRANSFERABLE': Specific brand experience that reveals generalizable category buying trade-offs.
   - 'SINGLE_BRAND_SPECIFIC': Operational dispute strictly limited to a single retailer/seller (e.g. specific shipping delay).
   - 'INCIDENT_SPECIFIC': One-off customer service issue.
   - 'INSUFFICIENT_SCOPE': Unclear or isolated.
4. TRANSFERABILITY:
   - 'GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH': Product-level physical truths that hold across markets.
   - 'ADJACENT_TRANSFERABLE_MARKET': Market dynamics transferable to target market.
   - 'GEOGRAPHY_SPECIFIC_OPERATIONAL': Local courier/shipping issue.
   - 'IRRELEVANT_GEOGRAPHY': Completely disconnected.

PRIMARY ELIGIBILITY VERDICT:
- 'PRIMARY_ELIGIBLE': Source context is on-topic + quote describes genuine product/buying friction or experience.
- 'SUPPORTING_CONTEXT_ONLY': Relevant general context but lacking deep first-party product friction.
- 'IRRELEVANT': Off-topic source thread, personal photo comment, wrong industry/product, social banter.
- 'AUTHORSHIP_UNRESOLVED': Ambiguous author.
- 'MARKET_RELEVANCE_UNRESOLVED': Ambiguous category connection.

Return ONLY valid JSON:
{
  "isEligible": true | false,
  "eligibility": "ELIGIBLE_CUSTOMER_VOICE" | "NOT_CUSTOMER_VOICE" | "GENERIC_NOISE" | "PROMOTIONAL_CONTENT" | "INSUFFICIENT_EVIDENCE",
  "primaryEligibilityVerdict": "PRIMARY_ELIGIBLE" | "SUPPORTING_CONTEXT_ONLY" | "IRRELEVANT" | "AUTHORSHIP_UNRESOLVED" | "MARKET_RELEVANCE_UNRESOLVED",
  "semanticScope": "CATEGORY_RECURRING" | "MARKET_TRANSFERABLE" | "SINGLE_BRAND_SPECIFIC" | "INCIDENT_SPECIFIC" | "INSUFFICIENT_SCOPE",
  "transferability": "SAME_MARKET" | "ADJACENT_TRANSFERABLE_MARKET" | "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" | "GEOGRAPHY_SPECIFIC_OPERATIONAL" | "IRRELEVANT_GEOGRAPHY",
  "voiceType": "EXPERIENCE" | "COMPLAINT" | "QUESTION" | "COMPARISON" | "HESITATION" | "RECOMMENDATION" | "OUTCOME" | "OTHER",
  "sentimentPolarity": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" | "UNCLASSIFIED",
  "detectedGeography": "LB" | "AE" | "US" | "UK" | null,
  "detectedLanguage": "en" | "ar" | "fr" | null,
  "reasoning": "Clear explanation of eligibility, source relevance, and category alignment"
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
      messages: [
        { role: "system", content: "You are Avyron's Hostile Source-Context & Customer Voice Eligibility Assessor. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      endpoint: "mv-voice-eligibility",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validStatuses: CustomerVoiceEligibilityStatus[] = [
      "ELIGIBLE_CUSTOMER_VOICE",
      "NOT_CUSTOMER_VOICE",
      "GENERIC_NOISE",
      "PROMOTIONAL_CONTENT",
      "INSUFFICIENT_EVIDENCE",
    ];

    const validVerdicts: PrimaryMarketVoiceEligibilityVerdict[] = [
      "PRIMARY_ELIGIBLE",
      "SUPPORTING_CONTEXT_ONLY",
      "IRRELEVANT",
      "AUTHORSHIP_UNRESOLVED",
      "MARKET_RELEVANCE_UNRESOLVED",
    ];

    const validPolarities = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED", "UNCLASSIFIED"];
    const sentimentPolarity = validPolarities.includes(parsed.sentimentPolarity)
      ? parsed.sentimentPolarity
      : "UNCLASSIFIED";

    const primaryVerdict: PrimaryMarketVoiceEligibilityVerdict = validVerdicts.includes(parsed.primaryEligibilityVerdict)
      ? parsed.primaryEligibilityVerdict
      : (parsed.isEligible ? "PRIMARY_ELIGIBLE" : "IRRELEVANT");

    const isPrimaryEligible = primaryVerdict === "PRIMARY_ELIGIBLE";

    const eligibility: CustomerVoiceEligibilityStatus = isPrimaryEligible
      ? "ELIGIBLE_CUSTOMER_VOICE"
      : (validStatuses.includes(parsed.eligibility) ? parsed.eligibility : "NOT_CUSTOMER_VOICE");

    return {
      eligibility,
      isEligible: isPrimaryEligible,
      voiceType: parsed.voiceType || "EXPERIENCE",
      sentimentPolarity,
      detectedGeography: parsed.detectedGeography || null,
      detectedLanguage: parsed.detectedLanguage || (/[ء-ي]/.test(clean) ? "ar" : "en"),
      reasoning: parsed.reasoning || "Evaluated customer voice eligibility.",
      primaryEligibility: {
        verdict: primaryVerdict,
        isPrimaryEligible,
        reasoning: parsed.reasoning || `Primary eligibility: ${primaryVerdict}`,
        semanticScope: parsed.semanticScope || "INSUFFICIENT_SCOPE",
        transferability: parsed.transferability || "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
        voiceType: parsed.voiceType || "EXPERIENCE",
        sentimentPolarity,
        detectedGeography: parsed.detectedGeography || null,
        detectedLanguage: parsed.detectedLanguage || null,
      },
    };
  } catch (err: any) {
    // Fail closed on model/runtime error without semantic guessing
    return {
      eligibility: "INSUFFICIENT_EVIDENCE",
      isEligible: false,
      voiceType: "OTHER",
      sentimentPolarity: "UNCLASSIFIED",
      detectedGeography: null,
      detectedLanguage: /[ء-ي]/.test(clean) ? "ar" : "en",
      reasoning: `Eligibility verification failed closed due to model error: ${err?.message || "unknown"}`,
      primaryEligibility: {
        verdict: "MARKET_RELEVANCE_UNRESOLVED",
        isPrimaryEligible: false,
        reasoning: `Model error: ${err?.message}`,
        semanticScope: "INSUFFICIENT_SCOPE",
        transferability: "IRRELEVANT_GEOGRAPHY",
      },
    };
  }
}

/**
 * Stage 4.2 (Batched): Evaluates Customer Voice Eligibility across all candidate items
 * from a fetched web source in a single structured round trip while preserving 100% of
 * per-item and page context.
 */
export async function verifyBatchCustomerVoiceEligibility(
  candidates: Array<{ item: FetchedContentItem; authorRole: ContentAuthorRole }>,
  campaignContext: {
    offeringName: string;
    category: string;
    targetMarket: string;
    productTruthFacts: string[];
  },
  pageContext?: { url: string; title: string; domain?: string; snippet?: string },
  options?: { accountId?: string }
): Promise<Map<string, CustomerVoiceEligibilityResult>> {
  const resultMap = new Map<string, CustomerVoiceEligibilityResult>();
  if (!candidates || candidates.length === 0) return resultMap;

  const accountId = options?.accountId || "system";
  const model = resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER);
  const itemsToQuery: FetchedContentItem[] = [];
  const itemCacheKeys = new Map<string, string>();

  for (const { item, authorRole } of candidates) {
    // Structural precondition: Non-customer authored items
    if (authorRole !== "CUSTOMER_COMMUNITY_USER") {
      resultMap.set(item.itemId, {
        eligibility: "NOT_CUSTOMER_VOICE",
        isEligible: false,
        reasoning: `Ineligible: Content authored by ${authorRole}, not customer or community user.`,
        primaryEligibility: {
          verdict: "AUTHORSHIP_UNRESOLVED",
          isPrimaryEligible: false,
          reasoning: `Ineligible author role: ${authorRole}`,
          semanticScope: "INSUFFICIENT_SCOPE",
          transferability: "IRRELEVANT_GEOGRAPHY",
        },
      });
      continue;
    }

    const clean = item.verbatimText.trim();
    if (clean.length < 15) {
      resultMap.set(item.itemId, {
        eligibility: "GENERIC_NOISE",
        isEligible: false,
        reasoning: "Ineligible: Text is too short to contain actionable customer voice.",
        primaryEligibility: {
          verdict: "IRRELEVANT",
          isPrimaryEligible: false,
          reasoning: "Text snippet too short.",
          semanticScope: "INSUFFICIENT_SCOPE",
          transferability: "IRRELEVANT_GEOGRAPHY",
        },
      });
      continue;
    }

    const cKey = computeEligibilityCacheKey(item, campaignContext, pageContext, accountId, model);
    itemCacheKeys.set(item.itemId, cKey);
    const cached = eligibilityCache.get(cKey);
    if (cached) {
      resultMap.set(item.itemId, cached);
    } else {
      itemsToQuery.push(item);
    }
  }

  if (itemsToQuery.length === 0) return resultMap;

  const itemsBlock = itemsToQuery.map((item, idx) => {
    const parentContext = item.metadata?.parentContext || item.metadata?.threadContext || "N/A";
    const itemPageTitle = (item.metadata?.pageTitle as string) || pageContext?.title || "N/A";
    return `[ITEM ${idx + 1}]
- itemId: "${item.itemId}"
- sourceUrl: "${item.sourceUrl || (item.metadata?.pageUrl as string) || pageContext?.url || "N/A"}"
- pageTitle: "${itemPageTitle}"
- sourcePlatform: "${item.sourcePlatform}"
- authorIdentifier: "${item.authorIdentifier || "Unknown"}"
- parentContext / threadContext: "${parentContext}"
- verbatimText:
"""
${item.verbatimText.trim().slice(0, 1200)}
"""`;
  }).join("\n\n");

  const prompt = `You are Avyron's Hostile Source-Context & Customer Voice Eligibility Assessor.
Determine if each customer-authored snippet AND its parent source webpage contain meaningful first-party customer language relevant to the product category.

CAMPAIGN CONTEXT:
- Hero Product: "${campaignContext.offeringName}"
- Category: "${campaignContext.category}"
- Target Market: "${campaignContext.targetMarket}"

SOURCE WEBPAGE CONTEXT:
- Page / Thread URL: "${pageContext?.url || "N/A"}"
- Page / Thread Title: "${pageContext?.title || "N/A"}"
- Search Snippet: "${pageContext?.snippet || "N/A"}"

EVALUATION PRINCIPLES:
1. SOURCE & THREAD RELEVANCE: Does the webpage/thread topic actually belong to the product category space? If the webpage is an unrelated domain (personal photos, selfie threads, car mechanics, gaming, crypto, unrelated hobbies) where words appear incidentally, REJECT as 'IRRELEVANT'.
2. FIRST-PARTY BUYER & PRODUCT EXPERIENCE: Does the quote describe a real customer buying, testing, evaluating, wearing, using, expecting, or complaining about a category product? If casual social chat, physical appearance compliments ('looks good on you'), or off-topic chat, REJECT as 'IRRELEVANT'.
3. SEMANTIC SCOPE: 'CATEGORY_RECURRING', 'MARKET_TRANSFERABLE', 'SINGLE_BRAND_SPECIFIC', 'INCIDENT_SPECIFIC', 'INSUFFICIENT_SCOPE'.
4. TRANSFERABILITY: 'GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH', 'ADJACENT_TRANSFERABLE_MARKET', 'SAME_MARKET', 'GEOGRAPHY_SPECIFIC_OPERATIONAL', 'IRRELEVANT_GEOGRAPHY'.

PRIMARY ELIGIBILITY VERDICTS:
- 'PRIMARY_ELIGIBLE': Source context is on-topic + quote describes genuine product/buying friction or experience.
- 'SUPPORTING_CONTEXT_ONLY': Relevant general context but lacking deep first-party product friction.
- 'IRRELEVANT': Off-topic source thread, personal photo comment, wrong industry/product, social banter.
- 'AUTHORSHIP_UNRESOLVED': Ambiguous author.
- 'MARKET_RELEVANCE_UNRESOLVED': Ambiguous category connection.

ITEMS TO EVALUATE (${itemsToQuery.length} items):
${itemsBlock}

Return ONLY valid JSON matching this structure:
{
  "items": [
    {
      "itemId": string,
      "isEligible": true | false,
      "eligibility": "ELIGIBLE_CUSTOMER_VOICE" | "NOT_CUSTOMER_VOICE" | "GENERIC_NOISE" | "PROMOTIONAL_CONTENT" | "INSUFFICIENT_EVIDENCE",
      "primaryEligibilityVerdict": "PRIMARY_ELIGIBLE" | "SUPPORTING_CONTEXT_ONLY" | "IRRELEVANT" | "AUTHORSHIP_UNRESOLVED" | "MARKET_RELEVANCE_UNRESOLVED",
      "semanticScope": "CATEGORY_RECURRING" | "MARKET_TRANSFERABLE" | "SINGLE_BRAND_SPECIFIC" | "INCIDENT_SPECIFIC" | "INSUFFICIENT_SCOPE",
      "transferability": "SAME_MARKET" | "ADJACENT_TRANSFERABLE_MARKET" | "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH" | "GEOGRAPHY_SPECIFIC_OPERATIONAL" | "IRRELEVANT_GEOGRAPHY",
      "voiceType": "EXPERIENCE" | "COMPLAINT" | "QUESTION" | "COMPARISON" | "HESITATION" | "RECOMMENDATION" | "OUTCOME" | "OTHER",
      "sentimentPolarity": "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" | "UNCLASSIFIED",
      "detectedGeography": "LB" | "AE" | "US" | "UK" | null,
      "detectedLanguage": "en" | "ar" | "fr" | null,
      "reasoning": string
    }
  ]
}`;

  try {
    const res = await aiChat({
      model,
      messages: [
        { role: "system", content: "You are Avyron's Hostile Source-Context & Customer Voice Eligibility Assessor. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400 + itemsToQuery.length * 150,
      response_format: { type: "json_object" },
      accountId,
      endpoint: "mv-voice-eligibility-batch",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validStatuses: CustomerVoiceEligibilityStatus[] = [
      "ELIGIBLE_CUSTOMER_VOICE",
      "NOT_CUSTOMER_VOICE",
      "GENERIC_NOISE",
      "PROMOTIONAL_CONTENT",
      "INSUFFICIENT_EVIDENCE",
    ];

    const validVerdicts: PrimaryMarketVoiceEligibilityVerdict[] = [
      "PRIMARY_ELIGIBLE",
      "SUPPORTING_CONTEXT_ONLY",
      "IRRELEVANT",
      "AUTHORSHIP_UNRESOLVED",
      "MARKET_RELEVANCE_UNRESOLVED",
    ];

    const validPolarities = ["POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED", "UNCLASSIFIED"];

    if (Array.isArray(parsed.items)) {
      for (const itemRes of parsed.items) {
        if (!itemRes || !itemRes.itemId) continue;
        const matchedItem = itemsToQuery.find(it => it.itemId === itemRes.itemId);
        const clean = matchedItem ? matchedItem.verbatimText.trim() : "";

        const primaryVerdict: PrimaryMarketVoiceEligibilityVerdict = validVerdicts.includes(itemRes.primaryEligibilityVerdict)
          ? itemRes.primaryEligibilityVerdict
          : (itemRes.isEligible ? "PRIMARY_ELIGIBLE" : "IRRELEVANT");

        const isPrimaryEligible = primaryVerdict === "PRIMARY_ELIGIBLE";
        const eligibility: CustomerVoiceEligibilityStatus = isPrimaryEligible
          ? "ELIGIBLE_CUSTOMER_VOICE"
          : (validStatuses.includes(itemRes.eligibility) ? itemRes.eligibility : "NOT_CUSTOMER_VOICE");

        const sentimentPolarity = validPolarities.includes(itemRes.sentimentPolarity)
          ? itemRes.sentimentPolarity
          : "UNCLASSIFIED";

        const entry: CustomerVoiceEligibilityResult = {
          eligibility,
          isEligible: isPrimaryEligible,
          voiceType: itemRes.voiceType || "EXPERIENCE",
          sentimentPolarity,
          detectedGeography: itemRes.detectedGeography || null,
          detectedLanguage: itemRes.detectedLanguage || (/[ء-ي]/.test(clean) ? "ar" : "en"),
          reasoning: itemRes.reasoning || "Evaluated customer voice eligibility.",
          primaryEligibility: {
            verdict: primaryVerdict,
            isPrimaryEligible,
            reasoning: itemRes.reasoning || `Primary eligibility: ${primaryVerdict}`,
            semanticScope: itemRes.semanticScope || "INSUFFICIENT_SCOPE",
            transferability: itemRes.transferability || "GLOBALLY_TRANSFERABLE_PRODUCT_TRUTH",
            voiceType: itemRes.voiceType || "EXPERIENCE",
            sentimentPolarity,
            detectedGeography: itemRes.detectedGeography || null,
            detectedLanguage: itemRes.detectedLanguage || null,
          },
        };
        resultMap.set(itemRes.itemId, entry);
        const cKey = itemCacheKeys.get(itemRes.itemId);
        if (cKey) eligibilityCache.set(cKey, entry);
      }
    }
  } catch (err: any) {
    console.warn(`[MarketVoiceVerifier] verifyBatchCustomerVoiceEligibility batch failed: ${err?.message}; falling back to individual verification.`);
  }

  // Resilient per-item fallback for any missing items in batch response
  for (const item of itemsToQuery) {
    if (!resultMap.has(item.itemId)) {
      const fallback = await verifyCustomerVoiceEligibility(
        item,
        "CUSTOMER_COMMUNITY_USER",
        campaignContext,
        pageContext,
        options
      );
      resultMap.set(item.itemId, fallback);
      const cKey = itemCacheKeys.get(item.itemId);
      if (cKey) eligibilityCache.set(cKey, fallback);
    }
  }

  return resultMap;
}

/**
 * Stage 4.3: Final Evidence Judge.
 * Strategic reasoning to make the final canonical APPROVE / REJECT verdict,
 * assign canonical owner, and determine verified market scope.
 */
export function runFinalEvidenceJudge(
  item: FetchedContentItem,
  authorship: AuthorshipVerificationResult,
  eligibility: CustomerVoiceEligibilityResult,
  campaignContext: {
    offeringName: string;
    category: string;
    targetMarket: string;
    canonicalDomain?: string;
  },
  competitorCheck?: {
    isCompetitor: boolean;
    competitorId?: string | null;
  }
): EvidenceJudgeDecision {
  // 0. Rejection: Own-brand content exclusion
  if (campaignContext?.canonicalDomain) {
    const ownDomain = campaignContext.canonicalDomain.toLowerCase();
    const sourceUrl = ((item as any)?.sourceUrl || (item as any)?.url || "").toLowerCase();
    const sourceDomain = ((item as any)?.sourceDomain || (item as any)?.domain || "").toLowerCase();
    if (ownDomain && (sourceUrl.includes(ownDomain) || sourceDomain.includes(ownDomain))) {
      return {
        verdict: "REJECT",
        sourceScope: "MARKET_CUSTOMER_VOICE",
        marketScope: "UNKNOWN",
        canonicalOwner: "UNRESOLVED",
        geography: null,
        language: null,
        finalReason: `Rejected: Source originates from own-brand domain (${ownDomain}). Own-brand content cannot be admitted into Market Voice evidence.`,
        rejectionReason: "OWN_BRAND_CONTENT",
        primaryEligibilityVerdict: "IRRELEVANT",
      };
    }
  }

  // 1. Rejection: Authorship
  if (!authorship.isCustomerAuthored || authorship.authorRole !== "CUSTOMER_COMMUNITY_USER") {
    return {
      verdict: "REJECT",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      canonicalOwner: "UNRESOLVED",
      geography: null,
      language: null,
      finalReason: `Rejected: Author is ${authorship.authorRole} (${authorship.reasoning}). Editorial articles, market analysis, SEO copy, and brand marketing are not customer voice.`,
      rejectionReason: authorship.authorRole === "BRAND_REPRESENTATIVE" 
        ? "BRAND_CONTENT" 
        : (authorship.authorRole === "EDITORIAL_JOURNALIST" || authorship.authorRole === "MARKET_RESEARCH_COMMENTATOR" ? "EDITORIAL_CONTENT" : "NOT_CUSTOMER_AUTHORED"),
      primaryEligibilityVerdict: "AUTHORSHIP_UNRESOLVED",
    };
  }

  // 2. Rejection: Ineligible voice or non-primary eligibility (noise, promo, off-topic thread, photo banter)
  if (!eligibility.isEligible || eligibility.primaryEligibility?.verdict !== "PRIMARY_ELIGIBLE") {
    const verdictReason = eligibility.primaryEligibility?.verdict || eligibility.eligibility;
    return {
      verdict: "REJECT",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      canonicalOwner: "UNRESOLVED",
      geography: null,
      language: null,
      finalReason: `Rejected: Ineligible for Primary Market Voice (${verdictReason}: ${eligibility.reasoning}).`,
      rejectionReason: verdictReason,
      primaryEligibilityVerdict: eligibility.primaryEligibility?.verdict || "IRRELEVANT",
      semanticScope: eligibility.primaryEligibility?.semanticScope,
      transferability: eligibility.primaryEligibility?.transferability,
    };
  }

  // 3. Competitor Customer Voice vs Market Customer Voice
  if (competitorCheck?.isCompetitor && competitorCheck.competitorId) {
    return {
      verdict: "APPROVE",
      sourceScope: "COMPETITOR_CUSTOMER_VOICE",
      marketScope: "GLOBAL_CATEGORY",
      canonicalOwner: "ci_competitor_comments",
      geography: eligibility.detectedGeography || null,
      language: eligibility.detectedLanguage || "en",
      finalReason: `Approved competitor customer voice for competitor ${competitorCheck.competitorId}.`,
      primaryEligibilityVerdict: "PRIMARY_ELIGIBLE",
      semanticScope: eligibility.primaryEligibility?.semanticScope,
      transferability: eligibility.primaryEligibility?.transferability,
    };
  }

  // 4. Determine Market Scope (TARGET_MARKET vs GLOBAL_CATEGORY vs UNKNOWN)
  let marketScope: MarketScope = "UNKNOWN";
  const targetNorm = (campaignContext?.targetMarket || "").trim().toUpperCase();
  const detectedGeo = (eligibility.detectedGeography || "").trim().toUpperCase();
  const hintGeo = (item.geographyHint || "").trim().toUpperCase();

  const isTargetMatch = Boolean(
    (targetNorm && (detectedGeo === targetNorm || hintGeo === targetNorm || (targetNorm.includes(detectedGeo) && detectedGeo.length >= 2))) ||
    (detectedGeo === "LB" || hintGeo === "LB")
  );

  if (isTargetMatch) {
    marketScope = "TARGET_MARKET";
  } else if (item.sourcePlatform === "reddit" || item.sourcePlatform === "google_serp" || item.sourcePlatform === "web_community") {
    marketScope = "GLOBAL_CATEGORY";
  }

  const sentimentPolarity = eligibility.sentimentPolarity || eligibility.primaryEligibility?.sentimentPolarity || "UNCLASSIFIED";

  return {
    verdict: "APPROVE",
    sourceScope: "MARKET_CUSTOMER_VOICE",
    marketScope,
    canonicalOwner: "market_voice_evidence",
    geography: eligibility.detectedGeography || null,
    language: eligibility.detectedLanguage || "en",
    sentimentPolarity,
    finalReason: `Approved verbatim customer voice (${eligibility.voiceType} | ${eligibility.primaryEligibility?.semanticScope}): ${eligibility.reasoning}`,
    primaryEligibilityVerdict: "PRIMARY_ELIGIBLE",
    semanticScope: eligibility.primaryEligibility?.semanticScope,
    transferability: eligibility.primaryEligibility?.transferability,
  };
}
