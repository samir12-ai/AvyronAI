/**
 * Phase 7.2 — Paid/Organic composition primitives.
 *
 * Locked by Samir 2026-04-20 (rev 3):
 *   - Rule-based, deterministic. No AI, no scoring.
 *   - Composition is descriptive metadata. It does NOT decide a Q1/Q2 winner.
 *     It DEFINES HOW results are interpreted (direct-response vs natural
 *     traction) by downstream consumers.
 *   - Weekly clarification trigger: when uncertain share is high at the
 *     weekly level, the system asks the operator only TWO questions for the
 *     week — "how many posts paid?" / "how many posts organic?". No per-post
 *     questions, no IDs, no detailed tagging. The override is then applied
 *     via `applyWeeklyOverride`, replacing the classifier's counts entirely
 *     for that week.
 *
 * Doctrine placement: User Lane. Pure functions, no DB I/O, no persistence,
 * no verdict wiring.
 *
 * Thresholds (single source of truth, explicit constants):
 *   LOW_CONFIDENCE_UNCERTAIN_THRESHOLD = 0.30
 *     Composition is "low-confidence" iff uncertain share >= 30%.
 *     Same threshold drives the weekly clarification trigger.
 *
 *   DOMINANT_THRESHOLD = 0.60
 *     A composition is "paid-dominant" iff paid share >= 60% of total.
 *     A composition is "organic-dominant" iff organic share >= 60% of total.
 *     "Total" includes uncertain in the denominator (no exclusion games).
 *
 *   Anything else (and not low-confidence) is "mixed".
 */
import type { PostClassification } from "./post-classification";

export const LOW_CONFIDENCE_UNCERTAIN_THRESHOLD = 0.30;
export const DOMINANT_THRESHOLD = 0.60;

export type CompositionType =
  | "paid-dominant"
  | "organic-dominant"
  | "mixed"
  | "low-confidence";

/**
 * Provenance of a Composition. Locked by Samir 2026-04-20:
 *   - "classifier"     — derived deterministically from per-post classifier labels.
 *   - "user_override"  — operator-provided weekly correction. Explicitly NOT
 *                        system-derived truth. Downstream consumers (the
 *                        explanation layer, Boss verdict assembly, audits)
 *                        must surface this distinction so a corrected week
 *                        is never confused with a classifier-derived week.
 */
export type CompositionSource = "classifier" | "user_override";

export interface CompositionCounts {
  paid: number;
  organic: number;
  uncertain: number;
  total: number;
}

export interface CompositionShares {
  paid: number;     // 0..1, NaN-safe (total=0 -> 0)
  organic: number;
  uncertain: number;
}

export interface Composition {
  counts: CompositionCounts;
  shares: CompositionShares;
  type: CompositionType;
  /** True iff `type === "low-confidence"`. Single source of truth for the
   *  weekly clarification UX trigger. */
  clarificationNeeded: boolean;
  /** Provenance — see CompositionSource. */
  source: CompositionSource;
}

function safeShare(num: number, denom: number): number {
  return denom > 0 ? num / denom : 0;
}

function classifyComposition(shares: CompositionShares): CompositionType {
  if (shares.uncertain >= LOW_CONFIDENCE_UNCERTAIN_THRESHOLD) return "low-confidence";
  if (shares.paid >= DOMINANT_THRESHOLD) return "paid-dominant";
  if (shares.organic >= DOMINANT_THRESHOLD) return "organic-dominant";
  return "mixed";
}

/**
 * Build a composition from raw counts. Defaults to source="classifier".
 * The override path passes source="user_override" explicitly.
 */
export function composeFromCounts(
  input: { paid: number; organic: number; uncertain: number },
  source: CompositionSource = "classifier",
): Composition {
  const counts: CompositionCounts = {
    paid: input.paid,
    organic: input.organic,
    uncertain: input.uncertain,
    total: input.paid + input.organic + input.uncertain,
  };
  const shares: CompositionShares = {
    paid: safeShare(counts.paid, counts.total),
    organic: safeShare(counts.organic, counts.total),
    uncertain: safeShare(counts.uncertain, counts.total),
  };
  const type = classifyComposition(shares);
  return {
    counts,
    shares,
    type,
    clarificationNeeded: type === "low-confidence",
    source,
  };
}

/**
 * Build a composition from a list of per-post classification labels. The
 * common path: classifier emits labels, this aggregates them. Always
 * source="classifier".
 */
export function composeFromLabels(labels: ReadonlyArray<PostClassification>): Composition {
  let paid = 0, organic = 0, uncertain = 0;
  for (const l of labels) {
    if (l === "paid") paid++;
    else if (l === "organic") organic++;
    else uncertain++;
  }
  return composeFromCounts({ paid, organic, uncertain }, "classifier");
}

/**
 * Apply the weekly operator override.
 *
 * Locked rule (Samir): the operator answers only "how many paid?" / "how many
 * organic?" for the week. The override REPLACES the classifier's counts
 * entirely for the affected week — uncertain collapses to 0 by construction.
 *
 * The override does not back-propagate to per-post labels (the operator did
 * not tag individual posts). It only corrects the aggregate composition view.
 *
 * The returned Composition is explicitly tagged source="user_override" so it
 * can never be confused with classifier-derived truth in audits, the
 * explanation layer, or Boss verdict assembly.
 */
export function applyWeeklyOverride(override: {
  paid: number;
  organic: number;
}): Composition {
  if (!Number.isInteger(override.paid) || override.paid < 0) {
    throw new Error("applyWeeklyOverride: paid must be a non-negative integer");
  }
  if (!Number.isInteger(override.organic) || override.organic < 0) {
    throw new Error("applyWeeklyOverride: organic must be a non-negative integer");
  }
  return composeFromCounts(
    { paid: override.paid, organic: override.organic, uncertain: 0 },
    "user_override",
  );
}
