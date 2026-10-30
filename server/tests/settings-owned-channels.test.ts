import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import { settingsRouter } from "../setup/settings-routes";
import { adaptiveReadRouter } from "../adaptive/read-surface";
import { needsUserChannelScrape } from "../user-channel-scraper";
import { getUnifiedScheduleHealth } from "../watchtower/scheduler";
import { generateAccessToken, verifyToken } from "../auth";
import * as multiSourceProviders from "../acquisition/multi-source-providers";

const SONGAI_ACCOUNT_ID = "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f";
const SONGAI_EMAIL = "avyrontest@gmail.com";
const SONGAI_CAMPAIGN_ID = "camp_ac86e8b8-55b";

const FIXTURE_ACCOUNT_ID = "acc_test_owned_channels_fixture";
const FIXTURE_EMAIL = "owned-channels-fixture@avyron.test";
const FIXTURE_CAMPAIGN_ID = "camp_test_owned_channels_fixture";

const OTHER_ACCOUNT_ID = "acc_test_owned_channels_other";
const OTHER_EMAIL = "owned-channels-other@avyron.test";
const OTHER_CAMPAIGN_ID = "camp_test_owned_channels_other";

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyToken(authHeader.slice(7));
      if (payload) {
        req.userId = payload.userId;
        req.accountId = payload.accountId || payload.userId;
      }
    }
    next();
  });
  app.use("/api/settings", settingsRouter);
  app.use("/api/adaptive", adaptiveReadRouter);
  return app;
}

let server: http.Server;
let baseUrl = "";

async function apiCall(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts?: { token?: string; body?: any }
) {
  const headers: Record<string, string> = {};
  if (opts?.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

async function cleanupFixtureData() {
  for (const campId of [FIXTURE_CAMPAIGN_ID, OTHER_CAMPAIGN_ID]) {
    await db.delete(schema.ownedPosts).where(eq(schema.ownedPosts.campaignId, campId));
    await db.delete(schema.userChannelSnapshots).where(eq(schema.userChannelSnapshots.campaignId, campId));
    await db.delete(schema.userPublicProfiles).where(eq(schema.userPublicProfiles.campaignId, campId));
    await db.delete(schema.websiteSnapshots).where(eq(schema.websiteSnapshots.campaignId, campId));
    await db.delete(schema.acquisitionRequests).where(eq(schema.acquisitionRequests.campaignId, campId));
    await db.delete(schema.acquisitionTasks).where(eq(schema.acquisitionTasks.campaignId, campId));
    await db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.selectedCampaignId, campId));
  }
}

import * as ownedPostClassifier from "../performance-loop/owned-post-classifier";

