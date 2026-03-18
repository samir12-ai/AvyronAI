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
- **Structured Signal Flow (Audience → Positioning)**: The Audience Engine outputs `structuredSignals` with 5 categories: `pain_clusters`, `desire_clusters`, `pattern_clusters`, `root_causes`, `psychological_drivers`. Each cluster has `id`, `label`, `frequency`, `confidence`, `evidence[]`, and `sourceLayer` (surface/pattern/interpretation). The Positioning Engine operates as a **selection engine** — Layer 11 is constrained to only select from structured signals (no generative fallbacks). Post-generation `validateSignalTraceability()` checks that every positioning element maps to an audience signal, penalizing unmapped elements. Signal traceability (coverage %, used signal IDs, unmapped elements, pass/fail) is stored in positioning snapshots and exposed via API. Frontend `SignalFlowPanel` component in AI Management (Strategies tab) shows signal categories with used/unused indicators and traceability summary.
- **AI Orchestrator**: Single-entry orchestration engine running 14 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis.
- **Execution Activation Layer**: Auto-triggers the content production pipeline upon plan approval, enforcing content queue minimums and scheduling completeness.
- **Execution Pipeline**: An 11-stage pipeline for plan execution with real-time status tracking.
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