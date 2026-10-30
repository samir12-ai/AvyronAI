import { db } from "./db";
import {
  accountEntitlements,
  campaignSelections,
  aiUsageLog,
  acquisitionRequests,
  acquisitionTasks,
} from "@shared/schema";
import { and, eq, sql, desc } from "drizzle-orm";

export type PackageTier = "starter" | "growth" | "agency" | "test_isolated";

export interface PackageDefinition {
  tier: PackageTier;
  displayName: string;
  monthlyPriceUsd: number;
  maxActiveCampaigns: number;
  description: string;
}

export const PROPOSED_PACKAGE_CATALOG: Record<PackageTier, PackageDefinition> = {
  starter: {
    tier: "starter",
    displayName: "Starter",
    monthlyPriceUsd: 199,
    maxActiveCampaigns: 1,
    description: "1 active product campaign with full strategy, evidence, and monitoring.",
  },
  growth: {
    tier: "growth",
    displayName: "Growth",
    monthlyPriceUsd: 399,
    maxActiveCampaigns: 2,
    description: "Up to 2 concurrent active product campaigns within your workspace.",
  },
  agency: {
    tier: "agency",
    displayName: "Agency",
    monthlyPriceUsd: 699,
    maxActiveCampaigns: 4,
    description: "Up to 4 concurrent active product campaigns across products or markets.",
  },
  test_isolated: {
    tier: "test_isolated",
    displayName: "Isolated Verification Entitlement",
    monthlyPriceUsd: 0,
    maxActiveCampaigns: 4,
    description: "Isolated test entitlement for verifying multi-campaign behavior without mutating production billing.",
  },
};

export interface AccountEntitlementStatus {
  accountId: string;
  packageTier: PackageTier;
  displayName: string;
  monthlyPriceUsd: number;
  maxActiveCampaigns: number;
  currentActiveCampaigns: number;
  activeCampaignIds: string[];
  remainingActiveSlots: number;
  canActivateAnotherCampaign: boolean;
  isTestEntitlement: boolean;
  availablePackages: PackageDefinition[];
}

export async function getAccountEntitlement(accountId: string): Promise<AccountEntitlementStatus> {
  const [entRow] = await db
    .select()
    .from(accountEntitlements)
    .where(eq(accountEntitlements.accountId, accountId))
    .limit(1);

  const campaigns = await db
    .select({
      selectedCampaignId: campaignSelections.selectedCampaignId,
      campaignStatus: campaignSelections.campaignStatus,
      isArchived: campaignSelections.isArchived,
    })
    .from(campaignSelections)
    .where(eq(campaignSelections.accountId, accountId));

  const activeCampaignIds = Array.from(
    new Set(
      campaigns
        .filter((c) => c.campaignStatus === "active" && !c.isArchived)
        .map((c) => c.selectedCampaignId)
    )
  );

  const tierKey = (entRow?.packageTier?.toLowerCase() as PackageTier) || "starter";
  const catalogDef = PROPOSED_PACKAGE_CATALOG[tierKey] || PROPOSED_PACKAGE_CATALOG.starter;
  const maxActiveCampaigns = entRow?.maxActiveCampaigns ?? catalogDef.maxActiveCampaigns;
  const monthlyPriceUsd = entRow?.monthlyPriceUsd ?? catalogDef.monthlyPriceUsd;
  const currentActiveCampaigns = activeCampaignIds.length;
  const remainingActiveSlots = Math.max(0, maxActiveCampaigns - currentActiveCampaigns);

  return {
    accountId,
    packageTier: tierKey,
    displayName: catalogDef.displayName,
    monthlyPriceUsd,
    maxActiveCampaigns,
    currentActiveCampaigns,
    activeCampaignIds,
    remainingActiveSlots,
    canActivateAnotherCampaign: currentActiveCampaigns < maxActiveCampaigns,
    isTestEntitlement: Boolean(entRow?.isTestEntitlement),
    availablePackages: [
      PROPOSED_PACKAGE_CATALOG.starter,
      PROPOSED_PACKAGE_CATALOG.growth,
      PROPOSED_PACKAGE_CATALOG.agency,
    ],
  };
}

