import {
  ENGINE_VERSION,
  STATUS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  LAYER_WEIGHTS,
  PERSUASION_MODES,
  INFLUENCE_DRIVERS,
  TRUST_SEQUENCE_STAGES,
  HYPE_PATTERNS,
  GENERIC_PERSUASION_PHRASES,
} from "./constants";
import { enforceBoundaryWithSanitization } from "../engine-hardening";
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
  mi: PersuasionMIInput,
  audience: PersuasionAudienceInput,
  positioning: PersuasionPositioningInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  awareness: PersuasionAwarenessInput,
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

  const overallReliability = clamp(
    signalDensity * 0.2 + signalDiversity * 0.25 + narrativeStability * 0.2 + competitorValidity * 0.15 + marketMaturityConfidence * 0.2,
    0,
    1
  );

  const isWeak = overallReliability < 0.4;
  if (isWeak) advisories.push("Overall data reliability is WEAK — confidence scores will be capped");

  return { signalDensity, signalDiversity, narrativeStability, competitorValidity, marketMaturityConfidence, overallReliability, isWeak, advisories };
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

function layer1_awarenessToPersuasionFit(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const entry = safeString(awareness.entryMechanismType, "unknown");
  const readiness = safeString(awareness.targetReadinessStage, "unknown");
  const trustReq = safeString(awareness.trustRequirement, "medium");

  findings.push(`Awareness entry mechanism: ${entry}`);
  findings.push(`Target readiness stage: ${readiness}`);

  if (entry === "proof_led_entry" || entry === "authority_entry") {
    score += 0.2;
    findings.push("High-trust entry mechanism detected — proof-based persuasion aligned");
  } else if (entry === "pain_entry") {
    score += 0.15;
    findings.push("Pain-based entry mechanism — empathy-led persuasion required");
  } else if (entry === "myth_breaker_entry") {
    score += 0.1;
    findings.push("Myth-breaker entry — contrast-based persuasion needed");
  }

  if (readiness === "unaware" || readiness === "problem_aware") {
    score -= 0.1;
    warnings.push("Low readiness stage — persuasion must focus on education before commitment");
  } else if (readiness === "most_aware") {
    score += 0.15;
    findings.push("Most aware stage — direct proof and commitment persuasion viable");
  }

  if (trustReq === "high") {
    warnings.push("High trust requirement — persuasion must front-load proof and authority");
  }

  const awarenessScore = safeNumber(awareness.awarenessStrengthScore, 0);
  if (awarenessScore < 0.4) {
    score -= 0.1;
    warnings.push(`Weak awareness strength (${Math.round(awarenessScore * 100)}%) — persuasion foundations unstable`);
  }

  return { layerName: "awareness_to_persuasion_fit", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer2_objectionDetection(
  audience: PersuasionAudienceInput,
  offer: PersuasionOfferInput,
  differentiation: PersuasionDifferentiationInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const objections = audience.objectionMap || {};
  const objectionKeys = Object.keys(objections);

  if (objectionKeys.length === 0) {
    score -= 0.2;
    warnings.push("No audience objections detected — persuasion may miss critical barriers");
  } else {
    findings.push(`${objectionKeys.length} objection category(ies) detected: ${objectionKeys.slice(0, 5).join(", ")}`);
    score += Math.min(objectionKeys.length * 0.05, 0.2);
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
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const trustReq = safeString(awareness.trustRequirement, "medium");
  findings.push(`Trust requirement from awareness: ${trustReq}`);

  if (trustReq === "high") {
    score -= 0.15;
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
    score += 0.1;
  }

  const integrityScore = safeNumber(integrity.overallIntegrityScore, 0);
  if (integrityScore < 0.5) {
    warnings.push(`Low strategic integrity (${Math.round(integrityScore * 100)}%) — trust claims may lack upstream support`);
    score -= 0.1;
  } else {
    findings.push(`Strategic integrity validated (${Math.round(integrityScore * 100)}%)`);
    score += 0.1;
  }

  const frictionNotes = awareness.frictionNotes || [];
  if (frictionNotes.length > 0) {
    warnings.push(`${frictionNotes.length} awareness friction note(s) affecting trust path`);
    score -= 0.05;
  }

  return { layerName: "trust_barrier_mapping", passed: score >= 0.35, score: clamp(score), findings, warnings };
}

function layer4_influenceDriverSelection(
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
  awareness: PersuasionAwarenessInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const selectedDrivers: string[] = [];

  const proofArch = differentiation.proofArchitecture || [];
  if (proofArch.length >= 2) {
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
    selectedDrivers.push("contrast");
    findings.push("Pain-based entry → contrast driver selected (before/after framing)");
  }
  if (entry === "myth_breaker_entry") {
    selectedDrivers.push("contrast");
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

  if (selectedDrivers.length === 0) {
    selectedDrivers.push("authority", "proof_of_work");
    warnings.push("No signals strong enough for driver selection — defaulting to authority + proof_of_work");
  }

  score += Math.min(selectedDrivers.length * 0.08, 0.35);

  if (selectedDrivers.length < 2) {
    warnings.push("Only one influence driver selected — persuasion architecture may be narrow");
    score -= 0.1;
  }

  findings.push(`Selected influence drivers: ${selectedDrivers.join(", ")}`);

  return { layerName: "influence_driver_selection", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer5_proofPriorityMapping(
  differentiation: PersuasionDifferentiationInput,
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
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

  const trustReq = safeString(awareness.trustRequirement, "medium");
  const readiness = safeString(awareness.targetReadinessStage, "problem_aware");

  if (trustReq === "high" || readiness === "unaware") {
    findings.push("High trust need → third-party proof and case studies should lead");
    score += 0.1;
  } else if (readiness === "most_aware") {
    findings.push("Most aware stage → specific results and metrics should lead");
    score += 0.15;
  } else {
    findings.push("Standard proof sequence → mechanism proof followed by outcome proof");
    score += 0.1;
  }

  const objections = Object.keys(audience.objectionMap || {});
  if (objections.length > 2) {
    findings.push("Multiple objections → proof must address each objection category");
    score += 0.05;
  }

  if (proofArch.length >= 3) {
    score += 0.1;
    findings.push("Rich proof architecture — multiple proof types available for sequencing");
  }

  return { layerName: "proof_priority_mapping", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer6_messageOrderLogic(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.5;

  const readiness = safeString(awareness.targetReadinessStage, "problem_aware");
  const trustReq = safeString(awareness.trustRequirement, "medium");
  const commitmentLevel = safeString(funnel.commitmentLevel, "medium");

  const sequence: string[] = [];

  if (readiness === "unaware" || readiness === "problem_aware") {
    sequence.push("acknowledge_pain", "demonstrate_understanding", "present_proof", "establish_authority", "remove_risk", "invite_commitment");
    findings.push("Low awareness → full empathy-first persuasion sequence");
  } else if (readiness === "solution_aware") {
    sequence.push("demonstrate_understanding", "present_proof", "establish_authority", "remove_risk", "invite_commitment");
    findings.push("Solution aware → understanding-first sequence (skip pain acknowledgment)");
  } else if (readiness === "product_aware" || readiness === "most_aware") {
    sequence.push("present_proof", "establish_authority", "remove_risk", "invite_commitment");
    findings.push("High awareness → proof-first compressed sequence");
    score += 0.1;
  } else {
    sequence.push("acknowledge_pain", "demonstrate_understanding", "present_proof", "establish_authority", "remove_risk", "invite_commitment");
    findings.push("Unknown readiness → full persuasion sequence as safeguard");
  }

  if (trustReq === "high" && !sequence.includes("establish_authority")) {
    sequence.unshift("establish_authority");
    findings.push("High trust requirement → authority front-loaded in sequence");
  }

  if (commitmentLevel === "high") {
    if (!sequence.includes("remove_risk")) {
      sequence.splice(sequence.length - 1, 0, "remove_risk");
    }
    findings.push("High commitment funnel → risk removal emphasized before commitment");
    score += 0.05;
  }

  findings.push(`Message order: ${sequence.join(" → ")}`);
  score += 0.15;

  const stageCount = (funnel.stageMap || []).length;
  if (stageCount > 0 && sequence.length > stageCount + 2) {
    warnings.push(`Persuasion sequence (${sequence.length} steps) may exceed funnel capacity (${stageCount} stages)`);
    score -= 0.05;
  }

  return { layerName: "message_order_logic", passed: score >= 0.4, score: clamp(score), findings, warnings };
}

function layer7_antiHypeGuard(
  allText: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0.85;

  const textLower = allText.toLowerCase();

  let hypeCount = 0;
  for (const pattern of HYPE_PATTERNS) {
    if (textLower.includes(pattern.toLowerCase())) {
      hypeCount++;
      warnings.push(`Hype pattern detected: "${pattern}"`);
    }
  }

  if (hypeCount === 0) {
    findings.push("No hype patterns detected — persuasion structure is grounded");
  } else {
    score -= hypeCount * 0.1;
    warnings.push(`${hypeCount} hype pattern(s) detected — persuasion credibility at risk`);
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

  return { layerName: "anti_hype_guard", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

function layer8_persuasionStrengthScoring(
  layerResults: LayerResult[],
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

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const score = clamp(rawScore);

  const passedCount = layerResults.filter(l => l.passed).length;
  const totalCount = layerResults.length;
  findings.push(`${passedCount}/${totalCount} layers passed`);
  findings.push(`Weighted persuasion strength: ${Math.round(score * 100)}%`);

  if (score < 0.4) {
    warnings.push("Overall persuasion strength is WEAK — significant gaps in logic structure");
  } else if (score < 0.6) {
    warnings.push("Moderate persuasion strength — some layers need reinforcement");
  } else {
    findings.push("Strong persuasion architecture — logic structure is coherent");
  }

  return { layerName: "persuasion_strength_scoring", passed: score >= 0.4, score, findings, warnings };
}

function selectPersuasionMode(
  awareness: PersuasionAwarenessInput,
  audience: PersuasionAudienceInput,
  differentiation: PersuasionDifferentiationInput,
): string {
  const entry = safeString(awareness.entryMechanismType, "");
  const proofCount = (differentiation.proofArchitecture || []).length;
  const authorityMode = safeString(differentiation.authorityMode, "");
  const maturity = safeNumber(audience.maturityIndex, 0.5);

  if (entry === "authority_entry" && authorityMode) return "authority_led";
  if (entry === "proof_led_entry" && proofCount >= 2) return "proof_led";
  if (entry === "pain_entry") return "empathy_led";
  if (entry === "myth_breaker_entry") return "contrast_led";
  if (proofCount >= 3) return "proof_led";
  if (authorityMode) return "authority_led";
  if (maturity > 0.7) return "logic_led";
  return "authority_led";
}

function buildPersuasionRoutes(
  audience: PersuasionAudienceInput,
  awareness: PersuasionAwarenessInput,
  differentiation: PersuasionDifferentiationInput,
  offer: PersuasionOfferInput,
  funnel: PersuasionFunnelInput,
  layerResults: LayerResult[],
): { primary: PersuasionRoute; alternative: PersuasionRoute; rejected: PersuasionRoute } {
  const l2 = layerResults.find(l => l.layerName === "objection_detection");
  const l4 = layerResults.find(l => l.layerName === "influence_driver_selection");
  const l5 = layerResults.find(l => l.layerName === "proof_priority_mapping");
  const l6 = layerResults.find(l => l.layerName === "message_order_logic");
  const l8 = layerResults.find(l => l.layerName === "persuasion_strength_scoring");

  const primaryMode = selectPersuasionMode(awareness, audience, differentiation);

  const driverFindings = (l4?.findings || []).find(f => f.startsWith("Selected influence drivers:"));
  const drivers = driverFindings
    ? driverFindings.replace("Selected influence drivers: ", "").split(", ")
    : ["authority", "proof_of_work"];

  const objections = Object.keys(audience.objectionMap || {}).slice(0, 5);
  if (objections.length === 0 && (offer.riskNotes || []).length > 0) {
    objections.push(...(offer.riskNotes || []).slice(0, 3).map(r => `risk: ${r}`));
  }

  const orderFindings = (l6?.findings || []).find(f => f.startsWith("Message order:"));
  const messageOrder = orderFindings
    ? orderFindings.replace("Message order: ", "").split(" → ")
    : [...TRUST_SEQUENCE_STAGES];

  const trustPath = (funnel.trustPath || []).map((tp: any) => typeof tp === "string" ? tp : tp?.stage || tp?.name || "trust_step");
  const trustSequence = trustPath.length > 0 ? trustPath.slice(0, 6) : messageOrder.slice(0, 4);

  const strengthScore = l8?.score || 0.5;

  const primary: PersuasionRoute = {
    routeName: `${primaryMode.replace(/_/g, " ")} persuasion architecture`,
    persuasionMode: primaryMode,
    primaryInfluenceDrivers: drivers.slice(0, 4),
    objectionPriorities: objections,
    trustSequence,
    messageOrderLogic: messageOrder,
    persuasionStrengthScore: strengthScore,
    frictionNotes: (awareness.frictionNotes || []).slice(0, 3),
    rejectionReason: null,
  };

  const altModes: Record<string, string> = {
    authority_led: "proof_led",
    proof_led: "social_proof_led",
    empathy_led: "authority_led",
    contrast_led: "logic_led",
    logic_led: "proof_led",
    social_proof_led: "authority_led",
    reciprocity_led: "proof_led",
    scarcity_led: "authority_led",
  };
  const altMode = altModes[primaryMode] || "proof_led";

  const altDrivers = INFLUENCE_DRIVERS.filter(d => !drivers.includes(d)).slice(0, 3);
  if (altDrivers.length === 0) altDrivers.push("authority", "social_proof");

  const alternative: PersuasionRoute = {
    routeName: `${altMode.replace(/_/g, " ")} alternative architecture`,
    persuasionMode: altMode,
    primaryInfluenceDrivers: altDrivers,
    objectionPriorities: objections,
    trustSequence: [...trustSequence].reverse().slice(0, trustSequence.length),
    messageOrderLogic: [...messageOrder].slice(1).concat(messageOrder.slice(0, 1)),
    persuasionStrengthScore: clamp(strengthScore * 0.85),
    frictionNotes: [`Alternative mode may require adjusted proof sequencing`],
    rejectionReason: null,
  };

  const rejectedMode = primaryMode === "scarcity_led" ? "reciprocity_led" : "scarcity_led";
  const rejected: PersuasionRoute = {
    routeName: `${rejectedMode.replace(/_/g, " ")} — rejected`,
    persuasionMode: rejectedMode,
    primaryInfluenceDrivers: ["scarcity"],
    objectionPriorities: [],
    trustSequence: [],
    messageOrderLogic: [],
    persuasionStrengthScore: 0,
    frictionNotes: [],
    rejectionReason: rejectedMode === "scarcity_led"
      ? "Scarcity-led persuasion rejected — insufficient trust foundation and risk of hype escalation"
      : "Reciprocity-led persuasion rejected — upstream data does not support reciprocity framing",
  };

  return { primary, alternative, rejected };
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
  accountId: string,
): Promise<PersuasionResult> {
  const startTime = Date.now();

  const reliability = assessDataReliability(mi, audience, positioning, differentiation, offer, awareness);

  const l1 = layer1_awarenessToPersuasionFit(awareness, audience);
  const l2 = layer2_objectionDetection(audience, offer, differentiation);
  const l3 = layer3_trustBarrierMapping(audience, awareness, integrity);
  const l4 = layer4_influenceDriverSelection(audience, differentiation, awareness);
  const l5 = layer5_proofPriorityMapping(differentiation, audience, awareness);
  const l6 = layer6_messageOrderLogic(awareness, audience, offer, funnel);

  const allFindings = [l1, l2, l3, l4, l5, l6].flatMap(l => [...l.findings, ...l.warnings]).join(" ");
  const l7 = layer7_antiHypeGuard(allFindings);

  const layersBeforeScoring = [l1, l2, l3, l4, l5, l6, l7];
  const l8 = layer8_persuasionStrengthScoring(layersBeforeScoring);

  const allLayers = [...layersBeforeScoring, l8];

  const routes = buildPersuasionRoutes(audience, awareness, differentiation, offer, funnel, allLayers);

  let confidenceNormalized = false;
  if (reliability.isWeak || reliability.overallReliability < 0.6) {
    routes.primary.persuasionStrengthScore = normalizeConfidence(routes.primary.persuasionStrengthScore, reliability);
    routes.alternative.persuasionStrengthScore = normalizeConfidence(routes.alternative.persuasionStrengthScore, reliability);
    confidenceNormalized = true;
  }

  const structuralWarnings: string[] = [];
  if (!integrity.safeToExecute) {
    structuralWarnings.push("Upstream integrity check flagged safe-to-execute as FALSE");
  }
  if (reliability.isWeak) {
    structuralWarnings.push("Data reliability is weak — persuasion confidence has been normalized down");
  }
  for (const lr of allLayers) {
    if (!lr.passed) {
      structuralWarnings.push(`Layer ${lr.layerName} did not pass (score: ${Math.round(lr.score * 100)}%)`);
    }
  }

  const textToCheck = [
    routes.primary.routeName,
    routes.primary.persuasionMode,
    ...routes.primary.objectionPriorities,
    ...routes.primary.messageOrderLogic,
    ...routes.primary.trustSequence,
    ...routes.primary.primaryInfluenceDrivers,
    routes.alternative.routeName,
    ...routes.alternative.objectionPriorities,
  ].join(" ");

  const boundaryResult = enforceBoundaryWithSanitization(textToCheck, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);

  if (!boundaryResult.passed && (boundaryResult.violations || []).length > 0) {
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Boundary violation: ${(boundaryResult.violations || []).join(", ")}`,
      primaryRoute: routes.primary,
      alternativeRoute: routes.alternative,
      rejectedRoute: routes.rejected,
      layerResults: allLayers,
      structuralWarnings,
      boundaryCheck: boundaryResult,
      dataReliability: reliability,
      confidenceNormalized,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
    };
  }

  return {
    status: STATUS.COMPLETE,
    statusMessage: null,
    primaryRoute: routes.primary,
    alternativeRoute: routes.alternative,
    rejectedRoute: routes.rejected,
    layerResults: allLayers,
    structuralWarnings,
    boundaryCheck: boundaryResult,
    dataReliability: reliability,
    confidenceNormalized,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
  };
}
