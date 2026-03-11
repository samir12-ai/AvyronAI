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

export interface ProofLayer {
  alignedProofTypes: string[];
  proofStrength: number;
  proofGaps: string[];
}

export interface RiskReductionLayer {
  riskReducers: string[];
  frictionMitigations: string[];
  buyerConfidenceScore: number;
}

export interface OfferCandidate {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  audienceFitExplanation: string;
  offerStrengthScore: number;
  riskNotes: string[];
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
  primaryOffer: OfferCandidate;
  alternativeOffer: OfferCandidate;
  rejectedOffer: { offer: OfferCandidate; rejectionReason: string };
  offerStrengthScore: number;
  positioningConsistency: { consistent: boolean; contradictions: string[] };
  boundaryCheck: { passed: boolean; violations: string[] };
  structuralWarnings: string[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
  strategyAcceptability?: import("../shared/strategy-acceptability").StrategyAcceptability;
}
