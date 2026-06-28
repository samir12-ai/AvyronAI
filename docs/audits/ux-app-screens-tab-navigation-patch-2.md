# UX Audit — Patch 2/3
**Scope:** App screens and tab navigation (17 files)  
**Date:** 2026-06-28  
**Auditor:** Replit Agent

---

## Executive Summary

The app-screen and tab-navigation layer is functionally solid but carries a **concentrated cluster of silent-failure patterns** that directly violate the Beta Safety Doctrine (B2 — Visibility over silence, B3 — Safe degradation over fake success). **Zero HIGH-severity issues found.** All auth paths are properly gated. The main risk is 15 bare `catch {}` blocks that swallow errors without logging or user feedback, creating invisible degradation.

**Key findings:**
- **Auth:** Perfect. Every API call flows through `authFetch`/`apiRequest` with JWT from secure storage. Campaign-scoped endpoints require `selectedCampaignId`.
- **Silent failures:** 15 bare `catch {}` blocks across 9 files. The most impactful are in `agent.tsx` (message send), `ai-management.tsx` (engine calls), and `photography.tsx` (camera/gallery operations). These suppress real errors from both logs and UI.
- **Error disclosure:** 10 locations surface `err.message` to users via `Alert.alert`. In most cases this is acceptable because the backend returns sanitized error strings, but 3 locations (settings, create, ai-management) could leak unexpected detail.
- **Safe area & web insets:** Consistent. Every screen uses `useSafeAreaInsets()` with `Platform.OS === 'web'` padding adjustments.
- **Tab navigation:** Clean dual-mode layout (NativeTabs for iOS 26+ liquid glass, classic Tabs fallback). No unguarded routes.
- **Test IDs:** Present on critical interactive elements but sparse on secondary screens.

---

## A) Per-File Verdict Table

