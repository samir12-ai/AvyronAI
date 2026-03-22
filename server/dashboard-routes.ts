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
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
  strategicBlueprints,
  goalDecompositions,
  growthSimulations,
  executionTasks,
  planAssumptions,
} from "@shared/schema";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import { ACTIVE_PLAN_STATUSES } from "./plan-constants";
import { aiChat } from "./ai-client";
import { getLatestContentDna } from "./content-dna-routes";
import { getActiveRootBundle, detectStaleness, validateRootIntegrity, computeCalendarDeviation } from "./root-bundle";

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
      const accountId = (req as any).accountId || "default";
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

      let rootInfo: any = null;
      try {
        const activeRoot = await getActiveRootBundle(campaignId, accountId);
        if (activeRoot) {
          const staleness = await detectStaleness(campaignId, accountId);
          rootInfo = {
            id: activeRoot.id,
            version: activeRoot.version,
            strategyHash: activeRoot.strategyHash,
            status: staleness.isStale ? "stale" : activeRoot.status,
            isStale: staleness.isStale,
            staleReason: staleness.reason,
            lockedAt: activeRoot.lockedAt,
          };
        }
      } catch (rootErr: any) {
        console.warn(`${LOG_PREFIX} Root bundle fetch failed:`, rootErr.message);
      }

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
        rootBundle: rootInfo,
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Plan status error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to load plan status" });
    }
  });

  app.get("/api/dashboard/agent-brief", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const mode = await resolveDataMode(accountId);

      const safeJson = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

      const [plans, manual, miData, audData, posData, diffData, offerData, funnelData, awarenessData, persuasionData, statValData, budgetData, channelData, iterData, retentionData, blueprint, goalDecompData, simulationData] = await Promise.all([
        db.select().from(strategicPlans)
          .where(and(eq(strategicPlans.campaignId, campaignId), eq(strategicPlans.accountId, accountId), inArray(strategicPlans.status, [...ACTIVE_PLAN_STATUSES])))
          .orderBy(desc(strategicPlans.createdAt)).limit(1),
        getManualMetrics(campaignId, accountId),
        db.select({ marketDiagnosis: miSnapshots.marketDiagnosis, competitorData: miSnapshots.competitorData, status: miSnapshots.status })
          .from(miSnapshots).where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
          .orderBy(desc(miSnapshots.createdAt)).limit(1),
        db.select({ audiencePains: audienceSnapshots.audiencePains, audienceSegments: audienceSnapshots.audienceSegments, emotionalDrivers: audienceSnapshots.emotionalDrivers })
          .from(audienceSnapshots).where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
          .orderBy(desc(audienceSnapshots.createdAt)).limit(1),
        db.select({ territories: positioningSnapshots.territories, narrativeDirection: positioningSnapshots.narrativeDirection })
          .from(positioningSnapshots).where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId)))
          .orderBy(desc(positioningSnapshots.createdAt)).limit(1),
        db.select({ differentiationPillars: differentiationSnapshots.differentiationPillars, authorityMode: differentiationSnapshots.authorityMode })
          .from(differentiationSnapshots).where(and(eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.campaignId, campaignId)))
          .orderBy(desc(differentiationSnapshots.createdAt)).limit(1),
        db.select({ primaryOffer: offerSnapshots.primaryOffer })
          .from(offerSnapshots).where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId)))
          .orderBy(desc(offerSnapshots.createdAt)).limit(1),
        db.select({ primaryFunnel: funnelSnapshots.primaryFunnel })
          .from(funnelSnapshots).where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId)))
          .orderBy(desc(funnelSnapshots.createdAt)).limit(1),
        db.select({ primaryRoute: awarenessSnapshots.primaryRoute, awarenessStrengthScore: awarenessSnapshots.awarenessStrengthScore })
          .from(awarenessSnapshots).where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId)))
          .orderBy(desc(awarenessSnapshots.createdAt)).limit(1),
        db.select({ primaryRoute: persuasionSnapshots.primaryRoute, persuasionStrengthScore: persuasionSnapshots.persuasionStrengthScore })
          .from(persuasionSnapshots).where(and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId)))
          .orderBy(desc(persuasionSnapshots.createdAt)).limit(1),
        db.select({ result: strategyValidationSnapshots.result, confidenceScore: strategyValidationSnapshots.confidenceScore, status: strategyValidationSnapshots.status })
          .from(strategyValidationSnapshots).where(and(eq(strategyValidationSnapshots.accountId, accountId), eq(strategyValidationSnapshots.campaignId, campaignId)))
          .orderBy(desc(strategyValidationSnapshots.createdAt)).limit(1),
        db.select({ result: budgetGovernorSnapshots.result, status: budgetGovernorSnapshots.status })
          .from(budgetGovernorSnapshots).where(and(eq(budgetGovernorSnapshots.accountId, accountId), eq(budgetGovernorSnapshots.campaignId, campaignId)))
          .orderBy(desc(budgetGovernorSnapshots.createdAt)).limit(1),
        db.select({ result: channelSelectionSnapshots.result, status: channelSelectionSnapshots.status })
          .from(channelSelectionSnapshots).where(and(eq(channelSelectionSnapshots.accountId, accountId), eq(channelSelectionSnapshots.campaignId, campaignId)))
          .orderBy(desc(channelSelectionSnapshots.createdAt)).limit(1),
        db.select({ result: iterationSnapshots.result, status: iterationSnapshots.status })
          .from(iterationSnapshots).where(and(eq(iterationSnapshots.accountId, accountId), eq(iterationSnapshots.campaignId, campaignId)))
          .orderBy(desc(iterationSnapshots.createdAt)).limit(1),
        db.select({ result: retentionSnapshots.result, status: retentionSnapshots.status })
          .from(retentionSnapshots).where(and(eq(retentionSnapshots.accountId, accountId), eq(retentionSnapshots.campaignId, campaignId)))
          .orderBy(desc(retentionSnapshots.createdAt)).limit(1),
        db.select().from(strategicBlueprints)
          .where(and(eq(strategicBlueprints.accountId, accountId), eq(strategicBlueprints.campaignId, campaignId)))
          .orderBy(desc(strategicBlueprints.createdAt)).limit(1),
        db.select({
          goalType: goalDecompositions.goalType, goalTarget: goalDecompositions.goalTarget,
          goalLabel: goalDecompositions.goalLabel, timeHorizonDays: goalDecompositions.timeHorizonDays,
          feasibility: goalDecompositions.feasibility, feasibilityScore: goalDecompositions.feasibilityScore,
          confidenceScore: goalDecompositions.confidenceScore, funnelMath: goalDecompositions.funnelMath,
        }).from(goalDecompositions)
          .where(and(eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.status, "active")))
          .orderBy(desc(goalDecompositions.createdAt)).limit(1),
        db.select({
          conservativeCase: growthSimulations.conservativeCase, baseCase: growthSimulations.baseCase,
          upsideCase: growthSimulations.upsideCase, confidenceScore: growthSimulations.confidenceScore,
          bottleneckAlerts: growthSimulations.bottleneckAlerts,
        }).from(growthSimulations)
          .where(and(eq(growthSimulations.accountId, accountId), eq(growthSimulations.campaignId, campaignId), eq(growthSimulations.status, "active")))
          .orderBy(desc(growthSimulations.createdAt)).limit(1),
      ]);

      const plan = plans[0] || null;
      const goalDecomp = goalDecompData[0] || null;
      const simulation = simulationData[0] || null;
      const hasManualData = manual && (manual.spend > 0 || manual.revenue > 0 || manual.impressions > 0);
      const spend = manual?.spend || 0;
      const revenue = manual?.revenue || 0;
      const conversions = manual?.conversions || 0;
      const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : 0;
      const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;

      let fulfillmentData: any = null;
      if (plan) {
        const { computeFulfillment } = await import("./fulfillment-engine");
        fulfillmentData = await computeFulfillment(campaignId, accountId);
      }

      let taskSummary: any = null;
      let assumptionsSummary: any = null;
      if (plan) {
        try {
          const taskRows = await db.select({ status: executionTasks.status }).from(executionTasks)
            .where(eq(executionTasks.planId, plan.id));
          if (taskRows.length > 0) {
            taskSummary = {
              total: taskRows.length,
              pending: taskRows.filter(t => t.status === "pending").length,
              completed: taskRows.filter(t => t.status === "completed").length,
              blocked: taskRows.filter(t => t.status === "blocked").length,
            };
          }
        } catch {}
        try {
          const assRows = await db.select({ confidence: planAssumptions.confidence, impactSeverity: planAssumptions.impactSeverity })
            .from(planAssumptions).where(eq(planAssumptions.planId, plan.id));
          if (assRows.length > 0) {
            assumptionsSummary = {
              total: assRows.length,
              highImpact: assRows.filter(a => a.impactSeverity === "high").length,
              lowConfidence: assRows.filter(a => a.confidence === "low").length,
            };
          }
        } catch {}
      }

      const totalPieces = fulfillmentData?.total?.required || 0;
      const fulfilledPieces = fulfillmentData?.total?.fulfilled || 0;
      const remainingPieces = fulfillmentData?.total?.remaining || totalPieces;
      const progressPct = fulfillmentData?.progressPercent || 0;

      const engineSummaries: Record<string, string> = {};
      const enginesActive: string[] = [];

      if (miData[0]) {
        enginesActive.push("Market Intelligence");
        let compCount = 0;
        try { const cd = miData[0].competitorData ? JSON.parse(miData[0].competitorData) : []; compCount = Array.isArray(cd) ? cd.length : 0; } catch {}
        engineSummaries.marketIntelligence = `${compCount} competitors tracked. Market: ${miData[0].marketDiagnosis || "analyzed"}`;
      }
      if (audData[0]) {
        enginesActive.push("Audience");
        const pains = safeJson(audData[0].audiencePains) || [];
        const segs = safeJson(audData[0].audienceSegments) || [];
        engineSummaries.audience = `${Array.isArray(pains) ? pains.length : 0} pain profiles, ${Array.isArray(segs) ? segs.length : 0} segments identified`;
      }
      if (posData[0]) {
        enginesActive.push("Positioning");
        const terr = safeJson(posData[0].territories) || [];
        engineSummaries.positioning = `${Array.isArray(terr) ? terr.length : 0} positioning territories mapped`;
      }
      if (diffData[0]) {
        enginesActive.push("Differentiation");
        const pillars = safeJson(diffData[0].differentiationPillars) || [];
        engineSummaries.differentiation = `${Array.isArray(pillars) ? pillars.length : 0} differentiation pillars, authority: ${diffData[0].authorityMode || "N/A"}`;
      }
      if (offerData[0]) {
        enginesActive.push("Offer");
        const offer = safeJson(offerData[0].primaryOffer);
        engineSummaries.offer = offer?.offerName || "Structured offer defined";
      }
      if (funnelData[0]) {
        enginesActive.push("Funnel");
        const funnel = safeJson(funnelData[0].primaryFunnel);
        engineSummaries.funnel = funnel?.funnelName || "Conversion funnel mapped";
      }
      if (awarenessData[0]) {
        enginesActive.push("Awareness");
        const route = safeJson(awarenessData[0].primaryRoute);
        engineSummaries.awareness = `Route: ${route?.routeName || "defined"}, strength: ${awarenessData[0].awarenessStrengthScore ?? "N/A"}`;
      }
      if (persuasionData[0]) {
        enginesActive.push("Persuasion");
        const pRoute = safeJson(persuasionData[0].primaryRoute);
        engineSummaries.persuasion = `Mode: ${pRoute?.routeName || "N/A"}, strength: ${persuasionData[0].persuasionStrengthScore ?? "N/A"}`;
      }
      if (statValData[0]) {
        enginesActive.push("Statistical Validation");
        const svResult = safeJson(statValData[0].result);
        engineSummaries.statisticalValidation = `Confidence: ${statValData[0].confidenceScore ?? "N/A"}, status: ${statValData[0].status || "N/A"}`;
      }
      if (budgetData[0]) {
        enginesActive.push("Budget Governor");
        const bgResult = safeJson(budgetData[0].result);
        engineSummaries.budgetGovernor = bgResult?.recommendation || `Budget analysis ${budgetData[0].status || "complete"}`;
      }
      if (channelData[0]) {
        enginesActive.push("Channel Selection");
        const csResult = safeJson(channelData[0].result);
        engineSummaries.channelSelection = csResult?.selectedChannels ? `${csResult.selectedChannels.length} channels selected` : `Channel analysis ${channelData[0].status || "complete"}`;
      }
      if (iterData[0]) {
        enginesActive.push("Iteration");
        engineSummaries.iteration = `Iteration analysis ${iterData[0].status || "complete"}`;
      }
      if (retentionData[0]) {
        enginesActive.push("Retention");
        engineSummaries.retention = `Retention analysis ${retentionData[0].status || "complete"}`;
      }

      let planSections: string[] = [];
      let planJson: any = null;
      if (plan?.planJson) {
        try {
          planJson = typeof plan.planJson === "string" ? JSON.parse(plan.planJson) : plan.planJson;
          if (planJson.contentDistributionPlan) planSections.push("Content Distribution");
          if (planJson.creativeTestingMatrix) planSections.push("Creative Testing");
          if (planJson.budgetAllocationStructure) planSections.push("Budget Allocation");
          if (planJson.kpiMonitoringPriority) planSections.push("KPI Monitoring");
          if (planJson.competitiveWatchTargets) planSections.push("Competitive Watch");
          if (planJson.riskMonitoringTriggers) planSections.push("Risk Monitoring");
        } catch {}
      }

      let orchestratorSections: string[] = [];
      if (blueprint[0]?.orchestratorPlan) {
        try {
          const op = typeof blueprint[0].orchestratorPlan === "string" ? JSON.parse(blueprint[0].orchestratorPlan) : blueprint[0].orchestratorPlan;
          if (op.contentDistributionPlan) orchestratorSections.push("Content Distribution");
          if (op.creativeTestingMatrix) orchestratorSections.push("Creative Testing");
          if (op.budgetAllocationStructure) orchestratorSections.push("Budget Allocation");
          if (op.kpiMonitoringPriority) orchestratorSections.push("KPI Monitoring");
          if (op.competitiveWatchTargets) orchestratorSections.push("Competitive Watch");
          if (op.riskMonitoringTriggers) orchestratorSections.push("Risk Monitoring");
        } catch {}
      }

      const statusParts: string[] = [];
      if (hasManualData) statusParts.push(`CPA: $${cpa} | ROAS: ${roas}x`);
      if (totalPieces > 0) statusParts.push(`Content: ${fulfilledPieces}/${totalPieces}`);
      if (plan) statusParts.push(`Plan: ${plan.status}`);
      if (!plan) statusParts.push("No plan yet");

      const campaignStatus = statusParts.join(" · ");

      let insight = "";
      let priorityAction = "";

      let dnaStatusLine = "Content DNA: Not generated yet";
      let dnaSnapshot: any = null;
      try {
        const dna = await getLatestContentDna(campaignId, accountId);
        if (dna?.snapshot) {
          dnaSnapshot = dna.snapshot;
          const snap = dna.snapshot as any;
          dnaStatusLine = `Content DNA: Active — CTA=${snap.ctaType || "N/A"}, Hook=${snap.hookStyle || "N/A"}, Narrative=${snap.narrativeStyle || "N/A"}, Tone=${snap.toneStyle || "N/A"}, Format=${snap.formatPriority || "N/A"}`;
        }
      } catch (e: any) {
        console.warn(`${LOG_PREFIX} Content DNA fetch failed:`, e.message);
      }

      let goalLine = "";
      if (goalDecomp) {
        const fm = safeJson(goalDecomp.funnelMath);
        goalLine = `GOAL: ${goalDecomp.goalLabel} | Type: ${goalDecomp.goalType} | Target: ${goalDecomp.goalTarget} | ${goalDecomp.timeHorizonDays} days | Feasibility: ${goalDecomp.feasibility} (${goalDecomp.feasibilityScore}/100) | Confidence: ${goalDecomp.confidenceScore}/100`;
        if (fm) goalLine += ` | Funnel: Reach=${fm.requiredReach?.toLocaleString()}, Leads=${fm.requiredLeads?.toLocaleString()}, CloseRate=${fm.closeRate}`;
      }

      let simLine = "";
      if (simulation) {
        const base = safeJson(simulation.baseCase);
        const bnRaw = safeJson(simulation.bottleneckAlerts);
        const bottlenecks = Array.isArray(bnRaw) ? bnRaw : [];
        simLine = `SIMULATION: Confidence ${simulation.confidenceScore ?? "N/A"}/100`;
        if (base) simLine += ` | Base case: ${base.expectedCustomers || base.expectedLeads || base.expectedReach || "N/A"} (${base.achievementPct || 100}%)`;
        if (bottlenecks.length > 0) simLine += ` | Bottlenecks: ${bottlenecks.slice(0, 3).join(", ")}`;
      }

      let taskLine = "";
      if (taskSummary) {
        taskLine = `TASKS: ${taskSummary.total} total | ${taskSummary.pending} pending | ${taskSummary.completed} done | ${taskSummary.blocked} blocked`;
      }

      let assumptionLine = "";
      if (assumptionsSummary) {
        assumptionLine = `ASSUMPTIONS: ${assumptionsSummary.total} total | ${assumptionsSummary.highImpact} high-impact | ${assumptionsSummary.lowConfidence} low-confidence`;
      }

      const contextForAI = [
        hasManualData ? `Performance: CPA=$${cpa}, ROAS=${roas}x, Spend=$${spend}, Revenue=$${revenue}, Conversions=${conversions}` : "No performance data yet",
        totalPieces > 0 ? `Plan progress: ${fulfilledPieces}/${totalPieces} pieces (${progressPct}% complete), ${remainingPieces} remaining` : "No content plan active",
        plan ? `Plan status: ${plan.status}` : "No strategic plan created",
        goalLine,
        simLine,
        taskLine,
        assumptionLine,
        dnaStatusLine,
        enginesActive.length > 0 ? `Active engines (${enginesActive.length}/14): ${enginesActive.join(", ")}` : "No engines have run yet",
        ...Object.entries(engineSummaries).map(([k, v]) => `${k}: ${v}`),
      ].filter(Boolean).join("\n");

      try {
        const response = await aiChat({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content: `You are the MarketMind AI Campaign Manager. You have access to all 14 engine outputs, Content DNA (8 rules: Messaging Core, CTA DNA, Hook DNA, Narrative DNA, Content Angle DNA, Visual DNA, Format DNA, Execution Rules), Goal Decomposition (funnel math, feasibility verdict, confidence score), Growth Simulation (conservative/base/upside scenarios with bottleneck alerts), Execution Tasks (pending/completed/blocked), and Plan Assumptions (confidence + impact severity). When goal data is available, reference feasibility and funnel numbers. When simulation data is present, factor in bottleneck risks. Given campaign data and engine intelligence, produce EXACTLY this JSON:
{"insight":"<1-2 sentence strategic interpretation of the current situation>","priorityAction":"<1 specific actionable next step the user should take right now>"}
Be specific and data-driven. Reference actual numbers, DNA rules, and goal/simulation data when available. Do NOT use generic advice. Respond with ONLY valid JSON.`,
            },
            { role: "user", content: contextForAI },
          ],
          max_tokens: 300,
          accountId,
          endpoint: "dashboard-agent-brief",
        });

        const rawText = typeof response === "string" ? response : response?.choices?.[0]?.message?.content || "";
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          insight = parsed.insight || "";
          priorityAction = parsed.priorityAction || "";
        }
      } catch (err: any) {
        console.warn(`${LOG_PREFIX} Agent brief AI generation failed:`, err.message);
      }

      if (!insight) {
        if (hasManualData && roas > 0) {
          insight = roas >= 3
            ? `Campaign is performing well at ${roas}x ROAS. Engine intelligence suggests maintaining current creative direction while scaling proven content.`
            : `ROAS at ${roas}x needs improvement. Consider refining audience targeting and creative strategy based on engine outputs.`;
        } else if (totalPieces > 0) {
          insight = `Content pipeline is ${progressPct}% complete with ${remainingPieces} pieces remaining. Consistent execution is key to maintaining campaign momentum.`;
        } else {
          insight = enginesActive.length > 0
            ? `${enginesActive.length} engines have analyzed your market. Use these insights to build a strategic plan.`
            : "Start by building a strategic plan to activate the AI engine pipeline.";
        }
      }

      if (!priorityAction) {
        if (!plan) {
          priorityAction = "Build a strategic plan to activate the full engine pipeline and content calendar.";
        } else if (totalPieces > 0 && remainingPieces > 0) {
          priorityAction = `Create ${Math.min(remainingPieces, 2)} content pieces today to maintain cadence and progress toward your ${totalPieces}-piece plan.`;
        } else {
          priorityAction = "Review your plan sections and approve to start the content pipeline.";
        }
      }

      console.log(`${LOG_PREFIX} Agent brief for ${campaignId}: ${enginesActive.length} engines, plan=${!!plan}, dna=${!!dnaSnapshot}, insight=${insight.length}ch`);

      res.json({
        success: true,
        campaignStatus,
        insight,
        priorityAction,
        planProgress: totalPieces > 0 ? { completed: fulfilledPieces, total: totalPieces, remaining: remainingPieces, percent: progressPct } : null,
        engineCount: enginesActive.length,
        enginesActive,
        engineSummaries,
        planSections: planSections.length > 0 ? planSections : orchestratorSections,
        hasPlan: !!plan,
        planStatus: plan?.status || null,
        hasMetrics: hasManualData,
        mode,
        metrics: hasManualData ? { cpa, roas, spend, revenue } : null,
        contentDnaSnapshot: dnaSnapshot,
        goalDecomposition: goalDecomp ? {
          goalLabel: goalDecomp.goalLabel || "Goal",
          goalType: goalDecomp.goalType || "revenue",
          goalTarget: goalDecomp.goalTarget ?? 0,
          timeHorizonDays: goalDecomp.timeHorizonDays ?? 90,
          feasibility: goalDecomp.feasibility || "UNKNOWN",
          feasibilityScore: goalDecomp.feasibilityScore ?? 0,
          confidenceScore: goalDecomp.confidenceScore ?? 0,
        } : null,
        simulation: simulation ? {
          confidenceScore: simulation.confidenceScore ?? 0,
          bottleneckAlerts: (() => { const r = safeJson(simulation.bottleneckAlerts); return Array.isArray(r) ? r : []; })(),
        } : null,
        executionTasksSummary: taskSummary,
        assumptionsSummary,
      });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Agent brief error:`, error);
      res.status(500).json({ success: false, code: 500, message: "Failed to generate agent brief" });
    }
  });

  app.post("/api/dashboard/agent-explain", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { question } = req.body;

      if (!question || typeof question !== "string") {
        return res.status(400).json({ success: false, error: "Question is required" });
      }

      const [plans, miData, audData, posData, diffData, offerData, funnelData, awarenessData, persuasionData, blueprint, goalDecompExplain, simulationExplain] = await Promise.all([
        db.select().from(strategicPlans)
          .where(and(eq(strategicPlans.campaignId, campaignId), eq(strategicPlans.accountId, accountId), inArray(strategicPlans.status, [...ACTIVE_PLAN_STATUSES])))
          .orderBy(desc(strategicPlans.createdAt)).limit(1),
        db.select({ marketDiagnosis: miSnapshots.marketDiagnosis, narrativeSynthesis: miSnapshots.narrativeSynthesis, threatSignals: miSnapshots.threatSignals, opportunitySignals: miSnapshots.opportunitySignals })
          .from(miSnapshots).where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
          .orderBy(desc(miSnapshots.createdAt)).limit(1),
        db.select({ audiencePains: audienceSnapshots.audiencePains, audienceSegments: audienceSnapshots.audienceSegments, emotionalDrivers: audienceSnapshots.emotionalDrivers })
          .from(audienceSnapshots).where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
          .orderBy(desc(audienceSnapshots.createdAt)).limit(1),
        db.select({ territories: positioningSnapshots.territories, narrativeDirection: positioningSnapshots.narrativeDirection })
          .from(positioningSnapshots).where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId)))
          .orderBy(desc(positioningSnapshots.createdAt)).limit(1),
        db.select({ differentiationPillars: differentiationSnapshots.differentiationPillars, authorityMode: differentiationSnapshots.authorityMode })
          .from(differentiationSnapshots).where(and(eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.campaignId, campaignId)))
          .orderBy(desc(differentiationSnapshots.createdAt)).limit(1),
        db.select({ primaryOffer: offerSnapshots.primaryOffer })
          .from(offerSnapshots).where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId)))
          .orderBy(desc(offerSnapshots.createdAt)).limit(1),
        db.select({ primaryFunnel: funnelSnapshots.primaryFunnel })
          .from(funnelSnapshots).where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId)))
          .orderBy(desc(funnelSnapshots.createdAt)).limit(1),
        db.select({ primaryRoute: awarenessSnapshots.primaryRoute, awarenessStrengthScore: awarenessSnapshots.awarenessStrengthScore })
          .from(awarenessSnapshots).where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId)))
          .orderBy(desc(awarenessSnapshots.createdAt)).limit(1),
        db.select({ primaryRoute: persuasionSnapshots.primaryRoute, persuasionStrengthScore: persuasionSnapshots.persuasionStrengthScore })
          .from(persuasionSnapshots).where(and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId)))
          .orderBy(desc(persuasionSnapshots.createdAt)).limit(1),
        db.select().from(strategicBlueprints)
          .where(and(eq(strategicBlueprints.accountId, accountId), eq(strategicBlueprints.campaignId, campaignId)))
          .orderBy(desc(strategicBlueprints.createdAt)).limit(1),
        db.select({
          goalType: goalDecompositions.goalType, goalTarget: goalDecompositions.goalTarget,
          goalLabel: goalDecompositions.goalLabel, timeHorizonDays: goalDecompositions.timeHorizonDays,
          feasibility: goalDecompositions.feasibility, feasibilityScore: goalDecompositions.feasibilityScore,
          confidenceScore: goalDecompositions.confidenceScore, funnelMath: goalDecompositions.funnelMath,
          feasibilityExplanation: goalDecompositions.feasibilityExplanation,
          assumptions: goalDecompositions.assumptions,
        }).from(goalDecompositions)
          .where(and(eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.status, "active")))
          .orderBy(desc(goalDecompositions.createdAt)).limit(1),
        db.select({
          conservativeCase: growthSimulations.conservativeCase, baseCase: growthSimulations.baseCase,
          upsideCase: growthSimulations.upsideCase, confidenceScore: growthSimulations.confidenceScore,
          keyAssumptions: growthSimulations.keyAssumptions, bottleneckAlerts: growthSimulations.bottleneckAlerts,
        }).from(growthSimulations)
          .where(and(eq(growthSimulations.accountId, accountId), eq(growthSimulations.campaignId, campaignId), eq(growthSimulations.status, "active")))
          .orderBy(desc(growthSimulations.createdAt)).limit(1),
      ]);

      const plan = plans[0] || null;
      let planJson: any = null;
      if (plan?.planJson) { try { planJson = typeof plan.planJson === "string" ? JSON.parse(plan.planJson) : plan.planJson; } catch {} }
      let orchestratorPlan: any = null;
      if (blueprint[0]?.orchestratorPlan) { try { orchestratorPlan = typeof blueprint[0].orchestratorPlan === "string" ? JSON.parse(blueprint[0].orchestratorPlan) : blueprint[0].orchestratorPlan; } catch {} }

      const safeJson = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

      const contextParts: string[] = [];
      if (miData[0]) contextParts.push(`MARKET INTELLIGENCE:\nDiagnosis: ${miData[0].marketDiagnosis || "N/A"}\nThreats: ${JSON.stringify(safeJson(miData[0].threatSignals) || [])}\nOpportunities: ${JSON.stringify(safeJson(miData[0].opportunitySignals) || [])}`);
      if (audData[0]) contextParts.push(`AUDIENCE:\nPain profiles: ${(safeJson(audData[0].audiencePains) || []).length}\nSegments: ${JSON.stringify(safeJson(audData[0].audienceSegments) || [])}\nEmotional drivers: ${JSON.stringify(safeJson(audData[0].emotionalDrivers) || [])}`);
      if (posData[0]) contextParts.push(`POSITIONING:\nTerritories: ${JSON.stringify(safeJson(posData[0].territories) || [])}\nNarrative: ${posData[0].narrativeDirection || "N/A"}`);
      if (diffData[0]) contextParts.push(`DIFFERENTIATION:\nPillars: ${JSON.stringify(safeJson(diffData[0].differentiationPillars) || [])}\nAuthority mode: ${diffData[0].authorityMode || "N/A"}`);
      if (offerData[0]) contextParts.push(`OFFER:\n${JSON.stringify(safeJson(offerData[0].primaryOffer) || {})}`);
      if (funnelData[0]) contextParts.push(`FUNNEL:\n${JSON.stringify(safeJson(funnelData[0].primaryFunnel) || {})}`);
      if (awarenessData[0]) contextParts.push(`AWARENESS:\nRoute: ${JSON.stringify(safeJson(awarenessData[0].primaryRoute) || {})}\nStrength: ${awarenessData[0].awarenessStrengthScore ?? "N/A"}`);
      if (persuasionData[0]) {
        const pRouteData = safeJson(persuasionData[0].primaryRoute);
        contextParts.push(`PERSUASION:\nMode: ${pRouteData?.routeName || "N/A"}\nStrength: ${persuasionData[0].persuasionStrengthScore ?? "N/A"}`);
      }

      const activePlan = planJson || orchestratorPlan;
      if (activePlan) {
        const sectionNames = Object.keys(activePlan).filter(k => !["blueprintVersion", "fallback", "partialFallback", "fallbackReason", "aiGeneratedSections", "fallbackSections"].includes(k));
        for (const section of sectionNames) {
          const sData = activePlan[section];
          if (sData && typeof sData === "object") {
            contextParts.push(`PLAN SECTION [${section}]:\n${JSON.stringify(sData).substring(0, 800)}`);
          }
        }
      }

      let dnaContext = "";
      try {
        const dna = await getLatestContentDna(campaignId, accountId);
        if (dna) {
          const dnaParts: string[] = ["CONTENT DNA:"];
          if (dna.messagingCore) dnaParts.push(`Messaging Core: ${JSON.stringify(dna.messagingCore).substring(0, 600)}`);
          if (dna.ctaDna) dnaParts.push(`CTA DNA: ${JSON.stringify(dna.ctaDna).substring(0, 600)}`);
          if (dna.hookDna) dnaParts.push(`Hook DNA: ${JSON.stringify(dna.hookDna).substring(0, 600)}`);
          if (dna.narrativeDna) dnaParts.push(`Narrative DNA: ${JSON.stringify(dna.narrativeDna).substring(0, 600)}`);
          if (dna.contentAngleDna) dnaParts.push(`Content Angle DNA: ${JSON.stringify(dna.contentAngleDna).substring(0, 600)}`);
          if (dna.visualDna) dnaParts.push(`Visual DNA: ${JSON.stringify(dna.visualDna).substring(0, 400)}`);
          if (dna.formatDna) dnaParts.push(`Format DNA: ${JSON.stringify(dna.formatDna).substring(0, 400)}`);
          if (dna.executionRules) dnaParts.push(`Execution Rules: ${JSON.stringify(dna.executionRules).substring(0, 400)}`);
          if (dna.contentInstructions) {
            dnaParts.push(`Content Instructions (production manual): ${JSON.stringify(dna.contentInstructions).substring(0, 1200)}`);
          }
          dnaContext = dnaParts.join("\n");
        }
      } catch {}

      if (dnaContext) contextParts.push(dnaContext);

      const gdExplain = goalDecompExplain[0];
      const simExplain = simulationExplain[0];
      if (gdExplain) {
        const fm = safeJson(gdExplain.funnelMath);
        const ga = safeJson(gdExplain.assumptions) || [];
        contextParts.push(`GOAL DECOMPOSITION:\nGoal: ${gdExplain.goalLabel}\nType: ${gdExplain.goalType} | Target: ${gdExplain.goalTarget} | Timeline: ${gdExplain.timeHorizonDays} days\nFeasibility: ${gdExplain.feasibility} (${gdExplain.feasibilityScore}/100) | Confidence: ${gdExplain.confidenceScore}/100\nExplanation: ${gdExplain.feasibilityExplanation || "N/A"}\nFull Funnel: Reach=${fm?.requiredReach} → Clicks=${fm?.requiredClicks || "N/A"} (CTR ${fm?.ctr ? (fm.ctr * 100).toFixed(1) + "%" : "N/A"}) → Conversations=${fm?.requiredConversations || "N/A"} → Leads=${fm?.requiredLeads} → QualifiedLeads=${fm?.requiredQualifiedLeads} → ClosedClients=${fm?.requiredClosedClients || "N/A"}\nRates: CloseRate=${fm?.closeRate}, ConversionRate=${fm?.conversionRate}, CTR=${fm?.ctr || "N/A"}\nAssumptions: ${ga.length > 0 ? ga.join("; ") : "None"}`);
      }
      if (simExplain) {
        const cons = safeJson(simExplain.conservativeCase);
        const base = safeJson(simExplain.baseCase);
        const ups = safeJson(simExplain.upsideCase);
        const kaRaw = safeJson(simExplain.keyAssumptions);
        const baRaw = safeJson(simExplain.bottleneckAlerts);
        const ka = Array.isArray(kaRaw) ? kaRaw : [];
        const ba = Array.isArray(baRaw) ? baRaw : [];
        contextParts.push(`GROWTH SIMULATION:\nConfidence: ${simExplain.confidenceScore ?? "N/A"}/100\nConservative: ${JSON.stringify(cons).substring(0, 300)}\nBase Case: ${JSON.stringify(base).substring(0, 300)}\nUpside: ${JSON.stringify(ups).substring(0, 300)}\nKey Assumptions: ${ka.join("; ")}\nBottleneck Alerts: ${ba.join("; ")}`);
      }

      let planAssumptionContext = "";
      let executionTaskContext = "";
      if (plan) {
        try {
          const assRows = await db.select().from(planAssumptions).where(eq(planAssumptions.planId, plan.id));
          if (assRows.length > 0) {
            const assLines = assRows.map(a => `- ${a.assumption} (confidence: ${a.confidence}, impact: ${a.impactSeverity}, source: ${a.source})`);
            planAssumptionContext = `PLAN ASSUMPTIONS (${assRows.length}):\n${assLines.join("\n")}`;
          }
        } catch {}
        try {
          const taskRows = await db.select({ title: executionTasks.title, status: executionTasks.status, type: executionTasks.type, week: executionTasks.week })
            .from(executionTasks).where(eq(executionTasks.planId, plan.id));
          if (taskRows.length > 0) {
            const total = taskRows.length;
            const pending = taskRows.filter(t => t.status === "pending").length;
            const completed = taskRows.filter(t => t.status === "completed").length;
            const blocked = taskRows.filter(t => t.status === "blocked").length;
            const topTasks = taskRows.slice(0, 8).map(t => `- [${t.status}] W${t.week}: ${t.title} (${t.type})`);
            executionTaskContext = `EXECUTION TASKS (${total} total | ${pending} pending | ${completed} done | ${blocked} blocked):\n${topTasks.join("\n")}`;
          }
        } catch {}
      }
      if (planAssumptionContext) contextParts.push(planAssumptionContext);
      if (executionTaskContext) contextParts.push(executionTaskContext);

      const contextStr = contextParts.join("\n\n").substring(0, 10000);

      const response = await aiChat({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are the MarketMind AI Campaign Manager. You have full access to all 14 engine outputs, plan sections, Content DNA (8 rules governing content creation), Goal Decomposition (funnel math, feasibility, confidence), Growth Simulation (3 scenarios with bottleneck alerts), and Plan Assumptions (with confidence + impact severity).
When asked about goals, targets, or feasibility — answer from Goal Decomposition data (funnel math, feasibility verdict, time horizon).
When asked about projections, growth, or scenarios — answer from Growth Simulation (conservative/base/upside cases).
When asked about risks or assumptions — answer from Plan Assumptions and bottleneck alerts.
When asked about content creation, hooks, CTAs, narrative style — answer from Content DNA and explain why those rules were chosen.
Be specific, reference actual data, and explain the strategic reasoning. Keep your answer concise (2-4 sentences). Do not invent data not present in the context.`,
          },
          { role: "user", content: `CONTEXT:\n${contextStr}\n\nUSER QUESTION: ${question}` },
        ],
        max_tokens: 400,
        accountId,
        endpoint: "dashboard-agent-explain",
      });

      const rawText = typeof response === "string" ? response : response?.choices?.[0]?.message?.content || "";

      res.json({ success: true, answer: rawText.trim() });
    } catch (error: any) {
      console.error(`${LOG_PREFIX} Agent explain error:`, error);
      res.status(500).json({ success: false, error: "Failed to generate explanation" });
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
