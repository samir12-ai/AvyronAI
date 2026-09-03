import { createHash } from "crypto";
import { 
  type SearchIntentPlatform,
  type SearchIntentExecutionStatus,
  type RawDiscoveryResultDraft,
  type IntentExecutionTelemetry,
  type DiscoveredContentType,
  generateDiscoveryResultId,
} from "@shared/contracts/market-voice";
import { runActorAndGetItems, isApifyAcquisitionConfigured } from "../acquisition/apify-client";

export interface IntentExecutionContext {
  accountId: string;
  campaignId: string;
  campaignOfferingId: string;
  discoveryJobId: string;
  searchIntentId: string;
  query: string;
  targetPlatform: SearchIntentPlatform;
  marketScope: "TARGET_MARKET" | "GLOBAL_CATEGORY";
  targetGeography?: string | null;
  languageHint?: string | null;
  limit?: number;
  budgetMs?: number;
}

export interface ProviderExecutionResult {
  status: SearchIntentExecutionStatus;
  provider: string;
  providerRunId?: string | null;
  providerDatasetId?: string | null;
  approvedQuery: string;
  providerQuery: string;
  results: RawDiscoveryResultDraft[];
  runtimeMs: number;
  retryCount: number;
  error?: string | null;
}

export class NonRetryableProviderError extends Error {
  public readonly isNonRetryable = true;
  constructor(message: string, public readonly status: SearchIntentExecutionStatus = "PROVIDER_UNAVAILABLE") {
    super(message);
    this.name = "NonRetryableProviderError";
  }
}

/**
 * Safely normalizes URLs for structural deduplication without corrupting case-sensitive identity.
 * 
 * Rules:
 * 1. Lowercase scheme/protocol and hostname only.
 * 2. Strip fragment (#...).
 * 3. Remove default ports (80/443).
 * 4. Remove known tracking query parameters (utm_*, fbclid, gclid, ref, igshid, etc.).
 * 5. PRESERVE original case for pathname and remaining query parameter keys and values.
 * 6. Structurally normalize trailing slashes on pathname where safe (length > 1).
 */
export function normalizeCanonicalUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";

    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    const trackingParams = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_source_platform",
      "fbclid", "gclid", "gclsrc", "dclid", "wbraid", "gbraid",
      "ref", "ref_src", "ref_url",
      "igshid", "_ga", "_gl", "mc_eid"
    ]);

    const keysToDelete: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      if (trackingParams.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Executes a search intent through its supported provider adapter with singular bounded retry ownership.
 */
export async function executeSearchIntentByPlatform(
  ctx: IntentExecutionContext
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const limit = ctx.limit || 10;
  const maxRetries = 2;

  let attempt = 0;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    try {
      let result: ProviderExecutionResult;
      switch (ctx.targetPlatform) {
        case "GOOGLE_SEARCH":
          result = await executeGoogleSearch(ctx, limit);
          break;
        case "REDDIT":
          result = await executeRedditSearch(ctx, limit);
          break;
        case "YOUTUBE_SEARCH":
          result = await executeYouTubeSearch(ctx, limit);
          break;
        case "WEB_FORUMS":
          result = await executeWebForumsSearch(ctx, limit);
          break;
        case "INSTAGRAM":
          result = await executeInstagramSearch(ctx, limit);
          break;
        case "TIKTOK":
          result = await executeTikTokSearch(ctx, limit);
          break;
        default:
          return {
            status: "PROVIDER_UNAVAILABLE",
            provider: "unknown",
            approvedQuery: ctx.query,
            providerQuery: ctx.query,
            results: [],
            runtimeMs: Date.now() - startedAt,
            retryCount: 0,
            error: `Unsupported target platform: ${ctx.targetPlatform}`,
          };
      }

      return {
        ...result,
        runtimeMs: Date.now() - startedAt,
        retryCount: attempt,
      };
    } catch (err: any) {
      if (err instanceof NonRetryableProviderError) {
        return {
          status: err.status,
          provider: getProviderNameForPlatform(ctx.targetPlatform),
          approvedQuery: ctx.query,
          providerQuery: ctx.query,
          results: [],
          runtimeMs: Date.now() - startedAt,
          retryCount: attempt,
          error: err.message,
        };
      }

      lastError = err;
      if (attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } else {
        break;
      }
    }
  }

  return {
    status: "PROVIDER_FAILED",
    provider: getProviderNameForPlatform(ctx.targetPlatform),
    approvedQuery: ctx.query,
    providerQuery: ctx.query,
    results: [],
    runtimeMs: Date.now() - startedAt,
    retryCount: maxRetries,
    error: lastError?.message || "Provider execution failed after retries",
  };
}

