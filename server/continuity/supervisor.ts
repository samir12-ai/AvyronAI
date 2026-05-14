/**
 * Seal #14 / Track #2 — Continuity Supervisor.
 *
 * The watcher of the watchers. Closes audit findings T1-A5 and the
 * "heartbeat-stale alerting" gap promoted from Track #1.
 *
 * Responsibilities:
 *
 *   1. Heartbeat-stale detection on the continuity scheduler. Every
 *      SUPERVISOR_INTERVAL_MS we read MAX(tick_at) from continuity_ticks
 *      and classify the scheduler's own state as HEALTHY | DEGRADED |
 *      DEAD using the shared health-classifier. DEGRADED logs WARN; DEAD
 *      writes a CONTINUITY_HEARTBEAT_STALE audit event.
 *
 *   2. Per-chain lag observation for the 10-chain registry. For each
 *      chain we run its `introspect()` query, classify, and write the
 *      result to chain_registry_state. DEAD/DEGRADED states emit a
 *      CONTINUITY_CHAIN_LAG audit event (rate-limited to one per state
 *      transition by comparing against the previous chain_registry_state
 *      row — no spam for a chain that's been DEAD for hours).
 *
 *   3. Persistence to continuity_supervisor_ticks. Same paper-trail
 *      pattern as the scheduler: every tick writes a row even when zero
 *      problems are found, so a missing row in this table for >2× the
 *      supervisor interval is itself a P1 signal (the supervisor is
 *      stalled and won't catch downstream stalls).
 *
 *   4. Self-rescheduling jittered setTimeout (mirrors scheduler.ts
 *      pattern; ±10s jitter on a 5min interval).
 *
 * The supervisor uses a system account ID for its audit events because
 * its findings are not tenant-scoped. Per-chain audit events redact
 * chain-internal payload to operational counters only — no tenant
 * identifiers leak via this path. Same doctrine as Track #1's public
 * /healthz/continuity surface.
 */
import { db } from "../db";
import {
  continuityTicks,
  continuitySupervisorTicks,
  chainRegistryState,
} from "@shared/schema";
import { desc, sql } from "drizzle-orm";
import { logAudit } from "../audit";
import { logger } from "../logger";
import { continuityMetrics } from "./metrics";
import { getChainRegistry, type ChainDescriptor } from "./chain-registry";
import { classifyChainState, type ChainState, type ClassifyResult } from "./health-classifier";

const DEFAULT_SUPERVISOR_INTERVAL_MS = 5 * 60 * 1000;
const SUPERVISOR_JITTER_MS = 10 * 1000;
const SYSTEM_ACCOUNT_ID = "_system_continuity";
/**
 * Synthetic chain id under which we persist the scheduler's own most-recent
 * supervisor-observed state. Lets `CONTINUITY_HEARTBEAT_STALE` be
 * transition-gated the same way `CONTINUITY_CHAIN_LAG` is, instead of
 * spamming on every DEAD tick (architect-flagged finding #4).
 */
const SCHEDULER_HEARTBEAT_CHAIN_ID = "_continuity_scheduler_heartbeat";

let supervisorTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
let inFlightSupervisor: Promise<SupervisorTickReport> | null = null;
let lastSupervisorTickAt: Date | null = null;
let lastSupervisorReport: SupervisorTickReport | null = null;

export interface ChainObservation {
  chainId: string;
  expectedIntervalMs: number;
  introspectionAvailable: boolean;
  lastObservedRunAt: string | null;
  state: ChainState;
  lagMs: number | null;
  reason: string;
  stateChanged: boolean;
}

export interface SupervisorTickReport {
  tickAt: Date;
  durationMs: number;
  schedulerHeartbeatAgeMs: number | null;
  schedulerState: ChainState;
  schedulerReason: string;
  chainsChecked: number;
  chainsHealthy: number;
  chainsDegraded: number;
  chainsDead: number;
  chainsUnknown: number;
  chains: ChainObservation[];
}

interface SupervisorTickOptions {
  now?: Date;
  persist?: boolean;
}

function getSupervisorIntervalMs(): number {
  const raw = process.env.CONTINUITY_SUPERVISOR_INTERVAL_MS;
  if (!raw) return DEFAULT_SUPERVISOR_INTERVAL_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_SUPERVISOR_INTERVAL_MS;
  return n;
}

async function readSchedulerHeartbeat(): Promise<Date | null> {
  try {
    const rows = await db
      .select({ tickAt: continuityTicks.tickAt })
      .from(continuityTicks)
      .orderBy(desc(continuityTicks.tickAt))
      .limit(1);
    return (rows[0]?.tickAt as Date) ?? null;
  } catch (err) {
    logger.warn(
      { component: "continuity-supervisor", err: String(err) },
      "[ContinuitySupervisor] failed to read scheduler heartbeat",
    );
    return null;
  }
}

async function loadPriorChainState(chainId: string): Promise<ChainState | null> {
  try {
    const rows = await db
      .select({ lastState: chainRegistryState.lastState })
      .from(chainRegistryState)
      .where(sql`${chainRegistryState.chainId} = ${chainId}`)
      .limit(1);
    return (rows[0]?.lastState as ChainState) ?? null;
  } catch {
    return null;
  }
}

async function upsertChainState(
  chain: ChainDescriptor,
  observed: Date | null,
  classification: ClassifyResult,
  now: Date,
  priorState: ChainState | null,
): Promise<void> {
  const stateChanged = priorState !== classification.state;
  try {
    await db
      .insert(chainRegistryState)
      .values({
        chainId: chain.chainId,
        expectedIntervalMs: chain.expectedIntervalMs,
        lastObservedRunAt: observed,
        lastObservedLagMs: classification.lagMs,
        lastState: classification.state,
        lastStateChangedAt: stateChanged ? now : (undefined as any),
        introspectionAvailable: chain.introspect !== null,
        notes: { reason: classification.reason } as any,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: chainRegistryState.chainId,
        set: {
          expectedIntervalMs: chain.expectedIntervalMs,
          lastObservedRunAt: observed,
          lastObservedLagMs: classification.lagMs,
          lastState: classification.state,
          ...(stateChanged ? { lastStateChangedAt: now } : {}),
          introspectionAvailable: chain.introspect !== null,
          notes: { reason: classification.reason } as any,
          updatedAt: now,
        },
      });
  } catch (err) {
    logger.warn(
      { component: "continuity-supervisor", chainId: chain.chainId, err: String(err) },
      "[ContinuitySupervisor] failed to upsert chain_registry_state",
    );
  }
}

/**
 * One supervisor tick. Exported for tests + manual trigger.
 */
