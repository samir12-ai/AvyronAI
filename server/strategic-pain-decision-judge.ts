import { z } from "zod";
import { aiGemini, aiChat } from "./ai-client";
import { db } from "./db";
import { strategicPainDecisions } from "@shared/schema";
import type { StrategicPainMateriality } from "./shared/audience-pain-registry";
import { computePainContentHash } from "./shared/audience-pain-registry";

export interface StrategicPainDecisionInput {
  jobId: string;
  painId: string;
  audienceSnapshotId?: string;
  targetUnderstandingAuthorityId: string;
  productTruthFactIds: string[];
  campaignOfferingId: string;
  targetAssessmentAuthorityId: string;
  productAssessmentAuthorityId: string;
  
  // Passed in parents for validation
  targetAssessmentParentAuthorityIds: string[]; 
  productAssessmentParentAuthorityIds: string[];
  
  targetAssessmentJobId: string;
  productAssessmentJobId: string;
  
  painClaim: string;
  productFitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
  targetCoverageDecision: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";

  materiality: StrategicPainMateriality;

  productTruthFacts?: Array<{
    productTruthFactId?: string;
    factId?: string;
    statement?: string;
    factType?: string;
    [key: string]: any;
  }>;
  productAssessmentReason?: string;

  accountId?: string;
  campaignId?: string;
}

export interface StrategicPainDecisionResult {
  painId: string;
  status: "COMPLETE" | "INCOMPLETE";
  finalClassification: "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE" | "DROPPED";
  reason: string;
  strategicPainDecisionAuthorityId: string;
  parentAuthorityIds: string[];
  jobId: string;
  targetAssessmentAuthorityId: string;
  productAssessmentAuthorityId: string;
  targetUnderstandingAuthorityId: string;
  campaignOfferingId: string;
  productTruthFactIds: string[];
}

export interface SpdExplanationGroundingResult {
  valid: boolean;
  status: "GROUNDED" | "REPAIRED" | "EXPLANATION_GROUNDING_INCOMPLETE";
  groundedReason: string;
  critique?: string;
  unverifiedProposedReason?: string;
}

/**
 * Hostile SPD Explanation Grounding Judge & Targeted Bounded Repair
 * Ensures the explanatory text strictly reflects verified Product Truth facts,
 * Target Assessment, and Product Assessment without inventing ungrounded software/mechanisms.
 * Executes a bounded retry/repair loop (up to 3 attempts) before failing closed on explanation verification.
 */
