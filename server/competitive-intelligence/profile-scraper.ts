/**
 * Instagram profile + comment scraping — Apify-only (P-6.12, 2026-07-28).
 *
 * HISTORY: this module used to hold the Bright Data Unlocker ladder
 * (WEB_API → HTML_PARSE → headless-retired) plus a comment ladder
 * (scrapePostComments / V1 / FromHTML). Bright Data's Unlocker stopped
 * passing Instagram endpoints fleet-wide ~2026-07-19 (synthesized 400 +
 * canned "obsolete endpoint" interception), so every rung was dead at the
 * provider level. P-6.12 removed the Bright Data transport entirely:
 *   - profiles/posts  → apify~instagram-profile-scraper (instagram-apify-scraper.ts)
 *   - comments        → apify~instagram-comment-scraper (server/acquisition/instagram-comments.ts)
 * There is NO Bright Data fallback anywhere — not disabled, not flag-gated:
 * the transport code no longer exists in the codebase.
 *
 * Preserved seals:
 *   P4 tenant isolation — profileCache / rateLimitMap / batchCounters are all
 *   namespaced by accountId via nsCacheKey (tripwired in scrape-security tests).
 *   Fix #1a failure classification — GENUINE_BLOCK only on unambiguous
 *   auth/403/challenge walls; Apify-side errors are sanitized so they can
 *   never stamp a 24h Instagram platform-block cooldown.
 */

export interface ScrapedPost {
  postId: string;
  permalink: string;
  mediaType: "REEL" | "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
  timestamp: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  videoUrl: string | null;
  displayUrl: string | null;
  shortcode: string;
}

export interface ScrapedComment {
  commentId: string;
  postId: string;
  shortcode: string;
  text: string;
  username: string;
  timestamp: string | null;
  likes: number;
  /** P-6.12 — reply-thread size from the comment actor (null pre-migration). */
  repliesCount?: number | null;
}

export interface ScrapeResult {
  success: boolean;
  posts: ScrapedPost[];
  /** Always [] since 2026-07-26: the Apify profile actor returns no comment
   *  threads. Comments are acquired by the dedicated comment actor. Field kept
   *  so downstream consumers need no shape change. */
  embeddedComments: ScrapedComment[];
  followers: number | null;
  profileName: string | null;
  collectionMethodUsed: "WEB_API" | "HTML_PARSE" | "HEADLESS_RENDER" | "APIFY_ACTOR" | "NONE";
  attempts: string[];
  warnings: string[];
  paginationPages?: number;
  rawFetchedCount?: number;
  paginationStopReason?: string;
  // Fix #1a — failure classification (B4: explicit over hidden ambiguity).
  // "NONE": success OR healthy-but-empty (transport reached the platform, just
  // no posts). "GENUINE_BLOCK": a verified auth/challenge/403 wall — the ONLY
  // class permitted to persist a 24h platform-block cooldown. "TRANSIENT":
  // timeout / breaker-open / unknown — retry next cycle, never a persistent block.
  failureClass: "NONE" | "GENUINE_BLOCK" | "TRANSIENT";
}

export interface CommentScrapeResult {
  success: boolean;
  comments: ScrapedComment[];
  shortcode: string;
  totalAvailable: number | null;
  /** P-6.12 — per-URL actor error (e.g. "no_items" on a deleted post). */
  errorReason?: string;
}

export type PaginationStopReason =
  | "NO_MORE_PAGES"
  | "TARGET_REACHED"
  | "MAX_PAGES_REACHED"
  | "INSTAGRAM_API_CEILING"
  | "FEED_PAGINATION_AUTH_REQUIRED"
  | "FEED_PAGINATION_BLOCKED"
  | "FEED_PAGINATION_SUCCESS"
  | "ACCOUNT_PRIVATE"
  | "PROXY_BLOCKED"
  | "NO_USER_ID"
  | "RATE_LIMITED"
  | "UNKNOWN_FAILURE";

/**
 * Fix #1a — distinguish a genuine platform block from transient contention,
 * from the raw transport error message. Only unambiguous auth/challenge/403
 * walls return GENUINE_BLOCK; everything else is TRANSIENT (conservative —
 * favours retry over lock, per B3 safe-degradation).
 */
export function classifyScrapeFailure(message: string): "GENUINE_BLOCK" | "TRANSIENT" {
  const m = (typeof message === "string" ? message : "").toLowerCase();
  if (
    m.includes("403") ||
    m.includes("401") ||
    m.includes("forbidden") ||
    m.includes("require_login") ||
    m.includes("login_required") ||
    m.includes("login required") ||
    m.includes("challenge") ||
    m.includes("checkpoint")
  ) {
    return "GENUINE_BLOCK";
  }
  return "TRANSIENT";
}

