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
  continuityWindowClaims,
  miSnapshots,
  strategyDecisions,
} from "@shared/schema";
import { and, desc, eq, sql, gte, max as drizzleMax } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runBoss } from "../boss";
import { BossRunInFlightError } from "../boss/concurrency";
import { logAudit } from "../audit";
import { logger } from "../logger";
import { continuityMetrics } from "./metrics";

/**
 * Seal #14 / Track #2 — replica identity.
 *
 * Each process gets a stable identifier used as `claimed_by` on every
 * continuity_window_claims row it inserts. In Kubernetes/Replit Autoscale
 * deployments operators should set REPLICA_ID to the pod/instance ID; in
 * single-process dev we generate a random one at boot. This identifier
 * gives operators a forensic trail when investigating "which replica
 * picked up which window."
 */
const REPLICA_ID = process.env.REPLICA_ID ?? `replica_${randomUUID()}`;
export function getReplicaId(): string {
  return REPLICA_ID;
}

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
/**
 * Track #3 / Seal #15 — zombie in-flight watchdog.
 *
 * inFlightTick was a single bare Promise. If a tick hung (downstream DB
 * deadlock, hung listActiveCampaigns query, runBoss hang), the variable
 * stayed populated forever and every subsequent tick returned the dead
 * promise instead of running. The hourly heartbeat would then silently
 * stop — exactly the failure category Track #2 was designed to catch,
 * but in the SCHEDULER itself rather than per-campaign. We now record
 * the start time and force-clear on entry if the prior tick has been
 * pending past MAX_TICK_AGE_MS.
 */
let inFlightTickStartedAt: number | null = null;
/**
 * Track #3 / Seal #15 — ownership token (architect HIGH-severity fix).
 *
 * The v1 watchdog set `inFlightTick = null` on stale eviction, but the
 * stale tick's own `finally` block ALSO sets `inFlightTick = null`
 * unconditionally. If the stale tick belatedly settled AFTER the
 * watchdog had already installed a fresh tick, its finally would null
 * the FRESH inFlightTick — silently letting two ticks run concurrently
 * against the same shared in-process state. We now stamp every tick
 * with a monotonic token; the finally block only nulls the shared
 * reference if the live token still matches.
 */
