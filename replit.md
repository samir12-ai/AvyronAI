# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. Its primary purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, providing a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming. System hardening includes extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets, with 41 active isolation rules.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization. Engine components use a "lazy mount, keep alive" rendering pattern to preserve state.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode with dual-window retention: COMPLETE snapshots retained for 90 days, non-COMPLETE (PARTIAL/RESTORED) purged after 30 days. Latest-per-campaign protection is bounded by the 90-day window (no indefinite retention). INCOMPATIBLE snapshots are archived immediately.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines (V3)**: Includes Positioning, Offer (V5 with pre-generation constraint architecture), Funnel, Integrity, Awareness, Persuasion, and Differentiation Engines.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, featuring narrative objection extraction, clustering, content DNA bridging, and a Signal Quality Gate.
- **AI Orchestrator**: Single-entry orchestration engine that runs all 14 engines in priority order (Market Reality → Positioning → Offer → Messaging → Financial → Channel → Creative) with checkpoint persistence. Generates coherent 9-section strategic plans via AI synthesis with deterministic fallback.
- **Plan-First Dashboard**: Dashboard hierarchy: Performance → Active Plan Status → Execution Pipeline → Required Work → MarketMind Agent → Meta Strip → Advanced Insights. Floating agent FAB opens full-screen chat modal.
- **Content DNA**: Foundational content creation blueprint synthesized from all engine outputs + business profile into 8 structured rules: Messaging Core (tone, persuasion intensity, value promise), CTA DNA (primary type, delivery style, soft vs direct), Hook DNA (preferred types, opening style, recommended duration), Narrative DNA (structure, storytelling guidance), Content Angle DNA (primary angles, engagement patterns), Visual DNA (visual direction, talking-head vs proof vs demo), Format DNA (format priority, reel behavior, carousel logic), and Execution Rules (always-include/never-do lists). Auto-generates after plan synthesis (non-blocking). Stored in `content_dna` table. Injected into all content generation system prompts (`/api/generate-content`, `/api/generate-reel-script`). Displayed as compact grid in MarketMindAgent UI. Available via `GET /api/content-dna/:campaignId` and `POST /api/content-dna/generate`. Implementation: `server/content-dna-routes.ts`.
- **MarketMind Agent (Agent Control Box)**: Replaced old AI Actions panel. Self-contained component (`components/MarketMindAgent.tsx`) backed by `/api/dashboard/agent-brief` (aggregates all 14 engine outputs, plan data, metrics, Content DNA into AI-generated insight + priority action) and `/api/dashboard/agent-explain` (answers user questions using full engine + Content DNA context). Shows: pulsing status, campaign overview, AI insight, priority action, Content DNA snapshot (CTA, hooks, narrative, angle, tone, format), content progress bar, expandable engine intelligence details, plan section tags, shortcut buttons, and an interactive "Ask the Agent" chat. Agent is fully trained on Content DNA — references DNA rules when giving content creation advice.
- **Agent Chat**: Multi-conversation agent with full system context injection (business profile, campaign, plan, execution state, required work, calendar, studio, engine outputs, Content DNA, warnings). Agent role: strategic operations manager that explains, guides, and suggests within defined boundaries. Includes Content DNA awareness for content creation guidance.
- **Roots Foundation (V1)**: Unified root schema with 5 layers (Business Roots, Funnel Roots, Content Roots, Execution Roots, Math Roots) that captures the complete strategic foundation from business data, engine snapshots, and campaign settings into a versioned, hashable bundle. Root bundles are auto-locked during plan synthesis; all downstream artifacts (plans, calendar entries, required work, Content DNA) reference a specific root bundle ID and version. Root integrity validation ensures all plan components reference the same root version. Staleness detection compares current source data hash against locked root hash to flag when foundations have drifted. Plan approval is gated by root integrity + calendar deviation checks (type ≤5% threshold). Implementation: `server/root-bundle.ts`, `root_bundles` table. API: `GET /api/root-bundle/:campaignId`, `POST /api/root-bundle/lock`, `GET /api/root-bundle/:campaignId/integrity/:planId`, `GET /api/root-bundle/:campaignId/staleness`.
- **Execution Pipeline**: 8-stage pipeline (Build Plan → Roots → Content DNA → Approval → Calendar → Creation → Review → Publishing) with real-time status tracking and auto-decrement of required work counts. Roots stage shows version count and flags ACTION_NEEDED when stale. Content DNA stage auto-completes when DNA is generated after plan synthesis.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine (V4), Budget Governor Engine, Channel Selection Engine (V3 with Funnel Resolution), Iteration Engine (with synthesized funnel/creative analysis from campaign metrics), and Retention Engine (with raw data model and AI-derived metrics).
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules based on statistical thresholds. Includes a Statistical Validity Layer to gate scaling decisions.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data, including staleness coefficients and trust scores. Age-first classification: snapshots >7 days are always downgraded to NEEDS_REFRESH regardless of RESTORED/PARTIAL status, triggering `blockedForStrategy`. Both audience and positioning engines enforce hard freshness gates before MI data ingestion, returning MISSING_DEPENDENCY when blocked. The orchestrator maps MISSING_DEPENDENCY engine outputs to BLOCKED step status, preventing stale data from propagating downstream into plan synthesis.
- **Semantic Data Bridge**: Wires MIv3 high-fidelity signals into the Audience Engine's core maps (Pain Profiles, Desire Maps, Objection Maps).
- **Concurrency Hardening**: Includes MIv3 lock timeouts, batched Jaccard deduplication, and stale recovery safeguards.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Governance Rules**: 6 rules for strategy correction transparency, including auto-injection transparency, persuasion correction boundaries, decision gate awareness, cross-engine conflict prevention, and an audit trail.
- **Input Validation Gates**: Mandatory input gates for Iteration and Retention Engines to ensure foundational data is provided before analysis. Iteration Engine gate displays connected campaign metrics as read-only data (no manual re-entry). Retention Engine gate uses a raw operational data input model: users enter raw business data (totalCustomers, totalPurchases, returningCustomers, averageOrderValue, refundCount, monthlyCustomers) plus a time window (30/60/90 days), and the system computes all derived metrics (repeatPurchaseRate, estimatedLTV, churnRiskEstimate, retentionStrengthScore, purchaseFrequency, estimatedLifespanMonths) automatically via `computeDerivedRetentionMetrics()`. Gate validates: totalCustomers > 0, returningCustomers present (≥0), totalPurchases > 0, dataWindowDays ∈ {30, 60, 90}, plus retentionGoal, businessModel, and reachableAudience. Settings page mirrors raw input form with real-time derived metric preview.

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

### Meta Business Suite Integration
- Secure token storage with AES-256-GCM encryption.
- Full-scope OAuth for permission management.

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok