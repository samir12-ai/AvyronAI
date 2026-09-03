/**
 * Adaptive Router Service & Decision Boundary
 * 
 * Constitutional Principle:
 * REASONER owns DIAGNOSIS (Hypotheses, Causal Analysis, Candidate Impact).
 * ADAPTIVE ROUTER owns the structured orchestration action (AdaptiveDecision).
 * OWNING STRATEGY ENGINES own the replacement canonical truth.
 * 
 * Response Ladder (Smallest Response Principle):
 * Level 0 — OBSERVE (No action yet)
 * Level 1 — EXECUTION_RESPONSE (Execution-only / distribution adjustment for What To Do Today)
 * Level 2 — REEVALUATE_AUTHORITY (Targeted strategic engine reconsideration)
 * Level 3 — STRATEGY_CHANGE_REQUIRED (Confirmed multi-point strategy invalidation)
 * Level 4 — STRATEGIC_REBUILD_REQUIRED (Fundamental upstream truth invalidation)
 * 
 * Watchtower Gate:
 * PRELIMINARY Watchtower candidate events cannot trigger STRATEGY_CHANGE_REQUIRED or STRATEGIC_REBUILD_REQUIRED.
 */

import {
  AdaptiveDecision,
  AdaptiveDecisionType,
  AdaptiveSignal,
  ReasoningCase,
  StrategicAuthorityName,
} from "./contracts";
import { getAuthorityDefinition, isValidAuthorityName } from "./authority-registry";
import { validateAdaptiveDecision } from "./lineage";
import { ReasoningJudgeVerdict } from "./reasoning-judge";
import { randomUUID } from "crypto";

export interface RouterInput {
  reasoningCase: ReasoningCase;
  judgeVerdict: ReasoningJudgeVerdict;
  marketSignals?: AdaptiveSignal[];
  performanceSignals?: AdaptiveSignal[];
  campaignId: string;
  accountId: string;
  governanceConstraints?: {
    freezeStrategicCore?: boolean;
    maxRecomputeDepth?: number;
  };
}

/**
 * Evaluates a validated reasoning case and produces a canonical AdaptiveDecision.
 */
