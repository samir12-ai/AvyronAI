/**
 * Task #91 / Phase 4-C — Parity surface types.
 *
 * D2/D3: every verdict-shaped field is a strict enum union. Outcomes,
 * routed actions, and parity ready/not-ready badges are all string-literal
 * unions; no `string`, no `?? "UNKNOWN"` substitution downstream.
 */
import type { DivergenceClass } from "../types";

/** Per-class routing action loaded from `divergence_class_routes`. */
export type RoutedAction = "NOISE" | "INFO" | "WARN" | "BLOCK";

/** Outcome of a single cassette replay. */
export type ParityRunOutcome =
  | "PASS"
  | "NOISE"
  | "INFO"
  | "WARN"
  | "BLOCK"
  | "HARNESS_ERROR";

/** All 7 declared orchestrator path-shapes (matches cassette pathShape tag). */
export const PARITY_PATH_SHAPES = [
  "clean",
  "gate_retry",
  "budget_downgrade",
  "scoped_rerun",
  "blocked_by_integrity",
  "needs_input",
  "error",
] as const;
export type ParityPathShape = (typeof PARITY_PATH_SHAPES)[number];

/** Routing table — divergenceClass → action. */
export type DivergenceRoutingTable = Readonly<Record<DivergenceClass, RoutedAction>>;

/** A persisted run row (subset projected for the operator panel). */
export interface ParityRunSummary {
  id: string;
  ranAt: string;
  cassetteHash: string;
  pathShape: string | null;
  outcome: ParityRunOutcome;
  divergenceCount: number;
  highestClass: DivergenceClass | null;
  routedAction: RoutedAction | "NONE";
  shadowMode: boolean;
  candidateError: string | null;
}

/** A single auto-revert event surfaced for operator review. */
export interface ParityAutoRevertLogRow {
  /** ISO timestamp the revert audit row was written. */
  at: string;
  moduleId: string;
  moduleFlag: string;
  reason: string;
  suppressed: boolean;
}

/** Per-class divergence detail row (last 24h). */
export interface ParityDivergencePathRow {
  divergenceClass: DivergenceClass;
  path: string;
  count: number;
}

/** Aggregate health surface returned by /healthz/orchestrator-parity. */
export interface OrchestratorParityHealth {
  cassetteCount: number;
  oldestCassetteAgeH: number;
  divergencesByClassLast24h: Record<DivergenceClass, number>;
  /**
   * Per-class top divergence paths in the last 24h (descending by count,
   * capped at 5 rows per class). Powers the operator panel's "divergence
   * detail click-through" — finding #3 of code-review #7.
   */
  divergencePathsByClassLast24h: ParityDivergencePathRow[];
  /**
   * Auto-revert audit rows in the last 24h (descending by time, capped
   * at 20 rows). Source = `audit_log WHERE event_type='MODULE_AUTO_REVERT'`.
   * Powers the operator panel's "last 24h auto-revert log" — finding #3
   * of code-review #7.
   */
  autoRevertsLast24h: ParityAutoRevertLogRow[];
  modulesBlocked: string[];
  modulesShadowOnly: string[];
  modulesAtCandidate: string[];
  modulesAwaitingBurnIn: Array<{ moduleId: string; daysAtCandidate: number | null }>;
  pathShapeCoverage: Record<ParityPathShape, { count: number; covered: boolean }>;
  blockers: string[];
  readyForCutover: boolean;
  shadowMode: boolean;
  lastTickAt: string | null;
  /**
   * True when the parity scheduler is running against the placeholder
   * "PARITY_CANDIDATE_NOT_WIRED" stub — every tick will be HARNESS_ERROR
   * until Phase 4-B llm-injection plumbing registers a real candidate.
   * Surfaced as a blocker so the gate cannot accidentally go green
   * during the deferred period.
   */
  candidateWiringDeferred: boolean;
}

/** Minimum thresholds gating `readyForCutover=true`. */
export interface ParityGateThresholds {
  minCassettes: number;
  maxOldestHours: number;
  minPerPathShape: number;
  maxPathShapeAgeHours: number;
  blockFreeWindowHours: number;
  warnFreeWindowHours: number;
  candidateBurnInDays: number;
}

export const DEFAULT_THRESHOLDS: ParityGateThresholds = {
  minCassettes: 200,
  maxOldestHours: 24,
  minPerPathShape: 10,
  maxPathShapeAgeHours: 24 * 7,
  blockFreeWindowHours: 72,
  warnFreeWindowHours: 24,
  candidateBurnInDays: 7,
};
