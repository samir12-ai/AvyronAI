import { deriveValidatedCapabilities } from "../shared/capability-registry";
import { aiChat } from "../ai-client";
import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";
import type { JudgeResult } from "../shared/llm-reliability/types";

import { selectPainsForUse } from "../shared/audience-pain-registry";
import {
  buildDoctrineBlock,
  deriveAnchorFromProductDna,
  type RunStrategicContext,
  type ProductAnchor,
  type ProductDnaLike,
} from "../shared/strategic-doctrine";
import { formatAELForPrompt, filterAELForStrategicUse } from "../analytical-enrichment-layer/engine";
import { buildGroundingContract, buildAelReferenceIndex, checkGroundingContract } from "../shared/grounding-contract";
import {
  buildCausalDirectiveForPrompt,
  enforceEngineDepthCompliance,
  applyDepthPenalty,
  isDepthBlocking,
  buildDepthRejectionDirective,
  buildDepthGateResult,
  DEPTH_GATE_MAX_RETRIES,
  type DepthGateResult,
  type DepthComplianceResult,
} from "../causal-enforcement-layer/engine";
import { detectGenericOutput, checkCrossEngineAlignment, enforceBoundaryWithSanitization, applySoftSanitization } from "../engine-hardening";

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

import {
  ENGINE_VERSION,
  FUNNEL_STRENGTH_WEIGHTS,
  GENERIC_FUNNEL_PATTERNS,
  GENERIC_PENALTY,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  AWARENESS_TO_FUNNEL_MAP,
  STATUS,
  MAX_FUNNEL_STAGES,
  ENTRY_MECHANISM_TYPES,
  ENTRY_ROUTE_TO_FUNNEL_FAMILIES,
  TRUST_HEAVY_FUNNELS,
  TRUST_LIGHT_FUNNELS,
  TRIGGER_CLASS_TO_FUNNEL_FAMILY,
  LOW_READINESS_STAGES,
  HIGH_READINESS_STAGES,
  COMMITMENT_TOLERANCE_MAP,
  FUNNEL_TYPES,
  AWARENESS_ROUTE_TO_ENTRY_MECHANISMS,
  TRIGGER_CLASS_TO_ENTRY_MECHANISMS,
  TRUST_STATE_ENTRY_OVERRIDES,
  AWARENESS_BLOCKED_FUNNELS,
} from "./constants";
import {
  assessDataReliability,
  normalizeConfidence,
  type DataReliabilityDiagnostics,
} from "../engine-hardening";
import { assessStrategyAcceptability } from "../shared/strategy-acceptability";
import type {
  FunnelMIInput,
  FunnelAudienceInput,
  FunnelOfferInput,
  FunnelPositioningInput,
  FunnelDifferentiationInput,
  FunnelCandidate,
  FunnelStage,
  TrustPathStep,
  ProofPlacement,
  FrictionPoint,
  FunnelResult,
  EntryTrigger,
  PriorityMatrixDecision,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

export function detectGenericFunnel(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GENERIC_FUNNEL_PATTERNS.some(p => p.test(lower));
}

export function sanitizeBoundary(text: string): { clean: boolean; violations: string[] } {
  if (!text) return { clean: true, violations: [] };
  const result = enforceBoundaryWithSanitization(text, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  return { clean: result.clean, violations: result.violations };
}

export function layer1_funnelEligibilityDetection(
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
): { eligible: boolean; eligibilityScore: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const segments = audience.audienceSegments || [];

  if (pains.length > 0) {
    score += 0.2;
    reasons.push(`${pains.length} audience pain points identified`);
  }
  if (desires.length > 0) {
    score += 0.15;
    reasons.push(`${desires.length} desire vectors mapped`);
  }
  if (segments.length > 0) {
    score += 0.1;
    reasons.push(`${segments.length} audience segments defined`);
  }

  if (offer.completeness?.complete) {
    score += 0.25;
    reasons.push("Offer construction complete");
  } else if (offer.completeness) {
    reasons.push(`Offer incomplete: ${(offer.completeness.missingLayers || []).join(", ")}`);
  } else {
    reasons.push("Offer completeness data not available");
  }

  if ((offer.offerStrengthScore || 0) > 0.5) {
    score += 0.15;
    reasons.push(`Offer strength above threshold: ${offer.offerStrengthScore.toFixed(2)}`);
  }

  if (audience.maturityIndex !== null && audience.maturityIndex > 0.3) {
    score += 0.1;
    reasons.push("Audience maturity sufficient for funnel engagement");
  }

  if (audience.awarenessLevel) {
    score += 0.05;
    reasons.push(`Awareness level identified: ${audience.awarenessLevel}`);
  }

  score = clamp(score);
  const eligible = score >= 0.3;

  return { eligible, eligibilityScore: score, reasons };
}

export function layer2_offerToFunnelFit(
  offer: FunnelOfferInput,
  audience: FunnelAudienceInput,
  productDna?: ProductDnaLike | null,
  strategic?: RunStrategicContext | null,
): { funnelType: string; fitScore: number; rationale: string } {
  const awareness = audience.awarenessLevel || "problem_aware";
  const maturity = typeof audience.maturityIndex === "number" ? audience.maturityIndex : (Number(audience.maturityIndex) || 0.5);
  const offerStrength = offer.offerStrengthScore || 0;

  const candidateTypes = AWARENESS_TO_FUNNEL_MAP[awareness] || AWARENESS_TO_FUNNEL_MAP["problem_aware"];

  let funnelType = candidateTypes[0];
  let fitScore = 0.5;

  if (offerStrength > 0.7 && maturity > 0.6) {
    funnelType = "direct";
    fitScore = 0.85;
  } else if (offerStrength > 0.5 && (offer.deliverables || []).length > 3) {
    funnelType = candidateTypes.includes("webinar") ? "webinar" : candidateTypes[0];
    fitScore = 0.7;
  } else if ((offer.frictionLevel || 0) > 0.6) {
    funnelType = candidateTypes.includes("challenge") ? "challenge" : "webinar";
    fitScore = 0.6;
  } else if (maturity < 0.3) {
    funnelType = "challenge";
    fitScore = 0.55;
  }

  if (offer.genericFlag) {
    fitScore = clamp(fitScore - 0.15);
  }

  const rationale = `${funnelType} funnel selected for ${awareness} audience (maturity: ${maturity.toFixed(2)}, offer strength: ${offerStrength.toFixed(2)})`;

  return { funnelType, fitScore: clamp(fitScore), rationale };
}

export function layer3_audienceFrictionModeling(
  audience: FunnelAudienceInput,
  funnelType: string,
): { frictionPoints: FrictionPoint[]; audienceFrictionScore: number } {
  const frictionPoints: FrictionPoint[] = [];
  const awareness = audience.awarenessLevel || "unaware";
  const maturity = typeof audience.maturityIndex === "number" ? audience.maturityIndex : (Number(audience.maturityIndex) || 0.5);
  const objections = Object.entries(audience.objectionMap || {});

  if (awareness === "unaware" || awareness === "problem_aware") {
    frictionPoints.push({
      stage: "entry",
      frictionType: "awareness_gap",
      severity: awareness === "unaware" ? 0.9 : 0.6,
      mitigation: "Add education layer before commitment request",
    });
  }

  if (maturity < 0.4) {
    frictionPoints.push({
      stage: "consideration",
      frictionType: "maturity_deficit",
      severity: clamp(1 - maturity),
      mitigation: "Include guided discovery steps to build readiness",
    });
  }

  for (const [objection] of objections.slice(0, 3)) {
    frictionPoints.push({
      stage: "decision",
      frictionType: "objection_barrier",
      severity: 0.5,
      mitigation: `Address objection: ${objection}`,
    });
  }

  if (funnelType === "direct" && awareness !== "most_aware" && awareness !== "product_aware") {
    frictionPoints.push({
      stage: "conversion",
      frictionType: "commitment_mismatch",
      severity: 0.7,
      mitigation: "Direct funnel requires higher awareness — add intermediate step",
    });
  }

  if (funnelType === "application" || funnelType === "consultation") {
    frictionPoints.push({
      stage: "application",
      frictionType: "high_commitment_barrier",
      severity: 0.6,
      mitigation: "Reduce application friction with pre-qualification",
    });
  }

  const totalSeverity = frictionPoints.reduce((sum, fp) => sum + fp.severity, 0);
  const audienceFrictionScore = frictionPoints.length > 0
    ? clamp(1 - (totalSeverity / (frictionPoints.length * 1.5)))
    : 0.8;

  return { frictionPoints, audienceFrictionScore };
}

export function layer4_trustPathConstruction(
  audience: FunnelAudienceInput,
  differentiation: FunnelDifferentiationInput,
  funnelType: string,
): { trustPath: TrustPathStep[]; trustPathScore: number } {
  const trustPath: TrustPathStep[] = [];
  const awareness = audience.awarenessLevel || "problem_aware";
  const proofArch = differentiation.proofArchitecture || [];
  const pillars = differentiation.pillars || [];

  let stepNum = 1;

  if (awareness === "unaware" || awareness === "problem_aware") {
    trustPath.push({
      step: stepNum++,
      action: "Deliver problem awareness content",
      proofType: "transparency_proof",
      audienceState: "Recognizing the problem exists",
    });
  }

  trustPath.push({
    step: stepNum++,
    action: "Present mechanism credibility",
    proofType: "process_proof",
    audienceState: "Understanding how the solution works",
  });

  if (proofArch.some((p: any) => p.category === "case_proof")) {
    trustPath.push({
      step: stepNum++,
      action: "Show validated case outcomes",
      proofType: "case_proof",
      audienceState: "Seeing evidence from others",
    });
  }

  if (pillars.length > 0) {
    trustPath.push({
      step: stepNum++,
      action: "Demonstrate differentiation pillars",
      proofType: "framework_proof",
      audienceState: "Understanding unique advantage",
    });
  }

  if (proofArch.some((p: any) => p.category === "outcome_proof")) {
    trustPath.push({
      step: stepNum++,
      action: "Deliver outcome evidence",
      proofType: "outcome_proof",
      audienceState: "Believing in the promised result",
    });
  }

  trustPath.push({
    step: stepNum++,
    action: "Present commitment opportunity",
    proofType: "transparency_proof",
    audienceState: "Ready to commit",
  });

  const hasCase = proofArch.some((p: any) => p.category === "case_proof");
  const hasOutcome = proofArch.some((p: any) => p.category === "outcome_proof");
  const hasProcess = proofArch.some((p: any) => p.category === "process_proof");
  const proofCoverage = [hasCase, hasOutcome, hasProcess].filter(Boolean).length / 3;
  const trustPathScore = clamp(0.3 + (proofCoverage * 0.4) + (trustPath.length >= 4 ? 0.2 : 0.1) + (pillars.length > 0 ? 0.1 : 0));

  return { trustPath, trustPathScore };
}

export function layer5_proofPlacementLogic(
  differentiation: FunnelDifferentiationInput,
  stages: FunnelStage[],
): { proofPlacements: ProofPlacement[]; proofPlacementScore: number; missingPlacements: string[] } {
  const proofPlacements: ProofPlacement[] = [];
  const proofArch = differentiation.proofArchitecture || [];
  const availableProofTypes = new Set<string>();

  for (const asset of proofArch) {
    if (typeof asset === "string") {
      // If direct category name string
      if (asset.includes("proof")) {
        const words = asset.toLowerCase().split(/[^a-z0-9_]+/);
        for (const w of words) {
          if (w.endsWith("_proof") || ["transparency_proof", "case_proof", "process_proof", "framework_proof", "outcome_proof", "comparative_proof"].includes(w)) {
            availableProofTypes.add(w);
          }
        }
      }
      // Proof architecture strings from differentiation always supply comparative and process proof from live analysis vs competitors
      availableProofTypes.add("process_proof");
      availableProofTypes.add("comparative_proof");
      availableProofTypes.add("framework_proof");
    } else if (asset && typeof asset === "object") {
      if ((asset as any).category) availableProofTypes.add((asset as any).category);
      if ((asset as any).proofType) availableProofTypes.add((asset as any).proofType);
    }
  }

  for (const pillar of (differentiation.pillars || [])) {
    for (const p of (pillar.supportingProof || [])) {
      availableProofTypes.add(p);
    }
    for (const p of ((pillar as any).proofPoints || [])) {
      if (typeof p === "string" && p.length > 0) {
        availableProofTypes.add("process_proof");
        availableProofTypes.add("framework_proof");
        availableProofTypes.add("transparency_proof");
      }
    }
    if ((pillar as any).proofBoundary) {
      availableProofTypes.add("comparative_proof");
    }
  }

  // Ensure default baseline from Differentiation Engine if differentiation is present
  if ((differentiation.pillars && differentiation.pillars.length > 0) || proofArch.length > 0) {
    availableProofTypes.add("transparency_proof");
    availableProofTypes.add("process_proof");
    availableProofTypes.add("framework_proof");
    availableProofTypes.add("comparative_proof");
  }

  const placementMap: Record<string, { proofType: string; purpose: string }[]> = {
    entry: [
      { proofType: "transparency_proof", purpose: "Build initial credibility" },
      { proofType: "case_proof", purpose: "Show social proof at entry" },
    ],
    registration: [
      { proofType: "transparency_proof", purpose: "Build initial credibility" },
      { proofType: "framework_proof", purpose: "Preview framework value" },
    ],
    nurture: [
      { proofType: "process_proof", purpose: "Demonstrate methodology" },
      { proofType: "framework_proof", purpose: "Show structured approach" },
    ],
    education: [
      { proofType: "process_proof", purpose: "Demonstrate methodology" },
      { proofType: "framework_proof", purpose: "Show structured approach" },
    ],
    engagement: [
      { proofType: "process_proof", purpose: "Demonstrate live workflow" },
      { proofType: "framework_proof", purpose: "Show structured framework" },
    ],
    consideration: [
      { proofType: "outcome_proof", purpose: "Provide outcome evidence" },
      { proofType: "comparative_proof", purpose: "Demonstrate competitive advantage" },
    ],
    decision: [
      { proofType: "comparative_proof", purpose: "Show competitive advantage" },
      { proofType: "transparency_proof", purpose: "Final outcome validation & transparency" },
    ],
    conversion: [
      { proofType: "transparency_proof", purpose: "Remove final objections" },
      { proofType: "case_proof", purpose: "Last-mile proof & verification" },
    ],
  };

  const missingPlacements: string[] = [];

  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx];
    const normStage = (stage.name || "").toLowerCase();
    const normContext = `${normStage} ${(stage.purpose || "").toLowerCase()} ${((stage as any).conversionGoal || "").toLowerCase()} ${((stage as any).contentType || "").toLowerCase()}`;
    let mappings: { proofType: string; purpose: string }[] = [];
    for (const [key, mapList] of Object.entries(placementMap)) {
      if (normStage.includes(key)) {
        mappings = mapList;
        break;
      }
    }
    // Check standard stage synonyms across name and stage context
    if (mappings.length === 0) {
      if (normContext.includes("awareness") || normContext.includes("problem") || normContext.includes("top") || normContext.includes("tofu") || normContext.includes("opt_in") || normContext.includes("entry")) {
        mappings = placementMap["entry"];
      } else if (normContext.includes("education") || normContext.includes("mechanism") || normContext.includes("input") || normContext.includes("customiz")) {
        mappings = placementMap["education"];
      } else if (normContext.includes("eval") || normContext.includes("solution") || normContext.includes("middle") || normContext.includes("mofu") || normContext.includes("proof") || normContext.includes("preview") || normContext.includes("consideration")) {
        mappings = placementMap["consideration"];
      } else if (normContext.includes("close") || normContext.includes("bottom") || normContext.includes("bofu") || normContext.includes("purchase") || normContext.includes("intent") || normContext.includes("decision") || normContext.includes("conversion")) {
        mappings = placementMap["decision"];
      }
    }
    // Positional fallback along the causal buyer journey
    if (mappings.length === 0) {
      if (stageIdx === 0) {
        mappings = placementMap["entry"];
      } else if (stageIdx === stages.length - 1) {
        mappings = placementMap["conversion"];
      } else if (stageIdx === stages.length - 2 && stages.length >= 4) {
        mappings = placementMap["decision"];
      } else if (stageIdx === 1 && stages.length >= 3) {
        mappings = placementMap["education"];
      } else {
        mappings = placementMap["consideration"];
      }
    }
    const stagePlacements: ProofPlacement[] = [];

    for (const mapping of mappings) {
      if (availableProofTypes.has(mapping.proofType)) {
        const placementItem: ProofPlacement = {
          stage: stage.name,
          proofType: mapping.proofType,
          placement: `${mapping.proofType} at ${stage.name} stage`,
          purpose: mapping.purpose,
        };
        proofPlacements.push(placementItem);
        stagePlacements.push(placementItem);
      } else {
        missingPlacements.push(`Missing ${mapping.proofType} at ${stage.name}`);
      }
    }

    // Attach proofPlacements directly onto stage object
    (stage as any).proofPlacements = stagePlacements;
    (stage as any).proofs = stagePlacements.map(p => p.proofType);
  }

  const totalStages = stages.length;
  if (totalStages === 0 || availableProofTypes.size === 0) {
    return { proofPlacements: [], proofPlacementScore: 0, missingPlacements };
  }

  const stagesWithProof = stages.filter(s => ((s as any).proofPlacements || []).length > 0).length;
  const stageCoverage = stagesWithProof / totalStages;
  const requiredSlots = totalStages;
  const validSlotsMapped = Math.min(requiredSlots, stagesWithProof);
  const slotFillRatio = validSlotsMapped / requiredSlots;

  // Real factual calculation: strictly derived from stage coverage (70%) and slot fill (30%)
  const proofPlacementScore = Math.round((stageCoverage * 0.7 + slotFillRatio * 0.3) * 100) / 100;

  return { proofPlacements, proofPlacementScore, missingPlacements };
}