export interface ScrapeStats {
  totalRequests: number;
  webApiSuccess: number; // legacy rung — always 0 post-migration, kept for shape stability
  htmlParseSuccess: number; // legacy rung — always 0 post-migration
  headlessRenderSuccess: number; // legacy rung — always 0 post-migration
  apifyActorSuccess: number;
  scrapeBlocked: number;
  totalBytesEstimated: number;
  lastReset: number;
}

const scrapeStats: ScrapeStats = {
  totalRequests: 0,
  webApiSuccess: 0,
  htmlParseSuccess: 0,
  headlessRenderSuccess: 0,
  apifyActorSuccess: 0,
  scrapeBlocked: 0,
  totalBytesEstimated: 0,
  lastReset: Date.now(),
};

export function getScrapeStats(): ScrapeStats & { successRate: string; blockedRate: string; bandwidthMB: string } {
  const total = scrapeStats.totalRequests || 1;
  return {
    ...scrapeStats,
    successRate: `${(((scrapeStats.webApiSuccess + scrapeStats.htmlParseSuccess + scrapeStats.headlessRenderSuccess + scrapeStats.apifyActorSuccess) / total) * 100).toFixed(1)}%`,
    blockedRate: `${((scrapeStats.scrapeBlocked / total) * 100).toFixed(1)}%`,
    bandwidthMB: `${(scrapeStats.totalBytesEstimated / (1024 * 1024)).toFixed(2)} MB`,
  };
}

const MAX_BATCH_SIZE = 10;
const BATCH_WINDOW_MS = 60 * 60 * 1000;

// P4 isolation seal: per-account batch counter, profile cache, and rate-limit
// map. Every observable bucket is keyed by accountId so one tenant's
// CACHE_HIT / RATE_LIMITED / BATCH_LIMIT state cannot influence another.
const batchCounters = new Map<string, { count: number; resetAt: number }>();

function checkBatchLimit(accountId: string): boolean {
  const now = Date.now();
  let bucket = batchCounters.get(accountId);
  if (!bucket || now - bucket.resetAt > BATCH_WINDOW_MS) {
    bucket = { count: 0, resetAt: now };
    batchCounters.set(accountId, bucket);
  }
  if (bucket.count >= MAX_BATCH_SIZE) {
    return false;
  }
  bucket.count++;
  return true;
}

