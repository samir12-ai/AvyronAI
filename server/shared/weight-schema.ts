/**
 * Unified Weighted Reliability Doctrine — U1: WeightSchema scaffold.
 *
 * STATUS: Foundation only — nothing in this module is consumed by runtime
 * code yet. Lives behind the rollout gate documented in
 * `.local/plans/unified-reliability-doctrine-audit.md` (phases U1–U8).
 *
 * Purpose: a single, declared registry of every numeric weight, threshold,
 * floor, cap, and confidence multiplier that any decision-class module reads.
 * Centralizing them here lets later phases (U6 distortion guards, U7 retune
 * proposals) reason about the entire weight surface without grepping the
 * codebase.
 *
 * MECHANICAL CONSOLIDATION ONLY (per user constraint U-series, May 2026):
 *   - Values are mirrored exactly from their current source-of-truth modules.
 *   - No retune. No new threshold. No behavior change.
 *   - Each entry carries a `source` field naming the module the value came
 *     from so a future reviewer can verify drift.
 *
 * Wiring policy:
 *   - U1 (this file): declare the registry, expose a typed lookup, no callers.
 *   - U4+ (later phase, gated on U3.5 parity proof): cut over consumers one
 *     module at a time. Each cutover MUST be a same-value substitution and
 *     MUST be covered by an old-vs-new parity assertion.
 *
 * The values below are treated as authoritative *names*, not authoritative
 * *values*: if the source module changes the constant, this file's mirror
 * must be updated in the same PR. The U7 retune phase will add a verifier
 * that diffs every entry against its declared source at lint time.
 */

/** Bounded confidence/probability in [0, 1]. */
export type ConfidenceWeight = number;

/** Multiplier applied to a confidence value (e.g. evidence-strength scaling). */
export type ConfidenceMultiplier = number;

/** A penalty subtracted from a score. Always >= 0. */
export type ScorePenalty = number;

