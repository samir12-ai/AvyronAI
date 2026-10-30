import { Router, Request, Response, Express } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo } from "../auth-helpers";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { onboardCompetitorWithMultiSourceDiscovery, refreshCompetitorSources } from "../competitive-intelligence/source-discovery";
import { randomUUID as uuidv4 } from "crypto";
import { validateCurrency, validateBudgetAmount } from "../strategy/budget-governor/currency";
import { runBudgetGovernorEngine } from "../strategy/budget-governor/engine";
import type { SelectedChannelInput } from "../strategy/budget-governor/types";

export const settingsRouter = Router();

export async function loadCanonicalOwnedChannels(accountId: string, campaignId: string) {
  const [rawChannels, channelSnaps, ownedPostRows, [websiteSnap], ownedTasks] = await Promise.all([
    db
      .select()
      .from(schema.userPublicProfiles)
      .where(
        and(
          eq(schema.userPublicProfiles.accountId, accountId),
          eq(schema.userPublicProfiles.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.userPublicProfiles.updatedAt)),
    db
      .select()
      .from(schema.userChannelSnapshots)
      .where(
        and(
          eq(schema.userChannelSnapshots.accountId, accountId),
          eq(schema.userChannelSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.userChannelSnapshots.scrapedAt))
      .limit(100),
    db
      .select()
      .from(schema.ownedPosts)
      .where(
        and(
          eq(schema.ownedPosts.accountId, accountId),
          eq(schema.ownedPosts.campaignId, campaignId)
        )
      ),
    db
      .select()
      .from(schema.websiteSnapshots)
      .where(
        and(
          eq(schema.websiteSnapshots.accountId, accountId),
          eq(schema.websiteSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1),
    db
      .select()
      .from(schema.acquisitionTasks)
      .where(
        and(
          eq(schema.acquisitionTasks.accountId, accountId),
          eq(schema.acquisitionTasks.campaignId, campaignId),
          eq(schema.acquisitionTasks.entityType, "OWNED")
        )
      )
      .orderBy(desc(schema.acquisitionTasks.updatedAt))
      .limit(50),
  ]);

  // Deduplicate user_public_profiles by platform (newest updatedAt wins)
  const channelsByPlatform = new Map<string, (typeof rawChannels)[number]>();
  for (const ch of rawChannels) {
    const plat = String(ch.platform || "").toLowerCase();
    if (plat && !channelsByPlatform.has(plat)) {
      channelsByPlatform.set(plat, ch);
    }
  }
  const channels = Array.from(channelsByPlatform.values());

  const { parseLinkedInIdentity } = await import("../acquisition/multi-source-providers");

  const enrichedChannels: Array<any> = channels.map((c) => {
    const pLower = String(c.platform || "").toLowerCase();
    const liCheck = pLower === "linkedin" ? parseLinkedInIdentity(c.url || c.handle || "") : null;
    const isUnresolvedLinkedIn = pLower === "linkedin" && !liCheck?.valid;

    const platformSnaps = channelSnaps.filter((s) => String(s.platform || "").toLowerCase() === pLower);
    const matchingHandleSnaps = platformSnaps.filter((s) => {
      if (!c.handle && !c.url) return true;
      const snapHandle = (s.handle || "").toLowerCase().replace(/\/+$/, "");
      const profHandle = (c.handle || "").toLowerCase().replace(/\/+$/, "");
      const profUrl = (c.url || "").toLowerCase().replace(/\/+$/, "");
      return snapHandle === profHandle || snapHandle === profUrl;
    });
    const latestSnapRow =
      matchingHandleSnaps[0] ||
      (!isUnresolvedLinkedIn && pLower === "linkedin"
        ? platformSnaps.find((s) => {
            try {
              const d = s.snapshotData ? JSON.parse(s.snapshotData) : null;
              return d?.identityStatus !== "UNRESOLVED";
            } catch {
              return false;
            }
          })
        : platformSnaps[0]) ||
      null;

    let parsedSnap: any = null;
    if (latestSnapRow?.snapshotData) {
      try {
        parsedSnap = JSON.parse(latestSnapRow.snapshotData);
      } catch {}
    }

    const latestTask =
      ownedTasks.find((t) => t.entityId === c.id) ||
      ownedTasks.find(
        (t) => String((t as any).platform || (t as any).sourceType || "").toLowerCase() === pLower
      ) ||
      null;

    const storedPostsCount = ownedPostRows.filter(
      (op) => String(op.platform || "").toLowerCase() === pLower
    ).length;
    const effectivePostCount = Math.max(storedPostsCount, parsedSnap?.postCount ?? 0);
    const isConfirmedEmpty =
      !isUnresolvedLinkedIn &&
      effectivePostCount === 0 &&
      (parsedSnap?.isConfirmedEmpty === true || latestTask?.status === "EMPTY_CONFIRMED") &&
      parsedSnap?.scrapeStatus !== "FAILED";

    let lifecycleStatus:
      | "NEEDS_FULL_URL"
      | "QUEUED"
      | "FETCHING"
      | "FAILED"
      | "VERIFIED_EMPTY"
      | "FETCHED"
      | "CONFIGURED" = "CONFIGURED";
    let statusLabel = "CONFIGURED";

    if (isUnresolvedLinkedIn) {
      lifecycleStatus = "NEEDS_FULL_URL";
      statusLabel = "Needs full LinkedIn URL";
    } else if (latestTask && latestTask.status === "QUEUED") {
      lifecycleStatus = "QUEUED";
      statusLabel = "QUEUED";
    } else if (latestTask && (latestTask.status === "IN_PROGRESS" || latestTask.status === "RETRYING")) {
      lifecycleStatus = "FETCHING";
      statusLabel = "FETCHING";
    } else if (
      parsedSnap?.scrapeStatus === "FAILED" ||
      (!parsedSnap && latestTask?.status === "FAILED")
    ) {
      lifecycleStatus = "FAILED";
      statusLabel = "FAILED";
    } else if (isConfirmedEmpty) {
      lifecycleStatus = "VERIFIED_EMPTY";
      statusLabel = "VERIFIED EMPTY (0 posts)";
    } else if (
      parsedSnap &&
      (parsedSnap.scrapeStatus === "SUCCESS" || parsedSnap.scrapeStatus === "PARTIAL")
    ) {
      lifecycleStatus = "FETCHED";
      statusLabel = pLower === "website" ? "FETCHED" : `FETCHED (${effectivePostCount} posts)`;
    } else if (storedPostsCount > 0) {
      lifecycleStatus = "FETCHED";
      statusLabel = `FETCHED (${storedPostsCount} posts)`;
    } else if (pLower === "website" && websiteSnap?.rootUrl) {
      lifecycleStatus = "FETCHED";
      statusLabel = "FETCHED";
    } else {
      lifecycleStatus = "CONFIGURED";
      statusLabel = "CONFIGURED";
    }

    const lastScrapedIso = latestSnapRow?.scrapedAt ? latestSnapRow.scrapedAt.toISOString() : null;
    const nextDueIso =
      !isUnresolvedLinkedIn && latestSnapRow?.scrapedAt
        ? new Date(latestSnapRow.scrapedAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null;

    const scrapeError = isUnresolvedLinkedIn
      ? parsedSnap?.scrapeError ||
        liCheck?.error ||
        "Saved LinkedIn URL was truncated to https://linkedin.com/company without a slug. Enter your full /company/<slug> or /in/<slug> URL below."
      : parsedSnap?.scrapeError ||
        (lifecycleStatus === "FAILED" ? latestTask?.lastErrorMessage || "Acquisition failed" : null);

    return {
      id: c.id,
      platform: pLower,
      handle: c.handle,
      url: c.url,
      accountType:
        pLower === "linkedin"
          ? parsedSnap?.accountType || liCheck?.kind || "company"
          : null,
      identityStatus: isUnresolvedLinkedIn ? "UNRESOLVED" : parsedSnap?.identityStatus || "CONFIRMED",
      lifecycleStatus,
      statusLabel,
      scrapeStatus: isUnresolvedLinkedIn
        ? "UNRESOLVED_IDENTITY"
        : parsedSnap?.scrapeStatus || (storedPostsCount > 0 ? "SUCCESS" : lifecycleStatus),
      scrapeError,
      isConfirmedEmpty,
      lastScrapedAt: lastScrapedIso,
      nextScrapeDueAt: nextDueIso,
      followersCount: parsedSnap?.followers ?? c.followersCount ?? 0,
      storedPostsCount: effectivePostCount,
      channelId: parsedSnap?.channelId ?? liCheck?.slug ?? null,
      channelName: parsedSnap?.channelName ?? null,
      profileDossier: parsedSnap?.profileDossier ?? null,
      lastTaskId: latestTask?.id ?? null,
      lastTaskStatus: latestTask?.status ?? null,
      lastProviderRunId:
        parsedSnap?.postsRunId ||
        parsedSnap?.profileRunId ||
        latestTask?.providerRunId ||
        null,
      profileRunId: parsedSnap?.profileRunId ?? null,
      postsRunId: parsedSnap?.postsRunId ?? null,
      trackingType: "PUBLIC_SOURCE",
    };
  });

  const websiteChannelRow = enrichedChannels.find((ch) => ch.platform === "website");
  const resolvedWebsiteUrl =
    websiteChannelRow?.url ||
    websiteSnap?.rootUrl ||
    (websiteSnap as any)?.url ||
    "";

  if (!websiteChannelRow && resolvedWebsiteUrl) {
    const snapDateIso = websiteSnap?.createdAt ? websiteSnap.createdAt.toISOString() : null;
    enrichedChannels.push({
      id: websiteSnap?.id ? `web_${websiteSnap.id}` : `web_${campaignId}`,
      platform: "website",
      handle: null,
      url: resolvedWebsiteUrl,
      accountType: null,
      identityStatus: "CONFIRMED",
      lifecycleStatus: "FETCHED",
      statusLabel: "FETCHED",
      scrapeStatus: "SUCCESS",
      scrapeError: null,
      isConfirmedEmpty: false,
      lastScrapedAt: snapDateIso,
      nextScrapeDueAt: snapDateIso
        ? new Date(new Date(snapDateIso).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null,
      followersCount: 0,
      storedPostsCount: 0,
      channelId: null,
      channelName: resolvedWebsiteUrl,
      profileDossier: null,
      lastTaskId: null,
      lastTaskStatus: "COMPLETED",
      lastProviderRunId: null,
      profileRunId: null,
      postsRunId: null,
      trackingType: "PUBLIC_SOURCE",
    });
  }

  return { enrichedChannels, resolvedWebsiteUrl, websiteSnap };
}

// GET /api/settings/company
settingsRouter.get("/company", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);

    const [website] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(eq(schema.websiteSnapshots.accountId, accountId))
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1);

    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.accountId, accountId))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1);

    const buPayload: any = buSnap?.businessUnderstanding || {};

    const campaigns = await db
      .select()
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.accountId, accountId))
      .orderBy(desc(schema.campaignSelections.selectedAt));

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(eq(schema.userPublicProfiles.accountId, accountId));

    return res.json({
      success: true,
      company: {
        name: buPayload?.businessName || "Company",
        websiteUrl: website?.rootUrl || "",
        industry: buPayload?.generalIndustry || "Software & Technology",
        businessModel: buPayload?.businessModel || "B2B SaaS",
        productCatalogue: Array.isArray(buPayload?.discoveredOfferings) ? buPayload.discoveredOfferings : []
      },
      campaignsCount: campaigns.length,
      channelsCount: channels.length
    });
  } catch (err: any) {
    console.error("[Settings] Get company error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings/campaign/:campaignId
settingsRouter.get("/campaign/:campaignId", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;

    await assertCampaignBelongsTo(accountId, campaignId);

    const [camp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ))
      .limit(1);

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, accountId),
        eq(schema.campaignOfferings.campaignId, campaignId)
      ))
      .limit(1);

    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(and(
        eq(schema.businessUnderstandingSnapshots.accountId, accountId),
        eq(schema.businessUnderstandingSnapshots.campaignId, campaignId)
      ))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1);

    const schedules = await db
      .select()
      .from(schema.miRefreshSchedule)
      .where(and(
        eq(schema.miRefreshSchedule.accountId, accountId),
        eq(schema.miRefreshSchedule.campaignId, campaignId)
      ));

    const scheduleMap = new Map(schedules.map(s => [s.competitorId, s]));

    const includeArchived = req.query.includeArchived === "true";
    const competitors = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        includeArchived ? undefined : eq(schema.ciCompetitors.isActive, true),
        eq(schema.ciCompetitors.isDemo, false)
      ));

    const compSources = await db
      .select()
      .from(schema.competitorSources)
      .where(and(
        eq(schema.competitorSources.accountId, accountId),
        eq(schema.competitorSources.campaignId, campaignId)
      ));

    const sourcesByComp = new Map<string, typeof compSources>();
    for (const src of compSources) {
      const list = sourcesByComp.get(src.competitorId) || [];
      list.push(src);
      sourcesByComp.set(src.competitorId, list);
    }

    const { enrichedChannels, resolvedWebsiteUrl } = await loadCanonicalOwnedChannels(accountId, campaignId);

    const enrichedCompetitors = competitors.map(c => {
      let parsedSources: any = null;
      if (c.notes) {
        try {
          const parsed = JSON.parse(c.notes);
          if (parsed?.sources) parsedSources = parsed.sources;
        } catch {}
      }

      // Default canonical sources if not already serialized
      if (!parsedSources) {
        parsedSources = {
          website: { platform: "website", url: c.websiteUrl, status: "VERIFIED" },
          instagram: { platform: "instagram", url: null, status: "NOT_FOUND" },
          tiktok: { platform: "tiktok", url: null, status: "NOT_FOUND" },
          linkedin: { platform: "linkedin", url: null, status: "NOT_FOUND" },
          x: { platform: "x", url: null, status: "NOT_FOUND" },
          google_search: { platform: "google_search", url: `https://www.google.com/search?q=${encodeURIComponent(c.name)}`, status: "ACTIVE" },
          reviews: { platform: "reviews", url: null, status: "NOT_FOUND" },
          blog: { platform: "blog", url: null, status: "NOT_FOUND" },
        };
      }

      // Layer real verified sources from competitor_sources table
      const sourcesForComp = sourcesByComp.get(c.id) || [];
      for (const s of sourcesForComp) {
        const plat = s.platform.toLowerCase();
        parsedSources[plat] = {
          platform: plat,
          url: s.canonicalUrl,
          status: s.status,
          lastVerifiedAt: s.lastVerifiedAt ? s.lastVerifiedAt.toISOString() : null,
          lastFetchedAt: s.lastFetchedAt ? s.lastFetchedAt.toISOString() : null,
        };
      }

      const sched = scheduleMap.get(c.id);

      return {
        id: c.id,
        name: c.name,
                        websiteUrl: c.websiteUrl,
        tier: c.tier,
        sources: parsedSources,
        monitoringStatus: c.isActive ? (sched?.status === "active" ? "MONITORING" : "ACTIVE") : "DISABLED",
        lastFetchedAt: sched?.lastRefreshAt ? sched.lastRefreshAt.toISOString() : c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
        nextScheduledAt: sched?.nextRefreshAt ? sched.nextRefreshAt.toISOString() : null,
      };
    });

    const [budgetSetting] = await db
      .select()
      .from(schema.campaignBudgetSettings)
      .where(and(
        eq(schema.campaignBudgetSettings.accountId, accountId),
        eq(schema.campaignBudgetSettings.campaignId, campaignId)
      ))
      .limit(1);

    const [latestBgSnap] = await db
      .select()
      .from(schema.budgetGovernorSnapshots)
      .where(and(
        eq(schema.budgetGovernorSnapshots.accountId, accountId),
        eq(schema.budgetGovernorSnapshots.campaignId, campaignId)
      ))
      .orderBy(desc(schema.budgetGovernorSnapshots.createdAt))
      .limit(1);

    let latestRecommendation: any = null;
    let isBudgetOutdated = false;

    if (latestBgSnap?.result) {
      try {
        latestRecommendation = JSON.parse(latestBgSnap.result);
      } catch {}
    }

    if (budgetSetting) {
      if (!latestBgSnap) {
        isBudgetOutdated = true;
      } else {
        const settingUpdated = budgetSetting.updatedAt ? new Date(budgetSetting.updatedAt).getTime() : 0;
        const snapCreated = latestBgSnap.createdAt ? new Date(latestBgSnap.createdAt).getTime() : 0;
        if (settingUpdated > snapCreated) {
          isBudgetOutdated = true;
        }
        const currentSettingNum = budgetSetting.monthlyBudget != null ? parseFloat(budgetSetting.monthlyBudget) : null;
        if (latestRecommendation && latestRecommendation.totalMonthlyBudget !== currentSettingNum) {
          isBudgetOutdated = true;
        }
        if (latestRecommendation && latestRecommendation.currency !== (budgetSetting.currency || "USD")) {
          isBudgetOutdated = true;
        }
      }
    }

    let scheduleHealth: any = null;
    try {
      const { getUnifiedScheduleHealth } = await import("../watchtower/scheduler");
      if (typeof getUnifiedScheduleHealth === "function") {
        scheduleHealth = await getUnifiedScheduleHealth(accountId, campaignId);
      }
    } catch {}

    return res.json({
      success: true,
      campaign: {
        id: campaignId,
        name: camp?.selectedCampaignName || "Campaign",
        websiteUrl: resolvedWebsiteUrl,
        domain: resolvedWebsiteUrl,
        targetMarket: camp?.campaignLocation || "United Arab Emirates",
        heroProduct: offering?.offeringName || "Core Product",
        campaignOfferingId: offering?.id || null,
        businessUnderstandingSnapshotId: buSnap?.id || null,
        competitors: enrichedCompetitors,
        channels: enrichedChannels,
        ownedChannels: enrichedChannels,
        scheduleHealth,
        budget: {
          monthlyBudget: budgetSetting?.monthlyBudget != null ? parseFloat(budgetSetting.monthlyBudget) : null,
          currency: budgetSetting?.currency || "USD",
          version: budgetSetting?.version || 1,
          updatedAt: budgetSetting?.updatedAt || null,
          isOutdated: isBudgetOutdated,
          latestRecommendation,
        }
      }
    });
  } catch (err: any) {
    console.error("[Settings] Get campaign error:", err);
    return res.status(err?.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/campaign/:campaignId/owned-channels
settingsRouter.post("/campaign/:campaignId/owned-channels", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    await assertCampaignBelongsTo(accountId, campaignId);

    const body = req.body || {};
    const triggerScrape =
      typeof body.triggerScrape === "boolean"
        ? body.triggerScrape
        : typeof body.triggerSync === "boolean"
          ? body.triggerSync
          : true;

    const incomingItems: Array<{ platform: string; url?: string; handle?: string }> = [];
    if (Array.isArray(body.channels)) {
      for (const ch of body.channels) {
        if (ch?.platform) {
          incomingItems.push({
            platform: String(ch.platform).toLowerCase().trim(),
            url: ch.url,
            handle: ch.handle,
          });
        }
      }
    } else {
      for (const plat of ["instagram", "tiktok", "youtube", "linkedin", "website"]) {
        if (typeof body[plat] === "string" && body[plat].trim().length > 0) {
          incomingItems.push({
            platform: plat,
            url: body[plat].trim(),
          });
        }
      }
    }

    if (incomingItems.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one non-empty channel URL or handle is required to save. To remove a channel, use the explicit Remove action.",
      });
    }

    const { normalizeYouTubeChannelUrl, parseLinkedInIdentity } = await import("../acquisition/multi-source-providers");
    const { extractHandleFromUrl } = await import("../competitive-intelligence/profile-scraper");

    const normalizedByPlatform = new Map<string, { platform: string; handle: string | null; url: string | null }>();
    for (const ch of incomingItems) {
      if (!ch?.platform) continue;
      const platform = String(ch.platform).toLowerCase().trim();
      const rawInput = String(ch.url || ch.handle || "").trim();
      // Blank/unloaded fields must NEVER disconnect or overwrite an existing channel
      if (!rawInput) continue;

      if (platform === "linkedin") {
        const liIdentity = parseLinkedInIdentity(rawInput);
        if (!liIdentity.valid) {
          return res.status(400).json({
            success: false,
            error:
              liIdentity.error ||
              "Invalid LinkedIn URL: please provide your full /company/<slug> or /in/<slug> LinkedIn URL.",
            field: "linkedin",
          });
        }
        normalizedByPlatform.set("linkedin", {
          platform: "linkedin",
          handle: liIdentity.handle,
          url: liIdentity.canonicalUrl,
        });
      } else if (platform === "youtube") {
        let cleanHandle = rawInput;
        if (rawInput.startsWith("http://") || rawInput.startsWith("https://")) {
          try {
            const parsed = new URL(rawInput);
            const pathSegments = parsed.pathname.split("/").filter(Boolean);
            cleanHandle = (pathSegments[pathSegments.length - 1] || rawInput).replace(/^@/, "");
          } catch {}
        } else {
          cleanHandle = rawInput.replace(/^@/, "");
        }
        const cleanUrl = normalizeYouTubeChannelUrl(rawInput.startsWith("http") ? rawInput : "", cleanHandle);
        normalizedByPlatform.set("youtube", { platform: "youtube", handle: cleanHandle, url: cleanUrl });
      } else if (platform === "instagram") {
        const cleanHandle = (extractHandleFromUrl(rawInput) || rawInput.replace(/^@/, "")).toLowerCase().trim();
        normalizedByPlatform.set("instagram", {
          platform: "instagram",
          handle: cleanHandle,
          url: `https://www.instagram.com/${cleanHandle}/`,
        });
      } else if (platform === "tiktok") {
        const cleanHandle = rawInput.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
        normalizedByPlatform.set("tiktok", {
          platform: "tiktok",
          handle: cleanHandle,
          url: `https://www.tiktok.com/@${cleanHandle}`,
        });
      } else if (platform === "website") {
        const cleanUrl = rawInput.startsWith("http") ? rawInput : `https://${rawInput}`;
        normalizedByPlatform.set("website", {
          platform: "website",
          handle: null,
          url: cleanUrl,
        });
      } else {
        const cleanHandle = rawInput.replace(/^https?:\/\/(www\.)?[^/]+\//i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
        normalizedByPlatform.set(platform, {
          platform,
          handle: cleanHandle,
          url: rawInput.startsWith("http") ? rawInput : `https://${platform}.com/${cleanHandle}`,
        });
      }
    }

    const normalizedToSave = Array.from(normalizedByPlatform.values());
    if (normalizedToSave.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid non-empty channel URLs were provided.",
      });
    }

    const beforeCanonical = await loadCanonicalOwnedChannels(accountId, campaignId);
    const beforeMap = new Map(
      beforeCanonical.enrichedChannels.map((ch) => [ch.platform.toLowerCase(), ch])
    );

    const updatedPlatforms: string[] = [];
    const platformsToScrape: string[] = [];

    const normalizeUrlForCompare = (u: string | null | undefined) =>
      String(u || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\/(www\.)?/, "")
        .replace(/\/+$/, "");

    for (const item of normalizedToSave) {
      const existingRows = await db
        .select()
        .from(schema.userPublicProfiles)
        .where(
          and(
            eq(schema.userPublicProfiles.accountId, accountId),
            eq(schema.userPublicProfiles.campaignId, campaignId),
            eq(schema.userPublicProfiles.platform, item.platform)
          )
        )
        .orderBy(desc(schema.userPublicProfiles.updatedAt));

      const existing = existingRows[0] || null;
      // Clean up any historical duplicate rows for the same platform
      if (existingRows.length > 1) {
        for (const dup of existingRows.slice(1)) {
          await db
            .delete(schema.userPublicProfiles)
            .where(eq(schema.userPublicProfiles.id, dup.id));
        }
      }

      const prevEnriched = beforeMap.get(item.platform);
      const sameHandle =
        item.handle &&
        existing?.handle &&
        item.handle.toLowerCase().trim() === existing.handle.toLowerCase().trim();
      const sameUrl =
        normalizeUrlForCompare(item.url) ===
        normalizeUrlForCompare(existing?.url || prevEnriched?.url);
      const identityChanged = !existing && !prevEnriched ? true : !(sameHandle || sameUrl);

      if (existing) {
        if (identityChanged || existing.handle !== item.handle || existing.url !== item.url) {
          await db
            .update(schema.userPublicProfiles)
            .set({
              handle: item.handle,
              url: item.url,
              updatedAt: new Date(),
            })
            .where(eq(schema.userPublicProfiles.id, existing.id));
        }
      } else {
        await db.insert(schema.userPublicProfiles).values({
          id: "chan_" + uuidv4().slice(0, 10),
          accountId,
          campaignId,
          platform: item.platform,
          handle: item.handle,
          url: item.url,
        });
      }

      updatedPlatforms.push(item.platform);
      const prevNeedsFetch =
        !prevEnriched ||
        prevEnriched.lifecycleStatus === "CONFIGURED" ||
        prevEnriched.lifecycleStatus === "FAILED" ||
        prevEnriched.lifecycleStatus === "NEEDS_FULL_URL";
      if (identityChanged || prevNeedsFetch || body.forceRescrapeAll === true) {
        platformsToScrape.push(item.platform);
      }
    }

    let acquisitionOutcomes: Record<string, any> = {};
    if (triggerScrape && platformsToScrape.length > 0) {
      try {
        const { scrapeUserChannels } = await import("../user-channel-scraper");
        acquisitionOutcomes = await scrapeUserChannels(accountId, campaignId, {
          forceRefresh: true,
          targetPlatforms: platformsToScrape,
          trigger: "SETTINGS_CHANNEL_SAVE",
          requesterEngine: "SETTINGS",
        });
        try {
          const { evaluateAndPersistBusinessExecutionState } = await import("../performance-loop/execution-intelligence");
          await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
        } catch (evalErr: any) {
          console.warn(`[Settings] Post-save execution state evaluation warning: ${evalErr?.message || evalErr}`);
        }
      } catch (scrapeErr: any) {
        console.warn(`[Settings] Owned-channel scrape after save warning: ${scrapeErr?.message || scrapeErr}`);
      }
    }

    const { enrichedChannels, resolvedWebsiteUrl } = await loadCanonicalOwnedChannels(accountId, campaignId);
    let scheduleHealth: any = null;
    try {
      const { getUnifiedScheduleHealth } = await import("../watchtower/scheduler");
      if (typeof getUnifiedScheduleHealth === "function") {
        scheduleHealth = await getUnifiedScheduleHealth(accountId, campaignId);
      }
    } catch {}

    return res.json({
      success: true,
      updatedPlatforms,
      scrapedPlatforms: platformsToScrape,
      channels: enrichedChannels,
      ownedChannels: enrichedChannels,
      websiteUrl: resolvedWebsiteUrl,
      domain: resolvedWebsiteUrl,
      scheduleHealth,
      acquisitionOutcomes,
    });
  } catch (err: any) {
    console.error("[Settings] Save owned channels error:", err);
    return res.status(err?.status || 500).json({ success: false, error: err.message || "Failed to save owned channels" });
  }
});

