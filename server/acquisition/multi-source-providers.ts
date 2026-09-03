/**
 * Multi-Source Ingestion & Evidence Normalization Provider
 * Supports Google Search, LinkedIn Posts, X (Twitter) Tweets, YouTube Videos, and Reviews.
 * 
 * Constitutional Invariants:
 * 1. Normalized External Evidence: All platforms emit the unified NormalizedExternalItem contract.
 * 2. Cross-Source Normalization: Sources provide evidence only; they NEVER create separate platform strategies.
 * 3. Campaign & Tenant Lineage: Every ingested signal is bound to campaignId and accountId.
 * 4. Idempotency & Deduplication: Stable deterministic identifiers prevent duplicate records on repeated fetches.
 * 5. Honest Capabilities: Platforms without deep vision emit VIDEO_VISUAL_ANALYSIS_NOT_IMPLEMENTED.
 */

import { runActorAndGetItems } from "./apify-client";
import { createHash } from "crypto";
import { db } from "../db";
import { ciCompetitorPosts, ciCompetitorReviews } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { persistExtractedReviews, type ExtractedReview } from "../competitive-intelligence/reviews-scraper";

export type ExternalSourcePlatform = "GOOGLE" | "LINKEDIN" | "X" | "YOUTUBE" | "REVIEWS";

export interface NormalizedExternalItem {
  id: string;
  platform: ExternalSourcePlatform;
  externalId: string;
  title?: string;
  text: string;
  url?: string;
  authorName?: string;
  authorHandle?: string;
  publishedAt: string; // ISO format
  campaignId: string;
  accountId: string;
  competitorId?: string;
  authorityClass: "DIRECT_AUDIENCE_EVIDENCE" | "SUPPORTING_AUDIENCE_CONTEXT" | "MARKET_NARRATIVE_CONTEXT";
  rawPayload?: Record<string, any>;
  fetchedAt: string;
}

export interface FetchOptions {
  campaignId: string;
  accountId: string;
  competitorId?: string;
  budgetMs?: number;
}

export interface GoogleFetchOptions extends FetchOptions {
  query: string;
  maxResults?: number;
}

export interface LinkedInFetchOptions extends FetchOptions {
  profileUrl: string;
  maxPosts?: number;
}

export interface XFetchOptions extends FetchOptions {
  handle: string;
  maxTweets?: number;
}

export interface YouTubeFetchOptions extends FetchOptions {
  channelUrl: string;
  maxVideos?: number;
}

export interface ReviewsFetchOptions extends FetchOptions {
  targetUrl: string;
  platformType: "trustpilot" | "google_maps";
  maxReviews?: number;
}

export interface MultiSourceFetchReport {
  platform: ExternalSourcePlatform;
  provider: "apify";
  actorId: string;
  rawCount: number;
  acceptedCount: number;
  rejectedCount: number;
  persistedIds: string[];
  durationMs: number;
  error?: string | null;
}

export const ACTOR_SLOTS = {
  GOOGLE_SEARCH: process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper",
  LINKEDIN_POSTS: process.env.LINKEDIN_ACTOR_ID || "apimaestro~linkedin-profile-posts",
  X_TWEETS: process.env.X_SCRAPER_ACTOR_ID || "apidojo~tweet-scraper",
  YOUTUBE_VIDEOS: process.env.YOUTUBE_ACTOR_ID || "streamers~youtube-scraper",
  GOOGLE_REVIEWS: process.env.GOOGLE_REVIEWS_ACTOR_ID || "compass~google-maps-reviews-scraper",
  TRUSTPILOT_REVIEWS: process.env.TRUSTPILOT_REVIEWS_ACTOR_ID || "sourabhbgp~trustpilot-scraper",
} as const;

/**
 * Computes a deterministic identity hash for an external item.
 */
export function computeExternalItemId(platform: ExternalSourcePlatform, externalId: string): string {
  const hash = createHash("sha256").update(`${platform}:${externalId.trim()}`).digest("hex").slice(0, 16);
  return `ext_${platform.toLowerCase()}_${hash}`;
}

/**
 * Normalizes and validates an array of external items from any source.
 * Deduplicates by canonical id and ensures tenant lineage.
 */
export function normalizeCrossSourceEvidence(items: NormalizedExternalItem[]): NormalizedExternalItem[] {
  const seen = new Set<string>();
  const normalized: NormalizedExternalItem[] = [];

  for (const item of items) {
    if (!item.id || !item.text || item.text.trim().length === 0) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    normalized.push({
      ...item,
      text: item.text.trim(),
      fetchedAt: item.fetchedAt || new Date().toISOString(),
    });
  }

  return normalized;
}

/**
 * 1. REAL GOOGLE SEARCH INGESTION
 */
