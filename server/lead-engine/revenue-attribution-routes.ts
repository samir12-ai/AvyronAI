import type { Express } from "express";
import { db } from "../db";
import { revenueEntries, adSpendEntries, leads, conversionEvents } from "@shared/schema";
import { eq, desc, sql, gte } from "drizzle-orm";
import { featureFlagService } from "../feature-flags";
import { logAudit } from "../audit";
import { requireCampaign } from "../campaign-routes";

export function registerRevenueAttributionRoutes(app: Express) {
  app.get("/api/revenue", requireCampaign, async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      const check = await featureFlagService.checkWithDependencies("revenue_attribution_enabled", accountId);
      if (!check.enabled) {
        return res.json({ entries: [], disabled: true });
      }
      const result = await db.select().from(revenueEntries)
        .where(eq(revenueEntries.accountId, accountId))
        .orderBy(desc(revenueEntries.createdAt))
        .limit(100);
      res.json({ entries: result, safeMode: check.safeMode });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/revenue", async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("revenue_attribution_enabled", accountId))) {
        return res.status(403).json({ error: "Revenue Attribution is not enabled" });
      }
      const { leadId, amount, source, postId, campaignId, ctaVariantId, funnelStage, notes } = req.body;
      if (!amount) {
        return res.status(400).json({ error: "amount is required" });
      }

      const inserted = await db.insert(revenueEntries).values({
        accountId, leadId, amount, source, postId,
        campaignId, ctaVariantId, funnelStage, notes,
      }).returning();

      if (leadId) {
        const lead = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        if (lead[0]) {
          await db.update(leads).set({
            revenue: sql`${leads.revenue} + ${amount}`,
            status: "converted",
            funnelStage: "customer",
            updatedAt: new Date(),
          }).where(eq(leads.id, leadId));
        }
      }

      await logAudit(accountId, "REVENUE_ATTRIBUTED", {
        details: { entryId: inserted[0].id, amount, leadId, postId, campaignId },
      });

      res.json({ entry: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ad-spend", requireCampaign, async (req, res) => {
    try {
      const accountId = req.body.accountId || "default";
      if (!(await featureFlagService.isEnabled("revenue_attribution_enabled", accountId))) {
        return res.status(403).json({ error: "Revenue Attribution is not enabled" });
      }
      const { amount, platform, campaignId, period, notes } = req.body;
      if (!amount) {
        return res.status(400).json({ error: "amount is required" });
      }
      const inserted = await db.insert(adSpendEntries).values({
        accountId, amount, platform, campaignId, period, notes,
      }).returning();
      res.json({ entry: inserted[0] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ad-spend", requireCampaign, async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      if (!(await featureFlagService.isEnabled("revenue_attribution_enabled", accountId))) {
        return res.json({ entries: [], disabled: true });
      }
      const result = await db.select().from(adSpendEntries)
        .where(eq(adSpendEntries.accountId, accountId))
        .orderBy(desc(adSpendEntries.createdAt));
      res.json({ entries: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/revenue/stats", requireCampaign, async (req, res) => {
    try {
      const accountId = (req as any).accountId || "default";
      const check = await featureFlagService.checkWithDependencies("revenue_attribution_enabled", accountId);
      if (!check.enabled) {
        return res.json({ stats: null, disabled: true });
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const allRevenue = await db.select().from(revenueEntries)
        .where(eq(revenueEntries.accountId, accountId));
      const monthRevenue = allRevenue.filter(r => r.createdAt && r.createdAt >= monthStart);

      const allSpend = await db.select().from(adSpendEntries)
        .where(eq(adSpendEntries.accountId, accountId));
      const monthSpend = allSpend.filter(s => s.createdAt && s.createdAt >= monthStart);

      const totalRevenue = allRevenue.reduce((sum, r) => sum + (r.amount || 0), 0);
      const monthTotalRevenue = monthRevenue.reduce((sum, r) => sum + (r.amount || 0), 0);
      const totalSpend = allSpend.reduce((sum, s) => sum + (s.amount || 0), 0);
      const monthTotalSpend = monthSpend.reduce((sum, s) => sum + (s.amount || 0), 0);

      const allLeads = await db.select().from(leads).where(eq(leads.accountId, accountId));
      const monthLeads = allLeads.filter(l => l.createdAt && l.createdAt >= monthStart);
      const costPerLead = monthLeads.length > 0 ? (monthTotalSpend / monthLeads.length).toFixed(2) : "0";

      const byPost: Record<string, number> = {};
      const byCampaign: Record<string, number> = {};
      const byFunnelStage: Record<string, number> = {};
      for (const r of allRevenue) {
        if (r.postId) byPost[r.postId] = (byPost[r.postId] || 0) + (r.amount || 0);
        if (r.campaignId) byCampaign[r.campaignId] = (byCampaign[r.campaignId] || 0) + (r.amount || 0);
        if (r.funnelStage) byFunnelStage[r.funnelStage] = (byFunnelStage[r.funnelStage] || 0) + (r.amount || 0);
      }

      res.json({
        stats: {
          totalRevenue,
          monthRevenue: monthTotalRevenue,
          totalSpend,
          monthSpend: monthTotalSpend,
          roas: totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "N/A",
          monthRoas: monthTotalSpend > 0 ? (monthTotalRevenue / monthTotalSpend).toFixed(2) : "N/A",
          costPerLead,
          revenueByPost: byPost,
          revenueByCampaign: byCampaign,
          revenueByFunnelStage: byFunnelStage,
        },
        safeMode: check.safeMode,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
