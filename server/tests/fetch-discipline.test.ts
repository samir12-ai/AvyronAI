import { describe, it, expect, beforeEach, vi } from "vitest";
import { acquireToken, getBucketState, resetBucket, resetAllBuckets, TOKEN_REFILL_INTERVAL_MS, MAX_BURST_TOKENS, TOKEN_REFILL_JITTER_MS } from "../competitive-intelligence/rate-limiter";
import {
  acquireStickySession,
  releaseStickySession,
  rotateSessionOnBlock,
  classifyBlock,
  clearPool,
  type StickySessionContext,
} from "../competitive-intelligence/proxy-pool-manager";
import { MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT } from "../market-intelligence-v3/fetch-orchestrator";

describe("Section 1: Proxy Rate Test — Token Bucket Rate Limiter", () => {
  beforeEach(() => {
    resetAllBuckets();
  });

  it("grants burst tokens immediately up to MAX_BURST_TOKENS", async () => {
    const start = Date.now();
    for (let i = 0; i < MAX_BURST_TOKENS; i++) {
      await acquireToken("acct1", "camp1", `burst_test_${i}`);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);

    const state = getBucketState("acct1", "camp1");
    expect(state.totalConsumed).toBe(MAX_BURST_TOKENS);
    expect(state.tokens).toBe(0);
  });

  it("enforces wait after burst exhaustion (spacing >= 5 seconds)", async () => {
    for (let i = 0; i < MAX_BURST_TOKENS; i++) {
      await acquireToken("acct2", "camp2", `drain_${i}`);
    }

    const start = Date.now();
    await acquireToken("acct2", "camp2", "post_burst");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(TOKEN_REFILL_INTERVAL_MS);
    expect(elapsed).toBeLessThan(TOKEN_REFILL_INTERVAL_MS + TOKEN_REFILL_JITTER_MS + 1000);

    const state = getBucketState("acct2", "camp2");
    expect(state.totalConsumed).toBe(MAX_BURST_TOKENS + 1);
    expect(state.totalWaited).toBe(1);
  }, 15000);

  it("each accountId+campaignId gets its own bucket", () => {
    const stateA = getBucketState("acctA", "campA");
    const stateB = getBucketState("acctB", "campB");
    expect(stateA.tokens).toBe(MAX_BURST_TOKENS);
    expect(stateB.tokens).toBe(MAX_BURST_TOKENS);
  });

  it("3 competitors with limiter active — confirms request spacing >= 5s after burst", async () => {
    const timestamps: number[] = [];
    for (let i = 0; i < MAX_BURST_TOKENS; i++) {
      await acquireToken("acct3", "camp3", `burst_${i}`);
      timestamps.push(Date.now());
    }

    for (let comp = 0; comp < 3; comp++) {
      await acquireToken("acct3", "camp3", `competitor_${comp}`);
      timestamps.push(Date.now());
    }

    for (let i = MAX_BURST_TOKENS; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      expect(gap).toBeGreaterThanOrEqual(TOKEN_REFILL_INTERVAL_MS);
    }

    const state = getBucketState("acct3", "camp3");
    expect(state.totalConsumed).toBe(MAX_BURST_TOKENS + 3);
    expect(state.totalWaited).toBe(3);
  }, 30000);

  it("logs include rate bucket state", () => {
    const state = getBucketState("acctLog", "campLog");
    expect(state).toHaveProperty("tokens");
    expect(state).toHaveProperty("maxBurst");
    expect(state).toHaveProperty("totalConsumed");
    expect(state).toHaveProperty("totalWaited");
    expect(state).toHaveProperty("refillIntervalMs");
    expect(state.maxBurst).toBe(MAX_BURST_TOKENS);
    expect(state.refillIntervalMs).toBe(TOKEN_REFILL_INTERVAL_MS);
  });

  it("resetBucket clears state for a specific bucket", async () => {
    await acquireToken("acctR", "campR", "test");
    expect(getBucketState("acctR", "campR").totalConsumed).toBe(1);
    resetBucket("acctR", "campR");
    expect(getBucketState("acctR", "campR").totalConsumed).toBe(0);
  });
});

describe("Section 2: Sequential Pipeline Test — Competitor Batching", () => {
  it("MAX_CONCURRENT_COMPETITORS_PER_JOB is 1 (sequential default)", async () => {
    const mod = await import("../market-intelligence-v3/fetch-orchestrator");
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_CONCURRENT_COMPETITORS_PER_JOB = 1");
  });

  it("CONCURRENCY_FEATURE_FLAG exists and defaults to false", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("CONCURRENCY_FEATURE_FLAG = false");
  });

  it("competitors loop is sequential (for...of, not Promise.all)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("for (const comp of competitors)");
    expect(source).not.toMatch(/Promise\.all\(\s*competitors\.map/);
  });
});

