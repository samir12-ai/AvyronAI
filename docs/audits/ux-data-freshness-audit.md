# UX Data Freshness Audit

**Scope:** 11 target files focused on polling intervals, cache TTLs, mutation invalidation, background/foreground behavior, and error-state caching
**Date:** 2026-06-28
**Auditor:** Replit Agent

---

## A) Per-Hook Table: Polling, Staleness & Background Behavior

| Hook / Query | `refetchInterval` | `staleTime` | `gcTime` | AppState pause | Foreground refresh | Notes |
|---|---|---|---|---|---|---|
| `useWatchtower` | 5 min (active only) | 5 min | 5 min (default) | ✅ **Yes** — `active ? 5*60_000 : false` | ✅ Immediate if stale (>5 min backgrounded) | Perception layer. Pauses on background, resumes on foreground. |
| `useActivityTimeline` | 5 min (active only) | 5 min | 5 min (default) | ✅ **Yes** — same pattern | ✅ Immediate if stale | Same AppState wiring. |
| `useBlockedReasons` | 2 min (active only) | 2 min | 5 min (default) | ✅ **Yes** — same pattern | ✅ Immediate if stale | Most aggressive perception hook. |
| `useMonitoring` | 5 min (active only) | 5 min | 5 min (default) | ✅ **Yes** — same pattern | ✅ Immediate if stale | Same AppState wiring. |
| `useReasoning` | 5 min (active only) | 5 min | 5 min (default) | ✅ **Yes** — same pattern | ✅ Immediate if stale | Duplicates `useIsAppActive()` locally. |
| `useRunTruthfulness` | 20 sec (always) | 10 sec | 5 min (default) | ❌ **No** — polls in background | N/A — never pauses | ⚠️ Most aggressive polling (20s). No AppState. Wastes battery in background. |
| `useRunAnchor` | 10 sec (always) | 5 sec | 5 min (default) | ❌ **No** — polls in background | N/A — never pauses | ⚠️ Very aggressive (10s). No AppState. |
| `useContinuityPanel` | 60 sec (always) | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Operator-only. No AppState. Relatively low-frequency. |
| `useOperationsPanel` | 30 sec (always) | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Operator-only. No AppState. |
| `useOperatorNotices` | 60 sec (always) | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Operator-only. No AppState. |
| `useParityPanel` | 60 sec (always) | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Operator-only. No AppState. |
| `PlanStatus` (component) | 10 sec | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Inline `useQuery` in `components/PlanStatus.tsx`. No AppState. |
| `CompetitiveIntelligence` | ~dynamic (5min base) | 5 min | 5 min (default) | ❌ **No** | N/A | `refetchInterval` is a function returning 5min. No AppState. |
| `RequiredWorkCard` | 15 sec | 5 min (global default) | 5 min (default) | ❌ **No** | N/A | Inline `useQuery`. No AppState. |

### Summary — Background Polling

- **5 hooks properly pause polling** when the app is backgrounded: all `usePerception` hooks (`useWatchtower`, `useActivityTimeline`, `useBlockedReasons`, `useMonitoring`) plus `useReasoning`.
- **6 hooks poll continuously in background**, wasting battery and API quota: `useRunTruthfulness` (20s), `useRunAnchor` (10s), `useContinuityPanel` (60s), `useOperationsPanel` (30s), `useOperatorNotices` (60s), `useParityPanel` (60s).
- **3 inline component queries also poll continuously**: `PlanStatus` (10s), `CompetitiveIntelligence` (~5min), `RequiredWorkCard` (15s).

---

## B) Global Defaults (`lib/query-client.ts`)

```ts
const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000; // 5 minutes

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,          // no automatic polling by default
      refetchOnWindowFocus: false,     // disabled (mobile "window focus" is unreliable)
      staleTime: DEFAULT_STALE_TIME_MS, // 5 minutes
      retry: false,                    // no automatic retry on failure
    },
    mutations: { retry: false },
  },
});
```

### Assessment

