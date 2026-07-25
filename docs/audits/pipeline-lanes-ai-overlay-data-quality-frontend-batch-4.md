# Batch 4 Data Audit — Pipeline Lanes + AI Overlay + Data Quality + Frontend

**Scope:** 4 sub-modules, 41 files total  
**Auditor:** Replit Agent  
**Date:** 2026-06-28  
**Risk categories:** Tenant isolation, auth & route protection, error disclosure, proxy credential safety, silent failures, unbounded queries, input validation, rate limiting.

---

## Executive Summary

Batch 4 covers the final frontier of the pipeline: lane logic, AI enrichment overlays, data quality enforcement, and customer-facing frontend components. The picture is overwhelmingly positive. **Zero HIGH-severity issues were found.** The 6 issues identified are all MEDIUM or LOW, and most are defensive refinements rather than active vulnerabilities.

**Top-line counts:**
- Files audited: 41
- Issues found: 6 (0 HIGH, 5 MEDIUM, 1 LOW)
- Tenant isolation: Strong across all lanes and data quality modules
- AI overlay safety: Excellent — default-disabled, hard fallbacks, no verdict-path coupling
- Data quality enforcement: Mixed — statistical validity actively blocks weak data (benchmark fallback), while confidence/risk layers are advisory
- Frontend: Clean auth patterns, but error messages may surface backend details

---

## A) Per-File Verdict Table

### GROUP 1 — Pipeline Lanes (14 files)

| File | Verdict | Severity | Issue | Category | Notes |
|------|---------|----------|-------|----------|-------|
| `server/pipeline/lanes/competitor.ts` | PASS | — | — | — | Reads scoped by accountId+campaignId. Bridge hard-rejects cross-campaign access. |
| `server/pipeline/lanes/user/index.ts` | PASS | — | — | — | Same scoping pattern. Change detection guards lineage. |
| `server/pipeline/lanes/user/accept.ts` | PASS | — | — | — | Zod validation on every accept. No raw payload crossing. |
| `server/pipeline/lanes/user/bridge.ts` | PASS | — | — | — | Cross-campaign access rejected at bridge boundary. |
| `server/pipeline/lanes/user/composition.ts` | PASS | — | — | — | Pure derivation. No DB I/O. |
| `server/pipeline/lanes/user/cluster-comparator.ts` | PASS | — | — | — | Pure function. Deterministic output. |
| `server/pipeline/lanes/user/outcome-regression.ts` | PASS | — | — | — | Pure derivation over truth row. |
| `server/pipeline/lanes/user/lead-quality.ts` | PASS | — | — | — | Pure derivation. No DB I/O. |
| `server/pipeline/lanes/user/cluster-interpretation.ts` | PASS | — | — | — | Pure function. No DB I/O. |
| `server/pipeline/lanes/competitor/interpret.ts` | PASS | — | — | — | Pure function. No DB I/O. |
| `server/pipeline/lanes/competitor/types.ts` | PASS | — | — | — | Type definitions only. |
| `server/pipeline/lanes/competitor/pattern-validation.ts` | PASS | — | — | — | Pure function. Threshold constants centralized. |
| `server/pipeline/lanes/competitor/pattern-detection.ts` | PASS | — | — | — | Pure function. Deterministic sorting. |
| `server/pipeline/lanes/competitor/corpus.ts` | PASS | — | — | — | DB reads scoped by accountId+campaignId. Lookback filters on timestamp (not createdAt). |

### GROUP 2 — AI Overlay (8 files)

| File | Verdict | Severity | Issue | Category | Notes |
|------|---------|----------|-------|----------|-------|
| `server/pipeline/ai-overlay/client.ts` | PASS | — | — | — | Default-disabled, temp=0, seed=7, json_object, 20s timeout, hard fallback envelopes, strict validate guard. |
| `server/pipeline/ai-overlay/assemble.ts` | PASS | — | — | — | Overlays run independently via Promise.all. Failure in one does not block others. Unavailable envelope for missing inputs. |
| `server/pipeline/ai-overlay/explanation.ts` | PASS | — | — | — | Verdict locked. citesReason validated against input reasons set. No invention allowed. |
| `server/pipeline/ai-overlay/dna.ts` | PASS | — | — | — | Schema validation with enum checks. No DB I/O. |
| `server/pipeline/ai-overlay/competitor.ts` | PASS | — | — | — | Theme token allowlist enforced. No DB I/O. |
| `server/pipeline/ai-overlay/q2-reasoning.ts` | PASS | — | — | — | Extensive validator: verdict locked, forbidden scoring/recommendation regex, theme token allowlist, rule-code blocklist. |
| `server/pipeline/ai-overlay/user-interpretation.ts` | PASS | — | — | — | interpretation_only flag enforced. Theme token allowlist. No DB I/O. |
| `server/pipeline/ai-overlay/types.ts` | PASS | — | — | — | Type definitions only. Boss policy forbidden from importing. |

