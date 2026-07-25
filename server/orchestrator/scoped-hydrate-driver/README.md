# scoped-hydrate-driver — Task #90 / Phase 4-B

Extracts the "scoped re-run hydration" block from `runOrchestrator`
(~lines 3806-3905). When the caller passes `scopedEngines`, the
orchestrator must seed `ctx.audience` / `ctx.mi` from the latest
snapshots for any upstream engine that will NOT execute this run, then
gate via `validateScopedHydration` to fail-closed on missing inputs.

## Extracted from
`server/orchestrator/index.ts`:
- Audience snapshot hydration loop: lines 3806-3856
- MI snapshot hydration: lines 3858-3881
- `validateScopedHydration` gate: lines 3893-3905

## Public exports
- `parseAudienceSnapshotRow(row): ParsedAudienceSnapshot | null` — pure
  row → canonical-seed parser; returns `null` for zero-signal rows so
  the caller can iterate older snapshots.
- `parseMiSnapshotRow(row)` — pure row → `ctx.mi` shape.
- `buildScopedHydrationOutcome(parts)` — bundles a comparable
  `ScopedHydrationOutcome` for the dispatcher's `compare` step.
- `validateScopedHydration` re-export.

## Side-effect ownership
- **NO** DB reads. The orchestrator owns the `db.select().from(...)`
  calls so this module stays free of `drizzle-orm` and the schema
  imports. Module scope is pure parsing + outcome assembly.
- **NO** ctx mutation. The orchestrator assigns
  `ctx.audience = canonicalizeAudienceShape(canonicalSeed)` at the
  seam — `canonicalizeAudienceShape` lives outside this module and we
  do not re-export it (separation of concerns).

## Doctrine
- **D5**: `gaps` is a typed array on `ScopedHydrationOutcome`. Caller
  MUST inspect for `gaps.length > 0` and BLOCK; no implicit "best
  effort" silently-degraded path.

## Dispatch wiring
Reserved env flag: `ORCH_USE_SCOPED_HYDRATE_DRIVER`. Parity:
`.local/docs/p4b-extractions/scoped-hydrate-driver-parity.md`.