The **5-minute `staleTime` was an intentional fix** (P1-7 / launch-closure W3) to replace the previous `Infinity` default, which left users staring at indefinitely stale dashboard metrics. The 5-minute bound matches the 5-minute autonomous worker tick so the dashboard cannot lag the engine state by more than one cycle.

However, for **operator panels** and **run-truthfulness monitoring** (audit surface), 5 minutes is arguably too long — these are operational signals where freshness matters. The hooks that care about freshness override it locally (`useBlockedReasons` = 2min, `useRunTruthfulness` = 10sec, `useRunAnchor` = 5sec), which is the correct pattern.

The `gcTime` defaults to React Query’s built-in 5 minutes. This is reasonable — unused cache entries are garbage-collected after 5 minutes of inactivity, preventing unbounded memory growth.

`retry: false` is appropriate for a mobile app — automatic retries on flaky connections can cause request storms and battery drain. The hooks that need resilience implement their own retry or polling.

---

## C) "Last Updated" / Staleness Indicators

### WatchtowerStrip (`components/WatchtowerStrip.tsx` lines 64–68)

```tsx
{data?.lastCheckedAt ? (
  <Text style={[styles.timestamp, { color: textSec }]}>
    checked {formatRelative(data.lastCheckedAt)}
  </Text>
) : null}
```

✅ **YES — a staleness indicator is shown.** The `lastCheckedAt` timestamp from the server is rendered as a relative string (e.g., "checked 5m ago", "checked 2h ago"). This tells the user when the server last evaluated the watchtower, which is the most relevant freshness signal.

### ActivityTimeline (`components/ActivityTimeline.tsx`)

⚠️ **PARTIAL — no card-level "last updated" timestamp.** The card header shows "ACTIVITY · LAST 7 DAYS" with an event count. Each individual event shows its own relative timestamp (`formatRelative(event.at)`), but there is **no overall "data last refreshed" indicator** for the timeline as a whole. If the timeline has been empty for hours, the user sees "Watching — no changes detected" with no indication of when the system last checked for new events.

---

## D) Mutation Invalidation

### TruthSubmissionCard (`components/TruthSubmissionCard.tsx` lines 48–57)

✅ **Correctly invalidates 3 related queries on success:**

```tsx
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['/api/perception/blocked-reasons', campaignId] });
  queryClient.invalidateQueries({ queryKey: ['/api/perception/watchtower', campaignId] });
  queryClient.invalidateQueries({ queryKey: ['/api/perception/activity', campaignId] });
}
```

This is the **correct pattern** — after the user submits truth data, all perception surfaces that depend on truth-state are immediately refreshed.

### Dashboard Plan Refresh (`app/(tabs)/index.tsx:436`)

✅ After campaign creation, invalidates `/api/plans/active`:
```tsx
queryClient.invalidateQueries({ queryKey: ['/api/plans/active', selectedCampaignId] });
```

### Create Tab Mutations (`app/(tabs)/create.tsx`)

✅ Multiple mutations invalidate execution/work queries:
```tsx
queryClient.invalidateQueries({ queryKey: ['/api/execution/required-work', campaignId] });
queryClient.invalidateQueries({ queryKey: ['/api/required-work', campaignId] });
queryClient.invalidateQueries({ queryKey: ['/api/studio/cases', campaignId] });
```

### Mutations that do NOT invalidate related queries

The following **server-side events** have no frontend invalidation — the frontend relies entirely on polling to discover them:

| Event | Affected Query | Current Behavior | Risk |
|---|---|---|---|
| Boss run completes | `run-truthfulness`, `watchtower`, `activity`, `monitoring` | Waits for next poll cycle | User may see stale "no run" state for up to 5 minutes |
| Competitive intelligence scraping finishes | `watchtower`, `activity`, `monitoring` | Waits for next poll cycle | User may see "watching" state longer than necessary |
| Plan approval / plan changes | `plans/active`, `required-work` | Waits for next poll cycle | Dashboard may show stale plan for up to 5 minutes |
| New operator notice generated | `operator-notices` | Waits for next 60s poll | Operator may miss critical notices for up to 60s |
| Continuity tick completes | `continuity-panel` | Waits for next 60s poll | Operator panel may lag by up to 60s |
| New activity event | `activity` | Waits for next 5min poll | Activity timeline may lag by up to 5 minutes |

