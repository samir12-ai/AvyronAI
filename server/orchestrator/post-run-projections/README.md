# post-run-projections — Task #70 / Phase 7 (folded into Task #90 / Phase 4-B)

Single seam for the three post-run projections that fan out from
`runOrchestrator` after the control verdict is frozen:

1. `composeCommercialDNA(campaignId, ssc.commercialSignals)` →
   `OrchestratorRunResult.commercialDna`.
2. `summarizeConfidenceIntegrity(provenanceLog)` →
   `OrchestratorRunResult.confidenceIntegrity`.
3. `runRecoveryEnrichment({ recoveryPlan, results, ... })` —
   strategist overlay invoked BEFORE the verdict freeze; status is
   recorded post-freeze.

## Folder convention (Task #90)
Task #90 / Phase 4-B promoted every extracted orchestrator module to its
own folder. This module existed pre-Phase-4-B; the move from
`server/orchestrator/post-run-projections.ts` →
`server/orchestrator/post-run-projections/index.ts` is a pure file move
(import path `./post-run-projections` continues to resolve through the
folder's `index.ts`).

## Public exports
- `computePostRunProjections(input): Promise<PostRunProjections>`
- `runRecoveryEnrichment(input): Promise<{ plan, enriched, error? }>`
- Types: `PostRunProjections`, `ProjectionEnvelope<T>`, `ProjectionStatus`.

## Doctrine
- **D5** — every projection has a typed `ProjectionEnvelope` with strict
  `status ∈ {"ok","failed","skipped"}`. Missing data → `skipped` with a
  `skipReason`; never silently absent.

## Dispatch
Default `current` — the orchestrator imports `computePostRunProjections`
directly. Task #90 / Phase 4-B does not yet wire this module through
`dispatchExtraction()` because its existing single-call shape already
provides the seam; the dispatch hook is reserved for the future case
where the projection bundle's content changes (then `current` keeps the
prior shape and `candidate` ships the new one).
