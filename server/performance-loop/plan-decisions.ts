/**
 * Recommended-decision extraction — shared by the cycle runner and the
 * execution comparator (lives in its own module to avoid a circular import).
 *
 * The plan's standing recommendations = distinct dimension values carried by
 * planned artifacts (published_posts + studio_items rows bound to the plan).
 * Free-text plan_json pillars are NOT fuzzy-matched — only vocabulary that can
 * be honestly compared against owned-post lineage dimensions counts.
 */
import { db } from "../db";
import {
  publishedPosts,
  studioItems,
  CONTENT_SCORE_DIMENSIONS,
  type ContentScoreDimension,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

export interface RecommendedDecision {
  dimension: ContentScoreDimension;
  value: string;
  source: "planned_artifact";
}

export async function loadRecommendedDecisions(
  accountId: string,
  campaignId: string,
  planId: string,
): Promise<RecommendedDecision[]> {
  const [pubRows, studioRows] = await Promise.all([
    db
      .select({ hookStyle: publishedPosts.hookStyle, contentAngle: publishedPosts.contentAngle })
      .from(publishedPosts)
      .where(and(
        eq(publishedPosts.accountId, accountId),
        eq(publishedPosts.campaignId, campaignId),
        eq(publishedPosts.planId, planId),
      )),
    db
      .select({ contentAngle: studioItems.contentAngle, contentType: studioItems.contentType })
      .from(studioItems)
      .where(and(
        eq(studioItems.accountId, accountId),
        eq(studioItems.campaignId, campaignId),
        eq(studioItems.planId, planId),
      )),
  ]);

  const byDimension = new Map<ContentScoreDimension, Set<string>>();
  const add = (dim: ContentScoreDimension, value: string | null) => {
    const v = (value ?? "").trim();
    if (!v) return;
    if (!byDimension.has(dim)) byDimension.set(dim, new Set());
    byDimension.get(dim)!.add(v);
  };
  for (const r of pubRows) {
    add("hook_style", r.hookStyle);
    add("content_angle", r.contentAngle);
  }
  for (const r of studioRows) {
    add("content_angle", r.contentAngle);
    add("content_type", r.contentType);
  }

  const decisions: RecommendedDecision[] = [];
  for (const dim of CONTENT_SCORE_DIMENSIONS) {
    for (const value of byDimension.get(dim) ?? []) {
      decisions.push({ dimension: dim, value, source: "planned_artifact" });
    }
  }
  return decisions;
}
