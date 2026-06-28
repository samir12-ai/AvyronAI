# UX Security Audit — Patch 3/3 (Final)

**Scope:** UI Components, Context providers, and shared libs (39 files)
**Date:** 2026-06-28
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table (Grouped by Risk Level)

### ❌ HIGH SEVERITY

| File | Issue (line) | Category | Notes |
|---|---|---|---|
| `components/CampaignSelector.tsx` | 291 | ERROR DISPLAY | `setError(err.message \|\| 'Failed to create campaign')` — raw server error stored in visible error state |
| `components/BusinessDataForm.tsx` | 187, 475, 513 | ERROR DISPLAY | Three instances of `err.message` exposed in visible `error`/`channelsError` state |
| `components/VideoEditorContent.tsx` | 202, 291 | ERROR DISPLAY | `Alert.alert(t('videoEditor.error'), error.message \|\| ...)` and `setProcessingError(error.message \|\| ...)` — raw errors shown to user |
| `components/CompetitiveIntelligence.tsx` | 202, 221, 268, 282, 319 | ERROR DISPLAY | Multiple `Alert.alert('Error', err.message)` and `Alert.alert('Analysis Error', err.message)` — raw API errors |
| `components/BudgetGovernorEngine.tsx` | 197 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/OfferEngine.tsx` | 227, 252 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| '...')` — 2 instances |
| `components/FunnelEngine.tsx` | 212, 237 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| '...')` — 2 instances |
| `components/MechanismEngine.tsx` | 122 | ERROR DISPLAY | `Alert.alert('Analysis Error', err.message)` |
| `components/StatisticalValidationEngine.tsx` | 265 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/PersuasionEngine.tsx` | 253 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/DifferentiationEngine.tsx` | 172 | ERROR DISPLAY | `Alert.alert('Error', err.message)` |
| `components/AwarenessEngine.tsx` | 186 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/RetentionEngine.tsx` | 342 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/PositioningStrategy.tsx` | 173 | ERROR DISPLAY | `Alert.alert('Positioning Error', err.message)` |
| `components/IterationEngine.tsx` | 279 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/ChannelSelectionEngine.tsx` | 233 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/IntegrityEngine.tsx` | 156 | ERROR DISPLAY | `Alert.alert('Error', err.message \|\| 'Analysis failed')` |
| `components/TruthSubmissionCard.tsx` | 60 | ERROR DISPLAY | `Alert.alert('Submission failed', err?.message)` — passes server-side validation errors through; intentional per comment but still raw |

### ⚠️ MEDIUM SEVERITY

| File | Issue (line) | Category | Notes |
|---|---|---|---|
| `lib/storage.ts` | 1–245 | SENSITIVE DATA | All business data stored in **plaintext AsyncStorage** (brand profile, campaigns, ads, platform connections, posting schedules, media items, scheduled posts, meta connection). User namespacing prevents cross-tenant bleed but does not encrypt at rest. |
| `components/BuildThePlan.tsx` | 369, 380, 394, 403, 417, 435, 441, 447, 449 | SENSITIVE LOGS | Extensive `console.log` of gate URLs, response status, auto-generate results, and JSON.stringify of response data. Could leak implementation details in production if dev console is accessible. |
| `components/BuildThePlan.tsx` | 469, 506, 553, 583, 629, 794, 898, 928, 992 | ERROR DISPLAY | Multiple `setError(err.message \|\| ...)` and `setError(\`[NETWORK] ${err.message}\`)` — raw error text in visible operator surface |
| `components/MarketDatabaseAdmin.tsx` | 161 | ERROR DISPLAY | `setError(err.message)` — raw error in visible state |
| `components/SystemIntegrityPanel.tsx` | 202 | ERROR DISPLAY | `.catch(err => setError(err.message))` — raw error in visible state |
| `components/PlanDocumentView.tsx` | 94 | ERROR DISPLAY | `setError(err.message \|\| 'Network error.')` — raw error in visible state |
| `components/SignalFlowPanel.tsx` | 211 | ERROR DISPLAY | `setError(err.message \|\| 'Failed to load signal flow data')` — raw error in visible state |
| `components/AELDebugPanel.tsx` | 523 | ERROR DISPLAY | `setError(err.message \|\| 'Network error')` — raw error in visible state |

### ⚠️ LOW SEVERITY

| File | Issue (line) | Category | Notes |
|---|---|---|---|
| `components/BuildThePlan.tsx` | 369, 380, 394, 403, 435, 441, 447, 449, 271 | SENSITIVE LOGS | `console.log` / `console.warn` of gate URLs, response status, JSON data, and server responses. No PII in logs but operational data (blueprint IDs, success flags) is logged. |
| `lib/media-types.ts` | 22, 30 | SENSITIVE LOGS | `__DEV__`-guarded `console.warn` for normalizeMediaType empty/unknown inputs — safe, but still logs |

### ✅ PASS (No Issues Found)

| File | Category | Notes |
|---|---|---|
| `components/ErrorBoundary.tsx` | ERROR BOUNDARY | Proper class-component error boundary. Catches errors, delegates to FallbackComponent. No raw error leak. |
| `components/ErrorFallback.tsx` | ERROR BOUNDARY | Production UI shows only "Something went wrong" + "Please reload the app to continue." Dev-only modal (`__DEV__`) shows `error.message` + `error.stack` — acceptable for debugging. |
| `components/DashboardChat.tsx` | CHAT / ERROR | Safe generic error "Sorry, I encountered an error. Please try again." No raw error exposure. No `dangerouslySetInnerHTML`. |
| `components/MarketMindAgent.tsx` | CHAT / ERROR | Safe generic error "Failed to connect. Please try again." No raw error exposure. No `dangerouslySetInnerHTML`. |
| `components/OnboardingAgent.tsx` | CHAT / ERROR | Pure UI component. No API calls. No error paths. No raw data exposure. |
| `context/AppContext.tsx` | CONTEXT / LOGS | No `console.log` of business data. Only `console.error` for operational failures. No sensitive data in logs. |
| `context/CampaignContext.tsx` | CONTEXT / AUTH | Has `currentUserIdRef` tenant-isolation pattern. No console logs of sensitive data. Properly gates setState on auth identity. |
| `context/OnboardingContext.tsx` | CONTEXT / STORAGE | Stores only step index/completion flags in AsyncStorage keyed by user ID. No sensitive business data. |
| `components/BusinessProfile.tsx` | FORM / LOGS | Modal wrapper for BusinessDataForm. No independent data access or logging. |
| `components/TruthSubmissionCard.tsx` | FORM | Validates integer inputs (line 74), requires non-negative values, enforces funnel order (qualified ≤ total, booked ≤ qualified). |
| `components/BusinessDataForm.tsx` | FORM | Validates required fields (name, objective, location at lines 282–284). Numeric keyboard for performance entries. |
| `components/AccountSwitcherModal.tsx` | AUTH | Uses `useAuth` properly. Displays saved accounts with subscription status. Safe logout flow. |
| `components/ExecutionPlan.tsx` | DISPLAY | Pure data display with `authFetch`. Safe translated strings. Loading states present. |
| `components/RequiredWorkCard.tsx` | DISPLAY | Pure data display with React Query. Loading states. Safe translated strings. |
| `components/ControlCenter.tsx` | DISPLAY / ERROR | Uses `safeApiJson`. Safe error messages. Operator surface behind `useAuth`. |
| `components/PlatformConnection.tsx` | DISPLAY | Pure presentational component. No data access, no error exposure. |
| `components/PlatformPicker.tsx` | DISPLAY | Pure presentational component. No data access, no error exposure. |
| `components/AvyronLogo.tsx` | DISPLAY | Pure SVG/logo component. No data access. |
| `components/CalendarDay.tsx` | DISPLAY | Pure presentational component. No data access. |
| `components/ContentCard.tsx` | DISPLAY | Pure presentational component. No data access. |
| `components/MetricCard.tsx` | DISPLAY | Pure presentational with integrity verdict gating. No raw data leak. |
| `components/MiniChart.tsx` | DISPLAY | Pure chart rendering. No data access, no error exposure. |
| `components/LoadingSpinner.tsx` | DISPLAY | Pure animation component. No data access. |
| `components/EnvelopeBadge.tsx` | DISPLAY | Pure display with operator/customer gating. No raw leak. |
| `components/QuickAction.tsx` | DISPLAY | Pure button component. No data access. |
| `components/KeyboardAwareScrollViewCompat.tsx` | UTILITY | Safe wrapper component. No data access. |
| `components/LeadControlPanel.tsx` | DISPLAY | Pure display with feature flag toggles. Safe error handling. |
| `components/CampaignCard.tsx` | DISPLAY | Pure card component. No data access. |
| `components/PlanStatus.tsx` | DISPLAY | Pure data display with React Query. Loading states. Safe strings. |
| `components/InitializationExperience.tsx` | DISPLAY | Pure animation/data display. No API calls. No error exposure. |
| `lib/envelope.ts` | UTILITY | Type definitions and pure functions. No data access. |
| `lib/engine-snapshot.ts` | UTILITY | Type definitions and pure functions. No data access. |
| `lib/studio-save-service.ts` | UTILITY | API wrapper. Sanitizes error messages. No raw leak. |
| `lib/copy-helpers.ts` | UTILITY | Pure mapping functions. No data access. |
| `lib/insets.ts` | UTILITY | Constant definitions only. |
| `lib/media-types.ts` | UTILITY | Pure mapping functions. `__DEV__`-guarded console.warn for unknown inputs. |

---

## B) Summary by Category

| Category | Findings | Status |
|---|---|---|
| **ERROR DISPLAY** | **19+ components expose raw `err.message`** to the user via `Alert.alert(..., err.message)` or `setError(err.message)`. This is the dominant finding. Affected: all engine components, CampaignSelector, BusinessDataForm (3×), VideoEditorContent (2×), BuildThePlan (~10×), MarketDatabaseAdmin, SystemIntegrityPanel, PlanDocumentView, SignalFlowPanel, AELDebugPanel, TruthSubmissionCard. | **FAIL — widespread** |
| **SENSITIVE DATA HANDLING** | `lib/storage.ts` stores brand profiles, campaigns, platform connections, posting schedules, meta connection data, and scheduled posts in **plaintext AsyncStorage**. The P2 isolation seal provides user namespacing but no encryption at rest. | **FAIL — MEDIUM** |
| **FORM SAFETY** | `BusinessDataForm.tsx` validates required fields before submission (name, objective, location). `TruthSubmissionCard.tsx` validates integer inputs, non-negative values, and funnel ordering. No form allows completely empty submission to the API. | **PASS** |
| **CONTEXT PROVIDERS** | `AppContext` has no sensitive data logging. `CampaignContext` has proper tenant isolation (`currentUserIdRef` pattern). `OnboardingContext` stores only step progress (no business data). | **PASS** |
| **ERROR BOUNDARY** | `ErrorBoundary.tsx` catches properly. `ErrorFallback.tsx` shows safe copy in production (`"Something went wrong"`); dev-only (`__DEV__`) modal shows `error.message` + `error.stack` which is acceptable. | **PASS** |
| **CHAT COMPONENTS** | `DashboardChat`, `MarketMindAgent`, and `OnboardingAgent` all use safe generic error messages. No `dangerouslySetInnerHTML` found anywhere in the component tree. AI responses are rendered as plain text in `<Text>` components. | **PASS** |
| **PURE/STATIC COMPONENTS** | `AvyronLogo`, `CalendarDay`, `MiniChart`, `MetricCard`, `LoadingSpinner`, `EnvelopeBadge`, `CampaignCard`, `PlanStatus`, `QuickAction`, `PlatformPicker`, `PlatformConnection`, `RequiredWorkCard`, `InitializationExperience`, `ContentCard` — all pure display with no data access or error exposure. | **PASS** |
| **SENSITIVE DATA IN LOGS** | `BuildThePlan.tsx` has extensive `console.log` of gate request URLs, response status, auto-generate results, and JSON-stringified response metadata. No PII, but operational data (blueprint IDs, success flags) is logged. `__DEV__`-guarded logs in `media-types.ts` and `create.tsx` are safe. | **WARN — LOW** |

---

## C) Top Fixes — Prioritized by Severity

| Priority | Severity | File(s) | Fix |
|---|---|---|---|
| 1 | **HIGH** | All engine components (`BudgetGovernorEngine`, `OfferEngine`, `FunnelEngine`, `MechanismEngine`, `StatisticalValidationEngine`, `PersuasionEngine`, `DifferentiationEngine`, `AwarenessEngine`, `RetentionEngine`, `PositioningStrategy`, `IterationEngine`, `ChannelSelectionEngine`, `IntegrityEngine`) | Replace `Alert.alert('Error', err.message \|\| 'Analysis failed')` with safe translated strings (e.g., `t('engine.analysisFailed')`). These are 16 identical patterns that can be batch-fixed. |
| 2 | **HIGH** | `components/CampaignSelector.tsx:291` | Replace `setError(err.message \|\| 'Failed to create campaign')` with a safe translated string or generic fallback. Do not store raw server error text in visible state. |
| 3 | **HIGH** | `components/BusinessDataForm.tsx:187, 475, 513` | Replace all three `err.message` usages with safe translated strings. The `error` state is rendered directly in the UI. |
| 4 | **HIGH** | `components/VideoEditorContent.tsx:202, 291` | Replace `error.message` in `Alert.alert` and `setProcessingError` with safe translated strings. |
| 5 | **HIGH** | `components/CompetitiveIntelligence.tsx:202, 221, 268, 282, 319` | Replace all five `err.message` usages in Alert.alert with safe translated strings. |
| 6 | **HIGH** | `components/BuildThePlan.tsx` (~10 instances) | Replace all `setError(err.message \|\| ...)` and `setError(\`[NETWORK] ${err.message}\`)` with safe translated strings. The `[NETWORK]` prefix still leaks the raw error. |
| 7 | **MEDIUM** | `components/MarketDatabaseAdmin.tsx:161`, `SystemIntegrityPanel.tsx:202`, `PlanDocumentView.tsx:94`, `SignalFlowPanel.tsx:211`, `AELDebugPanel.tsx:523` | Replace all `setError(err.message \|\| ...)` with safe translated strings. |
| 8 | **MEDIUM** | `lib/storage.ts` | Add encryption at rest for sensitive keys (brand profile, campaigns, ads, platform connections, meta connection). Consider using `expo-secure-store` for tokens/credentials while keeping plain AsyncStorage for non-sensitive cached data. |
| 9 | **MEDIUM** | `components/TruthSubmissionCard.tsx:60` | Replace `Alert.alert('Submission failed', err?.message)` with a safe translated string. The comment claims this is intentional for server-side validation, but raw error text should still be sanitized before customer display. |
| 10 | **LOW** | `components/BuildThePlan.tsx` | Replace `console.log` calls with a structured logger that respects log levels and does not emit in production. The current pattern logs gate URLs, blueprint IDs, and response shapes. |

---

## D) Explicit Answers to Q1–Q3

### Q1: Does lib/storage.ts store anything sensitive without encryption?

**Yes.** `lib/storage.ts` stores the following business-sensitive data in **plaintext AsyncStorage**:

- `BrandProfile` (business name, industry, tone, target audience, platforms)
- `Campaign[]` (campaign data, budgets, goals)
- `Ad[]` (advertising data)
- `PlatformConnection[]` (which social platforms are connected)
- `PostingSchedule[]` (content rhythm and timing)
- `MediaItem[]` (content media references)
- `ScheduledPost[]` (upcoming posts)
- `MetaConnection` (Meta/Facebook connection state)

The P2 isolation seal correctly namespaces all keys by user ID (`u:${uid}:${base}`), preventing cross-tenant data bleed when multiple users share a device. However, **no encryption at rest** is applied. AsyncStorage data is stored in plaintext on the device filesystem, making it extractable via rooted/jailbroken devices or on-device backup access.

> **Recommendation:** Migrate token/credential storage to `expo-secure-store`. Keep AsyncStorage for non-sensitive cached data (e.g., posting schedules, UI preferences). Encrypt `BrandProfile`, `MetaConnection`, and `Campaign` data at minimum.

### Q2: Do chat components (DashboardChat, OnboardingAgent, MarketMindAgent) expose raw errors or unsanitized AI responses?

**No — all three are safe:**

- **`DashboardChat.tsx`**: On send failure, it appends a safe generic message to the chat: `"Sorry, I encountered an error. Please try again."` (line 319). The raw error is only `console.error`'d (line 315), never shown to the user. AI responses are streamed as plain text and rendered in `<Text>` components.
- **`MarketMindAgent.tsx`**: On `handleAsk` failure, it shows `"Failed to connect. Please try again."` (line 206). The `catch` block is bare (`catch { setAnswer(...) }`), so no raw error is captured at all. The `fetchBrief` catch also discards the error (`catch { if (thisRequest === ...) setState('error') }`).
- **`OnboardingAgent.tsx`**: Pure UI component with no API calls, no error paths, and no raw data exposure.

Additionally, **no `dangerouslySetInnerHTML`** or equivalent was found anywhere in the components tree. All AI responses and chat content are rendered as plain text through React Native's `<Text>` component, which provides native XSS protection (no HTML parsing).

### Q3: Does ErrorFallback.tsx show technical error details to the user?

**No in production; yes in dev mode (`__DEV__`).**

- **Production** (`__DEV__ === false`): The user sees only:
  - Title: `"Something went wrong"`
  - Message: `"Please reload the app to continue."`
  - Action: `"Try Again"` button that calls `reloadAppAsync()`
  - **No technical details are visible.**

- **Development** (`__DEV__ === true`): An alert-circle button appears in the top-right corner. Tapping it opens a modal titled `"Error Details"` that shows:
  - `Error: ${error.message}`
  - `Stack Trace: ${error.stack}`

This dev-only behavior is **acceptable** — developers need stack traces for debugging, and `__DEV__` is never `true` in production builds. The `__DEV__` guard correctly gates the entire modal and detail button.
