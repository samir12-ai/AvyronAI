import { deriveValidatedCapabilities } from "../shared/capability-registry";
import {
  ENGINE_VERSION,
  STATUS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  LAYER_WEIGHTS,
  PERSUASION_MODES,
  INFLUENCE_DRIVERS,
  TRUST_SEQUENCE_STAGES,
  TRUST_BARRIER_TYPES,
  HYPE_PATTERNS,
  HYPE_PATTERNS_HARD,
  HYPE_PATTERNS_CONTEXTUAL,
  GENERIC_PERSUASION_PHRASES,
  GENERIC_STRUCTURE_PATTERNS,
  OBJECTION_PROOF_MAP,
  LOW_READINESS_STAGES,
  HIGH_READINESS_STAGES,
  EDUCATION_FIRST_MODES,
  SCARCITY_BLOCKED_CONDITIONS,
  FUNNEL_PERSUASION_COMPATIBILITY,
  AWARENESS_PERSUASION_MAP,
  TRUST_PROOF_ESCALATION_ORDER,
  MESSAGE_ARCHITECTURE_ORDER,
  MESSAGE_STEP_CATEGORY_MAP,
} from "./constants";
import { formatAELForPrompt, filterAELForStrategicUse } from "../analytical-enrichment-layer/engine";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import {
  buildDoctrineBlock,
  deriveAnchorFromProductDna,
  type RunStrategicContext,
  type ProductAnchor,
  type ProductDnaLike,
} from "../shared/strategic-doctrine";
import { buildGroundingContract } from "../shared/grounding-contract";
import { selectPainsForUse } from "../shared/audience-pain-registry";
import {
  enforceEngineDepthCompliance,
  applyDepthPenalty,
  isDepthBlocking,
  buildDepthGateResult,
  type DepthGateResult,
} from "../causal-enforcement-layer/engine";
import { enforceBoundaryWithSanitization } from "../engine-hardening";
import { assessStrategyAcceptability } from "../shared/strategy-acceptability";
import { cosineSimilarity, tokenize } from "../shared/embedding";
import {
  type SignalLineageEntry,
  extractQualifyingSignals,
  MIN_QUALIFYING_SIGNALS,
} from "../shared/signal-lineage";
import { generateWithRepair, LLMReliabilityError, type JudgeResult } from "../shared/llm-reliability/reliability-runner";
import { aiChat } from "../ai-client";
import { safeJsonParse } from "../shared/strategic-doctrine";
import type {
  PersuasionMIInput,
  PersuasionAudienceInput,
  PersuasionPositioningInput,
  PersuasionDifferentiationInput,
  PersuasionOfferInput,
  PersuasionFunnelInput,
  PersuasionIntegrityInput,
  PersuasionAwarenessInput,
  LayerResult,
  PersuasionRoute,
  PersuasionResult,
  DataReliabilityDiagnostics,
  TrustBarrierClassification,
  AwarenessStageProperty,
  AutoCorrection,
  ObjectionProofLink,
  StructuredObjection,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeNumber(v: any, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const parsed = Number(v);
  return isNaN(parsed) ? fallback : parsed;
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

function safeString(v: any, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  return fallback;
}

function isLowReadiness(stage: string): boolean {
  return (LOW_READINESS_STAGES as readonly string[]).includes(stage);
}

function isHighReadiness(stage: string): boolean {
  return (HIGH_READINESS_STAGES as readonly string[]).includes(stage);
}

const OBJECTION_TYPE_MAP: Record<string, StructuredObjection["objectionType"]> = {
  price: "cost", cost: "cost", expensive: "cost", budget: "cost", afford: "cost", money: "cost", invest: "cost",
  trust: "trust", scam: "trust", legit: "trust", credib: "trust", believ: "trust", honest: "trust", fake: "trust",
  time: "feasibility", busy: "feasibility", effort: "feasibility", complic: "complexity", difficult: "complexity",
  hard: "complexity", complex: "complexity", overwhelm: "complexity", confus: "complexity",
  work: "feasibility", result: "feasibility", outcome: "feasibility", deliver: "feasibility",
};

const OBJECTION_PROOF_TYPE_MAP: Record<StructuredObjection["objectionType"], string> = {
  trust: "transparency_proof",
  feasibility: "outcome_proof",
  cost: "value_proof",
  complexity: "process_proof",
};

const OBJECTION_STAGE_MAP: Record<string, StructuredObjection["objectionStage"]> = {
  comparison: "consideration",
  anti_pattern: "awareness",
  trust_repair: "consideration",
  credibility: "decision",
  price_value: "decision",
  results_skepticism: "consideration",
  problem_framing: "awareness",
  generic_strategy: "awareness",
  noise_rejection: "awareness",
  differentiation_signal: "consideration",
  strategy_framing: "consideration",
};

function classifyObjectionType(text: string): StructuredObjection["objectionType"] {
  const lower = text.toLowerCase();
  for (const [keyword, type] of Object.entries(OBJECTION_TYPE_MAP)) {
    if (lower.includes(keyword)) return type;
  }
  return "trust";
}

function classifyObjectionStage(text: string, category?: string): StructuredObjection["objectionStage"] {
  if (category && OBJECTION_STAGE_MAP[category]) return OBJECTION_STAGE_MAP[category];
  const lower = text.toLowerCase();
  if (lower.includes("price") || lower.includes("cost") || lower.includes("commit") || lower.includes("buy") || lower.includes("pay")) return "decision";
  if (lower.includes("compare") || lower.includes("alternative") || lower.includes("better") || lower.includes("different")) return "consideration";
  return "awareness";
}

/**
 * @deprecated PRODUCTION REACHABLE = NO
 * Deterministic template generator removed from active production path.
 * Retained solely as unreachable artifact; production objection responses are
 * genuinely reasoned via buildReasonedStructuredObjections + generateWithRepair.
 */
export function buildPersuasionResponse(objType: StructuredObjection["objectionType"], statement: string): string {
  switch (objType) {
    case "trust": return `Address credibility concern with third-party validation and transparency evidence for: ${statement.slice(0, 80)}`;
    case "feasibility": return `Demonstrate proven process and real outcomes to counter doubt about: ${statement.slice(0, 80)}`;
    case "cost": return `Reframe value proposition with ROI evidence and risk reversal for: ${statement.slice(0, 80)}`;
    case "complexity": return `Simplify with step-by-step mechanism explanation and guided pathway for: ${statement.slice(0, 80)}`;
    default: return `Provide specific proof addressing: ${statement.slice(0, 80)}`;
  }
}

function aelTokenize(s: string): string[] {
  return (s || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
}
const AEL_GROUNDING_MIN_OVERLAP = 0.05;
function aelOverlapScore(a: string, b: string): number {
  const ta = new Set(aelTokenize(a));
  const tb = aelTokenize(b);
  if (ta.size === 0 || tb.length === 0) return 0;
  let hits = 0;
  for (const t of tb) if (ta.has(t)) hits++;
  return hits / Math.max(ta.size, tb.length);
}

function attachAELGrounding(
  obj: StructuredObjection,
  ael: any,
): void {
  if (!ael || !ael.root_causes || ael.root_causes.length === 0) return;
  const objText = `${obj.objectionStatement} ${obj.objectionTrigger} ${obj.persuasionResponse}`;

  let bestRc: any = null;
  let bestRcScore = 0;
  for (const rc of ael.root_causes) {
    const rcText = `${rc.deepCause || ""} ${rc.surfaceSignal || ""} ${rc.causalReasoning || ""}`;
    const s = aelOverlapScore(rcText, objText);
    if (s > bestRcScore) { bestRcScore = s; bestRc = rc; }
  }
  if (bestRc && bestRcScore >= AEL_GROUNDING_MIN_OVERLAP) {
    obj.rootCause = `${bestRc.deepCause || ""}: ${bestRc.causalReasoning || ""}`.trim().slice(0, 400);
    obj.userThinking = `Surface signal observed: ${bestRc.surfaceSignal || bestRc.deepCause || ""}`.slice(0, 300);
    obj.resolution = `Resolve by addressing ${bestRc.deepCause || "underlying cause"} via ${obj.requiredProofType} — ${obj.persuasionResponse}`.slice(0, 400);
  }

  const chains = ael.causal_chains || [];
  if (chains.length > 0) {
    let bestCh: any = null;
    let bestChScore = 0;
    for (const ch of chains) {
      const chText = `${ch.cause || ""} ${ch.impact || ""} ${ch.behavior || ""} ${ch.pain || ""}`;
      const s = aelOverlapScore(chText, objText);
      if (s > bestChScore) { bestChScore = s; bestCh = ch; }
    }
    if (bestCh && bestChScore >= AEL_GROUNDING_MIN_OVERLAP) {
      obj.causalChainAlignment = `Causal chain — cause: ${bestCh.cause || ""}; impact: ${bestCh.impact || ""}; behavior: ${bestCh.behavior || ""}; pain: ${bestCh.pain || ""}`.slice(0, 500);
    }
  }
}

interface CandidateObjection {
  id: string;
  statement: string;
  objType: StructuredObjection["objectionType"];
  stage: StructuredObjection["objectionStage"];
  source: StructuredObjection["source"];
  proofStatus: "PROOF_ESTABLISHED" | "PROOF_TO_BUILD";
  confidence: number;
}

interface ReasonedObjectionItem {
  objectionId: string;
  objectionStatement: string;
  objectionType: StructuredObjection["objectionType"];
  response: string;
  requiredProof: string;
  proofStatus: "PROOF_ESTABLISHED" | "PROOF_TO_BUILD";
}

interface ReasonedObjectionsPayload {
  objections: ReasonedObjectionItem[];
}

export async function buildReasonedStructuredObjections(
  audience: PersuasionAudienceInput,
  mi: PersuasionMIInput,
  positioning: PersuasionPositioningInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  awareness: PersuasionAwarenessInput,
  strategic?: RunStrategicContext | null,
  productDna?: ProductDnaLike | null,
  analyticalEnrichment?: any,
  accountId?: string,
): Promise<StructuredObjection[]> {
  const candidateObjections: CandidateObjection[] = [];
  const seen = new Set<string>();

  const primaryLane = (strategic as any)?.laneContext
    || (strategic as any)?.approvedLanes?.find((l: any) => l.isPrimary || l.laneId === (strategic as any)?.laneId)
    || (strategic as any)?.approvedLanes?.[0]
    || (strategic as any)?.strategyRoot?.approvedLanes?.find((l: any) => l.isPrimary || l.laneId === (strategic as any)?.laneId)
    || (strategic as any)?.strategyRoot?.approvedLanes?.[0]
    || (audience as any)?.laneContext 
    || ((audience as any)?.approvedLanes || []).find((l: any) => l.isPrimary) 
    || ((audience as any)?.approvedLanes || [])[0];
  const lanePains = primaryLane ? (primaryLane.corePainIds || primaryLane.associatedPains || (primaryLane.primaryPainId ? [primaryLane.primaryPainId] : [])) : null;

  // 1. PRIMARY AUTHORITY: Lane-scoped approved objections from the active strategic lane
  const laneScopedObjections: string[] = [];
  const rawLaneObjs = primaryLane?.objections
    || primaryLane?.approvedLane?.objections
    || primaryLane?.associatedObjections
    || primaryLane?.approvedLane?.associatedObjections;

  if (Array.isArray(rawLaneObjs)) {
    for (const obj of rawLaneObjs) {
      if (typeof obj === "string" && obj.trim().length > 2) {
        laneScopedObjections.push(obj.trim());
      } else if (obj && typeof obj === "object" && (obj.canonical || obj.statement || obj.objection)) {
        laneScopedObjections.push(String(obj.canonical || obj.statement || obj.objection).trim());
      }
    }
  }

  // Also check if painRegistry has lane-scoped objections for this lane
  if (audience.painRegistry && lanePains && lanePains.length > 0) {
    const laneObjections = audience.painRegistry.filter(p => 
      (p.classification === "OBJECTION" || p.classification === "SUPPORTING") && lanePains.includes(p.painId)
    );
    for (const p of laneObjections) {
      const pStr = typeof p.canonical === "string" ? p.canonical : safeString(p.canonical || p.painId || "", "");
      if (pStr && !laneScopedObjections.includes(pStr)) {
        laneScopedObjections.push(pStr);
      }
    }
  }

  if (laneScopedObjections.length > 0) {
    for (const objStr of laneScopedObjections) {
      const normalized = objStr.toLowerCase().replace(/[\s-]+/g, "_").slice(0, 60);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const objType = classifyObjectionType(objStr);
      candidateObjections.push({
        id: `lane_obj_${candidateObjections.length + 1}`,
        statement: objStr.slice(0, 200),
        objType,
        stage: "consideration",
        source: "lane_objection",
        proofStatus: "PROOF_TO_BUILD",
        confidence: 0.95,
      });
    }
  }

  // 2. SECONDARY / SUPPORTING: Audience objection map (used only if lane has no objections or as secondary context)
  if (candidateObjections.length === 0) {
    const objectionMap = audience.objectionMap || {};
    for (const [key, value] of Object.entries(objectionMap)) {
      const statement = typeof value === "string" 
        ? value 
        : (Array.isArray(value) 
          ? value.join("; ") 
          : ((value as any)?.canonical || (value as any)?.statement || (value as any)?.text || (value as any)?.objection || key));
      const normalized = key.toLowerCase().replace(/[\s-]+/g, "_");
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const cleanStatement = typeof statement === "string" && statement.trim().startsWith("{")
        ? (safeJsonParse(statement)?.canonical || key)
        : (statement || key);

      const objType = classifyObjectionType(key + " " + cleanStatement);
      const stage = classifyObjectionStage(key + " " + cleanStatement);

      candidateObjections.push({
        id: `obj_map_${candidateObjections.length + 1}`,
        statement: cleanStatement.slice(0, 200) || key,
        objType,
        stage,
        source: "audience_objection",
        proofStatus: "PROOF_TO_BUILD",
        confidence: 0.8,
      });
    }
  }

  // 3. Narrative objections
  if (candidateObjections.length === 0) {
    const narrativeObjections = mi.narrativeObjections || [];
    for (const item of narrativeObjections) {
      if (!item.objection) continue;
      const normalized = item.objection.toLowerCase().replace(/[\s-]+/g, "_").slice(0, 60);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const signalType = item.signalType || "objection";
      let objType: StructuredObjection["objectionType"] = classifyObjectionType(item.objection);
      if (signalType === "trust_barrier") objType = "trust";
      const stage = classifyObjectionStage(item.objection, item.patternCategory);

      candidateObjections.push({
        id: `obj_nar_${candidateObjections.length + 1}`,
        statement: item.objection.slice(0, 200),
        objType,
        stage,
        source: "narrative_extraction",
        proofStatus: "PROOF_TO_BUILD",
        confidence: clamp(item.narrativeConfidence * 0.9, 0.3, 0.85),
      });
    }
  }

  // 4. Implied from pains
  if (candidateObjections.length === 0) {
    const audiencePains = audience.audiencePains || [];
    for (const pain of audiencePains.slice(0, 3)) {
      const painStr = typeof pain === "string" ? pain : safeString(pain?.pain || pain?.description || pain?.canonical || "", "");
      if (!painStr) continue;
      const normalized = painStr.toLowerCase().replace(/[\s-]+/g, "_").slice(0, 60);
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const objType = classifyObjectionType(painStr);
      candidateObjections.push({
        id: `obj_pain_${candidateObjections.length + 1}`,
        statement: `Implied objection from pain: ${painStr.slice(0, 180)}`,
        objType,
        stage: "awareness",
        source: "pain_inference",
        proofStatus: "PROOF_TO_BUILD",
        confidence: 0.5,
      });
    }
  }

  if (candidateObjections.length === 0) {
    return [];
  }

  const laneTitle = primaryLane?.title || primaryLane?.name || "Target Strategic Lane";
  const laneDesc = primaryLane?.description || primaryLane?.valueContext || "";
  const targetRole = primaryLane?.targetRole || primaryLane?.segmentName || (productDna as any)?.targetDecisionMaker || "Target Buyer";
  const coreOffer = offer?.coreOutcome || (productDna as any)?.coreOffer || strategic?.doctrine?.productAnchor?.name || "Offering";
  const mechanism = differentiation?.pillars?.[0] || (productDna as any)?.uniqueMechanism || offer?.mechanismDescription || strategic?.doctrine?.productAnchor?.uniqueMechanism || "Core Mechanism";
  const positioningAxis = positioning?.narrativeDirection || positioning?.positioningStatement || strategic?.doctrine?.productAnchor?.coreProblemSolved || "Strategic Differentiation";

  const productTruthList = (productDna as any)?.productTruthFacts?.map((f: any) => `- [${f.factType || 'FACT'}] ${f.statement} (Fact ID: ${f.productTruthFactId})`).join("\n")
    || (strategic?.doctrine?.productAnchor?.sourceFacts || []).map((f: any) => `- ${f.statement || f}`).join("\n")
    || "- Validated capability architecture";

  const promptInput = {
    laneTitle,
    laneDesc,
    targetRole,
    coreOffer,
    mechanism,
    positioningAxis,
    productTruthList,
    candidateObjections,
  };

  const { result: reasonedPayload } = await generateWithRepair<any, ReasonedObjectionsPayload>({
    engineName: "PersuasionEngine-V3",
    touchpointName: "objection_response_reasoning",
    authoritativeInput: promptInput,
    config: { maxRepairs: 2, failClosed: true },
    generate: async () => {
      const prompt = `You are the Persuasion Reasoning Engine for Avyron AI.
Generate tailored, objection-specific strategic persuasion responses for the active strategic lane.

=== CANONICAL CONTEXT ===
Strategic Lane: ${laneTitle}
Lane Description: ${laneDesc}
Target Role: ${targetRole}
Core Offering: ${coreOffer}
Unique Mechanism: ${mechanism}
Positioning Axis: ${positioningAxis}

CANONICAL PRODUCT TRUTH CAPABILITIES:
${productTruthList}

=== OBJECTIONS TO RESOLVE ===
${candidateObjections.map((o, idx) => `[Objection ${idx + 1}]
- Objection ID: ${o.id}
- Statement: "${o.statement}"
- Objection Type: ${o.objType}
- Proof Status: ${o.proofStatus}
`).join("\n")}

=== RULES ===
1. INDEPENDENT STRATEGIC REASONING:
   - Reason a direct, compelling persuasion response for EACH objection tailored to the active lane context, target role, and unique mechanism.
   - NEVER use deterministic category templates or hardcoded prefixes (e.g. "Address credibility concern with third-party validation...", "Simplify with step-by-step mechanism explanation...", "Demonstrate proven process and real outcomes...", "Reframe value proposition with ROI evidence...", "Provide specific proof addressing...").
   - Every response must be distinct, substantive (at least 20 words), and address the specific friction described.

2. BUILD PROOF INTEGRITY RULE:
   - For objections where Proof Status is "PROOF_TO_BUILD", the response MUST NOT claim or imply existing customer proof (do NOT use "proven outcomes", "our customer results", "existing case studies", "demonstrated success", "proven process and real outcomes").
   - Instead, explain the specific architectural guarantee, transparent validation workflow, or step-by-step demonstration that will be built/provided to resolve the objection.

3. REQUIRED JSON OUTPUT:
Return ONLY a valid JSON object matching this schema (no markdown fences, no preamble):
{
  "objections": [
    {
      "objectionId": "exact objection ID",
      "objectionStatement": "exact objection statement",
      "objectionType": "trust" | "cost" | "complexity" | "feasibility" | "timing",
      "response": "substantive persuasion response tailored to this objection",
      "requiredProof": "specific proof artifact or validation method",
      "proofStatus": "PROOF_ESTABLISHED" | "PROOF_TO_BUILD"
    }
  ]
}
`;

      const resp = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2500,
        endpoint: "persuasion-engine-objection-reasoner",
        accountId,
      });

      const content = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      return safeJsonParse<ReasonedObjectionsPayload>(cleaned) || { objections: [] };
    },
    judge: async (input, candidate) => {
      if (!candidate || !Array.isArray(candidate.objections) || candidate.objections.length === 0) {
        return {
          valid: false,
          failureClass: "CONTRACT_FAILURE",
          rejections: [{ rule: "Valid JSON", reason: "Output must be valid JSON containing a non-empty objections array" }]
        };
      }

      const rejections: any[] = [];
      for (const obj of candidate.objections) {
        if (!obj.response || typeof obj.response !== "string" || obj.response.trim().length < 20) {
          rejections.push({
            rule: "Non-Empty Response",
            reason: `Objection '${obj.objectionId || obj.objectionStatement}' has an empty or trivial response.`
          });
          continue;
        }

        const lowerResp = obj.response.toLowerCase();

        // Check for hardcoded template patterns:
        if (
          lowerResp.includes("address credibility concern with third-party validation") ||
          lowerResp.includes("simplify with step-by-step mechanism explanation") ||
          lowerResp.includes("demonstrate proven process and real outcomes") ||
          lowerResp.includes("reframe value proposition with roi evidence") ||
          lowerResp.includes("provide specific proof addressing")
        ) {
          rejections.push({
            rule: "No Hardcoded Templates",
            reason: `Objection '${obj.objectionId || obj.objectionStatement}' returned a deterministic category template instead of genuine persuasion reasoning.`
          });
        }

        // Check BUILD PROOF RULE:
        if (obj.proofStatus === "PROOF_TO_BUILD" || !obj.proofStatus) {
          if (
            lowerResp.includes("proven outcomes") ||
            lowerResp.includes("our customer results") ||
            lowerResp.includes("existing case studies") ||
            lowerResp.includes("demonstrated success") ||
            lowerResp.includes("proven process and real outcomes")
          ) {
            rejections.push({
              rule: "Build Proof Integrity",
              reason: `Objection '${obj.objectionId || obj.objectionStatement}' has proofStatus=PROOF_TO_BUILD but claims existing proof ('proven outcomes' / 'existing case studies').`
            });
          }
        }
      }

      if (rejections.length > 0) {
        return {
          valid: false,
          failureClass: "GENERATION_QUALITY_FAILURE",
          rejections
        };
      }

      return { valid: true, recoveredValue: candidate };
    },
    repair: async (input, failedCandidate, rejections) => {
      const defect = rejections.map(r => r.reason).join(" | ");
      const repairPromptText = `You are the Persuasion Repair Module for Avyron AI.
Your previous objection responses were rejected by the Semantic Judge.

--- REJECTION REASON ---
${defect}

--- MANDATORY RULES ---
1. Genuinely reason each response for its specific objection, lane, and target role. Do NOT use category template phrases (e.g. "Address credibility concern...", "Demonstrate proven process...", "Simplify with step-by-step...").
2. BUILD PROOF INTEGRITY: When proofStatus is PROOF_TO_BUILD, do NOT claim existing proof ("proven outcomes", "our customer results", "case studies"). Focus on the architectural mechanism and verifiable demonstration to be provided.
3. Return a valid JSON object with {"objections": [...]}.
`;

      const resp = await aiChat({
        model: "gpt-4.1-mini",
        messages: [
          { role: "user", content: JSON.stringify(input) },
          { role: "assistant", content: JSON.stringify(failedCandidate) },
          { role: "user", content: repairPromptText }
        ],
        temperature: 0.2,
        max_tokens: 2500,
        endpoint: "persuasion-engine-objection-repair",
        accountId,
      });

      const content = resp.choices[0]?.message?.content?.trim() || "{}";
      const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      return safeJsonParse<ReasonedObjectionsPayload>(cleaned) || { objections: [] };
    }
  });

  if (!reasonedPayload || !Array.isArray(reasonedPayload.objections) || reasonedPayload.objections.length === 0) {
    throw new LLMReliabilityError("PERSUASION_OBJECTION_REASONING_FAILED: Failed to reason valid objection responses after bounded retries.", "persuasion-engine", "objection_response_reasoning");
  }

  const structuredObjections: StructuredObjection[] = [];
  for (const item of reasonedPayload.objections) {
    const candidate = candidateObjections.find(c => c.id === item.objectionId || c.statement === item.objectionStatement) || candidateObjections[0];
    const objType = item.objectionType || candidate?.objType || "trust";
    structuredObjections.push({
      objectionId: item.objectionId || candidate?.id,
      objectionStatement: item.objectionStatement || candidate?.statement || "",
      objectionTrigger: candidate?.source || "lane_objection",
      objectionStage: candidate?.stage || "consideration",
      objectionType: objType,
      requiredProofType: item.requiredProof || OBJECTION_PROOF_TYPE_MAP[objType],
      persuasionResponse: item.response,
      source: candidate?.source || "audience_objection",
      proofStatus: item.proofStatus || candidate?.proofStatus || "PROOF_TO_BUILD",
      confidence: candidate?.confidence || 0.85,
    });
  }

  return structuredObjections;
}

function assessDataReliability(
  mi: PersuasionMIInput,
  audience: PersuasionAudienceInput,
  positioning: PersuasionPositioningInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  awareness: PersuasionAwarenessInput,
  structuredObjections?: StructuredObjection[],
): DataReliabilityDiagnostics {
  const advisories: string[] = [];

  const opportunities = (mi.opportunitySignals || []).length;
  const threats = (mi.threatSignals || []).length;
  const totalMISignals = opportunities + threats;
  const signalDensity = clamp(totalMISignals / 8, 0, 1);
  if (totalMISignals < 3) advisories.push(`Low MI signal density: only ${totalMISignals} signal(s) detected`);

  const sourceDiversity: Set<string> = new Set();
  if ((audience.audiencePains || []).length > 0) sourceDiversity.add("pains");
  if ((audience.emotionalDrivers || []).length > 0) sourceDiversity.add("drivers");
  if (Object.keys(audience.objectionMap || {}).length > 0) sourceDiversity.add("objections");
  if ((audience.audienceSegments || []).length > 0) sourceDiversity.add("segments");
  if (mi.marketDiagnosis) sourceDiversity.add("diagnosis");
  if (positioning.narrativeDirection) sourceDiversity.add("narrative");
  if ((differentiation.pillars || []).length > 0) sourceDiversity.add("pillars");
  if (offer.coreOutcome) sourceDiversity.add("offer_outcome");
  if (awareness.entryMechanismType) sourceDiversity.add("awareness_entry");
  const signalDiversity = clamp(sourceDiversity.size / 7, 0, 1);
  if (sourceDiversity.size < 3) advisories.push(`Low signal diversity: only ${sourceDiversity.size}/9 data sources populated`);

  const hasNarrative = !!positioning.narrativeDirection;
  const hasPillars = (differentiation.pillars || []).length > 0;
  const narrativeStability = hasNarrative && hasPillars ? 1.0 : hasNarrative || hasPillars ? 0.5 : 0.2;
  if (narrativeStability < 0.5) advisories.push("Low narrative stability: positioning and differentiation data sparse");

  const competitorValidity = clamp(totalMISignals / 5, 0, 1);

  const marketMaturityConfidence = clamp(
    (safeNumber(mi.overallConfidence, 0) + safeNumber(positioning.confidenceScore, 0) + safeNumber(differentiation.confidenceScore, 0)) / 3,
    0,
    1
  );

  const objectionKeys = Object.keys(audience.objectionMap || {});
  const objectionValues = objectionKeys.map(k => (audience.objectionMap || {})[k]);
  const hasDetailedObjections = objectionValues.some(v => {
    if (typeof v === "string" && v.length > 10) return true;
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === "object" && v !== null && Object.keys(v).length > 0) return true;
    return false;
  });

  let objectionSpecificity: number;
  if (structuredObjections && structuredObjections.length > 0) {
    const hasStage = structuredObjections.some(o => !!o.objectionStage);
    const hasType = structuredObjections.some(o => !!o.objectionType);
    const hasProof = structuredObjections.some(o => !!o.requiredProofType);
    const hasResponse = structuredObjections.some(o => !!o.persuasionResponse);
    const fieldCompleteness = [hasStage, hasType, hasProof, hasResponse].filter(Boolean).length / 4;
    const sourceTypes = new Set(structuredObjections.map(o => o.source));
    const sourceDiversityBonus = clamp((sourceTypes.size - 1) * 0.1, 0, 0.2);
    const countFactor = clamp(structuredObjections.length / 6, 0.3, 1.0);
    objectionSpecificity = clamp(
      countFactor * 0.4 + fieldCompleteness * 0.4 + sourceDiversityBonus + 0.1,
      0.6,
      1.0
    );
  } else if (objectionKeys.length === 0) {
    objectionSpecificity = 0.1;
  } else if (hasDetailedObjections) {
    objectionSpecificity = clamp(objectionKeys.length / 5, 0.3, 1.0);
  } else {
    objectionSpecificity = clamp(objectionKeys.length / 5, 0.15, 0.6);
  }
  if (objectionSpecificity < 0.3) advisories.push(`Weak objection specificity (${Math.round(objectionSpecificity * 100)}%) — persuasion objection handling may be imprecise`);

  const trustReq = safeString(awareness.trustRequirement, "medium");
  const hasFriction = (awareness.frictionNotes || []).length > 0;
  const trustSpecificity = trustReq !== "unknown"
    ? (hasFriction ? clamp(0.5 + (awareness.frictionNotes || []).length * 0.1, 0.5, 1.0) : 0.5)
    : 0.2;
  if (trustSpecificity < 0.4) advisories.push(`Weak trust specificity (${Math.round(trustSpecificity * 100)}%) — trust barrier mapping may be generic`);

  const overallReliability = clamp(
    signalDensity * 0.15 + signalDiversity * 0.15 + narrativeStability * 0.15 +
    competitorValidity * 0.10 + marketMaturityConfidence * 0.15 +
    objectionSpecificity * 0.15 + trustSpecificity * 0.15,
    0,
    1
  );

  const isWeak = overallReliability < 0.4;
  if (isWeak) advisories.push("Overall data reliability is WEAK — confidence scores will be capped");

  return {
    signalDensity, signalDiversity, narrativeStability, competitorValidity,
    marketMaturityConfidence, objectionSpecificity, trustSpecificity,
    overallReliability, isWeak, advisories,
  };
}

