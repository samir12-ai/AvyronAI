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
  const primaryDesire = rawDesirePhrase || (desires.length > 0 ? desires[0][0] : "measurable improvement");
  const topTerritory = territories.length > 0 ? (territories[0].name || "strategic territory") : "strategic territory";
  const topPillar = pillars.length > 0 ? (pillars[0].name || "differentiation pillar") : "differentiation pillar";

  const transformationStatement = `Transform "${primaryPain}" into "${primaryDesire}" through ${topTerritory}`;
  const primaryOutcome = `Achieve "${primaryDesire}" by leveraging ${topPillar} as the primary driver`;

  const hasMarketLanguage = !!(rawPainPhrase || rawDesirePhrase);
  const painSpecificity = pains.length > 0 ? clamp(0.4 + (Math.min(pains.length, 5) * 0.1)) : 0.2;
  const desireSpecificity = desires.length > 0 ? clamp(0.4 + (Math.min(desires.length, 5) * 0.1)) : 0.2;
  const baseSpecificity = clamp((painSpecificity + desireSpecificity) / 2);
  const specificityScore = hasMarketLanguage ? clamp(baseSpecificity + 0.1) : baseSpecificity;

  return { primaryOutcome, transformationStatement, specificityScore };
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
    const mechanismDescription = core.mechanismLogic || core.mechanismPromise || mechanism.description || "Standard delivery methodology";
    const differentiationLink = `Mechanism "${core.mechanismName}" (${core.mechanismType}) anchored to ${topPillar} via MechanismCore`;
    const stepsBonus = core.mechanismSteps.length > 0 ? clamp(core.mechanismSteps.length * 0.1, 0, 0.3) : 0;
    const credibilityScore = clamp(0.7 + stepsBonus);
    return { mechanismType, mechanismDescription, differentiationLink, credibilityScore };
  }

  const mechanismType = mechanism.type || "none";
  const mechanismDescription = mechanism.description || "Standard delivery methodology";
  const differentiationLink = mechanism.supported
    ? `Mechanism anchored to ${topPillar} with structural proof support`
    : `Generic delivery approach — mechanism not yet structurally validated`;

  const typeScore = mechanism.supported ? 0.7 : 0.3;
  const proofScore = mechanism.proofBasis?.length > 0 ? clamp(0.3 + (mechanism.proofBasis.length * 0.1)) : 0.2;
  const credibilityScore = clamp(typeScore * 0.6 + proofScore * 0.4);

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
): ProofLayer {
  const proofArchitecture = differentiation.proofArchitecture || [];
  const pillars = differentiation.pillars || [];

  const proofTypes = new Set<string>();
  const availableTypes = ["process_proof", "outcome_proof", "transparency_proof", "case_proof", "framework_proof", "comparative_proof"];
  const objectionRequiredProofs = new Set(["transparency_proof", "outcome_proof", "process_proof"]);

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

  if (!hasObjectionSignals && proofTypes.size > 0) {
    console.log(`[OfferEngine-V3] PROOF_SIGNAL_GATE | objection signals absent — skipped ${[...objectionRequiredProofs].filter(p => !proofTypes.has(p)).length} objection-required proof types`);
  }

  const alignedProofTypes = Array.from(proofTypes);
  const proofStrength = clamp(alignedProofTypes.length / 4);

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

      if (marketLanguageRatio < 0.1 && allMarketTokens.length >= 3) {
        failures.push(`Market language preservation failed — only ${matchedTokens.length}/${allMarketTokens.length} audience tokens found in offer text (abstract rewrite detected)`);
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

  const prompt = `You are an Offer Architect. Generate three offer concepts.

ABSOLUTE RULES:
- Do NOT generate funnel architecture, advertising strategy, channel selection, media planning, budget recommendations, campaign execution, sales scripts, or strategic master plan decisions
- Do NOT include financial advisory claims (eliminating debt, increasing savings, building net worth, financial freedom). Use outcome-oriented language instead.
- Respond with ONLY valid JSON, no markdown${mechLockInstruction}

═══ SECTION 1: AUDIENCE PAIN LANGUAGE (use these exact words) ═══
${painPhrases.length > 0 ? `Raw Pain Phrases: ${JSON.stringify(painPhrases)}` : "No raw pain phrases available"}
${desirePhrases.length > 0 ? `Raw Desire Phrases: ${JSON.stringify(desirePhrases)}` : "No raw desire phrases available"}
${emotionalPhrases.length > 0 ? `Emotional Language: ${JSON.stringify(emotionalPhrases)}` : ""}
${objectionPhrases.length > 0 ? `Objection Language to address: ${JSON.stringify(objectionPhrases)}` : ""}
${hasMarketLanguage ? `
MANDATORY: You MUST use the audience's own words above directly in the offer name, outcome, mechanism, and deliverables.
- Copy exact phrases from the pain/desire lists into your output
- At least 20% of your output words must come directly from the phrases above
- Do NOT substitute with generic business jargon like "optimize", "leverage", "scale", "transform", "empower", "unlock"
- If audience says "struggle with debt" → use "struggle with debt", NOT "financial optimization"
- If audience says "want more clients" → use "get more clients", NOT "scale revenue"` : ""}

═══ SECTION 2: MECHANISM (single source of truth) ═══
${hasMechanismCore ? `Mechanism Name: "${core!.mechanismName}"
Mechanism Type: ${core!.mechanismType}
Mechanism Steps:
${deliverableSteps}
Mechanism Promise: ${core!.mechanismPromise}
Problem it solves: ${core!.mechanismProblem}
Logic: ${core!.mechanismLogic}

MANDATORY: All offer mechanism descriptions MUST reference "${core!.mechanismName}" by name.
Describe delivery using ONLY the steps above. Do NOT invent new steps or mechanisms.` : `Mechanism: ${mechanism.description || "No validated mechanism"}
Differentiation Pillars:
${deliverableSteps}`}

═══ SECTION 3: DELIVERABLES (must map to mechanism steps) ═══
Each deliverable MUST correspond to one mechanism step above.
${hasMechanismCore ? `Required deliverables (one per step):
${core!.mechanismSteps.map((step, i) => `  Deliverable ${i + 1}: Map to "${step}"`).join("\n")}
Do NOT add generic deliverables like "community", "coaching", "support" unless they correspond to a mechanism step.` : `Derive deliverables from the differentiation pillars listed above.`}

═══ SECTION 4: SIGNAL ANCHORS (MANDATORY) ═══
${qualifyingSignals && qualifyingSignals.length > 0 ? `Every claim you generate MUST be derived from one of these upstream signals. Do NOT invent claims that cannot be traced to a signal below.
${qualifyingSignals.slice(0, 15).map((s, i) => `  [${s.signalId}] (${s.originEngine}/${s.category}): "${s.text}"`).join("\n")}
RULE: Each outcome, mechanism justification, and deliverable must address or build upon at least one signal above.` : "No qualifying signals provided — generate conservatively with maximum specificity."}

═══ SECTION 5: CONTEXT ═══
- Top Pains: ${JSON.stringify(pains.slice(0, 5).map((p: any) => typeof p === "string" ? p : p?.pain || p?.name))}
- Top Desires: ${JSON.stringify(desires.slice(0, 5).map(([k]) => k))}
- Territories: ${JSON.stringify(territories.slice(0, 3).map((t: any) => t.name))}
- Enemy: ${positioning.enemyDefinition || "Not defined"}
- Narrative: ${positioning.narrativeDirection || "Not defined"}

═══ SECTION 6: PROOF ALIGNMENT ═══
Link proof types to the objections the audience has.
${objectionPhrases.length > 0 ? `Audience objections to address: ${JSON.stringify(objectionPhrases)}` : "No specific objections identified"}

Return JSON:
{
  "primary": { "name": "Offer name using audience language", "outcome": "Transformation using raw pain/desire phrases", "mechanism": "How ${hasMechanismCore ? core!.mechanismName : "the mechanism"} delivers it using the exact steps", "deliverables": ["Step-mapped deliverable 1", "Step-mapped deliverable 2"] },
  "alternative": { "name": "Alternative offer name", "outcome": "Different angle using audience language", "mechanism": "Alternative delivery approach", "deliverables": ["Alt deliverable 1", "Alt deliverable 2"] },
  "rejected": { "name": "Rejected offer", "outcome": "Why this seems appealing", "mechanism": "What it promises", "deliverables": [], "rejectionReason": "Why this fails (generic, weak proof, contradicts positioning)" }
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

  console.log(`[OfferEngine-V3] Starting 5-layer pipeline`);

  const qualifyingSignals = extractQualifyingSignals(upstreamLineage);
  diagnostics.signalAnchoring = {
    upstreamLineageCount: upstreamLineage.length,
    qualifyingSignals: qualifyingSignals.length,
    minRequired: MIN_QUALIFYING_SIGNALS,
  };
  console.log(`[OfferEngine-V3] SIGNAL_CHECK | upstream=${upstreamLineage.length} | qualifying=${qualifyingSignals.length} | min=${MIN_QUALIFYING_SIGNALS}`);

  if (qualifyingSignals.length < MIN_QUALIFYING_SIGNALS) {
    console.log(`[OfferEngine-V3] SIGNAL_INSUFFICIENT | qualifying=${qualifyingSignals.length} < min=${MIN_QUALIFYING_SIGNALS} — cannot generate grounded claims`);
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
    console.log(`[OfferEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  if (pillars.length === 0 && claims.length === 0) {
    console.log(`[OfferEngine-V3] Insufficient differentiation data — returning red-grade adaptive fallback`);
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
  console.log(`[OfferEngine-V3] MarketLanguageMap | pains=${marketLanguage.rawPainPhrases.length} | desires=${marketLanguage.rawDesirePhrases.length} | emotional=${marketLanguage.emotionalLanguage.length} | objections=${marketLanguage.objectionLanguage.length}`);

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
  console.log(`[OfferEngine-V3] PROOF_GATE | objectionSignals=${objectionSignals.length} | hasObjectionSignals=${hasObjectionSignals}`);

  const l4Proof = layer4_proofAlignment(differentiation, hasObjectionSignals);
  diagnostics.layer4 = { proofTypes: l4Proof.alignedProofTypes.length, strength: l4Proof.proofStrength, gaps: l4Proof.proofGaps, objectionGated: !hasObjectionSignals };

  const l5Risk = layer5_riskReduction(audience, l4Proof);
  diagnostics.layer5 = { reducers: l5Risk.riskReducers.length, buyerConfidence: l5Risk.buyerConfidenceScore };

  let aiOffers;
  try {
    aiOffers = await aiOfferGeneration(audience, positioning, differentiation, accountId, marketLanguage, qualifyingSignals);
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
  console.log(`[OfferEngine-V3] GROUNDING_CHECK | primary: grounded=${primaryGrounding.groundedClaims}/${primaryGrounding.totalClaims} | ratio=${primaryGrounding.groundingRatio.toFixed(2)} | stripped=${primaryGrounding.strippedClaims.join("; ").slice(0, 100)}`);

  const GROUNDING_RATIO_FLOOR = 0.3;
  if (primaryGrounding.groundingRatio < GROUNDING_RATIO_FLOOR && primaryGrounding.totalClaims > 0) {
    console.log(`[OfferEngine-V3] GROUNDING_FAILED | ratio=${primaryGrounding.groundingRatio.toFixed(2)} < floor=${GROUNDING_RATIO_FLOOR} — returning SIGNAL_INSUFFICIENT`);
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
    console.log(`[OfferEngine-V3] GROUNDING_STRIP | primary outcome replaced with layer-1 fallback`);
  }
  if (primaryGrounding.strippedClaims.includes(aiOffers.primary.mechanism)) {
    aiOffers.primary.mechanism = l2Mechanism.mechanismDescription;
    console.log(`[OfferEngine-V3] GROUNDING_STRIP | primary mechanism replaced with layer-2 fallback`);
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
    console.log(`[OfferEngine-V3] MECHANISM_LOCK | primary mechanism category mismatch: diff="${primaryMechLock.diffCategory}" offer="${primaryMechLock.offerCategory}" — forced back to differentiation framing`);
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
    console.log(`[OfferEngine-V3] MECHANISM_LOCK | alternative mechanism category mismatch: diff="${altMechLock.diffCategory}" offer="${altMechLock.offerCategory}" — forced back to differentiation framing`);
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

  const posConsistency = checkPositioningConsistency(primaryOffer, positioning, differentiation);
  diagnostics.positioningConsistency = posConsistency;

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
    console.log(`[OfferEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  let status: string = STATUS.COMPLETE;
  let statusMessage: string | null = null;
  const structuralWarnings: string[] = [];

  if (!boundaryCheck.clean) {
    status = STATUS.INTEGRITY_FAILED;
    statusMessage = `Boundary violation — cross-engine output detected: ${boundaryCheck.violations.join("; ")}`;
    console.log(`[OfferEngine-V3] BOUNDARY_VIOLATION | ${boundaryCheck.violations.join("; ")}`);
  }

  if (boundaryResult.sanitized && boundaryResult.warnings.length > 0) {
    structuralWarnings.push(...boundaryResult.warnings);
    console.log(`[OfferEngine-V3] BOUNDARY_SANITIZED | ${boundaryResult.warnings.join("; ")}`);
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
    console.log(`[OfferEngine-V3] ALIGNMENT_RETRY | First attempt failed: ${offerAlignmentValidation.failures.join("; ")} — regenerating AI offers`);
    try {
      const retryOffers = await aiOfferGeneration(audience, positioning, differentiation, accountId, marketLanguage, qualifyingSignals);
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

      const retryValidation = validateOfferAlignment(retryPrimary, differentiation, audience, marketLanguage);
      diagnostics.offerAlignmentRetryValidation = retryValidation;

      if (retryValidation.aligned || retryValidation.failures.length < offerAlignmentValidation.failures.length) {
        console.log(`[OfferEngine-V3] ALIGNMENT_RETRY_SUCCESS | Retry ${retryValidation.aligned ? "passed" : "improved"} validation`);
        Object.assign(primaryOffer, retryPrimary);
        offerAlignmentValidation = retryValidation;
      } else {
        console.log(`[OfferEngine-V3] ALIGNMENT_RETRY_NO_IMPROVEMENT | Keeping original offer`);
      }
    } catch (retryErr: any) {
      console.log(`[OfferEngine-V3] ALIGNMENT_RETRY_FAILED | ${retryErr.message} — keeping original`);
      diagnostics.aiGenerationRetry = { success: false, error: retryErr.message };
    }
  }

  if (!offerAlignmentValidation.aligned) {
    structuralWarnings.push(...offerAlignmentValidation.failures);
    console.log(`[OfferEngine-V3] ALIGNMENT_VALIDATION_FAILED | ${offerAlignmentValidation.failures.join("; ")}`);
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
      console.log(`[OfferEngine-V3] CROSS_ENGINE_MISALIGNMENT | ${alignmentResult.misalignments.join("; ")} | penalty=${alignmentResult.confidencePenalty.toFixed(2)}`);
    }
    diagnostics.crossEngineAlignment = alignmentResult;

    const rawConfidence = clamp(
    primaryOffer.offerStrengthScore *
    (posConsistency.consistent ? 1 : 0.7) *
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
    offerAlignmentValidation.aligned,
  ].filter(Boolean).length;
  const acceptability = assessStrategyAcceptability(
    confidenceScore, layersPassed, 5,
    primaryOffer.integrityResult.passed && boundaryCheck.clean,
    structuralWarnings,
  );
  diagnostics.strategyAcceptability = acceptability;

  console.log(`[OfferEngine-V3] Complete | status=${status} | strength=${primaryOffer.offerStrengthScore.toFixed(2)} | confidence=${confidenceScore.toFixed(2)} | grade=${acceptability.grade} | generic=${primaryOffer.genericFlag} | boundary=${boundaryCheck.clean} | alignmentWarnings=${structuralWarnings.length} | grounded=${primaryGrounding.groundedClaims}/${primaryGrounding.totalClaims}`);

  return {
    status,
    statusMessage,
    primaryOffer,
    alternativeOffer,
    rejectedOffer: { offer: rejectedOffer, rejectionReason: aiOffers.rejected.rejectionReason },
    offerStrengthScore: primaryOffer.offerStrengthScore,
    positioningConsistency: posConsistency,
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
