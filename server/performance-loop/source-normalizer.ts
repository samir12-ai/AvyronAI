import { resolveAccountIdFromCampaign } from "./account-resolver";
import {
  ALL_CANONICAL_ADAPTERS,
  type CanonicalPlatform,
  type PlatformSnapshotResult,
  type ProviderStatus,
} from "./platform-adapters";
import { db } from "../db";
import {
  userPublicProfiles,
  taskContentMatchLineage,
  type OwnedSourceSnapshotRow,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

export interface SharedChannelAttributionSummary {
  hasSharedChannelsAcrossCampaigns: boolean;
  sharedChannels: Array<{
    platform: string;
    handle: string;
    sharedAcrossCampaignIds: string[];
    accountWideFollowersContext: number | null;
    channelScopeLabel: "SHARED_ACCOUNT_CHANNEL" | "DEDICATED_CAMPAIGN_CHANNEL";
  }>;
  campaignAttributedPostsCount: number;
  unattributedSharedPostsCount: number;
  attributionPolicyNote: string;
}

export interface NormalizedFactualDossier {
  accountId: string;
  campaignId: string;
  sourceSnapshots: OwnedSourceSnapshotRow[];
  platformMetricsMap: Record<CanonicalPlatform, PlatformSnapshotResult>;
  sharedChannelAttribution?: SharedChannelAttributionSummary;
  websiteFact?: {
    snapshotId: string;
    hasWebsite: boolean;
    url?: string;
    hasProductOffering: boolean;
    offeringName?: string | null;
    evidenceRefId: string;
  };
  instagramFact?: {
    snapshotId: string;
    isConnected: boolean;
    channelLifecycleState?: string;
    channelAgeMonths?: number;
    totalPostsObserved: number;
    oldestPostDate?: string;
    latestPostDate?: string;
    totalReach: number | null;
    totalImpressions: number | null;
    totalEngagement: number;
    followersCount: number;
    evidenceRefId: string;
  };
  manualTruthFact?: {
    snapshotId: string;
    hasUserTruth: boolean;
    hasBaselineTruth?: boolean;
    hasWeeklyWindowTruth?: boolean;
    userAnswer?: string;
    structuredBaseline?: Record<string, any> | null;
    operatingHistoryMonths?: number | null;
    hasHistoricalPaidCustomers?: boolean | null;
    historicalLeadCount?: number | null;
    historicalCustomerCount?: number | null;
    historicalRevenueAmount?: number | null;
    weeklyLeads?: number | null;
    weeklyPayingCustomers?: number | null;
    weeklyRevenue?: number | null;
    weeklyAdSpend?: number | null;
    weeklyWindow?: {
      inventoryId: string;
      windowId: string | null;
      windowIndex: number | null;
      periodStart: string | null;
      periodEnd: string | null;
      status: string;
      completionState: string | null;
      leads: number | null;
      qualifiedLeads: number | null;
      conversations: number | null;
      trialsOrBookedCalls: number | null;
      payingCustomers: number | null;
      revenue: number | null;
      adSpend: number | null;
      currency: string;
    } | null;
    salesRevenue?: number;
    adSpend?: number;
    lastUpdated?: string;
    evidenceRefId: string;
  };
  tikTokFact?: {
    snapshotId: string;
    providerStatus: ProviderStatus;
    channelLifecycleState?: string;
    isConnected?: boolean;
    totalPostsObserved?: number;
    followersCount?: number;
    totalViews?: number | null;
    totalEngagement?: number;
    accountTotalContent?: number | null;
    countMeaning?: string;
    evidenceRefId: string;
  };
  youTubeFact?: {
    snapshotId: string;
    providerStatus: ProviderStatus;
    channelLifecycleState?: string;
    isConnected?: boolean;
    totalPostsObserved?: number;
    followersCount?: number;
    totalViews?: number | null;
    totalEngagement?: number;
    accountTotalContent?: number | null;
    countMeaning?: string;
    evidenceRefId: string;
  };
  linkedInFact?: {
    snapshotId: string;
    providerStatus: ProviderStatus;
    channelLifecycleState?: string;
    isConnected: boolean;
    isIdentityUnresolved?: boolean;
    accountType?: "company" | "profile" | null;
    handle?: string | null;
    url?: string | null;
    totalPostsObserved: number;
    followersCount: number;
    totalViews?: number | null;
    totalEngagement: number;
    scrapeError?: string | null;
    accountTotalContent?: number | null;
    countMeaning?: string;
    evidenceRefId: string;
  };
  providerFailures: string[];
}

export async function assembleFactualDossier(params: {
  accountId?: string;
  campaignId: string;
}): Promise<NormalizedFactualDossier> {
  const { campaignId, accountId: providedAccountId } = params;

  // HARD INVARIANT: Canonical account resolution + failure-closed mismatch assertion
  const canonicalAccountId = await resolveAccountIdFromCampaign(campaignId, providedAccountId);

  const sourceSnapshots: OwnedSourceSnapshotRow[] = [];
  const providerFailures: string[] = [];
  const platformMetricsMap = {} as Record<CanonicalPlatform, PlatformSnapshotResult>;

  // Dynamically iterate across all registered platform adapters
  for (const [platformKey, adapter] of Object.entries(ALL_CANONICAL_ADAPTERS)) {
    try {
      const result = await adapter.fetchSnapshot(canonicalAccountId, campaignId);
      platformMetricsMap[platformKey as CanonicalPlatform] = result;
      sourceSnapshots.push(result.snapshot);
    } catch (err: any) {
      providerFailures.push(`${platformKey}_FETCH_FAILED: ${err.message}`);
    }
  }

  // Convenient references for core engines
  const webResult = platformMetricsMap.WEBSITE;
  const websiteFact = webResult
    ? {
        snapshotId: webResult.snapshot.id,
        hasWebsite: !!webResult.factualMetrics.hasWebsite,
        url: webResult.factualMetrics.url,
        hasProductOffering: !!webResult.factualMetrics.hasProductOffering,
        offeringName: webResult.factualMetrics.offeringName ?? null,
        evidenceRefId: webResult.evidenceRefId,
      }
    : undefined;

  const igResult = platformMetricsMap.INSTAGRAM;
  const instagramFact = igResult
    ? {
        snapshotId: igResult.snapshot.id,
        isConnected: !!igResult.factualMetrics.isConnected,
        channelLifecycleState: igResult.factualMetrics.channelLifecycleState,
        channelAgeMonths: igResult.factualMetrics.channelAgeMonths,
        totalPostsObserved: igResult.factualMetrics.totalPostsObserved ?? 0,
        oldestPostDate: igResult.factualMetrics.oldestPostDate,
        latestPostDate: igResult.factualMetrics.latestPostDate,
        totalReach: igResult.factualMetrics.totalReach ?? null,
        totalImpressions: igResult.factualMetrics.totalImpressions ?? null,
        totalEngagement: igResult.factualMetrics.totalEngagement ?? 0,
        followersCount: igResult.factualMetrics.followersCount ?? 0,
        evidenceRefId: igResult.evidenceRefId,
      }
    : undefined;

  const truthResult = platformMetricsMap.MANUAL_BUSINESS_TRUTH;
  console.log("[source-normalizer] providerFailures:", providerFailures);
  console.log("[source-normalizer] truthResult:", { hasTruthResult: !!truthResult, metrics: truthResult?.factualMetrics });
  const manualTruthFact = truthResult
    ? {
        snapshotId: truthResult.snapshot.id,
        hasUserTruth: !!truthResult.factualMetrics.hasUserTruth,
        hasBaselineTruth: !!truthResult.factualMetrics.hasBaselineTruth,
        hasWeeklyWindowTruth: !!truthResult.factualMetrics.hasWeeklyWindowTruth,
        userAnswer: truthResult.factualMetrics.userAnswer ?? undefined,
        structuredBaseline: truthResult.factualMetrics.structuredBaseline ?? null,
        operatingHistoryMonths: truthResult.factualMetrics.operatingHistoryMonths ?? null,
        hasHistoricalPaidCustomers: truthResult.factualMetrics.hasHistoricalPaidCustomers ?? null,
        historicalPayingCustomersCount: truthResult.factualMetrics.historicalPayingCustomersCount ?? null,
        historicalLeadsCount: truthResult.factualMetrics.historicalLeadsCount ?? null,
        historicalLeadCount: truthResult.factualMetrics.leads ?? undefined,
        historicalCustomerCount: truthResult.factualMetrics.payingCustomers ?? undefined,
        historicalRevenueAmount: truthResult.factualMetrics.historicalRevenueAmount ?? null,
        weeklyLeads: truthResult.factualMetrics.weeklyWindow?.leads ?? null,
        weeklyPayingCustomers: truthResult.factualMetrics.weeklyWindow?.payingCustomers ?? null,
        weeklyRevenue: truthResult.factualMetrics.weeklyWindow?.revenue ?? null,
        weeklyAdSpend: truthResult.factualMetrics.weeklyWindow?.adSpend ?? null,
        weeklyWindow: truthResult.factualMetrics.weeklyWindow ?? null,
        salesRevenue: truthResult.factualMetrics.revenue ?? undefined,
        adSpend: truthResult.factualMetrics.adSpend ?? undefined,
        evidenceRefId: truthResult.evidenceRefId,
      }
    : undefined;

  const tikTokResult = platformMetricsMap.TIKTOK;
  const tikTokFact = tikTokResult
    ? {
        snapshotId: tikTokResult.snapshot.id,
        providerStatus: (tikTokResult.snapshot.providerStatus as ProviderStatus) || "NOT_CONNECTED",
        channelLifecycleState: tikTokResult.factualMetrics.channelLifecycleState,
        isConnected: !!tikTokResult.factualMetrics.isConnected,
        totalPostsObserved: tikTokResult.factualMetrics.totalPostsObserved ?? 0,
        followersCount: tikTokResult.factualMetrics.followersCount ?? 0,
        totalViews: tikTokResult.factualMetrics.totalViews ?? null,
        totalEngagement: tikTokResult.factualMetrics.totalEngagement ?? 0,
        accountTotalContent: tikTokResult.factualMetrics.accountTotalContent ?? null,
        countMeaning: tikTokResult.factualMetrics.countMeaning || "stored_unique_items_in_db",
        evidenceRefId: tikTokResult.evidenceRefId,
      }
    : undefined;

  const youTubeResult = platformMetricsMap.YOUTUBE;
  const youTubeFact = youTubeResult
    ? {
        snapshotId: youTubeResult.snapshot.id,
        providerStatus: (youTubeResult.snapshot.providerStatus as ProviderStatus) || "NOT_CONNECTED",
        channelLifecycleState: youTubeResult.factualMetrics.channelLifecycleState,
        isConnected: !!youTubeResult.factualMetrics.isConnected,
        totalPostsObserved: youTubeResult.factualMetrics.totalPostsObserved ?? 0,
        followersCount: youTubeResult.factualMetrics.followersCount ?? 0,
        totalViews: youTubeResult.factualMetrics.totalViews ?? null,
        totalEngagement: youTubeResult.factualMetrics.totalEngagement ?? 0,
        accountTotalContent: youTubeResult.factualMetrics.accountTotalContent ?? null,
        countMeaning: youTubeResult.factualMetrics.countMeaning || "stored_unique_items_in_db",
        evidenceRefId: youTubeResult.evidenceRefId,
      }
    : undefined;

  const linkedInResult = platformMetricsMap.LINKEDIN;
  const linkedInFact = linkedInResult
    ? {
        snapshotId: linkedInResult.snapshot.id,
        providerStatus: (linkedInResult.snapshot.providerStatus as ProviderStatus) || "NOT_CONNECTED",
        channelLifecycleState: linkedInResult.factualMetrics.channelLifecycleState,
        isConnected: !!linkedInResult.factualMetrics.isConnected,
        isIdentityUnresolved: !!linkedInResult.factualMetrics.isIdentityUnresolved,
        accountType: linkedInResult.factualMetrics.accountType ?? null,
        handle: linkedInResult.factualMetrics.handle ?? null,
        url: linkedInResult.factualMetrics.url ?? null,
        totalPostsObserved: linkedInResult.factualMetrics.totalPostsObserved ?? 0,
        followersCount: linkedInResult.factualMetrics.followersCount ?? 0,
        totalViews: linkedInResult.factualMetrics.totalViews ?? null,
        totalEngagement: linkedInResult.factualMetrics.totalEngagement ?? 0,
        scrapeError: linkedInResult.factualMetrics.scrapeError ?? null,
        accountTotalContent: linkedInResult.factualMetrics.accountTotalContent ?? null,
        countMeaning: linkedInResult.factualMetrics.countMeaning || "stored_unique_items_in_db",
        evidenceRefId: linkedInResult.evidenceRefId,
      }
    : undefined;

  // Evaluate shared channel context vs. explicit campaign-attributed post lineage
  let sharedChannelAttribution: SharedChannelAttributionSummary | undefined;
  try {
    const accountProfiles = await db
      .select()
      .from(userPublicProfiles)
      .where(eq(userPublicProfiles.accountId, canonicalAccountId));

    const campaignProfiles = accountProfiles.filter(
      (p) => p.campaignId === campaignId && p.status !== "DISCONNECTED"
    );

    const sharedChannels = campaignProfiles.map((cp) => {
      const cleanKey = (cp.handle || cp.url || "").trim().toLowerCase();
      const matchingCampaignIds = Array.from(
        new Set(
          accountProfiles
            .filter(
              (ap) =>
                ap.status !== "DISCONNECTED" &&
                ap.platform.toLowerCase() === cp.platform.toLowerCase() &&
                (ap.handle || ap.url || "").trim().toLowerCase() === cleanKey &&
                cleanKey.length > 0
            )
            .map((ap) => ap.campaignId)
        )
      );
      const isShared = matchingCampaignIds.length > 1;
      return {
        platform: cp.platform.toLowerCase(),
        handle: cp.handle || cp.url || "",
        sharedAcrossCampaignIds: matchingCampaignIds,
        accountWideFollowersContext: cp.followersCount ?? null,
        channelScopeLabel: (isShared
          ? "SHARED_ACCOUNT_CHANNEL"
          : "DEDICATED_CAMPAIGN_CHANNEL") as "SHARED_ACCOUNT_CHANNEL" | "DEDICATED_CAMPAIGN_CHANNEL",
      };
    });

    const lineageRows = await db
      .select()
      .from(taskContentMatchLineage)
      .where(
        and(
          eq(taskContentMatchLineage.accountId, canonicalAccountId),
          eq(taskContentMatchLineage.campaignId, campaignId)
        )
      );

    const campaignAttributedPostsCount = lineageRows.filter(
      (l) =>
        l.lineageState === "MATCHED_TO_TASK" ||
        l.lineageState === "USER_CONFIRMED" ||
        Boolean(l.matchedTaskId)
    ).length;

    const totalObservedPosts =
      (instagramFact?.totalPostsObserved ?? 0) +
      (tikTokFact?.totalPostsObserved ?? 0) +
      (youTubeFact?.totalPostsObserved ?? 0) +
      (linkedInFact?.totalPostsObserved ?? 0);

    const unattributedSharedPostsCount = Math.max(0, totalObservedPosts - campaignAttributedPostsCount);
    const hasSharedChannelsAcrossCampaigns = sharedChannels.some(
      (sc) => sc.channelScopeLabel === "SHARED_ACCOUNT_CHANNEL"
    );

    sharedChannelAttribution = {
      hasSharedChannelsAcrossCampaigns,
      sharedChannels,
      campaignAttributedPostsCount,
      unattributedSharedPostsCount,
      attributionPolicyNote: hasSharedChannelsAcrossCampaigns
        ? "Account-wide followers and unlinked social posts are treated as SHARED_ACCOUNT_CHANNEL context; only explicitly linked posts and campaign check-in numbers are attributed to this campaign."
        : "Owned channels are currently dedicated to this campaign.",
    };
  } catch (attrErr: any) {
    console.warn("[source-normalizer] Non-fatal shared channel attribution warning:", attrErr?.message || attrErr);
  }

  return {
    accountId: canonicalAccountId,
    campaignId,
    sourceSnapshots,
    platformMetricsMap,
    sharedChannelAttribution,
    websiteFact,
    instagramFact,
    manualTruthFact,
    tikTokFact,
    youTubeFact,
    linkedInFact,
    providerFailures,
  };
}
