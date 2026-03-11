import {
  ENGINE_VERSION,
  STATUS,
  CHANNEL_DEFINITIONS,
  AWARENESS_CHANNEL_MAP,
  PERSUASION_CHANNEL_COMPATIBILITY,
  LAYER_WEIGHTS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
} from "./constants";
import { enforceBoundaryWithSanitization } from "../../engine-hardening";
import type {
  ChannelAudienceInput,
  ChannelAwarenessInput,
  ChannelPersuasionInput,
  ChannelOfferInput,
  ChannelBudgetInput,
  ChannelValidationInput,
  ChannelCandidate,
  LayerResult,
  DataReliabilityDiagnostics,
  ChannelSelectionResult,
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
  audience: ChannelAudienceInput,
  awareness: ChannelAwarenessInput | null,
  persuasion: ChannelPersuasionInput | null,
  offer: ChannelOfferInput | null,
  budget: ChannelBudgetInput | null,
  validation: ChannelValidationInput | null,
): DataReliabilityDiagnostics {
  const advisories: string[] = [];

  const segmentCount = (audience.audienceSegments || []).length;
  const painCount = (audience.audiencePains || []).length;
  const driverCount = (audience.emotionalDrivers || []).length;
  const totalSignals = segmentCount + painCount + driverCount;
  const signalDensity = clamp(totalSignals / 10, 0, 1);
  if (totalSignals < 3) advisories.push(`Low audience signal density: ${totalSignals} signals`);

  let diversityCount = 0;
  if (audience.audienceSegments?.length > 0) diversityCount++;
  if (audience.audiencePains?.length > 0) diversityCount++;
  if (audience.emotionalDrivers?.length > 0) diversityCount++;
  if (awareness) diversityCount++;
  if (persuasion) diversityCount++;
  if (offer) diversityCount++;
  if (budget) diversityCount++;
  if (validation) diversityCount++;
  const signalDiversity = clamp(diversityCount / 6, 0, 1);

  const hasAwareness = !!awareness;
  const hasPersuasion = !!persuasion;
  const narrativeStability = (hasAwareness ? 0.5 : 0) + (hasPersuasion ? 0.5 : 0);
  if (narrativeStability < 0.5) advisories.push("Weak upstream stability: awareness or persuasion data missing");

  const validationConfidence = validation ? safeNumber(validation.claimConfidenceScore, 0.5) : 0.5;
  const competitorValidity = clamp(validationConfidence, 0, 1);

  const maturity = safeNumber(audience.maturityIndex, 0.5);
  const marketMaturityConfidence = maturity > 0.1 ? clamp(0.5 + maturity * 0.5, 0, 1) : 0.3;

  const overallReliability =
    signalDensity * 0.25 +
    signalDiversity * 0.20 +
    narrativeStability * 0.20 +
    competitorValidity * 0.20 +
    marketMaturityConfidence * 0.15;

  const isWeak = overallReliability < 0.45;
  if (isWeak) advisories.push(`Data reliability WEAK (${overallReliability.toFixed(2)}) — confidence scores capped`);

  return {
    signalDensity,
    signalDiversity,
    narrativeStability,
    competitorValidity,
    marketMaturityConfidence,
    overallReliability,
    isWeak,
    advisories,
  };
}

function scoreAudienceDensity(audience: ChannelAudienceInput, channelKey: string): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  const segmentCount = (audience.audienceSegments || []).length;
  const painCount = (audience.audiencePains || []).length;

  const densityScore = clamp((segmentCount * 0.3 + painCount * 0.2) / 3, 0, 1);

  if (segmentCount === 0) warnings.push("No audience segments defined — channel targeting will be generic");
  if (painCount === 0) warnings.push("No audience pains identified — messaging alignment uncertain");

  findings.push(`Audience density score for ${channelKey}: ${densityScore.toFixed(2)}`);
  findings.push(`Segments: ${segmentCount}, Pains: ${painCount}`);

  return {
    layerName: "audience_density_assessment",
    passed: densityScore >= 0.3,
    score: densityScore,
    findings,
    warnings,
  };
}

