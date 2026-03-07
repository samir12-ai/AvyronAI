# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to leverage AI for streamlining marketing workflows, enhancing brand presence, and providing strategic insights. Its core purpose is to automate social media content generation, campaign management, post scheduling, and analytics, offering an AI-powered, autonomous marketing solution focused on revenue generation and controlled content execution. The project aims to provide a comprehensive tool for businesses to manage their marketing efforts efficiently and effectively across various platforms.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, enforces TypeScript for type safety, and supports platform abstraction for cross-platform compatibility (iOS, Android, Web). It also includes dynamic theming for light and dark modes.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It features a custom component library, React Native Reanimated for animations, and i18n-js for internationalization supporting 32 languages.

### Backend
The backend runs on Express.js with Node.js and TypeScript, exposing RESTful APIs. It incorporates a dual-AI engine using OpenAI GPT and Google Gemini for content and strategy, complemented by specialized models for AI image/design. An autonomous engine manages marketing decisions with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text generation and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence for audience segmentation and targeting), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Positioning Engine V3**: A 12-layer strategic positioning engine for generating strategic insights and positioning statements.
- **Differentiation Engine V3**: A 12-layer proof-backed differentiation engine for identifying and articulating unique selling propositions.
- **Competitive Intelligence (MIv3)**: Provides real-data competitor analysis through a 6-layer pipeline for data processing and signal generation, including robust data integrity checks and synthetic comment management.
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generates and stores strategic marketing plans.
- **Strategic Execution Machine**: A pipeline for transforming strategic blueprints into published content with approval gates.
- **Strategic Core Architecture ("Build The Plan")**: A 6-phase sequential engine for comprehensive plan generation, using an AI Creative Blueprint from various data sources.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas, a Context Kernel, an Engine Registry, and an Uncertainty Guard.
- **Database Hardening**: Includes extensive indexing, unique constraints, and structural fixes for data integrity and performance.
- **Backend Stabilization**: Features AI cost management, worker hardening, safety gate registry, robust memory scoping, per-account proxy pools, intelligent backoff for retries, and Zod-based request validation.
- **Fetch System Hardening**: Implements safeguards for fair request allocation, explicit fetch status, partial completion awareness, dynamic budget scaling, and structured diagnostics logging.
- **Final System Lock**: Ensures unified business profiles, dashboard metrics from campaign-scoped data, evidence-bound AI actions, and explicit campaign ID scoping.
- **Pipeline Hardening**: Includes an engine state machine, snapshot integrity verification, freshness calculations, frontend snapshot normalization, and auto-refresh mechanisms.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Scalability Protection
Includes a global job queue with configurable concurrency limits and per-account job budgets, a shared market data cache, and an admin dashboard for monitoring market data.

### Thundering Herd Protection
Implements request deduplication, queue prioritization, backpressure mechanisms, and a rate gate to limit job promotions. Includes queue health monitoring diagnostics.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Database
- PostgreSQL (managed with Drizzle ORM)

### User Authentication
- Meta OAuth

### Meta Business Suite Integration
- Secure token storage with AES-256-GCM encryption.
- Full-scope OAuth for permission management.
- Handles various Meta connection states and capability gates.

### Social Platforms
- Instagram (via Meta Business Suite)
- Facebook (via Meta Business Suite)
- Twitter
- LinkedIn
- TikTok