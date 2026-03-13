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
    - **Offer Engine (V5)**: 5-layer decision engine with pre-generation constraint architecture ("constrain before generating"). **PositioningLock**: `buildPositioningLock()` extracts immutable axis constraints (contrastAxis, enemyDefinition, problemDomain, solutionDomain, mechanismName, mechanismFamily) from positioning+differentiation before AI generation. **Pre-generation validation**: `validatePreGenerationConstraints()` checks lock/differentiation compatibility before AI call. **AI prompt injection**: locked axis embedded as immutable rules in AI prompt with explicit compliance/violation examples. **Post-generation clamping**: `clampOfferToAxis()` force-aligns offer name, outcome, and mechanism to locked axis when they drift. **Corrective retry**: on hook-mechanism mismatch, retry passes `axisCorrection.previousFailures` to AI prompt so it can fix specific violations. **Positioning Alignment Guard**: `checkHookMechanismAlignment()` enforces hook+outcome+mechanism share same contrast axis; `POSITIONING_MISMATCH` status blocks selection; confidence penalty 0.5x; all retry paths pass positioning lock.
    - **Funnel Engine**: 8-layer decision engine for generating funnel outputs with trust paths and proof placement, including hard-fail boundary enforcement.
    - **Integrity Engine**: 8-layer validation engine for cross-engine consistency and overall integrity scoring.
    - **Awareness Engine**: 8-layer execution engine for awareness routes, readiness mapping, and trigger identification.
    - **Persuasion Engine**: 8-layer logic engine for persuasion architecture (not copy/ads), focusing on influence drivers, objection priorities, and message order. Features Auto-Correction Layer (enforces AWARENESS_PERSUASION_MAP), separated Awareness Stage Properties from Trust Barriers, decoupled Message Architecture from Funnel Structure, and credibility-score-only Anti-Hype Guard.
    - **Differentiation Engine**: 12-layer engine for identifying unique selling propositions and generating **MechanismCore** (a structured mechanism object that serves as a single source of truth across other engines).
