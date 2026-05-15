# Avyron AI

## Overview
Avyron AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, offering a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It features dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend employs Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, campaign metrics, a Strategic Narrative causal chain card, and an inline AI chat box.
- **Causal Narrative Layer**: Transforms engine outputs into a 5-step causal chain (Market Problem → Why It Happens → What We Do → How We Fix It → What To Execute).
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **AI Management**: AI Audience Engine, Auto Publish, Market DB, and a Performance Intelligence Layer.
- **Strategic Engines**: Includes Positioning, Differentiation, Mechanism, Offer, Funnel, Integrity, Awareness, and Persuasion Engines for comprehensive strategic plans.
- **Strategy Root System**: A unified source of truth binding all strategic engines via a single enforced root hash.
- **Product DNA**: A source-of-truth layer injected into all strategic engines for identity context in AI prompts.
- **Competitive Intelligence (MIv3)**: An 8-engine pipeline for real-data competitor analysis across Instagram, Website, Blog, TikTok, and Google Reviews.
- **Authority Hierarchy Enforcement**: Strict Awareness → Funnel → Persuasion authority hierarchy with cross-engine validation.
- **Analytical Enrichment Layer (AEL v2)**: Produces WHY-level analysis, including root causes, causal chains, buying barriers, and priority-ranked insights.
- **Causal Enforcement Layer (CEL)**: Programmatically enforces alignment between AEL root causes and all downstream engine outputs.
- **AI Orchestrator**: A single-entry orchestration engine running 15 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis.
- **BuildPlanLayer (Execution Synthesis Layer)**: Converts engine analysis into actionable decisions and daily/weekly instructions.
- **Execution Activation Layer**: Auto-triggers the content production pipeline upon plan approval.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine, Iteration Engine, and Retention Engine.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Concurrency Hardening**: Includes lock timeouts, batched deduplication, stale recovery safeguards, and atomic plan approval.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and rate gating.
- **Audit & Control System**: A 5-panel dashboard for auditing feeds, AI usage, gate status, decisions, publish history, and job management.
- **Decision Policy Layer**: Central enforcement policy with confidence thresholds applied across plan synthesis, memory mutation, outcome tracking, and autonomous worker.
- **Decision Attribution Layer**: Campaign-scoped decision tracking for `strategy_decisions` and `decision_outcomes` for per-campaign outcome measurement.
- **Weighted Multi-Decision Attribution**: Links calendar entries to multiple decisions with weights, replacing heuristic-based attribution.
- **Unified Memory Policy Enforcement**: All `strategy_memory` write paths pass through `policyEnforcedMemoryCheck()` with confidence thresholds.
- **Operational vs Strategic Memory Separation**: Differentiates memory types for strategic vs. operational data, excluding non-strategic types from AI context reads.
- **Text Sanitizer Layer**: Provides platform-aware text cleaning at the earliest point in each pipeline.
- **Plan Synthesis Hardening**: `SynthesizedPlan` interface includes `PlanSource` type, `degraded` flag, and `synthesisVerification` for robust plan generation and verification.
- **Fallback Plan Isolation**: Prevents outcomes from degraded/fallback plans from being used for memory reinforcement.
- **Memory-to-Outcome Provenance**: Links memory updates directly to the `decision_outcomes` entry that triggered them for full traceability.
- **Signal Origin Type System**: Tags every signal with its source type (`real | competitor | inferred | fallback | unknown`) and propagates this identity through the pipeline for risk-aware planning.
- **Cross-Engine Alignment Hardening**: Comprehensive system hardening addressing contradictions and weak handoffs across 15 engines through enforcement, data contracts, and intelligence layers.
- **Cross-Engine Integrity Enforcement**: Ensures `safeToExecute` in plan synthesis cross-references critical engine statuses and CEL enforcement results.
- **System Control Layer**: A unified final authority layer that runs after all engines, evaluates full system state (structural checks, contradiction detection), and produces a `SystemControlVerdict` with execution mode, block reasons, downgrades, and repair actions.
- **Evidence Integrity Filter (Audience Engine)**: Uses confidence downgrade (not binary erase) for low-evidence signals; infers pains from qualified objections and emotional drivers with quality guards (confidence≥0.25, evidenceCount≥1) and cardinality caps (max 5 objection-inferred, 3 driver-inferred).
- **Tiered Signal Quality Gate (MI V3)**: Replaces binary 0.85 threshold with tiered system: high≥0.75, medium≥0.50, rejected<0.50. Medium signals are usable but tracked separately via `mediumQualitySignals` in `QualityGateResult`.
- **Orphan Claim Penalty Cap (Positioning Engine)**: Orphan penalty remains 0.05/claim but is capped at 0.10 max per territory with a floor of 0.15 confidence, preventing score collapse from many orphaned claims.
- **Signal-First Positioning (Positioning Engine)**: Signal-first claim construction. `buildSignalClaimSeeds()` pre-builds enemy/contrast/narrative seeds deterministically from mapped signal labels per territory BEFORE LLM call. LLM role is "refiner", not "generator". `validateClaimGrounding()` post-LLM gate checks every claim field against source signal labels; ungrounded LLM output falls back to the deterministic seed. Orphan audit is preventive: territories with ALL claims orphaned are DROPPED. Result: signal coverage 0%→25%, orphans 8→0, every claim traceable to upstream signals.
- **Scoped Engine Context Hydration (Orchestrator)**: When `scopedEngines` is used, the orchestrator pre-loads the best available audience snapshot and latest COMPLETE MI snapshot from DB, enabling selective re-runs (e.g., positioning-only) without re-executing upstream engines.
- **AEL Partial Degradation Flag**: `AnalyticalPackage` includes optional `isPartial` and `partialReason` fields. All AEL fallback paths set these flags so downstream engines know enrichment is degraded.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Data Acquisition & Proxy Infrastructure
- Bright Data residential proxy pool for scraping (Instagram, TikTok, Website/Blog, Google Reviews)
- Apify (as a fallback for TikTok scraping)

