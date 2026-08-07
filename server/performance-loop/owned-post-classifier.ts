/**
 * Owned Post Classifier — the smallest safe adapter over the competitor
 * post classifier, for the user's OWN scraped posts.
 *
 * Doctrine:
 *   - Reuses the PURE `classifyCompetitorPost` service (same strict enums,
 *     same self-correction, same UNKNOWN-over-hallucination rules). No
 *     duplicate classifier is created.
 *   - Never calls `classifyAndPersistPost` / the competitor batch runner —
 *     those write competitor_post_classifications, which is keyed to
 *     ci_competitor_posts and consumed by Content DNA / MI pipelines.
 *   - Persists into owned_post_classifications, one row per
 *     (owned_post_id, classifier_version). Failed attempts are persisted
 *     with a failure reason — never silently dropped.
 *   - Fails closed on missing content: a post with no caption and no hook
 *     text is recorded as status='failed' reason='no_content'. Nothing is
 *     fabricated.
 *   - One post failing never blocks the rest of the batch.
 */
import { createHash } from "crypto";
import { db } from "../db";
import { ownedPosts, ownedPostClassifications, type OwnedPostClassification } from "@shared/schema";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { classifyCompetitorPost } from "../competitor-post-classifier";
import { CLASSIFIER_VERSION, type CompetitorPostInput } from "../competitor-post-classifier/types";

const LOG = "[OwnedPostClassifier]";

/**
 * Version stamp for owned rows. Prefixed so a bump of the underlying
 * competitor classifier version naturally re-opens owned posts for
 * re-classification (old rows stay queryable by version).
 */
export const OWNED_CLASSIFIER_VERSION = `owned-v1__${CLASSIFIER_VERSION}`;
/** Model + prompt provenance (the adapter reuses the competitor classifier's prompt). */
export const OWNED_CLASSIFIER_MODEL = "gpt-4.1-mini";
export const OWNED_CLASSIFIER_PROMPT_VERSION = CLASSIFIER_VERSION;

export interface OwnedClassificationSummary {
  eligible: number;
  classified: number;
  failed: number;
  skippedAlreadyClassified: number;
}

/**
 * Classify owned posts that do not yet have a row for the current version.
 *
 * @param ownedPostIds optional explicit subset (post-scrape wiring passes the
 *   freshly tracked ids); otherwise every unclassified owned post for the
 *   campaign is processed (bounded by `limit`).
 */
