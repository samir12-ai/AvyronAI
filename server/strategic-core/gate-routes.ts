import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints, blueprintCompetitors, blueprintVersions, campaignSelections } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";

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
  location: "Dubai, UAE",
  platform: "demo",
  isDemo: true,
};

async function resolveCampaignContext(
  accountId: string,
  campaignId?: string,
  metaConnected?: boolean,
  demoLocation?: string,
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

  return {
    context: {
      ...DEMO_CAMPAIGN_CONTEXT,
      location: demoLocation || DEMO_CAMPAIGN_CONTEXT.location,
    },
    error: null,
  };
}

export { resolveCampaignContext, DEMO_CAMPAIGN_CONTEXT };
export type { CampaignContextObject };

export function registerGateRoutes(app: Express) {
  app.post("/api/strategic/init", async (req: Request, res: Response) => {
    try {
      const {
        accountId = "default",
        campaignId,
        competitorUrls,
        averageSellingPrice,
        metaConnected = false,
        demoLocation,
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
        accountId, campaignId, metaConnected, demoLocation,
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
        blueprintVersion: 1,
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

      await logAuditEvent({
        accountId,
        campaignId: campaignContext!.campaignId,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
        event: "GATE_PASSED",
        details: { competitorCount: validUrls.length, averageSellingPrice: Number(averageSellingPrice), isDemo: campaignContext!.isDemo },
      });

      res.json({
        success: true,
        blueprintId: blueprint.id,
        blueprintVersion: 1,
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

      const versions = await db.select().from(blueprintVersions)
        .where(eq(blueprintVersions.blueprintId, id))
        .orderBy(desc(blueprintVersions.version));

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
        versionHistory: versions.map(v => ({
          id: v.id,
          version: v.version,
          previousVersionId: v.previousVersionId,
          createdAt: v.createdAt,
        })),
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

  app.get("/api/strategic/audit-log", async (req: Request, res: Response) => {
    try {
      const { accountId = "default", blueprintId, limit: queryLimit = "50" } = req.query as Record<string, string>;
      const { strategicAuditLogs: auditTable } = await import("@shared/schema");

      let query = db.select().from(auditTable);

      if (blueprintId) {
        query = query.where(eq(auditTable.blueprintId, blueprintId)) as any;
      } else {
        query = query.where(eq(auditTable.accountId, accountId)) as any;
      }

      const logs = await (query as any).orderBy(desc(auditTable.timestamp)).limit(parseInt(queryLimit));

      res.json({
        success: true,
        logs: logs.map((l: any) => ({
          ...l,
          details: l.details ? JSON.parse(l.details) : null,
        })),
      });
    } catch (error: any) {
      console.error("[StrategicCore] Audit log fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });
}
