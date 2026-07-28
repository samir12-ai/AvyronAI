/**
 * P-6.12 Apify migration — proxy pool RETIREMENT contract.
 *
 * The Bright Data proxy pool (sticky sessions, LRU registries, target
 * backoff, pool persistence) is DELETED. proxy-pool-manager.ts remains only
 * as an inert shim so ~40 historical call sites keep compiling; every one of
 * them null-guards the session and proceeds onto the Apify transport.
 *
 * This suite proves three things:
 *  1. The shim is truly inert — no state, no sessions, no config, no BD env reads.
 *  2. classifyBlock (the one REAL survivor, still used to classify Apify
 *     errors) keeps its exact pre-migration behavior.
 *  3. Zero-callable-Bright-Data tripwires: the deleted transport files stay
 *     deleted and no production source can reach Bright Data.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import {
  acquireStickySession,
  rotateSessionOnBlock,
  releaseStickySession,
  logProxyTelemetry,
  classifyBlock,
  getScrapingConfig,
  getSerpConfig,
  getPoolDiagnostics,
  getPoolStatusReport,
  SCRAPE_PLATFORMS,
  type StickySessionContext,
} from "../competitive-intelligence/proxy-pool-manager";

const REPO = "/home/runner/workspace";
const SHIM_PATH = `${REPO}/server/competitive-intelligence/proxy-pool-manager.ts`;

// ── Section A: inert session lifecycle ───────────────────────────────────────

describe("A) Session lifecycle is inert — always null, never throws", () => {
  it("acquireStickySession returns null for every historical call arity", () => {
    // Call sites vary: (accountId), (accountId, campaignId, competitorHash),
    // and autonomous-worker's single-arg form. The permissive rest signature
    // must accept all of them and always return null.
    expect(acquireStickySession("acct")).toBeNull();
    expect(acquireStickySession("acct", "camp")).toBeNull();
    expect(acquireStickySession("acct", "camp", "compHash")).toBeNull();
    expect(acquireStickySession()).toBeNull();
  });

  it("repeated acquisition creates NO lazy state (diagnostics stay zero)", () => {
    for (let i = 0; i < 25; i++) {
      expect(acquireStickySession(`acct-${i}`, "camp", `comp-${i}`)).toBeNull();
    }
    const diag = getPoolDiagnostics("acct-0");
    expect(diag.totalSessions).toBe(0);
    expect(diag.activeSessions).toBe(0);
    expect(diag.stickyBindings).toBe(0);
    expect(getPoolStatusReport().activeAccountPools).toBe(0);
  });

  it("rotateSessionOnBlock always reports rotation exhausted (null)", () => {
    const fake = null as unknown as StickySessionContext;
    expect(rotateSessionOnBlock(fake, "PROXY_BLOCKED")).toBeNull();
    expect(rotateSessionOnBlock(fake, "RATE_LIMIT")).toBeNull();
    expect(rotateSessionOnBlock(fake, "CHECKPOINT")).toBeNull();
    expect(rotateSessionOnBlock(fake, "OTHER")).toBeNull();
  });

  it("releaseStickySession and logProxyTelemetry are safe no-ops", () => {
    const fake = null as unknown as StickySessionContext;
    expect(() => releaseStickySession(fake)).not.toThrow();
    expect(() => logProxyTelemetry(fake, "STAGE", 200, null, 12, true)).not.toThrow();
    expect(() => logProxyTelemetry(fake, "STAGE", 403, "PROXY_BLOCKED", 12, false)).not.toThrow();
  });
});

// ── Section B: retired configuration surface ────────────────────────────────

describe("B) Configuration surface is retired — BD env can NEVER re-arm it", () => {
  it("getScrapingConfig returns null even with a fully-set BD environment", () => {
    const prev = {
      key: process.env.BRIGHT_DATA_API_KEY,
      zone: process.env.BRIGHT_DATA_ZONE,
      country: process.env.BRIGHT_DATA_COUNTRY,
    };
    try {
      process.env.BRIGHT_DATA_API_KEY = "bd-key-test";
      process.env.BRIGHT_DATA_ZONE = "test_zone";
      process.env.BRIGHT_DATA_COUNTRY = "ae";
      expect(getScrapingConfig()).toBeNull();
      expect(getSerpConfig()).toBeNull();
    } finally {
      if (prev.key === undefined) delete process.env.BRIGHT_DATA_API_KEY;
      else process.env.BRIGHT_DATA_API_KEY = prev.key;
      if (prev.zone === undefined) delete process.env.BRIGHT_DATA_ZONE;
      else process.env.BRIGHT_DATA_ZONE = prev.zone;
      if (prev.country === undefined) delete process.env.BRIGHT_DATA_COUNTRY;
      else process.env.BRIGHT_DATA_COUNTRY = prev.country;
    }
  });

  it("shim source never reads BRIGHT_DATA_* env vars", () => {
    const src = readFileSync(SHIM_PATH, "utf-8");
    expect(src).not.toMatch(/process\.env\.BRIGHT_DATA/);
  });
});

// ── Section C: status report keeps its operator-facing shape ────────────────

describe("C) getPoolStatusReport — truthful retired report, stable shape", () => {
  it("reports retired:true with transport apify", () => {
    const report = getPoolStatusReport();
    expect(report.retired).toBe(true);
    expect(report.transport).toBe("apify");
    expect(typeof report.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });

  it("keeps per-platform counters (zeroed) for all four platforms — admin endpoint shape", () => {
    const report = getPoolStatusReport();
    expect(SCRAPE_PLATFORMS).toEqual(["instagram", "tiktok", "reviews", "website"]);
    for (const platform of SCRAPE_PLATFORMS) {
      expect(report.platforms[platform]).toEqual({ inflight: 0, coolingTargets: 0, trackedTargets: 0 });
    }
    expect(report.backoffEntries).toEqual([]);
    expect(report.persistence).toEqual({ persistFailures: 0, hydrateFailures: 0, hydratedScopes: 0 });
  });
});

// ── Section D: classifyBlock — the REAL survivor keeps exact behavior ───────

describe("D) classifyBlock — unchanged classification (now applied to Apify errors)", () => {
  it("classifies 429 / rate-limit text as RATE_LIMIT", () => {
    expect(classifyBlock(429, "")).toBe("RATE_LIMIT");
    expect(classifyBlock(null, "rate limit exceeded")).toBe("RATE_LIMIT");
    expect(classifyBlock(null, "wait a few minutes")).toBe("RATE_LIMIT");
  });

  it("classifies 403 / blocked text as PROXY_BLOCKED", () => {
    expect(classifyBlock(403, "")).toBe("PROXY_BLOCKED");
    expect(classifyBlock(null, "forbidden")).toBe("PROXY_BLOCKED");
    expect(classifyBlock(null, "blocked")).toBe("PROXY_BLOCKED");
  });

  it("classifies 401 / login walls as AUTH_REQUIRED", () => {
    expect(classifyBlock(401, "")).toBe("AUTH_REQUIRED");
    expect(classifyBlock(null, "require_login")).toBe("AUTH_REQUIRED");
    expect(classifyBlock(null, "authentication failed")).toBe("AUTH_REQUIRED");
  });

  it("classifies challenge/checkpoint walls as CHECKPOINT", () => {
    expect(classifyBlock(null, "checkpoint_required")).toBe("CHECKPOINT");
    expect(classifyBlock(null, "challenge_required")).toBe("CHECKPOINT");
  });

  it("everything else is OTHER (5xx, empty, unknown text)", () => {
    expect(classifyBlock(500, "")).toBe("OTHER");
    expect(classifyBlock(null, "")).toBe("OTHER");
    expect(classifyBlock(null, "socket hang up")).toBe("OTHER");
  });
});

// ── Section E: zero-callable-Bright-Data tripwires ──────────────────────────

describe("E) Zero-callable-BD tripwires — the transport stays deleted", () => {
  it("deleted transport files do not exist", () => {
    expect(existsSync(`${REPO}/server/competitive-intelligence/brightdata-client.ts`)).toBe(false);
    expect(existsSync(`${REPO}/server/competitive-intelligence/pool-config.ts`)).toBe(false);
    expect(existsSync(`${REPO}/server/competitive-intelligence/pool-persistence.ts`)).toBe(false);
    expect(existsSync(`${REPO}/server/competitive-intelligence/target-backoff.ts`)).toBe(false);
  });

  it("no production source imports the deleted modules", () => {
    // Doc comments may mention the retired module names; IMPORTS may not.
    const out = execSync(
      `grep -rln 'from ["'"'"'][^"'"'"']*\\(brightdata-client\\|pool-config\\|pool-persistence\\|target-backoff\\)\\|require([^)]*\\(brightdata-client\\|pool-config\\|pool-persistence\\|target-backoff\\)' ${REPO}/server ${REPO}/shared --include='*.ts' | grep -v '/tests/' || true`,
      { encoding: "utf-8" },
    ).trim();
    expect(out).toBe("");
  });

  it("no production source calls the Bright Data API surface (poolFetch/unlockerRequest)", () => {
    const out = execSync(
      `grep -rln 'unlockerRequest\\|api\\.brightdata\\.com\\|brd\\.superproxy' ${REPO}/server ${REPO}/shared --include='*.ts' | grep -v '/tests/' || true`,
      { encoding: "utf-8" },
    ).trim();
    expect(out).toBe("");
  });

  it("shim itself performs no network I/O except the dynamic Apify probe import", () => {
    const src = readFileSync(SHIM_PATH, "utf-8");
    expect(src).toContain("RETIRED SHIM");
    expect(src).not.toMatch(/\bawait fetch\s*\(/);
    expect(src).toContain('import("../acquisition/apify-client")');
  });
});
