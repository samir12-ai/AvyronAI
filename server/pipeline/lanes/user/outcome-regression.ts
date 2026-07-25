/**
 * Phase 6 — Outcome regression check.
 *
 * Locked by Samir 2026-04-20 (rev 2 §6.25, Q-F):
 *   R1: booked_calls dropped >= 50% AND baseline.booked_calls >= 2
 *   R2: qualified_leads dropped >= 50% AND baseline.qualified_leads >= 4
 *   R3: paid_active dropped >= 1 AND baseline.paid_active >= 2
 *
 * "paid_active" in pipeline_user_truth is a boolean, so the R3 floor "≥ 2" is
 * a no-op against a single boolean — we treat the boolean as an integer
 * (true=1, false=0) and the rule simplifies to: regressed iff baseline=true
 * AND current=false. Floor cannot be met, so R3 NEVER fires today. We keep
 * the rule shape for forward-compat if Phase 7 ever promotes paid_active to
 * an integer; that is a deliberate no-op rather than dead code.
 *
 * Anti-scope: no scoring, no weighted combination, no "trend" detection.
 * Pure threshold check, descriptive boolean output.
 */
import type { PipelineUserTruth } from "@shared/schema";

export type OutcomeRegressionResult =
  | { skipped: true; reason: string }
  | { regressed: boolean; reason?: string };

const R1_DROP_RATIO = 0.5;
const R1_FLOOR = 2;

const R2_DROP_RATIO = 0.5;
const R2_FLOOR = 4;

// R3 retained for shape; never fires while paid_active is a boolean (see header).

export function checkOutcomeRegression(opts: {
  currentTruth: PipelineUserTruth | null;
  baselineTruth: PipelineUserTruth | null;
}): OutcomeRegressionResult {
  if (!opts.currentTruth) {
    // Q1 G5 should have already short-circuited this case; defensive.
    return { skipped: true, reason: "no_current_truth" };
  }
  if (!opts.baselineTruth) {
    return { skipped: true, reason: "no_baseline_truth" };
  }

  const cur = opts.currentTruth;
  const base = opts.baselineTruth;

  // R1 — booked_calls
  if (base.bookedCalls >= R1_FLOOR) {
    const dropRatio = (base.bookedCalls - cur.bookedCalls) / base.bookedCalls;
    if (dropRatio >= R1_DROP_RATIO) {
      return { regressed: true, reason: "booked_calls_dropped" };
    }
  }

  // R2 — qualified_leads
  if (base.qualifiedLeads >= R2_FLOOR) {
    const dropRatio = (base.qualifiedLeads - cur.qualifiedLeads) / base.qualifiedLeads;
    if (dropRatio >= R2_DROP_RATIO) {
      return { regressed: true, reason: "qualified_leads_dropped" };
    }
  }

  // R3 — paid_active boolean drop (true→false). Floor "≥2" cannot be met
  // against a boolean, so this rule is structurally inert today; see header.
  // Intentionally NO branch fires; left as documentation only.

  return { regressed: false };
}
