/**
 * In-flight job lifecycle helpers — single ownership of the in-flight registry.
 *
 * Task #67 / T-S5-C4 + T-S5-C6.
 *
 * Before this module existed, the orchestrator deregistered the in-flight row
 * from three separate code paths (terminal-state branch, NEEDS_INPUT branch,
 * and the `finally` safety net) using a hand-rolled `db.delete` + manual
 * boolean flag (`inFlightCleanupHandled`). Each call site formatted its own
 * log line, and the `expectedCompleteBy` insert used a hardcoded
 * `30 * 60 * 1000` magic constant that did not reflect the realistic
 * worst-case retry budget for 15 engines with mid-pipeline gate retries.
 *
 * This file centralises both concerns:
 *
 *   1. `computeExpectedCompleteBy()` derives the wall-clock cutoff from the
 *      per-engine timeout, the engine count, the realistic retry slack, and a
 *      synthesis budget — instead of a flat 30min ceiling.
 *
 *   2. `deregisterInFlight()` is the ONE function that deletes the
 *      `in_flight_jobs` row, with consistent error logging. The orchestrator
 *      tracks a `cleanupHandled` flag and the `finally` clause calls this
 *      helper only if no terminal-state branch already did.
 */

import { db } from "../db";
import { inFlightJobs } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Returns the wall-clock cutoff that should be persisted into
 * `in_flight_jobs.expected_complete_by`.
 *
 * Math (deliberately conservative — we'd rather a stale-recovery sweep wait
 * a few extra minutes than re-claim a still-running job):
 *
 *   wallClockBudget =
 *     engineCount * engineTimeoutMs                // worst-case per-engine
 *   + retryEligibleEngineCount * engineTimeoutMs   // one mid-pipeline retry per gate-retry-eligible engine
 *   + synthesisBudgetMs                            // plan synthesis + persist + memory write
 *   + slackMs                                      // process-scheduling / DB jitter
 *
 * Defaults match the constants in `server/orchestrator/index.ts`:
 *   - engineCount = 15 (ENGINE_PRIORITY_ORDER.length)
 *   - engineTimeoutMs = 120_000 (ENGINE_TIMEOUT_MS)
 *   - retryEligibleEngineCount = 5 (the engines with `checkMidPipelineGate`
 *     hooks today: audience, offer, funnel, persuasion, integrity)
 *   - synthesisBudgetMs = 5 * 60_000 (plan synthesis + memory mutation)
 *   - slackMs = 2 * 60_000
 *
 * With defaults the budget is roughly 47min — vs the prior 30min hard ceiling
 * which a run with two retries could legitimately exceed.
 */
export function computeExpectedCompleteBy(opts?: {
  now?: number;
  engineCount?: number;
  engineTimeoutMs?: number;
  retryEligibleEngineCount?: number;
  synthesisBudgetMs?: number;
  slackMs?: number;
}): Date {
  const now = opts?.now ?? Date.now();
  const engineCount = opts?.engineCount ?? 15;
  const engineTimeoutMs = opts?.engineTimeoutMs ?? 120_000;
  const retryEligibleEngineCount = opts?.retryEligibleEngineCount ?? 5;
  const synthesisBudgetMs = opts?.synthesisBudgetMs ?? 5 * 60_000;
  const slackMs = opts?.slackMs ?? 2 * 60_000;

  const wallClockBudget =
    engineCount * engineTimeoutMs +
    retryEligibleEngineCount * engineTimeoutMs +
    synthesisBudgetMs +
    slackMs;

  return new Date(now + wallClockBudget);
}

/**
 * Deregister the in-flight row for `jobId`.
 *
 * Returns `true` on a successful delete (or no-op when the row was already
 * gone), `false` only when the DB call itself threw. Callers that want to
 * suppress further deregistration attempts (the `finally` safety net) should
 * key off the boolean they pass into `tracker.markHandled()` rather than this
 * return value — see the JSDoc on `createInFlightCleanupTracker`.
 */
export async function deregisterInFlight(jobId: string, contextLabel = "IN_FLIGHT_DEREGISTRATION_FAILED"): Promise<boolean> {
  try {
    await db.delete(inFlightJobs).where(eq(inFlightJobs.jobId, jobId));
    return true;
  } catch (delErr: any) {
    console.warn(`[Orchestrator] ${contextLabel} | jobId=${jobId} | error=${delErr?.message ?? String(delErr)}`);
    return false;
  }
}

/**
 * Cleanup tracker for the orchestrator's two-phase deregistration.
 *
 * Usage pattern in `runOrchestrator`:
 *
 *   const cleanup = createInFlightCleanupTracker(jobId);
 *   try {
 *     ...
 *     // terminal-state branches:
 *     await cleanup.handleTerminal();   // deletes + flips flag
 *     // NEEDS_INPUT branch:
 *     cleanup.preserveRow();            // flips flag without deleting
 *   } finally {
 *     await cleanup.handleSafetyNet();  // no-op if either branch above ran
 *   }
 *
 * This collapses the prior pattern (manual `inFlightCleanupHandled` boolean
 * + three duplicated `db.delete` call sites) into a single owner.
 */
export interface InFlightCleanupTracker {
  /** Terminal-state path: delete the row and mark handled. */
  handleTerminal: (contextLabel?: string) => Promise<void>;
  /** NEEDS_INPUT path: keep the row alive, but mark handled so the finally is a no-op. */
  preserveRow: () => void;
  /** Safety-net path (finally): delete only if no other branch already ran. */
  handleSafetyNet: (contextLabel?: string) => Promise<void>;
  /** Diagnostic-only: read the current handled flag. */
  isHandled: () => boolean;
}

export function createInFlightCleanupTracker(jobId: string): InFlightCleanupTracker {
  let handled = false;

  return {
    async handleTerminal(contextLabel = "IN_FLIGHT_DEREGISTRATION_FAILED") {
      if (handled) return;
      // Only mark handled on a successful DB delete. If the delete throws
      // (transient DB blip), leave `handled=false` so the `finally` safety
      // net runs `deregisterInFlight` again — better to retry than to leak
      // a stale in_flight_jobs row.
      const ok = await deregisterInFlight(jobId, contextLabel);
      if (ok) handled = true;
    },
    preserveRow() {
      handled = true;
    },
    async handleSafetyNet(contextLabel = "IN_FLIGHT_DEREGISTRATION_FAILED_IN_FINALLY") {
      if (handled) return;
      // Same retry-friendly contract: if the finally delete also fails,
      // leave `handled=false` so a future caller (or the reaper) can
      // observe the row is still present.
      const ok = await deregisterInFlight(jobId, contextLabel);
      if (ok) handled = true;
    },
    isHandled() {
      return handled;
    },
  };
}
