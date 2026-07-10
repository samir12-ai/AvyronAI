import {
  ENGINE_VERSION,
  STATUS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  LAYER_WEIGHTS,
  ENTRY_ROUTES,
  READINESS_STAGES,
  TRIGGER_CLASSES,
  GENERIC_PHRASES,
} from "./constants";
import { enforceBoundaryWithSanitization, applySoftSanitization } from "../engine-hardening";
import {
  type SignalLineageEntry,
  extractQualifyingSignals,
  validateClaimGrounding,
  MIN_QUALIFYING_SIGNALS,
} from "../shared/signal-lineage";
import { formatAELForPrompt } from "../analytical-enrichment-layer/engine";
import { acknowledgeAelInput, applyPartialAelDowngrade } from "../analytical-enrichment-layer/consumer-guard";
import {
  buildDoctrineBlock,
  deriveAnchorFromProductDna,
  type RunStrategicContext,
  type ProductAnchor,
  type ProductDnaLike,
} from "../shared/strategic-doctrine";
import {
  enforceEngineDepthCompliance,
  applyDepthPenalty,
  isDepthBlocking,
  buildDepthGateResult,
  type DepthGateResult,
} from "../causal-enforcement-layer/engine";
// Phase 4-A — Commercial Reasoning Core (awareness depth interpreter).
// See `.local/plans/phase-4-commercial-reasoning-core.md` §8a + §5.
// Default-off via COMMERCIAL_REASONER_ENABLED — when off, interpretAwarenessDepth
// short-circuits to the deterministic floor (byte-identical legacy behavior).
import { interpretAwarenessDepth } from "../commercial-reasoning/awareness-depth-interpreter";
import type {
  AwarenessPositioningInput,
  AwarenessDifferentiationInput,
  AwarenessAudienceInput,
  AwarenessOfferInput,
  AwarenessFunnelInput,
  AwarenessIntegrityInput,
  AwarenessMIInput,
  LayerResult,
  AwarenessRoute,
  AwarenessResult,
} from "./types";

const EMPTY_FUNNEL: AwarenessFunnelInput = {
  funnelName: "",
  funnelType: "none",
  stageMap: [],
  trustPath: [],
  proofPlacements: [],
  commitmentLevel: "none",
  frictionMap: [],
  entryTrigger: { mechanismType: "none", purpose: "" },
  funnelStrengthScore: 0,
};

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

// Input-boundary validator. `safeNumber`/`safeString` removed: silent
// fallback at the contract boundary hides missing critical inputs.
// validateAwarenessInputs() at engine entry guarantees audience.
// maturityIndex, audience.awarenessLevel, and mi.overallConfidence are
// present and well-typed; non-critical optional fields use per-field
// nullish coalescing with explicit literal defaults.
import { z } from "zod";

const AwarenessAudienceInputSchema = z.object({
  maturityIndex: z.number().finite(),
  awarenessLevel: z.string().min(1),
});
const AwarenessMIInputSchema = z.object({
  overallConfidence: z.number().finite(),
});

interface AwarenessInputValidation {
  ok: boolean;
  missingCritical: string[];
}

