# Infrastructure Audit — Patch 1/5

**Scope:** Boot Server + Observability + Replit Integrations (23 files)
**Date:** 2026-06-28
**Auditor:** Replit Agent

---

## A) Per-File Verdict Table (Grouped by Scope)

### GROUP 1 — Boot Server (6 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/bootstrap.ts` | BOOT ORDER | ✅ PASS | Calls `validateEnv → initOTel → initSentry` in order. Sentry init catches rejection with `.catch()`. No secrets exposed. |
| `server/db.ts` | DB CONNECTION | ✅ PASS | `DATABASE_URL` from env, no credential logging. Pool tuned: max=20, 10s acquire timeout, 30s idle, 30s statement_timeout. `pool.on("error")` logs idle-client errors without crashing. |
| `server/logger.ts` | LOG REDACTION | ✅ PASS | Extensive secret scrubbing: `TOKEN_KEY_RE` matches 16+ key names, `INLINE_SECRET_PATTERNS` catches Bearer, sk-*, eyJ JWT, xoxb, ghp, AIza keys. `stripSecrets()` recurses with depth limit (6). Separate stderr for errors. |
| `server/trace-context.ts` | TRACE ID | ✅ PASS | Simple AsyncLocalStorage wrapper. No sensitive data. `mintTraceId()` generates random IDs. |
| `server/feature-flags.ts` | FLAG DEFAULTS | ✅ PASS | Safe defaults: flags missing in DB return `false`. `lead_engine_global_off` acts as kill switch. `seedDefaultFlags` creates flags on first use. `console.log` at line 78 logs accountId + flag names (not secrets). |
| `server/storage.ts` | LEGACY STORAGE | ✅ PASS | `MemStorage` with `randomUUID()`. Only user CRUD. No credentials, no secrets. Appears to be legacy/unused (real storage is Drizzle via `db.ts`). |

