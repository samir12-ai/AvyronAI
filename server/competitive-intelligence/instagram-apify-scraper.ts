import type { ScrapedPost } from "./profile-scraper";

/**
 * Instagram Apify adapter (Phase 2, 2026-07-20, consolidated under Unified Acquisition Authority).
 *
 * Carried invariants (Seal #5):
 *   F7.1  token via Authorization header, never in URL (+ defensive strip)
 *   F6.7  15s AbortController on every direct Apify HTTP call
 *   F6.12 circuit-breaker gate on the shared "apify" breaker key
 *
 * NULL≠zero (P-2 doctrine): missing or hidden metrics map to null, never 0.
 * Instagram reports hidden like counts as -1 — negative counts are null too.
 */

const APIFY_BASE_URL = "https://api.apify.com/v2";
const APIFY_INSTAGRAM_ACTOR = "apify~instagram-profile-scraper";
const APIFY_RUN_TIMEOUT_MS = 120_000;
const APIFY_POLL_INTERVAL_MS = 5_000;

function getApifyApiKey(): string | null {
  return process.env.APIFY_API_KEY || null;
}

export function isInstagramApifyConfigured(): boolean {
  if (process.env.AVYRON_DEMO_MODE === "1") return false;
  return !!getApifyApiKey();
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

/** Shape observed live 2026-07-20 (probe v4) from apify~instagram-profile-scraper. */
interface ApifyIgProfileItem {
  username?: string;
  fullName?: string;
  followersCount?: number;
  postsCount?: number;
  private?: boolean;
  latestPosts?: ApifyIgPostItem[];
  [key: string]: any;
}

interface ApifyIgPostItem {
  id?: string;
  type?: string; // "Image" | "Video" | "Sidecar"
  productType?: string; // "clips" for reels on some actor versions
  shortCode?: string;
  caption?: string;
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  timestamp?: string; // ISO 8601
  [key: string]: any;
}

async function apifyFetch(path: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getApifyApiKey();
  if (!apiKey) throw new Error("APIFY_API_KEY not configured");

  // F6.12 — shared breaker with the TikTok Apify path: one upstream, one breaker.
  const { isBreakerOpen, recordBreakerSuccess, recordBreakerFailure } = await import("./scrape-safety");
  const cb = isBreakerOpen("apify", "default");
  if (cb.open) {
    throw new Error(`BREAKER_OPEN: apify:default (${cb.reason})`);
  }

  // F7.1 — never put the Apify token in the URL; strip any ?token= defensively.
  const cleanedPath = path.replace(/([?&])token=[^&]*(&|$)/g, (_m, lead, tail) => (lead === "?" && tail === "" ? "" : lead === "&" && tail === "" ? "" : lead === "?" ? "?" : "&"));
  const url = `${APIFY_BASE_URL}${cleanedPath}`;

  // F6.7 — 15s outbound timeout on the single HTTP call; the run lifecycle has
  // its own deadline in waitForRun().
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    recordBreakerFailure("apify", "default");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    recordBreakerFailure("apify", "default");
    const body = await res.text();
    throw new Error(`Apify API ${res.status}: ${body.substring(0, 300)}`);
  }

  recordBreakerSuccess("apify", "default");
  return res.json();
}

async function waitForRun(runId: string): Promise<ApifyRunResponse["data"]> {
  const deadline = Date.now() + APIFY_RUN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { data } = await apifyFetch(`/actor-runs/${runId}`);

    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED" || data.status === "ABORTED" || data.status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} ended with status: ${data.status}`);
    }

    await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
  }

  throw new Error(`Apify run ${runId} timed out after ${APIFY_RUN_TIMEOUT_MS / 1000}s`);
}

/** NULL≠zero: undefined/null/non-numeric/negative (hidden counts) → null. */
function toNullableCount(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (isNaN(n) || n < 0) return null;
  return n;
}