export async function classifyOwnedPosts(params: {
  accountId: string;
  campaignId: string;
  ownedPostIds?: string[];
  limit?: number;
}): Promise<OwnedClassificationSummary> {
  const { accountId, campaignId } = params;
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));

  const already = db
    .select({ id: ownedPostClassifications.ownedPostId })
    .from(ownedPostClassifications)
    .where(
      and(
        eq(ownedPostClassifications.accountId, accountId),
        eq(ownedPostClassifications.campaignId, campaignId),
        eq(ownedPostClassifications.classifierVersion, OWNED_CLASSIFIER_VERSION),
      ),
    );

  const conditions = [
    eq(ownedPosts.accountId, accountId),
    eq(ownedPosts.campaignId, campaignId),
    notInArray(ownedPosts.id, already),
  ];
  if (params.ownedPostIds && params.ownedPostIds.length > 0) {
    conditions.push(inArray(ownedPosts.id, params.ownedPostIds));
  }

  const candidates = await db
    .select()
    .from(ownedPosts)
    .where(and(...conditions))
    .limit(limit);

  const summary: OwnedClassificationSummary = {
    eligible: candidates.length,
    classified: 0,
    failed: 0,
    skippedAlreadyClassified: 0,
  };
  if (candidates.length === 0) return summary;

  for (const post of candidates) {
    const caption = post.caption?.trim() || null;
    const hookText = post.hookText?.trim() || null;
    const captionHash = caption ? createHash("sha256").update(caption).digest("hex") : null;

    const base = {
      accountId,
      campaignId,
      ownedPostId: post.id,
      platform: post.platform,
      classifierVersion: OWNED_CLASSIFIER_VERSION,
      modelVersion: OWNED_CLASSIFIER_MODEL,
      promptVersion: OWNED_CLASSIFIER_PROMPT_VERSION,
      sourceCaptionHash: captionHash,
    };

    // Fail closed: no text content means no classification — record why.
    if (!caption && !hookText) {
      const rows = await db
        .insert(ownedPostClassifications)
        .values({ ...base, status: "failed", failureReason: "no_content: post has no caption or hook text" })
        .onConflictDoNothing({
          target: [ownedPostClassifications.ownedPostId, ownedPostClassifications.classifierVersion],
        })
        .returning({ id: ownedPostClassifications.id });
      if (rows[0]) summary.failed += 1;
      else summary.skippedAlreadyClassified += 1;
      continue;
    }

    try {
      const input: CompetitorPostInput = {
        id: post.id,
        // Adapter marker — the pure classifier threads this through untouched;
        // it is never written to any competitor table.
        competitorId: `owned:${campaignId}`,
        caption,
        hookText,
        hashtags: post.hashtags ?? null,
        mediaType: post.mediaType ?? null,
        likes: null, // metric context intentionally omitted: owned metrics live in snapshots, and metrics are calibration-only for the classifier
        comments: null,
        views: null,
        permalink: post.permalink ?? null,
      };
      const result = await classifyCompetitorPost(input, accountId);
      const rows = await db
        .insert(ownedPostClassifications)
        .values({
          ...base,
          status: "classified",
          primaryHook: result.primaryHook,
          hookArchetype: result.hookArchetype,
          primaryAngle: result.primaryAngle,
          narrative: result.narrative,
          ctaType: result.ctaType,
          offerType: result.offerType,
          emotionalTrigger: result.emotionalTrigger,
          awarenessStage: result.awarenessStage,
          positioningStyle: result.positioningStyle,
          contentFormatIntent: result.contentFormatIntent,
          primaryGoal: result.primaryGoal,
          coreMarketingPromise: result.coreMarketingPromise,
          confidenceScore: result.confidenceScore,
        })
        .onConflictDoNothing({
          target: [ownedPostClassifications.ownedPostId, ownedPostClassifications.classifierVersion],
        })
        .returning({ id: ownedPostClassifications.id });
      if (rows[0]) summary.classified += 1;
      else summary.skippedAlreadyClassified += 1;
    } catch (err: any) {
      const reason = `classifier_error: ${String(err?.message ?? err).slice(0, 300)}`;
      console.error(`${LOG} post=${post.id} ${reason}`);
      try {
        const rows = await db
          .insert(ownedPostClassifications)
          .values({ ...base, status: "failed", failureReason: reason })
          .onConflictDoNothing({
            target: [ownedPostClassifications.ownedPostId, ownedPostClassifications.classifierVersion],
          })
          .returning({ id: ownedPostClassifications.id });
        if (rows[0]) summary.failed += 1;
        else summary.skippedAlreadyClassified += 1;
      } catch (persistErr: any) {
        // Persisting the failure itself failed — log loudly, keep the batch alive.
        console.error(`${LOG} could not persist failure row for post=${post.id}:`, persistErr?.message ?? persistErr);
        summary.failed += 1;
      }
    }
  }

  console.log(
    `${LOG} campaign=${campaignId} eligible=${summary.eligible} classified=${summary.classified} failed=${summary.failed} skipped=${summary.skippedAlreadyClassified}`,
  );
  return summary;
}

/** Latest classification rows (current version) for a set of owned posts. */
export async function loadOwnedClassifications(params: {
  accountId: string;
  campaignId: string;
  ownedPostIds?: string[];
}): Promise<OwnedPostClassification[]> {
  const conditions = [
    eq(ownedPostClassifications.accountId, params.accountId),
    eq(ownedPostClassifications.campaignId, params.campaignId),
    eq(ownedPostClassifications.classifierVersion, OWNED_CLASSIFIER_VERSION),
  ];
  if (params.ownedPostIds && params.ownedPostIds.length > 0) {
    conditions.push(inArray(ownedPostClassifications.ownedPostId, params.ownedPostIds));
  }
  return db.select().from(ownedPostClassifications).where(and(...conditions));
}
