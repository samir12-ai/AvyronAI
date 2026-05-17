/**
 * Task #91 / Phase 4-C — Hourly parity job.
 *
 * One tick of the parity gate:
 *   1. Load routing table from `divergence_class_routes`.
 *   2. Pull the last `LIMIT` production cassettes (most recent first).
 *   3. For each cassette, replay against the candidate orchestrator
 *      (StrictLlmMock from Phase 4-A — zero network).
 *   4. Persist run + per-divergence rows.
 *   5. If `routedAction === "BLOCK"` AND a module flag flipped to
 *      `candidate` within `BLOCK_REVERT_WINDOW_HOURS`, call the
 *      authorised `revertModuleFlag()` helper.
 *   6. Refresh path-shape coverage + CV-15 readiness gauge.
 *
 * Shadow mode (`PARITY_SHADOW=1`): step 5 is suppressed — classifications
 * are persisted but the auto-revert helper is NOT invoked.
 *
 * Doctrine:
 *   * Seal #13 INVARIANT-RETRY — caller (`scheduler.ts`) releases the
 *     window claim if `HARNESS_ERROR` runs accumulate, so the next tick
 *     re-attempts.
 *   * D5 — missing routing entry throws RoutingTableIncompleteError; we
 *     mark the affected run `HARNESS_ERROR` and surface it on the panel.
 */
import { randomUUID } from "node:crypto";
import { pool } from "../../../db";
import { logger } from "../../../logger";
import { play, type CandidateOrchestrator } from "../player";
import type {
  ReplayCassette,
  ReplayCassetteBody,
  Divergence,
} from "../types";
import {
  classifyDivergences,
  RoutingTableIncompleteError,
  type ClassifierResult,
} from "./classifier";
import { loadRoutingTable } from "./routes";
import {
  recordParityRun,
  recordParityDivergence,
} from "./cv15-metrics";
import {
  revertModuleFlag,
  attributeDivergenceToModule,
} from "./auto-revert";
import type {
  ParityRunOutcome,
  RoutedAction,
} from "./types";

export interface ParityJobOptions {
  /** Cassettes per tick. Default 50 (per task spec). */
  limit?: number;
  /** Total wall-clock budget per tick. Bounded so the chain stays HEALTHY. */
  maxTickMs?: number;
  /** Override shadow mode (testing only). */
  forceShadow?: boolean;
  /** Override DB-loaded routing table (testing only). */
  routingTableOverride?: ClassifierResult extends infer _R ? Awaited<ReturnType<typeof loadRoutingTable>> | undefined : never;
  /** Injected candidate orchestrator factory. */
  candidate: CandidateOrchestrator;
  now?: () => number;
}

export interface ParityTickReport {
  tickAt: string;
  cassettesEvaluated: number;
  runs: Array<{
    runId: string;
    cassetteHash: string;
    outcome: ParityRunOutcome;
    routedAction: RoutedAction | "NONE";
    divergenceCount: number;
  }>;
  autoReverts: Array<{ moduleId: string; reason: string; suppressed: boolean }>;
  shadowMode: boolean;
  errors: Array<{ cassetteHash: string; error: string }>;
}

const BLOCK_REVERT_WINDOW_HOURS = 6;

