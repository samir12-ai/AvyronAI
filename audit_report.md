# Audit Report — Six Engine Modules

Date: 2026-05-24
Scope: 37 files across Audience Engine (6 files), Boss (12 files), Positioning Engine (5 files), Differentiation Engine (4 files), Mechanism Engine (4 files), and Offer Engine (7 files)
Auditor: Architect subagent + manual verification

---

## Part A — Audience Engine Audit

### Files Audited
- `server/audience-engine/engine.ts` (2216 lines)
- `server/audience-engine/routes.ts` (119 lines)
- `server/audience-engine/buyer-psychology.ts` (365 lines)
- `server/audience-engine/sophistication-llm.ts` (227 lines)
- `server/audience-engine/semantic-bridge.ts` (456 lines)
- `server/audience-engine/constants.ts` (597 lines)

### Overall Verdict: FAIL
The module is functionally rich but has multiple high-severity issues around error handling, doctrine compliance, and contract classification.

---

### Finding A1 — CRITICAL: Silent catches violate doctrine
**Severity:** CRITICAL
**Files:**
- `engine.ts:1186` — `catch {}` swallows multi-source loader failure
- `engine.ts:1853` — `catch {}` swallows MI snapshot enrichment failure
- `engine.ts:1927` — `catch {}` swallows opportunity signals parse failure
- `engine.ts:1989` — `catch {}` swallows MI snapshot enrichment retry failure
- `semantic-bridge.ts:327, 332, 341` — swallowed failures hide bridge data/parse faults
- `buyer-psychology.ts:360` — swallowed failure in retry pattern

**Description:** Empty catch blocks (`catch {}`) or catch blocks that only log at console level hide runtime failures. Per the project's doctrine (replit.md §"No silent catches"), every catch must either emit a structured error tag (e.g. `console.error("[AudienceEngine] EVENT_TAG ...")`) or escalate. Silent catches prevent operators from knowing that signal extraction failed, which means the downstream audience profile may be built on incomplete or stale data without any visible alert.

**Impact:** Data integrity degradation. A failed multi-source loader or bridge silently produces lower-confidence results that look normal to downstream consumers.

**Fix:** Replace every `catch {}` with `console.error("[AudienceEngine] SILENT_CATCH_<CONTEXT>", err)` and, where contract-critical, return a degraded/empty result with an explicit warning flag.

---

### Finding A2 — HIGH: Internal error disclosure to API clients
**Severity:** HIGH
**File:** `server/audience-engine/routes.ts:38, 60, 115`

**Description:** Error handlers return raw `err.message` directly in the JSON response body:
```ts
res.status(500).json({ error: err.message });
```
This leaks internal error strings (which may contain table names, file paths, or DB connection details) to API consumers.

**Impact:** Information disclosure. Malicious or accidental callers learn server internals.

**Fix:** Return a generic message (`"Internal server error"`) and log the real `err.message` server-side with a structured trace ID.

---

### Finding A3 — HIGH: Unguarded JSON.parse in `/latest` endpoint
**Severity:** HIGH
**File:** `server/audience-engine/engine.ts:2187-2200`

**Description:** The `getLatestAudienceSnapshot()` function reads persisted blob rows and calls `JSON.parse(...)` on the raw column value with no try/catch. A single malformed persisted row (corruption, partial write, or manual DB edit) will throw an unhandled exception and 500 the `/latest` endpoint, blocking all reads.

**Impact:** Availability risk. One bad row makes the endpoint unusable until manual cleanup.

**Fix:** Wrap `JSON.parse` in a try/catch. On parse failure, log the row ID, skip the malformed row, and continue to the next candidate.

---

### Finding A4 — HIGH: Doctrine D3/D5 violation — ad-hoc status mapping
**Severity:** HIGH
**File:** `server/audience-engine/routes.ts:99-107`

**Description:** The route maps an unvalidated string status to `signalOrigin` using a truthy check:
```ts
signalOrigin: status ? "real" : "unknown"
```
This is stringly typed. Any non-empty string (including a typo like `"reel"`) becomes `"real"`. Per doctrine D3 (strict `z.enum([...])`) and D5 (missing canonical → `CONTRACT_INCOMPLETE`), unknown inputs must be rejected or mapped to an explicit fail-closed value, never silently accepted.

**Impact:** Semantic drift. A downstream consumer sees `"real"` for data that may be corrupted, inferred, or mislabeled.

**Fix:** Use a strict enum mapping with a default to `CONTRACT_INCOMPLETE`:
```ts
const origin = z.enum(["real","competitor","inferred","fallback","unknown"]).safeParse(status);
signalOrigin: origin.success ? origin.data : "CONTRACT_INCOMPLETE";
```

---

### Finding A5 — HIGH: Clean-pipe drift in semantic bridge
**Severity:** HIGH
**File:** `server/audience-engine/semantic-bridge.ts:334-340`

**Description:** The semantic bridge parses quality-gate diagnostics but then discards them:
```ts
qualityGateResults = null;
```
The code falls back to `signal.strength` instead of the verified gate scores. This weakens the Evidence Integrity Filter, because a signal that failed the quality gate may still be propagated downstream with its raw (unverified) strength value.

**Impact:** Evidence integrity violation. Low-quality or synthetic signals may enter the audience profile.

**Fix:** Wire the `qualityGateResults.passedSignalIds` into the downstream filtering logic. Reject signals whose IDs are not in the passed set.

---

### Finding A6 — MEDIUM: Type/contract mismatch on bridged signals
**Severity:** MEDIUM
**Files:**
- `engine.ts:1807-1817`
- `semantic-bridge.ts:6-16`

**Description:** The `BridgedSignal` interface does not declare `frequency`, `evidence`, `evidenceCount`, or `sourceSignals`. The caller in `engine.ts` reads these fields anyway, getting `undefined` and then using default values. This silently loses evidence and provenance fidelity.

**Impact:** Inflated confidence scores because evidence counts default to 0 or synthetic values.

**Fix:** Either add the missing fields to `BridgedSignal` or validate the shape with Zod before consumption.

---

### Finding A7 — MEDIUM: LLM JSON parsing is permissive and non-validated
**Severity:** MEDIUM
**Files:**
- `engine.ts:1238, 1374`
- `buyer-psychology.ts:200-208`
- `sophistication-llm.ts:121-125`

**Description:** Every LLM response path does `JSON.parse(cleaned)` with no schema validation. Malformed arrays, objects with wrong shapes, or prompt-injected content can degrade silently. The `buyer-psychology.ts` file uses a designer+judge retry pattern, but the judge itself accepts by default if parsing succeeds.

**Impact:** Silent degradation of audience segments, targeting hints, or sophistication scores.

