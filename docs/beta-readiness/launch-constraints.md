# Launch Constraints — Beta

Hard caps active during the controlled beta. Each cap is tied to a guardrail in [`guardrails.md`](./guardrails.md) and a metric in [`must-monitor-metrics.md`](./must-monitor-metrics.md).

## Account caps

| Constraint | Beta value | Guardrail | Metric |
|---|---|---|---|
| Max active beta accounts (S0–S1) | 5 | GR20 `BETA_ACCOUNT_CAP=5` (Phase 1 follow-up) | `beta_accounts_active` |
| Max active beta accounts (S2a/b/c/d) | 10 / 15 / 20 / 25 | GR20 raised per stage gate | same |
| Max active beta accounts (S3 open beta) | uncapped (waitlist throttled) | GR20 unset; GR19 freeze on rollback trigger | same |
| Per-account max active campaigns | 3 | enforced at account-tier provisioning; verify via `SELECT COUNT(*) FROM strategic_plans WHERE account_id=$1 AND status='APPROVED'` | dashboard "campaigns per account" |
| Per-account max competitors tracked (MIv3) | 5 | enforced at MIv3 onboarding; verify via `SELECT COUNT(*) FROM mi_v3_competitors WHERE account_id=$1` | dashboard counter |

## AI consumption caps

| Constraint | Beta value | Guardrail | Metric |
|---|---|---|---|
| AI generation rate limit (per route) | 50 calls/hr/account | GR1 `AI_RATE_LIMIT_PER_HOUR=50` | HTTP 429 count per account |
| Per-account daily AI spend cap | $50/account/day (initial; tune in S2) | GR21 `AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT` (Phase 1 follow-up) | `ai_spend_usd_per_account` |
| Gemini wall-clock timeout per call | 60s | GR9 `AI_GEMINI_HARD_TIMEOUT_MS=60000` | timeout count |
| OpenAI wall-clock timeout per call | (in code) | GR10 `AI_OPENAI_HARD_TIMEOUT_MS` | timeout count |

## Scrape consumption caps

| Constraint | Beta value | Guardrail | Metric |
|---|---|---|---|
| Per-account daily scrape volume cap | 200 requests/account/day across all providers | GR22 `SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT` (Phase 1 follow-up) | `scraper_requests_total` |
| Bright Data daily quota | provider-imposed; monitored not enforced | n/a | `scraper_quota_burn_pct{provider="brightdata"}` |
| Apify daily quota (TikTok fallback) | provider-imposed | n/a | `scraper_quota_burn_pct{provider="apify"}` |
| MIv3 fetch-orchestrator active job watchdog | 30min | GR8 `MI_ACTIVE_JOBS_MAX_AGE_MS=1800000` | `_activeJobsStats().zombieEvictions` |

## Continuity-side caps

| Constraint | Beta value | Guardrail | Metric |
|---|---|---|---|
| Boss in-flight watchdog | 30min | GR6 `BOSS_INFLIGHT_MAX_AGE_MS=1800000` | `_bossInFlightStats().zombieEvictions` |
| Continuity tick watchdog | 15min | GR7 `CONTINUITY_TICK_MAX_AGE_MS=900000` | `_continuityTickInflightStats().zombieEvictions` |
| Continuity scheduler tick interval | 1h | `CONTINUITY_TICK_INTERVAL_MS=3600000` (default) | `continuity_scheduler_last_tick_epoch_seconds` |
| Continuity supervisor tick interval | 5min | `CONTINUITY_SUPERVISOR_INTERVAL_MS=300000` (default) | `lastSupervisorTickAt` |

## Geographic / data-residency

| Constraint | Beta value | Notes |
|---|---|---|
| Beta accounts allowed regions | none — accounts may be from any region | EU users: standard data-residency caveats apply per Bright Data + provider TOS. Re-evaluate at S3 if EU regulator surface arises. |
| Single-region deployment | yes | Multi-region observation is out of scope for beta. |

## Auth / access caps

| Constraint | Beta value | Guardrail |
|---|---|---|
| JWT access token TTL | 14d (during JWT_LEGACY grace; sunset to 60m once mobile client wires `/api/auth/refresh`) | replit.md "User Authentication" |
| Refresh token TTL | 30d, rotates on every refresh | same |
| Account lockout | 5 fails / 15min | GR2 |
| Admin endpoint gate | timing-safe `X-Admin-Token` | GR15 `METRICS_ADMIN_TOKEN` |

## When to lift a cap

Each cap may be raised ONLY when:
1. The corresponding metric in [`must-monitor-metrics.md`](./must-monitor-metrics.md) has been GREEN for ≥7d at the prior cap level, AND
2. The corresponding guardrail in [`guardrails.md`](./guardrails.md) is active and observable, AND
3. The stage exit gate in [`rollout-strategy.md`](./rollout-strategy.md) is met.

A cap MUST be lowered (without architect approval) on any rollback trigger fired per [`roadmap.md`](./roadmap.md).
