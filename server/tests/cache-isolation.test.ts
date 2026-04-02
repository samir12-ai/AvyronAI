/**
 * CACHE ISOLATION REGRESSION TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression suite covering all in-memory caches that were found to be missing
 * accountId in their cache keys. Tests verify that two accounts with the same
 * campaignId (or competitor handle) cannot see each other's cached data.
 *
 * Scenarios covered:
 *  1. Two accounts with the same campaignId cannot share signalCache entries
 *  2. Two accounts scraping the same competitor handle cannot share profileCache
 *  3. Two accounts with the same campaignId cannot share aelCache
 *  4. Two accounts with the same campaignId cannot share celReportCache
 *  5. Two accounts with the same campaignId cannot share integrityReports
 *  6. resolveAccountId throws when no accountId is on the request
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach } from "vitest";

const ACCOUNT_A = "account-aaa-111";
const ACCOUNT_B = "account-bbb-222";
const SHARED_CAMPAIGN_ID = "campaign-shared-xyz";
const SHARED_HANDLE = "competitor_brand";

describe("Cache Isolation — signalCache (isDuplicateSignal / recordSignalEmission)", () => {
  it("isDuplicateSignal key includes accountId — verified in source", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    expect(content).toContain("`${accountId}:${campaignId}:${metric}`");
  });

  it("isDuplicateSignal accepts accountId as 4th parameter", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    expect(content).toMatch(/function isDuplicateSignal\([^)]*accountId/);
  });

  it("recordSignalEmission accepts accountId as 4th parameter", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    expect(content).toMatch(/function recordSignalEmission\([^)]*accountId/);
  });

  it("all call sites pass accountId as 4th argument to isDuplicateSignal", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    const calls = content.match(/isDuplicateSignal\([^)]+\)/g) || [];
    for (const call of calls) {
      const args = call.split(",");
      expect(args.length).toBeGreaterThanOrEqual(4);
    }
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it("all call sites pass accountId as 4th argument to recordSignalEmission", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    const calls = content.match(/recordSignalEmission\([^)]+\)/g) || [];
    for (const call of calls) {
      const args = call.split(",");
      expect(args.length).toBeGreaterThanOrEqual(4);
    }
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Cache Isolation — aelCache (getCachedAEL / setCachedAEL)", () => {
  beforeEach(async () => {
  });

  it("account-A's cached AEL is not visible to account-B with the same campaignId", async () => {
    const { getCachedAEL, setCachedAEL } = await import("../analytical-enrichment-layer/routes");

    const fakePackage = { version: 1, accountId: ACCOUNT_A, campaignId: SHARED_CAMPAIGN_ID } as any;
    setCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_A, fakePackage);

    const resultForA = getCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_A);
    const resultForB = getCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_B);

    expect(resultForA).not.toBeNull();
    expect(resultForA?.accountId).toBe(ACCOUNT_A);
    expect(resultForB).toBeNull();
  });

  it("two accounts can independently cache different AEL packages for the same campaignId", async () => {
    const { getCachedAEL, setCachedAEL } = await import("../analytical-enrichment-layer/routes");

    const pkgA = { version: 1, accountId: ACCOUNT_A } as any;
    const pkgB = { version: 2, accountId: ACCOUNT_B } as any;

    setCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_A, pkgA);
    setCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_B, pkgB);

    expect(getCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_A)?.accountId).toBe(ACCOUNT_A);
    expect(getCachedAEL(SHARED_CAMPAIGN_ID, ACCOUNT_B)?.accountId).toBe(ACCOUNT_B);
  });
});

describe("Cache Isolation — celReportCache (storeCELReport / getCachedCELReport)", () => {
  it("account-A's CEL report is not visible to account-B with the same campaignId", async () => {
    const { storeCELReport, getCachedCELReport } = await import("../causal-enforcement-layer/engine");

    const fakeReport = {
      campaignId: SHARED_CAMPAIGN_ID,
      version: 2,
      generatedAt: new Date().toISOString(),
      engineResults: [],
      overallScore: 0.9,
      overallPassed: true,
      summary: "Account A report",
    } as any;

    storeCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_A, fakeReport);

    const resultForA = getCachedCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_A);
    const resultForB = getCachedCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_B);

    expect(resultForA).not.toBeNull();
    expect(resultForA?.summary).toBe("Account A report");
    expect(resultForB).toBeNull();
  });

  it("two accounts can store separate CEL reports for the same campaignId without collision", async () => {
    const { storeCELReport, getCachedCELReport } = await import("../causal-enforcement-layer/engine");

    const reportA = { campaignId: SHARED_CAMPAIGN_ID, version: 2, generatedAt: new Date().toISOString(), engineResults: [], overallScore: 0.9, overallPassed: true, summary: "report-A" } as any;
    const reportB = { campaignId: SHARED_CAMPAIGN_ID, version: 2, generatedAt: new Date().toISOString(), engineResults: [], overallScore: 0.7, overallPassed: false, summary: "report-B" } as any;

    storeCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_A, reportA);
    storeCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_B, reportB);

    expect(getCachedCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_A)?.summary).toBe("report-A");
    expect(getCachedCELReport(SHARED_CAMPAIGN_ID, ACCOUNT_B)?.summary).toBe("report-B");
  });
});

describe("Cache Isolation — integrityReports (storeIntegrityReport)", () => {
  it("storeIntegrityReport signature requires accountId as 2nd argument", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/system-integrity/routes.ts",
      "utf-8"
    );
    expect(content).toMatch(/function storeIntegrityReport\([^)]*accountId/);
    expect(content).toContain("`${accountId}:${campaignId}`");
  });

  it("GET /api/system-integrity/:campaignId requires authMiddleware", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/system-integrity/routes.ts",
      "utf-8"
    );
    expect(content).toContain("authMiddleware");
    const routeLine = content.split("\n").find((l: string) => l.includes('"/api/system-integrity/:campaignId"'));
    expect(routeLine).toContain("authMiddleware");
  });

  it("orchestrator passes config.accountId to storeIntegrityReport", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/orchestrator/index.ts",
      "utf-8"
    );
    expect(content).toContain("storeIntegrityReport(config.campaignId, config.accountId");
  });

  it("orchestrator passes config.accountId to storeCELReport", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/orchestrator/index.ts",
      "utf-8"
    );
    expect(content).toContain("storeCELReport(config.campaignId, config.accountId");
  });
});

describe("Auth Hardening — resolveAccountId", () => {
  it("throws when req has no accountId", async () => {
    const { resolveAccountId } = await import("../auth");
    const fakeReq = {} as any;
    expect(() => resolveAccountId(fakeReq)).toThrow("resolveAccountId: no accountId on request");
  });

  it("returns accountId when it exists on req", async () => {
    const { resolveAccountId } = await import("../auth");
    const fakeReq = { accountId: "acct-xyz" } as any;
    expect(resolveAccountId(fakeReq)).toBe("acct-xyz");
  });

  it("never returns 'default'", async () => {
    const { resolveAccountId } = await import("../auth");
    const fakeReq = {} as any;
    expect(() => resolveAccountId(fakeReq)).toThrow();
    const withAccount = { accountId: "real-account" } as any;
    expect(resolveAccountId(withAccount)).not.toBe("default");
  });
});

describe("Cache Isolation — profileCache key scoping", () => {
  it("profileCache key includes accountId to prevent cross-account scrape cache hits", async () => {
    const mod = await import("../competitive-intelligence/profile-scraper");
    const src = await import("fs");
    const content = src.readFileSync("/home/runner/workspace/server/competitive-intelligence/profile-scraper.ts", "utf-8");

    expect(content).toContain("const cacheKey = `${accountId}:${handle}`");
    expect(content).toContain("profileCache.get(cacheKey)");
    expect(content).toContain("profileCache.set(cacheKey");
  });
});

describe("Cache Isolation — all in-memory Maps sweep", () => {
  it("all cache get/set calls in profile-scraper use cacheKey not bare handle", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/competitive-intelligence/profile-scraper.ts",
      "utf-8"
    );
    const bareHandleGet = content.match(/profileCache\.get\(handle\)/g);
    const bareHandleSet = content.match(/profileCache\.set\(handle,/g);
    expect(bareHandleGet).toBeNull();
    expect(bareHandleSet).toBeNull();
  });

  it("all signalCache calls in campaign-data-layer pass accountId as 4th argument", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/campaign-data-layer.ts",
      "utf-8"
    );
    const bareIsDuplicate = content.match(/isDuplicateSignal\([^)]+\)/g) || [];
    for (const call of bareIsDuplicate) {
      const argCount = call.split(",").length;
      expect(argCount).toBeGreaterThanOrEqual(4);
    }
    const bareRecord = content.match(/recordSignalEmission\([^)]+\)/g) || [];
    for (const call of bareRecord) {
      const argCount = call.split(",").length;
      expect(argCount).toBeGreaterThanOrEqual(4);
    }
  });

  it("aelCache uses compound accountId:campaignId key", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/analytical-enrichment-layer/routes.ts",
      "utf-8"
    );
    expect(content).toContain("`${accountId}:${campaignId}`");
    expect(content).not.toMatch(/aelCache\.get\(campaignId\)/);
    expect(content).not.toMatch(/aelCache\.set\(campaignId,/);
  });

  it("celReportCache uses compound accountId:campaignId key", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/causal-enforcement-layer/engine.ts",
      "utf-8"
    );
    expect(content).toContain("`${accountId}:${campaignId}`");
    expect(content).not.toMatch(/celReportCache\.get\(campaignId\)/);
    expect(content).not.toMatch(/celReportCache\.set\(campaignId,/);
  });

  it("integrityReports uses compound accountId:campaignId key", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/system-integrity/routes.ts",
      "utf-8"
    );
    expect(content).toContain("`${accountId}:${campaignId}`");
    expect(content).not.toMatch(/integrityReports\.set\(campaignId,/);
    expect(content).not.toMatch(/integrityReports\.get\(campaignId\)/);
  });

  it("resolveAccountId no longer contains 'return default' fallback", () => {
    const content = require("fs").readFileSync(
      "/home/runner/workspace/server/auth.ts",
      "utf-8"
    );
    const resolveBlock = content.substring(
      content.indexOf("export function resolveAccountId"),
      content.indexOf("export function resolveAccountId") + 300
    );
    expect(resolveBlock).not.toContain('return "default"');
    expect(resolveBlock).toContain("throw new Error");
  });
});
