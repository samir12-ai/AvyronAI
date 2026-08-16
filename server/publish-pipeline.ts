// @ts-nocheck
import { Router } from "express";
import { db } from "./db";
import { publishedPosts, accountState, captionVariants, studioItems, calendarEntries } from "@shared/schema";
import { eq, sql, lte, desc, and } from "drizzle-orm";
import { generateAndScoreCaptions, validateCaseMetadata } from "./caption-engine";
import { logAudit } from "./audit";
import { normalizeMediaType, CANONICAL_MEDIA_TYPES } from "../lib/media-types";
import { FeatureFlagService } from "./feature-flags";
import { runStudioAnalysis } from "./studio-analysis-engine";

import { resolveAccountId } from "./auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "./auth-helpers";
const router = Router();

// P-1 publish lineage (migration 041). Resolves which plan/calendar entry/studio
// item a published post traces back to, captured AT PUBLISH TIME so later
// calendar reshuffles can't rewrite history. Classification is explicit (B4):
//   'planned'   — resolvable to a plan-generated calendar entry.
//   'unplanned' — manual publish with no calendar lineage. Truthful state, not an error.
// Resolution failure NEVER blocks a publish — it logs PUBLISH_LINEAGE_MISSING
// and the post proceeds as 'unplanned'.
export interface PublishLineage {
  planId: string | null;
  calendarEntryId: string | null;
  studioItemId: string | null;
  hookStyle: string | null;
  contentAngle: string | null;
  plannedSlot: string | null;
  lineageSource: "planned" | "unplanned";
}

const UNPLANNED_LINEAGE: PublishLineage = {
  planId: null,
  calendarEntryId: null,
  studioItemId: null,
  hookStyle: null,
  contentAngle: null,
  plannedSlot: null,
  lineageSource: "unplanned",
};

export async function resolvePublishLineage(params: {
  accountId: string;
  postId: string;
  mediaItemId: string | null;
  createdStudioItemId: string | null;
}): Promise<PublishLineage> {
  const { accountId, postId, mediaItemId, createdStudioItemId } = params;

  const lineageFields = {
    id: studioItems.id,
    planId: studioItems.planId,
    calendarEntryId: studioItems.calendarEntryId,
    hook: studioItems.hook,
    contentAngle: studioItems.contentAngle,
    campaignId: studioItems.campaignId,
    contentType: studioItems.contentType,
  };

  // Preferred join: mediaItemId that IS a studio_items.id — this is the join
  // the outcome tracker was built around. Historically the client sends a
  // media-library id here (0 matches in prod), so the miss is logged loudly
  // and we fall back to the studio item created for this post.
  let lineageItem: { id: string; planId: string | null; calendarEntryId: string | null; hook: string | null; contentAngle: string | null; campaignId: string | null; contentType: string | null } | null = null;

  if (mediaItemId) {
    const byMediaId = await db.select(lineageFields)
      .from(studioItems)
      .where(and(eq(studioItems.id, mediaItemId), eq(studioItems.accountId, accountId)))
      .limit(1);
    if (byMediaId.length > 0) {
      lineageItem = byMediaId[0];
    } else {
      console.warn(
        `[PublishPipeline] PUBLISH_LINEAGE_MISSING | post=${postId} mediaItemId=${mediaItemId} ` +
        `matched no studio_items.id (client media-library id, not a studio item) — falling back to this post's own studio item.`,
      );
    }
  }

  if (!lineageItem && createdStudioItemId) {
    const byCreatedId = await db.select(lineageFields)
      .from(studioItems)
      .where(and(eq(studioItems.id, createdStudioItemId), eq(studioItems.accountId, accountId)))
      .limit(1);
    if (byCreatedId.length > 0) {
      lineageItem = byCreatedId[0];
    }
  }

  if (!lineageItem) {
    console.warn(
      `[PublishPipeline] PUBLISH_LINEAGE_MISSING | post=${postId} — no studio item resolvable ` +
      `(mediaItemId=${mediaItemId || "NONE"} createdStudioItemId=${createdStudioItemId || "NONE"}). lineageSource=unplanned.`,
    );
    return UNPLANNED_LINEAGE;
  }

  let planId = lineageItem.planId;
  const calendarEntryId = lineageItem.calendarEntryId;
  let plannedSlot: string | null = null;

  if (calendarEntryId) {
    const entryRows = await db.select({
      planId: calendarEntries.planId,
      scheduledDate: calendarEntries.scheduledDate,
      scheduledTime: calendarEntries.scheduledTime,
    })
      .from(calendarEntries)
      .where(eq(calendarEntries.id, calendarEntryId))
      .limit(1);

    if (entryRows.length === 0) {
      console.warn(
        `[PublishPipeline] PUBLISH_LINEAGE_MISSING | post=${postId} studioItem=${lineageItem.id} ` +
        `references calendarEntryId=${calendarEntryId} but no calendar_entries row exists — plannedSlot unknowable (kept null).`,
      );
    } else {
      const entry = entryRows[0];
      if (!planId) planId = entry.planId;
      plannedSlot = `${entry.scheduledDate} ${entry.scheduledTime}`;
    }
  }

  // P-1 closure — non-negotiable minimum (B4 explicit classification):
  // campaignId + contentType on the resolved studio item are the minimum for a
  // usable lineage. Either null → treat as full MISSING (existing behavior:
  // loud log, post proceeds as 'unplanned'; never blocks).
  if (!lineageItem.campaignId || !lineageItem.contentType) {
    console.warn(
      `[PublishPipeline] PUBLISH_LINEAGE_MISSING | post=${postId} studioItem=${lineageItem.id} ` +
      `reason=minimum_lineage_fields_null (campaignId=${lineageItem.campaignId || "NULL"} contentType=${lineageItem.contentType || "NULL"}) ` +
      `— treated as full missing. lineageSource=unplanned.`,
    );
    return UNPLANNED_LINEAGE;
  }

  const lineage: PublishLineage = {
    planId,
    calendarEntryId,
    studioItemId: lineageItem.id,
    hookStyle: lineageItem.hook,
    contentAngle: lineageItem.contentAngle,
    plannedSlot,
    // Definition: 'planned' means the post occupied a concrete calendar slot.
    // A studio item CAN carry a planId with no calendarEntryId (plan-inspired
    // but never scheduled) — that is deliberately 'unplanned' WITH planId kept,
    // so P-2 scoring can still attribute it to the plan without claiming it
    // executed a scheduled slot.
    lineageSource: calendarEntryId ? "planned" : "unplanned",
  };

  // P-1 closure — partial-lineage visibility (B2 visibility over silence):
  // lineage resolved and the minimum is present, but scoring-critical fields
  // are null, so P-2 scoring for those dimensions will be unavailable later.
  // Scoring-critical set in THIS schema: hookStyle, contentAngle, plannedSlot,
  // planId (plan attribution). Additive observability ONLY — loud log, never
  // blocks the publish, never retries.
  const nullCriticalFields = (["hookStyle", "contentAngle", "plannedSlot", "planId"] as const)
    .filter((field) => lineage[field] === null);
  if (nullCriticalFields.length > 0) {
    console.warn(
      `[PublishPipeline] PUBLISH_LINEAGE_PARTIAL | post=${postId} studioItem=${lineageItem.id} ` +
      `reason=scoring_critical_fields_null nullFields=${nullCriticalFields.join(",")} ` +
      `— lineage present but partial; publish proceeds normally, later scoring on these dimensions unavailable.`,
    );
  }

  return lineage;
}

