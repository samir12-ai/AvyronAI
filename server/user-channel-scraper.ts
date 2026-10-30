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
import {
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  campaignSelections,
  strategicPlans,
  planApprovals,
  planAnchorResets,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { scrapeWebsite } from "./market-intelligence-v3/website-scraper";
import { normalizeTimestampToIsoUtc, normalizeTimestampToUtcDate } from "./utils/timestamp";

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

export interface CampaignLifecycleWindows {
  campaignCreatedAt: string | null;
  campaignCreatedAtMs: number | null;
  initialActivatedAt: string | null;
  initialActivatedAtMs: number | null;
  activePlanActivatedAt: string | null;
  activePlanActivatedAtMs: number | null;
  campaignWindowStart: string | null;
  campaignWindowStartMs: number | null;
}

export interface OwnedPlatformWindowCounts {
  storedHistoricalPostCount: number;
  postsSinceCreationCount: number;
  postsSinceActivationCount: number;
  activePlanWindowPostCount: number;
  inWindowPostCount: number;
  rolling30dPostCount: number;
  asOf: string;
}

export interface UserChannelSnapshotData {
  platform: string;
  handle: string | null;
  url: string | null;
  channelId?: string | null;
  channelUrl?: string | null;
  channelName?: string | null;
  verifiedChannelOwnershipCount?: number;
  postCount: number;
  fetchedWindowPostCount?: number;
  storedHistoricalPostCount?: number;
  postsSinceCreationCount?: number;
  postsSinceActivationCount?: number;
  activePlanWindowPostCount?: number;
  inWindowPostCount?: number;
  rolling30dPostCount?: number;
  campaignCreatedAt?: string | null;
  campaignActivatedAt?: string | null;
  activePlanActivatedAt?: string | null;
  campaignWindowStart?: string | null;
  accountTotalContent?: number | null;
  accountTotalDisplay?: number | "UNKNOWN";
  accountType?: "company" | "profile" | null;
  identityStatus?: "CONFIRMED" | "DISCOVERED" | "UNVERIFIED" | "UNRESOLVED";
  profileDossier?: Record<string, any> | null;
  profileRunId?: string | null;
  postsRunId?: string | null;
  profileActorId?: string | null;
  postsActorId?: string | null;
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
  isConfirmedEmpty?: boolean;
  isPartialCoverage?: boolean;
  scrapeError?: string;
  scrapeMode: "INITIAL" | "INCREMENTAL";
}

export async function resolveCampaignLifecycleWindows(
  accountId: string,
  campaignId: string,
): Promise<CampaignLifecycleWindows> {
  const [campaignRow] = await db
    .select({ selectedAt: campaignSelections.selectedAt })
    .from(campaignSelections)
    .where(and(eq(campaignSelections.selectedCampaignId, campaignId), eq(campaignSelections.accountId, accountId)))
    .limit(1);

  const plans = await db
    .select({
      id: strategicPlans.id,
      status: strategicPlans.status,
      createdAt: strategicPlans.createdAt,
    })
    .from(strategicPlans)
    .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId)))
    .orderBy(asc(strategicPlans.createdAt));

  const planIds = plans.map((p) => p.id);
  const approvals = planIds.length > 0
    ? await db
        .select({
          planId: planApprovals.planId,
          decision: planApprovals.decision,
          createdAt: planApprovals.createdAt,
        })
        .from(planApprovals)
        .where(and(eq(planApprovals.accountId, accountId), inArray(planApprovals.planId, planIds)))
        .orderBy(asc(planApprovals.createdAt))
    : [];

  const resets = planIds.length > 0
    ? await db
        .select({
          planId: planAnchorResets.planId,
          reanchoredAt: planAnchorResets.reanchoredAt,
        })
        .from(planAnchorResets)
        .where(and(eq(planAnchorResets.accountId, accountId), inArray(planAnchorResets.planId, planIds)))
        .orderBy(desc(planAnchorResets.reanchoredAt))
    : [];

  const approvedEvents = approvals.filter((a) => a.decision === "APPROVED" && a.createdAt);
  const earliestApproval = approvedEvents[0]?.createdAt ?? null;
  const activePlan = [...plans].reverse().find((p) => p.status === "APPROVED") ?? null;
  const activePlanReset = activePlan ? resets.find((r) => r.planId === activePlan.id)?.reanchoredAt ?? null : null;
  const activePlanApproval = activePlan
    ? [...approvedEvents].reverse().find((a) => a.planId === activePlan.id)?.createdAt ?? null
    : null;

  const campaignCreatedAt = normalizeTimestampToIsoUtc(campaignRow?.selectedAt);
  const campaignCreatedAtMs = campaignCreatedAt ? new Date(campaignCreatedAt).getTime() : null;

  const initialActivatedDate = earliestApproval
    ? normalizeTimestampToUtcDate(earliestApproval)
    : campaignCreatedAt
      ? new Date(campaignCreatedAt)
      : null;
  const initialActivatedAt = initialActivatedDate ? initialActivatedDate.toISOString() : null;
  const initialActivatedAtMs = initialActivatedDate ? initialActivatedDate.getTime() : null;

  const activeAnchorDate = activePlanReset
    ? normalizeTimestampToUtcDate(activePlanReset)
    : activePlanApproval
      ? normalizeTimestampToUtcDate(activePlanApproval)
      : initialActivatedDate;
  const activePlanActivatedAt = activeAnchorDate ? activeAnchorDate.toISOString() : null;
  const activePlanActivatedAtMs = activeAnchorDate ? activeAnchorDate.getTime() : null;

  const campaignWindowStart = initialActivatedAt ?? campaignCreatedAt;
  const campaignWindowStartMs = initialActivatedAtMs ?? campaignCreatedAtMs;

  return {
    campaignCreatedAt,
    campaignCreatedAtMs,
    initialActivatedAt,
    initialActivatedAtMs,
    activePlanActivatedAt,
    activePlanActivatedAtMs,
    campaignWindowStart,
    campaignWindowStartMs,
  };
}

