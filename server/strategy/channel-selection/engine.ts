import {
  ENGINE_VERSION,
  STATUS,
  CHANNEL_DEFINITIONS,
  AWARENESS_CHANNEL_MAP,
  PERSUASION_CHANNEL_COMPATIBILITY,
  PERSUASION_COMPATIBILITY_THRESHOLD,
  LAYER_WEIGHTS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  OBJECTIVE_FIT_MATRIX,
  CHANNEL_DIFFERENTIATION_PROFILES,
  ORGANIC_CHANNELS,
  PAID_CHANNELS,
  CHANNEL_FUNNEL_CAPABILITIES,
  FUNNEL_ROLE_THRESHOLDS,
  CONVERSION_INJECTION_PRIORITY,
  PERSUASION_CORRECTION_FLOOR,
  CHANNEL_SCALABILITY,
  CHANNEL_ROLE_REGISTRY,
  AWARENESS_STAGE_ALLOWED_ROLES,
  AWARENESS_BLOCKED_CHANNEL_TYPES,
  AWARENESS_INJECTION_PRIORITY,
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
  ObjectiveFitScores,
  DecisionGateResult,
  DecisionGateOutcome,
  ChannelDifferentiation,
  FunnelRole,
  FunnelStageAssignment,
  FunnelReconstructionResult,
  ChannelMode,
  DecisionGateScoring,
  CorrectionAuditEntry,
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

function enforceAwarenessConstraint(
  awareness: ChannelAwarenessInput | null,
  channelKey: string,
  channelDef: { type: string; label: string },
): { allowed: boolean; blocked: boolean; blockReason: string | null; role: string | null; diagnostics: string[] } {
  const diagnostics: string[] = [];

  if (!awareness) {
    diagnostics.push("No awareness data — awareness constraint not enforced");
    return { allowed: true, blocked: false, blockReason: null, role: null, diagnostics };
  }

  const stage = safeString(awareness.targetReadinessStage, "problem_aware").toLowerCase().trim();
  const registry = CHANNEL_ROLE_REGISTRY[channelKey];

  if (!registry) {
    diagnostics.push(`No role registry entry for "${channelKey}" — channel allowed with advisory`);
    return { allowed: true, blocked: false, blockReason: null, role: null, diagnostics };
  }

  if (registry.blockedAwarenessStages.includes(stage)) {
    const blockReason = `AWARENESS_BLOCKED: "${channelDef.label}" (role: ${registry.role}) is blocked for "${stage}" audience — ${registry.restrictionRules[0] || "awareness stage mismatch"}`;
    diagnostics.push(blockReason);
    return { allowed: false, blocked: true, blockReason, role: registry.role, diagnostics };
  }

  const blockedTypes = AWARENESS_BLOCKED_CHANNEL_TYPES[stage] || [];
  if (blockedTypes.includes(channelDef.type)) {
    const blockReason = `AWARENESS_TYPE_BLOCKED: Channel type "${channelDef.type}" is blocked for "${stage}" audience stage`;
    diagnostics.push(blockReason);
    return { allowed: false, blocked: true, blockReason, role: registry.role, diagnostics };
  }

  const allowedRoles = AWARENESS_STAGE_ALLOWED_ROLES[stage] || ["discovery", "nurture", "conversion"];
  if (!allowedRoles.includes(registry.role)) {
    const blockReason = `AWARENESS_ROLE_BLOCKED: Channel role "${registry.role}" is not allowed for "${stage}" audience — only [${allowedRoles.join(", ")}] permitted`;
    diagnostics.push(blockReason);
    return { allowed: false, blocked: true, blockReason, role: registry.role, diagnostics };
  }

  if (registry.allowedAwarenessStages.includes(stage)) {
    diagnostics.push(`Channel "${channelDef.label}" (role: ${registry.role}) ALLOWED for "${stage}" audience`);
    return { allowed: true, blocked: false, blockReason: null, role: registry.role, diagnostics };
  }

  diagnostics.push(`Channel "${channelDef.label}" not explicitly listed for "${stage}" — allowed by role compatibility`);
  return { allowed: true, blocked: false, blockReason: null, role: registry.role, diagnostics };
}

function scoreAwarenessMapping(awareness: ChannelAwarenessInput | null, channelKey: string, channelDef: { type: string; label: string }): { layer: LayerResult; awarenessBlocked: boolean; awarenessBlockReason: string | null } {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!awareness) {
    return {
      layer: {
        layerName: "awareness_channel_mapping",
        passed: false,
        score: 0.3,
        findings: ["No awareness data — using default channel mapping"],
        warnings: ["Awareness input missing — channel selection less precise"],
      },
      awarenessBlocked: false,
      awarenessBlockReason: null,
    };
  }

  const constraint = enforceAwarenessConstraint(awareness, channelKey, channelDef);
  findings.push(...constraint.diagnostics);

  if (constraint.blocked) {
    return {
      layer: {
        layerName: "awareness_channel_mapping",
        passed: false,
        score: 0,
        findings,
        warnings: [constraint.blockReason!],
      },
      awarenessBlocked: true,
      awarenessBlockReason: constraint.blockReason,
    };
  }

  const stage = safeString(awareness.targetReadinessStage, "problem_aware");
  const compatibleTypes = AWARENESS_CHANNEL_MAP[stage] || AWARENESS_CHANNEL_MAP["problem_aware"];
  const isTypeCompatible = compatibleTypes.includes(channelDef.type);
  const score = isTypeCompatible ? 0.85 : 0.45;

  findings.push(`Awareness stage: ${stage}`);
  findings.push(`Channel type "${channelDef.type}" ${isTypeCompatible ? "compatible" : "sub-optimal"} for stage`);
  if (constraint.role) {
    findings.push(`Channel role: ${constraint.role}`);
  }

  if (!isTypeCompatible) {
    warnings.push(`Channel type "${channelDef.type}" is sub-optimal for "${stage}" awareness stage — allowed but lower priority`);
  }

  return {
    layer: {
      layerName: "awareness_channel_mapping",
      passed: isTypeCompatible,
      score,
      findings,
      warnings,
    },
    awarenessBlocked: false,
    awarenessBlockReason: null,
  };
}