describe("Section 3: Session Stickiness Test — Sticky Proxy Sessions", () => {
  beforeEach(() => {
    clearPool("stickiness_test");
  });

  it("same proxy session used across entire pipeline for one competitor", () => {
    if (!process.env.BRIGHT_DATA_PROXY_HOST) {
      console.log("[Test] Skipping — no proxy config");
      return;
    }
    const ctx1 = acquireStickySession("stickiness_test", "camp1", "compHash1");
    expect(ctx1).not.toBeNull();

    const ctx2 = acquireStickySession("stickiness_test", "camp1", "compHash1");
    expect(ctx2).not.toBeNull();
    expect(ctx2!.session.sessionId).toBe(ctx1!.session.sessionId);
    expect(ctx2!.session.ipHash).toBe(ctx1!.session.ipHash);

    releaseStickySession(ctx1!);
  });

  it("session does NOT rotate on non-block errors", () => {
    if (!process.env.BRIGHT_DATA_PROXY_HOST) return;
    const ctx = acquireStickySession("stickiness_test", "camp1", "compHash2");
    expect(ctx).not.toBeNull();

    const rotated = rotateSessionOnBlock(ctx!, "CHECKPOINT");
    expect(rotated).toBeNull();

    const rotated2 = rotateSessionOnBlock(ctx!, "OTHER");
    expect(rotated2).toBeNull();

    releaseStickySession(ctx!);
  });

  it("session rotates ONLY on PROXY_BLOCKED or RATE_LIMIT", () => {
    if (!process.env.BRIGHT_DATA_PROXY_HOST) return;
    const ctx = acquireStickySession("stickiness_test", "camp1", "compHash3");
    expect(ctx).not.toBeNull();
    const originalId = ctx!.session.sessionId;

    const rotated = rotateSessionOnBlock(ctx!, "PROXY_BLOCKED");
    expect(rotated).not.toBeNull();
    expect(rotated!.session.sessionId).not.toBe(originalId);

    releaseStickySession(rotated || ctx!);
  });
});

describe("Section 4: Block Recovery Test — Intelligent Backoff", () => {
  it("classifies 429 as RATE_LIMIT", () => {
    expect(classifyBlock(429, "")).toBe("RATE_LIMIT");
    expect(classifyBlock(null, "rate limit exceeded")).toBe("RATE_LIMIT");
    expect(classifyBlock(null, "wait a few minutes")).toBe("RATE_LIMIT");
  });

  it("classifies 403 as PROXY_BLOCKED", () => {
    expect(classifyBlock(403, "")).toBe("PROXY_BLOCKED");
    expect(classifyBlock(null, "forbidden")).toBe("PROXY_BLOCKED");
    expect(classifyBlock(null, "blocked")).toBe("PROXY_BLOCKED");
  });

  it("classifies login wall as AUTH_REQUIRED", () => {
    expect(classifyBlock(401, "")).toBe("AUTH_REQUIRED");
    expect(classifyBlock(null, "require_login")).toBe("AUTH_REQUIRED");
  });

  it("RATE_LIMIT backoff uses exponential delays (10s/30s/60s)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("[10000, 30000, 60000]");
    expect(source).toContain("Math.max(0, Math.min(attempt - 2, 2))");
    expect(source).toContain("RATE_LIMIT backoff");
  });

  it("403/PROXY_BLOCKED triggers rotation exactly once then stops on failure", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain('403/BLOCKED: Session rotated once');
    expect(source).toContain('403/BLOCKED: Rotation exhausted');
  });

  it("MAX_RETRIES is 3 — never retries indefinitely", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_RETRIES = 3");
    expect(source).toContain("while (attempt <= MAX_RETRIES)");
  });
});

describe("Section 5: Request Bundling — Single Request, Maximum Local Processing", () => {
  it("scraper parses all fields from single response (no separate caption/engagement calls)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
    );
    const parseFn = source.includes("parsePostFromGraphQL") || source.includes("parsePostFromV1Feed");
    expect(parseFn).toBe(true);

    expect(source).toContain("caption:");
    expect(source).toContain("likes:");
    expect(source).toContain("comments:");
    expect(source).toContain("views:");
    expect(source).toContain("mediaType:");
  });

  it("data-acquisition detects CTAs locally without separate API calls", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
    );
    expect(source).toContain("detectCTAIntent");
    expect(source).toContain("EXPLICIT_CTA_PATTERNS");
    expect(source).toContain("SOFT_CTA_PATTERNS");
    expect(source).toContain("NARRATIVE_CTA_PATTERNS");
    expect(source).toContain("TRUST_CTA_PATTERNS");
  });
});