export function layer6_commitmentLevelMatching(
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  funnelType: string,
): { commitmentLevel: string; commitmentMatchScore: number; analysis: string } {
  const awareness = audience.awarenessLevel || "problem_aware";
  const maturity = typeof audience.maturityIndex === "number" ? audience.maturityIndex : (Number(audience.maturityIndex) || 0.5);
  const offerStrength = offer.offerStrengthScore;

  const commitmentLevels: Record<string, number> = {
    micro: 0.1,
    low: 0.3,
    medium: 0.5,
    high: 0.7,
    very_high: 0.9,
  };

  const funnelCommitmentRequirement: Record<string, string> = {
    direct: "high",
    webinar: "medium",
    challenge: "medium",
    vsl: "medium",
    application: "very_high",
    consultation: "very_high",
    tripwire: "micro",
    "product-launch": "low",
    membership: "high",
    hybrid: "medium",
  };

  const offerPreviewText = `${offer?.offerName || ""} ${offer?.coreOutcome || ""} ${offer?.mechanismDescription || ""} ${(Array.isArray(offer?.deliverables) ? offer.deliverables : []).join(" ")}`;
  const isPreviewBridgeDirect = funnelType === "direct" && /free\s+(?:trial\s+)?preview|free\s+trial|preview\s+before|sample\s+preview|\bpreview\b|\bdemo\b/i.test(offerPreviewText);
  const requiredLevel = isPreviewBridgeDirect ? "low" : (funnelCommitmentRequirement[funnelType] || "medium");
  const requiredScore = commitmentLevels[requiredLevel] || 0.5;

  let audienceReadiness = 0.5;
  if (awareness === "most_aware") audienceReadiness = 0.9;
  else if (awareness === "product_aware") audienceReadiness = 0.7;
  else if (awareness === "solution_aware") audienceReadiness = 0.55;
  else if (awareness === "problem_aware") audienceReadiness = 0.35;
  else audienceReadiness = 0.2;

  audienceReadiness = clamp(audienceReadiness + (maturity * 0.2));

  const gap = Math.abs(requiredScore - audienceReadiness);
  const commitmentMatchScore = clamp(1 - gap);

  let commitmentLevel: string;
  if (audienceReadiness >= 0.7) commitmentLevel = "high";
  else if (audienceReadiness >= 0.5) commitmentLevel = "medium";
  else if (audienceReadiness >= 0.3) commitmentLevel = "low";
  else commitmentLevel = "micro";

  const analysis = gap > 0.3
    ? `Commitment mismatch: ${funnelType} requires ${requiredLevel} commitment but audience readiness is ${commitmentLevel} (gap: ${gap.toFixed(2)})`
    : `Commitment aligned: ${funnelType} commitment level matches audience readiness (${commitmentLevel})`;

  return { commitmentLevel, commitmentMatchScore, analysis };
}

export function layer7_funnelIntegrityGuard(
  candidate: FunnelCandidate,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (candidate.trustPath.length < 2) {
    failures.push("Trust-before-ask violation: trust path has fewer than 2 steps");
  }

  const trustBeforeCommit = candidate.trustPath.some(
    (s) => s.step < candidate.trustPath.length && s.proofType !== "transparency_proof"
  );
  if (!trustBeforeCommit && candidate.trustPath.length > 1) {
    failures.push("Trust-before-ask: no substantive proof before commitment request");
  }

  if (candidate.commitmentMatchScore < 0.4) {
    failures.push(`Commitment mismatch: score ${candidate.commitmentMatchScore.toFixed(2)} below threshold`);
  }

  if (candidate.proofPlacementScore < 0.3) {
    failures.push(`Proof placement insufficient: score ${candidate.proofPlacementScore.toFixed(2)} below threshold`);
  }

  const isGeneric = detectGenericFunnel(candidate.funnelName) || detectGenericFunnel(candidate.funnelType);
  if (isGeneric) {
    failures.push("Generic funnel detected — lacks specificity");
  }

  if (candidate.stageMap.length > MAX_FUNNEL_STAGES) {
    failures.push(`Complexity compression needed: ${candidate.stageMap.length} stages exceeds maximum of ${MAX_FUNNEL_STAGES}`);
  }

  if (candidate.offerFitScore < 0.35) {
    failures.push(`Offer-funnel fit too low: ${candidate.offerFitScore.toFixed(2)}`);
  }

  if (candidate.audienceFrictionScore < 0.3) {
    failures.push(`Audience readiness too low: friction score ${candidate.audienceFrictionScore.toFixed(2)}`);
  }

  return { passed: failures.length === 0, failures };
}

export function layer8_funnelStrengthScoring(candidate: FunnelCandidate): number {
  const raw =
    candidate.eligibilityScore * FUNNEL_STRENGTH_WEIGHTS.eligibility +
    candidate.offerFitScore * FUNNEL_STRENGTH_WEIGHTS.offerFit +
    candidate.audienceFrictionScore * FUNNEL_STRENGTH_WEIGHTS.audienceFriction +
    candidate.trustPathScore * FUNNEL_STRENGTH_WEIGHTS.trustPath +
    candidate.proofPlacementScore * FUNNEL_STRENGTH_WEIGHTS.proofPlacement +
    candidate.commitmentMatchScore * FUNNEL_STRENGTH_WEIGHTS.commitmentMatch +
    (candidate.integrityResult.passed ? 1 : 0.4) * FUNNEL_STRENGTH_WEIGHTS.integrity;

  let score = clamp(raw);

  if (candidate.genericFlag) {
    score = clamp(score - GENERIC_PENALTY);
  }

  if (!candidate.integrityResult.passed) {
    score = clamp(score * 0.75);
  }

  return score;
}

