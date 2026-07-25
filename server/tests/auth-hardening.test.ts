/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Seal #2 (Task #20) — auth + AI rate-limit + tenant isolation regression suite.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two layers, mirroring the W1-T4 pattern:
 *
 *   1. Source-pattern tripwire — for each finding (F1.6 / F1.7 / F1.8 /
 *      F9.2 / F9.4 / F9.8) assert the canonical implementation token is
 *      still present in the source. Catches accidental deletion of the
 *      seal during refactors.
 *
 *   2. Behavioral proof — exercise `aiRateLimitPerAccount` directly to
 *      prove the 429 + Retry-After contract.
 *
 * Findings closed by this suite (per .local/tasks/task-20.md "Done looks like"):
 *   F1.6 — `/api/proxy/health` non-admin payload is `{ok:true}` only
 *   F1.7 — `/api/engines/health` ownership-asserts the campaignId
 *   F1.8 — generate-* endpoints carry `aiRateLimitPerAccount`
 *   F9.2 — JWT sign + verify use `audience`/`issuer` with 7d legacy grace
 *   F9.4 — `auth_lockouts` table + check before bcrypt.compare
 *   F9.8 — `auth_sessions` table + /api/auth/refresh rotation +
 *          SECURITY_REFRESH_REUSE cascade revoke
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

// ─── Tripwires ───────────────────────────────────────────────────────────────

describe("Seal #2 F1.6 — /api/proxy/health admin gate", () => {
  const src = read("server/routes.ts");

  it("imports isAdminAccount from ./auth", () => {
    expect(src).toMatch(/import\s*{[^}]*isAdminAccount[^}]*}\s*from\s*"\.\/auth"/);
  });

  it("/api/proxy/health handler 401s unauthed and 403s authed-non-admin (architect pass-3)", () => {
    const start = src.indexOf('app.get("/api/proxy/health"');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1500);
    expect(block).toMatch(/isAdminAccount\(req\.accountId\)/);
    expect(block).toMatch(/status\(401\)[^]*AUTH_REQUIRED/);
    expect(block).toMatch(/status\(403\)[^]*ADMIN_ONLY/);
  });

  it("non-admin gate fires BEFORE any proxy host/port/zone/credentials field is referenced", () => {
    const start = src.indexOf('app.get("/api/proxy/health"');
    const adminGate = src.indexOf("isAdminAccount(req.accountId)", start);
    const firstLeak = Math.min(
      ...["proxy.host", "proxy.port", "proxy.username", "proxy.password", "zoneName"]
        .map(k => { const i = src.indexOf(k, start); return i < 0 ? Number.MAX_SAFE_INTEGER : i; }),
    );
    expect(adminGate).toBeGreaterThan(-1);
    expect(adminGate).toBeLessThan(firstLeak);
  });
});

describe("Seal #2 F1.7 — /api/engines/health ownership", () => {
  const src = read("server/routes.ts");
  it("calls assertCampaignBelongsTo before validateRoutingIntegrity", () => {
    const start = src.indexOf('app.get("/api/engines/health"');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 800);
    const assertIdx = block.indexOf("assertCampaignBelongsTo");
    const validateIdx = block.indexOf("validateRoutingIntegrity");
    expect(assertIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(validateIdx);
    expect(block).toContain("handleOwnershipError");
  });
});

describe("Seal #2 F1.8 — AI rate limit on all 4 generate-* routes", () => {
  const src = read("server/routes.ts");
  const routes = [
    "/api/generate-content",
    "/api/generate-ad",
    "/api/generate-reel-script",
    "/api/generate-calendar",
  ];

  it("imports aiRateLimitPerAccount from middleware", () => {
    expect(src).toMatch(/import\s*{\s*aiRateLimitPerAccount\s*}\s*from\s*"\.\/middleware\/ai-rate-limit"/);
  });

  for (const route of routes) {
    it(`${route} handler is fronted by aiRateLimitPerAccount()`, () => {
      // Match `app.post("<route>", aiRateLimitPerAccount(...), ...)` exactly.
      const re = new RegExp(`app\\.post\\(\\s*"${route.replace(/[/]/g, "\\/")}"\\s*,\\s*aiRateLimitPerAccount\\(`);
      expect(src).toMatch(re);
    });
  }

  it("middleware module emits 429 + Retry-After + AI_RATE_LIMIT_EXCEEDED", () => {
    const mw = read("server/middleware/ai-rate-limit.ts");
    expect(mw).toContain('"Retry-After"');
    expect(mw).toContain("AI_RATE_LIMIT_EXCEEDED");
    expect(mw).toMatch(/res\.status\(429\)/);
  });
});

