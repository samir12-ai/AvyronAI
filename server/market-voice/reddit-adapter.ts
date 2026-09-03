import {
  type RawDiscoveryResultDraft,
  type FetchedContentItem,
  type FetchExecutionStatus,
  normalizeCanonicalUrl,
} from "@shared/contracts/market-voice";
import { runActorAndGetItems, isApifyAcquisitionConfigured } from "../acquisition/apify-client";

export const CANONICAL_REDDIT_ACTOR_ID = process.env.REDDIT_ACTOR_ID || "trudax~reddit-scraper-lite";

export interface RedditSearchResponse {
  results: RawDiscoveryResultDraft[];
  provider: string;
  providerRunId?: string | null;
  providerDatasetId?: string | null;
  runtimeMs: number;
  error?: string | null;
}

export interface RedditThreadFetchResponse {
  fetchStatus: FetchExecutionStatus;
  postTitle?: string;
  contentItems: FetchedContentItem[];
  error?: string | null;
}

/**
 * Executes a Reddit search query using the canonical Reddit adapter.
 * Tries direct unauthenticated JSON endpoint first; falls back to dedicated Apify actor.
 */
export async function searchRedditDiscussions(
  query: string,
  limit: number = 10,
  options?: { budgetMs?: number; marketScope?: "TARGET_MARKET" | "GLOBAL_CATEGORY"; targetGeography?: string | null }
): Promise<RedditSearchResponse> {
  const startedAt = Date.now();
  const cleanQuery = query.trim();
  const marketScope = options?.marketScope || "GLOBAL_CATEGORY";

  // 1. Try direct Reddit JSON API first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options?.budgetMs || 8000);
    const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(cleanQuery)}&sort=relevance&limit=${limit}`;

    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AvyronMarketVoice/1.0",
        "Accept": "application/json",
      },
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const children = data?.data?.children || [];
      const results: RawDiscoveryResultDraft[] = [];

      for (const child of children) {
        const p = child?.data;
        if (!p || !p.title) continue;

        const permalink = p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url || "");
        if (!permalink) continue;

        results.push({
          url: permalink,
          canonicalUrl: normalizeCanonicalUrl(permalink),
          title: p.title,
          snippet: (p.selftext || "").slice(0, 500) || null,
          sourcePlatform: "reddit",
          discoveredType: "COMMUNITY_POST",
          verificationStatus: "DISCOVERED",
          externalItemId: p.name || p.id || permalink,
          providerRunId: "reddit_native_api",
          authorIdentifier: p.author || null,
          publishedAt: p.created_utc ? new Date(p.created_utc * 1000) : null,
          metadata: {
            subreddit: p.subreddit,
            ups: p.ups,
            numComments: p.num_comments,
            approvedQuery: cleanQuery,
            providerQuery: cleanQuery,
            platform: "REDDIT",
            marketScope,
          },
        });

        if (results.length >= limit) break;
      }

      if (results.length > 0) {
        return {
          results,
          provider: "reddit_public_api",
          providerRunId: "reddit_native_api",
          runtimeMs: Date.now() - startedAt,
        };
      }
    }
  } catch (err) {
    // Fall through to Apify actor
  }

  // 2. Fallback to Canonical Apify Reddit Actor
  if (isApifyAcquisitionConfigured()) {
    try {
      const run = await runActorAndGetItems({
        actorId: CANONICAL_REDDIT_ACTOR_ID,
        input: {
          searches: [cleanQuery],
          type: "posts",
          maxItems: limit,
          sort: "relevance",
        },
        budgetMs: options?.budgetMs || 60000,
        label: `MarketVoice-Reddit-${cleanQuery.slice(0, 20)}`,
      });

      const results: RawDiscoveryResultDraft[] = [];
      for (const item of run.items) {
        const rawUrl = item.url || item.permalink || item.link;
        if (!rawUrl) continue;

        const title = item.title || item.name || null;
        const text = item.body || item.text || item.selftext || item.description || null;

        results.push({
          url: rawUrl,
          canonicalUrl: normalizeCanonicalUrl(rawUrl),
          title,
          snippet: text ? text.slice(0, 500) : null,
          sourcePlatform: "reddit",
          discoveredType: "COMMUNITY_POST",
          verificationStatus: "DISCOVERED",
          externalItemId: item.id || item.parsedId || rawUrl,
          providerRunId: run.runId,
          providerDatasetId: run.datasetId,
          authorIdentifier: item.username || item.author || null,
          publishedAt: item.createdAt ? new Date(item.createdAt) : null,
          metadata: {
            approvedQuery: cleanQuery,
            providerQuery: cleanQuery,
            platform: "REDDIT",
            marketScope,
            communityName: item.communityName || item.displayName || null,
            score: item.score || item.ups || 0,
            numberOfComments: item.numberOfComments || item.numComments || 0,
          },
        });

        if (results.length >= limit) break;
      }

      return {
        results,
        provider: CANONICAL_REDDIT_ACTOR_ID,
        providerRunId: run.runId,
        providerDatasetId: run.datasetId,
        runtimeMs: Date.now() - startedAt,
      };
    } catch (actorErr: any) {
      return {
        results: [],
        provider: CANONICAL_REDDIT_ACTOR_ID,
        runtimeMs: Date.now() - startedAt,
        error: actorErr.message,
      };
    }
  }

  return {
    results: [],
    provider: "unknown",
    runtimeMs: Date.now() - startedAt,
    error: "Reddit public API blocked and APIFY_API_KEY not configured",
  };
}

/**
 * Fetches a Reddit thread and its comments using the canonical Reddit adapter.
 */
export async function fetchRedditThread(
  canonicalUrl: string,
  maxComments: number = 25,
  budgetMs: number = 60000
): Promise<RedditThreadFetchResponse> {
  // 1. Try direct JSON API with raw_json=1
  try {
    const jsonUrl = canonicalUrl.split("?")[0].replace(/\/+$/, "") + ".json?raw_json=1&limit=" + maxComments;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(budgetMs, 8000));

    const resp = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AvyronMarketVoice/1.0",
        "Accept": "application/json",
      },
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      const contentItems: FetchedContentItem[] = [];

      const postData = data?.[0]?.data?.children?.[0]?.data;
      const postTitle = postData?.title || "";
      const postSelftext = postData?.selftext || "";

      if (postSelftext && postSelftext.trim().length > 20 && postSelftext !== "[removed]" && postSelftext !== "[deleted]") {
        contentItems.push({
          itemId: postData.id || `post_${Date.now()}`,
          sourceUrl: canonicalUrl,
          sourcePlatform: "reddit",
          verbatimText: `${postTitle}\n\n${postSelftext}`.trim(),
          authorIdentifier: postData.author || null,
          publishedAt: postData.created_utc ? new Date(postData.created_utc * 1000) : null,
          likesCount: postData.ups || 0,
          metadata: {
            subreddit: postData.subreddit,
            numComments: postData.num_comments,
            isOp: true,
          },
        });
      }

      const commentChildren = data?.[1]?.data?.children || [];
      for (const c of commentChildren) {
        const cd = c?.data;
        if (!cd || !cd.body) continue;

        const body = cd.body.trim();
        const author = cd.author || "";

        if (
          author === "AutoModerator" ||
          author.toLowerCase().includes("bot") ||
          body === "[deleted]" ||
          body === "[removed]" ||
          body.length < 10
        ) {
          continue;
        }

        contentItems.push({
          itemId: cd.id || `comment_${Date.now()}_${contentItems.length}`,
          sourceUrl: cd.permalink ? `https://www.reddit.com${cd.permalink}` : canonicalUrl,
          sourcePlatform: "reddit",
          verbatimText: body,
          authorIdentifier: author || null,
          publishedAt: cd.created_utc ? new Date(cd.created_utc * 1000) : null,
          likesCount: cd.ups || 0,
          metadata: {
            subreddit: cd.subreddit,
            parentId: cd.parent_id,
            isOp: false,
          },
        });
      }

      if (contentItems.length > 0) {
        return {
          fetchStatus: "FETCHED",
          pageTitle: postTitle,
          contentItems,
        };
      }
    }
  } catch (err) {
    // Fall through to Apify actor
  }

  // 2. Fallback to Canonical Apify Reddit Actor for Thread/Comment fetching
  if (isApifyAcquisitionConfigured()) {
    try {
      const run = await runActorAndGetItems({
        actorId: CANONICAL_REDDIT_ACTOR_ID,
        input: {
          startUrls: [{ url: canonicalUrl }],
          maxItems: maxComments,
          sort: "top",
        },
        budgetMs,
        label: `MarketVoice-Fetch-RedditThread`,
      });

      const contentItems: FetchedContentItem[] = [];
      let postTitle = "";

      for (const item of run.items) {
        const text = (item.body || item.text || item.selftext || item.description || "").trim();
        if (!text || text.length < 10 || text === "[deleted]" || text === "[removed]") continue;

        if (item.title && !postTitle) {
          postTitle = item.title;
        }

        const author = item.username || item.author || null;
        if (author === "AutoModerator" || (author && author.toLowerCase().includes("bot"))) {
          continue;
        }

        const verbatimText = item.title && item.body ? `${item.title}\n\n${item.body}`.trim() : text;

        contentItems.push({
          itemId: item.id || item.parsedId || `item_${contentItems.length + 1}`,
          sourceUrl: item.url || canonicalUrl,
          sourcePlatform: "reddit",
          verbatimText,
          authorIdentifier: author,
          publishedAt: item.createdAt ? new Date(item.createdAt) : null,
          likesCount: item.score || item.ups || 0,
          metadata: {
            communityName: item.communityName || item.parsedCommunityName,
            dataType: item.dataType,
          },
        });
      }

      return {
        fetchStatus: contentItems.length > 0 ? "FETCHED" : "SOURCE_UNAVAILABLE",
        pageTitle: postTitle,
        contentItems,
      };
    } catch (actorErr: any) {
      return {
        fetchStatus: "FETCH_FAILED",
        contentItems: [],
        error: `Apify Reddit scraper failed: ${actorErr.message}`,
      };
    }
  }

  return {
    fetchStatus: "FETCH_FAILED",
    contentItems: [],
    error: "Reddit direct API blocked with 403 and Apify not configured",
  };
}
