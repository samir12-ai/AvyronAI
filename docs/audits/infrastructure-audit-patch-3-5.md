# Infrastructure Audit — Patch 3/5

**Scope:** Video + Photography + Studio + Lead Engine + Agent + Output Projection + Collector (25 files)
**Date:** 2026-07-06
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table (Grouped by Scope)

### GROUP 1 — Video / Photography / Studio (6 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/veo-routes.ts` | AUTH / ERROR DISCLOSURE / UPLOAD SAFETY | ❌ **HIGH** | Most routes use `authMiddleware` and `scopedKey(userId, imageId)` for per-user upload isolation. But `/api/veo/status` (L290) and `/api/veo/video-proxy` (L333) have **no `authMiddleware`** — they rely solely on a valid `operationName`/`url` (which embeds an API key) as the access control, which is security-by-obscurity, not authentication. Raw error messages leak to the client at L97, L129, L286 (truncated but still raw), L329. Upload validated by mimetype + extension only — no magic-byte inspection. 20MB limit enforced (L14). Cleanup uses swallowed `catch {}` at L52, L77, L128 (acceptable for best-effort file unlink). |
| `server/video-routes.ts` | AUTH / ERROR DISCLOSURE / UPLOAD SAFETY | ⚠️ MEDIUM | Every route uses `authMiddleware`; `loadOwnedProject` + `resolveAccountId` enforce tenant isolation consistently. Raw error message leak at L516. Upload validated by mimetype + extension only (no content sniffing). 200MB size limit enforced (L65). Files stored at `/uploads/videos` with UUID-randomized filenames, but the path appears to be served via static middleware (`/uploads/videos/:filename`, L175) — filenames are unguessable but not access-controlled beyond that. |
| `server/video-routes-helpers.ts` | — | ✅ PASS | Helper library only, no routes, no direct findings. |
| `server/photography-routes.ts` | AUTH / UPLOAD SAFETY | ✅ PASS | Mutating/private routes use `authMiddleware` with `accountId` ownership checks; public marketplace listing routes intentionally use `optionalAuth` for browsing (by design, not a gap). Upload: mimetype validated as `image/*`, 15MB limit enforced (L45). Generic error strings used, with one legitimate structured Postgres error check (`error?.code === "23505"`, L85). |
| `server/caption-engine.ts` | AI ABUSE / SILENT FAILURE | ⚠️ MEDIUM | Internal engine, filters by `accountId` correctly. No local rate limiting or per-account generation cap — relies entirely on the global `aiSpendCapPerAccount` middleware being registered upstream. L214 catch logs the error but falls back to hardcoded caption templates rather than surfacing the failure — a soft/silent degradation, not a bare swallow. |
| `server/studio-analysis-engine.ts` | SILENT FAILURE | ✅ PASS | No bare `catch {}` blocks — every catch logs to `console.error` and sets `analysisStatus = FAILED` (L72, L104), which is the correct pattern. |

