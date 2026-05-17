# result-assembly (Task #92 / Phase 4-D — SCAFFOLD)

**Status:** scaffold only. The extraction of the final-results
assembly stage (engine outputs → orchestrator job row → strategicPlans
seed → memory-write fan-out) from `runOrchestrator` is deferred to
Phase 4-E.

## OD-1 anchor

The Phase 4-D **single-persist** invariant (OD-1) is the constraint
this module must honour when extracted: exactly one
`db.update(orchestratorJobs)` terminal write per run, and exactly one
`persistPlan` call (with the degradation overlay already applied).
The ESLint rule `orchestrator/no-cas-re-persist` is the static guard;
this module will become its primary target site.

## Extraction checklist (P4-E follow-up)

1. Move the terminal `db.update(orchestratorJobs)` block + section
   summary serialization out of `runOrchestrator`.
2. Move the `writeStrategyMemoryEntries` fan-out into the same module.
3. Accept the degradation overlay computed by
   `synthesisDegradationBuilder` as an input — DO NOT recompute.
4. Add `ORCH_USE_RESULT_ASSEMBLY` to the parity gate's `TRACKED_MODULES`
   once shadow parity holds for ≥7d.