// Explicit channel removal endpoints (separate from Save & Sync Channels)
async function handleRemoveOwnedChannel(req: Request, res: Response) {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const rawPlatform = req.params.platform || req.body?.platform;
    if (!rawPlatform) {
      return res.status(400).json({ success: false, error: "platform is required to remove a channel" });
    }
    const platform = String(rawPlatform).toLowerCase().trim();
    await assertCampaignBelongsTo(accountId, campaignId);

    await db
      .delete(schema.userPublicProfiles)
      .where(
        and(
          eq(schema.userPublicProfiles.accountId, accountId),
          eq(schema.userPublicProfiles.campaignId, campaignId),
          eq(schema.userPublicProfiles.platform, platform)
        )
      );

    const { enrichedChannels, resolvedWebsiteUrl } = await loadCanonicalOwnedChannels(accountId, campaignId);
    return res.json({
      success: true,
      removedPlatform: platform,
      channels: enrichedChannels,
      ownedChannels: enrichedChannels,
      websiteUrl: resolvedWebsiteUrl,
      domain: resolvedWebsiteUrl,
    });
  } catch (err: any) {
    console.error("[Settings] Remove owned channel error:", err);
    return res.status(err?.status || 500).json({ success: false, error: err.message || "Failed to remove owned channel" });
  }
}

