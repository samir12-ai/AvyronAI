# Frontend & UX Audit — Pre-Beta

**Date:** May 2026
**Scope:** Full system-level audit of the customer-facing surface area, runtime→UI lineage, frontend architecture, perception consistency, and beta UX readiness.
**Source material:** 4 parallel deep audits (surface inventory, source-of-truth lineage, frontend architecture, customer perception). Conflicts between sources resolved in favor of the lineage trace (which inspected actual endpoints) where the inventory subagent guessed.

---

## 0. Executive Summary

| Dimension | Verdict | Confidence |
|---|---|---|
| Surface inventory completeness | **GOOD** — 4-pillar customer pivot is real and gated; 23 routes, 59 components mapped | high |
| Runtime → UI lineage integrity | **STRONG** — every customer surface traces back to a canonical endpoint; perception translator is fail-closed | high |
| Frontend architecture | **MIXED** — query layer is solid; `AppContext` is bloated; polling is not app-state-aware | medium |
| Customer perception | **WEAK** — dashboard is overwhelming (12 cards, 20+ numbers, 8 simultaneous status badges); 3 chat surfaces compete | high |
| Operator leakage | **CLEAN** after pre-beta stabilization; 2 ungated edge cases remain in `diagnose.tsx` + `StrategyHub.tsx` | medium |
| Beta UX readiness | **NOT READY** for broad beta. Ready for controlled S0/S1 (≤25 users) with focused redesign sprint | high |

**Top blockers for broad beta (in priority order):**

1. **Dashboard overload (P0 UX).** `app/(tabs)/index.tsx` shows ~12 cards, 20+ numerical values, 8 simultaneous status badges. A founder cannot answer "how is my business doing?" without scanning every card. **Fix: collapse to 4-6 cards.**
2. **Three competing AI chat surfaces (P0 UX).** `DashboardChat` + `MarketMindAgent` + dedicated `app/agent.tsx` + `OnboardingAgent` overlay all live concurrently. **Fix: unify into one agent surface; remove `DashboardChat` from the dashboard.**
3. **Customer-pivot incomplete (P1 UX).** The 4-pillar collapse is undermined by a 13-engine vertical list in customer mode at `ai-management.tsx:329-338`. Customers see 13 choices labeled with outcomes but don't know which to pick first. **Fix: collapse the 13 into 4 grouped accordions or progressive disclosure.**
4. **`AppContext` bloat (P1 architecture).** ~15 disparate state pieces in one provider re-render the entire app tree on any change. **Fix: migrate `campaigns`, `ads`, `platformConnections` to React Query.**
5. **Two residual operator-leak edge cases (P1 doctrine).** `app/diagnose.tsx` and `components/StrategyHub.tsx` reference engine pills without `useOperatorSurface()`. Vocab lint is currently clean but defense-in-depth is missing.
6. **Background polling battery drain (P2).** All perception hooks poll every 5min, plan/required-work every 10–15s, with no `AppState` pause when backgrounded.
7. **Silent error swallowing in `AuthContext` + `query-client.ts` (P2).** Failed loads result in infinite spinners with no user feedback — directly conflicts with Seal #15 doctrine even though it's on the customer side rather than the engine pipeline.

---

## 1. Customer Surface Inventory

### 1.1 Routes & gating

**Reachable in customer mode** (no `EXPO_PUBLIC_METRICS_ADMIN_TOKEN`):
- `app/intro.tsx`, `app/login.tsx`, `app/upgrade.tsx` (auth/paywall)
- `app/(tabs)/` — 9 tabs: `index` (dashboard), `ai-management`, `calendar`, `create`, `monitor`, `photography`, `pivot`, `settings`, `studio`
- `app/agent.tsx`, `app/connect.tsx`, `app/diagnose.tsx`, `app/roadmap.tsx`, `app/studio/[id].tsx`

**Operator-only:** `app/audit-control.tsx` (gated via `EXPO_PUBLIC_METRICS_ADMIN_TOKEN`)