export async function checkCampaignActivationEntitlement(
  accountId: string,
  targetCampaignId?: string
): Promise<{
  allowed: boolean;
  entitlement: AccountEntitlementStatus;
  reason?: string;
  suggestedUpgradeTier?: PackageDefinition;
}> {
  const entitlement = await getAccountEntitlement(accountId);

  // If the target campaign is already one of the active campaigns, re-activating/updating it is allowed.
  if (targetCampaignId && entitlement.activeCampaignIds.includes(targetCampaignId)) {
    return { allowed: true, entitlement };
  }

  if (entitlement.currentActiveCampaigns < entitlement.maxActiveCampaigns) {
    return { allowed: true, entitlement };
  }

  const nextTier =
    entitlement.packageTier === "starter"
      ? PROPOSED_PACKAGE_CATALOG.growth
      : entitlement.packageTier === "growth"
      ? PROPOSED_PACKAGE_CATALOG.agency
      : undefined;

  return {
    allowed: false,
    entitlement,
    suggestedUpgradeTier: nextTier,
    reason: `Active campaign limit reached for ${entitlement.displayName} package (${entitlement.currentActiveCampaigns}/${entitlement.maxActiveCampaigns} active). Pause an existing campaign or upgrade to ${
      nextTier ? `${nextTier.displayName} ($${nextTier.monthlyPriceUsd}/mo for ${nextTier.maxActiveCampaigns} active campaigns)` : "a higher package"
    } to activate another campaign.`,
  };
}

export async function setAccountEntitlementTier(
  accountId: string,
  tier: PackageTier,
  options?: { isTestEntitlement?: boolean; notes?: string; maxActiveOverride?: number }
): Promise<AccountEntitlementStatus> {
  const def = PROPOSED_PACKAGE_CATALOG[tier] || PROPOSED_PACKAGE_CATALOG.starter;
  const maxActive = options?.maxActiveOverride ?? def.maxActiveCampaigns;
  const isTest = options?.isTestEntitlement ?? (tier === "test_isolated");

  await db
    .insert(accountEntitlements)
    .values({
      accountId,
      packageTier: def.tier,
      monthlyPriceUsd: def.monthlyPriceUsd,
      maxActiveCampaigns: maxActive,
      isTestEntitlement: isTest,
      notes:
        options?.notes ||
        "Proposed package configuration update (no customer billing mutation)",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: accountEntitlements.accountId,
      set: {
        packageTier: def.tier,
        monthlyPriceUsd: def.monthlyPriceUsd,
        maxActiveCampaigns: maxActive,
        isTestEntitlement: isTest,
        notes:
          options?.notes ||
          "Proposed package configuration update (no customer billing mutation)",
        updatedAt: new Date(),
      },
    });

  return getAccountEntitlement(accountId);
}

export interface CampaignUsageLedgerSummary {
  accountId: string;
  campaignId: string;
  aiUsage: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    retriedCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    totalReasoningTokens: number;
    knownBilledCostUsd: number | null;
    unknownCostCallCount: number;
    costStatus: "COMPLETE" | "PARTIAL_UNKNOWN" | "UNKNOWN";
    byOperation: Array<{
      operationType: string;
      provider: string | null;
      model: string;
      callCount: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      knownCostUsd: number | null;
      unknownCostCount: number;
      latestCallId: string | null;
    }>;
  };
  acquisitionUsage: {
    totalRequests: number;
    freshFetchCount: number;
    cacheReuseCount: number;
    originatingPaidTaskCount: number;
    sharedConsumerReuseCount: number;
    knownOriginatingCostUsd: number | null;
    unknownCostTaskCount: number;
    costStatus: "COMPLETE" | "PARTIAL_UNKNOWN" | "UNKNOWN";
    requests: Array<{
      requestId: string;
      taskId: string | null;
      requesterEngine: string;
      platform: string;
      capability: string;
      resolutionType: string;
      dataReuseStatus: string;
      providerRunId: string | null;
      status: string;
      billedToThisCampaignUsd: number | null;
      costStatus: "BILLED_ORIGINATING" | "SHARED_REUSE_ZERO_INCREMENTAL" | "UNKNOWN";
      sharedConsumerCampaignIds: string[];
      attributionPolicy: string;
      requestedAt: Date;
    }>;
  };
}

