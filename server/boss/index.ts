/**
 * Phase 3 — Boss Agent (overlay).
 *
 * Public surface only. Implementation lives in sibling files.
 *
 * Hard rules:
 *   - Orchestration only. No scoring, no interpretation.
 *   - Calls `acquire()` from server/collector — never imports a scraper directly.
 *   - Records every decision in the `boss_runs` table for full lineage explainability.
 *   - Q1 ("Is current DNA working?") returns UNKNOWN until the DNA layer ships in Phase 6.
 *   - Q2 ("Has the market shifted enough?") records a verdict only — does not auto-rerun.
 */
export { runBoss } from "./run";
export { planBoss } from "./plan";
export { listBossRuns, getBossRun } from "./store";
export { BossRunInFlightError } from "./concurrency";
export type {
  BossTrigger,
  BossLaneScope,
  BossScope,
  BossPlan,
  BossPlanItem,
  BossRunInput,
  BossExecutionAcquisition,
  BossExecutionLaneRun,
  BossExecution,
  BossQuestionVerdict,
  BossRunResult,
} from "./types";