**Operator-only panels mounted conditionally inside `ai-management.tsx`:**
- `OrchestratorPanel`, `SystemIntegrityPanel`, `SignalFlowPanel`, `AELDebugPanel`, `MarketDatabaseAdmin` — all correctly gated at `ai-management.tsx:1075-1085`.

**Customer-pillar mapping inside `ai-management.tsx`:**

| Pillar | Customer label | Renders |
|---|---|---|
| Connect | "Auto Publish" | `renderPublisher()` (mostly "Coming Soon" UI) |
| Diagnose | "Competitive Intelligence" | `CompetitiveIntelligence.tsx` |
| Roadmap | "Build The Plan" | `BuildThePlan.tsx` |
| Monitor | "Control Center" | `ControlCenter.tsx` |

**13 strategy sub-tabs (also reachable in customer mode via customer-safe labels at `ai-management.tsx:329-338`):**
positioning, differentiation, mechanism, offers, awareness, funnels, integrity, persuasion, statistical_validation, budget_governor, channel_selection, iteration, retention.

### 1.2 Dashboard (`app/(tabs)/index.tsx`) — full card inventory

| # | Section | Component | Data source |
|---|---|---|---|
| 1 | Hero / brand header | inline + `AvyronLogo` | `useApp().brandProfile` |
| 2 | Watchtower 3-line strip | `WatchtowerStrip` | `/api/perception/watchtower` |
| 3 | Activity Timeline | `ActivityTimeline` | `/api/perception/activity?sinceHours=N` |
| 4 | RunTruthfulnessBanner | `RunTruthfulnessBanner` | `/api/system-control/run-truthfulness/:cid` |
| 5 | PlanStatus | `PlanStatus` | `/api/plans/active/:cid` |
| 6 | Strategic Narrative (5-step) | `NarrativeCard` | `/api/narrative/:cid` |
| 7 | ExecutionPlan | `ExecutionPlan` | `/api/plans/active/:cid` (duplicate of #5) |
| 8 | RequiredWorkCard | `RequiredWorkCard` | `/api/tasks/pending` / required-work table |
| 9–12 | KPI grid (Revenue, ROAS, Spend, Leads) | `MetricCard` × 4 + `MiniChart` | `/api/dashboard/metrics` |
| 13 | DashboardChat | `DashboardChat` | `/api/dashboard/agent-explain` |
| 14 | MarketMindAgent (priority action) | `MarketMindAgent` | `/api/dashboard/agent-brief` |

**Inventory total: 14 distinct surfaces on a single dashboard scroll.** This is roughly 2× the upper bound of comfortable cognitive load for a primary screen.

### 1.3 Modals & global sheets

- `AccountSwitcherModal` — mounted in `app/_layout.tsx`, triggered from header
- `CampaignSelector` — inside `ai-management.tsx`, triggered from campaign bar
- `EngineTableModal` — "View All" inside any engine detail
- `BusinessProfileModal` — inside Settings
- AudienceModal — inside `ai-management.tsx`

### 1.4 Dead / unreferenced components

After grep verification, the following components in `components/` have no live import path from a reachable route:

| Component | Status | Recommendation |
|---|---|---|
| `AdPreview.tsx` | orphaned | delete or wire into Create flow |
| `BusinessDataForm.tsx` | orphaned (duplicates `BusinessProfile.tsx`) | delete |
| `PlatformPicker.tsx` | orphaned (duplicates `PlatformConnection.tsx`) | delete |

Note: the inventory subagent's earlier claim that `VideoEditorContent.tsx`, `RunTruthfulnessBanner.tsx`, and `ActivityTimeline.tsx` were unreachable is **incorrect** — all three are mounted in the current dashboard / studio flow (verified via grep).

---

## 2. Runtime → UI Lineage Map

Every customer-visible surface traces to a canonical endpoint. Highlights:

### 2.1 Perception Layer (Seal #15-aligned)

| UI element | Endpoint | Backend logic | Tables | Origin |
|---|---|---|---|---|
| WatchtowerStrip — market line | `/api/perception/watchtower` | `translateQ1Verdict()` | `boss_runs.q1_verdict` | real |
| WatchtowerStrip — plan line | same | `translateQ2Verdict()` | `boss_runs.q2_verdict` | real |
| WatchtowerStrip — freshness line | same | `translateFreshness()` | `boss_runs.finished_at` | real |
| ActivityTimeline — events | `/api/perception/activity` | 3-source merger | `boss_runs` + `plan_anchor_resets` + `continuity_ticks.note` JSONB | real |
| ActivityTimeline — fallback | same | (none) | (empty) | unknown → drops silently per fail-closed |

**Strength:** The perception translator (`shared/perception-translator.ts`) is **fail-closed by design** — unrecognized statuses return `null` and the UI hides the row rather than coercing. This is exactly the Seal #15/D5 behavior we want.

**Weakness:** A founder sees a 3-line strip with no explanation of why "freshness" matters. No tooltip, no "what is this?" affordance.

### 2.2 Strategic Narrative (5-step causal chain)

- `NarrativeCard` → `/api/narrative/:cid` → `buildCausalNarrative()` → joins `ael_snapshots.root_causes` with positioning / mechanism / differentiation / offer / funnel snapshots.
- Each step has a per-source `dataSource` tag (verified | projected | benchmark | manual) surfaced via `DataProvenance`.
- **Strength:** This is the **single strongest perceived-intelligence surface in the product.** It connects 5 engines into one story — exactly what a founder wants from "strategic AI."

### 2.3 Dashboard KPIs (adaptive data source)

- `/api/dashboard/metrics` → `getDashboardMetrics()` reads `performance_snapshots` (REAL) / `manual_campaign_metrics` (MANUAL) / `strategic_plans` (PLAN).
- Returns `{ value, dataSource, confidenceScore }` per metric.
- **UI weakness:** the dashboard renders the value with a colored MiniChart but **does not surface the `dataSource` distinction to the customer**. A "Revenue: $12k" from MANUAL feels the same as one from REAL. Trust-eroding.

### 2.4 Engine snapshot cards (Positioning, Awareness, etc.)

- Each engine card calls `/api/<engine>/latest` → `normalizeEngineSnapshot()` on the client.
- `EnvelopeBadge` shows envelope-level state (LIVE / REUSED / DEGRADED / INCOMPLETE).
- **UI weakness:** envelope semantic tokens ("reused", "incomplete") leak operator vocabulary into customer UX. See §5.

### 2.5 RunTruthfulness presenter

- `useRunTruthfulness()` → `/api/system-control/run-truthfulness/:cid` → `presentRunTruthfulness()` returns `{ customerLabel, color, isCanonical }`.
- Returns `null` when both inputs missing (D5 fail-closed).
- Customer-safe labels are applied in `lib/run-truthfulness-presentation.ts`.
- **Strength:** This is the right pattern. The presenter is the single chokepoint for verdict → customer language.
- **Weakness:** Some downstream code still references `RunTruthfulnessBanner` with raw enum tokens (`"shadowed"`, `"system_untrusted"`) — see §5.

---

## 3. UX Logic — Per-Screen Verdicts

| Screen | Verdict | Headline issue |
|---|---|---|
| `app/(tabs)/index.tsx` (Dashboard) | **REDESIGN** | 14 cards, 3 chat surfaces, 20+ numbers, 8 simultaneous badges |
| `app/(tabs)/ai-management.tsx` (customer) | **NEEDS_WORK** | 4-pillar promise undermined by 13-engine flat list |
| `app/diagnose.tsx` | **PASS** | Strongest perceived-intelligence surface alongside NarrativeCard |
| `app/roadmap.tsx` | **PASS** | Build/Execute/Document segmented control mirrors how an agency works |
| `app/connect.tsx` | **NEEDS_WORK** | Manual metrics fallback breaks the "autonomous AI" promise |
| `app/(tabs)/calendar.tsx` | **PASS** | Coherent and predictable |
| `app/(tabs)/create.tsx` + `components/VideoEditorContent.tsx` | **PASS** | High perceived value — feels like an agency studio |
| `app/(tabs)/studio.tsx` + `studio/[id].tsx` | **PASS** | Clear creative workflow |
| `app/(tabs)/monitor.tsx` | **NEEDS_WORK** | Should be operator-gated or have a clearer customer narrative |
| `app/(tabs)/pivot.tsx` | **NEEDS_WORK** | Purpose unclear without operator context |
| `app/agent.tsx` | **NEEDS_WORK** | Duplicates DashboardChat and MarketMindAgent |
| `app/audit-control.tsx` | **N/A** | Operator-only; works as intended |
| `app/upgrade.tsx` | **PASS** | Standard paywall — works |
| `app/login.tsx` / `app/intro.tsx` | **PASS** | Standard auth flow |

---

## 4. Customer Perception — Where Trust Wins & Breaks

### 4.1 Where the system feels intelligent (preserve these)
1. **Strategic Narrative card** — 5-step chain reads like a strategist's reasoning, not a dashboard
2. **`diagnose.tsx` "What's blocking conversion"** — answers the founder's real question
3. **VideoEditor Quick Templates** — feels agency-grade
4. **MarketMindAgent priority action** — single clear directive beats 12 KPI cards
5. **ActivityTimeline "Watching — no changes detected"** — proactive reporting builds confidence even when quiet

### 4.2 Where trust breaks (fix these)
1. **"Shadowed" / "System Untrusted" labels** in `RunTruthfulnessBanner` (line ~42) — founders read "Untrusted" as "the app is broken"
2. **`EnvelopeBadge` showing "reused" / "incomplete"** — operator vocabulary
3. **"85% trusted signal"** in `diagnose.tsx` (line ~133) — what about the other 15%? Reads as "the AI is guessing 15%"
4. **"Drift detected vs prior baseline"** in `diagnose.tsx` (line ~184) — sounds like a physics experiment
5. **"Plan Binding: BLOCKED"** in dashboard (line ~190) — raw enum state leakage
6. **Mystery numbers in `MetricCard`** — colored bars with no labels are noise, not data
7. **Manual metrics entry in `connect.tsx`** — typing impressions in by hand contradicts the "autonomous AI" promise

### 4.3 Onboarding journey verdict: **NEEDS_WORK**

Path: `intro` → `login` → `upgrade` → `connect` → dashboard.

The gap: after Connect, the user lands on an empty dashboard full of "No data" warnings until they navigate back into `ai-management.tsx` to run the pipeline. The first 30 seconds of post-onboarding feels broken, not magical.

**Recommended fix:** the first dashboard load should be an "initialization" screen that shows pipeline progress until the first full run completes, then transitions into the real dashboard.

---

## 5. Complexity Reduction — Concrete Targets

### 5.1 REMOVE (10 candidates, in priority order)

1. **`DashboardChat` from dashboard** — redundant with dedicated `app/agent.tsx` and `MarketMindAgent`
2. **Manual metrics path** in `connect.tsx` — erodes autonomy promise; if Meta isn't connected, system should say so honestly, not offer a spreadsheet
3. **"Pipeline Flow" arrow visualization** in `ai-management.tsx:367` — 13 connected dots = visual overload
4. **`EnvelopeBadge` operator vocabulary** (`"reused"`, `"incomplete"`) — move to a single `RunTruthfulnessBanner`, drop per-card badges
5. **`MiniChart` unlabeled bars** in `MetricCard` — either label them or remove them
6. **"Checking..." manual refresh on `upgrade.tsx`** — billing status should auto-refresh
7. **"Trial note" duplicate on `login.tsx`** — already covered in intro
8. **"Next Looks" in `diagnose.tsx:149`** — redundant with agent priority action
9. **"Market Intelligence" tab in `ai-management.tsx:397`** — duplicates Diagnose
10. **Watchtower "checked 3m ago" line** — feels like system heartbeat, not marketing signal. Either drop or replace with "no changes since last check"

### 5.2 MERGE (10 candidates)

1. `DashboardChat` + `MarketMindAgent` → one Agent surface
2. `PlanStatus` + `NarrativeCard` → one Strategy card
3. `RequiredWorkCard` + `ExecutionPlan` → one Plan & actions card
4. `WatchtowerStrip` + `ActivityTimeline` → one System Feed
5. `app/diagnose.tsx` + AI-Mgmt intelligence pillar → one Diagnose surface
6. `app/roadmap.tsx` Build + AI-Mgmt Build Plan → one Roadmap surface
7. `OnboardingAgent` + `DashboardChat` → use main agent for onboarding too
8. `BusinessProfile` + `BusinessDataForm` → one editor (delete the duplicate)
9. `EnvelopeBadge` + `RunTruthfulnessBanner` → one integrity banner at top of screen
10. `PlatformPicker` + `PlatformConnection` → one connector list (delete the duplicate)

### 5.3 SPLIT

- `ai-management.tsx` (1792 lines) — split into one file per pillar (Connect / Diagnose / Roadmap / Monitor) + operator-only `OperatorEngineGrid.tsx`
- `index.tsx` (1167 lines) — extract dashboard sections into discrete components for measurability and code review
- `AppContext.tsx` — split into `BrandContext` (profile only) and migrate `campaigns`, `ads`, `platformConnections` to React Query

### 5.4 Hidden information that should surface

- **Why is this number low?** — KPI cards should answer this on tap, sourced from `ael_snapshots.root_causes`
- **What changed since yesterday?** — ActivityTimeline is the place, but it should default-expand the last 24h
- **Why is this DEGRADED?** — currently shown as a color, never a sentence
- **What is the AI doing right now?** — perception layer has this data, no surface exposes it as a live indicator

---

## 6. Frontend Architecture Findings

### 6.1 State / context

| Provider | Owns | Verdict |
|---|---|---|
| `AppContext` | ~15 disparate pieces (brandProfile, campaigns, ads, platformConnections, advancedMode, …) | **P1 — bloated.** One `useMemo` re-renders the whole tree on any change. |
| `AuthContext` | identity, JWT, refresh; calls `queryClient.clear()` on logout/switch | **good** |
| `CampaignContext` | `selectedCampaignId`; calls `queryClient.clear()` on switch | **good but heavy.** "Hammer" approach forces full refetch. |
| `CreativeContext` | competitor snapshot data; clears on identity change | **good** |
| `LanguageContext` | i18n | **stable** |
| `OnboardingContext` | onboarding step | **stable** |

**Provider order in `app/_layout.tsx`:** `QueryClientProvider` → `LanguageProvider` → `AuthProvider` → … — correct.

### 6.2 Query layer

- Single `QueryClient` from `lib/query-client.ts`, default `staleTime` 5 minutes. Good.
- Default fetcher handles JWT via `SecureStore`. Good.
- **Polling inconsistency:** perception hooks 5min; `useRunAnchor` 10s; `PlanStatus` 10s; `RequiredWorkCard` 15s. None pause on `AppState` background — **P2 battery drain.**
- **Cache overlap:** `index.tsx` manually invalidates `['/api/plans/active', cid]` while `PlanStatus.tsx` also fetches the same key. Reorganize so one is the owner.

### 6.3 Operator gating coverage

- `useOperatorSurface()` consistently applied across the 5 main engine components (positioning, awareness, persuasion, statistical_validation, plus the 4-pillar collapse) after the pre-beta fixes
- **2 residual leaks (P1):**
  - `app/diagnose.tsx:~162, ~176` — "Audience" / "Positioning" pills ungated
  - `components/StrategyHub.tsx:~420` — "Retention" pill ungated
- The `app/(tabs)/_ai-management-operator-labels.ts` file is correctly data-only — but the Expo Router default-export warning in the browser console suggests it's being treated as a route. Either rename to `.data.ts` or move outside `app/`.

### 6.4 Loading / error / empty / stale states

- Most components have `isLoading`. Many lack explicit empty-state illustrations (`MonitoringCard`, `ActivityTimeline` show bare containers).
- **Silent error swallowing (P1, violates Seal #15 spirit on the client):**
  - `lib/query-client.ts:~9, ~82` — caught errors logged to console, never surfaced
  - `AuthContext.tsx:~156` — caught errors result in infinite spinner

### 6.5 Hardcoded strings bypassing i18n

- `ai-management.tsx:~1013` ("Campaign Metrics Mode") and several pills in `StrategyHub.tsx` skip `lib/translations/`. Breaks the 32 already-translated languages for non-English customers.

### 6.6 Performance smells

- `AppContext` value `useMemo` (line ~357) — single property change re-renders entire tree
- `ActivityTimeline` uses `ScrollView` — fine for now, will need `FlatList` windowing if event count grows

---

## 7. Beta UX Readiness — Final Verdict

### Polished (ready for any beta cohort)
- VideoEditor / Studio flow
- Roadmap segmented control
- Diagnose narrative section
- Auth/login/upgrade flows
- Perception layer's fail-closed translator architecture

### Internal-feeling (don't ship to broad beta as-is)
- Dashboard density (12+ cards, 3 chat surfaces, 20+ numbers)
- Customer-mode 13-engine flat list
- EnvelopeBadge operator vocabulary
- "Shadowed" / "System Untrusted" / "BLOCKED" enum leaks
- Manual metrics fallback in Connect

### Prototype-level (needs redesign before any external eyes)
- The initial-load empty dashboard state ("No data" warnings everywhere)
- The Pivot tab (purpose unclear)
- The Monitor tab (overlaps Watchtower; needs distinct purpose or operator-gate)

### What will users love (preserve at all costs)
- The 5-step strategic narrative
- The VideoEditor "AI-Powered" experience
- The agent priority action
- The Diagnose "what's blocking conversion" framing

### What will hurt retention most
- Dashboard cognitive overload causing bounce on first visit
- The post-onboarding empty-dashboard moment
- Three competing AI surfaces causing decision paralysis

---

## 8. Recommended Next Sprint

In priority order, the minimum work needed before opening broader beta:

| # | Task | Effort | Impact |
|---|---|---|---|
| 1 | Collapse dashboard from 14 → 6 cards | M | unblocks broad beta |
| 2 | Unify 3 chat surfaces into one Agent slot | M | reduces decision paralysis |
| 3 | Replace 13-engine customer list with 4 grouped accordions | M | makes the 4-pillar promise real |
| 4 | Add `useOperatorSurface()` to `diagnose.tsx` + `StrategyHub.tsx` | XS | closes residual leak |
| 5 | Rename `_ai-management-operator-labels.ts` → `.data.ts` or move out of `app/` | XS | kills router warning |
| 6 | Add explicit `console.error` + UI toast on the 3 silent client catches (`AuthContext`, `query-client.ts`) | S | parity with server Seal #15 doctrine |
| 7 | Build "initialization screen" for the post-onboarding empty state | M | turns the worst moment into a win |
| 8 | Replace "Shadowed" / "Untrusted" / "BLOCKED" enum strings via `presentRunTruthfulness()` for ALL surfaces | S | trust |
| 9 | Surface `dataSource` distinction (verified vs manual vs projected) on KPI cards | S | trust |
| 10 | Migrate `AppContext` campaigns/ads/platformConnections → React Query | L | architecture cleanup; can defer |
| 11 | Add `AppState` listener to pause polling when backgrounded | S | battery |
| 12 | Delete 3 orphaned components (`AdPreview`, `BusinessDataForm`, `PlatformPicker`) | XS | hygiene |

**1–9 are sufficient for opening controlled beta.** 10–12 are post-beta hygiene.
