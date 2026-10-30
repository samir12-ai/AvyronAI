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
import { competitorSources, ciSharedProfiles } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { scrapeInstagramViaApify } from "./instagram-apify-scraper";
import { scrapeInstagramCommentsViaActor } from "../acquisition/instagram-comments";
import { scrapeTiktokViaApify, extractTiktokHandle } from "./tiktok-apify-scraper";
import { runCompetitorWebsiteCrawler } from "./competitor-crawler";
import { scrapeBlog } from "../market-intelligence-v3/website-scraper";
import { 
  fetchGoogleSearchEvidence, 
  fetchLinkedInEvidence, 
  fetchXEvidence, 
  fetchXProfileViaApify,
  fetchFacebookEvidence,
  fetchYouTubeEvidence, 
  fetchYouTubeCommentsViaApify,
  fetchTikTokCommentsViaApify,
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

export interface ProviderDescriptor {
  platform: string;
  capability: PlatformCapability;
  transportType: "APIFY" | "PLAYWRIGHT_CRAWLER" | "DIRECT_HTTP";
  actorId: string | null;
  configEnvSlot: string | null;
  configSource: "ENV" | "DEFAULT_CONSTANT" | "NOT_CONFIGURED";
  contractVersion: string;
  supportedInputs: string[];
  entityScope: "COMPETITOR" | "MARKET" | "FIRST_PARTY";
  availableEvidenceTypes: ("POSTS" | "COMMENTS" | "REVIEWS" | "WEB_PAGES" | "SEARCH_QUOTES")[];
  paginationControls: {
    supportsPagination: boolean;
    defaultLimit: number;
    maxLimit: number;
  };
  policy: {
    timeoutMs: number;
    maxRetries: number;
    concurrencyLimit: number;
    budgetMs: number;
  };
  status: "PRODUCTION_READY" | "PROVIDER_PENDING" | "DISABLED";
  statusReason?: string;
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
    providerDescription: "Apify harvestapi~linkedin-company & apimaestro~linkedin-profile-posts",
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
  FACEBOOK: {
    platform: "FACEBOOK",
    discovery: true,
    verification: true,
    fetch: true,
    comments: false,
    media: true,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify apify~facebook-posts-scraper",
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
  GOOGLE_REVIEWS: {
    platform: "GOOGLE_REVIEWS",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify compass~google-maps-reviews-scraper",
  },
  TRUSTPILOT: {
    platform: "TRUSTPILOT",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify sourabhbgp~trustpilot-scraper",
  },
  TRENDYOL: {
    platform: "TRENDYOL",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify fatihtahta~trendyol-scraper",
  },
  G2: {
    platform: "G2",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify zen-studio~software-review-scraper",
  },
  CAPTERRA: {
    platform: "CAPTERRA",
    discovery: true,
    verification: true,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Apify zen-studio~software-review-scraper",
  },
  REDDIT: {
    platform: "REDDIT",
    discovery: true,
    verification: false,
    fetch: true,
    comments: true,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Reddit Public JSON API with Apify fallback",
  },
  WEB_FORUMS: {
    platform: "WEB_FORUMS",
    discovery: true,
    verification: false,
    fetch: true,
    comments: false,
    media: false,
    recurringMonitoring: true,
    status: "PRODUCTION_READY",
    providerDescription: "Google SERP forum query syntax via apify~google-search-scraper",
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

export function getProviderDescriptors(): Record<string, ProviderDescriptor> {
  return {
    WEBSITE: {
      platform: "WEBSITE",
      capability: "FETCH",
      transportType: "PLAYWRIGHT_CRAWLER",
      actorId: null,
      configEnvSlot: null,
      configSource: "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["url", "maxPages"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["WEB_PAGES"],
      paginationControls: { supportsPagination: true, defaultLimit: 6, maxLimit: 20 },
      policy: { timeoutMs: 30000, maxRetries: 1, concurrencyLimit: 2, budgetMs: 60000 },
      status: "PRODUCTION_READY",
      providerDescription: "Playwright Chromium Headless Crawler with HTML extraction",
    },
    INSTAGRAM: {
      platform: "INSTAGRAM",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: "apify~instagram-profile-scraper",
      configEnvSlot: "INSTAGRAM_SEARCH_ACTOR_ID",
      configSource: "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["handle", "maxPosts", "maxCommentsPerPost"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS", "COMMENTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 15, maxLimit: 50 },
      policy: { timeoutMs: 120000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify instagram-profile-scraper & instagram-comment-scraper",
    },
    TIKTOK: {
      platform: "TIKTOK",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: "clockworks~free-tiktok-scraper",
      configEnvSlot: "TIKTOK_SEARCH_ACTOR_ID",
      configSource: "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["handle", "maxPosts"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS", "COMMENTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 30 },
      policy: { timeoutMs: 90000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 90000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify clockworks~free-tiktok-scraper",
    },
    LINKEDIN: {
      platform: "LINKEDIN",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.LINKEDIN_ACTOR_ID || "apimaestro~linkedin-profile-posts",
      configEnvSlot: "LINKEDIN_ACTOR_ID",
      configSource: process.env.LINKEDIN_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["profileUrl", "maxPosts"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 90000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 90000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify apimaestro~linkedin-profile-posts",
    },
    X: {
      platform: "X",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.X_SCRAPER_ACTOR_ID || "apidojo~tweet-scraper",
      configEnvSlot: "X_SCRAPER_ACTOR_ID",
      configSource: process.env.X_SCRAPER_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["handle", "maxTweets"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 90000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 90000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify apidojo~tweet-scraper",
    },
    FACEBOOK: {
      platform: "FACEBOOK",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.FACEBOOK_ACTOR_ID || "apify~facebook-posts-scraper",
      configEnvSlot: "FACEBOOK_ACTOR_ID",
      configSource: process.env.FACEBOOK_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["pageUrl", "maxPosts"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 90000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 90000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify apify~facebook-posts-scraper",
    },
    YOUTUBE: {
      platform: "YOUTUBE",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.YOUTUBE_ACTOR_ID || "streamers~youtube-scraper",
      configEnvSlot: "YOUTUBE_ACTOR_ID",
      configSource: process.env.YOUTUBE_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["channelUrl", "query", "maxVideos"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["POSTS", "COMMENTS"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 90000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 90000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify streamers~youtube-scraper",
    },
    GOOGLE_REVIEWS: {
      platform: "GOOGLE_REVIEWS",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.GOOGLE_REVIEWS_ACTOR_ID || "compass~google-maps-reviews-scraper",
      configEnvSlot: "GOOGLE_REVIEWS_ACTOR_ID",
      configSource: process.env.GOOGLE_REVIEWS_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["startUrls", "queries", "maxReviews", "reviewsSort"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 100 },
      policy: { timeoutMs: 120000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify compass~google-maps-reviews-scraper",
    },
    TRUSTPILOT: {
      platform: "TRUSTPILOT",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.TRUSTPILOT_REVIEWS_ACTOR_ID || "sourabhbgp~trustpilot-scraper",
      configEnvSlot: "TRUSTPILOT_REVIEWS_ACTOR_ID",
      configSource: process.env.TRUSTPILOT_REVIEWS_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["urls", "maxReviews", "mode", "sort"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 100 },
      policy: { timeoutMs: 120000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify sourabhbgp~trustpilot-scraper",
    },
    REVIEWS: {
      platform: "REVIEWS",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.GOOGLE_REVIEWS_ACTOR_ID || "compass~google-maps-reviews-scraper",
      configEnvSlot: "GOOGLE_REVIEWS_ACTOR_ID",
      configSource: "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["targetUrl", "maxReviews"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 100 },
      policy: { timeoutMs: 120000, maxRetries: 2, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Composite review scraper routing to Google Maps or Trustpilot",
    },
    TRENDYOL: {
      platform: "TRENDYOL",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.TRENDYOL_REVIEWS_ACTOR_ID || "fatihtahta~trendyol-scraper",
      configEnvSlot: "TRENDYOL_REVIEWS_ACTOR_ID",
      configSource: process.env.TRENDYOL_REVIEWS_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.1.0",
      supportedInputs: ["startUrls", "getReviews", "maxReviews", "limit"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 50 },
      policy: { timeoutMs: 120000, maxRetries: 1, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify fatihtahta~trendyol-scraper",
    },
    G2: {
      platform: "G2",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.G2_REVIEWS_ACTOR_ID || "zen-studio~software-review-scraper",
      configEnvSlot: "G2_REVIEWS_ACTOR_ID",
      configSource: process.env.G2_REVIEWS_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["query", "platforms", "maxResults", "sort"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 100 },
      policy: { timeoutMs: 120000, maxRetries: 1, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify zen-studio~software-review-scraper",
    },
    CAPTERRA: {
      platform: "CAPTERRA",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.CAPTERRA_REVIEWS_ACTOR_ID || "zen-studio~software-review-scraper",
      configEnvSlot: "CAPTERRA_REVIEWS_ACTOR_ID",
      configSource: process.env.CAPTERRA_REVIEWS_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["query", "platforms", "maxResults", "sort"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["REVIEWS"],
      paginationControls: { supportsPagination: true, defaultLimit: 25, maxLimit: 100 },
      policy: { timeoutMs: 120000, maxRetries: 1, concurrencyLimit: 1, budgetMs: 120000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify zen-studio~software-review-scraper",
    },
    REDDIT: {
      platform: "REDDIT",
      capability: "FETCH",
      transportType: "DIRECT_HTTP",
      actorId: process.env.REDDIT_ACTOR_ID || "trudax~reddit-scraper-lite",
      configEnvSlot: "REDDIT_ACTOR_ID",
      configSource: process.env.REDDIT_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["query", "subreddit", "limit"],
      entityScope: "MARKET",
      availableEvidenceTypes: ["SEARCH_QUOTES"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 30000, maxRetries: 2, concurrencyLimit: 2, budgetMs: 60000 },
      status: "PRODUCTION_READY",
      providerDescription: "Reddit Public JSON API with Apify fallback",
    },
    WEB_FORUMS: {
      platform: "WEB_FORUMS",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper",
      configEnvSlot: "GOOGLE_SEARCH_ACTOR_ID",
      configSource: process.env.GOOGLE_SEARCH_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["queries", "countryCode", "maxPagesPerQuery"],
      entityScope: "MARKET",
      availableEvidenceTypes: ["SEARCH_QUOTES"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 25 },
      policy: { timeoutMs: 60000, maxRetries: 2, concurrencyLimit: 2, budgetMs: 60000 },
      status: "PRODUCTION_READY",
      providerDescription: "Google SERP forum query syntax via apify~google-search-scraper",
    },
    GOOGLE_SEARCH: {
      platform: "GOOGLE_SEARCH",
      capability: "FETCH",
      transportType: "APIFY",
      actorId: process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper",
      configEnvSlot: "GOOGLE_SEARCH_ACTOR_ID",
      configSource: process.env.GOOGLE_SEARCH_ACTOR_ID ? "ENV" : "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["queries", "countryCode", "languageCode", "maxPagesPerQuery"],
      entityScope: "MARKET",
      availableEvidenceTypes: ["SEARCH_QUOTES", "WEB_PAGES"],
      paginationControls: { supportsPagination: true, defaultLimit: 10, maxLimit: 50 },
      policy: { timeoutMs: 60000, maxRetries: 2, concurrencyLimit: 2, budgetMs: 60000 },
      status: "PRODUCTION_READY",
      providerDescription: "Apify apify~google-search-scraper",
    },
    BLOG: {
      platform: "BLOG",
      capability: "FETCH",
      transportType: "DIRECT_HTTP",
      actorId: null,
      configEnvSlot: null,
      configSource: "DEFAULT_CONSTANT",
      contractVersion: "v1.0.0",
      supportedInputs: ["url"],
      entityScope: "COMPETITOR",
      availableEvidenceTypes: ["WEB_PAGES"],
      paginationControls: { supportsPagination: false, defaultLimit: 1, maxLimit: 1 },
      policy: { timeoutMs: 30000, maxRetries: 1, concurrencyLimit: 2, budgetMs: 30000 },
      status: "PRODUCTION_READY",
      providerDescription: "Native HTML blog extractor & RSS reader",
    },
  };
}

export function resolveAcquisitionCapability(
  platform: string,
  capability: PlatformCapability = "FETCH"
): ProviderDescriptor {
  const norm = (platform || "").toUpperCase().trim();
  const descriptors = getProviderDescriptors();

  // Normalize aliases
  let key = norm;
  if (norm === "GOOGLE" || norm === "GOOGLE_MAPS") key = "GOOGLE_REVIEWS";
  else if (norm === "YOUTUBE_SEARCH") key = "YOUTUBE";
  else if (norm === "FORUMS" || norm === "FORUM") key = "WEB_FORUMS";

  if (descriptors[key]) {
    return descriptors[key];
  }

  return {
    platform: norm,
    capability,
    transportType: "DIRECT_HTTP",
    actorId: null,
    configEnvSlot: null,
    configSource: "NOT_CONFIGURED",
    contractVersion: "unknown",
    supportedInputs: [],
    entityScope: "COMPETITOR",
    availableEvidenceTypes: [],
    paginationControls: { supportsPagination: false, defaultLimit: 0, maxLimit: 0 },
    policy: { timeoutMs: 0, maxRetries: 0, concurrencyLimit: 0, budgetMs: 0 },
    status: "DISABLED",
    statusReason: `Platform '${platform}' is not registered with an acquisition provider.`,
    providerDescription: `Unregistered platform: ${platform}`,
  };
}

export function getRegisteredProviders(): ProviderDescriptor[] {
  return Object.values(getProviderDescriptors());
}

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
async function crawlBlogNativeHttp(blogUrl: string): Promise<{
  ok: boolean;
  topicTitles: string[];
  rawTextPreview: string;
  error?: string;
}> {
  try {
    const normalizedUrl = blogUrl.trim().startsWith("http") ? blogUrl.trim() : `https://${blogUrl.trim()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AvyronBot/1.0; +https://avyron.ai)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return { ok: false, topicTitles: [], rawTextPreview: "", error: `HTTP ${resp.status} fetching blog ${normalizedUrl}` };
    }
    const html = await resp.text();
    const stripTags = (s: string) =>
      s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const topicTitles: string[] = [];
    for (const m of html.matchAll(/<(?:item|entry)[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/gi)) {
      const t = stripTags(m[1] || "");
      if (t && t.length >= 4 && !topicTitles.includes(t)) {
        topicTitles.push(t);
        if (topicTitles.length >= 15) break;
      }
    }
    for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
      const h = stripTags(m[1] || "");
      if (h && h.length >= 4 && !topicTitles.includes(h)) {
        topicTitles.push(h);
        if (topicTitles.length >= 15) break;
      }
    }
    if (topicTitles.length === 0) {
      const pt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (pt && stripTags(pt[1] || "")) topicTitles.push(stripTags(pt[1] || ""));
    }
    const rawTextPreview = stripTags(
      html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    ).slice(0, 1500);
    return { ok: true, topicTitles, rawTextPreview };
  } catch (err: any) {
    return { ok: false, topicTitles: [], rawTextPreview: "", error: err?.message ?? String(err) };
  }
}

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
        const handle = handleMatch ? handleMatch[1].replace(/\/+$/, "") : (opts.canonicalUrl.replace(/^@/, "").trim() || null);
        if (!handleMatch && handle && handle.includes(".") && !handle.includes("/")) {
          // Only reject dot-handles if it was NOT extracted from an instagram.com URL and looks like a bare domain
          if (/\.(com|co\.uk|org|net|io|ai|app)$/i.test(handle)) {
            explicitStatus = "SOURCE_INVALID";
            explicitError = `Invalid Instagram handle (looks like domain): ${handle}`;
            break;
          }
        }
        if (!handle) {
          explicitStatus = "SOURCE_INVALID";
          explicitError = `Invalid Instagram URL: ${canonicalUrl}`;
          break;
        }
        const igRes = await scrapeInstagramViaApify(handle, 15);
        itemsCount = igRes.posts.length;

        // Persist Instagram posts with sourceId
        const { ciCompetitorPosts, ciCompetitorComments } = await import("@shared/schema");
        for (const post of igRes.posts) {
          const postDbId = `post_ig_${competitorId}_${post.postId || post.id || Math.random().toString(36).slice(2, 10)}`.slice(0, 60);
          try {
            await db.insert(ciCompetitorPosts).values({
              id: postDbId,
              competitorId,
              accountId,
              sourceId,
              postId: post.postId || post.id || postDbId,
              platform: "instagram",
              permalink: post.permalink || post.url || null,
              mediaType: post.mediaType || "IMAGE",
              caption: post.caption || "",
              likes: post.likes ?? null,
              comments: post.comments ?? null,
              hashtags: Array.isArray(post.hashtags) ? post.hashtags.join(",") : (post.hashtags || null),
              timestamp: post.timestamp ? new Date(post.timestamp) : new Date(),
              batchId: `ig_${Date.now()}`,
            } as any).onConflictDoUpdate({
              target: [ciCompetitorPosts.competitorId, ciCompetitorPosts.postId],
              set: {
                caption: post.caption || "",
                likes: post.likes ?? null,
                comments: post.comments ?? null,
                sourceId,
              }
            });
          } catch (pErr: any) {
            console.warn(`[ProviderRegistry] Instagram post insert error:`, pErr.message);
          }
        }
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
              sourceId,
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
                  sourceId,
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
          await persistExternalEvidenceToDb(liRes.items, { sourceId });
        }
        if (liRes.report.error) {
          explicitError = liRes.report.error;
          explicitStatus = liRes.report.error.startsWith("SOURCE_INVALID") ? "SOURCE_INVALID" : "PROVIDER_FAILED";
        }
        break;
      }
      case "X": {
        const handleMatch = canonicalUrl.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/);
        const handle = handleMatch ? handleMatch[1] : canonicalUrl.replace(/^@/, "").trim();
        if (handle) {
          const xRes = await fetchXEvidence({
            handle,
            campaignId,
            accountId,
            competitorId,
          });
          itemsCount = xRes.items.length;
          if (itemsCount > 0) {
            await persistExternalEvidenceToDb(xRes.items, { sourceId });
          }
          if (xRes.report.error) {
            explicitError = xRes.report.error;
            explicitStatus = xRes.report.error.startsWith("SOURCE_INVALID") ? "SOURCE_INVALID" : "PROVIDER_FAILED";
          }
        }
        break;
      }
      case "FACEBOOK": {
        const fbRes = await fetchFacebookEvidence({
          pageUrl: canonicalUrl,
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = fbRes.items.length;
        if (itemsCount > 0) {
          await persistExternalEvidenceToDb(fbRes.items, { sourceId });
        }
        if (fbRes.report.error) {
          explicitError = fbRes.report.error;
          explicitStatus = fbRes.report.error.startsWith("SOURCE_INVALID") ? "SOURCE_INVALID" : "PROVIDER_FAILED";
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
          await persistYouTubeItemsToCompetitorPosts(ytRes.items, {
            competitorId,
            accountId,
            sourceId,
          });
        }
        if (ytRes.report.error) {
          explicitError = ytRes.report.error;
          explicitStatus = "PROVIDER_FAILED";
        }
        break;
      }
      case "REVIEWS":
      case "TRUSTPILOT":
      case "GOOGLE_REVIEWS":
      case "TRENDYOL":
      case "G2":
      case "CAPTERRA": {
        let platformType: "trustpilot" | "google_maps" | "trendyol" | "g2" | "capterra";
        if (upperPlat === "TRUSTPILOT" || canonicalUrl.includes("trustpilot.com")) {
          platformType = "trustpilot";
        } else if (upperPlat === "TRENDYOL") {
          platformType = "trendyol";
        } else if (upperPlat === "G2") {
          platformType = "g2";
        } else if (upperPlat === "CAPTERRA") {
          platformType = "capterra";
        } else {
          platformType = "google_maps";
        }

        const revRes = await fetchReviewsViaApify({
          targetUrl: canonicalUrl,
          platformType,
          campaignId,
          accountId,
          competitorId,
        });
        itemsCount = revRes.reviews.length;
        commentsCount = revRes.reviews.length;
        if (revRes.report.error) {
          explicitError = revRes.report.error;
          explicitStatus = revRes.report.error.includes("PROVIDER_PENDING") ? "PROVIDER_UNAVAILABLE" : "PROVIDER_FAILED";
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
        const blogRes = await crawlBlogNativeHttp(canonicalUrl);
        if (!blogRes.ok) {
          explicitError = blogRes.error || "Blog extraction failed";
          explicitStatus = "PROVIDER_FAILED";
          itemsCount = 0;
        } else {
          const titles = blogRes.topicTitles?.length ? blogRes.topicTitles : [blogRes.rawTextPreview.slice(0, 120) || canonicalUrl];
          const blogItems = titles.slice(0, 5).map((t, idx) => ({
            id: `ext_blog_${competitorId}_${idx}`,
            platform: "BLOG" as const,
            externalId: `blog_${idx}_${Buffer.from(t).toString("hex").slice(0, 12)}`,
            title: t,
            text: blogRes.rawTextPreview || t,
            url: canonicalUrl,
            authorName: "Competitor Blog",
            publishedAt: new Date().toISOString(),
            campaignId,
            accountId,
            competitorId,
            authorityClass: "COMPETITOR_SELF_CLAIM" as const,
            rawPayload: blogRes,
            fetchedAt: new Date().toISOString(),
          }));
          await persistExternalEvidenceToDb(blogItems as any, { sourceId });
          itemsCount = blogItems.length;
        }
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

/**
 * Persists YouTube video items into ci_competitor_posts so Watchtower, MI, and Competitor Understanding
 * can inspect YouTube channel videos alongside Instagram and TikTok posts.
 */
export async function persistYouTubeItemsToCompetitorPosts(
  items: Array<{
    id?: string;
    url?: string;
    title?: string;
    content?: string;
    author?: string;
    publishedAt?: string | null;
    engagementMetrics?: { views?: number; likes?: number; comments?: number };
    rawPayload?: any;
  }>,
  opts: {
    competitorId: string;
    accountId: string;
    sourceId?: string | null;
  }
): Promise<number> {
  const { competitorId, accountId, sourceId = null } = opts;
  if (!items || items.length === 0) return 0;
  const { ciCompetitorPosts } = await import("@shared/schema");
  let persisted = 0;

  for (const item of items) {
    const raw = item.rawPayload || {};
    const rawVideoId = String(
      raw.id ||
      (item.url ? item.url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/)?.[1] : null) ||
      (item as any).externalId ||
      item.id ||
      Math.random().toString(36).slice(2, 10)
    ).replace(/^yt_/, "");
    const postId = rawVideoId.slice(0, 80);
    const postDbId = `post_youtube_${competitorId}_${rawVideoId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)}`;
    const caption = [item.title, item.content || (item as any).text].filter(Boolean).join(" — ").slice(0, 5000);
    const publishedDate = item.publishedAt ? new Date(item.publishedAt) : new Date();
    const validTimestamp = Number.isNaN(publishedDate.getTime()) ? new Date() : publishedDate;

    try {
      await db
        .insert(ciCompetitorPosts)
        .values({
          id: postDbId,
          competitorId,
          accountId,
          sourceId,
          postId,
          platform: "youtube",
          permalink: item.url || null,
          mediaType: "VIDEO",
          caption,
          likes: item.engagementMetrics?.likes ?? null,
          comments: item.engagementMetrics?.comments ?? null,
          views: item.engagementMetrics?.views ?? null,
          timestamp: validTimestamp,
          hookText: item.title || null,
          hookSource: "youtube_title",
          batchId: `yt_${Date.now()}`,
        } as any)
        .onConflictDoUpdate({
          target: [ciCompetitorPosts.competitorId, ciCompetitorPosts.postId],
          set: {
            caption,
            likes: item.engagementMetrics?.likes ?? null,
            comments: item.engagementMetrics?.comments ?? null,
            views: item.engagementMetrics?.views ?? null,
            sourceId: sourceId ?? undefined,
          },
        });
      persisted++;
    } catch (err: any) {
      console.warn(`[ProviderRegistry] YouTube post insert warning:`, err.message);
    }
  }
  return persisted;
}

export interface AcquisitionTaskDispatchParams {
  id: string;
  campaignId: string;
  accountId: string;
  sourcePlatform: string;
  entityType: string;
  entityId: string;
  taskType: string;
  inputPayload: any;
}

export interface AcquisitionTaskDispatchResult {
  status: "COMPLETED" | "FAILED" | "SKIPPED_PENDING_CONFIG" | "SKIPPED_UNSUPPORTED";
  output?: any;
  error?: string;
}

/**
 * Canonical single dispatch router for all acquisition tasks planned by coordinator.
 * Resolves platform, checks configuration, invokes typed provider adapter, and normalizes output.
 */
export async function dispatchAcquisitionTask(
  task: AcquisitionTaskDispatchParams,
  options: {
    forceRefresh?: boolean;
    orchestrationJobId?: string;
  } = {}
): Promise<AcquisitionTaskDispatchResult> {
  const input = task.inputPayload || {};
  const plat = (task.sourcePlatform || "").toUpperCase();
  const taskType = (task.taskType || "").toUpperCase();

  if (plat === "MARKET_VOICE" && taskType === "SEARCH_QUOTES") {
    const { executeMarketVoiceAcquisition } = await import("../market-voice/pipeline");
    const output = await executeMarketVoiceAcquisition({
      accountId: task.accountId,
      campaignId: task.campaignId,
      jobId: options.orchestrationJobId,
      forceRefresh: options.forceRefresh,
    });
    return { status: "COMPLETED", output };
  }

  const compId = input.competitorId || (task.entityType === "COMPETITOR" ? task.entityId : undefined);

  if (plat === "INSTAGRAM" && taskType === "POSTS") {
    const { fetchCompetitorData } = await import("./data-acquisition");
    const targetCompId = compId || task.entityId;
    const rawUrl = input.canonicalUrl || task.canonicalUrl || "";
    const handleMatch = rawUrl.match(/instagram\.com\/([a-zA-Z0-9_.-]+)/i);
    const derivedHandle = input.handle || (handleMatch ? handleMatch[1].replace(/\/+$/, "") : undefined);
    const output = await fetchCompetitorData(
      targetCompId,
      task.accountId,
      options.forceRefresh ?? false,
      undefined,
      "FAST_PASS",
      {
        sourceId: input.sourceId || (task as any).sourceId,
        handle: derivedHandle,
      } as any
    );
    const sid = input.sourceId || (task as any).sourceId;
    if (sid) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, sid));
    }
    return { status: "COMPLETED", output };
  }

  if (plat === "INSTAGRAM" && taskType === "COMMENTS") {
    const { enrichCompetitorWithComments } = await import("./data-acquisition");
    const output = await enrichCompetitorWithComments(compId || task.entityId, task.accountId, {
      skipCooldown: true,
      forceRefresh: options.forceRefresh,
    });
    return {
      status: "COMPLETED",
      output: {
        ...output,
        commentsStored: output.commentsGenerated,
        itemsStored: output.commentsGenerated,
      },
    };
  }

  if (plat === "TIKTOK" && taskType === "POSTS") {
    const rawCanon = input.canonicalUrl || task.canonicalUrl || "";
    const handle =
      input.handle ||
      input.username ||
      (rawCanon ? extractTiktokHandle(rawCanon) : null);
    if (!handle) {
      return { status: "FAILED", error: "Missing TikTok handle in inputPayload" };
    }
    const targetCompId = compId || task.entityId;
    const res = await executeSourceFetch({
      sourceId: input.sourceId || (task as any).sourceId || `src_tt_${targetCompId}`,
      competitorId: targetCompId,
      campaignId: task.campaignId,
      accountId: task.accountId,
      platform: "TIKTOK",
      canonicalUrl: rawCanon || `https://www.tiktok.com/@${handle}`,
    });
    if (res.status === "PROVIDER_FAILED" || res.status === "SOURCE_INVALID") {
      return { status: "FAILED", error: res.error || res.status, output: res };
    }
    return {
      status: "COMPLETED",
      output: {
        postsCount: res.itemsCount,
        itemsStored: res.itemsCount,
        commentsCount: res.commentsCount,
        status: res.status,
        isConfirmedEmpty: false,
      },
    };
  }

  if (plat === "TIKTOK" && taskType === "COMMENTS") {
    const ttCommRes = await fetchTikTokCommentsViaApify({
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      postUrls: input.postUrls || input.postURLs,
      maxCommentsPerVideo: input.maxCommentsPerVideo ?? input.maxItems ?? 10,
    });
    if (ttCommRes.report.error) {
      return { status: "FAILED", error: ttCommRes.report.error, output: ttCommRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...ttCommRes.report,
        commentsStored: ttCommRes.commentsStored,
      },
    };
  }

  if (plat === "YOUTUBE" && taskType === "POSTS") {
    const channelUrl =
      input.channelUrl ||
      input.canonicalUrl ||
      task.canonicalUrl ||
      (input.query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(input.query)}` : "");
    if (!channelUrl) {
      return { status: "FAILED", error: "Missing YouTube channelUrl in inputPayload" };
    }
    const ytRes = await fetchYouTubeEvidence({
      channelUrl,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
    });
    let persistedIds: string[] = [];
    if (ytRes.items.length > 0 && compId) {
      await persistYouTubeItemsToCompetitorPosts(ytRes.items, {
        competitorId: compId,
        accountId: task.accountId,
        sourceId: input.sourceId || (task as any).sourceId || null,
      });
      persistedIds = ytRes.items.map((item) => {
        const raw = item.rawPayload || {};
        const rawVideoId = String(
          raw.id ||
            (item.url ? item.url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/)?.[1] : null) ||
            (item as any).externalId ||
            item.id ||
            ""
        ).replace(/^yt_/, "");
        return `post_youtube_${compId}_${rawVideoId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30)}`;
      });
    }
    const sid = input.sourceId || (task as any).sourceId;
    if (sid && !ytRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, sid));
    }
    if (ytRes.report.error) {
      return { status: "FAILED", error: ytRes.report.error, output: ytRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...ytRes.report,
        postsStored: ytRes.items.length,
        itemsStored: ytRes.items.length,
        persistedIds: persistedIds.length > 0 ? persistedIds : ytRes.report.persistedIds,
      },
    };
  }

  if (plat === "YOUTUBE" && taskType === "COMMENTS") {
    const ytCommRes = await fetchYouTubeCommentsViaApify({
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      videoUrls: input.videoUrls,
      maxCommentsPerVideo: input.maxCommentsPerVideo ?? input.maxItems ?? 10,
    });
    if (ytCommRes.report.error) {
      return { status: "FAILED", error: ytCommRes.report.error, output: ytCommRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...ytCommRes.report,
        commentsStored: ytCommRes.commentsStored,
      },
    };
  }

  if (plat === "LINKEDIN" && (taskType === "POSTS" || taskType === "FETCH" || taskType === "PROFILE")) {
    const profileUrl = input.profileUrl || input.canonicalUrl || input.url || task.canonicalUrl || input.handle || "";
    const isProfileRequest = taskType === "PROFILE";
    const liRes = await fetchLinkedInEvidence({
      profileUrl,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      capability: isProfileRequest ? "PROFILE" : "POSTS",
      maxPosts: input.maxPosts ?? input.maxItems ?? 10,
    });
    let persistedIds: string[] = [];
    if (isProfileRequest) {
      if (liRes.report.profileDossier) {
        const dossier = liRes.report.profileDossier;
        const normHandle = String(dossier.universalName || dossier.companyId || profileUrl).toLowerCase().trim();
        const existingProf = await db
          .select({ id: ciSharedProfiles.id })
          .from(ciSharedProfiles)
          .where(and(eq(ciSharedProfiles.platform, "linkedin"), eq(ciSharedProfiles.normalizedHandle, normHandle)))
          .limit(1);
        if (existingProf.length > 0) {
          await db
            .update(ciSharedProfiles)
            .set({
              followers: dossier.followerCount ?? null,
              bioText: JSON.stringify(dossier),
              linkInBio: dossier.websiteUrl ?? null,
              lastScrapedAt: new Date(),
              fetchMethod: liRes.report.actorId,
              updatedAt: new Date(),
            })
            .where(eq(ciSharedProfiles.id, existingProf[0].id));
        } else {
          await db.insert(ciSharedProfiles).values({
            platform: "linkedin",
            normalizedHandle: normHandle,
            followers: dossier.followerCount ?? null,
            bioText: JSON.stringify(dossier),
            linkInBio: dossier.websiteUrl ?? null,
            postCount: 0,
            commentCount: 0,
            scrapeQuality: "PROFILE_DOSSIER",
            lastScrapedAt: new Date(),
            fetchMethod: liRes.report.actorId,
          });
        }
      }
    } else if (liRes.items.length > 0 && compId) {
      const pRes = await persistExternalEvidenceToDb(liRes.items, { sourceId: input.sourceId || task.sourceId || null });
      persistedIds = pRes.persistedIds;
    }
    if (input.sourceId && !liRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, input.sourceId));
    }
    if (liRes.report.error) {
      return { status: "FAILED", error: liRes.report.error, output: liRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...liRes.report,
        itemsStored: isProfileRequest ? liRes.report.acceptedCount : liRes.items.length,
        postsStored: isProfileRequest ? 0 : liRes.items.length,
        persistedIds,
      },
    };
  }

  if (plat === "X" && taskType === "PROFILE") {
    const rawTarget = input.handle || input.canonicalUrl || input.url || task.canonicalUrl || "";
    const xProfRes = await fetchXProfileViaApify({
      handle: rawTarget,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
    });
    if (xProfRes.profileDossier) {
      const dossier = xProfRes.profileDossier;
      const normHandle = String(dossier.userName || dossier.userId || rawTarget).toLowerCase().trim();
      const existingProf = await db
        .select({ id: ciSharedProfiles.id })
        .from(ciSharedProfiles)
        .where(and(eq(ciSharedProfiles.platform, "x"), eq(ciSharedProfiles.normalizedHandle, normHandle)))
        .limit(1);
      if (existingProf.length > 0) {
        await db
          .update(ciSharedProfiles)
          .set({
            followers: dossier.followers ?? null,
            bioText: JSON.stringify(dossier),
            linkInBio: dossier.url ?? null,
            postCount: dossier.statusesCount ?? 0,
            lastScrapedAt: new Date(),
            fetchMethod: xProfRes.report.actorId,
            updatedAt: new Date(),
          })
          .where(eq(ciSharedProfiles.id, existingProf[0].id));
      } else {
        await db.insert(ciSharedProfiles).values({
          platform: "x",
          normalizedHandle: normHandle,
          followers: dossier.followers ?? null,
          bioText: JSON.stringify(dossier),
          linkInBio: dossier.url ?? null,
          postCount: dossier.statusesCount ?? 0,
          commentCount: 0,
          scrapeQuality: "PROFILE_DOSSIER",
          lastScrapedAt: new Date(),
          fetchMethod: xProfRes.report.actorId,
        });
      }
    }
    if (input.sourceId && !xProfRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, input.sourceId));
    }
    if (xProfRes.report.error) {
      return { status: "FAILED", error: xProfRes.report.error, output: xProfRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...xProfRes.report,
        itemsStored: xProfRes.report.acceptedCount,
        postsStored: 0,
        profileDossier: xProfRes.profileDossier,
        persistedIds: [],
      },
    };
  }

  if (plat === "X" && (taskType === "POSTS" || taskType === "FETCH")) {
    const rawTarget = input.handle || input.canonicalUrl || input.url || task.canonicalUrl || "";
    const xRes = await fetchXEvidence({
      handle: rawTarget,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      maxTweets: input.maxTweets ?? input.maxItems ?? 10,
    });
    let persistedIds: string[] = [];
    if (xRes.items.length > 0 && compId) {
      const pRes = await persistExternalEvidenceToDb(xRes.items, { sourceId: input.sourceId || task.sourceId || null });
      persistedIds = pRes.persistedIds;
    }
    if (input.sourceId && !xRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, input.sourceId));
    }
    if (xRes.report.error) {
      return { status: "FAILED", error: xRes.report.error, output: xRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...xRes.report,
        postsStored: xRes.items.length,
        persistedIds,
      },
    };
  }

  if (plat === "FACEBOOK" && (taskType === "POSTS" || taskType === "FETCH")) {
    const pageUrl = input.pageUrl || input.canonicalUrl || input.url || task.canonicalUrl || input.handle || "";
    const fbRes = await fetchFacebookEvidence({
      pageUrl,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      maxPosts: input.maxPosts ?? input.maxItems ?? 10,
    });
    let persistedIds: string[] = [];
    if (fbRes.items.length > 0 && compId) {
      const pRes = await persistExternalEvidenceToDb(fbRes.items, { sourceId: input.sourceId || task.sourceId || null });
      persistedIds = pRes.persistedIds;
    }
    if (input.sourceId && !fbRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, input.sourceId));
    }
    if (fbRes.report.error) {
      return { status: "FAILED", error: fbRes.report.error, output: fbRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...fbRes.report,
        postsStored: fbRes.items.length,
        persistedIds,
      },
    };
  }

  if (plat === "BLOG" && (taskType === "POSTS" || taskType === "FETCH" || taskType === "CRAWL")) {
    const blogUrl = input.canonicalUrl || input.url || input.websiteUrl || task.canonicalUrl || "";
    if (!blogUrl) {
      return { status: "FAILED", error: "Missing blog URL in inputPayload" };
    }
    const blogPage = await crawlBlogNativeHttp(blogUrl);
    let persistedIds: string[] = [];
    if (blogPage.ok && (compId || task.entityId)) {
      const titles = blogPage.topicTitles?.length ? blogPage.topicTitles : [blogPage.rawTextPreview?.slice(0, 120) || blogUrl];
      const blogItems = titles.slice(0, 5).map((t, idx) => ({
        id: `ext_blog_${compId || task.entityId}_${idx}`,
        platform: "BLOG" as const,
        externalId: `blog_${idx}_${Buffer.from(t).toString("hex").slice(0, 12)}`,
        title: t,
        text: blogPage.rawTextPreview || t,
        url: blogUrl,
        authorName: input.competitorName || "Competitor Blog",
        publishedAt: new Date().toISOString(),
        campaignId: task.campaignId,
        accountId: task.accountId,
        competitorId: compId || task.entityId,
        authorityClass: "COMPETITOR_SELF_CLAIM" as const,
        rawPayload: blogPage,
        fetchedAt: new Date().toISOString(),
      }));
      const pRes = await persistExternalEvidenceToDb(blogItems as any, { sourceId: input.sourceId || task.sourceId || null });
      persistedIds = pRes.persistedIds;
    }
    if (input.sourceId && blogPage.ok) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, input.sourceId));
    }
    if (!blogPage.ok) {
      return { status: "FAILED", error: blogPage.error || "Blog extraction failed", output: blogPage };
    }
    return {
      status: "COMPLETED",
      output: {
        pagesCrawled: 1,
        postsStored: persistedIds.length || 1,
        persistedIds,
        url: blogUrl,
        extractionStatus: "SUCCESS",
        headlinesCount: blogPage.topicTitles?.length ?? 0,
      },
    };
  }

  if (plat === "GOOGLE_SEARCH" && (taskType === "POSTS" || taskType === "SEARCH_QUOTES" || taskType === "FETCH")) {
    const rawUrlOrQuery = input.query || input.canonicalUrl || input.url || task.canonicalUrl || "";
    const query = decodeURIComponent(
      rawUrlOrQuery.replace(/^https?:\/\/(?:www\.)?google\.com\/search\?q=/i, "")
    ).trim() || "competitor analysis";
    const gRes = await fetchGoogleSearchEvidence({
      query,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      maxResults: input.maxResults ?? input.maxItems ?? 10,
    });
    let persistedIds: string[] = [];
    if (gRes.items.length > 0 && compId) {
      const pRes = await persistExternalEvidenceToDb(gRes.items, { sourceId: input.sourceId || (task as any).sourceId || null });
      persistedIds = pRes.persistedIds;
    }
    const sid = input.sourceId || (task as any).sourceId;
    if (sid && !gRes.report.error) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, sid));
    }
    if (gRes.report.error) {
      return { status: "FAILED", error: gRes.report.error, output: gRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...gRes.report,
        itemsStored: gRes.items.length,
        postsStored: gRes.items.length,
        persistedIds: persistedIds.length > 0 ? persistedIds : gRes.report.persistedIds,
      },
    };
  }

  if (plat === "REDDIT" && (taskType === "SEARCH_QUOTES" || taskType === "POSTS" || taskType === "FETCH")) {
    const { runActorAndGetItems } = await import("../acquisition/apify-client");
    const actorId = process.env.REDDIT_ACTOR_ID || "trudax~reddit-scraper-lite";
    const targetCandidate = input.canonicalUrl || input.url || task.canonicalUrl || "";
    const startUrls = Array.isArray(input.startUrls)
      ? input.startUrls
      : targetCandidate
        ? [{ url: targetCandidate }]
        : undefined;
    const searches = input.query ? [input.query] : input.searches;
    const rRes = await runActorAndGetItems({
      actorId,
      input: {
        ...(startUrls ? { startUrls } : {}),
        ...(searches ? { searches, searchPosts: true } : {}),
        maxItems: input.maxItems ?? 10,
        sort: "top",
      },
      budgetMs: 90_000,
      label: `Reddit-${task.entityId}`,
    });
    let persistedIds: string[] = [];
    if (rRes.items.length > 0 && compId) {
      const redditItems = rRes.items
        .map((it: any, idx: number) => {
          const title = String(it.title || "").trim();
          const body = String(it.body || it.selftext || it.text || "").trim();
          const text = [title, body].filter(Boolean).join(" — ").trim();
          if (!text) return null;
          const externalId = String(it.parsedId || it.id || `rd_${idx}`);
          return {
            id: `ext_reddit_${externalId}`,
            platform: "REDDIT" as const,
            externalId,
            title: title || text.slice(0, 80),
            text,
            url: it.url || "https://www.reddit.com",
            authorName: it.username || "Reddit User",
            publishedAt: it.createdAt ? new Date(it.createdAt).toISOString() : new Date().toISOString(),
            campaignId: task.campaignId,
            accountId: task.accountId,
            competitorId: compId,
            authorityClass: "CATEGORY_COMMUNITY_EVIDENCE" as const,
            engagementMetrics: {
              likes: typeof it.upVotes === "number" ? it.upVotes : null,
              comments: typeof it.numberOfComments === "number" ? it.numberOfComments : null,
            },
            rawPayload: it,
            fetchedAt: new Date().toISOString(),
          };
        })
        .filter(Boolean);
      if (redditItems.length > 0) {
        const pRes = await persistExternalEvidenceToDb(redditItems as any, {
          sourceId: input.sourceId || task.sourceId || null,
        });
        persistedIds = pRes.persistedIds;
      }
    }
    return {
      status: "COMPLETED",
      output: {
        runId: rRes.runId,
        datasetId: rRes.datasetId,
        usageUsd: rRes.usageUsd,
        rawCount: rRes.items.length,
        acceptedCount: persistedIds.length || rRes.items.length,
        itemsCount: persistedIds.length || rRes.items.length,
        persistedIds,
      },
    };
  }

  if ((plat === "GOOGLE_REVIEWS" || plat === "REVIEWS") && taskType === "REVIEWS") {
    const revTargetUrl = input.targetUrl || input.url || input.canonicalUrl || task.canonicalUrl || "";
    if (input.platformType === "trustpilot" || revTargetUrl.includes("trustpilot.com")) {
      const revRes = await fetchReviewsViaApify({
        targetUrl: revTargetUrl,
        platformType: "trustpilot",
        campaignId: task.campaignId,
        accountId: task.accountId,
        competitorId: compId,
        maxReviews: input.maxItems ?? 25,
      });
      if (revRes.report.error) {
        return { status: "FAILED", error: revRes.report.error, output: revRes.report };
      }
      if (input.sourceId) {
        await db
          .update(competitorSources)
          .set({ lastFetchedAt: new Date() })
          .where(eq(competitorSources.id, input.sourceId));
      }
      return { status: "COMPLETED", output: revRes.report };
    } else {
      const { scrapeReviewsForCompetitor } = await import("./reviews-scraper");
      const output = await scrapeReviewsForCompetitor(
        compId || task.entityId,
        task.accountId,
        task.campaignId,
        revTargetUrl
      );
      if (output.error && revTargetUrl) {
        // Fallback to direct fetchReviewsViaApify if competitor record is in isolated/external scope
        const directRev = await fetchReviewsViaApify({
          targetUrl: revTargetUrl,
          platformType: "google_maps",
          campaignId: task.campaignId,
          accountId: task.accountId,
          competitorId: compId,
          maxReviews: input.maxItems ?? 10,
        });
        if (directRev.report.error) {
          return { status: "FAILED", error: directRev.report.error, output: directRev.report };
        }
        return { status: "COMPLETED", output: directRev.report };
      }
      if (output.error) {
        return { status: "FAILED", error: output.error, output };
      }
      if (input.sourceId) {
        await db
          .update(competitorSources)
          .set({ lastFetchedAt: new Date() })
          .where(eq(competitorSources.id, input.sourceId));
      }
      return { status: "COMPLETED", output };
    }
  }

  if (plat === "TRUSTPILOT" && taskType === "REVIEWS") {
    const revRes = await fetchReviewsViaApify({
      targetUrl: input.targetUrl || input.url || input.canonicalUrl || (task as any).canonicalUrl || "",
      platformType: "trustpilot",
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      maxReviews: input.maxItems ?? 25,
    });
    if (revRes.report.error) {
      return { status: "FAILED", error: revRes.report.error, output: revRes.report };
    }
    const sid = input.sourceId || (task as any).sourceId;
    if (sid) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, sid));
    }
    return {
      status: "COMPLETED",
      output: {
        ...revRes.report,
        reviewsStored: revRes.reviewsStored,
        itemsStored: revRes.reviewsStored,
      },
    };
  }

  if (
    (plat === "TRENDYOL" ||
      plat === "TRENDYOL_REVIEWS" ||
      plat === "G2" ||
      plat === "G2_REVIEWS" ||
      plat === "CAPTERRA" ||
      plat === "CAPTERRA_REVIEWS") &&
    taskType === "REVIEWS"
  ) {
    const cleanPlat = plat.replace(/_REVIEWS$/, "");
    const desc = resolveAcquisitionCapability(cleanPlat);
    if (desc.status !== "PRODUCTION_READY") {
      return {
        status: "SKIPPED_PENDING_CONFIG",
        output: { platform: cleanPlat, reason: desc.statusReason || `Actor slot for ${cleanPlat} is not configured` },
      };
    }
    const platformType = cleanPlat.toLowerCase() as any;
    const revRes = await fetchReviewsViaApify({
      targetUrl: input.targetUrl || input.url || input.canonicalUrl || task.canonicalUrl || "",
      platformType,
      campaignId: task.campaignId,
      accountId: task.accountId,
      competitorId: compId,
      maxReviews: input.maxReviews ?? input.maxItems ?? 15,
    });
    if (revRes.report.error) {
      return { status: "FAILED", error: revRes.report.error, output: revRes.report };
    }
    return {
      status: "COMPLETED",
      output: {
        ...revRes.report,
        reviewsStored: revRes.reviewsStored,
        itemsStored: revRes.reviewsStored,
      },
    };
  }

  if ((plat === "WEBSITE" || plat === "COMPETITOR_WEBSITE") && (taskType === "UNDERSTANDING" || taskType === "CRAWL")) {
    const { runCompetitorUnderstandingEngine } = await import("./competitor-understanding-engine");
    const targetCompId = compId || task.entityId;
    const targetWebsiteUrl = input.websiteUrl || input.canonicalUrl || (task as any).canonicalUrl || "";
    const payload = await runCompetitorUnderstandingEngine(
      task.accountId,
      task.campaignId,
      targetCompId,
      targetWebsiteUrl,
      input.competitorName
    );
    const authorityId = payload?.competitorUnderstandingAuthorityId || null;
    const websiteSnapshotId =
      payload?.competitorWebsiteSnapshotId && payload.competitorWebsiteSnapshotId !== "none"
        ? payload.competitorWebsiteSnapshotId
        : null;
    const isComplete = payload?.status === "COMPLETE" && Boolean(websiteSnapshotId) && Boolean(authorityId);

    if (!isComplete) {
      return {
        status: "FAILED",
        error: payload?.reason || "Competitor website crawl/understanding incomplete (missing usable website pages)",
        output: {
          authorityId,
          websiteSnapshotId,
          understandingSnapshotId: authorityId,
          status: payload?.status || "INCOMPLETE",
          reason: payload?.reason || "INCOMPLETE_WEBSITE_EVIDENCE",
          itemsStored: 0,
          persistedIds: [],
        },
      };
    }

    const sid = input.sourceId || (task as any).sourceId;
    if (sid) {
      await db
        .update(competitorSources)
        .set({ lastFetchedAt: new Date() })
        .where(eq(competitorSources.id, sid));
    }

    return {
      status: "COMPLETED",
      output: {
        authorityId,
        snapshotId: websiteSnapshotId,
        websiteSnapshotId,
        understandingSnapshotId: authorityId,
        status: payload.status,
        capabilitiesCount: Array.isArray(payload.capabilities) ? payload.capabilities.length : 0,
        itemsStored: 1,
        persistedIds: [websiteSnapshotId!, authorityId!],
      },
    };
  }

  return { status: "SKIPPED_UNSUPPORTED", output: { platform: task.sourcePlatform, taskType: task.taskType } };
}

