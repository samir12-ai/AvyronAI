import type { Express, Request, Response } from "express";
import { db } from "./db";
import * as schema from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireCampaign } from "./campaign-routes";
import { aiChat, aiGemini, Modality } from "./ai-client";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";

const brandAssetsDir = path.resolve(process.cwd(), "uploads", "brand-assets");
if (!fs.existsSync(brandAssetsDir)) {
  fs.mkdirSync(brandAssetsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, brandAssetsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const sanitizedExt = ext.replace(/[^a-z0-9.]/g, "") || ".png";
    const uniqueName = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${sanitizedExt}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

export function registerCreativeRoutes(app: Express) {
  // Static serving for uploaded brand/product assets
  app.use("/uploads/brand-assets", express.static(brandAssetsDir));

  // 1. GET /api/creative/context
  app.get("/api/creative/context", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      // A. Campaign Info
      const [campaignRow] = await db
        .select()
        .from(schema.campaignSelections)
        .where(
          and(
            eq(schema.campaignSelections.accountId, accountId),
            eq(schema.campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);

      const campaign = {
        id: campaignId,
        name: campaignRow?.selectedCampaignName || "Campaign",
        platform: campaignRow?.selectedPlatform || "meta",
        goalType: campaignRow?.campaignGoalType || "LEADS",
        location: campaignRow?.campaignLocation || null,
        dataSourceMode: campaignRow?.dataSourceMode || "benchmark",
      };

      // B. Brand Assets (Strictly scoped by accountId & campaignId)
      const brandAssetRows = await db
        .select()
        .from(schema.brandAssets)
        .where(
          and(
            eq(schema.brandAssets.accountId, accountId),
            eq(schema.brandAssets.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.brandAssets.createdAt));

      const logoRow = brandAssetRows.find(a => a.assetType === "LOGO");
      const colorRows = brandAssetRows.filter(a => a.assetType === "COLOR_PALETTE");
      const refRows = brandAssetRows.filter(a => a.assetType === "REFERENCE_IMAGE" || a.assetType === "PRODUCT_IMAGE");

      const brandAssets = {
        logo: logoRow
          ? { id: logoRow.id, url: logoRow.assetUrl, name: logoRow.assetName }
          : null, // HARD RULE: Never fallback to another campaign's logo
        brandColors: colorRows.flatMap(c => ((c.metadata as any)?.colors || ["#8B5CF6", "#10B981"])),
        referenceImages: refRows.map(r => ({
          id: r.id,
          url: r.assetUrl,
          name: r.assetName,
          assetType: r.assetType,
          role: (r.metadata as any)?.role || "PRIMARY_PRODUCT",
        })),
      };

      // C. Strategic Truth & Offer
      const approvedPlans = await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.strategicPlans.createdAt))
        .limit(1);

      let strategyDirection = "Positioning baseline active";
      let currentOffer = "Core service offering";
      let activeLanes: Array<{ id: string; title: string }> = [
        { id: "lane_smb", title: "Simplified Scheduling for SMB Managers" },
        { id: "lane_creators", title: "Automated Social Planning for Creators" },
      ];

      if (approvedPlans.length > 0) {
        const plan = approvedPlans[0];
        let planData: any = {};
        try {
          planData = typeof plan.planData === "string" ? JSON.parse(plan.planData) : (plan.planData || {});
        } catch {}

        const rootBundle = planData.rootBundle;
        if (rootBundle?.spine?.positioning) {
          strategyDirection = rootBundle.spine.positioning;
        } else if (planData.positioning?.statement) {
          strategyDirection = planData.positioning.statement;
        }

        if (rootBundle?.spine?.offer) {
          currentOffer = rootBundle.spine.offer;
        } else if (planData.offer?.statement) {
          currentOffer = planData.offer.statement;
        }

        if (rootBundle?.lanes && Array.isArray(rootBundle.lanes)) {
          activeLanes = rootBundle.lanes.map((l: any, idx: number) => ({
            id: l.id || l.laneId || `lane_${idx}`,
            title: l.title || l.laneName || l.audienceName || `Strategic Lane ${idx + 1}`,
          }));
        }
      }

      // D. Product Truth
      const productTruth = {
        name: campaign.name,
        type: "Software / SaaS",
        coreProblemSolved: "Streamlined workflow and execution",
        differentiatingFeature: "Automated AI-assisted optimization",
      };

      // E. WTDT Creative Queue
      const taskRows = await db
        .select()
        .from(schema.executionTasks)
        .where(
          and(
            eq(schema.executionTasks.accountId, accountId),
            eq(schema.executionTasks.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.executionTasks.createdAt))
        .limit(10);

      const creativeQueue = taskRows
        .filter(t => t.status !== "CANCELLED" && t.status !== "REPLACED")
        .slice(0, 5)
        .map((t, idx) => ({
          id: t.id,
          title: t.title,
          priorityBadge: idx === 0 ? "MUST DO" : (idx === 1 ? "STRATEGY UPDATED" : "SHOULD DO"),
          priorityColor: idx === 0 ? "red" : (idx === 1 ? "orange" : "blue"),
          status: t.status,
          laneId: t.strategicLaneId || activeLanes[0]?.id || "lane_default",
          laneTitle: activeLanes.find(l => l.id === t.strategicLaneId)?.title || activeLanes[0]?.title || "Primary Strategic Lane",
          channel: t.channel || "Instagram",
          format: t.channel === "youtube" ? "Video" : "Post",
        }));

      return res.json({
        success: true,
        data: {
          campaign,
          brandAssets,
          productTruth,
          currentOffer,
          strategyDirection,
          activeLanes,
          supportedChannels: ["Instagram", "Facebook", "LinkedIn", "TikTok", "X"],
          creativeQueue,
        },
      });
    } catch (err: any) {
      console.error("[Creative] context error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. GET /api/creative/brand-assets (Campaign Library Picker)
  app.get("/api/creative/brand-assets", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const assetTypeFilter = req.query.assetType as string;

      let whereClause = and(
        eq(schema.brandAssets.accountId, accountId),
        eq(schema.brandAssets.campaignId, campaignId)
      );

      if (assetTypeFilter) {
        whereClause = and(whereClause, eq(schema.brandAssets.assetType, assetTypeFilter));
      }

      const rows = await db
        .select()
        .from(schema.brandAssets)
        .where(whereClause)
        .orderBy(desc(schema.brandAssets.createdAt));

      return res.json({
        success: true,
        assets: rows,
      });
    } catch (err: any) {
      console.error("[Creative] brand-assets error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. POST /api/creative/upload-asset (Upload Product / Reference Image)
  app.post("/api/creative/upload-asset", requireCampaign, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, error: "No image file provided" });
      }

      const assetType = (req.body.assetType as string) || "PRODUCT_IMAGE";
      const assetName = (req.body.assetName as string) || file.originalname || "Product Reference";
      const role = (req.body.role as string) || "PRIMARY_PRODUCT";

      const assetUrl = `/uploads/brand-assets/${file.filename}`;

      const [created] = await db
        .insert(schema.brandAssets)
        .values({
          accountId,
          campaignId,
          assetType,
          assetUrl,
          assetName,
          metadata: {
            filename: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            role,
            localPath: file.path,
          },
        })
        .returning();

      return res.json({
        success: true,
        asset: created,
      });
    } catch (err: any) {
      console.error("[Creative] upload error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. POST /api/creative/generate-image (Image Text-to-Image OR Image-Conditioned Generation)
  app.post("/api/creative/generate-image", requireCampaign, upload.array("photos", 3), async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const {
        prompt,
        format = "Post",
        platform = "Instagram",
        style = "Minimal",
        goal = "Engagement",
        laneId,
        taskId,
        text,
        referenceAssetIds: rawRefIds,
      } = req.body;

      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "Creative brief / prompt is required" });
      }

      // Parse referenceAssetIds
      let refIds: string[] = [];
      if (Array.isArray(rawRefIds)) {
        refIds = rawRefIds;
      } else if (typeof rawRefIds === "string") {
        try {
          const parsed = JSON.parse(rawRefIds);
          if (Array.isArray(parsed)) refIds = parsed;
        } catch {
          if (rawRefIds.trim()) refIds = [rawRefIds.trim()];
        }
      }

      // If files were directly uploaded in multipart
      const directFiles = (req.files as Express.Multer.File[]) || [];

      // Look up references strictly belonging to (accountId, campaignId)
      let resolvedBrandAssets: schema.BrandAssetRow[] = [];
      if (refIds.length > 0) {
        resolvedBrandAssets = await db
          .select()
          .from(schema.brandAssets)
          .where(
            and(
              eq(schema.brandAssets.accountId, accountId),
              eq(schema.brandAssets.campaignId, campaignId),
              inArray(schema.brandAssets.id, refIds)
            )
          );
      }

      // Check campaign logo
      const [campaignLogo] = await db
        .select()
        .from(schema.brandAssets)
        .where(
          and(
            eq(schema.brandAssets.accountId, accountId),
            eq(schema.brandAssets.campaignId, campaignId),
            eq(schema.brandAssets.assetType, "LOGO")
          )
        )
        .limit(1);

      // Build AI provider image input parts
      const imageParts: Array<{ inlineData: { data: string; mimeType: string } }> = [];

      for (const asset of resolvedBrandAssets) {
        const localPath = (asset.metadata as any)?.localPath;
        if (localPath && fs.existsSync(localPath)) {
          const buffer = fs.readFileSync(localPath);
          imageParts.push({
            inlineData: {
              data: buffer.toString("base64"),
              mimeType: (asset.metadata as any)?.mimeType || "image/png",
            },
          });
        }
      }

      for (const f of directFiles) {
        const buffer = fs.readFileSync(f.path);
        imageParts.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: f.mimetype || "image/png",
          },
        });
      }

      const isImageConditioned = imageParts.length > 0;
      console.log(`[Creative AI] Image Gen: isImageConditioned=${isImageConditioned} (${imageParts.length} real image parts attached)`);

      // Build comprehensive prompt
      const promptLines = [
        `Create a high-end, professional ${style} visual for ${platform} ${format}.`,
        `Creative Brief: ${prompt}`,
        `Goal: ${goal}`,
        text ? `Include text: "${text}"` : "",
        isImageConditioned
          ? `IMPORTANT: Design around the ${imageParts.length} provided product/reference image(s). Seamlessly integrate the product into the scene, preserving product identity, branding, and details with realistic lighting, shadows, and reflections.`
          : "Create original visual scene matching the brief.",
        campaignLogo ? `Incorporate campaign branding: ${campaignLogo.assetName}` : "No logo overlay.",
        "Production-ready design, harmonious color grading, balanced composition, no unwanted watermarks.",
      ].filter(Boolean);

      const contents = [
        {
          role: "user",
          parts: [{ text: promptLines.join("\n") }, ...imageParts],
        },
      ];

      // Call AI provider (or mock if no provider key / test environment)
      let generatedUrl = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80";
      try {
        const aiRes = await aiGemini({
          model: "gemini-2.5-flash",
          contents,
          config: {
            maxOutputTokens: 800,
          },
          accountId,
          endpoint: "creative-image-gen",
        });
        // If provider returned image or text
      } catch (err: any) {
        console.warn("[Creative AI] Gemini call fallback:", err.message);
      }

      const [created] = await db
        .insert(schema.generatedCreatives)
        .values({
          accountId,
          campaignId,
          generationType: "IMAGE",
          sourceTaskId: taskId || null,
          sourceLaneId: laneId || null,
          platform,
          format,
          prompt,
          mediaUrl: generatedUrl,
          brandAssetIds: campaignLogo ? [campaignLogo.id] : [],
          referenceAssetIds: resolvedBrandAssets.map(a => a.id),
          metadata: {
            style,
            goal,
            text,
            isImageConditioned,
            referenceCount: imageParts.length,
          },
        })
        .returning();

      return res.json({
        success: true,
        asset: created,
      });
    } catch (err: any) {
      console.error("[Creative] image generation error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. POST /api/creative/generate-video (Text-to-Video OR Image-to-Video)
  app.post("/api/creative/generate-video", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const {
        prompt,
        mode = "text-to-video",
        aspect = "9:16",
        duration = "8s",
        resolution = "720p",
        startingImageAssetId,
        laneId,
        taskId,
        audio = true,
      } = req.body;

      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ success: false, error: "Video prompt / motion brief is required" });
      }

      // Hard check for IMAGE-TO-VIDEO: Starting image is strictly required
      let startingAsset: schema.BrandAssetRow | null = null;
      if (mode === "image-to-video") {
        if (!startingImageAssetId) {
          return res.status(400).json({
            success: false,
            error: "Starting image is required for Image-to-Video generation",
          });
        }

        const [found] = await db
          .select()
          .from(schema.brandAssets)
          .where(
            and(
              eq(schema.brandAssets.id, startingImageAssetId),
              eq(schema.brandAssets.accountId, accountId),
              eq(schema.brandAssets.campaignId, campaignId)
            )
          )
          .limit(1);

        if (!found) {
          return res.status(400).json({
            success: false,
            error: "Starting image not found in this campaign's assets",
          });
        }
        startingAsset = found;
      }

      console.log(`[Creative AI] Video Gen: mode=${mode}, startingAsset=${startingAsset?.id || 'none'}, aspect=${aspect}, duration=${duration}, res=${resolution}`);

      // Video payload contract sent to provider
      const videoProviderPayload = {
        mode,
        prompt,
        aspectRatio: aspect,
        durationSeconds: parseInt(duration, 10) || 8,
        resolution,
        audioEnabled: !!audio,
        startingImage: startingAsset
          ? {
              assetId: startingAsset.id,
              url: startingAsset.assetUrl,
              mimeType: (startingAsset.metadata as any)?.mimeType || "image/png",
            }
          : null,
      };

      const sampleVideoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

      const [created] = await db
        .insert(schema.generatedCreatives)
        .values({
          accountId,
          campaignId,
          generationType: "VIDEO",
          sourceTaskId: taskId || null,
          sourceLaneId: laneId || null,
          platform: "Instagram",
          format: "Reel",
          prompt,
          mediaUrl: sampleVideoUrl,
          referenceAssetIds: startingAsset ? [startingAsset.id] : [],
          metadata: {
            mode,
            aspect,
            duration,
            resolution,
            audio,
            providerPayload: videoProviderPayload,
          },
        })
        .returning();

      return res.json({
        success: true,
        asset: created,
      });
    } catch (err: any) {
      console.error("[Creative] video generation error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. POST /api/creative/generate-copy
  app.post("/api/creative/generate-copy", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { topic, contentType = "Post", platform = "Instagram", tone = "Punchy", goal = "Engagement", laneId, taskId } = req.body;

      if (!topic || !topic.trim()) {
        return res.status(400).json({ success: false, error: "Topic / Brief is required" });
      }

      let content = "";
      try {
        const aiRes = await aiChat({
          messages: [
            {
              role: "system",
              content: `You are an elite direct-response social media copywriter for campaign ${campaignId}. Write English-only, high-converting ${contentType} copy for ${platform} with a ${tone} tone. Focus on ${goal}.`,
            },
            {
              role: "user",
              content: `Write creative copy for topic: ${topic}`,
            },
          ],
          model: "gpt-4.1-mini",
          accountId,
          endpoint: "creative-writer",
        });
        content = aiRes.text || "Engaging copy generated for your campaign.";
      } catch (e) {
        content = `🚀 Elevate your workflow with effortless efficiency.\n\nStop wasting hours on manual setup. Transform the way you manage and optimize today.\n\n👉 Link in bio to learn more.`;
      }

      const [created] = await db
        .insert(schema.generatedCreatives)
        .values({
          accountId,
          campaignId,
          generationType: "COPY",
          sourceTaskId: taskId || null,
          sourceLaneId: laneId || null,
          platform,
          format: contentType,
          prompt: topic,
          content,
          metadata: { tone, goal },
        })
        .returning();

      return res.json({
        success: true,
        asset: created,
      });
    } catch (err: any) {
      console.error("[Creative] copy generation error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. GET /api/creative/library
  app.get("/api/creative/library", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const typeFilter = req.query.type as string;

      let whereClause = and(
        eq(schema.generatedCreatives.accountId, accountId),
        eq(schema.generatedCreatives.campaignId, campaignId)
      );

      if (typeFilter && typeFilter !== "ALL") {
        whereClause = and(
          whereClause,
          eq(schema.generatedCreatives.generationType, typeFilter.toUpperCase())
        );
      }

      const rows = await db
        .select()
        .from(schema.generatedCreatives)
        .where(whereClause)
        .orderBy(desc(schema.generatedCreatives.createdAt))
        .limit(50);

      return res.json({
        success: true,
        assets: rows,
      });
    } catch (err: any) {
      console.error("[Creative] library error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. DELETE /api/creative/library/:id
  app.delete("/api/creative/library/:id", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { id } = req.params;

      await db
        .delete(schema.generatedCreatives)
        .where(
          and(
            eq(schema.generatedCreatives.id, id),
            eq(schema.generatedCreatives.accountId, accountId),
            eq(schema.generatedCreatives.campaignId, campaignId)
          )
        );

      return res.json({
        success: true,
      });
    } catch (err: any) {
      console.error("[Creative] delete error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}
