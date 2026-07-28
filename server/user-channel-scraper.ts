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
import { eq, and, desc, sql } from "drizzle-orm";
import { scrapeWebsite } from "./market-intelligence-v3/website-scraper";

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

// ── Instagram scraper (Apify actor transport — proxy pool retired P-6.12) ─────

/**
 * P-2: returns the snapshot AND the raw per-post scrape results so the
 * owned-post tracker can persist post-level records (previously discarded).
 */
interface InstagramChannelScrapeOutput {
  snapshot: UserChannelSnapshotData;
  posts: import("./competitive-intelligence/profile-scraper").ScrapedPost[];
  followers: number | null;
}

// Exported for the P-2 Phase 6 verification harness ONLY (dev acceptance
// checks need a genuinely fresh fetch without waiting out the 24-48h pacing
// gate). Production callers MUST go through scrapeUserChannels.
export async function scrapeInstagramChannel(
  accountId: string,
  campaignId: string,
  handle: string,
  isFirstScrape: boolean,
): Promise<InstagramChannelScrapeOutput> {
  const { scrapeInstagramProfile } = await import("./competitive-intelligence/profile-scraper");
  const maxPosts = isFirstScrape ? INITIAL_SCRAPE_MAX_POSTS : INCREMENTAL_SCRAPE_MAX_POSTS;
  const scrapeMode: "INITIAL" | "INCREMENTAL" = isFirstScrape ? "INITIAL" : "INCREMENTAL";

  // P-6.12: sticky proxy sessions / rotation retired with Bright Data. The
  // Apify actor is the single transport; a failed run is TRANSIENT and simply
  // retried on the next pacing cycle (no session to rotate).
  const startMs = Date.now();
  const result = await scrapeInstagramProfile(handle, undefined, maxPosts, accountId);
  console.log(`[UserChannelScraper] Scrape complete: handle=@${handle} mode=${scrapeMode} posts=${result.posts.length} durationMs=${Date.now() - startMs}`);

  if (result.posts.length === 0 && isBlockWarning(result.warnings)) {
    console.warn(`[UserChannelScraper] Block-like warnings for @${handle}: ${result.warnings.join(", ")} — will retry on next pacing cycle`);
  }

  if (!result || (!result.success && result.posts.length === 0)) {
    return {
      snapshot: {
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
      },
      posts: [],
      followers: result?.followers ?? null,
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
    snapshot: {
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
    },
    posts: result.posts,
    followers: result.followers,
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

  const { extractHandleFromUrl } = await import("./competitive-intelligence/profile-scraper");

  for (const profile of profiles) {
    try {
      // P-2 input normalization (Phase 1 audit finding): some stored handles
      // contain a full profile URL (e.g. "https://www.instagram.com/x/").
      // Normalize to a bare handle before scraping, keying, and URL building —
      // URL-based lineage matching depends on clean identity.
      const normalizedHandle: string | null =
        profile.platform === "instagram" && profile.handle
          ? extractHandleFromUrl(profile.handle)
          : profile.handle;
      if (profile.handle && normalizedHandle !== profile.handle) {
        console.log(
          `[UserChannelScraper] Handle normalized: "${profile.handle}" → "${normalizedHandle}" (profile=${profile.id})`,
        );
      }

      // Channel identity key: handle for Instagram, URL for website
      // Using both platform + channelKey prevents stale snapshots from a different handle/URL
      // from suppressing re-scrapes after the user updates their channel config.
      const channelKey: string | null = normalizedHandle ?? profile.url ?? null;

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
          // P-2 (INVARIANT-RETRY alignment, 2026-07): a FAILED snapshot MUST
          // NOT satisfy the freshness window — failures never suppress the
          // retry. Failure pacing is the target-backoff cooldown's job;
          // freshness reuse is exclusively for successful snapshots.
          sql`(${userChannelSnapshots.snapshotData}::json->>'scrapeStatus') IS DISTINCT FROM 'FAILED'`,
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
            // P-2: reused snapshots must be visibly distinct from fresh fetches.
            console.log(
              `[UserChannelScraper] OWNED_ACCOUNT_SNAPSHOT_REUSED target=owned_account platform=${profile.platform} channel=${channelKey ?? "unknown"} snapshotAgeH=${((Date.now() - latestForProfile[0].scrapedAt.getTime()) / 3600000).toFixed(1)} interval=${Math.round(intervalMs / 3600000)}h`,
            );
            continue;
          }
        }
      }
      const isFirstScrape = previousSnapshot === null;

      let snapshot: UserChannelSnapshotData;
      let scrapedPosts: import("./competitive-intelligence/profile-scraper").ScrapedPost[] = [];
      let scrapedFollowers: number | null = null;

      if (profile.platform === "instagram" && normalizedHandle) {
        const igResult = await scrapeInstagramChannel(accountId, campaignId, normalizedHandle, isFirstScrape);
        snapshot = igResult.snapshot;
        scrapedPosts = igResult.posts;
        scrapedFollowers = igResult.followers;
      } else if (profile.platform === "website" && profile.url) {
        snapshot = await scrapeWebsiteChannel(profile.url, isFirstScrape, accountId);
      } else {
        console.log(`[UserChannelScraper] Skipping unsupported platform or missing handle/url: ${profile.platform}`);
        continue;
      }

      // P-2: owned-account scrape failures must be loud and classified.
      if (snapshot.scrapeStatus === "FAILED") {
        console.error(
          `[UserChannelScraper] OWNED_ACCOUNT_SCRAPE_FAILED target=owned_account platform=${profile.platform} channel=${channelKey ?? "unknown"} error=${snapshot.scrapeError ?? "unknown"}`,
        );
      }

      const delta = computeDelta(snapshot, previousSnapshot);

      // ── DB write only — no engine calls ────────────────────────────────
      // Store channelKey (handle for Instagram, URL for website) so queries can key by channel identity.
      const snapshotRows = await db.insert(userChannelSnapshots).values({
        accountId,
        campaignId,
        platform: profile.platform,
        handle: channelKey, // normalized channel identity — URL stored here for website profiles
        snapshotData: JSON.stringify(snapshot),
        deltaFromPrevious: JSON.stringify(delta),
        scrapedAt: new Date(),
      }).returning({ id: userChannelSnapshots.id });

      console.log(
        `[UserChannelScraper] Snapshot saved: platform=${profile.platform} handle=${channelKey || profile.url} ` +
        `mode=${snapshot.scrapeMode} posts=${snapshot.postCount} status=${snapshot.scrapeStatus} ` +
        `newPosts=${delta.newPostsSinceLastSnapshot} engDelta=${delta.avgEngagementDelta}`
      );

      // ── P-2: persist per-post records + lineage (DB writes only) ───────
      if (profile.platform === "instagram" && scrapedPosts.length > 0) {
        const { recordOwnedPostObservations } = await import("./performance-loop/owned-post-tracker");
        const { resolveOwnedPostLineage } = await import("./performance-loop/lineage-resolver");
        const tracked = await recordOwnedPostObservations({
          accountId,
          campaignId,
          ownedProfileId: profile.id,
          platform: "instagram",
          posts: scrapedPosts,
          followers: scrapedFollowers,
          scrapeSnapshotId: snapshotRows[0]?.id ?? null,
        });
        if (tracked.ownedPostIds.length > 0) {
          const lineage = await resolveOwnedPostLineage(accountId, campaignId, tracked.ownedPostIds);
          console.log(
            `[UserChannelScraper] Lineage resolved for ${lineage.processed} owned post(s): ` +
            Object.entries(lineage.byState).filter(([, n]) => n > 0).map(([s, n]) => `${s}=${n}`).join(" "),
          );
        }
      }
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
      // FAILED snapshots MUST NOT satisfy freshness — a failure never
      // suppresses the retry (same doctrine as the inner freshness gate).
      sql`(${userChannelSnapshots.snapshotData}::json->>'scrapeStatus') IS DISTINCT FROM 'FAILED'`,
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
