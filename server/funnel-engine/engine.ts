import { aiChat } from "../ai-client";
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

  if (offer.completeness.complete) {
    score += 0.25;
    reasons.push("Offer construction complete");
  } else {
    reasons.push(`Offer incomplete: ${offer.completeness.missingLayers.join(", ")}`);
  }

  if (offer.offerStrengthScore > 0.5) {
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
): { funnelType: string; fitScore: number; rationale: string } {
  const awareness = audience.awarenessLevel || "problem_aware";
  const maturity = typeof audience.maturityIndex === "number" ? audience.maturityIndex : (Number(audience.maturityIndex) || 0.5);
  const offerStrength = offer.offerStrengthScore;

  const candidateTypes = AWARENESS_TO_FUNNEL_MAP[awareness] || AWARENESS_TO_FUNNEL_MAP["problem_aware"];

  let funnelType = candidateTypes[0];
  let fitScore = 0.5;

  if (offerStrength > 0.7 && maturity > 0.6) {
    funnelType = "direct";
    fitScore = 0.85;
  } else if (offerStrength > 0.5 && offer.deliverables.length > 3) {
    funnelType = candidateTypes.includes("webinar") ? "webinar" : candidateTypes[0];
    fitScore = 0.7;
  } else if (offer.frictionLevel > 0.6) {
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
    if (asset.category) availableProofTypes.add(asset.category);
  }

  for (const pillar of differentiation.pillars || []) {
    for (const p of pillar.supportingProof || []) {
      availableProofTypes.add(p);
    }
  }

  const placementMap: Record<string, { proofType: string; purpose: string }[]> = {
    entry: [
      { proofType: "transparency_proof", purpose: "Build initial credibility" },
      { proofType: "case_proof", purpose: "Show social proof at entry" },
    ],
    education: [
      { proofType: "process_proof", purpose: "Demonstrate methodology" },
      { proofType: "framework_proof", purpose: "Show structured approach" },
    ],
    consideration: [
      { proofType: "outcome_proof", purpose: "Provide outcome evidence" },
      { proofType: "case_proof", purpose: "Reinforce with case studies" },
    ],
    decision: [
      { proofType: "comparative_proof", purpose: "Show competitive advantage" },
      { proofType: "outcome_proof", purpose: "Final outcome validation" },
    ],
    conversion: [
      { proofType: "transparency_proof", purpose: "Remove final objections" },
      { proofType: "case_proof", purpose: "Last-mile social proof" },
    ],
  };

  const missingPlacements: string[] = [];

  for (const stage of stages) {
    const stageName = stage.name.toLowerCase();
    const mappings = placementMap[stageName] || placementMap["consideration"] || [];

    for (const mapping of mappings) {
      if (availableProofTypes.has(mapping.proofType)) {
        proofPlacements.push({
          stage: stage.name,
          proofType: mapping.proofType,
          placement: `${mapping.proofType} at ${stage.name} stage`,
          purpose: mapping.purpose,
        });
      } else {
        missingPlacements.push(`Missing ${mapping.proofType} at ${stage.name}`);
      }
    }
  }

  const totalPossible = stages.length * 2;
  const proofPlacementScore = totalPossible > 0
    ? clamp(proofPlacements.length / totalPossible)
    : 0.2;

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

  const requiredLevel = funnelCommitmentRequirement[funnelType] || "medium";
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
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  funnelType: string,
  awarenessInput?: FunnelAwarenessInput | null,
): EntryTrigger {
  const awarenessStage = awarenessInput?.awarenessStage || audience.awarenessLevel || "problem_aware";
  const maturity = typeof audience.maturityIndex === "number" ? audience.maturityIndex : (Number(audience.maturityIndex) || 0.5);
  const offerComplexity = offer.deliverables.length > 5 ? "high" : offer.deliverables.length > 2 ? "medium" : "low";
  const buyerFriction = offer.frictionLevel;
  const objectionCount = Object.keys(audience.objectionMap || {}).length;

  const candidateMechanism = selectBaseEntryMechanism(awarenessStage, maturity, offerComplexity, buyerFriction, objectionCount, funnelType);

  if (!awarenessInput) {
    return {
      mechanismType: candidateMechanism.type,
      purpose: candidateMechanism.purpose,
    };
  }

  const route = awarenessInput.awarenessRoute || "";
  const triggerClass = awarenessInput.triggerClass || "";
  const trustState = awarenessInput.trustState || "";

  const allBlocked = new Set<string>();
  const allAllowed = new Set<string>(ENTRY_MECHANISM_TYPES);
  let enforcedBy = "none";

  const routeMapping = AWARENESS_ROUTE_TO_ENTRY_MECHANISMS[route];
  if (routeMapping) {
    routeMapping.blocked.forEach(m => allBlocked.add(m));
    const routeAllowed = new Set(routeMapping.allowed);
    for (const m of allAllowed) {
      if (!routeAllowed.has(m)) {
        allBlocked.add(m);
        allAllowed.delete(m);
      }
    }
    enforcedBy = `route:${route}`;
  }

  const triggerMapping = TRIGGER_CLASS_TO_ENTRY_MECHANISMS[triggerClass];
  if (triggerMapping) {
    triggerMapping.blocked.forEach(m => {
      allBlocked.add(m);
      allAllowed.delete(m);
    });
  }

  const trustOverride = TRUST_STATE_ENTRY_OVERRIDES[trustState];
  if (trustOverride) {
    trustOverride.blocked.forEach(m => {
      allBlocked.add(m);
      allAllowed.delete(m);
    });
  }

  if (awarenessStage === "unaware") {
    allBlocked.add("challenge");
    allBlocked.add("discovery");
    allAllowed.delete("challenge");
    allAllowed.delete("discovery");
  }

  const allowedArr = Array.from(allAllowed);
  const blockedArr = Array.from(allBlocked);
  const needsOverride = !allAllowed.has(candidateMechanism.type);
  let finalType = candidateMechanism.type;
  let selectionReason = "Base selection passed awareness constraints";

  if (needsOverride) {
    const preferred = triggerMapping?.preferred || [];
    const preferredAllowed = preferred.filter(p => allAllowed.has(p));
    if (preferredAllowed.length > 0) {
      finalType = preferredAllowed[0];
      selectionReason = `Base "${candidateMechanism.type}" blocked by awareness — selected preferred "${finalType}" from trigger_class "${triggerClass}"`;
    } else if (allowedArr.length > 0) {
      finalType = allowedArr[0];
      selectionReason = `Base "${candidateMechanism.type}" blocked by awareness — fell back to allowed "${finalType}"`;
    } else {
      finalType = "content_education";
      selectionReason = `All mechanisms blocked — safe fallback to content_education`;
    }
    if (!enforcedBy.startsWith("route:")) {
      enforcedBy = triggerClass ? `trigger:${triggerClass}` : trustState ? `trust:${trustState}` : `stage:${awarenessStage}`;
    }
    console.log(`[FunnelEngine-V3] ENTRY_TRIGGER_OVERRIDE | original=${candidateMechanism.type} → final=${finalType} | ${selectionReason}`);
  }

  const purposeMap: Record<string, string> = {
    content_education: "Provide foundational education to establish problem awareness before introducing the solution framework",
    audit: "Allow prospects to evaluate their current state against a structured assessment before entering the conversion path",
    diagnostic: "Enable prospects to identify their specific bottleneck or gap before presenting the solution mechanism",
    challenge: "Guide prospects through a structured experience that demonstrates capability and builds commitment progressively",
    discovery: "Allow prospects to explore the solution approach at their own pace and self-qualify for the next conversion step",
  };

  return {
    mechanismType: finalType,
    purpose: needsOverride ? purposeMap[finalType] || candidateMechanism.purpose : candidateMechanism.purpose,
    awarenessEnforcement: {
      enforcedBy,
      awarenessRoute: route,
      triggerClass,
      trustState,
      originalMechanism: candidateMechanism.type,
      finalMechanism: finalType,
      wasOverridden: needsOverride,
      allowedMechanisms: allowedArr,
      blockedMechanisms: blockedArr,
      selectionReason,
    },
  };
}

