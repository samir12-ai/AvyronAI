# Avyron AI

## Overview
Avyron AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

**Frontend** — Expo SDK + React Native, Expo Router, React Context, TanStack React Query, React Native Reanimated, i18n-js.

**Backend** — Express.js + Node.js + TypeScript, RESTful APIs. Dual AI engine (OpenAI GPT + Google Gemini). Autonomous engine with guardrails and a decision feedback loop.

**Data Storage** — Client-side AsyncStorage. Server-side PostgreSQL with Drizzle ORM (schema floor enforced on boot, `REQUIRED_SCHEMA_VERSION = 45`).

**Core principles** — Monorepo, TypeScript everywhere, platform abstraction (iOS/Android/Web), dynamic theming, Zod request validation, system-wide fail-safe enforcement, cross-engine isolation validation.

**Feature inventory** — Full list archived in [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §1 (includes P-1 Publish Lineage + Outcome Tracker, July 2026).

## External Dependencies

- **AI**: OpenAI API (`OPENAI_API_KEY`), Google Gemini.
- **Data acquisition**: Bright Data Unlocker API (zone-based; IG/TikTok/Website/Blog) via single client `server/competitive-intelligence/brightdata-client.ts` (ESLint-enforced import boundary). Google review texts require separate `BRIGHT_DATA_SERP_ZONE` (Unlocker refuses raw Google HTML). Apify = TikTok fallback.
- **Database**: PostgreSQL via Drizzle ORM. Migration runner: `server/migrations/runner.ts` (advisory lock, `npm run db:migrate`).
- **Auth**: JWT email/password (access 14d legacy grace; refresh 30d with rotation). Account lockout 5 attempts / 15 min. Stripe webhook for subscriptions. Per-account AI rate limit 50/hr/route.
- **Other**: Video Credits System, static landing/pricing served by Express, social platforms (IG/FB/Twitter/LinkedIn/TikTok).

---

## Active doctrine (live rules — non-negotiable)

### D1–D5 Semantic Contract Hardening

- **D1** — No semantic fallback. `?? status`, `|| verdict`, `?? outcome` FORBIDDEN on any live decision path. ESLint rule `semantic/no-semantic-fallback`.
- **D2** — Every meaning has its own canonical field. Generic `status` carries execution semantics ONLY.
- **D3** — Strict `z.enum([...])` for every verdict-shaped field, never `z.string()`.
- **D4** — Legacy fields are display/migration only; MAY NOT satisfy contracts.
- **D5** — Missing canonical → `CONTRACT_INCOMPLETE`. Never silently substitute.

Canonical fields: `validationState` ∈ {validated|provisional|weak|rejected}, `decision.action` ∈ {test|scale|hold|halt}, `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory}, `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}, `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY}.

Contract reference: `INTEGRITY_CONTRACT` in `server/orchestrator/contract-registry/registry.ts`. Inline ESLint suppression allowlist size: 4.

> Detail + suppression policy: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §2. History: [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md).

### Continuity Architecture (Seals #13–#19)

**Founding doctrine: operational silence is a system failure category.**

Core invariants:
- **INVARIANT-RETRY** — Failed OR partial boss runs MUST NEVER be suppressed. `SUCCESS_STATUSES = new Set(["completed"])`; `partial`/`failed` both DELETE the claim row.
- **MULTI-REPLICA-SAFE** — DB claim handshake via `tryClaimWindow()` `ON CONFLICT DO NOTHING RETURNING`.
- **CHAIN-STATE-EXPLICIT** — Chains without introspection wiring MUST classify `UNKNOWN`, never silently `HEALTHY`. `ChainState` = `HEALTHY|DEGRADED|DEAD|UNKNOWN`. Registry now has 11 chains (chain #11 = `revisit_scheduler`, P-1).
- **NO-TENANT-LEAK** — Public `/healthz/continuity` MUST NOT expose per-tenant fields; admin token required for full report.
- **NO SILENT CATCHES** — `} catch {}` / `.catch(() => {})` forbidden. Use `_logSilentLoad` / `_noteAuditWriteFailure` or `console.error("[Component] EVENT_TAG ...")`.
- **NO BARE LLM CALLS** — every AI call MUST race against a wall-clock timeout (`AI_OPENAI_HARD_TIMEOUT_MS`, `AI_GEMINI_HARD_TIMEOUT_MS`, default 60s).
- **8-AUDIT GATE (Seal #19)** — every new chain/scheduler/lock/in-flight Map MUST pass an 8-audit pass.

**Steady-state expectation = 0**: `_bossInFlightStats().zombieEvictions`, `_continuityTickInflightStats().zombieEvictions`, `_activeJobsStats().zombieEvictions`, `agent_context_section_load_failed`, `[MIv3] AUDIT_WRITE_FAILED`, `[Orchestrator] STUCK_JOB_UPDATE_FAILED`, `continuity_dead_cycles_total`.

> Operator surface, lifecycle tests, env knobs, alert thresholds: [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §2. Operator handoff: [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md).

### Orchestrator / Replay / UX / Memory — live invariants

Detail archived in [`.local/docs/seals/intelligence-architecture-archive.md`](.local/docs/seals/intelligence-architecture-archive.md) and [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §3. Hard rules:

- **Replay (P4-A)**: All `server/orchestrator/**` LLM calls through `withReplayRecorder(...)`. ESLint `orchestrator-replay/no-bare-llm-call-in-replay` enforced. Recording OFF by default.
- **Decomposition (P4-E)**: Legacy `runOrchestrator` is the ONLY working path (scaffold throws `SCAFFOLD_NOT_WIRED`). Line ceiling 5000 (ESLint). Per-sibling-module ceiling 200. `ORCH_USE_<MODULE>` env reads banned.
- **UX projection (P8)**: Customer JSX MUST NOT contain internal engine names or doctrinal tokens. Verdict rendering via `presentRunTruthfulness()`. CI: `npm run lint:vocab`.
- **Canonical fact ownership (P1)**: `strategy_memory` written ONLY through `memoryStore`. ESLint `canonical-fact/no-direct-strategy-memory-write`. One write gate: `policyEnforcedMemoryCheck`.
- **Memory unification (P2)**: Reinforce by FK; `boundRowCount=0` → `MEMORY_UNBOUND` + CV-11. Outcome rows immutable once evaluated. Single read-time decay. CV-11 steady-state 0.

### Perception Layer

Allowlist-translator at `shared/perception-translator.ts` — fail-closed, unknown inputs return `null`. Endpoints: `GET /api/perception/watchtower`, `/activity`, `/monitoring`, `/reasoning` (all under `requireCampaign`). Customer payload contains NO internal UUIDs/status strings. See [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §4 for full surface.

### Narrative LLM v2

v2 grounded-LLM rewrite (`server/narrative-layer.ts:~376`) default-on (since May 2026, sunset target was 2026-07-01). `EXPO_PUBLIC_NARRATIVE_LLM_V2=0` = ops revert. Failure → `llm_v2_failed_template_fallback`. See [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §5 for sunset criteria.

### Beta Safety Doctrine

- **B1** Truthfulness over confidence.
- **B2** Visibility over silence.
- **B3** Safe degradation over fake success.
- **B4** Explicit classification over hidden ambiguity.
- **B5** Operational continuity over feature velocity.

Beta-readiness package: [`.local/docs/beta-readiness/`](.local/docs/beta-readiness/) (mirrored to [`docs/beta-readiness/`](docs/beta-readiness/)). Cap env vars: `BETA_ADMISSIONS_FROZEN`, `BETA_ACCOUNT_CAP`.

### performance_snapshots row contract (P-1)

`checkpoint='sync'` rows carry full economics. `checkpoint IN ('24h','72h','7d')` rows carry engagement metrics only — economics are **explicit NULL by design** (null = not captured, 0 = platform said 0 — B1). Any reader aggregating this table MUST filter by checkpoint class. Idempotency is DB-level: unique partial index on `(post_id, checkpoint)` + `onConflictDoNothing()`.

### Scraping-First Performance Loop (P-2)

`server/performance-loop/` — owned-post tracking + lineage, deterministic content scoring (`owned_content_scores`), weekly business outcome scoring (`weekly_business_scores`), contracted AI interpretation. Migrations 044/045 (schema floor 45). Live rules:

- **NULL≠zero everywhere**: missing metrics/rates stay NULL; rate/delta helpers return null on missing or zero denominators. Never coerce to 0.
- **Verdicts are earned**: `businessVerdict=UNKNOWN` with `<2` prior baseline weeks; `attributionConfidence` strict-enum, never defaulted.
- **Interpretation is judge-gated**: deterministic evidence judge (verdict preservation, invented-metric ban, causation guard); both attempts rejected → `PERFORMANCE_INTERPRETATION_UNAVAILABLE`, no template fallback.
- **FAILED snapshots never satisfy freshness** — in BOTH the outer campaign gate (`needsUserChannelScrape`) and the inner per-profile gate (`snapshot_data::json->>'scrapeStatus' IS DISTINCT FROM 'FAILED'`). A failure never suppresses the retry.
- **Backoff grace window**: one run stamps `graceSince` once and may retry a target that failed within its own window (fallback chain completes in-run); `cooldownUntil` is never mutated by the bypass — cross-run cooling stays intact.

---

## Required Replit Secrets

Env validator (`server/env-validator.ts`) refuses to boot on any missing required secret. Set via Replit Secrets — never via `.replit` `[userenv.shared]` (history-leak risk).

| Secret | Required | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | always | Postgres connection string. |
| `JWT_SECRET` | prod (dev: warn) | Auth signing key. `SESSION_SECRET` accepted as alias; changing either invalidates sessions. |
| `OPENAI_API_KEY` | always | OpenAI client. `AI_INTEGRATIONS_OPENAI_API_KEY` accepted as alias. |
| `BRIGHT_DATA_API_KEY` | all-or-nothing with `BRIGHT_DATA_ZONE` | Unlocker API key. Both unset → scraping SAFE-OFF; one set without other → boot-fatal. |
| `BRIGHT_DATA_ZONE` | all-or-nothing with `BRIGHT_DATA_API_KEY` | Unlocker zone name. |
| `BRIGHT_DATA_COUNTRY` | optional | 2-letter ISO; malformed → boot-fatal. |
| `BRIGHT_DATA_SERP_ZONE` | optional | Separate SERP API zone for Google review texts. Unset → reviews degraded (`GOOGLE_RAW_HTML_UNSUPPORTED`). |
| `STRIPE_WEBHOOK_SECRET` | recommended | Webhook route rejects all events (503, fail-closed) and subscription sync disabled until set. |
| `PUBLIC_BASE_URL` | always (dev derives) | Canonical absolute base URL. `https://` enforced in prod. |
| `ALLOWED_PUBLIC_HOSTS` | optional | Comma-separated additional hostname suffixes. |
| `METRICS_ADMIN_TOKEN` | recommended | Infrastructure-only: gates `/metrics` and `/healthz/*`. Does NOT grant `/api/admin/*` access. |
| `OPERATOR_ADMIN_TOKEN` | recommended | Product-admin: gates all `/api/admin/*` operator endpoints. Must be separate from `METRICS_ADMIN_TOKEN`. |
| `SENTRY_DSN` | recommended | Error reporting. Absent → no-op. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | recommended | Reserved for OpenTelemetry. |
| `JWT_LEGACY_CUTOFF_ISO` | optional | Override auto-persisted JWT legacy-grace cutoff. |
| `AI_RATE_LIMIT_PER_HOUR` | optional | Override 50/hr/account/route AI rate limit. |
| `BOSS_INFLIGHT_MAX_AGE_MS` | optional | Boss watchdog ceiling (default 30min). |
| `CONTINUITY_TICK_MAX_AGE_MS` | optional | Continuity tick watchdog (default 15min). |
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | Gemini wall-clock timeout (default 60s). |
| `MI_ACTIVE_JOBS_MAX_AGE_MS` | optional | MIv3 activeJobs watchdog (default 30min). |
| `REVISIT_SCHEDULER_DISABLED` | optional | Set `true` or `1` to disable the 30-min outcome revisit scheduler. |

## Observability

- `GET /healthz` — unauth liveness. `GET /metrics` — Prometheus, admin-gated. `GET /healthz/continuity` — public counters; admin token reveals per-tenant.
- Logger: `server/logger.ts` (pino-compatible, `traceId`, `stripSecrets()`). Sentry: no-op when `SENTRY_DSN` unset.
- Boot order: `validateEnv → initOTel → initSentry → ArtifactGuard → loggerMiddleware → /healthz → /metrics → /api → runMigrations() → workers`.
- Full prose: [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) §6.

## GDPR account deletion

`server/account-lifecycle.ts` — two-phase reversible delete (30d quarantine). Phase 1 masks PII + inserts tombstone; Phase 2 reaper runs daily. `CASCADE_EXEMPT`: `audit_log_archive`, `account_tombstones`, `schema_migrations`, `auth_lockouts`, `messages`. Full prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §7.

---

## Seal archive index

| File | Contents |
|------|----------|
| [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) | May 2026 prune (§1–§12: auth, D1–D5, continuity, perception, narrative, beta, GDPR, marketing engines, OBS-C, features, migrations, observability) |
| [`.local/docs/seals/replit-md-prune-2026-07-20.md`](.local/docs/seals/replit-md-prune-2026-07-20.md) | July 2026 prune (§1–§6: feature list + P-1, continuity operator surface, orch/replay/UX/memory, perception, narrative sunset, observability boot) |
| [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md) | D1–D5 history, Seal #9 closures, suppression allowlist |
| [`.local/docs/seals/intelligence-architecture-archive.md`](.local/docs/seals/intelligence-architecture-archive.md) | Replay / Decomposition / UX / Memory full prose |
| [`.local/docs/seals/intelligence-hardening-seal.md`](.local/docs/seals/intelligence-hardening-seal.md) | Historical hardening seal |
| [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md) | Hourly scheduler, idempotent invocation, schema 021 |
| [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md) | DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema 022 |
| [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md) | 9 closed silent-degradation findings + 4 deferred + 6 behavioural tests |
| [`.local/docs/seals/seal-16-followups.md`](.local/docs/seals/seal-16-followups.md) | F1 activeJobs watchdog + F2 Gemini AbortController |
| [`.local/docs/seals/seal-17-track4-observability.md`](.local/docs/seals/seal-17-track4-observability.md) | Grafana dashboard + Continuity panel + admin endpoints |
| [`.local/docs/seals/seal-18-track5-lifecycle-tests.md`](.local/docs/seals/seal-18-track5-lifecycle-tests.md) | 18 lifecycle scenarios + harness + flake checker |
| [`.local/docs/seals/seal-19-track6-audits.md`](.local/docs/seals/seal-19-track6-audits.md) | 8-audit verdict matrix |
| [`.local/docs/seals/seal-20-track7-doctrine-lock.md`](.local/docs/seals/seal-20-track7-doctrine-lock.md) | Doctrine lock + operator handoff |
| [`.local/docs/audits/revisit-scheduler-8-audit-2026-07.md`](.local/docs/audits/revisit-scheduler-8-audit-2026-07.md) | Revisit scheduler 8-audit gate (P-1, July 2026, all 8 PASS) |
| [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md) | Operator one-pager: dashboard URLs, alerts, env-var reference, heartbeat-red decision tree |
| [`.local/docs/seal-13-to-17-plan.md`](.local/docs/seal-13-to-17-plan.md) | Original Tracks #1–#7 design plan |
