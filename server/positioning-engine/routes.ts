import type { Express } from "express";
import { runPositioningEngine, getLatestPositioningSnapshot } from "./engine";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
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

      // Run-coherence is enforced only when the caller explicitly pins a run
      // via ?runId=. The default path serves the newest campaign-scoped
      // snapshot (manual re-analyze runs included) so fresh manual work is
      // never shadowed by an older orchestrator run. The substitution is
      // explicit, not silent: envelope.provenance.wasReused flags any served
      // snapshot whose jobId differs from the resolved orchestrator run.
      const snapshot = requestedRunId
        ? await getLatestPositioningSnapshot(accountId, campaignId, resolved.runId)
        : await getLatestPositioningSnapshot(accountId, campaignId, null);
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

      // D2/D3 — additive projection fields for Diagnose/Monitor consumers.
      const snapAny = snapshot as Record<string, unknown>;
      const snapStatus = typeof snapAny.snapshotStatus === "string" ? snapAny.snapshotStatus : null;
      let stability: { driftDetected?: unknown } | null = null;
      try {
        const sr = snapAny.stabilityResult;
        stability = typeof sr === "string" ? JSON.parse(sr) : (sr as { driftDetected?: unknown } | null);
      } catch { stability = null; }
      const drift = stability?.driftDetected === true;
      let validationState: "validated" | "provisional" | "weak" | "rejected" | "unknown" = "unknown";
      if (snapStatus === "COMPLETE" && !drift) validationState = "validated";
      else if (snapStatus === "PARTIAL" || drift) validationState = "provisional";
      else if (snapStatus === "INSUFFICIENT" || snapStatus === "WEAK") validationState = "weak";
      else if (snapStatus === "FAILED" || snapStatus === "REJECTED") validationState = "rejected";
      const signalOrigin: "real" | "inferred" | "unknown" = snapStatus === "PARTIAL" || drift ? "inferred" : snapStatus ? "real" : "unknown";
      const degraded = (snapStatus === "PARTIAL" || drift)
        ? { flag: true as const, reason: drift ? "Positioning drift detected" : "Positioning snapshot is PARTIAL", source: "data_quality", signalOrigin }
        : null;

      res.json({ ...snapshot, runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt, envelope, validationState, signalOrigin, degraded });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[PositioningEngine-V3] Latest route error:", msg);
      res.status(500).json({ error: msg });
    }
  });
}
