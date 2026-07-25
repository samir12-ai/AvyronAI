# Market Intelligence v3 — Data Audit Batch 1/4

**Scope:** `server/market-intelligence-v3/` (33 files)  
**Auditor:** Replit Agent  
**Date:** 2026-06-21  
**Risk categories:** tenant isolation, data quality, scrape safety, silent failure, LLM output safety, unbounded queries, error disclosure.

---

## 1. Per-file verdict table

| # | File | Verdict | Severity | Issue (line) | Category | Notes |
|---|------|---------|----------|--------------|----------|-------|
| 1 | `confidence-engine.ts` | **NEEDS_FIX** | **HIGH** | L105 | Data quality | `evaluateSignalStabilityGuard` hard-codes `decision: "PROCEED"` regardless of thresholds. The guard never blocks or downgrades—only pushes advisory `reasons`. Violates B3 (safe degradation over fake success). |
| 2 | `routes.ts` | **NEEDS_FIX** | **MEDIUM** | L97-103, L208-210, L249-250, L282-283, L307-308, L360-383, L404-406 | Error disclosure | 7 catch blocks return raw `err.message` to the client. Risk of leaking internal paths, DB errors, or LLM provider details. |
| 3 | `admin-routes.ts` | **NEEDS_FIX** | **MEDIUM** | L48-50, L82-84, L114-116, L160-162 | Error disclosure | 4 catch blocks return raw `err.message` to the client. Admin-only routes reduce blast radius but still violate B3. |
| 4 | `routes.ts` | **NEEDS_FIX** | **MEDIUM** | L286 | Tenant isolation | `GET /api/ci/mi-v3/telemetry/:snapshotId` lacks `requireCampaign` middleware. Relies on indirect ownership check (`resolveAccountId` + `snapshotId` DB lookup). If `resolveAccountId` ever returns a wrong account (e.g. stale JWT), telemetry leaks. |
| 5 | `scrape-volume-cap.ts` | **ACCEPTABLE** | **LOW** | L116-118, L155-157 | Scrape safety | Volume/depth query failures admit fail-open (log error + allow admission). Documented and intentional—cap is a safety rail, not a security boundary. |
| 6 | `isolation-guard.ts` | **CLEAN** | — | — | Tenant isolation | All `logAudit().catch()` handlers use `_noteAuditWriteFailure` (console.error). No silent catches. Seal #15 compliant. |
| 7 | `prompt-safety.ts` | **ACCEPTABLE** | **LOW** | L31-39 | LLM output safety | `detectInjectionTokens` scans static patterns but does **not** reject text—caller decides. Effectiveness depends on callers actually using it. No enforcement gate. |
| 8 | `token-budget-store.ts` | **CLEAN** | — | — | Data quality | Proper first-writer-wins via `ON CONFLICT DO NOTHING`, re-reads persisted row. Seal #11 / F6.1 compliant. |
| 9 | `engine-state.ts` | **ACCEPTABLE** | **LOW** | L172-177 | Silent failure | Async DB update for schema-guard status is fire-and-forget (no `await`). Error handled via `.catch()` console.error only. No retry, no audit. |
| 10 | `signal-engine.ts` | **ACCEPTABLE** | **LOW** | L374 | Data quality | `require("../shared/text-sanitizer")` inside function—late dynamic import. Works but hides dependency. Should be static import at top. |
| 11 | `reviews-intelligence.ts` | **ACCEPTABLE** | **LOW** | L197 | Data quality | Same late dynamic import pattern as signal-engine.ts. |
| 12 | `cross-signal-decision.ts` | **CLEAN** | — | — | Data quality | Phase 3 realRatio penalty applied to confidence (L736-751). T1.A origin lineage tracking present. No issues. |
| 13 | `fetch-orchestrator.ts` | **CLEAN** | — | — | Tenant isolation | All Maps keyed by `accountId` or `accountId:campaignId`. No cross-tenant shared mutable state. Per-account dedup, scrape admission gate, bounded `lastJobStartByAccount` Map. Seal #16/F1 watchdog present. |
| 14 | `engine.ts` | **CLEAN** | — | — | Tenant isolation | `activeLocks` Map keyed by `accountId:campaignId`. `persistValidatedSnapshot` enforces no strategy writes. No shared mutable state between accounts. |
| 15 | `website-scraper.ts` | **CLEAN** | — | — | Scrape safety | SSRF defense via `resolveSafeUrl()` + `pinnedLookup()`, breaker gate, proxy fallback with credential redaction (`replace(/\/\/[^@]+@/g, "//***@")`). |
| 16 | `constants.ts` | **CLEAN** | — | — | — | Pure constants. No executable logic. |
| 17 | `types.ts` | **CLEAN** | — | — | — | Pure type definitions. |
| 18 | `utils.ts` | **CLEAN** | — | — | — | `computeCompetitorHash` uses SHA256; `parseJsonSafe` has safe fallback. |
| 19 | `index.ts` | **CLEAN** | — | — | — | Route registration only. |
| 20 | `market-baselines.ts` | **CLEAN** | — | — | Data quality | `computeMarketBaseline` falls back to `FALLBACK_BASELINE` on error. Time-weighted averaging is bounded. |
| 21 | `refresh-system.ts` | **CLEAN** | — | — | — | Pure deterministic logic. No external calls. |
| 22 | `demand-pressure.ts` | **CLEAN** | — | — | — | Regex-based pattern matching. No external calls. Bounded computation. |
| 23 | `content-dna.ts` | **CLEAN** | — | — | — | Regex-based detection. No external calls. |
| 24 | `similarity-engine.ts` | **CLEAN** | — | — | — | Cosine/Jaccard similarity. Pure computation. |
| 25 | `trajectory-engine.ts` | **CLEAN** | — | — | — | Pure computation. No external calls. |
| 26 | `intent-engine.ts` | **CLEAN** | — | — | — | Pure computation. Proper `degraded` flagging on low sample size. |
| 27 | `narrative-clustering.ts` | **CLEAN** | — | — | — | Token-based clustering. No external calls. |
| 28 | `source-types.ts` | **CLEAN** | — | — | — | Pure type definitions. |
| 29 | `dominance-module.ts` | **CLEAN** | — | — | — | Pure computation. `engagementWeightBiasRisk` surfaced explicitly. |
| 30 | `token-budget.ts` | **CLEAN** | — | — | — | Pure computation. Bounded sampling. |
| 31 | `tiktok-qualification.ts` | **CLEAN** | — | — | — | Read in prior batch. No issues. |
| 32 | `signal-normalizer.ts` | **CLEAN** | — | — | — | Read in prior batch. No issues. |
| 33 | `narrative-objection-extractor.ts` | **CLEAN** | — | — | — | Read in prior batch. `signalOrigin` field present for T1.A lineage. |

