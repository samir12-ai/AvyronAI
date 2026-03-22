import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import * as crypto from "crypto";
import {
  rootBundles,
  businessDataLayer,
  growthCampaigns,
  campaignSelections,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
  budgetGovernorSnapshots,
  strategyValidationSnapshots,
  strategicPlans,
  calendarEntries,
  requiredWork,
  contentDna,
} from "../shared/schema";
import { resolveAccountId } from "./auth";

const safeJson = (v: any) => {
  try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
};

export interface BusinessRoots {
  businessModel?: string;
  offerType?: string;
  pricePoint?: string;
  salesCycleLength?: string;
  marketLocation?: string;
  targetSegment?: string;
  serviceArea?: string;
  acquisitionGoal?: string;
  revenueGoal?: string;
  leadGoal?: string;
  timeHorizon?: string;
  availableBudget?: string;
  fulfillmentCapacity?: string;
  preferredChannels?: string[];
}

export interface FunnelRoots {
  awarenessChannels?: string[];
  acquisitionChannel?: string;
  conversionPath?: string;
  primaryCta?: string;
  landingType?: string;
  closingMethod?: string;
  expectedConversionBenchmarks?: Record<string, number>;
  bottleneckStage?: string;
}

export interface ContentRoots {
  contentMission?: string;
  messagingAngles?: string[];
  trustAssets?: string[];
  objections?: string[];
  contentPillars?: string[];
  formatWeights?: Record<string, number>;
  contentCadence?: string;
  creativeTestingPriorities?: string[];
}

export interface ExecutionRoots {
  productionCapacity?: string;
  adCapacity?: string;
  teamConstraints?: string[];
  approvalConstraints?: string[];
  complianceConstraints?: string[];
  calendarConstraints?: string[];
}

export interface MathRoots {
  targetCustomers?: number;
  targetLeads?: number;
  targetReach?: number;
  targetContentUnits?: number;
  adSpendAllocation?: number;
  expectedCac?: number;
  expectedCpl?: number;
  expectedCloseRate?: number;
}

export function computeStrategyHash(bundle: {
  businessRoots: any;
  funnelRoots: any;
  contentRoots: any;
  executionRoots: any;
  mathRoots: any;
}): string {
  const data = JSON.stringify({
    b: bundle.businessRoots,
    f: bundle.funnelRoots,
    c: bundle.contentRoots,
    e: bundle.executionRoots,
    m: bundle.mathRoots,
  });
  return crypto.createHash("sha256").update(data).digest("hex").substring(0, 16);
}

export async function buildRootBundle(campaignId: string, accountId: string) {
  const [bizData, campaign, campSel] = await Promise.all([
    db.select().from(businessDataLayer)
      .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
      .orderBy(desc(businessDataLayer.createdAt)).limit(1).then(r => r[0]),
    db.select().from(growthCampaigns)
      .where(eq(growthCampaigns.id, campaignId)).limit(1).then(r => r[0]),
    db.select().from(campaignSelections)
      .where(and(eq(campaignSelections.selectedCampaignId, campaignId), eq(campaignSelections.accountId, accountId)))
      .orderBy(desc(campaignSelections.selectedAt)).limit(1).then(r => r[0]),
  ]);

  const [
    miData, audData, posData, diffData, offerData,
    funnelData, awarenessData, persuasionData, channelData,
    iterData, retentionData, budgetData, statValData,
  ] = await Promise.all([
    db.select({ marketDiagnosis: miSnapshots.marketDiagnosis }).from(miSnapshots)
      .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
      .orderBy(desc(miSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ audiencePains: audienceSnapshots.audiencePains, audienceSegments: audienceSnapshots.audienceSegments, emotionalDrivers: audienceSnapshots.emotionalDrivers })
      .from(audienceSnapshots).where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
      .orderBy(desc(audienceSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ territories: positioningSnapshots.territories, narrativeDirection: positioningSnapshots.narrativeDirection })
      .from(positioningSnapshots).where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId)))
      .orderBy(desc(positioningSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ differentiationPillars: differentiationSnapshots.differentiationPillars, authorityMode: differentiationSnapshots.authorityMode })
      .from(differentiationSnapshots).where(and(eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.campaignId, campaignId)))
      .orderBy(desc(differentiationSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ primaryOffer: offerSnapshots.primaryOffer })
      .from(offerSnapshots).where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId)))
      .orderBy(desc(offerSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ primaryFunnel: funnelSnapshots.primaryFunnel })
      .from(funnelSnapshots).where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId)))
      .orderBy(desc(funnelSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ primaryRoute: awarenessSnapshots.primaryRoute, awarenessStrengthScore: awarenessSnapshots.awarenessStrengthScore })
      .from(awarenessSnapshots).where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId)))
      .orderBy(desc(awarenessSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ primaryRoute: persuasionSnapshots.primaryRoute })
      .from(persuasionSnapshots).where(and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId)))
      .orderBy(desc(persuasionSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ result: channelSelectionSnapshots.result })
      .from(channelSelectionSnapshots).where(and(eq(channelSelectionSnapshots.accountId, accountId), eq(channelSelectionSnapshots.campaignId, campaignId)))
      .orderBy(desc(channelSelectionSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ result: iterationSnapshots.result })
      .from(iterationSnapshots).where(and(eq(iterationSnapshots.accountId, accountId), eq(iterationSnapshots.campaignId, campaignId)))
      .orderBy(desc(iterationSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ result: retentionSnapshots.result })
      .from(retentionSnapshots).where(and(eq(retentionSnapshots.accountId, accountId), eq(retentionSnapshots.campaignId, campaignId)))
      .orderBy(desc(retentionSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ result: budgetGovernorSnapshots.result })
      .from(budgetGovernorSnapshots).where(and(eq(budgetGovernorSnapshots.accountId, accountId), eq(budgetGovernorSnapshots.campaignId, campaignId)))
      .orderBy(desc(budgetGovernorSnapshots.createdAt)).limit(1).then(r => r[0]),
    db.select({ result: strategyValidationSnapshots.result, confidenceScore: strategyValidationSnapshots.confidenceScore })
      .from(strategyValidationSnapshots).where(and(eq(strategyValidationSnapshots.accountId, accountId), eq(strategyValidationSnapshots.campaignId, campaignId)))
      .orderBy(desc(strategyValidationSnapshots.createdAt)).limit(1).then(r => r[0]),
  ]);

  const offer = safeJson(offerData?.primaryOffer);
  const funnel = safeJson(funnelData?.primaryFunnel);
  const awareness = safeJson(awarenessData?.primaryRoute);
  const persuasion = safeJson(persuasionData?.primaryRoute);
  const channels = safeJson(channelData?.result);
  const budget = safeJson(budgetData?.result);
  const iteration = safeJson(iterData?.result);
  const retention = safeJson(retentionData?.result);
  const statVal = safeJson(statValData?.result);
  const pains = safeJson(audData?.audiencePains) || [];
  const segments = safeJson(audData?.audienceSegments) || [];
  const territories = safeJson(posData?.territories) || [];
  const pillars = safeJson(diffData?.differentiationPillars) || [];

  const businessRoots: BusinessRoots = {
    businessModel: bizData?.businessType || undefined,
    offerType: offer?.offerName || bizData?.coreOffer || undefined,
    pricePoint: bizData?.priceRange || undefined,
    marketLocation: bizData?.businessLocation || undefined,
    targetSegment: `${bizData?.targetAudienceAge || ""} ${bizData?.targetAudienceSegment || ""}`.trim() || undefined,
    availableBudget: bizData?.monthlyBudget || undefined,
    timeHorizon: campaign?.totalDays ? `${campaign.totalDays} days` : undefined,
    preferredChannels: channels?.selectedChannels?.map((c: any) => c.channel || c) || undefined,
  };

  const funnelRoots: FunnelRoots = {
    acquisitionChannel: bizData?.primaryConversionChannel || undefined,
    conversionPath: funnel?.funnelName || undefined,
    primaryCta: offer?.primaryCta || undefined,
    awarenessChannels: awareness?.routeName ? [awareness.routeName] : undefined,
    bottleneckStage: funnel?.bottleneck || undefined,
    expectedConversionBenchmarks: statVal?.benchmarks || undefined,
  };

  const contentRoots: ContentRoots = {
    messagingAngles: territories.length > 0 ? territories.map((t: any) => t.name || t) : undefined,
    objections: pains.length > 0 ? pains.map((p: any) => p.pain || p.name || p).slice(0, 5) : undefined,
    contentPillars: pillars.length > 0 ? pillars.map((p: any) => p.name || p).slice(0, 5) : undefined,
    contentCadence: undefined,
    creativeTestingPriorities: undefined,
  };

  const executionRoots: ExecutionRoots = {
    productionCapacity: undefined,
    teamConstraints: [],
    complianceConstraints: [],
  };

  const mathRoots: MathRoots = {
    targetCustomers: undefined,
    targetLeads: undefined,
    expectedCloseRate: statVal?.benchmarks?.closeRate || undefined,
    expectedCac: budget?.expectedCac || undefined,
    expectedCpl: budget?.expectedCpl || undefined,
  };

  const strategyHash = computeStrategyHash({
    businessRoots, funnelRoots, contentRoots, executionRoots, mathRoots,
  });

  const sourceSnapshot = JSON.stringify({
    hasBizData: !!bizData,
    hasCampaign: !!campaign,
    engineCount: [miData, audData, posData, diffData, offerData, funnelData, awarenessData, persuasionData, channelData, iterData, retentionData, budgetData, statValData].filter(Boolean).length,
  });

  return {
    businessRoots,
    funnelRoots,
    contentRoots,
    executionRoots,
    mathRoots,
    strategyHash,
    sourceSnapshot,
  };
}

