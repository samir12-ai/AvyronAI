import { z } from "zod";
import type { FailedGate } from "../../shared/candidate-gate-battery";
import type { JudgeVerdict } from "../../shared/interchangeability-judge";
import type { ContradictionJudgeVerdict } from "../../shared/contradiction-judge";
import type { EngineDecisionSummary } from "../../shared/strategic-doctrine";

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

export interface AwarenessConstraintResult {
  allowed: boolean;
  blocked: boolean;
  blockReason: string | null;
  channelRole: string | null;
  awarenessStage: string;
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
  autoInjectedConversion: boolean;
  persuasionCorrectionApplied: boolean;
  awarenessConstraintViolation: boolean;
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

export type CorrectionType = "auto_injection" | "persuasion_correction" | "funnel_reassignment";

export interface CorrectionAuditEntry {
  correctionType: CorrectionType;
  timestamp: number;
  engineResponsible: string;
  affectedChannel: string;
  affectedComponent: string;
  detail: string;
}

export interface FunnelStageAssignment {
  channelName: string;
  channelKey: string;
  assignedRole: FunnelRole;
  roleFitScore: number;
  originalPersuasionScore: number;
  wasReconstructed: boolean;
  autoInjectedConversion: boolean;
  injectionReason: string | null;
  injectionStage: FunnelRole | null;
  persuasionCorrectionApplied: boolean;
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

export type ChannelMode = "organic_only" | "paid_only" | "hybrid" | "automatic";

export interface DecisionGateScoring {
  funnelIntegrityScore: number;
  persuasionAlignmentScore: number;
  budgetRealism: number;
  channelScalability: number;
  compositeGateScore: number;
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
  conversionChannelAssigned: boolean;
  channelMode: ChannelMode;
  channelModeReasoning: string | null;
  decisionGateScoring: DecisionGateScoring | null;
  structurallyRepaired: boolean;
  correctionAuditTrail: CorrectionAuditEntry[];
  commercialOrchestration?: import("./channel-orchestration").ChannelOrchestration | null;
  /** viable[1]'s scoring layers — exposed so the AI-proposes wrapper can keep
   *  layerResults correct when it reorders primary/secondary (T15). */
  secondaryLayerResults?: LayerResult[];
  /** Present when runChannelSelectionWithAIProposal ran the gate-validated AI
   *  proposer over this deterministic result (T15). Absent = pure deterministic. */
  aiChannelProposal?: AiChannelProposal;
  /** The validated channel decision summary appended to priorDecisions so
   *  downstream contradiction gates can defend it (T15). */
  channelDecisionSummary?: EngineDecisionSummary;
}

// ---------------------------------------------------------------------------
// AI-Proposes / Code-Validates channel layer (Phase 3 / T15).
// The AI proposes WHICH of the deterministically-viable channels leads plus a
// product-specific rationale; the candidate gate battery (breadth →
// interchangeability(channel_rationale) → contradiction) is the sole judge. The
// deterministic runChannelSelectionEngine pick is the RECORDED fallback.
// ---------------------------------------------------------------------------

// D3 strict enums — no z.string() for decision/verdict-shaped fields.
export const AiChannelProposalModeSchema = z.enum(["ai", "fallback"]);
export type AiChannelProposalMode = z.infer<typeof AiChannelProposalModeSchema>;

export const AiChannelFallbackReasonSchema = z.enum([
  "no_doctrine",
  "insufficient_viable",
  "gates_exhausted",
  "proposer_failed",
]);
export type AiChannelFallbackReason = z.infer<typeof AiChannelFallbackReasonSchema>;

/** One recorded proposer attempt — every attempt (incl. NOT_RUN judge verdicts
 *  and invalid off-whitelist picks) is persisted, never swallowed (B2/B4). */
export interface AiChannelGateAttempt {
  attempt: number;
  proposedPrimary: string;
  /** false when the pick was off-whitelist (no battery run) or a gate rejected it. */
  passed: boolean;
  /** null when passed OR when rejected before the battery (off-whitelist pick). */
  failedGate: FailedGate | null;
  interchangeabilityVerdict: JudgeVerdict;
  contradictionVerdict: ContradictionJudgeVerdict;
  rejectionFeedback: string;
}

export interface AiChannelProposal {
  mode: AiChannelProposalMode;
  /** null when mode==="ai"; a strict reason when mode==="fallback". */
  fallbackReason: AiChannelFallbackReason | null;
  /** The AI's validated primary pick (null on fallback). */
  proposedPrimary: string | null;
  /** Product-specific rationale that survived the battery ("" on fallback). */
  rationale: string;
  /** true when the validated AI pick differs from the deterministic primary. */
  swappedFromDeterministic: boolean;
  attempts: number;
  gateTrace: AiChannelGateAttempt[];
}
