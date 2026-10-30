import "dotenv/config";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";

import { resolveCurrentBusinessUnderstanding } from "../business-understanding/resolver";
import {
  resolvePinnedDiscoveryContext,
  verifyPinnedDiscoveryContextStillCurrent,
} from "../discovery/context-binder";
import {
  flagOwnProductListings,
  verifyCompetitorRelevance,
  runCompetitorFinalJudge,
  type CompetitorQualityCampaignContext,
} from "../discovery/competitor-quality-pipeline";

// Mock AI client at transport boundary
vi.mock("../ai-client", () => {
  return {
    resolveModelForTier: vi.fn(() => "gpt-4.1-mini"),
    aiChat: vi.fn(async (options: any) => {
      const endpoint = options.endpoint || "";
      const promptStr = JSON.stringify(options.messages || []);

      if (endpoint === "competitor-relevance-verifier") {
        if (promptStr.includes("Hafız Mustafa") || promptStr.includes("Güllüoğlu")) {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    isRelevant: true,
                    classification: "DIRECT_COMPETITOR",
                    tier: "A",
                    reason: "Direct Turkish confectionery brand selling competing baklava.",
                  }),
                },
              },
            ],
          };
        }
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  isRelevant: false,
                  classification: "NOT_COMPETITOR",
                  tier: "B",
                  reason: "Not a direct competitor.",
                }),
              },
            },
          ],
        };
      }

      return {
        choices: [{ message: { content: "{}" } }],
      };
    }),
  };
});

