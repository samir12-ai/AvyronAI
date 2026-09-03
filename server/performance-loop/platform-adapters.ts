import { randomUUID } from "crypto";
import { db } from "../db";
import {
  ownedSourceSnapshots,
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  websiteSnapshots,
  businessDataLayer,
  pipelineUserTruth,
  manualCampaignMetrics,
  clarificationRequests,
  weeklyBusinessScores,
  type OwnedSourceSnapshotRow,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export type CanonicalPlatform =
  | "WEBSITE"
  | "INSTAGRAM"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN"
  | "FACEBOOK"
  | "X_TWITTER"
  | "MANUAL_BUSINESS_TRUTH"
  | "OTHER";

export type ProviderStatus = "CONNECTED" | "COMPLETE" | "PARTIAL" | "FAILED" | "NOT_CONNECTED" | "COMING_SOON" | "STALE";
export type HistoryAvailability = "CONFIRMED_HISTORY" | "PARTIAL_HISTORY" | "NO_HISTORY_CONFIRMED" | "UNKNOWN";

export function normalizePlatform(raw: string): CanonicalPlatform {
  const s = raw.toUpperCase().trim();
  if (s === "INSTAGRAM" || s === "IG") return "INSTAGRAM";
  if (s === "WEBSITE" || s === "WEB") return "WEBSITE";
  if (s === "TIKTOK") return "TIKTOK";
  if (s === "YOUTUBE" || s === "YT") return "YOUTUBE";
  if (s === "LINKEDIN") return "LINKEDIN";
  if (s === "FACEBOOK" || s === "FB" || s === "META") return "FACEBOOK";
  if (s === "TWITTER" || s === "X" || s === "X_TWITTER") return "X_TWITTER";
  if (s === "MANUAL_BUSINESS_TRUTH" || s === "MANUAL_TRUTH" || s === "TRUTH") return "MANUAL_BUSINESS_TRUTH";
  return "OTHER";
}

export interface PlatformSnapshotResult {
  platform: CanonicalPlatform;
  snapshot: OwnedSourceSnapshotRow;
  ingestionReady: boolean;
  factualMetrics: Record<string, any>;
  evidenceRefId: string;
}

export interface OwnedSourceAdapter {
  platform: CanonicalPlatform;
  ingestionReady: boolean;
  fetchSnapshot(accountId: string, campaignId: string): Promise<PlatformSnapshotResult>;
}

// 1. WEBSITE ADAPTER
export const WebsiteAdapter: OwnedSourceAdapter = {
  platform: "WEBSITE",
  ingestionReady: true,
  async fetchSnapshot(accountId, campaignId) {
    const [webSnap] = await db
      .select()
      .from(websiteSnapshots)
      .where(and(eq(websiteSnapshots.accountId, accountId), eq(websiteSnapshots.campaignId, campaignId)))
      .orderBy(desc(websiteSnapshots.createdAt))
      .limit(1);

    const [bizData] = await db
      .select()
      .from(businessDataLayer)
      .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
      .limit(1);

    const hasWeb = !!webSnap || !!bizData?.websiteUrl;
    const evId = `ev_web_${randomUUID().slice(0, 8)}`;

    const [snapshot] = await db
      .insert(ownedSourceSnapshots)
      .values({
        accountId,
        campaignId,
        sourceType: "WEBSITE",
        sourceIdentityId: bizData?.websiteUrl || webSnap?.url || "web_identity",
        historyAvailability: hasWeb ? "CONFIRMED_HISTORY" : "UNKNOWN",
        providerStatus: hasWeb ? "COMPLETE" : "NOT_CONNECTED",
        factualMetrics: {
          hasWebsite: hasWeb,
          url: bizData?.websiteUrl || webSnap?.url,
          hasProductOffering: !!bizData?.coreOffer || !!webSnap?.pageTitle,
        },
        evidenceRefIds: [evId],
      })
      .returning();

    return {
      platform: "WEBSITE",
      snapshot,
      ingestionReady: true,
      factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
      evidenceRefId: evId,
    };
  },
};

// 2. INSTAGRAM ADAPTER
export const InstagramAdapter: OwnedSourceAdapter = {
  platform: "INSTAGRAM",
  ingestionReady: true,
  async fetchSnapshot(accountId, campaignId) {
    // HARD GUARD: Filter strictly by accountId to prevent competitor contamination
    const posts = await db
      .select()
      .from(ownedPosts)
      .where(and(eq(ownedPosts.accountId, accountId), eq(ownedPosts.campaignId, campaignId)))
      .orderBy(desc(ownedPosts.postedAt));

    const totalPostsObserved = posts.length;
    const dates = posts.map(p => p.postedAt).filter(Boolean) as Date[];
    const oldestPostDate = dates.length > 0 ? dates[dates.length - 1].toISOString() : undefined;
    const latestPostDate = dates.length > 0 ? dates[0].toISOString() : undefined;

    let channelAgeMonths = 0;
    if (dates.length > 0) {
      const diffMs = Date.now() - dates[dates.length - 1].getTime();
      channelAgeMonths = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)));
    }

    const [pubProf] = await db
      .select()
      .from(userPublicProfiles)
      .where(
        and(
          eq(userPublicProfiles.accountId, accountId),
          eq(userPublicProfiles.campaignId, campaignId),
          eq(userPublicProfiles.platform, "instagram")
        )
      )
      .limit(1);

    const isConnected = !!pubProf || totalPostsObserved > 0;
    const evId = `ev_ig_${randomUUID().slice(0, 8)}`;

    const historyAvailability: HistoryAvailability =
      totalPostsObserved > 10 ? "CONFIRMED_HISTORY" : totalPostsObserved > 0 ? "PARTIAL_HISTORY" : isConnected ? "NO_HISTORY_CONFIRMED" : "UNKNOWN";

    const [snapshot] = await db
      .insert(ownedSourceSnapshots)
      .values({
        accountId,
        campaignId,
        sourceType: "INSTAGRAM",
        sourceIdentityId: pubProf?.handle || pubProf?.id || "ig_identity",
        historyAvailability,
        providerStatus: isConnected ? "COMPLETE" : "NOT_CONNECTED",
        factualMetrics: {
          isConnected,
          totalPostsObserved,
          oldestPostDate,
          latestPostDate,
          channelAgeMonths: totalPostsObserved > 0 ? channelAgeMonths : undefined,
          followersCount: pubProf?.followersCount || 0,
          totalReach: posts.reduce((s, p) => s + (p.reachCount || 0), 0),
          totalImpressions: posts.reduce((s, p) => s + (p.impressionsCount || 0), 0),
          totalEngagement: posts.reduce((s, p) => s + (p.likesCount || 0) + (p.commentsCount || 0), 0),
        },
        evidenceRefIds: [evId],
      })
      .returning();

    return {
      platform: "INSTAGRAM",
      snapshot,
      ingestionReady: true,
      factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
      evidenceRefId: evId,
    };
  },
};

// 3. MANUAL BUSINESS TRUTH ADAPTER
export const ManualTruthAdapter: OwnedSourceAdapter = {
  platform: "MANUAL_BUSINESS_TRUTH",
  ingestionReady: true,
  async fetchSnapshot(accountId, campaignId) {
    const [bizTruth] = await db
      .select()
      .from(pipelineUserTruth)
      .where(and(eq(pipelineUserTruth.accountId, accountId), eq(pipelineUserTruth.campaignId, campaignId)))
      .orderBy(desc(pipelineUserTruth.createdAt))
      .limit(1);

    const [manualMetrics] = await db
      .select()
      .from(manualCampaignMetrics)
      .where(and(eq(manualCampaignMetrics.accountId, accountId), eq(manualCampaignMetrics.campaignId, campaignId)))
      .orderBy(desc(manualCampaignMetrics.createdAt))
      .limit(1);

    const [answeredClarification] = await db
      .select()
      .from(clarificationRequests)
      .where(
        and(
          eq(clarificationRequests.campaignId, campaignId),
          eq(clarificationRequests.status, "ANSWERED")
        )
      )
      .orderBy(desc(clarificationRequests.answeredAt))
      .limit(1);

    const hasTruth = !!bizTruth || !!manualMetrics || !!answeredClarification?.userAnswer;
    console.log("[ManualTruthAdapter] fetchSnapshot resolved:", { hasTruth, bizTruth: !!bizTruth, manualMetrics: !!manualMetrics, answeredClarification: !!answeredClarification });
    const evId = `ev_truth_${randomUUID().slice(0, 8)}`;

    const [snapshot] = await db
      .insert(ownedSourceSnapshots)
      .values({
        accountId,
        campaignId,
        sourceType: "MANUAL_BUSINESS_TRUTH",
        sourceIdentityId: "manual_truth",
        historyAvailability: hasTruth ? "CONFIRMED_HISTORY" : "UNKNOWN",
        providerStatus: hasTruth ? "COMPLETE" : "NOT_CONNECTED",
        factualMetrics: {
          hasUserTruth: hasTruth,
          userAnswer: answeredClarification?.userAnswer || null,
          missingFactType: answeredClarification?.missingFactType || null,
          payingCustomers: bizTruth?.payingCustomers ?? manualMetrics?.totalCustomers ?? null,
          leads: bizTruth?.totalLeads ?? manualMetrics?.totalLeads ?? null,
          revenue: manualMetrics?.totalRevenue ?? null,
        },
        evidenceRefIds: [evId],
      })
      .returning();

    return {
      platform: "MANUAL_BUSINESS_TRUTH",
      snapshot,
      ingestionReady: true,
      factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
      evidenceRefId: evId,
    };
  },
};

