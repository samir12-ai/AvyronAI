import { Router, Request, Response, Express } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { resolveAccountId } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
import { analyzeCompanyWebsite } from "./website-analyzer";
import { discoverCampaignCompetitors } from "./competitor-discovery";
import { runCompetitorDiscoveryEngine } from "../discovery";
import { runBusinessUnderstandingEngine } from "../business-understanding/engine";
import { initializeCompetitorMonitoring } from "../watchtower/scheduler";
import { onboardCompetitorWithMultiSourceDiscovery } from "../competitive-intelligence/source-discovery";
import { randomUUID as uuidv4 } from "crypto";

export const setupRouter = Router();

// 1. POST /api/setup/analyze-website
setupRouter.post("/analyze-website", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { websiteUrl, campaignId: incomingCampaignId } = req.body;

    if (!websiteUrl || typeof websiteUrl !== "string") {
      return res.status(400).json({ success: false, error: "websiteUrl is required" });
    }

    let campaignId = incomingCampaignId;
    if (!campaignId) {
      const [latest] = await db
        .select()
        .from(schema.campaignSelections)
        .where(eq(schema.campaignSelections.accountId, accountId))
        .orderBy(desc(schema.campaignSelections.selectedAt))
        .limit(1);

      if (latest) {
        campaignId = latest.selectedCampaignId;
      } else {
        campaignId = "camp_" + uuidv4().slice(0, 12);
        await db.insert(schema.campaignSelections).values({
          accountId,
          selectedCampaignId: campaignId,
          selectedCampaignName: "Initial Campaign",
          selectedPlatform: "meta",
          campaignGoalType: "LEADS",
          campaignStatus: "active",
          campaignLocation: "United Arab Emirates",
          dataSourceMode: "benchmark"
        });
      }
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const result = await analyzeCompanyWebsite(accountId, campaignId, websiteUrl);

    return res.json({
      success: true,
      campaignId,
      data: result
    });
  } catch (err: any) {
    console.error("[Setup] Analyze website error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to analyze website" });
  }
});

// 1.5 GET /api/setup/status
setupRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    
    // Find latest campaign for this account
    const [camp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(eq(schema.campaignSelections.accountId, accountId))
      .orderBy(desc(schema.campaignSelections.selectedAt))
      .limit(1);

    if (!camp) {
      return res.json({
        success: true,
        isComplete: false,
        step: "01_BUSINESS",
        stepNumber: 1,
        stepLabel: "Business Website",
        campaignId: null
      });
    }

    const campaignId = camp.selectedCampaignId;

    const [website] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(and(
        eq(schema.websiteSnapshots.accountId, accountId),
        eq(schema.websiteSnapshots.campaignId, campaignId)
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

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, accountId),
        eq(schema.userPublicProfiles.campaignId, campaignId)
      ));

    const competitors = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    const [strategyPlan] = await db
      .select()
      .from(schema.strategyDecisions)
      .where(and(
        eq(schema.strategyDecisions.accountId, accountId),
        eq(schema.strategyDecisions.campaignId, campaignId)
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

    let step = "01_BUSINESS";
    let stepNumber = 1;
    let stepLabel = "Business Website";

    if (website?.rootUrl) {
      step = "02_MARKET";
      stepNumber = 2;
      stepLabel = "Target Market";
    }
    if (camp.campaignLocation) {
      step = "03_FOCUS";
      stepNumber = 3;
      stepLabel = "Campaign Focus";
    }
    if (offering?.offeringName) {
      step = "04_CHANNELS";
      stepNumber = 4;
      stepLabel = "Owned Channels";
    }
    if (channels.length > 0) {
      step = "05_COMPETITORS";
      stepNumber = 5;
      stepLabel = "Competitor Tracking";
    }
    if (competitors.length >= 10 || strategyPlan) {
      step = "06_READY";
      stepNumber = 6;
      stepLabel = "Strategy Ready";
    }

    const isComplete = !!(website && offering && buSnap?.status === "COMPLETE" && competitors.length >= 10);

    return res.json({
      success: true,
      isComplete,
      step,
      stepNumber,
      stepLabel,
      campaignId,
      campaignName: camp.selectedCampaignName || "Initial Campaign",
      websiteUrl: website?.rootUrl || null,
      offeringName: offering?.offeringName || null,
      buStatus: buSnap?.status || "INCOMPLETE",
      approvedCompetitorCount: competitors.length
    });
  } catch (err: any) {
    console.error("[Setup] Status error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to get setup status" });
  }
});