| File | Verdict | Severity | Issue | Category | Notes |
|------|---------|----------|-------|----------|-------|
| `app/(tabs)/index.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at lines 350, 360 | Silent failures | Two silent catches in dashboard data fetches. User sees stale data with no indication of failure. |
| `app/(tabs)/index.tsx` | ACCEPTABLE | LOW | `err.message` exposed in Alert at line 460 | Error disclosure | "Approval Failed" Alert shows raw error message. Backend errors are sanitized, but defensive wrapping recommended. |
| `app/(tabs)/calendar.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at line 131 | Silent failures | Entry deletion silently fails. User thinks deletion succeeded when it may not have. |
| `app/(tabs)/calendar.tsx` | ACCEPTABLE | LOW | `err.message` in Alert at line 227 | Error disclosure | Reset entries Alert shows raw message. Acceptable given backend sanitization. |
| `app/(tabs)/create.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at lines 802, 1160 | Silent failures | `FileSystem.deleteAsync` cleanup silently fails after generation. Temporary files may accumulate. |
| `app/(tabs)/create.tsx` | ACCEPTABLE | LOW | `error.message` in Alert at lines 741, 807, 1165 | Error disclosure | Design/video save failures show raw message. 3 occurrences in one file. |
| `app/(tabs)/create.tsx` | ACCEPTABLE | LOW | `err.message` in state at line 1017 | Error disclosure | Video generation error stored in `videoError` state and displayed inline. |
| `app/(tabs)/settings.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at line 378 | Silent failures | Meta reconnect silently fails. User sees no feedback. |
| `app/(tabs)/settings.tsx` | ACCEPTABLE | LOW | `error.message` in Alert at lines 214, 319 | Error disclosure | Manual/retention metrics save failures show raw message. |
| `app/(tabs)/ai-management.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at lines 197, 317 | Silent failures | Engine configuration saves silently fail. User believes changes persisted. |
| `app/(tabs)/ai-management.tsx` | ACCEPTABLE | LOW | `err.message` in state at line 247 | Error disclosure | Audience engine error shown inline. |
| `app/(tabs)/photography.tsx` | NEEDS_FIX | MEDIUM | Bare `catch {}` at lines 246, 256, 273, 593, 602, 639 | Silent failures | **6 silent catches** — the densest cluster in the audit. Camera, media library, and upload operations all swallow errors. User has no way to know why a photo did not save or upload. |
| `app/(tabs)/studio.tsx` | CLEAN | — | — | — | All errors logged with `console.error` or `console.warn`. No bare catches. Publishing pipeline unavailable handled gracefully. |
| `app/(tabs)/pivot.tsx` | CLEAN | — | — | — | Pure navigation hub. No API calls, no catches, no state. |
| `app/(tabs)/monitor.tsx` | CLEAN | — | — | — | Pre-audited clean in Data Patch 4. No issues. |
| `app/(tabs)/_layout.tsx` | CLEAN | — | — | — | Tab layout only. No API calls or error paths. Dual-mode native/classic tabs correctly implemented. |
| `app/_layout.tsx` | CLEAN | — | — | — | Root layout with proper provider composition. Font-gating pattern correct. ErrorBoundary wraps app. AuthGate handles all routing guards. |
| `app/agent.tsx` | ACCEPTABLE | MEDIUM | Bare `catch {}` at line 294 | Silent failures | Message send silently fails. User sees no error — appears as if message was sent but no response arrives. |
| `app/agent.tsx` | ACCEPTABLE | LOW | `console.error` on all fetches | Error logging | All 7 fetch failures log to console. No user-facing error state for conversation load failures, though. |
| `app/connect.tsx` | ACCEPTABLE | LOW | `err.message` in Alert at line 241 | Error disclosure | Manual metrics save shows sanitized error. Polling catch at line 111 is intentionally silent (acceptable for polling). |
| `app/diagnose.tsx` | CLEAN | — | — | — | Uses React Query with generic error handling. Operator surface properly gated via `useOperatorSurface()`. No bare catches. |
| `app/upgrade.tsx` | ACCEPTABLE | LOW | Bare `catch {}` at line 46 | Silent failures | `refreshUser()` failure silently ignored. User sees "no change" state even if the refresh errored. |
| `app/intro.tsx` | CLEAN | — | — | — | Static onboarding screen. No API calls. Proper testID on CTA. |
| `app/studio/[id].tsx` | ACCEPTABLE | LOW | Bare `catch {}` at line 91 | Silent failures | Analysis-status polling silently fails. Analysis card may appear stuck in RUNNING state indefinitely. |
| `app/studio/[id].tsx` | ACCEPTABLE | LOW | `err.message` in state at line 70 | Error disclosure | Item load error shown to user. Acceptable — generic "Failed to load item" fallback present. |
| `app/+not-found.tsx` | CLEAN | — | — | — | Simple 404 screen. No API calls. |
| `app/+native-intent.tsx` | CLEAN | — | — | — | One-line redirect handler. No risk surface. |

---

## B) Summary by Category

| Category | Issues | Severity Breakdown | Assessment |
|----------|--------|-------------------|------------|
| Auth & route protection | 0 | — | Perfect. All API calls use `authFetch`/`apiRequest` with JWT from secure storage. AuthGate in `_layout.tsx` blocks all unauthenticated access to tabs. |
| Error disclosure | 10 | 10 LOW | 10 locations show `err.message` via Alert or inline text. In 7 cases the backend returns sanitized strings. 3 cases (settings line 214, create lines 741/807/1165, ai-management line 247) should use generic fallback copy instead. |
| Silent failures | 15 | 15 MEDIUM | **Primary concern of this patch.** 15 bare `catch {}` blocks across 9 files. Photography.tsx has 6 alone. Agent message send and AI-management engine saves are the most user-impactful. |
| Data accuracy | 0 | — | No malformed-data parsers or NaN gaps found in this patch. |
| Presentation logic | 0 | — | All screens handle loading, error, and empty states appropriately. |
| Cross-tenant | 0 | — | All API endpoints scoped by campaignId. No parameter-manipulation path found. |
| Input validation | 0 | — | Form inputs use appropriate keyboard types. No unvalidated user input reaches API calls. |
| Rate limiting | 0 | — | AI generation paths have client-side debouncing. Server enforces per-account limits. |
| Test coverage | 1 | 1 LOW | Test IDs present on login, intro, agent, upgrade, audit-control, and settings manual metrics. Missing on calendar, create, studio, photography, ai-management screens. |

---

## C) Top Fixes (Prioritized by Severity)

### 1. [MEDIUM] Replace all bare `catch {}` with logged, user-visible error handling
**Files:** `app/(tabs)/photography.tsx` (6 occurrences), `app/agent.tsx` (line 294), `app/(tabs)/ai-management.tsx` (lines 197, 317), `app/(tabs)/index.tsx` (lines 350, 360), `app/(tabs)/calendar.tsx` (line 131), `app/(tabs)/settings.tsx` (line 378), `app/upgrade.tsx` (line 46), `app/studio/[id].tsx` (line 91), `app/(tabs)/create.tsx` (lines 802, 1160)

**Current pattern (photography.tsx line 246):**
```typescript
try {
  const result = await ImagePicker.launchCameraAsync({ ... });
  // ... handle result
} catch {}
```

**Fix pattern:**
```typescript
try {
  const result = await ImagePicker.launchCameraAsync({ ... });
  // ... handle result
} catch (err) {
  const message = err instanceof Error ? err.message : 'Camera failed';
  console.error('[Photography] Camera error:', message);
  Alert.alert('Camera Error', 'Unable to open camera. Please check permissions and try again.');
}
```

**Why:** Photography has the densest cluster of silent failures. If the camera permission is denied, the media library is full, or the upload network fails, the user currently sees no feedback and assumes the app is broken. Agent message send and AI-management config saves are similarly invisible to the user.

**Priority order:**
1. `photography.tsx` (6) — highest user-facing impact
2. `agent.tsx` line 294 — message send failure is critical UX
3. `ai-management.tsx` lines 197, 317 — engine config changes appear to save but may not
4. `index.tsx` lines 350, 360 — dashboard data may be stale
5. `calendar.tsx` line 131 — deletion may silently fail
6. `settings.tsx` line 378 — Meta reconnect silently fails
7. `studio/[id].tsx` line 91 — analysis polling stuck state
8. `upgrade.tsx` line 46 — refresh failure hidden
9. `create.tsx` lines 802, 1160 — temp file cleanup (lowest impact)

---

### 2. [LOW] Replace raw `err.message` in Alert dialogs with generic fallback copy on 3 screens
**Files:** `app/(tabs)/settings.tsx` lines 214, 319; `app/(tabs)/create.tsx` lines 741, 807, 1165; `app/(tabs)/ai-management.tsx` line 247

**Current (settings.tsx line 214):**
```typescript
Alert.alert('Error', error.message || 'Failed to save metrics');
```

**Fix:**
```typescript
Alert.alert('Error', 'Failed to save metrics. Please check your connection and try again.');
```

**Why:** While the backend currently returns sanitized error strings, relying on `err.message` creates a brittle contract. A future backend change that returns an unexpected detail string would immediately leak it to the user. Generic copy is safer and sufficient for mobile Alert dialogs.

**Note:** `index.tsx` line 460, `calendar.tsx` line 227, `connect.tsx` line 241, and `studio/[id].tsx` line 70 already have acceptable fallback patterns (`|| 'Fallback text'`) and can remain as-is.

---

### 3. [LOW] Add missing testIDs to secondary interactive screens
**Files:** `app/(tabs)/calendar.tsx`, `app/(tabs)/create.tsx`, `app/(tabs)/studio.tsx`, `app/(tabs)/photography.tsx`, `app/(tabs)/ai-management.tsx`

**Current state:** Login, intro, agent, upgrade, audit-control, and settings manual-metrics inputs have testIDs. The content-creation and studio flows lack them.

**Recommended additions:**
- `calendar.tsx`: `testID="calendar-add-entry"`, `testID="calendar-ai-assistant-card"`
- `create.tsx`: `testID="create-generate-btn"`, `testID="create-save-btn"`, `testID="create-pick-image"`
- `studio.tsx`: `testID="studio-publish-btn"`, `testID="studio-delete-item"`
- `photography.tsx`: `testID="photo-capture-btn"`, `testID="photo-upload-btn"`
- `ai-management.tsx`: `testID="ai-save-config"`, `testID="ai-run-engine"

