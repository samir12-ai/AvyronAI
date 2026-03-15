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
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  integritySnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
  contentDna,
  rootBundles,
} from "@shared/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { getActiveRootBundle, detectStaleness } from "../root-bundle";

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
  engineSnapshots: Record<string, { id: string; status: string; createdAt: any }>;
  contentDnaSnapshot: any;
  rootBundle: { id: string; version: number; status: string; isStale: boolean; staleReason: string | null; strategyHash: string | null } | null;
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

  const engineSnapshots: Record<string, { id: string; status: string; createdAt: any }> = {};
  const snapshotTablesWithStatus = [
    { name: "market_intelligence", table: miSnapshots },
    { name: "positioning", table: positioningSnapshots },
    { name: "differentiation", table: differentiationSnapshots },
    { name: "offer", table: offerSnapshots },
    { name: "funnel", table: funnelSnapshots },
    { name: "integrity", table: integritySnapshots },
    { name: "awareness", table: awarenessSnapshots },
    { name: "persuasion", table: persuasionSnapshots },
    { name: "statistical_validation", table: strategyValidationSnapshots },
    { name: "budget_governor", table: budgetGovernorSnapshots },
    { name: "channel_selection", table: channelSelectionSnapshots },
    { name: "iteration", table: iterationSnapshots },
    { name: "retention", table: retentionSnapshots },
  ] as const;

  for (const { name, table } of snapshotTablesWithStatus) {
    try {
      const [snap] = await db
        .select({ id: table.id, status: table.status, createdAt: table.createdAt })
        .from(table)
        .where(and(eq(table.campaignId, campaignId), eq(table.accountId, accountId)))
        .orderBy(desc(table.createdAt))
        .limit(1);
      if (snap) {
        engineSnapshots[name] = { id: snap.id, status: snap.status || "COMPLETE", createdAt: snap.createdAt };
      }
    } catch {}
  }

  try {
    const [audSnap] = await db
      .select({ id: audienceSnapshots.id, createdAt: audienceSnapshots.createdAt })
      .from(audienceSnapshots)
      .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
      .orderBy(desc(audienceSnapshots.createdAt))
      .limit(1);
    if (audSnap) {
      engineSnapshots["audience"] = { id: audSnap.id, status: "COMPLETE", createdAt: audSnap.createdAt };
    }
  } catch {}

  let dnaData: any = null;
  try {
    const [dnaRow] = await db.select({
      snapshot: contentDna.snapshot,
      messagingCore: contentDna.messagingCore,
      ctaDna: contentDna.ctaDna,
      hookDna: contentDna.hookDna,
      narrativeDna: contentDna.narrativeDna,
      executionRules: contentDna.executionRules,
    }).from(contentDna)
      .where(and(eq(contentDna.accountId, accountId), eq(contentDna.campaignId, campaignId), eq(contentDna.status, "active")))
      .orderBy(desc(contentDna.generatedAt))
      .limit(1);
    if (dnaRow) {
      const safeP = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
      dnaData = {
        snapshot: safeP(dnaRow.snapshot),
        messagingCore: safeP(dnaRow.messagingCore),
        ctaDna: safeP(dnaRow.ctaDna),
        hookDna: safeP(dnaRow.hookDna),
        narrativeDna: safeP(dnaRow.narrativeDna),
        executionRules: safeP(dnaRow.executionRules),
      };
    }
  } catch {}

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
    engineSnapshots,
    contentDnaSnapshot: dnaData,
    rootBundle: await (async () => {
      try {
        const active = await getActiveRootBundle(campaignId, accountId);
        if (!active) return null;
        const staleness = await detectStaleness(campaignId, accountId);
        return {
          id: active.id,
          version: active.version,
          status: staleness.isStale ? "stale" : active.status,
          isStale: staleness.isStale,
          staleReason: staleness.reason,
          strategyHash: active.strategyHash,
        };
      } catch { return null; }
    })(),
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

  const snapKeys = Object.keys(context.engineSnapshots || {});
  if (snapKeys.length > 0) {
    lines.push(`ENGINE SNAPSHOTS (${snapKeys.length}/14 available):`);
    for (const [name, snap] of Object.entries(context.engineSnapshots)) {
      lines.push(`  ${name}: ${snap.status} (${snap.createdAt ? new Date(snap.createdAt).toLocaleDateString() : "unknown date"})`);
    }
    const missing = [
      "market_intelligence", "audience", "positioning", "differentiation",
      "offer", "funnel", "integrity", "awareness", "persuasion",
      "statistical_validation", "budget_governor", "channel_selection",
      "iteration", "retention"
    ].filter(e => !context.engineSnapshots[e]);
    if (missing.length > 0) {
      lines.push(`  Missing: ${missing.join(", ")}`);
    }
  } else {
    lines.push("ENGINE SNAPSHOTS: None available — run orchestrator to generate");
  }

  if (context.contentDnaSnapshot) {
    const d = context.contentDnaSnapshot;
    lines.push("");
    lines.push("CONTENT DNA (governs all content creation):");
    if (d.snapshot) {
      const s = d.snapshot;
      lines.push(`  CTA: ${s.ctaType || "N/A"} | Hook: ${s.hookStyle || "N/A"} (${s.hookDuration || "N/A"}) | Narrative: ${s.narrativeStyle || "N/A"} | Tone: ${s.toneStyle || "N/A"} | Format: ${s.formatPriority || "N/A"}`);
    }
    if (d.executionRules) {
      if (d.executionRules.alwaysInclude?.length) lines.push(`  Always include: ${d.executionRules.alwaysInclude.join(", ")}`);
      if (d.executionRules.neverDo?.length) lines.push(`  Never do: ${d.executionRules.neverDo.join(", ")}`);
    }
  } else {
    lines.push("");
    lines.push("CONTENT DNA: Not generated yet — runs automatically after plan synthesis");
  }

  if (context.rootBundle) {
    lines.push("");
    lines.push(`ROOT BUNDLE: v${context.rootBundle.version} | Status: ${context.rootBundle.status} | Hash: ${context.rootBundle.strategyHash}`);
    if (context.rootBundle.isStale) {
      lines.push(`  ⚠ STALE: ${context.rootBundle.staleReason}`);
      lines.push("  The plan's foundation data has changed since it was locked. Recommend re-running the orchestrator to regenerate the plan with fresh roots.");
    }
  } else {
    lines.push("");
    lines.push("ROOT BUNDLE: Not yet created — will be auto-generated on next plan synthesis");
  }

  if (context.warnings.length > 0) {
    lines.push(`WARNINGS: ${context.warnings.join(" | ")}`);
  }

  lines.push("");
  lines.push("Use this context to answer the user's questions accurately. Guide them toward their next action. When users ask about content creation, hooks, CTAs, or narrative style, reference the Content DNA rules. When users ask about plan integrity or staleness, reference the Root Bundle status.");

  return lines.join("\n");
}
