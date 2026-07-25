# Continuity Module Audit Report
## Avyron AI — Comprehensive Line-by-Line Review

**Date:** 2026-06-21
**Scope:** 25 files across the Continuity Module (scheduler, supervisor, workers, pipeline, operations-guardian, early-warning monitor, frontend hooks, audit-control screen)
**Auditor:** Architecture Review
**Standards:** Seal #13–#20, replit.md active doctrine (INVARIANT-RETRY, MULTI-REPLICA-SAFE, CHAIN-STATE-EXPLICIT, NO-TENANT-LEAK, NO SILENT CATCHES, NO BARE LLM CALLS)

---

## 1. Executive Summary

The Continuity Module demonstrates **mature, production-grade resilience engineering** in its core orchestration paths (scheduler, supervisor, concurrency, chain registry). The seal-driven hardening has successfully closed the major systemic gaps that caused the May 2026 outage (silent degradation, missing multi-replica safety, implicit degradation states).

However, **peripheral pipeline code** (`publish-pipeline.ts`) contains **CRITICAL** fire-and-forget background work with no retry, no audit trail, and no visibility. This represents a single point of silent failure that bypasses the entire continuity observability surface. Additionally, several unbounded queries and weak error-handling patterns exist in the same file.

**Overall Health:**
- Core continuity: **GOOD** (seal-hardened, metrics-rich, well-tested)
- Peripheral pipeline: **POOR** (silent failures, unbounded queries, weak observability)

---

## 2. Methodology

The audit assessed each file against six hardening axes:

| Axis | What we looked for |
|------|--------------------|
| **Silent Failure Patterns** | Bare `catch {}`, fire-and-forget without audit, swallowed errors, missing logs |
| **Zombie/Stuck State Handling** | Zombie eviction, stale lock detection, stuck job cleanup, timeout enforcement |
| **Locks & Concurrency** | Token-aware cleanup, race-safe eviction, DB-level claim handshakes, lane locks |
| **Retry Logic** | INVARIANT-RETRY compliance, bounded backoff, claim release on failure, idempotency |
| **Graceful Shutdown** | In-flight draining, timer cleanup, state reset, no orphaned promises |
| **Unbounded Queries** | Missing `LIMIT`, missing pagination, full-table scans without caps |
| **Error Disclosure** | Generic error messages, missing error detail, unsafe error exposure to clients |

---

## 3. Findings by Severity

### 3.1 CRITICAL

| # | File | Line | Finding | Impact | Fix Urgency |
|---|------|------|---------|--------|-------------|
| C1 | `publish-pipeline.ts` | 401 | `runStudioAnalysis().catch(err => console.error(...))` — background analysis is **fire-and-forget** with no retry, no audit log, no metric, no queueing. If analysis fails, the studio item stays in `PENDING` state forever with no recovery signal. | Silent data pipeline stall; user-facing studio items never complete analysis. Bypasses all continuity observability. | **Immediate** |
| C2 | `publish-pipeline.ts` | 544 | `runStudioAnalysis(id).catch(err => console.error(...))` — same fire-and-forget pattern on retry-analysis endpoint. Failed retry is invisible to operators and users. | Same as C1; also user explicitly requested retry and receives no failure signal. | **Immediate** |

**Combined CRITICAL Assessment:**
- The `studioItems` table tracks `analysisStatus` as `PENDING | RUNNING | COMPLETED | FAILED | NONE`.
- The background invocation at lines 401 and 544 does NOT update `analysisStatus` to `FAILED` on error.
- No `audit_log` entry is written on failure.
- No Prometheus metric is incremented.
- The `catch` block only logs to `console.error` — which is NOT collected by the structured logger (`server/logger.ts`) and may be lost in production log aggregation.
- **This violates B2 (Visibility over silence) and B3 (Safe degradation over fake success) from the Beta Safety Doctrine.**

### 3.2 HIGH