### GROUP 2 — `server/agent/` (4 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/agent/index.ts` | — | ✅ PASS | Internal `AgentOperator` class bridging routes to the orchestrator; no direct route/auth surface. |
| `server/agent/routes.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | `authMiddleware` + `assertCampaignBelongsTo` enforced correctly (L11, L21). But the SSE error frame at L48 (`res.write({... error: error.message})`) leaks the raw error message to the client mid-stream. SSE write-failure catch (L51–56) logs properly (`SSE_ERROR_WRITE_FAILED`) — not a silent swallow. |
| `server/agent/dual-analysis-routes.ts` | AUTH / TENANT ISOLATION | ✅ PASS | `resolveAccountId` + `assertCampaignBelongsTo` on both POST and GET variants (L356–357, L372–373). All queries scope by both `accountId` and `campaignId` (L184–192, L196–204). Generic error responses only (L364, L380). AI-call failure has a deterministic fallback rather than a silent failure (L317–334). |
| `server/agent/summarizers.ts` | — | ✅ PASS | Pure utility; JSON-parse catch returns a safe default string, not a silent swallow. |

### GROUP 3 — `server/lead-engine/` (10 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/lead-engine/ai-lead-optimization-routes.ts` | TENANT ISOLATION / ERROR DISCLOSURE | ❌ **HIGH** | `leads`, `conversionEvents`, `ctaVariants`, `publishedPosts` queries (L30, 31, 34, 36) scope by `accountId` only — no `campaignId` pairing even though this is campaign-relevant data. Raw error message leaks at L127, L166. |
| `server/lead-engine/conversion-tracking-routes.ts` | AUTH / ERROR DISCLOSURE / SILENT CATCH | ❌ **HIGH** | `GET /api/conversion-events` (L119–142) has no `requireCampaign`/ownership check. Raw error leaks at L45, L115, L140, L181. Bare `catch {}` at L77–81 serves a fallback tracking pixel on failure — functionally reasonable for a pixel endpoint, but still swallows the underlying error with no logging. |
| `server/lead-engine/cta-engine-routes.ts` | AUTH / ERROR DISCLOSURE | ⚠️ MEDIUM | `GET /api/cta-variants` (L81–104) lacks ownership verification. Raw error leaks at L77, 102, 132, 158, 175, 227. |
| `server/lead-engine/feature-flag-routes.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | Raw error leaks at L19, 38, 49, 60, 71 — no isolation/auth issues found. |
| `server/lead-engine/funnel-logic-routes.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | Raw error leaks at L37, 57, 73, 83, 132, 166. |
| `server/lead-engine/index.ts` | ROUTE REGISTRATION | ✅ PASS | Pure registration, no logic to audit. |
| `server/lead-engine/landing-page-routes.ts` | AUTH / ERROR DISCLOSURE | ❌ **HIGH** | **None** of the CRUD routes (GET/POST/PUT/DELETE, L10, L25, L52, L117) have campaign ownership verification — landing pages are created/edited/deleted without confirming the caller owns the associated campaign. Raw error leaks at L21, 48, 83, 113, 122. |
| `server/lead-engine/lead-capture-routes.ts` | TENANT ISOLATION / ERROR DISCLOSURE | ⚠️ MEDIUM | `allLeads` query (L280) scopes by `accountId` only, no `campaignId` pairing. Raw error leaks across 11 sites (L32, 62, 91, 103, 118, 139, 159, 216, 252, 267, 301) — the widest error-disclosure surface in the batch. |
| `server/lead-engine/lead-magnet-routes.ts` | AUTH / ERROR DISCLOSURE | ❌ **HIGH** | **None** of the CRUD routes (L11, L26, L82, L122) have campaign ownership verification. Raw error leaks at L22, 78, 97, 118, 127. |
| `server/lead-engine/revenue-attribution-routes.ts` | TENANT ISOLATION / ERROR DISCLOSURE | ⚠️ MEDIUM | `revenueEntries`, `adSpendEntries`, `leads` queries (L122, 126, 135) scope by `accountId` only, no `campaignId` pairing — financial data with weaker isolation than the rest of the app. Raw error leaks at L25, 68, 92, 107, 164. |

### GROUP 4 — Output Projection / Collector / Performance Feedback / Performance Signal (13 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/output-projection/context-kernel.ts` | TENANT ISOLATION | ✅ PASS | Every query pairs `accountId` + `campaignId` (L126, L132, L139, L144). |
| `server/output-projection/engine-contract.ts` | — | ✅ PASS | Schema/validation utility only, no DB access. |
| `server/output-projection/engine-registry.ts` | — | ✅ PASS | In-memory registry, no tenant data. |
| `server/output-projection/execution-map.ts` | — | ✅ PASS | Static mapping logic, no tenant data. |
| `server/output-projection/index.ts` | — | ✅ PASS | Export surface only. |
| `server/output-projection/output-types.ts` | — | ✅ PASS | Enum/type definitions, no tenant data. |
| `server/output-projection/type-enforcement.ts` | — | ✅ PASS | Pure validation utility, no tenant data. |
| `server/output-projection/uncertainty-guard.ts` | — | ✅ PASS | Aggregation utility over already-scoped inputs, no direct DB access. |
| `server/collector/discovery.ts` | TENANT ISOLATION | ✅ PASS | Reads scoped by `accountId` (L71, L99). |
| `server/collector/envelope.ts` | — | ✅ PASS | Type definitions only. |
| `server/collector/index.ts` | TENANT ISOLATION | ✅ PASS | Reads and writes both scoped by `accountId` (L142 read, L265 write). |
| `server/performance-feedback/routes.ts` | ERROR DISCLOSURE | ⚠️ MEDIUM | Fire-and-forget memory mutation failures are logged, not silently discarded (L137–139) — correct pattern. However, the manual-trigger route leaks raw `err.message` to the client (L168–170). |
| `server/performance-feedback/scoring.ts` | — | ✅ PASS | No isolation, disclosure, or silent-catch issues surfaced. |
| `server/performance-signal/normalizer.ts` | — | ✅ PASS | No `try/catch` blocks present; nothing to swallow. |