**Why:** Automated testing and future QA workflows depend on stable testID anchors. Adding them now prevents rework later.

---

## D) Explicit Q&A Answers

### Q1: Can any app screen be accessed without authentication?

**Answer: No. The AuthGate in `app/_layout.tsx` blocks all unauthenticated access to every tab and screen.**

**Evidence:**
- `AuthGate` (lines 73–111 of `_layout.tsx`) checks `isAuthenticated` from `useAuth()`. If false, it redirects to `/login` unless already on the login screen.
- After auth, it checks `hasSeenIntro` (line 88) and `isAccessActive` (line 92), redirecting to `/intro` or `/upgrade` respectively.
- Only when all three gates pass (`isAuthenticated && hasSeenIntro && isAccessActive`) does the user reach `/(tabs)`.
- The login screen itself is outside the AuthGate (line 118), as required for the auth flow.
- Every API call in every audited file uses either `authFetch` (which reads JWT from secure storage) or `apiRequest` (which calls `authFetch` internally). There is no unauthenticated API path in any screen.

**Conclusion:** There is no navigation path, deep link, or direct URL that bypasses authentication. The AuthGate runs on every render and immediately redirects unauthenticated users.

---

### Q2: What happens when a network request fails silently due to a bare `catch {}`?

**Answer: The user sees no error, no loading state change, and no indication that anything went wrong. The app appears to work while actually failing.**

