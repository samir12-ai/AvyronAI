import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { calculatePeriodBounds } from "../reports/monthly-report-engine";
import { resolveExecutionPlan } from "../orchestrator/execution-plan-resolver";
import { normalizeTimestampToIsoUtc, normalizeTimestampToUtcDate } from "../utils/timestamp";

export interface DashboardOverviewPayload {
  user: {
    firstName: string;
    fullName: string;
    role: string;
    email?: string;
  };
  lastUpdated: string;
  businessPulse: {
    strategy: {
      version: number;
      activePlanVersion: number;
      rootBundleVersion: number;
      totalPlanRevisions: number;
      status: "ACTIVE" | "PENDING_APPROVAL" | "NO_PLAN";
      label: string;
    };
    market: {
      confirmedChangesMonthCount: number;
      candidatesMonthCount: number;
      label: string;
      subtext: string;
    };
    performance: {
      status: "ON_TRACK" | "DEVIATION" | "INSUFFICIENT_DATA";
      headline: string;
      subtext: string;
      severity?: "HIGH" | "MEDIUM" | "LOW";
    };
    execution: {
      tasksTodayCount: number;
      completedTodayCount: number;
      label: string;
    };
  };
  aiSummaryStrip: {
    text: string;
    priorityLevel: "ACTION_REQUIRED" | "WARNING" | "MARKET_SHIFT" | "STABLE" | "NO_DATA";
  };
  whatToDoTodayCard: {
    count: number;
    tasks: Array<{
      id: string;
      order: number;
      title: string;
      priorityBadge: string;
      priorityColor: "red" | "orange" | "blue";
      status: string;
      laneTitle?: string;
      channel?: string;
    }>;
  };
  strategyPlanCard: {
    version: number;
    activePlanVersion: number;
    rootBundleVersion: number;
    totalPlanRevisions: number;
    status: "ACTIVE" | "PENDING_APPROVAL" | "NO_PLAN";
    primaryDirection: string;
    activeLanesCount: number;
    latestMaterialChange: {
      summary: string;
      authority: string;
      laneTitle?: string;
      occurredAt?: string;
      relativeTime: string;
      isAcknowledged: boolean;
    } | null;
  };
  performanceCard: {
    kpis: Array<{
      name: string;
      metricKey: string;
      actual: number | string | null;
      planTarget: number | string | null;
      unit: string;
      variancePercent: number | null;
      status: "ON_TRACK" | "ABOVE_PLAN" | "BELOW_PLAN" | "NOT_AVAILABLE";
      direction: "up" | "down" | "neutral";
    }>;
    mainConcernOrInsight: string;
    status: "ON_TRACK" | "DEVIATION" | "INSUFFICIENT_DATA";
    isHealthy: boolean;
    /** Evaluated historical actions (same data as the Performance Loop section). */
    evaluatedCases?: Array<{
      id: string;
      caseNumber: number;
      title: string;
      outcomeType: string;
      outcomeBadgeLabel: string;
      outcomeColor: string;
      channel: string;
      headlineMetric: string;
      headlineDelta: string;
    }>;
    evaluatedSummary?: string;
    simulated?: boolean;
  };
  watchtowerCard: {
    confirmedCount: number;
    candidatesCount: number;
    recentConfirmedEvents: Array<{
      id: string;
      competitorName: string;
      kind: string;
      title: string;
      oldValue?: string;
      newValue?: string;
      occurredAt: string;
    }>;
  };
  reasoningCard: {
    activeInvestigationsCount: number;
    investigationState:
      | "STRATEGIC_REVIEW_REQUIRED"
      | "STRATEGIC_SIGNALS_PENDING"
      | "DEEP_REASONING_COMPLETE"
      | "INVESTIGATION_IN_PROGRESS"
      | "NO_ACTIVE_INVESTIGATION";
    headline: string;
    summary: string;
    statusLabel: string;
    caseId?: string;
    proposalId?: string;
    /** Strategic signals and their investigation state (same data as the Deep Reasoning section). */
    signals?: Array<{
      scenarioId: string;
      eventId: string;
      title: string;
      lane: string;
      status: "READY_FOR_INVESTIGATION" | "PATCH_READY" | "APPLIED";
      statusLabel: string;
      appliedVersion: number | null;
    }>;
  };
  reportsCard: {
    latestReport: {
      id: string;
      periodLabel: string;
      performanceSummary: string;
      strategyChangesCount: number;
      marketChangesCount: number;
      executionCompletionPercent: number;
      status: "FINALIZED" | "IN_PROGRESS";
    } | null;
  };
  recentActivity: Array<{
    id: string;
    type: "strategy" | "reasoning" | "market" | "report" | "execution" | "performance";
    icon: string;
    iconColor: string;
    relativeTime: string;
    title: string;
    subtitle: string;
    targetRoute: string;
  }>;
}

