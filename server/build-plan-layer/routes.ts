import type { Express } from "express";
import { runBuildPlanLayer } from "./engine";
import { resolveAccountId } from "../auth";
import { buildCausalNarrative } from "../narrative-layer";

export function registerBuildPlanLayerRoutes(app: Express) {
  app.post("/api/build-plan-layer/generate", async (req, res) => {
    try {
      const { campaignId } = req.body;
      const accountId = resolveAccountId(req);
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const depthGateStatus = req.body.depthGateStatus || undefined;
      const result = await runBuildPlanLayer(accountId, campaignId, depthGateStatus);

      let narrative = null;
      try {
        narrative = await buildCausalNarrative(campaignId, accountId);
      } catch (narrativeErr: any) {
        console.warn("[BuildPlanLayer] Narrative generation failed (non-blocking):", narrativeErr?.message);
      }

      res.json({ ...result, narrative });
    } catch (err: any) {
      console.error("[BuildPlanLayer] Route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/build-plan-layer/latest", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter required" });
      }

      const result = await runBuildPlanLayer(accountId, campaignId);
      res.json(result);
    } catch (err: any) {
      console.error("[BuildPlanLayer] Latest route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