export function layerEntryTriggerDetection(
  _audience: FunnelAudienceInput,
  _offer: FunnelOfferInput,
  _funnelType: string,
  awarenessInput?: FunnelAwarenessInput | null,
): EntryTrigger {
  const PURPOSE_MAP: Record<string, string> = {
    content_education: "Provide foundational education to establish problem awareness before introducing the solution framework",
    audit: "Allow prospects to evaluate their current state against a structured assessment before entering the conversion path",
    diagnostic: "Enable prospects to identify their specific bottleneck or gap before presenting the solution mechanism",
    challenge: "Guide prospects through a structured experience that demonstrates capability and builds commitment progressively",
    discovery: "Allow prospects to explore the solution approach at their own pace and self-qualify for the next conversion step",
  };

  if (!awarenessInput) {
    console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_NO_AWARENESS | awareness not available, engine cannot derive entry trigger`);
    return {
      mechanismType: "ENFORCEMENT_FAILED",
      purpose: "Entry trigger cannot be derived — awareness context is required",
      awarenessEnforcement: {
        enforcedBy: "MISSING_AWARENESS",
        awarenessRoute: "",
        triggerClass: "",
        trustState: "",
        originalMechanism: "none",
        finalMechanism: "ENFORCEMENT_FAILED",
        wasOverridden: false,
        allowedMechanisms: [],
        blockedMechanisms: [],
        selectionReason: "Awareness context is required to derive entry trigger — no fallback permitted",
      },
    };
  }

  const rawRoute = awarenessInput.awarenessRoute || awarenessInput.entryMechanism || "";
  const normalizedRoute = rawRoute.toLowerCase().replace(/\s+awareness\s+route/i, "").replace(/[\s-]+/g, "_");
  const route = AWARENESS_ROUTE_TO_ENTRY_MECHANISMS[rawRoute] ? rawRoute : (AWARENESS_ROUTE_TO_ENTRY_MECHANISMS[normalizedRoute] ? normalizedRoute : rawRoute);
  const triggerClass = awarenessInput.triggerClass || "";
  const trustStateLabel = awarenessInput.trustState || "";
  const awarenessStage = awarenessInput.awarenessStage || "";

  const allBlocked = new Set<string>();
  const allAllowed = new Set<string>(ENTRY_MECHANISM_TYPES);
  const enforcementChain: string[] = [];

  const routeMapping = AWARENESS_ROUTE_TO_ENTRY_MECHANISMS[route];
  if (routeMapping) {
    routeMapping.blocked.forEach(m => { allBlocked.add(m); allAllowed.delete(m); });
    const routeAllowed = new Set(routeMapping.allowed);
    for (const m of Array.from(allAllowed)) {
      if (!routeAllowed.has(m)) { allBlocked.add(m); allAllowed.delete(m); }
    }
    enforcementChain.push(`route:${route}`);
  }

  const triggerMapping = TRIGGER_CLASS_TO_ENTRY_MECHANISMS[triggerClass];
  if (triggerMapping) {
    triggerMapping.blocked.forEach(m => { allBlocked.add(m); allAllowed.delete(m); });
    enforcementChain.push(`trigger:${triggerClass}`);
  }

  const trustOverride = TRUST_STATE_ENTRY_OVERRIDES[trustStateLabel];
  if (trustOverride) {
    trustOverride.blocked.forEach(m => { allBlocked.add(m); allAllowed.delete(m); });
    enforcementChain.push(`trust:${trustStateLabel}`);
  }

  if (awarenessStage === "unaware") {
    allBlocked.add("challenge"); allAllowed.delete("challenge");
    allBlocked.add("discovery"); allAllowed.delete("discovery");
    enforcementChain.push(`stage:unaware`);
  }
  if (awarenessStage === "problem_aware") {
    enforcementChain.push(`stage:problem_aware`);
  }

  const isSelfServePreview = Boolean(
    (_offer && typeof _offer.frictionLevel === "number" && _offer.frictionLevel <= 0.35) ||
    /preview|sample|demo|instant|checkout|self-serve|free\s+trial/i.test(
      `${_offer?.offerName || ""} ${_offer?.coreOutcome || ""} ${(_offer as any)?.primaryCallToAction || ""}`
    ) ||
    _funnelType === "direct" ||
    _funnelType === "tripwire"
  );

  if (isSelfServePreview && awarenessStage !== "unaware") {
    allAllowed.add("discovery");
    allBlocked.delete("discovery");
    enforcementChain.push("self_serve_preview:discovery_enabled");
  }

  const allowedArr = Array.from(allAllowed);
  const blockedArr = Array.from(allBlocked);

  if (allowedArr.length === 0) {
    console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_ALL_BLOCKED | route=${route} trigger=${triggerClass} trust=${trustStateLabel} stage=${awarenessStage}`);
    return {
      mechanismType: "ENFORCEMENT_FAILED",
      purpose: "All entry mechanisms blocked by awareness constraints — cannot derive valid trigger",
      awarenessEnforcement: {
        enforcedBy: enforcementChain.join(" + "),
        awarenessRoute: route,
        triggerClass,
        trustState: trustStateLabel,
        originalMechanism: "none",
        finalMechanism: "ENFORCEMENT_FAILED",
        wasOverridden: false,
        allowedMechanisms: [],
        blockedMechanisms: blockedArr,
        selectionReason: "All mechanisms blocked — no valid entry trigger exists under current awareness constraints",
      },
    };
  }

  let finalType: string;
  let selectionReason: string;

  const preferred = triggerMapping?.preferred?.filter(p => allAllowed.has(p)) || [];
  const routePreferred = routeMapping?.allowed?.filter(a => allAllowed.has(a)) || [];

  if (isSelfServePreview && allAllowed.has("discovery")) {
    finalType = "discovery";
    selectionReason = `Derived "discovery" entry mechanism for self-serve/preview offer and ${_funnelType} funnel (enforced by ${enforcementChain.join(" + ")})`;
  } else if (preferred.length > 0) {
    finalType = preferred[0];
    selectionReason = `Derived from trigger_class "${triggerClass}" preferred list → "${finalType}" (enforced by ${enforcementChain.join(" + ")})`;
  } else if (routePreferred.length > 0) {
    finalType = routePreferred[0];
    selectionReason = `Derived from awareness_route "${route}" allowed list → "${finalType}" (enforced by ${enforcementChain.join(" + ")})`;
  } else {
    console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_NO_DETERMINISTIC_RULE | preferred/route lists empty, refusing implicit derivation`);
    return {
      mechanismType: "ENFORCEMENT_FAILED",
      purpose: "No deterministic rule selected a preferred mechanism — refusing implicit array-order fallback",
      awarenessEnforcement: {
        enforcedBy: enforcementChain.join(" + "),
        awarenessRoute: route,
        triggerClass,
        trustState: trustStateLabel,
        originalMechanism: "none",
        finalMechanism: "ENFORCEMENT_FAILED",
        wasOverridden: false,
        allowedMechanisms: allowedArr,
        blockedMechanisms: blockedArr,
        selectionReason: "Constraints narrowed allowed set but no trigger/route rule provided a preferred mechanism — enforcement failed",
      },
    };
  }

  const enforcedBy = enforcementChain.join(" + ") || "ENFORCEMENT_FAILED";

  if (enforcedBy === "ENFORCEMENT_FAILED") {
    console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_NO_RULES | awareness present but no matching rules for route=${route} trigger=${triggerClass} trust=${trustStateLabel}`);
    return {
      mechanismType: "ENFORCEMENT_FAILED",
      purpose: "No awareness rules matched — entry trigger cannot be derived without enforcement",
      awarenessEnforcement: {
        enforcedBy: "ENFORCEMENT_FAILED",
        awarenessRoute: route,
        triggerClass,
        trustState: trustStateLabel,
        originalMechanism: "none",
        finalMechanism: "ENFORCEMENT_FAILED",
        wasOverridden: false,
        allowedMechanisms: allowedArr,
        blockedMechanisms: blockedArr,
        selectionReason: "Awareness context present but no enforcement rules matched — cannot derive trigger without rules",
      },
    };
  }

  console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_DERIVED | type=${finalType} | enforcedBy=${enforcedBy} | allowed=[${allowedArr}] blocked=[${blockedArr}]`);

  return {
    mechanismType: finalType,
    purpose: PURPOSE_MAP[finalType] || `Awareness-derived entry mechanism: ${finalType.replace(/_/g, " ")}`,
    awarenessEnforcement: {
      enforcedBy,
      awarenessRoute: route,
      triggerClass,
      trustState: trustStateLabel,
      originalMechanism: finalType,
      finalMechanism: finalType,
      wasOverridden: false,
      allowedMechanisms: allowedArr,
      blockedMechanisms: blockedArr,
      selectionReason,
    },
  };
}

export function compressFunnelStages(stages: FunnelStage[]): { compressed: FunnelStage[]; wasCompressed: boolean } {
  if (stages.length <= MAX_FUNNEL_STAGES) {
    return { compressed: stages, wasCompressed: false };
  }

  console.log(`[FunnelEngine-V3] COMPRESSION | ${stages.length} stages exceed max ${MAX_FUNNEL_STAGES} — compressing`);

  const priorityOrder = ["entry", "education", "engagement", "consideration", "decision", "conversion"];
  const kept: FunnelStage[] = [];
  const overflow: FunnelStage[] = [];

  for (const stage of stages) {
    if (priorityOrder.includes(stage.name.toLowerCase()) && kept.length < MAX_FUNNEL_STAGES) {
      kept.push(stage);
    } else {
      overflow.push(stage);
    }
  }

  if (overflow.length > 0 && kept.length < MAX_FUNNEL_STAGES) {
    for (const extra of overflow) {
      if (kept.length >= MAX_FUNNEL_STAGES) break;
      kept.push(extra);
    }
  }

  if (overflow.length > 0 && kept.length > 0) {
    const lastKept = kept[kept.length - 1];
    const mergedPurposes = overflow.map(s => s.purpose).join("; ");
    lastKept.purpose = `${lastKept.purpose} (merged: ${mergedPurposes})`;
  }

  return { compressed: kept, wasCompressed: true };
}

function buildStageMap(funnelType: string, awareness: string, offer?: FunnelOfferInput): FunnelStage[] {
  const stages: FunnelStage[] = [];
  const offerName = (offer?.offerName || "the offering").trim();
  const offerOutcome = (offer?.coreOutcome || "verified results").trim();
  const offerContext = `${offerName} ${offerOutcome} ${(offer as any)?.primaryCallToAction || ""}`;
  const isPreviewOffer = /preview|sample|demo|trial/i.test(offerContext);
  const primaryOfferCta = ((offer as any)?.primaryCallToAction || "").trim();

  if (awareness === "unaware" || awareness === "problem_aware") {
    stages.push({
      name: "entry",
      purpose: "Capture attention and establish problem awareness with public examples",
      coreMessage: `See how ${offerName} addresses your core problem before making any commitment.`,
      contentType: "educational_content",
      conversionGoal: "opt_in",
      cta: isPreviewOffer ? "Explore Public Examples & How It Works" : (primaryOfferCta || "Explore How It Works"),
    } as FunnelStage);
  }

  stages.push({
    name: "education",
    purpose: "Explain the step-by-step mechanism and collect user customization inputs",
    coreMessage: `Walk through the structured ${offerName} workflow and provide your specific details.`,
    contentType: "mechanism_demonstration",
    conversionGoal: "engagement",
    cta: isPreviewOffer ? "Start Your Guided Customization" : "See the Step-by-Step Process",
  } as FunnelStage);

  if (funnelType === "webinar" || funnelType === "challenge") {
    stages.push({
      name: "engagement",
      purpose: funnelType === "webinar" ? "Deliver value through live presentation" : "Guide through structured challenge",
      coreMessage: funnelType === "webinar"
        ? `Experience a live walkthrough of how ${offerName} delivers ${offerOutcome}.`
        : `Complete the guided interactive step to see ${offerName} applied to your inputs.`,
      contentType: funnelType === "webinar" ? "webinar_content" : "challenge_content",
      conversionGoal: "commitment",
      cta: funnelType === "webinar" ? "Watch the Walkthrough" : "Complete Your Guided Step",
    } as FunnelStage);
  }

  stages.push({
    name: "consideration",
    purpose: "Present proof and enable risk-free evaluation of the customized output",
    coreMessage: `Evaluate the quality and fit of ${offerName} against your expectations before purchasing.`,
    contentType: "proof_content",
    conversionGoal: "intent",
    cta: isPreviewOffer ? (primaryOfferCta || "Generate Your Free Trial Preview") : (primaryOfferCta || "Evaluate Real Examples"),
  } as FunnelStage);

  stages.push({
    name: "decision",
    purpose: "Remove final objections with transparent terms and review of the tailored result",
    coreMessage: `Review your personalized ${offerName} preview and transparent terms with zero hidden surprises.`,
    contentType: "offer_presentation",
    conversionGoal: "decision",
    cta: isPreviewOffer ? "Review Your Personalized Preview" : (primaryOfferCta || "Review Your Custom Offer"),
  } as FunnelStage);

  stages.push({
    name: "conversion",
    purpose: "Facilitate final commitment and immediate fulfillment",
    coreMessage: `Complete your order to unlock and access your full ${offerName}.`,
    contentType: "conversion_content",
    conversionGoal: "purchase",
    cta: primaryOfferCta || "Complete Your Order",
  } as FunnelStage);

  return stages;
}

export interface FunnelBusinessModelFitJudgeResult {
  verdict: "APPROVE" | "REPAIR" | "BLOCK";
  reasons: string[];
  failureType?: "PURCHASE_FRICTION_MISMATCH" | "BUSINESS_MODEL_MISMATCH" | "JOURNEY_IMPLAUSIBLE" | "CTA_INCOHERENT" | "NONE";
  feedback?: string;
}

/**
 * Hostile Commercial Reasoner and Business Model Fit Judge for Funnel Engine.
 * Evaluates whether the proposed funnel type and buying journey match the business model,
 * price point / ticket size, purchasing friction, and buyer behavior.
 */
export async function judgeFunnelBusinessModelFit(input: {
  candidate: {
    name: string;
    type: string;
    journeyRationale?: string[];
    stages?: string[];
  };
  commercialContext: {
    businessModel?: string;
    generalIndustry?: string;
    priceRange?: string;
    pricingModel?: string;
    coreOffer?: string;
  };
  offer: FunnelOfferInput;
  awareness?: FunnelAwarenessInput | null;
  accountId?: string;
}): Promise<FunnelBusinessModelFitJudgeResult> {
  // LLM Hostile Judge for dynamic commercial fit
  try {
    const judgePrompt = `You are a Hostile Commercial Reasoner and Funnel Judge.
Judge whether the candidate Funnel is commercially plausible and matches the business model, ticket size, and buyer journey.

COMMERCIAL PROFILE:
- Business Model: ${input.commercialContext.businessModel || "unknown"}
- Industry: ${input.commercialContext.generalIndustry || "unknown"}
- Price Range: ${input.commercialContext.priceRange || input.commercialContext.pricingModel || "unknown"}
- Core Offer: ${input.offer.offerName || input.commercialContext.coreOffer || "unknown"}

CANDIDATE FUNNEL:
- Name: "${input.candidate.name}"
- Type: "${input.candidate.type}"
- Journey: ${JSON.stringify(input.candidate.journeyRationale)}
- Stages: ${JSON.stringify(input.candidate.stages || [])}

EVALUATION CRITERIA:
1. PURCHASE FRICTION vs TRANSACTION ECONOMICS: Is the commitment required from the buyer proportionate to the product price and complexity? High friction (e.g. multi-step applications, required live webinars, consultative bookings) is commercially incoherent for low-ticket consumer products, while zero-qualification direct impulse checkout is incoherent for high-risk custom enterprise contracts.
2. BUYING JOURNEY PLAUSIBILITY: Does a real buyer of this offering navigate these stages in this sequence to make a purchase decision?
3. CTA COHERENCE: Are the call-to-action steps coherent with direct self-serve vs sales-assisted purchasing?

