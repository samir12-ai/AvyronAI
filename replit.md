# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, offering a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It features dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization. Engine components use a "lazy mount, keep alive" rendering pattern.

### Backend
The backend employs Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode with dual-window retention and latest-per-campaign protection.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine, and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines**: Includes Positioning, Differentiation (V8), Mechanism, Offer, Funnel, Integrity, Awareness, and Persuasion (V4) Engines, designed to generate comprehensive strategic plans. The Offer Engine uses a deterministic skeleton architecture when a Strategy Root is active, ensuring strategic alignment.
- **Strategy Root System**: A unified source of truth (`strategy_roots` table) binding all strategic engines via a single enforced root hash, ensuring data consistency and staleness detection.
- **Product DNA**: A source-of-truth layer (`business_data_layer`) injected into all strategic engines for identity context in AI prompts.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis with multi-source intelligence and signal normalization.
- **Authority Hierarchy Enforcement**: Strict Awareness → Funnel → Persuasion authority hierarchy with cross-engine validation to prevent contradictions.
- **Analytical Enrichment Layer (AEL v2)**: A deep causal interpretation layer (`server/analytical-enrichment-layer/`) that produces WHY-level analysis — root causes beneath surface signals, causal chains (pain→cause→impact→behavior), buying barriers with buyer internal thinking, mechanism comprehension gaps, trust gaps with proof requirements, contradiction/misleading signal detection, and priority-ranked insights by conversion impact. 9 output dimensions: `root_causes`, `pain_types`, `causal_chains`, `buying_barriers`, `mechanism_gaps`, `trust_gaps`, `contradiction_flags`, `priority_ranking`, `confidence_notes`. Built once after MI+Audience in the orchestrator, injected into all 6 downstream engine prompts. Includes quality validation (rejects surface-level labels, demands causal reasoning). Frontend Deep Analysis Panel in AI Management (Strategies tab) with per-dimension card rendering. Version 2, 10-min cache TTL.
- **Causal Enforcement Layer (CEL)**: A post-generation compliance layer (`server/causal-enforcement-layer/`) that programmatically enforces alignment between AEL root causes and all downstream engine outputs. 7 constraint rules: TRUST_OPACITY, VALUE_PERCEPTION, MECHANISM_COMPREHENSION, FEAR_RISK, IDENTITY_STATUS, KNOWLEDGE_GAP, OVERWHELM_COMPLEXITY. Pre-generation: `buildCausalDirectiveForPrompt()` injects hard constraints into engine prompts (all 6 downstream engines including Mechanism). Post-generation: `enforceEngineDepthCompliance()` (universal, hard enforcement) checks every engine output for: root cause grounding, causal chain usage, barrier resolution, behavioral impact language, generic term detection, and shallow marketing pattern detection. Severity: blocking violations → confidence=0; major → -0.30; minor → -0.10. `DepthComplianceResult` includes `causalDepthScore`, per-dimension diagnostics, and reference counts. All 6 downstream engines (Differentiation, Mechanism, Offer, Funnel, Awareness, Persuasion) return `celDepthCompliance` in their output, tracked by the orchestrator. Mechanism Engine now has full AEL injection (prompt + post-gen depth check). API: `GET /api/cel/report/:campaignId`, `GET /api/cel/rules`. Frontend: `CELCompliancePanel` in AELDebugPanel showing per-engine depth scores, diagnostic tags (root causes/causal chains/barriers/behavioral presence), reference counts, and violation details.
- **Structured Signal Flow (Audience → Positioning)**: The Audience Engine outputs `structuredSignals` with 5 categories: `pain_clusters`, `desire_clusters`, `pattern_clusters`, `root_causes`, `psychological_drivers`. Each cluster has `id`, `label`, `frequency`, `confidence`, `evidence[]`, and `sourceLayer` (surface/pattern/interpretation). `MIN_EVIDENCE_PER_SIGNAL=3` enforces evidence quality. The Positioning Engine requires valid structured signals (`SIGNAL_REQUIRED` if absent/malformed). Signal enforcement failure returns `SIGNAL_DRIFT`. **Orchestrator cascade**: `SIGNAL_CASCADE_MAP` blocks downstream on `SIGNAL_REQUIRED`, `SIGNAL_DRIFT`, and `SIGNAL_GROUNDING_FAILED`.
- **Differentiation Signal Grounding Enforcement**: L12 stability guard uses hard `groundingFailures`. Signal grounding enforcement loop (max 3 attempts) wraps L11 AI refinement: validates proofability ≥ 0.30, trust alignment ≥ 0.15, no all-weak claims (MIN_PILLAR_SCORE=0.35), AND generic output detection — rejects and re-prompts with specific grounding rejection context. **On exhaustion**: returns `SIGNAL_GROUNDING_FAILED` with confidence=0 and empty result. **Evidence density matching**: `validateTerritoryEvidenceDensity` uses expanded territory text (name + description + category) for Jaccard matching against trust gaps and competitor claims. Trust gaps carry `relatedTerritories[]` pre-computed in L5 for reliable evidence source matching. L4 `transparency_proof` maps to both objection keys and territory names. Grounding loop re-runs evidence density validation and L10 scoring after each L11 refinement so retries can improve scores.
- **Signal Governance Layer (SGL)**: A unified signal source-of-truth (`server/signal-governance/`) that ALL downstream engines consume from. Initializes after the Audience Engine with structured signals (pain, desire, objection, pattern, root_cause, psychological_driver). Each engine calls `resolveSignalsForEngine(engineId)` which validates coverage requirements, tracks consumption, and ensures signal traceability via `traceToken`. Enforces minimum signal coverage per category (pains≥2, desires≥2, objections≥1). Sanitizes signals against leakage patterns (raw URLs, secrets, debug comments). Produces governance summary with consumption log per engine. API: `GET /api/system-integrity/:campaignId`.
- **System Integrity Validator (SIV)**: End-to-end verification layer (`server/system-integrity/`) that runs after all engines complete. Validates per-engine: signal reception, output traceability, signal mapping completeness, zero raw data passthrough, upstream alignment, leakage detection, orphan output detection. Cross-engine alignment validation checks vocabulary overlap between consecutive engines (Audience→Positioning→Differentiation→Mechanism→Offer→Funnel, Audience→Awareness→Persuasion). Produces `IntegrityReport` with `PASS/FAIL/PARTIAL` status. Frontend: `SystemIntegrityPanel` in AI Management (Strategies tab) shows per-engine checks, cross-engine alignment bars, failure reasons, and SGL trace token.
- **AI Orchestrator**: Single-entry orchestration engine running 14 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis. Integrates SGL initialization after Audience Engine and SIV validation after all engines complete.
- **BuildPlanLayer (Decision + Execution Layer)**: A final decision layer (`server/build-plan-layer/`) that sits after all engines and converts analysis into clear, actionable decisions. Consumes validated outputs from all 9 engines (MI, Audience, Positioning, Differentiation, Mechanism, Offer, Funnel, Awareness, Persuasion) — only outputs that passed DepthGate and SignalGrounding are consumed. Compresses into exactly 7 decision blocks: Positioning (one sentence), Differentiation (one angle), Mechanism (name + explanation), Offer (ready-to-use statement), Funnel (3 steps: top/middle/bottom), Content DNA Plan (weekly structure + content types), KPI/Execution Rules (frequency/mix/targets). Actionability Enforcement (`enforceActionability()`) validates every decision block for specificity, clarity, and direct usability — rejects vague/generic outputs with max 3 regeneration attempts, returns `ACTIONABILITY_FAILED` on exhaustion. API: `POST /api/build-plan-layer/generate`, `GET /api/build-plan-layer/latest`. Frontend: `ExecutionPlan` component displays 7 cards with clean UI (no scores/diagnostics), "Generate Calendar" CTA below cards. Replaces old `ExecutionPipeline` on dashboard; added to Pipeline tab in AI Management.
- **Execution Activation Layer**: Auto-triggers the content production pipeline upon plan approval, enforcing content queue minimums and scheduling completeness.
- **Execution Pipeline**: An 11-stage pipeline for plan execution with real-time status tracking (retained as legacy view alongside new Execution Plan).
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine (V4), Iteration Engine, and Retention Engine. The Budget Governor reconciles `validationConfidence` with actual campaign performance metrics. The Channel Selection Engine V4 implements awareness-driven hard blocking of channels.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data.
- **Concurrency Hardening**: Includes lock timeouts, batched deduplication, and stale recovery safeguards.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Audit & Control System**: A 5-panel dashboard for auditing feeds, AI usage, gate status, decisions, publish history, and job management.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Database
- PostgreSQL

### User Authentication
- Meta OAuth

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok