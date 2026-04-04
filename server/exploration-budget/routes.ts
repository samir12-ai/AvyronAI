import type { Express, Request, Response } from "express";
import { loadMemoryBlock } from "../memory-system/manager";
import { computeLegacyExplorationBudget } from "./engine";
import { db } from "../db";
import { businessDataLayer } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccountId } from "../auth";

export function registerExplorationBudgetRoutes(app: Express): void {
  app.get("/api/exploration-budget/:campaignId", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req) as string;
      const campaignId = req.params.campaignId as string;

      const [bizSnap] = await db
        .select()
        .from(businessDataLayer)
        .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
        .orderBy(desc(businessDataLayer.createdAt))
        .limit(1);

      const budget = parseInt((bizSnap?.monthlyBudget || "1000").replace(/[^0-9]/g, "")) || 1000;
      const totalWeeklySlots = budget >= 5000 ? 15 : budget >= 2000 ? 12 : budget <= 500 ? 7 : 10;

      const memBlock = await loadMemoryBlock(campaignId, accountId, bizSnap ? {
        funnelObjective: bizSnap.funnelObjective,
        businessType: bizSnap.businessType,
        monthlyBudget: bizSnap.monthlyBudget,
      } : null);

      const explorationBudget = await computeLegacyExplorationBudget(campaignId, accountId, memBlock, totalWeeklySlots);

      res.json({ success: true, explorationBudget });
    } catch (err: any) {
      console.error(`[ExplorationBudgetRoutes] GET error:`, err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[ExplorationBudget] Routes registered: GET /api/exploration-budget/:campaignId");
}
