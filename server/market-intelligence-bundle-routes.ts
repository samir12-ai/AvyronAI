import type { Express, Request, Response } from "express";
import {
  assembleMarketOverviewData,
  assembleCompetitorDossier,
  assembleMarketIntelligenceBundle,
} from "./market-intelligence-service";
import { resolveAccountId } from "./auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "./auth-helpers";

export function registerMarketIntelligenceBundleRoutes(app: Express) {
  // Get Market Overview & Competitor Library
  app.get("/api/intelligence/market/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;

      if (!campaignId) {
        return res.status(400).json({ success: false, error: "campaignId is required" });
      }

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const competitorId = req.query.competitorId as string | undefined;
      const data = await assembleMarketIntelligenceBundle(campaignId, competitorId, accountId);
      return res.json({ success: true, data });
    } catch (err: any) {
      console.error("[MarketIntelligenceRoutes] Error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get Detailed Competitor Dossier
  app.get("/api/intelligence/market/:campaignId/competitor/:competitorId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const { campaignId, competitorId } = req.params;

      if (!campaignId || !competitorId) {
        return res.status(400).json({ success: false, error: "campaignId and competitorId are required" });
      }

      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const dossier = await assembleCompetitorDossier(campaignId, competitorId, accountId);
      if (!dossier) {
        return res.status(404).json({ success: false, error: "Competitor not found or insufficient intelligence data." });
      }

      return res.json({ success: true, data: dossier });
    } catch (err: any) {
      console.error("[MarketIntelligenceRoutes] Dossier Error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[MarketIntelligence] Routes registered: GET /api/intelligence/market/:campaignId, GET /api/intelligence/market/:campaignId/competitor/:competitorId");
}
