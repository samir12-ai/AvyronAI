import { aiChat } from "../ai-client";
import type { CanonicalPersuasionInput } from "./canonical-input";
import {
  type PersuasionJudgeVerdict,
  judgePersuasionCandidate,
} from "./semantic-judge";

export interface RepairAttemptLog {
  attempt: number;
  defectsAddressed: string[];
  repairedCandidateSummary: string;
  verdict: "ACCEPTED" | "REJECTED";
  reason: string;
}

export interface TargetedRepairResult {
  repairedCandidate: any;
  finalVerdict: PersuasionJudgeVerdict;
  repairLogs: RepairAttemptLog[];
  attemptsUsed: number;
  success: boolean;
}

function safeJsonParse<T = any>(text: any): T | null {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

/**
 * Executes bounded targeted repair on a rejected persuasion candidate.
 * Bounded to maxRepairs (default: 2 attempts) with a single unified repair budget.
 */
export async function repairPersuasionCandidate(input: {
  candidate: any;
  judgeVerdict: PersuasionJudgeVerdict;
  canonicalInput: CanonicalPersuasionInput;
  maxRepairs?: number;
  mockRepairGenerator?: (attempt: number) => Promise<any>;
}): Promise<TargetedRepairResult> {
  const {
    candidate,
    judgeVerdict,
    canonicalInput,
    maxRepairs = 3,
    mockRepairGenerator,
  } = input;

  const repairLogs: RepairAttemptLog[] = [];
  let currentCandidate = JSON.parse(JSON.stringify(candidate));
  let currentVerdict = judgeVerdict;
  let attemptsUsed = 0;

  const factsList = canonicalInput.productTruth.map((f, i) => 
    `[FACT ${i + 1}] (ID: ${f.factId}) [${f.factType}]: "${f.statement}"`
  ).join("\n");

  while (currentVerdict.verdict === "REJECTED" && attemptsUsed < maxRepairs) {
    attemptsUsed++;
    console.log(`[PersuasionRepair] ATTEMPT_${attemptsUsed}/${maxRepairs} | defects=${currentVerdict.defects.length}`);

    if (mockRepairGenerator) {
      currentCandidate = await mockRepairGenerator(attemptsUsed);
      currentVerdict = await judgePersuasionCandidate({
        candidate: currentCandidate,
        canonicalInput,
      });
      repairLogs.push({
        attempt: attemptsUsed,
        defectsAddressed: currentVerdict.defects.map(d => d.problematicStatement),
        repairedCandidateSummary: JSON.stringify(currentCandidate).slice(0, 200),
        verdict: currentVerdict.verdict,
        reason: currentVerdict.reason,
      });
      if (currentVerdict.verdict === "ACCEPTED") break;
      continue;
    }

    const targetRoute = currentCandidate.primary || currentCandidate.primaryRoute || currentCandidate;

    const defectDirectives = currentVerdict.defects.map((d, i) => `
[DEFECT ${i + 1}]
- Problematic Statement: "${d.problematicStatement}"
- Category: ${d.defectCategory}
- Relevant Authority: ${d.relevantAuthority}
- What Evidence Establishes: ${d.evidenceEstablishes}
- Valid Components To Preserve: ${d.validComponentsToPreserve.join(", ") || "None"}
- Repair Directive: ${d.repairInstruction}
`).join("\n");

    const prompt = `You are the Expert Persuasion Repair Engine for Avyron AI.
A prior persuasion candidate was REJECTED by the hostile factual & semantic judge.
Your task is to execute TARGETED REPAIR:
1. EXPLICITLY RETIRE the unsupported premise (do NOT merely rename a hallucinated dashboard/portal — remove it completely).
2. PRESERVE all valid components and lane context.
3. REBUILD the argument strictly using verified Product Truth facts.
4. ENSURE all derived fields (trust transfer mechanism, Cialdini grounding, structured objections) are updated consistently so no stale unsupported claims remain.

════ CANONICAL PRODUCT TRUTH (AUTHORITATIVE CAPABILITIES) ════
${factsList}

════ APPROVED STRATEGIC AUTHORITY ════
Mechanism: "${canonicalInput.strategicAuthority.approvedMechanism.name}"
Positioning Axis: "${canonicalInput.strategicAuthority.primaryAxis}"

════ LANE CONTEXT ════
Lane ID: "${canonicalInput.laneContext.laneId}"
Buyer Objections:
${canonicalInput.laneContext.objections.map(o => `- ${o}`).join("\n")}

════ EXACT DEFECTS REQUIRING REPAIR ════
${defectDirectives}

════ FAILED CANDIDATE TO REPAIR ════
${JSON.stringify({
  primaryRouteName: targetRoute?.routeName || targetRoute?.primaryRouteName || targetRoute?.name,
  persuasionMode: targetRoute?.persuasionMode,
  buyerRiskState: targetRoute?.trustTransferDesign?.buyerRiskState,
  trustTransferMechanism: targetRoute?.trustTransferDesign?.transferMechanism || targetRoute?.transferMechanism,
  cialdiniMechanism: targetRoute?.cialdiniReasoning?.groundedInTrustMechanism || targetRoute?.cialdiniMechanism,
  coreBeliefTransformation: targetRoute?.coreBeliefTransformation,
  structuredObjections: targetRoute?.structuredObjections,
}, null, 2)}

════ REPAIR RULES ════
- EXPLICITLY RETIRE and REMOVE all mentions of unverified operational capabilities, tracking software, live fulfillment dashboards, automated guarantees, transparent order verification workflows, proactive delivery status updates, customer support response time guarantees, human-driven studio composition over automation, phonetic pronunciation input ("specify name pronunciation"), permanent/lifetime link hosting guarantees, unsupported absolutes ("never generic", "ensures authenticity", "permanent access"), or third-party certifications/composition disclosure sheets.
- For buyer friction (such as delivery uncertainty, customization worries, link access fears, fabric feel, or customer service fears), resolve it strictly and exclusively using VERIFIED capabilities and policies from the Product Truth list above.
- Do NOT replace one hallucinated operational promise with another. If a capability, certification, or workflow is not explicitly written in the Canonical Product Truth, do NOT claim it exists or will be provided.
- NEVER invent planned future enhancements, lab testing, third-party certifications, or disclosure sheets that are not documented in the Canonical Product Truth. If a proof asset is not in Product Truth, mark proofStatus as PROOF_TO_BUILD without asserting that specific lab certifications or disclosure portals are planned or underway.
- Cite the Fact ID used in your repair.

Return ONLY a valid JSON object matching this schema:
{
  "buyerRiskState": "repaired buyer risk state grounded in evidence and competitor attribution boundaries",
  "transferMechanism": {
    "name": "grounded mechanism name (aligned with approved mechanism & verified facts)",
    "description": "how it operates using verified facts",
    "proofArtifact": "real proof artifact or verified process"
  },
  "cialdiniReasoning": {
    "groundedInTrustMechanism": "same mechanism name",
    "primaryCialdiniPrinciple": "authority | social_proof | commitment | reciprocity | scarcity | unity",
    "principleRationale": "why this principle works using verified facts"
  },
  "coreBeliefTransformation": {
    "currentBelief": "substantive current belief",
    "desiredBelief": "repaired desired belief grounded strictly in verified Product Truth",
    "contradictionLogic": "repaired contradiction logic grounded strictly in verified Product Truth"
  },
  "structuredObjections": [
    {
      "objectionStatement": "exact objection",
      "persuasionResponse": "repaired response grounded strictly in verified Product Truth",
      "requiredProofType": "proof type or verified policy",
      "proofStatus": "PROOF_ESTABLISHED | PROOF_TO_BUILD",
      "supportingFactId": "Fact ID from Product Truth"
    }
  ]
}`;

    try {
      const resp = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 2500,
        endpoint: "persuasion-engine-targeted-repair",
        accountId: canonicalInput.accountId,
      });

      const content = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const repairedPayload = safeJsonParse<any>(cleaned);

      if (repairedPayload && repairedPayload.transferMechanism) {
        // Splice repaired content into targetRoute
        if (targetRoute.trustTransferDesign) {
          targetRoute.trustTransferDesign.transferMechanism = repairedPayload.transferMechanism;
          if (repairedPayload.buyerRiskState) {
            targetRoute.trustTransferDesign.buyerRiskState = repairedPayload.buyerRiskState;
          }
          targetRoute.trustTransferDesign.judgeVerdict = "ACCEPTED";
        } else {
          targetRoute.trustTransferDesign = {
            buyerRiskState: repairedPayload.buyerRiskState || "",
            transferMechanism: repairedPayload.transferMechanism,
            judgeVerdict: "ACCEPTED",
          };
        }

        if (repairedPayload.coreBeliefTransformation && repairedPayload.coreBeliefTransformation.desiredBelief) {
          targetRoute.coreBeliefTransformation = {
            ...(targetRoute.coreBeliefTransformation || {}),
            currentBelief: repairedPayload.coreBeliefTransformation.currentBelief || targetRoute.coreBeliefTransformation?.currentBelief || "",
            desiredBelief: repairedPayload.coreBeliefTransformation.desiredBelief,
            contradictionLogic: repairedPayload.coreBeliefTransformation.contradictionLogic || targetRoute.coreBeliefTransformation?.contradictionLogic || "",
          };
        }

        if (targetRoute.cialdiniReasoning) {
          targetRoute.cialdiniReasoning.groundedInTrustMechanism = repairedPayload.transferMechanism.name;
          if (repairedPayload.cialdiniReasoning?.primaryCialdiniPrinciple) {
            targetRoute.cialdiniReasoning.primaryCialdiniPrinciple = repairedPayload.cialdiniReasoning.primaryCialdiniPrinciple;
          }
          if (repairedPayload.cialdiniReasoning?.principleRationale) {
            targetRoute.cialdiniReasoning.principleRationale = repairedPayload.cialdiniReasoning.principleRationale;
          }
        } else {
          targetRoute.cialdiniReasoning = {
            groundedInTrustMechanism: repairedPayload.transferMechanism.name,
            primaryCialdiniPrinciple: repairedPayload.cialdiniReasoning?.primaryCialdiniPrinciple || "authority",
            principleRationale: repairedPayload.cialdiniReasoning?.principleRationale || "",
          };
        }

        if (Array.isArray(repairedPayload.structuredObjections)) {
          const existingStructured = Array.isArray(targetRoute.structuredObjections) ? targetRoute.structuredObjections : [];
          targetRoute.structuredObjections = repairedPayload.structuredObjections.map((so: any, idx: number) => {
            const prev = existingStructured.find((e: any) =>
              (e.objectionStatement || "").trim().toLowerCase() === (so.objectionStatement || "").trim().toLowerCase()
            ) || existingStructured[idx] || {};
            const fullResp = so.persuasionResponse || prev.persuasionResponse || "";
            return {
              ...prev,
              ...so,
              objectionId: prev.objectionId || so.objectionId || `obj_${idx + 1}`,
              persuasionResponse: fullResp,
              resolution: fullResp,
              subjectScope: so.subjectScope || prev.subjectScope,
              competitorNames: so.competitorNames || prev.competitorNames,
              competitorIds: so.competitorIds || prev.competitorIds,
              evidenceIds: so.evidenceIds || prev.evidenceIds,
              aelGrounding: prev.aelGrounding || null,
            };
          });
          // Also synchronize objectionPriorities
          if (Array.isArray(targetRoute.objectionPriorities)) {
            for (let i = 0; i < repairedPayload.structuredObjections.length; i++) {
              const so = repairedPayload.structuredObjections[i];
              let match = targetRoute.objectionPriorities.find((op: any) => 
                (op.objection?.canonical || op.objection || "").trim().toLowerCase() === (so.objectionStatement || "").trim().toLowerCase()
              );
              if (!match && targetRoute.objectionPriorities[i]) {
                match = targetRoute.objectionPriorities[i];
              }
              if (match) {
                match.persuasionResponse = so.persuasionResponse;
                match.response = so.persuasionResponse;
                match.resolution = so.persuasionResponse;
                match.requiredProof = so.requiredProofType || so.requiredProof;
                if (so.proofStatus) match.proofStatus = so.proofStatus;
              }
            }
          }
        }

        // Also if currentCandidate had primary or primaryRoute wrappers, ensure they reference targetRoute
        if (currentCandidate.primary) {
          currentCandidate.primary = targetRoute;
        }
        if (currentCandidate.primaryRoute) {
          currentCandidate.primaryRoute = targetRoute;
        }

        // Re-judge the repaired candidate
        currentVerdict = await judgePersuasionCandidate({
          candidate: currentCandidate,
          canonicalInput,
        });

        repairLogs.push({
          attempt: attemptsUsed,
          defectsAddressed: currentVerdict.defects.map(d => d.problematicStatement),
          repairedCandidateSummary: `Repaired mechanism: ${repairedPayload.transferMechanism.name}`,
          verdict: currentVerdict.verdict,
          reason: currentVerdict.reason,
        });

        if (currentVerdict.verdict === "ACCEPTED") {
          console.log(`[PersuasionRepair] SUCCESS | Attempt ${attemptsUsed} accepted by judge`);
          break;
        }
      }
    } catch (repairErr: any) {
      console.error(`[PersuasionRepair] ATTEMPT_FAILED: ${repairErr.message}`);
    }
  }

  return {
    repairedCandidate: currentCandidate,
    finalVerdict: currentVerdict,
    repairLogs,
    attemptsUsed,
    success: currentVerdict.verdict === "ACCEPTED",
  };
}
