/**
 * Seal #14 / Track #2 — Degraded-state classification.
 *
 * Closes the implicit-degradation hole that allowed the May 2026 outage.
 * Pre-seal, the only states a chain could be in were "running" or "not
 * running" — there was no canonical way to say "the chain is alive but
 * lagging behind its expected interval." Operators saw green right up
 * until the moment the cycle was four weeks dead.
 *
 * Now every chain is classified into one of four explicit states using
 * the same thresholds across the heartbeat supervisor, the chain registry,
 * and the public health surface.
 *
 *   HEALTHY   — last observed run within 1× expected interval.
 *   DEGRADED  — lag between 1× and DEAD threshold (default 4×). Chain
 *               is alive but slower than promised. Operator-actionable
 *               but not yet a P1.
 *   DEAD      — lag exceeds DEAD threshold. P1 audit fires; matches the
 *               failure mode of the original outage.
 *   UNKNOWN   — introspection_available=false (no data-source query
 *               wired). Surfaced explicitly so operators see the gap
 *               rather than mistaking it for HEALTHY. Chains in this
 *               state will be promoted in Track #3 silent-degradation
 *               sweep when individual workers get their query helpers.
 *
 * Same enum is used by the supervisor to classify the continuity
 * scheduler's own heartbeat (DEAD = "the watcher of the watchers is
 * silent" → page on call).
 */

export type ChainState = "HEALTHY" | "DEGRADED" | "DEAD" | "UNKNOWN";

export interface ClassifyInput {
  /** Current wall-clock for the classification. */
  now: Date;
  /**
   * Most-recent observed successful run. null = never observed (treated
   * as DEAD if introspection IS available, UNKNOWN otherwise).
   */
  lastObservedRunAt: Date | null;
  /** Expected interval for this chain in ms. */
  expectedIntervalMs: number;
  /**
   * Multiplier above expected interval at which the chain is considered
   * DEGRADED. Default 1 (any lag past the expected interval).
   */
  degradedThresholdMultiplier?: number;
  /**
   * Multiplier above expected interval at which the chain is considered
   * DEAD. Default 4 (chain has missed 4 expected ticks).
   */
  deadThresholdMultiplier?: number;
  /**
   * If false, the chain has no data-source query. Always classified as
   * UNKNOWN regardless of other inputs.
   */
  introspectionAvailable: boolean;
}

export interface ClassifyResult {
  state: ChainState;
  lagMs: number | null;
  reason: string;
}

export function classifyChainState(input: ClassifyInput): ClassifyResult {
  if (!input.introspectionAvailable) {
    return {
      state: "UNKNOWN",
      lagMs: null,
      reason: "introspection_not_wired",
    };
  }
  const dead = input.deadThresholdMultiplier ?? 4;
  const degraded = input.degradedThresholdMultiplier ?? 1;
  if (!input.lastObservedRunAt) {
    return {
      state: "DEAD",
      lagMs: null,
      reason: "no_observed_run_ever",
    };
  }
  const lagMs = Math.max(0, input.now.getTime() - input.lastObservedRunAt.getTime());
  if (lagMs > input.expectedIntervalMs * dead) {
    return {
      state: "DEAD",
      lagMs,
      reason: `lag_${Math.floor(lagMs / 1000)}s_exceeds_dead_${dead}x`,
    };
  }
  if (lagMs > input.expectedIntervalMs * degraded) {
    return {
      state: "DEGRADED",
      lagMs,
      reason: `lag_${Math.floor(lagMs / 1000)}s_exceeds_degraded_${degraded}x`,
    };
  }
  return {
    state: "HEALTHY",
    lagMs,
    reason: "within_expected_interval",
  };
}
