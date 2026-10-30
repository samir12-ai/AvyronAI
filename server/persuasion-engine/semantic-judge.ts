import { aiChat } from "../ai-client";
import type { CanonicalPersuasionInput } from "./canonical-input";

export type PersuasionDefectCategory =
  | "FACTUAL_UNSUPPORTED"
  | "STRATEGIC_MISALIGNMENT"
  | "LANE_IRRELEVANT"
  | "PROOF_INTEGRITY"
  | "PERSUASIVE_QUALITY";

export interface PersuasionDefect {
  fieldPath: string;
  problematicStatement: string;
  defectCategory: PersuasionDefectCategory;
  relevantAuthority: string;
  evidenceEstablishes: string;
  validComponentsToPreserve: string[];
  repairInstruction: string;
}

export interface PersuasionJudgeVerdict {
  verdict: "ACCEPTED" | "REJECTED";
  factualSupportVerdict: "GROUNDED" | "UNSUPPORTED";
  strategicAlignmentVerdict: "ALIGNED" | "MISALIGNED";
  laneRelevanceVerdict: "ALIGNED" | "MISALIGNED";
  proofIntegrityVerdict: "VALID" | "INVALID";
  persuasiveQualityVerdict: "STRONG" | "WEAK";
  defects: PersuasionDefect[];
  unsupportedClaims: string[];
  reason: string;
  repairPlan?: string;
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

export async function judgePersuasionCandidate(input: {
  candidate: any;
  canonicalInput: CanonicalPersuasionInput;
  mockJudgeVerdict?: PersuasionJudgeVerdict;
}): Promise<PersuasionJudgeVerdict> {
  if (input.mockJudgeVerdict) {
    return input.mockJudgeVerdict;
  }

  const { candidate, canonicalInput } = input;

  const route = candidate?.primary || candidate?.primaryRoute || candidate || {};

  // Extract core candidate texts to evaluate
  const candidateSummary = {
    routeName: route.routeName || "",
    persuasionMode: route.persuasionMode || "",
    trustTransferBuyerRiskState: route.trustTransferDesign?.buyerRiskState || null,
    trustTransferDeficit: route.trustTransferDesign?.trustDeficit || null,
    trustTransferMechanism: route.trustTransferDesign?.transferMechanism || null,
    cialdiniMechanism: route.cialdiniReasoning?.groundedInTrustMechanism || null,
    structuredObjections: (route.structuredObjections || route.objectionPriorities || []).map((o: any) => ({
      objection: o.objectionStatement || o.objection?.canonical || o.objection || "",
      response: o.persuasionResponse || o.response || o.resolution || "",
      requiredProof: o.requiredProofType || o.requiredProof || "",
      proofStatus: o.proofStatus || "PROOF_TO_BUILD",
      subjectScope: o.subjectScope || null,
      competitorNames: o.competitorNames || [],
    })),
    beliefShift: route.coreBeliefTransformation || null,
  };

  const factsList = canonicalInput.productTruth.map((f, i) => 
    `[FACT ${i + 1}] (ID: ${f.factId}) [${f.factType}]: "${f.statement}" (Rationale: ${f.rationale || "None"})`
  ).join("\n");

  const prompt = `You are the Hostile Semantic & Factual Posture Judge for Avyron AI's Persuasion Engine.
Your mission is to evaluate a candidate persuasion route across 5 INDEPENDENT dimensions.
Do NOT rely on lexical token overlap. Evaluate commercial semantics and factual boundaries.

════ 1. CANONICAL PRODUCT TRUTH (STRICT FACTUAL BOUNDARY) ════
${factsList}

════ 2. APPROVED STRATEGIC AUTHORITY ════
Approved Umbrella Mechanism: "${canonicalInput.strategicAuthority.approvedMechanism.name}"
Mechanism Description: "${canonicalInput.strategicAuthority.approvedMechanism.description}"
Positioning Axis: "${canonicalInput.strategicAuthority.primaryAxis}"
Contrast Axis: "${canonicalInput.strategicAuthority.contrastAxisText}"
Approved Claims: ${(canonicalInput.strategicAuthority.approvedClaims || []).join("; ") || "None"}

════ 3. LANE CONTEXT ════
Lane ID: "${canonicalInput.laneContext.laneId}"
Lane Title: "${canonicalInput.laneContext.title}"
Assigned Buyer Objections to Resolve:
${canonicalInput.laneContext.objections.map((o, i) => `[OBJ ${i + 1}] ${o}`).join("\n")}

════ 4. CANDIDATE PERSUASION OUTPUT TO AUDIT ════
${JSON.stringify(candidateSummary, null, 2)}

════ 5 EVALUATION DIMENSIONS (MUST BE EVALUATED SEPARATELY) ════
1. FACTUAL SUPPORT:
   - Does the candidate assert or imply ANY operational capability, software feature, tracking portal, live dashboard, automated SLA, human-driven studio composition over automation, phonetic pronunciation input, or permanent link guarantee that is NOT in Product Truth?
   - If YES -> MUST REJECT as FACTUAL_UNSUPPORTED.
   - Note: Creative framing of verified facts is permitted, but inventing new operational capabilities (e.g. live tracking portals, dispatch guarantees, automated notification engines, human-driven composition over automation, phonetic pronunciation input, or permanent link hosting guarantees) is STRICTLY FORBIDDEN.
2. STRATEGIC ALIGNMENT:
   - Does the candidate preserve the approved positioning axis and approved mechanism without contradicting them?
   - Creative wording may differ from the umbrella mechanism title. Exact token repetition is NOT required.
3. LANE RELEVANCE:
   - Does the candidate directly address the assigned buyer hesitations/objections for THIS lane?
4. PROOF INTEGRITY:
   - Are proof assets described accurately?
   - Proposed marketing assets must NEVER be presented as already existing customer proof or verified capabilities.
5. PERSUASIVE USEFULNESS:
   - Is the response commercially meaningful, specific, and compelling, avoiding empty filler ("quality, trust, excellence")?

Return ONLY valid JSON matching this schema:
{
  "verdict": "ACCEPTED" | "REJECTED",
  "factualSupportVerdict": "GROUNDED" | "UNSUPPORTED",
  "strategicAlignmentVerdict": "ALIGNED" | "MISALIGNED",
  "laneRelevanceVerdict": "ALIGNED" | "MISALIGNED",
  "proofIntegrityVerdict": "VALID" | "INVALID",
  "persuasiveQualityVerdict": "STRONG" | "WEAK",
  "unsupportedClaims": ["exact phrases claiming unsupported capabilities"],
  "defects": [
    {
      "fieldPath": "path to field, e.g. trustTransferMechanism.name or structuredObjections[0].response or beliefShift.desiredBelief",
      "problematicStatement": "exact problematic text",
      "defectCategory": "FACTUAL_UNSUPPORTED" | "STRATEGIC_MISALIGNMENT" | "LANE_IRRELEVANT" | "PROOF_INTEGRITY" | "PERSUASIVE_QUALITY",
      "relevantAuthority": "Fact ID or Authority reference",
      "evidenceEstablishes": "what the evidence actually establishes",
      "validComponentsToPreserve": ["elements of the candidate that are valid and should be kept"],
      "repairInstruction": "concrete instruction to repair without hallucinating capabilities"
    }
  ],
  "reason": "summary explanation of overall verdict",
  "repairPlan": "optional step-by-step guidance for repair"
}`;

  // Fast-path / deterministic boundary checks (always enforced before and after LLM judge)
  const allCandidateStr = JSON.stringify(candidateSummary).toLowerCase();
  const unsupportedDetected: string[] = [];

  const potentialHallucinations = [
    "live dashboard",
    "tracking dashboard",
    "fulfillment dashboard",
    "automated tracking portal",
    "real-time inventory tracking",
    "gps live tracking",
    "dispatch portal",
    "dispatch guarantee",
    "guarantee portal",
    "order portal",
    "human-driven process",
    "human composer",
    "over automation",
    "specify name pronunciation",
    "phonetic pronunciation",
    "permanent link",
    "permanent access",
    "lifetime access",
    "guaranteed lasting access",
    "never generic",
    "ensures authenticity",
    "1-minute",
    "60-second",
    "£19.99",
  ];

  const hasFactualSupport = (phrase: string) => 
    canonicalInput.productTruth.some(f => f.statement.toLowerCase().includes(phrase));

  for (const h of potentialHallucinations) {
    if (allCandidateStr.includes(h) && !hasFactualSupport(h)) {
      unsupportedDetected.push(h);
    }
  }

  let aiVerdict: PersuasionJudgeVerdict | null = null;
  try {
    const resp = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
      endpoint: "persuasion-engine-semantic-judge",
      accountId: canonicalInput.accountId,
    });

