/**
 * What To Do Today — Execution Planning Context Builder
 * 
 * Lineage-Pinned Resolution:
 * Campaign -> Active Strategy Root -> Canonical Root Bundle -> Strategic Plan -> Approved Engine Snapshots.
 * Bounded execution context creation without massive raw dumps.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { ExecutionPlanningContext, ChannelName, StrategicLaneContext } from "./contracts";

export async function buildExecutionPlanningContext(
  campaignId: string,
  businessDate: string = new Date().toISOString().split("T")[0]
): Promise<ExecutionPlanningContext> {
  // 1. Resolve Active Strategy Root (bf6d003d)
  const [activeRoot] = await db
    .select()
    .from(schema.strategyRoots)
    .where(eq(schema.strategyRoots.campaignId, campaignId))
    .orderBy(desc(schema.strategyRoots.createdAt))
    .limit(1);

  if (!activeRoot) {
    throw new Error(`NO_ACTIVE_STRATEGY_ROOT: Campaign ${campaignId} has no active strategy root.`);
  }

  // 2. Resolve Canonical Root Bundle (v56, cc451488)
  const [rootBundle] = await db
    .select()
    .from(schema.rootBundles)
    .where(eq(schema.rootBundles.campaignId, campaignId))
    .orderBy(desc(schema.rootBundles.createdAt))
    .limit(1);

  if (!rootBundle) {
    throw new Error(`NO_ROOT_BUNDLE: Campaign ${campaignId} has no root bundle.`);
  }

  // 3. Resolve Strategic Plan bound to this Root Bundle (1772a457)
  let [strategicPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(
      and(
        eq(schema.strategicPlans.campaignId, campaignId),
        eq(schema.strategicPlans.rootBundleId, rootBundle.id)
      )
    )
    .limit(1);

  if (!strategicPlan) {
    [strategicPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.campaignId, campaignId),
          eq(schema.strategicPlans.rootBundleVersion, rootBundle.version)
        )
      )
      .limit(1);
  }

  if (!strategicPlan) {
    [strategicPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.campaignId, campaignId))
      .orderBy(desc(schema.strategicPlans.createdAt))
      .limit(1);
  }

  // 4. Parse Plan JSON
  let planJson: any = {};
  try {
    planJson = typeof strategicPlan?.planJson === "string" ? JSON.parse(strategicPlan.planJson) : (strategicPlan?.planJson || {});
  } catch {}

  // 5. Extract Approved Mechanism & Strategy Identity
  let mech: any = {};
  try {
    mech = typeof activeRoot.approvedMechanism === "string" ? JSON.parse(activeRoot.approvedMechanism) : (activeRoot.approvedMechanism || {});
  } catch {}

  const strategyName = mech?.mechanismName || activeRoot.primaryAxis || "Grounded Strategic Plan";

  // 6. Extract Approved Lanes
  let lanesRaw: any[] = [];
  try {
    lanesRaw = Array.isArray(activeRoot.approvedLanes)
      ? activeRoot.approvedLanes
      : (typeof activeRoot.approvedLanes === "string" ? JSON.parse(activeRoot.approvedLanes) : []);
  } catch {}

  const approvedLanes: StrategicLaneContext[] = lanesRaw.map((l, idx) => ({
    laneId: l.laneId || l.id || `lane_${idx + 1}`,
    title: l.title || l.name || "Target Audience Lane",
    segmentId: l.segmentId,
    targetRole: l.targetRole || l.title,
    primaryPain: l.primaryPainId || (typeof l.primaryPain === "string" ? l.primaryPain : undefined),
    corePains: Array.isArray(l.corePainIds) ? l.corePainIds : [],
  }));

  // 7. Extract Journey & Persuasion
  const buyerJourney = planJson.buyerConversionJourney || planJson.funnelJourney || {};
  const persuasion = planJson.persuasionStrategy || {};

  // 8. Determine Channel Hierarchy
  const rawAcqChannel = (buyerJourney.acquisitionChannel || "YOUTUBE").toUpperCase();
  const primaryChannel: ChannelName = (["YOUTUBE", "INSTAGRAM", "TIKTOK", "FACEBOOK", "X", "WEBSITE", "EMAIL"].includes(rawAcqChannel)
    ? rawAcqChannel
    : "YOUTUBE") as ChannelName;

  const allChannels: ChannelName[] = ["YOUTUBE", "INSTAGRAM", "TIKTOK", "FACEBOOK", "X"];
  const supportingChannels: ChannelName[] = allChannels.filter(c => c !== primaryChannel);

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
  if (Array.isArray(planJson.differentiationPillars) && planJson.differentiationPillars.length > 0) {
    diffPillars = planJson.differentiationPillars;
  } else if (Array.isArray(activeRoot.approvedClaims) && activeRoot.approvedClaims.length > 0) {
    diffPillars = activeRoot.approvedClaims.map((c: any) => c.claim || c.distinctiveProperty || String(c));
  }

  // 11. Extract Funnel Destination & CTA
  let conversionPath = buyerJourney.conversionPath || planJson.funnelStrategy?.conversionPath || (rootBundle as any)?.funnelRoots?.conversionPath || undefined;
  let leadMagnet = buyerJourney.leadMagnet || planJson.funnelStrategy?.leadMagnet || undefined;
  let proofArtifact = buyerJourney.proofArtifact || persuasion.trustStrategy?.proofArtifact || mech.proofArtifact || undefined;
  let ctaPrimary = buyerJourney.ctaPrimary || planJson.funnelStrategy?.primaryCta || undefined;

  return {
    campaignId,
    accountId: activeRoot.accountId || "default",
    businessDate,
    strategyRootId: activeRoot.id,
    strategyRootVersion: rootBundle.version || 1,
    rootBundleId: rootBundle.id,
    rootBundleVersion: rootBundle.version || 1,
    strategicPlanId: strategicPlan.id,
    strategicPlanVersion: strategicPlan.version || 1,
    strategyName,
    primaryAxis: activeRoot.primaryAxis || "",
    contrastAxis: activeRoot.contrastAxisText || activeRoot.contrastAxis || "",
    approvedPromise: activeRoot.approvedPromise || activeRoot.positioningStatement || "",
    approvedTransformation: activeRoot.approvedTransformation || "",
    approvedMechanism: {
      mechanismName: mech.mechanismName || activeRoot.primaryAxis || "",
      corePrinciple: mech.corePrinciple || mech.description || undefined,
      proofArtifact: mech.proofArtifact || undefined,
    },
    approvedLanes,
    positioningSummary: strategicPlan.planSummary || activeRoot.positioningStatement || "",
    differentiationPillars: diffPillars,
    offerSummary: planJson.offerSummary || planJson.commercialOffer?.name || undefined,
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
    },
    persuasionTrust: persuasion.trustStrategy ? {
      mode: persuasion.mode || "authority_led",
      buyerRiskState: persuasion.trustStrategy.buyerRiskState,
      trustDeficit: persuasion.trustStrategy.trustDeficit,
      transferMechanismName: persuasion.trustStrategy.transferMechanismName,
      proofArtifact: persuasion.trustStrategy.proofArtifact,
      primaryCialdiniPrinciple: persuasion.trustStrategy.primaryCialdiniPrinciple || "authority",
      objections: Array.isArray(persuasion.objections) ? persuasion.objections : undefined,
    } : undefined,
    channelHierarchy: {
      primaryChannel,
      supportingChannels,
      channelGuidance: {
        YOUTUBE: "Primary anchor for long-form proof demonstrations, authoritative breakdowns, and visible workflow execution.",
        INSTAGRAM: "Visual proof carousels, key contrast infographics, and saves/share-optimized tactical insights.",
        TIKTOK: "Fast-hook contrast videos, surprising competitor intelligence revelations, and mechanism curiosity hooks.",
        FACEBOOK: "Operator community discussions, case study teardowns, and actionable B2B workflow proof.",
        X: "Sharp strategic arguments, live intelligence threads, and industry insight commentary.",
      },
    },
    budgetConstraints: {
      totalBudget: planJson.budgetAllocation?.totalBudget || "$1,000",
      mediaSpendWithheld: false,
      operationalMode,
      spendRule: planJson.budgetAllocation?.spendGuidance || `Allocate marketing resources according to the approved budget governor for ${operationalMode} execution.`,
    },
    strategicGoals: {
      planSummary: strategicPlan.planSummary || "",
      campaignGoal: planJson.goals?.campaignGoal || `Execute approved strategy for ${strategyName}`,
      strategicFocus: planJson.strategicFocus || activeRoot.primaryAxis || "Grounded Strategic Execution",
    },
  };
}