export async function judgeAndRepairSpdExplanation(opts: {
  painClaim: string;
  finalClassification: "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE" | "DROPPED";
  proposedReason: string;
  productFitType: string;
  targetCoverageDecision: string;
  productTruthFacts?: any[];
  productAssessmentReason?: string;
  accountId?: string;
}): Promise<SpdExplanationGroundingResult> {
  const {
    painClaim,
    finalClassification,
    proposedReason,
    productFitType,
    targetCoverageDecision,
    productTruthFacts = [],
    productAssessmentReason = "",
    accountId = "system"
  } = opts;

  const factsSummary = productTruthFacts.length > 0
    ? productTruthFacts.map((f: any) => `- [${f.factType || 'FACT'}] ${f.statement || f.fact || JSON.stringify(f)}`).join("\n")
    : "No verified Product Truth facts provided.";

  const MAX_ATTEMPTS = 3;
  let lastError = "Initial generation unstarted";
  let lastRawResponse = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isRepairAttempt = attempt > 1;
    const prompt = isRepairAttempt
      ? `You are the Hostile Strategic Explanation Grounding Judge (TARGETED REPAIR Attempt ${attempt} of ${MAX_ATTEMPTS}).
A previous grounding evaluation failed validation.

INPUTS:
- PAIN CLAIM: "${painClaim}"
- TARGET RELATIONSHIP (WHO): ${targetCoverageDecision}
- PRODUCT RELATIONSHIP (WHAT): ${productFitType}
- PRODUCT ASSESSMENT RATIONALE: "${productAssessmentReason}"
- VERIFIED PRODUCT TRUTH FACTS:
${factsSummary}
- STRATEGIC CLASSIFICATION: ${finalClassification}
- PROPOSED EXPLANATION: "${proposedReason}"

PREVIOUS VALIDATION ERROR:
${lastError}
${lastRawResponse ? `PREVIOUS INVALID RAW RESPONSE:\n${lastRawResponse}\n` : ""}
GROUNDING RULES:
1. NO INVENTED CAPABILITIES OR MECHANISMS:
   - The explanation MUST NOT assert or imply capabilities, software platforms, automated tooling, or mechanisms (e.g. "inventory tracking software", "automated stock signaling", "fulfillment transparency platform", "logistics tracking system", "real-time inventory management") that are NOT explicitly established in the Verified Product Truth facts or Product Assessment.
   - If the business is an apparel or retail brand with standard eCommerce pages, do NOT reframe standard product catalog display as "inventory signaling" or "tracking software".
2. ACCURATE FIT REPRESENTATION:
   - The explanation must faithfully represent the Product Assessment rationale without exaggerating or inventing bridges.
3. CONCISE CAUSAL RIGOR:
   - The explanation should clearly justify the ${finalClassification} classification using the WHO (Target), WHAT (Product Fit), and Materiality dimensions.

CORRECTION INSTRUCTIONS:
- You MUST return a single valid JSON object matching the exact schema below.
- If grounded is true, you may omit "repairedReason" or return proposedReason.
- If grounded is false (meaning the proposed explanation asserted unverified software/capabilities), you MUST provide a non-empty, faithful "repairedReason" (at least 10 characters) explaining the ${finalClassification} classification using ONLY verified facts.

Output JSON format exactly:
{
  "grounded": true | false,
  "critique": "Brief assessment",
  "repairedReason": "Faithful, strictly grounded explanation (required if grounded is false)"
}`
      : `You are the Hostile Strategic Explanation Grounding Judge.
Your sole job is to audit the generated strategic explanation for truthfulness against verified inputs.

INPUTS:
- PAIN CLAIM: "${painClaim}"
- TARGET RELATIONSHIP (WHO): ${targetCoverageDecision}
- PRODUCT RELATIONSHIP (WHAT): ${productFitType}
- PRODUCT ASSESSMENT RATIONALE: "${productAssessmentReason}"
- VERIFIED PRODUCT TRUTH FACTS:
${factsSummary}
- STRATEGIC CLASSIFICATION: ${finalClassification}
- PROPOSED EXPLANATION: "${proposedReason}"

GROUNDING RULES:
1. NO INVENTED CAPABILITIES OR MECHANISMS:
   - The explanation MUST NOT assert or imply capabilities, software platforms, automated tooling, or mechanisms (e.g. "inventory tracking software", "automated stock signaling", "fulfillment transparency platform", "logistics tracking system", "real-time inventory management") that are NOT explicitly established in the Verified Product Truth facts or Product Assessment.
   - If the business is an apparel or retail brand with standard eCommerce pages, do NOT reframe standard product catalog display as "inventory signaling" or "tracking software".
2. ACCURATE FIT REPRESENTATION:
   - The explanation must faithfully represent the Product Assessment rationale without exaggerating or inventing bridges.
3. CONCISE CAUSAL RIGOR:
   - The explanation should clearly justify the ${finalClassification} classification using the WHO (Target), WHAT (Product Fit), and Materiality dimensions.

TASK:
1. Decide if the proposed explanation is "GROUNDED" (contains no invented capabilities or false bridges) or "UNGROUNDED" (invents capabilities, software mechanisms, or unverified facts).
2. If UNGROUNDED, provide a "repairedReason" that explains the exact same ${finalClassification} classification faithfully without any invented capabilities.

Output JSON format:
{
  "grounded": true | false,
  "critique": "Brief assessment",
  "repairedReason": "Faithful, strictly grounded explanation (required if grounded is false, otherwise omit or return proposedReason)"
}`;

    try {
      const res = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        max_tokens: 1024,
        response_format: { type: "json_object" },
        accountId,
        endpoint: "spd-explanation-judge"
      });

      lastRawResponse = res.choices[0]?.message?.content || "";
      let parsed: any;
      try {
        parsed = JSON.parse(lastRawResponse);
      } catch (parseErr: any) {
        lastError = `JSON parse failed: ${parseErr.message}`;
        console.warn(`[StrategicPainJudge] SPD explanation judge attempt ${attempt}/${MAX_ATTEMPTS} malformed JSON: ${parseErr.message}`);
        continue;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "Response was not a valid JSON object";
        console.warn(`[StrategicPainJudge] SPD explanation judge attempt ${attempt}/${MAX_ATTEMPTS} invalid root object`);
        continue;
      }

      if (typeof parsed.grounded !== "boolean") {
        lastError = "Field 'grounded' was missing or not a boolean";
        console.warn(`[StrategicPainJudge] SPD explanation judge attempt ${attempt}/${MAX_ATTEMPTS} invalid 'grounded' field`);
        continue;
      }

      const critique = typeof parsed.critique === "string" ? parsed.critique.trim() : "";

      if (parsed.grounded === true) {
        return {
          valid: true,
          status: "GROUNDED",
          groundedReason: proposedReason,
          critique,
          unverifiedProposedReason: proposedReason
        };
      }

      if (parsed.grounded === false) {
        if (!parsed.repairedReason || typeof parsed.repairedReason !== "string" || parsed.repairedReason.trim().length < 10) {
          lastError = "Field 'grounded' was false but 'repairedReason' was missing or less than 10 characters";
          console.warn(`[StrategicPainJudge] SPD explanation judge attempt ${attempt}/${MAX_ATTEMPTS} missing/invalid repairedReason`);
          continue;
        }
        return {
          valid: true,
          status: "REPAIRED",
          groundedReason: parsed.repairedReason.trim(),
          critique,
          unverifiedProposedReason: proposedReason
        };
      }
    } catch (chatErr: any) {
      lastError = `Provider error: ${chatErr.message}`;
      console.warn(`[StrategicPainJudge] SPD explanation judge attempt ${attempt}/${MAX_ATTEMPTS} provider error: ${chatErr.message}`);
    }
  }

  // All bounded attempts exhausted -> FAIL CLOSED on explanation (Preserving classification)
  console.warn(`[StrategicPainJudge] SPD_EXPLANATION_GROUNDING_EXHAUSTED | painClaim="${painClaim}" | attempts=${MAX_ATTEMPTS} | lastError=${lastError}`);
  return {
    valid: false,
    status: "EXPLANATION_GROUNDING_INCOMPLETE",
    groundedReason: `EXPLANATION_GROUNDING_INCOMPLETE: Explanation could not be verified against Product Truth after ${MAX_ATTEMPTS} attempts (${lastError})`,
    critique: `SPD explanation grounding exhausted ${MAX_ATTEMPTS} bounded attempts. Last error: ${lastError}`,
    unverifiedProposedReason: proposedReason
  };
}

