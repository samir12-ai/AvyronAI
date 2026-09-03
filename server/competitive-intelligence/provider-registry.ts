/**
 * Platform Provider Registry & Source Capability Contract
 * 
 * Unified capability contract and dispatch router across all supported competitor platforms:
 * - WEBSITE
 * - INSTAGRAM
 * - TIKTOK
 * - LINKEDIN
 * - X
 * - YOUTUBE
 * - REVIEWS (Google Reviews / Trustpilot)
 * - GOOGLE_SEARCH
 * - BLOG
 */

import { db } from "../db";
import { competitorSources } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scrapeInstagramViaApify } from "./instagram-apify-scraper";
import { scrapeInstagramCommentsViaActor } from "../acquisition/instagram-comments";
import { scrapeTiktokViaApify, extractTiktokHandle } from "./tiktok-apify-scraper";
import { runCompetitorWebsiteCrawler } from "./competitor-crawler";
import { scrapeBlog } from "../market-intelligence-v3/website-scraper";
import { 
  fetchGoogleSearchEvidence, 
  fetchLinkedInEvidence, 
  fetchXEvidence, 
  fetchYouTubeEvidence, 
  fetchReviewsViaApify,
  persistExternalEvidenceToDb
} from "../acquisition/multi-source-providers";

export type PlatformCapability = "DISCOVERY" | "VERIFICATION" | "FETCH" | "COMMENTS" | "MEDIA" | "RECURRING_MONITORING";

export interface PlatformCapabilities {
  platform: string;
  discovery: boolean;
  verification: boolean;
  fetch: boolean;
  comments: boolean;
  media: boolean;
  recurringMonitoring: boolean;
  status: "PRODUCTION_READY" | "PROVIDER_PENDING" | "DISABLED";
  providerDescription: string;
}

export const PLATFORM_PROVIDER_CAPABILITIES: Record<string, PlatformCapabilities> = {
  WEBSITE: {
    platform: "WEBSITE",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Playwright Chromium Headless Crawler with HTML extraction",
  },
  INSTAGRAM: {
    platform: "INSTAGRAM",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify instagram-profile-scraper & instagram-comment-scraper",
  },
  TIKTOK: {
    platform: "TIKTOK",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify clockworks~free-tiktok-scraper",
  },
  LINKEDIN: {
    platform: "LINKEDIN",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify apimaestro~linkedin-profile-posts",
  },
  X: {
    platform: "X",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify apidojo~tweet-scraper",
  },
  YOUTUBE: {
    platform: "YOUTUBE",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify streamers~youtube-scraper",
  },
  REVIEWS: {
    platform: "REVIEWS",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify compass~google-maps-reviews-scraper & apify~trustpilot-scraper",
  },
  GOOGLE_SEARCH: {
    platform: "GOOGLE_SEARCH",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify apify~google-search-scraper",
  },
  BLOG: {
    platform: "BLOG",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Native HTML blog extractor & RSS reader",
  },
};

export type SourceFetchStatus = 
  | "SUCCESS"
  | "SUCCESS_ZERO_CONTENT"
  | "SOURCE_INVALID"
  | "PROVIDER_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "BLOCKED_BY_PLATFORM"
  | "UNSUPPORTED"
  | "SKIPPED_FRESH_CACHE"
  | "FETCH_SUCCESS"
  | "FETCH_FAILED"
  | "NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "NOT_SUPPORTED";

export interface SourceFetchExecutionResult {
  sourceId: string;
  platform: string;
  status: SourceFetchStatus;
  itemsCount: number;
  commentsCount: number;
  durationMs: number;
  error?: string | null;
}

/**
 * Generic future-proof execution loop for any verified competitor source.
 * 
 * Constitutional Invariants:
 * 1. Authority Model: ci_competitors owns competitor identity; competitor_sources owns source identity.
 * 2. Source Verification Immutability: Ordinary fetches NEVER update lastVerifiedAt; only lastFetchedAt is updated.
 * 3. Error Resilience: A provider failure MUST NOT invalidate or change status of a verified canonical source.
 * 4. Append-Safe Persistence: Persisted posts, comments, and reviews use idempotent on-conflict keys.
 */