---

## B) Summary by Category

| Category | Findings | Status |
|---|---|---|
| **AUTH & ROUTE PROTECTION** | Video/photography/agent routes are consistently authenticated. **Two unauthenticated routes found**: `veo-routes.ts` `/api/veo/status` and `/api/veo/video-proxy` rely on possession of an opaque `operationName`/`url` instead of `authMiddleware`. **Lead-engine has the weakest coverage**: `landing-page-routes.ts` and `lead-magnet-routes.ts` have zero ownership verification on any CRUD route; `conversion-tracking-routes.ts` GET and `cta-engine-routes.ts` GET are also unchecked. | ❌ **HIGH** |
| **ERROR DISCLOSURE** | Widespread. Confirmed raw `err.message`/`error.message` leaks in `veo-routes.ts` (4 sites), `video-routes.ts` (1), `agent/routes.ts` (1, via SSE), `performance-feedback/routes.ts` (1), and **9 of 10** lead-engine route files (40+ individual sites, `lead-capture-routes.ts` alone has 11). This is the single largest category of findings in the batch. | ❌ **HIGH** |
| **FILE UPLOAD SAFETY** | All three upload surfaces (veo 20MB, video 200MB, photography 15MB) enforce server-side size limits. All three validate only by `mimetype` + file extension — **no magic-byte/content-sniffing validation** (e.g. `file-type` library) anywhere, so a renamed malicious file with a spoofed MIME type would pass. Storage uses UUID-randomized filenames (not sequential/guessable), but `video-routes.ts` serves files from a static `/uploads/videos/:filename` path with no additional access control beyond filename opacity. | ⚠️ MEDIUM |
| **AI GENERATION ABUSE** | `veo-routes.ts` enforces a per-generation credit deduction against `users.videoCredits` (L178–191), which is a real cap. `caption-engine.ts` has **no local rate limiting** and depends entirely on the global `aiSpendCapPerAccount` middleware (`server/middleware/ai-spend-cap.ts`) being registered — this audit did not confirm it is actually wired into the caption-generation route path. | ⚠️ MEDIUM |
| **TENANT ISOLATION** | Strong in `agent/`, `output-projection/`, and `collector/` — every query pairs `accountId` (+ `campaignId` where relevant). **Weak in `lead-engine/`**: `ai-lead-optimization-routes.ts`, `lead-capture-routes.ts` (`allLeads`), and `revenue-attribution-routes.ts` all scope key queries by `accountId` only, omitting `campaignId` even though the data is campaign-scoped elsewhere in the app. Not a cross-*tenant* leak (accountId is still enforced) but a cross-*campaign* leak within the same account. | ⚠️ MEDIUM |
| **SILENT FAILURES** | Generally well-handled in this batch. `studio-analysis-engine.ts` and `performance-feedback/routes.ts` log correctly. One true bare-swallow: `conversion-tracking-routes.ts` L77–81 catches silently to serve a fallback tracking pixel with no logging of the underlying failure. `caption-engine.ts` L214 and `veo-routes.ts` cleanup catches are soft-degradation/best-effort patterns, not true silent failures. | ✅ PASS (minor exception) |

---

## C) Top Fixes Prioritized by Severity