// 2. GET /api/setup/state/:campaignId
setupRouter.get("/state/:campaignId", async (req: Request, res: Response) => {
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

    const [website] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(and(
        eq(schema.websiteSnapshots.accountId, accountId),
        eq(schema.websiteSnapshots.campaignId, campaignId)
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

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, accountId),
        eq(schema.userPublicProfiles.campaignId, campaignId)
      ));

    const competitors = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    let step = "01_BUSINESS";
    if (website?.rootUrl) step = "02_MARKET";
    if (camp?.campaignLocation) step = "03_FOCUS";
    if (offering?.offeringName) step = "04_CHANNELS";
    if (channels.length > 0) step = "05_COMPETITORS";
    if (competitors.length >= 10) step = "06_READY";

    const isReadyForStrategy = !!(
      camp &&
      offering &&
      buSnap?.status === "COMPLETE" &&
      camp.campaignLocation &&
      competitors.length >= 10
    );

    const buPayload: any = buSnap?.businessUnderstanding || null;

    let companyName = buPayload?.businessName || "";
    let industry = buPayload?.generalIndustry || "";
    let businessModel = buPayload?.businessModel || "";
    let productCatalogue = Array.isArray(buPayload?.discoveredOfferings) ? buPayload.discoveredOfferings : [];

    if (!companyName && website?.rootUrl) {
      try {
        const hostname = new URL(website.rootUrl).hostname.replace(/^www\./, "").split(".")[0];
        companyName = hostname.charAt(0).toUpperCase() + hostname.slice(1);
      } catch (e) {}
    }

    if ((!industry || !businessModel) && Array.isArray(website?.pagesCrawled)) {
      const pageText = (website.pagesCrawled as any[]).map(p => p.cleanedText || "").join(" ").toLowerCase();
      if (!industry) {
        if (pageText.includes("fashion") || pageText.includes("hijab") || pageText.includes("dress") || pageText.includes("abaya") || pageText.includes("clothing") || pageText.includes("apparel")) {
          industry = "Modest Fashion & Apparel";
        } else if (pageText.includes("restaurant") || pageText.includes("food") || pageText.includes("cafe")) {
          industry = "Food & Beverage / Restaurant";
        } else if (pageText.includes("software") || pageText.includes("saas")) {
          industry = "Software & Technology";
        }
      }
      if (!businessModel) {
        if (pageText.includes("cart") || pageText.includes("checkout") || pageText.includes("shop") || pageText.includes("product")) {
          businessModel = "E-Commerce / Direct-to-Consumer";
        }
      }
    }

    return res.json({
      success: true,
      step,
      campaignId,
      campaignName: camp?.selectedCampaignName || "My Campaign",
      targetMarket: camp?.campaignLocation || "United Arab Emirates",
      websiteUrl: website?.rootUrl || "",
      companyName,
      industry,
      businessModel,
      productCatalogue,
      selectedOffering: offering ? {
        id: offering.id,
        name: offering.offeringName,
      } : null,
      businessUnderstandingSnapshotId: buSnap?.id || null,
      productTruthCount: Array.isArray(buPayload?.campaignOffering?.productTruthFacts) ? buPayload.campaignOffering.productTruthFacts.length : 0,
      targetRolesCount: Array.isArray(buPayload?.targetUnderstanding?.targetRoles) ? buPayload.targetUnderstanding.targetRoles.length : 0,
      channels: channels.map(c => ({
        id: c.id,
        platform: c.platform,
        handle: c.handle,
        url: c.url
      })),
      competitors: competitors.map(c => ({
        id: c.id,
        name: c.name,
        platform: c.platform,
        profileLink: c.profileLink,
        websiteUrl: c.websiteUrl,
        tier: c.tier
      })),
      isReadyForStrategy
    });
  } catch (err: any) {
    console.error("[Setup] Get state error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch setup state" });
  }
});

// 3. POST /api/setup/save-market
setupRouter.post("/save-market", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, targetMarket } = req.body;

    if (!campaignId || !targetMarket) {
      return res.status(400).json({ success: false, error: "campaignId and targetMarket are required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    await db
      .update(schema.campaignSelections)
      .set({
        campaignLocation: targetMarket.trim(),
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ));

    return res.json({ success: true, targetMarket: targetMarket.trim() });
  } catch (err: any) {
    console.error("[Setup] Save market error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to save market" });
  }
});

