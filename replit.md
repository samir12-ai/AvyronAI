# MarketMind AI

## Overview

MarketMind AI is a cross-platform marketing automation application that leverages AI to generate content for social media, manage campaigns, schedule posts, and provide analytics. Built with Expo (React Native), it aims to empower marketers by streamlining their workflow and enhancing their brand's presence across various social platforms through AI-powered content creation and strategic insights. The project's vision is to offer an "AI Agency Replacement" with a strong focus on revenue generation and autonomous marketing capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Monorepo Structure**: Shared codebase between client and server.
- **Type Safety**: Full TypeScript with strict mode for robust development.
- **Platform Abstraction**: Components designed for iOS, Android, and Web compatibility.
- **Dynamic Theming**: Support for light and dark modes with platform-adaptive styling.

### Frontend
- **Framework**: Expo SDK 54 with React Native 0.81 (new architecture).
- **Navigation**: Expo Router v6 with file-based routing.
- **State Management**: React Context API for global state, TanStack React Query for server state.
- **Internationalization**: i18n-js for 32 languages, with persistence via AsyncStorage.
- **UI/UX**: Custom component library, React Native Reanimated for animations.

### Backend
- **Server**: Express.js with Node.js and TypeScript.
- **API Design**: RESTful endpoints.
- **AI Integration**: Dual-AI engine architecture utilizing OpenAI GPT-5.2 and Google Gemini 3 Pro for content generation and strategy analysis. Nano Banana Pro (Gemini 3 Pro Image) and GPT Image 1 for AI image/design generation.
- **Autonomous Engine**: Production-safe, silent backend system with code-enforced guardrails for marketing decisions. Includes modules for Guardrail Engine, Adaptive Baselines, Hybrid Risk Classifier, Decision Feedback Loop, and an Audit System. Autopilot functionality allows for automated execution of low-risk decisions, with higher risk decisions requiring approval or being blocked.

### Data Storage
- **Client-side**: AsyncStorage for local data persistence (brand profiles, content, campaigns, schedules).
- **Server-side**: PostgreSQL with Drizzle ORM for user data and chat conversations.

### Key Features
- **Dashboard**: Revenue-focused layout with KPIs, AI action summaries, and daily priorities.
- **Create**: AI Writer for text content (posts, captions, ads) and AI Designer for image generation (text-to-image, image-to-image, editing) with style presets, aspect ratio controls, and advanced mood configuration.
- **Calendar**: Content scheduling with an AI Calendar Assistant for planning.
- **AI Management**:
    - **Auto-Publisher**: Batch publishing to Meta platforms.
    - **AI Audience Manager**: Generates optimized Meta ad audiences.
    - **Strategy Hub**: AI-powered strategic intelligence engine with MOAT BUILDER MODE for brand defensibility, pattern detection, decision management, memory tracking, growth campaigns, and AI-generated reports.
- **Studio**: Media library and an AI Video Editor with guided creative briefs, multi-clip uploads, AI-generated edit plans, and FFmpeg rendering.
- **Photography**: A Dubai-based photography marketplace with dual roles for photographers (profile, portfolio, reservation management) and customers (browsing, booking).
- **Lead Engine**: Modular lead generation system with 8 independent modules (Lead Capture, Conversion Tracking, CTA Engine, Funnel Logic, Lead Magnets, Landing Pages, Revenue Attribution, AI Lead Optimization). Each module has feature flags, dependency guards, safe mode, and a global kill switch. Accessible via the "Leads" tab in AI Management (Advanced Mode).
- **Competitive Intelligence**: AI Chief Strategy Officer in Soft Advisory Mode. Tracks up to 5 competitors with evidence-based data collection (5 required fields + optional enrichment). Generates AI-powered market analysis with gap detection, competitor breakdowns, and strategic recommendations. Features Apply/Reject decision flow with draft+confirm modal, evidence citation tags, confidence/risk/impact scoring, and full audit logging. Monthly automated re-analysis with snapshot diffing. Demo mode with 3 pre-loaded sample competitors. Accessible via the "Intel" tab in AI Management (Advanced Mode).
- **Settings**: Brand profile and platform connections management.

