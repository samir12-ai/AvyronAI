/**
 * Canonical Contracts for Avyron Adaptive Intelligence Foundation (Phase 0 & Phase 1)
 * 
 * Constitutional Principle:
 * ONE ENTITY -> ONE OWNER -> ONE CANONICAL CONTRACT -> ONE ID NAMESPACE -> ONE PERSISTED LINEAGE
 * TEXT CARRIES MEANING. IDS CARRY IDENTITY.
 */

// ============================================================================
// 1. CANONICAL STRATEGIC AUTHORITIES
// ============================================================================

export type StrategicAuthorityName =
  | "BUSINESS_UNDERSTANDING"
  | "PRODUCT_ASSESSMENT"
  | "TARGET_ASSESSMENT"
  | "AUDIENCE"
  | "STRATEGIC_PAIN_DECISION"
  | "STRATEGIC_LANES"
  | "POSITIONING"
  | "DIFFERENTIATION"
  | "MECHANISM"
  | "OFFER"
  | "AWARENESS"
  | "FUNNEL"
  | "PERSUASION"
  | "CHANNEL_SELECTION"
  | "BUDGET_GOVERNOR"
  | "INTEGRITY"
  | "STRATEGY_ROOT"
  | "PLAN_SYNTHESIS"
  | "EXECUTION_TASKS";

// ============================================================================
// 2. NORMALIZED ADAPTIVE SIGNAL CONTRACT
// ============================================================================

export type AdaptiveSignalDomain = "MARKET" | "PERFORMANCE";
export type AdaptiveSignalSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type WatchtowerConfirmationState =
  | "PRELIMINARY"    // First observation / open candidate
  | "CONFIRMED"      // Two-fetch confirmed market event
  | "CONTRADICTED"   // Reverted / contradicted by subsequent fetch
  | "CLOSED"         // Closed or archived
  | "EXPIRED"        // Candidate expired without confirmation
  | "REVERTED";      // Market state returned to original baseline

/**
 * Normalized transport interface for Market Events and Performance Warnings.
 * 
 * Note on Watchtower Confirmation:
 * - PRELIMINARY signals cannot trigger strategy invalidation.
 * - CONFIRMED signals carry authoritative market change confirmation.
 * 
 * Note on Performance Warnings:
 * - performance_contexts is a container / state representing one measured business execution window.
 * - Each specific derived performance warning becomes an individual AdaptiveSignal.
 */
export interface AdaptiveSignal {
  signalId: string;
  campaignId: string;
  accountId: string;
  sourceDomain: AdaptiveSignalDomain;
  sourceArtifactId: string; // References parent eventId or performanceContextId container
  entityIds: string[];
  competitorId?: string | null;
  evidenceIds: string[];
  signalType: string;
  summary: string;
  severity: AdaptiveSignalSeverity;
  confidence: number;
  confirmationState?: WatchtowerConfirmationState; // For MARKET signals
  observedAt: string; // ISO 8601
  createdAt: string;  // ISO 8601
  metadata?: Record<string, any>;
}

// ============================================================================
// 3. REASONING CASE & HYPOTHESIS CONTRACT
// ============================================================================

export type ReasoningCaseStatus =
  | "OPEN"
  | "ANALYZING"
  | "EVALUATED"
  | "RESOLVED"
  | "CLOSED"
  | "INSUFFICIENT_EVIDENCE";

export type HypothesisStatus =
  | "PROPOSED"
  | "VALIDATED"
  | "REJECTED"
  | "INCONCLUSIVE";

export interface ReasoningHypothesis {
  hypothesisId: string;
  reasoningCaseId: string;
  hypothesisType: string;
  explanation: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  alternativeCauseIds: string[];
  confidence: number;
  status: HypothesisStatus;
  metadata?: Record<string, any>;
}

/**
 * ReasoningCase represents the causal diagnosis container owned by AdaptiveReasoningEngine.
 * Reasoning owns DIAGNOSIS. It does NOT own orchestration actions or replacement strategy.
 */
export interface ReasoningCase {
  reasoningCaseId: string;
  accountId: string;
  campaignId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  marketEventIds: string[];
  performanceWarningIds: string[]; // List of specific AdaptiveSignal.signalIds
  marketSignalIds?: string[];
  performanceSignalIds?: string[];
  evidenceIds: string[];
  status: ReasoningCaseStatus;
  openedAt: string;
  resolvedAt?: string | null;
  reasoningVersion: string;
  hypotheses?: ReasoningHypothesis[];
  candidateAffectedAuthorities?: StrategicAuthorityName[];
  candidateAffectedLaneIds?: string[];
  metadata?: Record<string, any>;
}

// ============================================================================
// 4. ADAPTIVE DECISION CONTRACT
// ============================================================================

export type AdaptiveDecisionType =
  | "OBSERVE"
  | "EXECUTION_RESPONSE"
  | "REEVALUATE_AUTHORITY"
  | "STRATEGY_CHANGE_REQUIRED"
  | "STRATEGIC_REBUILD_REQUIRED"
  | "INSUFFICIENT_EVIDENCE";

/**
 * AdaptiveDecision represents the structured system action owned by the AdaptiveRouter.
 * The Router decides WHAT needs attention based on validated reasoning; owning engines decide replacement truth.
 */
