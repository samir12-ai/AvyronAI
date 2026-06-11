# Intelligence Audit Report — Replay Harness + Analytical & Causal Layers (34 files)

**Scope:** 34 files across Replay Harness (20), Analytical & Causal Layers (14)  
**Audited:** June 11, 2026  
**Checks:** Silent catches | Internal error disclosure | Unguarded JSON.parse | Doctrine D1/D3/D5 | Input validation | Unbounded queries | `as any` on canonical paths

---

## 1. Silent Catches (Seal #15 — `} catch {}` / `.catch(() => {})` forbidden)

**Severity: CLEAN — 0 findings**

All 34 files in this batch were searched. No bare/empty catch blocks found.

- Every catch block in the replay harness contains a `logger.error` or `logger.warn` call
- `server/analytical-enrichment-layer/engine.ts` line 328: `catch (err: any) { console.error(...); }` — non-empty, tagged with `LOG_PREFIX`
- `server/engine-hardening/index.ts` line 305: `catch (error: any) { console.error(...); }` — non-empty, tagged with `[SnapshotPruning]`

---

## 2. Internal Error Disclosure (Information Leakage)

**Severity: MEDIUM — 3 findings**

| File | Line | Issue |
|------|------|-------|
| `server/analytical-enrichment-layer/routes.ts` | 106-107 | `return res.status(500).json({ error: err.message });` — `err.message` from uncontrolled errors is exposed directly to the HTTP response |
| `server/causal-enforcement-layer/routes.ts` | 79-80 | `return res.status(500).json({ error: err.message });` — same pattern as above |
| `server/engine-hardening/index.ts` | 306 | `console.error('[SnapshotPruning] Error pruning snapshots: ${error.message}');` — internal error disclosed to server logs (acceptable since logs are operator-facing, not user-facing) |

**Note:** The `console.error` in `server/analytical-enrichment-layer/engine.ts` (line 330) and `server/analytical-enrichment-layer/consumer-guard.ts` (line 28) are all tagged with module prefixes and are safe (operator-facing, not user-facing).

---

## 3. Unguarded JSON.parse

**Severity: MEDIUM — 2 findings**

| File | Line | Issue |
|------|------|-------|
| `server/analytical-enrichment-layer/routes.ts` | 84 | `JSON.parse(miSnapshot.result)` — no try/catch around the parse. If the DB `result` string is malformed JSON, the route will throw a 500 error to the client |
| `server/analytical-enrichment-layer/engine.ts` | 305 | `const parsed = JSON.parse(jsonMatch[0]);` — no try/catch around the parse. If the LLM returns malformed JSON (even after regex matching), the engine throws a 500 error with `err.message` exposed to the client |

**Note:** All other JSON.parse calls in the 34-file scope are absent (no JSON.parse in replay harness, CEL types, signal-governance, engine-hardening types, or engine-contracts).

---

## 4. Doctrine D1/D3/D5 Violations

**Severity: CLEAN — 0 findings**

**D1 — No semantic fallback (`?? status`, `|| verdict` forbidden):**
- No violations in the 34-file scope. All status/verdict fields use explicit enum values or fail-closed with `null`.

**D3 — Strict `z.enum()` for every verdict-shaped field:**
- All contract schemas in scope use strict enums:
  - `server/analytical-enrichment-layer/types.ts`: `AELPartialReason` is a strict type union (`"EMPTY_ANALYTICAL_PACKAGE" | "AEL_PARSE_FAILURE" | "AEL_BUILD_ERROR"`)
  - `server/causal-enforcement-layer/types.ts`: `ComplianceViolation.violationType` is a strict enum union of 9 values
  - `server/causal-enforcement-layer/types.ts`: `ComplianceResult.verdict` is `z.enum`-equivalent (`"PASS" | "FAIL" | "INCOMPLETE"`)
  - `server/signal-governance/types.ts`: `SignalGovernanceState.coverageSufficient` is a boolean, `coverageReport.missingCategories` is string[]
  - `server/orchestrator/replay/parity/types.ts`: `RoutedAction` is `"NOISE" | "INFO" | "WARN" | "BLOCK"`, `ParityRunOutcome` is a strict union
  - `server/orchestrator/replay/parity/types.ts`: `DivergenceRoutingTable` is `Readonly<Record<DivergenceClass, RoutedAction>>` — no generic string
  - `server/analytical-enrichment-layer/consumer-guard.ts`: `AelAcknowledgement.reason` is `z.enum`-equivalent (`"AEL_OK" | "AEL_MISSING" | "AEL_PARTIAL"`)

