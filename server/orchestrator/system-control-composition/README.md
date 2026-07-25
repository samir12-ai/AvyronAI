# system-control-composition — Task #90 / Phase 4-B

Composes the post-engine control-verdict pipeline as a single
`composeSystemControl(input)` call:

1. `evaluateSystemControl(...)` — deterministic verdict
2. `designSystemJudgement(...)` — commercial overlay (callback)
3. `buildRecoveryPlan(...)` → `runRecoveryEnrichment(...)` — recovery
   plan overlay for BLOCK verdicts (callback)
4. `Object.freeze(controlVerdict)` — F2/F6 immutability invariant

## Extracted from
`server/orchestrator/index.ts` lines ~4290-4454 (the `controlVerdict`
composition try block + commercial-overlay try/catch + recovery-plan
overlay try/catch + freeze).

## Public exports
- `composeSystemControl(input): Promise<ComposedSystemControl>`
- `ComposedSystemControl` — `{ verdict: SystemControlVerdict | null, error: string | null }`

## Side-effect ownership
- **DOES** call `Object.freeze(verdict)` — the freeze invariant IS the
  point of the composition seam.
- **DOES NOT** call `storeControlVerdict(...)` (DB persistence remains
  at orchestrator seam; needs `db` handle + `jobId`).
- **DOES NOT** mutate `overallStatus`, the budget back-compat mirror,
  or the budget-decision ledger array — those operate downstream of
  the frozen verdict.
- Commercial + recovery-plan overlays are passed as injectable
  callbacks so the heavy imports (`designSystemJudgement`,
  `buildRecoveryPlan`, `runRecoveryEnrichment`) stay at the
  orchestrator seam and this module remains pure-orchestration.

## Doctrine
- **D1**: verdict reads are direct dotted access.
- **D3**: `SystemControlVerdict` is a strict-enum shape from
  `server/system-control/types.ts`.
- **D5**: `verdict: null` is the canonical "evaluator threw" signal;
  caller MUST inspect `verdict !== null` before propagating.

## Dispatch wiring
Reserved env flag: `ORCH_USE_SYSTEM_CONTROL_COMPOSITION`. Parity:
`.local/docs/p4b-extractions/system-control-composition-parity.md`.
