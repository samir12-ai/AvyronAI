import type { StickySessionContext, PoolFetchTarget } from "./proxy-pool-manager";
import { logProxyTelemetry, classifyBlock, rotateSessionOnBlock, getRetryDelay, getScrapingConfig, poolFetch } from "./proxy-pool-manager";
import { acquireToken } from "./rate-limiter";

/**
 * 2026-07 Unlocker rebuild: ALL transport goes through the pool manager
 * (Bright Data Unlocker API). No UA pools, custom headers, ProxyAgent
 * dispatchers, or headless browsers — the Unlocker manages fingerprints
 * (UA/TLS/headers) and anti-bot solving server-side. There is NO direct-fetch
 * fallback: unconfigured scraping fails fast as SCRAPING_UNCONFIGURED.
 */
function transportFetch(url: string, proxyCtx?: StickySessionContext, bareTarget?: PoolFetchTarget): Promise<Response> {
  // T006 — sticky-session fetches (proxyCtx path) auto-attach per-target
  // backoff identity inside the pool manager; the bare path threads an
  // explicit target built by scrapeInstagramProfile.
  return proxyCtx ? proxyCtx.poolFetch(url) : poolFetch(url, bareTarget ? { target: bareTarget } : undefined);
}

function randomDelay(): Promise<void> {
  const ms = 3000 + Math.random() * 2000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

export interface ScrapeResult {
  success: boolean;
  posts: ScrapedPost[];
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
  // timeout / proxy-tunnel contention / rate-limit / unknown — retry next cycle,
  // never a persistent block.
  failureClass: "NONE" | "GENUINE_BLOCK" | "TRANSIENT";
}

/**
 * Fix #1a — distinguish a genuine platform block from transient contention,
 * from the raw transport error message. classifyBlock() (proxy-pool-manager) is
 * intentionally NOT reused here: it lumps real 403s and mere connect/tunnel
 * timeouts both into "PROXY_BLOCKED", which is exactly the coarseness that
 * caused spurious 24h blocks. Only unambiguous auth/challenge/403 walls return
 * GENUINE_BLOCK; everything else is TRANSIENT (conservative — favours retry
 * over lock, per B3 safe-degradation).
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
  webApiSuccess: number;
  htmlParseSuccess: number;
  headlessRenderSuccess: number;
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
// map. The pre-hardening implementation used a single global counter / cache
// keyed by handle, which meant Tenant A's 10 scrapes in an hour starved
// Tenant B (and rate-limit hits cached A's result for B's reads). Every
// observable bucket is now keyed by accountId.
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

function classifyMediaType(node: any): ScrapedPost["mediaType"] {
  if (!node) return "UNKNOWN";
  const typename = node.__typename || node.media_type || "";
  if (typename.includes("Video") || typename.includes("Reel") || typename === "VIDEO") return "REEL";
  if (typename.includes("Sidecar") || typename === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (typename.includes("Image") || typename === "IMAGE") return "IMAGE";
  if (node.is_video === true) return "REEL";
  if (node.edge_sidecar_to_children) return "CAROUSEL";
  return "IMAGE";
}

function parsePostFromGraphQL(node: any, handle: string): ScrapedPost {
  const shortcode = node.shortcode || node.code || "";
  const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text
    || node.caption?.text
    || node.accessibility_caption
    || null;
  const timestamp = node.taken_at_timestamp || node.taken_at || null;

  return {
    postId: node.id || shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/${handle}/`,
    mediaType: classifyMediaType(node),
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    caption: caption ? String(caption).substring(0, 2000) : null,
    likes: node.edge_media_preview_like?.count ?? node.like_count ?? null,
    comments: node.edge_media_to_comment?.count ?? node.comment_count ?? null,
    views: node.video_view_count ?? node.play_count ?? null,
    videoUrl: node.video_url || null,
    displayUrl: node.display_url || node.thumbnail_src || null,
    shortcode,
  };
}

function extractCommentsFromNode(node: any, postId: string, shortcode: string): ScrapedComment[] {
  const comments: ScrapedComment[] = [];
  const seenIds = new Set<string>();

  const commentSources = [
    node.edge_media_to_parent_comment?.edges,
    node.edge_media_to_comment?.edges,
    node.edge_media_preview_comment?.edges,
  ];

  for (const edges of commentSources) {
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      const cn = edge.node || edge;
      if (!cn || !cn.text) continue;
      const cid = cn.id || cn.pk?.toString() || `ec_${postId}_${comments.length}`;
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      comments.push({
        commentId: cid,
        postId,
        shortcode,
        text: String(cn.text).substring(0, 2000),
        username: cn.owner?.username || cn.user?.username || "unknown",
        timestamp: cn.created_at ? new Date(cn.created_at * 1000).toISOString() : null,
        likes: cn.edge_liked_by?.count ?? cn.comment_like_count ?? 0,
      });
    }
  }

  const previewComments = node.preview_comments || node.comments || [];
  if (Array.isArray(previewComments)) {
    for (const pc of previewComments) {
      if (!pc.text && !pc.comment_text) continue;
      const cid = pc.pk?.toString() || pc.id || `pc_${postId}_${comments.length}`;
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      comments.push({
        commentId: cid,
        postId,
        shortcode,
        text: String(pc.text || pc.comment_text).substring(0, 2000),
        username: pc.user?.username || pc.owner?.username || "unknown",
        timestamp: pc.created_at ? new Date(pc.created_at * 1000).toISOString() : null,
        likes: pc.comment_like_count ?? 0,
      });
    }
  }

  return comments;
}

const TARGET_POSTS = 12;
const MAX_PAGINATION_PAGES = 1;
const INSTAGRAM_PUBLIC_API_CEILING = 12;

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

interface PaginationDiagnostics {
  page1PostCount: number;
  page1HasNextPage: boolean;
  page1EndCursorPresent: boolean;
  page1HttpStatus: number;
  page1ResponseKB: number;
  totalMediaCount: number | null;
  userId: string | null;
  paginationAttempted: boolean;
  paginationMethod: string | null;
  paginationHttpStatus: number | null;
  paginationErrorDetail: string | null;
  stopReason: PaginationStopReason;
  pagesCompleted: number;
  totalPostsFetched: number;
  proxyUsed: boolean;
}

async function attemptWebProfileApi(handle: string, proxyCtx?: StickySessionContext, maxPosts: number = TARGET_POSTS, bareTarget?: PoolFetchTarget): Promise<{ posts: ScrapedPost[]; embeddedComments: ScrapedComment[]; followers: number | null; profileName: string | null; bytesReceived: number; paginationPages: number; rawFetchedCount: number; paginationStopReason: PaginationStopReason; diagnostics: PaginationDiagnostics }> {
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

  const sessionId = proxyCtx?.session.sessionId ?? null;
  // All requests route through the Unlocker API — transport is always
  // pool-managed (main entry fails fast when unconfigured).
  const proxyUsed = true;

  console.log(`[CI Scraper] WEB_API: Fetching web_profile_info for ${handle} via Unlocker API${sessionId ? ` (session=${sessionId})` : ""}`);

  const diag: PaginationDiagnostics = {
    page1PostCount: 0,
    page1HasNextPage: false,
    page1EndCursorPresent: false,
    page1HttpStatus: 0,
    page1ResponseKB: 0,
    totalMediaCount: null,
    userId: null,
    paginationAttempted: false,
    paginationMethod: null,
    paginationHttpStatus: null,
    paginationErrorDetail: null,
    stopReason: "UNKNOWN_FAILURE",
    pagesCompleted: 1,
    totalPostsFetched: 0,
    proxyUsed,
  };

  let user: any = null;
  let bytesReceived = 0;

  if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `WEB_API:www:${handle}`);
  const response = await transportFetch(apiUrl, proxyCtx, bareTarget);
  diag.page1HttpStatus = response.status;

  if (response.ok) {
    const text = await response.text();
    bytesReceived = Buffer.byteLength(text, "utf-8");
    diag.page1ResponseKB = Math.round(bytesReceived / 1024 * 10) / 10;
    console.log(`[CI Scraper] WEB_API: PAGE_1 response ${diag.page1ResponseKB} KB, HTTP ${diag.page1HttpStatus} for ${handle}`);
    try {
      const data = JSON.parse(text);
      user = data?.data?.user;
    } catch {
      console.log(`[CI Scraper] WEB_API: www response not valid JSON for ${handle}`);
    }
  } else {
    console.log(`[CI Scraper] WEB_API: www endpoint returned HTTP ${response.status} for ${handle}`);
  }

  if (!user) {
    console.log(`[CI Scraper] WEB_API: www failed for ${handle} (HTTP ${diag.page1HttpStatus}), trying i.instagram.com variant...`);
    const iApiUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
    let iHttpStatus: number | null = null;
    try {
      if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `WEB_API:i.ig:${handle}`);
      const iResp = await transportFetch(iApiUrl, proxyCtx, bareTarget);
      iHttpStatus = iResp.status;
      if (iResp.ok) {
        const iText = await iResp.text();
        const iBytes = Buffer.byteLength(iText, "utf-8");
        bytesReceived += iBytes;
        diag.page1ResponseKB = Math.round(bytesReceived / 1024 * 10) / 10;
        diag.page1HttpStatus = iResp.status;
        try {
          const iData = JSON.parse(iText);
          user = iData?.data?.user;
          if (user) {
            console.log(`[CI Scraper] WEB_API: i.instagram.com variant SUCCESS for ${handle} (${(iBytes / 1024).toFixed(1)} KB)`);
          } else {
            console.log(`[CI Scraper] WEB_API: i.instagram.com also returned null user for ${handle}`);
          }
        } catch {
          console.log(`[CI Scraper] WEB_API: i.instagram.com response not valid JSON for ${handle}`);
        }
      } else {
        console.log(`[CI Scraper] WEB_API: i.instagram.com returned HTTP ${iResp.status} for ${handle}`);
      }
    } catch (iErr: any) {
      console.log(`[CI Scraper] WEB_API: i.instagram.com fallback failed for ${handle}: ${iErr.message}`);
    }
    // Fix #1a — surface the transport HTTP status in the thrown message so a
    // genuine 403/401/challenge wall on the dominant WEB_API path classifies as
    // GENUINE_BLOCK (classifyScrapeFailure matches on the status/marker text).
    // Without this the message carried no marker and every real block fell
    // through to TRANSIENT, defeating the 24h cooldown and re-scraping forever.
    if (!user) throw new Error(`No user data from web_profile_info (www HTTP ${response.status}, i.instagram.com HTTP ${iHttpStatus === null ? "n/a" : iHttpStatus}; both failed)`);
  }

  if (user.is_private === true) {
    console.log(`[CI Scraper] WEB_API: ACCOUNT_PRIVATE for ${handle}`);
    diag.stopReason = "ACCOUNT_PRIVATE";
    return { posts: [], embeddedComments: [], followers: user.edge_followed_by?.count ?? null, profileName: user.full_name || handle, bytesReceived, paginationPages: 1, rawFetchedCount: 0, paginationStopReason: "ACCOUNT_PRIVATE", diagnostics: diag };
  }

  const profileName = user.full_name || user.username || handle;
  const followers = user.edge_followed_by?.count ?? null;
  const userId = user.id;
  diag.userId = userId;

  const mediaData = user.edge_owner_to_timeline_media;
  const edges = mediaData?.edges || [];
  const posts: ScrapedPost[] = [];
  const embeddedComments: ScrapedComment[] = [];
  const seenIds = new Set<string>();
  const seenCommentIds = new Set<string>();

  for (const edge of edges) {
    const post = parsePostFromGraphQL(edge.node, handle);
    if (!seenIds.has(post.postId)) {
      seenIds.add(post.postId);
      posts.push(post);

      const nodeComments = extractCommentsFromNode(edge.node, post.postId, post.shortcode);
      for (const c of nodeComments) {
        if (!seenCommentIds.has(c.commentId)) {
          seenCommentIds.add(c.commentId);
          embeddedComments.push(c);
        }
      }
    }
  }

  diag.page1PostCount = posts.length;
  diag.page1HasNextPage = mediaData?.page_info?.has_next_page === true;
  diag.page1EndCursorPresent = !!mediaData?.page_info?.end_cursor;
  diag.totalMediaCount = mediaData?.count ?? null;

  console.log(`[CI Scraper] WEB_API: PAGE_1 AUDIT | posts=${diag.page1PostCount} | has_next_page=${diag.page1HasNextPage} | end_cursor=${diag.page1EndCursorPresent ? "PRESENT" : "NULL"} | total_media_count=${diag.totalMediaCount} | userId=${userId || "NULL"} | for ${handle}`);

  if (!diag.page1HasNextPage) {
    diag.stopReason = posts.length <= INSTAGRAM_PUBLIC_API_CEILING ? "NO_MORE_PAGES" : "NO_MORE_PAGES";
    diag.totalPostsFetched = posts.length;
    console.log(`[CI Scraper] WEB_API: NO_MORE_PAGES — profile has ${diag.totalMediaCount ?? "unknown"} total posts, API returned ${posts.length}. No pagination available.`);
    return { posts, embeddedComments, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "NO_MORE_PAGES", diagnostics: diag };
  }

  if (posts.length >= maxPosts) {
    diag.stopReason = "TARGET_REACHED";
    diag.totalPostsFetched = posts.length;
    return { posts, embeddedComments, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "TARGET_REACHED", diagnostics: diag };
  }

  if (!userId) {
    diag.stopReason = "NO_USER_ID";
    diag.totalPostsFetched = posts.length;
    console.log(`[CI Scraper] WEB_API: NO_USER_ID — cannot paginate without userId`);
    return { posts, embeddedComments, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "NO_USER_ID", diagnostics: diag };
  }

  diag.paginationAttempted = true;
  let paginationPages = 1;
  let paginationSuccess = false;

  console.log(`[CI Scraper] WEB_API: PAGE_1 has ${posts.length}/${maxPosts} posts with has_next_page=true. Attempting v1 feed pagination...`);

  const lastPostNode = edges[edges.length - 1]?.node;
  const lastPostId = lastPostNode?.id;

  if (lastPostId) {
    diag.paginationMethod = "V1_FEED_API";
    await randomDelay();

    const maxId = `${lastPostId}_${userId}`;
    const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=50&max_id=${maxId}`;

    console.log(`[CI Scraper] WEB_API: PAGINATION_ATTEMPT | method=V1_FEED_API | userId=${userId} | max_id=${maxId.substring(0, 30)}... | for ${handle}`);

    try {
      if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `V1_FEED:page2:${handle}`);
      const page2StartMs = Date.now();
      const feedResponse = await transportFetch(feedUrl, proxyCtx, bareTarget);
      diag.paginationHttpStatus = feedResponse.status;

      console.log(`[CI Scraper] WEB_API: PAGINATION_RESPONSE | HTTP=${feedResponse.status} | Content-Type=${feedResponse.headers.get("content-type")} | for ${handle}`);

      if (feedResponse.ok) {
        const feedText = await feedResponse.text();
        const feedBytes = Buffer.byteLength(feedText, "utf-8");
        bytesReceived += feedBytes;

        try {
          const feedData = JSON.parse(feedText);
          const feedItems = feedData?.items || [];

          console.log(`[CI Scraper] WEB_API: PAGINATION_PAGE_2 | items=${feedItems.length} | more_available=${feedData?.more_available} | response_size=${(feedBytes / 1024).toFixed(1)}KB | for ${handle}`);
          if (proxyCtx) logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2", feedResponse.status, null, Date.now() - page2StartMs, feedItems.length > 0);

          if (feedItems.length > 0) {
            for (const item of feedItems) {
              const post = parsePostFromV1Feed(item, handle);
              if (!seenIds.has(post.postId)) {
                seenIds.add(post.postId);
                posts.push(post);
                const itemComments = extractCommentsFromNode(item, post.postId, post.shortcode);
                for (const c of itemComments) {
                  if (!seenCommentIds.has(c.commentId)) {
                    seenCommentIds.add(c.commentId);
                    embeddedComments.push(c);
                  }
                }
              }
            }
            paginationPages = 2;
            paginationSuccess = true;

            let nextMaxId = feedData?.next_max_id;
            while (feedData?.more_available && nextMaxId && posts.length < maxPosts && paginationPages < MAX_PAGINATION_PAGES) {
              paginationPages++;
              await randomDelay();

              const nextFeedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=50&max_id=${nextMaxId}`;
              console.log(`[CI Scraper] WEB_API: PAGINATION_PAGE_${paginationPages} | have=${posts.length}/${maxPosts} | for ${handle}`);

              try {
                if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `V1_FEED:page${paginationPages + 1}:${handle}`);
                const pageStartMs = Date.now();
                const nextResp = await transportFetch(nextFeedUrl, proxyCtx, bareTarget);
                if (!nextResp.ok) {
                  if (proxyCtx) logProxyTelemetry(proxyCtx, `PAGINATION_PAGE_${paginationPages}`, nextResp.status, classifyBlock(nextResp.status, ""), Date.now() - pageStartMs, false);
                  console.log(`[CI Scraper] WEB_API: PAGINATION_PAGE_${paginationPages} HTTP ${nextResp.status}, stopping`);
                  break;
                }
                const nextText = await nextResp.text();
                bytesReceived += Buffer.byteLength(nextText, "utf-8");
                const nextData = JSON.parse(nextText);
                const nextItems = nextData?.items || [];
                if (proxyCtx) logProxyTelemetry(proxyCtx, `PAGINATION_PAGE_${paginationPages}`, nextResp.status, null, Date.now() - pageStartMs, nextItems.length > 0);

                if (nextItems.length === 0) break;

                for (const item of nextItems) {
                  const post = parsePostFromV1Feed(item, handle);
                  if (!seenIds.has(post.postId)) {
                    seenIds.add(post.postId);
                    posts.push(post);
                    const itemComments = extractCommentsFromNode(item, post.postId, post.shortcode);
                    for (const c of itemComments) {
                      if (!seenCommentIds.has(c.commentId)) {
                        seenCommentIds.add(c.commentId);
                        embeddedComments.push(c);
                      }
                    }
                  }
                }
                nextMaxId = nextData?.next_max_id;
                if (!nextData?.more_available) break;
              } catch (err: any) {
                if (proxyCtx) logProxyTelemetry(proxyCtx, `PAGINATION_PAGE_${paginationPages}`, null, classifyBlock(null, err.message), 0, false);
                console.log(`[CI Scraper] WEB_API: PAGINATION_PAGE_${paginationPages} error: ${err.message}`);
                break;
              }
            }
          }
        } catch {
          diag.paginationErrorDetail = "JSON_PARSE_FAILED";
          console.log(`[CI Scraper] WEB_API: PAGINATION v1 feed response not valid JSON`);
        }
      } else {
        const errBody = await feedResponse.text().catch(() => "");
        const isAuthRequired = errBody.includes("require_login") || feedResponse.status === 401;
        const isRateLimited = errBody.includes("wait a few minutes") || feedResponse.status === 429;

        if (isAuthRequired) {
          diag.paginationErrorDetail = "AUTH_REQUIRED: Instagram requires login for feed pagination beyond page 1";
          diag.stopReason = "FEED_PAGINATION_AUTH_REQUIRED";
          if (proxyCtx) logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2", feedResponse.status, "AUTH_REQUIRED", Date.now() - page2StartMs, false);
          console.log(`[CI Scraper] WEB_API: PAGINATION_AUTH_REQUIRED | HTTP ${feedResponse.status} | Instagram requires authenticated session for v1/feed pagination | for ${handle}`);
        } else if (isRateLimited) {
          diag.paginationErrorDetail = "RATE_LIMITED";
          diag.stopReason = "RATE_LIMITED";
          if (proxyCtx) logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2", feedResponse.status, "RATE_LIMIT", Date.now() - page2StartMs, false);
          console.log(`[CI Scraper] WEB_API: PAGINATION_RATE_LIMITED | HTTP ${feedResponse.status} | for ${handle}`);
        } else {
          diag.paginationErrorDetail = `HTTP_${feedResponse.status}: ${errBody.substring(0, 200)}`;
          diag.stopReason = "FEED_PAGINATION_BLOCKED";
          if (proxyCtx) logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2", feedResponse.status, "PROXY_BLOCKED", Date.now() - page2StartMs, false);
          console.log(`[CI Scraper] WEB_API: PAGINATION_BLOCKED | HTTP ${feedResponse.status} | ${errBody.substring(0, 150)} | for ${handle}`);
        }
      }
    } catch (err: any) {
      diag.paginationErrorDetail = `NETWORK: ${err.message}`;
      diag.stopReason = "PROXY_BLOCKED";
      if (proxyCtx) logProxyTelemetry(proxyCtx, "PAGINATION_PAGE_2", null, classifyBlock(null, err.message), 0, false);
      console.log(`[CI Scraper] WEB_API: PAGINATION_NETWORK_ERROR | ${err.message} | for ${handle}`);
    }
  }

  if (!paginationSuccess && posts.length < maxPosts && userId && mediaData?.page_info?.end_cursor) {
    console.log(`[CI Scraper] WEB_API: V1_FEED failed — trying GraphQL pagination fallback | posts=${posts.length}/${maxPosts} | for ${handle}`);
    diag.paginationMethod = "GRAPHQL_FALLBACK";

    const endCursor = mediaData.page_info.end_cursor;
    const queryHash = "69cba40317214236af40e7efa697781d";
    let gqlCursor = endCursor;
    let gqlPageNum = 1;

    while (posts.length < maxPosts && gqlPageNum <= MAX_PAGINATION_PAGES && gqlCursor) {
      gqlPageNum++;
      await randomDelay();

      const gqlVars = JSON.stringify({ id: userId, first: 50, after: gqlCursor });
      const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(gqlVars)}`;

      console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGE_${gqlPageNum} | have=${posts.length}/${maxPosts} | cursor=${gqlCursor.substring(0, 20)}... | for ${handle}`);

      try {
        if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `GRAPHQL:page${gqlPageNum}:${handle}`);
        const gqlStartMs = Date.now();
        const gqlResp = await transportFetch(gqlUrl, proxyCtx, bareTarget);

        if (!gqlResp.ok) {
          const gqlErrBody = await gqlResp.text().catch(() => "");
          if (proxyCtx) logProxyTelemetry(proxyCtx, `GRAPHQL_PAGE_${gqlPageNum}`, gqlResp.status, classifyBlock(gqlResp.status, gqlErrBody), Date.now() - gqlStartMs, false);
          console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGE_${gqlPageNum} HTTP ${gqlResp.status} | ${gqlErrBody.substring(0, 100)} | for ${handle}`);
          break;
        }

        const gqlText = await gqlResp.text();
        bytesReceived += Buffer.byteLength(gqlText, "utf-8");

        const gqlData = JSON.parse(gqlText);
        const gqlMedia = gqlData?.data?.user?.edge_owner_to_timeline_media;
        const gqlEdges = gqlMedia?.edges || [];

        if (proxyCtx) logProxyTelemetry(proxyCtx, `GRAPHQL_PAGE_${gqlPageNum}`, gqlResp.status, null, Date.now() - gqlStartMs, gqlEdges.length > 0);
        console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGE_${gqlPageNum} | items=${gqlEdges.length} | has_next=${gqlMedia?.page_info?.has_next_page} | for ${handle}`);

        if (gqlEdges.length === 0) break;

        for (const edge of gqlEdges) {
          const post = parsePostFromGraphQL(edge.node, handle);
          if (!seenIds.has(post.postId)) {
            seenIds.add(post.postId);
            posts.push(post);
            const edgeComments = extractCommentsFromNode(edge.node, post.postId, post.shortcode);
            for (const c of edgeComments) {
              if (!seenCommentIds.has(c.commentId)) {
                seenCommentIds.add(c.commentId);
                embeddedComments.push(c);
              }
            }
          }
        }

        paginationPages = 1 + gqlPageNum;
        paginationSuccess = true;

        gqlCursor = gqlMedia?.page_info?.has_next_page ? gqlMedia?.page_info?.end_cursor : null;
        if (!gqlCursor) break;
      } catch (gqlErr: any) {
        if (proxyCtx) logProxyTelemetry(proxyCtx, `GRAPHQL_PAGE_${gqlPageNum}`, null, classifyBlock(null, gqlErr.message), 0, false);
        console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGE_${gqlPageNum} error: ${gqlErr.message} | for ${handle}`);
        break;
      }
    }

    if (paginationSuccess) {
      console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGINATION_SUCCESS | ${posts.length} posts across ${paginationPages} pages | for ${handle}`);
    } else {
      console.log(`[CI Scraper] WEB_API: GRAPHQL_PAGINATION_FAILED | stuck at ${posts.length} posts | for ${handle}`);
    }
  }

  if (paginationSuccess) {
    diag.stopReason = posts.length >= maxPosts ? "TARGET_REACHED" :
      paginationPages >= MAX_PAGINATION_PAGES ? "MAX_PAGES_REACHED" :
      "FEED_PAGINATION_SUCCESS";
    console.log(`[CI Scraper] WEB_API: PAGINATION_SUCCESS | ${posts.length} posts across ${paginationPages} pages | stopReason=${diag.stopReason} | for ${handle}`);
  } else if (diag.stopReason === "UNKNOWN_FAILURE" || diag.stopReason === "FEED_PAGINATION_AUTH_REQUIRED" || diag.stopReason === "FEED_PAGINATION_BLOCKED") {
    if (posts.length === INSTAGRAM_PUBLIC_API_CEILING && (diag.totalMediaCount ?? 0) > INSTAGRAM_PUBLIC_API_CEILING) {
      diag.stopReason = "INSTAGRAM_API_CEILING" as PaginationStopReason;
      console.log(`[CI Scraper] WEB_API: INSTAGRAM_API_CEILING | Profile has ${diag.totalMediaCount} posts but Instagram public API returns max ${INSTAGRAM_PUBLIC_API_CEILING} per request. Both v1/feed and GraphQL pagination failed. | ${diag.paginationErrorDetail || "No error detail"} | for ${handle}`);
    }
  }

  diag.pagesCompleted = paginationPages;
  diag.totalPostsFetched = posts.length;

  const rawFetchedCount = posts.length;
  const finalStopReason = diag.stopReason;

  console.log(`[CI Scraper] WEB_API: FINAL_AUDIT | posts=${posts.length} | pages=${paginationPages} | stopReason=${finalStopReason} | totalMediaOnProfile=${diag.totalMediaCount} | paginationAttempted=${diag.paginationAttempted} | paginationMethod=${diag.paginationMethod || "NONE"} | paginationHTTP=${diag.paginationHttpStatus || "N/A"} | error=${diag.paginationErrorDetail || "NONE"} | for ${handle}`);

  console.log(`[CI Scraper] WEB_API: EMBEDDED_COMMENTS | ${embeddedComments.length} real comments extracted from ${posts.length} posts | for ${handle}`);
  return { posts, embeddedComments, followers, profileName, bytesReceived, paginationPages, rawFetchedCount, paginationStopReason: finalStopReason, diagnostics: diag };
}

function parsePostFromV1Feed(item: any, handle: string): ScrapedPost {
  const shortcode = item.code || item.shortcode || "";
  const caption = item.caption?.text || null;
  const timestamp = item.taken_at || null;

  let mediaType: ScrapedPost["mediaType"] = "IMAGE";
  if (item.media_type === 2 || item.video_versions) mediaType = "REEL";
  else if (item.media_type === 8 || item.carousel_media) mediaType = "CAROUSEL";
  else if (item.media_type === 1) mediaType = "IMAGE";

  return {
    postId: item.pk?.toString() || item.id?.toString() || shortcode,
    permalink: shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/${handle}/`,
    mediaType,
    timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    caption: caption ? String(caption).substring(0, 2000) : null,
    likes: item.like_count ?? null,
    comments: item.comment_count ?? null,
    views: item.play_count ?? item.view_count ?? null,
    videoUrl: item.video_versions?.[0]?.url || null,
    displayUrl: item.image_versions2?.candidates?.[0]?.url || item.thumbnail_url || null,
    shortcode,
  };
}

async function attemptHtmlPageParse(profileUrl: string, handle: string, proxyCtx?: StickySessionContext, bareTarget?: PoolFetchTarget): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesReceived: number }> {
  console.log(`[CI Scraper] HTML_PARSE: Fetching ${profileUrl} via Unlocker API${proxyCtx ? ` (session=${proxyCtx.session.sessionId})` : ""}`);

  if (proxyCtx) await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `HTML_PARSE:${handle}`);
  const response = await transportFetch(profileUrl, proxyCtx, bareTarget);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const bytesReceived = Buffer.byteLength(html, "utf-8");

  const posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;

  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/s);
  if (sharedDataMatch) {
    try {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const user = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user;
      if (user) {
        profileName = user.full_name || user.username || null;
        followers = user.edge_followed_by?.count ?? null;
        const edges = user.edge_owner_to_timeline_media?.edges || [];
        for (const edge of edges.slice(0, 30)) {
          posts.push(parsePostFromGraphQL(edge.node, handle));
        }
      }
    } catch {}
  }

  if (posts.length === 0) {
    const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,\s*({.+?})\s*\);<\/script>/s);
    if (additionalDataMatch) {
      try {
        const data = JSON.parse(additionalDataMatch[1]);
        const user = data?.graphql?.user || data?.user;
        if (user) {
          profileName = profileName || user.full_name || user.username || null;
          followers = followers ?? user.edge_followed_by?.count ?? null;
          const edges = user.edge_owner_to_timeline_media?.edges || [];
          for (const edge of edges.slice(0, 30)) {
            posts.push(parsePostFromGraphQL(edge.node, handle));
          }
        }
      } catch {}
    }
  }

  if (posts.length === 0) {
    const metaDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i);
    if (metaDesc) {
      const followerMatch = metaDesc[1].match(/([\d,.]+[KkMm]?)\s*Followers/i);
      if (followerMatch && !followers) {
        const raw = followerMatch[1].replace(/,/g, "");
        if (raw.match(/[Kk]$/)) followers = Math.round(parseFloat(raw) * 1000);
        else if (raw.match(/[Mm]$/)) followers = Math.round(parseFloat(raw) * 1000000);
        else followers = parseInt(raw);
      }
      profileName = profileName || handle;
    }
  }

  return { posts, followers, profileName, bytesReceived };
}

export interface ScrapedComment {
  commentId: string;
  postId: string;
  shortcode: string;
  text: string;
  username: string;
  timestamp: string | null;
  likes: number;
}

export interface CommentScrapeResult {
  success: boolean;
  comments: ScrapedComment[];
  shortcode: string;
  totalAvailable: number | null;
}

const COMMENT_QUERY_HASH = "97b41c52301f77ce508f55e66d17620e";
const MAX_COMMENTS_PER_POST = 30;

export async function scrapePostComments(
  shortcode: string,
  postId: string,
  proxyCtx?: StickySessionContext,
): Promise<CommentScrapeResult> {
  if (!shortcode) {
    return { success: false, comments: [], shortcode, totalAvailable: null };
  }

  const variables = JSON.stringify({ shortcode, first: MAX_COMMENTS_PER_POST });
  const url = `https://www.instagram.com/graphql/query/?query_hash=${COMMENT_QUERY_HASH}&variables=${encodeURIComponent(variables)}`;

  try {
    if (proxyCtx) {
      await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `COMMENTS:${shortcode}`);
    }

    const startMs = Date.now();
    const resp = await transportFetch(url, proxyCtx);

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_GRAPHQL`, resp.status, classifyBlock(resp.status, errBody), Date.now() - startMs, false);
      console.log(`[CI Scraper] COMMENTS: GraphQL HTTP ${resp.status} for ${shortcode}, falling back to V1/HTML | ${errBody.substring(0, 100)}`);
      return await scrapePostCommentsV1(shortcode, postId, proxyCtx);
    }

    const text = await resp.text();
    const data = JSON.parse(text);
    const commentEdge = data?.data?.shortcode_media?.edge_media_to_parent_comment;
    const totalAvailable = commentEdge?.count ?? null;
    const edges = commentEdge?.edges || [];

    if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_GRAPHQL`, resp.status, null, Date.now() - startMs, edges.length > 0);

    const comments: ScrapedComment[] = [];
    for (const edge of edges) {
      const node = edge.node;
      if (!node || !node.text) continue;
      comments.push({
        commentId: node.id || `comment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        postId,
        shortcode,
        text: String(node.text).substring(0, 2000),
        username: node.owner?.username || "unknown",
        timestamp: node.created_at ? new Date(node.created_at * 1000).toISOString() : null,
        likes: node.edge_liked_by?.count ?? node.comment_like_count ?? 0,
      });
    }

    if (comments.length === 0) {
      console.log(`[CI Scraper] COMMENTS: GraphQL returned 200 but 0 edges for ${shortcode}, falling back to V1/HTML`);
      return await scrapePostCommentsV1(shortcode, postId, proxyCtx);
    }

    console.log(`[CI Scraper] COMMENTS: ${comments.length} real comments scraped for ${shortcode} (${totalAvailable} total available)`);
    return { success: true, comments, shortcode, totalAvailable };
  } catch (err: any) {
    console.log(`[CI Scraper] COMMENTS: GraphQL error for ${shortcode}: ${err.message}, falling back to V1/HTML`);
    return await scrapePostCommentsV1(shortcode, postId, proxyCtx);
  }
}

async function scrapePostCommentsFromHTML(
  shortcode: string,
  postId: string,
  proxyCtx?: StickySessionContext,
): Promise<CommentScrapeResult> {
  const postPageUrl = `https://www.instagram.com/p/${shortcode}/`;

  try {
    if (proxyCtx) {
      await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `COMMENTS_HTML:${shortcode}`);
    }

    const startMs = Date.now();
    const resp = await transportFetch(postPageUrl, proxyCtx);

    if (!resp.ok) {
      if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_HTML`, resp.status, classifyBlock(resp.status, ""), Date.now() - startMs, false);
      console.log(`[CI Scraper] COMMENTS_HTML: HTTP ${resp.status} for ${shortcode}`);
      return { success: false, comments: [], shortcode, totalAvailable: null };
    }

    const html = await resp.text();
    if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_HTML`, resp.status, null, Date.now() - startMs, html.length > 10000);

    const comments: ScrapedComment[] = [];
    const seenIds = new Set<string>();
    let totalAvailable: number | null = null;

    const previewMatch = html.match(/"preview_comments"\s*:\s*\[([^\]]+)\]/);
    if (previewMatch) {
      try {
        const previewArr = JSON.parse(`[${previewMatch[1]}]`);
        for (const c of previewArr) {
          if (!c.text) continue;
          const cid = c.pk?.toString() || c.id || `html_${postId}_${comments.length}`;
          if (seenIds.has(cid)) continue;
          seenIds.add(cid);
          comments.push({
            commentId: cid,
            postId,
            shortcode,
            text: String(c.text).substring(0, 2000),
            username: c.user?.username || c.owner?.username || "unknown",
            timestamp: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
            likes: c.comment_like_count ?? 0,
          });
        }
      } catch {
        console.log(`[CI Scraper] COMMENTS_HTML: Failed to parse preview_comments JSON for ${shortcode}`);
      }
    }

    const countMatch = html.match(/"comment_count"\s*:\s*(\d+)/);
    if (countMatch) {
      totalAvailable = parseInt(countMatch[1]);
    }

    const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?})\s*;/s);
    if (sharedDataMatch && comments.length === 0) {
      try {
        const shared = JSON.parse(sharedDataMatch[1]);
        const media = shared?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
        if (media) {
          const edgeSources = [
            media.edge_media_to_parent_comment?.edges,
            media.edge_media_to_comment?.edges,
            media.edge_media_preview_comment?.edges,
          ];
          for (const edges of edgeSources) {
            if (!Array.isArray(edges)) continue;
            for (const edge of edges) {
              const node = edge.node || edge;
              if (!node?.text) continue;
              const cid = node.id || node.pk?.toString() || `sd_${postId}_${comments.length}`;
              if (seenIds.has(cid)) continue;
              seenIds.add(cid);
              comments.push({
                commentId: cid,
                postId,
                shortcode,
                text: String(node.text).substring(0, 2000),
                username: node.owner?.username || node.user?.username || "unknown",
                timestamp: node.created_at ? new Date(node.created_at * 1000).toISOString() : null,
                likes: node.edge_liked_by?.count ?? node.comment_like_count ?? 0,
              });
            }
          }
          if (!totalAvailable) {
            totalAvailable = media.edge_media_to_parent_comment?.count ?? media.edge_media_to_comment?.count ?? null;
          }
        }
      } catch {
        console.log(`[CI Scraper] COMMENTS_HTML: Failed to parse _sharedData for ${shortcode}`);
      }
    }

    console.log(`[CI Scraper] COMMENTS_HTML: ${comments.length} real comments from HTML for ${shortcode} (${totalAvailable ?? "?"} total available)`);
    return { success: comments.length > 0, comments, shortcode, totalAvailable };
  } catch (err: any) {
    console.log(`[CI Scraper] COMMENTS_HTML: Error for ${shortcode}: ${err.message}`);
    return { success: false, comments: [], shortcode, totalAvailable: null };
  }
}

async function scrapePostCommentsV1(
  shortcode: string,
  postId: string,
  proxyCtx?: StickySessionContext,
): Promise<CommentScrapeResult> {
  const mediaInfoUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;

  try {
    if (proxyCtx) {
      await acquireToken(proxyCtx.accountId, proxyCtx.campaignId, `COMMENTS_V1:${shortcode}`);
    }

    const startMs = Date.now();
    const resp = await transportFetch(mediaInfoUrl, proxyCtx);

    if (!resp.ok) {
      if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_V1`, resp.status, classifyBlock(resp.status, ""), Date.now() - startMs, false);
      console.log(`[CI Scraper] COMMENTS_V1: HTTP ${resp.status} for ${shortcode}, falling back to HTML scrape`);
      return await scrapePostCommentsFromHTML(shortcode, postId, proxyCtx);
    }

    const text = await resp.text();
    const data = JSON.parse(text);
    const item = data?.items?.[0] || data?.graphql?.shortcode_media;
    if (!item) {
      console.log(`[CI Scraper] COMMENTS_V1: No media data for ${shortcode}, falling back to HTML scrape`);
      return await scrapePostCommentsFromHTML(shortcode, postId, proxyCtx);
    }

    const commentEdges = item.edge_media_to_parent_comment?.edges
      || item.edge_media_to_comment?.edges
      || [];
    const previewComments = item.preview_comments || item.comments || [];
    const totalAvailable = item.edge_media_to_parent_comment?.count
      ?? item.edge_media_to_comment?.count
      ?? item.comment_count
      ?? null;

    if (proxyCtx) logProxyTelemetry(proxyCtx, `COMMENTS_V1`, resp.status, null, Date.now() - startMs, commentEdges.length > 0 || previewComments.length > 0);

    const comments: ScrapedComment[] = [];
    const seenIds = new Set<string>();

    for (const edge of commentEdges) {
      const node = edge.node || edge;
      if (!node || !node.text) continue;
      const cid = node.id || node.pk?.toString() || `c_${comments.length}`;
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      comments.push({
        commentId: cid,
        postId,
        shortcode,
        text: String(node.text).substring(0, 2000),
        username: node.owner?.username || node.user?.username || "unknown",
        timestamp: node.created_at ? new Date(node.created_at * 1000).toISOString() : null,
        likes: node.edge_liked_by?.count ?? node.comment_like_count ?? 0,
      });
    }

    for (const c of previewComments) {
      if (!c.text) continue;
      const cid = c.pk?.toString() || c.id || `pc_${comments.length}`;
      if (seenIds.has(cid)) continue;
      seenIds.add(cid);
      comments.push({
        commentId: cid,
        postId,
        shortcode,
        text: String(c.text).substring(0, 2000),
        username: c.user?.username || "unknown",
        timestamp: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
        likes: c.comment_like_count ?? 0,
      });
    }

    if (comments.length === 0) {
      console.log(`[CI Scraper] COMMENTS_V1: 0 comments from V1 API for ${shortcode}, falling back to HTML scrape`);
      return await scrapePostCommentsFromHTML(shortcode, postId, proxyCtx);
    }

    console.log(`[CI Scraper] COMMENTS_V1: ${comments.length} real comments for ${shortcode} (${totalAvailable} total available)`);
    return { success: comments.length > 0, comments, shortcode, totalAvailable };
  } catch (err: any) {
    console.log(`[CI Scraper] COMMENTS_V1: Error for ${shortcode}: ${err.message}, falling back to HTML scrape`);
    return await scrapePostCommentsFromHTML(shortcode, postId, proxyCtx);
  }
}

export async function scrapeCommentsForPosts(
  posts: Array<{ postId: string; shortcode: string; commentCount: number | null }>,
  proxyCtx?: StickySessionContext,
  maxTotalComments: number = 200,
): Promise<{ totalScraped: number; results: CommentScrapeResult[] }> {
  const sortedPosts = [...posts]
    .filter(p => p.shortcode && (p.commentCount === null || p.commentCount > 0))
    .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));

  const results: CommentScrapeResult[] = [];
  let totalScraped = 0;

  for (const post of sortedPosts) {
    if (totalScraped >= maxTotalComments) break;

    await randomDelay();
    const result = await scrapePostComments(post.shortcode, post.postId, proxyCtx);
    results.push(result);
    totalScraped += result.comments.length;

    console.log(`[CI Scraper] COMMENTS_BATCH: ${post.shortcode} → ${result.comments.length} comments | running total: ${totalScraped}/${maxTotalComments}`);
  }

  console.log(`[CI Scraper] COMMENTS_BATCH_COMPLETE: ${totalScraped} real comments from ${results.length} posts`);
  return { totalScraped, results };
}

export async function scrapeInstagramProfile(rawUrl: string, proxyCtx?: StickySessionContext, maxPosts: number = TARGET_POSTS, accountId: string = "unknown", opts?: { allowApifyFallback?: boolean }): Promise<ScrapeResult> {
  const profileUrl = normalizeInstagramUrl(rawUrl);
  const handle = extractHandleFromUrl(rawUrl);
  // P4 isolation seal: namespace cache + rate-limit keys by accountId. Two
  // tenants asking for the same Instagram handle now get independent buckets,
  // so one tenant's CACHE_HIT or RATE_LIMITED state cannot influence another.
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
  const attempts: string[] = [];
  const warnings: string[] = [];
  let posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;
  let collectionMethodUsed: ScrapeResult["collectionMethodUsed"] = "NONE";
  // Fix #1a — transport-reachability tracking. transportSucceeded=true once ANY
  // scrape attempt returns without throwing (even with 0 posts = healthy empty).
  // lastFailureMessage captures the transport error used to classify a block.
  let transportSucceeded = false;
  let lastFailureMessage = "";

  // Safe-off fail-fast (D5/B3): without BRIGHT_DATA_API_KEY + BRIGHT_DATA_ZONE
  // there is NO transport — no direct-fetch fallback. Result is NOT cached so
  // configuring secrets takes effect immediately.
  if (!getScrapingConfig()) {
    console.error(`[CI Scraper] SCRAPING_UNCONFIGURED | Bright Data Unlocker API not configured (BRIGHT_DATA_API_KEY / BRIGHT_DATA_ZONE). Refusing to scrape ${handle}.`);
    return {
      success: false,
      posts: [],
      embeddedComments: [],
      followers: null,
      profileName: handle,
      collectionMethodUsed: "NONE",
      attempts: ["SCRAPING_UNCONFIGURED"],
      warnings: ["SCRAPING_UNCONFIGURED: Set BRIGHT_DATA_API_KEY and BRIGHT_DATA_ZONE (optionally BRIGHT_DATA_COUNTRY) to enable scraping."],
      failureClass: "TRANSIENT",
    };
  }

  await randomDelay();

  // T006 — bare-path backoff identity. When a sticky session ctx exists, the
  // pool manager derives the target from the ctx (accountId + platform +
  // competitorHash); only the bare path needs an explicit one.
  const bareTarget: PoolFetchTarget | undefined = proxyCtx
    ? undefined
    : { accountId, platform: "instagram", targetKey: handle };

  let paginationPages = 0;
  let rawFetchedCount = 0;
  let paginationStopReason = "";
  let embeddedComments: ScrapedComment[] = [];

  attempts.push("WEB_API");
  try {
    const startMs = Date.now();
    const result = await attemptWebProfileApi(handle, proxyCtx, maxPosts, bareTarget);
    transportSucceeded = true;
    if (proxyCtx) {
      logProxyTelemetry(proxyCtx, "WEB_API", 200, null, Date.now() - startMs, result.posts.length > 0);
    }
    posts = result.posts;
    embeddedComments = result.embeddedComments || [];
    followers = result.followers;
    profileName = result.profileName;
    paginationPages = result.paginationPages;
    rawFetchedCount = result.rawFetchedCount;
    paginationStopReason = result.paginationStopReason;
    scrapeStats.totalBytesEstimated += result.bytesReceived;
    if (posts.length > 0) {
      collectionMethodUsed = "WEB_API";
      scrapeStats.webApiSuccess++;
      console.log(`[CI Scraper] WEB_API SUCCESS: ${posts.length} posts (${paginationPages} pages, stop=${paginationStopReason}), ${followers ?? "unknown"} followers for ${handle}`);
    }
  } catch (err: any) {
    lastFailureMessage = typeof err?.message === "string" ? err.message : "";
    if (proxyCtx) {
      const bc = classifyBlock(null, err.message);
      logProxyTelemetry(proxyCtx, "WEB_API", null, bc, 0, false);
    }
    console.log(`[CI Scraper] WEB_API failed for ${handle}: ${err.message}, trying HTML_PARSE...`);
    attempts.push("HTML_PARSE");
    try {
      const htmlStartMs = Date.now();
      const result = await attemptHtmlPageParse(profileUrl, handle, proxyCtx, bareTarget);
      transportSucceeded = true;
      if (proxyCtx) logProxyTelemetry(proxyCtx, "HTML_PARSE", 200, null, Date.now() - htmlStartMs, result.posts.length > 0);
      posts = result.posts;
      followers = result.followers;
      profileName = result.profileName;
      scrapeStats.totalBytesEstimated += result.bytesReceived;
      if (posts.length > 0) {
        collectionMethodUsed = "HTML_PARSE";
        scrapeStats.htmlParseSuccess++;
        console.log(`[CI Scraper] HTML_PARSE SUCCESS: ${posts.length} posts for ${handle}`);
      } else {
        console.log(`[CI Scraper] HTML_PARSE: Page loaded but no post data extracted for ${handle}`);
      }
    } catch (err2: any) {
      lastFailureMessage = `${typeof err?.message === "string" ? err.message : ""} | ${typeof err2?.message === "string" ? err2.message : ""}`;
      if (proxyCtx) logProxyTelemetry(proxyCtx, "HTML_PARSE", null, classifyBlock(null, err2.message), 0, false);
      warnings.push(`WEB_API failed: ${err.message} | HTML_PARSE failed: ${err2.message}`);
      console.log(`[CI Scraper] HTML_PARSE FAILED for ${handle}: ${err2.message}`);
    }
  }

  // Phase 2 (2026-07-20) — Apify fallback. Bright Data's Unlocker stopped
  // passing IG internal-API endpoints (~Jul 19: synthesized 400 + canned
  // "obsolete endpoint" interception) and logged-out profile HTML carries no
  // embedded post data, so WEB_API and HTML_PARSE can both "succeed" at
  // transport with 0 posts. The gate is therefore posts.length === 0 (NOT
  // catch-only). Bright Data stays first in the ladder so this self-heals if
  // the provider restores IG support.
  // Root-cause audit: .local/docs/audits/owned-ig-scrape-root-cause-2026-07-20.md
  //
  // OPT-IN ONLY (allowApifyFallback): the competitor fetch path runs under the
  // F6.9 45s watchdog (data-acquisition FETCH_WATCHDOG_TIMEOUT_MS) while an
  // Apify actor run takes ~80-120s — the watchdog would abandon the raced
  // promise mid-run, the actor would keep billing, and the evict/restart cycle
  // would double spend across the competitor fleet. Only the owned-channel
  // path (user-channel-scraper, no watchdog) opts in. Competitor semantics are
  // unchanged from the pre-fallback ladder.
  if (posts.length === 0 && !opts?.allowApifyFallback) {
    attempts.push("APIFY_ACTOR_SKIPPED");
    console.log(`[CI Scraper] APIFY_ACTOR_SKIPPED for ${handle} (caller did not opt in; watchdog-budgeted path)`);
  }
  if (posts.length === 0 && opts?.allowApifyFallback) {
    const { isInstagramApifyConfigured, scrapeInstagramViaApify } = await import("./instagram-apify-scraper");
    if (!isInstagramApifyConfigured()) {
      attempts.push("APIFY_ACTOR_SKIPPED");
      warnings.push("APIFY_ACTOR_SKIPPED: APIFY_API_KEY not set — no Apify fallback available.");
      console.log(`[CI Scraper] APIFY_ACTOR_SKIPPED for ${handle} (APIFY_API_KEY not set)`);
    } else {
      attempts.push("APIFY_ACTOR");
      try {
        const apifyResult = await scrapeInstagramViaApify(handle, maxPosts);
        // Actor run completed ⇒ transport reached the platform. 0 posts from a
        // completed run = healthy-empty (failureClass NONE), same semantics as
        // the other rungs.
        transportSucceeded = true;
        posts = apifyResult.posts;
        followers = apifyResult.followers ?? followers;
        profileName = apifyResult.profileName ?? profileName;
        if (posts.length > 0) {
          collectionMethodUsed = "APIFY_ACTOR";
          scrapeStats.apifyActorSuccess++;
          console.log(`[CI Scraper] APIFY_ACTOR SUCCESS: ${posts.length} posts, ${followers ?? "unknown"} followers for ${handle}`);
        } else {
          console.log(`[CI Scraper] APIFY_ACTOR: run completed but no posts extracted for ${handle}`);
        }
      } catch (err3: any) {
        // Deliberately NOT folded into lastFailureMessage: classifyScrapeFailure
        // pattern-matches for IG block tokens ("403"/"forbidden"/...), and an
        // Apify-side error (e.g. "Apify API 403" on a bad token) must never
        // stamp a GENUINE_BLOCK 24h cooldown on the Instagram target. Block
        // classification stays owned by the Bright Data transport error.
        // The warning text is additionally sanitized: user-channel-scraper's
        // isBlockWarning() substring-matches "403"/"429"/"RATE_LIMIT" against
        // result.warnings, and an Apify-side status code must not trigger IG
        // block detection (session rotation + a second billed Apify run).
        const rawMsg = typeof err3?.message === "string" ? err3.message : "unknown";
        const msg = rawMsg.replace(/\b(403|429)\b/g, "4xx").replace(/rate.?limit(ed)?/gi, "throttled");
        warnings.push(`APIFY_ACTOR failed: ${msg}`);
        console.log(`[CI Scraper] APIFY_ACTOR FAILED for ${handle}: ${msg}`);
      }
    }
  }

  if (posts.length < 5) {
    // 2026-07 Unlocker rebuild: headless browser rendering removed — a local
    // Chromium cannot route through the Unlocker REST API, and running it
    // direct would be an unproxied-fingerprint leak. Recorded explicitly
    // (B4: explicit classification over hidden ambiguity).
    attempts.push("HEADLESS_RENDER_SKIPPED");
    warnings.push("HEADLESS_RENDER_SKIPPED: headless rendering retired in Unlocker API rebuild (no browser-level transport).");
    console.log(`[CI Scraper] HEADLESS_RENDER_SKIPPED for ${handle} (retired in Unlocker rebuild)`);
  }

  if (posts.length === 0) {
    warnings.push("SCRAPE_BLOCKED");
    collectionMethodUsed = "NONE";
    scrapeStats.scrapeBlocked++;
    console.log(`[CI Scraper] SCRAPE_BLOCKED: All methods failed for ${handle}`);
  }

  const stats = getScrapeStats();
  console.log(`[CI Scraper] Stats: total=${stats.totalRequests}, success=${stats.successRate}, blocked=${stats.blockedRate}, bandwidth=${stats.bandwidthMB}`);

  if (!paginationStopReason && posts.length > 0) {
    paginationStopReason = posts.length >= maxPosts ? "TARGET_REACHED" : "INSTAGRAM_API_CEILING";
  }

  console.log(`[CI Scraper] EMBEDDED_COMMENT_SUMMARY | ${embeddedComments.length} real comments from profile scrape | ${posts.length} posts | for ${handle}`);

  // Fix #1a — final failure classification. Success or transport-reached-but-
  // empty ⇒ NONE (never a block). Zero posts with NO transport ⇒ classify the
  // captured transport error as GENUINE_BLOCK vs TRANSIENT.
  let failureClass: ScrapeResult["failureClass"] = "NONE";
  if (posts.length === 0 && !transportSucceeded) {
    failureClass = classifyScrapeFailure(lastFailureMessage);
  }

  const result: ScrapeResult = {
    success: posts.length > 0,
    posts: posts.slice(0, maxPosts > 60 ? 60 : maxPosts),
    embeddedComments,
    followers,
    profileName: profileName || handle,
    collectionMethodUsed,
    attempts,
    warnings,
    paginationPages: paginationPages || 1,
    rawFetchedCount: rawFetchedCount || posts.length,
    paginationStopReason,
    failureClass,
  };

  // P4 isolation seal: cacheKey is already account-namespaced via nsCacheKey above.
  profileCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
