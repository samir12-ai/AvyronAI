import { db } from "../db";
import { targetAssessments } from "@shared/schema";
import { aiGemini, aiChat } from "../ai-client";

export interface TargetAssessmentInput {
  painId: string;
  segmentId: string;
  canonicalPain: string;
  segmentContext?: {
    name?: string;
    role?: string;
    segmentDefinition?: string;
  };
  targetUnderstandingAuthorityId: string;
  canonicalTargetRoles?: Array<{
    targetRoleFactId?: string;
    roleType?: string;
    roleTitle?: string;
    rationale?: string;
  }>;
  accountId: string;
  campaignId: string;
  jobId: string;
  existingAssessment?: {
    targetAssessmentAuthorityId: string;
    status: string;
    decision: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
    jobId: string;
    accountId: string;
    campaignId: string;
    painId: string;
    targetUnderstandingAuthorityId: string;
    reason?: string;
  };
}

export interface TargetAssessmentResult {
  targetAssessmentAuthorityId: string;
  painId: string;
  targetUnderstandingAuthorityId: string;
  decision: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED";
  status: "COMPLETE" | "INCOMPLETE";
  parentAuthorityIds: string[];
  reason: string;
  jobId: string;
}

export async function runTargetAssessmentForPain(
  input: TargetAssessmentInput
): Promise<TargetAssessmentResult> {
  const {
    painId,
    segmentId,
    canonicalPain,
    segmentContext,
    targetUnderstandingAuthorityId,
    canonicalTargetRoles = [],
    accountId,
    campaignId,
    jobId,
    existingAssessment,
  } = input;

  const targetAssessmentAuthorityId = `ta_${jobId}_${painId}`;

  // 1. Fail-closed validation
  if (!targetUnderstandingAuthorityId || !painId || !jobId) {
    const incompleteRes: TargetAssessmentResult = {
      targetAssessmentAuthorityId,
      painId,
      targetUnderstandingAuthorityId: targetUnderstandingAuthorityId || "UNKNOWN",
      decision: "NOT_COVERED",
      status: "INCOMPLETE",
      parentAuthorityIds: [],
      reason: "Missing required Target Understanding authority ID or identity fields",
      jobId,
    };
    return incompleteRes;
  }

  // 2. Check if a valid same-job Target Assessment authority can be reused
  const canReuse = (
    existingAssessment &&
    existingAssessment.status === "COMPLETE" &&
    existingAssessment.jobId === jobId &&
    existingAssessment.accountId === accountId &&
    existingAssessment.campaignId === campaignId &&
    existingAssessment.painId === painId &&
    existingAssessment.targetUnderstandingAuthorityId === targetUnderstandingAuthorityId &&
    ["COVERED", "RELATED_BUT_UNPROVEN", "NOT_COVERED"].includes(existingAssessment.decision)
  );

  if (canReuse) {
    return {
      targetAssessmentAuthorityId: existingAssessment.targetAssessmentAuthorityId,
      painId,
      targetUnderstandingAuthorityId,
      decision: existingAssessment.decision,
      status: "COMPLETE",
      parentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      reason: existingAssessment.reason || "Reused valid same-job Target Assessment authority",
      jobId,
    };
  }

  // 3. Execute semantic LLM evaluation against canonical Target Roles
  let decision: "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED" = "RELATED_BUT_UNPROVEN";
  let reason = "Evaluated by Target Assessment Engine";

  const prompt = `
You are the Target Assessment Engine. Evaluate whether the audience segment experiencing this pain matches the target buyer/user roles.

CANONICAL TARGET ROLES:
${JSON.stringify(canonicalTargetRoles, null, 2)}

AUDIENCE SEGMENT CONTEXT:
Segment Name: ${segmentContext?.name || segmentId}
Role: ${segmentContext?.role || "Unknown"}
Definition: ${segmentContext?.segmentDefinition || "N/A"}

PAIN CLAIM:
"${canonicalPain}"

CRITICAL EVALUATION RULES:
1. Evaluate WHO this audience represents based on role, function, and organizational responsibility.
2. DO NOT require literal job title equality (e.g. "Marketing Strategist" vs "GTM Practitioner" or "Marketing Decision Maker" represent legitimate semantic role overlap).
3. DO NOT evaluate whether the product solves the pain (that belongs to Product Assessment).
4. THREE SEMANTIC OUTCOMES:
   - COVERED: The audience segment legitimately represents people included in the explicit Business Target roles (functional identity matches).
   - RELATED_BUT_UNPROVEN: Meaningful overlap exists, but role identity or scope is genuinely unproven.
   - NOT_COVERED: Genuinely a different population (e.g. general consumers, retail subscribers, out-of-scope departments).

Output JSON format exactly:
{
  "decision": "COVERED" | "RELATED_BUT_UNPROVEN" | "NOT_COVERED",
  "reason": "Concise justification of the audience role relationship"
}
`;

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
    if (["COVERED", "RELATED_BUT_UNPROVEN", "NOT_COVERED"].includes(parsed.decision)) {
      decision = parsed.decision;
      reason = parsed.reason || reason;
    }
  } catch (e: any) {
    console.warn(`[TargetAssessment] aiGemini error for pain ${painId}, falling back to aiChat: ${e.message}`);
    try {
      const chatRes = await aiChat({
        messages: [{ role: "user", content: prompt }],
        model: "gpt-4.1-mini",
        max_tokens: 1024,
        response_format: { type: "json_object" },
        accountId: "system",
        endpoint: "target-assessment-engine",
      });
      const parsed = JSON.parse(chatRes.choices[0]?.message?.content || "{}");
      if (["COVERED", "RELATED_BUT_UNPROVEN", "NOT_COVERED"].includes(parsed.decision)) {
        decision = parsed.decision;
        reason = parsed.reason || reason;
      }
    } catch (chatErr: any) {
      console.warn(`[TargetAssessment] LLM fallback failed for pain ${painId}: ${chatErr.message}`);
      decision = "RELATED_BUT_UNPROVEN";
      reason = "Target Assessment evaluation defaulted to RELATED_BUT_UNPROVEN";
    }
  }

  const result: TargetAssessmentResult = {
    targetAssessmentAuthorityId,
    painId,
    targetUnderstandingAuthorityId,
    decision,
    status: "COMPLETE",
    parentAuthorityIds: [targetUnderstandingAuthorityId, painId],
    reason,
    jobId,
  };

  try {
    await db.insert(targetAssessments).values({
      id: targetAssessmentAuthorityId,
      jobId,
      campaignId,
      accountId,
      painId,
      targetUnderstandingAuthorityId,
      decision,
      status: "COMPLETE",
      parentAuthorityIds: [targetUnderstandingAuthorityId, painId],
      payload: result as any,
    });
  } catch (dbErr: any) {
    console.warn(`[TargetAssessment] Failed to persist assessment ${targetAssessmentAuthorityId}: ${dbErr.message}`);
  }

  return result;
}
