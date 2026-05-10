/**
 * Unified Weighted Reliability Doctrine — U5a: planRetry scaffold.
 *
 * STATUS: Foundation only — nothing in this module is consumed by runtime
 * code yet. Lives behind the rollout gate documented in
 * `.local/plans/unified-reliability-doctrine-audit.md` (phases U1–U8).
 *
 * Purpose: a single, declared retry-policy function the orchestrator
 * gate-retry path can consult instead of carrying the policy inline. The
 * existing per-engine REJECTED-loop retries (in
 * `*-engine/{trust-transfer,category-game,value-architect,buyer-psychology,
 * narrative-reframe}.ts`) are EXPLICITLY OUT OF SCOPE per user constraint
 * (U-series, May 2026): "do NOT touch per-engine REJECTED-loop retries".
 * planRetry applies ONLY at the orchestrator gate boundary
 * (`server/orchestrator/index.ts:3493–3540`).
 *
 * MECHANICAL CONSOLIDATION ONLY (U5a phase):
 *   - The initial behavior is a bit-for-bit mirror of the inline policy
 *     that lives at `index.ts:3493–3540`:
 *       retry          ← gateResult.shouldRetry
 *       scope          ← "engine-only"   (current code re-runs the engine,
 *                                          not a single field)
 *       maxAttempts    ← 1               (current code performs exactly
 *                                          one retry before halting)
 *       onFinalFailure ← "BLOCK"   if gateSeverity === "critical"
 *                       "CONTINUE" otherwise
 *   - No new threshold, no retry inflation, no scope widening.
 *   - WeightSchema (U1) is INTENTIONALLY not consulted yet. The doctrine's
 *     "retry-respects-weight" extension lands in U5c+ once a parity proof
 *     (U5b shadow harness) confirms this scaffold is exactly the current
 *     policy across the full input domain.
 *
 * Wiring policy:
 *   - U5a (this file): declare the function, type the I/O, no callers.
 *   - U5b (next, gated on user go-ahead): build a shadow-comparison
 *     harness that runs `planRetry` alongside the inline expression at
 *     index.ts:3493–3540 across every (gateShouldRetry × gateSeverity)
 *     combination, plus the engine-id × missing-field-id matrix the
 *     orchestrator can produce, and asserts identical output. Mirrors
 *     the U3.5 harness shape — 0 drift required to proceed.
 *   - U5c (later, gated on U5b parity proof): cut over the gate-retry
 *     path at index.ts:3493–3540 to call `planRetry`. No semantic change.
 *   - U5d+ (later, opt-in, gated on its own parity proof): import
 *     WeightSchema FieldWeight metadata once it exists (per Section C2 of
 *     the doctrine audit), and let `importance === "critical"` widen
 *     `maxAttempts` or `scope` IF user authorizes the new behavior.
 *
 * Doctrine compliance:
 *   - D1 (no semantic fallback): the function returns a typed, fully-
 *     populated object on every code path. No `||` / `??` over a
 *     verdict-shaped field. Defaults are explicit `if`-discriminator
 *     branches, never operator fallbacks.
 *   - D3 (strict enums only): every union below is a string-literal
 *     union, never `string`. Consumers that destructure the result get
 *     full type-checker coverage.
 *
 * REJECTED-loop boundary:
 *   - This module MUST NOT be called from any per-engine module
 *     (audience, positioning, offer, persuasion, awareness, etc.). The
 *     REJECTED-loop is the engine designer/judge's own retry contract
 *     and is preserved as-is per user constraint. If a future caller
 *     needs to consult planRetry from a per-engine module, that
 *     introduces a new policy surface and requires its own user
 *     authorization + parity proof — it is NOT a U5 cutover.
 */

import { getFieldImportanceForRetry } from "../shared/weight-schema";

/**
 * Where the retry should run. Today only `"engine-only"` is emitted by the
 * scaffold (mirrors current behavior). The other variants are declared so
 * future consumers can switch on the union exhaustively without a type
 * widening; introducing them is a NEW POLICY DECISION, not a U5 cutover.
 */
export type RetryScope =
  /** Re-run the entire engine. Current orchestrator gate-retry behavior. */
  | "engine-only"
  /** Re-derive a single missing field without re-running the engine.
   *  RESERVED — never returned by the U5a scaffold. */
  | "field-only"
  /** Re-run the engine and every downstream engine that consumed its
   *  output. RESERVED — never returned by the U5a scaffold. */
  | "engine-plus-downstream";

