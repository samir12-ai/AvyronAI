/**
 * Seal #7 (Task #25 / F10.9) — Boot-hardening regression suite.
 *
 * Covers:
 *   - env-validator: hard-fail on missing required, warn on missing recommended.
 *   - logger: stripSecrets recursively redacts token-shaped keys.
 *   - observability: Prometheus text-format exposition shape; Sentry no-op
 *     when DSN unset.
 *   - account-lifecycle: CASCADE_TABLES + CASCADE_EXEMPT cover every
 *     account_id-bearing table in shared/schema.ts (drift sentinel).
 *   - migration runner: REQUIRED_SCHEMA_VERSION matches highest sql migration.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { checkEnv } from "../env-validator";
import { stripSecrets, scrubInlineSecrets } from "../logger";
import { renderMetrics, recordHttpRequest, recordAiCost, recordWorkerTick } from "../observability/otel";
import { isSentryEnabled } from "../observability/sentry";
import { CASCADE_TABLES, CASCADE_EXEMPT } from "../account-lifecycle";
import { REQUIRED_SCHEMA_VERSION } from "../migrations/runner";

describe("Seal #7 — env-validator", () => {
  it("hard-fails when required vars are missing (production)", () => {
    const r = checkEnv({ NODE_ENV: "production" });
    expect(r.ok).toBe(false);
    expect(r.missing.some(m => m.startsWith("DATABASE_URL"))).toBe(true);
    expect(r.missing.some(m => m.startsWith("PUBLIC_BASE_URL"))).toBe(true);
    expect(r.missing.some(m => m.startsWith("STRIPE_WEBHOOK_SECRET"))).toBe(true);
    expect(r.missing.some(m => m.startsWith("JWT_SECRET"))).toBe(true);
    expect(r.missing.some(m => m.startsWith("OPENAI_API_KEY"))).toBe(true);
  });

  it("rejects malformed PUBLIC_BASE_URL", () => {
    const r = checkEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://x",
      OPENAI_API_KEY: "sk-test",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "not-a-url",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("PUBLIC_BASE_URL");
  });

  it("rejects PUBLIC_BASE_URL host outside allowlist (Seal #7 / F9.1)", () => {
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      JWT_SECRET: "0123456789abcdef0123456789abcdef",
      OPENAI_API_KEY: "sk-test",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "https://evil.example.com",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("PUBLIC_BASE_URL");
  });

  it("rejects http:// PUBLIC_BASE_URL in production (Seal #7 / F9.1)", () => {
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      JWT_SECRET: "0123456789abcdef0123456789abcdef",
      OPENAI_API_KEY: "sk-test",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "http://avyron.replit.app",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("PUBLIC_BASE_URL");
  });

  it("accepts AI_INTEGRATIONS_OPENAI_API_KEY as alias for OPENAI_API_KEY", () => {
    const r = checkEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://x",
      AI_INTEGRATIONS_OPENAI_API_KEY: "sk-test", // alias only
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "https://test.replit.dev",
    });
    expect(r.ok).toBe(true);
  });

  it("passes when all required dev vars are present", () => {
    const r = checkEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://x",
      OPENAI_API_KEY: "sk-test",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "https://test.replit.dev",
    });
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("PRODUCTION boot requires JWT_SECRET + STRIPE_WEBHOOK_SECRET", () => {
    // Mirror image: in production, the productionOnly carve-out is OFF and
    // both secrets are required.
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      OPENAI_API_KEY: "sk-test",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "https://avyron.replit.app",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("JWT_SECRET");
    expect(r.missing).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("rejects short JWT_SECRET in production", () => {
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      JWT_SECRET: "short",
      OPENAI_API_KEY: "sk-test",
      BRIGHT_DATA_PROXY_USERNAME: "u",
      BRIGHT_DATA_PROXY_PASSWORD: "p",
      BRIGHT_DATA_PROXY_COUNTRY: "us",
      PUBLIC_BASE_URL: "https://avyron.replit.app",
      STRIPE_WEBHOOK_SECRET: "whsec_xxx",
    });
    expect(r.missing).toContain("JWT_SECRET");
  });
});

describe("Seal #7 / F9.5 — logger.stripSecrets", () => {
  it("redacts token-shaped keys at top level", () => {
    const out = stripSecrets({
      ok: true,
      token: "eyJhbGc...",
      refreshToken: "abc.def",
      password: "hunter2",
    }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.token).toBe("[REDACTED]");
    expect(out.refreshToken).toBe("[REDACTED]");
    expect(out.password).toBe("[REDACTED]");
  });

  it("redacts nested + array values", () => {
    const out = stripSecrets({
      user: { id: "u1", refreshTokenHash: "hash" },
      sessions: [{ token: "t1" }, { token: "t2" }],
      headers: { authorization: "Bearer x", "content-type": "json" },
    }) as any;
    expect(out.user.id).toBe("u1");
    expect(out.user.refreshTokenHash).toBe("[REDACTED]");
    expect(out.sessions[0].token).toBe("[REDACTED]");
    expect(out.sessions[1].token).toBe("[REDACTED]");
    expect(out.headers.authorization).toBe("[REDACTED]");
    expect(out.headers["content-type"]).toBe("json");
  });

  it("matches snake_case + camelCase token names", () => {
    const out = stripSecrets({
      access_token: "x",
      accessToken: "x",
      api_key: "x",
      apiKey: "x",
      session_token: "x",
      sessionToken: "x",
    }) as Record<string, unknown>;
    for (const v of Object.values(out)) expect(v).toBe("[REDACTED]");
  });

  it("guards against deep cycles via MAX_DEPTH", () => {
    const a: any = { name: "root" };
    a.self = a;
    const out = stripSecrets(a) as any;
    expect(out.name).toBe("root");
    // walks 6 deep then returns the sentinel
    expect(JSON.stringify(out)).toContain("[MAX_DEPTH]");
  });

  // Architect-review follow-up for F9.5: inline secrets must be redacted
  // from arbitrary string values, not only from token-shaped keys. Catches
  // the case where a Bearer token, sk- key, or JWT lands inside an error
  // message or stack frame whose surrounding key is innocuous.
  it("scrubInlineSecrets redacts Bearer / sk- / JWT / Stripe / GitHub / Google patterns", () => {
    expect(scrubInlineSecrets("Authorization: Bearer abc123def456ghi789")).toContain("[REDACTED-INLINE]");
    expect(scrubInlineSecrets("openai key sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA fail")).toContain("[REDACTED-INLINE]");
    expect(scrubInlineSecrets("stripe sk_live_AAAAAAAAAAAAAAAAAAAA test")).toContain("[REDACTED-INLINE]");
    expect(
      scrubInlineSecrets("token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4f")
    ).toContain("[REDACTED-INLINE]");
    expect(scrubInlineSecrets("gh ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA xyz")).toContain("[REDACTED-INLINE]");
    expect(
      scrubInlineSecrets("google AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7")
    ).toContain("[REDACTED-INLINE]");
    // No false positive on innocuous strings.
    expect(scrubInlineSecrets("normal log line with no secrets")).toBe("normal log line with no secrets");
  });

  it("stripSecrets walks string values and applies inline scrub", () => {
    const out = stripSecrets({
      message: "Auth header was Bearer abc123def456ghi789xyz",
      nested: { detail: "key=sk_live_AAAAAAAAAAAAAAAAAAAA in payload" },
      stack: ["frame at sk-AAAAAAAAAAAAAAAAAAAAAAAA"],
    }) as any;
    expect(out.message).toContain("[REDACTED-INLINE]");
    expect(out.message).not.toContain("Bearer abc123");
    expect(out.nested.detail).toContain("[REDACTED-INLINE]");
    expect(out.stack[0]).toContain("[REDACTED-INLINE]");
  });
});

describe("Seal #7 / F10.7 — observability metrics", () => {
  it("renders Prometheus text exposition with all metric families", () => {
    recordHttpRequest("GET", "/api/test", 200, 0.012);
    recordAiCost("openai", "gpt-4o-mini", 0.0007);
    recordWorkerTick("autonomous", "ok");
    const out = renderMetrics();
    expect(out).toContain("# TYPE http_request_duration_seconds histogram");
    expect(out).toContain("http_request_duration_seconds_bucket{");
    expect(out).toContain("# TYPE ai_cost_usd_total counter");
    expect(out).toContain("# TYPE worker_tick_total counter");
    expect(out).toContain("# TYPE worker_queue_depth gauge");
  });
});

describe("Seal #7 / F10.8 — Sentry no-op when DSN unset", () => {
  it("isSentryEnabled() is false without DSN", () => {
    expect(isSentryEnabled()).toBe(false);
  });
});

describe("Seal #7 / F9.9 — cascade table coverage drift sentinel", () => {
  it("CASCADE_TABLES ∪ CASCADE_EXEMPT covers every account_id-bearing table in shared/schema.ts", () => {
    const schema = fs.readFileSync(path.resolve(process.cwd(), "shared/schema.ts"), "utf-8");
    const re = /export const \w+ = pgTable\("([a-z_0-9]+)",\s*\{([\s\S]*?)\n\}\)/g;
    const tablesWithAccountId = new Set<string>();
    let m;
    while ((m = re.exec(schema))) {
      if (/account_id/.test(m[2])) tablesWithAccountId.add(m[1]);
    }
    const covered = new Set([...CASCADE_TABLES, ...CASCADE_EXEMPT]);
    const missing: string[] = [];
    for (const t of tablesWithAccountId) {
      if (!covered.has(t)) missing.push(t);
    }
    if (missing.length > 0) {
      throw new Error(
        `Cascade drift: tables hold account_id but are NOT in CASCADE_TABLES or CASCADE_EXEMPT — ${JSON.stringify(missing)}. ` +
        `Add each to server/account-lifecycle.ts (CASCADE_TABLES for cascade-delete, or CASCADE_EXEMPT to preserve).`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("CASCADE_TABLES has no duplicates", () => {
    expect(new Set(CASCADE_TABLES).size).toBe(CASCADE_TABLES.length);
  });

  it("users is the LAST cascade target so other tables FK-cascade cleanly", () => {
    expect(CASCADE_TABLES[CASCADE_TABLES.length - 1]).toBe("users");
  });

  it("audit_log_archive + account_tombstones are exempt (survive cascade)", () => {
    expect(CASCADE_EXEMPT).toContain("audit_log_archive");
    expect(CASCADE_EXEMPT).toContain("account_tombstones");
  });
});

describe("Seal #7 / F10.1 — migration runner", () => {
  it("REQUIRED_SCHEMA_VERSION matches highest sql migration on disk", () => {
    const dir = path.resolve(process.cwd(), "server/migrations/sql");
    if (!fs.existsSync(dir)) throw new Error("server/migrations/sql does not exist");
    const versions = fs.readdirSync(dir)
      .map(f => /^(\d+)_/.exec(f))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map(m => parseInt(m[1], 10));
    expect(versions.length).toBeGreaterThan(0);
    const max = Math.max(...versions);
    expect(REQUIRED_SCHEMA_VERSION).toBe(max);
  });
});
