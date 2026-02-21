import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints, blueprintCompetitors, campaignSelections } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

interface CampaignContextObject {
  campaignId: string;
  campaignName: string;
  objective: string;
  location: string | null;
  platform: string;
  isDemo: boolean;
}

const DEMO_CAMPAIGN_CONTEXT: CampaignContextObject = {
  campaignId: "DEMO_CAMPAIGN",
  campaignName: "Demo Campaign (Meta Not Connected)",
  objective: "general_marketing",
  location: null,
  platform: "demo",
  isDemo: true,
};

async function resolveCampaignContext(
  accountId: string,
  campaignId?: string,
  metaConnected?: boolean,
): Promise<{ context: CampaignContextObject | null; error: string | null }> {
  if (metaConnected && campaignId) {
    const [campaign] = await db.select().from(campaignSelections)
      .where(and(
        eq(campaignSelections.selectedCampaignId, campaignId),
        eq(campaignSelections.accountId, accountId),
      )).limit(1);

    if (!campaign) {
      return { context: null, error: "Selected campaign not found. Please select a valid campaign." };
    }

    return {
      context: {
        campaignId: campaign.selectedCampaignId,
        campaignName: campaign.selectedCampaignName,
        objective: campaign.campaignGoalType,
        location: campaign.campaignLocation || null,
        platform: campaign.selectedPlatform || "meta",
        isDemo: false,
      },
      error: null,
    };
  }

  if (metaConnected && !campaignId) {
    return { context: null, error: "Meta is connected — you must select a campaign before building a plan." };
  }

  return { context: DEMO_CAMPAIGN_CONTEXT, error: null };
}

export function registerGateRoutes(app: Express) {
  app.post("/api/strategic/init", async (req: Request, res: Response) => {
    try {
      const {
        accountId = "default",
        campaignId,
        competitorUrls,
        averageSellingPrice,
        metaConnected = false,
      } = req.body;

      if (!competitorUrls || !Array.isArray(competitorUrls) || competitorUrls.length < 2) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "Minimum 2 competitor URLs required. No fallback. No skip.",
          required: 2,
          provided: competitorUrls?.length || 0,
        });
      }

      const validUrls = competitorUrls.filter((u: string) => {
        try { new URL(u); return true; } catch { return false; }
      });
      if (validUrls.length < 2) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "At least 2 valid URLs required.",
          invalidUrls: competitorUrls.filter((u: string) => !validUrls.includes(u)),
        });
      }

      if (averageSellingPrice === undefined || averageSellingPrice === null || averageSellingPrice <= 0) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "averageSellingPrice",
          message: "Average selling price is required and must be a positive number.",
        });
      }

      const { context: campaignContext, error: campaignError } = await resolveCampaignContext(
        accountId, campaignId, metaConnected,
      );
      if (campaignError) {
        return res.status(400).json({
          error: "CAMPAIGN_CONTEXT_REQUIRED",
          message: campaignError,
        });
      }

      const [blueprint] = await db.insert(strategicBlueprints).values({
        accountId,
        campaignId: campaignContext!.campaignId,
        campaignContext: JSON.stringify(campaignContext),
        status: "GATE_PASSED",
        competitorUrls: JSON.stringify(validUrls),
        averageSellingPrice: Number(averageSellingPrice),
        gatePassedAt: new Date(),
      }).returning();

      const competitorInserts = validUrls.map((url: string) => ({
        blueprintId: blueprint.id,
        url,
      }));
      await db.insert(blueprintCompetitors).values(competitorInserts);

      res.json({
        success: true,
        blueprintId: blueprint.id,
        status: blueprint.status,
        competitorCount: validUrls.length,
        averageSellingPrice: blueprint.averageSellingPrice,
        campaignContext,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Gate init error:", error.message);
      res.status(500).json({ error: "Failed to initialize strategic blueprint" });
    }
  });

  app.get("/api/strategic/blueprint/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);

      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      const competitors = await db.select().from(blueprintCompetitors).where(eq(blueprintCompetitors.blueprintId, id));

      res.json({
        success: true,
        blueprint: {
          ...blueprint,
          competitorUrls: blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [],
          campaignContext: blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null,
          draftBlueprint: blueprint.draftBlueprint ? JSON.parse(blueprint.draftBlueprint) : null,
          creativeAnalysis: blueprint.creativeAnalysis ? JSON.parse(blueprint.creativeAnalysis) : null,
          confirmedBlueprint: blueprint.confirmedBlueprint ? JSON.parse(blueprint.confirmedBlueprint) : null,
          marketMap: blueprint.marketMap ? JSON.parse(blueprint.marketMap) : null,
          validationResult: blueprint.validationResult ? JSON.parse(blueprint.validationResult) : null,
          orchestratorPlan: blueprint.orchestratorPlan ? JSON.parse(blueprint.orchestratorPlan) : null,
        },
        competitors,
      });
    } catch (error: any) {
      console.error("[StrategicCore] Blueprint fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch blueprint" });
    }
  });

  app.get("/api/strategic/blueprints", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const blueprints = await db.select().from(strategicBlueprints)
        .where(eq(strategicBlueprints.accountId, accountId))
        .orderBy(desc(strategicBlueprints.createdAt));

      res.json({
        success: true,
        blueprints: blueprints.map(b => ({
          ...b,
          competitorUrls: b.competitorUrls ? JSON.parse(b.competitorUrls) : [],
          campaignContext: b.campaignContext ? JSON.parse(b.campaignContext) : null,
        })),
      });
    } catch (error: any) {
      console.error("[StrategicCore] Blueprints list error:", error.message);
      res.status(500).json({ error: "Failed to list blueprints" });
    }
  });
}
