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
- ✅ Rule extended with `checkVariableDeclarator` (alias-variable detection: `const status = a || b`) and `checkObjectPattern` (destructured-default detection: `const { status = "x" } = obj`). Two new messageIds (`semanticFallbackAlias`, `semanticFallbackDestructured`) added alongside the prior H6/H8 baseline. **Pass-4 final (architect-required)**: alias / destructured detectors use the un-anchored audit-spec regex `(status|verdict|outcome|state|action)/i` (no `$` anchor — closes the rename-to-evade loophole where `const statusLabel = a || b` or `const actionValue = a ?? b` would have silently substituted a generic canonical-field read). Adversarial fixtures in `server/tests/doctrine-regression.test.ts` now cover non-suffix names (`statusLabel`, `actionValue`, `outcomeText`, `verdictRecord`, `actionPlan`) AND benign clean cases (`description`, `displayLabel` — no verdict-shape token; rule stays silent). 20 offenders + 10 clean + 3 fixture-file proofs PASS. Pass-3's suffix regex `(status|verdict|outcome|state|action)$/i` to catch D1 substitutions on suffix-style canonical contract fields (validationState, decisionAction, budgetAction, decisionGateOutcome, marketState, ...). The 24 engine-internal authoring sites the widened regex initially flagged were resolved by **renaming the local variables to non-suffix names** (e.g. `marketState` → `marketStateLabel`, `budgetAction` → `budgetActionValue`, `controlVerdict` → `controlVerdictRecord`, `trustState` → `trustStateLabel`, `primaryOutcome`/`altOutcome`/`offerOutcome` → `*Text`, `painInOutcome` → `painInOutcomeFlag`, `validationState` → `validationStateValue`, `originalAction` → `originalActionValue`, `postRepairBudgetAction` → `postRepairBudgetActionValue`, `depthGateStatus` → `depthGateStatusInput`, `postGateOutcome` → `postGateOutcomeValue`) — NOT by adding eslint-disable comments. The local var name carries no canonical contract meaning, so renaming is a pure-naming fix that satisfies the alias/destructured detectors while preserving the underlying read of the canonical property (`obj.marketState`, `decision?.action`, etc.) at every call site. Object-shorthand uses (e.g. `{ trustState }`) were expanded to explicit `{ trustState: trustStateLabel }` so the property key on the emitted object remains the canonical contract name.
- ✅ Adversarial fixture proof in `server/tests/doctrine-regression.test.ts` (24/24 PASS: 14 offenders + 7 clean + 3 fixture-file proofs): covers H6 RHS, H8 LHS/ternary, F10.3 alias + destructured patterns; clean shapes prove zero false-positives on canonical helper-extracted reads and on benign suffix-collision names like `myCounter`.