**Note:** The `TruthSubmissionCard` is the ONLY frontend mutation that proactively invalidates perception queries. All other state changes are discovered via polling.

---

## E) Background → Foreground Behavior

### Hooks WITH AppState (usePerception, useReasoning)

When the app returns to foreground after 30+ minutes:

1. **Polling was paused** while backgrounded (`refetchInterval: false`).
2. **React Query garbage collection** may have removed the cache entry if it was inactive for >5 minutes (`gcTime` default).
3. If the cache entry was GC'd, the hook returns to `isLoading: true` and fetches fresh data immediately.
4. If the cache entry survived (e.g., component was still mounted), React Query checks `staleTime`. Since the data is >5 minutes old, it is **stale**, and RQ triggers an **immediate refetch** when the query is re-observed (on the next render cycle).
5. The user briefly sees the old cached data with its `lastCheckedAt` timestamp, then the fresh data replaces it.

**The `lastCheckedAt` timestamp is accurate** — it reflects the server's actual last check time, which is what matters to the user.

### Hooks WITHOUT AppState (useRunTruthfulness, useRunAnchor, operator panels)

These hooks **never paused polling** while backgrounded. React Native may have suspended the JS thread, but the `refetchInterval` timer would fire as soon as the app resumes. There is no "stale on foreground" issue — but there IS a battery/API waste issue from continuous background polling.

### refetchOnWindowFocus = false

The global `refetchOnWindowFocus: false` is correct for mobile — the "window focus" concept doesn't map cleanly to React Native AppState. The AppState-based polling pause/resume in `usePerception` and `useReasoning` is the correct mobile equivalent.

---

## F) Error-State Caching

### Watchtower / ActivityTimeline behavior on error

With `retry: false` globally, a single failed fetch puts the query in `error` state. React Query **preserves the previous cached data** but marks it as stale.

In `WatchtowerStrip` (lines 75–76) and `ActivityTimeline` (lines 48–49):

```tsx
{error ? (
  <Text style={[styles.errorText, { color: textSec }]}>Watchtower unavailable</Text>
) : (
  // data rendering
)}
```

✅ **On error, the UI shows "unavailable" — NOT the old cached data.** The error branch takes precedence over the data branch. This prevents the "outdated positive data" scenario.

### If the error resolves

When the error resolves (network comes back, server recovers):
- React Query will retry on the next poll cycle.
- If successful, fresh data replaces the error state.
- The fresh data may be up to `staleTime` old (5 minutes for Watchtower), but the `lastCheckedAt` timestamp accurately reflects server state.

### Edge case: partial error recovery

If some perception endpoints succeed and others fail (e.g., `/api/perception/watchtower` succeeds but `/api/perception/activity` fails), the Watchtower shows fresh data while the Activity Timeline shows "unavailable." This is correct per-component error handling.

---

## G) Explicit Answers to the Three Questions

### Q1: Can a user see Watchtower data that is more than 10 minutes old without any staleness indicator?

**Answer: The user CAN see Watchtower data >10 minutes old, but they DO have a staleness indicator (`lastCheckedAt`).**

The `lastCheckedAt` field is rendered as a relative timestamp ("checked 5m ago", "checked 2h ago") whenever it is present. If `lastCheckedAt` is `null` (server has never checked), no timestamp is shown, but this typically means the watchtower is in a "no_data" state rather than silently stale.

However, there is a **subtle gap**: `lastCheckedAt` reflects **server check time**, not **client cache age**. If the server checked 2 minutes ago but the client hasn't polled in 30 minutes (app was backgrounded), the user sees "checked 2m ago" which accurately describes server state but doesn't tell the user their local cache is 30 minutes old. React Query does refetch immediately on foreground if the cache is stale (>5 minutes), so this gap is transient.

