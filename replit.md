# MarketMind AI

## Overview

MarketMind AI is a cross-platform marketing automation application built with Expo (React Native). It provides AI-powered content generation for social media marketing, campaign management, content scheduling, and analytics dashboards. The app enables marketers to create posts, ads, and captions using OpenAI integration while managing their brand presence across multiple social platforms.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: Expo SDK 54 with React Native 0.81, using the new architecture
- **Navigation**: Expo Router v6 with file-based routing and typed routes
- **State Management**: React Context API (`AppContext`, `AuthContext`, `LanguageContext`) for global app state, TanStack React Query for server state
- **Internationalization**: i18n-js with expo-localization for 32 languages, LanguageContext for persistence via AsyncStorage
- **UI Components**: Custom component library with platform-adaptive styling (light/dark mode support)
- **Animations**: React Native Reanimated for smooth animations and transitions
- **Styling**: StyleSheet API with dynamic theming via `useColorScheme`

### Backend Architecture
- **Server**: Express.js running on Node.js with TypeScript
- **API Design**: RESTful endpoints under `/api/*` prefix
- **AI Integration**: OpenAI API via Replit AI Integrations for content generation, image generation, and voice features
- **CORS**: Dynamic origin handling for Replit domains and localhost development

### Data Storage
- **Client-side**: AsyncStorage for persisting brand profiles, content items, campaigns, ads, platform connections, and posting schedules
- **Server-side**: PostgreSQL with Drizzle ORM for user data and chat conversations
- **Schema Location**: `shared/schema.ts` contains database models shared between client and server

### Key Design Patterns
- **Monorepo Structure**: Shared code between client and server in `shared/` directory
- **Type Safety**: Full TypeScript with strict mode, shared types in `lib/types.ts`
- **Error Handling**: ErrorBoundary component wraps the app for graceful error recovery
- **Platform Abstraction**: Components adapt to iOS, Android, and Web platforms

### Tab-Based Navigation Structure
1. **Dashboard** (`index.tsx`): Analytics overview with metrics, charts, quick actions, and AI Management Hub summary card showing Auto-Publisher stats (published/queued/content counts) and Meta connection status with direct link to AI Management tab
2. **Create** (`create.tsx`): AI-powered content generation with two modes:
   - **AI Writer**: GPT-5.2 powered text content generation (posts, captions, ad copy, stories)
   - **AI Designer**: Artlist-level image generation studio powered by Nano Banana Pro (Gemini 3 Pro Image) with:
     - Three generation modes: Create (text-to-image), Transform (image-to-image), Edit (image modification)
     - 6 visual style presets: Cinematic, Professional, Commercial, Indie, Minimal, Vibrant
     - Aspect ratio selection: Square (1:1), Portrait (4:5), Landscape (16:9), Story (9:16)
     - Up to 3 reference image uploads from gallery
     - Advanced options: mood control (Energetic, Calm, Dramatic, Playful, Luxurious, Warm) + text overlay
     - Canvas workspace with full-screen preview modal
     - Generation history gallery (session-based)
     - Premium animated loading overlay
3. **Calendar** (`calendar.tsx`): Content scheduling and calendar view with AI Calendar Assistant
4. **AI Management** (`ai-management.tsx`): AI-powered automation hub with three tabs:
   - **Auto-Publisher**: Batch publish scheduled posts to Meta platforms, auto-publish toggle, publish queue with multi-select, connection status with pulsing indicator, demo mode when Meta not connected
   - **AI Audience Manager**: Generate 3 optimized Meta ad audiences from campaign goals using GPT-5.2, with detailed targeting breakdown (demographics, interests, behaviors, placements, bid strategy, match scores), expandable audience cards, and campaign-based quick optimization
   - **Strategy Hub** (via `components/StrategyHub.tsx`): AI-powered Strategic Intelligence Engine with 7 sub-views:
     - **Overview**: Performance metrics dashboard (avg reach, CTR, CPA, ROAS), sync Meta data or use demo mode, run AI analysis with executive summary
     - **Patterns**: AI-detected content patterns with confidence scores, grouped by category (pattern, hook, format, audience, objection)
     - **Decisions**: Rule-based decision engine with execute/reject actions, priority levels, budget adjustment recommendations
     - **Memory**: Long-term memory bank tracking winners and losers (winning angles, hooks, formats, audience patterns, objections)
     - **Growth**: 30-day AI-managed growth campaigns with 3 phases (Testing days 1-10, Optimization days 11-20, Authority days 21-30), progress tracking, daily advancement
     - **Reports**: AI-generated weekly strategic reports with what worked/failed, root cause analysis, scaling recommendations, budget reallocation
     - **Sniper**: Audience sniping tool - AI detects micro-segments, interest stacking strategies, lookalike audiences, exclusion groups, objection-handling content
     - **Backend**: `server/strategy-routes.ts` - 15+ API endpoints for performance sync, AI analysis, decisions management, growth campaigns, weekly reports, audience sniping
     - **Database**: 6 tables (performance_snapshots, strategy_insights, strategy_decisions, strategy_memory, growth_campaigns, weekly_reports)
     - **Demo Mode**: Generates 30 synthetic performance records with realistic data when Meta API is unavailable