1. **[CRITICAL] Add ownership verification to `landing-page-routes.ts` and `lead-magnet-routes.ts`** — every CRUD route in both files currently has zero campaign-ownership check. This is the most severe finding in the batch: a user could potentially read/modify/delete landing pages or lead magnets belonging to a campaign they do not own if `campaignId` is supplied directly.
2. **[HIGH] Authenticate `veo-routes.ts` `/api/veo/status` and `/api/veo/video-proxy`** — add `authMiddleware` rather than relying on the opaque `operationName`/embedded-API-key URL as the sole access control.
3. **[HIGH] Add ownership checks to remaining unchecked lead-engine GET routes** — `conversion-tracking-routes.ts` `GET /api/conversion-events` and `cta-engine-routes.ts` `GET /api/cta-variants`.
4. **[HIGH] Error-disclosure sweep across `lead-engine/`** — replace raw `err.message`/`error.message` responses with generic messages + server-side logging across all 9 affected files (highest-density: `lead-capture-routes.ts` with 11 sites). This is the single largest fix by line count in the batch.
5. **[MEDIUM] Error-disclosure fixes outside lead-engine** — `veo-routes.ts` (L97, 129, 286, 329), `video-routes.ts` (L516), `agent/routes.ts` SSE error frame (L48), `performance-feedback/routes.ts` (L168–170).
6. **[MEDIUM] Pair `campaignId` with `accountId` in lead-engine financial/lead queries** — `ai-lead-optimization-routes.ts` (leads, conversionEvents, ctaVariants, publishedPosts), `lead-capture-routes.ts` (`allLeads`), `revenue-attribution-routes.ts` (revenueEntries, adSpendEntries, leads) — prevents cross-campaign bleed within the same account.
7. **[MEDIUM] Add content-sniffing validation to all three upload routes** — use a magic-byte library (e.g. `file-type`) in addition to the existing mimetype/extension checks for veo, video, and photography uploads, closing the spoofed-MIME-type gap.
8. **[MEDIUM] Confirm `aiSpendCapPerAccount` is actually registered on the caption-generation route path** — `caption-engine.ts` has no local cap of its own, so this is the only backstop against unlimited caption generation; verify it's wired in `server/index.ts`, not just present in the codebase.
9. **[LOW] Log the swallowed error in `conversion-tracking-routes.ts` L77–81** — keep the fallback-pixel behavior (correct for a tracking pixel endpoint) but add a `console.error` so silent tracking failures are still observable.

---

## D) Explicit Answers

**Q1: Are file uploads (video/photography) validated and rate-limited?**

Partially. All three upload endpoints (veo, video, photography) enforce a server-side file size limit (20MB / 200MB / 15MB respectively) and validate file type via `mimetype` + extension — but none perform actual content/magic-byte inspection, so a file with a spoofed MIME type would pass validation. There is no dedicated per-route rate limit on upload frequency in any of the three files; veo generation is metered via a video-credit deduction system, but the upload step itself (as opposed to the AI generation step) is not separately rate-limited.

**Q2: Can users trigger unlimited AI generation via veo or caption routes?**

Veo: no — generation is gated by a real per-account credit system (`videoCredits` checked and deducted, L178–191 of `veo-routes.ts`), so a user without credits cannot generate. Caption: unclear/at-risk — `caption-engine.ts` has no local cap of its own and depends entirely on the global `aiSpendCapPerAccount` middleware; this audit did not verify that middleware is actually mounted on the caption-generation route, so if it isn't wired there, caption generation would be effectively unlimited.

**Q3: Does lead-engine properly isolate data between accounts?**

Account-level isolation is solid — every query found scopes by `accountId`, so genuine cross-tenant access was not found. However, isolation is weaker at the *campaign* level: `ai-lead-optimization-routes.ts`, `lead-capture-routes.ts` (`allLeads`), and `revenue-attribution-routes.ts` scope by `accountId` only, without also filtering by `campaignId`, so a user could see leads/revenue data blended across all of their own campaigns rather than the one they're viewing. Separately, `landing-page-routes.ts` and `lead-magnet-routes.ts` have no ownership verification on any route at all — this is the more serious gap since it means the *authorization* check itself (does this campaignId belong to this account) is missing, not just query-level scoping.