/** A registry entry. Every weight has one. */
export interface WeightEntry<T extends number = number> {
  /** Canonical id used by every consumer (e.g. `"decision_policy.memory_write_min"`). */
  readonly id: string;
  /** Mirrored value. MUST equal the source module's current constant. */
  readonly value: T;
  /** Module path the value is mirrored from — single source of truth. */
  readonly source: string;
  /** Symbol/constant name in `source`, for traceability. */
  readonly sourceSymbol: string;
  /** One-line description of what this weight controls. */
  readonly purpose: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Decision Policy thresholds
//    Source: server/decision-policy/index.ts (DECISION_POLICY constants)
// ────────────────────────────────────────────────────────────────────────────

export const DECISION_POLICY_WEIGHTS = {
  memory_write_min: {
    id: "decision_policy.memory_write_min",
    value: 0.65 as ConfidenceWeight,
    source: "server/decision-policy/index.ts",
    sourceSymbol: "MEMORY_WRITE_MIN",
    purpose: "Minimum confidence to allow strategy_memory write through policyEnforcedMemoryCheck.",
  },
  plan_inclusion_min: {
    id: "decision_policy.plan_inclusion_min",
    value: 0.5 as ConfidenceWeight,
    source: "server/decision-policy/index.ts",
    sourceSymbol: "PLAN_INCLUSION_MIN",
    purpose: "Minimum confidence to include a decision in a synthesized plan.",
  },
  agent_action_min: {
    id: "decision_policy.agent_action_min",
    value: 0.5 as ConfidenceWeight,
    source: "server/decision-policy/index.ts",
    sourceSymbol: "AGENT_ACTION_MIN",
    purpose: "Minimum confidence for the autonomous worker to take an action.",
  },
  fallback_source_penalty: {
    id: "decision_policy.fallback_source_penalty",
    value: 0.15 as ScorePenalty,
    source: "server/decision-policy/index.ts",
    sourceSymbol: "FALLBACK_SOURCE_PENALTY",
    purpose: "Confidence penalty subtracted when a decision is grounded in a fallback (vs real) signal.",
  },
  fallback_source_min_floor: {
    id: "decision_policy.fallback_source_min_floor",
    value: 0.2 as ConfidenceWeight,
    source: "server/decision-policy/index.ts",
    sourceSymbol: "FALLBACK_SOURCE_MIN_FLOOR",
    purpose: "Floor below which a fallback-grounded decision is rejected outright.",
  },
} as const satisfies Record<string, WeightEntry>;

// ────────────────────────────────────────────────────────────────────────────
// 2. Signal Quality Gate (MI V3 tiered system)
//    Source: server/shared/signal-quality-gate.ts
// ────────────────────────────────────────────────────────────────────────────

export const SIGNAL_QUALITY_WEIGHTS = {
  high_quality_threshold: {
    id: "signal_quality_gate.high_quality_threshold",
    value: 0.75 as ConfidenceWeight,
    source: "server/shared/signal-quality-gate.ts",
    sourceSymbol: "QUALITY_THRESHOLD_HIGH",
    purpose: "High-tier signal quality threshold; signals at-or-above this are first-class evidence.",
  },
  medium_quality_threshold: {
    id: "signal_quality_gate.medium_quality_threshold",
    value: 0.5 as ConfidenceWeight,
    source: "server/shared/signal-quality-gate.ts",
    sourceSymbol: "QUALITY_THRESHOLD_MEDIUM",
    purpose: "Medium-tier signal quality threshold; usable but tracked separately as mediumQualitySignals.",
  },
  snippet_similarity_threshold: {
    id: "signal_quality_gate.snippet_similarity_threshold",
    value: 0.65 as ConfidenceWeight,
    source: "server/shared/signal-quality-gate.ts",
    sourceSymbol: "SNIPPET_SIMILARITY_THRESHOLD",
    purpose: "Cosine/lexical similarity threshold above which two signals are deduplicated.",
  },
} as const satisfies Record<string, WeightEntry>;

// ────────────────────────────────────────────────────────────────────────────
// 3. Positioning Engine — orphan-claim penalty (May 2026 hardening)
//    Source: server/positioning-engine/engine.ts
// ────────────────────────────────────────────────────────────────────────────

export const POSITIONING_WEIGHTS = {
  orphan_penalty_per_claim: {
    id: "positioning.orphan_penalty_per_claim",
    value: 0.05 as ScorePenalty,
    source: "server/positioning-engine/engine.ts",
    sourceSymbol: "orphanPenaltyPerClaim (~line 2572)",
    purpose: "Confidence penalty subtracted per orphaned (signal-ungrounded) claim within a territory.",
  },
  orphan_penalty_max_per_territory: {
    id: "positioning.orphan_penalty_max_per_territory",
    value: 0.10 as ScorePenalty,
    source: "server/positioning-engine/engine.ts",
    sourceSymbol: "maxOrphanPenalty (~line 2573)",
    purpose: "Cap on the orphan-claim penalty for a single territory (prevents collapse on heavy orphan counts).",
  },
  orphan_confidence_floor: {
    id: "positioning.orphan_confidence_floor",
    value: 0.15 as ConfidenceWeight,
    source: "server/positioning-engine/engine.ts",
    sourceSymbol: "orphan-floor branch (engine confidence fallback)",
    purpose: "Floor below which orphan-bearing territory confidence cannot drop solely from orphan penalty.",
  },
} as const satisfies Record<string, WeightEntry>;

// ────────────────────────────────────────────────────────────────────────────
// 4. Combined registry — single addressable surface
// ────────────────────────────────────────────────────────────────────────────

export const WEIGHT_REGISTRY = {
  ...DECISION_POLICY_WEIGHTS,
  ...SIGNAL_QUALITY_WEIGHTS,
  ...POSITIONING_WEIGHTS,
} as const;

export type WeightId = keyof typeof WEIGHT_REGISTRY;

/**
 * Typed lookup. No fallback — passing an unknown id is a compile error.
 *
 * SCAFFOLD ONLY (U1): no consumer is wired yet. The first cutover happens
 * in U4 after U3.5 has produced parity proof.
 */
export function getWeight<K extends WeightId>(id: K): typeof WEIGHT_REGISTRY[K]["value"] {
  return WEIGHT_REGISTRY[id].value;
}

/** Return the full entry (value + source metadata) for audit/lint surfaces. */
export function getWeightEntry<K extends WeightId>(id: K): typeof WEIGHT_REGISTRY[K] {
  return WEIGHT_REGISTRY[id];
}

/** Snapshot every declared weight, for the U7 source-drift verifier. */
export function listAllWeights(): readonly WeightEntry[] {
  return Object.values(WEIGHT_REGISTRY);
}