// 4. POST /api/setup/save-offering
setupRouter.post("/save-offering", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, offeringName, offeringFeaturesAndNotes, sourceSuggestionEvidenceId, targetMarket } = req.body;

    if (!campaignId || !offeringName || typeof offeringName !== "string" || !offeringName.trim()) {
      return res.status(400).json({ success: false, error: "campaignId and offeringName are required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const confirmedOfferingName = offeringName.trim();

    if (targetMarket && typeof targetMarket === "string" && targetMarket.trim()) {
      await db
        .update(schema.campaignSelections)
        .set({ campaignLocation: targetMarket.trim() })
        .where(and(
          eq(schema.campaignSelections.accountId, accountId),
          eq(schema.campaignSelections.selectedCampaignId, campaignId)
        ));
    }

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

    const provenancedNotes = `[USER_CONFIRMED HERO OFFERING]\nOffering Name: ${confirmedOfferingName}\nNotes: ${offeringFeaturesAndNotes || "User-confirmed offering focus."}`;

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
        sourceSuggestionEvidenceId: sourceSuggestionEvidenceId || null,
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

    let buAuthorityId: string | null = null;
    try {
      buAuthorityId = await runBusinessUnderstandingEngine(accountId, campaignId, offeringId);
    } catch (buErr: any) {
      console.warn("[Setup] Business Understanding generation deferred or soft-failed:", buErr.message);
    }

    return res.json({
      success: true,
      campaignOfferingId: offeringId,
      offeringName: confirmedOfferingName,
      authorityType: "USER_CONFIRMED",
      businessUnderstandingSnapshotId: buAuthorityId
    });
  } catch (err: any) {
    console.error("[Setup] Save offering error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to save offering" });
  }
});

// 5. POST /api/setup/save-channels
setupRouter.post("/save-channels", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, channels } = req.body;

    if (!campaignId || !Array.isArray(channels)) {
      return res.status(400).json({ success: false, error: "campaignId and channels array are required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    // Validation pass
    for (const ch of channels) {
      if (!ch.platform || !ch.handle) continue;
      const platform = ch.platform.toLowerCase();
      const raw = String(ch.handle || ch.url || "").trim().toLowerCase();

      if (platform === "instagram" && (raw.includes("tiktok.com") || raw.includes("youtube.com") || raw.includes("linkedin.com"))) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid Instagram channel: TikTok/YouTube/LinkedIn URL cannot be saved as an Instagram handle.", 
          field: "instagram" 
        });
      }
      if (platform === "tiktok" && (raw.includes("instagram.com") || raw.includes("youtube.com") || raw.includes("linkedin.com"))) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid TikTok channel: Instagram/YouTube/LinkedIn URL cannot be saved as a TikTok handle.", 
          field: "tiktok" 
        });
      }
      if (platform === "youtube" && (raw.includes("instagram.com") || raw.includes("tiktok.com") || raw.includes("linkedin.com"))) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid YouTube channel: Instagram/TikTok/LinkedIn URL cannot be saved as a YouTube channel.", 
          field: "youtube" 
        });
      }
      if (platform === "linkedin" && (raw.includes("instagram.com") || raw.includes("tiktok.com") || raw.includes("youtube.com"))) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid LinkedIn channel: Instagram/TikTok/YouTube URL cannot be saved as a LinkedIn profile.", 
          field: "linkedin" 
        });
      }
    }

    for (const ch of channels) {
      if (!ch.platform || !ch.handle) continue;
      const platform = ch.platform.toLowerCase();
      let cleanHandle = ch.handle.trim();

      if (cleanHandle.startsWith("http://") || cleanHandle.startsWith("https://")) {
        try {
          const parsed = new URL(cleanHandle);
          const pathSegments = parsed.pathname.split("/").filter(Boolean);
          cleanHandle = pathSegments[0]?.replace(/^@/, "") || cleanHandle;
        } catch (e) {}
      }
      cleanHandle = cleanHandle.replace(/^@/, "");
      const cleanUrl = `https://${platform}.com/${platform === "tiktok" ? "@" : ""}${cleanHandle}`;

      const [existing] = await db
        .select()
        .from(schema.userPublicProfiles)
        .where(and(
          eq(schema.userPublicProfiles.accountId, accountId),
          eq(schema.userPublicProfiles.campaignId, campaignId),
          eq(schema.userPublicProfiles.platform, platform)
        ))
        .limit(1);

      if (existing) {
        await db
          .update(schema.userPublicProfiles)
          .set({
            handle: cleanHandle,
            url: cleanUrl,
            updatedAt: new Date()
          })
          .where(eq(schema.userPublicProfiles.id, existing.id));
      } else {
        await db.insert(schema.userPublicProfiles).values({
          id: "chan_" + uuidv4().slice(0, 10),
          accountId,
          campaignId,
          platform,
          handle: cleanHandle,
          url: cleanUrl,
        });
      }
    }

    const saved = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, accountId),
        eq(schema.userPublicProfiles.campaignId, campaignId)
      ));

    return res.json({ success: true, channels: saved });
  } catch (err: any) {
    console.error("[Setup] Save channels error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to save channels" });
  }
});

