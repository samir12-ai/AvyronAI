# MarketMind AI

## Overview
MarketMind AI is a cross-platform marketing automation application designed to streamline marketing workflows, enhance brand presence, and provide strategic insights. It uses AI to generate social media content, manage campaigns, schedule posts, and deliver analytics. The project aims to replace traditional marketing agencies by offering AI-powered, autonomous marketing capabilities focused on revenue generation and controlled content execution.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
The project adheres to a monorepo structure, enforces type safety with TypeScript, supports platform abstraction for cross-platform compatibility (iOS, Android, Web), and includes dynamic theming for light and dark modes.

### Frontend
The frontend is built with Expo SDK and React Native, utilizing Expo Router for file-based navigation, React Context API for global state, and TanStack React Query for server state. It includes a custom component library for UI/UX, React Native Reanimated for animations, and i18n-js for internationalization across 32 languages.

### Backend
The backend runs on Express.js with Node.js and TypeScript, exposing RESTful APIs. It features a dual-AI engine leveraging OpenAI GPT and Google Gemini for content and strategy, along with specialized models for AI image/design. An autonomous engine manages marketing decisions with guardrails, adaptive baselines, hybrid risk classifiers, and a decision feedback loop.

### Data Storage
Client-side data is stored using AsyncStorage, while server-side data, including user information and chat conversations, is managed in PostgreSQL with Drizzle ORM.

