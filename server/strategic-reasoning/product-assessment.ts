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
- DIRECT_FIT: A verified capability directly performs OR directly enables the function required to solve/address this pain without unproven assumptions.
- STRATEGIC_FIT: The capability partially, indirectly, or conditionally supports strategic reasoning/decisions related to the pain, but does not directly perform or directly enable the required operational function.
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
    const rawRes: any = await aiGemini({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 1024 },
      model: "gemini-3.6-flash",
      accountId: "system",
    });
    let text = typeof rawRes === "string" ? rawRes : rawRes?.candidates?.[0]?.content?.parts?.[0]?.text || rawRes?.text || "";
    text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text || "{}");
    if (["DIRECT_FIT", "STRATEGIC_FIT", "NOT_FIT", "UNKNOWN"].includes(parsed.fitType)) {
      fitType = parsed.fitType;
      reason = parsed.reason || "Evaluated by Product Assessment Engine";
    }
  } catch (e: any) {
    console.warn(`[ProductAssessment] aiGemini error for pain ${painId}, falling back to aiChat: ${e.message}`);
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
      reason = `Product Assessment evaluation failed: ${chatErr.message}`;
      fitType = "UNKNOWN";
    }
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
