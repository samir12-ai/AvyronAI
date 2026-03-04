import { ProxyAgent } from "undici";
import type { StickySessionContext } from "./proxy-pool-manager";
import { logProxyTelemetry, classifyBlock, rotateSessionOnBlock, getRetryDelay, getProxyConfig } from "./proxy-pool-manager";

type Browser = any;
type Page = any;

let playwrightChromium: any = null;
async function getChromium(): Promise<any> {
  if (playwrightChromium) return playwrightChromium;
  try {
    const pw = await import("playwright-chromium");
    playwrightChromium = pw.chromium;
    return playwrightChromium;
  } catch {
    try {
      const pw: any = await import("playwright");
      playwrightChromium = pw.chromium;
      return playwrightChromium;
    } catch {
      return null;
    }
  }
}

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

function randomDelay(): Promise<void> {
  const ms = 1000 + Math.random() * 2000;
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
  followers: number | null;
  profileName: string | null;
  collectionMethodUsed: "WEB_API" | "HTML_PARSE" | "HEADLESS_RENDER" | "NONE";
  attempts: string[];
  warnings: string[];
  paginationPages?: number;
  rawFetchedCount?: number;
  paginationStopReason?: string;
}

export interface ScrapeStats {
  totalRequests: number;
  webApiSuccess: number;
  htmlParseSuccess: number;
  headlessRenderSuccess: number;
  scrapeBlocked: number;
  totalBytesEstimated: number;
  lastReset: number;
}

const scrapeStats: ScrapeStats = {
  totalRequests: 0,
  webApiSuccess: 0,
  htmlParseSuccess: 0,
  headlessRenderSuccess: 0,
  scrapeBlocked: 0,
  totalBytesEstimated: 0,
  lastReset: Date.now(),
};

export function getScrapeStats(): ScrapeStats & { successRate: string; blockedRate: string; bandwidthMB: string } {
  const total = scrapeStats.totalRequests || 1;
  return {
    ...scrapeStats,
    successRate: `${(((scrapeStats.webApiSuccess + scrapeStats.htmlParseSuccess + scrapeStats.headlessRenderSuccess) / total) * 100).toFixed(1)}%`,
    blockedRate: `${((scrapeStats.scrapeBlocked / total) * 100).toFixed(1)}%`,
    bandwidthMB: `${(scrapeStats.totalBytesEstimated / (1024 * 1024)).toFixed(2)} MB`,
  };
}

const MAX_BATCH_SIZE = 10;
let currentBatchCount = 0;
let batchResetTime = Date.now();
const BATCH_WINDOW_MS = 60 * 60 * 1000;

function checkBatchLimit(): boolean {
  if (Date.now() - batchResetTime > BATCH_WINDOW_MS) {
    currentBatchCount = 0;
    batchResetTime = Date.now();
  }
  if (currentBatchCount >= MAX_BATCH_SIZE) {
    return false;
  }
  currentBatchCount++;
  return true;
}

