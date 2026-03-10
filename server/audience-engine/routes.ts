import type { Express } from "express";
import { runAudienceEngine, getLatestAudienceSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

export function registerAudienceEngineRoutes(app: Express) {
  app.post("/api/audience-engine/analyze", async (req, res) => {
    try {
      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;
      const validationSessionId = req.body.validationSessionId as string | undefined;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const sessionCheck = checkValidationSession(validationSessionId, "audience-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      console.log(`[AudienceEngine-Route] Analyze request: account=${accountId} campaign=${campaignId}`);
      const result = await runAudienceEngine(accountId, campaignId);
      return res.json(result);
    } catch (err: any) {
      console.error("[AudienceEngine-Route] Analyze error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/audience-engine/latest", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const snapshot = await getLatestAudienceSnapshot(accountId, campaignId);
      if (!snapshot) {
        return res.status(404).json({ error: "No audience analysis found for this campaign" });
      }

      return res.json(snapshot);
    } catch (err: any) {
      console.error("[AudienceEngine-Route] Latest error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}