export function calculateOwnedPlatformWindowCounts(
  posts: Array<{ postedAt: Date | string | null }>,
  lifecycle: CampaignLifecycleWindows,
  asOf: Date = new Date(),
): OwnedPlatformWindowCounts {
  const normalizedAsOf = normalizeTimestampToUtcDate(asOf) ?? new Date();
  const asOfMs = normalizedAsOf.getTime();
  const rolling30dStartMs = asOfMs - 30 * 24 * 60 * 60 * 1000;
  let postsSinceCreationCount = 0;
  let postsSinceActivationCount = 0;
  let activePlanWindowPostCount = 0;
  let rolling30dPostCount = 0;

  for (const p of posts) {
    if (!p.postedAt) continue;
    const parsedPostDate = normalizeTimestampToUtcDate(p.postedAt);
    if (!parsedPostDate) continue;
    const pMs = parsedPostDate.getTime();
    if (Number.isNaN(pMs) || pMs > asOfMs) continue;
    if (lifecycle.campaignCreatedAtMs != null && pMs >= lifecycle.campaignCreatedAtMs) {
      postsSinceCreationCount++;
    }
    if (lifecycle.initialActivatedAtMs != null && pMs >= lifecycle.initialActivatedAtMs) {
      postsSinceActivationCount++;
    }
    if (lifecycle.activePlanActivatedAtMs != null && pMs >= lifecycle.activePlanActivatedAtMs) {
      activePlanWindowPostCount++;
    }
    if (pMs >= rolling30dStartMs) {
      rolling30dPostCount++;
    }
  }

  const inWindowPostCount =
    lifecycle.initialActivatedAtMs != null
      ? postsSinceActivationCount
      : lifecycle.campaignCreatedAtMs != null
        ? postsSinceCreationCount
        : posts.length;

  return {
    storedHistoricalPostCount: posts.length,
    postsSinceCreationCount,
    postsSinceActivationCount,
    activePlanWindowPostCount,
    inWindowPostCount,
    rolling30dPostCount,
    asOf: normalizedAsOf.toISOString(),
  };
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
  postsCount?: number | null;
  isConfirmedEmpty?: boolean;
  isPartialCoverage?: boolean;
  runId?: string;
  datasetId?: string;
  usageUsd?: number;
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

  const existingOwned = await db
    .select({ id: ownedPosts.id })
    .from(ownedPosts)
    .where(
      and(
        eq(ownedPosts.accountId, accountId),
        eq(ownedPosts.campaignId, campaignId),
        eq(ownedPosts.platform, "instagram"),
      )
    );
  const existingPostCount = existingOwned.length;
  const needFullInitialSample = isFirstScrape || existingPostCount <= INITIAL_SCRAPE_MAX_POSTS;
  const maxPosts = needFullInitialSample ? INITIAL_SCRAPE_MAX_POSTS : INCREMENTAL_SCRAPE_MAX_POSTS;
  const scrapeMode: "INITIAL" | "INCREMENTAL" = needFullInitialSample ? "INITIAL" : "INCREMENTAL";

  const startMs = Date.now();
  const result = await scrapeInstagramProfile(handle, undefined, maxPosts, accountId);
  console.log(`[UserChannelScraper] Scrape complete: handle=@${handle} mode=${scrapeMode} posts=${result.posts.length} existingStored=${existingPostCount} durationMs=${Date.now() - startMs}`);

  if (result.posts.length === 0 && isBlockWarning(result.warnings)) {
    console.warn(`[UserChannelScraper] Block-like warnings for @${handle}: ${result.warnings.join(", ")} — will retry on next pacing cycle`);
  }

  // Confirmed-empty profile ONLY when provider explicitly confirmed 0 posts AND no historical posts exist:
  if (result && result.posts.length === 0 && result.isConfirmedEmpty && existingPostCount === 0) {
    return {
      snapshot: {
        platform: "instagram",
        handle,
        url: `https://www.instagram.com/${handle}/`,
        postCount: 0,
        fetchedWindowPostCount: 0,
        storedHistoricalPostCount: 0,
        accountTotalContent: result.postsCount ?? 0,
        followers: result.followers,
        recentPostTypes: {},
        avgEngagement: null,
        scrapedAt: new Date().toISOString(),
        scrapeStatus: "SUCCESS",
        isConfirmedEmpty: true,
        isPartialCoverage: false,
        scrapeMode,
      },
      posts: [],
      followers: result.followers,
      postsCount: result.postsCount ?? 0,
      isConfirmedEmpty: true,
      isPartialCoverage: false,
      runId: result.runId,
      datasetId: result.datasetId,
      usageUsd: result.usageUsd,
    };
  }

  // Partial coverage: actor resolved profile header (or we already have stored historical posts),
  // but the recent timeline edge returned 0 items. Never overwrite known historical content with 0!
  if (result && result.posts.length === 0 && (result.isPartialCoverage || existingPostCount > 0 || result.followers !== null)) {
    return {
      snapshot: {
        platform: "instagram",
        handle,
        url: `https://www.instagram.com/${handle}/`,
        postCount: existingPostCount,
        fetchedWindowPostCount: 0,
        storedHistoricalPostCount: existingPostCount,
        accountTotalContent: result.postsCount ?? null,
        followers: result.followers,
        recentPostTypes: {},
        avgEngagement: null,
        scrapedAt: new Date().toISOString(),
        scrapeStatus: "PARTIAL",
        isConfirmedEmpty: false,
        isPartialCoverage: true,
        scrapeMode,
      },
      posts: [],
      followers: result.followers,
      postsCount: result.postsCount ?? null,
      isConfirmedEmpty: false,
      isPartialCoverage: true,
      runId: result.runId,
      datasetId: result.datasetId,
      usageUsd: result.usageUsd,
    };
  }

  if (!result || (!result.success && result.posts.length === 0)) {
    return {
      snapshot: {
        platform: "instagram",
        handle,
        url: `https://www.instagram.com/${handle}/`,
        postCount: existingPostCount,
        fetchedWindowPostCount: 0,
        storedHistoricalPostCount: existingPostCount,
        accountTotalContent: null,
        followers: null, // Failed scrape residue must NOT masquerade as verified followers
        recentPostTypes: {},
        avgEngagement: null,
        scrapedAt: new Date().toISOString(),
        scrapeStatus: "FAILED",
        isConfirmedEmpty: false,
        scrapeError: result?.warnings.join("; ") || "No data retrieved",
        scrapeMode,
      },
      posts: [],
      followers: null,
      postsCount: null,
      isConfirmedEmpty: false,
      runId: result?.runId,
      datasetId: result?.datasetId,
      usageUsd: result?.usageUsd,
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
      postCount: Math.max(result.posts.length, existingPostCount),
      fetchedWindowPostCount: result.posts.length,
      storedHistoricalPostCount: Math.max(result.posts.length, existingPostCount),
      accountTotalContent: result.postsCount ?? null,
      followers: result.followers,
      recentPostTypes: typeMix,
      avgEngagement,
      engagementByType,
      scrapedAt: new Date().toISOString(),
      scrapeStatus: result.success ? "SUCCESS" : "PARTIAL",
      isConfirmedEmpty: false,
      isPartialCoverage: false,
      scrapeMode,
    },
    posts: result.posts,
    followers: result.followers,
    postsCount: result.postsCount ?? null,
    isConfirmedEmpty: false,
    isPartialCoverage: false,
    runId: result.runId,
    datasetId: result.datasetId,
    usageUsd: result.usageUsd,
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
export async function scrapeUserChannels(
  accountId: string,
  campaignId: string,
  opts: { forceRefresh?: boolean; trigger?: string; requesterEngine?: string; targetPlatforms?: string[] } = {}
): Promise<Record<string, import("./acquisition/authority").AcquisitionRequestOutcome>> {
  const outcomes: Record<string, import("./acquisition/authority").AcquisitionRequestOutcome> = {};
  const allProfiles = await db
    .select()
    .from(userPublicProfiles)
    .where(
      and(
        eq(userPublicProfiles.accountId, accountId),
        eq(userPublicProfiles.campaignId, campaignId),
      )
    );

  const targetFilter = opts.targetPlatforms?.map((p) => p.toLowerCase().trim()).filter(Boolean) || [];
  const profiles =
    targetFilter.length > 0
      ? allProfiles.filter((p) => targetFilter.includes(p.platform.toLowerCase()))
      : allProfiles;

  if (profiles.length === 0) {
    console.log(`[UserChannelScraper] No user channels configured for account=${accountId} campaign=${campaignId}`);
    return outcomes;
  }

  console.log(`[UserChannelScraper] Scraping ${profiles.length} user channel(s) for account=${accountId}`);

  const { extractHandleFromUrl } = await import("./competitive-intelligence/profile-scraper");
  const { requestAcquisition } = await import("./acquisition/authority");
  const { ACTOR_SLOTS } = await import("./acquisition/multi-source-providers");
  const lifecycle = await resolveCampaignLifecycleWindows(accountId, campaignId);

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
      const platLower = profile.platform.toLowerCase();

      if (!["instagram", "tiktok", "youtube", "linkedin", "website"].includes(platLower)) {
        console.log(`[UserChannelScraper] Platform ${profile.platform} is not monitored / unsupported for owned-channel scraping; skipping.`);
        continue;
      }

      // Determine first-scrape vs incremental for this exact channel identity
      const previousSnapshot = await getPreviousSnapshot(accountId, campaignId, profile.platform, channelKey);

      // Per-profile freshness check: skip if this exact channel's last snapshot is still fresh (unless forceRefresh).
      if (previousSnapshot && !opts.forceRefresh) {
        if (previousSnapshot.identityStatus === "UNRESOLVED") {
          console.log(
            `[UserChannelScraper] OWNED_ACCOUNT_IDENTITY_UNRESOLVED_SKIPPED platform=${profile.platform} handle=${profile.handle ?? "null"} url=${profile.url ?? "null"} — awaiting user URL update in Settings`
          );
          continue;
        }

        const degraded = await isProfileDegraded(accountId, campaignId, profile.platform, channelKey);
        const intervalMs = degraded
          ? MAX_SCRAPE_INTERVAL_MS
          : getProfileScrapeInterval(channelKey ?? (accountId + profile.platform));

        if (degraded) {
          console.warn(`[UserChannelScraper] Profile ${profile.platform}:${channelKey ?? "unknown"} is DEGRADED (3+ consecutive failures) — using ${MAX_SCRAPE_INTERVAL_MS / 3600000}h interval`);
        }

        // Enforce bounded retry backoff on FAILED / SCRAPE_EMPTY snapshots so degraded or empty owned profiles
        // do not re-scrape every hour when latestForProfile has 0 successful rows.
        if (previousSnapshot.scrapeStatus === "FAILED" && previousSnapshot.scrapedAt) {
          const prevScrapedMs = new Date(previousSnapshot.scrapedAt).getTime();
          if (!Number.isNaN(prevScrapedMs)) {
            const failureBackoffMs = degraded ? MAX_SCRAPE_INTERVAL_MS : 6 * 60 * 60 * 1000;
            if (Date.now() - prevScrapedMs < failureBackoffMs) {
              console.log(
                `[UserChannelScraper] OWNED_ACCOUNT_FAILURE_BACKOFF target=owned_account platform=${profile.platform} channel=${channelKey ?? "unknown"} ageH=${((Date.now() - prevScrapedMs) / 3600000).toFixed(1)} backoff=${Math.round(failureBackoffMs / 3600000)}h`
              );
              continue;
            }
          }
        }

        const conditions = [
          eq(userChannelSnapshots.accountId, accountId),
          eq(userChannelSnapshots.campaignId, campaignId),
          eq(userChannelSnapshots.platform, profile.platform),
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
            console.log(
              `[UserChannelScraper] OWNED_ACCOUNT_SNAPSHOT_REUSED target=owned_account platform=${profile.platform} channel=${channelKey ?? "unknown"} snapshotAgeH=${((Date.now() - latestForProfile[0].scrapedAt.getTime()) / 3600000).toFixed(1)} interval=${Math.round(intervalMs / 3600000)}h`,
            );
            continue;
          }
        }
      }
      const isFirstScrape = previousSnapshot === null;
      const isPersonalLinkedIn =
        platLower === "linkedin" &&
        (Boolean(profile.handle?.toLowerCase().startsWith("in/")) ||
          Boolean(profile.url?.toLowerCase().includes("/in/")));

      const outcome = await requestAcquisition({
        accountId,
        campaignId,
        requesterEngine: opts.requesterEngine || "OWNED_CHANNELS",
        trigger: opts.trigger || "OWNED_CHANNEL_SCRAPE",
        entityType: "OWNED",
        entityId: profile.id,
        platform: platLower === "website" ? "BUSINESS_WEBSITE" : platLower.toUpperCase(),
        canonicalUrl: profile.url || (normalizedHandle && platLower === "instagram" ? `https://www.instagram.com/${normalizedHandle}/` : null),
        externalAccountId: normalizedHandle,
        capability: "OWNED_CHANNEL_SNAPSHOT",
        ...(platLower === "linkedin"
          ? { actorId: isPersonalLinkedIn ? ACTOR_SLOTS.LINKEDIN_POSTS : ACTOR_SLOTS.LINKEDIN_COMPANY_POSTS }
          : {}),
        forceRefresh: Boolean(opts.forceRefresh),
        inputPayload: {
          ownedProfileId: profile.id,
          platform: platLower,
          handle: normalizedHandle,
          url: profile.url,
          isFirstScrape,
        },
        customExecutor: async () => {
          let snapshot: UserChannelSnapshotData;
          let scrapedPosts: import("./competitive-intelligence/profile-scraper").ScrapedPost[] = [];
          let scrapedFollowers: number | null = null;
          let runId: string | null = null;
          let datasetId: string | null = null;
          let usageUsd: number | null = null;
          let isConfirmedEmpty = false;
          let isPartialCoverage = false;

          const existingOwnedBefore = ["instagram", "youtube", "tiktok", "linkedin"].includes(platLower)
            ? await db
                .select({ id: ownedPosts.id })
                .from(ownedPosts)
                .where(
                  and(
                    eq(ownedPosts.accountId, accountId),
                    eq(ownedPosts.campaignId, campaignId),
                    eq(ownedPosts.platform, platLower),
                  )
                )
            : [];

          if (platLower === "instagram" && normalizedHandle) {
            const igResult = await scrapeInstagramChannel(accountId, campaignId, normalizedHandle, isFirstScrape);
            snapshot = igResult.snapshot;
            scrapedPosts = igResult.posts;
            scrapedFollowers = igResult.followers;
            isConfirmedEmpty = igResult.isConfirmedEmpty === true && existingOwnedBefore.length === 0;
            isPartialCoverage = igResult.isPartialCoverage === true;
            runId = igResult.runId || null;
            datasetId = igResult.datasetId || null;
            usageUsd = igResult.usageUsd ?? null;
          } else if (platLower === "tiktok" && (normalizedHandle || profile.url)) {
            const { scrapeTiktokViaApify } = await import("./competitive-intelligence/tiktok-apify-scraper");
            const { parsePostTimestamp } = await import("./performance-loop/owned-post-tracker");
            const ttHandle = (normalizedHandle || profile.url || "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "").replace(/^@/, "").split(/[/?#]/)[0];
            const ttPosts = ttHandle ? await scrapeTiktokViaApify(ttHandle) : [];
            scrapedFollowers = typeof (ttPosts[0] as any)?.authorFollowers === "number" ? (ttPosts[0] as any).authorFollowers : null;
            scrapedPosts = ttPosts.map((p: any) => {
              const parsedTs = parsePostTimestamp(p.timestamp ?? p.createTimeISO ?? p.createTime);
              return {
                postId: p.postId,
                shortcode: p.postId,
                permalink: p.permalink || `https://www.tiktok.com/@${ttHandle}/video/${p.postId}`,
                caption: p.caption || "",
                mediaType: "VIDEO" as const,
                likes: p.likes ?? 0,
                comments: p.comments ?? 0,
                views: p.views ?? 0,
                videoUrl: p.videoUrl || null,
                displayUrl: p.displayUrl || null,
                // Keep publishedAt separate from fetchedAt; never substitute fetch time for unknown publication date
                timestamp: parsedTs ? parsedTs.toISOString() : null,
              };
            });
            const avgEng = scrapedPosts.length > 0
              ? Math.round(scrapedPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) / scrapedPosts.length)
              : null;
            const effectivePostCount = Math.max(scrapedPosts.length, existingOwnedBefore.length);
            // Requirement #1: A TikTok actor returning 0 items without positive profile metadata (videoCount === 0)
            // is an inconclusive zero-result, NOT a confirmed empty account.
            isConfirmedEmpty = false;
            isPartialCoverage = scrapedPosts.length === 0 && existingOwnedBefore.length > 0;
            snapshot = {
              platform: "tiktok",
              handle: ttHandle,
              url: profile.url || `https://www.tiktok.com/@${ttHandle}`,
              postCount: effectivePostCount,
              fetchedWindowPostCount: scrapedPosts.length,
              storedHistoricalPostCount: effectivePostCount,
              accountTotalContent: null,
              followers: scrapedFollowers,
              recentPostTypes: { VIDEO: scrapedPosts.length },
              avgEngagement: avgEng,
              scrapedAt: new Date().toISOString(),
              scrapeStatus: scrapedPosts.length > 0 ? "SUCCESS" : existingOwnedBefore.length > 0 ? "PARTIAL" : "PARTIAL",
              isConfirmedEmpty,
              isPartialCoverage,
              scrapeMode: isFirstScrape ? "INITIAL" : "INCREMENTAL",
            };
          } else if (platLower === "youtube" && (profile.url || normalizedHandle)) {
            const { fetchYouTubeEvidence, normalizeYouTubeChannelUrl } = await import("./acquisition/multi-source-providers");
            const { parsePostTimestamp } = await import("./performance-loop/owned-post-tracker");
            const ytUrl = normalizeYouTubeChannelUrl(profile.url || "", normalizedHandle);
            if (ytUrl && ytUrl !== profile.url) {
              await db
                .update(userPublicProfiles)
                .set({ url: ytUrl, updatedAt: new Date() })
                .where(eq(userPublicProfiles.id, profile.id));
            }
            const needFullYouTubeSample = isFirstScrape || existingOwnedBefore.length < 35;
            const ytRes = await fetchYouTubeEvidence({
              channelUrl: ytUrl,
              campaignId,
              accountId,
              competitorId: "user_owned_channel",
              maxVideos: needFullYouTubeSample ? INITIAL_SCRAPE_MAX_POSTS : 15,
            });
            runId = ytRes.report.runId || null;
            datasetId = ytRes.report.datasetId || null;
            usageUsd = ytRes.report.usageUsd ?? null;
            scrapedFollowers = ytRes.report.channelSubscribers ?? null;
            const resolvedChannelId = ytRes.report.channelId || null;
            const resolvedChannelUrl = resolvedChannelId
              ? `https://www.youtube.com/channel/${resolvedChannelId}`
              : ytUrl;
            const resolvedChannelName = ytRes.report.channelName || null;
            const ytTypeMix: Record<string, number> = {};
            let verifiedOwnershipCount = 0;
            scrapedPosts = ytRes.items
              .filter((item: any) => {
                const itemChannelId = item.rawPayload?.channelId || null;
                if (resolvedChannelId && itemChannelId && itemChannelId !== resolvedChannelId) {
                  return false;
                }
                verifiedOwnershipCount++;
                return true;
              })
              .map((item: any, idx: number) => {
                const isShort =
                  String(item.url || "").includes("/shorts/") ||
                  String(item.rawPayload?.type || "").toLowerCase() === "shorts";
                const bucket = isShort ? "SHORTS" : "VIDEO";
                ytTypeMix[bucket] = (ytTypeMix[bucket] || 0) + 1;
                const videoId = String(item.externalId || item.id || `yt_owned_${idx}`).replace(/^yt_/, "");
                const parsedTs = parsePostTimestamp(item.publishedAt ?? item.rawPayload?.date);
                return {
                  postId: videoId,
                  shortcode: videoId,
                  permalink: item.url || ytUrl,
                  caption: [item.title, item.text || item.content].filter(Boolean).join(" — "),
                  mediaType: "VIDEO" as const,
                  likes: item.engagementMetrics?.likes ?? null,
                  comments: item.engagementMetrics?.comments ?? null,
                  views: item.engagementMetrics?.views ?? null,
                  videoUrl: item.url || null,
                  displayUrl: null,
                  // Never replace an unknown publication date with fetch time
                  timestamp: parsedTs ? parsedTs.toISOString() : null,
                };
              });
            const avgEng = scrapedPosts.length > 0
              ? Math.round(scrapedPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) / scrapedPosts.length)
              : null;
            const effectivePostCount = Math.max(scrapedPosts.length, existingOwnedBefore.length);
            isConfirmedEmpty =
              !ytRes.report.error &&
              scrapedPosts.length === 0 &&
              existingOwnedBefore.length === 0 &&
              ytRes.report.channelTotalVideos === 0;
            isPartialCoverage = !ytRes.report.error && scrapedPosts.length === 0 && existingOwnedBefore.length > 0;
            snapshot = {
              platform: "youtube",
              handle: normalizedHandle,
              url: ytUrl,
              channelId: resolvedChannelId,
              channelUrl: resolvedChannelUrl,
              channelName: resolvedChannelName,
              verifiedChannelOwnershipCount: Math.max(verifiedOwnershipCount, effectivePostCount),
              postCount: effectivePostCount,
              fetchedWindowPostCount: scrapedPosts.length,
              storedHistoricalPostCount: effectivePostCount,
              accountTotalContent: ytRes.report.channelTotalVideos ?? null,
              accountTotalDisplay: ytRes.report.channelTotalVideos ?? "UNKNOWN",
              identityStatus: "CONFIRMED",
              followers: scrapedFollowers,
              recentPostTypes: ytTypeMix,
              avgEngagement: avgEng,
              scrapedAt: new Date().toISOString(),
              scrapeStatus: ytRes.report.error ? "FAILED" : isPartialCoverage ? "PARTIAL" : "SUCCESS",
              isConfirmedEmpty,
              isPartialCoverage,
              scrapeError: ytRes.report.error || undefined,
              scrapeMode: needFullYouTubeSample ? "INITIAL" : "INCREMENTAL",
            };
          } else if (platLower === "linkedin") {
            const { parseLinkedInIdentity, fetchLinkedInEvidence } = await import("./acquisition/multi-source-providers");
            const { parsePostTimestamp } = await import("./performance-loop/owned-post-tracker");
            const candidateLiUrl = profile.url || profile.handle || "";
            const liIdentity = parseLinkedInIdentity(candidateLiUrl);
            if (!liIdentity.valid || normalizedHandle === "company" || normalizedHandle === "in") {
              // NEVER erase a saved URL/handle on userPublicProfiles when identity is unresolved or acquisition fails.
              snapshot = {
                platform: "linkedin",
                handle: profile.handle,
                url: profile.url,
                accountType: liIdentity.kind,
                postCount: 0,
                fetchedWindowPostCount: 0,
                storedHistoricalPostCount: 0,
                inWindowPostCount: 0,
                rolling30dPostCount: 0,
                accountTotalContent: null,
                accountTotalDisplay: "UNKNOWN",
                identityStatus: "UNRESOLVED",
                followers: null,
                recentPostTypes: {},
                avgEngagement: null,
                scrapedAt: new Date().toISOString(),
                scrapeStatus: "SKIPPED",
                isConfirmedEmpty: false,
                isPartialCoverage: false,
                scrapeError:
                  liIdentity.error ||
                  `SOURCE_INVALID: Incomplete LinkedIn URL (${profile.url || profile.handle || "https://linkedin.com/company"}). Please enter the full /company/<slug> or /in/<slug> URL in Settings.`,
                scrapeMode: isFirstScrape ? "INITIAL" : "INCREMENTAL",
              };
            } else {
              // Normalize stored handle/url on userPublicProfiles if needed
              if (profile.handle !== liIdentity.handle || profile.url !== liIdentity.canonicalUrl) {
                await db
                  .update(userPublicProfiles)
                  .set({
                    handle: liIdentity.handle,
                    url: liIdentity.canonicalUrl,
                    updatedAt: new Date(),
                  })
                  .where(eq(userPublicProfiles.id, profile.id));
              }

              let profileDossier: any = null;
              let profileUsageUsd = 0;
              let profileRunId: string | null = null;
              let profileActorId: string | null = null;
              let profileError: string | null = null;
              if (liIdentity.kind === "company") {
                try {
                  const profRes = await fetchLinkedInEvidence({
                    profileUrl: liIdentity.canonicalUrl,
                    campaignId,
                    accountId,
                    competitorId: "user_owned_channel",
                    capability: "PROFILE",
                  });
                  profileDossier = profRes.report.profileDossier || null;
                  profileRunId = profRes.report.runId || null;
                  profileActorId = profRes.report.actorId || null;
                  profileError = profRes.report.error || null;
                  if (typeof profRes.report.usageUsd === "number") {
                    profileUsageUsd += profRes.report.usageUsd;
                  }
                  if (typeof profileDossier?.followerCount === "number") {
                    scrapedFollowers = profileDossier.followerCount;
                  }
                } catch (profErr: any) {
                  profileError = profErr?.message || String(profErr);
                  console.warn(`[UserChannelScraper] Non-fatal LinkedIn company profile fetch warning: ${profileError}`);
                }
              }

              const liRes = await fetchLinkedInEvidence({
                profileUrl: liIdentity.canonicalUrl,
                campaignId,
                accountId,
                competitorId: "user_owned_channel",
                capability: "POSTS",
                maxPosts: isFirstScrape ? 20 : 10,
              });
              runId = liRes.report.runId || profileRunId || null;
              datasetId = liRes.report.datasetId || null;
              usageUsd = (liRes.report.usageUsd ?? 0) + profileUsageUsd || null;
              const rawFirst = liRes.items[0]?.rawPayload as any;
              if (scrapedFollowers === null && typeof rawFirst?.followerCount === "number") {
                scrapedFollowers = rawFirst.followerCount;
              }

              scrapedPosts = liRes.items.map((item: any, idx: number) => {
                const postId = String(item.externalId || item.id || `li_owned_${idx}`).replace(/^li_/, "");
                const parsedTs = parsePostTimestamp(item.publishedAt ?? item.rawPayload?.postedAt?.timestamp ?? item.rawPayload?.postedAt?.date);
                return {
                  postId,
                  shortcode: postId,
                  permalink: item.url || liIdentity.canonicalUrl,
                  caption: [item.title, item.text || item.content].filter(Boolean).join(" — "),
                  mediaType: "IMAGE" as const,
                  likes: item.engagementMetrics?.likes ?? null,
                  comments: item.engagementMetrics?.comments ?? null,
                  views: item.engagementMetrics?.views ?? null,
                  videoUrl: null,
                  displayUrl: null,
                  timestamp: parsedTs ? parsedTs.toISOString() : null,
                };
              });

              const avgEng =
                scrapedPosts.length > 0
                  ? Math.round(
                      scrapedPosts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0), 0) /
                        scrapedPosts.length
                    )
                  : null;
              const effectivePostCount = Math.max(scrapedPosts.length, existingOwnedBefore.length);
              const combinedError =
                liRes.report.error ||
                (scrapedPosts.length === 0 && !profileDossier && profileError ? profileError : undefined);
              isConfirmedEmpty =
                !combinedError &&
                existingOwnedBefore.length === 0 &&
                scrapedPosts.length === 0 &&
                (liRes.report.isConfirmedEmpty === true || profileDossier !== null);
              isPartialCoverage = !combinedError && scrapedPosts.length === 0 && existingOwnedBefore.length > 0;

              snapshot = {
                platform: "linkedin",
                handle: liIdentity.handle,
                url: liIdentity.canonicalUrl,
                accountType: liIdentity.kind,
                channelId: profileDossier?.companyId || liIdentity.slug,
                channelUrl: liIdentity.canonicalUrl,
                channelName: profileDossier?.name || liRes.items[0]?.authorName || liIdentity.slug,
                postCount: effectivePostCount,
                fetchedWindowPostCount: scrapedPosts.length,
                storedHistoricalPostCount: effectivePostCount,
                accountTotalContent: null,
                accountTotalDisplay: "UNKNOWN",
                identityStatus: "CONFIRMED",
                followers: scrapedFollowers,
                recentPostTypes: { POST: scrapedPosts.length },
                avgEngagement: avgEng,
                scrapedAt: new Date().toISOString(),
                scrapeStatus: combinedError ? "FAILED" : isPartialCoverage ? "PARTIAL" : "SUCCESS",
                isConfirmedEmpty,
                isPartialCoverage,
                scrapeError: combinedError,
                scrapeMode: isFirstScrape ? "INITIAL" : "INCREMENTAL",
                profileDossier,
                profileRunId,
                postsRunId: liRes.report.runId || null,
                profileActorId,
                postsActorId: liRes.report.actorId || null,
              };
            }
          } else {
            snapshot = await scrapeWebsiteChannel(profile.url!, isFirstScrape, accountId);
          }

          if (typeof scrapedFollowers === "number" && scrapedFollowers >= 0) {
            await db
              .update(userPublicProfiles)
              .set({ followersCount: scrapedFollowers, updatedAt: new Date() })
              .where(eq(userPublicProfiles.id, profile.id));
          }

          // P-2: owned-account scrape failures must be loud and classified.
          if (snapshot.scrapeStatus === "FAILED") {
            console.error(
              `[UserChannelScraper] OWNED_ACCOUNT_SCRAPE_FAILED target=owned_account platform=${profile.platform} channel=${channelKey ?? "unknown"} error=${snapshot.scrapeError ?? "unknown"}`,
            );
          }

          const delta = computeDelta(snapshot, previousSnapshot);

          // ── DB write only — no engine calls ────────────────────────────────
          const snapshotRows = await db.insert(userChannelSnapshots).values({
            accountId,
            campaignId,
            platform: profile.platform,
            handle: channelKey,
            snapshotData: JSON.stringify(snapshot),
            deltaFromPrevious: JSON.stringify(delta),
            scrapedAt: new Date(),
          }).returning({ id: userChannelSnapshots.id });

          // ── P-2: persist per-post records + lineage for Instagram, YouTube, TikTok, and LinkedIn ──
          let ownedPostIds: string[] = [];
          if (["instagram", "youtube", "tiktok", "linkedin"].includes(platLower) && scrapedPosts.length > 0) {
            const { recordOwnedPostObservations } = await import("./performance-loop/owned-post-tracker");
            const { resolveOwnedPostLineage } = await import("./performance-loop/lineage-resolver");
            const tracked = await recordOwnedPostObservations({
              accountId,
              campaignId,
              ownedProfileId: profile.id,
              platform: platLower,
              posts: scrapedPosts,
              followers: scrapedFollowers,
              scrapeSnapshotId: snapshotRows[0]?.id ?? null,
            });
            ownedPostIds = tracked.ownedPostIds;
            if (tracked.ownedPostIds.length > 0) {
              const lineage = await resolveOwnedPostLineage(accountId, campaignId, tracked.ownedPostIds);
              console.log(
                `[UserChannelScraper] Lineage resolved for ${lineage.processed} owned post(s): ` +
                Object.entries(lineage.byState).filter(([, n]) => n > 0).map(([s, n]) => `${s}=${n}`).join(" "),
              );
              try {
                const { classifyOwnedPosts } = await import("./performance-loop/owned-post-classifier");
                await classifyOwnedPosts({ accountId, campaignId, ownedPostIds: tracked.ownedPostIds });
              } catch (classifyErr: any) {
                console.error(`[UserChannelScraper] Owned-post classification batch failed:`, classifyErr?.message ?? classifyErr);
              }
            }
          }

          // Reconcile storedHistoricalPostCount after upsert so snapshotData always reflects exact unique DB count
          if (["instagram", "youtube", "tiktok", "linkedin"].includes(platLower) && snapshot.identityStatus !== "UNRESOLVED") {
            const allStoredForPlatform = await db
              .select({ id: ownedPosts.id, postedAt: ownedPosts.postedAt })
              .from(ownedPosts)
              .where(
                and(
                  eq(ownedPosts.accountId, accountId),
                  eq(ownedPosts.campaignId, campaignId),
                  eq(ownedPosts.platform, platLower),
                )
              );
            const totalUniqueStored = allStoredForPlatform.length;
            const windowCounts = calculateOwnedPlatformWindowCounts(allStoredForPlatform, lifecycle);
            if (ownedPostIds.length === 0 && totalUniqueStored > 0) {
              ownedPostIds = allStoredForPlatform.map((r) => r.id);
            }
            snapshot.storedHistoricalPostCount = totalUniqueStored;
            snapshot.fetchedWindowPostCount = scrapedPosts.length;
            snapshot.postsSinceCreationCount = windowCounts.postsSinceCreationCount;
            snapshot.postsSinceActivationCount = windowCounts.postsSinceActivationCount;
            snapshot.activePlanWindowPostCount = windowCounts.activePlanWindowPostCount;
            snapshot.inWindowPostCount = windowCounts.inWindowPostCount;
            snapshot.rolling30dPostCount = windowCounts.rolling30dPostCount;
            snapshot.campaignCreatedAt = lifecycle.campaignCreatedAt;
            snapshot.campaignActivatedAt = lifecycle.initialActivatedAt;
            snapshot.activePlanActivatedAt = lifecycle.activePlanActivatedAt;
            snapshot.campaignWindowStart = lifecycle.campaignWindowStart;
            snapshot.accountTotalDisplay = snapshot.accountTotalContent ?? "UNKNOWN";
            snapshot.identityStatus = snapshot.identityStatus || "CONFIRMED";
            snapshot.postCount = Math.max(scrapedPosts.length, totalUniqueStored);
            if (totalUniqueStored > 0) {
              snapshot.isConfirmedEmpty = false;
              isConfirmedEmpty = false;
            }
            if (snapshotRows[0]?.id) {
              await db
                .update(userChannelSnapshots)
                .set({ snapshotData: JSON.stringify(snapshot) })
                .where(eq(userChannelSnapshots.id, snapshotRows[0].id));
            }
          }

          console.log(
            `[UserChannelScraper] Snapshot saved: platform=${profile.platform} handle=${channelKey || profile.url} ` +
            `mode=${snapshot.scrapeMode} fetched=${scrapedPosts.length} storedTotal=${snapshot.postCount} status=${snapshot.scrapeStatus} ` +
            `newPosts=${delta.newPostsSinceLastSnapshot} engDelta=${delta.avgEngagementDelta}`
          );

          if (snapshot.scrapeStatus === "SKIPPED") {
            return {
              status: "FAILED",
              providerRunId: runId,
              datasetId,
              usageUsd,
              itemsStored: 0,
              error: snapshot.scrapeError || "SOURCE_INVALID: Owned channel identity unresolved",
              output: { snapshotId: snapshotRows[0]?.id ?? null, snapshot },
            };
          }

          if (snapshot.scrapeStatus === "FAILED") {
            return {
              status: "FAILED",
              providerRunId: runId,
              datasetId,
              usageUsd,
              itemsStored: 0,
              error: snapshot.scrapeError || "Owned channel scrape failed",
              output: { snapshotId: snapshotRows[0]?.id ?? null, snapshot },
            };
          }

          return {
            status:
              snapshot.postCount === 0
                ? isConfirmedEmpty
                  ? "EMPTY_CONFIRMED"
                  : isPartialCoverage && scrapedPosts.length === 0
                    ? "PARTIAL_COVERAGE"
                    : "EMPTY_INCONCLUSIVE"
                : "COMPLETED",
            providerRunId: runId,
            datasetId,
            usageUsd,
            itemsStored: snapshot.postCount,
            isConfirmedEmpty,
            isPartialCoverage,
            normalizedEvidenceIds: ownedPostIds.length > 0 ? ownedPostIds : snapshotRows[0]?.id ? [snapshotRows[0].id] : [],
            rawPayload: {
              snapshot,
              fetchedWindowPostCount: scrapedPosts.length,
              storedHistoricalPostCount: snapshot.storedHistoricalPostCount ?? snapshot.postCount,
              accountTotalContent: snapshot.accountTotalContent ?? null,
            },
            output: {
              snapshotId: snapshotRows[0]?.id ?? null,
              postsStored: snapshot.postCount,
              fetchedWindowPosts: scrapedPosts.length,
              storedHistoricalPosts: snapshot.storedHistoricalPostCount ?? snapshot.postCount,
              accountTotalContent: snapshot.accountTotalContent ?? null,
              ownedPostIds,
              isConfirmedEmpty,
              isPartialCoverage,
              runId,
              datasetId,
              usageUsd,
            },
          };
        },
      });
      if (outcome.resolutionType === "CACHE_REUSE" && !previousSnapshot) {
        try {
          const sharedConditions = [
            eq(userChannelSnapshots.accountId, accountId),
            eq(userChannelSnapshots.platform, profile.platform),
            sql`(${userChannelSnapshots.snapshotData}::json->>'scrapeStatus') IS DISTINCT FROM 'FAILED'`,
          ];
          if (channelKey) sharedConditions.push(eq(userChannelSnapshots.handle, channelKey));
          const [sharedSnap] = await db
            .select()
            .from(userChannelSnapshots)
            .where(and(...sharedConditions))
            .orderBy(desc(userChannelSnapshots.scrapedAt))
            .limit(1);

          if (sharedSnap?.snapshotData) {
            const parsedSnap = JSON.parse(sharedSnap.snapshotData);
            parsedSnap.reusedFromCampaignId = sharedSnap.campaignId;
            parsedSnap.dataReuseStatus = "REUSED_FROM_CACHE";
            await db.insert(userChannelSnapshots).values({
              accountId,
              campaignId,
              platform: profile.platform,
              handle: channelKey,
              snapshotData: JSON.stringify(parsedSnap),
              deltaFromPrevious: sharedSnap.deltaFromPrevious,
              scrapedAt: sharedSnap.scrapedAt || new Date(),
            });
            if (typeof parsedSnap.followers === "number" && parsedSnap.followers >= 0) {
              await db
                .update(userPublicProfiles)
                .set({ followersCount: parsedSnap.followers, isVerified: true, updatedAt: new Date() })
                .where(eq(userPublicProfiles.id, profile.id));
            }
          }
        } catch (reuseErr: any) {
          console.warn(`[UserChannelScraper] Non-fatal shared snapshot copy error:`, reuseErr?.message || reuseErr);
        }
      }
      outcomes[platLower] = outcome;
    } catch (err: any) {
      console.error(`[UserChannelScraper] Failed for profile ${profile.id}:`, err.message);
    }
  }
  return outcomes;
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

  const { parseLinkedInIdentity } = await import("./acquisition/multi-source-providers");
  const cutoff = Date.now() - MIN_SCRAPE_INTERVAL_MS;

  for (const profile of profiles) {
    if (profile.platform.toLowerCase() === "linkedin") {
      const liId = parseLinkedInIdentity(profile.url || profile.handle || "");
      if (!liId.valid) continue;
    }
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

/**
 * Returns the verified/provenance-tracked owned business channels for an account and campaign.
 * 
 * Rules:
 * - A successful fresh scrape: metricStatus = VERIFIED, metricSource = SCRAPE
 * - A user-confirmed metric: metricStatus = USER_CONFIRMED, metricSource = USER_INPUT
 * - A previously verified metric whose fresh scrape failed: metricStatus = STALE, metricSource = PRIOR_VERIFIED_SNAPSHOT
 * - A failed scrape with no trustworthy metric source: followers = null, metricStatus = FAILED or UNAVAILABLE, metricSource = NONE
 */
export async function getOwnedChannelsForCampaign(
  accountId: string,
  campaignId: string,
  userTruthMetrics?: Record<string, number>
): Promise<import("./strategy/channel-selection/types").OwnedChannelContext[]> {
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
    return [];
  }

  const { extractHandleFromUrl } = await import("./competitive-intelligence/profile-scraper");
  const { parseLinkedInIdentity } = await import("./acquisition/multi-source-providers");
  const lifecycle = await resolveCampaignLifecycleWindows(accountId, campaignId);
  const ownedChannels: import("./strategy/channel-selection/types").OwnedChannelContext[] = [];

  for (const profile of profiles) {
    const normalizedHandle: string | null =
      profile.platform === "instagram" && profile.handle
        ? extractHandleFromUrl(profile.handle)
        : profile.handle;

    const channelKey: string | null = normalizedHandle ?? profile.url ?? null;

    // Fetch all historical snapshots for this profile ordered newest first
    const conditions = [
      eq(userChannelSnapshots.accountId, accountId),
      eq(userChannelSnapshots.campaignId, campaignId),
      eq(userChannelSnapshots.platform, profile.platform),
    ];
    if (channelKey) conditions.push(eq(userChannelSnapshots.handle, channelKey));

    const snaps = await db
      .select()
      .from(userChannelSnapshots)
      .where(and(...conditions))
      .orderBy(desc(userChannelSnapshots.scrapedAt))
      .limit(10);

    const latestSnap = snaps[0] || null;
    let latestData: UserChannelSnapshotData | null = null;
    if (latestSnap?.snapshotData) {
      try {
        latestData = JSON.parse(latestSnap.snapshotData);
      } catch {
        latestData = null;
      }
    }

    // Find any prior snapshot that was actually SUCCESS or PARTIAL with a valid non-null follower count
    const priorVerifiedSnap = snaps.find((s) => {
      try {
        const d = s.snapshotData ? JSON.parse(s.snapshotData) : null;
        return d && (d.scrapeStatus === "SUCCESS" || d.scrapeStatus === "PARTIAL") && typeof d.followers === "number" && d.followers > 0;
      } catch {
        return false;
      }
    });

    let priorVerifiedData: UserChannelSnapshotData | null = null;
    if (priorVerifiedSnap?.snapshotData) {
      try {
        priorVerifiedData = JSON.parse(priorVerifiedSnap.snapshotData);
      } catch {
        priorVerifiedData = null;
      }
    }

    const storedPlatformPosts = await db
      .select({
        id: ownedPosts.id,
        postedAt: ownedPosts.postedAt,
      })
      .from(ownedPosts)
      .where(
        and(
          eq(ownedPosts.accountId, accountId),
          eq(ownedPosts.campaignId, campaignId),
          eq(ownedPosts.platform, profile.platform.toLowerCase()),
        )
      );

    const windowCounts = calculateOwnedPlatformWindowCounts(storedPlatformPosts, lifecycle);
    const inWindowPostCount = windowCounts.inWindowPostCount;
    const rolling30dPostCount = windowCounts.rolling30dPostCount;

    const storedHistoricalPostCount = Math.max(
      latestData?.storedHistoricalPostCount ?? 0,
      storedPlatformPosts.length
    );
    const fetchedWindowPostCount =
      latestData?.fetchedWindowPostCount ?? latestData?.postCount ?? storedPlatformPosts.length;
    const accountTotalContent =
      typeof latestData?.accountTotalContent === "number" ? latestData.accountTotalContent : null;
    const accountTotalDisplay: number | "UNKNOWN" =
      accountTotalContent !== null ? accountTotalContent : "UNKNOWN";

    const isUnresolvedLinkedIn =
      profile.platform.toLowerCase() === "linkedin" &&
      !parseLinkedInIdentity(profile.url || profile.handle || "").valid;
    const identityStatus: import("./strategy/channel-selection/types").IdentityStatus = isUnresolvedLinkedIn
      ? "UNRESOLVED"
      : "CONFIRMED";
    let metricStatus: import("./strategy/channel-selection/types").MetricStatus = "UNAVAILABLE";
    let metricSource: import("./strategy/channel-selection/types").MetricSource = "NONE";
    let followers: number | null = null;
    let followersObservedAt: string | null = null;

    const userTruthValue = userTruthMetrics?.[normalizedHandle || ""] ?? userTruthMetrics?.[profile.platform];

    if (typeof userTruthValue === "number" && userTruthValue > 0) {
      // User explicitly confirmed/input the follower metric
      metricStatus = "USER_CONFIRMED";
      metricSource = "USER_INPUT";
      followers = userTruthValue;
      followersObservedAt = new Date().toISOString();
    } else if (latestData && (latestData.scrapeStatus === "SUCCESS" || latestData.scrapeStatus === "PARTIAL") && typeof latestData.followers === "number") {
      const isFresh = latestSnap.scrapedAt ? (Date.now() - latestSnap.scrapedAt.getTime() < 30 * 24 * 60 * 60 * 1000) : false;
      metricStatus = isFresh ? "VERIFIED" : "STALE";
      metricSource = "SCRAPE";
      followers = latestData.followers;
      followersObservedAt = latestData.scrapedAt;
    } else if (priorVerifiedData && typeof priorVerifiedData.followers === "number") {
      metricStatus = "STALE";
      metricSource = "PRIOR_VERIFIED_SNAPSHOT";
      followers = priorVerifiedData.followers;
      followersObservedAt = priorVerifiedData.scrapedAt;
    } else {
      // Scrape failed or empty, with no verified prior snapshot
      metricStatus = latestData ? "FAILED" : "UNAVAILABLE";
      metricSource = "NONE";
      followers = null;
      followersObservedAt = null;
    }

    ownedChannels.push({
      platform: profile.platform,
      handle: normalizedHandle || profile.handle,
      url: profile.url || (normalizedHandle ? `https://www.instagram.com/${normalizedHandle}/` : null),
      channelId: latestData?.channelId ?? null,
      channelUrl: latestData?.channelUrl ?? null,
      channelName: latestData?.channelName ?? null,
      verifiedChannelOwnershipCount: latestData?.verifiedChannelOwnershipCount ?? (profile.platform.toLowerCase() === "youtube" ? storedPlatformPosts.length : undefined),
      identityStatus,
      metricStatus,
      metricSource,
      followers,
      followersObservedAt,
      existingAudienceSize: followers,
      campaignId,
      accountId,
      recentPostCount: storedHistoricalPostCount,
      storedHistoricalPostCount,
      fetchedWindowPostCount,
      postsSinceCreationCount: windowCounts.postsSinceCreationCount,
      postsSinceActivationCount: windowCounts.postsSinceActivationCount,
      activePlanWindowPostCount: windowCounts.activePlanWindowPostCount,
      inWindowPostCount,
      rolling30dPostCount,
      campaignCreatedAt: lifecycle.campaignCreatedAt,
      campaignActivatedAt: lifecycle.initialActivatedAt,
      activePlanActivatedAt: lifecycle.activePlanActivatedAt,
      campaignWindowStart: lifecycle.campaignWindowStart,
      accountTotalContent,
      accountTotalDisplay,
      avgEngagement: latestData?.avgEngagement ?? null,
    } as any);
  }

  return ownedChannels;
}

