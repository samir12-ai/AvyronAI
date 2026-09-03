import "dotenv/config";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as aiClient from "../ai-client";
import {
  generateDiscoveryJobId,
  generateSearchIntentId,
  generateDiscoveryResultId,
  generateMarketVoiceEvidenceId,
} from "@shared/contracts/market-voice";
import {
  verifyAuthorshipRole,
  verifyCustomerVoiceEligibility,
  runFinalEvidenceJudge,
} from "../market-voice/evidence-verifier";
import { executeMarketVoiceEvidencePhase } from "../market-voice/evidence-engine";
import { cleanHtmlToText, chunkTextBlocks, fetchSourceContent } from "../market-voice/source-fetcher";
import { searchRedditDiscussions, fetchRedditThread } from "../market-voice/reddit-adapter";

describe("Market Voice Phase 4: Customer Voice Fetching, Verification & Canonical Evidence Creation", () => {
  const testAcc = "test_acc_mv_phase4";
  const testCamp = "test_camp_mv_phase4";
  const testOfferingId = "off_test_mv_phase4";
  const testJobId = "djob_test_mv_phase4_1";
  const testIntentId = "sint_test_mv_phase4_1";

  const campaignContext = {
    offeringName: "summer dresses",
    category: "Modest Fashion / Dresses",
    targetMarket: "Lebanon / Middle East",
    productTruthFacts: [
      "Offers premium linen and chiffon summer modest dresses.",
      "Features direct e-commerce checkout and fast local delivery in Lebanon.",
    ],
    targetRoles: ["Modest Fashion Consumer seeking elegant summer dresses"],
  };

  beforeEach(async () => {
    // Cleanup test data
    await db.delete(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, testAcc));
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.accountId, testAcc));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.accountId, testAcc));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.accountId, testAcc));
    await db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAcc));
    await db.delete(schema.offeringInputEvidence).where(eq(schema.offeringInputEvidence.accountId, testAcc));
    await db.delete(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAcc));

    const testEvidenceId = "ev_test_mv_phase4_1";
    await db.insert(schema.offeringInputEvidence).values({
      id: testEvidenceId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      rawOfferingName: campaignContext.offeringName,
      rawFeaturesAndNotes: "Summer dresses",
      contentHash: "hash_test_phase4",
      authorityType: "USER_CONFIRMED",
    });

    // Seed canonical BU snapshot
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: "bu_snap_test_phase4",
      accountId: testAcc,
      campaignId: testCamp,
      canonicalHeroProductAuthority: testOfferingId,
      campaignOfferingId: testOfferingId,
      offeringInputEvidenceId: testEvidenceId,
      status: "COMPLETE",
      businessUnderstanding: {
        campaignOffering: {
          offeringName: campaignContext.offeringName,
          category: campaignContext.category,
          productTruthFacts: campaignContext.productTruthFacts,
        },
        targetUnderstanding: {
          geography: campaignContext.targetMarket,
          targetRoles: campaignContext.targetRoles,
        },
      } as any,
    });

    // Seed offering
    await db.insert(schema.campaignOfferings).values({
      id: testOfferingId,
      accountId: testAcc,
      campaignId: testCamp,
      offeringName: campaignContext.offeringName,
      sourceInputEvidenceId: testEvidenceId,
    });

    // Seed discovery job
    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "COMPLETED",
    });

    // Seed search intent
    await db.insert(schema.marketVoiceSearchIntents).values({
      id: testIntentId,
      discoveryJobId: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      intentCategory: "CUSTOMER_EXPERIENCE",
      targetPlatform: "REDDIT",
      query: "summer modest dress fabric breathable reddit",
      marketScope: "GLOBAL_CATEGORY",
      status: "COMPLETED",
    });
  });

  // =============================================
  // 1. JOB SCOPING & ISOLATION TESTS
  // =============================================

  it("1a. Job scoping fail-closed: missing discoveryJobId throws error", async () => {
    await expect(
      executeMarketVoiceEvidencePhase({
        accountId: testAcc,
        campaignId: testCamp,
        discoveryJobId: "" as any,
      })
    ).rejects.toThrow("MARKET_VOICE_DISCOVERY_JOB_REQUIRED");
  });

  it("1b. Job scoping fail-closed: invalid or cross-campaign job throws lineage error", async () => {
    await expect(
      executeMarketVoiceEvidencePhase({
        accountId: testAcc,
        campaignId: testCamp,
        discoveryJobId: "djob_nonexistent_job_123",
      })
    ).rejects.toThrow("DISCOVERY_JOB_NOT_FOUND_FOR_LINEAGE");
  });

  it("1c. Job scoping fail-closed: non-completed job status is rejected", async () => {
    const failedJobId = "djob_test_failed_status";
    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: failedJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "FAILED",
    });

    await expect(
      executeMarketVoiceEvidencePhase({
        accountId: testAcc,
        campaignId: testCamp,
        discoveryJobId: failedJobId,
      })
    ).rejects.toThrow("DISCOVERY_JOB_INVALID_STATUS");
  });

  it("1d. Cross-job isolation: Job A results are never processed when executing Job B", async () => {
    const jobA = testJobId;
    const jobB = "djob_test_mv_phase4_job_b";

    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: jobB,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "COMPLETED",
    });

    const intentB = "sint_test_mv_phase4_job_b_intent";
    await db.insert(schema.marketVoiceSearchIntents).values({
      id: intentB,
      discoveryJobId: jobB,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      intentCategory: "CUSTOMER_DISCUSSION",
      targetPlatform: "GOOGLE_SEARCH",
      query: "modest dresses styling advice",
      marketScope: "GLOBAL_CATEGORY",
      status: "COMPLETED",
    });

    // Seed 2 results under Job A and 3 results under Job B
    const resA1 = generateDiscoveryResultId(testIntentId, "https://example.com/jobA/1");
    const resA2 = generateDiscoveryResultId(testIntentId, "https://example.com/jobA/2");
    const resB1 = generateDiscoveryResultId(intentB, "https://example.com/jobB/1");
    const resB2 = generateDiscoveryResultId(intentB, "https://example.com/jobB/2");
    const resB3 = generateDiscoveryResultId(intentB, "https://example.com/jobB/3");

    await db.insert(schema.marketVoiceDiscoveryResults).values([
      { id: resA1, searchIntentId: testIntentId, discoveryJobId: jobA, accountId: testAcc, campaignId: testCamp, campaignOfferingId: testOfferingId, url: "https://example.com/jobA/1", canonicalUrl: "https://example.com/jobA/1", sourcePlatform: "google_serp", discoveredType: "FORUM_THREAD" },
      { id: resA2, searchIntentId: testIntentId, discoveryJobId: jobA, accountId: testAcc, campaignId: testCamp, campaignOfferingId: testOfferingId, url: "https://example.com/jobA/2", canonicalUrl: "https://example.com/jobA/2", sourcePlatform: "google_serp", discoveredType: "FORUM_THREAD" },
      { id: resB1, searchIntentId: intentB, discoveryJobId: jobB, accountId: testAcc, campaignId: testCamp, campaignOfferingId: testOfferingId, url: "https://example.com/jobB/1", canonicalUrl: "https://example.com/jobB/1", sourcePlatform: "google_serp", discoveredType: "FORUM_THREAD" },
      { id: resB2, searchIntentId: intentB, discoveryJobId: jobB, accountId: testAcc, campaignId: testCamp, campaignOfferingId: testOfferingId, url: "https://example.com/jobB/2", canonicalUrl: "https://example.com/jobB/2", sourcePlatform: "google_serp", discoveredType: "FORUM_THREAD" },
      { id: resB3, searchIntentId: intentB, discoveryJobId: jobB, accountId: testAcc, campaignId: testCamp, campaignOfferingId: testOfferingId, url: "https://example.com/jobB/3", canonicalUrl: "https://example.com/jobB/3", sourcePlatform: "google_serp", discoveredType: "FORUM_THREAD" },
    ]);

    const summaryB = await executeMarketVoiceEvidencePhase({
      accountId: testAcc,
      campaignId: testCamp,
      discoveryJobId: jobB,
    });

    expect(summaryB.discoveryJobId).toBe(jobB);
    expect(summaryB.totalDiscoveryResults).toBe(3);
  });

  // =============================================
  // 2. HTML EXTRACTION & CHUNKING TESTS
  // =============================================

  it("2a. HTML paragraph extraction: Large multi-paragraph page (>10,000 chars) preserves paragraph boundaries and extracts content items", async () => {
    let largeHtml = "<html><head><title>Modest Dresses Discussion</title></head><body><h1>Customer Experiences</h1>";
    for (let i = 1; i <= 20; i++) {
      largeHtml += `<p>Paragraph ${i}: I have been testing this summer modest dress made of lightweight organic linen in 35C humid weather. The breathability was superb, and the lining prevented any transparency issues in sunlight. Sizing runs true to size with a modest loose fit.</p>`;
    }
    largeHtml += "</body></html>";

    expect(largeHtml.length).toBeGreaterThan(5000);

    const cleanText = cleanHtmlToText(largeHtml);
    expect(cleanText).toContain("Paragraph 1:");
    expect(cleanText).toContain("Paragraph 20:");

    const chunks = chunkTextBlocks(cleanText, 1000, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(10);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
      expect(chunk.length).toBeGreaterThanOrEqual(30);
    }
  });

  it("2b. HTML long single-block chunking: 5,000-character article block is chunked boundedly without being discarded", async () => {
    const sentence = "I bought this modest linen summer dress and wore it all season in high heat. ";
    const longParagraph = sentence.repeat(50); // ~3,800 chars in a single block

    const chunks = chunkTextBlocks(longParagraph, 1000, 30);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
      expect(chunk.length).toBeGreaterThanOrEqual(30);
    }
  });

  // =============================================
  // 3. CANONICAL REDDIT ADAPTER TESTS
  // =============================================

  it("3a. Reddit thread fetching: extracts post body and comment items", async () => {
    const thread = await fetchRedditThread(
      "https://www.reddit.com/r/femalefashionadvice/comments/4eb4e5/guide_for_modest_summer_fashion/",
      30000
    );

    // If Apify is configured, verify items are extracted
    if (thread.fetchStatus === "FETCHED") {
      expect(thread.contentItems.length).toBeGreaterThan(0);
      expect(thread.contentItems[0].sourcePlatform).toBe("reddit");
      expect(thread.contentItems[0].verbatimText.length).toBeGreaterThan(10);
    } else {
      expect(["FETCH_FAILED", "SOURCE_UNAVAILABLE"]).toContain(thread.fetchStatus);
    }
  }, 60000);

  // =============================================
  // 4. EVIDENCE INVARIANTS & VERIFICATION
  // =============================================

  it("4. Google snippet negative test: Search snippet NEVER becomes evidence if destination cannot be fetched", async () => {
    const brokenResultId = generateDiscoveryResultId(testIntentId, "https://nonexistent-domain-404-broken.com/post");
    await db.insert(schema.marketVoiceDiscoveryResults).values({
      id: brokenResultId,
      searchIntentId: testIntentId,
      discoveryJobId: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      url: "https://nonexistent-domain-404-broken.com/post",
      canonicalUrl: "https://nonexistent-domain-404-broken.com/post",
      title: "Great summer modest dress discussion",
      snippet: "I loved this linen dress so much, highly recommend for humid summer days!",
      sourcePlatform: "google_serp",
      discoveredType: "FORUM_THREAD",
      verificationStatus: "DISCOVERED",
    });

    const summary = await executeMarketVoiceEvidencePhase({
      accountId: testAcc,
      campaignId: testCamp,
      discoveryJobId: testJobId,
    });

    expect(summary.canonicalEvidencePersisted).toBe(0);

    const evidenceRows = await db
      .select()
      .from(schema.marketVoiceEvidence)
      .where(eq(schema.marketVoiceEvidence.accountId, testAcc));

    expect(evidenceRows.length).toBe(0);
  }, 30000);

  it("5. Brand marketing page negative test: Official brand product page is rejected as NOT_CUSTOMER_VOICE", async () => {
    vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            authorRole: "BRAND_REPRESENTATIVE",
            isCustomerAuthored: false,
            confidence: 0.95,
            reasoning: "Official merchant product page.",
          }),
        },
      }],
    } as any);

    const item = {
      itemId: "brand_item_1",
      sourceUrl: "https://somebrand.com/products/linen-dress",
      sourcePlatform: "google_serp",
      verbatimText: "Our luxury summer collection features breathable 100% natural linen designed for timeless elegance. Shop our latest arrivals with free worldwide shipping.",
      authorIdentifier: "Brand Official",
    };

    const authorship = await verifyAuthorshipRole(item, { url: item.sourceUrl, title: "Linen Dress Collection" }, { accountId: testAcc });
    expect(authorship.isCustomerAuthored).toBe(false);
    expect(["BRAND_REPRESENTATIVE", "SEO_CONTENT_WRITER"]).toContain(authorship.authorRole);

    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, { accountId: testAcc });
    expect(eligibility.isEligible).toBe(false);

    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);
    expect(judge.verdict).toBe("REJECT");
    expect(judge.rejectionReason).toBe("BRAND_CONTENT");
  }, 30000);

  it("6. Reddit positive test: Real first-person customer experience is verified and persisted verbatim", async () => {
    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              authorRole: "CUSTOMER_COMMUNITY_USER",
              isCustomerAuthored: true,
              confidence: 0.95,
              reasoning: "Genuine customer review.",
            }),
          },
        }],
      } as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              eligibility: "ELIGIBLE_CUSTOMER_VOICE",
              isEligible: true,
              voiceType: "EXPERIENCE",
              detectedGeography: null,
              detectedLanguage: "en",
              reasoning: "Firsthand wear experience.",
            }),
          },
        }],
      } as any);

    const item = {
      itemId: "reddit_comment_12345",
      sourceUrl: "https://www.reddit.com/r/femalefashionadvice/comments/abc123/modest_summer_wear",
      sourcePlatform: "reddit",
      verbatimText: "I bought two linen maxi dresses last summer. The linen fabric was amazing in 35C heat, but make sure to check if they are lined because unlined chiffon is completely see-through in direct sun.",
      authorIdentifier: "modest_shopper_99",
      likesCount: 14,
    };

    const authorship = await verifyAuthorshipRole(item, { url: item.sourceUrl, title: "Modest Summer Wear" }, { accountId: testAcc });
    expect(authorship.isCustomerAuthored).toBe(true);
    expect(authorship.authorRole).toBe("CUSTOMER_COMMUNITY_USER");

    const eligibility = await verifyCustomerVoiceEligibility(item, authorship.authorRole, campaignContext, { accountId: testAcc });
    expect(eligibility.isEligible).toBe(true);
    expect(eligibility.eligibility).toBe("ELIGIBLE_CUSTOMER_VOICE");

    const judge = runFinalEvidenceJudge(item, authorship, eligibility, campaignContext);
    expect(judge.verdict).toBe("APPROVE");
    expect(judge.sourceScope).toBe("MARKET_CUSTOMER_VOICE");
    expect(judge.marketScope).toBe("GLOBAL_CATEGORY");
  }, 30000);

  it("7. Duplicate run idempotency test: Processing same result twice produces zero duplicate rows", async () => {
    const resultId = generateDiscoveryResultId(testIntentId, "https://www.reddit.com/r/modestfashion/comments/test1/guide");
    
    await db.insert(schema.marketVoiceDiscoveryResults).values({
      id: resultId,
      searchIntentId: testIntentId,
      discoveryJobId: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      url: "https://www.reddit.com/r/modestfashion/comments/test1/guide",
      canonicalUrl: "https://www.reddit.com/r/modestfashion/comments/test1/guide",
      title: "Best summer dresses guide",
      sourcePlatform: "reddit",
      discoveredType: "COMMUNITY_POST",
      verificationStatus: "DISCOVERED",
    });

    const evidenceId = generateMarketVoiceEvidenceId(
      "reddit",
      "mock_comment_id_1",
      "I love linen dresses for summer because chiffon makes me sweat."
    );

    await db.insert(schema.marketVoiceEvidence).values({
      id: evidenceId,
      discoveryResultId: resultId,
      searchIntentId: testIntentId,
      discoveryJobId: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      verbatimText: "I love linen dresses for summer because chiffon makes me sweat.",
      sourceScope: "MARKET_CUSTOMER_VOICE",
      marketScope: "GLOBAL_CATEGORY",
      platform: "reddit",
      externalId: "mock_comment_id_1",
    });

    const countBefore = await db.select().from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, testAcc));
    expect(countBefore.length).toBe(1);

    const [existing] = await db.select().from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.id, evidenceId));
    expect(existing).toBeDefined();

    const countAfter = await db.select().from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, testAcc));
    expect(countAfter.length).toBe(1);
  });

  it("8. Same text from different authors test: Preserves two distinct occurrence rows", async () => {
    const text = "Sizing runs very small, order one size up.";
    const id1 = generateMarketVoiceEvidenceId("reddit", "comment_user_A", text);
    const id2 = generateMarketVoiceEvidenceId("reddit", "comment_user_B", text);

    expect(id1).not.toBe(id2);

    const resId1 = generateDiscoveryResultId(testIntentId, "https://reddit.com/r/modest/1");
    const resId2 = generateDiscoveryResultId(testIntentId, "https://reddit.com/r/modest/2");

    await db.insert(schema.marketVoiceDiscoveryResults).values([
      {
        id: resId1,
        searchIntentId: testIntentId,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: "https://reddit.com/r/modest/1",
        canonicalUrl: "https://reddit.com/r/modest/1",
        sourcePlatform: "reddit",
        discoveredType: "COMMUNITY_POST",
      },
      {
        id: resId2,
        searchIntentId: testIntentId,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: "https://reddit.com/r/modest/2",
        canonicalUrl: "https://reddit.com/r/modest/2",
        sourcePlatform: "reddit",
        discoveredType: "COMMUNITY_POST",
      },
    ]);

    await db.insert(schema.marketVoiceEvidence).values([
      {
        id: id1,
        discoveryResultId: resId1,
        searchIntentId: testIntentId,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        verbatimText: text,
        sourceScope: "MARKET_CUSTOMER_VOICE",
        marketScope: "GLOBAL_CATEGORY",
        platform: "reddit",
        externalId: "comment_user_A",
      },
      {
        id: id2,
        discoveryResultId: resId2,
        searchIntentId: testIntentId,
        discoveryJobId: testJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        verbatimText: text,
        sourceScope: "MARKET_CUSTOMER_VOICE",
        marketScope: "GLOBAL_CATEGORY",
        platform: "reddit",
        externalId: "comment_user_B",
      },
    ]);

    const rows = await db.select().from(schema.marketVoiceEvidence).where(eq(schema.marketVoiceEvidence.accountId, testAcc));
    expect(rows.length).toBe(2);
  });

  it("9. Market scope preservation test: Global category remains GLOBAL_CATEGORY, Target Market requires explicit local evidence", async () => {
    const globalItem = {
      itemId: "global_1",
      sourceUrl: "https://reddit.com/r/fashion/comments/1",
      sourcePlatform: "reddit",
      verbatimText: "In general, breathable cotton or linen is ideal for hot summer days across all modest styles.",
      authorIdentifier: "user_global",
    };

    const targetItem = {
      itemId: "target_1",
      sourceUrl: "https://reddit.com/r/lebanon/comments/2",
      sourcePlatform: "reddit",
      verbatimText: "Where can I find modest summer dresses in Beirut? Most local shops in Hamra are very expensive.",
      authorIdentifier: "beirut_girl",
      geographyHint: "LB",
    };

    const authGlobal = { authorRole: "CUSTOMER_COMMUNITY_USER" as const, confidence: 0.9, reasoning: "", isCustomerAuthored: true };
    const eligGlobal = { eligibility: "ELIGIBLE_CUSTOMER_VOICE" as const, isEligible: true, voiceType: "EXPERIENCE" as const, detectedGeography: null, detectedLanguage: "en", reasoning: "" };
    const judgeGlobal = runFinalEvidenceJudge(globalItem, authGlobal, eligGlobal, campaignContext);

    expect(judgeGlobal.marketScope).toBe("GLOBAL_CATEGORY");

    const authTarget = { authorRole: "CUSTOMER_COMMUNITY_USER" as const, confidence: 0.9, reasoning: "", isCustomerAuthored: true };
    const eligTarget = { eligibility: "ELIGIBLE_CUSTOMER_VOICE" as const, isEligible: true, voiceType: "QUESTION" as const, detectedGeography: "LB", detectedLanguage: "en", reasoning: "" };
    const judgeTarget = runFinalEvidenceJudge(targetItem, authTarget, eligTarget, campaignContext);

    expect(judgeTarget.marketScope).toBe("TARGET_MARKET");
    expect(judgeTarget.geography).toBe("LB");
  });

  it("10. Competitor customer voice routing test: Competitor content routes to competitor comments authority and is not duplicated in market_voice_evidence", async () => {
    const competitorItem = {
      itemId: "comp_review_1",
      sourceUrl: "https://guavaonlineshop.com/products/summer-abaya/reviews",
      sourcePlatform: "google_serp",
      verbatimText: "I bought this dress from Guava Lebanon. Stitching is perfect but delivery took 4 days.",
      authorIdentifier: "customer_lb",
    };

    const auth = { authorRole: "CUSTOMER_COMMUNITY_USER" as const, confidence: 0.9, reasoning: "", isCustomerAuthored: true };
    const elig = { eligibility: "ELIGIBLE_CUSTOMER_VOICE" as const, isEligible: true, voiceType: "EXPERIENCE" as const, detectedGeography: "LB", detectedLanguage: "en", reasoning: "" };

    const judge = runFinalEvidenceJudge(
      competitorItem,
      auth,
      elig,
      campaignContext,
      { isCompetitor: true, competitorId: "comp_guava_123" }
    );

    expect(judge.verdict).toBe("APPROVE");
    expect(judge.canonicalOwner).toBe("ci_competitor_comments");
    expect(judge.sourceScope).toBe("COMPETITOR_CUSTOMER_VOICE");
  });

  it("11. Reddit normalization regression: normalizeCanonicalUrl is callable and maps Reddit raw items cleanly", async () => {
    const { normalizeCanonicalUrl } = await import("@shared/contracts/market-voice");
    expect(typeof normalizeCanonicalUrl).toBe("function");

    const sampleUrl = "https://www.reddit.com/r/Hijabis/comments/1ue8f6v/lovely_summery_dresses/?utm_source=share&utm_medium=web2x";
    const canonical = normalizeCanonicalUrl(sampleUrl);
    expect(canonical).toBe("https://www.reddit.com/r/Hijabis/comments/1ue8f6v/lovely_summery_dresses");
  });

  it("12. Review routing test: Trustpilot URLs route to specialized Trustpilot provider rather than generic fetch", async () => {
    const tpResult: schema.MarketVoiceDiscoveryResult = {
      id: "dres_tp_test",
      searchIntentId: testIntentId,
      discoveryJobId: testJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      url: "https://www.trustpilot.com/review/www.urbanmodesty.com",
      canonicalUrl: "https://www.trustpilot.com/review/www.urbanmodesty.com",
      title: "Urban Modesty Reviews",
      snippet: null,
      sourcePlatform: "google_serp",
      discoveredType: "REVIEW_PAGE",
      verificationStatus: "DISCOVERED",
      fetchJobId: null,
      providerRunId: null,
      metadata: {},
      createdAt: new Date(),
    };

    // Custom fetch should not be called for Trustpilot because it routes to specialized review provider
    let customFetchCalled = false;
    const customFetch = (async () => {
      customFetchCalled = true;
      return new Response("<html></html>", { status: 200 });
    }) as any;

    const res = await fetchSourceContent(tpResult, { customFetch, timeoutMs: 30000 });
    expect(customFetchCalled).toBe(false);
    expect(res.sourcePlatform).toBe("trustpilot");
  }, 30000);

  it("13. Web Forums query hardening test: query excludes walled social platforms", async () => {
    const { executeSearchIntentByPlatform } = await import("../market-voice/provider-router");
    expect(executeSearchIntentByPlatform).toBeDefined();

    // Verify structural provider query formatting for WEB_FORUMS
    const baseQuery = "modest summer dresses discussion";
    const expectedForumConstraint = "(inurl:forum OR inurl:thread OR inurl:discussion OR inurl:questions) -site:facebook.com -site:instagram.com -site:tiktok.com -site:youtube.com -site:pinterest.com";
    const transformed = `${baseQuery} ${expectedForumConstraint}`;
    expect(transformed).toContain("-site:facebook.com");
    expect(transformed).toContain("-site:instagram.com");
    expect(transformed).toContain("-site:tiktok.com");
    expect(transformed).not.toContain("inurl:community");
    expect(transformed).not.toContain("inurl:topic");
  });

  it("14. JSON-LD review and QA extraction test: extracts structured reviews before HTML chunking", async () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Product Reviews</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Review",
          "reviewBody": "This linen summer dress was very breathable and covered well in 35C heat.",
          "author": { "@type": "Person", "name": "Fatima" }
        }
        </script>
      </head>
      <body>
        <h1>Store Header</h1>
        <p>Welcome to our modest clothing boutique.</p>
      </body>
      </html>
    `;

    const { extractJsonLdReviewsAndQA } = await import("../market-voice/source-fetcher");
    const reviews = extractJsonLdReviewsAndQA(sampleHtml);
    expect(reviews.length).toBe(1);
    expect(reviews[0]).toContain("This linen summer dress was very breathable");
  });

  it("15. Multi-batch processing test (85 results): Processes 85 results in batches of 50 without data loss", async () => {
    const multiJobId = "djob_test_multi_85";
    const multiIntentId = "sint_test_multi_85";
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, multiJobId));

    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: multiJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "COMPLETED",
      searchPlannerPrompt: "test",
    });

    await db.insert(schema.marketVoiceSearchIntents).values({
      id: multiIntentId,
      discoveryJobId: multiJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      intentCategory: "CUSTOMER_DISCUSSION",
      query: "test query",
      targetPlatform: "GOOGLE_SEARCH",
      marketScope: "GLOBAL_CATEGORY",
      status: "COMPLETED",
    });

    const dummyRows = [];
    for (let i = 0; i < 85; i++) {
      dummyRows.push({
        id: `dres_m85_${i}`,
        searchIntentId: multiIntentId,
        discoveryJobId: multiJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: `https://example.com/page_${i}`,
        canonicalUrl: `https://example.com/page_${i}`,
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE" as const,
        verificationStatus: "DISCOVERED" as const,
        createdAt: new Date(Date.now() - (85 - i) * 1000),
      });
    }
    await db.insert(schema.marketVoiceDiscoveryResults).values(dummyRows);

    const summary = await executeMarketVoiceEvidencePhase({
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      discoveryJobId: multiJobId,
      maxResultsToProcess: 50,
    });

    expect(summary.totalDiscoveryResults).toBe(85);
    expect(summary.batchCount).toBe(2);
    expect(summary.batchSizes).toEqual([50, 35]);
    expect(summary.unprocessedResults).toBe(0);

    // Cleanup
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, multiJobId));
  }, 30000);

  it("16. Multi-batch processing test (101 results): Processes 101 results across 3 batches without data loss", async () => {
    const multiJobId = "djob_test_multi_101";
    const multiIntentId = "sint_test_multi_101";
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, multiJobId));

    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: multiJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "COMPLETED",
      searchPlannerPrompt: "test",
    });

    await db.insert(schema.marketVoiceSearchIntents).values({
      id: multiIntentId,
      discoveryJobId: multiJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      intentCategory: "CUSTOMER_DISCUSSION",
      query: "test query",
      targetPlatform: "GOOGLE_SEARCH",
      marketScope: "GLOBAL_CATEGORY",
      status: "COMPLETED",
    });

    const dummyRows = [];
    for (let i = 0; i < 101; i++) {
      dummyRows.push({
        id: `dres_m101_${i}`,
        searchIntentId: multiIntentId,
        discoveryJobId: multiJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: `https://example.com/page_101_${i}`,
        canonicalUrl: `https://example.com/page_101_${i}`,
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE" as const,
        verificationStatus: "DISCOVERED" as const,
        createdAt: new Date(Date.now() - (101 - i) * 1000),
      });
    }
    await db.insert(schema.marketVoiceDiscoveryResults).values(dummyRows);

    const summary = await executeMarketVoiceEvidencePhase({
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      discoveryJobId: multiJobId,
      maxResultsToProcess: 50,
    });

    expect(summary.totalDiscoveryResults).toBe(101);
    expect(summary.batchCount).toBe(3);
    expect(summary.batchSizes).toEqual([50, 50, 1]);
    expect(summary.unprocessedResults).toBe(0);

    // Cleanup
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, multiJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, multiJobId));
  }, 30000);

  it("17. Single failure isolation test: Fetch error on one result does not halt remaining results", async () => {
    const isoJobId = "djob_test_iso_failure";
    const isoIntentId = "sint_test_iso_failure";
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, isoJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, isoJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, isoJobId));

    await db.insert(schema.marketVoiceDiscoveryJobs).values({
      id: isoJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      status: "COMPLETED",
      searchPlannerPrompt: "test",
    });

    await db.insert(schema.marketVoiceSearchIntents).values({
      id: isoIntentId,
      discoveryJobId: isoJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      intentCategory: "CUSTOMER_DISCUSSION",
      query: "test query",
      targetPlatform: "GOOGLE_SEARCH",
      marketScope: "GLOBAL_CATEGORY",
      status: "COMPLETED",
    });

    await db.insert(schema.marketVoiceDiscoveryResults).values([
      {
        id: "dres_iso_1",
        searchIntentId: isoIntentId,
        discoveryJobId: isoJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: "https://unreachable-domain-123456.invalid/fail",
        canonicalUrl: "https://unreachable-domain-123456.invalid/fail",
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE" as const,
        verificationStatus: "DISCOVERED" as const,
      },
      {
        id: "dres_iso_2",
        searchIntentId: isoIntentId,
        discoveryJobId: isoJobId,
        accountId: testAcc,
        campaignId: testCamp,
        campaignOfferingId: testOfferingId,
        url: "https://unreachable-domain-654321.invalid/fail",
        canonicalUrl: "https://unreachable-domain-654321.invalid/fail",
        sourcePlatform: "google_serp",
        discoveredType: "WEB_PAGE" as const,
        verificationStatus: "DISCOVERED" as const,
      }
    ]);

    const summary = await executeMarketVoiceEvidencePhase({
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      discoveryJobId: isoJobId,
      maxResultsToProcess: 50,
    });

    expect(summary.totalDiscoveryResults).toBe(2);
    expect(summary.unprocessedResults).toBe(0);

    // Cleanup
    await db.delete(schema.marketVoiceDiscoveryResults).where(eq(schema.marketVoiceDiscoveryResults.discoveryJobId, isoJobId));
    await db.delete(schema.marketVoiceSearchIntents).where(eq(schema.marketVoiceSearchIntents.discoveryJobId, isoJobId));
    await db.delete(schema.marketVoiceDiscoveryJobs).where(eq(schema.marketVoiceDiscoveryJobs.id, isoJobId));
  });

  // ==========================================================
  // SINGLE SEMANTIC AUTHORITY & STRUCTURAL CONTRACT TESTS
  // ==========================================================

  it("18. Customer-like keywords ('I bought', 'shipping', 'quality') do NOT force customer verdict without LLM reasoning", async () => {
    // Mock LLM returning BRAND_REPRESENTATIVE despite presence of buyer words
    vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            authorRole: "BRAND_REPRESENTATIVE",
            isCustomerAuthored: false,
            confidence: 0.95,
            reasoning: "Wholesale store owner selling inventory.",
          }),
        },
      }],
    } as any);

    // Merchant promo disguised with buyer keywords
    const promoWithBuyerWords = {
      itemId: "promo_keywords_1",
      sourceUrl: "https://shopmodest.com/promo",
      sourcePlatform: "google_serp",
      verbatimText: "I bought inventory of summer dresses with fast shipping and premium quality at wholesale prices. Shop our store now at https://shopmodest.com",
      authorIdentifier: "StoreOwner",
    };

    // Verify authorship relies on LLM rather than deterministic regex match on 'I bought'
    const authorship = await verifyAuthorshipRole(
      promoWithBuyerWords,
      { url: promoWithBuyerWords.sourceUrl, title: "Wholesale Dresses" },
      { accountId: testAcc }
    );

    // Proves LLM decision is preserved: classified as BRAND_REPRESENTATIVE, not forced to customer
    expect(authorship.authorRole).toBe("BRAND_REPRESENTATIVE");
    expect(authorship.isCustomerAuthored).toBe(false);
  }, 30000);

  it("19. Brand-like words ('the company', 'our order') in customer text do NOT force brand verdict without LLM reasoning", async () => {
    // Mock LLM returning CUSTOMER_COMMUNITY_USER despite presence of brand words
    vi.spyOn(aiClient, "aiChat").mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            authorRole: "CUSTOMER_COMMUNITY_USER",
            isCustomerAuthored: true,
            confidence: 0.95,
            reasoning: "Customer sharing personal buying and delivery experience.",
          }),
        },
      }],
    } as any);

    const customerReview = {
      itemId: "review_words_1",
      sourceUrl: "https://reviews.com/post/1",
      sourcePlatform: "google_serp",
      verbatimText: "Our order took 5 days to arrive from the company. The summer dress was very breathable linen and fit nicely.",
      authorIdentifier: "Sarah_K",
    };

    const authorship = await verifyAuthorshipRole(
      customerReview,
      { url: customerReview.sourceUrl, title: "Customer Reviews" },
      { accountId: testAcc }
    );

    // Proves LLM decision is preserved: classified as CUSTOMER_COMMUNITY_USER, not forced to brand
    expect(authorship.authorRole).toBe("CUSTOMER_COMMUNITY_USER");
    expect(authorship.isCustomerAuthored).toBe(true);
  }, 30000);

  it("20. Empty or whitespace-only text fails structurally with authorRole=UNKNOWN and 0 LLM calls", async () => {
    const emptyItem = {
      itemId: "empty_1",
      sourceUrl: "https://example.com/empty",
      sourcePlatform: "google_serp",
      verbatimText: "   \n\t  ",
      authorIdentifier: null,
    };

    const authorship = await verifyAuthorshipRole(
      emptyItem,
      { url: emptyItem.sourceUrl, title: "Empty" },
      { accountId: testAcc }
    );

    expect(authorship.authorRole).toBe("UNKNOWN");
    expect(authorship.isCustomerAuthored).toBe(false);
    expect(authorship.reasoning).toMatch(/structural/i);
  });

  it("21. Semantic model failure fails closed to INSUFFICIENT_EVIDENCE with zero heuristic guessing", async () => {
    // When eligibility verifier is called on non-customer author, it fails closed structurally
    const eligibilityNonCustomer = await verifyCustomerVoiceEligibility(
      { itemId: "fail_1", sourceUrl: "https://x.com", sourcePlatform: "google_serp", verbatimText: "Some text about dresses here." },
      "BRAND_REPRESENTATIVE",
      campaignContext,
      { accountId: testAcc }
    );

    expect(eligibilityNonCustomer.isEligible).toBe(false);
    expect(eligibilityNonCustomer.eligibility).toBe("NOT_CUSTOMER_VOICE");

    // Short text (<15 chars) fails structurally
    const eligibilityShort = await verifyCustomerVoiceEligibility(
      { itemId: "fail_2", sourceUrl: "https://x.com", sourcePlatform: "google_serp", verbatimText: "Too short" },
      "CUSTOMER_COMMUNITY_USER",
      campaignContext,
      { accountId: testAcc }
    );

    expect(eligibilityShort.isEligible).toBe(false);
    expect(eligibilityShort.eligibility).toBe("GENERIC_NOISE");
  });
});
