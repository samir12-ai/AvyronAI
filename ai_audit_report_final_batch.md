# Intelligence Audit Report — Final Batch

**Scope:** Commercial Reasoning + Shared Types + Frontend (37 files)  
**Audited:** June 11, 2026  
**Checks:** Silent catches | Internal error disclosure | Unguarded JSON.parse | Doctrine D1/D3/D5 | Input validation | Unbounded queries | `as any` on canonical paths

---

## 1. Silent Catches (Seal #15 — `} catch {}` / `.catch(() => {})` forbidden)

**Severity: HIGH — 1 finding in scope**

| File | Line | Issue |
|------|------|-------|
| `components/NarrativeCard.tsx` | 59 | `} catch {}` — silent catch on narrative fetch. Fetch failure is silently swallowed, leaving component in `loading=false` with no data. |

**Note:** The `server/commercial-reasoning/metrics.ts` (lines 18-39) try/catch is explicitly documented as a non-silent catch with a `console.error` tag. No other silent catches found in the 37-file scope.

---

## 2. Internal Error Disclosure (Information Leakage)

**Severity: MEDIUM — 4 findings**

| File | Line | Issue |
|------|------|-------|
| `components/BuildThePlan.tsx` | 466-468 | `console.error('[BuildThePlan] generateCreativeBlueprint error:', err);` — full error object logged to console in production. Error also exposed to user via `setError(err.message)` |
| `components/BuildThePlan.tsx` | 628-630 | `console.error('[Validate] Network/fetch error:', err);` — same pattern |
| `components/OfferEngine.tsx` | 167-168 | `console.error('[OfferEngine] Fetch error:', err);` — full error object logged |
| `components/OfferEngine.tsx` | 182-184 | `console.error('[OfferEngine] Strategy root fetch error:', err);` — same pattern |

**Note:** These logs disclose internal error details (stack traces, API error responses) to the browser console in production. If the app is deployed, these logs could leak internal implementation details.

---

## 3. Unguarded JSON.parse

**Severity: MEDIUM — 0 findings**

All `JSON.parse` calls in the 37-file scope are guarded:

| File | Line | Handling |
|------|------|----------|
| `server/commercial-reasoning/llm-call.ts` | 102-106 | Throws typed `CommercialReasonerJsonParseError` on failure |
| `server/commercial-reasoning/business-context-layer.ts` | 439-441 | Logs failure with `console.error` and returns `null` |
| `components/BuildThePlan.tsx` | 2015 | `try/catch` — returns `null` on failure |
| `components/AudienceEngine.tsx` | 135 | `try/catch` — returns raw string on failure |
| `server/shared/strategy-root.ts` | 411-413 | `try/catch` — returns `null` on failure |
| `server/shared/signal-lineage.ts` | 206-213 | `try/catch` — returns `[]` on failure |
| `server/shared/multi-source-loader.ts` | 33-35 | `try/catch` — returns fallback on failure |
| `server/shared/snapshot-trust.ts` | 129-132 | `try/catch` — non-empty catch |
| `server/shared/snapshot-trust.ts` | 143-152 | `try/catch` — non-empty catch |

---

## 4. Doctrine D1/D3/D5 Violations

**Severity: CLEAN — 0 findings**

**D1 — No semantic fallback (`?? status`, `|| verdict` forbidden):**
- No violations. The `perception-translator.ts` returns `null` for unknown inputs (fail-closed, not silent substitution).

**D3 — Strict `z.enum()` for every verdict-shaped field:**
- All contract schemas use `z.enum()` exclusively:
  - `shared/contracts/signal.ts`: `LaneSchema = z.enum(LANE)`, `SignalType = z.enum(...)`
  - `shared/contracts/change-event.ts`: `ChangeSeverity = z.enum(["mild", "medium", "major"])`
  - `shared/contracts/dna.ts`: `DnaStatus = z.enum(["proposed", "active", "paused", "retired"])`
  - `shared/contracts/cluster.ts`: `ClusterEvaluationStatus = z.enum(["pending", ...])`
  - `server/commercial-reasoning/contract.ts`: `depthAssessment: z.enum(["shallow", "developing", "substantive", "deep"])`, `buyer_state: z.enum(["unaware", ...])`, `signalOrigin: z.enum(["real", "competitor", "inferred", "fallback", "unknown"])`

**D5 — Missing canonical -> CONTRACT_INCOMPLETE:**
- `server/commercial-reasoning/contract.ts` `reasoner_self_assessment` includes `"insufficient_evidence"` and `"contradiction_unresolved"` — both explicitly handled as degradation signals
- `server/commercial-reasoning/awareness-depth-interpreter.ts` returns `FellBackTo` enum on reasoner failure — no silent fallback

---

## 5. Input Validation

**Severity: MEDIUM — 3 findings**

