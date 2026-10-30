import { randomUUID } from "crypto";
import { db } from "../db";
import {
  ownedSourceSnapshots,
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  ownedPostSnapshots,
  websiteSnapshots,
  businessDataLayer,
  campaignOfferings,
  offeringInputEvidence,
  businessUnderstandingSnapshots,
  pipelineUserTruth,
  manualCampaignMetrics,
  clarificationRequests,
  weeklyBusinessInventories,
  weeklyBusinessScores,
  type OwnedSourceSnapshotRow,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

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

export type ProviderStatus =
  | "CONNECTED"
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED"
  | "NOT_CONNECTED"
  | "COMING_SOON"
  | "STALE"
  | "IDENTITY_UNRESOLVED";

export type ChannelLifecycleState =
  | "NOT_CONNECTED"
  | "IDENTITY_UNRESOLVED"
  | "CONFIGURED"
  | "FETCHING"
  | "FETCHED"
  | "STALE"
  | "FAILED";

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
    const [[webSnap], [bizData], [offering], [offeringEv], [buSnap]] = await Promise.all([
      db
        .select()
        .from(websiteSnapshots)
        .where(and(eq(websiteSnapshots.accountId, accountId), eq(websiteSnapshots.campaignId, campaignId)))
        .orderBy(desc(websiteSnapshots.createdAt))
        .limit(1),
      db
        .select()
        .from(businessDataLayer)
        .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
        .limit(1),
      db
        .select()
        .from(campaignOfferings)
        .where(and(eq(campaignOfferings.accountId, accountId), eq(campaignOfferings.campaignId, campaignId)))
        .limit(1),
      db
        .select()
        .from(offeringInputEvidence)
        .where(and(eq(offeringInputEvidence.accountId, accountId), eq(offeringInputEvidence.campaignId, campaignId)))
        .orderBy(desc(offeringInputEvidence.confirmedAt))
        .limit(1),
      db
        .select()
        .from(businessUnderstandingSnapshots)
        .where(
          and(
            eq(businessUnderstandingSnapshots.accountId, accountId),
            eq(businessUnderstandingSnapshots.campaignId, campaignId)
          )
        )
        .orderBy(desc(businessUnderstandingSnapshots.createdAt))
        .limit(1),
    ]);

    const buPayload = (buSnap?.businessUnderstanding || {}) as any;
    const buOfferingName =
      (typeof buPayload?.primaryOffering === "object"
        ? buPayload?.primaryOffering?.statement
        : buPayload?.primaryOffering) ||
      buPayload?.campaignOffering?.offeringName ||
      null;
    const prelimExtraction = (webSnap?.preliminaryExtraction || {}) as any;
    const prelimOfferings = Array.isArray(prelimExtraction?.discoveredOfferings)
      ? prelimExtraction.discoveredOfferings
      : [];

    const resolvedUrl =
      webSnap?.rootUrl ||
      (webSnap as any)?.url ||
      bizData?.websiteUrl ||
      buPayload?.websiteUrl ||
      null;

    const resolvedOfferingName =
      offering?.offeringName ||
      offeringEv?.rawOfferingName ||
      buOfferingName ||
      bizData?.coreOffer ||
      prelimOfferings[0]?.name ||
      null;

    const hasWeb = !!webSnap || !!resolvedUrl;
    const hasProductOffering =
      !!resolvedOfferingName ||
      !!(webSnap as any)?.pageTitle ||
      prelimOfferings.length > 0;

    const evId = offeringEv?.id || offering?.id || webSnap?.id || `ev_web_${randomUUID().slice(0, 8)}`;
    const evidenceRefIds = [
      webSnap?.id,
      offering?.id,
      offeringEv?.id,
      buSnap?.id,
    ].filter(Boolean) as string[];
    if (evidenceRefIds.length === 0) evidenceRefIds.push(evId);

    const [snapshot] = await db
      .insert(ownedSourceSnapshots)
      .values({
        accountId,
        campaignId,
        sourceType: "WEBSITE",
        sourceIdentityId: resolvedUrl || "web_identity",
        historyAvailability: hasWeb ? "CONFIRMED_HISTORY" : "UNKNOWN",
        providerStatus: hasWeb ? "COMPLETE" : "NOT_CONNECTED",
        factualMetrics: {
          hasWebsite: hasWeb,
          url: resolvedUrl,
          hasProductOffering,
          offeringName: resolvedOfferingName,
          campaignOfferingId: offering?.id || null,
          businessUnderstandingSnapshotId: buSnap?.id || null,
          websiteSnapshotId: webSnap?.id || null,
        },
        evidenceRefIds,
      })
      .returning();

    return {
      platform: "WEBSITE",
      snapshot,
      ingestionReady: true,
      factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
      evidenceRefId: evidenceRefIds[0] || evId,
    };
  },
};

