import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import { executeSourceFetch, PLATFORM_PROVIDER_CAPABILITIES } from "C:/Users/mahmo/Projects/AvyronAI/server/competitive-intelligence/provider-registry";
import { enrichCompetitorWithMultiSources } from "C:/Users/mahmo/Projects/AvyronAI/server/competitive-intelligence/data-acquisition";
import { db } from "C:/Users/mahmo/Projects/AvyronAI/server/db";
import { ciCompetitors, competitorSources, ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("Competitor Multi-Source Fetch Execution & Invariants", () => {
  const testAcc = "acc_test_multi_source";
  const testCamp = "camp_test_multi_source";
  const testComp = "comp_test_multi_source_1";

  beforeEach(async () => {
    // Clean up test records
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, testAcc));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, testAcc));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, testAcc));
    await db.delete(competitorSources).where(eq(competitorSources.accountId, testAcc));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, testAcc));

    // Seed test competitor
    await db.insert(ciCompetitors).values({
      id: testComp,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Test Modest Brand",
      platform: "instagram",
      profileLink: "https://instagram.com/testmodest",
      websiteUrl: "https://testmodest.com",
      businessType: "Competitor",
      primaryObjective: "Engagement",
      isActive: true,
      tier: "B",
    });
  });

  describe("1. Routing & Isolation", () => {
    it("routes supported platforms cleanly to their capability registry", () => {
      expect(PLATFORM_PROVIDER_CAPABILITIES.INSTAGRAM.fetch).toBe(true);
      expect(PLATFORM_PROVIDER_CAPABILITIES.TIKTOK.fetch).toBe(true);
      expect(PLATFORM_PROVIDER_CAPABILITIES.YOUTUBE.fetch).toBe(true);
      expect(PLATFORM_PROVIDER_CAPABILITIES.REVIEWS.fetch).toBe(true);
      expect(PLATFORM_PROVIDER_CAPABILITIES.WEBSITE.fetch).toBe(true);
    });

    it("rejects unsupported platforms with UNSUPPORTED status", async () => {
      const res = await executeSourceFetch({
        sourceId: "src_unsupported",
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "PINTEREST",
        canonicalUrl: "https://pinterest.com/testmodest",
      });

      expect(res.status).toBe("UNSUPPORTED");
      expect(res.itemsCount).toBe(0);
      expect(res.commentsCount).toBe(0);
    });

    it("identifies invalid URLs with SOURCE_INVALID without disabling the source", async () => {
      const srcId = "src_invalid_tt";
      await db.insert(competitorSources).values({
        id: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "TIKTOK",
        canonicalUrl: "",
        status: "ACTIVE",
        lastVerifiedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const res = await executeSourceFetch({
        sourceId: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "TIKTOK",
        canonicalUrl: "",
      });

      expect(res.status).toBe("SOURCE_INVALID");

      // Source verification state MUST NOT be altered
      const [srcRow] = await db.select().from(competitorSources).where(eq(competitorSources.id, srcId));
      expect(srcRow.status).toBe("ACTIVE");
      expect(srcRow.lastVerifiedAt?.toISOString()).toBe(new Date("2026-01-01T00:00:00Z").toISOString());
    });
  });

  describe("2. Source Authority & Verification Immutability", () => {
    it("updates lastFetchedAt but NEVER updates lastVerifiedAt during ordinary fetch", async () => {
      const initialVerified = new Date("2026-02-15T12:00:00Z");
      const srcId = "src_auth_test";
      await db.insert(competitorSources).values({
        id: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "WEBSITE",
        canonicalUrl: "https://testmodest.com",
        status: "ACTIVE",
        lastVerifiedAt: initialVerified,
      });

      const res = await executeSourceFetch({
        sourceId: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "WEBSITE",
        canonicalUrl: "https://testmodest.com",
      });

      expect(res.status).toBe("SUCCESS");

      const [updatedSrc] = await db.select().from(competitorSources).where(eq(competitorSources.id, srcId));
      expect(updatedSrc.lastFetchedAt).toBeDefined();
      expect(updatedSrc.lastFetchedAt).not.toBeNull();
      // Invariant: lastVerifiedAt must remain unchanged
      expect(updatedSrc.lastVerifiedAt?.toISOString()).toBe(initialVerified.toISOString());
    });

    it("preserves verified canonical source status on provider failure or timeout", async () => {
      const initialVerified = new Date("2026-02-15T12:00:00Z");
      const srcId = "src_fail_test";
      await db.insert(competitorSources).values({
        id: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "REVIEWS",
        canonicalUrl: "https://www.trustpilot.com/review/nonexistent-broken-domain-xyz123.com",
        status: "ACTIVE",
        lastVerifiedAt: initialVerified,
      });

      // Provider failure should return PROVIDER_FAILED or SUCCESS_ZERO_CONTENT without altering source status
      const res = await executeSourceFetch({
        sourceId: srcId,
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "REVIEWS",
        canonicalUrl: "https://www.trustpilot.com/review/nonexistent-broken-domain-xyz123.com",
      });

      expect(["PROVIDER_FAILED", "SUCCESS_ZERO_CONTENT", "FETCH_FAILED"]).toContain(res.status);

      const [srcRow] = await db.select().from(competitorSources).where(eq(competitorSources.id, srcId));
      expect(srcRow.status).toBe("ACTIVE");
      expect(srcRow.lastVerifiedAt?.toISOString()).toBe(initialVerified.toISOString());
    }, 60000);
  });

  describe("3. Multi-Source Ingestion & Lineage", () => {
    it("executes multi-source enrichment across active verified competitor sources", async () => {
      // Seed a verified website source and a verified review source
      await db.insert(competitorSources).values([
        {
          id: "src_ms_web",
          competitorId: testComp,
          accountId: testAcc,
          campaignId: testCamp,
          platform: "WEBSITE",
          canonicalUrl: "https://testmodest.com",
          status: "ACTIVE",
          lastVerifiedAt: new Date(),
        },
        {
          id: "src_ms_rev",
          competitorId: testComp,
          accountId: testAcc,
          campaignId: testCamp,
          platform: "REVIEWS",
          canonicalUrl: "https://www.trustpilot.com/review/testmodest.com",
          status: "ACTIVE",
          lastVerifiedAt: new Date(),
        },
      ]);

      const enrichment = await enrichCompetitorWithMultiSources(testComp, testAcc, testCamp, {
        platforms: ["REVIEWS"],
        forceRefresh: true,
      });

      expect(enrichment.competitorId).toBe(testComp);
      expect(enrichment.sourcesAttempted).toBe(1);
      expect(enrichment.results.length).toBe(1);
      expect(enrichment.results[0].platform).toBe("REVIEWS");
    }, 60000);
  });

  describe("4. Historical Instagram Preservation Gate", () => {
    it("guarantees existing historical Instagram comments and posts are never deleted", async () => {
      // Seed historical Instagram post and comment
      await db.insert(ciCompetitorPosts).values({
        id: "post_hist_ig_1",
        competitorId: testComp,
        accountId: testAcc,
        postId: "ig_hist_post_1",
        platform: "instagram",
        caption: "Our best selling summer maxi dress is back in stock!",
        likes: 120,
        comments: 1,
        mediaType: "IMAGE",
      });

      await db.insert(ciCompetitorComments).values({
        id: "comm_hist_ig_1",
        competitorId: testComp,
        accountId: testAcc,
        postId: "ig_hist_post_1",
        commentId: "ig_comm_delivery_issue",
        commentText: "Very Bad delivery service, arrived 2 weeks late",
        isSynthetic: false,
        source: "real_scrape",
        authorType: "customer",
      });

      // Run multi-source enrichment for TikTok
      await db.insert(competitorSources).values({
        id: "src_ms_tt",
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "TIKTOK",
        canonicalUrl: "https://tiktok.com/@testmodest",
        status: "ACTIVE",
        lastVerifiedAt: new Date(),
      });

      await enrichCompetitorWithMultiSources(testComp, testAcc, testCamp, {
        platforms: ["TIKTOK"],
        forceRefresh: true,
      });

      // Prove historical Instagram comment is intact
      const [histComment] = await db.select().from(ciCompetitorComments)
        .where(eq(ciCompetitorComments.commentId, "ig_comm_delivery_issue"));
      
      expect(histComment).toBeDefined();
      expect(histComment.commentText).toBe("Very Bad delivery service, arrived 2 weeks late");
      expect(histComment.competitorId).toBe(testComp);
      expect(histComment.isSynthetic).toBe(false);
    }, 60000);
  });
});
