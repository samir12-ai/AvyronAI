# Competitive Intelligence — Data Audit Batch 2/4

**Scope:** `server/competitive-intelligence/` — 11 files (scrape-safety.ts and rate-limiter.ts excluded as pre-audited clean)
**Auditor:** Replit Agent  
**Date:** 2026-06-28

---

## A) Per-File Verdict Table

| # | File | Verdict | Severity | Issue (line) | Category | Notes |
|---|------|---------|----------|--------------|----------|-------|
| 1 | `profile-scraper.ts` | NEEDS_FIX | MEDIUM | 828-833 | Proxy credential safety | Playwright `launchOptions.proxy` receives raw `proxyUsername`/`proxyPassword`. If Playwright throws during launch, error may contain proxy credentials. |
| 2 | `data-acquisition.ts` | NEEDS_FIX | MEDIUM | 1645-1652 | Unbounded queries | `cleanupExpiredSyntheticComments` selects expired synthetic comments without `.limit()` — could return massive row set on large deployments. |
| 2a| `data-acquisition.ts` | ACCEPTABLE | LOW | 1067-1069 | Silent failure (non-fatal) | Shared-profile upsert failure is caught and logged as `console.warn` — acceptable for non-critical path. |
| 3 | `tiktok-scraper.ts` | ACCEPTABLE | — | — | — | All failures logged with `degraded: true` + `degradedReason`. Credentials redacted in logs via `safeMsg`. No silent catches. |
| 4 | `tiktok-apify-scraper.ts` | CLEAN | — | — | — | Apify token passed via Authorization header (never URL). No bare catches. All errors thrown with context. |
| 5 | `reviews-scraper.ts` | ACCEPTABLE | — | — | — | All failures logged + returned in `error` field. `safeMsg` redacts credentials from log messages. No silent catches. |
| 6 | `proxy-pool-manager.ts` | NEEDS_FIX | MEDIUM | 142 | Proxy credential safety | `ProxySession` stores `sessionPassword: proxy.password` (master Bright Data password). If object is serialized or process dumps core, credentials leak. |
| 7 | `shared-profile-store.ts` | ACCEPTABLE | — | — | — | Shared pool is intentionally cross-tenant for public metadata only. `reuseFromSharedPool` re-tags all copied rows with target `accountId` — proper isolation. |
| 8 | `index.ts` | CLEAN | — | — | — | Pure route registration, no data logic. |
| 9 | `analysis-routes.ts` | CLEAN | — | — | — | All endpoints return 410 DEPRECATED — no auth or data access. |
| 10 | `competitor-routes.ts` | NEEDS_FIX | MEDIUM | 91-93, 205-207, 293-295, 310-312, 351-353 | Error disclosure | 5 catch blocks return `error.message` directly to client, leaking internal DB/proxy errors. |
| 11 | `data-acquisition-routes.ts` | NEEDS_FIX | LOW | 39-41 | Error disclosure | 1 catch block returns `error.message` on GET /data-coverage (read-only endpoint). |
| 12 | `dominance-routes.ts` | CLEAN | — | — | — | All endpoints return 410 DEPRECATED — no auth or data access. |
| 13 | `reviews-tiktok-routes.ts` | NEEDS_FIX | MEDIUM | 32-34, 50-52, 70-72, 104-106 | Error disclosure | 4 catch blocks return `err.message` directly to client on POST scraping/ingest endpoints. |

**Files with issues:** 5 of 11  
**Files clean:** 4 (`tiktok-apify-scraper.ts`, `index.ts`, `analysis-routes.ts`, `dominance-routes.ts`)  
**Files acceptable (minor/low):** 3 (`tiktok-scraper.ts`, `reviews-scraper.ts`, `shared-profile-store.ts`, `data-acquisition.ts` with 1 low)  
**Total issues:** 10 (5 MEDIUM proxy/error, 1 MEDIUM unbounded query, 1 LOW error disclosure, 1 LOW non-fatal catch)

---

## B) Summary Table by Category

| Category | Issue Count | Severity Breakdown | Files Affected |
|----------|-------------|-------------------|----------------|
| **Tenant Isolation** | 0 | — | None — all DB queries scoped by `accountId` + `competitorId`/`campaignId`. All in-memory Maps keyed by `accountId`. |
| **Auth & Route Protection** | 0 | — | None — all live routes use `resolveAccountId` + `assertCampaignBelongsTo` or `validateCompetitorOwnership`. |
| **Error Disclosure** | 10 catch blocks | 9 MEDIUM, 1 LOW | `competitor-routes.ts` (5), `reviews-tiktok-routes.ts` (4), `data-acquisition-routes.ts` (1) |
| **Proxy Credential Safety** | 2 | 2 MEDIUM | `proxy-pool-manager.ts` (master password in `ProxySession`), `profile-scraper.ts` (Playwright proxy config) |
| **Silent Failures** | 0 | — | None — every catch block logs the error. Scrapers return `degraded` / `error` / `warnings` on failure. |
| **Unbounded Queries** | 1 | 1 MEDIUM | `data-acquisition.ts` (`cleanupExpiredSyntheticComments` selects without `.limit()`) |
| **Input Validation** | 0 | — | None — URLs validated via `validateUserUrl`. Array inputs type-checked. IDs validated via DB ownership query. |
| **Rate Limiting** | 0 | — | None — `checkBatchLimit` enforces 10 profiles/hour per account. `rateLimitMap` enforces 10s gap. |