5. **Studio** (`studio.tsx`): Consolidated media hub with mode switcher between two views:
   - **Media Library**: Upload and manage videos, images, and posters with platform tagging and scheduling status
   - **AI Video Editor** (via `components/VideoEditorContent.tsx`): AI-powered video editing with FFmpeg processing, guided creative brief flow
     - **Creative Brief** (Step 1): Guided prompts asking users to describe their video vision, select video type (Promo/Reel/Ad/Story/Recap/Tutorial), target audience, key message. 6 quick templates (Product Launch Hype, Cinematic Brand Film, Instagram Reel, Luxury Showcase, Event Highlights, Ad Creative) auto-fill brief + settings. Style/mood/pace/transition/text overlay configuration.
     - **Upload** (Step 2): Multi-clip upload (up to 20 clips, 200MB max each) using expo-file-system File class + expo/fetch, automatic video info extraction via ffprobe, brief summary card
     - **Review & Start** (Step 3): Shows uploaded clips with metadata, full brief summary with tags, then triggers AI processing
     - **AI Processing** (Step 4): GPT-5.2 reads creative brief + analyzes clips to create professional edit plans (clip ordering, trim points, transitions, color grading) tailored to the user's vision
     - **FFmpeg Rendering**: Complex filter graph processing with fallback to simple concatenation, libx264 encoding
     - **Backend**: `server/video-routes.ts` - clip upload, AI edit plan generation with creative brief context, FFmpeg processing, project management
6. **Photography** (`photography.tsx`): Dubai-based photography marketplace with dual-role system:
   - **Photographer View**: Profile creation (name, email, specialties, pricing, Instagram), portfolio management (image upload, categories: Wedding/Portrait/Event/Product/Fashion/Nature), reservation management with confirm/decline actions
   - **Customer View**: Browse photographers by city, horizontal scroll cards, portfolio feed with like/share/reserve interactions, photographer detail modal with bio and portfolio grid, booking form with event type selection and date/time/location
   - **Backend**: `server/photography-routes.ts` - CRUD for profiles, portfolio posts, interactions (like/unlike toggle), reservations with status management
7. **Settings** (`settings.tsx`): Brand profile and platform connections

## External Dependencies

### AI Services
- **OpenAI API**: Content generation, image creation, voice transcription via Replit AI Integrations
- **Environment Variables**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Database
- **PostgreSQL**: Required for server-side data persistence
- **Environment Variable**: `DATABASE_URL` for database connection
- **ORM**: Drizzle with Drizzle Kit for migrations (`migrations/` directory)

### User Authentication
- **Login Options**: Facebook and Instagram OAuth login via Meta APIs
- **Backend Endpoints**: `/api/auth/facebook`, `/api/auth/facebook/callback`, `/api/auth/instagram`, `/api/auth/instagram/callback`
- **Demo Mode**: Works without META_APP_ID/SECRET (simulated login)
- **Auth Context**: `context/AuthContext.tsx` manages user state with AsyncStorage persistence
- **Login Screen**: `/login` route with social login buttons and guest access option

### Meta Business Suite Integration
- **OAuth Flow**: Backend endpoints `/api/meta/auth`, `/api/meta/callback`, `/api/meta/post`
- **Features**: Auto-post to Facebook & Instagram, unified ads management
- **Demo Mode**: Works without credentials (simulated connection)
- **Production Mode**: Requires `META_APP_ID` and `META_APP_SECRET` environment variables
- **Scopes**: pages_manage_posts, instagram_content_publish, ads_management, business_management

### Social Platforms
- Instagram, Facebook: Managed through Meta Business Suite connection
- Twitter, LinkedIn, TikTok: Connections managed through settings, API integrations not yet implemented

### Key npm Dependencies
- `expo-router`: File-based navigation
- `drizzle-orm` + `pg`: Database ORM and PostgreSQL driver
- `openai`: AI API client
- `@tanstack/react-query`: Server state management
- `expo-linear-gradient`, `expo-blur`, `expo-haptics`: Native UI enhancements
- `react-native-reanimated`: Animation library