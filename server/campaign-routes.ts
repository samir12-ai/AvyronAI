import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { campaignSelections, adSpendEntries, performanceSnapshots, conversionEvents, manualCampaignMetrics } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getCampaignMetrics, getRevenueSummary, detectPerformanceSignals, getDashboardMetrics, resolveDataMode, getManualMetrics } from "./campaign-data-layer";

const VALID_GOAL_TYPES = ["LEADS", "AWARENESS", "RETARGETING", "SALES", "TESTING"] as const;

export function registerCampaignRoutes(app: Express) {
  app.get("/api/campaigns", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";

      const selections = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .orderBy(desc(campaignSelections.selectedAt));

      const campaigns = selections.map((s) => ({
        id: s.selectedCampaignId,
        name: s.selectedCampaignName,
        platform: s.selectedPlatform || "meta",
        goalType: s.campaignGoalType,
        status: s.campaignStatus || "active",
        location: s.campaignLocation || null,
      }));

      res.json({
        campaigns,
        source: "db",
        message: campaigns.length > 0 ? "Campaigns loaded from database." : "No campaigns found. Select a campaign to get started.",
      });
    } catch (error: any) {
      console.error("[Campaigns] Error fetching campaigns:", error);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.post("/api/campaigns/select", async (req, res) => {
    try {
      const { campaignId, campaignName, platform, goalType, campaignLocation, accountId: reqAccountId } = req.body;
      const accountId = reqAccountId || "default";

      if (!campaignId || !campaignName || !goalType) {
        return res.status(400).json({ error: "campaignId, campaignName, and goalType are required" });
      }

      if (!VALID_GOAL_TYPES.includes(goalType)) {
        return res.status(400).json({
          error: `Invalid goalType. Must be one of: ${VALID_GOAL_TYPES.join(", ")}`,
        });
      }

      const existing = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);

      let selection;
      if (existing.length > 0) {
        const updated = await db
          .update(campaignSelections)
          .set({
            selectedCampaignName: campaignName,
            selectedPlatform: platform || "meta",
            campaignGoalType: goalType,
            campaignStatus: "active",
            campaignLocation: campaignLocation || null,
            selectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaignSelections.accountId, accountId),
              eq(campaignSelections.selectedCampaignId, campaignId)
            )
          )
          .returning();
        selection = updated[0];
      } else {
        const inserted = await db
          .insert(campaignSelections)
          .values({
            accountId,
            selectedCampaignId: campaignId,
            selectedCampaignName: campaignName,
            selectedPlatform: platform || "meta",
            campaignGoalType: goalType,
            campaignStatus: "active",
            campaignLocation: campaignLocation || null,
          })
          .returning();
        selection = inserted[0];
      }

      console.log(`[Campaigns] Campaign selected: ${campaignName} (${goalType}) for account ${accountId}`);

      res.json({
        success: true,
        selection,
      });
    } catch (error: any) {
      console.error("[Campaigns] Error selecting campaign:", error);
      res.status(500).json({ error: "Failed to select campaign" });
    }
  });

  app.get("/api/campaigns/selected", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";

      const selections = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .orderBy(desc(campaignSelections.selectedAt))
        .limit(1);

      if (selections.length === 0) {
        return res.json({
          selected: false,
          selection: null,
          warning: null,
        });
      }

      const selection = selections[0];

      let warning = null;
      const campaignStatus = selection.campaignStatus || "active";

      if (campaignStatus === "paused" || campaignStatus === "removed") {
        warning = {
          type: "CAMPAIGN_INVALID",
          message: `Campaign "${selection.selectedCampaignName}" is now ${campaignStatus}. Please select a different campaign.`,
          campaignStatus,
        };
      }

      res.json({
        selected: true,
        selection,
        warning,
      });
    } catch (error: any) {
      console.error("[Campaigns] Error fetching selection:", error);
      res.status(500).json({ error: "Failed to fetch selected campaign" });
    }
  });

  app.delete("/api/campaigns/selected", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";

      await db
        .delete(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId));

      res.json({ success: true, message: "Campaign selection cleared" });
    } catch (error: any) {
      console.error("[Campaigns] Error clearing selection:", error);
      res.status(500).json({ error: "Failed to clear campaign selection" });
    }
  });

  app.get("/api/dashboard/metrics", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = (req.query.accountId as string) || "default";
      const dashboardMetrics = await getDashboardMetrics(campaignContext.campaignId, accountId);
      res.json({ success: true, ...dashboardMetrics, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Dashboard] Metrics error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard metrics", httpCode: 500 });
    }
  });

  app.get("/api/dashboard/mode", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const mode = await resolveDataMode(accountId);
      res.json({ success: true, mode });
    } catch (error: any) {
      console.error("[Dashboard] Mode check error:", error);
      res.status(500).json({ error: "Failed to check mode" });
    }
  });

  app.get("/api/campaigns/metrics", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = (req.query.accountId as string) || "default";
      const metrics = await getCampaignMetrics(campaignContext.campaignId, accountId);
      res.json({ success: true, metrics, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Campaigns] Metrics error:", error);
      res.status(500).json({ error: "Failed to fetch campaign metrics" });
    }
  });

  app.get("/api/campaigns/signals", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = (req.query.accountId as string) || "default";
      const signals = await detectPerformanceSignals(campaignContext.campaignId, accountId);
      const scaleSignals = signals.filter(s => s.signalType === "SCALE_CANDIDATE");
      const reviewSignals = signals.filter(s => s.signalType === "REVIEW_NEEDED");
      const normalVariation = signals.filter(s => s.signalType === "NORMAL_VARIATION");
      const lowConfidence = signals.filter(s => s.signalType === "LOW_CONFIDENCE");
      const actionable = signals.filter(s => s.signalType === "SCALE_CANDIDATE" || s.signalType === "REVIEW_NEEDED");
      res.json({
        success: true,
        campaign: campaignContext,
        signals,
        summary: {
          totalSignals: signals.length,
          actionableSignals: actionable.length,
          scaleOpportunities: scaleSignals.length,
          reviewNeeded: reviewSignals.length,
          normalVariation: normalVariation.length,
          lowConfidence: lowConfidence.length,
        },
      });
    } catch (error: any) {
      console.error("[Campaigns] Signals error:", error);
      res.status(500).json({ error: "Failed to detect performance signals" });
    }
  });

  app.get("/api/campaigns/revenue-summary", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = (req.query.accountId as string) || "default";
      const summary = await getRevenueSummary(campaignContext.campaignId, accountId);
      res.json({ success: true, summary, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Campaigns] Revenue summary error:", error);
      res.status(500).json({ error: "Failed to fetch revenue summary" });
    }
  });

  app.get("/api/campaigns/:campaignId/manual-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const metrics = await getManualMetrics(campaignId, accountId);
      if (!metrics) {
        return res.json({ success: true, metrics: null, message: "No manual metrics entered yet" });
      }
      const cpa = metrics.conversions > 0 ? +(metrics.spend / metrics.conversions).toFixed(2) : 0;
      const roas = metrics.spend > 0 ? +(metrics.revenue / metrics.spend).toFixed(2) : 0;
      res.json({
        success: true,
        metrics: { ...metrics, cpa, roas },
      });
    } catch (error: any) {
      console.error("[Campaigns] Manual metrics GET error:", error);
      res.status(500).json({ error: "Failed to fetch manual metrics" });
    }
  });

  app.put("/api/campaigns/:campaignId/manual-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = req.body.accountId || "default";
      const { spend, revenue, leads, conversions, impressions, clicks } = req.body;

      if (spend === undefined && revenue === undefined && leads === undefined && conversions === undefined && impressions === undefined && clicks === undefined) {
        return res.status(400).json({ error: "At least one metric field is required" });
      }

      const existing = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const data = {
        spend: Number(spend) || 0,
        revenue: Number(revenue) || 0,
        leads: Number(leads) || 0,
        conversions: Number(conversions) || 0,
        impressions: Number(impressions) || 0,
        clicks: Number(clicks) || 0,
        updatedAt: new Date(),
      };

      let result;
      if (existing.length > 0) {
        const updated = await db.update(manualCampaignMetrics)
          .set(data)
          .where(and(
            eq(manualCampaignMetrics.campaignId, campaignId),
            eq(manualCampaignMetrics.accountId, accountId)
          ))
          .returning();
        result = updated[0];
      } else {
        const inserted = await db.insert(manualCampaignMetrics)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted[0];
      }

      const cpa = result.conversions > 0 ? +(result.spend / result.conversions).toFixed(2) : 0;
      const roas = result.spend > 0 ? +(result.revenue / result.spend).toFixed(2) : 0;

      console.log(`[Campaigns] Manual metrics saved for campaign ${campaignId}: spend=${result.spend}, revenue=${result.revenue}, conversions=${result.conversions}`);

      res.json({
        success: true,
        metrics: { ...result, cpa, roas },
        message: "Manual campaign metrics saved successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Manual metrics PUT error:", error);
      res.status(500).json({ error: "Failed to save manual metrics" });
    }
  });

}