/** What to do when retries are exhausted. Mirrors current orchestrator
 *  branches: HALT pipeline if critical, otherwise continue. */
export type RetryFinalFailureAction =
  /** Halt the orchestrator with a BLOCK (critical-severity gate failure). */
  | "BLOCK"
  /** Allow the pipeline to continue but mark the engine result degraded.
   *  RESERVED — never returned by the U5a scaffold. */
  | "DOWNGRADE"
  /** Allow the pipeline to continue with the original (failing) result.
   *  Mirrors the non-critical branch at index.ts:3528–3540. */
  | "CONTINUE";

/**
 * Inputs the orchestrator gate-retry path can supply. Every field is what
 * is already in scope at `index.ts:3493`:
 *   - engineId          → engineDef.id
 *   - gateShouldRetry   → gateResult.shouldRetry
 *   - gateSeverity      → gateResult.severity (string from checkMidPipelineGate)
 *   - missingFieldId    → reserved for U5d (importance lookup); ignored by U5a
 *
 * No new I/O is requested from the caller — the scaffold cannot ask for
 * data the consumer doesn't already have, by design.
 */
/**
 * Strict-enum severity union — mirrors `MidPipelineGateResult.severity` at
 * `server/orchestrator/index.ts:872`. Tightened from `string` per
 * doctrine D3 (strict enums only) so consumers cannot pass an off-spec
 * severity string into the retry-policy boundary.
 */
export type GateSeverity = "critical" | "high" | "medium";

export interface RetryPolicyInput {
  readonly engineId: string;
  readonly gateShouldRetry: boolean;
  readonly gateSeverity: GateSeverity;
  readonly missingFieldId?: string;
}

/** Strictly-typed retry decision returned by `planRetry`. */
export interface RetryPolicyDecision {
  readonly retry: boolean;
  readonly scope: RetryScope;
  readonly maxAttempts: number;
  readonly onFinalFailure: RetryFinalFailureAction;
  /** Free-form provenance string for log lines + the U5b shadow harness.
   *  Format: `"u5a-mirror | retry=… | severity=… | scope=engine-only"`. */
  readonly rationale: string;
}

/**
 * Decide whether the orchestrator should retry an engine that just failed
 * a mid-pipeline gate.
 *
 * U5a/U5b/U5c contract (mechanical-consolidation phase): the returned
 * object is bit-for-bit equivalent to what the inline policy at
 * `server/orchestrator/index.ts:3493–3540` would compute for the same
 * `(gateShouldRetry, gateSeverity)` pair. Proven by
 * `.local/validation/retry-policy-shadow.ts` (180/180, 0 drift).
 *
 * U5d extension (importance-aware widening — opt-in by field registration):
 *   - When `input.missingFieldId` is provided AND that field is registered
 *     in `FIELD_IMPORTANCE_REGISTRY` with importance === "critical", the
 *     policy MAY widen `maxAttempts` from 1 → 2. This is the ONLY behavior
 *     change U5d introduces.
 *   - When the field is not registered, or registered as anything other
 *     than "critical", behavior is bit-for-bit identical to U5c.
 *   - The U5d registry SHIPS EMPTY. Until a user-authorized PR registers
 *     a specific field, this branch is provably unreachable in production
 *     and the U5b parity harness still passes 180/180.
 *   - Test code may register fields via `__testOnly_registerFieldImportance`
 *     to exercise the activation path — see
 *     `server/tests/retry-policy-importance-activation.test.ts`.
 *
 * No semantic change vs current behavior:
 *   1. Retry decision is taken DIRECTLY from `gateShouldRetry`. The
 *      scaffold does NOT consult engine identity, missing-field id, or
 *      WeightSchema — those become inputs only after U5d.
 *   2. `scope` is always `"engine-only"`. Today the orchestrator does
 *      `executeEngine(engineDef.id, ...)` on retry, which is engine-only.
 *   3. `maxAttempts` is always `1`. Today the orchestrator performs
 *      exactly one retry attempt before halting (no retry-of-retry).
 *   4. `onFinalFailure` is `"BLOCK"` iff `gateSeverity === "critical"`,
 *      else `"CONTINUE"`. Mirrors the `if (gateResult.severity ===
 *      "critical")` branch at lines 3513 and 3532.
 */
