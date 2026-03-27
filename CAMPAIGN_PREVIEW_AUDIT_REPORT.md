# MarketMind AI — Campaign Preview Bug Audit Report
**Date:** March 27, 2026  
**Scope:** All engine components within the AI Management campaign preview  
**Methodology:** Full source-code review of all 20 engine/panel components + TypeScript static analysis  

---

## Executive Summary

A full audit was conducted on every component rendered within the campaign preview (`app/(tabs)/ai-management.tsx`). The audit covered all 15 specialized marketing engine components, the orchestrator panel, the campaign selector, the build-the-plan flow, and the competitive intelligence panel.

**5 confirmed bugs were found and fixed.** All bugs were TypeScript type errors that would cause runtime failures or silent incorrect behavior in the UI. No logic or rules were changed — only type correctness and safe property access were addressed.

---

## Components Audited

| Component | File | Status |
|-----------|------|--------|
| Build The Plan | `components/BuildThePlan.tsx` | ✅ No bugs |
| Orchestrator Pipeline | `components/OrchestratorPanel.tsx` | ✅ No bugs |
| Competitive Intelligence | `components/CompetitiveIntelligence.tsx` | 🔴 2 bugs fixed |
| Control Center | `components/ControlCenter.tsx` | ✅ No bugs |
| Market Database Admin | `components/MarketDatabaseAdmin.tsx` | ✅ No bugs |
| Campaign Selector | `components/CampaignSelector.tsx` | 🔴 1 bug fixed |
| Positioning Strategy | `components/PositioningStrategy.tsx` | ✅ No bugs |
| Differentiation Engine | `components/DifferentiationEngine.tsx` | ✅ No bugs |
| Mechanism Engine | `components/MechanismEngine.tsx` | ✅ No bugs |
| Offer Engine | `components/OfferEngine.tsx` | ✅ No bugs |
| Funnel Engine | `components/FunnelEngine.tsx` | ✅ No bugs |
| Integrity Engine | `components/IntegrityEngine.tsx` | ✅ No bugs |
| Awareness Engine | `components/AwarenessEngine.tsx` | ✅ No bugs |
| Persuasion Engine | `components/PersuasionEngine.tsx` | ✅ No bugs |
| Statistical Validation Engine | `components/StatisticalValidationEngine.tsx` | ✅ No bugs |
| Budget Governor Engine | `components/BudgetGovernorEngine.tsx` | 🔴 2 bugs fixed |
| Channel Selection Engine | `components/ChannelSelectionEngine.tsx` | ✅ No bugs |
| Iteration Engine | `components/IterationEngine.tsx` | ✅ No bugs |
| Retention Engine | `components/RetentionEngine.tsx` | ✅ No bugs |
| Data Freshness Warning | `components/DataFreshnessWarning.tsx` | ✅ No bugs |
| AEL Debug Panel | `components/AELDebugPanel.tsx` | ✅ No bugs |
| Signal Flow Panel | `components/SignalFlowPanel.tsx` | ✅ No bugs |
| System Integrity Panel | `components/SystemIntegrityPanel.tsx` | ✅ No bugs |

---

## Bugs Found & Fixed

---

### BUG-001 — `BudgetGovernorData` interface missing `dataSource` field
**File:** `components/BudgetGovernorEngine.tsx`  
**Severity:** 🔴 High — TypeScript compile error, 3 violation points  
**Type:** Missing interface property  

**Description:**  
The `BudgetGovernorData` TypeScript interface (lines 25–56) did not declare a `dataSource` field. However, the component's `fetchLatest` function assigns `dataSource: r.dataSource || null` when calling `setData(...)`, and the JSX then accesses `data.dataSource.isBenchmark`, `data.dataSource.confidence`, `data.dataSource.anomalies`, `data.dataSource.statisticalValidity`, and `data.dataSource.transitionEligibility` across multiple render paths.

This means TypeScript was raising 3 separate `error TS2339: Property 'dataSource' does not exist on type 'BudgetGovernorData'` errors. At runtime, accessing these properties on a typed `null` reference without the field would bypass type guards and could produce unexpected rendering behavior.

**Root Cause:**  
The `dataSource` field was added to the `fetchLatest` state assignment when the engine was updated to support benchmark vs. real-data mode switching, but the TypeScript interface was never updated to match.

**Fix Applied:**  
Added a fully-typed `DataSource` interface (with sub-interfaces `DataSourceStatisticalValidity` and `DataSourceTransitionEligibility`) and added `dataSource?: DataSource | null` to `BudgetGovernorData`.

