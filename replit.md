# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application leveraging AI to generate social media content, manage campaigns, schedule posts, and provide analytics. Built with Expo (React Native), its core purpose is to streamline marketing workflows, enhance brand presence through AI-powered content creation, and offer strategic insights. The project aims to function as an "AI Agency Replacement" focused on revenue generation and autonomous marketing capabilities, transforming strategic blueprints into published content through a controlled execution pipeline.

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
- **Dashboard**: Revenue-focused KPIs, AI action summaries with evidence-bound actions, and campaign-specific metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation, with clear delineation of "Required Work" by content branch.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Manager for optimized ad audiences, and a Performance Intelligence Layer.
- **Studio**: Media library, AI Video Editor with FFmpeg rendering, and AI Video Analysis Assist for content extraction. Full integration with Luma AI Video models (Ray 2, Ray 3) for text-to-video and image-to-video generation across various resolutions and durations.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Competitive Intelligence**: Real-data competitor analysis system providing measured metrics and inferred AI insights.
- **Creative Capture Layer**: Analyzes reels with real data for deterministic signals and AI interpretation.
- **Plan Documents**: Generation and storage of strategic plans in PDF/markdown format.

### Strategic Execution Machine
- **System**: A single-track execution pipeline transforming strategic blueprints into published content through hard approval gates.
- **Pipeline Flow**: Blueprint → Strategic Plan → Client Approval Gate → Calendar Auto-Generation → Item-by-Item Creative Generation → Studio Drafts → Scheduled → Published.
- **Single Calendar Source**: A single canonical calendar for all scheduling.
- **Item-by-Item Generation**: Content is generated for one calendar entry per request, ensuring controlled execution.
- **Execution Safety**: Idempotency, concurrency locks, emergency stop, and explicit failure tracking are implemented.

### Strategic Core Architecture ("Build The Plan")
- **System**: A 6-phase sequential intelligence engine with hard gates for plan generation (Gate, Creative Analysis, Confirm/Edit, Market Analysis, Validation, Orchestrator).
- **AI Models**: Gemini for creative extraction, GPT-4.1-mini for section-based orchestration (6 independent calls), GPT for market analysis and validation, with optional Performance Intelligence signal injection.
- **Section-Based Orchestration (Phase 5)**: Each of the 6 strategic sections (Content Distribution, Creative Testing, Budget Allocation, KPI Monitoring, Competitive Watch, Risk Monitoring) runs as an independent AI call with focused prompts (~500-800 tokens each), individual retry policy (1 retry with 1.5s delay), immediate per-section persistence to DB, and independent fallback. No single monolithic AI call. Sections execute sequentially within a background job.
- **Section-Level Observability**: Frontend polls section statuses in real-time (PENDING → GENERATING → COMPLETE/FALLBACK). Per-section timing recorded in stageTimes. Partial fallback supported — some sections AI-generated while others fall back individually without collapsing the entire plan.
- **Schema Validation**: Strict validation ensures plans contain all required sections before delivery.
- **Plan Approval Gate**: Execution plans are initially drafted and require explicit approval to activate, locking the pipeline until approved. Regeneration reverts status and supersedes old plans.

### Backend Stabilization
- **AI Cost Lock**: Centralized AI call routing with usage tracking and token budgets.
- **Database Indexes**: Extensive custom indexes for performance.
- **Worker Hardening**: Autonomous worker with decision caps, circuit breakers, and account-based plan gating.
- **Safety Gate Registry**: Centralized functions for route protection and feature gating.
- **Memory Scoping Hardening**: Mathematically provable account and campaign isolation on all signal tables.
- **Campaign Switch Safety**: Hard reset of campaign-scoped state on switch, preventing cross-campaign writes.
- **Validation Layer**: Zod-based request validation middleware.

### Final System Lock
- **Business Data Layer**: Unified business profile for orchestration, with core business data stored in a dedicated table.
- **Dashboard Campaign Truth**: All dashboard metrics are derived from campaign-scoped database queries.
- **AI Actions Evidence-Bound**: AI actions are tied to specific evidence metadata (sourceTag, evidenceMetric, evidenceTimeframe, priority).
- **Campaign Management**: Support for multiple campaigns per account, explicit campaign ID scoping for data fetches, and streamlined campaign creation and deletion.
- **Single Execution Track**: All critical writes to execution tables are confined to a single route.
- **Distribution Plan-Derived**: Orchestrator uses business data to derive content distribution strategies.
- **Manual/Real Isolation**: System operates in "REAL" or "MANUAL" data modes, with all demo functionalities purged.
- **Canonical Media Types**: Single source of truth in `lib/media-types.ts`. Canonical values: VIDEO, REEL, IMAGE, CAROUSEL, POST, STORY. `normalizeMediaType()` normalizer used across Studio and Calendar. `createRouteForContentType()` maps content types to Create screen tabs (content→AI Writer/Reels, designer→AI Designer).
- **Calendar→Create Routing**: Calendar "Create" button navigates to `/(tabs)/create` with params (calendarEntryId, calendarContentType, calendarTab, calendarTopic). Create screen hydrates from calendar entry via `GET /api/execution/calendar-entries/:entryId`.
- **Plan Documents**: Generation and storage of strategic plans in `plan_documents` table with versioning (`blueprintId`, `version`, `contentJson`, `contentMarkdown`, `isFallback`). Auto-saved when Phase 5 completes. API: `GET /api/plans/:planId/document` and `GET /api/strategic/blueprint/:id/document`. Frontend: `PlanDocumentView` component renders 6 section cards, accessible from both BuildThePlan Phase 5 and StrategicPipeline. Never returns 500 for expected missing states (404 PLAN_NOT_FOUND / DOCUMENT_NOT_FOUND).
- **MediaType API Normalization**: `POST /api/studio/case` normalizes mediaType before DB write via `normalizeMediaType()`. `POST /api/studio/video-analyze` guards — only REEL/VIDEO allowed, IMAGE → 409 `INVALID_MEDIA_TYPE_FOR_ANALYZE`. Unknown types → 422 `MEDIA_TYPE_INVALID`.
- **Quality Gate Tests**: `server/tests/media-types.test.ts` — 15 tests validating `normalizeMediaType` never returns undefined/null, handles whitespace/plural/edge cases, and `createRouteForContentType` returns valid routes for all content types. `server/tests/plan-document.test.ts` — 5 tests validating plan document API endpoints return proper 404s (never 500s) for expected missing states, correct error codes, and proper response shape.

## External Dependencies

### AI Services
- **OpenAI API**: For various AI capabilities.
- **Google Gemini 3 Pro**: For content generation and strategic analysis.

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
- **Twitter, LinkedIn, TikTok**: Connection management implemented, API integrations planned.