function scorePersuasionCompatibility(
  persuasion: ChannelPersuasionInput | null,
  channelDef: { type: string },
  channelKey: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  if (!persuasion) {
    return {
      layerName: "persuasion_mode_compatibility",
      passed: false,
      score: 0.3,
      findings: ["No persuasion data — compatibility cannot be verified"],
      warnings: ["Persuasion input missing — channel may be incompatible with persuasion strategy"],
    };
  }

  const mode = safeString(persuasion.persuasionMode, "trust_building");
  const compatibleTypes = PERSUASION_CHANNEL_COMPATIBILITY[mode] || [];
  const isCompatible = compatibleTypes.includes(channelDef.type);
  const modeStrength = safeNumber(persuasion.persuasionStrengthScore, 0.5);

  let score: number;
  if (isCompatible) {
    score = clamp(0.6 + modeStrength * 0.3, 0, 1);
  } else {
    const cap = CHANNEL_FUNNEL_CAPABILITIES[channelKey];
    const funnelBonus = cap ? Math.max(cap.awareness, cap.nurture, cap.conversion) * 0.1 : 0;
    const contentFormatBonus = getContentFormatBonus(channelDef.type, mode);
    score = clamp(0.15 + modeStrength * 0.1 + funnelBonus + contentFormatBonus, 0, PERSUASION_CORRECTION_FLOOR);
  }

  findings.push(`Persuasion mode: ${mode}, strength: ${modeStrength.toFixed(2)}`);
  findings.push(`Channel compatibility: ${isCompatible ? "aligned" : "MISMATCHED — deferred to funnel resolution"}`);
  findings.push(`Persuasion compatibility score: ${(score * 100).toFixed(0)}%`);

  if (!isCompatible) {
    warnings.push(`Persuasion mode "${mode}" incompatible with channel type "${channelDef.type}" — funnel reconstruction will evaluate role suitability`);
  }

  if (score < PERSUASION_COMPATIBILITY_THRESHOLD) {
    warnings.push(`Persuasion compatibility (${(score * 100).toFixed(0)}%) below ${(PERSUASION_COMPATIBILITY_THRESHOLD * 100).toFixed(0)}% threshold — channel deferred to funnel layer`);
  }

  return {
    layerName: "persuasion_mode_compatibility",
    passed: isCompatible && score >= PERSUASION_COMPATIBILITY_THRESHOLD,
    score,
    findings,
    warnings,
  };
}

function getContentFormatBonus(channelType: string, persuasionMode: string): number {
  const longFormChannels = ["content_platform", "email", "community"];
  const visualChannels = ["social_organic", "social_paid"];
  const intentChannels = ["search_paid", "search_organic"];

  if (["education_first", "trust_building"].includes(persuasionMode) && longFormChannels.includes(channelType)) return 0.08;
  if (["proof_driven", "scarcity_urgency"].includes(persuasionMode) && visualChannels.includes(channelType)) return 0.05;
  if (["proof_driven"].includes(persuasionMode) && intentChannels.includes(channelType)) return 0.07;
  return 0;
}