function mapMediaType(item: ApifyIgPostItem): ScrapedPost["mediaType"] {
  const t = (item.type || "").toLowerCase();
  const pt = (item.productType || "").toLowerCase();
  if (t === "sidecar") return "CAROUSEL";
  if (t === "video") return pt.includes("clips") || pt.includes("reel") ? "REEL" : "VIDEO";
  if (t === "image") return "IMAGE";
  return "UNKNOWN";
}

function mapApifyItemToScrapedPost(item: ApifyIgPostItem): ScrapedPost | null {
  const shortcode = (item.shortCode || "").trim();
  if (!shortcode) return null; // shortcode is the P-2 lineage anchor — no anchor, no post.

  const postId = item.id || shortcode;
  const permalink = item.url || `https://www.instagram.com/p/${shortcode}/`;

  return {
    postId,
    permalink,
    mediaType: mapMediaType(item),
    timestamp: typeof item.timestamp === "string" && item.timestamp.length > 0 ? item.timestamp : null,
    caption: typeof item.caption === "string" && item.caption.length > 0 ? item.caption : null,
    likes: toNullableCount(item.likesCount),
    comments: toNullableCount(item.commentsCount),
    views: toNullableCount(item.videoViewCount ?? item.videoPlayCount),
    videoUrl: typeof item.videoUrl === "string" && item.videoUrl.length > 0 ? item.videoUrl : null,
    displayUrl: typeof item.displayUrl === "string" && item.displayUrl.length > 0 ? item.displayUrl : null,
    shortcode,
  };
}

export interface InstagramApifyResult {
  posts: ScrapedPost[];
  followers: number | null;
  postsCount?: number | null;
  profileName: string | null;
  runId?: string | null;
  datasetId?: string | null;
  usageUsd?: number | null;
  isConfirmedEmpty?: boolean;
  isPartialCoverage?: boolean;
  isPrivate?: boolean;
  error?: string | null;
}

const APIFY_INSTAGRAM_POSTS_FALLBACK_ACTOR = "apify~instagram-scraper";

