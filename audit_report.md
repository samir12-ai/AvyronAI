# Audit Report — Audience Engine + Boss Modules

Date: 2026-05-24
Scope: 18 files across Audience Engine (6 files) and Boss (12 files)
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

## Cross-Cutting Recommendations

1. **Add Zod at every boundary** — route inputs, LLM outputs, persisted JSON blobs, and canonical field assignments. This is the single highest-ROI fix for both modules.
2. **Fail-safe state finalization** — every long-running stateful operation (boss run, audience engine run) must have a `try/catch/finally` that finalizes the DB row, even on unhandled exceptions.
3. **Remove all `as any` and `as unknown as` casts** on canonical/decision paths. If the types don't line up, fix the types, don't suppress them.
4. **Clamp all unbounded parameters** — `limit`, `inArray` sizes, prompt token limits.
5. **Structured logging** — replace `console.warn/error` with the project's structured logger (`server/logger.ts`) and include trace IDs.
