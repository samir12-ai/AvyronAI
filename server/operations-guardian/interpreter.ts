// Operations Guardian Interpreter — collects raw runtime signals,
// classifies them into typed notices, and UPSERTs to system_notices.
//
// IMPORTANT — observe-only phase:
//   * Writes audience='operator' only. audience='user' is impossible
//     because USER_COPY is empty; canPromoteToUser() always returns
//     false for the categories the interpreter currently emits.
//   * NO auto-recovery. recoveryAttempted=false on every row.
//   * NO external escalation (Slack, PagerDuty, push). Operator panel
//     in audit-control is the only surface.
//
// Doctrine compliance:
//   * D1–D5: every collector returns a typed signal; classifier returns
//     a strict-typed Notice; no `?? "unknown"` patterns; no z.string().
//   * Seal #15 (no silent catches): every catch logs via console.error
//     with a stable [OperationsGuardian] tag; the supervisor swallows
//     the rejection so a guardian failure can never break the
//     supervisor's own tick row.
//   * Continuity invariants: runs INSIDE the existing supervisor tick
//     (no new worker process, no new boot order, no new graceful-
//     shutdown handle). Multi-replica safety inherited from the
//     supervisor's own claim handshake.

import { db } from "../db";
import {
  systemNotices,
  continuityWindowClaims,
  continuityTicks,
  miFetchJobs,
  miSnapshots,
} from "@shared/schema";
import { sql, and, eq, lt, isNull, inArray } from "drizzle-orm";
import { _bossInFlightStats } from "../boss/concurrency";
import { _continuityTickInflightStats } from "../continuity/scheduler";
import { _activeJobsStats } from "../market-intelligence-v3/fetch-orchestrator";
import {
  type NoticeCategory,
  type NoticeSeverity,
  type NoticeAudience,
  isNoticeCategory,
  canPromoteToUser,
  INTERNAL_ONLY_CATEGORIES,
} from "./types";
import type { ChainObservation } from "../continuity/supervisor";

// Per-collector cap. Raised well above any realistic steady-state to keep
// the resolution sweep correct (see resolveStaleNotices). If a collector's
// result count equals this cap we treat the category as PARTIALLY OBSERVED
// and skip its resolution sweep that tick — preventing false resolves
// when load spikes.
const COLLECTOR_HARD_LIMIT = 1000;

// Internal exports for regression tests (Task #56). Underscore-prefixed
// per the existing convention (_bossInFlightStats, _activeJobsStats).
// NOT for production use outside this module.
export const _COLLECTOR_HARD_LIMIT = COLLECTOR_HARD_LIMIT;

// ─── Shape of a classified notice ready to UPSERT ───────────────────────

interface ClassifiedNotice {
  category: NoticeCategory;
  severity: NoticeSeverity;
  audience: NoticeAudience;
  correlationKey: string;
  accountId: string | null;
  campaignId: string | null;
  copyKey: string;
  copyVars: Record<string, string | number>;
  detail: Record<string, unknown>;
}

// ─── Collectors (pure-ish — read in-memory state + DB; no writes) ──────

interface CollectInput {
  now: Date;
  chainObservations: readonly ChainObservation[];
  schedulerState: string;
  schedulerLagMs: number | null;
}

function collectLeakedLockSignals(): ClassifiedNotice[] {
  const out: ClassifiedNotice[] = [];
  const now = new Date().toISOString();
  const sources: Array<{
    label: string;
    correlationSuffix: string;
    zombieEvictions: number;
    oldestAgeMs: number | null;
    maxAgeMs: number;
  }> = [
    {
      label: "boss-locks",
      correlationSuffix: "boss",
      ...statsToShape(_bossInFlightStats()),
    },
    {
      label: "mi-active-jobs",
      correlationSuffix: "miv3",
      ...statsToShape(_activeJobsStats()),
    },
    {
      label: "continuity-tick",
      correlationSuffix: "continuity-tick",
      zombieEvictions: _continuityTickInflightStats().zombieEvictions,
      oldestAgeMs: _continuityTickInflightStats().ageMs,
      maxAgeMs: _continuityTickInflightStats().maxAgeMs,
    },
  ];
  for (const s of sources) {
    if (s.zombieEvictions <= 0) continue;
    out.push({
      category: "LEAKED_LOCK",
      severity: "warning",
      audience: "operator",
      correlationKey: `LEAKED_LOCK:${s.correlationSuffix}`,
      accountId: null,
      campaignId: null,
      copyKey: "operator.leaked_lock",
      copyVars: {
        source: s.label,
        zombieEvictions: s.zombieEvictions,
      },
      detail: {
        observedAt: now,
        zombieEvictions: s.zombieEvictions,
        oldestAgeMs: s.oldestAgeMs ?? 0,
        maxAgeMs: s.maxAgeMs,
      },
    });
  }
  return out;
}