---

## C) Top Fixes Prioritized by Severity

### 1. Fix error disclosure in all CI route catch blocks [MEDIUM — 10 instances]
**Files:** `competitor-routes.ts`, `reviews-tiktok-routes.ts`, `data-acquisition-routes.ts`
**Action:** Replace every `res.status(500).json({ error: error.message })` with a generic message like `{ error: "Internal server error", traceId }`. Log the real error server-side only. This is the exact same pattern flagged in Batch 1's `routes.ts` — fix both batches together.

**Lines to fix:**
- `competitor-routes.ts`: 91, 205, 293, 310, 351
- `reviews-tiktok-routes.ts`: 32, 50, 70, 104
- `data-acquisition-routes.ts`: 39

### 2. Prevent proxy credential leakage in memory and error paths [MEDIUM — 2 instances]
**File:** `proxy-pool-manager.ts` line 142
**Action:** Consider storing credentials in a closure or WeakMap rather than on the `ProxySession` object itself, or mark the field as non-enumerable to prevent accidental `JSON.stringify` exposure. Add a comment warning against serialization.

**File:** `profile-scraper.ts` lines 828-833
**Action:** Wrap Playwright launch in a try/catch that redacts `launchOptions.proxy` from any thrown error before re-throwing or logging.

### 3. Bound cleanup query in `cleanupExpiredSyntheticComments` [MEDIUM — 1 instance]
**File:** `data-acquisition.ts` lines 1645-1652
**Action:** Add `.limit(5000)` to the expired-rows query and process cleanup in batches if more rows exist. This prevents memory pressure on large deployments.

---

## D) Explicit Answers to Audit Questions

### Q1: Can competitor data leak between accounts via shared-profile-store.ts or any in-memory structure?

**NO.**

**Evidence by line number:**

- `shared-profile-store.ts` `ciSharedProfiles` table (lines 24-120) stores **only public metadata**: `platform`, `normalizedHandle`, `postCount`, `followers`, `scrapeQuality`. No competitor names, no post content, no account-specific data.
- `reuseFromSharedPool()` (lines 144-343) copies post/comment data from a source competitor, but **every copied row is re-tagged** with `targetAccountId` and `targetCompetitorId`:
  - Posts: lines 196-197 (`accountId: targetAccountId`, `competitorId: targetCompetitorId`)
  - Comments: lines 229-230 (`accountId: targetAccountId`, `competitorId: targetCompetitorId`)
  - Metrics snapshot: lines 287-299 (`accountId: targetAccountId`, `competitorId: targetCompetitorId`)
- The `profileCache` in `profile-scraper.ts` is **namespaced by `accountId`** via `nsCacheKey()` (lines 121-123, 1289, 1444). Two tenants scraping the same Instagram handle get independent cache entries.
- The `batchCounters` (line 100) and `rateLimitMap` (line 118) are keyed by `accountId`.
- The `proxy-pool-manager.ts` `pools` LRUCache is keyed by `accountId` (lines 65-70) — each tenant gets an isolated `AccountPool`.
- The only cross-tenant shared in-memory structure is `scrapeStats` (lines 72-80 of `profile-scraper.ts`), which tracks **aggregate operational metrics only** (totalRequests, successRate, blockedRate, bandwidthMB). No per-account or per-competitor data.

**Conclusion:** The shared-profile store is intentionally cross-tenant for public profile metadata (handle, follower count), but all actual post/comment data remains strictly scoped per-account via re-tagging on copy. No data leak path exists.

---

### Q2: Are proxy credentials safe from appearing in logs or error responses?

**MOSTLY YES, with two gaps.**

**What's safe:**
- `tiktok-scraper.ts` (line 428) and `reviews-scraper.ts` (lines 395, 449) use `safeMsg` regex replacement: `(err.message || "").replace(/\/\/[^@]+@/g, "//***@")` — this strips the `username:password` portion from proxy URLs before logging.
- `proxy-pool-manager.ts` `logProxyTelemetry()` (lines 386-411) logs `ipHash`, `sessionId`, `stageName` but **never logs `sessionUsername` or `sessionPassword`**.
- `tiktok-apify-scraper.ts` passes the Apify token via the `Authorization` header (line 89), never in the URL. It also defensively strips any `token=` from the path (line 75).