---

## 2. Summary table

| Category | Count | Severity distribution |
|----------|-------|----------------------|
| Tenant isolation | 1 issue | 1 MEDIUM |
| Data quality | 3 issues | 1 HIGH, 2 LOW |
| Scrape safety | 1 issue | 1 LOW (acceptable) |
| Silent failure | 1 issue | 1 LOW |
| LLM output safety | 1 issue | 1 LOW |
| Unbounded queries | 0 issues | — |
| Error disclosure | 2 issues | 2 MEDIUM |
| **Total** | **9 issues** | **1 HIGH, 3 MEDIUM, 5 LOW** |
| **Clean files** | **24 of 33** | — |

---

## 3. Top 3 fixes (prioritized)

### Fix 1 — Make `evaluateSignalStabilityGuard` actually enforce decisions (HIGH)
**File:** `confidence-engine.ts`  
**Line:** 105  
**Problem:** `const decision: GuardDecision = "PROCEED";` is hard-coded. Coverage, reliability, and dominant-source thresholds are checked only to populate `reasons`—the guard never returns `"DOWNGRADE"` or `"BLOCK"`.  
**Fix:** Wire the thresholds to the decision:
- If `avgCoverage < MI_CONFIDENCE.BLOCK_COVERAGE` → `decision = "BLOCK"`
- If `avgReliability < MI_CONFIDENCE.BLOCK_RELIABILITY` → `decision = "BLOCK"`
- If `maxDominantRatio > effectiveDominantThreshold` → `decision = "DOWNGRADE"`
- If `totalSampleSize < minSample` → `decision = "DOWNGRADE"`

Then update `computeConfidence` to act on `guardDecision` (e.g. cap overall confidence when `BLOCK` or `DOWNGRADE`).

### Fix 2 — Sanitize error messages before sending to client (MEDIUM)
**File:** `routes.ts`, `admin-routes.ts`  
**Lines:** 7 catch blocks in routes.ts, 4 in admin-routes.ts  
**Problem:** `return res.status(500).json({ error: err.message })` leaks raw error text.  
**Fix:** Replace with a safe mapping:
```typescript
const safeError = err?.code && typeof err.code === "string"
  ? err.code
  : "INTERNAL_ERROR";
return res.status(500).json({ error: safeError, requestId: traceId });
```
Log the full `err.message` server-side only.