settingsRouter.delete("/campaign/:campaignId/owned-channels/:platform", handleRemoveOwnedChannel);
settingsRouter.post("/campaign/:campaignId/remove-owned-channel", handleRemoveOwnedChannel);

// POST /api/settings/campaign/:campaignId/change-offering
settingsRouter.post("/campaign/:campaignId/change-offering", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const { newOfferingName, newOfferingNotes } = req.body;

    if (!newOfferingName) {
      return res.status(400).json({ success: false, error: "newOfferingName is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const confirmedOfferingName = newOfferingName.trim();

    // Check for existing campaign offering to maintain stable identity
    const [existingOffering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, accountId),
        eq(schema.campaignOfferings.campaignId, campaignId)
      ))
      .limit(1);

    const offeringId = existingOffering ? existingOffering.id : ("off_" + uuidv4().slice(0, 10));
    const evidenceId = "ev_" + uuidv4().slice(0, 10);

    const provenancedNotes = `[USER_CONFIRMED HERO OFFERING]\nOffering Name: ${confirmedOfferingName}\nNotes: ${newOfferingNotes || "Updated campaign focus offering."}`;

    // Transactional write: create confirmed evidence and upsert canonical offering atomically
    await db.transaction(async (tx) => {
      await tx.insert(schema.offeringInputEvidence).values({
        id: evidenceId,
        accountId,
        campaignId,
        campaignOfferingId: offeringId,
        rawOfferingName: confirmedOfferingName,
        rawFeaturesAndNotes: provenancedNotes,
        contentHash: "HASH_" + Date.now(),
        authorityType: "USER_CONFIRMED",
        confirmedAt: new Date(),
      });

      if (existingOffering) {
        await tx
          .update(schema.campaignOfferings)
          .set({
            offeringName: confirmedOfferingName,
            sourceInputEvidenceId: evidenceId,
          })
          .where(eq(schema.campaignOfferings.id, existingOffering.id));
      } else {
        await tx.insert(schema.campaignOfferings).values({
          id: offeringId,
          accountId,
          campaignId,
          offeringName: confirmedOfferingName,
          sourceInputEvidenceId: evidenceId,
        });
      }
    });

    const buAuthorityId = await runBusinessUnderstandingEngine(accountId, campaignId, offeringId);

    return res.json({
      success: true,
      warning: "Changing the campaign focus requires Avyron to re-understand this campaign and reevaluate its strategy.",
      newCampaignOfferingId: offeringId,
      offeringName: confirmedOfferingName,
      authorityType: "USER_CONFIRMED",
      newBusinessUnderstandingSnapshotId: buAuthorityId
    });
  } catch (err: any) {
    console.error("[Settings] Change offering error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/campaign/:campaignId/change-market
settingsRouter.post("/campaign/:campaignId/change-market", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const { newMarket } = req.body;

    if (!newMarket) {
      return res.status(400).json({ success: false, error: "newMarket is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    await db
      .update(schema.campaignSelections)
      .set({
        campaignLocation: newMarket.trim(),
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ));

    return res.json({
      success: true,
      newMarket: newMarket.trim(),
      message: "Target market updated. Competitor and market intelligence re-evaluation is recommended."
    });
  } catch (err: any) {
    console.error("[Settings] Change market error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/settings/campaign/:campaignId/add-competitor
settingsRouter.post("/campaign/:campaignId/add-competitor", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const { name, websiteUrl, tier } = req.body;

    if (!name || !websiteUrl) {
      return res.status(400).json({ success: false, error: "name and websiteUrl are required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const { competitor, manifest } = await onboardCompetitorWithMultiSourceDiscovery({
      accountId,
      campaignId,
      name: name.trim(),
      websiteUrl: websiteUrl.trim(),
      tier: tier === "A" ? "A" : "B",
      providedSources: {
        
      }
    });

    return res.json({
      success: true,
      competitor,
      manifest
    });
  } catch (err: any) {
    console.error("[Settings] Add competitor error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/campaign/:campaignId/remove-competitor
settingsRouter.post("/campaign/:campaignId/remove-competitor", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const { competitorId } = req.body;

    if (!competitorId) {
      return res.status(400).json({ success: false, error: "competitorId is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    // Deactivate competitor membership for this campaign safely
    await db
      .update(schema.ciCompetitors)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.id, competitorId)
      ));

    // Deactivate refresh schedule
    await db
      .update(schema.miRefreshSchedule)
      .set({
        status: "inactive"
      })
      .where(and(
        eq(schema.miRefreshSchedule.accountId, accountId),
        eq(schema.miRefreshSchedule.campaignId, campaignId),
        eq(schema.miRefreshSchedule.competitorId, competitorId)
      ));

    return res.json({
      success: true,
      message: "Competitor deactivated from campaign monitoring safely."
    });
  } catch (err: any) {
    console.error("[Settings] Remove competitor error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/campaign/:campaignId/competitor/:competitorId/refresh-sources
settingsRouter.post("/campaign/:campaignId/competitor/:competitorId/refresh-sources", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, competitorId } = req.params;

    await assertCampaignBelongsTo(accountId, campaignId);

    const { competitor, manifest } = await refreshCompetitorSources(accountId, campaignId, competitorId);

    return res.json({
      success: true,
      message: "Competitor sources refreshed with verified multi-source discovery.",
      competitor,
      manifest
    });
  } catch (err: any) {
    console.error("[Settings] Refresh sources error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/campaign/:campaignId/budget
settingsRouter.post("/campaign/:campaignId/budget", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;
    const { monthlyBudget, currency = "USD" } = req.body;

    await assertCampaignBelongsTo(accountId, campaignId);

    const currRes = validateCurrency(currency);
    if (!currRes.valid || !currRes.normalizedCurrency) {
      return res.status(400).json({ success: false, error: currRes.error || "Invalid currency code" });
    }

    const amtRes = validateBudgetAmount(monthlyBudget, currRes.normalizedCurrency);
    if (!amtRes.valid) {
      return res.status(400).json({ success: false, error: amtRes.error || "Invalid budget amount" });
    }

    const normalizedCurrency = currRes.normalizedCurrency;
    const finalBudget = amtRes.numericAmount ?? amtRes.normalizedAmount ?? null;

    const [existing] = await db
      .select()
      .from(schema.campaignBudgetSettings)
      .where(and(
        eq(schema.campaignBudgetSettings.accountId, accountId),
        eq(schema.campaignBudgetSettings.campaignId, campaignId)
      ))
      .limit(1);

    let record: any;
    if (existing) {
      const [updated] = await db
        .update(schema.campaignBudgetSettings)
        .set({
          monthlyBudget: finalBudget != null ? String(finalBudget) : null,
          currency: normalizedCurrency,
          version: (existing.version || 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.campaignBudgetSettings.id, existing.id))
        .returning();
      record = updated;
    } else {
      const [inserted] = await db
        .insert(schema.campaignBudgetSettings)
        .values({
          accountId,
          campaignId,
          monthlyBudget: finalBudget != null ? String(finalBudget) : null,
          currency: normalizedCurrency,
          version: 1,
        })
        .returning();
      record = inserted;
    }

    return res.json({
      success: true,
      budget: {
        campaignId,
        monthlyBudget: record.monthlyBudget != null ? parseFloat(record.monthlyBudget) : null,
        currency: record.currency,
        version: record.version,
        updatedAt: record.updatedAt,
      },
    });
  } catch (err: any) {
    console.error("[Settings] Update budget error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to update budget" });
  }
});

// POST /api/settings/campaign/:campaignId/update-budget-distribution
settingsRouter.post("/campaign/:campaignId/update-budget-distribution", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.params;

    await assertCampaignBelongsTo(accountId, campaignId);

    // 1. Load saved budget
    const [budgetSetting] = await db
      .select()
      .from(schema.campaignBudgetSettings)
      .where(and(
        eq(schema.campaignBudgetSettings.accountId, accountId),
        eq(schema.campaignBudgetSettings.campaignId, campaignId)
      ))
      .limit(1);

    const monthlyBudget = budgetSetting?.monthlyBudget != null ? parseFloat(budgetSetting.monthlyBudget) : null;
    const currency = budgetSetting?.currency || "USD";
    const budgetSettingsVersion = budgetSetting?.version || 1;

    // 2. Load latest channel selection snapshot
    const [latestCsSnap] = await db
      .select()
      .from(schema.channelSelectionSnapshots)
      .where(and(
        eq(schema.channelSelectionSnapshots.accountId, accountId),
        eq(schema.channelSelectionSnapshots.campaignId, campaignId)
      ))
      .orderBy(desc(schema.channelSelectionSnapshots.createdAt))
      .limit(1);

    const selectedChannels: SelectedChannelInput[] = [];
    let channelSelectionSnapshotId: string | undefined = undefined;

    if (latestCsSnap?.result) {
      channelSelectionSnapshotId = latestCsSnap.id;
      try {
        const csResult = JSON.parse(latestCsSnap.result);
        if (Array.isArray(csResult.recommendedChannels) && csResult.recommendedChannels.length > 0) {
          for (let idx = 0; idx < csResult.recommendedChannels.length; idx++) {
            const ch = csResult.recommendedChannels[idx];
            selectedChannels.push({
              channelId: ch.channelId || ch.id || ch.channelKey || `ch_${idx + 1}`,
              channelName: ch.channelName || ch.name || ch.label || `Channel ${idx + 1}`,
              strategicRole: ch.assignedFunnelRole || ch.funnelRole || undefined,
              fitScore: typeof ch.fitScore === "number" ? ch.fitScore : undefined,
              priorityRank: idx + 1,
              isOrganic: ch.channelNature === "organic" || ch.channelType === "social_organic" || ch.channelType === "search_organic",
              selectionRationale: ch.rationale || ch.decisionGate?.reason || (Array.isArray(ch.reasons) ? ch.reasons.join("; ") : undefined),
            });
          }
        } else {
          if (csResult.primaryChannel?.channelName) {
            const pch = csResult.primaryChannel;
            selectedChannels.push({
              channelId: pch.channelId || pch.id || pch.channelKey || "primary_channel",
              channelName: pch.channelName,
              strategicRole: pch.assignedFunnelRole || undefined,
              fitScore: typeof pch.fitScore === "number" ? pch.fitScore : undefined,
              priorityRank: 1,
              isOrganic: pch.channelNature === "organic" || pch.channelType === "social_organic" || pch.channelType === "search_organic",
              selectionRationale: pch.decisionGate?.reason || undefined,
            });
          }
          if (csResult.secondaryChannel?.channelName) {
            const sch = csResult.secondaryChannel;
            selectedChannels.push({
              channelId: sch.channelId || sch.id || sch.channelKey || "secondary_channel",
              channelName: sch.channelName,
              strategicRole: sch.assignedFunnelRole || undefined,
              fitScore: typeof sch.fitScore === "number" ? sch.fitScore : undefined,
              priorityRank: 2,
              isOrganic: sch.channelNature === "organic" || sch.channelType === "social_organic" || sch.channelType === "search_organic",
              selectionRationale: sch.decisionGate?.reason || (Array.isArray(sch.reasons) ? sch.reasons.join("; ") : undefined),
            });
          }
        }
      } catch (err: any) {
        console.warn(`[Settings] Failed to parse latest channel selection snapshot: ${err.message}`);
      }
    }

    // 3. Load business understanding / context
    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(and(
        eq(schema.businessUnderstandingSnapshots.accountId, accountId),
        eq(schema.businessUnderstandingSnapshots.campaignId, campaignId)
      ))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1);

    const buPayload: any = buSnap?.businessUnderstanding || {};
    const businessContext = {
      businessModel: buPayload?.businessModel,
      industry: buPayload?.generalIndustry,
      targetAudience: buPayload?.targetUnderstanding?.targetRoles?.map((r: any) => r.roleTitle || r.name).join(", "),
      primaryValueProp: buPayload?.campaignOffering?.coreBenefit,
    };

    // 4. Run budget governor engine
    const recommendation = await runBudgetGovernorEngine({
      monthlyBudget,
      currency,
      selectedChannels,
      businessContext,
      accountId,
      campaignId,
      budgetSettingsVersion,
      channelSelectionSnapshotId,
    });

    // 5. Persist to budgetGovernorSnapshots
    const [bgSnap] = await db
      .insert(schema.budgetGovernorSnapshots)
      .values({
        accountId,
        campaignId,
        jobId: "settings_rerun_" + uuidv4().slice(0, 8),
        validationSnapshotId: null,
        engineVersion: recommendation.engineVersion || 1,
        status: recommendation.status === "FAILED" ? "FAILED" : "COMPLETE",
        statusMessage: recommendation.statusMessage || null,
        result: JSON.stringify(recommendation),
        confidenceScore: null,
        executionTimeMs: recommendation.executionTimeMs || null,
      })
      .returning();

    return res.json({
      success: true,
      snapshotId: bgSnap.id,
      recommendation,
    });
  } catch (err: any) {
    console.error("[Settings] Update budget distribution error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to update budget distribution" });
  }
});

export function registerSettingsArchitectureRoutes(app: Express) {
  app.use("/api/settings", settingsRouter);
}
