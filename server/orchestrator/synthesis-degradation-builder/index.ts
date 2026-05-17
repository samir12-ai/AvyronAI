/**
 * Task #90 / Phase 4-B — synthesis-degradation-builder.
 *
 * Pure transformation that computes the "degradation surface" attached to
 * a freshly-synthesized strategic plan when EITHER the commercial-reasoning
 * registry has rejections OR the AEL package was marked partial.
 *
 * Extracted from `runOrchestrator` lines ~4576-4634 ("PLAN_DEGRADED" path).
 * The extraction is PURE: no DB writes, no log emission past returning a
 * typed envelope. The orchestrator is responsible for the optimistic-CAS
 * re-persist step using the returned mutator — that side-effect remains
 * at the orchestrator seam to keep this module free of `db` imports.
 *
 * Doctrine:
 *   - D1: no `?? validationState` / `|| validationState` fallback. The
 *     downgrade ladder is an explicit `if`-discriminator chain.
 *   - D3: `validationState` is the strict enum from the plan contract.
 *   - D5: returns `null` to denote "no degradation observed" — the
 *     caller MUST treat null as the canonical "no-op" signal, not silently
 *     fall through to a fabricated envelope.
 */

import type {
  CommercialRejection,
} from "../../../shared/commercial-dna";

/**
 * Strict subset of the synthesized plan that the degradation builder
 * mutates. Kept local so this module does not have to import the entire
 * SynthesizedPlan type (and its transitive dependency graph).
 */
export interface DegradablePlan {
  validationState?: string;
  commercialReasoningRejected?: CommercialRejection[];
  _provenance?: {
    commercialReasoningDegraded?: boolean;
    aelPartialPropagated?: boolean;
    aelPartialReason?: string;
    [k: string]: unknown;
  };
}

export interface SynthesisDegradationInput {
  rejections: CommercialRejection[];
  aelPartial: boolean;
  aelPartialReason: string;
}

export interface SynthesisDegradationOutcome {
  /** Strict downgrade target. Never upgrades an existing "rejected" state. */
  newValidationState: "weak" | "rejected";
  /** Whether the validation state is being lowered by this builder. */
  validationStateChanged: boolean;
  /** Patch to merge into plan._provenance. */
  provenancePatch: NonNullable<DegradablePlan["_provenance"]>;
  /** Rejections to attach to `commercialReasoningRejected`, or `undefined` to leave the field absent. */
  attachRejections?: CommercialRejection[];
  /** Operator log line — caller emits with console.warn for log shape parity. */
  logLine: string;
}

/**
 * Compute the degradation envelope for a plan. Returns `null` when no
 * degradation is observed (no rejections AND AEL package is non-partial)
 * — the caller MUST short-circuit on null without further processing.
 */
export function buildSynthesisDegradation(
  plan: Pick<DegradablePlan, "validationState">,
  input: SynthesisDegradationInput,
): SynthesisDegradationOutcome | null {
  const hasRejections = input.rejections.length > 0;
  if (!hasRejections && !input.aelPartial) return null;

  // F3.3 doctrine: validationState downgrades to "weak" on any rejection
  // or AEL-partial. Never upgrades — if synthesis already set "rejected",
  // keep it. Explicit `if` chain (D1: no `?? validationState` fallback).
  let newValidationState: "weak" | "rejected";
  let validationStateChanged: boolean;
  if (plan.validationState === "rejected") {
    newValidationState = "rejected";
    validationStateChanged = false;
  } else {
    newValidationState = "weak";
    validationStateChanged = plan.validationState !== "weak";
  }

  const provenancePatch: NonNullable<DegradablePlan["_provenance"]> = {
    commercialReasoningDegraded: hasRejections,
    aelPartialPropagated: input.aelPartial,
  };
  if (input.aelPartial) {
    provenancePatch.aelPartialReason = input.aelPartialReason;
  }

  const modulesFragment = hasRejections
    ? ` | modules=[${input.rejections.map((r) => `${r.module}:${r.reason}`).join(",")}]`
    : "";
  const logLine =
    `[Orchestrator] PLAN_DEGRADED | rejections=${input.rejections.length} | ` +
    `aelPartial=${input.aelPartial} | validationState=${newValidationState}` +
    modulesFragment;

  return {
    newValidationState,
    validationStateChanged,
    provenancePatch,
    attachRejections: hasRejections ? input.rejections : undefined,
    logLine,
  };
}

/**
 * Apply a degradation outcome to a plan in place. Convenience helper for
 * the orchestrator seam (so the inline block becomes a single call).
 * The mutation is intentionally narrow — ONLY the three fields listed in
 * `SynthesisDegradationOutcome` are written.
 */
export function applySynthesisDegradation<P extends DegradablePlan>(
  plan: P,
  outcome: SynthesisDegradationOutcome,
): P {
  if (outcome.attachRejections) {
    plan.commercialReasoningRejected = outcome.attachRejections;
  }
  plan._provenance = {
    ...(plan._provenance ?? {}),
    ...outcome.provenancePatch,
  };
  plan.validationState = outcome.newValidationState;
  return plan;
}
