/**
 * Phase 7.2 — Lead Quality derivation.
 *
 * Locked by Samir 2026-04-20:
 *   - Primary signal:    booked_calls (taken verbatim from pipeline_user_truth).
 *   - Supporting signal: qualified -> booked conversion ratio.
 *   - Do NOT introduce new metrics.
 *   - Do NOT reinterpret the existing definitions.
 *
 * Doctrine placement: User Lane. Pure derivation over an already-validated
 * pipeline_user_truth row. No DB reads, no DB writes, no scoring, no
 * recommendations. The output is a descriptive view consumed by the
 * explanation layer (Phase 7.5).
 *
 * Anti-scope:
 *   - This is NOT a verdict input. Q1, Q2, DNA-working, and outcome-regression
 *     remain untouched and continue to use their own threshold rules.
 *   - The conversion ratio is null when qualified_leads = 0 (undefined ratio,
 *     not zero). Callers must distinguish "no qualified leads to convert" from
 *     "zero conversion".
 */
import type { PipelineUserTruth } from "@shared/schema";

export interface LeadQualityView {
  /** Primary signal — verbatim from truth row. */
  bookedCalls: number;
  /** Verbatim from truth row. Provided so the ratio's denominator is visible. */
  qualifiedLeads: number;
  /**
   * Supporting signal: bookedCalls / qualifiedLeads.
   * `null` when qualifiedLeads === 0 (ratio undefined; do not coerce to 0).
   */
  qualifiedToBookedRatio: number | null;
}

export function deriveLeadQuality(truth: PipelineUserTruth): LeadQualityView {
  const bookedCalls = truth.bookedCalls;
  const qualifiedLeads = truth.qualifiedLeads;
  const qualifiedToBookedRatio =
    qualifiedLeads > 0 ? bookedCalls / qualifiedLeads : null;
  return { bookedCalls, qualifiedLeads, qualifiedToBookedRatio };
}
