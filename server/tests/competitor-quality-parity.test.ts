import "dotenv/config";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as aiClient from "../ai-client";
import {
  verifyCompetitorIdentity,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
  evaluateCompetitorQuality,
} from "../discovery/competitor-quality-pipeline";
import { revalidateCanonicalCompetitors } from "../competitive-intelligence/competitor-quality-revalidator";

describe("Competitor Quality Semantic Authority Parity Suite", { timeout: 180000 }, () => {
  const testAcc = "test_acc_parity_suite";
  const testCamp = "test_camp_parity_suite";
  const testOfferingId = "off_test_summer_dresses";

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
    await db.delete(schema.miRefreshSchedule).where(eq(schema.miRefreshSchedule.accountId, testAcc));
    await db.delete(schema.ciCompetitorComments).where(eq(schema.ciCompetitorComments.accountId, testAcc));
    await db.delete(schema.ciCompetitorPosts).where(eq(schema.ciCompetitorPosts.accountId, testAcc));
    await db.delete(schema.competitorWebData).where(eq(schema.competitorWebData.accountId, testAcc));
    await db.delete(schema.competitorSources).where(eq(schema.competitorSources.accountId, testAcc));
    await db.delete(schema.ciCompetitors).where(eq(schema.ciCompetitors.accountId, testAcc));
    await db.delete(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAcc));

    // Seed canonical BU snapshot
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: "bu_snap_test_parity",
      accountId: testAcc,
      campaignId: testCamp,
      canonicalHeroProductAuthority: testOfferingId,
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
  });

  it("proves same-input parity across Discovery and Revalidation paths for a direct brand", async () => {
    const identityMock = {
      isRealBusiness: true,
      entityRole: "BRAND_DIRECT_SELLER",
      canonicalName: "Beirut Modest Wear",
      canonicalDomain: "beirutmodestwear.com",
      confidence: 0.95,
      reasoning: "First-party direct brand seller.",
    };
    const relevanceMock = {
      isCompetitor: true,
      classification: "DIRECT_COMPETITOR",
      targetCategoryMatch: "EXACT_CATEGORY",
      geographicRelevance: "TARGET_MARKET",
      productTruthFit: "STRONG_FIT",
      competitorTier: "A",
      confidence: 0.95,
      reasoning: "Direct competitor in target market.",
    };

    // Mock for Discovery Path + Revalidation Path
    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any);

    const compId = "comp_test_direct_parity";
    const candidateEvidence = {
      candidateKey: compId,
      name: "Beirut Modest Wear",
      domain: "beirutmodestwear.com",
      websiteUrl: "https://beirutmodestwear.com",
      evidenceText: "Beirut Modest Wear – Luxury modest summer dresses, linen maxi dresses, and elegant sets made in Lebanon. Shop online with direct checkout and fast delivery in Beirut.",
    };

    // A) Discovery Semantic Path (calling shared quality pipeline directly)
    const discoveryQuality = await evaluateCompetitorQuality(
      candidateEvidence,
      campaignContext,
      { accountId: testAcc }
    );

    // B) Revalidation Semantic Path (calling revalidator which delegates to shared pipeline)
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: candidateEvidence.name,
      websiteUrl: candidateEvidence.websiteUrl,
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: candidateEvidence.websiteUrl,
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_parity_1",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: candidateEvidence.websiteUrl,
      pageType: "HOME",
      rawTextPreview: candidateEvidence.evidenceText,
    });

    const revalidationReport = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: true,
    });

    const revalidationCandidate = revalidationReport.candidates.find(c => c.competitorId === compId);
    expect(revalidationCandidate).toBeDefined();

    // STRICT SEMANTIC EQUALITY ASSERTIONS
    expect(revalidationCandidate!.entityRole).toBe(discoveryQuality.identity.entityRole);
    expect(revalidationCandidate!.relevanceClassification).toBe(discoveryQuality.relevance.classification);
    expect(revalidationCandidate!.judgeVerdict).toBe(discoveryQuality.judge.verdict);
    expect(discoveryQuality.judge.verdict).toBe("APPROVED");
    expect(revalidationCandidate!.action).toBe("KEEP_ACTIVE");
  }, 30000);

  it("proves pure marketplace platform parity across Discovery and Revalidation paths", async () => {
    const identityMock = {
      isRealBusiness: true,
      entityRole: "PURE_MARKETPLACE_PLATFORM",
      canonicalName: "Global Wholesale Marketplace",
      canonicalDomain: "globalwholesalemarketplace.com",
      confidence: 0.95,
      reasoning: "B2B multi-vendor marketplace platform.",
    };
    const relevanceMock = {
      isCompetitor: false,
      classification: "NOT_COMPETITOR",
      targetCategoryMatch: "NO_MATCH",
      geographicRelevance: "GLOBAL",
      productTruthFit: "NO_FIT",
      competitorTier: "D",
      confidence: 0.95,
      reasoning: "Not a direct retail competitor.",
    };

    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any);

    const compId = "comp_test_marketplace_parity";
    const candidateEvidence = {
      candidateKey: compId,
      name: "Global Wholesale Marketplace",
      domain: "globalwholesalemarketplace.com",
      websiteUrl: "https://globalwholesalemarketplace.com",
      evidenceText: "Global B2B wholesale portal connecting overseas factories and suppliers with bulk buyers. Millions of supplier listings for commercial export.",
    };

    // A) Discovery Path
    const discoveryQuality = await evaluateCompetitorQuality(
      candidateEvidence,
      campaignContext,
      { accountId: testAcc }
    );

    // B) Revalidation Path
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: candidateEvidence.name,
      websiteUrl: candidateEvidence.websiteUrl,
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: candidateEvidence.websiteUrl,
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_parity_2",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: candidateEvidence.websiteUrl,
      pageType: "HOME",
      rawTextPreview: candidateEvidence.evidenceText,
    });

    const revalidationReport = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: true,
    });

    const revalidationCandidate = revalidationReport.candidates.find(c => c.competitorId === compId);
    expect(revalidationCandidate).toBeDefined();

    // STRICT SEMANTIC EQUALITY ASSERTIONS
    expect(revalidationCandidate!.entityRole).toBe("PURE_MARKETPLACE_PLATFORM");
    expect(discoveryQuality.identity.entityRole).toBe("PURE_MARKETPLACE_PLATFORM");
    expect(discoveryQuality.judge.verdict).toBe("REJECTED");
    expect(revalidationCandidate!.judgeVerdict).toBe("REJECTED");
    expect(revalidationCandidate!.action).toBe("DEACTIVATE_NOT_COMPETITOR");
  }, 30000);

  it("proves multi-brand retailer parity across Discovery and Revalidation paths", async () => {
    const identityMock = {
      isRealBusiness: true,
      entityRole: "MULTI_BRAND_RETAILER",
      canonicalName: "Beirut Luxury Boutique",
      canonicalDomain: "beirutluxuryboutique.com",
      confidence: 0.95,
      reasoning: "Curated multi-brand boutique.",
    };
    const relevanceMock = {
      isCompetitor: true,
      classification: "DIRECT_COMPETITOR",
      targetCategoryMatch: "EXACT_CATEGORY",
      geographicRelevance: "TARGET_MARKET",
      productTruthFit: "STRONG_FIT",
      competitorTier: "A",
      confidence: 0.95,
      reasoning: "Direct retailer in modest dresses.",
    };

    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any);

    const compId = "comp_test_multibrand_parity";
    const candidateEvidence = {
      candidateKey: compId,
      name: "Beirut Luxury Boutique",
      domain: "beirutluxuryboutique.com",
      websiteUrl: "https://beirutluxuryboutique.com",
      evidenceText: "Beirut Luxury Boutique – Official retailer in Lebanon for top international modest fashion designers. Shop curated summer dresses and evening gowns directly with our in-house styling, checkout, and local delivery.",
    };

    // A) Discovery Path
    const discoveryQuality = await evaluateCompetitorQuality(
      candidateEvidence,
      campaignContext,
      { accountId: testAcc }
    );

    // B) Revalidation Path
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: candidateEvidence.name,
      websiteUrl: candidateEvidence.websiteUrl,
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: candidateEvidence.websiteUrl,
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_parity_3",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: candidateEvidence.websiteUrl,
      pageType: "HOME",
      rawTextPreview: candidateEvidence.evidenceText,
    });

    const revalidationReport = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: true,
    });

    const revalidationCandidate = revalidationReport.candidates.find(c => c.competitorId === compId);
    expect(revalidationCandidate).toBeDefined();

    // STRICT SEMANTIC EQUALITY ASSERTIONS
    expect(["MULTI_BRAND_RETAILER", "SPECIALTY_RETAILER"]).toContain(revalidationCandidate!.entityRole);
    expect(["MULTI_BRAND_RETAILER", "SPECIALTY_RETAILER"]).toContain(discoveryQuality.identity.entityRole);
    expect(discoveryQuality.judge.verdict).toBe("APPROVED");
    expect(revalidationCandidate!.judgeVerdict).toBe("APPROVED");
    expect(revalidationCandidate!.action).toBe("KEEP_ACTIVE");
  }, 30000);

  it("proves insufficient evidence parity across Discovery and Revalidation paths", async () => {
    const identityMock = {
      isRealBusiness: false,
      entityRole: "UNKNOWN",
      canonicalName: "Unknown",
      canonicalDomain: "domainplaceholder99881.com",
      confidence: 0.2,
      reasoning: "Domain parked.",
    };
    const relevanceMock = {
      isCompetitor: false,
      classification: "INSUFFICIENT_EVIDENCE",
      targetCategoryMatch: "NO_MATCH",
      geographicRelevance: "GLOBAL",
      productTruthFit: "NO_FIT",
      competitorTier: "D",
      confidence: 0.2,
      reasoning: "No business evidence.",
    };

    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identityMock) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(relevanceMock) } }] } as any);

    const compId = "comp_test_insufficient_parity";
    const candidateEvidence = {
      candidateKey: compId,
      name: "Domain Placeholder",
      domain: "domainplaceholder99881.com",
      websiteUrl: "https://domainplaceholder99881.com",
      evidenceText: "404 Not Found. This domain is parked. No business information or products available.",
    };

    // A) Discovery Path
    const discoveryQuality = await evaluateCompetitorQuality(
      candidateEvidence,
      campaignContext,
      { accountId: testAcc }
    );

    // B) Revalidation Path
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: candidateEvidence.name,
      websiteUrl: candidateEvidence.websiteUrl,
      tier: "B",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: candidateEvidence.websiteUrl,
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_parity_4",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: candidateEvidence.websiteUrl,
      pageType: "HOME",
      rawTextPreview: candidateEvidence.evidenceText,
    });

    const revalidationReport = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: true,
    });

    const revalidationCandidate = revalidationReport.candidates.find(c => c.competitorId === compId);
    expect(revalidationCandidate).toBeDefined();

    // STRICT SEMANTIC EQUALITY ASSERTIONS
    expect(discoveryQuality.identity.isRealBusiness).toBe(false);
    expect(discoveryQuality.judge.verdict).toBe("REJECTED");
    expect(revalidationCandidate!.action).toBe("DEACTIVATE_INSUFFICIENT_EVIDENCE");
  }, 30000);
});
