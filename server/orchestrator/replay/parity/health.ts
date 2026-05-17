/**
 * Task #91 / Phase 4-C — Parity health aggregator.
 *
 * Backs `/healthz/orchestrator-parity`. Reads:
 *   - orchestrator_replay_cassettes  (corpus cardinality + age)
 *   - orchestrator_replay_runs        (recent outcomes)
 *   - orchestrator_replay_divergences (class histogram, last 24h)
 *   - orchestrator_extraction_divergences (per-module 7d burn-in)
 *   - process.env.ORCH_USE_*          (current per-module flag state)
 *
 * Computes:
 *   - readyForCutover  — the canonical input to Phase 4-D.
 *   - blockers         — human-readable reasons readyForCutover is false.
 *   - divergencesByClassLast24h
 *   - modulesBlocked   — currently `current` after a recent BLOCK revert.
 *   - modulesShadowOnly — currently `shadow`.
 *   - modulesAtCandidate — currently `candidate` AND zero divergence in 7d.
 *
 * `readyForCutover=true` REQUIRES ALL of (per task spec):
 *   - ≥ minCassettes
 *   - oldest cassette ≤ maxOldestHours
 *   - zero BLOCK divergences in last `blockFreeWindowHours`
 *   - zero WARN divergences in last `warnFreeWindowHours`
 *   - every module at `candidate` for ≥ candidateBurnInDays without divergence
 *   - every path-shape covered (NO override knob)
 */
import { pool } from "../../../db";
import {
  setParityReady,
  setParityBlockAgeHours,
} from "./cv15-metrics";
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
  type ParityAutoRevertLogRow,
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

const TRACKED_MODULES: Array<{ moduleId: string; moduleFlag: string }> = [
  { moduleId: "system-control", moduleFlag: "SYS_CONTROL" },
  { moduleId: "priority-matrix", moduleFlag: "PRIORITY_MATRIX" },
  { moduleId: "plan-synthesis", moduleFlag: "PLAN_SYNTHESIS" },
  { moduleId: "budget-decision-ledger", moduleFlag: "BUDGET_LEDGER" },
  { moduleId: "ctx-resolve", moduleFlag: "CTX_RESOLVE" },
];

