import type { CrossSignalDecision, DecisionType, DecisionConfidenceLevel } from "../market-intelligence-v3/cross-signal-decision";

export const DECISION_CONFIDENCE_THRESHOLDS = {
  MEMORY_WRITE_MIN: 0.65,
  PLAN_INCLUSION_MIN: 0.5,
  AGENT_ACTION_MIN: 0.5,
  PROVISIONAL_WRITE_PERIODS_REQUIRED: 2,
  FALLBACK_SOURCE_PENALTY: 0.15,
  FALLBACK_SOURCE_MIN_FLOOR: 0.2,
} as const;

export type AllowedAction =
  | "UPDATE_MESSAGING"
  | "UPDATE_OBJECTION_HANDLING"
  | "INJECT_CONTENT_STRATEGY"
  | "MODIFY_POSITIONING"
  | "MODIFY_CTA_FRAMING"
  | "BLOCK_FROM_PLAN"
  | "DEPRIORITIZE";

export interface DecisionActionPolicy {
  type: DecisionType;
  allowedActions: AllowedAction[];
  planEligible: boolean;
  memoryEligible: boolean;
  minConfidenceLevel: DecisionConfidenceLevel;
  description: string;
}

export const DECISION_ACTION_POLICIES: Record<DecisionType, DecisionActionPolicy> = {
  VALIDATED_PAIN: {
    type: "VALIDATED_PAIN",
    allowedActions: ["UPDATE_MESSAGING", "UPDATE_OBJECTION_HANDLING"],
    planEligible: true,
    memoryEligible: true,
    minConfidenceLevel: "MEDIUM",
    description: "Validated pain updates messaging and objection handling",
  },
  VALIDATED_HOOK: {
    type: "VALIDATED_HOOK",
    allowedActions: ["INJECT_CONTENT_STRATEGY"],
    planEligible: true,
    memoryEligible: true,
    minConfidenceLevel: "MEDIUM",
    description: "Validated hooks are injected into content strategy",
  },
  CONFIRMED_OBJECTION: {
    type: "CONFIRMED_OBJECTION",
    allowedActions: ["MODIFY_POSITIONING", "MODIFY_CTA_FRAMING"],
    planEligible: true,
    memoryEligible: true,
    minConfidenceLevel: "MEDIUM",
    description: "Confirmed objections modify positioning and CTA framing",
  },
  CONFLICTED_SIGNAL: {
    type: "CONFLICTED_SIGNAL",
    allowedActions: ["BLOCK_FROM_PLAN"],
    planEligible: false,
    memoryEligible: false,
    minConfidenceLevel: "HIGH",
    description: "Conflicted signals are blocked from plan and memory usage",
  },
  WEAK_SIGNAL: {
    type: "WEAK_SIGNAL",
    allowedActions: ["DEPRIORITIZE"],
    planEligible: false,
    memoryEligible: false,
    minConfidenceLevel: "HIGH",
    description: "Weak signals are ignored or deprioritized",
  },
};

