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
import type {
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
): OutcomeLayer {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const territories = positioning.territories || [];
  const pillars = differentiation.pillars || [];

  const primaryPain = pains.length > 0 ? (typeof pains[0] === "string" ? pains[0] : pains[0]?.pain || pains[0]?.name || "unresolved challenge") : "unresolved challenge";
  const primaryDesire = desires.length > 0 ? desires[0][0] : "measurable improvement";
  const topTerritory = territories.length > 0 ? (territories[0].name || "strategic territory") : "strategic territory";
  const topPillar = pillars.length > 0 ? (pillars[0].name || "differentiation pillar") : "differentiation pillar";

  const transformationStatement = `Transform ${primaryPain} into ${primaryDesire} through ${topTerritory}`;
  const primaryOutcome = `Achieve ${primaryDesire} by leveraging ${topPillar} as the primary driver`;

  const painSpecificity = pains.length > 0 ? clamp(0.4 + (Math.min(pains.length, 5) * 0.1)) : 0.2;
  const desireSpecificity = desires.length > 0 ? clamp(0.4 + (Math.min(desires.length, 5) * 0.1)) : 0.2;
  const specificityScore = clamp((painSpecificity + desireSpecificity) / 2);

  return { primaryOutcome, transformationStatement, specificityScore };
}

export function layer2_mechanismAlignment(
  differentiation: OfferDifferentiationInput,
): MechanismLayer {
  const mechanism = differentiation.mechanismFraming || {};
  const pillars = differentiation.pillars || [];
  const topPillar = pillars.length > 0 ? (pillars[0].name || "core pillar") : "core pillar";

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

  const deliverables: string[] = [];

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

  if (deliverables.length === 0) {
    deliverables.push("Core transformation system");
  }

  const capped = deliverables.slice(0, MAX_DELIVERABLES);
  const format = maturity > 0.6 ? "Advanced system with modular components" : "Guided implementation program";
  const complexityLevel = clamp(capped.length / MAX_DELIVERABLES);

  return { deliverables: capped, format, complexityLevel };
}

