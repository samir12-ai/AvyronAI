/**
 * Task #91 / Phase 4-C → reclassified by Task #93 / Phase 4-E.
 *
 * Replay Regression Tick. One tick of the regression observer:
 *   1. Load routing table from `divergence_class_routes`.
 *   2. Pull last `LIMIT` production cassettes (purpose='parity').
 *   3. Replay each against the candidate orchestrator.
 *   4. Persist run + per-divergence rows.
 *   5. Refresh path-shape coverage + CV-15 counters.
 *
 * REMOVED in P4-E:
 *   - Auto-revert helper invocation (`revertModuleFlag()`).
 *   - ORCH_USE_<MODULE> env reads and the TRACKED_FOR_PROMOTION_STAMP
 *     loop (no module flags exist anymore).
 *   - `wasModuleFlippedWithin`, `ensureModuleObservedAtCandidate`.
 *
 * Shadow mode (`PARITY_SHADOW=1`) is now a no-op label — every tick is
 * observe-only; the field is retained for downstream dashboards.
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
import { attributeDivergenceToModule } from "./divergence-attribution";
import type {
  ParityRunOutcome,
  RoutedAction,
} from "./types";

export interface ParityJobOptions {
  limit?: number;
  maxTickMs?: number;
  forceShadow?: boolean;
  routingTableOverride?: ClassifierResult extends infer _R ? Awaited<ReturnType<typeof loadRoutingTable>> | undefined : never;
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
  shadowMode: boolean;
  errors: Array<{ cassetteHash: string; error: string }>;
}

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
      shadowMode,
      errors: [{ cassetteHash: "<routing-table>", error: String(err) }],
    };
  }

  const cassetteRows = await pool.query<{
    cassette_hash: string;
    path_shape: string | null;
    body: ReplayCassetteBody;
  }>(
    `SELECT cassette_hash, path_shape, body
       FROM orchestrator_replay_cassettes
      WHERE source = 'production' AND purpose = 'parity'
   ORDER BY captured_at DESC
      LIMIT $1`,
    [limit],
  );

  const runs: ParityTickReport["runs"] = [];
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
  }

  return {
    tickAt,
    cassettesEvaluated: runs.length,
    runs,
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