function validateAwarenessInputs(
  audience: any,
  mi: any,
): AwarenessInputValidation {
  const missing: string[] = [];
  const audR = AwarenessAudienceInputSchema.safeParse(audience);
  if (!audR.success) {
    for (const issue of audR.error.issues) missing.push(`audience.${issue.path.join(".")}`);
  }
  const miR = AwarenessMIInputSchema.safeParse(mi);
  if (!miR.success) {
    for (const issue of miR.error.issues) missing.push(`mi.${issue.path.join(".")}`);
  }
  return { ok: missing.length === 0, missingCritical: missing };
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export interface DataReliabilityAssessment {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

export function assessDataReliability(
  mi: AwarenessMIInput,
  audience: AwarenessAudienceInput,
  positioning: AwarenessPositioningInput,
  differentiation: AwarenessDifferentiationInput,
  offer: AwarenessOfferInput,
): DataReliabilityAssessment {
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
  const signalDiversity = clamp(sourceDiversity.size / 6, 0, 1);
  if (sourceDiversity.size < 3) advisories.push(`Low signal diversity: only ${sourceDiversity.size}/8 data sources populated`);

  const hasNarrative = !!positioning.narrativeDirection;
  const hasEnemy = !!positioning.enemyDefinition;
  const hasMechanism = !!differentiation.mechanismFraming;
  const narrativeStability = (hasNarrative ? 0.4 : 0) + (hasEnemy ? 0.3 : 0) + (hasMechanism ? 0.3 : 0);
  if (narrativeStability < 0.5) advisories.push("Weak narrative stability: positioning or differentiation incomplete");

  const miConfidence = (mi.overallConfidence ?? 0);
  const competitorValidity = clamp(miConfidence, 0, 1);
  if (miConfidence < 0.4) advisories.push(`Low competitor data validity: MI confidence ${miConfidence.toFixed(2)}`);

  const maturity = (audience.maturityIndex ?? 0.5);
  const marketMaturityConfidence = maturity > 0.1 ? clamp(0.5 + maturity * 0.5, 0, 1) : 0.3;

  const overallReliability = (
    signalDensity * 0.25 +
    signalDiversity * 0.25 +
    narrativeStability * 0.20 +
    competitorValidity * 0.20 +
    marketMaturityConfidence * 0.10
  );

  const isWeak = overallReliability < 0.45;
  if (isWeak) advisories.push(`Data reliability is WEAK (${overallReliability.toFixed(2)}) — confidence will be capped`);

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

export function normalizeConfidence(rawScore: number, reliability: DataReliabilityAssessment): number {
  if (reliability.isWeak) {
    return clamp(rawScore * 0.6, 0, 0.65);
  }
  if (reliability.overallReliability < 0.6) {
    return clamp(rawScore * 0.8, 0, 0.80);
  }
  return clamp(rawScore, 0, 1);
}

export function sanitizeBoundary(text: string): { clean: boolean; violations: string[] } {
  if (!text) return { clean: true, violations: [] };
  const violations: string[] = [];
  for (const [domain, pattern] of Object.entries(BOUNDARY_HARD_PATTERNS)) {
    if (pattern.test(text)) {
      violations.push(`Boundary violation: ${domain} domain detected in awareness output`);
    }
  }
  return { clean: violations.length === 0, violations };
}

// signature kept; helper below is used in primary route construction
function detectMarketMaturity(mi: AwarenessMIInput, audience: AwarenessAudienceInput): string {
  const maturity = (audience.maturityIndex ?? 0.5);
  if (maturity < 0.3) return "emerging";
  if (maturity < 0.6) return "growing";
  if (maturity < 0.8) return "mature";
  return "saturated";
}

function detectBuyerReadiness(audience: AwarenessAudienceInput): string {
  const awareness = (audience.awarenessLevel ?? "problem_aware").toLowerCase();
  if (awareness.includes("most") || awareness.includes("ready")) return "most_aware";
  if (awareness.includes("product")) return "product_aware";
  if (awareness.includes("solution")) return "solution_aware";
  if (awareness.includes("unaware") && !awareness.includes("problem")) return "unaware";
  return "problem_aware";
}

function detectTrustLevel(audience: AwarenessAudienceInput, mi: AwarenessMIInput): number {
  let trust = 0.5;
  const objections = Object.keys(audience.objectionMap || {}).length;
  if (objections > 5) trust -= 0.2;
  else if (objections > 2) trust -= 0.1;
  const threats = (mi.threatSignals || []).length;
  if (threats > 3) trust -= 0.15;
  const maturity = (audience.maturityIndex ?? 0.5);
  if (maturity > 0.7) trust += 0.1;
  return clamp(trust, 0, 1);
}

function detectProblemIntensity(audience: AwarenessAudienceInput): number {
  const pains = audience.audiencePains || [];
  const drivers = audience.emotionalDrivers || [];
  let intensity = 0.5;
  if (pains.length > 5) intensity += 0.2;
  else if (pains.length > 2) intensity += 0.1;
  if (drivers.length > 3) intensity += 0.15;
  return clamp(intensity, 0, 1);
}

export function layer1_marketEntryDetection(
  audience: AwarenessAudienceInput,
  mi: AwarenessMIInput,
  positioning: AwarenessPositioningInput,
  differentiation: AwarenessDifferentiationInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const readiness = detectBuyerReadiness(audience);
  const trustLevel = detectTrustLevel(audience, mi);
  const problemIntensity = detectProblemIntensity(audience);
  const maturity = detectMarketMaturity(mi, audience);
  const threats = (mi.threatSignals || []).length;

  const hasPainSignals = (audience.audiencePains || []).length > 0;
  const hasOpportunitySignals = (mi.opportunitySignals || []).length > 0;
  let bestEntry = hasPainSignals ? "pain_entry" : (hasOpportunitySignals ? "opportunity_entry" : "");

  if (readiness === "unaware" && problemIntensity > 0.6) {
    bestEntry = "myth_breaker_entry";
    findings.push(`Unaware audience with high problem intensity (${problemIntensity.toFixed(2)}) — myth-breaker entry optimal [selected:${bestEntry}]`);
  } else if (trustLevel < 0.4) {
    bestEntry = "proof_led_entry";
    findings.push(`Low trust level (${trustLevel.toFixed(2)}) — proof-led entry required [selected:${bestEntry}]`);
  } else if (maturity === "saturated" && threats > 2) {
    bestEntry = "authority_entry";
    findings.push(`Saturated market with competitive pressure — authority entry recommended [selected:${bestEntry}]`);
  } else if (readiness === "problem_aware" && problemIntensity > 0.5) {
    bestEntry = "pain_entry";
    findings.push(`Problem-aware audience with pain intensity ${problemIntensity.toFixed(2)} — pain entry aligned [selected:${bestEntry}]`);
  } else if (readiness === "solution_aware") {
    bestEntry = "diagnostic_entry";
    findings.push(`Solution-aware audience — diagnostic entry to differentiate [selected:${bestEntry}]`);
  } else if ((mi.opportunitySignals || []).length > 2) {
    bestEntry = "opportunity_entry";
    findings.push(`Strong opportunity signals detected — opportunity entry viable [selected:${bestEntry}]`);
  } else if (bestEntry) {
    findings.push(`Signal-derived entry selected based on audience readiness: ${readiness} [selected:${bestEntry}]`);
  } else {
    warnings.push("SIGNAL_INSUFFICIENT: No audience pain or market opportunity signals — no entry mechanism can be derived");
    score -= 0.3;
  }

  if (!positioning.narrativeDirection && !positioning.enemyDefinition) {
    warnings.push("No positioning narrative available — entry route may lack strategic grounding");
    score -= 0.1;
  }

  if ((differentiation.pillars || []).length === 0) {
    warnings.push("No differentiation pillars available — entry mechanism lacks proof structure");
    score -= 0.1;
  }

  return { layerName: "market_entry_detection", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer2_awarenessReadinessMapping(
  audience: AwarenessAudienceInput,
  mi: AwarenessMIInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const rawLevel = (audience.awarenessLevel ?? "problem_aware").toLowerCase();
  let mappedStage = "problem_aware";

  if (rawLevel.includes("unaware") || rawLevel === "none") {
    mappedStage = "unaware";
  } else if (rawLevel.includes("most") || rawLevel.includes("ready")) {
    mappedStage = "most_aware";
  } else if (rawLevel.includes("product")) {
    mappedStage = "product_aware";
  } else if (rawLevel.includes("solution")) {
    mappedStage = "solution_aware";
  }

  if (mappedStage === "unaware" && mi.narrativeObjectionCount >= 3 && mi.narrativeObjectionDensity > 0.15) {
    const solutionSignals = (audience.objectionMap ? Object.keys(audience.objectionMap).length : 0) >= 3;
    const overrideTo = solutionSignals ? "solution_aware" : "problem_aware";
    mappedStage = overrideTo;
    warnings.push(`Awareness overridden from unaware to ${overrideTo} — MI detected ${mi.narrativeObjectionCount} narrative objections (density=${mi.narrativeObjectionDensity})`);
    score -= 0.05;
  }

  findings.push(`Audience mapped to readiness stage: ${mappedStage} [selected:${mappedStage}]`);

  const maturity = (audience.maturityIndex ?? 0.5);
  if (mappedStage === "unaware" && maturity > 0.7) {
    warnings.push("Audience classified as unaware in a mature market — possible misclassification");
    score -= 0.15;
  }

  if (mappedStage === "most_aware" && (audience.audiencePains || []).length > 5) {
    warnings.push("Most-aware audience still has many unresolved pains — may be overclassified");
    score -= 0.1;
  }

  const segments = audience.audienceSegments || [];
  if (segments.length === 0) {
    warnings.push("No audience segments available — readiness mapping lacks granularity");
    score -= 0.1;
  } else {
    findings.push(`${segments.length} audience segment(s) available for readiness assessment`);
  }

  return { layerName: "awareness_readiness_mapping", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer3_attentionTriggerMapping(
  audience: AwarenessAudienceInput,
  mi: AwarenessMIInput,
  differentiation: AwarenessDifferentiationInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const pains = audience.audiencePains || [];
  const drivers = audience.emotionalDrivers || [];
  const threats = mi.threatSignals || [];
  const opportunities = mi.opportunitySignals || [];

  const multiSource = safeJsonParse(mi.multiSourceSignals);
  let websiteHeadlineCount = 0;
  let blogTopicCount = 0;
  if (multiSource && typeof multiSource === "object") {
    for (const compData of Object.values(multiSource as Record<string, any>)) {
      websiteHeadlineCount += ((compData as any)?.website?.headlineExtractions || []).length;
      blogTopicCount += ((compData as any)?.blog?.topicClusters || []).length;
    }
  }
  if (websiteHeadlineCount > 0) {
    findings.push(`Website headline signals available (${websiteHeadlineCount}) — enriching trigger detection`);
  }
  if (blogTopicCount > 0) {
    findings.push(`Blog topic signals available (${blogTopicCount}) — enriching educational awareness`);
  }

  let primaryTrigger = "";

  if (threats.length > 2 && pains.length > 3) {
    primaryTrigger = "trust_breakdown";
    findings.push(`High threat signals (${threats.length}) + audience pain (${pains.length}) — trust breakdown trigger [selected:${primaryTrigger}]`);
  } else if (differentiation.authorityMode && (differentiation.proofArchitecture || []).length > 0) {
    primaryTrigger = "authority_gap";
    findings.push(`Authority mode active with proof architecture — authority gap trigger aligned [selected:${primaryTrigger}]`);
  } else if (opportunities.length > threats.length) {
    primaryTrigger = "missed_opportunity";
    findings.push(`Opportunity signals (${opportunities.length}) exceed threats — missed opportunity trigger [selected:${primaryTrigger}]`);
  } else if (drivers.length > 3) {
    primaryTrigger = "outdated_method";
    findings.push(`Strong emotional drivers (${drivers.length}) suggest method-based trigger [selected:${primaryTrigger}]`);
  } else if (threats.length > 0) {
    primaryTrigger = "competitor_weakness";
    findings.push(`Competitive threat signals present — competitor weakness trigger [selected:${primaryTrigger}]`);
  } else if (pains.length > 0) {
    primaryTrigger = "hidden_cost";
    findings.push(`Audience pain signals present (${pains.length}) — hidden cost trigger derived from pain signals [selected:${primaryTrigger}]`);
  } else if (opportunities.length > 0) {
    primaryTrigger = "missed_opportunity";
    findings.push(`Opportunity signals present (${opportunities.length}) — missed opportunity trigger [selected:${primaryTrigger}]`);
  } else {
    primaryTrigger = "";
    warnings.push("SIGNAL_INSUFFICIENT: No pain, opportunity, or threat signals available for trigger mapping — no template trigger permitted");
    score -= 0.3;
  }

  if (pains.length === 0 && drivers.length === 0) {
    warnings.push("No pain or emotional data — trigger mapping is speculative");
    score -= 0.2;
  }

  if (!mi.marketDiagnosis) {
    warnings.push("No market diagnosis available — trigger accuracy may be reduced");
    score -= 0.1;
  }

  return { layerName: "attention_trigger_mapping", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer4_narrativeEntryAlignment(
  positioning: AwarenessPositioningInput,
  differentiation: AwarenessDifferentiationInput,
  offer: AwarenessOfferInput,
  funnel: AwarenessFunnelInput,
  entryRoute: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const narrative = (positioning.narrativeDirection ?? "");
  const enemy = (positioning.enemyDefinition ?? "");
  const mechanism = differentiation.mechanismFraming?.description || differentiation.mechanismFraming?.name || "";
  const offerOutcomeText = offer.coreOutcome || "";

  if (entryRoute === "myth_breaker_entry" && !enemy) {
    warnings.push("Myth-breaker entry selected but no positioning enemy defined — narrative misalignment");
    score -= 0.2;
  } else if (entryRoute === "myth_breaker_entry" && enemy) {
    findings.push(`Myth-breaker entry aligned with positioning enemy: "${enemy.substring(0, 60)}"`);
  }

  if (entryRoute === "authority_entry" && !differentiation.authorityMode) {
    warnings.push("Authority entry selected but no authority mode in differentiation — weak grounding");
    score -= 0.15;
  } else if (entryRoute === "authority_entry" && differentiation.authorityMode) {
    findings.push(`Authority entry aligned with differentiation authority mode: ${differentiation.authorityMode}`);
  }

  if (entryRoute === "proof_led_entry" && (differentiation.proofArchitecture || []).length === 0) {
    warnings.push("Proof-led entry selected but no proof architecture available");
    score -= 0.2;
  } else if (entryRoute === "proof_led_entry" && (differentiation.proofArchitecture || []).length > 0) {
    findings.push(`Proof-led entry backed by ${(differentiation.proofArchitecture || []).length} proof element(s)`);
  }

  if (entryRoute === "diagnostic_entry" && funnel.entryTrigger?.mechanismType !== "diagnostic") {
    warnings.push("Diagnostic entry selected but funnel entry trigger is not diagnostic-type");
    score -= 0.1;
  }

  if (narrative) {
    findings.push(`Positioning narrative present — entry route can reference strategic direction`);
  }

  if (mechanism && offerOutcomeText) {
    findings.push(`Offer mechanism and outcome available for awareness alignment`);
  } else if (!mechanism) {
    warnings.push("No differentiation mechanism — awareness entry lacks mechanism backing");
    score -= 0.1;
  }

  return { layerName: "narrative_entry_alignment", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer5_awarenessFunnelFit(
  funnel: AwarenessFunnelInput,
  entryRoute: string,
  readinessStage: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const funnelType = (funnel.funnelType || "").toLowerCase();
  const commitment = (funnel.commitmentLevel || "").toLowerCase();
  const triggerType = funnel.entryTrigger?.mechanismType || "";

  if (funnelType.includes("challenge") || funnelType.includes("quiz")) {
    if (entryRoute === "diagnostic_entry" || entryRoute === "myth_breaker_entry") {
      findings.push(`Challenge/quiz funnel aligned with ${entryRoute} — curiosity-based entry fit`);
    } else {
      warnings.push(`Challenge funnel expects curiosity/diagnostic entry, got ${entryRoute}`);
      score -= 0.15;
    }
  }

  if (funnelType.includes("consult") || funnelType.includes("call") || funnelType.includes("application")) {
    if (entryRoute === "authority_entry" || entryRoute === "proof_led_entry") {
      findings.push(`Consultation funnel aligned with trust/authority entry`);
    } else {
      warnings.push(`Consultation funnel requires trust-based entry, got ${entryRoute}`);
      score -= 0.15;
    }
  }

  if (commitment === "high" && readinessStage === "unaware") {
    warnings.push("High-commitment funnel targeting unaware audience — awareness path too short");
    score -= 0.2;
  } else if (commitment === "low" && readinessStage === "most_aware") {
    findings.push("Low-commitment funnel with most-aware audience — efficient conversion path");
  }

  if (funnel.trustPath.length > 0) {
    findings.push(`Funnel has ${funnel.trustPath.length} trust-building stage(s) — awareness can leverage`);
  } else {
    warnings.push("Funnel has no trust path — awareness entry must compensate");
    score -= 0.1;
  }

  const stages = funnel.stageMap || [];
  if (stages.length > 0) {
    findings.push(`Funnel has ${stages.length} stage(s) for awareness-to-conversion flow`);
  }

  return { layerName: "awareness_funnel_fit", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer6_trustReadinessGuard(
  audience: AwarenessAudienceInput,
  mi: AwarenessMIInput,
  entryRoute: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const trustLevel = detectTrustLevel(audience, mi);
  const trustIsBarrier = trustLevel < 0.4;

  if (trustIsBarrier) {
    const trustEntries = ["proof_led_entry", "authority_entry"];
    if (trustEntries.includes(entryRoute)) {
      findings.push(`Trust barrier detected (level: ${trustLevel.toFixed(2)}) — ${entryRoute} correctly addresses trust requirement`);
    } else {
      warnings.push(`Trust is a barrier (level: ${trustLevel.toFixed(2)}) but entry route is ${entryRoute} — should be proof-led or authority-led`);
      score -= 0.25;
    }
  } else {
    findings.push(`Trust level adequate (${trustLevel.toFixed(2)}) — no trust barrier constraint on entry route`);
  }

  const objections = Object.keys(audience.objectionMap || {});
  const trustObjections = objections.filter(o => o.toLowerCase().includes("trust") || o.toLowerCase().includes("credib") || o.toLowerCase().includes("proof"));
  if (trustObjections.length > 0) {
    if (entryRoute !== "proof_led_entry" && entryRoute !== "authority_entry") {
      warnings.push(`${trustObjections.length} trust-related objection(s) detected but entry route is not trust-focused`);
      score -= 0.1;
    } else {
      findings.push(`Trust-related objections addressed by trust-focused entry route`);
    }
  }

  const threats = mi.threatSignals || [];
  if (threats.length > 3 && entryRoute === "opportunity_entry") {
    warnings.push("High competitive threat environment — opportunity entry may appear tone-deaf");
    score -= 0.1;
  }

  return { layerName: "trust_readiness_guard", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer7_genericAwarenessDetector(
  entryDescription: string,
  routeName: string,
  triggerClass: string,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  const combined = `${entryDescription} ${routeName} ${triggerClass}`.toLowerCase();

  let genericCount = 0;
  for (const phrase of GENERIC_PHRASES) {
    if (combined.includes(phrase.toLowerCase())) {
      genericCount++;
      warnings.push(`Generic phrase detected: "${phrase}"`);
    }
  }

  if (genericCount > 0) {
    const penalty = Math.min(genericCount * 0.15, 0.5);
    score -= penalty;
    warnings.push(`${genericCount} generic phrase(s) detected — awareness route may be market noise`);
  } else {
    findings.push("No generic awareness phrases detected — route appears distinctive");
  }

  const vaguePhrases = ["everyone", "all businesses", "any industry", "universal", "one size fits all"];
  for (const vague of vaguePhrases) {
    if (combined.includes(vague)) {
      warnings.push(`Vague targeting detected: "${vague}"`);
      score -= 0.1;
    }
  }

  if (routeName && routeName.length > 10) {
    findings.push("Awareness route has a specific, non-generic name");
  }

  return { layerName: "generic_awareness_detector", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

export function layer8_awarenessStrengthScoring(
  layerResults: LayerResult[],
  audience: AwarenessAudienceInput,
  positioning: AwarenessPositioningInput,
  funnel: AwarenessFunnelInput,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];

  const dimensions: Record<string, number> = {
    audience_readiness_fit: 0,
    positioning_alignment: 0,
    funnel_compatibility: 0,
    trust_suitability: 0,
    distinctiveness: 0,
    entry_clarity: 0,
    friction_reduction: 0,
    practical_deployability: 0,
  };

  const readinessLayer = layerResults.find(l => l.layerName === "awareness_readiness_mapping");
  dimensions.audience_readiness_fit = readinessLayer ? readinessLayer.score : 0.5;

  const narrativeLayer = layerResults.find(l => l.layerName === "narrative_entry_alignment");
  dimensions.positioning_alignment = narrativeLayer ? narrativeLayer.score : 0.5;

  const funnelLayer = layerResults.find(l => l.layerName === "awareness_funnel_fit");
  dimensions.funnel_compatibility = funnelLayer ? funnelLayer.score : 0.5;

  const trustLayer = layerResults.find(l => l.layerName === "trust_readiness_guard");
  dimensions.trust_suitability = trustLayer ? trustLayer.score : 0.5;

  const genericLayer = layerResults.find(l => l.layerName === "generic_awareness_detector");
  dimensions.distinctiveness = genericLayer ? genericLayer.score : 0.5;

  const entryLayer = layerResults.find(l => l.layerName === "market_entry_detection");
  dimensions.entry_clarity = entryLayer ? entryLayer.score : 0.5;

  const frictionMap = funnel.frictionMap || [];
  dimensions.friction_reduction = frictionMap.length > 3 ? 0.5 : frictionMap.length > 0 ? 0.7 : 0.85;

  const hasPositioning = !!positioning.narrativeDirection;
  const hasSegments = (audience.audienceSegments || []).length > 0;
  dimensions.practical_deployability = (hasPositioning ? 0.5 : 0.25) + (hasSegments ? 0.3 : 0.15);

  const dimValues = Object.values(dimensions);
  const avgScore = dimValues.reduce((a, b) => a + b, 0) / dimValues.length;

  for (const [dim, val] of Object.entries(dimensions)) {
    const label = dim.replace(/_/g, " ");
    if (val >= 0.7) {
      findings.push(`${label}: strong (${val.toFixed(2)})`);
    } else if (val >= 0.4) {
      findings.push(`${label}: adequate (${val.toFixed(2)})`);
    } else {
      warnings.push(`${label}: weak (${val.toFixed(2)})`);
    }
  }

  findings.push(`Overall awareness strength: ${avgScore.toFixed(2)}`);

  const failedLayers = layerResults.filter(l => !l.passed).length;
  if (failedLayers > 2) {
    warnings.push(`${failedLayers} upstream layers failed — awareness strength significantly impacted`);
  }

  return { layerName: "awareness_strength_scoring", passed: avgScore >= 0.4, score: clamp(avgScore), findings, warnings };
}

function extractSelected(layerResult: LayerResult, fallback: string): string {
  for (const finding of layerResult.findings) {
    const match = finding.match(/\[selected:([^\]]+)\]/);
    if (match) return match[1];
  }
  return fallback;
}

function selectEntryRoute(layer1: LayerResult): string {
  return extractSelected(layer1, "");
}

function selectReadinessStage(layer2: LayerResult, audience: AwarenessAudienceInput): string {
  const canonical = (audience.awarenessLevel ?? "").toLowerCase().trim();
  const VALID = new Set(["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"]);
  if (canonical && VALID.has(canonical)) {
    return canonical;
  }
  if (canonical.includes("unaware") || canonical === "none") return "unaware";
  if (canonical.includes("most") || canonical.includes("ready")) return "most_aware";
  if (canonical.includes("product")) return "product_aware";
  if (canonical.includes("solution")) return "solution_aware";
  if (canonical.includes("problem")) return "problem_aware";
  return extractSelected(layer2, "problem_aware");
}

function selectTriggerClass(layer3: LayerResult): string {
  return extractSelected(layer3, "");
}

function buildAlternativeRoute(primaryEntry: string, audience: AwarenessAudienceInput, mi: AwarenessMIInput, canonicalReadiness: string): { entry: string; trigger: string; readiness: string } {
  const alternatives: Record<string, string> = {
    pain_entry: "diagnostic_entry",
    opportunity_entry: "authority_entry",
    myth_breaker_entry: "pain_entry",
    authority_entry: "proof_led_entry",
    proof_led_entry: "authority_entry",
    diagnostic_entry: "opportunity_entry",
  };
  const altEntry = alternatives[primaryEntry] || primaryEntry;
  const altTrigger = (mi.threatSignals || []).length > 2 ? "competitor_weakness" : "missed_opportunity";
  return { entry: altEntry, trigger: altTrigger, readiness: canonicalReadiness };
}

function buildRejectedRoute(primaryEntry: string, audience: AwarenessAudienceInput, mi: AwarenessMIInput): { entry: string; trigger: string; readiness: string; reason: string } {
  const trustLevel = detectTrustLevel(audience, mi);
  const readiness = detectBuyerReadiness(audience);

  if (trustLevel < 0.4 && primaryEntry !== "proof_led_entry") {
    return { entry: "opportunity_entry", trigger: "missed_opportunity", readiness, reason: "Trust too low for opportunity-first awareness — audience needs proof before engagement" };
  }
  if (readiness === "unaware") {
    return { entry: "diagnostic_entry", trigger: "authority_gap", readiness: "unaware", reason: "Diagnostic entry assumes solution awareness — unaware audience cannot engage diagnostics" };
  }
  if (readiness === "most_aware") {
    return { entry: "myth_breaker_entry", trigger: "outdated_method", readiness: "most_aware", reason: "Most-aware audience already past myth-breaking stage — redundant approach" };
  }
  return { entry: primaryEntry, trigger: "signal_insufficient", readiness, reason: "No signal-derived alternative — rejected route mirrors primary with insufficient signal warning" };
}

function buildTrustRequirement(entryRoute: string, trustLevel: number): string {
  if (trustLevel < 0.3) return "high — proof and authority signals required before engagement";
  if (trustLevel < 0.5) return "moderate — some trust-building needed alongside entry mechanism";
  if (entryRoute === "authority_entry" || entryRoute === "proof_led_entry") return "moderate — entry already builds trust";
  return "low — audience has adequate baseline trust";
}

function buildFunnelCompatibility(entryRoute: string, funnel: AwarenessFunnelInput): string {
  const fType = (funnel.funnelType || "").toLowerCase();
  if (entryRoute === "diagnostic_entry" && (fType.includes("challenge") || fType.includes("quiz"))) {
    return "strong — diagnostic entry naturally feeds challenge/quiz funnel";
  }
  if ((entryRoute === "authority_entry" || entryRoute === "proof_led_entry") && (fType.includes("consult") || fType.includes("application"))) {
    return "strong — trust-based entry fits high-commitment funnel";
  }
  if (entryRoute === "pain_entry" && fType.includes("lead")) {
    return "adequate — pain entry can feed lead-capture funnel";
  }
  return "adequate — entry route is compatible with funnel structure";
}

export async function runAwarenessEngine(
  mi: AwarenessMIInput,
  audience: AwarenessAudienceInput,
  positioning: AwarenessPositioningInput,
  differentiation: AwarenessDifferentiationInput,
  offer: AwarenessOfferInput,
  accountId: string,
  upstreamLineage: SignalLineageEntry[] = [],
  funnel: AwarenessFunnelInput = EMPTY_FUNNEL,
  analyticalEnrichment?: any,
  upstreamSignals?: { buyerPsychology?: any; trustMechanism?: any; gameDimension?: any; valueArchitecture?: any } | null,
  // Phase 4-A — optional commercial-reasoning persistence context. When
  // supplied, the LLM reasoner's snapshot is UPSERT'd into
  // commercial_reasoning_snapshots. When absent, the gate logic still
  // runs but persistence is skipped (best-effort).
  commercialReasoningCtx?: {
    campaignId: string;
    runId: string;
    // Phase 4-B Progressive BCL — caller (orchestrator) supplies the
    // pre-built Stage-1 profile + resolved industry slug so the
    // interpreter doesn't redundantly re-load `business_data_layer` and
    // ContentDNA, and so industry-allowlist resolution matches the
    // orchestrator's intent.
    industry?: string | null;
    businessProfile?: import("../commercial-reasoning/business-context-layer").BusinessProfile | null;
  } | null,
  // Anchor doctrine (criteria A + B + F): strategic run context + Product DNA
  // for the F5a fallback. The pre-rendered anchor block is computed ONCE here
  // and threaded into the myth-breaker + narrative-reframe sub-engines.
  strategic?: RunStrategicContext | null,
  productDna?: ProductDnaLike | null,
): Promise<AwarenessResult> {
  const startTime = Date.now();
  const structuralWarnings: string[] = [];
  // strict input boundary:
  // safeNumber/safeString must NOT silently default on missing critical
  // fields. We reset the per-run fallback report, then run a zod validator
  // against the canonical AwarenessAudienceInput / MI shapes. If a
  // critical field (audience.maturityIndex, audience.awarenessLevel,
  // mi.overallConfidence) is missing or non-finite, emit PARTIAL with
  // the structured `missingCritical` list — downstream readers see the
  // contract gap instead of a phantom default.
  const inputCheck = validateAwarenessInputs(audience, mi);

  const aelAck = acknowledgeAelInput("AwarenessEngine-V3", analyticalEnrichment ?? null, accountId);
  if (analyticalEnrichment) {
    const aelBlock = formatAELForPrompt(analyticalEnrichment);
    console.log(`[AwarenessEngine-V3] AEL_RECEIVED | enrichmentSize=${aelBlock.length}chars | dimensions=${Object.keys(analyticalEnrichment).filter(k => analyticalEnrichment[k] && (Array.isArray(analyticalEnrichment[k]) ? analyticalEnrichment[k].length > 0 : true)).length} | partial=${aelAck.partial}`);
  }

  if (!inputCheck.ok) {
    // missing critical inputs MUST emit
    // INCOMPLETE (not PARTIAL). PARTIAL is reserved for "engine produced
    // output but some optional dimensions were weak"; INCOMPLETE means the
    // contract boundary was breached and the engine refused to substitute
    // any defaults. Architect-required spec match.
    console.warn(`[AwarenessEngine-V3] INPUT_VALIDATION_INCOMPLETE | missingCritical=${inputCheck.missingCritical.join(",")}`);
    return {
      status: STATUS.INCOMPLETE,
      statusMessage: `Input validation failed: ${inputCheck.missingCritical.join(", ")} — engine returned INCOMPLETE (no silent defaults; strict contract boundary).`,
      primaryRoute: emptyRoute("input_validation_incomplete"),
      alternativeRoute: emptyRoute("input_validation_incomplete"),
      rejectedRoute: emptyRoute("input_validation_incomplete", "Critical input fields missing"),
      layerResults: [],
      structuralWarnings: [`INPUT_VALIDATION_INCOMPLETE: missingCritical=${inputCheck.missingCritical.join(",")}`],
      boundaryCheck: { passed: true, violations: [] },
      dataReliability: { signalDensity: 0, signalDiversity: 0, narrativeStability: 0, competitorValidity: 0, marketMaturityConfidence: 0, overallReliability: 0, isWeak: true, advisories: ["Input validation partial — strict boundary failed"] },
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const qualifyingSignals = extractQualifyingSignals(upstreamLineage);
  console.log(`[AwarenessEngine-V3] SIGNAL_CHECK | upstream=${upstreamLineage.length} | qualifying=${qualifyingSignals.length} | min=${MIN_QUALIFYING_SIGNALS}`);

  if (qualifyingSignals.length < MIN_QUALIFYING_SIGNALS) {
    console.log(`[AwarenessEngine-V3] SIGNAL_INSUFFICIENT | qualifying=${qualifyingSignals.length} < min=${MIN_QUALIFYING_SIGNALS}`);
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Signal-insufficient: only ${qualifyingSignals.length} qualifying upstream signals found (minimum ${MIN_QUALIFYING_SIGNALS} required). Upstream engines must generate source signals first.`,
      primaryRoute: emptyRoute("signal_insufficient"),
      alternativeRoute: emptyRoute("signal_insufficient"),
      rejectedRoute: emptyRoute("signal_insufficient", "No upstream signals"),
      layerResults: [],
      structuralWarnings: ["SIGNAL_INSUFFICIENT: Cannot generate grounded awareness route without upstream signals"],
      boundaryCheck: { passed: true, violations: [] },
      dataReliability: { signalDensity: 0, signalDiversity: 0, narrativeStability: 0, competitorValidity: 0, marketMaturityConfidence: 0, overallReliability: 0, isWeak: true, advisories: ["Signal-insufficient state"] },
      confidenceNormalized: false,
      executionTimeMs: Date.now() - startTime,
    };
  }

  const reliability = assessDataReliability(mi, audience, positioning, differentiation, offer);
  if (reliability.advisories.length > 0) {
    structuralWarnings.push(...reliability.advisories);
  }

  const l1 = layer1_marketEntryDetection(audience, mi, positioning, differentiation);
  const primaryEntry = selectEntryRoute(l1);

  const l2 = layer2_awarenessReadinessMapping(audience, mi);
  const readinessStage = selectReadinessStage(l2, audience);
  console.log(`[AwarenessEngine-V3] CANONICAL_AWARENESS | source=audience.awarenessLevel | value=${readinessStage} | (no parallel inference)`);

  const l3 = layer3_attentionTriggerMapping(audience, mi, differentiation);
  const triggerClass = selectTriggerClass(l3);

  const l4 = layer4_narrativeEntryAlignment(positioning, differentiation, offer, funnel, primaryEntry);
  const l5 = layer5_awarenessFunnelFit(funnel, primaryEntry, readinessStage);
  const l6 = layer6_trustReadinessGuard(audience, mi, primaryEntry);
  const l7 = layer7_genericAwarenessDetector("", primaryEntry, triggerClass);

  const layerResults = [l1, l2, l3, l4, l5, l6, l7];
  const l8 = layer8_awarenessStrengthScoring(layerResults, audience, positioning, funnel);
  layerResults.push(l8);

  let overallScore = 0;
  for (const lr of layerResults) {
    // no 0.1 phantom weight for unknown layers.
    // LAYER_WEIGHTS is the source of truth — an unrecognised layer
    // contributes nothing to the overall awareness score (honest zero
    // beats a synthetic 0.1 default that lets undeclared layers leak in).
    const weight = LAYER_WEIGHTS[lr.layerName] ?? 0;
    overallScore += lr.score * weight;
  }

  const confidenceNormalized = reliability.overallReliability < 0.6;
  overallScore = normalizeConfidence(overallScore, reliability);

  const trustLevel = detectTrustLevel(audience, mi);

  const primaryRoute: AwarenessRoute = {
    routeName: `${primaryEntry.replace(/_/g, " ")} awareness route`,
    entryMechanismType: primaryEntry,
    targetReadinessStage: readinessStage,
    triggerClass,
    trustRequirement: buildTrustRequirement(primaryEntry, trustLevel),
    funnelCompatibility: buildFunnelCompatibility(primaryEntry, funnel),
    awarenessStrengthScore: clamp(overallScore),
    frictionNotes: layerResults.flatMap(l => l.warnings).slice(0, 5),
    rejectionReason: null,
  };

  // Anchor doctrine (criteria A + B + F): compute the pre-rendered anchor
  // block ONCE for the awareness sub-engines (myth-breaker designer +
  // narrative-reframe designer/judge). F5a: when the doctrine anchor is
  // absent, derive one from Product DNA — deriveAnchorFromProductDna returns
  // null unless differentiator + problem + name + type all exist (D5).
  let awDoctrineBlock = "";
  if (strategic) {
    awDoctrineBlock = buildDoctrineBlock(strategic);
  } else {
    console.log("[AwarenessEngine-V3] DOCTRINE_ABSENT — no strategic context threaded; omitting doctrine block");
  }
  let awAnchor: ProductAnchor | null = strategic ? strategic.doctrine.productAnchor : null;
  if (!awAnchor && productDna) {
    const derivedAnchor = deriveAnchorFromProductDna(productDna);
    if (derivedAnchor) {
      awAnchor = derivedAnchor;
      console.log("[AwarenessEngine-V3] ANCHOR_FROM_DNA | doctrine anchor absent — prompt anchor derived from Product DNA (F5a)");
    }
  }
  // Explicit if/else source classification — no semantic-fallback chains (D1).
  let awAnchorSource: "doctrine" | "dna" | "none" = "none";
  if (strategic && strategic.doctrine.productAnchor) {
    awAnchorSource = "doctrine";
  } else if (awAnchor) {
    awAnchorSource = "dna";
  }
  const awDnaAnchorBlock = awAnchorSource === "dna" && awAnchor
    ? `
=== PRODUCT ANCHOR (derived from Product DNA — resolve every output to THIS product) ===
Product name: ${awAnchor.name}
Product type: ${awAnchor.type}${awAnchor.keyAttributes.length > 0 ? `\nKey attributes: ${awAnchor.keyAttributes.join("; ")}` : ""}
Core problem solved: ${awAnchor.coreProblemSolved}
Differentiating feature: ${awAnchor.differentiatingFeature}
`
    : "";
  const awAnchorGroundingRule = awAnchor
    ? "\nANCHOR GROUNDING: Every belief contradiction and narrative reframe MUST be specific to the anchored product above — its core problem and differentiating feature. Anchor grounding SUPPLEMENTS the existing evidence-grounding rules; it never replaces them.\n"
    : "";
  const awAnchorBlockText = `${awDoctrineBlock}${awDnaAnchorBlock}${awAnchorGroundingRule}`;

  // ── INTELLIGENCE UPGRADE: Myth-breaker reasoning ──
  try {
    const { generateMythBreaker } = await import("./myth-breaker-llm");
    const segments0 = (audience.audienceSegments || [])[0] as any;
    const sophisticationTier = segments0?.sophisticationProfile?.sophisticationTier ?? null;
    const rejectedClaimPatterns: string[] = [];
    for (const seg of (audience.audienceSegments || []) as any[]) {
      const profile = seg?.sophisticationProfile;
      if (profile?.rejectedClaimPatterns) {
        for (const p of profile.rejectedClaimPatterns) rejectedClaimPatterns.push(p.pattern);
      }
    }
    const audienceBeliefs = (audience.audienceSegments || []).flatMap((s: any) => s.beliefProfile || []);
    const objectionStatements = Object.keys(audience.objectionMap || {}).slice(0, 8);
    const mythBreaker = await generateMythBreaker({
      analyticalEnrichment: analyticalEnrichment ?? null,
      audienceObjections: objectionStatements,
      audienceBeliefs,
      audiencePains: (audience.audiencePains || []).slice(0, 8),
      marketDiagnosis: (mi as any).marketDiagnosis || null,
      enemyDefinition: null,
      contrastAxis: null,
      awarenessStage: readinessStage,
      sophisticationTier,
      rejectedClaimPatterns,
      accountId,
      doctrineBlock: awAnchorBlockText.length > 0 ? awAnchorBlockText : null,
      anchorSource: awAnchorSource,
    });
    if (mythBreaker) {
      primaryRoute.mythBreaker = mythBreaker;
      console.log(`[AwarenessEngine-V3] MYTH_BREAKER_ATTACHED | rcRefs=${mythBreaker.rootCauseRefs.join(",") || "(none)"} | statement="${mythBreaker.mythBreakerStatement.slice(0, 80)}"`);
    }
  } catch (mbErr: any) {
    console.error(`[AwarenessEngine-V3] MYTH_BREAKER_FAILED | ${mbErr.message}`);
  }

  // ── INTELLIGENCE UPGRADE: Narrative Reframe Engineer (Phase 5) ──
  // Re-engineers the buyer's mental model — current model → false bridge → new
  // model → bridge mechanism. Consumes upstream P4 buyerPsychology so the
  // reframe targets the buyer's ACTUAL current beliefs, not a generic myth.
  // Safe fallback: returns null on AI failure → engine continues with legacy
  // route + myth-breaker.
  try {
    const { engineerNarrativeReframe } = await import("./narrative-reframe");
    const bp = upstreamSignals?.buyerPsychology;
    const trust = upstreamSignals?.trustMechanism;
    const game = upstreamSignals?.gameDimension;
    const segments0 = (audience.audienceSegments || [])[0] as any;
    const fallbackTier = segments0?.sophisticationProfile?.sophisticationTier ?? null;
    const reframe = await engineerNarrativeReframe({
      awarenessStage: readinessStage,
      primaryEntryRoute: primaryEntry,
      triggerClass,
      positioningStatement: (positioning as any)?.positioningStatement || (positioning as any)?.statement || null,
      coreOffer: (offer as any)?.coreOffer || (offer as any)?.offerName || null,
      audiencePains: (audience.audiencePains || []).slice(0, 8),
      audienceObjections: Object.keys(audience.objectionMap || {}).slice(0, 6),
      buyerBeliefModel: bp?.beliefModel || null,
      buyerRejectionHistory: bp?.topRejectionPatterns || [],
      buyerDecisionTrigger: bp?.decisionTrigger?.triggeringEvent || null,
      buyerIdentityAspiration: bp?.identityAspiration?.aspirationalIdentity || null,
      buyerSophisticationTier: bp?.sophisticationTier ?? fallbackTier,
      trustMechanism: trust?.mechanism || trust?.transferMechanism || null,
      gameDimension: game?.ourDimension || game?.ourGame || null,
      accountId,
      doctrineBlock: awAnchorBlockText.length > 0 ? awAnchorBlockText : null,
      anchorSource: awAnchorSource,
    });
    if (reframe) {
      (primaryRoute as any).narrativeReframe = reframe;
      console.log(`[AwarenessEngine-V3] NARRATIVE_REFRAME_ATTACHED | movement=${reframe.bridgeMechanism.movement} | judge=${reframe.judgeVerdict} | retries=${reframe.retryCount}`);
    } else {
      console.log(`[AwarenessEngine-V3] NARRATIVE_REFRAME_FALLBACK | reframe=null, continuing with legacy route`);
    }
  } catch (nrErr: any) {
    console.error(`[AwarenessEngine-V3] NARRATIVE_REFRAME_FAILED | ${nrErr.message}`);
  }

  const alt = buildAlternativeRoute(primaryEntry, audience, mi, readinessStage);
  const altL7 = layer7_genericAwarenessDetector("", alt.entry, alt.trigger);
  const alternativeRoute: AwarenessRoute = {
    routeName: `${alt.entry.replace(/_/g, " ")} awareness route`,
    entryMechanismType: alt.entry,
    targetReadinessStage: readinessStage,
    triggerClass: alt.trigger,
    trustRequirement: buildTrustRequirement(alt.entry, trustLevel),
    funnelCompatibility: buildFunnelCompatibility(alt.entry, funnel),
    awarenessStrengthScore: clamp(normalizeConfidence(overallScore * 0.85, reliability)),
    frictionNotes: altL7.warnings.slice(0, 3),
    rejectionReason: null,
  };

  const rej = buildRejectedRoute(primaryEntry, audience, mi);
  const rejectedRoute: AwarenessRoute = {
    routeName: `${rej.entry.replace(/_/g, " ")} awareness route`,
    entryMechanismType: rej.entry,
    targetReadinessStage: readinessStage,
    triggerClass: rej.trigger,
    trustRequirement: buildTrustRequirement(rej.entry, trustLevel),
    funnelCompatibility: "incompatible — route rejected",
    awarenessStrengthScore: 0,
    frictionNotes: [],
    rejectionReason: rej.reason,
  };

  const allOutputText = [
    primaryRoute.routeName, primaryRoute.trustRequirement, primaryRoute.funnelCompatibility,
    alternativeRoute.routeName, alternativeRoute.trustRequirement,
    ...primaryRoute.frictionNotes, ...alternativeRoute.frictionNotes,
    ...layerResults.flatMap(l => [...l.findings, ...l.warnings]),
  ].join(" ");

  const boundary = enforceBoundaryWithSanitization(allOutputText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  if (!boundary.clean) {
    return {
      status: STATUS.INTEGRITY_FAILED,
      statusMessage: `Boundary violation detected — awareness engine output contains forbidden domains`,
      primaryRoute: emptyRoute("blocked"),
      alternativeRoute: emptyRoute("blocked"),
      rejectedRoute: emptyRoute("blocked", "Boundary enforcement triggered"),
      layerResults,
      structuralWarnings: boundary.violations,
      boundaryCheck: { passed: false, violations: boundary.violations, sanitized: boundary.sanitized, sanitizedText: boundary.sanitizedText, warnings: boundary.warnings },
      dataReliability: reliability,
      confidenceNormalized,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
    };
  }

  if (boundary.sanitized && boundary.warnings.length > 0) {
    structuralWarnings.push(...boundary.warnings);
    primaryRoute.routeName = applySoftSanitization(primaryRoute.routeName, BOUNDARY_SOFT_PATTERNS);
    primaryRoute.trustRequirement = applySoftSanitization(primaryRoute.trustRequirement, BOUNDARY_SOFT_PATTERNS);
    primaryRoute.funnelCompatibility = applySoftSanitization(primaryRoute.funnelCompatibility, BOUNDARY_SOFT_PATTERNS);
    primaryRoute.frictionNotes = primaryRoute.frictionNotes.map((n: string) => applySoftSanitization(n, BOUNDARY_SOFT_PATTERNS));
    alternativeRoute.routeName = applySoftSanitization(alternativeRoute.routeName, BOUNDARY_SOFT_PATTERNS);
    alternativeRoute.trustRequirement = applySoftSanitization(alternativeRoute.trustRequirement, BOUNDARY_SOFT_PATTERNS);
    alternativeRoute.frictionNotes = alternativeRoute.frictionNotes.map((n: string) => applySoftSanitization(n, BOUNDARY_SOFT_PATTERNS));
  }

  for (const lr of layerResults) {
    if (lr.warnings.length > 0) {
      structuralWarnings.push(...lr.warnings);
    }
  }

  // Depth gate must score the engine's ACTUAL substantive output — the
  // grounded myth-breaker + narrative-reframe reasoning — not just the
  // shallow route-classification labels. Excluding them scores a strawman:
  // the reasoning that genuinely references AEL root causes never reaches
  // the cosine matcher. (Shape-agnostic extraction; shallow content still
  // fails cosine matching against real root-cause text — the 0.20 gate and
  // SEMANTIC_MATCH_THRESHOLD are unchanged.)
  const _mb = primaryRoute.mythBreaker as any;
  const _nr = (primaryRoute as any).narrativeReframe;
  const asText = (v: any): string =>
    typeof v === "string"
      ? v
      : v && typeof v === "object"
        ? Object.values(v).filter((x) => typeof x === "string").join(" ")
        : "";
  const celSourceTexts = [
    primaryRoute.routeName || "",
    primaryRoute.entryMechanismType || "",
    primaryRoute.targetReadinessStage || "",
    primaryRoute.triggerClass || "",
    primaryRoute.trustRequirement || "",
    primaryRoute.funnelCompatibility || "",
    ...primaryRoute.frictionNotes,
    ...(_mb
      ? [
          _mb.mythBreakerStatement || "",
          _mb.beliefToContradict || "",
          _mb.contradictionLogic || "",
        ]
      : []),
    ...(_nr
      ? [
          asText(_nr.currentModel),
          asText(_nr.newModel),
          asText(_nr.bridgeMechanism),
          asText(_nr.discomfortCost),
        ]
      : []),
  ];
  // Phase 4-A — route the depth gate through the commercial reasoner.
  // The reasoner ALWAYS computes the deterministic floor first (returned
  // as result.deterministicFloor); when the env kill-switch is off OR any
  // integrity gate fails, the reasoner falls back to that floor and
  // behaviour is byte-identical to pre-Phase-4.
  const commercialReasoning = await interpretAwarenessDepth({
    accountId,
    campaignId: commercialReasoningCtx?.campaignId ?? `awareness-standalone:${accountId}`,
    runId: commercialReasoningCtx?.runId ?? `awareness-standalone:${Date.now()}`,
    ael: analyticalEnrichment ?? null,
    awarenessRouteSourceTexts: celSourceTexts,
    industry: commercialReasoningCtx?.industry ?? null,
    businessProfile: commercialReasoningCtx?.businessProfile ?? null,
  });
  const celDepth = commercialReasoning.deterministicFloor;
  const reasonerLifted =
    commercialReasoning.fellBackTo === "none" &&
    commercialReasoning.gateDecision.allow === true;
  if (commercialReasoning.fellBackTo === "none") {
    console.log(
      `[AwarenessEngine-V3] COMMERCIAL_REASONER: verdict=${commercialReasoning.integrityVerdict} reason=${commercialReasoning.gateDecision.reason} allow=${commercialReasoning.gateDecision.allow}`,
    );
  } else {
    console.log(
      `[AwarenessEngine-V3] COMMERCIAL_REASONER_FALLBACK: reason=${commercialReasoning.gateDecision.reason} floorAllow=${celDepth.passed}`,
    );
  }

  let depthGateResult: DepthGateResult | null = null;

  if (
    analyticalEnrichment &&
    isDepthBlocking(celDepth, celSourceTexts) &&
    !reasonerLifted
  ) {
    depthGateResult = buildDepthGateResult(celDepth, 1, 1, [`Attempt 1: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length}) — non-generative engine, no retry`], celSourceTexts);
    for (const logEntry of celDepth.enforcementLog) {
      console.log(`[AwarenessEngine-V3] CEL_DEPTH: ${logEntry}`);
    }
    console.log(`[AwarenessEngine-V3] DEPTH_GATE: DEPTH_FAILED — non-generative engine, cannot retry | depthScore=${celDepth.causalDepthScore}`);
    primaryRoute.awarenessStrengthScore = 0;
    alternativeRoute.awarenessStrengthScore = 0;
    return applyPartialAelDowngrade("AwarenessEngine-V3", {
      status: "DEPTH_FAILED",
      statusMessage: `Depth gate failed: depthScore=${celDepth.causalDepthScore} — non-generative engine, cannot regenerate`,
      primaryRoute,
      alternativeRoute,
      rejectedRoute,
      layerResults,
      structuralWarnings: [...structuralWarnings, "DEPTH_FAILED"],
      boundaryCheck: { passed: true, violations: [], sanitized: boundary.sanitized, sanitizedText: boundary.sanitizedText, warnings: boundary.warnings },
      dataReliability: reliability,
      confidenceNormalized,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      celDepthCompliance: celDepth,
      depthGateResult,
    }, aelAck);
  }

  if (celDepth.violations.length > 0) {
    for (const logEntry of celDepth.enforcementLog) {
      console.log(`[AwarenessEngine-V3] CEL_DEPTH: ${logEntry}`);
    }
    if (!celDepth.passed) {
      primaryRoute.awarenessStrengthScore = applyDepthPenalty(primaryRoute.awarenessStrengthScore, celDepth);
      alternativeRoute.awarenessStrengthScore = applyDepthPenalty(alternativeRoute.awarenessStrengthScore, celDepth);
    }
  } else {
    console.log(`[AwarenessEngine-V3] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
  }

  depthGateResult = buildDepthGateResult(celDepth, 1, 1, [`Attempt 1: PASSED (depthScore=${celDepth.causalDepthScore})`], celSourceTexts);

  const __awarenessResult = {
    status: STATUS.COMPLETE,
    statusMessage: confidenceNormalized
      ? `Analysis complete — confidence normalized due to data reliability (${reliability.overallReliability.toFixed(2)})`
      : null,
    primaryRoute,
    alternativeRoute,
    rejectedRoute,
    layerResults,
    structuralWarnings,
    boundaryCheck: { passed: true, violations: [], sanitized: boundary.sanitized, sanitizedText: boundary.sanitizedText, warnings: boundary.warnings },
    dataReliability: reliability,
    confidenceNormalized,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    celDepthCompliance: celDepth,
    depthGateResult,
  };
  return applyPartialAelDowngrade("AwarenessEngine-V3", __awarenessResult, aelAck);
}

function emptyRoute(name: string, reason: string | null = null): AwarenessRoute {
  return {
    routeName: name,
    entryMechanismType: "",
    targetReadinessStage: "",
    triggerClass: "",
    trustRequirement: "",
    funnelCompatibility: "",
    awarenessStrengthScore: 0,
    frictionNotes: [],
    rejectionReason: reason,
  };
}
