import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { campaignSelections } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getCampaignMetrics, getRevenueSummary, detectPerformanceSignals } from "./campaign-data-layer";

const VALID_GOAL_TYPES = ["LEADS", "AWARENESS", "RETARGETING", "SALES", "TESTING"] as const;

const DEMO_CAMPAIGNS = [
  {
    id: "demo_lead_gen_001",
    name: "Lead Generation — Q1 2026",
    platform: "meta",
    goalType: "LEADS",
    status: "active",
    budget: "$2,500/mo",
    startDate: "2026-01-15",
    isDemo: true,
    location: "Dubai, UAE",
  },
  {
    id: "demo_awareness_001",
    name: "Brand Awareness — Spring Launch",
    platform: "meta",
    goalType: "AWARENESS",
    status: "active",
    budget: "$1,800/mo",
    startDate: "2026-02-01",
    isDemo: true,
    location: "Dubai, UAE",
  },
  {
    id: "demo_retargeting_001",
    name: "Website Retargeting — Cart Abandoners",
    platform: "meta",
    goalType: "RETARGETING",
    status: "active",
    budget: "$900/mo",
    startDate: "2026-01-20",
    isDemo: true,
    location: "Dubai, UAE",
  },
  {
    id: "demo_sales_001",
    name: "Product Sales — Catalog Ads",
    platform: "meta",
    goalType: "SALES",
    status: "active",
    budget: "$3,200/mo",
    startDate: "2025-11-01",
    isDemo: true,
    location: "Abu Dhabi, UAE",
  },
  {
    id: "demo_testing_001",
    name: "A/B Testing — Creative Variants",
    platform: "meta",
    goalType: "TESTING",
    status: "active",
    budget: "$500/mo",
    startDate: "2026-02-10",
    isDemo: true,
    location: "Dubai, UAE",
  },
  {
    id: "demo_paused_001",
    name: "Holiday Promo 2025 (Ended)",
    platform: "meta",
    goalType: "SALES",
    status: "paused",
    budget: "$4,000/mo",
    startDate: "2025-12-01",
    isDemo: true,
    location: "Dubai, UAE",
  },
];

function isMetaAdsApiAvailable(): boolean {
  const META_APP_ID = process.env.META_APP_ID || "";
  const META_APP_SECRET = process.env.META_APP_SECRET || "";
  return !!(META_APP_ID && META_APP_SECRET);
}

export function registerCampaignRoutes(app: Express) {
  app.get("/api/campaigns", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "default";

      res.json({
        campaigns: DEMO_CAMPAIGNS,
        source: "demo",
        message: "Demo campaigns loaded. Connect Meta Ads API for real campaign data.",
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

      const campaign = DEMO_CAMPAIGNS.find((c) => c.id === campaignId);
      if (campaign && campaign.status === "paused") {
        return res.status(400).json({
          error: "CAMPAIGN_PAUSED",
          message: "Cannot select a paused campaign. Choose an active campaign.",
        });
      }

      const existing = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .limit(1);

      let selection;
      if (existing.length > 0) {
        const updated = await db
          .update(campaignSelections)
          .set({
            selectedCampaignId: campaignId,
            selectedCampaignName: campaignName,
            selectedPlatform: platform || "meta",
            campaignGoalType: goalType,
            campaignStatus: campaign?.status || "active",
            campaignLocation: campaignLocation || campaign?.location || null,
            selectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(campaignSelections.accountId, accountId))
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
            campaignStatus: campaign?.status || "active",
            campaignLocation: campaignLocation || campaign?.location || null,
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
        .limit(1);

      if (selections.length === 0) {
        return res.json({
          selected: false,
          selection: null,
          warning: null,
        });
      }

      const selection = selections[0];

      const campaign = DEMO_CAMPAIGNS.find((c) => c.id === selection.selectedCampaignId);
      let warning = null;

      if (campaign) {
        if (campaign.status === "paused" || campaign.status === "removed") {
          warning = {
            type: "CAMPAIGN_INVALID",
            message: `Campaign "${selection.selectedCampaignName}" is now ${campaign.status}. Please select a different campaign.`,
            campaignStatus: campaign.status,
          };
        }
      } else if (selection.selectedCampaignId && !selection.selectedCampaignId.startsWith("demo_")) {
        warning = {
          type: "CAMPAIGN_NOT_FOUND",
          message: `Campaign "${selection.selectedCampaignName}" was not found. It may have been removed. Please select a different campaign.`,
          campaignStatus: "removed",
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
      res.json({
        success: true,
        campaign: campaignContext,
        signals,
        summary: {
          totalSignals: signals.length,
          scaleOpportunities: scaleSignals.length,
          reviewNeeded: reviewSignals.length,
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
}

export async function requireCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const accountId = (req.query.accountId as string) || (req.body?.accountId as string) || "default";

    const selections = await db
      .select()
      .from(campaignSelections)
      .where(eq(campaignSelections.accountId, accountId))
      .limit(1);

    if (selections.length === 0) {
      return res.status(400).json({
        error: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign before accessing performance data.",
      });
    }

    const selection = selections[0];

    const campaign = DEMO_CAMPAIGNS.find((c) => c.id === selection.selectedCampaignId);
    if (campaign && (campaign.status === "paused" || campaign.status === "removed")) {
      return res.status(400).json({
        error: "CAMPAIGN_INVALID",
        message: `Campaign "${selection.selectedCampaignName}" is ${campaign.status}. Please select an active campaign.`,
        campaignStatus: campaign.status,
      });
    }

    (req as any).campaignContext = {
      campaignId: selection.selectedCampaignId,
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
