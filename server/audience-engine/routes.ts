import type { Express } from "express";
import { runAudienceEngine, getLatestAudienceSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
import { resolveOrManualJobId } from "../orchestrator/job-id";
import { wrapAsEnvelope } from "../orchestrator/contract-registry";
import { computeStalenessCoefficient } from "../shared/snapshot-trust";
export function registerAudienceEngineRoutes(app: Express) {
  app.post("/api/audience-engine/analyze", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.body.campaignId as string;
      const validationSessionId = req.body.validationSessionId as string | undefined;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // P0-4: body-level campaignId must belong to the authed account.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const sessionCheck = checkValidationSession(validationSessionId, "audience-engine", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      const __jobId = resolveOrManualJobId(req.body.jobId);
      console.log(`[AudienceEngine-Route] Analyze request: account=${accountId} campaign=${campaignId} jobId=${__jobId}`);
      const result = await runAudienceEngine(accountId, campaignId, undefined, __jobId);
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

      // P0-4: query-level campaignId must belong to the authed account.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

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

      // Phase C3 — emit LiveSnapshotEnvelope alongside legacy fields. The
      // helper already returns the snapshot row spread with parsed
      // painMap/desireMap/objectionMap/etc, which matches the audience
      // contract's required paths.
      let envelope: ReturnType<typeof wrapAsEnvelope> | null = null;
      try {
        const staleness = computeStalenessCoefficient(snapshot as any);
        envelope = wrapAsEnvelope("audience", snapshot, {
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
        console.log(`[ContractEnvelope] BUILD_FAILED engine=audience snap=${(snapshot as any).id} err=${e?.message ?? String(e)}`);
      }

      return res.json({ ...snapshot, runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt, envelope });
    } catch (err: any) {
      console.error("[AudienceEngine-Route] Latest error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}
