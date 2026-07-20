/**
 * P-2 Phase 2C — Owned-post lineage resolver.
 *
 * Matches scraped owned posts to Avyron plan artifacts, in strict priority
 * order (prompt Phase 2C):
 *   1. Exact platform post ID          (published_posts.meta_post_id)
 *   2. Exact stored post URL           (structurally unavailable today —
 *                                       published_posts persists no permalink;
 *                                       kept as an explicit no-op, not faked)
 *   3. Direct publish lineage          (exact caption + publish-time window
 *                                       against published_posts)
 *   4. High-confidence caption fingerprint + publish-time window
 *                                       (against studio_items)
 *   5. Media fingerprint               (unavailable — no stored media hashes)
 *   6. Unmatched.
 *
 * Honesty rules:
 * - Every match records method + confidence.
 * - Ambiguous stays ambiguous (competing high-confidence candidates).
 * - manual/unplanned posts are measured but NEVER treated as plan proof.
 * - Plan dimensions (hook/angle/type) are copied ONLY from a matched artifact,
 *   never inferred from the caption itself.
 *
 * DB-writes-only module: no engine, orchestrator, or worker calls.
 */

import { db } from "../db";
import {
  ownedPosts,
  publishedPosts,
  studioItems,
  type OwnedPost,
  type OwnedPostLineageState,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

// ── Matching thresholds ───────────────────────────────────────────────────────

/** Similarity floor for a high-confidence fingerprint match. */
const FINGERPRINT_MATCH_THRESHOLD = 0.85;
/** Stricter floor when the post's publish timestamp is unknown (no time corroboration). */
const FINGERPRINT_MATCH_THRESHOLD_NO_TIME = 0.92;
/** Required margin over the runner-up; closer than this → ambiguous. */
const FINGERPRINT_AMBIGUITY_MARGIN = 0.1;
/** Candidates below this are not considered at all. */
const FINGERPRINT_CANDIDATE_FLOOR = 0.6;
/** Minimum caption tokens for fingerprinting to be meaningful. */
const FINGERPRINT_MIN_TOKENS = 4;
/** Direct publish lineage: |published_at - posted_at| tolerance. */
const DIRECT_PUBLISH_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Fingerprint time window: post must not predate the studio item by more than this. */
const FINGERPRINT_PREDATE_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;
/** Fingerprint time window: post must be within this many ms after item creation. */
const FINGERPRINT_MAX_LAG_MS = 90 * 24 * 60 * 60 * 1000;

// ── Caption fingerprinting ────────────────────────────────────────────────────

export function normalizeCaption(caption: string): string {
  return caption
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}#@\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function captionTokens(caption: string | null): Set<string> {
  if (!caption) return new Set();
  const normalized = normalizeCaption(caption);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((t) => t.length > 1));
}

/** max(Jaccard, containment) — containment handles trimmed/extended reposts. */
export function captionSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const t of smaller) if (larger.has(t)) intersection++;
  const jaccard = intersection / (a.size + b.size - intersection);
  const containment = intersection / smaller.size;
  return Math.max(jaccard, containment);
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export interface LineageResolutionSummary {
  processed: number;
  byState: Record<OwnedPostLineageState, number>;
}

interface ResolvedLineage {
  state: OwnedPostLineageState;
  method: string | null;
  confidence: number | null;
  matchedPublishedPostId: string | null;
  matchedPlanId: string | null;
  matchedCalendarEntryId: string | null;
  matchedStudioItemId: string | null;
  hookStyle: string | null;
  contentAngle: string | null;
  contentType: string | null;
}

const UNMATCHED: ResolvedLineage = {
  state: "unmatched",
  method: null,
  confidence: null,
  matchedPublishedPostId: null,
  matchedPlanId: null,
  matchedCalendarEntryId: null,
  matchedStudioItemId: null,
  hookStyle: null,
  contentAngle: null,
  contentType: null,
};

/**
 * Resolve lineage for owned posts of one account+campaign.
 * Only posts in non-terminal states (unmatched / ambiguous) are re-resolved —
 * a resolved match is never silently demoted by a later run.
 */
export async function resolveOwnedPostLineage(
  accountId: string,
  campaignId: string,
  onlyOwnedPostIds?: string[],
): Promise<LineageResolutionSummary> {
  const conditions = [
    eq(ownedPosts.accountId, accountId),
    eq(ownedPosts.campaignId, campaignId),
    inArray(ownedPosts.lineageState, ["unmatched", "ambiguous"]),
  ];
  if (onlyOwnedPostIds && onlyOwnedPostIds.length > 0) {
    conditions.push(inArray(ownedPosts.id, onlyOwnedPostIds));
  }

  const posts = await db
    .select()
    .from(ownedPosts)
    .where(and(...conditions));

  const summary: LineageResolutionSummary = {
    processed: 0,
    byState: {
      planned_direct: 0,
      planned_matched: 0,
      manual_matched: 0,
      unplanned: 0,
      ambiguous: 0,
      unmatched: 0,
    },
  };
  if (posts.length === 0) return summary;

  // Candidate pools (campaign-scoped, loaded once per run).
  const pubRows = await db
    .select({
      id: publishedPosts.id,
      metaPostId: publishedPosts.metaPostId,
      caption: publishedPosts.caption,
      publishedAt: publishedPosts.publishedAt,
      platform: publishedPosts.platform,
      planId: publishedPosts.planId,
      calendarEntryId: publishedPosts.calendarEntryId,
      studioItemId: publishedPosts.studioItemId,
      hookStyle: publishedPosts.hookStyle,
      contentAngle: publishedPosts.contentAngle,
      lineageSource: publishedPosts.lineageSource,
    })
    .from(publishedPosts)
    .where(and(eq(publishedPosts.accountId, accountId), eq(publishedPosts.campaignId, campaignId)));

  const studioRows = await db
    .select({
      id: studioItems.id,
      planId: studioItems.planId,
      calendarEntryId: studioItems.calendarEntryId,
      caption: studioItems.caption,
      suggestedCaption: studioItems.suggestedCaption,
      hook: studioItems.hook,
      contentAngle: studioItems.contentAngle,
      contentType: studioItems.contentType,
      createdAt: studioItems.createdAt,
    })
    .from(studioItems)
    .where(and(eq(studioItems.accountId, accountId), eq(studioItems.campaignId, campaignId)));

  const studioCandidates = studioRows
    .map((item) => {
      const best = [item.caption, item.suggestedCaption]
        .map((c) => captionTokens(c))
        .reduce((a, b) => (b.size > a.size ? b : a), new Set<string>());
      return { item, tokens: best };
    })
    .filter((c) => c.tokens.size >= FINGERPRINT_MIN_TOKENS);

  for (const post of posts) {
    const resolved = resolveOne(post, pubRows, studioCandidates);
    summary.processed++;
    summary.byState[resolved.state]++;

    await db
      .update(ownedPosts)
      .set({
        lineageState: resolved.state,
        matchMethod: resolved.method,
        matchConfidence: resolved.confidence,
        matchedPublishedPostId: resolved.matchedPublishedPostId,
        matchedPlanId: resolved.matchedPlanId,
        matchedCalendarEntryId: resolved.matchedCalendarEntryId,
        matchedStudioItemId: resolved.matchedStudioItemId,
        hookStyle: resolved.hookStyle,
        contentAngle: resolved.contentAngle,
        contentType: resolved.contentType,
        lineageResolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ownedPosts.id, post.id));

    logResolution(post, resolved);
  }

  return summary;
}

type PubRow = {
  id: string;
  metaPostId: string | null;
  caption: string | null;
  publishedAt: Date | null;
  platform: string | null;
  planId: string | null;
  calendarEntryId: string | null;
  studioItemId: string | null;
  hookStyle: string | null;
  contentAngle: string | null;
  lineageSource: string;
};

type StudioCandidate = {
  item: {
    id: string;
    planId: string | null;
    calendarEntryId: string | null;
    caption: string | null;
    suggestedCaption: string | null;
    hook: string | null;
    contentAngle: string | null;
    contentType: string | null;
    createdAt: Date | null;
  };
  tokens: Set<string>;
};

function fromPublished(pub: PubRow, method: string, confidence: number): ResolvedLineage {
  const planned = pub.planId != null || pub.lineageSource === "planned";
  return {
    state: planned ? "planned_direct" : "unplanned",
    method,
    confidence,
    matchedPublishedPostId: pub.id,
    matchedPlanId: pub.planId,
    matchedCalendarEntryId: pub.calendarEntryId,
    matchedStudioItemId: pub.studioItemId,
    hookStyle: pub.hookStyle,
    contentAngle: pub.contentAngle,
    contentType: null,
  };
}