function normalizeConfidence(rawScore: number, reliability: DataReliabilityDiagnostics): number {
  if (reliability.isWeak) {
    return clamp(rawScore * 0.6, 0, 0.55);
  }
  if (reliability.overallReliability < 0.6) {
    return clamp(rawScore * 0.8, 0, 0.75);
  }
  return clamp(rawScore, 0, 1);
}

function classifyTrustBarriers(
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  mi: PersuasionMIInput,
): { trustBarriers: TrustBarrierClassification[]; awarenessStageProperties: AwarenessStageProperty[] } {
  const barriers: TrustBarrierClassification[] = [];
  const awarenessProps: AwarenessStageProperty[] = [];
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const maturity = safeNumber(audience.maturityIndex, 0.5);

  if (isLowReadiness(readiness)) {
    awarenessProps.push({
      propertyType: "low_awareness_skepticism",
      readinessStage: readiness,
      description: `Skepticism in "${readiness}" audiences is a natural stage property, not a trust barrier. Audience does not yet have sufficient context to evaluate credibility claims.`,
      handlingLayer: "awareness_to_persuasion_fit — education-first sequence required before any proof or commitment logic",
    });
  }

  const competitors = (mi.threatSignals || []).length;
  if (competitors > 2 && !differentiation.authorityMode) {
    barriers.push({
      barrierType: "competitor_similarity_distrust",
      severity: competitors > 4 ? "high" : "moderate",
      source: `${competitors} competitor threats detected without strong authority mode`,
      persuasionImplication: "Contrast and differentiation must lead persuasion to break similarity bias",
    });
  }

  const mechanismFraming = differentiation.mechanismFraming;
  const hasStrongMechanism = mechanismFraming && (typeof mechanismFraming === "string" ? mechanismFraming.length > 10 : Object.keys(mechanismFraming).length > 0);
  if (!hasStrongMechanism) {
    barriers.push({
      barrierType: "mechanism_disbelief",
      severity: "high",
      source: "Weak or missing mechanism framing in differentiation",
      persuasionImplication: "Process proof and mechanism explanation required before outcome claims",
    });
  }

  const proofArch = differentiation.proofArchitecture || [];
  if (proofArch.length < 2 && trustReq === "high") {
    barriers.push({
      barrierType: "proof_sensitivity",
      severity: "high",
      source: `High trust requirement with only ${proofArch.length} proof element(s)`,
      persuasionImplication: "Third-party validation and case studies must compensate for proof gap",
    });
  }

  if (safeNumber(offer.frictionLevel, 0) > 0.6) {
    barriers.push({
      barrierType: "outcome_doubt",
      severity: "moderate",
      source: `High offer friction (${Math.round(safeNumber(offer.frictionLevel, 0) * 100)}%)`,
      persuasionImplication: "Outcome proof and risk reversal must precede commitment invitation",
    });
  }

  if (maturity > 0.6 && trustReq === "high") {
    barriers.push({
      barrierType: "general_market_fatigue",
      severity: "moderate",
      source: "High maturity audience with high trust requirement suggests market fatigue",
      persuasionImplication: "Novel proof types and unconventional authority signals needed",
    });
  }

  const commitLevel = safeString("", "");
  if (safeNumber(offer.offerStrengthScore, 0) > 0.7 && trustReq === "high") {
    barriers.push({
      barrierType: "high_commitment_anxiety",
      severity: "moderate",
      source: "Strong offer with high trust requirement indicates commitment anxiety",
      persuasionImplication: "Gradual commitment ladder and risk removal must frame the conversion path",
    });
  }

  return { trustBarriers: barriers, awarenessStageProperties: awarenessProps };
}

function buildObjectionProofLinks(
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  awareness: PersuasionAwarenessInput,
  mi: PersuasionMIInput,
): ObjectionProofLink[] {
  const links: ObjectionProofLink[] = [];
  const proofArch = differentiation.proofArchitecture || [];
  const proofTypes = new Set(proofArch.map((p: any) => safeString(p?.type || p?.proofType || p, "unknown").toLowerCase()));

  const objectionMap = audience.objectionMap || {};
  const objectionKeys = Object.keys(objectionMap);

  for (const key of objectionKeys) {
    const normalizedKey = key.toLowerCase().replace(/[\s-]+/g, "_");
    let matchedCategory = "";
    let requiredProof = "general_proof";

    for (const [category, proof] of Object.entries(OBJECTION_PROOF_MAP)) {
      if (normalizedKey.includes(category) || category.includes(normalizedKey)) {
        matchedCategory = category;
        requiredProof = proof;
        break;
      }
    }

    if (!matchedCategory) {
      if (normalizedKey.includes("price") || normalizedKey.includes("cost") || normalizedKey.includes("expensive")) {
        matchedCategory = "price_resistance";
        requiredProof = "value_proof";
      } else if (normalizedKey.includes("time") || normalizedKey.includes("busy") || normalizedKey.includes("effort")) {
        matchedCategory = "time_concern";
        requiredProof = "efficiency_proof";
      } else if (normalizedKey.includes("trust") || normalizedKey.includes("scam") || normalizedKey.includes("legit")) {
        matchedCategory = "promise_distrust";
        requiredProof = "transparency_proof";
      } else if (normalizedKey.includes("work") || normalizedKey.includes("result") || normalizedKey.includes("outcome")) {
        matchedCategory = "outcome_doubt";
        requiredProof = "outcome_proof";
      } else if (normalizedKey.includes("compet") || normalizedKey.includes("altern") || normalizedKey.includes("better")) {
        matchedCategory = "competitor_comparison";
        requiredProof = "differentiation_proof";
      } else {
        matchedCategory = normalizedKey;
        requiredProof = "general_proof";
      }
    }

    const proofAvailable = proofTypes.has(requiredProof) || proofTypes.has("general") || proofArch.length >= 2;
    const detail = typeof objectionMap[key] === "string" ? objectionMap[key] : JSON.stringify(objectionMap[key]).slice(0, 100);

    links.push({
      objectionCategory: matchedCategory,
      objectionDetail: detail,
      requiredProofType: requiredProof,
      proofAvailable,
      confidence: proofAvailable ? 0.7 : 0.3,
    });
  }

  if (links.length === 0) {
    const pains = audience.audiencePains || [];
    for (const pain of pains.slice(0, 3)) {
      const painStr = typeof pain === "string" ? pain : safeString(pain?.pain || pain?.description || "", "audience concern");
      links.push({
        objectionCategory: "inferred_from_pain",
        objectionDetail: painStr.slice(0, 100),
        requiredProofType: "outcome_proof",
        proofAvailable: proofArch.length >= 1,
        confidence: 0.4,
      });
    }

    const riskNotes = offer.riskNotes || [];
    for (const risk of riskNotes.slice(0, 2)) {
      links.push({
        objectionCategory: "inferred_from_risk",
        objectionDetail: risk.slice(0, 100),
        requiredProofType: "risk_removal_proof",
        proofAvailable: proofArch.length >= 1,
        confidence: 0.35,
      });
    }

    const frictionNotes = awareness.frictionNotes || [];
    for (const friction of frictionNotes.slice(0, 2)) {
      links.push({
        objectionCategory: "inferred_from_friction",
        objectionDetail: friction.slice(0, 100),
        requiredProofType: "transparency_proof",
        proofAvailable: proofArch.length >= 1,
        confidence: 0.3,
      });
    }

    if (links.length === 0) {
      const threats = (mi.threatSignals || []).slice(0, 2);
      for (const threat of threats) {
        const threatStr = typeof threat === "string" ? threat : safeString(threat?.signal || threat?.description || "", "competitive concern");
        links.push({
          objectionCategory: "inferred_from_competition",
          objectionDetail: threatStr.slice(0, 100),
          requiredProofType: "differentiation_proof",
          proofAvailable: (differentiation.pillars || []).length > 0,
          confidence: 0.25,
        });
      }
    }
  }

  return links;
}

