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

## To add for beta (Phase 1 follow-up)

| # | Guardrail | Why | Toggle | Observable signal |
|---|---|---|---|---|
| GR19 | Beta admissions freeze | Halt new account onboarding without code deploy when a stage hits a rollback trigger. | `BETA_ADMISSIONS_FROZEN=true` | env validator boot log + admission endpoint 503 count |
| GR20 | Per-account beta cap | Hard ceiling on active beta accounts so a stage-rollback can be enforced via env. | `BETA_ACCOUNT_CAP=N` | gauge: `beta_accounts_active{tier}` |
| GR21 | Per-account daily AI spend cap | Stop runaway spend if a single account hits an AI loop. Complements GR1 (rate limit) with a USD ceiling. | `AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT` | counter: `ai_spend_usd_per_account{account}` (requires Phase 1 metric — see [`observation-plan.md`](./observation-plan.md) G4) |
| GR22 | Per-account daily scrape volume cap | Stop runaway scraping if a single account hits a refresh loop. | `SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT` | counter: `scraper_requests_total{account}` (requires Phase 1 metric — G2) |
| GR23 | Global queue depth circuit-breaker | If global MI queue depth exceeds threshold for >5min, defer new jobs (existing jobs continue). | `MI_QUEUE_DEPTH_DEFER_THRESHOLD` | gauge: `mi_queue_depth` (requires Phase 1 metric — G3) |

## Doctrine: a guardrail that can't be turned off in <60s is not a guardrail

Every GR1–GR18 guardrail above can be flipped via env var + workflow restart in <60s. GR19–GR23 will follow the same pattern. The two exceptions (GR11 INVARIANT-RETRY, GR12 multi-replica claim) are doctrine-locked because flipping them re-introduces the original outage class — modifying them requires a full architect review + new seal.