router.post("/api/studio/case", async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    const { goal, audience, cta, series, offer, mediaType: rawMediaType, mediaUri, mediaItemId, platform, scheduledDate, campaignId, title } = req.body;

    if (!campaignId || typeof campaignId !== "string" || !campaignId.trim()) {
      return res.status(422).json({
        error: "CAMPAIGN_ID_REQUIRED",
        message: "campaignId is required. Every content item must be campaign-scoped.",
      });
    }
    try { await assertCampaignBelongsTo(accountId, campaignId); }
    catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

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

    // P-1: lineage resolved in the follow-up update (not the insert) because the
    // studio item for this post only exists after the insert above. Failure here
    // must never block the publish path — log loud, proceed as 'unplanned'.
    let lineage: PublishLineage = UNPLANNED_LINEAGE;
    try {
      lineage = await resolvePublishLineage({
        accountId,
        postId,
        mediaItemId: mediaItemId || null,
        createdStudioItemId: studioItemId,
      });
    } catch (lineageErr: any) {
      console.error(
        `[PublishPipeline] PUBLISH_LINEAGE_MISSING | post=${postId} — lineage resolution threw: ` +
        `"${lineageErr?.message ?? String(lineageErr)}". Post proceeds as lineageSource=unplanned.`,
      );
    }

    await db.update(publishedPosts)
      .set({
        caption: captionResult.winner.text,
        status: "scheduled",
        planId: lineage.planId,
        calendarEntryId: lineage.calendarEntryId,
        studioItemId: lineage.studioItemId,
        hookStyle: lineage.hookStyle,
        contentAngle: lineage.contentAngle,
        plannedSlot: lineage.plannedSlot,
        lineageSource: lineage.lineageSource,
        updatedAt: new Date(),
      })
      .where(eq(publishedPosts.id, postId));

    console.log(
      `[PublishPipeline] PUBLISH_LINEAGE_RESOLVED | post=${postId} source=${lineage.lineageSource} ` +
      `plan=${lineage.planId || "NONE"} calendarEntry=${lineage.calendarEntryId || "NONE"} studioItem=${lineage.studioItemId || "NONE"}`,
    );

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
    const accountId = resolveAccountId(req);
    const { campaignId, contentType: rawContentType, title, caption, mediaUrl, calendarEntryId } = req.body;

    if (!campaignId || typeof campaignId !== "string" || !campaignId.trim()) {
      return res.status(422).json({
        error: "CAMPAIGN_ID_REQUIRED",
        message: "campaignId is required. Every content item must be campaign-scoped.",
      });
    }
    try { await assertCampaignBelongsTo(accountId, campaignId); }
    catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

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
    const accountId = resolveAccountId(req);

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
    const accountId = resolveAccountId(req);
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
    const accountId = resolveAccountId(req);
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
    try { await assertCampaignBelongsTo(accountId, campaignId); }
    catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

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
    const accountId = resolveAccountId(req);

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
    const accountId = resolveAccountId(req);

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
    const accountId = resolveAccountId(req);

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
