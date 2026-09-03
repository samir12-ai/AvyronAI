export interface StructuredObjection {
  objectionId?: string;
  objectionStatement: string;
  objectionTrigger: string;
  objectionStage: "awareness" | "consideration" | "decision";
  objectionType: "trust" | "feasibility" | "cost" | "complexity" | "timing";
  requiredProofType: string;
  persuasionResponse: string;
  source: "audience_objection" | "narrative_extraction" | "pain_inference";
  proofStatus?: "PROOF_ESTABLISHED" | "PROOF_TO_BUILD";
  confidence: number;
  rootCause?: string;
  userThinking?: string;
  resolution?: string;
  causalChainAlignment?: string;
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
  multiSourceSignals?: any;
  sourceAvailability?: any;
}

export interface PersuasionAudienceInput {
  objectionMap: Record<string, any>;
  emotionalDrivers: any[];
  maturityIndex: number | null;
  awarenessLevel: string | null;
  audiencePains: any[];
  desireMap: Record<string, any>;
  audienceSegments: any[];
  laneId?: string;
  laneContext?: any;
  /**
   * Authoritative pain registry from the orchestrator run context (Task 163).
   * Optional — legacy `audiencePains` stays untouched as the raw input; the
   * registry is the validated routing layer (classification + allowedUses).
   */
  painRegistry?: any[];
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
  lockedDecisions?: string[];
  nonGenericAnchors?: string[];
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

export interface AwarenessStageProperty {
  propertyType: string;
  readinessStage: string;
  description: string;
  handlingLayer: string;
}

export interface AutoCorrection {
  wasApplied: boolean;
  originalMode: string;
  correctedMode: string;
  correctionReason: string;
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

export type CialdiniPrinciple =
  | "reciprocity"
  | "commitment_consistency"
  | "social_proof"
  | "authority"
  | "liking"
  | "scarcity"
  | "unity";

export interface CialdiniReasoning {
  primaryCialdiniPrinciple: CialdiniPrinciple;
  principleRationale: string;
  buyerPsychologyFit: string;
  whyOthersFail: Array<{ principle: CialdiniPrinciple; whyItWouldFail: string }>;
  groundedSignals: string[];
  reasoningSteps: string[];
  rootCauseRefs: string[];
  audienceSophisticationTier?: number;
  modelUsed: string;
  generatedAt: string;
  /**
   * When present, this principle was selected as a *consequence* of the upstream
   * Trust Transfer Design (the marketing-logic core), not as a standalone label.
   */
  groundedInTrustMechanism?: string;
  _system_validation?: import("../shared/llm-reliability/types").SystemValidationFlag;
}

export type RiskSeverity = "low" | "moderate" | "high" | "critical";

/**
 * Trust Transfer Design — the commercial-reasoning output produced BEFORE
 * Cialdini selection. Answers "what is this doing commercially?" by naming
 * the buyer's risk state, current trust source, the deficit, the bridging
 * mechanism, and the failure modes if a wrong mechanism were chosen.
 *
 * Cialdini selection becomes a downstream consequence of this design,
 * not the primary classification.
 */
export interface TrustTransferDesign {
  buyerRiskState: string;
  riskSeverity: RiskSeverity;
  currentTrustSources: string[];
  trustDeficit: string;
  transferMechanism: {
    name: string;
    description: string;
    proofArtifact: string;
  };
  failureModes: Array<{ mechanism: string; whyItWouldFail: string }>;
  requiredProofShape: string;
  commercialFunction: string;
  groundedSignals: string[];
  reasoningSteps: string[];
  judgeVerdict: "ACCEPTED" | "REJECTED" | "NOT_RUN";
  judgeReason?: string;
  retryCount: number;
  modelUsed: string;
  generatedAt: string;
  _system_validation?: import("../shared/llm-reliability/types").SystemValidationFlag;
}

export interface PersuasionRoute {
  routeName: string;
  persuasionMode: string;
  primaryInfluenceDrivers: string[];
  /** T005: structured objection — { tag:{category,awarenessStage}, objection:{canonical,frequency,evidence,confidence} }.
   *  Strings are accepted for legacy downstream compat. */
  objectionPriorities: Array<string | {
    tag: { category: string; awarenessStage: string };
    objection: { canonical: string; frequency: number | null; evidence: string[]; confidence: number | null };
  }>;
  trustSequence: string[];
  messageOrderLogic: string[];
  persuasionStrengthScore: number;
  frictionNotes: string[];
  rejectionReason: string | null;
  cialdiniReasoning?: CialdiniReasoning;
  /**
   * Marketing-logic core — designs the commercial trust-transfer mechanism
   * before any Cialdini label is picked. See TrustTransferDesign.
   */
  trustTransferDesign?: TrustTransferDesign;
  trustBarriers?: TrustBarrierClassification[];
  awarenessStageProperties?: AwarenessStageProperty[];
  objectionProofLinks?: ObjectionProofLink[];
  structuredObjections?: StructuredObjection[];
  readinessAlignment?: {
    stage: string;
    educationFirst: boolean;
    proofRole: string;
    hardCtaBlocked?: boolean;
    commitmentDisabled?: boolean;
    blockedTactics?: string[];
    entryMode?: string;
    controlledPersuasion?: {
      microTension: boolean;
      progressiveCuriosity: boolean;
      contrastFraming: boolean;
      pressureLevel: string;
    };
    pressureCalibration?: {
      level: string;
      strategy: string;
      progression: string;
    };
  };
  scarcityValidation?: {
    allowed: boolean;
    blockedReasons: string[];
  };
  laneId?: string;
  primaryCorePainId?: string;
  segmentIds?: string[];
  funnelSnapshotId?: string;
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
  laneId?: string;
  primaryCorePainId?: string;
  segmentIds?: string[];
  funnelSnapshotId?: string;
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
  autoCorrection?: AutoCorrection;
  strategyAcceptability?: import("../shared/strategy-acceptability").StrategyAcceptability;
}