export async function scrapeInstagramViaApify(handle: string, maxPosts: number): Promise<InstagramApifyResult> {
  const { isApifyAcquisitionConfigured, runActorAndGetItems } = await import("../acquisition/apify-client");
  if (!isApifyAcquisitionConfigured() && !getApifyApiKey()) {
    throw new Error("APIFY_API_KEY not configured");
  }

  console.log(`[InstagramApify] Starting scrape for @${handle} via Apify actor ${APIFY_INSTAGRAM_ACTOR}`);

  try {
    const runResult = await runActorAndGetItems({
      actorId: APIFY_INSTAGRAM_ACTOR,
      input: { usernames: [handle] },
      budgetMs: APIFY_RUN_TIMEOUT_MS,
      label: `InstagramProfile-${handle}`,
    });

    let runId = runResult.runId;
    let datasetId = runResult.datasetId;
    let usageUsd = runResult.usageUsd;
    const items: ApifyIgProfileItem[] = runResult.items;

    if (!Array.isArray(items) || items.length === 0) {
      console.warn(`[InstagramApify] No items returned for @${handle}`);
      return {
        posts: [],
        followers: null,
        postsCount: null,
        profileName: null,
        runId,
        datasetId,
        usageUsd,
        isConfirmedEmpty: false,
        error: "EMPTY_PROVIDER_RESPONSE: Apify returned 0 profile items",
      };
    }

    // The profile actor returns one item per requested username.
    const profile = items.find((it) => (it?.username || "").toLowerCase() === handle.toLowerCase()) || items[0];

    if ((profile as any)?.error || (profile as any)?.errorDescription) {
      const pErr = (profile as any).errorDescription || (profile as any).error;
      return {
        posts: [],
        followers: null,
        postsCount: null,
        profileName: null,
        runId,
        datasetId,
        usageUsd,
        isConfirmedEmpty: false,
        error: `Instagram profile actor error: ${pErr}`,
      };
    }

    const rawPosts = Array.isArray(profile.latestPosts) ? profile.latestPosts : [];
    const posts: ScrapedPost[] = [];
    for (const raw of rawPosts) {
      const post = mapApifyItemToScrapedPost(raw);
      if (post) posts.push(post);
      if (posts.length >= maxPosts) break;
    }

    const followers = toNullableCount(profile.followersCount);
    const postsCount = toNullableCount(profile.postsCount);
    const isPrivate = profile.private === true;
    const profileName = typeof profile.fullName === "string" && profile.fullName.trim().length > 0
      ? profile.fullName.trim()
      : (typeof profile.username === "string" && profile.username.length > 0 ? profile.username : null);

    // When apify~instagram-profile-scraper returns profile header metadata (e.g. username + followersCount)
    // but omits the timeline edge (postsCount === null or postsCount > 0 while latestPosts is []),
    // fall back to apify~instagram-scraper (resultsType: "posts") so timeline posts are not missed.
    if (posts.length === 0 && !isPrivate && postsCount !== 0) {
      try {
        console.log(
          `[InstagramApify] Profile header returned 0 timeline posts for @${handle} (postsCount=${postsCount ?? "undefined"}); invoking fallback post actor ${APIFY_INSTAGRAM_POSTS_FALLBACK_ACTOR}`
        );
        const fallbackResult = await runActorAndGetItems({
          actorId: APIFY_INSTAGRAM_POSTS_FALLBACK_ACTOR,
          input: {
            directUrls: [`https://www.instagram.com/${handle}/`],
            resultsType: "posts",
            resultsLimit: Math.max(12, maxPosts),
          },
          budgetMs: APIFY_RUN_TIMEOUT_MS,
          label: `InstagramPostsFallback-${handle}`,
        });
        if (Array.isArray(fallbackResult.items) && fallbackResult.items.length > 0) {
          for (const raw of fallbackResult.items) {
            if ((raw as any)?.error) continue;
            const post = mapApifyItemToScrapedPost(raw);
            if (post) posts.push(post);
            if (posts.length >= maxPosts) break;
          }
          if (posts.length > 0) {
            runId = fallbackResult.runId || runId;
            datasetId = fallbackResult.datasetId || datasetId;
          }
        }
        if (typeof fallbackResult.usageUsd === "number") {
          usageUsd = (usageUsd ?? 0) + fallbackResult.usageUsd;
        }
      } catch (fbErr: any) {
        console.warn(`[InstagramApify] Fallback post actor warning for @${handle}: ${fbErr?.message || fbErr}`);
      }
    }

    // Strict empty-source rule: a public profile is ONLY confirmed empty when the provider
    // explicitly reports postsCount === 0 and 0 posts were extracted.
    // If postsCount is null/undefined or > 0 while 0 posts were extracted, that is partial coverage (header only).
    const isConfirmedEmpty = posts.length === 0 && !isPrivate && postsCount === 0;
    const isPartialCoverage = posts.length === 0 && !isConfirmedEmpty && (Boolean(profile.username) || followers !== null || isPrivate);

    console.log(
      `[InstagramApify] Extracted ${posts.length} posts for @${handle} | followers=${followers ?? "unknown"} | postsCount=${postsCount ?? "unknown"} | private=${isPrivate} | confirmedEmpty=${isConfirmedEmpty} | partial=${isPartialCoverage}`
    );

    return {
      posts,
      followers,
      postsCount,
      profileName,
      runId,
      datasetId,
      usageUsd,
      isConfirmedEmpty,
      isPartialCoverage,
      isPrivate,
      error: null,
    };
  } catch (err: any) {
    console.warn(`[InstagramApify] Scraping error for @${handle}: ${err.message}. Returning fail-closed error result.`);
    return {
      posts: [],
      followers: null,
      postsCount: null,
      profileName: null,
      isConfirmedEmpty: false,
      error: err.message || "Instagram Apify actor failed",
    };
  }
}