export function routeAdaptiveDecision(input: RouterInput): AdaptiveDecision {
  const {
    reasoningCase,
    judgeVerdict,
    marketSignals = [],
    performanceSignals = [],
    campaignId,
    accountId,
  } = input;

  // 1. Fail closed on rejected verdict or insufficient evidence
  if (
    judgeVerdict.status === "INSUFFICIENT_EVIDENCE" ||
    reasoningCase.status === "INSUFFICIENT_EVIDENCE" ||
    judgeVerdict.confidence < 0.5
  ) {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: `adec_${randomUUID().slice(0, 12)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      campaignId,
      accountId,
      strategyRootId: reasoningCase.strategyRootId,
      strategyRootVersion: reasoningCase.strategyRootVersion,
      decisionType: "INSUFFICIENT_EVIDENCE",
      affectedAuthority: null,
      affectedLaneIds: [],
      affectedEntityIds: [],
      evidenceIds: reasoningCase.evidenceIds,
      confidence: judgeVerdict.confidence,
      rationale:
        judgeVerdict.rationale ||
        "Evidence insufficient or confidence below operational threshold. No strategy mutation allowed.",
      createdAt: new Date().toISOString(),
    };
    validateAdaptiveDecision(decision);
    return decision;
  }

  if (judgeVerdict.status === "REJECTED") {
    const decision: AdaptiveDecision = {
      adaptiveDecisionId: `adec_${randomUUID().slice(0, 12)}`,
      reasoningCaseId: reasoningCase.reasoningCaseId,
      campaignId,
      accountId,
      strategyRootId: reasoningCase.strategyRootId,
      strategyRootVersion: reasoningCase.strategyRootVersion,
      decisionType: "OBSERVE",
      affectedAuthority: null,
      affectedLaneIds: [],
      affectedEntityIds: [],
      evidenceIds: reasoningCase.evidenceIds,
      confidence: judgeVerdict.confidence,
      rationale: `Diagnosis rejected by Reasoning Judge: ${(judgeVerdict.violations || []).join("; ")}. Maintaining observation.`,
      createdAt: new Date().toISOString(),
    };
    validateAdaptiveDecision(decision);
    return decision;
  }

  // 2. Evaluate Market Confirmation Gate
  const hasPreliminaryMarketEvent = marketSignals.some(s => s.confirmationState === "PRELIMINARY");
  const hasConfirmedMarketEvent = marketSignals.some(s => s.confirmationState === "CONFIRMED");
  const isPerformanceOnly = performanceSignals.length > 0 && marketSignals.length === 0;

  // 3. Resolve Candidate Authority from Validated Hypotheses
  const candidateAuthorities = reasoningCase.candidateAffectedAuthorities || [];
  let primaryAffectedAuthority: StrategicAuthorityName | null = null;

  if (candidateAuthorities.length > 0) {
    const validCandidate = candidateAuthorities.find(isValidAuthorityName);
    if (validCandidate) {
      primaryAffectedAuthority = validCandidate;
    }
  }

  // 4. Apply Response Ladder & Smallest Response Principle
  let decisionType: AdaptiveDecisionType = "OBSERVE";

  if (hasPreliminaryMarketEvent && !hasConfirmedMarketEvent) {
    // WATCHTOWER GATE: Preliminary unconfirmed events CANNOT trigger strategy change
    // Smallest response: OBSERVE or EXECUTION_RESPONSE
    if (performanceSignals.length > 0) {
      decisionType = "EXECUTION_RESPONSE";
      primaryAffectedAuthority = null; // Do not invalidate strategic authority
    } else {
      decisionType = "OBSERVE";
      primaryAffectedAuthority = null;
    }
  } else if (isPerformanceOnly) {
    // PERFORMANCE ONLY: Performance drop alone does not invalidate strategic core
    // Defaults to EXECUTION_RESPONSE unless multi-point structural failure is established
    decisionType = "EXECUTION_RESPONSE";
    primaryAffectedAuthority = "PLAN_SYNTHESIS"; // Execution cadence review
  } else if (hasConfirmedMarketEvent && primaryAffectedAuthority) {
    // CONFIRMED MARKET EVENT with verified strategic impact
    const def = getAuthorityDefinition(primaryAffectedAuthority);
    if (def.supportsTargetedRecompute) {
      decisionType = "REEVALUATE_AUTHORITY";
    } else {
      decisionType = "STRATEGY_CHANGE_REQUIRED";
    }
  } else if (primaryAffectedAuthority) {
    decisionType = "REEVALUATE_AUTHORITY";
  } else {
    decisionType = "OBSERVE";
  }

  const candidateLaneIds: string[] = reasoningCase.candidateAffectedLaneIds || (reasoningCase.metadata?.candidateAffectedLaneIds as string[]) || [];
  const distinctLaneIds = Array.from(new Set(candidateLaneIds));

  const decision: AdaptiveDecision = {
    adaptiveDecisionId: `adec_${randomUUID().slice(0, 12)}`,
    reasoningCaseId: reasoningCase.reasoningCaseId,
    campaignId,
    accountId,
    strategyRootId: reasoningCase.strategyRootId,
    strategyRootVersion: reasoningCase.strategyRootVersion,
    decisionType,
    affectedAuthority: primaryAffectedAuthority,
    affectedLaneIds: distinctLaneIds,
    affectedEntityIds: distinctLaneIds,
    evidenceIds: reasoningCase.evidenceIds,
    confidence: judgeVerdict.confidence,
    rationale:
      judgeVerdict.rationale ||
      `Adaptive Router determined action ${decisionType} for authority ${primaryAffectedAuthority || "(none)"}${distinctLaneIds.length > 0 ? ` on lane(s) [${distinctLaneIds.join(", ")}]` : ""}.`,
    createdAt: new Date().toISOString(),
    metadata: {
      laneScope: distinctLaneIds.length > 0 ? "RESOLVED" : "GLOBAL_OR_UNRESOLVED",
      affectedLaneIds: distinctLaneIds,
    },
  };

  validateAdaptiveDecision(decision);
  return decision;
}
