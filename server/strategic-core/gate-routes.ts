import type { Express, Request, Response } from "express";
import { db } from "../db";
import { strategicBlueprints, strategicPlans, blueprintCompetitors, blueprintVersions, campaignSelections, miSnapshots } from "@shared/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { verifySnapshotIntegrity, getEngineReadinessState } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION } from "../market-intelligence-v3/constants";
import { generateBlueprintForId } from "./extraction-routes";

interface CampaignContextObject {
  campaignId: string;
  campaignName: string;
  objective: string;
  location: string | null;
  platform: string;
}

async function resolveCampaignContext(
  accountId: string,
  campaignId?: string,
  metaConnected?: boolean,
): Promise<{ context: CampaignContextObject | null; error: string | null }> {
  if (campaignId) {
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
      },
      error: null,
    };
  }

  const [selectedCampaign] = await db.select().from(campaignSelections)
    .where(eq(campaignSelections.accountId, accountId))
    .limit(1);

  if (selectedCampaign) {
    return {
      context: {
        campaignId: selectedCampaign.selectedCampaignId,
        campaignName: selectedCampaign.selectedCampaignName,
        objective: selectedCampaign.campaignGoalType,
        location: selectedCampaign.campaignLocation || null,
        platform: selectedCampaign.selectedPlatform || "meta",
      },
      error: null,
    };
  }

  return { context: null, error: "No campaign selected. Please select a campaign before building a plan." };
}

