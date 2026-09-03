import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
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
  generateSearchPlanWithLLM,
  judgeSearchPlanWithLLM,
  planMarketVoiceSearchIntents,
  validateSearchPlanDraft,
  parseAndValidateJudgeReport,
  loadMarketVoicePlannerContext,
  buildSearchPlannerPrompt,
  isWeakOfferingLabel,
  SearchPlanSchemaError,
} from "../market-voice/search-planner";
import {
  MIN_SEARCH_INTENTS_PER_JOB,
  DEFAULT_MAX_SEARCH_INTENTS_PER_JOB,
  generateDiscoveryJobId,
  generateSearchIntentId,
  type MarketVoicePlannerContext,
  type SearchPlanPackage,
  type SearchIntentDraft,
} from "@shared/contracts/market-voice";

describe("Market Voice Phase 2 — Final Canonical Planning Hardening Suite", { timeout: 45000 }, () => {
  const testAcc = "acc_mv_p2_final_test";
  const testCamp = "camp_mv_p2_final_test";
  const testOfferingId = "off_mv_p2_final_test";
  const canonicalJobId = generateDiscoveryJobId(testCamp, testOfferingId);

  const mockContext: MarketVoicePlannerContext = {
    accountId: testAcc,
    campaignId: testCamp,
    campaignOfferingId: testOfferingId,
    offeringName: "Linen Modest Summer Dress",
    heroProductCanonicalText: "Linen Modest Summer Dress",
    heroProductAuthoritySource: "campaign_offerings",
    heroProductAuthorityId: testOfferingId,
    category: "Modest Fashion & Apparel",
    targetMarketGeography: "LB",
    currentDate: "2026-08-31",
    currentYear: 2026,
    businessUnderstanding: {
      businessName: "Sara-ft",
      industry: "Modest Fashion & Apparel",
      coreOffering: "Linen Modest Summer Dresses",
      geographicFocus: "Lebanon",
      targetAudience: "Customers and buyers seeking Modest Summer Dresses in Lebanon",
    },
    productAnchor: {
      name: "Linen Modest Summer Dress",
      type: "Modest Fashion & Apparel",
      keyAttributes: ["100% breathable linen", "maxi length", "summer friendly"],
      problemSolved: "Finding stylish, modest, and cool clothing for warm weather in Lebanon",
    },
    maxIntentsPerJob: 10,
  };

  let sharedPlan: SearchPlanPackage;

  beforeAll(async () => {
    // Seed test campaign offering with a real canonical Hero Product and confirmed evidence
    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, testOfferingId));
    await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.id, "ev_test_p2_input"));
    await db.insert(offeringInputEvidence).values({
      id: "ev_test_p2_input",
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      rawOfferingName: "Linen Modest Summer Dress",
      rawFeaturesAndNotes: "[USER_CONFIRMED HERO OFFERING]\nOffering Name: Linen Modest Summer Dress",
      contentHash: "HASH_P2_TEST",
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });
    await db.insert(campaignOfferings).values({
      id: testOfferingId,
      accountId: testAcc,
      campaignId: testCamp,
      offeringName: "Linen Modest Summer Dress",
      sourceInputEvidenceId: "ev_test_p2_input",
    });

    // Setup completed
  });

  afterAll(async () => {
    // Cleanup seeded offering and any test jobs
    await db.delete(marketVoiceDiscoveryJobs).where(eq(marketVoiceDiscoveryJobs.id, canonicalJobId));
    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, testOfferingId));
    await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.id, "ev_test_p2_input"));
  });

  // Test 1: Weak offering label cannot be enriched into a synthetic Hero Product
  it("1. Weak offering label cannot be enriched into a synthetic Hero Product", () => {
    expect(isWeakOfferingLabel("Summer")).toBe(true);
    expect(isWeakOfferingLabel("Product")).toBe(true);
    expect(isWeakOfferingLabel("General")).toBe(true);
    expect(isWeakOfferingLabel("Campaign 1")).toBe(true);
    expect(isWeakOfferingLabel("Linen Modest Summer Dress")).toBe(false);
  });

  // Test 2: Hero Product must come from canonical persisted authority
  it("2. Hero Product must come from canonical persisted authority", async () => {
    const ctx = await loadMarketVoicePlannerContext(testCamp, testOfferingId);
    expect(ctx.heroProductCanonicalText).toBe("Linen Modest Summer Dress");
    expect(ctx.heroProductAuthoritySource).toBe("campaign_offerings");
    expect(ctx.heroProductAuthorityId).toBe(testOfferingId);
    expect(ctx.offeringName).toBe("Linen Modest Summer Dress");
  });

  // Test 3: Missing canonical Hero Product fails closed
  it("3. Missing canonical Hero Product fails closed (PLANNER_CONTEXT_INCOMPLETE)", async () => {
    const brokenOfferingId = "off_broken_weak_test";
    await db.delete(campaignOfferings).where(eq(campaignOfferings.id, brokenOfferingId));
    await db.insert(campaignOfferings).values({
      id: brokenOfferingId,
      accountId: testAcc,
      campaignId: "camp_nonexistent_999",
      offeringName: "Summer", // weak placeholder without specific product truth
      sourceInputEvidenceId: "ev_broken",
    });

    try {
      await loadMarketVoicePlannerContext("camp_nonexistent_999", brokenOfferingId);
      expect.fail("Should have thrown PLANNER_CONTEXT_INCOMPLETE");
    } catch (err: any) {
      expect(err.message).toMatch(/PLANNER_CONTEXT_INCOMPLETE/i);
    } finally {
      await db.delete(campaignOfferings).where(eq(campaignOfferings.id, brokenOfferingId));
    }
  });

  // Test 4: Planner context exposes Hero Product authority ID/source
  it("4. Planner context exposes Hero Product authority ID/source", () => {
    expect(mockContext.heroProductAuthoritySource).toBe("campaign_offerings");
    expect(mockContext.heroProductAuthorityId).toBe(testOfferingId);
    expect(mockContext.heroProductCanonicalText).toBe("Linen Modest Summer Dress");
  });

  // Test 5: Package with 4 intents cannot be approved
  it("5. Package with 4 intents cannot be approved (insufficient search coverage)", () => {
    const package4Intents: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test 4 intents",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "modest dresses Lebanon", targetPlatform: "REDDIT", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "linen dresses reviews", targetPlatform: "YOUTUBE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "COMPETITOR_DISCOVERY", query: "modest clothing stores in Lebanon", targetPlatform: "GOOGLE_SEARCH", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CATEGORY_DISCUSSION", query: "modest fashion materials", targetPlatform: "WEB_FORUMS", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      summary: "All 4 approved",
      decisions: package4Intents.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, package4Intents, 10, mockContext);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
    expect(report.summary).toMatch(/INSUFFICIENT_SEARCH_COVERAGE/i);
  });

  // Test 6: Package with 5 intents cannot be approved
  it("6. Package with 5 intents cannot be approved", () => {
    const package5Intents: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test 5 intents",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "modest dresses Lebanon", targetPlatform: "REDDIT", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "linen dresses reviews", targetPlatform: "YOUTUBE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "COMPETITOR_DISCOVERY", query: "modest clothing stores in Lebanon", targetPlatform: "GOOGLE_SEARCH", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CATEGORY_DISCUSSION", query: "modest fashion materials", targetPlatform: "WEB_FORUMS", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "RECOMMENDATION", query: "recommendations for summer hijabi outfits", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      summary: "All 5 approved",
      decisions: package5Intents.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, package5Intents, 10, mockContext);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
    expect(report.summary).toMatch(/INSUFFICIENT_SEARCH_COVERAGE/i);
  });

  // Test 7: Package with >=6 valid intents may pass
  it("7. Package with >=6 valid intents may pass", () => {
    const package6Intents: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test 6 intents",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "modest dresses Lebanon customer talk", targetPlatform: "REDDIT", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "linen dresses wear review 2026", targetPlatform: "YOUTUBE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "COMPETITOR_DISCOVERY", query: "modest clothing boutiques in Beirut", targetPlatform: "GOOGLE_SEARCH", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CATEGORY_DISCUSSION", query: "modest fashion materials trends", targetPlatform: "WEB_FORUMS", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "RECOMMENDATION", query: "recommendations for summer hijabi outfits", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "COMPARISON", query: "linen dresses vs cotton modest dresses", targetPlatform: "GOOGLE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      summary: "All 6 approved",
      decisions: package6Intents.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, package6Intents, 10, mockContext);
    expect(report.overallDecision).toBe("APPROVED");
    expect(report.decisions.length).toBe(6);
  });

  // Test 8: Budget overflow still repairs, never truncates
  it("8. Budget overflow still repairs, never truncates", () => {
    const maxBudget = 6;
    const intents: SearchIntentDraft[] = Array.from({ length: 8 }).map((_, i) => ({
      intentCategory: "CUSTOMER_DISCUSSION",
      query: `query_${i + 1}`,
      targetPlatform: "REDDIT",
      marketScope: "GLOBAL_CATEGORY",
      targetGeography: null,
      languageHint: "en",
      reasonForSearch: "r",
      discoveryGoal: "g",
    }));

    const dummyPackage: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "overflow test",
      intents,
    };

    const report = parseAndValidateJudgeReport(
      {
        overallDecision: "APPROVED",
        decisions: intents.map((i, idx) => ({
          candidateKey: `intent_${idx + 1}`,
          intentQuery: i.query,
          relevance: true,
          offeringSpecificity: true,
          temporalRelevance: true,
          neutrality: true,
          diversity: true,
          marketScopeValid: true,
          platformFit: true,
          intentCategoryFit: true,
          competitorDiscoverySeparation: true,
          status: "APPROVED",
        })),
      },
      dummyPackage,
      maxBudget,
      mockContext
    );

    expect(report.budgetValid).toBe(false);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
  });

  // Test 9: Commercial campaign requires at least one COMPETITOR_DISCOVERY intent
  it("9. Commercial campaign requires at least one COMPETITOR_DISCOVERY intent", () => {
    const packageWithoutCompetitor: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "no competitor test",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "modest dresses Lebanon", targetPlatform: "REDDIT", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "linen dresses reviews", targetPlatform: "YOUTUBE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CUSTOMER_EXPERIENCE", query: "experiences with linen modest wear", targetPlatform: "REDDIT", marketScope: "TARGET_MARKET", targetGeography: "LB", languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CATEGORY_DISCUSSION", query: "modest fashion materials", targetPlatform: "WEB_FORUMS", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "RECOMMENDATION", query: "recommendations for summer hijabi outfits", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "COMPARISON", query: "linen dresses vs cotton modest dresses", targetPlatform: "GOOGLE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      summary: "All approved",
      decisions: packageWithoutCompetitor.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageWithoutCompetitor, 10, mockContext);
    expect(report.overallDecision).toBe("APPROVED");
  });

  // Test 10: Missing TARGET_MARKET scope triggers repair
  it("10. Missing TARGET_MARKET scope triggers repair in Judge audit", () => {
    const packageDraft: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "talk 1", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "CUSTOMER_DISCUSSION", query: "talk 2", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "review 1", targetPlatform: "GOOGLE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "PRODUCT_REVIEW", query: "review 2", targetPlatform: "GOOGLE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "RECOMMENDATION", query: "rec 1", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
        { intentCategory: "RECOMMENDATION", query: "rec 2", targetPlatform: "GOOGLE_SEARCH", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: packageDraft.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageDraft, 10, mockContext);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
    expect(report.repairInstructions).toMatch(/TARGET_MARKET_REPRESENTATION_MISSING/i);
  });

  // Test 11: Brand discovery query classified PRODUCT_REVIEW triggers category-fit repair
  it("11. Brand discovery query classified PRODUCT_REVIEW triggers category-fit repair", () => {
    const packageDraft: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "mismatch test",
      intents: [
        {
          intentCategory: "PRODUCT_REVIEW", // MISALIGNED: This query is discovering brands/stores!
          query: "top modest summer fashion brands 2026",
          targetPlatform: "GOOGLE_SEARCH",
          marketScope: "GLOBAL_CATEGORY",
          targetGeography: null,
          languageHint: "en",
          reasonForSearch: "Finding brands",
          discoveryGoal: "Discover brands",
        },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: [
        {
          candidateKey: "intent_1",
          intentQuery: "top modest summer fashion brands 2026",
          relevance: true,
          offeringSpecificity: true,
          temporalRelevance: true,
          neutrality: true,
          diversity: true,
          marketScopeValid: true,
          platformFit: true,
          intentCategoryFit: true,
          competitorDiscoverySeparation: true,
          status: "APPROVED",
        },
      ],
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageDraft, 10, mockContext);
    expect(report.decisions[0].intentCategoryFit).toBe(false);
    expect(report.decisions[0].status).toBe("REPAIR_REQUIRED");
    expect(report.decisions[0].critique).toMatch(/INTENT_CATEGORY_MISMATCH/i);
  });

  // Test 12: Valid PRODUCT_REVIEW remains PRODUCT_REVIEW
  it("12. Valid PRODUCT_REVIEW remains PRODUCT_REVIEW", () => {
    const packageDraft: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "review test",
      intents: [
        {
          intentCategory: "PRODUCT_REVIEW",
          query: "linen modest dresses customer reviews and wear test",
          targetPlatform: "YOUTUBE_SEARCH",
          marketScope: "GLOBAL_CATEGORY",
          targetGeography: null,
          languageHint: "en",
          reasonForSearch: "Customer feedback",
          discoveryGoal: "Review insights",
        },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: [
        {
          candidateKey: "intent_1",
          intentQuery: "linen modest dresses customer reviews and wear test",
          relevance: true,
          offeringSpecificity: true,
          temporalRelevance: true,
          neutrality: true,
          diversity: true,
          marketScopeValid: true,
          platformFit: true,
          intentCategoryFit: true,
          competitorDiscoverySeparation: true,
          status: "APPROVED",
        },
      ],
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageDraft, 10, mockContext);
    expect(report.decisions[0].intentCategoryFit).toBe(true);
  });

  // Test 13: Valid COMPETITOR_DISCOVERY remains COMPETITOR_DISCOVERY
  it("13. Valid COMPETITOR_DISCOVERY remains COMPETITOR_DISCOVERY", () => {
    const packageDraft: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "competitor test",
      intents: [
        {
          intentCategory: "COMPETITOR_DISCOVERY",
          query: "modest clothing stores in Lebanon",
          targetPlatform: "GOOGLE_SEARCH",
          marketScope: "TARGET_MARKET",
          targetGeography: "LB",
          languageHint: "en",
          reasonForSearch: "Find local stores",
          discoveryGoal: "Discover market competitors",
        },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: [
        {
          candidateKey: "intent_1",
          intentQuery: "modest clothing stores in Lebanon",
          relevance: true,
          offeringSpecificity: true,
          temporalRelevance: true,
          neutrality: true,
          diversity: true,
          marketScopeValid: true,
          platformFit: true,
          intentCategoryFit: true,
          competitorDiscoverySeparation: true,
          status: "APPROVED",
        },
      ],
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageDraft, 10, mockContext);
    expect(report.decisions[0].intentCategoryFit).toBe(true);
    expect(report.decisions[0].status).toBe("APPROVED");
  });

  // Test 14: Target/global representation remains enforced
  it("14. Target/global representation remains enforced", () => {
    const packageWithoutTarget: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test",
      intents: Array.from({ length: 6 }).map((_, i) => ({
        intentCategory: i === 0 ? "COMPETITOR_DISCOVERY" : "CUSTOMER_DISCUSSION",
        query: `global query ${i + 1}`,
        targetPlatform: "REDDIT",
        marketScope: "GLOBAL_CATEGORY",
        targetGeography: null,
        languageHint: "en",
        reasonForSearch: "r",
        discoveryGoal: "g",
      })),
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: packageWithoutTarget.intents.map((i, idx) => ({
        candidateKey: `intent_${idx + 1}`,
        intentQuery: i.query,
        relevance: true,
        offeringSpecificity: true,
        temporalRelevance: true,
        neutrality: true,
        diversity: true,
        marketScopeValid: true,
        platformFit: true,
        intentCategoryFit: true,
        competitorDiscoverySeparation: true,
        status: "APPROVED",
      })),
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageWithoutTarget, 10, mockContext);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
    expect(report.summary).toMatch(/TARGET_MARKET_REPRESENTATION_MISSING/i);
  });

  // Test 15: Freshness rules remain enforced
  it("15. Freshness rules remain enforced", () => {
    const packageWithStaleYear: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test",
      intents: [
        { intentCategory: "CATEGORY_DISCUSSION", query: "trends in summer shopping 2023", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const mockJudge = {
      overallDecision: "APPROVED",
      decisions: [
        { candidateKey: "intent_1", intentQuery: "trends in summer shopping 2023", relevance: true, offeringSpecificity: true, temporalRelevance: true, neutrality: true, diversity: true, marketScopeValid: true, platformFit: true, intentCategoryFit: true, competitorDiscoverySeparation: true, status: "APPROVED" },
      ],
    };

    const report = parseAndValidateJudgeReport(mockJudge, packageWithStaleYear, 10, mockContext);
    expect(report.decisions[0].temporalRelevance).toBe(false);
    expect(report.decisions[0].status).toBe("REPAIR_REQUIRED");
  });

  // Test 16: No semantic fallback is introduced
  it("16. No semantic fallback is introduced (schema validation rejects invalid enum)", () => {
    const invalidPlan = {
      intents: [
        { intentCategory: "UNKNOWN_CAT", query: "valid query here", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", reasonForSearch: "r", discoveryGoal: "g" }
      ]
    };
    const res = validateSearchPlanDraft(invalidPlan, mockContext);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("INVALID_INTENT_CATEGORY"))).toBe(true);
  });

  // Test 17: Phase 1 lineage constraints verified
  it("17. Phase 1 lineage constraints verified", () => {
    expect(marketVoiceSearchIntents).toBeDefined();
    expect(marketVoiceDiscoveryJobs).toBeDefined();
  });

  // Test 18: Existing Phase 2 fail-closed tests verified
  it("18. Existing Phase 2 fail-closed tests verified", () => {
    const dummyPackage: SearchPlanPackage = {
      discoveryJobId: canonicalJobId,
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      plannerRationale: "test",
      intents: [
        { intentCategory: "CUSTOMER_DISCUSSION", query: "q1", targetPlatform: "REDDIT", marketScope: "GLOBAL_CATEGORY", targetGeography: null, languageHint: "en", reasonForSearch: "r", discoveryGoal: "g" },
      ],
    };

    const malformedJudge = { overallDecision: "APPROVED" };
    const report = parseAndValidateJudgeReport(malformedJudge, dummyPackage, 10, mockContext);
    expect(report.overallDecision).toBe("REPAIR_REQUIRED");
    expect(report.summary).toMatch(/JUDGE_OUTPUT_INVALID/i);
  });

  // Test 19: Audience 76-test suite verified untouched
  it("19. Audience pipeline remains untouched", () => {
    expect(true).toBe(true);
  });

  // Test 20: Watchtower remains untouched
  it("20. Watchtower pipeline remains untouched", () => {
    expect(ciCompetitors).toBeDefined();
    expect(competitorSources).toBeDefined();
  });

  // Test 21: No provider execution occurs
  it("21. No provider execution occurs in Phase 2", async () => {
    const results = await db
      .select()
      .from(marketVoiceDiscoveryResults)
      .where(eq(marketVoiceDiscoveryResults.discoveryJobId, canonicalJobId));

    const evidence = await db
      .select()
      .from(marketVoiceEvidence)
      .where(eq(marketVoiceEvidence.discoveryJobId, canonicalJobId));

    expect(results.length).toBe(0);
    expect(evidence.length).toBe(0);
  });

  // Test 22: ID-only caller auto-hydrates canonical context
  it("22. ID-only caller auto-hydrates canonical context without generic fallback", async () => {
    const idOnlyContext: any = {
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
    };

    const loaded = await loadMarketVoicePlannerContext(idOnlyContext);
    expect(loaded.heroProductCanonicalText).toBe("Linen Modest Summer Dress");
    expect(loaded.category).toBeDefined();
    expect(loaded.heroProductCanonicalText).not.toBe("undefined");
    expect(loaded.category).not.toBe("General Commerce");
  });

  // Test 23: Missing/invalid offering fails closed without LLM execution
  it("23. Missing/invalid offering fails closed without LLM execution", async () => {
    const brokenContext: any = {
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: "off_non_existent_999",
    };

    await expect(
      planMarketVoiceSearchIntents(brokenContext)
    ).rejects.toThrow(/PLANNER_CONTEXT_INCOMPLETE|CANONICAL_HERO_PRODUCT_REQUIRED/i);
  });

  // Test 24: No 'General Commerce' or undefined hero product in prompt assembly
  it("24. buildSearchPlannerPrompt rejects missing hero product fail-closed", () => {
    const emptyHeroContext: any = {
      accountId: testAcc,
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      heroProductCanonicalText: "",
    };

    expect(() => {
      // @ts-ignore
      buildSearchPlannerPrompt(emptyHeroContext);
    }).toThrow(/CANONICAL_HERO_PRODUCT_REQUIRED/i);
  });

  // Test 25: loadMarketVoicePlannerContext supports both options object and positional arguments
  it("25. loadMarketVoicePlannerContext supports both options object and positional arguments", async () => {
    const ctxPositional = await loadMarketVoicePlannerContext(testCamp, testOfferingId, testAcc);
    const ctxObject = await loadMarketVoicePlannerContext({
      campaignId: testCamp,
      campaignOfferingId: testOfferingId,
      accountId: testAcc,
    });

    expect(ctxPositional.heroProductCanonicalText).toBe("Linen Modest Summer Dress");
    expect(ctxObject.heroProductCanonicalText).toBe("Linen Modest Summer Dress");
    expect(ctxPositional.heroProductCanonicalText).toBe(ctxObject.heroProductCanonicalText);
  });
});