describe("Business Context Authority & Discovery Hardening", () => {
  const testAccountId = `test_acc_${uuidv4().slice(0, 8)}`;
  const testCampaignId = `test_camp_${uuidv4().slice(0, 8)}`;
  const otherAccountId = `test_acc_other_${uuidv4().slice(0, 8)}`;
  const testOfferingId = `test_off_${uuidv4().slice(0, 8)}`;
  const testEvidenceId = `test_ev_${uuidv4().slice(0, 8)}`;
  const testWebsiteSnapshotId = `test_ws_${uuidv4().slice(0, 8)}`;

  beforeAll(async () => {
    // Seed campaign selection
    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: testCampaignId,
      selectedCampaignName: "Test Sweets Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignStatus: "active",
      campaignLocation: "Türkiye",
      dataSourceMode: "benchmark",
    });

    // Seed website snapshot with preliminary extraction (Pre-BU)
    await db.insert(schema.websiteSnapshots).values({
      id: testWebsiteSnapshotId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      rootUrl: "https://testbaklava.com",
      pagesCrawled: [
        {
          url: "https://testbaklava.com",
          cleanedText: "Geleneksel Antep baklavası ve fıstıklı tatlılar",
          pageType: "HOMEPAGE",
        },
      ] as any,
      contentHash: "hash_preliminary_123",
      status: "SUCCESS",
      preliminaryExtraction: {
        companyName: "TestBaklava",
        industry: "Food & Beverage / Sweets & Confectionery",
        businessModel: "E-Commerce / Direct-to-Consumer",
        detectedAudience: "Baklava lovers",
        productCatalogue: [
          { id: "prod_1", name: "Fıstıklı Baklava", description: "Klasik fıstıklı baklava" },
        ],
      } as any,
    });
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAccountId));
    await db.delete(schema.offeringInputEvidence).where(eq(schema.offeringInputEvidence.accountId, testAccountId));
    await db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId));
    await db.delete(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.accountId, testAccountId));
    await db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.accountId, testAccountId));
  });

  // TEST 1: Step 1 works before canonical BU exists (no crash, no dependency loop)
  it("1. Step 1 works before canonical BU exists using preliminary extraction without dependency loop", async () => {
    // At this stage, no offering or canonical BU exists yet
    const buResult = await resolveCurrentBusinessUnderstanding({
      accountId: testAccountId,
      campaignId: testCampaignId,
    });

    // Canonical BU must be null
    expect(buResult).toBeNull();

    // Verify website snapshot has preliminary extraction with provenance
    const [ws] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(and(
        eq(schema.websiteSnapshots.accountId, testAccountId),
        eq(schema.websiteSnapshots.campaignId, testCampaignId)
      ))
      .limit(1);

    expect(ws).toBeDefined();
    expect((ws as any).preliminaryExtraction).toBeDefined();
    expect((ws as any).preliminaryExtraction.industry).toBe("Food & Beverage / Sweets & Confectionery");
    expect((ws as any).preliminaryExtraction.companyName).toBe("TestBaklava");
  });

  // TEST 2: Defective historical snapshots never resolve as current
  it("2. Defective historical snapshots (INVALIDATED / isEligible=false) never resolve as current", async () => {
    // Create offering and evidence
    await db.insert(schema.offeringInputEvidence).values({
      id: testEvidenceId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: testOfferingId,
      rawOfferingName: "Antep Fistikli Baklava 500g",
      rawFeaturesAndNotes: "Geleneksel Gaziantep baklavası",
      contentHash: "evidence_hash_123",
      authorityType: "USER_CONFIRMED",
    });

    await db.insert(schema.campaignOfferings).values({
      id: testOfferingId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "Antep Fistikli Baklava 500g",
      sourceInputEvidenceId: testEvidenceId,
    });

    // Insert a poisoned defective snapshot marked as INVALIDATED
    const defectiveSnapshotId = `defective_snap_${uuidv4().slice(0, 8)}`;
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: defectiveSnapshotId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      websiteSnapshotId: testWebsiteSnapshotId,
      offeringInputEvidenceId: testEvidenceId,
      campaignOfferingId: testOfferingId,
      version: 1,
      businessUnderstanding: {
        status: "INVALIDATED",
        isEligible: false,
        invalidatedReason: "DEFECTIVE_KEYWORD_FALLBACK_CONTAMINATION",
        businessName: "TestBaklava",
        generalIndustry: "Software & Technology", // Poisoned
      } as any,
      status: "INVALIDATED",
    });

    // Resolver must FAIL CLOSED and return null
    const res = await resolveCurrentBusinessUnderstanding({
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: testOfferingId,
    });

    expect(res).toBeNull();
  });

  // TEST 3: Context changes during in-flight run aborts/rejects activation
  it("3. Context drift during in-flight discovery run is detected and aborts", async () => {
    // Insert clean canonical BU snapshot
    const cleanSnapshotId = `clean_snap_${uuidv4().slice(0, 8)}`;
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: cleanSnapshotId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      websiteSnapshotId: testWebsiteSnapshotId,
      offeringInputEvidenceId: testEvidenceId,
      campaignOfferingId: testOfferingId,
      version: 2,
      businessUnderstanding: {
        status: "COMPLETE",
        businessName: "TestBaklava",
        generalIndustry: "Food & Beverage / Sweets & Confectionery",
        businessModel: "E-Commerce / Direct-to-Consumer",
        campaignOffering: {
          offeringType: "PRODUCT",
          category: "Traditional Turkish Baklava",
          pricingModel: "Direct Purchase",
          productTruthFacts: [{ statement: "Antep fıstıklı taze üretim" }],
        },
        targetUnderstanding: {
          targetRoles: [{ roleTitle: "Tatlı severler" }],
        },
      } as any,
      status: "COMPLETE",
    });

    // Resolve and pin immutable context
    const pinned = await resolvePinnedDiscoveryContext({
      accountId: testAccountId,
      campaignId: testCampaignId,
    });

    expect(pinned).toBeDefined();
    expect(pinned.category).toBe("Traditional Turkish Baklava");
    expect(pinned.buSnapshotId).toBe(cleanSnapshotId);

    // Initial check must be valid
    const initialCheck = await verifyPinnedDiscoveryContextStillCurrent(pinned);
    expect(initialCheck.valid).toBe(true);

    // Simulate offering drift mid-run (e.g. user selected another product)
    const driftedContext = { ...pinned, campaignOfferingId: "off_mutated_mid_run" };
    const driftCheck = await verifyPinnedDiscoveryContextStillCurrent(driftedContext);
    expect(driftCheck.valid).toBe(false);
    expect(driftCheck.reason).toContain("Hero Offering drifted mid-run");

    // Simulate market drift mid-run
    const marketDrifted = { ...pinned, targetMarket: "Germany" };
    const marketCheck = await verifyPinnedDiscoveryContextStillCurrent(marketDrifted);
    expect(marketCheck.valid).toBe(false);
    expect(marketCheck.reason).toContain("Target Market drifted mid-run");
  });

  // TEST 4: Generic self-brand guard and mixed retailer evaluation
  it("4. Self-brand guard flags own-product listings generically and evaluates mixed retailers", async () => {
    const context: CompetitorQualityCampaignContext = {
      businessName: "TestBaklava",
      offeringName: "Antep Fıstıklı Baklava 500g",
      category: "Traditional Turkish Baklava",
      targetMarket: "Türkiye",
      productTruthFacts: ["500g fresh pistachio baklava"],
      targetRoles: ["Consumers seeking fresh baklava"],
    };

    // Candidate A: Reseller listing client's own brand product ONLY
    const ownBrandOccurrences = [
      {
        missionId: "m_1",
        searchProvider: "GOOGLE",
        searchQuery: "TestBaklava Antep Fistikli Baklava",
        rawTitle: "TestBaklava Antep Fıstıklı Baklava 500g - MarketPlatform",
        rawSnippet: "Buy TestBaklava Antep Fıstıklı Baklava 500g at MarketPlatform with fast delivery.",
        url: "https://marketplatform.test/testbaklava-500g",
        domain: "marketplatform.test",
        retrievedAt: new Date().toISOString(),
      },
    ];

    const flagResA = flagOwnProductListings(ownBrandOccurrences, context.businessName, context.offeringName);
    expect(flagResA.ownProductCount).toBe(1);
    expect(flagResA.competingCount).toBe(0);
    expect(ownBrandOccurrences[0].isOwnProductListing).toBe(true);

    const relevanceA = await verifyCompetitorRelevance(
      {
        candidateKey: "marketplatform.test",
        name: "MarketPlatform",
        domain: "marketplatform.test",
        websiteUrl: "https://marketplatform.test",
        evidenceText: ownBrandOccurrences[0].rawSnippet,
        occurrences: ownBrandOccurrences,
      },
      {
        candidateKey: "marketplatform.test",
        isRealBusiness: true,
        entityRole: "MULTI_BRAND_RETAILER",
        entityRoleReasoning: "Multi brand retailer.",
        canonicalName: "MarketPlatform",
        canonicalDomain: "marketplatform.test",
        confidence: 0.9,
        reasoning: "Verified retailer.",
      },
      context
    );

    // Must be NOT_COMPETITOR because all evidence was an own-brand listing
    expect(relevanceA.classification).toBe("NOT_COMPETITOR");
    expect(relevanceA.isRelevant).toBe(false);

    const judgeA = runCompetitorFinalJudge(
      {
        candidateKey: "marketplatform.test",
        name: "MarketPlatform",
        domain: "marketplatform.test",
        websiteUrl: "https://marketplatform.test",
        evidenceText: ownBrandOccurrences[0].rawSnippet,
      },
      {
        candidateKey: "marketplatform.test",
        isRealBusiness: true,
        entityRole: "MULTI_BRAND_RETAILER",
        entityRoleReasoning: "Retailer.",
        canonicalName: "MarketPlatform",
        canonicalDomain: "marketplatform.test",
        confidence: 0.9,
        reasoning: "Verified retailer.",
      },
      relevanceA,
      { offeringName: context.offeringName, targetMarket: context.targetMarket }
    );
    expect(judgeA.verdict).toBe("REJECTED");

    // Candidate B: Genuine competing brand (Güllüoğlu)
    const competingOccurrences = [
      {
        missionId: "m_1",
        searchProvider: "GOOGLE",
        searchQuery: "Güllüoğlu fıstıklı baklava",
        rawTitle: "Karaköy Güllüoğlu - Geleneksel Antep Fıstıklı Baklava",
        rawSnippet: "Karaköy Güllüoğlu taze fıstıklı baklava ve tatlı çeşitleri online sipariş.",
        url: "https://gulluoglu.test",
        domain: "gulluoglu.test",
        retrievedAt: new Date().toISOString(),
      },
    ];

    const flagResB = flagOwnProductListings(competingOccurrences, context.businessName, context.offeringName);
    expect(flagResB.ownProductCount).toBe(0);
    expect(flagResB.competingCount).toBe(1);

    const relevanceB = await verifyCompetitorRelevance(
      {
        candidateKey: "gulluoglu.test",
        name: "Karaköy Güllüoğlu",
        domain: "gulluoglu.test",
        websiteUrl: "https://gulluoglu.test",
        evidenceText: competingOccurrences[0].rawSnippet,
        occurrences: competingOccurrences,
      },
      {
        candidateKey: "gulluoglu.test",
        isRealBusiness: true,
        entityRole: "BRAND_DIRECT_SELLER",
        entityRoleReasoning: "Direct brand seller.",
        canonicalName: "Karaköy Güllüoğlu",
        canonicalDomain: "gulluoglu.test",
        confidence: 0.95,
        reasoning: "Direct brand.",
      },
      context
    );
    expect(relevanceB.classification).toBe("DIRECT_COMPETITOR");
    expect(relevanceB.isRelevant).toBe(true);

    const judgeB = runCompetitorFinalJudge(
      {
        candidateKey: "gulluoglu.test",
        name: "Karaköy Güllüoğlu",
        domain: "gulluoglu.test",
        websiteUrl: "https://gulluoglu.test",
        evidenceText: competingOccurrences[0].rawSnippet,
      },
      {
        candidateKey: "gulluoglu.test",
        isRealBusiness: true,
        entityRole: "BRAND_DIRECT_SELLER",
        entityRoleReasoning: "Direct brand seller.",
        canonicalName: "Karaköy Güllüoğlu",
        canonicalDomain: "gulluoglu.test",
        confidence: 0.95,
        reasoning: "Direct brand.",
      },
      relevanceB,
      { offeringName: context.offeringName, targetMarket: context.targetMarket }
    );
    expect(judgeB.verdict).toBe("APPROVED");
    expect(judgeB.tier).toBe("A");
  });

  // TEST 5: Cross-account / cross-campaign isolation
  it("5. Resolver maintains strict cross-account and cross-campaign isolation", async () => {
    // Attempting to resolve with a different accountId must return null
    const crossAccRes = await resolveCurrentBusinessUnderstanding({
      accountId: otherAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: testOfferingId,
    });
    expect(crossAccRes).toBeNull();

    // Attempting to resolve with a different campaignId must return null
    const crossCampRes = await resolveCurrentBusinessUnderstanding({
      accountId: testAccountId,
      campaignId: "camp_foreign_123",
      campaignOfferingId: testOfferingId,
    });
    expect(crossCampRes).toBeNull();
  });
});