### Key Features
- **Dashboard**: Displays revenue-focused KPIs, AI action summaries, and campaign metrics.
- **Content Creation**: AI Writer for text and AI Designer for image generation.
- **Calendar**: AI Calendar Assistant for content scheduling.
- **AI Management**: Auto-Publisher for Meta platforms, AI Audience Manager, and a Performance Intelligence Layer.
- **Studio**: Media library with AI Auto-Fill metadata, AI Video Editor, and AI Video Analysis Assist, including integration with Google Veo 3.1 for text-to-video and image-to-video generation.
- **Lead Engine**: Modular lead generation system with AI Lead Optimization.
- **Competitive Intelligence (MIv3)**: Provides real-data competitor analysis through a 6-layer pipeline (Signals → ContentDNA → Intent → Trajectory → Confidence → Dominance) for data processing, signal generation, and trajectory analysis, incorporating a confidence model and anti-bias guards. It includes robust data integrity checks, cooldown mechanisms, and dynamic time window adjustments for data fetching. ENGINE_VERSION=12. **Two-Speed Data Collection**: Fast Pass (8-10 posts/competitor, no comments, 3-8 min completion, dataStatus=LIVE) → Deep Pass (auto-queued background enrichment, 25 posts + comments from top 3 engagement posts per competitor, max 50 comments/post, dataStatus=ENRICHING→COMPLETE). Cache-first collection: 12h reuse window, duplicate post dedup, no comment re-scraping. **Request Pacing**: Token bucket rate limiter 5-12s range (TOKEN_REFILL_INTERVAL=5000, JITTER=7000), 3-5s inter-request delay. **Engagement Quality Classifier**: HIGH_INTENT (questions, confusion, help requests, method comparisons) vs LOW_VALUE (emoji, generic praise), engagementQualityRatio. **Market Activity vs Market Demand**: Activity = posting frequency/volume, Demand = audience intent quality from engagement signals. **Audience Intent Signals**: Deterministic labels (audience_confusion, beginner_questions, price_sensitivity, method_comparison, help_requests, results_seeking, trust_concerns). **Self-Updating MI**: Auto-polling 30s refetchInterval during ENRICHING status, stops on COMPLETE. **UI Status Badges**: Data Status (LIVE/ENRICHING/COMPLETE), Evidence Coverage %, Confidence X/100, Last Updated timestamp. **Layer-0 Architecture**: MIv3 is strictly Layer-0 Market Intelligence — signals and diagnosis only, no strategic prescriptions. Output fields: `marketDiagnosis` (descriptive market state), `threatSignals` (observed threats only), `opportunitySignals` (observed market openings — descriptive only), `signalNoiseRatio` (0-1 quality metric), `evidenceCoverage` (posts/comments/competitors analyzed). Old `entryStrategy`/`defensiveRisks` fields replaced. **Forbidden Words Contract**: Runtime + static tests enforce zero prescriptive language (Opportunity, Advantage, Focus on, Differentiate, Establish, You should, Must, We recommend, first-mover, best approach, best angle, strategy pivot) in all `buildMarketDiagnosis` and `buildThreatSignals` outputs. **Threat Signals**: Expanded structural risk detection — narrative convergence, hook/angle duplication, offer clustering, market density (high/low), positioning shifts, declining activity, revival potential. **Threats Tab**: Threat Signals section always visible (with count badge), index interpretations per trajectory metric, Competitor Intent Map enriched with Content DNA (narrative pattern, hook style, CTA pattern). **Freshness Hard Gate**: `FRESHNESS_HARD_GATE_DAYS=14` — data older than 14 days triggers mandatory BLOCK, overrides all other guard decisions. Intelligence layers: Content DNA (`content-dna.ts`) for deterministic hook/narrative/CTA framework detection per competitor with evidence and confidence gating; Delta Intelligence (`computeSnapshotDeltas`) for explicit field-level snapshot-to-snapshot change analysis (signals, intents, trajectory, dominance) gated by competitorHash match; Calibration split into MIv3 confidence-engine (coverage/freshness/stability guards) and isolated performance baselines (`baselines.ts`) with zero cross-imports. **Market Baseline Calibration** (`market-baselines.ts`): Rolling 5-snapshot window (`BASELINE_WINDOW=5`) computes per-metric baselines from historical trajectory data. `computeAllDeviations()` detects elevated/depressed signals when observed values deviate beyond a dynamic threshold from baseline. Requires `MIN_SNAPSHOTS_FOR_CALIBRATION=2` snapshots for calibrated baselines; falls back to `FALLBACK_BASELINE` (narrative=0.35, angle=0.30, offer=0.25, heating=0.40, revival=0.30) when insufficient history. `buildThreatSignals` and `buildOpportunitySignals` are deviation-relative — signals reference "above/below baseline" instead of fixed thresholds. Wired into both `engine.ts` and `fetch-orchestrator.ts` execution pipelines. **Final Calibration Safeguards**: (1) Time-Weighted Baseline — weights [0.10, 0.15, 0.20, 0.25, 0.30] give recent snapshots 3x the weight of oldest, adapting faster to market shifts. (2) Uncalibrated Mode — when `isCalibrated=false`, zero deviation-based threat/opportunity signals are generated; output explicitly states "BASELINE CALIBRATION IN PROGRESS". (3) Dynamic Deviation Threshold — `BASE_DEVIATION_TRIGGER=0.25` adjusted by `CalibrationContext` (signalNoiseRatio, confidenceScore, postsAnalyzed, competitorCoverage); low confidence/noisy data raises threshold up to 0.60, high confidence lowers to 0.10. (4) Baseline Integrity — baselines computed only from MIv3 historical snapshots, zero cross-module imports from performance baselines, deterministic per-snapshot computation, same calibrated window for all comparisons. Post-deployment safeguards: global request ceiling (MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT=1, strict sequential per-competitor fetch, batch fetch routes deprecated with 410, QUEUED status, 5s stagger), goal mode source of truth (goalMode on growthCampaigns, engine reads from campaign config), PARTIAL snapshot cache exclusion, similarity diagnosis guard (SIMILARITY_MIN_EVIDENCE_THRESHOLD=8, LOW_CONFIDENCE diagnosis), engagement bias protection (ENGAGEMENT_BIAS_THRESHOLD=0.50), data resilience (fallback to valid cached snapshot on fetch failure), presentation isolation (tab switching triggers zero API calls).
- **Creative Capture Layer**: Analyzes reels for deterministic signals and AI interpretation.
- **Plan Documents**: Generates and stores strategic plans.
- **Snapshot Hardening**: Ensures data integrity and consistency with versioning, cache invalidation, and strict persistence rules for analytical snapshots.
- **Strategic Execution Machine**: A single-track pipeline for transforming strategic blueprints into published content with approval gates.
- **Strategic Core Architecture ("Build The Plan")**: A 6-phase sequential engine (Gate → Blueprint → Confirm → Analyze → Validate → Execute) with hard gates for comprehensive plan generation. Phase 1 generates an AI Creative Blueprint from market intelligence, competitor signals, business data, and campaign context — no user media upload required. Creative Blueprint includes hook direction, narrative structure, CTA recommendation, content angle, visual direction, and format suggestion. Video/media analysis belongs in Studio, not Build Plan. Uses GPT-4.1-mini for blueprint generation with automatic fallback.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas, a Context Kernel for strategic context, an Engine Registry, and an Uncertainty Guard for plan viability assessment.
- **Backend Stabilization**: Includes AI cost management, extensive database indexing, worker hardening with decision caps and circuit breakers, safety gate registry, and robust memory scoping for account and campaign isolation. It also features per-account proxy pools with sticky sessions, intelligent backoff for retries, and Zod-based request validation.
- **Final System Lock**: Ensures unified business profiles, dashboard metrics derived from campaign-scoped data, evidence-bound AI actions, and explicit campaign ID scoping for multi-campaign management. All AI creation outputs are saved to `studio_items` triggering background AI analysis.

## External Dependencies

### AI Services
- **OpenAI API**
- **Google Gemini**

### Database
- **PostgreSQL** (managed with Drizzle ORM)

### User Authentication
- **Meta OAuth**

### Meta Business Suite Integration
- Secure token storage with AES-256-GCM encryption.
- Full-scope OAuth for permission management.
- Handles various Meta connection states and capability gates.

### Audit & Control System
- Backend endpoints for audit feeds, AI usage, gate status, decisions, publish history, and job management.
- Frontend 5-panel dashboard for System Gates, AI Token Budget, Recent Activity, Decisions, and Worker/Jobs.

### Social Platforms
- **Instagram** (via Meta Business Suite)
- **Facebook** (via Meta Business Suite)
- **Twitter**
- **LinkedIn**
- **TikTok**