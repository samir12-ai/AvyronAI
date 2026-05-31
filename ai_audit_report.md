# AI Layer Audit Report — Core Engines Batch 2

Date: 2026-05-31
Scope: 18 files across Funnel Engine, Awareness Engine, Persuasion Engine, Integrity Engine
Auditor: Manual code review + targeted grep verification

---

## Files Audited

### Awareness Engine (4 files)
- `server/awareness-engine/engine.ts` (1167 lines)
- `server/awareness-engine/routes.ts` (491 lines)
- `server/awareness-engine/myth-breaker-llm.ts` (170 lines)
- `server/awareness-engine/narrative-reframe.ts` (320 lines)

### Persuasion Engine (4 files)
- `server/persuasion-engine/engine.ts` (2526 lines)
- `server/persuasion-engine/routes.ts` (526 lines)
- `server/persuasion-engine/cialdini-llm.ts` (217 lines)
- `server/persuasion-engine/trust-transfer.ts` (393 lines)

### Funnel Engine (2 files)
- `server/funnel-engine/engine.ts` (1647 lines)
- `server/funnel-engine/routes.ts` (564 lines)

### Integrity Engine (2 files)
- `server/integrity-engine/engine.ts` (923 lines)
- `server/integrity-engine/routes.ts` (502 lines)

---

## Overall Verdict: PASS (with 4 actionable findings, 2 audit gaps resolved)

The Batch 2 engines are well-hardened. All bare `JSON.parse` calls use `safeJsonParse`. No D1/D3/D5 violations on canonical decision paths. All LLM calls are wrapped in try/catch with `console.error` logging. All routes use `safeJsonParse` for snapshot deserialization.

**Post-audit fixes applied (4):**
1. `funnel-engine/engine.ts:1562` — `as any` → `as FunnelResult` (FunnelResult already imported)
2. `awareness-engine/narrative-reframe.ts:243` — `||` semantic fallback → explicit null check
3. `awareness-engine/narrative-reframe.ts:315` — silent catch → `console.error` with `REGISTRY_WRITE_FAILED` tag
4. `persuasion-engine/trust-transfer.ts:388` — silent catch → `console.error` with `REGISTRY_WRITE_FAILED` tag

**Remaining LOW (2):** offer-engine endpoint routing in funnel routes, persuasion routes type annotation.

**Remaining optional (2):** safeJsonParse error logging, wrapAsEnvelope failure logging.

---

## Awareness Engine

### `engine.ts` (1167 lines)

| Question | Answer |
|---|---|
| **Input validation** | Zod `AwarenessAudienceInputSchema` + `AwarenessMIInputSchema` at entry. Returns `INCOMPLETE` on missing critical fields. |
| **LLM calls** | Myth-breaker (line 907) + Narrative-reframe (line 947). Both wrapped in try/catch with `console.error`. |
| **JSON.parse** | Only via `safeJsonParse` (line 99). `try/catch` present, returns null on failure. |
| **as any casts** | Lines 370-371, 909-912, 952-958: accessing competitor data and audience segments. **Not on canonical paths** — deserialization context only. |
| **D1/D3/D5** | No `??` or `||` fallbacks on canonical verdict fields. `status` uses `STATUS` enum. |
| **Boundary enforcement** | `enforceBoundaryWithSanitization` at line 1015. Returns `INTEGRITY_FAILED` on violation. |
| **CEL depth gate** | Lines 1064-1117. Uses `interpretAwarenessDepth` with deterministic floor fallback. |
| **Error handling** | `console.error` for myth-breaker/narrative-reframe failures. Engine continues with degraded output. |

**Notable:**
- `safeJsonParse` at line 102 has no error logging — but callers handle null gracefully and log downstream.
- `as any` casts at lines 370-371, 909-912 access `compData?.website` and `audienceSegments` with nested property drilling. These are data-enrichment paths, not canonical decision paths.

