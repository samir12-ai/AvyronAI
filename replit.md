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
- **Scalability & Thundering Herd Protection**: Features a global job queue (8 concurrent, 12 promotions/min), per-account job budgets (6/hr), shared market data cache, request deduplication, rate gate, 25-min per-account and 30-min global queue expiry thresholds.
- **Production Readiness**: Load tested for performance and stability with validated failure recovery. Pre-launch audit (12-dimension) completed with fixes applied: plan ownership verification on all execution endpoints, campaign-scoped performance averages, decision PATCH authorization, story calendar slot attribution fix.
- **Audit & Control System**: A 5-panel dashboard for auditing feeds, AI usage, gate status, decisions, publish history, and job management.
- **Decision Policy Layer (Phase 3)**: Central enforcement policy with confidence thresholds applied across plan synthesis, memory mutation, outcome tracking, and autonomous worker.
- **Decision Attribution Layer (Phase A)**: Campaign-scoped decision tracking for `strategy_decisions` and `decision_outcomes` for per-campaign outcome measurement.
- **Per-Action Attribution Layer (Phase B)**: `sourceDecisionId` populated on all calendar entries from 3 creation paths (plan-synthesis, execution-activation, execution-routes). Action-level performance lookup traces decision → calendar entries → studio items → published posts → performance snapshots. Outcome evaluation uses action-level metrics when available (fallback: campaign → account).
- **Weighted Multi-Decision Attribution (Phase B.5)**: New `decision_attributions` junction table linking calendar entries to multiple decisions with weights. Relevance-based decision matching (`computeDecisionRelevance`) scores by type match (0.4), campaign match (0.3), temporal recency (0.2), and priority (0.1). Replaces "most recent decision" heuristic with structured scoring. Outcome evaluation applies proportional confidence/reinforcement based on attribution weight. Mixed-mode compatibility unions attribution-table and legacy `sourceDecisionId` entries. Logging: `ATTRIBUTION_DETAIL` per action (decisions, weights, method), `OUTCOME_WEIGHTED` per evaluation (scope, weight, linked decisions). Files: `server/decision-attribution.ts`, `server/outcome-tracker.ts`.
- **Unified Memory Policy Enforcement**: All `strategy_memory` write paths now pass through `policyEnforcedMemoryCheck()` in `server/decision-policy/index.ts`. Strategic memories (analysis, agent_action, self_improvement) are blocked below `MEMORY_WRITE_MIN=0.65`. Operational state memories (content_rhythm, exploration_budget) are allowed below threshold with explicit `POLICY_BYPASS_OPERATIONAL` logging. Evidence-based mutation updates (reinforcement, challenge, flip) use period-count gates instead. No silent/unlogged memory writes remain.
- **Operational vs Strategic Memory Separation**: `NON_STRATEGIC_MEMORY_TYPES` (content_rhythm, exploration_budget, mutation_log, agent_action, self_improvement) defined in `server/decision-policy/index.ts` as single source of truth. All AI-context memory reads (strategy-routes.ts, orchestrator-routes.ts, memory-system/manager.ts) exclude non-strategic types via `notInArray` filter. Mutation engine excludes operational/audit types from evidence-based reinforcement. Per-entry mutation logging with period counts, confidence deltas, scores, and baselines for full traceability.
- **Text Sanitizer Layer**: `server/shared/text-sanitizer.ts` provides platform-aware text cleaning applied at the earliest point in each pipeline. Includes: caption sanitization (hashtag walls, emoji floods, promo boilerplate for TikTok/Instagram), review normalization (boilerplate/template removal), website block filtering (cookie/nav/footer detection). Integrated into `signal-engine.ts`, `reviews-intelligence.ts`, and `website-scraper.ts`.
- **Plan Synthesis Hardening**: `SynthesizedPlan` interface includes `PlanSource` type (`decision_driven | degraded_no_decisions | degraded_ai_failed | deterministic_fallback`), `degraded: boolean`, `lockedDecisionLabels: string[]`, and `synthesisVerification` fields. Post-synthesis verification (`verifySynthesisPreservation()`) confirms locked decision labels appear in plan content (excluding metadata fields). If verification fails, plan is auto-degraded. Degraded provenance from AI fallback is preserved (not overwritten by synthesis path). All fallback plans in both `plan-synthesis.ts` and `orchestrator-routes.ts` carry structured degradation markers.
- **Fallback Plan Isolation**: `outcome-tracker.ts` checks plan provenance before memory reinforcement. Decisions linked to degraded/fallback plans have outcomes recorded but are NOT used for learning (memory updates skipped). Fail-closed design: if plan lookup fails or no linked plan is found, reinforcement is skipped by default.
- **Memory-to-Outcome Provenance**: `sourceOutcomeId` column on `strategy_memory` (migration-009) directly links memory updates to the `decision_outcomes` entry that triggered them. Populated during outcome-driven memory writes in `outcome-tracker.ts`. Included in audit logs with `outcomeId`, `planIsDegraded`, and `planLookupReason`. Enables full traceable loop: data → signals → decisions → actions → outcomes → memory.

