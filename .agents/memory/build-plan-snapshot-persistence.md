---
name: Build Plan snapshot persistence is route-owned
description: Why job-bound build_plan_snapshots lookups return null on healthy direct-call runs
---

# Build Plan snapshot persistence is route-owned

The only writer of `build_plan_snapshots` is the HTTP route layer (`server/build-plan-layer/routes.ts`).
`runBuildPlanLayer()` itself never persists a snapshot row — callers that invoke the layer directly
(validation harnesses, audit runners, real-run scripts) produce a successful plan with NO job-bound
`build_plan_snapshots` row.

**Why:** this has been misread twice as a lineage failure — the audit runner's
`SNAPSHOT_MISS_FOR_RUN` spam and a null exact-job-bound `build_plan_snapshot.json` on an otherwise
fully successful real run. Both were healthy runs.

**How to apply:** when verifying Build Plan lineage for a direct-call run, judge by the layer result
(status/actionability/attempts) plus the job-bound `strategic_plans` row — not by
`build_plan_snapshots`. A null job-bound build-plan snapshot on a direct-call path is expected, not
a regression. If durable job-bound build-plan snapshots are needed for such runs, persistence must
move into the layer (or the caller must write it), which is a deliberate change, not a fix.