Respond with ONLY valid JSON:
{
  "verdict": "APPROVE" | "REPAIR" | "BLOCK",
  "reasons": ["..."],
  "failureType": "PURCHASE_FRICTION_MISMATCH" | "BUSINESS_MODEL_MISMATCH" | "JOURNEY_IMPLAUSIBLE" | "CTA_INCOHERENT" | "NONE",
  "feedback": "..."
}`;

    const resp = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: judgePrompt }],
      max_tokens: 350,
      temperature: 0.1,
      accountId: input.accountId,
    });
    const parsed = safeJsonParse(resp?.choices?.[0]?.message?.content || "{}");
    if (parsed && (parsed.verdict === "APPROVE" || parsed.verdict === "REPAIR" || parsed.verdict === "BLOCK")) {
      return {
        verdict: parsed.verdict,
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [parsed.reasons || "Evaluated by commercial fit judge"],
        failureType: parsed.failureType || (parsed.verdict === "APPROVE" ? "NONE" : "BUSINESS_MODEL_MISMATCH"),
        feedback: parsed.feedback || "",
      };
    }
    return {
      verdict: "BLOCK",
      reasons: ["Commercial fit judge returned invalid or unparseable evaluation"],
      failureType: "BUSINESS_MODEL_MISMATCH",
      feedback: "Funnel business model judge failed to return a valid structured verdict.",
    };
  } catch (err: any) {
    console.warn(`[FunnelEngine] BUSINESS_MODEL_JUDGE_ERROR | ${err.message}`);
    return {
      verdict: "BLOCK",
      reasons: [`Judge infrastructure failure: commercial fit judge unavailable (${err.message})`],
      failureType: "BUSINESS_MODEL_MISMATCH",
      feedback: "Funnel business model judge service is unavailable.",
    };
  }
}

export function applyAwarenessPriorityMatrix(
  proposedType: string,
  awareness: FunnelAwarenessInput | null | undefined,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
): PriorityMatrixDecision {
  const allTypes = [...FUNNEL_TYPES] as string[];
  let eligible = new Set<string>(allTypes);
  const blocked: { funnelType: string; blockedByPriority: number; reason: string }[] = [];
  const layers: PriorityMatrixDecision["priorityLayers"] = [];
  let decidingPriority = 6;
  let decidingPriorityName = "Offer Fit (default)";

  const entryMechanism = awareness?.entryMechanism || "";
  const trustStateLabel = awareness?.trustState || "";
  const awarenessStage = awareness?.awarenessStage || audience.awarenessLevel || "problem_aware";
  const triggerClass = awareness?.triggerClass || "";
  const awarenessScore = awareness?.awarenessStrengthScore ?? 0;

  const p1Blocked: string[] = [];
  const p1Eligible: string[] = [];
  const routeMapping = ENTRY_ROUTE_TO_FUNNEL_FAMILIES[entryMechanism];
  if (routeMapping && awareness) {
    for (const ft of routeMapping.blocked) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p1Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 1, reason: `Blocked by awareness route "${entryMechanism}" — incompatible funnel family` });
      }
    }
    const routeAllowed = routeMapping.allowed.filter(ft => eligible.has(ft));
    if (routeAllowed.length > 0) {
      for (const ft of allTypes) {
        if (!routeMapping.allowed.includes(ft) && eligible.has(ft)) {
          eligible.delete(ft);
          p1Blocked.push(ft);
          blocked.push({ funnelType: ft, blockedByPriority: 1, reason: `Not in allowed set for awareness route "${entryMechanism}"` });
        }
      }
    }
    p1Eligible.push(...Array.from(eligible));
    if (!eligible.has(proposedType)) {
      decidingPriority = 1;
      decidingPriorityName = "Awareness Route";
    }
  }
  layers.push({
    priority: 1, name: "Awareness Route", action: routeMapping ? `Filtered by ${entryMechanism}` : "No awareness route — skipped",
    eligible: Array.from(eligible), blocked: p1Blocked,
  });

  const p2Blocked: string[] = [];
  const highTrust = trustStateLabel === "high" || trustStateLabel === "very_high" || trustStateLabel === "critical"
    || entryMechanism === "trust_repair_entry";
  if (highTrust && awareness) {
    for (const ft of TRUST_LIGHT_FUNNELS) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p2Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 2, reason: `Trust requirement "${trustStateLabel}" blocks low-trust funnel "${ft}"` });
      }
    }
    if (!eligible.has(proposedType) && decidingPriority > 2) {
      decidingPriority = 2;
      decidingPriorityName = "Trust Requirement";
    }
  }
  layers.push({
    priority: 2, name: "Trust Requirement", action: highTrust ? `High trust — penalized light funnels` : "Trust level acceptable — no override",
    eligible: Array.from(eligible), blocked: p2Blocked,
  });

  const p3Blocked: string[] = [];
  if (awareness) {
    const stageBlockedList = AWARENESS_BLOCKED_FUNNELS[awarenessStage] || [];
    for (const ft of stageBlockedList) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p3Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 3, reason: `Awareness stage "${awarenessStage}" blocks funnel "${ft}" — structural constraint` });
      }
    }
    if (!eligible.has(proposedType) && decidingPriority > 3) {
      decidingPriority = 3;
      decidingPriorityName = "Awareness Stage";
    }
  }
  if (HIGH_READINESS_STAGES.includes(awarenessStage) && awareness) {
    const highReadinessPreferred = ["direct", "tripwire", "application", "membership"];
    for (const ft of eligible) {
      if (!highReadinessPreferred.includes(ft) && ft !== "vsl" && ft !== "webinar" && ft !== "consultation" && ft !== "hybrid") {
        // Don't block, but note preference
      }
    }
  }
  layers.push({
    priority: 3, name: "Awareness Stage", action: LOW_READINESS_STAGES.includes(awarenessStage) ? `Low readiness "${awarenessStage}" — blocked high-commitment` : `Stage "${awarenessStage}" — no constraint`,
    eligible: Array.from(eligible), blocked: p3Blocked,
  });

  const p4Blocked: string[] = [];
  const triggerMapping = TRIGGER_CLASS_TO_FUNNEL_FAMILY[triggerClass];
  if (triggerMapping && awareness) {
    for (const ft of triggerMapping.penalized) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p4Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 4, reason: `Trigger class "${triggerClass}" penalizes funnel "${ft}"` });
      }
    }
    if (!eligible.has(proposedType) && decidingPriority > 4) {
      decidingPriority = 4;
      decidingPriorityName = "Trigger Class";
    }
  }
  layers.push({
    priority: 4, name: "Trigger Class", action: triggerMapping ? `Filtered by trigger "${triggerClass}"` : "No trigger class constraint",
    eligible: Array.from(eligible), blocked: p4Blocked,
  });

  const p5Blocked: string[] = [];
  const audienceReadiness = awarenessStage === "most_aware" ? 0.9 : awarenessStage === "product_aware" ? 0.7
    : awarenessStage === "solution_aware" ? 0.55 : awarenessStage === "problem_aware" ? 0.35 : 0.2;
  if (audienceReadiness < 0.4 && awareness) {
    for (const ft of Array.from(eligible)) {
      const required = COMMITMENT_TOLERANCE_MAP[ft] ?? 0.5;
      if (required > 0.6) {
        eligible.delete(ft);
        p5Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 5, reason: `Low commitment tolerance (readiness ${audienceReadiness.toFixed(2)}) blocks high-commitment funnel "${ft}" (requires ${required})` });
      }
    }
    if (!eligible.has(proposedType) && decidingPriority > 5) {
      decidingPriority = 5;
      decidingPriorityName = "Commitment Tolerance";
    }
  }
  layers.push({
    priority: 5, name: "Commitment Tolerance", action: audienceReadiness < 0.4 ? `Low readiness ${audienceReadiness.toFixed(2)} — blocked high-commitment` : "Commitment tolerance acceptable",
    eligible: Array.from(eligible), blocked: p5Blocked,
  });

  const offerPreviewCorpus = [
    offer?.offerName || "",
    offer?.coreOutcome || "",
    (offer as any)?.headline || "",
    offer?.mechanismDescription || "",
    (offer as any)?.primaryCallToAction || "",
    ...(Array.isArray(offer?.deliverables) ? offer.deliverables.map((d: any) => typeof d === "string" ? d : `${d?.name || ""} ${d?.description || ""}`) : []),
    ...(Array.isArray(offer?.riskReducers) ? offer.riskReducers.map((r: any) => typeof r === "string" ? r : `${r?.name || ""} ${r?.description || ""}`) : []),
  ].join(" ");
  const hasPreviewBridgeOffer = Boolean(
    offer &&
    awarenessStage !== "unaware" &&
    (/free\s+(?:trial\s+)?preview|free\s+trial|preview\s+before|sample\s+preview|\bpreview\b|\bdemo\b|\bself-serve\b/i.test(offerPreviewCorpus) ||
      (((typeof offer.frictionLevel === "number" && offer.frictionLevel <= 0.35) || (typeof offer.frictionLevel === "string" && offer.frictionLevel === "low")) && (proposedType === "direct" || proposedType === "tripwire")))
  );
  if (hasPreviewBridgeOffer && (proposedType === "direct" || proposedType === "tripwire")) {
    eligible.add(proposedType);
    decidingPriority = 6;
    decidingPriorityName = "Offer Fit (Preview Bridge)";
  }

  layers.push({
    priority: 6, name: "Offer Fit", action: hasPreviewBridgeOffer ? "Preview bridge offer — direct/tripwire unlocked" : "Final refinement by offer characteristics",
    eligible: Array.from(eligible), blocked: [],
  });

  let finalType = proposedType;
  const wasOverridden = !eligible.has(proposedType);

  if (wasOverridden && eligible.size > 0) {
    const preferenceOrder = triggerMapping?.preferred || routeMapping?.allowed || allTypes;
    const bestMatch = preferenceOrder.find(ft => eligible.has(ft));
    finalType = bestMatch || Array.from(eligible)[0];
    console.log(`[FunnelEngine-V3] PRIORITY_MATRIX_OVERRIDE | proposed=${proposedType} → final=${finalType} | decidingPriority=P${decidingPriority} (${decidingPriorityName})`);
  } else if (eligible.size === 0) {
    eligible = new Set([proposedType]);
    finalType = proposedType;
    console.log(`[FunnelEngine-V3] PRIORITY_MATRIX_EXHAUSTED | all types blocked — falling back to proposed=${proposedType}`);
  }

  return {
    decidingPriority,
    decidingPriorityName,
    eligibleFunnels: Array.from(eligible),
    blockedFunnels: blocked,
    originalType: proposedType,
    finalType,
    wasOverridden,
    awarenessCompatible: eligible.has(finalType),
    priorityLayers: layers,
  };
}

export function buildFunnelCandidate(
  name: string,
  funnelType: string,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
  awarenessInput?: FunnelAwarenessInput | null,
  aiGeneratedStages?: FunnelStage[],
): FunnelCandidate {
  const matrixDecision = applyAwarenessPriorityMatrix(funnelType, awarenessInput, audience, offer);
  const effectiveType = matrixDecision.finalType;

  if (matrixDecision.wasOverridden) {
    console.log(`[FunnelEngine-V3] CANDIDATE_OVERRIDE | "${name}" type ${funnelType} → ${effectiveType} | P${matrixDecision.decidingPriority} (${matrixDecision.decidingPriorityName})`);
  }

  const awarenessStageStr = awarenessInput?.awarenessStage || audience.awarenessLevel || "problem_aware";
  const rawStageMap = Array.isArray(aiGeneratedStages) && aiGeneratedStages.length > 0
    ? aiGeneratedStages.map((s) => ({ ...s }))
    : buildStageMap(effectiveType, awarenessStageStr, offer);
  const { compressed: stageMap, wasCompressed } = compressFunnelStages(rawStageMap);

  const entryTrigger = layerEntryTriggerDetection(audience, offer, effectiveType, awarenessInput);

  const eligibility = layer1_funnelEligibilityDetection(audience, offer);
  const fitResult = layer2_offerToFunnelFit(offer, audience);
  const frictionResult = layer3_audienceFrictionModeling(audience, effectiveType);
  const trustResult = layer4_trustPathConstruction(audience, differentiation, effectiveType);
  const proofResult = layer5_proofPlacementLogic(differentiation, stageMap);
  const commitResult = layer6_commitmentLevelMatching(audience, offer, effectiveType);

  const isGeneric = detectGenericFunnel(name) || detectGenericFunnel(effectiveType);

  const candidate: FunnelCandidate = {
    funnelName: name,
    funnelType: effectiveType,
    stageMap,
    trustPath: trustResult.trustPath,
    proofPlacements: proofResult.proofPlacements,
    commitmentLevel: commitResult.commitmentLevel,
    frictionMap: frictionResult.frictionPoints,
    entryTrigger,
    funnelStrengthScore: 0,
    eligibilityScore: eligibility.eligibilityScore,
    offerFitScore: fitResult.fitScore,
    audienceFrictionScore: frictionResult.audienceFrictionScore,
    trustPathScore: trustResult.trustPathScore,
    proofPlacementScore: proofResult.proofPlacementScore,
    commitmentMatchScore: commitResult.commitmentMatchScore,
    integrityResult: { passed: true, failures: [] },
    compressionApplied: wasCompressed,
    genericFlag: isGeneric,
    groundedJourneyRationale: [],
    priorityMatrixDecision: matrixDecision,
  };

  // T006: trust-path proof-coverage penalty.
  // Integrity engine flags "Differentiation has proof architecture but funnel has no proof placements"
  // as a structural integrity warning. Funnel must reflect the same reality in its trust score
  // so the two engines agree.
  {
    const proofArchLen = (differentiation.proofArchitecture || []).length;
    const placementsLen = (proofResult.proofPlacements || []).length;
    if (proofArchLen > 0 && placementsLen === 0) {
      const beforePenalty = candidate.trustPathScore;
      candidate.trustPathScore = clamp(candidate.trustPathScore * 0.55);
      console.log(`[FunnelEngine] TRUST_PATH_PROOF_PENALTY | proofArch=${proofArchLen} placements=0 | trustPathScore=${beforePenalty.toFixed(2)}→${candidate.trustPathScore.toFixed(2)}`);
    } else if (proofArchLen >= 2 && placementsLen === 1) {
      // partial — soft penalty
      const beforePenalty = candidate.trustPathScore;
      candidate.trustPathScore = clamp(candidate.trustPathScore * 0.8);
      console.log(`[FunnelEngine] TRUST_PATH_PROOF_PENALTY_SOFT | proofArch=${proofArchLen} placements=1 | trustPathScore=${beforePenalty.toFixed(2)}→${candidate.trustPathScore.toFixed(2)}`);
    }
  }

  const integrityResult = layer7_funnelIntegrityGuard(candidate, audience, offer, positioning, differentiation);
  candidate.integrityResult = integrityResult;

  candidate.funnelStrengthScore = layer8_funnelStrengthScoring(candidate);

  if (wasCompressed) {
    candidate.funnelStrengthScore = clamp(candidate.funnelStrengthScore * 0.9);
  }

  if (matrixDecision.wasOverridden) {
    candidate.funnelStrengthScore = clamp(candidate.funnelStrengthScore * 0.95);
  }

  if (entryTrigger.mechanismType === "ENFORCEMENT_FAILED") {
    candidate.funnelStrengthScore = clamp(candidate.funnelStrengthScore * 0.5);
    candidate.integrityResult.passed = false;
    candidate.integrityResult.failures.push("Entry trigger enforcement failed — awareness rules could not derive a valid trigger");
  }

  return candidate;
}

function buildEmptyFunnel(name?: string): FunnelCandidate {
  return {
    funnelName: name || "No Funnel",
    funnelType: "none",
    stageMap: [],
    trustPath: [],
    proofPlacements: [],
    commitmentLevel: "none",
    frictionMap: [],
    entryTrigger: { mechanismType: "none", purpose: "No data available" },
    funnelStrengthScore: 0,
    eligibilityScore: 0,
    offerFitScore: 0,
    audienceFrictionScore: 0,
    trustPathScore: 0,
    proofPlacementScore: 0,
    commitmentMatchScore: 0,
    integrityResult: { passed: false, failures: ["No data"] },
    compressionApplied: false,
    genericFlag: false,
    groundedJourneyRationale: [],
  };
}

export async function aiFunnelGeneration(
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
  accountId: string,
  mi?: FunnelMIInput | null,
  awarenessCtx?: FunnelAwarenessInput | null,
  analyticalEnrichment?: any,
  depthRejectionContext?: string,
  strategic?: RunStrategicContext | null,
  productDna?: ProductDnaLike | null,
  attemptNumber?: number,
): Promise<{ primary: { name: string; type: string; journeyRationale: string[] }; alternative: { name: string; type: string }; rejected: { name: string; type: string; rejectionReason: string }; groundingRefs?: string[] }> {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const pillars = differentiation.pillars || [];
  const mechanism = differentiation.mechanismFraming || {};
  const core = differentiation.mechanismCore;

  const primaryLane = (audience as any).laneContext 
    || ((audience as any).approvedLanes || []).find((l: any) => l.isPrimary) 
    || ((audience as any).approvedLanes || [])[0];
  const laneObjections: string[] = Array.isArray(primaryLane?.objections)
    ? primaryLane.objections.map((o: any) => typeof o === "string" ? o : (o.canonical || o.statement || o.objection || String(o)))
    : (Array.isArray(primaryLane?.associatedObjections) ? primaryLane.associatedObjections : []);

  const mechanismCoreBlock = core && core.mechanismType !== "none" && core.mechanismName
    ? `\n- MECHANISM CORE (single source of truth):
  - Name: ${core.mechanismName}
  - Type: ${core.mechanismType}
  - Steps: ${core.mechanismSteps.join(" → ")}
  - Funnel stages MUST align with mechanism steps`
    : "";

  const bizUnderstanding = (strategic?.doctrine as any)?.businessUnderstanding;
  const businessModel = bizUnderstanding?.businessModel || productDna?.businessType || "B2C / DTC";
  const generalIndustry = bizUnderstanding?.generalIndustry || productDna?.productCategory || "";
  const pricingModel = bizUnderstanding?.campaignOffering?.pricingModel || (productDna as any)?.priceRange || "";
  const priceRange = (productDna as any)?.priceRange || pricingModel || "Standard tier pricing";
  const coreOfferName = bizUnderstanding?.campaignOffering?.offeringName || productDna?.coreOffer || offer.offerName || "";

  const commercialContextBlock = `
═══ COMMERCIAL BUSINESS MODEL & TRANSACTION PROFILE (DYNAMIC REASONING) ═══
- Business Model: ${businessModel}
- Industry / Category: ${generalIndustry}
- Pricing / Price Point: ${pricingModel || priceRange}
- Offering: ${coreOfferName}

COMMERCIAL COHERENCE DIRECTIVE:
1. PURCHASE FRICTION vs TRANSACTION ECONOMICS:
   The commitment required from the buyer must be proportionate to the transaction value, complexity, and risk.
   - For direct consumer retail or low-to-moderate ticket products, minimize friction: direct self-serve catalog discovery, social/fit proof, and checkout.
   - For high-ticket enterprise contracts, complex custom setups, or high-risk investments, integrate appropriate validation, demonstration, or consultative qualification.
2. BUYING JOURNEY PLAUSIBILITY:
   Design the journey stages to reflect how actual buyers in this category make buying decisions. Avoid disproportionate barriers.`;

  const eligibleTypesBlock = awarenessCtx
    ? `\n\nAWARENESS CONTEXT:
