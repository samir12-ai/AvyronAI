# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. Its primary purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, providing a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It supports dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization. Engine components utilize a "lazy mount, keep alive" rendering pattern.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode with dual-window retention and latest-per-campaign protection.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine, and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines**: Includes Positioning, Offer, Funnel, Integrity, Awareness, Persuasion, and Differentiation Engines. The Differentiation Engine (V8) uses a dual signal model (Profile 40% / Market Intelligence 60%) with soft-warning mode for low signal grounding instead of hard failures.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis.
- **AI Orchestrator**: Single-entry orchestration engine that runs 14 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis.
- **Plan-First Dashboard**: Provides a hierarchical view of performance, active plan status, execution pipeline, required work, and advanced insights.
- **Content DNA**: Foundational content creation blueprint synthesized from engine outputs and business profile into structured rules and an execution framework.
- **MarketMind Agent**: A density-optimized strategy command center providing status, campaign overview, AI strategic insights, priority actions, and an interactive chat.
- **Agent Chat**: Multi-conversation agent with full system context injection.
- **Roots Foundation (V1)**: Unified root schema with 5 layers that captures the complete strategic foundation into a versioned, hashable bundle, ensuring root integrity and staleness detection.
- **Goal Decomposition Math Layer (Phase 2)**: Handles goal normalization, 6-stage funnel math, feasibility analysis, and 3-scenario lever-based growth simulation.
- **Business Archetypes & Plan Gate (Phase 3)**: Defines 6 adaptive business archetypes and a plan readiness gate that validates business clarity, goal specificity, and execution readiness.
- **Execution Task System (Phase 4)**: Auto-generates daily/weekly execution tasks from plan content distribution.
- **Conflict Resolution & Assumption Ledger (Phase 5)**: Manages conflict resolution with a 9-level priority policy and logs implicit assumptions with confidence and impact.
- **Execution Pipeline**: An 11-stage pipeline for plan execution with real-time status tracking.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine, Iteration Engine, and Retention Engine.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data.
- **Semantic Data Bridge**: Wires MIv3 high-fidelity signals into the Audience Engine's core maps.
- **Concurrency Hardening**: Includes MIv3 lock timeouts, batched Jaccard deduplication, and stale recovery safeguards.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Governance Rules**: 6 rules for strategy correction transparency and an audit trail.
- **Input Validation Gates**: Mandatory input gates for Iteration and Retention Engines to ensure foundational data is provided.

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

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok