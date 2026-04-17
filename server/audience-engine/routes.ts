import type { Express } from "express";
import { runAudienceEngine, getLatestAudienceSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
export function registerAudienceEngineRoutes(app: Express) {
  app.post("/api/audience-engine/analyze", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      const requestedRunId = (req.query.runId as string) || null;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const { resolveRunId } = await import("../orchestrator/run-resolver");
      let resolved;
      try {
        resolved = await resolveRunId(campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false });
      }
      if (!resolved.runId) {
        return res.status(404).json({ error: "No completed orchestrator run for this campaign yet.", runId: null, isLatest: true, isStale: false });
      }

      const snapshot = await getLatestAudienceSnapshot(accountId, campaignId, resolved.runId);
      if (!snapshot) {
        return res.status(404).json({ error: "No audience snapshot for this run", runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale });
      }

      return res.json({ ...snapshot, runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt });
    } catch (err: any) {
      console.error("[AudienceEngine-Route] Latest error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}
