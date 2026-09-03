/**
 * Strategy Adaptation Outcome Evaluator
 * 
 * Constitutional Principle:
 * Empirical before/after validation of executed strategy adaptations:
 * Previous Root (Baseline) -> Adaptive Decision -> New Strategy Root -> Post-change Performance.
 * 
 * Rules:
 * 1. The first post-change observation does NOT conclude success or failure (starts MONITORING).
 * 2. Evaluation requires sufficient observations across the evaluation window.
 * 3. Outcome is scoped to relevant metrics rather than generic global noise.
 * 4. Failed adaptations (DEGRADED) do NOT trigger automatic semantic rollback;
 *    they feed back into Reasoning to diagnose why the change underperformed.
 */

import {
  StrategyAdaptationOutcome,
  AdaptationOutcomeStatus,
  AdaptationOutcomeClassification,
  StrategicAuthorityName,
  ReasoningCase,
} from "./contracts";
import { openReasoningCase } from "./case-coordinator";
import { randomUUID } from "crypto";

export interface InitializeOutcomeParams {
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
  minObservations?: number;
}

/**
 * Initializes a new StrategyAdaptationOutcome record when a strategy change is deployed.
 */
export function initializeAdaptationOutcome(params: InitializeOutcomeParams): StrategyAdaptationOutcome {
  const {
    campaignId,
    accountId,
    adaptiveDecisionId,
    reasoningCaseId,
    previousRootId,
    previousRootVersion,
    newRootId,
    newRootVersion,
    changedAuthorities,
    baselinePerformanceContextIds,
    minObservations = 3,
  } = params;

  return {
    adaptationOutcomeId: `aout_${randomUUID().slice(0, 12)}`,
    campaignId,
    accountId,
    adaptiveDecisionId,
    reasoningCaseId,
    previousRootId,
    previousRootVersion,
    newRootId,
    newRootVersion,
    changedAuthorities,
    baselinePerformanceContextIds,
    postChangePerformanceContextIds: [],
    evaluationWindow: {
      start: new Date().toISOString(),
      minObservations,
    },
    status: baselinePerformanceContextIds.length > 0 ? "MONITORING" : "PENDING_BASELINE",
    outcomeClassification: "PENDING",
    confidence: 0.0,
    evidenceIds: [],
    summary: `Monitoring empirical outcome for Strategy Root v${previousRootVersion} -> v${newRootVersion} transition across [${changedAuthorities.join(", ")}].`,
    createdAt: new Date().toISOString(),
    evaluatedAt: null,
  };
}

export interface PerformanceObservation {
  contextId: string;
  observedAt: string;
  leadVelocity?: number;
  conversionRate?: number;
  confidenceScore?: number;
  bottleneck?: string;
  evidenceIds?: string[];
}

export interface OutcomeEvaluationInput {
  outcome: StrategyAdaptationOutcome;
  baselineObservations: PerformanceObservation[];
  postChangeObservations: PerformanceObservation[];
}

export interface OutcomeEvaluationResult {
  updatedOutcome: StrategyAdaptationOutcome;
  feedbackReasoningCase?: ReasoningCase | null;
}

/**
 * Evaluates the empirical outcome of a strategy adaptation by comparing baseline and post-change performance.
 */
export function evaluateAdaptationOutcome(input: OutcomeEvaluationInput): OutcomeEvaluationResult {
  const { outcome, baselineObservations = [], postChangeObservations = [] } = input;

  const minRequired = outcome.evaluationWindow?.minObservations || 3;
  const postContextIds = postChangeObservations.map(o => o.contextId);
  const evidenceIds = Array.from(new Set(postChangeObservations.flatMap(o => o.evidenceIds || [])));

  // RULE 1: Insufficient observations -> Maintain MONITORING, cannot conclude success or failure
  if (postChangeObservations.length < minRequired) {
    const updatedOutcome: StrategyAdaptationOutcome = {
      ...outcome,
      postChangePerformanceContextIds: postContextIds,
      status: "MONITORING",
      outcomeClassification: "INSUFFICIENT_DATA",
      confidence: 0.3,
      evidenceIds,
      summary: `Observation in progress (${postChangeObservations.length}/${minRequired} required observations). Outcome cannot be determined prematurely.`,
      evaluatedAt: new Date().toISOString(),
    };

    return { updatedOutcome, feedbackReasoningCase: null };
  }

  // Calculate baseline vs post-change average metrics
  const avgBaselineConv = baselineObservations.length > 0
    ? baselineObservations.reduce((acc, o) => acc + (o.conversionRate || 0), 0) / baselineObservations.length
    : 0;

  const avgPostConv = postChangeObservations.reduce((acc, o) => acc + (o.conversionRate || 0), 0) / postChangeObservations.length;

  let classification: AdaptationOutcomeClassification = "NO_MATERIAL_CHANGE";
  let confidence = 0.85;

  const delta = avgPostConv - avgBaselineConv;
  if (delta > 0.05) {
    classification = "IMPROVED";
  } else if (delta < -0.05) {
    classification = "DEGRADED";
  } else {
    classification = "NO_MATERIAL_CHANGE";
  }

  const updatedOutcome: StrategyAdaptationOutcome = {
    ...outcome,
    postChangePerformanceContextIds: postContextIds,
    status: "EVALUATED",
    outcomeClassification: classification,
    confidence,
    evidenceIds,
    summary: `Adaptation evaluated: ${classification} (baseline avg conv: ${avgBaselineConv.toFixed(2)}, post-change avg conv: ${avgPostConv.toFixed(2)}).`,
    evaluatedAt: new Date().toISOString(),
  };

  // RULE 4: If DEGRADED -> Feed back into Reasoning to diagnose why the change underperformed
  let feedbackReasoningCase: ReasoningCase | null = null;
  if (classification === "DEGRADED") {
    feedbackReasoningCase = openReasoningCase({
      accountId: outcome.accountId,
      campaignId: outcome.campaignId,
      strategyRootId: outcome.newRootId,
      strategyRootVersion: outcome.newRootVersion,
      marketSignals: [],
      performanceSignals: [],
      reasoningVersion: "1.0.0",
      metadata: {
        trigger: "ADAPTATION_OUTCOME_DEGRADED",
        adaptationOutcomeId: outcome.adaptationOutcomeId,
        previousRootVersion: outcome.previousRootVersion,
        newRootVersion: outcome.newRootVersion,
        changedAuthorities: outcome.changedAuthorities,
        deltaConv: delta,
      },
    });
  }

  return { updatedOutcome, feedbackReasoningCase };
}
