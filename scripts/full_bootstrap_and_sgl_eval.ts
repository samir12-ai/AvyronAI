import "dotenv/config";
import { db } from "../server/db";
import { 
  ciCompetitors, 
  competitorSources, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews,
  competitorPostClassifications 
} from "@shared/schema";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { scrapeInstagramCommentsViaActor, type CommentActorPostRef } from "../server/acquisition/instagram-comments";
import { classifyCompetitorPost } from "../server/competitor-post-classifier/classifier";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { initializeSignalGovernance, resolveSignalsForEngine } from "../server/signal-governance/engine";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../server/signal-governance/types";
import { createHash } from "crypto";

const ACCOUNT_ID = "f020f6c7-15d8-4129-90a6-83a40558c642";
const CAMPAIGN_ID = "camp_mtewrp8kkom3";

async function main() {
  console.log("============================================================");
  console.log("AVYRON — REAL EVIDENCE ACQUISITION, CLASSIFICATION & SGL");
  console.log("============================================================\n");

  // 1. Fetch Real Instagram Comments for posts across all competitors
  const allPosts = await db
    .select({
      id: ciCompetitorPosts.id,
      competitorId: ciCompetitorPosts.competitorId,
      permalink: ciCompetitorPosts.permalink,
      caption: ciCompetitorPosts.caption,
      comments: ciCompetitorPosts.comments,
    })
    .from(ciCompetitorPosts)
    .where(
      and(
        eq(ciCompetitorPosts.accountId, ACCOUNT_ID),
        isNotNull(ciCompetitorPosts.permalink)
      )
    );

  console.log(`Found ${allPosts.length} competitor posts with permalinks.`);

  const candidatePosts: CommentActorPostRef[] = [];
  const postCompMap = new Map<string, string>();

  for (const p of allPosts) {
    if (!p.permalink) continue;
    const match = p.permalink.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (match && match[1]) {
      const shortcode = match[1];
      if (!candidatePosts.some(cp => cp.shortcode === shortcode)) {
        candidatePosts.push({
          postId: p.id,
          shortcode,
          permalink: `https://www.instagram.com/p/${shortcode}/`,
        });
        postCompMap.set(p.id, p.competitorId);
      }
    }
  }

  console.log(`Total ${candidatePosts.length} unique shortcode candidate posts.`);
  const batch = candidatePosts.slice(0, 25);
  console.log(`\n--- FETCHING COMMENTS FOR ${batch.length} CANDIDATE POSTS ---`);

  const commRes = await scrapeInstagramCommentsViaActor({
    posts: batch,
    maxCommentsPerPost: 20,
    budgetMs: 240_000,
  });

  console.log(`Comment scraper ok: ${commRes.ok}, items: ${commRes.meta.itemsReceived}, comments: ${commRes.comments.length}`);

  let commInserted = 0;
  for (const c of commRes.comments) {
    const compId = postCompMap.get(c.postId) || "unknown_competitor";
    const commentId = `comm_${createHash("sha256").update(`${c.postId}:${c.commentId || c.text}`).digest("hex").slice(0, 16)}`;

    await db
      .insert(ciCompetitorComments)
      .values({
        id: commentId,
        competitorId: compId,
        accountId: ACCOUNT_ID,
        postId: c.postId,
        commentId: c.commentId || commentId,
        username: c.username || "instagram_user",
        commentText: c.text,
        likesCount: c.likesCount ?? null,
        repliesCount: c.repliesCount ?? null,
        actorRunId: commRes.meta.runId || "apify_manual",
        filterStatus: "ACCEPTED",
        timestamp: c.timestamp ? new Date(c.timestamp) : new Date(),
      })
      .onConflictDoNothing();
    commInserted++;
  }
  console.log(`Persisted ${commInserted} real Instagram comments with commentText!\n`);

  // 2. Classify posts into competitor_post_classifications
  console.log("--- RUNNING COMPETITOR POST CLASSIFIER ---");
  const postsToClassify = allPosts.filter(p => p.caption && p.caption.trim().length > 10).slice(0, 20);
  console.log(`Classifying ${postsToClassify.length} posts with content...`);

  let classifiedCount = 0;
  for (const p of postsToClassify) {
    try {
      const classification = await classifyCompetitorPost(
        {
          id: p.id,
          competitorId: p.competitorId,
          caption: p.caption,
          hookText: null,
          hashtags: null,
          mediaType: "IMAGE",
          likes: null,
          comments: null,
          views: null,
          permalink: p.permalink,
        },
        ACCOUNT_ID,
      );

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
          coreMarketingPromise: classification.coreMarketingPromise,
          confidenceScore: classification.confidenceScore,
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
            coreMarketingPromise: classification.coreMarketingPromise,
            confidenceScore: classification.confidenceScore,
            classifiedAt: new Date(),
          },
        });
      classifiedCount++;
      process.stdout.write(".");
    } catch (e: any) {
      console.warn(`\nClassification error: ${e.message}`);
    }
  }
  console.log(`\nSuccessfully classified and persisted ${classifiedCount} posts.\n`);

  // 3. Re-run Audience Engine
  console.log("--- REBUILDING AUDIENCE ENGINE FROM REAL EVIDENCE ---");
  const audRes = await runAudienceEngine(ACCOUNT_ID, CAMPAIGN_ID);
  console.log(`Audience Engine Status: ${audRes.status}`);
  console.log(`Pains Count: ${audRes.audiencePains?.length || 0}`);
  console.log(`Desires Count: ${audRes.desireMap?.length || 0}`);
  console.log(`Objections Count: ${audRes.objectionMap?.length || 0}`);
  console.log(`Segments Count: ${audRes.audienceSegments?.length || 0}`);
  console.log("Structured Signals in Audience Result:", JSON.stringify(audRes.structuredSignals, null, 2));

  // 4. Initialize and Evaluate SGL
  console.log("\n--- EVALUATING SIGNAL GOVERNANCE LAYER (SGL) ---");
  const rawObjections = audRes.objectionMap || [];
  const mappedObjections = rawObjections.map((o: any) => ({
    label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
    confidence: o.confidence ?? o.confidenceScore ?? 0.5,
    evidence: Array.isArray(o.evidence) ? o.evidence : [],
  }));

  const sglState = initializeSignalGovernance(
    audRes.structuredSignals || { pain_clusters: [], desire_clusters: [], pattern_clusters: [], root_causes: [], psychological_drivers: [] },
    mappedObjections,
  );

  console.log(`SGL Initialized Signals: ${sglState.governedSignals.length}`);
  console.log("SGL Coverage Report:", sglState.coverageReport);

  const engines = ["differentiation", "positioning", "mechanism", "offer", "awareness", "funnel", "persuasion"] as const;
  for (const eng of engines) {
    const res = resolveSignalsForEngine(sglState, eng as any);
    console.log(`\nEngine [${eng}]:`);
    console.log(`  Required Categories: [${ENGINE_SIGNAL_REQUIREMENTS[eng].join(", ")}]`);
    console.log(`  Blocked: ${res.blocked}`);
    console.log(`  Insufficient Categories: [${res.insufficientCategories.join(", ")}]`);
    console.log(`  Clean Signals Count: ${res.signals.length}`);
  }
}

main().catch(console.error);
