# MarketMind AI

## Overview

MarketMind AI is a cross-platform marketing automation application built with Expo (React Native). It provides AI-powered content generation for social media marketing, campaign management, content scheduling, and analytics dashboards. The app enables marketers to create posts, ads, and captions using OpenAI integration while managing their brand presence across multiple social platforms.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: Expo SDK 54 with React Native 0.81, using the new architecture
- **Navigation**: Expo Router v6 with file-based routing and typed routes
- **State Management**: React Context API (`AppContext`) for global app state, TanStack React Query for server state
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
1. **Dashboard** (`index.tsx`): Analytics overview with metrics, charts, and quick actions
2. **Create** (`create.tsx`): AI-powered content generation interface
3. **Calendar** (`calendar.tsx`): Content scheduling and calendar view
4. **Campaigns** (`campaigns.tsx`): Campaign and ad management
5. **Settings** (`settings.tsx`): Brand profile and platform connections

## External Dependencies

### AI Services
- **OpenAI API**: Content generation, image creation, voice transcription via Replit AI Integrations
- **Environment Variables**: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Database
- **PostgreSQL**: Required for server-side data persistence
- **Environment Variable**: `DATABASE_URL` for database connection
- **ORM**: Drizzle with Drizzle Kit for migrations (`migrations/` directory)

### Social Platforms (Planned Integrations)
- Instagram, Facebook, Twitter, LinkedIn, TikTok connections managed through settings
- Platform connections stored locally, actual API integrations not yet implemented

### Key npm Dependencies
- `expo-router`: File-based navigation
- `drizzle-orm` + `pg`: Database ORM and PostgreSQL driver
- `openai`: AI API client
- `@tanstack/react-query`: Server state management
- `expo-linear-gradient`, `expo-blur`, `expo-haptics`: Native UI enhancements
- `react-native-reanimated`: Animation library