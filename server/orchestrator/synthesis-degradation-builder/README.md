# synthesis-degradation-builder — Task #90 / Phase 4-B

Pure builder for the "PLAN_DEGRADED" surface attached to a freshly
synthesized strategic plan when:

- The commercial-DNA rejection registry holds entries for this run, OR
- AEL emitted a `isPartial=true` package consumed by downstream engines.

## Extracted from
`server/orchestrator/index.ts` lines ~4576-4634 (the "PLAN_DEGRADED"
block — three field writes + a `console.warn` + the F3.3
`validationState` downgrade ladder).

## Public exports
- `buildSynthesisDegradation(plan, input) → SynthesisDegradationOutcome | null`
- `applySynthesisDegradation(plan, outcome) → plan` (narrow in-place mutate)

## Doctrine
- **D1**: validationState downgrade is an explicit `if`/`else` chain.
- **D3**: `newValidationState` is `"weak" | "rejected"` (strict union).
- **D5**: returns `null` on "no degradation observed" — caller must
  short-circuit on null.

## Side-effect ownership
- **NO** DB writes. The optimistic-CAS re-persist (orchestrator
  `strategicPlans` update) remains at the orchestrator seam because
  the version-bump + CONCURRENT_MODIFICATION reporting requires both
  the plan id and the db handle, and pulling those in would expand
  this module's blast radius far beyond its responsibility.
- **NO** console emission. The orchestrator emits `logLine` so log
  shape is byte-identical to the inlined block.

## Dispatch wiring
Reserved entry: `ORCH_USE_SYNTHESIS_DEGRADATION_BUILDER`. The
orchestrator wraps the inline block via `dispatchExtraction()` so the
default (`current`) preserves byte-exact behavior; promotion to
`candidate` is gated on the 48h shadow burn-in (see
`.local/docs/p4b-extractions/synthesis-degradation-builder-parity.md`).
