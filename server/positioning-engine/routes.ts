import type { Express } from "express";
import { runPositioningEngine, getLatestPositioningSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
import { resolveOrManualJobId } from "../orchestrator/job-id";
export function registerPositioningEngineRoutes(app: Express) {
  app.post("/api/positioning-engine/analyze", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
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

      const __jobId = resolveOrManualJobId(req.body.jobId);
      const result = await runPositioningEngine(accountId, campaignId, miSnapshotId, audienceSnapshotId, undefined, __jobId);
      res.json(result);
    } catch (err: any) {
      console.error("[PositioningEngine-V3] Route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/positioning-engine/latest", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.query.campaignId as string;
      const requestedRunId = (req.query.runId as string) || null;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId query parameter is required" });
      }

      const { resolveRunId } = await import("../orchestrator/run-resolver");
      let resolved;
      try {
        resolved = await resolveRunId(campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false });
      }
      if (!resolved.runId) {
        return res.json({ runId: null, isLatest: true, isStale: false, snapshot: null });
      }

      const snapshot = await getLatestPositioningSnapshot(accountId, campaignId, resolved.runId);
      if (!snapshot) {
        return res.json({ runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, snapshot: null });
      }
      res.json({ ...snapshot, runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt });
    } catch (err: any) {
      console.error("[PositioningEngine-V3] Latest route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
