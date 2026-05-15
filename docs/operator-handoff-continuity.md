# Avyron Continuity — Operator Handoff (Seals #13–#19)

On-call runbook. Doctrine lives in `replit.md` → "Continuity Architecture (Seals #13–#19)".

## 1. Dashboards

`$HOST` = `$PUBLIC_BASE_URL` (the same value the env validator enforces). `$GRAFANA` = your Grafana instance hostname.

| Surface | URL | Auth |
|---|---|---|
| Grafana `avyron-continuity` (16 panels) | `https://$GRAFANA/d/avyron-continuity` (JSON: `.local/dashboards/continuity.json`) | Grafana SSO |
| In-app Continuity panel | App (operator build) → `/audit-control` → 6th panel "Continuity" | `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` set on client |
| Public health | `https://$HOST/healthz/continuity` | none (no tenant fields) |
| Admin health | `https://$HOST/healthz/continuity` + `X-Admin-Token: $METRICS_ADMIN_TOKEN` | admin token |
| Prometheus scrape | `https://$HOST/metrics` + `X-Admin-Token` | admin token |
| Panel API | `https://$HOST/api/admin/continuity/panel` · `https://$HOST/api/admin/continuity/campaign/:campaignId/last-decision` | admin token |

## 2. Alert thresholds

Per-chain state (`classifyChainState` every 5min): `HEALTHY` lag ≤ `expectedIntervalMs × 2` · `DEGRADED` 2×–4× · `DEAD` >4× OR null introspect · `UNKNOWN` introspect not wired.

| Signal | Threshold | Sev |
|---|---|---|
| `supervisor.schedulerState != HEALTHY` | ≥10min | P1 |
| `supervisor.chainsDead > 0` | any | P1 |
| `lastSupervisorTickAt` age > `intervalMs × 1.2` | any | P1 (supervisor stalled) |
| `continuity_dead_cycles_total > 0` | any | P1 (8d no boss_run) |
| `continuity_scheduler_last_tick_epoch_seconds` age > 7200s | any | P1 |
| `continuity_heartbeat_stale_total` rate > 0 | any | P2 |
| `_{boss,continuityTick,activeJobs}InFlightStats().zombieEvictions > 0` | any | P2 |
| `runsFailed > 0` (panel) | any | P2 (INVARIANT-RETRY auto-retries) |
| `continuity_window_claims_lost_other_replica_total` spike | unexpected | P3 |

## 3. Env vars

Set via Replit Secrets — never via `.replit` `[userenv.shared]`.

| Var | Required? | Default | Purpose / operator note |
|---|---|---|---|
| `METRICS_ADMIN_TOKEN` | recommended | unset → 401 on all admin surfaces | Gates `/metrics`, admin `/healthz/continuity`, `/api/admin/continuity/*`. |
| `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` | operator builds | unset → panel hidden | Client-side gate for in-app Continuity panel. Customer builds must NOT set this. |
| `REPLICA_ID` | optional | `replica_<uuid>` per process | Pod/instance ID — stamped on `continuity_window_claims.claimed_by` + boot log. Set explicitly in multi-replica deploys for forensics. |
| `CONTINUITY_SCHEDULER_DISABLED` | optional | `false` | `true` ⇒ scheduler is a no-op. Tests / incident-response only. |
| `CONTINUITY_SUPERVISOR_DISABLED` | optional | `false` | `true` ⇒ supervisor is a no-op. Tests only. |
| `CONTINUITY_TICK_INTERVAL_MS` | optional | 1h | Scheduler cadence override. Tests / accelerated repro. |
| `CONTINUITY_SUPERVISOR_INTERVAL_MS` | optional | 5min | Supervisor cadence override. |
| `BOSS_INFLIGHT_MAX_AGE_MS` | optional | 30min | Boss in-flight zombie-eviction ceiling. |
| `CONTINUITY_TICK_MAX_AGE_MS` | optional | 15min | Continuity tick zombie-eviction ceiling. |
| `MI_ACTIVE_JOBS_MAX_AGE_MS` | optional | 30min | MIv3 fetch-orchestrator activeJobs zombie ceiling (Seal #16/F1). |
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | 60s | Gemini wall-clock timeout — also fires `AbortController.abort()` on the SDK fetch (Seal #16/F2). |
| `AI_OPENAI_HARD_TIMEOUT_MS` | optional | (in code) | OpenAI wall-clock timeout. |
| `AI_RATE_LIMIT_PER_HOUR` | optional | 50 | Per-account AI generation rate limit. |

## 4. "Heartbeat went red" decision tree

```
schedulerState != HEALTHY for ≥10min
  └─ /healthz/continuity → schedulerHeartbeatAgeMs > 72min?
     ├─ Yes: hourly scheduler dead. Check `Start Backend` workflow log
     │       for "[Server] Continuity layer up". If process up >2h with
     │       no tick → SIGTERM + restart. Verify CONTINUITY_SCHEDULER_DISABLED
     │       is NOT set.
     └─ No, but lastSupervisorTickAt stale → same restart flow; verify
        CONTINUITY_SUPERVISOR_DISABLED unset.

chainsDead > 0
  └─ admin /healthz/continuity → find chains[] entry state=DEAD.
     ├─ chainId=continuity_scheduler → see scheduler branch above.
     ├─ chainId={mi_queue_processor,tombstone_reaper,ael_cel_reruns}
     │   AND state=UNKNOWN → expected (introspect unwired). Ack.
     └─ Other worker dead → grep workflow logs for that worker's tag,
        SIGTERM+restart if silent; check DB connection if logging but
        no audit row.

dead_cycles > 0  (campaign idle ≥8d)
  └─ Open in-app Continuity panel for the campaignId. Read the
     "last decision" badge:
       Failed         → INVARIANT-RETRY auto-retries; persistent (>3
                        ticks) ⇒ escalate to engine owner.
       Already evaluated/completed → idempotency, normal.
       In flight      → wait 60s; another replica is mid-run.
       Other replica  → fine, peer claimed it.
       No advance     → planning stalled; check strategic_plans for an
                        APPROVED row matching campaign_id+plan_id.
       Re-anchored & ran → normal AFTER idle; suspicious if active last week.
     Manual kick: POST runBoss with trigger="manual"
     (server/strategic-core/orchestrator-routes.ts).

zombieEvictions > 0  (boss / continuityTick / activeJobs)
  └─ Watchdog already self-recovered. grep ZOMBIE_*_EVICTED for
     lockKey/campaignId. Frequent ⇒ raise ceiling OR find slow
     downstream (likely a missed AI timeout — Seal #15 should have
     closed those).

Lifecycle test flake on a continuity PR
  └─ DO NOT retry. Run `bash scripts/lifecycle-flake-check.sh`
     (100 iters) locally and root-cause before merge.

Anything else
  └─ Capture: (a) admin /healthz/continuity JSON, (b) last 1h /metrics,
     (c) audit_log rows event_type LIKE 'CONTINUITY_%' last 1h,
     (d) Start Backend workflow logs for the affected window.
     File P1 with that bundle.
```

**One-shot liveness:** `curl -s $HOST/healthz/continuity | jq '.supervisor.schedulerState, .lastTickAt'` — expect `HEALTHY` + `lastTickAt` within 72min.
