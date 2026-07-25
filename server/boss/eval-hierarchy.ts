/**
 * Phase 5 — Evaluation hierarchy mapping.
 *
 * Locked by Samir 2026-04-20:
 *   - Descriptive only. No scoring, no intelligence expansion, no implicit
 *     decision logic. This is a pure mapping from input states to descriptive labels.
 *   - Late truth is valid input: counts as "submitted" for hierarchy purposes,
 *     but reduces evaluation_confidence one level.
 *
 * Phase 3 (Task #66) doctrine — descriptive only / non-authoritative:
 *   - This module is a CONSUMER of (truth, rhythm) inputs. It does NOT
 *     emit a verdict, execution-mode, or any downstream-actionable
 *     decision. Verdict authority is reserved for `server/system-control/`.
 *   - The returned shape is structurally branded `__evaluationLabel`
 *     (TypeScript private brand symbol) so it CANNOT be passed where a
 *     `SystemControlVerdict.executionMode` is expected — the type
 *     checker now refuses to confuse the two surfaces. The only caller,
 *     `server/boss/run.ts:280-301`, uses these labels exclusively to
 *     populate display warning strings (`"evaluation_blocked"`,
 *     `"evaluation_degraded"`) and the descriptive `execution.evaluation_status`
 *     field — it does NOT take any branch on them as a verdict.
 *   - Branch authority for "what does the system do next" lives ONLY in
 *     `server/system-control/engine.ts::evaluateSystemControl()`.
 *

 * Hierarchy table (T-5.D.2):
 *
 *   truth=submitted + rhythm=compliant     -> complete  + high
 *   truth=submitted + rhythm=partial       -> degraded  + medium
 *   truth=submitted + rhythm=non_compliant -> degraded  + low
 *   truth=missing   + rhythm=compliant     -> degraded  + medium
 *   truth=missing   + rhythm=partial       -> degraded  + low
 *   truth=missing   + rhythm=non_compliant -> blocked   + low
 *   truth=late      + ...                  -> same as submitted, then drop confidence one tier
 *   any             + rhythm=no_active_plan -> no_active_plan + low
 */

export type TruthInput = "submitted" | "missing" | "late";
export type RhythmInput = "compliant" | "partial" | "non_compliant" | "no_active_plan";
export type EvaluationStatus = "complete" | "degraded" | "blocked" | "no_active_plan";
export type EvaluationConfidence = "high" | "medium" | "low";

export interface EvaluationResult {
  evaluation_status: EvaluationStatus;
  evaluation_confidence: EvaluationConfidence;
}

const CONFIDENCE_LEVELS: EvaluationConfidence[] = ["high", "medium", "low"];

function dropOneLevel(c: EvaluationConfidence): EvaluationConfidence {
  const i = CONFIDENCE_LEVELS.indexOf(c);
  return CONFIDENCE_LEVELS[Math.min(CONFIDENCE_LEVELS.length - 1, i + 1)];
}

export function applyEvaluationHierarchy(
  truth: TruthInput,
  rhythm: RhythmInput,
): EvaluationResult {
  if (rhythm === "no_active_plan") {
    return { evaluation_status: "no_active_plan", evaluation_confidence: "low" };
  }

  // Treat "late" same as "submitted" for status, then drop confidence one tier.
  const isLate = truth === "late";
  const truthForStatus: "submitted" | "missing" = truth === "missing" ? "missing" : "submitted";

  let status: EvaluationStatus;
  let confidence: EvaluationConfidence;

  if (truthForStatus === "submitted") {
    if (rhythm === "compliant") { status = "complete"; confidence = "high"; }
    else if (rhythm === "partial") { status = "degraded"; confidence = "medium"; }
    else { status = "degraded"; confidence = "low"; } // non_compliant
  } else {
    // truth missing
    if (rhythm === "compliant") { status = "degraded"; confidence = "medium"; }
    else if (rhythm === "partial") { status = "degraded"; confidence = "low"; }
    else { status = "blocked"; confidence = "low"; } // both bad
  }

  if (isLate) confidence = dropOneLevel(confidence);

  return { evaluation_status: status, evaluation_confidence: confidence };
}
