import type {
  BlockCode,
  BlockReason,
  ExecutionMode,
  RecoveryIssue,
  RecoveryPlan,
  RootCauseCategory,
  SystemControlVerdict,
} from "./types";
import { lookupRecovery, RECOVERY_MAP } from "./recovery-map";

function canonicalCode(rawCode: string | undefined): BlockCode | "UNKNOWN_BLOCK" {
  if (!rawCode) return "UNKNOWN_BLOCK";
  return (rawCode in RECOVERY_MAP) ? (rawCode as BlockCode) : "UNKNOWN_BLOCK";
}

export interface RecoveryPlannerContext {
  campaignId: string;
  accountId: string;
  results?: Map<string, any>;
  ssc?: any;
}

const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  strategy_issue: "strategy",
  offer_issue: "offer",
  funnel_issue: "funnel",
  channel_issue: "channel",
  proof_issue: "proof",
  audience_mismatch: "audience mismatch",
  validation_issue: "validation",
  budget_risk: "budget risk",
  system_parser_issue: "system / structural",
  data_insufficiency: "data insufficiency",
};

function buildDiagnosis(reason: BlockReason, entry: ReturnType<typeof lookupRecovery>): string {
  const desc = reason.description?.trim();
  const meaning = entry.meaning;
  if (desc && desc !== meaning) {
    return `${meaning} Specific signal: ${desc}`;
  }
  return meaning;
}

function pickRepairAction(entry: ReturnType<typeof lookupRecovery>): string {
  return entry.repairPatterns[0] || "Inspect block reason and route to owner engine.";
}

function pickSuccessCriteria(entry: ReturnType<typeof lookupRecovery>): string {
  return entry.successCriteria[0] || "Block code clears on re-run.";
}

function pickNextMode(entry: ReturnType<typeof lookupRecovery>): ExecutionMode {
  return entry.defaultNextMode;
}

function determineHumanReview(issues: RecoveryIssue[]): boolean {
  if (issues.some(i => i.nextPossibleMode === "HUMAN_REVIEW_REQUIRED")) return true;
  if (issues.some(i => i.nextPossibleMode === "REVIEW_REQUIRED")) return true;
  if (issues.length >= 4) return true;
  if (issues.filter(i => i.severity === "critical").length >= 3) return true;
  return false;
}

function buildRootCauseSummary(issues: RecoveryIssue[]): string {
  if (issues.length === 0) return "No block reasons present.";
  const categoryCount = new Map<RootCauseCategory, number>();
  for (const i of issues) {
    categoryCount.set(i.rootCauseCategory, (categoryCount.get(i.rootCauseCategory) || 0) + 1);
  }
  const sorted = [...categoryCount.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 2).map(([cat, n]) => `${ROOT_CAUSE_LABELS[cat]} (${n})`);
  const lead = issues[0];
  return `Primary root cause: ${ROOT_CAUSE_LABELS[lead.rootCauseCategory]} owned by ${lead.ownerEngine}. ${issues.length} blocking issue${issues.length === 1 ? "" : "s"} total spanning ${top.join(" + ")}. Repair sequence below is ordered by structural dependency — fix in order to avoid wasted rework.`;
}

function buildGlobalPlan(issues: RecoveryIssue[]): string[] {
  const plan: string[] = [];
  issues.forEach((i, idx) => {
    plan.push(`Step ${idx + 1} — ${i.ownerEngine}: ${i.repairAction}`);
  });
  if (issues.some(i => i.rootCauseCategory === "data_insufficiency")) {
    plan.push("Data-collection cycles must complete BEFORE any strategy rewrite — do not reorder.");
  }
  if (issues.some(i => i.rootCauseCategory === "budget_risk")) {
    plan.push("Hold all paid spend at $0 until validation issues clear — do not unlock budget early.");
  }
  return plan;
}

function buildRerunRequirements(issues: RecoveryIssue[]): string[] {
  const reqs = new Set<string>();
  for (const issue of issues) {
    for (const proof of issue.requiredProof) {
      reqs.add(proof);
    }
  }
  return [...reqs];
}

