import { db } from "./db";
import { userPublicProfiles, userChannelSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { scrapeWebsite } from "./market-intelligence-v3/website-scraper";

export interface UserChannelDelta {
  postsThisWeek: number;
  avgEngagementDelta: number | null;
  contentTypeMix: Record<string, number>;
  websiteChangeSummary: string | null;
  followersDelta: number | null;
  newPostsSinceLastSnapshot: number;
}

export interface UserChannelSnapshotData {
  platform: string;
  handle: string | null;
  url: string | null;
  postCount: number;
  followers: number | null;
  recentPostTypes: Record<string, number>;
  avgEngagement: number | null;
  scrapedAt: string;
  websiteHeadlines?: string[];
  websiteCtaLabels?: string[];
  websiteRawPreview?: string;
  scrapeStatus: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  scrapeError?: string;
}

async function getPreviousSnapshot(
  accountId: string,
  campaignId: string,
  platform: string,
  handle: string | null,
): Promise<UserChannelSnapshotData | null> {
  const rows = await db
    .select()
    .from(userChannelSnapshots)
    .where(
      and(
        eq(userChannelSnapshots.accountId, accountId),
        eq(userChannelSnapshots.campaignId, campaignId),
        eq(userChannelSnapshots.platform, platform),
      )
    )
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(2);

  if (rows.length < 2) return null;
  const prev = rows[1];
  if (!prev.snapshotData) return null;
  try {
    return JSON.parse(prev.snapshotData) as UserChannelSnapshotData;
  } catch {
    return null;
  }
}

function computeDelta(
  current: UserChannelSnapshotData,
  previous: UserChannelSnapshotData | null,
): UserChannelDelta {
  const postsThisWeek = current.postCount;

  let avgEngagementDelta: number | null = null;
  if (previous?.avgEngagement != null && current.avgEngagement != null) {
    avgEngagementDelta = current.avgEngagement - previous.avgEngagement;
  }

  let followersDelta: number | null = null;
  if (previous?.followers != null && current.followers != null) {
    followersDelta = current.followers - previous.followers;
  }

  const newPostsSinceLastSnapshot =
    previous != null ? Math.max(0, current.postCount - previous.postCount) : current.postCount;

  let websiteChangeSummary: string | null = null;
  if (current.platform === "website" && current.websiteHeadlines && previous?.websiteHeadlines) {
    const newHeadlines = current.websiteHeadlines.filter(h => !previous.websiteHeadlines!.includes(h));
    const removedHeadlines = previous.websiteHeadlines.filter(h => !current.websiteHeadlines!.includes(h));
    if (newHeadlines.length > 0 || removedHeadlines.length > 0) {
      websiteChangeSummary = `${newHeadlines.length} new headline(s), ${removedHeadlines.length} removed.`;
    } else {
      websiteChangeSummary = "No headline changes detected.";
    }
  } else if (current.platform === "website" && current.websiteHeadlines) {
    websiteChangeSummary = `First snapshot: ${current.websiteHeadlines.length} headline(s) detected.`;
  }

  return {
    postsThisWeek,
    avgEngagementDelta,
    contentTypeMix: current.recentPostTypes,
    websiteChangeSummary,
    followersDelta,
    newPostsSinceLastSnapshot,
  };
}

async function scrapeInstagramChannel(handle: string): Promise<UserChannelSnapshotData> {
  try {
    const { scrapeInstagramProfile } = await import("./competitive-intelligence/profile-scraper");
    const result = await scrapeInstagramProfile(handle);

    if (!result.success && result.posts.length === 0) {
      return {
        platform: "instagram",
        handle,
        url: `https://www.instagram.com/${handle}/`,
        postCount: 0,
        followers: result.followers,
        recentPostTypes: {},
        avgEngagement: null,
        scrapedAt: new Date().toISOString(),
        scrapeStatus: "FAILED",
        scrapeError: result.warnings.join("; ") || "No data retrieved",
      };
    }

    const typeMix: Record<string, number> = {};
    let totalEngagement = 0;
    let engagementCount = 0;

    for (const post of result.posts) {
      const t = post.mediaType || "UNKNOWN";
      typeMix[t] = (typeMix[t] || 0) + 1;
      const engagement = (post.likes || 0) + (post.comments || 0);
      if (engagement > 0) {
        totalEngagement += engagement;
        engagementCount++;
      }
    }

    const avgEngagement = engagementCount > 0 ? totalEngagement / engagementCount : null;

    return {
      platform: "instagram",
      handle,
      url: `https://www.instagram.com/${handle}/`,
      postCount: result.posts.length,
      followers: result.followers,
      recentPostTypes: typeMix,
      avgEngagement,
      scrapedAt: new Date().toISOString(),
      scrapeStatus: result.success ? "SUCCESS" : "PARTIAL",
    };
  } catch (err: any) {
    console.error(`[UserChannelScraper] Instagram scrape failed for @${handle}:`, err.message);
    return {
      platform: "instagram",
      handle,
      url: `https://www.instagram.com/${handle}/`,
      postCount: 0,
      followers: null,
      recentPostTypes: {},
      avgEngagement: null,
      scrapedAt: new Date().toISOString(),
      scrapeStatus: "FAILED",
      scrapeError: err.message,
    };
  }
}

async function scrapeWebsiteChannel(url: string): Promise<UserChannelSnapshotData> {
  try {
    const pages = await scrapeWebsite("user_self", "Self", url);
    const homepage = pages[0];

    if (!homepage || homepage.extractionStatus === "FAILED") {
      return {
        platform: "website",
        handle: null,
        url,
        postCount: 0,
        followers: null,
        recentPostTypes: {},
        avgEngagement: null,
        scrapedAt: new Date().toISOString(),
        websiteHeadlines: [],
        websiteCtaLabels: [],
        websiteRawPreview: "",
        scrapeStatus: "FAILED",
        scrapeError: homepage?.extractionError || "Unknown error",
      };
    }

    return {
      platform: "website",
      handle: null,
      url,
      postCount: pages.length,
      followers: null,
      recentPostTypes: { pages: pages.length },
      avgEngagement: null,
      scrapedAt: new Date().toISOString(),
      websiteHeadlines: homepage.headlines || [],
      websiteCtaLabels: homepage.ctaLabels || [],
      websiteRawPreview: homepage.rawTextPreview?.slice(0, 1000) || "",
      scrapeStatus: "SUCCESS",
    };
  } catch (err: any) {
    console.error(`[UserChannelScraper] Website scrape failed for ${url}:`, err.message);
    return {
      platform: "website",
      handle: null,
      url,
      postCount: 0,
      followers: null,
      recentPostTypes: {},
      avgEngagement: null,
      scrapedAt: new Date().toISOString(),
      websiteHeadlines: [],
      scrapeStatus: "FAILED",
      scrapeError: err.message,
    };
  }
}

export async function scrapeUserChannels(accountId: string, campaignId: string): Promise<void> {
  const profiles = await db
    .select()
    .from(userPublicProfiles)
    .where(
      and(
        eq(userPublicProfiles.accountId, accountId),
        eq(userPublicProfiles.campaignId, campaignId),
      )
    );

  if (profiles.length === 0) {
    console.log(`[UserChannelScraper] No user channels configured for account=${accountId} campaign=${campaignId}`);
    return;
  }

  console.log(`[UserChannelScraper] Scraping ${profiles.length} user channel(s) for account=${accountId}`);

  for (const profile of profiles) {
    try {
      let snapshot: UserChannelSnapshotData;

      if (profile.platform === "instagram" && profile.handle) {
        snapshot = await scrapeInstagramChannel(profile.handle);
      } else if (profile.platform === "website" && profile.url) {
        snapshot = await scrapeWebsiteChannel(profile.url);
      } else {
        console.log(`[UserChannelScraper] Skipping unsupported platform: ${profile.platform}`);
        continue;
      }

      const previous = await getPreviousSnapshot(accountId, campaignId, profile.platform, profile.handle);
      const delta = computeDelta(snapshot, previous);

      await db.insert(userChannelSnapshots).values({
        accountId,
        campaignId,
        platform: profile.platform,
        handle: profile.handle,
        snapshotData: JSON.stringify(snapshot),
        deltaFromPrevious: JSON.stringify(delta),
        scrapedAt: new Date(),
      });

      console.log(`[UserChannelScraper] Snapshot saved for ${profile.platform}:${profile.handle || profile.url} | posts=${snapshot.postCount} | status=${snapshot.scrapeStatus}`);
    } catch (err: any) {
      console.error(`[UserChannelScraper] Failed for profile ${profile.id}:`, err.message);
    }
  }
}

export async function needsUserChannelScrape(accountId: string, campaignId: string): Promise<boolean> {
  const profiles = await db
    .select()
    .from(userPublicProfiles)
    .where(
      and(
        eq(userPublicProfiles.accountId, accountId),
        eq(userPublicProfiles.campaignId, campaignId),
      )
    );

  if (profiles.length === 0) return false;

  const latestSnapshots = await db
    .select()
    .from(userChannelSnapshots)
    .where(
      and(
        eq(userChannelSnapshots.accountId, accountId),
        eq(userChannelSnapshots.campaignId, campaignId),
      )
    )
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(1);

  if (latestSnapshots.length === 0) return true;

  const lastScrape = latestSnapshots[0].scrapedAt;
  if (!lastScrape) return true;

  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  return lastScrape < sixDaysAgo;
}
