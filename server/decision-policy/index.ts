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

export function validateDecisionForMemoryWrite(
  confidenceScore: number,
  direction: "reinforce" | "avoid" | "neutral",
  engineName: string,
): { allowed: boolean; reason: string } {
  if (confidenceScore < DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN) {
    const reason = `Memory write BLOCKED for engine="${engineName}" direction="${direction}": confidence ${confidenceScore.toFixed(3)} below minimum ${DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN}`;
    console.log(`[DecisionPolicy] MEMORY_WRITE_BLOCKED | ${reason}`);
    return { allowed: false, reason };
  }
  return { allowed: true, reason: "Confidence meets memory write threshold" };
}

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

const OPERATIONAL_MEMORY_TYPES = new Set([
  "content_rhythm",
  "exploration_budget",
]);

export const NON_STRATEGIC_MEMORY_TYPES = [
  "content_rhythm",
  "exploration_budget",
  "mutation_log",
  "agent_action",
  "self_improvement",
] as const;

export function policyEnforcedMemoryCheck(
  confidenceScore: number,
  direction: "reinforce" | "avoid" | "neutral",
  engineName: string,
  memoryType: string,
): { allowed: boolean; reason: string; policyBypassed: boolean } {
  const isOperational = OPERATIONAL_MEMORY_TYPES.has(memoryType);

  if (confidenceScore < DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN) {
    if (isOperational) {
      const reason = `POLICY_BYPASS_OPERATIONAL | engine="${engineName}" memoryType="${memoryType}" confidence=${confidenceScore.toFixed(3)} — operational state, write allowed below threshold`;
      console.log(`[DecisionPolicy] ${reason}`);
      return { allowed: true, reason, policyBypassed: true };
    }

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