- **Signal Origin Type System**: Cross-cutting epistemic provenance layer that tags every signal with its source type (`real | competitor | inferred | fallback | unknown`) and propagates that identity through the entire pipeline. Foundation in `server/shared/signal-lineage.ts` (`SignalOriginType` enum, `SignalComposition` interface, `computeSignalComposition()`, `formatCompositionLog()`). Layer 2: MI engine tags all lineage entries with `"competitor"` originType. Layer 3: Orchestrator's `buildUpstreamLineage()` assigns origin types per engine (`"competitor"` for audience, `"inferred"` for positioning/differentiation/mechanism). `extractMiInput()` produces `taggedSignals[]` with origin types. Layer 4: Statistical validation reports `originTypeDistribution` composition; plan synthesis injects composition context into AI prompt for risk-aware planning; budget governor warns on heavily competitor-derived or zero-real strategies. Legacy data normalizes to `"unknown"` via `parseLineageFromSnapshot()`. No enforcement treats `"unknown"` as `"real"`.

- **Cross-Engine Alignment Hardening (3-Phase)**: Comprehensive system hardening based on a 15-engine alignment audit (32-row matrix, 10 contradictions, 7 weak handoffs, 6 root causes). **Phase 1 (Enforcement)**: Budget Governor receives typed `BudgetGovernorInput` with 15 extracted fields (no more `as any`); Channel Selection receives proper `ChannelBudgetInput` mapped from budget governor output; Plan synthesis has pre-synthesis HALT guard (skips AI, returns halt plan), post-synthesis HOLD restriction (50% content volume), integrity degradation enforcement (30-60% volume); Task composer applies strategic guards — no tasks on halt/kill, reduced tasks on hold, review-tagged tasks when integrity is unsafe, launch removal on low-trust signals. **Phase 2 (Data Contracts)**: `extractOfferInput()` and `extractFunnelInput()` replace ALL raw `ctx.offer || {}` / `ctx.funnel || {}` accesses (including Budget Governor case) with normalized field extraction; Statistical Validation receives real `buildUpstreamLineage(ctx)` instead of empty array; SV snapshot now persisted to `strategy_validation_snapshots` table from orchestrator. **Phase 3 (Intelligence)**: Persuasion engine shapes sequence based on funnel depth (deep funnels get anticipation/empathy steps, shallow funnels get compressed sequences) and funnel trust path (social proof stages inject proof steps); Retention engine synthesizes touchpoints from funnel stages and maps audience objections to `postPurchaseObjections`; Signal composition enforcement flags plans as degraded when trusted ratio <30%; Iteration feedback awareness detects conflicts between failed strategy flags and plan channels, attaches optimization hints and retention churn risk insights to plans.

## External Dependencies

### AI Services
- OpenAI API
- Google Gemini

### Data Acquisition & Proxy Infrastructure
- Bright Data residential proxy pool (Web Unlocker on port 33335) for all scraping
- Instagram: Direct scraping via `proxy-pool-manager.ts` with sticky sessions, rotation, quarantine, US country targeting
- TikTok: Dual-source scraping with automatic fallback — Bright Data proxy first (policy_20050 resolved but returns empty pages), then Apify (`clockworks~free-tiktok-scraper`) as fallback; `tiktok-apify-scraper.ts` handles Apify actor runs, polling, and dataset retrieval; posts tagged with `source: "apify"` vs `"brightdata"`; comments tagged `tiktok_apify` vs `tiktok_scraped`; data-acquisition queries include both sources; full validation engine: transcript-first hook detection with caption-proxy fallback; audience reaction extraction from comments; hookReliability and transcriptCoverage metadata; all gated behind qualification filter (HIGH+MID posts only); **campaign isolation enforced**: `scrapeTiktokForCompetitor(competitorId, accountId, campaignId)` validates competitor belongs to the specified campaign before scraping; autonomous worker passes `campaign_id` from DB; API routes pass `campaignId` from request body; fallback to Apify preserves same campaign scope; cross-campaign scraping is structurally prevented
- Website/Blog: Proxied via `website-scraper.ts` with US country targeting and direct-fetch fallback
- Google Reviews: Direct scraping via Bright Data proxy from Google Maps (replaced Google Places API); **campaign isolation enforced**: `scrapeReviewsForCompetitor(competitorId, accountId, campaignId)` validates competitor belongs to the specified campaign before scraping; `campaignId` stored directly in `ci_competitor_reviews` records; autonomous worker passes `campaign_id` from DB
- Credentials: BRIGHT_DATA_PROXY_HOST, PORT, USERNAME, PASSWORD env vars; BRIGHT_DATA_PROXY_COUNTRY defaults to "us"
- Proxy Health Check: GET /api/proxy/health (public, no auth) — tests TCP connectivity + auth against Bright Data; returns zone, product type, and per-test pass/fail
- Current zone: marketmindai (Web Unlocker product, port 33335)

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