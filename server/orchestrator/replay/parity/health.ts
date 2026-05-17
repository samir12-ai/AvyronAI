/**
 * Task #91 / Phase 4-C → reclassified by Task #93 / Phase 4-E.
 *
 * Replay Regression Observer health aggregator. Backs
 * `/healthz/orchestrator-parity`. The Phase 4-D cutover gate was
 * deleted, so this surface now reports CORPUS health only:
 *
 *   - cassette count (purpose='parity' only)
 *   - oldest-cassette-age within the active corpus window
 *   - divergencesByClassLast24h (histogram)
 *   - divergencePathsByClassLast24h (top-5 per class)
 *   - pathShapeCoverage
 *   - lastTickAt
 *
 * Removed: readyForCutover, modulesAtCandidate, modulesAwaitingBurnIn,
 * modulesBlocked, modulesShadowOnly, autoRevertsLast24h, ORCH_USE_*
 * reads, candidateWiringDeferred. The blockers list is retained but
 * now reflects ONLY corpus shortfalls (low count, stale, uncovered
 * shapes) — never module flags.
 */
import { pool } from "../../../db";
import { setParityBlockAgeHours } from "./cv15-metrics";
import {
  evaluatePathShapeCoverage,
  requestSyntheticFillers,
  type PathShapeCoverageReport,
} from "./path-coverage";
import { logger } from "../../../logger";
import {
  DEFAULT_THRESHOLDS,
  type OrchestratorParityHealth,
  type ParityGateThresholds,
  type ParityPathShape,
  type ParityDivergencePathRow,
} from "./types";
import type { DivergenceClass } from "../types";

const ALL_CLASSES: DivergenceClass[] = [
  "STRUCTURAL",
  "CANONICAL_FIELD",
  "DEGRADATION_SURFACE",
  "BUDGET_LEDGER",
  "PROVENANCE",
  "ORDER",
  "TIMING_ONLY",
];