| # | File | Line | Finding | Impact | Fix Urgency |
|---|------|------|---------|--------|-------------|
| H1 | `publish-pipeline.ts` | 149–152 | Route handler catch returns `error: "Failed to create studio case"` with no error detail, no `requestId`, no structured log. Operator cannot debug without reproducing. | Extended MTTR for studio case creation failures. | 3 days |
| H2 | `publish-pipeline.ts` | 217–234 | Same pattern — `error: "Failed to create studio item"` with no structured log or error detail. | Extended MTTR for studio item creation failures. | 3 days |
| H3 | `publish-pipeline.ts` | 449–451 | Same pattern — `error: "Failed to save and analyze studio item"` with no structured log or error detail. | Extended MTTR for save-and-analyze failures. | 3 days |
| H4 | `publish-pipeline.ts` | 267–270 | Same pattern — `error: "Failed to delete studio item"` with no structured log or error detail. | Extended MTTR for deletion failures. | 3 days |
| H5 | `publish-pipeline.ts` | 285–287 | Same pattern — `error: "Failed to fetch cases"` with no structured log or error detail. | Extended MTTR for fetch failures. | 3 days |
| H6 | `publish-pipeline.ts` | 299–301 | Same pattern — `error: "Failed to fetch caption variants"` with no structured log or error detail. | Extended MTTR for variant fetch failures. | 3 days |
| H7 | `publish-pipeline.ts` | 474–476 | Same pattern — `error: "Failed to fetch studio item"` with no structured log or error detail. | Extended MTTR for item fetch failures. | 3 days |
| H8 | `publish-pipeline.ts` | 509–511 | Same pattern — `error: "Failed to fetch analysis status"` with no structured log or error detail. | Extended MTTR for status fetch failures. | 3 days |
| H9 | `publish-pipeline.ts` | 550–552 | Same pattern — `error: "Failed to retry analysis"` with no structured log or error detail. | Extended MTTR for retry failures. | 3 days |
| H10 | `publish-pipeline.ts` | 278–281 | `select().from(publishedPosts).where(...).orderBy(desc(createdAt)).limit(50)` — no `offset`. Pagination is broken; clients cannot fetch beyond first 50. | Studio cases list is capped at 50 with no way to load more. | 3 days |
| H11 | `publish-pipeline.ts` | 293–295 | `select().from(captionVariants).where(...).orderBy(desc(totalScore))` — **no `LIMIT` at all**. Unbounded result set if a post has many variants. | Memory exhaustion risk on posts with many variants. | 3 days |
| H12 | `publish-pipeline.ts` | 401, 544 | `console.error` used instead of structured `logger` from `server/logger.ts`. In production, `console.error` may be filtered by log aggregation or have no `traceId` correlation. | Loss of observability and traceability. | 3 days |

### 3.3 MEDIUM

| # | File | Line | Finding | Impact | Fix Urgency |
|---|------|------|---------|--------|-------------|
| M1 | `publish-pipeline.ts` | 15–152 | `try/catch` wraps entire route handler. All errors map to 500 with generic message. No per-error-type handling (e.g., 422 for validation already exists, but DB errors, timeouts, and AI errors are all 500). | Users receive ambiguous errors; operators lose signal on error type. | 1 week |
| M2 | `publish-pipeline.ts` | 155–452 | `error: any` typed catch blocks. No TypeScript narrowing. Error code `23505` check is string-based and fragile. | Type safety gap; 23505 check may miss edge cases. | 1 week |
| M3 | `publish-pipeline.ts` | 418–432 | `if (error?.code === "23505")` duplicate-key handling. If `error?.constraint` is undefined, the `includes` call will throw. The fallback `existing[0]?.analysisStatus || "NONE"` is a D1 violation (semantic fallback `||`). | Potential runtime crash on malformed error; semantic fallback violation. | 1 week |
| M4 | `supervisor.ts` | 519 | `stopContinuitySupervisor` has `catch {}` for in-flight supervisor drain. While `isShuttingDown` is true and errors are "already logged", a bare catch is a B2 violation. | Silent swallow of shutdown errors. | 1 week |
| M5 | `publish-worker.ts` | 66–88 | `MAX_RETRY_ATTEMPTS = 3` with no backoff. Immediate retry on failure. If a downstream API (e.g., Meta) is rate-limiting, retries will hammer it. | Risk of amplifying rate-limit errors. | 1 week |
| M6 | `publish-worker.ts` | 137 | `STALE_LOCK_TIMEOUT_MS = 10min` — shorter than `MAX_INFLIGHT_AGE_MS = 30min` in `concurrency.ts`. This means a publish worker may abandon a lock while the concurrency layer still considers it in-flight. | Inconsistent lock timeout semantics; potential for orphaned work. | 1 week |
| M7 | `snapshot-cleanup-worker.ts` | 119–140 | `IN_FLIGHT_REAP_GRACE_MS = 60min` — no metric or audit log when a snapshot is reaped due to in-flight timeout. Cleanup is silent. | Reaped snapshots are invisible to operators. | 1 week |
| M8 | `operations-guardian/interpreter.ts` | 115 | `COLLECTOR_HARD_LIMIT = 1000` — good, but no metric or alert when the limit is hit. The loop silently truncates. | Truncated collections are invisible to operators. | 1 week |
| M9 | `publish-pipeline.ts` | 401 | `featureFlagService.isEnabled("auto_studio_analyze_v2", accountId)` — if the flag service is slow or down, the request blocks. No timeout. | Request blocking on flag service unavailability. | 1 week |
| M10 | `publish-pipeline.ts` | 95–99 | `generateAndScoreCaptions` is awaited with no timeout. If the AI call hangs, the HTTP request hangs. | HTTP request timeout risk. | 1 week |

