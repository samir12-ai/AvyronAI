# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application using AI to generate social media content, manage campaigns, schedule posts, and provide analytics. Built with Expo (React Native), its primary goal is to streamline marketing workflows, enhance brand presence through AI-powered content creation, and offer strategic insights. The project aims to act as an "AI Agency Replacement" focused on revenue generation and autonomous marketing capabilities.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Monorepo Structure**: Shared codebase for client and server.
- **Type Safety**: Full TypeScript with strict mode.
- **Platform Abstraction**: Components designed for iOS, Android, and Web compatibility.
- **Dynamic Theming**: Support for light and dark modes.

### Frontend
- **Framework**: Expo SDK 54 with React Native 0.81 (new architecture).
- **Navigation**: Expo Router v6 (file-based routing).
- **State Management**: React Context API for global state, TanStack React Query for server state.
- **Internationalization**: i18n-js for 32 languages.
- **UI/UX**: Custom component library, React Native Reanimated for animations.

### Backend
- **Server**: Express.js with Node.js and TypeScript.
- **API Design**: RESTful endpoints.
- **AI Integration**: Dual-AI engine utilizing OpenAI GPT-5.2 and Google Gemini 3 Pro for content and strategy, with Nano Banana Pro (Gemini 3 Pro Image) and GPT Image 1 for AI image/design.
- **Autonomous Engine**: Production-safe backend with guardrails for marketing decisions (Guardrail Engine, Adaptive Baselines, Hybrid Risk Classifier, Decision Feedback Loop, Audit System) supporting autopilot for low-risk decisions.

### Data Storage
- **Client-side**: AsyncStorage for local data.
- **Server-side**: PostgreSQL with Drizzle ORM for user data and chat conversations.

### Key Features
- **Dashboard**: Revenue-focused KPIs and AI action summaries. Profile icon in header opens unified Business Profile modal. Plan-driven fallback metrics (planned/generated/failed/pending/completion%) when no Meta data. "Meta not connected" badge. AI Actions always non-empty when plan exists.
- **Create**: AI Writer for text and AI Designer for image generation with style presets. Shows Required Work by branch (Designer/Writer/Video) with counts. Branch ownership: Carousels→DESIGNER, Posts+Stories→WRITER, Reels+Videos→VIDEO. No double counting — branch totals sum exactly to totalContentPieces.
- **Calendar**: Content scheduling with AI Calendar Assistant.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Manager for optimized Meta ad audiences, and a Performance Intelligence Layer for insights.
- **Studio**: Media library and AI Video Editor with FFmpeg rendering. AI Video Analysis Assist auto-extracts hooks, captions, CTAs, angles, and keywords per video item. "Apply to Draft" button with field toggles writes selected AI fields to draft (non-destructive, user edits survive).
- **Lead Engine**: Modular lead generation system with 8 independent modules and AI Lead Optimization.
- **Competitive Intelligence**: Real-data competitor analysis system using a 2-step scrape ladder for MEASURED metrics and INFERRED AI insights.
- **Creative Capture Layer**: 8-component pipeline analyzing reels with real data for deterministic signals and AI interpretation.
- **Plan Documents**: Plan PDF/markdown generation and storage via `plan_documents` table. Download from Pipeline UI.

### Strategic Execution Machine
- **System**: Controlled single-track execution pipeline transforming strategic blueprints into published content through hard approval gates.
- **Pipeline**: Blueprint → Strategic Plan → Client Approval Gate → Calendar Auto-Generation → Item-by-Item Creative Generation → Studio Drafts → Scheduled → Published.
- **Single Calendar**: One canonical calendar source of truth (`calendar_entries` table). Main Calendar tab reads from DB. Pipeline shows summary only with "Open Calendar" CTA — no duplicate calendar rendering.
- **Item-by-Item Generation**: `POST /api/execution/calendar-entries/:entryId/generate` generates content for exactly ONE calendar entry per request. No batch generation endpoints. Max 1 content unit per click.
- **Execution Safety**: Idempotency, concurrency locks, emergency stop, and explicit failure tracking.
- **Hard Rules**: Nothing executes until plans are APPROVED; no auto-publishing; all state transitions are audit logged; no batch content generation.

### Strategic Core Architecture ("Build The Plan")
- **System**: 6-phase sequential intelligence engine with hard gates (Gate, Creative Analysis, Confirm/Edit, Market Analysis, Validation, Orchestrator).
- **AI Models**: Gemini 3 Pro for creative extraction, GPT-5.2 for market analysis, validation, and orchestration.
- **Orchestrator Enhancement**: Optionally injects Performance Intelligence signals into the orchestrator prompt.
- **Phase 5 Demo Mode**: In demo mode, orchestrator returns deterministic fixture plan instantly (no AI call, <100ms). Structured logging with requestId traces every step.
- **Competitor Linking**: Build The Plan pulls competitors from Competitive Intelligence (selectable list), minimum 1 competitor required (not 2). Strict validation at Phase 5: 400 COMPETITOR_REQUIRED for 0 competitors, 422 COMPETITOR_INCOMPLETE for invalid entries.
- **Error Handling**: AI budget exceeded → 402 AI_BUDGET_EXCEEDED; AI timeout → 504 ORCHESTRATOR_TIMEOUT; parse failure → 500 with retry guidance. Every Phase 5 attempt produces an audit event.
- **Plan Approval Gate**: After Phase 5 generates execution plans, a `strategic_plan` row is auto-created (status: DRAFT). Explicit "Approve & Activate Plan" button required to set status to APPROVED. Pipeline is LOCKED until plan.status === APPROVED. Regeneration reverts to VALIDATED and SUPERSEDES old plans, relocking pipeline.
- **Approval Endpoints**: `POST /api/strategic/blueprint/:id/approve-plan` (DRAFT→APPROVED with audit), `POST /api/strategic/blueprint/:id/regenerate-plan` (reverts to VALIDATED, supersedes plans), `GET /api/strategic/blueprint/:id/plan-status`.

### Execution Authority Matrix
- **SINGLE EXECUTION TRACK**: "Build The Plan" is the sole execution authority, owning strategic plans, required work, calendar entries, studio items, and plan approvals.
- **Performance Intelligence**: Reads its own signal tables (e.g., performance snapshots, strategy insights) and writes only to these, never to execution tables. All signal tables are scoped by `account_id` and `campaign_id`.

### Backend Stabilization
- **AI Cost Lock**: All AI calls routed through a centralized singleton with explicit tracking, usage logging, and weekly token budgets.
- **Database Indexes**: Extensive custom indexes across all tables.
- **Worker Hardening**: Autonomous worker with hourly decision caps, circuit breakers, and idle account skipping. Plan-gated: blocks cycle if no approved plan.
- **Safety Gate Registry**: Centralized gate functions for route protection (e.g., `gateAutopilotEnabled`, `gateAIBudget`).
- **Active Plan Status Constant**: `ACTIVE_PLAN_STATUSES` in `server/plan-constants.ts` — single source of truth for APPROVED/GENERATED_TO_CALENDAR/CREATIVE_GENERATED/REVIEW/SCHEDULED. Used by gates, autopilot, dashboard, and worker.
- **Validation Layer**: Zod-based request validation middleware.
- **Memory Scoping Hardening**: Mathematically provable account+campaign isolation on all signal tables with database NOT NULL constraints and write guards.
- **Campaign Switch Safety**: Hard reset of all campaign-scoped state on switch. Debounced saves cancelled. No cross-campaign write possible. StrategicPipeline clears plans/account/progress/calendarEntries on campaign change and shows error state with retry on fetch failure.
- **Execution Dashboard Campaign Scoping**: `/api/execution/dashboard` accepts optional `campaignId` query param to filter plans, required_work, and studio_items by campaign. StrategicPipeline passes `selectedCampaignId` to this endpoint.

### Final System Lock
- **Business Data Layer**: `business_data_layer` table with 9 structural columns (e.g., businessLocation, businessType, coreOffer), campaign-scoped and used for orchestration. Unified Business Profile: single entry point via profile icon in dashboard header; BuildThePlan Phase 0 shows profile completeness gate, not duplicate form.
- **Dashboard Campaign Truth**: All dashboard metrics derived from campaign-scoped DB queries; no hardcoded values.
- **AI Actions Evidence-Bound**: AI actions carry evidence metadata (sourceTag, evidenceMetric, priority) and are gated by an APPROVED plan.
- **Single Execution Track**: All writes to key execution tables are confined to a single execution route.
- **Distribution Plan-Derived**: Orchestrator injects business data into AI prompts to derive content distribution strategies.
- **Demo/Real Isolation**: Data mode resolution ensures strict separation between demo fixtures and real data.

## External Dependencies

### AI Services
- **OpenAI API**: For various AI capabilities.
- **Google Gemini 3 Pro**: For content generation and strategic analysis.

### Database
- **PostgreSQL**: Primary database, managed with Drizzle ORM.

### User Authentication
- **Meta OAuth**: Login via Facebook and Instagram.
- **Demo Mode**: For simulated login.

### Meta Business Suite Integration
- **Token Security**: AES-256-GCM encrypted tokens stored server-side.
- **OAuth Flow**: Full-scope OAuth for managing permissions and token lifecycle.
- **Meta Modes**: System handles various connection states (DISCONNECTED, REAL, PENDING_APPROVAL, etc.).
- **Capability Gates**: Publishing and insights capabilities gated by Meta permissions.
- **Publish Worker**: Requires `meta_mode=REAL` for publishing.

### Audit & Control System
- **Backend**: Provides endpoints for audit feeds, AI usage, gate status, decisions, publish history, and job management.
- **Frontend**: 5-panel dashboard for System Gates, AI Token Budget, Recent Activity, Decisions, and Worker/Jobs.

### Social Platforms
- **Instagram, Facebook**: Integrated via Meta Business Suite.
- **Twitter, LinkedIn, TikTok**: Connection management implemented, API integrations planned.