const profileCache = new Map<string, { data: ScrapeResult; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10000;

function normalizeInstagramUrl(url: string): string {
  let handle = url.trim();
  handle = handle.split("?")[0].split("#")[0];
  handle = handle.replace(/\/$/, "");
  const match = handle.match(/instagram\.com\/([^\/\?#]+)/);
  if (match) handle = match[1];
  handle = handle.replace(/^@/, "").toLowerCase();
  return `https://www.instagram.com/${handle}/`;
}

function extractHandleFromUrl(url: string): string {
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

const TARGET_POSTS = 30;
const MAX_PAGINATION_PAGES = 4;
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

async function attemptWebProfileApi(handle: string, proxyCtx?: StickySessionContext): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesReceived: number; paginationPages: number; rawFetchedCount: number; paginationStopReason: PaginationStopReason; diagnostics: PaginationDiagnostics }> {
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${handle}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  const dispatcher = proxyCtx?.session.dispatcher ?? undefined;
  const sessionId = proxyCtx?.session.sessionId ?? null;
  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }
  const proxyUsed = !!dispatcher;

  console.log(`[CI Scraper] WEB_API: Fetching web_profile_info for ${handle} ${proxyUsed ? `via Bright Data proxy (session=${sessionId})` : "direct"}`);

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

  const response = await fetch(apiUrl, fetchOptions);
  diag.page1HttpStatus = response.status;

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  let bytesReceived = Buffer.byteLength(text, "utf-8");
  diag.page1ResponseKB = Math.round(bytesReceived / 1024 * 10) / 10;

  console.log(`[CI Scraper] WEB_API: PAGE_1 response ${diag.page1ResponseKB} KB, HTTP ${diag.page1HttpStatus} for ${handle}`);

  const data = JSON.parse(text);
  const user = data?.data?.user;
  if (!user) throw new Error("No user data in API response");

  if (user.is_private === true) {
    console.log(`[CI Scraper] WEB_API: ACCOUNT_PRIVATE for ${handle}`);
    diag.stopReason = "ACCOUNT_PRIVATE";
    return { posts: [], followers: user.edge_followed_by?.count ?? null, profileName: user.full_name || handle, bytesReceived, paginationPages: 1, rawFetchedCount: 0, paginationStopReason: "ACCOUNT_PRIVATE", diagnostics: diag };
  }

  const profileName = user.full_name || user.username || handle;
  const followers = user.edge_followed_by?.count ?? null;
  const userId = user.id;
  diag.userId = userId;

  const mediaData = user.edge_owner_to_timeline_media;
  const edges = mediaData?.edges || [];
  const posts: ScrapedPost[] = [];
  const seenIds = new Set<string>();

  for (const edge of edges) {
    const post = parsePostFromGraphQL(edge.node, handle);
    if (!seenIds.has(post.postId)) {
      seenIds.add(post.postId);
      posts.push(post);
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
    return { posts, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "NO_MORE_PAGES", diagnostics: diag };
  }

  if (posts.length >= TARGET_POSTS) {
    diag.stopReason = "TARGET_REACHED";
    diag.totalPostsFetched = posts.length;
    return { posts, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "TARGET_REACHED", diagnostics: diag };
  }

  if (!userId) {
    diag.stopReason = "NO_USER_ID";
    diag.totalPostsFetched = posts.length;
    console.log(`[CI Scraper] WEB_API: NO_USER_ID — cannot paginate without userId`);
    return { posts, followers, profileName, bytesReceived, paginationPages: 1, rawFetchedCount: posts.length, paginationStopReason: "NO_USER_ID", diagnostics: diag };
  }

  diag.paginationAttempted = true;
  let paginationPages = 1;
  let paginationSuccess = false;

  console.log(`[CI Scraper] WEB_API: PAGE_1 has ${posts.length}/${TARGET_POSTS} posts with has_next_page=true. Attempting v1 feed pagination...`);

  const lastPostNode = edges[edges.length - 1]?.node;
  const lastPostId = lastPostNode?.id;

  if (lastPostId) {
    diag.paginationMethod = "V1_FEED_API";
    await randomDelay();

    const maxId = `${lastPostId}_${userId}`;
    const feedUrl = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=50&max_id=${maxId}`;

    console.log(`[CI Scraper] WEB_API: PAGINATION_ATTEMPT | method=V1_FEED_API | userId=${userId} | max_id=${maxId.substring(0, 30)}... | for ${handle}`);

    try {
      const page2StartMs = Date.now();
      const feedResponse = await fetch(feedUrl, fetchOptions);
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
              }
            }
            paginationPages = 2;
            paginationSuccess = true;

            let nextMaxId = feedData?.next_max_id;
            while (feedData?.more_available && nextMaxId && posts.length < TARGET_POSTS && paginationPages < MAX_PAGINATION_PAGES) {
              paginationPages++;
              await randomDelay();

              const nextFeedUrl = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=50&max_id=${nextMaxId}`;
              console.log(`[CI Scraper] WEB_API: PAGINATION_PAGE_${paginationPages} | have=${posts.length}/${TARGET_POSTS} | for ${handle}`);

              try {
                const pageStartMs = Date.now();
                const nextResp = await fetch(nextFeedUrl, fetchOptions);
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

  if (paginationSuccess) {
    diag.stopReason = posts.length >= TARGET_POSTS ? "TARGET_REACHED" :
      paginationPages >= MAX_PAGINATION_PAGES ? "MAX_PAGES_REACHED" :
      "FEED_PAGINATION_SUCCESS";
    console.log(`[CI Scraper] WEB_API: PAGINATION_SUCCESS | ${posts.length} posts across ${paginationPages} pages | stopReason=${diag.stopReason} | for ${handle}`);
  } else if (diag.stopReason === "UNKNOWN_FAILURE" || diag.stopReason === "FEED_PAGINATION_AUTH_REQUIRED" || diag.stopReason === "FEED_PAGINATION_BLOCKED") {
    if (posts.length === INSTAGRAM_PUBLIC_API_CEILING && (diag.totalMediaCount ?? 0) > INSTAGRAM_PUBLIC_API_CEILING) {
      diag.stopReason = "INSTAGRAM_API_CEILING" as PaginationStopReason;
      console.log(`[CI Scraper] WEB_API: INSTAGRAM_API_CEILING | Profile has ${diag.totalMediaCount} posts but Instagram public API returns max ${INSTAGRAM_PUBLIC_API_CEILING} per request. Pagination requires authenticated session (login). | ${diag.paginationErrorDetail || "No error detail"} | for ${handle}`);
    }
  }

  diag.pagesCompleted = paginationPages;
  diag.totalPostsFetched = posts.length;

  const rawFetchedCount = posts.length;
  const finalStopReason = diag.stopReason;

  console.log(`[CI Scraper] WEB_API: FINAL_AUDIT | posts=${posts.length} | pages=${paginationPages} | stopReason=${finalStopReason} | totalMediaOnProfile=${diag.totalMediaCount} | paginationAttempted=${diag.paginationAttempted} | paginationMethod=${diag.paginationMethod || "NONE"} | paginationHTTP=${diag.paginationHttpStatus || "N/A"} | error=${diag.paginationErrorDetail || "NONE"} | for ${handle}`);

  return { posts, followers, profileName, bytesReceived, paginationPages, rawFetchedCount, paginationStopReason: finalStopReason, diagnostics: diag };
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

async function attemptHtmlPageParse(profileUrl: string, handle: string, proxyCtx?: StickySessionContext): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesReceived: number }> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
  };

  const dispatcher = proxyCtx?.session.dispatcher ?? undefined;
  const fetchOptions: any = { headers, redirect: "follow" };
  if (dispatcher) {
    fetchOptions.dispatcher = dispatcher;
  }

  console.log(`[CI Scraper] HTML_PARSE: Fetching ${profileUrl} ${dispatcher ? `via pool session (${proxyCtx?.session.sessionId})` : "direct"}`);

  const response = await fetch(profileUrl, fetchOptions);
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

async function attemptHeadlessRender(profileUrl: string, handle: string, proxyCtx?: StickySessionContext): Promise<{ posts: ScrapedPost[]; followers: number | null; profileName: string | null; bytesEstimated: number }> {
  const chromiumModule = await getChromium();
  if (!chromiumModule) throw new Error("Playwright not available");

  const proxy = proxyCtx ? getProxyConfig() : getProxyConfig();
  let browser: Browser | null = null;

  try {
    const baseArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
    if (proxy) {
      baseArgs.push("--ignore-certificate-errors");
    }

    const launchOptions: any = {
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: baseArgs,
    };

    if (proxy) {
      launchOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      };
      console.log(`[CI Scraper] HEADLESS_RENDER: Launching with Bright Data proxy for ${handle}`);
    } else {
      console.log(`[CI Scraper] HEADLESS_RENDER: Launching direct (no proxy) for ${handle}`);
    }

    browser = await chromiumModule.launch(launchOptions);

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page: Page = await context.newPage();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const posts: any[] = [];
      let followers: number | null = null;
      let profileName: string | null = null;

      const nameEl = document.querySelector("header h2, header span[dir]");
      if (nameEl) profileName = nameEl.textContent?.trim() || null;

      const statEls = document.querySelectorAll("header ul li span, header section ul li span");
      for (let i = 0; i < statEls.length; i++) {
        const el = statEls[i];
        const title = el.getAttribute("title");
        if (title && /\d/.test(title)) {
          const parent = el.closest("li");
          const parentText = parent?.textContent || "";
          if (parentText.toLowerCase().includes("follower")) {
            followers = parseInt(title.replace(/,/g, ""));
          }
        }
      }

      const postLinks = document.querySelectorAll("article a[href*='/p/'], article a[href*='/reel/'], main a[href*='/p/'], main a[href*='/reel/']");
      const seen = new Set<string>();
      for (let i = 0; i < postLinks.length; i++) {
        const link = postLinks[i] as HTMLAnchorElement;
        const href = link.href;
        if (seen.has(href)) continue;
        seen.add(href);
        const isReel = href.includes("/reel/");
        const shortcode = href.match(/\/(p|reel)\/([^\/]+)/)?.[2] || "";
        const img = link.querySelector("img");
        const video = link.querySelector("video");

        posts.push({
          shortcode,
          permalink: href,
          mediaType: isReel || video ? "REEL" : "IMAGE",
          caption: img?.getAttribute("alt") || null,
          timestamp: null,
          likes: null,
          comments: null,
          views: null,
          videoUrl: null,
          displayUrl: img?.getAttribute("src") || null,
        });

        if (posts.length >= 30) break;
      }

      return { posts, followers, profileName };
    });

    await context.close();

    const scrapedPosts: ScrapedPost[] = data.posts.map((p: any) => ({
      postId: p.shortcode,
      permalink: p.permalink.startsWith("http") ? p.permalink : `https://www.instagram.com${p.permalink}`,
      mediaType: p.mediaType as ScrapedPost["mediaType"],
      timestamp: p.timestamp,
      caption: p.caption ? String(p.caption).substring(0, 2000) : null,
      likes: p.likes,
      comments: p.comments,
      views: p.views,
      videoUrl: null,
      displayUrl: p.displayUrl || null,
      shortcode: p.shortcode || "",
    }));

    const bytesEstimated = scrapedPosts.length * 500 + 50000;
    console.log(`[CI Scraper] HEADLESS_RENDER: Found ${scrapedPosts.length} posts for ${handle}, ~${(bytesEstimated / 1024).toFixed(1)} KB estimated`);

    return {
      posts: scrapedPosts,
      followers: data.followers,
      profileName: data.profileName || handle,
      bytesEstimated,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function scrapeInstagramProfile(rawUrl: string, proxyCtx?: StickySessionContext): Promise<ScrapeResult> {
  const profileUrl = normalizeInstagramUrl(rawUrl);
  const handle = extractHandleFromUrl(rawUrl);

  const cached = profileCache.get(handle);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[CI Scraper] CACHE_HIT for ${handle}`);
    return { ...cached.data, attempts: [...cached.data.attempts, "CACHE_HIT"] };
  }

  const lastRequest = rateLimitMap.get(handle);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
    const cachedAny = profileCache.get(handle);
    if (cachedAny) return { ...cachedAny.data, attempts: ["RATE_LIMITED", "CACHE_HIT"] };
  }
  rateLimitMap.set(handle, Date.now());

  if (!checkBatchLimit()) {
    console.log(`[CI Scraper] BATCH_LIMIT reached (${MAX_BATCH_SIZE} profiles/hour). Returning cached or blocked.`);
    const cachedFallback = profileCache.get(handle);
    if (cachedFallback) return { ...cachedFallback.data, attempts: ["BATCH_LIMIT", "CACHE_HIT"] };
    return {
      success: false,
      posts: [],
      followers: null,
      profileName: handle,
      collectionMethodUsed: "NONE",
      attempts: ["BATCH_LIMIT"],
      warnings: ["BATCH_LIMIT_EXCEEDED: Testing phase limits scraping to 10 profiles per hour."],
    };
  }

  scrapeStats.totalRequests++;
  const attempts: string[] = [];
  const warnings: string[] = [];
  let posts: ScrapedPost[] = [];
  let followers: number | null = null;
  let profileName: string | null = null;
  let collectionMethodUsed: ScrapeResult["collectionMethodUsed"] = "NONE";

  const proxyAvailable = !!getProxyConfig();
  if (!proxyAvailable) {
    console.warn("[CI Scraper] WARNING: No Bright Data proxy configured. Scraping without proxy may trigger rate limits.");
  }

  await randomDelay();

  let paginationPages = 0;
  let rawFetchedCount = 0;
  let paginationStopReason = "";

  attempts.push("WEB_API");
  try {
    const startMs = Date.now();
    const result = await attemptWebProfileApi(handle, proxyCtx);
    if (proxyCtx) {
      logProxyTelemetry(proxyCtx, "WEB_API", 200, null, Date.now() - startMs, result.posts.length > 0);
    }
    posts = result.posts;
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
    if (proxyCtx) {
      const bc = classifyBlock(null, err.message);
      logProxyTelemetry(proxyCtx, "WEB_API", null, bc, 0, false);
    }
    console.log(`[CI Scraper] WEB_API failed for ${handle}: ${err.message}, trying HTML_PARSE...`);
    attempts.push("HTML_PARSE");
    try {
      const htmlStartMs = Date.now();
      const result = await attemptHtmlPageParse(profileUrl, handle, proxyCtx);
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
      if (proxyCtx) logProxyTelemetry(proxyCtx, "HTML_PARSE", null, classifyBlock(null, err2.message), 0, false);
      warnings.push(`WEB_API failed: ${err.message} | HTML_PARSE failed: ${err2.message}`);
      console.log(`[CI Scraper] HTML_PARSE FAILED for ${handle}: ${err2.message}`);
    }
  }

  if (posts.length < 5) {
    await randomDelay();
    attempts.push("HEADLESS_RENDER");
    try {
      const headlessStartMs = Date.now();
      const result = await attemptHeadlessRender(profileUrl, handle, proxyCtx);
      if (proxyCtx) logProxyTelemetry(proxyCtx, "HEADLESS_RENDER", 200, null, Date.now() - headlessStartMs, result.posts.length > 0);
      scrapeStats.totalBytesEstimated += result.bytesEstimated;
      if (result.posts.length > posts.length) {
        posts = result.posts;
        collectionMethodUsed = "HEADLESS_RENDER";
        scrapeStats.headlessRenderSuccess++;
        console.log(`[CI Scraper] HEADLESS_RENDER SUCCESS: ${posts.length} posts for ${handle}`);
      }
      if (!followers && result.followers) followers = result.followers;
      if (!profileName && result.profileName) profileName = result.profileName;
    } catch (err: any) {
      if (proxyCtx) logProxyTelemetry(proxyCtx, "HEADLESS_RENDER", null, classifyBlock(null, err.message), 0, false);
      warnings.push(`HEADLESS_RENDER failed: ${err.message}`);
      console.log(`[CI Scraper] HEADLESS_RENDER FAILED for ${handle}: ${err.message}`);
    }
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
    paginationStopReason = posts.length >= TARGET_POSTS ? "TARGET_REACHED" : "INSTAGRAM_API_CEILING";
  }

  const result: ScrapeResult = {
    success: posts.length > 0,
    posts: posts.slice(0, 60),
    followers,
    profileName: profileName || handle,
    collectionMethodUsed,
    attempts,
    warnings,
    paginationPages: paginationPages || 1,
    rawFetchedCount: rawFetchedCount || posts.length,
    paginationStopReason,
  };

  profileCache.set(handle, { data: result, timestamp: Date.now() });
  return result;
}
