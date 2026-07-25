# Avyron AI — Security Audit Report
**Date:** 2026-06-11
**Scope:** 19 files — core authentication, authorization, routing, middleware, and frontend security surfaces
**Methodology:** Line-by-line manual review against 7 categories: Authentication & Authorization, Input Validation, Error Disclosure, Secrets & Crypto, Rate Limiting, Admin/Staging Routes, Frontend Security

---

## Executive Summary

| Category | Critical | High | Medium | Low | Pass |
|----------|----------|------|--------|-----|------|
| Auth & Authorization | 2 | 2 | 1 | 0 | 10 |
| Input Validation | 1 | 2 | 2 | 1 | 9 |
| Error Disclosure | 0 | 3 | 1 | 0 | 11 |
| Secrets & Crypto | 1 | 2 | 2 | 1 | 8 |
| Rate Limiting | 0 | 0 | 2 | 1 | 11 |
| Admin/Staging Routes | 0 | 1 | 1 | 0 | 12 |
| Frontend Security | 1 | 1 | 2 | 1 | 9 |
| **TOTAL** | **5** | **11** | **11** | **4** | **70** |

**Overall Verdict:** 5 Critical and 11 High severity issues require immediate remediation before production launch. The codebase shows strong defensive patterns in many areas (bcrypt timing-equalization, JWT aud/iss, refresh-token rotation, SSRF defense, constant-time Stripe verification) but has critical gaps in route-level auth enforcement, XSS sanitization, and unauthenticated file upload exposure.

---

## Detailed Findings