// Generic Contract-Ready Adapter Factory for Future Providers (TikTok, YouTube, LinkedIn, Facebook, X_Twitter)
export function createContractReadyAdapter(platform: CanonicalPlatform): OwnedSourceAdapter {
  return {
    platform,
    ingestionReady: false,
    async fetchSnapshot(accountId, campaignId) {
      const evId = `ev_${platform.toLowerCase()}_${randomUUID().slice(0, 8)}`;

      // Query userPublicProfiles to check if an account was linked by user
      const [pubProf] = await db
        .select()
        .from(userPublicProfiles)
        .where(
          and(
            eq(userPublicProfiles.accountId, accountId),
            eq(userPublicProfiles.campaignId, campaignId),
            eq(userPublicProfiles.platform, platform.toLowerCase())
          )
        )
        .limit(1);

      const isConnected = !!pubProf;

      const [snapshot] = await db
        .insert(ownedSourceSnapshots)
        .values({
          accountId,
          campaignId,
          sourceType: platform,
          sourceIdentityId: pubProf?.handle || pubProf?.id || `${platform.toLowerCase()}_contract`,
          historyAvailability: "UNKNOWN",
          providerStatus: isConnected ? "PARTIAL" : "COMING_SOON",
          factualMetrics: {
            isConnected,
            followersCount: pubProf?.followersCount || 0,
            contractReady: true,
          },
          evidenceRefIds: [evId],
        })
        .returning();

      return {
        platform,
        snapshot,
        ingestionReady: false,
        factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
        evidenceRefId: evId,
      };
    },
  };
}

export const ALL_CANONICAL_ADAPTERS: Record<CanonicalPlatform, OwnedSourceAdapter> = {
  WEBSITE: WebsiteAdapter,
  INSTAGRAM: InstagramAdapter,
  MANUAL_BUSINESS_TRUTH: ManualTruthAdapter,
  TIKTOK: createContractReadyAdapter("TIKTOK"),
  YOUTUBE: createContractReadyAdapter("YOUTUBE"),
  LINKEDIN: createContractReadyAdapter("LINKEDIN"),
  FACEBOOK: createContractReadyAdapter("FACEBOOK"),
  X_TWITTER: createContractReadyAdapter("X_TWITTER"),
  OTHER: createContractReadyAdapter("OTHER"),
};