export interface AdaptiveDecision {
  adaptiveDecisionId: string;
  reasoningCaseId: string;
  campaignId: string;
  accountId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  decisionType: AdaptiveDecisionType;
  affectedAuthority?: StrategicAuthorityName | null;
  affectedLaneIds?: string[];
  affectedEntityIds: string[];
  evidenceIds: string[];
  confidence: number;
  rationale: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// 5. STRATEGY ADAPTATION LINEAGE & OUTCOME
// ============================================================================

export interface StrategyAdaptationLineage {
  id: string;
  campaignId: string;
  accountId: string;
  previousRootId: string;
  previousRootVersion: number;
  newRootId: string;
  newRootVersion: number;
  triggerReasoningCaseId?: string | null;
  triggerAdaptiveDecisionId?: string | null;
  changedAuthorities: StrategicAuthorityName[];
  preservedAuthorities: StrategicAuthorityName[];
  sourceEventIds: string[];
  sourcePerformanceWarningIds: string[];
  evidenceIds: string[];
  createdAt: string;
}

export type AdaptationOutcomeStatus =
  | "PENDING_BASELINE"
  | "MONITORING"
  | "EVALUATED"
  | "CLOSED";

export type AdaptationOutcomeClassification =
  | "PENDING"
  | "IMPROVED"
  | "NO_MATERIAL_CHANGE"
  | "DEGRADED"
  | "INCONCLUSIVE"
  | "INSUFFICIENT_DATA";

/**
 * StrategyAdaptationOutcome tracks the empirical before/after validation
 * of an executed strategy change without creating automatic post-hoc certainty.
 */
export interface StrategyAdaptationOutcome {
  adaptationOutcomeId: string;
  campaignId: string;
  accountId: string;
  adaptiveDecisionId: string;
  reasoningCaseId: string;
  previousRootId: string;
  previousRootVersion: number;
  newRootId: string;
  newRootVersion: number;
  changedAuthorities: StrategicAuthorityName[];
  baselinePerformanceContextIds: string[];
  postChangePerformanceContextIds: string[];
  evaluationWindow?: {
    start: string;
    end?: string;
    minObservations: number;
  };
  status: AdaptationOutcomeStatus;
  outcomeClassification: AdaptationOutcomeClassification;
  confidence: number;
  evidenceIds: string[];
  summary?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  evaluatedAt?: string | null;
}

// ============================================================================
// 6. FUTURE EXECUTION SIGNAL CONTRACT
// ============================================================================

export type ExecutionSignalAction =
  | "KEEP_TASK"
  | "REFRESH_TASK"
  | "CANCEL_TASK"
  | "CREATE_TASK"
  | "PAUSE_TASK";

export type ExecutionSignalPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ExecutionSignal {
  executionSignalId: string;
  campaignId: string;
  accountId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  sourceDecisionId?: string | null;
  sourceReasoningCaseId?: string | null;
  sourceEventIds: string[];
  sourcePerformanceWarningIds: string[];
  affectedLaneIds: string[];
  affectedStrategyAuthorities: StrategicAuthorityName[];
  actionType: ExecutionSignalAction;
  priority: ExecutionSignalPriority;
  createdAt: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// 7. COMPETITOR SOURCE & EVIDENCE CONTRACTS
// ============================================================================

export type CompetitorSourcePlatform =
  | "WEBSITE"
  | "LINKEDIN"
  | "X"
  | "INSTAGRAM"
  | "TIKTOK"
  | "YOUTUBE"
  | "GOOGLE"
  | "TRUSTPILOT"
  | "OTHER";

export type CompetitorSourceStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "PENDING_VERIFICATION"
  | "BLOCKED"
  | "DEAD";

export interface CompetitorSource {
  sourceId: string;
  competitorId: string;
  campaignId: string;
  accountId: string;
  platform: CompetitorSourcePlatform;
  canonicalUrl: string;
  externalAccountId?: string | null;
  status: CompetitorSourceStatus;
  lastVerifiedAt?: string | null;
  lastFetchedAt?: string | null;
  activityState?: "ACTIVE" | "DORMANT" | "UNKNOWN";
  metadata?: Record<string, any>;
}

export type EvidenceItemContentType =
  | "POST"
  | "COMMENT"
  | "REVIEW"
  | "WEBSITE_PAGE"
  | "AD"
  | "METRIC"
  | "OTHER";

export interface EvidenceItem {
  evidenceId: string;
  campaignId: string;
  accountId: string;
  competitorId?: string | null;
  sourceId: string;
  snapshotId?: string | null;
  sourceType: string;
  contentType: EvidenceItemContentType;
  sourceUrl: string;
  rawText: string;
  normalizedText: string;
  publishedAt?: string | null;
  capturedAt: string;
  classificationId?: string | null;
  metadata?: Record<string, any>;
}

// ============================================================================
// 8. STANDARD AUTHORITY ENVELOPE
// ============================================================================

export interface AuthorityEnvelope<T> {
  authorityType: StrategicAuthorityName | string;
  artifactId: string;
  campaignId: string;
  accountId: string;
  runId?: string | null;
  strategyRootId?: string | null;
  strategyRootVersion?: number | null;
  entityIds: string[];
  evidenceIds: string[];
  generatedAt: string;
  payload: T;
  envelopeVersion: string;
}

// ============================================================================
// 9. STRATEGY RECOMPUTE JOB CONTRACT
// ============================================================================

export type RecomputeJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type RecomputeJobResult = "PENDING" | "NO_CHANGE_REQUIRED" | "CHANGED" | "INCOMPLETE" | "FAILED";

export interface StrategyRecomputeJob {
  recomputeJobId: string;
  accountId: string;
  campaignId: string;
  sourceRootId: string;
  sourceRootVersion: number;
  adaptiveDecisionId: string;
  reasoningCaseId?: string | null;
  authority: StrategicAuthorityName;
  sourceArtifactId: string;
  outputArtifactId?: string | null;
  status: RecomputeJobStatus;
  result: RecomputeJobResult;
  evidenceIds: string[];
  summary?: string | null;
  metadata?: Record<string, any>;
  startedAt: string;
  completedAt?: string | null;
}

