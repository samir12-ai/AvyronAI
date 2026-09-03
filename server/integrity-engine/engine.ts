import {
  ENGINE_VERSION,
  STATUS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  LAYER_WEIGHTS,
} from "./constants";
import type {
  IntegrityPositioningInput,
  IntegrityDifferentiationInput,
  IntegrityAudienceInput,
  IntegrityOfferInput,
  IntegrityFunnelInput,
  IntegrityMIInput,
  LayerResult,
  IntegrityResult,
} from "./types";
import {
  assessDataReliability,
  normalizeConfidence,
  detectGenericOutput,
  enforceBoundaryWithSanitization,
  type DataReliabilityDiagnostics,
} from "../engine-hardening";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeNumber(v: any, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const parsed = Number(v);
  return isNaN(parsed) ? fallback : parsed;
}

// ── CLP-15: per-layer evidence gating ─────────────────────────────────────
// Each layer evaluator MUST early-return INSUFFICIENT_EVIDENCE when its
// declared upstream prerequisites are missing or empty. The prior shape
// (score initialised to 1.0, deductions only on present-but-conflicting
// inputs) silently produced `passed: true` for completely empty engine
// outputs — the headline finding of E-4 in `.local/plans/intelligence-
// forensic-audit.md`. D5 doctrine: never silently substitute.
const MIN_EVALUATED_BASE_LAYERS = 4;

function insufficientEvidence(layerName: string, missingDeps: string[]): LayerResult {
  return {
    layerName,
    passed: null,
    score: null,
    findings: [],
    warnings: [
      `INSUFFICIENT_EVIDENCE: cannot evaluate ${layerName}; missing upstream inputs: ${missingDeps.join(", ")}`,
    ],
    evaluationState: "INSUFFICIENT_EVIDENCE",
    missingDeps,
  };
}

function hasPositioningSignal(p: IntegrityPositioningInput): boolean {
  return !!(p.narrativeDirection || p.enemyDefinition || (p.territories && p.territories.length > 0));
}
function hasDifferentiationSignal(d: IntegrityDifferentiationInput): boolean {
  return !!((d.pillars && d.pillars.length > 0) || (d.mechanismCore && d.mechanismCore.mechanismType !== "none") || (d.proofArchitecture && d.proofArchitecture.length > 0));
}
function hasOfferSignal(o: IntegrityOfferInput): boolean {
  return !!(o.offerName || o.coreOutcome || (o.deliverables && o.deliverables.length > 0));
}
function hasFunnelSignal(f: IntegrityFunnelInput): boolean {
  return !!(f.funnelType || (f.stageMap && f.stageMap.length > 0) || (f.trustPath && f.trustPath.length > 0));
}
function hasAudienceSignal(a: IntegrityAudienceInput): boolean {
  return !!((a.audiencePains && a.audiencePains.length > 0) || Object.keys(a.desireMap || {}).length > 0 || Object.keys(a.objectionMap || {}).length > 0);
}

