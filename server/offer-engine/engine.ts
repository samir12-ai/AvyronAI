import { aiChat } from "../ai-client";
import { detectGenericOutput, checkCrossEngineAlignment, enforceBoundaryWithSanitization, applySoftSanitization } from "../engine-hardening";
import {
  ENGINE_VERSION,
  OFFER_DEPTH_WEIGHTS,
  GENERIC_OFFER_PATTERNS,
  GENERIC_PENALTY,
  BOUNDARY_BLOCKED_PATTERNS,
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  MIN_PROOF_STRENGTH,
  MIN_OUTCOME_SPECIFICITY,
  MAX_DELIVERABLES,
  FRICTION_THRESHOLD,
  STATUS,
  VAGUE_OUTCOME_PATTERNS,
  OUTCOME_PRECISION_MARKERS,
  VAGUE_MECHANISM_PATTERNS,
  MECHANISM_CLARITY_MARKERS,
  MIN_DIFFERENTIATION_SCORE,
} from "./constants";
import {
  assessDataReliability,
  normalizeConfidence,
  type DataReliabilityDiagnostics,
} from "../engine-hardening";
import { assessStrategyAcceptability } from "../shared/strategy-acceptability";
import {
  type SignalLineageEntry,
  type QualifyingSignal,
  type SignalGroundingResult,
  extractQualifyingSignals,
  validateClaimGrounding,
  findBestParentSignal,
  createDerivedLineageEntry,
  mergeLineageArrays,
  MIN_QUALIFYING_SIGNALS,
} from "../shared/signal-lineage";
import type {
  MarketLanguageMap,
  OfferMIInput,
  OfferAudienceInput,
  OfferPositioningInput,
  OfferDifferentiationInput,
  OutcomeLayer,
  MechanismLayer,
  DeliveryLayer,
  ProofLayer,
  RiskReductionLayer,
  OfferCandidate,
  OfferDepthScores,
  OfferResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export function buildMarketLanguageMap(audience: OfferAudienceInput): MarketLanguageMap {
  const rawPainPhrases: string[] = [];
  const rawDesirePhrases: string[] = [];
  const emotionalLanguage: string[] = [];
  const objectionLanguage: string[] = [];

  const pains = audience.audiencePains || [];
  for (const pain of pains) {
    if (typeof pain === "string") {
      rawPainPhrases.push(pain);
    } else if (pain && typeof pain === "object") {
      if (pain.canonical) rawPainPhrases.push(pain.canonical);
      if (pain.pain) rawPainPhrases.push(pain.pain);
      if (pain.name && pain.name !== pain.canonical) rawPainPhrases.push(pain.name);
      if (Array.isArray(pain.evidence)) {
        for (const ev of pain.evidence) {
          if (typeof ev === "string" && ev.length > 5) rawPainPhrases.push(ev);
        }
      }
    }
  }

  const desires = Object.entries(audience.desireMap || {});
  for (const [key, value] of desires) {
    rawDesirePhrases.push(key);
    if (value && typeof value === "object") {
      if (value.canonical) rawDesirePhrases.push(value.canonical);
      if (Array.isArray(value.evidence)) {
        for (const ev of value.evidence) {
          if (typeof ev === "string" && ev.length > 5) rawDesirePhrases.push(ev);
        }
      }
    }
  }

  const emotionalDrivers = audience.emotionalDrivers || [];
  for (const driver of emotionalDrivers) {
    if (typeof driver === "string") {
      emotionalLanguage.push(driver);
    } else if (driver && typeof driver === "object") {
      if (driver.canonical) emotionalLanguage.push(driver.canonical);
      if (Array.isArray(driver.evidence)) {
        for (const ev of driver.evidence) {
          if (typeof ev === "string" && ev.length > 5) emotionalLanguage.push(ev);
        }
      }
    }
  }

  const objections = Object.entries(audience.objectionMap || {});
  for (const [key, value] of objections) {
    objectionLanguage.push(key);
    if (value && typeof value === "object") {
      if (value.canonical) objectionLanguage.push(value.canonical);
      if (Array.isArray(value.evidence)) {
        for (const ev of value.evidence) {
          if (typeof ev === "string" && ev.length > 5) objectionLanguage.push(ev);
        }
      }
    }
  }

  const dedupe = (arr: string[]) => [...new Set(arr.filter(s => s && s.trim().length > 0))];

  return {
    rawPainPhrases: dedupe(rawPainPhrases),
    rawDesirePhrases: dedupe(rawDesirePhrases),
    emotionalLanguage: dedupe(emotionalLanguage),
    objectionLanguage: dedupe(objectionLanguage),
  };
}

export function detectGenericOffer(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GENERIC_OFFER_PATTERNS.some(p => p.test(lower));
}

export function sanitizeBoundary(text: string): { clean: boolean; violations: string[] } {
  if (!text) return { clean: true, violations: [] };
  const lower = text.toLowerCase();
  const violations: string[] = [];

  for (const [domain, pattern] of Object.entries(BOUNDARY_BLOCKED_PATTERNS)) {
    if (pattern.test(lower)) {
      violations.push(`Boundary violation: ${domain} domain detected`);
    }
  }

  return { clean: violations.length === 0, violations };
}

export function scoreOutcomePrecision(outcomeText: string): { score: number; isVague: boolean; hasPrecisionMarker: boolean } {
  const lower = outcomeText.toLowerCase();
  const isVague = VAGUE_OUTCOME_PATTERNS.some(p => p.test(lower));
  const precisionHits = OUTCOME_PRECISION_MARKERS.filter(p => p.test(lower)).length;
  const hasPrecisionMarker = precisionHits > 0;
  let score = 0.5;
  if (isVague) score -= 0.25;
  if (hasPrecisionMarker) score += Math.min(precisionHits * 0.1, 0.4);
  return { score: clamp(score), isVague, hasPrecisionMarker };
}

export interface PositioningLock {
  locked: boolean;
  contrastAxis: string | null;
  enemyDefinition: string | null;
  narrativeDirection: string | null;
  mechanismFamily: string | null;
  mechanismName: string | null;
  axisTokens: string[];
  problemDomain: string | null;
  solutionDomain: string | null;
}

export function buildPositioningLock(
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
): PositioningLock {
  const contrastAxis = (positioning.contrastAxis || "").trim();
  const enemyDefinition = (positioning.enemyDefinition || "").trim();
  const narrativeDirection = (positioning.narrativeDirection || "").trim();

  const mechanism = differentiation.mechanismFraming || {};
  const core = differentiation.mechanismCore;
  const mechanismFamily = mechanism.supported ? (mechanism.type || "none") : "none";
  const mechanismName = core && core.mechanismType !== "none" ? core.mechanismName : null;

  const extractTokens = (text: string): string[] =>
    text.toLowerCase().split(/[\s,.\-/]+/).filter(t => t.length > 2);
  const axisTokens = [...new Set([
    ...extractTokens(contrastAxis),
    ...extractTokens(enemyDefinition),
  ])];

  let problemDomain: string | null = null;
  let solutionDomain: string | null = null;

  if (contrastAxis) {
    const vsMatch = contrastAxis.match(/(.+?)\s+(?:vs\.?|versus|instead of|not|rather than)\s+(.+)/i);
    if (vsMatch) {
      problemDomain = vsMatch[1].trim();
      solutionDomain = vsMatch[2].trim();
    } else {
      problemDomain = contrastAxis;
    }
  }

  if (!problemDomain && core && core.mechanismProblem) {
    problemDomain = core.mechanismProblem;
  }
  if (!solutionDomain && mechanismName) {
    solutionDomain = mechanismName;
  }

  const locked = !!(contrastAxis || enemyDefinition || mechanismName);

  return {
    locked,
    contrastAxis: contrastAxis || null,
    enemyDefinition: enemyDefinition || null,
    narrativeDirection: narrativeDirection || null,
    mechanismFamily: mechanismFamily !== "none" ? mechanismFamily : null,
    mechanismName,
    axisTokens,
    problemDomain,
    solutionDomain,
  };
}

export function validatePreGenerationConstraints(
  lock: PositioningLock,
  differentiation: OfferDifferentiationInput,
): { compatible: boolean; issues: string[] } {
  const issues: string[] = [];

  if (lock.locked && !lock.contrastAxis && !lock.mechanismName) {
    issues.push("Positioning lock is active but has no contrast axis and no mechanism name — axis alignment cannot be enforced");
  }

  const mechanism = differentiation.mechanismFraming || {};
  const core = differentiation.mechanismCore;

  if (lock.mechanismFamily && mechanism.supported && mechanism.type) {
    if (lock.mechanismFamily !== mechanism.type && mechanism.type !== "none") {
      issues.push(`Mechanism family mismatch: lock="${lock.mechanismFamily}" vs differentiation="${mechanism.type}"`);
    }
  }

  if (lock.mechanismName && core && core.mechanismName) {
    if (lock.mechanismName !== core.mechanismName) {
      issues.push(`Mechanism name mismatch in lock: "${lock.mechanismName}" vs core: "${core.mechanismName}"`);
    }
  }

  return { compatible: issues.length === 0, issues };
}

export function clampOfferToAxis(
  offerName: string,
  coreOutcome: string,
  mechanismDescription: string,
  lock: PositioningLock,
): { offerName: string; coreOutcome: string; mechanismDescription: string; clamped: boolean; clampActions: string[] } {
  if (!lock.locked) {
    return { offerName, coreOutcome, mechanismDescription, clamped: false, clampActions: [] };
  }

  const clampActions: string[] = [];
  let clampedName = offerName;
  let clampedOutcome = coreOutcome;
  let clampedMech = mechanismDescription;

  if (lock.mechanismName) {
    const mechLower = mechanismDescription.toLowerCase();
    const nameLower = lock.mechanismName.toLowerCase();
    if (!mechLower.includes(nameLower)) {
      clampedMech = `${lock.mechanismName}: ${mechanismDescription}`;
      clampActions.push(`Mechanism clamped — prepended locked mechanism name "${lock.mechanismName}"`);
    }
  }

  if (lock.problemDomain) {
    const problemTokens = lock.problemDomain.toLowerCase().split(/[\s,.\-/]+/).filter(t => t.length > 3);
    const nameHasProblem = problemTokens.some(t => clampedName.toLowerCase().includes(t));
    const outcomeHasProblem = problemTokens.some(t => clampedOutcome.toLowerCase().includes(t));
    const mechHasProblem = problemTokens.some(t => clampedMech.toLowerCase().includes(t));

    if (!nameHasProblem && !outcomeHasProblem && !mechHasProblem && problemTokens.length > 0) {
      clampedOutcome = `${clampedOutcome} — addressing ${lock.problemDomain}`;
      clampActions.push(`Outcome clamped — appended problem domain "${lock.problemDomain}"`);
    }
  }

  return {
    offerName: clampedName,
    coreOutcome: clampedOutcome,
    mechanismDescription: clampedMech,
    clamped: clampActions.length > 0,
    clampActions,
  };
}

export function layer1_outcomeConstruction(
  audience: OfferAudienceInput,
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
  marketLanguage?: MarketLanguageMap,
): OutcomeLayer {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const territories = positioning.territories || [];
  const pillars = differentiation.pillars || [];

  const rawPainPhrase = marketLanguage?.rawPainPhrases?.[0];
  const rawDesirePhrase = marketLanguage?.rawDesirePhrases?.[0];

  const primaryPain = rawPainPhrase || (pains.length > 0 ? (typeof pains[0] === "string" ? pains[0] : pains[0]?.pain || pains[0]?.name || "unresolved challenge") : "unresolved challenge");
  const primaryDesire = rawDesirePhrase || (desires.length > 0 ? desires[0][0] : "");
  const topTerritory = territories.length > 0 ? (territories[0].name || "") : "";
  const topPillar = pillars.length > 0 ? (pillars[0].name || "") : "";

  let transformationStatement: string;
  let primaryOutcome: string;

  if (primaryDesire && topTerritory) {
    transformationStatement = `Eliminate "${primaryPain}" and deliver ${primaryDesire} through ${topTerritory}`;
  } else if (primaryDesire) {
    transformationStatement = `Resolve "${primaryPain}" to achieve ${primaryDesire}`;
  } else {
    transformationStatement = `Address "${primaryPain}" with a structured resolution path`;
  }

  if (primaryDesire && topPillar) {
    primaryOutcome = `Deliver ${primaryDesire} using ${topPillar} as the primary performance driver`;
  } else if (primaryDesire) {
    primaryOutcome = `Achieve ${primaryDesire} through signal-backed strategic execution`;
  } else if (topPillar) {
    primaryOutcome = `Drive measurable business impact via ${topPillar}`;
  } else {
    primaryOutcome = `Resolve "${primaryPain}" with structured, outcome-tracked delivery`;
  }

  const hasMarketLanguage = !!(rawPainPhrase || rawDesirePhrase);
  const painSpecificity = pains.length > 0 ? clamp(0.4 + (Math.min(pains.length, 5) * 0.1)) : 0.2;
  const desireSpecificity = desires.length > 0 ? clamp(0.4 + (Math.min(desires.length, 5) * 0.1)) : 0.2;
  const baseSpecificity = clamp((painSpecificity + desireSpecificity) / 2);
  let specificityScore = hasMarketLanguage ? clamp(baseSpecificity + 0.1) : baseSpecificity;

  const outcomePrecision = scoreOutcomePrecision(primaryOutcome);
  if (outcomePrecision.isVague) {
    specificityScore = clamp(specificityScore - 0.15);
    console.log(`[OfferEngine-V4] OUTCOME_PRECISION | vague outcome detected — specificity penalized`);
  }
  if (outcomePrecision.hasPrecisionMarker) {
    specificityScore = clamp(specificityScore + 0.1);
  }

  return { primaryOutcome, transformationStatement, specificityScore };
}

export function scoreMechanismClarity(mechanismDescription: string): { score: number; isVague: boolean; hasStructuralNaming: boolean } {
  const lower = mechanismDescription.toLowerCase();
  const isVague = VAGUE_MECHANISM_PATTERNS.some(p => p.test(lower));
  const clarityHits = MECHANISM_CLARITY_MARKERS.filter(p => p.test(lower)).length;
  const hasStructuralNaming = clarityHits >= 2;
  let score = 0.5;
  if (isVague) score -= 0.2;
  if (hasStructuralNaming) score += Math.min(clarityHits * 0.08, 0.3);
  return { score: clamp(score), isVague, hasStructuralNaming };
}

function enforceStructuralMechanismName(description: string, mechanismType: string, mechanismName?: string): string {
  const clarity = scoreMechanismClarity(description);
  if (!clarity.isVague && clarity.hasStructuralNaming) return description;

  const structuralSuffixes: Record<string, string> = {
    framework: "Framework",
    system: "System",
    process: "Process",
    model: "Model",
    program: "Program",
    tool: "Platform",
    service: "Engine",
  };
  const suffix = structuralSuffixes[mechanismType] || "System";

  if (mechanismName && !clarity.hasStructuralNaming) {
    return `${mechanismName} ${suffix}: ${description}`;
  }
  return description;
}

export function layer2_mechanismAlignment(
  differentiation: OfferDifferentiationInput,
): MechanismLayer {
  const core = differentiation.mechanismCore;
  const mechanism = differentiation.mechanismFraming || {};
  const pillars = differentiation.pillars || [];
  const topPillar = pillars.length > 0 ? (pillars[0].name || "core pillar") : "core pillar";

  if (core && core.mechanismType !== "none" && core.mechanismName) {
    const mechanismType = core.mechanismType;
    const rawDescription = core.mechanismLogic || core.mechanismPromise || mechanism.description || "";
    const mechanismDescription = enforceStructuralMechanismName(rawDescription, mechanismType, core.mechanismName);
    const differentiationLink = `Mechanism "${core.mechanismName}" (${core.mechanismType}) anchored to ${topPillar} via MechanismCore`;
    const stepsBonus = core.mechanismSteps.length > 0 ? clamp(core.mechanismSteps.length * 0.1, 0, 0.3) : 0;
    const clarity = scoreMechanismClarity(mechanismDescription);
    const clarityBonus = clarity.hasStructuralNaming ? 0.1 : 0;
    const clarityPenalty = clarity.isVague ? 0.15 : 0;
    const credibilityScore = clamp(0.7 + stepsBonus + clarityBonus - clarityPenalty);
    if (clarity.isVague) {
      console.log(`[OfferEngine-V4] MECHANISM_CLARITY | vague mechanism description detected — credibility penalized`);
    }
    return { mechanismType, mechanismDescription, differentiationLink, credibilityScore };
  }

  const mechanismType = mechanism.type || "none";
  const rawDescription = mechanism.description || "";
  const mechanismDescription = rawDescription ? enforceStructuralMechanismName(rawDescription, mechanismType) : "Awaiting mechanism definition from Differentiation Engine";
  const differentiationLink = mechanism.supported
    ? `Mechanism anchored to ${topPillar} with structural proof support`
    : `Generic delivery approach — mechanism not yet structurally validated`;

  const typeScore = mechanism.supported ? 0.7 : 0.3;
  const proofScore = mechanism.proofBasis?.length > 0 ? clamp(0.3 + (mechanism.proofBasis.length * 0.1)) : 0.2;
  const clarity = scoreMechanismClarity(mechanismDescription);
  const clarityMod = clarity.isVague ? -0.1 : (clarity.hasStructuralNaming ? 0.05 : 0);
  const credibilityScore = clamp(typeScore * 0.6 + proofScore * 0.4 + clarityMod);

  return { mechanismType, mechanismDescription, differentiationLink, credibilityScore };
}

export function layer3_deliveryStructure(
  audience: OfferAudienceInput,
  differentiation: OfferDifferentiationInput,
): DeliveryLayer {
  const maturity = audience.maturityIndex ?? 0.5;
  const awareness = audience.awarenessLevel || "unaware";
  const pillars = differentiation.pillars || [];
  const core = differentiation.mechanismCore;

  const deliverables: string[] = [];

  if (core && core.mechanismSteps.length > 0) {
    for (const step of core.mechanismSteps.slice(0, MAX_DELIVERABLES)) {
      deliverables.push(`${step} — ${core.mechanismType !== "none" ? core.mechanismType : "implementation"} module`);
    }
  } else {
    for (const pillar of pillars.slice(0, 4)) {
      const name = pillar.name || pillar.territory || "component";
      deliverables.push(`${name} implementation module`);
    }

    if (maturity < 0.4 || awareness === "unaware" || awareness === "problem_aware") {
      deliverables.push("Foundation assessment and baseline analysis");
    }

    if (maturity > 0.6 || awareness === "product_aware" || awareness === "most_aware") {
      deliverables.push("Advanced optimization and scaling framework");
    }
  }

  if (deliverables.length === 0) {
    deliverables.push("Core transformation system");
  }

  const capped = deliverables.slice(0, MAX_DELIVERABLES);
  const format = core && core.mechanismSteps.length > 0
    ? `${core.mechanismType !== "none" ? core.mechanismType.charAt(0).toUpperCase() + core.mechanismType.slice(1) : "Structured"}-based delivery with ${core.mechanismSteps.length} modules`
    : (maturity > 0.6 ? "Advanced system with modular components" : "Guided implementation program");
  const complexityLevel = clamp(capped.length / MAX_DELIVERABLES);

  return { deliverables: capped, format, complexityLevel };
}

export function layer4_proofAlignment(
  differentiation: OfferDifferentiationInput,
  hasObjectionSignals: boolean = false,
  objectionContext?: Array<{ text: string; category: string }>,
): ProofLayer {
  const proofArchitecture = differentiation.proofArchitecture || [];
  const pillars = differentiation.pillars || [];

  const proofTypes = new Set<string>();
  const availableTypes = ["process_proof", "outcome_proof", "transparency_proof", "case_proof", "framework_proof", "comparative_proof"];
  const objectionRequiredProofs = new Set(["transparency_proof", "outcome_proof", "process_proof"]);

  const objectionProofMapping: Record<string, string[]> = {};

  const objectionKeywords = (objectionContext || []).map(o => ({
    text: o.text.toLowerCase(),
    category: o.category,
  }));

  const OBJECTION_TO_PROOF: Array<{ keywords: RegExp; proofType: string }> = [
    { keywords: /trust|transparent|hide|secret|honest|truth|lying/i, proofType: "transparency_proof" },
    { keywords: /result|outcome|deliver|promise|guarantee|roi|perform/i, proofType: "outcome_proof" },
    { keywords: /process|method|how|approach|system|step|implement/i, proofType: "process_proof" },
    { keywords: /proof|evidence|case|example|client|success|testimon/i, proofType: "case_proof" },
    { keywords: /different|unique|better|compare|versus|unlike|stand out/i, proofType: "comparative_proof" },
    { keywords: /framework|structure|model|architecture|blueprint/i, proofType: "framework_proof" },
  ];

  for (const obj of objectionKeywords) {
    for (const mapping of OBJECTION_TO_PROOF) {
      if (mapping.keywords.test(obj.text)) {
        if (!objectionProofMapping[mapping.proofType]) {
          objectionProofMapping[mapping.proofType] = [];
        }
        objectionProofMapping[mapping.proofType].push(obj.text.slice(0, 60));
      }
    }
  }

  for (const asset of proofArchitecture) {
    if (asset.category && availableTypes.includes(asset.category)) {
      if (objectionRequiredProofs.has(asset.category) && !hasObjectionSignals) {
        continue;
      }
      proofTypes.add(asset.category);
    }
  }

  for (const pillar of pillars) {
    const supporting = pillar.supportingProof || [];
    for (const p of supporting) {
      if (availableTypes.includes(p)) {
        if (objectionRequiredProofs.has(p) && !hasObjectionSignals) {
          continue;
        }
        proofTypes.add(p);
      }
    }
  }

  if (hasObjectionSignals && Object.keys(objectionProofMapping).length > 0) {
    for (const proofType of Object.keys(objectionProofMapping)) {
      if (availableTypes.includes(proofType)) {
        proofTypes.add(proofType);
      }
    }
    const mappedCount = Object.keys(objectionProofMapping).length;
    console.log(`[OfferEngine-V4] PROOF_OBJECTION_MAP | ${mappedCount} proof types mapped to specific objections: ${Object.entries(objectionProofMapping).map(([k, v]) => `${k}→[${v.length}]`).join(", ")}`);
  }

  if (!hasObjectionSignals && proofTypes.size > 0) {
    console.log(`[OfferEngine-V4] PROOF_SIGNAL_GATE | objection signals absent — skipped ${[...objectionRequiredProofs].filter(p => !proofTypes.has(p)).length} objection-required proof types`);
  }

  const alignedProofTypes = Array.from(proofTypes);
  const objectionMappedBonus = Object.keys(objectionProofMapping).length > 0 ? 0.1 : 0;
  const proofStrength = clamp(alignedProofTypes.length / 4 + objectionMappedBonus);

  const mandatoryProof = hasObjectionSignals
    ? ["process_proof", "outcome_proof", "transparency_proof", "case_proof"]
    : ["case_proof"];
  const proofGaps = mandatoryProof.filter(p => !proofTypes.has(p));

  return { alignedProofTypes, proofStrength, proofGaps };
}

export function layer5_riskReduction(
  audience: OfferAudienceInput,
  proofLayer: ProofLayer,
): RiskReductionLayer {
  const objections = Object.entries(audience.objectionMap || {});
  const emotionalDrivers = audience.emotionalDrivers || [];

  const riskReducers: string[] = [];
  const frictionMitigations: string[] = [];

  if (proofLayer.alignedProofTypes.includes("case_proof")) {
    riskReducers.push("Validated through documented case outcomes");
  }
  if (proofLayer.alignedProofTypes.includes("process_proof")) {
    riskReducers.push("Structured methodology reduces implementation uncertainty");
  }
  if (proofLayer.alignedProofTypes.includes("outcome_proof")) {
    riskReducers.push("Measurable outcome benchmarks provided");
  }
  if (proofLayer.alignedProofTypes.includes("transparency_proof")) {
    riskReducers.push("Full transparency on process and expectations");
  }

  for (const [objection] of objections.slice(0, 3)) {
    frictionMitigations.push(`Addresses concern: ${objection}`);
  }

  if (emotionalDrivers.length > 0) {
    frictionMitigations.push("Aligned with primary emotional drivers");
  }

  if (riskReducers.length === 0 && (objections.length > 0 || emotionalDrivers.length > 0)) {
    riskReducers.push("Risk mitigation aligned to identified audience concerns");
  }

  const buyerConfidenceScore = clamp(
    (riskReducers.length * 0.15) + (frictionMitigations.length * 0.10) + (proofLayer.proofStrength * 0.3)
  );

  return { riskReducers, frictionMitigations, buyerConfidenceScore };
}

export function checkOfferCompleteness(
  outcome: OutcomeLayer,
  mechanism: MechanismLayer,
  delivery: DeliveryLayer,
  proof: ProofLayer,
  riskReduction: RiskReductionLayer,
): { complete: boolean; missingLayers: string[] } {
  const missingLayers: string[] = [];

  if (!outcome.primaryOutcome || outcome.specificityScore < MIN_OUTCOME_SPECIFICITY) {
    missingLayers.push("Outcome Layer — insufficient specificity");
  }
  if (mechanism.mechanismType === "none" && mechanism.credibilityScore < 0.3) {
    missingLayers.push("Mechanism Layer — no validated mechanism");
  }
  if (delivery.deliverables.length === 0) {
    missingLayers.push("Delivery Layer — no deliverables defined");
  }
  if (proof.proofStrength < MIN_PROOF_STRENGTH) {
    missingLayers.push("Proof Layer — insufficient proof alignment");
  }
  if (riskReduction.riskReducers.length === 0) {
    missingLayers.push("Risk Reduction Layer — no risk mitigations");
  }

  return { complete: missingLayers.length === 0, missingLayers };
}

export function integrityCheck(
  offer: { outcome: OutcomeLayer; mechanism: MechanismLayer; proof: ProofLayer },
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
  audience: OfferAudienceInput,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (offer.outcome.specificityScore < MIN_OUTCOME_SPECIFICITY) {
    failures.push("Outcome lacks clarity — specificity below threshold");
  }

  if (offer.mechanism.credibilityScore < 0.3) {
    failures.push("Mechanism lacks specificity — credibility below threshold");
  }

  if (offer.proof.proofStrength < MIN_PROOF_STRENGTH) {
    failures.push("Proof strength insufficient relative to promise");
  }

  const pillars = differentiation.pillars || [];
  if (pillars.length > 0) {
    const avgPillarScore = pillars.reduce((s: number, p: any) => s + (p.overallScore || 0), 0) / pillars.length;
    if (avgPillarScore < 0.3) {
      failures.push("Weak differentiation pillar support");
    }
  }

  if (positioning.narrativeDirection) {
    const narrative = positioning.narrativeDirection.toLowerCase();
    const enemy = (positioning.enemyDefinition || "").toLowerCase();
    if (enemy && offer.outcome.primaryOutcome.toLowerCase().includes(enemy)) {
      failures.push("Offer outcome contradicts positioning enemy definition");
    }
  }

  const pains = audience.audiencePains || [];
  const desires = Object.keys(audience.desireMap || {});
  if (pains.length === 0 && desires.length === 0) {
    failures.push("No audience pain/desire alignment data available");
  }

  return { passed: failures.length === 0, failures };
}

export function checkPositioningConsistency(
  offer: OfferCandidate,
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
): { consistent: boolean; contradictions: string[] } {
  const contradictions: string[] = [];
  const offerText = `${offer.offerName} ${offer.coreOutcome} ${offer.mechanismDescription}`.toLowerCase();

  if (positioning.enemyDefinition) {
    const enemy = positioning.enemyDefinition.toLowerCase();
    if (offerText.includes(enemy)) {
      contradictions.push(`Offer language contains positioning enemy: "${positioning.enemyDefinition}"`);
    }
  }

  if (positioning.contrastAxis) {
    const contrast = positioning.contrastAxis.toLowerCase();
    const contrastTokens = contrast.split(/\s+/).filter(t => t.length > 3);
    const negativeAlignment = contrastTokens.some(t => offerText.includes(t));
    if (!negativeAlignment && contrastTokens.length > 0) {
      contradictions.push("Offer does not reflect positioning contrast axis");
    }
  }

  const mechanism = differentiation.mechanismFraming || {};
  if (mechanism.supported && mechanism.type !== "none") {
    const mechDesc = (mechanism.description || "").toLowerCase();
    const mechTokens = mechDesc.split(/\s+/).filter((t: string) => t.length > 4).slice(0, 5);
    const hasAlignment = mechTokens.some((t: string) => offerText.includes(t));
    if (!hasAlignment && mechTokens.length > 2) {
      contradictions.push("Offer mechanism does not align with differentiation mechanism framing");
    }
  }

  return { consistent: contradictions.length === 0, contradictions };
}

export function checkHookMechanismAlignment(
  offer: OfferCandidate,
  positioning: OfferPositioningInput,
): { aligned: boolean; failures: string[]; hookAxis: string | null; mechanismAxis: string | null } {
  const failures: string[] = [];

  const hookText = (offer.offerName || "").toLowerCase();
  const outcomeText = (offer.coreOutcome || "").toLowerCase();
  const mechText = (offer.mechanismDescription || "").toLowerCase();

  const contrastAxis = (positioning.contrastAxis || "").toLowerCase().trim();
  const enemyDef = (positioning.enemyDefinition || "").toLowerCase().trim();

  if (!contrastAxis && !enemyDef) {
    return { aligned: true, failures: [], hookAxis: null, mechanismAxis: null };
  }

  const extractAxisTokens = (axis: string): string[] =>
    axis.split(/[\s,.\-/]+/).filter(t => t.length > 2);

  const contrastTokens = extractAxisTokens(contrastAxis);
  const enemyTokens = extractAxisTokens(enemyDef);
  const axisTokens = [...new Set([...contrastTokens, ...enemyTokens])];

  if (axisTokens.length === 0) {
    return { aligned: true, failures: [], hookAxis: null, mechanismAxis: null };
  }

  const hookAxisTokensFound = axisTokens.filter(t => hookText.includes(t) || outcomeText.includes(t));
  const mechAxisTokensFound = axisTokens.filter(t => mechText.includes(t));

  const hookHasAxis = hookAxisTokensFound.length > 0;
  const mechHasAxis = mechAxisTokensFound.length > 0;

  let hookAxis: string | null = null;
  let mechanismAxis: string | null = null;

  if (hookHasAxis) {
    hookAxis = hookAxisTokensFound.join(", ");
  }
  if (mechHasAxis) {
    mechanismAxis = mechAxisTokensFound.join(", ");
  }

  const PROBLEM_KEYWORDS = [
    /wast(e|ing)\s+(money|time|budget)/i,
    /stop\s+(paying|spending|throwing)/i,
    /tired\s+of/i,
    /struggling\s+with/i,
    /\b(inefficient|ineffective|broken|failing)\b/i,
    /\b(overpriced|expensive|costly)\b/i,
    /\bno\s+(results|roi|return)\b/i,
  ];

  const SOLUTION_KEYWORDS = [
    /\b(community|belonging|connection|network)\b/i,
    /\b(framework|system|architecture|engine|protocol|method)\b/i,
    /\b(automation|automated|ai.driven|data.driven)\b/i,
    /\b(coaching|mentorship|advisory|consulting)\b/i,
    /\b(platform|tool|software|dashboard)\b/i,
  ];

  const hookProblems = PROBLEM_KEYWORDS.filter(p => p.test(hookText) || p.test(outcomeText));
  const mechSolutions = SOLUTION_KEYWORDS.filter(p => p.test(mechText));

  if (hookProblems.length > 0 && mechSolutions.length > 0) {
    const hookProblemText = hookText + " " + outcomeText;
    const mechSolutionText = mechText;

    const hookContentTokens = hookProblemText.split(/[\s,.\-/]+/).filter(t => t.length > 4);
    const mechContentTokens = mechSolutionText.split(/[\s,.\-/]+/).filter(t => t.length > 4);
    const sharedTokens = hookContentTokens.filter(t => mechContentTokens.includes(t));

    if (sharedTokens.length < 2) {
      const hookProblemSummary = hookProblems.map(p => {
        const match = (hookText + " " + outcomeText).match(p);
        return match ? match[0] : "";
      }).filter(Boolean).join(", ");

      const mechSolutionSummary = mechSolutions.map(p => {
        const match = mechText.match(p);
        return match ? match[0] : "";
      }).filter(Boolean).join(", ");

      failures.push(
        `Hook-mechanism axis mismatch: hook frames problem as "${hookProblemSummary}" but mechanism solves via "${mechSolutionSummary}". The mechanism must directly address the hook's stated problem.`
      );
    }
  }

  if (hookHasAxis && !mechHasAxis && contrastTokens.length > 0) {
    failures.push(
      `Mechanism does not reflect the positioning contrast axis. Hook references the contrast axis (${hookAxis}) but mechanism does not address it.`
    );
  }

  if (!hookHasAxis && contrastTokens.length > 0) {
    failures.push(
      `Hook/outcome does not reference the positioning contrast axis "${contrastAxis}". The offer hook must derive from the same axis.`
    );
  }

  return {
    aligned: failures.length === 0,
    failures,
    hookAxis,
    mechanismAxis,
  };
}

export function checkDifferentiationStrength(
  offer: { offerName: string; coreOutcome: string; mechanismDescription: string; deliverables: string[] },
  differentiation: OfferDifferentiationInput,
  positioning: OfferPositioningInput,
): { sufficient: boolean; score: number; signals: string[]; gaps: string[] } {
  const signals: string[] = [];
  const gaps: string[] = [];
  const offerText = `${offer.offerName} ${offer.coreOutcome} ${offer.mechanismDescription} ${(offer.deliverables || []).join(" ")}`.toLowerCase();

  const hasContrast = !!(positioning.contrastAxis || positioning.enemyDefinition);
  if (hasContrast) {
    const contrastTokens = (positioning.contrastAxis || "").toLowerCase().split(/\s+/).filter(t => t.length > 4);
    const enemyTokens = (positioning.enemyDefinition || "").toLowerCase().split(/\s+/).filter(t => t.length > 4);
    const contrastInOffer = contrastTokens.some(t => offerText.includes(t)) || enemyTokens.some(t => offerText.includes(t));
    if (contrastInOffer) {
      signals.push("Contrast against common approaches present in offer language");
    } else if (hasContrast) {
      gaps.push("Positioning defines a contrast axis but offer language does not reflect it");
    }
  } else {
    gaps.push("No contrast axis or enemy definition — cannot differentiate against common approaches");
  }

  const core = differentiation.mechanismCore;
  const hasMechanism = !!(core && core.mechanismType !== "none" && core.mechanismName);
  if (hasMechanism) {
    const mechNameLower = core!.mechanismName.toLowerCase();
    if (offerText.includes(mechNameLower) || offerText.includes(core!.mechanismType.toLowerCase())) {
      signals.push(`Unique mechanism "${core!.mechanismName}" referenced in offer`);
    } else {
      gaps.push(`Mechanism "${core!.mechanismName}" defined but not referenced in offer text`);
    }
  } else {
    const mechFraming = differentiation.mechanismFraming || {};
    if (mechFraming.supported) {
      signals.push("Mechanism framing supported by differentiation data");
    } else {
      gaps.push("No unique method, framework, or mechanism defined");
    }
  }

  const pillars = differentiation.pillars || [];
  const strongPillars = pillars.filter((p: any) => (p.overallScore || 0) >= 0.5);
  if (strongPillars.length > 0) {
    signals.push(`${strongPillars.length} strong differentiation pillar(s) above 0.5 threshold`);
  } else if (pillars.length > 0) {
    gaps.push("Differentiation pillars exist but all score below 0.5 — weak structural advantage");
  } else {
    gaps.push("No differentiation pillars defined");
  }

  const score = clamp(signals.length / 3);
  const sufficient = score >= MIN_DIFFERENTIATION_SCORE;

  return { sufficient, score, signals, gaps };
}

const MECHANISM_CATEGORY_MAP: Record<string, string[]> = {
  framework: ["framework", "system", "model", "methodology", "architecture", "structure", "blueprint", "process"],
  program: ["program", "bootcamp", "course", "workshop", "cohort", "training", "masterclass", "intensive"],
  tool: ["tool", "platform", "software", "calculator", "dashboard", "app", "template", "toolkit"],
  service: ["service", "agency", "consulting", "coaching", "advisory", "done-for-you", "managed"],
};

function resolveMechanismCategory(mechanismType: string, mechanismDescription: string): string {
  const text = `${mechanismType} ${mechanismDescription}`.toLowerCase();
  for (const [category, keywords] of Object.entries(MECHANISM_CATEGORY_MAP)) {
    if (keywords.some(k => text.includes(k))) return category;
  }
  return "generic";
}

export function checkMechanismLock(
  offerMechanismDescription: string,
  differentiation: OfferDifferentiationInput,
): { locked: boolean; diffCategory: string; offerCategory: string; reason: string | null } {
  const mechanism = differentiation.mechanismFraming || {};
  if (!mechanism.supported || mechanism.type === "none") {
    return { locked: true, diffCategory: "generic", offerCategory: "generic", reason: null };
  }

  const diffCategory = resolveMechanismCategory(mechanism.type || "", mechanism.description || "");
  const offerCategory = resolveMechanismCategory("", offerMechanismDescription);

  if (diffCategory === "generic") {
    return { locked: true, diffCategory, offerCategory, reason: null };
  }

  if (offerCategory === "generic") {
    return {
      locked: false,
      diffCategory,
      offerCategory,
      reason: `Mechanism category mismatch: Differentiation defines "${diffCategory}" but Offer mechanism is uncategorized. Offer mechanism must stay within the "${diffCategory}" framing.`,
    };
  }

  if (diffCategory === offerCategory) {
    return { locked: true, diffCategory, offerCategory, reason: null };
  }

  return {
    locked: false,
    diffCategory,
    offerCategory,
    reason: `Mechanism category mismatch: Differentiation defines "${diffCategory}" but Offer generated "${offerCategory}". Offer mechanism must stay within the "${diffCategory}" framing.`,
  };
}

export function validateOfferAlignment(
  offer: OfferCandidate,
  differentiation: OfferDifferentiationInput,
  audience: OfferAudienceInput,
  marketLanguage?: MarketLanguageMap,
): { aligned: boolean; failures: string[] } {
  const failures: string[] = [];

  const mechLock = checkMechanismLock(offer.mechanismDescription, differentiation);
  if (!mechLock.locked) {
    failures.push(mechLock.reason!);
  }

  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  if (pains.length > 0 || desires.length > 0) {
    const nameText = (offer.offerName || "").toLowerCase();
    const outcomeText = (offer.coreOutcome || "").toLowerCase();
    const mechText = (offer.mechanismDescription || "").toLowerCase();
    const delivText = (offer.deliverables || []).join(" ").toLowerCase();
    const combinedText = `${nameText} ${outcomeText} ${mechText} ${delivText}`;

    const extractTokens = (text: string): string[] =>
      text.toLowerCase().split(/[\s,.\-/]+/).filter(t => t.length > 4);

    const hasPainRef = pains.some((p: any) => {
      const painText = (typeof p === "string" ? p : p?.pain || p?.name || p?.canonical || "").toLowerCase();
      const tokens = extractTokens(painText);
      return tokens.length > 0 && tokens.some(t => combinedText.includes(t));
    });
    const hasDesireRef = desires.some(([k]) => {
      const tokens = extractTokens(k);
      return tokens.length > 0 && tokens.some(t => combinedText.includes(t));
    });

    if (!hasPainRef && !hasDesireRef) {
      failures.push("Outcome statement does not reflect any identified audience pain signals or desires");
    }
  }

  if (marketLanguage) {
    const combinedOfferText = `${(offer.offerName || "").toLowerCase()} ${(offer.coreOutcome || "").toLowerCase()} ${(offer.mechanismDescription || "").toLowerCase()} ${(offer.deliverables || []).join(" ").toLowerCase()}`;
    const extractMarketTokens = (phrases: string[]): string[] => {
      const tokens: string[] = [];
      for (const phrase of phrases) {
        const words = phrase.toLowerCase().split(/[\s,.\-/]+/).filter(w => w.length > 4);
        tokens.push(...words);
      }
      return [...new Set(tokens)];
    };

    const painTokens = extractMarketTokens(marketLanguage.rawPainPhrases.slice(0, 5));
    const desireTokens = extractMarketTokens(marketLanguage.rawDesirePhrases.slice(0, 5));
    const objectionTokens = extractMarketTokens(marketLanguage.objectionLanguage.slice(0, 5));
    const emotionalTokens = extractMarketTokens(marketLanguage.emotionalLanguage.slice(0, 3));
    const allMarketTokens = [...painTokens, ...desireTokens, ...objectionTokens, ...emotionalTokens];

    if (allMarketTokens.length > 0) {
      const matchedTokens = allMarketTokens.filter(t => combinedOfferText.includes(t));
      const marketLanguageRatio = matchedTokens.length / allMarketTokens.length;

      if (matchedTokens.length === 0 && allMarketTokens.length >= 5) {
        failures.push(`Market language preservation failed — zero audience tokens found in offer text (completely disconnected from market language)`);
      } else if (marketLanguageRatio < 0.1 && allMarketTokens.length >= 3) {
        console.log(`[OfferEngine-V4] MARKET_LANGUAGE_SOFT_WARNING | ${matchedTokens.length}/${allMarketTokens.length} tokens matched (${(marketLanguageRatio * 100).toFixed(1)}%) — below 10% ideal but offer accepted`);
      }
    }
  }

  const deliverables = offer.deliverables || [];
  const mechanism = differentiation.mechanismFraming || {};
  if (mechanism.supported && deliverables.length > 0 && mechanism.description) {
    const mechTokens = (mechanism.description || "").toLowerCase().split(/[\s,.\-/]+/).filter((t: string) => t.length > 4).slice(0, 8);
    const delivText = deliverables.join(" ").toLowerCase();
    const outcomeText = (offer.coreOutcome || "").toLowerCase();
    const combinedOfferText = `${delivText} ${outcomeText} ${(offer.mechanismDescription || "").toLowerCase()}`;
    const hasDeliverableSupport = mechTokens.some((t: string) => combinedOfferText.includes(t));
    if (!hasDeliverableSupport && mechTokens.length > 2) {
      failures.push("Deliverables do not logically support the defined differentiation mechanism");
    }
  }

  return { aligned: failures.length === 0, failures };
}

export function calculateDepthScores(
  outcome: OutcomeLayer,
  mechanism: MechanismLayer,
  delivery: DeliveryLayer,
  proof: ProofLayer,
  riskReduction: RiskReductionLayer,
  differentiation: OfferDifferentiationInput,
  audience: OfferAudienceInput,
  mi: OfferMIInput,
): OfferDepthScores {
  const outcomeClarity = clamp(outcome.specificityScore);
  const mechanismCredibility = clamp(mechanism.credibilityScore);
  const proofStrength = clamp(proof.proofStrength);

  const pillars = differentiation.pillars || [];
  const avgPillarScore = pillars.length > 0
    ? pillars.reduce((s: number, p: any) => s + (p.overallScore || 0), 0) / pillars.length : 0.3;
  const differentiationSupport = clamp(avgPillarScore);

  const opportunities = mi.opportunitySignals || [];
  const marketDemandAlignment = clamp(opportunities.length > 0 ? 0.4 + (Math.min(opportunities.length, 5) * 0.1) : 0.3);

  const objections = Object.keys(audience.objectionMap || {});
  const emotionalDrivers = audience.emotionalDrivers || [];
  const audienceTrustCompatibility = clamp(
    (riskReduction.buyerConfidenceScore * 0.5) +
    (objections.length > 0 ? 0.2 : 0) +
    (emotionalDrivers.length > 0 ? 0.15 : 0) +
    0.15
  );

  const executionFeasibility = clamp(1 - delivery.complexityLevel * 0.7);

  const buyerFrictionLevel = clamp(
    (delivery.complexityLevel * 0.3) +
    ((1 - outcomeClarity) * 0.3) +
    (proof.proofGaps.length * 0.1) +
    ((1 - riskReduction.buyerConfidenceScore) * 0.2)
  );

  return {
    outcomeClarity,
    mechanismCredibility,
    proofStrength,
    differentiationSupport,
    marketDemandAlignment,
    audienceTrustCompatibility,
    executionFeasibility,
    buyerFrictionLevel,
  };
}

export function calculateOfferStrengthScore(depth: OfferDepthScores): number {
  const invertedFriction = clamp(1 - depth.buyerFrictionLevel);
  return clamp(
    depth.outcomeClarity * OFFER_DEPTH_WEIGHTS.outcomeClarity +
    depth.mechanismCredibility * OFFER_DEPTH_WEIGHTS.mechanismCredibility +
    depth.proofStrength * OFFER_DEPTH_WEIGHTS.proofStrength +
    depth.differentiationSupport * OFFER_DEPTH_WEIGHTS.differentiationSupport +
    depth.marketDemandAlignment * OFFER_DEPTH_WEIGHTS.marketDemandAlignment +
    depth.audienceTrustCompatibility * OFFER_DEPTH_WEIGHTS.audienceTrustCompatibility +
    depth.executionFeasibility * OFFER_DEPTH_WEIGHTS.executionFeasibility +
    invertedFriction * OFFER_DEPTH_WEIGHTS.buyerFrictionLevel
  );
}

export function compressFeasibility(delivery: DeliveryLayer): DeliveryLayer {
  if (delivery.deliverables.length > MAX_DELIVERABLES) {
    return {
      ...delivery,
      deliverables: delivery.deliverables.slice(0, MAX_DELIVERABLES),
      complexityLevel: clamp(MAX_DELIVERABLES / MAX_DELIVERABLES),
    };
  }
  return delivery;
}

function buildOfferCandidate(
  name: string,
  outcome: OutcomeLayer,
  mechanism: MechanismLayer,
  delivery: DeliveryLayer,
  proof: ProofLayer,
  riskReduction: RiskReductionLayer,
  audience: OfferAudienceInput,
  differentiation: OfferDifferentiationInput,
  mi: OfferMIInput,
  positioning: OfferPositioningInput,
): OfferCandidate {
  const completeness = checkOfferCompleteness(outcome, mechanism, delivery, proof, riskReduction);
  const integrity = integrityCheck({ outcome, mechanism, proof }, positioning, differentiation, audience);
  const depthScores = calculateDepthScores(outcome, mechanism, delivery, proof, riskReduction, differentiation, audience, mi);

  let offerStrengthScore = calculateOfferStrengthScore(depthScores);

  const isGeneric = detectGenericOffer(name) || detectGenericOffer(outcome.primaryOutcome);
  if (isGeneric) {
    offerStrengthScore = clamp(offerStrengthScore - GENERIC_PENALTY);
  }

  if (!integrity.passed) {
    offerStrengthScore = clamp(offerStrengthScore * 0.75);
  }

  if (depthScores.buyerFrictionLevel > FRICTION_THRESHOLD) {
    offerStrengthScore = clamp(offerStrengthScore * 0.85);
  }

  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const topPain = pains.length > 0 ? (typeof pains[0] === "string" ? pains[0] : pains[0]?.pain || pains[0]?.name || "core challenge") : "core challenge";
  const topDesire = desires.length > 0 ? desires[0][0] : "primary goal";

  return {
    offerName: name,
    coreOutcome: outcome.primaryOutcome,
    mechanismDescription: mechanism.mechanismDescription,
    deliverables: delivery.deliverables,
    proofAlignment: proof.alignedProofTypes,
    audienceFitExplanation: `Addresses ${topPain} and targets ${topDesire} with ${proof.alignedProofTypes.length} proof types`,
    offerStrengthScore,
    riskNotes: [
      ...proof.proofGaps.map(g => `Missing proof: ${g}`),
      ...(isGeneric ? ["Generic offer flag triggered — language lacks specificity"] : []),
      ...integrity.failures,
    ],
    outcomeLayer: outcome,
    mechanismLayer: mechanism,
    deliveryLayer: delivery,
    proofLayer: proof,
    riskReductionLayer: riskReduction,
    completeness,
    genericFlag: isGeneric,
    integrityResult: integrity,
    frictionLevel: depthScores.buyerFrictionLevel,
    depthScores,
  };
}

export async function aiOfferGeneration(
  audience: OfferAudienceInput,
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
  accountId: string,
  marketLanguage?: MarketLanguageMap,
  qualifyingSignals?: QualifyingSignal[],
  positioningLock?: PositioningLock,
  axisCorrection?: { previousFailures: string[]; attempt: number },
): Promise<{ primary: { name: string; outcome: string; mechanism: string; deliverables: string[] }; alternative: { name: string; outcome: string; mechanism: string; deliverables: string[] }; rejected: { name: string; outcome: string; mechanism: string; deliverables: string[]; rejectionReason: string } }> {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const territories = positioning.territories || [];
  const pillars = differentiation.pillars || [];
  const mechanism = differentiation.mechanismFraming || {};
  const core = differentiation.mechanismCore;

  const mechCategory = mechanism.supported ? resolveMechanismCategory(mechanism.type || "", mechanism.description || "") : "generic";
  const mechLockInstruction = mechCategory !== "generic"
    ? `\n- MECHANISM LOCK: The Differentiation Engine defines a "${mechCategory}" mechanism. All offer mechanisms MUST stay within this "${mechCategory}" framing category. Do NOT propose a bootcamp if the mechanism is a framework, or a course if the mechanism is a tool.`
    : "";

  const hasMechanismCore = !!(core && core.mechanismType !== "none" && core.mechanismName);

  const painPhrases = marketLanguage?.rawPainPhrases?.slice(0, 8) || [];
  const desirePhrases = marketLanguage?.rawDesirePhrases?.slice(0, 8) || [];
  const emotionalPhrases = marketLanguage?.emotionalLanguage?.slice(0, 5) || [];
  const objectionPhrases = marketLanguage?.objectionLanguage?.slice(0, 5) || [];
  const hasMarketLanguage = painPhrases.length > 0 || desirePhrases.length > 0;

  const deliverableSteps = hasMechanismCore
    ? core!.mechanismSteps.map((step, i) => `  Step ${i + 1}: "${step}"`).join("\n")
    : pillars.slice(0, 4).map((p: any, i: number) => `  Step ${i + 1}: "${p.name || p.territory || "component"}"`).join("\n");

  const lockSection = positioningLock?.locked ? `
═══ POSITIONING AXIS LOCK (IMMUTABLE — ALL OFFERS MUST COMPLY) ═══
The following positioning axis is LOCKED. Every element you generate MUST operate within this axis.
${positioningLock.contrastAxis ? `LOCKED CONTRAST AXIS: "${positioningLock.contrastAxis}"` : ""}
${positioningLock.enemyDefinition ? `LOCKED ENEMY: "${positioningLock.enemyDefinition}"` : ""}
${positioningLock.problemDomain ? `LOCKED PROBLEM DOMAIN: "${positioningLock.problemDomain}"` : ""}
${positioningLock.solutionDomain ? `LOCKED SOLUTION DOMAIN: "${positioningLock.solutionDomain}"` : ""}
${positioningLock.mechanismName ? `LOCKED MECHANISM: "${positioningLock.mechanismName}"` : ""}
${positioningLock.mechanismFamily ? `LOCKED MECHANISM FAMILY: "${positioningLock.mechanismFamily}"` : ""}

AXIS LOCK RULES (VIOLATION = AUTOMATIC REJECTION):
1. The offer hook/name MUST frame the problem using the LOCKED PROBLEM DOMAIN above.
2. The mechanism MUST solve the EXACT problem stated in the hook using the LOCKED MECHANISM.
3. The outcome MUST describe results that directly follow from solving the LOCKED PROBLEM DOMAIN.
4. ALL THREE (hook, mechanism, outcome) must exist on the SAME strategic axis.
5. DO NOT introduce any problem framing, mechanism, or solution that falls outside the locked axis.
6. EXAMPLE OF VIOLATION: Hook about "wasting money on ads" + Mechanism about "community building" = REJECTED (different axes).
7. EXAMPLE OF COMPLIANCE: Hook about "wasting money on ads" + Mechanism that "eliminates ad waste via [locked mechanism name]" = ACCEPTED (same axis).
` : "";

  const correctionSection = axisCorrection ? `
═══ AXIS CORRECTION (PREVIOUS ATTEMPT FAILED — READ CAREFULLY) ═══
This is attempt ${axisCorrection.attempt}. The previous generation was REJECTED because:
${axisCorrection.previousFailures.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}

You MUST fix these specific issues. Generate offers that directly address these failures.
Do NOT repeat the same mistake. The hook, mechanism, and outcome MUST all reference the same problem domain.
` : "";

  const prompt = `You are an Offer Architect. Generate three offer concepts.

ABSOLUTE RULES:
- Do NOT generate funnel architecture, advertising strategy, channel selection, media planning, budget recommendations, campaign execution, sales scripts, or strategic master plan decisions
- Do NOT include financial advisory claims (eliminating debt, increasing savings, building net worth, financial freedom). Use outcome-oriented language instead.
- Respond with ONLY valid JSON, no markdown${mechLockInstruction}
${lockSection}${correctionSection}

═══ SECTION 1: AUDIENCE PAIN LANGUAGE (use these exact words) ═══
${painPhrases.length > 0 ? `Raw Pain Phrases: ${JSON.stringify(painPhrases)}` : "No raw pain phrases available"}
${desirePhrases.length > 0 ? `Raw Desire Phrases: ${JSON.stringify(desirePhrases)}` : "No raw desire phrases available"}
${emotionalPhrases.length > 0 ? `Emotional Language: ${JSON.stringify(emotionalPhrases)}` : ""}
${objectionPhrases.length > 0 ? `Objection Language to address: ${JSON.stringify(objectionPhrases)}` : ""}
${hasMarketLanguage ? `
MANDATORY LANGUAGE RULES:
- You MUST use the audience's own words above directly in the offer name, outcome, mechanism, and deliverables.
- Copy exact phrases from the pain/desire lists into your output.
- At least 20% of your output words must come directly from the phrases above.
- Use how BUYERS describe results, not how strategists do. Write as a market participant, not a consultant.
- BANNED WORDS: "optimize", "leverage", "scale", "transform", "empower", "unlock", "synergy", "holistic", "comprehensive", "innovative", "cutting-edge", "next-level", "game-changing", "paradigm"
- If audience says "struggle with debt" → use "struggle with debt", NOT "financial optimization"
- If audience says "want more clients" → use "get more clients", NOT "scale revenue"
- If audience says "wasting money on ads" → use "stop wasting money on ads", NOT "optimize ad spend allocation"` : ""}

═══ SECTION 2: OUTCOME PRECISION (MANDATORY) ═══
Outcomes MUST be specific, measurable, and market-relevant. Use concrete business impacts:
- Pipeline growth (e.g., "fill your pipeline with 20+ qualified leads per month")
- Revenue predictability (e.g., "build a predictable $50K/month revenue engine")
- CAC improvement (e.g., "cut customer acquisition cost by 40%")
- Conversion performance (e.g., "double your close rate from demo to deal")
NEVER use vague outcomes like "financial improvement", "measurable improvement", "better results", "business growth", "enhanced outcomes", or "positive change".

═══ SECTION 3: MECHANISM (single source of truth) ═══
${hasMechanismCore ? `Mechanism Name: "${core!.mechanismName}"
Mechanism Type: ${core!.mechanismType}
Mechanism Steps:
${deliverableSteps}
Mechanism Promise: ${core!.mechanismPromise}
Problem it solves: ${core!.mechanismProblem}
Logic: ${core!.mechanismLogic}

MANDATORY: All offer mechanism descriptions MUST reference "${core!.mechanismName}" by name.
Mechanisms MUST be expressed as clear strategic systems (e.g., "The [Name] Framework", "[Name] System", "[Name] Architecture").
Do NOT use abstract mechanism descriptions like "community and belonging method", "holistic approach", or "innovative process".
Describe delivery using ONLY the steps above. Do NOT invent new steps or mechanisms.` : `Mechanism: ${mechanism.description || "No validated mechanism"}
Differentiation Pillars:
${deliverableSteps}
Mechanisms MUST be expressed as clear strategic systems (e.g., "The [Name] Framework", "[Name] System") that a buyer immediately understands.`}

═══ SECTION 4: DELIVERABLES (must map to mechanism steps) ═══
Each deliverable MUST correspond to one mechanism step above.
${hasMechanismCore ? `Required deliverables (one per step):
${core!.mechanismSteps.map((step, i) => `  Deliverable ${i + 1}: Map to "${step}"`).join("\n")}
Do NOT add generic deliverables like "community", "coaching", "support" unless they correspond to a mechanism step.` : `Derive deliverables from the differentiation pillars listed above.`}

═══ SECTION 5: SIGNAL ANCHORS (MANDATORY) ═══
${qualifyingSignals && qualifyingSignals.length > 0 ? `Every claim you generate MUST be derived from one of these upstream signals. Do NOT invent claims that cannot be traced to a signal below.
${qualifyingSignals.slice(0, 15).map((s, i) => `  [${s.signalId}] (${s.originEngine}/${s.category}): "${s.text}"`).join("\n")}
RULE: Each outcome, mechanism justification, and deliverable must address or build upon at least one signal above.` : "No qualifying signals provided — generate conservatively with maximum specificity."}

═══ SECTION 6: CONTEXT ═══
- Top Pains: ${JSON.stringify(pains.slice(0, 5).map((p: any) => typeof p === "string" ? p : p?.pain || p?.name))}
- Top Desires: ${JSON.stringify(desires.slice(0, 5).map(([k]) => k))}
- Territories: ${JSON.stringify(territories.slice(0, 3).map((t: any) => t.name))}
- Enemy: ${positioning.enemyDefinition || "Not defined"}
- Narrative: ${positioning.narrativeDirection || "Not defined"}
${positioning.contrastAxis ? `- Contrast Axis: ${positioning.contrastAxis}
MANDATORY POSITIONING ALIGNMENT RULES:
1. The offer hook/name, outcome, AND mechanism MUST all derive from the SAME positioning contrast axis above.
2. If the hook references a problem (e.g., "wasting money on ads"), the mechanism MUST solve THAT EXACT problem — not a different one.
3. DO NOT create a hook about one problem (ad waste) and a mechanism about an unrelated solution (community building). Every element must be on the same strategic axis.
4. The mechanism must DIRECTLY address whatever problem the hook identifies.
5. Show how your offer is structurally different from the common approach.` : ""}

═══ SECTION 7: PROOF ALIGNMENT (objection-specific) ═══
Each proof type MUST be tied to a specific audience objection or credibility gap. Do NOT use generic proof placeholders.
${objectionPhrases.length > 0 ? `Audience objections to address with proof:
${objectionPhrases.map((o, i) => `  Objection ${i + 1}: "${o}" → What proof directly counters this?`).join("\n")}
For each proof you include, state WHICH objection it addresses.` : "No specific objections identified — use case_proof only."}

Return JSON:
{
  "primary": { "name": "Offer name using audience's exact words", "outcome": "Specific measurable business impact (pipeline, revenue, CAC, conversion)", "mechanism": "How ${hasMechanismCore ? `the ${core!.mechanismName} ${core!.mechanismType}` : "the mechanism"} delivers it using the exact steps", "deliverables": ["Step-mapped deliverable 1", "Step-mapped deliverable 2"] },
  "alternative": { "name": "Alternative offer using audience language", "outcome": "Different specific measurable impact angle", "mechanism": "Alternative delivery using structured system language", "deliverables": ["Alt deliverable 1", "Alt deliverable 2"] },
  "rejected": { "name": "Rejected offer", "outcome": "Why this seems appealing", "mechanism": "What it promises", "deliverables": [], "rejectionReason": "Why this fails (generic, weak proof, contradicts positioning, vague outcomes)" }
}`;

  try {
    const completion = await aiChat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
      accountId,
      endpoint: "offer-engine",
    });
    const response = completion.choices?.[0]?.message?.content || "{}";
    const cleanedResponse = response.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleanedResponse);

    return {
      primary: {
        name: parsed.primary?.name || "Primary Offer",
        outcome: parsed.primary?.outcome || "Core transformation",
        mechanism: parsed.primary?.mechanism || "Standard delivery",
        deliverables: Array.isArray(parsed.primary?.deliverables) ? parsed.primary.deliverables : [],
      },
      alternative: {
        name: parsed.alternative?.name || "Alternative Offer",
        outcome: parsed.alternative?.outcome || "Alternative transformation",
        mechanism: parsed.alternative?.mechanism || "Standard delivery",
        deliverables: Array.isArray(parsed.alternative?.deliverables) ? parsed.alternative.deliverables : [],
      },
      rejected: {
        name: parsed.rejected?.name || "Rejected Offer",
        outcome: parsed.rejected?.outcome || "Rejected transformation",
        mechanism: parsed.rejected?.mechanism || "Standard delivery",
        deliverables: [],
        rejectionReason: parsed.rejected?.rejectionReason || "Did not meet specificity requirements",
      },
    };
  } catch (err: any) {
    console.error(`[OfferEngine] AI generation failed: ${err.message}`);
    return {
      primary: { name: "Core Transformation System", outcome: "Primary market transformation based on differentiation pillars", mechanism: "Structured implementation methodology", deliverables: [] },
      alternative: { name: "Accelerated Implementation Program", outcome: "Rapid deployment of core transformation", mechanism: "Compressed delivery framework", deliverables: [] },
      rejected: { name: "Generic Growth Package", outcome: "General business improvement", mechanism: "Standard approach", deliverables: [], rejectionReason: "Generic offer — lacks specificity and market differentiation" },
    };
  }
}