export async function computeParityHealth(
  thresholds: ParityGateThresholds = DEFAULT_THRESHOLDS,
  now: () => number = () => Date.now(),
): Promise<OrchestratorParityHealth> {
  const nowMs = now();
  const shadowMode = process.env.PARITY_SHADOW === "1";

  // Corpus cardinality.
  const corpus = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM orchestrator_replay_cassettes`,
  );
  const cassetteCount = parseInt(corpus.rows[0]?.cnt ?? "0", 10);
  // Freshness window (code-review #5 fix): the cassettes table is
  // append-only — using a global MIN(captured_at) would block
  // `readyForCutover` forever once any old row exists. The intended
  // semantics are "oldest cassette of the ACTIVE corpus ≤ N hours
  // old", where "active corpus" = the most recent `minCassettes`
  // cassettes. We sort DESC by captured_at, take `minCassettes`, then
  // return the MIN(captured_at) within that window.
  const windowSize = Math.max(1, thresholds.minCassettes);
  const windowRow = await pool.query<{ oldest_in_window: Date | null }>(
    `SELECT MIN(captured_at) AS oldest_in_window
       FROM (
         SELECT captured_at FROM orchestrator_replay_cassettes
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

  // Divergences by class, last 24h.
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

  // Per-class top divergence paths in last 24h (code-review #7 finding
  // #3 — divergence-detail click-through). Capped at 5 paths per class
  // via window function so a single hot path can't flood the panel.
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

  // Auto-revert log last 24h (code-review #7 finding #3 — operator panel
  // surfaces recent auto-reverts so an incident is visible without SSH).
  const autoRevertsLast24h: ParityAutoRevertLogRow[] = [];
  try {
    const arRows = await pool.query<{
      created_at: Date;
      execution_status: string;
      details: string;
    }>(
      `SELECT created_at, execution_status, details::text AS details
         FROM audit_log
        WHERE event_type = 'MODULE_AUTO_REVERT'
          AND created_at >= $1
     ORDER BY created_at DESC
        LIMIT 20`,
      [since24h],
    );
    for (const r of arRows.rows) {
      try {
        const parsed = JSON.parse(r.details) as {
          moduleId?: unknown;
          moduleFlag?: unknown;
          reason?: unknown;
          suppressed?: unknown;
        };
        autoRevertsLast24h.push({
          at: new Date(r.created_at).toISOString(),
          moduleId: typeof parsed.moduleId === "string" ? parsed.moduleId : "unknown",
          moduleFlag: typeof parsed.moduleFlag === "string" ? parsed.moduleFlag : "unknown",
          reason: typeof parsed.reason === "string" ? parsed.reason : "unknown",
          suppressed: parsed.suppressed === true || r.execution_status === "SUPPRESSED",
        });
      } catch {
        autoRevertsLast24h.push({
          at: new Date(r.created_at).toISOString(),
          moduleId: "unknown",
          moduleFlag: "unknown",
          reason: "audit_details_unparseable",
          suppressed: r.execution_status === "SUPPRESSED",
        });
      }
    }
  } catch (err) {
    logger.warn(
      { component: "parity-health", err: String(err) },
      "[ParityHealth] AUTO_REVERT_LOG_QUERY_FAILED",
    );
  }

  // BLOCK-free window check.
  const blockSince = new Date(nowMs - thresholds.blockFreeWindowHours * 3_600_000).toISOString();
  const blockRuns = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM orchestrator_replay_runs
      WHERE outcome = 'BLOCK' AND ran_at >= $1`,
    [blockSince],
  );
  const blockHits = parseInt(blockRuns.rows[0]?.cnt ?? "0", 10);

  // WARN-free window check.
  const warnSince = new Date(nowMs - thresholds.warnFreeWindowHours * 3_600_000).toISOString();
  const warnRuns = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM orchestrator_replay_runs
      WHERE outcome = 'WARN' AND ran_at >= $1`,
    [warnSince],
  );
  const warnHits = parseInt(warnRuns.rows[0]?.cnt ?? "0", 10);

  // Most recent BLOCK — block-age gauge.
  const latestBlock = await pool.query<{ latest: Date | null }>(
    `SELECT MAX(ran_at) AS latest FROM orchestrator_replay_runs WHERE outcome = 'BLOCK'`,
  );
  const latestBlockMs = latestBlock.rows[0]?.latest ? new Date(latestBlock.rows[0].latest).getTime() : null;
  const blockAgeHours = latestBlockMs === null ? Number.POSITIVE_INFINITY : Math.max(0, (nowMs - latestBlockMs) / 3_600_000);
  setParityBlockAgeHours(Number.isFinite(blockAgeHours) ? blockAgeHours : 9999);

  // Module classification.
  //
  // A module qualifies for `modulesAtCandidate` iff ALL of:
  //   (a) ORCH_USE_<flag> === "candidate"
  //   (b) zero divergences in last `candidateBurnInDays`
  //   (c) MODULE_FLAG_PROMOTED OR MODULE_FLAG_OBSERVED_AT_CANDIDATE audit
  //       row exists AND is >= candidateBurnInDays old (burn-in clock).
  //       Either event is valid evidence the module has been at candidate
  //       — but only `_PROMOTED` is a genuine flip event (code-review #7
  //       finding #2). The burn-in clock and the 6h auto-revert window
  //       check DIFFERENT event sets:
  //         • burn-in (here)     → PROMOTED ∪ OBSERVED_AT_CANDIDATE
  //         • 6h flip eligibility → PROMOTED only (parity-job.ts)
  // Failing (b) → modulesBlocked. Failing (c) → modulesAwaitingBurnIn.
  const modulesBlocked: string[] = [];
  const modulesShadowOnly: string[] = [];
  const modulesAtCandidate: string[] = [];
  const modulesAwaitingBurnIn: Array<{ moduleId: string; daysAtCandidate: number | null }> = [];
  const burnInSince = new Date(nowMs - thresholds.candidateBurnInDays * 24 * 3_600_000).toISOString();
  for (const m of TRACKED_MODULES) {
    const mode = process.env[`ORCH_USE_${m.moduleFlag}`] ?? "current";
    if (mode === "candidate") {
      const div = await pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM orchestrator_extraction_divergences
          WHERE module_id = $1 AND captured_at >= $2`,
        [m.moduleId, burnInSince],
      );
      const hasDivergence = parseInt(div.rows[0]?.cnt ?? "0", 10) > 0;
      if (hasDivergence) {
        modulesBlocked.push(m.moduleId);
        continue;
      }
      // Flip-age check: continuous-stint based (code-review #4 hardening).
      // The burn-in clock starts at the EARLIEST MODULE_FLAG_PROMOTED row
      // that is AFTER the most recent MODULE_FLAG_REVERTED row for this
      // module. A promote→revert→re-promote cycle resets the clock — the
      // first-ever promotion is NOT a valid burn-in anchor if any later
      // revert happened. This is the canonical readiness input for P4-D.
      let promotedAtMs: number | null = null;
      try {
        const latestRevert = await pool.query<{ at: Date | null }>(
          `SELECT MAX(created_at) AS at FROM audit_log
            WHERE event_type = 'MODULE_FLAG_REVERTED'
              AND details LIKE $1`,
          [`%"moduleId":"${m.moduleId}"%`],
        );
        const revertAt = latestRevert.rows[0]?.at ?? null;
        const promoted = await pool.query<{ first: Date | null }>(
          `SELECT MIN(created_at) AS first FROM audit_log
            WHERE event_type IN ('MODULE_FLAG_PROMOTED', 'MODULE_FLAG_OBSERVED_AT_CANDIDATE')
              AND details LIKE $1
              AND ($2::timestamptz IS NULL OR created_at > $2)`,
          [`%"moduleId":"${m.moduleId}"%`, revertAt],
        );
        promotedAtMs = promoted.rows[0]?.first ? new Date(promoted.rows[0].first).getTime() : null;
      } catch (err) {
        logger.error(
          { component: "parity-health", moduleId: m.moduleId, err: String(err) },
          "[ParityHealth] PROMOTION_AUDIT_QUERY_FAILED",
        );
      }
      const daysAtCandidate = promotedAtMs === null
        ? null
        : (nowMs - promotedAtMs) / (24 * 3_600_000);
      if (daysAtCandidate !== null && daysAtCandidate >= thresholds.candidateBurnInDays) {
        modulesAtCandidate.push(m.moduleId);
      } else {
        modulesAwaitingBurnIn.push({ moduleId: m.moduleId, daysAtCandidate });
      }
    } else if (mode === "shadow") {
      modulesShadowOnly.push(m.moduleId);
    }
    // mode === "current" not surfaced unless blocked above.
  }

  // Path-shape coverage (refreshes CV-15 path gauges as a side effect).
  const coverageReport: PathShapeCoverageReport = await evaluatePathShapeCoverage(thresholds, now);
  // Code-review #4 hardening: when shapes are uncovered, request
  // synthetic fillers (audit row + optional capture handler). The call
  // is fire-and-forget within this aggregator — it self-handles errors.
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

  // Last tick timestamp.
  const lastTickRow = await pool.query<{ last: Date | null }>(
    `SELECT MAX(ran_at) AS last FROM orchestrator_replay_runs`,
  );
  const lastTickAt = lastTickRow.rows[0]?.last ? new Date(lastTickRow.rows[0].last).toISOString() : null;

  // Compose blockers + readyForCutover. Each failed criterion adds a row.
  const blockers: string[] = [];
  if (cassetteCount < thresholds.minCassettes) {
    blockers.push(`cassette_count=${cassetteCount} < minCassettes=${thresholds.minCassettes}`);
  }
  if (oldestCassetteAgeH > thresholds.maxOldestHours) {
    blockers.push(`oldest_cassette_age_h=${oldestCassetteAgeH.toFixed(1)} > maxOldestHours=${thresholds.maxOldestHours}`);
  }
  if (blockHits > 0) blockers.push(`block_divergences_${thresholds.blockFreeWindowHours}h=${blockHits}`);
  if (warnHits > 0) blockers.push(`warn_divergences_${thresholds.warnFreeWindowHours}h=${warnHits}`);
  for (const m of TRACKED_MODULES) {
    if (modulesAtCandidate.includes(m.moduleId)) continue;
    const mode = process.env[`ORCH_USE_${m.moduleFlag}`] ?? "current";
    // Code-review #1 hardening: shadow mode is NOT a passing state for
    // the cutover gate — the requirement is "every module at candidate
    // for ≥7d without divergence". Shadow + current both block.
    if (mode === "current") {
      blockers.push(`module_not_at_candidate=${m.moduleId}`);
    } else if (mode === "shadow") {
      blockers.push(`module_shadow_only=${m.moduleId}`);
    }
    // mode === "candidate" but not in modulesAtCandidate → already
    // pushed via modulesBlocked or modulesAwaitingBurnIn below.
  }
  if (modulesBlocked.length > 0) {
    blockers.push(`modules_with_divergence_in_burnin=${modulesBlocked.join(",")}`);
  }
  for (const awaiting of modulesAwaitingBurnIn) {
    blockers.push(
      `module_burnin_incomplete=${awaiting.moduleId}` +
        (awaiting.daysAtCandidate === null
          ? "(no_promotion_audit)"
          : `(days=${awaiting.daysAtCandidate.toFixed(2)})`),
    );
  }
  if (!coverageReport.allCovered) {
    const missing = coverageReport.rows.filter((r) => !r.covered).map((r) => r.pathShape);
    blockers.push(`path_shapes_uncovered=${missing.join(",")}`);
  }
  if (shadowMode) {
    blockers.push("parity_shadow_mode_active");
  }
  // Code-review #7 finding #1: the boot-time parity-candidate factory
  // ships as a throwing stub until Phase 4-B llm-injection plumbing is
  // complete. Surface this as a blocker so `readyForCutover` cannot
  // accidentally go green during the deferred period.
  const candidateWiringDeferred = process.env.PARITY_CANDIDATE_DEFERRED === "1";
  if (candidateWiringDeferred) {
    blockers.push("candidate_orchestrator_not_wired_phase4b_pending");
  }

  const readyForCutover = blockers.length === 0;
  setParityReady(readyForCutover);

  return {
    cassetteCount,
    oldestCassetteAgeH: Number.isFinite(oldestCassetteAgeH) ? oldestCassetteAgeH : 0,
    divergencesByClassLast24h,
    divergencePathsByClassLast24h,
    autoRevertsLast24h,
    modulesBlocked,
    modulesShadowOnly,
    modulesAtCandidate,
    modulesAwaitingBurnIn,
    pathShapeCoverage,
    blockers,
    readyForCutover,
    shadowMode,
    lastTickAt,
    candidateWiringDeferred,
  };
}