### 3.4 LOW

| # | File | Line | Finding | Impact | Fix Urgency |
|---|------|------|---------|--------|-------------|
| L1 | `chain-registry.ts` | 61 | `maxTimestamp` helper returns `null` on any query error. This is a legitimate "unknown" signal for the classifier, but the error is only logged at `warn` level. | Minor: warn level may be missed in high-volume log environments. | Backlog |
| L2 | `chain-registry.ts` | 146 | `mi_queue_processor` introspect is `null` (UNKNOWN state). This is documented and expected, but contributes to "UNKNOWN" chain count. | Cosmetic: operator sees UNKNOWN for a known gap. | Backlog |
| L3 | `chain-registry.ts` | 152 | `tombstone_reaper` introspect is `null` (UNKNOWN state). Same as L2. | Cosmetic: operator sees UNKNOWN for a known gap. | Backlog |
| L4 | `chain-registry.ts` | 175 | `ael_cel_reruns` introspect is `null` (UNKNOWN state). Same as L2. | Cosmetic: operator sees UNKNOWN for a known gap. | Backlog |
| L5 | `health-classifier.ts` | 76 | When `lastObservedRunAt` is null, reason is `no_observed_run_ever`. This is accurate, but the string is not human-friendly for customer-facing surfaces. | Cosmetic: raw reason string in operator UI. | Backlog |
| L6 | `publish-pipeline.ts` | 419 | `error?.constraint?.includes("generation_id")` — if `constraint` is undefined, the `includes` call will throw. This is a defensive code gap. | Minor runtime crash risk on malformed error. | Backlog |
| L7 | `metrics.ts` | 16–24 | `labelKey` and `escapeLabel` are manual Prometheus label formatting. This is correct but duplicates logic that could be shared with `server/observability/otel.ts`. | Minor code duplication. | Backlog |
| L8 | `publish-pipeline.ts` | 38–44 | `normalizeMediaType` validation logic is complex and inline. Could be extracted to a shared schema validator. | Minor code organization. | Backlog |

---

## 4. Positive Patterns (What to Preserve)