function statsToShape(s: {
  size: number;
  zombieEvictions: number;
  oldestAgeMs: number | null;
  maxAgeMs: number;
}): { zombieEvictions: number; oldestAgeMs: number | null; maxAgeMs: number } {
  return {
    zombieEvictions: s.zombieEvictions,
    oldestAgeMs: s.oldestAgeMs,
    maxAgeMs: s.maxAgeMs,
  };
}

async function collectStuckClaimSignals(now: Date): Promise<ClassifiedNotice[]> {
  // continuity_window_claims status='in_progress' AND claimed_at < now - 2h.
  // ageMinutes drives severity:
  //   ≥120m  → warning
  //   ≥240m  → degraded
  //   ≥480m  → critical
  const rows = await db
    .select({
      campaignId: continuityWindowClaims.campaignId,
      planId: continuityWindowClaims.planId,
      windowIndex: continuityWindowClaims.windowIndex,
      accountId: continuityWindowClaims.accountId,
      claimedBy: continuityWindowClaims.claimedBy,
      claimedAt: continuityWindowClaims.claimedAt,
    })
    .from(continuityWindowClaims)
    .where(
      and(
        eq(continuityWindowClaims.status, "in_progress"),
        lt(
          continuityWindowClaims.claimedAt,
          new Date(now.getTime() - 2 * 60 * 60 * 1000),
        ),
      ),
    )
    .limit(COLLECTOR_HARD_LIMIT);

  return rows.map((r) => {
    const ageMinutes = Math.max(
      0,
      Math.round(
        (now.getTime() -
          (r.claimedAt instanceof Date
            ? r.claimedAt.getTime()
            : new Date(String(r.claimedAt)).getTime())) /
          60_000,
      ),
    );
    const severity: NoticeSeverity =
      ageMinutes >= 480 ? "critical" : ageMinutes >= 240 ? "degraded" : "warning";
    return {
      category: "WORKER_STUCK",
      severity,
      audience: "operator",
      correlationKey: `WORKER_STUCK:${r.campaignId}:${r.planId}:${r.windowIndex}`,
      accountId: r.accountId,
      campaignId: r.campaignId,
      copyKey: "operator.worker_stuck",
      copyVars: {
        campaignId: r.campaignId,
        windowIndex: r.windowIndex,
        ageMinutes,
      },
      detail: {
        planId: r.planId,
        claimedBy: r.claimedBy,
        claimedAt:
          r.claimedAt instanceof Date
            ? r.claimedAt.toISOString()
            : String(r.claimedAt),
        ageMinutes,
      },
    };
  });
}

async function collectRetryLoopSignals(): Promise<ClassifiedNotice[]> {
  // Campaigns with ≥3 'failed' continuity_ticks decisions in last 24h.
  // Severity bands:
  //   ≥3 → warning
  //   ≥6 → degraded
  //   ≥10 → critical
  const rows = await db.execute(sql`
    SELECT (note->>'campaignId') AS campaign_id, COUNT(*)::int AS count
    FROM ${continuityTicks},
         jsonb_array_elements(${continuityTicks.notes}) AS note
    WHERE ${continuityTicks.tickAt} >= NOW() - INTERVAL '24 hours'
      AND (note->>'decision') = 'failed'
    GROUP BY (note->>'campaignId')
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT ${sql.raw(String(COLLECTOR_HARD_LIMIT))}
  `);
  const arr =
    (rows as unknown as { rows: Array<{ campaign_id: string | null; count: number }> })
      .rows ?? [];
  return arr
    .filter((r) => r.campaign_id)
    .map((r) => {
      const failedCount = Number(r.count) || 0;
      const severity: NoticeSeverity =
        failedCount >= 10 ? "critical" : failedCount >= 6 ? "degraded" : "warning";
      return {
        category: "RETRY_LOOP",
        severity,
        audience: "operator" as const,
        correlationKey: `RETRY_LOOP:${r.campaign_id}`,
        accountId: null,
        campaignId: r.campaign_id as string,
        copyKey: "operator.retry_loop",
        copyVars: {
          campaignId: r.campaign_id as string,
          failedCount24h: failedCount,
        },
        detail: { failedCount24h: failedCount, windowHours: 24 },
      } satisfies ClassifiedNotice;
    });
}

