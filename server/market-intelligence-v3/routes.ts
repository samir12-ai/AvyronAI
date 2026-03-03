import type { Express } from "express";
import { db } from "../db";
import { miSnapshots, miTelemetry, miSignalLogs, miRefreshSchedule } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { MarketIntelligenceV3, validateEngineIsolation, rejectBlockedEngine, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot, buildResultFromSnapshot } from "./engine";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";
import { startFetchJob, getFetchJobStatus } from "./fetch-orchestrator";
import type { MIv3Mode } from "./types";

const ALLOWED_MODES: MIv3Mode[] = ["overview", "dominance", "actions", "history"];

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

      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;
      const mode = (req.body.mode as MIv3Mode) || "overview";
      const forceRefresh = req.body.forceRefresh === true;

      if (!campaignId) {
        return res.status(422).json({ error: "campaignId is required" });
      }

      if (!ALLOWED_MODES.includes(mode)) {
        return res.status(400).json({ error: `Invalid mode: ${mode}. Allowed: ${ALLOWED_MODES.join(", ")}` });
      }

      console.log(`[MIv3-Route] POST /api/ci/mi-v3/analyze | mode=${mode} | accountId=${accountId} | campaignId=${campaignId}`);

      const result = await MarketIntelligenceV3.run(mode, accountId, campaignId, forceRefresh);

      return res.json({
        success: true,
        ...result,
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
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.params.campaignId;

      const snapshots = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, campaignId),
          eq(miSnapshots.status, "COMPLETE"),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);

      if (snapshots.length === 0) {
        return res.json({ snapshot: null, message: "No snapshot available. Run analysis first." });
      }

      const result = buildResultFromSnapshot(snapshots[0]);
      return res.json({ snapshot: snapshots[0], ...result });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ci/mi-v3/refresh", requireCampaign, async (req, res) => {
    try {
      enforceEngineWhitelist(req);
      validateEngineIsolation("MARKET_INTELLIGENCE_V3");

      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;

      if (!campaignId) {
        return res.status(422).json({ error: "campaignId is required" });
      }

      console.log(`[MIv3-Route] POST /api/ci/mi-v3/refresh | manual refresh | campaignId=${campaignId}`);

      const result = await MarketIntelligenceV3.run("overview", accountId, campaignId, true);

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
      const accountId = (req.query.accountId as string) || "default";
      const campaignId = req.params.campaignId;

      const snapshots = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, campaignId),
          eq(miSnapshots.status, "COMPLETE"),
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

  app.post("/api/ci/mi-v3/fetch", requireCampaign, async (req, res) => {
    try {
      enforceEngineWhitelist(req);
      validateEngineIsolation("MARKET_INTELLIGENCE_V3");

      const accountId = (req.body.accountId as string) || "default";
      const campaignId = req.body.campaignId as string;

      if (!campaignId) {
        return res.status(422).json({ error: "campaignId is required" });
      }

      console.log(`[MIv3-Route] POST /api/ci/mi-v3/fetch | accountId=${accountId} | campaignId=${campaignId}`);

      const jobId = await startFetchJob(accountId, campaignId);

      return res.json({ success: true, jobId });
    } catch (err: any) {
      console.error("[MIv3-Route] Fetch job error:", err.message);
      if (err.message.includes("ISOLATION VIOLATION")) {
        return res.status(403).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ci/mi-v3/fetch-status/:jobId", async (req, res) => {
    try {
      const jobId = req.params.jobId;
      const status = await getFetchJobStatus(jobId);

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