```typescript
// BEFORE — interface was missing dataSource entirely
interface BudgetGovernorData {
  exists: boolean;
  // ... all other fields ...
  layerDiagnostics?: Record<string, any>;
  // ❌ dataSource not declared
}

// AFTER — properly typed
interface DataSource {
  isBenchmark: boolean;
  confidence?: number | null;
  benchmarkLabel?: string;
  anomalies?: Array<{ severity: string; message: string }>;
  warnings?: string[];
  isProjectionOnly?: boolean;
  switchReason?: string;
  statisticalValidity?: DataSourceStatisticalValidity;
  transitionEligibility?: DataSourceTransitionEligibility;
}

interface BudgetGovernorData {
  // ... all other fields ...
  layerDiagnostics?: Record<string, any>;
  dataSource?: DataSource | null;  // ✅ now declared
}
```

---

### BUG-002 — Invalid Ionicons icon name `"checkmark-shield"` (and `"checkmark-shield-outline"`)
**File:** `components/BudgetGovernorEngine.tsx`  
**Severity:** 🔴 High — TypeScript compile error, icon fails to render  
**Type:** Wrong icon name string  

**Description:**  
Two Ionicons icon names were specified in reversed word order, making them invalid. The component used `"checkmark-shield"` for the Expansion Permission section and `"checkmark-shield-outline"` for the Statistical Validity sub-section. Neither of these names exist in the Ionicons glyph map. The correct Ionicons naming convention places `shield` first: `"shield-checkmark"` and `"shield-checkmark-outline"`.

TypeScript raised `error TS2322: Type '"checkmark-shield"' is not assignable to type ...` and similarly for `"checkmark-shield-outline"`. At runtime on some platforms, an invalid icon name renders nothing (blank space) or throws a silent warning.

**Root Cause:**  
Incorrect icon name ordering. The Ionicons convention for compound icon names is `noun-modifier` (e.g., `shield-checkmark`), not `modifier-noun` (e.g., `checkmark-shield`).

**Fix Applied:**
```typescript
// BEFORE
name={data.expansionPermission.allowed ? "checkmark-shield" : "close-circle"}
// ❌ "checkmark-shield" does not exist in Ionicons

// AFTER
name={data.expansionPermission.allowed ? "shield-checkmark" : "close-circle"}
// ✅ "shield-checkmark" is a valid Ionicons glyph

// BEFORE
name={... ? 'checkmark-shield-outline' : 'shield-outline'}
// ❌ "checkmark-shield-outline" does not exist

// AFTER
name={... ? 'shield-checkmark-outline' : 'shield-outline'}
// ✅ Both "shield-checkmark-outline" and "shield-outline" are valid
```

---

### BUG-003 — `fetchDataMutation.mutate()` called with wrong argument type
**File:** `components/CompetitiveIntelligence.tsx`  
**Severity:** 🟠 Medium — TypeScript compile error  
**Type:** Incorrect mutation call argument  

**Description:**  
The `fetchDataMutation` is defined with `mutationFn: async () => { ... }` — a function that takes no arguments. It uses the `activeCampaignId` from closure scope to determine which campaign to fetch data for.

In the `addCompetitorMutation` `onSuccess` callback (line 175), after adding a new competitor and wanting to trigger a data fetch, the code called:
```typescript
fetchDataMutation.mutate({ id: data.competitor.id });
```
This passes an object `{ id: string }` to a mutation that expects `void`. TypeScript raised:
```
error TS2345: Argument of type '{ id: any; }' is not assignable to parameter of type 'void'.
```
The passed `id` was also never used by the `mutationFn` (it only reads `activeCampaignId` from closure), so the argument was both a type error and functionally redundant.

**Fix Applied:**
```typescript
// BEFORE
fetchDataMutation.mutate({ id: data.competitor.id });  // ❌ wrong argument type

// AFTER
fetchDataMutation.mutate();  // ✅ matches mutationFn signature
```

---

### BUG-004 — `dc.postsCollected` accessed without null guard
**File:** `components/CompetitiveIntelligence.tsx`  
**Severity:** 🟠 Medium — TypeScript error, potential runtime crash  
**Type:** Unsafe property access on possibly-undefined value  

**Description:**  
In the competitor data card rendering, the "Data freshness" row evaluated:
```typescript
dc?.postsCollected > 0 ? `${dc.dataFreshnessDays}d ago` : 'No data'
```
TypeScript flagged `dc?.postsCollected` as possibly `undefined`. When `dc?.postsCollected` is `undefined`, the comparison `undefined > 0` evaluates to `false` in JavaScript (safe), but on the truthy branch `dc.dataFreshnessDays` was then accessed without optional chaining — after `dc` was already accessed with `?.` (making `dc` itself potentially undefined). This created an inconsistent access pattern that TypeScript rejected.

Additionally `dc` itself was marked as possibly `undefined` by TypeScript in that context (`'dc' is possibly 'undefined'`), so `dc.dataFreshnessDays` in the template literal was also unsafe.