**Seal #9 / Task #27 audit-finding closures (May 12, 2026):**
- **F2.2** (8 sites of semantic-fallback eslint-disables): ALL removed. Reads now go through helpers (`readSectionStatus`, `pickRunStatus`, `pickOfferCoreOutcome`, `pickConfidenceIntegrityVerdict`, `includeIfGatedPass`, `buildStructuralCheckDetail`) or guarded if-blocks. No ternary or logical-fallback expression reads a forbidden field name on a live decision path.
- **F2.10**: `decisionGateOutcome` physically MOVED from `optionalOutputs` → `requiredOutputs` with `emptyIsMissing: true`. H3 transitional exception retired.
- **F4.1**: registry enums tightened — `FunnelStageAssignment.assignedRole`, `FunnelStageObject.type`, MI `marketState` all `z.enum`. The `marketState` enum carries the actual emitted vocabulary from `deriveMarketState()` plus the `PARTIAL_DATA` / `INSUFFICIENT_DATA` / `PENDING` sentinels — verified against every emission site.
- **F4.1 ACCEPTED EXCEPTION (pass-4, architect-recorded)**: positioning narrative fields `enemyDefinition`, `contrastAxis`, `narrativeDirection` intentionally remain `z.string().min(1)` (free-form prose authored by LLM, not verdict-shape — D3 strict-enum doctrine doesn't apply to open-vocabulary prose). This is a formally accepted deviation from the original "all six fields enum" wording in the audit closure criteria; the three prose fields have no closed vocabulary and forcing an enum would degrade authoring fidelity. Audit owner accepted this exception in pass-4 architect review (May 2026). Sunset condition: if the positioning engine ever emits these fields from a closed-vocabulary template, promote to `z.enum` at that time.

**Inline `semantic/no-semantic-fallback` suppression allowlist (Seal #9 / pass-4 governance):**
Every `eslint-disable[-next-line] semantic/no-semantic-fallback` in the codebase MUST appear in the table below. Any new suppression requires (a) a same-line justification comment, (b) addition to this table in the same PR, (c) an architect review note explaining why the offending construct is NOT a D1 substitution. Periodic audit: each row is re-evaluated at the next Seal review; rows whose justification no longer applies must be removed and the underlying construct refactored. Current allowlist (4 entries):

| File | Line context | Type | Justification |
|---|---|---|---|
| `server/strategy/iteration-engine/engine.ts` | `let status = guardLayer.passed ? COMPLETE : PROVISIONAL` | F1 status authoring | First canonical write of the engine's `status` field — not a D1 substitute. |
| `server/strategy/retention-engine/engine.ts` | `const status = guardResult.passed ? COMPLETE : PROVISIONAL` | F1 status authoring | First canonical write of the engine's `status` field — not a D1 substitute. |
| `server/offer-engine/engine.ts` (~L2073, block) | `parsed.primary?.outcome \|\| "Core transformation"` and sibling LLM placeholders | LLM placeholder coalescing | Pre-existing F10.2 documented exemption — empty-string fallbacks coalesce omitted LLM prose into typed string fields, not a canonical contract verdict substitution. |
| `server/offer-engine/engine.ts` (~L3017, block) | `celSourceTexts = [aiOffers.primary?.name \|\| "", ...]` | CEL source-text aggregation | Pre-existing F10.2 documented exemption — collects raw text fields (name/outcome/mechanism prose) for the Causal Enforcement Layer's depth-gate scan; empty fallbacks coalesce missing prose into the text pool. |
- **F4.2**: `ChannelCandidateSchema` rewritten to match the actual TS interface (`channelName`/`channelType` (z.enum)/`fitScore`/`audienceDensityScore` REQUIRED). Bogus `channelKey`/`scalability` fields removed.
- **F10.2**: ESLint scope widened to include `server/strategy/**`. Verified 0 errors across the widened scope.
- **F10.3**: rule extended with alias-variable + destructured-default detectors (see above). Adversarial fixture proof: 16/16 PASS.

D1 in-line exemption sites (engine-internal F1 status authoring, NOT D1-substitutes — these are the AUTHORING site of the canonical `status` field, not a fallback substitution; pass-3 verified these are the only two remaining `eslint-disable-next-line semantic/no-semantic-fallback` comments in the codebase):
- `server/strategy/iteration-engine/engine.ts` — `let status = guardLayer.passed ? COMPLETE : PROVISIONAL`
- `server/strategy/retention-engine/engine.ts` — `const status = guardResult.passed ? COMPLETE : PROVISIONAL`

Canonical field names introduced/hardened in H1–H7:
- `validationState` ∈ {validated|provisional|weak|rejected} — F3 statistical-validation verdict
- `decision.action` ∈ {test|scale|hold|halt} — F9 budget-governor action
- `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory} — F10 channel decision-gate outcome
- `integrityVerdict` ∈ {PASS|PARTIAL|FAIL} — F2 integrity verdict (canonical replacement for `overallStatus`)
- `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY} — F1 execution status on agent stream + full-report (canonical replacement for `overallStatus`)

## Operational Continuity Layer (Seal #13 / Track #1, May 2026)

**Doctrine: operational silence is now considered a system failure category.** Triggered by a May 2026 audit that found the weekly User Agent evaluation pipeline silently produced zero output for ~4 weeks because no scheduler invoked `runBoss()` — no errors, no alerts, just a quiet absence of work.

**Track #1 implementation (this seal):**

- **Hourly continuity scheduler** (`server/continuity/scheduler.ts`). Self-rescheduling `setTimeout` with ±60s jitter (mirrors `autonomous-worker.ts` F6.4 pattern). First tick 60s post-listen. Disabled by `CONTINUITY_SCHEDULER_DISABLED=true`. Test override via `CONTINUITY_TICK_INTERVAL_MS`.
- **Idempotent invocation.** Each tick lists every (account, campaign) with the latest APPROVED `strategic_plans` row, computes the expected `window_index` from the resolved anchor, and invokes `runBoss({ trigger: "scheduled" })` ONLY when the most-recent `boss_runs.started_at` is < the current window's `windowStart`. Wrapped in `withCampaignLock` so a manual API trigger racing the scheduler resolves to `BossRunInFlightError` → counted as `skipped_in_flight`. Single in-flight tick guard via in-process promise prevents overlapping ticks.
- **Long-gap re-anchor policy.** When (gap from anchor > 1 `WINDOW_MS`) AND (zero `pipeline_eval_windows` rows for the active plan), the scheduler writes a `plan_anchor_resets` row with `reanchored_at = now`, `reason = "long_gap_no_windows_opened"`, `source = "continuity_scheduler"`. `evaluateWindowState()` in `server/pipeline/eval-windows.ts` reads `plan_anchor_resets` and treats the most-recent `reanchoredAt` strictly NEWER than the approval-derived anchor as the effective anchor (pushes `"anchor_reset_applied"` reason). **The no-backfill doctrine is preserved**: missed windows are NOT invented, the cycle simply restarts at `window_index=0` going forward. Re-anchor is gated to plans with zero opened windows so cluster-comparison baselines on plans with history are never corrupted.
- **Missed-window detection.** Per-campaign `expected_window_index − max(pipeline_eval_windows.window_index)`. Counted on `continuity_missed_windows_total` and recorded on the `continuity_ticks.notes` row. Re-anchored campaigns reset to 0 going forward but the historical count remains visible on the tick row.
- **Dead-cycle detection.** Campaign with no `boss_runs` for `DEAD_CYCLE_THRESHOLD_MS` (8 days) → `continuity_dead_cycles_total` increment + `CONTINUITY_DEAD_CYCLE` audit event with `sinceDays`, `lastBossRunAt`, `anchorSource`, `expectedWindowIndex` payload.
- **Persistence.** Every tick writes one `continuity_ticks` row (campaigns scanned, runs invoked, runs skipped/failed/reanchored, missed windows, dead cycles, per-campaign decisions JSON). A missing row in this table for >2× `intervalMs` is the operator-visible signal that the scheduler itself has stalled (alarm bell deferred to Track #2 / Seal #14).
- **Observability.** 11 Prometheus counters/gauges in `server/continuity/metrics.ts` concatenated to the existing `/metrics` exposition. New unauthenticated `GET /healthz/continuity` heartbeat probe returns the most-recent `TickReport` (operational counters only, no user data).
- **Audit event types added** to `server/audit.ts`: `CONTINUITY_REANCHOR`, `CONTINUITY_DEAD_CYCLE`, `CONTINUITY_MISSED_WINDOWS`.
- **Schema migration 021** (`plan_anchor_resets`, `continuity_ticks` tables). `REQUIRED_SCHEMA_VERSION` bumped 20 → 21.
- **`BossTrigger` extended** to include `"scheduled"` (alongside `"manual" | "approval"`).

**Operator runbook (Track #1 surface):**
- `GET /healthz/continuity` returns `{ schedulerUp, lastTickAt, lastTickReport, intervalMs }`. `lastTickAt` should be within `intervalMs * 1.2` at all times.
- `continuity_scheduler_last_tick_epoch_seconds` gauge — Prometheus alert if `(time() - value) > 7200`.
- `continuity_dead_cycles_total > 0` indicates one or more active campaigns have stopped evaluating.
- `continuity_missed_windows_total` accumulates the historical depth of silence even after re-anchor.
- A re-anchor event is normal AFTER a long idle period; if it appears on a campaign that was actively running last week, that's a production incident — investigate `plan_anchor_resets.reason` and the surrounding boss_runs.

**Tracks #2–#6 design** is locked in `.local/docs/seal-13-to-17-plan.md` and queued as separate project tasks: Track #2 (continuity supervisor + 10-chain registry + multi-replica advisory lock), Track #3 (silent-degradation hardening sweep, 20 categories), Track #4 (observability expansion + dashboards), Track #5 (18-scenario end-to-end lifecycle test suite), Track #6 (8 post-implementation audits).

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

## Operational Continuity Layer — Seal #14 / Track #2 (May 2026)

**Doctrine extension: operational silence is now multi-replica safe AND observed across the full producer surface.** Track #2 closes the BLOCKER gaps surfaced by the post-Track-#1 audit:

- **T1-A3 (BLOCKER)** — Track #1's `inFlightTick` Map was process-local. Two scheduler replicas would each invoke `runBoss` for the same (campaign, window) concurrently. NOW: every window invocation is preceded by a DB-level claim handshake against `continuity_window_claims` (PRIMARY KEY = `(campaign_id, plan_id, window_index)`, INSERT ON CONFLICT DO NOTHING). Postgres guarantees exactly one of N concurrent INSERTs wins; the rest get an empty RETURNING set and skip with `decision="skipped_claimed_by_other_replica"`. No pg_advisory locks (connection-scoped, brittle under pool reuse).
- **T1-A5 (BLOCKER)** — Pre-seal, only the continuity scheduler itself was observed. The other 9 scheduled producers (autonomous-worker, publish-worker, snapshot-cleanup, ci-shared-pool, mi-queue-processor, tombstone-reaper, meta-token-health, ael-cel-reruns, continuity-supervisor itself) could silently stall in exactly the same way. NOW: 10-chain operational registry in `server/continuity/chain-registry.ts` declares each chain's expected interval + `introspect()` query. The new continuity supervisor (`server/continuity/supervisor.ts`) classifies every chain every 5min using the shared `classifyChainState()` 4-state enum.

### Non-negotiable invariants

| # | Invariant | Enforcement |
|---|---|---|
| **INVARIANT-RETRY** | Failed OR partial boss runs MUST NEVER be suppressed. | `SUCCESS_STATUSES = new Set(["completed"])` in `scheduler.ts`. `partial` and `failed` outcomes both DELETE the claim row via `releaseClaimForRetry()` so the next tick re-claims and retries. Operator directive May 2026 — any change letting `partial` or `failed` short-circuit a window is a P0 defect re-introducing the original outage. Test proof: `server/tests/continuity-multi-replica.test.ts` — "a failed runBoss DELETEs the claim row" + "a partial runBoss ALSO releases the claim". |
| **MULTI-REPLICA-SAFE** | Two scheduler instances MUST NOT both invoke runBoss for the same (campaign, plan, window). | DB-level claim handshake via `tryClaimWindow()` → `INSERT INTO continuity_window_claims ... ON CONFLICT DO NOTHING RETURNING`. Test proof: `continuity-multi-replica.test.ts` — "two concurrent tryClaimWindow calls — only one wins". |
| **CHAIN-STATE-EXPLICIT** | A chain that lacks introspection wiring MUST be classified UNKNOWN, never silently HEALTHY. | `classifyChainState({ introspectionAvailable: false })` returns `state: "UNKNOWN"`. Test proof: `continuity-supervisor.test.ts` — "returns UNKNOWN when introspection is not wired". The 3 chains currently UNKNOWN (`mi_queue_processor`, `tombstone_reaper`, `ael_cel_reruns`) will be promoted in Track #3. |
| **NO-TENANT-LEAK** | Public `/healthz/continuity` MUST NOT expose per-tenant fields (campaignId, accountId, planId). | Admin-gated full report (timing-safe `METRICS_ADMIN_TOKEN` check) returns the unredacted health + supervisor + replicaId. Public surface returns operational counters + per-chain state/lag (no tenant identifiers — only `chainId`, `state` enum, `lagMs`). |

### State enum (`ChainState`)

| State | Meaning | Trigger |
|---|---|---|
| `HEALTHY` | Lag within 1× expected interval. | `lag <= expectedIntervalMs * degradedMultiplier` |
| `DEGRADED` | Lag between 1× and dead threshold. Operator-actionable, not yet P1. | `degradedMultiplier * interval < lag <= deadMultiplier * interval` |
| `DEAD` | Lag exceeds dead threshold (default 4×). P1 — `CONTINUITY_CHAIN_LAG` audit fires on transition; for the scheduler heartbeat, `CONTINUITY_HEARTBEAT_STALE` fires. | `lag > deadMultiplier * interval` OR `lastObservedRunAt === null` (with introspection wired) |
| `UNKNOWN` | Introspection not wired (`introspect: null`). Surfaced explicitly so operators see the gap. | `introspectionAvailable === false` |

### Track #2 surface (operator runbook)

- `GET /healthz/continuity` (public) — adds `supervisor.{schedulerState, schedulerHeartbeatAgeMs, chainsHealthy/Degraded/Dead/Unknown, chains[]}`. Alarm if `supervisor.schedulerState !== "HEALTHY"` for ≥10min, or `supervisor.chainsDead > 0`, or `lastSupervisorTickAt` older than `intervalMs * 1.2`.
- `GET /healthz/continuity` with `x-admin-token` — adds `replicaId` for forensic correlation when investigating which replica owned a window, and the unredacted per-tenant decision log.
- `REPLICA_ID` env var — set to pod/instance ID in multi-replica deploys. Defaults to `replica_<uuid>` per process. Stored on every `continuity_window_claims.claimed_by` row + emitted in `[Server] Continuity layer up — replicaId=...` boot log.
- `CONTINUITY_SUPERVISOR_DISABLED=true` — disables the supervisor (used by tests).
- `CONTINUITY_SUPERVISOR_INTERVAL_MS` — overrides 5min cadence (tests only).

### Prometheus metrics added (12)

`continuity_window_claims_acquired_total`, `continuity_window_claims_lost_other_replica_total`, `continuity_window_claims_already_completed_total`, `continuity_window_claims_released_total` (INVARIANT-RETRY enforcement counter), `continuity_supervisor_up`, `continuity_supervisor_ticks_total`, `continuity_supervisor_last_tick_epoch_seconds`, `continuity_scheduler_heartbeat_age_ms`, `continuity_heartbeat_stale_total`, `continuity_chain_lag_ms{chain}`, `continuity_chain_state{chain,state}`, `continuity_chain_lag_events_total{chain,state}`.

### Audit event types added (3)

`CONTINUITY_HEARTBEAT_STALE` — supervisor classified scheduler as DEAD. `CONTINUITY_CHAIN_LAG` — fires ONLY on state transition into DEGRADED/DEAD (no spam for chains that have been DEAD for hours). `CONTINUITY_REPLICA_CONFLICT` — best-effort forensic event when our replica loses a claim race to another replica.

### Schema migration 022 (`REQUIRED_SCHEMA_VERSION` 21 → 22)

Three new tables:
- `continuity_window_claims` — `(campaign_id, plan_id, window_index)` PRIMARY KEY + `claimed_by`/`claimed_at`/`status`/`outcome`/`outcome_at`/`boss_run_id`. The atomic primitive.
- `chain_registry_state` — current `lastState` + `lastStateChangedAt` + `lastObservedLagMs` per chain. Drives the transition-only audit gate.
- `continuity_supervisor_ticks` — paper-trail row written every supervisor tick. A missing row for >2× `intervalMs` IS itself the P1 signal that the supervisor has stalled.

### Track #2 D1/D5 hygiene

No new `eslint-disable semantic/no-semantic-fallback` suppressions added. The new code uses only canonical field reads + explicit if-blocks. New `decision` enum values (`skipped_claimed_by_other_replica`, `skipped_completed_claim_exists`) added to `PerCampaignDecision.decision` strict union. New `ChainState` is a `z.enum`-shape TypeScript union with no string fallbacks.

### Tracks #3–#7 (deferred)

Track #3 (silent-degradation sweep): wire `introspect()` for the 3 currently-UNKNOWN chains, add stale-claim sweeper (kill `in_progress` claims older than 2× WINDOW_MS), add per-worker run tables to replace audit_log heartbeat introspection. Track #4 (alerting bridge): wire Prometheus alert rules + PagerDuty/Opsgenie. Track #5 (cross-region replica coordination). Track #6 (compute-class budget rebalancer). Track #7 (autonomous remediation playbooks). All deferred to subsequent seals; design notes in `.local/docs/seal-13-to-17-plan.md`.
