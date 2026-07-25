import type { Express, Request, Response } from "express";
import { loadMemoryBlock } from "../memory-system/manager";
import { computeExplorationBudget, computeLegacyExplorationBudget } from "./engine";
import { db } from "../db";
import { businessDataLayer, growthCampaigns, strategicPlans } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";

export function registerExplorationBudgetRoutes(app: Express): void {
  app.get("/api/exploration-budget/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req) as string;
      const campaignId = req.params.campaignId as string;

      // W1-T4 (P0-4): all DB queries below filter by (accountId, campaignId)
      // so a foreign campaignId is leak-safe by data-layer scoping. Explicit
      // assert is defense-in-depth: it produces a clean 404 instead of an
      // empty-budget response, and prevents campaign-id enumeration via
      // response-shape probing.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      const [bizSnap] = await db
        .select()
        .from(businessDataLayer)
        .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
        .orderBy(desc(businessDataLayer.createdAt))
        .limit(1);

      const [campaign] = await db
        .select()
        .from(growthCampaigns)
        .where(eq(growthCampaigns.id, campaignId))
        .limit(1);

      const memBlock = await loadMemoryBlock(campaignId, accountId, bizSnap ? {
        funnelObjective: bizSnap.funnelObjective,
        businessType: bizSnap.businessType,
        monthlyBudget: bizSnap.monthlyBudget,
      } : null);

      const [latestPlan] = await db
        .select()
        .from(strategicPlans)
        .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId)))
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (latestPlan?.planJson) {
        try {
          const synthesized = JSON.parse(latestPlan.planJson);
          const explorationBudget = await computeExplorationBudget(
            synthesized,
            memBlock.industryBaseline,
            memBlock,
            campaignId,
            accountId,
            campaign?.explorationBudgetPercent ?? null,
          );
          return res.json({ success: true, explorationBudget, engine: "v2" });
        } catch (newEngineErr: any) {
          console.warn(`[ExplorationBudgetRoutes] New engine failed, falling back to legacy:`, newEngineErr.message);
        }
      }

      const budget = parseInt((bizSnap?.monthlyBudget || "1000").replace(/[^0-9]/g, "")) || 1000;
      const totalWeeklySlots = budget >= 5000 ? 15 : budget >= 2000 ? 12 : budget <= 500 ? 7 : 10;
      const explorationBudget = await computeLegacyExplorationBudget(campaignId, accountId, memBlock, totalWeeklySlots);

      res.json({ success: true, explorationBudget, engine: "legacy" });
    } catch (err: any) {
      console.error(`[ExplorationBudgetRoutes] GET error:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[ExplorationBudget] Routes registered: GET /api/exploration-budget/:campaignId");
}
