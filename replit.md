# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. It automates content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, providing a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend utilizes Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist (including text-to-video and image-to-video).
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines (V3)**: A suite of advanced AI engines including Positioning Engine, Offer Engine (V5) with pre-generation constraint architecture, Funnel Engine, Integrity Engine, Awareness Engine, Persuasion Engine, and Differentiation Engine (which generates a structured MechanismCore).
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, including narrative objection extraction, clustering, and content DNA bridging. Features a Signal Quality Gate to ensure data reliability and deduplication.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **System Hardening**: Includes extensive indexing, unique constraints, Zod-based request validation, self-healing snapshot resolution, a shared hardening library, and system-wide fail-safe enforcement. All engines guarantee non-empty outputs even on guard blocks or missing data. Warning deduplication (`deduplicateWarnings`) and hypothesis deduplication (`deduplicateByField`) prevent duplicate signals. System health endpoint (`/api/system/health`) validates all engine versions and dependencies at runtime. Startup audit confirms all engine versions are compatible before accepting requests. Cross-engine isolation validation endpoint (`/api/system/validate-isolation`) blocks prohibited cross-engine writes (41 isolation rules active, including `retention_metrics` protection).
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes a Statistical Validation Engine (V4) for signal-grounded claims, Budget Governor Engine, Channel Selection Engine (V3 with Funnel Resolution), Iteration Engine (with Benchmark Exploration Mode), and Retention Engine (with structural completeness guarantees).
- **Iteration Engine Benchmark Exploration**: When no campaign data exists, the engine enters BENCHMARK_EXPLORATION mode instead of returning empty results. Generates baseline experimentation hypotheses (creative hook, audience targeting, landing page, offer format), optimization targets, and a 3-step exploration plan. Normal flow also injects fallback hypotheses if data-driven generation produces zero results. GUARD_BLOCKED status provides safe baseline hypotheses instead of empty arrays.
- **Retention Engine Structural Completeness**: Fallback mode always generates 4 retention mechanisms: Post-Purchase Value Reinforcement, Engagement Check-in Loop, Post-Purchase Reinforcement Sequence, Win-Back Re-engagement Loop. Also produces 2 churn risk flags and 1 LTV expansion path. If AI returns empty arrays, baseline mechanisms are injected. GUARD_BLOCKED status returns fallback retention loops instead of empty arrays.
- **Cross-Engine Isolation**: Enforced via `server/strategy/dependency-validation.ts`. Each engine has prohibited write targets preventing cross-domain interference: Channel→no iteration/retention writes, Budget→no channel/iteration/funnel writes, Iteration→no budget/channel/retention/funnel writes, Retention→no budget/channel/iteration/funnel writes. `funnel_stage_assignment` is protected from all external engines (36 total isolation rules). Runtime validation available via POST `/api/system/validate-isolation`. All engines validate dependencies before execution (503 on version mismatch).
- **Channel Selection Engine V3 (Funnel-Oriented Resolution)**: Adds a Funnel-Oriented Channel Resolution Layer between the Persuasion Engine scoring and the Decision Gate. When persuasion-channel incompatibilities are detected, the system attempts funnel reconstruction before rejecting channels. Channels are classified into three funnel roles: Awareness (attention capture), Nurture (education/trust building), Conversion (transactional commitment). Each channel is evaluated against `CHANNEL_FUNNEL_CAPABILITIES` which defines awareness/nurture/conversion fit scores and persuasion depth (shallow/moderate/deep). Channels that fail persuasion compatibility but meet funnel role thresholds are rescued and reassigned to their best-fit funnel stage. Only channels that fail both persuasion compatibility AND have no viable funnel role are rejected. Guard/budget failures still block reconstruction. The result includes a `funnelReconstruction` object with `funnelStages` (awareness/nurture/conversion arrays), `reconstructionLog` (auditable decisions), `channelsRescued`, and `channelsStillRejected`. New status: `FUNNEL_RECONSTRUCTED`. The Decision Gate still validates after reconstruction. The Funnel Resolution Layer does NOT modify persuasion outputs (engine isolation preserved). Budget allocation normalization (100% across paid channels) and organic channel zero-budget rules still apply.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Engine Tab Persistence (Keep-Alive Pattern)
Engine components in AI Management (Positioning, Differentiation, Offer, Funnel, Integrity, Awareness, Persuasion, Statistical Validation, Budget Governor, Channel Selection, Iteration, Retention) use a "lazy mount, keep alive" rendering pattern. Once an engine tab is first visited, the component stays mounted (hidden with `display: 'none'`) when switching to other tabs, preserving React state and analysis results without requiring re-fetch from the database.