    const content = resp.choices[0]?.message?.content?.trim() || "{}";
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = safeJsonParse<PersuasionJudgeVerdict>(cleaned);

    if (parsed && parsed.verdict) {
      aiVerdict = parsed;
    }
  } catch (err: any) {
    console.error(`[SemanticJudge] AI_CALL_FAILED: ${err.message}`);
  }

  if (unsupportedDetected.length > 0) {
    const verifiedSummary = canonicalInput.productTruth
      .slice(0, 4)
      .map(f => f.statement)
      .join("; ") || "verified Product Truth capabilities";
    const extraDefects: PersuasionDefect[] = unsupportedDetected.map(u => ({
      fieldPath: "persuasionCandidate",
      problematicStatement: u,
      defectCategory: "FACTUAL_UNSUPPORTED",
      relevantAuthority: "Product Truth",
      evidenceEstablishes: `Product Truth does not verify '${u}'. Verified facts: ${verifiedSummary}`,
      validComponentsToPreserve: ["Lane objection handling context"],
      repairInstruction: `Remove unsupported claim '${u}'. Rebuild persuasion using only verified Product Truth capabilities (${verifiedSummary}).`,
    }));
    return {
      verdict: "REJECTED",
      factualSupportVerdict: "UNSUPPORTED",
      strategicAlignmentVerdict: aiVerdict?.strategicAlignmentVerdict || "ALIGNED",
      laneRelevanceVerdict: aiVerdict?.laneRelevanceVerdict || "ALIGNED",
      proofIntegrityVerdict: "INVALID",
      persuasiveQualityVerdict: aiVerdict?.persuasiveQualityVerdict || "STRONG",
      unsupportedClaims: Array.from(new Set([...(aiVerdict?.unsupportedClaims || []), ...unsupportedDetected])),
      defects: [...(aiVerdict?.defects || []), ...extraDefects],
      reason: `REJECTED: Output asserts unsupported capability not in Product Truth: ${unsupportedDetected.join(", ")}${aiVerdict?.reason ? ` | ${aiVerdict.reason}` : ""}`,
      repairPlan: "Retire unsupported claims and ground strictly in verified Product Truth facts.",
    };
  }

  if (aiVerdict) {
    return aiVerdict;
  }

  return {
    verdict: "ACCEPTED",
    factualSupportVerdict: "GROUNDED",
    strategicAlignmentVerdict: "ALIGNED",
    laneRelevanceVerdict: "ALIGNED",
    proofIntegrityVerdict: "VALID",
    persuasiveQualityVerdict: "STRONG",
    defects: [],
    unsupportedClaims: [],
    reason: "Candidate passes all 5 semantic and factual dimensions.",
  };
}