### GROUP 3 — Data Quality (15 files)

| File | Verdict | Severity | Issue | Category | Notes |
|------|---------|----------|-------|----------|-------|
| `server/shared/multi-source-loader.ts` | PASS | LOW | snapshotId lookup lacks accountId scoping | Tenant isolation | Defense-in-depth gap. snapshotId is opaque but add accountId to the WHERE clause for hard scoping. Line 39-42. |
| `server/shared/embedding.ts` | PASS | — | — | — | Pure function. No DB / network / auth. |
| `server/shared/openai-embeddings.ts` | PASS | — | — | — | Calls Gemini embeddings. No DB. Truncates at 8000 chars. |
| `server/shared/text-sanitizer.ts` | PASS | — | — | — | Pure functions. Pattern-based cleaning. |
| `server/shared/text-policy.ts` | PASS | — | — | — | Pure functions. Token stripping with regex. |
| `server/shared/engine-health.ts` | PASS | MEDIUM | Bare `catch {}` on JSON.parse of signalLineage | Silent failures | Line ~184. Swallows parse error silently. Should log: `console.error("[EngineHealth] lineage parse failed", e)`. |
| `server/data-source/resolver.ts` | PASS | — | — | — | DB reads scoped by accountId+campaignId. Fallback to benchmark on weak data. |
| `server/data-source/benchmarks.ts` | PASS | — | — | — | Static data only. No DB / auth concerns. |
| `server/data-source/statistical-validity.ts` | PASS | — | — | — | Pure functions. Thresholds enforced. Actively blocks scaling. |
| `server/data-source/validation.ts` | PASS | — | — | — | Pure functions. Validates spend/results/cpa consistency. |
| `server/data-source/routes.ts` | PASS | LOW | Transition log limit not capped | Unbounded queries | Line 119: `parseInt(req.query.limit as string) || 50`. Add `Math.min(limit, 200)` ceiling. |
| `server/data-source/transition-log.ts` | PASS | — | — | — | DB scoped by accountId. Errors logged. JSON.parse in mapRow unwrapped but callers have try-catch. |
| `server/baselines.ts` | PASS | — | — | — | DB scoped by accountId. Account-level baseline is correct design. |
| `server/confidence.ts` | PASS | — | — | — | DB reads scoped by accountId. Pure calculation. |
| `server/risk-classifier.ts` | PASS | — | — | — | Pure function. Returns riskLevel + autoExecutable flag. |

### GROUP 4 — Frontend Data Components (4 files)

| File | Verdict | Severity | Issue | Category | Notes |
|------|---------|----------|-------|----------|-------|
| `components/CompetitiveIntelligence.tsx` | PASS | MEDIUM | Error messages surfaced in Alert.alert | Error disclosure | Line ~202: `Alert.alert('Error', err.message)`. If backend returns internal error details, user sees them. Wrap with generic message. |
| `components/MarketDatabaseAdmin.tsx` | PASS | MEDIUM | Error messages surfaced in UI state | Error disclosure | Line ~161: `setError(err.message)`. Same pattern — should map to generic user message. |
| `components/SystemIntegrityPanel.tsx` | PASS | MEDIUM | Error messages surfaced in UI state | Error disclosure | Line ~202: `setError(err.message)`. Same pattern. |
| `app/(tabs)/monitor.tsx` | PASS | MEDIUM | Error messages surfaced in UI | Error disclosure | Line ~98: `(error as Error)?.message ?? "Failed to load"`. Same pattern. |

---

## B) Summary by Category

| Category | Issues | Severity Breakdown | Assessment |
|----------|--------|-------------------|------------|
| Tenant isolation | 1 | 1 LOW | Strong. All DB queries scoped by accountId+campaignId. One defense-in-depth gap in multi-source-loader. |
| Auth & route protection | 0 | — | All routes use resolveAccountId. All admin endpoints gated. |
| Error disclosure | 4 | 4 MEDIUM | Frontend components display err.message directly. Backend routes (data-source) return generic messages — improvement over Batch 3. |
| Proxy credential safety | 0 | — | No proxy usage in this batch. |
| Silent failures | 1 | 1 MEDIUM | One bare `catch {}` in engine-health.ts JSON.parse. All other catches log errors. |
| Unbounded queries | 1 | 1 LOW | Transition log limit uncapped. All other queries have explicit LIMIT. |
| Input validation | 0 | — | Zod/enum validation present in overlays. Metrics validation in data-source. |
| Rate limiting | 0 | — | No API endpoints in this batch lack rate limiting. |

---

## C) Top 3 Fixes (Prioritized by Severity)

### 1. [MEDIUM] Add explicit error logging to bare catch in engine-health.ts
**File:** `server/shared/engine-health.ts` line ~184  
**Current:**
```typescript
try {
  const lineage = JSON.parse(latestAudience.signalLineage);
  // ...
} catch {}
```
**Fix:**
```typescript
try {
  const lineage = JSON.parse(latestAudience.signalLineage);
  // ...
} catch (e) {
  console.error("[EngineHealth] lineage parse failed:", e);
}
```
**Why:** Silent catch violates Continuity doctrine (NO SILENT CATCHES). A malformed lineage row should be visible to operators.

### 2. [MEDIUM] Wrap frontend error displays with generic messages
**Files:** `components/CompetitiveIntelligence.tsx`, `components/MarketDatabaseAdmin.tsx`, `components/SystemIntegrityPanel.tsx`, `app/(tabs)/monitor.tsx`  
**Pattern:** Replace `err.message` with a generic message + log the real error.
**Example fix for CompetitiveIntelligence.tsx:**
```typescript
onError: (err: any) => {
  console.error("[CompetitiveIntelligence] mutation error:", err);
  Alert.alert('Error', 'Something went wrong. Please try again.');
}
```
**Why:** If the backend throws an unexpected error with internal details, the user sees it. All 4 frontend components share this pattern.

### 3. [LOW] Cap transition-log limit and add accountId to multi-source-loader snapshot lookup
**File 1:** `server/data-source/routes.ts` line 119  
```typescript
const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
```
**File 2:** `server/shared/multi-source-loader.ts` line 39-42  
Add `eq(miSnapshots.accountId, accountId)` to the WHERE clause. The function needs to accept accountId as a parameter.
**Why:** Defense in depth. Prevents unbounded reads and hardens snapshot lookup.

---

## D) Explicit Q&A Answers

### Q1: Does the data quality layer (confidence.ts, statistical-validity.ts, risk-classifier.ts) actually block weak data from reaching the strategy engines, or is it purely advisory?

**Answer: Mixed — statistical validity blocks, confidence/risk are advisory.**

- **statistical-validity.ts** — **Actively blocks.** The `shouldBlockScaling` function (line 162-179) returns `{blocked: true, reason: ...}` when conversions or spend fall below thresholds (30 conversions / $500 spend). The resolver (`resolver.ts` line 121-150) uses `validateCampaignMetrics` and `assessStatisticalValidity` to **force a benchmark fallback** when campaign metrics are invalid or statistically weak. Weak data never reaches strategy engines as "campaign_verified" — it is downgraded to "benchmark_contextual" or "campaign_fallback".

- **validation.ts** — **Actively blocks.** `validateCampaignMetrics` returns `{valid: false, ...}` for inconsistent spend/results/CPA. The resolver falls back to benchmark when validation fails (line 142-150).

- **confidence.ts** — **Advisory.** Computes a 0-100 confidence score with status Stable/Caution/Unstable. It does not hard-block engine execution. It feeds into downstream risk assessment and dashboard display.

- **risk-classifier.ts** — **Advisory with execution gate.** Returns `{riskLevel, autoExecutable}`. High risk sets `autoExecutable = false`, meaning risky decisions require human approval. It does not block data from reaching engines, but it blocks auto-execution of risky actions.

**Conclusion:** The lower-level data quality layers (statistical validity, metrics validation) are **blocking** — they force benchmark fallback when data is weak. The upper-level layers (confidence, risk classification) are **advisory** — they surface risk but do not stop the pipeline.

---

### Q2: If an AI overlay (q2-reasoning, explanation) fails or returns malformed JSON, what happens to the pipeline run?

**Answer: The pipeline run continues completely unaffected. The AI overlay returns an error envelope and the explanation layer falls back to rule-based output.**

Evidence from `server/pipeline/ai-overlay/client.ts`:
- Line 100-107: If the env flag is off, returns `{status: "disabled"}` — not an error.
- Line 143-157: JSON.parse is wrapped in try-catch. Parse failure returns `{status: "error", error: "parse_failed"}`.
- Line 159-172: Schema validation. If `validate(parsed)` returns null, returns `{status: "error", error: "schema_invalid"}`.
- Line 185-198: Outer try-catch catches any AI call exception. Returns `{status: "error", error: code}`.

Evidence from `server/pipeline/ai-overlay/assemble.ts`:
- Line 131-163: Overlays run independently via `Promise.all`. A failure in one overlay does **not** block the others.
- The function always returns an `AssembledInterpretation` with all five slots populated — error statuses are valid states.

