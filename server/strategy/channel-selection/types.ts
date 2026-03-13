export interface ChannelAudienceInput {
  audienceSegments: any[];
  emotionalDrivers: any[];
  awarenessLevel: string | null;
  maturityIndex: number | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  objectionMap: Record<string, any>;
}

export interface ChannelAwarenessInput {
  entryMechanismType: string;
  targetReadinessStage: string;
  triggerClass: string;
  trustRequirement: string;
  funnelCompatibility: string;
  awarenessStrengthScore: number;
  frictionNotes: string[];
}

export interface ChannelPersuasionInput {
  persuasionMode: string;
  primaryInfluenceDrivers: string[];
  objectionPriorities: string[];
  trustSequence: string[];
  persuasionStrengthScore: number;
}

export interface ChannelOfferInput {
  offerName: string;
  coreOutcome: string;
  offerStrengthScore: number;
  frictionLevel: number;
  deliverables: string[];
  riskNotes: string[];
}

export interface ChannelBudgetInput {
  testBudgetMin: number;
  testBudgetMax: number;
  scaleBudgetMin: number;
  scaleBudgetMax: number;
  expansionPermission: boolean;
  killFlag: boolean;
}

export interface ChannelValidationInput {
  claimConfidenceScore: number;
  evidenceStrength: number;
  validationState: string;
  assumptionFlags: string[];
}

export interface ObjectiveFitScores {
  awarenessFit: number;
  nurtureFit: number;
  conversionFit: number;
}

export interface ChannelDifferentiation {
  audienceDiscoveryDynamics: string;
  contentVelocityRequirement: string;
  algorithmAmplification: string;
  conversionLikelihood: string;
}

export type DecisionGateOutcome = "recommended" | "support_channel" | "exploratory";

export interface DecisionGateResult {
  outcome: DecisionGateOutcome;
  reason: string;
  violations: string[];
}

export interface ChannelCandidate {
  channelName: string;
  channelType: "social_organic" | "social_paid" | "search_paid" | "search_organic" | "email" | "referral" | "direct" | "community" | "partnerships" | "content_platform";
  fitScore: number;
  audienceDensityScore: number;
  persuasionCompatibility: number;
  costEfficiency: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  riskNotes: string[];
  rejectionReason: string | null;
  estimatedCac: number | null;
  recommendedBudgetAllocation: number;
  objectiveFit: ObjectiveFitScores;
  decisionGate: DecisionGateResult;
  differentiation: ChannelDifferentiation | null;
  assignedFunnelRole: FunnelRole | null;
  wasReconstructed: boolean;
}

export interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
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

export type FunnelRole = "awareness" | "nurture" | "conversion";

export interface FunnelStageAssignment {
  channelName: string;
  channelKey: string;
  assignedRole: FunnelRole;
  roleFitScore: number;
  originalPersuasionScore: number;
  wasReconstructed: boolean;
  reasoning: string;
}

export interface FunnelReconstructionResult {
  reconstructed: boolean;
  funnelStages: {
    awareness: FunnelStageAssignment[];
    nurture: FunnelStageAssignment[];
    conversion: FunnelStageAssignment[];
  };
  reconstructionLog: string[];
  channelsRescued: number;
  channelsStillRejected: number;
}

export interface ChannelSelectionResult {
  status: string;
  statusMessage: string | null;
  primaryChannel: ChannelCandidate;
  secondaryChannel: ChannelCandidate;
  rejectedChannels: ChannelCandidate[];
  channelFitScore: number;
  channelRiskNotes: string[];
  layerResults: LayerResult[];
  structuralWarnings: string[];
  boundaryCheck: { passed: boolean; violations: string[]; sanitized?: boolean; sanitizedText?: string; warnings?: string[] };
  dataReliability: DataReliabilityDiagnostics;
  confidenceScore: number;
  executionTimeMs: number;
  engineVersion: number;
  funnelReconstruction: FunnelReconstructionResult | null;
}
