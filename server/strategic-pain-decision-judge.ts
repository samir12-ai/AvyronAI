import { z } from "zod";
import { aiGemini, aiChat } from "./ai-client";
import { db } from "./db";
import { strategicPainDecisions } from "@shared/schema";

export interface StrategicPainDecisionInput {
  jobId: string;
  painId: string;
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

  materialityContext?: {
    citationCount?: number;
    uniqueEvidenceCount?: number;
    uniqueSourceCount?: number;
    uniqueCompetitorCount?: number;
    occurrenceCount?: number;
    sourceTypes?: string[];
    evidenceUids?: string[];
    sourceSignalIds?: string[];
    evidenceSummaries?: string[];
    evidenceStrength?: number;
  };

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
    materialityContext,
    accountId = "default",
    campaignId = "default"
  } = input;
  
  const strategicPainDecisionAuthorityId = `spd_${jobId}_${painId}`;

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

3. Pain Materiality (HOW CONSEQUENTIAL & EMPIRICAL EVIDENCE):
   - Evidence Citations / Occurrences: ${materialityContext?.citationCount ?? materialityContext?.evidenceUids?.length ?? (materialityContext?.occurrenceCount ?? 1)} total citations across market data
   - Evidence UIDs: ${materialityContext?.evidenceUids?.length ? materialityContext.evidenceUids.join(", ") : "None"}
   - Source Channels / Types: ${materialityContext?.sourceTypes?.length ? materialityContext.sourceTypes.join(", ") : "Market evidence"}
   ${materialityContext?.uniqueCompetitorCount ? `- Unique Competitor Spread: ${materialityContext.uniqueCompetitorCount} competitors` : ""}
   ${materialityContext?.evidenceSummaries && materialityContext.evidenceSummaries.length > 0 ? `- Grounded Evidence Context:\n${materialityContext.evidenceSummaries.map(s => `     * "${s}"`).join("\n")}` : ""}

STRATEGIC ROLE DEFINITIONS & DOCTRINE:
- CORE_PURCHASE:
  A material and consequential market pain that is sufficiently connected to the intended audience (including when target is RELATED_BUT_UNPROVEN if product fit is DIRECT_FIT and evidence is material) and legitimately addressable by the offering strongly enough to anchor the primary value proposition.
  * Note: COVERED + DIRECT_FIT is NOT automatic CORE; pain must be commercially consequential.
  * Note: Citation counts are factual observations, not fixed mathematical score thresholds.
  * Note: A pain with 1 or 2 citations CAN be CORE_PURCHASE if the evidence describes a severe, high-stakes commercial consequence.
  * Note: A pain with many citations does NOT automatically become CORE_PURCHASE if the problem is shallow or minor.
  * Note: RELATED_BUT_UNPROVEN is NOT an automatic veto against CORE; reason over the full dossier.
  * Note: Competitive uniqueness / differentiation belongs to downstream engines, NOT to this decision.

- SUPPORTING:
  A pain that is legitimately addressable or strategically relevant, but serves as secondary/supporting messaging, objection handling, or lacks the primary commercial purchase consequence needed to anchor the campaign.

- EXCLUDE:
  The pain is NOT_FIT for the offering, or genuinely NOT_COVERED (different population), or completely out of scope.

Output JSON format exactly:
{
  "finalClassification": "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE",
  "reason": "Holistic strategic justification distinguishing Target relationship (WHO), Product relationship (WHAT), and Material consequence."
}
`;
  
  let finalClassification: "CORE_PURCHASE" | "SUPPORTING" | "EXCLUDE" | "DROPPED" = "SUPPORTING";
  let reason = "Evaluated by Strategic Pain Decision Judge";
  
  try {
    const rawResult: any = await aiGemini({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 2048 },
      model: "gemini-3.6-flash",
      accountId: "system"
    });
    let text = typeof rawResult === "string" ? rawResult : rawResult?.candidates?.[0]?.content?.parts?.[0]?.text || rawResult?.text || "";
    text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    
    const parsed = JSON.parse(text || "{}");
    if (["CORE_PURCHASE", "SUPPORTING", "EXCLUDE", "DROPPED"].includes(parsed.finalClassification)) {
      finalClassification = parsed.finalClassification;
      reason = parsed.reason || reason;
    }
  } catch (e: any) {
    console.warn(`[StrategicPainJudge] aiGemini fallback to aiChat: ${e.message}`);
    try {
      const chatRes = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        max_tokens: 1024,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "strategic-pain-judge"
      });
      const parsed = JSON.parse(chatRes.choices[0]?.message?.content || "{}");
      if (["CORE_PURCHASE", "SUPPORTING", "EXCLUDE", "DROPPED"].includes(parsed.finalClassification)) {
        finalClassification = parsed.finalClassification;
        reason = parsed.reason || reason;
      }
    } catch (chatErr: any) {
      reason = "AI Evaluation Failed - defaulted to SUPPORTING";
      finalClassification = "SUPPORTING";
    }
  }

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
    productTruthFactIds
  };

  await persistDecision(result, accountId, campaignId);

  return result;
}

async function persistDecision(res: StrategicPainDecisionResult, accountId: string, campaignId: string) {
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
      payload: res as any,
    });
  } catch (dbErr: any) {
    console.warn(`[StrategicPainJudge] Failed to persist decision ${res.strategicPainDecisionAuthorityId}: ${dbErr.message}`);
  }
}
