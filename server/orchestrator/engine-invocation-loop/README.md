# engine-invocation-loop (Task #92 / Phase 4-D — SCAFFOLD)

**Status:** scaffold only. The deep extraction of the priority-ordered
engine loop from `server/orchestrator/index.ts` is deferred to a
follow-up — `runOrchestrator` still owns the in-place implementation.
The placeholder exists so the cutover infrastructure (`cutover_state`,
traffic-percent dispatcher, ESLint rule `orchestrator/no-cas-re-persist`)
has a typed target to point at when extraction lands.

## OD-4 / OD-5 stance

While this module is a scaffold, the `ORCH_USE_ENGINE_LOOP` flag is
intentionally absent from the parity health gate's `TRACKED_MODULES`
list. Adding it before the candidate body exists would block
`readyForCutover` forever — see `parity-no-direct-revert` doctrine.

## Extraction checklist (P4-E follow-up)

1. Move the priority-ordered loop body (currently `runOrchestrator`
   lines ~3200–4500) into `index.ts`.
2. Inject the engine registry + scoped-engine resolver so the loop is
   pure: `(ctx, registry, scopedSet) → EngineResult[]`.
3. Route every recorder boundary through `withReplayRecorder`.
4. Add `ORCH_USE_ENGINE_LOOP` to `TRACKED_MODULES` once the candidate
   body produces parity for ≥7d in shadow mode.
5. Capture ≥2 behavioral_change_proof cassettes (purpose tag) for the
   first observable change in loop semantics.
