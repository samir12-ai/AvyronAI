/**
 * Phase 3 (Task #66) — uncertainty-guard is now METRICS-ONLY.
 *
 * Verdict authority (PROCEED/DOWNGRADE/BLOCK) was relocated to
 * `server/system-control/pre-plan-gate.ts::decidePrePlanGate()` so the
 * pre-plan and post-engine verdicts share a single owning directory.
 *
 * This module exposes:
 *   - the metric aggregations (`aggregateConfidence`, `aggregateCompleteness`,
 *     `collectRiskFlags`)
 *   - `analyzeUncertaintyMetrics()` — a pure aggregator that returns a
 *     numeric/flags snapshot, no decision enum.
 *
 * The decision-emitting `evaluateUncertainty()` was removed. Callers
 * MUST compose `analyzeUncertaintyMetrics()` with `decidePrePlanGate()`
 * (or another system-control-owned decision function) — this prevents a
 * future caller from re-introducing a parallel verdict producer.
 */

import type { EngineOutput } from './engine-contract';

export interface UncertaintyThresholds {
  confidenceProceed: number;
  confidenceDowngrade: number;
  completenessProceed: number;
  completenessDowngrade: number;
  maxCriticalRiskFlags: number;
}

export const DEFAULT_UNCERTAINTY_THRESHOLDS: UncertaintyThresholds = {
  confidenceProceed: 60,
  confidenceDowngrade: 40,
  completenessProceed: 60,
  completenessDowngrade: 40,
  maxCriticalRiskFlags: 2,
};

/**
 * Phase 3 (Task #66) — metrics-only snapshot. NO verdict enum. Callers
 * route this through `decidePrePlanGate` (system-control) to obtain a
 * PROCEED/DOWNGRADE/BLOCK decision.
 */
export interface UncertaintyMetrics {
  aggregatedConfidence: number;
  aggregatedCompleteness: number;
  riskFlags: string[];
  sampleSize: number;
}

export function aggregateConfidence(outputs: EngineOutput[]): number {
  if (outputs.length === 0) return 0;
  const total = outputs.reduce((sum, o) => sum + o.confidence, 0);
  return Math.round(total / outputs.length);
}

export function aggregateCompleteness(outputs: EngineOutput[]): number {
  if (outputs.length === 0) return 0;
  return Math.round(Math.min(...outputs.map(o => o.dataCompleteness)));
}

export function collectRiskFlags(outputs: EngineOutput[]): string[] {
  const flags: string[] = [];
  for (const output of outputs) {
    if (output.riskFlag) {
      flags.push(`[${output.scope}] ${output.riskFlag}`);
    }
  }
  return flags;
}

/**
 * Pure metric aggregator. Returns the numeric snapshot the
 * `decidePrePlanGate` (system-control) owner uses to emit a verdict.
 *
 * Phase 3 doctrine guard: do NOT add `decision: PROCEED|...` here.
 * If a future change wants to re-introduce a decision enum, it MUST
 * live in `server/system-control/`.
 */
export function analyzeUncertaintyMetrics(outputs: EngineOutput[]): UncertaintyMetrics {
  return {
    aggregatedConfidence: aggregateConfidence(outputs),
    aggregatedCompleteness: aggregateCompleteness(outputs),
    riskFlags: collectRiskFlags(outputs),
    sampleSize: outputs.length,
  };
}