export async function fetchGoogleSearchEvidence(opts: GoogleFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { query, campaignId, accountId, competitorId, maxResults = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.GOOGLE_SEARCH;
  const startedAt = Date.now();

  try {
    const result = await runActorAndGetItems({
      actorId,
      input: {
        queries: query,
        maxPagesPerQuery: 1,
        resultsPerPage: maxResults,
      },
      budgetMs,
      label: `Google-Search-${query.slice(0, 20)}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const page of result.items) {
      const organicResults = Array.isArray(page?.organicResults) ? page.organicResults : [];
      for (const res of organicResults) {
        const text = `${res.title || ""} - ${res.description || ""}`.trim();
        const url = res.url || res.link;
        if (!text || !url) {
          rejectedCount++;
          continue;
        }

        const externalId = url;
        const id = computeExternalItemId("GOOGLE", externalId);

        items.push({
          id,
          platform: "GOOGLE",
          externalId,
          title: res.title || "Google Search Result",
          text,
          url,
          authorName: res.displayedUrl || "Google Search",
          publishedAt: res.date ? new Date(res.date).toISOString() : new Date().toISOString(),
          campaignId,
          accountId,
          competitorId,
          authorityClass: "MARKET_NARRATIVE_CONTEXT",
          rawPayload: res,
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "GOOGLE",
        provider: "apify",
        actorId,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "GOOGLE",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: err.message,
      },
    };
  }
}

/**
 * 2. REAL LINKEDIN POSTS INGESTION
 */
export async function fetchLinkedInEvidence(opts: LinkedInFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { profileUrl, campaignId, accountId, competitorId, maxPosts = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.LINKEDIN_POSTS;
  const startedAt = Date.now();

  try {
    const result = await runActorAndGetItems({
      actorId,
      input: {
        urls: [profileUrl],
        maxPosts,
      },
      budgetMs,
      label: `LinkedIn-Posts-${profileUrl.slice(0, 30)}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const post of result.items) {
      const text = (post.text || post.content || post.commentary || "").trim();
      const urn = post.full_urn || post.urn?.ugcPost_urn || post.urn?.activity_urn || post.id || post.url;
      if (!text || !urn) {
        rejectedCount++;
        continue;
      }

      const externalId = String(urn);
      const id = computeExternalItemId("LINKEDIN", externalId);
      const publishedAt = post.posted_at?.timestamp
        ? new Date(post.posted_at.timestamp).toISOString()
        : (post.posted_at?.date ? new Date(post.posted_at.date).toISOString() : new Date().toISOString());

      items.push({
        id,
        platform: "LINKEDIN",
        externalId,
        title: post.title || `LinkedIn post from ${post.author?.name || "Company"}`,
        text,
        url: post.url || (post.full_urn ? `https://www.linkedin.com/feed/update/${post.full_urn}` : undefined),
        authorName: post.author?.name || "LinkedIn Author",
        authorHandle: post.author?.username || undefined,
        publishedAt,
        campaignId,
        accountId,
        competitorId,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
        rawPayload: post,
        fetchedAt: new Date().toISOString(),
      });
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "LINKEDIN",
        provider: "apify",
        actorId,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "LINKEDIN",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: err.message,
      },
    };
  }
}

/**
 * 3. REAL X (TWITTER) TWEETS INGESTION
 */
export async function fetchXEvidence(opts: XFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { handle, campaignId, accountId, competitorId, maxTweets = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.X_TWEETS;
  const startedAt = Date.now();

  try {
    const cleanHandle = handle.replace(/^@/, "");
    const result = await runActorAndGetItems({
      actorId,
      input: {
        twitterHandles: [cleanHandle],
        maxItems: maxTweets,
      },
      budgetMs,
      label: `X-Tweets-${cleanHandle}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const tweet of result.items) {
      const text = (tweet.fullText || tweet.text || "").trim();
      const tweetId = tweet.id || tweet.id_str;
      if (!text || !tweetId) {
        rejectedCount++;
        continue;
      }

      const externalId = String(tweetId);
      const id = computeExternalItemId("X", externalId);
      const publishedAt = tweet.createdAt || tweet.created_at
        ? new Date(tweet.createdAt || tweet.created_at).toISOString()
        : new Date().toISOString();

      items.push({
        id,
        platform: "X",
        externalId,
        title: `Tweet by @${cleanHandle}`,
        text,
        url: tweet.url || tweet.twitterUrl || `https://x.com/${cleanHandle}/status/${externalId}`,
        authorName: tweet.author?.name || cleanHandle,
        authorHandle: cleanHandle,
        publishedAt,
        campaignId,
        accountId,
        competitorId,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
        rawPayload: tweet,
        fetchedAt: new Date().toISOString(),
      });
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "X",
        provider: "apify",
        actorId,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "X",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: err.message,
      },
    };
  }
}

/**
 * 4. REAL YOUTUBE VIDEOS INGESTION
 */