### Snapshot Lifecycle Management
Operates in DATA_ARCHIVING mode (not immediate purge). COMPLETE/RESTORED/PARTIAL snapshots are protected for 30 days minimum. INCOMPATIBLE snapshots are archived to `snapshot_archive` table for recovery instead of deleted. Active session protection ensures the latest snapshot per campaign per table is never cleaned. The worker delays initial run by 5 minutes after startup. Only orphaned data (no parent campaign) and non-protected data exceeding the 30-day cold storage limit are targeted for cleanup. Per-campaign cap remains at 20 snapshots.

### Data Source Mode System (Adaptive Architecture)
Campaigns support two data source modes: `campaign_metrics` and `benchmark`. Mode stored in `campaign_selections.dataSourceMode` (default: `benchmark`). The system now features **Adaptive Data Source Switching** — a controlled architecture that automatically transitions between modes while preserving analytical integrity.

**Adaptive Switching Rules**: Benchmark → Campaign Metrics transition allowed only when conversions ≥ 50 OR spend ≥ $1,000. If thresholds not met, system remains in Benchmark Mode. Each decision snapshot stores `dataSourceMode`, `dataSourceConfidence`, `dataOrigin` (benchmark_static/benchmark_contextual/campaign_verified/campaign_fallback), and `switchReason`.

**Statistical Validity Layer** (`server/data-source/statistical-validity.ts`): Gates all scaling decisions. Minimum thresholds: 30 conversions + $500 spend. If either threshold is unsatisfied, scaling is blocked regardless of data source mode (applies even to pure benchmark with high confidence). Functions: `assessStatisticalValidity()`, `evaluateTransitionEligibility()`, `shouldBlockScaling()`.

**Contextual Benchmark Confidence**: Benchmarks carry per-entry `confidenceWeight` values derived from region, platform, and industry/segment context. Example: Dubai/Meta/SMB = 0.72 vs Global/LinkedIn/SaaS = 0.45. Benchmark resolution now accepts optional segment parameter (inferred from `campaignGoalType`). Data: `server/data-source/benchmarks.ts`.

**Projection Guard**: All benchmark-derived outputs flagged with `isProjectionOnly: true`. Scaling decisions remain conservative until campaign data becomes statistically reliable. Frontend displays "Projection Only" badge on benchmark-sourced data.

**Transition Logging**: Every mode switch persisted to `data_source_transitions` DB table with `previousMode`, `newMode`, `transitionReason`, `statisticalEvidence`, `triggeredBy` (adaptive_switch/manual/validation_fallback). Transition log is durable and audit-grade.

**Data Isolation**: Benchmark-derived and campaign-derived decisions never merged into the same scoring model. Each data origin clearly tracked.

REST API routes: `/api/data-source/resolve`, `/api/data-source/benchmarks`, `/api/data-source/benchmarks/all`, `/api/data-source/validate-metrics`, `/api/data-source/mode`, `/api/data-source/statistical-validity`, `/api/data-source/transition-eligibility`, `/api/data-source/transition-log`.

### Snapshot Trust & Freshness System
A core module for temporal decay scoring, schema validation, and freshness classification, providing staleness coefficients, freshness classes (FRESH/AGING/NEEDS_REFRESH/PARTIAL/INCOMPATIBLE), trust scores, and strategy-blocking statuses. Freshness metadata is included in all engine route responses and triggers frontend warnings.

### Semantic Data Bridge (MIv3 → Audience Engine)
A strategic data bridge that wires MIv3 high-fidelity signals directly into the Audience Engine's core maps (Pain Profiles, Desire Maps, Objection Maps). It features clean-pipe architecture (signals must have >0.85 confidence), full traceability with parentSignalId, and a conflict resolution protocol where MIv3 quality-gated signals take precedence as Strategic Anchors.

### Concurrency Hardening
Includes MIv3 lock timeouts, batched Jaccard deduplication for signals, and a stale recovery safeguard to prevent overwriting active sessions.

### Scalability and Thundering Herd Protection
Features a global job queue with configurable concurrency limits, per-account job budgets, a shared market data cache, request deduplication, queue prioritization, backpressure mechanisms, and a rate gate.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Database
- PostgreSQL

### User Authentication
- Meta OAuth

### Meta Business Suite Integration
- Secure token storage with AES-256-GCM encryption.
- Full-scope OAuth for permission management.

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok