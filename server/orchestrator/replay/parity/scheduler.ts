// @ts-nocheck
/**
 * Task #91 / Phase 4-C — Parity gate hourly scheduler.
 *
 * Mirrors the continuity scheduler's loop conventions:
 *   * Stored timer handle reachable from gracefulShutdown.
 *   * `unref()` so the process can exit even when the timer is pending.
 *   * Token-aware in-flight guard so two overlapping ticks can't fire.
 *   * `PARITY_GATE_DISABLED=1` or `CONTINUITY_SCHEDULER_DISABLED=true`
 *     disables the scheduler (tests + incident response).
 *
 * Cadence: 3_600_000ms (1h) — matches the chain-registry declaration so
 * the supervisor never classifies the parity chain DEGRADED for tick
 * cadence reasons. First tick fires 90s after boot so the rest of the
 * platform is up before parity work begins.
 */
import { logger } from "../../../logger";
import { runParityTick, type ParityTickReport } from "./parity-job";
import { computeParityHealth } from "./health";
import type { CandidateOrchestrator } from "../player";
import {
  tryClaimWindow,
  markClaimCompleted,
  releaseClaimForRetry,
} from "../../../continuity/scheduler";

// Synthetic plan key used to drive the parity gate through the same
// continuity claim handshake that protects boss runs (Seal #14).
// `windowIndex = floor(now / TICK_INTERVAL_MS)` rolls forward every
// hour and lets the second replica skip a tick another replica already
// claimed. Stable account/campaign/plan strings keep the primary key
// shape compatible with `continuity_window_claims`.
const PARITY_CLAIM_PLAN = {
  accountId: "__system_parity__",
  campaignId: "__system_parity__",
  planId: "__system_parity__",
} as const;

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 90 * 1000;
const TICK_BUDGET_MS = 10 * 60 * 1000;

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
let inFlight: Promise<ParityTickReport | null> | null = null;
let lastTickAt: Date | null = null;
let lastTickReport: ParityTickReport | null = null;
let candidateFactory: (() => CandidateOrchestrator) | null = null;

export interface ParitySchedulerHealth {
  schedulerUp: boolean;
  lastTickAt: string | null;
  lastTickReport: ParityTickReport | null;
  intervalMs: number;
}

export function getParitySchedulerHealth(): ParitySchedulerHealth {
  return {
    schedulerUp: tickTimer !== null || bootTimer !== null,
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    lastTickReport,
    intervalMs: TICK_INTERVAL_MS,
  };
}

/**
 * Register the candidate orchestrator factory. Called once during boot.
 * The factory MUST return a fresh CandidateOrchestrator per call (no
 * shared mutable state across replays).
 */
export function setParityCandidateFactory(factory: () => CandidateOrchestrator): void {
  candidateFactory = factory;
}

