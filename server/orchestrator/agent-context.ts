import { db } from "../db";
import {
  growthCampaigns,
  businessDataLayer,
  strategicPlans,
  requiredWork,
  calendarEntries,
  studioItems,
  orchestratorJobs,
  manualCampaignMetrics,
} from "@shared/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";

export interface SystemContext {
  businessProfile: any;
  campaign: any;
  activePlan: any;
  executionState: {
    status: string;
    progress: number;
    requiredWork: any;
    calendarSummary: {
      total: number;
      pending: number;
      completed: number;
    };
    studioSummary: {
      total: number;
      draft: number;
      ready: number;
      published: number;
    };
  } | null;
  performance: any;
  engineStatus: any;
  warnings: string[];
}

export async function loadSystemContext(
  accountId: string,
  campaignId: string
): Promise<SystemContext> {
  const warnings: string[] = [];

  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const [bizData] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, accountId),
        eq(businessDataLayer.campaignId, campaignId)
      )
    )
    .limit(1);

  if (!campaign) warnings.push("No active campaign found");
  if (!bizData) warnings.push("Business profile not configured");

  const [activePlan] = await db
    .select()
    .from(strategicPlans)
    .where(
      and(
        eq(strategicPlans.accountId, accountId),
        eq(strategicPlans.campaignId, campaignId),
      )
    )
    .orderBy(desc(strategicPlans.createdAt))
    .limit(1);

  let executionState = null;

  if (activePlan) {
    const [work] = await db
      .select()
      .from(requiredWork)
      .where(eq(requiredWork.planId, activePlan.id))
      .limit(1);

    const calendarStats = await db
      .select({
        total: count(),
        pending: sql<number>`count(case when status = 'PENDING' or status = 'DRAFT' then 1 end)`,
        completed: sql<number>`count(case when status = 'COMPLETED' or status = 'PUBLISHED' then 1 end)`,
      })
      .from(calendarEntries)
      .where(eq(calendarEntries.planId, activePlan.id));

    const studioStats = await db
      .select({
        total: count(),
        draft: sql<number>`count(case when status = 'DRAFT' then 1 end)`,
        ready: sql<number>`count(case when status = 'READY' then 1 end)`,
        published: sql<number>`count(case when status = 'PUBLISHED' then 1 end)`,
      })
      .from(studioItems)
      .where(eq(studioItems.planId, activePlan.id));

    const totalRequired = work?.totalContentPieces || 0;
    const totalDone = (work?.publishedCount || 0) + (work?.readyCount || 0) + (work?.generatedCount || 0);
    const progress = totalRequired > 0 ? Math.round((totalDone / totalRequired) * 100) : 0;

    executionState = {
      status: activePlan.executionStatus || "IDLE",
      progress,
      requiredWork: work ? {
        totalPieces: work.totalContentPieces,
        generated: work.generatedCount,
        ready: work.readyCount,
        published: work.publishedCount,
        failed: work.failedCount,
        remaining: (work.totalContentPieces || 0) - (work.generatedCount || 0) - (work.readyCount || 0) - (work.publishedCount || 0),
        reels: { required: work.totalReels, perWeek: work.reelsPerWeek },
        posts: { required: work.totalPosts, perWeek: work.postsPerWeek },
        stories: { required: work.totalStories, perDay: work.storiesPerDay },
        carousels: { required: work.totalCarousels, perWeek: work.carouselsPerWeek },
        videos: { required: work.totalVideos, perWeek: work.videosPerWeek },
      } : null,
      calendarSummary: {
        total: calendarStats[0]?.total || 0,
        pending: Number(calendarStats[0]?.pending) || 0,
        completed: Number(calendarStats[0]?.completed) || 0,
      },
      studioSummary: {
        total: studioStats[0]?.total || 0,
        draft: Number(studioStats[0]?.draft) || 0,
        ready: Number(studioStats[0]?.ready) || 0,
        published: Number(studioStats[0]?.published) || 0,
      },
    };

    if (activePlan.status === "DRAFT") {
      warnings.push("Active plan awaiting approval");
    }
    if (activePlan.emergencyStopped) {
      warnings.push("Plan execution has been emergency-stopped");
    }
  } else {
    warnings.push("No strategic plan generated yet. Run the orchestrator to create one.");
  }

  const [latestOrchJob] = await db
    .select()
    .from(orchestratorJobs)
    .where(
      and(
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, campaignId)
      )
    )
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(1);

  const [metrics] = await db
    .select()
    .from(manualCampaignMetrics)
    .where(eq(manualCampaignMetrics.campaignId, campaignId))
    .orderBy(desc(manualCampaignMetrics.createdAt))
    .limit(1);

  return {
    businessProfile: bizData ? {
      businessType: bizData.businessType,
      monthlyBudget: bizData.monthlyBudget,
      funnelObjective: bizData.funnelObjective,
      conversionChannel: bizData.conversionChannel,
      geoScope: bizData.geoScope,
    } : null,
    campaign: campaign ? {
      id: campaign.id,
      name: campaign.name,
      stage: campaign.stage,
      goalMode: campaign.goalMode,
      isActive: campaign.isActive,
      dayNumber: campaign.dayNumber,
      totalDays: campaign.totalDays,
    } : null,
    activePlan: activePlan ? {
      id: activePlan.id,
      status: activePlan.status,
      executionStatus: activePlan.executionStatus,
      summary: activePlan.planSummary,
      createdAt: activePlan.createdAt,
      emergencyStopped: activePlan.emergencyStopped,
    } : null,
    executionState,
    performance: metrics ? {
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      spend: metrics.spend,
      revenue: metrics.revenue,
    } : null,
    engineStatus: latestOrchJob ? {
      lastRunId: latestOrchJob.id,
      status: latestOrchJob.status,
      sections: latestOrchJob.sectionStatuses ? JSON.parse(latestOrchJob.sectionStatuses) : [],
      durationMs: latestOrchJob.durationMs,
      completedAt: latestOrchJob.completedAt,
    } : null,
    warnings,
  };
}