function validateScarcityConditions(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
  funnel: PersuasionFunnelInput,
  objectionProofLinks: ObjectionProofLink[],
): { allowed: boolean; blockedReasons: string[] } {
  const blockedReasons: string[] = [];
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const proofCount = (differentiation.proofArchitecture || []).length;
  const funnelType = safeString(funnel.funnelType, "").toLowerCase();

  if (trustReq === "high") {
    blockedReasons.push("Trust is still high — scarcity damages credibility when trust is unresolved");
  }

  if (isLowReadiness(readiness)) {
    blockedReasons.push(`Awareness is ${readiness} — scarcity is inappropriate before audience understands the problem`);
  }

  if (proofCount < 2) {
    blockedReasons.push(`Insufficient proof (${proofCount} elements) — scarcity without proof is manipulative`);
  }

  const unresolvedObjections = objectionProofLinks.filter(l => !l.proofAvailable);
  if (unresolvedObjections.length > 0) {
    blockedReasons.push(`${unresolvedObjections.length} objection(s) lack proof resolution — scarcity before objection handling is premature`);
  }

  if (funnelType.includes("diagnostic") || funnelType.includes("education") || funnelType.includes("free")) {
    blockedReasons.push(`Funnel type "${funnelType}" is educational/diagnostic — scarcity contradicts the funnel intent`);
  }

  return { allowed: blockedReasons.length === 0, blockedReasons };
}