// 2. OWNED SOCIAL ADAPTER FACTORY (INSTAGRAM, YOUTUBE, TIKTOK, LINKEDIN)
export function createOwnedSocialAdapter(
  platform: "INSTAGRAM" | "YOUTUBE" | "TIKTOK" | "LINKEDIN"
): OwnedSourceAdapter {
  const platLower = platform.toLowerCase();
  const prefix =
    platLower === "instagram"
      ? "ig"
      : platLower === "youtube"
        ? "yt"
        : platLower === "tiktok"
          ? "tt"
          : "li";

  return {
    platform,
    ingestionReady: true,
    async fetchSnapshot(accountId, campaignId) {
      // HARD GUARD: Filter strictly by accountId, campaignId, and platform
      const posts = await db
        .select()
        .from(ownedPosts)
        .where(
          and(
            eq(ownedPosts.accountId, accountId),
            eq(ownedPosts.campaignId, campaignId),
            eq(ownedPosts.platform, platLower)
          )
        )
        .orderBy(desc(ownedPosts.postedAt));

      const [pubProf] = await db
        .select()
        .from(userPublicProfiles)
        .where(
          and(
            eq(userPublicProfiles.accountId, accountId),
            eq(userPublicProfiles.campaignId, campaignId),
            eq(userPublicProfiles.platform, platLower)
          )
        )
        .limit(1);

      const [latestChanSnap] = await db
        .select()
        .from(userChannelSnapshots)
        .where(
          and(
            eq(userChannelSnapshots.accountId, accountId),
            eq(userChannelSnapshots.campaignId, campaignId),
            eq(userChannelSnapshots.platform, platLower)
          )
        )
        .orderBy(desc(userChannelSnapshots.scrapedAt))
        .limit(1);

      let parsedChanSnap: any = null;
      if (latestChanSnap?.snapshotData) {
        try {
          parsedChanSnap = JSON.parse(latestChanSnap.snapshotData);
        } catch {}
      }

      // Check LinkedIn identity validity explicitly — a saved row with 'company' / 'https://linkedin.com/company' is IDENTITY_UNRESOLVED
      let isIdentityUnresolved = parsedChanSnap?.identityStatus === "UNRESOLVED";
      let accountType: "company" | "profile" | null = parsedChanSnap?.accountType || null;
      if (platLower === "linkedin" && pubProf) {
        const { parseLinkedInIdentity } = await import("../acquisition/multi-source-providers");
        const liIdentity = parseLinkedInIdentity(pubProf.url || pubProf.handle || "");
        accountType = parsedChanSnap?.accountType || liIdentity.kind || "company";
        if (!liIdentity.valid) {
          isIdentityUnresolved = true;
        }
      }

      const totalPostsObserved =
        posts.length ||
        (!isIdentityUnresolved && parsedChanSnap?.scrapeStatus === "SUCCESS"
          ? parsedChanSnap?.postCount || 0
          : 0);
      const dates = posts.map((p) => p.postedAt).filter(Boolean) as Date[];
      const oldestPostDate = dates.length > 0 ? dates[dates.length - 1].toISOString() : undefined;
      const latestPostDate = dates.length > 0 ? dates[0].toISOString() : undefined;

      let channelAgeMonths = 0;
      if (dates.length > 0) {
        const diffMs = Date.now() - dates[dates.length - 1].getTime();
        channelAgeMonths = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)));
      }

      const hasSavedRow = !!pubProf || totalPostsObserved > 0 || !!latestChanSnap;
      // A saved row is NOT proof of successful acquisition when identity is unresolved
      const isConnected = hasSavedRow && !isIdentityUnresolved;
      const lastScrapedMs = latestChanSnap?.scrapedAt ? latestChanSnap.scrapedAt.getTime() : null;
      const isStale =
        isConnected &&
        lastScrapedMs !== null &&
        Date.now() - lastScrapedMs > 48 * 60 * 60 * 1000;

      let channelLifecycleState: ChannelLifecycleState = "NOT_CONNECTED";
      if (!hasSavedRow) {
        channelLifecycleState = "NOT_CONNECTED";
      } else if (isIdentityUnresolved) {
        channelLifecycleState = "IDENTITY_UNRESOLVED";
      } else if (!latestChanSnap && totalPostsObserved === 0) {
        channelLifecycleState = "CONFIGURED";
      } else if (parsedChanSnap?.scrapeStatus === "FAILED" && totalPostsObserved === 0) {
        channelLifecycleState = "FAILED";
      } else if (isStale) {
        channelLifecycleState = "STALE";
      } else {
        channelLifecycleState = "FETCHED";
      }

      const evId = `ev_${prefix}_${randomUUID().slice(0, 8)}`;
      const postEvidenceIds = posts.slice(0, 25).map((p) => p.id);

      const historyAvailability: HistoryAvailability =
        isIdentityUnresolved
          ? "UNKNOWN"
          : totalPostsObserved >= 5
            ? "CONFIRMED_HISTORY"
            : totalPostsObserved > 0
              ? "PARTIAL_HISTORY"
              : isConnected && parsedChanSnap?.isConfirmedEmpty === true
                ? "NO_HISTORY_CONFIRMED"
                : "UNKNOWN";

      const providerStatus: ProviderStatus =
        !hasSavedRow
          ? "NOT_CONNECTED"
          : isIdentityUnresolved
            ? "IDENTITY_UNRESOLVED"
            : !latestChanSnap && totalPostsObserved === 0
              ? "CONNECTED"
              : parsedChanSnap?.scrapeStatus === "FAILED" && totalPostsObserved === 0
                ? "FAILED"
                : isStale
                  ? "STALE"
                  : "COMPLETE";

      const postIds = posts.map((p) => p.id);
      const postSnaps = postIds.length > 0
        ? await db
            .select({
              ownedPostId: ownedPostSnapshots.ownedPostId,
              likes: ownedPostSnapshots.likes,
              comments: ownedPostSnapshots.comments,
              views: ownedPostSnapshots.views,
              observedAt: ownedPostSnapshots.observedAt,
            })
            .from(ownedPostSnapshots)
            .where(inArray(ownedPostSnapshots.ownedPostId, postIds))
            .orderBy(desc(ownedPostSnapshots.observedAt))
        : [];
      const latestSnapByPostId = new Map<string, (typeof postSnaps)[0]>();
      for (const ps of postSnaps) {
        if (!latestSnapByPostId.has(ps.ownedPostId)) {
          latestSnapByPostId.set(ps.ownedPostId, ps);
        }
      }
      let totalViews = 0;
      let totalEngagement = 0;
      let hasMeasuredViews = false;
      for (const p of posts) {
        const snap = latestSnapByPostId.get(p.id);
        const v = snap?.views ?? (p as any).viewsCount ?? null;
        if (typeof v === "number") {
          totalViews += v;
          hasMeasuredViews = true;
        }
        totalEngagement += (snap?.likes ?? (p as any).likesCount ?? 0) + (snap?.comments ?? (p as any).commentsCount ?? 0);
      }

      const { resolveCampaignLifecycleWindows, calculateOwnedPlatformWindowCounts } = await import("../user-channel-scraper");
      const lifecycle = await resolveCampaignLifecycleWindows(accountId, campaignId);
      const winCounts = calculateOwnedPlatformWindowCounts(posts, lifecycle);

      const [snapshot] = await db
        .insert(ownedSourceSnapshots)
        .values({
          accountId,
          campaignId,
          sourceType: platform,
          sourceIdentityId: parsedChanSnap?.channelId || pubProf?.handle || pubProf?.url || pubProf?.id || `${prefix}_identity`,
          historyAvailability,
          providerStatus,
          factualMetrics: {
            isConnected,
            hasSavedRow,
            isIdentityUnresolved,
            channelLifecycleState,
            accountType,
            handle: pubProf?.handle ?? parsedChanSnap?.handle ?? null,
            url: pubProf?.url ?? parsedChanSnap?.url ?? null,
            scrapeStatus: parsedChanSnap?.scrapeStatus ?? (hasSavedRow ? "CONFIGURED" : "NOT_CONNECTED"),
            scrapeError: parsedChanSnap?.scrapeError ?? null,
            lastScrapedAt: latestChanSnap?.scrapedAt ? latestChanSnap.scrapedAt.toISOString() : null,
            isConfirmedEmpty: parsedChanSnap?.isConfirmedEmpty === true && totalPostsObserved === 0,
            isPartialCoverage: parsedChanSnap?.isPartialCoverage === true,
            channelId: parsedChanSnap?.channelId ?? null,
            channelUrl: parsedChanSnap?.channelUrl ?? pubProf?.url ?? null,
            channelName: parsedChanSnap?.channelName ?? null,
            totalPostsObserved,
            fetchedWindowPostCount: parsedChanSnap?.fetchedWindowPostCount ?? parsedChanSnap?.postCount ?? posts.length,
            storedHistoricalPostCount: posts.length,
            postsSinceCreationCount: winCounts.postsSinceCreationCount,
            postsSinceActivationCount: winCounts.postsSinceActivationCount,
            activePlanWindowPostCount: winCounts.activePlanWindowPostCount,
            inWindowPostCount: winCounts.inWindowPostCount,
            rolling30dPostCount: winCounts.rolling30dPostCount,
            campaignCreatedAt: lifecycle.campaignCreatedAt,
            campaignActivatedAt: lifecycle.initialActivatedAt,
            activePlanActivatedAt: lifecycle.activePlanActivatedAt,
            accountTotalContent: parsedChanSnap?.accountTotalContent ?? null,
            countMeaning: "stored_unique_items_in_db",
            oldestPostDate,
            latestPostDate,
            channelAgeMonths: totalPostsObserved > 0 ? channelAgeMonths : undefined,
            followersCount: parsedChanSnap?.followers ?? pubProf?.followersCount ?? 0,
            // Never invent unavailable analytics (impressions, reach, clicks) when not provided by platform
            totalViews: hasMeasuredViews ? totalViews : null,
            totalReach: null,
            totalImpressions: null,
            totalEngagement,
          },
          evidenceRefIds: postEvidenceIds.length > 0 ? postEvidenceIds : [evId],
        })
        .returning();

      return {
        platform,
        snapshot,
        ingestionReady: true,
        factualMetrics: (snapshot.factualMetrics as Record<string, any>) || {},
        evidenceRefId: postEvidenceIds[0] || evId,
      };
    },
  };
}

