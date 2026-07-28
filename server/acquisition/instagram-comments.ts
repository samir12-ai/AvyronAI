/**
 * P-6.12 — Instagram comment acquisition via the Apify comment actor.
 *
 * Actor: apify~instagram-comment-scraper (SbK00X0JYCPblD2wp), live-verified
 * P-6.11 (2026-07-27):
 *   input  { directUrls: [post URLs], resultsLimit, includeNestedComments }
 *   output items: { id, text, ownerUsername, timestamp (ISO), likesCount,
 *                   repliesCount, postUrl, commentUrl, ... }
 *   deleted/unreachable posts yield per-URL error items
 *     { error: "no_items", requestErrorMessages: [...] } without failing the run
 *   pagination proven (120/120 unique); ~$0.0026/comment; runtime 13–315s.
 *
 * This replaces the Bright Data comment ladder (scrapePostComments /
 * scrapePostCommentsV1 / scrapeCommentsFromHTML) which died at the provider
 * level ~2026-07-19.
 */

import { runActorAndGetItems, isApifyAcquisitionConfigured } from "./apify-client";

const COMMENT_ACTOR_ID = "apify~instagram-comment-scraper";
const DEFAULT_RUN_BUDGET_MS = 360_000; // observed runtime variance 13–315s
const EST_COST_PER_COMMENT_USD = 0.0026;

export interface CommentActorPostRef {
  postId: string;
  shortcode: string | null;
  permalink: string;
}

export interface ActorComment {
  commentId: string;
  /** postId of the CommentActorPostRef the comment was matched to. */
  postId: string;
  shortcode: string | null;
  text: string;
  username: string | null;
  timestamp: string | null; // ISO
  likesCount: number | null;
  repliesCount: number | null;
}

export interface CommentActorRunMeta {
  runId: string | null;
  actorId: string;
  requestedPosts: number;
  itemsReceived: number;
  commentsMapped: number;
  unmatchedItems: number;
  perUrlErrors: { url: string; error: string }[];
  durationMs: number;
  /** Apify-reported usage if present, else comment-count estimate. */
  estimatedCostUsd: number;
}

export interface CommentActorResult {
  ok: boolean;
  comments: ActorComment[];
  meta: CommentActorRunMeta;
  error?: string;
}

function toNullableCount(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return isNaN(n) || n < 0 ? null : n;
}

function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Scrape comments for a set of posts in ONE actor run (directUrls batching —
 * one run per competitor, not per post; keeps cost + runtime bounded).
 */
export async function scrapeInstagramCommentsViaActor(opts: {
  posts: CommentActorPostRef[];
  maxCommentsPerPost: number;
  budgetMs?: number;
}): Promise<CommentActorResult> {
  const { posts, maxCommentsPerPost } = opts;
  const emptyMeta: CommentActorRunMeta = {
    runId: null,
    actorId: COMMENT_ACTOR_ID,
    requestedPosts: posts.length,
    itemsReceived: 0,
    commentsMapped: 0,
    unmatchedItems: 0,
    perUrlErrors: [],
    durationMs: 0,
    estimatedCostUsd: 0,
  };

  if (!isApifyAcquisitionConfigured()) {
    return { ok: false, comments: [], meta: emptyMeta, error: "APIFY_API_KEY not configured" };
  }
  if (posts.length === 0) {
    return { ok: true, comments: [], meta: emptyMeta };
  }

  // shortcode → postId map for matching actor items back to our posts.
  const byShortcode = new Map<string, CommentActorPostRef>();
  const directUrls: string[] = [];
  for (const p of posts) {
    const sc = p.shortcode || shortcodeFromUrl(p.permalink);
    if (!sc) {
      console.warn(`[IgCommentActor] Post ${p.postId} has no shortcode/permalink anchor — skipped`);
      continue;
    }
    byShortcode.set(sc, p);
    directUrls.push(`https://www.instagram.com/p/${sc}/`);
  }
  if (directUrls.length === 0) {
    return { ok: false, comments: [], meta: emptyMeta, error: "No posts with usable shortcodes" };
  }

  let run;
  try {
    run = await runActorAndGetItems({
      actorId: COMMENT_ACTOR_ID,
      input: {
        directUrls,
        resultsLimit: maxCommentsPerPost,
        includeNestedComments: false,
      },
      budgetMs: opts.budgetMs ?? DEFAULT_RUN_BUDGET_MS,
      label: "ig-comments",
    });
  } catch (err: any) {
    return { ok: false, comments: [], meta: emptyMeta, error: err.message };
  }

  const comments: ActorComment[] = [];
  const perUrlErrors: { url: string; error: string }[] = [];
  let unmatched = 0;

  for (const item of run.items) {
    // Per-URL error items (deleted/private posts) — tolerated, recorded.
    if (item && typeof item === "object" && typeof item.error === "string") {
      const url = item.url || item.postUrl || item.inputUrl || "unknown";
      perUrlErrors.push({ url: String(url), error: item.error });
      continue;
    }

    const text = typeof item?.text === "string" ? item.text : "";
    const id = item?.id ? String(item.id) : null;
    if (!id) {
      unmatched++;
      continue;
    }

    const postUrl: string = item.postUrl || "";
    const sc = shortcodeFromUrl(postUrl);
    const ref = sc ? byShortcode.get(sc) : undefined;
    if (!ref) {
      unmatched++;
      continue;
    }

    comments.push({
      commentId: id,
      postId: ref.postId,
      shortcode: sc,
      text,
      username: typeof item.ownerUsername === "string" && item.ownerUsername ? item.ownerUsername : null,
      timestamp: typeof item.timestamp === "string" && item.timestamp ? item.timestamp : null,
      likesCount: toNullableCount(item.likesCount),
      repliesCount: toNullableCount(item.repliesCount),
    });
  }

  const meta: CommentActorRunMeta = {
    runId: run.runId,
    actorId: COMMENT_ACTOR_ID,
    requestedPosts: directUrls.length,
    itemsReceived: run.items.length,
    commentsMapped: comments.length,
    unmatchedItems: unmatched,
    perUrlErrors,
    durationMs: run.durationMs,
    estimatedCostUsd: run.usageUsd ?? Number((comments.length * EST_COST_PER_COMMENT_USD).toFixed(4)),
  };

  console.log(
    `[IgCommentActor] run=${meta.runId} posts=${meta.requestedPosts} items=${meta.itemsReceived} mapped=${meta.commentsMapped} unmatched=${meta.unmatchedItems} urlErrors=${meta.perUrlErrors.length} cost≈$${meta.estimatedCostUsd} in ${Math.round(meta.durationMs / 1000)}s`,
  );

  return { ok: true, comments, meta };
}