**D5 — Missing canonical → CONTRACT_INCOMPLETE:**
- `server/orchestrator/replay/parity/classifier.ts` line 49: `RoutingTableIncompleteError` is explicitly thrown with `CONTRACT_INCOMPLETE` message when a divergence class is missing from the routing table
- `server/orchestrator/replay/parity/classifier.ts` line 77: `if (!action) throw new RoutingTableIncompleteError(d.class);` — no silent fallback
- `server/orchestrator/replay/parity/routes.ts` line 39: Comments explicitly state "D5: missing entries collapse to CONTRACT_INCOMPLETE at classifier time. We DO NOT silently fall back to a hard-coded default"

---

## 5. Input Validation

**Severity: MEDIUM — 2 findings**

| File | Line | Issue |
|------|------|-------|
| `server/analytical-enrichment-layer/routes.ts` | 53 | `const { campaignId } = req.body;` — only a `!campaignId` null check. No `z.string().min(1)` or `z.uuid()` validation. No `typeof campaignId === 'string'` check |
| `server/causal-enforcement-layer/routes.ts` | 20 | `const { campaignId } = req.params;` — no validation of the route parameter. No `z.string().min(1)` or `z.uuid()` check. The `accountId` is resolved from auth but `campaignId` is unvalidated before passing to downstream functions |

**Note:** `server/analytical-enrichment-layer/routes.ts` line 61-62 does validate campaign ownership via `assertCampaignBelongsTo`, but the `campaignId` itself is not schema-validated before reaching the DB query.

---

## 6. Unbounded Queries

**Severity: LOW — 1 finding**

| File | Line | Issue |
|------|------|-------|
| `server/orchestrator/replay/parity/health.ts` | 134-136 | `SELECT MAX(ran_at) AS latest FROM orchestrator_replay_runs WHERE outcome = 'BLOCK'` — no `LIMIT` clause. On a large table with many `BLOCK` outcomes, this query could be expensive but is not a true unbounded result (returns exactly 1 row) |

**Note:** All other queries in scope are bounded:
- `server/analytical-enrichment-layer/routes.ts` line 73: `.limit(1)`
- `server/orchestrator/replay/parity/parity-job.ts` line 103: `LIMIT $1` (configurable, default 50)
- `server/orchestrator/replay/parity/health.ts` line 68: `LIMIT $1` (window size, default 200)
- `server/orchestrator/replay/parity/health.ts` line 82: `GROUP BY` + `LIMIT` (ranked inner query)
- `server/orchestrator/replay/parity/synthetic-capture.ts` line 36: `LIMIT 1`
- `server/orchestrator/replay/parity/path-coverage.ts` line 61: `GROUP BY` with bounded output
- `server/engine-hardening/index.ts` line 287: bounded by `maxRetained` parameter

---

## 7. `as any` on Canonical Paths

**Severity: LOW — 1 finding**

| File | Line | Issue |
|------|------|-------|
| `server/orchestrator/replay/parity/routes.ts` | 39 | `return table as DivergenceRoutingTable;` — casts a `Partial<Record<DivergenceClass, RoutedAction>>` to `DivergenceRoutingTable` (a `Readonly<Record<DivergenceClass, RoutedAction>>`). The cast is necessary because the DB query may not return all 7 divergence classes, but the classifier handles missing entries via `RoutingTableIncompleteError` (D5 enforcement) |

