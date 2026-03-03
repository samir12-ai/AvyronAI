# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that uses AI to generate social media content, manage campaigns, schedule posts, and provide analytics. Its primary purpose is to streamline marketing workflows, enhance brand presence through AI-powered content creation, and offer strategic insights. The project aims to function as an "AI Agency Replacement" focused on revenue generation and autonomous marketing capabilities, transforming strategic blueprints into published content via a controlled execution pipeline.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Monorepo Structure**: Shared codebase for client and server.
- **Type Safety**: Full TypeScript with strict mode.
- **Platform Abstraction**: Components designed for iOS, Android, and Web compatibility.
- **Dynamic Theming**: Support for light and dark modes.

### Frontend
- **Framework**: Expo SDK with React Native.
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
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist. Integrates with Google Veo 3.1 for text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Competitive Intelligence (MIv3)**: Real-data competitor analysis system providing insights into competitor actions, market dominance, and strategic intent. Features a 5-layer pipeline for data processing, signal generation, and trajectory analysis. Includes a confidence model and anti-bias guards. Fetch job state (snapshotIdCreated, stopReason, stageStatuses) fully DB-persisted — no in-memory maps. Partial coverage downgrade: when hard ceilings trigger early stop, confidence penalized by 0.3, missingSignalFlags populated with PARTIAL_COVERAGE flag, marketState set to PARTIAL_DATA. DB-level RUNNING job uniqueness via partial unique index (code 23505 conflict handling). Crash/restart recovery reads from DB. Data integrity: delete-before-insert on re-fetch (no post accumulation), verified post/comment counts (persisted count validated against DB after insert, DATA_MISMATCH_ERROR logged on drift), cooldown path returns live DB counts (not stale metrics snapshot). Coverage-aware cooldown: cooldown only applies when posts >= 30 AND comments >= 100; below thresholds, cooldown is bypassed to allow re-fetch. Scraper pagination: up to 4 pages via GraphQL cursor pagination (TARGET_POSTS=30), deduplication via seenIds, paginationStopReason persisted. Honest state machine: PARTIAL_COMPLETE when coverage insufficient (never COMPLETE), INSUFFICIENT_DATA status on fetch result.
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generation and storage of strategic plans.

### Strategic Execution Machine
- **System**: A single-track execution pipeline transforming strategic blueprints into published content through approval gates.
- **Pipeline Flow**: Blueprint → Strategic Plan → Client Approval → Calendar Auto-Generation → Creative Generation → Studio Drafts → Scheduled → Published.

### Strategic Core Architecture ("Build The Plan")
- **System**: A 6-phase sequential intelligence engine with hard gates for plan generation (Gate, Creative Analysis, Confirm/Edit, Market Analysis, Validation, Orchestrator).
- **AI Models**: Gemini for creative extraction, GPT-4.1-mini for orchestration, GPT for market analysis and validation.
- **Section-Based Orchestration**: Independent AI calls per section with focused prompts, retry policies, and persistence.
- **Plan Approval Gate**: Execution plans require explicit approval.

### Adaptive Engine Architecture (Foundation)
- **Engine Contracts**: Centralized foundation for scalable engine integration with a strict output type matrix.
- **Unified Engine Contract**: All engines return a standardized output schema including score, reasoning, confidence, and risk flags.
- **Context Kernel**: Centralized mechanism for building strategic context for campaigns, ensuring consistent data usage across engines.
- **Engine Registry**: Central registry for managing and invoking engines based on eligibility and scope.
- **Uncertainty Guard**: Aggregates confidence and completeness from engine outputs to determine plan viability (PROCEED, DOWNGRADE, BLOCK).

### Backend Stabilization
- **AI Cost Lock**: Centralized AI call routing with usage tracking and token budgets.
- **Database Indexes**: Extensive custom indexes for performance.
- **Worker Hardening**: Autonomous worker with decision caps and circuit breakers.
- **Safety Gate Registry**: Centralized functions for route protection and feature gating.
- **Memory Scoping Hardening**: Provable account and campaign isolation.
- **Validation Layer**: Zod-based request validation middleware.

### Final System Lock
- **Business Data Layer**: Unified business profile for orchestration.
- **Dashboard Campaign Truth**: All dashboard metrics derived from campaign-scoped database queries.
- **AI Actions Evidence-Bound**: AI actions tied to specific evidence metadata.
- **Campaign Management**: Support for multiple campaigns per account with explicit campaign ID scoping.
- **Unified Save→Studio + Auto AI Analysis**: All AI creation outputs save to `studio_items` triggering background AI analysis.

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
- **Meta Modes**: Handles various connection states and capability gates based on Meta permissions.

### Audit & Control System
- **Backend**: Endpoints for audit feeds, AI usage, gate status, decisions, publish history, and job management.
- **Frontend**: 5-panel dashboard for System Gates, AI Token Budget, Recent Activity, Decisions, and Worker/Jobs.

### Social Platforms
- **Instagram, Facebook**: Integrated via Meta Business Suite.
- **Twitter, LinkedIn, TikTok**: Connection management implemented.