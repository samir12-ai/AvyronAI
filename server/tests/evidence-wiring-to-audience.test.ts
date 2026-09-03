import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import { 
  ciCompetitors, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  marketVoiceEvidence, 
  marketVoiceDiscoveryResults,
  marketVoiceSearchIntents,
  marketVoiceDiscoveryJobs,
  competitorSources,
  growthCampaigns 
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { 
  loadCanonicalCustomerVoice, 
  loadCanonicalCompetitorContent, 
  classifyEvidenceAuthorship,
  deduplicateCustomerVoice 
} from "../competitive-intelligence/evidence-routing";
import { 
  deduplicateFromCanonicalCustomerVoice, 
  buildCanonicalCompetitorMap 
} from "../audience-engine/semantic-reasoner";
import { 
  buildAudiencePainRegistry, 
  extractCanonicalSegmentPains 
} from "../shared/audience-pain-registry";
import { scrapeTikTokCommentsForCompetitor } from "../competitive-intelligence/comments-acquisition";

describe("Audience Engine Evidence Wiring & Boundary Gates", () => {
  const testAcc = "acc_test_wiring_101";
  const testCamp = "camp_test_wiring_101";
  const testOff = "off_test_wiring_101";
  const testComp = "comp_test_wiring_101";
  const testJob = "job_test_wiring_101";
  const testIntent = "intent_test_wiring_101";
  const testResult = "res_test_wiring_101";

  beforeEach(async () => {
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, testAcc));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, testAcc));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, testAcc));
    await db.delete(marketVoiceEvidence).where(eq(marketVoiceEvidence.accountId, testAcc));
    await db.delete(marketVoiceDiscoveryResults).where(eq(marketVoiceDiscoveryResults.accountId, testAcc));
    await db.delete(marketVoiceSearchIntents).where(eq(marketVoiceSearchIntents.accountId, testAcc));
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.accountId, testAcc));
    await db.delete(competitorSources).where(eq(competitorSources.accountId, testAcc));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, testAcc));

    await db.insert(ciCompetitors).values({
      id: testComp,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Test Modest Apparel",
      platform: "instagram",
      profileLink: "https://instagram.com/testmodestapparel",
      businessType: "Competitor",
      primaryObjective: "Engagement",
      isActive: true,
      tier: "A",
    });

    await db.insert(marketVoiceDiscoveryJobs).values({
      id: testJob,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOff,
      status: "COMPLETED",
    });

    await db.insert(marketVoiceSearchIntents).values({
      id: testIntent,
      discoveryJobId: testJob,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOff,
      query: "modest dresses review",
      intentCategory: "CUSTOMER_DISCUSSION",
      marketScope: "UNKNOWN",
      targetPlatform: "REDDIT",
    });

    await db.insert(marketVoiceDiscoveryResults).values({
      id: testResult,
      searchIntentId: testIntent,
      discoveryJobId: testJob,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOff,
      url: "https://reddit.com/r/modestfashion/1",
      canonicalUrl: "https://reddit.com/r/modestfashion/1",
      sourcePlatform: "reddit",
    });
  });

  afterEach(async () => {
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, testAcc));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, testAcc));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, testAcc));
    await db.delete(marketVoiceEvidence).where(eq(marketVoiceEvidence.accountId, testAcc));
    await db.delete(marketVoiceDiscoveryResults).where(eq(marketVoiceDiscoveryResults.accountId, testAcc));
    await db.delete(marketVoiceSearchIntents).where(eq(marketVoiceSearchIntents.accountId, testAcc));
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.accountId, testAcc));
    await db.delete(competitorSources).where(eq(competitorSources.accountId, testAcc));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.accountId, testAcc));
  });

  it("1-6. Canonical Customer Voice loader includes Instagram, TikTok, YouTube, Reviews, and Market Voice", async () => {
    // 1. Instagram comment
    await db.insert(ciCompetitorComments).values({
      id: "comm_ig_1",
      competitorId: testComp,
      accountId: testAcc,
      postId: "post_ig_1",
      commentId: "ig_c1",
      commentText: "Do you ship to Canada? Shipping rates are high.",
      authorType: "customer",
      isSynthetic: false,
      source: "scraped",
    });

    // 2. TikTok comment
    await db.insert(ciCompetitorComments).values({
      id: "comm_tt_1",
      competitorId: testComp,
      accountId: testAcc,
      postId: "post_tt_1",
      commentId: "tt_c1",
      commentText: "Is the lining 100% opaque for prayer?",
      authorType: "customer",
      isSynthetic: false,
      source: "tiktok_scrape",
    });

    // 3. YouTube comment
    await db.insert(ciCompetitorComments).values({
      id: "comm_yt_1",
      competitorId: testComp,
      accountId: testAcc,
      postId: "post_yt_1",
      commentId: "yt_c1",
      commentText: "Can you do a try on video showing sleeves length?",
      authorType: "customer",
      isSynthetic: false,
      source: "youtube_scrape",
    });

    // 4. Competitor Review
    await db.insert(ciCompetitorReviews).values({
      id: "rev_tp_1",
      competitorId: testComp,
      accountId: testAcc,
      campaignId: testCamp,
      reviewText: "Material is light and breathable, perfect for summer Eid.",
      platform: "trustpilot",
      rating: 5,
    });

    // 5. Market Voice quote
    await db.insert(marketVoiceEvidence).values({
      id: "mv_reddit_1",
      discoveryResultId: testResult,
      searchIntentId: testIntent,
      discoveryJobId: testJob,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOff,
      verbatimText: "It is so hard finding modest maxi dresses that aren't see-through.",
      platform: "reddit",
      externalId: "reddit_post_1",
    });

    const customerUnits = await loadCanonicalCustomerVoice(testAcc, testCamp);
    expect(customerUnits.length).toBe(5);

    const platforms = customerUnits.map(u => u.platform);
    expect(platforms).toContain("instagram");
    expect(platforms).toContain("tiktok");
    expect(platforms).toContain("youtube");
    expect(platforms).toContain("trustpilot");
    expect(platforms).toContain("reddit");

    const origins = customerUnits.map(u => u.origin);
    expect(origins).toContain("COMPETITOR_COMMENT");
    expect(origins).toContain("COMPETITOR_REVIEW");
    expect(origins).toContain("MARKET_VOICE");
  });

  it("7. Competitor-owned TikTok/YouTube videos do NOT reach Customer Voice", async () => {
    // Insert competitor posts/videos
    await db.insert(ciCompetitorPosts).values({
      id: "post_tt_v1",
      competitorId: testComp,
      accountId: testAcc,
      postId: "vid_101",
      platform: "tiktok",
      caption: "Our new summer drop is live now! Link in bio. #modestfashion",
      mediaType: "VIDEO",
    });
    await db.insert(ciCompetitorPosts).values({
      id: "post_yt_v1",
      competitorId: testComp,
      accountId: testAcc,
      postId: "yt_vid_101",
      platform: "youtube",
      caption: "Ramadan 2026 Collection Lookbook - Full Presentation",
      mediaType: "VIDEO",
    });

    const customerUnits = await loadCanonicalCustomerVoice(testAcc, testCamp);
    expect(customerUnits.length).toBe(0);

    const compContent = await loadCanonicalCompetitorContent(testAcc, testCamp);
    expect(compContent.length).toBe(2);
    expect(compContent.map(c => c.platform)).toContain("tiktok");
    expect(compContent.map(c => c.platform)).toContain("youtube");
  });

  it("8. Brand and owner replies are strictly excluded from customer evidence", async () => {
    await db.insert(ciCompetitorComments).values({
      id: "comm_brand_reply",
      competitorId: testComp,
      accountId: testAcc,
      postId: "post_ig_1",
      commentId: "rep_1",
      commentText: "Thanks for checking! Our dresses will restock next Friday.",
      authorType: "brand",
      isSynthetic: false,
      source: "scraped",
    });
    await db.insert(ciCompetitorComments).values({
      id: "comm_owner_reply",
      competitorId: testComp,
      accountId: testAcc,
      postId: "post_ig_1",
      commentId: "rep_2",
      commentText: "DM us your order number and we will resolve it.",
      authorType: "owner",
      isSynthetic: false,
      source: "scraped",
    });

    const customerUnits = await loadCanonicalCustomerVoice(testAcc, testCamp);
    expect(customerUnits.length).toBe(0);
  });

  it("9-10. Exact duplicate evidence is not double-counted and receives NO pre-assigned pain labels", async () => {
    const customerUnits = [
      {
        evidenceId: "cev_1",
        origin: "COMPETITOR_COMMENT" as const,
        platform: "tiktok",
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        text: "Are sleeves lined?",
        author: "user_a",
        authorType: "CUSTOMER" as const,
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_comments" as const, id: "c1" },
      },
      {
        evidenceId: "cev_2",
        origin: "COMPETITOR_COMMENT" as const,
        platform: "tiktok",
        competitorId: testComp,
        accountId: testAcc,
        campaignId: testCamp,
        text: "Are sleeves lined?", // Duplicate quote from multiple videos
        author: "user_a",
        authorType: "CUSTOMER" as const,
        acquiredAt: new Date().toISOString(),
        verificationProvenance: { isVerified: true },
        rawEvidenceReference: { table: "ci_competitor_comments" as const, id: "c2" },
      },
    ];

    const compMap = buildCanonicalCompetitorMap([{ id: testComp, name: "Test Modest Apparel" }]);
    const deduplicated = deduplicateFromCanonicalCustomerVoice(customerUnits, compMap);

    expect(deduplicated.length).toBe(1);
    expect(deduplicated[0].rawOccurrenceCount).toBe(2);
    // Verifies no pre-assigned pain/desire labels
    expect((deduplicated[0] as any).pain).toBeUndefined();
    expect((deduplicated[0] as any).painLabel).toBeUndefined();
  });

  it("11. Canonical Pain Registry derives ONLY from judge-approved audienceSegments[].pains", () => {
    const approvedSegments = [
      {
        id: "seg_modest_professionals",
        name: "Modest Working Professionals",
        description: "Women seeking breathable, non-see-through apparel for work",
        pains: [
          {
            canonical: "Dresses lack opacity requiring uncomfortable extra layers in summer",
            frequency: 14,
            evidence: ["It is so hard finding modest maxi dresses that aren't see-through."],
            evidenceCount: 1,
            confidenceScore: 0.92,
            sourceSignals: ["reddit"],
            inputSnapshotId: "snap_1",
          }
        ],
        desires: [],
        objections: [],
      }
    ];

    const canonicalPains = extractCanonicalSegmentPains(approvedSegments as any);
    expect(canonicalPains.length).toBe(1);
    expect(canonicalPains[0].canonical).toBe("Dresses lack opacity requiring uncomfortable extra layers in summer");

    const registry = buildAudiencePainRegistry(canonicalPains, {
      accountId: testAcc,
      audienceSnapshotId: "snap_test_101",
    }, approvedSegments as any);

    expect(registry.length).toBe(1);
    expect(registry[0].canonical).toBe("Dresses lack opacity requiring uncomfortable extra layers in summer");
    expect(registry[0].evidenceUids.length).toBe(1);
  });

  it("12. Market Intelligence consumes competitor-authored content without contaminating Customer Voice", async () => {
    await db.insert(ciCompetitorPosts).values({
      id: "post_brand_offer",
      competitorId: testComp,
      accountId: testAcc,
      postId: "off_101",
      platform: "instagram",
      caption: "End of season sale: 30% off all abayas with code SUMMER30",
      hasOffer: true,
      hasCTA: true,
    });

    const customerUnits = await loadCanonicalCustomerVoice(testAcc, testCamp);
    expect(customerUnits.length).toBe(0);

    const compContent = await loadCanonicalCompetitorContent(testAcc, testCamp);
    expect(compContent.length).toBe(1);
    expect(compContent[0].text).toContain("End of season sale");
  });

  it("13. TikTok persistence telemetry reports actual inserted rows vs conflict-skipped rows", async () => {
    // Pre-insert a comment
    await db.insert(ciCompetitorComments).values({
      id: `comm_tt_${testComp}_767990001`,
      competitorId: testComp,
      accountId: testAcc,
      postId: "vid_101",
      commentId: "767990001",
      commentText: "Love the green shade!",
      source: "tiktok_scrape",
      authorType: "customer",
      isSynthetic: false,
    });

    const trace = await scrapeTikTokCommentsForCompetitor({
      competitorId: testComp,
      competitorName: "Test Modest Apparel",
      sourceId: "src_test_1",
      canonicalUrl: "https://tiktok.com/@testmodestapparel",
      accountId: testAcc,
    });

    // Since no new video scraper run occurred or videos available = 0, commentsInserted must be 0
    expect(trace.commentsInserted).toBe(0);
    expect(trace.commentsAlreadyExisting).toBe(1);
    expect(trace.finalStoredRows).toBe(1);
  });
});
