# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application that leverages AI to streamline marketing workflows, enhance brand presence, and provide strategic insights. Its primary goal is to automate social media content generation, campaign management, post scheduling, and analytics, offering an AI-powered, autonomous marketing solution focused on revenue generation and controlled content execution. The project aims to provide a comprehensive tool for businesses to manage their marketing efforts efficiently and effectively across various platforms.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project uses a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It features a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It incorporates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, complemented by specialized models for AI image/design. An autonomous engine manages marketing decisions with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text generation and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence for audience segmentation and targeting), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Positioning Engine V3**: A 12-layer strategic positioning engine for generating strategic insights and positioning statements with advanced category resolution and signal extraction.
- **Offer Engine V3**: A 5-layer structured Offer Decision Engine that consumes upstream data and produces primary, alternative, and rejected offer options based on layers like Outcome, Mechanism, Delivery, Proof, and Risk Reduction.
- **Differentiation Engine V3**: A 12-layer proof-backed engine for identifying unique selling propositions with uniqueness score calibration and mechanism framing guards.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis, including data integrity checks, synthetic comment management, competitor authority weighting, and demand pressure analysis.
- **FAST_PASS / DEEP_PASS Architecture**: A two-stage inventory system for competitor data collection and enrichment, focusing on efficient post and comment acquisition.
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generates and stores strategic marketing plans.
- **Strategic Execution Machine**: A pipeline for transforming strategic blueprints into published content with approval gates.
- **Strategic Core Architecture ("Build The Plan")**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Database Hardening**: Includes extensive indexing, unique constraints, and structural fixes.
- **Backend Stabilization**: Features AI cost management, worker hardening, safety gate registry, and Zod-based request validation.
- **Fetch System Hardening**: Implements safeguards for fair request allocation, explicit fetch status, and dynamic budget scaling.
- **Final System Lock**: Ensures unified business profiles, dashboard metrics from campaign-scoped data, and evidence-bound AI actions.
- **Pipeline Hardening**: Includes an engine state machine, snapshot integrity verification, and auto-refresh mechanisms.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Scalability Protection
Includes a global job queue with configurable concurrency limits, per-account job budgets, and a shared market data cache.

### Thundering Herd Protection
Implements request deduplication, queue prioritization, backpressure mechanisms, and a rate gate.

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