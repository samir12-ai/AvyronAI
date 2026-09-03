import { resolveAccountIdFromCampaign } from "./account-resolver";
import {
  ALL_CANONICAL_ADAPTERS,
  type CanonicalPlatform,
  type PlatformSnapshotResult,
  type ProviderStatus,
} from "./platform-adapters";
import type { OwnedSourceSnapshotRow } from "@shared/schema";

export interface NormalizedFactualDossier {
  accountId: string;
  campaignId: string;
  sourceSnapshots: OwnedSourceSnapshotRow[];
  platformMetricsMap: Record<CanonicalPlatform, PlatformSnapshotResult>;
  websiteFact?: {
    snapshotId: string;
    hasWebsite: boolean;
    url?: string;
    hasProductOffering: boolean;
    evidenceRefId: string;
  };
  instagramFact?: {
    snapshotId: string;
    isConnected: boolean;
    channelAgeMonths?: number;
    totalPostsObserved: number;
    oldestPostDate?: string;
    latestPostDate?: string;
    totalReach: number;
    totalImpressions: number;
    totalEngagement: number;
    followersCount: number;
    evidenceRefId: string;
  };
  manualTruthFact?: {
    snapshotId: string;
    hasUserTruth: boolean;
    historicalLeadCount?: number;
    historicalCustomerCount?: number;
    salesRevenue?: number;
    lastUpdated?: string;
    evidenceRefId: string;
  };
  tikTokFact?: {
    snapshotId: string;
    providerStatus: ProviderStatus;
    evidenceRefId: string;
  };
  youTubeFact?: {
    snapshotId: string;
    providerStatus: ProviderStatus;
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
        evidenceRefId: webResult.evidenceRefId,
      }
    : undefined;

  const igResult = platformMetricsMap.INSTAGRAM;
  const instagramFact = igResult
    ? {
        snapshotId: igResult.snapshot.id,
        isConnected: !!igResult.factualMetrics.isConnected,
        channelAgeMonths: igResult.factualMetrics.channelAgeMonths,
        totalPostsObserved: igResult.factualMetrics.totalPostsObserved ?? 0,
        oldestPostDate: igResult.factualMetrics.oldestPostDate,
        latestPostDate: igResult.factualMetrics.latestPostDate,
        totalReach: igResult.factualMetrics.totalReach ?? 0,
        totalImpressions: igResult.factualMetrics.totalImpressions ?? 0,
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
        userAnswer: truthResult.factualMetrics.userAnswer ?? undefined,
        historicalLeadCount: truthResult.factualMetrics.leads ?? undefined,
        historicalCustomerCount: truthResult.factualMetrics.payingCustomers ?? undefined,
        salesRevenue: truthResult.factualMetrics.revenue ?? undefined,
        evidenceRefId: truthResult.evidenceRefId,
      }
    : undefined;

  const tikTokResult = platformMetricsMap.TIKTOK;
  const tikTokFact = tikTokResult
    ? {
        snapshotId: tikTokResult.snapshot.id,
        providerStatus: (tikTokResult.snapshot.providerStatus as ProviderStatus) || "COMING_SOON",
        evidenceRefId: tikTokResult.evidenceRefId,
      }
    : undefined;

  const youTubeResult = platformMetricsMap.YOUTUBE;
  const youTubeFact = youTubeResult
    ? {
        snapshotId: youTubeResult.snapshot.id,
        providerStatus: (youTubeResult.snapshot.providerStatus as ProviderStatus) || "COMING_SOON",
        evidenceRefId: youTubeResult.evidenceRefId,
      }
    : undefined;

  return {
    accountId: canonicalAccountId,
    campaignId,
    sourceSnapshots,
    platformMetricsMap,
    websiteFact,
    instagramFact,
    manualTruthFact,
    tikTokFact,
    youTubeFact,
    providerFailures,
  };
}
