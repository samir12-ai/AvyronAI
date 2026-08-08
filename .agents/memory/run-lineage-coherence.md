---
name: Run-lineage coherence for plans & preview
description: Job ID as canonical lineage key; fail-closed GET reads; chained fetch cycles in polling UIs
---

# Run-lineage coherence (plans + preview)

**Rule:** The orchestrator job ID is the canonical lineage key for strategic plans, build-plan snapshots, summaries, and all preview reads. GET endpoints must serve exactly the resolved run's rows or fail closed with `CURRENT_RUN_PLAN_NOT_PERSISTED` — never generate on GET, never substitute an older campaign-latest row. When a newer failed/running/cancelled run shadows the last resolvable run, unpinned reads fail closed; only an explicit `jobId` pin may inspect an older run.

**Why:** Campaign-latest fallbacks silently presented a previous run's plan as fresh output; the run-resolver's `isStale` + `newerNonResolvableRun` exists specifically to detect the shadowed case.

**How to apply (client):** Completion reviews rejected this task three times over client races, all the same shape:
1. A fetch cycle that resolves the current run and then fetches dependent data must CHAIN: `seq = ++seqRef; runId = await fetchLatest(seq); await fetchDependent(runId, seq)` — never pass a render-captured `job?.id` into the second call (it pins to the prior run for one poll tick).
2. Guard every commit with the monotonic seq AND reject responses whose `runId` doesn't match the pinned request.
3. Clear dependent state (`setActivePlan(null)`) whenever run identity changes or a new run starts, and bump the seq to invalidate in-flight cycles.
4. Recovery paths (e.g. HTTP 409 "already running") must initialize the same poll-guard refs the happy path sets.
5. Every consumed response field must be declared on the client interface — reviewers run tsc and reject undeclared reads (`data.runId` on an interface without `runId`).

**Verification:** judge tsc by net-new errors vs the ~730-error baseline (`comm -13` on sorted error lines). Source-level + mounted-HTTP tests in `server/tests/canonical-plan-persistence.test.ts` and `build-plan-latest-run-binding.test.ts` fence this behavior.
