import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireStickySession,
  releaseStickySession,
  rotateSessionOnBlock,
  classifyBlock,
  logProxyTelemetry,
  getPoolDiagnostics,
  getTelemetryForJob,
  clearPool,
  isSessionQuarantined,
  getRetryDelay,
  MAX_RETRIES_PER_STAGE,
  SESSION_TTL_MS,
  QUARANTINE_THRESHOLD,
  type StickySessionContext,
  type BlockClass,
} from "../competitive-intelligence/proxy-pool-manager";

const TEST_ACCOUNT_A = "test_account_a";
const TEST_ACCOUNT_B = "test_account_b";
const TEST_CAMPAIGN = "test_campaign_1";
const TEST_COMP_HASH = "abc123def456";

describe("Proxy Pool Manager — Torture Tests", () => {
  beforeEach(() => {
    clearPool(TEST_ACCOUNT_A);
    clearPool(TEST_ACCOUNT_B);
  });

  describe("A) Sticky Session Pagination Test", () => {
    it("should maintain the same proxySessionId across all pages of pagination", () => {
      const ctx = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      const sessionIdAtStart = ctx.session.sessionId;
      const ipHashAtStart = ctx.session.ipHash;

      for (let page = 1; page <= 5; page++) {
        expect(ctx.session.sessionId).toBe(sessionIdAtStart);
        expect(ctx.session.ipHash).toBe(ipHashAtStart);

        logProxyTelemetry(ctx, `PAGINATION_PAGE_${page}`, 200, null, 100, true);
      }

      const telemetry = getTelemetryForJob(TEST_ACCOUNT_A, TEST_COMP_HASH);
      const sessionIds = new Set(telemetry.map(e => e.proxySessionId));
      expect(sessionIds.size).toBe(1);
      expect(sessionIds.has(sessionIdAtStart)).toBe(true);

      const ipHashes = new Set(telemetry.map(e => e.ipHash));
      expect(ipHashes.size).toBe(1);
      expect(ipHashes.has(ipHashAtStart)).toBe(true);

      releaseStickySession(ctx);
    });

    it("should return the same session for repeated acquire calls with the same binding key", () => {
      const ctx1 = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      const ctx2 = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      expect(ctx1).not.toBeNull();
      expect(ctx2).not.toBeNull();
      if (!ctx1 || !ctx2) return;
      expect(ctx1.session.sessionId).toBe(ctx2.session.sessionId);
      releaseStickySession(ctx1);
    });
  });

  describe("B) Proxy Block Storm Test", () => {
    it("should rotate sessions on block and complete within bounded retries", () => {
      let ctx: StickySessionContext | null = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      const initialSession = ctx.session.sessionId;

      const rotated1 = rotateSessionOnBlock(ctx, "PROXY_BLOCKED");
      expect(rotated1).not.toBeNull();
      if (!rotated1) return;
      expect(rotated1.session.sessionId).not.toBe(initialSession);
      expect(rotated1.attemptNumber).toBe(2);

      const rotated2 = rotateSessionOnBlock(rotated1, "RATE_LIMIT");
      expect(rotated2).not.toBeNull();
      if (!rotated2) return;
      expect(rotated2.session.sessionId).not.toBe(rotated1.session.sessionId);
      expect(rotated2.attemptNumber).toBe(3);

      const rotated3 = rotateSessionOnBlock(rotated2, "PROXY_BLOCKED");
      expect(rotated3).toBeNull();

      releaseStickySession(rotated2);
    });

    it("should not rotate on non-block errors (AUTH_REQUIRED, CHECKPOINT)", () => {
      const ctx = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      const rotated = rotateSessionOnBlock(ctx, "AUTH_REQUIRED");
      expect(rotated).toBeNull();

      const rotated2 = rotateSessionOnBlock(ctx, "CHECKPOINT");
      expect(rotated2).toBeNull();

      releaseStickySession(ctx);
    });

    it("should have a bounded maximum of 3 attempts", () => {
      expect(MAX_RETRIES_PER_STAGE).toBe(3);
    });
  });

  describe("C) Quarantine Test", () => {
    it("should quarantine a session after 2 blocks within 10 minutes", () => {
      const ctx = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "quarantine_direct");
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      const sessionId = ctx.session.sessionId;

      rotateSessionOnBlock(ctx, "PROXY_BLOCKED");

      const quarantinedAfter1 = isSessionQuarantined(TEST_ACCOUNT_A, sessionId);
      expect(quarantinedAfter1).toBe(false);

      const ctx2 = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "quarantine_direct_2");
      if (ctx2) {
        const sid = ctx2.session.sessionId;
        rotateSessionOnBlock(ctx2, "PROXY_BLOCKED");
        rotateSessionOnBlock(ctx2, "PROXY_BLOCKED");
        const quarantinedAfter2 = isSessionQuarantined(TEST_ACCOUNT_A, sid);
        expect(quarantinedAfter2).toBe(true);

        const diag = getPoolDiagnostics(TEST_ACCOUNT_A);
        expect(diag.quarantinedSessions).toBeGreaterThanOrEqual(1);

        releaseStickySession(ctx2);
      }

      releaseStickySession(ctx);
    });

    it("should not select quarantined sessions for new requests", () => {
      const ctx1 = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "quarantine_test");
      if (!ctx1) return;

      rotateSessionOnBlock(ctx1, "PROXY_BLOCKED");
      rotateSessionOnBlock(ctx1, "PROXY_BLOCKED");

      const quarantinedId = ctx1.session.sessionId;

      const ctx2 = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "new_comp_after_quarantine");
      if (ctx2) {
        expect(ctx2.session.sessionId).not.toBe(quarantinedId);
        releaseStickySession(ctx2);
      }

      releaseStickySession(ctx1);
    });

    it("quarantine threshold is exactly 2", () => {
      expect(QUARANTINE_THRESHOLD).toBe(2);
    });
  });

  describe("D) Cross-Account Isolation Test", () => {
    it("account A blocks should not affect account B", () => {
      const ctxA = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, TEST_COMP_HASH);
      const ctxB = acquireStickySession(TEST_ACCOUNT_B, TEST_CAMPAIGN, TEST_COMP_HASH);

      expect(ctxA).not.toBeNull();
      expect(ctxB).not.toBeNull();
      if (!ctxA || !ctxB) return;

      expect(ctxA.session.sessionId).not.toBe(ctxB.session.sessionId);

      rotateSessionOnBlock(ctxA, "PROXY_BLOCKED");
      rotateSessionOnBlock(ctxA, "PROXY_BLOCKED");

      const diagA = getPoolDiagnostics(TEST_ACCOUNT_A);
      const diagB = getPoolDiagnostics(TEST_ACCOUNT_B);

      expect(diagA.quarantinedSessions).toBeGreaterThanOrEqual(1);
      expect(diagB.quarantinedSessions).toBe(0);

      const ctxBNew = acquireStickySession(TEST_ACCOUNT_B, TEST_CAMPAIGN, "fresh_comp");
      expect(ctxBNew).not.toBeNull();
      if (ctxBNew) {
        expect(ctxBNew.session.sessionId).not.toBe(ctxA.session.sessionId);
        releaseStickySession(ctxBNew);
      }

      releaseStickySession(ctxA);
      releaseStickySession(ctxB);
    });

    it("pool state is completely isolated per account", () => {
      const ctxA = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "iso_test");
      const ctxB = acquireStickySession(TEST_ACCOUNT_B, TEST_CAMPAIGN, "iso_test");

      if (ctxA) logProxyTelemetry(ctxA, "TEST", 200, null, 50, true);
      if (ctxA) logProxyTelemetry(ctxA, "TEST", 200, null, 50, true);
      if (ctxB) logProxyTelemetry(ctxB, "TEST", 200, null, 50, true);

      const telA = getTelemetryForJob(TEST_ACCOUNT_A);
      const telB = getTelemetryForJob(TEST_ACCOUNT_B);

      expect(telA.length).toBe(2);
      expect(telB.length).toBe(1);

      expect(telA.every(e => e.accountId === TEST_ACCOUNT_A)).toBe(true);
      expect(telB.every(e => e.accountId === TEST_ACCOUNT_B)).toBe(true);

      clearPool(TEST_ACCOUNT_A);
      const diagA = getPoolDiagnostics(TEST_ACCOUNT_A);
      const diagB = getPoolDiagnostics(TEST_ACCOUNT_B);

      expect(diagA.totalSessions).toBe(0);
      expect(diagB.totalSessions).toBeGreaterThanOrEqual(1);

      if (ctxA) releaseStickySession(ctxA);
      if (ctxB) releaseStickySession(ctxB);
    });
  });

  describe("E) No-Hang Test", () => {
    it("should reach terminal state even under continuous blocks", () => {
      let ctx: StickySessionContext | null = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "hang_test");
      expect(ctx).not.toBeNull();
      if (!ctx) return;

      let terminated = false;
      let attempts = 0;

      while (attempts < 10) {
        attempts++;
        const rotated = rotateSessionOnBlock(ctx, "PROXY_BLOCKED");
        if (!rotated) {
          terminated = true;
          break;
        }
        ctx = rotated;
      }

      expect(terminated).toBe(true);
      expect(attempts).toBeLessThanOrEqual(MAX_RETRIES_PER_STAGE);

      releaseStickySession(ctx);
    });

    it("should never have unbounded retry loops", () => {
      const source = require("fs").readFileSync(
        "server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8"
      );
      expect(source).not.toContain("while (true)");
      expect(source).not.toContain("while(true)");

      expect(source).toContain("MAX_RETRIES");
      expect(source).toContain("attempt <= MAX_RETRIES");
    });
  });

  describe("F) Rotation Rules Enforcement", () => {
    it("rotation ONLY allowed on PROXY_BLOCKED and RATE_LIMIT", () => {
      const ctx = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "rotation_rules");
      if (!ctx) return;

      const allowedBlocks: BlockClass[] = ["PROXY_BLOCKED", "RATE_LIMIT"];
      const deniedBlocks: BlockClass[] = ["AUTH_REQUIRED", "CHECKPOINT", "OTHER"];

      for (const block of allowedBlocks) {
        const fresh = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, `allowed_${block}`);
        if (fresh) {
          const rotated = rotateSessionOnBlock(fresh, block);
          expect(rotated).not.toBeNull();
          if (rotated) releaseStickySession(rotated);
        }
      }

      for (const block of deniedBlocks) {
        const fresh = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, `denied_${block}`);
        if (fresh) {
          const rotated = rotateSessionOnBlock(fresh, block);
          expect(rotated).toBeNull();
          releaseStickySession(fresh);
        }
      }

      releaseStickySession(ctx);
    });
  });

  describe("G) Telemetry Completeness", () => {
    it("every telemetry entry has all required fields", () => {
      const ctx = acquireStickySession(TEST_ACCOUNT_A, TEST_CAMPAIGN, "telemetry_test");
      if (!ctx) return;

      logProxyTelemetry(ctx, "WEB_API", 200, null, 150, true);
      logProxyTelemetry(ctx, "PAGINATION_PAGE_1", 403, "PROXY_BLOCKED", 250, false);

      const entries = getTelemetryForJob(TEST_ACCOUNT_A, "telemetry_test");
      expect(entries.length).toBe(2);

      for (const entry of entries) {
        expect(entry.accountId).toBe(TEST_ACCOUNT_A);
        expect(entry.campaignId).toBe(TEST_CAMPAIGN);
        expect(entry.competitorHash).toBe("telemetry_test");
        expect(entry.proxySessionId).toBeTruthy();
        expect(entry.ipHash).toBeTruthy();
        expect(entry.stageName).toBeTruthy();
        expect(typeof entry.attemptNumber).toBe("number");
        expect(typeof entry.durationMs).toBe("number");
        expect(typeof entry.success).toBe("boolean");
        expect(typeof entry.timestamp).toBe("number");
      }

      const successEntry = entries.find(e => e.success);
      expect(successEntry?.httpStatus).toBe(200);
      expect(successEntry?.blockClass).toBeNull();

      const blockEntry = entries.find(e => !e.success);
      expect(blockEntry?.httpStatus).toBe(403);
      expect(blockEntry?.blockClass).toBe("PROXY_BLOCKED");

      releaseStickySession(ctx);
    });

    it("classifyBlock correctly identifies block types", () => {
      expect(classifyBlock(403, "blocked")).toBe("PROXY_BLOCKED");
      expect(classifyBlock(429, "")).toBe("RATE_LIMIT");
      expect(classifyBlock(null, "rate limit")).toBe("RATE_LIMIT");
      expect(classifyBlock(401, "")).toBe("AUTH_REQUIRED");
      expect(classifyBlock(null, "require_login")).toBe("AUTH_REQUIRED");
      expect(classifyBlock(null, "checkpoint")).toBe("CHECKPOINT");
      expect(classifyBlock(null, "proxy connection failed")).toBe("PROXY_BLOCKED");
      expect(classifyBlock(200, "timeout")).toBe("OTHER");
    });
  });

  describe("H) Concurrency Guards", () => {
    it("concurrency constants are properly set", () => {
      const source = require("fs").readFileSync(
        "server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8"
      );
      expect(source).toContain("MAX_CONCURRENT_COMPETITORS_PER_JOB = 1");
      expect(source).toContain("MAX_INFLIGHT_REQUESTS_PER_COMPETITOR = 1");
    });

    it("competitors run sequentially (for loop, not Promise.all)", () => {
      const source = require("fs").readFileSync(
        "server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8"
      );
      expect(source).toContain("for (const comp of competitors)");
      const promiseAllCompetitors = source.match(/Promise\.all\(.*competitors.*map/s);
      expect(promiseAllCompetitors).toBeNull();
    });
  });

  describe("I) Session TTL", () => {
    it("session TTL is between 10-15 minutes", () => {
      expect(SESSION_TTL_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
      expect(SESSION_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
    });
  });

  describe("J) Telemetry Coverage — All Request Paths", () => {
    it("profile-scraper instruments telemetry for all stages", () => {
      const source = require("fs").readFileSync(
        "server/competitive-intelligence/profile-scraper.ts", "utf-8"
      );
      expect(source).toContain('logProxyTelemetry(proxyCtx, "WEB_API"');
      expect(source).toContain('logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2"');
      expect(source).toContain('logProxyTelemetry(proxyCtx, `PAGINATION_PAGE_${paginationPages}`');
      expect(source).toContain('logProxyTelemetry(proxyCtx, "HTML_PARSE"');
      expect(source).toContain('logProxyTelemetry(proxyCtx, "HEADLESS_RENDER"');
    });

    it("fetch orchestrator instruments telemetry for POSTS_FETCH", () => {
      const source = require("fs").readFileSync(
        "server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8"
      );
      expect(source).toContain('logProxyTelemetry(proxyCtx, "POSTS_FETCH"');
    });
  });

  describe("K) Orchestrator Integration", () => {
    it("fetch orchestrator imports and uses proxy pool manager", () => {
      const source = require("fs").readFileSync(
        "server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8"
      );
      expect(source).toContain("acquireStickySession");
      expect(source).toContain("releaseStickySession");
      expect(source).toContain("rotateSessionOnBlock");
      expect(source).toContain("logProxyTelemetry");
      expect(source).toContain("getPoolDiagnostics");
    });

    it("data-acquisition passes proxyCtx through to scraper", () => {
      const source = require("fs").readFileSync(
        "server/competitive-intelligence/data-acquisition.ts", "utf-8"
      );
      expect(source).toContain("proxyCtx");
      expect(source).toContain("scrapeInstagramProfile(competitor.profileLink, proxyCtx)");
    });

    it("profile-scraper uses sticky session dispatcher when provided", () => {
      const source = require("fs").readFileSync(
        "server/competitive-intelligence/profile-scraper.ts", "utf-8"
      );
      expect(source).toContain("proxyCtx.session.dispatcher");
      expect(source).toContain("proxyCtx.session.sessionId");
    });
  });
});