### Database
- PostgreSQL

### User Authentication
- JWT-based email/password authentication. Access tokens (**14d TTL**, held during the JWT_LEGACY grace window for client compat — sunset to 60m once the mobile client gains `/api/auth/refresh` wiring) carry `audience="avyron-ai"` + `issuer="avyron-auth"`; refresh tokens (30d) rotate on every `/api/auth/refresh` call and use the `auth_sessions` table with reuse detection (`SECURITY_REFRESH_REUSE` cascade fires only when the presented secret bcrypt-matches a revoked row's hash). `/api/auth/logout` likewise verifies the refresh secret before revoking. Account lockout: 5 failed logins / 15min → 423 with 15min `Retry-After` (`auth_lockouts` table).
- **JWT 7-day legacy grace window (Seal #2 / F9.2).** Pre-deploy tokens lacking `aud`/`iss` are still accepted for `JWT_LEGACY_GRACE_DAYS` (default 7d). The cutoff resolves with a stable persisted stamp at `.local/state/jwt-legacy-cutoff` (override path with `JWT_LEGACY_STATE_FILE`); `JWT_LEGACY_CUTOFF_ISO` overrides if set + parseable. Operator runbook: monitor `[Auth] JWT_LEGACY_GRACE | hits=...` log line — when it stops appearing for ≥48h, set `JWT_LEGACY_CUTOFF_ISO` to a past timestamp to force-close the grace window.
- Stripe webhook integration for subscription management
- Per-account AI generation rate limit (Seal #2 / F1.8): 50 calls/hr/account/route on `/api/generate-content|ad|reel-script|calendar`. Override via `AI_RATE_LIMIT_PER_HOUR`. Returns `429 + Retry-After + AI_RATE_LIMIT_EXCEEDED`.

### Video Credits System
- Manages video generation credits for users.

### Website (Landing + Pricing)
- Static landing and pricing pages served by the Express backend.

### Social Platforms
- Instagram, Facebook, Twitter, LinkedIn, TikTok

---

## Active doctrine (live rules — non-negotiable)

These are the rules every new piece of code must obey. Implementation detail and historical justification for each is archived in `.local/docs/seals/` (linked per section).

### D1–D5 Semantic Contract Hardening

System-wide policy that governs every live-decision and live-reporting field across orchestrator, system-control, recovery, snapshot, agent stream, build-plan, and contract registry.

| # | Rule | Enforcement point |
|---|---|---|
| **D1** | **No semantic fallback.** `?? status`, `\|\| status`, `?? verdict`, `\|\| verdict`, `?? outcome`, `\|\| outcome` patterns are FORBIDDEN on any live decision path. | Custom ESLint rule `semantic/no-semantic-fallback` (`.local/eslint-rules/no-semantic-fallback.js`) scoped to `server/{agent,system-control,orchestrator,build-plan-layer,recovery-*,strategy}/**`. Detects RHS, LHS, ternary, alias-variable, AND destructured-default patterns. |
| **D2** | **Every meaning has its own canonical field.** A generic `status` may carry execution semantics ONLY (F1). Verdict (F2/F6), validation (F3), trust (F4), action (F9), and gate-outcome (F10) each get a dedicated field name. | Contract registry — every verdict-shaped field declared with its own `id` + canonical `path`. |
| **D3** | **Strict enums only.** Every verdict-shaped field uses `z.enum([...])`, never `z.string()`. | Contract registry — `validationState`, `decisionAction`, `decisionGateOutcome`, `overallStatus`, `integrityVerdict`, `marketState` all `z.enum`. |
| **D4** | **Legacy fields are historical only.** May exist for display/migration; MAY NOT satisfy contracts, orchestration, verdict logic, recovery, budget/channel decisions, or trust evaluation. | `legacyPaths` removed for verdict-shaped fields. |
| **D5** | **Missing canonical → CONTRACT_INCOMPLETE.** Never silently substitute another field. The boundary helper returns `INCOMPLETE` and live reasoning is blocked. | `requireContractField` + `classifyTrust`. |

Reference implementation: `INTEGRITY_CONTRACT` in `server/orchestrator/contract-registry/registry.ts`. Proof suites: `server/tests/{integrity-contract,validation-contract,budget-action-contract,channel-decision-contract,agent-stream-semantic-separation,doctrine-regression}.test.ts`.

**Inline ESLint suppression policy:** every `eslint-disable[-next-line] semantic/no-semantic-fallback` MUST appear in the allowlist in the H1–H7 archive. New suppressions require (a) same-line justification comment, (b) allowlist entry in same PR, (c) architect review note. Current allowlist size: 4.

Canonical field names: `validationState` ∈ {validated|provisional|weak|rejected}, `decision.action` ∈ {test|scale|hold|halt}, `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory}, `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}, `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY}.

> **Full H1–H7 detail + Seal #9 closures + suppression allowlist + transitional exceptions:** [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md)

### Operational Continuity (Seal #13/Track #1 + Seal #14/Track #2)

**Doctrine: operational silence is a system failure category.** Originated from a May 2026 audit where the User Agent pipeline silently produced zero output for ~4 weeks because no scheduler invoked `runBoss()`.

| # | Invariant | Enforcement |
|---|---|---|
| **INVARIANT-RETRY** | Failed OR partial boss runs MUST NEVER be suppressed. | `SUCCESS_STATUSES = new Set(["completed"])` in `scheduler.ts`. `partial` and `failed` outcomes both DELETE the claim row via `releaseClaimForRetry()` so the next tick re-claims. Any change letting `partial`/`failed` short-circuit a window is a P0 defect. |
| **MULTI-REPLICA-SAFE** | Two scheduler instances MUST NOT both invoke runBoss for the same (campaign, plan, window). | DB-level claim handshake via `tryClaimWindow()` → `INSERT INTO continuity_window_claims ... ON CONFLICT DO NOTHING RETURNING`. |
| **CHAIN-STATE-EXPLICIT** | A chain that lacks introspection wiring MUST be classified UNKNOWN, never silently HEALTHY. | `classifyChainState({ introspectionAvailable: false })` returns `state: "UNKNOWN"`. |
| **NO-TENANT-LEAK** | Public `/healthz/continuity` MUST NOT expose per-tenant fields (campaignId, accountId, planId). | Admin-gated full report (timing-safe `METRICS_ADMIN_TOKEN` check) returns the unredacted health; public surface returns operational counters + per-chain state/lag only. |

`ChainState` = `HEALTHY | DEGRADED | DEAD | UNKNOWN`. Operator alerts: `supervisor.schedulerState !== "HEALTHY"` for ≥10min; `supervisor.chainsDead > 0`; `lastSupervisorTickAt` older than `intervalMs * 1.2`; `continuity_dead_cycles_total > 0`.

> **Track #1 implementation detail (hourly scheduler, idempotent invocation, long-gap re-anchor, missed-window detection, schema migration 021):** [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md)
> **Track #2 implementation detail (DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema migration 022):** [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md)

### Silent runtime-degradation hardening (Seal #15 / Track #3)

**Doctrine: a silent skip is a runtime degradation.** Every silent path is now either logged, watched, or explicitly documented as deferred. No "probably fine" verdicts.

Active rules:
- **No silent catches.** `} catch {}` and `.catch(() => {})` are forbidden. Use the file-local `_logSilentLoad` / `_noteAuditWriteFailure` helper pattern (or equivalent `console.error("[Component] EVENT_TAG ...")`) so the operator sees the failure even when the code path returns a UI-safe default.
- **No bare in-flight promises.** Any `Map<key, Promise>` or singleton `let inFlight: Promise | null` used as a concurrency lock MUST stamp each entry with `{ promise, startedAt, token }`, run a watchdog on entry that evicts entries older than a configured ceiling, AND token-check in the `.finally()` so a late-settling stale promise cannot delete a fresh successor entry.
- **No bare AI calls.** Every external AI/LLM call MUST race against a wall-clock timeout. OpenAI uses `AI_OPENAI_HARD_TIMEOUT_MS`, Gemini uses `AI_GEMINI_HARD_TIMEOUT_MS` (default 60s). Timeout throws `AICallError("AI_TIMEOUT")` so the outer `finally` releases per-account locks.
- **Every inline scheduler gets a stored timer handle.** Anonymous `setInterval`/`setTimeout` cascades inside boot closures are forbidden — the handle MUST be reachable from `gracefulShutdown` so SIGTERM clears it.

Operator-visible signals (steady-state expectation = 0 / absent; appearance is the alarm):
- `_bossInFlightStats().zombieEvictions` and `_continuityTickInflightStats().zombieEvictions`
- `agent_context_section_load_failed` (pino warn)
- `[MIv3] AUDIT_WRITE_FAILED`, `[Orchestrator] STUCK_JOB_UPDATE_FAILED`, `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` / `MARK_ENRICHING_FAILED` / `MARK_FAILED_AFTER_ERROR`

Env knobs: `BOSS_INFLIGHT_MAX_AGE_MS` (30min), `CONTINUITY_TICK_MAX_AGE_MS` (15min), `AI_GEMINI_HARD_TIMEOUT_MS` (60s).

Open follow-ups (tracked as Seal #16): F1 — `activeJobs` Map watchdog in `fetch-orchestrator.ts`; F2 — Gemini `Promise.race` does not abort the underlying SDK call (add `AbortController.signal`).

> **Full Seal #15 detail (9 closed findings table, 4 deferred items with rationale, architect race-fix amendment, 6 behavioral tests):** [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md)

---

## Required Replit Secrets (Seal #7 / F10.5)

The env validator (`server/env-validator.ts`) refuses to boot if any of the following is missing. Set these via Replit Secrets — never via `.replit` `[userenv.shared]` (history-leak risk; F9.7).

| Secret | Required | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | always | Postgres connection string. |
| `JWT_SECRET` | production (dev: warn) | Auth token signing key. Dev container falls back to a deterministic JWT_SECRET (logged at boot); production boot is REFUSED without an operator-set value. |
| `OPENAI_API_KEY` | always | OpenAI client. `AI_INTEGRATIONS_OPENAI_API_KEY` (set by the Replit OpenAI integration) is accepted as an alias. |
| `BRIGHT_DATA_PROXY_USERNAME` | always | Residential proxy auth (Instagram/TikTok/Web/Reviews scrapers). |
| `BRIGHT_DATA_PROXY_COUNTRY` | always | Proxy geo-targeting code. |
| `STRIPE_WEBHOOK_SECRET` | production (dev: warn) | Stripe signature verification on `/api/stripe/webhook`. Dev boot allowed without it (Stripe gated behind webhook signature check; routes fail-closed when secret unset). Production boot REFUSED without it. |
| `PUBLIC_BASE_URL` | always (dev derives) | Canonical absolute base URL injected into landing/pricing HTML in place of host-header trust (F9.1). In `NODE_ENV !== production` it auto-derives from `REPLIT_DEV_DOMAIN`. **Validated**: must be a syntactically-valid absolute URL; `https://` enforced in production; hostname must end with `.replit.app` / `.replit.dev` / `.replit.co` OR appear in `ALLOWED_PUBLIC_HOSTS`. |
| `ALLOWED_PUBLIC_HOSTS` | optional | Comma-separated list of additional hostnames whose suffix is accepted by the PUBLIC_BASE_URL validator. |
| `METRICS_ADMIN_TOKEN` | recommended | When set, gates `GET /metrics` and the unredacted `/healthz/continuity` view via `X-Admin-Token`. Absent → endpoints are closed (401 to all). |
| `SENTRY_DSN` | recommended | Server error reporting. Absent → Sentry shim is a no-op. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | recommended | Reserved for upstream OpenTelemetry adoption. |
| `JWT_LEGACY_CUTOFF_ISO` | optional | Operator override of the auto-persisted JWT legacy-grace cutoff (Seal #2 / F9.2). |
| `AI_RATE_LIMIT_PER_HOUR` | optional | Override of 50 calls/hr/account/route on AI generation routes. |
| `BOSS_INFLIGHT_MAX_AGE_MS` | optional | Boss in-flight zombie watchdog ceiling (default 30min). |
| `CONTINUITY_TICK_MAX_AGE_MS` | optional | Continuity scheduler in-flight tick watchdog ceiling (default 15min). |
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | Gemini wall-clock timeout (default 60s). |

## Observability (Seal #7 / F9.5, F10.4, F10.6, F10.7, F10.8)

- **`GET /healthz`** — unauthenticated liveness probe. Returns `{ ok: true, ts }`.
- **`GET /metrics`** — Prometheus text exposition. Admin-gated via `X-Admin-Token` against `METRICS_ADMIN_TOKEN`.
- **`GET /healthz/continuity`** — public operational health (no tenant fields); admin token reveals replicaId + per-tenant decision log.
- **Structured logger (`server/logger.ts`)** — pino-compatible JSON-line facade. Every request gets a `traceId` (AsyncLocalStorage via `server/trace-context.ts`). `stripSecrets()` redacts keys matching `/^(token|refresh.*token|access.*token|secret|api.*key|authorization|cookie|password|jwt)$/i` AND scans string values for inline `Bearer …`, `sk-…`, `eyJ…` patterns.
- **Sentry shim (`server/observability/sentry.ts`)** — dynamic-import wrapper; when `SENTRY_DSN` is unset, becomes a no-op. The global error handler captures all 5xx and masks `error.message` to `"Internal server error"` in production (response shape `{ error: code }` only).
- **Boot order** (`server/index.ts`): `validateEnv → initOTel → initSentry → ArtifactGuard → loggerMiddleware → /healthz → /metrics → /api → await runMigrations() → workers`.

## Migration runner (Seal #7 / F10.1, F10.10)

- `server/migrations/runner.ts` is the single migration entry point. Acquires `pg_advisory_lock(8675309)` (blocking, bounded by a 5-minute `Promise.race` timeout that aborts boot) to serialize across instances, applies pending SQL files from `server/migrations/sql/`, then runs the legacy `002–014` programmatic migrations in order. Records each step in `schema_migrations`.
- **`REQUIRED_SCHEMA_VERSION = 22`** — boot refuses to start if the database last-applied version is lower AND migration application fails.
- `npm run db:migrate` runs the runner standalone. `npm run db:generate` writes drizzle output to `server/migrations/sql/`.
- `noTransaction` marker (first line `-- noTransaction`) is honored: the runner splits the SQL into individual statements so `CREATE INDEX CONCURRENTLY` can execute outside a transaction.

## GDPR account deletion (Seal #7 / F9.9)

`server/account-lifecycle.ts` implements a two-phase, reversible-during-quarantine delete spanning **105 `accountId`-bearing tables**.

- **Phase 1 (immediate):** `DELETE /api/account` requires three things: a valid Bearer token, the literal header `X-Account-Delete-Confirm: PERMANENTLY_DELETE`, and the user's current password in the JSON body for fresh re-auth via `bcrypt.compare`. On success: masks PII on `users` immediately, inserts an `account_tombstones` row with `purgeAfter = now() + 30d`, writes audit entry to `audit_log_archive`.
- **Cancellation window:** `POST /api/account/delete-cancel` removes the tombstone any time before `purgeAfter` (PII mask is *not* reverted; user must contact support for restoration).
- **Phase 2 (reaper):** `runTombstoneReaper()` runs daily (initial 60s after boot, 24h tick). For each expired tombstone, `cascadeDeleteAccount()` deletes from all 105 tables inside a single PG transaction — any error rolls back the whole account.
- **`CASCADE_EXEMPT`:** `audit_log_archive`, `account_tombstones`, `schema_migrations`, `auth_lockouts`, `messages`.
- Doctrine: no fallback coalescing, no silent failure modes — every error logged with `traceId` and surfaced to Sentry when configured.

## Marketing-logic engine upgrade (Apr 2026)

The 5 marketing engines were upgraded to reason like top marketers (not just relabel segments). Pipeline orchestration unchanged; outputs extended additively.

Per-engine commercial-reasoning module (designer + LLM judge + 1 retry on REJECTED + safe `null` fallback to legacy output):
- P1 Persuasion → `server/persuasion-engine/trust-transfer.ts` (`designTrustTransfer`)
- P2 Positioning → `server/positioning-engine/category-game.ts` (`designCategoryGame`)
- P3 Offer → `server/offer-engine/value-architect.ts` (`designValueArchitecture`)
- P4 Audience → `server/audience-engine/buyer-psychology.ts` (`profileBuyerPsychology`)
- P5 Awareness → `server/awareness-engine/narrative-reframe.ts` (`engineerNarrativeReframe`)

Shared cross-engine commercial DNA:
- `shared/commercial-dna.ts` — `composeCommercialDNA()` + `summarizeCommercialDNA()` + contradiction detector (`IDENTITY_DRIFT`, `GAME_TRUST_MISMATCH`)
- `server/orchestrator/shared-strategic-context.ts` — new `commercialSignals` registry (5 signal types)
- `server/orchestrator/index.ts` — emits 5 SSC commercial signals + composes DNA into final return

Validation: `.local/validation/marketing-logic-upgrade-proof.{ts,md,json}` proves 12/12 cascade signals shift across L1 Audience → L2 Awareness → L3 Offer → L4 DNA when only buyer evidence varies; contradiction detector fires on synthetic mis-stitched DNA; empty signal set composes safely.

If the AI judge returns final REJECTED in any module, the module returns `null` and the engine continues with its legacy output — pipeline never breaks.

---

## Seal archive index

Each per-seal file contains the full implementation detail, code references, test pointers, and historical justification. The `replit.md` rules above are the authoritative live doctrine; the archive files are read-only history.

- [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md) — D1–D5 detail, Seal #9 closures, suppression allowlist, transitional exceptions, canonical field names.
- [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md) — Hourly scheduler, idempotent invocation, long-gap re-anchor, missed-window detection, schema migration 021.
- [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md) — DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema migration 022.
- [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md) — 9 closed silent-degradation findings, 4 deferred items, architect race-fix amendment, 6 behavioral tests.
- `.local/docs/seal-13-to-17-plan.md` — original Tracks #1–#7 design plan (pre-existing).
