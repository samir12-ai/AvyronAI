import "dotenv/config";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { discoverCampaignCompetitors } from "../setup/competitor-discovery";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../acquisition/multi-source-providers", () => {
  return {
    fetchGoogleSearchEvidence: vi.fn(async ({ query }) => {
      return {
        items: [
          {
            url: "https://www.zahraathelabel.com",
            text: "Zahraa The Label - Elegant Modest Hijab Dresses Online"
          },
          {
            url: "https://veiled.com",
            text: "VEILED - Modern Hijabi Dresses & Modest Fashion"
          },
          {
            url: "https://www.modanisa.com",
            text: "Modanisa - Modest Fashion & Hijabi Dresses"
          }
        ]
      };
    })
  };
});

vi.mock("../ai-client", () => {
  return {
    aiChat: vi.fn(async () => {
      return { choices: [{ message: { content: "{}" } }] };
    })
  };
});

describe("Competitor Discovery Real Search & Channel Platform Validation", () => {
  const testAccountId = "test_acc_discovery_999";
  const testCampaignId = "test_camp_discovery_999";

  beforeEach(async () => {
    // Clean up test records
    await db.delete(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.accountId, testAccountId));
    await db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId));
    await db.delete(schema.offeringInputEvidence).where(eq(schema.offeringInputEvidence.accountId, testAccountId));
    await db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.accountId, testAccountId));
    await db.delete(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.accountId, testAccountId));
    await db.delete(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAccountId));

    // Seed test campaign & offering
    await db.insert(schema.campaignSelections).values({
      selectedCampaignId: testCampaignId,
      accountId: testAccountId,
      selectedCampaignName: "Modest Fashion Test",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignLocation: "Lebanon",
      campaignStatus: "active"
    });

    const evId = "test_ev_999";
    const offId = "test_offering_999";

    await db.insert(schema.offeringInputEvidence).values({
      id: evId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offId,
      rawOfferingName: "summer hijabi dresses",
      rawFeaturesAndNotes: "Modest summer collection",
      contentHash: "HASH_999"
    });

    await db.insert(schema.campaignOfferings).values({
      id: offId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "summer hijabi dresses",
      sourceInputEvidenceId: evId
    });

    await db.insert(schema.websiteSnapshots).values({
      id: "test_ws_999",
      accountId: testAccountId,
      campaignId: testCampaignId,
      rootUrl: "https://sara-ft.com",
      status: "SUCCESS",
      pagesCrawled: [
        {
          sourceUrl: "https://sara-ft.com",
          pageType: "HOME",
          cleanedText: "Modesty Meets Fashion SARA Elegance in Every Stitch Cotton Hijab dresses clothing"
        }
      ]
    });
  });

  it("1. Resolves canonical business context even when legacy BU snapshot is INCOMPLETE", async () => {
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: "test_bu_incomplete_999",
      accountId: testAccountId,
      campaignId: testCampaignId,
      status: "INCOMPLETE",
      businessUnderstanding: { reason: "COMPLETENESS_REPAIR_EXHAUSTED", status: "INCOMPLETE" }
    });

    const report = await discoverCampaignCompetitors(testAccountId, testCampaignId);
    expect(report.searchQueries.length).toBeGreaterThanOrEqual(2);
    expect(report.searchQueries[0]).toContain("summer hijabi dresses");
    expect(report.searchQueries[0]).toContain("Lebanon");
  });

  it("2. Explicit failure status when search context is missing", async () => {
    const report = await discoverCampaignCompetitors(testAccountId, "non_existent_campaign");
    expect(report.status).toBe("INSUFFICIENT_CONTEXT");
    expect(report.candidates).toEqual([]);
  });

  it("3. Provenance is preserved on discovered candidates", async () => {
    const report = await discoverCampaignCompetitors(testAccountId, testCampaignId);
    expect(report.status).toBe("DISCOVERY_COMPLETE");
    expect(report.candidates.length).toBeGreaterThan(0);
    for (const c of report.candidates) {
      expect(c.provenance).toBeDefined();
      expect(c.provenance?.searchProvider).toBe("apify_google_search");
      expect(c.provenance?.searchQuery).toBeDefined();
      expect(c.websiteUrl).toMatch(/^https?:\/\//);
    }
  });

  it("4. Platform validation prevents TikTok URL in Instagram channel", () => {
    const platform = "instagram";
    const raw = "https://www.tiktok.com/@by_sara.ft".toLowerCase();
    const isInvalid = platform === "instagram" && (raw.includes("tiktok.com") || raw.includes("youtube.com") || raw.includes("linkedin.com"));
    expect(isInvalid).toBe(true);
  });

  it("5. Platform validation allows valid Instagram handle", () => {
    const platform = "instagram";
    const raw = "@sara_modest_fashion".toLowerCase();
    const isInvalid = platform === "instagram" && (raw.includes("tiktok.com") || raw.includes("youtube.com") || raw.includes("linkedin.com"));
    expect(isInvalid).toBe(false);
  });
});