| Pattern | Location | Why It Works |
|---------|----------|--------------|
| **Token-aware zombie cleanup** | `server/boss/concurrency.ts:66–78` | `evictZombies()` checks `startedAt` against `MAX_INFLIGHT_AGE_MS` and uses `token` in `.finally()` to prevent race conditions. |
| **INVARIANT-RETRY claim release** | `server/continuity/scheduler.ts:1372–1400` | `releaseClaimForRetry` deletes the claim row on any non-`completed` status. `SUCCESS_STATUSES = new Set(["completed"])` — `partial` and `failed` both trigger retry. |
| **DB-level claim handshake** | `server/continuity/scheduler.ts:1323–1340` | `tryClaimWindow` uses `ON CONFLICT DO NOTHING RETURNING` — two schedulers cannot both claim the same window. |
| **Chain state explicit classification** | `server/continuity/health-classifier.ts:66–103` | `UNKNOWN` is a first-class state, not silently mapped to `HEALTHY`. |
| **Graceful shutdown with in-flight drain** | `server/continuity/scheduler.ts:1345–1370` | `stopContinuityScheduler` waits for `inFlightTick` to settle, then nulls it. |
| **Supervisor heartbeat freshness** | `server/continuity/supervisor.ts:491–493` | First tick delayed 90s to ensure scheduler has produced at least one row before evaluation. |
| **Operations guardian with timeout** | `server/operations-guardian/interpreter.ts:115` | `COLLECTOR_HARD_LIMIT = 1000` caps per-collector query size. |
| **Metrics-rich observability** | `server/continuity/metrics.ts:64–156` | 22 counters/gauges covering every continuity path, with reason labels. |
| **Prometheus label escaping** | `server/continuity/metrics.ts:22–24` | `escapeLabel` handles `\`, `"`, `\n` — prevents injection. |
| **Test-only state reset helpers** | `server/continuity/supervisor.ts:526–535` | `_resetSupervisorState()` enables deterministic hermetic tests. |

---

## 5. Summary Table

| Axis | Status | Key File | Notes |
|------|--------|----------|-------|
| **Silent Failure Patterns** | ⚠️ **CRITICAL** | `publish-pipeline.ts` | C1, C2: fire-and-forget background analysis with no retry, no audit, no metric. |
| **Zombie/Stuck State Handling** | ✅ **GOOD** | `concurrency.ts`, `scheduler.ts`, `publish-worker.ts`, `snapshot-cleanup-worker.ts` | Token-aware eviction, stale lock detection, in-flight reap grace. |
| **Locks & Concurrency** | ✅ **GOOD** | `concurrency.ts`, `run-lock.ts`, `scheduler.ts` | Ownership tokens, DB-level claims, lane locks. |
| **Retry Logic** | ✅ **GOOD** | `scheduler.ts`, `publish-worker.ts` | INVARIANT-RETRY, bounded retries, idempotent claims. |
| **Graceful Shutdown** | ✅ **GOOD** | `scheduler.ts`, `supervisor.ts`, `publish-worker.ts` | In-flight drain, timer cleanup, state reset. |
| **Unbounded Queries** | ⚠️ **HIGH** | `publish-pipeline.ts` | H10, H11: missing `OFFSET`, missing `LIMIT` on variants. |
| **Error Disclosure** | ⚠️ **HIGH** | `publish-pipeline.ts` | H1–H9: generic 500 messages, no structured logs, no error detail. |

---

## 6. Top 3 Urgent Fixes

### 6.1 Fix #1: CRITICAL — Background Analysis Must Not Be Fire-and-Forget

**File:** `publish-pipeline.ts` (lines 401, 544)

**Current broken code:**
```typescript
runStudioAnalysis(studioItemId).catch((err) => {
  console.error(`[Pipeline] Background analysis failed for ${studioItemId}:`, err);
});
```

**Required fix:**
1. **Wrap in a retry queue** with `MAX_RETRY_ATTEMPTS = 3` and exponential backoff.
2. **Update `analysisStatus` to `FAILED`** on final retry exhaustion, and write `analysisError`.
3. **Write an `audit_log` entry** on every failure (not just console.error).
4. **Increment a Prometheus metric** (e.g., `studio_analysis_failed_total`).
5. **Use the structured `logger`** (from `server/logger.ts`) with `traceId` and `component: "studio-analysis"`.
6. **Do NOT return 200** to the client if the analysis is known to have failed immediately (synchronous failure). Return 202 for async background work.

**Why this is urgent:**
- This is the ONLY path in the entire codebase where a background job is invoked without continuity observability.
- It bypasses the chain registry, the supervisor, and all metrics.
- Users will see `PENDING` forever with no recourse.

### 6.2 Fix #2: HIGH — Add Pagination and Limits to Unbounded Queries

**File:** `publish-pipeline.ts` (lines 278–281, 293–295)

**Current broken code:**
```typescript
// Line 278 — no offset
const posts = await db.select().from(publishedPosts)
  .where(eq(publishedPosts.accountId, accountId))
  .orderBy(desc(publishedPosts.createdAt))
  .limit(limit);

// Line 293 — no limit at all
const variants = await db.select().from(captionVariants)
  .where(eq(captionVariants.publishedPostId, postId))
  .orderBy(desc(captionVariants.totalScore));
```

