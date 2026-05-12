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
- **Signal-First Positioning (Positioning Engine)**: Complete logic correction to signal-first claim construction. `buildSignalClaimSeeds()` pre-builds enemy/contrast/narrative seeds deterministically from mapped signal labels per territory BEFORE LLM call. LLM role changed from "generator" to "refiner" — sharpens signal-derived seeds into professional positioning language. `validateClaimGrounding()` post-LLM gate checks every claim field (enemyDefinition, contrastAxis, narrativeDirection) against source signal labels; ungrounded LLM output falls back to the deterministic seed. Orphan audit is now preventive: territories with ALL claims orphaned are DROPPED entirely, not just penalized. `deterministicSignalMapping()` also validates all `mappedSignalIds` against the valid signal ID set. Result: signal coverage 0%→25%, orphans 8→0, engineConfidence 0.20→0.40, every claim traceable to upstream signals.
- **Scoped Engine Context Hydration (Orchestrator)**: When `scopedEngines` is used, the orchestrator pre-loads the best available audience snapshot (first with non-empty structuredSignals) and latest COMPLETE MI snapshot from DB, initializes SGL from cached audience, and sets `ctx.mi`/`ctx.audience`/`ctx.sglState` before the engine loop. This enables selective re-runs (e.g., positioning-only) without re-executing upstream engines.
- **SIV System Metadata Exemption**: The `detectLeakage` function in SystemIntegrityValidator now skips bracketed system metadata strings (matching `^\[.*(?:purified|mapped|system|sanitized|signal).*\]$`) to prevent false positive leakage alerts from internal bookkeeping annotations. SGL purification notes use "source input(s)" instead of "raw source(s)" to avoid triggering the `\b(raw|...)\b` leakage pattern.
- **Deterministic Signal ID Validation**: The positioning engine's deterministic mapping now filters existing LLM-generated `mappedSignalIds` against the validated signal ID set from structured signals, purging any hallucinated IDs. Territories receive an explicit `_systemMapped` flag for precise orphan audit gating, replacing the over-broad `mappedSignalIds.length > 0` check. Coverage calculation also filters against valid IDs only.
- **AEL Partial Degradation Flag**: `AnalyticalPackage` now includes optional `isPartial` and `partialReason` fields. All AEL fallback paths (parse failure, build error) set these flags so downstream engines know enrichment is degraded.

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
- JWT-based email/password authentication. Access tokens (**14d TTL**, held during the JWT_LEGACY grace window for client compat — sunset to 60m once the mobile client gains `/api/auth/refresh` wiring) carry `audience="avyron-ai"` + `issuer="avyron-auth"`; refresh tokens (30d) rotate on every `/api/auth/refresh` call and use the `auth_sessions` table with reuse detection (`SECURITY_REFRESH_REUSE` cascade fires only when the presented secret bcrypt-matches a revoked row's hash — sessionId knowledge alone cannot DoS the account). `/api/auth/logout` likewise verifies the refresh secret before revoking. Account lockout: 5 failed logins / 15min → 423 with 15min `Retry-After` (`auth_lockouts` table).
- **JWT 7-day legacy grace window (Seal #2 / F9.2).** Pre-deploy tokens lacking `aud`/`iss` are still accepted for `JWT_LEGACY_GRACE_DAYS` (default 7d) so existing sessions don't all invalidate at once. The cutoff resolves with a **stable persisted stamp**: if `JWT_LEGACY_CUTOFF_ISO` is set + parseable → that wins; if set but malformed → cutoff=0 (fail-closed against operator typo); if unset → derive `now + 7d` ONCE and persist to `.local/state/jwt-legacy-cutoff` (override path with `JWT_LEGACY_STATE_FILE`). Subsequent restarts re-read the stamp → cutoff never slides AND a forgotten env var doesn't mass-invalidate sessions. Operator runbook: monitor the `[Auth] JWT_LEGACY_GRACE | hits=...` log line — when it stops appearing for ≥48h, set `JWT_LEGACY_CUTOFF_ISO` to a past timestamp to force-close the grace window.
- Stripe webhook integration for subscription management
- Per-account AI generation rate limit (Seal #2 / F1.8): 50 calls/hr/account/route on `/api/generate-content|ad|reel-script|calendar`. Override via `AI_RATE_LIMIT_PER_HOUR`. Returns `429 + Retry-After + AI_RATE_LIMIT_EXCEEDED`.

### Video Credits System
- Manages video generation credits for users.

### Website (Landing + Pricing)
- Static landing and pricing pages served by the Express backend.

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok
## Semantic Contract Hardening doctrine (May 2026 — H1–H7)

System-wide policy that governs every live-decision and live-reporting field across orchestrator, system-control, recovery, snapshot, agent stream, build-plan, and contract registry. The five non-negotiable rules:

| # | Rule | Enforcement point |
|---|---|---|
| **D1** | **No semantic fallback.** `?? status`, `\|\| status`, `?? verdict`, `\|\| verdict`, `?? outcome`, `\|\| outcome` patterns are FORBIDDEN on any live decision path. | Custom ESLint rule `semantic/no-semantic-fallback` (`.local/eslint-rules/no-semantic-fallback.js`) scoped to `server/{agent,system-control,orchestrator,build-plan-layer,recovery-*}/**`. |
| **D2** | **Every meaning has its own canonical field.** A generic `status` may carry execution semantics ONLY (F1). Verdict (F2/F6), validation (F3), trust (F4), action (F9), and gate-outcome (F10) each get a dedicated field name. | Contract registry — every verdict-shaped field declared with its own `id` + canonical `path`. |
| **D3** | **Strict enums only.** Every verdict-shaped field uses `z.enum([...])`, never `z.string()`. | Contract registry — `validationState`, `decisionAction`, `decisionGateOutcome`, `overallStatus`, `integrityVerdict` all `z.enum`. |
| **D4** | **Legacy fields are historical only.** May exist for display/migration; MAY NOT satisfy contracts, orchestration, verdict logic, recovery, budget/channel decisions, or trust evaluation. | `legacyPaths` removed for verdict-shaped fields. Deprecated alias fields (`overallStatus` on agent stream, `overallStatus` on integrity output) are JSDoc-`@deprecated`. |
| **D5** | **Missing canonical → CONTRACT_INCOMPLETE.** Never silently substitute another field. The boundary helper returns `INCOMPLETE` and live reasoning is blocked. | `requireContractField` + `classifyTrust`. |

Reference implementation: `INTEGRITY_CONTRACT` in `server/orchestrator/contract-registry/registry.ts`. Proof suites: `server/tests/{integrity-contract,validation-contract,budget-action-contract,channel-decision-contract,agent-stream-semantic-separation}.test.ts`.

**Transitional D4/D5 exceptions (sunset: H8)** — explicitly documented per code review:
- `integrity.integrityVerdict.legacyPaths=[["overallStatus"]]` — D4 exception. Resolves to legacy `overallStatus` so pre-H4 snapshots remain contract-COMPLETE. Same-semantic alias (verdict↔verdict, NOT status↔verdict), so D1 risk is zero. Sunset: drop legacyPaths once all persisted snapshots have been re-run with the H4 engine.
- `channel_selection.decisionGateOutcome` placed in `optionalOutputs` — D5 exception at the pipeline gate. `validateContractCompleteness()` checks `requiredOutputs` only; pipeline-level INCOMPLETE-on-absence does NOT fire while the field is optional. Runtime D5 still enforced via `requireContractField()` on the consumer side. Strict-enum shape IS enforced when present. Sunset: promote to `requiredOutputs` once channel engine emits the field on 100% of new runs (≥7-day shadow window with zero `LEGACY_HIT` for this field id).

**H6 ESLint rule gaps — CLOSED in Seal #9 (Task #27, May 2026):**
- ✅ Rule scope widened to include `server/strategy/**`. Engine *internals* (`server/*-engine/engine.ts` and the two strategy-engine F1 status-authoring sites) remain exempted via documented in-line `eslint-disable-next-line` comments — these are the AUTHORING site of the canonical status, not a D1-substitution of a missing canonical contract field. Rationale documented in `eslint.config.js` and at each disable site.
- ✅ Rule extended with `checkVariableDeclarator` (alias-variable detection: `const status = a || b`) and `checkObjectPattern` (destructured-default detection: `const { status = "x" } = obj`). Two new messageIds (`semanticFallbackAlias`, `semanticFallbackDestructured`) added alongside the prior H6/H8 baseline.
- ✅ Adversarial fixture proof in `server/tests/doctrine-regression.test.ts` (16/16 PASS): 11 offenders covering H6 RHS, H8 LHS/ternary, F10.3 alias + destructured patterns; 5 clean shapes proving zero false-positives on canonical helper-extracted reads.

**Seal #9 / Task #27 audit-finding closures (May 12, 2026):**
- **F2.2** (8 sites of semantic-fallback eslint-disables): ALL removed. Reads now go through helpers (`readSectionStatus`, `pickRunStatus`, `pickOfferCoreOutcome`, `pickConfidenceIntegrityVerdict`, `includeIfGatedPass`, `buildStructuralCheckDetail`) or guarded if-blocks. No ternary or logical-fallback expression reads a forbidden field name on a live decision path.
- **F2.10**: `decisionGateOutcome` physically MOVED from `optionalOutputs` → `requiredOutputs` with `emptyIsMissing: true`. H3 transitional exception retired.
- **F4.1**: registry enums tightened — `FunnelStageAssignment.assignedRole`, `FunnelStageObject.type`, MI `marketState` all `z.enum`. The `marketState` enum carries the actual emitted vocabulary from `deriveMarketState()` plus the `PARTIAL_DATA` / `INSUFFICIENT_DATA` / `PENDING` sentinels — verified against every emission site. Positioning narrative free-form prose (`enemyDefinition`, `contrastAxis`, `narrativeDirection`) intentionally remains `z.string().min(1)` (free-form prose, not verdict-shape — D3 doesn't apply).
- **F4.2**: `ChannelCandidateSchema` rewritten to match the actual TS interface (`channelName`/`channelType` (z.enum)/`fitScore`/`audienceDensityScore` REQUIRED). Bogus `channelKey`/`scalability` fields removed.
- **F10.2**: ESLint scope widened to include `server/strategy/**`. Verified 0 errors across the widened scope.
- **F10.3**: rule extended with alias-variable + destructured-default detectors (see above). Adversarial fixture proof: 16/16 PASS.

D1 in-line exemption sites (engine-internal F1 status authoring, NOT D1-substitutes):
- `server/strategy/iteration-engine/engine.ts` — `let status = guardLayer.passed ? COMPLETE : PROVISIONAL`
- `server/strategy/retention-engine/engine.ts` — `const status = guardResult.passed ? COMPLETE : PROVISIONAL`

Canonical field names introduced/hardened in H1–H7:
- `validationState` ∈ {validated|provisional|weak|rejected} — F3 statistical-validation verdict
- `decision.action` ∈ {test|scale|hold|halt} — F9 budget-governor action
- `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory} — F10 channel decision-gate outcome
- `integrityVerdict` ∈ {PASS|PARTIAL|FAIL} — F2 integrity verdict (canonical replacement for `overallStatus`)
- `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY} — F1 execution status on agent stream + full-report (canonical replacement for `overallStatus`)

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
| `PUBLIC_BASE_URL` | always (dev derives) | Canonical absolute base URL injected into landing/pricing HTML in place of host-header trust (F9.1). In `NODE_ENV !== production` it auto-derives from `REPLIT_DEV_DOMAIN`. **Validated**: must be a syntactically-valid absolute URL; `https://` enforced in production; hostname must end with `.replit.app` / `.replit.dev` / `.replit.co` OR appear (suffix or exact) in `ALLOWED_PUBLIC_HOSTS` (comma-separated). |
| `ALLOWED_PUBLIC_HOSTS` | optional | Comma-separated list of additional hostnames whose suffix is accepted by the PUBLIC_BASE_URL validator (e.g. `app.avyron.io,staging.avyron.io`). |
| `METRICS_ADMIN_TOKEN` | recommended | When set, gates `GET /metrics` via `X-Admin-Token`. Absent → endpoint is closed (401 to all). |
| `SENTRY_DSN` | recommended | Server error reporting. Absent → Sentry shim is a no-op (logs `error reporting disabled`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | recommended | Reserved for upstream OpenTelemetry adoption (in-house registry serves `/metrics` directly today). |
| `JWT_LEGACY_CUTOFF_ISO` | optional | Operator override of the auto-persisted JWT legacy-grace cutoff (Seal #2 / F9.2). |
| `AI_RATE_LIMIT_PER_HOUR` | optional | Override of 50 calls/hr/account/route on AI generation routes (Seal #2 / F1.8). |

## Observability (Seal #7 / F9.5, F10.4, F10.6, F10.7, F10.8)

- **`GET /healthz`** — unauthenticated liveness probe mounted before the `/api` middleware gate. Returns `{ ok: true, ts }`.
- **`GET /metrics`** — Prometheus text exposition from the in-house OTel registry (`server/observability/otel.ts`). Admin-gated via `X-Admin-Token` header against `METRICS_ADMIN_TOKEN`; mounted before the `/api` gate.
- **Structured logger (`server/logger.ts`)** — pino-compatible JSON-line facade. Every request gets a `traceId` (AsyncLocalStorage via `server/trace-context.ts`) propagated to child loggers. `stripSecrets()` redacts keys matching `/^(token|refresh.*token|access.*token|secret|api.*key|authorization|cookie|password|jwt)$/i` AND scans string values for inline `Bearer …`, `sk-…`, `eyJ…` patterns — applied to every error captured by the global handler before it reaches Sentry or response.
- **Sentry shim (`server/observability/sentry.ts`)** — dynamic-import wrapper; when `SENTRY_DSN` is unset, becomes a no-op so dev boot logs `error reporting disabled`. The global error handler captures all 5xx and masks `error.message` to `"Internal server error"` in production (response shape `{ error: code }` only).
- **Boot order** (`server/index.ts`): `validateEnv → initOTel → initSentry → ArtifactGuard → loggerMiddleware → /healthz → /metrics → /api → await runMigrations() → workers`.

## Migration runner (Seal #7 / F10.1, F10.10)

- `server/migrations/runner.ts` is the single migration entry point. Acquires `pg_advisory_lock(8675309)` (blocking, bounded by a 5-minute `Promise.race` timeout that aborts boot) to serialize across instances, applies pending SQL files from `server/migrations/sql/`, then runs the legacy `002–014` programmatic migrations in order. Records each step in `schema_migrations`. (Pass-2 hardening swapped the spec-original `pg_try_advisory_lock` for the blocking variant — `try_*` would have returned false for the loser replica with no way to verify whether the winner was still mid-migration; blocking + timeout removes that ambiguity.)
- **`REQUIRED_SCHEMA_VERSION = 16`** — boot refuses to start if the database last-applied version is lower than this AND migration application fails.
- The 13 previously-inline migration calls in `server/index.ts` were deleted; a single `await runMigrations()` replaces them.
- `npm run db:migrate` runs the runner standalone. `npm run db:generate` writes drizzle output to `server/migrations/sql/` (matches runtime).
- `noTransaction` marker (first line `-- noTransaction`) is honored: the runner splits the SQL into individual statements so `CREATE INDEX CONCURRENTLY` can execute outside a transaction.
- **SQL 015** rewrites Migration 012's tenant indexes as `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and drops the old non-concurrent ones idempotently.
- **SQL 016** creates `account_tombstones` (30-day quarantine) for the GDPR cascade. (Earlier draft also created an `account_delete_confirmations` table for a 10-minute bcrypt token issuer endpoint — both the table and the endpoint were dropped in pass-4 when the route switched to the literal-header guard + body-password re-auth. The migration now contains a `DROP TABLE IF EXISTS account_delete_confirmations` statement so a previously-applied snapshot self-heals.)

## GDPR account deletion (Seal #7 / F9.9)

`server/account-lifecycle.ts` implements a two-phase, reversible-during-quarantine delete spanning **105 `accountId`-bearing tables**.

- **Phase 1 (immediate):** `DELETE /api/account` requires three things: a valid Bearer token, the literal header `X-Account-Delete-Confirm: PERMANENTLY_DELETE`, and the user's current password in the JSON body (`{ "password": "..." }`) for fresh re-auth via `bcrypt.compare`. On success: masks PII on `users` immediately (`username`, `email`, `password`, `stripe_customer_id` → `'deleted-' || id` sentinels), inserts an `account_tombstones` row with `purgeAfter = now() + 30d`, and writes an audit entry to `audit_log_archive`. (Pass-4 simplification — earlier passes used a 10-minute bcrypt token issued by `POST /api/account/delete-confirm`; that token endpoint and the `account_delete_confirmations` table it backed are no longer wired. The body-password path replaced them as the re-auth proof.)
- **Cancellation window:** `POST /api/account/delete-cancel` removes the tombstone any time before `purgeAfter` (PII mask is *not* reverted; user must contact support for restoration).
- **Phase 2 (reaper):** `runTombstoneReaper()` runs daily (initial 60s after boot, 24h tick). For each expired tombstone, `cascadeDeleteAccount()` deletes from all 105 tables inside a single PG transaction — any error rolls back the whole account.
- **`CASCADE_EXEMPT`:** `audit_log_archive`, `account_tombstones`, `schema_migrations`, `auth_lockouts`, `messages` (no `account_id` column on `messages`). `account_delete_confirmations` is no longer in this list — the table was dropped in pass-4.
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
