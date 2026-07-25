/**
 * Task #91 / Phase 4-C — Parity surface types (reclassified Task #93 / Phase 4-E).
 *
 * The parity gate is now a Replay Regression Observer. Module-flag-
 * shaped fields (modulesAtCandidate/AwaitingBurnIn/Blocked/ShadowOnly),
 * the readyForCutover boolean, autoRevertsLast24h, and the
 * candidateWiringDeferred surface have all been removed.
 *
 * D2/D3: every verdict-shaped field is still a strict enum union.
 */
import type { DivergenceClass } from "../types";

export type RoutedAction = "NOISE" | "INFO" | "WARN" | "BLOCK";

export type ParityRunOutcome =
  | "PASS"
  | "NOISE"
  | "INFO"
  | "WARN"
  | "BLOCK"
  | "HARNESS_ERROR";

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

export type DivergenceRoutingTable = Readonly<Record<DivergenceClass, RoutedAction>>;

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
  divergencePathsByClassLast24h: ParityDivergencePathRow[];
  pathShapeCoverage: Record<ParityPathShape, { count: number; covered: boolean }>;
  blockers: string[];
  shadowMode: boolean;
  lastTickAt: string | null;
}

/** Corpus thresholds for the regression observer. */
export interface ParityGateThresholds {
  minCassettes: number;
  maxOldestHours: number;
  minPerPathShape: number;
  maxPathShapeAgeHours: number;
}

export const DEFAULT_THRESHOLDS: ParityGateThresholds = {
  minCassettes: 200,
  maxOldestHours: 24,
  minPerPathShape: 10,
  maxPathShapeAgeHours: 24 * 7,
};
