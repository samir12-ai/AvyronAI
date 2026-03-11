import {
  ENGINE_VERSION,
  STATUS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  LAYER_WEIGHTS,
  NARRATIVE_CLAIM_PATTERNS,
  ASSUMPTION_INDICATORS,
  EVIDENCE_DENSITY_THRESHOLDS,
  CLAIM_CONFIDENCE_THRESHOLDS,
  VALIDATION_STATES,
} from "./constants";
import { enforceBoundaryWithSanitization } from "../../engine-hardening";
import { assessStrategyAcceptability } from "../../shared/strategy-acceptability";
import type {
  ValidationMIInput,
  ValidationAudienceInput,
  ValidationOfferInput,
  ValidationFunnelInput,
  ValidationAwarenessInput,
  ValidationPersuasionInput,
  LayerResult,
  ClaimValidation,
  DataReliabilityDiagnostics,
  StatisticalValidationResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeNumber(v: any, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  const parsed = Number(v);
  return isNaN(parsed) ? fallback : parsed;
}

function safeString(v: any, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v.trim();
  return fallback;
}

function assessDataReliability(
  mi: ValidationMIInput,
  audience: ValidationAudienceInput,
  offer: ValidationOfferInput,
  funnel: ValidationFunnelInput,
  awareness: ValidationAwarenessInput,
  persuasion: ValidationPersuasionInput,
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
  if (mi.marketDiagnosis) sourceDiversity.add("diagnosis");
  if (offer.coreOutcome) sourceDiversity.add("offer_outcome");
  if (awareness.entryMechanismType) sourceDiversity.add("awareness_entry");
  if (persuasion.persuasionMode) sourceDiversity.add("persuasion_mode");
  const signalDiversity = clamp(sourceDiversity.size / 6, 0, 1);
  if (sourceDiversity.size < 3) advisories.push(`Low signal diversity: only ${sourceDiversity.size}/7 data sources populated`);

  const hasPersuasion = !!persuasion.persuasionMode;
  const hasAwareness = !!awareness.entryMechanismType;
  const narrativeStability = hasPersuasion && hasAwareness ? 1.0 : hasPersuasion || hasAwareness ? 0.5 : 0.2;
  if (narrativeStability < 0.5) advisories.push("Low narrative stability: persuasion or awareness data sparse");

  const competitorValidity = clamp(totalMISignals / 5, 0, 1);

  const marketMaturityConfidence = clamp(
    (safeNumber(mi.overallConfidence, 0) + safeNumber(offer.offerStrengthScore, 0) + safeNumber(funnel.funnelStrengthScore, 0)) / 3,
    0,
    1
  );

  const overallReliability = clamp(
    signalDensity * 0.20 + signalDiversity * 0.20 + narrativeStability * 0.15 +
    competitorValidity * 0.15 + marketMaturityConfidence * 0.30,
    0,
    1
  );

  const isWeak = overallReliability < 0.4;
  if (isWeak) advisories.push("Overall data reliability is WEAK — confidence scores will be capped");

  return {
    signalDensity, signalDiversity, narrativeStability, competitorValidity,
    marketMaturityConfidence, overallReliability, isWeak, advisories,
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

function extractClaims(
  offer: ValidationOfferInput,
  persuasion: ValidationPersuasionInput,
  awareness: ValidationAwarenessInput,
): Array<{ claim: string; source: string }> {
  const claims: Array<{ claim: string; source: string }> = [];

  if (offer.coreOutcome) {
    claims.push({ claim: offer.coreOutcome, source: "offer_outcome" });
  }
  if (offer.mechanismDescription) {
    claims.push({ claim: offer.mechanismDescription, source: "offer_mechanism" });
  }
  for (const proof of (offer.proofAlignment || []).slice(0, 3)) {
    if (proof) claims.push({ claim: proof, source: "offer_proof" });
  }
  for (const driver of (persuasion.primaryInfluenceDrivers || []).slice(0, 3)) {
    if (driver) claims.push({ claim: `Influence driver: ${driver}`, source: "persuasion_driver" });
  }
  if (awareness.triggerClass) {
    claims.push({ claim: `Trigger: ${awareness.triggerClass}`, source: "awareness_trigger" });
  }
  if (awareness.entryMechanismType) {
    claims.push({ claim: `Entry: ${awareness.entryMechanismType}`, source: "awareness_entry" });
  }

  return claims;
}

function validateClaim(
  claim: string,
  source: string,
  mi: ValidationMIInput,
  audience: ValidationAudienceInput,
  offer: ValidationOfferInput,
  funnel: ValidationFunnelInput,
  awareness: ValidationAwarenessInput,
  persuasion: ValidationPersuasionInput,
): ClaimValidation {
  const lower = claim.toLowerCase();
  const supportingSignals: string[] = [];
  const contradictingSignals: string[] = [];

  let evidenceType: ClaimValidation["evidenceType"] = "assumption";
  let evidenceStrength = 0.2;

  let isNarrativeBased = false;
  for (const pattern of NARRATIVE_CLAIM_PATTERNS) {
    if (lower.includes(pattern)) {
      isNarrativeBased = true;
      break;
    }
  }

  let isAssumptionBased = false;
  for (const indicator of ASSUMPTION_INDICATORS) {
    if (lower.includes(indicator)) {
      isAssumptionBased = true;
      break;
    }
  }

  for (const opp of (mi.opportunitySignals || [])) {
    const oppStr = typeof opp === "string" ? opp : safeString(opp?.signal || opp?.description || "", "");
    if (oppStr && hasOverlap(lower, oppStr.toLowerCase())) {
      supportingSignals.push(oppStr.slice(0, 100));
      evidenceStrength += 0.15;
    }
  }

  for (const threat of (mi.threatSignals || [])) {
    const threatStr = typeof threat === "string" ? threat : safeString(threat?.signal || threat?.description || "", "");
    if (threatStr && hasOverlap(lower, threatStr.toLowerCase())) {
      contradictingSignals.push(threatStr.slice(0, 100));
      evidenceStrength -= 0.1;
    }
  }

  const objectionKeys = Object.keys(audience.objectionMap || {});
  for (const key of objectionKeys) {
    if (hasOverlap(lower, key.toLowerCase())) {
      contradictingSignals.push(`Objection: ${key}`);
      evidenceStrength -= 0.05;
    }
  }

  for (const pain of (audience.audiencePains || []).slice(0, 5)) {
    const painStr = typeof pain === "string" ? pain : safeString(pain?.pain || pain?.description || "", "");
    if (painStr && hasOverlap(lower, painStr.toLowerCase())) {
      supportingSignals.push(`Pain alignment: ${painStr.slice(0, 80)}`);
      evidenceStrength += 0.1;
    }
  }

  let crossEngineSignalCount = 0;

  for (const driver of (persuasion.primaryInfluenceDrivers || []).slice(0, 5)) {
    if (driver && hasOverlap(lower, driver.toLowerCase())) {
      supportingSignals.push(`Persuasion driver: ${driver.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }
  for (const seq of (persuasion.trustSequence || []).slice(0, 5)) {
    const seqStr = typeof seq === "string" ? seq : safeString(seq?.step || seq?.description || "", "");
    if (seqStr && hasOverlap(lower, seqStr.toLowerCase())) {
      supportingSignals.push(`Trust sequence: ${seqStr.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }
  for (const obj of (persuasion.structuredObjections || []).slice(0, 5)) {
    const objStr = typeof obj === "string" ? obj : safeString(obj?.objection || obj?.description || "", "");
    if (objStr && hasOverlap(lower, objStr.toLowerCase())) {
      supportingSignals.push(`Structured objection: ${objStr.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }

  const awarenessSignals = [
    awareness.triggerClass ? `Trigger: ${awareness.triggerClass}` : "",
    awareness.entryMechanismType ? `Entry: ${awareness.entryMechanismType}` : "",
    awareness.targetReadinessStage ? `Readiness: ${awareness.targetReadinessStage}` : "",
    awareness.funnelCompatibility ? `Compatibility: ${awareness.funnelCompatibility}` : "",
  ].filter(Boolean);
  for (const sig of awarenessSignals) {
    if (hasOverlap(lower, sig.toLowerCase())) {
      supportingSignals.push(`Awareness: ${sig.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }

  for (const del of (offer.deliverables || []).slice(0, 5)) {
    if (del && hasOverlap(lower, del.toLowerCase())) {
      supportingSignals.push(`Offer deliverable: ${del.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }
  for (const proof of (offer.proofAlignment || []).slice(0, 5)) {
    if (proof && hasOverlap(lower, proof.toLowerCase())) {
      supportingSignals.push(`Offer proof: ${proof.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }

  for (const tp of (funnel.trustPath || []).slice(0, 5)) {
    const tpStr = typeof tp === "string" ? tp : safeString(tp?.step || tp?.description || "", "");
    if (tpStr && hasOverlap(lower, tpStr.toLowerCase())) {
      supportingSignals.push(`Funnel trust path: ${tpStr.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }
  for (const pp of (funnel.proofPlacements || []).slice(0, 5)) {
    const ppStr = typeof pp === "string" ? pp : safeString(pp?.placement || pp?.description || "", "");
    if (ppStr && hasOverlap(lower, ppStr.toLowerCase())) {
      supportingSignals.push(`Funnel proof: ${ppStr.slice(0, 80)}`);
      evidenceStrength += 0.12;
      crossEngineSignalCount++;
    }
  }
  const triggerPurpose = safeString(funnel.entryTrigger?.purpose, "");
  if (triggerPurpose && hasOverlap(lower, triggerPurpose.toLowerCase())) {
    supportingSignals.push(`Funnel entry: ${triggerPurpose.slice(0, 80)}`);
    evidenceStrength += 0.12;
    crossEngineSignalCount++;
  }

  const hasMIOrAudienceSupport = supportingSignals.some(s =>
    !s.startsWith("Persuasion ") && !s.startsWith("Trust sequence:") &&
    !s.startsWith("Structured objection:") && !s.startsWith("Awareness:") &&
    !s.startsWith("Offer ") && !s.startsWith("Funnel ")
  );

  if (supportingSignals.length > 0 && !isNarrativeBased && hasMIOrAudienceSupport) {
    evidenceType = "signal";
    evidenceStrength += 0.2;
  } else if (supportingSignals.length > 0 && !isNarrativeBased && crossEngineSignalCount > 0) {
    evidenceType = "structured_inference";
    evidenceStrength = Math.max(evidenceStrength, 0.45);
  } else if (isNarrativeBased) {
    evidenceType = "narrative";
    evidenceStrength = Math.min(evidenceStrength, 0.4);
  } else if (isAssumptionBased) {
    evidenceType = "assumption";
    evidenceStrength = Math.min(evidenceStrength, 0.3);
  } else if (supportingSignals.length === 0 && contradictingSignals.length === 0) {
    evidenceType = "inferred";
    evidenceStrength = 0.25;
  }

  evidenceStrength = clamp(evidenceStrength, 0, 1);
  const validated = evidenceStrength >= CLAIM_CONFIDENCE_THRESHOLDS.PROVISIONAL && evidenceType !== "assumption";

  return {
    claim: claim.slice(0, 200),
    source,
    evidenceType,
    evidenceStrength,
    supportingSignals,
    contradictingSignals,
    validated,
  };
}

function hasOverlap(a: string, b: string): boolean {
  const wordsA = a.split(/\s+/).filter(w => w.length > 3);
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches >= 2;
}

function layer_evidenceDensity(
  mi: ValidationMIInput,
  audience: ValidationAudienceInput,
  offer: ValidationOfferInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const totalSignals = (mi.opportunitySignals || []).length + (mi.threatSignals || []).length;
  const objectionCount = Object.keys(audience.objectionMap || {}).length;
  const painCount = (audience.audiencePains || []).length;
  const proofCount = (offer.proofAlignment || []).length;

  const evidencePoints = totalSignals + objectionCount + painCount + proofCount;
  const density = clamp(evidencePoints / 15, 0, 1);

  if (density >= EVIDENCE_DENSITY_THRESHOLDS.STRONG) {
    score = 0.8 + density * 0.2;
    findings.push(`Strong evidence density: ${evidencePoints} data points across sources`);
  } else if (density >= EVIDENCE_DENSITY_THRESHOLDS.MODERATE) {
    score = 0.5 + density * 0.3;
    findings.push(`Moderate evidence density: ${evidencePoints} data points`);
  } else if (density >= EVIDENCE_DENSITY_THRESHOLDS.WEAK) {
    score = 0.3 + density * 0.2;
    warnings.push(`Low evidence density: only ${evidencePoints} data points — claims may be under-supported`);
  } else {
    score = 0.15;
    warnings.push(`Very low evidence density: ${evidencePoints} data points — insufficient for reliable validation`);
  }

  if (totalSignals < 2) warnings.push("MI signals insufficient for competitive validation");
  if (proofCount === 0) warnings.push("No proof alignment found in offer — claims lack proof backing");

  return {
    layerName: "evidence_density_assessment",
    passed: score >= 0.4,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_claimSignalAlignment(
  claimValidations: ClaimValidation[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  const validatedCount = claimValidations.filter(c => c.validated).length;
  const total = claimValidations.length || 1;
  const validationRate = validatedCount / total;

  let score = validationRate;

  if (validationRate >= 0.7) {
    findings.push(`${validatedCount}/${total} claims validated by real signals`);
    score = 0.7 + validationRate * 0.3;
  } else if (validationRate >= 0.4) {
    findings.push(`${validatedCount}/${total} claims partially validated`);
    warnings.push("Some claims lack signal support — review assumption-based claims");
  } else {
    warnings.push(`Only ${validatedCount}/${total} claims have signal support — high assumption risk`);
    score = Math.max(score, 0.15);
  }

  const contradictedClaims = claimValidations.filter(c => c.contradictingSignals.length > 0);
  if (contradictedClaims.length > 0) {
    warnings.push(`${contradictedClaims.length} claim(s) have contradicting signals`);
    score -= contradictedClaims.length * 0.05;
  }

  return {
    layerName: "claim_signal_alignment",
    passed: score >= 0.4,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_narrativeVsSignal(
  claimValidations: ClaimValidation[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  const narrativeClaims = claimValidations.filter(c => c.evidenceType === "narrative");
  const signalClaims = claimValidations.filter(c => c.evidenceType === "signal");
  const structuredInferenceClaims = claimValidations.filter(c => c.evidenceType === "structured_inference");
  const evidenceBackedCount = signalClaims.length + structuredInferenceClaims.length;
  const total = claimValidations.length || 1;

  const narrativeRatio = narrativeClaims.length / total;
  const evidenceBackedRatio = evidenceBackedCount / total;

  let score = 0.5;

  if (evidenceBackedRatio >= 0.6) {
    score = 0.8;
    findings.push(`Evidence-driven strategy: ${Math.round(evidenceBackedRatio * 100)}% of claims backed by signals or structured engine outputs`);
  } else if (narrativeRatio > 0.5) {
    score = 0.3;
    warnings.push(`Narrative-heavy strategy: ${Math.round(narrativeRatio * 100)}% of claims are narrative-based without signal support`);
  } else {
    score = 0.5 + evidenceBackedRatio * 0.3;
    findings.push(`Mixed evidence base: ${signalClaims.length} signal-backed, ${structuredInferenceClaims.length} engine-inferred, ${narrativeClaims.length} narrative-based`);
  }

  if (narrativeClaims.length > 3) {
    warnings.push("GUARD: High narrative claim count — strategy may be opinion-driven rather than evidence-driven");
    score -= 0.1;
  }

  return {
    layerName: "narrative_vs_signal_check",
    passed: score >= 0.35,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_assumptionDetection(
  claimValidations: ClaimValidation[],
  offer: ValidationOfferInput,
  persuasion: ValidationPersuasionInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  const assumptionFlags: string[] = [];

  const assumptionClaims = claimValidations.filter(c => c.evidenceType === "assumption");
  const inferredClaims = claimValidations.filter(c => c.evidenceType === "inferred");

  let score = 0.7;

  if (assumptionClaims.length > 0) {
    score -= assumptionClaims.length * 0.1;
    for (const ac of assumptionClaims) {
      assumptionFlags.push(`Assumption-based: "${ac.claim.slice(0, 80)}"`);
    }
    warnings.push(`${assumptionClaims.length} claim(s) are assumption-based — require signal validation`);
  }

  if (inferredClaims.length > 2) {
    score -= 0.1;
    warnings.push(`${inferredClaims.length} claim(s) are inferred without direct evidence`);
  }

  const offerText = `${offer.coreOutcome} ${offer.mechanismDescription}`.toLowerCase();
  for (const indicator of ASSUMPTION_INDICATORS) {
    if (offerText.includes(indicator)) {
      assumptionFlags.push(`Offer text contains assumption language: "${indicator}"`);
      score -= 0.05;
    }
  }

  if (assumptionFlags.length === 0) {
    findings.push("No critical assumptions detected in strategy claims");
    score = Math.max(score, 0.7);
  }

  return {
    layerName: "assumption_detection",
    passed: score >= 0.4,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_crossEngineConsistency(
  offer: ValidationOfferInput,
  funnel: ValidationFunnelInput,
  awareness: ValidationAwarenessInput,
  persuasion: ValidationPersuasionInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.6;

  const offerStrength = safeNumber(offer.offerStrengthScore, 0);
  const funnelStrength = safeNumber(funnel.funnelStrengthScore, 0);
  const awarenessStrength = safeNumber(awareness.awarenessStrengthScore, 0);
  const persuasionStrength = safeNumber(persuasion.persuasionStrengthScore, 0);

  const scores = [offerStrength, funnelStrength, awarenessStrength, persuasionStrength];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 0.15) {
    score = 0.8;
    findings.push(`Cross-engine consistency is strong (std dev: ${stdDev.toFixed(2)})`);
  } else if (stdDev < 0.25) {
    score = 0.6;
    findings.push(`Cross-engine consistency is moderate (std dev: ${stdDev.toFixed(2)})`);
  } else {
    score = 0.35;
    warnings.push(`Cross-engine inconsistency detected (std dev: ${stdDev.toFixed(2)}) — engine outputs diverge significantly`);
  }

  const weakEngines = scores.filter(s => s < 0.4);
  if (weakEngines.length > 1) {
    warnings.push(`${weakEngines.length} engines produced weak scores — overall strategy reliability compromised`);
    score -= 0.1;
  }

  if (offer.frictionLevel > 0.6 && persuasionStrength < 0.5) {
    warnings.push("High offer friction with weak persuasion — conversion path likely blocked");
    score -= 0.1;
  }

  return {
    layerName: "cross_engine_consistency",
    passed: score >= 0.4,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_proofStrengthValidation(
  offer: ValidationOfferInput,
  persuasion: ValidationPersuasionInput,
  awareness: ValidationAwarenessInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const proofCount = (offer.proofAlignment || []).length;
  const objectionProofLinks = persuasion.objectionProofLinks || [];
  const trustBarriers = persuasion.trustBarriers || [];
  const trustReq = safeString(awareness.trustRequirement, "medium");

  const resolvedObjections = objectionProofLinks.filter((l: any) => l.proofAvailable);
  const unresolvedObjections = objectionProofLinks.filter((l: any) => !l.proofAvailable);

  if (proofCount >= 3) {
    score += 0.2;
    findings.push(`Strong proof foundation: ${proofCount} proof elements aligned`);
  } else if (proofCount >= 1) {
    score += 0.1;
    findings.push(`Basic proof present: ${proofCount} proof element(s)`);
  } else {
    score -= 0.15;
    warnings.push("No proof elements in offer — claims are unsubstantiated");
  }

  if (resolvedObjections.length > 0) {
    score += clamp(resolvedObjections.length * 0.05, 0, 0.2);
    findings.push(`${resolvedObjections.length} objection(s) have proof resolution`);
  }

  if (unresolvedObjections.length > 2) {
    score -= 0.15;
    warnings.push(`${unresolvedObjections.length} objection(s) lack proof — trust gap detected`);
  }

  if (trustReq === "high" && proofCount < 2) {
    score -= 0.15;
    warnings.push("GUARD: High trust requirement with insufficient proof — strategy should not scale");
  }

  if (trustBarriers.length > 3) {
    score -= 0.1;
    warnings.push(`${trustBarriers.length} trust barriers detected — proof architecture may be insufficient`);
  }

  return {
    layerName: "proof_strength_validation",
    passed: score >= 0.35,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

function layer_confidenceCalibration(
  mi: ValidationMIInput,
  reliability: DataReliabilityDiagnostics,
  claimValidations: ClaimValidation[],
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const miConfidence = safeNumber(mi.overallConfidence, 0);
  const avgClaimStrength = claimValidations.length > 0
    ? claimValidations.reduce((sum, c) => {
        const strength = c.evidenceType === "structured_inference" ? Math.max(c.evidenceStrength, 0.4) : c.evidenceStrength;
        return sum + strength;
      }, 0) / claimValidations.length
    : 0;

  const confidenceGap = Math.abs(miConfidence - avgClaimStrength);

  if (confidenceGap < 0.15) {
    score = 0.8;
    findings.push(`Confidence calibration aligned: MI (${(miConfidence * 100).toFixed(0)}%) vs claims (${(avgClaimStrength * 100).toFixed(0)}%)`);
  } else if (confidenceGap < 0.3) {
    score = 0.5;
    warnings.push(`Moderate confidence gap: MI (${(miConfidence * 100).toFixed(0)}%) vs claims (${(avgClaimStrength * 100).toFixed(0)}%)`);
  } else {
    score = 0.25;
    warnings.push(`GUARD: Large confidence gap: MI reports ${(miConfidence * 100).toFixed(0)}% but claims only supported at ${(avgClaimStrength * 100).toFixed(0)}%`);
  }

  if (reliability.isWeak) {
    score -= 0.15;
    warnings.push("Data reliability is weak — all confidence values should be treated as provisional");
  }

  return {
    layerName: "confidence_calibration",
    passed: score >= 0.35,
    score: clamp(score, 0, 1),
    findings,
    warnings,
  };
}

export async function runStatisticalValidationEngine(
  mi: ValidationMIInput,
  audience: ValidationAudienceInput,
  offer: ValidationOfferInput,
  funnel: ValidationFunnelInput,
  awareness: ValidationAwarenessInput,
  persuasion: ValidationPersuasionInput,
  accountId: string,
): Promise<StatisticalValidationResult> {
  const startTime = Date.now();

  const reliability = assessDataReliability(mi, audience, offer, funnel, awareness, persuasion);

  const allText = [
    offer.coreOutcome || "",
    offer.mechanismDescription || "",
    awareness.triggerClass || "",
    persuasion.persuasionMode || "",
  ].join(" ");

  const boundaryResult = enforceBoundaryWithSanitization(allText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);

  if (!boundaryResult.clean) {
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: "Statistical validation output violated boundary protections",
      claimConfidenceScore: 0,
      evidenceStrength: 0,
      validationState: "rejected",
      assumptionFlags: [],
      claimValidations: [],
      layerResults: [],
      structuralWarnings: boundaryResult.violations,
      boundaryCheck: { passed: false, violations: boundaryResult.violations },
      dataReliability: reliability,
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
    };
  }

  const claims = extractClaims(offer, persuasion, awareness);
  const claimValidations = claims.map(c => validateClaim(c.claim, c.source, mi, audience, offer, funnel, awareness, persuasion));

  const layers: LayerResult[] = [];

  layers.push(layer_evidenceDensity(mi, audience, offer));
  layers.push(layer_claimSignalAlignment(claimValidations));
  layers.push(layer_narrativeVsSignal(claimValidations));
  layers.push(layer_assumptionDetection(claimValidations, offer, persuasion));
  layers.push(layer_crossEngineConsistency(offer, funnel, awareness, persuasion));
  layers.push(layer_proofStrengthValidation(offer, persuasion, awareness));
  layers.push(layer_confidenceCalibration(mi, reliability, claimValidations));

  let weightedScore = 0;
  for (const layer of layers) {
    const weight = LAYER_WEIGHTS[layer.layerName] || 0.1;
    weightedScore += layer.score * weight;
  }
  weightedScore = clamp(weightedScore, 0, 1);

  const structuralWarnings: string[] = [];
  for (const layer of layers) {
    if (!layer.passed) {
      structuralWarnings.push(`Layer "${layer.layerName}" failed (score: ${(layer.score * 100).toFixed(0)}%)`);
    }
    structuralWarnings.push(...layer.warnings);
  }
  structuralWarnings.push(...reliability.advisories);

  const assumptionFlags: string[] = [];
  for (const cv of claimValidations) {
    if (cv.evidenceType === "assumption") {
      assumptionFlags.push(`Assumption: "${cv.claim.slice(0, 80)}" — no signal support`);
    }
  }

  const narrativeClaims = claimValidations.filter(c => c.evidenceType === "narrative");
  if (narrativeClaims.length > 0) {
    for (const nc of narrativeClaims) {
      assumptionFlags.push(`Narrative claim: "${nc.claim.slice(0, 80)}" — needs signal validation`);
    }
  }

  let confidenceNormalized = false;
  let claimConfidenceScore = weightedScore;
  if (reliability.isWeak || reliability.overallReliability < 0.6) {
    claimConfidenceScore = normalizeConfidence(weightedScore, reliability);
    confidenceNormalized = true;
  }

  const avgEvidenceStrength = claimValidations.length > 0
    ? claimValidations.reduce((sum, c) => sum + c.evidenceStrength, 0) / claimValidations.length
    : 0;
  const evidenceStrength = clamp(avgEvidenceStrength, 0, 1);

  let validationState: StatisticalValidationResult["validationState"];
  if (claimConfidenceScore >= CLAIM_CONFIDENCE_THRESHOLDS.VALIDATED && evidenceStrength >= EVIDENCE_DENSITY_THRESHOLDS.MODERATE) {
    validationState = VALIDATION_STATES.VALIDATED as "validated";
  } else if (claimConfidenceScore >= CLAIM_CONFIDENCE_THRESHOLDS.PROVISIONAL) {
    validationState = VALIDATION_STATES.PROVISIONAL as "provisional";
  } else if (claimConfidenceScore >= CLAIM_CONFIDENCE_THRESHOLDS.WEAK) {
    validationState = VALIDATION_STATES.WEAK as "weak";
  } else {
    validationState = VALIDATION_STATES.REJECTED as "rejected";
  }

  if (validationState === "rejected" || validationState === "weak") {
    structuralWarnings.push("FALLBACK: Strategy marked as provisional — evidence is weak, use conservative defaults");
  }

  const layersPassed = layers.filter(l => l.passed).length;
  const strategyAcceptability = assessStrategyAcceptability(
    claimConfidenceScore,
    layersPassed,
    layers.length,
    validationState !== "rejected",
    structuralWarnings,
  );

  return {
    status: STATUS.COMPLETE,
    statusMessage: validationState === "validated"
      ? "Strategy claims validated with sufficient evidence"
      : validationState === "provisional"
        ? "Strategy claims partially validated — treat as provisional"
        : validationState === "weak"
          ? "Strategy evidence is weak — significant gaps detected"
          : "Strategy validation failed — insufficient evidence for claims",
    claimConfidenceScore,
    evidenceStrength,
    validationState,
    assumptionFlags,
    claimValidations,
    layerResults: layers,
    structuralWarnings,
    boundaryCheck: {
      passed: boundaryResult.clean,
      violations: boundaryResult.violations,
      sanitized: boundaryResult.sanitized,
      sanitizedText: boundaryResult.sanitizedText,
      warnings: boundaryResult.warnings,
    },
    dataReliability: reliability,
    confidenceNormalized,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    strategyAcceptability,
  };
}
