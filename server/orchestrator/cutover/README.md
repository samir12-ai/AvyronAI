# cutover — Task #92 / Phase 4-D

Controlled runtime cutover from the legacy inline `runOrchestrator`
body (`current`) to the extracted module chain (`candidate`).

## OD-1..OD-5 doctrine (canonical in `replit.md`)

- **OD-1 — Single-persist degradation surface.** The PLAN_DEGRADED
  surface (commercial-DNA rejections, AEL-partial provenance,
  validationState downgrade) is computed BEFORE the first
  `persistPlan` call. The legacy CAS re-persist is on a sunset path
  guarded by `ORCH_SINGLE_PERSIST_MODE`. ESLint rule
  `orchestrator/no-cas-re-persist` bans new call sites.

- **OD-2 — Retry-amplification budget aligned with `expectedCompleteBy`.**
  A maximally-retried run cannot exceed its own in-flight lock window
  (T-S5-C6 ceiling). The shadow log compares "what the new budget
  would have permitted" vs the legacy implementation for 7d before
  the new ceiling becomes load-bearing.

- **OD-3 — `runOrchestrator` ≤200 lines.** Once P4-D + P4-E complete,
  `runOrchestrator` is a thin choreographer that calls extracted
  modules. New inline logic ≥10 lines requires an architect note OR
  extraction into a sibling module.

- **OD-4 — Traffic-percent rollout, not binary cutover.**
  `cutover_state.traffic_percent ∈ {0,1,5,25,50,100}`. Each increment
  requires `readyForCutover=true` (P4-C health gate) and a 24h soak
  enforced by a DB trigger. A 7d steady-state at each non-zero step
  is the doctrine soak time; the 24h trigger is the safety floor.

- **OD-5 — Auto-revert is the ONLY automated traffic-percent change.**
  Any STRUCTURAL or CANONICAL_FIELD divergence observed at
  traffic_percent > 0 flips the percent to 0 atomically and sets
  `locked_until=NOW()+1h` to prevent thrash. Operator must explicitly
  unlock before further promotion.

## Files

- `traffic-decision.ts` — `decideOrchestratorPath(jobId, percent)`
  deterministic FNV-1a per-jobId split. Strict enum on percent.
- `state-store.ts` — `cutover_state` singleton CRUD; emits
  `[Orchestrator/Cutover] PERCENT_CHANGE` on every write.
- `auto-revert.ts` — `recordCandidateDivergence` /
  `recordCandidateThrow` — fires the OD-5 atomic flip.
- `metrics.ts` — `orch_cutover_traffic_percent`,
  `orch_cutover_runs_total{path}`,
  `orch_cutover_divergence_at_traffic_total{traffic_percent,divergence_class}`,
  `orch_persist_call_total{site}`,
  `orch_cutover_auto_revert_total{reason}`.

## Operator runbook

- **Promotion (manual)**: `POST /api/admin/cutover/increment` with
  `X-Admin-Token`. Refused unless: `readyForCutover=true` AND
  `(now - last_increment_at) ≥ 24h` AND `locked_until ≤ now`.
- **Revert (manual)**: `POST /api/admin/cutover/revert`. Sets
  traffic_percent=0 unconditionally. Always available.
- **Unlock**: `POST /api/admin/cutover/unlock`. Clears `locked_until`
  so a follow-on promotion attempt can succeed. Required after every
  auto-revert.
- **Inspect**: `GET /api/admin/cutover`. Returns the singleton row
  plus the 24h divergence histogram and the parity-health `readyForCutover`
  echo.
