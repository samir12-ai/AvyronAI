import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import { 
  ciCompetitors, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  marketVoiceEvidence, 
  competitorSources 
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { 
  classifyEvidenceAuthorship, 
  computeCustomerEvidenceId, 
  loadCanonicalCustomerVoice, 
  loadCanonicalCompetitorContent, 
  deduplicateCustomerVoice,
  type CustomerEvidenceUnit 
} from "../competitive-intelligence/evidence-routing";

describe("Evidence Routing Contract & Normalization", () => {
  const testAcc = "acc_test_routing_123";
  const testCamp = "camp_test_routing_123";
  const testComp = "comp_test_routing_brand";

  beforeEach(async () => {
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, testAcc));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, testAcc));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, testAcc));
    await db.delete(marketVoiceEvidence).where(eq(marketVoiceEvidence.accountId, testAcc));
    await db.delete(competitorSources).where(eq(competitorSources.accountId, testAcc));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, testAcc));

    await db.insert(ciCompetitors).values({
      id: testComp,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Test Modest Brand",
      platform: "instagram",
      profileLink: "https://instagram.com/testmodestbrand",
      businessType: "Competitor",
      primaryObjective: "Engagement",
      isActive: true,
      tier: "A",
    });
  });

  afterEach(async () => {
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, testAcc));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, testAcc));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, testAcc));
    await db.delete(marketVoiceEvidence).where(eq(marketVoiceEvidence.accountId, testAcc));
    await db.delete(competitorSources).where(eq(competitorSources.accountId, testAcc));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, testAcc));
  });

  describe("1. Authorship & Conceptual Routing Classification", () => {
    it("routes customer-authored comments and reviews to Customer Voice", () => {
      const igComment = classifyEvidenceAuthorship({ evidenceType: "comment", platform: "instagram" });
      expect(igComment.destination).toBe("CUSTOMER_VOICE");
      expect(igComment.authorClass).toBe("CUSTOMER");

      const ttComment = classifyEvidenceAuthorship({ evidenceType: "comment", platform: "tiktok" });
      expect(ttComment.destination).toBe("CUSTOMER_VOICE");

      const ytComment = classifyEvidenceAuthorship({ evidenceType: "comment", platform: "youtube" });
      expect(ytComment.destination).toBe("CUSTOMER_VOICE");

      const review = classifyEvidenceAuthorship({ evidenceType: "review", platform: "trustpilot" });
      expect(review.destination).toBe("CUSTOMER_VOICE");

      const mvQuote = classifyEvidenceAuthorship({ evidenceType: "quote", platform: "reddit" });
      expect(mvQuote.destination).toBe("CUSTOMER_VOICE");
      expect(mvQuote.authorClass).toBe("COMMUNITY");
    });

    it("routes competitor-authored posts, videos, blogs, and features to Competitor Intelligence", () => {
      const igPost = classifyEvidenceAuthorship({ evidenceType: "post", platform: "instagram" });
      expect(igPost.destination).toBe("COMPETITOR_INTELLIGENCE");

      const ttVideo = classifyEvidenceAuthorship({ evidenceType: "video", platform: "tiktok" });
      expect(ttVideo.destination).toBe("COMPETITOR_INTELLIGENCE");

      const ytVideo = classifyEvidenceAuthorship({ evidenceType: "video", platform: "youtube" });
      expect(ytVideo.destination).toBe("COMPETITOR_INTELLIGENCE");

      const blog = classifyEvidenceAuthorship({ evidenceType: "article", platform: "web" });
      expect(blog.destination).toBe("COMPETITOR_INTELLIGENCE");
    });

    it("strictly excludes brand and owner replies from Customer Voice", () => {
      const brandReply = classifyEvidenceAuthorship({ 
        evidenceType: "comment", 
        platform: "instagram", 
        authorType: "brand" 
      });
      expect(brandReply.destination).toBe("COMPETITOR_INTELLIGENCE");

      const ownerReply = classifyEvidenceAuthorship({ 
        evidenceType: "comment", 
        platform: "tiktok", 
        isOwnerReply: true 
      });
      expect(ownerReply.destination).toBe("COMPETITOR_INTELLIGENCE");
    });
  });

  describe("2. Canonical Raw Table Normalization", () => {
    it("normalizes raw customer comments and reviews without pre-labeling strategic pains", async () => {
      // Seed a customer comment
      await db.insert(ciCompetitorComments).values({
        id: "comm_test_c1",
        competitorId: testComp,
        accountId: testAcc,
        postId: "post_test_p1",
        commentId: "c_id_101",
        commentText: "Does this dress run true to size? I am petite.",
        authorType: "customer",
        platform: "tiktok",
        isSynthetic: false,
        source: "tiktok_scrape",
      });

      // Seed a brand reply
      await db.insert(ciCompetitorComments).values({
        id: "comm_test_b1",
        competitorId: testComp,
        accountId: testAcc,
        postId: "post_test_p1",
        commentId: "c_id_102",
        commentText: "Yes! Check our size chart for detailed measurements.",
        authorType: "brand",
        platform: "tiktok",
        isSynthetic: false,
        source: "tiktok_scrape",
      });

      // Seed a customer review
      await db.insert(ciCompetitorReviews).values({
        id: "rev_test_r1",
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        platform: "trustpilot",
        reviewText: "Material is light and breathable for summer.",
        authorHash: "Sarah M.",
        rating: 5,
      });

      const customerUnits = await loadCanonicalCustomerVoice(testAcc, testCamp);

      // Only the customer comment and the review should be in Customer Voice (brand reply excluded)
      expect(customerUnits.length).toBe(2);

      const ttUnit = customerUnits.find(u => u.platform === "tiktok");
      expect(ttUnit).toBeDefined();
      expect(ttUnit?.text).toBe("Does this dress run true to size? I am petite.");
      expect(ttUnit?.origin).toBe("COMPETITOR_COMMENT");
      expect(ttUnit?.authorType).toBe("CUSTOMER");
      // Verify no premature strategic labels
      expect((ttUnit as any).painLabel).toBeUndefined();

      const revUnit = customerUnits.find(u => u.platform === "trustpilot");
      expect(revUnit).toBeDefined();
      expect(revUnit?.origin).toBe("COMPETITOR_REVIEW");
    });

    it("normalizes competitor-authored content into CompetitorContentEvidence", async () => {
      await db.insert(ciCompetitorPosts).values({
        id: "post_test_vid1",
        competitorId: testComp,
        accountId: testAcc,
        postId: "vid_101",
        platform: "tiktok",
        caption: "Summer Collection Launching Tomorrow #modestfashion",
        mediaType: "VIDEO",
        likes: 1500,
        views: 20000,
      });

      const compContent = await loadCanonicalCompetitorContent(testAcc, testCamp);
      expect(compContent.length).toBe(1);
      expect(compContent[0].contentType).toBe("video");
      expect(compContent[0].text).toContain("Summer Collection Launching Tomorrow");
      expect(compContent[0].engagement?.views).toBe(20000);
    });
  });

  describe("3. Deduplication Audit & Idempotency", () => {
    it("deduplicates identical quote text while preserving distinct customer records", () => {
      const units: CustomerEvidenceUnit[] = [
        {
          evidenceId: "cev_1",
          origin: "COMPETITOR_REVIEW",
          platform: "trustpilot",
          accountId: testAcc,
          campaignId: testCamp,
          text: "Very slow delivery, took 3 weeks",
          author: "User A",
          authorType: "CUSTOMER",
          acquiredAt: new Date().toISOString(),
          verificationProvenance: { isVerified: true },
          rawEvidenceReference: { table: "ci_competitor_reviews", id: "r1" },
        },
        {
          evidenceId: "cev_2",
          origin: "COMPETITOR_REVIEW",
          platform: "trustpilot",
          accountId: testAcc,
          campaignId: testCamp,
          text: "Very slow delivery, took 3 weeks", // exact duplicate from multiple scraper runs
          author: "User A",
          authorType: "CUSTOMER",
          acquiredAt: new Date().toISOString(),
          verificationProvenance: { isVerified: true },
          rawEvidenceReference: { table: "ci_competitor_reviews", id: "r2" },
        },
        {
          evidenceId: "cev_3",
          origin: "COMPETITOR_REVIEW",
          platform: "trustpilot",
          accountId: testAcc,
          campaignId: testCamp,
          text: "Beautiful colors but fabric is slightly thin", // distinct user feedback
          author: "User B",
          authorType: "CUSTOMER",
          acquiredAt: new Date().toISOString(),
          verificationProvenance: { isVerified: true },
          rawEvidenceReference: { table: "ci_competitor_reviews", id: "r3" },
        },
      ];

      const dedupeRes = deduplicateCustomerVoice(units);
      expect(dedupeRes.rawCount).toBe(3);
      expect(dedupeRes.uniqueUnits.length).toBe(2);
      expect(dedupeRes.exactDuplicatesRemoved).toBe(1);
      expect(dedupeRes.uniqueUnits.map(u => u.evidenceId)).toContain("cev_1");
      expect(dedupeRes.uniqueUnits.map(u => u.evidenceId)).toContain("cev_3");
    });
  });
});