export function buildSystemPrompt(context: SystemContext): string {
  const lines: string[] = [];

  lines.push("You are the MarketMind AI Assistant — a strategic operations manager for marketing execution.");
  lines.push("You guide the user through their marketing plan, explain the system, suggest next actions, and help them understand what to create.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- You CANNOT replace the strategy engines or rewrite strategy arbitrarily");
  lines.push("- You CANNOT override the financial governor or budget constraints");
  lines.push("- You CANNOT create disconnected strategy outside the current approved plan");
  lines.push("- You CAN explain the plan, suggest ideas, trigger creation, and help prioritize work");
  lines.push("- Always reference the current system state below when answering");
  lines.push("");

  lines.push("=== CURRENT SYSTEM STATE ===");
  lines.push("");

  if (context.businessProfile) {
    lines.push(`BUSINESS: ${context.businessProfile.businessType} | Budget: ${context.businessProfile.monthlyBudget} | Objective: ${context.businessProfile.funnelObjective}`);
  } else {
    lines.push("BUSINESS: Not configured");
  }

  if (context.campaign) {
    lines.push(`CAMPAIGN: ${context.campaign.name} | Stage: ${context.campaign.stage} | Mode: ${context.campaign.goalMode} | Day ${context.campaign.dayNumber}/${context.campaign.totalDays}`);
  } else {
    lines.push("CAMPAIGN: None active");
  }

  if (context.activePlan) {
    lines.push(`PLAN: Status=${context.activePlan.status} | Execution=${context.activePlan.executionStatus}`);
    if (context.activePlan.summary) lines.push(`  Summary: ${context.activePlan.summary}`);
  } else {
    lines.push("PLAN: No plan generated");
  }

  if (context.executionState) {
    lines.push(`EXECUTION: Progress=${context.executionState.progress}%`);
    if (context.executionState.requiredWork) {
      const w = context.executionState.requiredWork;
      lines.push(`  Required: ${w.totalPieces} pieces | Generated: ${w.generated} | Ready: ${w.ready} | Published: ${w.published} | Remaining: ${w.remaining}`);
    }
    lines.push(`  Calendar: ${context.executionState.calendarSummary.total} entries (${context.executionState.calendarSummary.pending} pending)`);
    lines.push(`  Studio: ${context.executionState.studioSummary.total} items (${context.executionState.studioSummary.draft} draft, ${context.executionState.studioSummary.ready} ready)`);
  }

  if (context.performance) {
    lines.push(`PERFORMANCE: Impressions=${context.performance.impressions} | Clicks=${context.performance.clicks} | Conversions=${context.performance.conversions} | Spend=${context.performance.spend}`);
  }

  if (context.engineStatus) {
    lines.push(`ENGINES: Last run ${context.engineStatus.status} | ${context.engineStatus.sections?.filter((s: any) => s.status === "SUCCESS").length || 0} engines completed`);
  }

  if (context.warnings.length > 0) {
    lines.push(`WARNINGS: ${context.warnings.join(" | ")}`);
  }

  lines.push("");
  lines.push("Use this context to answer the user's questions accurately. Guide them toward their next action.");

  return lines.join("\n");
}