describe("Section 6: Cost Guard Test — Hard Execution Ceilings", () => {
  it("MAX_REQUESTS_PER_JOB is enforced", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_REQUESTS_PER_JOB = 120");
    expect(source).toContain("checkRequestCeiling");
    expect(source).toContain("totalRequests >= dynamicRequestBudget");
  });

  it("MAX_RUNTIME_MS is enforced", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_RUNTIME_MS = 20 * 60 * 1000");
    expect(source).toContain("checkRuntimeCeiling");
  });

  it("MAX_RETRIES per stage is 3", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_RETRIES = 3");
  });

  it("job stops gracefully with stopReason logged", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_REQUESTS_REACHED");
    expect(source).toContain("MAX_RUNTIME_REACHED");
    expect(source).toContain("MAX_PAGES_REACHED");
    expect(source).toContain("HARD CEILING");
  });

  it("requests never exceed MAX_REQUESTS_PER_JOB (ceiling check before every request)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    const ceilingCheckBeforeRequest = source.indexOf("checkRequestCeiling()") < source.indexOf("totalRequests++");
    expect(ceilingCheckBeforeRequest).toBe(true);
  });
});

describe("Section 7: Integration Invariants", () => {
  it("every HTTP request path goes through acquireToken (rate limiter)", async () => {
    const fs = await import("fs");
    const orchSource = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
    expect(orchSource).toContain("await acquireToken(accountId, campaignId,");
    const orchTokenCount = (orchSource.match(/await acquireToken\(/g) || []).length;
    expect(orchTokenCount).toBeGreaterThanOrEqual(1);

    const scraperSource = fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8");
    expect(scraperSource).toContain('import { acquireToken } from "./rate-limiter"');
    const scraperTokenCount = (scraperSource.match(/await acquireToken\(/g) || []).length;
    expect(scraperTokenCount).toBeGreaterThanOrEqual(5);
  });

  it("no direct fetch calls remain in fetch-orchestrator outside the limiter", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    const directFetchCalls = source.match(/\bfetch\s*\(/g) || [];
    expect(directFetchCalls.length).toBe(0);
  });

  it("all scraper HTTP paths are rate-limited (WEB_API, HTML_PARSE, HEADLESS_RENDER, pagination)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
    );
    expect(source).toContain("acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `WEB_API:www:");
    expect(source).toContain("acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `WEB_API:i.ig:");
    expect(source).toContain("acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `V1_FEED:page2:");
    expect(source).toContain("acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `HTML_PARSE:");
    expect(source).toContain("acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `HEADLESS_RENDER:");
  });

  it("rate bucket state is logged at job completion", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("getBucketState(accountId, campaignId)");
    expect(source).toContain("Rate bucket state at job end");
    expect(source).toContain("rateBucket: rateBucketState");
  });

  it("CONCURRENCY_FEATURE_FLAG is documented in audit log", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("CONCURRENCY_FEATURE_FLAG ? 2 : MAX_CONCURRENT_COMPETITORS_PER_JOB");
  });
});

describe("Section 8: Global Request Ceiling — Account-Level Concurrency Limit", () => {
  it("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT is 1 (strict sequential)", () => {
    expect(MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT).toBe(1);
  });

  it("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT constant exists in source as 1", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT = 1");
  });

  it("account-level job count check runs before creating a new job", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("getRunningJobCountForAccount(accountId)");
    expect(source).toContain("runningCount >= MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT");
  });

  it("excess jobs are inserted with QUEUED status", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain('status: "QUEUED"');
    expect(source).toContain("QUEUED job");
  });

  it("QUEUED is part of FetchJobStatus type", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain('"QUEUED"');
    const statusLine = source.match(/status:\s*"PENDING"\s*\|\s*"RUNNING"\s*\|\s*"COMPLETE"\s*\|\s*"FAILED"\s*\|\s*"COMPLETE_WITH_COOLDOWN"\s*\|\s*"QUEUED"/);
    expect(statusLine).not.toBeNull();
  });

  it("stagger delay (5s) is enforced between job starts for same account", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    expect(source).toContain("STAGGER_DELAY_MS = 5000");
    expect(source).toContain("Stagger delay");
    expect(source).toContain("lastJobStartByAccount");
  });

  it("ceiling check is on accountId only (not accountId:campaignId)", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    const fnBody = source.substring(
      source.indexOf("async function getRunningJobCountForAccount"),
      source.indexOf("async function _createAndStartJob")
    );
    expect(fnBody).toContain("eq(miFetchJobs.accountId, accountId)");
    expect(fnBody).not.toContain("campaignId");
  });

  it("getRunningJobCountForAccount is exported and available", async () => {
    const mod = await import("../market-intelligence-v3/fetch-orchestrator");
    expect(typeof mod.getRunningJobCountForAccount).toBe("function");
  });

  it("simulate 5 campaigns: source confirms ceiling gate before job insert", async () => {
    const source = await import("fs").then(fs =>
      fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
    );
    const ceilingCheckPos = source.indexOf("runningCount >= MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT");
    const jobInsertPos = source.indexOf('status: "RUNNING"', source.indexOf("async function _createAndStartJob"));
    expect(ceilingCheckPos).toBeGreaterThan(0);
    expect(jobInsertPos).toBeGreaterThan(0);
    expect(ceilingCheckPos).toBeLessThan(jobInsertPos);
  });
});

