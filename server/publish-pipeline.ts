import { Router } from "express";
import { db } from "./db";
import { publishedPosts, accountState, captionVariants, studioItems } from "@shared/schema";
import { eq, sql, lte, desc, and } from "drizzle-orm";
import { generateAndScoreCaptions, validateCaseMetadata } from "./caption-engine";
import { logAudit } from "./audit";
import { normalizeMediaType, CANONICAL_MEDIA_TYPES } from "../lib/media-types";

const router = Router();

router.post("/api/studio/case", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";
    const { goal, audience, cta, series, offer, mediaType: rawMediaType, mediaUri, mediaItemId, platform, scheduledDate, campaignId, title } = req.body;

    if (!campaignId || typeof campaignId !== "string" || !campaignId.trim()) {
      return res.status(422).json({
        error: "CAMPAIGN_ID_REQUIRED",
        message: "campaignId is required. Every content item must be campaign-scoped.",
      });
    }

    const validation = validateCaseMetadata({ goal, audience, cta });
    if (!validation.valid) {
      return res.status(400).json({
        error: "Missing required metadata",
        missing: validation.missing,
        message: `The following fields are required: ${validation.missing.join(", ")}`,
      });
    }

    const normalizedType = normalizeMediaType(rawMediaType || "image");
    if (rawMediaType && typeof rawMediaType === 'string') {
      const upper = rawMediaType.trim().toUpperCase();
      if (!CANONICAL_MEDIA_TYPES.includes(upper as any) && normalizedType === 'IMAGE' && !['photo', 'poster', 'image', 'images'].includes(rawMediaType.trim().toLowerCase())) {
        return res.status(422).json({ error: "MEDIA_TYPE_INVALID", message: `Unknown media type: "${rawMediaType}". Valid types: ${CANONICAL_MEDIA_TYPES.join(', ')}` });
      }
    }

    const schedDate = scheduledDate ? new Date(scheduledDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const inserted = await db.insert(publishedPosts).values({
      accountId,
      mediaItemId: mediaItemId || null,
      mediaType: normalizedType,
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
      campaignId,
    }).returning();

    const postId = inserted[0]?.id;
    if (!postId) {
      return res.status(500).json({ error: "Failed to create studio case" });
    }

    let studioItemId: string | null = null;
    const existingItem = await db
      .select({ id: studioItems.id })
      .from(studioItems)
      .where(and(eq(studioItems.sourcePostId, postId)))
      .limit(1);

    if (existingItem.length === 0) {
      const siInserted = await db.insert(studioItems).values({
        campaignId,
        accountId,
        contentType: normalizedType,
        title: title || goal || "Untitled",
        caption: "",
        mediaUrl: mediaUri || null,
        status: "DRAFT",
        sourcePostId: postId,
        planId: null,
        calendarEntryId: null,
      }).returning();
      studioItemId = siInserted[0]?.id || null;
    } else {
      studioItemId = existingItem[0].id;
    }

    const captionResult = await generateAndScoreCaptions(
      accountId,
      { goal, audience, cta, series, offer, mediaType: normalizedType, platform: platform || "Instagram" },
      postId
    );

    await db.update(publishedPosts)
      .set({
        caption: captionResult.winner.text,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(eq(publishedPosts.id, postId));

    if (studioItemId) {
      await db.update(studioItems)
        .set({
          caption: captionResult.winner.text,
          status: "READY",
          updatedAt: new Date(),
        })
        .where(eq(studioItems.id, studioItemId));
    }

    await logAudit(accountId, "AUTO_EXECUTION", {
      details: {
        action: "auto_caption_generated",
        postId,
        studioItemId,
        winnerScore: captionResult.winner.totalScore,
        variantsCount: captionResult.allVariants.length,
        platform: platform || "Instagram",
        scheduledDate: schedDate.toISOString(),
        campaignId,
      },
    });

    res.json({
      success: true,
      postId,
      studioItemId,
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

router.post("/api/studio/items", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";
    const { campaignId, contentType: rawContentType, title, caption, mediaUrl, calendarEntryId } = req.body;

    if (!campaignId || typeof campaignId !== "string" || !campaignId.trim()) {
      return res.status(422).json({
        error: "CAMPAIGN_ID_REQUIRED",
        message: "campaignId is required. Every content item must be campaign-scoped.",
      });
    }

    const normalizedType = normalizeMediaType(rawContentType || "POST");

    if (calendarEntryId) {
      const existing = await db
        .select({ id: studioItems.id })
        .from(studioItems)
        .where(eq(studioItems.calendarEntryId, calendarEntryId))
        .limit(1);

      if (existing.length > 0) {
        return res.json({
          success: true,
          studioItemId: existing[0].id,
          idempotent: true,
          message: "Studio item already exists for this calendar entry.",
        });
      }
    }

    const inserted = await db.insert(studioItems).values({
      campaignId,
      accountId,
      contentType: normalizedType,
      title: title || "Untitled",
      caption: caption || null,
      mediaUrl: mediaUrl || null,
      status: "DRAFT",
      planId: null,
      calendarEntryId: calendarEntryId || null,
      sourcePostId: null,
    }).returning();

    const studioItemId = inserted[0]?.id;

    await logAudit(accountId, "STUDIO_ITEM_CREATED", {
      details: {
        studioItemId,
        campaignId,
        contentType: normalizedType,
        source: "create_tab",
      },
    });

    res.json({
      success: true,
      studioItemId,
      idempotent: false,
    });
  } catch (error: any) {
    if (error?.code === "23505" && error?.constraint?.includes("calendar_entry_id")) {
      const existing = await db
        .select({ id: studioItems.id })
        .from(studioItems)
        .where(eq(studioItems.calendarEntryId, req.body.calendarEntryId))
        .limit(1);

      return res.json({
        success: true,
        studioItemId: existing[0]?.id || null,
        idempotent: true,
        message: "Studio item already exists for this calendar entry (concurrent insert).",
      });
    }
    console.error("[Pipeline] Error creating studio item:", error);
    res.status(500).json({ error: "Failed to create studio item" });
  }
});

router.delete("/api/studio/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = (req.query.accountId as string) || "default";

    const deleted = await db
      .delete(studioItems)
      .where(and(eq(studioItems.id, id), eq(studioItems.accountId, accountId)))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({
        error: "STUDIO_ITEM_NOT_FOUND",
        message: "No studio item found with this ID for this account.",
      });
    }

    await logAudit(accountId, "STUDIO_ITEM_DELETED", {
      details: {
        studioItemId: id,
        campaignId: deleted[0].campaignId,
        contentType: deleted[0].contentType,
      },
    });

    res.json({
      success: true,
      deleted: true,
      studioItemId: id,
    });
  } catch (error) {
    console.error("[Pipeline] Error deleting studio item:", error);
    res.status(500).json({ error: "Failed to delete studio item" });
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