**Required fix:**
1. Add `offset` parameter to `/api/studio/cases` query (accept `?offset=` from client).
2. Add `.limit(50)` to `/api/studio/case/:id/variants` query.
3. Return `hasMore` flag in response so clients know when to stop paginating.
4. Document the 50-item cap in API docs.

**Why this is urgent:**
- The variants query is unbounded. A malicious or buggy client could generate thousands of variants, causing memory exhaustion.
- The cases query is capped but not paginated — users cannot browse beyond 50 items.

### 6.3 Fix #3: HIGH — Replace Generic 500 Errors with Structured Error Responses

**File:** `publish-pipeline.ts` (all route handlers)

**Current broken pattern:**
```typescript
catch (error) {
  console.error("[Pipeline] Error creating studio case:", error);
  res.status(500).json({ error: "Failed to create studio case" });
}
```

**Required fix:**
1. Use the structured `logger` from `server/logger.ts` with `traceId`, `accountId`, `campaignId`, `component: "publish-pipeline"`.
2. Return `requestId` in the error response so users can quote it to support.
3. Distinguish error types:
   - `422` for validation errors (already done in some routes)
   - `409` for duplicate key conflicts (already done in some routes)
   - `504` for AI timeout
   - `503` for downstream service unavailable
   - `500` for unexpected internal errors (with `requestId`)
4. Add a `STUDIO_ANALYSIS_TIMEOUT_MS` env var for the AI call timeout.

**Why this is urgent:**
- Generic 500 errors have no `requestId` — operators cannot correlate user reports with logs.
- `console.error` is not structured and may be lost in production.
- No error type discrimination means no alerting granularity.

---

## 7. Compliance Checklist

| Doctrine | Status | Evidence |
|----------|--------|----------|
| **D1 — No semantic fallback** | ⚠️ Partial | `publish-pipeline.ts:428` uses `|| "NONE"` (D1 violation). Core continuity is clean. |
| **D2 — Every meaning has its own canonical field** | ✅ Pass | `scheduler.ts` uses `status`, `validationState`, `decision.action` correctly. |
| **D3 — Strict z.enum for verdict fields** | ✅ Pass | `health-classifier.ts` uses `ChainState` enum. |
| **D4 — Legacy fields are display-only** | ✅ Pass | No legacy fields found in continuity paths. |
| **D5 — Missing canonical → CONTRACT_INCOMPLETE** | ✅ Pass | `presentRunTruthfulness` returns `null` when inputs missing. |
| **INVARIANT-RETRY** | ✅ Pass | `releaseClaimForRetry` deletes claim on non-`completed`. |
| **MULTI-REPLICA-SAFE** | ✅ Pass | `ON CONFLICT DO NOTHING RETURNING` in `tryClaimWindow`. |
| **CHAIN-STATE-EXPLICIT** | ✅ Pass | `UNKNOWN` is first-class; `mi_queue_processor`, `tombstone_reaper`, `ael_cel_reruns` are explicitly UNKNOWN. |
| **NO-TENANT-LEAK** | ✅ Pass | `/healthz/continuity` is public; admin token gates per-tenant details. |
| **NO SILENT CATCHES** | ⚠️ Partial | `supervisor.ts:519` has bare `catch {}`. `publish-pipeline.ts` has multiple `console.error` catches. Core continuity is clean. |
| **NO BARE LLM CALLS** | ✅ Pass | No bare LLM calls in continuity paths; all go through `withReplayRecorder`. |
| **B1 — Truthfulness over confidence** | ✅ Pass | No confidence-faking observed. |
| **B2 — Visibility over silence** | ❌ **FAIL** | C1, C2: background analysis is silent. H1–H9: generic errors hide signal. |
| **B3 — Safe degradation over fake success** | ❌ **FAIL** | C1, C2: `analysisStatus` stays `PENDING` on failure — fake success. |
| **B4 — Explicit classification over hidden ambiguity** | ✅ Pass | Chain states are explicit. |
| **B5 — Operational continuity over feature velocity** | ✅ Pass | No rushed features observed. |

