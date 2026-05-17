/**
 * Task #92 / Phase 4-D — Auto-revert wired to traffic-percent.
 *
 * Distinct from `extraction-dispatch/auto-revert-supervisor.ts` (which
 * reverts per-module dispatch flags). THIS supervisor reverts the
 * whole-orchestrator traffic-percent to 0 on any BLOCK-class divergence
 * (STRUCTURAL or CANONICAL_FIELD) observed while traffic_percent > 0.
 *
 * Doctrine:
 *   - OD-5: BLOCK divergence is the ONLY automatic traffic-percent
 *     change. Promotions are manual operator actions through the panel.
 *   - OD-3: the revert is atomic — the DB UPDATE happens INSIDE this
 *     function before any caller can observe the new percent.
 *
 * `locked_until` is set to NOW()+1h so a follow-on observer cannot
 * thrash the system back up before an operator has reviewed.
 */

import {
  readCutoverState,
  stampDivergenceObserved,
  writeCutoverPercent,
} from "./state-store";
import {
  recordAutoRevert,
  recordDivergenceAtTraffic,
  type CutoverAutoRevertReason,
  type DivergenceClassForMetric,
} from "./metrics";

const BLOCK_CLASSES: ReadonlySet<DivergenceClassForMetric> = new Set([
  "STRUCTURAL",
  "CANONICAL_FIELD",
]);

const LOCK_DURATION_MS = 60 * 60 * 1000; // 1h cool-off after auto-revert

export interface CandidateDivergenceObservation {
  /** Strictly one of the diff classifier's enum values. */
  divergenceClass: DivergenceClassForMetric;
  jobId: string;
}

/**
 * Record a divergence observed during a candidate-path run. When the
 * class is BLOCK-level AND traffic_percent > 0, flip traffic_percent
 * to 0 and lock for 1h. Returns whether a revert was actually performed.
 *
 * The function is safe to call from any candidate-path code: it does
 * its own read of cutover_state so the caller does not need to pre-read.
 */
export async function recordCandidateDivergence(
  obs: CandidateDivergenceObservation,
): Promise<{ reverted: boolean; reason?: string }> {
  const state = await readCutoverState();
  recordDivergenceAtTraffic(state.trafficPercent, obs.divergenceClass);
  await stampDivergenceObserved();

  if (state.trafficPercent === 0) return { reverted: false };
  if (!BLOCK_CLASSES.has(obs.divergenceClass)) return { reverted: false };

  const reason: CutoverAutoRevertReason =
    obs.divergenceClass === "STRUCTURAL"
      ? "structural_divergence"
      : "canonical_field_divergence";
  recordAutoRevert(reason);
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
  try {
    await writeCutoverPercent(
      0,
      "auto_revert",
      `${reason}: jobId=${obs.jobId}, prevPercent=${state.trafficPercent}`,
      lockedUntil,
    );
    return { reverted: true, reason };
  } catch (err: any) {
    // The revert MUST land. If the DB refused (concurrent op?), log
    // loud and rethrow — Seal #15: no silent catches.
    console.error(
      `[Orchestrator/Cutover] AUTO_REVERT_FAILED | reason=${reason} | jobId=${obs.jobId} | err=${err?.message ?? String(err)}`,
    );
    throw err;
  }
}

/**
 * Candidate threw an unrecoverable error mid-run. Treat as the most
 * severe class possible — flip to 0 immediately.
 */
export async function recordCandidateThrow(jobId: string, errMessage: string): Promise<void> {
  const state = await readCutoverState();
  if (state.trafficPercent === 0) return;
  recordAutoRevert("candidate_threw");
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
  await writeCutoverPercent(
    0,
    "auto_revert",
    `candidate_threw: jobId=${jobId}, err=${errMessage.slice(0, 200)}`,
    lockedUntil,
  );
}
