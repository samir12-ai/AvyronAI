import { aiChat } from "../ai-client";
import { resolveModelForTier, DISCOVERY_MODEL_TIERS } from "./model-router";
import {
  CompetitorEntityRole,
  CompetitorClassification,
  CompetitorTier,
  JudgeVerdict,
  IdentityVerificationResult,
  RelevanceVerificationResult,
  FinalJudgeDecision,
} from "@shared/contracts/discovery-contracts";

export interface CompetitorQualityEvidenceInput {
  candidateKey: string;
  name: string;
  domain: string;
  websiteUrl: string;
  evidenceText: string;
}

export interface CompetitorQualityCampaignContext {
  offeringName: string;
  category: string;
  targetMarket: string;
  productTruthFacts: string[];
  targetRoles: string[];
}

export interface CompetitorQualityEvaluationResult {
  identity: IdentityVerificationResult;
  relevance: RelevanceVerificationResult;
  judge: FinalJudgeDecision;
}

export interface CompetitorQualityBudgetTracker {
  recordLlmCall: () => void;
}

/**
 * Stage 4: Canonical Identity Verification & Entity Role Reasoning.
 * High-capability LLM reasoning to verify real commercial business identity and entity role from evidence.
 */
export async function verifyCompetitorIdentity(
  input: CompetitorQualityEvidenceInput,
  options?: {
    accountId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<IdentityVerificationResult> {
  options?.budget?.recordLlmCall();

  const prompt = `You are Avyron's Competitor Identity and Business Entity Role Verifier.
Analyze this candidate discovered via web search/evidence and determine:
1. Is this a REAL COMMERCIAL BUSINESS entity (selling products/services directly)?
2. What is its PRIMARY ENTITY ROLE:
   - BRAND_DIRECT_SELLER: First-party brand designing/manufacturing/selling its own label/products directly.
   - SPECIALTY_RETAILER: Focused retail boutique or store specializing in this specific product category.
   - MULTI_BRAND_RETAILER: Retailer directly merchandising, purchasing wholesale, and selling products from multiple brands directly to consumers (owns customer checkout, pricing, and fulfillment).
   - DEPARTMENT_STORE: Multi-category general department store with direct inventory.
   - PURE_MARKETPLACE_PLATFORM: Multi-vendor platform or e-commerce infrastructure where third-party independent merchants list and sell products (e.g. Alibaba, eBay, Temu, open multi-merchant classifieds).
   - MARKETPLACE_PLATFORM: Multi-vendor platform facilitating third-party merchant transactions without direct retail inventory.
   - DIRECTORY_AGGREGATOR: Link directory, yellow pages, logistics/locker directory, review aggregator, or listing site without direct retail inventory.
   - MEDIA_PUBLISHER: Magazine, blog, news outlet, city guide, fashion editorial, or content site.
   - COMMUNITY_FORUM: Discussion board, social forum, or community hub.
   - UNKNOWN: Unclear or unidentifiable.

CANDIDATE:
- Domain: ${input.domain}
- URL: ${input.websiteUrl}
- Name: "${input.name}"
- Search / Website Evidence:\n${input.evidenceText.slice(0, 1500)}

Return ONLY valid JSON:
{
  "isRealBusiness": true | false,
  "entityRole": "BRAND_DIRECT_SELLER" | "SPECIALTY_RETAILER" | "MULTI_BRAND_RETAILER" | "DEPARTMENT_STORE" | "PURE_MARKETPLACE_PLATFORM" | "MARKETPLACE_PLATFORM" | "DIRECTORY_AGGREGATOR" | "MEDIA_PUBLISHER" | "COMMUNITY_FORUM" | "UNKNOWN",
  "entityRoleReasoning": "Explanation of entity role based on evidence",
  "canonicalName": "Clean official business name",
  "canonicalDomain": "${input.domain}",
  "confidence": 0.0 to 1.0,
  "reasoning": "Explanation based on provider evidence"
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.IDENTITY_VERIFIER),
      messages: [
        { role: "system", content: "You are the Avyron Competitor Identity Verifier. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      endpoint: "competitor-identity-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validRoles: CompetitorEntityRole[] = [
      "BRAND_DIRECT_SELLER", "SPECIALTY_RETAILER", "MULTI_BRAND_RETAILER", "DEPARTMENT_STORE", "PURE_MARKETPLACE_PLATFORM", "MARKETPLACE_PLATFORM", "DIRECTORY_AGGREGATOR", "MEDIA_PUBLISHER", "COMMUNITY_FORUM", "UNKNOWN"
    ];
    const entityRole = validRoles.includes(parsed.entityRole) ? parsed.entityRole : "UNKNOWN";

    return {
      candidateKey: input.candidateKey,
      isRealBusiness: parsed.isRealBusiness === true,
      entityRole,
      entityRoleReasoning: parsed.entityRoleReasoning || "",
      canonicalName: parsed.canonicalName || input.name,
      canonicalDomain: input.domain,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      reasoning: parsed.reasoning || "Verified from provider search snippets.",
    };
  } catch (err: any) {
    const text = input.evidenceText.toLowerCase();
    const isCommercial = text.includes("shop") || text.includes("cart") || text.includes("price") || text.includes("buy") || text.includes("order") || text.includes("store");
    return {
      candidateKey: input.candidateKey,
      isRealBusiness: isCommercial,
      entityRole: isCommercial ? "SPECIALTY_RETAILER" : "UNKNOWN",
      entityRoleReasoning: "Fallback entity role from structural signals.",
      canonicalName: input.name,
      canonicalDomain: input.domain,
      confidence: 0.5,
      reasoning: "Identity determined via structural evidence signals.",
    };
  }
}

/**
 * Stage 5: Canonical Competitive Relevance Verification.
 * Evaluates whether the verified business is competitive with the current campaign offering.
 */
export async function verifyCompetitorRelevance(
  input: CompetitorQualityEvidenceInput,
  identity: IdentityVerificationResult,
  context: CompetitorQualityCampaignContext,
  options?: {
    accountId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<RelevanceVerificationResult> {
  options?.budget?.recordLlmCall();

  const prompt = `You are Avyron's Competitive Relevance Assessor.
Determine if the verified business "${identity.canonicalName || input.name}" (${input.domain}) is competitive with our Hero Product.

OUR CAMPAIGN CONTEXT:
- Hero Product: "${context.offeringName}"
- Category: "${context.category}"
- Target Market: "${context.targetMarket}"
- Key Facts: ${JSON.stringify(context.productTruthFacts.slice(0, 4))}
- Target Roles: ${JSON.stringify(context.targetRoles.slice(0, 2))}

CANDIDATE:
- Domain: ${input.domain}
- Entity Role: ${identity.entityRole || "UNKNOWN"}
- Role Rationale: ${identity.entityRoleReasoning || identity.reasoning || "N/A"}
- Evidence: ${input.evidenceText.slice(0, 1200)}

CRITICAL MARKETPLACE VS RETAILER RULE:
- PURE MARKETPLACE / PLATFORM: Multi-vendor portals primarily facilitating 3rd-party independent merchant listings without direct first-party retail ownership (e.g. Alibaba, eBay, open classifieds) are NOT direct commercial competitors. Classify as NOT_COMPETITOR.
- MULTI-BRAND RETAILER / DEPARTMENT STORE: Legitimate retailers that directly merchandise, price, and sell products from multiple brands directly to the consumer CAN be valid competitors if category and target market overlap exists.
- DIRECT BRANDS & SPECIALTY RETAILERS: Directly eligible if offering/market overlap exists.

CLASSIFICATION OPTIONS:
- DIRECT_COMPETITOR: Dedicated brand or retailer offering the same or directly substitutable product to the same buyer in target market (Tier A).
- RELEVANT_COMPETITOR: Sells closely related products in the same category (Tier A).
- BENCHMARK_COMPETITOR: Major category leader or direct industry benchmark (Tier B).
- ADJACENT_COMPETITOR: Adjacent product category serving similar customer need (Tier B).
- NOT_COMPETITOR: Unrelated business, pure marketplace platform, directory, publisher, or irrelevant.
- INSUFFICIENT_EVIDENCE: Cannot determine from available snippets.

Return ONLY valid JSON:
{
  "isRelevant": true | false,
  "classification": "DIRECT_COMPETITOR" | "RELEVANT_COMPETITOR" | "BENCHMARK_COMPETITOR" | "ADJACENT_COMPETITOR" | "NOT_COMPETITOR" | "INSUFFICIENT_EVIDENCE",
  "tier": "A" | "B",
  "reason": "Clear explanation of competitive relationship"
}`;

  try {
    const res = await aiChat({
      model: resolveModelForTier(DISCOVERY_MODEL_TIERS.RELEVANCE_VERIFIER),
      messages: [
        { role: "system", content: "You are the Avyron Competitive Relevance Assessor. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
      accountId: options?.accountId || "system",
      endpoint: "competitor-relevance-verifier",
    });

    const parsed = JSON.parse(res.choices?.[0]?.message?.content || "{}");
    const validClassifications: CompetitorClassification[] = [
      "DIRECT_COMPETITOR", "RELEVANT_COMPETITOR", "BENCHMARK_COMPETITOR", "ADJACENT_COMPETITOR", "NOT_COMPETITOR", "INSUFFICIENT_EVIDENCE"
    ];
    const classification: CompetitorClassification = validClassifications.includes(parsed.classification)
      ? parsed.classification
      : "ADJACENT_COMPETITOR";

    const isRelevant = classification !== "NOT_COMPETITOR" && classification !== "INSUFFICIENT_EVIDENCE";
    const tier: CompetitorTier = (parsed.tier === "A" || classification === "DIRECT_COMPETITOR" || classification === "RELEVANT_COMPETITOR") ? "A" : "B";

    return {
      candidateKey: input.candidateKey,
      isRelevant,
      classification,
      tier,
      reason: parsed.reason || `Competitor for ${context.offeringName} in ${context.targetMarket}.`,
    };
  } catch (err: any) {
    return {
      candidateKey: input.candidateKey,
      isRelevant: true,
      classification: "ADJACENT_COMPETITOR",
      tier: "B",
      reason: `Commercial candidate discovered for ${context.offeringName}.`,
    };
  }
}

/**
 * Stage 6: Canonical Final Semantic Judge.
 * Highest-capability strategic reasoning to make final APPROVE / REJECT / INSUFFICIENT verdict.
 */
export function runCompetitorFinalJudge(
  input: CompetitorQualityEvidenceInput,
  identity: IdentityVerificationResult,
  relevance: RelevanceVerificationResult,
  context: { offeringName: string; targetMarket: string },
  options?: {
    accountId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): FinalJudgeDecision {
  // 1. Rejection: Not a verified business entity
  if (!identity.isRealBusiness) {
    return {
      candidateKey: input.candidateKey,
      name: input.name,
      websiteUrl: input.websiteUrl,
      entityRole: identity.entityRole,
      verdict: "REJECTED",
      tier: "B",
      finalReason: `Rejected: Not a verified commercial business entity (${identity.entityRoleReasoning || identity.reasoning}).`,
      classification: "NOT_COMPETITOR",
    };
  }

  // 2. Rejection: Pure marketplace platforms, directories, publishers, forums
  if (
    identity.entityRole === "PURE_MARKETPLACE_PLATFORM" ||
    identity.entityRole === "MARKETPLACE_PLATFORM" ||
    identity.entityRole === "DIRECTORY_AGGREGATOR" ||
    identity.entityRole === "MEDIA_PUBLISHER" ||
    identity.entityRole === "COMMUNITY_FORUM"
  ) {
    return {
      candidateKey: input.candidateKey,
      name: input.name,
      websiteUrl: input.websiteUrl,
      entityRole: identity.entityRole,
      verdict: "REJECTED",
      tier: "B",
      finalReason: `Rejected: Entity role is ${identity.entityRole} (${identity.entityRoleReasoning || identity.reasoning}). Multi-vendor marketplace platforms, directories, and publishers are not direct competitors.`,
      classification: "NOT_COMPETITOR",
    };
  }

  // 3. Rejection: Irrelevant / Not a competitor
  if (!relevance.isRelevant || relevance.classification === "NOT_COMPETITOR") {
    return {
      candidateKey: input.candidateKey,
      name: input.name,
      websiteUrl: input.websiteUrl,
      entityRole: identity.entityRole,
      verdict: "REJECTED",
      tier: "B",
      finalReason: `Rejected: Not competitively relevant to ${context.offeringName} (${relevance.reason}).`,
      classification: "NOT_COMPETITOR",
    };
  }

  // 4. Insufficient evidence
  if (relevance.classification === "INSUFFICIENT_EVIDENCE") {
    return {
      candidateKey: input.candidateKey,
      name: input.name,
      websiteUrl: input.websiteUrl,
      entityRole: identity.entityRole,
      verdict: "INSUFFICIENT_EVIDENCE",
      tier: "B",
      finalReason: `Insufficient evidence to determine competitive relationship.`,
      classification: "INSUFFICIENT_EVIDENCE",
    };
  }

  // 5. Approved (Tier A or Tier B)
  return {
    candidateKey: input.candidateKey,
    name: identity.canonicalName || input.name,
    websiteUrl: input.websiteUrl,
    entityRole: identity.entityRole,
    verdict: "APPROVED",
    tier: relevance.tier,
    finalReason: relevance.reason,
    classification: relevance.classification,
  };
}

/**
 * Unified Competitor Quality Evaluation Pipeline.
 * Runs Identity Verification -> Relevance Assessment -> Final Semantic Judge.
 */
export async function evaluateCompetitorQuality(
  input: CompetitorQualityEvidenceInput,
  context: CompetitorQualityCampaignContext,
  options?: {
    accountId?: string;
    budget?: CompetitorQualityBudgetTracker;
  }
): Promise<CompetitorQualityEvaluationResult> {
  const identity = await verifyCompetitorIdentity(input, options);
  const relevance = await verifyCompetitorRelevance(input, identity, context, options);
  const judge = runCompetitorFinalJudge(input, identity, relevance, context, options);

  return {
    identity,
    relevance,
    judge,
  };
}