**Fix:** Add Zod schemas for each LLM response shape. Reject non-conforming output and retry or fall back with an explicit warning.

---

### Finding A8 — MEDIUM: No request input validation
**Severity:** MEDIUM
**File:** `server/audience-engine/routes.ts:14-15, 45-46`

**Description:** Request fields are cast, not validated:
```ts
const campaignId = req.body.campaignId as string;
```
No Zod or runtime validation. `campaignId` could be a number, null, or an object.

**Impact:** Runtime type errors downstream, potential injection vectors via unsanitized input reaching SQL queries.

**Fix:** Use Zod schema validation at the route entry. Return 400 with explicit validation errors.

---

### Finding A9 — MEDIUM: Duplicate fetch/parse in a single run
**Severity:** MEDIUM
**File:** `server/audience-engine/engine.ts:1915-1927` and `1978-1989`

**Description:** The same MI snapshot row and its `opportunitySignals` JSON blob are fetched and parsed twice in one `runAudienceEngine` call. This is redundant DB IO and JSON parsing.

**Impact:** Wasted CPU and DB load, especially when the blob is large.

**Fix:** Cache the parsed result in a local variable and reuse it.

---

### Finding A10 — MEDIUM: Architecture bloat in engine.ts
**Severity:** MEDIUM
**File:** `server/audience-engine/engine.ts` (~2215 LOC)

**Description:** The file mixes DB IO, signal extraction, bridge merge, LLM prompting, doctrine statusing, and persistence. High coupling raises regression risk and slows targeted testing.

**Impact:** Every change to any sub-component requires understanding the entire file. Unit testing is difficult because there are no clear module boundaries.

**Fix:** Decompose into focused modules: `signal-extractors.ts`, `signal-merge.ts`, `engine-orchestrator.ts`, `persistence.ts`, `result-builder.ts`.

---

### Doctrine Check Summary (Audience Engine)

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | OK on verdict assignment; FAIL on route status mapping |
| D2/D3 (canonical fields, strict enums) | **FAIL** — stringly typed origin, no z.enum |
| D5 (CONTRACT_INCOMPLETE) | **FAIL** — missing canonical silently becomes "real" |
| No silent catches | **FAIL** — 7+ sites |
| No bare LLM calls | OK — calls go through `aiChat` |
| Evidence Integrity Filter | **FAIL** — quality gate results discarded |
| B1-B5 beta safety | **FAIL** — truthfulness/visibility/safe degradation weakened by #1, #2, #4, #5 |

---

## Part B — Boss Module Audit

### Files Audited
- `server/boss/index.ts`
- `server/boss/run.ts` (657 lines)
- `server/boss/policy/market-shift.ts` (470 lines)
- `server/boss/policy/dna-working.ts` (186 lines)
- `server/boss/plan.ts` (43 lines)
- `server/boss/types.ts` (239 lines)
- `server/boss/store.ts` (45 lines)
- `server/boss/eval-hierarchy.ts` (85 lines)
- `server/boss/envelope-to-lane.ts` (141 lines)
- `server/boss/concurrency.ts` (152 lines)
- `server/boss/policy/q1-maturity.ts` (175 lines)
- `server/boss/policy/q2-verdict-harness.ts` (265 lines)

### Overall Verdict: FAIL
The Boss modules are functional but have reliability and compliance gaps that can leave run state inconsistent and mask canonical decision integrity.

---

### Finding B1 — CRITICAL: Permanent `running` row on unhandled exception
**Severity:** CRITICAL
**File:** `server/boss/run.ts:61-587`

**Description:** The `runBoss` function inserts a `boss_runs` row with `status: "running"` at line 67-77, then does all work inside the callback. If any exception is thrown after insertion but before `updateBossRun` at line 564, the row stays `running` forever. There is no outer `try/catch/finally` to finalize the row.

**Impact:** State corruption. The `boss_runs` table accumulates zombie `running` rows. Dashboards and continuity checks see false in-flight status. Operators cannot distinguish a genuinely running job from a crashed one.

**Fix:** Wrap the body of `withCampaignLock` in a `try/catch/finally`:
```ts
try {
  // ... all existing work ...
} catch (err) {
  status = "failed";
  warnings.push(`run_exception:${(err as Error).message}`);
  // always update
  await updateBossRun(bossRunId, { status, execution: JSON.stringify(execution), ... });
  throw err; // re-throw so caller still sees the error
} finally {
  // ensure update happens even on success
}
```

---

### Finding B2 — HIGH: Unbounded `inArray` in Q2 snapshot loader
**Severity:** HIGH
**File:** `server/boss/policy/market-shift.ts:172-223`

**Description:** `loadCompetitorSnapshot` loads all run IDs into an array, then passes them to `inArray(pipelineChangeEvents.runId, runIds)` and `inArray(pipelineSignals.runId, runIds)`. For a busy campaign with hundreds of runs in the 7-day lookback, this can exceed SQL parameter limits or cause memory pressure.

**Impact:** Query failure or server OOM on high-activity campaigns.

**Fix:** Use SQL aggregation/counts directly instead of loading all IDs:
```sql
SELECT severity, COUNT(*) FROM pipeline_change_events
WHERE account_id = ? AND campaign_id = ? AND created_at >= ?
GROUP BY severity;
```

---

### Finding B3 — HIGH: Doctrine D1/D5 — semantic fallback on canonical field
**Severity:** HIGH
**File:** `server/boss/run.ts:378`

**Description:** The code substitutes a missing canonical state:
```ts
evaluationStatus: execution.evaluation_status ?? "no_active_plan"
```
Per doctrine D1, `??` is forbidden on live-decision paths. Per D5, a missing canonical field must produce `CONTRACT_INCOMPLETE`, not a silent default.

**Impact:** Downstream Q1/Q2 policies may receive a fabricated "no_active_plan" when the field was actually absent due to a bug, masking the real issue.

**Fix:** Remove the fallback. Pass `null` or `"CONTRACT_INCOMPLETE"` and let the policy handle the explicit incomplete state.

---

### Finding B4 — HIGH: Doctrine D2/D3 — broad `string | null` on persisted canonical fields
**Severity:** HIGH
**File:** `server/boss/types.ts:127-145`

**Description:** Persisted canonical-like fields are typed as `string | null`:
```ts
q1_inputs: {
  evaluationStatus: string | null;
  truthStatus: string | null;
  rhythmStatus: string | null;
  clusterComparison: string | null;
}
q2_inputs: {
  user: { truthStatus: string | null; ... }
}
```
This allows any string value (including typos or drifted enum values) to be persisted and later loaded. Doctrine D3 requires strict `z.enum([...])` for verdict-shaped fields.

