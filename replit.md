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
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode, protecting COMPLETE/RESTORED/PARTIAL snapshots for 30 days and archiving INCOMPATIBLE snapshots.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines (V3)**: Includes Positioning, Offer (V5 with pre-generation constraint architecture), Funnel, Integrity, Awareness, Persuasion, and Differentiation Engines.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, featuring narrative objection extraction, clustering, content DNA bridging, and a Signal Quality Gate.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine (V4), Budget Governor Engine, Channel Selection Engine (V3 with Funnel Resolution), Iteration Engine (with synthesized funnel/creative analysis from campaign metrics), and Retention Engine (with raw data model and AI-derived metrics).
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules based on statistical thresholds. Includes a Statistical Validity Layer to gate scaling decisions.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data, including staleness coefficients and trust scores.
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