/**
 * Phase 7.2 — Composition-aware cluster comparison interpretation.
 *
 * Locked by Samir 2026-04-20 (rev 3):
 *   "Paid/organic does NOT decide the winner — it defines how we interpret
 *    the result."
 *
 *   - paid vs paid       -> direct comparison (lens: direct-response)
 *   - organic vs organic -> direct comparison (lens: natural-traction)
 *   - paid vs organic    -> NOT a direct winner; evaluate each side under
 *                           its own lens
 *   - either side low-confidence -> low-confidence; prefer weekly user
 *                                   clarification (composition.ts) before
 *                                   relying on the raw comparator output
 *
 * Doctrine placement: User Lane. Pure function over two `Composition` objects
 * (one for the current cluster's posts, one for the baseline cluster's posts).
 *
 * This module DOES NOT modify the existing `cluster-comparator.ts` verdict —
 * that comparator stays as the raw theme-set delta signal. This layer wraps
 * the raw verdict with an interpretation lens consumed by the explanation
 * layer (Phase 7.5) and Boss verdict assembly (Phase 7.4).
 *
 * Mixed-vs-anything stays "interpret-separately" (mixed has no dominant
 * type, so it does not qualify for direct comparison), but each side gets a
 * LIGHT LEANING LENS based on whether paid or organic share is larger.
 * Locked by Samir 2026-04-20 (rev 4): "We don't want to lose interpretability
 * in common real-world cases." Exact paid/organic ties produce a null lens.
 *
 * Low-confidence sides do NOT receive a leaning lens — when uncertainty is
 * high, leaning would be unreliable; lens stays null and the operator-
 * clarification path takes precedence.
 */
import type { Composition } from "./composition";

export type ComparisonMode = "direct" | "interpret-separately" | "low-confidence";

export type ClusterLens = "direct-response" | "natural-traction" | null;

export interface ComparisonInterpretation {
  mode: ComparisonMode;
  /** Lens to evaluate the current cluster under (null when no clear lens). */
  lensCurrent: ClusterLens;
  /** Lens to evaluate the baseline cluster under (null when no clear lens). */
  lensBaseline: ClusterLens;
  /** True iff either side is low-confidence — operator clarification preferred. */
  clarificationNeeded: boolean;
  /**
   * Stable identifier of the rule that fired:
   *   "low_confidence:current" | "low_confidence:baseline" | "low_confidence:both"
   *   "direct:paid_dominant"  | "direct:organic_dominant"
   *   "interpret_separately:paid_vs_organic"
   *   "interpret_separately:mixed_composition"
   */
  reason: string;
}

/** Strict lens — returns null for non-dominant types. Used in the
 *  low-confidence branch where leaning would be unreliable. */
function strictLensFor(c: Composition): ClusterLens {
  if (c.type === "paid-dominant") return "direct-response";
  if (c.type === "organic-dominant") return "natural-traction";
  return null;
}

/** Leaning-aware lens. Returns the strict lens for dominant types, and for
 *  "mixed" returns the lens implied by whichever of paid/organic share is
 *  larger. Exact ties (or both zero) -> null. Low-confidence -> null. */
function leaningLensFor(c: Composition): ClusterLens {
  if (c.type === "paid-dominant") return "direct-response";
  if (c.type === "organic-dominant") return "natural-traction";
  if (c.type === "mixed") {
    if (c.shares.paid > c.shares.organic) return "direct-response";
    if (c.shares.organic > c.shares.paid) return "natural-traction";
    return null;
  }
  return null; // low-confidence
}

export function interpretComparison(
  current: Composition,
  baseline: Composition,
): ComparisonInterpretation {
  const curLowConf = current.type === "low-confidence";
  const baseLowConf = baseline.type === "low-confidence";

  // Rule 1 — low-confidence wins (uncertainty short-circuits everything).
  // Strict lens only — leaning is unreliable when uncertainty is high.
  if (curLowConf || baseLowConf) {
    const which = curLowConf && baseLowConf ? "both" : curLowConf ? "current" : "baseline";
    return {
      mode: "low-confidence",
      lensCurrent: strictLensFor(current),
      lensBaseline: strictLensFor(baseline),
      clarificationNeeded: true,
      reason: "low_confidence:" + which,
    };
  }

  // Rule 2 — both same dominant type -> direct comparison.
  if (current.type === "paid-dominant" && baseline.type === "paid-dominant") {
    return {
      mode: "direct",
      lensCurrent: "direct-response",
      lensBaseline: "direct-response",
      clarificationNeeded: false,
      reason: "direct:paid_dominant",
    };
  }
  if (current.type === "organic-dominant" && baseline.type === "organic-dominant") {
    return {
      mode: "direct",
      lensCurrent: "natural-traction",
      lensBaseline: "natural-traction",
      clarificationNeeded: false,
      reason: "direct:organic_dominant",
    };
  }

  // Rule 3 — paid vs organic (either order) -> interpret separately, each
  // side under its own strict lens.
  const isPaidVsOrganic =
    (current.type === "paid-dominant" && baseline.type === "organic-dominant") ||
    (current.type === "organic-dominant" && baseline.type === "paid-dominant");
  if (isPaidVsOrganic) {
    return {
      mode: "interpret-separately",
      lensCurrent: strictLensFor(current),
      lensBaseline: strictLensFor(baseline),
      clarificationNeeded: false,
      reason: "interpret_separately:paid_vs_organic",
    };
  }

  // Rule 4 — at least one side is "mixed" (and neither is low-confidence).
  // Mixed does not qualify for direct comparison, but each side gets a LIGHT
  // LEANING LENS so the explanation layer doesn't lose interpretability.
  return {
    mode: "interpret-separately",
    lensCurrent: leaningLensFor(current),
    lensBaseline: leaningLensFor(baseline),
    clarificationNeeded: false,
    reason: "interpret_separately:mixed_composition",
  };
}