| File | Line | Issue |
|------|------|-------|
| `server/commercial-reasoning/business-context-layer.ts` | 1020-1054 | `loadStage2SnapshotsFor` uses `table as any` for dynamic table queries. No runtime validation that `table` is a valid schema table |
| `server/commercial-reasoning/business-context-layer.ts` | 1155-1191 | `loadStage3SnapshotsFor` — same pattern as above |
| `server/commercial-reasoning/business-context-layer.ts` | 430-442 | `safeJsonParse<T>` uses `JSON.parse` with `as T` cast. No validation that parsed shape matches `T` |

---

## 6. Unbounded Queries

**Severity: MEDIUM — 2 findings**

| File | Line | Issue |
|------|------|-------|
| `server/commercial-reasoning/business-context-layer.ts` | 1099-1110 | `loadEngineSnapshot` queries `table as any` with `.limit(1)` but no account/campaign filter in `jobScoped` branch — could match any row with same `jobId` |
| `server/commercial-reasoning/business-context-layer.ts` | 1156-1167 | Same pattern in `loadStage3SnapshotsFor` — `jobScoped` branch lacks `accountId`/`campaignId` filter |

**Note:** The `jobScoped` branch is only used when `jobId` is explicitly provided. The `latest` branch (fallback) includes `accountId` and `campaignId` filters. However, the `jobScoped` branch is potentially unbounded if `jobId` is not unique across tenants.

---

## 7. `as any` on Canonical Paths

**Severity: HIGH — 15+ findings (some concerning, some harmless)**

### Server-side (concerning)

| File | Line | Issue |
|------|------|-------|
| `server/commercial-reasoning/business-context-layer.ts` | 800 | `(next as any)[proposal.field] = proposal.value` — dynamic field assignment on `BusinessProfile` |
| `server/commercial-reasoning/business-context-layer.ts` | 809 | `(next as any)[proposal.field]` — dynamic field read |
| `server/commercial-reasoning/business-context-layer.ts` | 816 | `(next as any)[proposal.field]` — dynamic field read |
| `server/commercial-reasoning/business-context-layer.ts` | 1100 | `table as any` — dynamic table query |
| `server/commercial-reasoning/business-context-layer.ts` | 1102-1109 | `table as any` x4 — field access in dynamic query |
| `server/commercial-reasoning/business-context-layer.ts` | 1128-1133 | `table as any` x6 — snapshot table loading |
| `server/commercial-reasoning/business-context-layer.ts` | 1136 | `as any` x6 — return type casting |
| `server/commercial-reasoning/business-context-layer.ts` | 1158-1178 | `table as any` x6 — Stage 3 snapshot loading |
| `server/shared/strategy-root-assembler.ts` | 48 | `{ ... } as any` — return type |
| `server/shared/strategy-root-assembler.ts` | 52-54 | `(audience as any)` x3 |
| `server/shared/strategy-root-assembler.ts` | 60-61 | `(audience as any)` x2 |
| `server/shared/strategy-root-assembler.ts` | 64 | `(audience as any)` x1 |
| `server/shared/strategy-root-assembler.ts` | 128 | `(audienceOverride as any)` x1 |
| `server/shared/strategy-root.ts` | 312-340 | `(result as any)?.rowCount` x3 — DB result row count |
| `server/shared/engine-health.ts` | 177-178 | `(lineage as any[])` x2, `(e as any)` x2 |

### Shared (defensive)

| File | Line | Issue |
|------|------|-------|
| `shared/commercial-dna.ts` | 240-245 | `(s as any).mechanism`, `(s as any).transferMechanism` — defensive field extraction from commercial signals |
| `shared/commercial-dna.ts` | 250 | `(s as any)` — defensive field extraction |

### Frontend (concerning — bypass SynthesizedPlan contract)

| File | Line | Issue |
|------|------|-------|
| `components/BuildThePlan.tsx` | 895 | `const sections: any = (plan as any)?.sections` — plan parsing |
| `components/BuildThePlan.tsx` | 1013 | `const raw = (plan as any)?.sections?.validationState` — plan validation state |
| `components/PlanDocumentView.tsx` | 896 | `const sections: any = (plan as any)?.sections` — same pattern |
| `components/PlanDocumentView.tsx` | 1013 | `const raw = (plan as any)?.sections?.validationState` — same pattern |
| `components/CompetitiveIntelligence.tsx` | 150-152 | `(cachedSnapshot as any)` x2 |
| `app/(tabs)/ai-management.tsx` | 563 | `ae as any` — audience engine data |

### Frontend (harmless — Ionicons icon names)