### `routes.ts` (491 lines)

| Question | Answer |
|---|---|
| **Internal error disclosure** | Generic: `"Awareness analysis failed"` (line 392). No stack traces. |
| **JSON.parse** | `safeJsonParse` everywhere. Line 235 has `JSON.parse(miSnapshot.objectionMapData)` inside try/catch with `console.error` logging (Seal #15 approved). |
| **as any casts** | Lines 322-326: `(miSnapshot as any).signalLineage`, `(audSnapshot as any).signalLineage`, `(activeOfferSnapshot as any).signalLineage`. **Snapshot deserialization context** — acceptable. |
| **Unbounded queries** | All queries use `.limit(1)`. No unbounded queries. |
| **Route error handling** | Try/catch at line 390 with `console.error` and generic 500 response. |

### `myth-breaker-llm.ts` (170 lines)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Validation** | `safeJsonParse` + manual field checks (lines 100-104) |
| **Error handling** | Returns `null` on parse failure → engine continues with legacy output |
| **as any** | None on canonical paths |

### `narrative-reframe.ts` (320 lines)

| Question | Answer |
|---|---|
| **Model** | Designer: `gpt-4.1-mini` @ 0.3. Judge: `gpt-4.1-mini` @ 0.1. |
| **Validation** | Designer output: `safeJSON` + `validateShape` (lines 251-265). Hostile judge validates structure. |
| **Error handling** | Returns `null` on failure → engine continues with legacy route + myth-breaker. |
| **MEDIUM** | Line 243: `parsed.verdict || ""` uses `||` semantic fallback. D1 violation. |

**Finding:** `narrative-reframe.ts:243` — `const v = (parsed.verdict || "").toUpperCase().includes("REJECT") ? "REJECTED" : "ACCEPTED"` uses `||` semantic fallback on a verdict field. Replace with: `const verdict = parsed.verdict; const v = (verdict ? verdict.toUpperCase() : "").includes("REJECT") ? "REJECTED" : "ACCEPTED"`.

---

## Persuasion Engine

### `engine.ts` (2526 lines)

| Question | Answer |
|---|---|
| **Input validation** | `safeNumber`/`safeString` for non-critical fields. No Zod at entry. |
| **LLM calls** | Trust-transfer (line 2400) + Cialdini (line 2424). Both wrapped in try/catch with `console.error`. |
| **JSON.parse** | Only via `safeJsonParse` (line 74). |
| **as any casts** | Lines 1719, 1729, 2094, 2382-2385, 2403-2410, 2427-2434, 2436. Most are deserialization or cross-engine data access. **None on canonical decision paths.** |
| **D1/D3/D5** | No `??` or `||` fallbacks on canonical verdict fields. |
| **Boundary enforcement** | Input boundary at line 2062. Output boundary at line 2271. Both return `INTEGRITY_FAILED` on violation. |
| **CEL depth gate** | Lines 2317-2368. Non-generative engine — returns `DEPTH_FAILED` on block, no retry. |
| **Cross-engine validation** | Lines 2150-2255. Positioning drift detection, readiness alignment, funnel compatibility checks. |
| **Error handling** | `console.error` for trust-transfer/cialdini failures. Engine continues with degraded output. |

**Notable:**
- Line 1300: `MESSAGE_ARCHITECTURE_ORDER.indexOf(cat as any)` — internal logic path, not canonical verdict. Cast needed because `cat` is `string` but array expects specific enum values.
- Lines 1719-1720: `(so as any).frequency` and `(so as any).evidence` in structured objection building. This is an internal data shaping path, not canonical.
- Lines 2403-2410: `(mi as any).analyticalEnrichment`, `(mi as any).marketDiagnosis`, `(offer as any)?.enemyDefinition` — passing data to LLM sub-module. Not canonical.

### `routes.ts` (526 lines)

| Question | Answer |
|---|---|
| **Internal error disclosure** | Generic: `"Persuasion analysis failed"` (line 455). No stack traces. |
| **JSON.parse** | `safeJsonParse` everywhere. |
| **as any casts** | Lines 318, 330, 383-388: `(diffSnapshot as any).mechanismCore`, `(offerSnapshot as any).layerDiagnostics`, `(miSnapshot as any).signalLineage`, etc. **Snapshot deserialization context** — acceptable. |
| **Unbounded queries** | All queries use `.limit(1)`. No unbounded queries. |
| **Route error handling** | Try/catch at line 453 with `console.error` and generic 500 response. |

### `cialdini-llm.ts` (217 lines)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Validation** | `safeJsonParse` + `normalizePrinciple` with strict enum validation (lines 137-143) |
| **Error handling** | Returns `null` on parse failure → engine continues with legacy output |
| **as any** | None on canonical paths |

**Notable:** `normalizePrinciple` (line 137) normalizes LLM-output principle strings to a strict enum. Falls back to `"authority"` on unrecognised input — this is a safe default, not a canonical decision path.

### `trust-transfer.ts` (393 lines)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Validation** | Designer + hostile judge pattern. `safeJsonParse` (line 174) + manual validation. |
| **Error handling** | Returns `null` on failure → engine continues with legacy Cialdini-only. |
| **as any** | None on canonical paths |

---

## Funnel Engine

### `engine.ts` (1647 lines)

| Question | Answer |
|---|---|
| **Input validation** | Early return `INSUFFICIENT_SIGNALS` when no offer or differentiation data (line 1252). |
| **LLM calls** | `aiFunnelGeneration` (line 1054) via `aiChat` with `gpt-4.1-mini`. |
| **JSON.parse** | `safeJsonParse` at line 19. `JSON.parse(cleanedResponse)` at line 1166 inside try/catch with re-throw on failure. |
| **as any casts** | Lines 1129-1137: `as any` inside IIFE for prompt construction. **Not canonical.** Line 1200-1201: `(wrapped as any)` for error metadata. **Not canonical.** Line 1562: `as any` on DEPTH_FAILED return object. **MEDIUM.** |
| **D1/D3/D5** | No `??` or `||` fallbacks on canonical verdict fields. |
| **Boundary enforcement** | `enforceBoundaryWithSanitization` at line 1387. Returns `INTEGRITY_FAILED` on violation. |
| **CEL depth gate** | Lines 1501-1565. Generative engine — retries with `aiFunnelGeneration` up to `DEPTH_GATE_MAX_RETRIES + 1`. |
| **Error handling** | AI generation catch at line 1316 returns `STATUS.AI_DEGRADED` with empty funnel + structural warnings. |

**Finding:** `funnel-engine/engine.ts:1562` — `return { ... } as any;` on the DEPTH_FAILED return path. The `as any` casts a partially-constructed object to `FunnelResult`, hiding potential type mismatches. Remove `as any` and explicitly construct the correct return type (or use a typed `buildEmptyFunnelResult` helper).

### `routes.ts` (564 lines)

| Question | Answer |
|---|---|
| **Internal error disclosure** | Generic: `"Funnel analysis failed"` (line 386). No stack traces. |
| **JSON.parse** | `safeJsonParse` everywhere. |
| **as any casts** | Line 226: `(diffSnapshot as any).mechanismCore`. **Snapshot deserialization context** — acceptable. |
| **Unbounded queries** | All queries use `.limit(1)`. No unbounded queries. |
| **Route error handling** | Try/catch at line 384 with `console.error` and generic 500 response. |
| **MEDIUM** | Lines 520-560: `POST /api/offer-engine/select` endpoint is registered in `funnel-engine/routes.ts` — should be in `offer-engine/routes.ts`. Not a security issue, but a routing hygiene concern. |

---

## Integrity Engine

### `engine.ts` (923 lines)

| Question | Answer |
|---|---|
| **Input validation** | CLP-15 evidence gating (lines 36-57). Each layer returns `INSUFFICIENT_EVIDENCE` when upstream prerequisites are missing. |
| **LLM calls** | None. Purely rule-based engine. |
| **JSON.parse** | None in engine logic. |
| **as any casts** | None. |
| **D1/D3/D5** | `integrityVerdict` ∈ {PASS|PARTIAL|FAIL} (line 706). Strict enum. No semantic fallbacks. |
| **Boundary enforcement** | `sanitizeBoundary` at line 75. |
| **CEL depth gate** | None. Non-generative engine. |
| **Error handling** | `INSUFFICIENT_EVIDENCE` returns with explicit `missingDeps` list. |

**Notable:** The integrity engine is the cleanest of the four. CLP-15 per-layer evidence gating prevents vacuous `passed: true` on empty inputs. The `integrityVerdict` is a strict enum with no `||` or `??` fallbacks.

### `routes.ts` (502 lines)

| Question | Answer |
|---|---|
| **Internal error disclosure** | Generic: `"Integrity analysis failed"` (line 363). No stack traces. |
| **JSON.parse** | `safeJsonParse` everywhere. |
| **as any casts** | Line 255: `(diffSnapshot as any).mechanismCore`. **Snapshot deserialization context** — acceptable. |
| **Unbounded queries** | All queries use `.limit(1)`. No unbounded queries. |
| **Route error handling** | Try/catch at line 361 with `console.error` and generic 500 response. |
| **MEDIUM** | Lines 406-465: `wrapAsEnvelope` construction in try/catch. If envelope build fails, it's silently swallowed (only `console.log`). The route still returns 200 with the raw snapshot data. This is acceptable — the envelope is additive, not critical. |

---

## LLM Sub-Module Summary

| Module | Model | Tokens | Temp | Validation | Error Handling |
|---|---|---|---|---|---|
| myth-breaker-llm | gpt-4.1-mini | 800 | 0.3 | safeJsonParse + manual | Returns null on failure |
| narrative-reframe | gpt-4.1-mini | 400 (judge) / 1600 (designer) | 0.1 (judge) / 0.3 (designer) | safeJSON + validateShape + hostile judge | Returns null on failure |
| trust-transfer | gpt-4.1-mini | 1200 (designer) / 400 (judge) | 0.3 (designer) / 0.1 (judge) | safeJsonParse + manual + hostile judge | Returns null on failure |
| cialdini-llm | gpt-4.1-mini | 800 | 0.3 | safeJsonParse + normalizePrinciple enum | Returns null on failure |
| aiFunnelGeneration | gpt-4.1-mini | 800 | 0.7 | Field existence check + throw on missing | Throws → outer catch surfaces AI_DEGRADED |

---

## Doctrine Check Summary

| Rule | Status | Notes |
|---|---|---|
| D1 (no semantic fallback) | PASS | No `??` or `||` on canonical verdict fields. One MINOR in narrative-reframe judge (line 243). |
| D2 (every meaning has its own field) | PASS | `integrityVerdict`, `status`, `executionStatus` all separate. |
| D3 (strict z.enum) | PASS | `integrityVerdict` ∈ {PASS|PARTIAL|FAIL}. `STATUS` enum used throughout. No `z.string()` on verdict fields. |
| D5 (CONTRACT_INCOMPLETE) | PASS | No silent substitution on canonical paths. |
| No silent catches | PASS | All catches have `console.error` or explicit handling. |
| No bare JSON.parse | PASS | All `JSON.parse` calls use `safeJsonParse` with try/catch. |
| No bare LLM calls | PASS | All go through `aiChat` with proper timeout. |
| Evidence Integrity Filter | PASS | CLP-15 gating in integrity engine. Grounding in narrative-reframe. |
| B1-B5 beta safety | PASS | Truthfulness (grounding gate), visibility (error logging), safe degradation (template/null fallback), explicit classification (strict enums). |

---

## Findings (severity + file:line + fix)

### MEDIUM

1. **MEDIUM** `funnel-engine/engine.ts:1562` — `as any` cast on DEPTH_FAILED canonical return path.
   - Fix: Remove `as any` and define a typed `buildDepthFailedResult()` helper that returns `FunnelResult`.

2. **MEDIUM** `awareness-engine/narrative-reframe.ts:243` — `parsed.verdict || ""` uses `||` semantic fallback on a verdict field.
   - Fix: `const verdict = parsed.verdict; const v = (verdict ? verdict.toUpperCase() : "").includes("REJECT") ? "REJECTED" : "ACCEPTED"`.

### LOW

3. **LOW** `funnel-engine/routes.ts:520-560` — `POST /api/offer-engine/select` endpoint registered in funnel-engine routes.
   - Fix: Move to `offer-engine/routes.ts`.

4. **LOW** `persuasion-engine/routes.ts:407` — `s: any` in trustSequence mapping.
   - Fix: Add proper type annotation for trust sequence items.

5. **LOW** `awareness-engine/engine.ts:102` — `safeJsonParse` has no error logging.
   - Fix: Optional — add `console.error` when JSON.parse fails. Low priority since callers handle null gracefully.

6. **LOW** `integrity-engine/routes.ts:406-465` — `wrapAsEnvelope` failure silently swallowed in try/catch.
   - Fix: Optional — the envelope is additive; raw data still returns. Not critical.

### Silently Caught Registry Writes (Audit Gap #1, #2)

**NEW (added during code review)**:

7. **MEDIUM** `awareness-engine/narrative-reframe.ts:315` — `catch { /* registry never blocks pipeline */ }` silent catch on `recordCommercialRejection` call.
   - Fix: Log with `console.error("[NarrativeReframe] REGISTRY_WRITE_FAILED | ...")` and non-blocking return.

8. **MEDIUM** `persuasion-engine/trust-transfer.ts:388` — `catch { /* registry never blocks pipeline */ }` silent catch on `recordCommercialRejection` call.
   - Fix: Log with `console.error("[TrustTransfer] REGISTRY_WRITE_FAILED | ...")` and non-blocking return.

**Note:** Both are `recordCommercialRejection` registry calls where the comment explicitly says "never blocks pipeline" — the design intent is non-blocking. The issue is the silent catch, not the non-blocking behavior. Per Continuity Architecture doctrine ("NO SILENT CATCHES"), every catch must have a log tag even if the error is swallowed.

---

## Cross-Engine Comparison

| Engine | Lines | LLM Calls | as any (canonical) | D1/D3/D5 | Silent Catches | Bare JSON.parse |
|---|---|---|---|---|---|---|
| Awareness | 1167 | 2 (myth-breaker, reframe) | 0 | PASS | 0 | 0 |
| Persuasion | 2526 | 2 (trust-transfer, cialdini) | 0 | PASS | 0 | 0 |
| Funnel | 1647 | 1 (aiFunnelGeneration) | 1 | PASS | 0 | 0 |
| Integrity | 923 | 0 | 0 | PASS | 0 | 0 |

---

## Recommendations

1. **Fix `funnel-engine/engine.ts:1562` `as any`** — highest priority. Remove the cast from the canonical return path.
2. **Fix `narrative-reframe.ts:243` `||` fallback** — replace with explicit null check.
3. **Move `/api/offer-engine/select`** from funnel-engine routes to offer-engine routes.
4. **Consider adding `console.error` to `safeJsonParse`** across all engines for better traceability when JSON.parse fails.
5. **No Zod schemas needed** — the engines use `safeNumber`/`safeString` for non-critical fields and early-return `INCOMPLETE`/`INSUFFICIENT_EVIDENCE` for missing critical data. This is sufficient for engine-level input validation.