export async function executeSourceFetch(opts: {
  sourceId: string;
  competitorId: string;
  accountId: string;
  campaignId: string;
  platform: string;
  canonicalUrl: string;
}): Promise<SourceFetchExecutionResult> {
  const { sourceId, competitorId, accountId, campaignId, platform, canonicalUrl } = opts;
  const startedAt = Date.now();
  const upperPlat = platform.toUpperCase();
  const cap = PLATFORM_PROVIDER_CAPABILITIES[upperPlat];

  if (!cap || !cap.fetch) {
    return {
      sourceId,
      platform,
      status: "UNSUPPORTED",
      itemsCount: 0,
      commentsCount: 0,
      durationMs: Date.now() - startedAt,
      error: `Platform ${platform} is not supported for automated fetch.`,
    };
  }

  if (cap.status === "PROVIDER_PENDING" || cap.status === "DISABLED") {
    return {
      sourceId,
      platform,
      status: "PROVIDER_UNAVAILABLE",
      itemsCount: 0,
      commentsCount: 0,
      durationMs: Date.now() - startedAt,
      error: `Provider for ${platform} is in ${cap.status} status.`,
    };
  }

  try {
    let itemsCount = 0;
    let commentsCount = 0;
    let explicitError: string | null = null;
    let explicitStatus: SourceFetchStatus | null = null;

    switch (upperPlat) {
      case "WEBSITE": {
        const snapCount = await runCompetitorWebsiteCrawler(accountId, campaignId, competitorId, canonicalUrl, 6);
        itemsCount = typeof snapCount === "number" ? snapCount : 1;
        break;
      }
      case "INSTAGRAM": {
        const handleMatch = canonicalUrl.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/);
        const handle = handleMatch ? handleMatch[1] : null;
        if (!handle) {
          explicitStatus = "SOURCE_INVALID";
          explicitError = `Invalid Instagram URL: ${canonicalUrl}`;
          break;
        }
        const igRes = await scrapeInstagramViaApify(handle, 15);
        itemsCount = igRes.posts.length;
        break;
      }
      case "TIKTOK": {
        const handle = extractTiktokHandle(canonicalUrl);
        if (!handle || handle.length < 2) {
          explicitStatus = "SOURCE_INVALID";
          explicitError = `Invalid TikTok handle/URL: ${canonicalUrl}`;
          break;
        }

        const ttPosts = await scrapeTiktokViaApify(handle);
        itemsCount = ttPosts.length;

        // Persist TikTok posts to ci_competitor_posts
        const { ciCompetitorPosts, ciCompetitorComments } = await import("@shared/schema");
        for (const post of ttPosts) {
          const postDbId = `post_tt_${competitorId}_${post.postId}`.slice(0, 60);
          try {
            await db.insert(ciCompetitorPosts).values({
              id: postDbId,
              competitorId,
              accountId,
              postId: post.postId,
              platform: "tiktok",
              permalink: post.permalink || null,
              mediaType: "VIDEO",
              caption: post.caption,
              likes: post.likes ?? null,
              comments: post.comments ?? null,
              views: post.views ?? null,
              hashtags: post.hashtags ? post.hashtags.join(",") : null,
              timestamp: post.timestamp || new Date(),
              hookText: post.hookText || null,
              hookSource: post.hookSource || null,
              transcript: post.transcript || null,
              batchId: `tt_${Date.now()}`,
            } as any).onConflictDoUpdate({
              target: [ciCompetitorPosts.competitorId, ciCompetitorPosts.postId],
              set: {
                caption: post.caption,
                likes: post.likes ?? null,
                comments: post.comments ?? null,
                views: post.views ?? null,
                transcript: post.transcript || null,
              }
            });
          } catch (pErr: any) {
            console.warn(`[ProviderRegistry] TikTok post insert error:`, pErr.message);
          }

          // Persist topComments to ci_competitor_comments if available
          if (Array.isArray(post.topComments) && post.topComments.length > 0) {
            for (const c of post.topComments) {
              try {
                const commentDbId = `comm_tt_${c.commentId}`.slice(0, 60);
                await db.insert(ciCompetitorComments).values({
                  id: commentDbId,
                  competitorId,
                  accountId,
                  postId: post.postId,
                  commentId: c.commentId,
                  username: c.username,
                  commentText: c.text,
                  likesCount: c.likes ?? null,
                  repliesCount: c.replyCount ?? null,
                  timestamp: c.timestamp || new Date(),
                  isSynthetic: false,
                  source: "tiktok_scrape",
                  authorType: "customer",
                } as any).onConflictDoNothing();
                commentsCount++;
              } catch (cErr: any) {
                console.warn(`[ProviderRegistry] TikTok comment insert error:`, cErr.message);
              }
            }
          }
        }
        break;
      }
      case "LINKEDIN": {
        const liRes = await fetchLinkedInEvidence({
          profileUrl: canonicalUrl,
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = liRes.items.length;
        if (itemsCount > 0) {
          await persistExternalEvidenceToDb(liRes.items);
        }
        if (liRes.report.error) {
          explicitError = liRes.report.error;
          explicitStatus = "PROVIDER_FAILED";
        }
        break;
      }
      case "X": {
        const handleMatch = canonicalUrl.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
        const handle = handleMatch ? handleMatch[1] : null;
        if (handle) {
          const xRes = await fetchXEvidence({
            handle,
            campaignId,
            accountId,
            competitorId,
          });
          itemsCount = xRes.items.length;
          if (itemsCount > 0) {
            await persistExternalEvidenceToDb(xRes.items);
          }
          if (xRes.report.error) {
            explicitError = xRes.report.error;
            explicitStatus = "PROVIDER_FAILED";
          }
        }
        break;
      }
      case "YOUTUBE": {
        const ytRes = await fetchYouTubeEvidence({
          channelUrl: canonicalUrl,
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = ytRes.items.length;
        if (itemsCount > 0) {
          await persistExternalEvidenceToDb(ytRes.items);
        }
        if (ytRes.report.error) {
          explicitError = ytRes.report.error;
          explicitStatus = "PROVIDER_FAILED";
        }
        break;
      }
      case "REVIEWS": {
        const isTrustpilot = canonicalUrl.includes("trustpilot.com");
        const revRes = await fetchReviewsViaApify({
          targetUrl: canonicalUrl,
          platformType: isTrustpilot ? "trustpilot" : "google_maps",
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = revRes.reviews.length;
        commentsCount = revRes.reviews.length;
        if (revRes.report.error) {
          explicitError = revRes.report.error;
          explicitStatus = "PROVIDER_FAILED";
        }
        break;
      }
      case "GOOGLE_SEARCH": {
        const gRes = await fetchGoogleSearchEvidence({
          query: canonicalUrl.replace(/^https?:\/\/(?:www\.)?google\.com\/search\?q=/, "") || "competitor analysis",
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = gRes.items.length;
        if (gRes.report.error) {
          explicitError = gRes.report.error;
          explicitStatus = "PROVIDER_FAILED";
        }
        break;
      }
      case "BLOG": {
        await scrapeBlog(canonicalUrl, canonicalUrl, competitorId, "Competitor Blog", accountId, campaignId);
        itemsCount = 1;
        break;
      }
      default:
        explicitStatus = "UNSUPPORTED";
        explicitError = `Unknown platform: ${platform}`;
        break;
    }

    // Determine final status cleanly
    const finalStatus: SourceFetchStatus = explicitStatus 
      ? explicitStatus
      : (itemsCount > 0 || commentsCount > 0 ? "SUCCESS" : "SUCCESS_ZERO_CONTENT");

    // Invariant: Successful fetch updates lastFetchedAt ONLY. Never update lastVerifiedAt during fetch.
    if (finalStatus === "SUCCESS" || finalStatus === "SUCCESS_ZERO_CONTENT") {
      await db
        .update(competitorSources)
        .set({
          lastFetchedAt: new Date(),
        })
        .where(eq(competitorSources.id, sourceId));
    }

    return {
      sourceId,
      platform,
      status: finalStatus,
      itemsCount,
      commentsCount,
      durationMs: Date.now() - startedAt,
      error: explicitError,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const isTimeout = errorMsg.toLowerCase().includes("timeout") || errorMsg.toLowerCase().includes("deadline");
    const isRateLimit = errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("429");
    const isBlocked = errorMsg.toLowerCase().includes("blocked") || errorMsg.toLowerCase().includes("403");

    const terminalStatus: SourceFetchStatus = isTimeout
      ? "TIMEOUT"
      : isRateLimit
      ? "RATE_LIMITED"
      : isBlocked
      ? "BLOCKED_BY_PLATFORM"
      : "PROVIDER_FAILED";

    // Invariant: Provider fetch error does NOT invalidate verified source status in competitor_sources
    return {
      sourceId,
      platform,
      status: terminalStatus,
      itemsCount: 0,
      commentsCount: 0,
      durationMs: Date.now() - startedAt,
      error: errorMsg,
    };
  }
}

