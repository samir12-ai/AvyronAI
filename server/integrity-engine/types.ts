export interface IntegrityPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
  confidenceScore: number | null;
}

export interface IntegrityDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface IntegrityAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface IntegrityOfferInput {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  offerStrengthScore: number;
  riskNotes: string[];
  completeness: { complete: boolean; missingLayers: string[] };
  genericFlag: boolean;
  frictionLevel: number;
}

export interface IntegrityFunnelInput {
  funnelName: string;
  funnelType: string;
  stageMap: any[];
  trustPath: any[];
  proofPlacements: any[];
  commitmentLevel: string;
  frictionMap: any[];
  entryTrigger: { mechanismType: string; purpose: string };
  funnelStrengthScore: number;
  compressionApplied: boolean;
}

export interface IntegrityMIInput {
  marketDiagnosis: string | null;
  overallConfidence: number;
  opportunitySignals: any[];
  threatSignals: any[];
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

export interface IntegrityResult {
  status: string;
  statusMessage: string | null;
  overallIntegrityScore: number;
  safeToExecute: boolean;
  layerResults: LayerResult[];
  structuralWarnings: string[];
  flaggedInconsistencies: string[];
  boundaryCheck: { passed: boolean; violations: string[] };
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
}
