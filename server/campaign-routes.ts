import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { campaignSelections, adSpendEntries, performanceSnapshots, conversionEvents, manualCampaignMetrics, manualRetentionMetrics, iterationGateInputs, retentionGateInputs } from "@shared/schema";
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
        dataSourceMode: s.dataSourceMode || "benchmark",
      }));

      res.json({
        campaigns,
        source: "db",
        message: campaigns.length > 0 ? "Campaigns loaded from database." : "No campaigns found. Select a campaign to get started.",
      });
    } catch (error: any) {
      console.error("[Campaigns] Error fetching campaigns:", error);
      res.status(500).json({ code: "LIST_FAILED", message: "Failed to fetch campaigns", requestId: `lst_${Date.now()}` });
    }
  });

  app.post("/api/campaigns/create", async (req, res) => {
    try {
      const { name, objective, location, platform, notes, dataSourceMode, accountId: reqAccountId } = req.body;
      const accountId = reqAccountId || "default";
      const requestId = `crt_${Date.now()}`;

      if (!name || !name.trim()) {
        return res.status(400).json({ code: "MISSING_NAME", message: "Campaign name is required", requestId });
      }
      if (!objective) {
        return res.status(400).json({ code: "MISSING_OBJECTIVE", message: "Campaign objective is required", requestId });
      }
      if (!VALID_GOAL_TYPES.includes(objective)) {
        return res.status(400).json({
          code: "INVALID_OBJECTIVE",
          message: `Invalid objective. Must be one of: ${VALID_GOAL_TYPES.join(", ")}`,
          requestId,
        });
      }
      if (!location || !location.trim()) {
        return res.status(400).json({ code: "MISSING_LOCATION", message: "Campaign location is required", requestId });
      }

      const validModes = ["campaign_metrics", "benchmark"];
      const resolvedMode = dataSourceMode && validModes.includes(dataSourceMode) ? dataSourceMode : "benchmark";

      const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const campaignName = name.trim();

      const inserted = await db
        .insert(campaignSelections)
        .values({
          accountId,
          selectedCampaignId: campaignId,
          selectedCampaignName: campaignName,
          selectedPlatform: platform || "meta",
          campaignGoalType: objective,
          campaignStatus: "active",
          campaignLocation: location.trim(),
          dataSourceMode: resolvedMode,
          selectedAt: new Date(),
        })
        .returning();

      const selection = inserted[0];

      console.log(`[Campaigns] Campaign created: ${campaignName} (${objective}) id=${campaignId} account=${accountId}`);

      res.json({
        success: true,
        requestId,
        campaign: {
          id: campaignId,
          name: campaignName,
          platform: platform || "meta",
          goalType: objective,
          status: "active",
          location: location.trim(),
          dataSourceMode: resolvedMode,
        },
        selection,
        message: "Campaign created and auto-selected",
      });
    } catch (error: any) {
      console.error("[Campaigns] Create campaign error:", error);
      res.status(500).json({ code: "CREATE_FAILED", message: "Failed to create campaign", requestId: `crt_err_${Date.now()}` });
    }
  });

  app.post("/api/campaigns/select", async (req, res) => {
    try {
      const { campaignId, campaignName, platform, goalType, campaignLocation, accountId: reqAccountId } = req.body;
      const accountId = reqAccountId || "default";

      const requestId = `sel_${Date.now()}`;
      if (!campaignId || !campaignName || !goalType) {
        return res.status(400).json({ code: "MISSING_FIELDS", message: "campaignId, campaignName, and goalType are required", requestId });
      }

      if (!VALID_GOAL_TYPES.includes(goalType)) {
        return res.status(400).json({
          code: "INVALID_GOAL_TYPE",
          message: `Invalid goalType. Must be one of: ${VALID_GOAL_TYPES.join(", ")}`,
          requestId,
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
      res.status(500).json({ code: "SELECT_FAILED", message: "Failed to select campaign", requestId: `sel_err_${Date.now()}` });
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
      res.status(500).json({ code: "SELECTION_FETCH_FAILED", message: "Failed to fetch selected campaign", requestId: `sel_get_${Date.now()}` });
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
      res.status(500).json({ code: "CLEAR_FAILED", message: "Failed to clear campaign selection", requestId: `clr_${Date.now()}` });
    }
  });

  app.delete("/api/campaigns/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const requestId = `del_${Date.now()}`;

      if (!campaignId) {
        return res.status(400).json({ code: "MISSING_ID", message: "Campaign ID is required", requestId });
      }

      const existing = await db.select().from(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId)
        ))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ code: "NOT_FOUND", message: "Campaign not found", requestId });
      }

      await db.delete(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ));

      await db.delete(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ));

      await db.delete(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ));

      await db.delete(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ));

      await db.delete(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId)
        ));

      console.log(`[Campaigns] Campaign deleted: ${campaignId} account=${accountId}`);

      res.json({
        success: true,
        requestId,
        deletedCampaignId: campaignId,
        message: "Campaign deleted successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Delete campaign error:", error);
      res.status(500).json({ code: "DELETE_FAILED", message: "Failed to delete campaign", requestId: `del_err_${Date.now()}` });
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
      res.status(500).json({ code: "DASHBOARD_FAILED", message: "Failed to fetch dashboard metrics", requestId: `dash_${Date.now()}` });
    }
  });

  app.get("/api/dashboard/mode", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const mode = await resolveDataMode(accountId);
      res.json({ success: true, mode });
    } catch (error: any) {
      console.error("[Dashboard] Mode check error:", error);
      res.status(500).json({ code: "MODE_CHECK_FAILED", message: "Failed to check mode", requestId: `mode_${Date.now()}` });
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
      res.status(500).json({ code: "METRICS_FAILED", message: "Failed to fetch campaign metrics", requestId: `met_${Date.now()}` });
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
      res.status(500).json({ code: "SIGNALS_FAILED", message: "Failed to detect performance signals", requestId: `sig_${Date.now()}` });
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
      res.status(500).json({ code: "REVENUE_FAILED", message: "Failed to fetch revenue summary", requestId: `rev_${Date.now()}` });
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
      res.status(500).json({ code: "MANUAL_METRICS_FAILED", message: "Failed to fetch manual metrics", requestId: `mm_get_${Date.now()}` });
    }
  });

  app.put("/api/campaigns/:campaignId/manual-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = req.body.accountId || "default";
      const { spend, revenue, leads, conversions, impressions, clicks } = req.body;

      if (spend === undefined && revenue === undefined && leads === undefined && conversions === undefined && impressions === undefined && clicks === undefined) {
        return res.status(400).json({ code: "MISSING_METRICS", message: "At least one metric field is required", requestId: `mm_${Date.now()}` });
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
      res.status(500).json({ code: "MANUAL_METRICS_SAVE_FAILED", message: "Failed to save manual metrics", requestId: `mm_put_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/:campaignId/retention-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";
      const rows = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);
      const metrics = rows[0] || null;
      if (!metrics) {
        return res.json({ success: true, metrics: null, message: "No retention metrics entered yet" });
      }
      const estimatedLTV = (metrics.averageOrderValue || 0) * (metrics.purchaseFrequency || 1) * (metrics.customerLifespan || 1);
      const churnRisk = metrics.repeatPurchaseRate != null ? clamp(1 - metrics.repeatPurchaseRate, 0, 1) : 0.5;
      const retentionStrength = clamp(
        ((metrics.repeatPurchaseRate || 0) * 0.3) +
        ((1 - (metrics.refundRate || 0)) * 0.2) +
        (Math.min((metrics.purchaseFrequency || 0) / 4, 1) * 0.25) +
        (Math.min((metrics.monthlyCustomers || 0) / 100, 1) * 0.25),
        0, 1
      );
      res.json({
        success: true,
        metrics: { ...metrics, derived: { estimatedLTV, churnRisk, retentionStrength } },
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention metrics GET error:", error);
      res.status(500).json({ code: "RETENTION_METRICS_FAILED", message: "Failed to fetch retention metrics" });
    }
  });

  app.put("/api/campaigns/:campaignId/retention-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = req.body.accountId || "default";
      const { repeatPurchaseRate, averageOrderValue, customerLifespan, refundRate, purchaseFrequency, monthlyCustomers } = req.body;

      const data: any = { updatedAt: new Date() };
      if (repeatPurchaseRate !== undefined) data.repeatPurchaseRate = Number(repeatPurchaseRate) || 0;
      if (averageOrderValue !== undefined) data.averageOrderValue = Number(averageOrderValue) || 0;
      if (customerLifespan !== undefined) data.customerLifespan = Number(customerLifespan) || 0;
      if (refundRate !== undefined) data.refundRate = Number(refundRate) || 0;
      if (purchaseFrequency !== undefined) data.purchaseFrequency = Number(purchaseFrequency) || 0;
      if (monthlyCustomers !== undefined) data.monthlyCustomers = Number(monthlyCustomers) || 0;

      const existing = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing.length > 0) {
        const updated = await db.update(manualRetentionMetrics)
          .set(data)
          .where(and(
            eq(manualRetentionMetrics.campaignId, campaignId),
            eq(manualRetentionMetrics.accountId, accountId)
          ))
          .returning();
        result = updated[0];
      } else {
        const inserted = await db.insert(manualRetentionMetrics)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted[0];
      }

      const estimatedLTV = (result.averageOrderValue || 0) * (result.purchaseFrequency || 1) * (result.customerLifespan || 1);
      const churnRisk = result.repeatPurchaseRate != null ? clamp(1 - result.repeatPurchaseRate, 0, 1) : 0.5;
      const retentionStrength = clamp(
        ((result.repeatPurchaseRate || 0) * 0.3) +
        ((1 - (result.refundRate || 0)) * 0.2) +
        (Math.min((result.purchaseFrequency || 0) / 4, 1) * 0.25) +
        (Math.min((result.monthlyCustomers || 0) / 100, 1) * 0.25),
        0, 1
      );

      console.log(`[Campaigns] Retention metrics saved for campaign ${campaignId}: RPR=${result.repeatPurchaseRate}, AOV=${result.averageOrderValue}`);

      res.json({
        success: true,
        metrics: { ...result, derived: { estimatedLTV, churnRisk, retentionStrength } },
        message: "Retention metrics saved successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention metrics PUT error:", error);
      res.status(500).json({ code: "RETENTION_METRICS_SAVE_FAILED", message: "Failed to save retention metrics" });
    }
  });

  app.get("/api/campaigns/:campaignId/iteration-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const [existing] = await db.select().from(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ))
        .limit(1);

      if (!existing) {
        return res.json({ success: true, inputs: null, gateStatus: "locked" });
      }

      const missing: string[] = [];
      if (!existing.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!existing.primaryKpi) missing.push("Primary KPI for optimization");
      if (!existing.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");
      const hasMetric = (existing.spend != null && existing.spend > 0) ||
        (existing.impressions != null && existing.impressions > 0) ||
        (existing.clicks != null && existing.clicks > 0) ||
        (existing.leads != null && existing.leads > 0) ||
        (existing.purchases != null && existing.purchases > 0) ||
        (existing.revenue != null && existing.revenue > 0);
      if (!hasMetric) missing.push("At least one real performance metric (spend, impressions, clicks, leads, purchases, or revenue)");

      res.json({
        success: true,
        inputs: existing,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Iteration gate GET error:", error);
      res.status(500).json({ code: "GATE_FETCH_FAILED", message: "Failed to fetch iteration gate inputs" });
    }
  });

  app.put("/api/campaigns/:campaignId/iteration-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const data = {
        hasExistingAsset: !!req.body.hasExistingAsset,
        assetDescription: req.body.assetDescription || null,
        primaryKpi: req.body.primaryKpi || null,
        dataWindowDays: req.body.dataWindowDays ? parseInt(req.body.dataWindowDays) : null,
        spend: req.body.spend != null ? parseFloat(req.body.spend) : null,
        impressions: req.body.impressions != null ? parseInt(req.body.impressions) : null,
        clicks: req.body.clicks != null ? parseInt(req.body.clicks) : null,
        leads: req.body.leads != null ? parseInt(req.body.leads) : null,
        purchases: req.body.purchases != null ? parseInt(req.body.purchases) : null,
        revenue: req.body.revenue != null ? parseFloat(req.body.revenue) : null,
        updatedAt: new Date(),
      };

      const [existing] = await db.select().from(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing) {
        const [updated] = await db.update(iterationGateInputs)
          .set(data)
          .where(and(
            eq(iterationGateInputs.campaignId, campaignId),
            eq(iterationGateInputs.accountId, accountId)
          ))
          .returning();
        result = updated;
      } else {
        const [inserted] = await db.insert(iterationGateInputs)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted;
      }

      const missing: string[] = [];
      if (!result.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!result.primaryKpi) missing.push("Primary KPI for optimization");
      if (!result.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");
      const hasMetric = (result.spend != null && result.spend > 0) ||
        (result.impressions != null && result.impressions > 0) ||
        (result.clicks != null && result.clicks > 0) ||
        (result.leads != null && result.leads > 0) ||
        (result.purchases != null && result.purchases > 0) ||
        (result.revenue != null && result.revenue > 0);
      if (!hasMetric) missing.push("At least one real performance metric (spend, impressions, clicks, leads, purchases, or revenue)");

      console.log(`[Campaigns] Iteration gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Iteration gate PUT error:", error);
      res.status(500).json({ code: "GATE_SAVE_FAILED", message: "Failed to save iteration gate inputs" });
    }
  });

  app.get("/api/campaigns/:campaignId/retention-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.query.accountId as string) || "default";

      const [existing] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ))
        .limit(1);

      if (!existing) {
        return res.json({ success: true, inputs: null, gateStatus: "locked" });
      }

      const missing: string[] = [];
      if (!existing.hasExistingCustomers) missing.push("Confirmation that the business has existing or past customers");
      if (!existing.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!existing.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!existing.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      res.json({
        success: true,
        inputs: existing,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention gate GET error:", error);
      res.status(500).json({ code: "GATE_FETCH_FAILED", message: "Failed to fetch retention gate inputs" });
    }
  });

  app.put("/api/campaigns/:campaignId/retention-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = (req.body.accountId as string) || "default";

      const data = {
        hasExistingCustomers: !!req.body.hasExistingCustomers,
        retentionGoal: req.body.retentionGoal || null,
        businessModel: req.body.businessModel || null,
        reachableAudience: req.body.reachableAudience || null,
        updatedAt: new Date(),
      };

      const [existing] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing) {
        const [updated] = await db.update(retentionGateInputs)
          .set(data)
          .where(and(
            eq(retentionGateInputs.campaignId, campaignId),
            eq(retentionGateInputs.accountId, accountId)
          ))
          .returning();
        result = updated;
      } else {
        const [inserted] = await db.insert(retentionGateInputs)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted;
      }

      const missing: string[] = [];
      if (!result.hasExistingCustomers) missing.push("Confirmation that the business has existing or past customers");
      if (!result.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!result.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!result.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      console.log(`[Campaigns] Retention gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention gate PUT error:", error);
      res.status(500).json({ code: "GATE_SAVE_FAILED", message: "Failed to save retention gate inputs" });
    }
  });

}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
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
        code: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign before accessing performance data.",
        requestId: `mw_${Date.now()}`,
      });
    }

    const selection = selections[0];

    const campaignStatus = selection.campaignStatus || "active";
    if (campaignStatus === "paused" || campaignStatus === "removed") {
      return res.status(400).json({
        code: "CAMPAIGN_INVALID",
        message: `Campaign "${selection.selectedCampaignName}" is ${campaignStatus}. Please select an active campaign.`,
        campaignStatus,
        requestId: `mw_${Date.now()}`,
      });
    }

    const resolvedCampaignId = selection.selectedCampaignId;
    if (!resolvedCampaignId || resolvedCampaignId === "unscoped_legacy") {
      return res.status(400).json({
        code: "CAMPAIGN_INVALID",
        message: "Invalid campaign ID. Please select a valid campaign.",
        requestId: `mw_${Date.now()}`,
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
    return res.status(500).json({ code: "MIDDLEWARE_FAILED", message: "Failed to validate campaign context", requestId: `mw_err_${Date.now()}` });
  }
}