**Impact:** Semantic drift across deployments. A bad write or migration can introduce an invalid verdict string that passes type checking but crashes or misbehaves at runtime.

**Fix:** Replace `string | null` with the exact union types already defined elsewhere (`EvaluationStatus`, `TruthInput`, `RhythmInput`, `ClusterComparisonVerdict`).

---

### Finding B5 — MEDIUM: Unsafe `as any` on live decision inputs
**Severity:** MEDIUM
**Files:** `server/boss/run.ts:472, 497`

**Description:** Two casts bypass type safety:
```ts
clusterComparison: phase6Ctx.q1_inputs.clusterComparison as any,
rhythmStatus: execution.rhythm_status as any,
```
These feed directly into `evaluateQ1`, which expects strict types. The `as any` defeats the compiler's ability to catch mismatched inputs.

**Impact:** Runtime type mismatch in Q1 policy, potentially producing an invalid verdict.

**Fix:** Remove the casts. If the types don't align, fix the source type declaration (`types.ts`) instead of suppressing the error.

---

### Finding B6 — MEDIUM: Unguarded `as unknown as ClusterSignature`
**Severity:** MEDIUM
**File:** `server/boss/run.ts:408`

**Description:** Persisted JSON is cast through `unknown`:
```ts
baseline.clusterSignature as unknown as ClusterSignature
```
If the persisted blob is malformed (wrong shape, missing fields, array instead of object), this will crash at the first property access inside `compareClusters`.

**Impact:** Crash on bad persisted data. No graceful degradation.

**Fix:** Add a Zod schema for `ClusterSignature` and validate before casting. On validation failure, log and skip the comparison.

---

### Finding B7 — MEDIUM: Test harness calls `process.exit()` at top level
**Severity:** MEDIUM
**File:** `server/boss/policy/q2-verdict-harness.ts:262, 264`

**Description:** The harness executes `process.exit(1)` or `process.exit(0)` unconditionally at the end of the file. If this module is ever imported (not just executed directly), it will terminate the host process.

**Impact:** Accidental process termination in test runners, CI pipelines, or dev servers.

**Fix:** Guard the exit:
```ts
if (import.meta.main || process.argv[1] === __filename) {
  // run harness
  process.exit(failed > 0 ? 1 : 0);
}
```

---

### Finding B8 — MEDIUM: Unbounded `limit` in `listBossRuns`
**Severity:** MEDIUM
**File:** `server/boss/store.ts:30-43`

**Description:** The `limit` parameter is passed directly to `.limit(filters.limit ?? 50)` with no clamping. A caller can pass `limit: 1000000` and load the entire table into memory.

**Impact:** Heavy query load, potential OOM, DoS vector.

**Fix:** Clamp the limit to a safe ceiling:
```ts
const safeLimit = Math.min(Math.max(1, filters.limit ?? 50), 500);
```

---

### Finding B9 — MEDIUM: Internal error details logged
**Severity:** MEDIUM
**File:** `server/boss/policy/market-shift.ts:418`

**Description:** Raw corpus error messages are logged:
```ts
console.warn(`[q2] corpus read failed (${code}), falling back to severity buckets:`, msg);
```
`msg` may contain DB connection strings, table names, or schema details.

**Impact:** Internal infrastructure details exposed in logs, which may be forwarded to external logging systems.

**Fix:** Log only the classified `code` and a redacted summary. Keep the full message at `trace` level or strip it.

---

### Finding B10 — MEDIUM: Sequential per-item execution holds lock too long
**Severity:** MEDIUM
**File:** `server/boss/run.ts:94-176`

**Description:** The loop acquires and runs each plan item one at a time. For campaigns with many entities (e.g., 10 competitors + 5 user channels), the lock is held for the entire duration of all acquisitions and lane runs. This increases the chance of zombie eviction and blocks other boss runs.

**Impact:** Concurrency pressure. A long-running plan can block the campaign for minutes.

**Fix:** Consider pre-acquiring all envelopes in parallel (`Promise.all`), then running lanes in parallel where safe, or move the per-item loop outside the lock if lock semantics allow.

---

### Doctrine Check Summary (Boss)

