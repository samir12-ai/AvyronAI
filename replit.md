# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. Its primary goal is to automate social media content generation, campaign management, post scheduling, and analytics, offering an AI-powered, autonomous marketing solution focused on revenue generation and controlled content execution. The project aims to provide a comprehensive tool for businesses to manage their marketing efforts efficiently and effectively across various platforms.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It features a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It incorporates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, complemented by specialized models for AI image/design. An autonomous engine manages marketing decisions with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text generation and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence for audience segmentation and targeting), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Positioning Engine V3**: A 12-layer strategic positioning engine for generating strategic insights and positioning statements with advanced category resolution and signal extraction.
- **Offer Engine V3**: A 5-layer structured Offer Decision Engine that consumes upstream data and produces primary, alternative, and rejected offer options based on layers like Outcome, Mechanism, Delivery, Proof, and Risk Reduction. Supports user selection of preferred offer option. Mechanism Lock Rule enforces that generated offer mechanisms stay within the Differentiation Engine's mechanism category (framework/program/tool/service). Pre-save Alignment Validation checks mechanism-category match, audience-pain reflection, and deliverable-mechanism support before persisting snapshots. Financial claim sanitization normalizes transformation-style financial phrases (debt elimination, savings increase, net worth, financial freedom) into safe strategic outcomes instead of triggering hard boundary violations.
- **Funnel Engine V3** (ENGINE_VERSION=2): An 8-layer Funnel Decision Engine (Eligibility Detection, Offer-to-Funnel Fit, Audience Friction Modeling, Trust Path Construction, Proof Placement Logic, Commitment Level Matching, Funnel Integrity Guard, Funnel Strength Scoring) plus Entry Trigger Detection layer and Complexity Compression Guard. Produces primary/alternative/rejected funnel outputs with trust path, proof placement, friction mapping, and entry trigger (mechanism type + purpose). Supports user selection of preferred funnel. Hard-fail boundary enforcement for 18 blocked domains. Max 6 funnel stages enforced via compression guard.
- **Integrity Engine V3** (ENGINE_VERSION=2): An 8-layer strategic validation engine (Strategic Consistency, Audience–Offer Alignment, Positioning–Differentiation Compatibility, Offer–Funnel Compatibility, Trust Path Continuity, Proof Sufficiency, Conversion Feasibility, System Coherence). Sits after all strategic engines, validates cross-engine consistency, outputs overall integrity score + safe-to-execute boolean. Does NOT generate strategy — validation only. Boundary enforcement with 14 blocked domains. Routes: POST `/api/integrity-engine/analyze`, GET `/api/integrity-engine/latest`.
- **Awareness Engine V3** (ENGINE_VERSION=2): An 8-layer execution-layer engine (Market Entry Detection, Awareness Readiness Mapping, Attention Trigger Mapping, Narrative Entry Alignment, Awareness-to-Funnel Fit, Trust Readiness Guard, Generic Awareness Detector, Awareness Strength Scoring). Consumes all upstream strategic snapshots including Integrity. Produces primary/alternative/rejected awareness routes with entry mechanism types (pain/opportunity/myth-breaker/authority/proof-led/diagnostic), readiness stages, trigger classes, trust requirements, and funnel compatibility. Boundary enforcement with 14 blocked domains. Routes: POST `/api/awareness-engine/analyze`, GET `/api/awareness-engine/latest`.
- **Persuasion Engine V3** (ENGINE_VERSION=2): An 8-layer persuasion logic engine (Awareness-to-Persuasion Fit, Objection Detection, Trust Barrier Mapping, Influence Driver Selection, Proof Priority Mapping, Message Order Logic, Anti-Hype Guard, Persuasion Strength Scoring). Sits after Awareness Engine in the strategy pipeline. Produces persuasion architecture (NOT copy/ads): persuasion mode, influence drivers, objection priorities, trust sequence, message order logic. Hardened features: education-first diagnostic rule (low readiness enforces education before proof), multi-source objection fallback (7 fallback sources when direct objections absent), 7-category trust barrier classification with severity levels, funnel-type persuasion mode validation with awareness/proof-placement alignment, context-sensitive message order (derived from readiness + barriers + objections + funnel type), objection-to-proof linking (8 mapped categories), scarcity misuse protection (5 formal blocking conditions), readiness-sensitive strength scoring, generic persuasion suppression (10 structural patterns), separated data reliability (objectionSpecificity + trustSpecificity), dual boundary enforcement (input + output). Boundary enforcement with 14 blocked domains prevents copy/ad generation. Self-healing snapshot resolution. Routes: POST `/api/persuasion-engine/analyze`, GET `/api/persuasion-engine/latest`.
- **Differentiation Engine V3**: A 12-layer proof-backed engine for identifying unique selling propositions with uniqueness score calibration and mechanism framing guards. Generates **MechanismCore** — a structured single source-of-truth mechanism object (`mechanismName`, `mechanismType`, `mechanismSteps`, `mechanismPromise`, `mechanismProblem`, `mechanismLogic`) persisted in `differentiation_snapshots.mechanism_core`. MechanismCore propagates to Offer, Funnel, Persuasion, and Integrity engines — no engine independently generates mechanism descriptions.
- **MechanismCore Pipeline**: Single mechanism truth source created in Differentiation Engine Layer 8, consumed downstream. Offer Engine uses MechanismCore in AI prompts and layer2. Funnel Engine aligns stages to mechanism steps. Persuasion Engine references mechanism for mode explanation. Integrity Engine verifies mechanism name/type/steps continuity between differentiation and offer snapshots (replaces word-overlap check).
- **Market Language Preservation Layer**: Offer Engine builds a `MarketLanguageMap` from Audience Engine's raw pain/desire/objection evidence. AI prompts are constrained to use exact audience phrases. `validateOfferAlignment` detects and flags abstract rewrites when <10% of market language tokens appear in offer text.
- **Structured Objection Modeling Layer**: Persuasion Engine's `buildStructuredObjectionMap()` runs BEFORE all persuasion layers. Aggregates from 3 sources: Audience objectionMap (high confidence), MI narrative objections (moderate confidence), and pain-inferred objections (lower confidence). Each `StructuredObjection` has: `objectionStatement`, `objectionTrigger`, `objectionStage`, `objectionType`, `requiredProofType`, `persuasionResponse`, `source`, `confidence`. Raises `objectionSpecificity` from ~10% to ≥60% when structured objections exist.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, including data integrity checks, synthetic comment management, competitor authority weighting, demand pressure analysis, semantic signal extraction (8 categories: pain/desire/transformation/authority/differentiation/weakness/objection/strategic), cross-competitor signal clustering, 5-stage pipeline diagnostics, baseline-independent signal generation, and **Narrative Objection Extraction Layer** — a caption-level objection detection module (`server/market-intelligence-v3/narrative-objection-extractor.ts`) that extracts market objections from narrative patterns (comparison, anti-pattern framing, trust repair, problem framing, price/value, credibility, differentiation signals, strategy framing) without relying on comments. Outputs structured objection map with frequency score, narrative confidence (base ≥0.4 = moderate), supporting evidence, competitor sources, and **signal type classification** (`pain` / `objection` / `trust_barrier`). Persisted in `mi_snapshots.objection_map_data`. Downstream awareness classification (Audience Engine + Awareness Engine) adjusts based on objection density — markets with ≥3 narrative objections and density >0.15 override "unaware" to "problem_aware" or "solution_aware". **Content-first architecture**: comment counts are engagement signals ONLY — they never increase or decrease objection confidence. Content-primary mode relaxes dominant source ratio threshold (0.75 vs 0.60) and skips real-data-ratio penalties when comment text is unavailable but post content is strong. Persuasion Engine recognizes content-derived narrative objections at moderate confidence without triggering fallback inference penalties.
- **FAST_PASS / DEEP_PASS Architecture**: A two-stage inventory system for competitor data collection and enrichment, focusing on efficient post and comment acquisition.
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generates and stores strategic marketing plans.
- **Strategic Execution Machine**: A pipeline for transforming strategic blueprints into published content with approval gates.
- **Strategic Core Architecture ("Build The Plan")**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Database Hardening**: Includes extensive indexing, unique constraints, and structural fixes.
- **Backend Stabilization**: Features AI cost management, worker hardening, safety gate registry, and Zod-based request validation.
- **Fetch System Hardening**: Implements safeguards for fair request allocation, explicit fetch status, and dynamic budget scaling.
- **Final System Lock**: Ensures unified business profiles, dashboard metrics from campaign-scoped data, and evidence-bound AI actions.
- **Pipeline Hardening**: Includes an engine state machine, snapshot integrity verification, and auto-refresh mechanisms.
- **Self-Healing Snapshot Resolution**: All engines (Positioning, Differentiation, Offer, Funnel, Integrity, Awareness) implement automatic fallback when upstream snapshot references are stale (version mismatch). Instead of hard-failing, engines search for the latest valid snapshot with the correct version for that campaign. Healed snapshot IDs are persisted in lineage to prevent downstream stale-reference chains.
- **System Hardening Module** (`server/engine-hardening/`): Shared hardening library providing: `sanitizeBoundary` (domain boundary enforcement), `normalizeConfidence` (data-reliability-based confidence capping), `assessDataReliability` (signal density/diversity assessment), `detectGenericOutput` (generic marketing phrase penalties), `checkValidationSession` (revalidation loop prevention via session IDs), `pruneOldSnapshots` (snapshot lifecycle with 20-per-campaign retention), `detectNarrativeOverlap` (market noise/saturation detection), `checkCrossEngineAlignment` (upstream alignment validation). Integrated across all engines: MI, Audience, Positioning, Differentiation, Offer, Funnel, Integrity, Awareness.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Scalability Protection
Includes a global job queue with configurable concurrency limits, per-account job budgets, and a shared market data cache.

### Thundering Herd Protection
Implements request deduplication, queue prioritization, backpressure mechanisms, and a rate gate.

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