/**
 * Phase 4-A — CV-11 hallucination-exposure counter wrapper.
 *
 * Increments `cv11_hallucination_exposure_total{kind,engine}` when a
 * commercial-reasoning integrity gate REJECTs an LLM output. Steady-state
 * 0; any non-zero rate is operator-visible per Memory-unification doctrine
 * (P2) and the §13-criterion-5 success gate.
 *
 * This module isolates the metric mutation so the interpreter's control
 * flow stays readable AND the awareness engine never imports the metrics
 * facade directly.
 */

import type { GateDecisionReason } from "./contract";

let cv11Counter: ((labels: Record<string, string>) => void) | null = null;

try {
  // Best-effort dynamic import so this module compiles even if the metrics
  // facade isn't fully wired into the test harness. The production path
  // (server boot via `server/index.ts`) wires Prom-client before the
  // interpreter is ever invoked.
  const metricsModule = require("../memory-system/cv06-metrics") as {
    cv11HallucinationExposureTotal?: { inc: (labels: Record<string, string>) => void };
  };
  if (metricsModule?.cv11HallucinationExposureTotal?.inc) {
    cv11Counter = (labels) => metricsModule.cv11HallucinationExposureTotal!.inc(labels);
  }
} catch (err) {
  // Per Seal #15 doctrine (no silent catches). The metrics module is OPTIONAL
  // infrastructure — its absence MUST NOT block reasoning — but its absence
  // is still an operator-visible event. Log explicitly with a stable tag so
  // the supervisor can surface "metrics facade not wired" without false
  // positives swallowing a legitimate import error.
  console.error("[CommercialReasoning] CV06_METRICS_NOT_WIRED", {
    error: err instanceof Error ? err.message : String(err),
  });
  cv11Counter = null;
}

const REASON_TO_KIND: Partial<Record<GateDecisionReason, string>> = {
  commercial_reasoner_phantom_evidence_ref: "phantom_evidence_ref",
  commercial_reasoner_fabricated_quote: "fabricated_quote",
  commercial_reasoner_template_phrase_leak: "template_phrase_leak",
  commercial_reasoner_anti_template_at1: "evidence_linkage_missing",
  commercial_reasoner_anti_template_at2: "evidence_diversity_insufficient",
  commercial_reasoner_signal_origin_overreach: "signal_origin_overreach",
};

export function recordCv11HallucinationExposure(
  reason: GateDecisionReason,
  engineId: string,
): void {
  const kind = REASON_TO_KIND[reason];
  if (!kind) return;
  if (cv11Counter) {
    try {
      cv11Counter({ kind, engine: engineId });
    } catch (err) {
      console.error("[CommercialReasoning] CV11_INC_FAILED", {
        kind,
        engineId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