export function sanitizeBoundary(text: string): { clean: boolean; violations: string[] } {
  if (!text) return { clean: true, violations: [] };
  const result = enforceBoundaryWithSanitization(text, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  return { clean: result.clean, violations: result.violations };
}

export function layer1_strategicConsistency(
  positioning: IntegrityPositioningInput,
  differentiation: IntegrityDifferentiationInput,
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
  audience: IntegrityAudienceInput,
): LayerResult {
  // CLP-15: cross-engine consistency requires at least one positioning OR
  // differentiation signal AND an offer signal AND a funnel signal. Empty
  // upstream snapshots produce vacuous "consistency" — INSUFFICIENT_EVIDENCE.
  const missing: string[] = [];
  if (!hasPositioningSignal(positioning) && !hasDifferentiationSignal(differentiation)) {
    missing.push("positioning_snapshot", "differentiation_snapshot");
  }
  if (!hasOfferSignal(offer)) missing.push("offer_snapshot");
  if (!hasFunnelSignal(funnel)) missing.push("funnel_snapshot");
  if (missing.length > 0) return insufficientEvidence("strategic_consistency", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const narrative = positioning.narrativeDirection || "";
  const enemy = positioning.enemyDefinition || "";
  const mechanism = differentiation.mechanismFraming?.description || differentiation.mechanismFraming?.name || "";
  const pillars = differentiation.pillars || [];
  const offerMechanism = offer.mechanismDescription || "";
  const core = differentiation.mechanismCore;

  if (core && core.mechanismType !== "none" && core.mechanismName) {
    const offerLower = offerMechanism.toLowerCase();
    const coreNameLower = core.mechanismName.toLowerCase();
    const namePresent = offerLower.includes(coreNameLower) || coreNameLower.split(/\s+/).filter(w => w.length > 3).some(w => offerLower.includes(w));
    const stepsPresent = core.mechanismSteps.length > 0 && core.mechanismSteps.some(step => offerLower.includes(step.toLowerCase().split(/\s+/)[0]));

    if (namePresent) {
      findings.push(`MechanismCore "${core.mechanismName}" (${core.mechanismType}) referenced in offer mechanism`);
    } else {
      warnings.push(`MechanismCore "${core.mechanismName}" not found in offer mechanism description — mechanism continuity broken`);
      score -= 0.15;
    }

    if (core.mechanismSteps.length > 0 && !stepsPresent) {
      warnings.push("Offer mechanism does not reference any MechanismCore steps");
      score -= 0.05;
    }
  } else if (mechanism && offerMechanism) {
    const mechanismWords = mechanism.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
    const offerWords = offerMechanism.toLowerCase().split(/\s+/).filter((w: string) => w.length > 4);
    const overlap = mechanismWords.filter((w: string) => offerWords.includes(w)).length;
    const overlapRatio = mechanismWords.length > 0 ? overlap / mechanismWords.length : 0;
    if (overlapRatio < 0.1 && mechanismWords.length > 3) {
      warnings.push("Differentiation mechanism has low overlap with offer mechanism description");
      score -= 0.1;
    } else {
      findings.push("Differentiation mechanism aligns with offer mechanism");
    }
  }

  const pains = audience.audiencePains || [];
  const desires = Object.keys(audience.desireMap || {});
  // Domain-content read of the OFFER's `coreOutcome` prose string for
  // pain-match scoring. Local var renamed off the `outcome` suffix per
  // Seal #9 doctrine D1; the property accessed (`coreOutcome`) is itself
  // outside the FORBIDDEN set. Empty-string sentinel = "no outcome to score".
  let coreOutcomeText = "";
  if (typeof offer.coreOutcome === "string" && offer.coreOutcome.length > 0) {
    coreOutcomeText = offer.coreOutcome;
  }
  if (coreOutcomeText && pains.length > 0) {
    const painTexts = pains.map((p: any) => (typeof p === "string" ? p : p?.pain || p?.name || "").toLowerCase());
    const outcomeWords = coreOutcomeText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
    const anyPainMatch = painTexts.some((pt: string) => outcomeWords.some((w: string) => pt.includes(w)));
    if (!anyPainMatch && desires.length === 0) {
      warnings.push("Offer core outcome does not clearly address identified audience pain signals");
      score -= 0.15;
    } else {
      findings.push("Offer outcome addresses audience pain/desire signals");
    }
  }

  if (narrative && pillars.length > 0) {
    findings.push(`Positioning narrative present with ${pillars.length} differentiation pillars`);
  } else if (!narrative && pillars.length === 0) {
    warnings.push("Both positioning narrative and differentiation pillars are missing");
    score -= 0.2;
  }

  const funnelCommitment = funnel.commitmentLevel || "medium";
  const offerFriction = offer.frictionLevel;
  if (funnelCommitment === "micro" && offerFriction > 0.7) {
    warnings.push("Funnel commitment level (micro) mismatches high-friction offer");
    score -= 0.1;
  } else {
    findings.push("Funnel commitment level is consistent with offer friction");
  }

  return { layerName: "strategic_consistency", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

export function layer2_audienceOfferAlignment(
  audience: IntegrityAudienceInput,
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
): LayerResult {
  // CLP-15: requires audience signals AND offer signals to be meaningful.
  const missing: string[] = [];
  if (!hasAudienceSignal(audience)) missing.push("audience_snapshot");
  if (!hasOfferSignal(offer)) missing.push("offer_snapshot");
  if (missing.length > 0) return insufficientEvidence("audience_offer_alignment", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const objections = Object.keys(audience.objectionMap || {});
  const outcome = (offer.coreOutcome || "").toLowerCase();
  const deliverables = offer.deliverables || [];

  if (pains.length > 0 && outcome) {
    // Audience engine v3 emits structured pains as { canonical, frequency, evidence, ... }.
    // Earlier shapes used { pain } or { name }. Probe canonical first so the
    // alignment check reads real text instead of "" (the source of the
    // long-standing false-positive "outcome does not reference pain language"
    // ENFORCEMENT_BLOCK warning).
    const painTexts = pains.slice(0, 5).map((p: any) =>
      (typeof p === "string"
        ? p
        : (p?.canonical || p?.text || p?.canonicalText || p?.pain || p?.name || p?.label || p?.description || "")
      ).toLowerCase()
    );
    const anyMatch = painTexts.some((pt: string) => {
      const words = pt.split(/\s+/).filter((w: string) => w.length > 3);
      return words.some((w: string) => outcome.includes(w));
    });
    if (anyMatch) {
      findings.push("Offer outcome aligns with identified audience pain signals");
    } else {
      warnings.push("Offer outcome does not reference audience pain language — potential misalignment");
      score -= 0.15;
    }
  } else if (pains.length === 0) {
    warnings.push("No audience pain signals available for alignment check");
    score -= 0.1;
  }

  const awareness = audience.awarenessLevel || "problem_aware";
  const commitment = funnel.commitmentLevel || "medium";
  const readinessMap: Record<string, number> = {
    unaware: 0.1, problem_aware: 0.3, solution_aware: 0.5, product_aware: 0.7, most_aware: 0.9,
  };
  const commitmentMap: Record<string, number> = {
    micro: 0.1, low: 0.3, medium: 0.5, high: 0.7, very_high: 0.9,
  };
  const readiness = readinessMap[awareness] || 0.3;
  const commitReq = commitmentMap[commitment] || 0.5;
  const gap = commitReq - readiness;
  if (gap > 0.4) {
    warnings.push(`Buyer readiness (${awareness}) is too low for funnel commitment level (${commitment}) — gap: ${gap.toFixed(2)}`);
    score -= 0.15;
  } else {
    findings.push(`Buyer readiness (${awareness}) matches funnel commitment (${commitment})`);
  }

  if (objections.length > 0) {
    const funnelStages = (funnel as any).stageMap || (funnel as any).primaryFunnel?.stageMap || [];
    const frictionMitigations = (Array.isArray(funnel.frictionMap) ? funnel.frictionMap : []).map((f: any) => `${f.frictionPoint || ''} ${f.mitigation || ''}`.toLowerCase());
    const trustActions = (funnel.trustPath || []).map((t: any) => `${t.action || ''} ${t.milestone || ''} ${t.trustFactor || ''}`.toLowerCase());
    const stageTexts = funnelStages.map((s: any) => `${s.name || ''} ${s.purpose || ''} ${s.contentType || ''} ${s.conversionGoal || ''} ${s.keyDeliverable || ''} ${s.objectionAddressed || ''}`.toLowerCase());
    const laneTexts = (Array.isArray((funnel as any).lanes) ? (funnel as any).lanes : []).map((l: any) => JSON.stringify(l).toLowerCase());
    const allFunnelText = [...frictionMitigations, ...trustActions, ...stageTexts, ...laneTexts].join(" ");

    let addressedCount = 0;
    for (const obj of objections.slice(0, 5)) {
      const objWords = (typeof obj === "string" ? obj : (obj as any)?.text || (obj as any)?.statement || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      if (objWords.some((w: string) => allFunnelText.includes(w))) {
        addressedCount++;
      }
    }
    const coverage = objections.length > 0 ? addressedCount / Math.min(objections.length, 5) : 1;
    if (coverage < 0.4) {
      warnings.push(`Only ${addressedCount} of ${Math.min(objections.length, 5)} audience objections are addressed in the funnel path`);
      score -= 0.1;
    } else {
      findings.push(`${addressedCount} of ${Math.min(objections.length, 5)} audience objections addressed in funnel`);
    }
  }

  return { layerName: "audience_offer_alignment", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

// Phase 3 (Task #66) — layer3 emits typed contradictions; see body.
export function layer3_positioningDifferentiationCompatibility(
  positioning: IntegrityPositioningInput,
  differentiation: IntegrityDifferentiationInput,
): LayerResult {
  // CLP-15: a compatibility check requires both inputs to be present.
  const missing: string[] = [];
  if (!hasPositioningSignal(positioning)) missing.push("positioning_snapshot");
  if (!hasDifferentiationSignal(differentiation)) missing.push("differentiation_snapshot");
  if (missing.length > 0) return insufficientEvidence("positioning_differentiation_compatibility", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const narrative = (positioning.narrativeDirection || "").toLowerCase();
  const enemy = (positioning.enemyDefinition || "").toLowerCase();
  const pillars = differentiation.pillars || [];
  const authorityMode = (differentiation.authorityMode || "").toLowerCase();
  const mechanism = differentiation.mechanismFraming?.description || differentiation.mechanismFraming?.name || "";

  // Phase 3 (Task #66) — typed cross-engine contradictions. The string
  // warnings below now ALSO emit a structured Contradiction entry so
  // system-control's `dedupeContradictions` can collapse this layer's
  // findings against any equivalent detection from contradiction-detector.
  const contradictions: import("../shared/contradictions").Contradiction[] = [];

  if (authorityMode.includes("price") && narrative.includes("authority")) {
    warnings.push("Positioning claims authority but differentiation relies on price competition — contradiction");
    contradictions.push({
      kind: "positioning_orphan_vs_signal_grounding",
      engineA: "positioning",
      engineB: "differentiation",
      description: "Positioning claims authority but differentiation relies on price competition",
      resolution: "Reconcile authority claim with a non-price differentiation pillar, or downgrade authority narrative",
    });
    score -= 0.2;
  }

  if (narrative.includes("strategic") && pillars.every((p: any) => {
    const name = (p.name || "").toLowerCase();
    return name.includes("tactical") || name.includes("basic") || name.includes("simple");
  }) && pillars.length > 0) {
    warnings.push("Positioning claims strategic expertise but differentiation pillars are purely tactical");
    contradictions.push({
      kind: "positioning_orphan_vs_signal_grounding",
      engineA: "positioning",
      engineB: "differentiation",
      description: "Positioning claims strategic expertise but differentiation pillars are purely tactical",
      resolution: "Add at least one strategic-level differentiation pillar, or revise positioning narrative",
    });
    score -= 0.15;
  }

  if (enemy && mechanism) {
    const enemyWords = enemy.split(/\s+/).filter((w: string) => w.length > 3);
    const mechLower = mechanism.toLowerCase();
    const enemyInMechanism = enemyWords.some((w: string) => mechLower.includes(w));
    if (enemyInMechanism) {
      warnings.push("Enemy narrative language appears in differentiation mechanism — potential narrative contradiction");
      contradictions.push({
        kind: "positioning_orphan_vs_signal_grounding",
        engineA: "positioning",
        engineB: "differentiation",
        description: "Enemy narrative language appears in differentiation mechanism — potential narrative contradiction",
        resolution: "Reframe mechanism description to avoid enemy vocabulary, OR strengthen the framing as a deliberate counter-mechanism",
      });
      score -= 0.1;
    }
  }

  if (pillars.length > 0 && positioning.territories && positioning.territories.length > 0) {
    findings.push(`${pillars.length} differentiation pillars support ${positioning.territories.length} positioning territories`);
  } else if (pillars.length === 0) {
    warnings.push("No differentiation pillars defined — positioning lacks structural support");
    score -= 0.15;
  }

  const posConf = safeNumber(positioning.confidenceScore, 0);
  const diffConf = safeNumber(differentiation.confidenceScore, 0);
  if (posConf > 0 && diffConf > 0 && Math.abs(posConf - diffConf) > 0.4) {
    warnings.push(`Large confidence gap between positioning (${posConf.toFixed(2)}) and differentiation (${diffConf.toFixed(2)})`);
    score -= 0.1;
  }

  if (warnings.length === 0) {
    findings.push("Positioning and differentiation are structurally compatible");
  }

  return { layerName: "positioning_differentiation_compatibility", passed: score >= 0.5, score: clamp(score), findings, warnings, contradictions, evaluationState: "EVALUATED" };
}

export function layer4_offerFunnelCompatibility(
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
): LayerResult {
  const missing: string[] = [];
  if (!hasOfferSignal(offer)) missing.push("offer_snapshot");
  if (!hasFunnelSignal(funnel)) missing.push("funnel_snapshot");
  if (missing.length > 0) return insufficientEvidence("offer_funnel_compatibility", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const offerStrength = safeNumber(offer.offerStrengthScore, 0.5);
  const funnelStrength = safeNumber(funnel.funnelStrengthScore, 0.5);
  const stages = funnel.stageMap || [];
  const trustPath = funnel.trustPath || [];

  if (offerStrength > 0.7 && trustPath.length < 2) {
    warnings.push("High-strength offer uses a funnel with minimal trust building — may fail at conversion");
    score -= 0.15;
  }

  if (offer.frictionLevel > 0.6 && stages.length < 3) {
    warnings.push("High-friction offer uses an overly short conversion path — insufficient buyer preparation");
    score -= 0.15;
  }

  if (offer.frictionLevel > 0.7 && funnel.funnelType === "direct") {
    warnings.push("High-friction audience receives direct funnel — immediate hard conversion ask is risky");
    score -= 0.2;
  }

  if ((offer.deliverables || []).length > 5 && stages.length < 4) {
    warnings.push("Complex offer with many deliverables uses too few funnel stages for adequate explanation");
    score -= 0.1;
  }

  const commitmentMap: Record<string, number> = { micro: 0.1, low: 0.3, medium: 0.5, high: 0.7, very_high: 0.9 };
  const commitReq = commitmentMap[funnel.commitmentLevel] || 0.5;
  if (offerStrength < 0.4 && commitReq > 0.6) {
    warnings.push("Weak offer requires high commitment — funnel asks too much for what's delivered");
    score -= 0.15;
  }

  if (warnings.length === 0) {
    findings.push("Offer complexity and trust requirements match funnel structure");
  } else {
    findings.push(`Offer-funnel compatibility: ${warnings.length} issue(s) detected`);
  }

  return { layerName: "offer_funnel_compatibility", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

export function layer5_trustPathContinuity(
  funnel: IntegrityFunnelInput,
  differentiation: IntegrityDifferentiationInput,
): LayerResult {
  if (!hasFunnelSignal(funnel)) return insufficientEvidence("trust_path_continuity", ["funnel_snapshot"]);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const trustPath = funnel.trustPath || [];
  const proofPlacements = funnel.proofPlacements || [];
  const stages = funnel.stageMap || [];

  if (trustPath.length < 2) {
    warnings.push("Trust path has fewer than 2 steps — insufficient trust building before conversion");
    score -= 0.2;
  }

  const hasProofBeforeCommitment = trustPath.some((t: any, i: number) =>
    i < trustPath.length - 1 && t.proofType && t.proofType !== "transparency_proof"
  );
  if (!hasProofBeforeCommitment && trustPath.length > 1) {
    warnings.push("No substantive proof appears before the commitment stage in trust path");
    score -= 0.15;
  } else if (hasProofBeforeCommitment) {
    findings.push("Proof appears before commitment stages in trust path");
  }

  const conversionStageIndex = stages.findIndex((s: any) => s.name === "conversion" || s.conversionGoal === "purchase");
  const proofStageIndex = stages.findIndex((s: any) => s.name === "consideration" || s.contentType === "proof_content");
  if (conversionStageIndex >= 0 && proofStageIndex >= 0 && proofStageIndex > conversionStageIndex) {
    warnings.push("Proof stage appears after conversion stage — trust signals must precede conversion");
    score -= 0.2;
  } else if (conversionStageIndex >= 0 && proofStageIndex >= 0) {
    findings.push("Trust signals appear before conversion stage");
  }

  const proofTypes = new Set(proofPlacements.map((p: any) => p.proofType));
  const diffProof = differentiation.proofArchitecture || [];
  const diffProofTypes = new Set(diffProof.map((p: any) => p.category));
  if (diffProofTypes.size > 0 && proofTypes.size === 0) {
    warnings.push("Differentiation has proof architecture but funnel has no proof placements");
    score -= 0.15;
  }

  if (trustPath.length >= 3 && hasProofBeforeCommitment) {
    findings.push("Trust path has adequate depth and proof sequencing");
  }

  return { layerName: "trust_path_continuity", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

export function layer6_proofSufficiency(
  differentiation: IntegrityDifferentiationInput,
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
): LayerResult {
  const missing: string[] = [];
  if (!hasDifferentiationSignal(differentiation) && !hasOfferSignal(offer)) {
    missing.push("differentiation_snapshot", "offer_snapshot");
  }
  if (!hasFunnelSignal(funnel)) missing.push("funnel_snapshot");
  if (missing.length > 0) return insufficientEvidence("proof_sufficiency", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const proofArch = differentiation.proofArchitecture || [];
  const proofPlacements = funnel.proofPlacements || [];
  const offerStrength = safeNumber(offer.offerStrengthScore, 0.5);

  const proofCategories = new Set(proofArch.map((p: any) => p.category));
  const requiredTypes = ["process_proof", "case_proof", "outcome_proof"];
  const missingTypes: string[] = [];
  for (const required of requiredTypes) {
    if (!proofCategories.has(required)) {
      missingTypes.push(required);
    }
  }

  if (missingTypes.length > 0 && offerStrength > 0.6) {
    warnings.push(`High-strength offer lacks proof types: ${missingTypes.join(", ")}`);
    score -= 0.1 * missingTypes.length;
  } else if (missingTypes.length > 0) {
    warnings.push(`Missing proof types: ${missingTypes.join(", ")}`);
    score -= 0.05 * missingTypes.length;
  }

  if (proofArch.length === 0 && (offer.deliverables || []).length > 3) {
    warnings.push("Complex offer has no proof architecture — claims are unsupported");
    score -= 0.2;
  } else if (proofArch.length > 0) {
    findings.push(`${proofArch.length} proof assets available across ${proofCategories.size} categories`);
  }

  if (proofPlacements.length === 0 && proofArch.length > 0) {
    warnings.push("Proof assets exist but are not placed in the funnel stages");
    score -= 0.1;
  } else if (proofPlacements.length > 0) {
    findings.push(`${proofPlacements.length} proof placements active across funnel stages`);
  }

  const offerProofAlignment = offer.proofAlignment || [];
  if (offerProofAlignment.length > 0 && proofArch.length > 0) {
    findings.push("Offer proof alignment references are present");
  }

  return { layerName: "proof_sufficiency", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

export function layer7_conversionFeasibility(
  funnel: IntegrityFunnelInput,
  audience: IntegrityAudienceInput,
  offer: IntegrityOfferInput,
): LayerResult {
  const missing: string[] = [];
  if (!hasFunnelSignal(funnel)) missing.push("funnel_snapshot");
  if (!hasOfferSignal(offer)) missing.push("offer_snapshot");
  if (missing.length > 0) return insufficientEvidence("conversion_feasibility", missing);

  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const stages = funnel.stageMap || [];
  const trustPath = funnel.trustPath || [];
  const frictionMap = Array.isArray(funnel.frictionMap) ? funnel.frictionMap : [];

  if (stages.length > 6) {
    warnings.push(`Excessive funnel complexity: ${stages.length} stages — cognitive load risk`);
    score -= 0.15;
  } else {
    findings.push(`Funnel has ${stages.length} stages — within practical limits`);
  }

  const criticalFriction = frictionMap.filter((f: any) => f.severity > 0.7).length;
  if (criticalFriction > 2) {
    warnings.push(`${criticalFriction} critical friction points — conversion path has high resistance`);
    score -= 0.1;
  }

  const totalTrustSteps = trustPath.length;
  const proofCount = funnel.proofPlacements?.length || 0;
  if (totalTrustSteps > 6) {
    warnings.push(`${totalTrustSteps} trust steps required — may exceed audience patience`);
    score -= 0.1;
  }

  if (offer.frictionLevel > 0.7 && proofCount < 3) {
    warnings.push("High-friction offer with insufficient proof coverage — conversion unlikely");
    score -= 0.15;
  }

  const awareness = audience.awarenessLevel || "problem_aware";
  if (awareness === "unaware" && funnel.funnelType === "direct") {
    warnings.push("Unaware audience cannot convert through direct funnel — education stage required");
    score -= 0.2;
  }

  if (funnel.compressionApplied) {
    warnings.push("Funnel was compressed — original complexity exceeded practical limits");
    score -= 0.05;
  }

  if (warnings.length === 0) {
    findings.push("Conversion path is structurally feasible");
  }

  return { layerName: "conversion_feasibility", passed: score >= 0.5, score: clamp(score), findings, warnings, evaluationState: "EVALUATED" };
}

const AWARENESS_PERSUASION_MAP: Record<string, string> = {
  unaware: "education_led",
  problem_aware: "empathy_led",
  solution_aware: "contrast_led",
  product_aware: "proof_led",
  most_aware: "proof_led",
};

const MECHANISM_ACTION_VERBS = [
  "identify", "build", "deploy", "analyze", "map", "extract", "transform",
  "validate", "optimize", "implement", "execute", "design", "create", "develop",
];

function validateCrossEngineAlignment(
  audience: IntegrityAudienceInput,
  differentiation: IntegrityDifferentiationInput,
  offer: IntegrityOfferInput,
): { findings: string[]; warnings: string[] } {
  const findings: string[] = [];
  const warnings: string[] = [];

  const awareness = audience.awarenessLevel || "problem_aware";
  const expectedMode = AWARENESS_PERSUASION_MAP[awareness];
  if (expectedMode) {
    findings.push(`Awareness stage "${awareness}" → expected persuasion mode: ${expectedMode}`);
  }

  const core = differentiation.mechanismCore;
  if (core && core.mechanismType !== "none" && core.mechanismName) {
    const hasActionVerbs = core.mechanismSteps.some(step =>
      MECHANISM_ACTION_VERBS.some(verb => step.toLowerCase().includes(verb))
    );
    if (!hasActionVerbs) {
      warnings.push(`MechanismCore steps lack action-oriented language — steps may be themes instead of transformation processes`);
    } else {
      findings.push(`MechanismCore validated: steps contain action-oriented transformation language`);
    }

    const offerDeliverables = offer.deliverables || [];
    if (offerDeliverables.length > 0 && core.mechanismSteps.length > 0) {
      const stepWords = core.mechanismSteps.map(s => s.toLowerCase().split(/\s+/).slice(0, 3));
      const alignedDeliverables = offerDeliverables.filter(d => {
        const dLower = d.toLowerCase();
        return stepWords.some(words => words.some(w => w.length > 3 && dLower.includes(w)));
      });
      if (alignedDeliverables.length < Math.min(core.mechanismSteps.length, 2)) {
        warnings.push(`Offer deliverables (${offerDeliverables.length}) poorly aligned with MechanismCore steps (${core.mechanismSteps.length}) — only ${alignedDeliverables.length} match`);
      } else {
        findings.push(`Offer deliverables aligned with MechanismCore: ${alignedDeliverables.length}/${core.mechanismSteps.length} steps covered`);
      }
    }
  }

  return { findings, warnings };
}

export function layer8_systemCoherence(
  layerResults: LayerResult[],
  mi: IntegrityMIInput,
  positioning: IntegrityPositioningInput,
  differentiation: IntegrityDifferentiationInput,
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
  audience?: IntegrityAudienceInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  // CLP-15: system coherence operates ONLY over layers that were actually
  // evaluated. INSUFFICIENT_EVIDENCE layers contribute neither to "passed"
  // nor "failed" — they contribute to a separate insufficient-coverage
  // count which the aggregator translates into INSUFFICIENT_LAYER_COVERAGE.
  const evaluatedLayers = layerResults.filter(l => l.evaluationState === "EVALUATED");
  const insufficientLayers = layerResults.filter(l => l.evaluationState !== "EVALUATED");
  const failedLayers = evaluatedLayers.filter(l => l.passed === false);
  const totalWarnings = layerResults.reduce((sum, l) => sum + l.warnings.length, 0);
  const avgScore = evaluatedLayers.length > 0
    ? evaluatedLayers.reduce((sum, l) => sum + (l.score ?? 0), 0) / evaluatedLayers.length
    : 0;

  if (failedLayers.length > 0) {
    warnings.push(`${failedLayers.length} validation layer(s) failed: ${failedLayers.map(l => l.layerName).join(", ")}`);
  }
  if (insufficientLayers.length > 0) {
    warnings.push(`${insufficientLayers.length} layer(s) returned INSUFFICIENT_EVIDENCE: ${insufficientLayers.map(l => l.layerName).join(", ")}`);
  }

  if (totalWarnings > 8) {
    warnings.push(`High warning density: ${totalWarnings} structural warnings across the system`);
  }

  const miConfidence = safeNumber(mi.overallConfidence, 0);
  const posConfidence = safeNumber(positioning.confidenceScore, 0);
  const diffConfidence = safeNumber(differentiation.confidenceScore, 0);
  const offerStrength = safeNumber(offer.offerStrengthScore, 0);
  const funnelStrength = safeNumber(funnel.funnelStrengthScore, 0);

  const confidences = [miConfidence, posConfidence, diffConfidence, offerStrength, funnelStrength].filter(c => c > 0);
  if (confidences.length > 0) {
    const minConf = Math.min(...confidences);
    const maxConf = Math.max(...confidences);
    if (maxConf - minConf > 0.4) {
      warnings.push(`Large confidence spread across engines: min=${minConf.toFixed(2)}, max=${maxConf.toFixed(2)}`);
    }
    findings.push(`Engine confidence range: ${minConf.toFixed(2)} to ${maxConf.toFixed(2)}`);
  }

  if (audience) {
    const crossEngine = validateCrossEngineAlignment(audience, differentiation, offer);
    findings.push(...crossEngine.findings);
    warnings.push(...crossEngine.warnings);
  }

  // If no base layers evaluated, system_coherence itself is INSUFFICIENT.
  if (evaluatedLayers.length === 0) {
    return insufficientEvidence("system_coherence", ["all_base_layers_insufficient"]);
  }

  const score = clamp(avgScore - (failedLayers.length * 0.05) - (totalWarnings > 8 ? 0.1 : 0));
  findings.push(`System coherence: ${failedLayers.length} failed, ${evaluatedLayers.length} evaluated, ${insufficientLayers.length} insufficient (of ${layerResults.length} base layers), ${totalWarnings} total warnings`);

  return { layerName: "system_coherence", passed: failedLayers.length <= 2 && score >= 0.4, score, findings, warnings, evaluationState: "EVALUATED" };
}

export function layer9_strategicLaneAuthority(
  audience: IntegrityAudienceInput & { strategicLanes?: any[]; painRegistry?: any[] },
): LayerResult {
  const lanes = audience?.strategicLanes;
  const painRegistry = audience?.painRegistry;

  if (!Array.isArray(lanes) || lanes.length === 0) {
    return {
      layerName: "strategic_lane_authority",
      passed: true,
      score: 1.0,
      findings: ["No strategic lanes supplied for lane authority check."],
      warnings: [],
      evaluationState: "EVALUATED",
    };
  }

  const findings: string[] = [];
  const warnings: string[] = [];
  let violations = 0;

  const registryPains = Array.isArray(painRegistry) ? painRegistry : [];
  const corePainIds = new Set(
    registryPains
      .filter((p: any) => p.classification === "CORE_PURCHASE" || p.classification === "CORE")
      .map((p: any) => p.painId)
  );
  const supportingPainIds = new Set(
    registryPains
      .filter((p: any) => p.classification === "SUPPORTING")
      .map((p: any) => p.painId)
  );
  const excludedPainIds = new Set(
    registryPains
      .filter((p: any) => 
        p.classification === "STRATEGIC_EXCLUDED" || 
        p.classification === "EXCLUDED" || 
        p.classification === "INCOMPLETE" ||
        p.classification === "UNKNOWN"
      )
      .map((p: any) => p.painId)
  );

  lanes.forEach((lane: any, idx: number) => {
    const laneTitle = lane.title || `Lane ${idx + 1}`;
    const coreIds = Array.isArray(lane.corePainIds) ? lane.corePainIds : [];
    const suppIds = Array.isArray(lane.supportingPainIds) ? lane.supportingPainIds : [];
    const allPainIds = Array.isArray(lane.painIds) ? lane.painIds : [...coreIds, ...suppIds];
    const primaryId = lane.primaryPainId || coreIds[0];

    // A. Must contain >= 1 CORE_PURCHASE pain
    if (coreIds.length === 0 && !corePainIds.has(primaryId)) {
      warnings.push(`NO_CORE_PAIN_IN_STRATEGIC_LANE: Lane "${laneTitle}" has no CORE_PURCHASE pain`);
      violations++;
    }

    // B. primaryPainId MUST resolve to CORE_PURCHASE (cannot be SUPPORTING)
    if (primaryId && (supportingPainIds.has(primaryId) || (!corePainIds.has(primaryId) && corePainIds.size > 0))) {
      warnings.push(`SUPPORTING_AS_PRIMARY_PAIN: Lane "${laneTitle}" has non-CORE primary pain "${primaryId}"`);
      violations++;
    }

    // C. ANY lane contains STRATEGIC_EXCLUDED, EXCLUDED, or INCOMPLETE
    allPainIds.forEach((pid: string) => {
      if (excludedPainIds.has(pid)) {
        warnings.push(`EXCLUDED_PAIN_IN_STRATEGIC_LANE: Excluded pain "${pid}" detected in lane "${laneTitle}"`);
        violations++;
      }
    });

    // D. Pain ID must resolve to a valid canonical Strategic Pain Decision in registry if registry is provided
    if (registryPains.length > 0) {
      const knownIds = new Set(registryPains.map((p: any) => p.painId));
      allPainIds.forEach((pid: string) => {
        if (!knownIds.has(pid)) {
          warnings.push(`UNRESOLVED_PAIN_AUTHORITY: Pain "${pid}" in lane "${laneTitle}" does not exist in pain registry`);
          violations++;
        }
      });
    }
  });

  const passed = violations === 0;
  const score = passed ? 1.0 : Math.max(0, 1 - violations * 0.5);

  return {
    layerName: "strategic_lane_authority",
    passed,
    score,
    findings,
    warnings,
    evaluationState: "EVALUATED",
  };
}

export function runIntegrityEngine(
  mi: IntegrityMIInput,
  audience: IntegrityAudienceInput,
  positioning: IntegrityPositioningInput,
  differentiation: IntegrityDifferentiationInput,
  offer: IntegrityOfferInput,
  funnel: IntegrityFunnelInput,
): IntegrityResult {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  console.log(`[IntegrityEngine-V3] Starting 8-layer validation pipeline`);

  const competitorCount = (mi.opportunitySignals || []).length + (mi.threatSignals || []).length;
  const signalCount = (audience.audiencePains || []).length + Object.keys(audience.objectionMap || {}).length + (audience.emotionalDrivers || []).length;
  const dataReliability = assessDataReliability(
    competitorCount,
    signalCount,
    !!positioning.narrativeDirection,
    !!(differentiation.pillars && differentiation.pillars.length > 0),
    !!(audience.audiencePains && audience.audiencePains.length > 0),
    safeNumber(mi.overallConfidence, 0),
  );
  diagnostics.dataReliability = dataReliability;
  if (dataReliability.isWeak) {
    console.log(`[IntegrityEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  const l1 = layer1_strategicConsistency(positioning, differentiation, offer, funnel, audience);
  diagnostics.layer1 = { passed: l1.passed, score: l1.score, warnings: l1.warnings.length };

  const l2 = layer2_audienceOfferAlignment(audience, offer, funnel);
  diagnostics.layer2 = { passed: l2.passed, score: l2.score, warnings: l2.warnings.length };

  const l3 = layer3_positioningDifferentiationCompatibility(positioning, differentiation);
  diagnostics.layer3 = { passed: l3.passed, score: l3.score, warnings: l3.warnings.length };

  const l4 = layer4_offerFunnelCompatibility(offer, funnel);
  diagnostics.layer4 = { passed: l4.passed, score: l4.score, warnings: l4.warnings.length };

  const l5 = layer5_trustPathContinuity(funnel, differentiation);
  diagnostics.layer5 = { passed: l5.passed, score: l5.score, warnings: l5.warnings.length };

  const l6 = layer6_proofSufficiency(differentiation, offer, funnel);
  diagnostics.layer6 = { passed: l6.passed, score: l6.score, warnings: l6.warnings.length };

  const l7 = layer7_conversionFeasibility(funnel, audience, offer);
  diagnostics.layer7 = { passed: l7.passed, score: l7.score, warnings: l7.warnings.length };

  const firstSevenLayers = [l1, l2, l3, l4, l5, l6, l7];
  const l8 = layer8_systemCoherence(firstSevenLayers, mi, positioning, differentiation, offer, funnel, audience);
  diagnostics.layer8 = { passed: l8.passed, score: l8.score, warnings: l8.warnings.length };

  const l9 = layer9_strategicLaneAuthority(audience as any);
  diagnostics.layer9 = { passed: l9.passed, score: l9.score, warnings: l9.warnings.length };

  const allLayers = [...firstSevenLayers, l8, l9];

  // CLP-15: score numerator AND denominator exclude INSUFFICIENT_EVIDENCE
  // layers. If every layer is INSUFFICIENT, score is 0 and the aggregator
  // returns INSUFFICIENT_LAYER_COVERAGE.
  const evaluatedLayers = allLayers.filter(l => l.evaluationState === "EVALUATED");
  const insufficientLayers = allLayers.filter(l => l.evaluationState !== "EVALUATED");
  const evaluatedBaseLayers = firstSevenLayers.filter(l => l.evaluationState === "EVALUATED");
  const evaluatedLayerCount = evaluatedLayers.length;
  const insufficientLayerCount = insufficientLayers.length;
  const missingPrerequisites = Array.from(new Set(insufficientLayers.flatMap(l => l.missingDeps ?? [])));

  let weightSum = 0;
  let scoredSum = 0;
  for (const l of evaluatedLayers) {
    const w = LAYER_WEIGHTS[l.layerName] || 0.1;
    weightSum += w;
    scoredSum += (l.score ?? 0) * w;
  }
  let overallIntegrityScore = weightSum > 0 ? clamp(scoredSum / weightSum) : 0;
  const rawIntegrityScore = overallIntegrityScore;
  overallIntegrityScore = normalizeConfidence(overallIntegrityScore, dataReliability);
  const confidenceNormalized = rawIntegrityScore !== overallIntegrityScore;
  diagnostics.confidenceNormalized = confidenceNormalized;
  if (confidenceNormalized) {
    diagnostics.rawIntegrityScore = rawIntegrityScore;
  }
  diagnostics.evaluatedLayerCount = evaluatedLayerCount;
  diagnostics.insufficientLayerCount = insufficientLayerCount;
  diagnostics.missingPrerequisites = missingPrerequisites;

  const structuralWarnings = allLayers.flatMap(l => l.warnings);
  // Only EVALUATED+failed layers count as "inconsistencies" — an
  // INSUFFICIENT_EVIDENCE layer cannot have detected an inconsistency.
  const flaggedInconsistencies = evaluatedLayers.filter(l => l.passed === false).flatMap(l =>
    l.warnings.map(w => `[${l.layerName}] ${w}`)
  );

  const allLayerText = allLayers.flatMap(l => [...l.findings, ...l.warnings]).join(" ");
  const boundaryRaw = sanitizeBoundary(allLayerText);
  const boundaryCheck = { passed: boundaryRaw.clean, violations: boundaryRaw.violations };
  diagnostics.boundaryCheck = boundaryCheck;

  const genericOutputCheck = detectGenericOutput(allLayerText);
  diagnostics.genericOutputCheck = genericOutputCheck;
  if (genericOutputCheck.genericDetected) {
    overallIntegrityScore = clamp(overallIntegrityScore - genericOutputCheck.penalty);
    console.log(`[IntegrityEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  let status: string = STATUS.COMPLETE;
  let statusMessage: string | null = null;

  // CLP-15: when fewer than MIN_EVALUATED_BASE_LAYERS of the 7 base layers
  // were actually evaluable, the integrity verdict is structurally untrustable.
  const insufficientCoverage = evaluatedBaseLayers.length < MIN_EVALUATED_BASE_LAYERS;
  if (insufficientCoverage) {
    status = "INSUFFICIENT_LAYER_COVERAGE";
    statusMessage = `Only ${evaluatedBaseLayers.length}/${firstSevenLayers.length} base layers evaluable; missing upstream inputs: ${missingPrerequisites.join(", ")}`;
  }

  if (!boundaryCheck.passed) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Boundary violation in integrity output: ${boundaryCheck.violations.join("; ")}`;
  }

  // Compound check throughout: only EVALUATED layers with passed===false
  // are real failures. INSUFFICIENT_EVIDENCE !== failure.
  const failedCount = evaluatedLayers.filter(l => l.passed === false).length;

  const audienceOfferLayer = l2;
  const painAlignmentFailed = audienceOfferLayer.evaluationState === "EVALUATED" && (
    (audienceOfferLayer.score ?? 0) < 0.4 ||
    audienceOfferLayer.passed === false
  );

  const objectionCoverageZero = l6.evaluationState === "EVALUATED" && (
    (l6.score ?? 0) < 0.4 ||
    l6.passed === false
  );

  const laneAuthorityFailed = l9.evaluationState === "EVALUATED" && (
    l9.passed === false ||
    (l9.score ?? 0) < 0.5 ||
    l9.warnings.some(w => 
      w.includes("EXCLUDED_PAIN_IN_STRATEGIC_LANE") || 
      w.includes("NO_CORE_PAIN_IN_STRATEGIC_LANE") || 
      w.includes("SUPPORTING_AS_PRIMARY_PAIN")
    )
  );

  const hasEnforcementFailure = painAlignmentFailed || objectionCoverageZero || laneAuthorityFailed;

  if (hasEnforcementFailure) {
    const reasons: string[] = [];
    if (painAlignmentFailed) reasons.push("offer↔audience pain alignment failed");
    if (objectionCoverageZero) reasons.push("objection/proof coverage is critically low");
    if (laneAuthorityFailed) reasons.push("strategic lane pain authority violated (excluded pain in lane or missing core pain)");
    structuralWarnings.push(`ENFORCEMENT_BLOCK: safeToExecute overridden — ${reasons.join(", ")}`);
    console.log(`[IntegrityEngine-V3] ENFORCEMENT_OVERRIDE | safeToExecute=false | reasons=${reasons.join(", ")}`);
  }

  // CLP-15: insufficient coverage forces safeToExecute=false.
  const safeToExecute = !insufficientCoverage
    && boundaryCheck.passed
    && failedCount <= 2
    && overallIntegrityScore >= 0.4
    && !hasEnforcementFailure;

  // ── Canonical integrity verdict (PASS / PARTIAL / FAIL) ──────────────────
  // CLP-15: insufficient coverage → FAIL. Otherwise unchanged.
  let overallStatus: "PASS" | "PARTIAL" | "FAIL";
  if (insufficientCoverage || !boundaryCheck.passed || hasEnforcementFailure || failedCount >= 3 || !safeToExecute) {
    overallStatus = "FAIL";
  } else if (failedCount > 0 || insufficientLayerCount > 0 || structuralWarnings.length > 0) {
    overallStatus = "PARTIAL";
  } else {
    overallStatus = "PASS";
  }

  const failureReasons: string[] = [];
  if (insufficientCoverage) failureReasons.push(`insufficient_layer_coverage: ${evaluatedBaseLayers.length}/${firstSevenLayers.length} base layers evaluable`);
  if (!boundaryCheck.passed) failureReasons.push(`boundary_violation: ${boundaryCheck.violations?.join(", ") || "unspecified"}`);
  if (hasEnforcementFailure) failureReasons.push("enforcement_block: pain alignment or objection coverage failed");
  for (const layer of allLayers) {
    if (layer.evaluationState === "EVALUATED" && layer.passed === false) {
      failureReasons.push(`layer_failed:${layer.layerName ?? "unknown"}`);
    } else if (layer.evaluationState === "INSUFFICIENT_EVIDENCE") {
      failureReasons.push(`layer_insufficient:${layer.layerName ?? "unknown"}`);
    }
  }
  const zeroLeakage = flaggedInconsistencies.length === 0;
  const traceabilityComplete = !insufficientCoverage && boundaryCheck.passed && failedCount === 0 && insufficientLayerCount === 0;

  console.log(`[IntegrityEngine-V3] Complete | status=${status} | overallStatus=${overallStatus} | score=${overallIntegrityScore.toFixed(2)} | safeToExecute=${safeToExecute} | evaluated=${evaluatedLayerCount}/${allLayers.length} | insufficient=${insufficientLayerCount} | failed=${failedCount} | warnings=${structuralWarnings.length} | boundary=${boundaryCheck.passed}`);

  return {
    status,
    evaluatedLayerCount,
    insufficientLayerCount,
    missingPrerequisites,
    overallStatus,
    integrityVerdict: overallStatus,
    statusMessage,
    overallIntegrityScore,
    safeToExecute,
    failureReasons,
    zeroLeakage,
    traceabilityComplete,
    layerResults: allLayers,
    structuralWarnings,
    flaggedInconsistencies,
    boundaryCheck,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    layerDiagnostics: diagnostics,
  };
}
