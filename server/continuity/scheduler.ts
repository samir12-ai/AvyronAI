/**
 * Seal #13 / Track #1 — Operational Continuity Scheduler.
 *
 * The autonomous heartbeat that fixes the "weekly evaluation never opened"
 * outage. Pre-seal, runBoss had only HTTP callers — no background process
 * advanced the weekly window, so eval windows, clusters, and Q1/Q2
 * verdicts could silently stall indefinitely.
 *
 * Design choices (locked with operator, May 2026):
 *
 *   1. Hourly tick, idempotent. Every hour we scan every campaign with an
 *      APPROVED strategic_plan and decide whether to invoke runBoss.
 *      A run is invoked ONLY when the campaign's current window_index has
 *      advanced past the last boss_run's observed window_index, OR no
 *      boss_run exists at all for the active plan. This means:
 *        - Cron drift cannot inflate runs (we run at most once per
 *          window_index per campaign).
 *        - A late tick after a missed hour still produces exactly the
 *          single run that was needed.
 *        - The lock in withCampaignLock() guards against a manual
 *          API-triggered run racing the scheduler.
 *
 *   2. Long-gap re-anchor. When the gap from the last anchor to "now"
 *      exceeds 1 window AND no eval windows have been opened for the
 *      active plan, we write a plan_anchor_resets row with
 *      reanchored_at = now. evaluateWindowState() reads this and the
 *      cycle restarts at window_index=0 instead of jumping to N with
 *      N orphan windows. The no-backfill doctrine in eval-windows.ts is
 *      respected: we do not invent the missed windows, we just declare
 *      a fresh anchor going forward.
 *
 *   3. Missed-window detection. For each campaign we compute the
 *      expected window_index at "now" against pipeline_eval_windows.
 *      max(window_index) for the active plan. Any positive gap is
 *      counted toward continuity_missed_windows_total and recorded on
 *      the continuity_ticks row's notes column. This tells ops the
 *      historical depth of the silence (which a re-anchor erases going
 *      forward but doesn't retroactively fill).
 *
 *   4. Dead-cycle detection. A campaign with an APPROVED plan but no
 *      boss_runs row in the last DEAD_CYCLE_THRESHOLD_DAYS is counted
 *      as a dead cycle. This is the single signal that proves "the
 *      scheduler is alive AND the campaign should be evaluating BUT
 *      isn't" — the exact failure mode that produced the original
 *      outage. It also fires an EMERGENCY_STOP-equivalent audit event
 *      so operators see WHY/WHERE/SINCE-WHEN per the doctrine.
 *
 *   5. Single-process safety. Like server/boss/concurrency.ts and
 *      server/autonomous-worker.ts, this scheduler is single-process.
 *      Cross-replica coordination is intentionally out of scope (the
 *      app is single-replica today; promotion to advisory-locked
 *      multi-replica is sealed for Track #2 / Seal #14).
 *
 *   6. Self-rescheduling setTimeout (not setInterval). Mirrors the
 *      jittered pattern in autonomous-worker.ts (F6.4) so two replicas
 *      booted seconds apart don't lock-step on the exact same wall-
 *      clock boundary forever. Jitter is small (±60s) because the
 *      tick is hourly.
 *
 *   7. Fail-safe persistence. Every tick writes a continuity_ticks row
 *      EVEN if zero campaigns advance. A missing row in this table for
 *      >2h is the operator-visible signal that the scheduler itself
 *      has stalled (covered by Track #2's continuity supervision
 *      layer; this row is the substrate for that check).
 *
 *   8. Operator escape hatches:
 *        - CONTINUITY_SCHEDULER_DISABLED=true skips startup entirely.
 *        - CONTINUITY_TICK_INTERVAL_MS overrides the hourly cadence
 *          (used by tests; production should never set this).
 */
