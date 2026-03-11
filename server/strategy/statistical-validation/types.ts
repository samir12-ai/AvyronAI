export interface ValidationMIInput {
  marketDiagnosis: string | null;
  overallConfidence: number;
  opportunitySignals: any[];
  threatSignals: any[];
  narrativeObjectionCount: number;
  narrativeObjections: Array<{
    objection: string;
    frequencyScore: number;
    narrativeConfidence: number;
    patternCategory: string;
    signalType: string;
  }>;
}

export interface ValidationAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface ValidationOfferInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  offerStrengthScore: number;
  riskNotes: string[];
  frictionLevel: number;
}

export interface ValidationFunnelInput {
  funnelName: string;
  funnelType: string;
  stageMap: any[];
  trustPath: any[];
  proofPlacements: any[];
  commitmentLevel: string;
  frictionMap: any[];
  entryTrigger: { mechanismType: string; purpose: string };
  funnelStrengthScore: number;
}

export interface ValidationAwarenessInput {
  entryMechanismType: string;
  targetReadinessStage: string;
  triggerClass: string;
  trustRequirement: string;
  funnelCompatibility: string;
  awarenessStrengthScore: number;
  frictionNotes: string[];
}

export interface ValidationPersuasionInput {
  persuasionMode: string;
  primaryInfluenceDrivers: string[];
  objectionPriorities: string[];
  trustSequence: string[];
  persuasionStrengthScore: number;
  frictionNotes: string[];
  trustBarriers: any[];
  objectionProofLinks: any[];
  structuredObjections: any[];
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

export interface ClaimValidation {
  claim: string;
  source: string;
  evidenceType: "signal" | "narrative" | "assumption" | "inferred" | "structured_inference";
  evidenceStrength: number;
  supportingSignals: string[];
  contradictingSignals: string[];
  validated: boolean;
}

export interface DataReliabilityDiagnostics {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

export interface StatisticalValidationResult {
  status: string;
  statusMessage: string | null;
  claimConfidenceScore: number;
  evidenceStrength: number;
  validationState: "validated" | "provisional" | "weak" | "rejected";
  assumptionFlags: string[];
  claimValidations: ClaimValidation[];
  layerResults: LayerResult[];
  structuralWarnings: string[];
  boundaryCheck: { passed: boolean; violations: string[]; sanitized?: boolean; sanitizedText?: string; warnings?: string[] };
  dataReliability: DataReliabilityDiagnostics;
  confidenceNormalized: boolean;
  executionTimeMs: number;
  engineVersion: number;
  strategyAcceptability?: import("../../shared/strategy-acceptability").StrategyAcceptability;
}