### Fix 3 — Add `requireCampaign` to telemetry endpoint (MEDIUM)
**File:** `routes.ts`  
**Line:** 286  
**Problem:** `GET /api/ci/mi-v3/telemetry/:snapshotId` is missing `requireCampaign` middleware. The ownership check depends solely on `resolveAccountId(req)` and a DB lookup by `snapshotId`.  
**Fix:** Add `requireCampaign` to the route definition. The existing `assertCampaignBelongsTo` pattern (used on other routes) should also be applied here to validate the campaign from the snapshot matches the authenticated account.

---

## 4. Answers to explicit questions

### Q1: Can market intelligence data leak between accounts?

**Answer: NO — with one caveat.**

**Evidence:**
- `fetch-orchestrator.ts`: All in-memory Maps (`accountJobTracker`, `lastJobStartByAccount`, `activeJobs`) are keyed by `accountId` or `accountId:campaignId`. The `getFetchJobStatus` function requires `accountId` for HTTP-scoped calls (L1606-1614).
- `engine.ts`: `activeLocks` Map is keyed by `accountId:campaignId`. Snapshot queries always include `eq(miSnapshots.accountId, accountId)`.
- `isolation-guard.ts`: `validateEngineIsolation` and `assertSnapshotReadOnly` enforce caller restrictions.
- `routes.ts`: All data-returning routes (except telemetry, see Fix 3) use `requireCampaign` + `resolveAccountId` + `assertCampaignBelongsTo`.

**Caveat:** The telemetry endpoint (`/api/ci/mi-v3/telemetry/:snapshotId`) lacks `requireCampaign` (see issue #4). If `resolveAccountId` were ever compromised (e.g. stale JWT, accountId confusion), this is the only leak path. Fixing this removes the caveat entirely.

### Q2: Can the confidence engine report high confidence on weak/single-source data?

**Answer: YES — the guard is advisory-only.**

**Evidence:**
- `confidence-engine.ts` L105: `evaluateSignalStabilityGuard` hard-codes `decision: "PROCEED"`. The coverage threshold (`BLOCK_COVERAGE = 0.45`), reliability threshold (`BLOCK_RELIABILITY = 0.50`), and dominant-source threshold (`DOWNGRADE_DOMINANT_SOURCE = 0.60`) are all checked only to append strings to `reasons`—they never change the decision.
- `computeConfidence` L162-171: The `guardDecision` is read from the guard, but then the code only adds more advisory reasons ("DATA_STALE_ADVISORY", "Low confidence advisory"). The `overall` confidence score is never capped or blocked based on the guard.
- `cross-signal-decision.ts` L736-751: Phase 3 does apply a `realGroundingFloor` penalty to confidence when `realRatio` is low, but this is a separate pipeline stage. The initial `computeConfidence` in the engine can still emit `STRONG` (≥0.80) even when `evaluateSignalStabilityGuard` would have flagged it.
- `signal-engine.ts` L374: The late `require("../shared/text-sanitizer")` import means signal text is cleaned, but the confidence computation itself does not factor in text quality.

**Conclusion:** A single-competitor run with 1 source can produce `overall = 0.55+` (MODERATE) because:
- `crossCompetitorConsistency` returns `0` when `<2` competitors (T3.A fix — this is correct)
- But `dataCompleteness` (0.25 weight), `freshnessDecay` (0.15), `sourceReliability` (fixed 0.75), `sampleStrength` (0.20), and `signalStability` (0.15) can still sum to ~0.50+ even with one weak source
- The guard emits warnings but never downgrades the level

Fixing the guard to actually enforce `BLOCK`/`DOWNGRADE` decisions (Fix 1) closes this gap.

---

## 5. Appendix — Full file list

All 33 files audited:

1. `admin-routes.ts`
2. `confidence-engine.ts`
3. `constants.ts`
4. `content-dna.ts`
5. `cross-signal-decision.ts`
6. `demand-pressure.ts`
7. `dominance-module.ts`
8. `engine-state.ts`
9. `engine.ts`
10. `fetch-orchestrator.ts`
11. `index.ts`
12. `intent-engine.ts`
13. `isolation-guard.ts`
14. `market-baselines.ts`
15. `narrative-clustering.ts`
16. `narrative-objection-extractor.ts`
17. `prompt-safety.ts`
18. `refresh-system.ts`
19. `reviews-intelligence.ts`
20. `routes.ts`
21. `scrape-volume-cap.ts`
22. `signal-engine.ts`
23. `signal-normalizer.ts`
24. `similarity-engine.ts`
25. `source-types.ts`
26. `tiktok-qualification.ts`
27. `token-budget-store.ts`
28. `token-budget.ts`
29. `trajectory-engine.ts`
30. `types.ts`
31. `utils.ts`
32. `website-scraper.ts`