async function collectScraperProviderSignals(
  now: Date,
): Promise<ClassifiedNotice[]> {
  // Phase 1A (Task #58). Per architect decision documented in the audit
  // report §5.1: aggregate from existing `mi_fetch_jobs` rather than
  // standing up a new `scrape_attempts` telemetry table. Faster to ship,
  // lower-fidelity (per-job not per-attempt) — acceptable for observe-
  // only rollout. Severity reads the count of FAILED mi_fetch_jobs in
  // the last 1h per (accountId).
  //
  // Severity bands per task spec:
  //   ≥3   → warning
  //   ≥10  → degraded
  //   ≥25  → critical
  const rows = await db.execute(sql`
    SELECT ${miFetchJobs.accountId} AS account_id, COUNT(*)::int AS count
    FROM ${miFetchJobs}
    WHERE ${miFetchJobs.status} = 'FAILED'
      AND ${miFetchJobs.createdAt} >= ${new Date(now.getTime() - 60 * 60 * 1000)}
    GROUP BY ${miFetchJobs.accountId}
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT ${sql.raw(String(COLLECTOR_HARD_LIMIT))}
  `);
  const arr =
    (rows as unknown as { rows: Array<{ account_id: string; count: number }> })
      .rows ?? [];
  return arr.map((r) => {
    const failedCount = Number(r.count) || 0;
    const severity: NoticeSeverity =
      failedCount >= 25 ? "critical" : failedCount >= 10 ? "degraded" : "warning";
    return {
      category: "SCRAPER_PROVIDER_DEGRADED",
      severity,
      audience: "operator" as const,
      correlationKey: `SCRAPER_PROVIDER_DEGRADED:${r.account_id}`,
      accountId: r.account_id,
      campaignId: null,
      copyKey: "operator.scraper_provider_degraded",
      copyVars: {
        accountId: r.account_id,
        failedCount1h: failedCount,
      },
      detail: {
        failedCount1h: failedCount,
        windowMinutes: 60,
        source: "mi_fetch_jobs",
      },
    } satisfies ClassifiedNotice;
  });
}

async function collectMarketDataDegradedSignals(
  now: Date,
): Promise<ClassifiedNotice[]> {
  // Phase 1A (Task #58). Reads the most-recent COMPLETE/PARTIAL snapshot
  // per (accountId, campaignId) and emits when its age exceeds the
  // freshness budget. A campaign with NO successful snapshot ever is
  // intentionally silent here — that is a "never bootstrapped" condition,
  // not a degradation of an established refresh cadence.
  //
  // Severity bands per task spec:
  //   age > 6h   → warning
  //   age > 24h  → critical
  // (Degraded band is omitted by design — only two thresholds in the
  // brief, so the classifier is binary above the warning floor.)
  const rows = await db.execute(sql`
    SELECT ${miSnapshots.accountId} AS account_id,
           ${miSnapshots.campaignId} AS campaign_id,
           MAX(${miSnapshots.createdAt}) AS last_snapshot_at
    FROM ${miSnapshots}
    WHERE ${miSnapshots.status} IN ('COMPLETE', 'PARTIAL')
    GROUP BY ${miSnapshots.accountId}, ${miSnapshots.campaignId}
    HAVING MAX(${miSnapshots.createdAt}) < ${new Date(now.getTime() - 6 * 60 * 60 * 1000)}
    ORDER BY MAX(${miSnapshots.createdAt}) ASC
    LIMIT ${sql.raw(String(COLLECTOR_HARD_LIMIT))}
  `);
  const arr =
    (rows as unknown as {
      rows: Array<{
        account_id: string;
        campaign_id: string;
        last_snapshot_at: Date | string;
      }>;
    }).rows ?? [];
  return arr.map((r) => {
    const lastTs =
      r.last_snapshot_at instanceof Date
        ? r.last_snapshot_at.getTime()
        : new Date(String(r.last_snapshot_at)).getTime();
    const ageMinutes = Math.max(0, Math.round((now.getTime() - lastTs) / 60_000));
    const severity: NoticeSeverity =
      ageMinutes > 24 * 60 ? "critical" : "warning";
    return {
      category: "MARKET_DATA_DEGRADED",
      severity,
      audience: "operator" as const,
      correlationKey: `MARKET_DATA_DEGRADED:${r.campaign_id}`,
      accountId: r.account_id,
      campaignId: r.campaign_id,
      copyKey: "operator.market_data_degraded",
      copyVars: {
        campaignId: r.campaign_id,
        ageMinutes,
      },
      detail: {
        accountId: r.account_id,
        lastSnapshotAt:
          r.last_snapshot_at instanceof Date
            ? r.last_snapshot_at.toISOString()
            : String(r.last_snapshot_at),
        ageMinutes,
        warningThresholdMinutes: 6 * 60,
        criticalThresholdMinutes: 24 * 60,
      },
    } satisfies ClassifiedNotice;
  });
}

