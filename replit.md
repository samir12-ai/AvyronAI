# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that uses AI to generate social media content, manage campaigns, schedule posts, and provide analytics. Its main purpose is to streamline marketing workflows, enhance brand presence through AI-powered content creation, and offer strategic insights. The project aims to act as an "AI Agency Replacement" focused on revenue generation and autonomous marketing capabilities, transforming strategic blueprints into published content through a controlled execution pipeline.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Monorepo Structure**: Shared codebase for client and server.
- **Type Safety**: Full TypeScript with strict mode.
- **Platform Abstraction**: Components designed for iOS, Android, and Web compatibility.
- **Dynamic Theming**: Support for light and dark modes.

### Frontend
- **Framework**: Expo SDK with React Native (new architecture).
- **Navigation**: Expo Router (file-based routing).
- **State Management**: React Context API for global state, TanStack React Query for server state.
- **Internationalization**: i18n-js for 32 languages.
- **UI/UX**: Custom component library, React Native Reanimated for animations.

### Backend
- **Server**: Express.js with Node.js and TypeScript.
- **API Design**: RESTful endpoints.
- **AI Integration**: Dual-AI engine utilizing OpenAI GPT and Google Gemini for content and strategy, with specialized models for AI image/design.
- **Autonomous Engine**: Production-safe backend with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop supporting autopilot for low-risk marketing decisions.

### Data Storage
- **Client-side**: AsyncStorage for local data.
- **Server-side**: PostgreSQL with Drizzle ORM for user data and chat conversations.

### Key Features
- **Dashboard**: Revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Manager, and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor with FFmpeg, and AI Video Analysis Assist. Integration with Google Veo 3.1 for text-to-video and image-to-video generation. Studio item detail view at `/studio/:itemId` with analysis results, retry capability, and polling.
- **Save State Machine**: All save flows (Writer, Designer, Video) use a `saveState` (idle→saving→analyzing→done/error) for visible progress feedback. Error states persist for 3s without navigating away.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Competitive Intelligence**: Real-data competitor analysis system governed exclusively by Market Intelligence V3 (MIv3). All CI tabs (Overview, Dominance, Actions, History) derive from the same MIv3 snapshot. No cross-engine calls allowed from this section.
- **Market Intelligence V3**: Deep Predictive Adaptive Architecture in `server/market-intelligence-v3/`. 5-layer pipeline: Proxy Extraction → Normalization → Snapshot Store (Versioned) → Signal Engine → Intent & Trajectory Engine. Engines operate only on stored snapshots, never live scrape data.
  - **Signal Engine**: 9 deterministic numeric signals per competitor (postingFrequencyTrend, engagementVolatility, ctaIntensityShift, offerLanguageChange, hashtagDriftScore, bioModificationFrequency, sentimentDrift, reviewVelocityChange, contentExperimentRate). No LLM calls for quantitative signals.
  - **Intent Classification**: 7 categories (DEFENSIVE, AGGRESSIVE_SCALING, TESTING, POSITIONING_SHIFT, PRICE_WAR, DECLINING, STABLE_DOMINANT) via weighted formula scoring. No direct labeling.
  - **Market Trajectory**: 5 indices (MarketHeatingIndex, NarrativeConvergenceScore, OfferCompressionIndex, AngleSaturationLevel, RevivalPotential). RevivalPotential capped at 0.7 unless specific conditions met.
  - **Confidence Model**: 6 factors (dataCompleteness, freshnessDecay, sourceReliability=0.75, sampleStrength, crossCompetitorConsistency, signalStability). 5 levels: STRONG≥0.80, MODERATE≥0.65, LOW≥0.50, UNSTABLE≥0.40, INSUFFICIENT<0.40. BLOCK at <0.40.
  - **Anti-Bias Guard**: SignalStabilityGuard (DOWNGRADE if coverage<0.65 or dominantSourceRatio>0.60, BLOCK if coverage<0.45 or reliability<0.50). Two-Run Confirmation (no directional verdict from single snapshot).
  - **Token Budget Guard**: 3 execution modes (FULL/REDUCED/LIGHT) with auto-downgrade. Hard token ceiling per snapshot. Single LLM call max per snapshot. Comment/post sampling with stratified selection.
  - **Dominance Module**: Internal-only module within MIv3. No standalone endpoint, no external invocation.
  - **Adaptive Refresh**: Dynamic intervals (3/7/14 days based on volatility). Hard cap: 1 refresh per competitor per 72 hours.
  - **Snapshot Caching**: SHA-256 `competitorHash` invalidates cached snapshots when competitor set changes. 24h freshness window. `computeCompetitorHash()` in `utils.ts`.
  - **Concurrency Lock**: `activeLocks` Map deduplicates parallel runs per `accountId:campaignId` key — concurrent requests reuse the in-flight promise.
  - **Engine Isolation**: Only MIv3 callable from CI section. Hard rejection + audit log for any cross-engine call attempt. No writes to strategic_plans or plan_documents.
  - **DB Tables**: mi_snapshots, mi_signal_logs, mi_refresh_schedule, mi_telemetry.
  - **API Endpoints**: POST /api/ci/mi-v3/analyze, GET /api/ci/mi-v3/snapshot/:campaignId, POST /api/ci/mi-v3/refresh, GET /api/ci/mi-v3/history/:campaignId, GET /api/ci/mi-v3/telemetry/:snapshotId.
  - **Output**: Strict 12-field structure (marketState, dominantIntentType, competitorIntentMap, trajectoryDirection, narrativeSaturationLevel, revivalPotential, entryStrategy, defensiveRisks, confidence, missingSignalFlags, dataFreshnessDays, volatilityIndex).
