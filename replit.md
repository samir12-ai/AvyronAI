# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. Its primary purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, providing a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It supports dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization. Engine components utilize a "lazy mount, keep alive" rendering pattern.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode with dual-window retention and latest-per-campaign protection.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine, and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines**: Includes Positioning, Differentiation, Mechanism, Offer, Funnel, Integrity, Awareness, Persuasion Engines. The Differentiation Engine (V8) uses a dual signal model (Profile 40% / Market Intelligence 60%) with soft-warning mode for low signal grounding instead of hard failures. The Mechanism Engine sits between Differentiation and Offer, enforcing axis-aligned mechanism generation: mechanism = f(positioningAxis, contrastAxis, differentiationPillars). It validates axis consistency and feeds centralized mechanisms to the Offer Engine. Axis propagation: mechanism engine's `primaryAxis` + `axisEmphasis` are enriched into `positioning.contrastAxis` for downstream validators. The Offer Engine now consumes Strategy Root approved fields (approvedClaim, approvedPromise, approvedTransformation, approvedAudiencePains, approvedDesires, approvedMechanism) as primary AI prompt inputs — axis token enforcement is hard-enforced post-generation with automatic corrective retry. Post-gen validation checks axis_mismatch, mechanism_mismatch, and audience_pain_alignment. The offer snapshot stores `structuralWarnings` and `layerDiagnostics` with axis enrichment details and `rootAxisEnforcement` diagnostics.
- **Strategy Root System**: A unified source of truth (`strategy_roots` table) binding all 5 strategic engines via a single enforced root hash. Created automatically after mechanism engine completion. Contains approved axis, mechanism, audience pains, desires, transformation, and all upstream snapshot IDs. The Offer Engine enforces root-scoped routing: ALL snapshots (MI, Audience, Positioning, Differentiation, Mechanism) are resolved from the active root's bound IDs — generation is blocked if no active root exists or the root is incomplete. When any upstream engine (MI, Audience, Positioning, Differentiation) regenerates, hard cascade invalidation marks stale offer/funnel/integrity snapshots referencing the superseded root. The `strategyRootId` column links offer/funnel/integrity snapshots back to their root. API: `GET /api/strategy-root/active` (returns `snapshotBindings` and `allSnapshotsValid`), `GET /api/strategy-root/validate` (detects drift between root's bound snapshot IDs and latest engine outputs). Module: `server/shared/strategy-root.ts` with `buildStrategyRoot`, `getActiveRoot`, `validateRootBinding`, `invalidateDownstreamOnRegeneration`, `validatePreGeneration`, `validatePostGeneration`. Frontend shows `rootSyncStatus` (synced/stale/no_root) on the Offer Engine and snapshot binding details on the Mechanism Engine's Strategy Root card.
- **Product DNA**: A source-of-truth layer stored in `business_data_layer` (5 fields: productCategory, coreProblemSolved, uniqueMechanism, strategicAdvantage, targetDecisionMaker). Loaded via `server/shared/product-dna.ts` and injected into all 5 strategic engines (Audience, Positioning, Differentiation, Offer, Persuasion) as identity context in AI prompts.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis with multi-source intelligence (Instagram, Website, Blog). Website scraper extracts headlines, CTAs, offers, pricing, proof/testimonials, and guarantees via proxy-integrated structured extraction. Signal normalizer classifies signals into positioning/offer/content/educational/proof/CTA categories with weighted source reconciliation. All 9 downstream engines consume multi-source signals for enriched analysis. MI minimum data safeguards are advisory-only — the system always proceeds with available data instead of blocking on thresholds.
- **AI Orchestrator**: Single-entry orchestration engine that runs 14 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis.
- **Plan-First Dashboard**: Provides a hierarchical view of performance, active plan status, execution pipeline, required work, and advanced insights.
- **Content DNA**: Foundational content creation blueprint synthesized from engine outputs and business profile into structured rules and an execution framework.
- **MarketMind Agent**: A density-optimized strategy command center providing status, campaign overview, AI strategic insights, priority actions, and an interactive chat.
- **Agent Chat**: Multi-conversation agent with full system context injection.
- **Roots Foundation (V1)**: Unified root schema with 5 layers that captures the complete strategic foundation into a versioned, hashable bundle, ensuring root integrity and staleness detection.
- **Goal Decomposition Math Layer (Phase 2)**: Handles goal normalization, 6-stage funnel math, feasibility analysis, and 3-scenario lever-based growth simulation.
- **Business Archetypes & Plan Gate (Phase 3)**: Defines 6 adaptive business archetypes and a plan readiness gate that validates business clarity, goal specificity, and execution readiness.
- **Execution Task System (Phase 4)**: Auto-generates daily/weekly execution tasks from plan content distribution.
- **Conflict Resolution & Assumption Ledger (Phase 5)**: Manages conflict resolution with a 9-level priority policy and logs implicit assumptions with confidence and impact.
- **Execution Pipeline**: An 11-stage pipeline for plan execution with real-time status tracking.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine, Iteration Engine, and Retention Engine.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data.
- **Semantic Data Bridge**: Wires MIv3 high-fidelity signals into the Audience Engine's core maps.
- **Concurrency Hardening**: Includes MIv3 lock timeouts, batched Jaccard deduplication, and stale recovery safeguards.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Governance Rules**: 6 rules for strategy correction transparency and an audit trail.
- **Input Validation Gates**: Mandatory input gates for Iteration and Retention Engines to ensure foundational data is provided.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

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