// 6. POST /api/setup/discover-competitors
setupRouter.post("/discover-competitors", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, autoOnboard } = req.body;

    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const report = await runCompetitorDiscoveryEngine({
      accountId,
      campaignId,
      autoOnboardApproved: false, // Discovery ONLY verifies; never auto-onboards
    });

    return res.json({
      success: report.status === "DISCOVERY_COMPLETE" || report.status === "VERIFIED_COMPETITOR_COUNT_INSUFFICIENT_FOR_BUILD_GATE",
      campaignId,
      status: report.status,
      searchQueries: report.searchMissions.map((m) => m.query),
      searchMissions: report.searchMissions,
      searchProvider: "apify_multi_provider",
      rawCandidateCount: report.uniqueCandidateCount,
      approvedCandidates: report.approvedCandidates,
      rejectedCandidates: report.rejectedCandidates,
      insufficientEvidenceCandidates: report.insufficientEvidenceCandidates,
      candidates: report.approvedCandidates.map((c) => ({
        name: c.name,
        websiteUrl: c.websiteUrl,
        platform: "website",
        profileLink: c.websiteUrl,
        entityRole: c.entityRole,
        classification: c.classification || "DIRECT_COMPETITOR",
        reason: c.relevanceReason || c.judgeReason || `Competitor for campaign ${campaignId}.`,
        tier: c.tier || "B",
        judgeVerdict: c.judgeVerdict === "APPROVED" ? "APPROVED_FOR_REVIEW" : c.judgeVerdict,
        provenance: c.occurrences[0]
          ? {
              searchProvider: c.occurrences[0].searchProvider,
              searchQuery: c.occurrences[0].searchQuery,
              rawTitle: c.occurrences[0].rawTitle,
              rawSnippet: c.occurrences[0].rawSnippet,
              retrievedAt: c.occurrences[0].retrievedAt,
            }
          : undefined,
      })),
      onboardedCompetitors: [],
      telemetry: report.telemetry,
      message: report.message,
    });
  } catch (err: any) {
    console.error("[Setup] Discover competitors error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to discover competitors" });
  }
});

// 7. POST /api/setup/approve-competitors
setupRouter.post("/approve-competitors", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, approvedCompetitors } = req.body;

    if (!campaignId || !Array.isArray(approvedCompetitors)) {
      return res.status(400).json({ success: false, error: "campaignId and approvedCompetitors array are required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const savedCompetitorIds: string[] = [];

    for (const comp of approvedCompetitors) {
      if (!comp.name) continue;
      const cleanUrl = comp.websiteUrl || ("https://" + comp.name.toLowerCase().replace(/\s+/g, "") + ".com");
      
      try {
        const { competitor } = await onboardCompetitorWithMultiSourceDiscovery({
          accountId,
          campaignId,
          name: comp.name.trim(),
          websiteUrl: cleanUrl,
          tier: comp.tier === "A" ? "A" : "B",
          providedSources: {
            instagram: comp.profileLink && comp.profileLink.includes("instagram.com") ? comp.profileLink : undefined,
          }
        });
        savedCompetitorIds.push(competitor.id);
      } catch (err: any) {
        console.warn(`[Setup] Multi-source competitor onboarding error for ${comp.name}:`, err.message);
      }
    }

    return res.json({
      success: true,
      campaignId,
      approvedCount: savedCompetitorIds.length,
      competitorIds: savedCompetitorIds
    });
  } catch (err: any) {
    console.error("[Setup] Approve competitors error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to approve competitors" });
  }
});