function resolveOne(
  post: OwnedPost,
  pubRows: PubRow[],
  studioCandidates: StudioCandidate[],
): ResolvedLineage {
  // 1. Exact platform post ID.
  const byId = pubRows.find((p) => p.metaPostId != null && p.metaPostId === post.postId);
  if (byId) return fromPublished(byId, "platform_post_id", 1.0);

  // 2. Exact stored post URL — published_posts persists no post permalink
  //    today. Explicit no-op (never approximated with media_uri).

  // 3. Direct publish lineage: exact normalized caption + time window.
  const postTokens = captionTokens(post.caption);
  if (post.caption && post.caption.trim().length > 0) {
    const normalizedPost = normalizeCaption(post.caption);
    const direct = pubRows.filter((p) => {
      if (!p.caption || normalizeCaption(p.caption) !== normalizedPost) return false;
      if (p.platform && p.platform !== post.platform) return false;
      if (p.publishedAt && post.postedAt) {
        return Math.abs(p.publishedAt.getTime() - post.postedAt.getTime()) <= DIRECT_PUBLISH_WINDOW_MS;
      }
      return true; // exact caption with no timestamps to contradict
    });
    if (direct.length === 1) return fromPublished(direct[0], "direct_publish_caption_time", 0.9);
    if (direct.length > 1) {
      return { ...UNMATCHED, state: "ambiguous", method: "direct_publish_caption_time", confidence: null };
    }
  }

  // 4. Caption fingerprint + publish-time window vs studio_items.
  if (postTokens.size >= FINGERPRINT_MIN_TOKENS && studioCandidates.length > 0) {
    const scored = studioCandidates
      .map((c) => ({ c, sim: captionSimilarity(postTokens, c.tokens) }))
      .filter((s) => s.sim >= FINGERPRINT_CANDIDATE_FLOOR)
      .filter((s) => {
        // Publish-time window: a post cannot predate its source item by more
        // than tolerance, nor lag it beyond the max window.
        if (!post.postedAt || !s.c.item.createdAt) return true; // no time data — threshold handles it
        const lag = post.postedAt.getTime() - s.c.item.createdAt.getTime();
        return lag >= -FINGERPRINT_PREDATE_TOLERANCE_MS && lag <= FINGERPRINT_MAX_LAG_MS;
      })
      .sort((a, b) => b.sim - a.sim);

    if (scored.length > 0) {
      const threshold = post.postedAt ? FINGERPRINT_MATCH_THRESHOLD : FINGERPRINT_MATCH_THRESHOLD_NO_TIME;
      const top = scored[0];
      const second = scored[1];
      if (top.sim >= threshold) {
        if (second && second.sim >= threshold && top.sim - second.sim < FINGERPRINT_AMBIGUITY_MARGIN) {
          console.warn(
            `[LineageResolver] OWNED_POST_LINEAGE_AMBIGUOUS ownedPostId=${post.id} postId=${post.postId} candidates=${top.c.item.id},${second.c.item.id} sims=${top.sim.toFixed(3)},${second.sim.toFixed(3)}`,
          );
          return { ...UNMATCHED, state: "ambiguous", method: "caption_fingerprint", confidence: null };
        }
        const item = top.c.item;
        return {
          state: item.planId != null ? "planned_matched" : "manual_matched",
          method: "caption_fingerprint",
          confidence: Number(top.sim.toFixed(3)),
          matchedPublishedPostId: null,
          matchedPlanId: item.planId,
          matchedCalendarEntryId: item.calendarEntryId,
          matchedStudioItemId: item.id,
          hookStyle: item.hook,
          contentAngle: item.contentAngle,
          contentType: item.contentType,
        };
      }
    }
  }

  // 5. Media fingerprint — no stored media hashes exist; unavailable, not faked.

  // 6. Unmatched.
  return UNMATCHED;
}

function logResolution(post: OwnedPost, r: ResolvedLineage): void {
  const base = `ownedPostId=${post.id} postId=${post.postId} platform=${post.platform}`;
  switch (r.state) {
    case "unmatched":
      console.warn(`[LineageResolver] OWNED_POST_LINEAGE_MISSING ${base} — no plan artifact matched; post contributes to account baseline only`);
      break;
    case "ambiguous":
      // Candidate detail already logged at detection point.
      console.warn(`[LineageResolver] OWNED_POST_LINEAGE_AMBIGUOUS ${base} method=${r.method ?? "unknown"} — kept ambiguous, excluded from plan scoring`);
      break;
    case "manual_matched":
    case "unplanned":
      console.log(`[LineageResolver] OWNED_POST_MATCHED_MANUAL ${base} state=${r.state} method=${r.method} confidence=${r.confidence} — measured, NOT plan proof`);
      break;
    case "planned_direct":
    case "planned_matched": {
      const missingDims: string[] = [];
      if (!r.hookStyle) missingDims.push("hook");
      if (!r.contentAngle) missingDims.push("content_angle");
      if (!r.contentType) missingDims.push("content_type");
      if (missingDims.length > 0) {
        console.warn(
          `[LineageResolver] OWNED_POST_LINEAGE_PARTIAL ${base} state=${r.state} method=${r.method} confidence=${r.confidence} missingDims=${missingDims.join(",")} — baseline OK, missing dims excluded from dimension scoring`,
        );
      } else {
        console.log(`[LineageResolver] lineage resolved ${base} state=${r.state} method=${r.method} confidence=${r.confidence}`);
      }
      break;
    }
  }
}
