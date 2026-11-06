/**
 * What To Do Today — Execution Planning Context Builder
 * 
 * Lineage-Pinned Resolution:
 * Campaign -> Active Strategy Root -> Canonical Root Bundle -> Strategic Plan -> Approved Engine Snapshots.
 * Bounded execution context creation without massive raw dumps.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import {
  ExecutionPlanningContext,
  ChannelName,
  ChannelMode,
  ChannelRole,
  ApprovedChannelDecision,
  StrategicLaneContext,
} from "./contracts";
import { resolveExecutionPlan, resolvePlanContext } from "../orchestrator/execution-plan-resolver";
import { buildCanonicalBudgetAuthorityModel } from "../orchestrator/plan-synthesis";

function safeParseJson<T = any>(value: any, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizePlatform(rawName: string): ChannelName {
  const upper = String(rawName || "").toUpperCase();
  if (upper.includes("INSTAGRAM") || upper === "IG") return "INSTAGRAM";
  if (upper.includes("TIKTOK")) return "TIKTOK";
  if (upper.includes("YOUTUBE") || upper === "YT") return "YOUTUBE";
  if (upper.includes("FACEBOOK") || upper.includes("META")) return "FACEBOOK";
  if (upper === "X" || upper.includes("TWITTER") || /\bX\b/.test(upper)) return "X";
  if (upper.includes("LINKEDIN")) return "LINKEDIN";
  if (upper.includes("EMAIL") || upper.includes("NEWSLETTER")) return "EMAIL";
  if (upper.includes("WEBSITE") || upper.includes("SEO") || upper.includes("BLOG") || upper.includes("SEARCH")) return "WEBSITE";
  return "OTHER";
}

function normalizeChannelMode(rawName: string, rawType?: string, isOrganicFlag?: boolean): ChannelMode {
  if (isOrganicFlag === true) return "ORGANIC";
  if (isOrganicFlag === false) return "PAID";
  const combined = `${rawName || ""} ${rawType || ""}`.toLowerCase();
  if (combined.includes("paid") || combined.includes("ads") || combined.includes("ppc") || combined.includes("search_paid") || combined.includes("social_paid") || combined.includes("video_paid")) {
    return "PAID";
  }
  return "ORGANIC";
}

export async function buildExecutionPlanningContext(
  campaignId: string,
  businessDate: string = new Date().toISOString().split("T")[0],
  accountIdParam?: string,
  options?: {
    specificPlanId?: string;
    allowDraftPreview?: boolean;
  }
): Promise<ExecutionPlanningContext> {
  // 1. Resolve Account ID
  let accountId = accountIdParam;
  if (!accountId) {
    const [sel] = await db
      .select({ accountId: schema.campaignSelections.accountId })
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.selectedCampaignId, campaignId))
      .limit(1);
    accountId = sel?.accountId || "default";
  }

  let strategicPlan: typeof schema.strategicPlans.$inferSelect;
  if (options?.specificPlanId && options?.allowDraftPreview) {
    const [previewPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.id, options.specificPlanId),
          eq(schema.strategicPlans.campaignId, campaignId)
        )
      )
      .limit(1);
    if (!previewPlan) {
      throw new Error(`PREVIEW_PLAN_NOT_FOUND: Strategic plan ${options.specificPlanId} not found for campaign ${campaignId}.`);
    }
    strategicPlan = previewPlan;
  } else {
    // 2. Resolve Designated Active Execution Plan (Fail-Closed)
    const planResolution = await resolveExecutionPlan({
      accountId,
      campaignId,
      intent: "execution",
    });

    if (!planResolution.canExecute || !planResolution.plan) {
      throw new Error(
        `EXECUTION_GATED: ${planResolution.reason || "No designated active execution plan"} for campaign ${campaignId}.`
      );
    }

    strategicPlan = planResolution.plan;
  }

  // Resolve full canonical lineage & pinned snapshot IDs via resolvePlanContext
  const planCtx = await resolvePlanContext({
    accountId,
    campaignId,
    specificPlanId: strategicPlan.id,
    mode: options?.allowDraftPreview ? "SPECIFIC_PLAN" : "APPROVED_ACTIVE",
  });

  // 3. Resolve Canonical Root Bundle pinned to this designated plan
  let rootBundle = planCtx.rootBundle || undefined;
  if (!rootBundle && strategicPlan.rootBundleId) {
    const [rb] = await db
      .select()
      .from(schema.rootBundles)
      .where(
        and(
          eq(schema.rootBundles.id, strategicPlan.rootBundleId),
          eq(schema.rootBundles.campaignId, campaignId)
        )
      )
      .limit(1);
    rootBundle = rb;
  }

  if (!rootBundle && strategicPlan.rootBundleVersion) {
    const [rb] = await db
      .select()
      .from(schema.rootBundles)
      .where(
        and(
          eq(schema.rootBundles.campaignId, campaignId),
          eq(schema.rootBundles.version, strategicPlan.rootBundleVersion)
        )
      )
      .limit(1);
    rootBundle = rb;
  }

  if (!rootBundle) {
    throw new Error(`PINNED_ROOT_BUNDLE_NOT_FOUND: Designated plan ${strategicPlan.id} root bundle (${strategicPlan.rootBundleId || `ver_${strategicPlan.rootBundleVersion}` || "none"}) is missing.`);
  }

  // 4. Resolve Active Strategy Root pinned to the designated plan's run / campaign
  let activeRoot = planCtx.strategyRoot || undefined;
  if (!activeRoot && strategicPlan.jobId) {
    const [sr] = await db
      .select()
      .from(schema.strategyRoots)
      .where(
        and(
          eq(schema.strategyRoots.campaignId, campaignId),
          eq(schema.strategyRoots.runId, strategicPlan.jobId)
        )
      )
      .limit(1);
    activeRoot = sr;
  }

  if (!activeRoot) {
    const [sr] = await db
      .select()
      .from(schema.strategyRoots)
      .where(
        and(
          eq(schema.strategyRoots.campaignId, campaignId),
          eq(schema.strategyRoots.status, "ACTIVE")
        )
      )
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);
    activeRoot = sr;
  }

  if (!activeRoot) {
    throw new Error(`NO_ACTIVE_STRATEGY_ROOT: Campaign ${campaignId} has no active strategy root.`);
  }

  // 5. Parse Plan JSON & Pinned Snapshots
  const planJson = safeParseJson<any>(strategicPlan?.planJson, {});
  const selectedSnapshotIds = planCtx.snapshotIds;

  // Resolve Product URL & Business Name from pinned Business Understanding Snapshot / Campaign Offerings
  let productUrl: string | undefined = planJson?.productUrl || planJson?.websiteUrl || undefined;
  let businessName: string | undefined = planJson?.businessName || planJson?.brandSpine?.productName || undefined;

  if (selectedSnapshotIds.businessUnderstandingSnapshotId) {
    const [buRow] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.id, selectedSnapshotIds.businessUnderstandingSnapshotId))
      .limit(1);
    if (buRow) {
      const buObj = safeParseJson<any>(buRow.businessUnderstanding, {});
      productUrl = productUrl || buObj?.websiteUrl || buObj?.rootUrl || buObj?.productUrl;
      businessName = businessName || buObj?.businessName || buObj?.productName;
    }
  }
  if (!productUrl) {
    const [offeringRow] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(eq(schema.campaignOfferings.campaignId, campaignId))
      .orderBy(desc(schema.campaignOfferings.createdAt))
      .limit(1);
    if (offeringRow) {
      productUrl = (offeringRow as any).productUrl || (offeringRow as any).websiteUrl || productUrl;
      businessName = businessName || (offeringRow as any).name;
    }
  }

  // 6. Extract Approved Mechanism & Positioning Spine (Safely parse JSON so raw JSON never leaks)
  const mech = safeParseJson<any>(activeRoot.approvedMechanism, {});
  const parsedPosCtx = safeParseJson<any>(activeRoot.approvedPositioningContext, null);

  let posSnapshotNarrative: string | undefined;
  if (selectedSnapshotIds.positioningSnapshotId) {
    const [posSnap] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(eq(schema.positioningSnapshots.id, selectedSnapshotIds.positioningSnapshotId))
      .limit(1);
    if (posSnap?.narrativeDirection) {
      posSnapshotNarrative = posSnap.narrativeDirection;
    }
  }

  const cleanPositioningNarrative =
    planJson?.brandSpine?.narrativeDirection ||
    posSnapshotNarrative ||
    (parsedPosCtx && typeof parsedPosCtx === "object"
      ? parsedPosCtx.narrativeDirection || parsedPosCtx.territories?.[0]?.narrativeDirection || parsedPosCtx.rationale
      : typeof activeRoot.approvedPositioningContext === "string" && !activeRoot.approvedPositioningContext.trim().startsWith("{")
        ? activeRoot.approvedPositioningContext
        : "") ||
    planJson?.strategicSummary?.strategy ||
    strategicPlan.planSummary ||
    activeRoot.primaryAxis ||
    "";

  const strategyName =
    planJson?.brandSpine?.umbrellaPositionName ||
    mech?.mechanismName ||
    activeRoot.primaryAxis ||
    "Approved Campaign Strategy";

  // 7. Extract Approved Audience Pains & Lanes (preserving all lanes and resolving pain IDs to human text)
  const approvedAudiencePains = safeParseJson<any[]>(activeRoot.approvedAudiencePains, []);
  const painTextById = new Map<string, string>();
  for (const p of approvedAudiencePains) {
    const pid = p?.painId || p?.id || p?.claimId;
    const text = p?.canonical || p?.originalStatement || p?.pain || p?.claim;
    if (pid && text) painTextById.set(pid, text);
  }

  const lanesRaw: any[] = Array.isArray(planJson?.approvedLanes) && planJson.approvedLanes.length > 0
    ? planJson.approvedLanes
    : safeParseJson<any[]>(activeRoot.approvedLanes, []);

  for (const l of lanesRaw) {
    if (Array.isArray(l?.competitorSubjectAttribution)) {
      for (const csa of l.competitorSubjectAttribution) {
        if (csa?.painId && csa?.canonical && !painTextById.has(csa.painId)) {
          painTextById.set(csa.painId, csa.canonical);
        }
      }
    }
  }

  const resolvePainText = (idOrText?: string | null): string | undefined => {
    if (!idOrText) return undefined;
    if (painTextById.has(idOrText)) return painTextById.get(idOrText);
    return idOrText;
  };

  // Load pinned funnel & persuasion snapshots for all lanes
  const pinnedFunnelIds = selectedSnapshotIds.funnelSnapshotIds || [];
  const funnelRows = pinnedFunnelIds.length > 0
    ? await db.select().from(schema.funnelSnapshots).where(inArray(schema.funnelSnapshots.id, pinnedFunnelIds))
    : [];
  const pinnedPersuasionIds = selectedSnapshotIds.persuasionSnapshotIds || [];
  const persuasionRows = pinnedPersuasionIds.length > 0
    ? await db.select().from(schema.persuasionSnapshots).where(inArray(schema.persuasionSnapshots.id, pinnedPersuasionIds))
    : [];

  const buyerJourneysList: any[] = Array.isArray(planJson?.buyerConversionJourneys)
    ? planJson.buyerConversionJourneys
    : planJson?.buyerConversionJourney
      ? [planJson.buyerConversionJourney]
      : [];

  const approvedLanes: StrategicLaneContext[] = lanesRaw.map((l, idx) => {
    const laneId = l.laneId || l.id || `lane_${idx + 1}`;
    const matchingJourney = buyerJourneysList.find((j: any) => j?.laneId === laneId) || buyerJourneysList[idx] || buyerJourneysList[0];
    const matchingFunnelRow = funnelRows.find(f => f.laneId === laneId) || funnelRows[idx];
    const matchingPersuasionRow = persuasionRows.find(p => p.laneId === laneId) || persuasionRows[idx];

    const primaryFunnelParsed = matchingFunnelRow ? safeParseJson<any>(matchingFunnelRow.primaryFunnel, null) : null;
    const rawStages: any[] = Array.isArray(primaryFunnelParsed?.stages) && primaryFunnelParsed.stages.length > 0
      ? primaryFunnelParsed.stages
      : Array.isArray(matchingJourney?.stages)
        ? matchingJourney.stages
        : [];

    const funnelStages = rawStages.map((s: any) => ({
      stageName: s.stageName || s.stageId || s.name || "stage",
      stageType: s.stageId || s.stageType,
      objective: s.goal || s.objective || s.coreMessage,
      cta: s.cta || s.callToAction,
      conversionAction: s.contentAction || s.cta || s.goal,
      destinationUrl: s.destinationUrl || productUrl,
    }));

    const entryStage = funnelStages.find(s => s.stageType === "entry" || s.stageName?.toLowerCase().includes("entry"));
    const trialOrPreviewStage = funnelStages.find(s =>
      /trial|preview/i.test(s.cta || "") ||
      s.stageType === "evaluation"
    );
    const decisionStage = trialOrPreviewStage || funnelStages.find(s =>
      s.stageType === "decision" ||
      s.stageType === "conversion" ||
      s.stageName?.toLowerCase().includes("decision") ||
      s.stageName?.toLowerCase().includes("preview") ||
      s.stageName?.toLowerCase().includes("order")
    );
    const decisionOrConversionStage = decisionStage || entryStage || funnelStages[0];

    const primaryPainResolved =
      resolvePainText(l.primaryPainId) ||
      resolvePainText(typeof l.primaryPain === "string" ? l.primaryPain : undefined) ||
      l.description;

    const corePainsResolved = Array.isArray(l.corePainIds)
      ? l.corePainIds.map((pid: string) => resolvePainText(pid) || pid)
      : [];

    return {
      laneId,
      title: l.title || l.name || "Target Audience Lane",
      segmentId: l.segmentId || (Array.isArray(l.segmentIds) ? l.segmentIds[0] : undefined),
      targetRole: l.valueContext || l.targetRole || l.title,
      primaryPain: primaryPainResolved,
      buyingTension: l.description || primaryPainResolved,
      corePains: corePainsResolved,
      desires: Array.isArray(l.desires) ? l.desires : [],
      objections: Array.isArray(l.objections) ? l.objections : [],
      proofRequirements: Array.isArray(l.proofNeeds) ? l.proofNeeds : [],
      funnelSnapshotId: matchingFunnelRow?.id || matchingJourney?.sourceFunnelSnapshotId,
      persuasionSnapshotId: matchingPersuasionRow?.id || matchingJourney?.sourcePersuasionSnapshotId,
      funnelStages,
      primaryCta: decisionOrConversionStage?.cta || funnelStages[0]?.cta,
      conversionAction: decisionOrConversionStage?.conversionAction || matchingJourney?.journeyName,
      destinationUrl: productUrl,
    };
  });

  if (approvedLanes.length === 0) {
    throw new Error(
      `MISSING_STRATEGY_CONTEXT: Active plan ${strategicPlan.id} for campaign ${campaignId} has no approved audience lanes.`
    );
  }

  // 8. Resolve Pinned Channel Selection & Budget Governor Snapshots (NO YOUTUBE FALLBACK)
  let csResult: any = null;
  if (selectedSnapshotIds.channelSelectionSnapshotId) {
    const [csRow] = await db
      .select()
      .from(schema.channelSelectionSnapshots)
      .where(eq(schema.channelSelectionSnapshots.id, selectedSnapshotIds.channelSelectionSnapshotId))
      .limit(1);
    if (csRow) csResult = safeParseJson<any>(csRow.result, null);
  }
  if (!csResult && strategicPlan.jobId) {
    const [csRow] = await db
      .select()
      .from(schema.channelSelectionSnapshots)
      .where(and(eq(schema.channelSelectionSnapshots.campaignId, campaignId), eq(schema.channelSelectionSnapshots.jobId, strategicPlan.jobId)))
      .orderBy(desc(schema.channelSelectionSnapshots.createdAt))
      .limit(1);
    if (csRow) csResult = safeParseJson<any>(csRow.result, null);
  }

  let bgResult: any = null;
  if (selectedSnapshotIds.budgetGovernorSnapshotId) {
    const [bgRow] = await db
      .select()
      .from(schema.budgetGovernorSnapshots)
      .where(eq(schema.budgetGovernorSnapshots.id, selectedSnapshotIds.budgetGovernorSnapshotId))
      .limit(1);
    if (bgRow) bgResult = safeParseJson<any>(bgRow.result, null);
  }

  const budgetAllocs: any[] =
    planJson?.budgetAllocation?.channels ||
    planJson?.budgetAllocation?.budgetDenominators?.reconciledAllocations ||
    bgResult?.allocations ||
    [];
  const currency = planJson?.budgetAllocation?.currency || bgResult?.currency || "USD";
  const monthlyBudgetAmount =
    Number(planJson?.budgetAllocation?.totalMonthlyBudget || bgResult?.totalMonthlyBudget || 0) || undefined;

  const canonicalBudgetModel = buildCanonicalBudgetAuthorityModel({
    totalMonthlyBudget: monthlyBudgetAmount || 5000,
    currency,
    budgetSettingsVersion: Number(planJson?.budgetAllocation?.budgetSettingsVersion || bgResult?.budgetSettingsVersion || 1),
    budgetConfirmation:
      planJson?.budgetAllocation?.budgetConfirmation === "unconfirmed" ? "unconfirmed" : "user_confirmed",
    budgetGovernorOutput: bgResult || {
      totalMonthlyBudget: monthlyBudgetAmount || 5000,
      currency,
      spendAction: planJson?.budgetAllocation?.testingAndScalingGuidance?.spendAction || "hold",
      commercialStrategy: {
        spendPace: planJson?.budgetAllocation?.testingAndScalingGuidance?.spendPace || "cautious",
        learningBudgetCarveOutPct: planJson?.budgetAllocation?.testingAndScalingGuidance?.learningBudgetCarveOutPct ?? 20,
      },
      allocations: budgetAllocs,
    },
    channelSelectionOutput: csResult || planJson?.channelSelection || null,
  });
  const prereqList: any[] = Array.isArray(canonicalBudgetModel.channelPrerequisites)
    ? canonicalBudgetModel.channelPrerequisites
    : [];

  const approvedChannels: ApprovedChannelDecision[] = [];
  const addApprovedChannel = (raw: {
    channelName: string;
    channelType?: string;
    isOrganic?: boolean;
    role: ChannelRole;
    rationale?: string;
    primaryObjective?: string;
  }) => {
    const platform = normalizePlatform(raw.channelName);
    if (platform === "OTHER") return;
    const mode = normalizeChannelMode(raw.channelName, raw.channelType, raw.isOrganic);
    const matchingAlloc = budgetAllocs.find(
      (a: any) => normalizePlatform(a?.channelName || a?.category || "") === platform
    );
    const matchingPrereq = prereqList.find(
      (p: any) =>
        normalizePlatform(p?.channelName || p?.channelId || "") === platform &&
        Boolean(p?.isOrganic) === (mode === "ORGANIC"),
    ) || prereqList.find((p: any) => normalizePlatform(p?.channelName || p?.channelId || "") === platform);
    const existingIdx = approvedChannels.findIndex(c => c.platform === platform && c.mode === mode);
    const decision: ApprovedChannelDecision = {
      channelName: raw.channelName,
      platform,
      mode,
      strategicRole: raw.role,
      allocationPct: matchingAlloc?.sharePercentage ?? matchingAlloc?.percentage ?? matchingPrereq?.sharePercentage,
      monthlyAmount: matchingAlloc?.monthlyAmount ?? matchingPrereq?.conditionalFullAllocation,
      currency,
      rationale: raw.rationale || matchingAlloc?.why,
      primaryObjective: raw.primaryObjective || matchingAlloc?.proposedUse,
      readinessStatus: matchingPrereq?.readinessStatus,
      initialTestingEligibility: matchingPrereq?.initialTestingEligibility,
      prerequisiteSummary: matchingPrereq?.prerequisiteSummary || null,
      requiredWarmAudiencePool: matchingPrereq?.requiredWarmAudiencePool ?? null,
      requiredLandingPageVisits: matchingPrereq?.requiredLandingPageVisits ?? null,
      requiredConversionMeasurement: matchingPrereq?.requiredConversionMeasurement ?? null,
    };
    if (existingIdx >= 0) {
      if (raw.role === "PRIMARY") approvedChannels[existingIdx] = decision;
    } else {
      approvedChannels.push(decision);
    }
  };

  if (csResult?.primaryChannel?.channelName) {
    addApprovedChannel({
      channelName: csResult.primaryChannel.channelName,
      channelType: csResult.primaryChannel.channelType,
      role: "PRIMARY",
      rationale: csResult.primaryChannel.decisionGate?.reason,
      primaryObjective: csResult.primaryChannel.assignedFunnelRole,
    });
  }
  if (csResult?.secondaryChannel?.channelName) {
    addApprovedChannel({
      channelName: csResult.secondaryChannel.channelName,
      channelType: csResult.secondaryChannel.channelType,
      role: "SECONDARY",
      rationale: csResult.secondaryChannel.decisionGate?.reason,
      primaryObjective: csResult.secondaryChannel.assignedFunnelRole,
    });
  }
  if (Array.isArray(csResult?.aiChannelProposal?.dynamicRecommendations)) {
    for (const dr of csResult.aiChannelProposal.dynamicRecommendations) {
      const chName = String(dr?.channelName || dr?.channel || "").trim();
      if (!chName) continue;
      const tier = String(dr?.tier || "").toUpperCase();
      const role: ChannelRole =
        tier === "PRIMARY" ? "PRIMARY" : tier === "SECONDARY" ? "SECONDARY" : "SUPPORTING";
      addApprovedChannel({
        channelName: chName,
        channelType: dr?.mode || dr?.channelType,
        isOrganic: /organic/i.test(`${chName} ${dr?.mode || ""}`),
        role,
        rationale: dr?.whyRecommended || dr?.strategicRole,
        primaryObjective: dr?.strategicRole,
      });
    }
  }
  if (Array.isArray(planJson?.contentDistribution?.channels)) {
    for (const ch of planJson.contentDistribution.channels) {
      const chName = ch?.channel || ch?.channelName || ch?.name;
      if (!chName) continue;
      const tier = String(ch?.tier || ch?.priority || ch?.role || "").toUpperCase();
      const role: ChannelRole =
        tier === "PRIMARY" || (approvedChannels.length === 0 && !csResult?.primaryChannel)
          ? "PRIMARY"
          : tier === "SECONDARY"
            ? "SECONDARY"
            : "SUPPORTING";
      addApprovedChannel({
        channelName: chName,
        role,
        rationale: ch?.role,
      });
    }
  }
  for (const alloc of budgetAllocs) {
    const chName = alloc?.channelName || alloc?.category;
    if (!chName) continue;
    const role: ChannelRole =
      alloc?.channelId === "primary_channel" || approvedChannels.length === 0 ? "PRIMARY" : "SECONDARY";
    addApprovedChannel({
      channelName: chName,
      isOrganic: alloc?.isOrganic,
      role,
      rationale: alloc?.why,
      primaryObjective: alloc?.proposedUse,
    });
  }

  if (approvedChannels.length === 0) {
    throw new Error(
      `MISSING_STRATEGY_CONTEXT: Active plan ${strategicPlan.id} for campaign ${campaignId} has no approved channels in channel_selection or contentDistribution.`
    );
  }

  const primaryChannelDecision =
    approvedChannels.find(c => c.strategicRole === "PRIMARY") || approvedChannels[0];
  primaryChannelDecision.strategicRole = "PRIMARY";
  const primaryChannel = primaryChannelDecision.platform;
  const primaryChannelMode = primaryChannelDecision.mode;
  const supportingChannels = approvedChannels
    .filter(c => c.platform !== primaryChannel)
    .map(c => c.platform);

  // Separate rejected PAID channels from rejected ORGANIC channels
  const rejectedPaidChannels: string[] = [];
  const rejectedOrganicChannels: string[] = [];
  const rawRejectedList: any[] = [
    ...(Array.isArray(csResult?.rejectedChannels) ? csResult.rejectedChannels : []),
    ...(Array.isArray(csResult?.aiChannelProposal?.dynamicRejectedChannels) ? csResult.aiChannelProposal.dynamicRejectedChannels : []),
  ];
  const seenRejected = new Set<string>();
  for (const r of rawRejectedList) {
    const rName = String(r?.channelName || "").trim();
    if (!rName || seenRejected.has(rName.toLowerCase())) continue;
    seenRejected.add(rName.toLowerCase());
    const mode = normalizeChannelMode(rName, r?.channelType);
    if (mode === "PAID") {
      rejectedPaidChannels.push(rName);
    } else {
      rejectedOrganicChannels.push(rName);
    }
  }

  // 9. Fetch latest Performance Context for Mode & Spend rules
  const [perfContext] = await db
    .select()
    .from(schema.performanceContexts)
    .where(eq(schema.performanceContexts.campaignId, campaignId))
    .orderBy(desc(schema.performanceContexts.createdAt))
    .limit(1);

  const operationalMode = perfContext?.mode || "BUILD";

  // 10. Extract Differentiation Pillars
  let diffPillars: string[] | undefined = undefined;
  if (Array.isArray(planJson?.brandSpine?.coreDifferentiationPillars) && planJson.brandSpine.coreDifferentiationPillars.length > 0) {
    diffPillars = planJson.brandSpine.coreDifferentiationPillars;
  } else if (Array.isArray(planJson.differentiationPillars) && planJson.differentiationPillars.length > 0) {
    diffPillars = planJson.differentiationPillars;
  } else if (Array.isArray(activeRoot.approvedClaims) && activeRoot.approvedClaims.length > 0) {
    diffPillars = activeRoot.approvedClaims.map((c: any) => c.claim || c.distinctiveProperty || String(c));
  }

  // 11. Extract Funnel Destination & CTA from pinned journeys/funnels (NO "Webinar / Demo" fallback)
  const primaryJourney = buyerJourneysList[0] || planJson.buyerConversionJourney || planJson.funnelJourney || {};
  const persuasion = primaryJourney?.persuasionStrategy || planJson.persuasionStrategy || {};
  const primaryLaneCtx = approvedLanes[0];

  const stageSummaryPath =
    primaryLaneCtx?.funnelStages && primaryLaneCtx.funnelStages.length > 0
      ? primaryLaneCtx.funnelStages.map(s => `${s.stageName}: ${s.cta || s.objective}`).join(" -> ")
      : undefined;

  const conversionPath =
    primaryJourney.conversionPath ||
    planJson.funnelStrategy?.conversionPath ||
    (rootBundle as any)?.funnelRoots?.conversionPath ||
    (primaryJourney.journeyName
      ? `${primaryJourney.journeyName}${productUrl ? ` (${productUrl})` : ""}${stageSummaryPath ? ` [${stageSummaryPath}]` : ""}`
      : stageSummaryPath) ||
    productUrl ||
    "Approved Product Conversion Funnel";

  const leadMagnet =
    primaryJourney.leadMagnet ||
    planJson.funnelStrategy?.leadMagnet ||
    primaryLaneCtx?.funnelStages?.find(s => s.stageName === "decision" || s.stageName === "entry")?.cta ||
    undefined;

  const proofArtifact =
    primaryJourney.proofArtifact ||
    persuasion.trustStrategy?.proofArtifact ||
    mech.proofArtifact ||
    planJson?.brandSpine?.proofArchitectureTypes?.[0]?.asset ||
    primaryLaneCtx?.proofRequirements?.[0] ||
    undefined;

  const ctaPrimary =
    primaryJourney.ctaPrimary ||
    planJson.funnelStrategy?.primaryCta ||
    primaryLaneCtx?.primaryCta ||
    (productUrl ? `Start at ${productUrl}` : undefined);

  const channelGuidance: Record<string, string> = {};
  for (const ch of approvedChannels) {
    channelGuidance[ch.platform] =
      `${ch.channelName} (${ch.strategicRole}, ${ch.mode}${ch.allocationPct !== undefined ? `, ${ch.allocationPct}% allocation` : ""}): ${ch.rationale || ch.primaryObjective || "Execute native content aligned with approved lanes and funnel stages."}`;
  }

  const paidAllocPct = Number(canonicalBudgetModel.budgetDenominators?.paidMediaBudget || 0) > 0 && monthlyBudgetAmount
    ? Math.round((Number(canonicalBudgetModel.budgetDenominators.paidMediaBudget) / monthlyBudgetAmount) * 100)
    : 0;
  const organicAllocPct = 100 - paidAllocPct;

  const totalBudgetLabel =
    canonicalBudgetModel.totalBudget ||
    planJson?.budgetAllocation?.totalBudget ||
    (monthlyBudgetAmount ? `${monthlyBudgetAmount} ${currency}` : "Organic Validation Mode");

  const spendRule =
    canonicalBudgetModel.testingAndScalingGuidance?.initialTestingPlan ||
    planJson?.budgetAllocation?.testingAndScalingGuidance?.initialTestingPlan ||
    planJson?.budgetAllocation?.testingAndScalingGuidance?.organicProductionAllocationSummary ||
    planJson?.budgetAllocation?.spendGuidance ||
    `Allocate resources across approved channels (${approvedChannels.map(c => `${c.channelName}${c.allocationPct !== undefined ? ` ${c.allocationPct}%` : ""}`).join(", ")}) for ${operationalMode} execution.`;

  return {
    campaignId,
    accountId: activeRoot.accountId || accountId || "default",
    businessId: planCtx.businessId,
    productId: planCtx.productId,
    offeringId: planCtx.offeringId,
    businessName,
    productUrl,
    businessDate,
    strategyRootId: activeRoot.id,
    strategyRootVersion: null,
    rootBundleId: rootBundle.id,
    rootBundleVersion: rootBundle.version || 1,
    strategicPlanId: strategicPlan.id,
    strategicPlanVersion: strategicPlan.version || (strategicPlan as any).versionNumber || 1,
    selectedSnapshotIds,
    strategyName,
    primaryAxis: activeRoot.primaryAxis || strategyName,
    contrastAxis: planJson?.brandSpine?.contrastAxis || activeRoot.contrastAxisText || "",
    approvedPromise: activeRoot.approvedPromise || planJson?.brandSpine?.mechanismPromise || cleanPositioningNarrative,
    approvedTransformation: activeRoot.approvedTransformation || planJson?.brandSpine?.mechanismPromise || "",
    approvedMechanism: {
      mechanismName: planJson?.brandSpine?.mechanismName || mech.mechanismName || activeRoot.primaryAxis || "",
      corePrinciple: planJson?.brandSpine?.mechanismPromise || mech.corePrinciple || mech.description || undefined,
      proofArtifact: proofArtifact || undefined,
    },
    approvedLanes,
    positioningSummary: cleanPositioningNarrative,
    differentiationPillars: diffPillars,
    offerSummary: planJson.offerSummary || planJson.commercialOffer?.name || planJson?.brandSpine?.mechanismPromise || undefined,
    awarenessStrategy: planJson.awarenessStrategy ? {
      narrativeReframe: planJson.awarenessStrategy.narrativeReframe,
      mythBreaker: planJson.awarenessStrategy.mythBreaker,
      entryStage: planJson.awarenessStrategy.entryStage,
    } : undefined,
    funnelJourney: {
      acquisitionChannel: primaryChannel,
      conversionPath,
      leadMagnet,
      proofArtifact,
      ctaPrimary,
      conversionAction: primaryLaneCtx?.conversionAction,
      destinationUrl: productUrl,
    },
    persuasionTrust: persuasion.trustStrategy || persuasion.coreBeliefTransformation ? {
      mode: persuasion.mode || "education_led",
      buyerRiskState: persuasion.trustStrategy?.buyerRiskState || persuasion.coreBeliefTransformation?.currentBelief,
      trustDeficit: persuasion.trustStrategy?.trustDeficit || persuasion.coreBeliefTransformation?.contradictionLogic,
      transferMechanismName: persuasion.trustStrategy?.transferMechanismName || planJson?.brandSpine?.mechanismName,
      proofArtifact: persuasion.trustStrategy?.proofArtifact || proofArtifact,
      primaryCialdiniPrinciple: persuasion.trustStrategy?.primaryCialdiniPrinciple || "authority",
      objections: Array.isArray(persuasion.objections) ? persuasion.objections : undefined,
    } : undefined,
    channelHierarchy: {
      primaryChannel,
      primaryChannelMode,
      primaryChannelDecision,
      supportingChannels,
      approvedChannels,
      rejectedPaidChannels,
      rejectedOrganicChannels,
      channelGuidance,
    },
    budgetConstraints: {
      totalBudget: totalBudgetLabel,
      monthlyBudgetAmount,
      currency,
      paidAllocationPct: paidAllocPct,
      organicEffortAllocationPct: organicAllocPct,
      mediaSpendWithheld: paidAllocPct === 0 || canonicalBudgetModel.holdPolicy?.spendAction === "hold",
      operationalMode,
      spendRule,
      spendAction: canonicalBudgetModel.holdPolicy?.spendAction || "hold",
      authorityHierarchy: canonicalBudgetModel.authorityHierarchy,
      monthlyBudgetEnvelope: canonicalBudgetModel.monthlyBudgetEnvelope?.amount ?? monthlyBudgetAmount,
      finalPlannedChannelAllocation: canonicalBudgetModel.finalPlannedChannelAllocation?.channels?.map((c: any) => ({
        channelName: c.channelName,
        sharePercentage: c.sharePercentage,
        monthlyAmount: c.conditionalFullAllocation,
        isOrganic: c.isOrganic,
        readinessStatus: c.readinessStatus,
      })),
      initialTestingAllowance: canonicalBudgetModel.initialTestingAllowance?.amount,
      initialTestingAllowancePct: canonicalBudgetModel.initialTestingAllowance?.percentageOfEnvelope,
      unreleasedReserve: canonicalBudgetModel.unreleasedReserve?.amount,
      unreleasedReservePct: canonicalBudgetModel.unreleasedReserve?.percentageOfEnvelope,
      actualSpend: canonicalBudgetModel.actualSpend?.amount ?? null,
      actualSpendStatus: canonicalBudgetModel.actualSpend?.status || "UNKNOWN_UNCONNECTED",
      monetaryProductionCosts: canonicalBudgetModel.productionAndOrganicEffort?.monetaryProductionCosts ?? 0,
      holdPolicy: canonicalBudgetModel.holdPolicy,
      channelPrerequisites: canonicalBudgetModel.channelPrerequisites,
    },
    strategicGoals: {
      planSummary: strategicPlan.planSummary || cleanPositioningNarrative,
      campaignGoal: planJson?.strategicSummary?.growthObjective || planJson.goals?.campaignGoal || `Execute approved strategy for ${strategyName}`,
      strategicFocus: planJson?.monthlyObjective?.objective || planJson.strategicFocus || activeRoot.primaryAxis || "Grounded Strategic Execution",
    },
  };
}