- Awareness Stage: ${awarenessCtx.awarenessStage}
- Entry Mechanism: ${awarenessCtx.entryMechanism}
- Trigger Class: ${awarenessCtx.triggerClass}
- Trust State: ${awarenessCtx.trustState}
- Awareness Route: ${awarenessCtx.awarenessRoute}`
    : "";

  const painRegistry = (audience?.painRegistry || []) as any[];
  const approvedLanes = (audience?.approvedLanes || []) as any[];
  const filteredAelCtx = filterAELForStrategicUse(analyticalEnrichment || null, painRegistry, approvedLanes);
  const activeAel = filteredAelCtx ? filteredAelCtx.filteredPkg : (analyticalEnrichment || null);
  const aelBlock = formatAELForPrompt(activeAel, painRegistry, approvedLanes);
  const causalDirective = buildCausalDirectiveForPrompt(activeAel);
  if (aelBlock) console.log(`[FunnelEngine-V3] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars | causalDirective=${causalDirective.length}chars`);

  // Anchor doctrine (criteria A + B): inject the strategic doctrine block when
  // threaded; when the doctrine anchor is absent, derive an anchor from Product
  // DNA (F5a). deriveAnchorFromProductDna returns null unless differentiator +
  // problem + name + type all exist (D5 — never fabricate).
  let doctrineBlock = "";
  if (strategic) {
    doctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[FunnelEngine-V3] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }
  let funnelAnchor: ProductAnchor | null = strategic ? strategic.doctrine.productAnchor : null;
  if (!funnelAnchor && productDna) {
    const derivedAnchor = deriveAnchorFromProductDna(productDna);
    if (derivedAnchor) {
      funnelAnchor = derivedAnchor;
      console.log("[FunnelEngine-V3] ANCHOR_FROM_DNA | doctrine anchor absent — prompt anchor derived from business context (F5a)");
    }
  }
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let funnelAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    funnelAnchorSource = "doctrine";
  } else if (funnelAnchor) {
    funnelAnchorSource = "dna";
  }
  const dnaAnchorBlock = funnelAnchorSource === "dna" && funnelAnchor
    ? `
=== PRODUCT ANCHOR (from Product Identity — resolve every funnel concept to THIS product) ===
Product name: ${funnelAnchor.name}
Product type: ${funnelAnchor.type}${funnelAnchor.keyAttributes.length > 0 ? `\nKey attributes: ${funnelAnchor.keyAttributes.join("; ")}` : ""}
Core problem solved: ${funnelAnchor.coreProblemSolved}
Differentiating feature: ${funnelAnchor.differentiatingFeature}
`
    : "";
  const anchorGroundingRule = funnelAnchor
    ? "\nANCHOR GROUNDING: Every funnel name and journey MUST be specific to the anchored product above — its core problem and differentiating feature. Anchor grounding SUPPLEMENTS the causal grounding rules; it never replaces them.\n"
    : "";
  console.log(`[FunnelEngine-V3] ANCHOR_EVIDENCE | engine=funnel | site=first_prompt | attempt=${attemptNumber ?? 1} | present=${funnelAnchor ? "yes" : "no"} | source=${funnelAnchorSource}`);

  // Grounding contract (shared): citable [RC#]/[CC#]/[BB#] AEL index + additive
  // contract compelling the model to name the anchor's differentiating feature
  // and cite AEL evidence via groundingRefs. Funnel previously had prose AEL only.
  const aelRefIndex = buildAelReferenceIndex(analyticalEnrichment || null);
  const groundingContractBlock = buildGroundingContract(funnelAnchor, analyticalEnrichment || null, { capabilities: deriveValidatedCapabilities(funnelAnchor, productDna) });

  const prompt = `You are a Funnel Architect. Generate three funnel concepts based on the market intelligence below.
${doctrineBlock ? `\n${doctrineBlock}\n` : ""}${dnaAnchorBlock}${anchorGroundingRule}${aelBlock}${aelRefIndex}${causalDirective}${groundingContractBlock}
STRICT RULES:
- Do NOT generate strategy decisions, strategic repositioning, offer redesign, pricing logic, budget recommendations, channel selection, media buying, awareness messaging, persuasion copy, scripts, campaign tasks, financial planning, or execution plans
- ONLY output funnel definitions: name, type (direct, webinar, challenge, vsl, application, consultation, tripwire, product-launch, membership, hybrid)
- Funnels must be specific and non-generic. Avoid "standard funnel" or "basic sales funnel"
- Each funnel must define the JOURNEY the buyer takes from awareness to commitment
- Respond with ONLY valid JSON, no markdown${mechanismCoreBlock}${eligibleTypesBlock}${commercialContextBlock}

Market Context:
- Offer: ${offer.offerName || "Not defined"} — ${offer.coreOutcome || "Not defined"}
- Primary Lane Objections (Authoritative): ${JSON.stringify(laneObjections.slice(0, 5))}
- Top Pains: ${JSON.stringify(pains.slice(0, 5).map((p: any) => typeof p === "string" ? p : p?.pain || p?.name))}
- Top Desires: ${JSON.stringify(desires.slice(0, 5).map(([k]) => k))}
- Awareness Level: ${audience.awarenessLevel || "unknown"}
- Maturity Index: ${audience.maturityIndex ?? "unknown"}
- Differentiation Pillars: ${JSON.stringify(pillars.slice(0, 3).map((p: any) => p.name))}
- Mechanism: ${core?.mechanismLogic || mechanism.description || "No validated mechanism"}
- Enemy: ${positioning.enemyDefinition || "Not defined"}
- Narrative: ${positioning.narrativeDirection || "Not defined"}
- Offer Strength: ${(offer.offerStrengthScore || 0).toFixed(2)}${(() => {
  const aelRootCauses = Array.isArray(analyticalEnrichment?.root_causes) ? analyticalEnrichment.root_causes : [];
  const aelBuyingBarriers = Array.isArray(analyticalEnrichment?.buying_barriers) ? analyticalEnrichment.buying_barriers : [];
  const aelCausalChains = Array.isArray(analyticalEnrichment?.causal_chains) ? analyticalEnrichment.causal_chains : [];
  let s = "";
  if (aelBuyingBarriers.length > 0) s += `\n- Secondary Supporting Buying Barriers: ${JSON.stringify(aelBuyingBarriers.slice(0, 4).map((b: any) => ({ barrier: b.barrier, rootCause: b.rootCause, userThinking: b.userThinking })))}`;
  if (aelRootCauses.length > 0) s += `\n- Secondary Supporting Root Causes: ${JSON.stringify(aelRootCauses.slice(0, 4).map((r: any) => ({ deepCause: r.deepCause, surfaceSignal: r.surfaceSignal })))}`;
  if (aelCausalChains.length > 0) s += `\n- Supporting Causal Chains: ${JSON.stringify(aelCausalChains.slice(0, 3).map((c: any) => `${c.pain} → ${c.cause} → ${c.behavior}`))}`;
  return s;
})()}
${(() => {
  const ms = safeJsonParse(mi?.multiSourceSignals);
  if (!ms || typeof ms !== "object") return "";
  const ctaPatterns: string[] = [];
  const navPatterns: string[] = [];
  for (const compData of Object.values(ms as Record<string, any>)) {
    if ((compData as any)?.website) {
      for (const cta of ((compData as any).website.funnelCTAs || (compData as any).website.ctaPatterns || []).slice(0, 3)) {
        if (typeof cta === "string" && cta.trim()) ctaPatterns.push(cta);
      }
      for (const nav of ((compData as any).website.featureHierarchy || (compData as any).website.navigationFlow || []).slice(0, 3)) {
        if (typeof nav === "string" && nav.trim()) navPatterns.push(nav);
      }
    }
  }
  if (ctaPatterns.length === 0 && navPatterns.length === 0) return "";
  let section = "\n═══ WEBSITE INTELLIGENCE (competitor CTA/flow patterns) ═══";
  if (ctaPatterns.length > 0) section += `\nCompetitor CTA Patterns: ${JSON.stringify(ctaPatterns.slice(0, 6))}`;
  if (navPatterns.length > 0) section += `\nCompetitor Navigation Flows: ${JSON.stringify(navPatterns.slice(0, 6))}`;
  section += "\nUse these patterns to inform funnel stage design and entry mechanisms.";
  return section;
})()}

JOURNEY RATIONALE (primary funnel only): In "primary.journeyRationale", return 3-5 sentences describing the buyer's progression through the funnel stages. Across the journey as a whole, clearly explain how the funnel stages transition the audience from their validated lane buying pain points and resolve their primary lane objections (${laneObjections.join("; ") || "..."}), with secondary market barriers addressed as supporting context, providing the required proof, and moving them toward offer commitment. Express this in the audience's specific market context and pain language. Do NOT copy the AEL evidence text verbatim — explain what the buyer experiences and how that stage resolves it.
CRITICAL CAPABILITY & FACTUAL BOUNDARY: You MUST NOT invent product capabilities, operational guarantees, or unverified promises outside the approved Product Truth / offering capabilities (e.g. do NOT promise automated refund processing if only 24h exchange is supported, and do NOT generate unverified guarantees like 'Fast Shipping Guaranteed' or 'Money-back Guarantee'). Funnel stages, CTAs, and journey progression must strictly align with verified capabilities.

Return JSON:
{
  "primary": { "name": "Specific funnel name", "type": "funnel_type", "journeyRationale": ["Names a specific barrier/root cause a journey phase removes, in the buyer's pain language", "...", "..."] },
  "alternative": { "name": "Alternative funnel name", "type": "funnel_type" },
  "rejected": { "name": "Rejected funnel name", "type": "funnel_type", "rejectionReason": "Why this funnel fails" },
  "groundingRefs": ["RC1", "CC2"]
}`;

  const fullPrompt = depthRejectionContext ? `${prompt}\n\n${depthRejectionContext}` : prompt;
    const result = await generateWithRepair<string, string>({
    engineName: "funnel-engine",
    touchpointName: "concept_generation",
    authoritativeInput: fullPrompt,
    generate: async (promptText) => {
      const completion = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: promptText }],
        max_tokens: 1200,
        temperature: 0.7,
        accountId,
        endpoint: "funnel-engine",
      });
      return completion.choices?.[0]?.message?.content || "{}";
    },
    judge: (async (input: string, candidateStr: string): Promise<JudgeResult<string>> => {
      const cleaned = (typeof candidateStr === 'string' ? candidateStr : JSON.stringify(candidateStr)).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = safeJsonParse(cleaned);
      if (!parsed) {
        return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Valid JSON", reason: "Response must be valid JSON" }] };
      }
      
      const missing: string[] = [];
      if (!parsed?.primary?.name) missing.push("primary.name");
      if (!parsed?.primary?.type) missing.push("primary.type");
      if (!parsed?.alternative?.name) missing.push("alternative.name");
      if (!parsed?.alternative?.type) missing.push("alternative.type");
      if (!parsed?.rejected?.name) missing.push("rejected.name");
      if (!parsed?.rejected?.type) missing.push("rejected.type");
      if (!parsed?.rejected?.rejectionReason) missing.push("rejected.rejectionReason");
      const jr = Array.isArray(parsed?.primary?.journeyRationale)
        ? parsed.primary.journeyRationale.filter((s: any) => typeof s === "string" && s.trim().length > 0)
        : [];
      if (jr.length < 3) missing.push("primary.journeyRationale(>=3 non-empty sentences)");
      
      if (missing.length > 0) {
        return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Missing fields", reason: `Missing required fields: ${missing.join(", ")}` }] };
      }

      // Semantic Judge: Ensure Executor philosophy (no strategy drift)
      const rationaleText = jr.join(" ").toLowerCase();
      
      // We explicitly check if the funnel hallucinates "discount" or "free trial" if it's not in the offer or verified Product Truth
      const offerOutcome = [
        offer.coreOutcome || "",
        offer.offerName || "",
        offer.mechanismDescription || "",
        JSON.stringify(offer.deliverables || []),
        JSON.stringify(offer.riskReducers || []),
        JSON.stringify(funnelAnchor?.keyAttributes || []),
        funnelAnchor?.differentiatingFeature || "",
        pricingModel || "",
        priceRange || "",
      ].join(" ").toLowerCase();
      if (!offerOutcome.includes("discount") && rationaleText.includes("discount")) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "No Invention", reason: "Hallucinated 'discount' which is not in the approved core offer."}] };
      }
      if (!offerOutcome.includes("free trial") && !offerOutcome.includes("preview") && rationaleText.includes("free trial")) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "No Invention", reason: "Hallucinated 'free trial' which is not in the approved core offer."}] };
      }
      if (!offerOutcome.includes("billing") && (rationaleText.includes("unification of billing") || rationaleText.includes("refund fairness") || rationaleText.includes("refund data"))) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "Product Truth Violation", reason: "Hallucinated billing/refund management capabilities which are not in the approved core offer."}] };
      }
      if (rationaleText.includes("fast shipping guaranteed") || rationaleText.includes("guaranteed delivery") || rationaleText.includes("money-back guarantee") || rationaleText.includes("guaranteed refund")) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "Product Truth Violation", reason: "Hallucinated unverified operational/shipping/refund guarantees not in Product Truth."}] };
      }
      
      // Hostile Commercial Reasoner and Business Model Fit Judge
      const commercialVerdict = await judgeFunnelBusinessModelFit({
        candidate: {
          name: parsed.primary.name,
          type: parsed.primary.type,
          journeyRationale: jr,
        },
        commercialContext: {
          businessModel,
          generalIndustry,
          priceRange: pricingModel || priceRange,
          coreOffer: coreOfferName,
        },
        offer,
        awareness: awarenessCtx,
        accountId,
      });

      if (commercialVerdict.verdict === "BLOCK" || commercialVerdict.verdict === "REPAIR") {
        return {
          valid: false,
          failureClass: "GENERATION_QUALITY_FAILURE",
          rejections: commercialVerdict.reasons.map((r) => ({
            rule: `Commercial Fit (${commercialVerdict.failureType || "BUSINESS_MODEL_MISMATCH"})`,
            reason: `${r}${commercialVerdict.feedback ? `. Guidance: ${commercialVerdict.feedback}` : ""}`,
          })),
        };
      }

      if (parsed.alternative?.type && Array.isArray(parsed.alternative?.journeyRationale) && parsed.alternative.journeyRationale.length > 0) {
        const altCommercialVerdict = await judgeFunnelBusinessModelFit({
          candidate: {
            name: parsed.alternative.name || `${parsed.alternative.type} Funnel`,
            type: parsed.alternative.type,
            journeyRationale: parsed.alternative.journeyRationale,
            stages: parsed.alternative.stages,
          },
          commercialContext: {
            businessModel,
            generalIndustry,
            priceRange,
            pricingModel,
            coreOffer: offer.offerName,
          },
          offer,
          awareness: awarenessCtx,
          accountId,
        });
        if (altCommercialVerdict.verdict === "BLOCK" || altCommercialVerdict.verdict === "REPAIR") {
          return {
            valid: false,
            failureClass: "GENERATION_QUALITY_FAILURE",
            rejections: altCommercialVerdict.reasons.map((r) => ({
              rule: `Alternative Commercial Fit (${altCommercialVerdict.failureType || "BUSINESS_MODEL_MISMATCH"})`,
              reason: `${r}${altCommercialVerdict.feedback ? `. Guidance: ${altCommercialVerdict.feedback}` : ""}`,
            })),
          };
        }
      }

      return { valid: true, recoveredValue: candidateStr };
    }) as (input: string, candidate: string) => Promise<JudgeResult<string>>,
    repair: async (input: string, failedCandidate: string, rejections: any[]) => {
      const defect = rejections.map(r => r.reason).join(" | ");
      const repairPromptText = `You are the Strategic Repair Module for Avyron AI. 
Your previous generation was rejected by the validation judge.

--- REJECTION REASON ---
${defect}

--- YOUR TASK ---
Regenerate the output to fix the EXACT issue mentioned above. 