function layer1_awarenessToPersuasionFit(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  funnel: PersuasionFunnelInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const entry = safeString(awareness.entryMechanismType, "unknown");
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();

  findings.push(`Awareness entry mechanism: ${entry}`);
  findings.push(`Target readiness stage: ${readiness}`);

  if (entry === "proof_led_entry" || entry === "authority_entry") {
    if (isLowReadiness(readiness)) {
      findings.push(`ENTRY MODE UPGRADE: ${entry} detected at ${readiness} stage — switching to education_proof_hybrid (proof supports education, not conversion)`);
      findings.push("Proof role: support_education — light trust signals and micro-authority permitted");
      score += 0.1;
    } else {
      score += 0.2;
      findings.push("High-trust entry mechanism detected — proof-based persuasion aligned");
    }
  } else if (entry === "pain_entry") {
    score += 0.15;
    findings.push("Pain-based entry mechanism — empathy-led persuasion required");
  } else if (entry === "myth_breaker_entry") {
    score += 0.1;
    findings.push("Myth-breaker entry — contrast-based persuasion needed");
  } else if (entry === "diagnostic_entry") {
    score += 0.15;
    findings.push("Diagnostic entry — education-first persuasion pathway");
  }

  if (readiness === "unaware") {
    if (trustReq === "high") {
      score += 0.1;
      findings.push("HYBRID MODE ACTIVATED: unaware + high trust → education_proof_hybrid with light authority injection");
      findings.push("Entry mode: education_proof_hybrid — proof supports understanding + trust building, NOT conversion");
      findings.push("Permitted: light trust signals, micro-authority, contrast framing, progressive curiosity");
      findings.push("Blocked tactics: hard CTA, urgency pressure, commitment injection, conversion-oriented proof");
    } else {
      score -= 0.05;
      findings.push("UNAWARE STAGE: education-first with controlled persuasion layer — proof supports education");
      findings.push("Entry mode: education_proof_hybrid — micro-tension and curiosity permitted, hard CTA blocked");
    }
  } else if (readiness === "problem_aware") {
    score -= 0.05;
    findings.push("Problem aware: education-first with soft engagement — proof supports understanding");
    findings.push("Blocked tactics: hard CTA, early commitment, aggressive conversion");
  } else if (readiness === "most_aware") {
    score += 0.15;
    findings.push("Most aware stage — direct proof and commitment persuasion viable");
  } else if (readiness === "solution_aware") {
    score += 0.1;
    findings.push("Solution aware — mechanism differentiation persuasion appropriate");
  }

  if (trustReq === "high") {
    if (isLowReadiness(readiness)) {
      findings.push("High trust requirement at low readiness — injecting light authority + structured proof within education flow");
      score += 0.05;
    } else {
      findings.push("High trust requirement — persuasion must front-load proof and authority");
    }
  }

  const awarenessScore = safeNumber(awareness.awarenessStrengthScore, 0);
  if (awarenessScore < 0.4) {
    score -= 0.05;
    findings.push(`Awareness strength at ${Math.round(awarenessScore * 100)}% — hybrid mode compensates with structured education`);
  }

  const compatibleModes = FUNNEL_PERSUASION_COMPATIBILITY[funnelType] || [];
  if (compatibleModes.length > 0) {
    findings.push(`Funnel type "${funnelType}" compatible with: ${compatibleModes.join(", ")}`);
  }

  return { layerName: "awareness_to_persuasion_fit", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer2_objectionDetection(
  audience: PersuasionAudienceInput,
  offer: PersuasionOfferInput,
  differentiation: PersuasionDifferentiationInput,
  awareness: PersuasionAwarenessInput,
  mi: PersuasionMIInput,
  funnel: PersuasionFunnelInput,
  integrity: PersuasionIntegrityInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const objections = audience.objectionMap || {};
  const objectionKeys = Object.keys(objections);
  let directObjectionCount = objectionKeys.length;

  const hasNarrativeObjections = (mi.narrativeObjectionCount ?? 0) > 0;

  if (directObjectionCount === 0 && !hasNarrativeObjections) {
    warnings.push("No direct audience objections detected — activating fallback objection inference");

    const fallbackSources: string[] = [];

    const pains = audience.audiencePains || [];
    if (pains.length > 0) {
      fallbackSources.push(`${pains.length} pain signal(s) → inferred objection concern`);
    }

    const trustReq = safeString(awareness.trustRequirement, "medium");
    if (trustReq === "high") {
      fallbackSources.push("High trust requirement → inferred credibility objection");
    }

    const frictionNotes = awareness.frictionNotes || [];
    if (frictionNotes.length > 0) {
      fallbackSources.push(`${frictionNotes.length} friction note(s) from awareness → inferred adoption objection`);
    }

    const proofReqs = funnel.proofPlacements || [];
    if (proofReqs.length > 0) {
      fallbackSources.push(`${proofReqs.length} funnel proof requirement(s) → inferred proof-gap objection`);
    }

    const integrityWarnings = integrity.structuralWarnings || [];
    if (integrityWarnings.length > 0) {
      fallbackSources.push(`${integrityWarnings.length} integrity warning(s) → inferred coherence objection`);
    }

    const riskNotes = offer.riskNotes || [];
    if (riskNotes.length > 0) {
      fallbackSources.push(`${riskNotes.length} offer risk note(s) → inferred risk objection`);
    }

    const threats = (mi.threatSignals || []).length;
    if (threats > 0) {
      fallbackSources.push(`${threats} competitor threat(s) → inferred comparison objection`);
    }

    const emotionalDrivers = (audience.emotionalDrivers || []).length;
    const segments = (audience.audienceSegments || []).length;
    if (segments > 1) {
      fallbackSources.push(`${segments} audience segment(s) → inferred relevance objection`);
    }

    if (fallbackSources.length > 0) {
      findings.push(`Fallback objection inference activated from ${fallbackSources.length} source(s):`);
      for (const src of fallbackSources) {
        findings.push(`  - ${src}`);
      }
      score -= 0.05;
      warnings.push(`LOW OBJECTION CONFIDENCE: Objections inferred from fallback sources — specificity is reduced`);
    } else {
      score -= 0.2;
      warnings.push("CRITICAL: No objection signals from any source — persuasion may miss critical barriers");
    }
  } else if (directObjectionCount === 0 && hasNarrativeObjections) {
    findings.push(`${mi.narrativeObjectionCount} content-derived narrative objection(s) detected from MI — treated as moderate confidence`);
    score += Math.min(mi.narrativeObjectionCount * 0.04, 0.15);
  } else {
    findings.push(`${directObjectionCount} direct objection category(ies) detected: ${objectionKeys.slice(0, 5).join(", ")}`);
    score += Math.min(directObjectionCount * 0.05, 0.2);
  }

  const riskNotes = offer.riskNotes || [];
  if (riskNotes.length > 0) {
    findings.push(`${riskNotes.length} offer risk note(s) may trigger objections`);
    score += 0.05;
  }

  const frictionLevel = safeNumber(offer.frictionLevel, 0);
  if (frictionLevel > 0.6) {
    warnings.push(`High offer friction (${Math.round(frictionLevel * 100)}%) — objection density likely elevated`);
    score -= 0.1;
  }

  const proofArch = differentiation.proofArchitecture || [];
  if (proofArch.length > 0) {
    findings.push(`${proofArch.length} proof element(s) available to address objections`);
    score += 0.1;
  } else {
    warnings.push("No proof architecture detected — objection resolution will be weak");
    score -= 0.1;
  }

  return { layerName: "objection_detection", passed: score >= 0.35, score: clamp(score), findings, warnings };
}

function layer3_trustBarrierMapping(
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
  integrity: PersuasionIntegrityInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  mi: PersuasionMIInput,
  trustBarriers: TrustBarrierClassification[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const trustReq = safeString(awareness.trustRequirement, "medium");
  findings.push(`Trust requirement from awareness: ${trustReq}`);

  if (trustBarriers.length === 0) {
    findings.push("No specific trust barriers classified — trust path is relatively clear");
    score += 0.1;
  } else {
    findings.push(`${trustBarriers.length} trust barrier(s) classified:`);
    for (const barrier of trustBarriers) {
      findings.push(`  [${barrier.severity.toUpperCase()}] ${barrier.barrierType}: ${barrier.persuasionImplication}`);

      if (barrier.severity === "critical") {
        score -= 0.2;
        warnings.push(`CRITICAL trust barrier: ${barrier.barrierType} — ${barrier.persuasionImplication}`);
      } else if (barrier.severity === "high") {
        score -= 0.12;
        warnings.push(`High-severity trust barrier: ${barrier.barrierType} — requires dedicated persuasion attention`);
      } else if (barrier.severity === "moderate") {
        score -= 0.05;
      }
    }
  }

  if (trustReq === "high") {
    score -= 0.05;
    warnings.push("High trust barrier — extended trust-building sequence required");
  } else if (trustReq === "low") {
    score += 0.15;
    findings.push("Low trust barrier — shorter persuasion path viable");
  }

  const maturity = safeNumber(audience.maturityIndex, 0.5);
  if (maturity < 0.3) {
    warnings.push(`Low audience maturity (${Math.round(maturity * 100)}%) — trust deficit likely`);
    score -= 0.1;
  } else if (maturity > 0.7) {
    findings.push(`High audience maturity (${Math.round(maturity * 100)}%) — audience receptive to direct persuasion`);
    score += 0.05;
  }

  const integrityScore = safeNumber(integrity.overallIntegrityScore, 0);
  if (integrityScore < 0.5) {
    warnings.push(`Low strategic integrity (${Math.round(integrityScore * 100)}%) — trust claims may lack upstream support`);
    score -= 0.1;
  } else {
    findings.push(`Strategic integrity validated (${Math.round(integrityScore * 100)}%)`);
    score += 0.05;
  }

  const hasMechanismBarrier = trustBarriers.some(b => b.barrierType === "mechanism_disbelief");
  const hasCompetitorBarrier = trustBarriers.some(b => b.barrierType === "competitor_similarity_distrust");
  const hasAwarenessBarrier = trustBarriers.some(b => b.barrierType === "low_awareness_skepticism");

  if (hasMechanismBarrier && hasCompetitorBarrier) {
    warnings.push("Compound barrier: mechanism disbelief + competitor similarity — requires strong differentiation-led trust sequence");
  }
  if (hasAwarenessBarrier) {
    warnings.push("Awareness-based skepticism detected — education must precede any proof deployment");
  }

  return { layerName: "trust_barrier_mapping", passed: score >= 0.3, score: clamp(score), findings, warnings };
}

function layer4_influenceDriverSelection(
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
  awareness: PersuasionAwarenessInput,
  trustBarriers: TrustBarrierClassification[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const selectedDrivers: string[] = [];
  const readiness = safeString(awareness.targetReadinessStage, "unknown");

  if (isLowReadiness(readiness)) {
    selectedDrivers.push("education", "diagnosis");
    findings.push(`Low readiness (${readiness}) → education + diagnosis drivers prioritized`);
  }

  const proofArch = differentiation.proofArchitecture || [];
  if (proofArch.length >= 2 && !isLowReadiness(readiness)) {
    selectedDrivers.push("proof_of_work");
    findings.push("Strong proof architecture → proof_of_work driver selected");
  }

  const authorityMode = safeString(differentiation.authorityMode, "");
  if (authorityMode) {
    selectedDrivers.push("authority");
    findings.push(`Authority mode detected (${authorityMode}) → authority driver selected`);
  }

  const entry = safeString(awareness.entryMechanismType, "");
  if (entry === "pain_entry") {
    if (!selectedDrivers.includes("contrast")) selectedDrivers.push("contrast");
    findings.push("Pain-based entry → contrast driver selected (before/after framing)");
  }
  if (entry === "myth_breaker_entry") {
    if (!selectedDrivers.includes("contrast")) selectedDrivers.push("contrast");
    if (!selectedDrivers.includes("specificity")) selectedDrivers.push("specificity");
    findings.push("Myth-breaker entry → contrast + specificity drivers selected");
  }

  const objections = Object.keys(audience.objectionMap || {});
  if (objections.length > 0) {
    if (!selectedDrivers.includes("risk_reversal")) selectedDrivers.push("risk_reversal");
    findings.push("Objections present → risk_reversal driver selected");
  }

  const segments = audience.audienceSegments || [];
  if (segments.length > 1) {
    if (!selectedDrivers.includes("social_proof")) selectedDrivers.push("social_proof");
    findings.push("Multiple audience segments → social_proof driver selected");
  }

  for (const barrier of trustBarriers) {
    if (barrier.barrierType === "mechanism_disbelief" && !selectedDrivers.includes("specificity")) {
      selectedDrivers.push("specificity");
      findings.push("Mechanism disbelief barrier → specificity driver added");
    }
    if (barrier.barrierType === "competitor_similarity_distrust" && !selectedDrivers.includes("contrast")) {
      selectedDrivers.push("contrast");
      findings.push("Competitor similarity barrier → contrast driver added");
    }
    if (barrier.barrierType === "proof_sensitivity" && !selectedDrivers.includes("proof_of_work")) {
      selectedDrivers.push("proof_of_work");
      findings.push("Proof sensitivity barrier → proof_of_work driver added");
    }
  }

  if (selectedDrivers.length === 0) {
    const pains = audience.audiencePains || [];
    const emotionalDrivers = audience.emotionalDrivers || [];
    if (pains.length > 0 || emotionalDrivers.length > 0) {
      if (pains.length > 0) {
        selectedDrivers.push("contrast");
        findings.push(`Pain signals present (${pains.length}) — contrast driver derived from audience pains`);
      }
      if (emotionalDrivers.length > 0) {
        selectedDrivers.push("education");
        findings.push(`Emotional drivers present (${emotionalDrivers.length}) — education driver derived from emotional signals`);
      }
    } else {
      warnings.push("SIGNAL_INSUFFICIENT: No audience pain or emotional driver signals available for driver selection — no template fallback permitted");
      score -= 0.3;
    }
  }

  score += Math.min(selectedDrivers.length * 0.06, 0.35);

  if (selectedDrivers.length < 2) {
    warnings.push("Only one influence driver selected — persuasion architecture may be narrow");
    score -= 0.1;
  }

  findings.push(`Selected influence drivers: ${selectedDrivers.join(", ")}`);

  return { layerName: "influence_driver_selection", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function buildTrustProofSequence(
  proofArch: any[],
  objectionProofLinks: ObjectionProofLink[],
): string[] {
  const availableProofTypes = new Set<string>();
  for (const p of proofArch) {
    const pType = (typeof p === "string" ? p : p?.type || p?.proofType || "").toLowerCase();
    availableProofTypes.add(pType);
  }
  for (const link of objectionProofLinks) {
    if (link.proofAvailable && link.requiredProofType) {
      availableProofTypes.add(link.requiredProofType.toLowerCase());
    }
  }

  const sequence: string[] = [];
  for (const escalationStep of TRUST_PROOF_ESCALATION_ORDER) {
    const stepLower = escalationStep.toLowerCase();
    const matched = [...availableProofTypes].some(p =>
      p.includes(stepLower.replace("_proof", "")) || stepLower.includes(p.replace("_proof", ""))
    );
    if (matched) {
      sequence.push(escalationStep);
    }
  }

  if (sequence.length === 0) {
    for (const p of [...availableProofTypes].slice(0, 4)) {
      sequence.push(p);
    }
  }

  return sequence;
}

function layer5_proofPriorityMapping(
  differentiation: PersuasionDifferentiationInput,
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
  objectionProofLinks: ObjectionProofLink[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const proofArch = differentiation.proofArchitecture || [];
  const claimStructures = differentiation.claimStructures || [];

  if (proofArch.length === 0 && claimStructures.length === 0) {
    score -= 0.25;
    warnings.push("No proof architecture or claim structures — persuasion lacks evidence foundation");
    return { layerName: "proof_priority_mapping", passed: false, score: clamp(score), findings, warnings };
  }

  findings.push(`${proofArch.length} proof element(s) and ${claimStructures.length} claim structure(s) available`);

  const trustProofSequence = buildTrustProofSequence(proofArch, objectionProofLinks);
  findings.push(`Trust proof escalation: ${trustProofSequence.join(" → ")}`);

  const trustReq = safeString(awareness.trustRequirement, "medium");
  const readiness = safeString(awareness.targetReadinessStage, "problem_aware");

  if (isLowReadiness(readiness)) {
    findings.push(`Low readiness (${readiness}) → proof must support education, not lead persuasion`);
    findings.push("Proof role: illustrative examples and pattern recognition, not conversion evidence");
    score += 0.05;
  } else if (trustReq === "high") {
    findings.push("High trust need → third-party proof and case studies should lead");
    score += 0.1;
  } else if (readiness === "most_aware") {
    findings.push("Most aware stage → specific results and metrics should lead");
    score += 0.15;
  } else {
    findings.push("Standard proof sequence → mechanism proof followed by outcome proof");
    score += 0.1;
  }

  if (objectionProofLinks.length > 0) {
    const linkedCount = objectionProofLinks.filter(l => l.proofAvailable).length;
    const unlinkedCount = objectionProofLinks.length - linkedCount;
    findings.push(`Objection-to-proof linking: ${linkedCount}/${objectionProofLinks.length} objection(s) have matching proof`);
    if (unlinkedCount > 0) {
      warnings.push(`${unlinkedCount} objection(s) lack direct proof resolution — persuasion gaps remain`);
      score -= unlinkedCount * 0.03;
    }
    if (linkedCount > 0) {
      score += Math.min(linkedCount * 0.04, 0.15);
    }
  }

  if (proofArch.length >= 3) {
    score += 0.1;
    findings.push("Rich proof architecture — multiple proof types available for sequencing");
  }

  const hasEscalationOrder = trustProofSequence.length >= 2;
  if (hasEscalationOrder) {
    score += 0.05;
    findings.push("Proof assets follow deterministic trust escalation path");
  } else if (proofArch.length > 0) {
    warnings.push("Proof assets do not cover enough escalation stages for full trust progression");
  }

  return { layerName: "proof_priority_mapping", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer6_messageOrderLogic(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
  differentiation: PersuasionDifferentiationInput,
  trustBarriers: TrustBarrierClassification[],
  objectionProofLinks: ObjectionProofLink[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const readiness = safeString(awareness.targetReadinessStage, "problem_aware");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const commitmentLevel = safeString(funnel.commitmentLevel, "medium");
  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();

  const sequence: string[] = [];

  const hasMechanismBarrier = trustBarriers.some(b => b.barrierType === "mechanism_disbelief");
  const hasCompetitorBarrier = trustBarriers.some(b => b.barrierType === "competitor_similarity_distrust");
  const hasProofSensitivity = trustBarriers.some(b => b.barrierType === "proof_sensitivity");
  const hasUnresolvedObjections = objectionProofLinks.some(l => !l.proofAvailable);
  const proofCount = (differentiation.proofArchitecture || []).length;

  if (readiness === "unaware") {
    sequence.push(
      "acknowledge_pain",
      "disrupt_assumption",
      "educate_on_problem",
      "introduce_mechanism",
      "reinforce_with_proof",
      "build_authority",
      "remove_risk",
      "soft_next_step",
    );
    findings.push(`UNAWARE HYBRID SEQUENCE: acknowledge → disrupt → educate → mechanism → proof(support) → authority(light) → risk → soft_next_step`);
    findings.push(`Controlled persuasion active: micro-tension via disrupt_assumption, curiosity via soft_next_step`);
    findings.push(`Proof positioned AFTER mechanism clarity — supports education, not conversion`);
    if (trustReq === "high") {
      findings.push(`High trust: build_authority injected as light authority signal within education flow`);
      score += 0.1;
    }
    score += 0.05;
  } else if (readiness === "problem_aware") {
    sequence.push(
      "acknowledge_pain",
      "disrupt_assumption",
      "educate_on_problem",
      "demonstrate_understanding",
      "introduce_mechanism",
    );
    if (proofCount > 0) sequence.push("reinforce_with_proof");
    sequence.push("build_authority", "remove_risk", "soft_next_step");
    findings.push(`Problem aware → education-first with disruption and mechanism clarity before proof`);
    score += 0.05;
  } else if (readiness === "solution_aware") {
    if (hasMechanismBarrier) {
      sequence.push("demonstrate_understanding", "explain_mechanism", "present_proof", "establish_authority", "address_objections", "remove_risk", "invite_commitment");
      findings.push("Solution aware + mechanism disbelief → mechanism explanation leads before proof");
    } else {
      sequence.push("demonstrate_understanding", "present_proof", "establish_authority", "address_objections", "remove_risk", "invite_commitment");
      findings.push("Solution aware → understanding-first sequence with objection handling");
    }
  } else if (readiness === "product_aware") {
    if (hasCompetitorBarrier) {
      sequence.push("establish_contrast", "present_proof", "establish_authority", "address_objections", "remove_risk", "invite_commitment");
      findings.push("Product aware + competitor similarity → contrast leads persuasion");
    } else {
      sequence.push("present_proof", "establish_authority", "address_objections", "remove_risk", "invite_commitment");
      findings.push("Product aware → proof-first compressed sequence");
    }
    score += 0.1;
  } else if (readiness === "most_aware") {
    sequence.push("present_proof", "remove_risk", "invite_commitment");
    findings.push("Most aware → direct proof-to-commitment sequence");
    score += 0.15;
  } else {
    sequence.push("acknowledge_pain", "educate_on_problem", "demonstrate_understanding", "present_proof", "establish_authority", "address_objections", "remove_risk", "invite_commitment");
    findings.push("Unknown readiness → full education-first sequence as safeguard");
  }

  const hasAuthorityStep = sequence.includes("establish_authority") || sequence.includes("build_authority");
  if (trustReq === "high" && !hasAuthorityStep) {
    const proofIdx = sequence.indexOf("present_proof");
    if (proofIdx >= 0) {
      sequence.splice(proofIdx, 0, "establish_authority");
    } else {
      sequence.unshift("establish_authority");
    }
    findings.push("High trust requirement → authority front-loaded before proof");
  }

  if (hasProofSensitivity) {
    const authIdx = Math.max(sequence.indexOf("establish_authority"), sequence.indexOf("build_authority"));
    const proofIdx = Math.max(sequence.indexOf("present_proof"), sequence.indexOf("reinforce_with_proof"));
    if (authIdx >= 0 && proofIdx >= 0 && authIdx > proofIdx) {
      const authStep = sequence[authIdx];
      sequence.splice(authIdx, 1);
      sequence.splice(proofIdx, 0, authStep);
      findings.push("Proof-sensitive audience → authority positioned before proof for credibility priming");
    }
  }

  if (hasUnresolvedObjections && !sequence.includes("address_objections")) {
    const commitIdx = sequence.indexOf("invite_commitment");
    if (commitIdx >= 0) {
      sequence.splice(commitIdx, 0, "address_objections");
    } else {
      sequence.push("address_objections");
    }
    findings.push("Unresolved objections → objection handling inserted before commitment");
  }

  if (commitmentLevel === "high") {
    if (!sequence.includes("remove_risk")) {
      const commitIdx = sequence.indexOf("invite_commitment");
      if (commitIdx >= 0) {
        sequence.splice(commitIdx, 0, "remove_risk");
      }
    }
    findings.push("High commitment funnel → risk removal emphasized before commitment");
    score += 0.05;
  }

  if (funnelType.includes("diagnostic") || funnelType.includes("challenge")) {
    if (!sequence.includes("educate_on_problem") && !sequence.includes("invite_self_identification")) {
      sequence.unshift("educate_on_problem");
      findings.push(`Funnel type "${funnelType}" → education step prepended to sequence`);
    }
  }

  const funnelStages = funnel.stageMap || [];
  const funnelDepth = funnelStages.length;
  if (funnelDepth >= 5) {
    if (sequence.includes("invite_commitment")) {
      const commitIdx = sequence.indexOf("invite_commitment");
      if (!sequence.includes("build_anticipation")) {
        sequence.splice(commitIdx, 0, "build_anticipation");
        findings.push(`Deep funnel (${funnelDepth} stages) → anticipation step injected before commitment — audience has more touchpoints for gradual escalation`);
      }
    }
    if (!sequence.includes("demonstrate_understanding") && sequence.length > 3) {
      sequence.splice(1, 0, "demonstrate_understanding");
      findings.push(`Deep funnel → demonstrate_understanding added early — multi-stage funnels need empathy anchoring`);
    }
    score += 0.05;
  } else if (funnelDepth > 0 && funnelDepth <= 2) {
    const educationSteps = ["educate_on_problem", "demonstrate_understanding", "disrupt_assumption"];
    const compressed = sequence.filter(s => !educationSteps.includes(s) || s === sequence[0]);
    if (compressed.length < sequence.length) {
      sequence.length = 0;
      sequence.push(...compressed);
      findings.push(`Shallow funnel (${funnelDepth} stages) → compressed sequence: removed redundant education steps for fast conversion path`);
    }
  }

  const funnelTrustPath = funnel.trustPath || [];
  if (Array.isArray(funnelTrustPath) && funnelTrustPath.length > 0) {
    const trustStages = funnelTrustPath.map((tp: any) => typeof tp === "string" ? tp : tp?.stage || tp?.name || "");
    const hasSocialProofStage = trustStages.some((s: string) => s.toLowerCase().includes("social") || s.toLowerCase().includes("testimonial"));
    if (hasSocialProofStage && !sequence.includes("present_proof")) {
      const authIdx = sequence.indexOf("establish_authority");
      if (authIdx >= 0) {
        sequence.splice(authIdx + 1, 0, "present_proof");
      } else {
        sequence.push("present_proof");
      }
      findings.push(`Funnel trust path includes social proof stage → proof step added to persuasion sequence`);
    }
  }

  const architectureViolations = validateMessageArchitecture(sequence);
  if (architectureViolations.length === 0) {
    findings.push(`Message architecture validated: follows problem → mechanism → proof → outcome → offer`);
    score += 0.1;
  } else {
    for (const violation of architectureViolations) {
      warnings.push(violation);
    }
    score -= architectureViolations.length * 0.02;
    findings.push(`Message architecture partially enforced — ${architectureViolations.length} ordering issue(s) detected`);
    score += 0.05;
  }

  findings.push(`Context-sensitive message order: ${sequence.join(" → ")}`);

  const stageCount = (funnel.stageMap || []).length;
  if (stageCount > 0) {
    findings.push(`Message architecture operates independently from funnel structure — persuasion steps (${sequence.length}) may span across ${stageCount} funnel stage(s), with multiple persuasion steps within each stage`);
  }

  return { layerName: "message_order_logic", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function validateMessageArchitecture(sequence: string[]): string[] {
  const violations: string[] = [];

  const categories = sequence.map(step => MESSAGE_STEP_CATEGORY_MAP[step] || "unknown");
  const knownCategories = categories.filter(c => c !== "unknown");

  if (knownCategories.length < 2) return violations;

  let lastArchIdx = -1;
  for (const cat of knownCategories) {
    const archIdx = MESSAGE_ARCHITECTURE_ORDER.indexOf(cat as any);
    if (archIdx === -1) continue;
    if (archIdx < lastArchIdx) {
      const expectedPhase = MESSAGE_ARCHITECTURE_ORDER[lastArchIdx];
      violations.push(`Architecture violation: "${cat}" phase appears after "${expectedPhase}" — expected order: problem → mechanism → proof → outcome → offer`);
    } else {
      lastArchIdx = archIdx;
    }
  }

  return violations;
}

function layer7_antiHypeGuard(
  allText: string,
  objectionProofLinks: ObjectionProofLink[],
  trustBarriers: TrustBarrierClassification[],
  readinessStage?: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.85;

  const textLower = allText.toLowerCase();
  const isLowReady = readinessStage === "unaware" || readinessStage === "problem_aware";

  let hardHypeCount = 0;
  for (const pattern of HYPE_PATTERNS_HARD) {
    if (textLower.includes(pattern.toLowerCase())) {
      hardHypeCount++;
      warnings.push(`Hard hype pattern detected: "${pattern}" — penalized regardless of stage`);
    }
  }

  if (hardHypeCount > 0) {
    const hardPenalty = hardHypeCount * 0.1;
    score -= hardPenalty;
    warnings.push(`${hardHypeCount} hard hype pattern(s) — credibility reduced by ${Math.round(hardPenalty * 100)}pts`);
  }

  let contextualFlagCount = 0;
  let contextualPassCount = 0;
  for (const pattern of HYPE_PATTERNS_CONTEXTUAL) {
    if (textLower.includes(pattern.toLowerCase())) {
      if (isLowReady) {
        contextualFlagCount++;
        findings.push(`Contextual power word "${pattern}" detected at ${readinessStage} stage — evaluated contextually, not penalized`);
      } else {
        contextualPassCount++;
      }
    }
  }

  if (contextualFlagCount > 0 && isLowReady) {
    findings.push(`${contextualFlagCount} contextual power word(s) at ${readinessStage} stage — evaluated for stage alignment, not penalized by density`);
    findings.push(`Contextual guard: neutral power words permitted when not exaggerated — credibility scoring maintained, suppression removed`);
  }

  if (contextualPassCount > 0) {
    findings.push(`${contextualPassCount} contextual power word(s) at ${readinessStage || "unknown"} stage — stage-appropriate, no penalty`);
  }

  if (hardHypeCount === 0 && contextualFlagCount === 0 && contextualPassCount === 0) {
    findings.push("No hype patterns detected — persuasion structure is grounded");
    score += 0.05;
  } else if (hardHypeCount === 0) {
    findings.push("No deceptive hype patterns — contextual power words evaluated and passed");
    score += 0.03;
  }

  let genericCount = 0;
  for (const phrase of GENERIC_PERSUASION_PHRASES) {
    if (textLower.includes(phrase.toLowerCase())) {
      genericCount++;
    }
  }

  if (genericCount > 3) {
    score -= 0.15;
    warnings.push(`${genericCount} generic persuasion phrases detected — output may lack specificity`);
  } else if (genericCount > 0) {
    score -= genericCount * 0.03;
    findings.push(`${genericCount} minor generic phrase(s) — within acceptable range`);
  } else {
    findings.push("No generic persuasion phrases detected — output is specific");
    score += 0.05;
  }

  let structuralGenericCount = 0;
  for (const pattern of GENERIC_STRUCTURE_PATTERNS) {
    if (textLower.includes(pattern.toLowerCase())) {
      structuralGenericCount++;
    }
  }

  if (structuralGenericCount > 0) {
    score -= structuralGenericCount * 0.06;
    warnings.push(`GENERIC SUPPRESSION: ${structuralGenericCount} structurally generic pattern(s) detected — persuasion logic is not rooted in upstream inputs`);
  }

  const allLinksInferred = objectionProofLinks.length > 0 && objectionProofLinks.every(l => l.confidence < 0.4);
  if (allLinksInferred) {
    score -= 0.08;
    warnings.push("All objection-proof links are inferred (low confidence) — persuasion structure may be generically templated");
  }

  const allBarriersGeneric = trustBarriers.length > 0 && trustBarriers.every(b => b.severity === "moderate");
  if (allBarriersGeneric && trustBarriers.length > 2) {
    score -= 0.05;
    warnings.push("All trust barriers are moderate severity — may indicate generic classification rather than genuine analysis");
  }

  return { layerName: "anti_hype_guard", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

function layer8_persuasionStrengthScoring(
  layerResults: LayerResult[],
  awareness: PersuasionAwarenessInput,
  trustBarriers: TrustBarrierClassification[],
  objectionProofLinks: ObjectionProofLink[],
  funnel: PersuasionFunnelInput,
  selectedMode: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  let weightedSum = 0;
  let totalWeight = 0;

  for (const lr of layerResults) {
    const weight = LAYER_WEIGHTS[lr.layerName] || 0.1;
    weightedSum += lr.score * weight;
    totalWeight += weight;
  }

  const structuralScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();

  let readinessMultiplier = 1.0;

  if (isLowReadiness(readiness)) {
    const isEducationMode = (EDUCATION_FIRST_MODES as readonly string[]).includes(selectedMode);
    if (!isEducationMode) {
      readinessMultiplier *= 0.7;
      warnings.push(`READINESS MISMATCH: ${selectedMode} mode selected for ${readiness} audience — education-first mode would be more appropriate`);
    } else if (selectedMode === "education_proof_hybrid") {
      findings.push(`Hybrid mode (education_proof_hybrid) correctly matches ${readiness} audience with controlled persuasion`);
      readinessMultiplier *= 1.15;
    } else {
      findings.push(`Education-first mode (${selectedMode}) correctly matches ${readiness} audience`);
      readinessMultiplier *= 1.05;
    }
  }

  if (trustReq === "high") {
    const criticalBarriers = trustBarriers.filter(b => b.severity === "critical" || b.severity === "high");
    if (criticalBarriers.length > 0) {
      if (selectedMode === "education_proof_hybrid" && isLowReadiness(readiness)) {
        readinessMultiplier *= 0.95;
        findings.push(`${criticalBarriers.length} high/critical trust barrier(s) present — hybrid mode mitigates with structured authority injection`);
      } else {
        readinessMultiplier *= 0.85;
        warnings.push(`${criticalBarriers.length} high/critical trust barrier(s) reduce persuasion strength`);
      }
    }
  }

  const unresolvedObjections = objectionProofLinks.filter(l => !l.proofAvailable);
  if (unresolvedObjections.length > 2) {
    readinessMultiplier *= 0.85;
    warnings.push(`${unresolvedObjections.length} unresolved objection(s) weaken persuasion completeness`);
  }

  const totalLinks = objectionProofLinks.length;
  const unmappedCount = unresolvedObjections.length;
  if (totalLinks > 0 && unmappedCount === totalLinks) {
    readinessMultiplier *= 0.70;
    warnings.push(`ALL ${totalLinks} objection-proof links are unmapped — persuasion has zero proof grounding`);
  } else if (totalLinks > 0 && unmappedCount / totalLinks > 0.5) {
    readinessMultiplier *= 0.85;
    warnings.push(`${unmappedCount}/${totalLinks} objection-proof links unmapped (>${Math.round(50)}%) — proof coverage is weak`);
  }

  const compatibleModes = FUNNEL_PERSUASION_COMPATIBILITY[funnelType] || [];
  if (compatibleModes.length > 0 && !compatibleModes.includes(selectedMode)) {
    readinessMultiplier *= 0.8;
    warnings.push(`FUNNEL MISMATCH: "${selectedMode}" is not compatible with "${funnelType}" funnel type — expected: ${compatibleModes.join(", ")}`);
  } else if (compatibleModes.length > 0) {
    findings.push(`Persuasion mode "${selectedMode}" is compatible with "${funnelType}" funnel type`);
  }

  const lowConfidenceLinks = objectionProofLinks.filter(l => l.confidence < 0.4);
  if (lowConfidenceLinks.length > objectionProofLinks.length * 0.5 && objectionProofLinks.length > 0) {
    readinessMultiplier *= 0.9;
    warnings.push("Majority of objection-proof links have low confidence — persuasion quality uncertain");
  }

  const score = clamp(structuralScore * readinessMultiplier);

  const passedCount = layerResults.filter(l => l.passed).length;
  const totalCount = layerResults.length;
  findings.push(`${passedCount}/${totalCount} layers passed`);
  findings.push(`Structural score: ${Math.round(structuralScore * 100)}%`);
  findings.push(`Readiness adjustment: ${Math.round(readinessMultiplier * 100)}%`);
  findings.push(`Final persuasion strength: ${Math.round(score * 100)}%`);

  if (score < 0.4) {
    warnings.push("Overall persuasion strength is WEAK — significant gaps in logic structure or readiness alignment");
  } else if (score < 0.6) {
    warnings.push("Moderate persuasion strength — some layers or readiness factors need reinforcement");
  } else {
    findings.push("Strong persuasion architecture — logic structure and readiness alignment are coherent");
  }

  return { layerName: "persuasion_strength_scoring", passed: score >= 0.4, score, findings, warnings };
}

function selectPersuasionMode(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
  funnel: PersuasionFunnelInput,
): string {
  const entry = safeString(awareness.entryMechanismType, "");
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const proofCount = (differentiation.proofArchitecture || []).length;
  const authorityMode = safeString(differentiation.authorityMode, "");
  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();

  const awarenessDefault = AWARENESS_PERSUASION_MAP[readiness];

  if (isLowReadiness(readiness)) {
    if (entry === "diagnostic_entry" || funnelType.includes("diagnostic")) return "diagnostic_led";
    if (entry === "pain_entry") return "empathy_led";
    if (readiness === "unaware") return "education_proof_hybrid";
    return awarenessDefault || "education_led";
  }

  if (readiness === "solution_aware") {
    if (entry === "myth_breaker_entry") return "contrast_led";
    if (entry === "diagnostic_entry") return "diagnostic_led";
    return awarenessDefault || "contrast_led";
  }

  if (readiness === "product_aware") {
    if (entry === "authority_entry" && authorityMode) return "authority_led";
    if (proofCount >= 2) return "proof_led";
    const compatibleModes = FUNNEL_PERSUASION_COMPATIBILITY[funnelType] || [];
    if (compatibleModes.length > 0 && compatibleModes.includes("proof_led")) return "proof_led";
    return awarenessDefault || "proof_led";
  }

  if (readiness === "most_aware") {
    if (proofCount >= 3) return "proof_led";
    if (entry === "authority_entry" && authorityMode) return "authority_led";
    return awarenessDefault || "proof_led";
  }

  const compatibleModes = FUNNEL_PERSUASION_COMPATIBILITY[funnelType] || [];
  if (compatibleModes.length > 0) {
    if (proofCount >= 3 && compatibleModes.includes("proof_led")) return "proof_led";
    if (authorityMode && compatibleModes.includes("authority_led")) return "authority_led";
    return compatibleModes[0];
  }

  return awarenessDefault || "education_led";
}

const AWARENESS_COMPATIBLE_MODES: Record<string, string[]> = {
  unaware: ["education_proof_hybrid", "education_led", "diagnostic_led"],
  problem_aware: ["empathy_led", "diagnostic_led", "education_led", "education_proof_hybrid"],
  solution_aware: ["contrast_led", "logic_led", "diagnostic_led"],
  product_aware: ["proof_led", "authority_led", "social_proof_led"],
  most_aware: ["proof_led", "authority_led", "logic_led"],
};

function applyAutoCorrection(selectedMode: string, readiness: string): AutoCorrection {
  const canonicalMode = AWARENESS_PERSUASION_MAP[readiness];
  if (!canonicalMode) {
    return { wasApplied: false, originalMode: selectedMode, correctedMode: selectedMode, correctionReason: "" };
  }
  const compatibleModes = AWARENESS_COMPATIBLE_MODES[readiness] || [canonicalMode];
  if (compatibleModes.includes(selectedMode)) {
    return { wasApplied: false, originalMode: selectedMode, correctedMode: selectedMode, correctionReason: "" };
  }
  return {
    wasApplied: true,
    originalMode: selectedMode,
    correctedMode: canonicalMode,
    correctionReason: `Mode "${selectedMode}" conflicts with "${readiness}" audience stage — auto-corrected to "${canonicalMode}" per Awareness-Persuasion Map rule`,
  };
}

function validatePersuasionRouteAgainstFunnel(
  mode: string,
  funnel: PersuasionFunnelInput,
  awareness: PersuasionAwarenessInput,
  trustBarriers: TrustBarrierClassification[],
): { valid: boolean; warnings: string[]; suggestedMode: string | null } {
  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();
  const compatibleModes = FUNNEL_PERSUASION_COMPATIBILITY[funnelType] || [];
  const funWarnings: string[] = [];
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustPath = funnel.trustPath || [];
  const proofPlacements = funnel.proofPlacements || [];
  const awarenessCompat = safeString(awareness.funnelCompatibility, "unknown");

  if (compatibleModes.length === 0) {
    if (trustPath.length > 4 && mode !== "empathy_led" && mode !== "education_led") {
      funWarnings.push(`Extended trust path (${trustPath.length} steps) — consider empathy or education-led approach`);
    }
    return { valid: true, warnings: funWarnings, suggestedMode: null };
  }

  if (!compatibleModes.includes(mode)) {
    funWarnings.push(`Persuasion mode "${mode}" is not compatible with funnel type "${funnelType}" — expected: ${compatibleModes.join(", ")}`);

    if (mode === "scarcity_led") {
      funWarnings.push("Scarcity mode rejected by funnel validation — funnel requires trust-building first");
    }

    if (trustPath.length > 3 && (mode === "proof_led" || mode === "logic_led")) {
      funWarnings.push("Long trust path detected — proof-first mode may skip required trust-building steps");
    }

    return { valid: false, warnings: funWarnings, suggestedMode: compatibleModes[0] };
  }

  if (awarenessCompat !== "unknown" && awarenessCompat !== funnelType && !awarenessCompat.includes(funnelType)) {
    funWarnings.push(`Awareness route compatibility ("${awarenessCompat}") does not match funnel type ("${funnelType}") — persuasion may face entry-to-funnel friction`);
  }

  if (proofPlacements.length > 0) {
    const earlyProofNeeded = proofPlacements.some((p: any) => {
      const stage = safeString(p?.stage || p?.placement || p, "").toLowerCase();
      return stage.includes("entry") || stage.includes("early") || stage.includes("first");
    });
    if (earlyProofNeeded && (mode === "empathy_led" || mode === "education_led" || mode === "diagnostic_led")) {
      funWarnings.push(`Funnel requires early proof placement but "${mode}" delays proof — proof-supporting content should be embedded within education sequence`);
    }
  }

  if (trustPath.length > 4 && mode !== "empathy_led" && mode !== "education_led") {
    funWarnings.push(`Extended trust path (${trustPath.length} steps) — consider empathy or education-led approach`);
  }

  if (isLowReadiness(readiness) && !(EDUCATION_FIRST_MODES as readonly string[]).includes(mode)) {
    funWarnings.push(`Low readiness (${readiness}) but mode "${mode}" is not education-first — readiness-mode alignment issue`);
  }

  const criticalBarriers = trustBarriers.filter(b => b.severity === "critical");
  if (criticalBarriers.length > 0 && mode === "proof_led") {
    funWarnings.push("Critical trust barriers detected — proof-led mode may be premature; trust-building should precede proof presentation");
  }

  if (mode === "education_proof_hybrid" && isLowReadiness(readiness)) {
    // Hybrid mode is always valid for low readiness — it's the correct strategic response
  }

  return { valid: true, warnings: funWarnings, suggestedMode: null };
}

function buildPersuasionRoutes(
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
  mi: PersuasionMIInput,
  layerResults: LayerResult[],
  trustBarriers: TrustBarrierClassification[],
  awarenessStageProperties: AwarenessStageProperty[],
  objectionProofLinks: ObjectionProofLink[],
  autoCorrection: AutoCorrection,
  structuredObjections?: StructuredObjection[],
): { primary: PersuasionRoute; alternative: PersuasionRoute; rejected: PersuasionRoute } {
  const l4 = layerResults.find(l => l.layerName === "influence_driver_selection");
  const l6 = layerResults.find(l => l.layerName === "message_order_logic");
  const l8 = layerResults.find(l => l.layerName === "persuasion_strength_scoring");

  let primaryMode = selectPersuasionMode(awareness, audience, differentiation, funnel);

  if (autoCorrection.wasApplied) {
    primaryMode = autoCorrection.correctedMode;
  }

  const funnelValidation = validatePersuasionRouteAgainstFunnel(primaryMode, funnel, awareness, trustBarriers);
  const routeWarnings: string[] = [...funnelValidation.warnings];
  if (!funnelValidation.valid && funnelValidation.suggestedMode) {
    routeWarnings.push(`Mode downgraded from "${primaryMode}" to "${funnelValidation.suggestedMode}" for funnel compatibility`);
    primaryMode = funnelValidation.suggestedMode;
  }

  if (autoCorrection.wasApplied) {
    routeWarnings.unshift(`AUTO-CORRECTION APPLIED: ${autoCorrection.correctionReason}`);
  }

  const driverFindings = (l4?.findings || []).find(f => f.startsWith("Selected influence drivers:"));
  const drivers = driverFindings
    ? driverFindings.replace("Selected influence drivers: ", "").split(", ")
    : ["authority", "proof_of_work"];

  // T005: objectionPriorities is now structured: { tag: {category, awarenessStage}, objection: {canonical, frequency, evidence} }
  // Strings remain valid for downstream backwards-compat but new shapes are emitted.
  const objections: any[] = [];

  if (structuredObjections && structuredObjections.length > 0) {
    const sorted = [...structuredObjections].sort((a, b) => b.confidence - a.confidence);
    for (const so of sorted.slice(0, 6)) {
      const cleanStatement = typeof so.objectionStatement === "string" && so.objectionStatement.trim()
        ? so.objectionStatement.trim()
        : (typeof (so as any).objection === "object" ? (so as any).objection?.canonical : String((so as any).objection || ""));
      objections.push({
        tag: {
          category: so.objectionType,
          awarenessStage: so.objectionStage,
        },
        objection: {
          canonical: cleanStatement,
          frequency: (so as any).frequency ?? null,
          evidence: Array.isArray((so as any).evidence) ? (so as any).evidence : [],
          confidence: so.confidence,
        },
        objectionId: so.objectionId,
        response: so.persuasionResponse || so.resolution || (so as any).response || "",
        resolution: so.resolution || so.persuasionResponse || "",
        requiredProof: so.requiredProofType || "",
        proofStatus: so.proofStatus || "PROOF_TO_BUILD",
      });
    }
  } else {
    const objMap = audience.objectionMap || {};
    const directKeys = Object.keys(objMap).slice(0, 5);
    for (const k of directKeys) {
      const v: any = (objMap as any)[k];
      const cleanCanonical = (v && typeof v === "object" && v.canonical) ? v.canonical : k;
      objections.push({
        tag: { category: "direct", awarenessStage: "unknown" },
        objection: {
          canonical: cleanCanonical,
          frequency: (v && typeof v === "object" && typeof v.frequency === "number") ? v.frequency : null,
          evidence: (v && typeof v === "object" && Array.isArray(v.evidence)) ? v.evidence : [],
          confidence: (v && typeof v === "object" && typeof v.confidence === "number") ? v.confidence : null,
        },
        response: (v && typeof v === "object" && (v.response || v.handling || v.resolution)) ? (v.response || v.handling || v.resolution) : "",
        resolution: (v && typeof v === "object" && (v.resolution || v.response)) ? (v.resolution || v.response) : "",
        requiredProof: (v && typeof v === "object" && (v.requiredProof || v.proofRequirement)) ? (v.requiredProof || v.proofRequirement) : "",
      });
    }

    if (objections.length === 0) {
      for (const link of objectionProofLinks.slice(0, 4)) {
        objections.push({
          tag: { category: link.objectionCategory || "inferred", awarenessStage: "unknown" },
          objection: { canonical: (link.objectionDetail || "").slice(0, 200), frequency: null, evidence: [], confidence: null },
        });
      }
    }

    if (objections.length === 0 && (offer.riskNotes || []).length > 0) {
      for (const r of (offer.riskNotes || []).slice(0, 3)) {
        objections.push({
          tag: { category: "risk", awarenessStage: "unknown" },
          objection: { canonical: r, frequency: null, evidence: [], confidence: null },
        });
      }
    }
  }

  const orderFindings = (l6?.findings || []).find(f => f.includes("message order:"));
  const messageOrder = orderFindings
    ? orderFindings.replace(/.*message order:\s*/i, "").split(" → ")
    : [...TRUST_SEQUENCE_STAGES];

  const trustPath = (funnel.trustPath || []).map((tp: any) => typeof tp === "string" ? tp : tp?.stage || tp?.name || "trust_step");
  const trustSequence = trustPath.length > 0 ? trustPath.slice(0, 6) : messageOrder.slice(0, 4);

  const strengthScore = l8?.score || 0.5;
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const isEducationFirst = isLowReadiness(readiness);
  const scarcityValidation = validateScarcityConditions(awareness, audience, differentiation, funnel, objectionProofLinks);

  const ctaBlocked = readiness === "unaware" || readiness === "problem_aware";
  const commitmentDisabled = readiness === "unaware";

  const trustReq = safeString(awareness.trustRequirement, "medium");

  const controlledPersuasion = (readiness === "unaware" || readiness === "problem_aware") ? {
    microTension: true,
    progressiveCuriosity: true,
    contrastFraming: true,
    pressureLevel: readiness === "unaware" ? "low_but_present" : "moderate_indirect",
  } : undefined;

  const pressureCalibration = (() => {
    if (readiness === "unaware") {
      return {
        level: "indirect",
        strategy: "curiosity + contrast",
        progression: "escalating_curiosity — acknowledge → disrupt → educate → mechanism → soft_next_step",
      };
    } else if (readiness === "problem_aware") {
      return {
        level: "moderate_indirect",
        strategy: "empathy + mechanism clarity",
        progression: "trust_building — acknowledge → disrupt → educate → mechanism → proof(support) → soft_next_step",
      };
    } else if (isHighReadiness(readiness)) {
      return {
        level: "direct",
        strategy: "proof + authority + commitment",
        progression: "conversion_ready — proof → authority → objections → commitment",
      };
    }
    return {
      level: "moderate",
      strategy: "contrast + proof",
      progression: "balanced — understanding → mechanism → proof → commitment",
    };
  })();

  const readinessAlignment = {
    stage: readiness,
    educationFirst: isEducationFirst,
    proofRole: readiness === "unaware" ? "support_education — assists understanding + trust building, NOT conversion-oriented" :
               readiness === "problem_aware" ? "support_understanding — reinforces problem awareness with light proof" :
               isHighReadiness(readiness) ? "primary — leads conversion" : "supporting — reinforces understanding",
    hardCtaBlocked: ctaBlocked,
    commitmentDisabled,
    blockedTactics: [
      ...(ctaBlocked ? ["hard_cta", "urgency_pressure"] : []),
      ...(commitmentDisabled ? ["commitment_injection", "early_commitment", "conversion_logic"] : []),
      ...(!scarcityValidation.allowed ? ["scarcity"] : []),
    ],
    entryMode: readiness === "unaware" ? "education_proof_hybrid" :
               readiness === "problem_aware" ? "education_first" :
               isHighReadiness(readiness) ? "proof_led" : "balanced",
    controlledPersuasion,
    pressureCalibration,
  };

  const core = differentiation.mechanismCore;
  const mechanismRef = core && core.mechanismType !== "none" && core.mechanismName
    ? ` via "${core.mechanismName}" (${core.mechanismType})`
    : "";

  const offerLockedDecisions: string[] = offer.lockedDecisions || [];
  const offerNonGenericAnchors: string[] = offer.nonGenericAnchors || [];

  let lockedRouteNameSuffix = "";
  const lockConstraintNotes: string[] = [];

  if (offerLockedDecisions.length > 0) {
    const contrastAxisDecision = offerLockedDecisions.find(d => d.startsWith("contrast_axis:"));
    const enemyDecision = offerLockedDecisions.find(d => d.startsWith("enemy:"));
    const mechanismDecision = offerLockedDecisions.find(d => d.startsWith("mechanism:"));

    if (contrastAxisDecision) {
      const axisCore = contrastAxisDecision.replace(/^contrast_axis:\s*/i, "").trim();
      if (axisCore) lockedRouteNameSuffix += ` [locked axis: ${axisCore.slice(0, 40)}]`;
    }

    for (const decision of offerLockedDecisions) {
      const core = decision.replace(/^(contrast_axis|enemy|mechanism|narrative_direction):\s*/i, "").trim();
      if (core) lockConstraintNotes.push(`LOCK CONSTRAINT — YOU MUST NOT reframe or contradict: "${core}"`);
    }

    if (enemyDecision) {
      const enemyCore = enemyDecision.replace(/^enemy:\s*/i, "").trim();
      if (enemyCore) lockConstraintNotes.push(`ENEMY ANCHOR: contrast against "${enemyCore}" — MUST be reflected in objection handling`);
    }

    if (mechanismDecision) {
      const mechCore = mechanismDecision.replace(/^mechanism:\s*/i, "").trim();
      if (mechCore) lockConstraintNotes.push(`MECHANISM ANCHOR: route MUST reflect "${mechCore}" as the solution vehicle`);
    }
  }

  if (offerNonGenericAnchors.length > 0) {
    lockConstraintNotes.push(`ANCHOR REQUIREMENT — at least one influence driver MUST echo: [${offerNonGenericAnchors.slice(0, 6).join(", ")}]`);
  }

  const lockedInfluenceDrivers = offerNonGenericAnchors.length > 0
    ? [...new Set([
        ...drivers.slice(0, 3),
        `[locked_anchor] ${offerNonGenericAnchors[0]}`,
      ])].slice(0, 4)
    : drivers.slice(0, 4);

  const primary: PersuasionRoute = {
    routeName: `${primaryMode.replace(/_/g, " ")} persuasion architecture${mechanismRef}${lockedRouteNameSuffix}`,
    persuasionMode: primaryMode,
    primaryInfluenceDrivers: lockedInfluenceDrivers,
    objectionPriorities: objections,
    trustSequence,
    messageOrderLogic: messageOrder,
    persuasionStrengthScore: strengthScore,
    frictionNotes: [...(awareness.frictionNotes || []).slice(0, 3), ...routeWarnings, ...lockConstraintNotes],
    rejectionReason: null,
    trustBarriers,
    awarenessStageProperties,
    objectionProofLinks,
    structuredObjections: structuredObjections || [],
    readinessAlignment,
    scarcityValidation,
  };

  const altModes: Record<string, string> = {
    authority_led: "proof_led",
    proof_led: "social_proof_led",
    empathy_led: "education_led",
    education_led: "empathy_led",
    education_proof_hybrid: "education_led",
    diagnostic_led: "education_led",
    contrast_led: "logic_led",
    logic_led: "proof_led",
    social_proof_led: "authority_led",
    reciprocity_led: "proof_led",
    scarcity_led: "authority_led",
  };
  let altMode = altModes[primaryMode] || "proof_led";

  const altFunnelValidation = validatePersuasionRouteAgainstFunnel(altMode, funnel, awareness, trustBarriers);
  if (!altFunnelValidation.valid && altFunnelValidation.suggestedMode && altFunnelValidation.suggestedMode !== primaryMode) {
    altMode = altFunnelValidation.suggestedMode;
  }

  const altDrivers = INFLUENCE_DRIVERS.filter(d => !drivers.includes(d)).slice(0, 3);
  if (altDrivers.length === 0) altDrivers.push("authority", "social_proof");

  const alternative: PersuasionRoute = {
    routeName: `${altMode.replace(/_/g, " ")} alternative architecture`,
    persuasionMode: altMode,
    primaryInfluenceDrivers: [...altDrivers],
    objectionPriorities: objections,
    trustSequence: [...trustSequence].reverse().slice(0, trustSequence.length),
    messageOrderLogic: [...messageOrder].slice(1).concat(messageOrder.slice(0, 1)),
    persuasionStrengthScore: clamp(strengthScore * 0.85),
    frictionNotes: [`Alternative mode may require adjusted proof sequencing`],
    rejectionReason: null,
    readinessAlignment,
    scarcityValidation,
  };

  let rejectedMode = "scarcity_led";
  const scarcityRejectionReasons: string[] = [];

  if (!scarcityValidation.allowed) {
    scarcityRejectionReasons.push(...scarcityValidation.blockedReasons);
  } else {
    scarcityRejectionReasons.push(
      "Scarcity-based persuasion rejected: requires verified supply constraints — artificial urgency damages trust architecture",
    );
  }

  if (primaryMode === "scarcity_led") {
    rejectedMode = "reciprocity_led";
    scarcityRejectionReasons.length = 0;
    scarcityRejectionReasons.push("Reciprocity-led persuasion rejected: insufficient value-exchange evidence for reciprocity framing");
  }

  const rejected: PersuasionRoute = {
    routeName: `${rejectedMode.replace(/_/g, " ")} — rejected`,
    persuasionMode: rejectedMode,
    primaryInfluenceDrivers: [rejectedMode === "scarcity_led" ? "scarcity" : "reciprocity"],
    objectionPriorities: [],
    trustSequence: [],
    messageOrderLogic: [],
    persuasionStrengthScore: 0,
    frictionNotes: [],
    rejectionReason: scarcityRejectionReasons.join("; "),
    scarcityValidation: rejectedMode === "scarcity_led" ? scarcityValidation : undefined,
  };

  return { primary, alternative, rejected };
}

function applyPositioningLockConstraints(
  layers: LayerResult[],
  lockedDecisions: string[],
  nonGenericAnchors: string[],
): LayerResult[] {
  if (lockedDecisions.length === 0 && nonGenericAnchors.length === 0) return layers;

  const l4Index = layers.findIndex(l => l.layerName === "influence_driver_selection");
  if (l4Index === -1) return layers;

  const l4 = layers[l4Index];

  const lockConstraintLines: string[] = [
    `POSITIONING LOCK ACTIVE — influence drivers MUST reflect the following locked decisions:`,
    ...lockedDecisions.map(d => `  YOU MUST NOT reframe or contradict: "${d}"`),
  ];

  if (nonGenericAnchors.length > 0) {
    lockConstraintLines.push(`ANCHOR REQUIREMENT — at least one influence driver or message step MUST echo the following positioning tokens: [${nonGenericAnchors.slice(0, 8).join(", ")}]`);
  }

  const driverFindingIdx = l4.findings.findIndex(f => f.startsWith("Selected influence drivers:"));
  const updatedFindings = [...l4.findings];

  if (driverFindingIdx !== -1) {
    updatedFindings.splice(driverFindingIdx, 0, ...lockConstraintLines);
  } else {
    updatedFindings.push(...lockConstraintLines);
  }

  const updatedL4: LayerResult = { ...l4, findings: updatedFindings };
  const result = [...layers];
  result[l4Index] = updatedL4;
  return result;
}

export function resolveTargetLaneAndSegment(
  audience: PersuasionAudienceInput | any,
  context?: { laneId?: string; laneContext?: any; strategic?: any; funnel?: any; positioning?: any }
): { targetLane: any | null; targetSegment: any | null } {
  const approvedLanes = (audience?.approvedLanes || []) as any[];
  const allSegments = (audience?.audienceSegments || audience?.segments || []) as any[];
  const painRegistry = (Array.isArray(audience?.painRegistry)
    ? audience.painRegistry
    : (audience?.painRegistry?.canonicalPains || audience?.painRegistry?.pains || [])) as any[];

  // 1. Explicit laneContext takes highest authority
  if (context?.laneContext || (audience as any)?.laneContext || (context?.strategic as any)?.laneContext) {
    const lc = context?.laneContext || (audience as any)?.laneContext || (context?.strategic as any)?.laneContext;
    const laneId = lc.laneId;
    const targetLane = lc.approvedLane || approvedLanes.find((l: any) => (l.laneId || l.id) === laneId) || {
      laneId,
      id: laneId,
      title: lc.title,
      primaryPainId: lc.primaryCorePainId,
      corePainIds: lc.corePainIds,
      segmentIds: lc.segmentIds,
    };
    let targetSegment = lc.targetSegment || null;
    if (!targetSegment && Array.isArray(lc.segmentIds) && lc.segmentIds.length > 0) {
      targetSegment = allSegments.find((s: any) => lc.segmentIds.includes(s.id)) || null;
    }
    if (!targetSegment && lc.segmentId) {
      targetSegment = allSegments.find((s: any) => s.id === lc.segmentId) || null;
    }
    if (!targetSegment && lc.primaryCorePainId) {
      const p = painRegistry.find((pr: any) => (pr.painId || pr.id) === lc.primaryCorePainId);
      if (p?.segmentId) targetSegment = allSegments.find((s: any) => s.id === p.segmentId) || null;
      if (!targetSegment && Array.isArray(p?.segmentIds)) {
        targetSegment = allSegments.find((s: any) => p.segmentIds.includes(s.id)) || null;
      }
    }
    return { targetLane, targetSegment };
  }

  // 2. Context laneId
  const explicitLaneId = context?.laneId 
    || (audience as any)?.laneId
    || (audience as any)?.currentLaneId
    || context?.funnel?.laneId 
    || context?.strategic?.laneId 
    || context?.strategic?.approvedLane?.id 
    || context?.strategic?.approvedLane?.laneId 
    || context?.positioning?.laneId;

  let targetLane: any = null;
  if (explicitLaneId) {
    targetLane = approvedLanes.find((l: any) => (l.laneId || l.id) === explicitLaneId) || null;
    if (!targetLane) {
      targetLane = { id: explicitLaneId, laneId: explicitLaneId };
    }
  }

  // 3. Identify CORE_PURCHASE pain
  const corePain = painRegistry.find((p: any) => p.classification === "CORE_PURCHASE" || p.role === "CORE_PURCHASE")
    || context?.strategic?.corePain;

  const coreSegmentIds = new Set<string>();
  if (corePain) {
    if (corePain.segmentId) coreSegmentIds.add(corePain.segmentId);
    if (Array.isArray(corePain.segmentIds)) {
      for (const sid of corePain.segmentIds) coreSegmentIds.add(sid);
    }
  }

  // If no explicit context lane was resolved, try mapping via CORE_PURCHASE pain segment
  if (!targetLane && coreSegmentIds.size > 0) {
    const matchingLanes = approvedLanes.filter((l: any) => {
      const lSegIds = Array.isArray(l.segmentIds) ? l.segmentIds : [l.segmentId || l.id].filter(Boolean);
      return lSegIds.some((sid: string) => coreSegmentIds.has(sid));
    });
    if (matchingLanes.length === 1) {
      targetLane = matchingLanes[0];
    }
  }

  // If only 1 approved lane exists in canonical strategy state
  if (!targetLane && approvedLanes.length === 1) {
    targetLane = approvedLanes[0];
  }

  // 4. Resolve target segment strictly by canonical ID authority (NO positional fallback)
  let targetSegment: any = null;
  if (Array.isArray(targetLane?.segmentIds) && targetLane.segmentIds.length > 0) {
    targetSegment = allSegments.find((s: any) => targetLane.segmentIds.includes(s.id)) || null;
  }
  if (!targetSegment && targetLane?.segmentId) {
    targetSegment = allSegments.find((s: any) => s.id === targetLane.segmentId) || null;
  }
  if (!targetSegment && coreSegmentIds.size > 0) {
    targetSegment = allSegments.find((s: any) => coreSegmentIds.has(s.id)) || null;
  }

  return { targetLane, targetSegment };
}

export async function analyzePersuasion(
  mi: PersuasionMIInput,
  audience: PersuasionAudienceInput,
  positioning: PersuasionPositioningInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
  integrity: PersuasionIntegrityInput,
  awareness: PersuasionAwarenessInput,
  upstreamLineage: SignalLineageEntry[] = [],
  analyticalEnrichment?: any,
  accountId?: string,
  // Anchor doctrine (criteria A + B + F): strategic run context + Product DNA
  // for the F5a fallback. The pre-rendered anchor block is computed ONCE and
  // threaded into the trust-transfer + cialdini sub-engines.
  strategic?: RunStrategicContext | null,
  productDna?: ProductDnaLike | null,
): Promise<PersuasionResult> {
  const startTime = Date.now();
  const structuralWarnings: string[] = [];
  const filteredAelCtx = filterAELForStrategicUse(analyticalEnrichment, audience.painRegistry, audience.approvedLanes);
  const activeAel = filteredAelCtx ? filteredAelCtx.filteredPkg : analyticalEnrichment;
  const aelAck = acknowledgeAelInput("PersuasionEngine-V3", activeAel, accountId);

  if (activeAel) {
    const aelBlock = formatAELForPrompt(activeAel);
    console.log(`[PersuasionEngine-V3] AEL_RECEIVED | enrichmentSize=${aelBlock.length}chars | dimensions=${Object.keys(activeAel).filter(k => (activeAel as any)[k] && (Array.isArray((activeAel as any)[k]) ? (activeAel as any)[k].length > 0 : true)).length}`);
  }

  const qualifyingSignals = extractQualifyingSignals(upstreamLineage);
  console.log(`[PersuasionEngine-V3] SIGNAL_CHECK | upstream=${upstreamLineage.length} | qualifying=${qualifyingSignals.length} | min=${MIN_QUALIFYING_SIGNALS}`);

  if (qualifyingSignals.length < MIN_QUALIFYING_SIGNALS) {
    console.log(`[PersuasionEngine-V3] SIGNAL_INSUFFICIENT | qualifying=${qualifyingSignals.length} < min=${MIN_QUALIFYING_SIGNALS}`);
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Signal-insufficient: only ${qualifyingSignals.length} qualifying upstream signals found (minimum ${MIN_QUALIFYING_SIGNALS} required). Upstream engines must generate source signals first.`,
      primaryRoute: emptyRoute("Signal-insufficient"),
      alternativeRoute: emptyRoute("Signal-insufficient"),
      rejectedRoute: emptyRoute("Signal-insufficient"),
      layerResults: [],
      structuralWarnings: ["SIGNAL_INSUFFICIENT: Cannot generate grounded persuasion route without upstream signals"],
      boundaryCheck: { passed: true, violations: [], sanitized: false, sanitizedText: "", warnings: [] },
      dataReliability: emptyReliability(),
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      strategyAcceptability: assessStrategyAcceptability(0, 0, 8, false, ["Signal-insufficient state"]),
    };
  }

  const allText = [
    mi.marketDiagnosis || "",
    ...(mi.opportunitySignals || []).map((s: any) => typeof s === "string" ? s : JSON.stringify(s)),
    ...(audience.audiencePains || []).map((p: any) => typeof p === "string" ? p : JSON.stringify(p)),
    ...(audience.emotionalDrivers || []).map((d: any) => typeof d === "string" ? d : JSON.stringify(d)),
    positioning.narrativeDirection || "",
    positioning.enemyDefinition || "",
    ...(differentiation.pillars || []).map((p: any) => typeof p === "string" ? p : JSON.stringify(p)),
    ...(differentiation.claimStructures || []).map((c: any) => typeof c === "string" ? c : JSON.stringify(c)),
    offer.coreOutcome || "",
    offer.mechanismDescription || "",
    ...(offer.riskNotes || []),
  ].join(" ");

  const rawBoundaryCheck = enforceBoundaryWithSanitization(allText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  const boundaryCheck = { passed: rawBoundaryCheck.clean, violations: rawBoundaryCheck.violations, sanitized: rawBoundaryCheck.sanitized, sanitizedText: rawBoundaryCheck.sanitizedText, warnings: rawBoundaryCheck.warnings };
  if (!boundaryCheck.passed) {
    const boundaryWarnings = [`BOUNDARY HARD FAIL: ${boundaryCheck.violations.join(", ")}`];
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Boundary violation: ${boundaryCheck.violations.join(", ")}`,
      primaryRoute: emptyRoute("Blocked — boundary violation"),
      alternativeRoute: emptyRoute("Blocked"),
      rejectedRoute: emptyRoute("Blocked"),
      layerResults: [],
      structuralWarnings: boundaryWarnings,
      boundaryCheck,
      dataReliability: emptyReliability(),
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      strategyAcceptability: assessStrategyAcceptability(0, 0, 8, false, boundaryWarnings),
    };
  }

  const structuredObjections = await buildReasonedStructuredObjections(
    audience,
    mi,
    positioning,
    differentiation,
    offer,
    awareness,
    strategic,
    productDna,
    analyticalEnrichment,
    accountId,
  );
  if (analyticalEnrichment && analyticalEnrichment.root_causes && analyticalEnrichment.root_causes.length > 0) {
    for (const obj of structuredObjections) attachAELGrounding(obj, analyticalEnrichment);
    const grounded = structuredObjections.filter(o => !!o.rootCause).length;
    console.log(`[PersuasionEngine-V3] AEL_GROUNDING_ATTACHED | objections=${structuredObjections.length} | grounded=${grounded} | root_causes=${analyticalEnrichment.root_causes.length} | chains=${(analyticalEnrichment.causal_chains || []).length}`);
  }

  const multiSource = safeJsonParse(mi.multiSourceSignals);
  let websiteProofCount = 0;
  if (multiSource && typeof multiSource === "object") {
    for (const compData of Object.values(multiSource as Record<string, any>)) {
      const ws = (compData as any)?.website;
      if (ws) {
        websiteProofCount += (ws.proofStructure || []).length + (ws.guarantees || []).length;
      }
    }
  }
  if (websiteProofCount > 0) {
    console.log(`[PersuasionEngine] MULTI_SOURCE | websiteProofSignals=${websiteProofCount} — enriching proof landscape`);
  }

  const reliability = assessDataReliability(mi, audience, positioning, differentiation, offer, awareness, structuredObjections);

  const { trustBarriers, awarenessStageProperties } = classifyTrustBarriers(audience, awareness, differentiation, offer, mi);
  const objectionProofLinks = buildObjectionProofLinks(audience, differentiation, offer, awareness, mi);

  const l1 = layer1_awarenessToPersuasionFit(awareness, audience, funnel);
  const l2 = layer2_objectionDetection(audience, offer, differentiation, awareness, mi, funnel, integrity);
  const l3 = layer3_trustBarrierMapping(audience, awareness, integrity, differentiation, offer, mi, trustBarriers);
  const l4 = layer4_influenceDriverSelection(audience, differentiation, awareness, trustBarriers);
  const l5 = layer5_proofPriorityMapping(differentiation, audience, awareness, objectionProofLinks);
  const l6 = layer6_messageOrderLogic(awareness, audience, offer, funnel, differentiation, trustBarriers, objectionProofLinks);
  const awarenessReadiness = safeString(awareness.targetReadinessStage, "unknown");
  const l7 = layer7_antiHypeGuard(allText, objectionProofLinks, trustBarriers, awarenessReadiness);

  const preFinalLayers = [l1, l2, l3, l4, l5, l6, l7];

  const rawSelectedMode = selectPersuasionMode(awareness, audience, differentiation, funnel);
  const readinessStage = safeString(awareness.targetReadinessStage, "unknown");
  const autoCorrection = applyAutoCorrection(rawSelectedMode, readinessStage);
  const selectedMode = autoCorrection.wasApplied ? autoCorrection.correctedMode : rawSelectedMode;

  const l8 = layer8_persuasionStrengthScoring(preFinalLayers, awareness, trustBarriers, objectionProofLinks, funnel, selectedMode);

  const allLayers = [...preFinalLayers, l8];

  for (const layer of allLayers) {
    if (!layer.passed) {
      structuralWarnings.push(`Layer "${layer.layerName}" did not pass (score: ${Math.round(layer.score * 100)}%)`);
    }
    structuralWarnings.push(...layer.warnings);
  }

  if (reliability.objectionSpecificity < 0.3) {
    structuralWarnings.push("WARNING: Objection specificity is weak — persuasion objection handling may be generic");
  }
  if (reliability.trustSpecificity < 0.4) {
    structuralWarnings.push("WARNING: Trust specificity is weak — trust barrier mapping may lack precision");
  }

  const lockedDecisions: string[] = offer.lockedDecisions || [];
  const nonGenericAnchors: string[] = offer.nonGenericAnchors || [];

  const constrainedLayers = applyPositioningLockConstraints(allLayers, lockedDecisions, nonGenericAnchors);

  const routes = buildPersuasionRoutes(audience, awareness, differentiation, offer, funnel, mi, constrainedLayers, trustBarriers, awarenessStageProperties, objectionProofLinks, autoCorrection, structuredObjections);

  const crossEngineValidation: string[] = [];
  const pReadiness = safeString(awareness.targetReadinessStage, "unknown");
  const pMode = routes.primary.persuasionMode;
  const pMsgOrder = routes.primary.messageOrderLogic;

  let positioningDriftMinSimilarity = 1;
  let positioningDriftWorstDecision = "";
  if (lockedDecisions.length > 0) {
    // Drift detection measures whether persuasion's SUBSTANTIVE content
    // (drivers, objections, trust, messaging, proof links, stage properties)
    // references the content vocabulary of each locked positioning decision.
    //
    // Why token-coverage instead of bigram cosineSimilarity:
    //   Locked decisions are long prose sentences (~40 content tokens).
    //   Persuasion output is structured keyword data. They share concepts
    //   but rarely share exact bigrams, so bigram-weighted cosine collapses
    //   to ~0.02-0.07 even when semantic alignment is strong — producing
    //   false-positive SEVERE drift.
    //
    // Why exclude frictionNotes and routeName lock suffix from the compared
    // surface: those fields inject the decision text verbatim via
    // applyPositioningLockConstraints. Including them would be circular
    // self-matching and mask genuine drift.
    const persuasionSubstantiveText = [
      routes.primary.persuasionMode || "",
      ...routes.primary.primaryInfluenceDrivers.map((d: any) => typeof d === "string" ? d : `${d.driver || ""} ${d.rationale || ""}`),
      ...routes.primary.objectionPriorities.map((o: any) => typeof o === "string" ? o : `${typeof o.objection === 'object' ? (o.objection?.canonical || "") : (o.objection || "")} ${o.response || ""} ${o.resolution || ""} ${o.requiredProof || o.proofType || ""}`),
      ...(routes.primary.messageOrderLogic || []).map((m: any) => typeof m === "string" ? m : `${m.step || ""} ${m.rationale || ""}`),
      ...(routes.primary.trustSequence || []).map((t: any) => typeof t === "string" ? t : `${t.step || ""} ${t.rationale || ""} ${t.purpose || ""}`),
      ...(routes.primary.trustBarriers || []).map((b: any) => `${b.barrierType || ""} ${b.source || ""} ${b.persuasionImplication || ""}`),
      ...(routes.primary.awarenessStageProperties || []).map((a: any) => `${a.propertyType || ""} ${a.description || ""} ${a.handlingLayer || ""}`),
      ...(routes.primary.objectionProofLinks || []).map((o: any) => typeof o === "string" ? o : `${o.objectionCategory || o.objection || ""} ${o.objectionDetail || ""} ${o.requiredProofType || o.proofType || ""} ${o.rationale || ""} ${o.rootCause || ""}`),
      ...structuredObjections.map((o: any) => `${o.objectionStatement || ""} ${o.objectionType || ""} ${o.requiredProofType || ""} ${o.persuasionResponse || ""} ${o.rootCause || ""} ${o.userThinking || ""} ${o.resolution || ""}`),
      ...(routes.primary.trustTransferDesign ? [
        routes.primary.trustTransferDesign.buyerRiskState || "",
        routes.primary.trustTransferDesign.transferMechanism || "",
        routes.primary.trustTransferDesign.trustDeficit || "",
        routes.primary.trustTransferDesign.failureModes || "",
        routes.primary.trustTransferDesign.requiredProofShape || "",
      ] : []),
      ...(routes.primary.cialdiniReasoning ? [
        routes.primary.cialdiniReasoning.primaryCialdiniPrinciple || "",
        routes.primary.cialdiniReasoning.principleRationale || "",
        routes.primary.cialdiniReasoning.buyerPsychologyFit || "",
        routes.primary.cialdiniReasoning.whyOthersFail || "",
      ] : []),
    ].join(" ");
    const persuasionTokenSet = new Set(tokenize(persuasionSubstantiveText));

    for (const decision of lockedDecisions) {
      const decisionCore = decision.replace(/^(contrast_axis|enemy|mechanism|narrative_direction):\s*/i, "").trim();
      if (!decisionCore) continue;
      const decisionTokens = tokenize(decisionCore);
      if (decisionTokens.length === 0) continue;
      const uniqueDecisionTokens = new Set(decisionTokens);
      let covered = 0;
      for (const t of uniqueDecisionTokens) {
        if (persuasionTokenSet.has(t)) covered++;
      }
      const coverage = covered / uniqueDecisionTokens.size;
      if (coverage < positioningDriftMinSimilarity) {
        positioningDriftMinSimilarity = coverage;
        positioningDriftWorstDecision = decisionCore;
      }
      if (coverage < 0.20) {
        crossEngineValidation.push(
          `POSITIONING LOCK DRIFT: Persuasion substantive output covers only ${(coverage * 100).toFixed(0)}% of content tokens from locked decision "${decisionCore}" (threshold=20%) — output may have drifted from offer engine contracts`,
        );
      }
    }
  }

  if (nonGenericAnchors.length > 0) {
    const routeText = [
      routes.primary.routeName || "",
      ...routes.primary.primaryInfluenceDrivers.map((d: any) => typeof d === "string" ? d : d.driver || ""),
    ].join(" ").toLowerCase();
    const missingAnchors = nonGenericAnchors.filter(anchor => !routeText.includes(anchor.toLowerCase()));
    if (missingAnchors.length > nonGenericAnchors.length * 0.6) {
      crossEngineValidation.push(
        `GENERIC DRIFT WARNING: Persuasion route references ${nonGenericAnchors.length - missingAnchors.length}/${nonGenericAnchors.length} positioning anchors — risk of generic output (missing: ${missingAnchors.slice(0, 5).join(", ")})`,
      );
    }
  }

  if (isLowReadiness(pReadiness)) {
    if (pMode !== "education_led" && pMode !== "empathy_led" && pMode !== "diagnostic_led" && pMode !== "education_proof_hybrid") {
      crossEngineValidation.push(`CROSS-ENGINE VIOLATION: Awareness stage "${pReadiness}" requires education-first mode but persuasion selected "${pMode}"`);
    }
    if (pMsgOrder.includes("invite_commitment")) {
      crossEngineValidation.push(`CROSS-ENGINE VIOLATION: Awareness stage "${pReadiness}" blocks hard commitment but message order includes "invite_commitment"`);
    }
    const hasConversionStep = pMsgOrder.some(s => s === "invite_commitment" || s === "hard_cta");
    if (hasConversionStep && pReadiness === "unaware") {
      crossEngineValidation.push(`STRUCTURAL CONTRADICTION: unaware audience cannot receive conversion steps — awareness authority overrides persuasion`);
    }
  }

  const funnelType = safeString(funnel.funnelType, "unknown").toLowerCase();
  if ((pReadiness === "unaware" || pReadiness === "problem_aware") &&
      (funnelType === "direct" || funnelType === "tripwire" || funnelType === "application")) {
    crossEngineValidation.push(`CROSS-ENGINE VIOLATION: Funnel type "${funnelType}" contradicts awareness stage "${pReadiness}" — funnel should not have passed awareness gate`);
  }

  const positioningDriftDetected = crossEngineValidation.some(v =>
    v.includes("POSITIONING LOCK DRIFT") || v.includes("GENERIC DRIFT WARNING")
  );

  if (positioningDriftDetected) {
    const driftPenalty = 0.20;
    routes.primary.persuasionStrengthScore = clamp(routes.primary.persuasionStrengthScore - driftPenalty);
    routes.alternative.persuasionStrengthScore = clamp(routes.alternative.persuasionStrengthScore - driftPenalty);
    console.log(`[PersuasionEngine-V3] POSITIONING_DRIFT_PENALTY | score reduced by ${driftPenalty} | drift detected in cross-engine validation`);
  }

  if (crossEngineValidation.length > 0) {
    structuralWarnings.push(...crossEngineValidation);
    console.log(`[PersuasionEngine-V3] CROSS_ENGINE_VIOLATIONS | ${crossEngineValidation.length} violations detected | stage=${pReadiness} mode=${pMode}`);
  }

  const outputText = [
    routes.primary.routeName,
    routes.primary.persuasionMode,
    ...routes.primary.primaryInfluenceDrivers,
    ...routes.primary.objectionPriorities,
    ...routes.primary.messageOrderLogic,
    ...routes.primary.trustSequence,
    ...routes.primary.frictionNotes,
    routes.alternative.routeName,
    ...routes.alternative.primaryInfluenceDrivers,
    ...routes.alternative.frictionNotes,
    routes.rejected.rejectionReason || "",
  ].join(" ");

  const rawOutputBoundaryCheck = enforceBoundaryWithSanitization(outputText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  const outputBoundaryCheck = { passed: rawOutputBoundaryCheck.clean, violations: rawOutputBoundaryCheck.violations, sanitized: rawOutputBoundaryCheck.sanitized, sanitizedText: rawOutputBoundaryCheck.sanitizedText, warnings: rawOutputBoundaryCheck.warnings };
  if (!outputBoundaryCheck.passed) {
    const outputWarnings = [`OUTPUT BOUNDARY HARD FAIL: ${outputBoundaryCheck.violations.join(", ")}`];
    const outputLayersPassed = allLayers.filter(l => l.passed).length;
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Output boundary violation: ${outputBoundaryCheck.violations.join(", ")}`,
      primaryRoute: emptyRoute("Blocked — output boundary violation"),
      alternativeRoute: emptyRoute("Blocked"),
      rejectedRoute: emptyRoute("Blocked"),
      layerResults: allLayers,
      structuralWarnings: outputWarnings,
      boundaryCheck: outputBoundaryCheck,
      dataReliability: reliability,
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      strategyAcceptability: assessStrategyAcceptability(0, outputLayersPassed, allLayers.length, false, outputWarnings),
    };
  }

  if (reliability.isWeak || reliability.overallReliability < 0.6) {
    routes.primary.persuasionStrengthScore = normalizeConfidence(routes.primary.persuasionStrengthScore, reliability);
    routes.alternative.persuasionStrengthScore = normalizeConfidence(routes.alternative.persuasionStrengthScore, reliability);
  }

  if (boundaryCheck.sanitized && boundaryCheck.warnings) {
    structuralWarnings.push(...boundaryCheck.warnings);
  }
  if (outputBoundaryCheck.sanitized && outputBoundaryCheck.warnings) {
    structuralWarnings.push(...outputBoundaryCheck.warnings);
  }

  const celSourceTexts = [
    routes.primary.routeName || "",
    routes.primary.persuasionMode || "",
    ...routes.primary.primaryInfluenceDrivers.map((d: any) => typeof d === "string" ? d : `${d.driver || ""} ${d.rationale || ""}`),
    ...routes.primary.objectionPriorities.map((o: any) => typeof o === "string" ? o : `${o.objection || ""} ${o.proofType || ""}`),
    ...routes.primary.messageOrderLogic.map((m: any) => typeof m === "string" ? m : `${m.step || ""} ${m.rationale || ""}`),
    ...(routes.primary.trustSequence || []).map((t: any) => typeof t === "string" ? t : `${t.step || ""} ${t.rationale || ""} ${t.purpose || ""}`),
    ...(routes.primary.trustBarriers || []).map((b: any) => `${b.barrierType || ""} ${b.source || ""} ${b.persuasionImplication || ""}`),
    ...(routes.primary.awarenessStageProperties || []).map((a: any) => `${a.propertyType || ""} ${a.description || ""} ${a.handlingLayer || ""}`),
    ...(routes.primary.objectionProofLinks || []).map((o: any) => typeof o === "string" ? o : `${o.objection || ""} ${o.proofType || ""} ${o.rationale || ""} ${o.rootCause || ""}`),
    ...(routes.primary.structuredObjections || []).map((o: any) => typeof o === "string" ? o : `${o.objectionStatement || o.objection || ""} ${o.rootCause || ""} ${o.userThinking || ""} ${o.resolution || ""} ${o.causalChainAlignment || ""}`),
  ];
  const celDepth = enforceEngineDepthCompliance(
    "persuasion",
    celSourceTexts,
    activeAel || null,
  );

  let depthGateResult: DepthGateResult | null = null;

  if (activeAel && isDepthBlocking(celDepth, celSourceTexts)) {
    depthGateResult = buildDepthGateResult(celDepth, 1, 1, [`Attempt 1: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length}) — non-generative engine, no retry`], celSourceTexts);
    for (const logEntry of celDepth.enforcementLog) {
      console.log(`[PersuasionEngine-V3] CEL_DEPTH: ${logEntry}`);
    }
    console.log(`[PersuasionEngine-V3] DEPTH_GATE: DEPTH_FAILED — non-generative engine, cannot retry | depthScore=${celDepth.causalDepthScore}`);
    routes.primary.persuasionStrengthScore = 0;
    routes.alternative.persuasionStrengthScore = 0;

    const failedAcceptability = assessStrategyAcceptability(0, 0, allLayers.length, false, [...structuralWarnings, "DEPTH_FAILED"]);

    return applyPartialAelDowngrade("PersuasionEngine-V3", {
      status: "DEPTH_FAILED",
      statusMessage: `Depth gate failed: depthScore=${celDepth.causalDepthScore} — non-generative engine, cannot regenerate`,
      primaryRoute: routes.primary,
      alternativeRoute: routes.alternative,
      rejectedRoute: routes.rejected,
      layerResults: allLayers,
      structuralWarnings: [...structuralWarnings, "DEPTH_FAILED"],
      boundaryCheck,
      dataReliability: reliability,
      confidenceNormalized: true,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      autoCorrection,
      strategyAcceptability: failedAcceptability,
      celDepthCompliance: celDepth,
      depthGateResult,
    }, aelAck);
  }

  if (celDepth.violations.length > 0) {
    for (const logEntry of celDepth.enforcementLog) {
      console.log(`[PersuasionEngine-V3] CEL_DEPTH: ${logEntry}`);
    }
    if (!celDepth.passed) {
      routes.primary.persuasionStrengthScore = applyDepthPenalty(routes.primary.persuasionStrengthScore, celDepth);
      routes.alternative.persuasionStrengthScore = applyDepthPenalty(routes.alternative.persuasionStrengthScore, celDepth);
    }
  } else {
    console.log(`[PersuasionEngine-V3] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
  }

  depthGateResult = buildDepthGateResult(celDepth, 1, 1, [`Attempt 1: PASSED (depthScore=${celDepth.causalDepthScore})`], celSourceTexts);

  const finalLayersPassed = allLayers.filter(l => l.passed).length;
  const finalConfidence = routes.primary.persuasionStrengthScore;
  const acceptability = assessStrategyAcceptability(
    finalConfidence, finalLayersPassed, allLayers.length,
    boundaryCheck.passed,
    structuralWarnings,
  );

  // ── MARKETING-LOGIC CORE: Trust Transfer Design (commercial reasoning) ──
  // Designs the specific commercial mechanism BEFORE any Cialdini label is picked.
  // Cialdini selection (below) becomes a downstream consequence of this design.
  let trustTransferDesignResult: import("./types").TrustTransferDesign | null = null;

  // Resolve Target Segment by ID authority (Phase 3 Persuasion Target Segment Authority)
  const painRegistry = (audience.painRegistry || []) as any[];
  const approvedLanes = (audience.approvedLanes || []) as any[];
  const allSegments = (audience.audienceSegments || audience.segments || []) as any[];

  const { targetLane, targetSegment } = resolveTargetLaneAndSegment(audience, {
    laneId: (audience as any)?.laneId || (audience as any)?.currentLaneId,
    strategic,
    funnel,
    positioning,
  });

  if (!targetSegment) {
    console.error(`[PersuasionEngine-V3] TARGET_SEGMENT_RESOLUTION_FAILED | Cannot establish canonical target segment by ID authority — failing closed`);
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: "Target segment could not be resolved from canonical ID authority or approved lanes.",
      primaryRoute: emptyRoute("Blocked — unresolved target segment"),
      alternativeRoute: emptyRoute("Blocked"),
      rejectedRoute: emptyRoute("Blocked"),
      layerResults: [],
      structuralWarnings: ["TARGET_SEGMENT_UNRESOLVED: Persuasion engine requires canonical target segment ID authority"],
      boundaryCheck: { passed: true, violations: [], sanitized: false, sanitizedText: "", warnings: [] },
      dataReliability: emptyReliability(),
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      strategyAcceptability: assessStrategyAcceptability(0, 0, 8, false, ["Unresolved target segment"]),
    };
  }

  // Filter active segments to include ONLY approved (Core & Supporting) segments
  const approvedSegmentIds = new Set<string>();
  if (targetSegment?.id) approvedSegmentIds.add(targetSegment.id);
  for (const p of painRegistry.filter((p: any) => p.classification === "CORE_PURCHASE" || p.classification === "SUPPORTING")) {
    for (const sid of (p.segmentIds || [])) approvedSegmentIds.add(sid);
    if (p.segmentId) approvedSegmentIds.add(p.segmentId);
  }
  for (const lane of approvedLanes) {
    if (lane.segmentId) approvedSegmentIds.add(lane.segmentId);
  }

  // T-184: Strict lane scoping - if running within a specific lane context, scope strictly to that lane's segmentIds
  const laneScopedSegmentIds = new Set<string>();
  if (audience.laneContext?.segmentIds && Array.isArray(audience.laneContext.segmentIds)) {
    for (const sid of audience.laneContext.segmentIds) laneScopedSegmentIds.add(sid);
  } else if (targetLane?.segmentIds && Array.isArray(targetLane.segmentIds)) {
    for (const sid of targetLane.segmentIds) laneScopedSegmentIds.add(sid);
  }

  const activeSegments = allSegments.filter((s: any) => {
    if (laneScopedSegmentIds.size > 0) return laneScopedSegmentIds.has(s.id);
    return approvedSegmentIds.has(s.id);
  });
  const effectiveSegments = activeSegments.length > 0 ? activeSegments : [targetSegment];
  const resolvedTargetSeg = effectiveSegments[0] || targetSegment;

  const sophisticationTier = resolvedTargetSeg?.sophisticationProfile?.sophisticationTier ?? null;
  const rejectedClaimPatterns: string[] = [];
  for (const seg of effectiveSegments) {
    const profile = seg?.sophisticationProfile;
    if (profile?.rejectedClaimPatterns) {
      for (const p of profile.rejectedClaimPatterns) rejectedClaimPatterns.push(p.pattern);
    }
  }

  const objectionStatements = (routes.primary.objectionPriorities || [])
    .map((o: any) => {
      if (typeof o === "string") {
        const trimmed = o.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            const parsed = JSON.parse(trimmed);
            return parsed.canonical || parsed.statement || parsed.text || trimmed;
          } catch {
            return trimmed;
          }
        }
        return trimmed;
      }
      if (o && typeof o === "object") {
        if (typeof o.objection === "object" && o.objection !== null) {
          return o.objection.canonical || o.objection.statement || "";
        }
        return o.objection || o.statement || o.canonical || "";
      }
      return "";
    })
    .filter((s: string) => s && s.length > 2);
  const trustBarrierStrings = (routes.primary.trustBarriers || [])
    .map((b: any) => `${b.barrierType || ""}: ${b.persuasionImplication || b.source || ""}`)
    .filter((s: string) => s.length > 2);
  const segmentDescriptions = effectiveSegments
    .map((s: any) => `${s.name || "?"} (pains: ${(s.painProfile || []).slice(0, 2).join("; ")})`);

  console.log(`[PersuasionEngine-V3] TARGET_SEGMENT_RESOLVED | segId=${resolvedTargetSeg?.id || "unknown"} | segName="${resolvedTargetSeg?.name || "unknown"}" | tier=${sophisticationTier ?? "unknown"} | activeApprovedSegments=${effectiveSegments.length}`);

  // Anchor doctrine (criteria A + B + F): compute the pre-rendered anchor
  // block ONCE for the persuasion sub-engines (trust-transfer designer/judge
  // + cialdini picker). F5a: when the doctrine anchor is absent, derive one
  // from Product DNA — deriveAnchorFromProductDna returns null unless
  // differentiator + problem + name + type all exist (D5).
  let psDoctrineBlock = "";
  if (strategic) {
    psDoctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[PersuasionEngine-V3] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }
  let psAnchor: ProductAnchor | null = strategic ? strategic.doctrine.productAnchor : null;
  if (!psAnchor && productDna) {
    const derivedAnchor = deriveAnchorFromProductDna(productDna);
    if (derivedAnchor) {
      psAnchor = derivedAnchor;
      console.log("[PersuasionEngine-V3] ANCHOR_FROM_DNA | doctrine anchor absent — prompt anchor derived from business context (F5a)");
    }
  }
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let psAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    psAnchorSource = "doctrine";
  } else if (psAnchor) {
    psAnchorSource = "dna";
  }
  const psDnaAnchorBlock = psAnchorSource === "dna" && psAnchor
    ? `
=== PRODUCT ANCHOR (from Product Identity — resolve every output to THIS product) ===
Product name: ${psAnchor.name}
Product type: ${psAnchor.type}${psAnchor.keyAttributes.length > 0 ? `\nKey attributes: ${psAnchor.keyAttributes.join("; ")}` : ""}
Core problem solved: ${psAnchor.coreProblemSolved}
Differentiating feature: ${psAnchor.differentiatingFeature}
`
    : "";
  const psAnchorGroundingRule = psAnchor
    ? "\nANCHOR GROUNDING: Every trust mechanism and persuasion principle MUST be specific to the anchored product above — its core problem and differentiating feature. Anchor grounding SUPPLEMENTS the existing evidence-grounding rules; it never replaces them.\n"
    : "";
  const psAnchorBlockText = `${psDoctrineBlock}${psDnaAnchorBlock}${psAnchorGroundingRule}`;
  const psGroundingContract = buildGroundingContract(psAnchor, (activeAel || (mi as any).analyticalEnrichment || null) as any, { capabilities: deriveValidatedCapabilities(psAnchor, productDna) });

  try {
    const { designTrustTransfer } = await import("./trust-transfer");
    trustTransferDesignResult = await designTrustTransfer({
      analyticalEnrichment: activeAel || (mi as any).analyticalEnrichment || null,
      objectionStatements,
      trustBarriers: trustBarrierStrings,
      audienceSegmentDescriptions: segmentDescriptions,
      sophisticationTier,
      awarenessStage: awareness.targetReadinessStage || "unknown",
      marketDiagnosis: (mi as any).marketDiagnosis || null,
      enemyDefinition: (offer as any)?.enemyDefinition || null,
      rejectedClaimPatterns,
      upstreamBuyerPsychology: null, // Phase 4 will populate this from audience.commercialSignals
      accountId: accountId || "system",
      doctrineBlock: psAnchorBlockText.length > 0 ? psAnchorBlockText : null,
      anchorSource: psAnchorSource,
      groundingContractBlock: psGroundingContract,
    });
    if (trustTransferDesignResult) {
      routes.primary.trustTransferDesign = trustTransferDesignResult;
      console.log(`[PersuasionEngine-V3] TRUST_TRANSFER_ATTACHED | mechanism="${trustTransferDesignResult.transferMechanism.name}" | risk=${trustTransferDesignResult.riskSeverity} | judge=${trustTransferDesignResult.judgeVerdict}`);
    }
  } catch (ttErr: any) {
    console.error(`[PersuasionEngine-V3] TRUST_TRANSFER_FAILED | ${ttErr.message} | falling back to legacy Cialdini-only`);
  }

  // ── INTELLIGENCE UPGRADE: Cialdini reasoning (now grounded in Trust Transfer Design when present) ──
  try {
    const { pickCialdiniPrinciple } = await import("./cialdini-llm");
    const cialdiniReasoning = await pickCialdiniPrinciple({
      analyticalEnrichment: activeAel || (mi as any).analyticalEnrichment || null,
      objectionStatements,
      trustBarriers: trustBarrierStrings,
      audienceSegmentDescriptions: segmentDescriptions,
      sophisticationTier,
      awarenessStage: awareness.targetReadinessStage || "unknown",
      marketDiagnosis: (mi as any).marketDiagnosis || null,
      enemyDefinition: (offer as any)?.enemyDefinition || null,
      trustRequirement: routes.primary.trustSequence?.[0]
        ? (typeof routes.primary.trustSequence[0] === "string" ? routes.primary.trustSequence[0] : (routes.primary.trustSequence[0] as any).step)
        : "default",
      rejectedClaimPatterns,
      accountId: accountId || "system",
      trustTransferDesign: trustTransferDesignResult || undefined,
      doctrineBlock: psAnchorBlockText.length > 0 ? psAnchorBlockText : null,
      anchorSource: psAnchorSource,
      groundingContractBlock: psGroundingContract,
    });
    if (cialdiniReasoning) {
      if (trustTransferDesignResult) {
        cialdiniReasoning.groundedInTrustMechanism = trustTransferDesignResult.transferMechanism.name;
      }
      routes.primary.cialdiniReasoning = cialdiniReasoning;
      console.log(`[PersuasionEngine-V3] CIALDINI_ATTACHED | principle=${cialdiniReasoning.primaryCialdiniPrinciple} | tier=${sophisticationTier ?? "?"} | rcRefs=${cialdiniReasoning.rootCauseRefs.join(",") || "(none)"}${cialdiniReasoning.groundedInTrustMechanism ? ` | groundedIn="${cialdiniReasoning.groundedInTrustMechanism}"` : ""}`);
    }
  } catch (cErr: any) {
    console.error(`[PersuasionEngine-V3] CIALDINI_FAILED | ${cErr.message}`);
  }

  // ── CANONICAL BELIEF SHIFT: Persuasion Engine owns coreBeliefTransformation ──
  try {
    const { designBeliefShift } = await import("./belief-shift");
    const beliefShiftResult = await designBeliefShift({
      laneTitle: targetLane?.title || (audience.laneContext as any)?.title,
      primaryPain: targetLane?.primaryPainId ? (audience.painRegistry || []).find((p: any) => p.painId === targetLane.primaryPainId)?.canonical : undefined,
      corePains: (targetLane?.corePainIds || []).map((pid: string) => (audience.painRegistry || []).find((p: any) => p.painId === pid)?.canonical).filter(Boolean),
      segmentName: resolvedTargetSeg?.name,
      segmentPains: resolvedTargetSeg?.painProfile,
      objectionStatements,
      sophisticationTier,
      awarenessStage: awareness.targetReadinessStage || "unknown",
      marketDiagnosis: (mi as any).marketDiagnosis || null,
      enemyDefinition: (offer as any)?.enemyDefinition || null,
      productTruthFacts: deriveValidatedCapabilities(psAnchor, productDna),
      doctrineBlock: psAnchorBlockText.length > 0 ? psAnchorBlockText : null,
      accountId: accountId || "system",
    });
    if (beliefShiftResult) {
      routes.primary.coreBeliefTransformation = beliefShiftResult;
      console.log(`[PersuasionEngine-V3] BELIEF_SHIFT_ATTACHED | current="${(beliefShiftResult.currentBelief || "").slice(0, 60)}" | desired="${(beliefShiftResult.desiredBelief || "").slice(0, 60)}"`);
    }
  } catch (bsErr: any) {
    console.error(`[PersuasionEngine-V3] BELIEF_SHIFT_FAILED | ${bsErr.message}`);
    structuralWarnings.push(`BELIEF_SHIFT_INCOMPLETE: Persuasion failed to produce valid canonical belief transformation (${bsErr.message})`);
  }

  let driftStatus: string = STATUS.COMPLETE;
  let driftStatusMessage: string | null = null;
  if (lockedDecisions.length > 0 && positioningDriftMinSimilarity < 0.20) {
    if (positioningDriftMinSimilarity < 0.10) {
      driftStatus = STATUS.POSITIONING_DRIFT;
      driftStatusMessage = `BLOCKED: Severe positioning drift detected (similarity=${positioningDriftMinSimilarity.toFixed(2)} < 0.10) against locked decision "${positioningDriftWorstDecision}" — persuasion output is semantically disconnected from positioning lock`;
      console.log(`[PersuasionEngine-V3] POSITIONING_DRIFT_ENFORCEMENT | severity=SEVERE | minSim=${positioningDriftMinSimilarity.toFixed(2)} | status=POSITIONING_DRIFT (BLOCK)`);
    } else {
      driftStatus = STATUS.PARTIAL;
      driftStatusMessage = `PARTIAL: Positioning drift detected (similarity=${positioningDriftMinSimilarity.toFixed(2)} < 0.20 threshold) against locked decision "${positioningDriftWorstDecision}" — persuasion output drifted from positioning lock`;
      console.log(`[PersuasionEngine-V3] POSITIONING_DRIFT_ENFORCEMENT | severity=MILD | minSim=${positioningDriftMinSimilarity.toFixed(2)} | status=PARTIAL`);
    }
  }

  const resolvedLaneId = targetLane?.laneId || targetLane?.id || (audience as any)?.laneId || (strategic as any)?.laneId;
  const resolvedFunnelSnapshotId = (funnel as any)?.snapshotId || (funnel as any)?.id || (funnel as any)?.funnelSnapshotId;
  const resolvedPrimaryCorePainId = (audience as any)?.laneContext?.primaryCorePainId || targetLane?.primaryPainId;
  const resolvedSegmentIds = (audience as any)?.laneContext?.segmentIds || (targetSegment?.id ? [targetSegment.id] : []);

  if (resolvedLaneId) {
    routes.primary.laneId = resolvedLaneId;
    routes.primary.primaryCorePainId = resolvedPrimaryCorePainId;
    routes.primary.segmentIds = resolvedSegmentIds;
    if (resolvedFunnelSnapshotId) routes.primary.funnelSnapshotId = resolvedFunnelSnapshotId;
  }

  const __persuasionResult = {
    laneId: resolvedLaneId,
    primaryCorePainId: resolvedPrimaryCorePainId,
    segmentIds: resolvedSegmentIds,
    funnelSnapshotId: resolvedFunnelSnapshotId,
    status: driftStatus,
    statusMessage: driftStatusMessage,
    primaryRoute: routes.primary,
    alternativeRoute: routes.alternative,
    rejectedRoute: routes.rejected,
    layerResults: allLayers,
    structuralWarnings,
    boundaryCheck,
    dataReliability: reliability,
    confidenceNormalized: reliability.isWeak || reliability.overallReliability < 0.6,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    autoCorrection,
    strategyAcceptability: acceptability,
    celDepthCompliance: celDepth,
    depthGateResult,
  };
  return applyPartialAelDowngrade("PersuasionEngine-V3", __persuasionResult, aelAck);
}

function emptyRoute(name: string): PersuasionRoute {
  return {
    routeName: name,
    persuasionMode: "none",
    primaryInfluenceDrivers: [],
    objectionPriorities: [],
    trustSequence: [],
    messageOrderLogic: [],
    persuasionStrengthScore: 0,
    frictionNotes: [],
    rejectionReason: null,
  };
}

function emptyReliability(): DataReliabilityDiagnostics {
  return {
    signalDensity: 0, signalDiversity: 0, narrativeStability: 0,
    competitorValidity: 0, marketMaturityConfidence: 0,
    objectionSpecificity: 0, trustSpecificity: 0,
    overallReliability: 0, isWeak: true, advisories: [],
  };
}

export async function runPersuasionEngine(
  mi: PersuasionMIInput,
  audience: PersuasionAudienceInput,
  positioning: PersuasionPositioningInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
  integrity: PersuasionIntegrityInput,
  awareness: PersuasionAwarenessInput,
  _accountId?: string,
  upstreamLineage: SignalLineageEntry[] = [],
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext | null,
  productDna?: ProductDnaLike | null,
): Promise<PersuasionResult> {
  const result = await analyzePersuasion(mi, audience, positioning, differentiation, offer, funnel, integrity, awareness, upstreamLineage, analyticalEnrichment, _accountId, strategic, productDna);
  // Authoritative pain routing (Task 163): persuasion distinguishes purchase
  // motivations (CORE_PURCHASE) from pre-purchase objections (OBJECTION) —
  // both roles preserved verbatim; POST_PURCHASE_FRICTION never carries the
  // `persuasion` use. Entry wrapper ⇒ attached on EVERY return path.
  if (Array.isArray(audience?.painRegistry) && audience.painRegistry.length > 0) {
    const persuasionEligible = selectPainsForUse(audience.painRegistry, "persuasion");
    const motivations = persuasionEligible.filter((pain) => pain.classification === "CORE_PURCHASE");
    const objections = persuasionEligible.filter((pain) => pain.classification === "OBJECTION");
    if (motivations.length > 0 || objections.length > 0) {
      console.log(`[PersuasionEngine] PERSUASION_PAINS_SELECTED | motivations=${motivations.length} | objections=${objections.length}`);
    }
    (result as any).selectedPainRoles = {
      motivations: motivations.map((pain) => ({
        painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "purchase_motivation" as const, classification: pain.classification,
      })),
      objections: objections.map((pain) => ({
        painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "pre_purchase_objection" as const, classification: pain.classification,
      })),
    };
  }
  return result;
}