**Note:** All other 34 files in scope are **completely clean** of `as any` casts:
- `server/analytical-enrichment-layer/engine.ts` — 0 casts
- `server/analytical-enrichment-layer/routes.ts` — 0 casts
- `server/analytical-enrichment-layer/types.ts` — 0 casts
- `server/analytical-enrichment-layer/consumer-guard.ts` — 0 casts
- `server/causal-enforcement-layer/engine.ts` — 0 casts
- `server/causal-enforcement-layer/routes.ts` — 0 casts
- `server/causal-enforcement-layer/types.ts` — 0 casts
- `server/causal-enforcement-layer/claim-classifier.ts` — 0 casts
- `server/signal-governance/engine.ts` — 0 casts
- `server/signal-governance/constants.ts` — 0 casts
- `server/signal-governance/types.ts` — 0 casts
- `server/engine-hardening/index.ts` — 0 casts
- `server/engine-hardening/types.ts` — 0 casts
- `server/engine-contracts.ts` — 0 casts
- `server/orchestrator/replay/recorder.ts` — 0 casts
- `server/orchestrator/replay/player.ts` — 0 casts
- `server/orchestrator/replay/diff.ts` — 0 casts
- `server/orchestrator/replay/hash.ts` — 0 casts (only `value as Record<string, unknown>` inside a pure function, not a canonical path)
- `server/orchestrator/replay/redaction.ts` — 0 casts (only `value as unknown as T` for redaction recursive type, not a canonical path)
- `server/orchestrator/replay/types.ts` — 0 casts
- `server/orchestrator/replay/cv13-metrics.ts` — 0 casts
- `server/orchestrator/replay/llm-strict-mock.ts` — 0 casts
- `server/orchestrator/replay/parity/index.ts` — 0 casts
- `server/orchestrator/replay/parity/classifier.ts` — 0 casts
- `server/orchestrator/replay/parity/cv15-metrics.ts` — 0 casts
- `server/orchestrator/replay/parity/divergence-attribution.ts` — 0 casts
- `server/orchestrator/replay/parity/health.ts` — 0 casts
- `server/orchestrator/replay/parity/parity-job.ts` — 0 casts
- `server/orchestrator/replay/parity/path-coverage.ts` — 0 casts
- `server/orchestrator/replay/parity/scheduler.ts` — 0 casts
- `server/orchestrator/replay/parity/synthetic-capture.ts` — 0 casts
- `server/orchestrator/replay/parity/types.ts` — 0 casts

---

## 8. Additional Findings

### 8.1 `any` Types in AEL Input Interface

| File | Line | Issue |
|------|------|-------|
| `server/analytical-enrichment-layer/types.ts` | 104-107 | `AELInput` interface fields `mi: any`, `audience: any`, `productDNA: any | null`, `competitiveData?: any` — all typed as `any`. These are inputs from upstream engines with no type safety at the boundary. The `any` types propagate throughout AEL downstream |

**Note:** This is a **design decision**, not a bug. The AEL engine accepts arbitrary upstream engine outputs. However, it means the AEL input boundary is not type-safe and any upstream engine change could silently break downstream consumers.

### 8.2 `any` in Consumer-Guard Provenance Mutation

| File | Line | Issue |
|------|------|-------|
| `server/analytical-enrichment-layer/consumer-guard.ts` | 43 | `const r = result as Record<string, unknown>;` — casts a generic object to a mutable record for provenance mutation |
| `server/analytical-enrichment-layer/consumer-guard.ts` | 64 | `const r = result as Record<string, unknown>;` — same pattern for partial downgrade |

**Note:** These are acceptable because the functions are intentionally mutating the result object for provenance tracking. The `as Record<string, unknown>` is safer than `as any` because it constrains the value type to `unknown`.

### 8.3 `any` in Engine-Hardening Pruning Function

| File | Line | Issue |
|------|------|-------|
| `server/engine-hardening/index.ts` | 276-279 | `db: any, table: any` — the `pruneOldSnapshots` function accepts `db` and `table` as `any` because it is a generic pruning utility that operates on any Drizzle table. The function is internal and not exposed to external callers |

**Note:** This is a generic utility function. The `any` is acceptable because the function is designed to work with any Drizzle table schema. The parameters are passed internally from callers that have the correct types.

### 8.4 `any` in Signal-Governance Engine

| File | Line | Issue |
|------|------|-------|
| `server/signal-governance/engine.ts` | 159, 165 | `o.confidence as number` — confidence value is cast to number after an explicit `typeof o.confidence === "number"` filter on line 152. The `as number` is redundant but safe |

---

## Summary