| File | Line | Issue |
|------|------|-------|
| `components/ControlCenter.tsx` | 337 | `icon as any` |
| `components/ControlCenter.tsx` | 456 | `gateIcon(g.status) as any` |
| `components/StrategyHub.tsx` | 41 | `icon as any` |
| `components/AwarenessEngine.tsx` | 332 | `icon as any` |
| `components/PositioningStrategy.tsx` | 365 | `icon as any` |
| `components/PlanDocumentView.tsx` | 267 | `icon as any` |
| `components/PlanDocumentView.tsx` | 319 | `icon as any` |
| `components/PlanDocumentView.tsx` | 1035 | `icon as any` |
| `components/StatisticalValidationEngine.tsx` | 435 | `icon as any` |
| `components/PersuasionEngine.tsx` | 655 | `icon as any` |
| `components/VideoEditorContent.tsx` | 399 | `icon as any` |
| `components/VideoEditorContent.tsx` | 426 | `icon as any` |
| `app/(tabs)/studio.tsx` | 496 | `icon as any` |
| `app/(tabs)/studio.tsx` | 723 | `icon as any` |

### Frontend (harmless — React Native style props)

| File | Line | Issue |
|------|------|-------|
| `components/StrategyHub.tsx` | 447 | `marginLeft: 'auto' as any` |
| `components/StrategyHub.tsx` | 996 | `minWidth: '22%' as any` |
| `components/StrategyHub.tsx` | 1409 | `minWidth: '22%' as any` |
| `components/AwarenessEngine.tsx` | 567 | `minWidth: '46%' as any` |
| `components/PositioningStrategy.tsx` | 492 | `maxWidth: '48%' as any` |
| `components/PlanDocumentView.tsx` | 1095 | `marginLeft: 'auto' as any` |
| `components/PlanDocumentView.tsx` | 1110 | `marginLeft: 'auto' as any` |
| `components/StatisticalValidationEngine.tsx` | 893 | `width: '30%' as any` |
| `components/PersuasionEngine.tsx` | 893 | `width: '30%' as any` |
| `app/(tabs)/index.tsx` | 1016 | `height: '100%' as any` |

### Frontend (other harmless)

| File | Line | Issue |
|------|------|-------|
| `app/(tabs)/settings.tsx` | 530 | `code as any` — locale code |
| `app/(tabs)/studio.tsx` | 982 | `colors as any` — colors type |
| `app/(tabs)/create.tsx` | 710 | `as any` — form data append |
| `app/(tabs)/create.tsx` | 913 | `as any` — form data append |
| `app/(tabs)/create.tsx` | 1155 | `fileInfo as any` — file info |
| `app/(tabs)/create.tsx` | 2635 | `as any` — video style |
| `app/(tabs)/photography.tsx` | 194 | `as any` — form data append |
| `app/(tabs)/calendar.tsx` | 168 | `pathname as any` — router pathname |
| `components/BuildThePlan.tsx` | 97 | `PHASE_ICONS: any[]` — array of any |

---

## 8. Additional Findings

**Frontend error exposure in `app/(tabs)/monitor.tsx`:**
- Line 96-99: `{(error as Error)?.message ?? "Failed to load"}` — if `error` is a React Query error containing an internal server error response, this could leak API error details to the user.

**Frontend `any` interface in `components/AudienceEngine.tsx`:**
- Lines 14-20: `[key: string]: any` on `AwarenessLevelStruct` and `MaturityIndexStruct` interfaces
- Lines 92-100: `audiencePains?: PainItem[] | any` — `any` on interface fields

---

## Summary

| Category | Count in Scope | Severity |
|----------|-------------|----------|
| Silent catches | 1 (`NarrativeCard.tsx:59`) | HIGH |
| Internal error disclosure | 4 (`BuildThePlan.tsx`, `OfferEngine.tsx`) | MEDIUM |
| Unguarded JSON.parse | 0 | — |
| D1/D3/D5 violations | 0 | — |
| Input validation gaps | 3 (`business-context-layer.ts`) | MEDIUM |
| Unbounded queries | 2 (`business-context-layer.ts`) | MEDIUM |
| `as any` on canonical paths | 15+ (mostly harmless, some concerning) | HIGH (plan parsing) |

---

## Priority Recommendations

1. **Fix `components/NarrativeCard.tsx` line 59** — the silent catch is a direct Seal #15 violation. Replace with `console.error` or a visible error state.

2. **Fix `server/commercial-reasoning/business-context-layer.ts` dynamic table queries** — the `as any` casts on Drizzle table references and the lack of `accountId`/`campaignId` filters in the `jobScoped` branch are the most concerning server-side issues.

3. **Fix `components/BuildThePlan.tsx` and `components/PlanDocumentView.tsx` plan parsing** — the `as any` casts on plan parsing bypass the `SynthesizedPlan` type contract. Use a Zod schema or a typed guard instead.

4. **Review frontend error logging** — the `console.error` calls in `BuildThePlan.tsx` and `OfferEngine.tsx` should be gated to development-only or redacted in production.