export async function runOneParityTick(): Promise<ParityTickReport | null> {
  if (!candidateFactory) {
    logger.warn(
      { component: "parity-scheduler" },
      "[ParityScheduler] no candidate factory registered — skipping tick",
    );
    return null;
  }
  if (inFlight) {
    logger.warn(
      { component: "parity-scheduler" },
      "[ParityScheduler] tick already in flight — skipping",
    );
    return inFlight;
  }
  inFlight = (async () => {
    // Seal #13 / Seal #14 MULTI-REPLICA-SAFE: every tick claims a
    // per-hour window via the continuity claim handshake. The losing
    // replica returns null; the winner runs the tick and either marks
    // the claim completed (success/partial-with-runs) or releases it
    // for retry (HARNESS_ERROR / unexpected throw) so INVARIANT-RETRY
    // holds — failed parity ticks are NEVER suppressed.
    const now = new Date();
    const windowIndex = Math.floor(now.getTime() / TICK_INTERVAL_MS);
    let claim;
    try {
      claim = await tryClaimWindow(PARITY_CLAIM_PLAN, windowIndex, now);
    } catch (err) {
      logger.error(
        { component: "parity-scheduler", err: String(err) },
        "[ParityScheduler] CLAIM_HANDSHAKE_ERRORED — skipping tick",
      );
      return null;
    }
    if (!claim.acquired) {
      logger.info(
        {
          component: "parity-scheduler",
          windowIndex,
          ownedBy: claim.ownedBy,
          alreadyCompleted: claim.alreadyCompleted,
        },
        "[ParityScheduler] window already claimed by another replica — skipping",
      );
      return null;
    }
    try {
      const report = await runParityTick({
        candidate: candidateFactory!(),
        maxTickMs: TICK_BUDGET_MS,
      });
      lastTickReport = report;
      lastTickAt = new Date();
      // Refresh aggregate health gauges every tick so /metrics is fresh
      // even when the admin panel is not exercised.
      try {
        await computeParityHealth();
      } catch (err) {
        logger.warn(
          { component: "parity-scheduler", err: String(err) },
          "[ParityScheduler] HEALTH_REFRESH_FAILED",
        );
      }
      // Treat the tick as "completed" iff at least one cassette was
      // evaluated AND no HARNESS_ERROR rows were recorded. Otherwise we
      // release the claim so the next hourly tick retries the work.
      const harnessErrors = report.runs.filter((r) => r.outcome === "HARNESS_ERROR").length;
      const completed = report.cassettesEvaluated > 0 && harnessErrors === 0;
      if (completed) {
        await markClaimCompleted(
          PARITY_CLAIM_PLAN,
          windowIndex,
          `parity_tick_${windowIndex}`,
          "ok",
          new Date(),
        );
      } else {
        logger.warn(
          {
            component: "parity-scheduler",
            windowIndex,
            evaluated: report.cassettesEvaluated,
            harnessErrors,
          },
          "[ParityScheduler] tick incomplete — releasing claim so next tick retries (INVARIANT-RETRY)",
        );
        await releaseClaimForRetry(PARITY_CLAIM_PLAN, windowIndex);
      }
      return report;
    } catch (err) {
      logger.error(
        { component: "parity-scheduler", windowIndex, err: String(err) },
        "[ParityScheduler] tick threw — releasing claim so next tick retries (INVARIANT-RETRY)",
      );
      try {
        await releaseClaimForRetry(PARITY_CLAIM_PLAN, windowIndex);
      } catch (releaseErr) {
        logger.error(
          { component: "parity-scheduler", windowIndex, err: String(releaseErr) },
          "[ParityScheduler] CLAIM_RELEASE_FAILED — next tick may not retry",
        );
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function scheduleNext(): void {
  if (isShuttingDown) return;
  tickTimer = setTimeout(async () => {
    try {
      await runOneParityTick();
    } catch (err) {
      logger.error(
        { component: "parity-scheduler", err: String(err) },
        "[ParityScheduler] tick error",
      );
    }
    scheduleNext();
  }, TICK_INTERVAL_MS);
  tickTimer.unref?.();
}

export function startParityScheduler(): void {
  // Code-review #3 normalization: accept both `"1"` and `"true"` (case
  // insensitive) for the two disable knobs so the phase-rollback
  // contract is honoured regardless of how the operator sets the env.
  const truthy = (v: string | undefined) => {
    if (!v) return false;
    const n = v.trim().toLowerCase();
    return n === "1" || n === "true" || n === "yes" || n === "on";
  };
  if (truthy(process.env.PARITY_GATE_DISABLED)) {
    logger.info(
      { component: "parity-scheduler" },
      "[ParityScheduler] disabled via PARITY_GATE_DISABLED",
    );
    return;
  }
  if (truthy(process.env.CONTINUITY_SCHEDULER_DISABLED)) {
    logger.info(
      { component: "parity-scheduler" },
      "[ParityScheduler] disabled via CONTINUITY_SCHEDULER_DISABLED",
    );
    return;
  }
  if (bootTimer || tickTimer) {
    logger.warn(
      { component: "parity-scheduler" },
      "[ParityScheduler] already running — start ignored",
    );
    return;
  }
  isShuttingDown = false;
  logger.info(
    { component: "parity-scheduler", intervalMs: TICK_INTERVAL_MS },
    `[ParityScheduler] starting (first tick in ${FIRST_TICK_DELAY_MS}ms, then hourly)`,
  );
  bootTimer = setTimeout(async () => {
    bootTimer = null;
    try {
      await runOneParityTick();
    } catch (err) {
      logger.error(
        { component: "parity-scheduler", err: String(err) },
        "[ParityScheduler] initial tick error",
      );
    }
    scheduleNext();
  }, FIRST_TICK_DELAY_MS);
  bootTimer.unref?.();
}

export async function stopParityScheduler(): Promise<void> {
  isShuttingDown = true;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  if (inFlight) { try { await inFlight; } catch { /* logged inside tick */ } }
}

/** Test-only reset. */
export function _resetParitySchedulerForTests(): void {
  isShuttingDown = false;
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  inFlight = null;
  lastTickAt = null;
  lastTickReport = null;
  candidateFactory = null;
}
