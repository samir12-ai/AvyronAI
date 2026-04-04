import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { campaignSelections, adSpendEntries, performanceSnapshots, conversionEvents, manualCampaignMetrics, manualRetentionMetrics, iterationGateInputs, retentionGateInputs, strategyMemory, userPublicProfiles, userChannelSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getCampaignMetrics, getRevenueSummary, detectPerformanceSignals, getDashboardMetrics, resolveDataMode, getManualMetrics } from "./campaign-data-layer";

import { resolveAccountId } from "./auth";
const VALID_GOAL_TYPES = ["LEADS", "AWARENESS", "RETARGETING", "SALES", "TESTING"] as const;

export function registerCampaignRoutes(app: Express) {
  app.get("/api/campaigns", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);

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
      const { name, objective, location, platform, notes, dataSourceMode } = req.body;
      const accountId = resolveAccountId(req);
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
      const { campaignId, campaignName, platform, goalType, campaignLocation } = req.body;
      const accountId = resolveAccountId(req);

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
      const accountId = resolveAccountId(req);

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
      const accountId = resolveAccountId(req);

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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
      const dashboardMetrics = await getDashboardMetrics(campaignContext.campaignId, accountId);
      res.json({ success: true, ...dashboardMetrics, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Dashboard] Metrics error:", error);
      res.status(500).json({ code: "DASHBOARD_FAILED", message: "Failed to fetch dashboard metrics", requestId: `dash_${Date.now()}` });
    }
  });

  app.get("/api/dashboard/mode", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
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
      const accountId = resolveAccountId(req);
      const rows = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);
      const metrics = rows[0] || null;
      if (!metrics) {
        return res.json({ success: true, metrics: null, derived: null, message: "No retention metrics entered yet" });
      }
      const derived = computeDerivedRetentionMetrics(metrics);
      res.json({
        success: true,
        metrics,
        derived,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention metrics GET error:", error);
      res.status(500).json({ code: "RETENTION_METRICS_FAILED", message: "Failed to fetch retention metrics" });
    }
  });

  app.put("/api/campaigns/:campaignId/retention-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const { totalCustomers, totalPurchases, returningCustomers, averageOrderValue, refundCount, monthlyCustomers, dataWindowDays } = req.body;

      const tc = totalCustomers !== undefined ? (Number(totalCustomers) || 0) : undefined;
      const tp = totalPurchases !== undefined ? (Number(totalPurchases) || 0) : undefined;
      const rc = returningCustomers !== undefined ? (Number(returningCustomers) || 0) : undefined;
      const aov = averageOrderValue !== undefined ? (Number(averageOrderValue) || 0) : undefined;
      const rfc = refundCount !== undefined ? (Number(refundCount) || 0) : undefined;
      const mc = monthlyCustomers !== undefined ? (Number(monthlyCustomers) || 0) : undefined;
      const dwRaw = dataWindowDays !== undefined ? Number(dataWindowDays) : undefined;
      const dw = dwRaw !== undefined ? ([30, 60, 90].includes(dwRaw) ? dwRaw : 30) : undefined;

      const data: any = { updatedAt: new Date() };
      if (tc !== undefined) data.totalCustomers = tc;
      if (tp !== undefined) data.totalPurchases = tp;
      if (rc !== undefined) data.returningCustomers = rc;
      if (aov !== undefined) data.averageOrderValue = aov;
      if (rfc !== undefined) data.refundCount = rfc;
      if (mc !== undefined) data.monthlyCustomers = mc;
      if (dw !== undefined) data.dataWindowDays = dw;

      const rawDerived = computeDerivedFromRaw(tc || 0, tp || 0, rc || 0, aov || 0, rfc || 0, dw || 30);
      if (rawDerived.repeatPurchaseRate !== null) data.repeatPurchaseRate = rawDerived.repeatPurchaseRate;
      if (rawDerived.refundRate !== null) data.refundRate = rawDerived.refundRate;
      if (rawDerived.purchaseFrequency !== null) data.purchaseFrequency = rawDerived.purchaseFrequency;

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

      const derived = computeDerivedRetentionMetrics(result);

      console.log(`[Campaigns] Retention metrics saved for campaign ${campaignId}: TC=${result.totalCustomers}, RC=${result.returningCustomers}, AOV=${result.averageOrderValue}, RPR=${derived.repeatPurchaseRate}`);

      res.json({
        success: true,
        metrics: result,
        derived,
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
      const accountId = resolveAccountId(req);

      const [existing] = await db.select().from(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ))
        .limit(1);

      const [campaignData] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const missing: string[] = [];
      if (!existing || !existing.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!existing || !existing.primaryKpi) missing.push("Primary KPI for optimization");
      if (!existing || !existing.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");

      const hasMetric = campaignData && (
        (campaignData.spend > 0) ||
        (campaignData.impressions > 0) ||
        (campaignData.clicks > 0) ||
        (campaignData.leads > 0) ||
        (campaignData.revenue > 0) ||
        (campaignData.conversions > 0)
      );
      if (!hasMetric) missing.push("At least one real performance metric in Campaign Metrics (spend, impressions, clicks, leads, or revenue)");

      res.json({
        success: true,
        inputs: existing || null,
        campaignMetrics: campaignData ? {
          spend: campaignData.spend,
          impressions: campaignData.impressions,
          clicks: campaignData.clicks,
          leads: campaignData.leads,
          revenue: campaignData.revenue,
          conversions: campaignData.conversions,
        } : null,
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
      const accountId = resolveAccountId(req);

      const data = {
        hasExistingAsset: !!req.body.hasExistingAsset,
        assetDescription: req.body.assetDescription || null,
        primaryKpi: req.body.primaryKpi || null,
        dataWindowDays: req.body.dataWindowDays ? parseInt(req.body.dataWindowDays) : null,
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

      const [campaignData] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const missing: string[] = [];
      if (!result.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!result.primaryKpi) missing.push("Primary KPI for optimization");
      if (!result.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");
      const hasMetric = campaignData && (
        (campaignData.spend > 0) ||
        (campaignData.impressions > 0) ||
        (campaignData.clicks > 0) ||
        (campaignData.leads > 0) ||
        (campaignData.revenue > 0) ||
        (campaignData.conversions > 0)
      );
      if (!hasMetric) missing.push("At least one real performance metric in Campaign Metrics (spend, impressions, clicks, leads, or revenue)");

      console.log(`[Campaigns] Iteration gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        campaignMetrics: campaignData ? {
          spend: campaignData.spend,
          impressions: campaignData.impressions,
          clicks: campaignData.clicks,
          leads: campaignData.leads,
          revenue: campaignData.revenue,
          conversions: campaignData.conversions,
        } : null,
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
      const accountId = resolveAccountId(req);

      const [existing] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ))
        .limit(1);

      const [retentionData] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      const hasRawData = retentionData && (
        (retentionData.totalCustomers != null && retentionData.totalCustomers > 0) ||
        (retentionData.monthlyCustomers != null && retentionData.monthlyCustomers > 0)
      );

      const missing: string[] = [];
      if (!retentionData || !retentionData.totalCustomers || retentionData.totalCustomers <= 0) {
        missing.push("Total customers acquired (last 30–90 days)");
      }
      if (!retentionData || retentionData.returningCustomers == null) {
        missing.push("Returning customers count");
      }
      if (!retentionData || !retentionData.totalPurchases || retentionData.totalPurchases <= 0) {
        missing.push("Total purchases/orders");
      }
      if (!retentionData || ![30, 60, 90].includes(retentionData.dataWindowDays || 0)) {
        missing.push("Time window selection (30, 60, or 90 days)");
      }
      if (!existing || !existing.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!existing || !existing.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!existing || !existing.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      const derived = retentionData ? computeDerivedRetentionMetrics(retentionData) : null;

      res.json({
        success: true,
        inputs: existing || null,
        retentionMetrics: retentionData ? {
          totalCustomers: retentionData.totalCustomers,
          totalPurchases: retentionData.totalPurchases,
          returningCustomers: retentionData.returningCustomers,
          averageOrderValue: retentionData.averageOrderValue,
          refundCount: retentionData.refundCount,
          monthlyCustomers: retentionData.monthlyCustomers,
          dataWindowDays: retentionData.dataWindowDays,
        } : null,
        derived,
        hasCustomerData: !!hasRawData,
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
      const accountId = resolveAccountId(req);

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

      const [retentionData] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      const hasRawData = retentionData && (
        (retentionData.totalCustomers != null && retentionData.totalCustomers > 0) ||
        (retentionData.monthlyCustomers != null && retentionData.monthlyCustomers > 0)
      );

      const missing: string[] = [];
      if (!retentionData || !retentionData.totalCustomers || retentionData.totalCustomers <= 0) {
        missing.push("Total customers acquired (last 30–90 days)");
      }
      if (!retentionData || retentionData.returningCustomers == null) {
        missing.push("Returning customers count");
      }
      if (!retentionData || !retentionData.totalPurchases || retentionData.totalPurchases <= 0) {
        missing.push("Total purchases/orders");
      }
      if (!retentionData || ![30, 60, 90].includes(retentionData.dataWindowDays || 0)) {
        missing.push("Time window selection (30, 60, or 90 days)");
      }
      if (!result.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!result.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!result.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      const derived = retentionData ? computeDerivedRetentionMetrics(retentionData) : null;

      console.log(`[Campaigns] Retention gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        retentionMetrics: retentionData ? {
          totalCustomers: retentionData.totalCustomers,
          totalPurchases: retentionData.totalPurchases,
          returningCustomers: retentionData.returningCustomers,
          averageOrderValue: retentionData.averageOrderValue,
          refundCount: retentionData.refundCount,
          monthlyCustomers: retentionData.monthlyCustomers,
          dataWindowDays: retentionData.dataWindowDays,
        } : null,
        derived,
        hasCustomerData: !!hasRawData,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention gate PUT error:", error);
      res.status(500).json({ code: "GATE_SAVE_FAILED", message: "Failed to save retention gate inputs" });
    }
  });

  app.get("/api/campaigns/:campaignId/strategy-memory", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const entries = await db
        .select()
        .from(strategyMemory)
        .where(
          and(
            eq(strategyMemory.campaignId, campaignId),
            eq(strategyMemory.accountId, accountId),
          )
        )
        .orderBy(desc(strategyMemory.updatedAt))
        .limit(10);
      res.json({ success: true, entries });
    } catch (error: any) {
      console.error("[Campaigns] Strategy memory GET error:", error);
      res.status(500).json({ code: "STRATEGY_MEMORY_FAILED", message: "Failed to fetch strategy memory" });
    }
  });

  app.get("/api/campaigns/:campaignId/user-channels", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const profiles = await db
        .select()
        .from(userPublicProfiles)
        .where(
          and(
            eq(userPublicProfiles.campaignId, campaignId),
            eq(userPublicProfiles.accountId, accountId),
          )
        );
      res.json({ success: true, profiles });
    } catch (error: any) {
      console.error("[Campaigns] User channels GET error:", error);
      res.status(500).json({ code: "USER_CHANNELS_FAILED", message: "Failed to fetch user channels" });
    }
  });

  app.put("/api/campaigns/:campaignId/user-channels", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const { instagramHandle, websiteUrl } = req.body;

      const channelsToUpsert: { platform: string; handle: string | null; url: string | null }[] = [];

      if (instagramHandle !== undefined) {
        channelsToUpsert.push({
          platform: "instagram",
          handle: instagramHandle ? instagramHandle.replace(/^@/, "").toLowerCase().trim() : null,
          url: null,
        });
      }

      if (websiteUrl !== undefined) {
        channelsToUpsert.push({
          platform: "website",
          handle: null,
          url: websiteUrl ? websiteUrl.trim() : null,
        });
      }

      if (channelsToUpsert.length === 0) {
        return res.status(400).json({ code: "MISSING_CHANNELS", message: "At least one channel (instagramHandle or websiteUrl) is required" });
      }

      const results = [];
      for (const ch of channelsToUpsert) {
        const existing = await db
          .select()
          .from(userPublicProfiles)
          .where(
            and(
              eq(userPublicProfiles.accountId, accountId),
              eq(userPublicProfiles.campaignId, campaignId),
              eq(userPublicProfiles.platform, ch.platform),
            )
          )
          .limit(1);

        if (existing.length > 0) {
          const updated = await db
            .update(userPublicProfiles)
            .set({ handle: ch.handle, url: ch.url, updatedAt: new Date() })
            .where(
              and(
                eq(userPublicProfiles.accountId, accountId),
                eq(userPublicProfiles.campaignId, campaignId),
                eq(userPublicProfiles.platform, ch.platform),
              )
            )
            .returning();
          results.push(updated[0]);
        } else {
          const inserted = await db
            .insert(userPublicProfiles)
            .values({ accountId, campaignId, platform: ch.platform, handle: ch.handle, url: ch.url })
            .returning();
          results.push(inserted[0]);
        }
      }

      console.log(`[Campaigns] User channels saved for campaign ${campaignId}: ${channelsToUpsert.map(c => c.platform).join(", ")}`);
      res.json({ success: true, profiles: results });
    } catch (error: any) {
      console.error("[Campaigns] User channels PUT error:", error);
      res.status(500).json({ code: "USER_CHANNELS_SAVE_FAILED", message: "Failed to save user channels" });
    }
  });

}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDerivedFromRaw(
  totalCustomers: number, totalPurchases: number, returningCustomers: number,
  averageOrderValue: number, refundCount: number, dataWindowDays: number
) {
  const repeatPurchaseRate = totalCustomers > 0 ? clamp(returningCustomers / totalCustomers, 0, 1) : null;
  const purchaseFrequency = totalCustomers > 0 ? totalPurchases / totalCustomers : null;
  const refundRate = totalPurchases > 0 ? clamp(refundCount / totalPurchases, 0, 1) : null;
  return { repeatPurchaseRate, purchaseFrequency, refundRate };
}

function computeDerivedRetentionMetrics(metrics: any) {
  const tc = metrics.totalCustomers || 0;
  const tp = metrics.totalPurchases || 0;
  const rc = metrics.returningCustomers || 0;
  const aov = metrics.averageOrderValue || 0;
  const rfc = metrics.refundCount || 0;
  const dw = metrics.dataWindowDays || 30;
  const mc = metrics.monthlyCustomers || 0;

  const repeatPurchaseRate = tc > 0 ? clamp(rc / tc, 0, 1) : (metrics.repeatPurchaseRate || 0);
  const purchaseFrequency = tc > 0 ? tp / tc : (metrics.purchaseFrequency || 1);
  const refundRate = tp > 0 ? clamp(rfc / tp, 0, 1) : (metrics.refundRate || 0);

  const monthsInWindow = Math.max(dw / 30, 1);
  const annualizedFrequency = purchaseFrequency * (12 / monthsInWindow);
  const estimatedLifespanMonths = repeatPurchaseRate > 0.1 ? Math.round(1 / (1 - repeatPurchaseRate) * monthsInWindow) : 6;
  const estimatedLTV = aov * annualizedFrequency * (estimatedLifespanMonths / 12);

  const churnRiskEstimate = clamp(1 - repeatPurchaseRate + (refundRate * 0.3), 0, 1);

  const retentionStrengthScore = clamp(
    (repeatPurchaseRate * 0.3) +
    ((1 - refundRate) * 0.2) +
    (Math.min(purchaseFrequency / 4, 1) * 0.25) +
    (Math.min(mc / 100, 1) * 0.25),
    0, 1
  );

  return {
    repeatPurchaseRate: Math.round(repeatPurchaseRate * 1000) / 1000,
    purchaseFrequency: Math.round(purchaseFrequency * 100) / 100,
    refundRate: Math.round(refundRate * 1000) / 1000,
    estimatedLTV: Math.round(estimatedLTV * 100) / 100,
    churnRiskEstimate: Math.round(churnRiskEstimate * 1000) / 1000,
    retentionStrengthScore: Math.round(retentionStrengthScore * 1000) / 1000,
    estimatedLifespanMonths,
    dataWindowDays: dw,
  };
}

export async function requireCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const accountId = resolveAccountId(req);

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
