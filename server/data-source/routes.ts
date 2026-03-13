import type { Express, Request, Response } from "express";
import { db } from "../db";
import { campaignSelections, manualCampaignMetrics } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveBenchmark, getBenchmarkMetrics, getAllBenchmarks } from "./benchmarks";
import { validateCampaignMetrics, validateDataSourceMode } from "./validation";
import { resolveDataSource } from "./resolver";
import { evaluateTransitionEligibility, assessStatisticalValidity, TRANSITION_THRESHOLDS } from "./statistical-validity";
import { logModeTransition, getTransitionLog, getLatestTransition } from "./transition-log";

export function registerDataSourceRoutes(app: Express) {
  app.get("/api/data-source/resolve", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const resolved = await resolveDataSource(campaignId, accountId);
      res.json({ success: true, dataSource: resolved });
    } catch (error: any) {
      console.error("[DataSource] Resolve error:", error);
      res.status(500).json({ error: "Failed to resolve data source" });
    }
  });

  app.get("/api/data-source/benchmarks/all", async (_req: Request, res: Response) => {
    try {
      const benchmarks = getAllBenchmarks();
      res.json({ success: true, benchmarks });
    } catch (error: any) {
      console.error("[DataSource] All benchmarks error:", error);
      res.status(500).json({ error: "Failed to fetch all benchmarks" });
    }
  });

  app.get("/api/data-source/benchmarks", async (req: Request, res: Response) => {
    try {
      const location = (req.query.location as string) || "global";
      const platform = (req.query.platform as string) || "meta";

      const benchmark = resolveBenchmark(location, platform);
      const metrics = getBenchmarkMetrics(benchmark);

      res.json({ success: true, benchmark, metrics });
    } catch (error: any) {
      console.error("[DataSource] Benchmark error:", error);
      res.status(500).json({ error: "Failed to fetch benchmarks" });
    }
  });

  app.post("/api/data-source/validate-metrics", async (req: Request, res: Response) => {
    try {
      const { spend, results, cpa, revenue, channelSource } = req.body;

      if (spend === undefined || results === undefined || cpa === undefined) {
        return res.status(400).json({ error: "spend, results, and cpa are required" });
      }

      const validation = validateCampaignMetrics({ spend, results, cpa, revenue, channelSource });
      res.json({ success: true, validation });
    } catch (error: any) {
      console.error("[DataSource] Validation error:", error);
      res.status(500).json({ error: "Failed to validate metrics" });
    }
  });

  app.get("/api/data-source/transition-eligibility", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [selection] = await db.select().from(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId),
        ))
        .limit(1);

      const currentMode = (selection?.dataSourceMode as "benchmark" | "campaign_metrics") || "benchmark";

      const [metrics] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId),
        ))
        .orderBy(desc(manualCampaignMetrics.updatedAt))
        .limit(1);

      const conversions = metrics ? (metrics.leads + metrics.conversions) : 0;
      const spend = metrics?.spend ?? 0;
      const revenue = metrics?.revenue ?? 0;

      const eligibility = evaluateTransitionEligibility(currentMode, conversions, spend, revenue);
      const latestTransition = await getLatestTransition(campaignId, accountId);

      res.json({
        success: true,
        eligibility,
        thresholds: TRANSITION_THRESHOLDS,
        latestTransition,
      });
    } catch (error: any) {
      console.error("[DataSource] Transition eligibility error:", error);
      res.status(500).json({ error: "Failed to evaluate transition eligibility" });
    }
  });

  app.get("/api/data-source/transition-log", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;

      const accountId = (req.query.accountId as string) || "default";
      const log = await getTransitionLog(campaignId, accountId, limit);
      res.json({ success: true, transitions: log, count: log.length });
    } catch (error: any) {
      console.error("[DataSource] Transition log error:", error);
      res.status(500).json({ error: "Failed to fetch transition log" });
    }
  });

  app.put("/api/data-source/mode", async (req: Request, res: Response) => {
    try {
      const { campaignId, mode, accountId: reqAccountId } = req.body;
      const accountId = reqAccountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      if (!validateDataSourceMode(mode)) {
        return res.status(400).json({ error: "mode must be 'campaign_metrics' or 'benchmark'" });
      }

      const [selection] = await db.select().from(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId),
        ))
        .limit(1);

      const previousMode = (selection?.dataSourceMode as "benchmark" | "campaign_metrics") || "benchmark";

      if (mode === "campaign_metrics") {
        const [metrics] = await db.select().from(manualCampaignMetrics)
          .where(and(
            eq(manualCampaignMetrics.campaignId, campaignId),
            eq(manualCampaignMetrics.accountId, accountId),
          ))
          .orderBy(desc(manualCampaignMetrics.updatedAt))
          .limit(1);

        if (!metrics || metrics.spend <= 0 || (metrics.leads + metrics.conversions) <= 0) {
          return res.status(400).json({
            error: "Cannot activate Campaign Metrics mode — insufficient campaign data. Please enter spend and results first.",
          });
        }

        const conversions = metrics.leads + metrics.conversions;
        const cpa = metrics.spend / Math.max(conversions, 1);
        const validation = validateCampaignMetrics({
          spend: metrics.spend,
          results: conversions,
          cpa,
          revenue: metrics.revenue > 0 ? metrics.revenue : undefined,
        });

        if (!validation.valid) {
          return res.status(400).json({
            error: `Campaign metrics validation failed: ${validation.errors.join("; ")}`,
            validation,
          });
        }

        const eligibility = evaluateTransitionEligibility(
          previousMode,
          conversions,
          metrics.spend,
          metrics.revenue ?? 0,
        );

        if (previousMode === "benchmark" && !eligibility.eligible) {
          return res.status(400).json({
            error: `Cannot switch to Campaign Metrics mode — statistical thresholds not met. ${eligibility.blockReasons.join("; ")}`,
            eligibility,
            thresholds: TRANSITION_THRESHOLDS,
          });
        }

        const statisticalValidity = assessStatisticalValidity(conversions, metrics.spend, metrics.revenue ?? 0);
        await logModeTransition({
          timestamp: new Date().toISOString(),
          campaignId,
          accountId,
          previousMode,
          newMode: mode,
          transitionReason: `Manual mode switch — statistical evidence: conversions=${conversions}, spend=$${metrics.spend.toFixed(2)}`,
          statisticalEvidence: statisticalValidity,
          triggeredBy: "manual",
        });
      } else if (previousMode !== mode) {
        const [metrics] = await db.select().from(manualCampaignMetrics)
          .where(and(
            eq(manualCampaignMetrics.campaignId, campaignId),
            eq(manualCampaignMetrics.accountId, accountId),
          ))
          .orderBy(desc(manualCampaignMetrics.updatedAt))
          .limit(1);

        const conversions = metrics ? (metrics.leads + metrics.conversions) : 0;
        const spend = metrics?.spend ?? 0;
        const revenue = metrics?.revenue ?? 0;

        await logModeTransition({
          timestamp: new Date().toISOString(),
          campaignId,
          accountId,
          previousMode,
          newMode: mode,
          transitionReason: "Manual mode switch to benchmark",
          statisticalEvidence: assessStatisticalValidity(conversions, spend, revenue),
          triggeredBy: "manual",
        });
      }

      await db.update(campaignSelections)
        .set({ dataSourceMode: mode, updatedAt: new Date() })
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId),
        ));

      console.log(`[DataSource] Mode changed for campaign ${campaignId}: ${previousMode} → ${mode}`);
      res.json({ success: true, mode, previousMode });
    } catch (error: any) {
      console.error("[DataSource] Mode update error:", error);
      res.status(500).json({ error: "Failed to update data source mode" });
    }
  });

  app.get("/api/data-source/statistical-validity", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req.query.accountId as string) || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const [metrics] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId),
        ))
        .orderBy(desc(manualCampaignMetrics.updatedAt))
        .limit(1);

      const conversions = metrics ? (metrics.leads + metrics.conversions) : 0;
      const spend = metrics?.spend ?? 0;
      const revenue = metrics?.revenue ?? 0;

      const validity = assessStatisticalValidity(conversions, spend, revenue);
      res.json({ success: true, validity, thresholds: TRANSITION_THRESHOLDS });
    } catch (error: any) {
      console.error("[DataSource] Statistical validity error:", error);
      res.status(500).json({ error: "Failed to assess statistical validity" });
    }
  });
}
