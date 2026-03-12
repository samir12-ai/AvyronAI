# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. It automates content generation, campaign management, post scheduling, and analytics across various platforms, aiming to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, TypeScript for type safety, and platform abstraction to ensure cross-platform compatibility (iOS, Android, Web). It also supports dynamic theming.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It features a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend uses Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine V3 (12-layer intelligence), and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including text-to-video and image-to-video.
- **Lead Engine**: Modular lead generation with AI Lead Optimization.
- **Strategic Engines (V3)**:
    - **Positioning Engine**: 12-layer engine for strategic insights and positioning statements.
    - **Offer Engine**: 5-layer decision engine for generating offer options, enforcing mechanism rules, and validating alignment.
    - **Funnel Engine**: 8-layer decision engine for generating funnel outputs with trust paths and proof placement, including hard-fail boundary enforcement.
    - **Integrity Engine**: 8-layer validation engine for cross-engine consistency and overall integrity scoring.
    - **Awareness Engine**: 8-layer execution engine for awareness routes, readiness mapping, and trigger identification.
    - **Persuasion Engine**: 8-layer logic engine for persuasion architecture (not copy/ads), focusing on influence drivers, objection priorities, and message order. Features Auto-Correction Layer (enforces AWARENESS_PERSUASION_MAP), separated Awareness Stage Properties from Trust Barriers, decoupled Message Architecture from Funnel Structure, and credibility-score-only Anti-Hype Guard.
    - **Differentiation Engine**: 12-layer engine for identifying unique selling propositions and generating **MechanismCore** (a structured mechanism object that serves as a single source of truth across other engines).
- **Competitive Intelligence (MIv3)**: 6-layer pipeline for real-data competitor analysis, including narrative objection extraction and signal classification.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **System Hardening**: Includes extensive indexing, unique constraints, Zod-based request validation, self-healing snapshot resolution, and a shared hardening library with features like `sanitizeBoundary`, `assessDataReliability`, and `checkCrossEngineAlignment`.
- **Mechanism Construction Validation**: Differentiation Engine validates that MechanismCore describes structured transformation processes (not conceptual themes). `validateMechanismIsTransformation()` checks for action verbs in steps/logic. `refineMechanismFromTheme()` auto-transforms themes into operational mechanisms.
- **Awareness → Persuasion Mode Alignment**: Persuasion Engine enforces strict awareness-to-mode mapping (unaware→education, problem_aware→empathy, solution_aware→contrast, product_aware→proof, most_aware→proof) via `AWARENESS_PERSUASION_MAP`.
- **Trust Proof Sequencing**: `buildTrustProofSequence()` enforces deterministic escalation path: process_proof → case_proof → outcome_proof → transparency_proof. Integrated into `layer5_proofPriorityMapping`.
- **Message Architecture Enforcement**: `validateMessageArchitecture()` enforces problem → mechanism → proof → outcome → offer ordering in persuasion message sequences. Violations logged as warnings.
- **Strategy Acceptability Layer**: `assessStrategyAcceptability()` in `server/shared/strategy-acceptability.ts` provides graded strategy states (green/yellow/orange/red) with adaptive fallback strategies. No engine ever halts — all return an adaptive path. Integrated into Offer, Funnel, and Persuasion engines.
- **Cross-Engine Synchronization**: Integrity Engine validates MechanismCore action verbs, offer-deliverable-to-mechanism alignment, and awareness-persuasion consistency across engines.
- **Fortress Completion Engines (V3 Strategy Layer)**:
    - **Statistical Validation Engine (V4)**: Signal-grounded claim architecture with equivalence mapping and traceability. **Signal → Reasoning → Claim Architecture (V4.2)**: All claim-generating engines (Offer, Awareness, Persuasion) enforce Signal → Reasoning → Claim flow via upstreamLineage parameter and extractQualifyingSignals() with MIN_QUALIFYING_SIGNALS = 3 hard guard. Offer Engine injects signal anchors into AI prompt and validates grounding post-AI (validateClaimGrounding()); strips ungrounded deliverables, falls back on outcomes/mechanisms, returns SIGNAL_INSUFFICIENT if grounding ratio < 30%. Awareness and Persuasion engines hard-guard on qualifying signal count. Statistical Validation elevates lineage-anchored claims (assumption/inferred → structured_inference with +0.1 strength boost). Frontend shows origin engine labels and parent signal IDs in purple lineage rows.
    - **Budget Governor Engine**: Determines test/scale/hold/halt budget decisions based on multi-factor risk scoring. Guard prevents scaling when validation confidence low or CAC assumptions unrealistic.
    - **Channel Selection Engine**: Scores 16 channels across 8 layers (audience density, awareness mapping, persuasion compatibility, budget constraints). Guard rejects channels with weak audience density or mode mismatch.
    - **Iteration Engine**: Identifies optimization opportunities from campaign/funnel/creative/persuasion performance. Guard prevents random experimentation and repeating failed tests.
    - **Retention Engine**: Detects retention leverage points, churn risks, LTV expansion paths. Guard flags unclear value delivery and missing retention mechanisms.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Scalability and Thundering Herd Protection
Includes a global job queue with configurable concurrency limits, per-account job budgets, a shared market data cache, request deduplication, queue prioritization, backpressure mechanisms, and a rate gate.

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