export async function judgeStrategicPainDecision(
  input: StrategicPainDecisionInput
): Promise<StrategicPainDecisionResult> {
  const {
    jobId,
    painId,
    targetUnderstandingAuthorityId,
    productTruthFactIds,
    campaignOfferingId,
    targetAssessmentAuthorityId,
    productAssessmentAuthorityId,
    targetAssessmentParentAuthorityIds,
    productAssessmentParentAuthorityIds,
    targetAssessmentJobId,
    productAssessmentJobId,
    painClaim,
    productFitType,
    targetCoverageDecision,
    materiality,
    productTruthFacts = [],
    productAssessmentReason = "",
    accountId = "default",
    campaignId = "default"
  } = input;
  
  const strategicPainDecisionAuthorityId = `spd_${jobId}_${painId}`;

  // Runtime assertion on materiality contract (User Correction 5)
  if (!materiality || (materiality.mode !== "GROUNDED" && materiality.mode !== "NONE") || (materiality.mode === "GROUNDED" && (!Array.isArray(materiality.evidence) || materiality.evidence.length === 0))) {
    const incompleteRes: StrategicPainDecisionResult = {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: "Invalid or missing materiality contract on StrategicPainDecisionInput",
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [],
      jobId,
      targetAssessmentAuthorityId: targetAssessmentAuthorityId || "UNKNOWN",
      productAssessmentAuthorityId: productAssessmentAuthorityId || "UNKNOWN",
      targetUnderstandingAuthorityId: targetUnderstandingAuthorityId || "UNKNOWN",
      campaignOfferingId: campaignOfferingId || "UNKNOWN",
      productTruthFactIds: productTruthFactIds || []
    };
    await persistDecision(incompleteRes, accountId, campaignId);
    return incompleteRes;
  }

  // 1. Lineage & Identity Validation
  if (!targetAssessmentAuthorityId || !productAssessmentAuthorityId || !productTruthFactIds || productTruthFactIds.length === 0) {
    const incompleteRes: StrategicPainDecisionResult = {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: "Missing upstream authority IDs or product truth facts",
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [],
      jobId,
      targetAssessmentAuthorityId: targetAssessmentAuthorityId || "UNKNOWN",
      productAssessmentAuthorityId: productAssessmentAuthorityId || "UNKNOWN",
      targetUnderstandingAuthorityId: targetUnderstandingAuthorityId || "UNKNOWN",
      campaignOfferingId: campaignOfferingId || "UNKNOWN",
      productTruthFactIds: productTruthFactIds || []
    };
    await persistDecision(incompleteRes, accountId, campaignId);
    return incompleteRes;
  }

  // Ensure job IDs match
  if (targetAssessmentJobId !== jobId || productAssessmentJobId !== jobId) {
    const incompleteRes: StrategicPainDecisionResult = {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: `JobId mismatch: expected ${jobId}, got Target:${targetAssessmentJobId}, Product:${productAssessmentJobId}`,
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [],
      jobId,
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      targetUnderstandingAuthorityId,
      campaignOfferingId,
      productTruthFactIds
    };
    await persistDecision(incompleteRes, accountId, campaignId);
    return incompleteRes;
  }

  // Ensure parent authorities contain the expected painId and base understanding
  if (!targetAssessmentParentAuthorityIds.includes(painId) || !productAssessmentParentAuthorityIds.includes(painId)) {
    const incompleteRes: StrategicPainDecisionResult = {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: "PainId not found in parent authority lineage",
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [],
      jobId,
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      targetUnderstandingAuthorityId,
      campaignOfferingId,
      productTruthFactIds
    };
    await persistDecision(incompleteRes, accountId, campaignId);
    return incompleteRes;
  }

  // We consider it INCOMPLETE if they don't trace back to the same targetUnderstanding
  if (!targetAssessmentParentAuthorityIds.includes(targetUnderstandingAuthorityId)) {
    const incompleteRes: StrategicPainDecisionResult = {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: "Target Assessment does not trace to Target Understanding Authority",
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [],
      jobId,
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      targetUnderstandingAuthorityId,
      campaignOfferingId,
      productTruthFactIds
    };
    await persistDecision(incompleteRes, accountId, campaignId);
    return incompleteRes;
  }

  const factsSummary = productTruthFacts.length > 0
    ? productTruthFacts.map((f: any) => `- [${f.factType || 'FACT'}] ${f.statement || f.fact || JSON.stringify(f)}`).join("\n")
    : "No verified Product Truth facts provided.";

  const materialitySection = materiality.mode === "GROUNDED"
    ? `3. Pain Materiality (HOW CONSEQUENTIAL & EMPIRICAL EVIDENCE):
   - Grounded Customer Evidence: ${materiality.uniqueEvidenceCount} unique customer evidence items (${materiality.rawCitationCount} citations across market data)
   - Evidence UIDs: ${materiality.rawEvidenceUids.join(", ")}
   - Source Channels / Types: ${materiality.sourceTypes.join(", ")}
${materiality.uniqueCompetitorCount ? `   - Unique Competitor Spread: ${materiality.uniqueCompetitorCount} competitors\n` : ""}` +
`   - Grounded Customer Evidence Excerpts:
${materiality.evidence.map(e => `     * ${e.boundedExcerpt}`).join("\n")}`
    : `3. Pain Materiality (HOW CONSEQUENTIAL & EMPIRICAL EVIDENCE):
   - No empirical customer evidence bound for this pain claim.`;

  // 2. Coherent Strategic Decision Logic (Holistic 3-Dimensional Reasoning)
  const prompt = `
You are the Strategic Pain Decision Judge.
You are evaluating the legitimate strategic role of a market pain for an offering campaign.

PAIN CLAIM:
"${painClaim}"

EVALUATION DOSSIER:
1. Target Relationship (WHO): ${targetCoverageDecision}
   - COVERED: Discovered audience legitimately represents target buyer/user roles.
   - RELATED_BUT_UNPROVEN: Overlap exists, but exact role membership has some uncertainty.
   - NOT_COVERED: Discovered audience genuinely represents a different population.

2. Product Relationship (WHAT): ${productFitType}
   - DIRECT_FIT: Offering directly performs OR directly enables the function required to address this pain.
   - STRATEGIC_FIT: Offering supports strategic reasoning/decisions, but does not perform the direct operational function.
   - NOT_FIT: Offering does not legitimately address the pain.
   ${productAssessmentReason ? `\n   Product Assessment Rationale: "${productAssessmentReason}"` : ""}

   VERIFIED PRODUCT TRUTH FACTS:
${factsSummary}

${materialitySection}

STRATEGIC ROLE DEFINITIONS & DOCTRINE:
- CORE_PURCHASE:
  A material and consequential market pain that is sufficiently connected to the intended audience (including when target is RELATED_BUT_UNPROVEN if product fit is DIRECT_FIT or STRATEGIC_FIT and evidence is material) and legitimately addressable by the offering strongly enough to anchor the primary value proposition.
  * PRODUCT CRITERIA VS LOGISTICAL FRICTION: Customer feedback about intrinsic product attributes (e.g. sheer/transparent fabric, fabric breathability, sizing accuracy, fit comfort, fabric quality, price-to-value perception, styling suitability) directly reflects pre-purchase buying criteria and product evaluation. Even if the feedback was gathered from customer reviews, these issues are primary purchase drivers; classify them as CORE_PURCHASE when verified product truth or strategic proposals address or mitigate them.
  * PURELY LOGISTICAL POST-PURCHASE FRICTION: Frictions purely concerning post-sale logistical processing (e.g. courier tracking delays, return label printing steps, refund bank processing time) should be classified as SUPPORTING (or EXCLUDE) unless evidence demonstrates an explicit market reputation barrier stopping initial purchases.
  * DIRECT_FIT & STRATEGIC_FIT: When an offering directly or strategically addresses a primary buying constraint, product quality concern, or fit issue for its target audience, classify as CORE_PURCHASE.
  * Note: COVERED + DIRECT_FIT is NOT automatic CORE; pain must be commercially consequential and purchase-driving.
  * Note: Citation counts are factual observations, not fixed mathematical score thresholds.
  * Note: A pain with 1 or 2 citations CAN be CORE_PURCHASE if the evidence describes a severe, high-stakes commercial consequence.
  * Note: A pain with many citations does NOT automatically become CORE_PURCHASE if the problem is shallow or purely logistical.
  * Note: RELATED_BUT_UNPROVEN is NOT an automatic veto against CORE; reason over the full dossier.
  * Note: Competitive uniqueness / differentiation belongs to downstream engines, NOT to this decision.

- SUPPORTING:
  A pain that is legitimately addressable or strategically relevant, but serves as secondary/supporting messaging, objection handling, after-sale reassurance, or lacks the primary commercial purchase consequence needed to anchor the campaign.

- EXCLUDE:
  The pain is NOT_FIT for the offering, or genuinely NOT_COVERED (different population), or completely out of scope.

EXPLANATION GROUNDING INVARIANT:
- Your explanatory reason MUST NOT invent capabilities, software systems, or platforms (e.g. inventory tracking software, automated stock signaling, fulfillment transparency technology) that do not exist in verified Product Truth.
- State the fit relationship strictly based on the verified facts.

Output JSON format exactly:
{
  "finalClassification": "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE",
  "reason": "Holistic strategic justification distinguishing Target relationship (WHO), Product relationship (WHAT), and Material consequence."
}
`;
  
  let finalClassification: "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE" | "DROPPED" = "SUPPORTING";
  let reason = "Evaluated by Strategic Pain Decision Judge";
  
  try {
    const chatRes = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4.1-mini",
      max_tokens: 1024,
      response_format: { type: "json_object" },
      accountId: accountId || "system",
      endpoint: "strategic-pain-judge"
    });
    const parsed = JSON.parse(chatRes.choices[0]?.message?.content || "{}");
    if (["CORE_PURCHASE", "SUPPORTING", "EXCLUDE", "DROPPED"].includes(parsed.finalClassification)) {
      finalClassification = parsed.finalClassification;
      reason = parsed.reason || reason;
    }
  } catch (chatErr: any) {
    console.error(`[StrategicPainJudge] Evaluation failed: ${chatErr.message}`);
    return {
      painId,
      status: "INCOMPLETE",
      finalClassification: "DROPPED",
      reason: `Strategic Pain Decision evaluation error: ${chatErr.message}`,
      strategicPainDecisionAuthorityId,
      parentAuthorityIds: [targetAssessmentAuthorityId, productAssessmentAuthorityId, painId],
      jobId,
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      targetUnderstandingAuthorityId,
      campaignOfferingId,
      productTruthFactIds
    };
  }

  // 3. Independent Hostile Explanation Grounding Check & Bounded Repair
  // Run LLM explanation repair only when proposedReason introduces suspect software/capability/guarantee terms
  // absent from verified Product Truth facts and Product Assessment rationale.
  if (finalClassification !== "DROPPED") {
    const verifiedCorpusLower = `${factsSummary} ${productAssessmentReason} ${painClaim}`.toLowerCase();
    const reasonLower = reason.toLowerCase();
    const SUSPECT_UNGROUNDED_TERMS = [
      "inventory tracking",
      "stock signaling",
      "fulfillment transparency",
      "logistics tracking",
      "real-time inventory",
      "warehouse automation",
      "tracking software",
      "sizing tech platform",
      "automated stock",
      "supply chain software",
      "erp system",
      "permanent and unrestricted",
      "100% guarantee",
      "money-back guarantee",
    ];
    const hasSuspectTerm = SUSPECT_UNGROUNDED_TERMS.some(
      term => reasonLower.includes(term) && !verifiedCorpusLower.includes(term)
    );
    if (hasSuspectTerm) {
      const explanationAudit = await judgeAndRepairSpdExplanation({
        painClaim,
        finalClassification: finalClassification as any,
        proposedReason: reason,
        productFitType,
        targetCoverageDecision,
        productTruthFacts,
        productAssessmentReason,
        accountId
      });
      if (explanationAudit.status === "REPAIRED") {
        console.log(`[StrategicPainJudge] SPD_REASON_REPAIRED | painId=${painId} | critique=${explanationAudit.critique || 'ungrounded capability removed'}`);
        reason = explanationAudit.groundedReason;
      } else if (explanationAudit.status === "EXPLANATION_GROUNDING_INCOMPLETE") {
        console.warn(`[StrategicPainJudge] SPD_REASON_GROUNDING_INCOMPLETE | painId=${painId} | critique=${explanationAudit.critique}`);
        reason = explanationAudit.groundedReason;
      }
    }
  }

  const painContentHash = painClaim ? computePainContentHash(painClaim) : undefined;

  const result: StrategicPainDecisionResult = {
    painId,
    status: "COMPLETE",
    finalClassification,
    reason,
    strategicPainDecisionAuthorityId,
    parentAuthorityIds: [
      targetAssessmentAuthorityId,
      productAssessmentAuthorityId,
      painId
    ],
    jobId,
    targetAssessmentAuthorityId,
    productAssessmentAuthorityId,
    targetUnderstandingAuthorityId,
    campaignOfferingId,
    productTruthFactIds,
    ...(painClaim ? { painClaim } : {}),
    ...(painContentHash ? { painContentHash } : {}),
  } as any;

  await persistDecision(result, accountId, campaignId, materiality, painClaim, painContentHash, (input as any).audienceSnapshotId);

  return result;
}

async function persistDecision(
  res: StrategicPainDecisionResult,
  accountId: string,
  campaignId: string,
  materiality?: any,
  painClaim?: string,
  painContentHash?: string,
  audienceSnapshotId?: string,
) {
  try {
    await db.insert(strategicPainDecisions).values({
      id: res.strategicPainDecisionAuthorityId,
      jobId: res.jobId,
      campaignId,
      accountId,
      painId: res.painId,
      targetAssessmentAuthorityId: res.targetAssessmentAuthorityId,
      productAssessmentAuthorityId: res.productAssessmentAuthorityId,
      finalClassification: res.finalClassification,
      status: res.status,
      reason: res.reason,
      payload: { ...res, materiality, painClaim, painContentHash, audienceSnapshotId } as any,
    });
  } catch (dbErr: any) {
    console.warn(`[StrategicPainJudge] Failed to persist decision ${res.strategicPainDecisionAuthorityId}: ${dbErr.message}`);
  }
}