export async function runSupervisorTick(
  opts: SupervisorTickOptions = {},
): Promise<SupervisorTickReport> {
  if (inFlightSupervisor) return inFlightSupervisor;
  const persist = opts.persist !== false;
  const now = opts.now ?? new Date();
  const tickStart = Date.now();

  inFlightSupervisor = (async (): Promise<SupervisorTickReport> => {
    // Scheduler heartbeat classification.
    const lastSchedulerTickAt = await readSchedulerHeartbeat();
    const SCHEDULER_EXPECTED = 60 * 60 * 1000; // 1h, matches scheduler default
    const schedulerClassification = classifyChainState({
      now,
      lastObservedRunAt: lastSchedulerTickAt,
      expectedIntervalMs: SCHEDULER_EXPECTED,
      degradedThresholdMultiplier: 2,
      deadThresholdMultiplier: 4,
      introspectionAvailable: true,
    });

    // Architect-flagged finding #4 — transition-gate the
    // CONTINUITY_HEARTBEAT_STALE audit so we don't spam one per tick
    // while the scheduler is down. Mirror the chain-lag pattern: store
    // prior scheduler state under a synthetic chain row.
    const priorSchedulerState = persist
      ? await loadPriorChainState(SCHEDULER_HEARTBEAT_CHAIN_ID)
      : null;
    const schedulerStateChanged =
      priorSchedulerState !== null && priorSchedulerState !== schedulerClassification.state;

    if (schedulerClassification.state === "DEAD" && schedulerStateChanged) {
      continuityMetrics.heartbeatStaleEvents.inc();
      await logAudit(SYSTEM_ACCOUNT_ID, "CONTINUITY_HEARTBEAT_STALE", {
        details: {
          previousState: priorSchedulerState,
          schedulerState: schedulerClassification.state,
          lagMs: schedulerClassification.lagMs,
          reason: schedulerClassification.reason,
          lastSchedulerTickAt: lastSchedulerTickAt?.toISOString() ?? null,
        },
      }).catch(() => undefined);
      logger.error(
        {
          component: "continuity-supervisor",
          schedulerState: schedulerClassification.state,
          lagMs: schedulerClassification.lagMs,
        },
        "[ContinuitySupervisor] scheduler heartbeat transitioned to DEAD — paging operator via audit",
      );
    } else if (schedulerClassification.state === "DEAD") {
      // Already DEAD — log at WARN level, no audit (transition-gated).
      logger.warn(
        {
          component: "continuity-supervisor",
          lagMs: schedulerClassification.lagMs,
          priorSchedulerState,
        },
        "[ContinuitySupervisor] scheduler heartbeat still DEAD (no transition)",
      );
    } else if (schedulerClassification.state === "DEGRADED") {
      logger.warn(
        {
          component: "continuity-supervisor",
          lagMs: schedulerClassification.lagMs,
        },
        "[ContinuitySupervisor] scheduler heartbeat DEGRADED",
      );
    }
    continuityMetrics.schedulerHeartbeatAgeMs.set({}, schedulerClassification.lagMs ?? 0);

    // Persist scheduler heartbeat as a synthetic chain row so the next
    // tick can read priorSchedulerState for transition gating.
    if (persist) {
      await upsertChainState(
        {
          chainId: SCHEDULER_HEARTBEAT_CHAIN_ID,
          description: "Synthetic — scheduler heartbeat (used for transition gating)",
          expectedIntervalMs: SCHEDULER_EXPECTED,
          introspect: () => Promise.resolve(lastSchedulerTickAt),
        },
        lastSchedulerTickAt,
        schedulerClassification,
        now,
        priorSchedulerState,
      );
    }

    // Per-chain observation.
    const registry = getChainRegistry();
    const chainObservations: ChainObservation[] = [];
    let healthy = 0;
    let degraded = 0;
    let dead = 0;
    let unknown = 0;

    for (const chain of registry) {
      let observed: Date | null = null;
      if (chain.introspect) {
        try {
          observed = await chain.introspect();
        } catch (err) {
          logger.warn(
            { component: "continuity-supervisor", chainId: chain.chainId, err: String(err) },
            "[ContinuitySupervisor] chain introspect threw",
          );
          observed = null;
        }
      }
      const classification = classifyChainState({
        now,
        lastObservedRunAt: observed,
        expectedIntervalMs: chain.expectedIntervalMs,
        degradedThresholdMultiplier: chain.degradedMultiplier ?? 1,
        deadThresholdMultiplier: chain.deadMultiplier ?? 4,
        introspectionAvailable: chain.introspect !== null,
      });

      const priorState = persist ? await loadPriorChainState(chain.chainId) : null;
      const stateChanged = priorState !== classification.state && priorState !== null;

      // State counters.
      if (classification.state === "HEALTHY") healthy++;
      else if (classification.state === "DEGRADED") degraded++;
      else if (classification.state === "DEAD") dead++;
      else unknown++;

      // Metrics.
      continuityMetrics.chainLagMs.set(
        { chain: chain.chainId },
        classification.lagMs ?? 0,
      );
      continuityMetrics.chainState.set(
        { chain: chain.chainId, state: classification.state },
        1,
      );

      // Audit only on state TRANSITION into DEGRADED/DEAD (no spam).
      if (
        stateChanged &&
        (classification.state === "DEGRADED" || classification.state === "DEAD")
      ) {
        continuityMetrics.chainLagEvents.inc({ chain: chain.chainId, state: classification.state });
        await logAudit(SYSTEM_ACCOUNT_ID, "CONTINUITY_CHAIN_LAG", {
          details: {
            chainId: chain.chainId,
            previousState: priorState,
            newState: classification.state,
            lagMs: classification.lagMs,
            expectedIntervalMs: chain.expectedIntervalMs,
            reason: classification.reason,
          },
        }).catch(() => undefined);
      }

      if (persist) {
        await upsertChainState(chain, observed, classification, now, priorState);
      }

      chainObservations.push({
        chainId: chain.chainId,
        expectedIntervalMs: chain.expectedIntervalMs,
        introspectionAvailable: chain.introspect !== null,
        lastObservedRunAt: observed?.toISOString() ?? null,
        state: classification.state,
        lagMs: classification.lagMs,
        reason: classification.reason,
        stateChanged,
      });
    }

    const durationMs = Date.now() - tickStart;
    const report: SupervisorTickReport = {
      tickAt: now,
      durationMs,
      schedulerHeartbeatAgeMs: schedulerClassification.lagMs,
      schedulerState: schedulerClassification.state,
      schedulerReason: schedulerClassification.reason,
      chainsChecked: registry.length,
      chainsHealthy: healthy,
      chainsDegraded: degraded,
      chainsDead: dead,
      chainsUnknown: unknown,
      chains: chainObservations,
    };

    continuityMetrics.supervisorTicksTotal.inc();
    continuityMetrics.supervisorLastTickEpochSeconds.set({}, Math.floor(now.getTime() / 1000));

    if (persist) {
      try {
        await db.insert(continuitySupervisorTicks).values({
          tickAt: now,
          durationMs,
          schedulerHeartbeatAgeMs: schedulerClassification.lagMs,
          schedulerState: schedulerClassification.state,
          chainsChecked: registry.length,
          chainsHealthy: healthy,
          chainsDegraded: degraded,
          chainsDead: dead,
          chainsUnknown: unknown,
          details: chainObservations as any,
        });
      } catch (err) {
        logger.error(
          { component: "continuity-supervisor", err: String(err) },
          "[ContinuitySupervisor] failed to persist supervisor tick row",
        );
      }
    }

    lastSupervisorTickAt = now;
    lastSupervisorReport = report;
    return report;
  })();

  try {
    return await inFlightSupervisor;
  } finally {
    inFlightSupervisor = null;
  }
}

export function getSupervisorHealth(): {
  supervisorUp: boolean;
  lastSupervisorTickAt: string | null;
  lastReport: SupervisorTickReport | null;
  intervalMs: number;
} {
  return {
    supervisorUp: supervisorTimer !== null,
    lastSupervisorTickAt: lastSupervisorTickAt ? lastSupervisorTickAt.toISOString() : null,
    lastReport: lastSupervisorReport,
    intervalMs: getSupervisorIntervalMs(),
  };
}

function scheduleNextSupervisorTick(): void {
  if (isShuttingDown) return;
  const base = getSupervisorIntervalMs();
  const jitter = (Math.random() * 2 - 1) * SUPERVISOR_JITTER_MS;
  const delay = Math.max(1000, base + jitter);
  supervisorTimer = setTimeout(async () => {
    try {
      await runSupervisorTick();
    } catch (err) {
      logger.error(
        { component: "continuity-supervisor", err: String(err) },
        "[ContinuitySupervisor] uncaught tick error",
      );
    }
    scheduleNextSupervisorTick();
  }, delay);
  if (typeof supervisorTimer === "object" && supervisorTimer && "unref" in supervisorTimer) {
    (supervisorTimer as any).unref();
  }
}

export function startContinuitySupervisor(): void {
  if (process.env.CONTINUITY_SUPERVISOR_DISABLED === "true") {
    logger.info(
      { component: "continuity-supervisor" },
      "[ContinuitySupervisor] disabled via CONTINUITY_SUPERVISOR_DISABLED",
    );
    continuityMetrics.supervisorUp.set({}, 0);
    return;
  }
  if (supervisorTimer) {
    logger.warn({ component: "continuity-supervisor" }, "[ContinuitySupervisor] already running");
    return;
  }
  isShuttingDown = false;
  continuityMetrics.supervisorUp.set({}, 1);
  const intervalMs = getSupervisorIntervalMs();
  logger.info(
    { component: "continuity-supervisor", intervalMs },
    "[ContinuitySupervisor] starting (first tick in 90s, then every 5min)",
  );
  // First tick after 90s so the scheduler has produced at least one
  // continuity_ticks row before we evaluate its heartbeat.
  supervisorTimer = setTimeout(async () => {
    try {
      await runSupervisorTick();
    } catch (err) {
      logger.error(
        { component: "continuity-supervisor", err: String(err) },
        "[ContinuitySupervisor] uncaught initial tick error",
      );
    }
    scheduleNextSupervisorTick();
  }, 90_000);
  if (typeof supervisorTimer === "object" && supervisorTimer && "unref" in supervisorTimer) {
    (supervisorTimer as any).unref();
  }
}

export async function stopContinuitySupervisor(): Promise<void> {
  isShuttingDown = true;
  if (supervisorTimer) {
    clearTimeout(supervisorTimer);
    supervisorTimer = null;
  }
  continuityMetrics.supervisorUp.set({}, 0);
  if (inFlightSupervisor) {
    try {
      await inFlightSupervisor;
    } catch {
      // already logged
    }
  }
  logger.info({ component: "continuity-supervisor" }, "[ContinuitySupervisor] stopped");
}

export function _resetSupervisorState(): void {
  isShuttingDown = false;
  if (supervisorTimer) {
    clearTimeout(supervisorTimer);
    supervisorTimer = null;
  }
  inFlightSupervisor = null;
  lastSupervisorTickAt = null;
  lastSupervisorReport = null;
}
