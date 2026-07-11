import type { EngineAiPathEmission } from "../shared/ai-path-telemetry";

export interface MarketLanguageMap {
  rawPainPhrases: string[];
  rawDesirePhrases: string[];
  emotionalLanguage: string[];
  objectionLanguage: string[];
}

export interface OfferMIInput {
  dominanceData: any;
  contentDnaData: any;
  marketDiagnosis: string | null;
  opportunitySignals: any[];
  threatSignals: any[];
  multiSourceSignals?: any;
  sourceAvailability?: any;
}

export interface OfferAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface OfferPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
}

export interface MechanismCore {
  mechanismName: string;
  mechanismType: "method" | "system" | "protocol" | "framework" | "none";
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
}

export interface OfferDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  mechanismCore: MechanismCore | null;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface OutcomeLayer {
  primaryOutcome: string;
  transformationStatement: string;
  specificityScore: number;
}

export interface MechanismLayer {
  mechanismType: string;
  mechanismDescription: string;
  differentiationLink: string;
  credibilityScore: number;
}

export interface DeliveryLayer {
  deliverables: string[];
  format: string;
  complexityLevel: number;
}

export interface ProofGrounding {
  proofType: string;
  groundingText: string;
  sourceObjections: string[];
  sourcePillars: string[];
}

export interface ProofLayer {
  alignedProofTypes: string[];
  proofStrength: number;
  proofGaps: string[];
  proofGrounding: ProofGrounding[];
}

export interface RiskReductionLayer {
  riskReducers: string[];
  frictionMitigations: string[];
  buyerConfidenceScore: number;
}

export interface OfferIdentityReasoning {
  identityPayoff: string;
  commercialReasoning: string;
  valueTranslation: string;
  groundedSignals: string[];
  reasoningSteps: string[];
  rejectedAlternatives: Array<{ alternative: string; reasonRejected: string }>;
  modelUsed: string;
  generatedAt: string;
  groundingRefs?: string[];
}

export interface OfferValueArchitecture {
  outcomeChain: Array<{ feature: string; functional: string; emotional: string; identity: string }>;
  identityShift: { fromIdentity: string; toIdentity: string; identityCost: string };
  commercialLeverage: { pointInChain: "feature" | "functional" | "emotional" | "identity"; leverageMechanism: string; leverageProof: string };
  objectionEconomics: Array<{ objection: string; revenueAtStakeIfUnresolved: string; neutralizingMechanism: string; costOfNeutralizing: string }>;
  primaryValueWedge: string;
  reasoningSteps: string[];
  groundedInTrustMechanism: string | null;
  groundedInGameDimension: string | null;
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason: string;
  retryCount: number;
}

export interface OfferCandidate {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  proofGrounding: ProofGrounding[];
  audienceFitExplanation: string;
  offerStrengthScore: number;
  riskNotes: string[];
  problemStatement?: string;
  proofPath?: string[];
  objectionHandling?: string[];
  outcomeLayer: OutcomeLayer;
  mechanismLayer: MechanismLayer;
  deliveryLayer: DeliveryLayer;
  proofLayer: ProofLayer;
  riskReductionLayer: RiskReductionLayer;
  completeness: { complete: boolean; missingLayers: string[] };
  genericFlag: boolean;
  integrityResult: { passed: boolean; failures: string[] };
  frictionLevel: number;
  depthScores: OfferDepthScores;
  identityReasoning?: OfferIdentityReasoning;
  valueArchitecture?: OfferValueArchitecture;
}

export interface OfferDepthScores {
  outcomeClarity: number;
  mechanismCredibility: number;
  proofStrength: number;
  differentiationSupport: number;
  marketDemandAlignment: number;
  audienceTrustCompatibility: number;
  executionFeasibility: number;
  buyerFrictionLevel: number;
}

export interface OfferResult {
  status: string;
  statusMessage: string | null;
  /** Phase 4 — AI-proposal path telemetry emitted by the engine this run. */
  aiPathTelemetry?: EngineAiPathEmission;
  primaryOffer: OfferCandidate;
  alternativeOffer: OfferCandidate;
  rejectedOffer: { offer: OfferCandidate; rejectionReason: string };
  offerStrengthScore: number;
  positioningConsistency: { consistent: boolean; contradictions: string[] };
  hookMechanismAlignment: { aligned: boolean; failures: string[]; hookAxis: string | null; mechanismAxis: string | null };
  boundaryCheck: { passed: boolean; violations: string[] };
  structuralWarnings: string[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
  strategyAcceptability?: import("../shared/strategy-acceptability").StrategyAcceptability;
  signalGrounding?: {
    groundedClaims: number;
    totalClaims: number;
    groundingRatio: number;
    strippedClaims: string[];
  };
  /**
   * DNA Enrichment Gate (Path B) surface signal. Present only when the offer
   * interchangeability gate was exercised; `required=true` means it was STILL
   * failing at retry exhaustion and the orchestrator should raise the operator
   * prompt. The orchestrator (not the engine) writes the DB.
   */
  dnaEnrichment?: import("../shared/dna-enrichment").DnaEnrichmentSignal;
}