const profileCache = new Map<string, { data: ScrapeResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000;

function nsCacheKey(accountId: string, base: string): string {
  return `${accountId}::${base}`;
}

export function normalizeInstagramUrl(url: string): string {
  let handle = url.trim();
  handle = handle.split("?")[0].split("#")[0];
  handle = handle.replace(/\/$/, "");
  const match = handle.match(/instagram\.com\/([^\/\?#]+)/);
  if (match) handle = match[1];
  handle = handle.replace(/^@/, "").toLowerCase();
  return `https://www.instagram.com/${handle}/`;
}

export function extractHandleFromUrl(url: string): string {
  let cleaned = url.trim().split("?")[0].split("#")[0];
  const match = cleaned.match(/instagram\.com\/([^\/\?#]+)/);
  return (match ? match[1] : url.replace(/^@/, "").split("/")[0]).toLowerCase();
}

const TARGET_POSTS = 12;

/**
 * Scrape an Instagram profile (posts + follower count) via the Apify profile
 * actor. Signature kept compatible with the pre-migration ladder:
 * `_legacyProxyCtx` and `_legacyOpts` are accepted and ignored (the sticky
 * proxy-session and allowApifyFallback concepts died with Bright Data — Apify
 * is now the ONLY transport, on every call path).
 */
export async function scrapeInstagramProfile(
  rawUrl: string,
  _legacyProxyCtx?: unknown,
  maxPosts: number = TARGET_POSTS,
  accountId: string = "unknown",
  _legacyOpts?: { allowApifyFallback?: boolean },
): Promise<ScrapeResult> {
  const handle = extractHandleFromUrl(rawUrl);
  // P4 isolation seal: namespace cache + rate-limit keys by accountId.
  const cacheKey = nsCacheKey(accountId, `instagram:${handle}`);
  const rateKey = nsCacheKey(accountId, handle);

  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[CI Scraper] CACHE_HIT for ${handle} (account=${accountId})`);
    return { ...cached.data, attempts: [...cached.data.attempts, "CACHE_HIT"] };
  }

  const lastRequest = rateLimitMap.get(rateKey);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const cachedAny = profileCache.get(cacheKey);
    if (cachedAny) return { ...cachedAny.data, attempts: ["RATE_LIMITED", "CACHE_HIT"] };
  }
  rateLimitMap.set(rateKey, Date.now());

  if (!checkBatchLimit(accountId)) {
    console.log(`[CI Scraper] BATCH_LIMIT reached for account=${accountId} (${MAX_BATCH_SIZE} profiles/hour). Returning cached or blocked.`);
    const cachedFallback = profileCache.get(cacheKey);
    if (cachedFallback) return { ...cachedFallback.data, attempts: ["BATCH_LIMIT", "CACHE_HIT"] };
    return {
      success: false,
      posts: [],
      embeddedComments: [],
      followers: null,
      profileName: handle,
      collectionMethodUsed: "NONE",
      attempts: ["BATCH_LIMIT"],
      warnings: ["BATCH_LIMIT_EXCEEDED: Testing phase limits scraping to 10 profiles per hour."],
      failureClass: "TRANSIENT",
    };
  }

  scrapeStats.totalRequests++;

  const { isInstagramApifyConfigured, scrapeInstagramViaApify } = await import("./instagram-apify-scraper");

  // Safe-off fail-fast (D5/B3): without APIFY_API_KEY there is NO transport.
  // Result is NOT cached so configuring the secret takes effect immediately.
  if (!isInstagramApifyConfigured()) {
    console.error(`[CI Scraper] SCRAPING_UNCONFIGURED | APIFY_API_KEY not set. Refusing to scrape ${handle}.`);
    return {
      success: false,
      posts: [],
      embeddedComments: [],
      followers: null,
      profileName: handle,
      collectionMethodUsed: "NONE",
      attempts: ["SCRAPING_UNCONFIGURED"],
      warnings: ["SCRAPING_UNCONFIGURED: Set APIFY_API_KEY to enable acquisition."],
      failureClass: "TRANSIENT",
    };
  }

  const attempts: string[] = ["APIFY_ACTOR"];
  const warnings: string[] = [];
  let posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;
  let collectionMethodUsed: ScrapeResult["collectionMethodUsed"] = "NONE";
  let transportSucceeded = false;

  try {
    const apifyResult = await scrapeInstagramViaApify(handle, maxPosts);
    // Actor run completed ⇒ transport reached the platform. 0 posts from a
    // completed run = healthy-empty (failureClass NONE) — never a block.
    transportSucceeded = true;
    posts = apifyResult.posts;
    followers = apifyResult.followers;
    profileName = apifyResult.profileName;
    if (posts.length > 0) {
      collectionMethodUsed = "APIFY_ACTOR";
      scrapeStats.apifyActorSuccess++;
      console.log(`[CI Scraper] APIFY_ACTOR SUCCESS: ${posts.length} posts, ${followers ?? "unknown"} followers for ${handle}`);
    } else {
      console.log(`[CI Scraper] APIFY_ACTOR: run completed but no posts extracted for ${handle}`);
    }
  } catch (err: any) {
    // Apify-side errors must never look like an Instagram platform block:
    //  - user-channel-scraper's isBlockWarning() substring-matches "403"/"429"/
    //    "RATE_LIMIT" against result.warnings — sanitize those tokens.
    //  - failureClass stays TRANSIENT (an "Apify API 403" on a bad token must
    //    never stamp a GENUINE_BLOCK 24h cooldown on the Instagram target).
    const rawMsg = typeof err?.message === "string" ? err.message : "unknown";
    const msg = rawMsg.replace(/\b(403|429)\b/g, "4xx").replace(/rate.?limit(ed)?/gi, "throttled");
    warnings.push(`APIFY_ACTOR failed: ${msg}`);
    console.log(`[CI Scraper] APIFY_ACTOR FAILED for ${handle}: ${msg}`);
  }

  if (posts.length === 0) {
    warnings.push(transportSucceeded ? "SCRAPE_EMPTY" : "SCRAPE_BLOCKED");
    collectionMethodUsed = transportSucceeded ? "APIFY_ACTOR" : "NONE";
    if (!transportSucceeded) scrapeStats.scrapeBlocked++;
  }

  const result: ScrapeResult = {
    success: posts.length > 0,
    posts: posts.slice(0, maxPosts > 60 ? 60 : maxPosts),
    embeddedComments: [], // profile actor returns no comment threads — see comment actor
    followers,
    profileName: profileName || handle,
    collectionMethodUsed,
    attempts,
    warnings,
    paginationPages: 1,
    rawFetchedCount: posts.length,
    paginationStopReason: posts.length === 0 ? "UNKNOWN_FAILURE" : posts.length >= maxPosts ? "TARGET_REACHED" : "NO_MORE_PAGES",
    // Fix #1a — transport-reached-but-empty ⇒ NONE (never a block). A failed
    // actor run is always TRANSIENT here (see sanitization note above).
    failureClass: posts.length > 0 || transportSucceeded ? "NONE" : "TRANSIENT",
  };

  // P4 isolation seal: cacheKey is already account-namespaced via nsCacheKey above.
  profileCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

export interface CommentsForPostsMeta {
  runId: string | null;
  requestedPosts: number;
  perUrlErrors: { url: string; error: string }[];
  durationMs: number;
  estimatedCostUsd: number;
}

/**
 * Scrape real comments for a set of posts via the Apify comment actor —
 * ONE batched actor run per call (directUrls), not one run per post.
 *
 * Post selection: highest declared commentCount first (most comment-rich
 * posts give the densest audience evidence per dollar), capped so that
 * postsUsed × maxPerPost ≤ maxTotalComments.
 */
export async function scrapeCommentsForPosts(
  posts: Array<{ postId: string; shortcode: string; commentCount: number | null }>,
  opts: {
    maxTotalComments?: number;
    maxPerPost?: number;
    budgetMs?: number;
  } = {},
): Promise<{ totalScraped: number; results: CommentScrapeResult[]; meta: CommentsForPostsMeta }> {
  const maxTotalComments = opts.maxTotalComments ?? 200;
  const maxPerPost = opts.maxPerPost ?? 10;

  const sortedPosts = [...posts]
    .filter((p) => p.shortcode && (p.commentCount === null || p.commentCount > 0))
    .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));

  const maxPostsForBudget = Math.max(1, Math.floor(maxTotalComments / maxPerPost));
  const selected = sortedPosts.slice(0, maxPostsForBudget);

  const emptyMeta: CommentsForPostsMeta = {
    runId: null,
    requestedPosts: selected.length,
    perUrlErrors: [],
    durationMs: 0,
    estimatedCostUsd: 0,
  };

  if (selected.length === 0) {
    return { totalScraped: 0, results: [], meta: emptyMeta };
  }

  const { scrapeInstagramCommentsViaActor } = await import("../acquisition/instagram-comments");
  const actorResult = await scrapeInstagramCommentsViaActor({
    posts: selected.map((p) => ({
      postId: p.postId,
      shortcode: p.shortcode,
      permalink: `https://www.instagram.com/p/${p.shortcode}/`,
    })),
    maxCommentsPerPost: maxPerPost,
    budgetMs: opts.budgetMs,
  });

  if (!actorResult.ok) {
    console.warn(`[CI Scraper] COMMENTS_BATCH_FAILED: ${actorResult.error}`);
    return {
      totalScraped: 0,
      results: selected.map((p) => ({
        success: false,
        comments: [],
        shortcode: p.shortcode,
        totalAvailable: p.commentCount,
        errorReason: actorResult.error,
      })),
      meta: { ...emptyMeta, perUrlErrors: actorResult.meta.perUrlErrors },
    };
  }

  // Group actor comments back into per-post results (capped by maxTotalComments).
  const byShortcode = new Map<string, ScrapedComment[]>();
  let totalScraped = 0;
  for (const c of actorResult.comments) {
    if (totalScraped >= maxTotalComments) break;
    const sc = c.shortcode || "";
    if (!byShortcode.has(sc)) byShortcode.set(sc, []);
    byShortcode.get(sc)!.push({
      commentId: c.commentId,
      postId: c.postId,
      shortcode: sc,
      text: c.text.substring(0, 2000),
      username: c.username || "unknown",
      timestamp: c.timestamp,
      likes: c.likesCount ?? 0,
      repliesCount: c.repliesCount,
    });
    totalScraped++;
  }

  const erroredUrls = new Map(actorResult.meta.perUrlErrors.map((e) => [e.url, e.error]));
  const results: CommentScrapeResult[] = selected.map((p) => {
    const comments = byShortcode.get(p.shortcode) || [];
    const urlError = erroredUrls.get(`https://www.instagram.com/p/${p.shortcode}/`);
    return {
      success: comments.length > 0 || !urlError,
      comments,
      shortcode: p.shortcode,
      totalAvailable: p.commentCount,
      ...(urlError ? { errorReason: urlError } : {}),
    };
  });

  console.log(
    `[CI Scraper] COMMENTS_BATCH_COMPLETE: ${totalScraped} real comments from ${selected.length} posts | run=${actorResult.meta.runId} | cost≈$${actorResult.meta.estimatedCostUsd}`,
  );

  return {
    totalScraped,
    results,
    meta: {
      runId: actorResult.meta.runId,
      requestedPosts: selected.length,
      perUrlErrors: actorResult.meta.perUrlErrors,
      durationMs: actorResult.meta.durationMs,
      estimatedCostUsd: actorResult.meta.estimatedCostUsd,
    },
  };
}
