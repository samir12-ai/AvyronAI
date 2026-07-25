import type { Express } from "express";
import { db } from "../db";
import { miSnapshots, miTelemetry, miSignalLogs, miRefreshSchedule } from "@shared/schema";
import { inArray, eq, and, desc, sql } from "drizzle-orm";
import { MarketIntelligenceV3, validateEngineIsolation, rejectBlockedEngine, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot, buildResultFromSnapshot } from "./engine";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import { getFetchJobStatus, startFetchJob } from "./fetch-orchestrator";
import { getEngineReadinessState, verifySnapshotIntegrity } from "./engine-state";
import { ENGINE_VERSION } from "./constants";
import type { MIv3Mode } from "./types";
import { checkValidationSession } from "../engine-hardening";

import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, assertFetchJobBelongsTo, handleOwnershipError } from "../auth-helpers";
import { wrapAsEnvelope } from "../orchestrator/contract-registry";
import { computeStalenessCoefficient } from "../shared/snapshot-trust";
const ALLOWED_MODES: MIv3Mode[] = ["overview", "dominance", "threats", "history"];

function enforceEngineWhitelist(req: any): void {
  const body = req.body || {};
  const engineRef = body.engine || body.engineName || body.orchestrator;
  if (engineRef) {
    rejectBlockedEngine(engineRef, req.originalUrl);
  }
}

