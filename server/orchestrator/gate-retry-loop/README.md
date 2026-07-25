# gate-retry-loop — Task #90 / Phase 4-B

Mid-pipeline gate-retry execution wrapper. Consults the canonical retry
policy (`planRetry` in `server/decision-policy/retry-policy.ts`, U5c
cutover) and, when the policy says retry, runs the engine again behind
the same per-engine timeout race the orchestrator uses inline.

## Extracted from
`server/orchestrator/index.ts` lines ~3980-4090 (the `planRetry` →
`Promise.race(executeEngine, timeout)` → `checkMidPipelineGate` → BLOCK
ladder).

## Public exports
- `runGateRetryLoop(input): Promise<GateRetryOutcome>`
- `GateRetryOutcome` — discriminator-typed union of five kinds:
  `no_retry_continue | no_retry_block | retry_passed | retry_failed_continue | retry_failed_block`.

## Side-effect ownership
- **NO** mutation of `results`, `ssc.problemRegistry`, or `overallStatus`.
  The orchestrator applies all three based on the returned outcome.
- **NO** console emission. The orchestrator's `MID_PIPELINE_*` log
  lines remain at the seam to preserve grep-pattern stability.

## Doctrine
- **D1**: no `?? severity` / `|| severity` fallback. Severity is
  forwarded to `planRetry` as a strict enum.
- **D3**: `MidPipelineGate.severity` is `"critical" | "warning" | "info"`;
  `GateRetryOutcome.kind` is a strict 5-value union.
- **D5**: caller MUST handle every `kind` — TypeScript exhaustiveness
  blocks the missing-case anti-pattern.

## Dispatch wiring
Reserved env flag: `ORCH_USE_GATE_RETRY_LOOP`. Default `current` keeps
the inline path. Parity: `.local/docs/p4b-extractions/gate-retry-loop-parity.md`.
