import type { CollectorEntityType, CollectorLane } from "../collector/envelope";
// Phase 8.0 fix (Main migration) — imported so Phase6Context.q2_inputs can carry
// the same structured market interpretation that drove Q2's verdict (see L497
// of run.ts). Bundle author added the field to the writer but missed the type.
import type { CompetitorInterpretation } from "../pipeline/lanes/competitor/interpret";

export type BossTrigger = "manual" | "approval" | "scheduled";

export type BossLaneScope = "user" | "competitor" | "bridge";

export interface BossScope {
  /** Restrict execution to these lanes. Default: all three. */
  onlyLanes?: BossLaneScope[];
  /** Restrict execution to these entity ids (matches userPublicProfiles.id or ciCompetitors.id). Default: all active for campaign. */
  onlyEntityIds?: string[];
  /**
   * If true, every lane run spawned by this Boss run binds the Control Layer flag
   * `requireFreshAcquisition: true`, and the Boss Agent forces a fresh acquisition
   * (collector freshness.force = true) for every entity in the plan.
   */
  forceFreshAcquisition?: boolean;
  /**
   * Lineage marker for operator-triggered "Run New Analysis on Fresh Data" reruns
   * launched from the Q2=SHIFTED dashboard CTA. Strictly descriptive — the boss
   * pipeline does NOT branch on this field; it is persisted in scope JSON so the
   * dashboard can display the parent → child breadcrumb. NEVER auto-set; only
   * set by the /boss/runs/:id/rerun-on-fresh-data endpoint when an operator
   * explicitly clicks the CTA. Locked by Samir 2026-04-30:
   *   - rerun is operator-controlled (no auto-rerun)
   *   - DNA is not auto-mutated by the rerun
   *   - parent run is preserved untouched
   */
  rerunOfBossRunId?: string;
}

/**
 * One row in the BossPlan — one entity to acquire and run a lane against.
 * Plans are pure values produced by `planBoss()` — they make no DB writes.
 */
export interface BossPlanItem {
  lane: CollectorLane;          // "user" | "competitor"
  entityType: CollectorEntityType;
  entityId: string;             // canonical id used by the Collector (handle | url | competitor uuid)
  discoveryRowId: string;       // userPublicProfiles.id or ciCompetitors.id (for traceability)
  displayName: string;          // human-readable label for the run summary
}

export interface BossPlan {
  bridgeRequested: boolean;     // true iff onlyLanes is empty/contains "bridge" AND there is at least one user item AND one competitor item
  items: BossPlanItem[];
  notes: string[];              // explanatory notes about why entities were skipped
}

export interface BossRunInput {
  accountId: string;
  campaignId: string;
  trigger: BossTrigger;
  scope?: BossScope;
}

export interface BossExecutionAcquisition {
  planItemIndex: number;
  entityType: CollectorEntityType;
  entityId: string;
  acquisitionId: string;
  cacheHit: boolean;
  warnings: string[];
}

export interface BossExecutionLaneRun {
  lane: BossLaneScope;
  entityId: string | null;       // null for bridge
  runId: string | null;          // null if it didn't get to start
  parentBossRunId: string;       // mirrors what we wrote into pipeline_runs.parentRunId
  acquisitionId: string | null;  // null for bridge
  status: "validated" | "rejected" | "failed" | "skipped";
  signalCount?: number;
  changeEventCount?: number;
  warnings: string[];
  rejectionReason?: string;
}

export interface BossExecution {
  acquisitions: BossExecutionAcquisition[];
  laneRuns: BossExecutionLaneRun[];
  bridgeRunId: string | null;
  // Phase 4 — T-4.C (recommend-only, locked by Samir).
  // Set to "rerun_recommended" when q2Verdict === "SHIFTED". Purely descriptive
  // — no code path branches on this field, no automatic rerun is scheduled.
  // Operators trigger reruns manually via the existing /boss/run admin endpoint.
  nextAction?: "rerun_recommended";
  // Phase 5 — descriptive flags only. Strict literal types (no widening).
  // Locked by Samir 2026-04-20:
  //   - never used to derive a DNA verdict (Samir directive #3)
  //   - never used to gate Q2 (independent dimension)
  //   - Q1 gates on these; cluster comparison (Phase 6) will gate on these
  rhythm_status?: "compliant" | "partial" | "non_compliant" | "no_active_plan" | "rhythm_invalid";
  truth_status?: "submitted" | "missing" | "late";
  evaluation_status?: "complete" | "degraded" | "blocked" | "no_active_plan";
  evaluation_confidence?: "high" | "medium" | "low";
  // Separate from nextAction so Phase 4's Q2-driven marker stays purely Q2-driven.
  truthAction?: "user_truth_required";
  // Snapshot of the Phase 5 evaluation context for lineage explainability.
  phase5?: BossExecutionPhase5Context;
  // Snapshot of the Phase 6 DNA + cluster context for lineage explainability.
  // Strictly descriptive; Q1 verdict in `questions.q1_dna_working` is derived
  // from this snapshot via the joined three-layer rule (server/boss/policy/dna-working.ts).
  phase6?: BossExecutionPhase6Context;
}

