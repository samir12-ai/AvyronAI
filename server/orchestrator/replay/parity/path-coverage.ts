/**
 * Task #91 / Phase 4-C — Path-shape coverage monitor.
 *
 * Each of the 7 declared `ReplayPathShape` values must have at least
 * `minPerPathShape` cassettes captured within `maxPathShapeAgeHours`.
 * Missing shapes auto-generate a synthetic filler cassette via the
 * Phase 4-A capture script and tag it `source=synthetic`. The synthetic
 * filler is a LAST-RESORT signal — operator panel surfaces a "synthetic
 * filler" warning so the gap is visible to the regression observer.
 *
 * Task #93 / Phase 4-E: `readyForCutover` was deleted. Uncovered shapes
 * are still surfaced as corpus shortfalls in the parity health blockers
 * list, but they no longer gate any cutover decision.
 *
 * Coverage in this module COUNTS synthetic fillers because they exercise
 * the player against the candidate even when production never produced
 * that shape. Operators who want STRICT production-only coverage can
 * read `productionCoveredOnly` on the report.
 */
import { pool } from "../../../db";
import { logger } from "../../../logger";
import { setPathCoverage } from "./cv15-metrics";
import {
  PARITY_PATH_SHAPES,
  DEFAULT_THRESHOLDS,
  type ParityPathShape,
  type ParityGateThresholds,
} from "./types";

export interface PathShapeCoverageRow {
  pathShape: ParityPathShape;
  count: number;
  productionCount: number;
  syntheticCount: number;
  newestAgeHours: number | null;
  covered: boolean;
}

export interface PathShapeCoverageReport {
  rows: PathShapeCoverageRow[];
  allCovered: boolean;
  productionCoveredOnly: boolean;
}

export async function evaluatePathShapeCoverage(
  thresholds: ParityGateThresholds = DEFAULT_THRESHOLDS,
  now: () => number = () => Date.now(),
): Promise<PathShapeCoverageReport> {
  const cutoffMs = now() - thresholds.maxPathShapeAgeHours * 3_600_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const rows = await pool.query<{
    path_shape: string | null;
    source: string;
    cnt: string;
    newest: Date | null;
  }>(
    `SELECT path_shape, source, COUNT(*)::text AS cnt, MAX(captured_at) AS newest
       FROM orchestrator_replay_cassettes
      WHERE captured_at >= $1
   GROUP BY path_shape, source`,
    [cutoffIso],
  );
  const map = new Map<ParityPathShape, { production: number; synthetic: number; newest: number | null }>();
  for (const shape of PARITY_PATH_SHAPES) {
    map.set(shape, { production: 0, synthetic: 0, newest: null });
  }
  for (const r of rows.rows) {
    if (!r.path_shape) continue;
    if (!(PARITY_PATH_SHAPES as readonly string[]).includes(r.path_shape)) continue;
    const entry = map.get(r.path_shape as ParityPathShape)!;
    const n = parseInt(r.cnt, 10);
    if (r.source === "production") entry.production += n;
    else if (r.source === "synthetic" || r.source === "synthetic_filler") entry.synthetic += n;
    const newest = r.newest ? new Date(r.newest).getTime() : null;
    if (newest !== null && (entry.newest === null || newest > entry.newest)) {
      entry.newest = newest;
    }
  }
  const out: PathShapeCoverageRow[] = [];
  let allCovered = true;
  let productionCoveredOnly = true;
  for (const shape of PARITY_PATH_SHAPES) {
    const entry = map.get(shape)!;
    const count = entry.production + entry.synthetic;
    const covered = count >= thresholds.minPerPathShape;
    const newestAgeHours = entry.newest === null ? null : Math.max(0, (now() - entry.newest) / 3_600_000);
    setPathCoverage(shape, covered);
    if (!covered) allCovered = false;
    if (entry.production < thresholds.minPerPathShape) productionCoveredOnly = false;
    out.push({
      pathShape: shape,
      count,
      productionCount: entry.production,
      syntheticCount: entry.synthetic,
      newestAgeHours,
      covered,
    });
  }
  return { rows: out, allCovered, productionCoveredOnly };
}

/**
 * Identify path-shapes for which we should request a synthetic filler
 * cassette via the Phase 4-A capture pipeline. The actual capture lives
 * outside this module (`npm run replay:capture-synthetic`); this returns
 * the list of missing shapes so the operator panel + audit log surface
 * the gap.
 */
export function missingShapes(report: PathShapeCoverageReport): ParityPathShape[] {
  return report.rows.filter((r) => !r.covered).map((r) => r.pathShape);
}

/**
 * Trigger synthetic-filler capture requests for uncovered path-shapes.
 *
 * Code-review #4 hardening: previously this module only flagged
 * coverage. We now actively WIRE the request — for each missing shape
 * we (a) emit a PATH_SHAPE_FILLER_REQUESTED audit row (deduped at most
 * once per shape per hour), and (b) attempt the synthetic capture
 * callback if one has been registered via
 * `setSyntheticFillerCaptureHandler()`. The actual capture script
 * (`npm run replay:capture-synthetic`) registers itself; until it ships
 * we still emit the audit row so the operator panel + alert pipeline
 * surface the gap.
 *
 * Idempotent — multiple invocations per tick are safe.
 */
type SyntheticFillerHandler = (shape: ParityPathShape) => Promise<void>;
let _syntheticFillerHandler: SyntheticFillerHandler | null = null;

export function setSyntheticFillerCaptureHandler(handler: SyntheticFillerHandler | null): void {
  _syntheticFillerHandler = handler;
}

export async function requestSyntheticFillers(report: PathShapeCoverageReport): Promise<void> {
  const missing = missingShapes(report);
  if (missing.length === 0) return;
  for (const shape of missing) {
    try {
      const recent = await pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM audit_log
          WHERE event_type = 'PATH_SHAPE_FILLER_REQUESTED'
            AND created_at >= NOW() - INTERVAL '1 hour'
            AND details LIKE $1`,
        [`%"shape":"${shape}"%`],
      );
      if (parseInt(recent.rows[0]?.cnt ?? "0", 10) > 0) continue;
      await pool.query(
        `INSERT INTO audit_log (id, account_id, event_type, details, execution_status, created_at)
         VALUES (gen_random_uuid(), 'system-parity-gate', 'PATH_SHAPE_FILLER_REQUESTED', $1, 'NEEDS_INPUT', NOW())`,
        [JSON.stringify({ shape, reason: "uncovered_path_shape" })],
      );
      logger.warn(
        { component: "parity-path-coverage", shape },
        "[ParityPathCoverage] PATH_SHAPE_FILLER_REQUESTED",
      );
      if (_syntheticFillerHandler) {
        try {
          await _syntheticFillerHandler(shape);
        } catch (err) {
          logger.error(
            { component: "parity-path-coverage", shape, err: String(err) },
            "[ParityPathCoverage] SYNTHETIC_FILLER_HANDLER_FAILED",
          );
        }
      }
    } catch (err) {
      logger.error(
        { component: "parity-path-coverage", shape, err: String(err) },
        "[ParityPathCoverage] FILLER_REQUEST_AUDIT_FAILED",
      );
    }
  }
}
