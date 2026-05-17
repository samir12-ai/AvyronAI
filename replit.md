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

### Continuity Architecture (Seals #13–#19)

**Founding doctrine: operational silence is a system failure category.** Originated from a May 2026 audit where the User Agent pipeline silently produced zero output for ~4 weeks because no scheduler invoked `runBoss()`. The seven-seal arc below builds the chain-of-custody from "no scheduler" → "deterministically tested operator-visible scheduler with multi-replica safety, silent-degradation hardening, and an 8-audit gate". **Operator handoff one-pager: [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md)** — printable decision tree for "what to do when heartbeat goes red".

#### Core invariants (Seals #13/#14)

| # | Invariant | Enforcement |
|---|---|---|
| **INVARIANT-RETRY** | Failed OR partial boss runs MUST NEVER be suppressed. | `SUCCESS_STATUSES = new Set(["completed"])` in `scheduler.ts`. `partial` and `failed` outcomes both DELETE the claim row via `releaseClaimForRetry()` so the next tick re-claims. Any change letting `partial`/`failed` short-circuit a window is a P0 defect. |
| **MULTI-REPLICA-SAFE** | Two scheduler instances MUST NOT both invoke runBoss for the same (campaign, plan, window). | DB-level claim handshake via `tryClaimWindow()` → `INSERT INTO continuity_window_claims ... ON CONFLICT DO NOTHING RETURNING`. |
| **CHAIN-STATE-EXPLICIT** | A chain that lacks introspection wiring MUST be classified UNKNOWN, never silently HEALTHY. | `classifyChainState({ introspectionAvailable: false })` returns `state: "UNKNOWN"`. |
| **NO-TENANT-LEAK** | Public `/healthz/continuity` MUST NOT expose per-tenant fields (campaignId, accountId, planId). | Admin-gated full report (timing-safe `METRICS_ADMIN_TOKEN` check) returns the unredacted health; public surface returns operational counters + per-chain state/lag only. |

`ChainState` = `HEALTHY | DEGRADED | DEAD | UNKNOWN`. Per-chain thresholds: DEGRADED at lag > `expectedIntervalMs * degradedMultiplier` (default 2×); DEAD at lag > `expectedIntervalMs * deadMultiplier` (default 4×) OR `lastObservedRunAt === null` with introspection wired. Operator alerts: `supervisor.schedulerState !== "HEALTHY"` for ≥10min; `supervisor.chainsDead > 0`; `lastSupervisorTickAt` older than `intervalMs * 1.2`; `continuity_dead_cycles_total > 0`.

#### Silent-degradation rules (Seals #15/#16)

**Doctrine: a silent skip is a runtime degradation.** Every silent path is logged, watched, or explicitly documented as deferred. No "probably fine" verdicts.

- **No silent catches.** `} catch {}` and `.catch(() => {})` are forbidden. Use the file-local `_logSilentLoad` / `_noteAuditWriteFailure` helper pattern (or equivalent `console.error("[Component] EVENT_TAG ...")`) so the operator sees the failure even when the code path returns a UI-safe default.
- **No bare in-flight promises.** Any `Map<key, Promise>` or singleton `let inFlight: Promise | null` used as a concurrency lock MUST stamp each entry with `{ promise, startedAt, token }`, run a watchdog on entry that evicts entries older than a configured ceiling, AND token-check in the `.finally()` so a late-settling stale promise cannot delete a fresh successor entry.
- **No bare AI calls.** Every external AI/LLM call MUST race against a wall-clock timeout. OpenAI uses `AI_OPENAI_HARD_TIMEOUT_MS`, Gemini uses `AI_GEMINI_HARD_TIMEOUT_MS` (default 60s). Timeout throws `AICallError("AI_TIMEOUT")` so the outer `finally` releases per-account locks. Seal #16 / F2 wires `AbortController.signal` into `GenerateContentConfig.abortSignal` so the underlying SDK fetch is cancelled at the same instant `AI_TIMEOUT` surfaces (no leaked sockets / background token spend).
- **Every inline scheduler gets a stored timer handle.** Anonymous `setInterval`/`setTimeout` cascades inside boot closures are forbidden — the handle MUST be reachable from `gracefulShutdown` so SIGTERM clears it.

Operator-visible signals (steady-state expectation = 0 / absent; appearance is the alarm): `_bossInFlightStats().zombieEvictions`, `_continuityTickInflightStats().zombieEvictions`, `_activeJobsStats().zombieEvictions` (Seal #16 / F1 — fetch-orchestrator activeJobs Map watchdog); `agent_context_section_load_failed` (pino warn); `[MIv3] AUDIT_WRITE_FAILED`, `[Orchestrator] STUCK_JOB_UPDATE_FAILED`, `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` / `MARK_ENRICHING_FAILED` / `MARK_FAILED_AFTER_ERROR`.

Env knobs (full continuity surface): `CONTINUITY_SCHEDULER_DISABLED` (boolean — disables scheduler; tests / incident-response only), `CONTINUITY_TICK_INTERVAL_MS` (1h default — scheduler cadence override), `CONTINUITY_SUPERVISOR_DISABLED` (boolean — disables supervisor; tests only), `CONTINUITY_SUPERVISOR_INTERVAL_MS` (5min default — supervisor cadence override), `REPLICA_ID` (per-process UUID default — pod/instance ID stamped on `continuity_window_claims.claimed_by` and the boot log for multi-replica forensics), `BOSS_INFLIGHT_MAX_AGE_MS` (30min), `CONTINUITY_TICK_MAX_AGE_MS` (15min), `AI_GEMINI_HARD_TIMEOUT_MS` (60s), `MI_ACTIVE_JOBS_MAX_AGE_MS` (30min).

Canonical operator-signal thresholds (steady-state expectation in parens): `continuity_scheduler_last_tick_epoch_seconds` — alarm if `(now - value) > 7200` (2h); `continuity_missed_windows_total` — non-zero accumulates the historical depth of silence even after re-anchor (read alongside `plan_anchor_resets` rows for context); `continuity_heartbeat_stale_total` — any rate > 0 means the supervisor classified the scheduler as DEAD; `continuity_dead_cycles_total` — strictly 0 (any positive value = a campaign with no boss_run for ≥8 days).

#### Operator-visible surface (Seal #17)

**Doctrine: an unobserved metric is the same as a missing metric.** The Tracks #1–#3 Prometheus families and `continuity_ticks` audit rows are exposed on two surfaces so the question "why didn't my campaign run this week" is answerable in ≤30s without SSH.

| # | Surface | Gate |
|---|---|---|
| 1 | `.local/dashboards/continuity.json` — 16-panel Grafana dashboard (`avyron-continuity`) covering heartbeat, skip reasons + throughput, multi-replica claim handshake, and the 10-chain registry. Strictly an exposure layer over existing metrics — no net-new metric families. | Reads from the Prometheus scrape of `/metrics` (already admin-token-gated). |
| 2 | In-app **Continuity** panel (6th panel of Audit & Control, `app/audit-control.tsx`). Renders last tick, selected-campaign decision badge, last 24h skip-reason histogram, per-campaign window-index gaps, last 10 plan-anchor resets. | `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` set on the client (operator builds only) — `continuityPanelEnabled()` self-disables the section in customer builds. |

Backend endpoints (mounted in `server/index.ts`, same `X-Admin-Token` gate as `/metrics` and `/healthz/continuity`):

- `GET /api/admin/continuity/panel` — panel data. 401 when `METRICS_ADMIN_TOKEN` is unset OR header is wrong.
- `GET /api/admin/continuity/campaign/:campaignId/last-decision` — lightweight per-campaign lookup powering the campaign-card skip-reason badge. Returns `{ decision: PerCampaignDecision | null }`. NOT a default decision when the latest tick had no entry — `null` is canonical (D5).

The 24h skip-reason histogram is a single PG round-trip:
```sql
SELECT (note->>'decision') AS decision, COUNT(*)::int AS count
FROM continuity_ticks, jsonb_array_elements(notes) AS note
WHERE tick_at >= NOW() - INTERVAL '24 hours'
GROUP BY (note->>'decision')
```

Strict-union enforcement on the client: `ContinuityDecision` in `hooks/useContinuityPanel.ts` is the same 8-value union as `PerCampaignDecision.decision`. `Record<ContinuityDecision, string>` exhaustiveness on `DECISION_LABELS` and `DECISION_COLORS` blocks any string fallback at the prop boundary (D2/D3). Corrupt notes rows from the histogram are bucketed under a SEPARATE `"unknown"` key — never silently coerced into a real decision.

#### Lifecycle behavioral simulation (Seal #18)

**Doctrine: behavioral lifecycle tests must remain deterministic.** 18 scenario tests (`server/tests/lifecycle/scenario-NN-*.test.ts`) fake `Date.now()` and drive `runContinuityTick` through a real DB-state mock to simulate weeks of operation. Every scenario asserts on **DB rows + Prometheus counters + audit events + per-campaign decisions** — never on log strings, never on timing-dependent orderings.

| # | Invariant | Enforcement |
|---|---|---|
| **HERMETIC** | Tests must not touch the network or a real DB. | All scheduler-touching modules (`db`, `boss`, `boss/concurrency`, `audit`, `logger`) are mocked via `vi.mock(...)` to `__*ModuleMock` exports of `server/tests/lifecycle/_harness.ts`. |
| **DETERMINISTIC-CLOCK** | Tests must own the clock. | `runOneTick(now)` calls `setSimulatedNow(now)` then invokes `runContinuityTick({ now, persist: true })`. No scenario reads wall-clock time for a continuity decision. |
| **NO-FLAKES** | A flaky lifecycle test is a doctrine violation, not "intermittent." | `scripts/lifecycle-flake-check.sh` (default 100 iterations) is the gate before merging changes that touch the continuity scheduler, the boss/concurrency lock, the audit pipeline, the metrics families, or `_harness.ts` itself. Any single failed iteration must be root-caused — do not retry. |
| **STATE-NOT-LOGS** | Assertions go against persisted/observable state. | `dbState.bossRuns`, `dbState.evalWindows`, `dbState.claims`, `dbState.resets`, `getMetric(name, labels)`, `getAuditEvents(eventName)`, and per-campaign `decision` rows from the tick report. |

**Cross-realm Date pitfall (documented for next harness change):** Vitest's module-realm boundary makes `instanceof Date` return `false` for `Date` objects created in the test file. The harness's `resolveEffectiveAnchorFor` must use structural duck-typing (truthy + `.getTime()`) instead of `instanceof Date`, otherwise every approval row is silently dropped inside the boss mock and `wIdx` collapses to 0.

#### 8-audit post-implementation gate (Seal #19)

**Doctrine: every seal that lands a new chain, scheduler, lock, or in-flight Map MUST be followed by an 8-audit pass before the next seal opens.**

| # | Audit | Acceptance |
|---|---|---|
| 1 | Architectural | Every new file in a conventional dir; no new top-level concept beyond doctrine. File-by-file table required. |
| 2 | Runtime baseline | Boot + steady-state memory/CPU/DB-conn within ±10% of prior-seal baseline. 60-min steady-state sample. |
| 3 | Scheduler / chain registry | Every chain in `chain-registry.ts` runs at its declared `expectedIntervalMs` (7d shadow OR accelerated test). Un-wired introspectors classified `UNKNOWN`, never `HEALTHY`. |
| 4 | Orchestration silent-failure | Re-run prior outage prompt across all 20 categories. Zero new silent paths. |
| 5 | Memory write-path regression | Diff `policyEnforcedMemoryCheck()` call sites + `strategy_memory` writers vs prior seal. Zero bypass. |
| 6 | Degraded-state canonical flag | Every fallback/partial/degraded path emits `SynthesizedPlan.degraded` + typed `PlanSource`. Reachable in test. |
| 7 | Fail-safe | Boot failure → `process.exit(1)`; `uncaughtException` + `unhandledRejection` → `process.exit(1)`; every `setTimeout`/`setInterval` handle reachable from `gracefulShutdown`. |
| 8 | D1–D5 doctrine | ESLint `semantic/no-semantic-fallback` clean across new code. Zero new suppressions outside the H1–H7 archive allowlist. |

Each audit returns **PASS** / **DOCUMENTED_EXCEPTION** (sunset date required) / **FIX_REQUIRED** (fix in seal OR follow-up filed before close). Report archived under `.local/docs/seals/seal-N-audits.md`; one-row-per-audit summary at `.local/docs/seal-N-audit-report.md`. Seal #19 result: **7 PASS + 1 DOCUMENTED_EXCEPTION** (Audit #2 runtime baseline — sunset = first 7d post-Seal-#20 deploy). 0 FIX_REQUIRED.

ESLint suppression count across Seals #13–#19: 0 added. Allowlist size remains at 4 (documentation-only drift to 11 actual sites — all pre-Seal-#13 origin, all D1-safe — is tracked under Seal #20 doctrine-lock follow-up; full allowlist sync lives in the H1–H7 archive).

> **Per-seal archive links (chronological):**
> Seal #13 / Track #1 — [hourly scheduler, idempotent invocation, long-gap re-anchor, missed-window detection, schema migration 021](.local/docs/seals/seal-13-track1-continuity.md).
> Seal #14 / Track #2 — [DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema migration 022](.local/docs/seals/seal-14-track2-multireplica.md).
> Seal #15 / Track #3 — [9 closed silent-degradation findings, 4 deferred items, architect race-fix amendment, 6 behavioral tests](.local/docs/seals/seal-15-track3-silent-degradation.md).
> Seal #16 — [F1 activeJobs Map watchdog in fetch-orchestrator + F2 Gemini AbortController.signal wired into GenerateContentConfig.abortSignal](.local/docs/seals/seal-16-followups.md).
> Seal #17 / Track #4 — [Grafana dashboard + in-app Continuity panel + admin endpoints + skip-reason badge](.local/docs/seals/seal-17-track4-observability.md).
> Seal #18 / Track #5 — [18 deterministic behavioral lifecycle scenarios + harness + 100-iteration flake checker](.local/docs/seals/seal-18-track5-lifecycle-tests.md).
> Seal #19 / Track #6 — [8-audit verdict matrix + evidence per audit + allowlist drift note](.local/docs/seals/seal-19-track6-audits.md).

### Canonical Fact Ownership — Phase 1 (Task #64)

**Founding principle:** every persisted fact has exactly one authoritative writer. Drift between writers, demoted columns, and bypass paths through legacy gates were producing contradictory state across the strategy layer. Phase 1 establishes the single-writer doctrine for `strategy_memory` + two new operational tables, merges the dual memory-write gates into one, and wires a CV-06 provenance metric so any future drift is observable.

| # | Rule | Enforcement |
|---|---|---|
| **CFO-1** | **Single writer per fact.** `strategy_memory` is written ONLY through `memoryStore` (`server/memory-system/store.ts`) via `upsertByFingerprint`, `updateById`, or `applyDecayUpdate`. | Custom ESLint rule `canonical-fact/no-direct-strategy-memory-write` (`.local/eslint-rules/no-direct-strategy-memory-write.js`) bans `db.insert(strategyMemory)` / `db.update(strategyMemory)` outside the store. Allowlist: `server/memory-system/store.ts`, `server/tests/**`, `server/migrations/**`. Steady-state violation count: 0. |
| **CFO-2** | **Operational state is not strategy.** `content_rhythm` and `exploration_budget` live in `engine_operational_state` (singleton per `accountId,campaignId,stateType`) — never `strategy_memory`. Mutation runs live in `mutation_log`. Agent tool actions live in the operational store under `stateType=agent_rhythm`. | Dedicated stores: `operational-state-store.ts`, `mutation-log-store.ts`. All 6 legacy writers (adaptive-rhythm, exploration-budget, chat/routes ×2, autonomous-worker, memory-mutation/engine) refactored. Readers in `manager.ts`, `system-control/full-report.ts`, `autonomous-worker.ts` updated to use the operational store. |
| **CFO-3** | **One gate, not two.** The old `validateDecisionForMemoryWrite` shim now delegates to `policyEnforcedMemoryCheck`. The `OPERATIONAL_MEMORY_TYPES` bypass that let operational writes skip the threshold is REMOVED — operational types are now banned from `strategy_memory` outright by CFO-2 and have no policy gate to skip. | `server/decision-policy/index.ts`. Shim retained for backward-compat call sites; new code MUST call `policyEnforcedMemoryCheck` directly. |
| **CFO-4** | **Every write is observable.** Every attempt through `memoryStore` records to `cv06_memory_writes_total{outcome,memoryType,engine}` (Counter). | `server/memory-system/cv06-metrics.ts` exposed via `renderCv06Metrics()` appended to `/metrics`. Outcomes: `inserted \| updated \| blocked \| decay`. Steady-state observation: non-zero `outcome="blocked"` is healthy (gate working); any non-memoryStore engine label means the ESLint rule has been suppressed. |
| **CFO-5** | **Demoted columns are display-only.** `strategy_memory.is_winner` and `confidence_score_normalized` retained for backfill compat; MAY NOT be read by orchestration, gate, or scoring logic. Replacement: `confidence_score` (canonical) + `direction ∈ {reinforce|avoid|neutral}`. | Migration `024_canonical_fact_ownership.sql` (REQUIRED_SCHEMA_VERSION=24) creates `mutation_log`, `engine_operational_state`, and adds the unique index on `(account_id, campaign_id, state_type)` enforcing the operational singleton. |

**Documented drift (Phase 1 scope deferral):**
- **Step 4 (snapshot ID column drops)** deferred — 6 downstream consumers across plan synthesis, system-control, recovery, agent-stream make this risky to land alongside the writer consolidation. Tracked as Phase 2 follow-up.
- **Step 3 AEL ephemeral doctrine** — provenance guard note only; no code changes this phase. Tracked as Phase 2 follow-up.

Reference implementation: `upsertByFingerprint` in `server/memory-system/store.ts`. Stores: `operational-state-store.ts`, `mutation-log-store.ts`. Migration: `server/migrations/sql/024_canonical_fact_ownership.sql`.

### Memory Unification — Phase 2 (Task #65)

**Founding principle:** the chain from "decision made" → "outcome observed" → "memory reinforced" MUST be FK-bound, single-source-of-truth, and silent-zero-row-proof. Phase 2 closes the DEC-B bug (outcome-tracker silently updated zero rows because `WHERE strategy_memory.id = strategy_decisions.id` is an id-space mismatch), unifies decay to a single read-time layer, replaces silent catches on the memory write path, and adds an immutability trigger so an evaluated `decision_outcomes` row can never be re-evaluated.

| # | Rule | Enforcement |
|---|---|---|
| **MU-1** | **Reinforce by FK, never by PK collision.** Outcome-tracker MUST reinforce memory via `memoryStore.reinforceByDecisionId(accountId, campaignId, decisionId, patch)` — which looks up `strategy_memory.decision_id = decisionId` and applies the gate-checked update. The pre-#65 `updateById(p.decisionId, ...)` path is FORBIDDEN. | `server/outcome-tracker.ts` migrated. `reinforceByDecisionId` returns `{ boundRowCount }`; `boundRowCount=0` triggers the `MEMORY_UNBOUND` log line + CV-11 increment. |
| **MU-2** | **Outcome rows are immutable once evaluated.** `decision_outcomes` rows with non-null `outcome` MUST NOT be re-updated. Defence-in-depth: (a) outcome-tracker's UPDATE carries `WHERE outcome IS NULL` + `.returning()`; (b) DB-level `BEFORE UPDATE` trigger `decision_outcomes_immutability_check` RAISES on any attempted re-evaluation. | Migration `025_memory_unification.sql`. Trigger fires only when `OLD.outcome IS NOT NULL` AND `NEW.outcome IS DISTINCT FROM OLD.outcome` (allows administrative metadata patches). |
| **MU-3** | **Single decay layer.** Read-time multiplicative decay (`computeEffectiveConfidence` in `memory-system/manager.ts`) is canonical. Write-time half-life decay (`computeDecay` + `applyConfidenceDecay` + the per-row decay loop in `memory-mutation/engine.ts`) is REMOVED. | `summary.decayed` is held at 0 going forward; `mutation_log.decayed_count` column retained for schema back-compat. |
| **MU-4** | **Write-time fingerprint contradiction resolver.** Same-fingerprint flip (`reinforce`↔`avoid`) is REJECTED unless incoming confidence is *strictly greater* than existing — prevents the "two engines disagree, last-writer wins" race. | `upsertByFingerprint` in `memory-system/store.ts`. Rejection returns `{ allowed: false, reason: "CONTRADICTION_REJECTED ..." }`; resolved flips emit `CONTRADICTION_RESOLVED` log. |
| **MU-5** | **Confidence-banded reader.** The strategy-memory reader in `manager.ts` orders by `confidence_score DESC, updated_at DESC` (not pure recency) so high-confidence facts are never evicted by a flurry of recent low-confidence writes. Backed by index `strategy_memory_account_campaign_confidence_idx`. | `server/memory-system/manager.ts` |
| **MU-6** | **Explicit provenance per write.** Every `strategy_memory` write declares `provenance_origin ∈ {outcome \| mutation \| engine_seed \| exploration \| decay \| unknown}`. Default is `outcome` when `sourceOutcomeId` is set, else `engine_seed`. Pre-#65 rows retain `unknown`. | Migration `025`; `MemoryWriteInput.provenanceOrigin` + `updateById.provenanceOrigin` + `reinforceByDecisionId` always sets `outcome`. |
| **MU-7** | **No silent catch on the memory write path.** Three pre-#65 bare catches closed: outcome-tracker reinforcement (`REINFORCE_FAILED`), industry-baseline read (`INDUSTRY_BASELINE_READ_FAILED`), snapshot-degradation scan (`SNAPSHOT_PARSE_FAILED`). | Per Seal #15 doctrine. |
| **MU-8** | **CV-11 hallucination-exposure counter.** Every reinforcement attempt that hits `NO_BOUND_ROW` increments `cv11_hallucination_exposure_total{kind,engine}`. Steady-state expectation = 0; any positive rate means upstream writers are not populating `strategy_memory.decision_id` or outcomes are firing for decisions that produced no strategic facts. | `server/memory-system/cv06-metrics.ts`; exposed on `/metrics` via `renderCv06Metrics()`. |

**Schema floor: REQUIRED_SCHEMA_VERSION = 25.** Migration `025_memory_unification.sql` adds `strategy_memory.decision_id` (varchar FK → `strategy_decisions(id)` ON DELETE SET NULL), `strategy_memory.provenance_origin` (text default `'unknown'`), the confidence-banded index, and the `decision_outcomes` immutability trigger.

**8-audit gate (Seal #19):** 7 PASS + 1 DOCUMENTED_EXCEPTION (audit #2 runtime baseline — sunset = first 7d post-deploy). Full matrix: [`.local/docs/seals/task-65-audits.md`](.local/docs/seals/task-65-audits.md). Behavioral tests: `server/tests/memory/phase-2-memory-unification.test.ts` (6 scenarios, hermetic, Seal #18 state-not-logs).

### Beta Safety Doctrine (Task #50)

**Founding principle:** beta safety is a system property — five non-negotiable values codify how every new piece of code, copy, and operator surface MUST behave during the controlled beta and beyond.

| # | Value | Enforcement hook |
|---|---|---|
| **B1** | **Truthfulness over confidence.** Engine outputs MUST report their actual confidence + provenance. A fabricated-looking confident answer is worse than a tagged-degraded honest one. | D1–D5 contracts (`validationState` enum, `signalOriginType`, `synthesisVerification.degraded`, AEL `isPartial`). |
| **B2** | **Visibility over silence.** Every silent path is a runtime degradation. No `} catch {}`, no bare `.catch(() => {})`, no untimed AI call, no anonymous timer handle. | Seal #15 silent-degradation rules (live in `replit.md` above) + Seal #16 AbortController wiring. Reviewer rejects PRs adding silent paths. |
| **B3** | **Safe degradation over fake success.** Fallback / partial / degraded paths MUST tag `SynthesizedPlan.degraded=true` + canonical `PlanSource`. Outcomes from degraded plans MUST NOT feed memory reinforcement. | Seal #19 Audit #6; "Fallback Plan Isolation" + "Memory-to-Outcome Provenance" features. |
| **B4** | **Explicit classification over hidden ambiguity.** Every meaning has its own canonical field with a strict enum; missing canonical → `CONTRACT_INCOMPLETE`, never silent substitution. | D1–D5 (canonical fields, strict enums, `requireContractField`, `classifyTrust`). |
| **B5** | **Operational continuity over feature velocity.** A new feature MUST NOT land without (a) the relevant Seal #19 8-audit gate passing, (b) a corresponding entry in `must-monitor-metrics.md` if it adds runtime behavior, (c) a playbook entry in `playbooks.md` if it adds an alert. | Seal #19 8-audit gate; beta-readiness package ([`.local/docs/beta-readiness/`](.local/docs/beta-readiness/) — mirrored to [`docs/beta-readiness/`](docs/beta-readiness/)). |

**The beta-readiness package is the launch governance reference.** 10 docs cover roadmap (phased rollout with explicit gates), observation plan (operator-surface inventory + gaps), stress-test plan (14 vectors mapped to Seal #18 lifecycle scenarios), rollout strategy (entry/exit criteria per stage), guardrails (toggleable runtime safety nets), risk register, operator-response playbooks, must-monitor metrics, launch constraints (account / AI / scrape caps), and unresolved-risks log with sunset conditions. Mirrored copy lives at `docs/beta-readiness/` (`.local/` is gitignored).

> **Per-stage rollback authority:** any rollback trigger from `roadmap.md` §"Inter-phase rollback triggers" allows the on-call operator to enforce caps via env vars (GR19 `BETA_ADMISSIONS_FROZEN`, GR20 `BETA_ACCOUNT_CAP`) without code change. Lifting a freeze requires architect APPROVED.

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
| `AI_GEMINI_HARD_TIMEOUT_MS` | optional | Gemini wall-clock timeout (default 60s). On timeout, the AbortController also cancels the underlying SDK fetch (Seal #16 / F2). |
| `MI_ACTIVE_JOBS_MAX_AGE_MS` | optional | MIv3 fetch-orchestrator activeJobs Map zombie watchdog ceiling (default 30min). Seal #16 / F1. |

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

### Operations Guardian — OBS-C (Task #60)

Per-provider keying for AI burst collectors: `AI_TIMEOUT_BURST:<provider>` and `AI_PROVIDER_FAILURE_BURST:<provider>` (was `:global`). New `PROVIDER_INSTABILITY:<provider>` cross-signal correlator emits ONE rollup notice (operator-audience only, no USER_COPY promotion, no auto-recovery) when ≥2 of {timeout-burst, failure-burst, latency-degraded} fire for the same provider in the same tick; severity = max via explicit `severityRank()` integer mapping (D1-safe). 69/69 deterministic scenarios pass. Full report: [`.local/docs/audits/operations-guardian-obs-c-2026-05.md`](.local/docs/audits/operations-guardian-obs-c-2026-05.md).

---

## Seal archive index

Each per-seal file contains the full implementation detail, code references, test pointers, and historical justification. The `replit.md` rules above are the authoritative live doctrine; the archive files are read-only history.

- [`.local/docs/seals/semantic-contract-hardening-h1-h7.md`](.local/docs/seals/semantic-contract-hardening-h1-h7.md) — D1–D5 detail, Seal #9 closures, suppression allowlist, transitional exceptions, canonical field names.
- [`.local/docs/seals/seal-13-track1-continuity.md`](.local/docs/seals/seal-13-track1-continuity.md) — Hourly scheduler, idempotent invocation, long-gap re-anchor, missed-window detection, schema migration 021.
- [`.local/docs/seals/seal-14-track2-multireplica.md`](.local/docs/seals/seal-14-track2-multireplica.md) — DB claim handshake, 10-chain registry, supervisor, 12 Prometheus metrics, schema migration 022.
- [`.local/docs/seals/seal-15-track3-silent-degradation.md`](.local/docs/seals/seal-15-track3-silent-degradation.md) — 9 closed silent-degradation findings, 4 deferred items, architect race-fix amendment, 6 behavioral tests.
- [`.local/docs/seals/seal-16-followups.md`](.local/docs/seals/seal-16-followups.md) — Track #3 follow-ups: F1 activeJobs Map watchdog in fetch-orchestrator, F2 Gemini AbortController.signal wired into GenerateContentConfig.abortSignal.
- [`.local/docs/seals/seal-17-track4-observability.md`](.local/docs/seals/seal-17-track4-observability.md) — Track #4: Grafana dashboard + in-app Continuity panel (6th Audit & Control panel) + admin endpoints + skip-reason badge on campaign cards.
- [`.local/docs/seals/seal-18-track5-lifecycle-tests.md`](.local/docs/seals/seal-18-track5-lifecycle-tests.md) — Track #5: 18 deterministic behavioral lifecycle scenarios + harness + 100-iteration flake checker.
- [`.local/docs/seals/seal-19-track6-audits.md`](.local/docs/seals/seal-19-track6-audits.md) — Track #6: 8-audit verdict matrix (7 PASS + 1 DOCUMENTED_EXCEPTION on runtime baseline) + evidence per audit + allowlist drift note folded forward.
- [`.local/docs/seals/seal-20-track7-doctrine-lock.md`](.local/docs/seals/seal-20-track7-doctrine-lock.md) — Track #7: doctrine lock — consolidates Seals #13–#19 active doctrine into one `replit.md` section + parity checklist + ships the operator handoff one-pager.
- [`.local/docs/operator-handoff-continuity.md`](.local/docs/operator-handoff-continuity.md) — operator handoff one-pager (dashboard URLs + alert thresholds + env-var reference + heartbeat-red decision tree). Companion to Seal #20.
- `.local/docs/seal-13-to-17-plan.md` — original Tracks #1–#7 design plan (pre-existing).

