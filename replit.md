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
- **Dashboard**: Revenue-focused KPIs, campaign metrics, Strategic Narrative causal chain card, inline AI chat, **Perception Layer** (Watchtower 3-line market/plan/freshness strip + Activity Timeline).
- **Causal Narrative Layer**: Transforms engine outputs into a 5-step causal chain (Market Problem → Why It Happens → What We Do → How We Fix It → What To Execute).
- **Content Creation**: AI Writer (text) and AI Designer (image generation).
- **AI Management**: AI Audience Engine, Auto Publish, Market DB, Performance Intelligence Layer.
- **Strategic Engines**: Positioning, Differentiation, Mechanism, Offer, Funnel, Integrity, Awareness, Persuasion — unified under Strategy Root System (single enforced root hash) and Product DNA identity layer.
- **Competitive Intelligence (MIv3)**: 8-engine pipeline for real-data competitor analysis across Instagram, Website, Blog, TikTok, Google Reviews. Tiered signal quality gate (high≥0.75, medium≥0.50, rejected<0.50).
- **Authority Hierarchy**: Strict Awareness → Funnel → Persuasion with cross-engine validation.
- **Analytical Enrichment Layer (AEL v2)** + **Causal Enforcement Layer (CEL)**: AEL produces WHY-level root causes; CEL programmatically enforces alignment between root causes and downstream engine outputs. `AnalyticalPackage` carries `isPartial`/`partialReason` flags.
- **AI Orchestrator**: Single-entry runner of 15 engines in priority order with checkpoint persistence; generates 9-section strategic plans via AI synthesis. `scopedEngines` selective re-runs pre-load best-available audience + latest COMPLETE MI snapshot.
- **BuildPlanLayer** + **Execution Activation Layer**: Convert engine analysis into daily/weekly instructions; auto-trigger content production on plan approval.
- **Fortress Completion Engines (V3)**: Statistical Validation, Budget Governor, Channel Selection, Iteration, Retention.
- **Adaptive Data Source System**: `campaign_metrics` ↔ `benchmark` modes with adaptive switching + Statistical Validity Layer.
- **Concurrency & Scalability Hardening**: Lock timeouts, batched dedup, stale recovery, atomic plan approval, global job queue, per-account job budgets, shared market data cache, request dedup, rate gating.
- **Audit & Control System**: 5-panel dashboard (feeds, AI usage, gate status, decisions, publish history) + Continuity panel (Seal #17).
- **Decision Policy Layer** + **Decision Attribution Layer**: Confidence thresholds across plan synthesis / memory mutation / outcome tracking / autonomous worker. Campaign-scoped `strategy_decisions` and `decision_outcomes`. Weighted multi-decision attribution links calendar entries to multiple decisions.
- **Unified Memory Policy Enforcement**: All `strategy_memory` writes pass through `policyEnforcedMemoryCheck()`. Operational vs strategic memory separated.
- **Plan Synthesis Hardening**: `SynthesizedPlan` includes `PlanSource`, `degraded` flag, `synthesisVerification`. Fallback plans isolated from memory reinforcement. Memory writes linked to triggering `decision_outcomes` for provenance.
- **Signal Origin Type System**: Every signal tagged `real | competitor | inferred | fallback | unknown` and propagated for risk-aware planning.
- **Cross-Engine Integrity Enforcement**: `safeToExecute` cross-references critical engine statuses and CEL results.
- **System Control Layer**: Final authority layer running after all engines; produces `SystemControlVerdict` with execution mode, block reasons, downgrades, repair actions.
- **Evidence Integrity Filter (Audience Engine)**: Confidence downgrade (not binary erase) for low-evidence signals; inferred pains capped (5 objection-inferred, 3 driver-inferred).
- **Signal-First Positioning**: `buildSignalClaimSeeds()` pre-builds enemy/contrast/narrative seeds from signal labels BEFORE LLM call; LLM is refiner not generator. `validateClaimGrounding()` post-LLM gate. Orphaned claims dropped at the territory level. Result: signal coverage 0%→25%, orphans 8→0.
- **Text Sanitizer Layer**: Platform-aware text cleaning at the earliest point in each pipeline.

## External Dependencies

### AI Services
- OpenAI API, Google Gemini

### Data Acquisition & Proxy
- Bright Data residential proxy pool (Instagram, TikTok, Website/Blog, Google Reviews)
- Apify (fallback for TikTok scraping)

### Database
- PostgreSQL (Drizzle ORM, schema floor enforced on boot)

### User Authentication
- JWT-based email/password. Access tokens (**14d TTL** during the JWT_LEGACY grace window for client compat — sunset to 60m once mobile gains `/api/auth/refresh` wiring) carry `audience="avyron-ai"` + `issuer="avyron-auth"`. Refresh tokens (30d) rotate on every `/api/auth/refresh`, use `auth_sessions` table, reuse detection cascade fires only when presented secret bcrypt-matches a revoked row. `/api/auth/logout` verifies the refresh secret before revoking. Account lockout: 5 failed logins / 15min → 423 with 15min `Retry-After` (`auth_lockouts` table).
- **JWT 7-day legacy grace window (Seal #2 / F9.2).** Pre-deploy tokens lacking `aud`/`iss` accepted for `JWT_LEGACY_GRACE_DAYS` (default 7d). Cutoff resolves with a stable persisted stamp at `.local/state/jwt-legacy-cutoff` (override path via `JWT_LEGACY_STATE_FILE`); `JWT_LEGACY_CUTOFF_ISO` overrides if set. Monitor `[Auth] JWT_LEGACY_GRACE | hits=...` — when it stops appearing for ≥48h, set `JWT_LEGACY_CUTOFF_ISO` to a past timestamp to force-close.
- Stripe webhook integration for subscription management.
- Per-account AI rate limit (Seal #2 / F1.8): 50 calls/hr/account/route on `/api/generate-content|ad|reel-script|calendar`. Override via `AI_RATE_LIMIT_PER_HOUR`. Returns `429 + Retry-After + AI_RATE_LIMIT_EXCEEDED`.

### Other
- Video Credits System (per-user generation credits).
- Static landing/pricing pages served by Express.
- Social Platforms: Instagram, Facebook, Twitter, LinkedIn, TikTok.

---

## Active doctrine (live rules — non-negotiable)

Implementation detail, full per-rule tables, evidence, and historical justification live in `.local/docs/seals/`. The summaries below are authoritative; the archive files are read-only history.

### D1–D5 Semantic Contract Hardening

System-wide policy governing every live-decision and live-reporting field across orchestrator, system-control, recovery, snapshot, agent stream, build-plan, and contract registry.

- **D1** — **No semantic fallback.** `?? status`, `|| status`, `?? verdict`, `|| verdict`, `?? outcome`, `|| outcome` patterns are FORBIDDEN on any live decision path. Enforced by ESLint rule `semantic/no-semantic-fallback` (`.local/eslint-rules/no-semantic-fallback.js`) scoped to `server/{agent,system-control,orchestrator,build-plan-layer,recovery-*,strategy}/**`. Detects RHS, LHS, ternary, alias-variable, AND destructured-default patterns.
- **D2** — **Every meaning has its own canonical field.** Generic `status` carries execution semantics ONLY (F1). Verdict, validation, trust, action, and gate-outcome each get a dedicated field name. Enforced via contract registry.
- **D3** — **Strict enums only.** Every verdict-shaped field uses `z.enum([...])`, never `z.string()`.
- **D4** — **Legacy fields are historical only.** May exist for display/migration; MAY NOT satisfy contracts, orchestration, verdict, recovery, budget/channel decisions, or trust evaluation.
- **D5** — **Missing canonical → CONTRACT_INCOMPLETE.** Never silently substitute. The boundary helper returns `INCOMPLETE` and live reasoning is blocked.

Reference: `INTEGRITY_CONTRACT` in `server/orchestrator/contract-registry/registry.ts`. Proof suites: `server/tests/{integrity-contract,validation-contract,budget-action-contract,channel-decision-contract,agent-stream-semantic-separation,doctrine-regression}.test.ts`.

Canonical field names: `validationState` ∈ {validated|provisional|weak|rejected}, `decision.action` ∈ {test|scale|hold|halt}, `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory}, `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}, `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY}.

**Inline ESLint suppression policy:** every `eslint-disable[-next-line] semantic/no-semantic-fallback` MUST appear in the H1–H7 archive allowlist. New suppressions require (a) same-line justification comment, (b) allowlist entry in the same PR, (c) architect review note. Current allowlist size: 4.

> Full detail, Seal #9 closures, suppression allowlist, transitional exceptions: [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md).

### Continuity Architecture (Seals #13–#19)

**Founding doctrine: operational silence is a system failure category.** Originated from a May 2026 audit where the User Agent pipeline silently produced zero output for ~4 weeks because no scheduler invoked `runBoss()`. Operator handoff one-pager: [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md).

**Core invariants:**

- **INVARIANT-RETRY** — Failed OR partial boss runs MUST NEVER be suppressed. `SUCCESS_STATUSES = new Set(["completed"])` in `scheduler.ts`; `partial` and `failed` outcomes both DELETE the claim row via `releaseClaimForRetry()`. Any change letting `partial`/`failed` short-circuit a window is a P0 defect.
- **MULTI-REPLICA-SAFE** — Two scheduler instances MUST NOT both invoke runBoss for the same `(campaign, plan, window)`. DB-level claim handshake via `tryClaimWindow()` → `INSERT INTO continuity_window_claims ... ON CONFLICT DO NOTHING RETURNING`.
- **CHAIN-STATE-EXPLICIT** — A chain that lacks introspection wiring MUST be classified `UNKNOWN`, never silently `HEALTHY`. `ChainState` = `HEALTHY | DEGRADED | DEAD | UNKNOWN`. Per-chain thresholds: DEGRADED at lag > `expectedIntervalMs * degradedMultiplier` (default 2×); DEAD at lag > `expectedIntervalMs * deadMultiplier` (default 4×) OR `lastObservedRunAt === null` with introspection wired.
- **NO-TENANT-LEAK** — Public `/healthz/continuity` MUST NOT expose per-tenant fields. Admin-gated full report (timing-safe `METRICS_ADMIN_TOKEN` check) returns the unredacted health; public surface returns operational counters + per-chain state/lag only.

**Operator alerts:** `supervisor.schedulerState !== "HEALTHY"` for ≥10min; `supervisor.chainsDead > 0`; `lastSupervisorTickAt` older than `intervalMs * 1.2`; `continuity_dead_cycles_total > 0`.

**Silent-degradation rules (Seals #15/#16):** No silent catches (`} catch {}`, `.catch(() => {})` forbidden — use `_logSilentLoad` / `_noteAuditWriteFailure` or `console.error("[Component] EVENT_TAG ...")`). No bare in-flight promise maps — each entry stamped with `{ promise, startedAt, token }`, watchdog evicts older than ceiling, token-check in `.finally()`. No bare AI calls — every external AI/LLM call MUST race against a wall-clock timeout (`AI_OPENAI_HARD_TIMEOUT_MS`, `AI_GEMINI_HARD_TIMEOUT_MS`, default 60s; Gemini's `AbortController.signal` wired to `GenerateContentConfig.abortSignal` so SDK fetch is cancelled). Every inline scheduler gets a stored timer handle reachable from `gracefulShutdown`.

**Operator-visible signals (steady-state expectation = 0 / absent):** `_bossInFlightStats().zombieEvictions`, `_continuityTickInflightStats().zombieEvictions`, `_activeJobsStats().zombieEvictions`, `agent_context_section_load_failed`, `[MIv3] AUDIT_WRITE_FAILED`, `[Orchestrator] STUCK_JOB_UPDATE_FAILED`, `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` / `MARK_ENRICHING_FAILED` / `MARK_FAILED_AFTER_ERROR`.

**Canonical operator-signal thresholds:** `continuity_scheduler_last_tick_epoch_seconds` — alarm if `(now - value) > 7200` (2h); `continuity_missed_windows_total` — non-zero accumulates historical depth of silence (read alongside `plan_anchor_resets` for context); `continuity_heartbeat_stale_total` — any rate > 0 means supervisor classified scheduler as DEAD; `continuity_dead_cycles_total` — strictly 0 (any positive value = a campaign with no boss_run for ≥8 days).

**Env knobs:** `CONTINUITY_SCHEDULER_DISABLED`, `CONTINUITY_TICK_INTERVAL_MS` (1h default), `CONTINUITY_SUPERVISOR_DISABLED`, `CONTINUITY_SUPERVISOR_INTERVAL_MS` (5min default), `REPLICA_ID`, `BOSS_INFLIGHT_MAX_AGE_MS` (30min), `CONTINUITY_TICK_MAX_AGE_MS` (15min), `AI_GEMINI_HARD_TIMEOUT_MS` (60s), `MI_ACTIVE_JOBS_MAX_AGE_MS` (30min).

**Operator-visible surface (Seal #17):** Grafana dashboard (`.local/dashboards/continuity.json`, 16 panels, `avyron-continuity`) + in-app Continuity panel (6th panel of Audit & Control, `app/audit-control.tsx`) gated on `EXPO_PUBLIC_METRICS_ADMIN_TOKEN`. Backend endpoints (mounted in `server/index.ts`, same `X-Admin-Token` gate as `/metrics` and `/healthz/continuity`): `GET /api/admin/continuity/panel`, `GET /api/admin/continuity/campaign/:campaignId/last-decision`. Per-campaign skip-reason badge powered by 24h `continuity_ticks` JSONB histogram (single round-trip).

**Lifecycle behavioral simulation (Seal #18):** 18 scenario tests (`server/tests/lifecycle/scenario-NN-*.test.ts`) fake `Date.now()` and drive `runContinuityTick` through a real DB-state mock. Hermetic (all scheduler-touching modules `vi.mock`'d via `_harness.ts`), deterministic clock, no-flakes (`scripts/lifecycle-flake-check.sh` 100-iter gate), state-not-logs assertions. Cross-realm `Date` pitfall: harness's `resolveEffectiveAnchorFor` uses structural duck-typing (truthy + `.getTime()`) instead of `instanceof Date`.

**8-audit post-implementation gate (Seal #19):** every seal landing a new chain, scheduler, lock, or in-flight Map MUST be followed by an 8-audit pass before the next seal opens (Architectural, Runtime baseline, Scheduler/chain registry, Orchestration silent-failure, Memory write-path regression, Degraded-state canonical flag, Fail-safe, D1–D5 doctrine). Each returns PASS / DOCUMENTED_EXCEPTION (sunset date required) / FIX_REQUIRED. Report archived under `.local/docs/seals/seal-N-audits.md`.

> Per-seal archive index lives at the bottom of this file.

### Replay / Shadow Harness — Phase 4-A (Task #89)

Every orchestrator decomposition step must be replay-verifiable BEFORE it lands. A `ReplayCassette` is a content-addressed, deterministic recording of one `runOrchestrator(...)` invocation. The player consumes a cassette and runs a candidate orchestrator with all LLM calls STRICTLY mocked from the recorded outputs (NO re-rolls). Divergences are classified into a 7-class taxonomy: `STRUCTURAL` > `CANONICAL_FIELD` (D2-tracked) > `DEGRADATION_SURFACE` > `BUDGET_LEDGER` > `PROVENANCE` > `ORDER` > `TIMING_ONLY` (whitelist).

Key rules: all recorder boundaries in `server/orchestrator/**` funnel through `withReplayRecorder(...)` (ESLint `orchestrator-replay/no-bare-llm-call-in-replay`); direct `aiChat`/`aiGemini`/`getOpenAI`/`getGemini` imports forbidden inside `server/orchestrator/replay/**`; production recording OFF by default (`ORCH_REPLAY_RECORD` ∈ unset|`0`|`false`|`1`|`true`|`sample:N`); cassette body carries `schemaVersion` and player throws `ReplayCassetteVersionError` on unknown; PII redacted before persistence (same-input → same hash-token); `cassetteHash` is SHA-256 of INPUT envelope only; identical-prompt repeats handed back FIFO by `callOrder`; deep diff walk after boutique checks; recorder/CLI hash parity required; dedupe metric only on actual INSERT.

CV-13 metrics on `/metrics`: `cv13_replay_cassettes_total{source}`, `cv13_replay_age_max_hours`, `cv13_replay_recorder_overhead_ratio` (rolling 5-min p50), `cv13_replay_player_runs_total{outcome}`. Operator endpoints: `GET /api/admin/replay/cassettes`, `GET /api/admin/replay/cassette/:hash`. CLI: `npm run replay:list`, `npm run replay:run -- --cassette <hash> [--against current|candidate]`, `npm run replay:capture-synthetic`. Tests: `npm run replay:test` (34 tests); flake: `npm run replay:flake` (100-iter).

P4-A limitation: `runOrchestrator` does not yet accept an injected LLM adapter, so `--against current` is NON-HERMETIC (real LLM calls); CLI prints a banner warning. Hermetic `--against current` lands in P4-B.

### Orchestrator Decomposition — Phase 4-D Controlled Runtime Cutover (Task #92)

Doctrine that governs the rollout of the extracted-module candidate orchestrator into production traffic. Closes the gap between "parity gate green" (Phase 4-C) and "legacy `runOrchestrator` body deleted" (Phase 4-E). Five non-negotiable invariants:

- **OD-1 — Single-persist degradation surface.** The PLAN_DEGRADED surface (commercial-DNA rejections, AEL-partial provenance, `validationState` downgrade) is computed by `synthesisDegradationBuilder` BEFORE the first `persistPlan` call. `strategicPlans.planJson` is written EXACTLY ONCE per run. ESLint rule `orchestrator/no-cas-re-persist` (`.local/eslint-rules/no-cas-re-persist.js`) bans new `db.update(strategicPlans)` sites in `server/orchestrator/{index.ts,plan-synthesis.ts}` outside the `persistPlan` writer. The legacy optimistic-CAS re-persist (`server/orchestrator/index.ts:~4628`) is an allowlisted transitional path with a sunset condition: removed once `ORCH_SINGLE_PERSIST_MODE='enforce'` is the default AND `traffic_percent=100` has held for ≥7d. Quantitative proof: `orch_persist_call_total{site}` — `{site="cas_re_persist"}` must trend to 0 before the legacy body can be deleted.

- **OD-2 — Retry-amplification budget aligned with `expectedCompleteBy`.** A maximally-retried run cannot exceed its own in-flight lock window (T-S5-C6 ceiling). Shadow-log compares "what the new budget would have permitted" vs the legacy implementation for ≥7d before the new ceiling becomes load-bearing.

- **OD-3 — `runOrchestrator` ≤200 lines after P4-E.** Enforced by `orchestrator/no-new-large-file` (current ceiling 5000, ratcheted down with every extraction). New inline logic ≥10 lines requires an architect note OR extraction into a sibling module. Phase 4-D ships scaffolds for `engine-invocation-loop/` and `result-assembly/` so OD-1 has a future single-persist anchor target; the deep extraction lands in P4-E.

- **OD-4 — Traffic-percent rollout, not binary cutover.** `cutover_state` (singleton, id=1) carries `traffic_percent ∈ {0,1,5,25,50,100}` enforced by CHECK constraint. Each promotion requires (a) `readyForCutover=true` per the Phase 4-C parity gate, (b) `locked_until ≤ NOW()`, (c) ≥24h since the last increment enforced by a Postgres BEFORE-UPDATE trigger (`cutover_state_increment_guard`). The 24h is the SAFETY FLOOR; the doctrinal soak is 7d at each non-zero step. Reverts (decrease/no-op) are always allowed. Operator promotes via `POST /api/admin/cutover/increment` (admin-token gated); revert via `POST /api/admin/cutover/revert`; unlock via `POST /api/admin/cutover/unlock`. Inspection: `GET /api/admin/cutover`. Per-jobId dispatch is deterministic FNV-1a hash-mod (same jobId → same path for the run's lifetime); decision lives in `server/orchestrator/cutover/traffic-decision.ts`.

- **OD-5 — Auto-revert is the ONLY automatic traffic-percent change.** Any STRUCTURAL or CANONICAL_FIELD divergence observed at `traffic_percent > 0` flips the percent to 0 atomically through `recordCandidateDivergence()` and sets `locked_until = NOW() + 1h` (cool-off prevents thrash). Candidate-throw (`recordCandidateThrow`) flips unconditionally when percent > 0. Operator MUST unlock + manually re-promote after every auto-revert. No `?? path` / `|| path` fallback in the dispatcher — invalid `traffic_percent` throws `InvalidTrafficPercentError` (D1 / D3 compliance). Cassettes tagged `purpose='behavioral_change_proof'` (vs `'parity'` default) are excluded from the parity gate's BLOCK-divergence histogram so intentional behavioral changes don't permanently block `readyForCutover`.

**Operator-visible metrics (steady state = 0 except the gauge):** `orch_cutover_traffic_percent` (gauge — current rung), `orch_cutover_runs_total{path}` (counter — current vs candidate), `orch_cutover_divergence_at_traffic_total{traffic_percent,divergence_class}` (counter — non-zero at any non-TIMING_ONLY class while percent>0 means auto-revert imminent or just fired), `orch_persist_call_total{site}` (counter — `{site="cas_re_persist"}` strictly trending to 0), `orch_cutover_auto_revert_total{reason}` (counter — any positive value = operator intervention required).

**Required schema floor:** `REQUIRED_SCHEMA_VERSION = 31`. Migration `030_cutover_state.sql` creates the singleton + trigger; `031_cassette_purpose.sql` adds the `purpose` tag to `orchestrator_replay_cassettes`.

### UX Projection Cleanup — Phase 8 (Task #71)

Customer surface speaks outcomes, code surface speaks canonical. Operator-grade panels (`AELDebugPanel`, `OrchestratorPanel`, `SignalFlowPanel`, `SystemIntegrityPanel`, `MarketDatabaseAdmin`) MUST be gated behind `useOperatorSurface()` (`hooks/useOperatorSurface.ts`). Customer-build JSX MUST NOT contain internal engine names ("Positioning Engine", …) OR raw doctrinal tokens (`CHAIN_DEGRADED`, `MARKET_DATA_DEGRADED`, `PLAN_DEGRADED`, etc.). Verdict + headline rendering goes through ONE presenter (`lib/run-truthfulness-presentation.ts` → `presentRunTruthfulness()` returning `{ customerLabel, color, isCanonical }`; returns `null` when both inputs missing — D5). Customer-facing model picker MUST NOT name SKUs ("GPT-5.2", "Gemini 3 Pro").

CI wiring: `scripts/check-engine-vocabulary.sh` (ripgrep regex over `app/(tabs)/**` + customer components, operator-only files allowlisted, exit-1 on hit). `npm run lint:vocab`, `npm run lint:all`.

Customer-facing 4-screen pivot (`ai-management.tsx`): customer builds collapse the 8-tab operator surface into four outcome-framed pillars (Connect → `publisher`, Diagnose → `intelligence`, Roadmap → `buildplan`/`ExecutionPlan`, Monitor → `control`). Persistence, routing, and content code paths unchanged (D2).

### Perception Layer (Slices 1+2, May 2026)

Customer-facing read-only surface that exposes hidden runtime intelligence (continuity, boss verdicts, scheduler decisions) in safe English. Allowlist-translator architecture: `shared/perception-translator.ts` maps internal verdicts (Q1=WORKING/DEGRADED/UNKNOWN, Q2=STABLE/SHIFTED/UNCERTAIN, lowercase continuity decision enum, boss_run status, reanchor reason) to customer-safe `{tone, headline, detail}`. **Fail-closed:** unknown inputs return `null` and are dropped — never coerced. Endpoints (under `requireCampaign` auth, mounted in `server/perception-routes.ts`): `GET /api/perception/watchtower` (3 lines: market, plan, freshness), `GET /api/perception/activity?sinceHours=N` (unified timeline from `boss_runs` + `plan_anchor_resets` + `continuity_ticks.notes` filtered by BOTH `accountId` AND `campaignId` inside JSONB). Customer payload contains NO internal UUIDs/status strings — event ids are opaque `${kind}:${timestamp}`. Frontend: `hooks/usePerception.ts` (React Query, 5min stale + refetch), `components/WatchtowerStrip.tsx`, `components/ActivityTimeline.tsx`, mounted in `app/(tabs)/index.tsx`.

### Canonical Fact Ownership — Phase 1 (Task #64)

Every persisted fact has exactly one authoritative writer. `strategy_memory` is written ONLY through `memoryStore` (`server/memory-system/store.ts`) via `upsertByFingerprint` / `updateById` / `applyDecayUpdate` (ESLint `canonical-fact/no-direct-strategy-memory-write` bans direct `db.insert(strategyMemory)` outside the store; allowlist: store + tests + migrations). Operational state (`content_rhythm`, `exploration_budget`, agent rhythm) lives in `engine_operational_state` singleton — never `strategy_memory`. Mutation runs live in `mutation_log`. One gate: `validateDecisionForMemoryWrite` delegates to `policyEnforcedMemoryCheck`; the OPERATIONAL_MEMORY_TYPES bypass is REMOVED. Every write recorded to `cv06_memory_writes_total{outcome,memoryType,engine}` (outcomes: `inserted|updated|blocked|decay`). Demoted columns (`is_winner`, `confidence_score_normalized`) display-only; replacements: `confidence_score` + `direction ∈ {reinforce|avoid|neutral}`. Migration 024 creates `mutation_log`, `engine_operational_state`, unique index on `(account_id, campaign_id, state_type)`.

### Memory Unification — Phase 2 (Task #65)

The chain "decision made → outcome observed → memory reinforced" MUST be FK-bound, single-source-of-truth, and silent-zero-row-proof. Closes the DEC-B bug (outcome-tracker silently updated zero rows because `WHERE strategy_memory.id = strategy_decisions.id` is an id-space mismatch).

- Reinforce by FK, never PK collision: `memoryStore.reinforceByDecisionId(accountId, campaignId, decisionId, patch)` looks up `strategy_memory.decision_id = decisionId`. `boundRowCount=0` triggers `MEMORY_UNBOUND` log + CV-11 increment.
- Outcome rows immutable once evaluated: UPDATE carries `WHERE outcome IS NULL` + `.returning()`; DB-level `BEFORE UPDATE` trigger `decision_outcomes_immutability_check` RAISES on re-evaluation (allows administrative metadata patches).
- Single decay layer: read-time multiplicative decay (`computeEffectiveConfidence` in `memory-system/manager.ts`) is canonical. Write-time half-life decay REMOVED.
- Write-time fingerprint contradiction resolver: same-fingerprint flip (`reinforce`↔`avoid`) REJECTED unless incoming confidence is strictly greater.
- Confidence-banded reader: orders by `confidence_score DESC, updated_at DESC` (not pure recency). Index `strategy_memory_account_campaign_confidence_idx`.
- Explicit provenance per write: `provenance_origin ∈ {outcome|mutation|engine_seed|exploration|decay|unknown}`.
- CV-11 hallucination-exposure counter: `cv11_hallucination_exposure_total{kind,engine}` — steady-state 0.

Schema floor: REQUIRED_SCHEMA_VERSION = 25 (Migration `025_memory_unification.sql`).

### Beta Safety Doctrine (Task #50)

Beta safety is a system property — five non-negotiable values codify how every new piece of code, copy, and operator surface MUST behave: **B1** Truthfulness over confidence. **B2** Visibility over silence. **B3** Safe degradation over fake success. **B4** Explicit classification over hidden ambiguity. **B5** Operational continuity over feature velocity.

The beta-readiness package is the launch governance reference: [`.local/docs/beta-readiness/`](.local/docs/beta-readiness/) (mirrored to [`docs/beta-readiness/`](docs/beta-readiness/) since `.local/` is gitignored). 10 docs cover roadmap, observation plan, stress-test plan, rollout strategy, guardrails, risk register, operator-response playbooks, must-monitor metrics, launch constraints, unresolved-risks log.

**Per-stage rollback authority:** any rollback trigger from `roadmap.md` §"Inter-phase rollback triggers" allows the on-call operator to enforce caps via env vars (GR19 `BETA_ADMISSIONS_FROZEN`, GR20 `BETA_ACCOUNT_CAP`) without code change. Lifting a freeze requires architect APPROVED.

## Required Replit Secrets (Seal #7 / F10.5)

The env validator (`server/env-validator.ts`) refuses to boot if any of the following is missing. Set these via Replit Secrets — never via `.replit` `[userenv.shared]` (history-leak risk; F9.7).

| Secret | Required | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | always | Postgres connection string. |
| `JWT_SECRET` | production (dev: warn) | Auth token signing key. Dev container falls back to a deterministic JWT_SECRET (logged at boot). |
| `OPENAI_API_KEY` | always | OpenAI client. `AI_INTEGRATIONS_OPENAI_API_KEY` accepted as alias. |
| `BRIGHT_DATA_PROXY_USERNAME` | always | Residential proxy auth (scrapers). |
| `BRIGHT_DATA_PROXY_COUNTRY` | always | Proxy geo-targeting code. |
| `STRIPE_WEBHOOK_SECRET` | production (dev: warn) | Stripe signature verification on `/api/stripe/webhook`. Routes fail-closed when secret unset. |
| `PUBLIC_BASE_URL` | always (dev derives) | Canonical absolute base URL injected into landing/pricing HTML in place of host-header trust. Dev auto-derives from `REPLIT_DEV_DOMAIN`. Validated: absolute URL; `https://` in production; hostname must end with `.replit.app` / `.replit.dev` / `.replit.co` OR appear in `ALLOWED_PUBLIC_HOSTS`. |
| `ALLOWED_PUBLIC_HOSTS` | optional | Comma-separated additional hostname suffixes. |
| `METRICS_ADMIN_TOKEN` | recommended | Gates `GET /metrics` and unredacted `/healthz/continuity` via `X-Admin-Token`. Absent → 401. |
| `SENTRY_DSN` | recommended | Server error reporting. Absent → no-op. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | recommended | Reserved for upstream OpenTelemetry adoption. |
| `JWT_LEGACY_CUTOFF_ISO` | optional | Override of auto-persisted JWT legacy-grace cutoff. |
| `AI_RATE_LIMIT_PER_HOUR` | optional | Override of 50/hr/account/route AI rate limit. |
| `BOSS_INFLIGHT_MAX_AGE_MS` | optional | Boss in-flight watchdog ceiling (default 30min). |
| `CONTINUITY_TICK_MAX_AGE_MS` | optional | Continuity tick watchdog ceiling (default 15min). |
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | Gemini wall-clock timeout (default 60s). |
| `MI_ACTIVE_JOBS_MAX_AGE_MS` | optional | MIv3 activeJobs Map watchdog (default 30min). |

## Observability

- **`GET /healthz`** — unauthenticated liveness probe (`{ ok: true, ts }`).
- **`GET /metrics`** — Prometheus text exposition. Admin-gated via `X-Admin-Token`.
- **`GET /healthz/continuity`** — public operational health (no tenant fields); admin token reveals replicaId + per-tenant decision log.
- **Structured logger (`server/logger.ts`)** — pino-compatible JSON-line facade. Every request gets a `traceId` (AsyncLocalStorage via `server/trace-context.ts`). `stripSecrets()` redacts keys matching `/^(token|refresh.*token|access.*token|secret|api.*key|authorization|cookie|password|jwt)$/i` and scans string values for inline `Bearer …`, `sk-…`, `eyJ…`.
- **Sentry shim (`server/observability/sentry.ts`)** — dynamic-import wrapper; no-op when `SENTRY_DSN` unset. Global error handler masks `error.message` to `"Internal server error"` in production.
- **Boot order** (`server/index.ts`): `validateEnv → initOTel → initSentry → ArtifactGuard → loggerMiddleware → /healthz → /metrics → /api → await runMigrations() → workers`.

## Migration runner

- `server/migrations/runner.ts` is the single entry point. Acquires `pg_advisory_lock(8675309)` (blocking, bounded by a 5-min `Promise.race` timeout) to serialize across instances, applies pending SQL from `server/migrations/sql/`, then runs legacy `002–014` programmatic migrations. Records each step in `schema_migrations`.
- **`REQUIRED_SCHEMA_VERSION`** is enforced at boot; boot refuses to start if the database last-applied version is lower AND migration application fails. Current floor: 27.
- `npm run db:migrate` runs standalone. `npm run db:generate` writes drizzle output to `server/migrations/sql/`.
- `noTransaction` marker (first line `-- noTransaction`) is honored so `CREATE INDEX CONCURRENTLY` can run outside a transaction.

## GDPR account deletion

`server/account-lifecycle.ts` implements a two-phase, reversible-during-quarantine delete spanning **105 `accountId`-bearing tables**.

- **Phase 1 (immediate):** `DELETE /api/account` requires Bearer token, header `X-Account-Delete-Confirm: PERMANENTLY_DELETE`, and current password in JSON body for fresh re-auth via `bcrypt.compare`. On success: masks PII on `users`, inserts `account_tombstones` row with `purgeAfter = now() + 30d`, writes to `audit_log_archive`.
- **Cancellation window:** `POST /api/account/delete-cancel` removes the tombstone any time before `purgeAfter` (PII mask is not reverted).
- **Phase 2 (reaper):** `runTombstoneReaper()` runs daily (initial 60s, 24h tick). `cascadeDeleteAccount()` deletes from all 105 tables inside a single PG transaction — any error rolls back the whole account.
- **`CASCADE_EXEMPT`:** `audit_log_archive`, `account_tombstones`, `schema_migrations`, `auth_lockouts`, `messages`.

## Marketing-logic engine upgrade (Apr 2026)

The 5 marketing engines were upgraded to reason like top marketers (not just relabel segments). Pipeline orchestration unchanged; outputs extended additively.

Per-engine commercial-reasoning module (designer + LLM judge + 1 retry on REJECTED + safe `null` fallback): P1 Persuasion (`trust-transfer.ts`), P2 Positioning (`category-game.ts`), P3 Offer (`value-architect.ts`), P4 Audience (`buyer-psychology.ts`), P5 Awareness (`narrative-reframe.ts`). Shared cross-engine commercial DNA: `shared/commercial-dna.ts` (`composeCommercialDNA()` + contradiction detector `IDENTITY_DRIFT`, `GAME_TRUST_MISMATCH`); `server/orchestrator/shared-strategic-context.ts` new `commercialSignals` registry (5 signal types). If the AI judge returns final REJECTED, the module returns `null` and the engine continues with its legacy output.

### Operations Guardian — OBS-C (Task #60)

Per-provider keying for AI burst collectors: `AI_TIMEOUT_BURST:<provider>` and `AI_PROVIDER_FAILURE_BURST:<provider>` (was `:global`). New `PROVIDER_INSTABILITY:<provider>` cross-signal correlator emits ONE rollup notice (operator-audience only, no USER_COPY promotion, no auto-recovery) when ≥2 of {timeout-burst, failure-burst, latency-degraded} fire for the same provider in the same tick; severity = max via explicit `severityRank()` integer mapping (D1-safe). 69/69 deterministic scenarios pass. Full report: [`.local/docs/audits/operations-guardian-obs-c-2026-05.md`](.local/docs/audits/operations-guardian-obs-c-2026-05.md).

---

## Seal archive index

Each per-seal file contains the full implementation detail, code references, test pointers, and historical justification. The `replit.md` rules above are the authoritative live doctrine; the archive files are read-only history.

- [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md) — D1–D5 detail, Seal #9 closures, suppression allowlist.
- [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md) — Hourly scheduler, idempotent invocation, long-gap re-anchor, missed-window detection, schema 021.
- [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md) — DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema 022.
- [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md) — 9 closed silent-degradation findings, 4 deferred items, architect race-fix amendment, 6 behavioral tests.
- [`.local/docs/seals/seal-16-followups.md`](.local/docs/seals/seal-16-followups.md) — F1 activeJobs Map watchdog + F2 Gemini AbortController.signal wiring.
- [`.local/docs/seals/seal-17-track4-observability.md`](.local/docs/seals/seal-17-track4-observability.md) — Grafana dashboard + in-app Continuity panel + admin endpoints + skip-reason badge.
- [`.local/docs/seals/seal-18-track5-lifecycle-tests.md`](.local/docs/seals/seal-18-track5-lifecycle-tests.md) — 18 deterministic behavioral lifecycle scenarios + harness + 100-iteration flake checker.
- [`.local/docs/seals/seal-19-track6-audits.md`](.local/docs/seals/seal-19-track6-audits.md) — 8-audit verdict matrix + evidence + allowlist drift note.
- [`.local/docs/seals/seal-20-track7-doctrine-lock.md`](.local/docs/seals/seal-20-track7-doctrine-lock.md) — Doctrine lock consolidating Seals #13–#19 + operator handoff one-pager.
- [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md) — operator handoff one-pager (dashboard URLs + alert thresholds + env-var reference + heartbeat-red decision tree).
- `.local/docs/seal-13-to-17-plan.md` — original Tracks #1–#7 design plan (pre-existing).