- **Competitive Intelligence (MIv3)**: 6-layer pipeline for real-data competitor analysis, including narrative objection extraction with problem statement patterns, objection clustering (keyword-based grouping into canonical clusters), and content DNA bridge (converts hook:problem and narrative:problem_solution evidence into narrative objection signals for downstream engines). **Signal Quality Gate** (`server/shared/signal-quality-gate.ts`): Zero-Inference Policy enforcement layer — every semantic signal scored for quality [0,1] based on source reliability, freshness, sample size, authority weight, and cross-validation; deduplication via Jaccard similarity (0.65 threshold) merges redundant signals; cross-validation requires confirmation from ≥2 independent data vectors; quality threshold ≥0.85 to pass gate; minimum 3 passing signals required; cluster-level quality filtering removes non-qualified clusters. Gate results embedded in MIv3 snapshot `diagnosticsData.signalQualityGate` for downstream consumption.
- **Strategic Core Architecture**: A 6-phase sequential engine for comprehensive plan generation using AI Creative Blueprints.
- **Adaptive Engine Architecture**: Provides a foundation for scalable engine integration with standardized output schemas and a Context Kernel.
- **Positioning Engine Hard-Link Safeguards**: Kill-switch blocks execution if input signals < threshold; mandatory traceability via `checkForOrphanClaims()` validates every positioning claim maps to a verified MIv3 signal ID; untraced claims flagged as `[HYPOTHESIS]` in territory stability notes with confidence penalty; global state refresh (`enforceGlobalStateRefresh()`) runs before any strategic computation to prevent stale/cached MIv3 data from propagating.
- **Engine Routing Health Check**: `GET /api/engines/health?campaignId=X` validates all engine-to-engine routes, detects stale snapshots, version mismatches, and broken data pipelines. `validateRoutingIntegrity()` in `server/shared/engine-health.ts` performs comprehensive engine status check.
- **System Hardening**: Includes extensive indexing, unique constraints, Zod-based request validation, self-healing snapshot resolution, and a shared hardening library with features like `sanitizeBoundary`, `assessDataReliability`, and `checkCrossEngineAlignment`.
- **Mechanism Construction Validation**: Differentiation Engine validates that MechanismCore describes structured transformation processes (not conceptual themes). `validateMechanismIsTransformation()` checks for action verbs in steps/logic. `refineMechanismFromTheme()` auto-transforms themes into operational mechanisms.
- **Awareness → Persuasion Mode Alignment**: Persuasion Engine enforces strict awareness-to-mode mapping (unaware→education, problem_aware→empathy, solution_aware→contrast, product_aware→proof, most_aware→proof) via `AWARENESS_PERSUASION_MAP`.
- **Trust Proof Sequencing**: `buildTrustProofSequence()` enforces deterministic escalation path: process_proof → case_proof → outcome_proof → transparency_proof. Integrated into `layer5_proofPriorityMapping`.
- **Message Architecture Enforcement**: `validateMessageArchitecture()` enforces problem → mechanism → proof → outcome → offer ordering in persuasion message sequences. Violations logged as warnings.
- **Strategy Acceptability Layer**: `assessStrategyAcceptability()` in `server/shared/strategy-acceptability.ts` provides graded strategy states (green/yellow/orange/red) with adaptive fallback strategies. No engine ever halts — all return an adaptive path. Integrated into Offer, Funnel, and Persuasion engines.
- **Cross-Engine Synchronization**: Integrity Engine validates MechanismCore action verbs, offer-deliverable-to-mechanism alignment, and awareness-persuasion consistency across engines.
- **Fortress Completion Engines (V3 Strategy Layer)**:
    - **Statistical Validation Engine (V4)**: Signal-grounded claim architecture with strict Signal → Reasoning → Claim enforcement (V4.3). All claim-generating engines (Offer, Awareness, Persuasion) enforce signal-derived outputs only — no template fallbacks permitted. Offer Engine gates proof types (transparency_proof, outcome_proof, process_proof) on audience/MI objection signals; AI prompt mandates signal anchors; post-AI grounding strips ungrounded claims and returns SIGNAL_INSUFFICIENT if grounding ratio < 30%. Persuasion Engine derives drivers from audience pain and emotional signals only — no template fallback to authority/proof_of_work. Awareness Engine derives entry mechanisms and triggers from pain/opportunity/threat signals only — empty string returned when no signals available. Statistical Validation hard-rejects orphaned claims (no parentSignalId AND no signalProvenance) before validation when upstream lineage exists. Lineage-anchored claims receive elevated evidence type and +0.1 strength boost. Signal grounding guard: <40% signal-backed forces PROVISIONAL state.
    - **Budget Governor Engine**: Determines test/scale/hold/halt budget decisions based on multi-factor risk scoring. Guard prevents scaling when validation confidence low or CAC assumptions unrealistic.
    - **Channel Selection Engine**: Scores 16 channels across 8 layers (audience density, awareness mapping, persuasion compatibility, budget constraints). Guard rejects channels with weak audience density or mode mismatch.
    - **Iteration Engine**: Identifies optimization opportunities from campaign/funnel/creative/persuasion performance. Guard prevents random experimentation and repeating failed tests.
    - **Retention Engine**: Detects retention leverage points, churn risks, LTV expansion paths. Guard flags unclear value delivery and missing retention mechanisms.

### Audit & Control System
A backend and frontend system for auditing feeds, AI usage, gate status, decisions, publish history, and job management, presented in a 5-panel dashboard.

### Snapshot Lifecycle Management
- **Per-engine pruning**: `pruneOldSnapshots()` in `server/engine-hardening/index.ts` runs after every engine write — keeps 20 newest snapshots per campaign per table.
- **Scheduled bulk cleanup**: `server/snapshot-cleanup-worker.ts` runs every 6 hours with three sweep passes:
  1. **Time-based retention** — tiered expiry: COMPLETE snapshots at 90 days, FAILED/STALE/PENDING at 30 days, INCOMPATIBLE at 7 days.
  2. **Cross-campaign cap enforcement** — ensures no campaign exceeds 20 snapshots per table (bulk version of per-engine pruning).
  3. **Orphan purge** — deletes snapshots for campaigns that no longer exist in `growth_campaigns`. Safety guard: skips purge if zero active campaigns found.
- Audit trail: cleanup actions logged via `logAudit("system", "SNAPSHOT_CLEANUP", ...)`.
- Graceful shutdown: `stopSnapshotCleanupWorker()` called on SIGTERM/SIGINT.

### Snapshot Trust & Freshness System
- **`server/shared/snapshot-trust.ts`**: Core module for temporal decay scoring, schema validation, and freshness classification.
  - `computeStalenessCoefficient()` — returns staleness coefficient [0,1], freshness class (FRESH/AGING/NEEDS_REFRESH/PARTIAL/INCOMPATIBLE), trust score, and strategy-blocking status.
  - `validateSnapshotSchema()` — checks required MI fields (signalData, confidenceData, marketState, trajectoryData, dominanceData), returns USE/USE_WITH_CAUTION/INCOMPATIBLE recommendation.
  - `buildFreshnessMetadata()` — combines staleness + schema into a single metadata object attached to API responses.
  - `logFreshnessTraceability()` — structured logging for freshness state at all engine consumption points.
