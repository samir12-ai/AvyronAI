import { Router } from "express";
import { db } from "./db";
import { publishedPosts, accountState, captionVariants } from "@shared/schema";
import { eq, sql, lte, desc } from "drizzle-orm";
import { generateAndScoreCaptions, validateCaseMetadata } from "./caption-engine";
import { logAudit } from "./audit";

const router = Router();

router.post("/api/studio/case", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";
    const { goal, audience, cta, series, offer, mediaType, mediaUri, mediaItemId, platform, scheduledDate } = req.body;

    const validation = validateCaseMetadata({ goal, audience, cta });
    if (!validation.valid) {
      return res.status(400).json({
        error: "Missing required metadata",
        missing: validation.missing,
        message: `The following fields are required: ${validation.missing.join(", ")}`,
      });
    }

    const schedDate = scheduledDate ? new Date(scheduledDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const inserted = await db.insert(publishedPosts).values({
      accountId,
      mediaItemId: mediaItemId || null,
      mediaType: mediaType || "image",
      mediaUri: mediaUri || null,
      caption: "",
      platform: platform || "Instagram",
      scheduledDate: schedDate,
      status: "generating_caption",
      goal,
      audience,
      cta,
      series: series || null,
      offer: offer || null,
    }).returning();

    const postId = inserted[0]?.id;
    if (!postId) {
      return res.status(500).json({ error: "Failed to create studio case" });
    }

    const captionResult = await generateAndScoreCaptions(
      accountId,
      { goal, audience, cta, series, offer, mediaType: mediaType || "image", platform: platform || "Instagram" },
      postId
    );

    await db.update(publishedPosts)
      .set({
        caption: captionResult.winner.text,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(eq(publishedPosts.id, postId));

    await logAudit(accountId, "AUTO_EXECUTION", {
      details: {
        action: "auto_caption_generated",
        postId,
        winnerScore: captionResult.winner.totalScore,
        variantsCount: captionResult.allVariants.length,
        platform: platform || "Instagram",
        scheduledDate: schedDate.toISOString(),
      },
    });

    res.json({
      success: true,
      postId,
      caption: captionResult.winner.text,
      captionScore: captionResult.winner.totalScore,
      allVariants: captionResult.allVariants.map(v => ({
        text: v.text,
        totalScore: v.totalScore,
        toneScore: v.toneScore,
        ctaScore: v.ctaScore,
        structureScore: v.structureScore,
        lengthScore: v.lengthScore,
      })),
      scheduledDate: schedDate.toISOString(),
      status: "scheduled",
    });
  } catch (error) {
    console.error("[Pipeline] Error creating studio case:", error);
    res.status(500).json({ error: "Failed to create studio case" });
  }
});

router.get("/api/studio/cases", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "default";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const posts = await db.select().from(publishedPosts)
      .where(eq(publishedPosts.accountId, accountId))
      .orderBy(desc(publishedPosts.createdAt))
      .limit(limit);

    res.json({ posts });
  } catch (error) {
    console.error("[Pipeline] Error fetching cases:", error);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

router.get("/api/studio/case/:id/variants", async (req, res) => {
  try {
    const postId = req.params.id;
    const variants = await db.select().from(captionVariants)
      .where(eq(captionVariants.publishedPostId, postId))
      .orderBy(desc(captionVariants.totalScore));

    res.json({ variants });
  } catch (error) {
    console.error("[Pipeline] Error fetching variants:", error);
    res.status(500).json({ error: "Failed to fetch caption variants" });
  }
});

export function registerPublishPipelineRoutes(app: any) {
  app.use(router);
}
