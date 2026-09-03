import type { Express, Request, Response } from "express";
import { assembleAudiencePositioningData } from "./audience-positioning-service";
import { resolveAccountId } from "./auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "./auth-helpers";

export function registerAudiencePositioningRoutes(app: Express) {
  app.get("/api/intelligence/audience-positioning/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const data = await assembleAudiencePositioningData(campaignId, accountId);
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error("[AudiencePositioningRoutes] Error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/intelligence/audience-positioning", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : (Array.isArray(req.query.campaignId) ? String(req.query.campaignId[0]) : "");

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const data = await assembleAudiencePositioningData(campaignId, accountId);
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error("[AudiencePositioningRoutes] Error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[AudiencePositioning] Routes registered: GET /api/intelligence/audience-positioning/:campaignId");
}
