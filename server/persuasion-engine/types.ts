export interface StructuredObjection {
  objectionStatement: string;
  objectionTrigger: string;
  objectionStage: "awareness" | "consideration" | "decision";
  objectionType: "trust" | "feasibility" | "cost" | "complexity";
  requiredProofType: string;
  persuasionResponse: string;
  source: "audience_objection" | "narrative_extraction" | "pain_inference";
  confidence: number;
}

export interface PersuasionMIInput {
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
    competitorSources: string[];
  }>;
}

export interface PersuasionAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface PersuasionPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
  confidenceScore: number | null;
}

export interface MechanismCore {
  mechanismName: string;
  mechanismType: "method" | "system" | "protocol" | "framework" | "none";
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
}

export interface PersuasionDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  mechanismCore: MechanismCore | null;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface PersuasionOfferInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  offerStrengthScore: number;
  riskNotes: string[];
  frictionLevel: number;
}

export interface PersuasionFunnelInput {
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

export interface PersuasionIntegrityInput {
  overallIntegrityScore: number;
  safeToExecute: boolean;
  layerResults: any[];
  structuralWarnings: string[];
  flaggedInconsistencies: string[];
}

export interface PersuasionAwarenessInput {
  entryMechanismType: string;
  targetReadinessStage: string;
  triggerClass: string;
  trustRequirement: string;
  funnelCompatibility: string;
  awarenessStrengthScore: number;
  frictionNotes: string[];
}

export interface TrustBarrierClassification {
  barrierType: string;
  severity: "low" | "moderate" | "high" | "critical";
  source: string;
  persuasionImplication: string;
}

export interface ObjectionProofLink {
  objectionCategory: string;
  objectionDetail: string;
  requiredProofType: string;
  proofAvailable: boolean;
  confidence: number;
}

export interface PersuasionReliabilityComponents {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  objectionSpecificity: number;
  trustSpecificity: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

export interface PersuasionRoute {
  routeName: string;
  persuasionMode: string;
  primaryInfluenceDrivers: string[];
  objectionPriorities: string[];
  trustSequence: string[];
  messageOrderLogic: string[];
  persuasionStrengthScore: number;
  frictionNotes: string[];
  rejectionReason: string | null;
  trustBarriers?: TrustBarrierClassification[];
  objectionProofLinks?: ObjectionProofLink[];
  structuredObjections?: StructuredObjection[];
  readinessAlignment?: {
    stage: string;
    educationFirst: boolean;
    proofRole: string;
  };
  scarcityValidation?: {
    allowed: boolean;
    blockedReasons: string[];
  };
}

export interface DataReliabilityDiagnostics {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  objectionSpecificity: number;
  trustSpecificity: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

export interface PersuasionResult {
  status: string;
  statusMessage: string | null;
  primaryRoute: PersuasionRoute;
  alternativeRoute: PersuasionRoute;
  rejectedRoute: PersuasionRoute;
  layerResults: LayerResult[];
  structuralWarnings: string[];
  boundaryCheck: { passed: boolean; violations: string[]; sanitized?: boolean; sanitizedText?: string; warnings?: string[] };
  dataReliability: DataReliabilityDiagnostics;
  confidenceNormalized: boolean;
  executionTimeMs: number;
  engineVersion: number;
}