export async function runParityTick(opts: ParityJobOptions): Promise<ParityTickReport> {
  const now = opts.now ?? (() => Date.now());
  const limit = opts.limit ?? 50;
  const maxTickMs = opts.maxTickMs ?? 10 * 60 * 1000;
  const shadowMode = opts.forceShadow ?? (process.env.PARITY_SHADOW === "1");
  const startMs = now();
  const tickAt = new Date(startMs).toISOString();

  let routing: Awaited<ReturnType<typeof loadRoutingTable>>;
  try {
    routing = opts.routingTableOverride ?? (await loadRoutingTable());
  } catch (err) {
    logger.error(
      { component: "parity-job", err: String(err) },
      "[ParityJob] ROUTING_TABLE_LOAD_FAILED",
    );
    return {
      tickAt,
      cassettesEvaluated: 0,
      runs: [],
      autoReverts: [],
      shadowMode,
      errors: [{ cassetteHash: "<routing-table>", error: String(err) }],
    };
  }

  // Stamp the "first observed at candidate" promotion row for every
  // tracked module currently flipped to `candidate`. This starts the
  // 7d candidate-burn-in clock used by computeParityHealth's gate
  // check. Idempotent — no-op when a promotion row already exists.
  const TRACKED_FOR_PROMOTION_STAMP: Array<{ moduleId: string; flag: string }> = [
    { moduleId: "system-control", flag: "SYS_CONTROL" },
    { moduleId: "priority-matrix", flag: "PRIORITY_MATRIX" },
    { moduleId: "plan-synthesis", flag: "PLAN_SYNTHESIS" },
    { moduleId: "budget-decision-ledger", flag: "BUDGET_LEDGER" },
    { moduleId: "ctx-resolve", flag: "CTX_RESOLVE" },
  ];
  for (const m of TRACKED_FOR_PROMOTION_STAMP) {
    if (process.env[`ORCH_USE_${m.flag}`] === "candidate") {
      await ensureModuleObservedAtCandidate(m.moduleId);
    }
  }

  // Most-recent-first; we cap at limit per spec.
  const cassetteRows = await pool.query<{
    cassette_hash: string;
    path_shape: string | null;
    body: ReplayCassetteBody;
  }>(
    `SELECT cassette_hash, path_shape, body
       FROM orchestrator_replay_cassettes
      WHERE source = 'production'
   ORDER BY captured_at DESC
      LIMIT $1`,
    [limit],
  );

  const runs: ParityTickReport["runs"] = [];
  const autoReverts: ParityTickReport["autoReverts"] = [];
  const errors: ParityTickReport["errors"] = [];

  for (const row of cassetteRows.rows) {
    if (now() - startMs > maxTickMs) {
      logger.warn(
        { component: "parity-job", evaluated: runs.length, limit },
        "[ParityJob] TICK_BUDGET_EXCEEDED — deferring remaining cassettes to next tick",
      );
      break;
    }
    const cassette: ReplayCassette = { cassetteHash: row.cassette_hash, body: row.body };
    let outcome: ParityRunOutcome = "PASS";
    let routedAction: RoutedAction | "NONE" = "NONE";
    let highestClass: ClassifierResult["highestClass"] = null;
    let divergences: Divergence[] = [];
    let engineWallclockMs = 0;
    let finalPlanHash: string | null = null;
    let finalVerdictHash: string | null = null;
    let candidateError: string | null = null;

    try {
      const result = await play(cassette, opts.candidate, { now });
      divergences = result.divergences;
      engineWallclockMs = result.engineWallClockMs;
      finalPlanHash = result.finalPlanHash;
      finalVerdictHash = result.finalVerdictHash;
      const classified = classifyDivergences(divergences, routing);
      outcome = classified.outcome;
      routedAction = classified.routedAction;
      highestClass = classified.highestClass;
    } catch (err) {
      if (err instanceof RoutingTableIncompleteError) {
        logger.error(
          { component: "parity-job", err: err.message },
          "[ParityJob] ROUTING_INCOMPLETE",
        );
      } else {
        logger.warn(
          { component: "parity-job", cassetteHash: cassette.cassetteHash, err: String(err) },
          "[ParityJob] PLAY_OR_CLASSIFY_FAILED",
        );
      }
      outcome = "HARNESS_ERROR";
      routedAction = "NONE";
      candidateError = err instanceof Error ? err.message : String(err);
      errors.push({ cassetteHash: cassette.cassetteHash, error: candidateError });
    }

    const runId = await persistRun({
      cassetteHash: cassette.cassetteHash,
      pathShape: row.path_shape,
      outcome,
      divergenceCount: divergences.length,
      highestClass,
      routedAction,
      engineWallclockMs,
      finalPlanHash,
      finalVerdictHash,
      candidateError,
      shadowMode,
      ranAt: new Date(now()).toISOString(),
    });

    if (runId && divergences.length > 0) {
      await persistDivergences(runId, divergences);
    }
    for (const d of divergences) {
      const attribution = attributeDivergenceToModule(d.path);
      recordParityDivergence(d.class, attribution?.moduleId ?? null);
    }
    recordParityRun(outcome);

    runs.push({
      runId: runId ?? "<unpersisted>",
      cassetteHash: cassette.cassetteHash,
      outcome,
      routedAction,
      divergenceCount: divergences.length,
    });

    // Auto-revert: only fire on BLOCK and only when NOT in shadow mode.
    // Code-review #6 hardening: dedupe per-module within a single
    // cassette evaluation — multiple BLOCK divergences attributed to
    // the same module produce ONE revert + ONE counter increment + ONE
    // page (the pager applies a 1h dedupe on top, so storm-level dedup
    // is layered).
    if (routedAction === "BLOCK" && !shadowMode) {
      const revertedThisCassette = new Set<string>();
      for (const d of divergences) {
        const attribution = attributeDivergenceToModule(d.path);
        if (!attribution) continue;
        if (revertedThisCassette.has(attribution.moduleId)) continue;
        if (process.env[`ORCH_USE_${attribution.moduleFlag}`] !== "candidate") continue;
        const flippedRecently = await wasModuleFlippedWithin(
          attribution.moduleId,
          BLOCK_REVERT_WINDOW_HOURS * 3_600_000,
          now,
        );
        if (!flippedRecently) continue;
        const event = await revertModuleFlag(
          attribution.moduleId,
          attribution.moduleFlag,
          `parity_block path=${d.path} class=${d.class} cassette=${cassette.cassetteHash}`,
        );
        revertedThisCassette.add(attribution.moduleId);
        autoReverts.push({
          moduleId: event.moduleId,
          reason: event.reason,
          suppressed: event.suppressed,
        });
      }
    }
  }

  return {
    tickAt,
    cassettesEvaluated: runs.length,
    runs,
    autoReverts,
    shadowMode,
    errors,
  };
}