**Gap 1 — master password in memory:**
- `proxy-pool-manager.ts` line 142: `sessionPassword: proxy.password` stores the **master Bright Data password** on every `ProxySession` object. If the object is accidentally `JSON.stringify`'d, or if the Node process dumps core, the password is exposed in memory. The `sessionUsername` (line 134) uses Bright Data's session-routing suffix, but the password is the actual master credential.

**Gap 2 — Playwright launch errors:**
- `profile-scraper.ts` lines 828-833: `launchOptions.proxy = { server: "http://${proxyHost}:${proxyPort}", username: proxyUsername, password: proxyPassword }`. If Playwright throws during `chromiumModule.launch(launchOptions)` (line 840), the error message or stack trace may include the `launchOptions` object with credentials. There is no catch/redaction around the Playwright launch call.

**Conclusion:** Logged messages are redacted, but two paths could leak credentials: (1) accidental serialization of `ProxySession`, and (2) Playwright launch error objects.

---

### Q3: Do scraping failures surface as degraded data or disappear silently?

**THEY SURFACE AS DEGRADED — never silently.**

**Evidence by file:**

- **`profile-scraper.ts`** (lines 1283-1447): `scrapeInstagramProfile` returns `ScrapeResult` with `success: false`, `warnings: ["SCRAPE_BLOCKED"]`, and `collectionMethodUsed: "NONE"` when all methods fail (lines 1413-1418). Every intermediate failure is logged (e.g., lines 1366, 1385, 1409). No bare `catch{}` blocks exist.
- **`tiktok-scraper.ts`** (lines 518-631): `scrapeTiktokForCompetitor` returns `TiktokScrapedResult` with `degraded: true` and `degradedReason` set to `"BOTH_SOURCES_DOWN"`, `"APIFY_FAIL"`, or `"NO_HANDLE"` (lines 593-598, 626-630). Errors are logged via `console.error` or `console.log`.
- **`reviews-scraper.ts`** (lines 323-453): `scrapeReviewsForCompetitor` returns `ReviewScrapedResult` with `error` field populated on every failure path (lines 337-339, 407-409, 448-452). All errors logged.
- **`tiktok-apify-scraper.ts`** (lines 260-314): No bare catches. Errors thrown with context (e.g., `"APIFY_API_KEY not configured"`). Returns `[]` only when key is missing, with `console.warn`.
- **`data-acquisition.ts`** (lines 501-725): `_executeFetch` returns `FetchResult` with `status: "BLOCKED"` and `message: "Scraping blocked. All methods failed."` when the scraper returns no posts (lines 715-725). The watchdog timeout returns `status: "INSUFFICIENT_DATA"` (lines 464-479).

**Conclusion:** Every scraping failure is either (a) logged to the server console, (b) returned to the caller with a `degraded` / `error` / `status` field, or both. There are zero bare `catch{}` blocks that silently discard failures.

---

## Appendix: Full File List

| # | File | Lines | Status |
|---|------|-------|--------|
| 1 | `server/competitive-intelligence/profile-scraper.ts` | 1447 | NEEDS_FIX |
| 2 | `server/competitive-intelligence/data-acquisition.ts` | 1813 | NEEDS_FIX |
| 3 | `server/competitive-intelligence/tiktok-scraper.ts` | 638 | ACCEPTABLE |
| 4 | `server/competitive-intelligence/tiktok-apify-scraper.ts` | 315 | CLEAN |
| 5 | `server/competitive-intelligence/reviews-scraper.ts` | 472 | ACCEPTABLE |
| 6 | `server/competitive-intelligence/proxy-pool-manager.ts` | 467 | NEEDS_FIX |
| 7 | `server/competitive-intelligence/shared-profile-store.ts` | 478 | ACCEPTABLE |
| 8 | `server/competitive-intelligence/index.ts` | 14 | CLEAN |
| 9 | `server/competitive-intelligence/analysis-routes.ts` | 18 | CLEAN |
| 10 | `server/competitive-intelligence/competitor-routes.ts` | 364 | NEEDS_FIX |
| 11 | `server/competitive-intelligence/data-acquisition-routes.ts` | 43 | NEEDS_FIX |
| 12 | `server/competitive-intelligence/dominance-routes.ts` | 24 | CLEAN |
| 13 | `server/competitive-intelligence/reviews-tiktok-routes.ts` | 110 | NEEDS_FIX |

*Excluded (pre-audited clean): `scrape-safety.ts`, `rate-limiter.ts`*
