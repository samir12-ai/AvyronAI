import type { Express, Request, Response } from "express";
import { db } from "../db";
import { campaignSelections, manualCampaignMetrics } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveBenchmark, getBenchmarkMetrics } from "./benchmarks";
import { validateCampaignMetrics, validateDataSourceMode } from "./validation";
import { resolveDataSource } from "./resolver";

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

        const results = metrics.leads + metrics.conversions;
        const cpa = metrics.spend / Math.max(results, 1);
        const validation = validateCampaignMetrics({
          spend: metrics.spend,
          results,
          cpa,
          revenue: metrics.revenue > 0 ? metrics.revenue : undefined,
        });

        if (!validation.valid) {
          return res.status(400).json({
            error: `Campaign metrics validation failed: ${validation.errors.join("; ")}`,
            validation,
          });
        }
      }

      await db.update(campaignSelections)
        .set({ dataSourceMode: mode, updatedAt: new Date() })
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId),
        ));

      console.log(`[DataSource] Mode changed for campaign ${campaignId}: ${mode}`);
      res.json({ success: true, mode });
    } catch (error: any) {
      console.error("[DataSource] Mode update error:", error);
      res.status(500).json({ error: "Failed to update data source mode" });
    }
  });
}
