/**
 * Competitor Post Classifier — batch runner.
 *
 * Finds unclassified posts (or posts from a specific competitor) and
 * classifies + persists them. Designed to be called by:
 *   - an autonomous worker / cron job
 *   - a route that triggers classification after a scrape completes
 *   - any future consumer that needs classifications to be up to date
 *
 * Rate-limiting: CONCURRENCY_LIMIT controls parallel aiChat calls.
 * Each call costs ~300–400 tokens; the limit prevents budget spikes.
 */

import { db } from "../db";
import { ciCompetitorPosts, competitorPostClassifications } from "@shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { classifyCompetitorPost } from "./classifier";
import { CLASSIFIER_VERSION, type CompetitorPostInput } from "./types";

const LOG = "[CompetitorPostClassifier/batch]";
const CONCURRENCY_LIMIT = 5;
const DEFAULT_BATCH_SIZE = 50;

export interface BatchOptions {
  /** Scope to a single competitor. Omit to process all unclassified posts. */
  competitorId?: string;
  /** Max posts to classify in this run. Default: 50. */
  limit?: number;
  /** Account ID to pass to aiChat for budget tracking. Required. */
  accountId: string;
}

export interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Persist a classification result via upsert.
 * Uses ON CONFLICT on (post_id, classifier_version) so re-running the
 * same version on the same post is idempotent.
 */
async function persistClassification(
  classification: Awaited<ReturnType<typeof classifyCompetitorPost>>,
): Promise<void> {
  await db
    .insert(competitorPostClassifications)
    .values({
      postId: classification.postId,
      competitorId: classification.competitorId,
      primaryHook: classification.primaryHook,
      hookArchetype: classification.hookArchetype,
      primaryAngle: classification.primaryAngle,
      narrative: classification.narrative,
      ctaType: classification.ctaType,
      offerType: classification.offerType,
      emotionalTrigger: classification.emotionalTrigger,
      awarenessStage: classification.awarenessStage,
      positioningStyle: classification.positioningStyle,
      contentFormatIntent: classification.contentFormatIntent,
      primaryGoal: classification.primaryGoal,
      confidenceScore: String(classification.confidenceScore),
      classifierVersion: classification.classifierVersion,
      classifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        competitorPostClassifications.postId,
        competitorPostClassifications.classifierVersion,
      ],
      set: {
        primaryHook: classification.primaryHook,
        hookArchetype: classification.hookArchetype,
        primaryAngle: classification.primaryAngle,
        narrative: classification.narrative,
        ctaType: classification.ctaType,
        offerType: classification.offerType,
        emotionalTrigger: classification.emotionalTrigger,
        awarenessStage: classification.awarenessStage,
        positioningStyle: classification.positioningStyle,
        contentFormatIntent: classification.contentFormatIntent,
        primaryGoal: classification.primaryGoal,
        confidenceScore: String(classification.confidenceScore),
        classifiedAt: new Date(),
      },
    });
}

/**
 * Classify and persist a single post. Returns "succeeded" | "failed".
 */
export async function classifyAndPersistPost(
  post: CompetitorPostInput,
  accountId: string,
): Promise<"succeeded" | "failed"> {
  try {
    const classification = await classifyCompetitorPost(post, accountId);
    await persistClassification(classification);
    return "succeeded";
  } catch (err: any) {
    console.error(`${LOG} CLASSIFY_FAILED post=${post.id}`, err.message);
    return "failed";
  }
}

/**
 * Run batch classification over unclassified posts.
 *
 * A post is "unclassified" if it has no row in competitor_post_classifications
 * for the current CLASSIFIER_VERSION. This means re-running after a version
 * bump automatically re-classifies all posts with the new prompt.
 */
export async function runBatchClassification(options: BatchOptions): Promise<BatchResult> {
  const { accountId, competitorId, limit = DEFAULT_BATCH_SIZE } = options;

  // Find post IDs that already have a classification for this version.
  const existingRows = await db
    .select({ postId: competitorPostClassifications.postId })
    .from(competitorPostClassifications)
    .where(eq(competitorPostClassifications.classifierVersion, CLASSIFIER_VERSION));

  const alreadyClassifiedIds = new Set(existingRows.map((r) => r.postId));

  // Fetch candidate posts.
  const conditions = competitorId
    ? [eq(ciCompetitorPosts.competitorId, competitorId)]
    : [];

  const allPosts = await db
    .select({
      id: ciCompetitorPosts.id,
      competitorId: ciCompetitorPosts.competitorId,
      caption: ciCompetitorPosts.caption,
      hookText: ciCompetitorPosts.hookText,
      hashtags: ciCompetitorPosts.hashtags,
      mediaType: ciCompetitorPosts.mediaType,
      likes: ciCompetitorPosts.likes,
      comments: ciCompetitorPosts.comments,
      views: ciCompetitorPosts.views,
      permalink: ciCompetitorPosts.permalink,
    })
    .from(ciCompetitorPosts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`created_at DESC`);

  const unclassified = allPosts
    .filter((p) => !alreadyClassifiedIds.has(p.id))
    .slice(0, limit);

  if (unclassified.length === 0) {
    console.log(`${LOG} No unclassified posts found (version=${CLASSIFIER_VERSION})`);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: allPosts.length };
  }

  console.log(
    `${LOG} Starting batch: unclassified=${unclassified.length} total=${allPosts.length} version=${CLASSIFIER_VERSION}`,
  );

  let succeeded = 0;
  let failed = 0;

  // Process in chunks of CONCURRENCY_LIMIT.
  for (let i = 0; i < unclassified.length; i += CONCURRENCY_LIMIT) {
    const chunk = unclassified.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.all(
      chunk.map((post) => classifyAndPersistPost(post, accountId)),
    );
    for (const r of results) {
      if (r === "succeeded") succeeded++;
      else failed++;
    }
    console.log(
      `${LOG} Progress: ${Math.min(i + CONCURRENCY_LIMIT, unclassified.length)}/${unclassified.length} succeeded=${succeeded} failed=${failed}`,
    );
  }

  console.log(
    `${LOG} Batch complete: attempted=${unclassified.length} succeeded=${succeeded} failed=${failed} skipped=${allPosts.length - unclassified.length}`,
  );

  return {
    attempted: unclassified.length,
    succeeded,
    failed,
    skipped: allPosts.length - unclassified.length,
  };
}