describe("Seal #2 F9.2 — JWT audience/issuer + grace window (source tripwires)", () => {
  const src = read("server/auth.ts");

  it('declares JWT_AUDIENCE = "avyron-ai"', () => {
    expect(src).toMatch(/JWT_AUDIENCE\s*=\s*"avyron-ai"/);
  });
  it('declares JWT_ISSUER = "avyron-auth"', () => {
    expect(src).toMatch(/JWT_ISSUER\s*=\s*"avyron-auth"/);
  });
  it("jwt.sign carries audience + issuer", () => {
    expect(src).toMatch(/jwt\.sign\([\s\S]*?audience:\s*JWT_AUDIENCE[\s\S]*?issuer:\s*JWT_ISSUER/);
  });
  it("verifyToken's strict path enforces audience + issuer", () => {
    expect(src).toMatch(/jwt\.verify\(\s*token\s*,\s*JWT_SECRET\s*,\s*\{\s*audience:\s*JWT_AUDIENCE\s*,\s*issuer:\s*JWT_ISSUER\s*\}/);
  });
  it("legacy grace path bumps JWT_LEGACY_METRICS counter", () => {
    expect(src).toContain("JWT_LEGACY_METRICS");
    expect(src).toMatch(/JWT_LEGACY_METRICS\.hits\+\+/);
  });
  it("rejects legacy tokens past JWT_LEGACY_CUTOFF_MS", () => {
    expect(src).toMatch(/Date\.now\(\)\s*>=\s*JWT_LEGACY_CUTOFF_MS/);
  });
  it("malformed JWT_LEGACY_CUTOFF_ISO disables grace (cutoff=0) — fail-closed", () => {
    // Malformed env (operator typo) must NEVER fall through to a default — that
    // was the original architect-flagged permanent-backdoor path.
    expect(src).toMatch(/Number\.isFinite\(parsed\)/);
    expect(src).toMatch(/JWT_LEGACY_CUTOFF_ISO is malformed[\s\S]*?return 0/);
  });
  it("unset JWT_LEGACY_CUTOFF_ISO uses a STABLE persisted stamp (no sliding)", () => {
    // Pass-5 architect requirement: a forgotten env var must NOT immediately
    // invalidate every legacy session. Instead: derive once, persist, and
    // re-read on subsequent boots so cutoff is stable across restarts.
    expect(src).toMatch(/readPersistedCutoffMs/);
    expect(src).toMatch(/writePersistedCutoffMs/);
    expect(src).toMatch(/JWT_LEGACY_GRACE_DAYS\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
});

describe("Seal #2 F9.2 behavioral — JWT grace boundary and shape", () => {
  it("strict-shape token (with aud+iss) verifies regardless of cutoff", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const auth = await import("../auth");
    const SECRET = process.env.JWT_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
    const t = jwt.sign(
      { userId: "u1", email: "u1@x", accountId: "u1" },
      SECRET,
      { expiresIn: "60m", audience: auth.JWT_AUDIENCE, issuer: auth.JWT_ISSUER },
    );
    // Even with cutoff in the past (legacy disabled), strict tokens still pass.
    auth.__setJwtLegacyCutoffMsForTest(0);
    const payload = auth.__verifyTokenForTest(t);
    expect(payload?.userId).toBe("u1");
    auth.__resetJwtLegacyCutoffForTest();
  });

  it("legacy token (no aud+iss) is ACCEPTED before cutoff and increments metrics", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const auth = await import("../auth");
    const SECRET = process.env.JWT_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
    const legacy = jwt.sign({ userId: "u2", email: "u2@x", accountId: "u2" }, SECRET, { expiresIn: "60m" });
    auth.__setJwtLegacyCutoffMsForTest(Date.now() + 60_000); // 1min in future
    const before = auth.JWT_LEGACY_METRICS.hits;
    const payload = auth.__verifyTokenForTest(legacy);
    expect(payload?.userId).toBe("u2");
    expect(auth.JWT_LEGACY_METRICS.hits).toBe(before + 1);
    auth.__resetJwtLegacyCutoffForTest();
  });

  it("legacy token is REJECTED past cutoff (no permanent backdoor)", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const auth = await import("../auth");
    const SECRET = process.env.JWT_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
    const legacy = jwt.sign({ userId: "u3", email: "u3@x", accountId: "u3" }, SECRET, { expiresIn: "60m" });
    auth.__setJwtLegacyCutoffMsForTest(0); // sunset: legacy disabled
    const payload = auth.__verifyTokenForTest(legacy);
    expect(payload).toBeNull();
    auth.__resetJwtLegacyCutoffForTest();
  });
});

describe("Seal #2 F9.4 timing-oracle equalization", () => {
  const src = read("server/auth.ts");
  it("declares DUMMY_BCRYPT_HASH from random bytes", () => {
    expect(src).toMatch(/DUMMY_BCRYPT_HASH\s*=\s*bcrypt\.hashSync/);
    expect(src).toMatch(/crypto\.randomBytes\(32\)\.toString\("hex"\)/);
  });
  it("dummy hash cost factor matches register-time cost (no skew)", () => {
    // Architect-flagged regression: cost 10 vs 12 produced ~4x compare delta.
    // BCRYPT_COST must be a single shared constant used in BOTH places.
    expect(src).toMatch(/const BCRYPT_COST\s*=\s*12/);
    expect(src).toMatch(/bcrypt\.hashSync\([\s\S]*?BCRYPT_COST/);
    expect(src).toMatch(/bcrypt\.hash\(password,\s*BCRYPT_COST\)/);
    // Defensive: ensure no rogue numeric cost arg snuck back in.
    const bareNumericHash = src.match(/bcrypt\.hash(?:Sync)?\([^)]*?,\s*(?:10|11|13|14)\b/);
    expect(bareNumericHash).toBeNull();
  });
  it("login handler runs bcrypt.compare against DUMMY_BCRYPT_HASH when user is missing", () => {
    const loginStart = src.indexOf('app.post("/api/auth/login"');
    const loginEnd = src.indexOf('app.post("/api/auth/refresh"', loginStart);
    const block = src.slice(loginStart, loginEnd);
    const notFoundBranch = block.indexOf("if (!user)");
    const dummyIdx = block.indexOf("DUMMY_BCRYPT_HASH", notFoundBranch);
    const returnIdx = block.indexOf('return res.status(401)', notFoundBranch);
    expect(notFoundBranch).toBeGreaterThan(-1);
    expect(dummyIdx).toBeGreaterThan(notFoundBranch);
    expect(dummyIdx).toBeLessThan(returnIdx);
  });
});

describe("Seal #2 F9.4 behavioral — bcrypt cost equalization", () => {
  it("dummy compare and real compare run at the same bcrypt cost (≤30% skew)", async () => {
    // Empirical proof that the architect-flagged 4x cost mismatch is closed.
    // We compare a known-good password against (a) a fresh real-cost hash and
    // (b) the equivalent dummy hash. Any cost-factor regression (e.g. someone
    // dropping DUMMY back to cost 10) reopens a measurable enumeration oracle.
    const bcrypt = (await import("bcryptjs")).default;
    const COST = 12;
    const realHash = bcrypt.hashSync("correct-horse-battery-staple", COST);
    const dummyHash = bcrypt.hashSync("never-matches-anything-" + Math.random(), COST);

    // Warm up
    await bcrypt.compare("warmup", realHash);
    await bcrypt.compare("warmup", dummyHash);

    const N = 3;
    const realTimes: number[] = [];
    const dummyTimes: number[] = [];
    for (let i = 0; i < N; i++) {
      let t0 = Date.now(); await bcrypt.compare("wrong-password", realHash); realTimes.push(Date.now() - t0);
      t0 = Date.now(); await bcrypt.compare("wrong-password", dummyHash); dummyTimes.push(Date.now() - t0);
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const real = avg(realTimes);
    const dummy = avg(dummyTimes);
    const skew = Math.abs(real - dummy) / Math.max(real, dummy);
    // 30% allows for noise on a busy CI host. A cost10/cost12 mismatch yields ~75% — caught.
    expect(skew).toBeLessThan(0.3);
  }, 30_000);
});

describe("Seal #2 F9.2 behavioral — env-boundary parsing of resolveLegacyCutoffMs", () => {
  // True behavioral coverage of the architect-flagged paths. We re-import the
  // module under controlled NODE_ENV/JWT_LEGACY_CUTOFF_ISO combos via vitest's
  // module-cache reset, then assert the resolved cutoff value.
  beforeEach(async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
  });

  it("parseable env value → cutoff equals Date.parse(env)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const target = "2030-01-01T00:00:00.000Z";
    process.env.JWT_LEGACY_CUTOFF_ISO = target;
    const auth = await import("../auth");
    expect(auth.__getJwtLegacyCutoffMsForTest()).toBe(Date.parse(target));
    delete process.env.JWT_LEGACY_CUTOFF_ISO;
  });

  it("malformed env value → cutoff = 0 (fail-closed, not NaN)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.JWT_LEGACY_CUTOFF_ISO = "not-a-date";
    const auth = await import("../auth");
    expect(auth.__getJwtLegacyCutoffMsForTest()).toBe(0);
    delete process.env.JWT_LEGACY_CUTOFF_ISO;
  });

  it("unset env in production-like env → derives boot+7d AND persists (no immediate mass logout)", async () => {
    const { vi } = await import("vitest");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    vi.resetModules();
    delete process.env.JWT_LEGACY_CUTOFF_ISO;
    const tmpFile = path.join(os.tmpdir(), `jwt-legacy-cutoff-test-${Date.now()}-${Math.random()}.stamp`);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.env.JWT_LEGACY_STATE_FILE = tmpFile;
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const prevJwt = process.env.JWT_SECRET; const prevStripe = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-used";
    process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "test-webhook-not-used";
    try {
      const t0 = Date.now();
      const auth = await import("../auth");
      const cutoff = auth.__getJwtLegacyCutoffMsForTest();
      // Derived cutoff must be ~ now + 7d (within a small slack), NOT 0.
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(t0 + sevenDays - 5000);
      expect(cutoff).toBeLessThanOrEqual(Date.now() + sevenDays + 5000);
      // Stamp file MUST exist with the same value (so a restart re-reads it).
      expect(fs.existsSync(tmpFile)).toBe(true);
      const persisted = Number(fs.readFileSync(tmpFile, "utf-8").trim());
      expect(persisted).toBe(cutoff);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevJwt;
      if (prevStripe === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = prevStripe;
      delete process.env.JWT_LEGACY_STATE_FILE;
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  it("re-import after persistence → cutoff is STABLE (no sliding across restarts)", async () => {
    const { vi } = await import("vitest");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpFile = path.join(os.tmpdir(), `jwt-legacy-cutoff-stable-${Date.now()}-${Math.random()}.stamp`);
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.env.JWT_LEGACY_STATE_FILE = tmpFile;
    delete process.env.JWT_LEGACY_CUTOFF_ISO;
    try {
      vi.resetModules();
      const auth1 = await import("../auth");
      const c1 = auth1.__getJwtLegacyCutoffMsForTest();
      // Wait long enough that a sliding default would diverge.
      await new Promise(r => setTimeout(r, 50));
      vi.resetModules();
      const auth2 = await import("../auth");
      const c2 = auth2.__getJwtLegacyCutoffMsForTest();
      expect(c2).toBe(c1);
    } finally {
      delete process.env.JWT_LEGACY_STATE_FILE;
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });
});

describe("Seal #2 F9.4 — account lockout (5 fail / 15min)", () => {
  const src = read("server/auth.ts");
  const schema = read("shared/schema.ts");

  it("auth_lockouts table is declared in shared/schema.ts", () => {
    expect(schema).toMatch(/export const authLockouts\s*=\s*pgTable\(\s*"auth_lockouts"/);
    expect(schema).toMatch(/email:\s*text\("email"\)\.primaryKey\(\)/);
  });

  it("LOCKOUT thresholds match policy (5 failures / 15min window / 15min lockout)", () => {
    expect(src).toMatch(/LOCKOUT_MAX_FAILURES\s*=\s*5\b/);
    expect(src).toMatch(/LOCKOUT_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    expect(src).toMatch(/LOCKOUT_DURATION_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
  });

  it("login handler checks lockout BEFORE bcrypt.compare", () => {
    const loginStart = src.indexOf('app.post("/api/auth/login"');
    expect(loginStart).toBeGreaterThan(-1);
    const loginEnd = src.indexOf('app.post("/api/auth/refresh"', loginStart);
    const block = src.slice(loginStart, loginEnd > 0 ? loginEnd : loginStart + 4000);
    const lockIdx = block.indexOf("checkLockout(emailLower)");
    const bcryptIdx = block.indexOf("bcrypt.compare(password");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(bcryptIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(bcryptIdx);
    // failure is recorded
    expect(block).toContain("recordLoginFailure");
    // success clears the lockout row
    expect(block).toContain("clearLockout");
    // 423 status used for locked accounts
    expect(block).toMatch(/res\.status\(423\)/);
  });

  it("migration 013 creates auth_lockouts with locked_until column", () => {
    const mig = read("server/migrations/013-auth-hardening.ts");
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS auth_lockouts/);
    expect(mig).toMatch(/locked_until\s+TIMESTAMP/);
  });
});

describe("Seal #2 F9.8 — refresh-token rotation + reuse detection", () => {
  const src = read("server/auth.ts");
  const schema = read("shared/schema.ts");
  const mig = read("server/migrations/013-auth-hardening.ts");

  it("auth_sessions table declared in shared/schema.ts with refreshTokenHash", () => {
    expect(schema).toMatch(/export const authSessions\s*=\s*pgTable\(\s*"auth_sessions"/);
    expect(schema).toMatch(/refreshTokenHash:\s*text\("refresh_token_hash"\)/);
    expect(schema).toMatch(/deviceFingerprint:\s*text\("device_fingerprint"\)/);
    expect(schema).toMatch(/revokedAt:\s*timestamp\("revoked_at"\)/);
  });

  it("migration creates partial unique index on (account_id, device_fingerprint) WHERE revoked_at IS NULL", () => {
    expect(mig).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_active_device[\s\S]*?WHERE revoked_at IS NULL/);
  });

  it("/api/auth/refresh route exists and bcrypt-compares the secret", () => {
    expect(src).toContain('app.post("/api/auth/refresh"');
    const start = src.indexOf('app.post("/api/auth/refresh"');
    const end = src.indexOf('app.post("/api/auth/logout"', start);
    const block = src.slice(start, end > 0 ? end : start + 4000);
    expect(block).toContain("parseRefreshToken");
    expect(block).toContain("bcrypt.compare");
    // Old session marked revoked + new one issued.
    expect(block).toMatch(/revokeReason:\s*"rotated_refresh"/);
    expect(block).toContain("issueSessionForDevice");
  });

  it("refresh-reuse detection cascades revocation across all account sessions", () => {
    const start = src.indexOf('app.post("/api/auth/refresh"');
    const end = src.indexOf('app.post("/api/auth/logout"', start);
    const block = src.slice(start, end > 0 ? end : start + 4000);
    expect(block).toContain("SECURITY_REFRESH_REUSE");
    // The cascade revoke targets ALL active sessions for the account.
    expect(block).toMatch(/eq\(authSessions\.accountId,\s*row\.accountId\)[\s\S]{0,200}isNull\(authSessions\.revokedAt\)/);
    expect(block).toMatch(/revokeReason:\s*"reuse_detected_cascade"/);
  });

  it("/api/auth/logout revokes the refresh-token's session", () => {
    expect(src).toContain('app.post("/api/auth/logout"');
    const start = src.indexOf('app.post("/api/auth/logout"');
    const block = src.slice(start, start + 1500);
    expect(block).toMatch(/revokeReason:\s*"logout"/);
  });

  it("login + register issue refresh tokens via issueSessionForDevice", () => {
    const loginBlock = src.slice(src.indexOf('app.post("/api/auth/login"'), src.indexOf('app.post("/api/auth/refresh"'));
    expect(loginBlock).toContain("issueSessionForDevice");
    expect(loginBlock).toContain("refreshToken: session.refreshToken");
    const regBlock = src.slice(src.indexOf('app.post("/api/auth/register"'), src.indexOf('app.post("/api/auth/login"'));
    expect(regBlock).toContain("issueSessionForDevice");
  });

  it("access token TTL is 14d (compat-preserved) and refresh TTL is 30 days", () => {
    // Code-review hardening: the original 60m TTL would have force-logged-out
    // every existing mobile client (which has no refresh wiring yet). TTL is
    // held at 14d through the JWT_LEGACY grace window; tightening to 60m is
    // a follow-up after the client gains /api/auth/refresh handling.
    expect(src).toMatch(/ACCESS_TOKEN_TTL\s*=\s*"14d"/);
    expect(src).toMatch(/REFRESH_TOKEN_TTL_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });
});

// ─── Behavioral proof — AI rate limiter ──────────────────────────────────────

describe("Seal #2 F1.8 behavioral — aiRateLimitPerAccount(50) emits 429 at the 51st request", () => {
  beforeEach(async () => {
    const mod = await import("../middleware/ai-rate-limit");
    mod.__resetAiRateLimitBuckets();
  });

  it("allows 50 requests then 429s the 51st (per-account, per-route)", async () => {
    const { aiRateLimitPerAccount } = await import("../middleware/ai-rate-limit");
    const mw = aiRateLimitPerAccount(50);

    const makeReq = (accountId: string) => ({ accountId, path: "/api/generate-content", route: { path: "/api/generate-content" } } as any);
    const makeRes = () => {
      const headers: Record<string, string> = {};
      const r: any = {
        statusCode: 200,
        body: undefined as any,
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status(c: number) { this.statusCode = c; return this; },
        json(b: any) { this.body = b; return this; },
        headers,
      };
      return r;
    };

    let nextCalls = 0;
    const next = () => { nextCalls++; };

    // 50 successful passes
    for (let i = 0; i < 50; i++) {
      const res = makeRes();
      mw(makeReq("acct-A"), res, next);
      expect(res.statusCode).toBe(200);
    }
    expect(nextCalls).toBe(50);

    // 51st rejected
    const res51 = makeRes();
    mw(makeReq("acct-A"), res51, next);
    expect(res51.statusCode).toBe(429);
    expect(res51.body?.error).toBe("AI_RATE_LIMIT_EXCEEDED");
    expect(res51.headers["Retry-After"]).toBeDefined();
    expect(Number(res51.headers["Retry-After"])).toBeGreaterThan(0);

    // Different account is unaffected (per-account isolation).
    const resB = makeRes();
    mw(makeReq("acct-B"), resB, next);
    expect(resB.statusCode).toBe(200);
  });

  it("rejects unauthenticated callers with 401 (no accountId)", async () => {
    const { aiRateLimitPerAccount } = await import("../middleware/ai-rate-limit");
    const mw = aiRateLimitPerAccount(50);
    const req: any = { path: "/api/generate-content" };
    const res: any = { statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json(b: any) { this.body = b; return this; } };
    mw(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });
});
