/**
 * User-Channel Scraper (Task #10)
 *
 * ARCHITECTURE INVARIANT — DO NOT VIOLATE:
 * This module ONLY writes to the database (user_channel_snapshots).
 * It NEVER triggers any strategy engine, orchestrator, or worker directly.
 * Engine recommendations are produced exclusively by dual-analysis-routes.ts
 * and are only executed when the user explicitly presses "Run Now" in the UI.
 */

import { db } from "./db";
import { userPublicProfiles, userChannelSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { scrapeWebsite } from "./market-intelligence-v3/website-scraper";
import {
  acquireStickySession,
  releaseStickySession,
  rotateSessionOnBlock,
  classifyBlock,
  getRetryDelay,
  logProxyTelemetry,
  type StickySessionContext,
} from "./competitive-intelligence/proxy-pool-manager";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max posts fetched on the very first scrape (broader historical sample). */
const INITIAL_SCRAPE_MAX_POSTS = 30;

/** Max posts fetched on subsequent (incremental) scrapes — approx. 1 week of posts. */
const INCREMENTAL_SCRAPE_MAX_POSTS = 12;

/** Minimum scrape interval — no profile is re-scraped more often than this. */
const MIN_SCRAPE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Maximum scrape interval — and the interval used for degraded profiles. */
const MAX_SCRAPE_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Returns a deterministic but distributed scrape interval for a profile.
 * Hashing the channelKey spreads scrape times across the 24–48h window
 * so all accounts don't fire at the same wall-clock time.
 */
function getProfileScrapeInterval(channelKey: string): number {
  let h = 0;
  for (let i = 0; i < channelKey.length; i++) {
    h = (Math.imul(31, h) + channelKey.charCodeAt(i)) | 0;
  }
  const range = MAX_SCRAPE_INTERVAL_MS - MIN_SCRAPE_INTERVAL_MS;
  return MIN_SCRAPE_INTERVAL_MS + (Math.abs(h) % range);
}

/**
 * Returns true if the last 3 snapshots for this profile are all FAILED.
 * Degraded profiles use the maximum 48h interval to reduce pressure.
 */
export async function isProfileDegraded(
  accountId: string,
  campaignId: string,
  platform: string,
  channelKey: string | null
): Promise<boolean> {
  const conditions: Parameters<typeof and>[0][] = [
    eq(userChannelSnapshots.accountId, accountId),
    eq(userChannelSnapshots.campaignId, campaignId),
    eq(userChannelSnapshots.platform, platform),
  ];
  if (channelKey) conditions.push(eq(userChannelSnapshots.handle, channelKey));

  const recentSnaps = await db
    .select({ id: userChannelSnapshots.id, snapshotData: userChannelSnapshots.snapshotData })
    .from(userChannelSnapshots)
    .where(and(...conditions))
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(3);

  if (recentSnaps.length < 3) return false;

  return recentSnaps.every((snap) => {
    try {
      const data = snap.snapshotData ? JSON.parse(snap.snapshotData) : null;
      return data?.scrapeStatus === "FAILED";
    } catch (err: any) {
      // F-S1 (scraping audit 2026-05): no silent catches. A corrupt snapshot
      // row would silently return "not degraded" and defeat the 3-consecutive-
      // failure cooldown. Log explicitly so the operator sees the row.
      console.warn(
        `[UserChannelScraper] SNAPSHOT_PARSE_FAILED context=isProfileDegraded snapshotId=${snap.id ?? "unknown"} err=${err?.message ?? String(err)}`,
      );
      return false;
    }
  });
}

/** Block-indicator patterns in scrape warnings. */
const BLOCK_WARNING_PATTERNS = [
  "PROXY_BLOCKED", "RATE_LIMIT", "RATE_LIMITED", "AUTH_REQUIRED",
  "403", "429", "ACCESS_DENIED",
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserChannelDelta {
  isFirstScrape: boolean;
  postsInWindow: number;
  newPostsSinceLastSnapshot: number;
  avgEngagementDelta: number | null;
  followersDelta: number | null;
  contentTypeMix: Record<string, number>;
  websiteChangeSummary: string | null;
  deltaWindowDays: number;
}

export interface UserChannelSnapshotData {
  platform: string;
  handle: string | null;
  url: string | null;
  postCount: number;
  followers: number | null;
  recentPostTypes: Record<string, number>;
  avgEngagement: number | null;
  /** Per-format breakdown: maps Instagram mediaType → {count, avgEngagement}. */
  engagementByType?: Record<string, { count: number; avgEngagement: number }>;
  scrapedAt: string;
  websiteHeadlines?: string[];
  websiteCtaLabels?: string[];
  websiteRawPreview?: string;
  scrapeStatus: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  scrapeError?: string;
  scrapeMode: "INITIAL" | "INCREMENTAL";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBlockWarning(warnings: string[]): boolean {
  return warnings.some(w =>
    BLOCK_WARNING_PATTERNS.some(p => w.toUpperCase().includes(p))
  );
}

/**
 * Returns the most recent snapshot for this exact channel identity (platform + channelKey).
 * channelKey = handle for Instagram, normalized URL for website.
 * Keying by channel identity prevents stale snapshots from a different handle/URL
 * from suppressing re-scrapes after the user updates their channel configuration.
 */
export async function getPreviousSnapshot(
  accountId: string,
  campaignId: string,
  platform: string,
  channelKey: string | null,
): Promise<UserChannelSnapshotData | null> {
  const conditions = [
    eq(userChannelSnapshots.accountId, accountId),
    eq(userChannelSnapshots.campaignId, campaignId),
    eq(userChannelSnapshots.platform, platform),
  ];
  if (channelKey) {
    conditions.push(eq(userChannelSnapshots.handle, channelKey));
  }

  const rows = await db
    .select()
    .from(userChannelSnapshots)
    .where(and(...conditions))
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.snapshotData) return null;
  try {
    return JSON.parse(row.snapshotData) as UserChannelSnapshotData;
  } catch (err: any) {
    // F-S1 (scraping audit 2026-05): no silent catches. A corrupt latest-
    // snapshot row would silently return null and trigger an unwarranted
    // "first scrape" treatment downstream. Log explicitly.
    console.warn(
      `[UserChannelScraper] SNAPSHOT_PARSE_FAILED context=getPreviousSnapshot snapshotId=${row.id ?? "unknown"} platform=${platform} channelKey=${channelKey ?? "null"} err=${err?.message ?? String(err)}`,
    );
    return null;
  }
}

function computeDelta(
  current: UserChannelSnapshotData,
  previous: UserChannelSnapshotData | null,
): UserChannelDelta {
  const isFirstScrape = previous === null;
  const deltaWindowDays = isFirstScrape ? 30 : 7;

  let avgEngagementDelta: number | null = null;
  if (!isFirstScrape && previous!.avgEngagement != null && current.avgEngagement != null) {
    avgEngagementDelta = parseFloat((current.avgEngagement - previous!.avgEngagement).toFixed(2));
  }

  let followersDelta: number | null = null;
  if (!isFirstScrape && previous!.followers != null && current.followers != null) {
    followersDelta = current.followers - previous!.followers;
  }

  // New posts since last snapshot:
  // - INITIAL scrape: no meaningful delta (historical baseline), set to 0
  // - INCREMENTAL scrape: fetched posts are all within the recent window (≈7 days),
  //   so all of them are "new" since the last scrape. postCount IS the weekly post delta.
  //   Subtracting previous.postCount would be wrong — it mixes different sampling windows.
  const newPostsSinceLastSnapshot = isFirstScrape
    ? 0
    : current.postCount; // INCREMENTAL window posts = posts published since last scrape

  let websiteChangeSummary: string | null = null;
  if (current.platform === "website") {
    if (isFirstScrape) {
      websiteChangeSummary = `Initial snapshot: ${current.websiteHeadlines?.length ?? 0} headline(s) detected.`;
    } else if (current.websiteHeadlines && previous!.websiteHeadlines) {
      const newH = current.websiteHeadlines.filter(h => !previous!.websiteHeadlines!.includes(h));
      const removedH = previous!.websiteHeadlines.filter(h => !current.websiteHeadlines!.includes(h));
      if (newH.length > 0 || removedH.length > 0) {
        websiteChangeSummary = `${newH.length} new headline(s), ${removedH.length} removed.`;
      } else {
        websiteChangeSummary = "No headline changes detected.";
      }
    }
  }

  return {
    isFirstScrape,
    postsInWindow: current.postCount,
    newPostsSinceLastSnapshot,
    avgEngagementDelta,
    followersDelta,
    contentTypeMix: current.recentPostTypes,
    websiteChangeSummary,
    deltaWindowDays,
  };
}

// ── Instagram scraper (with proxy pool enforcement) ───────────────────────────

async function scrapeInstagramChannel(
  accountId: string,
  campaignId: string,
  handle: string,
  isFirstScrape: boolean,
): Promise<UserChannelSnapshotData> {
  const { scrapeInstagramProfile } = await import("./competitive-intelligence/profile-scraper");
  const maxPosts = isFirstScrape ? INITIAL_SCRAPE_MAX_POSTS : INCREMENTAL_SCRAPE_MAX_POSTS;
  const scrapeMode: "INITIAL" | "INCREMENTAL" = isFirstScrape ? "INITIAL" : "INCREMENTAL";

  // ── Acquire sticky proxy session ──────────────────────────────────────────
  let proxyCtx: StickySessionContext | null = null;
  try {
    proxyCtx = acquireStickySession(accountId, campaignId, `user_ig:${handle}`);
    if (proxyCtx) {
      console.log(`[UserChannelScraper] Proxy session acquired: session=${proxyCtx.session.sessionId} handle=@${handle} mode=${scrapeMode}`);
    } else {
      console.warn(`[UserChannelScraper] No proxy session available for @${handle} — proceeding without proxy`);
    }
  } catch (err: any) {
    console.warn(`[UserChannelScraper] Failed to acquire proxy session for @${handle}: ${err.message}`);
    proxyCtx = null;
  }

  let result: Awaited<ReturnType<typeof scrapeInstagramProfile>> | null = null;

  try {
    const startMs = Date.now();

    // ── First attempt ─────────────────────────────────────────────────────
    result = await scrapeInstagramProfile(handle, proxyCtx ?? undefined, maxPosts, accountId);

    if (proxyCtx) {
      logProxyTelemetry(
        proxyCtx,
        "USER_CHANNEL_SCRAPE",
        200,
        null,
        Date.now() - startMs,
        result.posts.length > 0,
      );
    }

    // ── Block detection & rotation ────────────────────────────────────────
    if (result.posts.length === 0 && isBlockWarning(result.warnings) && proxyCtx) {
      const blockClass = classifyBlock(null, result.warnings.join(" "));
      console.warn(`[UserChannelScraper] Block detected for @${handle}: class=${blockClass} warnings=${result.warnings.join(", ")}`);

      if (proxyCtx) {
        logProxyTelemetry(proxyCtx, "USER_CHANNEL_SCRAPE_BLOCKED", null, blockClass, Date.now() - startMs, false);
      }

      const rotated = rotateSessionOnBlock(proxyCtx, blockClass);
      if (rotated) {
        console.log(`[UserChannelScraper] Session rotated → new session=${rotated.session.sessionId} attempt=${rotated.attemptNumber}`);
        proxyCtx = rotated;

        await getRetryDelay(rotated.attemptNumber);

        const retryMs = Date.now();
        result = await scrapeInstagramProfile(handle, proxyCtx, maxPosts, accountId);
        logProxyTelemetry(
          proxyCtx,
          "USER_CHANNEL_SCRAPE_RETRY",
          200,
          result.posts.length > 0 ? null : blockClass,
          Date.now() - retryMs,
          result.posts.length > 0,
        );
        console.log(`[UserChannelScraper] Retry result: posts=${result.posts.length} success=${result.success}`);
      } else {
        console.warn(`[UserChannelScraper] Session rotation denied or max retries reached for @${handle}`);
      }
    }
  } finally {
    // ── Always release proxy session ──────────────────────────────────────
    if (proxyCtx) {
      try {
        releaseStickySession(proxyCtx);
        console.log(`[UserChannelScraper] Proxy session released: session=${proxyCtx.session.sessionId} handle=@${handle}`);
      } catch (releaseErr: any) {
        console.warn(`[UserChannelScraper] Failed to release proxy session for @${handle}: ${releaseErr.message}`);
      }
    }
  }

  if (!result || (!result.success && result.posts.length === 0)) {
    return {
      platform: "instagram",
      handle,
      url: `https://www.instagram.com/${handle}/`,
      postCount: 0,
      followers: result?.followers ?? null,
      recentPostTypes: {},
      avgEngagement: null,
      scrapedAt: new Date().toISOString(),
      scrapeStatus: "FAILED",
      scrapeError: result?.warnings.join("; ") || "No data retrieved",
      scrapeMode,
    };
  }

  const typeMix: Record<string, number> = {};
  const typeEngagement: Record<string, { total: number; count: number }> = {};
  let totalEngagement = 0;
  let engagementCount = 0;

  for (const post of result.posts) {
    const t = post.mediaType || "UNKNOWN";
    typeMix[t] = (typeMix[t] || 0) + 1;
    const engagement = (post.likes || 0) + (post.comments || 0);
    if (engagement > 0) {
      totalEngagement += engagement;
      engagementCount++;
      if (!typeEngagement[t]) typeEngagement[t] = { total: 0, count: 0 };
      typeEngagement[t].total += engagement;
      typeEngagement[t].count++;
    }
  }

  const avgEngagement = engagementCount > 0
    ? parseFloat((totalEngagement / engagementCount).toFixed(2))
    : null;

  const engagementByType: Record<string, { count: number; avgEngagement: number }> = {};
  for (const [t, { total, count }] of Object.entries(typeEngagement)) {
    engagementByType[t] = {
      count,
      avgEngagement: parseFloat((total / count).toFixed(2)),
    };
  }

  return {
    platform: "instagram",
    handle,
    url: `https://www.instagram.com/${handle}/`,
    postCount: result.posts.length,
    followers: result.followers,
    recentPostTypes: typeMix,
    avgEngagement,
    engagementByType,
    scrapedAt: new Date().toISOString(),
    scrapeStatus: result.success ? "SUCCESS" : "PARTIAL",
    scrapeMode,
  };
}

// ── Website scraper ───────────────────────────────────────────────────────────

async function scrapeWebsiteChannel(
  url: string,
  isFirstScrape: boolean,
  accountId: string,
): Promise<UserChannelSnapshotData> {
  const scrapeMode: "INITIAL" | "INCREMENTAL" = isFirstScrape ? "INITIAL" : "INCREMENTAL";
  try {
    const pages = await scrapeWebsite("user_self", "Self", url, accountId);
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
        scrapeMode,
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
      scrapeMode,
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
      scrapeMode,
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point: scrape all configured user channels for an account+campaign.
 *
 * DOES NOT trigger any engine or orchestrator — only writes snapshots to DB.
 */
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
      // Channel identity key: handle for Instagram, URL for website
      // Using both platform + channelKey prevents stale snapshots from a different handle/URL
      // from suppressing re-scrapes after the user updates their channel config.
      const channelKey: string | null = profile.handle ?? profile.url ?? null;

      // Determine first-scrape vs incremental for this exact channel identity
      const previousSnapshot = await getPreviousSnapshot(accountId, campaignId, profile.platform, channelKey);

      // Per-profile freshness check: skip if this exact channel's last snapshot is still fresh.
      // Degraded profiles (≥3 consecutive FAILEDs) always use the maximum 48h interval to
      // reduce scraping pressure. Normal profiles use a hash-derived 24–48h interval so
      // scrapes are naturally spread across the window rather than all firing together.
      if (previousSnapshot) {
        const degraded = await isProfileDegraded(accountId, campaignId, profile.platform, channelKey);
        const intervalMs = degraded
          ? MAX_SCRAPE_INTERVAL_MS
          : getProfileScrapeInterval(channelKey ?? (accountId + profile.platform));

        if (degraded) {
          console.warn(`[UserChannelScraper] Profile ${profile.platform}:${channelKey ?? "unknown"} is DEGRADED (3+ consecutive failures) — using ${MAX_SCRAPE_INTERVAL_MS / 3600000}h interval`);
        }

        const conditions = [
          eq(userChannelSnapshots.accountId, accountId),
          eq(userChannelSnapshots.campaignId, campaignId),
          eq(userChannelSnapshots.platform, profile.platform),
        ];
        if (channelKey) conditions.push(eq(userChannelSnapshots.handle, channelKey));
        const latestForProfile = await db
          .select()
          .from(userChannelSnapshots)
          .where(and(...conditions))
          .orderBy(desc(userChannelSnapshots.scrapedAt))
          .limit(1);
        if (latestForProfile.length > 0 && latestForProfile[0].scrapedAt) {
          const scrapeIntervalCutoff = Date.now() - intervalMs;
          if (latestForProfile[0].scrapedAt.getTime() >= scrapeIntervalCutoff) {
            console.log(`[UserChannelScraper] Skipping fresh profile: ${profile.platform}:${channelKey ?? "unknown"} (interval=${Math.round(intervalMs / 3600000)}h)`);
            continue;
          }
        }
      }
      const isFirstScrape = previousSnapshot === null;

      let snapshot: UserChannelSnapshotData;

      if (profile.platform === "instagram" && profile.handle) {
        snapshot = await scrapeInstagramChannel(accountId, campaignId, profile.handle, isFirstScrape);
      } else if (profile.platform === "website" && profile.url) {
        snapshot = await scrapeWebsiteChannel(profile.url, isFirstScrape, accountId);
      } else {
        console.log(`[UserChannelScraper] Skipping unsupported platform or missing handle/url: ${profile.platform}`);
        continue;
      }

      const delta = computeDelta(snapshot, previousSnapshot);

      // ── DB write only — no engine calls ────────────────────────────────
      // Store channelKey (handle for Instagram, URL for website) so queries can key by channel identity.
      await db.insert(userChannelSnapshots).values({
        accountId,
        campaignId,
        platform: profile.platform,
        handle: channelKey, // normalized channel identity — URL stored here for website profiles
        snapshotData: JSON.stringify(snapshot),
        deltaFromPrevious: JSON.stringify(delta),
        scrapedAt: new Date(),
      });

      console.log(
        `[UserChannelScraper] Snapshot saved: platform=${profile.platform} handle=${profile.handle || profile.url} ` +
        `mode=${snapshot.scrapeMode} posts=${snapshot.postCount} status=${snapshot.scrapeStatus} ` +
        `newPosts=${delta.newPostsSinceLastSnapshot} engDelta=${delta.avgEngagementDelta}`
      );
    } catch (err: any) {
      console.error(`[UserChannelScraper] Failed for profile ${profile.id}:`, err.message);
    }
  }
}

/**
 * Checks per-profile freshness: returns true if ANY configured profile either
 * has no snapshot at all or its most recent snapshot is older than the minimum
 * scrape interval. This ensures newly added channels and stale channels are
 * never skipped by a campaign-level timestamp check.
 *
 * Uses MIN_SCRAPE_INTERVAL_MS as the "is the campaign due?" cutoff — the
 * tighter end of the 24-48h window. Per-profile pacing inside
 * scrapeUserChannels still applies the hash-spread interval, so this only
 * decides whether to enter the per-profile loop at all.
 *
 * NOTE (2026-04-30): the previous bundle referenced a bare SCRAPE_INTERVAL_MS
 * here, which was undefined and therefore made `cutoff = NaN`. Every
 * `lastScrape.getTime() < NaN` comparison was false, so this guard silently
 * returned false for every fresh-or-stale profile. The fix uses the explicit
 * MIN_SCRAPE_INTERVAL_MS constant so the user 48h scheduler actually fires.
 */
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

  const cutoff = Date.now() - MIN_SCRAPE_INTERVAL_MS;

  for (const profile of profiles) {
    // Key by channel identity (platform + handle/URL) — not just platform
    const channelKey: string | null = profile.handle ?? profile.url ?? null;
    const conditions = [
      eq(userChannelSnapshots.accountId, accountId),
      eq(userChannelSnapshots.campaignId, campaignId),
      eq(userChannelSnapshots.platform, profile.platform),
    ];
    if (channelKey) conditions.push(eq(userChannelSnapshots.handle, channelKey));

    const latestSnap = await db
      .select()
      .from(userChannelSnapshots)
      .where(and(...conditions))
      .orderBy(desc(userChannelSnapshots.scrapedAt))
      .limit(1);

    if (latestSnap.length === 0) return true; // No snapshot for this exact channel → scrape needed
    const lastScrape = latestSnap[0].scrapedAt;
    if (!lastScrape || lastScrape.getTime() < cutoff) return true; // Stale → scrape needed
  }

  return false; // All profiles are fresh
}