function scoreAwarenessMapping(awareness: ChannelAwarenessInput | null, channelDef: { type: string }): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!awareness) {
    return {
      layerName: "awareness_channel_mapping",
      passed: false,
      score: 0.3,
      findings: ["No awareness data — using default channel mapping"],
      warnings: ["Awareness input missing — channel selection less precise"],
    };
  }

  const stage = safeString(awareness.targetReadinessStage, "problem_aware");
  const compatibleTypes = AWARENESS_CHANNEL_MAP[stage] || AWARENESS_CHANNEL_MAP["problem_aware"];
  const isCompatible = compatibleTypes.includes(channelDef.type);
  const score = isCompatible ? 0.8 : 0.35;

  findings.push(`Awareness stage: ${stage}`);
  findings.push(`Channel type ${channelDef.type} ${isCompatible ? "compatible" : "mismatched"} with stage`);

  if (!isCompatible) {
    warnings.push(`Channel type "${channelDef.type}" is not optimal for "${stage}" awareness stage`);
  }

  return {
    layerName: "awareness_channel_mapping",
    passed: isCompatible,
    score,
    findings,
    warnings,
  };
}

function scorePersuasionCompatibility(persuasion: ChannelPersuasionInput | null, channelDef: { type: string }): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!persuasion) {
    return {
      layerName: "persuasion_mode_compatibility",
      passed: true,
      score: 0.5,
      findings: ["No persuasion data — assuming neutral compatibility"],
      warnings: ["Persuasion input missing — cannot verify mode alignment"],
    };
  }

  const mode = safeString(persuasion.persuasionMode, "trust_building");
  const compatibleTypes = PERSUASION_CHANNEL_COMPATIBILITY[mode] || [];
  const isCompatible = compatibleTypes.includes(channelDef.type);
  const modeStrength = safeNumber(persuasion.persuasionStrengthScore, 0.5);
  const score = isCompatible ? clamp(0.6 + modeStrength * 0.3, 0, 1) : 0.3;

  findings.push(`Persuasion mode: ${mode}, strength: ${modeStrength.toFixed(2)}`);
  findings.push(`Channel compatibility: ${isCompatible ? "aligned" : "mismatched"}`);

  if (!isCompatible) {
    warnings.push(`Persuasion mode "${mode}" has poor fit with channel type "${channelDef.type}"`);
  }

  return {
    layerName: "persuasion_mode_compatibility",
    passed: isCompatible,
    score,
    findings,
    warnings,
  };
}

function checkBudgetConstraint(budget: ChannelBudgetInput | null, channelDef: { minBudget: number; label: string }): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!budget) {
    return {
      layerName: "budget_constraint_check",
      passed: true,
      score: 0.5,
      findings: ["No budget data — skipping budget constraint check"],
      warnings: ["Budget input missing — cannot verify affordability"],
    };
  }

  const maxAvailable = budget.testBudgetMax || budget.scaleBudgetMax || 0;
  const canAfford = channelDef.minBudget === 0 || maxAvailable >= channelDef.minBudget;
  const score = canAfford ? (budget.killFlag ? 0.2 : 0.8) : 0.1;

  findings.push(`Channel "${channelDef.label}" min budget: $${channelDef.minBudget}`);
  findings.push(`Available budget: $${maxAvailable}`);

  if (!canAfford) {
    warnings.push(`Budget insufficient for "${channelDef.label}" — requires $${channelDef.minBudget}, available $${maxAvailable}`);
  }

  if (budget.killFlag) {
    warnings.push("Budget kill flag is active — expansion blocked");
  }

  return {
    layerName: "budget_constraint_check",
    passed: canAfford && !budget.killFlag,
    score,
    findings,
    warnings,
  };
}

function scoreCostEfficiency(channelDef: { baseEfficiency: number; label: string }, offer: ChannelOfferInput | null): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  let efficiency = channelDef.baseEfficiency;
  if (offer) {
    const offerStrength = safeNumber(offer.offerStrengthScore, 0.5);
    const frictionPenalty = safeNumber(offer.frictionLevel, 0.5) * 0.15;
    efficiency = clamp(efficiency * (0.7 + offerStrength * 0.3) - frictionPenalty, 0, 1);
  }

  findings.push(`Base efficiency: ${channelDef.baseEfficiency.toFixed(2)}`);
  findings.push(`Adjusted efficiency: ${efficiency.toFixed(2)}`);

  if (efficiency < 0.4) {
    warnings.push(`Low cost efficiency (${efficiency.toFixed(2)}) for "${channelDef.label}"`);
  }

  return {
    layerName: "cost_efficiency_scoring",
    passed: efficiency >= 0.4,
    score: efficiency,
    findings,
    warnings,
  };
}