export function layer4_proofAlignment(
  differentiation: OfferDifferentiationInput,
): ProofLayer {
  const proofArchitecture = differentiation.proofArchitecture || [];
  const pillars = differentiation.pillars || [];

  const proofTypes = new Set<string>();
  const availableTypes = ["process_proof", "outcome_proof", "transparency_proof", "case_proof", "framework_proof", "comparative_proof"];

  for (const asset of proofArchitecture) {
    if (asset.category && availableTypes.includes(asset.category)) {
      proofTypes.add(asset.category);
    }
  }

  for (const pillar of pillars) {
    const supporting = pillar.supportingProof || [];
    for (const p of supporting) {
      if (availableTypes.includes(p)) proofTypes.add(p);
    }
  }

  const alignedProofTypes = Array.from(proofTypes);
  const proofStrength = clamp(alignedProofTypes.length / 4);

  const mandatoryProof = ["process_proof", "outcome_proof", "transparency_proof", "case_proof"];
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

  if (riskReducers.length === 0) {
    riskReducers.push("Standard quality assurance process");
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
): Promise<{ primary: { name: string; outcome: string; mechanism: string }; alternative: { name: string; outcome: string; mechanism: string }; rejected: { name: string; outcome: string; mechanism: string; rejectionReason: string } }> {
  const pains = audience.audiencePains || [];
  const desires = Object.entries(audience.desireMap || {});
  const territories = positioning.territories || [];
  const pillars = differentiation.pillars || [];
  const mechanism = differentiation.mechanismFraming || {};

  const prompt = `You are an Offer Architect. Generate three offer concepts based on the market intelligence below.

STRICT RULES:
- Do NOT generate funnel architecture, advertising strategy, channel selection, media planning, budget recommendations, campaign execution, sales scripts, financial modeling, or strategic master plan decisions
- ONLY output offer definitions: name, core outcome, mechanism description
- Offers must be specific and non-generic. Avoid phrases like "grow your business", "scale faster", "get more leads"
- Each offer must define WHAT the buyer receives and WHY the market would want it NOW
- Respond with ONLY valid JSON, no markdown

Market Context:
- Top Pains: ${JSON.stringify(pains.slice(0, 5).map((p: any) => typeof p === "string" ? p : p?.pain || p?.name))}
- Top Desires: ${JSON.stringify(desires.slice(0, 5).map(([k]) => k))}
- Territories: ${JSON.stringify(territories.slice(0, 3).map((t: any) => t.name))}
- Differentiation Pillars: ${JSON.stringify(pillars.slice(0, 3).map((p: any) => p.name))}
- Mechanism: ${mechanism.description || "No validated mechanism"}
- Enemy: ${positioning.enemyDefinition || "Not defined"}
- Narrative: ${positioning.narrativeDirection || "Not defined"}

Return JSON:
{
  "primary": { "name": "Specific offer name", "outcome": "What transformation the buyer gets", "mechanism": "How the mechanism delivers it" },
  "alternative": { "name": "Alternative offer name", "outcome": "Different angle on transformation", "mechanism": "Different mechanism approach" },
  "rejected": { "name": "Rejected offer name", "outcome": "Why this seems appealing", "mechanism": "What it promises", "rejectionReason": "Why this offer fails (generic, weak proof, contradicts positioning, etc.)" }
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
      },
      alternative: {
        name: parsed.alternative?.name || "Alternative Offer",
        outcome: parsed.alternative?.outcome || "Alternative transformation",
        mechanism: parsed.alternative?.mechanism || "Standard delivery",
      },
      rejected: {
        name: parsed.rejected?.name || "Rejected Offer",
        outcome: parsed.rejected?.outcome || "Rejected transformation",
        mechanism: parsed.rejected?.mechanism || "Standard delivery",
        rejectionReason: parsed.rejected?.rejectionReason || "Did not meet specificity requirements",
      },
    };
  } catch (err: any) {
    console.error(`[OfferEngine] AI generation failed: ${err.message}`);
    return {
      primary: { name: "Core Transformation System", outcome: "Primary market transformation based on differentiation pillars", mechanism: "Structured implementation methodology" },
      alternative: { name: "Accelerated Implementation Program", outcome: "Rapid deployment of core transformation", mechanism: "Compressed delivery framework" },
      rejected: { name: "Generic Growth Package", outcome: "General business improvement", mechanism: "Standard approach", rejectionReason: "Generic offer — lacks specificity and market differentiation" },
    };
  }
}

export async function runOfferEngine(
  mi: OfferMIInput,
  audience: OfferAudienceInput,
  positioning: OfferPositioningInput,
  differentiation: OfferDifferentiationInput,
  accountId: string,
): Promise<OfferResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  console.log(`[OfferEngine-V3] Starting 5-layer pipeline`);

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
    console.log(`[OfferEngine-V3] Insufficient differentiation data`);
    const emptyOffer = buildEmptyOffer();
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
    };
  }

  const l1Outcome = layer1_outcomeConstruction(audience, positioning, differentiation);
  diagnostics.layer1 = { specificityScore: l1Outcome.specificityScore };

  const l2Mechanism = layer2_mechanismAlignment(differentiation);
  diagnostics.layer2 = { type: l2Mechanism.mechanismType, credibility: l2Mechanism.credibilityScore };

  const l3Delivery = compressFeasibility(layer3_deliveryStructure(audience, differentiation));
  diagnostics.layer3 = { deliverableCount: l3Delivery.deliverables.length, complexity: l3Delivery.complexityLevel };

  const l4Proof = layer4_proofAlignment(differentiation);
  diagnostics.layer4 = { proofTypes: l4Proof.alignedProofTypes.length, strength: l4Proof.proofStrength, gaps: l4Proof.proofGaps };

  const l5Risk = layer5_riskReduction(audience, l4Proof);
  diagnostics.layer5 = { reducers: l5Risk.riskReducers.length, buyerConfidence: l5Risk.buyerConfidenceScore };

  let aiOffers;
  try {
    aiOffers = await aiOfferGeneration(audience, positioning, differentiation, accountId);
    diagnostics.aiGeneration = { success: true };
  } catch (err: any) {
    diagnostics.aiGeneration = { success: false, error: err.message };
    aiOffers = {
      primary: { name: "Core Transformation System", outcome: l1Outcome.primaryOutcome, mechanism: l2Mechanism.mechanismDescription },
      alternative: { name: "Alternative Implementation Program", outcome: l1Outcome.transformationStatement, mechanism: l2Mechanism.mechanismDescription },
      rejected: { name: "Generic Growth Package", outcome: "General improvement", mechanism: "Standard approach", rejectionReason: "Generic and unspecific" },
    };
  }

  const primaryOutcome: OutcomeLayer = {
    ...l1Outcome,
    primaryOutcome: aiOffers.primary.outcome || l1Outcome.primaryOutcome,
  };
  const primaryMechanism: MechanismLayer = {
    ...l2Mechanism,
    mechanismDescription: aiOffers.primary.mechanism || l2Mechanism.mechanismDescription,
  };

  const primaryOffer = buildOfferCandidate(
    aiOffers.primary.name, primaryOutcome, primaryMechanism, l3Delivery, l4Proof, l5Risk,
    audience, differentiation, mi, positioning,
  );

  const altOutcome: OutcomeLayer = {
    ...l1Outcome,
    primaryOutcome: aiOffers.alternative.outcome || l1Outcome.transformationStatement,
    specificityScore: clamp(l1Outcome.specificityScore * 0.9),
  };
  const altMechanism: MechanismLayer = {
    ...l2Mechanism,
    mechanismDescription: aiOffers.alternative.mechanism || l2Mechanism.mechanismDescription,
  };

  const alternativeOffer = buildOfferCandidate(
    aiOffers.alternative.name, altOutcome, altMechanism, l3Delivery, l4Proof, l5Risk,
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
    (1 - alignmentResult.confidencePenalty)
  );
  const confidenceScore = normalizeConfidence(rawConfidence, dataReliability);
  const confidenceNormalized = rawConfidence !== confidenceScore;
  diagnostics.confidenceNormalized = confidenceNormalized;
  if (confidenceNormalized) {
    diagnostics.rawConfidence = rawConfidence;
  }

  console.log(`[OfferEngine-V3] Complete | status=${status} | strength=${primaryOffer.offerStrengthScore.toFixed(2)} | confidence=${confidenceScore.toFixed(2)} | generic=${primaryOffer.genericFlag} | boundary=${boundaryCheck.clean} | alignmentWarnings=${structuralWarnings.length}`);

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
