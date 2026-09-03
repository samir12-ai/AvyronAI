import "dotenv/config";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import * as aiClient from "../ai-client";
import { revalidateCanonicalCompetitors } from "../competitive-intelligence/competitor-quality-revalidator";

describe("Canonical Competitor Quality Revalidation Suite", { timeout: 180000 }, () => {
  const testAcc = "test_acc_quality_revalidation";
  const testCamp = "test_camp_quality_revalidation";
  const testOfferingId = "off_test_summer_dresses";

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
      id: "bu_snap_test_quality",
      accountId: testAcc,
      campaignId: testCamp,
      canonicalHeroProductAuthority: testOfferingId,
      businessUnderstanding: {
        campaignOffering: {
          offeringName: "summer dresses",
          category: "Modest Fashion / Dresses",
          productTruthFacts: [
            "Offers premium linen and chiffon summer modest dresses.",
            "Features direct e-commerce checkout and fast local delivery in Lebanon."
          ]
        },
        targetUnderstanding: {
          geography: "Lebanon / Middle East",
          targetRoles: ["Modest Fashion Consumer seeking elegant summer dresses"]
        }
      } as any,
    });
  });

  it("evaluates a pure B2B marketplace platform and deactivates it without deleting history", async () => {
    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              isRealBusiness: true,
              entityRole: "PURE_MARKETPLACE_PLATFORM",
              canonicalName: "Global Wholesale Marketplace",
              canonicalDomain: "wholesale-marketplace-sample.com",
              confidence: 0.95,
              reasoning: "B2B portal.",
            }),
          },
        }],
      } as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              isCompetitor: false,
              classification: "NOT_COMPETITOR",
              targetCategoryMatch: "NO_MATCH",
              geographicRelevance: "GLOBAL",
              productTruthFit: "NO_FIT",
              competitorTier: "D",
              confidence: 0.95,
              reasoning: "Marketplace platform.",
            }),
          },
        }],
      } as any);

    const compId = "comp_test_alibaba";
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Global Wholesale Marketplace",
      websiteUrl: "https://wholesale-marketplace-sample.com",
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: "https://wholesale-marketplace-sample.com",
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_1",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: "https://wholesale-marketplace-sample.com",
      pageType: "HOME",
      rawTextPreview: "Global B2B wholesale portal connecting overseas factories and suppliers with bulk buyers. Millions of supplier listings for commercial export.",
    });

    await db.insert(schema.competitorSources).values({
      id: "src_test_1",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      platform: "website",
      url: "https://wholesale-marketplace-sample.com",
      canonicalUrl: "https://wholesale-marketplace-sample.com",
      status: "VERIFIED",
    });

    await db.insert(schema.miRefreshSchedule).values({
      id: "sched_test_1",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      frequency: "WEEKLY",
      nextRun: new Date(),
    });

    const report = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: false,
    });

    expect(report.activeBefore).toBe(1);
    expect(report.activeAfter).toBe(0);
    expect(report.deactivatedNotCompetitorCount).toBe(1);

    // Verify competitor was deactivated, NOT deleted
    const [compInDb] = await db
      .select()
      .from(schema.ciCompetitors)
      .where(eq(schema.ciCompetitors.id, compId));
    expect(compInDb.isActive).toBe(false);
    expect(compInDb.notes).toContain("DEACTIVATED_QUALITY_REVALIDATION");

    // Verify source history was preserved
    const [sourceInDb] = await db
      .select()
      .from(schema.competitorSources)
      .where(eq(schema.competitorSources.id, "src_test_1"));
    expect(sourceInDb).toBeDefined();

    // Verify active refresh schedule was removed
    const schedInDb = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(eq(schema.miRefreshSchedule.competitorId, compId));
    expect(schedInDb.length).toBe(0);
  }, 30000);

  it("evaluates a direct modest fashion brand seller and keeps it active", async () => {
    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              isRealBusiness: true,
              entityRole: "BRAND_DIRECT_SELLER",
              canonicalName: "Beirut Modest Label",
              canonicalDomain: "beirutmodestlabel.com",
              confidence: 0.95,
              reasoning: "Direct modest dress brand.",
            }),
          },
        }],
      } as any)
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              isCompetitor: true,
              classification: "DIRECT_COMPETITOR",
              targetCategoryMatch: "EXACT_CATEGORY",
              geographicRelevance: "TARGET_MARKET",
              productTruthFit: "STRONG_FIT",
              competitorTier: "A",
              confidence: 0.95,
              reasoning: "Direct brand in Beirut.",
            }),
          },
        }],
      } as any);

    const compId = "comp_test_direct_brand";
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Beirut Modest Label",
      websiteUrl: "https://beirutmodestlabel.com",
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: "https://beirutmodestlabel.com",
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_2",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: "https://beirutmodestlabel.com",
      pageType: "HOME",
      rawTextPreview: "Beirut Modest Label – Luxury modest summer dresses, linen maxi dresses, and elegant sets made in Lebanon. Shop online with direct checkout and fast delivery in Beirut.",
    });

    const report = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: false,
    });

    expect(report.activeBefore).toBe(1);
    expect(report.activeAfter).toBe(1);
    expect(report.keepActiveCount).toBe(1);

    const [compInDb] = await db
      .select()
      .from(schema.ciCompetitors)
      .where(eq(schema.ciCompetitors.id, compId));
    expect(compInDb.isActive).toBe(true);
  }, 30000);

  it("proves quality revalidation is 100% idempotent on second pass", async () => {
    const brandIdentity = {
      isRealBusiness: true,
      entityRole: "BRAND_DIRECT_SELLER",
      canonicalName: "Elegance Abayas & Summer Dresses",
      canonicalDomain: "elegancedresses.com",
      confidence: 0.95,
      reasoning: "Direct dress merchant.",
    };
    const brandRelevance = {
      isCompetitor: true,
      classification: "DIRECT_COMPETITOR",
      targetCategoryMatch: "EXACT_CATEGORY",
      geographicRelevance: "TARGET_MARKET",
      productTruthFit: "STRONG_FIT",
      competitorTier: "A",
      confidence: 0.95,
      reasoning: "Direct dress merchant in target market.",
    };

    // Pass 1 does not need to revalidate if already validated, but if called:
    vi.spyOn(aiClient, "aiChat")
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(brandIdentity) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(brandRelevance) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(brandIdentity) } }] } as any)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(brandRelevance) } }] } as any);

    const compId = "comp_test_brand_idem";
    await db.insert(schema.ciCompetitors).values({
      id: compId,
      accountId: testAcc,
      campaignId: testCamp,
      name: "Elegance Abayas & Summer Dresses",
      websiteUrl: "https://elegancedresses.com",
      tier: "A",
      businessType: "DIRECT_COMPETITOR",
      primaryObjective: "CUSTOMER_ACQUISITION",
      profileLink: "https://elegancedresses.com",
      isActive: true,
    });

    await db.insert(schema.competitorWebData).values({
      id: "cwd_test_3",
      accountId: testAcc,
      campaignId: testCamp,
      competitorId: compId,
      sourceType: "WEBSITE",
      sourceUrl: "https://elegancedresses.com",
      pageType: "HOME",
      rawTextPreview: "Elegance – Premium modest summer dresses and abayas direct to consumer. Free delivery in Beirut.",
    });

    // Pass 1
    const pass1 = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: false,
    });
    expect(pass1.activeAfter).toBe(1);

    // Pass 2
    const pass2 = await revalidateCanonicalCompetitors({
      accountId: testAcc,
      campaignId: testCamp,
      dryRun: false,
    });
    expect(pass2.activeBefore).toBe(1);
    expect(pass2.activeAfter).toBe(1);
    expect(pass2.deactivatedNotCompetitorCount).toBe(0);
    expect(pass2.deactivatedInsufficientEvidenceCount).toBe(0);
  }, 30000);
});