| Rule | Status |
|---|---|
| No silent catches | OK — catch blocks surface warnings/logs |
| No bare LLM calls | OK — none in these files |
| D1 (no semantic fallback) | **FAIL** (#B3) |
| D2/D3 (strict canonical types) | **FAIL** (#B4) |
| D5 (CONTRACT_INCOMPLETE) | **FAIL** (#B3) |
| Security — injection/authz | No direct sinks observed in this slice |

---

---

## Part C — Positioning Engine Audit

### Files Audited
- `server/positioning-engine/engine.ts` (3084 lines)
- `server/positioning-engine/category-game.ts` (341 lines)
- `server/positioning-engine/semantic-collision.ts` (176 lines)
- `server/positioning-engine/routes.ts` (119 lines)
- `server/positioning-engine/constants.ts` (142 lines)

### Overall Verdict: FAIL
The module has solid signal-grounding logic and compression quality scoring, but it has high-severity issues around internal error disclosure, D3/D5 semantic contract violations, and a permissive `validationState` mapping.

---

### Finding C1 — HIGH: Internal error disclosure to API clients
**Severity:** HIGH
**Files:**
- `server/positioning-engine/routes.ts:39`
- `server/positioning-engine/routes.ts:58`
- `server/positioning-engine/routes.ts:115`

**Description:** Error handlers return raw `err.message` directly in the JSON response body:
```ts
res.status(500).json({ error: err.message });
```
This leaks internal error strings (which may contain resolver/DB/provider internals) to API consumers.

**Impact:** Information disclosure. Malicious or accidental callers learn server internals.

**Fix:** Return a generic message (`"Internal server error"`) and log the real `err.message` server-side with a structured trace ID.

---

### Finding C2 — HIGH: D3/D5 semantic contract violation — `validationState` includes "unknown"
**Severity:** HIGH
**File:** `server/positioning-engine/routes.ts:101-106`

**Description:** The `validationState` field is declared as `"validated" | "provisional" | "weak" | "rejected" | "unknown"`. Per doctrine D3, verdict-shaped fields must be strict `z.enum([...])` with NO catch-all. The canonical contract from `replit.md` declares `validationState ∈ {validated|provisional|weak|rejected}` — "unknown" is not a canonical value. Per D5, a missing canonical must produce `CONTRACT_INCOMPLETE`, not a silently tolerated extra enum value.

**Impact:** Semantic drift. A downstream consumer sees `"unknown"` for data that should be explicitly marked as contract-incomplete.

**Fix:** Remove `"unknown"` from the union. Map unmappable states to `null` or an explicit `CONTRACT_INCOMPLETE` flag.

---

### Finding C3 — MEDIUM: Unguarded `JSON.parse` on LLM output
**Severity:** MEDIUM
**File:** `server/positioning-engine/engine.ts:1803`

**Description:** The LLM response parsing does `JSON.parse(cleaned) as any[]` with no schema validation. The parse is inside a surrounding `try/catch` at line 1871, so it degrades gracefully instead of crashing the entire engine run. However, the failure is not tagged with a structured error, and no schema validation is performed on the parsed array.

**Impact:** Degraded statement generation. Malformed LLM output silently falls back to seed values.

**Fix:** Validate the parsed shape with Zod before iterating. Tag parse failures with `console.error("[PositioningEngine] LLM_PARSE_INVALID", err)`.

---

### Finding C4 — MEDIUM: Silent catch on snapshot parsing
**Severity:** MEDIUM
**File:** `server/positioning-engine/routes.ts:96-99`

**Description:**
```ts
try {
  const sr = snapAny.stabilityResult;
  stability = typeof sr === "string" ? JSON.parse(sr) : (sr as { driftDetected?: unknown } | null);
} catch { stability = null; }
```
The bare `catch` silently swallows parse failures on the `stabilityResult` column. A malformed DB row will silently show `null` instead of surfacing a parse error.

**Impact:** Hidden data corruption. A bad `stabilityResult` row will silently display as `null` without alerting operators.

**Fix:** Replace bare catch with `console.error("[PositioningEngine] STABILITY_PARSE_FAILED", err)` and continue with `null`.

---

### Finding C5 — MEDIUM: `as any` casts on multi-source data
**Severity:** MEDIUM
**Files:**
- `server/positioning-engine/engine.ts:109`
- `server/positioning-engine/engine.ts:1654`

**Description:** `Object.values(multiSourceData) as any[]` suppresses TypeScript checks on competitor data. A malformed `multiSourceData` blob (wrong shape, missing fields) will pass through silently and crash later at the first property access.

**Impact:** Hidden type mismatch leading to downstream crashes.

**Fix:** Add a Zod schema for `multiSourceData` and validate before casting. Reject non-conforming shapes.

---

### Finding C6 — MEDIUM: `as any` cast on category-game judge verdict
**Severity:** MEDIUM
**File:** `server/positioning-engine/category-game.ts:247`

**Description:** `judgeVerdict = judged.verdict as any;` suppresses type safety on the judge verdict.

**Impact:** An invalid verdict string can be assigned without compile-time detection.

**Fix:** Remove the cast. Use a strict type for the judge verdict.

---

### Finding C7 — MEDIUM: No route input schema validation
**Severity:** MEDIUM
**File:** `server/positioning-engine/routes.ts:13-14, 46-47`

**Description:** Request fields are cast, not validated:
```ts
const { campaignId, miSnapshotId, audienceSnapshotId, validationSessionId } = req.body;
const campaignId = req.query.campaignId as string;
```
No Zod or runtime validation. IDs could be numbers, null, or objects.

**Impact:** Runtime type errors downstream, potential injection vectors.

**Fix:** Add Zod schema validation at the route entry. Return 400 with explicit validation errors.

---

### Finding C8 — [REMOVED — Duplicate of C4]

This finding was removed because it is a duplicate of Finding C4 (same parse site at `routes.ts:98`).

---

### Doctrine Check Summary (Positioning Engine)

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | OK |
| D2/D3 (canonical fields, strict enums) | **FAIL** (#C2 — `validationState` includes "unknown") |
| D5 (CONTRACT_INCOMPLETE) | **FAIL** (#C2 — missing canonical → "unknown" instead of `CONTRACT_INCOMPLETE`) |
| No silent catches | **FAIL** (#C4 — bare catch on stabilityResult) |
| No bare LLM calls | OK — calls go through `aiChat` |
| Evidence Integrity Filter | OK — signals mapped, grounding validated |
| B1-B5 beta safety | **FAIL** — truthfulness/visibility weakened by #C1, #C2, #C4 |

---

## Part D — Differentiation Engine Audit

### Files Audited
- `server/differentiation-engine/engine.ts` (1657 lines)
- `server/differentiation-engine/routes.ts` (310 lines)
- `server/differentiation-engine/constants.ts` (89 lines)
- `server/differentiation-engine/types.ts` (165 lines)

### Overall Verdict: FAIL
The module has a well-structured 12-layer pipeline, but it has high-severity issues around semantic contract violations, D1/D3 violations via `as any` casts, and internal error disclosure.

---

### Finding D1 — HIGH: Internal error disclosure to API clients
**Severity:** HIGH
**File:** `server/differentiation-engine/routes.ts:261`

**Description:** The `resolveRunId` catch returns `e.message` directly:
```ts
catch (e: any) { return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false }); }
```

**Impact:** Information disclosure. Resolver internals (run IDs, DB connection strings) may leak to API consumers.

**Fix:** Return generic error code. Log the real `e.message` server-side.

---

### Finding D2 — MEDIUM: Unnecessary `as any` on canonical path inputs
**Severity:** MEDIUM
**Files:**
- `server/differentiation-engine/engine.ts:1413`
- `server/differentiation-engine/engine.ts:1525`

**Description:** `domainCtx` is built with unnecessary `as any` casts:
```ts
domainFailures: (positioning as any).domainFailures || [],
operationalProblems: (positioning as any).operationalProblems || [],
proofRequirements: (positioning as any).proofRequirements || [],
```
These fields already exist on the `PositioningInput` interface (`types.ts:59-61`). The casts are unnecessary and suppress the type system without reason.

**Impact:** Type safety degradation. If the field is renamed or removed, the cast will silently produce an empty array instead of a compile-time error.

**Fix:** Remove the `as any` casts. The type system already validates these fields.

---

### Finding D3 — MEDIUM: `as any` on business data fields
**Severity:** MEDIUM
**File:** `server/differentiation-engine/routes.ts:174-178`

**Description:** `profileInput` is built with `as any` casts:
```ts
productCategory: (bizData as any).productCategory || null,
coreProblemSolved: (bizData as any).coreProblemSolved || null,
```

**Impact:** The `businessDataLayer` schema may not have these columns. The cast suppresses the type error and will silently produce `null` at runtime.

**Fix:** Add these columns to the `businessDataLayer` schema if they exist, or remove the casts and handle the absence properly.

---

### Finding D4 — MEDIUM: Unguarded `JSON.parse` on refinement response
**Severity:** MEDIUM
**File:** `server/differentiation-engine/engine.ts:1119`

**Description:** The LLM refinement response is parsed with `JSON.parse(jsonMatch[0])` with no Zod validation. A malformed JSON structure (e.g. missing `pillars` or `claims` arrays) will produce runtime errors later.

**Impact:** Silent degradation of pillars/claims.

**Fix:** Add a Zod schema for the refinement response and validate before use.

---

### Finding D5 — MEDIUM: No route input schema validation
**Severity:** MEDIUM
**File:** `server/differentiation-engine/routes.ts:24, 250`

**Description:** Request fields are cast, not validated. Same pattern as other engines.

**Impact:** Runtime type errors downstream.

**Fix:** Add Zod schema validation at the route entry.

---

### Finding D6 — [REMOVED — Invalid]

This finding was removed because `celDepthCompliance` and `depthGateResult` are already declared on `DifferentiationResult` (`types.ts:172-173`). The `as any` casts are unnecessary but not a type-safety violation.

---

### Finding D7 — LOW: `safeJsonParse` helper returns `any` without validation
**Severity:** LOW
**File:** `server/differentiation-engine/routes.ts:15-19`

**Description:** The `safeJsonParse` helper returns `any`:
```ts
function safeJsonParse(text: any): any {
  try { return JSON.parse(text); } catch { return null; }
}
```

**Impact:** The caller receives untyped data. No validation is performed.

**Fix:** Add a Zod schema parameter to `safeJsonParse` and validate the parsed shape.

---

### Doctrine Check Summary (Differentiation Engine)

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | **FAIL** (#D2, #D3 — `as any` on canonical paths) |
| D2/D3 (canonical fields, strict enums) | **FAIL** (#D2, #D3) |
| D5 (CONTRACT_INCOMPLETE) | OK — no direct fallback on canonical fields |
| No silent catches | **FAIL** (#D7 — `safeJsonParse` bare catch) |
| No bare LLM calls | OK — calls go through `aiChat` |
| Evidence Integrity Filter | OK — territory evidence density validated |
| B1-B5 beta safety | **FAIL** — truthfulness/visibility weakened by #D1, #D2, #D3 |

---

## Part E — Mechanism Engine Audit

### Files Audited
- `server/mechanism-engine/engine.ts` (732 lines)
- `server/mechanism-engine/routes.ts` (272 lines)
- `server/mechanism-engine/constants.ts` (53 lines)
- `server/mechanism-engine/types.ts` (111 lines)

### Overall Verdict: FAIL
The module has a clean axis-consistency validator and a depth gate, but it has a critical D3/D5 violation on the status enum, silent catches, and a non-canonical status string.

---

### Finding E1 — HIGH: D3/D5 — Non-canonical status `"DEPTH_FAILED"` emitted
**Severity:** HIGH
**File:** `server/mechanism-engine/engine.ts:450`

**Description:** The mechanism engine returns `status: "DEPTH_FAILED"` when the depth gate fails. This is NOT declared in the `STATUS` constant:
```ts
const STATUS = {
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  INSUFFICIENT_INPUT: "INSUFFICIENT_INPUT",
  AXIS_REJECTED: "AXIS_REJECTED",
};
```
Per D3, verdict-shaped fields must be strict enums. Per D5, a missing canonical status must produce `CONTRACT_INCOMPLETE`. The `status: string` type in `MechanismEngineResult` allows any string.

**Impact:** Semantic drift. The downstream consumer receives a status string that is not in the canonical registry. The `routes.ts` does not validate this string before persisting.

**Fix:** Either add `DEPTH_FAILED` to the canonical `STATUS` enum, or map it to `FAILED` with a structured `depthGateResult` reason.

---

### Finding E2 — HIGH: Internal error disclosure to API clients
**Severity:** HIGH
**File:** `server/mechanism-engine/routes.ts:231`

**Description:** The `resolveRunId` catch returns `e.message` directly.

**Impact:** Information disclosure.

**Fix:** Return generic error code. Log the real `e.message` server-side.

---

### Finding E3 — HIGH: `status: string` is not a strict enum
**Severity:** HIGH
**File:** `server/mechanism-engine/types.ts:85`

**Description:** The `MechanismEngineResult.status` field is typed as `string`, not a strict enum.

**Impact:** Any string can be assigned. The D3 strict enum rule is violated.

**Fix:** Replace with `status: "COMPLETE" | "FAILED" | "INSUFFICIENT_INPUT" | "AXIS_REJECTED" | "DEPTH_FAILED"` (or whatever the canonical set is).

---

### Finding E4 — HIGH: `mechanismType: string` is not a strict enum
**Severity:** HIGH
**Files:**
- `server/mechanism-engine/types.ts:17`
- `server/mechanism-engine/types.ts:52`

**Description:** The `mechanismType` field is typed as `string`. The `MECHANISM_STRUCTURAL_TYPES` array exists but is not used as the type.

**Impact:** Any string can be assigned. D3 strict enum rule is violated.

**Fix:** Replace with `MechanismStructuralType` from `constants.ts`.

---

### Finding E5 — MEDIUM: Silent catches on JSON parse
**Severity:** MEDIUM
**Files:**
- `server/mechanism-engine/engine.ts:41,47,53`
- `server/mechanism-engine/routes.ts:15-18`

**Description:**
```ts
try { return JSON.parse(text); } catch {}
```
The bare `catch` in `engine.ts` silently swallows JSON parse failures. The `routes.ts` helper `safeJsonParse` also has a bare catch that returns `null` without logging.

**Impact:** Hidden parse failures. A malformed JSON string will silently return `null` without alerting operators.

**Fix:** Replace bare catch with `console.error("[MechanismEngine] JSON_PARSE_FAILED", err)` in `engine.ts`. Add logging to `safeJsonParse` in `routes.ts`.

---

### Finding E6 — MEDIUM: `as any` on route snapshot fields
**Severity:** MEDIUM
**File:** `server/mechanism-engine/routes.ts:108`

**Description:** `mechanismCore` is parsed via `as any`:
```ts
mechanismCore: safeJsonParse((activeDiffSnapshot as any).mechanismCore) || null,
```

**Impact:** The field is not typed on the snapshot row.

**Fix:** Add `mechanismCore` to the `differentiationSnapshots` schema and type it properly.

---

### Finding E7 — MEDIUM: No route input schema validation
**Severity:** MEDIUM
**File:** `server/mechanism-engine/routes.ts:24, 220`

**Description:** Same pattern as other engines.

**Fix:** Add Zod schema validation.

---

### Doctrine Check Summary (Mechanism Engine)

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | OK |
| D2/D3 (canonical fields, strict enums) | **FAIL** (#E1, #E3, #E4) |
| D5 (CONTRACT_INCOMPLETE) | **FAIL** (#E1 — non-canonical status emitted) |
| No silent catches | **FAIL** (#E5 — bare catches on JSON parse) |
| No bare LLM calls | OK — calls go through `aiChat` |
| Evidence Integrity Filter | OK — axis consistency validated |
| B1-B5 beta safety | **FAIL** — truthfulness/visibility weakened by #E1, #E2, #E5 |


---

## Part F — Offer Engine Audit

### Files Audited
- `server/offer-engine/engine.ts` (3240 lines)
- `server/offer-engine/value-architect.ts` (403 lines)
- `server/offer-engine/identity-llm.ts` (180 lines)
- `server/offer-engine/normalize.ts` (200 lines)
- `server/offer-engine/routes.ts` (445 lines)
- `server/offer-engine/constants.ts` (155 lines)
- `server/offer-engine/types.ts` (179 lines)

### Overall Verdict: FAIL
The module has a strong contract violation recording system and a normalization layer, but it has a critical module-global mutable diagnostics array, a D3 violation on the `mechanismType` cast, and a non-canonical status in the fallback path.

---

### Finding F1 — CRITICAL: Module-global mutable contract violations array
**Severity:** CRITICAL
**File:** `server/offer-engine/engine.ts:12-19`

**Description:**
```ts
type OfferContractViolation = { field: string; reason: string; raw?: unknown };
const __offerContractViolations: OfferContractViolation[] = [];
function recordContractViolation(field: string, reason: string, raw?: unknown) {
  __offerContractViolations.push({ field, reason, raw });
}
function drainContractViolations(): OfferContractViolation[] {
  const out = __offerContractViolations.slice();
  __offerContractViolations.length = 0;
  return out;
}
```
This is a module-global mutable array. In a concurrent server handling multiple requests, contract violations from one request can leak into another's diagnostics. The `drainContractViolations` call at the end of a run may drain violations from a concurrent run.

**Impact:** Cross-tenant diagnostics leakage. Violations from one account may be reported in another's response.

**Fix:** Make the violations array per-request or per-run. Pass it as a parameter through the helper functions instead of using a module-global.

---

### Finding F2 — HIGH: Internal error disclosure to API clients
**Severity:** HIGH
**File:** `server/offer-engine/routes.ts:339`

**Description:** The `resolveRunId` catch returns `e.message` directly.

**Impact:** Information disclosure.

**Fix:** Return generic error code. Log the real `e.message` server-side.

---

### Finding F3 — MEDIUM: D1/D3 — `as any` on mechanismType
**Severity:** MEDIUM
**File:** `server/offer-engine/engine.ts:2135`

**Description:**
```ts
mechanismType: mechOut.mechanismType as any || "system",
```
The `mechanismType` is cast to `any`. The `MechanismCore` type declares it as a strict union (`"method" | "system" | "protocol" | "framework" | "none"`). The cast bypasses this.

**Impact:** Invalid mechanismType strings can be assigned and persisted.

**Fix:** Remove the cast. Use a strict enum check before assignment.

---

### Finding F4 — MEDIUM: Unguarded `JSON.parse` on LLM output
**Severity:** MEDIUM
**Files:**
- `server/offer-engine/engine.ts:1891`
- `server/offer-engine/engine.ts:2064`

**Description:** The LLM response is parsed with `JSON.parse(cleanedResponse)` with no schema validation. The refinement path (line 1891) does per-field coercion after parsing, which is good. The fallback path (line 2064) does not.

**Impact:** The fallback path can produce malformed objects if the LLM response is invalid.

**Fix:** Add Zod schema validation for the fallback path. The refinement path already has good per-field coercion.

---

### Finding F5 — MEDIUM: `as any` on route snapshot fields
**Severity:** MEDIUM
**Files:**
- `server/offer-engine/routes.ts:155`
- `server/offer-engine/routes.ts:163-164`

**Description:** `mechanismCore` and `signalLineage` are parsed via `as any`:
```ts
mechanismCore: safeJsonParse((activeDiffSnapshot as any).mechanismCore) || null,
parseLineageFromSnapshot((miSnapshot as any).signalLineage),
```

**Impact:** The fields are not typed on the snapshot rows.

**Fix:** Add these fields to the schema and type them properly.

---

### Finding F6 — MEDIUM: No route input schema validation
**Severity:** MEDIUM
**File:** `server/offer-engine/routes.ts:29, 328`

**Description:** Same pattern as other engines.

**Fix:** Add Zod schema validation.

---

### Finding F7 — MEDIUM: `as any` on offer object mutation
**Severity:** MEDIUM
**Files:**
- `server/offer-engine/engine.ts:3184`
- `server/offer-engine/engine.ts:3196`

**Description:** The `offer` object is mutated via `as any`:
```ts
const v = (offer as any)[f];
(offer.outcomeLayer as any)[k] = v.replace(OBJ_LIT, "<unresolved>").replace(/\s+/g, " ").trim();
```

**Impact:** The type system cannot catch misuses.

**Fix:** Remove the cast. Use the typed interface.

---

### Finding F8 — MEDIUM: `as any` on strategy root fields
**Severity:** MEDIUM
**File:** `server/offer-engine/engine.ts:2540-2560`

**Description:** Multiple `as any` casts on strategy root fields:
```ts
const competitorEquivalentClaim = ((positioning as any)?.semanticCollisions || [])[0]?.competitorEquivalentClaim;
const cialdiniPrinciple = (positioning as any)?.cialdiniReasoning?.primaryCialdiniPrinciple;
```

**Impact:** The `positioning` interface should declare these fields. The cast suppresses the type error.

**Fix:** Add `semanticCollisions`, `cialdiniReasoning`, etc. to the `OfferPositioningInput` interface.

---

### Finding F9 — LOW: `safeJsonParse` helper returns `any` without validation
**Severity:** LOW
**File:** `server/offer-engine/routes.ts:20-24`

**Description:** Same pattern as other engines.

**Fix:** Add a Zod schema parameter to `safeJsonParse`.

---

### Finding F10 — LOW: `as any` on result object
**Severity:** LOW
**File:** `server/offer-engine/engine.ts:1940, 1943`

**Description:** The result object is returned as `any`:
```ts
return result as any;
return { ...skeletons, sourceContext: skeletonResult.sourceContext } as any;
```

**Impact:** The type system cannot catch misuses.

**Fix:** Remove the cast. Use the typed interface.

---

### Doctrine Check Summary (Offer Engine)

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | **FAIL** (#F3 — `as any` on mechanismType) |
| D2/D3 (canonical fields, strict enums) | **FAIL** (#F3, #F5, #F7, #F8, #F10) |
| D5 (CONTRACT_INCOMPLETE) | OK — no direct fallback on canonical fields |
| No silent catches | **FAIL** (#F9 — `safeJsonParse` bare catch) |
| No bare LLM calls | OK — calls go through `aiChat` |
| Evidence Integrity Filter | OK — contract violations recorded, lineage preserved |
| B1-B5 beta safety | **FAIL** — truthfulness/visibility weakened by #F1, #F2 |

---

## Cross-Cutting Recommendations

1. **Add Zod at every boundary** — route inputs, LLM outputs, persisted JSON blobs, and canonical field assignments. This is the single highest-ROI fix for all four modules.
2. **Fail-safe state finalization** — every long-running stateful operation (boss run, engine run) must have a `try/catch/finally` that finalizes the DB row, even on unhandled exceptions.
3. **Remove all `as any` and `as unknown as` casts** on canonical/decision paths. If the types don't line up, fix the types, don't suppress them.
4. **Clamp all unbounded parameters** — `limit`, `inArray` sizes, prompt token limits.
5. **Structured logging** — replace `console.warn/error` with the project's structured logger (`server/logger.ts`) and include trace IDs.
6. **Fix the offer engine module-global mutable contract violations array** — this is a critical cross-tenant data leakage risk.
7. **Enforce canonical enums for status/validationState fields** — register `DEPTH_FAILED` in the canonical status registry or map it to `FAILED` with a structured reason.
8. **Fix internal error disclosure in all four engine routes** — return generic error codes to clients, keep raw details in server logs.

---

## Part G — AI Layer Audit

### Files Audited
- `server/ai-client.ts` (524 lines)
- `server/narrative-layer.ts` (536 lines)
- `server/pipeline/ai-overlay/client.ts` (200 lines)
- `server/pipeline/ai-overlay/assemble.ts` (181 lines)
- `server/pipeline/ai-overlay/competitor.ts` (191 lines)
- `server/pipeline/ai-overlay/dna.ts` (143 lines)
- `server/pipeline/ai-overlay/explanation.ts` (94 lines)
- `server/pipeline/ai-overlay/q2-reasoning.ts` (248 lines)
- `server/pipeline/ai-overlay/types.ts` (53 lines)
- `server/pipeline/ai-overlay/user-interpretation.ts` (153 lines)
- `server/audience-engine/sophistication-llm.ts` (227 lines)
- `server/audience-engine/buyer-psychology.ts` (365 lines)

### Overall Verdict: PASS (with noted gaps)
The AI layer is well-architected with centralized client, budget enforcement, replay recording, and strict-mock interception. The AI Overlay pipeline is particularly well-designed with fail-closed validation, deterministic parameters, and clear separation from policy paths. However, there are gaps in Zod validation, narrative layer error handling, and engine-level LLM response validation.

---

### AI Client (`server/ai-client.ts`) — Centralized Architecture

| Question | Answer |
|---|---|
| **Which AI model?** | Dual-provider: OpenAI (GPT-4.1, GPT-4o, GPT-4o-mini, GPT-5) + Google Gemini (1.5 Pro, 1.5 Flash, 2.0 Flash, 2.5 Flash) |
| **Configurable per call?** | Yes — every caller passes `model` string. `PRIMARY_CHAT_MODEL = "gpt-4.1"` is the default. |
| **Timeouts?** | OpenAI: `HARD_TIMEOUT_MS = 45s` (client-level). Gemini: `AI_GEMINI_HARD_TIMEOUT_MS` env var (default 60s) with `AbortController` + `Promise.race` (Seal #16). |
| **Response validation?** | No — `aiChat` returns raw `ChatCompletion`. Validation is caller's responsibility. |
| **Bare LLM calls?** | None — all calls go through `aiChat`/`aiGemini`. |
| **Token limits?** | `DEFAULT_MAX_TOKENS = 800`. Per-call callers set `max_tokens`. Budget enforcement caps weekly spend at 500K tokens. |
| **Error handling?** | `AICallError` with codes: `AI_TIMEOUT`, `AI_BUDGET_EXCEEDED`, `AI_CALL_FAILED`, `MISSING_MAX_TOKENS`. Budget reconciliation in `finally` block. |

**Key strengths:**
- Budget enforcement via `pg_advisory_lock` + weekly token quota
- Cost estimation per model (`MODEL_COST_USD_PER_1K_TOKENS`)
- Replay cassette integration (`recordReplayLlmCall`) for deterministic testing
- Strict-mock short-circuit for hermetic replay runs
- Operations Guardian outcome recording (`recordAICallOutcome`)

**Notable gaps:**
- `catch {}` on budget reconciliation (`ai-client.ts:261`) — silent failure
- `catch {}` on `getWeeklyTokenUsage` (`ai-client.ts:520`) — silent failure
- `as any` cast on `response_format` and `payload` in `aiChat` call

---

### Narrative Layer (`server/narrative-layer.ts`)

| Question | Answer |
|---|---|
| **Which AI model?** | `gpt-4o-mini` (hardcoded at line 404) |
| **Configurable per call?** | No — hardcoded. Env flag `EXPO_PUBLIC_NARRATIVE_LLM_V2` only toggles on/off. |
| **Timeouts?** | Inherits `aiChat` default (45s). No per-call override. |
| **Response validation?** | Manual grounding gate (4 checks: keys present, quoted strings anchored, capitalized runs anchored, single-cap mid-sentence anchored). No Zod. |
| **Bare LLM calls?** | None — goes through `aiChat`. |
| **Token limits?** | `max_tokens: 600` |
| **Error handling?** | `try/catch` around LLM call — falls back to template mode (`llm_v2_failed_template_fallback`) on any error. |

**Key strengths:**
- Grounding gate rejects hallucinated territories/mechanisms (CLP-02 / P1)
- `oneLiner` is ALWAYS synthesized from validated steps — model's free-text headline discarded
- Template fallback is safe (never returns empty)
- `narrativeMode` field tracks which path produced the output

**Notable gaps:**
- `safeP` helper (`narrative-layer.ts:40`) has bare `catch` — silent parse failure
- `JSON.parse` at line 414 has no try/catch — unhandled exception if LLM returns non-JSON
- `.catch(() => [])` on DB queries (lines 152, 162, 173, 184, 195) — silent failures
- `catch {}` on AEL snapshot read (line 213) — completely silent

---

### AI Overlay Pipeline (`server/pipeline/ai-overlay/`)

| Question | Answer |
|---|---|
| **Which AI model?** | `PRIMARY_CHAT_MODEL` (`gpt-4.1`) — hardcoded in `client.ts` |
| **Configurable per call?** | No — all overlays use the same model. Only `maxTokens` varies per overlay. |
| **Timeouts?** | `DEFAULT_TIMEOUT_MS = 20s` (hardcoded in `client.ts`) |
| **Response validation?** | Yes — every overlay supplies a `validate(parsed)` function. Returns `null` on schema violation → `error` envelope. |
| **Bare LLM calls?** | None — all go through `runOverlay` → `aiChat`. |
| **Token limits?** | Varies by overlay: explanation=500, dna=600, user-interpretation=700, q2-reasoning=700, competitor=800 |
| **Error handling?** | `runOverlay` catches ALL errors and returns `error` envelope with reason code. Never throws. |

**Key strengths:**
- `runOverlay` is a fail-closed wrapper: any failure → `error` envelope, rule-based output continues unchanged
- Deterministic params: `temperature=0`, `seed=7`, `response_format={type:"json_object"}`
- Traceability: every envelope carries model_id, prompt_version, prompt_fingerprint, response_fingerprint, latency_ms
- Default-disabled: `PIPELINE_AI_OVERLAY_ENABLED` env flag must be `"true"`
- Strict validation in every overlay: type guards, enum checks, length limits, forbidden-pattern regexes
- `q2-reasoning` overlay has advanced validation: forbidden scoring language, forbidden recommendation language, theme token allowlist, reason code allowlist

**Notable gaps:**
- `parsed as any` / `parsed as Record<string, unknown>` in every validator — type safety bypassed
- `validate` functions return `null` on failure but the caller doesn't distinguish between "parse failed" vs "schema invalid" — both map to `error` envelope
- No Zod schemas — all validation is manual type guards

---

### Engine LLM Calls (Audience Engine)

#### Sophistication LLM (`server/audience-engine/sophistication-llm.ts`)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Token limit** | `max_tokens: 2200` |
| **Temperature** | `0.2` |
| **Validation** | Manual type guards after `JSON.parse`. No Zod. |
| **Error handling** | Falls back to `FALLBACK_TIER = 2` on any error. Logs with `console.error`. |

**Notable gaps:**
- `JSON.parse` on LLM response (line ~180) with no try/catch — unhandled exception possible
- `parsed as any` in validation — type safety bypassed
- No grounding gate — LLM could invent tiers or evidence

#### Buyer Psychology (`server/audience-engine/buyer-psychology.ts`)

| Question | Answer |
|---|---|
| **Model** | `gpt-4.1-mini` (hardcoded) |
| **Token limit** | Designer: 1800, Judge: 400 |
| **Temperature** | Designer: 0.3, Judge: 0.1, Retry: 0.25 |
| **Validation** | Designer output parsed with `JSON.parse`. Hostile judge validates structure. Manual type guards. No Zod. |
| **Error handling** | Returns `null` on failure → engine continues with legacy output. Safe fallback. |

**Notable gaps:**
- `JSON.parse` on designer output (line 220) with no try/catch
- `parsed as any` in validation
- `judgeVerdict` typed as `"ACCEPTED" | "REJECTED" | "NOT_RUN"` but validated via string comparison, not strict enum

---

### AI Call Footprint Summary

| Module | Model | Tokens | Temp | Timeout | Validation | Notes |
|---|---|---|---|---|---|---|
| ai-client (default) | Caller-defined | 800 | Caller-defined | 45s | None | Budget enforcement, replay, mock |
| ai-overlay (all) | gpt-4.1 | 500-800 | 0 | 20s | Manual type guards | Fail-closed envelopes |
| narrative-layer | gpt-4o-mini | 600 | 0.4 | 45s | Grounding gate (4 checks) | Template fallback on failure |
| sophistication-llm | gpt-4.1-mini | 2200 | 0.2 | 45s | Manual type guards | Tier fallback on failure |
| buyer-psychology | gpt-4.1-mini | 1800/400 | 0.3/0.1 | 45s | Designer + Judge | Returns null on failure |
| positioning engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| differentiation engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| mechanism engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |
| offer engine | Caller-defined | Varies | Varies | 45s | Varies | See engine audit |

---

### System Type: Manual Code System

The AI system is **manual code**, not an autonomous AI system. Key evidence:

1. **Explicit design principle**: Every overlay module is locked with a comment: *"AI improves understanding. The system still owns the decision."* (Samir 2026-04-23)
2. **No AI-driven policy**: The boss verdict path is explicitly forbidden from importing AI overlay modules. Verdicts are rule-based.
3. **Fail-closed architecture**: AI overlays return `error` envelopes on failure; rule-based output continues unchanged.
4. **Deterministic parameters**: `temperature=0`, `seed=7`, `json_object` format — all designed for reproducibility, not creativity.
5. **Validation gates**: Every overlay has a `validate()` function that rejects non-conforming output.
6. **Grounding enforcement**: Narrative layer has a 4-check grounding gate that rejects hallucinated territories/mechanisms.
7. **Budget enforcement**: Per-account weekly token quotas with `pg_advisory_lock`.

The AI is used as a **semantic enricher** (translation, explanation, interpretation) on top of rule-based engine outputs. It never makes decisions, never changes verdicts, and never writes to operational state.

---

### AI Layer Doctrine Check Summary

| Rule | Status |
|---|---|
| D1 (no semantic fallback) | OK — AI overlays never fallback on canonical fields |
| D2/D3 (canonical fields, strict enums) | OK — `AIOverlayStatus` is strict enum (`ok|disabled|error`) |
| D5 (CONTRACT_INCOMPLETE) | OK — no direct fallback on canonical fields |
| No silent catches | **FAIL** — `safeP` bare catch, narrative layer DB `.catch(()=>[])`, `catch {}` on AEL read |
| No bare LLM calls | OK — all calls through `aiChat`/`aiGemini` |
| Evidence Integrity Filter | OK — grounding gate + validation functions enforce evidence anchoring |
| B1-B5 beta safety | OK — truthfulness prioritized (grounding gate rejects hallucinations), visibility good (error envelopes), safe degradation (template fallback) |

---

## AI Layer Recommendations

1. **Add Zod schemas to all AI overlay validators** — replace manual type guards with structured schemas. This is the single highest-ROI improvement for the AI layer.
2. **Fix `safeP` bare catch** — replace with `console.error("[NarrativeLayer] JSON_PARSE_FAILED", err)`.
3. **Fix narrative layer DB query `.catch(()=>[])`** — at minimum log the error; better: propagate as degraded mode.
4. **Add `try/catch` around `JSON.parse` in narrative layer** — currently unhandled at line 414.
5. **Add `try/catch` around `JSON.parse` in sophistication-llm** — currently unhandled.
6. **Add `try/catch` around `JSON.parse` in buyer-psychology** — currently unhandled.
7. **Consider model registry** — hardcoded model names (`gpt-4.1-mini`, `gpt-4o-mini`) scattered across files. Centralize in `ai-client.ts` or a config file.