- **Creative Capture Layer**: Analyzes reels with real data for deterministic signals and AI interpretation.
- **Plan Documents**: Generation and storage of strategic plans in PDF/markdown format.

### Strategic Execution Machine
- **System**: A single-track execution pipeline transforming strategic blueprints into published content through hard approval gates.
- **Pipeline Flow**: Blueprint → Strategic Plan → Client Approval Gate → Calendar Auto-Generation → Item-by-Item Creative Generation → Studio Drafts → Scheduled → Published.
- **Execution Safety**: Idempotency, concurrency locks, emergency stop, and explicit failure tracking.

### Strategic Core Architecture ("Build The Plan")
- **System**: A 6-phase sequential intelligence engine with hard gates for plan generation (Gate, Creative Analysis, Confirm/Edit, Market Analysis, Validation, Orchestrator).
- **AI Models**: Gemini for creative extraction, GPT-4.1-mini for section-based orchestration, GPT for market analysis and validation.
- **Section-Based Orchestration**: Each of the 6 strategic sections runs as an independent AI call with focused prompts, individual retry policy, immediate per-section persistence, and independent fallback.
- **Section-Level Observability**: Frontend polls section statuses in real-time.
- **Schema Validation**: Ensures plans contain all required sections.
- **Plan Approval Gate**: Execution plans require explicit approval to activate.

### Adaptive Engine Architecture (Foundation)
- **Engine Contracts**: `server/engine-contracts/` — centralized foundation for scalable engine integration.
- **Output Type Matrix**: Strict matrix defining which engine outputs which data type and which section can consume it. 10 output types (CAPTION, SCRIPT, SCENE_BREAKDOWN, VISUAL_CONCEPT, POSTER_DESIGN, METADATA, STRATEGY_SECTION, PERFORMANCE_SIGNAL, CREATIVE_ANALYSIS, DISTRIBUTION_PLAN) across 7 sections (AI_WRITER, AI_VIDEO, AI_DESIGNER, STUDIO, AUTOPILOT, DASHBOARD, BUILD_A_PLAN). Hard rejection on invalid consumption — no silent conversions.
- **Unified Engine Contract**: All engines must return `{ score, reasoning, confidence, dataCompleteness, scope, outputType, riskFlag? }`. Zod-validated at runtime. Non-conforming outputs are rejected.
- **Context Kernel**: `buildStrategicContext(campaignId, accountId)` produces `{ marketMode, awarenessLevel, competitionLevel, pricingBand, growthDirection, dataConfidence }` from business_data_layer, manual_campaign_metrics, ci_competitors, and performance_snapshots. No engine may derive its own context.
- **Engine Registry**: Central `EngineRegistry` with `register()`, `getEligible()`, `invoke()`. Only BUILD_A_PLAN_ORCHESTRATOR can invoke engines. Each engine declares `eligibility()`, `supportedScopes`, and `supportedOutputTypes`. Ineligible engines are skipped with audit log.
- **Execution Map**: Maps section → allowed output types. `validateExecutionRoute(source, destination, outputType)` ensures valid routing. Unmapped routes are rejected.
- **Uncertainty Guard**: Aggregates confidence and completeness from engine outputs. Returns PROCEED (≥60%), DOWNGRADE (40-60%), or BLOCK (<40%). Risk flags aggregated. Downgraded plans are marked as low-confidence. Blocked plans halt generation.
- **Type Enforcement**: Hard rejection rules — Writer+Video→reject, Video+Caption→reject, Designer+Script→reject. No silent type conversions.