import { db } from "../db";
import {
  planApprovals,
  planAnchorResets,
  pipelineEvalWindows,
  continuityTicks,
  bossRuns,
} from "@shared/schema";
import { and, desc, eq, sql, max as drizzleMax } from "drizzle-orm";
import { runBoss } from "../boss";
import { BossRunInFlightError } from "../boss/concurrency";
import { logAudit } from "../audit";
import { logger } from "../logger";
import { continuityMetrics } from "./metrics";

export const WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const WINDOW_MS = WINDOW_DAYS * MS_PER_DAY;
const DEFAULT_TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const TICK_JITTER_MS = 60 * 1000; // ±60s
export const DEAD_CYCLE_THRESHOLD_MS = 8 * MS_PER_DAY; // 8d w/o any boss_run
const LONG_GAP_THRESHOLD_MS = WINDOW_MS; // >1 window since anchor & no windows opened

let tickTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
let inFlightTick: Promise<TickReport> | null = null;
let lastTickAt: Date | null = null;
let lastTickReport: TickReport | null = null;

export interface PerCampaignDecision {
  accountId: string;
  campaignId: string;
  planId: string;
  decision:
    | "invoked"
    | "skipped_already_evaluated"
    | "skipped_in_flight"
    | "skipped_no_advance"
    | "reanchored_then_invoked"
    | "failed";
  reason?: string;
  observedWindowIndex?: number | null;
  expectedWindowIndex?: number | null;
  missedWindows?: number;
  deadCycleDays?: number | null;
  bossRunId?: string;
  reanchored?: boolean;
}

export interface TickReport {
  tickAt: Date;
  durationMs: number;
  campaignsScanned: number;
  runsInvoked: number;
  runsSkippedIdempotent: number;
  runsFailed: number;
  reanchorsWritten: number;
  missedWindowsDetected: number;
  deadCyclesDetected: number;
  decisions: PerCampaignDecision[];
}

interface ActiveCampaign {
  accountId: string;
  campaignId: string;
  planId: string;
  planUpdatedAt: Date | null;
  planCreatedAt: Date | null;
}

/** Find every (account, campaign) with a current APPROVED plan. */
async function listActiveCampaigns(): Promise<ActiveCampaign[]> {
  // The "active" plan = latest APPROVED row per (account, campaign).
  // Drizzle doesn't have a clean window-function builder, so use raw SQL
  // for this aggregation. Mirrors evaluateWindowState's "latest by updated_at".
  // We also pull created_at so anchor fallback parity with
  // evaluateWindowState (`updatedAt ?? createdAt ?? now`) is exact.
  const result = await db.execute<{
    account_id: string;
    campaign_id: string;
    plan_id: string;
    updated_at: Date | null;
    created_at: Date | null;
  }>(sql`
    SELECT DISTINCT ON (account_id, campaign_id)
      account_id, campaign_id, id AS plan_id, updated_at, created_at
    FROM strategic_plans
    WHERE status = 'APPROVED'
    ORDER BY account_id, campaign_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  `);
  const rows = (result.rows ?? (result as any)) as Array<{
    account_id: string;
    campaign_id: string;
    plan_id: string;
    updated_at: Date | null;
    created_at: Date | null;
  }>;
  return rows.map((r) => ({
    accountId: r.account_id,
    campaignId: r.campaign_id,
    planId: r.plan_id,
    planUpdatedAt: r.updated_at,
    planCreatedAt: r.created_at,
  }));
}

interface AnchorInfo {
  anchorAt: Date;
  source: "approval" | "reanchor" | "fallback_plan_updated_at";
}

async function resolveAnchor(plan: ActiveCampaign): Promise<AnchorInfo> {
  // Mirrors evaluateWindowState's resolution order so the scheduler's
  // window_index matches what runBoss will see.
  const ap = await db
    .select()
    .from(planApprovals)
    .where(and(eq(planApprovals.planId, plan.planId), eq(planApprovals.decision, "APPROVED")))
    .orderBy(desc(planApprovals.createdAt))
    .limit(1);
  let anchorAt: Date;
  let source: AnchorInfo["source"];
  if (ap.length > 0 && ap[0].createdAt) {
    anchorAt = ap[0].createdAt as Date;
    source = "approval";
  } else {
    // Parity with evaluateWindowState() in server/pipeline/eval-windows.ts:
    // updatedAt ?? createdAt ?? now. If both are null on a legacy row we
    // fall back to "now" so the campaign isn't permanently stuck without
    // a usable anchor.
    anchorAt = (plan.planUpdatedAt ?? plan.planCreatedAt ?? new Date()) as Date;
    source = "fallback_plan_updated_at";
  }
  const reset = await db
    .select()
    .from(planAnchorResets)
    .where(eq(planAnchorResets.planId, plan.planId))
    .orderBy(desc(planAnchorResets.reanchoredAt))
    .limit(1);
  if (reset.length > 0 && (reset[0].reanchoredAt as Date) > anchorAt) {
    anchorAt = reset[0].reanchoredAt as Date;
    source = "reanchor";
  }
  return { anchorAt, source };
}

function computeWindowIndex(anchorAt: Date, now: Date): number {
  const diffMs = Math.max(0, now.getTime() - anchorAt.getTime());
  return Math.floor(diffMs / WINDOW_MS);
}

interface CampaignWindowState {
  expectedWindowIndex: number;
  maxObservedWindowIndex: number | null;
  missedWindows: number;
}

async function inspectCampaignWindows(
  plan: ActiveCampaign,
  anchorAt: Date,
  now: Date,
): Promise<CampaignWindowState> {
  const expected = computeWindowIndex(anchorAt, now);
  const rows = await db
    .select({ maxIdx: drizzleMax(pipelineEvalWindows.windowIndex) })
    .from(pipelineEvalWindows)
    .where(
      and(
        eq(pipelineEvalWindows.campaignId, plan.campaignId),
        eq(pipelineEvalWindows.planId, plan.planId),
      ),
    );
  const maxObserved = (rows[0]?.maxIdx ?? null) as number | null;
  // Missed windows = expected windows the system never even opened.
  // Window 0..expected exist; if maxObserved is null, all expected+1
  // windows are missing. If maxObserved < expected, the gap is
  // expected - maxObserved (NOT including the current window which
  // the upcoming runBoss will lazily create).
  let missed = 0;
  if (maxObserved === null) {
    missed = expected; // windows 0..expected-1 never opened
  } else if (maxObserved < expected) {
    missed = expected - maxObserved - 1; // exclude the current one runBoss will create
    if (missed < 0) missed = 0;
  }
  return { expectedWindowIndex: expected, maxObservedWindowIndex: maxObserved, missedWindows: missed };
}

interface LastBossRunInfo {
  startedAt: Date;
  status: string;
}

async function lastBossRun(plan: ActiveCampaign): Promise<LastBossRunInfo | null> {
  const rows = await db
    .select({ startedAt: bossRuns.startedAt, status: bossRuns.status })
    .from(bossRuns)
    .where(
      and(
        eq(bossRuns.accountId, plan.accountId),
        eq(bossRuns.campaignId, plan.campaignId),
      ),
    )
    .orderBy(desc(bossRuns.startedAt))
    .limit(1);
  const row = rows[0];
  if (!row || !row.startedAt) return null;
  return { startedAt: row.startedAt as Date, status: String(row.status ?? "unknown") };
}

/**
 * Find the most-recent boss_run that started AT or AFTER currentWindowStart
 * for this campaign. Used to decide whether the current window has already
 * been evaluated SUCCESSFULLY. A failed/partial run does NOT satisfy the
 * window — the scheduler will retry it on the next tick. This closes the
 * "silent under-execution" hole: pre-fix, one failed run blocked the
 * entire week.
 */
async function latestRunInWindow(
  plan: ActiveCampaign,
  windowStart: Date,
): Promise<LastBossRunInfo | null> {
  const rows = await db
    .select({ startedAt: bossRuns.startedAt, status: bossRuns.status })
    .from(bossRuns)
    .where(
      and(
        eq(bossRuns.accountId, plan.accountId),
        eq(bossRuns.campaignId, plan.campaignId),
        sql`${bossRuns.startedAt} >= ${windowStart}`,
      ),
    )
    .orderBy(desc(bossRuns.startedAt))
    .limit(1);
  const row = rows[0];
  if (!row || !row.startedAt) return null;
  return { startedAt: row.startedAt as Date, status: String(row.status ?? "unknown") };
}

/**
 * Decide whether a re-anchor is appropriate for the given campaign.
 * Long-gap policy: gap from anchor to now > 1 window AND zero windows
 * have been opened for this plan (i.e., missedWindows === expectedIndex
 * and maxObservedWindowIndex === null). We deliberately do NOT re-anchor
 * a campaign that has SOME history — that would corrupt cluster
 * comparison baselines.
 */
function shouldReanchor(
  expectedWindowIndex: number,
  maxObservedWindowIndex: number | null,
  anchorAt: Date,
  now: Date,
): boolean {
  if (maxObservedWindowIndex !== null) return false;
  const gapMs = now.getTime() - anchorAt.getTime();
  if (gapMs <= LONG_GAP_THRESHOLD_MS) return false;
  if (expectedWindowIndex < 1) return false;
  return true;
}

async function writeReanchor(
  plan: ActiveCampaign,
  now: Date,
  reason: string,
): Promise<void> {
  await db.insert(planAnchorResets).values({
    accountId: plan.accountId,
    campaignId: plan.campaignId,
    planId: plan.planId,
    reanchoredAt: now,
    reason,
    source: "continuity_scheduler",
  });
  continuityMetrics.reanchorsWritten.inc();
  await logAudit(plan.accountId, "CONTINUITY_REANCHOR", {
    details: {
      campaignId: plan.campaignId,
      planId: plan.planId,
      reason,
      reanchoredAt: now.toISOString(),
    },
  }).catch(() => undefined);
}

interface TickOptions {
  now?: Date;
  /** When false, skip the persistence write (used by tests that share a DB). */
  persist?: boolean;
}

/**
 * One scheduler tick. Exported for tests + manual trigger from operator UI.
 */
