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

export const settingsRouter = Router();

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
          instagram: { platform: "instagram", url: c.profileLink?.includes("instagram.com") ? c.profileLink : null, status: c.profileLink?.includes("instagram.com") ? "VERIFIED" : "NOT_FOUND" },
          tiktok: { platform: "tiktok", url: c.tiktokUrl || null, status: c.tiktokUrl ? "VERIFIED" : "NOT_FOUND" },
          linkedin: { platform: "linkedin", url: null, status: "NOT_FOUND" },
          x: { platform: "x", url: null, status: "NOT_FOUND" },
          google_search: { platform: "google_search", url: `https://www.google.com/search?q=${encodeURIComponent(c.name)}`, status: "ACTIVE" },
          reviews: { platform: "reviews", url: c.googleMapsUrl || null, status: c.googleMapsUrl ? "VERIFIED" : "NOT_FOUND" },
          blog: { platform: "blog", url: c.blogUrl || null, status: c.blogUrl ? "VERIFIED" : "NOT_FOUND" },
        };
      }

      const sched = scheduleMap.get(c.id);

      return {
        id: c.id,
        name: c.name,
        platform: c.platform,
        profileLink: c.profileLink,
        websiteUrl: c.websiteUrl,
        tier: c.tier,
        sources: parsedSources,
        monitoringStatus: c.isActive ? (sched?.status === "active" ? "MONITORING" : "ACTIVE") : "DISABLED",
        lastFetchedAt: sched?.lastRefreshAt ? sched.lastRefreshAt.toISOString() : c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
        nextScheduledAt: sched?.nextRefreshAt ? sched.nextRefreshAt.toISOString() : null,
      };
    });

    return res.json({
      success: true,
      campaign: {
        id: campaignId,
        name: camp?.selectedCampaignName || "Campaign",
        targetMarket: camp?.campaignLocation || "United Arab Emirates",
        heroProduct: offering?.offeringName || "Core Product",
        campaignOfferingId: offering?.id || null,
        businessUnderstandingSnapshotId: buSnap?.id || null,
        competitors: enrichedCompetitors,
        channels: channels.map(c => ({
          id: c.id,
          platform: c.platform,
          handle: c.handle,
          url: c.url
        }))
      }
    });
  } catch (err: any) {
    console.error("[Settings] Get campaign error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    const { name, websiteUrl, platform, profileLink, tier } = req.body;

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
        instagram: profileLink && profileLink.includes("instagram.com") ? profileLink : undefined,
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

export function registerSettingsArchitectureRoutes(app: Express) {
  app.use("/api/settings", settingsRouter);
}