/**
 * Build a structured RecoveryPlan from a SystemControlVerdict.
 *
 * Returns null when the verdict is not BLOCK (only blocked campaigns get plans).
 *
 * Pure deterministic v1: builds plans from the recovery-map registry. The
 * registry already produces concrete, owner-correct, mode-correct repair
 * actions and success criteria. LLM enrichment can be added in a future phase
 * as an additive overlay (designer + judge + null fallback).
 *
 * Constraint: NEVER weakens enforcement — does not flip BLOCK to PASS, does
 * not promote a halted mode to scale. Only describes the path back.
 */
export function buildRecoveryPlan(
  verdict: SystemControlVerdict,
  ctx: RecoveryPlannerContext,
): RecoveryPlan | null {
  if (!verdict || verdict.verdict !== "BLOCK") return null;

  const reasons = (verdict.blockReasons || []).filter(r => r && r.code);
  const issues: RecoveryIssue[] = reasons.map((reason, idx) => {
    const canonical = canonicalCode(reason.code);
    const entry = lookupRecovery(reason.code);
    const isUnknown = canonical === "UNKNOWN_BLOCK";
    const baseDiagnosis = buildDiagnosis(reason, entry);
    return {
      blockCode: canonical,
      rootCauseCategory: entry.rootCauseCategory,
      ownerEngine: entry.ownerEngine,
      diagnosis: isUnknown
        ? `${baseDiagnosis} Original code: ${reason.code}.`
        : baseDiagnosis,
      repairAction: pickRepairAction(entry),
      successCriteria: pickSuccessCriteria(entry),
      requiredProof: [...entry.requiredProof],
      nextPossibleMode: pickNextMode(entry),
      priority: entry.repairOrderRank,
      severity: reason.severity || entry.severity,
      source: "deterministic",
    };
  });

  // Sort by repair-order rank (lower = fix first), then critical before high
  issues.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return 0;
  });

  // Re-stamp priority field as 1-based ordinal after sort
  issues.forEach((i, idx) => { i.priority = idx + 1; });

  const priorityOrder = issues.map(i => i.blockCode);

  return {
    currentVerdict: verdict.verdict,
    currentExecutionMode: verdict.executionMode,
    blockCodes: reasons.map(r => canonicalCode(r.code)),
    rootCauseSummary: buildRootCauseSummary(issues),
    issues,
    priorityOrder,
    globalRecoveryPlan: buildGlobalPlan(issues),
    rerunRequirements: buildRerunRequirements(issues),
    humanReviewNeeded: determineHumanReview(issues),
    generatedAt: new Date().toISOString(),
    source: "deterministic",
  };
}

export function buildEmptyRecoveryPlan(verdict: SystemControlVerdict | null | undefined, note: string): RecoveryPlan {
  // D1 (H8): Do NOT fall back verdict→"PASS" or executionMode→"FULL_EXECUTION".
  // Defaulting absent verdict semantics to the most-permissive value silently
  // licences execution from incomplete data (the exact bug class the doctrine
  // forbids). Extract via locally-named bindings + explicit type guards so the
  // ternary defaults are CONSERVATIVE (BLOCK / SYSTEM_UNTRUSTED) when verdict is missing.
  const rawV = verdict?.verdict;
  const rawM = verdict?.executionMode;
  return {
    currentVerdict: typeof rawV === "string" ? (rawV as RecoveryPlan["currentVerdict"]) : "BLOCK",
    currentExecutionMode: typeof rawM === "string" ? (rawM as RecoveryPlan["currentExecutionMode"]) : "SYSTEM_UNTRUSTED",
    blockCodes: [],
    rootCauseSummary: note,
    issues: [],
    priorityOrder: [],
    globalRecoveryPlan: [],
    rerunRequirements: [],
    humanReviewNeeded: false,
    generatedAt: new Date().toISOString(),
    source: "fallback",
    enrichmentNote: note,
  };
}