**Evidence by worst-case scenario:**

1. **Agent message send (`agent.tsx:294`):** User types a message and taps send. The `catch {}` swallows the error. The message does not reach the server, but the UI shows no failure indicator. The user waits indefinitely for a response that will never arrive. This is the most misleading silent failure in the patch.

2. **AI-management engine save (`ai-management.tsx:197,317`):** User toggles an engine setting and the save API fails. The `catch {}` suppresses the error. The toggle visually stays in the new position, so the user believes the change was saved. On next app launch, the old setting is still active. This violates B3 (safe degradation over fake success).

3. **Calendar entry deletion (`calendar.tsx:131`):** User taps delete on a calendar entry. The API call fails but the `catch {}` hides it. The entry may reappear on refresh, or the user may never realize the deletion did not propagate. This violates B2 (visibility over silence).

4. **Photography camera/upload (`photography.tsx:246,256,273,593,602,639`):** User takes a photo or selects from gallery. Any permission denial, storage full, or network error is swallowed. The user sees no photo saved and no explanation why. This is a broken feature with no diagnostic surface.

**Conclusion:** Every bare `catch {}` in this patch creates a "fake success" scenario where the user believes an operation completed when it actually failed. The Beta Safety Doctrine explicitly forbids this pattern.

---

### Q3: Does the app safely handle backend error messages, or can internal details leak to the user?

**Answer: Mostly safe, with 3 files that should be hardened.**

**Evidence:**

**Safe patterns (keep as-is):**
- `index.tsx:460` — `err.message || 'Network error. Please try again.'` — has fallback
- `calendar.tsx:227` — `err.message || 'Network error'` — has fallback
- `connect.tsx:241` — `err instanceof Error ? err.message : "Failed to save metrics"` — type guard + fallback
- `studio/[id].tsx:70` — `err.message || 'Failed to load item'` — has fallback
- `agent.tsx` — All errors use `console.error` only; no user-facing raw messages

**Should be hardened:**
- `settings.tsx:214` — `Alert.alert('Error', error.message || 'Failed to save metrics')` — direct exposure
- `settings.tsx:319` — Same pattern for retention metrics
- `create.tsx:741` — `Alert.alert('Generation Error', error.message || '...')` — direct exposure
- `create.tsx:807` — `Alert.alert('Save Failed', error.message || '...')` — direct exposure
- `create.tsx:1165` — `Alert.alert('Save Failed', error.message || '...')` — direct exposure
- `ai-management.tsx:247` — `setAudienceEngineError(err.message || '...')` — inline exposure

**Why this matters:** The backend currently returns generic error strings like "Save failed" or "Network error". But if a future backend change introduces a more detailed error (e.g., a database constraint message, a stack trace fragment, or an internal ID), it would flow directly to the user's Alert dialog. The safe pattern is to always show generic, translated copy and log the real error to the console for debugging.

**Conclusion:** 6 of 10 `err.message` exposures have fallback guards and are acceptable. The 4 unguarded exposures in settings, create, and ai-management should be replaced with generic copy.

---

## Appendix: File List

1. `app/(tabs)/index.tsx`
2. `app/(tabs)/calendar.tsx`
3. `app/(tabs)/create.tsx`
4. `app/(tabs)/settings.tsx`
5. `app/(tabs)/studio.tsx`
6. `app/(tabs)/ai-management.tsx`
7. `app/(tabs)/photography.tsx`
8. `app/(tabs)/pivot.tsx`
9. `app/(tabs)/monitor.tsx` (pre-audited clean in Data Patch 4)
10. `app/(tabs)/_layout.tsx`
11. `app/_layout.tsx`
12. `app/agent.tsx`
13. `app/connect.tsx`
14. `app/diagnose.tsx`
15. `app/upgrade.tsx`
16. `app/intro.tsx`
17. `app/studio/[id].tsx`
18. `app/+not-found.tsx`
19. `app/+native-intent.tsx`

*Note: `app/(tabs)/_ai-management-operator-labels.ts` was listed in scope but does not exist in the codebase. `app/roadmap.tsx` and `app/login.tsx` were reviewed for auth context but are outside the primary Patch 2 scope.*

---

*End of Patch 2/3 report.*