function assessRisk(validation: ChannelValidationInput | null, channelDef: { type: string; label: string }): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  let riskScore = 0.7;
  if (validation) {
    const evidenceStrength = safeNumber(validation.evidenceStrength, 0.5);
    const claimConfidence = safeNumber(validation.claimConfidenceScore, 0.5);
    riskScore = clamp((evidenceStrength + claimConfidence) / 2, 0, 1);

    if (validation.assumptionFlags?.length > 0) {
      riskScore -= validation.assumptionFlags.length * 0.05;
      riskScore = clamp(riskScore, 0, 1);
      warnings.push(`${validation.assumptionFlags.length} assumption flag(s) detected — risk elevated`);
    }
  }

  const paidChannels = ["social_paid", "search_paid"];
  if (paidChannels.includes(channelDef.type) && riskScore < 0.5) {
    warnings.push(`Paid channel "${channelDef.label}" has high risk with low validation confidence`);
  }

  findings.push(`Risk assessment score: ${riskScore.toFixed(2)} for "${channelDef.label}"`);

  return {
    layerName: "risk_assessment",
    passed: riskScore >= 0.4,
    score: riskScore,
    findings,
    warnings,
  };
}

function runGuardLayer(
  audience: ChannelAudienceInput,
  persuasion: ChannelPersuasionInput | null,
  budget: ChannelBudgetInput | null,
  validation: ChannelValidationInput | null,
  channelDef: { type: string; label: string },
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let passed = true;

  const segmentCount = (audience.audienceSegments || []).length;
  if (segmentCount === 0) {
    warnings.push("GUARD: No audience segments — channel targeting unreliable");
  }

  if (persuasion) {
    const mode = safeString(persuasion.persuasionMode, "");
    const compatibleTypes = PERSUASION_CHANNEL_COMPATIBILITY[mode] || [];
    if (mode && !compatibleTypes.includes(channelDef.type)) {
      findings.push(`GUARD: Persuasion mode "${mode}" incompatible with "${channelDef.type}"`);
    }
  }

  if (budget && budget.killFlag) {
    passed = false;
    findings.push("GUARD: Budget kill flag active — channel blocked from scaling");
  }

  const paidChannels = ["social_paid", "search_paid"];
  if (paidChannels.includes(channelDef.type) && validation) {
    const cacLimit = budget ? budget.testBudgetMax * 0.5 : 500;
    if (safeNumber(validation.claimConfidenceScore, 0) < 0.4) {
      warnings.push(`GUARD: Low claim confidence (${validation.claimConfidenceScore}) for paid channel — acquisition cost may exceed limits`);
    }
    findings.push(`CAC limit check: $${cacLimit}`);
  }

  return {
    layerName: "guard_layer",
    passed,
    score: passed ? 0.8 : 0.2,
    findings,
    warnings,
  };
}

function buildChannelCandidate(
  channelKey: string,
  layers: LayerResult[],
  reliability: DataReliabilityDiagnostics,
): ChannelCandidate {
  const def = CHANNEL_DEFINITIONS[channelKey];
  if (!def) {
    return {
      channelName: channelKey,
      channelType: "social_organic",
      fitScore: 0,
      audienceDensityScore: 0,
      persuasionCompatibility: 0,
      costEfficiency: 0,
      riskLevel: "critical",
      riskNotes: ["Unknown channel"],
      rejectionReason: "Channel definition not found",
      estimatedCac: null,
      recommendedBudgetAllocation: 0,
    };
  }

  const weightedScore = layers.reduce((sum, layer) => {
    const weight = LAYER_WEIGHTS[layer.layerName] || 0.1;
    return sum + layer.score * weight;
  }, 0);

  let fitScore = clamp(weightedScore, 0, 1);
  if (reliability.isWeak) {
    fitScore = Math.min(fitScore * 0.7, 0.65);
  }

  const audienceLayer = layers.find(l => l.layerName === "audience_density_assessment");
  const persuasionLayer = layers.find(l => l.layerName === "persuasion_mode_compatibility");
  const efficiencyLayer = layers.find(l => l.layerName === "cost_efficiency_scoring");
  const riskLayer = layers.find(l => l.layerName === "risk_assessment");

  const riskScore = riskLayer?.score ?? 0.5;
  let riskLevel: "low" | "moderate" | "high" | "critical" = "moderate";
  if (riskScore >= 0.7) riskLevel = "low";
  else if (riskScore >= 0.5) riskLevel = "moderate";
  else if (riskScore >= 0.3) riskLevel = "high";
  else riskLevel = "critical";

  const allWarnings = layers.flatMap(l => l.warnings);
  const guardLayer = layers.find(l => l.layerName === "guard_layer");
  const rejected = guardLayer && !guardLayer.passed;

  return {
    channelName: def.label,
    channelType: def.type as ChannelCandidate["channelType"],
    fitScore,
    audienceDensityScore: audienceLayer?.score ?? 0,
    persuasionCompatibility: persuasionLayer?.score ?? 0,
    costEfficiency: efficiencyLayer?.score ?? 0,
    riskLevel,
    riskNotes: allWarnings,
    rejectionReason: rejected ? "Blocked by guard layer" : null,
    estimatedCac: null,
    recommendedBudgetAllocation: fitScore > 0.5 ? clamp(fitScore * 100, 10, 60) : 5,
  };
}

