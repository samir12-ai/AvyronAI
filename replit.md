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
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor with FFmpeg, and AI Video Analysis Assist. Integration with Google Veo 3.1 for text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Competitive Intelligence**: Real-data competitor analysis system.
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
- **Fulfillment Engine**: Computes live progress from `studio_items` only, providing `required`, `fulfilled`, and `remaining` counts by branch and status.
- **Unified Save→Studio + Auto AI Analysis**: All AI creation outputs use `saveToStudio()` to create `studio_items` rows with `analysisStatus: 'PENDING'`, triggering background AI analysis for metadata generation.
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