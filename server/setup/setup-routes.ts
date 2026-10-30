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
import { onboardCompetitorWithMultiSourceDiscovery, recoverAndRunPendingCompetitorDiscovery } from "../competitive-intelligence/source-discovery";
import { randomUUID as uuidv4 } from "crypto";
import { validateCurrency, validateBudgetAmount } from "../strategy/budget-governor/currency";
import { resolveCurrentBusinessUnderstanding } from "../business-understanding/resolver";
import {
  resolvePinnedDiscoveryContext,
  checkDiscoverySessionCompatibility,
  normalizeDomain,
} from "../discovery/context-binder";
import { evaluateCompetitorDiscoveryReadiness } from "../discovery/discovery-readiness";
import type { DiscoveredCompetitorCandidate } from "@shared/contracts/discovery-contracts";
import { checkCampaignActivationEntitlement, getAccountEntitlement, PROPOSED_PACKAGE_CATALOG } from "../entitlements";
import { runWithAiCampaignContext } from "../ai-client";

export const setupRouter = Router();

// 0. GET /api/setup/businesses — Reusable workspace businesses, products, shared channels, and entitlement
setupRouter.get("/businesses", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);

    const businessRows = await db
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.accountId, accountId))
      .orderBy(desc(schema.businesses.updatedAt));

    const productRows = await db
      .select()
      .from(schema.businessProducts)
      .where(eq(schema.businessProducts.accountId, accountId))
      .orderBy(desc(schema.businessProducts.updatedAt));

    const allProfileRows = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(eq(schema.userPublicProfiles.accountId, accountId))
      .orderBy(desc(schema.userPublicProfiles.updatedAt));

    // Deduplicate reusable verified channels by (platform, handle/url)
    const reusableChannelsMap = new Map<string, {
      platform: string;
      handle: string;
      url: string;
      isVerified: boolean;
      followersCount: number | null;
      lastScrapedAt: Date | null;
    }>();
    for (const ch of allProfileRows) {
      const key = `${ch.platform.toLowerCase()}::${(ch.handle || ch.url || "").toLowerCase()}`;
      if (!reusableChannelsMap.has(key)) {
        reusableChannelsMap.set(key, {
          platform: ch.platform.toLowerCase(),
          handle: ch.handle || "",
          url: ch.url || "",
          isVerified: true,
          followersCount: null,
          lastScrapedAt: ch.updatedAt,
        });
      }
    }

    const entitlement = await checkCampaignActivationEntitlement(accountId);

    const businesses = businessRows.map((b) => ({
      id: b.id,
      name: b.name,
      websiteUrl: b.websiteUrl,
      canonicalDomain: b.canonicalDomain,
      industry: b.industry,
      businessModel: b.businessModel,
      classificationProfile: b.classificationProfile,
      verifiedCompanyFacts: Array.isArray(b.verifiedCompanyFacts) ? b.verifiedCompanyFacts : [],
      sourceWebsiteSnapshotId: b.sourceWebsiteSnapshotId,
      products: productRows
        .filter((p) => p.businessId === b.id)
        .map((p) => ({
          id: p.id,
          businessId: p.businessId,
          name: p.name,
          productType: p.productType,
          description: p.description,
          productUrl: p.productUrl,
          documentationText: p.documentationText,
          verifiedCapabilities: Array.isArray(p.verifiedCapabilities) ? p.verifiedCapabilities : [],
          pricingModel: p.pricingModel,
          purchaseModel: p.purchaseModel,
          reviewStatus: p.reviewStatus,
        })),
    }));

    return res.json({
      success: true,
      businesses,
      reusableChannels: Array.from(reusableChannelsMap.values()),
      entitlement,
      packageCatalog: Object.values(PROPOSED_PACKAGE_CATALOG),
    });
  } catch (err: any) {
    console.error("[Setup] Get businesses error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to load businesses" });
  }
});

// 1. POST /api/setup/analyze-website
setupRouter.post("/analyze-website", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { websiteUrl, campaignId: incomingCampaignId } = req.body;

    if (!websiteUrl || typeof websiteUrl !== "string") {
      return res.status(400).json({ success: false, error: "websiteUrl is required" });
    }

    const requestedDomain = normalizeDomain(websiteUrl);
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
      }
    }

    // Scope & Account Isolation Guard:
    // If an existing campaign already belongs to a different website domain, do NOT reuse or overwrite it.
    // Create a fresh campaign for the new business domain.
    if (campaignId) {
      const [existingSnap] = await db
        .select()
        .from(schema.websiteSnapshots)
        .where(and(
          eq(schema.websiteSnapshots.accountId, accountId),
          eq(schema.websiteSnapshots.campaignId, campaignId)
        ))
        .orderBy(desc(schema.websiteSnapshots.createdAt))
        .limit(1);

      const existingDomain = existingSnap?.rootUrl ? normalizeDomain(existingSnap.rootUrl) : "";
      if (existingDomain && requestedDomain && existingDomain !== requestedDomain) {
        campaignId = undefined;
      }
    }

    if (!campaignId) {
      const entitlement = await checkCampaignActivationEntitlement(accountId);
      if (!entitlement.allowed) {
        return res.status(403).json({
          success: false,
          code: "CAMPAIGN_LIMIT_REACHED",
          error: entitlement.reason,
          entitlement,
        });
      }

      campaignId = "camp_" + uuidv4().slice(0, 12);
      const domainLabel = requestedDomain ? requestedDomain.split(".")[0] : "New";
      const campaignLabel = domainLabel.charAt(0).toUpperCase() + domainLabel.slice(1) + " Campaign";
      await db.insert(schema.campaignSelections).values({
        accountId,
        selectedCampaignId: campaignId,
        selectedCampaignName: campaignLabel,
        selectedPlatform: "meta",
        campaignGoalType: "LEADS",
        campaignStatus: "active",
        campaignLocation: "United Arab Emirates",
        dataSourceMode: "benchmark",
        setupStatus: "IN_PROGRESS",
        setupStep: "01_BUSINESS",
        selectedAt: new Date(),
      });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    const result = await runWithAiCampaignContext(
      { accountId, campaignId, operationType: "website_analysis" },
      () => analyzeCompanyWebsite(accountId, campaignId, websiteUrl)
    );

    return res.json({
      success: true,
      campaignId,
      data: result
    });
  } catch (err: any) {
    const referenceId = `err_setup_${uuidv4().slice(0, 8)}`;
    console.error(`[Setup] Analyze website error [${referenceId}]:`, err);

    let userMessage = "Unable to analyze the website. Please check that the URL is accessible and try again.";
    if (err.message && typeof err.message === "string") {
      if (err.message.includes("INVALID_ROOT_URL") || err.message.includes("Invalid URL")) {
        userMessage = "The provided URL is invalid. Please enter a valid website address (e.g. https://yourbusiness.com).";
      } else if (err.message.includes("WEBSITE_CRAWL_FAILED")) {
        userMessage = "Unable to reach or extract content from the website. Please ensure the website is online and accessible.";
      }
    }

    return res.status(500).json({
      success: false,
      error: userMessage,
      referenceId
    });
  }
});

