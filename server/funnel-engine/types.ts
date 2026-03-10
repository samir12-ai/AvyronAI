export interface FunnelMIInput {
  dominanceData: any;
  contentDnaData: any;
  marketDiagnosis: string | null;
  opportunitySignals: any[];
  threatSignals: any[];
}

export interface FunnelAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
}

export interface FunnelOfferInput {
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

export interface FunnelPositioningInput {
  territories: any[];
  enemyDefinition: string | null;
  contrastAxis: string | null;
  narrativeDirection: string | null;
}

export interface FunnelDifferentiationInput {
  pillars: any[];
  mechanismFraming: any;
  authorityMode: string | null;
  claimStructures: any[];
  proofArchitecture: any[];
  confidenceScore: number | null;
}

export interface EntryTrigger {
  mechanismType: string;
  purpose: string;
}

export interface FunnelCandidate {
  funnelName: string;
  funnelType: string;
  stageMap: FunnelStage[];
  trustPath: TrustPathStep[];
  proofPlacements: ProofPlacement[];
  commitmentLevel: string;
  frictionMap: FrictionPoint[];
  entryTrigger: EntryTrigger;
  funnelStrengthScore: number;
  eligibilityScore: number;
  offerFitScore: number;
  audienceFrictionScore: number;
  trustPathScore: number;
  proofPlacementScore: number;
  commitmentMatchScore: number;
  integrityResult: { passed: boolean; failures: string[] };
  compressionApplied: boolean;
  genericFlag: boolean;
}

export interface FunnelStage {
  name: string;
  purpose: string;
  contentType: string;
  conversionGoal: string;
}

export interface TrustPathStep {
  step: number;
  action: string;
  proofType: string;
  audienceState: string;
}

export interface ProofPlacement {
  stage: string;
  proofType: string;
  placement: string;
  purpose: string;
}

export interface FrictionPoint {
  stage: string;
  frictionType: string;
  severity: number;
  mitigation: string;
}

export interface FunnelResult {
  status: string;
  statusMessage: string | null;
  primaryFunnel: FunnelCandidate;
  alternativeFunnel: FunnelCandidate;
  rejectedFunnel: { funnel: FunnelCandidate; rejectionReason: string };
  funnelStrengthScore: number;
  trustPathAnalysis: { score: number; steps: number; gaps: string[] };
  proofPlacementLogic: { score: number; placements: number; missingPlacements: string[] };
  frictionMap: { totalFriction: number; criticalPoints: number; mitigations: number };
  boundaryCheck: { passed: boolean; violations: string[] };
  structuralWarnings: string[];
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  layerDiagnostics: Record<string, any>;
}