### Lead Engine Architecture
- **Feature Flags**: `server/feature-flags.ts` - Per-module ON/OFF with dependency guards, global kill switch, audit trail. All flags default OFF.
- **Modules**: `server/lead-engine/` - 8 isolated route files, each checking flags before processing.
- **Dependencies**: CTA Engine requires Conversion Tracking; Funnel Logic requires Lead Capture + Conversion Tracking; Lead Magnets/Landing Pages require Lead Capture; Revenue Attribution requires Conversion Tracking; AI Optimization requires Lead Capture + Conversion Tracking.
- **Safe Mode**: Modules with unmet dependencies operate in limited capacity (e.g., CTA Engine generates but won't auto-rotate).
- **Frontend Hook**: `hooks/useFeatureFlags.ts` - 5-min TTL cache, app-open refresh, toggle/kill/resume methods.
- **UI**: `components/LeadControlPanel.tsx` - Module toggle grid with dependency status, stats dashboard, kill switch banner.
- **Database Tables**: leads, conversion_events, cta_variants, funnels, funnel_stages, lead_magnets, landing_pages, revenue_attributions, lead_scores, feature_flags, feature_flag_audit.

### Competitive Intelligence Architecture
- **Feature Flag**: `competitive_intelligence_enabled` - Independent flag with no dependencies.
- **Backend**: `server/competitive-intelligence/` - 3 route files (competitor-routes, analysis-routes, demo-routes) + index.
- **AI Engine**: GPT-4o-powered analysis with evidence-only processing, INSUFFICIENT DATA guards (min 2 complete competitors), JSON-structured output with citations.
- **Required Evidence Fields**: profileLink, postingFrequency, contentTypeRatio, engagementRatio, ctaPatterns.
- **Optional Fields**: discountFrequency, hookStyles, messagingTone, socialProofPresence, screenshotUrls.
- **Recommendation Action Types**: content_clusters, calendar_cadence, cta_library, funnel_mapping, offer_positioning.
- **Audit Events**: INTELLIGENCE_RUN, STRATEGY_RECOMMENDED, STRATEGY_APPLIED, STRATEGY_REJECTED.
- **Monthly Worker**: 30-day cycle, daily check via autonomous-worker.ts, respects feature flag + kill switch.
- **Database Tables**: ci_competitors, ci_snapshots, ci_market_analyses, ci_recommendations, ci_strategy_decisions.
- **Frontend Component**: `components/CompetitiveIntelligence.tsx` - 4 sub-views (Overview, Competitors, Actions, History).
- **Demo Mode**: Button-triggered, loads 3 sample competitors (FreshBites, LuxeStyle, DigitalPro) with DEMO badges.

## External Dependencies

### AI Services
- **OpenAI API**: Used for various AI capabilities, integrated via Replit AI Integrations.
- **Google Gemini 3 Pro**: Utilized for content generation and strategic analysis.

### Database
- **PostgreSQL**: Primary database for server-side data, managed with Drizzle ORM.

### User Authentication
- **Meta OAuth**: Login options via Facebook and Instagram.
- **Demo Mode**: Available for simulated login without Meta credentials.

### Meta Business Suite Integration
- **OAuth Flow**: For connecting to Facebook and Instagram.
- **Features**: Enables auto-posting and unified ads management.
- **Scopes**: Requires permissions like `pages_manage_posts`, `instagram_content_publish`, `ads_management`, `business_management`.

### Social Platforms
- **Instagram, Facebook**: Managed through Meta Business Suite connection.
- **Twitter, LinkedIn, TikTok**: Connection management in settings, API integrations planned.

### Key npm Packages
- `expo-router`: For navigation.
- `drizzle-orm` + `pg`: For database interaction.
- `openai`: OpenAI API client.
- `@tanstack/react-query`: For server state management.
- `react-native-reanimated`: For animations.