import type { Express, Request, Response } from "express";
import { db } from "./db";
import { requireCampaign } from "./campaign-routes";
import { resolveDataMode, getManualMetrics } from "./campaign-data-layer";
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

type SourceTag = "MANUAL_METRICS" | "PLAN_PROGRESS" | "HYBRID" | "PERFORMANCE";

interface AIActionItem {
  id: string;
  action: string;
  evidenceMetric: string;
  evidenceTimeframe: string;
  sourceTag: SourceTag;
  priority: "HIGH" | "MEDIUM" | "LOW";
  priorityJustification: string;
}

export function registerDashboardRoutes(app: Express) {
  app.get("/api/dashboard/ai-actions", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const mode = await resolveDataMode(accountId);

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
        const manualOnly = await getManualMetrics(campaignId, accountId);
        if (manualOnly && (manualOnly.spend > 0 || manualOnly.revenue > 0 || manualOnly.impressions > 0 || manualOnly.clicks > 0 || manualOnly.leads > 0)) {
          const actions = buildManualOnlyActions(manualOnly, campaignId);
          return res.json({
            success: true,
            gated: false,
            planId: null,
            mode,
            actions,
          });
        }
        return res.json({
          success: true,
          gated: true,
          gateReason: "NO_APPROVED_PLAN",
          mode,
          actions: [],
        });
      }

      const plan = approvedPlans[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [recentInsights, recentSnapshots, work, manual, calendarStats, studioStats] = await Promise.all([
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
        getManualMetrics(campaignId, accountId),
        db
          .select({
            total: sql<number>`count(*)`,
            draft: sql<number>`count(*) filter (where ${calendarEntries.status} = 'DRAFT')`,
            generated: sql<number>`count(*) filter (where ${calendarEntries.status} = 'GENERATED')`,
            failed: sql<number>`count(*) filter (where ${calendarEntries.status} = 'FAILED')`,
            scheduled: sql<number>`count(*) filter (where ${calendarEntries.status} = 'SCHEDULED')`,
            published: sql<number>`count(*) filter (where ${calendarEntries.status} = 'PUBLISHED')`,
          })
          .from(calendarEntries)
          .where(
            and(
              eq(calendarEntries.campaignId, campaignId),
              eq(calendarEntries.accountId, accountId),
              eq(calendarEntries.planId, plan.id)
            )
          ),
        db
          .select({
            total: sql<number>`count(*)`,
            ready: sql<number>`count(*) filter (where ${studioItems.status} = 'READY')`,
            failed: sql<number>`count(*) filter (where ${studioItems.status} = 'FAILED')`,
            published: sql<number>`count(*) filter (where ${studioItems.status} = 'PUBLISHED')`,
          })
          .from(studioItems)
          .where(
            and(
              eq(studioItems.campaignId, campaignId),
              eq(studioItems.accountId, accountId),
              eq(studioItems.planId, plan.id)
            )
          ),
      ]);

      const actions: AIActionItem[] = [];
      const hasManualData = manual && (manual.spend > 0 || manual.revenue > 0 || manual.conversions > 0 || manual.impressions > 0 || manual.clicks > 0 || manual.leads > 0);

      const { computeFulfillment: computeFulfillmentForActions } = await import("./fulfillment-engine");
      const actionFulfillment = await computeFulfillmentForActions(campaignId, accountId);
      const totalPieces = actionFulfillment.total.required;
      const publishedPieces = actionFulfillment.total.fulfilled;
      const failedPieces = 0;
      const generatedPieces = actionFulfillment.total.fulfilled;
      const draftPieces = 0;
      const scheduledPieces = 0;
      const completionPct = actionFulfillment.progressPercent;
      const hasPlanProgress = totalPieces > 0;

      if (hasManualData && hasPlanProgress) {
        const spend = manual!.spend || 0;
        const revenue = manual!.revenue || 0;
        const conversions = manual!.conversions || 0;
        const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : 0;
        const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;
        const remaining = totalPieces - publishedPieces;

        actions.push({
          id: `hybrid-perf-exec-${campaignId}`,
          action: cpa > 0 && remaining > 0
            ? `CPA is $${cpa} with ${remaining}/${totalPieces} content remaining — ${completionPct < 50 ? "accelerate content pipeline to lower acquisition cost" : "maintain execution pace to sustain performance"}`
            : `Revenue $${revenue.toLocaleString()} at ${roas}x ROAS with ${publishedPieces}/${totalPieces} pieces published — ${completionPct >= 80 ? "plan nearing completion, prepare next cycle" : "continue execution to maximize return"}`,
          evidenceMetric: `CPA: $${cpa} | ROAS: ${roas}x | Spend: $${spend.toLocaleString()} | Published: ${publishedPieces}/${totalPieces} (${completionPct}%)`,
          evidenceTimeframe: `manual entry + plan execution (current plan)`,
          sourceTag: "HYBRID",
          priority: (cpa > 0 && completionPct < 30) ? "HIGH" : "MEDIUM",
          priorityJustification: `Combined: manual CPA $${cpa}, ROAS ${roas}x against ${completionPct}% plan completion (${publishedPieces}/${totalPieces} published)`,
        });
      }

      if (hasManualData) {
        const spend = manual!.spend || 0;
        const revenue = manual!.revenue || 0;
        const conversions = manual!.conversions || 0;
        const leads = manual!.leads || 0;
        const impressions = manual!.impressions || 0;
        const clicks = manual!.clicks || 0;
        const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : 0;
        const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;
        const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0;
        const metricsUpdated = manual!.updatedAt ? new Date(manual!.updatedAt).toLocaleDateString() : "recently";

        if (roas > 0) {
          const roasAction = roas >= 3
            ? `ROAS at ${roas}x — strong return on $${spend.toLocaleString()} spend. Scale winning creatives.`
            : roas >= 1.5
              ? `ROAS at ${roas}x — positive but room for improvement on $${spend.toLocaleString()} spend.`
              : `ROAS at ${roas}x — below break-even threshold. Review targeting and creative quality.`;

          actions.push({
            id: `manual-roas-${campaignId}`,
            action: roasAction,
            evidenceMetric: `ROAS: ${roas}x | Revenue: $${revenue.toLocaleString()} / Spend: $${spend.toLocaleString()}`,
            evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
            sourceTag: "MANUAL_METRICS",
            priority: roas < 1.5 ? "HIGH" : roas < 3 ? "MEDIUM" : "LOW",
            priorityJustification: `ROAS ${roas}x ${roas < 1.5 ? "below break-even — urgent optimization needed" : roas < 3 ? "is moderate — optimization opportunity exists" : "is strong — maintain current strategy"}`,
          });
        }

        if (cpa > 0) {
          actions.push({
            id: `manual-cpa-${campaignId}`,
            action: `CPA is $${cpa} across ${conversions} conversions from ${leads} leads — ${conversions > 0 && leads > conversions * 2 ? "lead-to-conversion rate is low, optimize nurture sequence" : "conversion efficiency is healthy"}`,
            evidenceMetric: `CPA: $${cpa} | Conversions: ${conversions} | Leads: ${leads} | Spend: $${spend.toLocaleString()}`,
            evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
            sourceTag: "MANUAL_METRICS",
            priority: "MEDIUM",
            priorityJustification: `CPA $${cpa} based on ${conversions} conversions from $${spend.toLocaleString()} spend`,
          });
        }

        if (ctr > 0) {
          actions.push({
            id: `manual-ctr-${campaignId}`,
            action: ctr >= 2
              ? `CTR at ${ctr}% indicates strong creative resonance — ${clicks.toLocaleString()} clicks from ${impressions.toLocaleString()} impressions`
              : `CTR at ${ctr}% is below benchmark — test new hooks and visual formats to improve click-through from ${impressions.toLocaleString()} impressions`,
            evidenceMetric: `CTR: ${ctr}% | Clicks: ${clicks.toLocaleString()} | Impressions: ${impressions.toLocaleString()}`,
            evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
            sourceTag: "MANUAL_METRICS",
            priority: ctr < 1 ? "HIGH" : "LOW",
            priorityJustification: `CTR ${ctr}% — ${ctr < 1 ? "below 1% threshold, creative refresh needed" : ctr < 2 ? "moderate engagement" : "strong engagement rate"}`,
          });
        }
      }

      if (hasPlanProgress) {
        if (totalPieces > 0 && publishedPieces < totalPieces) {
          actions.push({
            id: `plan-progress-${plan.id}`,
            action: `${totalPieces - publishedPieces} content pieces remaining — ${draftPieces} draft, ${generatedPieces} generated, ${scheduledPieces} scheduled, ${publishedPieces} published`,
            evidenceMetric: `${publishedPieces}/${totalPieces} published (${completionPct}%) | Draft: ${draftPieces} | Generated: ${generatedPieces} | Failed: ${failedPieces}`,
            evidenceTimeframe: `plan execution (current plan)`,
            sourceTag: "PLAN_PROGRESS",
            priority: completionPct < 30 ? "HIGH" : "MEDIUM",
            priorityJustification: `Progress: ${completionPct}% complete — ${totalPieces - publishedPieces} pieces need execution`,
          });
        }

        if (failedPieces > 0) {
          actions.push({
            id: `plan-failures-${plan.id}`,
            action: `${failedPieces} content pieces failed generation — review and retry to maintain execution timeline`,
            evidenceMetric: `${failedPieces} failures out of ${totalPieces} total pieces`,
            evidenceTimeframe: `plan execution (current plan)`,
            sourceTag: "PLAN_PROGRESS",
            priority: "HIGH",
            priorityJustification: `${failedPieces} failed items block ${((failedPieces / totalPieces) * 100).toFixed(0)}% of plan completion`,
          });
        }

        const fulfilledCount = actionFulfillment.total.fulfilled;
        const remainingCount = actionFulfillment.total.remaining;
        if (remainingCount > 0 && fulfilledCount > 0) {
          actions.push({
            id: `studio-progress-${plan.id}`,
            action: `${fulfilledCount} content pieces created, ${remainingCount} remaining — continue creating to maintain content cadence`,
            evidenceMetric: `${fulfilledCount} fulfilled | ${remainingCount} remaining out of ${totalPieces} required`,
            evidenceTimeframe: `plan execution (current plan)`,
            sourceTag: "PLAN_PROGRESS",
            priority: "MEDIUM",
            priorityJustification: `${remainingCount} items remaining — schedule to maintain content cadence`,
          });
        }
      }

      if (actions.length === 0 && plan) {
        if (totalPieces > 0) {
          actions.push({
            id: `plan-calendar-${plan.id}`,
            action: `${totalPieces} content pieces required — start creating content item-by-item`,
            evidenceMetric: `${totalPieces} pieces in plan`,
            evidenceTimeframe: "plan execution (current plan)",
            sourceTag: "PLAN_PROGRESS",
            priority: "HIGH",
            priorityJustification: "Plan active, content creation can begin",
          });
        } else {
          actions.push({
            id: `plan-active-${plan.id}`,
            action: "Plan approved — generate calendar to start content pipeline",
            evidenceMetric: `Plan status: ${plan.status}`,
            evidenceTimeframe: "plan execution (current plan)",
            sourceTag: "PLAN_PROGRESS",
            priority: "HIGH",
            priorityJustification: "Approved plan ready for calendar generation",
          });
        }
      }

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

      console.log(`${LOG_PREFIX} AI Actions for ${campaignId}: ${actions.length} actions (mode=${mode}, manual=${!!hasManualData}, plan=${!!hasPlanProgress})`);

      res.json({
        success: true,
        gated: false,
        planId: plan.id,
        mode,
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

      const { computeFulfillment } = await import("./fulfillment-engine");
      const fulfillment = await computeFulfillment(campaignId, accountId);

      res.json({
        success: true,
        hasPlan: true,
        planId: plan.id,
        status: plan.status,
        executionStatus: plan.executionStatus,
        isApproved,
        emergencyStopped: plan.emergencyStopped,
        totalCalendarEntries: plan.totalCalendarEntries,
        totalStudioItems: fulfillment.total.fulfilled,
        totalPublished: fulfillment.byStatus.published,
        fulfillment,
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Plan status error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load plan status" });
    }
  });
}

function buildManualOnlyActions(manual: any, campaignId: string): AIActionItem[] {
  const actions: AIActionItem[] = [];
  const spend = manual.spend || 0;
  const revenue = manual.revenue || 0;
  const conversions = manual.conversions || 0;
  const leads = manual.leads || 0;
  const impressions = manual.impressions || 0;
  const clicks = manual.clicks || 0;
  const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : 0;
  const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;
  const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0;
  const metricsUpdated = manual.updatedAt ? new Date(manual.updatedAt).toLocaleDateString() : "recently";

  if (roas > 0) {
    actions.push({
      id: `manual-roas-${campaignId}`,
      action: roas >= 3
        ? `ROAS at ${roas}x — strong return. Build a strategic plan to scale.`
        : `ROAS at ${roas}x on $${spend.toLocaleString()} spend — create a plan to optimize further.`,
      evidenceMetric: `ROAS: ${roas}x | Revenue: $${revenue.toLocaleString()} / Spend: $${spend.toLocaleString()}`,
      evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
      sourceTag: "MANUAL_METRICS",
      priority: roas < 1.5 ? "HIGH" : "MEDIUM",
      priorityJustification: `ROAS ${roas}x — ${roas < 1.5 ? "below break-even, plan needed urgently" : "positive but a strategic plan will unlock further growth"}`,
    });
  }

  if (cpa > 0) {
    actions.push({
      id: `manual-cpa-${campaignId}`,
      action: `CPA is $${cpa} — ${conversions} conversions from ${leads} leads. Build a plan to optimize acquisition.`,
      evidenceMetric: `CPA: $${cpa} | Conversions: ${conversions} | Leads: ${leads}`,
      evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
      sourceTag: "MANUAL_METRICS",
      priority: "MEDIUM",
      priorityJustification: `CPA $${cpa} — strategic plan needed to drive down cost`,
    });
  }

  if (ctr > 0) {
    actions.push({
      id: `manual-ctr-${campaignId}`,
      action: ctr >= 2
        ? `CTR at ${ctr}% is strong — create a plan to capitalize on audience engagement`
        : `CTR at ${ctr}% — plan needed to improve creative performance`,
      evidenceMetric: `CTR: ${ctr}% | Clicks: ${clicks.toLocaleString()} | Impressions: ${impressions.toLocaleString()}`,
      evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
      sourceTag: "MANUAL_METRICS",
      priority: ctr < 1 ? "HIGH" : "LOW",
      priorityJustification: `CTR ${ctr}% — ${ctr < 1 ? "below 1% threshold" : "healthy engagement"}`,
    });
  }

  if (actions.length === 0 && (spend > 0 || revenue > 0)) {
    actions.push({
      id: `manual-overview-${campaignId}`,
      action: `$${spend.toLocaleString()} spent, $${revenue.toLocaleString()} revenue — create a strategic plan for systematic execution`,
      evidenceMetric: `Spend: $${spend.toLocaleString()} | Revenue: $${revenue.toLocaleString()}`,
      evidenceTimeframe: `manual entry (updated ${metricsUpdated})`,
      sourceTag: "MANUAL_METRICS",
      priority: "HIGH",
      priorityJustification: `Campaign data available but no approved plan — strategic plan required`,
    });
  }

  return actions;
}
