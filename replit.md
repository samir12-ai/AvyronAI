# Avyron AI

## Overview
Avyron AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, offering a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It features dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization.

### Backend
The backend employs Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, campaign metrics, a Strategic Narrative causal chain card, and an inline AI chat box.
- **Causal Narrative Layer**: A deterministic, read-only, stateless post-processing layer that transforms engine outputs into a 5-step causal chain (Market Problem → Why It Happens → What We Do → How We Fix It → What To Execute).
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **AI Management**: AI Audience Engine, Auto Publish, Market DB, and a Performance Intelligence Layer.
- **Strategic Engines**: Includes Positioning, Differentiation, Mechanism, Offer, Funnel, Integrity, Awareness, and Persuasion Engines, designed to generate comprehensive strategic plans.
- **Strategy Root System**: A unified source of truth binding all strategic engines via a single enforced root hash, ensuring data consistency and staleness detection.
- **Product DNA**: A source-of-truth layer injected into all strategic engines for identity context in AI prompts.
- **Competitive Intelligence (MIv3)**: An 8-engine sequential pipeline for real-data competitor analysis with 5-source intelligence (Instagram, Website, Blog, TikTok, Google Reviews).
- **Authority Hierarchy Enforcement**: Strict Awareness → Funnel → Persuasion authority hierarchy with cross-engine validation to prevent contradictions.
- **Analytical Enrichment Layer (AEL v2)**: A deep causal interpretation layer that produces WHY-level analysis, including root causes, causal chains, buying barriers, and priority-ranked insights.
- **Causal Enforcement Layer (CEL)**: A post-generation compliance layer that programmatically enforces alignment between AEL root causes and all downstream engine outputs.
- **Structured Signal Flow**: The Audience Engine outputs structured signals with enforced evidence quality, which are then consumed by the Positioning Engine.
- **Positioning Compression Layer**: A 3-phase deterministic compression system that forces sharper, single-territory output for positioning statements.
- **Territory Upstream Filter (Layer 10)**: A hard pre-LLM filter in territory selection that rejects audience-level territory names and data artifacts.
- **System Territory Translation**: A deterministic translation layer that converts audience-level canonical labels into system-level operational territory names.
- **Differentiation Compression Layer**: Merges overlapping differentiation pillars and uses prompt hardening for mechanism anchoring and business-type-conditional vocabulary.
- **Mechanism Engine AEL Causal Grounding**: Injects AEL identifiers into the mechanism generation prompt, requiring verbatim AEL language.
- **Signal Governance Layer (SGL v2)**: A unified signal source-of-truth that all downstream engines consume from, featuring signal purification and traceability.
- **System Integrity Validator (SIV)**: An end-to-end verification layer that validates signal reception, output traceability, and cross-engine alignment.
- **AI Orchestrator**: A single-entry orchestration engine running 15 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis.
- **BuildPlanLayer (Execution Synthesis Layer)**: A final execution layer that converts engine analysis into actionable decisions and daily/weekly instructions.
- **Execution Activation Layer**: Auto-triggers the content production pipeline upon plan approval.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine, Iteration Engine, and Retention Engine.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data.
- **Concurrency Hardening**: Includes lock timeouts, batched deduplication, stale recovery safeguards, and atomic plan approval.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Production Readiness**: Load tested for performance and stability with validated failure recovery.
- **Audit & Control System**: A 5-panel dashboard for auditing feeds, AI usage, gate status, decisions, publish history, and job management.
- **Decision Policy Layer (Phase 3)**: Central enforcement policy with confidence thresholds applied across plan synthesis, memory mutation, outcome tracking, and autonomous worker.
- **Decision Attribution Layer (Phase A)**: Campaign-scoped decision tracking for `strategy_decisions` and `decision_outcomes` for per-campaign outcome measurement.
- **Per-Action Attribution Layer (Phase B)**: `sourceDecisionId` populated on all calendar entries from 3 creation paths (plan-synthesis, execution-activation, execution-routes). Action-level performance lookup via `getActionPerformance()` traces decision → calendar entries → studio items → performance snapshots. Outcome evaluation uses action-level metrics when available (fallback: campaign → account). Measurement scope logged as `OUTCOME_SCOPE=action|campaign|account` for auditability.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Database
- PostgreSQL

### User Authentication
- JWT-based email/password authentication
- Stripe webhook integration for subscription management

### Video Credits System
- Manages video generation credits for users, deducting credits upon use and enabling top-ups.

### Website (Landing + Pricing)
- Static landing and pricing pages served by the Express backend.
- Clean SaaS design with brand accents and responsive layouts.

### Social Platforms
- Instagram
- Facebook
- Twitter
- LinkedIn
- TikTok