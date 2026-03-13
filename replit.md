# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. It automates content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, providing a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend utilizes Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist (including text-to-video and image-to-video).
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines (V3)**: A suite of advanced AI engines including Positioning Engine, Offer Engine (V5) with pre-generation constraint architecture, Funnel Engine, Integrity Engine, Awareness Engine, Persuasion Engine, and Differentiation Engine (which generates a structured MechanismCore).
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, including narrative objection extraction, clustering, and content DNA bridging. Features a Signal Quality Gate to ensure data reliability and deduplication.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **System Hardening**: Includes extensive indexing, unique constraints, Zod-based request validation, self-healing snapshot resolution, and a shared hardening library.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes a Statistical Validation Engine (V4) for signal-grounded claims, Budget Governor Engine, Channel Selection Engine, Iteration Engine, and Retention Engine.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Engine Tab Persistence (Keep-Alive Pattern)
Engine components in AI Management (Positioning, Differentiation, Offer, Funnel, Integrity, Awareness, Persuasion, Statistical Validation, Budget Governor, Channel Selection, Iteration, Retention) use a "lazy mount, keep alive" rendering pattern. Once an engine tab is first visited, the component stays mounted (hidden with `display: 'none'`) when switching to other tabs, preserving React state and analysis results without requiring re-fetch from the database.

### Snapshot Lifecycle Management
Operates in DATA_ARCHIVING mode (not immediate purge). COMPLETE/RESTORED/PARTIAL snapshots are protected for 30 days minimum. INCOMPATIBLE snapshots are archived to `snapshot_archive` table for recovery instead of deleted. Active session protection ensures the latest snapshot per campaign per table is never cleaned. The worker delays initial run by 5 minutes after startup. Only orphaned data (no parent campaign) and non-protected data exceeding the 30-day cold storage limit are targeted for cleanup. Per-campaign cap remains at 20 snapshots.

### Data Source Mode System
Campaigns support two data source modes: `campaign_metrics` (uses actual campaign performance data from `manual_campaign_metrics` table) and `benchmark` (uses regional industry benchmarks from `server/data-source/benchmarks.ts`). Mode is stored in `campaign_selections.dataSourceMode` (default: `benchmark`). The resolver (`server/data-source/resolver.ts`) automatically falls back to benchmark if campaign metrics are insufficient or fail validation. Anomaly detection (`server/data-source/validation.ts`) checks for suspicious metrics (CPA < $1, ROAS > 20x, spend/results inconsistency). The Budget Governor integrates data source resolution — using benchmark CPA/ROAS when in benchmark mode, and attaching data source metadata (mode, confidence, anomalies, warnings) to every decision snapshot. The confidence threshold for scaling was raised from 65% to 70% (`MIN_VALIDATION_CONFIDENCE_FOR_SCALE = 0.70`). REST API routes: `/api/data-source/resolve`, `/api/data-source/benchmarks`, `/api/data-source/validate-metrics`, `/api/data-source/mode`. Frontend: campaign creation form includes data source mode selector; AI Control Center shows a data source mode indicator badge; Budget Governor UI displays data source banners with anomaly warnings.

### Snapshot Trust & Freshness System
A core module for temporal decay scoring, schema validation, and freshness classification, providing staleness coefficients, freshness classes (FRESH/AGING/NEEDS_REFRESH/PARTIAL/INCOMPATIBLE), trust scores, and strategy-blocking statuses. Freshness metadata is included in all engine route responses and triggers frontend warnings.

### Semantic Data Bridge (MIv3 → Audience Engine)
A strategic data bridge that wires MIv3 high-fidelity signals directly into the Audience Engine's core maps (Pain Profiles, Desire Maps, Objection Maps). It features clean-pipe architecture (signals must have >0.85 confidence), full traceability with parentSignalId, and a conflict resolution protocol where MIv3 quality-gated signals take precedence as Strategic Anchors.

### Concurrency Hardening
Includes MIv3 lock timeouts, batched Jaccard deduplication for signals, and a stale recovery safeguard to prevent overwriting active sessions.

### Scalability and Thundering Herd Protection
Features a global job queue with configurable concurrency limits, per-account job budgets, a shared market data cache, request deduplication, queue prioritization, backpressure mechanisms, and a rate gate.

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