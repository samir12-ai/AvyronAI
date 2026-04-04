export interface AudienceEngineInput {
  miSignals: Array<{ text: string; source?: string }>;
  businessProfile: { industry: string; coreOffer: string };
  productDna?: string;
}

export interface AudienceEngineOutput {
  audiencePains: Array<{ pain: string; severity?: string; frequency?: string }>;
  desireMap: Array<{ desire: string; priority?: string }>;
  objectionMap: Array<{ objection: string; type?: string; root?: string }>;
  awarenessLevel: "Unaware" | "Problem Aware" | "Solution Aware" | "Product Aware" | "Most Aware";
  maturityIndex: "Beginner" | "Intermediate" | "Advanced" | "Mature";
  audienceSegments: Array<{ name: string; densityScore?: number; description?: string }>;
}

export interface PositioningEngineInput {
  audiencePains: AudienceEngineOutput["audiencePains"];
  desireMap: AudienceEngineOutput["desireMap"];
  miSnapshots: Array<{ competitor: string; claims?: string[] }>;
  productDna?: string;
}

export interface PositioningEngineOutput {
  territories: Array<{ name: string; rationale?: string }>;
  contrastAxis: { us: string; them: string };
  enemyDefinition: string;
  narrativeDirection: string;
}

export interface DifferentiationEngineInput {
  positioningTerritories: PositioningEngineOutput["territories"];
  contrastAxis: PositioningEngineOutput["contrastAxis"];
  objections: AudienceEngineOutput["objectionMap"];
  competitorClaims: Array<string>;
}

export interface DifferentiationEngineOutput {
  differentiationPillars: Array<{ pillar: string; proof?: string; uniqueness?: string }>;
  claimCollisionCheck: Array<{ claim: string; collision?: boolean; overlap?: string }>;
  proofArchitecture: Array<{ type: string; asset?: string; required?: boolean }>;
  mechanismCandidate: string;
}

export interface MechanismEngineInput {
  positioningAxis: PositioningEngineOutput["contrastAxis"];
  differentiationPillars: DifferentiationEngineOutput["differentiationPillars"];
  causalGrounding?: string;
}

export interface MechanismEngineOutput {
  primaryMechanism: {
    name: string;
    steps: Array<{ step: number; label: string; description: string }>;
  };
  mechanismLogic: {
    cause: string;
    intervention: string;
    outcome: string;
  };
  axisAlignment: string;
}

export interface OfferEngineInput {
  audiencePains: AudienceEngineOutput["audiencePains"];
  desireMap: AudienceEngineOutput["desireMap"];
  positioningAxis: PositioningEngineOutput["contrastAxis"];
  differentiationPillars: DifferentiationEngineOutput["differentiationPillars"];
  mechanismLogic: MechanismEngineOutput["mechanismLogic"];
  mechanismName: string;
}

export interface OfferEngineOutput {
  transformationStatement: { from: string; to: string };
  coreOutcome: string;
  deliveryStructure: Array<{ deliverable: string; mechanismStep?: number }>;
  riskReductionLayer: Array<{ type: string; description: string }>;
}

export interface AwarenessEngineInput {
  audienceReadiness: AudienceEngineOutput["awarenessLevel"];
  miOpportunitySignals: Array<{ signal: string }>;
  positioningNarrative: string;
  offerOutcome: string;
  funnelType?: string;
}

export interface AwarenessEngineOutput {
  marketEntryRoute: string;
  attentionTrigger: string;
  awarenessStageMapping: Array<{ stage: string; messaging: string }>;
}

export interface PersuasionEngineInput {
  objections: AudienceEngineOutput["objectionMap"];
  awarenessStage: AudienceEngineOutput["awarenessLevel"];
  proofArchitecture: DifferentiationEngineOutput["proofArchitecture"];
  offerRisks: OfferEngineOutput["riskReductionLayer"];
}

export interface PersuasionEngineOutput {
  structuredObjectionMap: Array<{ objection: string; type: string; stage: string; resolution?: string }>;
  objectionProofLinks: Array<{ objection: string; proofAsset: string }>;
  persuasionMode: string;
  trustSequence: Array<{ order: number; action: string; rationale: string }>;
}

export interface FunnelEngineInput {
  audienceFriction: Array<string>;
  offerStrength: string;
  awarenessEntryRoute: AwarenessEngineOutput["marketEntryRoute"];
  trustSequence: PersuasionEngineOutput["trustSequence"];
}

export interface FunnelEngineOutput {
  funnelType: string;
  stageMap: Array<{ stage: string; objective: string; content?: string }>;
  trustPath: Array<{ stage: string; trustAction: string }>;
  entryTriggerMechanism: string;
}

export const ENGINE_PIPELINE_SUMMARY = `
8-ENGINE STRATEGIC PIPELINE — Input/Output Contracts

1. AUDIENCE ENGINE
   Inputs: MI signals, business profile, product DNA
   Outputs: painMap, desireMap, objectionMap, awarenessLevel, maturityIndex, audienceSegments
   Locks Next: Positioning cannot be invented — must map to real pains and awareness level

2. POSITIONING ENGINE
   Inputs: audiencePains, desireMap, MI snapshots, productDNA
   Outputs: territories, contrastAxis (Us vs. Them), enemyDefinition, narrativeDirection
   Locks Next: Differentiation pillars MUST prove the contrastAxis is real and superior

3. DIFFERENTIATION ENGINE
   Inputs: positioningTerritories, contrastAxis, objections, competitorClaims
   Outputs: differentiationPillars, claimCollisionCheck, proofArchitecture, mechanismCandidate
   Locks Next: Mechanism MUST formalize the mechanismCandidate into a working system

4. MECHANISM ENGINE
   Inputs: positioningAxis, differentiationPillars, causalGrounding
   Outputs: primaryMechanism (name + 3-5 steps), mechanismLogic (Cause→Intervention→Outcome), axisAlignment
   Locks Next: Mechanism name and logic become the core delivery method of the Offer

5. OFFER ENGINE
   Inputs: audiencePains, positioningAxis, differentiationPillars, mechanismLogic
   Outputs: transformationStatement (From→To), coreOutcome, deliveryStructure, riskReductionLayer
   Locks Next: Offer outcome determines the Awareness entry trigger

6. AWARENESS ENGINE
   Inputs: audienceReadiness, MI signals, positioningNarrative, offerOutcome
   Outputs: marketEntryRoute, attentionTrigger, awarenessStageMapping
   Locks Next: Funnel MUST start with the entry trigger (cannot open with sales pitch if route is Myth-Breaker)

7. PERSUASION ENGINE
   Inputs: objections, awarenessStage, proofArchitecture, offerRisks
   Outputs: structuredObjectionMap, objectionProofLinks, persuasionMode, trustSequence
   Locks Next: Trust sequence determines the ORDER of funnel stages

8. FUNNEL ENGINE
   Inputs: audienceFriction, offerStrength, awarenessEntryRoute, trustSequence
   Outputs: funnelType, stageMap, trustPath, entryTriggerMechanism
   Final Output: Complete execution-ready strategic plan
`.trim();
