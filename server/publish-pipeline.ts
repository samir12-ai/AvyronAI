import { Router } from "express";
import { db } from "./db";
import { publishedPosts, accountState, captionVariants, studioItems } from "@shared/schema";
import { eq, sql, lte, desc, and } from "drizzle-orm";
import { generateAndScoreCaptions, validateCaseMetadata } from "./caption-engine";
import { logAudit } from "./audit";
import { normalizeMediaType, CANONICAL_MEDIA_TYPES } from "../lib/media-types";
import { FeatureFlagService } from "./feature-flags";
import { runStudioAnalysis } from "./studio-analysis-engine";

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

const featureFlagService = new FeatureFlagService();

router.post("/api/studio/items/save-and-analyze", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";
    const {
      campaignId,
      contentType: rawContentType,
      title,
      caption,
      mediaUrl,
      calendarEntryId,
      generationId,
      origin,
      engineName,
    } = req.body;

    if (!campaignId || typeof campaignId !== "string" || !campaignId.trim()) {
      return res.status(422).json({
        error: "CAMPAIGN_ID_REQUIRED",
        message: "campaignId is required. Every content item must be campaign-scoped.",
      });
    }

    const normalizedType = normalizeMediaType(rawContentType || "POST");

    if (generationId) {
      const existing = await db
        .select({ id: studioItems.id, analysisStatus: studioItems.analysisStatus })
        .from(studioItems)
        .where(eq(studioItems.generationId, generationId))
        .limit(1);

      if (existing.length > 0) {
        return res.json({
          success: true,
          studioItemId: existing[0].id,
          analysisStatus: existing[0].analysisStatus,
          idempotent: true,
          message: "Studio item already exists for this generationId.",
        });
      }
    }

    if (calendarEntryId) {
      const existing = await db
        .select({ id: studioItems.id, analysisStatus: studioItems.analysisStatus })
        .from(studioItems)
        .where(eq(studioItems.calendarEntryId, calendarEntryId))
        .limit(1);

      if (existing.length > 0) {
        return res.json({
          success: true,
          studioItemId: existing[0].id,
          analysisStatus: existing[0].analysisStatus,
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
      generationId: generationId || null,
      origin: origin || "AI_CREATION",
      engineName: engineName || null,
      analysisStatus: "PENDING",
    }).returning();

    const studioItemId = inserted[0]?.id;

    await logAudit(accountId, "STUDIO_ITEM_CREATED", {
      details: {
        studioItemId,
        campaignId,
        contentType: normalizedType,
        source: "save_and_analyze",
        engineName: engineName || null,
        generationId: generationId || null,
      },
    });

    const flagEnabled = await featureFlagService.isEnabled("auto_studio_analyze_v2", accountId);

    if (flagEnabled) {
      runStudioAnalysis(studioItemId).catch((err) => {
        console.error(`[Pipeline] Background analysis failed for ${studioItemId}:`, err);
      });
    } else {
      await db
        .update(studioItems)
        .set({ analysisStatus: "NONE", updatedAt: new Date() })
        .where(eq(studioItems.id, studioItemId));
    }

    res.json({
      success: true,
      studioItemId,
      analysisStatus: flagEnabled ? "PENDING" : "NONE",
      idempotent: false,
      flagEnabled,
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      if (error?.constraint?.includes("generation_id")) {
        const existing = await db
          .select({ id: studioItems.id, analysisStatus: studioItems.analysisStatus })
          .from(studioItems)
          .where(eq(studioItems.generationId, req.body.generationId))
          .limit(1);
        return res.json({
          success: true,
          studioItemId: existing[0]?.id || null,
          analysisStatus: existing[0]?.analysisStatus || "NONE",
          idempotent: true,
          message: "Studio item already exists (concurrent insert).",
        });
      }
      if (error?.constraint?.includes("calendar_entry_id")) {
        const existing = await db
          .select({ id: studioItems.id, analysisStatus: studioItems.analysisStatus })
          .from(studioItems)
          .where(eq(studioItems.calendarEntryId, req.body.calendarEntryId))
          .limit(1);
        return res.json({
          success: true,
          studioItemId: existing[0]?.id || null,
          analysisStatus: existing[0]?.analysisStatus || "NONE",
          idempotent: true,
          message: "Studio item already exists for this calendar entry (concurrent insert).",
        });
      }
    }
    console.error("[Pipeline] Error in save-and-analyze:", error);
    res.status(500).json({ error: "Failed to save and analyze studio item" });
  }
});

router.get("/api/studio/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = (req.query.accountId as string) || "default";

    const [item] = await db
      .select()
      .from(studioItems)
      .where(and(eq(studioItems.id, id), eq(studioItems.accountId, accountId)))
      .limit(1);

    if (!item) {
      return res.status(404).json({
        error: "STUDIO_ITEM_NOT_FOUND",
        message: "No studio item found with this ID.",
      });
    }

    res.json({ item });
  } catch (error) {
    console.error("[Pipeline] Error fetching studio item:", error);
    res.status(500).json({ error: "Failed to fetch studio item" });
  }
});

router.get("/api/studio/items/:id/analysis-status", async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = (req.query.accountId as string) || "default";

    const [item] = await db
      .select({
        id: studioItems.id,
        analysisStatus: studioItems.analysisStatus,
        analysisError: studioItems.analysisError,
        hook: studioItems.hook,
        goal: studioItems.goal,
        keywords: studioItems.keywords,
        contentAngle: studioItems.contentAngle,
        suggestedCta: studioItems.suggestedCta,
        suggestedCaption: studioItems.suggestedCaption,
      })
      .from(studioItems)
      .where(and(eq(studioItems.id, id), eq(studioItems.accountId, accountId)))
      .limit(1);

    if (!item) {
      return res.status(404).json({
        error: "STUDIO_ITEM_NOT_FOUND",
        message: "No studio item found with this ID.",
      });
    }

    res.json(item);
  } catch (error) {
    console.error("[Pipeline] Error fetching analysis status:", error);
    res.status(500).json({ error: "Failed to fetch analysis status" });
  }
});

router.post("/api/studio/items/:id/retry-analysis", async (req, res) => {
  try {
    const { id } = req.params;
    const accountId = (req.body.accountId as string) || "default";

    const [item] = await db
      .select({ id: studioItems.id, analysisStatus: studioItems.analysisStatus })
      .from(studioItems)
      .where(and(eq(studioItems.id, id), eq(studioItems.accountId, accountId)))
      .limit(1);

    if (!item) {
      return res.status(404).json({
        error: "STUDIO_ITEM_NOT_FOUND",
        message: "No studio item found with this ID.",
      });
    }

    if (item.analysisStatus === "RUNNING") {
      return res.status(409).json({
        error: "ANALYSIS_ALREADY_RUNNING",
        message: "Analysis is already in progress.",
      });
    }

    await db
      .update(studioItems)
      .set({ analysisStatus: "PENDING", analysisError: null, updatedAt: new Date() })
      .where(eq(studioItems.id, id));

    runStudioAnalysis(id).catch((err) => {
      console.error(`[Pipeline] Retry analysis failed for ${id}:`, err);
    });

    res.json({ success: true, analysisStatus: "PENDING" });
  } catch (error) {
    console.error("[Pipeline] Error retrying analysis:", error);
    res.status(500).json({ error: "Failed to retry analysis" });
  }
});

export function registerPublishPipelineRoutes(app: any) {
  app.use(router);
}
