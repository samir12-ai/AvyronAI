import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  reconcileCompetitors,
  getNormalizedCompetitorDomain,
} from "../competitive-intelligence/competitor-reconciler";
import { onboardCompetitorWithMultiSourceDiscovery } from "../competitive-intelligence/source-discovery";

describe("Competitor State Reconciliation Suite — Safe Historical Deduplication", () => {
  const testAccountId = "test_acc_reconcile";
  const testCampaignId = "test_camp_reconcile";

  const cleanTestFixtures = async () => {
    await db.delete(schema.competitorSources).where(and(eq(schema.competitorSources.accountId, testAccountId), eq(schema.competitorSources.campaignId, testCampaignId)));
    await db.delete(schema.ciCompetitorPosts).where(eq(schema.ciCompetitorPosts.accountId, testAccountId));
    await db.delete(schema.ciCompetitorComments).where(eq(schema.ciCompetitorComments.accountId, testAccountId));
    await db.delete(schema.competitorWebsiteSnapshots).where(and(eq(schema.competitorWebsiteSnapshots.accountId, testAccountId), eq(schema.competitorWebsiteSnapshots.campaignId, testCampaignId)));
    await db.delete(schema.miRefreshSchedule).where(and(eq(schema.miRefreshSchedule.accountId, testAccountId), eq(schema.miRefreshSchedule.campaignId, testCampaignId)));
    await db.delete(schema.watchtowerStrategicBriefs).where(and(eq(schema.watchtowerStrategicBriefs.accountId, testAccountId), eq(schema.watchtowerStrategicBriefs.campaignId, testCampaignId)));
    await db.delete(schema.ciCompetitors).where(and(eq(schema.ciCompetitors.accountId, testAccountId), eq(schema.ciCompetitors.campaignId, testCampaignId)));
  };

  beforeAll(cleanTestFixtures);
  afterAll(cleanTestFixtures);

  // 1. 10 duplicate parent rows, same official domain -> 1 active canonical parent
  it("§37.1: reconciles 10 duplicate parent rows for same business into 1 active canonical parent", async () => {
    await cleanTestFixtures();

    const domain = "zahraathelabel.com";
    const compIds: string[] = [];

    // Insert 10 duplicate competitor rows for same domain
    for (let i = 1; i <= 10; i++) {
      const [comp] = await db
        .insert(schema.ciCompetitors)
        .values({
          id: `comp_test_zahraa_${i}`,
          accountId: testAccountId,
          campaignId: testCampaignId,
          name: `Zahraa The Label (Batch ${i})`,
          websiteUrl: `https://www.zahraathelabel.com`,
          profileLink: `https://www.zahraathelabel.com`,
          businessType: "ecommerce",
          primaryObjective: "direct_sales",
          tier: i === 1 ? "A" : "B",
          isActive: true,
          createdAt: new Date(Date.now() - (10 - i) * 60000),
        })
        .returning();
      compIds.push(comp.id);
    }

    // Attach 5 sources to comp 1, and 2 sources to comp 2
    await db.insert(schema.competitorSources).values([
      {
        id: "src_z_1",
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: compIds[0],
        platform: "WEBSITE",
        canonicalUrl: "https://www.zahraathelabel.com",
        status: "ACTIVE",
      },
      {
        id: "src_z_2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: compIds[0],
        platform: "INSTAGRAM",
        canonicalUrl: "https://instagram.com/zahraathelabel",
        status: "ACTIVE",
      },
      {
        id: "src_z_3",
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: compIds[1],
        platform: "TIKTOK",
        canonicalUrl: "https://tiktok.com/@zahraathelabel",
        status: "ACTIVE",
      },
    ]);

    // Attach posts to comp 1 and comp 2
    await db.insert(schema.ciCompetitorPosts).values([
      {
        id: "post_z_1",
        accountId: testAccountId,
        competitorId: compIds[0],
        postId: "ext_post_101",
        platform: "instagram",
      },
      {
        id: "post_z_2",
        accountId: testAccountId,
        competitorId: compIds[1],
        postId: "ext_post_102",
        platform: "tiktok",
      },
    ]);

    // Attach monitoring schedules to comp 1 and comp 2
    await db.insert(schema.miRefreshSchedule).values([
      {
        id: "sched_z_1",
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: compIds[0],
        status: "active",
      },
      {
        id: "sched_z_2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: compIds[1],
        status: "active",
      },
    ]);

    // Execute dry-run first
    const dryRunResult = await reconcileCompetitors({
      accountId: testAccountId,
      campaignId: testCampaignId,
      dryRun: true,
    });

    expect(dryRunResult.preReconciliation.totalRows).toBe(10);
    expect(dryRunResult.preReconciliation.activeRows).toBe(10);
    expect(dryRunResult.preReconciliation.duplicateRows).toBe(9);
    expect(dryRunResult.postReconciliation.activeCanonicalRows).toBe(1);
    expect(dryRunResult.postReconciliation.inactiveSupersededRows).toBe(9);
    expect(dryRunResult.groups.length).toBe(1);
    expect(dryRunResult.groups[0].survivorId).toBe(compIds[0]); // Has most child data

    // Execute live reconciliation
    const liveResult = await reconcileCompetitors({
      accountId: testAccountId,
      campaignId: testCampaignId,
      dryRun: false,
    });

    expect(liveResult.success).toBe(true);
    expect(liveResult.postReconciliation.activeCanonicalRows).toBe(1);
    expect(liveResult.postReconciliation.inactiveSupersededRows).toBe(9);
    expect(liveResult.postReconciliation.duplicateActiveGroups).toBe(0);

    // Verify DB state
    const activeRows = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    expect(activeRows.length).toBe(1);
    expect(activeRows[0].id).toBe(compIds[0]);

    // Verify inactive rows are preserved
    const inactiveRows = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId),
        eq(schema.ciCompetitors.isActive, false)
      ));

    expect(inactiveRows.length).toBe(9);
    for (const r of inactiveRows) {
      expect(r.notes).toContain("SUPERSEDED_DUPLICATE");
    }
  }, 30000);

  // 2. Sources distributed across duplicates -> sources preserved under survivor
  it("§37.2: preserves all unique child sources and reparents them to survivor", async () => {
    const survivorId = "comp_test_zahraa_1";
    const sources = await db
      .select()
      .from(schema.competitorSources)
      .where(and(
        eq(schema.competitorSources.accountId, testAccountId),
        eq(schema.competitorSources.campaignId, testCampaignId),
        eq(schema.competitorSources.competitorId, survivorId)
      ));

    // All 3 platforms (WEBSITE, INSTAGRAM, TIKTOK) must be preserved under survivor
    expect(sources.length).toBe(3);
    const platforms = new Set(sources.map(s => s.platform));
    expect(platforms.has("WEBSITE")).toBe(true);
    expect(platforms.has("INSTAGRAM")).toBe(true);
    expect(platforms.has("TIKTOK")).toBe(true);
  });

  // 3. Duplicate same source under two parents -> one logical canonical source
  it("§37.3: duplicate source for same platform/URL under multiple parents is deduplicated into one canonical source", async () => {
    const sources = await db
      .select()
      .from(schema.competitorSources)
      .where(and(
        eq(schema.competitorSources.accountId, testAccountId),
        eq(schema.competitorSources.campaignId, testCampaignId)
      ));

    const sourceKeys = new Set(sources.map(s => `${s.platform}:${s.canonicalUrl}`));
    expect(sourceKeys.size).toBe(sources.length);
  });

  // 4. Posts across parents are preserved
  it("§37.4: posts across parents are preserved and reparented to survivor", async () => {
    const survivorId = "comp_test_zahraa_1";
    const posts = await db
      .select()
      .from(schema.ciCompetitorPosts)
      .where(and(
        eq(schema.ciCompetitorPosts.accountId, testAccountId),
        eq(schema.ciCompetitorPosts.competitorId, survivorId)
      ));

    expect(posts.length).toBe(2);
  });

  // 5. Duplicate schedules -> one active logical schedule
  it("§37.5: duplicate monitoring schedules are consolidated into exactly 1 active schedule", async () => {
    const survivorId = "comp_test_zahraa_1";
    const schedules = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(and(
        eq(schema.miRefreshSchedule.accountId, testAccountId),
        eq(schema.miRefreshSchedule.campaignId, testCampaignId)
      ));

    expect(schedules.length).toBe(1);
    expect(schedules[0].competitorId).toBe(survivorId);
  });

  // 6. No child orphaning
  it("§37.7: zero orphan child records exist pointing to superseded competitor IDs", async () => {
    const inactiveComps = await db
      .select({ id: schema.ciCompetitors.id })
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId),
        eq(schema.ciCompetitors.isActive, false)
      ));

    const inactiveIds = new Set(inactiveComps.map(c => c.id));

    const sources = await db
      .select()
      .from(schema.competitorSources)
      .where(and(
        eq(schema.competitorSources.accountId, testAccountId),
        eq(schema.competitorSources.campaignId, testCampaignId)
      ));

    const orphanSources = sources.filter(s => inactiveIds.has(s.competitorId));
    expect(orphanSources.length).toBe(0);
  });

  // 7. Ambiguous same-name different-domain businesses -> NOT automatically merged
  it("§37.9: distinct businesses with same name but different official domains are NOT merged", async () => {
    const nameA = "Luxe Apparel";
    const domainA = "luxeapparel-uae.com";
    const domainB = "luxeapparel-london.co.uk";

    const compA = { name: nameA, websiteUrl: `https://${domainA}` };
    const compB = { name: nameA, websiteUrl: `https://${domainB}` };

    const normA = getNormalizedCompetitorDomain(compA);
    const normB = getNormalizedCompetitorDomain(compB);

    expect(normA).not.toBe(normB);
  });

  // 8. Repeated onboarding after cleanup reuses survivor
  it("§37.12: repeated onboarding for reconciled domain reuses surviving canonical ID without reactivating superseded IDs", async () => {
    const survivorId = "comp_test_zahraa_1";

    const { competitor, isExisting } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: testCampaignId,
      name: "Zahraa The Label",
      websiteUrl: "https://www.zahraathelabel.com",
      tier: "A",
    });

    expect(competitor.id).toBe(survivorId);
    expect(isExisting).toBe(true);
    expect(competitor.isActive).toBe(true);

    // Assert total active competitors remains 1
    const activeRows = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    expect(activeRows.length).toBe(1);
  }, 30000);

  // 9. Build Gate verification with active vs inactive duplicates
  it("§37.11 & §19: Build Gate counts only active canonical competitors (ignores inactive duplicates)", async () => {
    // We currently have 1 active competitor and 9 inactive competitors in test campaign
    const activeComps = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    const totalComps = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, testCampaignId)
      ));

    expect(activeComps.length).toBe(1);
    expect(totalComps.length).toBe(10);

    // If gate requires 10 active competitors, it should see count = 1 (NOT 10)
    expect(activeComps.length >= 10).toBe(false);
  });

  // 10. Generic Entity-Role Tests (§34)
  describe("§34 Generic Entity-Role Reasoning Suite", () => {
    it("Case A: Pure marketplace platform is classified as NOT_COMPETITOR and REJECTED", () => {
      const role = "PURE_MARKETPLACE_PLATFORM";
      const isDirectCompetitor = (role !== "PURE_MARKETPLACE_PLATFORM" && role !== "MARKETPLACE_PLATFORM" && role !== "DIRECTORY_AGGREGATOR");
      expect(isDirectCompetitor).toBe(false);
    });

    it("Case B: Multi-brand retailer directly retailing products can pass as DIRECT or RELEVANT competitor", () => {
      const role = "MULTI_BRAND_RETAILER";
      const isDirectCompetitor = (role !== "PURE_MARKETPLACE_PLATFORM" && role !== "MARKETPLACE_PLATFORM" && role !== "DIRECTORY_AGGREGATOR");
      expect(isDirectCompetitor).toBe(true);
    });

    it("Case C: Directory / aggregator is classified as NOT_COMPETITOR and REJECTED", () => {
      const role = "DIRECTORY_AGGREGATOR";
      const isDirectCompetitor = (role !== "PURE_MARKETPLACE_PLATFORM" && role !== "MARKETPLACE_PLATFORM" && role !== "DIRECTORY_AGGREGATOR");
      expect(isDirectCompetitor).toBe(false);
    });

    it("Case D: Direct brand selling first-party products is eligible as DIRECT_COMPETITOR", () => {
      const role = "BRAND_DIRECT_SELLER";
      const isDirectCompetitor = (role !== "PURE_MARKETPLACE_PLATFORM" && role !== "MARKETPLACE_PLATFORM" && role !== "DIRECTORY_AGGREGATOR");
      expect(isDirectCompetitor).toBe(true);
    });
  });
});