export async function runOfferEngine(
  mi: OfferMIInput,
  audience: OfferAudienceInput,
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
  accountId: string,
  upstreamLineage: SignalLineageEntry[] = [],
): Promise<OfferResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  console.log(`[OfferEngine-V4] Starting 5-layer pipeline`);

  const qualifyingSignals = extractQualifyingSignals(upstreamLineage);
  diagnostics.signalAnchoring = {
    upstreamLineageCount: upstreamLineage.length,
    qualifyingSignals: qualifyingSignals.length,
    minRequired: MIN_QUALIFYING_SIGNALS,
  };
  console.log(`[OfferEngine-V4] SIGNAL_CHECK | upstream=${upstreamLineage.length} | qualifying=${qualifyingSignals.length} | min=${MIN_QUALIFYING_SIGNALS}`);

  if (qualifyingSignals.length < MIN_QUALIFYING_SIGNALS) {
    console.log(`[OfferEngine-V4] SIGNAL_INSUFFICIENT | qualifying=${qualifyingSignals.length} < min=${MIN_QUALIFYING_SIGNALS} — cannot generate grounded claims`);
    const emptyOffer = buildEmptyOffer();
    const acceptability = assessStrategyAcceptability(0, 0, 5, false, ["Insufficient upstream signals for grounded claim generation"]);
    return {
      status: STATUS.INSUFFICIENT_SIGNALS,
      statusMessage: `Signal-insufficient: only ${qualifyingSignals.length} qualifying upstream signals found (minimum ${MIN_QUALIFYING_SIGNALS} required). Run MI and Audience engines first to generate source signals.`,
      primaryOffer: emptyOffer,
      alternativeOffer: emptyOffer,
      rejectedOffer: { offer: emptyOffer, rejectionReason: "No upstream signals to anchor claims" },
      offerStrengthScore: 0,
      positioningConsistency: { consistent: false, contradictions: ["Signal-insufficient state"] },
      hookMechanismAlignment: { aligned: false, failures: ["Signal-insufficient state"], hookAxis: null, mechanismAxis: null },
      boundaryCheck: { passed: true, violations: [] },
      structuralWarnings: ["SIGNAL_INSUFFICIENT: No grounded claims can be generated without upstream signals"],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: diagnostics,
      strategyAcceptability: acceptability,
    };
  }

  const pillars = differentiation.pillars || [];
  const proofArch = differentiation.proofArchitecture || [];
  const claims = differentiation.claimStructures || [];

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
    console.log(`[OfferEngine-V4] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  if (pillars.length === 0 && claims.length === 0) {
    console.log(`[OfferEngine-V4] Insufficient differentiation data — returning red-grade adaptive fallback`);
    const emptyOffer = buildEmptyOffer();
    const acceptability = assessStrategyAcceptability(0, 0, 5, false, ["Differentiation data insufficient"]);
    return {
      status: STATUS.INSUFFICIENT_SIGNALS,
      statusMessage: "Differentiation data insufficient to construct meaningful offer",
      primaryOffer: emptyOffer,
      alternativeOffer: emptyOffer,
      rejectedOffer: { offer: emptyOffer, rejectionReason: "No data to construct offer" },
      offerStrengthScore: 0,
      positioningConsistency: { consistent: false, contradictions: ["No offer data available"] },
      hookMechanismAlignment: { aligned: false, failures: ["No offer data available"], hookAxis: null, mechanismAxis: null },
      boundaryCheck: { passed: true, violations: [] },
      structuralWarnings: [],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: diagnostics,
      strategyAcceptability: acceptability,
    };
  }

  const marketLanguage = buildMarketLanguageMap(audience);
  diagnostics.marketLanguage = {
    painPhraseCount: marketLanguage.rawPainPhrases.length,
    desirePhraseCount: marketLanguage.rawDesirePhrases.length,
    emotionalCount: marketLanguage.emotionalLanguage.length,
    objectionCount: marketLanguage.objectionLanguage.length,
  };
  console.log(`[OfferEngine-V4] MarketLanguageMap | pains=${marketLanguage.rawPainPhrases.length} | desires=${marketLanguage.rawDesirePhrases.length} | emotional=${marketLanguage.emotionalLanguage.length} | objections=${marketLanguage.objectionLanguage.length}`);

  const l1Outcome = layer1_outcomeConstruction(audience, positioning, differentiation, marketLanguage);
  diagnostics.layer1 = { specificityScore: l1Outcome.specificityScore };

  const l2Mechanism = layer2_mechanismAlignment(differentiation);
  diagnostics.layer2 = { type: l2Mechanism.mechanismType, credibility: l2Mechanism.credibilityScore };

  const l3Delivery = compressFeasibility(layer3_deliveryStructure(audience, differentiation));
  diagnostics.layer3 = { deliverableCount: l3Delivery.deliverables.length, complexity: l3Delivery.complexityLevel };

  const objectionSignals = qualifyingSignals.filter(s =>
    s.category === "audience_objection" || s.category === "narrative_objection" ||
    s.category.includes("objection")
  );
  const hasObjectionSignals = objectionSignals.length > 0;
  const objectionContext = objectionSignals.map(s => ({ text: s.text, category: s.category }));
  console.log(`[OfferEngine-V4] PROOF_GATE | objectionSignals=${objectionSignals.length} | hasObjectionSignals=${hasObjectionSignals}`);

  const l4Proof = layer4_proofAlignment(differentiation, hasObjectionSignals, objectionContext);
  diagnostics.layer4 = { proofTypes: l4Proof.alignedProofTypes.length, strength: l4Proof.proofStrength, gaps: l4Proof.proofGaps, objectionGated: !hasObjectionSignals, objectionMapped: objectionContext.length };

  const l5Risk = layer5_riskReduction(audience, l4Proof);
  diagnostics.layer5 = { reducers: l5Risk.riskReducers.length, buyerConfidence: l5Risk.buyerConfidenceScore };

  const posLock = buildPositioningLock(positioning, differentiation);
  diagnostics.positioningLock = posLock;
  console.log(`[OfferEngine-V4] POSITIONING_LOCK | locked=${posLock.locked} | axis="${posLock.contrastAxis || "none"}" | mechanism="${posLock.mechanismName || "none"}" | problem="${posLock.problemDomain || "none"}" | solution="${posLock.solutionDomain || "none"}"`);

  const preGenCheck = validatePreGenerationConstraints(posLock, differentiation);
  diagnostics.preGenerationConstraints = preGenCheck;
  if (!preGenCheck.compatible) {
    console.log(`[OfferEngine-V4] PRE_GENERATION_WARNING | ${preGenCheck.issues.join("; ")}`);
  }

  let aiOffers;
  try {
    aiOffers = await aiOfferGeneration(audience, positioning, differentiation, accountId, marketLanguage, qualifyingSignals, posLock);
    diagnostics.aiGeneration = { success: true };
  } catch (err: any) {
    diagnostics.aiGeneration = { success: false, error: err.message };
    aiOffers = {
      primary: { name: "Core Transformation System", outcome: l1Outcome.primaryOutcome, mechanism: l2Mechanism.mechanismDescription, deliverables: [] },
      alternative: { name: "Alternative Implementation Program", outcome: l1Outcome.transformationStatement, mechanism: l2Mechanism.mechanismDescription, deliverables: [] },
      rejected: { name: "Generic Growth Package", outcome: "General improvement", mechanism: "Standard approach", deliverables: [], rejectionReason: "Generic and unspecific" },
    };
  }

  const primaryClaimsForGrounding = [
    aiOffers.primary.outcome,
    aiOffers.primary.mechanism,
    ...aiOffers.primary.deliverables,
  ].filter(Boolean);
  const primaryGrounding = validateClaimGrounding(primaryClaimsForGrounding, upstreamLineage, "offer_engine", "offer_claim");
  diagnostics.primaryGrounding = {
    total: primaryGrounding.totalClaims,
    grounded: primaryGrounding.groundedClaims,
    stripped: primaryGrounding.strippedClaims.length,
    ratio: primaryGrounding.groundingRatio.toFixed(2),
  };
  console.log(`[OfferEngine-V4] GROUNDING_CHECK | primary: grounded=${primaryGrounding.groundedClaims}/${primaryGrounding.totalClaims} | ratio=${primaryGrounding.groundingRatio.toFixed(2)} | stripped=${primaryGrounding.strippedClaims.join("; ").slice(0, 100)}`);

  const GROUNDING_RATIO_FLOOR = 0.3;
  if (primaryGrounding.groundingRatio < GROUNDING_RATIO_FLOOR && primaryGrounding.totalClaims > 0) {
    console.log(`[OfferEngine-V4] GROUNDING_FAILED | ratio=${primaryGrounding.groundingRatio.toFixed(2)} < floor=${GROUNDING_RATIO_FLOOR} — returning SIGNAL_INSUFFICIENT`);
    const emptyOffer = buildEmptyOffer();
    const acceptability = assessStrategyAcceptability(0, 0, 5, false, ["AI-generated claims failed signal grounding"]);
    return {
      status: STATUS.INSUFFICIENT_SIGNALS,
      statusMessage: `Signal grounding failed: only ${primaryGrounding.groundedClaims}/${primaryGrounding.totalClaims} claims are signal-anchored (${Math.round(primaryGrounding.groundingRatio * 100)}% < ${Math.round(GROUNDING_RATIO_FLOOR * 100)}% minimum). Claims cannot be generated without signal backing.`,
      primaryOffer: emptyOffer,
      alternativeOffer: emptyOffer,
      rejectedOffer: { offer: emptyOffer, rejectionReason: "Claims failed signal grounding" },
      offerStrengthScore: 0,
      positioningConsistency: { consistent: false, contradictions: ["Claims not signal-grounded"] },
      hookMechanismAlignment: { aligned: false, failures: ["Claims not signal-grounded"], hookAxis: null, mechanismAxis: null },
      boundaryCheck: { passed: true, violations: [] },
      structuralWarnings: [`GROUNDING_FAILED: ${primaryGrounding.strippedClaims.length} claims stripped for lack of signal backing`],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: diagnostics,
      strategyAcceptability: acceptability,
      signalGrounding: {
        groundedClaims: primaryGrounding.groundedClaims,
        totalClaims: primaryGrounding.totalClaims,
        groundingRatio: primaryGrounding.groundingRatio,
        strippedClaims: primaryGrounding.strippedClaims,
      },
    };
  }

  aiOffers.primary.deliverables = aiOffers.primary.deliverables.filter(d =>
    !primaryGrounding.strippedClaims.includes(d)
  );
  if (primaryGrounding.strippedClaims.includes(aiOffers.primary.outcome)) {
    aiOffers.primary.outcome = l1Outcome.primaryOutcome;
    console.log(`[OfferEngine-V4] GROUNDING_STRIP | primary outcome replaced with layer-1 fallback`);
  }
  if (primaryGrounding.strippedClaims.includes(aiOffers.primary.mechanism)) {
    aiOffers.primary.mechanism = l2Mechanism.mechanismDescription;
    console.log(`[OfferEngine-V4] GROUNDING_STRIP | primary mechanism replaced with layer-2 fallback`);
  }

  const core = differentiation.mechanismCore;
  const hasMechanismCore = !!(core && core.mechanismType !== "none" && core.mechanismName && core.mechanismSteps.length > 0);

  const mergeDeliverables = (aiDeliverables: string[], fallbackDeliverables: string[]): string[] => {
    if (aiDeliverables.length === 0) return fallbackDeliverables;
    if (!hasMechanismCore) return aiDeliverables.slice(0, MAX_DELIVERABLES);
    const stepWords = core!.mechanismSteps.map(s => s.toLowerCase().split(/\s+/).slice(0, 3).join(" "));
    const validAiDeliverables = aiDeliverables.filter(d => {
      const dLower = d.toLowerCase();
      return stepWords.some(sw => dLower.includes(sw) || sw.split(" ").some(w => w.length > 3 && dLower.includes(w)));
    });
    if (validAiDeliverables.length >= Math.min(core!.mechanismSteps.length, 2)) {
      return validAiDeliverables.slice(0, MAX_DELIVERABLES);
    }
    return fallbackDeliverables;
  };

  const primaryOutcome: OutcomeLayer = {
    ...l1Outcome,
    primaryOutcome: aiOffers.primary.outcome || l1Outcome.primaryOutcome,
  };

  const aiPrimaryMechDesc = aiOffers.primary.mechanism || l2Mechanism.mechanismDescription;
  const primaryMechLock = checkMechanismLock(aiPrimaryMechDesc, differentiation);
  diagnostics.primaryMechanismLock = primaryMechLock;
  const primaryMechanism: MechanismLayer = {
    ...l2Mechanism,
    mechanismDescription: primaryMechLock.locked
      ? aiPrimaryMechDesc
      : l2Mechanism.mechanismDescription,
  };
  if (!primaryMechLock.locked) {
    console.log(`[OfferEngine-V4] MECHANISM_LOCK | primary mechanism category mismatch: diff="${primaryMechLock.diffCategory}" offer="${primaryMechLock.offerCategory}" — forced back to differentiation framing`);
  }

  const primaryDelivery: DeliveryLayer = {
    ...l3Delivery,
    deliverables: mergeDeliverables(aiOffers.primary.deliverables, l3Delivery.deliverables),
  };

  const primaryOffer = buildOfferCandidate(
    aiOffers.primary.name, primaryOutcome, primaryMechanism, primaryDelivery, l4Proof, l5Risk,
    audience, differentiation, mi, positioning,
  );

  const altOutcome: OutcomeLayer = {
    ...l1Outcome,
    primaryOutcome: aiOffers.alternative.outcome || l1Outcome.transformationStatement,
    specificityScore: clamp(l1Outcome.specificityScore * 0.9),
  };

  const aiAltMechDesc = aiOffers.alternative.mechanism || l2Mechanism.mechanismDescription;
  const altMechLock = checkMechanismLock(aiAltMechDesc, differentiation);
  diagnostics.altMechanismLock = altMechLock;
  const altMechanism: MechanismLayer = {
    ...l2Mechanism,
    mechanismDescription: altMechLock.locked
      ? aiAltMechDesc
      : l2Mechanism.mechanismDescription,
  };
  if (!altMechLock.locked) {
    console.log(`[OfferEngine-V4] MECHANISM_LOCK | alternative mechanism category mismatch: diff="${altMechLock.diffCategory}" offer="${altMechLock.offerCategory}" — forced back to differentiation framing`);
  }

  const altDelivery: DeliveryLayer = {
    ...l3Delivery,
    deliverables: mergeDeliverables(aiOffers.alternative.deliverables, l3Delivery.deliverables),
  };

  const alternativeOffer = buildOfferCandidate(
    aiOffers.alternative.name, altOutcome, altMechanism, altDelivery, l4Proof, l5Risk,
    audience, differentiation, mi, positioning,
  );

  const rejOutcome: OutcomeLayer = {
    primaryOutcome: aiOffers.rejected.outcome || "Generic market improvement",
    transformationStatement: "Vague transformation promise",
    specificityScore: 0.2,
  };
  const rejMechanism: MechanismLayer = {
    mechanismType: "none",
    mechanismDescription: aiOffers.rejected.mechanism || "No validated mechanism",
    differentiationLink: "No differentiation link",
    credibilityScore: 0.1,
  };

  const rejectedOffer = buildOfferCandidate(
    aiOffers.rejected.name, rejOutcome, rejMechanism, l3Delivery,
    { alignedProofTypes: [], proofStrength: 0.1, proofGaps: ["process_proof", "outcome_proof", "case_proof", "transparency_proof"] },
    { riskReducers: [], frictionMitigations: [], buyerConfidenceScore: 0.1 },
    audience, differentiation, mi, positioning,
  );

  if (posLock.locked) {
    const primaryClamp = clampOfferToAxis(primaryOffer.offerName, primaryOffer.coreOutcome, primaryOffer.mechanismDescription, posLock);
    if (primaryClamp.clamped) {
      primaryOffer.offerName = primaryClamp.offerName;
      primaryOffer.coreOutcome = primaryClamp.coreOutcome;
      primaryOffer.mechanismDescription = primaryClamp.mechanismDescription;
      primaryOffer.mechanismLayer.mechanismDescription = primaryClamp.mechanismDescription;
      primaryOffer.outcomeLayer.primaryOutcome = primaryClamp.coreOutcome;
      console.log(`[OfferEngine-V4] AXIS_CLAMP_PRIMARY | ${primaryClamp.clampActions.join("; ")}`);
      diagnostics.primaryAxisClamp = primaryClamp.clampActions;
    }

    const altClamp = clampOfferToAxis(alternativeOffer.offerName, alternativeOffer.coreOutcome, alternativeOffer.mechanismDescription, posLock);
    if (altClamp.clamped) {
      alternativeOffer.offerName = altClamp.offerName;
      alternativeOffer.coreOutcome = altClamp.coreOutcome;
      alternativeOffer.mechanismDescription = altClamp.mechanismDescription;
      alternativeOffer.mechanismLayer.mechanismDescription = altClamp.mechanismDescription;
      alternativeOffer.outcomeLayer.primaryOutcome = altClamp.coreOutcome;
      console.log(`[OfferEngine-V4] AXIS_CLAMP_ALT | ${altClamp.clampActions.join("; ")}`);
      diagnostics.altAxisClamp = altClamp.clampActions;
    }
  }

  const posConsistency = checkPositioningConsistency(primaryOffer, positioning, differentiation);
  diagnostics.positioningConsistency = posConsistency;

  let hookMechAlignment = checkHookMechanismAlignment(primaryOffer, positioning);
  const altHookMechAlignment = checkHookMechanismAlignment(alternativeOffer, positioning);
  diagnostics.hookMechanismAlignment = hookMechAlignment;
  diagnostics.altHookMechanismAlignment = altHookMechAlignment;

  const combinedFailures: string[] = [];
  if (!hookMechAlignment.aligned) combinedFailures.push(...hookMechAlignment.failures);
  if (!altHookMechAlignment.aligned) combinedFailures.push(...altHookMechAlignment.failures.map(f => `[Alternative] ${f}`));

  if (!hookMechAlignment.aligned || !altHookMechAlignment.aligned) {
    hookMechAlignment = {
      aligned: false,
      failures: combinedFailures,
      hookAxis: hookMechAlignment.hookAxis || altHookMechAlignment.hookAxis,
      mechanismAxis: hookMechAlignment.mechanismAxis || altHookMechAlignment.mechanismAxis,
    };
  }

  if (!hookMechAlignment.aligned) {
    console.log(`[OfferEngine-V4] HOOK_MECHANISM_MISMATCH | ${hookMechAlignment.failures.join("; ")} — attempting corrective regeneration with axis lock`);
    try {
      const retryOffers = await aiOfferGeneration(
        audience, positioning, differentiation, accountId, marketLanguage, qualifyingSignals,
        posLock,
        { previousFailures: hookMechAlignment.failures, attempt: 2 },
      );
      diagnostics.hookMechanismRetry = { success: true, attempt: 2, corrective: true };

      const retryPrimaryOutcome: OutcomeLayer = { ...l1Outcome, primaryOutcome: retryOffers.primary.outcome || l1Outcome.primaryOutcome };
      const retryMechDesc = retryOffers.primary.mechanism || l2Mechanism.mechanismDescription;
      const retryMechLock = checkMechanismLock(retryMechDesc, differentiation);
      const retryMechanism: MechanismLayer = { ...l2Mechanism, mechanismDescription: retryMechLock.locked ? retryMechDesc : l2Mechanism.mechanismDescription };
      const retryDelivery: DeliveryLayer = { ...l3Delivery, deliverables: mergeDeliverables(retryOffers.primary.deliverables, l3Delivery.deliverables) };

      const retryPrimary = buildOfferCandidate(
        retryOffers.primary.name, retryPrimaryOutcome, retryMechanism, retryDelivery, l4Proof, l5Risk,
        audience, differentiation, mi, positioning,
      );

      if (posLock.locked) {
        const retryClamp = clampOfferToAxis(retryPrimary.offerName, retryPrimary.coreOutcome, retryPrimary.mechanismDescription, posLock);
        if (retryClamp.clamped) {
          retryPrimary.offerName = retryClamp.offerName;
          retryPrimary.coreOutcome = retryClamp.coreOutcome;
          retryPrimary.mechanismDescription = retryClamp.mechanismDescription;
          retryPrimary.mechanismLayer.mechanismDescription = retryClamp.mechanismDescription;
          retryPrimary.outcomeLayer.primaryOutcome = retryClamp.coreOutcome;
        }
      }

      const retryAlignment = checkHookMechanismAlignment(retryPrimary, positioning);
      diagnostics.hookMechanismRetryResult = retryAlignment;

      if (retryAlignment.aligned || retryAlignment.failures.length < hookMechAlignment.failures.length) {
        console.log(`[OfferEngine-V4] CORRECTIVE_RETRY_SUCCESS | Retry ${retryAlignment.aligned ? "passed" : "improved"} alignment`);
        Object.assign(primaryOffer, retryPrimary);
        hookMechAlignment = retryAlignment;

        const retryAltOutcome: OutcomeLayer = { ...l1Outcome, primaryOutcome: retryOffers.alternative.outcome || l1Outcome.primaryOutcome };
        const retryAltMechDesc = retryOffers.alternative.mechanism || l2Mechanism.mechanismDescription;
        const retryAltMechLock = checkMechanismLock(retryAltMechDesc, differentiation);
        const retryAltMech: MechanismLayer = { ...l2Mechanism, mechanismDescription: retryAltMechLock.locked ? retryAltMechDesc : l2Mechanism.mechanismDescription };
        const retryAltDelivery: DeliveryLayer = { ...l3Delivery, deliverables: mergeDeliverables(retryOffers.alternative.deliverables, l3Delivery.deliverables) };
        const retryAlt = buildOfferCandidate(
          retryOffers.alternative.name, retryAltOutcome, retryAltMech, retryAltDelivery, l4Proof, l5Risk,
          audience, differentiation, mi, positioning,
        );

        if (posLock.locked) {
          const retryAltClamp = clampOfferToAxis(retryAlt.offerName, retryAlt.coreOutcome, retryAlt.mechanismDescription, posLock);
          if (retryAltClamp.clamped) {
            retryAlt.offerName = retryAltClamp.offerName;
            retryAlt.coreOutcome = retryAltClamp.coreOutcome;
            retryAlt.mechanismDescription = retryAltClamp.mechanismDescription;
            retryAlt.mechanismLayer.mechanismDescription = retryAltClamp.mechanismDescription;
            retryAlt.outcomeLayer.primaryOutcome = retryAltClamp.coreOutcome;
          }
        }

        const retryAltAlignment = checkHookMechanismAlignment(retryAlt, positioning);
        if (retryAltAlignment.aligned) {
          Object.assign(alternativeOffer, retryAlt);
        }
      } else {
        console.log(`[OfferEngine-V4] CORRECTIVE_RETRY_NO_IMPROVEMENT | Keeping original — will flag POSITIONING_MISMATCH`);
      }
    } catch (retryErr: any) {
      console.log(`[OfferEngine-V4] CORRECTIVE_RETRY_FAILED | ${retryErr.message} — keeping original`);
      diagnostics.hookMechanismRetry = { success: false, error: retryErr.message };
    }
  }

  const allOfferText = [
    primaryOffer.offerName, primaryOffer.coreOutcome, primaryOffer.mechanismDescription,
    ...primaryOffer.deliverables, ...primaryOffer.riskNotes,
    alternativeOffer.offerName, alternativeOffer.coreOutcome, alternativeOffer.mechanismDescription,
    ...alternativeOffer.deliverables,
    rejectedOffer.offerName, rejectedOffer.coreOutcome,
  ].join(" ");
  const boundaryResult = enforceBoundaryWithSanitization(allOfferText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
  const boundaryCheck = { clean: boundaryResult.clean, violations: boundaryResult.violations };
  diagnostics.boundaryCheck = boundaryCheck;
  diagnostics.boundarySanitization = { sanitized: boundaryResult.sanitized, warnings: boundaryResult.warnings };

  const genericOutputCheck = detectGenericOutput(allOfferText);
  diagnostics.genericOutputCheck = genericOutputCheck;
  if (genericOutputCheck.genericDetected) {
    primaryOffer.offerStrengthScore = clamp(primaryOffer.offerStrengthScore - genericOutputCheck.penalty);
    alternativeOffer.offerStrengthScore = clamp(alternativeOffer.offerStrengthScore - genericOutputCheck.penalty);
    console.log(`[OfferEngine-V4] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  const diffStrength = checkDifferentiationStrength(primaryOffer, differentiation, positioning);
  diagnostics.differentiationReinforcement = diffStrength;
  if (!diffStrength.sufficient) {
    primaryOffer.offerStrengthScore = clamp(primaryOffer.offerStrengthScore * 0.85);
    alternativeOffer.offerStrengthScore = clamp(alternativeOffer.offerStrengthScore * 0.85);
    console.log(`[OfferEngine-V4] DIFFERENTIATION_WEAK | score=${diffStrength.score.toFixed(2)} | gaps=${diffStrength.gaps.join("; ")}`);
  } else {
    console.log(`[OfferEngine-V4] DIFFERENTIATION_CHECK | score=${diffStrength.score.toFixed(2)} | signals=${diffStrength.signals.length}`);
  }

  const outcomePrecision = scoreOutcomePrecision(primaryOffer.coreOutcome);
  const mechClarity = scoreMechanismClarity(primaryOffer.mechanismDescription);
  diagnostics.outcomePrecision = outcomePrecision;
  diagnostics.mechanismClarity = mechClarity;
  if (outcomePrecision.isVague) {
    primaryOffer.offerStrengthScore = clamp(primaryOffer.offerStrengthScore - 0.1);
    console.log(`[OfferEngine-V4] AI_OUTCOME_VAGUE | primary AI-generated outcome flagged as vague — strength penalized`);
  }
  if (mechClarity.isVague) {
    primaryOffer.offerStrengthScore = clamp(primaryOffer.offerStrengthScore - 0.1);
    console.log(`[OfferEngine-V4] AI_MECHANISM_VAGUE | primary AI-generated mechanism flagged as vague — strength penalized`);
  }

  let status: string = STATUS.COMPLETE;
  let statusMessage: string | null = null;
  const structuralWarnings: string[] = [];

  if (!diffStrength.sufficient) {
    structuralWarnings.push(...diffStrength.gaps);
  }

  if (!hookMechAlignment.aligned) {
    status = STATUS.POSITIONING_MISMATCH;
    statusMessage = `Positioning axis mismatch — hook and mechanism do not share the same strategic axis: ${hookMechAlignment.failures.join("; ")}`;
    structuralWarnings.push(...hookMechAlignment.failures);
    console.log(`[OfferEngine-V4] POSITIONING_MISMATCH | ${hookMechAlignment.failures.join("; ")}`);
  }

  if (!posConsistency.consistent) {
    structuralWarnings.push(...posConsistency.contradictions);
    if (status === STATUS.COMPLETE) {
      status = STATUS.POSITIONING_MISMATCH;
      statusMessage = `Positioning inconsistency — ${posConsistency.contradictions.join("; ")}`;
    }
  }

  if (!boundaryCheck.clean) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Boundary violation — cross-engine output detected: ${boundaryCheck.violations.join("; ")}`;
    console.log(`[OfferEngine-V4] BOUNDARY_VIOLATION | ${boundaryCheck.violations.join("; ")}`);
  }

  if (boundaryResult.sanitized && boundaryResult.warnings.length > 0) {
    structuralWarnings.push(...boundaryResult.warnings);
    console.log(`[OfferEngine-V4] BOUNDARY_SANITIZED | ${boundaryResult.warnings.join("; ")}`);
    primaryOffer.offerName = applySoftSanitization(primaryOffer.offerName, BOUNDARY_SOFT_PATTERNS);
    primaryOffer.coreOutcome = applySoftSanitization(primaryOffer.coreOutcome, BOUNDARY_SOFT_PATTERNS);
    primaryOffer.mechanismDescription = applySoftSanitization(primaryOffer.mechanismDescription, BOUNDARY_SOFT_PATTERNS);
    primaryOffer.deliverables = primaryOffer.deliverables.map((d: string) => applySoftSanitization(d, BOUNDARY_SOFT_PATTERNS));
    primaryOffer.riskNotes = primaryOffer.riskNotes.map((r: string) => applySoftSanitization(r, BOUNDARY_SOFT_PATTERNS));
    alternativeOffer.offerName = applySoftSanitization(alternativeOffer.offerName, BOUNDARY_SOFT_PATTERNS);
    alternativeOffer.coreOutcome = applySoftSanitization(alternativeOffer.coreOutcome, BOUNDARY_SOFT_PATTERNS);
    alternativeOffer.mechanismDescription = applySoftSanitization(alternativeOffer.mechanismDescription, BOUNDARY_SOFT_PATTERNS);
    alternativeOffer.deliverables = alternativeOffer.deliverables.map((d: string) => applySoftSanitization(d, BOUNDARY_SOFT_PATTERNS));
    rejectedOffer.offerName = applySoftSanitization(rejectedOffer.offerName, BOUNDARY_SOFT_PATTERNS);
    rejectedOffer.coreOutcome = applySoftSanitization(rejectedOffer.coreOutcome, BOUNDARY_SOFT_PATTERNS);
  }

  if (status === STATUS.COMPLETE && !primaryOffer.completeness.complete) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Offer incomplete: ${primaryOffer.completeness.missingLayers.join("; ")}`;
  }

  if (status === STATUS.COMPLETE && !primaryOffer.integrityResult.passed) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Integrity check failed: ${primaryOffer.integrityResult.failures.join("; ")}`;
  }

  let offerAlignmentValidation = validateOfferAlignment(primaryOffer, differentiation, audience, marketLanguage);
  diagnostics.offerAlignmentValidation = offerAlignmentValidation;

  if (!offerAlignmentValidation.aligned && status === STATUS.COMPLETE) {
    console.log(`[OfferEngine-V4] ALIGNMENT_RETRY | First attempt failed: ${offerAlignmentValidation.failures.join("; ")} — regenerating with positioning lock`);
    try {
      const retryOffers = await aiOfferGeneration(audience, positioning, differentiation, accountId, marketLanguage, qualifyingSignals, posLock);
      diagnostics.aiGenerationRetry = { success: true, attempt: 2 };

      const retryPrimaryOutcome: OutcomeLayer = { ...l1Outcome, primaryOutcome: retryOffers.primary.outcome || l1Outcome.primaryOutcome };
      const retryMechDesc = retryOffers.primary.mechanism || l2Mechanism.mechanismDescription;
      const retryMechLock = checkMechanismLock(retryMechDesc, differentiation);
      const retryMechanism: MechanismLayer = { ...l2Mechanism, mechanismDescription: retryMechLock.locked ? retryMechDesc : l2Mechanism.mechanismDescription };
      const retryDelivery: DeliveryLayer = { ...l3Delivery, deliverables: mergeDeliverables(retryOffers.primary.deliverables, l3Delivery.deliverables) };

      const retryPrimary = buildOfferCandidate(
        retryOffers.primary.name, retryPrimaryOutcome, retryMechanism, retryDelivery, l4Proof, l5Risk,
        audience, differentiation, mi, positioning,
      );

      if (posLock.locked) {
        const retryClamp = clampOfferToAxis(retryPrimary.offerName, retryPrimary.coreOutcome, retryPrimary.mechanismDescription, posLock);
        if (retryClamp.clamped) {
          retryPrimary.offerName = retryClamp.offerName;
          retryPrimary.coreOutcome = retryClamp.coreOutcome;
          retryPrimary.mechanismDescription = retryClamp.mechanismDescription;
          retryPrimary.mechanismLayer.mechanismDescription = retryClamp.mechanismDescription;
          retryPrimary.outcomeLayer.primaryOutcome = retryClamp.coreOutcome;
          console.log(`[OfferEngine-V4] ALIGNMENT_RETRY_CLAMP | ${retryClamp.clampActions.join("; ")}`);
        }
      }

      const retryValidation = validateOfferAlignment(retryPrimary, differentiation, audience, marketLanguage);
      diagnostics.offerAlignmentRetryValidation = retryValidation;

      if (retryValidation.aligned || retryValidation.failures.length < offerAlignmentValidation.failures.length) {
        console.log(`[OfferEngine-V4] ALIGNMENT_RETRY_SUCCESS | Retry ${retryValidation.aligned ? "passed" : "improved"} validation`);
        Object.assign(primaryOffer, retryPrimary);
        offerAlignmentValidation = retryValidation;
      } else {
        console.log(`[OfferEngine-V4] ALIGNMENT_RETRY_NO_IMPROVEMENT | Keeping original offer`);
      }
    } catch (retryErr: any) {
      console.log(`[OfferEngine-V4] ALIGNMENT_RETRY_FAILED | ${retryErr.message} — keeping original`);
      diagnostics.aiGenerationRetry = { success: false, error: retryErr.message };
    }
  }

  if (!offerAlignmentValidation.aligned) {
    structuralWarnings.push(...offerAlignmentValidation.failures);
    console.log(`[OfferEngine-V4] ALIGNMENT_VALIDATION_FAILED | ${offerAlignmentValidation.failures.join("; ")}`);
    if (status === STATUS.COMPLETE) {
      status = STATUS.INTEGRITY_FAILED;
      statusMessage = `Pre-save alignment validation failed: ${offerAlignmentValidation.failures.join("; ")}`;
    }
  }

    const mechanism = differentiation.mechanismFraming || {};
    const mechanismSupported = mechanism.supported === true;
    const mechanismType = mechanism.type || "none";
    const pains = audience.audiencePains || [];
    const desires = Object.entries(audience.desireMap || {});
    const offerOutcome = primaryOffer.coreOutcome || "";
    const offerMechDesc = primaryOffer.mechanismDescription || "";

    const hasPainAlignment = pains.length > 0 && pains.some((p: any) => {
      const painText = (typeof p === "string" ? p : p?.pain || p?.name || "").toLowerCase();
      return painText.length > 3 && (offerOutcome.toLowerCase().includes(painText.substring(0, Math.min(painText.length, 15))) || offerMechDesc.toLowerCase().includes(painText.substring(0, Math.min(painText.length, 15))));
    });
    const hasDesireAlignment = desires.length > 0 && desires.some(([k]) => {
      return k.length > 3 && (offerOutcome.toLowerCase().includes(k.toLowerCase().substring(0, Math.min(k.length, 15))) || offerMechDesc.toLowerCase().includes(k.toLowerCase().substring(0, Math.min(k.length, 15))));
    });

    const alignmentResult = checkCrossEngineAlignment([
      {
        name: "differentiation_mechanism_alignment",
        aligned: mechanismSupported || mechanismType !== "none",
        reason: !mechanismSupported && mechanismType === "none"
          ? "Offer does not leverage a validated differentiation mechanism"
          : "Offer mechanism aligns with differentiation engine output",
      },
      {
        name: "audience_pain_alignment",
        aligned: pains.length === 0 || hasPainAlignment || hasDesireAlignment,
        reason: pains.length > 0 && !hasPainAlignment && !hasDesireAlignment
          ? `Offer outcome does not reference any of the ${pains.length} identified audience pain points or ${desires.length} desire signals`
          : "Offer addresses audience pain signals",
      },
    ]);

    if (!alignmentResult.aligned) {
      structuralWarnings.push(...alignmentResult.misalignments);
      console.log(`[OfferEngine-V4] CROSS_ENGINE_MISALIGNMENT | ${alignmentResult.misalignments.join("; ")} | penalty=${alignmentResult.confidencePenalty.toFixed(2)}`);
    }
    diagnostics.crossEngineAlignment = alignmentResult;

    const rawConfidence = clamp(
    primaryOffer.offerStrengthScore *
    (posConsistency.consistent ? 1 : 0.7) *
    (hookMechAlignment.aligned ? 1 : 0.5) *
    (boundaryCheck.clean ? 1 : 0) *
    (primaryOffer.completeness.complete ? 1 : 0.6) *
    (genericOutputCheck.genericDetected ? (1 - genericOutputCheck.penalty) : 1) *
    (1 - alignmentResult.confidencePenalty) *
    (offerAlignmentValidation.aligned ? 1 : 0.75)
  );
  const confidenceScore = normalizeConfidence(rawConfidence, dataReliability);
  const confidenceNormalized = rawConfidence !== confidenceScore;
  diagnostics.confidenceNormalized = confidenceNormalized;
  if (confidenceNormalized) {
    diagnostics.rawConfidence = rawConfidence;
  }

  const layersPassed = [
    primaryOffer.completeness.complete,
    primaryOffer.integrityResult.passed,
    boundaryCheck.clean,
    posConsistency.consistent,
    hookMechAlignment.aligned,
    offerAlignmentValidation.aligned,
  ].filter(Boolean).length;
  const acceptability = assessStrategyAcceptability(
    confidenceScore, layersPassed, 6,
    primaryOffer.integrityResult.passed && boundaryCheck.clean,
    structuralWarnings,
  );
  diagnostics.strategyAcceptability = acceptability;

  console.log(`[OfferEngine-V4] Complete | status=${status} | strength=${primaryOffer.offerStrengthScore.toFixed(2)} | confidence=${confidenceScore.toFixed(2)} | grade=${acceptability.grade} | generic=${primaryOffer.genericFlag} | boundary=${boundaryCheck.clean} | alignmentWarnings=${structuralWarnings.length} | grounded=${primaryGrounding.groundedClaims}/${primaryGrounding.totalClaims}`);

  return {
    status,
    statusMessage,
    primaryOffer,
    alternativeOffer,
    rejectedOffer: { offer: rejectedOffer, rejectionReason: aiOffers.rejected.rejectionReason },
    offerStrengthScore: primaryOffer.offerStrengthScore,
    positioningConsistency: posConsistency,
    hookMechanismAlignment: hookMechAlignment,
    boundaryCheck: { passed: boundaryCheck.clean, violations: boundaryCheck.violations },
    structuralWarnings,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    layerDiagnostics: diagnostics,
    strategyAcceptability: acceptability,
    signalGrounding: {
      groundedClaims: primaryGrounding.groundedClaims,
      totalClaims: primaryGrounding.totalClaims,
      groundingRatio: primaryGrounding.groundingRatio,
      strippedClaims: primaryGrounding.strippedClaims,
    },
  };
}

function buildEmptyOffer(): OfferCandidate {
  return {
    offerName: "No Offer",
    coreOutcome: "",
    mechanismDescription: "",
    deliverables: [],
    proofAlignment: [],
    audienceFitExplanation: "",
    offerStrengthScore: 0,
    riskNotes: ["Insufficient data to construct offer"],
    outcomeLayer: { primaryOutcome: "", transformationStatement: "", specificityScore: 0 },
    mechanismLayer: { mechanismType: "none", mechanismDescription: "", differentiationLink: "", credibilityScore: 0 },
    deliveryLayer: { deliverables: [], format: "", complexityLevel: 0 },
    proofLayer: { alignedProofTypes: [], proofStrength: 0, proofGaps: [] },
    riskReductionLayer: { riskReducers: [], frictionMitigations: [], buyerConfidenceScore: 0 },
    completeness: { complete: false, missingLayers: ["All layers missing"] },
    genericFlag: false,
    integrityResult: { passed: false, failures: ["No data"] },
    frictionLevel: 1,
    depthScores: {
      outcomeClarity: 0, mechanismCredibility: 0, proofStrength: 0,
      differentiationSupport: 0, marketDemandAlignment: 0, audienceTrustCompatibility: 0,
      executionFeasibility: 0, buyerFrictionLevel: 1,
    },
  };
}