function selectBaseEntryMechanism(
  awareness: string,
  maturity: number,
  offerComplexity: string,
  buyerFriction: number,
  objectionCount: number,
  funnelType: string,
): { type: string; purpose: string } {
  if (awareness === "unaware" || (maturity < 0.3 && objectionCount > 3)) {
    return {
      type: "content_education",
      purpose: "Provide foundational education to establish problem awareness before introducing the solution framework",
    };
  }
  if (offerComplexity === "high" && buyerFriction > 0.6) {
    return {
      type: "audit",
      purpose: "Allow prospects to evaluate their current state against a structured assessment before entering the conversion path",
    };
  }
  if (awareness === "problem_aware" && maturity < 0.5) {
    return {
      type: "diagnostic",
      purpose: "Enable prospects to identify their specific bottleneck or gap before presenting the solution mechanism",
    };
  }
  if (funnelType === "challenge" || (maturity >= 0.4 && maturity < 0.7 && buyerFriction < 0.5)) {
    return {
      type: "challenge",
      purpose: "Guide prospects through a structured experience that demonstrates capability and builds commitment progressively",
    };
  }
  return {
    type: "discovery",
    purpose: "Allow prospects to explore the solution approach at their own pace and self-qualify for the next conversion step",
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

function buildStageMap(funnelType: string, awareness: string): FunnelStage[] {
  const stages: FunnelStage[] = [];

  if (awareness === "unaware" || awareness === "problem_aware") {
    stages.push({
      name: "entry",
      purpose: "Capture attention and establish problem awareness",
      contentType: "educational_content",
      conversionGoal: "opt_in",
    });
  }

  stages.push({
    name: "education",
    purpose: "Build understanding of the solution approach",
    contentType: "mechanism_demonstration",
    conversionGoal: "engagement",
  });

  if (funnelType === "webinar" || funnelType === "challenge") {
    stages.push({
      name: "engagement",
      purpose: funnelType === "webinar" ? "Deliver value through live presentation" : "Guide through structured challenge",
      contentType: funnelType === "webinar" ? "webinar_content" : "challenge_content",
      conversionGoal: "commitment",
    });
  }

  stages.push({
    name: "consideration",
    purpose: "Present proof and build conviction",
    contentType: "proof_content",
    conversionGoal: "intent",
  });

  stages.push({
    name: "decision",
    purpose: "Remove final objections and present offer",
    contentType: "offer_presentation",
    conversionGoal: "decision",
  });

  stages.push({
    name: "conversion",
    purpose: "Facilitate commitment and purchase",
    contentType: "conversion_content",
    conversionGoal: "purchase",
  });

  return stages;
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
  const trustState = awareness?.trustState || "";
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
  const highTrust = trustState === "high" || trustState === "very_high" || trustState === "critical"
    || entryMechanism === "trust_repair_entry" || entryMechanism === "proof_led_entry";
  if (highTrust && awareness) {
    for (const ft of TRUST_LIGHT_FUNNELS) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p2Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 2, reason: `Trust requirement "${trustState}" blocks low-trust funnel "${ft}"` });
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
  if (LOW_READINESS_STAGES.includes(awarenessStage) && awareness) {
    const lowReadinessBlocked = ["direct", "application", "tripwire"];
    for (const ft of lowReadinessBlocked) {
      if (eligible.has(ft)) {
        eligible.delete(ft);
        p3Blocked.push(ft);
        blocked.push({ funnelType: ft, blockedByPriority: 3, reason: `Low readiness stage "${awarenessStage}" blocks high-commitment funnel "${ft}"` });
      }
    }
    if (!eligible.has(proposedType) && decidingPriority > 3) {
      decidingPriority = 3;
      decidingPriorityName = "Awareness Stage";
    }
  } else if (HIGH_READINESS_STAGES.includes(awarenessStage) && awareness) {
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

  layers.push({
    priority: 6, name: "Offer Fit", action: "Final refinement by offer characteristics",
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

function buildFunnelCandidate(
  name: string,
  funnelType: string,
  audience: FunnelAudienceInput,
  offer: FunnelOfferInput,
  positioning: FunnelPositioningInput,
  differentiation: FunnelDifferentiationInput,
  awarenessInput?: FunnelAwarenessInput | null,
): FunnelCandidate {
  const matrixDecision = applyAwarenessPriorityMatrix(funnelType, awarenessInput, audience, offer);
  const effectiveType = matrixDecision.finalType;

  if (matrixDecision.wasOverridden) {
    console.log(`[FunnelEngine-V3] CANDIDATE_OVERRIDE | "${name}" type ${funnelType} → ${effectiveType} | P${matrixDecision.decidingPriority} (${matrixDecision.decidingPriorityName})`);
  }

  const awarenessStageStr = awarenessInput?.awarenessStage || audience.awarenessLevel || "problem_aware";
  const rawStageMap = buildStageMap(effectiveType, awarenessStageStr);
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
    priorityMatrixDecision: matrixDecision,
  };

  const integrityResult = layer7_funnelIntegrityGuard(candidate, audience, offer, positioning, differentiation);
  candidate.integrityResult = integrityResult;

  candidate.funnelStrengthScore = layer8_funnelStrengthScoring(candidate);

  if (wasCompressed) {
    candidate.funnelStrengthScore = clamp(candidate.funnelStrengthScore * 0.9);
  }

  if (matrixDecision.wasOverridden) {
    candidate.funnelStrengthScore = clamp(candidate.funnelStrengthScore * 0.95);
  }

  return candidate;
}

function buildEmptyFunnel(): FunnelCandidate {
  return {
    funnelName: "No Funnel",
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
): Promise<{ primary: { name: string; type: string }; alternative: { name: string; type: string }; rejected: { name: string; type: string; rejectionReason: string } }> {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const pillars = differentiation.pillars || [];
  const mechanism = differentiation.mechanismFraming || {};
  const core = differentiation.mechanismCore;

  const mechanismCoreBlock = core && core.mechanismType !== "none" && core.mechanismName
    ? `\n- MECHANISM CORE (single source of truth):
  - Name: ${core.mechanismName}
  - Type: ${core.mechanismType}
  - Steps: ${core.mechanismSteps.join(" → ")}
  - Funnel stages MUST align with mechanism steps`
    : "";

  const matrixPreFilter = awarenessCtx
    ? applyAwarenessPriorityMatrix("webinar", awarenessCtx, audience, offer)
    : null;
  const eligibleTypesBlock = matrixPreFilter
    ? `\n\nAWARENESS-COMPATIBLE FUNNEL TYPES (you MUST select from these):
${matrixPreFilter.eligibleFunnels.join(", ")}

BLOCKED FUNNEL TYPES (do NOT use these):
${matrixPreFilter.blockedFunnels.map(b => `${b.funnelType} — ${b.reason}`).join("\n")}

AWARENESS CONTEXT (use this to guide funnel design):
- Awareness Stage: ${awarenessCtx!.awarenessStage}
- Entry Mechanism: ${awarenessCtx!.entryMechanism}
- Trigger Class: ${awarenessCtx!.triggerClass}
- Trust State: ${awarenessCtx!.trustState}
- Awareness Route: ${awarenessCtx!.awarenessRoute}
- Awareness Strength: ${awarenessCtx!.awarenessStrengthScore.toFixed(2)}

CRITICAL: The funnel type MUST be compatible with the detected awareness route. A ${awarenessCtx!.entryMechanism} entry mechanism requires a funnel that supports ${awarenessCtx!.trustState} trust building.`
    : "";

  const prompt = `You are a Funnel Architect. Generate three funnel concepts based on the market intelligence below.

STRICT RULES:
- Do NOT generate strategy decisions, strategic repositioning, offer redesign, pricing logic, budget recommendations, channel selection, media buying, awareness messaging, persuasion copy, scripts, campaign tasks, financial planning, or execution plans
- ONLY output funnel definitions: name, type (direct, webinar, challenge, vsl, application, consultation, tripwire, product-launch, membership, hybrid)
- Funnels must be specific and non-generic. Avoid "standard funnel" or "basic sales funnel"
- Each funnel must define the JOURNEY the buyer takes from awareness to commitment
- Respond with ONLY valid JSON, no markdown${mechanismCoreBlock}${eligibleTypesBlock}

Market Context:
- Offer: ${offer.offerName} — ${offer.coreOutcome}
- Top Pains: ${JSON.stringify(pains.slice(0, 5).map((p: any) => typeof p === "string" ? p : p?.pain || p?.name))}
- Top Desires: ${JSON.stringify(desires.slice(0, 5).map(([k]) => k))}
- Awareness Level: ${audience.awarenessLevel || "unknown"}
- Maturity Index: ${audience.maturityIndex ?? "unknown"}
- Differentiation Pillars: ${JSON.stringify(pillars.slice(0, 3).map((p: any) => p.name))}
- Mechanism: ${core?.mechanismLogic || mechanism.description || "No validated mechanism"}
- Enemy: ${positioning.enemyDefinition || "Not defined"}
- Narrative: ${positioning.narrativeDirection || "Not defined"}
- Offer Strength: ${offer.offerStrengthScore.toFixed(2)}
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

Return JSON:
{
  "primary": { "name": "Specific funnel name", "type": "funnel_type" },
  "alternative": { "name": "Alternative funnel name", "type": "funnel_type" },
  "rejected": { "name": "Rejected funnel name", "type": "funnel_type", "rejectionReason": "Why this funnel fails" }
}`;

  try {
    const completion = await aiChat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
      accountId,
      endpoint: "funnel-engine",
    });
    const response = completion.choices?.[0]?.message?.content || "{}";
    const cleanedResponse = response.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleanedResponse);

    return {
      primary: {
        name: parsed.primary?.name || "Primary Conversion Funnel",
        type: parsed.primary?.type || "webinar",
      },
      alternative: {
        name: parsed.alternative?.name || "Alternative Engagement Funnel",
        type: parsed.alternative?.type || "challenge",
      },
      rejected: {
        name: parsed.rejected?.name || "Rejected Generic Funnel",
        type: parsed.rejected?.type || "direct",
        rejectionReason: parsed.rejected?.rejectionReason || "Does not match audience readiness level",
      },
    };
  } catch (err: any) {
    console.error(`[FunnelEngine] AI generation failed: ${err.message}`);
    return {
      primary: { name: "Structured Conversion Journey", type: "webinar" },
      alternative: { name: "Progressive Engagement Path", type: "challenge" },
      rejected: { name: "Generic Direct Funnel", type: "direct", rejectionReason: "Generic funnel — no audience-specific journey design" },
    };
  }
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
): Promise<FunnelResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

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
    console.log(`[FunnelEngine-V3] Insufficient data — no offer or differentiation — returning red-grade adaptive fallback`);
    const emptyFunnel = buildEmptyFunnel();
    const acceptability = assessStrategyAcceptability(0, 0, 8, false, ["Offer and differentiation data insufficient"]);
    return {
      status: STATUS.INSUFFICIENT_SIGNALS,
      statusMessage: "Offer and differentiation data insufficient to construct funnel",
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

  const l2Fit = layer2_offerToFunnelFit(offer, audience);
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
  const stageMap = buildStageMap(l2Fit.funnelType, awarenessStage);

  const l4Trust = layer4_trustPathConstruction(audience, differentiation, l2Fit.funnelType);
  diagnostics.layer4 = { steps: l4Trust.trustPath.length, score: l4Trust.trustPathScore };

  const l5Proof = layer5_proofPlacementLogic(differentiation, stageMap);
  diagnostics.layer5 = { placements: l5Proof.proofPlacements.length, score: l5Proof.proofPlacementScore, missing: l5Proof.missingPlacements };

  const l6Commitment = layer6_commitmentLevelMatching(audience, offer, l2Fit.funnelType);
  diagnostics.layer6 = { level: l6Commitment.commitmentLevel, score: l6Commitment.commitmentMatchScore, analysis: l6Commitment.analysis };

  let aiFunnels;
  try {
    aiFunnels = await aiFunnelGeneration(audience, offer, positioning, differentiation, accountId, mi, awareness);
    diagnostics.aiGeneration = { success: true };
  } catch (err: any) {
    diagnostics.aiGeneration = { success: false, error: err.message };
    aiFunnels = {
      primary: { name: "Structured Conversion Journey", type: l2Fit.funnelType },
      alternative: { name: "Progressive Engagement Path", type: "challenge" },
      rejected: { name: "Generic Direct Funnel", type: "direct", rejectionReason: "Generic — no audience-specific design" },
    };
  }

  const primaryFunnel = buildFunnelCandidate(
    aiFunnels.primary.name, aiFunnels.primary.type,
    audience, offer, positioning, differentiation, awareness,
  );
  diagnostics.layer7_primary = primaryFunnel.integrityResult;
  diagnostics.layer8_primary = { strength: primaryFunnel.funnelStrengthScore };
  diagnostics.entryTrigger_primary = primaryFunnel.entryTrigger;
  diagnostics.compression_primary = { applied: primaryFunnel.compressionApplied, stages: primaryFunnel.stageMap.length };
  diagnostics.priorityMatrix_primary = primaryFunnel.priorityMatrixDecision;

  const alternativeFunnel = buildFunnelCandidate(
    aiFunnels.alternative.name, aiFunnels.alternative.type,
    audience, offer, positioning, differentiation, awareness,
  );
  diagnostics.layer7_alternative = alternativeFunnel.integrityResult;
  diagnostics.layer8_alternative = { strength: alternativeFunnel.funnelStrengthScore };
  diagnostics.priorityMatrix_alternative = alternativeFunnel.priorityMatrixDecision;

  const rejectedFunnel = buildFunnelCandidate(
    aiFunnels.rejected.name, aiFunnels.rejected.type,
    audience, offer, positioning, differentiation, awareness,
  );
  diagnostics.layer7_rejected = rejectedFunnel.integrityResult;

  const collectFunnelText = (f: FunnelCandidate) => [
    f.funnelName, f.funnelType, f.commitmentLevel,
    f.entryTrigger.mechanismType, f.entryTrigger.purpose,
    ...f.stageMap.map(s => `${s.name} ${s.purpose} ${s.contentType} ${s.conversionGoal}`),
    ...f.trustPath.map(t => `${t.action} ${t.proofType} ${t.audienceState}`),
    ...f.proofPlacements.map(p => `${p.stage} ${p.proofType} ${p.placement} ${p.purpose}`),
    ...f.frictionMap.map(fp => `${fp.stage} ${fp.frictionType} ${fp.mitigation}`),
  ];
  const allFunnelText = [
    ...collectFunnelText(primaryFunnel),
    ...collectFunnelText(alternativeFunnel),
    ...collectFunnelText(rejectedFunnel),
    aiFunnels.rejected.rejectionReason || "",
  ].join(" ");
  const boundaryResult = enforceBoundaryWithSanitization(allFunnelText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  const boundaryCheck = { passed: boundaryResult.clean, violations: boundaryResult.violations };
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
    };
    sanitizeFunnel(primaryFunnel);
    sanitizeFunnel(alternativeFunnel);
    sanitizeFunnel(rejectedFunnel);
  }

  const genericOutputCheck = detectGenericOutput(allFunnelText);
  diagnostics.genericOutputCheck = genericOutputCheck;
  if (genericOutputCheck.genericDetected) {
    primaryFunnel.funnelStrengthScore = clamp(primaryFunnel.funnelStrengthScore - genericOutputCheck.penalty);
    alternativeFunnel.funnelStrengthScore = clamp(alternativeFunnel.funnelStrengthScore - genericOutputCheck.penalty);
    console.log(`[FunnelEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  let status: string = STATUS.COMPLETE;
  let statusMessage: string | null = null;
  const structuralWarnings: string[] = [];

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

    const alignmentResult = checkCrossEngineAlignment([
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

    const trustPathGaps: string[] = [];
  const mandatoryProofInPath = ["process_proof", "case_proof"];
  for (const required of mandatoryProofInPath) {
    if (!primaryFunnel.trustPath.some(t => t.proofType === required)) {
      trustPathGaps.push(`Missing ${required} in trust path`);
    }
  }

  const criticalFrictionPoints = primaryFunnel.frictionMap.filter(f => f.severity > 0.7).length;

  const rawConfidence = clamp(
    primaryFunnel.funnelStrengthScore *
    (boundaryCheck.passed ? 1 : 0) *
    (primaryFunnel.integrityResult.passed ? 1 : 0.6) *
    (l1Eligibility.eligible ? 1 : 0.5) *
    (genericOutputCheck.genericDetected ? (1 - genericOutputCheck.penalty) : 1) *
    (1 - alignmentResult.confidencePenalty)
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

  return {
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
