# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application built with Expo (React Native) that uses AI to generate social media content, manage campaigns, schedule posts, and provide analytics. Its core purpose is to streamline marketing workflows, enhance brand presence through AI-powered content creation, and offer strategic insights. The project aims to function as an "AI Agency Replacement" focused on revenue generation and autonomous marketing capabilities.

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
- **AI Integration**: Dual-AI engine utilizing OpenAI GPT-5.2 and Google Gemini 3 Pro for content and strategy; Nano Banana Pro (Gemini 3 Pro Image) and GPT Image 1 for AI image/design.
- **Autonomous Engine**: Production-safe backend with guardrails for marketing decisions (Guardrail Engine, Adaptive Baselines, Hybrid Risk Classifier, Decision Feedback Loop, Audit System). Supports autopilot for low-risk decisions.

### Data Storage
- **Client-side**: AsyncStorage for local data.
- **Server-side**: PostgreSQL with Drizzle ORM for user data and chat conversations.

### Key Features
- **Dashboard**: Revenue-focused KPIs and AI action summaries.
- **Create**: AI Writer for text content and AI Designer for image generation with style presets and mood configuration.
- **Calendar**: Content scheduling with AI Calendar Assistant.
- **AI Management**:
    - **Auto-Publisher**: Batch publishing to Meta platforms.
    - **AI Audience Manager**: Generates optimized Meta ad audiences.
    - **Strategy Hub**: AI-powered strategic intelligence with MOAT BUILDER MODE for brand defensibility, pattern detection, and AI-generated reports.
- **Studio**: Media library and AI Video Editor with guided creative briefs and FFmpeg rendering.
- **Photography**: Dubai-based photography marketplace.
- **Lead Engine**: Modular lead generation system with 8 independent modules (Lead Capture, Conversion Tracking, CTA Engine, Funnel Logic, Lead Magnets, Landing Pages, Revenue Attribution, AI Lead Optimization). Features flags, dependency guards, and a global kill switch.
- **Competitive Intelligence**: AI Chief Strategy Officer tracking up to 5 competitors, providing AI-powered market analysis, gap detection, and strategic recommendations with audit logging.
- **Settings**: Brand profile and platform connections management.

### Strategic Execution Machine
- **System**: Controlled execution pipeline transforming strategic blueprints into published content through hard approval gates.
- **Pipeline**: Blueprint → Strategic Plan → Client Approval Gate → Calendar Auto-Generation (Phase 4A) → AI Creative Execution (Phase 4B) → Studio Drafts → Scheduled → Published.
- **Database Tables**: `strategic_plans`, `plan_approvals`, `required_work`, `calendar_entries`, `studio_items` with full lifecycle tracking.
- **Execution Safety**: Idempotency via unique constraints (planId + campaignId), concurrency locks (executionStatus = RUNNING prevents concurrent runs), emergency stop (PAUSED freezes all queues, deletes nothing), explicit failure tracking (FAILED + errorReason).
- **Phase 4A (Deterministic)**: Calendar auto-generation with even spacing, required work calculation. Zero AI, pure deterministic logic.
- **Phase 4B (AI Creative)**: Captions, briefs, CTA copy, studio drafts. Respects PAUSED state. Failed items get FAILED status + errorReason.
- **Dashboard**: Plan-level + account-level progress trackers with real data from database counts. Progress = (published + scheduled + ready) / total_required_work.
- **Hard Rules**: Nothing executes until plan status = APPROVED. Nothing auto-publishes. No silent fallbacks. All state transitions audit logged (18 event types).
- **Frontend**: ExecutionMachine.tsx with Simple/Advanced views, collapsible sections, real-time progress, Approve/Reject/Emergency Stop buttons.
- **Backend**: server/strategic-core/execution-routes.ts with 15+ endpoints, status-gated middleware.

### Strategic Core Architecture ("Build The Plan")
- **System**: 6-phase sequential intelligence engine with hard gates.
- **Phases**: Gate (min requirements) → Creative Analysis (AI extraction from media) → Confirm/Edit (user review) → Market Analysis (AI market mapping) → Validation (contradiction detection) → Orchestrator (execution plan generation).
- **AI Models**: Gemini 3 Pro for creative extraction, GPT-5.2 for market analysis, validation, and orchestration.

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
- **OAuth Flow**: Full-scope OAuth requesting necessary permissions, exchanging short-lived for long-lived tokens.
- **Meta Modes**: DISCONNECTED, PENDING_APPROVAL, PERMISSION_MISSING, TOKEN_EXPIRED, REVOKED, DEMO, REAL.
- **Capability Gates**: Publishing and insights capabilities are gated by specific Meta permissions.
- **Token Lifecycle**: Daily health checks, auto-extension, and failure classification.
- **Publish Worker**: Requires `meta_mode=REAL` for publishing, no silent demo fallbacks.
- **Middleware**: `requireMetaReal` guards all publishing/insights endpoints.

### Social Platforms
- **Instagram, Facebook**: Integrated via Meta Business Suite.
- **Twitter, LinkedIn, TikTok**: Connection management in settings; API integrations planned.