function checkBudgetConstraint(budget: ChannelBudgetInput | null, channelDef: { minBudget: number; label: string }, channelKey: string): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  const isOrganic = ORGANIC_CHANNELS.has(channelKey);

  if (!budget) {
    return {
      layerName: "budget_constraint_check",
      passed: true,
      score: isOrganic ? 0.7 : 0.5,
      findings: [isOrganic ? "Organic channel — budget informational only" : "No budget data — skipping budget constraint check"],
      warnings: isOrganic ? [] : ["Budget input missing — cannot verify affordability"],
    };
  }

  if (isOrganic) {
    findings.push(`Organic channel "${channelDef.label}" — budget allocation is informational only, not financial`);
    return {
      layerName: "budget_constraint_check",
      passed: true,
      score: 0.75,
      findings,
      warnings,
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
      findings.push(`GUARD NOTE: Persuasion mode "${mode}" incompatible with "${channelDef.type}" — deferred to Funnel Resolution Layer`);
      warnings.push(`Persuasion incompatibility detected for "${channelDef.label}" — funnel reconstruction may reassign channel role`);
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

function determineBestFunnelRole(channelKey: string): { role: FunnelRole; score: number } {
  const cap = CHANNEL_FUNNEL_CAPABILITIES[channelKey];
  if (!cap) return { role: "awareness", score: 0.3 };

  const roles: { role: FunnelRole; score: number }[] = [
    { role: "awareness", score: cap.awareness },
    { role: "nurture", score: cap.nurture },
    { role: "conversion", score: cap.conversion },
  ];

  roles.sort((a, b) => b.score - a.score);
  return roles[0];
}

function isPersuasionIncompatible(persuasionLayer: LayerResult): boolean {
  return !persuasionLayer.passed || persuasionLayer.score < PERSUASION_COMPATIBILITY_THRESHOLD;
}

function attemptPersuasionCorrection(
  channelKey: string,
  persuasionLayer: LayerResult,
  persuasion: ChannelPersuasionInput | null,
): { corrected: boolean; newScore: number; correctionLog: string } {
  if (!persuasion || persuasionLayer.score >= PERSUASION_COMPATIBILITY_THRESHOLD) {
    return { corrected: false, newScore: persuasionLayer.score, correctionLog: "" };
  }

  const cap = CHANNEL_FUNNEL_CAPABILITIES[channelKey];
  if (!cap) {
    return { corrected: false, newScore: persuasionLayer.score, correctionLog: `${channelKey}: No funnel capabilities — correction not possible` };
  }

  const bestRole = determineBestFunnelRole(channelKey);
  const roleFit = bestRole.score;
  const depthBonus = cap.persuasionDepth === "deep" ? 0.15 : cap.persuasionDepth === "moderate" ? 0.08 : 0;
  const correctedScore = clamp(persuasionLayer.score + roleFit * 0.2 + depthBonus, 0, 0.55);

  if (correctedScore >= PERSUASION_CORRECTION_FLOOR) {
    return {
      corrected: true,
      newScore: correctedScore,
      correctionLog: `PERSUASION CORRECTION: ${channelKey} score adjusted ${(persuasionLayer.score * 100).toFixed(0)}% → ${(correctedScore * 100).toFixed(0)}% (role fit: ${bestRole.role} at ${(roleFit * 100).toFixed(0)}%, depth: ${cap.persuasionDepth})`,
    };
  }

  return {
    corrected: false,
    newScore: persuasionLayer.score,
    correctionLog: `${channelKey}: Correction attempted but insufficient (${(correctedScore * 100).toFixed(0)}% < ${(PERSUASION_CORRECTION_FLOOR * 100).toFixed(0)}% floor)`,
  };
}

function runFunnelResolutionLayer(
  candidates: { key: string; persuasionLayer: LayerResult; guardLayer: LayerResult; budgetLayer: LayerResult }[],
  persuasion: ChannelPersuasionInput | null,
  awarenessStage: string = "problem_aware",
): { resolution: FunnelReconstructionResult; rescuedChannels: Set<string>; funnelLayer: LayerResult } {
  const reconstructionLog: string[] = [];
  const funnelStages: FunnelReconstructionResult["funnelStages"] = {
    awareness: [],
    nurture: [],
    conversion: [],
  };
  let channelsRescued = 0;
  let channelsStillRejected = 0;
  const rescuedChannels = new Set<string>();

  const incompatibleChannels = candidates.filter(c => isPersuasionIncompatible(c.persuasionLayer));

  if (incompatibleChannels.length === 0) {
    for (const c of candidates) {
      const def = CHANNEL_DEFINITIONS[c.key];
      if (!def) continue;
      const { role, score } = determineBestFunnelRole(c.key);
      funnelStages[role].push({
        channelName: def.label,
        channelKey: c.key,
        assignedRole: role,
        roleFitScore: score,
        originalPersuasionScore: c.persuasionLayer.score,
        wasReconstructed: false,
        autoInjectedConversion: false,
        injectionReason: null,
        injectionStage: null,
        persuasionCorrectionApplied: false,
        reasoning: `Channel naturally compatible — assigned to ${role} stage based on capability profile`,
      });
    }

    const reconstructionLog: string[] = ["No persuasion incompatibilities detected — standard channel evaluation applied"];

    if (funnelStages.conversion.length === 0) {
      const injected = injectConversionChannel(funnelStages, candidates, persuasion?.persuasionMode || "trust_building", reconstructionLog, awarenessStage);
      if (injected) {
        reconstructionLog.push("Conversion channel injected to ensure funnel completeness");
      }
    }

    const warnings: string[] = [];
    if (funnelStages.conversion.length === 0) {
      warnings.push("FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve");
    }

    return {
      resolution: {
        reconstructed: false,
        funnelStages,
        reconstructionLog,
        channelsRescued: 0,
        channelsStillRejected: 0,
      },
      rescuedChannels,
      funnelLayer: {
        layerName: "funnel_resolution",
        passed: true,
        score: 1.0,
        findings: ["All channels persuasion-compatible — funnel stages assigned by capability"],
        warnings,
      },
    };
  }

  const persuasionMode = persuasion?.persuasionMode || "trust_building";
  reconstructionLog.push(`Funnel reconstruction triggered — ${incompatibleChannels.length} channel(s) incompatible with "${persuasionMode}" persuasion mode`);

  for (const c of incompatibleChannels) {
    const def = CHANNEL_DEFINITIONS[c.key];
    if (!def) continue;

    const correction = attemptPersuasionCorrection(c.key, c.persuasionLayer, persuasion);
    if (correction.correctionLog) {
      reconstructionLog.push(correction.correctionLog);
    }

    const cap = CHANNEL_FUNNEL_CAPABILITIES[c.key];
    if (!cap) {
      channelsStillRejected++;
      reconstructionLog.push(`${def.label}: No funnel capability data — channel remains rejected`);
      continue;
    }

    if (!c.guardLayer.passed || !c.budgetLayer.passed) {
      channelsStillRejected++;
      reconstructionLog.push(`${def.label}: Guard/budget layer blocked — funnel reconstruction cannot override structural constraints`);
      continue;
    }

    const roles: { role: FunnelRole; score: number }[] = [
      { role: "awareness", score: cap.awareness },
      { role: "nurture", score: cap.nurture },
      { role: "conversion", score: cap.conversion },
    ];
    roles.sort((a, b) => b.score - a.score);

    let rescued = false;
    for (const { role, score } of roles) {
      const threshold = FUNNEL_ROLE_THRESHOLDS[role];
      if (score >= threshold) {
        rescuedChannels.add(c.key);
        channelsRescued++;
        rescued = true;

        let reasoning: string;
        if (role === "awareness" && cap.persuasionDepth === "shallow") {
          reasoning = `Channel incompatible as conversion environment for "${persuasionMode}" — reassigned to Awareness Entry Point (fit: ${(score * 100).toFixed(0)}%). Deeper persuasion will occur in downstream Nurture/Conversion channels.`;
        } else if (role === "nurture" && (cap.persuasionDepth === "deep" || cap.persuasionDepth === "moderate")) {
          reasoning = `Channel supports ${cap.persuasionDepth} persuasion depth — reassigned to Nurture stage for "${persuasionMode}" model (fit: ${(score * 100).toFixed(0)}%).`;
        } else if (role === "conversion") {
          reasoning = `Channel has strong conversion capability (fit: ${(score * 100).toFixed(0)}%) — reassigned to Conversion stage. Persuasion delivery delegated to upstream funnel stages.`;
        } else {
          reasoning = `Channel reassigned to ${role} stage based on capability profile (fit: ${(score * 100).toFixed(0)}%). Persuasion model "${persuasionMode}" will be supported through multi-stage funnel design.`;
        }

        if (correction.corrected) {
          reasoning += ` [Persuasion correction applied: ${(correction.newScore * 100).toFixed(0)}%]`;
        }

        funnelStages[role].push({
          channelName: def.label,
          channelKey: c.key,
          assignedRole: role,
          roleFitScore: score,
          originalPersuasionScore: c.persuasionLayer.score,
          wasReconstructed: true,
          autoInjectedConversion: false,
          injectionReason: null,
          injectionStage: null,
          persuasionCorrectionApplied: correction.corrected,
          reasoning,
        });

        reconstructionLog.push(`${def.label}: RESCUED — reassigned from rejected to ${role.toUpperCase()} stage (role fit: ${(score * 100).toFixed(0)}%, persuasion depth: ${cap.persuasionDepth})`);
        break;
      }
    }

    if (!rescued) {
      channelsStillRejected++;
      const bestRole = roles[0];
      reconstructionLog.push(`${def.label}: No viable funnel role found (best: ${bestRole.role} at ${(bestRole.score * 100).toFixed(0)}%, threshold: ${(FUNNEL_ROLE_THRESHOLDS[bestRole.role] * 100).toFixed(0)}%) — channel rejected after funnel reconstruction attempt`);
    }
  }

  for (const c of candidates) {
    if (!isPersuasionIncompatible(c.persuasionLayer)) {
      const def = CHANNEL_DEFINITIONS[c.key];
      if (!def) continue;
      const { role, score } = determineBestFunnelRole(c.key);
      funnelStages[role].push({
        channelName: def.label,
        channelKey: c.key,
        assignedRole: role,
        roleFitScore: score,
        originalPersuasionScore: c.persuasionLayer.score,
        wasReconstructed: false,
        autoInjectedConversion: false,
        injectionReason: null,
        injectionStage: null,
        persuasionCorrectionApplied: false,
        reasoning: `Channel naturally compatible with "${persuasionMode}" — assigned to ${role} stage`,
      });
    }
  }

  for (const role of ["awareness", "nurture", "conversion"] as FunnelRole[]) {
    funnelStages[role].sort((a, b) => b.roleFitScore - a.roleFitScore);
  }

  if (funnelStages.conversion.length === 0) {
    const injected = injectConversionChannel(funnelStages, candidates, persuasionMode, reconstructionLog, awarenessStage);
    if (injected) channelsRescued++;
  }

  if (funnelStages.awareness.length === 0) {
    reconstructionLog.push("FUNNEL GAP: No channels assigned to Awareness stage — top-of-funnel entry may be limited");
  }

  const findings: string[] = [
    `Funnel reconstruction complete — ${channelsRescued} channel(s) rescued, ${channelsStillRejected} still rejected`,
    `Awareness stage: ${funnelStages.awareness.length} channel(s)`,
    `Nurture stage: ${funnelStages.nurture.length} channel(s)`,
    `Conversion stage: ${funnelStages.conversion.length} channel(s)`,
  ];

  const warnings: string[] = [];
  if (funnelStages.nurture.length === 0) {
    warnings.push("FUNNEL GAP: No channels assigned to Nurture stage — persuasion delivery may be limited");
  }
  if (funnelStages.conversion.length === 0) {
    warnings.push("FUNNEL GAP: No channels assigned to Conversion stage — transaction completion requires manual funnel design");
  }

  return {
    resolution: {
      reconstructed: channelsRescued > 0,
      funnelStages,
      reconstructionLog,
      channelsRescued,
      channelsStillRejected,
    },
    rescuedChannels,
    funnelLayer: {
      layerName: "funnel_resolution",
      passed: channelsRescued > 0 || channelsStillRejected === 0,
      score: channelsRescued > 0 ? clamp(0.5 + channelsRescued * 0.1, 0.5, 0.85) : 0.3,
      findings,
      warnings,
    },
  };
}

function injectConversionChannel(
  funnelStages: FunnelReconstructionResult["funnelStages"],
  candidates: { key: string; persuasionLayer: LayerResult; guardLayer: LayerResult; budgetLayer: LayerResult }[],
  persuasionMode: string,
  reconstructionLog: string[],
  awarenessStage: string = "problem_aware",
): boolean {
  const injectionList = AWARENESS_INJECTION_PRIORITY[awarenessStage] || CONVERSION_INJECTION_PRIORITY;

  for (const channelKey of injectionList) {
    const cap = CHANNEL_FUNNEL_CAPABILITIES[channelKey];
    if (!cap || cap.conversion < FUNNEL_ROLE_THRESHOLDS.conversion) continue;

    const def = CHANNEL_DEFINITIONS[channelKey];
    if (!def) continue;

    const registry = CHANNEL_ROLE_REGISTRY[channelKey];
    if (registry && registry.blockedAwarenessStages.includes(awarenessStage)) {
      reconstructionLog.push(`INJECTION BLOCKED: "${def.label}" blocked by awareness registry constraint for "${awarenessStage}" audience`);
      continue;
    }

    const blockedTypes = AWARENESS_BLOCKED_CHANNEL_TYPES[awarenessStage] || [];
    if (blockedTypes.includes(def.type)) {
      reconstructionLog.push(`INJECTION BLOCKED: "${def.label}" (type: ${def.type}) blocked by awareness type constraint for "${awarenessStage}" audience`);
      continue;
    }

    if (registry) {
      const allowedRoles = AWARENESS_STAGE_ALLOWED_ROLES[awarenessStage] || ["discovery", "nurture", "conversion"];
      if (!allowedRoles.includes(registry.role)) {
        reconstructionLog.push(`INJECTION BLOCKED: "${def.label}" (role: ${registry.role}) blocked by awareness role constraint for "${awarenessStage}" audience`);
        continue;
      }
    }

    const candidate = candidates.find(c => c.key === channelKey);
    if (candidate && !candidate.guardLayer.passed) continue;
    if (candidate && !candidate.budgetLayer.passed) continue;

    const alreadyAssigned = [
      ...funnelStages.awareness,
      ...funnelStages.nurture,
      ...funnelStages.conversion,
    ].some(a => a.channelKey === channelKey);

    const injectionReason = `Funnel missing conversion stage — "${def.label}" auto-injected based on conversion capability (${(cap.conversion * 100).toFixed(0)}%), validated against "${awarenessStage}" awareness constraint${alreadyAssigned ? ". Channel also serves another funnel stage." : ""}`;

    funnelStages.conversion.push({
      channelName: def.label,
      channelKey,
      assignedRole: "conversion",
      roleFitScore: cap.conversion,
      originalPersuasionScore: candidate?.persuasionLayer.score ?? 0,
      wasReconstructed: true,
      autoInjectedConversion: true,
      injectionReason,
      injectionStage: "conversion",
      persuasionCorrectionApplied: false,
      reasoning: `CONVERSION INJECTION: "${def.label}" auto-assigned to Conversion stage — awareness-validated for "${awarenessStage}" (conversion capability: ${(cap.conversion * 100).toFixed(0)}%). ${alreadyAssigned ? "Channel also serves another funnel stage." : ""}`,
    });

    reconstructionLog.push(`FUNNEL COMPLETION: Injected "${def.label}" into Conversion stage (capability: ${(cap.conversion * 100).toFixed(0)}%, awareness: ${awarenessStage}) — funnel was missing conversion layer`);
    return true;
  }

  reconstructionLog.push(`FUNNEL COMPLETION FAILED: Could not find a viable awareness-valid conversion channel for "${awarenessStage}" audience — manual funnel design required`);
  return false;
}

function runDecisionGate(
  persuasionLayer: LayerResult,
  guardLayer: LayerResult,
  budgetLayer: LayerResult,
  awarenessLayer: LayerResult,
  channelDef: { type: string; label: string },
  channelKey: string,
): { layer: LayerResult; gate: DecisionGateResult } {
  const violations: string[] = [];
  const findings: string[] = [];

  if (persuasionLayer.score < PERSUASION_COMPATIBILITY_THRESHOLD) {
    violations.push(`Persuasion compatibility (${(persuasionLayer.score * 100).toFixed(0)}%) below ${(PERSUASION_COMPATIBILITY_THRESHOLD * 100).toFixed(0)}% threshold`);
  }

  if (!guardLayer.passed) {
    violations.push("Guard layer reported incompatibility");
  }

  if (!budgetLayer.passed) {
    violations.push("Budget logic invalid or insufficient");
  }

  if (!awarenessLayer.passed && awarenessLayer.score === 0) {
    violations.push(`AWARENESS HARD BLOCK — channel awareness score is 0 (awareness constraint violation)`);
  } else if (!awarenessLayer.passed && awarenessLayer.score <= 0.35) {
    violations.push(`Channel objective mismatch — awareness mapping score ${(awarenessLayer.score * 100).toFixed(0)}%`);
  }

  let outcome: DecisionGateOutcome = "recommended";
  let reason = `Channel "${channelDef.label}" passed all decision gate checks`;

  if (violations.length > 0) {
    if (awarenessLayer.score === 0) {
      outcome = "exploratory";
      reason = `Channel "${channelDef.label}" REJECTED — awareness constraint hard block: channel incompatible with audience awareness stage`;
    } else if (!guardLayer.passed) {
      outcome = "exploratory";
      reason = `Channel "${channelDef.label}" downgraded to Exploratory — ${violations.length} gate violation(s): ${violations.join("; ")}`;
    } else if (persuasionLayer.score < PERSUASION_COMPATIBILITY_THRESHOLD) {
      outcome = "support_channel";
      reason = `Channel "${channelDef.label}" deferred to funnel layer — persuasion below threshold, funnel reconstruction pending`;
    } else {
      outcome = "support_channel";
      reason = `Channel "${channelDef.label}" downgraded to Support Channel — ${violations.length} gate violation(s)`;
    }
  }

  findings.push(`Decision gate outcome: ${outcome.toUpperCase()}`);
  if (violations.length > 0) {
    findings.push(`Violations: ${violations.join("; ")}`);
  }

  const score = outcome === "recommended" ? 0.9 : outcome === "support_channel" ? 0.5 : 0.2;
  const layer: LayerResult = {
    layerName: "decision_gate",
    passed: outcome === "recommended",
    score,
    findings,
    warnings: violations.map(v => `GATE: ${v}`),
  };

  return {
    layer,
    gate: { outcome, reason, violations },
  };
}

function computeDecisionGateScoring(
  funnelStages: FunnelReconstructionResult["funnelStages"],
  candidates: { key: string; candidate: ChannelCandidate; layers: LayerResult[] }[],
  budget: ChannelBudgetInput | null,
): DecisionGateScoring {
  const allAssignments = [
    ...funnelStages.awareness,
    ...funnelStages.nurture,
    ...funnelStages.conversion,
  ];
  const hasInjections = allAssignments.some(a => a.autoInjectedConversion);
  const hasPersuasionCorrections = allAssignments.some(a => a.persuasionCorrectionApplied);
  const hasReconstructions = allAssignments.some(a => a.wasReconstructed);

  const hasAwareness = funnelStages.awareness.length > 0;
  const hasNurture = funnelStages.nurture.length > 0;
  const hasConversion = funnelStages.conversion.length > 0;
  let funnelIntegrityScore = clamp(
    (hasAwareness ? 0.33 : 0) + (hasNurture ? 0.33 : 0) + (hasConversion ? 0.34 : 0),
    0, 1
  );

  if (hasInjections) {
    funnelIntegrityScore = clamp(funnelIntegrityScore - 0.08, 0, 1);
  }

  const viable = candidates.filter(c => !c.candidate.rejectionReason);
  const avgPersuasion = viable.length > 0
    ? viable.reduce((s, c) => s + c.candidate.persuasionCompatibility, 0) / viable.length
    : 0;
  const persuasionAlignmentScore = clamp(avgPersuasion, 0, 1);

  let budgetRealism = 0.5;
  if (budget) {
    const totalAvailable = budget.testBudgetMax || budget.scaleBudgetMax || 0;
    const paidCount = viable.filter(c => PAID_CHANNELS.has(c.key)).length;
    const minRequired = paidCount * 500;
    budgetRealism = totalAvailable >= minRequired ? clamp(0.7 + (totalAvailable - minRequired) / 10000, 0.7, 1) : clamp(totalAvailable / minRequired, 0, 0.7);
    if (budget.killFlag) budgetRealism = 0.2;
  }

  const avgScalability = viable.length > 0
    ? viable.reduce((s, c) => s + (CHANNEL_SCALABILITY[c.key] || 0.5), 0) / viable.length
    : 0.3;
  const channelScalability = clamp(avgScalability, 0, 1);

  let compositeGateScore = clamp(
    funnelIntegrityScore * 0.30 +
    persuasionAlignmentScore * 0.25 +
    budgetRealism * 0.25 +
    channelScalability * 0.20,
    0, 1
  );

  if (hasReconstructions || hasPersuasionCorrections) {
    const correctionCount = allAssignments.filter(a => a.wasReconstructed || a.persuasionCorrectionApplied).length;
    const gatePenalty = Math.min(correctionCount * 0.03, 0.12);
    compositeGateScore = clamp(compositeGateScore - gatePenalty, 0, 1);
  }

  return { funnelIntegrityScore, persuasionAlignmentScore, budgetRealism, channelScalability, compositeGateScore };
}

function getObjectiveFit(channelKey: string): ObjectiveFitScores {
  const fit = OBJECTIVE_FIT_MATRIX[channelKey];
  if (!fit) return { awarenessFit: 0.3, nurtureFit: 0.3, conversionFit: 0.3 };
  return { ...fit };
}

function getChannelDifferentiation(channelKey: string): ChannelDifferentiation | null {
  return CHANNEL_DIFFERENTIATION_PROFILES[channelKey] || null;
}

function deduplicateWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of warnings) {
    const normalized = w.replace(/\d+(\.\d+)?%/g, "X%").replace(/\$[\d,.]+/g, "$X").trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(w);
    }
  }
  return result;
}