export function runChannelSelectionEngine(
  audience: ChannelAudienceInput,
  awareness: ChannelAwarenessInput | null,
  persuasion: ChannelPersuasionInput | null,
  offer: ChannelOfferInput | null,
  budget: ChannelBudgetInput | null,
  validation: ChannelValidationInput | null,
): ChannelSelectionResult {
  const startTime = Date.now();
  const structuralWarnings: string[] = [];

  const reliability = assessDataReliability(audience, awareness, persuasion, offer, budget, validation);

  const channelKeys = Object.keys(CHANNEL_DEFINITIONS);
  const candidates: { key: string; candidate: ChannelCandidate; layers: LayerResult[] }[] = [];

  for (const channelKey of channelKeys) {
    const def = CHANNEL_DEFINITIONS[channelKey];
    const layers: LayerResult[] = [
      scoreAudienceDensity(audience, channelKey),
      scoreAwarenessMapping(awareness, def),
      scorePersuasionCompatibility(persuasion, def),
      checkBudgetConstraint(budget, def),
      scoreCostEfficiency(def, offer),
      assessRisk(validation, def),
      runGuardLayer(audience, persuasion, budget, validation, def),
    ];

    const fitLayer: LayerResult = {
      layerName: "channel_fit_scoring",
      passed: true,
      score: layers.reduce((s, l) => s + l.score, 0) / layers.length,
      findings: [`Composite fit score for ${def.label}`],
      warnings: [],
    };
    layers.push(fitLayer);

    const candidate = buildChannelCandidate(channelKey, layers, reliability);
    candidates.push({ key: channelKey, candidate, layers });
  }

  const viable = candidates.filter(c => !c.candidate.rejectionReason);
  const rejected = candidates.filter(c => !!c.candidate.rejectionReason);

  viable.sort((a, b) => b.candidate.fitScore - a.candidate.fitScore);

  const primary = viable[0]?.candidate || rejected[0]?.candidate || buildFallbackChannel("primary");
  const secondary = viable[1]?.candidate || viable[0]?.candidate || buildFallbackChannel("secondary");
  const rejectedChannels = rejected.map(r => r.candidate);

  const primaryLayers = viable[0]?.layers || candidates[0]?.layers || [];

  const combinedText = JSON.stringify({ primary, secondary });
  const boundaryResult = enforceBoundaryWithSanitization(combinedText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  const boundaryCheck = {
    passed: boundaryResult.clean,
    violations: boundaryResult.violations,
    sanitized: boundaryResult.sanitized,
    sanitizedText: boundaryResult.sanitizedText,
    warnings: boundaryResult.warnings,
  };

  if (!boundaryResult.clean) {
    structuralWarnings.push(...boundaryResult.violations);
  }

  let confidenceScore = primary.fitScore;
  if (reliability.isWeak) {
    confidenceScore = Math.min(confidenceScore * 0.6, 0.65);
  }

  const channelRiskNotes = [
    ...primary.riskNotes.slice(0, 5),
    ...secondary.riskNotes.slice(0, 3),
  ];

  if (viable.length === 0) {
    structuralWarnings.push("No viable channels found — all channels rejected by guard layer");
  }

  const status = viable.length > 0
    ? (reliability.isWeak ? STATUS.FALLBACK : STATUS.COMPLETE)
    : STATUS.GUARD_BLOCKED;

  return {
    status,
    statusMessage: viable.length > 0
      ? `Channel selection complete — ${viable.length} viable channel(s) identified`
      : "All channels blocked by guard layer — review inputs",
    primaryChannel: primary,
    secondaryChannel: secondary,
    rejectedChannels,
    channelFitScore: primary.fitScore,
    channelRiskNotes,
    layerResults: primaryLayers,
    structuralWarnings,
    boundaryCheck,
    dataReliability: reliability,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
  };
}

function buildFallbackChannel(role: string): ChannelCandidate {
  return {
    channelName: `Fallback ${role} channel`,
    channelType: "social_organic",
    fitScore: 0.3,
    audienceDensityScore: 0,
    persuasionCompatibility: 0,
    costEfficiency: 0.5,
    riskLevel: "high",
    riskNotes: ["Fallback channel — insufficient data for proper selection"],
    rejectionReason: null,
    estimatedCac: null,
    recommendedBudgetAllocation: 10,
  };
}
