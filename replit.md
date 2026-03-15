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
- **Content DNA**: Foundational content creation blueprint synthesized from all engine outputs + business profile into 8 structured rules + Content Instructions execution framework. Rules: Messaging Core, CTA DNA, Hook DNA, Narrative DNA, Content Angle DNA, Visual DNA, Format DNA, Execution Rules. Content Instructions (9th component): hookGuide (structure + examples), narrativeBreakdown (post structure, carousel flow, reel script), ctaPlacement (soft vs hard, reel CTA), visualDirection (talking-head, b-roll). Stored in `content_dna` table (`content_instructions` column). Injected into all content generation system prompts and agent context. Available via `GET /api/content-dna/:campaignId` and `POST /api/content-dna/generate`. Implementation: `server/content-dna-routes.ts`.
- **MarketMind Agent (Agent Control Box)**: Density-optimized strategy command center (`components/MarketMindAgent.tsx`) backed by `/api/dashboard/agent-brief` and `/api/dashboard/agent-explain`. Shows only: pulsing status, campaign overview, AI strategic insight, priority action recommendation, content progress bar, and interactive "Ask the Agent" chat. Removed: Content DNA grid, Goal decomposition block, Ops Row (tasks/sim/assumptions), shortcut buttons, expandable engine intelligence section, and duplicated metrics (CPA/ROAS/Spend/Revenue) — these live in dedicated dashboard components. Agent backend still aggregates all 14 engine outputs, plan data, metrics, and Content DNA for AI-generated insights.
- **Agent Chat**: Multi-conversation agent with full system context injection (business profile, campaign, plan, execution state, required work, calendar, studio, engine outputs, Content DNA, warnings). Agent role: strategic operations manager that explains, guides, and suggests within defined boundaries. Includes Content DNA awareness for content creation guidance.
- **Roots Foundation (V1)**: Unified root schema with 5 layers (Business Roots, Funnel Roots, Content Roots, Execution Roots, Math Roots) that captures the complete strategic foundation from business data, engine snapshots, and campaign settings into a versioned, hashable bundle. Root bundles are auto-locked during plan synthesis; all downstream artifacts (plans, calendar entries, required work, Content DNA) reference a specific root bundle ID and version. Root integrity validation ensures all plan components reference the same root version. Staleness detection compares current source data hash against locked root hash to flag when foundations have drifted. Plan approval is gated by root integrity + calendar deviation checks (type ≤5% threshold). Implementation: `server/root-bundle.ts`, `root_bundles` table. API: `GET /api/root-bundle/:campaignId`, `POST /api/root-bundle/lock`, `GET /api/root-bundle/:campaignId/integrity/:planId`, `GET /api/root-bundle/:campaignId/staleness`.
- **Goal Decomposition Math Layer (Phase 2)**: Goal normalization (customer_acquisition, lead_generation, revenue_growth, audience_growth, reach_growth), full 6-stage funnel math (Reach → Clicks → Conversations → Leads → Qualified Leads → Closed Clients with CTR, click-to-conversation rate, conversation-to-lead rate, lead-to-client rate), feasibility engine (feasible/borderline/unrealistic with constraint analysis + BudgetAdjustment auto-correction: reduce_target/extend_timeline/increase_budget), 3-scenario lever-based growth simulation (conservative=baseline, base=+20% conversion optimization, upside=1.5x budget + improved conversion; each with strategic lever explanation and highestLeverageDriver). Budget enforcement: when feasibility finds budget insufficient, effective target is adjusted before simulation. Tables: `goal_decompositions`, `growth_simulations`. API: `POST /api/goal-math/decompose`, `POST /api/goal-math/simulate`, `GET /api/goal-math/:campaignId`. Implementation: `server/goal-math.ts`.
- **Business Archetypes & Plan Gate (Phase 3)**: 6 adaptive business archetypes (Agency/Services, E-Commerce, Restaurant/Local, High-Ticket Consulting, SaaS, Local Service) each with funnel archetype, channel priority, trust/proof scores, content-to-conversion weights. Plan readiness gate validates business clarity, goal specificity, funnel viability, budget feasibility, execution readiness, data confidence. Returns PASS/PASS_WITH_ASSUMPTIONS/BLOCKED with per-dimension scores. Account score modifies simulation confidence and content ratios. API: `POST /api/plan-gate/check`, `GET /api/plan-gate/:campaignId`. Implementation: `server/plan-gate.ts`.
- **Execution Task System (Phase 4)**: Auto-generates daily/weekly execution tasks from plan content distribution. Task types: content_production, launch, optimization, engagement, review. Tasks have day/week numbers, categories, priorities, and status tracking. Table: `execution_tasks`. API: `GET /api/execution-tasks/:campaignId`, `POST /api/execution-tasks/:taskId/status`, `POST /api/execution-tasks/generate`. Implementation: `server/task-composer.ts`.
- **Conflict Resolution & Assumption Ledger (Phase 5)**: Conflict resolution policy with 9-level priority (hard constraints > compliance > goal feasibility > funnel math > budget limits > business fit > channel fit > content preference > stylistic suggestions). Assumption ledger logs every implicit assumption with confidence (low/medium/high), impact severity, source engine, and affected modules. Automatic detection of implicit assumptions from missing business data. Table: `plan_assumptions`. API: `GET /api/plan-assumptions/:planId`, `POST /api/plan-assumptions/detect`. Implementation: `server/conflict-resolver.ts`.
- **Execution Pipeline**: 11-stage pipeline (Goal Math → Build Plan → Roots → Simulation → Content DNA → Approval → Tasks → Calendar → Creation → Review → Publishing) with real-time status tracking and auto-decrement of required work counts. Roots stage shows version count and flags ACTION_NEEDED when stale. Content DNA stage auto-completes when DNA is generated after plan synthesis. Goal Math and Simulation stages track decomposition and growth simulation completion.
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