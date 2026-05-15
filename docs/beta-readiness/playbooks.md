# Operator Playbooks

Each playbook ≤1 printable page. The canonical heartbeat-red decision tree lives in [`.local/docs/operator-handoff-continuity.md`](../operator-handoff-continuity.md) — the playbooks below extend it to the broader beta surface.

---

## P1 — Scheduler dead

**Symptom:** `supervisor.schedulerState != HEALTHY` for ≥10min, OR `continuity_scheduler_last_tick_epoch_seconds` age > 7200s, OR `/healthz/continuity` `lastTickAt` missing/stale.

1. Confirm via `curl -s $HOST/healthz/continuity | jq '.supervisor.schedulerState, .lastTickAt'`. Expect `HEALTHY` + `lastTickAt` within 72min.
2. Check `Start Backend` workflow log for `[Server] Continuity layer up — replicaId=...`. If not present → process is up but boot failed; restart workflow.
3. Verify `CONTINUITY_SCHEDULER_DISABLED` is NOT set.
4. If process up >2h with no tick: SIGTERM via workflow restart.
5. After restart, re-check liveness 5min later; expect ≥1 tick row in `continuity_ticks`.
6. If still dead after 2 restarts: escalate P0 to architect; do NOT touch INVARIANT-RETRY or claim handshake.

---

## P2 — Supervisor stuck

**Symptom:** `lastSupervisorTickAt` older than `intervalMs * 1.2` (default >6min).

1. Verify `CONTINUITY_SUPERVISOR_DISABLED` not set.
2. Restart `Start Backend` workflow.
3. After restart, expect `continuity_supervisor_ticks` row within 5min and `continuity_supervisor_up=1`.
4. If repeats: file P1; check `chain_registry_state` table for stuck chain entries.

---

## P3 — Provider outage (Bright Data / Apify / OpenAI / Gemini)

**Symptom:** `[FetchOrch] STUCK_*_FAILED` log spike, OR AI timeout-error spike, OR scraper success-rate drop (G2 panel once shipped).

1. Identify provider via log tag. Bright Data: `[FetchOrch] *`. Apify: `[Apify] *` / fallback path tag. AI: `[ai-client] gemini abort *` / `AI_TIMEOUT` rejections.
2. Check provider status page.
3. **DO NOT disable scrapers globally** — INVARIANT-RETRY relies on the scheduler. Instead:
   - Bright Data outage: Apify fallback engages automatically for TikTok. Other channels degrade gracefully with `signalOriginType=fallback` tagging.
   - AI provider outage: per-account rate-limit + AI hard timeouts (GR9/GR10) absorb hangs; degraded plans tagged `degraded=true` and excluded from memory reinforcement.
4. Communicate to active beta accounts via in-app status page (U4) once shipped; until then, operator-direct comms.
5. Once provider recovers: monitor `runsFailed/runsInvoked` ratio for the next 3 ticks; expect return to <1%.

---

## P4 — DB interruption

**Symptom:** scenario-13 in production. `db_connection_errors_total` spike; boss runs failing with DB exception.

1. Verify Postgres is reachable: `psql $DATABASE_URL -c 'SELECT 1'`.
2. Scheduler will skip ticks during outage and resume after recovery (proven by scenario-13).
3. Check `continuity_window_claims` for `in_progress` rows older than 30min — should be auto-evicted by GR6 watchdog. If not, file P1 zombie-watchdog regression.
4. After recovery: verify next 3 ticks complete; expect zero in-progress claims older than `BOSS_INFLIGHT_MAX_AGE_MS`.
5. If interruption >15min: notify beta users (P1 incident comms).

---

## P5 — Runaway retries (single campaign)

**Symptom:** G1 retry-amplification panel (once shipped) shows a campaign with `claims_released_total / claims_completed_total > 1.0` over 24h. Until G1 ships: grep `[ContinuityScheduler] runBoss failed` log lines per `campaignId`.

1. Identify campaign via Continuity panel "This campaign — last decision" badge → `Failed`.
2. Read the `reason` field on the per-campaign decision.
3. If reason is engine-specific (e.g. AEL partial, MIv3 quality gate fail): inspect `audit_log` for `BOSS_RUN_FAILED` events for that campaign; root cause via engine output.
4. **Do NOT manually disable INVARIANT-RETRY** — instead, if the failure is persistent (>3 ticks):
   - Revoke the campaign's plan via `/api/strategic-core/revoke-plan` to stop the retry loop.
   - Notify the account owner.
   - File P2 with the engine output for engineering diagnosis.

---

## P6 — Mass-degraded campaigns

**Symptom:** > 20% of active campaigns have `degraded=true` plans in the latest tick.

1. Likely cause: shared upstream failure (provider outage, schema migration mid-flight, env-var misconfig).
2. Check P3 (provider) and P4 (DB) playbooks first.
3. Check schema version: `psql $DATABASE_URL -c 'SELECT MAX(version) FROM schema_migrations'`. Must equal `REQUIRED_SCHEMA_VERSION`.
4. Check env validator boot log for warnings.
5. If no upstream cause: file P1; architect review on whether to halt admissions.

---

## P7 — Billing / cost spike

**Symptom:** AI spend > 200% of forecasted spend for active phase, OR scraper quota burn > 150% projection.

1. Identify cost class:
   - AI: G4 panel (once shipped) → top accounts by `ai_tokens_consumed_total`.
   - Scrape: G2 panel (once shipped) → per-provider quota burn.
   - Until G2/G4 ship: `audit_log` query for `AI_RATE_LIMIT_EXCEEDED` events grouped by account.
2. If single account: enforce GR21 (per-account daily AI spend cap) once shipped, OR manually revoke that account's plans.
3. If multi-account: trip GR19 (`BETA_ADMISSIONS_FROZEN=true`) AND GR20 (lower `BETA_ACCOUNT_CAP`).
4. If GR21/GR19/GR20 not yet shipped: contact engineering lead for manual env-var freeze.
5. P1 retro within 24h.

---

## P8 — Beta-cap rollback

**Symptom:** any rollback trigger from [`roadmap.md`](./roadmap.md) §"Inter-phase rollback triggers" fires.

1. Set `BETA_ADMISSIONS_FROZEN=true` (GR19) — no new accounts.
2. For active accounts above prior-stage cap: lower `BETA_ACCOUNT_CAP` (GR20). Existing accounts keep running unless explicitly revoked; the cap blocks NEW admissions.
3. **Never** disable the scheduler unless directed by P1 playbook above. INVARIANT-RETRY must keep running.
4. Open P1 retro within 24h. Architect APPROVED required to lift the freeze.