export async function getCampaignUsageLedger(
  accountId: string,
  campaignId: string
): Promise<CampaignUsageLedgerSummary> {
  // 1. Query AI usage rows for this campaign
  const aiRows = await db
    .select()
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.accountId, accountId), eq(aiUsageLog.campaignId, campaignId)))
    .orderBy(desc(aiUsageLog.createdAt))
    .limit(500);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let totalReasoningTokens = 0;
  let knownAiCostSum = 0;
  let hasKnownAiCost = false;
  let unknownAiCostCount = 0;
  let successfulCalls = 0;
  let failedCalls = 0;
  let retriedCalls = 0;

  const opMap = new Map<
    string,
    {
      operationType: string;
      provider: string | null;
      model: string;
      callCount: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      knownCostSum: number;
      hasKnownCost: boolean;
      unknownCostCount: number;
      latestCallId: string | null;
    }
  >();

  for (const row of aiRows) {
    if (row.endpoint === "budget_reservation") continue;
    if (row.success) successfulCalls += 1;
    else failedCalls += 1;
    if ((row.retryCount ?? 0) > 0) retriedCalls += 1;

    const inTok = row.inputTokens ?? 0;
    const outTok = row.outputTokens ?? 0;
    const cachedTok = row.cachedTokens ?? 0;
    const reasTok = row.reasoningTokens ?? 0;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;
    totalCachedTokens += cachedTok;
    totalReasoningTokens += reasTok;

    const rowCostKnown = row.costUsd !== null && row.costUsd !== undefined && row.costStatus !== "UNKNOWN" && row.costStatus !== "PRICING_UNKNOWN";
    if (rowCostKnown) {
      knownAiCostSum += Number(row.costUsd);
      hasKnownAiCost = true;
    } else {
      unknownAiCostCount += 1;
    }

    const opKey = `${row.operationType || row.endpoint}::${row.provider || "unknown"}::${row.model}`;
    const existing = opMap.get(opKey) || {
      operationType: row.operationType || row.endpoint,
      provider: row.provider || null,
      model: row.model,
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      knownCostSum: 0,
      hasKnownCost: false,
      unknownCostCount: 0,
      latestCallId: row.providerCallId || null,
    };
    existing.callCount += 1;
    existing.inputTokens += inTok;
    existing.outputTokens += outTok;
    existing.cachedTokens += cachedTok;
    if (rowCostKnown) {
      existing.knownCostSum += Number(row.costUsd);
      existing.hasKnownCost = true;
    } else {
      existing.unknownCostCount += 1;
    }
    if (!existing.latestCallId && row.providerCallId) {
      existing.latestCallId = row.providerCallId;
    }
    opMap.set(opKey, existing);
  }

  // 2. Query Acquisition requests for this campaign
  const reqRows = await db
    .select()
    .from(acquisitionRequests)
    .where(and(eq(acquisitionRequests.accountId, accountId), eq(acquisitionRequests.campaignId, campaignId)))
    .orderBy(desc(acquisitionRequests.requestedAt))
    .limit(200);

  // Also fetch tasks referenced by these requests so we know which campaign originated the paid task
  const taskIds = Array.from(new Set(reqRows.map((r) => r.taskId).filter(Boolean) as string[]));
  const taskMap = new Map<string, typeof acquisitionTasks.$inferSelect>();
  if (taskIds.length > 0) {
    const tasks = await db
      .select()
      .from(acquisitionTasks)
      .where(sql`${acquisitionTasks.id} IN (${sql.join(taskIds.map((id) => sql`${id}`), sql`, `)})`);
    for (const t of tasks) {
      taskMap.set(t.id, t);
    }
  }

  let freshFetchCount = 0;
  let cacheReuseCount = 0;
  let originatingPaidTaskCount = 0;
  let sharedConsumerReuseCount = 0;
  let knownAcqCostSum = 0;
  let hasKnownAcqCost = false;
  let unknownAcqCostCount = 0;
  const countedOriginatingTaskIds = new Set<string>();

  const formattedRequests = reqRows.map((r) => {
    const linkedTask = r.taskId ? taskMap.get(r.taskId) : undefined;
    const isCacheReuse =
      r.resolutionType === "CACHE_REUSE" ||
      r.resolutionType === "COALESCED_IN_FLIGHT" ||
      r.dataReuseStatus === "REUSED_FROM_CACHE" ||
      (linkedTask && linkedTask.campaignId !== campaignId);

    if (isCacheReuse) {
      cacheReuseCount += 1;
      sharedConsumerReuseCount += 1;
      return {
        requestId: r.id,
        taskId: r.taskId,
        requesterEngine: r.requesterEngine,
        platform: r.platform,
        capability: r.capability,
        resolutionType: r.resolutionType,
        dataReuseStatus: r.dataReuseStatus || "REUSED_FROM_CACHE",
        providerRunId: r.providerRunId || linkedTask?.providerRunId || null,
        status: r.status,
        // Shared provider charge is counted ONCE on the originating campaign; consuming campaign incremental charge is 0
        billedToThisCampaignUsd: 0,
        costStatus: "SHARED_REUSE_ZERO_INCREMENTAL" as const,
        sharedConsumerCampaignIds: Array.isArray(r.sharedConsumerCampaignIds)
          ? (r.sharedConsumerCampaignIds as string[])
          : Array.isArray(linkedTask?.sharedConsumerCampaignIds)
          ? (linkedTask?.sharedConsumerCampaignIds as string[])
          : [],
        attributionPolicy: r.attributionPolicy || "ORIGINATING_CAMPAIGN_ONCE",
        requestedAt: r.requestedAt,
      };
    }

    freshFetchCount += 1;
    const rawUsageUsd = r.usageUsd ?? linkedTask?.usageUsd ?? null;
    const isTaskAlreadyCounted = r.taskId ? countedOriginatingTaskIds.has(r.taskId) : false;
    if (r.taskId) countedOriginatingTaskIds.add(r.taskId);

    if (rawUsageUsd !== null && rawUsageUsd !== undefined) {
      if (!isTaskAlreadyCounted) {
        originatingPaidTaskCount += 1;
        knownAcqCostSum += Number(rawUsageUsd);
        hasKnownAcqCost = true;
      }
      return {
        requestId: r.id,
        taskId: r.taskId,
        requesterEngine: r.requesterEngine,
        platform: r.platform,
        capability: r.capability,
        resolutionType: r.resolutionType,
        dataReuseStatus: r.dataReuseStatus || "NEWLY_ACQUIRED",
        providerRunId: r.providerRunId || linkedTask?.providerRunId || null,
        status: r.status,
        billedToThisCampaignUsd: isTaskAlreadyCounted ? 0 : Number(rawUsageUsd.toFixed(6)),
        costStatus: "BILLED_ORIGINATING" as const,
        sharedConsumerCampaignIds: Array.isArray(r.sharedConsumerCampaignIds)
          ? (r.sharedConsumerCampaignIds as string[])
          : Array.isArray(linkedTask?.sharedConsumerCampaignIds)
          ? (linkedTask?.sharedConsumerCampaignIds as string[])
          : [],
        attributionPolicy: r.attributionPolicy || "ORIGINATING_CAMPAIGN_ONCE",
        requestedAt: r.requestedAt,
      };
    } else {
      if (!isTaskAlreadyCounted) {
        unknownAcqCostCount += 1;
      }
      return {
        requestId: r.id,
        taskId: r.taskId,
        requesterEngine: r.requesterEngine,
        platform: r.platform,
        capability: r.capability,
        resolutionType: r.resolutionType,
        dataReuseStatus: r.dataReuseStatus || "NEWLY_ACQUIRED",
        providerRunId: r.providerRunId || linkedTask?.providerRunId || null,
        status: r.status,
        // Missing cost is UNKNOWN (null), never zero!
        billedToThisCampaignUsd: null,
        costStatus: "UNKNOWN" as const,
        sharedConsumerCampaignIds: Array.isArray(r.sharedConsumerCampaignIds)
          ? (r.sharedConsumerCampaignIds as string[])
          : [],
        attributionPolicy: r.attributionPolicy || "ORIGINATING_CAMPAIGN_ONCE",
        requestedAt: r.requestedAt,
      };
    }
  });

  const aiCostStatus: "COMPLETE" | "PARTIAL_UNKNOWN" | "UNKNOWN" =
    aiRows.length === 0
      ? "UNKNOWN"
      : unknownAiCostCount === 0 && hasKnownAiCost
      ? "COMPLETE"
      : hasKnownAiCost
      ? "PARTIAL_UNKNOWN"
      : "UNKNOWN";

  const acqCostStatus: "COMPLETE" | "PARTIAL_UNKNOWN" | "UNKNOWN" =
    reqRows.length === 0
      ? "UNKNOWN"
      : unknownAcqCostCount === 0 && (hasKnownAcqCost || cacheReuseCount > 0)
      ? "COMPLETE"
      : hasKnownAcqCost
      ? "PARTIAL_UNKNOWN"
      : "UNKNOWN";

  return {
    accountId,
    campaignId,
    aiUsage: {
      totalCalls: successfulCalls + failedCalls,
      successfulCalls,
      failedCalls,
      retriedCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      totalReasoningTokens,
      knownBilledCostUsd: hasKnownAiCost ? Number(knownAiCostSum.toFixed(6)) : null,
      unknownCostCallCount: unknownAiCostCount,
      costStatus: aiCostStatus,
      byOperation: Array.from(opMap.values()).map((op) => ({
        operationType: op.operationType,
        provider: op.provider,
        model: op.model,
        callCount: op.callCount,
        inputTokens: op.inputTokens,
        outputTokens: op.outputTokens,
        cachedTokens: op.cachedTokens,
        knownCostUsd: op.hasKnownCost ? Number(op.knownCostSum.toFixed(6)) : null,
        unknownCostCount: op.unknownCostCount,
        latestCallId: op.latestCallId,
      })),
    },
    acquisitionUsage: {
      totalRequests: reqRows.length,
      freshFetchCount,
      cacheReuseCount,
      originatingPaidTaskCount,
      sharedConsumerReuseCount,
      knownOriginatingCostUsd: hasKnownAcqCost
        ? Number(knownAcqCostSum.toFixed(6))
        : cacheReuseCount > 0 && freshFetchCount === 0
        ? 0
        : null,
      unknownCostTaskCount: unknownAcqCostCount,
      costStatus: acqCostStatus,
      requests: formattedRequests,
    },
  };
}