export const InstagramAdapter: OwnedSourceAdapter = createOwnedSocialAdapter("INSTAGRAM");
export const YouTubeAdapter: OwnedSourceAdapter = createOwnedSocialAdapter("YOUTUBE");
export const TikTokAdapter: OwnedSourceAdapter = createOwnedSocialAdapter("TIKTOK");
export const LinkedInAdapter: OwnedSourceAdapter = createOwnedSocialAdapter("LINKEDIN");

// 3. MANUAL BUSINESS TRUTH ADAPTER (Unifies Baseline Clarification, Weekly Inventory, Manual Campaign Metrics & Pipeline User Truth)
export const ManualTruthAdapter: OwnedSourceAdapter = {
  platform: "MANUAL_BUSINESS_TRUTH",
  ingestionReady: true,
  async fetchSnapshot(accountId, campaignId) {
    const [bizTruthRows, manualMetricsRows, answeredClarifications, completedInventories] = await Promise.all([
      db
        .select()
        .from(pipelineUserTruth)
        .where(and(eq(pipelineUserTruth.accountId, accountId), eq(pipelineUserTruth.campaignId, campaignId)))
        .orderBy(desc(pipelineUserTruth.createdAt))
        .limit(5),
      db
        .select()
        .from(manualCampaignMetrics)
        .where(and(eq(manualCampaignMetrics.accountId, accountId), eq(manualCampaignMetrics.campaignId, campaignId)))
        .orderBy(desc(manualCampaignMetrics.updatedAt))
        .limit(1),
      db
        .select()
        .from(clarificationRequests)
        .where(
          and(
            eq(clarificationRequests.campaignId, campaignId),
            eq(clarificationRequests.status, "ANSWERED")
          )
        )
        .orderBy(desc(clarificationRequests.answeredAt))
        .limit(10),
      db
        .select()
        .from(weeklyBusinessInventories)
        .where(
          and(
            eq(weeklyBusinessInventories.accountId, accountId),
            eq(weeklyBusinessInventories.campaignId, campaignId),
            inArray(weeklyBusinessInventories.status, ["COMPLETED", "PARTIAL"])
          )
        )
        .orderBy(desc(weeklyBusinessInventories.submittedAt), desc(weeklyBusinessInventories.periodEnd))
        .limit(5),
    ]);

    const bizTruth = bizTruthRows[0] || null;
    const manualMetrics = manualMetricsRows[0] || null;
    const answeredClarification = answeredClarifications[0] || null;
    const latestInventory = completedInventories[0] || null;
    const invSubmitted = ((latestInventory?.submittedMetrics as any) || {}) as Record<string, any>;

    const baselineClarification =
      answeredClarifications.find((c) => (c as any).requestCategory === "BASELINE") ||
      answeredClarifications[0] ||
      null;
    let structuredBaseline: Record<string, any> | null = null;
    if ((baselineClarification as any)?.structuredAnswer) {
      const rawStruct = (baselineClarification as any).structuredAnswer;
      if (typeof rawStruct === "string") {
        try {
          structuredBaseline = JSON.parse(rawStruct);
        } catch {}
      } else if (typeof rawStruct === "object") {
        structuredBaseline = rawStruct;
      }
    }

    const structPaidCount =
      typeof structuredBaseline?.historicalPayingCustomersCount === "number"
        ? structuredBaseline.historicalPayingCustomersCount
        : typeof structuredBaseline?.historicalPaidCustomersCount === "number"
          ? structuredBaseline.historicalPaidCustomersCount
          : null;
    const structHasPaid =
      typeof structuredBaseline?.hasHistoricalPayingCustomers === "boolean"
        ? structuredBaseline.hasHistoricalPayingCustomers
        : typeof structuredBaseline?.hasHistoricalPaidCustomers === "boolean"
          ? structuredBaseline.hasHistoricalPaidCustomers
          : null;
    const structOperatingMonths =
      typeof structuredBaseline?.operatingDurationMonths === "number"
        ? structuredBaseline.operatingDurationMonths
        : typeof structuredBaseline?.operatingMonths === "number"
          ? structuredBaseline.operatingMonths
          : null;
    const structLeadsCount =
      typeof structuredBaseline?.historicalLeadsCount === "number"
        ? structuredBaseline.historicalLeadsCount
        : null;
    const structHistoricalRevenue =
      typeof structuredBaseline?.historicalRevenueAmount === "number"
        ? structuredBaseline.historicalRevenueAmount
        : null;

    // 1. Historical Baseline Facts (strictly from one-time baseline clarification — never overwritten by 7-day window check-ins)
    // Note: If structHasPaid === true and structPaidCount === null ("Yes, had customers" with no count), historicalPayingCustomersCount MUST remain null (unknown), never invented!
    const historicalPayingCustomersCount: number | null =
      structPaidCount !== null
        ? structPaidCount
        : structHasPaid === false
          ? 0
          : null;
    const historicalLeadsCount: number | null = structLeadsCount;
    const historicalRevenueAmount: number | null = structHistoricalRevenue;

    // 2. Weekly 7-Day Window Outcomes (strictly from the active/latest 7-day reporting window inventory)
    const weeklyPayingCustomers: number | null =
      latestInventory && typeof invSubmitted.payingCustomers === "number"
        ? invSubmitted.payingCustomers
        : latestInventory && typeof invSubmitted.conversions === "number"
          ? invSubmitted.conversions
          : bizTruth && typeof bizTruth.payingCustomers === "number"
            ? bizTruth.payingCustomers
            : null;
    const weeklyLeads: number | null =
      latestInventory && typeof invSubmitted.leads === "number"
        ? invSubmitted.leads
        : bizTruth && typeof bizTruth.totalLeads === "number" && latestInventory
          ? (typeof invSubmitted.leads === "number" ? invSubmitted.leads : null)
          : null;
    const weeklyQualifiedLeads: number | null =
      latestInventory && typeof invSubmitted.qualifiedLeads === "number"
        ? invSubmitted.qualifiedLeads
        : null;
    const weeklyConversations: number | null =
      latestInventory && typeof invSubmitted.conversations === "number"
        ? invSubmitted.conversations
        : null;
    const weeklyTrialsOrBookedCalls: number | null =
      latestInventory && typeof invSubmitted.trialsOrBookedCalls === "number"
        ? invSubmitted.trialsOrBookedCalls
        : null;
    const weeklyRevenue: number | null =
      latestInventory && typeof invSubmitted.revenue === "number"
        ? invSubmitted.revenue
        : null;
    const weeklyAdSpend: number | null =
      latestInventory && typeof invSubmitted.spend === "number"
        ? invSubmitted.spend
        : latestInventory && typeof invSubmitted.adSpend === "number"
          ? invSubmitted.adSpend
          : null;

    const weeklyWindowCompletionState: string | null = latestInventory
      ? (invSubmitted._windowCompletionState as string) ||
        (latestInventory.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS_AS_OF")
      : null;

    // Combined / fallback pointers with explicit provenance and without overwriting baseline when both exist
    let payingCustomers: number | null = null;
    let payingCustomersProvenance: string | null = null;
    if (weeklyPayingCustomers !== null) {
      payingCustomers = weeklyPayingCustomers;
      payingCustomersProvenance = latestInventory
        ? `weekly_business_inventory:${latestInventory.id}`
        : `pipeline_user_truth:${bizTruth?.id}`;
    } else if (historicalPayingCustomersCount !== null) {
      payingCustomers = historicalPayingCustomersCount;
      payingCustomersProvenance = `clarification_request:${baselineClarification?.id}`;
    } else if (
      manualMetrics &&
      typeof manualMetrics.conversions === "number" &&
      (manualMetrics.conversions > 0 || manualMetrics.revenue > 0 || manualMetrics.spend > 0)
    ) {
      payingCustomers = manualMetrics.conversions;
      payingCustomersProvenance = `manual_campaign_metrics:${manualMetrics.id}`;
    }

    let leads: number | null = null;
    let leadsProvenance: string | null = null;
    if (weeklyLeads !== null) {
      leads = weeklyLeads;
      leadsProvenance = `weekly_business_inventory:${latestInventory?.id}`;
    } else if (historicalLeadsCount !== null) {
      leads = historicalLeadsCount;
      leadsProvenance = `clarification_request:${baselineClarification?.id}`;
    } else if (
      manualMetrics &&
      typeof manualMetrics.leads === "number" &&
      (manualMetrics.leads > 0 || manualMetrics.spend > 0 || manualMetrics.revenue > 0)
    ) {
      leads = manualMetrics.leads;
      leadsProvenance = `manual_campaign_metrics:${manualMetrics.id}`;
    }

    let revenue: number | null = null;
    let revenueProvenance: string | null = null;
    if (weeklyRevenue !== null) {
      revenue = weeklyRevenue;
      revenueProvenance = `weekly_business_inventory:${latestInventory?.id}`;
    } else if (historicalRevenueAmount !== null) {
      revenue = historicalRevenueAmount;
      revenueProvenance = `clarification_request:${baselineClarification?.id}`;
    } else if (
      manualMetrics &&
      typeof manualMetrics.revenue === "number" &&
      (manualMetrics.revenue > 0 || manualMetrics.spend > 0 || manualMetrics.conversions > 0)
    ) {
      revenue = manualMetrics.revenue;
      revenueProvenance = `manual_campaign_metrics:${manualMetrics.id}`;
    }

    let adSpend: number | null = null;
    let adSpendProvenance: string | null = null;
    if (weeklyAdSpend !== null) {
      adSpend = weeklyAdSpend;
      adSpendProvenance = `weekly_business_inventory:${latestInventory?.id}`;
    } else if (
      manualMetrics &&
      typeof manualMetrics.spend === "number" &&
      (manualMetrics.spend > 0 || manualMetrics.revenue > 0)
    ) {
      adSpend = manualMetrics.spend;
      adSpendProvenance = `manual_campaign_metrics:${manualMetrics.id}`;
    }

    const hasBaselineTruth = !!(answeredClarification?.userAnswer || structuredBaseline);
    const hasWeeklyWindowTruth = !!latestInventory;
    const hasTruth =
      hasBaselineTruth ||
      hasWeeklyWindowTruth ||
      !!bizTruth ||
      !!(manualMetrics && (manualMetrics.spend > 0 || manualMetrics.revenue > 0 || manualMetrics.leads > 0 || manualMetrics.conversions > 0));

    const evidenceRefIds = [
      baselineClarification?.id,
      latestInventory?.id,
      bizTruth?.id,
      manualMetrics?.id ? `manual_metrics_${manualMetrics.id}` : null,
    ].filter(Boolean) as string[];
    const evId = evidenceRefIds[0] || `ev_truth_${randomUUID().slice(0, 8)}`;
    if (evidenceRefIds.length === 0) evidenceRefIds.push(evId);

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
          hasBaselineTruth,
          hasWeeklyWindowTruth,
          userAnswer: answeredClarification?.userAnswer || null,
          structuredBaseline,
          operatingHistoryMonths: structOperatingMonths,
          hasHistoricalPaidCustomers:
            structHasPaid !== null
              ? structHasPaid
              : historicalPayingCustomersCount !== null
                ? historicalPayingCustomersCount > 0
                : null,
          historicalPayingCustomersCount,
          historicalLeadsCount,
          historicalRevenueAmount,
          weeklyWindow: latestInventory
            ? {
                inventoryId: latestInventory.id,
                windowId: (latestInventory as any).windowId ?? null,
                windowIndex: (latestInventory as any).windowIndex ?? null,
                periodStart: latestInventory.periodStart?.toISOString() ?? null,
                periodEnd: latestInventory.periodEnd?.toISOString() ?? null,
                status: latestInventory.status,
                completionState: weeklyWindowCompletionState,
                leads: weeklyLeads,
                leadsCount: weeklyLeads,
                qualifiedLeads: weeklyQualifiedLeads,
                conversations: weeklyConversations,
                trialsOrBookedCalls: weeklyTrialsOrBookedCalls,
                payingCustomers: weeklyPayingCustomers,
                conversions: weeklyPayingCustomers,
                conversionsCount: weeklyPayingCustomers,
                revenue: weeklyRevenue,
                revenueAmount: weeklyRevenue,
                adSpend: weeklyAdSpend,
                adSpendAmount: weeklyAdSpend,
                currency: latestInventory.currency || "USD",
              }
            : null,
          missingFactType: answeredClarification?.missingFactType || null,
          payingCustomers,
          leads,
          qualifiedLeads: weeklyQualifiedLeads ?? bizTruth?.qualifiedLeads ?? null,
          revenue,
          adSpend,
          currency: latestInventory?.currency || structuredBaseline?.currency || "USD",
          provenance: {
            historicalPayingCustomers: baselineClarification?.id ? `clarification_request:${baselineClarification.id}` : null,
            historicalLeads: baselineClarification?.id ? `clarification_request:${baselineClarification.id}` : null,
            weeklyInventory: latestInventory?.id ? `weekly_business_inventory:${latestInventory.id}` : null,
            payingCustomers: payingCustomersProvenance,
            leads: leadsProvenance,
            revenue: revenueProvenance,
            adSpend: adSpendProvenance,
          },
        },
        evidenceRefIds,
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

// Generic Contract-Ready Adapter Factory for Future Providers (Facebook, X_Twitter, Other)
export function createContractReadyAdapter(platform: CanonicalPlatform): OwnedSourceAdapter {
  return {
    platform,
    ingestionReady: false,
    async fetchSnapshot(accountId, campaignId) {
      const evId = `ev_${platform.toLowerCase()}_${randomUUID().slice(0, 8)}`;

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
  TIKTOK: TikTokAdapter,
  YOUTUBE: YouTubeAdapter,
  LINKEDIN: LinkedInAdapter,
  FACEBOOK: createContractReadyAdapter("FACEBOOK"),
  X_TWITTER: createContractReadyAdapter("X_TWITTER"),
  OTHER: createContractReadyAdapter("OTHER"),
};
