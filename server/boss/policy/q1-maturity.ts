/**
 * Phase 8.1 — Q1 maturity interpretation policy.
 *
 * Locked by Samir 2026-05-03:
 *
 *   "Do NOT allow premature judgment of strategies. Before Q1 produces a
 *    strong verdict, add a maturity gate."
 *
 * This module is PURE — no DB, no AI, no I/O. It takes the same context
 * the Q1 verdict policy receives, plus three new dimensions (DNA age,
 * exposure volume, strategy type), and produces:
 *
 *   1. A maturity interpretation (TOO_EARLY_TO_JUDGE | GAINING_TRACTION |
 *      EXECUTION_TOO_LOW | NEEDS_MORE_EXPOSURE | MATURE).
 *   2. A reason chip suitable for appending to `q1Reasons`.
 *
 * It NEVER changes the Q1 verdict. The verdict is computed by
 * `evaluateQ1` in `dna-working.ts`. This module is descriptive only.
 *
 * Threshold table (organic gets the longest window per Samir's note that
 * "organic strategies require longer windows"):
 *
 *   strategyType        ageThreshold   minExposure (current window)
 *   organic                14 days         8 posts
 *   paid                    5 days         5 posts
 *   hybrid                 10 days         6 posts
 *   unknown                14 days         8 posts   (= organic — most
 *                                                       protective default;
 *                                                       see Samir 2026-05-03:
 *                                                       "Do NOT mark as
 *                                                       DEGRADED in first
 *                                                       1–2 weeks without
 *                                                       sufficient data.")
 *
 * Decision order (first match wins):
 *
 *   - if no active DNA          → MATURE (verdict will be UNKNOWN; not our concern)
 *   - if dnaAgeDays < threshold AND exposurePostCount low / rhythm bad
 *                                 → EXECUTION_TOO_LOW
 *   - if dnaAgeDays < threshold AND exposurePostCount adequate
 *                                 → if positive shift signal → GAINING_TRACTION
 *                                 → else                     → TOO_EARLY_TO_JUDGE
 *   - if dnaAgeDays >= threshold AND exposurePostCount low
 *                                 → NEEDS_MORE_EXPOSURE
 *   - else                       → MATURE
 *
 * Anti-scope: this module does not push any change to verdict, DNA,
 * strategy, calendar, or anything else. It emits an interpretation string.
 */
import type { Q1Interpretation, Q1Verdict, StrategyType } from "../types";

export interface Q1MaturityInputs {
  q1Verdict: Q1Verdict;
  hasActiveDna: boolean;
  dnaAgeDays: number | null;          // null when no active DNA
  exposurePostCount: number | null;   // current-window post count, null = unknown
  strategyType: StrategyType;
  rhythmStatus?: "compliant" | "partial" | "non_compliant" | "no_active_plan" | "rhythm_invalid";
  // "Positive shift" = clusters_shifted or new_clusters with no regression.
  // Caller (boss/run.ts) computes this from cluster comparison + outcome.
  positiveTraction?: boolean;
}

export interface Q1MaturityResult {
  interpretation: Q1Interpretation;
  reason: string;        // chip suitable for q1Reasons array
  ageThresholdDays: number;
  minExposurePosts: number;
  strategyTypeUsed: StrategyType;
}

const THRESHOLDS: Record<StrategyType, { age: number; exposure: number }> = {
  organic: { age: 14, exposure: 8 },
  paid: { age: 5, exposure: 5 },
  hybrid: { age: 10, exposure: 6 },
  // unknown = organic-equivalent: the longest window. When we have no
  // confirmed strategy-type signal, the safest default is the one that
  // keeps the verdict away from DEGRADED for the longest stretch — the
  // operator can always recompute later once strategy type becomes clear.
  unknown: { age: 14, exposure: 8 },
};

export function interpretQ1Maturity(input: Q1MaturityInputs): Q1MaturityResult {
  const t = THRESHOLDS[input.strategyType];

  // No active DNA → maturity is not applicable. The verdict policy will
  // already be returning UNKNOWN with `q1_skipped:no_active_dna`.
  if (!input.hasActiveDna || input.dnaAgeDays === null) {
    return {
      interpretation: "MATURE",
      reason: "q1_interpretation:MATURE",
      ageThresholdDays: t.age,
      minExposurePosts: t.exposure,
      strategyTypeUsed: input.strategyType,
    };
  }

  const tooYoung = input.dnaAgeDays < t.age;
  const lowExposure = input.exposurePostCount !== null && input.exposurePostCount < t.exposure;
  const rhythmWeak = input.rhythmStatus === "non_compliant" || input.rhythmStatus === "rhythm_invalid";

  if (tooYoung && (lowExposure || rhythmWeak)) {
    return {
      interpretation: "EXECUTION_TOO_LOW",
      reason: `q1_interpretation:EXECUTION_TOO_LOW:dna_age_${input.dnaAgeDays}d_posts_${input.exposurePostCount ?? "?"}_min_${t.exposure}`,
      ageThresholdDays: t.age,
      minExposurePosts: t.exposure,
      strategyTypeUsed: input.strategyType,
    };
  }

  if (tooYoung) {
    if (input.positiveTraction) {
      return {
        interpretation: "GAINING_TRACTION",
        reason: `q1_interpretation:GAINING_TRACTION:dna_age_${input.dnaAgeDays}d_threshold_${t.age}d`,
        ageThresholdDays: t.age,
        minExposurePosts: t.exposure,
        strategyTypeUsed: input.strategyType,
      };
    }
    return {
      interpretation: "TOO_EARLY_TO_JUDGE",
      reason: `q1_interpretation:TOO_EARLY_TO_JUDGE:dna_age_${input.dnaAgeDays}d_under_${t.age}d_${input.strategyType}`,
      ageThresholdDays: t.age,
      minExposurePosts: t.exposure,
      strategyTypeUsed: input.strategyType,
    };
  }

  // dnaAgeDays >= threshold from here on.
  if (lowExposure) {
    return {
      interpretation: "NEEDS_MORE_EXPOSURE",
      reason: `q1_interpretation:NEEDS_MORE_EXPOSURE:posts_${input.exposurePostCount ?? "?"}_min_${t.exposure}_age_${input.dnaAgeDays}d`,
      ageThresholdDays: t.age,
      minExposurePosts: t.exposure,
      strategyTypeUsed: input.strategyType,
    };
  }

  return {
    interpretation: "MATURE",
    reason: "q1_interpretation:MATURE",
    ageThresholdDays: t.age,
    minExposurePosts: t.exposure,
    strategyTypeUsed: input.strategyType,
  };
}

/**
 * Pull the persisted interpretation chip out of a `q1Reasons` array.
 * Single source of truth for the route layer + tests; the overlay reads
 * the field exposed by the route, not by parsing reasons itself.
 */
export function extractInterpretation(reasons: string[] | null | undefined): Q1Interpretation | null {
  if (!Array.isArray(reasons)) return null;
  for (const r of reasons) {
    if (typeof r !== "string") continue;
    if (!r.startsWith("q1_interpretation:")) continue;
    const tail = r.slice("q1_interpretation:".length);
    const state = tail.split(":")[0];
    if (
      state === "TOO_EARLY_TO_JUDGE" ||
      state === "GAINING_TRACTION" ||
      state === "EXECUTION_TOO_LOW" ||
      state === "NEEDS_MORE_EXPOSURE" ||
      state === "MATURE"
    ) {
      return state as Q1Interpretation;
    }
  }
  return null;
}
