/**
 * Phase 6 — Q1 ("Is current DNA working?") policy.
 *
 * Locked by Samir 2026-04-20 (rev 2):
 *
 *   Q1 is a JOINED interpretation of three layers:
 *     A. Phase 5 execution context  (rhythm + evaluation_status)
 *     B. Phase 5 business truth     (manual user truth)
 *     C. Phase 6 cluster comparison
 *
 *   No single layer can promote WORKING.
 *
 * Structural enforcement:
 *
 *   GUARDS  → DEGRADED MATCHERS → WORKING GATE
 *
 *   - Any guard short-circuits to UNKNOWN with a `q1_skipped:*` /
 *     `q1_no_baseline:*` / `q1_insufficient:*` reason.
 *   - DEGRADED matchers fire only after all guards pass.
 *   - WORKING is reachable ONLY through the gate at the bottom — every
 *     gate condition must hold simultaneously.
 *
 * Critical guarantees encoded here (per Samir's lock):
 *   - truth=missing       → UNKNOWN, NEVER DEGRADED.
 *   - rhythm=non_compliant → UNKNOWN, NEVER DEGRADED.
 *   - clusters_shifted is NEUTRAL on its own — only a path to WORKING via
 *     the gate; never a path to DEGRADED.
 *   - new_clusters does NOT block WORKING (allowed by the gate).
 *   - late truth counts as truth-present for the gate.
 *   - partial rhythm is allowed by the gate.
 *
 * Anti-scope: this module emits a verdict + reasons. No scoring, no
 * recommendations, no nextAction. Recommendations are Q2's domain.
 */
import type { BossQuestionVerdict, Q1Verdict, StrategyType } from "../types";
import type { ClusterComparisonVerdict } from "../../pipeline/cluster-comparator";

export interface Q1Inputs {
  evaluationStatus?: "complete" | "degraded" | "blocked" | "no_active_plan";
  truthStatus?: "submitted" | "missing" | "late";
  // Phase 8.0 fix (Main migration) — widened to 5 members so BossExecution
  // .rhythm_status (boss/types.ts L81) flows in cleanly. Q1 policy already
  // returns "UNKNOWN" on non_compliant; "rhythm_invalid" routes the same way.
  rhythmStatus?: "compliant" | "partial" | "non_compliant" | "no_active_plan" | "rhythm_invalid";
  // Phase 6 inputs (all optional → policy treats absence as the corresponding guard).
  hasActiveDna?: boolean;
  clusterProductionSkippedReason?: string | null;     // e.g. "window_not_terminal"
  clusterComparison?: ClusterComparisonVerdict | null;  // null when no comparison was produced
  outcomeRegression?: { regressed: boolean; reason?: string } | null;
  // Phase 8.1 — maturity guard (Samir 2026-05-03):
  //   "Do NOT mark strategy as DEGRADED in first 1–2 weeks without sufficient data."
  // dnaAgeDays + strategyType drive guard G8. When dnaAgeDays is below the
  // strategy-type-specific threshold, Q1 returns UNKNOWN BEFORE DEGRADED
  // matchers fire — preventing premature DEGRADED on a fresh DNA. Both
  // fields are optional; absence behaves as "old enough" (back-compat).
  dnaAgeDays?: number | null;
  strategyType?: StrategyType;
}

const MATURITY_AGE_THRESHOLDS: Record<StrategyType, number> = {
  organic: 14,
  paid: 5,
  hybrid: 10,
  // Mirrors q1-maturity.ts: unknown defaults to organic-equivalent (14d) so
  // a strategy-type-less DNA gets the longest "no-DEGRADED" protection.
  unknown: 14,
};

export function evaluateQ1(opts?: Q1Inputs): BossQuestionVerdict<Q1Verdict> {
  const o = opts ?? {};
  const reasons: string[] = [];

  // ── GUARDS (UNKNOWN) ───────────────────────────────────────────────
  // G1 — evaluation blocked / no active plan
  if (o.evaluationStatus === "blocked") {
    reasons.push("q1_skipped:evaluation_blocked");
    return { verdict: "UNKNOWN", reasons };
  }
  if (o.evaluationStatus === "no_active_plan") {
    reasons.push("q1_skipped:no_active_plan");
    return { verdict: "UNKNOWN", reasons };
  }

  // G2 — no active DNA
  if (!o.hasActiveDna) {
    reasons.push("q1_skipped:no_active_dna");
    return { verdict: "UNKNOWN", reasons };
  }

  // G3 — cluster production was skipped (e.g. window not terminal yet)
  if (o.clusterProductionSkippedReason) {
    reasons.push(`q1_skipped:cluster_production_skipped:${o.clusterProductionSkippedReason}`);
    return { verdict: "UNKNOWN", reasons };
  }

  // G4 — comparison missing (defensive — should be present after G3)
  if (!o.clusterComparison) {
    reasons.push("q1_skipped:cluster_comparison_missing");
    return { verdict: "UNKNOWN", reasons };
  }

  // G5 — truth missing → UNKNOWN (NOT DEGRADED, per Samir lock).
  if (o.truthStatus === "missing") {
    reasons.push("q1_insufficient:truth_missing");
    return { verdict: "UNKNOWN", reasons };
  }

  // G6 — first window under this DNA: no baseline, cannot judge structure.
  if (o.clusterComparison === "no_baseline") {
    reasons.push("q1_no_baseline:first_window_under_dna");
    return { verdict: "UNKNOWN", reasons };
  }

  // G7 — rhythm non-compliant → UNKNOWN (NOT DEGRADED, per Samir lock).
  if (o.rhythmStatus === "non_compliant" || o.rhythmStatus === "rhythm_invalid") {
    // Phase 8.0 fix — "rhythm_invalid" treated identically to "non_compliant":
    // both block Q1 promotion. Distinct reason code preserved for telemetry.
    reasons.push(
      o.rhythmStatus === "rhythm_invalid"
        ? "q1_insufficient:rhythm_invalid"
        : "q1_insufficient:rhythm_non_compliant",
    );
    return { verdict: "UNKNOWN", reasons };
  }

  // G8 — maturity guard (Phase 8.1, Samir 2026-05-03).
  // If the active DNA is younger than its strategy-type threshold, we
  // refuse to fire DEGRADED. This guard sits AFTER the structural guards
  // (G2 confirms hasActiveDna, G3/G4 confirm cluster_comparison exists)
  // and BEFORE the DEGRADED matchers, so a young DNA with disappeared/
  // unstable clusters still routes to UNKNOWN with an explicit too-early
  // reason instead of DEGRADED. The verdict policy stays purely rule-
  // based; the operator sees the maturity interpretation badge separately.
  if (typeof o.dnaAgeDays === "number" && o.dnaAgeDays >= 0) {
    const stype: StrategyType = o.strategyType ?? "unknown";
    const threshold = MATURITY_AGE_THRESHOLDS[stype];
    if (o.dnaAgeDays < threshold) {
      reasons.push(`q1_too_early:dna_too_young:${o.dnaAgeDays}d_under_${threshold}d_${stype}`);
      return { verdict: "UNKNOWN", reasons };
    }
  }

  // ── DEGRADED MATCHERS ──────────────────────────────────────────────
  // D1 — themes disappeared
  if (o.clusterComparison === "clusters_disappeared") {
    reasons.push("dna_drift:themes_disappeared");
    return { verdict: "DEGRADED", reasons };
  }

  // D2 — added AND removed in the same window
  if (o.clusterComparison === "clusters_unstable") {
    reasons.push("dna_drift:themes_added_and_removed");
    return { verdict: "DEGRADED", reasons };
  }

  // D3 — outcome regression (third DEGRADED trigger, §6.25)
  if (o.outcomeRegression?.regressed) {
    reasons.push(`dna_drift:outcome_regressed:${o.outcomeRegression.reason ?? "unspecified"}`);
    return { verdict: "DEGRADED", reasons };
  }

  // ── WORKING GATE (all must hold) ───────────────────────────────────
  // Encoded as an explicit conjunction so the rule is auditable from this file.
  const gate =
    (o.evaluationStatus === "complete" || o.evaluationStatus === "degraded") &&
    !!o.hasActiveDna &&
    (o.truthStatus === "submitted" || o.truthStatus === "late") &&
    (o.rhythmStatus === "compliant" || o.rhythmStatus === "partial") &&
    (o.clusterComparison === "clusters_unchanged"
      || o.clusterComparison === "clusters_shifted"
      || o.clusterComparison === "new_clusters") &&
    !o.outcomeRegression?.regressed;

  if (gate) {
    reasons.push("dna_holding:execution+outcome+structure_aligned");
    if (o.clusterComparison === "clusters_unchanged") reasons.push("dna_holding:signature_unchanged");
    else if (o.clusterComparison === "clusters_shifted") reasons.push("dna_holding:proportions_shifted");
    else if (o.clusterComparison === "new_clusters") reasons.push("dna_holding:new_themes_emerged");
    return { verdict: "WORKING", reasons };
  }

  // Defensive — gate fell through (should be unreachable given guards above).
  reasons.push("q1_skipped:gate_unmet");
  return { verdict: "UNKNOWN", reasons };
}
