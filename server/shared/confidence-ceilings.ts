/**
 * Confidence ceilings — Phase 3 (May 2026)
 *
 * Single source of truth for the structural caps that prevent thin or
 * benchmark-grounded evidence from emitting "moderate-to-high" confidence
 * scores that would let downstream gates wave them through. Used by:
 *   - statistical-validity layer (benchmark ceilings)
 *   - cross-signal-decision (sparse-data caps via realRatio penalty)
 *   - confidence-provenance (audit + INCOMPLETE detection)
 *
 * Doctrine: a ceiling is NOT a default. It is a clamp applied AFTER the
 * engine has computed its raw confidence, to prevent the score from
 * exceeding what its evidence base can justify. Defaults remain forbidden
 * per the H1-H7 D1 rule (no semantic fallback).
 */

/**
 * Maximum confidence permitted when the underlying decision is grounded
 * exclusively in benchmark data (`dataOrigin === "benchmark_contextual"`
 * or `"benchmark_static"`). Benchmark data is industry-wide reference,
 * not campaign-verified truth — it can inform direction but cannot
 * justify high-confidence scaling decisions.
 */
export const BENCHMARK_CONFIDENCE_CEILING = 0.5;

/**
 * Minimum supporting-evidence count required for a confidence score to
 * exceed the medium band (≥0.7). Below this threshold, confidence is
 * clamped to MEDIUM_CONFIDENCE_THRESHOLD regardless of how clean the
 * underlying signal looks. Mirrors the StatVal engine's MIN sample
 * thresholds for variance estimation.
 */
export const MIN_EVIDENCE_FOR_HIGH_CONFIDENCE = 30;

/**
 * Floor applied to confidence when the source group is dominantly
 * inferred (realRatio < 0.5). Stops a "3 inferred sources agreeing"
 * arrangement from clearing the high-confidence threshold via the
 * agreement-boost multiplier. The cross-signal-decision synthesis
 * loop uses `realGroundingFloor = 0.65 + 0.35 * realRatio`; this
 * constant documents the floor coefficient.
 */
export const INFERRED_DOMINANT_GROUNDING_FLOOR_BASE = 0.65;

/**
 * Apply the benchmark ceiling clamp. Returns the lesser of the input
 * confidence and BENCHMARK_CONFIDENCE_CEILING when the data origin is
 * benchmark-flavoured. Pure passthrough otherwise.
 */
export function applyBenchmarkCeiling(
  confidence: number,
  dataOrigin: string | null | undefined,
): number {
  if (dataOrigin === "benchmark_contextual" || dataOrigin === "benchmark_static") {
    return Math.min(confidence, BENCHMARK_CONFIDENCE_CEILING);
  }
  return confidence;
}

/**
 * Apply the sparse-evidence cap. When evidenceCount falls below
 * MIN_EVIDENCE_FOR_HIGH_CONFIDENCE, the confidence is clamped at the
 * medium-band ceiling (0.7) regardless of source quality, agreement, or
 * weighting. Returns the unmodified confidence when evidence is
 * sufficient or unknown (null evidenceCount → no clamp; the absence
 * itself is detected separately by the provenance layer).
 */
export function applySparseEvidenceCap(
  confidence: number,
  evidenceCount: number | null | undefined,
): number {
  if (evidenceCount == null) return confidence;
  if (evidenceCount < MIN_EVIDENCE_FOR_HIGH_CONFIDENCE) {
    return Math.min(confidence, 0.7);
  }
  return confidence;
}
