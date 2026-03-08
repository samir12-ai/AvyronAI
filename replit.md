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
- **Competitive Intelligence (MIv3)**: Provides real-data competitor analysis through a 6-layer pipeline for data processing and signal generation, including robust data integrity checks, synthetic comment management, competitor authority weighting, lifecycle classification (ACTIVE/DORMANT/LOW_SIGNAL), sample bias detection, real data ratio guard, narrative semantic clustering, MI diagnostics transparency, Demand Pressure Layer (independent audience-derived demand scoring preventing false COOLING classifications), Echo Chamber Detection (convergence/diversity penalties for imitation markets), Demand-Weighted Trajectory (SUPPRESSED_DEMAND classification when low activity + high demand), and cross-engine version consistency checks. ENGINE_VERSION=17. **COMMENT_TEXT_OPTIONAL=true**: Comment COUNTS (from post metadata) are engagement signals; comment TEXT is optional enrichment that never blocks the pipeline. Signal engine derives engagement quality from post ratios when text unavailable. Demand pressure uses engagement counts when text is absent (text-based signals set to 0).
- **FAST_PASS / DEEP_PASS Architecture**: Hardened two-stage inventory system with 12-post baseline architecture. ENGINE_VERSION=17. FAST_PASS collects baseline posts (BASELINE_POSTS_PER_COMPETITOR=12, no comments, no enrichment). DEEP_PASS is ENRICHMENT-ONLY — never attempts post expansion. DEEP_PASS runs `enrichCompetitorWithComments()` as best-effort comment text collection. DEEP_PASS bypasses cache/cooldown checks (DEEP_PASS_CACHE_BYPASS). Promotion to DEEP_PASS requires: `enrichmentSucceeded` (status ENRICHED/ALREADY_ENRICHED/REAL_DATA_SUFFICIENT/NO_ELIGIBLE_POSTS). Promotion outcomes: PROMOTED / ENRICHMENT_FAILED / SKIPPED_COOLDOWN. No PROMOTED_PARTIAL or ENRICHMENT_NO_CHANGE — comment counts never block promotion. Per-competitor DEEP_PASS_DIAGNOSTICS log emitted with baseline counts, real/synthetic comment breakdown, COMMENT_TEXT_OPTIONAL=true, and promotion decision. Orchestrator owns all promotion logic — enrichCompetitorWithComments never sets analysisLevel. Recovery path (`recoverStuckDeepPass`) promotes on `enrichOk` regardless of comment counts (COMMENT_TEXT_OPTIONAL=true). validateInventoryConsistency() runs after every DEEP_PASS cycle; uses INSTAGRAM_API_CEILING (=12) for post threshold. LOW_SAMPLE_COMPETITOR flag (posts < MIN_POSTS_PER_COMPETITOR=12) reduces authority weight by LOW_SAMPLE_WEIGHT_FACTOR=0.5; market activity calculation excludes LOW_SAMPLE when 2+ ACTIVE competitors available. Competitor inventory tracked via `enrichmentStatus` (PENDING/ENRICHING/ENRICHED/SKIPPED/FAILED/ENRICHMENT_NO_CHANGE), `fetchMethod`, `postsCollected`, `commentsCollected`, `dataFreshnessDays`. DATA_DEGRADATION_GUARD in data-acquisition prevents post overwrites. Duplicate post protection via postId/shortcode. Cooldown enforcement (5-day synthetic enrichment cooldown). **Comment Spam Filter**: `filterSpamComments()` applied to all 3 real comment ingestion paths (FAST_PASS embedded, DEEP_PASS embedded, DEEP_PASS direct scrape). Filters: emoji-only, tag-only (@mentions and #hashtags with no text), ultra-short (<3 meaningful chars), repeated characters, bot/spam patterns (follow-me, DM-for-promo, check-my-page, link-in-bio, buy-followers, etc.). Returns `spamReasons` breakdown for diagnostics. COMMENT_DISTRIBUTION diagnostic log shows per-post real/synthetic comment counts after enrichment. Pipeline order: FAST_PASS → baseline snapshot → DEEP_PASS (comment enrichment only) → enriched snapshot. All threshold constants centralized: BASELINE_POSTS_PER_COMPETITOR=12 (canonical), INSTAGRAM_API_CEILING=BASELINE_POSTS_PER_COMPETITOR, MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR=BASELINE_POSTS_PER_COMPETITOR, MIN_POSTS_API_CEILING=BASELINE_POSTS_PER_COMPETITOR. Scraper: TARGET_POSTS=12, MAX_PAGINATION_PAGES=1 (no pagination beyond baseline). 310 orchestrator tests + 58 synthetic lifecycle tests (FP-1 through FP-82 + EC-1 through EC-12 + CTO-1 through CTO-12 + cross-engine consistency suite). **Embedded Comment Extraction**: `extractCommentsFromNode()` extracts preview comments from `web_profile_info` response nodes (edge_media_to_comment, edge_media_to_parent_comment, edge_media_preview_comment, preview_comments). Comments are returned alongside posts as `embeddedComments: ScrapedComment[]` in `ScrapeResult`. Real embedded comments are persisted during ALL passes (FAST_PASS + DEEP_PASS) with `isSynthetic=false, source="embedded_preview"`. Synthetic comments only generated for posts WITHOUT real embedded comments. `enrichCompetitorWithComments` attempts profile re-scrape for embedded comments before falling back to separate comment API. **Comment Scraping Pipeline**: GraphQL endpoint → V1 post API → HTML page scrape (primary working path). `scrapePostCommentsFromHTML()` fetches full post HTML and extracts `preview_comments` from embedded JSON (~2-3 real comments per post). All fallbacks are fully chained — any failure at any stage falls through to the next. **Proxy Configuration**: Bright Data Web Unlocker (port 33335) does not support sticky sessions — `createSession()` omits `-session-` suffix for this zone type. All Instagram API requests include `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site` headers to prevent Bright Data SecFetch policy violations. Schema: `ci_competitor_comments` has `comment_id` and `username` columns for real comment attribution.
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