// 1.5 GET /api/setup/status
setupRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const requestedCampaignId =
      typeof req.query.campaignId === "string" && req.query.campaignId.trim()
        ? req.query.campaignId.trim()
        : null;

    const allCamps = await db
      .select()
      .from(schema.campaignSelections)
      .where(
        and(
          eq(schema.campaignSelections.accountId, accountId),
          eq(schema.campaignSelections.isArchived, false)
        )
      )
      .orderBy(desc(schema.campaignSelections.selectedAt));

    const camp = requestedCampaignId
      ? allCamps.find((c) => c.selectedCampaignId === requestedCampaignId) || allCamps[0]
      : allCamps[0];

    if (!camp) {
      return res.json({
        success: true,
        isComplete: false,
        hasAnyCompletedCampaign: false,
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
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1);

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, accountId),
        eq(schema.campaignOfferings.campaignId, campaignId)
      ))
      .orderBy(desc(schema.campaignOfferings.createdAt))
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

    const buResult = await resolveCurrentBusinessUnderstanding({
      accountId,
      campaignId,
      campaignOfferingId: offering?.id
    });
    const buSnap = buResult?.snapshotRow || null;

    let step = "01_BUSINESS";
    let stepNumber = 1;
    let stepLabel = "Business Website";

    if (website?.rootUrl || camp.businessId) {
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

    const [activeStrategicPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(and(
        eq(schema.strategicPlans.accountId, accountId),
        eq(schema.strategicPlans.campaignId, campaignId)
      ))
      .limit(1);

    const [activeStrategyRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(and(
        eq(schema.strategyRoots.accountId, accountId),
        eq(schema.strategyRoots.campaignId, campaignId),
        eq(schema.strategyRoots.status, "ACTIVE")
      ))
      .limit(1);

    const hasReadyCompetitors = competitors.length >= 1 && buSnap?.status === "COMPLETE";
    if (hasReadyCompetitors || strategyPlan || activeStrategicPlan || activeStrategyRoot) {
      step = "06_READY";
      stepNumber = 6;
      stepLabel = "Strategy Ready";
    }

    const hasLiveStrategy = !!(activeStrategicPlan || activeStrategyRoot);
    const isComplete = hasLiveStrategy || !!((website || camp.businessId) && offering && buSnap?.status === "COMPLETE" && competitors.length >= 1);
    const hasAnyCompletedCampaign = isComplete || allCamps.some((c) => c.setupStatus === "COMPLETED");

    return res.json({
      success: true,
      isComplete,
      hasAnyCompletedCampaign,
      step,
      stepNumber,
      stepLabel,
      campaignId,
      campaignName: camp.selectedCampaignName || "Initial Campaign",
      businessId: camp.businessId || null,
      productId: camp.productId || null,
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
    const campaignId = String(req.params.campaignId || "");

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
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1);

    const [offering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(and(
        eq(schema.campaignOfferings.accountId, accountId),
        eq(schema.campaignOfferings.campaignId, campaignId)
      ))
      .orderBy(desc(schema.campaignOfferings.createdAt))
      .limit(1);

    const buResult = await resolveCurrentBusinessUnderstanding({
      accountId,
      campaignId,
      campaignOfferingId: offering?.id
    });
    const buSnap = buResult?.snapshotRow || null;

    const channels = await db
      .select()
      .from(schema.userPublicProfiles)
      .where(and(
        eq(schema.userPublicProfiles.accountId, accountId),
        eq(schema.userPublicProfiles.campaignId, campaignId)
      ));

    const [latestDiscoverySession] = await db
      .select()
      .from(schema.competitorDiscoverySessions)
      .where(eq(schema.competitorDiscoverySessions.campaignId, campaignId))
      .orderBy(desc(schema.competitorDiscoverySessions.createdAt))
      .limit(1);

    const competitors = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    const localCompetitors = competitors.filter(
      (c) => c.geographicClassification === "LOCAL_MARKET"
    );
    const distinctLocalEntityMap = new Map<string, typeof competitors[0]>();
    for (const comp of localCompetitors) {
      const entityKey = comp.canonicalEntityId || comp.name.toLowerCase().trim();
      if (!distinctLocalEntityMap.has(entityKey)) {
        distinctLocalEntityMap.set(entityKey, comp);
      }
    }
    const localCompetitorCount = distinctLocalEntityMap.size;

    const [budgetSetting] = await db
      .select()
      .from(schema.campaignBudgetSettings)
      .where(and(
        eq(schema.campaignBudgetSettings.accountId, accountId),
        eq(schema.campaignBudgetSettings.campaignId, campaignId)
      ))
      .limit(1);

    const [businessRow] = camp?.businessId
      ? await db
          .select()
          .from(schema.businesses)
          .where(and(eq(schema.businesses.accountId, accountId), eq(schema.businesses.id, camp.businessId)))
          .limit(1)
      : [];

    const [productRow] = camp?.productId
      ? await db
          .select()
          .from(schema.businessProducts)
          .where(and(eq(schema.businessProducts.accountId, accountId), eq(schema.businessProducts.id, camp.productId)))
          .limit(1)
      : [];

    const relevanceDecisionRows = await db
      .select()
      .from(schema.competitorRelevanceDecisions)
      .where(and(
        eq(schema.competitorRelevanceDecisions.accountId, accountId),
        eq(schema.competitorRelevanceDecisions.campaignId, campaignId)
      ))
      .orderBy(desc(schema.competitorRelevanceDecisions.updatedAt));

    const buPayload = buResult?.payload || null;
    const targetMarket = camp?.campaignLocation || "United Arab Emirates";

    let companyName = "";
    let industry = "";
    let businessModel = "";
    let productCatalogue: any[] = [];
    let classificationProfile: any = null;
    let evidenceGaps: string[] = [];
    let productTruthFacts: any[] = [];
    let targetRoles: any[] = [];
    let isCanonicalBusinessUnderstanding = false;

    if (buResult && buPayload) {
      // CANONICAL BUSINESS UNDERSTANDING IS SOLE AUTHORITY
      isCanonicalBusinessUnderstanding = true;
      companyName = buPayload.businessName || "";
      industry = buPayload.generalIndustry || buPayload.campaignOffering?.category || "";
      businessModel = buPayload.businessModel || "";
      productCatalogue = Array.isArray(buPayload.discoveredOfferings) ? buPayload.discoveredOfferings : [];
      classificationProfile = buPayload.classificationProfile || null;
      evidenceGaps = Array.isArray(buPayload.evidenceGaps)
        ? buPayload.evidenceGaps
        : Array.isArray(buPayload.classificationProfile?.evidenceGaps)
          ? buPayload.classificationProfile.evidenceGaps
          : [];
      productTruthFacts = Array.isArray(buPayload.campaignOffering?.productTruthFacts)
        ? buPayload.campaignOffering.productTruthFacts
        : [];
      targetRoles = Array.isArray(buPayload.targetUnderstanding?.targetRoles)
        ? buPayload.targetUnderstanding.targetRoles
        : [];
    } else if (website) {
      // PRELIMINARY EXTRACTION (Pre-BU for Step 1/Step 2 only)
      const preliminary = (website as any).preliminaryExtraction || null;
      if (preliminary) {
        companyName = preliminary.companyName || "";
        industry = preliminary.industry || "";
        businessModel = preliminary.businessModel || "";
        productCatalogue = preliminary.productCatalogue || [];
        classificationProfile = preliminary.classificationProfile || null;
        evidenceGaps = Array.isArray(preliminary.evidenceGaps)
          ? preliminary.evidenceGaps
          : Array.isArray(preliminary.classificationProfile?.evidenceGaps)
            ? preliminary.classificationProfile.evidenceGaps
            : [];
      } else {
        try {
          const hostname = new URL(website.rootUrl).hostname.replace(/^www\./, "").split(".")[0];
          companyName = hostname.charAt(0).toUpperCase() + hostname.slice(1);
        } catch (e) {}
      }
    }

    // Check discovery session compatibility with current target market, offering, and BU snapshot
    const sessionCompatibility = latestDiscoverySession
      ? checkDiscoverySessionCompatibility(latestDiscoverySession, {
          targetMarket,
          campaignOfferingId: offering?.id || null,
          buSnapshotId: buSnap?.id || null,
        })
      : { valid: true };

    const sessionCandidates: DiscoveredCompetitorCandidate[] =
      latestDiscoverySession && sessionCompatibility.valid && Array.isArray(latestDiscoverySession.candidates)
        ? (latestDiscoverySession.candidates as DiscoveredCompetitorCandidate[])
        : [];

    const sessionApproved = sessionCandidates.filter((c) => c.judgeVerdict === "APPROVED");
    const onboardedAsCandidates: DiscoveredCompetitorCandidate[] = competitors.map((c) => ({
      candidateKey: normalizeDomain(c.websiteUrl || c.name),
      canonicalEntityId: c.canonicalEntityId || undefined,
      name: c.name,
      domain: normalizeDomain(c.websiteUrl || c.name),
      websiteUrl: c.websiteUrl || "",
      storefronts: (c.storefronts as any) || undefined,
      occurrences: [],
      geographicClassification: (c.geographicClassification as any) || "UNVERIFIED",
      classification: "DIRECT_COMPETITOR",
      tier: (c.tier as any) || "B",
      judgeVerdict: "APPROVED",
      selected: true,
    }));

    const combinedApprovedForReadiness =
      sessionApproved.length > 0 ? sessionApproved : onboardedAsCandidates;

    const selectedDomainsForReadiness =
      competitors.length > 0
        ? competitors.map((c) => normalizeDomain(c.websiteUrl || c.name)).filter(Boolean)
        : undefined;

    const sessionTelemetry: any = latestDiscoverySession?.telemetry || {};
    const readiness = await evaluateCompetitorDiscoveryReadiness(
      {
        hasCanonicalBusinessUnderstanding: Boolean(buSnap && buSnap.status === "COMPLETE"),
        hasConfirmedOffering: Boolean(offering),
        contextCompatible: sessionCompatibility.valid,
        incompatibilityReason: sessionCompatibility.reason,
        providerErrorCount: sessionTelemetry.providerErrors || 0,
        emptyResultMissionCount: sessionTelemetry.emptyResultMissions || 0,
        budgetExhausted: Boolean(sessionTelemetry.budgetExhausted),
        businessName: companyName || offering?.offeringName || "Business",
        offeringName: offering?.offeringName || "",
        category: buPayload?.campaignOffering?.category || industry || "General",
        businessModel,
        targetMarket,
        classificationProfile,
        productTruthFacts: productTruthFacts.map((f: any) => f.statement || String(f)),
        targetRoles: targetRoles.map((r: any) => r.roleTitle || String(r)),
        evidenceGaps,
        approvedCandidates: combinedApprovedForReadiness,
        selectedDomains: selectedDomainsForReadiness,
      },
      { accountId, useLlmAssessment: false }
    );

    let step = "01_BUSINESS";
    if (website?.rootUrl || businessRow) step = "02_MARKET";
    if (camp?.campaignLocation) step = "03_FOCUS";
    if (offering?.offeringName) step = "04_CHANNELS";
    if (channels.length > 0 || (latestDiscoverySession && sessionCompatibility.valid)) step = "05_COMPETITORS";
    if (readiness.canProceed && competitors.length > 0) step = "06_READY";

    const isReadyForStrategy = !!(
      camp &&
      offering &&
      buSnap?.status === "COMPLETE" &&
      camp.campaignLocation &&
      readiness.canProceed &&
      competitors.length > 0
    );

    return res.json({
      success: true,
      step,
      campaignId,
      campaignName: camp?.selectedCampaignName || "My Campaign",
      goalType: camp?.campaignGoalType || "LEADS",
      business: businessRow || null,
      product: productRow || null,
      companyFacts: buSnap?.companyFacts || businessRow?.verifiedCompanyFacts || [],
      productFacts: buSnap?.productFacts || productTruthFacts,
      campaignChoices: buSnap?.campaignChoices || null,
      evidenceProvenance: buSnap?.evidenceProvenance || null,
      inputSnapshotVersion: buSnap?.inputSnapshotVersion || null,
      competitorRelevanceDecisions: relevanceDecisionRows,
      targetMarket,
      websiteUrl: website?.rootUrl || businessRow?.websiteUrl || "",
      companyName: companyName || businessRow?.name || "",
      industry: industry || businessRow?.industry || "",
      businessModel: businessModel || businessRow?.businessModel || "",
      classificationProfile: classificationProfile || businessRow?.classificationProfile || null,
      evidenceGaps,
      productCatalogue,
      productTruthFacts,
      targetRoles,
      selectedOffering: offering ? {
        id: offering.id,
        name: offering.offeringName,
      } : null,
      isCanonicalBusinessUnderstanding,
      businessUnderstandingSnapshotId: buSnap?.id || null,
      productTruthCount: productTruthFacts.length,
      targetRolesCount: targetRoles.length,
      channels: channels.map(c => ({
        id: c.id,
        platform: c.platform,
        handle: c.handle,
        url: c.url
      })),
      competitors: competitors.map(c => ({
        id: c.id,
        name: c.name,
        websiteUrl: c.websiteUrl,
        tier: c.tier,
        geographicClassification: c.geographicClassification || "UNVERIFIED",
        canonicalEntityId: c.canonicalEntityId,
        storefronts: c.storefronts,
      })),
      localCompetitorCount,
      discoveryContextCompatible: sessionCompatibility.valid,
      discoveryIncompatibilityReason: sessionCompatibility.reason || null,
      discoverySession: latestDiscoverySession && sessionCompatibility.valid ? latestDiscoverySession : null,
      staleDiscoverySession: latestDiscoverySession && !sessionCompatibility.valid ? {
        id: latestDiscoverySession.id,
        targetMarket: latestDiscoverySession.targetMarket,
        reason: sessionCompatibility.reason,
      } : null,
      readiness,
      budget: budgetSetting ? {
        monthlyBudget: budgetSetting.monthlyBudget != null ? parseFloat(budgetSetting.monthlyBudget) : null,
        currency: budgetSetting.currency || "USD",
        version: budgetSetting.version || 1,
      } : null,
      isReadyForStrategy
    });
  } catch (err: any) {
    console.error("[Setup] Get state error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to fetch setup state" });
  }
});

// 2.5 POST /api/setup/save-budget
setupRouter.post("/save-budget", async (req: Request, res: Response) => {
  try {
    const accountId = resolveAccountId(req);
    const { campaignId, monthlyBudget, currency = "USD" } = req.body;

    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

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
    const finalBudget = amtRes.numericAmount ?? amtRes.normalizedAmount ?? null; // number or null

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
      data: {
        campaignId,
        monthlyBudget: record.monthlyBudget != null ? parseFloat(record.monthlyBudget) : null,
        currency: record.currency,
        version: record.version,
      },
    });
  } catch (err: any) {
    console.error("[Setup] Save budget error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to save budget" });
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

    const trimmedMarket = targetMarket.trim();
    const [existingCamp] = await db
      .select()
      .from(schema.campaignSelections)
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ))
      .limit(1);

    const previousMarket = existingCamp?.campaignLocation?.trim() || "";
    const marketChanged = Boolean(previousMarket && previousMarket.toLowerCase() !== trimmedMarket.toLowerCase());

    await db
      .update(schema.campaignSelections)
      .set({
        campaignLocation: trimmedMarket,
        updatedAt: new Date()
      })
      .where(and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      ));

    return res.json({
      success: true,
      targetMarket: trimmedMarket,
      marketChanged,
      discoveryInvalidated: marketChanged,
    });
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
        .set({ campaignLocation: targetMarket.trim(), updatedAt: new Date() })
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
      .orderBy(desc(schema.campaignOfferings.createdAt))
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

    // Resolve the newly generated canonical Business Understanding so the frontend immediately updates
    // its state and never keeps displaying stale preliminary website classification.
    let canonicalBusinessUnderstanding: any = null;
    try {
      const buResult = await resolveCurrentBusinessUnderstanding({
        accountId,
        campaignId,
        campaignOfferingId: offeringId,
      });
      if (buResult?.payload) {
        const p = buResult.payload;
        canonicalBusinessUnderstanding = {
          snapshotId: buResult.snapshotId,
          companyName: p.businessName || "",
          industry: p.generalIndustry || p.campaignOffering?.category || "",
          businessModel: p.businessModel || "",
          classificationProfile: p.classificationProfile || null,
          evidenceGaps: p.evidenceGaps || p.classificationProfile?.evidenceGaps || [],
          productCatalogue: Array.isArray(p.discoveredOfferings) ? p.discoveredOfferings : [],
          productTruthFacts: Array.isArray(p.campaignOffering?.productTruthFacts) ? p.campaignOffering.productTruthFacts : [],
          targetRoles: Array.isArray(p.targetUnderstanding?.targetRoles) ? p.targetUnderstanding.targetRoles : [],
        };
      }
    } catch {}

    return res.json({
      success: true,
      campaignOfferingId: offeringId,
      offeringName: confirmedOfferingName,
      authorityType: "USER_CONFIRMED",
      businessUnderstandingSnapshotId: buAuthorityId,
      canonicalBusinessUnderstanding,
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

    const { normalizeYouTubeChannelUrl, parseLinkedInIdentity } = await import("../acquisition/multi-source-providers");

    for (const ch of channels) {
      if (!ch.platform || (!ch.handle && !ch.url)) continue;
      const platform = ch.platform.toLowerCase();
      let rawInput = String(ch.handle || ch.url || "").trim();
      if (!rawInput) continue;
      let cleanHandle = rawInput;
      let cleanUrl = "";

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
        cleanHandle = liIdentity.handle;
        cleanUrl = liIdentity.canonicalUrl;
      } else if (platform === "youtube") {
        if (rawInput.startsWith("http://") || rawInput.startsWith("https://")) {
          try {
            const parsed = new URL(rawInput);
            const pathSegments = parsed.pathname.split("/").filter(Boolean);
            cleanHandle = (pathSegments[pathSegments.length - 1] || rawInput).replace(/^@/, "");
          } catch {}
        } else {
          cleanHandle = rawInput.replace(/^@/, "");
        }
        cleanUrl = normalizeYouTubeChannelUrl(rawInput.startsWith("http") ? rawInput : "", cleanHandle);
      } else if (platform === "website") {
        cleanUrl = rawInput.startsWith("http") ? rawInput : `https://${rawInput}`;
        cleanHandle = "";
      } else {
        if (cleanHandle.startsWith("http://") || cleanHandle.startsWith("https://")) {
          try {
            const parsed = new URL(cleanHandle);
            const pathSegments = parsed.pathname.split("/").filter(Boolean);
            cleanHandle = pathSegments[0]?.replace(/^@/, "") || cleanHandle;
          } catch (e) {}
        }
        cleanHandle = cleanHandle.replace(/^@/, "");
        cleanUrl = `https://${platform}.com/${platform === "tiktok" ? "@" : ""}${cleanHandle}`;
      }

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
    const { campaignId, resumeSession, selectedDomains } = req.body;

    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

    await assertCampaignBelongsTo(accountId, campaignId);

    // Pin immutable discovery context exactly once before execution
    const pinnedContext = await resolvePinnedDiscoveryContext({ accountId, campaignId });

    const report = await runCompetitorDiscoveryEngine({
      accountId,
      campaignId,
      autoOnboardApproved: false, // Discovery ONLY verifies; never auto-onboards
      pinnedContext,
      resumeSession: !!resumeSession,
      selectedDomains: Array.isArray(selectedDomains) ? selectedDomains : undefined,
    });

    return res.json({
      success: report.status !== "SEARCH_PROVIDER_UNAVAILABLE" && report.status !== "INSUFFICIENT_CONTEXT",
      campaignId,
      discoverySessionId: report.discoverySessionId,
      pinnedContext: {
        buSnapshotId: pinnedContext.buSnapshotId,
        category: pinnedContext.category,
        businessName: pinnedContext.businessName,
        businessModel: pinnedContext.businessModel,
        classificationProfile: pinnedContext.classificationProfile,
        offeringName: pinnedContext.offeringName,
        targetMarket: pinnedContext.targetMarket,
        pinnedAt: pinnedContext.pinnedAt,
      },
      status: report.status,
      searchQueries: report.searchMissions.map((m) => m.query),
      searchMissions: report.searchMissions,
      searchProvider: "apify_multi_provider",
      rawCandidateCount: report.uniqueCandidateCount,
      localCandidates: report.localCandidates || [],
      crossBorderCandidates: report.crossBorderCandidates || [],
      unverifiedMarketCandidates: report.unverifiedMarketCandidates || [],
      internationalReferenceCandidates: report.internationalReferenceCandidates || [],
      pendingVerificationCandidates: report.pendingVerificationCandidates || [],
      localVerifiedCount: report.localVerifiedCount || 0,
      requiredLocalCount: 0,
      shortfall: 0,
      isBuildEligible: report.readiness?.canProceed ?? report.isBuildEligible ?? false,
      readiness: report.readiness,
      approvedCandidates: report.approvedCandidates,
      rejectedCandidates: report.rejectedCandidates,
      insufficientEvidenceCandidates: report.insufficientEvidenceCandidates,
      candidates: report.approvedCandidates.map((c) => ({
        name: c.name,
        websiteUrl: c.websiteUrl,
        domain: c.domain,
        canonicalEntityId: c.canonicalEntityId,
        storefronts: c.storefronts,
        geographicClassification: c.geographicClassification || "UNVERIFIED",
        geographicReasoning: c.geographicReasoning,
        marketAvailabilityUncertainty: c.marketAvailabilityUncertainty,
        sourcePageType: c.sourcePageType,
        evidenceSourceType: c.evidenceSourceType,
        platform: "website",
        entityRole: c.entityRole,
        classification: c.classification || "DIRECT_COMPETITOR",
        reason: c.relevanceReason || c.judgeReason || `Competitor for campaign ${campaignId}.`,
        tier: c.tier || "B",
        judgeVerdict: c.judgeVerdict === "APPROVED" ? "APPROVED_FOR_REVIEW" : c.judgeVerdict,
        selected: c.selected !== false,
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
    const selectedDomainSet = new Set<string>();
    const backgroundQueue: Array<{
      name: string;
      websiteUrl: string;
      tier: "A" | "B";
      geographicClassification: string;
      canonicalEntityId?: string;
      storefronts?: any;
      forceInitialCrawl: boolean;
    }> = [];

    await Promise.all(
      approvedCompetitors.map(async (comp: any) => {
        if (!comp?.name) return;
        const cleanUrl = comp.websiteUrl || ("https://" + comp.name.toLowerCase().replace(/\s+/g, "") + ".com");
        const dom = normalizeDomain(cleanUrl);
        if (dom) selectedDomainSet.add(dom);

        try {
          const { competitor, isExisting } = await onboardCompetitorWithMultiSourceDiscovery({
            accountId,
            campaignId,
            name: comp.name.trim(),
            websiteUrl: cleanUrl,
            tier: comp.tier === "A" ? "A" : "B",
            geographicClassification: comp.geographicClassification || "UNVERIFIED",
            canonicalEntityId: comp.canonicalEntityId,
            storefronts: comp.storefronts,
            providedSources: {},
            fastOnboardOnly: true,
          });
          savedCompetitorIds.push(competitor.id);
          backgroundQueue.push({
            name: comp.name.trim(),
            websiteUrl: cleanUrl,
            tier: comp.tier === "A" ? "A" : "B",
            geographicClassification: comp.geographicClassification || "UNVERIFIED",
            canonicalEntityId: comp.canonicalEntityId,
            storefronts: comp.storefronts,
            forceInitialCrawl: !isExisting,
          });
        } catch (err: any) {
          console.warn(`[Setup] Fast competitor onboarding error for ${comp.name}:`, err.message);
        }
      })
    );

    // Deactivate any previously active ciCompetitors for this campaign that were deselected by the user
    const existingActive = await db
      .select()
      .from(schema.ciCompetitors)
      .where(and(
        eq(schema.ciCompetitors.accountId, accountId),
        eq(schema.ciCompetitors.campaignId, campaignId),
        eq(schema.ciCompetitors.isActive, true)
      ));

    for (const existing of existingActive) {
      if (!savedCompetitorIds.includes(existing.id)) {
        await db
          .update(schema.ciCompetitors)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.ciCompetitors.id, existing.id));
      }
    }

    // Persist selection state into the latest competitorDiscoverySessions row so Continue Discovery preserves selections
    try {
      const [latestSession] = await db
        .select()
        .from(schema.competitorDiscoverySessions)
        .where(eq(schema.competitorDiscoverySessions.campaignId, campaignId))
        .orderBy(desc(schema.competitorDiscoverySessions.createdAt))
        .limit(1);

      if (latestSession && Array.isArray(latestSession.candidates)) {
        const updatedCandidates = (latestSession.candidates as DiscoveredCompetitorCandidate[]).map((c) => {
          const dom = normalizeDomain(c.domain || c.websiteUrl || c.candidateKey || "");
          return {
            ...c,
            selected: selectedDomainSet.has(dom),
          };
        });
        await db
          .update(schema.competitorDiscoverySessions)
          .set({
            candidates: updatedCandidates,
            updatedAt: new Date(),
          })
          .where(eq(schema.competitorDiscoverySessions.id, latestSession.id));
      }
    } catch (sessErr: any) {
      console.warn("[Setup] Could not update selection state on discovery session:", sessErr.message);
    }

    if (savedCompetitorIds.length > 0) {
      await db
        .update(schema.campaignSelections)
        .set({
          setupStatus: "COMPLETED",
          setupStep: "06_READY",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaignSelections.accountId, accountId),
            eq(schema.campaignSelections.selectedCampaignId, campaignId)
          )
        );
    }

    // Kick off durable multi-source discovery, website crawl, competitor understanding, and Watchtower schedule in background
    if (backgroundQueue.length > 0) {
      setImmediate(() => {
        recoverAndRunPendingCompetitorDiscovery({
          accountId,
          campaignId,
          maxCompetitors: backgroundQueue.length + 5,
        }).catch((err) => {
          console.warn("[Setup] Background competitor enrichment recovery error:", err?.message || err);
        });
      });
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
      .orderBy(desc(schema.campaignOfferings.createdAt))
      .limit(1);

    if (!offering) throw new Error("PREREQUISITE_FAILED: Hero product / offering not selected.");

    const buResult = await resolveCurrentBusinessUnderstanding({
      accountId,
      campaignId,
      campaignOfferingId: offering.id,
    });
    const buSnap = buResult?.snapshotRow || null;

    if (!buSnap || buSnap.status !== "COMPLETE" || !buResult?.payload) {
      throw new Error("PREREQUISITE_FAILED: Business Understanding snapshot is incomplete.");
    }

    const buPayload = buResult.payload;
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

    const localCompetitors = competitors.filter(
      (c) => c.geographicClassification === "LOCAL_MARKET"
    );
    const distinctLocalEntityMap = new Map<string, typeof competitors[0]>();
    for (const comp of localCompetitors) {
      const entityKey = comp.canonicalEntityId || comp.name.toLowerCase().trim();
      if (!distinctLocalEntityMap.has(entityKey)) {
        distinctLocalEntityMap.set(entityKey, comp);
      }
    }
    const distinctLocalCount = distinctLocalEntityMap.size;

    const [latestSession] = await db
      .select()
      .from(schema.competitorDiscoverySessions)
      .where(eq(schema.competitorDiscoverySessions.campaignId, campaignId))
      .orderBy(desc(schema.competitorDiscoverySessions.createdAt))
      .limit(1);

    const sessionCompatibility = latestSession
      ? checkDiscoverySessionCompatibility(latestSession, {
          targetMarket: camp.campaignLocation,
          campaignOfferingId: offering.id,
          buSnapshotId: buSnap.id,
        })
      : { valid: true };

    const sessionCandMap = new Map<string, DiscoveredCompetitorCandidate>();
    if (latestSession && Array.isArray(latestSession.candidates)) {
      for (const sc of latestSession.candidates as DiscoveredCompetitorCandidate[]) {
        const dom = normalizeDomain(sc.domain || sc.websiteUrl || sc.candidateKey || "");
        if (dom) sessionCandMap.set(dom, sc);
      }
    }

    const activeCandidates: DiscoveredCompetitorCandidate[] = competitors.map((c) => {
      const dom = normalizeDomain(c.websiteUrl || c.name);
      const matched = dom ? sessionCandMap.get(dom) : undefined;
      return {
        ...(matched || {}),
        candidateKey: dom,
        canonicalEntityId: c.canonicalEntityId || matched?.canonicalEntityId || undefined,
        name: c.name,
        domain: dom,
        websiteUrl: c.websiteUrl || matched?.websiteUrl || "",
        storefronts: (c.storefronts as any) || matched?.storefronts || undefined,
        occurrences: matched?.occurrences || [],
        geographicClassification: (c.geographicClassification as any) || matched?.geographicClassification || "UNVERIFIED",
        classification: matched?.classification || "DIRECT_COMPETITOR",
        tier: (c.tier as any) || matched?.tier || "B",
        judgeVerdict: "APPROVED",
        selected: true,
      };
    });

    const readiness = await evaluateCompetitorDiscoveryReadiness(
      {
        hasCanonicalBusinessUnderstanding: true,
        hasConfirmedOffering: true,
        contextCompatible: sessionCompatibility.valid,
        incompatibilityReason: sessionCompatibility.reason,
        businessName: buPayload.businessName || offering.offeringName,
        offeringName: offering.offeringName,
        category: buPayload.campaignOffering?.category || buPayload.generalIndustry || "General",
        businessModel: buPayload.businessModel,
        targetMarket: camp.campaignLocation,
        classificationProfile: buPayload.classificationProfile,
        productTruthFacts: facts.map((f: any) => f.statement || String(f)),
        targetRoles: roles.map((r: any) => r.roleTitle || String(r)),
        evidenceGaps: buPayload.evidenceGaps || buPayload.classificationProfile?.evidenceGaps || [],
        approvedCandidates: activeCandidates,
      },
      { accountId, useLlmAssessment: false }
    );

    if (!readiness.canProceed) {
      return res.status(400).json({
        success: false,
        ready: false,
        readiness,
        error: `PREREQUISITE_FAILED: ${readiness.reason}`,
      });
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
      readiness,
      canonicalContext: {
        accountId,
        campaignId,
        campaignOfferingId: offering.id,
        offeringName: offering.offeringName,
        targetMarket: camp.campaignLocation,
        businessUnderstandingSnapshotId: buSnap.id,
        classificationProfile: buPayload.classificationProfile || null,
        productTruthCount: facts.length,
        targetRolesCount: roles.length,
        competitorCount: competitors.length,
        localCompetitorCount: distinctLocalCount,
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
    const {
      draftCampaignId,
      businessId: requestedBusinessId,
      companyName: incomingCompanyName,
      websiteUrl: incomingWebsiteUrl,
      industry: incomingIndustry,
      businessModel: incomingBusinessModel,
      productId: requestedProductId,
      campaignName,
      heroProductName,
      productName: incomingProductName,
      productType: incomingProductType,
      productDescription,
      offeringNotes,
      productUrl,
      documentationText,
      verifiedCapabilities,
      pricingModel,
      purchaseModel,
      targetMarket,
      channels,
      goalType,
      monthlyBudget,
      currency = "USD",
    } = req.body;

    const finalProductName = (incomingProductName || heroProductName || "").trim();
    const finalCampaignName = (campaignName || `${finalProductName} (${(targetMarket || "").trim()})`).trim();
    const finalTargetMarket = (targetMarket || "").trim();

    if (!finalCampaignName || !finalProductName || !finalTargetMarket) {
      return res.status(400).json({
        success: false,
        error: "campaignName, productName (or heroProductName), and targetMarket are required",
      });
    }

    // Check active campaign entitlement limit
    const entitlement = await checkCampaignActivationEntitlement(accountId, draftCampaignId || undefined);
    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        code: "CAMPAIGN_LIMIT_REACHED",
        error: entitlement.reason,
        entitlement,
      });
    }

    // 1. Resolve or create Business (reusing existing verified company info without repeating company setup)
    let businessRow: typeof schema.businesses.$inferSelect | undefined;
    if (requestedBusinessId) {
      const [found] = await db
        .select()
        .from(schema.businesses)
        .where(and(eq(schema.businesses.accountId, accountId), eq(schema.businesses.id, requestedBusinessId)))
        .limit(1);
      businessRow = found;
    }
    if (!businessRow) {
      const [firstBiz] = await db
        .select()
        .from(schema.businesses)
        .where(eq(schema.businesses.accountId, accountId))
        .orderBy(desc(schema.businesses.updatedAt))
        .limit(1);
      businessRow = firstBiz;
    }

    const [latestWebsite] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(
        businessRow?.sourceWebsiteSnapshotId
          ? eq(schema.websiteSnapshots.id, businessRow.sourceWebsiteSnapshotId)
          : eq(schema.websiteSnapshots.accountId, accountId)
      )
      .orderBy(desc(schema.websiteSnapshots.createdAt))
      .limit(1);

    let businessId = businessRow?.id || `biz_${uuidv4().slice(0, 10)}`;
    if (!businessRow) {
      const rootUrl = incomingWebsiteUrl || latestWebsite?.rootUrl || "https://example.com";
      const [createdBiz] = await db
        .insert(schema.businesses)
        .values({
          id: businessId,
          accountId,
          name: incomingCompanyName || finalCampaignName,
          websiteUrl: rootUrl,
          canonicalDomain: normalizeDomain(rootUrl),
          industry: incomingIndustry || "General",
          businessModel: incomingBusinessModel || "Commercial Business",
          verifiedCompanyFacts: [],
          sourceWebsiteSnapshotId: latestWebsite?.id || null,
        })
        .returning();
      businessRow = createdBiz;
    }

    // 2. Resolve or create Product / Service offering (supports services, SaaS, digital or physical products)
    let productRow: typeof schema.businessProducts.$inferSelect | undefined;
    if (requestedProductId) {
      const [foundProd] = await db
        .select()
        .from(schema.businessProducts)
        .where(
          and(
            eq(schema.businessProducts.accountId, accountId),
            eq(schema.businessProducts.id, requestedProductId)
          )
        )
        .limit(1);
      productRow = foundProd;
    }

    const validProductTypes = [
      "PRODUCT",
      "SERVICE",
      "SAAS",
      "DIGITAL_PRODUCT",
      "PHYSICAL_PRODUCT",
      "HYBRID_OFFERING",
    ];
    const resolvedProductType = validProductTypes.includes(String(incomingProductType || "").toUpperCase())
      ? String(incomingProductType).toUpperCase()
      : productRow?.productType || "PRODUCT";
    const resolvedDescription = (productDescription || offeringNotes || productRow?.description || "").trim();
    const resolvedCapabilities = Array.isArray(verifiedCapabilities)
      ? verifiedCapabilities.map((c: any) => String(c).trim()).filter(Boolean)
      : typeof verifiedCapabilities === "string" && verifiedCapabilities.trim()
        ? verifiedCapabilities
            .split(/[\n,;]+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
        : Array.isArray(productRow?.verifiedCapabilities)
          ? (productRow.verifiedCapabilities as string[])
          : [];

    let productId = productRow?.id || `prod_${uuidv4().slice(0, 10)}`;
    if (!productRow) {
      const [createdProd] = await db
        .insert(schema.businessProducts)
        .values({
          id: productId,
          accountId,
          businessId,
          name: finalProductName,
          productType: resolvedProductType,
          description: resolvedDescription || `${finalProductName} (${resolvedProductType})`,
          productUrl: productUrl ? String(productUrl).trim() : null,
          documentationText: documentationText ? String(documentationText).trim() : null,
          verifiedCapabilities: resolvedCapabilities,
          pricingModel: pricingModel ? String(pricingModel).trim() : null,
          purchaseModel: purchaseModel ? String(purchaseModel).trim() : null,
          reviewStatus: "CONFIRMED",
        })
        .returning();
      productRow = createdProd;
    } else {
      const [updatedProd] = await db
        .update(schema.businessProducts)
        .set({
          name: finalProductName,
          productType: resolvedProductType,
          description: resolvedDescription || productRow.description,
          productUrl: productUrl !== undefined ? (productUrl ? String(productUrl).trim() : null) : productRow.productUrl,
          documentationText:
            documentationText !== undefined
              ? documentationText
                ? String(documentationText).trim()
                : null
              : productRow.documentationText,
          verifiedCapabilities: resolvedCapabilities.length > 0 ? resolvedCapabilities : productRow.verifiedCapabilities,
          pricingModel: pricingModel !== undefined ? (pricingModel ? String(pricingModel).trim() : null) : productRow.pricingModel,
          purchaseModel: purchaseModel !== undefined ? (purchaseModel ? String(purchaseModel).trim() : null) : productRow.purchaseModel,
          reviewStatus: "CONFIRMED",
          updatedAt: new Date(),
        })
        .where(eq(schema.businessProducts.id, productRow.id))
        .returning();
      productRow = updatedProd;
    }

    // 3. Create or resume Campaign Selection (never creating duplicate campaigns when resuming a draft)
    let targetCampaignId = draftCampaignId ? String(draftCampaignId).trim() : "";
    let existingDraft: typeof schema.campaignSelections.$inferSelect | undefined;
    if (targetCampaignId) {
      const [foundDraft] = await db
        .select()
        .from(schema.campaignSelections)
        .where(
          and(
            eq(schema.campaignSelections.accountId, accountId),
            eq(schema.campaignSelections.selectedCampaignId, targetCampaignId)
          )
        )
        .limit(1);
      existingDraft = foundDraft;
    }

    if (!existingDraft) {
      targetCampaignId = targetCampaignId || "camp_" + uuidv4().slice(0, 12);
      await db.insert(schema.campaignSelections).values({
        accountId,
        selectedCampaignId: targetCampaignId,
        selectedCampaignName: finalCampaignName,
        businessId,
        productId,
        selectedPlatform: "meta",
        campaignGoalType: goalType || "LEADS",
        campaignStatus: "active",
        campaignLocation: finalTargetMarket,
        dataSourceMode: "benchmark",
        setupStatus: "IN_PROGRESS",
        setupStep: "05_COMPETITORS",
        selectedAt: new Date(),
      });
    } else {
      await db
        .update(schema.campaignSelections)
        .set({
          selectedCampaignName: finalCampaignName,
          businessId,
          productId,
          campaignGoalType: goalType || existingDraft.campaignGoalType || "LEADS",
          campaignLocation: finalTargetMarket,
          setupStatus: "IN_PROGRESS",
          setupStep: "05_COMPETITORS",
          selectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.campaignSelections.id, existingDraft.id));
    }

    // 4. Persist campaign budget if provided
    if (monthlyBudget !== undefined && monthlyBudget !== null && monthlyBudget !== "") {
      const currRes = validateCurrency(currency);
      const normCurrency = currRes.valid && currRes.normalizedCurrency ? currRes.normalizedCurrency : "USD";
      const amtRes = validateBudgetAmount(monthlyBudget, normCurrency);
      if (amtRes.valid) {
        const finalBudget = amtRes.numericAmount ?? amtRes.normalizedAmount ?? null;
        const [existingBudget] = await db
          .select()
          .from(schema.campaignBudgetSettings)
          .where(
            and(
              eq(schema.campaignBudgetSettings.accountId, accountId),
              eq(schema.campaignBudgetSettings.campaignId, targetCampaignId)
            )
          )
          .limit(1);
        if (existingBudget) {
          await db
            .update(schema.campaignBudgetSettings)
            .set({
              monthlyBudget: finalBudget != null ? String(finalBudget) : null,
              currency: normCurrency,
              version: (existingBudget.version || 1) + 1,
              updatedAt: new Date(),
            })
            .where(eq(schema.campaignBudgetSettings.id, existingBudget.id));
        } else {
          await db.insert(schema.campaignBudgetSettings).values({
            accountId,
            campaignId: targetCampaignId,
            monthlyBudget: finalBudget != null ? String(finalBudget) : null,
            currency: normCurrency,
            version: 1,
          });
        }
      }
    }

    // 5. Reuse website snapshot for company context (without re-crawling if already available)
    const [existingCampWebsite] = await db
      .select()
      .from(schema.websiteSnapshots)
      .where(
        and(
          eq(schema.websiteSnapshots.accountId, accountId),
          eq(schema.websiteSnapshots.campaignId, targetCampaignId)
        )
      )
      .limit(1);

    if (!existingCampWebsite && latestWebsite) {
      await db.insert(schema.websiteSnapshots).values({
        id: "ws_" + uuidv4().slice(0, 10),
        accountId,
        campaignId: targetCampaignId,
        rootUrl: productUrl || businessRow?.websiteUrl || latestWebsite.rootUrl,
        pagesCrawled: latestWebsite.pagesCrawled,
        preliminaryExtraction: latestWebsite.preliminaryExtraction,
        contentHash: latestWebsite.contentHash,
        status: "SUCCESS",
      });
    }

    // 6. Create or update campaign offering & offering input evidence
    const [existingOffering] = await db
      .select()
      .from(schema.campaignOfferings)
      .where(
        and(
          eq(schema.campaignOfferings.accountId, accountId),
          eq(schema.campaignOfferings.campaignId, targetCampaignId)
        )
      )
      .limit(1);

    const evidenceId = "ev_" + uuidv4().slice(0, 10);
    const offeringId = existingOffering?.id || "off_" + uuidv4().slice(0, 10);

    const detailedNotes = [
      `[USER_CONFIRMED PRODUCT/SERVICE OFFERING]`,
      `Offering Name: ${finalProductName}`,
      `Offering Type: ${resolvedProductType}`,
      resolvedDescription ? `Description: ${resolvedDescription}` : null,
      productUrl ? `Product URL: ${productUrl}` : null,
      documentationText ? `Documentation / Specs: ${documentationText}` : null,
      resolvedCapabilities.length > 0 ? `Verified Capabilities: ${resolvedCapabilities.join("; ")}` : null,
      pricingModel ? `Pricing Model: ${pricingModel}` : null,
      purchaseModel ? `Purchase Model: ${purchaseModel}` : null,
      `Target Market: ${finalTargetMarket}`,
      `Campaign Goal: ${goalType || "LEADS"}`,
    ]
      .filter(Boolean)
      .join("\n");

    await db.insert(schema.offeringInputEvidence).values({
      id: evidenceId,
      accountId,
      campaignId: targetCampaignId,
      campaignOfferingId: offeringId,
      rawOfferingName: finalProductName,
      rawFeaturesAndNotes: detailedNotes,
      contentHash: "HASH_" + Date.now(),
      authorityType: "USER_CONFIRMED",
      confirmedAt: new Date(),
    });

    if (existingOffering) {
      await db
        .update(schema.campaignOfferings)
        .set({
          businessId,
          productId,
          offeringName: finalProductName,
          productType: resolvedProductType,
          productUrl: productUrl ? String(productUrl).trim() : null,
          documentationText: documentationText ? String(documentationText).trim() : null,
          verifiedCapabilities: resolvedCapabilities,
          pricingModel: pricingModel ? String(pricingModel).trim() : null,
          purchaseModel: purchaseModel ? String(purchaseModel).trim() : null,
          sourceInputEvidenceId: evidenceId,
        })
        .where(eq(schema.campaignOfferings.id, existingOffering.id));
    } else {
      await db.insert(schema.campaignOfferings).values({
        id: offeringId,
        accountId,
        campaignId: targetCampaignId,
        businessId,
        productId,
        offeringName: finalProductName,
        productType: resolvedProductType,
        productUrl: productUrl ? String(productUrl).trim() : null,
        documentationText: documentationText ? String(documentationText).trim() : null,
        verifiedCapabilities: resolvedCapabilities,
        pricingModel: pricingModel ? String(pricingModel).trim() : null,
        purchaseModel: purchaseModel ? String(purchaseModel).trim() : null,
        sourceInputEvidenceId: evidenceId,
      });
    }

    await db
      .update(schema.campaignSelections)
      .set({ campaignOfferingId: offeringId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.campaignSelections.accountId, accountId),
          eq(schema.campaignSelections.selectedCampaignId, targetCampaignId)
        )
      );

    // 7. Save relevant owned channels (reusing verified workspace channel snapshot if same platform/handle exists)
    if (Array.isArray(channels) && channels.length > 0) {
      for (const ch of channels) {
        if (!ch.platform || (!ch.handle && !ch.url)) continue;
        const platform = String(ch.platform).toLowerCase();
        const cleanHandle = String(ch.handle || "").trim().replace(/^@/, "");
        const cleanUrl =
          ch.url ||
          (platform === "website"
            ? cleanHandle.startsWith("http")
              ? cleanHandle
              : `https://${cleanHandle}`
            : `https://${platform}.com/${platform === "tiktok" ? "@" : ""}${cleanHandle}`);

        const [existingForCampaign] = await db
          .select()
          .from(schema.userPublicProfiles)
          .where(
            and(
              eq(schema.userPublicProfiles.accountId, accountId),
              eq(schema.userPublicProfiles.campaignId, targetCampaignId),
              eq(schema.userPublicProfiles.platform, platform)
            )
          )
          .limit(1);

        if (existingForCampaign) {
          await db
            .update(schema.userPublicProfiles)
            .set({
              handle: cleanHandle,
              url: cleanUrl,
              updatedAt: new Date(),
            })
            .where(eq(schema.userPublicProfiles.id, existingForCampaign.id));
        } else {
          await db.insert(schema.userPublicProfiles).values({
            id: "chan_" + uuidv4().slice(0, 10),
            accountId,
            campaignId: targetCampaignId,
            platform,
            handle: cleanHandle,
            url: cleanUrl,
            updatedAt: new Date(),
          });
        }
      }
    }

    // 8. Run fresh product-focused Business Understanding stage attributed to this campaign
    const buAuthorityId = await runWithAiCampaignContext(
      { accountId, campaignId: targetCampaignId, operationType: "business_understanding" },
      () => runBusinessUnderstandingEngine(accountId, targetCampaignId, offeringId)
    );

    const buResult = await resolveCurrentBusinessUnderstanding({
      accountId,
      campaignId: targetCampaignId,
      campaignOfferingId: offeringId,
    });

    return res.json({
      success: true,
      campaignId: targetCampaignId,
      businessId,
      productId,
      campaignOfferingId: offeringId,
      businessUnderstandingSnapshotId: buAuthorityId,
      businessUnderstanding: buResult?.snapshotRow
        ? {
            id: buResult.snapshotRow.id,
            status: buResult.snapshotRow.status,
            companyFacts: buResult.snapshotRow.companyFacts,
            productFacts: buResult.snapshotRow.productFacts,
            campaignChoices: buResult.snapshotRow.campaignChoices,
            evidenceProvenance: buResult.snapshotRow.evidenceProvenance,
            inputSnapshotVersion: buResult.snapshotRow.inputSnapshotVersion,
            dataReuseStatus: (buResult.snapshotRow.evidenceProvenance as any)?.dataReuseStatus || "NEWLY_ACQUIRED",
          }
        : null,
    });
  } catch (err: any) {
    console.error("[Setup] Create new campaign error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to create new campaign" });
  }
});

export function registerSetupRoutes(app: Express) {
  app.use("/api/setup", setupRouter);
}