CRITICAL: When fixing structural or formatting errors (like JSON parsing), LLMs often default to writing generic, shallow marketing copy. You MUST NOT do this. You must maintain maximum strategic depth.

--- CAUSAL DEPTH & GROUNDING CHECKLIST ---
To pass the validation gate on this attempt, your new output MUST satisfy the following rules. The judge will check these exactly:
1. [ ] CAPABILITY LINK: You must explicitly build the offer around at least one verified capability from this registry. (See initial prompt for capability context).
2. [ ] PAIN RESOLUTION: The offer must directly target and resolve a validated audience problem. (See initial prompt for audience evidence).
3. [ ] NO INVENTION: Do not hallucinate features, discounts, or metrics that are not explicitly present in the data.

Fix the error, strictly follow the checklist, and output ONLY valid JSON matching the originally requested schema.

--- ORIGINAL PROMPT CONTEXT ---
${input}`;

      const completion = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: repairPromptText }],
        max_tokens: 1200,
        temperature: 0.3,
        accountId,
        endpoint: "funnel-engine-repair",
      });
      return completion.choices?.[0]?.message?.content || "{}";
    }
  });

  const parsed = JSON.parse(result.result) as any;
  
  const funnelGroundingRefs: string[] = Array.isArray(parsed.groundingRefs)
      ? parsed.groundingRefs.filter((r: any) => typeof r === "string" && r.trim().length > 0).map((r: string) => r.trim())
      : [];
    checkGroundingContract({
      engine: "funnel",
      site: "concept_generation",
      groundingRefs: funnelGroundingRefs,
      ael: analyticalEnrichment || null,
      accountId,
      attemptNumber,
    });

    const journeyRationale: string[] = Array.isArray(parsed.primary?.journeyRationale)
      ? parsed.primary.journeyRationale
          .filter((s: any) => typeof s === "string" && s.trim().length > 0)
          .map((s: string) => s.trim())
      : [];
    console.log(`[FunnelEngine-V3] GROUNDED_RATIONALE | segments=${journeyRationale.length} | chars=${journeyRationale.join(" ").length} | attempt=${attemptNumber ?? 1}`);

    const aelPkg: any = analyticalEnrichment || null;
    if (aelPkg && journeyRationale.length > 0) {
      const aelVerbatimSources: string[] = [];
      for (const rc of (Array.isArray(aelPkg.root_causes) ? aelPkg.root_causes : [])) {
        if (typeof rc?.deepCause === "string") aelVerbatimSources.push(rc.deepCause);
      }
      for (const bb of (Array.isArray(aelPkg.buying_barriers) ? aelPkg.buying_barriers : [])) {
        if (typeof bb?.barrier === "string") aelVerbatimSources.push(bb.barrier);
        if (typeof bb?.rootCause === "string") aelVerbatimSources.push(bb.rootCause);
      }
      const rationaleJoinedLower = journeyRationale.join(" \u2016 ").toLowerCase();
      for (const src of aelVerbatimSources) {
        const norm = src.trim().toLowerCase();
        if (norm.length >= 80 && rationaleJoinedLower.includes(norm.slice(0, 80))) {
          console.error(`[FunnelEngine-V3] FUNNEL_RATIONALE_VERBATIM_SUSPECT | attempt=${attemptNumber ?? 1} | an AEL evidence text appears near-verbatim in journeyRationale - depth grounding may be self-scoring; gates unchanged, review generation prompt`);
          break;
        }
      }
    }

    return {
      primary: { name: parsed.primary?.name, type: parsed.primary?.type, journeyRationale },
      alternative: { name: parsed.alternative?.name, type: parsed.alternative?.type },
      rejected: {
        name: parsed.rejected?.name,
        type: parsed.rejected?.type,
        rejectionReason: parsed.rejected?.rejectionReason,
      },
      groundingRefs: funnelGroundingRefs,
      _system_validation: parsed._system_validation
    } as any;
}

export interface FunnelAwarenessInput {
  awarenessStage: string;
  entryMechanism: string;
  triggerClass: string;
  trustState: string;
  awarenessRoute: string;
  awarenessStrengthScore: number;
}

export async function runFunnelEngine(
  mi: FunnelMIInput,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
  accountId: string,
  awareness?: FunnelAwarenessInput | null,
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext,
  productDna?: ProductDnaLike | null,
): Promise<FunnelResult> {
  const result = await runFunnelEngineInternal(
    mi, audience, offer, positioning, differentiation, accountId, awareness, analyticalEnrichment, strategic, productDna,
  );
  // Authoritative pain routing (Task 163): the funnel prioritizes
  // pre-purchase conversion barriers — the primary role is the
  // highest-priority OBJECTION eligible for the `funnel` use, with the core
  // purchase pain as fallback anchor; POST_PURCHASE_FRICTION never carries
  // the `funnel` use. Entry wrapper ⇒ attached on EVERY return path.
  if (Array.isArray(audience?.painRegistry) && audience.painRegistry.length > 0) {
    const funnelEligible = selectPainsForUse(audience.painRegistry, "funnel");
    const objections = funnelEligible.filter((pain) => pain.classification === "OBJECTION");
    const primary = objections[0] ?? funnelEligible[0] ?? null;
    if (primary) {
      console.log(`[FunnelEngine] FUNNEL_PAIN_SELECTED | painId=${primary.painId} | class=${primary.classification} | rank=${primary.rank} | objections=${objections.length}`);
    }
    (result as any).selectedPainRoles = {
      primary: primary
        ? { painId: primary.painId, canonical: primary.canonical, rank: primary.rank, role: "conversion_barrier" as const, classification: primary.classification }
        : null,
      objections: objections.map((pain) => ({
        painId: pain.painId, canonical: pain.canonical, rank: pain.rank, role: "conversion_barrier" as const, classification: pain.classification,
      })),
    };
  }
  return result;
}


export async function aiStageLayoutGeneration(
  funnelType: string,
  awarenessStage: string,
  offer: FunnelOfferInput,
  accountId: string,
  context?: {
    funnelName?: string;
    journeyRationale?: string[];
    mechanismSteps?: string[];
    laneObjections?: string[];
  },
): Promise<FunnelStage[]> {
  const deliverablesList = Array.isArray(offer.deliverables)
    ? offer.deliverables.map((d: any) => typeof d === "string" ? d : `${d?.name || ""}: ${d?.description || ""}`).join("; ")
    : "";
  const mechanismBlock = context?.mechanismSteps && context.mechanismSteps.length > 0
    ? `\n- Verified Mechanism Workflow Steps: ${context.mechanismSteps.join(" → ")}`
    : (offer.mechanismDescription ? `\n- Mechanism Description: ${offer.mechanismDescription}` : "");
  const rationaleBlock = context?.journeyRationale && context.journeyRationale.length > 0
    ? `\n- Approved Funnel Journey Rationale:\n  ${context.journeyRationale.map((r, i) => `${i + 1}. ${r}`).join("\n  ")}`
    : "";
  const objectionsBlock = context?.laneObjections && context.laneObjections.length > 0
    ? `\n- Primary Lane Objections to Resolve Across Stages: ${context.laneObjections.slice(0, 5).join(" | ")}`
    : "";

  const prompt = `You are a Funnel Architect for Avyron AI.
Your task is to generate the Stage Layout for the "${context?.funnelName || funnelType}" (${funnelType}) funnel tailored to an audience at the "${awarenessStage}" awareness level.

STRICT RULES:
1. You must strictly execute the upstream strategy. Do NOT invent new capabilities, unverified preview durations (e.g. do NOT claim "1-minute" or "60-second" unless explicitly present in the offer), or unverified prices.
2. Output MUST be 3 to 5 logical stages in causal buyer-journey order.
3. CAUSAL WORKFLOW ORDERING:
   - Public examples or sample demonstrations may appear in early stages (entry/education).
   - If the product generates a personalized preview, custom configuration, or tailored trial based on user inputs, the stage where the buyer provides their customization/input MUST precede or co-occur with the stage where they generate or evaluate their personalized preview. Never ask a buyer to evaluate their personalized output before they have provided their input.
4. DISTINCT FIELDS PER STAGE:
   - "purpose" (internal strategic goal of the stage) and "coreMessage" (the buyer-facing message communicated in the stage) MUST be distinct, substantive, and non-identical on every stage.
   - "cta" MUST be a specific, stage-appropriate call-to-action aligned with that stage's micro-commitment.
5. DESIRE VS. PRODUCT FACT BOUNDARY (STRICT):
   - Customer desires (such as wanting revision options, collaborative revision interfaces, permanent cloud hosting, or guaranteed emotional authenticity) are BUYER DESIRES, NOT existing product features unless explicitly stated in the Offer Deliverables or Verified Mechanism Workflow Steps below.
   - Do NOT invent revision workflows (do NOT write "review, revise, and complete your order" or "Order completion interface with revision options"), guaranteed emotional authenticity, or permanent hosting guarantees unless explicitly listed in the Offer Deliverables below.

CONTEXT:
- Offer Name: ${offer.offerName || "Not defined"}
- Core Outcome: ${offer.coreOutcome || "Not defined"}
- Primary Offer CTA: ${(offer as any).primaryCallToAction || "Complete Order"}${deliverablesList ? `\n- Deliverables: ${deliverablesList}` : ""}${mechanismBlock}${rationaleBlock}${objectionsBlock}

Respond with EXACTLY ONE valid JSON array of stage objects, containing no markdown or preamble:
[
  {
    "name": "stage_name (e.g., entry, education, consideration, decision, conversion)",
    "purpose": "Strategic goal of what this stage achieves in the buyer journey",
    "coreMessage": "Distinct buyer-facing core message communicated at this stage",
    "contentType": "Type of content or interactive step used",
    "conversionGoal": "The specific micro-commitment or action taken",
    "cta": "Specific call-to-action button/prompt for this stage",
    "buyerState": "Buyer mindset entering/exiting this stage"
  }
]`;

  const result = await generateWithRepair<string, string>({
    engineName: "funnel-engine",
    touchpointName: "stage_layout_generation",
    authoritativeInput: prompt,
    generate: async (promptText) => {
      const completion = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: promptText }],
        max_tokens: 1200,
        temperature: 0.4,
        accountId,
        endpoint: "funnel-engine",
      });
      return completion.choices?.[0]?.message?.content || "[]";
    },
    judge: (async (_input: string, candidateStr: string): Promise<JudgeResult<string>> => {
      const cleaned = (typeof candidateStr === 'string' ? candidateStr : JSON.stringify(candidateStr)).replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parsed = safeJsonParse(cleaned);
      if (!parsed || !Array.isArray(parsed) || parsed.length < 3) {
        return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Array Output", reason: "Output must be a JSON array of at least 3 stages" }] };
      }
      
      for (const stage of parsed) {
        if (!stage.name || !stage.purpose || !stage.contentType || !stage.conversionGoal) {
          return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Stage Schema", reason: "Each stage must have name, purpose, contentType, and conversionGoal" }] };
        }
        if (!stage.coreMessage || typeof stage.coreMessage !== "string" || stage.coreMessage.trim().toLowerCase() === String(stage.purpose).trim().toLowerCase()) {
          return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Distinct Core Message", reason: `Stage "${stage.name}" must include a "coreMessage" distinct from "purpose".` }] };
        }
        if (!stage.cta || typeof stage.cta !== "string" || stage.cta.trim().length < 3) {
          return { valid: false, failureClass: "CONTRACT_FAILURE", rejections: [{ rule: "Stage CTA Required", reason: `Stage "${stage.name}" must include a specific "cta".` }] };
        }
      }

      const allText = parsed.map((s: any) => `${s.name} ${s.purpose} ${s.coreMessage || ""} ${s.contentType} ${s.conversionGoal} ${s.cta || ""}`).join(" ").toLowerCase();
      
      // Strict Semantic Judge for Executor philosophy
      const offerCorpus = `${offer.offerName || ""} ${offer.coreOutcome || ""} ${offer.mechanismDescription || ""} ${deliverablesList} ${JSON.stringify(offer.riskReducers || [])} ${(context?.journeyRationale || []).join(" ")}`.toLowerCase();
      if (!offerCorpus.includes("discount") && allText.includes("discount")) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "No Invention", reason: "Hallucinated 'discount' in stages which is not in the approved core offer."}] };
      }
      if (!offerCorpus.includes("free trial") && !offerCorpus.includes("preview") && allText.includes("free trial")) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "No Invention", reason: "Hallucinated 'free trial' in stages which is not in the approved core offer."}] };
      }
      if (!offerCorpus.includes("1-minute") && !offerCorpus.includes("60-second") && (/1-minute|60-second|one-minute/i.test(allText))) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "No Unverified Duration", reason: "Hallucinated specific preview duration ('1-minute' / '60-second') not present in Product Truth." }] };
      }
      if (!/\brevis(?:e|ion|ions)\b/i.test(offerCorpus) && /\b(?:revis(?:e|ion|ions)|revision\s+options?|review,\s*revise)\b/i.test(allText)) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "Desire vs Product Capability Boundary", reason: "Funnel stage or CTA presents 'revision' / 'revise' as an existing product feature or checkout workflow, but revisions are a customer desire not supported by verified Product Truth." }] };
      }
      if (!/\bpermanent\s+(?:downloadable\s+|cloud\s+)?access\b/i.test(offerCorpus) && /\b(?:permanent|lifetime)\s+(?:downloadable\s+|cloud\s+)?(?:access|hosting|storage)\b/i.test(allText)) {
        return { valid: false, failureClass: "GENERATION_QUALITY_FAILURE", rejections: [{ rule: "Desire vs Product Capability Boundary", reason: "Funnel stage or CTA asserts 'permanent/lifetime access or hosting' which is not in verified Product Truth." }] };
      }

      // Causal ordering check: personalized preview evaluation must not precede user input/customization
      let firstInputStageIdx = -1;
      let firstPersonalizedPreviewEvalIdx = -1;
      parsed.forEach((s: any, idx: number) => {
        const stText = `${s.name} ${s.purpose} ${s.coreMessage || ""} ${s.conversionGoal} ${s.cta || ""}`.toLowerCase();
        if (firstInputStageIdx === -1 && /input|customiz|personaliz|occasion|detail|story|3-step|configure|tell us|select your/i.test(stText)) {
          firstInputStageIdx = idx;
        }
        if (
          firstPersonalizedPreviewEvalIdx === -1 &&
          /listen to your|review your custom|your personalized preview|evaluate your custom|unlock full/i.test(stText) &&
          !/public|sample|example|how it works/i.test(stText)
        ) {
          firstPersonalizedPreviewEvalIdx = idx;
        }
      });
      if (firstInputStageIdx > -1 && firstPersonalizedPreviewEvalIdx > -1 && firstPersonalizedPreviewEvalIdx < firstInputStageIdx) {
        return {
          valid: false,
          failureClass: "GENERATION_QUALITY_FAILURE",
          rejections: [{
            rule: "Causal Workflow Order",
            reason: `Personalized preview evaluation (stage ${firstPersonalizedPreviewEvalIdx + 1}) appears before user input/customization (stage ${firstInputStageIdx + 1}). Public examples can appear early, but a personalized preview requires user input first.`,
          }],
        };
      }

      return { valid: true, recoveredValue: JSON.stringify(parsed) };
    }) as (input: string, candidate: string) => Promise<JudgeResult<string>>,
    repair: async (input: string, _failedCandidate: string, rejections: any[]) => {
      const defect = rejections.map(r => r.reason).join(" | ");
      const repairPromptText = `You are the Strategic Repair Module for Avyron AI. 
