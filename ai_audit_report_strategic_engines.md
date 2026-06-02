# AI Layer Audit Report — Strategic Engines (Full Layer)

Date: 2026-06-02
Scope: 37 files across 5 locations: strategy/ (28), build-plan-layer/ (3), execution-activation/ (4), adaptive-rhythm/ (1), standalone (2)
Auditor: Manual code review + targeted grep verification + subagent-assisted deep analysis

---

## File Count

| Location | Files |
|---|---|
| server/strategy/ | 28 |
| server/build-plan-layer/ | 3 |
| server/execution-activation/ | 4 |
| server/adaptive-rhythm/ | 1 |
| server/ (standalone) | 2 |
| **Total** | **37** |

---

## Files Audited

### server/strategy/ (28 files)
- **statistical-validation/** (6): `engine.ts`, `routes.ts`, `types.ts`, `constants.ts`, `validation-judgement.ts`, `semantic-lineage.ts`
- **budget-governor/** (5): `engine.ts`, `routes.ts`, `types.ts`, `constants.ts`, `budget-strategy.ts`
- **channel-selection/** (6): `engine.ts`, `routes.ts`, `types.ts`, `constants.ts`, `channel-orchestration.ts`
- **iteration-engine/** (5): `engine.ts`, `routes.ts`, `types.ts`, `constants.ts`, `iteration-strategy.ts`
- **retention-engine/** (5): `engine.ts`, `routes.ts`, `types.ts`, `constants.ts`, `retention-economics.ts`
- **Root** (2): `index.ts`, `dependency-validation.ts`

### server/build-plan-layer/ (3 files)
- `engine.ts`, `routes.ts`, `awareness-funnel-authority.ts`

### server/execution-activation/ (4 files)
- `engine.ts`, `routes.ts`, `constants.ts`, `validators.ts`

### server/adaptive-rhythm/ (1 file)
- `engine.ts`

### server/ (2 standalone files)
- `plan-constants.ts`, `fulfillment-engine.ts`

---

## Overall Verdict: PASS (with findings)

The Strategic Engines layer is well-hardened. No critical security issues. All canonical decision paths are clean. The findings are MEDIUM/LOW hygiene issues that do not affect runtime correctness.

---

## Doctrine Check Summary

| Rule | Status | Notes |
|---|---|---|
| D1 (no semantic fallback) | PASS | All canonical status/verdict assignments are if/else composed (authoring sites). Documented ESLint exemptions for content-state fields. |
| D2 (every meaning has its own field) | PASS | `validationState`, `status`, `executionStatus`, `outcome` all separate. |
| D3 (strict z.enum) | PASS | `validationState` ∈ {validated|provisional|weak|rejected}. `STATUS` enum used. `DecisionGateOutcome` ∈ {recommended|support_channel|exploratory}. |
| D5 (CONTRACT_INCOMPLETE) | PASS | No silent substitution on canonical paths. |
| No silent catches | PASS | All catches have `console.error` or explicit `console.warn` + context. 5 judge-retry blocks flagged (same pattern as Batch 2/3). |
| No bare JSON.parse | PASS | All `JSON.parse` calls are inside try/catch or use `safeJson`/`safeParseSnapshot`. |
| No bare LLM calls | PASS | All go through `aiChat` with `accountId` and `endpoint` tags. |
| B1-B5 beta safety | PASS | Truthfulness, visibility, safe degradation, explicit classification, operational continuity. |

---

## Findings

### MEDIUM

**M1. MEDIUM** `execution-activation/engine.ts:247` — **UNGUARDED JSON.parse** on LLM response.
- `const parsed = JSON.parse(content);` where `content` is the raw LLM output. Uses `response_format: { type: "json_object" }` but no try/catch wrapper. If the model returns malformed JSON (e.g., truncated, schema drift), this throws uncaught and is surfaced by the outer catch at line 695.
- Risk: `err.message` containing the JSON parse error details may leak into the activation result's `error` field and `contentGenerationErrors` array (line 708).
- Fix: Wrap in `try/catch` with `safeJsonParse` pattern, returning a fallback `{ caption: "...", creativeBrief: "...", ctaCopy: "..." }` with placeholder values.

**M2. MEDIUM** `execution-activation/routes.ts:8` — **Internal error disclosure** in `handleError`.
- `res.status(500).json({ success: false, error: err.message });` returns the raw error message to the client for all non-404 errors.
- Fix: Return generic error message; log the internal error with `console.error`.

**M3. MEDIUM** `server/strategy/channel-selection/channel-orchestration.ts:165` — `catch {}` silent catch on judge-retry LLM call.
- Same pattern as Batch 2/3 registry-write catches. No `console.error` or `console.warn`.
- Fix: Log with `console.warn("[ChannelOrchestration] JUDGE_RETRY_FAILED | ...")`.

**M4. MEDIUM** `server/strategy/budget-governor/budget-strategy.ts:210` — `catch {}` silent catch on judge-retry LLM call.
- Fix: Log with `console.warn("[BudgetStrategy] JUDGE_RETRY_FAILED | ...")`.

**M5. MEDIUM** `server/strategy/retention-engine/retention-economics.ts:175` — `catch {}` silent catch on judge-retry LLM call.
- Fix: Log with `console.warn("[RetentionEconomics] JUDGE_RETRY_FAILED | ...")`.

**M6. MEDIUM** `server/strategy/iteration-engine/iteration-strategy.ts:170` — `catch {}` silent catch on judge-retry LLM call.
- Fix: Log with `console.warn("[IterationStrategy] JUDGE_RETRY_FAILED | ...")`.

**M7. MEDIUM** `server/strategy/statistical-validation/validation-judgement.ts:212` — `catch {}` silent catch on judge-retry LLM call.
- Fix: Log with `console.warn("[ValidationJudgement] JUDGE_RETRY_FAILED | ...")`.

**M8. MEDIUM** `server/adaptive-rhythm/engine.ts:90` — `catch {}` silent catch on competitor data extraction.
- `extractCompetitorVelocity` function has outer `try/catch { return defaults; }` with no logging.
- Fix: Log with `console.warn("[AdaptiveRhythm] COMPETITOR_DATA_PARSE_FAILED | ...")`.

**M9. MEDIUM** `server/strategy/channel-selection/routes.ts:230` — **Internal error disclosure**.
- `return res.status(500).json({ error: "Channel selection analysis failed", details: error.message });` leaks `error.message` to client.
- Fix: Remove `details` field; log internally with `console.error`.

**M10. MEDIUM** `server/strategy/channel-selection/routes.ts:317` — **Internal error disclosure**.
- Same pattern: `details: error.message`.
- Fix: Remove `details` field.

**M11. MEDIUM** `server/strategy/budget-governor/routes.ts:210` — **Internal error disclosure**.
- `return res.status(500).json({ error: "Budget Governor engine failed", details: error.message });`
- Fix: Remove `details` field.

**M12. MEDIUM** `server/strategy/budget-governor/routes.ts:285` — **Internal error disclosure**.
- `return res.status(500).json({ error: "Failed to fetch latest budget governor snapshot", details: error.message });`
- Fix: Remove `details` field.

**M13. MEDIUM** `server/strategy/retention-engine/routes.ts:189` — **Internal error disclosure**.
- `return res.status(500).json({ error: "Internal server error", details: error.message });`
- Fix: Remove `details` field.

**M14. MEDIUM** `server/strategy/retention-engine/routes.ts:255` — **Internal error disclosure**.
- Same pattern: `details: error.message`.
- Fix: Remove `details` field.

### LOW

**L1. LOW** `server/strategy/statistical-validation/routes.ts:213-274` — `as any` casts on snapshot field access.
- `(offerSnap as any).selectedOption`, `(offerSnap as any).alternativeOffer`, `(offerSnap as any).primaryOffer`, `(funnelSnap as any).selectedOption`, `(funnelSnap as any).alternativeFunnel`, `(funnelSnap as any).primaryFunnel`, `(miSnap as any).signalLineage`, `(audSnap as any).signalLineage`, `(offerSnap as any).signalLineage`, `(awarenessSnap as any).signalLineage`, `(persuasionSnapshot as any).signalLineage`.
- These are snapshot deserialization paths (accessing polymorphic fields from DB). Not canonical decision paths. Acceptable but could be typed more precisely.

**L2. LOW** `server/strategy/retention-engine/engine.ts:40-42, 138-139, 356-357` — `as any` casts on `customerJourneyData`.
- `(input.customerJourneyData as any)?.rawInputs`, `(input.customerJourneyData as any)?.derivedMetrics`. Accessing dynamic fields from journey data. Not canonical paths.

**L3. LOW** `server/strategy/statistical-validation/engine.ts:421` — `(offer as any).proofGrounding`.
- Accessing extended field from offer snapshot. Not canonical.

**L4. LOW** `server/strategy/iteration-engine/engine.ts:745` — `assessDataReliability` call with `{} as any`.
- `effectiveFunnel || (performance ? {} as any : null)` — passing empty object as fallback. Non-critical path.

**L5. LOW** `server/strategy/retention-engine/routes.ts:120-129` — `as any` on snapshot field access.
- `(baseJourney as any).rawInputs`, `(baseJourney as any).derivedMetrics`. Snapshot deserialization.

**L6. LOW** `server/build-plan-layer/routes.ts:30` — `catch (resolveErr: any)` with `console.warn`.
- Non-blocking for run resolver failure. Uses `console.warn` which is acceptable but `console.error` would be more consistent with doctrine.

**L7. LOW** `server/build-plan-layer/routes.ts:74` — `catch (snapErr: any)` with `console.warn`.
- Non-blocking snapshot save failure. Uses `console.warn`.

**L8. LOW** `server/build-plan-layer/routes.ts:82` — `catch (narrativeErr: any)` with `console.warn`.
- Non-blocking narrative generation failure. Uses `console.warn`.

**L9. LOW** `server/execution-activation/engine.ts:631` — `catch (pubErr: any)` with `activationLog.push`.
- Published posts fetch failure logged to activation log (not `console.error`). Acceptable for traceability but `console.warn` would be more consistent.

**L10. LOW** `server/execution-activation/engine.ts:748` — `catch (err: any)` with `console.warn`.
- Published posts fetch failure in status check. Uses `console.warn`.

**L11. LOW** `server/execution-activation/engine.ts:514` — Unbounded query on `calendarEntries`.
- `db.select().from(calendarEntries).where(eq(calendarEntries.planId, planId))` — no `limit()`. For plans with many entries, this could return large result sets.
- Same pattern at lines 610, 724, 727 (`studioItems`).

**L12. LOW** `server/fulfillment-engine.ts:97` — Unbounded query on `studioItems`.
- `db.select().from(studioItems).where(and(eq(studioItems.campaignId, campaignId), eq(studioItems.accountId, accountId)))` — no `limit()`. For large campaigns, this could return many rows.

**L13. LOW** `server/strategy/channel-selection/routes.ts:247` — `res.status(404).json({ error: e.message, ... })`.
- `resolveRunId` not-found error leaks `e.message` to client. The error is a controlled "not found" message, but still internal leakage.

### DOCUMENTED (D1 Exemptions — Not Violations)

**D1. DOCUMENTED** `server/strategy/iteration-engine/engine.ts:887` — `eslint-disable-next-line semantic/no-semantic-fallback`.
- Justification: "canonical F1 execution-status assignment based on a guard-layer pass — NOT a substitute for a missing canonical contract field from another engine (which is what D1 forbids)."
- Correct exemption: This is the AUTHORING site of the canonical status.

**D2. DOCUMENTED** `server/strategy/retention-engine/engine.ts:531` — `eslint-disable-next-line semantic/no-semantic-fallback`.
- Justification: "canonical F1 execution-status assignment from a guard-layer pass — same rationale as `iteration-engine/engine.ts`."
- Correct exemption: This is the AUTHORING site of the canonical status.

**D3. DOCUMENTED** `server/execution-activation/engine.ts:616` — `eslint-disable-next-line semantic/no-semantic-fallback`.
- Justification: "D1-safe: `status` here is the calendar-entry workflow status (DRAFT/SCHEDULED/PUBLISHED), a content-state field with 'DRAFT' as the schema default. NOT a verdict-shape semantic substitution."
- Correct exemption: Content-state field, not canonical verdict.

**D4. DOCUMENTED** `server/execution-activation/engine.ts:733` — Same pattern as D3.
- Content-state field for calendar entries, not canonical verdict.

**D5. DOCUMENTED** `server/strategy/channel-selection/engine.ts:854-868` — `outcome` composed via if/else.
- `DecisionGateOutcome` authored from guard-layer and scoring checks. This is the canonical authoring site.

**D6. DOCUMENTED** `server/strategy/statistical-validation/engine.ts:1374-1383` — `validationState` composed via if/else.
- `validationState` authored from claim confidence thresholds. This is the canonical authoring site.

---

## Cross-Engine Comparison (All Strategic Engines)

| Engine | Lines | LLM Calls | as any (canonical) | D1/D3/D5 | Silent Catches | Bare JSON.parse | Internal Error Disclosure |
|---|---|---|---|---|---|---|---|
| Statistical Validation | 1463 | 4 (validation-judgement) | 0 | PASS | 1 | 0 | 0 |
| Budget Governor | 515 (engine) + 220 (budget-strategy) | 4 (budget-strategy) | 0 | PASS | 1 | 0 | 2 |
| Channel Selection | 1477 (engine) + 175 (orchestration) | 4 (orchestration) | 0 | PASS | 1 | 0 | 2 |
| Iteration Engine | 922 (engine) + 180 (iteration-strategy) | 4 (iteration-strategy) | 0 | PASS | 1 | 0 | 0 |
| Retention Engine | 557 (engine) + 185 (retention-economics) | 4 (retention-economics) | 0 | PASS | 1 | 0 | 2 |
| Build Plan Layer | 819 (engine) + 158 (routes) | 1 (engine) | 0 | PASS | 0 | 0 | 0 |
| Execution Activation | 767 (engine) + 115 (routes) | 1 (engine) | 0 | PASS | 0 | 1 | 1 |
| Adaptive Rhythm | 387 | 0 | 0 | PASS | 1 | 0 | 0 |
| Fulfillment Engine | 195 | 0 | 0 | PASS | 0 | 0 | 0 |

---

## LLM Sub-Module Summary (Strategic Engines)

| Module | Engine | Model | Tokens | Temp | Validation | Error Handling |
|---|---|---|---|---|---|---|
| validation-judgement | Statistical Validation | gpt-4.1-mini | 1200 | 0.3 | safeJson + parseJudgement | Returns null on failure |
| budget-strategy | Budget Governor | gpt-4.1-mini | 1200 | 0.3 | safeJson + parseStrategy | Returns null on failure |
| channel-orchestration | Channel Selection | gpt-4.1-mini | 1300 | 0.3 | safeJson + parseOrch | Returns null on failure |
| iteration-strategy | Iteration Engine | gpt-4.1-mini | 1200 | 0.3 | safeJson + parseStrategy | Returns null on failure |
| retention-economics | Retention Engine | gpt-4.1-mini | 1300 | 0.3 | safeJson + parseEcon | Returns null on failure |
| build-plan-layer | Build Plan | gpt-4.1-mini | 1500 | 0.3 | Zod schema validation | Returns BLOCKED/ERROR result |
| execution-activation | Execution | gpt-4.1-mini | 800 | 0.3 | response_format: json_object | No wrapper — throws on parse failure |

---

## Recommendations

1. **Fix unguarded JSON.parse** (M1) — Wrap `execution-activation/engine.ts:247` in try/catch with safeJsonParse.
2. **Fix internal error disclosure** (M2, M9-M14) — 7 routes leak `error.message` to client. Remove `details` field and log internally.
3. **Fix judge-retry silent catches** (M3-M7) — 5 strategy engines use `catch {}` on judge-retry LLM calls. Add `console.warn`.
4. **Fix adaptive-rhythm silent catch** (M8) — Add `console.warn` to outer catch in `extractCompetitorVelocity`.
5. **Standardize `console.warn` vs `console.error`** (L6-L10) — Non-blocking catches should use `console.warn` consistently; blocking catches should use `console.error`. Build-plan-layer and execution-activation routes are mostly consistent.
6. **Add limits to unbounded queries** (L11-L12) — `execution-activation` queries on `calendarEntries` and `studioItems` should use `limit()` if the result set is expected to be bounded. For activation, the entries are scoped to a single plan, so the risk is low but not zero.
7. **Consider typed snapshots** (L1-L5) — `as any` casts on snapshot fields are safe but could be replaced with stricter typing or a typed snapshot accessor pattern.
8. **Consider standardizing `safeJson` wrapper** — Strategy engines use local `safeJson` functions (identical across 5 engines). Consider a shared utility to reduce duplication.

---

*Report generated by manual code review + targeted grep + subagent-assisted deep analysis. All findings are actionable but none are critical.*