### Backend Stabilization
- **AI Cost Lock**: Centralized AI call routing with usage tracking and token budgets.
- **Database Indexes**: Extensive custom indexes for performance.
- **Worker Hardening**: Autonomous worker with decision caps and circuit breakers.
- **Safety Gate Registry**: Centralized functions for route protection and feature gating.
- **Memory Scoping Hardening**: Mathematically provable account and campaign isolation.
- **Campaign Switch Safety**: Hard reset of campaign-scoped state on switch.
- **Validation Layer**: Zod-based request validation middleware.

### Final System Lock
- **Business Data Layer**: Unified business profile for orchestration.
- **Dashboard Campaign Truth**: All dashboard metrics derived from campaign-scoped database queries.
- **AI Actions Evidence-Bound**: AI actions tied to specific evidence metadata.
- **Campaign Management**: Support for multiple campaigns per account, explicit campaign ID scoping for data fetches.
- **Single Execution Track**: All critical writes to execution tables confined to a single route.
- **Distribution Plan-Derived**: Orchestrator uses business data to derive content distribution strategies.
- **Manual/Real Isolation**: System operates in "REAL" or "MANUAL" data modes.
- **Canonical Media Types**: Single source of truth in `lib/media-types.ts`.
- **Fulfillment Engine**: Computes live progress from `studio_items` only, providing `required`, `fulfilled`, and `remaining` counts by product type (STORIES, POSTS, REELS) and status.
- **Unified Save→Studio + Auto AI Analysis**: All AI creation outputs use `saveToStudio()` to create `studio_items` rows with `analysisStatus: 'PENDING'`, triggering background AI analysis for metadata generation.
- **Atomic Save Flows**: All save handlers (Writer, Designer, Video) are atomic — no local state (MediaItem, ContentItem) is created unless the DB write succeeds and returns a valid `studioItemId`. On failure, `saveState` shows 'error' for 3s without navigating.
- **Product-Based Branches**: Fulfillment branches are product types: STORIES (story content), POSTS (post/image/poster/carousel), REELS (reel/video). Replaces old tool-based branches (WRITER/DESIGNER/VIDEO). `requiredWork` DB columns: `storyItems`, `postItems`, `reelItems`. Studio displays 3 categories: Stories, Posts, Reels.
- **saveToStudio Error Propagation**: `lib/studio-save-service.ts` throws on HTTP errors and missing `studioItemId`, ensuring callers always get exceptions on failure.
- **Fulfillment Write Paths**: All content creation paths write to `studio_items`, enforcing mandatory `campaignId`.

## External Dependencies

### AI Services
- **OpenAI API**: For various AI capabilities.
- **Google Gemini**: For content generation and strategic analysis.

### Database
- **PostgreSQL**: Primary database, managed with Drizzle ORM.

### User Authentication
- **Meta OAuth**: Login via Facebook and Instagram.

### Meta Business Suite Integration
- **Token Security**: AES-256-GCM encrypted tokens stored server-side.
- **OAuth Flow**: Full-scope OAuth for managing permissions and token lifecycle.
- **Meta Modes**: Handles various connection states (DISCONNECTED, REAL, PENDING_APPROVAL).
- **Capability Gates**: Publishing and insights capabilities gated by Meta permissions.

### Audit & Control System
- **Backend**: Endpoints for audit feeds, AI usage, gate status, decisions, publish history, and job management.
- **Frontend**: 5-panel dashboard for System Gates, AI Token Budget, Recent Activity, Decisions, and Worker/Jobs.

### Social Platforms
- **Instagram, Facebook**: Integrated via Meta Business Suite.
- **Twitter, LinkedIn, TikTok**: Connection management implemented.