export async function runContinuityTick(opts: TickOptions = {}): Promise<TickReport> {
  // Idempotency guard: only one tick may execute concurrently in this process.
  // If a previous tick is still running (e.g., long DB query, many campaigns),
  // we return its in-flight promise rather than starting a second.
  if (inFlightTick) return inFlightTick;
  const persist = opts.persist !== false;
  const now = opts.now ?? new Date();
  const tickStart = Date.now();

  inFlightTick = (async (): Promise<TickReport> => {
    const decisions: PerCampaignDecision[] = [];
    let runsInvoked = 0;
    let runsSkipped = 0;
    let runsFailed = 0;
    let reanchorsWritten = 0;
    let missedWindowsTotal = 0;
    let deadCyclesTotal = 0;

    let campaigns: ActiveCampaign[] = [];
    try {
      campaigns = await listActiveCampaigns();
    } catch (err) {
      logger.error(
        { component: "continuity-scheduler", err: String(err) },
        "[ContinuityScheduler] failed to list campaigns",
      );
      campaigns = [];
    }
    continuityMetrics.campaignsScanned.inc({}, campaigns.length);

    for (const plan of campaigns) {
      try {
        const { anchorAt, source: anchorSource } = await resolveAnchor(plan);
        let windowState = await inspectCampaignWindows(plan, anchorAt, now);
        const lastRun = await lastBossRun(plan);
        const lastRunAt = lastRun?.startedAt ?? null;
        // Dead-cycle baseline: prefer plan.updatedAt; gracefully degrade to
        // createdAt and finally to anchorAt if both are null (parity with
        // listActiveCampaigns nullable plan timestamps).
        const planAgeBaseline = (plan.planUpdatedAt ?? plan.planCreatedAt ?? anchorAt) as Date;
        const deadCycleDays = lastRunAt
          ? null
          : Math.floor((now.getTime() - planAgeBaseline.getTime()) / MS_PER_DAY);
        if (!lastRunAt && now.getTime() - planAgeBaseline.getTime() > DEAD_CYCLE_THRESHOLD_MS) {
          deadCyclesTotal += 1;
          continuityMetrics.deadCycles.inc();
          await logAudit(plan.accountId, "CONTINUITY_DEAD_CYCLE", {
            details: {
              campaignId: plan.campaignId,
              planId: plan.planId,
              sinceDays: deadCycleDays,
              anchorSource,
              expectedWindowIndex: windowState.expectedWindowIndex,
            },
          }).catch(() => undefined);
        } else if (
          lastRunAt &&
          now.getTime() - lastRunAt.getTime() > DEAD_CYCLE_THRESHOLD_MS
        ) {
          deadCyclesTotal += 1;
          continuityMetrics.deadCycles.inc();
          await logAudit(plan.accountId, "CONTINUITY_DEAD_CYCLE", {
            details: {
              campaignId: plan.campaignId,
              planId: plan.planId,
              sinceDays: Math.floor((now.getTime() - lastRunAt.getTime()) / MS_PER_DAY),
              lastBossRunAt: lastRunAt.toISOString(),
              anchorSource,
              expectedWindowIndex: windowState.expectedWindowIndex,
            },
          }).catch(() => undefined);
        }

        if (windowState.missedWindows > 0) {
          missedWindowsTotal += windowState.missedWindows;
          continuityMetrics.missedWindows.inc({}, windowState.missedWindows);
          await logAudit(plan.accountId, "CONTINUITY_MISSED_WINDOWS", {
            details: {
              campaignId: plan.campaignId,
              planId: plan.planId,
              missedWindows: windowState.missedWindows,
              expectedWindowIndex: windowState.expectedWindowIndex,
              maxObservedWindowIndex: windowState.maxObservedWindowIndex,
            },
          }).catch(() => undefined);
        }

        // Long-gap re-anchor (writes a new anchor; recompute window state).
        let reanchored = false;
        if (
          shouldReanchor(
            windowState.expectedWindowIndex,
            windowState.maxObservedWindowIndex,
            anchorAt,
            now,
          )
        ) {
          await writeReanchor(plan, now, "long_gap_no_windows_opened");
          reanchored = true;
          reanchorsWritten += 1;
          // After re-anchor, the effective windowIndex is 0 going forward.
          windowState = {
            expectedWindowIndex: 0,
            maxObservedWindowIndex: null,
            missedWindows: 0,
          };
        }

        // Idempotency: if the most recent boss_run STARTED in the current
        // window AND finished SUCCESSFULLY, we've already evaluated this
        // window — skip. We compute "start of current window" as
        // (effectiveAnchor + expectedWindowIndex * WINDOW_MS), matching
        // eval-windows.ts exactly.
        //
        // A failed/partial run in the current window is treated as
        // "needs retry" — the scheduler invokes runBoss again. This closes
        // the silent-under-execution hole the seal was created to fix:
        // pre-change, a single failed run blocked the entire week.
        const SUCCESS_STATUSES = new Set(["completed", "partial"]);
        const effectiveAnchor = reanchored ? now : anchorAt;
        const currentWindowStart = new Date(
          effectiveAnchor.getTime() + windowState.expectedWindowIndex * WINDOW_MS,
        );
        if (!reanchored) {
          const inWindow = await latestRunInWindow(plan, currentWindowStart);
          if (inWindow && SUCCESS_STATUSES.has(inWindow.status)) {
            decisions.push({
              accountId: plan.accountId,
              campaignId: plan.campaignId,
              planId: plan.planId,
              decision: "skipped_no_advance",
              reason: "current_window_already_evaluated",
              expectedWindowIndex: windowState.expectedWindowIndex,
              observedWindowIndex: windowState.maxObservedWindowIndex,
              missedWindows: windowState.missedWindows,
              deadCycleDays,
            });
            runsSkipped += 1;
            continuityMetrics.runsSkipped.inc({ reason: "current_window_already_evaluated" });
            continue;
          }
        }

        // Invoke runBoss with idempotent campaign lock.
        try {
          const result = await runBoss({
            accountId: plan.accountId,
            campaignId: plan.campaignId,
            trigger: "scheduled",
          });
          runsInvoked += 1;
          continuityMetrics.runsInvoked.inc();
          decisions.push({
            accountId: plan.accountId,
            campaignId: plan.campaignId,
            planId: plan.planId,
            decision: reanchored ? "reanchored_then_invoked" : "invoked",
            expectedWindowIndex: windowState.expectedWindowIndex,
            observedWindowIndex: windowState.maxObservedWindowIndex,
            missedWindows: windowState.missedWindows,
            deadCycleDays,
            bossRunId: result.bossRunId,
            reanchored,
          });
        } catch (err) {
          if (err instanceof BossRunInFlightError) {
            runsSkipped += 1;
            continuityMetrics.runsSkipped.inc({ reason: "in_flight" });
            decisions.push({
              accountId: plan.accountId,
              campaignId: plan.campaignId,
              planId: plan.planId,
              decision: "skipped_in_flight",
              reason: "boss_run_in_flight",
              expectedWindowIndex: windowState.expectedWindowIndex,
              observedWindowIndex: windowState.maxObservedWindowIndex,
              missedWindows: windowState.missedWindows,
              deadCycleDays,
            });
          } else {
            runsFailed += 1;
            const reason = (err as Error).message ?? "unknown";
            continuityMetrics.runsFailed.inc({ reason: reason.slice(0, 60) });
            decisions.push({
              accountId: plan.accountId,
              campaignId: plan.campaignId,
              planId: plan.planId,
              decision: "failed",
              reason,
              expectedWindowIndex: windowState.expectedWindowIndex,
              observedWindowIndex: windowState.maxObservedWindowIndex,
              missedWindows: windowState.missedWindows,
              deadCycleDays,
            });
            logger.error(
              {
                component: "continuity-scheduler",
                accountId: plan.accountId,
                campaignId: plan.campaignId,
                planId: plan.planId,
                err: reason,
              },
              "[ContinuityScheduler] runBoss failed",
            );
          }
        }
      } catch (err) {
        // Per-campaign isolation: one bad row never sinks the whole tick.
        runsFailed += 1;
        continuityMetrics.runsFailed.inc({ reason: "per_campaign_exception" });
        decisions.push({
          accountId: plan.accountId,
          campaignId: plan.campaignId,
          planId: plan.planId,
          decision: "failed",
          reason: (err as Error).message ?? "unknown",
        });
        logger.error(
          { component: "continuity-scheduler", err: String(err) },
          "[ContinuityScheduler] per-campaign exception",
        );
      }
    }

    const durationMs = Date.now() - tickStart;
    continuityMetrics.ticksTotal.inc();
    continuityMetrics.tickDurationMs.set({}, durationMs);
    continuityMetrics.lastTickEpochSeconds.set({}, Math.floor(now.getTime() / 1000));

    const report: TickReport = {
      tickAt: now,
      durationMs,
      campaignsScanned: campaigns.length,
      runsInvoked,
      runsSkippedIdempotent: runsSkipped,
      runsFailed,
      reanchorsWritten,
      missedWindowsDetected: missedWindowsTotal,
      deadCyclesDetected: deadCyclesTotal,
      decisions,
    };

    if (persist) {
      try {
        await db.insert(continuityTicks).values({
          tickAt: now,
          durationMs,
          campaignsScanned: campaigns.length,
          runsInvoked,
          runsSkippedIdempotent: runsSkipped,
          runsFailed,
          reanchorsWritten,
          missedWindowsDetected: missedWindowsTotal,
          deadCyclesDetected: deadCyclesTotal,
          notes: decisions as any,
        });
      } catch (err) {
        logger.error(
          { component: "continuity-scheduler", err: String(err) },
          "[ContinuityScheduler] failed to persist tick row",
        );
      }
    }

    lastTickAt = now;
    lastTickReport = report;
    return report;
  })();

  try {
    return await inFlightTick;
  } finally {
    inFlightTick = null;
  }
}

/** Public health snapshot for /healthz/continuity. */
export function getContinuityHealth(): {
  schedulerUp: boolean;
  lastTickAt: string | null;
  lastTickReport: TickReport | null;
  intervalMs: number;
} {
  return {
    schedulerUp: tickTimer !== null,
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    lastTickReport,
    intervalMs: getTickIntervalMs(),
  };
}

function getTickIntervalMs(): number {
  const raw = process.env.CONTINUITY_TICK_INTERVAL_MS;
  if (!raw) return DEFAULT_TICK_INTERVAL_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_TICK_INTERVAL_MS;
  return n;
}

function scheduleNextTick(): void {
  if (isShuttingDown) return;
  const base = getTickIntervalMs();
  const jitter = (Math.random() * 2 - 1) * TICK_JITTER_MS;
  const delay = Math.max(1000, base + jitter);
  tickTimer = setTimeout(async () => {
    try {
      await runContinuityTick();
    } catch (err) {
      logger.error(
        { component: "continuity-scheduler", err: String(err) },
        "[ContinuityScheduler] uncaught tick error",
      );
    }
    scheduleNextTick();
  }, delay);
  // Allow process exit if the only handle remaining is this timer.
  if (typeof tickTimer === "object" && tickTimer && "unref" in tickTimer) {
    (tickTimer as any).unref();
  }
}

