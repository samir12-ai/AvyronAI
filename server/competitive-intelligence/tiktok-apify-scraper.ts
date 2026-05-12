import type { TiktokPost, TiktokComment } from "./tiktok-scraper";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const APIFY_TIKTOK_ACTOR = "clockworks~free-tiktok-scraper";
const APIFY_RUN_TIMEOUT_MS = 120_000;
const APIFY_POLL_INTERVAL_MS = 5_000;
const MAX_COMMENTS_PER_POST = 20;

function getApifyApiKey(): string | null {
  return process.env.APIFY_API_KEY || null;
}

export function isApifyConfigured(): boolean {
  return !!getApifyApiKey();
}

interface ApifyRunResponse {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface ApifyDatasetResponse {
  id?: string;
  text?: string;
  desc?: string;
  description?: string;
  createTimeISO?: string;
  createTime?: number;
  videoMeta?: {
    duration?: number;
  };
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  playCount?: number;
  collectCount?: number;
  hashtags?: Array<{ name?: string; title?: string }>;
  webVideoUrl?: string;
  input?: { url?: string };
  authorMeta?: {
    name?: string;
    nickName?: string;
    id?: string;
  };
  comments?: Array<{
    cid?: string;
    text?: string;
    uniqueId?: string;
    nickName?: string;
    diggCount?: number;
    replyCommentTotal?: number;
    createTime?: number;
  }>;
  [key: string]: any;
}

async function apifyFetch(path: string, options: RequestInit = {}): Promise<any> {
  const apiKey = getApifyApiKey();
  if (!apiKey) throw new Error("APIFY_API_KEY not configured");

  // Seal #5 / F6.12 — circuit-breaker gate. If apify upstream has been failing,
  // the breaker is OPEN and we short-circuit instead of stampeding the API.
  const { isBreakerOpen, recordBreakerSuccess, recordBreakerFailure } = await import("./scrape-safety");
  const cb = isBreakerOpen("apify", "default");
  if (cb.open) {
    throw new Error(`BREAKER_OPEN: apify:default (${cb.reason})`);
  }

  // Seal #5 / F7.1 — never put the Apify token in the URL (logged by proxies,
  // CDNs, browser histories, and Apify's own access logs). Pass it via the
  // Authorization header instead. Strip any pre-existing ?token=... defensively.
  const cleanedPath = path.replace(/([?&])token=[^&]*(&|$)/g, (_m, lead, tail) => (lead === "?" && tail === "" ? "" : lead === "&" && tail === "" ? "" : lead === "?" ? "?" : "&"));
  const url = `${APIFY_BASE_URL}${cleanedPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
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

function mapApifyItemToPost(item: ApifyDatasetResponse, handle: string): TiktokPost | null {
  const caption = (item.text || item.desc || item.description || "").trim();
  if (!caption) return null;

  const postId = item.id || String(item.createTime || Date.now());

  const likes = toNum(item.diggCount);
  const commentsCount = toNum(item.commentCount);
  const shares = toNum(item.shareCount);
  const views = toNum(item.playCount);

  const hashtags: string[] = [];
  if (item.hashtags && Array.isArray(item.hashtags)) {
    for (const h of item.hashtags) {
      const tag = h.name || h.title || "";
      if (tag) hashtags.push(tag);
    }
  }

  if (hashtags.length === 0) {
    const tagMatches = caption.match(/#(\w+)/g);
    if (tagMatches) {
      for (const t of tagMatches) hashtags.push(t.replace("#", ""));
    }
  }

  const permalink =
    item.webVideoUrl ||
    (postId ? `https://www.tiktok.com/@${handle}/video/${postId}` : undefined);

  let timestamp: Date | undefined;
  if (item.createTimeISO) {
    timestamp = new Date(item.createTimeISO);
  } else if (item.createTime) {
    const ct = item.createTime;
    timestamp = new Date(typeof ct === "number" && ct < 1e12 ? ct * 1000 : ct);
  }

  const transcript = extractTranscriptFromApify(item);
  const { hookText, hookSource } = deriveHook(caption, transcript);
  const topComments = extractCommentsFromApify(item);

  return {
    postId,
    caption,
    hookText,
    hookSource,
    transcript,
    likes,
    comments: commentsCount,
    shares,
    views,
    hashtags: hashtags.length > 0 ? hashtags : undefined,
    permalink,
    timestamp,
    topComments,
  };
}

function extractTranscriptFromApify(item: ApifyDatasetResponse): string | null {
  if (item.videoMeta && (item as any).subtitles) {
    const subs = (item as any).subtitles;
    if (typeof subs === "string" && subs.length > 10) return subs;
  }

  if ((item as any).transcript) {
    const t = (item as any).transcript;
    if (typeof t === "string" && t.length > 10) return t;
  }

  if ((item as any).speechText) {
    const t = (item as any).speechText;
    if (typeof t === "string" && t.length > 10) return t;
  }

  return null;
}

function extractCommentsFromApify(item: ApifyDatasetResponse): TiktokComment[] {
  const comments: TiktokComment[] = [];
  const rawComments = item.comments || (item as any).latestComments || [];

  if (!Array.isArray(rawComments)) return comments;

  for (const c of rawComments.slice(0, MAX_COMMENTS_PER_POST)) {
    if (!c || typeof c !== "object") continue;

    const text = (c.text || c.comment || "").trim();
    if (text.length < 2) continue;

    const username = c.uniqueId || c.nickName || "anonymous";
    const commentId = c.cid || c.id || `apc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    comments.push({
      commentId: String(commentId),
      username: String(username),
      text,
      likes: toNum(c.diggCount),
      replyCount: toNum(c.replyCommentTotal),
      timestamp: c.createTime ? new Date(c.createTime * 1000) : undefined,
    });
  }

  return comments;
}

function deriveHook(
  caption: string,
  transcript: string | null,
): { hookText: string; hookSource: "transcript" | "caption_proxy" } {
  if (transcript && transcript.length > 10) {
    const words = transcript.split(/\s+/);
    const hookWords = words.slice(0, 25);
    const hookText = hookWords.join(" ").trim();
    if (hookText.length > 5) {
      return { hookText: hookText.slice(0, 200), hookSource: "transcript" };
    }
  }

  const firstLine = caption.split(/\n/)[0].trim();
  if (firstLine.length > 5 && firstLine.length < 200) {
    return { hookText: firstLine, hookSource: "caption_proxy" };
  }

  return { hookText: caption.slice(0, 150), hookSource: "caption_proxy" };
}

function toNum(v: any): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

export async function scrapeTiktokViaApify(handle: string): Promise<TiktokPost[]> {
  const apiKey = getApifyApiKey();
  if (!apiKey) {
    console.warn("[TiktokApify] APIFY_API_KEY not set — cannot scrape TikTok via Apify");
    return [];
  }

  console.log(`[TiktokApify] Starting scrape for @${handle} via Apify actor ${APIFY_TIKTOK_ACTOR}`);

  const runResponse: ApifyRunResponse = await apifyFetch(
    `/acts/${APIFY_TIKTOK_ACTOR}/runs`,
    {
      method: "POST",
      body: JSON.stringify({
        excludePinnedPosts: false,
        profiles: [`https://www.tiktok.com/@${handle}`],
        resultsPerPage: 30,
        shouldDownloadCovers: false,
        shouldDownloadVideos: false,
        shouldDownloadSubtitles: false,
      }),
    },
  );

  const runId = runResponse.data.id;
  console.log(`[TiktokApify] Run started: ${runId} — waiting for completion...`);

  const completedRun = await waitForRun(runId);
  const datasetId = completedRun.defaultDatasetId;

  console.log(`[TiktokApify] Run ${runId} completed — fetching dataset ${datasetId}`);

  const items: ApifyDatasetResponse[] = await apifyFetch(
    `/datasets/${datasetId}/items?format=json&clean=true`,
  );

  if (!Array.isArray(items) || items.length === 0) {
    console.warn(`[TiktokApify] No items returned for @${handle}`);
    return [];
  }

  const posts: TiktokPost[] = [];
  for (const item of items) {
    const post = mapApifyItemToPost(item, handle);
    if (post) posts.push(post);
  }

  const totalComments = posts.reduce((s, p) => s + (p.topComments?.length || 0), 0);
  const withTranscript = posts.filter((p) => p.transcript).length;
  console.log(
    `[TiktokApify] Extracted ${posts.length} posts for @${handle} | comments=${totalComments} | withTranscript=${withTranscript}`,
  );

  return posts;
}
