/**
 * Phase 3 (Task #66) — Shared cross-engine contradiction taxonomy.
 *
 * Before Phase 3, both system-control and integrity-engine carried their
 * own structurally-identical `Contradiction` shape, with no enforced
 * vocabulary on `description`/`resolution`. That made it possible for the
 * same underlying contradiction to be reported with two different strings
 * — once by each owner — and surface as two distinct rows in the verdict.
 *
 * The taxonomy below is the canonical vocabulary. `Contradiction.kind`
 * tags the underlying disagreement type so downstream dedupe can collapse
 * structurally-equal entries reported by two upstream detectors.
 *
 * Doctrine:
 *   - `system-control` is the verdict authority; it consumes contradictions
 *     and produces the `SystemControlVerdict.contradictions` array.
 *   - `integrity-engine` and any cross-engine validator MUST emit using
 *     this shared type.
 *   - `kind` is REQUIRED on every new emission. Existing emission sites
 *     that have not yet been migrated are tagged `"legacy_untagged"` and
 *     surface in the audit feed for follow-up.
 */

export type ContradictionKind =
  | "budget_scaling_vs_integrity_partial"
  | "budget_scaling_vs_unverified_cac"
  | "channel_recommendation_vs_low_confidence"
  | "approved_plan_vs_incomplete_context"
  | "ael_partial_vs_downstream_consumers"
  | "positioning_orphan_vs_signal_grounding"
  | "validation_state_vs_decision_action"
  | "memory_decision_vs_policy_threshold"
  // Phase 1 (AI Proposes / Code Validates) — a freshly-generated engine
  // candidate contradicts a validated prior-engine decision recorded in
  // SharedStrategicContext.priorDecisions. Emitted by the contradiction judge
  // at the engine's candidate-validation step.
  | "candidate_contradicts_prior_decision"
  | "legacy_untagged";

export interface Contradiction {
  /** Canonical contradiction taxonomy entry. */
  kind: ContradictionKind;
  engineA: string;
  engineB: string;
  description: string;
  resolution: string;
}

/**
 * Deduplicates contradictions reported by multiple detectors that name the
 * same underlying disagreement. Key = `kind|engineA|engineB` (engines
 * sorted lexicographically so order-of-naming does not produce a false
 * second row).
 *
 * First occurrence wins for `description`/`resolution` — system-control
 * detectors are run before integrity-engine detectors so the verdict-owner
 * voice is preserved.
 */
export function dedupeContradictions(items: Contradiction[]): Contradiction[] {
  const seen = new Map<string, Contradiction>();
  for (const c of items) {
    const [a, b] = [c.engineA, c.engineB].sort();
    const key = `${c.kind}|${a}|${b}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}