export async function computeParityHealth(
  thresholds: ParityGateThresholds = DEFAULT_THRESHOLDS,
  now: () => number = () => Date.now(),
): Promise<OrchestratorParityHealth> {
  const nowMs = now();
  const shadowMode = process.env.PARITY_SHADOW === "1";

  // Corpus cardinality — purpose='parity' only.
  const corpus = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM orchestrator_replay_cassettes WHERE purpose = 'parity'`,
  );
  const cassetteCount = parseInt(corpus.rows[0]?.cnt ?? "0", 10);

  // Freshness of the ACTIVE corpus window (most recent `minCassettes`).
  const windowSize = Math.max(1, thresholds.minCassettes);
  const windowRow = await pool.query<{ oldest_in_window: Date | null }>(
    `SELECT MIN(captured_at) AS oldest_in_window FROM (
       SELECT captured_at FROM orchestrator_replay_cassettes
       WHERE purpose = 'parity'
       ORDER BY captured_at DESC LIMIT $1
     ) w`,
    [windowSize],
  );
  const oldestInWindowMs = windowRow.rows[0]?.oldest_in_window
    ? new Date(windowRow.rows[0].oldest_in_window).getTime()
    : null;
  const oldestCassetteAgeH = oldestInWindowMs === null
    ? Infinity
    : Math.max(0, (nowMs - oldestInWindowMs) / 3_600_000);

  // Divergence histogram (24h).
  const since24h = new Date(nowMs - 24 * 3_600_000).toISOString();
  const divHist = await pool.query<{ divergence_class: string; cnt: string }>(
    `SELECT divergence_class, COUNT(*)::text AS cnt
       FROM orchestrator_replay_divergences
      WHERE observed_at >= $1
   GROUP BY divergence_class`,
    [since24h],
  );
  const divergencesByClassLast24h = ALL_CLASSES.reduce(
    (acc, c) => { acc[c] = 0; return acc; },
    {} as Record<DivergenceClass, number>,
  );
  for (const r of divHist.rows) {
    if ((ALL_CLASSES as string[]).includes(r.divergence_class)) {
      divergencesByClassLast24h[r.divergence_class as DivergenceClass] = parseInt(r.cnt, 10);
    }
  }

  // Per-class top-5 divergence paths.
  const divergencePathsByClassLast24h: ParityDivergencePathRow[] = [];
  try {
    const detailRows = await pool.query<{
      divergence_class: string;
      path: string;
      cnt: string;
    }>(
      `SELECT divergence_class, path, cnt FROM (
         SELECT divergence_class, path, COUNT(*)::text AS cnt,
                ROW_NUMBER() OVER (PARTITION BY divergence_class ORDER BY COUNT(*) DESC, path) AS rn
           FROM orchestrator_replay_divergences
          WHERE observed_at >= $1
       GROUP BY divergence_class, path
       ) ranked
       WHERE rn <= 5
       ORDER BY divergence_class, cnt::int DESC, path`,
      [since24h],
    );
    for (const r of detailRows.rows) {
      if (!(ALL_CLASSES as string[]).includes(r.divergence_class)) continue;
      divergencePathsByClassLast24h.push({
        divergenceClass: r.divergence_class as DivergenceClass,
        path: r.path,
        count: parseInt(r.cnt, 10),
      });
    }
  } catch (err) {
    logger.warn(
      { component: "parity-health", err: String(err) },
      "[ParityHealth] DIVERGENCE_PATH_DETAIL_QUERY_FAILED",
    );
  }

  // Block-age gauge (informational — block freshness for the regression
  // observer; does NOT gate any cutover decision since the cutover
  // system was removed).
  const latestBlock = await pool.query<{ latest: Date | null }>(
    `SELECT MAX(ran_at) AS latest FROM orchestrator_replay_runs WHERE outcome = 'BLOCK'`,
  );
  const latestBlockMs = latestBlock.rows[0]?.latest ? new Date(latestBlock.rows[0].latest).getTime() : null;
  const blockAgeHours = latestBlockMs === null ? Number.POSITIVE_INFINITY : Math.max(0, (nowMs - latestBlockMs) / 3_600_000);
  setParityBlockAgeHours(Number.isFinite(blockAgeHours) ? blockAgeHours : 9999);

  // Path-shape coverage.
  const coverageReport: PathShapeCoverageReport = await evaluatePathShapeCoverage(thresholds, now);
  if (!coverageReport.allCovered) {
    try {
      await requestSyntheticFillers(coverageReport);
    } catch (err) {
      logger.warn(
        { component: "parity-health", err: String(err) },
        "[ParityHealth] SYNTHETIC_FILLER_REQUEST_FAILED",
      );
    }
  }
  const pathShapeCoverage = coverageReport.rows.reduce(
    (acc, r) => { acc[r.pathShape] = { count: r.count, covered: r.covered }; return acc; },
    {} as Record<ParityPathShape, { count: number; covered: boolean }>,
  );

  const lastTickRow = await pool.query<{ last: Date | null }>(
    `SELECT MAX(ran_at) AS last FROM orchestrator_replay_runs`,
  );
  const lastTickAt = lastTickRow.rows[0]?.last ? new Date(lastTickRow.rows[0].last).toISOString() : null;

  // Corpus-only blockers — no module flags, no readiness scoring.
  const blockers: string[] = [];
  if (cassetteCount < thresholds.minCassettes) {
    blockers.push(`cassette_count=${cassetteCount} < minCassettes=${thresholds.minCassettes}`);
  }
  if (oldestCassetteAgeH > thresholds.maxOldestHours) {
    blockers.push(`oldest_cassette_age_h=${oldestCassetteAgeH.toFixed(1)} > maxOldestHours=${thresholds.maxOldestHours}`);
  }
  if (!coverageReport.allCovered) {
    const missing = coverageReport.rows.filter((r) => !r.covered).map((r) => r.pathShape);
    blockers.push(`path_shapes_uncovered=${missing.join(",")}`);
  }

  return {
    cassetteCount,
    oldestCassetteAgeH: Number.isFinite(oldestCassetteAgeH) ? oldestCassetteAgeH : 0,
    divergencesByClassLast24h,
    divergencePathsByClassLast24h,
    pathShapeCoverage,
    blockers,
    shadowMode,
    lastTickAt,
  };
}