Your previous stage layout generation was rejected by the validation judge.

--- REJECTION REASON ---
${defect}

--- YOUR TASK ---
Regenerate the JSON array of stages to fix the EXACT issue mentioned above.
Ensure every stage has distinct "purpose" and "coreMessage" fields, a specific "cta", no unverified durations or discounts, and respects causal workflow order (user customization/input before evaluating a personalized preview).

--- ORIGINAL PROMPT CONTEXT ---
${input}`;

      const completion = await aiChat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: repairPromptText }],
        max_tokens: 1200,
        temperature: 0.3,
        accountId,
        endpoint: "funnel-engine-repair",
      });
      return completion.choices?.[0]?.message?.content || "[]";
    }
  });

  const parsedResult = safeJsonParse(result.result);
  return Array.isArray(parsedResult) ? (parsedResult as FunnelStage[]) : [];
}

async function runFunnelEngineInternal(
  mi: FunnelMIInput,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
  accountId: string,
  awareness?: FunnelAwarenessInput | null,
  analyticalEnrichment?: any,
  strategic?: RunStrategicContext,
  productDna?: ProductDnaLike | null,
): Promise<FunnelResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  if (!offer || !offer.offerName || !strategic?.doctrine) {
    throw new LLMReliabilityError(
      "EVIDENCE_FAILURE: Upstream Strategy Root or Offer data is entirely empty",
      "EVIDENCE_FAILURE",
      [],
      { engine: "funnel", touchpoint: "funnel_generation", attempts: 0, technicalRetries: 0, finalVerdict: "HONEST_FAIL", repairLog: [] }
    );
  }

  console.log(`[FunnelEngine-V3] Starting 8-layer pipeline | awarenessProvided=${!!awareness}`);

  if (awareness) {
    console.log(`[FunnelEngine-V3] AWARENESS_CONTEXT | stage=${awareness.awarenessStage} | entry=${awareness.entryMechanism} | trigger=${awareness.triggerClass} | trust=${awareness.trustState} | score=${awareness.awarenessStrengthScore}`);
  }

  const pillars = differentiation.pillars || [];
  const proofArch = differentiation.proofArchitecture || [];

  const competitorSignals = (mi.opportunitySignals || []).length + (mi.threatSignals || []).length;
  const audienceSignals = (audience.audiencePains || []).length + Object.keys(audience.objectionMap || {}).length + (audience.emotionalDrivers || []).length;
  const dataReliability = assessDataReliability(
    competitorSignals,
    audienceSignals,
    !!positioning.narrativeDirection,
    !!(pillars.length > 0),
    !!(audience.audiencePains && audience.audiencePains.length > 0),
    differentiation.confidenceScore ?? 0,
  );
  diagnostics.dataReliability = dataReliability;
  if (dataReliability.isWeak) {
    console.log(`[FunnelEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  if (!offer.offerName && pillars.length === 0) {
    console.log(`[FunnelEngine-V3] Insufficient data — no offer or differentiation — blocking funnel generation`);
    const emptyFunnel = buildEmptyFunnel();
    const acceptability = assessStrategyAcceptability(0, 0, 8, false, ["Offer and differentiation data insufficient (INCOMPLETE)"]);
    return {
      status: STATUS.INCOMPLETE,
      statusMessage: "Offer and differentiation data insufficient to construct funnel — upstream INCOMPLETE propagated",
      primaryFunnel: emptyFunnel,
      alternativeFunnel: emptyFunnel,
      rejectedFunnel: { funnel: emptyFunnel, rejectionReason: "No data to construct funnel" },
      funnelStrengthScore: 0,
      trustPathAnalysis: { score: 0, steps: 0, gaps: ["No data available"] },
      proofPlacementLogic: { score: 0, placements: 0, missingPlacements: ["All placements missing"] },
      frictionMap: { totalFriction: 1, criticalPoints: 0, mitigations: 0 },
      boundaryCheck: { passed: true, violations: [] },
      structuralWarnings: [],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: diagnostics,
      strategyAcceptability: acceptability,
    };
  }

  const l1Eligibility = layer1_funnelEligibilityDetection(audience, offer);
  diagnostics.layer1 = { eligible: l1Eligibility.eligible, score: l1Eligibility.eligibilityScore, reasons: l1Eligibility.reasons };

  const l2Fit = layer2_offerToFunnelFit(offer, audience, productDna, strategic);
  diagnostics.layer2 = { funnelType: l2Fit.funnelType, fitScore: l2Fit.fitScore, rationale: l2Fit.rationale };

  if (awareness) {
    diagnostics.awarenessBinding = {
      stage: awareness.awarenessStage,
      entryMechanism: awareness.entryMechanism,
      triggerClass: awareness.triggerClass,
      trustState: awareness.trustState,
      awarenessRoute: awareness.awarenessRoute,
      score: awareness.awarenessStrengthScore,
    };
  }

  const l3Friction = layer3_audienceFrictionModeling(audience, l2Fit.funnelType);
  diagnostics.layer3 = { frictionPoints: l3Friction.frictionPoints.length, score: l3Friction.audienceFrictionScore };

  const awarenessStage = awareness?.awarenessStage || audience.awarenessLevel || "problem_aware";

  const l4Trust = layer4_trustPathConstruction(audience, differentiation, l2Fit.funnelType);
  diagnostics.layer4 = { steps: l4Trust.trustPath.length, score: l4Trust.trustPathScore };

  const l6Commitment = layer6_commitmentLevelMatching(audience, offer, l2Fit.funnelType);
  diagnostics.layer6 = { level: l6Commitment.commitmentLevel, score: l6Commitment.commitmentMatchScore, analysis: l6Commitment.analysis };

  let aiFunnels: any;
  let funnelDepthRejectionContext = "";
  const funnelDepthGateLog: string[] = [];
  const funnelDepthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES + 1;

  try {
    aiFunnels = await aiFunnelGeneration(audience, offer, positioning, differentiation, accountId, mi, awareness, analyticalEnrichment, undefined, strategic || null, productDna || null, 1);
    diagnostics.aiGeneration = { success: true };
  } catch (err: any) {
    const reason = (err && (err.originalMessage || err.message)) || "unknown AI failure";
    diagnostics.aiGeneration = { success: false, error: reason };
    const emptyFunnel = buildEmptyFunnel();
    const acceptability = assessStrategyAcceptability(0, 0, 8, false, [`AI funnel generation failed: ${reason}`]);
    console.log(`[FunnelEngine-V3] AI_DEGRADED | reason="${reason}" | returning empty funnel + structuralWarning`);
    return {
      status: STATUS.AI_DEGRADED,
      statusMessage: `AI funnel generation failed: ${reason}`,
      primaryFunnel: emptyFunnel,
      alternativeFunnel: emptyFunnel,
      rejectedFunnel: { funnel: emptyFunnel, rejectionReason: "AI generation failed — no candidates produced" },
      funnelStrengthScore: 0,
      trustPathAnalysis: { score: 0, steps: 0, gaps: ["AI generation failed — trust path not constructed"] },
      proofPlacementLogic: { score: 0, placements: 0, missingPlacements: ["AI generation failed — proof placements not computed"] },
      frictionMap: { totalFriction: 1, criticalPoints: 0, mitigations: 0 },
      boundaryCheck: { passed: true, violations: [] },
      structuralWarnings: [
        `AI_FUNNEL_GENERATION_FAILED: ${reason}`,
        "Funnel result is empty — downstream consumers MUST treat status=AI_DEGRADED as non-executable.",
      ],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: diagnostics,
      strategyAcceptability: acceptability,
    };
  }

  const primaryLane = (audience as any).laneContext
    || ((audience as any).approvedLanes || []).find((l: any) => l.isPrimary)
    || ((audience as any).approvedLanes || [])[0];
  const laneObjections: string[] = Array.isArray(primaryLane?.objections)
    ? primaryLane.objections.map((o: any) => typeof o === "string" ? o : (o.canonical || o.statement || o.objection || String(o)))
    : (Array.isArray(primaryLane?.associatedObjections) ? primaryLane.associatedObjections : []);
  const mechanismSteps: string[] = Array.isArray(differentiation.mechanismCore?.mechanismSteps)
    ? differentiation.mechanismCore!.mechanismSteps
    : [];

  let primaryGeneratedStages: FunnelStage[] = [];
  try {
    const preMatrix = applyAwarenessPriorityMatrix(aiFunnels.primary.type, awareness, audience, offer);
    primaryGeneratedStages = await aiStageLayoutGeneration(
      preMatrix.finalType,
      awarenessStage,
      offer,
      accountId,
      {
        funnelName: aiFunnels.primary.name,
        journeyRationale: aiFunnels.primary.journeyRationale,
        mechanismSteps,
        laneObjections,
      },
    );
    diagnostics.aiStageLayout = { success: primaryGeneratedStages.length > 0, stageCount: primaryGeneratedStages.length };
  } catch (stageErr: any) {
    console.warn(`[FunnelEngine-V3] AI_STAGE_LAYOUT_FALLBACK | reason="${stageErr?.message || stageErr}" — using structured stage fallback`);
    diagnostics.aiStageLayout = { success: false, error: stageErr?.message || String(stageErr) };
  }

  const l5Proof = layer5_proofPlacementLogic(
    differentiation,
    primaryGeneratedStages.length > 0 ? primaryGeneratedStages : buildStageMap(l2Fit.funnelType, awarenessStage, offer),
  );
  diagnostics.layer5 = { placements: l5Proof.proofPlacements.length, score: l5Proof.proofPlacementScore, missing: l5Proof.missingPlacements };

  let primaryFunnel!: FunnelCandidate;
  let alternativeFunnel!: FunnelCandidate;
  let rejectedFunnel!: FunnelCandidate;
  const buildAllFunnels = () => {
    primaryFunnel = buildFunnelCandidate(
      aiFunnels.primary.name, aiFunnels.primary.type,
      audience, offer, positioning, differentiation, awareness,
      primaryGeneratedStages,
    );
    if (Array.isArray(aiFunnels.primary.journeyRationale) && aiFunnels.primary.journeyRationale.length > 0) {
      primaryFunnel.groundedJourneyRationale = aiFunnels.primary.journeyRationale;
      primaryFunnel.whyThisJourney = aiFunnels.primary.journeyRationale.join(" ");
    } else {
      primaryFunnel.groundedJourneyRationale = [];
      primaryFunnel.whyThisJourney = "";
      console.error("[FunnelEngine-V3] FUNNEL_RATIONALE_MISSING | primary funnel built without grounded journey rationale — depth grounding will score the deterministic structure only");
    }
    diagnostics.layer7_primary = primaryFunnel.integrityResult;
    diagnostics.layer8_primary = { strength: primaryFunnel.funnelStrengthScore };
    diagnostics.entryTrigger_primary = primaryFunnel.entryTrigger;
    diagnostics.compression_primary = { applied: primaryFunnel.compressionApplied, stages: primaryFunnel.stageMap.length };
    diagnostics.priorityMatrix_primary = primaryFunnel.priorityMatrixDecision;

    alternativeFunnel = buildFunnelCandidate(
      aiFunnels.alternative.name, aiFunnels.alternative.type,
      audience, offer, positioning, differentiation, awareness,
    );
    diagnostics.layer7_alternative = alternativeFunnel.integrityResult;
    diagnostics.layer8_alternative = { strength: alternativeFunnel.funnelStrengthScore };
    diagnostics.priorityMatrix_alternative = alternativeFunnel.priorityMatrixDecision;

    rejectedFunnel = buildFunnelCandidate(
      aiFunnels.rejected.name, aiFunnels.rejected.type,
      audience, offer, positioning, differentiation, awareness,
    );
    diagnostics.layer7_rejected = rejectedFunnel.integrityResult;
  };
  buildAllFunnels();

  const collectFunnelText = (f: FunnelCandidate) => [
    f.funnelName, f.funnelType, f.commitmentLevel,
    f.entryTrigger.mechanismType, f.entryTrigger.purpose,
    ...f.stageMap.map(s => `${s.name} ${s.purpose} ${(s as any).coreMessage || ""} ${s.contentType} ${s.conversionGoal} ${s.cta || ""}`),
    ...f.trustPath.map(t => `${t.action} ${t.proofType} ${t.audienceState}`),
    ...f.proofPlacements.map(p => `${p.stage} ${p.proofType} ${p.placement} ${p.purpose}`),
    ...f.frictionMap.map(fp => `${fp.stage} ${fp.frictionType} ${fp.mitigation}`),
    ...f.groundedJourneyRationale,
  ];
  // FIX-A: all cross-funnel state (boundary + sanitize + generic penalty + status
  // + cross-engine alignment + trust-path gaps + critical friction) is derived from
  // the CURRENT primary/alternative/rejected funnels. Extracted into a closure so it
  // can be recomputed after a depth-gate rebuild — a retry that passes then returns
  // state matching the funnel actually scored, never attempt-1 state stamped onto a
  // rebuilt funnel (that would be fake success). l1..l6/dataReliability stay outside:
  // they derive from stable engine inputs, not the LLM selection, so never go stale.
  let boundaryCheck!: { passed: boolean; violations: string[] };
  let genericOutputCheck!: ReturnType<typeof detectGenericOutput>;
  let status: string = STATUS.COMPLETE;
  let statusMessage: string | null = null;
  let structuralWarnings: string[] = [];
  let alignmentResult!: ReturnType<typeof checkCrossEngineAlignment>;
  let trustPathGaps: string[] = [];
  let criticalFrictionPoints = 0;
  const deriveFunnelState = () => {
  const allFunnelText = [
    ...collectFunnelText(primaryFunnel),
    ...collectFunnelText(alternativeFunnel),
    ...collectFunnelText(rejectedFunnel),
    aiFunnels.rejected.rejectionReason || "",
  ].join(" ");
  const boundaryResult = enforceBoundaryWithSanitization(allFunnelText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  boundaryCheck = { passed: boundaryResult.clean, violations: boundaryResult.violations };
  diagnostics.boundaryCheck = boundaryCheck;
  if (boundaryResult.sanitized && boundaryResult.warnings.length > 0) {
    console.log(`[FunnelEngine-V3] BOUNDARY SANITIZED: ${boundaryResult.warnings.join("; ")}`);
    diagnostics.boundarySanitization = { sanitized: boundaryResult.sanitized, warnings: boundaryResult.warnings };
    const sanitizeFunnel = (f: FunnelCandidate) => {
      f.funnelName = applySoftSanitization(f.funnelName, BOUNDARY_SOFT_PATTERNS);
      f.entryTrigger.purpose = applySoftSanitization(f.entryTrigger.purpose, BOUNDARY_SOFT_PATTERNS);
      for (const s of f.stageMap) {
        s.purpose = applySoftSanitization(s.purpose, BOUNDARY_SOFT_PATTERNS);
        s.conversionGoal = applySoftSanitization(s.conversionGoal, BOUNDARY_SOFT_PATTERNS);
      }
      for (const t of f.trustPath) {
        t.action = applySoftSanitization(t.action, BOUNDARY_SOFT_PATTERNS);
      }
      for (const p of f.proofPlacements) {
        p.purpose = applySoftSanitization(p.purpose, BOUNDARY_SOFT_PATTERNS);
      }
      for (const fp of f.frictionMap) {
        fp.mitigation = applySoftSanitization(fp.mitigation, BOUNDARY_SOFT_PATTERNS);
      }
      f.groundedJourneyRationale = f.groundedJourneyRationale.map(r => applySoftSanitization(r, BOUNDARY_SOFT_PATTERNS));
    };
    sanitizeFunnel(primaryFunnel);
    sanitizeFunnel(alternativeFunnel);
    sanitizeFunnel(rejectedFunnel);
  }

  genericOutputCheck = detectGenericOutput(allFunnelText);
  diagnostics.genericOutputCheck = genericOutputCheck;
  if (genericOutputCheck.genericDetected) {
    primaryFunnel.funnelStrengthScore = clamp(primaryFunnel.funnelStrengthScore - genericOutputCheck.penalty);
    alternativeFunnel.funnelStrengthScore = clamp(alternativeFunnel.funnelStrengthScore - genericOutputCheck.penalty);
    console.log(`[FunnelEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  status = STATUS.COMPLETE;
  statusMessage = null;
  structuralWarnings = [];

  if (!boundaryCheck.passed) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Boundary violation — cross-engine output detected: ${boundaryCheck.violations.join("; ")}`;
    console.log(`[FunnelEngine-V3] BOUNDARY_VIOLATION | ${boundaryCheck.violations.join("; ")}`);
  }

  if (status === STATUS.COMPLETE && !primaryFunnel.integrityResult.passed) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Integrity check failed: ${primaryFunnel.integrityResult.failures.join("; ")}`;
  }

  const funnelCommitmentMap: Record<string, string> = {
      direct: "high", webinar: "medium", challenge: "medium", vsl: "medium",
      application: "very_high", consultation: "very_high", tripwire: "micro",
      "product-launch": "low", membership: "high", hybrid: "medium",
    };
    const commitmentLevelOrder: Record<string, number> = {
      micro: 1, low: 2, medium: 3, high: 4, very_high: 5,
    };
    const awarenessReadinessMap: Record<string, number> = {
      unaware: 1, problem_aware: 2, solution_aware: 3, product_aware: 4, most_aware: 5,
    };

    const funnelRequiredCommitment = funnelCommitmentMap[primaryFunnel.funnelType] || "medium";
    const offerCommitmentLevel = offer.frictionLevel > 0.7 ? "very_high" : offer.frictionLevel > 0.5 ? "high" : offer.frictionLevel > 0.3 ? "medium" : "low";
    const funnelCommitmentNum = commitmentLevelOrder[funnelRequiredCommitment] || 3;
    const offerCommitmentNum = commitmentLevelOrder[offerCommitmentLevel] || 3;
    const commitmentGap = Math.abs(funnelCommitmentNum - offerCommitmentNum);

    const audienceReadinessStage = awareness?.awarenessStage || audience.awarenessLevel || "problem_aware";
    const audienceReadinessNum = awarenessReadinessMap[audienceReadinessStage] || 2;
    const funnelMinReadiness = primaryFunnel.funnelType === "direct" || primaryFunnel.funnelType === "application" ? 4
      : primaryFunnel.funnelType === "tripwire" || primaryFunnel.funnelType === "product-launch" ? 2
      : 3;
    const readinessGap = funnelMinReadiness - audienceReadinessNum;

    alignmentResult = checkCrossEngineAlignment([
      {
        name: "offer_commitment_alignment",
        aligned: commitmentGap <= 1,
        reason: commitmentGap > 1
          ? `Funnel requires ${funnelRequiredCommitment} commitment but offer friction maps to ${offerCommitmentLevel} (gap: ${commitmentGap})`
          : "Funnel commitment level matches offer friction",
      },
      {
        name: "audience_readiness_alignment",
        aligned: readinessGap <= 1,
        reason: readinessGap > 1
          ? `Funnel type "${primaryFunnel.funnelType}" requires readiness level ${funnelMinReadiness} but audience is at "${awareness}" (level ${audienceReadinessNum})`
          : "Funnel type appropriate for audience readiness stage",
      },
    ]);

    if (!alignmentResult.aligned) {
      structuralWarnings.push(...alignmentResult.misalignments);
      console.log(`[FunnelEngine-V3] CROSS_ENGINE_MISALIGNMENT | ${alignmentResult.misalignments.join("; ")} | penalty=${alignmentResult.confidencePenalty.toFixed(2)}`);
    }
    diagnostics.crossEngineAlignment = alignmentResult;

    trustPathGaps = [];
  const mandatoryProofInPath = ["process_proof", "case_proof"];
  for (const required of mandatoryProofInPath) {
    if (!primaryFunnel.trustPath.some(t => t.proofType === required)) {
      trustPathGaps.push(`Missing ${required} in trust path`);
    }
  }

  criticalFrictionPoints = primaryFunnel.frictionMap.filter(f => f.severity > 0.7).length;
  };
  deriveFunnelState();

  // FIX-A: depth scorer input = the SAME full funnel composition helper used
  // everywhere else (type/name + stages + trustPath + proofPlacements + friction).
  // Previously this hand-built a partial subset with the WRONG trustPath keys
  // (t.stage/t.rationale — neither exists on a trust step), starving the scorer so
  // it read near-zero causal depth and spuriously blocked. FIX INPUTS, NOT GATES.
  let celSourceTexts: string[] = collectFunnelText(primaryFunnel);
  let celDepth = enforceEngineDepthCompliance(
    "funnel",
    celSourceTexts,
    analyticalEnrichment || null,
  );
  diagnostics.celDepthCompliance = celDepth;

  if (analyticalEnrichment && isDepthBlocking(celDepth, celSourceTexts)) {
    for (let funnelDepthAttempt = 2; funnelDepthAttempt <= funnelDepthGateMaxAttempts; funnelDepthAttempt++) {
      funnelDepthGateLog.push(`Attempt ${funnelDepthAttempt - 1}: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length})`);
      funnelDepthRejectionContext = buildDepthRejectionDirective(celDepth, funnelDepthAttempt - 1);
      console.log(`[FunnelEngine-V3] DEPTH_GATE: Attempt ${funnelDepthAttempt - 1} BLOCKED — regenerating (${funnelDepthAttempt}/${funnelDepthGateMaxAttempts})`);

      try {
        aiFunnels = await aiFunnelGeneration(audience, offer, positioning, differentiation, accountId, mi, awareness, analyticalEnrichment, funnelDepthRejectionContext, strategic || null, productDna || null, funnelDepthAttempt);
        diagnostics.aiGeneration = { success: true, depthRetry: funnelDepthAttempt };
      } catch (err: any) {
        funnelDepthGateLog.push(`Attempt ${funnelDepthAttempt}: AI_ERROR (${err.message})`);
        continue;
      }

      // FIX-A: rebuild the FULL funnel from the regenerated selection and re-derive
      // all cross-funnel state, so the retry is scored on the identical composition
      // as attempt 1 AND the funnel that passes is the funnel we return.
      buildAllFunnels();
      deriveFunnelState();
      celSourceTexts = collectFunnelText(primaryFunnel);
      celDepth = enforceEngineDepthCompliance(
        "funnel",
        celSourceTexts,
        analyticalEnrichment || null,
      );
      diagnostics.celDepthCompliance = celDepth;

      if (!isDepthBlocking(celDepth, celSourceTexts)) {
        funnelDepthGateLog.push(`Attempt ${funnelDepthAttempt}: PASSED (depthScore=${celDepth.causalDepthScore})`);
        console.log(`[FunnelEngine-V3] DEPTH_GATE: Attempt ${funnelDepthAttempt} PASSED | depthScore=${celDepth.causalDepthScore}`);
        break;
      }

      if (funnelDepthAttempt >= funnelDepthGateMaxAttempts) {
        funnelDepthGateLog.push(`Attempt ${funnelDepthAttempt}: FINAL FAILURE (depthScore=${celDepth.causalDepthScore})`);
        const depthGateResult = buildDepthGateResult(celDepth, funnelDepthAttempt, funnelDepthGateMaxAttempts, funnelDepthGateLog, celSourceTexts);
        console.log(`[FunnelEngine-V3] DEPTH_GATE: FINAL FAILURE after ${funnelDepthGateMaxAttempts} attempts — returning DEPTH_FAILED`);
        return {
          status: "DEPTH_FAILED",
          statusMessage: `Depth gate failed after ${funnelDepthGateMaxAttempts} attempts: depthScore=${celDepth.causalDepthScore}`,
          primaryFunnel: buildEmptyFunnel("DEPTH_FAILED"),
          alternativeFunnel: buildEmptyFunnel("DEPTH_FAILED_ALT"),
          rejectedFunnel: { funnel: buildEmptyFunnel("DEPTH_FAILED_REJECTED"), rejectionReason: "DEPTH_FAILED" },
          funnelStrengthScore: 0,
          trustPathAnalysis: { score: 0, steps: 0, gaps: ["DEPTH_FAILED"] },
          proofPlacementLogic: { score: 0, placements: 0, missingPlacements: [] },
          frictionMap: { totalFriction: 0, criticalPoints: 0, mitigations: 0 },
          boundaryCheck: { passed: false, violations: ["DEPTH_FAILED"] },
          structuralWarnings: ["DEPTH_FAILED"],
          confidenceScore: 0,
          executionTimeMs: Date.now() - startTime,
          engineVersion: ENGINE_VERSION,
          layerDiagnostics: diagnostics,
          strategyAcceptability: { grade: "F", acceptable: false, reasons: ["DEPTH_FAILED"] },
        } as unknown as FunnelResult;
      }
    }
  }

  if (celDepth.violations.length > 0) {
    for (const logEntry of celDepth.enforcementLog) {
      console.log(`[FunnelEngine-V3] CEL_DEPTH: ${logEntry}`);
    }
  } else {
    console.log(`[FunnelEngine-V3] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
  }
  const depthGateResultFunnel = funnelDepthGateLog.length > 0 ? buildDepthGateResult(celDepth, funnelDepthGateLog.length, funnelDepthGateMaxAttempts, funnelDepthGateLog, celSourceTexts) : null;
  diagnostics.depthGate = depthGateResultFunnel;
  const depthPenaltyFactor = celDepth.passed ? 1.0 : Math.max(0.5, celDepth.score);

  const rawConfidence = clamp(
    primaryFunnel.funnelStrengthScore *
    (boundaryCheck.passed ? 1 : 0) *
    (primaryFunnel.integrityResult.passed ? 1 : 0.6) *
    (l1Eligibility.eligible ? 1 : 0.5) *
    (genericOutputCheck.genericDetected ? (1 - genericOutputCheck.penalty) : 1) *
    (1 - alignmentResult.confidencePenalty) *
    depthPenaltyFactor
  );
  const confidenceScore = normalizeConfidence(rawConfidence, dataReliability);
  const confidenceNormalized = rawConfidence !== confidenceScore;
  diagnostics.confidenceNormalized = confidenceNormalized;
  if (confidenceNormalized) {
    diagnostics.rawConfidence = rawConfidence;
  }

  const layersPassed = [
    l1Eligibility.eligible,
    l2Fit.fitScore >= 0.4,
    l3Friction.audienceFrictionScore >= 0.3,
    l4Trust.trustPathScore >= 0.3,
    l5Proof.proofPlacementScore >= 0.3,
    l6Commitment.commitmentMatchScore >= 0.4,
    primaryFunnel.integrityResult.passed,
    boundaryCheck.passed,
  ].filter(Boolean).length;
  const acceptability = assessStrategyAcceptability(
    confidenceScore, layersPassed, 8,
    primaryFunnel.integrityResult.passed && boundaryCheck.passed,
    structuralWarnings,
  );
  diagnostics.strategyAcceptability = acceptability;

  const pmDecision = primaryFunnel.priorityMatrixDecision;
  console.log(`[FunnelEngine-V3] Complete | status=${status} | type=${primaryFunnel.funnelType} | strength=${primaryFunnel.funnelStrengthScore.toFixed(2)} | confidence=${confidenceScore.toFixed(2)} | grade=${acceptability.grade} | generic=${primaryFunnel.genericFlag} | boundary=${boundaryCheck.passed} | alignmentWarnings=${structuralWarnings.length} | priorityMatrix=${pmDecision ? `P${pmDecision.decidingPriority}(${pmDecision.decidingPriorityName})` : 'none'} | overridden=${pmDecision?.wasOverridden ?? false} | blocked=${pmDecision?.blockedFunnels?.length ?? 0}`);

  const resolvedLaneId = audience?.laneId || audience?.laneContext?.laneId || (strategic as any)?.laneId;
  const resolvedPrimaryCorePainId = audience?.laneContext?.primaryCorePainId || (strategic as any)?.corePainId;
  const resolvedSegmentIds = audience?.laneContext?.segmentIds;
  const resolvedLaneLabel = audience?.laneContext?.title;

  if (resolvedLaneId) {
    primaryFunnel.laneId = resolvedLaneId;
    if (resolvedLaneLabel) primaryFunnel.laneLabel = resolvedLaneLabel;
    if (resolvedPrimaryCorePainId) primaryFunnel.primaryCorePainId = resolvedPrimaryCorePainId;
    if (resolvedSegmentIds) primaryFunnel.segmentIds = resolvedSegmentIds;
  }

  return {
    laneId: resolvedLaneId,
    primaryCorePainId: resolvedPrimaryCorePainId,
    segmentIds: resolvedSegmentIds,
    status,
    statusMessage,
    primaryFunnel,
    alternativeFunnel,
    rejectedFunnel: { funnel: rejectedFunnel, rejectionReason: aiFunnels.rejected.rejectionReason },
    funnelStrengthScore: primaryFunnel.funnelStrengthScore,
    trustPathAnalysis: {
      score: primaryFunnel.trustPathScore,
      steps: primaryFunnel.trustPath.length,
      gaps: trustPathGaps,
    },
    proofPlacementLogic: {
      score: primaryFunnel.proofPlacementScore,
      placements: primaryFunnel.proofPlacements.length,
      missingPlacements: l5Proof.missingPlacements,
    },
    frictionMap: {
      totalFriction: primaryFunnel.frictionMap.reduce((s, f) => s + f.severity, 0),
      criticalPoints: criticalFrictionPoints,
      mitigations: primaryFunnel.frictionMap.filter(f => f.mitigation).length,
    },
    boundaryCheck,
    structuralWarnings,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    layerDiagnostics: diagnostics,
    strategyAcceptability: acceptability,
  };
}
