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
} from "@shared/contracts/market-voice";

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
1. CUSTOMER_COMMUNITY_USER: Genuine buyer, prospective customer, community forum participant, or review writer sharing personal experience, asking questions, or discussing needs.
2. BRAND_REPRESENTATIVE: Official merchant, brand description, product marketing copy, store FAQ, or business representative.
3. SEO_CONTENT_WRITER: Commercial blog post, SEO listicle ("Top 10..."), affiliate article, fashion editor/journalist writing commercial content.
4. SPAM_OR_BOT: Automated bot, link spam, affiliate promotion, or advertising spam.
5. UNKNOWN: Cannot determine author role from text.

Return ONLY valid JSON:
{
  "authorRole": "CUSTOMER_COMMUNITY_USER" | "BRAND_REPRESENTATIVE" | "SEO_CONTENT_WRITER" | "SPAM_OR_BOT" | "UNKNOWN",
  "isCustomerAuthored": true | false,
  "confidence": 0.0 to 1.0,
  "reasoning": "Clear explanation of author classification based on text structure and tone"
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
 * Stage 4.2: Customer Voice Eligibility Verification.
 * Evaluates whether customer-authored text contains meaningful first-party customer language
 * relevant to the campaign offering and category.
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
  options?: { accountId?: string }
): Promise<CustomerVoiceEligibilityResult> {
  // Structural precondition: Non-customer authored items are immediately ineligible
  if (authorRole !== "CUSTOMER_COMMUNITY_USER") {
    return {
      eligibility: "NOT_CUSTOMER_VOICE",
      isEligible: false,
      reasoning: `Ineligible: Content authored by ${authorRole}, not customer or community user.`,
    };
  }

  // Structural precondition: Text too short to contain customer voice
  const clean = item.verbatimText.trim();
  if (clean.length < 15) {
    return {
      eligibility: "GENERIC_NOISE",
      isEligible: false,
      reasoning: "Ineligible: Text is too short to contain actionable customer voice.",
    };
  }

  const prompt = `You are Avyron's Customer Voice Eligibility Assessor.
Determine if this customer-authored snippet contains meaningful first-party customer language relevant to the product category.

CAMPAIGN CONTEXT:
- Hero Product: "${campaignContext.offeringName}"
- Category: "${campaignContext.category}"
- Target Market: "${campaignContext.targetMarket}"

CUSTOMER TEXT:
"""
${clean.slice(0, 1000)}
"""

VALID CUSTOMER VOICE FORMS:
- Personal experience or complaint regarding category products (fit, sizing, fabric, heat, breathability, transparency, styling, modesty).
- Purchase consideration, questions, comparison between options, or hesitation reasons.
- Recommendations or tips from real users.
- Unmet expectations, friction, delivery concerns, price sensitivity.

REJECT AS NOT_CUSTOMER_VOICE / GENERIC_NOISE:
- Pure promotional selling, affiliate links, or commercial adverts.
- Generic trivial noise ("nice", "following", "check my profile", "dm sent").
- Totally irrelevant discussion unrelated to fashion/clothing/dresses/category.

GEOGRAPHY & LANGUAGE:
- Detect if text contains explicit clues for geography (e.g. "Lebanon", "Beirut", "LBP", local areas) -> store country code (e.g. "LB").
- Detect primary language code (e.g. "en", "ar", "fr").

Return ONLY valid JSON:
{
  "isEligible": true | false,
  "eligibility": "ELIGIBLE_CUSTOMER_VOICE" | "NOT_CUSTOMER_VOICE" | "GENERIC_NOISE" | "PROMOTIONAL_CONTENT" | "INSUFFICIENT_EVIDENCE",
  "voiceType": "EXPERIENCE" | "COMPLAINT" | "QUESTION" | "COMPARISON" | "HESITATION" | "RECOMMENDATION" | "OUTCOME" | "OTHER",
  "detectedGeography": "LB" | "AE" | "US" | "UK" | null,
  "detectedLanguage": "en" | "ar" | "fr" | null,
  "reasoning": "Clear explanation of eligibility and category relevance"
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
      messages: [
        { role: "system", content: "You are Avyron's Customer Voice Eligibility Assessor. Always return valid JSON." },
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

    const eligibility: CustomerVoiceEligibilityStatus = validStatuses.includes(parsed.eligibility)
      ? parsed.eligibility
      : (parsed.isEligible ? "ELIGIBLE_CUSTOMER_VOICE" : "NOT_CUSTOMER_VOICE");

    return {
      eligibility,
      isEligible: eligibility === "ELIGIBLE_CUSTOMER_VOICE",
      voiceType: parsed.voiceType || "EXPERIENCE",
      detectedGeography: parsed.detectedGeography || null,
      detectedLanguage: parsed.detectedLanguage || (/[ء-ي]/.test(clean) ? "ar" : "en"),
      reasoning: parsed.reasoning || "Evaluated customer voice eligibility.",
    };
  } catch (err: any) {
    // Fail closed on model/runtime error without semantic guessing
    return {
      eligibility: "INSUFFICIENT_EVIDENCE",
      isEligible: false,
      voiceType: "OTHER",
      detectedGeography: null,
      detectedLanguage: /[ء-ي]/.test(clean) ? "ar" : "en",
      reasoning: `Eligibility verification failed closed due to model error: ${err?.message || "unknown"}`,
    };
  }
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
  },
  competitorCheck?: {
    isCompetitor: boolean;
    competitorId?: string | null;
  }
): EvidenceJudgeDecision {
  // 1. Rejection: Authorship
  if (!authorship.isCustomerAuthored || authorship.authorRole !== "CUSTOMER_COMMUNITY_USER") {
    return {
      verdict: "REJECT",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      canonicalOwner: "UNRESOLVED",
      geography: null,
      language: null,
      finalReason: `Rejected: Author is ${authorship.authorRole} (${authorship.reasoning}). Brand marketing copy and SEO articles are not customer voice.`,
      rejectionReason: authorship.authorRole === "BRAND_REPRESENTATIVE" ? "BRAND_CONTENT" : "NOT_CUSTOMER_AUTHORED",
    };
  }

  // 2. Rejection: Ineligible voice (noise, promo, irrelevant)
  if (!eligibility.isEligible || eligibility.eligibility !== "ELIGIBLE_CUSTOMER_VOICE") {
    return {
      verdict: "REJECT",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "UNKNOWN",
      canonicalOwner: "UNRESOLVED",
      geography: null,
      language: null,
      finalReason: `Rejected: Ineligible customer voice (${eligibility.reasoning}).`,
      rejectionReason: eligibility.eligibility,
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
    };
  }

  // 4. Determine Market Scope (TARGET_MARKET vs GLOBAL_CATEGORY vs UNKNOWN)
  let marketScope: MarketScope = "UNKNOWN";
  if (eligibility.detectedGeography === "LB" || (item.geographyHint && item.geographyHint.toUpperCase() === "LB")) {
    marketScope = "TARGET_MARKET";
  } else if (item.sourcePlatform === "reddit" || item.sourcePlatform === "google_serp" || item.sourcePlatform === "web_community") {
    marketScope = "GLOBAL_CATEGORY";
  }

  return {
    verdict: "APPROVE",
    sourceScope: "MARKET_CUSTOMER_VOICE",
    marketScope,
    canonicalOwner: "market_voice_evidence",
    geography: eligibility.detectedGeography || null,
    language: eligibility.detectedLanguage || "en",
    finalReason: `Approved verbatim customer voice (${eligibility.voiceType}): ${eligibility.reasoning}`,
  };
}
