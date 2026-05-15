# Stress-Test Plan

**Companion to:** [`roadmap.md`](./roadmap.md) Phase 2 entry gate.
**Harness:** Seal #18 lifecycle suite — `server/tests/lifecycle/_harness.ts` + `scenario-NN-*.test.ts`. STATE-NOT-LOGS, hermetic, deterministic clock. Flake gate: `scripts/lifecycle-flake-check.sh` (100 iters, zero retries).

## 14 stress vectors → coverage map

| # | Vector | Existing Seal #18 scenario | Status | Notes |
|---|---|---|---|---|
| 1 | Noisy/inconsistent user behavior | scenario-04 (manual+scheduled idempotent), scenario-08 (revoked mid-cycle) | PASS | Manual API races + revocations covered. |
| 2 | Empty-state campaigns | scenario-01 (empty-world), scenario-02 (fresh approval, single window) | PASS | 24 ticks × 0 campaigns, plus single-window campaign. |
| 3 | Low-data campaigns | covered indirectly via scenario-02/03 (fresh approvals) | **GAP — covered behaviorally; no explicit assertion** that engines emit usable plans with sparse signals. Mitigation lives in Audience Engine "Evidence Integrity Filter" + MIv3 "Tiered Signal Quality Gate" (medium tier). | NOT a new lifecycle scenario — engine-level test, not scheduler-level. Folded into [`risk-register.md`](./risk-register.md) R-LD as residual. |
| 4 | Long-running orchestration cycles | scenario-03 (two weeks), scenario-17 (100 campaigns × 4 weeks) | PASS | Long-running sequence with deterministic clock. |
| 5 | Unstable cadence patterns | scenario-05 (long-gap reactivation), scenario-15 (anchor exactly 7d boundary) | PASS | Boundary + long-gap covered. |
| 6 | Partial publishing flows | scenario-06 (failure-then-retry — `partial` shares the same `releaseClaimForRetry` path as `failed`) | PASS | INVARIANT-RETRY proven. |
| 7 | Inconsistent truth submission | covered by code-level test of `acceptUserTruth` validation in `server/pipeline/lanes/user/user-truth.ts:57-90` (transactional, validates `qualified ≤ total`, `booked ≤ qualified`) + Task #48 audit step 6 (D-category integrity). | PASS at engine level. **No new lifecycle scenario added** — truth submission is out-of-band from the scheduler tick and the validation is single-transaction. |
| 8 | Delayed async completion | scenario-12 (mid-tick crash recovery), scenario-16 (reanchor-while-inflight with controllable promise) | PASS | Late-settling promise + token cleanup. |
| 9 | Retry-heavy environments | scenario-06 (failure-then-retry) + Track #3 zombie-watchdog tests (`track3-zombie-watchdogs.test.ts`) | PASS | INVARIANT-RETRY + watchdog ceilings. |
| 10 | Queue buildup | scenario-17 (100 campaigns × 4 weekly ticks → 400 boss runs in <60s wall-clock) | PASS at scheduler level. **GAP — global job queue + per-account budget behavior under sustained N×N load is not lifecycle-tested.** Folded into [`risk-register.md`](./risk-register.md) R-QB; production observation via G3 panel. |
| 11 | Scraper / provider instability | covered by fetch-orchestrator zombie test + activeJobs Map watchdog (Seal #16 / F1) + per-domain proxy telemetry. **No lifecycle scenario** — fetch-orchestrator is mocked in lifecycle harness. | PASS at unit level. |
| 12 | Mixed degraded states | scenario-07 (multi-campaign mixed states A/B/C) | PASS | Per-campaign isolation under mixed decisions. |
| 13 | Prolonged uptime | scenario-17 perf gate (<60s for 400 invocations) + zombie-watchdog ceilings (`BOSS_INFLIGHT_MAX_AGE_MS`, `CONTINUITY_TICK_MAX_AGE_MS`, `MI_ACTIVE_JOBS_MAX_AGE_MS`) | PASS at unit level. **DOCUMENTED_EXCEPTION** — true 60-min steady-state runtime sample requires production deploy (Seal #19 / Audit #2 sunset = first 7d post-deploy; same exception class). |
| 14 | Restart / recovery | scenario-12 (mid-tick crash), scenario-13 (db-unavailable-then-recovers), scenario-18 (scheduler-disabled-at-boot) | PASS | Restart paths + DB outage proven. |

## New scenarios proposed (≤5, gated by NO-FLAKES)

The 14 vectors are 100% covered by the 18 existing scenarios at the scheduler/contract level OR explicitly punted to engine-level / unit-level tests with a tracked residual in [`risk-register.md`](./risk-register.md). **Therefore this task adds ZERO new lifecycle scenarios** — adding a fragile scenario to chase a residual would violate the NO-FLAKES doctrine and inflate the suite without new coverage.

The two scenarios most worth WRITING in a future seal (after the residual surfaces in production data) are listed here for the next operator:

| Candidate | Why deferred |
|---|---|
| scenario-19: operator-reset injected during a `runBoss` failure | Already deferred in Seal #18 architect MEDIUM; Task #48 attempted it and surfaced F-F2 (subtle interaction with implicit long-gap reanchor inside the same retry window). Architect-level diagnosis required before a deterministic scenario is shippable — adding a flaky test here violates NO-FLAKES. |
| scenario-20: queue saturation under N×100 active accounts | Requires modelling the global job queue + per-account budget enforcer in the harness (currently mocked). Defer to a future seal that promotes the queue into the lifecycle harness. Production observation via [`observation-plan.md`](./observation-plan.md) §B G3 covers this in the meantime. |

## Pass criteria for the lifecycle suite (beta entry gate)

- All 18 existing scenarios PASS in the standard `npm test` run.
- `bash scripts/lifecycle-flake-check.sh` returns exit 0 across 100 iterations on the beta-cut commit.
- Any new scenario added in a follow-up seal passes the same 100-iteration gate before merge.