const CONFIDENCE_LEVEL_ORDER: Record<DecisionConfidenceLevel, number> = {
  INSUFFICIENT: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function meetsMinConfidence(
  actual: DecisionConfidenceLevel,
  required: DecisionConfidenceLevel,
): boolean {
  return CONFIDENCE_LEVEL_ORDER[actual] >= CONFIDENCE_LEVEL_ORDER[required];
}

export interface DecisionPolicyViolation {
  decisionType: DecisionType;
  signalText: string;
  confidenceLevel: DecisionConfidenceLevel;
  reason: string;
}

export interface DecisionFilterResult {
  eligible: CrossSignalDecision[];
  rejected: CrossSignalDecision[];
  blocked: CrossSignalDecision[];
  violations: DecisionPolicyViolation[];
  policyEnforced: boolean;
}

export function filterDecisionsForPlan(
  decisions: CrossSignalDecision[],
): DecisionFilterResult {
  const eligible: CrossSignalDecision[] = [];
  const rejected: CrossSignalDecision[] = [];
  const blocked: CrossSignalDecision[] = [];
  const violations: DecisionPolicyViolation[] = [];

  for (const decision of decisions) {
    const policy = DECISION_ACTION_POLICIES[decision.type];
    if (!policy) {
      rejected.push(decision);
      violations.push({
        decisionType: decision.type,
        signalText: decision.signalText,
        confidenceLevel: decision.confidenceLevel,
        reason: `No policy defined for decision type: ${decision.type}`,
      });
      continue;
    }

    if (!policy.planEligible) {
      blocked.push(decision);
      console.log(
        `[DecisionPolicy] BLOCKED | type=${decision.type} signal="${decision.signalText.slice(0, 60)}" reason="policy prohibits plan inclusion"`,
      );
      continue;
    }

    if (!meetsMinConfidence(decision.confidenceLevel, policy.minConfidenceLevel)) {
      rejected.push(decision);
      violations.push({
        decisionType: decision.type,
        signalText: decision.signalText,
        confidenceLevel: decision.confidenceLevel,
        reason: `Confidence ${decision.confidenceLevel} below required ${policy.minConfidenceLevel} for ${decision.type}`,
      });
      console.log(
        `[DecisionPolicy] REJECTED | type=${decision.type} confidence=${decision.confidenceLevel} required=${policy.minConfidenceLevel} signal="${decision.signalText.slice(0, 60)}"`,
      );
      continue;
    }

    eligible.push(decision);
  }

  console.log(
    `[DecisionPolicy] PLAN_FILTER | eligible=${eligible.length} rejected=${rejected.length} blocked=${blocked.length} violations=${violations.length}`,
  );

  return { eligible, rejected, blocked, violations, policyEnforced: true };
}

export interface DecisionEnforcementReport {
  timestamp: string;
  totalDecisions: number;
  eligible: number;
  rejected: number;
  blocked: number;
  violations: DecisionPolicyViolation[];
  policyEnforced: boolean;
  decisionBreakdown: Array<{
    type: DecisionType;
    count: number;
    planEligible: boolean;
    allowedActions: AllowedAction[];
  }>;
  synthesisPath: "DECISION_DRIVEN" | "DEGRADED_NO_DECISIONS" | "DEGRADED_AI_FAILED";
  synthesisNotes: string[];
}

export function buildDecisionEnforcementReport(
  allDecisions: CrossSignalDecision[],
  filterResult: DecisionFilterResult,
  synthesisPath: DecisionEnforcementReport["synthesisPath"],
  synthesisNotes: string[] = [],
): DecisionEnforcementReport {
  const breakdown: Record<string, { count: number; planEligible: boolean; allowedActions: AllowedAction[] }> = {};

  for (const d of allDecisions) {
    const policy = DECISION_ACTION_POLICIES[d.type];
    if (!breakdown[d.type]) {
      breakdown[d.type] = {
        count: 0,
        planEligible: policy?.planEligible ?? false,
        allowedActions: policy?.allowedActions ?? [],
      };
    }
    breakdown[d.type].count++;
  }

  return {
    timestamp: new Date().toISOString(),
    totalDecisions: allDecisions.length,
    eligible: filterResult.eligible.length,
    rejected: filterResult.rejected.length,
    blocked: filterResult.blocked.length,
    violations: filterResult.violations,
    policyEnforced: filterResult.policyEnforced,
    decisionBreakdown: Object.entries(breakdown).map(([type, data]) => ({
      type: type as DecisionType,
      ...data,
    })),
    synthesisPath,
    synthesisNotes,
  };
}

// Task #65 / Phase 2 step 8 — `validateDecisionForMemoryWrite` deprecated
// shim removed. The single canonical gate is `policyEnforcedMemoryCheck`,
// invoked from inside memoryStore at write time. The only pre-#65 caller
// (outcome-tracker) now goes through memoryStore.reinforceByDecisionId
// which gate-checks via updateById → policyEnforcedMemoryCheck internally.

export function applyFallbackSourcePenalty(
  confidenceScore: number,
  label: string,
): { penalizedScore: number; penaltyApplied: boolean; note: string } {
  const penalized = Math.max(
    DECISION_CONFIDENCE_THRESHOLDS.FALLBACK_SOURCE_MIN_FLOOR,
    confidenceScore - DECISION_CONFIDENCE_THRESHOLDS.FALLBACK_SOURCE_PENALTY,
  );
  const note = `fallback-source penalty applied: ${confidenceScore.toFixed(3)} → ${penalized.toFixed(3)} (label="${label.slice(0, 60)}")`;
  console.log(`[DecisionPolicy] MEMORY_FALLBACK_SOURCE_PENALTY | ${note}`);
  return { penalizedScore: penalized, penaltyApplied: true, note };
}

export function validateAgentDecisionBinding(
  decision: { action: string; trigger: string },
  planId: string | null | undefined,
): { bound: boolean; reason: string } {
  if (!planId || planId.trim() === "") {
    const reason = `DECISION_REJECTED_UNBOUND | action="${decision.action.slice(0, 80)}" trigger="${decision.trigger.slice(0, 80)}" — no planId binding`;
    console.log(`[DecisionPolicy] ${reason}`);
    return { bound: false, reason };
  }
  return { bound: true, reason: `Bound to plan ${planId}` };
}

// Task #64 / Phase 1 step 2 — the OPERATIONAL_MEMORY_TYPES bypass that
// previously let content_rhythm / exploration_budget skip the gate has been
// removed. Those rows now persist to the engine_operational_state table
// via operationalStateStore.upsertOperationalState(), which intentionally
// does not run through policyEnforcedMemoryCheck (an operational singleton
// is the authoritative source — confidence-thresholding it is meaningless).
//
// NON_STRATEGIC_MEMORY_TYPES below is retained as a read-time filter for
// legacy rows that may still exist on strategy_memory until the historical
// sweep runs. New writes of those types to strategy_memory are rejected by
// memoryStore.assertStrategicType() at the helper boundary.

export const NON_STRATEGIC_MEMORY_TYPES = [
  "content_rhythm",
  "exploration_budget",
  "mutation_log",
  "agent_action",
  "agent_rhythm",
  "self_improvement",
] as const;

/**
 * Seal #10 / Task #28 / F4.9 — centralized helper any READ path that loads
 * strategy_memory rows for AI context (build-plan, plan synthesis, autonomous
 * worker, system-control reports, audit panes) MUST use to filter out
 * operational/non-strategic memory types. Pre-#28, only WRITE paths went
 * through `policyEnforcedMemoryCheck()`; reads silently included operational
 * rows in the AI context, polluting strategy with content_rhythm noise.
 *
 * Returns the canonical exclusion list as a plain string[] for callers using
 * `notInArray(strategyMemory.memoryType, NON_STRATEGIC_MEMORY_TYPES_ARR)`.
 * Centralizing the cast removes the per-callsite `[...NON_STRATEGIC_MEMORY_TYPES]`
 * spread, making it impossible to forget the conversion.
 */
export const NON_STRATEGIC_MEMORY_TYPES_ARR: string[] = [...NON_STRATEGIC_MEMORY_TYPES];

/**
 * Returns true when the given memory type is operational/non-strategic and
 * therefore MUST be excluded from any AI-context read. Use at any call-site
 * where the read can't be expressed as a single SQL filter (e.g. when
 * post-filtering a rows array assembled from multiple sources).
 */
export function isNonStrategicMemoryType(memoryType: string | null | undefined): boolean {
  if (!memoryType) return false;
  return (NON_STRATEGIC_MEMORY_TYPES_ARR as readonly string[]).includes(memoryType);
}

export function policyEnforcedMemoryCheck(
  confidenceScore: number,
  direction: "reinforce" | "avoid" | "neutral",
  engineName: string,
  memoryType: string,
): { allowed: boolean; reason: string; policyBypassed: boolean } {
  if (confidenceScore < DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN) {
    const reason = `Memory write BLOCKED for engine="${engineName}" memoryType="${memoryType}" direction="${direction}": confidence ${confidenceScore.toFixed(3)} below minimum ${DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN}`;
    console.log(`[DecisionPolicy] MEMORY_WRITE_BLOCKED | ${reason}`);
    return { allowed: false, reason, policyBypassed: false };
  }
  return { allowed: true, reason: "Confidence meets memory write threshold", policyBypassed: false };
}

export function serializeDecisionReportForLog(report: DecisionEnforcementReport): string {
  return [
    `[DecisionEnforcement] path=${report.synthesisPath} total=${report.totalDecisions} eligible=${report.eligible} rejected=${report.rejected} blocked=${report.blocked}`,
    ...report.violations.map(
      (v) => `  VIOLATION | type=${v.decisionType} confidence=${v.confidenceLevel} reason="${v.reason}"`,
    ),
    ...report.synthesisNotes.map((n) => `  NOTE: ${n}`),
  ].join("\n");
}