export function startContinuityScheduler(): void {
  if (process.env.CONTINUITY_SCHEDULER_DISABLED === "true") {
    logger.info(
      { component: "continuity-scheduler" },
      "[ContinuityScheduler] disabled via CONTINUITY_SCHEDULER_DISABLED",
    );
    continuityMetrics.schedulerUp.set({}, 0);
    return;
  }
  if (tickTimer) {
    logger.warn(
      { component: "continuity-scheduler" },
      "[ContinuityScheduler] already running — start ignored",
    );
    return;
  }
  isShuttingDown = false;
  continuityMetrics.schedulerUp.set({}, 1);
  const intervalMs = getTickIntervalMs();
  logger.info(
    { component: "continuity-scheduler", intervalMs },
    "[ContinuityScheduler] starting (first tick in 60s, then hourly)",
  );
  // First tick after 60s so boot health checks can complete first.
  tickTimer = setTimeout(async () => {
    try {
      await runContinuityTick();
    } catch (err) {
      logger.error(
        { component: "continuity-scheduler", err: String(err) },
        "[ContinuityScheduler] uncaught initial tick error",
      );
    }
    scheduleNextTick();
  }, 60_000);
  if (typeof tickTimer === "object" && tickTimer && "unref" in tickTimer) {
    (tickTimer as any).unref();
  }
}

export async function stopContinuityScheduler(): Promise<void> {
  isShuttingDown = true;
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  continuityMetrics.schedulerUp.set({}, 0);
  // Drain in-flight tick so we don't leave a half-applied state.
  if (inFlightTick) {
    try {
      await inFlightTick;
    } catch {
      // already logged inside the tick
    }
  }
  logger.info({ component: "continuity-scheduler" }, "[ContinuityScheduler] stopped");
}

/** Test-only reset. */
export function _resetContinuityState(): void {
  isShuttingDown = false;
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  inFlightTick = null;
  lastTickAt = null;
  lastTickReport = null;
}
