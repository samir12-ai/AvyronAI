# UX Security Audit — Patch 2/3

**Scope:** App screens and tab navigation (16 files)
**Date:** 2026-06-28
**Auditor:** Replit Agent
**Note:** `app/(tabs)/monitor.tsx` was pre-audited clean (Data Patch 4). `app/(tabs)/_ai-management-operator-labels.ts` was not found in the project and is excluded.

---

## A) Per-File Verdict Table

| File | Verdict | Severity | Issue (line) | Category | Notes |
|---|---|---|---|---|---|
| `app/(tabs)/index.tsx` | **FAIL** | **HIGH** | 460 | ERROR DISPLAY | `Alert.alert('Approval Failed', err.message)` — raw JS/network error exposed directly to user |
| `app/diagnose.tsx` | **FAIL** | **HIGH** | 120 | ERROR DISPLAY | `(error as Error)?.message` rendered directly in JSX error state |
| `app/studio/[id].tsx` | **FAIL** | **MEDIUM** | 49–66 | NAVIGATION SAFETY | `id` param from `useLocalSearchParams` used directly in API paths without validation |
| `app/studio/[id].tsx` | WARN | MEDIUM | 66, 85 | AUTH | Uses `apiRequest` instead of `authFetch` for studio fetches — inconsistent auth transport |
| `app/studio/[id].tsx` | WARN | LOW | 70, 147 | ERROR DISPLAY | `err.message` stored in `error` state and displayed (partially mitigated by `apiRequest` wrapper) |
| `app/intro.tsx` | WARN | LOW | — | ONBOARDING | No explicit local auth guard; relies solely on root `AuthGate` |
| `app/(tabs)/photography.tsx` | WARN | LOW | — | AUTH | No `useAuth` import; screen doesn't verify auth locally (AuthGate covers it) |
| `app/(tabs)/index.tsx` | PASS | — | — | AUTH / SENSITIVE LOGS | Protected by root AuthGate; `authFetch` used; no PII in logs |
| `app/(tabs)/calendar.tsx` | PASS | — | — | AUTH / ERROR / PERF | AuthGate protected; safe translated errors; loading + empty states present |
| `app/(tabs)/create.tsx` | PASS | — | — | AUTH / ERROR / PERF | AuthGate protected; `t('create.errorGenerate')` for errors; loading states present |
| `app/(tabs)/settings.tsx` | PASS | — | — | AUTH / ERROR | AuthGate protected; safe logout flow; `user.email` in UI is expected |
| `app/(tabs)/studio.tsx` | PASS | — | — | AUTH / ERROR / PERF | AuthGate protected; safe error messages; loading states present |
| `app/(tabs)/ai-management.tsx` | PASS | — | — | AUTH / PERF | AuthGate protected; operator-gated via `useOperatorSurface()`; audience loading handled |
| `app/connect.tsx` | PASS | — | — | AUTH / ERROR / ONBOARDING | AuthGate protected; generic safe messages; OAuth polling silently retries on errors |
| `app/upgrade.tsx` | PASS | — | — | AUTH / ONBOARDING | AuthGate protected; `refreshUser` failure handled gracefully; missing link shows setup note |
| `app/agent.tsx` | PASS | — | — | AUTH / ERROR / PERF | AuthGate protected; safe generic error messages; `sending`/`insightsLoading` states present |
| `app/+native-intent.tsx` | PASS | — | — | NAVIGATION SAFETY | Returns `/` for all paths — swallows deep links safely; no route details leaked |
| `app/+not-found.tsx` | PASS | — | — | NAVIGATION SAFETY | Generic "Oops!" message; no route details exposed |
| `app/(tabs)/_ai-management-operator-labels.ts` | N/A | — | — | — | **File does not exist** in the project |

---

## B) Summary Table by Category

| Category | Findings | Status |
|---|---|---|
| **AUTH & NAVIGATION** | Root `AuthGate` in `app/_layout.tsx` covers all routes. Two screens (`intro.tsx`, `photography.tsx`) lack local auth verification for defense-in-depth. No unauthenticated data exposure found. | **Mostly PASS** — 2 low warnings |
| **ERROR DISPLAY** | **2 screens expose raw error messages** to users (`index.tsx` line 460, `diagnose.tsx` line 120). `studio/[id].tsx` partially exposes `err.message`. All other screens use translated safe strings. | **2 FAIL, 1 partial** |
| **SENSITIVE DATA IN LOGS** | No emails, tokens, or business PII are `console.log`'d outside `__DEV__` guards. All `console.error` calls are operational (network failures, meta status, etc.) and contain no sensitive user data. | **PASS** |
| **ONBOARDING & INTRO FLOW** | `intro.tsx` has no local guard but AuthGate redirects authenticated users. `upgrade.tsx` handles payment/refresh failures gracefully with safe UI states. `connect.tsx` uses generic OAuth failure messages. | **PASS** |
| **NAVIGATION SAFETY** | `+native-intent.tsx` swallows all deep links safely. `+not-found.tsx` is generic. `studio/[id].tsx` does not validate the `id` param before API calls. | **1 FAIL, 1 warn** |
| **PERFORMANCE / UX** | All screens have explicit loading states (`ActivityIndicator` or spinners). `calendar.tsx` and `create.tsx` handle empty data gracefully. `ai-management.tsx` has audience engine loading. | **PASS** |

---

## C) Top Fixes — Prioritized by Severity

| Priority | Severity | File | Fix |
|---|---|---|---|
| 1 | **HIGH** | `app/(tabs)/index.tsx:460` | Replace `err.message` in `Alert.alert('Approval Failed', err.message \|\| 'Network error...')` with a safe translated string (e.g., `t('approval.networkError')`). Raw JS/HTTP error text leaks implementation details to the user. |
| 2 | **HIGH** | `app/diagnose.tsx:120` | Replace `(error as Error)?.message ?? "Failed to load diagnosis"` with a safe translated string like `t('diagnose.loadError')`. Never render React Query error messages directly in customer-facing UI. |
| 3 | **MEDIUM** | `app/studio/[id].tsx:49-66` | Validate `id` param before API calls: ensure non-empty, trim whitespace, reject path traversal (`../`, etc.). Consider switching `apiRequest` calls to `authFetch` for consistent explicit auth. |
| 4 | **LOW** | `app/studio/[id].tsx:70,147` | Sanitize error display — store and show a generic message instead of `err.message` in the error state. |
| 5 | **LOW** | `app/intro.tsx` | Add explicit defense-in-depth guard: if `isAuthenticated && user?.hasSeenIntro`, call `router.replace('/(tabs)')` before rendering intro content. |
| 6 | **LOW** | `app/(tabs)/photography.tsx` | Import `useAuth` and add an early-return guard if unauthenticated, for defense-in-depth. |

---

## D) Explicit Answers to Q1–Q3

### Q1: Can an unauthenticated user see any account data on any screen?

**No.** The root `AuthGate` in `app/_layout.tsx` (lines 73–109) unconditionally redirects all unauthenticated users to `/login` before any screen in the `app/` tree renders. It checks `isAuthenticated` and calls `router.replace('/login')` for any route outside the auth group. Every audited screen is within the AuthGate tree. No screen was found that conditionally renders account data without auth, and no local bypass was identified.

### Q2: Do any screens expose raw error details (API errors, stack traces) to the user?

**Yes — two screens:**

- **`app/(tabs)/index.tsx` line 460**: `Alert.alert('Approval Failed', err.message || 'Network error. Please try again.')` — `err.message` can contain raw HTTP status text, fetch exceptions, or JS error strings.
- **`app/diagnose.tsx` line 120**: `<Text>{(error as Error)?.message ?? "Failed to load diagnosis"}</Text>` — directly renders React Query's raw error message in the customer-facing UI.

Partial case: `app/studio/[id].tsx` stores `err.message` at line 70 and displays it at line 147, though the `apiRequest` wrapper may partially sanitize it.

All other screens use safe translated strings (e.g., `t('create.errorGenerate')`, `"Failed to open Meta authorization."`).

### Q3: Does connect.tsx handle OAuth failures safely?

**Yes.** `connect.tsx` handles OAuth failures safely in three ways:

1. **Polling errors are silent** (line 111: `catch { /* polling errors are silent — next tick retries */ }`) — no error details shown to the user during the OAuth polling loop.
2. **Connect failure uses generic copy** (line 129–132): `Alert.alert("Connection error", "Failed to open Meta authorization.")` — no raw `err.message` exposed.
3. **Disconnect/reconnect failures** (lines 136–161) also use generic safe messages. No tokens, error codes, or OAuth callback details are rendered in the UI or leaked in URLs.
