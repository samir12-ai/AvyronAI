# Must-Monitor Metrics — Beta

Canonical metric list for beta. Steady-state expectation = the value at green; alert threshold = the value that fires a pager. Companion to [`playbooks.md`](./playbooks.md) and [`observation-plan.md`](./observation-plan.md).

## Continuity (existing — Seals #13–#20)

| Metric | Steady-state | Alert threshold | Sev | Dashboard panel | Runbook |
|---|---|---|---|---|---|
| `continuity_scheduler_up` | 1 | == 0 for ≥5min | P1 | Grafana avyron-continuity → Heartbeat row | P1 Scheduler dead |
| `continuity_scheduler_last_tick_epoch_seconds` | within 72min of `time()` | `(time() - value) > 7200` | P1 | Heartbeat row | P1 |
| `continuity_supervisor_up` | 1 | == 0 for ≥10min | P1 | Heartbeat row | P2 Supervisor stuck |
| `lastSupervisorTickAt` (from `/healthz/continuity`) | within `intervalMs * 1.2` (≤6min) | older | P1 | Heartbeat row | P2 |
| `continuity_dead_cycles_total` | 0 | > 0 | P1 | 10-chain registry row | P1 / P5 |
| `continuity_heartbeat_stale_total` | 0 (rate) | rate > 0 | P2 | Heartbeat row | P1 |
| `continuity_chain_state{state="DEAD"}` | 0 | > 0 (any chain) | P1 | 10-chain registry row | per-chain runbook |
| `continuity_chain_state{state="UNKNOWN"}` | 3 (`mi_queue_processor`, `tombstone_reaper`, `ael_cel_reruns` per Seal #14) | NOT in expected set | P2 | 10-chain registry row | per-chain runbook |
| `continuity_window_claims_acquired_total` | grows with active campaigns | sudden flat-line vs prior 24h | P2 | Multi-replica row | P1 |
| `continuity_window_claims_released_total` (INVARIANT-RETRY enforcement) | non-zero on failures | spike > 5× rolling 7d avg | P2 | Multi-replica row | P5 Runaway retries |
| `continuity_missed_windows_total` | 0 (steady-state); growth indicates historical depth of silence | > 0 increasing | P2 | Skip reasons row | P1 / P5 |
| `_bossInFlightStats().zombieEvictions` | 0 | > 0 | P2 | Heartbeat row (custom) | GR6 watchdog |
| `_continuityTickInflightStats().zombieEvictions` | 0 | > 0 | P2 | Heartbeat row (custom) | GR7 watchdog |
| `_activeJobsStats().zombieEvictions` | 0 | > 0 | P2 | Custom (Phase 1) | GR8 watchdog |

## Boss / pipeline runtime (existing)

| Metric | Steady-state | Alert threshold | Sev | Dashboard | Runbook |
|---|---|---|---|---|---|
| `runsInvoked` (per tick, from `continuity_ticks.notes`) | matches active campaign count for the window | flat-line vs prior tick | P2 | Skip reasons | P1 |
| `runsFailed / runsInvoked` (24h rolling) | < 1% | > 5% | P1 | Skip reasons | P5 |
| `boss_run_duration_seconds` p50/p95 | <60s / <300s (small accounts) | p95 > 600s sustained 2h | P2 | (Phase 1 panel) | engine diagnosis |
| HTTP 429 `AI_RATE_LIMIT_EXCEEDED` count per account | 0 | > 10 in 1h for single account | P2 | (Phase 1 panel) | P7 cost spike |
| HTTP 423 auth lockout count | 0 (sustained) | > 50 in 1h | P2 | Auth panel | abuse investigation |

## AI / cost (Phase 1 — most are NEW metrics)

| Metric | Steady-state | Alert threshold | Sev | Dashboard | Runbook |
|---|---|---|---|---|---|
| `ai_tokens_consumed_total{account,model,direction}` (NEW — G4) | within projection | > 200% projection per account | P1 | (Phase 1 panel) | P7 |
| `ai_spend_usd_per_account{account}` (NEW — derived from G4) | within projection | exceeds GR21 cap when shipped | P1 | (Phase 1 panel) | P7 |
| `ai_call_timeout_total{provider}` | rare (<5/day) | rate > 1/min sustained 10min | P1 | (Phase 1 panel) | P3 |

## Scraper (Phase 1 — NEW metrics G2)

| Metric | Steady-state | Alert threshold | Sev | Dashboard | Runbook |
|---|---|---|---|---|---|
| `scraper_requests_total{provider,outcome}` (NEW — G2) | success rate > 90% per provider | < 70% sustained 30min | P1 | (Phase 1 panel) | P3 |
| `scraper_latency_seconds{provider}` p95 (NEW — G2) | provider-dependent | > 2× rolling 7d p95 | P2 | (Phase 1 panel) | P3 |
| `scraper_quota_burn_pct{provider}` (NEW — G2) | < 80% by EOD | > 95% | P1 | (Phase 1 panel) | P7 |

## Queue (Phase 1 — NEW metrics G3)

| Metric | Steady-state | Alert threshold | Sev | Dashboard | Runbook |
|---|---|---|---|---|---|
| `mi_queue_depth` (NEW — G3) | < per-account budget × N accounts | sustained > 2× steady-state for 5min | P2 | (Phase 1 panel) | GR23 circuit-breaker |
| `mi_active_jobs_per_account{account}` (NEW — G3) | < per-account budget | == per-account budget for >10min | P2 | (Phase 1 panel) | engine diagnosis |

## DB / runtime (existing process metrics)

| Metric | Steady-state | Alert threshold | Sev | Dashboard | Runbook |
|---|---|---|---|---|---|
| `process_resident_memory_bytes` | within ±10% of post-Seal-#20 baseline (sunset = first 7d post-deploy) | > 1.3× baseline sustained 30min | P1 | Process row | runtime regression investigation |
| `pg_stat_activity` connection count | < pool max × 0.7 | > pool max × 0.9 | P1 | DB row | R-CONN |
| `process_cpu_seconds_total` rate | within ±10% of baseline | > 1.5× baseline sustained 30min | P2 | Process row | runtime regression |

## Audit-event-derived (existing — log-to-metric bridge required for Phase 1 alerting)

| Event | Steady-state | Alert | Sev | Source |
|---|---|---|---|---|
| `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` | absent | any | P2 | Seal #15 / F3 |
| `[Orchestrator] STUCK_JOB_UPDATE_FAILED` | absent | any | P2 | Seal #15 / F4 |
| `[MIv3] AUDIT_WRITE_FAILED` | absent | any | P2 | Seal #15 / F2 |
| `agent_context_section_load_failed` (pino warn) | absent | any | P2 | Seal #15 / F1 |
| `CONTINUITY_REANCHOR` audit | rare (only on long-gap) | spike on a previously-active campaign | P2 | Seal #13 |
| `CONTINUITY_DEAD_CYCLE` audit | absent | any | P1 | Seal #13 |
| `CONTINUITY_REPLICA_CONFLICT` | low (multi-replica races) | spike > 10/hr | P3 | Seal #14 |

## Doctrine: every alert above ties to a playbook

Every P0/P1 alert in this table maps to a playbook section in [`playbooks.md`](./playbooks.md). If an alert is added to this table without a matching playbook entry, the alert is incomplete (Seal #15 silent-degradation analog: an unhandled alert is the same as a missing alert).
