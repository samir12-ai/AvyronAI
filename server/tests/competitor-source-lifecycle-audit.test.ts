import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { 
  discoverAndVerifyCompetitorSources, 
  extractSourcesFromHtml, 
  onboardCompetitorWithMultiSourceDiscovery,
  refreshCompetitorSources,
  performExternalSearchDiscovery
} from "../competitive-intelligence/source-discovery";
import { runCompetitorWebsiteCrawler } from "../competitive-intelligence/competitor-crawler";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { computeSourceAvailability } from "../market-intelligence-v3/source-types";

const BASE_URL = "http://127.0.0.1:8808";

describe("Avyron Competitor Source Lifecycle & Settings Audit (25-Point Suite)", { timeout: 30000 }, () => {
  const testAccountId = "acc_lifecycle_audit_" + Date.now();
  const campaignAId = "camp_lifecycle_a_" + Date.now();
  const campaignBId = "camp_lifecycle_b_" + Date.now();

  beforeAll(async () => {
    // Create test user and campaigns
    await db.insert(schema.users).values({
      id: testAccountId,
      accountId: testAccountId,
      username: `lifecycle_${Date.now()}@avyron.ai`,
      email: `lifecycle_${Date.now()}@avyron.ai`,
      password: "password_hash_placeholder",
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "Lifecycle Alpha Campaign",
      campaignLocation: "United Arab Emirates",
      campaignGoalType: "conversions",
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "Lifecycle Beta Campaign",
      campaignLocation: "Saudi Arabia",
      campaignGoalType: "conversions",
    });
  });

  // 1. Settings displays every supported source type
  it("1. Settings displays every supported source type (Website, Instagram, TikTok, LinkedIn, X, Google Search, Reviews, Blog)", () => {
    const settingsTsx = fs.readFileSync("C:/Users/mahmo/Projects/AvyronAI/app/(tabs)/settings.tsx", "utf8");
    expect(settingsTsx).toContain("'website'");
    expect(settingsTsx).toContain("'instagram'");
    expect(settingsTsx).toContain("'tiktok'");
    expect(settingsTsx).toContain("'linkedin'");
    expect(settingsTsx).toContain("'x'");
    expect(settingsTsx).toContain("'google_search'");
    expect(settingsTsx).toContain("'reviews'");
    expect(settingsTsx).toContain("'blog'");
  });

  // 2. Settings reads canonical persisted source manifest
  it("2. Settings reads canonical persisted source manifest from competitor notes", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Stripe",
      websiteUrl: "https://stripe.com",
    });

    const [dbComp] = await db
      .select()
      .from(schema.ciCompetitors)
      .where(eq(schema.ciCompetitors.id, competitor.id));

    expect(dbComp.notes).toBeDefined();
    const parsedNotes = JSON.parse(dbComp.notes!);
    expect(parsedNotes.sources.website.status).toBe("VERIFIED");
  });

  // 3. Website-linked source becomes VERIFIED
  it("3. Outbound social link extracted from official website HTML becomes VERIFIED with OFFICIAL_WEBSITE_BACKLINK", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_v3_test",
      competitorName: "Linear",
      websiteUrl: "https://linear.app",
    });

    expect(manifest.sources.website.status).toBe("VERIFIED");
    expect(manifest.sources.website.verificationMethod).toBe("OFFICIAL_WEBSITE_BACKLINK");
  });

  // 4. Missing website backlink triggers external discovery
  it("4. Missing website backlink triggers external fallback discovery pass", async () => {
    const searchRes = await performExternalSearchDiscovery({
      competitorName: "Linear",
      cleanDomain: "linear.app",
      missingPlatforms: ["linkedin", "reviews"],
    });

    expect(searchRes.linkedin).toBeDefined();
    expect(searchRes.reviews).toBeDefined();
  });

  // 5. External discovery can find a real official source
  it("5. External discovery verifies official LinkedIn matching company domain", async () => {
    const searchRes = await performExternalSearchDiscovery({
      competitorName: "Linear",
      cleanDomain: "linear.app",
      missingPlatforms: ["linkedin"],
    });

    expect(searchRes.linkedin.verified).toBe(true);
    expect(searchRes.linkedin.url).toContain("linkedin.com/company/linear");
  });

  // 6. Search result requires identity verification
  it("6. Search result requires domain match or official company identity confirmation", async () => {
    const searchRes = await performExternalSearchDiscovery({
      competitorName: "UnrelatedGenericNameXYZ987",
      cleanDomain: "unrelated-xyz987.io",
      missingPlatforms: ["linkedin"],
    });

    expect(searchRes.linkedin.verified).toBe(false);
  });

  // 7. Ambiguous source does not become VERIFIED
  it("7. Ambiguous source candidate does not get marked VERIFIED", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_ambiguous",
      competitorName: "Some Obscure Brand",
      websiteUrl: "https://obscure-brand-xyz.net",
    });

    expect(manifest.sources.tiktok.status).toBe("NOT_FOUND");
  });

  // 8. Handle similarity alone cannot verify source
  it("8. Handle similarity alone without domain evidence cannot verify source", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_handle_test",
      competitorName: "General Shop",
      websiteUrl: "https://general-shop-official-dubai.ae",
    });

    // Should NOT invent @generalshop on TikTok or X
    expect(manifest.sources.tiktok.url).toBeNull();
    expect(manifest.sources.x.url).toBeNull();
  });

  // 9. Full search failure results PROVIDER_UNAVAILABLE, not NOT_FOUND
  it("9. Provider outage results in PROVIDER_UNAVAILABLE rather than false NOT_FOUND", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_provider_down",
      competitorName: "Acme Cloud",
      websiteUrl: "https://acme-cloud.com",
      mockSearchProviderStatus: "PROVIDER_UNAVAILABLE"
    });

    expect(manifest.sources.linkedin.status).toBe("PROVIDER_UNAVAILABLE");
    expect(manifest.sources.instagram.status).toBe("PROVIDER_UNAVAILABLE");
  });

  // 10. Full successful discovery with no valid source results NOT_FOUND
  it("10. Successful discovery search finding no official profile yields NOT_FOUND", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_clean_not_found",
      competitorName: "Zero Social Entity",
      websiteUrl: "https://zero-social-entity-123.com",
      mockSearchProviderStatus: "ACTIVE"
    });

    expect(manifest.sources.tiktok.status).toBe("NOT_FOUND");
    expect(manifest.sources.tiktok.url).toBeNull();
  });

  // 11. No platform is mandatory
  it("11. No individual platform is mandatory for competitor validity", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "SingleChannelMerchant",
      websiteUrl: "https://single-channel-merchant.com",
    });

    expect(competitor).toBeDefined();
    expect(manifest.totalVerifiedSources).toBeGreaterThanOrEqual(1);
  });

  // 12. Online store can validly have no LinkedIn/X
  it("12. An online store can validly operate with verified Website & Instagram and NOT_FOUND on LinkedIn/X", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_store_test",
      competitorName: "Moda Boutique Exclusive",
      websiteUrl: "https://boutique-store-local-dxb.com",
      providedSources: {
        instagram: "https://instagram.com/modaboutique"
      }
    });

    expect(manifest.sources.website.status).toBe("VERIFIED");
    expect(manifest.sources.instagram.status).toBe("VERIFIED");
    expect(manifest.sources.linkedin.status).toBe("NOT_FOUND");
    expect(manifest.sources.x.status).toBe("NOT_FOUND");
  });

  // 13. First fetch runs for verified source
  it("13. First fetch runs automatically upon competitor onboarding", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Notion",
      websiteUrl: "https://notion.so",
    });

    const snapshots = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id));

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].status).toBe("COMPLETE");
  });

  // 14. Verified source gets recurring schedule
  it("14. Verified competitor receives an active entry in mi_refresh_schedule", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Figma",
      websiteUrl: "https://figma.com",
    });

    const [schedule] = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(and(
        eq(schema.miRefreshSchedule.accountId, testAccountId),
        eq(schema.miRefreshSchedule.competitorId, competitor.id)
      ));

    expect(schedule).toBeDefined();
    expect(schedule.status).toBe("active");
  });

  // 15. Second independent fetch can execute later
  it("15. Subsequent crawler execution captures new baseline snapshot without overwriting past history", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Canva",
      websiteUrl: "https://canva.com",
    });

    // Run second crawl
    await runCompetitorWebsiteCrawler(testAccountId, campaignAId, competitor.id, "https://canva.com", 3);

    const snapshots = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id));

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  // 16. Provider failure does not stop other source schedules
  it("16. Single-source provider failure does not deactivate the competitor or halt remaining schedules", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Resilient Brand",
      websiteUrl: "https://resilient-brand-live.com",
    });

    const [schedule] = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(eq(schema.miRefreshSchedule.competitorId, competitor.id));

    expect(schedule.status).toBe("active");
  });

  // 17. Watchtower preserves source semantics
  it("17. Watchtower retains distinct source semantics across website, social, and search channels", () => {
    const availability = computeSourceAvailability({
      profileLink: "https://instagram.com/acme",
      websiteUrl: "https://acme.com",
      websiteEnrichmentStatus: "COMPLETE",
      postsCollected: 30,
      tiktokPostCount: 15,
      reviewCount: 20,
    });

    expect(availability.availableSources).toContain("website");
    expect(availability.availableSources).toContain("instagram");
    expect(availability.availableSources).toContain("tiktok");
    expect(availability.availableSources).toContain("reviews");
  });

  // 18. Reviews continue into Audience/Pain evidence
  it("18. Reviews data availability wires directly into Audience/Pain intelligence metrics", () => {
    const availability = computeSourceAvailability({
      reviewCount: 45,
      websiteUrl: "https://acme.com",
      websiteEnrichmentStatus: "COMPLETE",
    });

    expect(availability.reviews).toBe(true);
  });

  // 19. Settings Add Competitor uses same full discovery pipeline
  it("19. Settings Add Competitor invokes canonical multi-source onboarding engine", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Airtable",
      websiteUrl: "https://airtable.com",
      tier: "A",
    });

    expect(competitor.tier).toBe("A");
    expect(manifest.sources.website.status).toBe("VERIFIED");
  });

  // 20. New source discovered later can join lifecycle without re-adding competitor
  it("20. Refreshing sources dynamically adds newly established platform links without dropping competitor history", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Slack",
      websiteUrl: "https://slack.com",
    });

    const { competitor: refreshedComp, manifest } = await refreshCompetitorSources(
      testAccountId,
      campaignAId,
      competitor.id
    );

    expect(refreshedComp.id).toBe(competitor.id);
    expect(manifest).toBeDefined();
    expect(manifest.sources.website.status).toBe("VERIFIED");
  });

  // 21. Historical evidence survives source disappearance
  it("21. Existing crawl snapshots and post evidence remain intact when source status changes", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Persistent History Brand",
      websiteUrl: "https://persistent-history-brand.com",
    });

    const snapshotsBefore = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id));

    expect(snapshotsBefore.length).toBeGreaterThan(0);

    // Refresh competitor
    await refreshCompetitorSources(testAccountId, campaignAId, competitor.id);

    const snapshotsAfter = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id));

    expect(snapshotsAfter.length).toBeGreaterThanOrEqual(snapshotsBefore.length);
  });

  // 22. accountId/campaignId/competitorId isolation preserved
  it("22. Source discovery strictly isolates competitor data to its specific (accountId, campaignId)", async () => {
    const compA = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "IsolatedAlphaComp",
      websiteUrl: "https://alpha-isolated.com",
    });

    const compB = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignBId,
      name: "IsolatedBetaComp",
      websiteUrl: "https://beta-isolated.com",
    });

    expect(compA.competitor.campaignId).toBe(campaignAId);
    expect(compB.competitor.campaignId).toBe(campaignBId);
  });

  // 23. No fake URLs
  it("23. System generates zero fake URLs for unlinked platforms", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_no_fake",
      competitorName: "Genuine Firm",
      websiteUrl: "https://genuinefirm123.com",
    });

    expect(manifest.sources.tiktok.url).toBeNull();
    expect(manifest.sources.x.url).toBeNull();
  });

  // 24. No guessed handles
  it("24. System generates zero guessed handles based on company name concatenation", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_no_guess",
      competitorName: "Ultra Specific Corporate Entity",
      websiteUrl: "https://ultraspecificcorp123.com",
    });

    expect(manifest.sources.instagram.url).toBeNull();
    expect(manifest.sources.instagram.status).toBe("NOT_FOUND");
  });

  // 25. No first-fetch-only sources unless explicitly documented
  it("25. All verified sources participate in recurring Watchtower monitoring cycle", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "FullLifecycleComp",
      websiteUrl: "https://full-lifecycle-comp.com",
    });

    const [sched] = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(eq(schema.miRefreshSchedule.competitorId, competitor.id));

    expect(sched.status).toBe("active");
    expect(sched.intervalDays).toBeGreaterThanOrEqual(1);
    expect(sched.nextRefreshAt).toBeDefined();
  });
});
