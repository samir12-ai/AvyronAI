import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  marketVoiceDiscoveryJobs,
  marketVoiceSearchIntents,
  marketVoiceDiscoveryResults,
  marketVoiceEvidence,
  campaignOfferings,
  offeringInputEvidence,
  ciCompetitors,
  competitorSources,
} from "@shared/schema";
import {
  type SearchIntentPlatform,
  type RawDiscoveryResultDraft,
  type DiscoveryJobStatus,
  generateDiscoveryJobId,
  generateSearchIntentId,
  generateDiscoveryResultId,
} from "@shared/contracts/market-voice";
import { ALLOWED_PLATFORMS } from "../market-voice/search-planner";
import {
  executeSearchIntentByPlatform,
  normalizeCanonicalUrl,
  NonRetryableProviderError,
} from "../market-voice/provider-router";
import {
  executeMarketVoiceDiscoveryJob,
  BudgetWatchdog,
} from "../market-voice/discovery-engine";

describe("Market Voice Phase 3 — Provider Search Discovery & Hardened Execution Suite", () => {
  const testAcc = "acc_test_mv_p3";
  const testCamp = "camp_test_mv_p3";
  const testOfferingId = "off_test_mv_p3";
  const testEvidenceId = "ev_test_mv_p3";
  const testJobId = generateDiscoveryJobId(testCamp, testOfferingId, 1720000000000);

  beforeAll(async () => {
    // Seed canonical offering with USER_CONFIRMED authority
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, testJobId));
    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, testOfferingId));
    await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.id, testEvidenceId));

    await db.insert(offeringInputEvidence).values({
      id: testEvidenceId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      rawOfferingName: "Linen Summer Dresses",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]",
      contentHash: "HASH_P3_TEST",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    await db.insert(campaignOfferings).values({
      id: testOfferingId,
      accountId: testAcc,
      campaignId: testCamp,
      offeringName: "Linen Summer Dresses",
      sourceInputEvidenceId: testEvidenceId,
    });
  });

  afterAll(async () => {
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, testJobId));
    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, testOfferingId));
    await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.id, testEvidenceId));
  });

  // 1. Contract & Platform Extension Tests (Broad Search Policy)
  it("strictly enforces broad search platforms to GOOGLE_SEARCH, REDDIT, WEB_FORUMS and excludes social media", () => {
    expect(ALLOWED_PLATFORMS).toContain("GOOGLE_SEARCH");
    expect(ALLOWED_PLATFORMS).toContain("REDDIT");
    expect(ALLOWED_PLATFORMS).toContain("WEB_FORUMS");
    expect(ALLOWED_PLATFORMS).not.toContain("INSTAGRAM");
    expect(ALLOWED_PLATFORMS).not.toContain("TIKTOK");
    expect(ALLOWED_PLATFORMS).not.toContain("YOUTUBE_SEARCH");
  });

  // 2. Safe Canonical URL Normalization & Case Preservation
  describe("Safe URL Canonicalization", () => {
    it("preserves YouTube video ID case and removes tracking parameters", () => {
      const input = "https://www.youtube.com/watch?v=AbC123XYZ&utm_source=test";
      const normalized = normalizeCanonicalUrl(input);
      expect(normalized).toBe("https://www.youtube.com/watch?v=AbC123XYZ");
      expect(normalized).not.toBe("https://www.youtube.com/watch?v=abc123xyz");
    });

    it("normalizes hostname case while preserving path and query case", () => {
      const input = "HTTPS://EXAMPLE.COM/Product/AbC?ref=test&color=NavyBlue";
      const normalized = normalizeCanonicalUrl(input);
      expect(normalized).toBe("https://example.com/Product/AbC?color=NavyBlue");
    });

    it("does not collapse two URLs that differ only in case-sensitive path or ID", () => {
      const url1 = "https://site.com/item/AbC";
      const url2 = "https://site.com/item/abc";
      expect(normalizeCanonicalUrl(url1)).not.toBe(normalizeCanonicalUrl(url2));

      const res1Id = generateDiscoveryResultId("sint_1", normalizeCanonicalUrl(url1));
      const res2Id = generateDiscoveryResultId("sint_1", normalizeCanonicalUrl(url2));
      expect(res1Id).not.toBe(res2Id);
    });

    it("strips standard tracking parameters and fragments cleanly", () => {
      const input = "https://reddit.com/r/modest/comments/123/thread/?utm_medium=web2x&fbclid=12345#comments";
      const normalized = normalizeCanonicalUrl(input);
      expect(normalized).toBe("https://reddit.com/r/modest/comments/123/thread");
    });
  });

  // 3. Exact Approved Query Execution (No Geography Injection)
  describe("Exact Approved Query Execution", () => {
    it("does not append geography string (LB) to the search query text", async () => {
      const intentId = generateSearchIntentId(testJobId, "modest summer dresses", "GOOGLE_SEARCH");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "modest summer dresses",
        targetPlatform: "GOOGLE_SEARCH",
        marketScope: "TARGET_MARKET",
        targetGeography: "LB",
        limit: 5,
      });

      expect(res.approvedQuery).toBe("modest summer dresses");
      expect(res.providerQuery).toBe("modest summer dresses");
      expect(res.providerQuery).not.toContain("LB");
    }, 90000);

    it("preserves approvedQuery vs providerQuery lineage for WEB_FORUMS syntax", async () => {
      const intentId = generateSearchIntentId(testJobId, "summer fashion community", "WEB_FORUMS");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "summer fashion community",
        targetPlatform: "WEB_FORUMS",
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      expect(res.approvedQuery).toBe("summer fashion community");
      expect(res.providerQuery).toContain("summer fashion community");
      expect(res.providerQuery).toContain("inurl:forum");
    }, 90000);
  });

  // 4. Instagram Search Mode Contract
  describe("Instagram Search Mode Contract", () => {
    it("does not convert arbitrary natural language query to hashtag", async () => {
      const intentId = generateSearchIntentId(testJobId, "trends in modest summer dresses 2026", "INSTAGRAM");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "trends in modest summer dresses 2026",
        targetPlatform: "INSTAGRAM",
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      expect(res.approvedQuery).toBe("trends in modest summer dresses 2026");
      expect(res.providerQuery).toBe("trends in modest summer dresses 2026");
      expect(res.providerQuery.startsWith("#")).toBe(false);
      expect(["COMPLETED", "NO_RESULTS", "PROVIDER_UNAVAILABLE", "PROVIDER_FAILED"]).toContain(res.status);
    }, 90000);
  });

  // 5. Neutral Content Types
  describe("Neutral Discovery Content Types", () => {
    it("assigns WEB_PAGE to generic Google SERP results, not COMMUNITY_POST", async () => {
      const intentId = generateSearchIntentId(testJobId, "best summer linen dresses", "GOOGLE_SEARCH");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "best summer linen dresses",
        targetPlatform: "GOOGLE_SEARCH",
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      if (res.status === "COMPLETED" && res.results.length > 0) {
        const nonForum = res.results.find((r) => !r.url.includes("forum") && !r.url.includes("community"));
        if (nonForum) {
          expect(nonForum.discoveredType).toBe("WEB_PAGE");
          expect(nonForum.discoveredType).not.toBe("COMMUNITY_POST");
        }
      }
    }, 90000);

    it("assigns YOUTUBE_VIDEO to YouTube results, not REVIEW_PAGE", async () => {
      const intentId = generateSearchIntentId(testJobId, "linen dresses try on haul", "YOUTUBE_SEARCH");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "linen dresses try on haul",
        targetPlatform: "YOUTUBE_SEARCH",
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      if (res.status === "COMPLETED" && res.results.length > 0) {
        expect(res.results[0].discoveredType).toBe("YOUTUBE_VIDEO");
        expect(res.results[0].discoveredType).not.toBe("REVIEW_PAGE");
      }
    }, 90000);
  });

  // 6. Retry Ownership & Honest Statuses
  describe("Retry Ownership and Capabilities", () => {
    it("reports retryCount=0 on immediate success or clean execution", async () => {
      const intentId = generateSearchIntentId(testJobId, "modest summer dresses", "GOOGLE_SEARCH");
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: intentId,
        query: "modest summer dresses",
        targetPlatform: "GOOGLE_SEARCH",
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      if (res.status === "COMPLETED" || res.status === "NO_RESULTS") {
        expect(res.retryCount).toBe(0);
      }
    }, 90000);

    it("unsupported target platform returns PROVIDER_UNAVAILABLE with retryCount=0 without fake fallback", async () => {
      const res = await executeSearchIntentByPlatform({
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        discoveryJobId: testJobId,
        searchIntentId: "sint_invalid",
        query: "some query",
        targetPlatform: "PINTEREST" as any,
        marketScope: "GLOBAL_CATEGORY",
        limit: 5,
      });

      expect(res.status).toBe("PROVIDER_UNAVAILABLE");
      expect(res.retryCount).toBe(0);
      expect(res.results.length).toBe(0);
    });

    it("BudgetWatchdog stops execution before provider calls when limits are reached", () => {
      const watchdog = new BudgetWatchdog({
        maxProviderCallsPerJob: 2,
        maxTotalResultsPerJob: 15,
        maxResultsPerIntent: 10,
      });

      expect(watchdog.canExecuteIntent()).toBe(true);
      watchdog.recordCall();
      watchdog.recordResults(10);
      expect(watchdog.canExecuteIntent()).toBe(true);

      watchdog.recordCall();
      watchdog.recordResults(5); // totalResultsFetched = 15
      expect(watchdog.canExecuteIntent()).toBe(false);
      expect(watchdog.getRemainingResultsBudget()).toBe(0);
    });
  });

  // 7. Job Status Aggregation (COMPLETED vs COMPLETED_WITH_GAPS vs FAILED)
  describe("Job Status Aggregation", () => {
    it("marks job COMPLETED_WITH_GAPS when some intents succeed and others have provider gaps", async () => {
      const partialJobId = generateDiscoveryJobId(testCamp, testOfferingId, 1720000000001);
      await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, partialJobId));

      await db.insert(marketVoiceDiscoveryJobs).values({
        id: partialJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        status: "PENDING",
      });

      const intentGoogle = generateSearchIntentId(partialJobId, "summer linen dresses", "GOOGLE_SEARCH");
      const intentUnavailable = generateSearchIntentId(partialJobId, "unsupported query", "PINTEREST" as any);

      await db.insert(marketVoiceSearchIntents).values([
        {
          id: intentGoogle,
          discoveryJobId: partialJobId,
          accountId: testAcc,
          campaignId: testCamp,
          campaignOfferingId: testOfferingId,
          query: "summer linen dresses",
          intentCategory: "CUSTOMER_DISCUSSION",
          marketScope: "GLOBAL_CATEGORY",
          targetPlatform: "GOOGLE_SEARCH",
          status: "PENDING",
        },
        {
          id: intentUnavailable,
          discoveryJobId: partialJobId,
          accountId: testAcc,
          campaignId: testCamp,
          campaignOfferingId: testOfferingId,
          query: "unsupported query",
          intentCategory: "CUSTOMER_DISCUSSION",
          marketScope: "GLOBAL_CATEGORY",
          targetPlatform: "PINTEREST" as any,
          status: "PENDING",
        },
      ]);

      const summary = await executeMarketVoiceDiscoveryJob(partialJobId);

      expect(summary.status).toBe("COMPLETED_WITH_GAPS");
      expect(summary.successfulIntents).toBeGreaterThanOrEqual(1);
      expect(summary.unavailableIntents).toBe(1);

      await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, partialJobId));
    }, 90000);
  });

  // 8. Full Orchestration & Strict Database Invariants
  describe("Full Discovery Execution & Invariants", () => {
    it("executes an approved discovery job, records discovery results, and preserves strict lineage", async () => {
      await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, testJobId));

      // 1. Seed job
      await db.insert(marketVoiceDiscoveryJobs).values({
        id: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        status: "PENDING",
      });

      // 2. Seed 2 approved search intents
      const intent1Id = generateSearchIntentId(testJobId, "summer linen dresses review", "GOOGLE_SEARCH");
      const intent2Id = generateSearchIntentId(testJobId, "modest fashion community forum", "WEB_FORUMS");

      await db.insert(marketVoiceSearchIntents).values([
        {
          id: intent1Id,
          discoveryJobId: testJobId,
          accountId: testAcc,
          campaignId: testCamp,
          campaignOfferingId: testOfferingId,
          query: "summer linen dresses review",
          intentCategory: "CUSTOMER_DISCUSSION",
          marketScope: "GLOBAL_CATEGORY",
          targetPlatform: "GOOGLE_SEARCH",
          targetGeography: null,
          status: "PENDING",
        },
        {
          id: intent2Id,
          discoveryJobId: testJobId,
          accountId: testAcc,
          campaignId: testCamp,
          campaignOfferingId: testOfferingId,
          query: "modest fashion community forum",
          intentCategory: "CUSTOMER_DISCUSSION",
          marketScope: "GLOBAL_CATEGORY",
          targetPlatform: "WEB_FORUMS",
          targetGeography: null,
          status: "PENDING",
        },
      ]);

      // 3. Execute Discovery Engine
      const summary = await executeMarketVoiceDiscoveryJob(testJobId, {
        budgetConfig: {
          maxIntentsPerJob: 5,
          maxProviderCallsPerJob: 5,
          maxResultsPerIntent: 5,
          maxTotalResultsPerJob: 20,
        },
      });

      expect(summary.discoveryJobId).toBe(testJobId);
      expect(["COMPLETED", "COMPLETED_WITH_GAPS"]).toContain(summary.status);
      expect(summary.totalIntents).toBe(2);
      expect(summary.telemetry.length).toBe(2);

      // Verify exact approvedQuery and providerQuery in telemetry
      for (const t of summary.telemetry) {
        expect(t.approvedQuery).toBeTruthy();
        expect(t.providerQuery).toBeTruthy();
      }

      // 4. Verify DB State: market_voice_discovery_results
      const results = await db
        .select()
        .from(marketVoiceDiscoveryResults)
        .where(eq(marketVoiceDiscoveryResults.discoveryJobId, testJobId));

      for (const res of results) {
        expect(res.accountId).toBe(testAcc);
        expect(res.campaignId).toBe(testCamp);
        expect(res.campaignOfferingId).toBe(testOfferingId);
        expect(res.discoveryJobId).toBe(testJobId);
        expect([intent1Id, intent2Id]).toContain(res.searchIntentId);
        expect(res.verificationStatus).toBe("DISCOVERED");
        expect(res.url).toBeTruthy();
        expect(res.canonicalUrl).toBeTruthy();
      }

      // 5. STRICT PHASE 3 BOUNDARY INVARIANTS:
      // market_voice_evidence MUST BE 0
      const [evidenceCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(marketVoiceEvidence)
        .where(eq(marketVoiceEvidence.discoveryJobId, testJobId));
      expect(evidenceCount.count).toBe(0);

      // ci_competitors MUST NOT be created
      const [competitorCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ciCompetitors)
        .where(eq(ciCompetitors.accountId, testAcc));
      expect(competitorCount.count).toBe(0);

      // competitor_sources MUST NOT be created
      const [sourcesCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(competitorSources)
        .where(eq(competitorSources.accountId, testAcc));
      expect(sourcesCount.count).toBe(0);
    }, 240000);

    it("enforces structural idempotency without creating duplicate discovery results", async () => {
      const intent1Id = generateSearchIntentId(testJobId, "summer linen dresses review", "GOOGLE_SEARCH");
      const sampleUrl = "https://www.example.com/Product/SummerDress?ref=123";
      const canonical = normalizeCanonicalUrl(sampleUrl);
      const resultId = generateDiscoveryResultId(intent1Id, canonical);

      // First insert
      await db.insert(marketVoiceDiscoveryResults).values({
        id: resultId,
        searchIntentId: intent1Id,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: sampleUrl,
        canonicalUrl: canonical,
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE",
      }).onConflictDoNothing();

      const count1 = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(marketVoiceDiscoveryResults)
        .where(eq(marketVoiceDiscoveryResults.id, resultId));

      expect(count1[0].count).toBe(1);

      // Re-insert exact same result
      await db.insert(marketVoiceDiscoveryResults).values({
        id: resultId,
        searchIntentId: intent1Id,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: sampleUrl,
        canonicalUrl: canonical,
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE",
      }).onConflictDoNothing();

      const count2 = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(marketVoiceDiscoveryResults)
        .where(eq(marketVoiceDiscoveryResults.id, resultId));

      expect(count2[0].count).toBe(1);
    });
  });
});