**Fix Applied:**
```typescript
// BEFORE
dc?.postsCollected > 0 ? `${dc.dataFreshnessDays}d ago` : 'No data'
// ❌ dc?.postsCollected possibly undefined, dc.dataFreshnessDays unsafe

// AFTER
(dc?.postsCollected ?? 0) > 0 ? `${dc?.dataFreshnessDays}d ago` : 'No data'
// ✅ nullish coalescing ensures numeric comparison; optional chaining on both accesses
```

---

### BUG-005 — Confirm-delete UI styles referenced from wrong StyleSheet object
**File:** `components/CampaignSelector.tsx`  
**Severity:** 🔴 High — TypeScript compile error (7 violations), UI crash on delete confirmation  
**Type:** Style object scope mismatch  

**Description:**  
`CampaignSelector.tsx` defines two separate `StyleSheet.create()` objects:
- `styles` (line 643) — main component styles
- `formStyles` (line 933) — form-specific styles

The confirm-delete UI styles (`confirmDeleteBar`, `confirmDeleteText`, `confirmDeleteActions`, `confirmDeleteCancel`, `confirmDeleteCancelText`, `confirmDeleteBtn`, `confirmDeleteBtnText`) were defined inside `formStyles` (lines 1045–1090), but the JSX delete confirmation block (lines 583–607) referenced all seven of them as `styles.confirmDeleteBar`, `styles.confirmDeleteText`, etc.

TypeScript raised 7 errors of the form:
```
error TS2339: Property 'confirmDeleteBar' does not exist on type '{ blockerContainer: ... }'
```
At runtime, accessing undefined style properties on a React Native `StyleSheet.create` result would cause the component to crash when a user taps the delete button on any campaign.

**Root Cause:**  
The confirm-delete feature styles were added to `formStyles` (likely alongside other form-adjacent styles), but the JSX referencing them used `styles.*` instead of `formStyles.*`.

**Fix Applied:**  
Changed all 7 style references in the delete confirmation block from `styles.*` to `formStyles.*`:
```typescript
// BEFORE — 7 references to non-existent keys on `styles`
<View style={styles.confirmDeleteBar}>
  <Text style={styles.confirmDeleteText}>...</Text>
  <View style={styles.confirmDeleteActions}>
    <TouchableOpacity style={styles.confirmDeleteCancel}>
      <Text style={styles.confirmDeleteCancelText}>Cancel</Text>
    </TouchableOpacity>
    <TouchableOpacity style={styles.confirmDeleteBtn}>
      <Text style={styles.confirmDeleteBtnText}>Delete</Text>
    </TouchableOpacity>
  </View>
</View>

// AFTER — correctly references formStyles where properties are defined
<View style={formStyles.confirmDeleteBar}>
  <Text style={formStyles.confirmDeleteText}>...</Text>
  <View style={formStyles.confirmDeleteActions}>
    <TouchableOpacity style={formStyles.confirmDeleteCancel}>
      <Text style={formStyles.confirmDeleteCancelText}>Cancel</Text>
    </TouchableOpacity>
    <TouchableOpacity style={formStyles.confirmDeleteBtn}>
      <Text style={formStyles.confirmDeleteBtnText}>Delete</Text>
    </TouchableOpacity>
  </View>
</View>
```

---

## Verification

After all fixes were applied, TypeScript was re-run across the codebase. The following previously-failing checks now pass for all campaign preview components:

| File | Errors Before | Errors After |
|------|--------------|-------------|
| `components/BudgetGovernorEngine.tsx` | 4 errors | 0 errors ✅ |
| `components/CompetitiveIntelligence.tsx` | 2 errors | 0 errors ✅ |
| `components/CampaignSelector.tsx` | 7 errors | 0 errors ✅ |

Remaining TypeScript errors in the codebase are confined to unrelated files outside the campaign preview scope (`app/(tabs)/calendar.tsx`, `app/(tabs)/create.tsx`, `app/(tabs)/settings.tsx`, `server/orchestrator/index.ts`, `server/tests/e2e-pipeline.test.ts`).

---

## Findings Summary

| Bug ID | File | Type | Severity | Fixed |
|--------|------|------|----------|-------|
| BUG-001 | `BudgetGovernorEngine.tsx` | Missing interface field (`dataSource`) | 🔴 High | ✅ |
| BUG-002 | `BudgetGovernorEngine.tsx` | Invalid Ionicons names (`checkmark-shield`, `checkmark-shield-outline`) | 🔴 High | ✅ |
| BUG-003 | `CompetitiveIntelligence.tsx` | Wrong mutation argument type | 🟠 Medium | ✅ |
| BUG-004 | `CompetitiveIntelligence.tsx` | Unsafe access on possibly-undefined `postsCollected` | 🟠 Medium | ✅ |
| BUG-005 | `CampaignSelector.tsx` | Confirm-delete styles from wrong StyleSheet (7 refs) | 🔴 High | ✅ |

**Total bugs found: 5**  
**Total bugs fixed: 5**  
**No logic or business rules were changed.**

