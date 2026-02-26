import type { Express, Request, Response } from "express";
import { db } from "./db";
import { requireCampaign } from "./campaign-routes";
import { getCampaignMetrics, resolveDataMode } from "./campaign-data-layer";
import {
  strategicPlans,
  planApprovals,
  requiredWork,
  calendarEntries,
  studioItems,
  strategyInsights,
  performanceSnapshots,
} from "@shared/schema";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import { ACTIVE_PLAN_STATUSES } from "./plan-constants";

const LOG_PREFIX = "[Dashboard]";

export function registerDashboardRoutes(app: Express) {
  app.get("/api/dashboard/metrics", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const metrics = await getCampaignMetrics(campaignId, accountId);

      const queuedCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(calendarEntries)
        .where(
          and(
            eq(calendarEntries.campaignId, campaignId),
            eq(calendarEntries.accountId, accountId),
            eq(calendarEntries.status, "SCHEDULED")
          )
        );

      const publishedCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(studioItems)
        .where(
          and(
            eq(studioItems.campaignId, campaignId),
            eq(studioItems.accountId, accountId),
            eq(studioItems.status, "PUBLISHED")
          )
        );

      const contentCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(studioItems)
        .where(
          and(
            eq(studioItems.campaignId, campaignId),
            eq(studioItems.accountId, accountId)
          )
        );

      const hasData =
        metrics.totalSpend > 0 ||
        metrics.totalRevenue > 0 ||
        metrics.totalConversions > 0 ||
        Number(contentCount[0]?.count || 0) > 0;

      res.json({
        success: true,
        hasData,
        metrics: {
          revenue: metrics.totalRevenue,
          roas: metrics.avgRoas,
          spent: metrics.totalSpend,
          results: metrics.totalConversions,
          cpa: metrics.avgCpa,
          contentCount: Number(contentCount[0]?.count || 0),
          queuedCount: Number(queuedCount[0]?.count || 0),
          publishedCount: Number(publishedCount[0]?.count || 0),
          reach: metrics.totalReach,
          engagement: metrics.totalClicks,
          impressions: metrics.totalImpressions,
          ctr: metrics.avgCtr,
          leads: metrics.totalLeads,
        },
        month: {
          revenue: metrics.monthRevenue,
          spent: metrics.monthSpend,
          conversions: metrics.monthConversions,
          leads: metrics.monthLeads,
          roas: metrics.monthRoas,
          costPerLead: metrics.costPerLead,
        },
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Metrics error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load dashboard metrics" });
    }
  });

  app.get("/api/dashboard/ai-actions", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const approvedPlans = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.campaignId, campaignId),
            eq(strategicPlans.accountId, accountId),
            inArray(strategicPlans.status, [...ACTIVE_PLAN_STATUSES])
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (approvedPlans.length === 0) {
        const fallbackPlans = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              inArray(strategicPlans.status, [...ACTIVE_PLAN_STATUSES])
            )
          )
          .orderBy(desc(strategicPlans.createdAt))
          .limit(1);

        if (fallbackPlans.length === 0) {
          return res.json({
            success: true,
            gated: true,
            gateReason: "NO_APPROVED_PLAN",
            actions: [],
          });
        }

        approvedPlans.push(fallbackPlans[0]);
      }

      const plan = approvedPlans[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [recentInsights, recentSnapshots, work] = await Promise.all([
        db
          .select()
          .from(strategyInsights)
          .where(
            and(
              eq(strategyInsights.accountId, accountId),
              eq(strategyInsights.campaignId, campaignId),
              eq(strategyInsights.isActive, true),
              gte(strategyInsights.createdAt, weekAgo)
            )
          )
          .orderBy(desc(strategyInsights.confidence))
          .limit(10),
        db
          .select()
          .from(performanceSnapshots)
          .where(
            and(
              eq(performanceSnapshots.campaignId, campaignId),
              eq(performanceSnapshots.accountId, accountId)
            )
          )
          .orderBy(desc(performanceSnapshots.fetchedAt))
          .limit(14),
        db
          .select()
          .from(requiredWork)
          .where(
            and(
              eq(requiredWork.campaignId, campaignId),
              eq(requiredWork.accountId, accountId),
              eq(requiredWork.planId, plan.id)
            )
          )
          .limit(1),
      ]);

      const actions: Array<{
        id: string;
        action: string;
        evidenceMetric: string;
        evidenceTimeframe: string;
        sourceTag: "PERFORMANCE" | "PLAN" | "GATES" | "PUBLISH";
        priority: "HIGH" | "MEDIUM" | "LOW";
        priorityJustification: string;
      }> = [];

      for (const insight of recentInsights) {
        let parsed: any = {};
        try {
          parsed = typeof insight.insight === "string" ? JSON.parse(insight.insight) : insight.insight;
        } catch {}

        actions.push({
          id: insight.id,
          action: parsed.recommendation || parsed.action || `Review ${insight.insightType} insight`,
          evidenceMetric: parsed.metric || insight.insightType || "performance",
          evidenceTimeframe: "Last 7 days",
          sourceTag: "PERFORMANCE",
          priority: (insight.confidence || 0) >= 0.8 ? "HIGH" : (insight.confidence || 0) >= 0.5 ? "MEDIUM" : "LOW",
          priorityJustification: `Confidence: ${((insight.confidence || 0) * 100).toFixed(0)}% — ${parsed.rationale || "Based on recent performance data"}`,
        });
      }

      if (work.length > 0) {
        const w = work[0];
        const total = w.totalContentPieces || 0;
        const published = w.publishedCount || 0;
        const ready = w.readyCount || 0;
        const failed = w.failedCount || 0;

        if (total > 0 && published < total) {
          actions.push({
            id: `plan-progress-${plan.id}`,
            action: `${total - published - ready} content pieces remaining for execution`,
            evidenceMetric: `${published}/${total} published`,
            evidenceTimeframe: `${w.periodDays || 30}-day plan`,
            sourceTag: "PLAN",
            priority: published / total < 0.3 ? "HIGH" : "MEDIUM",
            priorityJustification: `Progress: ${((published / total) * 100).toFixed(0)}% complete`,
          });
        }

        if (failed > 0) {
          actions.push({
            id: `plan-failures-${plan.id}`,
            action: `${failed} content pieces failed — review and retry`,
            evidenceMetric: `${failed} failures`,
            evidenceTimeframe: `Current plan period`,
            sourceTag: "PLAN",
            priority: "HIGH",
            priorityJustification: `${failed} items need attention to meet execution targets`,
          });
        }
      }

      if (recentSnapshots.length >= 7) {
        const recent3 = recentSnapshots.slice(0, 3);
        const prior4 = recentSnapshots.slice(3, 7);
        const recentCpa = recent3.reduce((s, p) => s + (p.cpa || 0), 0) / 3;
        const priorCpa = prior4.reduce((s, p) => s + (p.cpa || 0), 0) / 4;

        if (recentCpa > priorCpa * 1.2 && priorCpa > 0) {
          actions.push({
            id: `cpa-alert-${Date.now()}`,
            action: `CPA increased ${(((recentCpa - priorCpa) / priorCpa) * 100).toFixed(0)}% — consider audience refresh`,
            evidenceMetric: `CPA: $${recentCpa.toFixed(2)} vs $${priorCpa.toFixed(2)}`,
            evidenceTimeframe: "Last 3 days vs prior 4 days",
            sourceTag: "PERFORMANCE",
            priority: "HIGH",
            priorityJustification: `CPA rising trend detected from real performance data`,
          });
        }
      }

      res.json({
        success: true,
        gated: false,
        planId: plan.id,
        actions: actions.slice(0, 8),
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} AI Actions error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load AI actions" });
    }
  });

  app.get("/api/dashboard/mode", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const mode = await resolveDataMode(accountId);
      res.json({ success: true, mode });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Mode check error:`, error);
      res.json({ success: true, mode: "UNKNOWN" });
    }
  });

  app.get("/api/dashboard/plan-status", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;

      const plans = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.campaignId, campaignId),
            eq(strategicPlans.accountId, accountId)
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (plans.length === 0) {
        return res.json({ success: true, hasPlan: false, status: null });
      }

      const plan = plans[0];

      const approvals = await db
        .select()
        .from(planApprovals)
        .where(eq(planApprovals.planId, plan.id))
        .orderBy(desc(planApprovals.createdAt))
        .limit(1);

      const isApproved = approvals.length > 0 && approvals[0].decision === "APPROVED";

      res.json({
        success: true,
        hasPlan: true,
        planId: plan.id,
        status: plan.status,
        executionStatus: plan.executionStatus,
        isApproved,
        emergencyStopped: plan.emergencyStopped,
        totalCalendarEntries: plan.totalCalendarEntries,
        totalStudioItems: plan.totalStudioItems,
        totalPublished: plan.totalPublished,
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Plan status error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load plan status" });
    }
  });
}