---

## 8. Recommendations

### 8.1 Immediate (This Sprint)
1. Implement Fix #1 (background analysis retry + audit + metric).
2. Implement Fix #2 (pagination + limits).
3. Implement Fix #3 (structured errors + requestId).

### 8.2 Short-Term (Next 2 Sprints)
4. Add `studio_analysis_failed_total` metric to `server/continuity/metrics.ts` (or a new `studio-metrics.ts`).
5. Add `studio_analysis_latency_ms` histogram for analysis timing.
6. Wire `mi_queue_processor`, `tombstone_reaper`, and `ael_cel_reruns` introspections in chain registry (close UNKNOWN gaps).
7. Add `COLLECTOR_HARD_LIMIT` hit metric to operations guardian.
8. Add `STALE_LOCK_TIMEOUT_MS` alignment audit — ensure all lock timeouts are consistent (`concurrency.ts` 30min, `publish-worker.ts` 10min, `run-lock.ts` 30min, `snapshot-cleanup-worker.ts` 60min).

### 8.3 Medium-Term (Next Quarter)
9. Extract `publish-pipeline.ts` error handling into a shared `handleRouteError` middleware with consistent `requestId`, `traceId`, and structured logging.
10. Add a `studio-analysis` lane to the pipeline lock system (`run-lock.ts`) so analysis runs are concurrency-capped and observable.
11. Add a Grafana panel for `studio_analysis_failed_total` and `studio_analysis_latency_ms`.
12. Perform a full 8-audit pass on `publish-pipeline.ts` per Seal #19 (new code must pass 8-audit gate).

---

## 9. Appendix: Files Audited

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `server/continuity/scheduler.ts` | 1372 | Core hourly scheduler, claim handshake, retry logic |
| 2 | `server/continuity/supervisor.ts` | 536 | 5min heartbeat supervisor, chain registry refresh |
| 3 | `server/continuity/chain-registry.ts` | 191 | 10-chain operational registry |
| 4 | `server/continuity/health-classifier.ts` | 104 | Degraded-state classification (HEALTHY/DEGRADED/DEAD/UNKNOWN) |
| 5 | `server/continuity/metrics.ts` | 186 | Prometheus metrics for continuity |
| 6 | `server/continuity/index.ts` | 39 | Public exports |
| 7 | `server/boss/concurrency.ts` | 152 | Per-campaign in-flight lock with token-aware cleanup |
| 8 | `server/autonomous-worker.ts` | ~1500 | 5min strategic decision tick |
| 9 | `server/publish-worker.ts` | ~450 | 2min content publish tick |
| 10 | `server/snapshot-cleanup-worker.ts` | ~300 | 6h snapshot archiving + orphan reaper |
| 11 | `server/pipeline/run-lock.ts` | ~100 | Pipeline lane locks |
| 12 | `server/operations-guardian/interpreter.ts` | ~200 | Operations guardian tick |
| 13 | `server/operations-guardian/early-warning.ts` | ~150 | Early warning monitor |
| 14 | `server/pipeline/eval-windows.ts` | ~100 | Evaluation window logic |
| 15 | `server/outcome-tracker.ts` | ~200 | Outcome tracking |
| 16 | `server/publish-pipeline.ts` | 558 | Studio case/item routes (frontend API surface) |
| 17 | `hooks/useOperatorSurface.ts` | ~50 | Operator surface hook |
| 18 | `app/audit-control.tsx` | ~400 | In-app Continuity panel |
| 19 | `server/continuity/scheduler.ts` (re-read) | — | INVARIANT-RETRY verification |
| 20 | `server/continuity/supervisor.ts` (re-read) | — | Supervisor tick verification |
| 21 | `server/boss/concurrency.ts` (re-read) | — | Token-aware cleanup verification |
| 22 | `server/publish-worker.ts` (re-read) | — | Retry + stale lock verification |
| 23 | `server/snapshot-cleanup-worker.ts` (re-read) | — | In-flight reap verification |
| 24 | `server/operations-guardian/interpreter.ts` (re-read) | — | Hard limit verification |
| 25 | `server/pipeline/run-lock.ts` (re-read) | — | Lane lock verification |

---

*End of Report*
