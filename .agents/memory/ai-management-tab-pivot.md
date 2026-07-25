---
name: AI Control Center tab pivot history
description: Why the ai-management screen's tab bar was reverted from the 4-screen pivot naming back to explicit tabs.
---

`app/(tabs)/ai-management.tsx` had two competing tab-bar layouts gated by `operator.enabled` (from `useOperatorSurface()`):
- Operator builds: 8 explicit tabs — Build Plan, Pipeline, Intelligence, Strategies, Control, Market DB, Publish, Audience.
- Customer builds: a "4-screen pivot" that renamed/collapsed the same destinations into Connect/Diagnose/Roadmap/Monitor (e.g. "Roadmap" routed to the `buildplan` key, "Diagnose" to `intelligence`).

The user explicitly asked to have "Build Plan" and "Strategy (with all engines)" restored as their own clearly-labeled sections rather than folded into generic pivot names. Fix: removed the operator/customer ternary so everyone sees the full 8-tab explicit list; per-tab content rendering (which still differs by `operator.enabled` for some tabs, e.g. OrchestratorPanel vs ExecutionPlan) was left unchanged.

**Why:** the pivot taxonomy was a customer-vocabulary simplification (Task #71/#72 doctrine), but it also hid navigational entry points the user wanted visible again. If a future request references "Connect/Diagnose/Roadmap/Monitor" screens or asks to re-simplify the tab bar, know this history exists in git log (commits `340fbed` pivot taxonomy, `0f80c74`/`5e009ee` perception layer/dashboard simplification — unrelated to this tab-bar change, that's the Dashboard screen not AI Control Center).

**How to apply:** if the customer-facing pivot naming needs to come back, reintroduce the ternary in `app/(tabs)/ai-management.tsx`'s tab array using `operator.enabled` from `useOperatorSurface()` — don't reinvent the mapping, it's in git history at commit `340fbed` and earlier.