// 8. POST /api/setup/build-strategy-gate
setupRouter.post("/build-strategy-gate", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId } = req.body;

    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const [camp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ))
      .limit(1);

    if (!camp) throw new Error("PREREQUISITE_FAILED: CampaignSelection record not found.");
    if (!camp.campaignLocation) throw new Error("PREREQUISITE_FAILED: Target market location is required.");

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, accountId),
        eq(schema.campaignOfferings.campaignId, campaignId)
      ))
      .limit(1);

    if (!offering) throw new Error("PREREQUISITE_FAILED: Hero product / offering not selected.");

    const [buSnap] = await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(and(
        eq(schema.businessUnderstandingSnapshots.accountId, accountId),
        eq(schema.businessUnderstandingSnapshots.campaignId, campaignId)
      ))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1);

    if (!buSnap || buSnap.status !== "COMPLETE") {
      throw new Error("PREREQUISITE_FAILED: Business Understanding snapshot is incomplete.");
    }

    const buPayload: any = buSnap.businessUnderstanding || {};
    const facts = buPayload.campaignOffering?.productTruthFacts || [];
    const roles = buPayload.targetUnderstanding?.targetRoles || [];

    if (facts.length === 0) throw new Error("PREREQUISITE_FAILED: Zero Product Truth facts found.");
    if (roles.length === 0) throw new Error("PREREQUISITE_FAILED: Zero Target Understanding roles found.");

    const competitors = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    if (competitors.length < 10) {
      throw new Error(`PREREQUISITE_FAILED: A minimum of 10 approved competitors is required before strategy build (currently ${competitors.length} approved).`);
    }

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, accountId),
        eq(schema.userPublicProfiles.campaignId, campaignId)
      ));

    return res.json({
      success: true,
      ready: true,
      canonicalContext: {
        accountId,
        campaignId,
        campaignOfferingId: offering.id,
        offeringName: offering.offeringName,
        targetMarket: camp.campaignLocation,
        businessUnderstandingSnapshotId: buSnap.id,
        productTruthCount: facts.length,
        targetRolesCount: roles.length,
        competitorCount: competitors.length,
        channelCount: channels.length
      }
    });
  } catch (err: any) {
    console.error("[Setup] Strategy gate error:", err);
    return res.status(400).json({ success: false, ready: false, error: err.message });
  }
});

// 9. POST /api/setup/create-new-campaign
setupRouter.post("/create-new-campaign", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignName, heroProductName, targetMarket, offeringNotes, channels, goalType } = req.body;

    if (!campaignName || !heroProductName || !targetMarket) {
      return res.status(400).json({ success: false, error: "campaignName, heroProductName, and targetMarket are required" });
    }

    const newCampaignId = "camp_" + uuidv4().slice(0, 12);

    await db.insert(schema.campaignSelections).values({
      accountId,
      selectedCampaignId: newCampaignId,
      selectedCampaignName: campaignName.trim(),
      selectedPlatform: "meta",
      campaignGoalType: goalType || "LEADS",
      campaignStatus: "active",
      campaignLocation: targetMarket.trim(),
      dataSourceMode: "benchmark",
      selectedAt: new Date()
    });

    const [latestWebsite] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(eq(schema.websiteSnapshots.accountId, accountId))
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1);

    if (latestWebsite) {
      await db.insert(schema.websiteSnapshots).values({
        id: "ws_" + uuidv4().slice(0, 10),
        accountId,
        campaignId: newCampaignId,
        rootUrl: latestWebsite.rootUrl,
        pagesCrawled: latestWebsite.pagesCrawled,
        contentHash: latestWebsite.contentHash,
        status: "SUCCESS"
      });
    }

    const evidenceId = "ev_" + uuidv4().slice(0, 10);
    const offeringId = "off_" + uuidv4().slice(0, 10);

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId,
      accountId,
      campaignId: newCampaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: heroProductName.trim(),
      rawFeaturesAndNotes: offeringNotes || ("Hero product offering: " + heroProductName.trim() + " for market " + targetMarket.trim()),
      contentHash: "HASH_" + Date.now()
    });

    await db.insert(schema.campaignOfferings).values({
      id: offeringId,
      accountId,
      campaignId: newCampaignId,
      offeringName: heroProductName.trim(),
      sourceInputEvidenceId: evidenceId
    });

    const buAuthorityId = await runBusinessUnderstandingEngine(accountId, newCampaignId, offeringId);

    if (Array.isArray(channels) && channels.length > 0) {
      for (const ch of channels) {
        if (!ch.platform || !ch.handle) continue;
        await db.insert(schema.userPublicProfiles).values({
          id: "chan_" + uuidv4().slice(0, 10),
          accountId,
          campaignId: newCampaignId,
          platform: ch.platform.toLowerCase(),
          handle: ch.handle.trim().replace(/^@/, ""),
          url: ch.url || ("https://" + ch.platform.toLowerCase() + ".com/" + ch.handle.trim().replace(/^@/, ""))
        });
      }
    }

    return res.json({
      success: true,
      campaignId: newCampaignId,
      campaignOfferingId: offeringId,
      businessUnderstandingSnapshotId: buAuthorityId
    });
  } catch (err: any) {
    console.error("[Setup] Create new campaign error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to create new campaign" });
  }
});

export function registerSetupRoutes(app: Express) {
  app.use("/api/setup", setupRouter);
}
