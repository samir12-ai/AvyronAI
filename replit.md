# Avyron AI

## Overview
Avyron AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, offering a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

**Frontend** — Expo SDK + React Native, Expo Router for navigation, React Context for global state, TanStack React Query for server state, React Native Reanimated for animations, i18n-js for i18n.

**Backend** — Express.js + Node.js + TypeScript, RESTful APIs. Dual AI engine (OpenAI GPT + Google Gemini), specialized models for image/design, autonomous engine with guardrails and a decision feedback loop.

**Data Storage** — Client-side via AsyncStorage. Server-side PostgreSQL with Drizzle ORM.

**Core principles** — Monorepo, TypeScript everywhere, platform abstraction (iOS/Android/Web), dynamic theming, Zod request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, guaranteed non-empty engine outputs, cross-engine isolation validation.

**Key feature surfaces** (full inventory archived in [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §10):

- Dashboard (revenue KPIs, Strategic Narrative card, inline chat, Perception Layer)
- Causal Narrative Layer (5-step chain)
- Content Creation (AI Writer + AI Designer)
- 15-engine AI Orchestrator (Positioning, Differentiation, Mechanism, Offer, Funnel, Integrity, Awareness, Persuasion, + Fortress Completion engines)
- Strategy Root System + Product DNA identity layer
- Competitive Intelligence (MIv3, 8-engine pipeline, tiered quality gates)
- AEL v2 + CEL (causal enforcement)
- BuildPlanLayer + Execution Activation Layer
- Adaptive Data Source System (`campaign_metrics` ↔ `benchmark`)
- Concurrency & Scalability Hardening
- Audit & Control System (5-panel + Continuity panel)
- Decision Policy + Attribution Layers (campaign-scoped `strategy_decisions`/`decision_outcomes`)
- Unified Memory Policy Enforcement (`policyEnforcedMemoryCheck()`)
- Plan Synthesis Hardening (`SynthesizedPlan` with `PlanSource`/`degraded`/`synthesisVerification`)
- Signal Origin Type System (`real|competitor|inferred|fallback|unknown`)
- System Control Layer (`SystemControlVerdict`)
- Evidence Integrity Filter (Audience)
- Signal-First Positioning + Text Sanitizer Layer

## External Dependencies

- **AI**: OpenAI API, Google Gemini.
- **Data acquisition**: Bright Data residential proxy pool (Instagram, TikTok, Website/Blog, Google Reviews); Apify (TikTok fallback).
- **Database**: PostgreSQL via Drizzle ORM (schema floor enforced on boot).
- **Auth**: JWT email/password (access 14d during legacy grace; refresh 30d with rotation). Account lockout 5/15min. Stripe webhook for subscriptions. Per-account AI rate limit 50/hr/route. Full prose archived in [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §1.
- **Other**: Video Credits System, static landing/pricing served by Express, social platforms (IG/FB/Twitter/LinkedIn/TikTok).

---

## Active doctrine (live rules — non-negotiable)

Authoritative summaries follow. Full per-rule prose, evidence, and history archived in `.local/docs/seals/`.

### D1–D5 Semantic Contract Hardening

System-wide policy governing every live-decision and live-reporting field across orchestrator, system-control, recovery, snapshot, agent stream, build-plan, and contract registry.

- **D1** — No semantic fallback. `?? status`, `|| verdict`, `?? outcome` etc. are FORBIDDEN on any live decision path. Enforced by ESLint rule `semantic/no-semantic-fallback`.
- **D2** — Every meaning has its own canonical field. Generic `status` carries execution semantics ONLY.
- **D3** — Strict `z.enum([...])` for every verdict-shaped field, never `z.string()`.
- **D4** — Legacy fields are display/migration only; MAY NOT satisfy contracts.
- **D5** — Missing canonical → `CONTRACT_INCOMPLETE`. Never silently substitute.

Canonical field names: `validationState` ∈ {validated|provisional|weak|rejected}, `decision.action` ∈ {test|scale|hold|halt}, `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory}, `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}, `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY}.

Reference: `INTEGRITY_CONTRACT` in `server/orchestrator/contract-registry/registry.ts`. Inline ESLint suppression allowlist size: 4.

> Expanded prose + suppression policy: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §2. Detailed history: [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md).

### Continuity Architecture (Seals #13–#19)

**Founding doctrine: operational silence is a system failure category.**

**Core invariants:**

- **INVARIANT-RETRY** — Failed OR partial boss runs MUST NEVER be suppressed. `SUCCESS_STATUSES = new Set(["completed"])`; `partial`/`failed` both DELETE the claim row.
- **MULTI-REPLICA-SAFE** — DB claim handshake via `tryClaimWindow()` `ON CONFLICT DO NOTHING RETURNING` — two scheduler instances MUST NOT both invoke runBoss for the same `(campaign, plan, window)`.
- **CHAIN-STATE-EXPLICIT** — Chains lacking introspection wiring MUST be classified `UNKNOWN`, never silently `HEALTHY`. `ChainState` = `HEALTHY|DEGRADED|DEAD|UNKNOWN`.
- **NO-TENANT-LEAK** — Public `/healthz/continuity` MUST NOT expose per-tenant fields; admin-gated full report requires timing-safe `METRICS_ADMIN_TOKEN`.
- **NO SILENT CATCHES** — `} catch {}` / `.catch(() => {})` forbidden. Use `_logSilentLoad` / `_noteAuditWriteFailure` or `console.error("[Component] EVENT_TAG ...")`.
- **NO BARE LLM CALLS** — every AI call MUST race against a wall-clock timeout (`AI_OPENAI_HARD_TIMEOUT_MS`, `AI_GEMINI_HARD_TIMEOUT_MS`, default 60s).
- **8-AUDIT GATE (Seal #19)** — every new chain/scheduler/lock/in-flight Map MUST pass an 8-audit pass before the next seal opens.

**Steady-state expectation = 0**: `_bossInFlightStats().zombieEvictions`, `_continuityTickInflightStats().zombieEvictions`, `_activeJobsStats().zombieEvictions`, `agent_context_section_load_failed`, `[MIv3] AUDIT_WRITE_FAILED`, `[Orchestrator] STUCK_JOB_UPDATE_FAILED`, `continuity_dead_cycles_total`.

**Operator-visible surface (Seal #17)**: Grafana dashboard `.local/dashboards/continuity.json` + in-app Continuity panel in `app/audit-control.tsx`. Admin endpoints `GET /api/admin/continuity/panel` and `/campaign/:campaignId/last-decision` (same `X-Admin-Token` gate as `/metrics`).

**Lifecycle behavioural simulation (Seal #18)**: 18 scenario tests in `server/tests/lifecycle/scenario-NN-*.test.ts` with deterministic clock, fully hermetic, 100-iter flake checker.

> Expanded prose (alerts, env knobs, thresholds, all signal lists): [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §3. Per-seal history: `seal-13` through `seal-20-*.md`. Operator handoff: [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md).

### Orchestrator / Replay / UX / Memory — live invariants

Five doctrinal sections (Replay Harness P4-A, Orchestrator Decomposition P4-E, UX Projection P8, Canonical Fact Ownership P1, Memory Unification P2) archived in [`.local/docs/seals/intelligence-architecture-archive.md`](.local/docs/seals/intelligence-architecture-archive.md). Live invariants that remain authoritative:

- **Replay harness (P4-A).** All `server/orchestrator/**` LLM calls funnel through `withReplayRecorder(...)`. ESLint `orchestrator-replay/no-bare-llm-call-in-replay` blocks direct `aiChat`/`aiGemini`/`getOpenAI`/`getGemini` imports inside `server/orchestrator/replay/**`. Production recording OFF by default.
- **Orchestrator decomposition (P4-E).** Legacy ~4900-line `runOrchestrator` is the ONLY working path (candidate scaffold throws `SCAFFOLD_NOT_WIRED`). `runOrchestrator` line ceiling 5000 (ESLint `orchestrator/no-new-large-file`). Per-sibling-module ceiling 200. `ORCH_USE_<MODULE>` env reads banned. `cutover_state` table archived by migration 032. `/healthz/orchestrator-parity` is a regression observer (no `readyForCutover` field). Schema floor `REQUIRED_SCHEMA_VERSION = 32`.
- **UX projection (P8).** Customer surface speaks outcomes; code surface speaks canonical. Operator-grade panels gated behind `useOperatorSurface()` (`hooks/useOperatorSurface.ts`). Customer JSX MUST NOT contain internal engine names or raw doctrinal tokens. Verdict rendering goes through `lib/run-truthfulness-presentation.ts → presentRunTruthfulness()` (returns `null` when inputs missing — D5). CI: `npm run lint:vocab`.
- **Canonical fact ownership (P1).** `strategy_memory` written ONLY through `memoryStore` (`server/memory-system/store.ts`). ESLint `canonical-fact/no-direct-strategy-memory-write` (allowlist: store + tests + migrations). Operational state lives in `engine_operational_state` singleton — never `strategy_memory`. One write gate: `validateDecisionForMemoryWrite → policyEnforcedMemoryCheck`.
- **Memory unification (P2).** Reinforce by FK via `memoryStore.reinforceByDecisionId()` — `boundRowCount=0` triggers `MEMORY_UNBOUND` + CV-11. Outcome rows immutable once evaluated. Single read-time multiplicative decay (`computeEffectiveConfidence`); write-time decay REMOVED. Same-fingerprint flip rejected unless incoming confidence strictly greater. Every write carries `provenance_origin ∈ {outcome|mutation|engine_seed|exploration|decay|unknown}`. CV-11 `cv11_hallucination_exposure_total` — steady-state 0.

### Perception Layer (Slices 1+2, May 2026)

Customer-facing read-only surface that exposes hidden runtime intelligence in safe English. Allowlist-translator in `shared/perception-translator.ts` — **fail-closed**, unknown inputs return `null`. Endpoints (under `requireCampaign`): `GET /api/perception/watchtower`, `GET /api/perception/activity?sinceHours=N`. Customer payload contains NO internal UUIDs/status strings. Frontend: `hooks/usePerception.ts`, `components/WatchtowerStrip.tsx`, `components/ActivityTimeline.tsx`, mounted in `app/(tabs)/index.tsx`.

> Expanded prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §4.

### Narrative LLM v2 default-on + v1 sunset (P204)

v2 grounded-LLM rewrite (`server/narrative-layer.ts:~376`) is **default-on**. `EXPO_PUBLIC_NARRATIVE_LLM_V2=0` reverts to v1 template (ops escape hatch). When v2 grounding fails → `narrativeMode = llm_v2_failed_template_fallback`. Pre-sunset cassette tool at `.local/scripts/narrative-v1-v2-cassette.ts`. **Sunset target: 2026-07-01** gated on grounding-rejected rate stability + cassette review for ≥3 industries + fallback-mode rate < 5% rolling 14d.

> Expanded prose + sunset criteria detail: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §5.

### Beta Safety Doctrine (Task #50)

Five non-negotiable axioms for every new piece of code, copy, and operator surface:

- **B1** Truthfulness over confidence.
- **B2** Visibility over silence.
- **B3** Safe degradation over fake success.
- **B4** Explicit classification over hidden ambiguity.
- **B5** Operational continuity over feature velocity.

Beta-readiness package: [`.local/docs/beta-readiness/`](.local/docs/beta-readiness/) (mirrored to [`docs/beta-readiness/`](docs/beta-readiness/) since `.local/` is gitignored). Per-stage rollback authority + cap env vars (`BETA_ADMISSIONS_FROZEN`, `BETA_ACCOUNT_CAP`).

> Expanded prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §6.

---

## Required Replit Secrets (Seal #7 / F10.5)

The env validator (`server/env-validator.ts`) refuses to boot if any required secret is missing. Set via Replit Secrets — never via `.replit` `[userenv.shared]` (history-leak risk).

| Secret | Required | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | always | Postgres connection string. |
| `JWT_SECRET` | production (dev: warn) | Auth token signing key. `SESSION_SECRET` accepted as alias signing key (2026-07-08) — prod boots if either is set; changing either invalidates sessions. |
| `OPENAI_API_KEY` | always | OpenAI client. `AI_INTEGRATIONS_OPENAI_API_KEY` accepted as alias. |
| `BRIGHT_DATA_PROXY_USERNAME` | always | Residential proxy auth (scrapers). |
| `BRIGHT_DATA_PROXY_COUNTRY` | always | Proxy geo-targeting code. |
| `STRIPE_WEBHOOK_SECRET` | recommended (2026-07-08: no longer boot-fatal) | Stripe signature verification; webhook route rejects all events (503, fail-closed) and subscription sync stays disabled until set. |
| `PUBLIC_BASE_URL` | always (dev derives) | Canonical absolute base URL. Validated: absolute URL, `https://` in prod, hostname suffix in allowlist or `ALLOWED_PUBLIC_HOSTS`. |
| `ALLOWED_PUBLIC_HOSTS` | optional | Comma-separated additional hostname suffixes. |
| `METRICS_ADMIN_TOKEN` | recommended | Infrastructure-only: gates `/metrics` and `/healthz/*` endpoints via `X-Admin-Token`. Does NOT grant access to product-admin `/api/admin/*` routes. |
| `OPERATOR_ADMIN_TOKEN` | recommended | Product-admin: gates all `/api/admin/*` operator endpoints (continuity panel, replay cassettes, operator notices, operations panel). Must be a separate secret from `METRICS_ADMIN_TOKEN`; infrastructure callers (Prometheus scrapers, uptime probes) must NOT hold this token. |
| `SENTRY_DSN` | recommended | Server error reporting. Absent → no-op. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | recommended | Reserved for upstream OpenTelemetry. |
| `JWT_LEGACY_CUTOFF_ISO` | optional | Override auto-persisted JWT legacy-grace cutoff. |
| `AI_RATE_LIMIT_PER_HOUR` | optional | Override 50/hr/account/route AI rate limit. |
| `BOSS_INFLIGHT_MAX_AGE_MS` | optional | Boss in-flight watchdog ceiling (default 30min). |
| `CONTINUITY_TICK_MAX_AGE_MS` | optional | Continuity tick watchdog (default 15min). |
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | Gemini wall-clock timeout (default 60s). |
| `MI_ACTIVE_JOBS_MAX_AGE_MS` | optional | MIv3 activeJobs watchdog (default 30min). |

## Observability

- `GET /healthz` — unauth liveness (`{ok, ts}`).
- `GET /metrics` — Prometheus, admin-gated.
- `GET /healthz/continuity` — public counters; admin token reveals per-tenant.
- Structured logger (`server/logger.ts`) — pino-compatible, `traceId` via AsyncLocalStorage, `stripSecrets()` redacts auth keys + inline `Bearer …`/`sk-…`/`eyJ…`.
- Sentry shim — dynamic-import, no-op when `SENTRY_DSN` unset; prod masks `error.message` to `"Internal server error"`.
- Boot order: `validateEnv → initOTel → initSentry → ArtifactGuard → loggerMiddleware → /healthz → /metrics → /api → await runMigrations() → workers`.

> Expanded prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §12.

## Migration runner

`server/migrations/runner.ts` is the single entry point. Acquires `pg_advisory_lock(8675309)` (5-min timeout), applies pending SQL from `server/migrations/sql/`, then runs legacy `002–014` programmatic migrations. `REQUIRED_SCHEMA_VERSION` enforced at boot. `npm run db:migrate` runs standalone. `npm run db:generate` writes drizzle output. First-line `-- noTransaction` marker honoured for `CREATE INDEX CONCURRENTLY`.

> Expanded prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §11.

## GDPR account deletion

`server/account-lifecycle.ts` — two-phase reversible-during-quarantine delete spanning 105 `accountId`-bearing tables. Phase 1 (`DELETE /api/account`) requires Bearer + `X-Account-Delete-Confirm: PERMANENTLY_DELETE` + current password; masks PII, inserts `account_tombstones` (`purgeAfter = now() + 30d`). Phase 2 reaper runs daily; `cascadeDeleteAccount()` is one PG transaction. `CASCADE_EXEMPT`: `audit_log_archive`, `account_tombstones`, `schema_migrations`, `auth_lockouts`, `messages`.

> Full prose: [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §7.

## Other archived doctrine

- Marketing-logic engine upgrade (Apr 2026, 5-engine commercial-reasoning modules + `shared/commercial-dna.ts`) — [`replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §8.
- Operations Guardian OBS-C (per-provider AI burst keying, `PROVIDER_INSTABILITY` correlator, Task #60) — [`replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) §9. Full audit: [`.local/docs/audits/operations-guardian-obs-c-2026-05.md`](.local/docs/audits/operations-guardian-obs-c-2026-05.md).

---

## Seal archive index

Each per-seal file contains the full implementation detail, code references, test pointers, and historical justification. The `replit.md` rules above are the authoritative live doctrine; archive files are read-only history.

- [`.local/docs/seals/replit-md-prune-2026-05-22.md`](.local/docs/seals/replit-md-prune-2026-05-22.md) — **2026-05-22 prune archive** (verbatim prose lifted from replit.md during cleanup; numbered §1–§12).
- [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md) — D1–D5 detail, Seal #9 closures, suppression allowlist.
- [`.local/docs/seals/intelligence-architecture-archive.md`](.local/docs/seals/intelligence-architecture-archive.md) — Replay/Decomposition/UX/Memory full prose.
- [`.local/docs/seals/intelligence-hardening-seal.md`](.local/docs/seals/intelligence-hardening-seal.md) — historical hardening seal.
- [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md) — Hourly scheduler, idempotent invocation, long-gap re-anchor, schema 021.
- [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md) — DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema 022.
- [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md) — 9 closed silent-degradation findings + 4 deferred + 6 behavioural tests.
- [`.local/docs/seals/seal-16-followups.md`](.local/docs/seals/seal-16-followups.md) — F1 activeJobs watchdog + F2 Gemini AbortController.signal.
- [`.local/docs/seals/seal-17-track4-observability.md`](.local/docs/seals/seal-17-track4-observability.md) — Grafana dashboard + in-app Continuity panel + admin endpoints.
- [`.local/docs/seals/seal-18-track5-lifecycle-tests.md`](.local/docs/seals/seal-18-track5-lifecycle-tests.md) — 18 lifecycle scenarios + harness + flake checker.
- [`.local/docs/seals/seal-19-track6-audits.md`](.local/docs/seals/seal-19-track6-audits.md) — 8-audit verdict matrix + evidence.
- [`.local/docs/seals/seal-20-track7-doctrine-lock.md`](.local/docs/seals/seal-20-track7-doctrine-lock.md) — Doctrine lock + operator handoff.
- [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md) — operator one-pager (dashboard URLs, alerts, env-var reference, heartbeat-red decision tree).
- [`.local/docs/seal-13-to-17-plan.md`](.local/docs/seal-13-to-17-plan.md) — original Tracks #1–#7 design plan.