function getRelativeTime(timestamp: Date | string | null | undefined): string {
  if (!timestamp) return "Recently";
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export async function assembleDashboardOverview(
  accountId: string,
  campaignId: string,
  userId?: string,
  userRole?: string
): Promise<DashboardOverviewPayload> {
  const now = new Date();
  const timezone = "Asia/Dubai";

  // 1. User Identity
  let firstName = "Leader";
  let fullName = "Account Owner";
  let role = userRole || "Owner";
  let email = undefined;

  if (userId) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (user) {
      fullName = user.username || user.email?.split("@")[0] || "User";
      firstName = fullName.split(" ")[0];
      email = user.email || undefined;
    }
  }

  // 2. Strategy Plan & Version
  const [designatedPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(
      and(
        eq(schema.strategicPlans.campaignId, campaignId),
        eq(schema.strategicPlans.accountId, accountId),
        eq(schema.strategicPlans.isDesignatedActive, true),
        eq(schema.strategicPlans.status, "APPROVED")
      )
    )
    .limit(1);

  const [latestApprovedPlan] = designatedPlan
    ? [designatedPlan]
    : await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.campaignId, campaignId),
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.status, "APPROVED")
          )
        )
        .orderBy(desc(schema.strategicPlans.updatedAt))
        .limit(1);

  const [candidateDraftPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(
      and(
        eq(schema.strategicPlans.campaignId, campaignId),
        eq(schema.strategicPlans.accountId, accountId),
        eq(schema.strategicPlans.status, "DRAFT")
      )
    )
    .orderBy(desc(schema.strategicPlans.updatedAt))
    .limit(1);

  const activePlan = designatedPlan || latestApprovedPlan || candidateDraftPlan || null;
  const isApprovedLive = !!(designatedPlan || latestApprovedPlan);
  const isDraftOnly = !isApprovedLive && !!candidateDraftPlan;
  const hasPlan = !!activePlan;
  let planData: any = null;
  const rawPlanPayload = (activePlan as any)?.planJson || (activePlan as any)?.planData;
  if (rawPlanPayload) {
    try {
      planData = typeof rawPlanPayload === "string" ? JSON.parse(rawPlanPayload) : rawPlanPayload;
    } catch {}
  }

  const rootBundle = planData?.rootBundle;
  const allCampaignPlans = await db
    .select({ id: schema.strategicPlans.id })
    .from(schema.strategicPlans)
    .where(
      and(
        eq(schema.strategicPlans.campaignId, campaignId),
        eq(schema.strategicPlans.accountId, accountId)
      )
    );
  const totalPlanRevisions = allCampaignPlans.length;
  const activePlanVersion = hasPlan ? (activePlan?.version || 1) : 0;
  const rootBundleVersion = hasPlan
    ? ((activePlan as any)?.rootBundleVersion || rootBundle?.bundleVersion || rootBundle?.version || activePlanVersion)
    : 0;
  const currentStrategyVersion = activePlanVersion;
  const primaryDirection = hasPlan
    ? (rootBundle?.spine?.positioning ||
        planData?.positioning?.statement ||
        planData?.brandSpine?.corePositioningStatement ||
        activePlan?.planSummary ||
        "Active Strategic Plan")
    : "Strategy not generated yet";
  const activeLanesCount =
    hasPlan && Array.isArray(planData?.approvedLanes)
      ? planData.approvedLanes.length
      : hasPlan && rootBundle?.lanes && Array.isArray(rootBundle.lanes)
        ? rootBundle.lanes.length
        : hasPlan
          ? 2
          : 0;

  // 3. Proposals & Material Changes
  const proposals = await db
    .select()
    .from(schema.strategyChangeProposals)
    .where(
      and(
        eq(schema.strategyChangeProposals.campaignId, campaignId),
        eq(schema.strategyChangeProposals.accountId, accountId)
      )
    )
    .orderBy(desc(schema.strategyChangeProposals.createdAt))
    .limit(5);

  const pendingProposal = proposals.find(p => p.status === "PENDING_USER_APPROVAL");
  const latestAppliedProposal = proposals.find(p => p.status === "APPLIED" || p.appliedAt !== null) || (hasPlan ? proposals[0] : undefined);

  let latestMaterialChange: DashboardOverviewPayload["strategyPlanCard"]["latestMaterialChange"] = null;
  if (latestAppliedProposal) {
    const affectedAuths = Array.isArray(latestAppliedProposal.affectedAuthorities) ? latestAppliedProposal.affectedAuthorities : [];
    const authName = affectedAuths[0] || "DIFFERENTIATION";
    const propMeta = (typeof latestAppliedProposal.metadata === "string"
      ? JSON.parse(latestAppliedProposal.metadata)
      : latestAppliedProposal.metadata) as any;
    const affectedLanes = Array.isArray(latestAppliedProposal.affectedLaneIds) ? latestAppliedProposal.affectedLaneIds : [];
    const laneName = propMeta?.affectedLaneNames?.[0] || (affectedLanes[0] ? affectedLanes[0] : undefined);
    const changeDate = latestAppliedProposal.appliedAt || latestAppliedProposal.createdAt;

    const acks = await db
      .select()
      .from(schema.strategyChangeAcknowledgements)
      .where(
        and(
          eq(schema.strategyChangeAcknowledgements.campaignId, campaignId),
          eq(schema.strategyChangeAcknowledgements.rootBundleVersion, rootBundleVersion || currentStrategyVersion)
        )
      )
      .limit(1);

    latestMaterialChange = {
      summary: latestAppliedProposal.summary || `${authName} updated${laneName ? ` for ${laneName}` : ""}`,
      authority: authName,
      laneTitle: laneName,
      occurredAt: changeDate ? changeDate.toISOString() : undefined,
      relativeTime: getRelativeTime(changeDate),
      isAcknowledged: acks.length > 0,
    };
  }

  // 4. Watchtower Market Events (Campaign Telemetry)
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const { periodStart, periodEnd } = calculatePeriodBounds(currentYear, currentMonth, timezone, now);

  const watchtowerEvents = await db
    .select({
      event: schema.pipelineChangeEvents,
      competitor: schema.ciCompetitors,
    })
    .from(schema.pipelineChangeEvents)
    .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
    .where(
      and(
        eq(schema.pipelineChangeEvents.campaignId, campaignId),
        eq(schema.pipelineChangeEvents.accountId, accountId)
      )
    )
    .orderBy(desc(schema.pipelineChangeEvents.createdAt));

  const confirmedEvents = watchtowerEvents.filter(row => row.event.status === "confirmed");
  const candidateEvents = watchtowerEvents.filter(row => row.event.status === "candidate");

  const recentConfirmedEvents: DashboardOverviewPayload["watchtowerCard"]["recentConfirmedEvents"] = [];
  for (const { event: ev, competitor } of confirmedEvents.slice(0, 3)) {
    let evObj: any = {};
    try {
      if (ev.evidence) {
        evObj = typeof ev.evidence === "string" ? JSON.parse(ev.evidence) : ev.evidence;
      }
    } catch {}

    const compName = competitor?.name || "Competitor";
    let title = evObj.title || (ev as any).evidenceSummary || evObj.headline || "";
    if (!title) {
      if (ev.kind === "pricing_change") {
        title = `${compName} pricing strategy shift`;
      } else if (ev.kind === "offer_type_shift" || ev.kind === "offer_language_change") {
        title = `${compName} offer & packaging shift`;
      } else {
        title = `${compName} shift in ${(ev.kind || "market posture").replace(/_/g, " ")}`;
      }
    }

    recentConfirmedEvents.push({
      id: ev.id,
      competitorName: compName,
      kind: ev.kind,
      title,
      oldValue: evObj.oldValue || (ev as any).beforeState || undefined,
      newValue: evObj.newValue || (ev as any).afterState || undefined,
      occurredAt: ev.createdAt.toISOString(),
    });
  }

  // 5. Performance Loop Data (Query actual snapshots or manual metrics)
  const performanceRows = await db
    .select()
    .from(schema.performanceSnapshots)
    .where(
      and(
        eq(schema.performanceSnapshots.campaignId, campaignId),
        eq(schema.performanceSnapshots.accountId, accountId)
      )
    )
    .orderBy(desc(schema.performanceSnapshots.fetchedAt))
    .limit(1);

  const manualMetricsRows = await db
    .select()
    .from(schema.manualCampaignMetrics)
    .where(
      and(
        eq(schema.manualCampaignMetrics.campaignId, campaignId),
        eq(schema.manualCampaignMetrics.accountId, accountId)
      )
    )
    .orderBy(desc(schema.manualCampaignMetrics.updatedAt))
    .limit(1);

  let kpis: DashboardOverviewPayload["performanceCard"]["kpis"] = [];
  let performanceStatus: DashboardOverviewPayload["businessPulse"]["performance"]["status"] = "INSUFFICIENT_DATA";
  let performanceHeadline = "Insufficient Data";
  let performanceSubtext = "No metrics connected";
  let mainConcernOrInsight = "No performance issue needs your attention.";
  let isHealthy = true;

  const pRow = performanceRows[0];
  const mRow = manualMetricsRows[0];

  if (pRow || mRow) {
    const rawReach = mRow?.impressions ?? (pRow?.factualMetrics as any)?.totalReach ?? (pRow?.factualMetrics as any)?.reach ?? null;
    const rawClicks = mRow?.clicks ?? (pRow?.factualMetrics as any)?.totalClicks ?? (pRow?.factualMetrics as any)?.clicks ?? null;
    const rawLeads = mRow?.leads ?? (pRow?.factualMetrics as any)?.leads ?? null;
    const rawConversions = mRow?.conversions ?? (pRow?.factualMetrics as any)?.conversions ?? null;

    const reachTarget = 25000;
    const clicksTarget = 1200;
    const leadsTarget = 150;
    const convTarget = 45;

    const buildKpi = (name: string, key: string, actual: number | null, target: number, unit: string) => {
      if (actual === null || actual === undefined) {
        return {
          name,
          metricKey: key,
          actual: null,
          planTarget: target,
          unit,
          variancePercent: null,
          status: "NOT_AVAILABLE" as const,
          direction: "neutral" as const,
        };
      }
      const variance = target > 0 ? +(((actual - target) / target) * 100).toFixed(1) : 0;
      const status = variance >= 0 ? ("ABOVE_PLAN" as const) : ("BELOW_PLAN" as const);
      const direction = variance >= 0 ? ("up" as const) : ("down" as const);
      return {
        name,
        metricKey: key,
        actual,
        planTarget: target,
        unit,
        variancePercent: variance,
        status,
        direction,
      };
    };

    kpis = [
      buildKpi("Reach", "reach", rawReach, reachTarget, "accounts"),
      buildKpi("Clicks", "clicks", rawClicks, clicksTarget, "clicks"),
      buildKpi("Leads", "leads", rawLeads, leadsTarget, "leads"),
      buildKpi("Conversions", "conversions", rawConversions, convTarget, "signups"),
    ];

    const hasUnderperforming = kpis.some(k => k.status === "BELOW_PLAN");
    const leadKpi = kpis.find(k => k.metricKey === "leads");
    
    if (leadKpi && leadKpi.status === "BELOW_PLAN") {
      performanceHeadline = `Leads ${Math.abs(leadKpi.variancePercent || 0)}%`;
      performanceSubtext = "below plan";
      performanceStatus = "DEVIATION";
      mainConcernOrInsight = "Traffic is growing, but lead conversion is below target.";
      isHealthy = false;
    } else if (hasUnderperforming) {
      performanceHeadline = "Deviation";
      performanceSubtext = "Below target";
      performanceStatus = "DEVIATION";
      mainConcernOrInsight = "Some metrics are below plan target.";
      isHealthy = false;
    } else {
      performanceHeadline = "On Track";
      performanceSubtext = "Meeting targets";
      performanceStatus = "ON_TRACK";
      mainConcernOrInsight = "Performance is currently on track across primary channels.";
      isHealthy = true;
    }
  }

  // 6. WTDT Tasks (Today) - scoped strictly to designated active execution plan or dailyExecutionTasks
  let taskRows: (typeof schema.executionTasks.$inferSelect)[] = [];
  const execPlanRes = await resolveExecutionPlan({ accountId, campaignId, intent: "execution" });
  if (execPlanRes.canExecute && execPlanRes.plan) {
    taskRows = await db
      .select()
      .from(schema.executionTasks)
      .where(
        and(
          eq(schema.executionTasks.campaignId, campaignId),
          eq(schema.executionTasks.accountId, accountId),
          eq(schema.executionTasks.planId, execPlanRes.plan.id),
        )
      )
      .orderBy(desc(schema.executionTasks.createdAt))
      .limit(10);
  }

  const activeTasks = taskRows.filter(t => t.status !== "CANCELLED" && t.status !== "REPLACED" && t.status !== "SUPERSEDED_UNAPPROVED_DRAFT" && t.status !== "DRAFT");
  let priorityTasks: DashboardOverviewPayload["whatToDoTodayCard"]["tasks"] = activeTasks.slice(0, 3).map((t, idx) => ({
    id: t.id,
    order: idx + 1,
    title: t.title,
    priorityBadge: idx === 0 ? "MUST DO" : (idx === 1 ? "STRATEGY UPDATED" : "SHOULD DO"),
    priorityColor: idx === 0 ? "red" : (idx === 1 ? "orange" : "blue"),
    status: t.status,
    laneTitle: t.strategicLaneId || "Primary Strategic Lane",
    channel: t.channel || "general",
  }));
  let completedTodayCount = activeTasks.filter(t => t.status === "COMPLETED").length;

  if (priorityTasks.length === 0) {
    const dailyRows = await db
      .select()
      .from(schema.dailyExecutionTasks)
      .where(eq(schema.dailyExecutionTasks.campaignId, campaignId))
      .orderBy(schema.dailyExecutionTasks.sequenceOrder)
      .limit(10);
    if (dailyRows.length > 0) {
      completedTodayCount = dailyRows.filter(t => t.status === "DONE").length;
      priorityTasks = dailyRows.slice(0, 3).map((t, idx) => ({
        id: t.id,
        order: idx + 1,
        title: t.title,
        priorityBadge: t.priority === "MUST_DO" ? "MUST DO" : t.priority === "SHOULD_DO" ? "SHOULD DO" : "OPTIONAL",
        priorityColor: t.priority === "MUST_DO" ? "red" : t.priority === "SHOULD_DO" ? "orange" : "blue",
        status: t.status === "DONE" ? "COMPLETED" : t.status,
        laneTitle: t.laneId || "Primary Gift Box Lane",
        channel: t.channel || "instagram",
      }));
    }
  }
  const tasksTodayCount = priorityTasks.length;

  // 7. Reasoning Card
  let investigationState: DashboardOverviewPayload["reasoningCard"]["investigationState"] = "NO_ACTIVE_INVESTIGATION";
  let reasoningHeadline = "No active investigation right now.";
  let reasoningSummary = "All market and strategic telemetry is currently stable.";
  let reasoningStatusLabel = "All Clear";
  let proposalId: string | undefined = undefined;
  let activeInvestigationsCount = 0;

  if (pendingProposal) {
    investigationState = "STRATEGIC_REVIEW_REQUIRED";
    reasoningHeadline = "Strategic Review Required";
    reasoningSummary = pendingProposal.summary;
    reasoningStatusLabel = "Action Required";
    proposalId = pendingProposal.id;
    activeInvestigationsCount = 1;
  } else if (latestAppliedProposal) {
    investigationState = "DEEP_REASONING_COMPLETE";
    reasoningHeadline = latestAppliedProposal.title || latestAppliedProposal.summary || "Strategic Adaptation Complete";
    reasoningSummary = latestAppliedProposal.summary || "Strategic reasoning applied.";
    reasoningStatusLabel = "Deep Reasoning Complete";
    proposalId = latestAppliedProposal.id;
    activeInvestigationsCount = 1;
  }

  // 8. Latest Monthly Report
  const reportRows = await db
    .select()
    .from(schema.monthlyReports)
    .where(
      and(
        eq(schema.monthlyReports.campaignId, campaignId),
        eq(schema.monthlyReports.accountId, accountId)
      )
    )
    .orderBy(desc(schema.monthlyReports.reportPeriodYear), desc(schema.monthlyReports.reportPeriodMonth))
    .limit(1);

  let latestReportItem: DashboardOverviewPayload["reportsCard"]["latestReport"] = null;
  if (reportRows.length > 0) {
    const rep = reportRows[0];
    const p = (rep.reportPayload || {}) as any;
    latestReportItem = {
      id: rep.id,
      periodLabel: p.periodLabel || `${rep.reportPeriodYear}-${rep.reportPeriodMonth}`,
      performanceSummary: p.performanceVsPlan?.kpis?.some((k: any) => k.status === "BELOW_PLAN") ? "Mixed" : "On Track",
      strategyChangesCount: p.strategyEvolution?.totalMaterialUpdates || 0,
      marketChangesCount: p.marketAndWatchtower?.confirmedEventsCount || 0,
      executionCompletionPercent: p.executionSummary?.completionRatePercent || 0,
      status: rep.status as "FINALIZED" | "IN_PROGRESS",
    };
  }

  // 9. AI Summary Strip
  let aiSummaryText = "Your strategy is stable, but lead conversion needs attention this week.";
  let priorityLevel: DashboardOverviewPayload["aiSummaryStrip"]["priorityLevel"] = "WARNING";

  if (!hasPlan) {
    aiSummaryText = "Strategy has not been generated yet. Open Strategy Plan to create your baseline.";
    priorityLevel = "NO_DATA";
  } else if (pendingProposal) {
    aiSummaryText = `Strategic update pending approval for ${latestAppliedProposal?.summary || "Funnel Optimization"}.`;
    priorityLevel = "ACTION_REQUIRED";
  } else if (performanceStatus === "DEVIATION") {
    aiSummaryText = "Your strategy is stable, but lead conversion needs attention this week.";
    priorityLevel = "WARNING";
  } else if (confirmedEvents.length > 0) {
    aiSummaryText = "Watchtower confirmed competitor pricing movement; strategic differentiation remains strong.";
    priorityLevel = "MARKET_SHIFT";
  } else {
    aiSummaryText = "All campaign systems and execution workflows are active and on track.";
    priorityLevel = "STABLE";
  }

  // 9b. Demo-only enrichment: the Performance Loop and Reasoning cards read the SAME data
  // as their own sections (historical evaluated cases / strategic signals + proposals).
  let evaluatedCases: DashboardOverviewPayload["performanceCard"]["evaluatedCases"] = undefined;
  let evaluatedSummary: string | undefined = undefined;
  let reasoningSignals: DashboardOverviewPayload["reasoningCard"]["signals"] = undefined;

  if (process.env.AVYRON_DEMO_MODE === "1" && hasPlan) {
    const { DEMO_PERFORMANCE_LOOP_CASES, DEMO_DEEP_REASONING_SCENARIOS } = await import(
      "../demo/scenarios-extension"
    );

    // --- Performance Loop card: evaluated historical actions (simulated) ---
    if (kpis.length === 0 && DEMO_PERFORMANCE_LOOP_CASES.length > 0) {
      evaluatedCases = DEMO_PERFORMANCE_LOOP_CASES.map((c) => {
        const m: any = c.metrics[c.metrics.length - 1] || c.metrics[0];
        return {
          id: c.id,
          caseNumber: c.caseNumber,
          title: c.title,
          outcomeType: c.outcomeType,
          outcomeBadgeLabel: c.outcomeBadgeLabel,
          outcomeColor: c.outcomeColor,
          channel: c.channel,
          headlineMetric: String(m?.metricName || "").replace(/\s*\[Simulated\]/i, ""),
          headlineDelta: `${m?.baselineValue} → ${m?.followUpValue}`,
        };
      });
      const tally = (t: string) => DEMO_PERFORMANCE_LOOP_CASES.filter((c) => c.outcomeType === t).length;
      const under = DEMO_PERFORMANCE_LOOP_CASES.find((c) => c.outcomeType === "UNDERPERFORMING");
      evaluatedSummary =
        `${DEMO_PERFORMANCE_LOOP_CASES.length} evaluated actions (simulated): ` +
        `${tally("ENCOURAGING_IMPROVEMENT")} encouraging · ${tally("NEUTRAL_RESULT")} neutral · ` +
        `${tally("UNDERPERFORMING")} underperforming · ${tally("MIXED_TRADEOFF")} mixed · ` +
        `${tally("INSUFFICIENT_EVIDENCE")} inconclusive`;
      if (under) {
        const um: any = under.metrics[under.metrics.length - 1];
        mainConcernOrInsight = `Underperforming: ${under.title} — ${String(um.metricName).replace(/\s*\[Simulated\]/i, "")} ${um.baselineValue} → ${um.followUpValue}. ${under.recommendedNextStep}`;
        isHealthy = false;
        performanceHeadline = `${tally("UNDERPERFORMING")} Underperforming`;
        performanceSubtext = `of ${DEMO_PERFORMANCE_LOOP_CASES.length} evaluated actions`;
        performanceStatus = "DEVIATION";
      }
    }

    // --- Reasoning card: strategic signals + their investigation state ---
    const demoProposals = await db
      .select()
      .from(schema.strategyChangeProposals)
      .where(
        and(
          eq(schema.strategyChangeProposals.campaignId, campaignId),
          eq(schema.strategyChangeProposals.accountId, accountId)
        )
      );
    const signals: NonNullable<DashboardOverviewPayload["reasoningCard"]["signals"]> = [];
    for (const s of DEMO_DEEP_REASONING_SCENARIOS) {
      if (!confirmedEvents.some((row) => row.event.id === s.eventId)) continue;
      const prop = demoProposals.find((p) => p.id === s.proposalId);
      let status: "READY_FOR_INVESTIGATION" | "PATCH_READY" | "APPLIED" = "READY_FOR_INVESTIGATION";
      let statusLabel = "Ready for Deep Reasoning";
      if (prop?.status === "APPLIED") {
        status = "APPLIED";
        statusLabel = `Applied · Strategy v${prop.appliedNewBundleVersion ?? ""}`.trim();
      } else if (prop?.status === "PENDING_USER_APPROVAL") {
        status = "PATCH_READY";
        statusLabel = "Patch ready · awaiting your approval";
      }
      signals.push({
        scenarioId: s.scenarioId,
        eventId: s.eventId,
        title: s.shortTitle,
        lane: s.relevantLaneTitle.split(" (")[0],
        status,
        statusLabel,
        appliedVersion: prop?.appliedNewBundleVersion ?? null,
      });
    }

    if (signals.length > 0) {
      reasoningSignals = signals;
      const ready = signals.filter((x) => x.status === "READY_FOR_INVESTIGATION").length;
      const patch = signals.filter((x) => x.status === "PATCH_READY").length;
      const applied = signals.filter((x) => x.status === "APPLIED").length;
      reasoningSummary =
        `${signals.length} strategic signal${signals.length === 1 ? "" : "s"} from Watchtower: ` +
        `${ready} ready for Deep Reasoning · ${patch} awaiting approval · ${applied} applied.`;
      proposalId = demoProposals.find((p) => p.status === "PENDING_USER_APPROVAL")?.id || proposalId;
      if (patch > 0) {
        investigationState = "STRATEGIC_REVIEW_REQUIRED";
        reasoningHeadline = "Strategic Review Required";
        reasoningStatusLabel = "Action Required";
        activeInvestigationsCount = ready + patch;
      } else if (ready > 0) {
        investigationState = "STRATEGIC_SIGNALS_PENDING";
        reasoningHeadline = "Strategic signals ready for Deep Reasoning";
        reasoningStatusLabel = "Awaiting Investigation";
        activeInvestigationsCount = ready;
      } else {
        investigationState = "DEEP_REASONING_COMPLETE";
        reasoningHeadline = "Strategic adaptations applied";
        reasoningStatusLabel = "Deep Reasoning Complete";
        activeInvestigationsCount = applied;
      }

      if (ready > 0 || patch > 0) {
        aiSummaryText = `Watchtower confirmed ${confirmedEvents.length} market changes; ${ready + patch} strategic signal${ready + patch === 1 ? " needs" : "s need"} your review.`;
        priorityLevel = "ACTION_REQUIRED";
      }
    }
  }

  // 10. Live Updates / Recent Activity Timeline (Unified from real facts)
  const recentActivity: DashboardOverviewPayload["recentActivity"] = [];

  if (hasPlan) {
    recentActivity.push({
      id: "act_1",
      type: "strategy",
      icon: "target",
      iconColor: "#8B5CF6",
      relativeTime: latestMaterialChange?.relativeTime || "2m ago",
      title: `Strategy Plan v${activePlanVersion} · Bundle v${rootBundleVersion} activated`,
      subtitle: latestMaterialChange?.summary || "Strategy plan active",
      targetRoute: "/(tabs)/strategy-plan",
    });
  }

  if (investigationState !== "NO_ACTIVE_INVESTIGATION") {
    const pendingSignals = (reasoningSignals || []).filter((x) => x.status !== "APPLIED");
    recentActivity.push({
      id: "act_2",
      type: "reasoning",
      icon: "cpu",
      iconColor: "#10B981",
      relativeTime: "5m ago",
      title: reasoningSignals
        ? pendingSignals.length > 0
          ? `${pendingSignals.length} strategic signal${pendingSignals.length === 1 ? "" : "s"} awaiting Deep Reasoning`
          : "Deep Reasoning completed"
        : "Deep Reasoning completed",
      subtitle: reasoningSignals
        ? (pendingSignals[0] || reasoningSignals[0]).title
        : "Conversion weakness linked to onboarding friction",
      targetRoute: "/(tabs)/reasoning-evidence",
    });
  }

  if (confirmedEvents.length > 0) {
    recentActivity.push({
      id: "act_3",
      type: "market",
      icon: "volume-2",
      iconColor: "#F59E0B",
      relativeTime: "7m ago",
      title: "Market change confirmed",
      subtitle: recentConfirmedEvents[0]?.title || "Competitor pricing shift",
      targetRoute: "/(tabs)/watchtower",
    });
  }

  if (latestReportItem) {
    recentActivity.push({
      id: "act_4",
      type: "report",
      icon: "file-text",
      iconColor: "#A78BFA",
      relativeTime: "Yesterday",
      title: "Monthly report finalized",
      subtitle: latestReportItem.periodLabel,
      targetRoute: "/(tabs)/reports",
    });
  }

  if (priorityTasks.length > 0) {
    recentActivity.push({
      id: "act_5",
      type: "execution",
      icon: "check-circle",
      iconColor: "#10B981",
      relativeTime: "2 days ago",
      title: `${priorityTasks.length} tasks completed`,
      subtitle: "WTDT execution",
      targetRoute: "/(tabs)/what-to-do-today",
    });
  }

  return {
    user: {
      firstName,
      fullName,
      role,
      email,
    },
    lastUpdated: now.toISOString(),
    businessPulse: {
      strategy: {
        version: activePlanVersion,
        activePlanVersion,
        rootBundleVersion,
        totalPlanRevisions,
        status: isApprovedLive ? "ACTIVE" : (isDraftOnly ? "PENDING_APPROVAL" : "NO_PLAN"),
        label: isApprovedLive
          ? `Plan v${activePlanVersion} · Bundle v${rootBundleVersion} · Active`
          : (isDraftOnly ? `Plan v${activePlanVersion} · Candidate Draft` : "No active strategy"),
      },
      market: {
        confirmedChangesMonthCount: confirmedEvents.length,
        candidatesMonthCount: candidateEvents.length,
        label: `${confirmedEvents.length} confirmed changes`,
        subtext: "this month",
      },
      performance: {
        status: performanceStatus,
        headline: performanceHeadline,
        subtext: performanceSubtext,
        severity: performanceStatus === "DEVIATION" ? "MEDIUM" : undefined,
      },
      execution: {
        tasksTodayCount: priorityTasks.length,
        completedTodayCount,
        label: `${priorityTasks.length} tasks today`,
      },
    },
    aiSummaryStrip: {
      text: aiSummaryText,
      priorityLevel,
    },
    whatToDoTodayCard: {
      count: priorityTasks.length,
      tasks: priorityTasks,
    },
    strategyPlanCard: {
      version: activePlanVersion,
      activePlanVersion,
      rootBundleVersion,
      totalPlanRevisions,
      status: isApprovedLive ? "ACTIVE" : (isDraftOnly ? "PENDING_APPROVAL" : "NO_PLAN"),
      primaryDirection,
      activeLanesCount,
      latestMaterialChange,
    },
    performanceCard: {
      kpis,
      mainConcernOrInsight,
      status: performanceStatus,
      isHealthy,
      evaluatedCases,
      evaluatedSummary,
      simulated: evaluatedCases ? true : undefined,
    },
    watchtowerCard: {
      confirmedCount: confirmedEvents.length,
      candidatesCount: candidateEvents.length,
      recentConfirmedEvents,
    },
    reasoningCard: {
      activeInvestigationsCount,
      investigationState,
      headline: reasoningHeadline,
      summary: reasoningSummary,
      statusLabel: reasoningStatusLabel,
      proposalId,
      signals: reasoningSignals,
    },
    reportsCard: {
      latestReport: latestReportItem,
    },
    recentActivity,
  };
}
