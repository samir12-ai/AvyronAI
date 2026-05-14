/**
 * Seal #14 / Track #2 — 10-chain operational registry.
 *
 * Closes audit finding T1-A5: pre-seal, only the continuity scheduler
 * itself was observed. The other 9 scheduled producers (autonomous-worker,
 * publish-worker, snapshot-cleanup, etc.) could silently stall in exactly
 * the same way that produced the May 2026 outage and there would be no
 * dashboard signal.
 *
 * The registry is the single source of truth for "what scheduled producers
 * exist in this system, what's their expected cadence, and how do we
 * observe their last successful run." Each chain provides:
 *
 *   - chainId            — stable canonical identifier (used as Prom label).
 *   - description        — one-line operator-facing description.
 *   - expectedIntervalMs — declared cadence. Lag thresholds derive from this.
 *   - degradedMultiplier — when lag/interval exceeds this, classify DEGRADED.
 *   - deadMultiplier     — when lag/interval exceeds this, classify DEAD.
 *   - introspect()       — async function returning Date | null of last
 *                          observed successful run, OR null if not yet
 *                          wired (chain stays UNKNOWN until promoted).
 *
 * Honesty over coverage: chains where we don't yet have a clean data
 * source are registered with `introspect: null`. The supervisor classifies
 * them as UNKNOWN and they show up explicitly in /healthz/continuity so
 * operators see the gap. Track #3 (silent-degradation sweep) will wire
 * the remaining introspectors as it audits each worker individually.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";

export interface ChainDescriptor {
  chainId: string;
  description: string;
  expectedIntervalMs: number;
  degradedMultiplier?: number;
  deadMultiplier?: number;
  /**
   * Returns the timestamp of the most recent successful run for this
   * chain, or null if the chain has never run successfully. null
   * `introspect` (vs. one returning null) means the data source is not
   * wired yet — the chain is classified UNKNOWN.
   */
  introspect: ChainIntrospector | null;
}

export type ChainIntrospector = () => Promise<Date | null>;

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;

/** Safe last-row scalar query helper. Returns null on any error. */
async function maxTimestamp(query: ReturnType<typeof sql>): Promise<Date | null> {
  try {
    const result = await db.execute<{ max_ts: Date | null }>(query);
    const rows = (result.rows ?? (result as any)) as Array<{ max_ts: Date | null }>;
    const v = rows[0]?.max_ts;
    if (!v) return null;
    return v instanceof Date ? v : new Date(v);
  } catch (err) {
    logger.warn(
      { component: "chain-registry", err: String(err) },
      "[ChainRegistry] introspect query failed",
    );
    return null;
  }
}

/**
 * The 10 scheduled producers. Order is stable for /healthz/continuity
 * and the chain_lag_seconds Prometheus label space.
 */
export function buildChainRegistry(): ChainDescriptor[] {
  return [
    {
      chainId: "continuity_scheduler",
      description: "Hourly heartbeat + per-window boss_run invocation (Seal #13)",
      expectedIntervalMs: MS_PER_HOUR,
      introspect: () => maxTimestamp(sql`SELECT MAX(tick_at) AS max_ts FROM continuity_ticks`),
    },
    {
      chainId: "continuity_supervisor",
      description: "5min heartbeat-stale detector + chain registry refresher (this seal)",
      expectedIntervalMs: 5 * MS_PER_MIN,
      introspect: () => maxTimestamp(sql`SELECT MAX(tick_at) AS max_ts FROM continuity_supervisor_ticks`),
    },
    {
      chainId: "autonomous_worker",
      description: "5min strategic decision tick (Seal #11)",
      expectedIntervalMs: 5 * MS_PER_MIN,
      // The autonomous worker writes to several tables but the most
      // canonical "I ran" signal is its own audit event. Track #3 will
      // promote this to a dedicated worker_runs table; for now we read
      // the audit_log heartbeat which IS guaranteed to be written
      // every tick (per autonomous-worker.ts Seal #11 doctrine).
      introspect: () =>
        maxTimestamp(sql`
          SELECT MAX(created_at) AS max_ts FROM audit_log
          WHERE event_type IN ('AUTONOMOUS_TICK', 'STRATEGY_DECISION', 'AUTONOMOUS_LANE_COMPLETED')
        `),
    },
    {
      chainId: "publish_worker",
      description: "2min content publish tick (Seal #5)",
      expectedIntervalMs: 2 * MS_PER_MIN,
      introspect: () =>
        maxTimestamp(sql`
          SELECT MAX(created_at) AS max_ts FROM audit_log
          WHERE event_type IN ('CONTENT_PUBLISHED', 'PUBLISH_TICK', 'PUBLISH_FAILED')
        `),
    },
    {
      chainId: "snapshot_cleanup_worker",
      description: "6h snapshot archiving + orphan reaper",
      expectedIntervalMs: 6 * MS_PER_HOUR,
      // Snapshot cleanup logs a `SNAPSHOT_CLEANUP_CYCLE` audit event
      // every cycle. If absent we report DEGRADED→DEAD over time,
      // which is the correct signal.
      introspect: () =>
        maxTimestamp(sql`
          SELECT MAX(created_at) AS max_ts FROM audit_log
          WHERE event_type IN ('SNAPSHOT_CLEANUP_CYCLE', 'SNAPSHOT_ARCHIVED', 'SNAPSHOT_PURGED')
        `),
    },
    {
      chainId: "ci_shared_pool_refresh",
      description: "24-48h competitor-intelligence shared pool scrape",
      expectedIntervalMs: 36 * MS_PER_HOUR,
      // Allow up to 2× the upper bound (96h) before classifying DEAD —
      // the randomized 24-48h interval can legitimately stretch.
      deadMultiplier: 3,
      introspect: () =>
        maxTimestamp(sql`
          SELECT MAX(created_at) AS max_ts FROM audit_log
          WHERE event_type IN ('CI_SHARED_POOL_REFRESH', 'CI_COMPETITOR_SCRAPED')
        `),
    },
    {
      chainId: "mi_queue_processor",
      description: "15s market-intelligence fetch-job queue processor",
      expectedIntervalMs: 60 * 1000, // 1min — be generous; tick is 15s
      // Queue processor doesn't produce per-tick audit events; only
      // promotes when work happens. UNKNOWN until Track #3 wires a
      // last_processed_at column on mi_fetch_jobs.
      introspect: null,
    },
    {
      chainId: "tombstone_reaper",
      description: "Tombstone GC for soft-deleted snapshots",
      expectedIntervalMs: 24 * MS_PER_HOUR,
      introspect: null, // Wired in Track #3
    },
    {
      chainId: "meta_token_health_check",
      description: "Meta/Facebook OAuth token expiry watcher",
      expectedIntervalMs: 6 * MS_PER_HOUR,
      introspect: () =>
        maxTimestamp(sql`
          SELECT MAX(created_at) AS max_ts FROM audit_log
          WHERE event_type IN ('META_TOKEN_REFRESHED', 'META_TOKEN_EXPIRED', 'META_TOKEN_HEALTH_CHECK')
        `),
    },
    {
      chainId: "ael_cel_reruns",
      description: "AEL/CEL re-enrichment lane",
      expectedIntervalMs: 24 * MS_PER_HOUR,
      introspect: null, // Wired in Track #3
    },
  ];
}

/** Singleton registry — built once per process. */
let _cached: ChainDescriptor[] | null = null;
export function getChainRegistry(): ChainDescriptor[] {
  if (!_cached) _cached = buildChainRegistry();
  return _cached;
}

/** Test-only reset. */
export function _resetChainRegistry(): void {
  _cached = null;
}