- **Freshness thresholds**: FRESH ≤24h, AGING ≤7d, NEEDS_REFRESH ≤14d (blocked for strategy), NEEDS_REFRESH >14d (coefficient=1.0).
- **Positioning Engine block**: `buildFreshnessMetadata()` blocks strategy execution when `blockedForStrategy=true` (NEEDS_REFRESH or INCOMPATIBLE).
- **All engine route responses**: `freshnessMetadata` field included in MIv3, Audience, Positioning, Differentiation, Offer, Funnel, Integrity, Awareness, and Persuasion engine API responses.
- **All engine freshness traceability**: `logFreshnessTraceability()` called in every engine route that consumes MI snapshots — MIv3, Audience, Positioning, Differentiation, Offer, Funnel, Integrity, Awareness, Persuasion.
- **Frontend warning**: `components/DataFreshnessWarning.tsx` renders contextual warning banners (amber for AGING, orange for NEEDS_REFRESH, red for INCOMPATIBLE/blocked) in both the Competitive Intelligence panel and the Audience Engine section of AI Management.

### Semantic Data Bridge (MIv3 → Audience Engine)
- **`server/audience-engine/semantic-bridge.ts`**: Strategic data bridge wiring MIv3 high-fidelity signals directly into Audience Engine's core maps. Master Plan alignment maintained through strict integrity enforcement.
  - `executeSemanticBridge()` — extracts semantic signals from MIv3 snapshot (signalData + contentDnaData) and maps them: `pain_signal` + `hook:problem` → Pain Profiles; `desire_signal` + `transformation_statement` → Desire Maps; `audience_objection` + `competitor_weakness` → Objection Maps.
  - **Clean-Pipe Architecture**: Only signals with Confidence_Score > 0.85 pass through the bridge. Signals below threshold are hard-blocked. Enforced at both semantic signal and Content DNA levels.
  - **Full Traceability**: Every bridged signal retains `parentSignalId` linking back to its MIv3 source. Zero-tolerance for orphan logic — signals without parent IDs trigger integrity violation and bridge halt.
  - **Conflict Resolution Protocol**: When MIv3 semantic signals conflict with existing Audience Engine patterns, the MIv3 quality-gated signal takes precedence as the **Strategic Anchor** (based on competitor DNA analysis with quality gate > 0.85).
  - `mergeBridgedIntoAudienceMap()` — merges bridged signals into existing Audience Engine maps, respecting Strategic Anchor precedence. Existing patterns reinforced when MIv3 confirms them; new patterns added when MIv3 introduces novel signals.
  - `validateBridgeIntegrity()` — validates bridge output: no orphan signals, no below-threshold signals, clean-pipe enforced. Used by Engine Health endpoint.
- **Content DNA Full Coverage**: Content DNA evidence maps comprehensively: `hook:problem` + `narrative:problem_solution` + `narrative:mistake_fix` → Pain Profiles; `narrative:before_after` + `narrative:story_lesson` + `narrative:how_to` → Desire Maps; `cta:trust` + `narrative:mistake_fix` → Objection Maps. Narrative framework evidence (e.g., `before_after`) also extracted from `narrativeFrameworks` array.
- **Bridge-Only Mode (Dataset Rescue)**: When traditional data sources (comments/posts) are below threshold but MIv3 contentDnaData provides ≥5 quality-gated signals, the bridge bypasses DATASET_TOO_SMALL and allows full Pain/Desire/Objection profile construction from semantic signals alone.
- **Audience Engine Integration**: Bridge executes during `runAudienceEngine()` after MI snapshot fetch, **before** the dataset-size check. Bridged signals merged into painMap, desireMap, objectionMap with full lineage tracking.
- **Engine Health Validation**: `GET /api/engines/health` now validates `SemanticBridge-MIv3→Audience` — checks bridge integrity, clean-pipe enforcement, and detects inference-without-evidence in audience lineage.
- **Routing Audit**: Bridge enforces that `contentDnaData` ingestion does not bypass the Fortress Layer or Signal Quality Gate — only quality-gated signals from the MIv3 snapshot are consumed.

### Concurrency Hardening
- **MIv3 lock timeout**: Active locks expire after 5 minutes with a timeout guard; stale locks forcefully released if the promise exceeds the timeout.
- **Batched Jaccard dedup**: `deduplicateSignals()` in `signal-quality-gate.ts` uses category-based batching (batch size 50) for O(n²) Jaccard similarity computation on 100+ signals.
- **STALE recovery safeguard**: `invalidateStaleSnapshots()` skips recovery for campaigns that already have COMPLETE/PARTIAL snapshots to prevent overwriting active sessions.

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