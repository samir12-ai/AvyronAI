import type { Express } from "express";
import { runPositioningEngine, getLatestPositioningSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

export function registerPositioningEngineRoutes(app: Express) {
  app.post("/api/positioning-engine/analyze", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      const { campaignId, miSnapshotId, audienceSnapshotId, validationSessionId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "positioning-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!miSnapshotId) {
        return res.status(400).json({ error: "miSnapshotId is required — run Market Intelligence first" });
      }
      if (!audienceSnapshotId) {
        return res.status(400).json({ error: "audienceSnapshotId is required — run Audience Engine first" });
      }

      const result = await runPositioningEngine(accountId, campaignId, miSnapshotId, audienceSnapshotId);
      res.json(result);
    } catch (err: any) {
      console.error("[PositioningEngine-V3] Route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/positioning-engine/latest", async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      const campaignId = req.query.campaignId as string;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      const snapshot = await getLatestPositioningSnapshot(accountId, campaignId);
      if (!snapshot) {
        return res.json(null);
      }
      res.json(snapshot);
    } catch (err: any) {
      console.error("[PositioningEngine-V3] Latest route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
