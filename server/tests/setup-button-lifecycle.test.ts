import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

describe("Setup Button & Navigation Item Lifecycle", () => {
  const testAccountId = "test_acc_btn_lifecycle_999";
  const testCampaignId = "test_camp_btn_lifecycle_999";

  beforeEach(async () => {
    // Cleanup
    await db.delete(schema.ciCompetitors).where(eq(schema.ciCompetitors.accountId, testAccountId));
    await db.delete(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAccountId));
    await db.delete(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.accountId, testAccountId));
    await db.delete(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId));
    await db.delete(schema.offeringInputEvidence).where(eq(schema.offeringInputEvidence.accountId, testAccountId));
    await db.delete(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.accountId, testAccountId));
    await db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.accountId, testAccountId));

    // Seed base incomplete campaign
    await db.insert(schema.campaignSelections).values({
      selectedCampaignId: testCampaignId,
      accountId: testAccountId,
      selectedCampaignName: "Modest Fashion Campaign",
      selectedPlatform: "meta",
      campaignGoalType: "LEADS",
      campaignLocation: "Lebanon",
      campaignStatus: "active",
      selectedAt: new Date()
    });
  });

  it("1. Status evaluator reports isComplete: false when setup prerequisites are missing", async () => {
    // Website only
    await db.insert(schema.websiteSnapshots).values({
      id: "ws_incomplete_1",
      accountId: testAccountId,
      campaignId: testCampaignId,
      rootUrl: "https://sara-ft.com",
      status: "SUCCESS"
    });

    const [ws] = await db.select().from(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.accountId, testAccountId));
    const [off] = await db.select().from(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId));
    const [bu] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAccountId));
    const comps = await db.select().from(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, testAccountId), eq(schema.ciCompetitors.isActive, true)));

    const isComplete = !!(ws && off && bu?.status === "COMPLETE" && comps.length >= 10);
    expect(isComplete).toBe(false);
  });

  it("2. Status evaluator reports isComplete: true when all prerequisites are satisfied", async () => {
    // 1. Website
    await db.insert(schema.websiteSnapshots).values({
      id: "ws_complete_1",
      accountId: testAccountId,
      campaignId: testCampaignId,
      rootUrl: "https://sara-ft.com",
      status: "SUCCESS"
    });

    // 2. Offering
    const evId = "ev_complete_1";
    const offId = "off_complete_1";
    await db.insert(schema.offeringInputEvidence).values({
      id: evId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignOfferingId: offId,
      rawOfferingName: "summer hijabi dresses",
      rawFeaturesAndNotes: "Modest apparel",
      contentHash: "HASH_COMP"
    });
    await db.insert(schema.campaignOfferings).values({
      id: offId,
      accountId: testAccountId,
      campaignId: testCampaignId,
      offeringName: "summer hijabi dresses",
      sourceInputEvidenceId: evId
    });

    // 3. BU snapshot
    await db.insert(schema.businessUnderstandingSnapshots).values({
      id: "bu_complete_1",
      accountId: testAccountId,
      campaignId: testCampaignId,
      status: "COMPLETE",
      businessUnderstanding: { generalIndustry: "Modest Fashion" }
    });

    // 4. 10 approved competitors
    for (let i = 1; i <= 10; i++) {
      await db.insert(schema.ciCompetitors).values({
        id: `comp_comp_${i}`,
        accountId: testAccountId,
        campaignId: testCampaignId,
        name: `Competitor ${i}`,
        platform: "website",
        profileLink: `https://comp${i}.com`,
        websiteUrl: `https://comp${i}.com`,
        businessType: "Competitor",
        primaryObjective: "Engagement",
        notes: JSON.stringify({ sources: { website: { status: "VERIFIED" } } }),
        isActive: true,
        tier: "B"
      });
    }

    const [ws] = await db.select().from(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.accountId, testAccountId));
    const [off] = await db.select().from(schema.campaignOfferings).where(eq(schema.campaignOfferings.accountId, testAccountId));
    const [bu] = await db.select().from(schema.businessUnderstandingSnapshots).where(eq(schema.businessUnderstandingSnapshots.accountId, testAccountId));
    const comps = await db.select().from(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, testAccountId), eq(schema.ciCompetitors.isActive, true)));

    const isComplete = !!(ws && off && bu?.status === "COMPLETE" && comps.length >= 10);
    expect(isComplete).toBe(true);
    expect(comps.length).toBeGreaterThanOrEqual(10);
  });

  it("3. App layout source code hides Setup navigation item when isSetupComplete is true", () => {
    const layoutPath = path.resolve(__dirname, "../../app/(tabs)/_layout.tsx");
    const content = fs.readFileSync(layoutPath, "utf-8");

    expect(content).toContain("visibleNavItems");
    expect(content).toContain("item.name === 'setup'");
    expect(content).toContain("!controller.isSetupComplete");
  });

  it("4. App dashboard source code hides header setup button, hero banner, and strip when setup is complete", () => {
    const indexPath = path.resolve(__dirname, "../../app/(tabs)/index.tsx");
    const content = fs.readFileSync(indexPath, "utf-8");

    // Header action button
    expect(content).toContain("(!setupStatus || !setupStatus.isComplete) && (");
    // Hero banner
    expect(content).toContain("setupHeroBanner");
  });

  it("5. Strategy plan source code hides GO TO SETUP PAGE when isSetupComplete is true", () => {
    const stratPath = path.resolve(__dirname, "../../app/(tabs)/strategy-plan.tsx");
    const content = fs.readFileSync(stratPath, "utf-8");

    expect(content).toContain("!isSetupComplete && (");
    expect(content).toContain("GO TO SETUP PAGE");
  });
});