export interface BossExecutionPhase6Context {
  active_dna: { id: string; status: string; activatedAt: string | null } | null;
  cluster_production:
    | { produced: true; clusterId: string; windowId: string; postCount: number; themeCount: number }
    | { produced: false; reason: string }
    | null;
  cluster_comparison: {
    verdict: string;
    baselineWindowId: string | null;
    currentWindowId: string;
    themesAdded: string[];
    themesRemoved: string[];
    themesShifted: { token: string; baselineShare: number; currentShare: number }[];
    reasons: string[];
  } | null;
  outcome_regression: { regressed: boolean; reason?: string; skippedReason?: string } | null;
  q1_inputs: {
    evaluationStatus: string | null;
    truthStatus: string | null;
    rhythmStatus: string | null;
    hasActiveDna: boolean;
    clusterProductionSkippedReason: string | null;
    clusterComparison: string | null;
    outcomeRegressed: boolean | null;
  };
  // Phase 7.4 — snapshot of the Q2 decision inputs. Persisted so the
  // explanation route can rebuild a Q2EvaluationResult for the q2-reasoning
  // overlay WITHOUT re-querying the live tables (which would risk verdict /
  // explanation drift). Strictly descriptive — never read by policy.
  q2_inputs?: {
    competitor: { recentRunsCount: number; signalCount: number; changeEvents: { major: number; medium: number; mild: number } };
    user: { truthStatus: string | null; rhythmStatus: string | null; evaluationStatus: string | null };
    dna: { hasActiveDna: boolean; clusterComparisonVerdict: string | null; outcomeRegressed: boolean | null };
    lookbackDays: number;
    ruleCode: string;
    // Phase 8.0 fix (Main migration) — added to match the writer at run.ts L497.
    // Persists the structured Phase 7.3 interpretation so the explanation route
    // and q2-reasoning overlay see the same market signal that drove the verdict.
    interpretation?: CompetitorInterpretation | null;
  };
}

export interface BossExecutionPhase5Context {
  window: {
    id: string;
    planId: string;
    windowIndex: number;
    windowStart: string;
    windowEnd: string;
    anchorAt: string;
    anchorFallbackUsed: boolean;
    state: string;
  } | null;
  truth: {
    isPresent: boolean;
    wasLate: boolean;
    submittedAt: string | null;
  } | null;
  rhythm: {
    // Phase 8.0 fix (Main migration) — widened to 5 members to match
    // BossExecution.rhythm_status (this file L81). Bundle author had drift
    // between the two declarations; runtime already produced "rhythm_invalid".
    status: "compliant" | "partial" | "non_compliant" | "no_active_plan" | "rhythm_invalid";
    plannedTotal: number;
    actualTotal: number;
    perChannel: Array<{
      channel: string;
      planned: number;
      actual: number;
      ratio: number;
      status: "compliant" | "partial" | "non_compliant";
    }>;
    reason?: string;
  } | null;
}

export type Q1Verdict = "WORKING" | "DEGRADED" | "UNKNOWN";

// Phase 8.1 — Q1 maturity interpretation. Locked by Samir 2026-05-03.
//
// This is a SEPARATE additive field from `Q1Verdict`. It NEVER changes the
// verdict. It describes WHY the verdict is what it is, in operator-facing
// language. Persisted as a `q1_interpretation:<state>` reason chip in the
// existing `q1Reasons` JSON array (no schema migration), and exposed as
// a top-level `q1Interpretation` field on the boss-runs read endpoints.
//
// The five states (per Samir's directive):
//   - TOO_EARLY_TO_JUDGE — DNA age below threshold for the strategy type
//   - GAINING_TRACTION   — DNA young but early-positive signal present
//   - EXECUTION_TOO_LOW  — execution volume below minimum to judge structure
//   - NEEDS_MORE_EXPOSURE — DNA mature on age, but post count still low
//   - MATURE              — none of the above; standard verdict applies
export type Q1Interpretation =
  | "TOO_EARLY_TO_JUDGE"
  | "GAINING_TRACTION"
  | "EXECUTION_TOO_LOW"
  | "NEEDS_MORE_EXPOSURE"
  | "MATURE";

// Strategy type drives the maturity threshold. Conservative defaults:
// organic = 14d, paid = 5d, hybrid/unknown = 10d.
export type StrategyType = "organic" | "paid" | "hybrid" | "unknown";
// Phase 7.4 — Q2 verdict expanded by Samir 2026-04-24. INSUFFICIENT_DATA was
// added so the Boss can refuse to decide when there is too little competitor
// + user truth signal to reason about the market. STABLE / SHIFTED / UNCERTAIN
// retain their Phase 3 semantics; INSUFFICIENT_DATA is verdict-distinct from
// STABLE because "we have no data" is not the same as "the market is calm".
export type Q2Verdict = "STABLE" | "SHIFTED" | "UNCERTAIN" | "INSUFFICIENT_DATA";

export interface BossQuestionVerdict<V extends string> {
  verdict: V;
  reasons: string[];
}

export interface BossRunResult {
  bossRunId: string;
  status: "completed" | "partial" | "failed";
  trigger: BossTrigger;
  plan: BossPlan;
  execution: BossExecution;
  questions: {
    q1_dna_working: BossQuestionVerdict<Q1Verdict>;
    q2_market_shifted: BossQuestionVerdict<Q2Verdict>;
  };
  warnings: string[];
  startedAt: string;
  finishedAt: string;
}
