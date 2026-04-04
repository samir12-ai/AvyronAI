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
  mechanismSnapshots,
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
  goalDecompositions,
  growthSimulations,
  executionTasks,
  planAssumptions,
  contentPerformanceSnapshots,
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
  sourceAvailability: any;
  contentDnaSnapshot: any;
  rootBundle: { id: string; version: number; status: string; isStale: boolean; staleReason: string | null; strategyHash: string | null } | null;
  goalDecomposition: any;
  simulation: any;
  executionTasksSummary: { total: number; pending: number; completed: number; blocked: number } | null;
  assumptionsSummary: { total: number; highImpact: number; lowConfidence: number } | null;
  contentPerformanceSummary: {
    dominantFormat: string | null;
    underperformingFormats: string[];
    totalFormatsTracked: number;
    byFormat: Record<string, { smoothedScore: number; stabilitySignal: number; lastPeriod: string; lastUpdated: any } | null>;
  } | null;
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
    .orderBy(desc(businessDataLayer.createdAt))
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
    { name: "mechanism", table: mechanismSnapshots },
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

  const safeP = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

  let goalDecomposition: any = null;
  let simulation: any = null;
  let executionTasksSummary: any = null;
  let assumptionsSummary: any = null;

  try {
    const [gd] = await db.select().from(goalDecompositions)
      .where(and(eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.status, "active")))
      .orderBy(desc(goalDecompositions.createdAt)).limit(1);
    if (gd) {
      goalDecomposition = {
        goalType: gd.goalType, goalTarget: gd.goalTarget, goalLabel: gd.goalLabel,
        timeHorizonDays: gd.timeHorizonDays, feasibility: gd.feasibility,
        feasibilityScore: gd.feasibilityScore, confidenceScore: gd.confidenceScore,
        funnelMath: safeP(gd.funnelMath),
      };
    }
  } catch {}

  try {
    const [sim] = await db.select().from(growthSimulations)
      .where(and(eq(growthSimulations.campaignId, campaignId), eq(growthSimulations.accountId, accountId), eq(growthSimulations.status, "active")))
      .orderBy(desc(growthSimulations.createdAt)).limit(1);
    if (sim) {
      simulation = {
        conservativeCase: safeP(sim.conservativeCase),
        baseCase: safeP(sim.baseCase),
        upsideCase: safeP(sim.upsideCase),
        confidenceScore: sim.confidenceScore,
        keyAssumptions: safeP(sim.keyAssumptions),
        bottleneckAlerts: safeP(sim.bottleneckAlerts),
      };
    }
  } catch {}

  if (activePlan) {
    try {
      const taskRows = await db.select({ status: executionTasks.status }).from(executionTasks)
        .where(eq(executionTasks.planId, activePlan.id));
      if (taskRows.length > 0) {
        executionTasksSummary = {
          total: taskRows.length,
          pending: taskRows.filter(t => t.status === "pending").length,
          completed: taskRows.filter(t => t.status === "completed").length,
          blocked: taskRows.filter(t => t.status === "blocked").length,
        };
      }
    } catch {}

    try {
      const assRows = await db.select().from(planAssumptions)
        .where(eq(planAssumptions.planId, activePlan.id));
      if (assRows.length > 0) {
        assumptionsSummary = {
          total: assRows.length,
          highImpact: assRows.filter(a => a.impactSeverity === "high").length,
          lowConfidence: assRows.filter(a => a.confidence === "low").length,
        };
      }
    } catch {}
  }

  let contentPerformanceSummary: SystemContext["contentPerformanceSummary"] = null;
  try {
    const CONTENT_TYPES = ["reel", "carousel", "story", "post"] as const;
    const byFormat: Record<string, { smoothedScore: number; stabilitySignal: number; lastPeriod: string; lastUpdated: any } | null> = {};
    let totalFormatsTracked = 0;
    for (const ct of CONTENT_TYPES) {
      const snaps = await db
        .select({
          smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore,
          periodLabel: contentPerformanceSnapshots.periodLabel,
          createdAt: contentPerformanceSnapshots.createdAt,
        })
        .from(contentPerformanceSnapshots)
        .where(and(eq(contentPerformanceSnapshots.accountId, accountId), eq(contentPerformanceSnapshots.campaignId, campaignId), eq(contentPerformanceSnapshots.contentType, ct)))
        .orderBy(desc(contentPerformanceSnapshots.createdAt))
        .limit(3);
      if (snaps.length === 0) { byFormat[ct] = null; continue; }
      totalFormatsTracked++;
      const scores = snaps.map((s) => s.smoothedPerformanceScore ?? 0);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 1;
      const stabilitySignal = Math.max(0, Math.min(1, 1 - cv));
      byFormat[ct] = { smoothedScore: snaps[0].smoothedPerformanceScore ?? 0, stabilitySignal, lastPeriod: snaps[0].periodLabel, lastUpdated: snaps[0].createdAt };
    }
    const tracked = Object.entries(byFormat).filter(([, v]) => v !== null).sort(([, a], [, b]) => (b!.smoothedScore) - (a!.smoothedScore));
    const avgScore = tracked.length > 0 ? tracked.reduce((acc, [, v]) => acc + v!.smoothedScore, 0) / tracked.length : 0;
    const underperformingFormats = tracked.filter(([, v]) => v!.smoothedScore < avgScore * 0.8).map(([k]) => k);
    contentPerformanceSummary = { dominantFormat: tracked[0]?.[0] || null, underperformingFormats, totalFormatsTracked, byFormat };
  } catch {}

  return {
    businessProfile: bizData ? {
      businessType: bizData.businessType,
      monthlyBudget: bizData.monthlyBudget,
      funnelObjective: bizData.funnelObjective,
      conversionChannel: bizData.primaryConversionChannel,
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
    sourceAvailability: await (async () => {
      try {
        const [miSnap] = await db.select({
          sourceAvailability: miSnapshots.sourceAvailability,
          multiSourceSignals: miSnapshots.multiSourceSignals,
        }).from(miSnapshots)
          .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
          .orderBy(desc(miSnapshots.createdAt))
          .limit(1);
        if (!miSnap?.sourceAvailability) return null;
        return typeof miSnap.sourceAvailability === "string" ? JSON.parse(miSnap.sourceAvailability) : miSnap.sourceAvailability;
      } catch { return null; }
    })(),
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
    goalDecomposition,
    simulation,
    executionTasksSummary,
    assumptionsSummary,
    contentPerformanceSummary,
    warnings,
  };
}

export function buildSystemPrompt(context: SystemContext): string {
  const lines: string[] = [];

  lines.push("You are the Avyron AI Assistant — a strategic operations manager for marketing execution.");
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

  if (context.sourceAvailability) {
    const sa = context.sourceAvailability;
    const sources: string[] = [];
    if (typeof sa.instagram === "boolean") {
      sources.push(`Instagram: ${sa.instagram ? "✓" : "✗"}`);
    } else if (sa.instagram && typeof sa.instagram === "object") {
      sources.push(`Instagram: ${sa.instagram.available ? "✓" : "✗"} (${sa.instagram.competitorCount || 0} competitors)`);
    }
    if (typeof sa.website === "boolean") {
      sources.push(`Website: ${sa.website ? "✓" : "✗"}`);
    } else if (sa.website && typeof sa.website === "object") {
      sources.push(`Website: ${sa.website.available ? "✓" : "✗"} (${sa.website.competitorCount || 0} competitors)`);
    }
    if (typeof sa.blog === "boolean") {
      sources.push(`Blog: ${sa.blog ? "✓" : "✗"}`);
    } else if (sa.blog && typeof sa.blog === "object") {
      sources.push(`Blog: ${sa.blog.available ? "✓" : "✗"} (${sa.blog.competitorCount || 0} competitors)`);
    }
    if (sources.length > 0) {
      lines.push(`DATA SOURCES: ${sources.join(" | ")}`);
    }
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

  if (context.goalDecomposition) {
    const gd = context.goalDecomposition;
    lines.push("");
    lines.push(`GOAL DECOMPOSITION: ${gd.goalLabel}`);
    lines.push(`  Type: ${gd.goalType} | Target: ${gd.goalTarget} | Time: ${gd.timeHorizonDays} days`);
    lines.push(`  Feasibility: ${gd.feasibility} (${gd.feasibilityScore}/100) | Confidence: ${gd.confidenceScore}/100`);
    if (gd.funnelMath) {
      const fm = gd.funnelMath;
      lines.push(`  Funnel: Reach ${fm.requiredReach?.toLocaleString()} → Clicks ${fm.requiredClicks?.toLocaleString()} → Conversations ${fm.requiredConversations?.toLocaleString()} → Leads ${fm.requiredLeads?.toLocaleString()} → Qualified ${fm.requiredQualifiedLeads?.toLocaleString()} → Clients ${fm.requiredClosedClients?.toLocaleString()}`);
      lines.push(`  FORECAST MODEL ASSUMPTIONS (actual rates used to compute above):`);
      lines.push(`    CTR (content-to-click): ${fm.ctr != null ? (fm.ctr * 100).toFixed(1) + "%" : "2.5% (default)"}`);
      lines.push(`    Click-to-Conversation: ${fm.clickToConversationRate != null ? (fm.clickToConversationRate * 100).toFixed(0) + "%" : "30% (default)"}`);
      lines.push(`    Conversation-to-Lead: ${fm.conversationToLeadRate != null ? (fm.conversationToLeadRate * 100).toFixed(0) + "%" : "50% (default)"}`);
      lines.push(`    Lead Qualification Rate: 20% (fixed)`);
      lines.push(`    Lead-to-Client (Close Rate): ${fm.closeRate != null ? (fm.closeRate * 100).toFixed(0) + "%" : "10% (default)"}`);
      lines.push(`    Content-to-Lead Rate: ${fm.contentToLeadRate != null ? (fm.contentToLeadRate * 100).toFixed(1) + "%" : "2% (fixed)"}`);
      lines.push(`  These assumptions come from the user's business profile (closeRate, ctr, conversionRate fields). If not set, defaults apply. Ask the user to update their Business Profile to improve forecast accuracy.`);
    }
  }

  if (context.simulation) {
    const sim = context.simulation;
    lines.push("");
    lines.push(`GROWTH SIMULATION: Confidence ${sim.confidenceScore}/100`);
    if (sim.conservativeCase) lines.push(`  Conservative: ${sim.conservativeCase.expectedCustomers || sim.conservativeCase.expectedLeads || "N/A"} (${sim.conservativeCase.achievementPct || 70}%)`);
    if (sim.baseCase) lines.push(`  Base: ${sim.baseCase.expectedCustomers || sim.baseCase.expectedLeads || "N/A"} (${sim.baseCase.achievementPct || 100}%)`);
    if (sim.upsideCase) lines.push(`  Upside: ${sim.upsideCase.expectedCustomers || sim.upsideCase.expectedLeads || "N/A"} (${sim.upsideCase.achievementPct || 115}%)`);
    if (sim.bottleneckAlerts?.length) lines.push(`  Bottlenecks: ${sim.bottleneckAlerts.join(", ")}`);
  }

  if (context.executionTasksSummary) {
    const ts = context.executionTasksSummary;
    lines.push("");
    lines.push(`EXECUTION TASKS: ${ts.total} total | ${ts.pending} pending | ${ts.completed} completed | ${ts.blocked} blocked`);
  }

  if (context.assumptionsSummary) {
    const as_ = context.assumptionsSummary;
    lines.push("");
    lines.push(`ASSUMPTIONS: ${as_.total} total | ${as_.highImpact} high-impact | ${as_.lowConfidence} low-confidence`);
    if (as_.highImpact > 0 || as_.lowConfidence > 0) {
      lines.push("  Warning: Plan has assumptions that could significantly affect outcomes. Review before publishing.");
    }
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

  if (context.contentPerformanceSummary) {
    const cp = context.contentPerformanceSummary;
    lines.push("");
    lines.push(`CONTENT PERFORMANCE (${cp.totalFormatsTracked} formats tracked):`);
    if (cp.dominantFormat) lines.push(`  Best performing: ${cp.dominantFormat.toUpperCase()}`);
    if (cp.underperformingFormats.length > 0) lines.push(`  Underperforming: ${cp.underperformingFormats.map(f => f.toUpperCase()).join(", ")}`);
    for (const [fmt, data] of Object.entries(cp.byFormat)) {
      if (!data) { lines.push(`  ${fmt.toUpperCase()}: No data yet`); continue; }
      const stability = data.stabilitySignal >= 0.7 ? "stable" : data.stabilitySignal >= 0.4 ? "moderate" : "unstable";
      lines.push(`  ${fmt.toUpperCase()}: score=${data.smoothedScore.toFixed(3)} | signal=${stability} (${data.stabilitySignal.toFixed(2)}) | period="${data.lastPeriod}"`);
    }
    lines.push(`  Note: scores are smoothed (3-period rolling avg). Volume-penalized when <3 pieces published.`);
  } else {
    lines.push("");
    lines.push("CONTENT PERFORMANCE: No data logged yet. Ask user to log performance via Business Profile > Content Performance.");
  }

  if (context.warnings.length > 0) {
    lines.push(`WARNINGS: ${context.warnings.join(" | ")}`);
  }

  lines.push("");
  lines.push("CONTENT RHYTHM MODEL (canonical source — all UI views must agree):");
  lines.push("  Content volume is computed deterministically from funnel objective, NOT by AI:");
  lines.push("    AWARENESS/FOLLOWERS objective → 5 Reels/wk, 2 Carousels/wk");
  lines.push("    SALES/REVENUE objective → 4 Reels/wk, 3 Carousels/wk");
  lines.push("    All other objectives → 4 Reels/wk, 2 Carousels/wk");
  lines.push("    Posts: always 1/wk | Stories: always 2/day");
  lines.push("  The build-plan-layer enforces these exact numbers. The execution plan, strategy hub, and plan document all read from the same locked values.");

  lines.push("");
  lines.push("ENGINE PIPELINE CONTRACTS (8-engine sequential pipeline):");
  lines.push("  1. Audience Engine → outputs: painMap, desireMap, objectionMap, awarenessLevel, maturityIndex, audienceSegments");
  lines.push("  2. Positioning Engine → outputs: territories, contrastAxis, enemyDefinition, narrativeDirection");
  lines.push("  3. Differentiation Engine → outputs: differentiationPillars, claimCollisionCheck, proofArchitecture, mechanismCandidate");
  lines.push("  4. Mechanism Engine → outputs: primaryMechanism (name+steps), mechanismLogic (Cause→Intervention→Outcome), axisAlignment");
  lines.push("  5. Offer Engine → outputs: transformationStatement, coreOutcome, deliveryStructure, riskReductionLayer");
  lines.push("  6. Awareness Engine → outputs: marketEntryRoute, attentionTrigger, awarenessStageMapping");
  lines.push("  7. Persuasion Engine → outputs: objectionMap (by type+stage), objectionProofLinks, persuasionMode, trustSequence");
  lines.push("  8. Funnel Engine → outputs: funnelType, stageMap, trustPath, entryTriggerMechanism");
  lines.push("  Each engine's output is a LOCK for the next. Positioning axis forces differentiation pillars. Mechanism name becomes the offer's 'how'. Awareness entry route forces funnel's first stage.");

  lines.push("");
  lines.push("Use this context to answer the user's questions accurately. Guide them toward their next action. When users ask about content creation, hooks, CTAs, or narrative style, reference the Content DNA rules. When users ask about plan integrity or staleness, reference the Root Bundle status. When users ask why forecast numbers are what they are, explain the FORECAST MODEL ASSUMPTIONS above and offer to help them update their Business Profile to improve accuracy.");

  return lines.join("\n");
}