| Category | Count in Scope | Severity |
|----------|-------------|----------|
| Silent catches | 0 | — |
| Internal error disclosure | 3 (`AEL routes`, `CEL routes`, `engine-hardening`) | MEDIUM |
| Unguarded JSON.parse | 2 (`AEL routes`, `AEL engine`) | MEDIUM |
| D1/D3/D5 violations | 0 | — |
| Input validation gaps | 2 (`AEL routes`, `CEL routes`) | MEDIUM |
| Unbounded queries | 1 (`parity/health.ts`) | LOW |
| `as any` on canonical paths | 1 (`parity/routes.ts`) | LOW |

---

## Priority Recommendations

1. **Fix `server/analytical-enrichment-layer/routes.ts` line 106** — `res.status(500).json({ error: err.message })` exposes internal error details to the client. Replace with a generic error message and log the real error internally.

2. **Fix `server/causal-enforcement-layer/routes.ts` line 79** — same pattern as above.

3. **Fix `server/analytical-enrichment-layer/routes.ts` line 84** — `JSON.parse(miSnapshot.result)` is unguarded. Wrap in a try/catch with a fallback to a controlled error response.

4. **Fix `server/analytical-enrichment-layer/engine.ts` line 305** — `JSON.parse(jsonMatch[0])` is unguarded. Wrap in a try/catch and return a partial result with `AEL_PARSE_FAILURE` reason.

5. **Add input validation** — Both `AEL routes` and `CEL routes` should validate `campaignId` with a `z.string().min(1)` or `z.uuid()` schema before reaching the DB layer.

6. **Fix `server/analytical-enrichment-layer/types.ts` `AELInput` interface** — Replace `any` fields with `unknown` or concrete types for upstream engine outputs. This prevents silent type mismatches across engine boundaries.

---

## Per-File Cleanliness Score

| File | Clean | Notes |
|------|-------|-------|
| `server/orchestrator/replay/recorder.ts` | ✅ | Clean |
| `server/orchestrator/replay/player.ts` | ✅ | Clean |
| `server/orchestrator/replay/diff.ts` | ✅ | Clean |
| `server/orchestrator/replay/hash.ts` | ✅ | Clean |
| `server/orchestrator/replay/redaction.ts` | ✅ | Clean |
| `server/orchestrator/replay/types.ts` | ✅ | Clean |
| `server/orchestrator/replay/llm-strict-mock.ts` | ✅ | Clean |
| `server/orchestrator/replay/cv13-metrics.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/index.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/classifier.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/cv15-metrics.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/divergence-attribution.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/health.ts` | ⚠️ | Unbounded query (line 134) |
| `server/orchestrator/replay/parity/parity-job.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/path-coverage.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/routes.ts` | ⚠️ | `as DivergenceRoutingTable` (line 39) |
| `server/orchestrator/replay/parity/scheduler.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/synthetic-capture.ts` | ✅ | Clean |
| `server/orchestrator/replay/parity/types.ts` | ✅ | Clean |
| `server/analytical-enrichment-layer/engine.ts` | ⚠️ | Unguarded JSON.parse (line 305) |
| `server/analytical-enrichment-layer/routes.ts` | ⚠️ | Error disclosure + JSON.parse + validation gap |
| `server/analytical-enrichment-layer/types.ts` | ⚠️ | `any` fields on AELInput |
| `server/analytical-enrichment-layer/consumer-guard.ts` | ✅ | Clean (safe casts) |
| `server/causal-enforcement-layer/engine.ts` | ✅ | Clean |
| `server/causal-enforcement-layer/routes.ts` | ⚠️ | Error disclosure + validation gap |
| `server/causal-enforcement-layer/types.ts` | ✅ | Clean |
| `server/causal-enforcement-layer/claim-classifier.ts` | ✅ | Clean |
| `server/signal-governance/engine.ts` | ✅ | Clean (safe cast) |
| `server/signal-governance/constants.ts` | ✅ | Clean |
| `server/signal-governance/types.ts` | ✅ | Clean |
| `server/engine-hardening/index.ts` | ⚠️ | Internal error disclosure (line 306) |
| `server/engine-hardening/types.ts` | ✅ | Clean |
| `server/engine-contracts.ts` | ✅ | Clean |