Evidence from `server/pipeline/ai-overlay/types.ts`:
- Line 12-13: "Consumers MUST switch on `status` and treat anything other than 'ok' as 'no AI interpretation available — fall back to the rule-based output unchanged'."

Evidence from doctrine (`replit.md` §Semantic Contract Hardening):
- AI overlays are **explicitly off the verdict path**. The module comment in `assemble.ts` states: "This module is NEVER imported from `boss/policy/*` or `boss/run.ts`."

**Conclusion:** AI overlay failure is a **graceful degradation**. The envelope carries `status: "error"`, the dashboard falls back to raw rule reasons, and the Boss verdict (Q1/Q2) is never touched. There is no path where a malformed AI response influences a decision.

---

### Q3: Do the frontend components expose any sensitive data in console logs or error states?

**Answer: No sensitive data in console logs. Error states may surface backend details if exceptions leak through.**

**Console logs:** I found zero `console.log` or `console.error` calls in the 4 frontend components that expose sensitive competitive data, competitor names, or scraped content. The components intentionally display competitive intelligence (that's their purpose), but they do not log it to the browser/console.

**Error states:** All 4 components display error messages directly:
- `CompetitiveIntelligence.tsx` — `Alert.alert('Error', err.message)` (line ~202)
- `MarketDatabaseAdmin.tsx` — `setError(err.message)` (line ~161)
- `SystemIntegrityPanel.tsx` — `setError(err.message)` (line ~202)
- `monitor.tsx` — `(error as Error)?.message ?? "Failed to load"` (line ~98)

The risk is that if the backend throws an unexpected exception with an internal error message (e.g., a database error, a stack trace, or a proxy credential name), that message propagates through `authFetch` → `safeApiJson` → the component's error handler → the user's screen. The `safeApiJson` helper may map some errors, but unhandled exceptions can leak through.

**Conclusion:** No sensitive data in console logs. Error displays are the remaining surface for potential backend detail leakage. The recommended fix is to wrap all frontend error displays with generic messages and log the real error to the console for debugging.

---

## Appendix: Full File List

### GROUP 1 — Pipeline Lanes (14 files)
1. `server/pipeline/lanes/competitor.ts`
2. `server/pipeline/lanes/user/index.ts`
3. `server/pipeline/lanes/user/accept.ts`
4. `server/pipeline/lanes/user/bridge.ts`
5. `server/pipeline/lanes/user/composition.ts`
6. `server/pipeline/lanes/user/cluster-comparator.ts`
7. `server/pipeline/lanes/user/outcome-regression.ts`
8. `server/pipeline/lanes/user/lead-quality.ts`
9. `server/pipeline/lanes/user/cluster-interpretation.ts`
10. `server/pipeline/lanes/competitor/interpret.ts`
11. `server/pipeline/lanes/competitor/types.ts`
12. `server/pipeline/lanes/competitor/pattern-validation.ts`
13. `server/pipeline/lanes/competitor/pattern-detection.ts`
14. `server/pipeline/lanes/competitor/corpus.ts`

### GROUP 2 — AI Overlay (8 files)
15. `server/pipeline/ai-overlay/assemble.ts`
16. `server/pipeline/ai-overlay/client.ts`
17. `server/pipeline/ai-overlay/competitor.ts`
18. `server/pipeline/ai-overlay/dna.ts`
19. `server/pipeline/ai-overlay/explanation.ts`
20. `server/pipeline/ai-overlay/q2-reasoning.ts`
21. `server/pipeline/ai-overlay/types.ts`
22. `server/pipeline/ai-overlay/user-interpretation.ts`

### GROUP 3 — Data Quality (15 files)
23. `server/shared/multi-source-loader.ts`
24. `server/shared/embedding.ts`
25. `server/shared/openai-embeddings.ts`
26. `server/shared/text-sanitizer.ts`
27. `server/shared/text-policy.ts`
28. `server/shared/engine-health.ts`
29. `server/data-source/resolver.ts`
30. `server/data-source/benchmarks.ts`
31. `server/data-source/statistical-validity.ts`
32. `server/data-source/validation.ts`
33. `server/data-source/routes.ts`
34. `server/data-source/transition-log.ts`
35. `server/baselines.ts`
36. `server/confidence.ts`
37. `server/risk-classifier.ts`

### GROUP 4 — Frontend (4 files)
38. `components/CompetitiveIntelligence.tsx`
39. `components/MarketDatabaseAdmin.tsx`
40. `components/SystemIntegrityPanel.tsx`
41. `app/(tabs)/monitor.tsx`

---

*End of Batch 4 report. This completes the 4-batch data audit series.*
