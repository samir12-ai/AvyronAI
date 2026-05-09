import type { Express } from "express";
import { runPositioningEngine, getLatestPositioningSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
import { resolveOrManualJobId } from "../orchestrator/job-id";
import { wrapAsEnvelope } from "../orchestrator/contract-registry";
import { computeStalenessCoefficient } from "../shared/snapshot-trust";
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

      // Phase C3 — emit LiveSnapshotEnvelope. Helper returns parsed
      // territories/territory/etc, matching positioning contract paths.
      let envelope: ReturnType<typeof wrapAsEnvelope> | null = null;
      try {
        const staleness = computeStalenessCoefficient(snapshot as any);
        envelope = wrapAsEnvelope("positioning", snapshot, {
          snapshotId: (snapshot as any).id,
          campaignId,
          runId: resolved.runId,
          currentJobId: resolved.runId,
          provenance: {
            sourceJobId: (snapshot as any).jobId ?? null,
            createdAt: (snapshot as any).createdAt ? new Date((snapshot as any).createdAt).toISOString() : null,
            wasReused: (snapshot as any).jobId != null && (snapshot as any).jobId !== resolved.runId,
            freshnessClass: staleness.freshnessClass,
            ageInDays: staleness.ageInDays,
            schemaVersion: typeof (snapshot as any).engineVersion === "number" ? (snapshot as any).engineVersion : null,
          },
        });
      } catch (e: any) {
        console.log(`[ContractEnvelope] BUILD_FAILED engine=positioning snap=${(snapshot as any).id} err=${e?.message ?? String(e)}`);
      }

      res.json({ ...snapshot, runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt, envelope });
    } catch (err: any) {
      console.error("[PositioningEngine-V3] Latest route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