function getProviderNameForPlatform(platform: SearchIntentPlatform): string {
  switch (platform) {
    case "GOOGLE_SEARCH": return "apify~google-search-scraper";
    case "REDDIT": return "reddit_public_api";
    case "YOUTUBE_SEARCH": return "apify~youtube-scraper";
    case "WEB_FORUMS": return "apify~google-search-scraper";
    case "INSTAGRAM": return "apify~instagram-scraper";
    case "TIKTOK": return "apify~clockworks-tiktok-scraper";
    default: return "unknown";
  }
}

/**
 * Executes a single attempt for Google Search SERP discovery.
 * Exact approved query is executed without appending geography text.
 * Results default to neutral "WEB_PAGE" (or "FORUM_THREAD" if matching forum patterns).
 */
async function executeGoogleSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const actorId = process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper";

  if (!isApifyAcquisitionConfigured()) {
    throw new NonRetryableProviderError("APIFY_API_KEY is not configured", "PROVIDER_UNAVAILABLE");
  }

  const approvedQuery = ctx.query;
  const providerQuery = ctx.query;

  const inputPayload: Record<string, any> = {
    queries: providerQuery,
    maxPagesPerQuery: 1,
    resultsPerPage: limit,
  };

  if (ctx.targetGeography) {
    inputPayload.countryCode = ctx.targetGeography.toLowerCase();
  }

  const run = await runActorAndGetItems({
    actorId,
    input: inputPayload,
    budgetMs: ctx.budgetMs || 60000,
    label: `MarketVoice-Google-${ctx.searchIntentId}`,
  });

  const results: RawDiscoveryResultDraft[] = [];

  for (const page of run.items) {
    const organic = Array.isArray(page?.organicResults) ? page.organicResults : [];
    for (const res of organic) {
      const url = res.url || res.link;
      if (!url) continue;

      const canonicalUrl = normalizeCanonicalUrl(url);
      const title = res.title || null;
      const snippet = res.description || res.snippet || null;

      let discoveredType: DiscoveredContentType = "WEB_PAGE";
      if (url.includes("forum") || url.includes("community") || url.includes("thread") || url.includes("topic") || url.includes("board")) {
        discoveredType = "FORUM_THREAD";
      }

      results.push({
        url,
        canonicalUrl,
        title,
        snippet,
        sourcePlatform: "google_serp",
        discoveredType,
        verificationStatus: "DISCOVERED",
        externalItemId: url,
        providerRunId: run.runId,
        providerDatasetId: run.datasetId,
        authorIdentifier: res.displayedUrl || null,
        publishedAt: res.date ? new Date(res.date) : null,
        metadata: {
          rank: res.position || null,
          approvedQuery,
          providerQuery,
          platform: "GOOGLE_SEARCH",
          marketScope: ctx.marketScope,
          targetGeography: ctx.targetGeography,
        },
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return {
    status: results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: actorId,
    providerRunId: run.runId,
    providerDatasetId: run.datasetId,
    approvedQuery,
    providerQuery,
    results,
    runtimeMs: Date.now() - startedAt,
    retryCount: 0,
  };
}

/**
 * Executes a single attempt for Reddit search using the canonical Reddit adapter.
 */
export async function executeRedditSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const { searchRedditDiscussions } = await import("./reddit-adapter");
  const resp = await searchRedditDiscussions(ctx.query, limit, {
    budgetMs: ctx.budgetMs,
    marketScope: ctx.marketScope,
    targetGeography: ctx.targetGeography,
  });

  if (resp.error) {
    if (resp.error.includes("not configured") || resp.error.includes("blocked")) {
      throw new NonRetryableProviderError(resp.error, "PROVIDER_UNAVAILABLE");
    }
    throw new Error(resp.error);
  }

  return {
    status: resp.results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: resp.provider,
    providerRunId: resp.providerRunId,
    providerDatasetId: resp.providerDatasetId,
    approvedQuery: ctx.query.trim(),
    providerQuery: ctx.query.trim(),
    results: resp.results,
    runtimeMs: resp.runtimeMs,
    retryCount: 0,
  };
}

/**
 * Executes a single attempt for YouTube search discovery.
 * Results use neutral structural type "YOUTUBE_VIDEO" (not REVIEW_PAGE).
 */
async function executeYouTubeSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const actorId = process.env.YOUTUBE_ACTOR_ID || "streamers~youtube-scraper";

  if (!isApifyAcquisitionConfigured()) {
    throw new NonRetryableProviderError("APIFY_API_KEY is not configured", "PROVIDER_UNAVAILABLE");
  }

  const approvedQuery = ctx.query;
  const providerQuery = ctx.query;

  const run = await runActorAndGetItems({
    actorId,
    input: {
      searchKeywords: [providerQuery],
      maxResults: limit,
    },
    budgetMs: ctx.budgetMs || 60000,
    label: `MarketVoice-YouTube-${ctx.searchIntentId}`,
  });

  const results: RawDiscoveryResultDraft[] = [];

  for (const item of run.items) {
    const url = item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
    if (!url) continue;

    results.push({
      url,
      canonicalUrl: normalizeCanonicalUrl(url),
      title: item.title || null,
      snippet: item.description || item.text || null,
      sourcePlatform: "youtube",
      discoveredType: "YOUTUBE_VIDEO",
      verificationStatus: "DISCOVERED",
      externalItemId: item.id || url,
      providerRunId: run.runId,
      providerDatasetId: run.datasetId,
      authorIdentifier: item.channelTitle || item.channelName || null,
      publishedAt: item.date || item.uploadedAt ? new Date(item.date || item.uploadedAt) : null,
      metadata: {
        viewCount: item.viewCount || null,
        likes: item.likes || null,
        approvedQuery,
        providerQuery,
        platform: "YOUTUBE_SEARCH",
      },
    });

    if (results.length >= limit) break;
  }

  return {
    status: results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: actorId,
    providerRunId: run.runId,
    providerDatasetId: run.datasetId,
    approvedQuery,
    providerQuery,
    results,
    runtimeMs: Date.now() - startedAt,
    retryCount: 0,
  };
}

/**
 * Executes a single attempt for Web Forums search using search syntax.
 * Preserves approvedQuery vs providerQuery lineage.
 */
export async function executeWebForumsSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const actorId = process.env.GOOGLE_SEARCH_ACTOR_ID || "apify~google-search-scraper";

  if (!isApifyAcquisitionConfigured()) {
    throw new NonRetryableProviderError("APIFY_API_KEY is not configured", "PROVIDER_UNAVAILABLE");
  }

  const approvedQuery = ctx.query;
  const providerQuery = `${ctx.query} (inurl:forum OR inurl:thread OR inurl:discussion OR inurl:questions) -site:facebook.com -site:instagram.com -site:tiktok.com -site:youtube.com -site:pinterest.com`;

  const run = await runActorAndGetItems({
    actorId,
    input: {
      queries: providerQuery,
      maxPagesPerQuery: 1,
      resultsPerPage: limit,
    },
    budgetMs: ctx.budgetMs || 60000,
    label: `MarketVoice-Forums-${ctx.searchIntentId}`,
  });

  const results: RawDiscoveryResultDraft[] = [];

  for (const page of run.items) {
    const organic = Array.isArray(page?.organicResults) ? page.organicResults : [];
    for (const res of organic) {
      const url = res.url || res.link;
      if (!url) continue;

      results.push({
        url,
        canonicalUrl: normalizeCanonicalUrl(url),
        title: res.title || null,
        snippet: res.description || res.snippet || null,
        sourcePlatform: "web_community",
        discoveredType: "FORUM_THREAD",
        verificationStatus: "DISCOVERED",
        externalItemId: url,
        providerRunId: run.runId,
        providerDatasetId: run.datasetId,
        authorIdentifier: res.displayedUrl || null,
        publishedAt: res.date ? new Date(res.date) : null,
        metadata: {
          rank: res.position || null,
          approvedQuery,
          providerQuery,
          platform: "WEB_FORUMS",
        },
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return {
    status: results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: actorId,
    providerRunId: run.runId,
    providerDatasetId: run.datasetId,
    approvedQuery,
    providerQuery,
    results,
    runtimeMs: Date.now() - startedAt,
    retryCount: 0,
  };
}

/**
 * Executes a single attempt for Instagram discovery.
 * Strictly respects input modes:
 * - Query starting with '#' -> hashtag search
 * - Query starting with '@' -> profile / user search
 * - Natural language queries -> explore top search or explicit capability state without converting to hashtag.
 */
async function executeInstagramSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const actorId = process.env.INSTAGRAM_SEARCH_ACTOR_ID || "apify~instagram-scraper";

  if (!isApifyAcquisitionConfigured()) {
    throw new NonRetryableProviderError("APIFY_API_KEY is not configured", "PROVIDER_UNAVAILABLE");
  }

  const approvedQuery = ctx.query.trim();
  let searchType = "top";
  let cleanQuery = approvedQuery;

  if (approvedQuery.startsWith("#")) {
    searchType = "hashtag";
    cleanQuery = approvedQuery.replace(/^#+/, "").trim();
  } else if (approvedQuery.startsWith("@")) {
    searchType = "user";
    cleanQuery = approvedQuery.replace(/^@+/, "").trim();
  }

  const providerQuery = cleanQuery;

  const run = await runActorAndGetItems({
    actorId,
    input: {
      search: providerQuery,
      searchType,
      resultsLimit: limit,
    },
    budgetMs: ctx.budgetMs || 60000,
    label: `MarketVoice-Instagram-${ctx.searchIntentId}`,
  });

  const results: RawDiscoveryResultDraft[] = [];

  for (const item of run.items) {
    const url = item.url || item.postUrl || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}` : null);
    if (!url) continue;

    results.push({
      url,
      canonicalUrl: normalizeCanonicalUrl(url),
      title: item.caption ? item.caption.slice(0, 100) : "Instagram Post",
      snippet: item.caption || null,
      sourcePlatform: "instagram",
      discoveredType: "INSTAGRAM_POST",
      verificationStatus: "DISCOVERED",
      externalItemId: item.id || item.shortCode || url,
      providerRunId: run.runId,
      providerDatasetId: run.datasetId,
      authorIdentifier: item.ownerUsername || item.author || null,
      publishedAt: item.timestamp ? new Date(item.timestamp) : null,
      metadata: {
        likesCount: item.likesCount || null,
        commentsCount: item.commentsCount || null,
        approvedQuery,
        providerQuery,
        platform: "INSTAGRAM",
        searchType,
      },
    });

    if (results.length >= limit) break;
  }

  return {
    status: results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: actorId,
    providerRunId: run.runId,
    providerDatasetId: run.datasetId,
    approvedQuery,
    providerQuery,
    results,
    runtimeMs: Date.now() - startedAt,
    retryCount: 0,
  };
}

/**
 * Executes a single attempt for TikTok discovery.
 * Uses neutral media types "TIKTOK_VIDEO" or "TIKTOK_PROFILE".
 */
async function executeTikTokSearch(
  ctx: IntentExecutionContext,
  limit: number
): Promise<ProviderExecutionResult> {
  const startedAt = Date.now();
  const actorId = process.env.TIKTOK_SEARCH_ACTOR_ID || "clockworks~free-tiktok-scraper";

  if (!isApifyAcquisitionConfigured()) {
    throw new NonRetryableProviderError("APIFY_API_KEY is not configured", "PROVIDER_UNAVAILABLE");
  }

  const approvedQuery = ctx.query;
  const providerQuery = ctx.query;

  const run = await runActorAndGetItems({
    actorId,
    input: {
      searchQueries: [providerQuery],
      resultsPerPage: limit,
      excludePinnedPosts: false,
    },
    budgetMs: ctx.budgetMs || 60000,
    label: `MarketVoice-TikTok-${ctx.searchIntentId}`,
  });

  const results: RawDiscoveryResultDraft[] = [];

  for (const item of run.items) {
    const url = item.webVideoUrl || (item.id && item.authorMeta?.name ? `https://www.tiktok.com/@${item.authorMeta.name}/video/${item.id}` : null);
    if (!url) continue;

    results.push({
      url,
      canonicalUrl: normalizeCanonicalUrl(url),
      title: item.desc ? item.desc.slice(0, 100) : "TikTok Video",
      snippet: item.desc || item.text || null,
      sourcePlatform: "tiktok",
      discoveredType: "TIKTOK_VIDEO",
      verificationStatus: "DISCOVERED",
      externalItemId: item.id || url,
      providerRunId: run.runId,
      providerDatasetId: run.datasetId,
      authorIdentifier: item.authorMeta?.name || item.authorMeta?.nickName || null,
      publishedAt: item.createTimeISO ? new Date(item.createTimeISO) : (item.createTime ? new Date(item.createTime * 1000) : null),
      metadata: {
        diggCount: item.diggCount || null,
        commentCount: item.commentCount || null,
        shareCount: item.shareCount || null,
        playCount: item.playCount || null,
        approvedQuery,
        providerQuery,
        platform: "TIKTOK",
      },
    });

    if (results.length >= limit) break;
  }

  return {
    status: results.length > 0 ? "COMPLETED" : "NO_RESULTS",
    provider: actorId,
    providerRunId: run.runId,
    providerDatasetId: run.datasetId,
    approvedQuery,
    providerQuery,
    results,
    runtimeMs: Date.now() - startedAt,
    retryCount: 0,
  };
}