export { resolveCampaignContext };
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
      } = req.body;

      if (!competitorUrls || !Array.isArray(competitorUrls) || competitorUrls.length < 1) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "At least 1 competitor is required. Add competitors in Competitor Intelligence first.",
          required: 1,
          provided: competitorUrls?.length || 0,
        });
      }

      const validUrls = competitorUrls.filter((u: string) => {
        try { new URL(u); return true; } catch { return u.trim().length > 0; }
      });
      if (validUrls.length < 1) {
        return res.status(400).json({
          error: "GATE_FAILED",
          field: "competitorUrls",
          message: "At least 1 valid competitor link required.",
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

      const resolvedCampaignId = campaignContext!.campaignId;
      const [latestMiSnapshot] = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, resolvedCampaignId),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);

      const miReadiness = getEngineReadinessState(
        latestMiSnapshot || null,
        resolvedCampaignId,
        ENGINE_VERSION,
        14,
      );

      console.log(`[StrategicGate] MI Gate Diagnostics | snapshotFound=${miReadiness.diagnostics.snapshotFound} | freshnessDays=${miReadiness.diagnostics.freshnessDays ?? 'N/A'} | freshnessValid=${miReadiness.diagnostics.freshnessValid} | integrityValid=${miReadiness.diagnostics.integrityValid} | campaignMatch=${miReadiness.diagnostics.campaignIdMatch} | engineState=${miReadiness.state} | campaign=${resolvedCampaignId}`);

      if (miReadiness.state !== "READY") {
        return res.status(400).json({
          error: "MI_NOT_READY",
          field: "marketIntelligence",
          message: "Market Intelligence must be run before building a plan. Go to Intelligence tab and run analysis first.",
          engineState: miReadiness.state,
          diagnostics: miReadiness.diagnostics,
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
        details: { competitorCount: validUrls.length, averageSellingPrice: Number(averageSellingPrice) },
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
      let [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);

      if (!blueprint) {
        return res.status(404).json({ error: "Blueprint not found" });
      }

      if (blueprint.status === "EXTRACTION_FALLBACK" || blueprint.status === "GATE_PASSED") {
        console.log(`[StrategicCore] Blueprint ${id} has status ${blueprint.status} — auto-generating`);
        try {
          const genResult = await generateBlueprintForId(id);
          if (genResult.success) {
            console.log(`[StrategicCore] Auto-generation succeeded for ${id} — status now ${genResult.status}`);
            const [refreshed] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, id)).limit(1);
            if (refreshed) blueprint = refreshed;
          } else {
            console.warn(`[StrategicCore] Auto-generation failed for ${id}: ${genResult.error}`);
          }
        } catch (genErr: any) {
          console.warn(`[StrategicCore] Auto-generation error for ${id}: ${genErr.message}`);
        }
      }

      const competitors = await db.select().from(blueprintCompetitors).where(eq(blueprintCompetitors.blueprintId, id));

      const versions = await db.select().from(blueprintVersions)
        .where(eq(blueprintVersions.blueprintId, id))
        .orderBy(desc(blueprintVersions.version));

      let planId: string | null = null;
      let planStatus: string | null = null;
      if (blueprint.status === "ORCHESTRATED") {
        const plans = await db.select({ id: strategicPlans.id, status: strategicPlans.status })
          .from(strategicPlans)
          .where(and(
            eq(strategicPlans.blueprintId, id),
            eq(strategicPlans.accountId, blueprint.accountId),
            ne(strategicPlans.status, "SUPERSEDED"),
          ))
          .orderBy(desc(strategicPlans.createdAt))
          .limit(1);
        if (plans.length > 0) {
          planId = plans[0].id;
          planStatus = plans[0].status;
        }
      }

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
          planId,
          planStatus,
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

  app.get("/api/strategic/blueprint-versions", async (req: Request, res: Response) => {
    try {
      const { campaignId, blueprintId, accountId = "default" } = req.query as Record<string, string>;

      if (!campaignId && !blueprintId) {
        return res.status(400).json({ error: "Provide campaignId or blueprintId" });
      }

      let targetBlueprintIds: string[] = [];

      if (blueprintId) {
        targetBlueprintIds = [blueprintId];
      } else {
        const blueprints = await db.select({ id: strategicBlueprints.id })
          .from(strategicBlueprints)
          .where(and(
            eq(strategicBlueprints.campaignId, campaignId),
            eq(strategicBlueprints.accountId, accountId),
          ));
        targetBlueprintIds = blueprints.map(b => b.id);
      }

      if (targetBlueprintIds.length === 0) {
        return res.json({ success: true, timeline: [] });
      }

      const { strategicAuditLogs: auditTable } = await import("@shared/schema");

      const timeline: any[] = [];

      for (const bpId of targetBlueprintIds) {
        const versions = await db.select().from(blueprintVersions)
          .where(eq(blueprintVersions.blueprintId, bpId))
          .orderBy(desc(blueprintVersions.version));

        const [currentBlueprint] = await db.select().from(strategicBlueprints)
          .where(eq(strategicBlueprints.id, bpId)).limit(1);

        const confirmEvents = await db.select().from(auditTable)
          .where(and(
            eq(auditTable.blueprintId, bpId),
            eq(auditTable.event, "BLUEPRINT_CONFIRMED"),
          ))
          .orderBy(desc(auditTable.timestamp)) as any[];

        const editEvents = await db.select().from(auditTable)
          .where(and(
            eq(auditTable.blueprintId, bpId),
            eq(auditTable.event, "FIELD_EDITED"),
          ))
          .orderBy(desc(auditTable.timestamp)) as any[];

        const currentVersion = currentBlueprint?.blueprintVersion || 1;

        const currentEntry: any = {
          blueprintId: bpId,
          version: currentVersion,
          isCurrent: true,
          createdAt: currentBlueprint?.updatedAt || currentBlueprint?.createdAt,
          confirmedAt: currentBlueprint?.confirmedAt || null,
          status: currentBlueprint?.status,
          changedFields: [],
        };

        const currentVersionEdits = editEvents
          .filter((e: any) => e.blueprintVersion === currentVersion)
          .map((e: any) => {
            const details = e.details ? JSON.parse(e.details) : {};
            return { field: details.field, previousValue: details.previousValue, newValue: details.newValue, timestamp: e.timestamp };
          });
        currentEntry.changedFields = currentVersionEdits;

        timeline.push(currentEntry);

        for (const snapshot of versions) {
          const snapshotEdits = editEvents
            .filter((e: any) => e.blueprintVersion === snapshot.version)
            .map((e: any) => {
              const details = e.details ? JSON.parse(e.details) : {};
              return { field: details.field, previousValue: details.previousValue, newValue: details.newValue, timestamp: e.timestamp };
            });

          const confirmEvent = confirmEvents.find((e: any) => e.blueprintVersion === snapshot.version);

          timeline.push({
            blueprintId: bpId,
            version: snapshot.version,
            isCurrent: false,
            snapshotId: snapshot.id,
            createdAt: snapshot.createdAt,
            confirmedBy: confirmEvent ? "user" : null,
            confirmedAt: confirmEvent?.timestamp || null,
            changedFields: snapshotEdits,
          });
        }
      }

      timeline.sort((a, b) => b.version - a.version);

      res.json({ success: true, timeline });
    } catch (error: any) {
      console.error("[StrategicCore] Version timeline error:", error.message);
      res.status(500).json({ error: "Failed to fetch version timeline" });
    }
  });

  app.get("/api/strategic/field-diffs", async (req: Request, res: Response) => {
    try {
      const { blueprintId, campaignId, accountId = "default", limit: queryLimit = "100" } = req.query as Record<string, string>;

      if (!blueprintId && !campaignId) {
        return res.status(400).json({ error: "Provide blueprintId or campaignId" });
      }

      const { strategicAuditLogs: auditTable } = await import("@shared/schema");

      let targetBlueprintIds: string[] = [];

      if (blueprintId) {
        targetBlueprintIds = [blueprintId];
      } else {
        const blueprints = await db.select({ id: strategicBlueprints.id })
          .from(strategicBlueprints)
          .where(and(
            eq(strategicBlueprints.campaignId, campaignId),
            eq(strategicBlueprints.accountId, accountId),
          ));
        targetBlueprintIds = blueprints.map(b => b.id);
      }

      if (targetBlueprintIds.length === 0) {
        return res.json({ success: true, diffs: [] });
      }

      const allDiffs: any[] = [];

      for (const bpId of targetBlueprintIds) {
        const editLogs = await db.select().from(auditTable)
          .where(and(
            eq(auditTable.blueprintId, bpId),
            eq(auditTable.event, "FIELD_EDITED"),
          ))
          .orderBy(desc(auditTable.timestamp))
          .limit(parseInt(queryLimit)) as any[];

        for (const log of editLogs) {
          const details = log.details ? JSON.parse(log.details) : {};
          allDiffs.push({
            blueprintId: bpId,
            campaignId: log.campaignId,
            blueprintVersion: log.blueprintVersion,
            field: details.field,
            previousValue: details.previousValue,
            newValue: details.newValue,
            timestamp: log.timestamp,
            accountId: log.accountId,
          });
        }
      }

      allDiffs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({ success: true, diffs: allDiffs.slice(0, parseInt(queryLimit)) });
    } catch (error: any) {
      console.error("[StrategicCore] Field diffs error:", error.message);
      res.status(500).json({ error: "Failed to fetch field diffs" });
    }
  });
}