export async function getActiveRootBundle(campaignId: string, accountId: string) {
  const [bundle] = await db.select().from(rootBundles)
    .where(and(
      eq(rootBundles.campaignId, campaignId),
      eq(rootBundles.accountId, accountId),
      eq(rootBundles.status, "active"),
    ))
    .orderBy(desc(rootBundles.createdAt))
    .limit(1);
  return bundle || null;
}

export async function getNextVersion(campaignId: string, accountId: string): Promise<number> {
  const [latest] = await db.select({ version: rootBundles.version })
    .from(rootBundles)
    .where(and(eq(rootBundles.campaignId, campaignId), eq(rootBundles.accountId, accountId)))
    .orderBy(desc(rootBundles.version))
    .limit(1);
  return (latest?.version || 0) + 1;
}

export async function lockRootBundle(campaignId: string, accountId: string): Promise<{
  id: string;
  version: number;
  strategyHash: string;
}> {
  await db.update(rootBundles)
    .set({ status: "stale", staleAt: new Date(), staleReason: "new_version_created" })
    .where(and(
      eq(rootBundles.campaignId, campaignId),
      eq(rootBundles.accountId, accountId),
      eq(rootBundles.status, "active"),
    ));

  const built = await buildRootBundle(campaignId, accountId);
  const version = await getNextVersion(campaignId, accountId);

  const [inserted] = await db.insert(rootBundles).values({
    campaignId,
    accountId,
    version,
    businessRoots: JSON.stringify(built.businessRoots),
    funnelRoots: JSON.stringify(built.funnelRoots),
    contentRoots: JSON.stringify(built.contentRoots),
    executionRoots: JSON.stringify(built.executionRoots),
    mathRoots: JSON.stringify(built.mathRoots),
    strategyHash: built.strategyHash,
    sourceSnapshot: built.sourceSnapshot,
    status: "active",
    lockedAt: new Date(),
  }).returning();

  console.log(`[RootBundle] Locked v${version} for campaign ${campaignId} (hash: ${built.strategyHash})`);

  return {
    id: inserted.id,
    version: inserted.version,
    strategyHash: built.strategyHash,
  };
}

export async function detectStaleness(campaignId: string, accountId: string): Promise<{
  isStale: boolean;
  reason: string | null;
  currentHash: string | null;
  activeHash: string | null;
}> {
  const active = await getActiveRootBundle(campaignId, accountId);
  if (!active) return { isStale: false, reason: null, currentHash: null, activeHash: null };

  const currentData = await buildRootBundle(campaignId, accountId);
  const currentHash = currentData.strategyHash;
  const activeHash = active.strategyHash;

  if (currentHash !== activeHash) {
    return {
      isStale: true,
      reason: "Source data has changed since roots were locked. Business profile, engine outputs, or campaign settings have been updated.",
      currentHash,
      activeHash,
    };
  }

  return { isStale: false, reason: null, currentHash, activeHash };
}