function collectChainSignals(input: CollectInput): ClassifiedNotice[] {
  const out: ClassifiedNotice[] = [];
  for (const c of input.chainObservations) {
    if (c.state !== "DEGRADED" && c.state !== "DEAD") continue;
    const category: NoticeCategory =
      c.state === "DEAD" ? "CHAIN_DEAD" : "CHAIN_DEGRADED";
    const severity: NoticeSeverity = c.state === "DEAD" ? "critical" : "warning";
    out.push({
      category,
      severity,
      audience: "operator",
      correlationKey: `${category}:${c.chainId}`,
      accountId: null,
      campaignId: null,
      copyKey: c.state === "DEAD" ? "operator.chain_dead" : "operator.chain_degraded",
      copyVars: {
        chainId: c.chainId,
        lagMs: c.lagMs ?? 0,
        reason: c.reason ?? "",
      },
      detail: {
        expectedIntervalMs: c.expectedIntervalMs,
        introspectionAvailable: c.introspectionAvailable,
        lastObservedRunAt: c.lastObservedRunAt,
        lagMs: c.lagMs,
        reason: c.reason,
      },
    });
  }
  if (input.schedulerState === "DEAD") {
    out.push({
      category: "SCHEDULER_HEARTBEAT_DEAD",
      severity: "critical",
      audience: "operator",
      correlationKey: "SCHEDULER_HEARTBEAT_DEAD:_continuity_scheduler",
      accountId: null,
      campaignId: null,
      copyKey: "operator.scheduler_heartbeat_dead",
      copyVars: { lagMs: input.schedulerLagMs ?? 0 },
      detail: { lagMs: input.schedulerLagMs },
    });
  }
  return out;
}

// ─── Persistence: UPSERT + resolution sweep ────────────────────────────

// Central audience firewall. Called from upsertNotices for EVERY row,
// regardless of which collector produced it. Closes architect P1 #1:
// even if a future collector accidentally sets audience='user' for a
// category that is internal-only or has no USER_COPY entry, this guard
// rejects the write at the boundary. There is no other write path to
// system_notices in the codebase — adding one MUST go through this
// guard or the doctrine breaks.
export function _audienceFirewallOk(n: ClassifiedNotice): boolean {
  return audienceFirewallOk(n);
}

export type _ClassifiedNoticeForTest = ClassifiedNotice;

function audienceFirewallOk(n: ClassifiedNotice): boolean {
  if (n.audience === "user") {
    if (!canPromoteToUser(n.category)) {
      console.error(
        "[OperationsGuardian] AUDIENCE_FIREWALL_REJECT",
        {
          reason: "USER_AUDIENCE_WITHOUT_COPY",
          category: n.category,
          correlationKey: n.correlationKey,
        },
      );
      return false;
    }
  }
  if (
    INTERNAL_ONLY_CATEGORIES.has(n.category) &&
    n.audience !== "internal" &&
    n.audience !== "operator"
  ) {
    // INTERNAL_ONLY may surface to operator (it's an operator-vocabulary
    // category by design) but never to user. Belt-and-braces with the
    // canPromoteToUser check above.
    console.error(
      "[OperationsGuardian] AUDIENCE_FIREWALL_REJECT",
      {
        reason: "INTERNAL_ONLY_CATEGORY_NON_OPERATOR",
        category: n.category,
        audience: n.audience,
        correlationKey: n.correlationKey,
      },
    );
    return false;
  }
  return true;
}

