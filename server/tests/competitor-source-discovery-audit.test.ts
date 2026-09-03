import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { 
  discoverAndVerifyCompetitorSources, 
  extractSourcesFromHtml, 
  onboardCompetitorWithMultiSourceDiscovery 
} from "../competitive-intelligence/source-discovery";
import { runCompetitorWebsiteCrawler } from "../competitive-intelligence/competitor-crawler";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { computeSourceAvailability } from "../market-intelligence-v3/source-types";

const BASE_URL = "http://127.0.0.1:8808";

describe("Avyron Competitor Source Discovery Audit (15-Point Suite)", { timeout: 25000 }, () => {
  const testAccountId = "acc_ci_audit_" + Date.now();
  const campaignAId = "camp_audit_a_" + Date.now();
  const campaignBId = "camp_audit_b_" + Date.now();

  beforeAll(async () => {
    // Create test user and campaigns
    await db.insert(schema.users).values({
      id: testAccountId,
      accountId: testAccountId,
      username: `audit_${Date.now()}@avyron.ai`,
      email: `audit_${Date.now()}@avyron.ai`,
      password: "password_hash_placeholder",
      subscriptionStatus: "active",
      hasSeenIntro: true,
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignAId,
      selectedCampaignName: "SaaS Alpha Campaign",
      campaignLocation: "United Arab Emirates",
      campaignGoalType: "conversions",
    });

    await db.insert(schema.campaignSelections).values({
      accountId: testAccountId,
      selectedCampaignId: campaignBId,
      selectedCampaignName: "E-Commerce Beta Campaign",
      campaignLocation: "Saudi Arabia",
      campaignGoalType: "conversions",
    });
  });

  // 1. Approved competitor triggers source discovery
  it("1. Approved competitor triggers multi-source discovery pipeline", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Linear",
      websiteUrl: "https://linear.app",
    });

    expect(competitor).toBeDefined();
    expect(competitor.id).toMatch(/^comp_/);
    expect(manifest).toBeDefined();
    expect(manifest.sources.website.status).toBe("VERIFIED");
  });

  // 2. Website-only competitor does not stop after website persistence
  it("2. Website-only competitor does not stop after website persistence and generates website snapshot baseline", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "WebsiteOnlySaaS",
      websiteUrl: "https://example-saas-pure-web.com",
    });

    expect(competitor.websiteUrl).toBe("https://example-saas-pure-web.com");
    expect(manifest.sources.website.status).toBe("VERIFIED");

    // Verify website crawler snapshot was created
    const snapshots = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(and(
        eq(schema.competitorWebsiteSnapshots.accountId, testAccountId),
        eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id)
      ));

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].status).toBe("COMPLETE");
  });

  // 3. Official website social links are discovered
  it("3. Official website social links (Instagram, LinkedIn, X, TikTok, Reviews, Blog) are accurately extracted", () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Acme Marketing Tools</title></head>
        <body>
          <header>
            <a href="https://acme.com/blog">Read our Blog</a>
          </header>
          <main>
            <h1>Leading Marketing Platform</h1>
            <a href="https://trustpilot.com/review/acme.com">5 Stars on Trustpilot</a>
          </main>
          <footer>
            <a href="https://instagram.com/acmemarketing">Instagram</a>
            <a href="https://linkedin.com/company/acme-marketing">LinkedIn</a>
            <a href="https://x.com/acmetweets">Twitter / X</a>
            <a href="https://tiktok.com/@acme_tok">TikTok</a>
            <a href="https://youtube.com/@acme_official">YouTube</a>
          </footer>
        </body>
      </html>
    `;

    const extracted = extractSourcesFromHtml(sampleHtml, "https://acme.com");

    expect(extracted.instagram).toBe("https://instagram.com/acmemarketing");
    expect(extracted.linkedin).toBe("https://linkedin.com/company/acme-marketing");
    expect(extracted.x).toBe("https://x.com/acmetweets");
    expect(extracted.tiktok).toBe("https://tiktok.com/@acme_tok");
    expect(extracted.youtube).toBe("https://youtube.com/@acme_official");
    expect(extracted.reviews).toBe("https://trustpilot.com/review/acme.com");
    expect(extracted.blog).toBe("https://acme.com/blog");
  });

  // 4. Instagram verified source routes to Instagram adapter
  it("4. Instagram verified source is categorized as VERIFIED with official backlink verification", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_ig_test",
      competitorName: "Acme",
      websiteUrl: "https://acme.com",
      providedSources: {
        instagram: "https://instagram.com/acmeofficial"
      }
    });

    expect(manifest.sources.instagram.status).toBe("VERIFIED");
    expect(manifest.sources.instagram.url).toBe("https://instagram.com/acmeofficial");
  });

  // 5. LinkedIn verified source routes to LinkedIn adapter
  it("5. LinkedIn verified source is recorded without being forced into an Instagram adapter", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_li_test",
      competitorName: "B2B Pro",
      websiteUrl: "https://b2bpro.com",
      providedSources: {
        linkedin: "https://linkedin.com/company/b2bpro"
      }
    });

    expect(manifest.sources.linkedin.status).toBe("VERIFIED");
    expect(manifest.sources.linkedin.platform).toBe("linkedin");
  });

  // 6. X verified source routes to X adapter
  it("6. X verified source is recorded under the X platform slot", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_x_test",
      competitorName: "Tech Corp",
      websiteUrl: "https://techcorp.io",
      providedSources: {
        x: "https://x.com/techcorp"
      }
    });

    expect(manifest.sources.x.status).toBe("VERIFIED");
    expect(manifest.sources.x.url).toBe("https://x.com/techcorp");
  });

  // 7. Google Search routes to Google provider
  it("7. Google Search queries are automatically derived for SERP tracking", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_search_test",
      competitorName: "Notion",
      websiteUrl: "https://notion.so"
    });

    expect(manifest.sources.google_search.status).toBe("VERIFIED");
    expect(manifest.sources.google_search.url).toContain("Notion");
  });

  // 8. Unsupported/missing platform becomes NOT_FOUND, not guessed
  it("8. Missing social platform becomes NOT_FOUND rather than synthesizing a fake guessed handle", async () => {
    const manifest = await discoverAndVerifyCompetitorSources({
      competitorId: "comp_no_social",
      competitorName: "Hidden Enterprise Ltd",
      websiteUrl: "https://hidden-enterprise-pure.com",
    });

    expect(manifest.sources.tiktok.status).toBe("NOT_FOUND");
    expect(manifest.sources.tiktok.url).toBeNull();
    expect(manifest.sources.instagram.status).toBe("NOT_FOUND");
    expect(manifest.sources.instagram.url).toBeNull();
  });

  // 9. Provider failure affects only that source
  it("9. Provider failure on one channel does not fail the whole competitor", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Fault Tolerant Corp",
      websiteUrl: "https://invalid-non-resolvable-domain-12345.com",
    });

    // Competitor was still successfully persisted
    expect(competitor).toBeDefined();
    expect(competitor.id).toBeDefined();
    expect(competitor.name).toBe("Fault Tolerant Corp");
  });

  // 10. Settings Add Competitor uses same discovery pipeline
  it("10. Settings Add Competitor invokes canonical multi-source onboarding", async () => {
    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Stripe",
      websiteUrl: "https://stripe.com",
      tier: "A",
    });

    expect(competitor.tier).toBe("A");
    expect(manifest.sources.website.status).toBe("VERIFIED");
    expect(competitor.notes).toContain('"website"');
  });

  // 11. Verified sources receive first fetch
  it("11. Verified sources trigger first-fetch baseline creation", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Zapier",
      websiteUrl: "https://zapier.com",
    });

    const snapshots = await db
      .select()
      .from(schema.competitorWebsiteSnapshots)
      .where(eq(schema.competitorWebsiteSnapshots.competitorId, competitor.id));

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].status).toBe("COMPLETE");
    expect(snapshots[0].pagesCrawled).toBeDefined();
  });

  // 12. Audience/review evidence becomes available to existing downstream consumers
  it("12. Source availability honestly reflects present vs missing evidence without fabricating signals", () => {
    const webOnlyAvailability = computeSourceAvailability({
      websiteUrl: "https://example.com",
      websiteEnrichmentStatus: "COMPLETE",
      postsCollected: 0,
      tiktokPostCount: 0,
      reviewCount: 0,
    });

    expect(webOnlyAvailability.website).toBe(true);
    expect(webOnlyAvailability.instagram).toBe(false);
    expect(webOnlyAvailability.reviews).toBe(false);
    expect(webOnlyAvailability.primarySource).toBe("website");

    const multiSourceAvailability = computeSourceAvailability({
      profileLink: "https://instagram.com/realbrand",
      postsCollected: 25,
      websiteUrl: "https://realbrand.com",
      websiteEnrichmentStatus: "COMPLETE",
      reviewCount: 15,
    });

    expect(multiSourceAvailability.instagram).toBe(true);
    expect(multiSourceAvailability.reviews).toBe(true);
  });

  // 13. Watchtower sees all enabled verified sources
  it("13. Watchtower monitoring schedule is initialized for newly onboarded competitor", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "WatchtowerMonitoredComp",
      websiteUrl: "https://monitored-comp.com",
    });

    const schedules = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(and(
        eq(schema.miRefreshSchedule.accountId, testAccountId),
        eq(schema.miRefreshSchedule.campaignId, campaignAId),
        eq(schema.miRefreshSchedule.competitorId, competitor.id)
      ));

    expect(schedules.length).toBe(1);
    expect(schedules[0].status).toBe("active");
  });

  // 14. Campaign isolation preserved
  it("14. Campaign isolation is preserved across accounts and campaigns", async () => {
    const compA = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "IsolatedCompA",
      websiteUrl: "https://isolated-a.com",
    });

    const compB = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignBId,
      name: "IsolatedCompB",
      websiteUrl: "https://isolated-b.com",
    });

    expect(compA.competitor.campaignId).toBe(campaignAId);
    expect(compB.competitor.campaignId).toBe(campaignBId);

    // Verify query by campaignA does not leak compB
    const campaignAComps = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, testAccountId),
        eq(schema.ciCompetitors.campaignId, campaignAId)
      ));

    const compBFoundInA = campaignAComps.some(c => c.id === compB.competitor.id);
    expect(compBFoundInA).toBe(false);
  });

  // 15. No platform defaults to Instagram
  it("15. Website-only competitor assigns 'website' platform, never defaulting to a fake Instagram handle", async () => {
    const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId: testAccountId,
      campaignId: campaignAId,
      name: "Pure B2B Software",
      websiteUrl: "https://pureb2bsoftware.org",
    });

    expect(competitor.platform).toBe("website");
    expect(competitor.profileLink).not.toContain("instagram.com/pureb2bsoftware");
  });
});