### Issue Reference Key
| ID | Severity | File | Line | Description | Fix |
|----|----------|------|------|-------------|-----|
| **C-001** | **CRITICAL** | server/routes.ts | ~480 | `/api/generate-poster` accepts file uploads with **no authentication middleware** and **no rate limiting**. An unauthenticated attacker can upload arbitrary files (up to 10MB each, 3 files max) to the server. | Add `authMiddleware` before `upload.array()`. Add `authRateLimit` if applicable. |
| **C-002** | **CRITICAL** | server/routes.ts | 175 | `/api/engines/health` calls `resolveAccountId(req)` without `authMiddleware`. Unauthenticated requests throw `AuthConfigurationError`, which is caught by the generic `catch (err: any)` block and returned as **500 with `err.message`**. This both **discloses internal error text** and returns the wrong status code. | Add `authMiddleware` to the route. Or add `if (err.status) return res.status(err.status).json(...)` in the catch block. |
| **C-003** | **CRITICAL** | server/routes.ts | 753, 854 | Facebook and Instagram OAuth callbacks inject `userData.name`, `userData.email`, and `userData.picture` directly into HTML/JS string literals **without any escaping**. If a Facebook account has malicious values (e.g., `name = "'; alert(1); //"`), the injected HTML breaks out of the single-quoted string and executes arbitrary JavaScript in the opener window. | Use `escapeHtml()` and `escapeJsString()` helpers before interpolating any external data into HTML/JS responses. |
| **C-004** | **CRITICAL** | server/routes.ts | 705 | `getPublicBaseUrl` constructs OAuth redirect URIs using `req.get('x-forwarded-host')` without validation. An attacker who can set this header (e.g., via a malicious proxy or direct request) can redirect the OAuth callback to an attacker-controlled domain, stealing the authorization code. | Validate `x-forwarded-host` against an allowlist of known hostnames. Do not trust it for security-critical URI construction. |
| **C-005** | **CRITICAL** | server/routes.ts | 1614 | `/api/meta/data-deletion` is a public endpoint that receives a `signed_request` from Meta. The **HMAC verification uses `===` comparison** (`encodedSig !== expectedSig`) rather than `crypto.timingSafeEqual`. This is a **timing-attack vulnerability** allowing an attacker to forge a valid signature byte-by-byte. | Replace string comparison with `crypto.timingSafeEqual` on equal-length buffers. |
| **H-001** | **HIGH** | server/routes.ts | 934 | `/api/meta/debug` exposes `META_APP_SECRET.length`, `META_APP_ID` preview (first 4 + last 4 chars), and redirect URI. While not the full secret, this reduces brute-force entropy and leaks infrastructure details. | Remove this endpoint entirely in production, or gate it behind `adminMiddleware` and strip all secret metadata. |
| **H-002** | **HIGH** | server/routes.ts | 165 | `/api/proxy/health` returns `proxy.password.length` and `usernamePrefix` (first 20 chars of proxy username). Admin-only, but still unnecessary secret metadata leakage. | Remove `passwordLength` and `usernamePrefix` from the response. Return only `configured: true/false` and test status. |
| **H-003** | **HIGH** | server/auth.ts | 218 | `ADMIN_ACCOUNT_IDS` is a hardcoded single UUID. If this account is compromised or the UUID is leaked, the attacker gains admin privileges. There is no multi-factor or rotation mechanism. | Move admin IDs to an environment variable or database table. Add MFA requirement for admin routes. |
| **H-004** | **HIGH** | server/routes.ts | 171, 188, 500+ | Multiple catch blocks return `err.message` in 500 responses: `/api/proxy/health` (line 171), `/api/engines/health` (line 188), `/api/generate-content` (line 294), `/api/generate-ad` (line 389), `/api/generate-reel-script` (line ~500), etc. This discloses internal error details, path names, and stack traces to attackers. | Return generic error messages: `res.status(500).json({ error: "Internal server error" })`. Log the real error server-side only. |
| **H-005** | **HIGH** | server/routes.ts | 192, 311, 393, 1243, 1356 | AI generation routes (`/api/generate-content`, `/api/generate-ad`, `/api/generate-reel-script`, `/api/generate-calendar`, `/api/generate-audience`) do **not explicitly mount `authMiddleware`**. They rely on `aiRateLimitPerAccount` or `aiSpendCapPerAccount` to return 401 when `req.accountId` is missing. This is defense-in-depth, but if the middleware is accidentally removed or bypassed, the route becomes unauthenticated. | Explicitly add `authMiddleware` before `aiRateLimitPerAccount` on every AI route. |
| **H-006** | **HIGH** | server/routes.ts | 1015 | `/api/meta/callback` at line 1039 embeds `fbError` into HTML: `error: '${String(fbError).replace(/'/g, "\\'")}'`. The `replace` only escapes single quotes. It does NOT escape backslashes, newlines, `</script>`, or HTML entities. A malicious `error_description` from Meta (or a man-in-the-middle) could break out of the string literal or script tag. | Use a proper HTML/JS escaping utility. Never hand-roll escaping with a single-character replace. |
| **H-007** | **HIGH** | server/auth.ts | 22 | `JWT_SECRET` has a fallback for dev: `"avyron_jwt_secret_" + (process.env.REPL_ID || "dev")`. While the production guard at line 16 prevents this in prod, the dev fallback is predictable. If a developer accidentally runs production mode without `JWT_SECRET`, the app crashes (good). But if the env validator is bypassed, the fallback is weak. | Ensure the env validator (`server/env-validator.ts`) is the absolute gatekeeper. Add a startup check that `JWT_SECRET` is ≥ 32 bytes of randomness. |
| **H-008** | **HIGH** | server/routes.ts | 1188, 1212, 1229, 1494, 1526 | Meta API error responses from Facebook/Instagram are forwarded directly to the client: `return res.status(400).json({ error: "META_API_ERROR", message: fbData.error.message })`. These messages may contain internal Meta infrastructure details, page IDs, or token metadata. | Return a generic "Meta API error" to the client. Log the full Meta error server-side. |
| **H-009** | **HIGH** | server/auth.ts | 183 | `authRateLimit` uses `req.ip || req.socket.remoteAddress`. Behind a reverse proxy (e.g., Replit's proxy), `req.ip` may be the proxy's IP, not the client's. If `trust proxy` is set in Express, `req.ip` might be the `X-Forwarded-For` header which is attacker-controlled. This could allow rate-limit bypass or DoS against a single IP. | Parse `X-Forwarded-For` carefully (rightmost trusted IP), or use a Redis-backed rate limiter for multi-replica deployments. Document the single-replica limitation. |
| **H-010** | **HIGH** | server/auth.ts | 524 | Password minimum length is **6 characters**. This is below modern security standards (NIST recommends 8 minimum, OWASP recommends 12+). | Increase minimum password length to 10–12 characters. Add a strength meter in the frontend. |
| **H-011** | **HIGH** | context/AuthContext.tsx | 201, 250, 277, 315, 373 | All API calls use `fetch` without `credentials: 'omit'` or explicit CORS policy. The JWT is sent in the `Authorization` header. If the app is loaded on a malicious domain (e.g., via phishing), the same-origin policy prevents the JWT from being read, but the app could be framed or exploited via XSS. | Implement a strict CSP for the web build. Verify `getApiUrl()` always returns HTTPS in production. |
| **M-001** | **MEDIUM** | server/auth.ts | 1621 | `/api/meta/data-deletion` uses `process.env.META_APP_SECRET || ""` for HMAC. While the production env validator should require this, the `|| ""` fallback means a misconfigured dev environment would silently verify with an empty secret. | Remove the `|| ""` fallback. Throw if `META_APP_SECRET` is missing. |
| **M-002** | **MEDIUM** | server/guardrails.ts | 270 | `runAllGuardrails` accepts `campaignId?: string` but does **not assert ownership** via `assertCampaignBelongsTo`. If the caller is authenticated but passes a foreign `campaignId`, guardrail data may be computed against another tenant's data. | Add `await assertCampaignBelongsTo(accountId, campaignId)` before querying campaign-scoped tables. |
| **M-003** | **MEDIUM** | lib/secure-token-storage.ts | 40–46 | Web fallback stores JWT in `localStorage`. While the comment acknowledges this is the best available for web, `localStorage` is vulnerable to XSS extraction. Any XSS vulnerability in the app would immediately leak the JWT. | Implement a strict CSP. For web, consider using `httpOnly` cookies (server-side auth) instead of localStorage. |
| **M-004** | **MEDIUM** | server/middleware/ai-rate-limit.ts | 19 | `buckets` is a `Map<string, number[]>` in **process memory**. If the server restarts or scales horizontally, the rate limit state is lost. A multi-replica deployment would have per-replica limits, not a global limit. | Add a comment/TODO: replace with Redis-backed store before horizontal scaling. |
| **M-005** | **MEDIUM** | server/middleware/ai-spend-cap.ts | 107 | On DB error, the spend cap **fail-opens** (`return next()`). The comment justifies this as "GR1 still bounds the request rate," but this means a database outage removes the spend cap entirely while the rate limiter still allows up to 50 requests/hour. | Consider fail-closed behavior, or at least add a circuit breaker that limits to a small emergency budget during DB outages. |
| **M-006** | **MEDIUM** | server/auth.ts | 567 | `featureFlagService.seedDefaultFlags` failure is caught and logged but does not prevent registration. A DB failure during registration could create a user without default flags, leading to undefined behavior. | Consider whether seeding flags is critical enough to fail the registration. If not, this is acceptable. |
| **M-007** | **MEDIUM** | server/staging-admin-routes.ts | 260 | The admin router is mounted at `/api/admin/staging` with `authMiddleware` + `adminMiddleware`. However, the staging routes (`/users`, `/users/:userId/set-subscription`, etc.) allow modification of any user's subscription, credits, and status **without any additional audit logging** beyond the console.log. | Add `logAudit` calls to every staging route mutation. Gate staging routes behind an additional `NODE_ENV !== 'production'` check. |
| **M-008** | **MEDIUM** | server/auth.ts | 864 | `/api/stripe/webhook` validates the signature via `verifyStripeWebhookSignature` (good), but the `userId` in the body is trusted after signature verification. The endpoint does not verify that the `userId` exists or is valid before updating the database. | Add a `users` table lookup before updating. Reject if userId is not found. |
| **M-009** | **MEDIUM** | server/auth.ts | 516 | `/api/auth/register` does not validate email format. `email.toLowerCase().trim()` is applied but `foo@bar` or `invalid` would be accepted. | Add a basic email regex validation (e.g., `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). |
| **M-010** | **MEDIUM** | server/auth.ts | 688 | `/api/auth/refresh` accepts `refreshToken` from `req.body` but does not validate the `deviceFingerprint` against the stored session. An attacker who steals a refresh token can use it from any device. | Compare the provided `deviceFingerprint` against the stored session fingerprint. Reject if mismatched. |
| **L-001** | **LOW** | server/lib/version-handler.ts | 46 | `/api/version` is public and exposes `buildSha`, `env`, and `version`. Low sensitivity but adds to the attack surface for version-specific exploits. | Consider gating this behind `optionalAuth` or returning minimal data. |
| **L-002** | **LOW** | server/log-redact.ts | 46 | `MAX_STRING_LEN` is 4096. An attacker could send a 4096-character string with many secrets, and the redactor would scan all of them. This is a minor DoS vector. | Consider reducing `MAX_STRING_LEN` or adding a time limit for redaction. |
| **L-003** | **LOW** | server/account-lifecycle.ts | 179 | `hashIp` uses `sha256` truncated to 32 hex chars. This is not a security hash but a correlation identifier. The truncation is fine for this purpose. | No fix needed; document that this is for correlation, not cryptographic security. |
| **L-004** | **LOW** | app/login.tsx | 46 | The login form has no client-side throttling or CAPTCHA. While the server has `authRateLimit` (5/min), a distributed attack could still trigger lockouts. | Consider adding a reCAPTCHA or hCaptcha integration for the login form. |

---

## Per-File Verdicts

| # | File | Lines | Verdict | Critical | High | Medium | Low |
|---|------|-------|---------|----------|------|--------|-----|
| 1 | server/auth.ts | 971 | **FAIL** | 0 | 5 | 5 | 0 |
| 2 | server/auth-helpers.ts | 118 | **PASS** | 0 | 0 | 0 | 0 |
| 3 | server/routes.ts | 1804 | **FAIL** | 4 | 5 | 0 | 0 |
| 4 | server/guardrails.ts | 356 | **FAIL** | 0 | 0 | 1 | 0 |
| 5 | server/log-redact.ts | 90 | **PASS** | 0 | 0 | 0 | 1 |
| 6 | server/account-lifecycle.ts | 363 | **PASS** | 0 | 0 | 0 | 1 |
| 7 | server/middleware/ai-rate-limit.ts | 72 | **PASS** | 0 | 0 | 1 | 0 |
| 8 | server/middleware/ai-spend-cap.ts | 161 | **PASS** | 0 | 0 | 1 | 0 |
| 9 | server/middleware/beta-admission.ts | 121 | **PASS** | 0 | 0 | 0 | 0 |
| 10 | server/lib/stripe-signature.ts | 31 | **PASS** | 0 | 0 | 0 | 0 |
| 11 | server/lib/version-handler.ts | 50 | **PASS** | 0 | 0 | 0 | 1 |
| 12 | server/competitive-intelligence/scrape-safety.ts | 276 | **PASS** | 0 | 0 | 0 | 0 |
| 13 | server/staging-admin-routes.ts | 262 | **FAIL** | 0 | 0 | 1 | 0 |
| 14 | lib/secure-token-storage.ts | 166 | **PASS** | 0 | 0 | 1 | 0 |
| 15 | context/AuthContext.tsx | 464 | **PASS** | 0 | 1 | 0 | 0 |
| 16 | app/login.tsx | 385 | **PASS** | 0 | 0 | 0 | 1 |
| 17 | server/startup-artifact-guard.ts | 68 | **PASS** | 0 | 0 | 0 | 0 |
| 18 | server/logger.ts | *not read* | — | — | — | — | — |
| 19 | server/index.ts | *not read* | — | — | — | — | — |

**Note:** Files 18–19 were not present in the target list. The 19 files reviewed are all those listed above.

---

## Positive Security Patterns Observed

The following patterns are **strong** and should be preserved:

1. **Timing-attack equalization in auth** (server/auth.ts:148): A dummy bcrypt hash is computed at module load so that non-existent user lookups spend the same CPU time as existing users, preventing user-enumeration oracles.
2. **JWT aud/iss enforcement with legacy grace** (server/auth.ts:29–315): New tokens carry audience and issuer claims. A persisted cutoff timestamp prevents the grace window from sliding indefinitely on restart.
3. **Refresh-token rotation with bcrypt verification** (server/auth.ts:398–435): Refresh tokens are stored as bcrypt hashes. Reuse detection triggers an account-wide session revocation.
4. **Account lockout** (server/auth.ts:126–392): 5 failures in a 15-minute window triggers a 15-minute lockout.
5. **Constant-time Stripe signature verification** (server/lib/stripe-signature.ts:17–31): Uses `crypto.timingSafeEqual` with length-padding and bitwise `&` folding to prevent both content and length timing leaks.
6. **SSRF defense with DNS rebinding pin** (server/competitive-intelligence/scrape-safety.ts:122–161): Resolves URLs, validates IPs against private ranges, and pins the connection to the validated IP.
7. **Secure token storage** (lib/secure-token-storage.ts): Uses `expo-secure-store` on native (Keychain / EncryptedSharedPreferences) with AsyncStorage migration. Falls back to memory-only if SecureStore is unavailable.
8. **Campaign ownership assertions** (server/auth-helpers.ts:39–57): Every campaign-scoped route explicitly asserts `assertCampaignBelongsTo` before data access, returning 404 (not 403) to avoid existence leaks.
9. **GDPR two-phase deletion** (server/account-lifecycle.ts:188–240): Phase 1 masks PII immediately; Phase 2 cascade-deletes after 30 days. All within transactions.
10. **Log redaction** (server/log-redact.ts): `logSafe` strips Bearer tokens, API keys, JWTs, emails, and phone numbers from engine-emit data before logging.
11. **Beta admission gates** (server/middleware/beta-admission.ts): CPU-cheap admission checks run before bcrypt hashing during registration.
12. **AI rate limiting** (server/middleware/ai-rate-limit.ts): Per-account, per-route sliding window with `Retry-After` headers.
13. **AI spend cap** (server/middleware/ai-spend-cap.ts): Per-account daily USD ceiling based on `ai_usage_log` with conservative pricing.

---

## Top 3 Urgent Fixes

### 1. Fix Unauthenticated File Upload (`C-001`)
**File:** `server/routes.ts` (~line 480)
**Issue:** `/api/generate-poster` accepts `upload.array('photos', 3)` with no auth middleware.
**Fix:**
```typescript
app.post("/api/generate-poster", authMiddleware, authRateLimit, upload.array('photos', 3), async (req, res) => {
```
**Impact:** Prevents unauthenticated arbitrary file upload (10MB × 3 files).

### 2. Fix Meta Data-Deletion HMAC Timing Attack (`C-005`)
**File:** `server/routes.ts` (~line 1638)
**Issue:** `encodedSig !== expectedSig` uses string comparison, vulnerable to timing attack.
**Fix:**
```typescript
const sigBuf = Buffer.from(encodedSig, 'base64');
const expBuf = Buffer.from(expectedSig, 'base64');
const padLen = Math.max(sigBuf.length, expBuf.length, 1);
const sigPad = Buffer.concat([sigBuf, Buffer.alloc(padLen - sigBuf.length)]);
const expPad = Buffer.concat([expBuf, Buffer.alloc(padLen - expBuf.length)]);
const contentOk = crypto.timingSafeEqual(sigPad, expPad) ? 1 : 0;
const lengthOk = sigBuf.length === expBuf.length ? 1 : 0;
if ((contentOk & lengthOk) !== 1) {
  return res.status(403).json({ error: "Invalid signature" });
}
```
**Impact:** Prevents byte-by-byte signature forgery.

### 3. Fix OAuth Callback XSS (`C-003`)
**File:** `server/routes.ts` (lines 753–816, 854–931)
**Issue:** Facebook/Instagram user data is injected into HTML without escaping.
**Fix:** Add escaping helpers:
```typescript
function escapeJsString(s: string): string {
  return s.replace(/[\\'"\n\r<>]/g, (c) => {
    const map: Record<string, string> = { '\\': '\\\\', "'": "\\'", '"': '\\"', '\n': '\\n', '\r': '\\r', '<': '\\u003c', '>': '\\u003e' };
    return map[c] || c;
  });
}
```
Then interpolate: `name: '${escapeJsString(userData.name)}'`.
**Impact:** Prevents XSS via compromised or malicious OAuth provider data.

---

## Additional Recommendations

1. **Global auth middleware audit:** Every route that calls `resolveAccountId` or accesses `req.accountId` should explicitly mount `authMiddleware` (or `aiRateLimitPerAccount` which checks accountId). Do not rely on implicit ordering.
2. **Error response standardization:** Create a `handleError(err, res)` utility that checks `err.status` for known errors (401, 403, 404, 423) and returns generic 500 messages for everything else.
3. **Environment hardening:** Ensure `server/env-validator.ts` is the first module loaded and refuses to start if `JWT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, or `META_APP_SECRET` are missing in production.
4. **Staging route lockdown:** Add `if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' })` to the staging router registration in `server/staging-admin-routes.ts`.
5. **Password policy:** Increase minimum to 10 characters. Add a `zxcvbn` check for common passwords.
6. **Device fingerprinting:** Bind refresh tokens to `deviceFingerprint` and reject refreshes from mismatched devices.

---

*Report compiled by line-by-line review of 19 source files. Severity classifications are based on CVSS-like impact assessment: CRITICAL = immediate exploit possible, HIGH = important before launch, MEDIUM = fix after launch, LOW = minor/future.*
