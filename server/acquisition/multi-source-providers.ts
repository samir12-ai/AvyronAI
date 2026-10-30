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
import { ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews, ciCompetitors, competitorSources } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { persistExtractedReviews, type ExtractedReview } from "../competitive-intelligence/reviews-scraper";

export type ExternalSourcePlatform = "GOOGLE" | "LINKEDIN" | "X" | "FACEBOOK" | "YOUTUBE" | "REVIEWS" | "REDDIT";

export type ExternalEvidenceType =
  | "COMPANY_PROFILE"
  | "COMPANY_FEED_POST"
  | "PERSONAL_PROFILE_POST"
  | "X_PROFILE"
  | "POST"
  | "REVIEW"
  | "SEARCH_RESULT";

export interface NormalizedExternalItem {
  id: string;
  platform: ExternalSourcePlatform;
  externalId: string;
  evidenceType?: ExternalEvidenceType;
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
  engagementMetrics?: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
  };
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
  countryCode?: string;
  searchLanguage?: string;
  languageCode?: string;
}

export interface LinkedInFetchOptions extends FetchOptions {
  profileUrl: string;
  maxPosts?: number;
  capability?: "POSTS" | "PROFILE";
}

export interface XFetchOptions extends FetchOptions {
  handle: string;
  maxTweets?: number;
}

export interface FacebookFetchOptions extends FetchOptions {
  pageUrl: string;
  maxPosts?: number;
}

export interface YouTubeFetchOptions extends FetchOptions {
  channelUrl: string;
  maxVideos?: number;
}

export interface YouTubeCommentsFetchOptions extends FetchOptions {
  videoUrls?: string[];
  maxCommentsPerVideo?: number;
}

export interface TikTokCommentsFetchOptions extends FetchOptions {
  postUrls?: string[];
  maxCommentsPerVideo?: number;
}

export interface ReviewsFetchOptions extends FetchOptions {
  targetUrl: string;
  platformType: "trustpilot" | "google_maps" | "trendyol" | "g2" | "capterra";
  maxReviews?: number;
}

export interface MultiSourceFetchReport {
  platform: ExternalSourcePlatform | string;
  provider: "apify";
  actorId: string;
  runId?: string | null;
  datasetId?: string | null;
  usageUsd?: number | null;
  rawCount: number;
  acceptedCount: number;
  rejectedCount: number;
  persistedIds: string[];
  durationMs: number;
  evidenceType?: ExternalEvidenceType;
  profileDossier?: Record<string, any> | null;
  rawProductCount?: number;
  rawReviewCount?: number;
  productMetadata?: Record<string, any> | null;
  channelSubscribers?: number | null;
  channelTotalVideos?: number | null;
  channelName?: string | null;
  channelId?: string | null;
  isConfirmedEmpty?: boolean;
  error?: string | null;
}

export const ACTOR_SLOTS = {
  GOOGLE_SEARCH: process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper",
  LINKEDIN_POSTS: process.env.LINKEDIN_ACTOR_ID || "apimaestro~linkedin-profile-posts",
  LINKEDIN_COMPANY_POSTS: process.env.LINKEDIN_COMPANY_POSTS_ACTOR_ID || "harvestapi~linkedin-company-posts",
  LINKEDIN_COMPANY: process.env.LINKEDIN_COMPANY_ACTOR_ID || "harvestapi~linkedin-company",
  X_TWEETS: process.env.X_SCRAPER_ACTOR_ID || "apidojo~tweet-scraper",
  X_USER: process.env.X_USER_ACTOR_ID || "apidojo~twitter-user-scraper",
  FACEBOOK_POSTS: process.env.FACEBOOK_ACTOR_ID || "apify~facebook-posts-scraper",
  YOUTUBE_VIDEOS: process.env.YOUTUBE_ACTOR_ID || "streamers~youtube-scraper",
  YOUTUBE_COMMENTS: process.env.YOUTUBE_COMMENTS_ACTOR_ID || "streamers~youtube-comments-scraper",
  TIKTOK_COMMENTS: process.env.TIKTOK_COMMENTS_ACTOR_ID || "clockworks~tiktok-comments-scraper",
  GOOGLE_REVIEWS: process.env.GOOGLE_REVIEWS_ACTOR_ID || "compass~Google-Maps-Reviews-Scraper",
  TRUSTPILOT_REVIEWS: process.env.TRUSTPILOT_REVIEWS_ACTOR_ID || "sourabhbgp~trustpilot-scraper",
  TRENDYOL_REVIEWS: process.env.TRENDYOL_REVIEWS_ACTOR_ID || "fatihtahta~trendyol-scraper",
  G2_REVIEWS: process.env.G2_REVIEWS_ACTOR_ID || "zen-studio~software-review-scraper",
  CAPTERRA_REVIEWS: process.env.CAPTERRA_REVIEWS_ACTOR_ID || "zen-studio~software-review-scraper",
  REDDIT: process.env.REDDIT_ACTOR_ID || "trudax~reddit-scraper-lite",
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
  const { query, campaignId, accountId, competitorId, maxResults = 10, budgetMs = 90_000, countryCode, searchLanguage, languageCode } = opts;
  const actorId = ACTOR_SLOTS.GOOGLE_SEARCH;
  const startedAt = Date.now();

  try {
    const actorInput: Record<string, any> = {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: maxResults,
    };
    if (countryCode) {
      actorInput.countryCode = countryCode.toLowerCase().trim();
    }
    if (searchLanguage) {
      actorInput.searchLanguage = searchLanguage.toLowerCase().trim();
    }
    if (languageCode) {
      actorInput.languageCode = languageCode.toLowerCase().trim();
    }

    const result = await runActorAndGetItems({
      actorId,
      input: actorInput,
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
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
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
 * Parses and validates a LinkedIn URL or slug, distinguishing personal profiles (/in/<slug>)
 * from company pages (/company/<slug>) and rejecting generic root URLs like https://linkedin.com/company.
 */
export function parseLinkedInIdentity(
  rawUrlOrSlug: string,
  defaultKind: "company" | "profile" = "company"
): {
  valid: boolean;
  kind: "company" | "profile";
  slug: string;
  handle: string;
  canonicalUrl: string;
  error?: string;
} {
  const raw = (rawUrlOrSlug || "").trim();
  if (!raw) {
    return {
      valid: false,
      kind: defaultKind,
      slug: "",
      handle: "",
      canonicalUrl: "",
      error: "SOURCE_INVALID: Empty LinkedIn URL",
    };
  }

  const INVALID_SLUGS = new Set([
    "company",
    "in",
    "school",
    "showcase",
    "pub",
    "login",
    "signup",
    "feed",
    "jobs",
    "share",
    "mynetwork",
    "messaging",
    "notifications",
    "linkedin",
    "www",
  ]);

  // Strip protocol & domain if present, or leading slashes
  let pathPart = raw;
  const looksLikeUrl =
    /^https?:\/\//i.test(raw) ||
    /^(?:www\.|[a-z]{2}\.)?linkedin\.com/i.test(raw);

  if (looksLikeUrl) {
    try {
      const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith("linkedin.com")) {
        return {
          valid: false,
          kind: defaultKind,
          slug: "",
          handle: raw,
          canonicalUrl: raw,
          error: `SOURCE_INVALID: Non-LinkedIn domain (${host})`,
        };
      }
      pathPart = parsed.pathname;
    } catch {
      return {
        valid: false,
        kind: defaultKind,
        slug: "",
        handle: raw,
        canonicalUrl: raw,
        error: `SOURCE_INVALID: Malformed LinkedIn URL (${raw})`,
      };
    }
  }

  const segments = pathPart
    .split(/[/?#]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      valid: false,
      kind: defaultKind,
      slug: "",
      handle: raw,
      canonicalUrl: raw,
      error: `SOURCE_INVALID: Generic LinkedIn root URL (${raw})`,
    };
  }

  const first = segments[0].toLowerCase();
  if (["company", "in", "school", "showcase", "pub"].includes(first)) {
    const slug = decodeURIComponent((segments[1] || "").trim().replace(/^@/, ""));
    const kind: "company" | "profile" = first === "in" || first === "pub" ? "profile" : "company";
    if (!slug || INVALID_SLUGS.has(slug.toLowerCase())) {
      return {
        valid: false,
        kind,
        slug: "",
        handle: first,
        canonicalUrl: raw.startsWith("http") ? raw : `https://linkedin.com/${first}`,
        error: `SOURCE_INVALID: Generic LinkedIn placeholder URL without account slug (${raw})`,
      };
    }
    const handle = `${kind === "profile" ? "in" : "company"}/${slug}`;
    const canonicalUrl = `https://www.linkedin.com/${handle}`;
    return { valid: true, kind, slug, handle, canonicalUrl };
  }

  // Single segment (either on linkedin.com/<slug> or bare handle/slug)
  const cleanSingle = decodeURIComponent(segments[0].replace(/^@/, "").trim());
  if (!cleanSingle || INVALID_SLUGS.has(cleanSingle.toLowerCase()) || cleanSingle.includes(".")) {
    return {
      valid: false,
      kind: defaultKind,
      slug: "",
      handle: raw,
      canonicalUrl: raw,
      error: `SOURCE_INVALID: Non-account LinkedIn path or generic handle (${raw})`,
    };
  }

  const handle = `${defaultKind === "profile" ? "in" : "company"}/${cleanSingle}`;
  const canonicalUrl = `https://www.linkedin.com/${handle}`;
  return {
    valid: true,
    kind: defaultKind,
    slug: cleanSingle,
    handle,
    canonicalUrl,
  };
}

/**
 * 2. REAL LINKEDIN POSTS & COMPANY PROFILE INGESTION
 *
 * Invariant (Workstream 2):
 * - A company profile (COMPANY_PROFILE via harvestapi~linkedin-company) is NOT a published post.
 * - Capability "PROFILE" fetches COMPANY_PROFILE dossier metadata and returns items=[] (never stored in ci_competitor_posts).
 * - Capability "POSTS" on /company/<slug> invokes harvestapi~linkedin-company-posts (COMPANY_FEED_POST).
 * - Capability "POSTS" on /in/<slug> invokes apimaestro~linkedin-profile-posts (PERSONAL_PROFILE_POST).
 * - A 0-post feed response returns isConfirmedEmpty=false (INCONCLUSIVE_ZERO_RESULT) unless confirmed by positive metadata, and NEVER falls back to storing a company profile in ci_competitor_posts.
 */
export async function fetchLinkedInEvidence(opts: LinkedInFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { profileUrl, campaignId, accountId, competitorId, maxPosts = 10, budgetMs = 90_000, capability = "POSTS" } = opts;
  const startedAt = Date.now();
  const parsed = parseLinkedInIdentity(profileUrl);

  if (!parsed.valid) {
    return {
      items: [],
      report: {
        platform: "LINKEDIN",
        provider: "apify",
        actorId: capability === "PROFILE" ? ACTOR_SLOTS.LINKEDIN_COMPANY : ACTOR_SLOTS.LINKEDIN_COMPANY_POSTS,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 1,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: parsed.error || `SOURCE_INVALID: Invalid LinkedIn URL ${profileUrl}`,
      },
    };
  }

  // Case A: Explicit PROFILE capability -> fetch company dossier via harvestapi~linkedin-company (never stored as posts)
  if (capability === "PROFILE") {
    const compUrl = parsed.kind === "company" ? parsed.canonicalUrl : `https://www.linkedin.com/company/${parsed.slug}`;
    const usedActorId = ACTOR_SLOTS.LINKEDIN_COMPANY;
    try {
      const compRes = await runActorAndGetItems({
        actorId: usedActorId,
        input: {
          companies: [compUrl],
        },
        budgetMs,
        label: `LinkedIn-CompanyProfile-${parsed.slug.slice(0, 25)}`,
      });
      const comp = compRes.items.find((c: any) => c && !c.error && (c.id || c.universalName || c.name)) || null;
      const errItem = !comp ? compRes.items.find((c: any) => c && (c.error || c.message)) : null;
      const upstreamProfileError = errItem ? String(errItem.error || errItem.message) : null;
      const profileDossier = comp
        ? {
            evidenceType: "COMPANY_PROFILE" as const,
            companyId: String(comp.id || comp.universalName || parsed.slug),
            universalName: comp.universalName || parsed.slug,
            name: comp.name || parsed.slug,
            tagline: comp.tagline || null,
            description: comp.description || null,
            website: comp.website || null,
            linkedinUrl: comp.linkedinUrl || compUrl,
            followerCount: typeof comp.followerCount === "number" ? comp.followerCount : null,
            employeeCount: typeof comp.employeeCount === "number" ? comp.employeeCount : null,
            specialties: Array.isArray(comp.specialities) ? comp.specialities : [],
            industries: Array.isArray(comp.industries)
              ? comp.industries.map((x: any) => (typeof x === "string" ? x : x?.name)).filter(Boolean)
              : [],
            fetchedAt: new Date().toISOString(),
          }
        : null;

      return {
        items: [], // Company profile dossier is NEVER a post item
        report: {
          platform: "LINKEDIN",
          provider: "apify",
          actorId: usedActorId,
          runId: compRes.runId,
          datasetId: compRes.datasetId,
          usageUsd: compRes.usageUsd,
          rawCount: compRes.items.length,
          acceptedCount: profileDossier ? 1 : 0,
          rejectedCount: profileDossier ? 0 : compRes.items.length,
          persistedIds: profileDossier ? [`profile_linkedin_company_${profileDossier.companyId}`] : [],
          durationMs: Date.now() - startedAt,
          evidenceType: "COMPANY_PROFILE",
          profileDossier,
          isConfirmedEmpty: false,
          ...(upstreamProfileError ? { error: upstreamProfileError } : {}),
        },
      };
    } catch (err: any) {
      return {
        items: [],
        report: {
          platform: "LINKEDIN",
          provider: "apify",
          actorId: usedActorId,
          rawCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          persistedIds: [],
          durationMs: Date.now() - startedAt,
          evidenceType: "COMPANY_PROFILE",
          error: err.message,
        },
      };
    }
  }

  // Case B: POSTS capability -> fetch actual feed posts (COMPANY_FEED_POST or PERSONAL_PROFILE_POST)
  const evidenceType: ExternalEvidenceType = parsed.kind === "profile" ? "PERSONAL_PROFILE_POST" : "COMPANY_FEED_POST";
  const usedActorId: string = parsed.kind === "profile" ? ACTOR_SLOTS.LINKEDIN_POSTS : ACTOR_SLOTS.LINKEDIN_COMPANY_POSTS;
  let runId: string | null = null;
  let datasetId: string | null = null;
  let usageUsd: number | null = null;
  let rawCount = 0;
  let rejectedCount = 0;
  let upstreamFeedError: string | null = null;
  let explicitNoPostsConfirmed = false;
  const items: NormalizedExternalItem[] = [];

  try {
    if (parsed.kind === "profile") {
      const result = await runActorAndGetItems({
        actorId: ACTOR_SLOTS.LINKEDIN_POSTS,
        input: {
          username: parsed.slug,
          limit: maxPosts,
        },
        budgetMs,
        label: `LinkedIn-ProfilePosts-${parsed.slug.slice(0, 25)}`,
      });
      runId = result.runId;
      datasetId = result.datasetId;
      usageUsd = result.usageUsd;
      rawCount = result.items.length;

      for (const post of result.items) {
        if ((post?.error || post?.message) && !post?.text && !post?.full_urn) {
          const msg = String(post.error || post.message || "");
          if (/no posts|empty|0 posts/i.test(msg)) {
            explicitNoPostsConfirmed = true;
          } else if (/not found|invalid|unavailable|blocked|rate limit|unauthorized|forbidden|error/i.test(msg) || post?.error) {
            upstreamFeedError = upstreamFeedError || msg;
          }
          rejectedCount++;
          continue;
        }
        const text = (post.text || post.content || post.commentary || "").trim();
        const urn = post.full_urn || post.urn?.ugcPost_urn || post.urn?.activity_urn || post.id || post.url;
        if (!text || !urn) {
          rejectedCount++;
          continue;
        }

        const externalId = String(urn);
        const id = computeExternalItemId("LINKEDIN", externalId);
        const rawTs = post.posted_at?.timestamp ?? post.posted_at?.date ?? post.publishedAt ?? post.createdAt;
        const parsedDate = rawTs ? new Date(typeof rawTs === "number" && rawTs < 1e12 ? rawTs * 1000 : rawTs) : null;
        const publishedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";

        items.push({
          id,
          platform: "LINKEDIN",
          externalId,
          evidenceType: "PERSONAL_PROFILE_POST",
          title: post.title || `LinkedIn post from ${post.author?.name || parsed.slug}`,
          text,
          url: post.url || (post.full_urn ? `https://www.linkedin.com/feed/update/${post.full_urn}` : parsed.canonicalUrl),
          authorName: post.author?.name || parsed.slug,
          authorHandle: post.author?.username || parsed.slug,
          publishedAt,
          campaignId,
          accountId,
          competitorId,
          authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
          engagementMetrics: {
            likes: typeof post.stats?.total_reactions === "number" ? post.stats.total_reactions : (typeof post.likesCount === "number" ? post.likesCount : null),
            comments: typeof post.stats?.comments === "number" ? post.stats.comments : (typeof post.commentsCount === "number" ? post.commentsCount : null),
            views: null,
          },
          rawPayload: { ...post, evidenceType: "PERSONAL_PROFILE_POST" },
          fetchedAt: new Date().toISOString(),
        });
      }
    } else {
      // Company page feed posts via harvestapi~linkedin-company-posts
      const result = await runActorAndGetItems({
        actorId: ACTOR_SLOTS.LINKEDIN_COMPANY_POSTS,
        input: {
          targetUrls: [parsed.canonicalUrl],
          maxPosts,
          includeQuotePosts: true,
          includeReposts: true,
          scrapeReactions: false,
          scrapeComments: false,
        },
        budgetMs,
        label: `LinkedIn-CompanyPosts-${parsed.slug.slice(0, 25)}`,
      });
      runId = result.runId;
      datasetId = result.datasetId;
      usageUsd = result.usageUsd;
      rawCount = result.items.length;

      for (const post of result.items) {
        if (!post || post.error || String(post.type || "").toLowerCase() === "company_profile") {
          if (post?.error || post?.message) {
            const msg = String(post.error || post.message || "");
            if (/no posts|empty|0 posts/i.test(msg)) {
              explicitNoPostsConfirmed = true;
            } else {
              upstreamFeedError = upstreamFeedError || msg;
            }
          }
          rejectedCount++;
          continue;
        }
        const text = String(post.content || post.text || post.commentary || post.title || "").trim();
        const nativePostId =
          post.id ||
          post.urn ||
          post.entityUrn ||
          post.shareUrn ||
          post.activityUrn ||
          (typeof post.linkedinUrl === "string"
            ? post.linkedinUrl.match(/(?:activity|ugcPost)[:\-](\d+)/)?.[1] || post.linkedinUrl
            : null);

        if (!text || !nativePostId || String(nativePostId).startsWith("company_")) {
          rejectedCount++;
          continue;
        }

        const externalId = String(nativePostId);
        const id = computeExternalItemId("LINKEDIN", externalId);
        const rawTs =
          post.postedAt?.timestamp ??
          post.postedAt?.date ??
          (typeof post.postedAt === "string" || typeof post.postedAt === "number" ? post.postedAt : null) ??
          post.publishedAt ??
          post.createdAt ??
          post.date;
        const parsedDate = rawTs ? new Date(typeof rawTs === "number" && rawTs < 1e12 ? rawTs * 1000 : rawTs) : null;
        const publishedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";

        const likesVal =
          post.engagement?.likes ??
          post.engagement?.numLikes ??
          post.totalReactionCount ??
          post.likesCount ??
          post.numLikes ??
          post.reactionsCount;
        const commentsVal =
          post.engagement?.comments ??
          post.engagement?.numComments ??
          post.commentsCount ??
          post.numComments;
        const viewsVal = post.engagement?.views ?? post.engagement?.impressions ?? post.viewsCount ?? null;

        items.push({
          id,
          platform: "LINKEDIN",
          externalId,
          evidenceType: "COMPANY_FEED_POST",
          title: post.title || `LinkedIn company post from ${post.author?.name || parsed.slug}`,
          text,
          url: post.linkedinUrl || post.url || parsed.canonicalUrl,
          authorName: post.author?.name || post.companyName || parsed.slug,
          authorHandle: post.author?.universalName || post.author?.publicIdentifier || parsed.slug,
          publishedAt,
          campaignId,
          accountId,
          competitorId,
          authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
          engagementMetrics: {
            likes: typeof likesVal === "number" ? likesVal : null,
            comments: typeof commentsVal === "number" ? commentsVal : null,
            views: typeof viewsVal === "number" ? viewsVal : null,
          },
          rawPayload: { ...post, evidenceType: "COMPANY_FEED_POST" },
          fetchedAt: new Date().toISOString(),
        });
      }
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "LINKEDIN",
        provider: "apify",
        actorId: usedActorId,
        runId,
        datasetId,
        usageUsd,
        rawCount,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
        evidenceType,
        // Requirement #1: A LinkedIn feed actor returning 0 raw items without positive metadata does NOT prove
        // the company has 0 posts. Only confirm empty if raw items were returned and filtered out (and not due to an upstream error).
        isConfirmedEmpty:
          accepted.length === 0 &&
          !upstreamFeedError &&
          (explicitNoPostsConfirmed || rawCount > 0),
        ...(accepted.length === 0 && upstreamFeedError ? { error: upstreamFeedError } : {}),
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "LINKEDIN",
        provider: "apify",
        actorId: usedActorId,
        runId,
        datasetId,
        usageUsd,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        evidenceType,
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
    const cleanHandle = handle
      .replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0]
      .trim();

    if (!cleanHandle || ["home", "explore", "search", "login", "i", "intent", "share"].includes(cleanHandle.toLowerCase())) {
      return {
        items: [],
        report: {
          platform: "X",
          provider: "apify",
          actorId,
          rawCount: 0,
          acceptedCount: 0,
          rejectedCount: 1,
          persistedIds: [],
          durationMs: Date.now() - startedAt,
          error: `SOURCE_INVALID: Invalid X handle '${handle}'`,
        },
      };
    }

    const result = await runActorAndGetItems({
      actorId,
      input: {
        startUrls: [`https://x.com/${cleanHandle}`],
        twitterHandles: [cleanHandle],
        maxItems: maxTweets,
      },
      budgetMs,
      label: `X-Tweets-${cleanHandle}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const tweet of result.items) {
      if (tweet?.noResults === true) {
        continue;
      }
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
        engagementMetrics: {
          views: typeof tweet.viewCount === "number" ? tweet.viewCount : null,
          likes: typeof tweet.likeCount === "number" ? tweet.likeCount : null,
          comments: typeof tweet.replyCount === "number" ? tweet.replyCount : null,
        },
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
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
        isConfirmedEmpty: accepted.length === 0 && result.items.length > 0,
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
 * 3A. REAL X (TWITTER) USER PROFILE INGESTION VIA APIFY (apidojo~twitter-user-scraper)
 */
export async function fetchXProfileViaApify(
  opts: XFetchOptions
): Promise<{ profileDossier: Record<string, any> | null; report: MultiSourceFetchReport }> {
  const { handle, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.X_USER;
  const startedAt = Date.now();

  const cleanHandle = handle
    .replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .trim();

  if (!cleanHandle || ["home", "explore", "search", "login", "i", "intent", "share"].includes(cleanHandle.toLowerCase())) {
    return {
      profileDossier: null,
      report: {
        platform: "X",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 1,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        evidenceType: "X_PROFILE",
        error: `SOURCE_INVALID: Invalid X handle '${handle}'`,
      },
    };
  }

  try {
    const result = await runActorAndGetItems({
      actorId,
      input: {
        twitterHandles: [cleanHandle],
        startUrls: [`https://twitter.com/${cleanHandle}`],
        getFollowers: false,
        getFollowing: false,
        getRetweeters: false,
        getAbout: true,
        maxItems: 1,
      },
      budgetMs,
      label: `X-Profile-${cleanHandle}`,
    });

    const rawUser =
      result.items.find(
        (u: any) =>
          u &&
          !u.noResults &&
          !u.error &&
          (String(u.userName || u.screen_name || u.username || "").toLowerCase() === cleanHandle.toLowerCase() || u.id || u.rest_id)
      ) ||
      result.items.find((u: any) => u && !u.noResults && !u.error && (u.userName || u.name || u.id)) ||
      null;

    const profileDossier = rawUser
      ? {
          evidenceType: "X_PROFILE" as const,
          userId: String(rawUser.id || rawUser.rest_id || cleanHandle),
          userName: String(rawUser.userName || rawUser.screen_name || rawUser.username || cleanHandle),
          handle: String(rawUser.userName || rawUser.screen_name || rawUser.username || cleanHandle),
          name: String(rawUser.name || cleanHandle),
          description: rawUser.description || rawUser.bio || null,
          followers: typeof (rawUser.followers ?? rawUser.followers_count) === "number" ? (rawUser.followers ?? rawUser.followers_count) : null,
          followersCount: typeof (rawUser.followers ?? rawUser.followers_count) === "number" ? (rawUser.followers ?? rawUser.followers_count) : null,
          followingCount: typeof (rawUser.following ?? rawUser.friends_count) === "number" ? (rawUser.following ?? rawUser.friends_count) : null,
          statusesCount: typeof (rawUser.statusesCount ?? rawUser.statuses_count) === "number" ? (rawUser.statusesCount ?? rawUser.statuses_count) : null,
          isVerified: Boolean(rawUser.isVerified ?? rawUser.isBlueVerified),
          createdAt: rawUser.createdAt || rawUser.created_at || null,
          url: rawUser.url || rawUser.twitterUrl || `https://x.com/${cleanHandle}`,
          fetchedAt: new Date().toISOString(),
        }
      : null;

    return {
      profileDossier,
      report: {
        platform: "X",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: profileDossier ? 1 : 0,
        rejectedCount: profileDossier ? 0 : result.items.length,
        persistedIds: profileDossier ? [`profile_x_${profileDossier.userId}`] : [],
        durationMs: Date.now() - startedAt,
        evidenceType: "X_PROFILE",
        profileDossier,
        isConfirmedEmpty: false,
      },
    };
  } catch (err: any) {
    return {
      profileDossier: null,
      report: {
        platform: "X",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        evidenceType: "X_PROFILE",
        error: err.message,
      },
    };
  }
}

/**
 * 3B. REAL FACEBOOK PAGE POSTS INGESTION
 */
export async function fetchFacebookEvidence(opts: FacebookFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { pageUrl, campaignId, accountId, competitorId, maxPosts = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.FACEBOOK_POSTS;
  const startedAt = Date.now();
  const trimmed = (pageUrl || "").trim();

  // Guard against bogus numeric year paths (e.g. https://facebook.com/2008), bare profile.php without ?id=, or share dialogs
  if (
    !trimmed ||
    /^https?:\/\/(?:www\.)?facebook\.com\/(?:19|20)\d{2}\/?$/i.test(trimmed) ||
    /^https?:\/\/(?:www\.)?facebook\.com\/profile\.php\/?$/i.test(trimmed) ||
    /facebook\.com\/(?:sharer|dialog|login|share\.php|tr\?)/i.test(trimmed)
  ) {
    return {
      items: [],
      report: {
        platform: "FACEBOOK",
        provider: "apify",
        actorId,
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 1,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: `SOURCE_INVALID: Invalid or non-page Facebook URL (${trimmed})`,
      },
    };
  }

  try {
    const normalizedUrl = trimmed.startsWith("http")
      ? trimmed.replace(/^https?:\/\/facebook\.com/i, "https://www.facebook.com")
      : `https://www.facebook.com/${trimmed.replace(/^@/, "")}`;

    const result = await runActorAndGetItems({
      actorId,
      input: {
        startUrls: [{ url: normalizedUrl }],
        resultsLimit: maxPosts,
      },
      budgetMs,
      label: `Facebook-Posts-${normalizedUrl.slice(0, 35)}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;

    for (const post of result.items) {
      if (post?.error || post?.errorDescription) {
        rejectedCount++;
        continue;
      }
      const postId = post.postId || post.id || post.feedbackId;
      const text = (post.text || post.message || post.caption || post.pageName || "").trim();
      if (!postId || !text) {
        rejectedCount++;
        continue;
      }

      const externalId = String(postId);
      const id = computeExternalItemId("FACEBOOK", externalId);
      const publishedAt = post.time
        ? new Date(post.time).toISOString()
        : (typeof post.timestamp === "number" ? new Date(post.timestamp * 1000).toISOString() : new Date().toISOString());

      const likesNum = Number(post.likes ?? post.topReactionsCount);
      const commentsNum = Number(post.comments ?? post.commentsCount);
      const viewsNum = Number(post.viewsCount ?? post.videoViewCount);

      items.push({
        id,
        platform: "FACEBOOK",
        externalId,
        title: `Facebook post from ${post.user?.name || post.pageName || "Page"}`,
        text,
        url: post.url || post.topLevelUrl || post.facebookUrl || normalizedUrl,
        authorName: post.user?.name || post.pageName || "Facebook Page",
        authorHandle: post.pageName || undefined,
        publishedAt,
        campaignId,
        accountId,
        competitorId,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
        engagementMetrics: {
          views: Number.isFinite(viewsNum) && viewsNum >= 0 ? viewsNum : null,
          likes: Number.isFinite(likesNum) && likesNum >= 0 ? likesNum : null,
          comments: Number.isFinite(commentsNum) && commentsNum >= 0 ? commentsNum : null,
        },
        rawPayload: post,
        fetchedAt: new Date().toISOString(),
      });
    }

    const accepted = normalizeCrossSourceEvidence(items);

    return {
      items: accepted,
      report: {
        platform: "FACEBOOK",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
        isConfirmedEmpty: accepted.length === 0 && result.items.length > 0,
      },
    };
  } catch (err: any) {
    return {
      items: [],
      report: {
        platform: "FACEBOOK",
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
 * Normalizes a YouTube channel URL or bare handle so streamers~youtube-scraper
 * resolves the canonical @handle or /channel/UC... endpoint instead of hitting a 404
 * on bare paths like https://youtube.com/songaimedia.
 */
export function normalizeYouTubeChannelUrl(rawUrl: string, fallbackHandle?: string | null): string {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed && fallbackHandle) {
    const h = fallbackHandle.trim().replace(/^@/, "");
    return h.startsWith("UC") && h.length >= 20
      ? `https://www.youtube.com/channel/${h}`
      : `https://www.youtube.com/@${h}`;
  }
  if (!trimmed) return "";

  if (!trimmed.includes("://") && !trimmed.includes("youtube.com") && !trimmed.includes("youtu.be")) {
    const h = trimmed.replace(/^@/, "");
    return h.startsWith("UC") && h.length >= 20
      ? `https://www.youtube.com/channel/${h}`
      : `https://www.youtube.com/@${h}`;
  }

  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    if (!u.hostname.toLowerCase().includes("youtube.com")) return trimmed;

    // Preserve search/watch/shorts URLs
    if (
      u.pathname.startsWith("/results") ||
      u.pathname.startsWith("/watch") ||
      u.pathname.startsWith("/shorts/") ||
      u.pathname.startsWith("/playlist")
    ) {
      return u.toString();
    }

    const segments = u.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !["about", "videos", "shorts", "streams", "featured", "community", "playlists"].includes(s.toLowerCase()));

    if (segments.length === 0) {
      if (fallbackHandle) {
        const h = fallbackHandle.trim().replace(/^@/, "");
        return `https://www.youtube.com/@${h}`;
      }
      return u.toString();
    }

    const first = segments[0];
    if (first.startsWith("@")) {
      return `https://www.youtube.com/${first}`;
    }
    if ((first === "channel" || first === "c" || first === "user") && segments[1]) {
      return `https://www.youtube.com/${first}/${segments[1]}`;
    }
    if (first.startsWith("UC") && first.length >= 20) {
      return `https://www.youtube.com/channel/${first}`;
    }

    // Bare path segment like https://youtube.com/songaimedia -> normalize to https://www.youtube.com/@songaimedia
    return `https://www.youtube.com/@${first.replace(/^@/, "")}`;
  } catch {
    return trimmed;
  }
}

/**
 * 4. REAL YOUTUBE VIDEOS INGESTION
 */
export async function fetchYouTubeEvidence(opts: YouTubeFetchOptions): Promise<{ items: NormalizedExternalItem[]; report: MultiSourceFetchReport }> {
  const { channelUrl: rawChannelUrl, campaignId, accountId, competitorId, maxVideos = 10, budgetMs = 90_000 } = opts;
  const channelUrl = normalizeYouTubeChannelUrl(rawChannelUrl);
  const actorId = ACTOR_SLOTS.YOUTUBE_VIDEOS;
  const startedAt = Date.now();

  try {
    const result = await runActorAndGetItems({
      actorId,
      input: {
        startUrls: [{ url: channelUrl }],
        maxResults: maxVideos,
        maxResultsShorts: maxVideos,
        maxResultStreams: 0,
      },
      budgetMs,
      label: `YouTube-${channelUrl.slice(0, 30)}`,
    });

    const items: NormalizedExternalItem[] = [];
    let rejectedCount = 0;
    const channelErrors: string[] = [];
    let channelSubscribers: number | null = null;
    let channelTotalVideos: number | null = null;
    let channelName: string | null = null;
    let channelId: string | null = null;

    for (const vid of result.items) {
      if (vid?.error || vid?.note === "Channel does not exist") {
        rejectedCount++;
        channelErrors.push(`${vid.error || "YOUTUBE_ACTOR_ERROR"}: ${vid.note || vid.url || channelUrl}`);
        continue;
      }

      if (typeof vid?.numberOfSubscribers === "number" && vid.numberOfSubscribers >= 0) {
        channelSubscribers = vid.numberOfSubscribers;
      }
      if (typeof vid?.channelTotalVideos === "number" && vid.channelTotalVideos >= 0) {
        channelTotalVideos = vid.channelTotalVideos;
      }
      if (typeof vid?.channelName === "string" && vid.channelName.trim()) {
        channelName = vid.channelName.trim();
      }
      if (typeof vid?.channelId === "string" && vid.channelId.trim()) {
        channelId = vid.channelId.trim();
      } else if (typeof vid?.channelUrl === "string") {
        const cidMatch = vid.channelUrl.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
        if (cidMatch) channelId = cidMatch[1];
      }

      const rawTitle = typeof vid?.title === "string" ? vid.title.trim() : "";
      const rawDesc = typeof vid?.description === "string" ? vid.description.trim() : (typeof vid?.text === "string" ? vid.text.trim() : "");
      const text = [rawTitle, rawDesc].filter(Boolean).join(" - ").trim();

      const urlVideoId =
        typeof vid?.url === "string"
          ? vid.url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/)?.[1] || null
          : null;
      const rawVideoId = vid?.id || vid?.videoId || urlVideoId;

      if (!rawTitle || !text || !rawVideoId) {
        rejectedCount++;
        continue;
      }

      const externalId = String(rawVideoId).replace(/^yt_/, "");
      const id = computeExternalItemId("YOUTUBE", externalId);
      const publishedAt = vid.date || vid.uploadDate || vid.publishedAt
        ? new Date(vid.date || vid.uploadDate || vid.publishedAt).toISOString()
        : new Date().toISOString();

      const viewsNum = Number(vid.viewCount ?? vid.views);
      const likesNum = Number(vid.likes ?? vid.likeCount);
      const commentsNum = Number(vid.commentsCount ?? vid.commentCount ?? vid.comments);

      items.push({
        id,
        platform: "YOUTUBE",
        externalId,
        title: rawTitle,
        text,
        url: vid.url || `https://www.youtube.com/watch?v=${externalId}`,
        authorName: vid.channelName || vid.channelTitle || "YouTube Channel",
        authorHandle: vid.channelHandle || vid.channelUsername || undefined,
        publishedAt,
        campaignId,
        accountId,
        competitorId,
        authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
        engagementMetrics: {
          views: Number.isFinite(viewsNum) && viewsNum >= 0 ? viewsNum : null,
          likes: Number.isFinite(likesNum) && likesNum >= 0 ? likesNum : null,
          comments: Number.isFinite(commentsNum) && commentsNum >= 0 ? commentsNum : null,
        },
        rawPayload: { ...vid, visualAnalysis: "VIDEO_VISUAL_ANALYSIS_NOT_IMPLEMENTED" },
        fetchedAt: new Date().toISOString(),
      });
    }

    const accepted = normalizeCrossSourceEvidence(items);
    const reportError =
      accepted.length === 0 && channelErrors.length > 0
        ? /does not exist|not found|404|invalid/i.test(channelErrors[0])
          ? `SOURCE_INVALID: YouTube channel error: ${channelErrors[0]}`
          : `YouTube channel error: ${channelErrors[0]}`
        : null;

    return {
      items: accepted,
      report: {
        platform: "YOUTUBE",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: accepted.length,
        rejectedCount,
        persistedIds: accepted.map(i => i.id),
        durationMs: Date.now() - startedAt,
        channelSubscribers,
        channelTotalVideos,
        channelName,
        channelId,
        isConfirmedEmpty: accepted.length === 0 && channelTotalVideos === 0,
        error: reportError,
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
 * Deterministic cross-competitor review attribution guard:
 * Prevents reviews from domain X (e.g. trustpilot.com/review/songfinch.com) from being
 * fetched or stored under competitor Y (e.g. SongGifts / songgifts.co.uk).
 */
export async function verifyReviewTargetMatchesCompetitor(opts: {
  targetUrl: string;
  competitorId?: string;
  accountId: string;
  campaignId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { targetUrl, competitorId, accountId, campaignId } = opts;
  if (!competitorId || competitorId === "user_owned_channel") {
    return { ok: true };
  }

  const tpMatch = (targetUrl || "").match(/trustpilot\.com\/review\/([a-zA-Z0-9_.-]+)/i);
  if (!tpMatch) {
    return { ok: true };
  }

  const reviewedDomain = tpMatch[1].toLowerCase().replace(/^www\./, "").trim();
  const reviewedBrand = reviewedDomain.split(".")[0].replace(/[^a-z0-9]/g, "");

  const [targetComp] = await db
    .select()
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.id, competitorId), eq(ciCompetitors.accountId, accountId)))
    .limit(1);

  if (!targetComp) {
    return { ok: false, error: `CROSS_COMPETITOR_ATTRIBUTION_MISMATCH: Competitor ${competitorId} not found in account ${accountId}` };
  }

  let compDomain = "";
  try {
    const raw = (targetComp.websiteUrl || "").trim();
    if (raw) {
      compDomain = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
    }
  } catch {}
  const compBrand = (compDomain.split(".")[0] || "").replace(/[^a-z0-9]/g, "");
  const compNameClean = (targetComp.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // 1. Check if another active competitor in the same campaign owns the reviewed domain!
  const otherCompetitors = await db
    .select()
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  const otherOwner = otherCompetitors.find((c) => {
    if (c.id === competitorId) return false;
    try {
      const d = new URL((c.websiteUrl || "").startsWith("http") ? c.websiteUrl! : `https://${c.websiteUrl}`).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      return d === reviewedDomain;
    } catch {
      return false;
    }
  });

  if (otherOwner && compDomain !== reviewedDomain) {
    return {
      ok: false,
      error: `CROSS_COMPETITOR_ATTRIBUTION_MISMATCH: Review URL ${targetUrl} (domain=${reviewedDomain}) belongs to competitor ${otherOwner.name} (${otherOwner.id}), not ${targetComp.name} (${competitorId}, domain=${compDomain})`,
    };
  }

  // 2. Check direct domain or brand match
  const domainMatches =
    compDomain === reviewedDomain ||
    (compBrand.length >= 4 && reviewedBrand.length >= 4 && (compBrand.includes(reviewedBrand) || reviewedBrand.includes(compBrand))) ||
    (compNameClean.length >= 4 && reviewedBrand.length >= 4 && (compNameClean.includes(reviewedBrand) || reviewedBrand.includes(compNameClean)));

  if (domainMatches) {
    return { ok: true };
  }

  // 3. Check if this exact review URL is an explicitly verified first-party backlink in competitor_sources for this competitor
  const verifiedSourceRows = await db
    .select()
    .from(competitorSources)
    .where(
      and(
        eq(competitorSources.competitorId, competitorId),
        eq(competitorSources.accountId, accountId),
        eq(competitorSources.status, "ACTIVE")
      )
    );

  const hasVerifiedBacklink = verifiedSourceRows.some((s) =>
    (s.canonicalUrl || "").toLowerCase().includes(reviewedDomain)
  );
  if (hasVerifiedBacklink) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `CROSS_COMPETITOR_ATTRIBUTION_MISMATCH: Review URL ${targetUrl} (domain=${reviewedDomain}) does not match competitor ${targetComp.name} (${competitorId}, domain=${compDomain})`,
  };
}

/**
 * 4B. REAL YOUTUBE COMMENTS INGESTION VIA APIFY (streamers~youtube-comments-scraper)
 */
export async function fetchYouTubeCommentsViaApify(
  opts: YouTubeCommentsFetchOptions
): Promise<{ commentsStored: number; persistedIds: string[]; report: MultiSourceFetchReport }> {
  const { campaignId, accountId, competitorId, maxCommentsPerVideo = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.YOUTUBE_COMMENTS;
  const startedAt = Date.now();

  try {
    let videoUrls = Array.isArray(opts.videoUrls) ? opts.videoUrls.filter(Boolean) : [];
    const hasExplicitUrls = videoUrls.length > 0;
    const postByVideoId = new Map<string, string>();
    let targetPostsHavePositiveOrUnknownComments = hasExplicitUrls;

    if (competitorId) {
      const ytPosts = await db
        .select()
        .from(ciCompetitorPosts)
        .where(
          and(
            eq(ciCompetitorPosts.competitorId, competitorId),
            eq(ciCompetitorPosts.accountId, accountId),
            eq(ciCompetitorPosts.platform, "youtube")
          )
        )
        .orderBy(desc(ciCompetitorPosts.comments), desc(ciCompetitorPosts.timestamp))
        .limit(10);

      for (const p of ytPosts) {
        const vidId =
          (p.permalink ? p.permalink.match(/(?:v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)?.[1] : null) ||
          String(p.postId || "").replace(/^(?:ext_youtube_|yt_)/, "");
        if (vidId) postByVideoId.set(vidId, p.postId);
        if (!hasExplicitUrls) {
          const u = p.permalink || (vidId ? `https://www.youtube.com/watch?v=${vidId}` : "");
          if (u && videoUrls.length < 3 && !videoUrls.includes(u)) {
            videoUrls.push(u);
            if (typeof p.comments !== "number" || p.comments > 0) {
              targetPostsHavePositiveOrUnknownComments = true;
            }
          }
        }
      }
    }

    if (videoUrls.length === 0) {
      return {
        commentsStored: 0,
        persistedIds: [],
        report: {
          platform: "YOUTUBE",
          provider: "apify",
          actorId,
          rawCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          persistedIds: [],
          durationMs: Date.now() - startedAt,
          isConfirmedEmpty: true,
        },
      };
    }

    const result = await runActorAndGetItems({
      actorId,
      input: {
        startUrls: videoUrls.slice(0, 5).map((url) => ({ url })),
        maxComments: maxCommentsPerVideo,
      },
      budgetMs,
      label: `YouTube-Comments-${competitorId || "batch"}`,
    });

    let commentsStored = 0;
    let rejectedCount = 0;
    const persistedIds: string[] = [];

    for (const c of result.items) {
      const commentText = String(c?.comment || c?.text || "").trim();
      const cid = String(c?.cid || c?.id || "").trim();
      if (!commentText || !cid) {
        rejectedCount++;
        continue;
      }

      const videoId = String(c?.videoId || "").trim() || (c?.pageUrl ? c.pageUrl.match(/(?:v=|shorts\/)([a-zA-Z0-9_-]{6,})/)?.[1] || "" : "");
      const postId = postByVideoId.get(videoId) || videoId || "yt_video";
      const commentDbId = `comm_yt_${cid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45)}`;

      if (competitorId) {
        try {
          await db
            .insert(ciCompetitorComments)
            .values({
              id: commentDbId,
              competitorId,
              accountId,
              postId,
              commentId: cid,
              username: String(c?.author || "YouTube User").replace(/^@/, ""),
              commentText,
              likesCount: typeof c?.voteCount === "number" ? c.voteCount : null,
              repliesCount: typeof c?.replyCount === "number" ? c.replyCount : null,
              timestamp: new Date(),
              isSynthetic: false,
              source: "youtube_scrape",
              authorType: c?.authorIsChannelOwner ? "creator" : "customer",
              providerRunId: result.runId,
            } as any)
            .onConflictDoNothing();
          commentsStored++;
          persistedIds.push(commentDbId);
        } catch (err: any) {
          console.warn(`[MultiSource] YouTube comment insert warning:`, err.message);
        }
      } else {
        commentsStored++;
        persistedIds.push(commentDbId);
      }
    }

    return {
      commentsStored,
      persistedIds,
      report: {
        platform: "YOUTUBE",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: commentsStored,
        rejectedCount,
        persistedIds,
        durationMs: Date.now() - startedAt,
        isConfirmedEmpty:
          commentsStored === 0 &&
          (!targetPostsHavePositiveOrUnknownComments || result.items.length > 0),
      },
    };
  } catch (err: any) {
    return {
      commentsStored: 0,
      persistedIds: [],
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
 * 4C. REAL TIKTOK COMMENTS INGESTION VIA APIFY (clockworks~tiktok-comments-scraper)
 */
export async function fetchTikTokCommentsViaApify(
  opts: TikTokCommentsFetchOptions
): Promise<{ commentsStored: number; persistedIds: string[]; report: MultiSourceFetchReport }> {
  const { campaignId, accountId, competitorId, maxCommentsPerVideo = 10, budgetMs = 90_000 } = opts;
  const actorId = ACTOR_SLOTS.TIKTOK_COMMENTS;
  const startedAt = Date.now();

  try {
    let postUrls = Array.isArray(opts.postUrls) ? opts.postUrls.filter(Boolean) : [];
    const hasExplicitUrls = postUrls.length > 0;
    const postByVideoId = new Map<string, string>();
    let targetPostsHavePositiveOrUnknownComments = hasExplicitUrls;

    if (competitorId) {
      const ttPosts = await db
        .select()
        .from(ciCompetitorPosts)
        .where(
          and(
            eq(ciCompetitorPosts.competitorId, competitorId),
            eq(ciCompetitorPosts.accountId, accountId),
            eq(ciCompetitorPosts.platform, "tiktok")
          )
        )
        .orderBy(desc(ciCompetitorPosts.comments), desc(ciCompetitorPosts.timestamp))
        .limit(10);

      for (const p of ttPosts) {
        if (p.postId) postByVideoId.set(String(p.postId), p.postId);
        if (!hasExplicitUrls && p.permalink && postUrls.length < 5 && !postUrls.includes(p.permalink)) {
          postUrls.push(p.permalink);
          if (typeof p.comments !== "number" || p.comments > 0) {
            targetPostsHavePositiveOrUnknownComments = true;
          }
        }
      }
    }

    if (postUrls.length === 0) {
      return {
        commentsStored: 0,
        persistedIds: [],
        report: {
          platform: "TIKTOK",
          provider: "apify",
          actorId,
          rawCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          persistedIds: [],
          durationMs: Date.now() - startedAt,
          isConfirmedEmpty: true,
        },
      };
    }

    const result = await runActorAndGetItems({
      actorId,
      input: {
        postURLs: postUrls.slice(0, 5),
        commentsPerPost: maxCommentsPerVideo,
      },
      budgetMs,
      label: `TikTok-Comments-${competitorId || "batch"}`,
    });

    let commentsStored = 0;
    let rejectedCount = 0;
    const persistedIds: string[] = [];

    for (const c of result.items) {
      const commentText = String(c?.text || c?.comment || "").trim();
      const cid = String(c?.cid || c?.id || "").trim();
      if (!commentText || !cid) {
        rejectedCount++;
        continue;
      }

      const vUrl = String(c?.videoWebUrl || c?.submittedVideoUrl || c?.input || "");
      const vidMatch = vUrl.match(/\/video\/(\d+)/);
      const videoId = vidMatch ? vidMatch[1] : "";
      const postId = postByVideoId.get(videoId) || videoId || "tt_video";
      const commentDbId = `comm_tt_${cid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45)}`;
      const ts = c?.createTimeISO ? new Date(c.createTimeISO) : (typeof c?.createTime === "number" ? new Date(c.createTime * 1000) : new Date());

      if (competitorId) {
        try {
          await db
            .insert(ciCompetitorComments)
            .values({
              id: commentDbId,
              competitorId,
              accountId,
              postId,
              commentId: cid,
              username: String(c?.uniqueId || c?.user || "tiktok_user"),
              commentText,
              likesCount: typeof c?.diggCount === "number" ? c.diggCount : null,
              repliesCount: typeof c?.replyCommentTotal === "number" ? c.replyCommentTotal : null,
              timestamp: Number.isNaN(ts.getTime()) ? new Date() : ts,
              isSynthetic: false,
              source: "tiktok_scrape",
              authorType: "customer",
              providerRunId: result.runId,
            } as any)
            .onConflictDoNothing();
          commentsStored++;
          persistedIds.push(commentDbId);
        } catch (err: any) {
          console.warn(`[MultiSource] TikTok comment insert warning:`, err.message);
        }
      } else {
        commentsStored++;
        persistedIds.push(commentDbId);
      }
    }

    return {
      commentsStored,
      persistedIds,
      report: {
        platform: "TIKTOK",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        acceptedCount: commentsStored,
        rejectedCount,
        persistedIds,
        durationMs: Date.now() - startedAt,
        isConfirmedEmpty:
          commentsStored === 0 &&
          (!targetPostsHavePositiveOrUnknownComments || result.items.length > 0),
      },
    };
  } catch (err: any) {
    return {
      commentsStored: 0,
      persistedIds: [],
      report: {
        platform: "TIKTOK",
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

function extractSoftwareReviewQuery(targetUrlOrQuery: string): string {
  const raw = (targetUrlOrQuery || "").trim();
  if (!raw.includes("/") && !raw.includes(".")) return raw || "Slack";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const segs = u.pathname.split("/").map((s) => s.trim()).filter(Boolean);
    // e.g. https://www.g2.com/products/slack/reviews -> "slack"
    // e.g. https://www.capterra.com/p/135003/Slack/reviews/ -> "Slack"
    const prodIdx = segs.findIndex((s) => s.toLowerCase() === "products");
    if (prodIdx >= 0 && segs[prodIdx + 1]) return segs[prodIdx + 1];
    const pIdx = segs.findIndex((s) => s.toLowerCase() === "p");
    if (pIdx >= 0 && segs[pIdx + 2]) return segs[pIdx + 2];
    const filtered = segs.filter((s) => !["reviews", "products", "p", "software"].includes(s.toLowerCase()) && !/^\d+$/.test(s));
    if (filtered.length > 0) return filtered[filtered.length - 1];
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

/**
 * 5. REAL REVIEWS INGESTION VIA APIFY
 */
export async function fetchReviewsViaApify(opts: ReviewsFetchOptions): Promise<{ reviews: ExtractedReview[]; reviewsStored?: number; report: MultiSourceFetchReport }> {
  const { targetUrl, platformType, campaignId, accountId, competitorId, maxReviews = 25, budgetMs = 120_000 } = opts;
  const startedAt = Date.now();
  let actorId: string | null = null;
  let input: Record<string, any> = {};

  const attributionCheck = await verifyReviewTargetMatchesCompetitor({
    targetUrl,
    competitorId,
    accountId,
    campaignId,
  });
  if (!attributionCheck.ok) {
    return {
      reviews: [],
      reviewsStored: 0,
      report: {
        platform: "REVIEWS",
        provider: "apify",
        actorId: ACTOR_SLOTS.TRUSTPILOT_REVIEWS || "ATTRIBUTION_GUARD",
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: attributionCheck.error,
      },
    };
  }

  if (platformType === "trustpilot") {
    actorId = process.env.TRUSTPILOT_REVIEWS_ACTOR_ID || ACTOR_SLOTS.TRUSTPILOT_REVIEWS;
    input = { urls: [targetUrl], startUrls: [{ url: targetUrl }], maxReviews, mode: "reviews", sort: "recency" };
  } else if (platformType === "google_maps") {
    actorId = process.env.GOOGLE_REVIEWS_ACTOR_ID || ACTOR_SLOTS.GOOGLE_REVIEWS;
    input = { startUrls: [{ url: targetUrl }], maxReviews, reviewsSort: "newest", personalData: false };
  } else if (platformType === "trendyol") {
    actorId = process.env.TRENDYOL_REVIEWS_ACTOR_ID || ACTOR_SLOTS.TRENDYOL_REVIEWS;
    let searchQuery: string | null = null;
    try {
      const parsedUrl = new URL(targetUrl);
      if (/^\/sr\/?$/i.test(parsedUrl.pathname)) {
        searchQuery = parsedUrl.searchParams.get("q") || parsedUrl.searchParams.get("qt") || null;
      }
    } catch {}
    input = searchQuery
      ? {
          queries: [searchQuery],
          startUrls: [
            `https://www.trendyol.com/sr?os=1&q=${encodeURIComponent(searchQuery)}&qt=${encodeURIComponent(searchQuery)}&st=${encodeURIComponent(searchQuery)}`,
          ],
          getReviews: true,
          maxReviews: Math.max(5, maxReviews),
          limit: Math.max(10, Math.min(maxReviews, 25)),
          reviewSort: "recommended",
        }
      : {
          startUrls: [targetUrl],
          getReviews: true,
          maxReviews: Math.max(5, maxReviews),
          limit: Math.max(10, Math.min(maxReviews, 25)),
          reviewSort: "recommended",
        };
  } else if (platformType === "g2" || platformType === "capterra") {
    actorId =
      platformType === "g2"
        ? process.env.G2_REVIEWS_ACTOR_ID || ACTOR_SLOTS.G2_REVIEWS
        : process.env.CAPTERRA_REVIEWS_ACTOR_ID || ACTOR_SLOTS.CAPTERRA_REVIEWS;
    const query = extractSoftwareReviewQuery(targetUrl);
    input = {
      query,
      platforms: ["g2", "capterra"],
      maxResults: Math.max(100, maxReviews),
      sort: "most_recent",
    };
  }

  if (!actorId) {
    return {
      reviews: [],
      report: {
        platform: "REVIEWS",
        provider: "apify",
        actorId: "NOT_CONFIGURED",
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        persistedIds: [],
        durationMs: Date.now() - startedAt,
        error: `PROVIDER_PENDING: Actor for review platform '${platformType}' is not configured.`,
      },
    };
  }

  try {
    const result = await runActorAndGetItems({
      actorId,
      input,
      budgetMs,
      label: `Reviews-${platformType}-${targetUrl.slice(0, 30)}`,
    });

    const reviews: ExtractedReview[] = [];
    let rejectedCount = 0;
    let rawProductCount = 0;
    let rawReviewCount = 0;
    let productMetadata: Record<string, any> | null = null;

    for (const r of result.items) {
      // Trendyol scraper emits a product metadata record (type === "product") alongside review records (type === "review")
      if (r.type === "product") {
        rawProductCount++;
        if (!productMetadata) {
          productMetadata = {
            productId: String(r.id || r.identifiers?.product_id || ""),
            title: r.title || null,
            url: r.url || targetUrl,
            averageRating: typeof (r.metrics?.rating?.average_rating ?? r.average_rating) === "number" ? (r.metrics?.rating?.average_rating ?? r.average_rating) : null,
            commentCount: typeof (r.metrics?.rating?.comment_count ?? r.comment_count) === "number" ? (r.metrics?.rating?.comment_count ?? r.comment_count) : null,
            totalRatingCount: typeof (r.metrics?.rating?.total_count ?? r.rating_count) === "number" ? (r.metrics?.rating?.total_count ?? r.rating_count) : null,
          };
        }
        continue;
      }
      rawReviewCount++;

      // For zen-studio~software-review-scraper, if caller asked for g2 specifically vs capterra, prefer matching platform if available
      if ((platformType === "g2" || platformType === "capterra") && r.platform && r.platform.toLowerCase() !== platformType) {
        const hasMatchingPlatformItems = result.items.some((it: any) => (it.platform || "").toLowerCase() === platformType);
        if (hasMatchingPlatformItems) {
          continue;
        }
      }

      const combinedProsCons = [r.pros, r.cons].filter(Boolean).join(" — ");
      const text = (
        r.comment ||
        r.text ||
        r.reviewText ||
        r.review_text ||
        r.reviewBody ||
        r.content ||
        combinedProsCons ||
        (r.type !== "product" ? r.title : "") ||
        ""
      ).trim();

      if (!text || text.length < 5) {
        rejectedCount++;
        continue;
      }

      const rawRating =
        typeof r.rating === "number"
          ? r.rating
          : typeof r.rate === "number"
            ? r.rate
            : typeof r.stars === "number"
              ? r.stars
              : 5;
      const rating = Math.max(1, Math.min(5, Math.round(rawRating)));
      const rawDate = r.publishedAt || r.publishedAtDate || r.date || r.reviewDate || r.publishedDate || r.created_at || r.createdAt;
      const parsedDate = rawDate
        ? new Date(typeof rawDate === "number" && rawDate < 1e12 ? rawDate * 1000 : rawDate)
        : null;
      const time = parsedDate && !Number.isNaN(parsedDate.getTime()) ? Math.floor(parsedDate.getTime() / 1000) : 0;
      const reviewDateMs = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.getTime() : undefined;
      const nativeReviewId = r.review_id != null ? String(r.review_id) : (r.reviewId != null ? String(r.reviewId) : undefined);
      const authorName =
        (typeof r.reviewer === "object" && r.reviewer?.name ? r.reviewer.name : undefined) ||
        (typeof r.reviewer === "string" ? r.reviewer : undefined) ||
        r.author ||
        r.name ||
        r.userName ||
        r.reviewerName ||
        undefined;
      const isVerified =
        typeof r.isVerified === "boolean"
          ? r.isVerified
          : r.trusted === true || r.verifiedPurchase === true || r.isVerifiedPurchase === true;
      const verificationLevel = r.verificationLevel || (isVerified ? "verified-purchase" : undefined);
      const platformName =
        platformType === "google_maps"
          ? "google"
          : (typeof r.platform === "string" && r.platform.trim() ? r.platform.toLowerCase() : platformType);

      reviews.push({
        text,
        rating,
        time,
        reviewDateMs,
        nativeReviewId,
        authorName,
        isVerified,
        verificationLevel,
        platform: platformName,
        reviewUrl: r.reviewUrl || r.url || undefined,
      } as any);

      if (reviews.length >= maxReviews) break;
    }

    let persistedIds: string[] = [];
    let reviewsStored = 0;
    if (competitorId && reviews.length > 0) {
      const rowIds: string[] = [];
      const newlyInserted = await persistExtractedReviews(competitorId, accountId, campaignId, null, reviews, rowIds);
      reviewsStored = rowIds.length || newlyInserted;
      persistedIds = rowIds.length > 0 ? rowIds : reviews.map((rv: any, i) => rv.nativeReviewId || `rev_${platformType}_${competitorId}_${i}`);
    }

    // Requirement #1: Only classify a 0-review result as CONFIRMED_EMPTY_SOURCE when positive product/source metadata
    // confirms 0 comments/reviews (e.g. productMetadata.commentCount === 0), or when raw review items were returned
    // and rejected by window/length filter. If the actor returned 0 raw items and no metadata, it is inconclusive.
    const isConfirmedEmpty =
      reviews.length === 0 &&
      ((productMetadata !== null && productMetadata.commentCount === 0) ||
        (rawReviewCount > 0 && rejectedCount === rawReviewCount));

    return {
      reviews,
      reviewsStored,
      report: {
        platform: "REVIEWS",
        provider: "apify",
        actorId,
        runId: result.runId,
        datasetId: result.datasetId,
        usageUsd: result.usageUsd,
        rawCount: result.items.length,
        rawProductCount,
        rawReviewCount,
        productMetadata,
        acceptedCount: reviews.length,
        rejectedCount,
        persistedIds,
        durationMs: Date.now() - startedAt,
        evidenceType: "REVIEW",
        isConfirmedEmpty,
      },
    };
  } catch (err: any) {
    return {
      reviews: [],
      reviewsStored: 0,
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
 * Invariant: Profile dossiers (COMPANY_PROFILE, X_PROFILE, or company_* IDs) are NEVER persisted to ciCompetitorPosts.
 */
export async function persistExternalEvidenceToDb(
  items: NormalizedExternalItem[],
  opts?: {
    sourceId?: string | null;
    acquisitionTaskId?: string | null;
    providerRunId?: string | null;
    observationId?: string | null;
  }
): Promise<{ persistedCount: number; errors: number; persistedIds: string[] }> {
  let persistedCount = 0;
  let errors = 0;
  const persistedIds: string[] = [];

  for (const item of items) {
    if (!item.competitorId) continue;
    // Hard guard: never store company profiles or user profiles in ciCompetitorPosts
    if (
      item.evidenceType === "COMPANY_PROFILE" ||
      item.evidenceType === "X_PROFILE" ||
      String(item.externalId || "").startsWith("company_")
    ) {
      continue;
    }
    try {
      const cleanExternalId =
        item.platform === "YOUTUBE" ? String(item.externalId).replace(/^yt_/, "") : String(item.externalId);
      const safeExtSuffix =
        cleanExternalId.length <= 24 && /^[a-zA-Z0-9_-]+$/.test(cleanExternalId)
          ? cleanExternalId
          : `${cleanExternalId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 14)}_${createHash("sha256").update(cleanExternalId).digest("hex").slice(0, 12)}`;
      const dbId = `post_${item.platform.toLowerCase()}_${item.competitorId}_${safeExtSuffix}`;
      const publishedDate = item.publishedAt ? new Date(item.publishedAt) : null;
      const validTimestamp = publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate : null;

      await db.insert(ciCompetitorPosts).values({
        id: dbId,
        competitorId: item.competitorId,
        accountId: item.accountId,
        sourceId: opts?.sourceId ?? null,
        postId: cleanExternalId,
        platform: item.platform.toLowerCase(),
        caption: item.text,
        permalink: item.url || null,
        mediaType: item.platform === "YOUTUBE" ? "VIDEO" : "IMAGE",
        likes: item.engagementMetrics?.likes ?? null,
        comments: item.engagementMetrics?.comments ?? null,
        views: item.engagementMetrics?.views ?? null,
        hookText: item.title || null,
        hookSource: item.platform === "YOUTUBE" ? "youtube_title" : null,
        timestamp: validTimestamp,
        batchId: `ext_${Date.now()}`,
        acquisitionTaskId: opts?.acquisitionTaskId ?? null,
        providerRunId: opts?.providerRunId ?? null,
        observationId: opts?.observationId ?? null,
      } as any).onConflictDoUpdate({
        target: [ciCompetitorPosts.competitorId, ciCompetitorPosts.postId],
        set: {
          caption: item.text,
          permalink: item.url || null,
          likes: item.engagementMetrics?.likes ?? undefined,
          comments: item.engagementMetrics?.comments ?? undefined,
          views: item.engagementMetrics?.views ?? undefined,
          sourceId: opts?.sourceId ?? undefined,
          acquisitionTaskId: opts?.acquisitionTaskId ?? undefined,
          providerRunId: opts?.providerRunId ?? undefined,
          observationId: opts?.observationId ?? undefined,
        },
      });
      persistedCount++;
      persistedIds.push(dbId);
    } catch (err: any) {
      console.warn(`[MultiSource] Failed to persist external item ${item.id}:`, err.message);
      errors++;
    }
  }

  return { persistedCount, errors, persistedIds };
}

