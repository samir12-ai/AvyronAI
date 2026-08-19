import { z } from "zod";
import { aiChat } from "../ai-client";
import { type ProductAnchor, safeJsonParse } from "./strategic-doctrine";

export const ProductTruthVerdictSchema = z.enum([
  "ACCEPTED",
  "REJECTED",
  "NOT_RUN",
]);
export type ProductTruthVerdict = z.infer<typeof ProductTruthVerdictSchema>;

export const ClaimClassificationSchema = z.enum([
  "VALIDATED_CAPABILITY",       // Category A: Existing capability verified against Product Anchor / BDL
  "STRATEGIC_DIRECTION",       // Category B: Evidence-supported strategic recommendation / direction
  "INVENTED_CAPABILITY",        // Category C: Hallucinated operational capability, feature, or SLA presented as existing truth
  "CAPABILITY_OR_PROOF_GAP",    // Honest admission that capability or proof is currently missing
]);
export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;

export interface ProductTruthResult {
  verdict: ProductTruthVerdict;
  classification: ClaimClassification;
  reason: string;
  fix: string;
  unsupportedClaims: string[];
}

const ProductTruthLlmResponseSchema = z.object({
  verdict: z.enum(["ACCEPTED", "REJECTED"]),
  classification: ClaimClassificationSchema,
  reason: z.string().min(1),
  fix: z.string().default(""),
  unsupportedClaims: z.array(z.string()).default([]),
});

export function buildProductTruthPrompt(
  candidateText: string,
  anchor: ProductAnchor | null,
  businessContext?: {
    businessType?: string;
    coreOffer?: string;
    targetAudience?: string;
    validatedCapabilities?: string[];
  } | null
): string {
  const anchorSection = anchor
    ? `=== VALIDATED PRODUCT ANCHOR ===
- Product Name: ${anchor.name}
- Product Type: ${anchor.type}
- Key Attributes: ${anchor.keyAttributes.length ? anchor.keyAttributes.join("; ") : "None listed"}
- Core Problem Solved: ${anchor.coreProblemSolved}
- Differentiating Feature: ${anchor.differentiatingFeature}`
    : `=== VALIDATED PRODUCT ANCHOR ===
(No explicit Product Anchor provided. Evaluate against general business context.)`;

  const contextSection = businessContext
    ? `\n=== VALIDATED BUSINESS CONTEXT ===
- Business Type: ${businessContext.businessType || "Unknown"}
- Core Offer: ${businessContext.coreOffer || "Unknown"}
- Target Audience: ${businessContext.targetAudience || "Unknown"}
- Validated Capabilities: ${(businessContext.validatedCapabilities || []).join("; ") || "None registered"}`
    : "";

  return `You are the hostile PRODUCT TRUTH & GROUNDING JUDGE for an AI strategic marketing system.
Your mission is to ensure that the strategy NEVER hallucinated operational capabilities, guarantees, technical integrations, regulatory certifications, or delivery promises that the business does not actually possess.

${anchorSection}${contextSection}

=== CLASSIFICATION RULES ===
1. VALIDATED_CAPABILITY (Category A - ACCEPT): An existing feature, service, or operational fact directly supported by the Validated Product Anchor or Business Context above.
2. STRATEGIC_DIRECTION (Category B - ACCEPT): A recommendation or strategic choice of what the business SHOULD do or prioritize (e.g., "The business should establish verifiable batch testing", "Focus messaging on delivery certainty rather than broad health outcomes").
3. CAPABILITY_OR_PROOF_GAP (ACCEPT): An explicit acknowledgement that proof or capability is missing (e.g., "Proof Gap: Clinical trial documentation is not yet available; prioritize gathering customer testimonials").
4. INVENTED_CAPABILITY (Category C - REJECT): Any claim that presents an unvalidated operational capability, SLA, technical feature, guarantee, or partnership as an ALREADY EXISTING reality (e.g., "Our real-time inventory tracking system", "Guaranteed zero-stockout SLA", "Exclusive UAE regulatory certification", "Direct proprietary clinic API").

CRITICAL PRINCIPLE:
- Distinguish RECOMMENDED FUTURE STRATEGY ("we should build inventory visibility") from FACTUAL CAPABILITY CLAIMS ("we provide real-time automated inventory sync"). The former is valid strategy; the latter is a hallucination unless validated.
- Do NOT reject honest admissions of missing proof or limited differentiation.
- Do NOT accept invented operational features merely because they sound impressive.

=== TEXT TO AUDIT ===
"""
${candidateText}
"""

Return ONLY a JSON object matching this schema:
{
  "verdict": "ACCEPTED" | "REJECTED",
  "classification": "VALIDATED_CAPABILITY" | "STRATEGIC_DIRECTION" | "INVENTED_CAPABILITY" | "CAPABILITY_OR_PROOF_GAP",
  "reason": "Clear explanation citing the exact phrase and why it passes or fails",
  "fix": "If REJECTED, specific instruction on how to reframe as a strategic direction or remove the hallucinated claim",
  "unsupportedClaims": ["list of any invented capabilities found"]
}`;
}

export async function judgeProductTruthGrounding(input: {
  candidateText: string;
  productAnchor: ProductAnchor | null;
  accountId: string;
  businessContext?: {
    businessType?: string;
    coreOffer?: string;
    targetAudience?: string;
    validatedCapabilities?: string[];
  } | null;
}): Promise<ProductTruthResult> {
  const { candidateText, productAnchor, accountId, businessContext } = input;

  if (!candidateText || !candidateText.trim()) {
    return {
      verdict: "NOT_RUN",
      classification: "CAPABILITY_OR_PROOF_GAP",
      reason: "EMPTY_CANDIDATE: nothing to audit",
      fix: "",
      unsupportedClaims: [],
    };
  }

  try {
    const resp = await aiChat({
      messages: [{ role: "user", content: buildProductTruthPrompt(candidateText, productAnchor, businessContext) }],
      model: "gpt-4.1-mini",
      temperature: 0.1,
      max_tokens: 400,
      accountId,
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() ?? null;
    const parsed = safeJsonParse(raw, ProductTruthLlmResponseSchema);

    if (!parsed) {
      console.warn(`[ProductTruthJudge] UNPARSEABLE verdict=NOT_RUN | raw="${(raw ?? "").slice(0, 80)}"`);
      return {
        verdict: "NOT_RUN",
        classification: "STRATEGIC_DIRECTION",
        reason: "JUDGE_ERROR: unparseable output",
        fix: "",
        unsupportedClaims: [],
      };
    }

    console.log(`[ProductTruthJudge] verdict=${parsed.verdict} classification=${parsed.classification} reason="${parsed.reason.slice(0, 80)}"`);
    return {
      verdict: parsed.verdict,
      classification: parsed.classification,
      reason: parsed.reason,
      fix: parsed.fix,
      unsupportedClaims: parsed.unsupportedClaims,
    };
  } catch (err: any) {
    console.error(`[ProductTruthJudge] CALL_FAILED: ${err.message}`);
    return {
      verdict: "NOT_RUN",
      classification: "STRATEGIC_DIRECTION",
      reason: `JUDGE_ERROR: ${err.message}`,
      fix: "",
      unsupportedClaims: [],
    };
  }
}
