---
name: MI snapshot resolution & phantom drizzle columns
description: Why run-pinned MI snapshot lookups starve the CI surface, and how a nonexistent schema column crashes drizzle selects.
---

## Run-pinned MI snapshot lookups starve the customer surface
MI (market intelligence) snapshots are almost never written with the orchestrator run's jobId — they come from manual refreshes (`manual_*`) and the background fetch-orchestrator (`persist:*`). MI is the one engine with livenessRule="reuse_allowed".
**Why:** A strict `jobId === resolved orch runId` lookup returns null forever once the run's own snapshot is pruned, even with fresh COMPLETE snapshots present — the exact "data gone" symptom.
**How to apply:** Snapshot-serving endpoints for reuse_allowed engines must fall back (explicitly labeled, e.g. `snapshotResolution: run_pinned | latest_reused`) to the newest usable snapshot scoped to accountId+campaignId. Never add a new response field named `snapshotSource` — that name is the canonical FRESH_DATA/CACHED_DATA data-provenance enum spread from `buildResultFromSnapshot` and will be silently clobbered (D2 violation).

## Phantom schema column crashes drizzle with a misleading error
Selecting a column object that doesn't exist on the drizzle table (e.g. `miSnapshots.competitorsFound`) throws `Cannot convert undefined or null to object` at query build time — it looks like a data bug, not a schema bug.
**How to apply:** When a drizzle route 500s with that message, diff the select list against the table definition in `shared/schema.ts` first; reproduce per-query with a small tsx harness to isolate which select throws.