export async function requireCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const accountId = (req.query.accountId as string) || (req.body?.accountId as string) || "default";

    const requestedCampaignId = (req.query.campaignId as string) || null;

    let selections;
    if (requestedCampaignId) {
      selections = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, requestedCampaignId)
          )
        )
        .limit(1);
    }

    if (!selections || selections.length === 0) {
      selections = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .orderBy(desc(campaignSelections.selectedAt))
        .limit(1);
    }

    if (selections.length === 0) {
      return res.status(400).json({
        error: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign before accessing performance data.",
      });
    }

    const selection = selections[0];

    const campaignStatus = selection.campaignStatus || "active";
    if (campaignStatus === "paused" || campaignStatus === "removed") {
      return res.status(400).json({
        error: "CAMPAIGN_INVALID",
        message: `Campaign "${selection.selectedCampaignName}" is ${campaignStatus}. Please select an active campaign.`,
        campaignStatus,
      });
    }

    const resolvedCampaignId = selection.selectedCampaignId;
    if (!resolvedCampaignId || resolvedCampaignId === "unscoped_legacy") {
      return res.status(400).json({
        error: "CAMPAIGN_INVALID",
        message: "Invalid campaign ID. Please select a valid campaign.",
      });
    }

    (req as any).campaignContext = {
      accountId,
      campaignId: resolvedCampaignId,
      campaignName: selection.selectedCampaignName,
      platform: selection.selectedPlatform,
      goalType: selection.campaignGoalType,
      location: selection.campaignLocation || null,
    };

    next();
  } catch (error: any) {
    console.error("[Campaigns] Middleware error:", error);
    return res.status(500).json({ error: "Failed to validate campaign context" });
  }
}
