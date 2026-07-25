# Runtime Guardrails — Beta Profile

**Companion to:** [`launch-constraints.md`](./launch-constraints.md), [`must-monitor-metrics.md`](./must-monitor-metrics.md).

Every guardrail listed here MUST be:
1. **Already in code today** OR explicitly marked `[follow-up to add]`.
2. Toggleable via env var (no code-change required to flip).
3. Backed by an observable metric or audit event (no silent enforcement).

## Active in code today

| # | Guardrail | Enforcement | Toggle | Observable signal | Doctrine ref |
|---|---|---|---|---|---|
| GR1 | Per-account AI generation rate limit | 50 calls/hr/account/route on `/api/generate-content\|ad\|reel-script\|calendar` → `429 + Retry-After + AI_RATE_LIMIT_EXCEEDED` | `AI_RATE_LIMIT_PER_HOUR` env var | HTTP 429 count per account/route in `/metrics` | replit.md "External Dependencies" Seal #2 / F1.8 |
| GR2 | Account lockout on failed login | 5 fails / 15min → 423 + 15min `Retry-After` | hardcoded thresholds | `auth_lockouts` table rows; auth metrics | replit.md "User Authentication" |
| GR3 | JWT legacy grace window | Pre-deploy tokens lacking `aud`/`iss` accepted for `JWT_LEGACY_GRACE_DAYS` (default 7d) | `JWT_LEGACY_CUTOFF_ISO` env override | `[Auth] JWT_LEGACY_GRACE \| hits=...` log line | replit.md "User Authentication" Seal #2 / F9.2 |
| GR4 | Continuity scheduler kill-switch | When set true, scheduler tick is no-op | `CONTINUITY_SCHEDULER_DISABLED=true` | `continuity_scheduler_up=0`; `/healthz/continuity` `schedulerUp=false` | replit.md "Continuity Architecture" |
| GR5 | Continuity supervisor kill-switch | Supervisor tick no-op | `CONTINUITY_SUPERVISOR_DISABLED=true` | `continuity_supervisor_up=0` | replit.md |
| GR6 | Boss in-flight zombie watchdog | `BOSS_INFLIGHT_MAX_AGE_MS` (default 30min) — evicts hung locks | env override | `_bossInFlightStats().zombieEvictions` (steady-state 0) | Seal #15 / F5 |
| GR7 | Continuity tick zombie watchdog | `CONTINUITY_TICK_MAX_AGE_MS` (default 15min) | env override | `_continuityTickInflightStats().zombieEvictions` (steady-state 0) | Seal #15 / F6 |
| GR8 | MI active-jobs zombie watchdog | `MI_ACTIVE_JOBS_MAX_AGE_MS` (default 30min) | env override | `_activeJobsStats().zombieEvictions` (steady-state 0) | Seal #16 / F1 |
| GR9 | Gemini AI hard timeout + abort | `AI_GEMINI_HARD_TIMEOUT_MS` (default 60s) → `AICallError("AI_TIMEOUT")` + `AbortController.abort()` cancels SDK fetch | env override | timeout error count; absence of socket leaks | Seal #15 + #16 / F2 |
| GR10 | OpenAI AI hard timeout | `AI_OPENAI_HARD_TIMEOUT_MS` | env override | timeout error count | Seal #15 |
| GR11 | INVARIANT-RETRY (failed/partial boss runs auto-retry) | `SUCCESS_STATUSES = new Set(["completed"])` in `scheduler.ts`; non-completed → `releaseClaimForRetry()` (DELETE claim) | doctrine — NOT togglable (P0 if changed) | `continuity_window_claims_released_total` | replit.md "Core invariants" |
| GR12 | Multi-replica claim handshake | `INSERT INTO continuity_window_claims ON CONFLICT DO NOTHING` | doctrine — NOT togglable (P0 if changed) | `continuity_window_claims_acquired_total` vs `_lost_other_replica_total` | replit.md "Core invariants" |
| GR13 | Tenant isolation in scrape engines | Cross-engine isolation guard refuses prohibited write targets | hardcoded | `[MIv3] AUDIT_WRITE_FAILED` (Seal #15 / F2) | Seal #15 |
| GR14 | Stripe webhook signature verification | Routes fail-closed when `STRIPE_WEBHOOK_SECRET` unset | env (production REFUSES boot if unset) | env validator boot log | Seal #7 / F10.5 |
| GR15 | Admin endpoint admin-token gate | `/metrics`, admin `/healthz/continuity`, `/api/admin/continuity/*` require timing-safe `X-Admin-Token` | `METRICS_ADMIN_TOKEN` | 401 count | Seal #14 NO-TENANT-LEAK |
| GR16 | PII redaction in logger | `stripSecrets()` redacts on key match + inline `Bearer …` / `sk-…` / `eyJ…` patterns | hardcoded | n/a (defensive) | Seal #7 / F10.4 |
| GR17 | `SynthesizedPlan.degraded` + `PlanSource` flag | Fallback / partial / degraded plans tagged; outcomes from degraded plans excluded from memory reinforcement | doctrine | `degraded=true` plans visible in audit | Seal #19 Audit #6 |
| GR18 | AEL `isPartial` propagation | Downstream engines see degraded enrichment | doctrine | `partialReason` in plan trace | replit.md "AEL Partial Degradation Flag" |
| GR19 | Beta admissions freeze | When `BETA_ADMISSIONS_FROZEN=true`, `/api/auth/register` returns `503 + BETA_ADMISSIONS_FROZEN + Retry-After: 3600` BEFORE bcrypt+DB insert | `BETA_ADMISSIONS_FROZEN=true` env | env validator boot log shows knob value; `BETA_ADMISSIONS_FROZEN` audit rows on denial; HTTP 503 count | Task #54 |
| GR20 | Per-account beta cap | When active `users` row count ≥ `BETA_ACCOUNT_CAP`, registration returns `503 + BETA_ACCOUNT_CAP_REACHED + Retry-After: 3600`. Existing accounts unaffected. | `BETA_ACCOUNT_CAP=N` env (unset = disabled) | env validator boot log; `BETA_ACCOUNT_CAP_REACHED` audit rows with `activeAccounts`+`cap` details | Task #54 |
| GR21 | Per-account daily AI spend cap | Generate-* routes carry `aiSpendCapPerAccount()`. Estimates 24h spend from `ai_usage_log.estimated_tokens` × blended per-model USD/1K rate. When estimate ≥ cap → `429 + AI_DAILY_SPEND_CAP_EXCEEDED + Retry-After: 3600`. | `AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT=50` env (unset = disabled) | `AI_SPEND_CAP_EXCEEDED` audit rows with `estimatedSpendUsd`+`byModel`; HTTP 429 count. Cost-from-tokens proxy is conservative (trips before real invoice); G4 true-cost metric will replace the estimate when shipped. | Task #54 |
| GR22 | Per-account daily scrape volume cap | `_createAndStartJob` evaluates `evaluateScrapeAdmission()` BEFORE inserting a new `mi_fetch_jobs` row. Proxy = sum(`competitor_count`) over last 24h. When `used + newJob > cap` → admission denied. | `SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT=200` env (unset = disabled) | `SCRAPE_VOLUME_CAP_EXCEEDED` audit rows; `[ScrapeVolumeCap] EXCEEDED` log. Proxy will be replaced by `scraper_requests_total` (G2) when shipped. | Task #54 |
| GR23 | Global MI queue depth circuit-breaker | `_createAndStartJob` defers new claims when global `mi_fetch_jobs.status='QUEUED'` count > threshold sustained ≥5min (hysteresis avoids single-tick spikes). Existing in-flight jobs continue. | `MI_QUEUE_DEPTH_DEFER_THRESHOLD=N` env (unset = disabled) | `MI_QUEUE_DEPTH_DEFERRED` audit rows with `queueDepth`+`sustainedSec`; `[QueueDepthDefer] DEFERRING` log. Complements the existing `BACKPRESSURE_QUEUE_THRESHOLD` per-cycle throttle. | Task #54 |

## To add for beta (Phase 1 follow-up)

(none — GR19–GR23 shipped via Task #54)

## Doctrine: a guardrail that can't be turned off in <60s is not a guardrail

Every GR1–GR18 guardrail above can be flipped via env var + workflow restart in <60s. GR19–GR23 will follow the same pattern. The two exceptions (GR11 INVARIANT-RETRY, GR12 multi-replica claim) are doctrine-locked because flipping them re-introduces the original outage class — modifying them requires a full architect review + new seal.