interface PersistRunRow {
  cassetteHash: string;
  pathShape: string | null;
  outcome: ParityRunOutcome;
  divergenceCount: number;
  highestClass: ClassifierResult["highestClass"];
  routedAction: RoutedAction | "NONE";
  engineWallclockMs: number;
  finalPlanHash: string | null;
  finalVerdictHash: string | null;
  candidateError: string | null;
  shadowMode: boolean;
  ranAt: string;
}

async function persistRun(row: PersistRunRow): Promise<string | null> {
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO orchestrator_replay_runs
        (id, ran_at, cassette_hash, path_shape, outcome, divergence_count,
         highest_class, routed_action, engine_wallclock_ms, final_plan_hash,
         final_verdict_hash, candidate_error, shadow_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        row.ranAt,
        row.cassetteHash,
        row.pathShape,
        row.outcome,
        row.divergenceCount,
        row.highestClass,
        row.routedAction,
        row.engineWallclockMs,
        row.finalPlanHash,
        row.finalVerdictHash,
        row.candidateError,
        row.shadowMode,
      ],
    );
    return id;
  } catch (err) {
    logger.error(
      { component: "parity-job", err: String(err) },
      "[ParityJob] PERSIST_RUN_FAILED",
    );
    return null;
  }
}

async function persistDivergences(runId: string, divergences: Divergence[]): Promise<void> {
  try {
    for (const d of divergences) {
      const attribution = attributeDivergenceToModule(d.path);
      await pool.query(
        `INSERT INTO orchestrator_replay_divergences
          (id, run_id, divergence_class, path, module_id, expected, actual)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          randomUUID(),
          runId,
          d.class,
          d.path,
          attribution?.moduleId ?? null,
          JSON.stringify(d.expected ?? null),
          JSON.stringify(d.actual ?? null),
        ],
      );
    }
  } catch (err) {
    logger.error(
      { component: "parity-job", err: String(err) },
      "[ParityJob] PERSIST_DIVERGENCE_FAILED",
    );
  }
}

/**
 * Auto-revert eligibility — fail-closed.
 *
 * Per Phase 4-C spec ("only if within 6h of module flag flip"), this
 * returns TRUE iff we can prove a MODULE_FLAG_PROMOTED audit row exists
 * within the last `windowMs`. If no row exists OR the audit query
 * errors, we return FALSE and surface an alert log so the operator
 * knows revert attribution is unknown. Code-review #2 hardening: we
 * MUST NOT default to true when audit history is missing.
 */
async function wasModuleFlippedWithin(
  moduleId: string,
  windowMs: number,
  now: () => number,
): Promise<boolean> {
  try {
    const since = new Date(now() - windowMs).toISOString();
    const r = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
         FROM audit_log
        WHERE event_type = 'MODULE_FLAG_PROMOTED'
          AND created_at >= $1
          AND details LIKE $2`,
      [since, `%"moduleId":"${moduleId}"%`],
    );
    return parseInt(r.rows[0]?.cnt ?? "0", 10) > 0;
  } catch (err) {
    logger.error(
      { component: "parity-job", moduleId, err: String(err) },
      "[ParityJob] AUTO_REVERT_ATTRIBUTION_UNKNOWN — audit query failed, refusing revert",
    );
    return false;
  }
}

/**
 * Ensure a `MODULE_FLAG_OBSERVED_AT_CANDIDATE` audit row exists for
 * `moduleId`. Called once per tick for each TRACKED module whose
 * ORCH_USE_* flag is currently `candidate`. This stamps a SAFE
 * lower-bound "first observed at candidate" time so the 7d candidate-
 * burn-in clock can start even when the operator flipped the flag
 * out-of-band (no explicit promotion event).
 *
 * Code-review #7 hardening (finding #2):
 *   - The synthesized row uses a DISTINCT event_type so it CAN NOT
 *     satisfy `wasModuleFlippedWithin()` (the 6h auto-revert eligibility
 *     check) — that check stays pinned to genuine `MODULE_FLAG_PROMOTED`
 *     rows. This prevents a module being silently considered "recently
 *     flipped" purely because the parity tick observed it at candidate.
 *   - The 7d burn-in clock (health.ts) uses EITHER event type because
 *     either is valid evidence the module has been at candidate.
 *
 * Idempotent — only inserts when no row exists after the most recent
 * revert. Safe to call hourly.
 */
export async function ensureModuleObservedAtCandidate(moduleId: string): Promise<void> {
  try {
    const latestRevert = await pool.query<{ at: Date | null }>(
      `SELECT MAX(created_at) AS at FROM audit_log
        WHERE event_type = 'MODULE_FLAG_REVERTED'
          AND details LIKE $1`,
      [`%"moduleId":"${moduleId}"%`],
    );
    const revertAt = latestRevert.rows[0]?.at ?? null;
    const existing = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM audit_log
        WHERE event_type IN ('MODULE_FLAG_OBSERVED_AT_CANDIDATE', 'MODULE_FLAG_PROMOTED')
          AND details LIKE $1
          AND ($2::timestamptz IS NULL OR created_at > $2)`,
      [`%"moduleId":"${moduleId}"%`, revertAt],
    );
    if (parseInt(existing.rows[0]?.cnt ?? "0", 10) > 0) return;
    await pool.query(
      `INSERT INTO audit_log (id, account_id, event_type, details, execution_status, created_at)
       VALUES (gen_random_uuid(), 'system-parity-gate', 'MODULE_FLAG_OBSERVED_AT_CANDIDATE', $1, 'COMPLETED', NOW())`,
      [JSON.stringify({ moduleId, source: "parity_tick_first_observed_at_candidate" })],
    );
    logger.info(
      { component: "parity-job", moduleId },
      "[ParityJob] MODULE_FLAG_OBSERVED_AT_CANDIDATE stamped (burn-in clock anchor only — NOT a flip event)",
    );
  } catch (err) {
    logger.warn(
      { component: "parity-job", moduleId, err: String(err) },
      "[ParityJob] MODULE_OBSERVED_AT_CANDIDATE_STAMP_FAILED",
    );
  }
}
