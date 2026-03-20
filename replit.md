# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights using AI. Its core purpose is to automate content generation, campaign management, post scheduling, and analytics across various platforms. The project aims to be a comprehensive, autonomous marketing solution focused on revenue generation and controlled content execution for businesses, offering a competitive edge through advanced AI capabilities and strategic intelligence.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project utilizes a monorepo structure, TypeScript for type safety, and platform abstraction for cross-platform compatibility (iOS, Android, Web). It features dynamic theming, extensive indexing, Zod-based request validation, self-healing snapshot resolution, system-wide fail-safe enforcement, and guarantees non-empty outputs from all engines. Cross-engine isolation validation prevents prohibited write targets.

### Frontend
The frontend is built with Expo SDK, React Native, Expo Router for navigation, React Context API for global state management, and TanStack React Query for server state. It includes a custom component library, React Native Reanimated for animations, and i18n-js for internationalization. Engine components use a "lazy mount, keep alive" rendering pattern.

### Backend
The backend employs Express.js with Node.js and TypeScript, exposing RESTful APIs. It integrates a dual-AI engine (OpenAI GPT and Google Gemini) for content and strategy, specialized models for AI image/design, and an autonomous engine for marketing decisions with guardrails and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage. Server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM. Snapshot lifecycle management operates in DATA_ARCHIVING mode with dual-window retention and latest-per-campaign protection.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, campaign metrics, and an inline AI chat box (DashboardChat) replacing the old MarketMindAgent info card. The full-screen agent chat is still accessible via FAB button.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Engine, and a Performance Intelligence Layer.
- **Strategic Engines**: Includes Positioning, Differentiation (V8), Mechanism (with AEL causal grounding), Offer, Funnel, Integrity, Awareness, and Persuasion (V4) Engines, designed to generate comprehensive strategic plans. The Offer Engine uses a deterministic skeleton architecture when a Strategy Root is active, ensuring strategic alignment.
- **Strategy Root System**: A unified source of truth binding all strategic engines via a single enforced root hash, ensuring data consistency and staleness detection.
- **Product DNA**: A source-of-truth layer injected into all strategic engines for identity context in AI prompts.
- **Competitive Intelligence (MIv3)**: A 6-layer pipeline for real-data competitor analysis with multi-source intelligence and signal normalization.
- **Authority Hierarchy Enforcement**: Strict Awareness → Funnel → Persuasion authority hierarchy with cross-engine validation to prevent contradictions.
- **Analytical Enrichment Layer (AEL v2)**: A deep causal interpretation layer that produces WHY-level analysis, including root causes, causal chains, buying barriers, and priority-ranked insights.
- **Causal Enforcement Layer (CEL)**: A post-generation compliance layer that programmatically enforces alignment between AEL root causes and all downstream engine outputs based on specific constraint rules.
- **Structured Signal Flow (Audience → Positioning)**: The Audience Engine outputs structured signals with enforced evidence quality, which are then consumed by the Positioning Engine.
- **Positioning Compression Layer**: A 3-phase deterministic compression system in the Positioning Engine that forces sharper, single-territory output. Phase 1: specificity scoring with system-noun, failure-verb, and cross-industry generic penalties. Phase 2: `compressTerritories()` merges overlapping territories (≥60% token overlap) and prompt rules enforce system-failure framing. Phase 3: `evaluateCompressionQuality()` post-generation validator penalizes broad/emotional territories that lack operational specificity.
- **Territory Upstream Filter (Layer 10)**: `filterAudienceTerritories()` — a hard pre-LLM filter in territory selection that rejects audience-level territory names (emotional/psychological labels) and data artifacts (analytical labels with signal counts). Uses 3 marker lists: SYSTEM_NOUNS (40+ structural terms), FAILURE_VERBS (27+ failure conditions), AUDIENCE_ONLY (70+ emotional/audience terms). Also detects data labels via regex. Falls back to best available candidates if all territories are filtered out. Post-filter `classifyTerritoryLevel()` and `validateTerritorySpecificity()` provide secondary validation with retry gate (max 1 retry with rejection context).
- **Layer 7 System Territory Translation**: `translateToSystemTerritory(label, signalType, productDna)` — deterministic (no LLM) translation layer that converts audience-level canonical labels from the Audience Engine into system-level operational territory names before they enter Layer 7 opportunity gap detection. Uses exact-match lookup tables for pain/desire/root_cause/psych_driver signals, `inferDomainNoun(productDna)` for domain-aware framing (marketing/platform/service delivery/conversion/care delivery/learning/financial/operational), and `buildGenericSystemTerritory()` as fallback that strips audience emotion words and appends type-specific suffixes (process breakdown, mechanism gap, etc.).
- **Positioning Signal Direct Composition**: The Positioning Engine directly composes positioning from specific signal clusters pre-mapped to territories.
- **Differentiation Compression Layer**: Phase 1: `compressDifferentiationPillars()` merges overlapping pillars using Jaccard token similarity with business-type-aware thresholds, caps at `MAX_PILLARS=3`. Phase 2: Prompt hardening in `layer11_aiRefinement()` — mechanism anchoring (passes `mechanismCore.mechanismSteps` into prompt), business-type-conditional vocabulary (SaaS→system/pipeline, service→process/method, ecommerce→flow/conversion), explicit contrast requirement ("We do X, while the market does Y"), anti-generic constraint rejecting cross-industry language. Scoring penalties (not hard rejection) for missing contrast/mechanism linkage. Phase 2b: AEL injection strengthening — `buildStructuredAELBlock()` formats root causes [RC#], causal chains [CC#], and barriers [BB#] as numbered identifiers the LLM must reference; prompt requires verbatim AEL language in pillar descriptions and claims; output schema includes `rootCauseUsed` and `barrierResolved` fields; `AEL_GROUNDING_RESULT` log tracks reference compliance.
- **Mechanism Engine AEL Causal Grounding**: Same `buildStructuredAELBlock()` pattern applied to the Mechanism Engine — injects [RC#]/[CC#]/[BB#] identifiers into the mechanism generation prompt, requires verbatim AEL language in mechanism description/steps/logic, adds `rootCauseUsed` and `barrierResolved` output fields, and logs `AEL_GROUNDING_RESULT` for compliance tracking. Mechanism steps must follow cause→intervention→outcome chains grounded in AEL causal chains.
- **Differentiation Signal Grounding Enforcement**: A stability guard that validates the proofability and trust alignment of differentiation claims, rejecting and re-prompting with specific grounding rejection context if criteria are not met.
- **Signal Governance Layer (SGL v2)**: A unified signal source-of-truth that all downstream engines consume from, featuring signal purification to remove raw user comments and ensure signal traceability.
- **System Integrity Validator (SIV)**: An end-to-end verification layer that runs after all engines complete, validating signal reception, output traceability, and cross-engine alignment.
- **AI Orchestrator**: A single-entry orchestration engine running 15 engines in priority order with checkpoint persistence, generating coherent 9-section strategic plans via AI synthesis. The OrchestratorPanel component (Build Plan tab in AI Management) shows real-time pipeline status, all 15 engine results with colored status indicators, and a View button to open the full strategic plan document.
- **BuildPlanLayer (Execution Synthesis Layer)**: A final execution layer that converts engine analysis into actionable decisions and daily/weekly instructions, including content DNA and specific execution actions.
- **Execution Activation Layer**: Auto-triggers the content production pipeline upon plan approval, enforcing content queue minimums and scheduling completeness.
- **Fortress Completion Engines (V3 Strategy Layer)**: Includes Statistical Validation Engine, Budget Governor Engine, Channel Selection Engine (V4), Iteration Engine, and Retention Engine.
- **Adaptive Data Source System**: Supports `campaign_metrics` and `benchmark` modes with adaptive switching rules and a Statistical Validity Layer.
- **Snapshot Trust & Freshness System**: Provides temporal decay scoring, schema validation, and freshness classification for data.
- **Concurrency Hardening**: Includes lock timeouts, batched deduplication, and stale recovery safeguards.
- **Scalability & Thundering Herd Protection**: Features a global job queue, per-account job budgets, shared market data cache, request deduplication, and a rate gate.
- **Audit & Control System**: A 5-panel dashboard for auditing feeds, AI usage, gate status, decisions, publish history, and job management.

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