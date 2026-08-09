/**
 * Stranded-Run Sweeper — Task #171
 *
 * Marks orchestrator jobs stuck in RUNNING status past a staleness threshold
 * as TIMED_OUT so they never shadow a completed run indefinitely.
 *
 * A RUNNING job becomes "stranded" when the server process was killed or
 * restarted while the run was in flight (the watchdog fires a clearTimeout
 * but the DB row stays RUNNING forever if the process dies before
 * updateJob completes). The supported whole-pipeline maximum is 45 minutes
 * (multi-stage execution with per-engine budgets up to 15 minutes /
 * ENGINE_TIMEOUT_MS_OVERRIDE=420s in ops workflows). The staleness threshold
 * is 60 minutes — strictly above the supported pipeline ceiling — so a
 * healthy run can never be swept mid-flight; only rows that provably can no
 * longer reach a terminal status are touched. Override with
 * STRANDED_RUN_THRESHOLD_MS_OVERRIDE (ops escape hatch), which is clamped to
 * never go below the 45-minute pipeline ceiling.
 *
 * The sweep runs once immediately at boot (to clean up any zombie rows from
 * the previous process) then every 10 minutes. It is intentionally narrow:
 * only RUNNING + createdAt < cutoff rows are touched; all other statuses
 * and all terminal rows are untouched.
 */

import { db } from "../db";
import { orchestratorJobs } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";

/** Supported whole-pipeline maximum runtime — the sweep must never fire below this. */
export const PIPELINE_MAX_RUNTIME_MS = 45 * 60 * 1000; // 45 minutes

/** Threshold after which a RUNNING job with no completedAt is assumed stranded. */
export const STRANDED_RUN_THRESHOLD_MS = (() => {
  const override = Number(process.env.STRANDED_RUN_THRESHOLD_MS_OVERRIDE);
  const base = Number.isFinite(override) && override > 0 ? override : 60 * 60 * 1000; // 60 minutes
  // Clamp: never allow a threshold at or below the supported pipeline maximum.
  return Math.max(base, PIPELINE_MAX_RUNTIME_MS + 5 * 60 * 1000);
})();

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Mark all RUNNING orchestrator jobs created more than
 * STRANDED_RUN_THRESHOLD_MS ago as TIMED_OUT. Returns the number of
 * rows updated.
 */
export async function sweepStrandedRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STRANDED_RUN_THRESHOLD_MS);
  const updated = await db
    .update(orchestratorJobs)
    .set({
      status: "TIMED_OUT",
      error:
        "This run was marked TIMED_OUT by the stranded-run recovery sweep. " +
        "The server restarted (or the watchdog was killed) while the job was " +
        "in RUNNING state, leaving it unable to ever reach a terminal status. " +
        "This row no longer shadows completed runs.",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(orchestratorJobs.status, "RUNNING"),
        lt(orchestratorJobs.createdAt, cutoff),
      ),
    )
    .returning({ id: orchestratorJobs.id });

  const count = updated.length;
  if (count > 0) {
    console.log(
      `[StrandedRunSweeper] Marked ${count} stranded RUNNING job(s) as TIMED_OUT ` +
        `(cutoff=${cutoff.toISOString()})`,
    );
  }
  return count;
}

/** Start the sweeper: one immediate sweep at boot, then every 10 minutes. */
export function startStrandedRunSweeper(): void {
  if (sweepTimer !== null) return; // already running — idempotent

  // Immediate boot sweep to clean up zombie rows from the previous process.
  sweepStrandedRuns().catch((err) =>
    console.error("[StrandedRunSweeper] Boot sweep failed:", err),
  );

  sweepTimer = setInterval(() => {
    sweepStrandedRuns().catch((err) =>
      console.error("[StrandedRunSweeper] Periodic sweep failed:", err),
    );
  }, 10 * 60 * 1000);
  (sweepTimer as any).unref?.();
}

/** Stop the sweeper (called during graceful shutdown). */
export function stopStrandedRunSweeper(): void {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
