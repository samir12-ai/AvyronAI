/**
 * Phase 3 (Task #66) — Pre-plan gate (single verdict owner).
 *
 * Before Phase 3, `evaluateUncertainty` in
 * `server/output-projection/uncertainty-guard.ts` carried both
 * concerns: (a) aggregating engine-output metrics, and (b) emitting a
 * PROCEED/DOWNGRADE/BLOCK verdict on those metrics — which made it a
 * second verdict producer alongside system-control. Phase 3 splits the
 * concerns:
 *
 *   - `uncertainty-guard.ts` is now metrics-only (`analyzeUncertaintyMetrics`).
 *   - `pre-plan-gate.ts` (this module) owns the proceed/downgrade/block
 *     decision on those metrics, under system-control authority.
 *
 * The pre-plan gate is the LAST gate before strategic-core synthesises a
 * plan from engine outputs; system-control's post-engine verdict runs
 * after the engines but before plan synthesis. Both gates live under
 * `server/system-control/` so verdict-emission authority is in one
 * directory tree.
 */

import type {
  UncertaintyMetrics,
  UncertaintyThresholds,
} from "../output-projection/uncertainty-guard";
import { DEFAULT_UNCERTAINTY_THRESHOLDS } from "../output-projection/uncertainty-guard";

export const PRE_PLAN_GATE_DECISIONS = ["PROCEED", "DOWNGRADE", "BLOCK"] as const;
export type PrePlanGateDecision = (typeof PRE_PLAN_GATE_DECISIONS)[number];

export interface PrePlanGateResult {
  decision: PrePlanGateDecision;
  aggregatedConfidence: number;
  aggregatedCompleteness: number;
  riskFlags: string[];
  reasoning: string;
}

/**
 * Decides PROCEED/DOWNGRADE/BLOCK from already-aggregated uncertainty
 * metrics. Bit-for-bit equivalent to the historical `evaluateUncertainty`
 * verdict branches — Phase 3 only relocates the owner; thresholds and
 * comparison order are unchanged.
 */
export function decidePrePlanGate(
  metrics: UncertaintyMetrics,
  thresholds: UncertaintyThresholds = DEFAULT_UNCERTAINTY_THRESHOLDS,
): PrePlanGateResult {
  const { aggregatedConfidence: confidence, aggregatedCompleteness: completeness, riskFlags, sampleSize } = metrics;

  if (sampleSize === 0) {
    return {
      decision: "BLOCK",
      aggregatedConfidence: 0,
      aggregatedCompleteness: 0,
      riskFlags: [],
      reasoning: "No engine outputs to evaluate — cannot proceed with empty data.",
    };
  }

  const criticalFlagCount = riskFlags.length;

  if (criticalFlagCount > thresholds.maxCriticalRiskFlags) {
    return {
      decision: "BLOCK",
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning:
        `Too many risk flags (${criticalFlagCount}/${thresholds.maxCriticalRiskFlags} max). ` +
        `Flags: [${riskFlags.join("; ")}]. Plan generation halted.`,
    };
  }

  if (confidence < thresholds.confidenceDowngrade || completeness < thresholds.completenessDowngrade) {
    return {
      decision: "BLOCK",
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning:
        `Confidence (${confidence}%) or completeness (${completeness}%) below minimum threshold ` +
        `(${thresholds.confidenceDowngrade}%). Insufficient data for reliable plan.`,
    };
  }

  if (confidence < thresholds.confidenceProceed || completeness < thresholds.completenessProceed) {
    return {
      decision: "DOWNGRADE",
      aggregatedConfidence: confidence,
      aggregatedCompleteness: completeness,
      riskFlags,
      reasoning:
        `Confidence (${confidence}%) or completeness (${completeness}%) below proceed threshold ` +
        `(${thresholds.confidenceProceed}%). Recommendations marked as low-confidence.`,
    };
  }

  return {
    decision: "PROCEED",
    aggregatedConfidence: confidence,
    aggregatedCompleteness: completeness,
    riskFlags,
    reasoning:
      `All thresholds met. Confidence: ${confidence}%, Completeness: ${completeness}%, ` +
      `Risk flags: ${criticalFlagCount}.`,
  };
}