export function registerMIv3Routes(app: Express) {
  app.post("/api/ci/mi-v3/analyze", requireCampaign, async (req, res) => {
    try {
      enforceEngineWhitelist(req);
      validateEngineIsolation("MARKET_INTELLIGENCE_V3");

      const accountId = resolveAccountId(req);
      const campaignId = req.body.campaignId as string;
      const mode = (req.body.mode as MIv3Mode) || "overview";
      const forceRefresh = req.body.forceRefresh === true;
      const validationSessionId = req.body.validationSessionId as string | undefined;

      if (!campaignId) {
        return res.status(422).json({ error: "campaignId is required" });
      }

      // P0-4: body-level campaignId must belong to the authed account. Belt
      // and suspenders even though `requireCampaign` middleware also enforces
      // this — defensive in case middleware ordering changes.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const sessionCheck = checkValidationSession(validationSessionId, "market-intelligence-v3", campaignId);
      if (!sessionCheck.allowed) {
        return res.status(429).json({
          error: "REVALIDATION_LOOP_BLOCKED",
          message: sessionCheck.warning,
        });
      }

      if (!ALLOWED_MODES.includes(mode)) {
        return res.status(400).json({ error: `Invalid mode: ${mode}. Allowed: ${ALLOWED_MODES.join(", ")}` });
      }

      console.log(`[MIv3-Route] POST /api/ci/mi-v3/analyze | mode=${mode} | accountId=${accountId} | campaignId=${campaignId}`);

      const goalMode = (req.body.goalMode === "REACH_MODE" ? "REACH_MODE" : "STRATEGY_MODE") as import("./types").GoalMode;
      const { resolveOrManualJobId } = await import("../orchestrator/job-id");
      const __jobId = resolveOrManualJobId(req.body.jobId);
      const result = await MarketIntelligenceV3.run(mode, accountId, campaignId, forceRefresh, goalMode, __jobId);

      if (result.signalDiagnostics) {
        console.log(`[MIv3-Route] SignalDiagnostics | posts=${result.signalDiagnostics.postsProcessed} detected=${result.signalDiagnostics.signalsDetected} filtered=${result.signalDiagnostics.signalsFiltered} used=${result.signalDiagnostics.signalsUsed}`);
      }
      if (result.narrativeOverlap?.overlapDetected) {
        console.log(`[MIv3-Route] NarrativeOverlap | duplicates=${result.narrativeOverlap.duplicateNarratives.length} penalty=${result.narrativeOverlap.saturationPenalty}`);
      }

      let freshnessMetadata = null;
      if (result.snapshotId) {
        try {
          const [snap] = await db.select().from(miSnapshots)
            .where(eq(miSnapshots.id, result.snapshotId))
            .limit(1);
          if (snap) {
            const { buildFreshnessMetadata, logFreshnessTraceability } = await import("../shared/snapshot-trust");
            freshnessMetadata = buildFreshnessMetadata(snap);
            logFreshnessTraceability("MIv3-Analyze", snap, freshnessMetadata);
          }
        } catch (fmErr: any) {
          console.warn(`[MIv3-Route] Freshness metadata build failed for snapshot ${result.snapshotId}: ${fmErr.message}`);
        }
      }

      return res.json({
        success: true,
        ...result,
        freshnessMetadata,
      });
    } catch (err: any) {
      console.error("[MIv3-Route] Error:", err.message);
      if (err.message.includes("ISOLATION VIOLATION")) {
        return res.status(403).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || "Market Intelligence V3 analysis failed" });
    }
  });

  app.get("/api/ci/mi-v3/snapshot/:campaignId", requireCampaign, async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;
      // W5 (architect re-review #6): explicit ownership assert at the boundary.
      // requireCampaign validates the *currently selected* campaign, but
      // params.campaignId is supplied directly in the URL and could differ.
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }
      const requestedRunId = (req.query.runId as string) || null;

      const { resolveRunId } = await import("../orchestrator/run-resolver");
      let resolved;
      try {
        resolved = await resolveRunId(campaignId, accountId, requestedRunId);
      } catch (e: any) {
        return res.status(404).json({ error: e.message, runId: null, isLatest: false, isStale: false });
      }

      if (!resolved.runId) {
        return res.json({ snapshot: null, engineState: "REFRESH_REQUIRED", runId: null, isLatest: true, isStale: false, message: "No completed orchestrator run for this campaign yet." });
      }

      // MI is the one engine with livenessRule="reuse_allowed" (see Phase C3
      // comment below). Its snapshots are overwhelmingly written by manual
      // refreshes ("manual_*") and the background fetch-orchestrator
      // ("persist:*") rather than by orchestrator runs, so a strict
      // run-pinned lookup starves the customer surface as soon as the run's
      // own snapshot is pruned — even when fresh COMPLETE snapshots exist.
      // Resolution order: (1) run-pinned snapshot, (2) explicit, labeled
      // fallback to the newest usable snapshot for this campaign. The reuse
      // is never silent: `snapshotResolution` is surfaced at the response root
      // and envelope provenance.wasReused already flags jobId mismatch (B3/B4).
      // NOTE: named `snapshotResolution` (not `snapshotSource`) because the
      // `...result` spread below already carries the canonical
      // `snapshotSource: FRESH_DATA | CACHED_DATA` data-provenance enum (D2 —
      // every meaning has its own field; do not clobber it).
      let snapshotResolution: "run_pinned" | "latest_reused" = "run_pinned";
      let snapshots = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, campaignId),
          eq(miSnapshots.jobId, resolved.runId),
          inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
        ))
        .limit(1);

      if (snapshots.length === 0) {
        snapshots = await db.select().from(miSnapshots)
          .where(and(
            eq(miSnapshots.accountId, accountId),
            eq(miSnapshots.campaignId, campaignId),
            inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
          ))
          .orderBy(desc(miSnapshots.createdAt))
          .limit(1);
        if (snapshots.length > 0) snapshotResolution = "latest_reused";
      }

      if (snapshots.length === 0) {
        return res.json({ snapshot: null, engineState: "REFRESH_REQUIRED", runId: resolved.runId, isLatest: resolved.isLatest, isStale: resolved.isStale, completedAt: resolved.completedAt, message: "No MI snapshot for this campaign yet. Run analysis first." });
      }

      const snapshot = snapshots[0];
      const readiness = getEngineReadinessState(snapshot, campaignId, ENGINE_VERSION);
      const result = buildResultFromSnapshot(snapshot);

      // Phase C3 — emit LiveSnapshotEnvelope. MI's contract reads required
      // fields at the *root* of the engine output (signalData, confidenceData,
      // marketState, trajectoryData, dominanceData, diagnosticsData.signalComposition).
      // `buildResultFromSnapshot` returns those fields nested differently, so
      // we build a flat contract-facing object directly from the parsed
      // snapshot text columns. MI is also the one engine with
      // livenessRule="reuse_allowed", so wasReused is computed from
      // snapshot.jobId vs resolved.runId. The MI snapshot uses
      // `analysisVersion` (not `engineVersion`) for schemaVersion.
      let envelope: ReturnType<typeof wrapAsEnvelope> | null = null;
      try {
        const safeJsonParse = (text: any): any => {
          if (!text) return null;
          if (typeof text !== "string") return text;
          try { return JSON.parse(text); } catch { return null; }
        };
        const miContractOutput = {
          signalData: safeJsonParse((snapshot as any).signalData),
          confidenceData: safeJsonParse((snapshot as any).confidenceData),
          marketState: (snapshot as any).marketState ?? null,
          trajectoryData: safeJsonParse((snapshot as any).trajectoryData),
          dominanceData: safeJsonParse((snapshot as any).dominanceData),
          diagnosticsData: safeJsonParse((snapshot as any).diagnosticsData),
          narrativeSynthesis: (snapshot as any).narrativeSynthesis ?? null,
          marketDiagnosis: (snapshot as any).marketDiagnosis ?? null,
          objectionMapData: safeJsonParse((snapshot as any).objectionMapData),
        };
        const staleness = computeStalenessCoefficient(snapshot as any);
        envelope = wrapAsEnvelope("market_intelligence", miContractOutput, {
          snapshotId: snapshot.id,
          campaignId,
          runId: resolved.runId,
          currentJobId: resolved.runId,
          provenance: {
            sourceJobId: (snapshot as any).jobId ?? null,
            createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : null,
            wasReused: (snapshot as any).jobId != null && (snapshot as any).jobId !== resolved.runId,
            freshnessClass: staleness.freshnessClass,
            ageInDays: staleness.ageInDays,
            schemaVersion: typeof (snapshot as any).analysisVersion === "number" ? (snapshot as any).analysisVersion : null,
          },
        });
      } catch (e: any) {
        console.log(`[ContractEnvelope] BUILD_FAILED engine=market_intelligence snap=${snapshot.id} err=${e?.message ?? String(e)}`);
      }

      return res.json({
        snapshot,
        ...result,
        engineState: readiness.state,
        engineDiagnostics: readiness.diagnostics,
        freshnessMetadata: readiness.freshnessMetadata || null,
        runId: resolved.runId,
        // isLatest/isStale describe the resolved orchestrator RUN, not the
        // snapshot — when snapshotResolution === "latest_reused" the snapshot
        // may be newer than the run. Snapshot-level freshness travels in
        // freshnessMetadata and envelope.provenance.
        isLatest: resolved.isLatest,
        isStale: resolved.isStale,
        completedAt: resolved.completedAt,
        snapshotResolution,
        envelope,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/refresh", requireCampaign, async (req, res) => {
    try {
      enforceEngineWhitelist(req);
      validateEngineIsolation("MARKET_INTELLIGENCE_V3");

      const accountId = resolveAccountId(req);
      const campaignId = req.body.campaignId as string;

      if (!campaignId) {
        return res.status(422).json({ error: "campaignId is required" });
      }

      // W5 (architect re-review #6): explicit body-level campaignId ownership
      // assertion. requireCampaign validates the *currently selected* campaign
      // for the account, but the body can still reference an arbitrary
      // campaignId. Mirrors /fetch-job and /analyze.
      try {
        await assertCampaignBelongsTo(accountId, campaignId);
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      console.log(`[MIv3-Route] POST /api/ci/mi-v3/refresh | manual refresh | campaignId=${campaignId}`);

      const goalMode = (req.body.goalMode === "REACH_MODE" ? "REACH_MODE" : "STRATEGY_MODE") as import("./types").GoalMode;
      const { resolveOrManualJobId } = await import("../orchestrator/job-id");
      const __jobId = resolveOrManualJobId(req.body.jobId);
      const result = await MarketIntelligenceV3.run("overview", accountId, campaignId, true, goalMode, __jobId);

      return res.json({
        success: true,
        message: "Snapshot refreshed",
        ...result,
      });
    } catch (err: any) {
      console.error("[MIv3-Route] Refresh error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ci/mi-v3/history/:campaignId", requireCampaign, async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.params.campaignId;

      const snapshots = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, campaignId),
          inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(20);

      return res.json({
        history: snapshots.map(s => ({
          id: s.id,
          version: s.version,
          marketState: s.marketState,
          confidenceLevel: s.confidenceLevel,
          overallConfidence: s.overallConfidence,
          executionMode: s.executionMode,
          volatilityIndex: s.volatilityIndex,
          dataFreshnessDays: s.dataFreshnessDays,
          createdAt: s.createdAt,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ci/mi-v3/telemetry/:snapshotId", async (req, res) => {
    try {
      const snapshotId = req.params.snapshotId;
      const accountId = resolveAccountId(req);

      const [snapshot] = await db.select({ id: miSnapshots.id })
        .from(miSnapshots)
        .where(and(eq(miSnapshots.id, snapshotId), eq(miSnapshots.accountId, accountId)))
        .limit(1);

      if (!snapshot) {
        return res.status(404).json({ error: "Snapshot not found" });
      }

      const records = await db.select().from(miTelemetry)
        .where(eq(miTelemetry.snapshotId, snapshotId));

      const signals = await db.select().from(miSignalLogs)
        .where(eq(miSignalLogs.snapshotId, snapshotId));

      return res.json({ telemetry: records, signals });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/plan-write-attempt", (req, res) => {
    try {
      assertNoPlanWrites();
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/orchestrator-attempt", (req, res) => {
    try {
      assertNoOrchestrator();
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/autopilot-attempt", (req, res) => {
    try {
      assertNoAutopilot();
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/fetch-job", requireCampaign, async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = req.body.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      // W5 (P0-4 cleanup): use centralized assertCampaignBelongsTo helper.
      // requireCampaign validates the *currently selected* campaign for the
      // account; the request body could still reference an arbitrary
      // campaignId. Helper returns 404 CAMPAIGN_NOT_FOUND on mismatch
      // (anti-enumeration), replacing the prior inline raw-SQL check.
      try {
        await assertCampaignBelongsTo(accountId, String(campaignId));
      } catch (e) {
        if (handleOwnershipError(e, res)) return;
        throw e;
      }

      const jobId = await startFetchJob(accountId, campaignId);
      const status = await getFetchJobStatus(jobId, accountId);
      return res.json({ jobId, status: status?.status || "QUEUED", message: "Data collection job queued via Two-Speed system" });
    } catch (err: any) {
      console.error("[MIv3-Route] Fetch-job error:", err.message);
      if (err.message.includes("already in progress") || err.message.includes("DEDUP")) {
        return res.status(409).json({ error: err.message });
      }
      // Task #54 / GR22+GR23 — surface admission denials as typed,
      // actionable responses instead of generic 500s. Operators (and the
      // client UI) need to distinguish "we deliberately blocked this"
      // from "the server crashed". B1 doctrine — truthful guardrail
      // signal beats opaque error.
      if (err?.code === "SCRAPE_VOLUME_CAP_EXCEEDED") {
        return res.status(429).json({
          error: err.message,
          code: "SCRAPE_VOLUME_CAP_EXCEEDED",
          admission: err.admission ?? null,
        });
      }
      if (err?.code === "MI_QUEUE_DEPTH_DEFERRED") {
        return res.status(503).json({
          error: err.message,
          code: "MI_QUEUE_DEPTH_DEFERRED",
          admission: err.admission ?? null,
        });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/fetch", requireCampaign, async (_req, res) => {
    return res.status(410).json({ error: "DEPRECATED: Batch fetch removed. Use POST /api/ci/mi-v3/fetch-job to trigger collection via the global job queue." });
  });

  app.get("/api/ci/mi-v3/fetch-status/:jobId", async (req, res) => {
    try {
      // P3 isolation seal: scope by accountId so cross-tenant jobId guesses
      // return 404 instead of leaking stage status / snapshot id.
      const accountId = resolveAccountId(req);
      const jobId = req.params.jobId;
      const status = await getFetchJobStatus(jobId, accountId);

      if (!status) {
        return res.status(404).json({ error: "Job not found" });
      }

      return res.json(status);
    } catch (err: any) {
      console.error("[MIv3-Route] Fetch status error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}