export async function validateRootIntegrity(planId: string): Promise<{
  valid: boolean;
  issues: string[];
  rootBundleId: string | null;
  rootBundleVersion: number | null;
}> {
  const issues: string[] = [];

  const [plan] = await db.select({
    rootBundleId: strategicPlans.rootBundleId,
    rootBundleVersion: strategicPlans.rootBundleVersion,
    campaignId: strategicPlans.campaignId,
    planId: strategicPlans.id,
  }).from(strategicPlans)
    .where(eq(strategicPlans.id, planId))
    .limit(1);

  if (!plan) {
    return { valid: false, issues: ["Plan not found"], rootBundleId: null, rootBundleVersion: null };
  }

  if (!plan.rootBundleId) {
    return { valid: true, issues: ["Plan was created before root system — legacy plan"], rootBundleId: null, rootBundleVersion: null };
  }

  const [bundle] = await db.select().from(rootBundles)
    .where(eq(rootBundles.id, plan.rootBundleId))
    .limit(1);

  if (!bundle) {
    issues.push("Root bundle referenced by plan no longer exists");
  } else if (bundle.status === "stale") {
    issues.push(`Root bundle v${bundle.version} is stale: ${bundle.staleReason || "newer version available"}`);
  }

  const calMismatchCount = await db.select({
    count: sql<number>`count(*)`,
  }).from(calendarEntries)
    .where(and(
      eq(calendarEntries.planId, planId),
      sql`(${calendarEntries.rootBundleId} IS DISTINCT FROM ${plan.rootBundleId})`,
    ));

  const mismatchCount = Number(calMismatchCount[0]?.count) || 0;
  if (mismatchCount > 0) {
    issues.push(`${mismatchCount} calendar entries have mismatched root bundle (expected ${plan.rootBundleId})`);
  }

  const [work] = await db.select({
    rootBundleId: requiredWork.rootBundleId,
    rootBundleVersion: requiredWork.rootBundleVersion,
  }).from(requiredWork)
    .where(eq(requiredWork.planId, planId))
    .limit(1);

  if (work && work.rootBundleId !== plan.rootBundleId) {
    issues.push("Required work has mismatched root bundle");
  }

  const [dna] = await db.select({
    rootBundleId: contentDna.rootBundleId,
    rootBundleVersion: contentDna.rootBundleVersion,
  }).from(contentDna)
    .where(and(eq(contentDna.planId, planId), eq(contentDna.status, "active")))
    .limit(1);

  if (dna && dna.rootBundleId && dna.rootBundleId !== plan.rootBundleId) {
    issues.push("Content DNA has mismatched root bundle");
  }

  return {
    valid: issues.length === 0,
    issues,
    rootBundleId: plan.rootBundleId,
    rootBundleVersion: plan.rootBundleVersion,
  };
}

export function computeCalendarDeviation(
  planTargets: { reels: number; posts: number; stories: number; carousels: number; videos: number },
  actualCounts: { reels: number; posts: number; stories: number; carousels: number; videos: number }
): {
  deviations: Record<string, { target: number; actual: number; deviationPct: number }>;
  maxDeviation: number;
  passesThreshold: boolean;
  calendarMatchScore: number;
} {
  const THRESHOLD = 5;
  const types = ["reels", "posts", "stories", "carousels", "videos"] as const;
  const deviations: Record<string, { target: number; actual: number; deviationPct: number }> = {};
  let maxDev = 0;

  for (const type of types) {
    const target = planTargets[type] || 0;
    const actual = actualCounts[type] || 0;
    const dev = target > 0 ? Math.abs(((actual - target) / target) * 100) : (actual > 0 ? 100 : 0);
    deviations[type] = { target, actual, deviationPct: Math.round(dev * 10) / 10 };
    maxDev = Math.max(maxDev, dev);
  }

  const passesThreshold = maxDev <= THRESHOLD;
  const calendarMatchScore = Math.max(0, Math.round(100 - maxDev));

  return { deviations, maxDeviation: Math.round(maxDev * 10) / 10, passesThreshold, calendarMatchScore };
}

export function registerRootBundleRoutes(app: Express) {
  app.get("/api/root-bundle/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      const accountId = resolveAccountId(req);
      const active = await getActiveRootBundle(campaignId, accountId);

      if (!active) {
        return res.json({ success: true, rootBundle: null, message: "No root bundle exists yet" });
      }

      const staleness = await detectStaleness(campaignId, accountId);

      res.json({
        success: true,
        rootBundle: {
          id: active.id,
          version: active.version,
          status: staleness.isStale ? "stale" : active.status,
          strategyHash: active.strategyHash,
          businessRoots: safeJson(active.businessRoots),
          funnelRoots: safeJson(active.funnelRoots),
          contentRoots: safeJson(active.contentRoots),
          executionRoots: safeJson(active.executionRoots),
          mathRoots: safeJson(active.mathRoots),
          lockedAt: active.lockedAt,
          createdAt: active.createdAt,
        },
        staleness,
      });
    } catch (err: any) {
      console.error("[RootBundle] Fetch error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/root-bundle/lock", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) return res.status(400).json({ success: false, error: "campaignId required" });
      const accountId = resolveAccountId(req);

      const locked = await lockRootBundle(campaignId, accountId);
      res.json({ success: true, rootBundle: locked });
    } catch (err: any) {
      console.error("[RootBundle] Lock error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/root-bundle/:campaignId/integrity/:planId", async (req: Request, res: Response) => {
    try {
      const integrity = await validateRootIntegrity(req.params.planId);
      res.json({ success: true, integrity });
    } catch (err: any) {
      console.error("[RootBundle] Integrity check error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/root-bundle/:campaignId/staleness", async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      const accountId = resolveAccountId(req);
      const staleness = await detectStaleness(campaignId, accountId);
      res.json({ success: true, ...staleness });
    } catch (err: any) {
      console.error("[RootBundle] Staleness check error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[RootBundle] Routes registered: GET/POST /api/root-bundle");
}