export function planRetry(input: RetryPolicyInput): RetryPolicyDecision {
  // (1) retry decision — direct mirror of `gateResult.shouldRetry`.
  const retry = input.gateShouldRetry === true;

  // (2) scope — engine-only is the only value U5d emits today. RESERVED
  //     scopes ("field-only", "engine-plus-downstream") remain unreached
  //     until a future phase introduces them with their own parity proof.
  const scope: RetryScope = "engine-only";

  // (3) maxAttempts — U5c baseline is 1. U5d allows widening to 2 when
  //     the missing field is registered as importance==="critical" in
  //     FIELD_IMPORTANCE_REGISTRY. Registry SHIPS EMPTY in U5d, so
  //     this branch is provably unreached in production until a
  //     user-authorized PR registers a specific field. The U5b parity
  //     harness (180/180) must continue to pass.
  //     Explicit if-discriminator (D1-clean: no `??`/`||` over the
  //     value).
  let maxAttempts = 1;
  const importance = getFieldImportanceForRetry(input.missingFieldId);
  if (importance === "critical") {
    maxAttempts = 2;
  }

  // (4) onFinalFailure — explicit `if`-discriminator (D1-clean: no `||`
  //     or `??` over a verdict-shaped field). U5d does NOT change this
  //     decision: importance widens only the retry-attempt budget, not
  //     the BLOCK/CONTINUE verdict on final failure.
  let onFinalFailure: RetryFinalFailureAction;
  if (input.gateSeverity === "critical") {
    onFinalFailure = "BLOCK";
  } else {
    onFinalFailure = "CONTINUE";
  }

  // Rationale is deterministic. When importance does not widen behavior,
  // it equals legacyMirrorRetryDecision's rationale for the same input,
  // preserving U5b parity. When importance DOES widen (only via test
  // override or future authorized registration), the maxAttempts field
  // in the rationale string reflects the new value — making the
  // widening visible in logs.
  const rationale = formatRetryRationale(input, { retry, scope, maxAttempts, onFinalFailure });

  return { retry, scope, maxAttempts, onFinalFailure, rationale };
}

/**
 * Deterministic rationale formatter — single source of truth shared by
 * `planRetry` and `legacyMirrorRetryDecision` so the U5b shadow harness
 * gets bit-for-bit object-equality.
 *
 * NOTE: this helper sits BELOW the parity boundary. Both `planRetry` and
 * `legacyMirrorRetryDecision` call it; the harness still proves parity of
 * the four semantic fields (retry/scope/maxAttempts/onFinalFailure)
 * because those are computed independently in each function before this
 * formatter is invoked.
 */
function formatRetryRationale(
  input: RetryPolicyInput,
  decision: { retry: boolean; scope: RetryScope; maxAttempts: number; onFinalFailure: RetryFinalFailureAction },
): string {
  return `retry-policy | engineId=${input.engineId} | retry=${decision.retry} | severity=${input.gateSeverity} | scope=${decision.scope} | maxAttempts=${decision.maxAttempts} | onFinalFailure=${decision.onFinalFailure}`;
}

/**
 * Convenience export — the literal mirror logic, exposed as a separate
 * function so the U5b shadow harness can call BOTH `planRetry` and the
 * raw inline expression and assert object-equality across the input
 * domain. This is intentionally duplicated logic: it is the *legacy
 * baseline* the harness compares against. DO NOT refactor it to call
 * `planRetry` — that would defeat the parity proof.
 */
export function legacyMirrorRetryDecision(input: RetryPolicyInput): RetryPolicyDecision {
  // Verbatim recreation of the inline policy at
  // server/orchestrator/index.ts:3493–3540, distilled to the four
  // returned fields. If the inline code ever changes, this function
  // MUST be updated in the same PR (and the U5b harness will fail
  // until it is).
  const retry = input.gateShouldRetry; // line 3493: `if (gateResult.shouldRetry) { ... }`
  const scope: RetryScope = "engine-only"; // line 3496: `executeEngine(engineDef.id, ...)`
  const maxAttempts = 1; // single retry attempt (no retry-of-retry)
  const onFinalFailure: RetryFinalFailureAction =
    input.gateSeverity === "critical" ? "BLOCK" : "CONTINUE"; // lines 3513, 3532
  return {
    retry,
    scope,
    maxAttempts,
    onFinalFailure,
    rationale: formatRetryRationale(input, { retry, scope, maxAttempts, onFinalFailure }),
  };
}