### GROUP 2 — Observability (6 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/observability/otel.ts` | METRICS | ✅ PASS | In-house Counter/Gauge/Histogram. Label escaping for Prometheus. Metric labels are method/route/status (HTTP), provider/model (AI cost), worker/result (ticks) — no PII. |
| `server/observability/sentry.ts` | ERROR REPORTING | ⚠️ MEDIUM | No-op when `SENTRY_DSN` unset. Dynamic import isolates init failures. **Concern:** `captureException(err, ctx)` does not scrub the `ctx` parameter before sending — callers may pass objects with PII. `setUser` interface accepts `{ email }` which means email CAN be transmitted to Sentry. `tracesSampleRate: 0` disables distributed tracing. |
| `server/meta-metrics.ts` | META METRICS | ✅ PASS | In-memory per-account metrics. 24h rolling window, bounded at 5000 calls/account. Cleanup timer prunes expired entries. `initMetaMetrics` logs audit of reset (Seal #15). No secrets in metrics. |
| `server/meta-status.ts` | META STATUS | ✅ PASS | Uses `resolveAccountId(req)` for auth. Error response at line 175 returns generic `"Failed to fetch Meta integration status"` — no raw `err.message` to client. No token logging. |
| `server/meta-token-manager.ts` | TOKEN STORAGE | ✅ PASS | Tokens encrypted with AES-256-GCM via `meta-crypto.ts` before DB storage. `storeTokensAfterOAuth` encrypts both user and page tokens (lines 197–198). Auto-extension re-encrypts on refresh. Health check decrypts in-memory only. No plaintext token logging. |
| `server/meta-error-classifier.ts` | ERROR CLASSIFIER | ✅ PASS | Pure classification logic. Maps Meta error codes to PERMANENT/TEMPORARY. No secrets, no raw error exposure. |

### GROUP 3 — Replit Integrations (11 files)

| File | Category | Verdict | Notes |
|---|---|---|---|
| `server/replit_integrations/chat/index.ts` | EXPORTS | ✅ PASS | Re-exports only. No logic. |
| `server/replit_integrations/chat/routes.ts` | CHAT ROUTES | ⚠️ MEDIUM | All 5 routes use `resolveAccountId(req)` for auth. Campaign ownership validated via `assertCampaignBelongsTo`. Conversation ownership enforced. **Issue:** `handleToolCall` at line 587–589 returns `summary: "Tool execution failed: ${err.message}"` which is sent back to the client via SSE (line 767). Raw error exposure — though auth-gated and within the user's own session. |
| `server/replit_integrations/chat/storage.ts` | CHAT STORAGE | ✅ PASS | All DB queries scoped by `eq(conversations.accountId, accountId)`. Delete cascades messages. No secrets in storage layer. |
| `server/replit_integrations/audio/client.ts` | AUDIO CLIENT | ✅ PASS | Uses `AI_INTEGRATIONS_OPENAI_API_KEY` env var (not logged). Temp file handling with `finally` cleanup. `ffmpeg.stderr` suppressed. `unlink` with `.catch(() => {})`. No secret exposure. |
| `server/replit_integrations/audio/index.ts` | EXPORTS | ✅ PASS | Re-exports only. |
| `server/replit_integrations/audio/routes.ts` | AUDIO ROUTES | ✅ PASS | Intentionally no-op (line 19–21). Historical insecure routes were removed. Comment documents the security rationale. |
| `server/replit_integrations/image/client.ts` | IMAGE CLIENT | ✅ PASS | Uses `AI_INTEGRATIONS_OPENAI_API_KEY` env var. `generateImageBuffer` returns Buffer. `editImages` uses `toFile` with stream. No secret logging. |
| `server/replit_integrations/image/index.ts` | EXPORTS | ✅ PASS | Re-exports only. |
| `server/replit_integrations/image/routes.ts` | IMAGE ROUTES | ❌ **HIGH** | `registerImageRoutes` defines `POST /api/generate-image` with **NO authentication whatsoever**. No `resolveAccountId`, no `requireAuth`, no `requireCampaign`. Any request with a `prompt` body can trigger AI image generation. Even if not currently wired (the file is outside the `/api` auth gate middleware), this is a latent full-auth-bypass for AI generation. |
| `server/replit_integrations/batch/index.ts` | EXPORTS | ✅ PASS | Re-exports only. |
| `server/replit_integrations/batch/utils.ts` | BATCH UTILS | ✅ PASS | Generic `pLimit` + `pRetry` wrapper. `isRateLimitError` checks error messages. Non-rate-limit errors abort immediately with `AbortError`. No auth (callers handle it). No secrets. |

---

## B) Summary by Category

| Category | Findings | Status |
|---|---|---|
| **SECRET & CREDENTIAL HANDLING** | DB connection string from env, not logged. Meta tokens encrypted with AES-256-GCM before DB storage. Logger scrubs tokens, JWTs, API keys, Bearer headers. Audio/image clients read API key from env but never log it. | ✅ PASS |
| **ERROR DISCLOSURE** | `image/routes.ts` returns generic `"Failed to generate image"` (safe). `chat/routes.ts` returns `error: "Failed to fetch conversations"` etc. (safe). **BUT** `chat/routes.ts` `handleToolCall` returns `summary: "Tool execution failed: ${err.message}"` in tool results sent via SSE — raw error to client. | ⚠️ MEDIUM |
| **AUTH ON REPLIT INTEGRATION ROUTES** | Chat routes: all authenticated via `resolveAccountId`. Audio routes: intentionally no-op. **Image routes: `POST /api/generate-image` has ZERO auth** — anyone can trigger AI generation. | ❌ **HIGH** |
| **BOOT SAFETY** | `bootstrap.ts` calls `validateEnv()` first. `db.ts` has pool error handling and statement timeouts. `feature-flags.ts` defaults to `false` if DB unavailable. Sentry init is `.catch()`-guarded. | ✅ PASS |
| **OBSERVABILITY SAFETY** | Logger: comprehensive secret redaction. OTel: no PII in metric labels. **Sentry: `captureException` does not scrub `ctx` parameter before sending — callers may pass PII objects. `setUser` interface accepts `email`.** | ⚠️ MEDIUM |
| **RATE LIMITING** | No per-route rate limiting in Replit integration routes. The global AI rate limit (`aiRateLimitPerAccount`) and spend cap are applied in `server/routes.ts` to `/api/generate-content`, `/api/generate-ad`, etc. — but NOT to the chat/image/audio routes. | ⚠️ MEDIUM |
| **SILENT FAILURES** | No bare `catch {}` blocks. All catch blocks either log, audit, or return error objects. `audio/client.ts` temp file cleanup uses `.catch(() => {})` on `unlink` — acceptable (cleanup failure is non-critical). `chat/routes.ts` `writeAgentActionMemory` catches with `console.warn` (Seal #15). | ✅ PASS |

---

## C) Top Fixes — Prioritized by Severity

| Priority | Severity | File | Fix |
|---|---|---|---|
| 1 | **HIGH** | `server/replit_integrations/image/routes.ts` | Add `resolveAccountId(req)` auth check before processing. If the route is dead code (not wired in `server/routes.ts`), either delete the file entirely or add auth + rate limiting to prevent future accidental exposure. |
| 2 | **MEDIUM** | `server/replit_integrations/chat/routes.ts:587-589` | Sanitize tool call error summaries. Replace `summary: "Tool execution failed: ${err.message}"` with a safe generic string like `"Tool execution failed"`. Log the raw error server-side only. |
| 3 | **MEDIUM** | `server/observability/sentry.ts` | Add PII scrubbing to `captureException`. Strip email, names, and other PII from `ctx` and `err` before calling `sentry.captureException`. Alternatively, document that callers MUST NOT pass PII in `ctx`. |
| 4 | **MEDIUM** | `server/replit_integrations/chat/routes.ts` (all routes) | Add rate limiting to chat endpoints (especially `/api/conversations/:id/messages` which triggers AI calls). Apply the same `aiRateLimitPerAccount` middleware used for other AI generation routes. |
| 5 | **LOW** | `server/observability/sentry.ts` | Consider setting `sendDefaultPii: false` in `sentry.init()` (if supported by the SDK version) to prevent accidental PII transmission. |
| 6 | **LOW** | `server/feature-flags.ts:78` | Replace `console.log` with `logger.info()` so the structured logger handles it consistently (and so the log line carries a traceId). |

---

## D) Explicit Answers to Q1–Q3

### Q1: Can unauthenticated users trigger audio/image/chat AI generation via Replit integration routes?

**Chat: NO.** All 5 chat routes (`/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`, etc.) call `resolveAccountId(req as AuthRequest)` and validate conversation ownership. The streaming message endpoint also validates campaign ownership via `assertCampaignBelongsTo`.

**Audio: NO.** `audio/routes.ts` is an intentional no-op — all HTTP routes were removed for security. The audio client helpers (`voiceChat`, `textToSpeech`, `speechToText`) are imported and used only from `chat/routes.ts`, which is behind auth.

**Image: YES — potentially.** `image/routes.ts` defines `POST /api/generate-image` with **no authentication check at all** — any request with `{ prompt, size }` in the body can trigger AI image generation. Whether this route is currently wired in `server/routes.ts` is outside the audit scope, but the file is present in the repo and the route definition itself is a full auth bypass. **This is a latent but severe security issue.**

### Q2: Does the observability stack (Sentry, OTel, logger) accidentally capture or transmit sensitive user data?

**Logger: NO — properly redacted.** The `logger.ts` `stripSecrets()` function recursively scrubs: tokens, refresh tokens, access tokens, secrets, API keys, passwords, password hashes, JWTs, session tokens, authorization headers, cookies, and inline secrets (Bearer, sk-*, eyJ JWT, xoxb, ghp, AIza keys). All log records pass through `stripSecrets()` before JSON serialization. This is the gold standard for log safety.

**OTel: NO — no PII in metrics.** The in-house metrics registry only records: HTTP method/route/status, AI provider/model, worker name/result, queue depth. No user identifiers, emails, or business data appear in metric labels.

**Sentry: POTENTIALLY — insufficient scrubbing.** `captureException(err, ctx)` forwards the `ctx` object directly to Sentry without PII scrubbing. If a caller passes `ctx: { user: { email: "..." } }`, the email is transmitted to Sentry. The `setUser` interface explicitly accepts `{ id?, email? }`, meaning email CAN be sent to Sentry. The SDK's `tracesSampleRate: 0` disables tracing (good), but there is no `sendDefaultPii: false` or custom `beforeSend` scrubber configured.

> **Recommendation:** Wrap `captureException` to run `stripSecrets()` on `ctx` before forwarding, or add a `beforeSend` hook to the Sentry init options.

### Q3: Does db.ts handle connection failures safely, or can a DB outage cause silent corruption?

**db.ts handles connection failures safely.** The `pg.Pool` configuration includes:

- `connectionTimeoutMillis: 10_000` — queries fail fast if the DB is unreachable, rather than hanging indefinitely.
- `idleTimeoutMillis: 30_000` — idle connections are closed, preventing stale connection accumulation.
- `max: 20` — bounded pool size prevents connection exhaustion.
- `pool.on("connect", ...)` sets `statement_timeout = 30s` on every new connection — any runaway query is killed by Postgres, not by the app.
- `pool.on("error", ...)` logs idle-client errors without crashing the server.

**There is no silent corruption risk.** If the DB is down:
1. The pool cannot acquire connections within 10 seconds → queries throw `connection timeout` errors.
2. These errors propagate to callers (Express routes, workers, etc.).
3. The server continues running (the pool doesn't crash the process).
4. No data is silently lost or corrupted — the queries simply fail.

The callers (routes, workers) are responsible for handling these errors. The `meta-metrics.ts` `initMetaMetrics` even has explicit `catch` handling for startup audit-write failures (Seal #15), ensuring that a DB outage at boot doesn't prevent the server from starting.