async function upsertNotices(
  notices: readonly ClassifiedNotice[],
  now: Date,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const n of notices) {
    if (!isNoticeCategory(n.category)) {
      // Defensive — should be impossible given strict-typed enums, but if
      // a future refactor breaks the type it MUST surface (no silent skip).
      console.error(
        "[OperationsGuardian] INVALID_CATEGORY_REFUSED",
        { category: n.category, correlationKey: n.correlationKey },
      );
      continue;
    }
    if (!audienceFirewallOk(n)) continue;
    // Postgres ON CONFLICT against a partial unique index requires the
    // index_predicate clause. Drizzle's onConflictDoUpdate doesn't expose
    // it cleanly, so we drop to parameterized raw SQL — still safe (every
    // value bound, no string interpolation).
    const result = await db.execute(sql`
      INSERT INTO system_notices
        (category, severity, audience, correlation_key, account_id, campaign_id,
         copy_key, copy_vars, detail, first_seen_at, last_seen_at,
         observation_count)
      VALUES
        (${n.category}, ${n.severity}, ${n.audience}, ${n.correlationKey},
         ${n.accountId}, ${n.campaignId}, ${n.copyKey},
         ${JSON.stringify(n.copyVars)}::jsonb, ${JSON.stringify(n.detail)}::jsonb,
         ${now}, ${now}, 1)
      ON CONFLICT (correlation_key, audience) WHERE resolved_at IS NULL
      DO UPDATE SET
        severity = EXCLUDED.severity,
        copy_key = EXCLUDED.copy_key,
        copy_vars = EXCLUDED.copy_vars,
        detail = EXCLUDED.detail,
        last_seen_at = EXCLUDED.last_seen_at,
        observation_count = system_notices.observation_count + 1
      RETURNING (xmax = 0) AS inserted
    `);
    const rows =
      (result as unknown as { rows: Array<{ inserted: boolean }> }).rows ?? [];
    if (rows[0]?.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

export async function _resolveStaleNoticesForTest(
  observedKeys: ReadonlySet<string>,
  fullyObservedCategories: ReadonlySet<NoticeCategory>,
  now: Date,
): Promise<number> {
  return resolveStaleNotices(observedKeys, fullyObservedCategories, now);
}

async function resolveStaleNotices(
  observedKeys: ReadonlySet<string>,
  fullyObservedCategories: ReadonlySet<NoticeCategory>,
  now: Date,
): Promise<number> {
  // Closes architect P1 #2: only sweep notices whose category was FULLY
  // observed this tick (collector ran AND result count < hard limit AND
  // collector did not throw). If a category is partially observed —
  // collector cap hit or collector failed — we skip its sweep this tick
  // and let the notice persist. Worst case the notice survives a tick
  // late; previously the worst case was a falsely-resolved notice that
  // would flap.
  if (fullyObservedCategories.size === 0) return 0;
  const open = await db
    .select({
      id: systemNotices.id,
      category: systemNotices.category,
      correlationKey: systemNotices.correlationKey,
    })
    .from(systemNotices)
    .where(
      and(
        eq(systemNotices.audience, "operator"),
        isNull(systemNotices.resolvedAt),
        // Restrict to categories the caller marked fully observed.
        inArray(
          systemNotices.category,
          [...fullyObservedCategories] as readonly string[],
        ),
      ),
    );
  const stale = open.filter(
    (r) =>
      isNoticeCategory(r.category) &&
      fullyObservedCategories.has(r.category) &&
      !observedKeys.has(r.correlationKey),
  );
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  await db
    .update(systemNotices)
    .set({ resolvedAt: now })
    .where(inArray(systemNotices.id, ids));
  return stale.length;
}

// ─── Public entry point — called from the supervisor tick ──────────────

export interface GuardianTickInput {
  now: Date;
  chainObservations: readonly ChainObservation[];
  schedulerState: string;
  schedulerLagMs: number | null;
}

export interface GuardianTickReport {
  collected: number;
  inserted: number;
  updated: number;
  resolved: number;
  durationMs: number;
}

export async function runGuardianInterpreterStep(
  input: GuardianTickInput,
): Promise<GuardianTickReport> {
  const startedAt = Date.now();
  // Collectors run in parallel — they're independent and read-only.
  // Any individual collector failure is logged + swallowed so one bad
  // signal source doesn't stop the others (silent-degradation rule:
  // logged is OK, silent is not). Each collector returns ok=true|false +
  // capped=true|false so the resolver knows which categories are safe
  // to sweep.
  const [leaked, stuck, retry, scraper, marketData] = await Promise.all([
    safeCollect("LEAKED_LOCK", () => Promise.resolve(collectLeakedLockSignals())),
    safeCollect("WORKER_STUCK", () => collectStuckClaimSignals(input.now)),
    safeCollect("RETRY_LOOP", () => collectRetryLoopSignals()),
    safeCollect("SCRAPER_PROVIDER_DEGRADED", () =>
      collectScraperProviderSignals(input.now),
    ),
    safeCollect("MARKET_DATA_DEGRADED", () =>
      collectMarketDataDegradedSignals(input.now),
    ),
  ]);
  const chain = safeCollectSync("CHAIN_OBSERVATIONS", () =>
    collectChainSignals(input),
  );

  const all: ClassifiedNotice[] = [
    ...leaked.notices,
    ...stuck.notices,
    ...retry.notices,
    ...scraper.notices,
    ...marketData.notices,
    ...chain.notices,
  ];
  const observedKeys = new Set(all.map((n) => n.correlationKey));

  // A category is "fully observed" iff its collector succeeded AND did
  // not hit the hard cap. Only fully-observed categories are eligible
  // for stale-notice resolution this tick. Chain + scheduler categories
  // come from the supervisor's own (already-bounded) registry, so they
  // are always fully observed when the chain collector runs.
  const fullyObserved = new Set<NoticeCategory>();
  if (leaked.ok && !leaked.capped) {
    fullyObserved.add("LEAKED_LOCK");
  }
  if (stuck.ok && !stuck.capped) {
    fullyObserved.add("WORKER_STUCK");
  }
  if (retry.ok && !retry.capped) {
    fullyObserved.add("RETRY_LOOP");
  }
  if (scraper.ok && !scraper.capped) {
    fullyObserved.add("SCRAPER_PROVIDER_DEGRADED");
  }
  if (marketData.ok && !marketData.capped) {
    fullyObserved.add("MARKET_DATA_DEGRADED");
  }
  if (chain.ok) {
    fullyObserved.add("CHAIN_DEGRADED");
    fullyObserved.add("CHAIN_DEAD");
    fullyObserved.add("SCHEDULER_HEARTBEAT_DEAD");
  }

  let inserted = 0;
  let updated = 0;
  let resolved = 0;
  try {
    const upsertResult = await upsertNotices(all, input.now);
    inserted = upsertResult.inserted;
    updated = upsertResult.updated;
  } catch (err) {
    console.error("[OperationsGuardian] UPSERT_FAILED", err);
  }
  try {
    resolved = await resolveStaleNotices(observedKeys, fullyObserved, input.now);
  } catch (err) {
    console.error("[OperationsGuardian] RESOLVE_FAILED", err);
  }

  return {
    collected: all.length,
    inserted,
    updated,
    resolved,
    durationMs: Date.now() - startedAt,
  };
}

interface CollectResult {
  ok: boolean;
  capped: boolean;
  notices: ClassifiedNotice[];
}

async function safeCollect(
  tag: string,
  fn: () => Promise<ClassifiedNotice[]>,
): Promise<CollectResult> {
  try {
    const notices = await fn();
    return {
      ok: true,
      capped: notices.length >= COLLECTOR_HARD_LIMIT,
      notices,
    };
  } catch (err) {
    console.error(`[OperationsGuardian] COLLECT_FAILED tag=${tag}`, err);
    return { ok: false, capped: false, notices: [] };
  }
}

function safeCollectSync(
  tag: string,
  fn: () => ClassifiedNotice[],
): CollectResult {
  try {
    const notices = fn();
    return {
      ok: true,
      capped: notices.length >= COLLECTOR_HARD_LIMIT,
      notices,
    };
  } catch (err) {
    console.error(`[OperationsGuardian] COLLECT_FAILED tag=${tag}`, err);
    return { ok: false, capped: false, notices: [] };
  }
}