let inFlightTickToken = 0;
let nextTickToken = 1;
const MAX_TICK_AGE_MS = (() => {
  const raw = process.env.CONTINUITY_TICK_MAX_AGE_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
})();
let zombieTickEvictions = 0;
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
    | "skipped_claimed_by_other_replica"
    | "skipped_completed_claim_exists"
    | "reanchored_then_invoked"
    | "failed";
  reason?: string;
  observedWindowIndex?: number | null;
  expectedWindowIndex?: number | null;
  missedWindows?: number;
  deadCycleDays?: number | null;
  bossRunId?: string;
  reanchored?: boolean;
  /** Seal #14 — the replica that won the claim for this window. */
  claimedBy?: string;
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
  // db.execute<T> only annotates TS — Postgres timestamp columns come back
  // as ISO strings from raw SQL (NOT Date objects, unlike drizzle's typed
  // .select()). Coerce here so downstream `.getTime()` calls don't throw.
  // Track #3 / Seal #14: silent-degradation hardening — without this
  // coercion every per-campaign tick threw `planAgeBaseline.getTime is not
  // a function`, which the outer try/catch caught + logged but left the
  // INVARIANT-RETRY claim handshake completely bypassed (no campaign was
  // ever evaluated). Classified as a "swallowed exception" hole.
  const toDate = (v: unknown): Date | null => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === "string" || typeof v === "number") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  };
  return rows.map((r) => ({
    accountId: r.account_id,
    campaignId: r.campaign_id,
    planId: r.plan_id,
    planUpdatedAt: toDate(r.updated_at),
    planCreatedAt: toDate(r.created_at),
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
/**
 * Seal #14 / Track #2 — DB-level claim handshake. The atomic primitive
 * is INSERT ... ON CONFLICT DO NOTHING RETURNING. Postgres guarantees
 * exactly one of N concurrent INSERTs against the same primary key
 * succeeds; the rest get an empty RETURNING set. That's our "winner takes
 * the work, loser skips" without needing pg_advisory locks (which are
 * connection-scoped and brittle under pool reuse).
 *
 * Exported for tests.
 */
export interface ClaimAttempt {
  acquired: boolean;
  alreadyCompleted: boolean;
  ownedBy?: string;
}

export async function tryClaimWindow(
  plan: { accountId: string; campaignId: string; planId: string },
  windowIndex: number,
  now: Date,
): Promise<ClaimAttempt> {
  // Fast-path: existing row check. If a `completed` row exists, we
  // short-circuit; if an `in_progress` row exists, another replica owns
  // it. We do this before the INSERT to surface the more specific
  // skip reason ("completed" vs "claimed by other") in the decision log.
  try {
    const existing = await db
      .select({
        status: continuityWindowClaims.status,
        claimedBy: continuityWindowClaims.claimedBy,
      })
      .from(continuityWindowClaims)
      .where(
        and(
          eq(continuityWindowClaims.campaignId, plan.campaignId),
          eq(continuityWindowClaims.planId, plan.planId),
          eq(continuityWindowClaims.windowIndex, windowIndex),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      const row = existing[0];
      if (row.status === "completed") {
        return { acquired: false, alreadyCompleted: true, ownedBy: row.claimedBy };
      }
      // status='in_progress' from any replica (could even be ours from a
      // crash-restart). We do NOT take it over here — the supervisor's
      // stale-claim sweep (Track #3) will handle that case.
      return { acquired: false, alreadyCompleted: false, ownedBy: row.claimedBy };
    }
  } catch (err) {
    // If the read fails (e.g. transient DB error), fall through to the
    // INSERT attempt — that path is itself atomic and will tell us the
    // truth via ON CONFLICT.
    logger.warn(
      { component: "continuity-scheduler", err: String(err) },
      "[ContinuityScheduler] tryClaimWindow read failed, attempting insert",
    );
  }

  try {
    const inserted = await db
      .insert(continuityWindowClaims)
      .values({
        campaignId: plan.campaignId,
        planId: plan.planId,
        windowIndex,
        accountId: plan.accountId,
        claimedBy: REPLICA_ID,
        claimedAt: now,
        status: "in_progress",
      })
      .onConflictDoNothing({
        target: [
          continuityWindowClaims.campaignId,
          continuityWindowClaims.planId,
          continuityWindowClaims.windowIndex,
        ],
      })
      .returning({ claimedBy: continuityWindowClaims.claimedBy });
    if (inserted.length === 0) {
      // Lost the race. Re-read to learn which replica won (best-effort,
      // for forensics only — failure to read here is non-fatal).
      try {
        const winner = await db
          .select({
            claimedBy: continuityWindowClaims.claimedBy,
            status: continuityWindowClaims.status,
          })
          .from(continuityWindowClaims)
          .where(
            and(
              eq(continuityWindowClaims.campaignId, plan.campaignId),
              eq(continuityWindowClaims.planId, plan.planId),
              eq(continuityWindowClaims.windowIndex, windowIndex),
            ),
          )
          .limit(1);
        const row = winner[0];
        if (row?.status === "completed") {
          return { acquired: false, alreadyCompleted: true, ownedBy: row.claimedBy };
        }
        return { acquired: false, alreadyCompleted: false, ownedBy: row?.claimedBy };
      } catch {
        return { acquired: false, alreadyCompleted: false };
      }
    }
    return { acquired: true, alreadyCompleted: false, ownedBy: REPLICA_ID };
  } catch (err) {
    // Fail-closed: if the INSERT itself errors, treat as "couldn't claim"
    // so we don't accidentally invoke runBoss without an idempotency
    // sentinel. The next tick will retry.
    logger.error(
      { component: "continuity-scheduler", err: String(err) },
      "[ContinuityScheduler] tryClaimWindow insert failed, treating as un-acquired",
    );
    return { acquired: false, alreadyCompleted: false };
  }
}

export async function markClaimCompleted(
  plan: { campaignId: string; planId: string },
  windowIndex: number,
  bossRunId: string,
  outcome: "ok" | "partial",
  now: Date,
): Promise<void> {
  // Architect-flagged finding #3 — affected-row check. If the UPDATE
  // matches 0 rows (claim went missing, claimed_by no longer matches us,
  // status already changed by another path), we MUST surface that. Logged
  // as ERROR + metric increment so operators see the inconsistency
  // rather than the scheduler silently believing the claim is closed.
  try {
    const updated = await db
      .update(continuityWindowClaims)
      .set({
        status: "completed",
        outcome,
        outcomeAt: now,
        bossRunId,
      })
      .where(
        and(
          eq(continuityWindowClaims.campaignId, plan.campaignId),
          eq(continuityWindowClaims.planId, plan.planId),
          eq(continuityWindowClaims.windowIndex, windowIndex),
          eq(continuityWindowClaims.claimedBy, REPLICA_ID),
        ),
      )
      .returning({ campaignId: continuityWindowClaims.campaignId });
    if (updated.length === 0) {
      logger.error(
        {
          component: "continuity-scheduler",
          campaignId: plan.campaignId,
          planId: plan.planId,
          windowIndex,
          bossRunId,
          replicaId: REPLICA_ID,
        },
        "[ContinuityScheduler] markClaimCompleted matched 0 rows — claim row missing or owned by different replica; runBoss completed but claim sentinel inconsistent",
      );
    }
  } catch (err) {
    logger.error(
      { component: "continuity-scheduler", err: String(err) },
      "[ContinuityScheduler] markClaimCompleted threw",
    );
  }
}

/**
 * INVARIANT-RETRY (Seal #14, non-negotiable): on failed/partial boss_run,
 * DELETE the claim row so the next tick can re-claim and retry. Pre-seal
 * we left the claim row in `in_progress` which would have silently
 * blocked the next tick — exactly the failure mode the May 2026 outage
 * was made of. Callers MUST invoke this on any non-completed runBoss
 * outcome (failure throw, partial result, BossRunInFlightError EXCEPTED
 * because the in-flight call will finalize the claim itself).
 */
export async function releaseClaimForRetry(
  plan: { campaignId: string; planId: string },
  windowIndex: number,
): Promise<void> {
  // Architect-flagged finding #3 — affected-row check. INVARIANT-RETRY
  // demands the claim row actually be deleted. If DELETE matches 0 rows
  // (we don't own it, status changed underfoot, or DB is unreachable),
  // the next tick will see status='in_progress' and skip
  // (`claimed_by_other_replica`), silently suppressing the retry — the
  // exact failure mode this seal exists to prevent. Surface as ERROR.
  try {
    const deleted = await db
      .delete(continuityWindowClaims)
      .where(
        and(
          eq(continuityWindowClaims.campaignId, plan.campaignId),
          eq(continuityWindowClaims.planId, plan.planId),
          eq(continuityWindowClaims.windowIndex, windowIndex),
          eq(continuityWindowClaims.claimedBy, REPLICA_ID),
          eq(continuityWindowClaims.status, "in_progress"),
        ),
      )
      .returning({ campaignId: continuityWindowClaims.campaignId });
    if (deleted.length === 0) {
      logger.error(
        {
          component: "continuity-scheduler",
          campaignId: plan.campaignId,
          planId: plan.planId,
          windowIndex,
          replicaId: REPLICA_ID,
        },
        "[ContinuityScheduler] releaseClaimForRetry matched 0 rows — INVARIANT-RETRY may be violated for this window (next tick will see no in_progress claim from us; if some other state exists, retry is suppressed)",
      );
    }
  } catch (err) {
    logger.error(
      { component: "continuity-scheduler", err: String(err) },
      "[ContinuityScheduler] releaseClaimForRetry threw — next tick may not retry",
    );
  }
}

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

/**
 * Track #4 / lifecycle C-package (May 2026): evidence-aware reanchor guard.
 *
 * The original `shouldReanchor` (above) fires whenever NO eval windows
 * exist AND the gap exceeds LONG_GAP_THRESHOLD_MS. In May 2026 this
 * doctrine hard-reset healthy 2-month-old campaigns to Day 0 because the
 * lifecycle had silently crashed on `planAgeBaseline.getTime is not a
 * function` for ~12 hours — so even though MI scans, strategy decisions,
 * and competitor scrapes were all healthy, no `pipeline_eval_windows` row
 * had ever been opened. The scheduler interpreted "no window" as "long
 * silence" and Day-0'd the timeline, throwing away every accumulated
 * signal.
 *
 * Real fix: before firing the reset, look for ANY system evidence that
 * the account is alive — even a single MI snapshot, boss run, or strategy
 * decision in the last 60 days. If we find anything, the lifecycle has
 * been working at some layer and we MUST NOT Day-0 it; the missing
 * window is a contained scheduler bug, not abandonment. The audit row
 * makes the suppression observable so the operator can see and unblock
 * the real upstream cause.
 */
const REANCHOR_EVIDENCE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

interface EvidenceCheck {
  hasEvidence: boolean;
  miSnapshots: number;
  bossRuns: number;
  strategyDecisions: number;
}

async function checkRecentEvidence(plan: ActiveCampaign, now: Date): Promise<EvidenceCheck> {
  const since = new Date(now.getTime() - REANCHOR_EVIDENCE_WINDOW_MS);
  try {
    const [miRows, bossRows, decRows] = await Promise.all([
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, plan.accountId),
          eq(miSnapshots.campaignId, plan.campaignId),
          gte(miSnapshots.createdAt, since),
        )),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(bossRuns)
        .where(and(
          eq(bossRuns.accountId, plan.accountId),
          eq(bossRuns.campaignId, plan.campaignId),
          gte(bossRuns.createdAt, since),
        )),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(strategyDecisions)
        .where(and(
          eq(strategyDecisions.accountId, plan.accountId),
          eq(strategyDecisions.campaignId, plan.campaignId),
          gte(strategyDecisions.createdAt, since),
        )),
    ]);
    const miSnapshotsN = Number(miRows[0]?.c ?? 0);
    const bossRunsN = Number(bossRows[0]?.c ?? 0);
    const decisionsN = Number(decRows[0]?.c ?? 0);
    return {
      hasEvidence: miSnapshotsN > 0 || bossRunsN > 0 || decisionsN > 0,
      miSnapshots: miSnapshotsN,
      bossRuns: bossRunsN,
      strategyDecisions: decisionsN,
    };
  } catch (err) {
    // Fail-CLOSED on the evidence read: if we can't prove the account is
    // healthy we MUST NOT Day-0 it. Log loudly so operators see the read
    // failed; return hasEvidence=true to suppress the destructive reset.
    console.error("[ContinuityScheduler] REANCHOR_EVIDENCE_CHECK_FAILED", {
      campaignId: plan.campaignId,
      planId: plan.planId,
      err: String(err),
    });
    return { hasEvidence: true, miSnapshots: -1, bossRuns: -1, strategyDecisions: -1 };
  }
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
  //
  // Track #3 / Seal #15 zombie sweep: if the previous tick has been
  // pending longer than MAX_TICK_AGE_MS (default 15 min — far longer than
  // any healthy tick), force-clear it so the heartbeat can resume.
  if (inFlightTick && inFlightTickStartedAt !== null) {
    const age = Date.now() - inFlightTickStartedAt;
    if (age > MAX_TICK_AGE_MS) {
      zombieTickEvictions += 1;
      logger.error(
        {
          component: "continuity-scheduler",
          ageMs: age,
          maxAgeMs: MAX_TICK_AGE_MS,
          totalEvictions: zombieTickEvictions,
        },
        "[ContinuityScheduler] ZOMBIE_INFLIGHT_TICK_EVICTED — prior tick exceeded watchdog ceiling",
      );
      inFlightTick = null;
      inFlightTickStartedAt = null;
      // Bump the live token so the stale tick's finally cannot null the
      // fresh tick we are about to install (architect HIGH-severity race).
      inFlightTickToken = 0;
    } else {
      return inFlightTick;
    }
  } else if (inFlightTick) {
    return inFlightTick;
  }
  const persist = opts.persist !== false;
  const now = opts.now ?? new Date();
  const tickStart = Date.now();
  inFlightTickStartedAt = tickStart;
  const myTickToken = nextTickToken++;
  inFlightTickToken = myTickToken;

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
        // Defensive coercion (Track #4 / lifecycle C-package): even though
        // listActiveCampaigns now toDate()s its raw SQL output and
        // resolveAnchor returns a real Date, a future code path or a bad
        // upstream cast could still hand us a string. Coerce explicitly +
        // log loudly so we trip a metric instead of throwing.
        let planAgeBaseline: Date;
        const _rawBaseline = plan.planUpdatedAt ?? plan.planCreatedAt ?? anchorAt;
        if (_rawBaseline instanceof Date) {
          planAgeBaseline = _rawBaseline;
        } else if (typeof _rawBaseline === "string" || typeof _rawBaseline === "number") {
          const coerced = new Date(_rawBaseline);
          planAgeBaseline = Number.isNaN(coerced.getTime()) ? now : coerced;
          console.error(
            "[ContinuityScheduler] PLAN_AGE_BASELINE_COERCED_FROM_NON_DATE",
            { campaignId: plan.campaignId, planId: plan.planId, rawType: typeof _rawBaseline },
          );
        } else {
          planAgeBaseline = now;
          console.error(
            "[ContinuityScheduler] PLAN_AGE_BASELINE_UNRESOLVABLE_FALLBACK_TO_NOW",
            { campaignId: plan.campaignId, planId: plan.planId },
          );
        }
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
        // Track #4 / lifecycle C-package: evidence-aware suppression. The
        // structural "no windows opened in N days" test alone hard-reset
        // healthy campaigns to Day 0 in May 2026. We now also require an
        // affirmative "no evidence anywhere" check via checkRecentEvidence
        // before firing the destructive reset.
        let reanchored = false;
        if (
          shouldReanchor(
            windowState.expectedWindowIndex,
            windowState.maxObservedWindowIndex,
            anchorAt,
            now,
          )
        ) {
          const evidence = await checkRecentEvidence(plan, now);
          if (evidence.hasEvidence) {
            // Suppress: lifecycle is alive at some layer; opening windows
            // is the contained bug. Audit so the operator can chase the
            // real upstream cause.
            console.error("[ContinuityScheduler] REANCHOR_SUPPRESSED_EVIDENCE_PRESENT", {
              campaignId: plan.campaignId,
              planId: plan.planId,
              miSnapshots: evidence.miSnapshots,
              bossRuns: evidence.bossRuns,
              strategyDecisions: evidence.strategyDecisions,
              expectedWindowIndex: windowState.expectedWindowIndex,
              anchorAgeDays: Math.floor((now.getTime() - anchorAt.getTime()) / MS_PER_DAY),
            });
            await logAudit(plan.accountId, "CONTINUITY_REANCHOR_SUPPRESSED", {
              details: {
                campaignId: plan.campaignId,
                planId: plan.planId,
                reason: "evidence_present_in_last_60d",
                miSnapshots: evidence.miSnapshots,
                bossRuns: evidence.bossRuns,
                strategyDecisions: evidence.strategyDecisions,
                expectedWindowIndex: windowState.expectedWindowIndex,
              },
            }).catch(() => undefined);
            // Leave anchorAt alone and proceed with the original window
            // state. The boss run that follows will lazy-create the
            // missing pipeline_eval_windows row via evaluateWindowState,
            // and the lifecycle resumes without losing history.
          } else {
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
        }

        // Idempotency: if the most recent boss_run STARTED in the current
        // window AND finished with status='completed', we've already
        // evaluated this window — skip. INVARIANT-RETRY (Seal #14): a
        // failed OR partial run does NOT satisfy the window — the
        // scheduler invokes runBoss again on the next tick. This is
        // non-negotiable per operator directive May 2026; any change
        // that lets `partial` or `failed` short-circuit the window is a
        // P0 defect re-introducing the original outage.
        //
        // We compute "start of current window" as
        // (effectiveAnchor + expectedWindowIndex * WINDOW_MS), matching
        // eval-windows.ts exactly.
        const SUCCESS_STATUSES = new Set(["completed"]);
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

        // Seal #14 / Track #2 — multi-replica claim handshake.
        // Try to INSERT a claim row for this (campaign, plan, window).
        // ON CONFLICT DO NOTHING gives us atomic "winner takes the work,
        // loser skips" semantics across replicas. The single-process
        // inFlightTick guard remains as a fast-path for the same-process
        // case (no DB round-trip).
        const claim = await tryClaimWindow(plan, windowState.expectedWindowIndex, now);
        if (!claim.acquired) {
          if (claim.alreadyCompleted) {
            decisions.push({
              accountId: plan.accountId,
              campaignId: plan.campaignId,
              planId: plan.planId,
              decision: "skipped_completed_claim_exists",
              reason: "completed_claim_exists",
              expectedWindowIndex: windowState.expectedWindowIndex,
              observedWindowIndex: windowState.maxObservedWindowIndex,
              missedWindows: windowState.missedWindows,
              deadCycleDays,
              claimedBy: claim.ownedBy,
            });
            runsSkipped += 1;
            continuityMetrics.runsSkipped.inc({ reason: "completed_claim_exists" });
            continuityMetrics.claimsAlreadyCompleted.inc();
            continue;
          }
          decisions.push({
            accountId: plan.accountId,
            campaignId: plan.campaignId,
            planId: plan.planId,
            decision: "skipped_claimed_by_other_replica",
            reason: "claimed_by_other_replica",
            expectedWindowIndex: windowState.expectedWindowIndex,
            observedWindowIndex: windowState.maxObservedWindowIndex,
            missedWindows: windowState.missedWindows,
            deadCycleDays,
            claimedBy: claim.ownedBy,
          });
          runsSkipped += 1;
          continuityMetrics.runsSkipped.inc({ reason: "claimed_by_other_replica" });
          continuityMetrics.claimsLostToOtherReplica.inc();
          if (claim.ownedBy && claim.ownedBy !== REPLICA_ID) {
            await logAudit(plan.accountId, "CONTINUITY_REPLICA_CONFLICT", {
              details: {
                campaignId: plan.campaignId,
                planId: plan.planId,
                windowIndex: windowState.expectedWindowIndex,
                ourReplicaId: REPLICA_ID,
                ownedBy: claim.ownedBy,
              },
            }).catch(() => undefined);
          }
          continue;
        }
        continuityMetrics.claimsAcquired.inc();

        // Invoke runBoss with idempotent campaign lock.
        // INVARIANT-RETRY enforcement: on success → mark claim completed.
        // On failure/partial/exception → DELETE the claim so the next tick
        // can re-claim and retry. This preserves the Track #1 invariant
        // that failed/partial runs never block the next attempt.
        try {
          const result = await runBoss({
            accountId: plan.accountId,
            campaignId: plan.campaignId,
            trigger: "scheduled",
          });
          // Fail-closed status read. NO `?? "completed"` D1 substitute —
          // a missing/unknown status MUST NOT silently mark the claim
          // completed (that would suppress the next tick's retry,
          // violating INVARIANT-RETRY). If status is undefined or any
          // non-"completed" value, we release the claim and the next
          // tick re-claims and retries.
          const rawStatus = (result as { status?: unknown }).status;
          const isCompleted = typeof rawStatus === "string" && rawStatus === "completed";
          if (isCompleted) {
            await markClaimCompleted(plan, windowState.expectedWindowIndex, result.bossRunId, "ok", now);
          } else {
            // partial / unknown / missing → release for retry.
            await releaseClaimForRetry(plan, windowState.expectedWindowIndex);
            continuityMetrics.claimsReleasedOnFailure.inc();
            if (typeof rawStatus !== "string") {
              logger.warn(
                {
                  component: "continuity-scheduler",
                  campaignId: plan.campaignId,
                  bossRunId: result.bossRunId,
                  rawStatusType: typeof rawStatus,
                },
                "[ContinuityScheduler] runBoss returned no status field — releasing claim for retry (fail-closed)",
              );
            }
          }
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
            claimedBy: REPLICA_ID,
          });
        } catch (err) {
          // INVARIANT-RETRY: any throw releases the claim so the next
          // tick can retry. This INCLUDES BossRunInFlightError —
          // pre-revision we exempted it on the assumption that the
          // in-flight caller would finalize the claim, but that caller
          // (manual API trigger, prior boss invocation) does NOT know
          // about our claim row and will not update it. Leaving the
          // claim in `in_progress` would silently suppress this window
          // forever (`claimed_by_other_replica` skip on every future
          // tick). Architect-flagged finding #2 — release unconditionally.
          await releaseClaimForRetry(plan, windowState.expectedWindowIndex);
          continuityMetrics.claimsReleasedOnFailure.inc();
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

    // Track #4 / lifecycle C-package — explicit silent-failure escalation.
    // Per Seal #13/#14 doctrine, runs_failed and dead_cycles_detected MUST
    // be 0 in steady state. The metrics counters above already record the
    // increments, but Prometheus alerts may not be wired in this
    // environment. Emit a loud, structured console.error per tick so the
    // operator sees the lifecycle degradation in their app logs even if
    // no external alerting stack is configured.
    if (runsFailed > 0 || deadCyclesTotal > 0 || missedWindowsTotal > 0) {
      const failedDecisions = decisions
        .filter((d) => d.decision === "failed")
        .slice(0, 5)
        .map((d) => ({ campaignId: d.campaignId, reason: d.reason }));
      console.error("[ContinuityScheduler] LIFECYCLE_SILENT_FAILURE_TICK_SUMMARY", {
        tickAt: now.toISOString(),
        runsFailed,
        deadCyclesDetected: deadCyclesTotal,
        missedWindowsDetected: missedWindowsTotal,
        reanchorsWritten,
        campaignsScanned: campaigns.length,
        failedDecisionsSample: failedDecisions,
        note: "These counts must be 0 in steady state. See per-campaign audit rows for detail.",
      });
    }

    lastTickAt = now;
    lastTickReport = report;
    return report;
  })();

  try {
    return await inFlightTick;
  } finally {
    // Token-aware cleanup: only null the shared reference if it still
    // points at OUR tick. A zombie eviction may have already nulled it
    // and installed a fresh tick — clobbering that fresh tick would
    // silently permit overlapping continuity ticks.
    if (inFlightTickToken === myTickToken) {
      inFlightTick = null;
      inFlightTickStartedAt = null;
      inFlightTickToken = 0;
    }
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
  inFlightTickStartedAt = null;
  zombieTickEvictions = 0;
  lastTickAt = null;
  lastTickReport = null;
}

/** Track #3 / Seal #15 — observability hook for the inFlightTick watchdog. */
export function _continuityTickInflightStats(): {
  inFlight: boolean;
  startedAt: number | null;
  ageMs: number | null;
  zombieEvictions: number;
  maxAgeMs: number;
} {
  const ageMs =
    inFlightTickStartedAt !== null ? Date.now() - inFlightTickStartedAt : null;
  return {
    inFlight: inFlightTick !== null,
    startedAt: inFlightTickStartedAt,
    ageMs,
    zombieEvictions: zombieTickEvictions,
    maxAgeMs: MAX_TICK_AGE_MS,
  };
}
