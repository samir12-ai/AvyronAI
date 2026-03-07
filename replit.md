# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. It automates social media content generation, campaign management, post scheduling, and analytics, aiming to offer an AI-powered, autonomous marketing solution focused on revenue generation and controlled content execution.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, enforces TypeScript for type safety, supports platform abstraction for cross-platform compatibility (iOS, Android, Web), and includes dynamic theming for light and dark modes.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state, and TanStack React Query for server state. It features a custom component library, React Native Reanimated for animations, and i18n-js for internationalization across 32 languages.

### Backend
The backend runs on Express.js with Node.js and TypeScript, exposing RESTful APIs. It incorporates a dual-AI engine using OpenAI GPT and Google Gemini for content and strategy, along with specialized models for AI image/design. An autonomous engine manages marketing decisions with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage, while server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence: Language Analysis, Pain/Desire/Objection/Transformation/Emotional signal extraction, AI Segment Construction, Segment Density, Awareness Level, Maturity Index, Buying Intent, Ads Targeting — 10 deterministic + 2 AI layers, all outputs with evidence metadata), and a Performance Intelligence Layer. Engine V3 includes Signal Sanitation (synthetic/crawler artifact filtering), Dataset Validation Guard (≥3 competitors, ≥20 posts, ≥50 comments), Awareness Fallback (`insufficient_signals` instead of hallucinated distributions), Defensive Mode (low signal warning), multi-factor Confidence Calibration (50% frequency + 30% source diversity + 20% competitor overlap), and 200+ multilingual patterns (English + Arabic + conversational). Status system: COMPLETE/DATASET_TOO_SMALL/INSUFFICIENT_SIGNALS/DEFENSIVE_MODE. Engine V3 includes Segment Canonicalization Layer (keyword-overlap similarity ≥0.80 merge, 2-4 segment limit, Secondary Segment Cluster overflow, deterministic), Objection Context Validation (two-stage: pattern detection + context verification for physical limitations), Market-Scoped Patterns (fitness/health/marketing/ecommerce/education/finance/tech/beauty/food scope tags, auto-detected from content), Signal Evidence Integrity (minimum 3 evidence per signal), and Normalized Segment Density (sums to 100%).
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including integration with Google Veo 3.1 for text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Positioning Engine V3**: 12-layer strategic positioning engine (80% deterministic, 20% AI synthesis). Layers: Category Detection, Market Narrative Map, Narrative Saturation Detection, Trust Gap Detection, Segment Priority Resolution, Market Power Analysis, Opportunity Gap Detection, Differentiation Axis Construction, Narrative Distance Scoring, Strategic Territory Selection, Positioning Statement Generation (AI only), Stability Guard. Mandatory dependency chain: MI Snapshot → Audience Snapshot → Positioning. Outputs Strategy Cards, territories with opportunity/confidence scores, flanking mode detection, stability validation. Status system: COMPLETE/MISSING_DEPENDENCY/INSUFFICIENT_SIGNALS/UNSTABLE. Frontend: Strategy tab with Strategy Cards, Opportunity Gaps, Market Power bars, Stability Guard, Differentiation Axes. 30 unit tests.
- **Competitive Intelligence (MIv3)**: Provides real-data competitor analysis through a 6-layer pipeline (Signals → ContentDNA → Intent → Trajectory → Confidence → Dominance) for data processing and signal generation, with robust data integrity checks, cooldown mechanisms, and dynamic time window adjustments. It includes a two-speed data collection (Fast Pass, Deep Pass) and features market activity vs. market demand analysis.
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generates and stores strategic plans.
- **Snapshot Hardening**: Ensures data integrity and consistency with versioning, cache invalidation, and strict persistence rules for analytical snapshots.
- **Strategic Execution Machine**: A single-track pipeline for transforming strategic blueprints into published content with approval gates.
- **Strategic Core Architecture ("Build The Plan")**: A 6-phase sequential engine (Gate → Blueprint → Confirm → Analyze → Validate → Execute) for comprehensive plan generation, generating an AI Creative Blueprint from market intelligence, competitor signals, business data, and campaign context.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas, a Context Kernel, an Engine Registry, and an Uncertainty Guard.
- **Database Hardening (12-Section Audit)**: Full database hardening with 48 compound indexes, 6 unique constraints, and structural fixes. `ci_competitors` has `lastCheckedAt` + `analysisLevel` (FAST_PASS/DEEP_PASS) persisted after each scrape. Duplicate protection at DB level: competitors by (accountId, campaignId, profileLink), posts by (competitorId, postId), metrics by (competitorId, lastFetchAt), feature flags by (accountId, flagName), UI state by (accountId, campaignId, moduleKey), business data by (campaignId, accountId). All high-query tables indexed for compound lookups.
- **Backend Stabilization**: Includes AI cost management, extensive database indexing, worker hardening with decision caps and circuit breakers, safety gate registry, and robust memory scoping. Features per-account proxy pools with sticky sessions, intelligent backoff for retries, and Zod-based request validation.
- **Final System Lock**: Ensures unified business profiles, dashboard metrics derived from campaign-scoped data, evidence-bound AI actions, and explicit campaign ID scoping for multi-campaign management.
- **Pipeline Hardening (10 Safeguards)**: Engine state machine (`server/market-intelligence-v3/engine-state.ts`) with states READY/REFRESH_REQUIRED/REFRESHING/REFRESH_FAILED/BLOCKED. Snapshot integrity verification (UUID, version, campaignId, output presence). Freshness calculation uses newest post OR comment timestamp with anomaly guard (>365d + recent signals → recompute). Frontend snapshot normalization layer (`lib/engine-snapshot.ts`) with `normalizeEngineSnapshot()` and `isEngineReady()` consuming backend `engineState`. Positioning engine gates on MI freshness (>14d blocks execution). Scraping resilience skips 0-post competitors. Auto-refresh on stale detection. 59 unit tests (29 hardening + 30 positioning).

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Scalability Protection
Includes a global job queue with configurable concurrency limits and per-account job budgets. Features a shared market data cache and an admin dashboard for monitoring market data.

### Thundering Herd Protection
Implements request deduplication, queue prioritization (Fast Pass, Deep Pass, Background), backpressure mechanisms to throttle promotions during high load, and a rate gate to limit job promotions per minute. Includes queue health monitoring diagnostics.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Database
- PostgreSQL (managed with Drizzle ORM)

### User Authentication
- Meta OAuth

### Meta Business Suite Integration
- Secure token storage with AES-256-GCM encryption.
- Full-scope OAuth for permission management.
- Handles various Meta connection states and capability gates.

### Social Platforms
- Instagram (via Meta Business Suite)
- Facebook (via Meta Business Suite)
- Twitter
- LinkedIn
- TikTok