### Q2: Are there mutations that do NOT invalidate related queries?

**Answer: YES — the following server-side state changes have no frontend invalidation and rely entirely on polling:**

1. **Boss run completion** → no invalidation of `run-truthfulness`, `watchtower`, `activity`, `monitoring`
2. **CI scraping completion** → no invalidation of perception queries
3. **Plan approval / plan state changes** → no invalidation beyond the single `plans/active` call in `index.tsx`
4. **New operator notices** → no invalidation of `operator-notices`
5. **Continuity tick completion** → no invalidation of `continuity-panel`

The **only proactive invalidation** in the perception layer is `TruthSubmissionCard`, which correctly invalidates `blocked-reasons`, `watchtower`, and `activity` after a user truth submission.

### Q3: What are the global defaults and are they appropriate?

**Answer:**

| Default | Value | Assessment |
|---|---|---|
| `staleTime` | 5 minutes | ✅ Appropriate for dashboard data that changes on 5-minute worker ticks. Hooks that need more freshness override locally. |
| `refetchInterval` | `false` | ✅ Correct — no unexpected polling. Hooks opt-in to polling explicitly. |
| `refetchOnWindowFocus` | `false` | ✅ Correct for mobile. AppState-based pause/resume is the proper mobile pattern. |
| `retry` | `false` | ✅ Correct — prevents request storms on flaky mobile connections. |
| `gcTime` | 5 minutes (RQ default) | ✅ Reasonable — prevents unbounded memory growth. |

---

## H) Findings & Recommendations

### ⚠️ MEDIUM — 6 Hooks Lack Background Pause

**6 hooks and 3 inline component queries poll continuously in the background**, wasting battery and API quota:

1. `useRunTruthfulness` — 20-second interval
2. `useRunAnchor` — 10-second interval  
3. `useContinuityPanel` — 60-second interval
4. `useOperationsPanel` — 30-second interval
5. `useOperatorNotices` — 60-second interval
6. `useParityPanel` — 60-second interval
7. `PlanStatus` (component) — 10-second interval
8. `CompetitiveIntelligence` (component) — ~5-minute interval
9. `RequiredWorkCard` (component) — 15-second interval

**Recommendation:** Apply the same `useIsAppActive()` pattern used in `usePerception.ts` to all hooks with `refetchInterval`. A shared `useIsAppActive()` hook could be extracted to avoid duplication (it currently exists in both `usePerception.ts` and `useReasoning.ts`).

### ⚠️ MEDIUM — No Server-Side Invalidation WebSocket/Push

The frontend relies entirely on polling for all server-side state changes (boss runs, CI scraping, plan approvals, new notices). With the perception layer polling at 5-minute intervals, a user could wait up to 5 minutes to see that a boss run completed or new activity was detected.

**Recommendation:** Consider a lightweight WebSocket or Server-Sent Events (SSE) channel for critical state changes, or add targeted invalidation triggers in the backend that push invalidate signals to active clients. At minimum, the `run-truthfulness` hook (10s polling) should be made AppState-aware to reduce background waste while maintaining fast discovery.

### ⚠️ LOW — ActivityTimeline Has No Card-Level Staleness Indicator

The ActivityTimeline card shows per-event timestamps but no overall "last checked" or "last updated" timestamp. If the timeline is empty for hours, the user sees "Watching — no changes detected" with no indication of when the system last attempted to find new events.

**Recommendation:** Add a subtle footer or header timestamp showing when the activity feed was last refreshed, similar to the WatchtowerStrip pattern.

### ✅ PASS — Error State Does Not Show Stale Positive Data

On API failure, both `WatchtowerStrip` and `ActivityTimeline` render error text ("Watchtower unavailable" / "Activity unavailable") rather than showing old cached data. This prevents the dangerous scenario where a failed fetch causes the user to see outdated positive metrics.