export async function fetchYouTubeEvidence(opts: YouTubeFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { channelUrl, campaignId, accountId, competitorId, maxVideos = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.YOUTUBE_VIDEOS;
  const startedAt = Date.now();

  try {
    const result = await runActorAndGetItems({
      actorId,
      input: {
        startUrls: [{ url: channelUrl }],
        maxResults: maxVideos,
      },
      budgetMs,
      label: `YouTube-${channelUrl.slice(0, 30)}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const vid of result.items) {
      const text = `${vid.title || ""} - ${vid.description || ""}`.trim();
      const videoId = vid.id || vid.videoId || vid.url;
      if (!text || !videoId) {
        rejectedCount++;
        continue;
      }

      const externalId = String(videoId);
      const id = computeExternalItemId("YOUTUBE", externalId);
      const publishedAt = vid.date || vid.uploadDate || vid.publishedAt
        ? new Date(vid.date || vid.uploadDate || vid.publishedAt).toISOString()
        : new Date().toISOString();

      items.push({
        id,
        platform: "YOUTUBE",
        externalId,
        title: vid.title || "YouTube Video",
        text,
        url: vid.url || (vid.id ? `https://www.youtube.com/watch?v=${vid.id}` : channelUrl),
        authorName: vid.channelName || vid.channelTitle || "YouTube Channel",
        authorHandle: vid.channelHandle || undefined,
        publishedAt,
        campaignId,
        accountId,
        competitorId,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
        rawPayload: { ...vid, visualAnalysis: "VIDEO_VISUAL_ANALYSIS_NOT_IMPLEMENTED" },
        fetchedAt: new Date().toISOString(),
      });
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "YOUTUBE",
        provider: "apify",
        actorId,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "YOUTUBE",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: err.message,
      },
    };
  }
}

/**
 * 5. REAL REVIEWS INGESTION VIA APIFY
 */
export async function fetchReviewsViaApify(opts: ReviewsFetchOptions): Promise<{ reviews: ExtractedReview[]; report: MultiSourceFetchReport }> {
  const { targetUrl, platformType, campaignId, accountId, competitorId, maxReviews = 25, budgetMs = 120_000 } = opts;
  const actorId = platformType === "trustpilot" ? ACTOR_SLOTS.TRUSTPILOT_REVIEWS : ACTOR_SLOTS.GOOGLE_REVIEWS;
  const startedAt = Date.now();

  try {
    const input = platformType === "trustpilot"
      ? { urls: [targetUrl], startUrls: [{ url: targetUrl }], maxReviews }
      : { startUrls: [{ url: targetUrl }], maxReviews, reviewsSort: "newest" };

    const result = await runActorAndGetItems({
      actorId,
      input,
      budgetMs,
      label: `Reviews-${platformType}-${targetUrl.slice(0, 30)}`,
    });

    const reviews: ExtractedReview[] = [];
    let rejectedCount = 0;

    for (const r of result.items) {
      const text = (r.text || r.reviewText || r.review_text || r.reviewBody || r.content || "").trim();
      if (!text || text.length < 5) {
        rejectedCount++;
        continue;
      }

      const rating = typeof r.rating === "number" ? r.rating : (typeof r.stars === "number" ? r.stars : 5);
      const time = r.publishedAt || r.date || r.reviewDate ? Math.floor(new Date(r.publishedAt || r.date || r.reviewDate).getTime() / 1000) : Math.floor(Date.now() / 1000);
      const authorName = r.author || r.userName || r.reviewerName || undefined;

      reviews.push({
        text,
        rating,
        time,
        authorName,
      });
    }

    if (competitorId && reviews.length > 0) {
      await persistExtractedReviews(competitorId, accountId, campaignId, null, reviews);
    }

    return {
      reviews,
      report: {
        platform: "REVIEWS",
        provider: "apify",
        actorId,
        rawCount: result.items.length,
        acceptedCount: reviews.length,
        rejectedCount,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err: any) {
    return {
      reviews: [],
      report: {
        platform: "REVIEWS",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: err.message,
      },
    };
  }
}

/**
 * Persists normalized external evidence items to ciCompetitorPosts for pipeline integration.
 */
export async function persistExternalEvidenceToDb(items: NormalizedExternalItem[]): Promise<{ persistedCount: number; errors: number }> {
  let persistedCount = 0;
  let errors = 0;

  for (const item of items) {
    if (!item.competitorId) continue;
    try {
      const dbId = `post_${item.platform.toLowerCase()}_${item.competitorId}_${item.externalId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)}`;
      await db.insert(ciCompetitorPosts).values({
        id: dbId,
        competitorId: item.competitorId,
        accountId: item.accountId,
        postId: item.externalId,
        platform: item.platform.toLowerCase(),
        caption: item.text,
        permalink: item.url || null,
        mediaType: item.platform === "YOUTUBE" ? "VIDEO" : "IMAGE",
        timestamp: new Date(item.publishedAt),
        batchId: `ext_${Date.now()}`,
      } as any).onConflictDoUpdate({
        target: [ciCompetitorPosts.competitorId, ciCompetitorPosts.postId],
        set: {
          caption: item.text,
          permalink: item.url || null,
        },
      });
      persistedCount++;
    } catch (err: any) {
      console.warn(`[MultiSource] Failed to persist external item ${item.id}:`, err.message);
      errors++;
    }
  }

  return { persistedCount, errors };
}