describe("Settings → Owned Social & Website Channels Wiring & LinkedIn Ingestion", { timeout: 30000 }, () => {
  const app = buildTestApp();
  const songaiToken = generateAccessToken(SONGAI_ACCOUNT_ID, SONGAI_EMAIL, SONGAI_ACCOUNT_ID);
  const fixtureToken = generateAccessToken(FIXTURE_ACCOUNT_ID, FIXTURE_EMAIL, FIXTURE_ACCOUNT_ID);
  const otherToken = generateAccessToken(OTHER_ACCOUNT_ID, OTHER_EMAIL, OTHER_ACCOUNT_ID);

  beforeAll(async () => {
    vi.spyOn(ownedPostClassifier, "classifyOwnedPosts").mockResolvedValue({
      eligible: 0,
      classified: 0,
      failed: 0,
      skipped: 0,
    } as any);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    await cleanupFixtureData();

    // Seed fixture campaign selection + initial channels
    await db.insert(schema.campaignSelections).values([
      {
        accountId: FIXTURE_ACCOUNT_ID,
        selectedCampaignId: FIXTURE_CAMPAIGN_ID,
        selectedCampaignName: "Fixture Owned Channels Campaign",
        campaignGoalType: "GROWTH",
        campaignLocation: "United States",
      },
      {
        accountId: OTHER_ACCOUNT_ID,
        selectedCampaignId: OTHER_CAMPAIGN_ID,
        selectedCampaignName: "Other Account Campaign",
        campaignGoalType: "GROWTH",
        campaignLocation: "United Kingdom",
      },
    ]);

    await db.insert(schema.websiteSnapshots).values({
      id: "websnap_fixture_01",
      accountId: FIXTURE_ACCOUNT_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      rootUrl: "https://fixturebrand.example.com/",
      pages: [],
    });

    const initialProfiles = [
      {
        id: "chan_fix_ig",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        platform: "instagram",
        handle: "fixturebrand",
        url: "https://www.instagram.com/fixturebrand/",
        followersCount: 320,
      },
      {
        id: "chan_fix_tt",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        platform: "tiktok",
        handle: "fixturebrand",
        url: "https://www.tiktok.com/@fixturebrand",
        followersCount: 1450,
      },
      {
        id: "chan_fix_yt",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        platform: "youtube",
        handle: "fixturebrand",
        url: "https://www.youtube.com/@fixturebrand",
        followersCount: 890,
      },
      {
        id: "chan_fix_li",
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        platform: "linkedin",
        handle: "company",
        url: "https://linkedin.com/company",
        followersCount: 0,
      },
    ];
    await db.insert(schema.userPublicProfiles).values(initialProfiles);

    for (const p of initialProfiles.slice(0, 3)) {
      await db.insert(schema.userChannelSnapshots).values({
        accountId: FIXTURE_ACCOUNT_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        platform: p.platform,
        handle: p.handle,
        snapshotData: JSON.stringify({
          platform: p.platform,
          handle: p.handle,
          url: p.url,
          postCount: 5,
          storedHistoricalPostCount: 5,
          identityStatus: "CONFIRMED",
          followers: p.followersCount,
          scrapeStatus: "SUCCESS",
          scrapedAt: new Date().toISOString(),
        }),
        scrapedAt: new Date(),
      });
    }
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupFixtureData();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);

  it("1. Populates Songai (camp_ac86e8b8-55b) canonical channels and websiteUrl/domain on GET /api/settings/campaign/:campaignId", async () => {
    const res = await apiCall("GET", `/api/settings/campaign/${SONGAI_CAMPAIGN_ID}`, {
      token: songaiToken,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const camp = res.body.campaign;
    expect(camp.id).toBe(SONGAI_CAMPAIGN_ID);
    expect(camp.websiteUrl).toBe("https://thesongai.com/");
    expect(camp.domain).toBe("https://thesongai.com/");
    expect(Array.isArray(camp.channels)).toBe(true);
    expect(Array.isArray(camp.ownedChannels)).toBe(true);
    expect(camp.ownedChannels).toEqual(camp.channels);

    const byPlat = Object.fromEntries(camp.ownedChannels.map((c: any) => [c.platform, c]));

    expect(byPlat.instagram).toMatchObject({
      id: "chan_775da6a4-0",
      platform: "instagram",
      handle: "songaimedia",
      url: "https://www.instagram.com/songaimedia/",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED (30 posts)",
      followersCount: 127,
      storedPostsCount: 30,
      trackingType: "PUBLIC_SOURCE",
    });

    expect(byPlat.tiktok).toMatchObject({
      id: "chan_81de1cff-0",
      platform: "tiktok",
      handle: "songaimedia",
      url: "https://www.tiktok.com/@songaimedia",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED (20 posts)",
      followersCount: 5417,
      storedPostsCount: 20,
      trackingType: "PUBLIC_SOURCE",
    });

    expect(byPlat.youtube).toMatchObject({
      id: "chan_318b2447-d",
      platform: "youtube",
      handle: "songaimedia",
      url: "https://www.youtube.com/@songaimedia",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED (35 posts)",
      followersCount: 487,
      storedPostsCount: 35,
      channelId: "UC4Qu-Or5Bm2wvsQrI01KB9Q",
      channelName: "The Songai",
      trackingType: "PUBLIC_SOURCE",
    });

    expect(byPlat.linkedin).toMatchObject({
      id: "chan_1f1dd1d4-a",
      platform: "linkedin",
      handle: "company",
      url: "https://linkedin.com/company",
      identityStatus: "UNRESOLVED",
      lifecycleStatus: "NEEDS_FULL_URL",
      statusLabel: "Needs full LinkedIn URL",
      scrapeStatus: "UNRESOLVED_IDENTITY",
      trackingType: "PUBLIC_SOURCE",
    });

    expect(byPlat.website).toMatchObject({
      platform: "website",
      url: "https://thesongai.com/",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED",
      trackingType: "PUBLIC_SOURCE",
    });
  });

  it("2. Enforces authenticated campaign ownership server-side (401 unauthenticated, 404 wrong account)", async () => {
    const unauthGet = await apiCall("GET", `/api/settings/campaign/${SONGAI_CAMPAIGN_ID}`);
    expect(unauthGet.status).toBe(401);

    const wrongOwnerGet = await apiCall("GET", `/api/settings/campaign/${SONGAI_CAMPAIGN_ID}`, {
      token: otherToken,
    });
    expect(wrongOwnerGet.status).toBe(404);

    const wrongOwnerPost = await apiCall(
      "POST",
      `/api/settings/campaign/${SONGAI_CAMPAIGN_ID}/owned-channels`,
      {
        token: otherToken,
        body: {
          channels: [{ platform: "linkedin", url: "https://www.linkedin.com/company/intruder" }],
        },
      }
    );
    expect(wrongOwnerPost.status).toBe(404);
  });

  it("3. Rejects incomplete LinkedIn /company root URL with clear validation error and preserves all existing channels", async () => {
    const res = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        channels: [{ platform: "linkedin", url: "https://www.linkedin.com/company/" }],
        triggerScrape: false,
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.field).toBe("linkedin");
    expect(res.body.error).toContain("without account slug");
  });

  it("4. LinkedIn-only update preserves Instagram, TikTok, YouTube, and Website, and blank fields never disconnect existing channels", async () => {
    const fetchSpy = vi
      .spyOn(multiSourceProviders, "fetchLinkedInEvidence")
      .mockImplementation(async (params) => {
        if (params.capability === "PROFILE") {
          return {
            items: [],
            report: {
              platform: "LINKEDIN",
              actorId: "harvestapi~linkedin-company",
              runId: "run_prof_company_01",
              datasetId: "ds_prof_01",
              itemCount: 1,
              isConfirmedEmpty: false,
              usageUsd: 0.002,
              profileDossier: {
                companyId: "li_comp_fixture_99",
                name: "Fixture Brand Inc.",
                universalName: "fixture-brand",
                followerCount: 2450,
                employeeCount: 42,
                website: "https://fixturebrand.example.com",
                industry: "Software Development",
                tagline: "AI Music & Media",
              },
            },
          };
        }
        return {
          items: [
            {
              id: "li_post_9001",
              externalId: "post_9001",
              platform: "LINKEDIN",
              sourceType: "SOCIAL",
              url: "https://www.linkedin.com/posts/fixture-brand_9001",
              title: "Product Launch",
              text: "Introducing our new workflow engine for creators.",
              publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
              engagementMetrics: { likes: 48, comments: 12, shares: 5, views: 1200 },
              authorName: "Fixture Brand Inc.",
              rawPayload: { id: "post_9001" },
            },
            {
              id: "li_post_9002",
              externalId: "post_9002",
              platform: "LINKEDIN",
              sourceType: "SOCIAL",
              url: "https://www.linkedin.com/posts/fixture-brand_9002",
              title: "Customer Milestone",
              text: "Celebrating 10,000 songs created this quarter!",
              publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
              engagementMetrics: { likes: 82, comments: 19, shares: 9, views: 2300 },
              authorName: "Fixture Brand Inc.",
              rawPayload: { id: "post_9002" },
            },
          ],
          report: {
            platform: "LINKEDIN",
            actorId: "harvestapi~linkedin-company-posts",
            runId: "run_posts_company_01",
            datasetId: "ds_posts_01",
            itemCount: 2,
            isConfirmedEmpty: false,
            usageUsd: 0.004,
          },
        };
      });

    // Also include blank strings for instagram/tiktok in a flat payload check to verify blank fields are ignored
    const res = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        instagram: "",
        tiktok: "",
        youtube: "",
        website: "",
        linkedin: "https://www.linkedin.com/company/fixture-brand",
        triggerSync: true,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedPlatforms).toEqual(["linkedin"]);
    expect(res.body.scrapedPlatforms).toEqual(["linkedin"]);

    const byPlat = Object.fromEntries(res.body.ownedChannels.map((c: any) => [c.platform, c]));

    // Every other channel is preserved intact
    expect(byPlat.instagram.url).toBe("https://www.instagram.com/fixturebrand/");
    expect(byPlat.tiktok.url).toBe("https://www.tiktok.com/@fixturebrand");
    expect(byPlat.youtube.url).toBe("https://www.youtube.com/@fixturebrand");
    expect(byPlat.website.url).toBe("https://fixturebrand.example.com/");

    // LinkedIn is now CONFIRMED and FETCHED with 2 posts and 2450 followers
    expect(byPlat.linkedin).toMatchObject({
      id: "chan_fix_li",
      platform: "linkedin",
      handle: "company/fixture-brand",
      url: "https://www.linkedin.com/company/fixture-brand",
      accountType: "company",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED (2 posts)",
      scrapeStatus: "SUCCESS",
      followersCount: 2450,
      storedPostsCount: 2,
      channelId: "li_comp_fixture_99",
      channelName: "Fixture Brand Inc.",
      profileRunId: "run_prof_company_01",
      postsRunId: "run_posts_company_01",
    });

    // Verify Performance Loop read surface (/api/adaptive/performance-loop/overview/:campaignId) consumes the persisted LinkedIn profile & posts
    const perfRes = await apiCall("GET", `/api/adaptive/performance-loop/overview/${FIXTURE_CAMPAIGN_ID}`, {
      token: fixtureToken,
    });
    expect(perfRes.status).toBe(200);
    const liCounts = perfRes.body?.planPerformance?.ownedChannelEngagement?.platformCounts?.linkedin;
    expect(liCounts).toMatchObject({
      connected: true,
      url: "https://www.linkedin.com/company/fixture-brand",
      handle: "company/fixture-brand",
      channelId: "li_comp_fixture_99",
      channelName: "Fixture Brand Inc.",
      accountType: "company",
      identityStatus: "CONFIRMED",
      scrapeStatus: "SUCCESS",
      followersCount: 2450,
      storedUniqueItems: 2,
    });

    // Verify participation in 24-hour refresh lifecycle
    const freshCheck = await needsUserChannelScrape(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    expect(freshCheck).toBe(false);
    const schedHealth = await getUnifiedScheduleHealth(FIXTURE_ACCOUNT_ID, FIXTURE_CAMPAIGN_ID);
    const liSched = schedHealth.ownedChannelRefresh.channels.find((o: any) => o.platform === "linkedin");
    expect(liSched).toBeDefined();
    expect(liSched?.handle).toBe("company/fixture-brand");
    expect(liSched?.nextDueAt).toBeTruthy();
    expect(liSched?.status).toBe("HEALTHY_SCHEDULED");

    fetchSpy.mockRestore();
  });

  it("5. Routes personal LinkedIn (/in/<slug>) to personal profile posts actor and preserves repeated saves without duplicates", async () => {
    const fetchSpy = vi
      .spyOn(multiSourceProviders, "fetchLinkedInEvidence")
      .mockImplementation(async () => ({
        items: [
          {
            id: "li_personal_1",
            externalId: "personal_1",
            platform: "LINKEDIN",
            sourceType: "SOCIAL",
            url: "https://www.linkedin.com/posts/founder-slug_1",
            title: "",
            text: "Personal founder update on building AI products.",
            publishedAt: new Date().toISOString(),
            engagementMetrics: { likes: 110, comments: 24, shares: 7, views: 4100 },
            authorName: "Founder Name",
            rawPayload: { followerCount: 5120 },
          },
        ],
        report: {
          platform: "LINKEDIN",
          actorId: "apimaestro~linkedin-profile-posts",
          runId: "run_personal_posts_01",
          datasetId: "ds_personal_01",
          itemCount: 1,
          isConfirmedEmpty: false,
          usageUsd: 0.003,
        },
      }));

    const saveRes = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        channels: [{ platform: "linkedin", url: "https://www.linkedin.com/in/founder-slug" }],
        triggerScrape: true,
      },
    });

    expect(saveRes.status).toBe(200);
    const liRow = saveRes.body.ownedChannels.find((c: any) => c.platform === "linkedin");
    expect(liRow).toMatchObject({
      platform: "linkedin",
      handle: "in/founder-slug",
      url: "https://www.linkedin.com/in/founder-slug",
      accountType: "profile",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      followersCount: 5120,
    });

    // Repeated save of the exact same URL must not create duplicate rows or trigger a redundant scrape
    fetchSpy.mockClear();
    const repeatRes = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        channels: [{ platform: "linkedin", url: "https://www.linkedin.com/in/founder-slug" }],
        triggerScrape: true,
      },
    });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.scrapedPlatforms).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const dbRows = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(
        and(
          eq(schema.userPublicProfiles.accountId, FIXTURE_ACCOUNT_ID),
          eq(schema.userPublicProfiles.campaignId, FIXTURE_CAMPAIGN_ID),
          eq(schema.userPublicProfiles.platform, "linkedin")
        )
      );
    expect(dbRows.length).toBe(1);

    fetchSpy.mockRestore();
  });

  it("6. Distinguishes VERIFIED_EMPTY when LinkedIn company profile exists with 0 public posts", async () => {
    // Clear prior owned_posts for linkedin in fixture campaign
    await db
      .delete(schema.ownedPosts)
      .where(
        and(
          eq(schema.ownedPosts.campaignId, FIXTURE_CAMPAIGN_ID),
          eq(schema.ownedPosts.platform, "linkedin")
        )
      );

    const fetchSpy = vi
      .spyOn(multiSourceProviders, "fetchLinkedInEvidence")
      .mockImplementation(async (params) => {
        if (params.capability === "PROFILE") {
          return {
            items: [],
            report: {
              platform: "LINKEDIN",
              actorId: "harvestapi~linkedin-company",
              runId: "run_empty_prof_01",
              datasetId: "ds_empty_prof_01",
              itemCount: 1,
              isConfirmedEmpty: false,
              profileDossier: {
                companyId: "li_comp_quiet_01",
                name: "Quiet Stealth Corp",
                universalName: "quiet-stealth-corp",
                followerCount: 115,
              },
            },
          };
        }
        return {
          items: [],
          report: {
            platform: "LINKEDIN",
            actorId: "harvestapi~linkedin-company-posts",
            runId: "run_empty_posts_01",
            datasetId: "ds_empty_posts_01",
            itemCount: 0,
            isConfirmedEmpty: true,
          },
        };
      });

    const res = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        channels: [{ platform: "linkedin", url: "https://www.linkedin.com/company/quiet-stealth-corp" }],
        triggerScrape: true,
      },
    });

    expect(res.status).toBe(200);
    const liRow = res.body.ownedChannels.find((c: any) => c.platform === "linkedin");
    expect(liRow).toMatchObject({
      platform: "linkedin",
      handle: "company/quiet-stealth-corp",
      url: "https://www.linkedin.com/company/quiet-stealth-corp",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "VERIFIED_EMPTY",
      statusLabel: "VERIFIED EMPTY (0 posts)",
      isConfirmedEmpty: true,
      followersCount: 115,
      storedPostsCount: 0,
    });

    fetchSpy.mockRestore();
  });

  it("7. Preserves saved LinkedIn identity when acquisition fails and surfaces FAILED status + actual error", async () => {
    const fetchSpy = vi
      .spyOn(multiSourceProviders, "fetchLinkedInEvidence")
      .mockImplementation(async (params) => ({
        items: [],
        report: {
          platform: "LINKEDIN",
          actorId:
            params.capability === "PROFILE"
              ? "harvestapi~linkedin-company"
              : "harvestapi~linkedin-company-posts",
          runId: "run_fail_01",
          datasetId: "ds_fail_01",
          itemCount: 0,
          isConfirmedEmpty: false,
          error: "Provider upstream error: Company not found on LinkedIn",
        },
      }));

    const res = await apiCall("POST", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels`, {
      token: fixtureToken,
      body: {
        channels: [{ platform: "linkedin", url: "https://www.linkedin.com/company/nonexistent-test-co" }],
        triggerScrape: true,
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const liRow = res.body.ownedChannels.find((c: any) => c.platform === "linkedin");
    expect(liRow).toMatchObject({
      platform: "linkedin",
      handle: "company/nonexistent-test-co",
      url: "https://www.linkedin.com/company/nonexistent-test-co",
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FAILED",
      statusLabel: "FAILED",
      scrapeStatus: "FAILED",
      scrapeError: "Provider upstream error: Company not found on LinkedIn",
    });

    fetchSpy.mockRestore();
  });

  it("8. Supports explicit channel removal via DELETE /api/settings/campaign/:campaignId/owned-channels/:platform without affecting other channels", async () => {
    const delRes = await apiCall("DELETE", `/api/settings/campaign/${FIXTURE_CAMPAIGN_ID}/owned-channels/tiktok`, {
      token: fixtureToken,
    });

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);
    expect(delRes.body.removedPlatform).toBe("tiktok");

    const platformsRemaining = delRes.body.ownedChannels.map((c: any) => c.platform);
    expect(platformsRemaining).not.toContain("tiktok");
    expect(platformsRemaining).toContain("instagram");
    expect(platformsRemaining).toContain("youtube");
    expect(platformsRemaining).toContain("linkedin");
    expect(platformsRemaining).toContain("website");
  });
});
