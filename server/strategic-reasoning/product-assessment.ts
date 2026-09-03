import { db } from "../db";
import { productAssessments } from "@shared/schema";
import { aiGemini, aiChat } from "../ai-client";

export interface ProductAssessmentInput {
  painId: string;
  canonicalPain: string;
  campaignOfferingId: string;
  businessUnderstandingAuthorityId: string;
  productTruthFacts: Array<{
    productTruthFactId?: string;
    factId?: string;
    statement?: string;
    verifiedCapability?: string;
    boundaryLimitation?: string;
    [key: string]: any;
  }>;
  accountId: string;
  campaignId: string;
  jobId: string;
  existingAssessment?: {
    productAssessmentAuthorityId: string;
    status: string;
    fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
    jobId: string;
    accountId: string;
    campaignId: string;
    painId: string;
    campaignOfferingId: string;
    productTruthFactIds: string[];
    reason?: string;
  };
}

export interface ProductAssessmentResult {
  productAssessmentAuthorityId: string;
  painId: string;
  campaignOfferingId: string;
  businessUnderstandingAuthorityId: string;
  productTruthFactIds: string[];
  fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN";
  status: "COMPLETE" | "INCOMPLETE";
  parentAuthorityIds: string[];
  reason: string;
  jobId: string;
}

export async function runProductAssessmentForPain(
  input: ProductAssessmentInput
): Promise<ProductAssessmentResult> {
  const {
    painId,
    canonicalPain,
    campaignOfferingId,
    businessUnderstandingAuthorityId,
    productTruthFacts = [],
    accountId,
    campaignId,
    jobId,
    existingAssessment,
  } = input;

  const productAssessmentAuthorityId = `pa_${jobId}_${painId}`;
  const factIds = productTruthFacts
    .map((f) => f.productTruthFactId || f.factId || "")
    .filter(Boolean);

  // 1. Fail-closed validation
  if (!businessUnderstandingAuthorityId || !campaignOfferingId || !painId || !jobId || factIds.length === 0) {
    const incompleteRes: ProductAssessmentResult = {
      productAssessmentAuthorityId,
      painId,
      campaignOfferingId: campaignOfferingId || "UNKNOWN",
      businessUnderstandingAuthorityId: businessUnderstandingAuthorityId || "UNKNOWN",
      productTruthFactIds: factIds,
      fitType: "UNKNOWN",
      status: "INCOMPLETE",
      parentAuthorityIds: [],
      reason: "Missing required Business Understanding, Campaign Offering, or Product Truth Facts",
      jobId,
    };
    return incompleteRes;
  }

  // 2. Check if a valid same-job Product Assessment authority can be reused
  const canReuse = (
    existingAssessment &&
    existingAssessment.status === "COMPLETE" &&
    existingAssessment.jobId === jobId &&
    existingAssessment.accountId === accountId &&
    existingAssessment.campaignId === campaignId &&
    existingAssessment.painId === painId &&
    existingAssessment.campaignOfferingId === campaignOfferingId &&
    Array.isArray(existingAssessment.productTruthFactIds) &&
    existingAssessment.productTruthFactIds.length > 0 &&
    ["DIRECT_FIT", "STRATEGIC_FIT", "NOT_FIT", "UNKNOWN"].includes(existingAssessment.fitType)
  );

  if (canReuse) {
    return {
      productAssessmentAuthorityId: existingAssessment.productAssessmentAuthorityId,
      painId,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFactIds: existingAssessment.productTruthFactIds,
      fitType: existingAssessment.fitType,
      status: "COMPLETE",
      parentAuthorityIds: [businessUnderstandingAuthorityId, ...existingAssessment.productTruthFactIds, painId],
      reason: existingAssessment.reason || "Reused valid same-job Product Assessment authority",
      jobId,
    };
  }

  // 3. Execute semantic LLM evaluation against offering Product Truth Facts
  const prompt = `
You are the Product Assessment Engine. Evaluate whether the offering's verified Product Truth facts address the audience pain claim.

CAMPAIGN OFFERING ID: ${campaignOfferingId}
OFFERING PRODUCT TRUTH FACTS:
${JSON.stringify(productTruthFacts, null, 2)}

AUDIENCE PAIN CLAIM:
"${canonicalPain}"

EVALUATION CRITERIA:
- DIRECT_FIT: Verified capabilities directly perform OR directly enable the function required to solve/address this pain without unproven assumptions.
  * MULTI-REQUIREMENT / COMPOUND PAIN RULE: DIRECT_FIT requires verified capabilities to directly address ALL material requirements or clauses of the pain claim. If verified capabilities directly address only a subset or fragment of the pain's requirements, you must NOT return DIRECT_FIT.
- STRATEGIC_FIT: The capability partially, indirectly, or conditionally supports strategic reasoning/decisions related to the pain, or directly addresses only a subset of a multi-clause pain, but does not directly perform or directly enable the full required operational function.
- NOT_FIT: The offering does not legitimately address the pain, or the pain is explicitly out of scope / contradicts capability boundaries.
- UNKNOWN: Insufficient verified Product Truth authority to determine fit.

Output JSON format:
{
  "fitType": "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN",
  "reason": "Concise causal justification based directly on the cited facts"
}
`;

  let fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "NOT_FIT" | "UNKNOWN" = "UNKNOWN";
  let reason = "Evaluation failed";

  try {
    const chatRes = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4.1-mini",
      max_tokens: 1024,
      response_format: { type: "json_object" },
      accountId: "system",
      endpoint: "product-assessment-engine",
    });
    const parsed = JSON.parse(chatRes.choices[0]?.message?.content || "{}");
    if (["DIRECT_FIT", "STRATEGIC_FIT", "NOT_FIT", "UNKNOWN"].includes(parsed.fitType)) {
      fitType = parsed.fitType;
      reason = parsed.reason || "Evaluated by Product Assessment Engine";
    }
  } catch (chatErr: any) {
    console.error(`[ProductAssessment] Evaluation failed: ${chatErr.message}`);
    return {
      productAssessmentAuthorityId,
      painId,
      campaignOfferingId,
      fitType: "UNKNOWN",
      status: "INCOMPLETE",
      parentAuthorityIds: [businessUnderstandingAuthorityId, painId],
      reason: `Product Assessment evaluation error: ${chatErr.message}`,
      jobId,
    };
  }

  const parentAuthorityIds = [businessUnderstandingAuthorityId, ...factIds, painId];

  const result: ProductAssessmentResult = {
    productAssessmentAuthorityId,
    painId,
    campaignOfferingId,
    businessUnderstandingAuthorityId,
    productTruthFactIds: factIds,
    fitType,
    status: "COMPLETE",
    parentAuthorityIds,
    reason,
    jobId,
  };

  try {
    await db.insert(productAssessments).values({
      id: productAssessmentAuthorityId,
      jobId,
      campaignId,
      accountId,
      painId,
      campaignOfferingId,
      businessUnderstandingAuthorityId,
      productTruthFactIds: factIds as any,
      fitType,
      status: "COMPLETE",
      parentAuthorityIds: parentAuthorityIds as any,
      payload: result as any,
    });
  } catch (dbErr: any) {
    console.warn(`[ProductAssessment] Failed to persist assessment ${productAssessmentAuthorityId}: ${dbErr.message}`);
  }

  return result;
}
