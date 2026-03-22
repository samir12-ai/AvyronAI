import type { Express } from "express";
import { runBuildPlanLayer } from "./engine";

export function registerBuildPlanLayerRoutes(app: Express) {
  app.post("/api/build-plan-layer/generate", async (req, res) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const depthGateStatus = req.body.depthGateStatus || undefined;
      const result = await runBuildPlanLayer(accountId, campaignId, depthGateStatus);

      res.json(result);
    } catch (err: any) {
      console.error("[BuildPlanLayer] Route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/build-plan-layer/latest", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
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