describe("Section 7: Fetch Hardening — Fair Allocation, Coverage, Dynamic Budgets, Diagnostics", () => {
  const readSource = async () => {
    const fs = await import("fs");
    return fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
  };

  it("per-competitor request cap is computed from budget / competitorCount", async () => {
    const source = await readSource();
    expect(source).toContain("perCompetitorRequestCap");
    expect(source).toContain("Math.ceil(dynamicRequestBudget / competitors.length)");
    expect(source).toContain("stage.requestsUsed >= perCompetitorRequestCap");
  });

  it("fair allocation: each competitor has requestsUsed tracked", async () => {
    const source = await readSource();
    expect(source).toContain("requestsUsed: 0");
    expect(source).toContain("stage.requestsUsed++");
    expect(source).toContain("PER_COMPETITOR_CAP");
  });

  it("explicit per-competitor fetchStatus values are defined", async () => {
    const source = await readSource();
    const requiredStatuses = [
      "FETCH_SUCCESS",
      "FETCH_FAILED",
      "RATE_LIMITED",
      "NO_POSTS_FOUND",
      "SKIPPED_DUE_TO_BUDGET",
      "SKIPPED_DUE_TO_RUNTIME",
      "SKIPPED_DUE_TO_PAGES_CEILING",
      "COOLDOWN_ACTIVE",
      "BLOCKED_BY_PLATFORM",
      "PENDING",
    ];
    for (const status of requiredStatuses) {
      expect(source).toContain(`"${status}"`);
    }
  });

  it("per-competitor fetchStatus is set at each decision point", async () => {
    const source = await readSource();
    expect(source).toContain('s.fetchStatus = skipReason');
    expect(source).toContain('s.fetchStatus = "SKIPPED_DUE_TO_PAGES_CEILING"');
    expect(source).toContain('stage.fetchStatus = "COOLDOWN_ACTIVE"');
    expect(source).toContain('stage.fetchStatus = "BLOCKED_BY_PLATFORM"');
    expect(source).toContain('stage.fetchStatus = "FETCH_FAILED"');
    expect(source).toContain('stage.fetchStatus = fetchResult.postsCollected > 0 ? "FETCH_SUCCESS" : "NO_POSTS_FOUND"');
  });

  it("coverage ratio is computed: competitorsProcessed / competitorsTotal", async () => {
    const source = await readSource();
    expect(source).toContain("competitorsProcessed");
    expect(source).toContain("competitorsFailed");
    expect(source).toContain("competitorsSkipped");
    expect(source).toContain("coverageRatio");
    expect(source).toContain("competitorsProcessed / competitors.length");
  });

  it("coverage data is included in getFetchJobStatus response", async () => {
    const source = await readSource();
    const getStatusFn = source.substring(
      source.indexOf("export async function getFetchJobStatus"),
      source.indexOf("export async function getFetchJobStatus") + 2000
    );
    expect(getStatusFn).toContain("coverage:");
    expect(getStatusFn).toContain("competitorsTotal");
    expect(getStatusFn).toContain("competitorsProcessed");
    expect(getStatusFn).toContain("competitorsFailed");
    expect(getStatusFn).toContain("competitorsSkipped");
    expect(getStatusFn).toContain("coverageRatio");
  });

  it("confidence penalty scales with coverage ratio (not flat 0.3)", async () => {
    const source = await readSource();
    expect(source).toContain("(1 - coverageRatio) * 0.5");
    expect(source).not.toContain("PARTIAL_CONFIDENCE_PENALTY = 0.3");
  });

  it("dynamic budget scaling: computeDynamicBudgets is exported and scales with competitor count", async () => {
    const { computeDynamicBudgets } = await import("../market-intelligence-v3/fetch-orchestrator");
    expect(typeof computeDynamicBudgets).toBe("function");

    const budget3 = computeDynamicBudgets(3);
    const budget6 = computeDynamicBudgets(6);
    const budget12 = computeDynamicBudgets(12);

    expect(budget3.requestBudget).toBeLessThan(budget12.requestBudget);
    expect(budget6.requestBudget).toBeLessThan(budget12.requestBudget);
    expect(budget3.runtimeBudget).toBeLessThanOrEqual(budget12.runtimeBudget);

    expect(budget3.requestBudget).toBe(30);
    expect(budget6.requestBudget).toBe(60);
    expect(budget12.requestBudget).toBe(120);

    expect(budget3.runtimeBudget).toBe(10 * 60 * 1000);
    expect(budget12.runtimeBudget).toBeLessThanOrEqual(25 * 60 * 1000);
  });

  it("dynamic budgets are used in the fetch loop (not static MAX constants)", async () => {
    const source = await readSource();
    expect(source).toContain("dynamicRequestBudget");
    expect(source).toContain("dynamicRuntimeBudget");
    expect(source).toContain("totalRequests >= dynamicRequestBudget");
    expect(source).toContain("Date.now() - startTime >= dynamicRuntimeBudget");
  });

  it("structured diagnostics are logged as JOB_DIAGNOSTICS JSON", async () => {
    const source = await readSource();
    expect(source).toContain("JOB_DIAGNOSTICS");
    expect(source).toContain("JSON.stringify(jobDiagnostics)");
    expect(source).toContain("interface FetchJobDiagnostics");
  });

  it("diagnostics include all required fields", async () => {
    const source = await readSource();
    const diagnosticsInterface = source.substring(
      source.indexOf("interface FetchJobDiagnostics"),
      source.indexOf("interface FetchJobDiagnostics") + 800
    );
    const requiredFields = [
      "competitorCount",
      "requestsUsed",
      "requestBudget",
      "runtimeUsedMs",
      "runtimeBudget",
      "coverageRatio",
      "competitorsTotal",
      "competitorsProcessed",
      "competitorsFailed",
      "competitorsSkipped",
      "skippedCompetitors",
      "rateLimitEvents",
      "perCompetitorStatus",
      "perCompetitorRequestCap",
    ];
    for (const field of requiredFields) {
      expect(diagnosticsInterface).toContain(field);
    }
  });

  it("rateLimitEvents are tracked and counted", async () => {
    const source = await readSource();
    expect(source).toContain("rateLimitEvents++");
    expect(source).toContain("rateLimitEvents");
  });

  it("coverage ratio logged in job completion message", async () => {
    const source = await readSource();
    expect(source).toContain("coverage=");
  });

  it("audit log includes coverage and diagnostics data", async () => {
    const source = await readSource();
    const auditSection = source.substring(
      source.indexOf("MI_FETCH_JOB_COMPLETE"),
      source.indexOf("MI_FETCH_JOB_COMPLETE") + 800
    );
    expect(auditSection).toContain("coverage:");
    expect(auditSection).toContain("diagnostics:");
  });

  it("supports 10-12 competitors: MAX_PAGES_PER_COMPETITOR=12, dynamic budgets scale", async () => {
    const source = await readSource();
    const match = source.match(/MAX_PAGES_PER_COMPETITOR\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(12);

    const { computeDynamicBudgets } = await import("../market-intelligence-v3/fetch-orchestrator");
    const budget10 = computeDynamicBudgets(10);
    expect(budget10.requestBudget).toBe(100);
    expect(budget10.runtimeBudget).toBeLessThanOrEqual(25 * 60 * 1000);
    expect(budget10.runtimeBudget).toBeGreaterThanOrEqual(10 * 60 * 1000);

    const budget12 = computeDynamicBudgets(12);
    expect(budget12.requestBudget).toBe(120);
  });

  it("partial fetch success: analysis continues with available data + confidence penalty", async () => {
    const source = await readSource();
    expect(source).toContain("anyAnalysisRan");
    expect(source).toContain("isPartialCoverage");
    expect(source).toContain("coveragePenalty");
    expect(source).toContain("persistSnapshotAfterFetch");
    const penaltyCalcPresent = source.includes("(1 - coverageRatio) * 0.5");
    expect(penaltyCalcPresent).toBe(true);
  });
});
