export interface AwarenessPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
  confidenceScore: number | null;
}

export interface AwarenessDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface AwarenessAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface AwarenessOfferInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  offerStrengthScore: number;
  riskNotes: string[];
  frictionLevel: number;
}

export interface AwarenessFunnelInput {
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

export interface AwarenessIntegrityInput {
  overallIntegrityScore: number;
  safeToExecute: boolean;
  layerResults: any[];
  structuralWarnings: string[];
  flaggedInconsistencies: string[];
}

export interface AwarenessMIInput {
  marketDiagnosis: string | null;
  overallConfidence: number;
  opportunitySignals: any[];
  threatSignals: any[];
  narrativeObjectionCount: number;
  narrativeObjectionDensity: number;
  multiSourceSignals?: any;
  sourceAvailability?: any;
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

export interface AwarenessRoute {
  routeName: string;
  entryMechanismType: string;
  targetReadinessStage: string;
  triggerClass: string;
  trustRequirement: string;
  funnelCompatibility: string;
  awarenessStrengthScore: number;
  frictionNotes: string[];
  rejectionReason: string | null;
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

export interface AwarenessResult {
  status: string;
  statusMessage: string | null;
  primaryRoute: AwarenessRoute;
  alternativeRoute: AwarenessRoute;
  rejectedRoute: AwarenessRoute;
  layerResults: LayerResult[];
  structuralWarnings: string[];
  boundaryCheck: { passed: boolean; violations: string[]; sanitized?: boolean; sanitizedText?: string; warnings?: string[] };
  dataReliability: DataReliabilityDiagnostics;
  confidenceNormalized: boolean;
  executionTimeMs: number;
  engineVersion: number;
}