function filterChannelsByMode(channelKeys: string[], mode: ChannelMode): { filtered: string[]; reasoning: string } {
  if (mode === "organic_only") {
    const filtered = channelKeys.filter(k => ORGANIC_CHANNELS.has(k));
    return { filtered, reasoning: `Organic Only mode: ${filtered.length} organic channels selected, ${channelKeys.length - filtered.length} paid channels excluded` };
  }
  if (mode === "paid_only") {
    const filtered = channelKeys.filter(k => PAID_CHANNELS.has(k));
    return { filtered, reasoning: `Paid Only mode: ${filtered.length} paid channels selected, ${channelKeys.length - filtered.length} organic channels excluded` };
  }
  if (mode === "hybrid") {
    return { filtered: channelKeys, reasoning: `Hybrid mode: All ${channelKeys.length} channels (organic + paid) included for balanced distribution` };
  }
  return { filtered: channelKeys, reasoning: `Automatic mode: AI evaluating all ${channelKeys.length} channels for optimal strategic mix` };
}

function buildChannelCandidate(
  channelKey: string,
  layers: LayerResult[],
  reliability: DataReliabilityDiagnostics,
  gateResult: DecisionGateResult,
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
      objectiveFit: { awarenessFit: 0, nurtureFit: 0, conversionFit: 0 },
      decisionGate: { outcome: "exploratory", reason: "Unknown channel", violations: ["Unknown channel definition"] },
      differentiation: null,
      assignedFunnelRole: null,
      wasReconstructed: false,
      autoInjectedConversion: false,
      persuasionCorrectionApplied: false,
      awarenessConstraintViolation: false,
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

  if (gateResult.outcome === "exploratory") {
    fitScore = Math.min(fitScore, 0.35);
  } else if (gateResult.outcome === "support_channel") {
    fitScore = Math.min(fitScore, 0.55);
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

  const allWarnings = deduplicateWarnings(layers.flatMap(l => l.warnings));
  const guardLayer = layers.find(l => l.layerName === "guard_layer");
  const rejected = (guardLayer && !guardLayer.passed) || gateResult.outcome === "exploratory";

  const isOrganic = ORGANIC_CHANNELS.has(channelKey);
  let budgetAllocation = 0;
  if (!rejected && fitScore > 0.3) {
    budgetAllocation = isOrganic ? 0 : clamp(fitScore * 100, 5, 100);
  }

  const { role: bestFunnelRole } = determineBestFunnelRole(channelKey);

  return {
    channelName: def.label,
    channelType: def.type as ChannelCandidate["channelType"],
    fitScore,
    audienceDensityScore: audienceLayer?.score ?? 0,
    persuasionCompatibility: persuasionLayer?.score ?? 0,
    costEfficiency: efficiencyLayer?.score ?? 0,
    riskLevel,
    riskNotes: allWarnings,
    rejectionReason: rejected ? (gateResult.outcome === "exploratory" ? `Decision gate downgrade: ${gateResult.reason}` : "Blocked by guard layer") : null,
    estimatedCac: null,
    recommendedBudgetAllocation: budgetAllocation,
    objectiveFit: getObjectiveFit(channelKey),
    decisionGate: gateResult,
    differentiation: getChannelDifferentiation(channelKey),
    assignedFunnelRole: bestFunnelRole,
    wasReconstructed: false,
    autoInjectedConversion: false,
    persuasionCorrectionApplied: false,
    awarenessConstraintViolation: false,
  };
}

export function runChannelSelectionEngine(
  audience: ChannelAudienceInput,
  awareness: ChannelAwarenessInput | null,
  persuasion: ChannelPersuasionInput | null,
  offer: ChannelOfferInput | null,
  budget: ChannelBudgetInput | null,
  validation: ChannelValidationInput | null,
  channelMode: ChannelMode = "automatic",
  memoryContext?: string,
): ChannelSelectionResult {
  const startTime = Date.now();
  const structuralWarnings: string[] = [];

  const memoryAdjustments: string[] = [];
  function applyMemoryAdjustments(candidateList: typeof candidates) {
    if (!memoryContext) return;
    const lines = memoryContext.split("\n");
    const reinforceLines: string[] = [];
    const avoidLines: string[] = [];
    let mode: "none" | "reinforce" | "avoid" = "none";
    for (const line of lines) {
      if (line.includes("REINFORCE") || line.includes("Reinforce") || line.includes("reinforce")) mode = "reinforce";
      else if (line.includes("AVOID") || line.includes("Avoid") || line.includes("avoid")) mode = "avoid";
      else if (mode === "reinforce") reinforceLines.push(line.toLowerCase());
      else if (mode === "avoid") avoidLines.push(line.toLowerCase());
    }
    for (const c of candidateList) {
      if (c.candidate.rejectionReason) continue;
      const channelLabel = (c.candidate.channelName || c.key).toLowerCase();
      const matchedReinforce = reinforceLines.some(l => l.includes(channelLabel) || channelLabel.split(/[\s_\-]+/).some(part => part.length > 3 && l.includes(part)));
      const matchedAvoid = avoidLines.some(l => l.includes(channelLabel) || channelLabel.split(/[\s_\-]+/).some(part => part.length > 3 && l.includes(part)));
      if (matchedReinforce) {
        const adj = Math.min(c.candidate.fitScore * 0.15, 0.1);
        c.candidate.fitScore = clamp(c.candidate.fitScore + adj, 0, 1);
        memoryAdjustments.push(`REINFORCE +${(adj * 100).toFixed(1)}% → ${c.candidate.channelName}`);
      } else if (matchedAvoid) {
        const adj = Math.min(c.candidate.fitScore * 0.2, 0.15);
        c.candidate.fitScore = clamp(c.candidate.fitScore - adj, 0, 1);
        memoryAdjustments.push(`AVOID -${(adj * 100).toFixed(1)}% → ${c.candidate.channelName}`);
      }
    }
    if (memoryAdjustments.length > 0) {
      console.log(`[ChannelSelectionEngine] Memory context applied ${memoryAdjustments.length} score adjustment(s): ${memoryAdjustments.join(", ")}`);
    }
  }

  const reliability = assessDataReliability(audience, awareness, persuasion, offer, budget, validation);

  const allChannelKeys = Object.keys(CHANNEL_DEFINITIONS);
  const { filtered: channelKeys, reasoning: modeReasoning } = filterChannelsByMode(allChannelKeys, channelMode);
  structuralWarnings.push(modeReasoning);

  const candidates: { key: string; candidate: ChannelCandidate; layers: LayerResult[] }[] = [];

  const preFunnelData: { key: string; persuasionLayer: LayerResult; guardLayer: LayerResult; budgetLayer: LayerResult }[] = [];
  const awarenessBlockedChannels: { channelKey: string; channelLabel: string; reason: string }[] = [];
  const awarenessStage = awareness ? safeString(awareness.targetReadinessStage, "problem_aware") : "unknown";

  for (const channelKey of channelKeys) {
    const def = CHANNEL_DEFINITIONS[channelKey];

    const { layer: awarenessLayer, awarenessBlocked, awarenessBlockReason } = scoreAwarenessMapping(awareness, channelKey, def);

    if (awarenessBlocked) {
      awarenessBlockedChannels.push({
        channelKey,
        channelLabel: def.label,
        reason: awarenessBlockReason || "Awareness stage mismatch",
      });

      const rejectedCandidate = buildChannelCandidate(
        channelKey,
        [awarenessLayer],
        reliability,
        {
          outcome: "exploratory",
          reason: awarenessBlockReason || "INVALID_CHANNEL_FOR_AWARENESS",
          violations: [awarenessBlockReason || "Awareness constraint violation"],
        },
      );
      rejectedCandidate.rejectionReason = awarenessBlockReason || "INVALID_CHANNEL_FOR_AWARENESS";
      rejectedCandidate.fitScore = 0;
      rejectedCandidate.awarenessConstraintViolation = true;
      candidates.push({ key: channelKey, candidate: rejectedCandidate, layers: [awarenessLayer] });
      continue;
    }

    const audienceLayer = scoreAudienceDensity(audience, channelKey);
    const persuasionLayer = scorePersuasionCompatibility(persuasion, def, channelKey);
    const budgetLayer = checkBudgetConstraint(budget, def, channelKey);
    const efficiencyLayer = scoreCostEfficiency(def, offer);
    const riskLayer = assessRisk(validation, def);
    const guardLayer = runGuardLayer(audience, persuasion, budget, validation, def);

    preFunnelData.push({ key: channelKey, persuasionLayer, guardLayer, budgetLayer });

    const { layer: decisionGateLayer, gate: gateResult } = runDecisionGate(
      persuasionLayer,
      guardLayer,
      budgetLayer,
      awarenessLayer,
      def,
      channelKey,
    );

    const coreLayers: LayerResult[] = [
      audienceLayer,
      awarenessLayer,
      persuasionLayer,
      budgetLayer,
      efficiencyLayer,
      riskLayer,
      guardLayer,
      decisionGateLayer,
    ];

    const fitLayer: LayerResult = {
      layerName: "channel_fit_scoring",
      passed: true,
      score: coreLayers.reduce((s, l) => s + l.score, 0) / coreLayers.length,
      findings: [`Composite fit score for ${def.label}`],
      warnings: [],
    };

    const allLayers = [...coreLayers, fitLayer];
    const candidate = buildChannelCandidate(channelKey, allLayers, reliability, gateResult);
    candidates.push({ key: channelKey, candidate, layers: allLayers });
  }

  if (awarenessBlockedChannels.length > 0) {
    structuralWarnings.push(
      `AWARENESS CONSTRAINT ENFORCEMENT: ${awarenessBlockedChannels.length} channel(s) blocked for "${awarenessStage}" audience stage: ${awarenessBlockedChannels.map(c => c.channelLabel).join(", ")}`
    );
  }

  const { resolution: funnelReconstruction, rescuedChannels, funnelLayer } = runFunnelResolutionLayer(preFunnelData, persuasion, awarenessStage);

  const allFunnelAssignments = [
    ...funnelReconstruction.funnelStages.awareness,
    ...funnelReconstruction.funnelStages.nurture,
    ...funnelReconstruction.funnelStages.conversion,
  ];
  for (const c of candidates) {
    const assignment = allFunnelAssignments.find(a => a.channelKey === c.key);
    if (assignment) {
      c.candidate.assignedFunnelRole = assignment.assignedRole;
      c.candidate.autoInjectedConversion = assignment.autoInjectedConversion;
      c.candidate.persuasionCorrectionApplied = assignment.persuasionCorrectionApplied;
    }
  }

  if (funnelReconstruction.reconstructed && rescuedChannels.size > 0) {
    for (const c of candidates) {
      if (rescuedChannels.has(c.key)) {
        const assignment = allFunnelAssignments.find(a => a.channelKey === c.key);

        if (assignment) {
          const roleName = assignment.assignedRole.charAt(0).toUpperCase() + assignment.assignedRole.slice(1);

          c.candidate.wasReconstructed = true;
          c.candidate.assignedFunnelRole = assignment.assignedRole;
          c.candidate.rejectionReason = null;
          c.candidate.fitScore = clamp(assignment.roleFitScore * 0.7, 0.35, 0.65);
          c.candidate.riskNotes = deduplicateWarnings([
            ...c.candidate.riskNotes,
            `Funnel-reconstructed: assigned to ${roleName} stage — not suitable as standalone conversion channel`,
          ]);

          const postReconstructionViolations: string[] = [];
          if (assignment.roleFitScore < FUNNEL_ROLE_THRESHOLDS[assignment.assignedRole]) {
            postReconstructionViolations.push(`Role fit (${(assignment.roleFitScore * 100).toFixed(0)}%) below ${assignment.assignedRole} threshold`);
          }
          if (c.candidate.persuasionCompatibility < 0.2) {
            postReconstructionViolations.push(`Very low persuasion compatibility (${(c.candidate.persuasionCompatibility * 100).toFixed(0)}%) — channel limited to ${assignment.assignedRole} role only`);
          }

          const postGateOutcome: DecisionGateOutcome = postReconstructionViolations.length === 0 ? "support_channel" : "exploratory";
          c.candidate.decisionGate = {
            outcome: postGateOutcome,
            reason: `Post-reconstruction validation: "${c.candidate.channelName}" assigned to ${roleName} stage (role fit: ${(assignment.roleFitScore * 100).toFixed(0)}%)${postReconstructionViolations.length > 0 ? ` with ${postReconstructionViolations.length} advisory note(s)` : ""}`,
            violations: postReconstructionViolations,
          };

          const isOrganic = ORGANIC_CHANNELS.has(c.key);
          c.candidate.recommendedBudgetAllocation = (!isOrganic && c.candidate.fitScore > 0.3) ? clamp(c.candidate.fitScore * 100, 5, 100) : 0;
        }
      }
    }

    structuralWarnings.push(`Funnel reconstruction rescued ${rescuedChannels.size} channel(s) from rejection — multi-stage funnel recommended`);
    structuralWarnings.push(...funnelLayer.warnings);
  }

  applyMemoryAdjustments(candidates);

  const viable = candidates.filter(c => !c.candidate.rejectionReason);
  const rejected = candidates.filter(c => !!c.candidate.rejectionReason);

  viable.sort((a, b) => b.candidate.fitScore - a.candidate.fitScore);

  const totalPaidAllocation = viable
    .filter(c => !ORGANIC_CHANNELS.has(c.key))
    .reduce((sum, c) => sum + c.candidate.recommendedBudgetAllocation, 0);

  if (totalPaidAllocation > 100) {
    const scaleFactor = 100 / totalPaidAllocation;
    const paidViable = viable.filter(c => !ORGANIC_CHANNELS.has(c.key));
    for (const c of paidViable) {
      c.candidate.recommendedBudgetAllocation = Math.floor(c.candidate.recommendedBudgetAllocation * scaleFactor);
    }
    const postRoundTotal = paidViable.reduce((s, c) => s + c.candidate.recommendedBudgetAllocation, 0);
    if (postRoundTotal < 100 && paidViable.length > 0) {
      paidViable[0].candidate.recommendedBudgetAllocation += (100 - postRoundTotal);
    }
    structuralWarnings.push(`Budget allocation normalized — raw total ${totalPaidAllocation.toFixed(0)}% scaled to 100%`);
  }

  const primary = viable[0]?.candidate || rejected[0]?.candidate || buildFallbackChannel("primary");
  const secondary = viable[1]?.candidate || viable[0]?.candidate || buildFallbackChannel("secondary");
  const rejectedChannels = rejected.map(r => r.candidate);

  const primaryLayers = viable[0]?.layers || candidates[0]?.layers || [];
  if (funnelReconstruction.reconstructed) {
    primaryLayers.push(funnelLayer);
  }

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

  const correctionAuditTrail: CorrectionAuditEntry[] = [];
  const now = Date.now();

  for (const assignment of allFunnelAssignments) {
    if (assignment.autoInjectedConversion) {
      correctionAuditTrail.push({
        correctionType: "auto_injection",
        timestamp: now,
        engineResponsible: "channel-selection",
        affectedChannel: assignment.channelName,
        affectedComponent: "funnel_conversion_stage",
        detail: assignment.injectionReason || "Conversion channel auto-injected for funnel completeness",
      });
    }
    if (assignment.persuasionCorrectionApplied) {
      correctionAuditTrail.push({
        correctionType: "persuasion_correction",
        timestamp: now,
        engineResponsible: "channel-selection",
        affectedChannel: assignment.channelName,
        affectedComponent: "persuasion_compatibility",
        detail: `Persuasion score corrected to allow funnel role assignment as ${assignment.assignedRole}`,
      });
    }
    if (assignment.wasReconstructed && !assignment.autoInjectedConversion) {
      correctionAuditTrail.push({
        correctionType: "funnel_reassignment",
        timestamp: now,
        engineResponsible: "channel-selection",
        affectedChannel: assignment.channelName,
        affectedComponent: `funnel_${assignment.assignedRole}_stage`,
        detail: `Channel reassigned from rejected to ${assignment.assignedRole} stage via funnel reconstruction`,
      });
    }
  }

  const structurallyRepaired = correctionAuditTrail.length > 0;

  let confidenceScore = primary.fitScore;
  if (reliability.isWeak) {
    confidenceScore = Math.min(confidenceScore * 0.6, 0.65);
  }
  if (structurallyRepaired) {
    const correctionPenalty = Math.min(correctionAuditTrail.length * 0.05, 0.20);
    confidenceScore = clamp(confidenceScore - correctionPenalty, 0.1, 1);
    structuralWarnings.push(`Confidence adjusted: -${(correctionPenalty * 100).toFixed(0)}% penalty for ${correctionAuditTrail.length} structural correction(s) — strategy marked as structurally repaired`);
  }

  const channelRiskNotes = deduplicateWarnings([
    ...primary.riskNotes.slice(0, 5),
    ...secondary.riskNotes.slice(0, 3),
  ]);

  if (viable.length === 0) {
    structuralWarnings.push("No viable channels found — all channels rejected by guard layer or decision gate");
  }

  const hasGateDowngrades = candidates.some(c => c.candidate.decisionGate.outcome !== "recommended");
  const hasFunnelReconstruction = funnelReconstruction.reconstructed && rescuedChannels.size > 0;

  const conversionChannelAssigned = funnelReconstruction.funnelStages.conversion.length > 0 ||
    viable.some(c => c.candidate.assignedFunnelRole === "conversion");

  const gateScoring = computeDecisionGateScoring(funnelReconstruction.funnelStages, candidates, budget);

  if (gateScoring.funnelIntegrityScore < 0.66) {
    structuralWarnings.push(`Decision Gate: Funnel integrity score low (${(gateScoring.funnelIntegrityScore * 100).toFixed(0)}%) — missing funnel stage(s)`);
  }
  if (gateScoring.compositeGateScore < 0.4) {
    structuralWarnings.push(`Decision Gate: Composite gate score critical (${(gateScoring.compositeGateScore * 100).toFixed(0)}%) — strategy structurally weak`);
  }

  let status: string;
  if (viable.length === 0) {
    status = STATUS.GUARD_BLOCKED;
  } else if (hasFunnelReconstruction) {
    status = STATUS.FUNNEL_RECONSTRUCTED;
  } else if (reliability.isWeak) {
    status = STATUS.FALLBACK;
  } else if (hasGateDowngrades) {
    status = STATUS.DECISION_GATE_DOWNGRADE;
  } else {
    status = STATUS.COMPLETE;
  }

  let statusMessage: string;
  if (viable.length === 0) {
    statusMessage = "All channels blocked by guard layer or decision gate — review inputs";
  } else if (hasFunnelReconstruction) {
    statusMessage = `Funnel-oriented channel orchestration — ${rescuedChannels.size} channel(s) reassigned to funnel stages, ${viable.length} total viable channel(s)`;
  } else {
    statusMessage = `Channel selection complete — ${viable.length} viable channel(s) identified${hasGateDowngrades ? " (some channels downgraded by decision gate)" : ""}`;
  }

  let channelModeReasoning: string | null = modeReasoning;
  if (channelMode === "automatic") {
    const organicCount = viable.filter(c => ORGANIC_CHANNELS.has(c.key)).length;
    const paidCount = viable.filter(c => PAID_CHANNELS.has(c.key)).length;
    channelModeReasoning = `Automatic mode selected ${organicCount} organic + ${paidCount} paid channels based on audience density (${(reliability.signalDensity * 100).toFixed(0)}%), budget constraints, persuasion compatibility, and cost efficiency analysis`;
  }

  return {
    status,
    statusMessage,
    primaryChannel: primary,
    secondaryChannel: secondary,
    rejectedChannels,
    channelFitScore: primary.fitScore,
    channelRiskNotes,
    layerResults: primaryLayers,
    structuralWarnings: deduplicateWarnings(structuralWarnings),
    boundaryCheck,
    dataReliability: reliability,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    funnelReconstruction,
    conversionChannelAssigned,
    channelMode,
    channelModeReasoning,
    decisionGateScoring: gateScoring,
    structurallyRepaired,
    correctionAuditTrail,
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
    recommendedBudgetAllocation: 0,
    objectiveFit: { awarenessFit: 0.3, nurtureFit: 0.3, conversionFit: 0.3 },
    decisionGate: { outcome: "exploratory", reason: "Fallback channel — testing required", violations: ["Insufficient data"] },
    differentiation: null,
    assignedFunnelRole: null,
    wasReconstructed: false,
    autoInjectedConversion: false,
    persuasionCorrectionApplied: false,
    awarenessConstraintViolation: false,
  };
}
