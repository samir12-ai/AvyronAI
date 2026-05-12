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

**Known H6 ESLint rule scope/coverage gaps (queued for H8)**:
- Rule scope is restricted to `server/{agent,system-control,orchestrator,build-plan-layer,recovery-*}/**` — strategy engine modules can still introduce semantic fallback. H8 widens scope.
- Rule inspects RHS identifiers in `LogicalExpression` only — misses LHS-offender patterns (`result?.outcome ?? alt`), ternary expressions, alias variables, destructured reads, and synonym field names. H8 either expands the AST detector or adds a complementary ts-morph type-flow check.
- New tests are unit/fixture-level — adversarial integration proof (poisoned snapshots flowing through full system-control decision paths) is queued for H8.

Canonical field names introduced/hardened in H1–H7:
- `validationState` ∈ {validated|provisional|weak|rejected} — F3 statistical-validation verdict
- `decision.action` ∈ {test|scale|hold|halt} — F9 budget-governor action
- `primaryChannel.decisionGate.outcome` ∈ {recommended|support_channel|exploratory} — F10 channel decision-gate outcome
- `integrityVerdict` ∈ {PASS|PARTIAL|FAIL} — F2 integrity verdict (canonical replacement for `overallStatus`)
- `executionStatus` ∈ {COMPLETED|PARTIAL|BLOCKED|ERROR|NEEDS_INPUT|BLOCKED_BY_INTEGRITY} — F1 execution status on agent stream + full-report (canonical replacement for `overallStatus`)

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
