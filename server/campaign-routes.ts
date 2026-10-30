import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import {
  campaignSelections,
  adSpendEntries,
  performanceSnapshots,
  conversionEvents,
  manualCampaignMetrics,
  manualRetentionMetrics,
  iterationGateInputs,
  retentionGateInputs,
  strategyMemory,
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  growthCampaigns,
  businesses,
  businessProducts,
  campaignOfferings,
  campaignBudgetSettings,
  strategicPlans,
  planApprovals,
  businessUnderstandingSnapshots,
  competitorRelevanceDecisions,
  miRefreshSchedule,
  orchestratorJobs,
  businessExecutionStates,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getCampaignMetrics, getRevenueSummary, detectPerformanceSignals, getDashboardMetrics, resolveDataMode, getManualMetrics } from "./campaign-data-layer";
import {
  getAccountEntitlement,
  checkCampaignActivationEntitlement,
  setAccountEntitlementTier,
  getCampaignUsageLedger,
  type PackageTier,
} from "./entitlements";

import { resolveAccountId } from "./auth";
import { ProductAnchorSchema, parseProductAnchor, deriveAnchorFromProductDna } from "./shared/strategic-doctrine";
import { writeProductAnchorAudited } from "./shared/product-anchor-writer";
import { validateCapabilityCandidate } from "./shared/capability-registry";
import { loadProductDNA } from "./shared/product-dna";
import { getOpenEnrichmentRequests, getOpenEnrichmentRequest, markEnrichmentResolved } from "./dna-enrichment/store";
const VALID_GOAL_TYPES = ["LEADS", "AWARENESS", "RETARGETING", "SALES", "TESTING"] as const;

async function enrichCampaignSelections(accountId: string, selections: Array<typeof campaignSelections.$inferSelect>) {
  if (selections.length === 0) return [];

  const [bizRows, prodRows, offRows, budgetRows, planRows] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.accountId, accountId)),
    db.select().from(businessProducts).where(eq(businessProducts.accountId, accountId)),
    db.select().from(campaignOfferings).where(eq(campaignOfferings.accountId, accountId)),
    db.select().from(campaignBudgetSettings).where(eq(campaignBudgetSettings.accountId, accountId)),
    db
      .select({
        id: strategicPlans.id,
        campaignId: strategicPlans.campaignId,
        status: strategicPlans.status,
        version: strategicPlans.version,
        isDesignatedActive: strategicPlans.isDesignatedActive,
        createdAt: strategicPlans.createdAt,
      })
      .from(strategicPlans)
      .where(eq(strategicPlans.accountId, accountId))
      .orderBy(desc(strategicPlans.createdAt)),
  ]);

  const bizMap = new Map(bizRows.map((b) => [b.id, b]));
  const prodMap = new Map(prodRows.map((p) => [p.id, p]));
  const offByCampaign = new Map<string, typeof campaignOfferings.$inferSelect>();
  for (const off of offRows) {
    if (!offByCampaign.has(off.campaignId)) {
      offByCampaign.set(off.campaignId, off);
    }
  }
  const budgetByCampaign = new Map(budgetRows.map((b) => [b.campaignId, b]));

  const activePlanByCampaign = new Map<
    string,
    { id: string; status: string; version: number; isDesignatedActive: boolean }
  >();
  const latestPlanByCampaign = new Map<
    string,
    { id: string; status: string; version: number; isDesignatedActive: boolean }
  >();

  for (const p of planRows) {
    if (!latestPlanByCampaign.has(p.campaignId)) {
      latestPlanByCampaign.set(p.campaignId, p);
    }
    if (
      (p.isDesignatedActive || p.status === "APPROVED" || p.status === "EXECUTING") &&
      !activePlanByCampaign.has(p.campaignId)
    ) {
      activePlanByCampaign.set(p.campaignId, p);
    }
  }

  return selections.map((s) => {
    const cid = s.selectedCampaignId;
    const off = offByCampaign.get(cid);
    const biz = (s.businessId && bizMap.get(s.businessId)) || (off?.businessId && bizMap.get(off.businessId)) || bizRows[0] || null;
    const prod = (s.productId && prodMap.get(s.productId)) || (off?.productId && prodMap.get(off.productId)) || null;
    const budget = budgetByCampaign.get(cid) || null;
    const activePlan = activePlanByCampaign.get(cid) || null;
    const latestPlan = latestPlanByCampaign.get(cid) || null;

    const rawStatus = s.isArchived
      ? "archived"
      : s.campaignStatus === "paused"
      ? "paused"
      : s.setupStatus === "IN_PROGRESS" && !activePlan && !latestPlan
      ? "setup"
      : s.campaignStatus || "active";

    return {
      id: cid,
      name: s.selectedCampaignName,
      platform: s.selectedPlatform || "meta",
      goalType: s.campaignGoalType,
      status: rawStatus,
      campaignStatus: s.campaignStatus || "active",
      isArchived: Boolean(s.isArchived),
      location: s.campaignLocation || null,
      targetMarket: s.campaignLocation || null,
      dataSourceMode: s.dataSourceMode || "benchmark",
      businessId: biz?.id || s.businessId || null,
      businessName: biz?.name || null,
      businessReviewStatus: biz?.reviewStatus || "CONFIRMED",
      productId: prod?.id || s.productId || null,
      productName: prod?.name || off?.offeringName || s.selectedCampaignName,
      productType: prod?.productType || off?.productType || "PRODUCT",
      productDescription: prod?.description || off?.description || null,
      productUrl: prod?.productUrl || off?.productUrl || biz?.websiteUrl || null,
      productReviewStatus: prod?.reviewStatus || off?.reviewStatus || "CONFIRMED",
      campaignOfferingId: s.campaignOfferingId || off?.id || null,
      setupStatus: s.setupStatus || (activePlan || latestPlan ? "COMPLETE" : "IN_PROGRESS"),
      setupStep: s.setupStep || (activePlan || latestPlan ? "06_READY" : "01_BUSINESS"),
      activePlan: activePlan
        ? {
            id: activePlan.id,
            version: activePlan.version,
            status: activePlan.status,
            isDesignatedActive: activePlan.isDesignatedActive,
          }
        : latestPlan
        ? {
            id: latestPlan.id,
            version: latestPlan.version,
            status: latestPlan.status,
            isDesignatedActive: false,
          }
        : null,
      budget: budget
        ? {
            monthlyBudget: budget.monthlyBudget ? Number(budget.monthlyBudget) : null,
            currency: budget.currency || "USD",
          }
        : null,
      selectedAt: s.selectedAt,
      updatedAt: s.updatedAt,
    };
  });
}

export function registerCampaignRoutes(app: Express) {
  app.get("/api/campaigns", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const includeArchived = req.query.includeArchived === "true";

      const allSelections = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .orderBy(desc(campaignSelections.selectedAt));

      const filtered = includeArchived
        ? allSelections
        : allSelections.filter((s) => !s.isArchived);

      const [campaigns, entitlement] = await Promise.all([
        enrichCampaignSelections(accountId, filtered),
        getAccountEntitlement(accountId),
      ]);

      res.json({
        campaigns,
        entitlement,
        source: "db",
        message: campaigns.length > 0 ? "Campaigns loaded from database." : "No campaigns found. Select or create a campaign to get started.",
      });
    } catch (error: any) {
      console.error("[Campaigns] Error fetching campaigns:", error);
      res.status(500).json({ code: "LIST_FAILED", message: "Failed to fetch campaigns", requestId: `lst_${Date.now()}` });
    }
  });

  app.post("/api/campaigns/create", async (req, res) => {
    try {
      const { name, objective, location, platform, notes, dataSourceMode, productAnchor } = req.body;
      const accountId = resolveAccountId(req);
      const requestId = `crt_${Date.now()}`;

      if (!name || !name.trim()) {
        return res.status(400).json({ code: "MISSING_NAME", message: "Campaign name is required", requestId });
      }
      if (!objective) {
        return res.status(400).json({ code: "MISSING_OBJECTIVE", message: "Campaign objective is required", requestId });
      }
      if (!VALID_GOAL_TYPES.includes(objective)) {
        return res.status(400).json({
          code: "INVALID_OBJECTIVE",
          message: `Invalid objective. Must be one of: ${VALID_GOAL_TYPES.join(", ")}`,
          requestId,
        });
      }
      if (!location || !location.trim()) {
        return res.status(400).json({ code: "MISSING_LOCATION", message: "Campaign location is required", requestId });
      }

      // Phase 0 (AI Proposes / Code Validates): optional per-campaign product
      // anchor. Validated by the same Zod contract the doctrine layer reads. A
      // null/absent anchor leaves the run to degrade to business-level doctrine
      // (never a silent placeholder). An invalid anchor fails loud (D5).
      let resolvedAnchor: import("./shared/strategic-doctrine").ProductAnchor | null = null;
      if (productAnchor != null && typeof productAnchor === "object") {
        const anchorResult = ProductAnchorSchema.safeParse(productAnchor);
        if (!anchorResult.success) {
          return res.status(400).json({
            code: "INVALID_PRODUCT_ANCHOR",
            message: `Product anchor validation failed: ${anchorResult.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
            requestId,
          });
        }
        resolvedAnchor = anchorResult.data;
      }

      const validModes = ["campaign_metrics", "benchmark"];
      const resolvedMode = dataSourceMode && validModes.includes(dataSourceMode) ? dataSourceMode : "benchmark";

      const entCheck = await checkCampaignActivationEntitlement(accountId);
      if (!entCheck.allowed) {
        return res.status(403).json({
          code: "CAMPAIGN_LIMIT_REACHED",
          message: entCheck.reason,
          entitlement: entCheck.entitlement,
          suggestedUpgradeTier: entCheck.suggestedUpgradeTier,
          requestId,
        });
      }

      const campaignId = `campaign_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const campaignName = name.trim();

      const inserted = await db
        .insert(campaignSelections)
        .values({
          accountId,
          selectedCampaignId: campaignId,
          selectedCampaignName: campaignName,
          selectedPlatform: platform || "meta",
          campaignGoalType: objective,
          campaignStatus: "active",
          campaignLocation: location.trim(),
          dataSourceMode: resolvedMode,
          selectedAt: new Date(),
        })
        .returning();

      const selection = inserted[0];

      // Persist the product anchor onto growth_campaigns keyed by campaignId so
      // the orchestrator's doctrine-seed can read it (growth_campaigns is the
      // canonical table every engine keys off `eq(id, campaignId)`; a row is
      // created here only when an anchor is set). Tenant-safe: the campaignId was
      // just minted for this account's campaignSelections row above.
      if (resolvedAnchor) {
        await writeProductAnchorAudited({
          campaignId,
          campaignName,
          accountId,
          writer: "POST /api/campaigns/create",
          source: "campaign_create",
          reason: "user supplied product anchor at campaign creation",
          newAnchor: resolvedAnchor,
          validationDecision: "SCHEMA_VALID",
        });
        console.log(`[Campaigns] Product anchor set: campaign=${campaignId}`);
      }

      console.log(`[Campaigns] Campaign created: ${campaignName} (${objective}) id=${campaignId} account=${accountId}`);

      res.json({
        success: true,
        requestId,
        campaign: {
          id: campaignId,
          name: campaignName,
          platform: platform || "meta",
          goalType: objective,
          status: "active",
          location: location.trim(),
          dataSourceMode: resolvedMode,
        },
        selection,
        message: "Campaign created and auto-selected",
      });
    } catch (error: any) {
      console.error("[Campaigns] Create campaign error:", error);
      res.status(500).json({ code: "CREATE_FAILED", message: "Failed to create campaign", requestId: `crt_err_${Date.now()}` });
    }
  });

  // Phase 0 (AI Proposes / Code Validates): read the current product anchor for
  // an owned campaign so the edit UI can pre-fill. Tenant-scoped — ownership is
  // proven by the account's own campaign_selections row before growth_campaigns
  // (which has no accountId) is read (NO-TENANT-LEAK).
  app.get("/api/campaigns/:campaignId/product-anchor", async (req, res) => {
    const requestId = `paget_${Date.now()}`;
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;

      const [owned] = await db
        .select({ name: campaignSelections.selectedCampaignName })
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId),
          ),
        )
        .limit(1);
      if (!owned) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found for this account", requestId });
      }

      const [row] = await db
        .select({ productAnchor: growthCampaigns.productAnchor })
        .from(growthCampaigns)
        .where(eq(growthCampaigns.id, campaignId))
        .limit(1);

      res.json({ productAnchor: parseProductAnchor(row?.productAnchor ?? null), requestId });
    } catch (error: any) {
      console.error("[Campaigns] Get product anchor error:", error);
      res.status(500).json({ code: "ANCHOR_GET_FAILED", message: "Failed to fetch product anchor", requestId });
    }
  });

  // Set/edit/clear the product anchor for an owned campaign. Editing the anchor
  // changes the doctrine hash salt, so cached engine snapshots for this campaign
  // are invalidated on the next run. `productAnchor: null` explicitly clears it
  // (degrade to business-level doctrine) — never a silent substitution (D5).
  app.put("/api/campaigns/:campaignId/product-anchor", async (req, res) => {
    const requestId = `paput_${Date.now()}`;
    try {
      const accountId = resolveAccountId(req);
      const { campaignId } = req.params;
      const { productAnchor } = req.body;

      const [owned] = await db
        .select({ name: campaignSelections.selectedCampaignName })
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId),
          ),
        )
        .limit(1);
      if (!owned) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found for this account", requestId });
      }

      // Explicit clear.
      if (productAnchor === null) {
        await writeProductAnchorAudited({
          campaignId,
          campaignName: owned.name,
          accountId,
          writer: "PUT /api/campaigns/:campaignId/product-anchor",
          source: "user_clear",
          reason: typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : "user cleared product anchor",
          newAnchor: null,
          validationDecision: "CLEARED",
        });
        console.log(`[Campaigns] Product anchor cleared: campaign=${campaignId} account=${accountId}`);
        return res.json({ success: true, productAnchor: null, requestId });
      }

      if (productAnchor == null || typeof productAnchor !== "object") {
        return res.status(400).json({ code: "MISSING_PRODUCT_ANCHOR", message: "Provide a productAnchor object to set, or null to clear", requestId });
      }

      const anchorResult = ProductAnchorSchema.safeParse(productAnchor);
      if (!anchorResult.success) {
        return res.status(400).json({
          code: "INVALID_PRODUCT_ANCHOR",
          message: `Product anchor validation failed: ${anchorResult.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
          requestId,
        });
      }
      const resolvedAnchor = anchorResult.data;

      await writeProductAnchorAudited({
        campaignId,
        campaignName: owned.name,
        accountId,
        writer: "PUT /api/campaigns/:campaignId/product-anchor",
        source: "user_edit",
        reason: typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : "user edited product anchor",
        newAnchor: resolvedAnchor,
        validationDecision: "USER_CONFIRMED",
      });
      console.log(`[Campaigns] Product anchor updated: campaign=${campaignId} account=${accountId}`);

      res.json({ success: true, productAnchor: resolvedAnchor, requestId });
    } catch (error: any) {
      console.error("[Campaigns] Update product anchor error:", error);
      res.status(500).json({ code: "ANCHOR_UPDATE_FAILED", message: "Failed to update product anchor", requestId });
    }
  });

  // ── DNA Enrichment Gate (Path B) — operator surface ──
  // When the Positioning/Offer interchangeability judge keeps rejecting a generic,
  // reused strategy because the Product DNA carries no proprietary differentiator,
  // the orchestrator raises an open dna_enrichment_requests row. These two routes
  // let the campaign owner see the grounded suggestion and confirm/edit the
  // differentiator, which is written durably onto the product anchor so the
  // UNCHANGED judge can re-pass on the next run (candidate-only, no bypass).
  //
  // Tenant isolation: ownership proven via the account's own campaign_selections
  // row BEFORE any growth_campaigns / dna_enrichment_requests access (NO-TENANT-LEAK).
  app.get("/api/dna-enrichment/pending", async (req, res) => {
    const requestId = `dnapend_${Date.now()}`;
    try {
      const accountId = resolveAccountId(req);
      const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : "";
      if (!campaignId) {
        return res.status(400).json({ code: "MISSING_CAMPAIGN", message: "campaignId query param is required", requestId });
      }

      const [owned] = await db
        .select({ name: campaignSelections.selectedCampaignName })
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId),
          ),
        )
        .limit(1);
      if (!owned) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found for this account", requestId });
      }

      const open = await getOpenEnrichmentRequests(accountId, campaignId);
      // Customer-safe projection — no internal row ids, accountId, or status strings.
      const requests = open.map((r) => ({
        engineKind: r.engineKind,
        suggestionText: r.suggestionText,
        candidateDifferentiator: r.candidateDifferentiator,
        groundingRefs: r.groundingRefs,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
      res.json({ success: true, requests, requestId });
    } catch (error: any) {
      console.error("[DnaEnrichment] Pending fetch error:", error);
      res.status(500).json({ code: "DNA_PENDING_FAILED", message: "Failed to fetch pending DNA enrichment requests", requestId });
    }
  });

  app.post("/api/dna-enrichment/resolve", async (req, res) => {
    const requestId = `dnares_${Date.now()}`;
    try {
      const accountId = resolveAccountId(req);
      const { campaignId, engineKind, differentiatingFeature } = req.body;

      if (!campaignId || typeof campaignId !== "string") {
        return res.status(400).json({ code: "MISSING_CAMPAIGN", message: "campaignId is required", requestId });
      }
      if (engineKind !== "positioning_claim" && engineKind !== "offer") {
        return res.status(400).json({ code: "INVALID_ENGINE_KIND", message: "engineKind must be 'positioning_claim' or 'offer'", requestId });
      }
      if (typeof differentiatingFeature !== "string" || differentiatingFeature.trim().length === 0) {
        return res.status(400).json({ code: "MISSING_DIFFERENTIATOR", message: "differentiatingFeature is required", requestId });
      }
      const confirmed = differentiatingFeature.trim();

      const [owned] = await db
        .select({ name: campaignSelections.selectedCampaignName })
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId),
          ),
        )
        .limit(1);
      if (!owned) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found for this account", requestId });
      }

      // Fail-closed: there MUST be a live open request. Never silently mint/patch
      // a product anchor without an active enrichment prompt for this engine.
      const open = await getOpenEnrichmentRequest({ accountId, campaignId, engineKind });
      if (!open) {
        return res.status(404).json({ code: "NO_OPEN_REQUEST", message: "No open DNA enrichment request for this campaign and engine", requestId });
      }

      // Load the current anchor; if absent, derive a base from Product DNA (F5a).
      // The operator-confirmed differentiator overrides differentiatingFeature.
      const [row] = await db
        .select({ productAnchor: growthCampaigns.productAnchor })
        .from(growthCampaigns)
        .where(eq(growthCampaigns.id, campaignId))
        .limit(1);
      let baseAnchor = parseProductAnchor(row?.productAnchor ?? null);
      if (!baseAnchor) {
        const dna = await loadProductDNA(campaignId, accountId);
        baseAnchor = deriveAnchorFromProductDna(dna);
      }
      if (!baseAnchor) {
        // D5 — never fabricate name/type/coreProblemSolved. Require a full anchor first.
        return res.status(409).json({
          code: "ANCHOR_INCOMPLETE",
          message: "No product anchor exists and Product DNA is insufficient to derive one. Set a full product anchor (name, type, core problem) before confirming a differentiator.",
          requestId,
        });
      }

      const nextAnchor = { ...baseAnchor, differentiatingFeature: confirmed };
      const anchorResult = ProductAnchorSchema.safeParse(nextAnchor);
      if (!anchorResult.success) {
        return res.status(400).json({
          code: "INVALID_PRODUCT_ANCHOR",
          message: `Product anchor validation failed: ${anchorResult.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
          requestId,
        });
      }
      const resolvedAnchor = anchorResult.data;

      // AUTHORITY-MODEL LIFECYCLE: a derived strategic inference is only a
      // CANDIDATE capability. Before it can become Product Identity it is
      // compared against authoritative product/business evidence:
      //   ACCEPT → write; REJECT / NEEDS_USER_CONFIRMATION → the operator must
      //   explicitly re-confirm with confirmUnverified=true (recorded in the
      //   audit trail as USER_CONFIRMED_UNVERIFIED). No automatic promotion of
      //   strategy-derived language into the capability namespace.
      const dnaForValidation = await loadProductDNA(campaignId, accountId);
      const candidateValidation = validateCapabilityCandidate({
        candidate: confirmed,
        authoritativeFields: {
          "dna.uniqueMechanism": dnaForValidation?.uniqueMechanism ?? null,
          "dna.strategicAdvantage": dnaForValidation?.strategicAdvantage ?? null,
          "dna.coreOffer": dnaForValidation?.coreOffer ?? null,
          "dna.coreProblemSolved": dnaForValidation?.coreProblemSolved ?? null,
          "dna.productCategory": dnaForValidation?.productCategory ?? null,
          "anchor.name": baseAnchor.name,
          "anchor.type": baseAnchor.type,
          "anchor.keyAttributes": (baseAnchor.keyAttributes ?? []).join(" "),
          "anchor.coreProblemSolved": baseAnchor.coreProblemSolved,
        },
      });
      const confirmUnverified = req.body.confirmUnverified === true;
      if (candidateValidation.decision !== "ACCEPT" && !confirmUnverified) {
        console.log(
          `[DnaEnrichment] CANDIDATE_${candidateValidation.decision} | campaign=${campaignId} | engine=${engineKind} | support=${candidateValidation.supportScore} | ${candidateValidation.reason}`,
        );
        return res.status(409).json({
          code: "CAPABILITY_CANDIDATE_UNVERIFIED",
          decision: candidateValidation.decision,
          supportScore: candidateValidation.supportScore,
          message: `This differentiator is not sufficiently supported by authoritative product evidence (${candidateValidation.reason}). If it is genuinely true of your product, resubmit with confirmUnverified=true to record your explicit confirmation.`,
          requestId,
        });
      }

      await writeProductAnchorAudited({
        campaignId,
        campaignName: owned.name,
        accountId,
        writer: "POST /api/dna-enrichment/resolve",
        source: "dna_enrichment_resolve",
        reason: `operator confirmed ${engineKind} enrichment differentiator (support=${candidateValidation.supportScore}; ${candidateValidation.reason})`,
        newAnchor: resolvedAnchor,
        validationDecision:
          candidateValidation.decision === "ACCEPT" ? "ACCEPT" : "USER_CONFIRMED_UNVERIFIED",
      });

      await markEnrichmentResolved({ accountId, campaignId, engineKind });
      console.log(`[DnaEnrichment] RESOLVED | campaign=${campaignId} | engine=${engineKind} | account=${accountId}`);

      res.json({ success: true, productAnchor: resolvedAnchor, requestId });
    } catch (error: any) {
      console.error("[DnaEnrichment] Resolve error:", error);
      res.status(500).json({ code: "DNA_RESOLVE_FAILED", message: "Failed to resolve DNA enrichment request", requestId });
    }
  });

  app.post("/api/campaigns/select", async (req, res) => {
    try {
      const { campaignId, campaignName, platform, goalType, campaignLocation } = req.body;
      const accountId = resolveAccountId(req);

      const requestId = `sel_${Date.now()}`;
      if (!campaignId || !campaignName || !goalType) {
        return res.status(400).json({ code: "MISSING_FIELDS", message: "campaignId, campaignName, and goalType are required", requestId });
      }

      if (!VALID_GOAL_TYPES.includes(goalType)) {
        return res.status(400).json({
          code: "INVALID_GOAL_TYPE",
          message: `Invalid goalType. Must be one of: ${VALID_GOAL_TYPES.join(", ")}`,
          requestId,
        });
      }

      const existing = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);

      let selection;
      if (existing.length > 0) {
        const currentRow = existing[0];
        const updated = await db
          .update(campaignSelections)
          .set({
            selectedCampaignName: campaignName || currentRow.selectedCampaignName,
            selectedPlatform: platform || currentRow.selectedPlatform || "meta",
            campaignGoalType: goalType || currentRow.campaignGoalType,
            campaignStatus: currentRow.campaignStatus || "active",
            campaignLocation: campaignLocation !== undefined ? campaignLocation : currentRow.campaignLocation,
            selectedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(campaignSelections.accountId, accountId),
              eq(campaignSelections.selectedCampaignId, campaignId)
            )
          )
          .returning();
        selection = updated[0];
      } else {
        // NO-TENANT-LEAK: refuse to claim a campaignId already owned by a
        // DIFFERENT account.
        const claimedByOther = await db
          .select({ ownerAccountId: campaignSelections.accountId })
          .from(campaignSelections)
          .where(eq(campaignSelections.selectedCampaignId, campaignId))
          .limit(1);
        if (claimedByOther.length > 0 && claimedByOther[0].ownerAccountId !== accountId) {
          return res.status(409).json({ code: "CAMPAIGN_ID_CLAIMED", message: "This campaign belongs to another account", requestId });
        }

        const entCheck = await checkCampaignActivationEntitlement(accountId, campaignId);
        if (!entCheck.allowed) {
          return res.status(403).json({
            code: "CAMPAIGN_LIMIT_REACHED",
            message: entCheck.reason,
            entitlement: entCheck.entitlement,
            suggestedUpgradeTier: entCheck.suggestedUpgradeTier,
            requestId,
          });
        }

        const inserted = await db
          .insert(campaignSelections)
          .values({
            accountId,
            selectedCampaignId: campaignId,
            selectedCampaignName: campaignName,
            selectedPlatform: platform || "meta",
            campaignGoalType: goalType,
            campaignStatus: "active",
            campaignLocation: campaignLocation || null,
          })
          .returning();
        selection = inserted[0];
      }

      const [enriched] = await enrichCampaignSelections(accountId, [selection]);

      console.log(`[Campaigns] Campaign selected: ${campaignName} (${goalType}) for account ${accountId}`);

      res.json({
        success: true,
        selection: {
          ...selection,
          ...enriched,
        },
      });
    } catch (error: any) {
      console.error("[Campaigns] Error selecting campaign:", error);
      res.status(500).json({ code: "SELECT_FAILED", message: "Failed to select campaign", requestId: `sel_err_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/selected", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const requestedCampaignId = typeof req.query.campaignId === "string" ? req.query.campaignId.trim() : "";

      let selections;
      if (requestedCampaignId) {
        selections = await db
          .select()
          .from(campaignSelections)
          .where(
            and(
              eq(campaignSelections.accountId, accountId),
              eq(campaignSelections.selectedCampaignId, requestedCampaignId)
            )
          )
          .limit(1);
      } else {
        selections = await db
          .select()
          .from(campaignSelections)
          .where(
            and(
              eq(campaignSelections.accountId, accountId),
              eq(campaignSelections.isArchived, false)
            )
          )
          .orderBy(desc(campaignSelections.selectedAt))
          .limit(1);
      }

      if (selections.length === 0) {
        return res.json({
          selected: false,
          selection: null,
          warning: null,
        });
      }

      const selection = selections[0];
      const [enriched] = await enrichCampaignSelections(accountId, [selection]);

      let warning = null;
      const campaignStatus = selection.campaignStatus || "active";

      if (campaignStatus === "paused" || campaignStatus === "removed") {
        warning = {
          type: "CAMPAIGN_PAUSED",
          message: `Campaign "${selection.selectedCampaignName}" is currently ${campaignStatus}. Recurring background acquisition is paused.`,
          campaignStatus,
        };
      }

      res.json({
        selected: true,
        selection: {
          ...selection,
          ...enriched,
        },
        warning,
      });
    } catch (error: any) {
      console.error("[Campaigns] Error fetching selection:", error);
      res.status(500).json({ code: "SELECTION_FETCH_FAILED", message: "Failed to fetch selected campaign", requestId: `sel_get_${Date.now()}` });
    }
  });

  app.delete("/api/campaigns/selected", async (req, res) => {
    try {
      // Multi-campaign safety: NEVER delete campaign_selections rows when clearing client selection!
      res.json({ success: true, message: "Campaign selection state cleared without deleting workspace campaigns" });
    } catch (error: any) {
      console.error("[Campaigns] Error clearing selection:", error);
      res.status(500).json({ code: "CLEAR_FAILED", message: "Failed to clear campaign selection", requestId: `clr_${Date.now()}` });
    }
  });

  // Pause, resume, or archive a specific campaign (Requirement 1 & 7 & 8)
  app.post("/api/campaigns/:campaignId/status", async (req: Request, res: Response) => {
    const requestId = `cstatus_${Date.now()}`;
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");
      const { status } = req.body as { status?: "active" | "paused" | "archived" };

      if (!campaignId || !status || !["active", "paused", "archived"].includes(status)) {
        return res.status(400).json({
          code: "INVALID_STATUS",
          message: "status must be one of: active, paused, archived",
          requestId,
        });
      }

      const [existing] = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found in this workspace", requestId });
      }

      if (status === "active" && existing.campaignStatus !== "active") {
        const entCheck = await checkCampaignActivationEntitlement(accountId, campaignId);
        if (!entCheck.allowed) {
          return res.status(403).json({
            code: "CAMPAIGN_LIMIT_REACHED",
            message: entCheck.reason,
            entitlement: entCheck.entitlement,
            suggestedUpgradeTier: entCheck.suggestedUpgradeTier,
            requestId,
          });
        }
      }

      const isArchived = status === "archived";
      const nextCampaignStatus = status === "archived" ? "paused" : status;

      const [updated] = await db
        .update(campaignSelections)
        .set({
          campaignStatus: nextCampaignStatus,
          isArchived,
          pausedAt: nextCampaignStatus === "paused" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .returning();

      // Stop or resume recurring scheduled competitor refreshes for THIS campaign only
      await db
        .update(miRefreshSchedule)
        .set({
          status: nextCampaignStatus === "active" ? "active" : "paused",
        })
        .where(
          and(
            eq(miRefreshSchedule.accountId, accountId),
            eq(miRefreshSchedule.campaignId, campaignId)
          )
        );

      const [enriched] = await enrichCampaignSelections(accountId, [updated]);
      const entitlement = await getAccountEntitlement(accountId);

      res.json({
        success: true,
        campaign: enriched,
        entitlement,
        message:
          status === "paused"
            ? `Campaign "${updated.selectedCampaignName}" paused. Recurring background acquisition stopped for this campaign.`
            : status === "archived"
            ? `Campaign "${updated.selectedCampaignName}" archived.`
            : `Campaign "${updated.selectedCampaignName}" resumed and active.`,
      });
    } catch (error: any) {
      console.error("[Campaigns] Error updating campaign status:", error);
      res.status(500).json({ code: "STATUS_UPDATE_FAILED", message: error.message || "Failed to update campaign status", requestId });
    }
  });

  // Entitlements inspection & proposed package tier configuration (Requirement 8)
  app.get("/api/campaigns/entitlements", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const entitlement = await getAccountEntitlement(accountId);
      res.json({ success: true, entitlement });
    } catch (error: any) {
      res.status(500).json({ code: "ENTITLEMENTS_FAILED", message: error.message });
    }
  });

  app.post("/api/campaigns/entitlements", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const isOperatorAdmin =
        Boolean((req as any).user?.isAdmin) ||
        Boolean(
          process.env.OPERATOR_ADMIN_TOKEN &&
            req.header("x-admin-token") === process.env.OPERATOR_ADMIN_TOKEN
        );

      if (process.env.NODE_ENV === "production" && !isOperatorAdmin) {
        return res.status(403).json({
          code: "ENTITLEMENT_MUTATION_FORBIDDEN_IN_PROD",
          message:
            "Entitlement tier changes in production require operator/admin authorization or verified billing integration.",
        });
      }

      const { packageTier, isTestEntitlement, notes, maxActiveOverride } = req.body as {
        packageTier?: PackageTier;
        isTestEntitlement?: boolean;
        notes?: string;
        maxActiveOverride?: number;
      };
      if (!packageTier || !["starter", "growth", "agency", "test_isolated"].includes(packageTier)) {
        return res.status(400).json({
          code: "INVALID_PACKAGE_TIER",
          message: "packageTier must be one of: starter, growth, agency, test_isolated",
        });
      }
      if (process.env.NODE_ENV === "production" && packageTier === "test_isolated" && !isOperatorAdmin) {
        return res.status(403).json({
          code: "TEST_ENTITLEMENT_FORBIDDEN_IN_PROD",
          message: "test_isolated entitlement is restricted in production.",
        });
      }
      const entitlement = await setAccountEntitlementTier(accountId, packageTier, {
        isTestEntitlement,
        notes,
        maxActiveOverride,
      });
      res.json({
        success: true,
        entitlement,
        message: `Workspace package entitlement set to ${entitlement.displayName} (${entitlement.maxActiveCampaigns} active campaigns max).`,
      });
    } catch (error: any) {
      res.status(500).json({ code: "ENTITLEMENT_UPDATE_FAILED", message: error.message });
    }
  });

  // Per-campaign usage & cost attribution ledger (Requirement 8)
  app.get("/api/campaigns/:campaignId/usage-ledger", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");
      const [owned] = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);
      if (!owned) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found for this account" });
      }
      const ledger = await getCampaignUsageLedger(accountId, campaignId);
      res.json({ success: true, ledger });
    } catch (error: any) {
      res.status(500).json({ code: "USAGE_LEDGER_FAILED", message: error.message });
    }
  });

  // Per-campaign competitor relevance decisions (Requirement 3 & 4)
  app.get("/api/campaigns/:campaignId/competitor-relevance", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");
      const decisions = await db
        .select()
        .from(competitorRelevanceDecisions)
        .where(
          and(
            eq(competitorRelevanceDecisions.accountId, accountId),
            eq(competitorRelevanceDecisions.campaignId, campaignId)
          )
        )
        .orderBy(desc(competitorRelevanceDecisions.updatedAt));
      res.json({ success: true, campaignId, decisions });
    } catch (error: any) {
      res.status(500).json({ code: "COMPETITOR_RELEVANCE_FAILED", message: error.message });
    }
  });

  // Full end-to-end campaign lineage trace (Requirement 5 & 10)
  app.get("/api/campaigns/:campaignId/trace", async (req: Request, res: Response) => {
    try {
      const accountId = resolveAccountId(req);
      const campaignId = String(req.params.campaignId || "");

      const [selection] = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, campaignId)
          )
        )
        .limit(1);

      if (!selection) {
        return res.status(404).json({ code: "CAMPAIGN_NOT_FOUND", message: "Campaign not found" });
      }

      const [enriched] = await enrichCampaignSelections(accountId, [selection]);

      const [
        businessRow,
        productRow,
        offeringRow,
        buSnapshots,
        relevanceDecisions,
        jobs,
        plans,
        execStates,
        usageLedger,
      ] = await Promise.all([
        enriched.businessId
          ? db.select().from(businesses).where(eq(businesses.id, enriched.businessId)).limit(1)
          : Promise.resolve([]),
        enriched.productId
          ? db.select().from(businessProducts).where(eq(businessProducts.id, enriched.productId)).limit(1)
          : Promise.resolve([]),
        db
          .select()
          .from(campaignOfferings)
          .where(and(eq(campaignOfferings.accountId, accountId), eq(campaignOfferings.campaignId, campaignId)))
          .orderBy(desc(campaignOfferings.createdAt))
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
        db
          .select()
          .from(competitorRelevanceDecisions)
          .where(
            and(
              eq(competitorRelevanceDecisions.accountId, accountId),
              eq(competitorRelevanceDecisions.campaignId, campaignId)
            )
          )
          .orderBy(desc(competitorRelevanceDecisions.createdAt)),
        db
          .select({
            id: orchestratorJobs.id,
            status: orchestratorJobs.status,
            planId: orchestratorJobs.planId,
            createdAt: orchestratorJobs.createdAt,
            completedAt: orchestratorJobs.completedAt,
          })
          .from(orchestratorJobs)
          .where(and(eq(orchestratorJobs.accountId, accountId), eq(orchestratorJobs.campaignId, campaignId)))
          .orderBy(desc(orchestratorJobs.createdAt))
          .limit(5),
        db
          .select({
            id: strategicPlans.id,
            version: strategicPlans.version,
            status: strategicPlans.status,
            isDesignatedActive: strategicPlans.isDesignatedActive,
            rootBundleId: strategicPlans.rootBundleId,
            createdAt: strategicPlans.createdAt,
          })
          .from(strategicPlans)
          .where(and(eq(strategicPlans.accountId, accountId), eq(strategicPlans.campaignId, campaignId)))
          .orderBy(desc(strategicPlans.createdAt))
          .limit(5),
        db
          .select({
            id: businessExecutionStates.id,
            mode: businessExecutionStates.mode,
            primaryBottleneck: businessExecutionStates.primaryBottleneck,
            status: businessExecutionStates.status,
            createdAt: businessExecutionStates.createdAt,
          })
          .from(businessExecutionStates)
          .where(
            and(
              eq(businessExecutionStates.accountId, accountId),
              eq(businessExecutionStates.campaignId, campaignId)
            )
          )
          .orderBy(desc(businessExecutionStates.createdAt))
          .limit(3),
        getCampaignUsageLedger(accountId, campaignId),
      ]);

      res.json({
        success: true,
        trace: {
          accountId,
          business: businessRow[0] || null,
          product: productRow[0] || null,
          campaign: enriched,
          offering: offeringRow[0] || null,
          understandingSnapshot: buSnapshots[0]
            ? {
                id: buSnapshots[0].id,
                version: buSnapshots[0].version,
                status: buSnapshots[0].status,
                websiteSnapshotId: buSnapshots[0].websiteSnapshotId,
                offeringInputEvidenceId: buSnapshots[0].offeringInputEvidenceId,
                campaignOfferingId: buSnapshots[0].campaignOfferingId,
                companyFacts: buSnapshots[0].companyFacts,
                productFacts: buSnapshots[0].productFacts,
                campaignChoices: buSnapshots[0].campaignChoices,
                evidenceProvenance: buSnapshots[0].evidenceProvenance,
                inputSnapshotVersion: buSnapshots[0].inputSnapshotVersion,
                createdAt: buSnapshots[0].createdAt,
              }
            : null,
          competitorRelevanceDecisions: relevanceDecisions,
          strategyRuns: jobs,
          plans,
          activePlan: plans.find((p) => p.isDesignatedActive || p.status === "APPROVED") || null,
          monitoringAndPerformance: {
            executionStates: execStates,
          },
          usageLedger,
        },
      });
    } catch (error: any) {
      res.status(500).json({ code: "TRACE_FAILED", message: error.message });
    }
  });

  app.delete("/api/campaigns/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const requestId = `del_${Date.now()}`;

      if (!campaignId) {
        return res.status(400).json({ code: "MISSING_ID", message: "Campaign ID is required", requestId });
      }

      const existing = await db.select().from(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId)
        ))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ code: "NOT_FOUND", message: "Campaign not found", requestId });
      }

      await db.delete(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ));

      await db.delete(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ));

      await db.delete(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ));

      await db.delete(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ));

      await db.delete(campaignSelections)
        .where(and(
          eq(campaignSelections.selectedCampaignId, campaignId),
          eq(campaignSelections.accountId, accountId)
        ));

      console.log(`[Campaigns] Campaign deleted: ${campaignId} account=${accountId}`);

      res.json({
        success: true,
        requestId,
        deletedCampaignId: campaignId,
        message: "Campaign deleted successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Delete campaign error:", error);
      res.status(500).json({ code: "DELETE_FAILED", message: "Failed to delete campaign", requestId: `del_err_${Date.now()}` });
    }
  });

  app.get("/api/dashboard/metrics", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = resolveAccountId(req);
      const dashboardMetrics = await getDashboardMetrics(campaignContext.campaignId, accountId);

      // D2/D3 — additive projection fields for Diagnose/Monitor consumers.
      // dataSource ∈ {META|MANUAL|PLAN|NONE} is the canonical truth — derive validationState from it.
      let validationState: "validated" | "provisional" | "weak" | "rejected" | "unknown" = "unknown";
      if (dashboardMetrics.dataSource === "META") validationState = "validated";
      else if (dashboardMetrics.dataSource === "MANUAL") validationState = "provisional";
      else if (dashboardMetrics.dataSource === "PLAN") validationState = "provisional";
      else if (dashboardMetrics.dataSource === "NONE") validationState = "weak";
      const signalOrigin: "real" | "inferred" | "fallback" | "unknown" =
        dashboardMetrics.dataSource === "META" ? "real" :
        dashboardMetrics.dataSource === "MANUAL" ? "real" :
        dashboardMetrics.dataSource === "PLAN" ? "inferred" :
        dashboardMetrics.dataSource === "NONE" ? "unknown" : "unknown";
      const degraded = (dashboardMetrics.dataSource === "NONE" || dashboardMetrics.dataSource === "PLAN")
        ? { flag: true as const, reason: dashboardMetrics.dataSource === "NONE" ? "No revenue data connected" : "Metrics derived from plan, not measured outcomes", source: "data_quality", signalOrigin }
        : null;

      res.json({ success: true, ...dashboardMetrics, validationState, signalOrigin, degraded, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Dashboard] Metrics error:", error);
      res.status(500).json({ code: "DASHBOARD_FAILED", message: "Failed to fetch dashboard metrics", requestId: `dash_${Date.now()}` });
    }
  });

  app.get("/api/dashboard/mode", async (req, res) => {
    try {
      const accountId = resolveAccountId(req);
      const mode = await resolveDataMode(accountId);
      res.json({ success: true, mode });
    } catch (error: any) {
      console.error("[Dashboard] Mode check error:", error);
      res.status(500).json({ code: "MODE_CHECK_FAILED", message: "Failed to check mode", requestId: `mode_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/metrics", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = resolveAccountId(req);
      const metrics = await getCampaignMetrics(campaignContext.campaignId, accountId);
      res.json({ success: true, metrics, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Campaigns] Metrics error:", error);
      res.status(500).json({ code: "METRICS_FAILED", message: "Failed to fetch campaign metrics", requestId: `met_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/signals", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = resolveAccountId(req);
      const signals = await detectPerformanceSignals(campaignContext.campaignId, accountId);
      const scaleSignals = signals.filter(s => s.signalType === "SCALE_CANDIDATE");
      const reviewSignals = signals.filter(s => s.signalType === "REVIEW_NEEDED");
      const normalVariation = signals.filter(s => s.signalType === "NORMAL_VARIATION");
      const lowConfidence = signals.filter(s => s.signalType === "LOW_CONFIDENCE");
      const actionable = signals.filter(s => s.signalType === "SCALE_CANDIDATE" || s.signalType === "REVIEW_NEEDED");
      res.json({
        success: true,
        campaign: campaignContext,
        signals,
        summary: {
          totalSignals: signals.length,
          actionableSignals: actionable.length,
          scaleOpportunities: scaleSignals.length,
          reviewNeeded: reviewSignals.length,
          normalVariation: normalVariation.length,
          lowConfidence: lowConfidence.length,
        },
      });
    } catch (error: any) {
      console.error("[Campaigns] Signals error:", error);
      res.status(500).json({ code: "SIGNALS_FAILED", message: "Failed to detect performance signals", requestId: `sig_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/revenue-summary", requireCampaign, async (req, res) => {
    try {
      const campaignContext = (req as any).campaignContext;
      const accountId = resolveAccountId(req);
      const summary = await getRevenueSummary(campaignContext.campaignId, accountId);
      res.json({ success: true, summary, campaign: campaignContext });
    } catch (error: any) {
      console.error("[Campaigns] Revenue summary error:", error);
      res.status(500).json({ code: "REVENUE_FAILED", message: "Failed to fetch revenue summary", requestId: `rev_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/:campaignId/manual-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const metrics = await getManualMetrics(campaignId, accountId);
      if (!metrics) {
        return res.json({ success: true, metrics: null, message: "No manual metrics entered yet" });
      }
      const cpa = metrics.conversions > 0 ? +(metrics.spend / metrics.conversions).toFixed(2) : 0;
      const roas = metrics.spend > 0 ? +(metrics.revenue / metrics.spend).toFixed(2) : 0;
      res.json({
        success: true,
        metrics: { ...metrics, cpa, roas },
      });
    } catch (error: any) {
      console.error("[Campaigns] Manual metrics GET error:", error);
      res.status(500).json({ code: "MANUAL_METRICS_FAILED", message: "Failed to fetch manual metrics", requestId: `mm_get_${Date.now()}` });
    }
  });

  app.put("/api/campaigns/:campaignId/manual-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const { spend, revenue, leads, conversions, impressions, clicks } = req.body;

      if (spend === undefined && revenue === undefined && leads === undefined && conversions === undefined && impressions === undefined && clicks === undefined) {
        return res.status(400).json({ code: "MISSING_METRICS", message: "At least one metric field is required", requestId: `mm_${Date.now()}` });
      }

      const existing = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const parseMetric = (v: any) => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };

      const existingRecord = existing[0];
      const data: any = {
        spend: spend !== undefined ? (parseMetric(spend) ?? 0) : (existingRecord?.spend ?? 0),
        revenue: revenue !== undefined ? (parseMetric(revenue) ?? 0) : (existingRecord?.revenue ?? 0),
        leads: leads !== undefined ? (parseMetric(leads) ?? 0) : (existingRecord?.leads ?? 0),
        conversions: conversions !== undefined ? (parseMetric(conversions) ?? 0) : (existingRecord?.conversions ?? 0),
        impressions: impressions !== undefined ? (parseMetric(impressions) ?? 0) : (existingRecord?.impressions ?? 0),
        clicks: clicks !== undefined ? (parseMetric(clicks) ?? 0) : (existingRecord?.clicks ?? 0),
        updatedAt: new Date(),
      };

      let result;
      if (existing.length > 0) {
        const updated = await db.update(manualCampaignMetrics)
          .set(data)
          .where(and(
            eq(manualCampaignMetrics.campaignId, campaignId),
            eq(manualCampaignMetrics.accountId, accountId)
          ))
          .returning();
        result = updated[0];
      } else {
        const inserted = await db.insert(manualCampaignMetrics)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted[0];
      }

      const cpa = (result.conversions ?? 0) > 0 ? +((result.spend ?? 0) / result.conversions).toFixed(2) : 0;
      const roas = (result.spend ?? 0) > 0 ? +((result.revenue ?? 0) / result.spend).toFixed(2) : 0;

      console.log(`[Campaigns] Manual metrics saved for campaign ${campaignId}: spend=${result.spend}, revenue=${result.revenue}, conversions=${result.conversions}`);

      // Trigger Performance Loop re-evaluation and Adaptive Reasoning sync so manual inputs reach Performance immediately
      try {
        const { evaluateAndPersistBusinessExecutionState } = await import("./performance-loop/execution-intelligence");
        await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
        const { syncCampaignAdaptiveReasoning } = await import("./adaptive/case-coordinator");
        await syncCampaignAdaptiveReasoning({ accountId, campaignId });
      } catch (perfErr: any) {
        console.warn(`[Campaigns] Non-fatal Performance re-evaluation warning after manual metrics save: ${perfErr?.message || perfErr}`);
      }

      res.json({
        success: true,
        metrics: { ...result, cpa, roas },
        message: "Manual campaign metrics saved successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Manual metrics PUT error:", error);
      res.status(500).json({ code: "MANUAL_METRICS_SAVE_FAILED", message: "Failed to save manual metrics", requestId: `mm_put_${Date.now()}` });
    }
  });

  app.get("/api/campaigns/:campaignId/retention-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const rows = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);
      const metrics = rows[0] || null;
      if (!metrics) {
        return res.json({ success: true, metrics: null, derived: null, message: "No retention metrics entered yet" });
      }
      const derived = computeDerivedRetentionMetrics(metrics);
      res.json({
        success: true,
        metrics,
        derived,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention metrics GET error:", error);
      res.status(500).json({ code: "RETENTION_METRICS_FAILED", message: "Failed to fetch retention metrics" });
    }
  });

  app.put("/api/campaigns/:campaignId/retention-metrics", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const { totalCustomers, totalPurchases, returningCustomers, averageOrderValue, refundCount, monthlyCustomers, dataWindowDays } = req.body;

      const tc = totalCustomers !== undefined ? (Number(totalCustomers) || 0) : undefined;
      const tp = totalPurchases !== undefined ? (Number(totalPurchases) || 0) : undefined;
      const rc = returningCustomers !== undefined ? (Number(returningCustomers) || 0) : undefined;
      const aov = averageOrderValue !== undefined ? (Number(averageOrderValue) || 0) : undefined;
      const rfc = refundCount !== undefined ? (Number(refundCount) || 0) : undefined;
      const mc = monthlyCustomers !== undefined ? (Number(monthlyCustomers) || 0) : undefined;
      const dwRaw = dataWindowDays !== undefined ? Number(dataWindowDays) : undefined;
      const dw = dwRaw !== undefined ? ([30, 60, 90].includes(dwRaw) ? dwRaw : 30) : undefined;

      const data: any = { updatedAt: new Date() };
      if (tc !== undefined) data.totalCustomers = tc;
      if (tp !== undefined) data.totalPurchases = tp;
      if (rc !== undefined) data.returningCustomers = rc;
      if (aov !== undefined) data.averageOrderValue = aov;
      if (rfc !== undefined) data.refundCount = rfc;
      if (mc !== undefined) data.monthlyCustomers = mc;
      if (dw !== undefined) data.dataWindowDays = dw;

      const rawDerived = computeDerivedFromRaw(tc || 0, tp || 0, rc || 0, aov || 0, rfc || 0, dw || 30);
      if (rawDerived.repeatPurchaseRate !== null) data.repeatPurchaseRate = rawDerived.repeatPurchaseRate;
      if (rawDerived.refundRate !== null) data.refundRate = rawDerived.refundRate;
      if (rawDerived.purchaseFrequency !== null) data.purchaseFrequency = rawDerived.purchaseFrequency;

      const existing = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing.length > 0) {
        const updated = await db.update(manualRetentionMetrics)
          .set(data)
          .where(and(
            eq(manualRetentionMetrics.campaignId, campaignId),
            eq(manualRetentionMetrics.accountId, accountId)
          ))
          .returning();
        result = updated[0];
      } else {
        const inserted = await db.insert(manualRetentionMetrics)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted[0];
      }

      const derived = computeDerivedRetentionMetrics(result);

      console.log(`[Campaigns] Retention metrics saved for campaign ${campaignId}: TC=${result.totalCustomers}, RC=${result.returningCustomers}, AOV=${result.averageOrderValue}, RPR=${derived.repeatPurchaseRate}`);

      res.json({
        success: true,
        metrics: result,
        derived,
        message: "Retention metrics saved successfully",
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention metrics PUT error:", error);
      res.status(500).json({ code: "RETENTION_METRICS_SAVE_FAILED", message: "Failed to save retention metrics" });
    }
  });

  app.get("/api/campaigns/:campaignId/iteration-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const [existing] = await db.select().from(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ))
        .limit(1);

      const [campaignData] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const missing: string[] = [];
      if (!existing || !existing.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!existing || !existing.primaryKpi) missing.push("Primary KPI for optimization");
      if (!existing || !existing.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");

      const hasMetric = campaignData && (
        (campaignData.spend > 0) ||
        (campaignData.impressions > 0) ||
        (campaignData.clicks > 0) ||
        (campaignData.leads > 0) ||
        (campaignData.revenue > 0) ||
        (campaignData.conversions > 0)
      );
      if (!hasMetric) missing.push("At least one real performance metric in Campaign Metrics (spend, impressions, clicks, leads, or revenue)");

      res.json({
        success: true,
        inputs: existing || null,
        campaignMetrics: campaignData ? {
          spend: campaignData.spend,
          impressions: campaignData.impressions,
          clicks: campaignData.clicks,
          leads: campaignData.leads,
          revenue: campaignData.revenue,
          conversions: campaignData.conversions,
        } : null,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Iteration gate GET error:", error);
      res.status(500).json({ code: "GATE_FETCH_FAILED", message: "Failed to fetch iteration gate inputs" });
    }
  });

  app.put("/api/campaigns/:campaignId/iteration-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const data = {
        hasExistingAsset: !!req.body.hasExistingAsset,
        assetDescription: req.body.assetDescription || null,
        primaryKpi: req.body.primaryKpi || null,
        dataWindowDays: req.body.dataWindowDays ? parseInt(req.body.dataWindowDays) : null,
        updatedAt: new Date(),
      };

      const [existing] = await db.select().from(iterationGateInputs)
        .where(and(
          eq(iterationGateInputs.campaignId, campaignId),
          eq(iterationGateInputs.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing) {
        const [updated] = await db.update(iterationGateInputs)
          .set(data)
          .where(and(
            eq(iterationGateInputs.campaignId, campaignId),
            eq(iterationGateInputs.accountId, accountId)
          ))
          .returning();
        result = updated;
      } else {
        const [inserted] = await db.insert(iterationGateInputs)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted;
      }

      const [campaignData] = await db.select().from(manualCampaignMetrics)
        .where(and(
          eq(manualCampaignMetrics.campaignId, campaignId),
          eq(manualCampaignMetrics.accountId, accountId)
        ))
        .limit(1);

      const missing: string[] = [];
      if (!result.hasExistingAsset) missing.push("Existing campaign, asset, or funnel to iterate on");
      if (!result.primaryKpi) missing.push("Primary KPI for optimization");
      if (!result.dataWindowDays) missing.push("Data window (7, 14, 30, or 60 days)");
      const hasMetric = campaignData && (
        (campaignData.spend > 0) ||
        (campaignData.impressions > 0) ||
        (campaignData.clicks > 0) ||
        (campaignData.leads > 0) ||
        (campaignData.revenue > 0) ||
        (campaignData.conversions > 0)
      );
      if (!hasMetric) missing.push("At least one real performance metric in Campaign Metrics (spend, impressions, clicks, leads, or revenue)");

      console.log(`[Campaigns] Iteration gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        campaignMetrics: campaignData ? {
          spend: campaignData.spend,
          impressions: campaignData.impressions,
          clicks: campaignData.clicks,
          leads: campaignData.leads,
          revenue: campaignData.revenue,
          conversions: campaignData.conversions,
        } : null,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Iteration gate PUT error:", error);
      res.status(500).json({ code: "GATE_SAVE_FAILED", message: "Failed to save iteration gate inputs" });
    }
  });

  app.get("/api/campaigns/:campaignId/retention-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const [existing] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ))
        .limit(1);

      const [retentionData] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      const hasRawData = retentionData && (
        (retentionData.totalCustomers != null && retentionData.totalCustomers > 0) ||
        (retentionData.monthlyCustomers != null && retentionData.monthlyCustomers > 0)
      );

      const missing: string[] = [];
      if (!retentionData || !retentionData.totalCustomers || retentionData.totalCustomers <= 0) {
        missing.push("Total customers acquired (last 30–90 days)");
      }
      if (!retentionData || retentionData.returningCustomers == null) {
        missing.push("Returning customers count");
      }
      if (!retentionData || !retentionData.totalPurchases || retentionData.totalPurchases <= 0) {
        missing.push("Total purchases/orders");
      }
      if (!retentionData || ![30, 60, 90].includes(retentionData.dataWindowDays || 0)) {
        missing.push("Time window selection (30, 60, or 90 days)");
      }
      if (!existing || !existing.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!existing || !existing.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!existing || !existing.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      const derived = retentionData ? computeDerivedRetentionMetrics(retentionData) : null;

      res.json({
        success: true,
        inputs: existing || null,
        retentionMetrics: retentionData ? {
          totalCustomers: retentionData.totalCustomers,
          totalPurchases: retentionData.totalPurchases,
          returningCustomers: retentionData.returningCustomers,
          averageOrderValue: retentionData.averageOrderValue,
          refundCount: retentionData.refundCount,
          monthlyCustomers: retentionData.monthlyCustomers,
          dataWindowDays: retentionData.dataWindowDays,
        } : null,
        derived,
        hasCustomerData: !!hasRawData,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention gate GET error:", error);
      res.status(500).json({ code: "GATE_FETCH_FAILED", message: "Failed to fetch retention gate inputs" });
    }
  });

  app.put("/api/campaigns/:campaignId/retention-gate", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);

      const data = {
        hasExistingCustomers: !!req.body.hasExistingCustomers,
        retentionGoal: req.body.retentionGoal || null,
        businessModel: req.body.businessModel || null,
        reachableAudience: req.body.reachableAudience || null,
        updatedAt: new Date(),
      };

      const [existing] = await db.select().from(retentionGateInputs)
        .where(and(
          eq(retentionGateInputs.campaignId, campaignId),
          eq(retentionGateInputs.accountId, accountId)
        ))
        .limit(1);

      let result;
      if (existing) {
        const [updated] = await db.update(retentionGateInputs)
          .set(data)
          .where(and(
            eq(retentionGateInputs.campaignId, campaignId),
            eq(retentionGateInputs.accountId, accountId)
          ))
          .returning();
        result = updated;
      } else {
        const [inserted] = await db.insert(retentionGateInputs)
          .values({ campaignId, accountId, ...data })
          .returning();
        result = inserted;
      }

      const [retentionData] = await db.select().from(manualRetentionMetrics)
        .where(and(
          eq(manualRetentionMetrics.campaignId, campaignId),
          eq(manualRetentionMetrics.accountId, accountId)
        ))
        .limit(1);

      const hasRawData = retentionData && (
        (retentionData.totalCustomers != null && retentionData.totalCustomers > 0) ||
        (retentionData.monthlyCustomers != null && retentionData.monthlyCustomers > 0)
      );

      const missing: string[] = [];
      if (!retentionData || !retentionData.totalCustomers || retentionData.totalCustomers <= 0) {
        missing.push("Total customers acquired (last 30–90 days)");
      }
      if (!retentionData || retentionData.returningCustomers == null) {
        missing.push("Returning customers count");
      }
      if (!retentionData || !retentionData.totalPurchases || retentionData.totalPurchases <= 0) {
        missing.push("Total purchases/orders");
      }
      if (!retentionData || ![30, 60, 90].includes(retentionData.dataWindowDays || 0)) {
        missing.push("Time window selection (30, 60, or 90 days)");
      }
      if (!result.retentionGoal) missing.push("A retention goal (repeat purchase, renewal, churn reduction, or win-back)");
      if (!result.businessModel) missing.push("Business model (one-time purchase, recurring subscription, retainer, or repeat purchase)");
      if (!result.reachableAudience) missing.push("A reachable audience after purchase (customer list, email, WhatsApp, phone, or community)");

      const derived = retentionData ? computeDerivedRetentionMetrics(retentionData) : null;

      console.log(`[Campaigns] Retention gate saved for campaign ${campaignId}: gate=${missing.length === 0 ? 'unlocked' : 'locked'}`);

      res.json({
        success: true,
        inputs: result,
        retentionMetrics: retentionData ? {
          totalCustomers: retentionData.totalCustomers,
          totalPurchases: retentionData.totalPurchases,
          returningCustomers: retentionData.returningCustomers,
          averageOrderValue: retentionData.averageOrderValue,
          refundCount: retentionData.refundCount,
          monthlyCustomers: retentionData.monthlyCustomers,
          dataWindowDays: retentionData.dataWindowDays,
        } : null,
        derived,
        hasCustomerData: !!hasRawData,
        gateStatus: missing.length === 0 ? "unlocked" : "locked",
        missingRequirements: missing,
      });
    } catch (error: any) {
      console.error("[Campaigns] Retention gate PUT error:", error);
      res.status(500).json({ code: "GATE_SAVE_FAILED", message: "Failed to save retention gate inputs" });
    }
  });

  app.get("/api/campaigns/:campaignId/strategy-memory", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const entries = await db
        .select()
        .from(strategyMemory)
        .where(
          and(
            eq(strategyMemory.campaignId, campaignId),
            eq(strategyMemory.accountId, accountId),
          )
        )
        .orderBy(desc(strategyMemory.updatedAt))
        .limit(10);
      res.json({ success: true, entries });
    } catch (error: any) {
      console.error("[Campaigns] Strategy memory GET error:", error);
      res.status(500).json({ code: "STRATEGY_MEMORY_FAILED", message: "Failed to fetch strategy memory" });
    }
  });

  app.get("/api/campaigns/:campaignId/user-channels", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const [profiles, postRows, snapRows] = await Promise.all([
        db
          .select()
          .from(userPublicProfiles)
          .where(
            and(
              eq(userPublicProfiles.campaignId, campaignId),
              eq(userPublicProfiles.accountId, accountId),
            )
          ),
        db
          .select()
          .from(ownedPosts)
          .where(
            and(
              eq(ownedPosts.campaignId, campaignId),
              eq(ownedPosts.accountId, accountId),
            )
          ),
        db
          .select()
          .from(userChannelSnapshots)
          .where(
            and(
              eq(userChannelSnapshots.campaignId, campaignId),
              eq(userChannelSnapshots.accountId, accountId),
            )
          )
          .orderBy(desc(userChannelSnapshots.scrapedAt)),
      ]);

      const enrichedProfiles = profiles.map((p) => {
        const storedPostsCount = postRows.filter((op) => op.platform === p.platform).length;
        const latestSnapRow = snapRows.find((s) => s.platform === p.platform);
        let parsedSnap: any = null;
        if (latestSnapRow?.snapshotData) {
          try {
            parsedSnap = JSON.parse(latestSnapRow.snapshotData);
          } catch {}
        }
        const isUnresolvedLinkedIn =
          p.platform.toLowerCase() === "linkedin" &&
          (!p.handle ||
            p.handle === "company" ||
            p.url === "https://linkedin.com/company" ||
            parsedSnap?.identityStatus === "UNRESOLVED");
        const accountTotalContent = parsedSnap?.accountTotalContent ?? null;
        return {
          ...p,
          identityStatus: isUnresolvedLinkedIn ? "UNRESOLVED" : parsedSnap?.identityStatus ?? "CONFIRMED",
          storedPostsCount,
          storedHistoricalPostCount: storedPostsCount,
          fetchedWindowPostCount: parsedSnap?.fetchedWindowPostCount ?? parsedSnap?.postCount ?? null,
          inWindowPostCount: parsedSnap?.inWindowPostCount ?? null,
          rolling30dPostCount: parsedSnap?.rolling30dPostCount ?? null,
          accountTotalContent,
          accountTotalDisplay: accountTotalContent ?? "UNKNOWN",
          latestScrapeStatus: parsedSnap?.scrapeStatus ?? null,
          isPartialCoverage: parsedSnap?.isPartialCoverage ?? false,
          countMeaning: "stored_unique_items_in_db",
        };
      });

      res.json({ success: true, profiles: enrichedProfiles });
    } catch (error: any) {
      console.error("[Campaigns] User channels GET error:", error);
      res.status(500).json({ code: "USER_CHANNELS_FAILED", message: "Failed to fetch user channels" });
    }
  });

  app.put("/api/campaigns/:campaignId/user-channels", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      const {
        instagramHandle,
        tiktokHandle,
        youtubeUrl,
        linkedinUrl,
        websiteUrl,
        channels,
        triggerScrape = false,
      } = req.body;

      const { normalizeYouTubeChannelUrl, parseLinkedInIdentity } = await import("./acquisition/multi-source-providers");
      const { extractHandleFromUrl } = await import("./competitive-intelligence/profile-scraper");

      const channelsToUpsert: { platform: string; handle: string | null; url: string | null }[] = [];

      const rawList: Array<{ platform: string; raw: string | null }> = [];
      if (Array.isArray(channels)) {
        for (const ch of channels) {
          if (ch?.platform) {
            rawList.push({
              platform: String(ch.platform).toLowerCase().trim(),
              raw: ch.url !== undefined ? ch.url : ch.handle ?? null,
            });
          }
        }
      }
      if (instagramHandle !== undefined) rawList.push({ platform: "instagram", raw: instagramHandle });
      if (tiktokHandle !== undefined) rawList.push({ platform: "tiktok", raw: tiktokHandle });
      if (youtubeUrl !== undefined) rawList.push({ platform: "youtube", raw: youtubeUrl });
      if (linkedinUrl !== undefined) rawList.push({ platform: "linkedin", raw: linkedinUrl });
      if (websiteUrl !== undefined) rawList.push({ platform: "website", raw: websiteUrl });

      for (const item of rawList) {
        const rawVal = item.raw != null ? String(item.raw).trim() : "";
        if (!rawVal) continue;
        if (item.platform === "linkedin") {
          const liIdentity = parseLinkedInIdentity(rawVal);
          if (!liIdentity.valid) {
            // Never erase a saved URL on validation error; return 400 with actionable error
            return res.status(400).json({
              code: "INVALID_LINKEDIN_URL",
              message:
                liIdentity.error ||
                "Invalid LinkedIn URL: please provide your full /company/<slug> or /in/<slug> LinkedIn URL.",
              field: "linkedin",
            });
          }
          channelsToUpsert.push({
            platform: "linkedin",
            handle: liIdentity.handle,
            url: liIdentity.canonicalUrl,
          });
        } else if (item.platform === "instagram") {
          const cleanHandle = (extractHandleFromUrl(rawVal) || rawVal.replace(/^@/, "")).toLowerCase().trim();
          channelsToUpsert.push({
            platform: "instagram",
            handle: cleanHandle,
            url: `https://www.instagram.com/${cleanHandle}`,
          });
        } else if (item.platform === "tiktok") {
          const cleanHandle = rawVal.replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
          channelsToUpsert.push({
            platform: "tiktok",
            handle: cleanHandle,
            url: `https://www.tiktok.com/@${cleanHandle}`,
          });
        } else if (item.platform === "youtube") {
          let cleanHandle = rawVal;
          if (rawVal.startsWith("http://") || rawVal.startsWith("https://")) {
            try {
              const parsed = new URL(rawVal);
              const pathSegments = parsed.pathname.split("/").filter(Boolean);
              cleanHandle = (pathSegments[pathSegments.length - 1] || rawVal).replace(/^@/, "");
            } catch {}
          } else {
            cleanHandle = rawVal.replace(/^@/, "");
          }
          const cleanUrl = normalizeYouTubeChannelUrl(rawVal.startsWith("http") ? rawVal : "", cleanHandle);
          channelsToUpsert.push({
            platform: "youtube",
            handle: cleanHandle,
            url: cleanUrl,
          });
        } else if (item.platform === "website") {
          channelsToUpsert.push({
            platform: "website",
            handle: null,
            url: rawVal.startsWith("http") ? rawVal : `https://${rawVal}`,
          });
        }
      }

      if (channelsToUpsert.length === 0) {
        return res.status(400).json({ code: "MISSING_CHANNELS", message: "At least one valid channel is required" });
      }

      const results = [];
      for (const ch of channelsToUpsert) {
        const existing = await db
          .select()
          .from(userPublicProfiles)
          .where(
            and(
              eq(userPublicProfiles.accountId, accountId),
              eq(userPublicProfiles.campaignId, campaignId),
              eq(userPublicProfiles.platform, ch.platform),
            )
          )
          .limit(1);

        if (existing.length > 0) {
          const updated = await db
            .update(userPublicProfiles)
            .set({ handle: ch.handle, url: ch.url, updatedAt: new Date() })
            .where(
              and(
                eq(userPublicProfiles.accountId, accountId),
                eq(userPublicProfiles.campaignId, campaignId),
                eq(userPublicProfiles.platform, ch.platform),
              )
            )
            .returning();
          results.push(updated[0]);
        } else {
          const inserted = await db
            .insert(userPublicProfiles)
            .values({ accountId, campaignId, platform: ch.platform, handle: ch.handle, url: ch.url })
            .returning();
          results.push(inserted[0]);
        }
      }

      if (triggerScrape) {
        try {
          const { scrapeUserChannels } = await import("./user-channel-scraper");
          await scrapeUserChannels(accountId, campaignId, {
            forceRefresh: true,
            targetPlatforms: channelsToUpsert.map((c) => c.platform),
            trigger: "USER_CHANNELS_PUT",
            requesterEngine: "SETTINGS",
          });
          const { evaluateAndPersistBusinessExecutionState } = await import("./performance-loop/execution-intelligence");
          await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
        } catch (scrapeErr: any) {
          console.warn(`[Campaigns] Non-fatal owned channel scrape warning: ${scrapeErr?.message || scrapeErr}`);
        }
      }

      console.log(`[Campaigns] User channels saved for campaign ${campaignId}: ${channelsToUpsert.map(c => c.platform).join(", ")}`);
      res.json({ success: true, profiles: results });
    } catch (error: any) {
      console.error("[Campaigns] User channels PUT error:", error);
      res.status(500).json({ code: "USER_CHANNELS_SAVE_FAILED", message: "Failed to save user channels" });
    }
  });

}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDerivedFromRaw(
  totalCustomers: number, totalPurchases: number, returningCustomers: number,
  averageOrderValue: number, refundCount: number, dataWindowDays: number
) {
  const repeatPurchaseRate = totalCustomers > 0 ? clamp(returningCustomers / totalCustomers, 0, 1) : null;
  const purchaseFrequency = totalCustomers > 0 ? totalPurchases / totalCustomers : null;
  const refundRate = totalPurchases > 0 ? clamp(refundCount / totalPurchases, 0, 1) : null;
  return { repeatPurchaseRate, purchaseFrequency, refundRate };
}

function computeDerivedRetentionMetrics(metrics: any) {
  const tc = metrics.totalCustomers || 0;
  const tp = metrics.totalPurchases || 0;
  const rc = metrics.returningCustomers || 0;
  const aov = metrics.averageOrderValue || 0;
  const rfc = metrics.refundCount || 0;
  const dw = metrics.dataWindowDays || 30;
  const mc = metrics.monthlyCustomers || 0;

  const repeatPurchaseRate = tc > 0 ? clamp(rc / tc, 0, 1) : (metrics.repeatPurchaseRate || 0);
  const purchaseFrequency = tc > 0 ? tp / tc : (metrics.purchaseFrequency || 1);
  const refundRate = tp > 0 ? clamp(rfc / tp, 0, 1) : (metrics.refundRate || 0);

  const monthsInWindow = Math.max(dw / 30, 1);
  const annualizedFrequency = purchaseFrequency * (12 / monthsInWindow);
  const estimatedLifespanMonths = repeatPurchaseRate > 0.1 ? Math.round(1 / (1 - repeatPurchaseRate) * monthsInWindow) : 6;
  const estimatedLTV = aov * annualizedFrequency * (estimatedLifespanMonths / 12);

  const churnRiskEstimate = clamp(1 - repeatPurchaseRate + (refundRate * 0.3), 0, 1);

  const retentionStrengthScore = clamp(
    (repeatPurchaseRate * 0.3) +
    ((1 - refundRate) * 0.2) +
    (Math.min(purchaseFrequency / 4, 1) * 0.25) +
    (Math.min(mc / 100, 1) * 0.25),
    0, 1
  );

  return {
    repeatPurchaseRate: Math.round(repeatPurchaseRate * 1000) / 1000,
    purchaseFrequency: Math.round(purchaseFrequency * 100) / 100,
    refundRate: Math.round(refundRate * 1000) / 1000,
    estimatedLTV: Math.round(estimatedLTV * 100) / 100,
    churnRiskEstimate: Math.round(churnRiskEstimate * 1000) / 1000,
    retentionStrengthScore: Math.round(retentionStrengthScore * 1000) / 1000,
    estimatedLifespanMonths,
    dataWindowDays: dw,
  };
}

export async function requireCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    const accountId = resolveAccountId(req);

    const requestedCampaignId = (req.query.campaignId as string) || null;

    let selections;
    if (requestedCampaignId) {
      selections = await db
        .select()
        .from(campaignSelections)
        .where(
          and(
            eq(campaignSelections.accountId, accountId),
            eq(campaignSelections.selectedCampaignId, requestedCampaignId)
          )
        )
        .limit(1);

      // W0-T1 (launch-closure): close silent-substitution gap. Previously, when a
      // caller supplied a campaignId that did NOT belong to their account, the
      // ownership filter returned 0 rows and we silently fell through to
      // "select most-recent for this account" — caller got a DIFFERENT campaign
      // than requested with no error, and any cross-tenant probing was invisible
      // in logs.
      // W5 (cleanup): normalize denial response to 404 CAMPAIGN_NOT_FOUND to
      // match `assertCampaignBelongsTo` (server/auth-helpers.ts) — anti-
      // enumeration policy: never confirm to a non-owner that a campaign id
      // exists. The structured WARN log is preserved (with the original
      // OWNERSHIP_REJECTED tag) so cross-tenant probing remains observable in
      // production logs even though the public response is intentionally
      // generic. The "no campaignId requested → load latest" convenience path
      // (used by dashboard widgets) is preserved below.
      if (selections.length === 0) {
        console.warn(
          `[Campaigns] CAMPAIGN_OWNERSHIP_REJECTED | accountId=${accountId} | requestedCampaignId=${requestedCampaignId} | path=${req.path}`
        );
        return res.status(404).json({
          code: "CAMPAIGN_NOT_FOUND",
          message: "Campaign not found.",
          requestId: `mw_owned_${Date.now()}`,
        });
      }
    } else {
      selections = await db
        .select()
        .from(campaignSelections)
        .where(eq(campaignSelections.accountId, accountId))
        .orderBy(desc(campaignSelections.selectedAt))
        .limit(1);
    }

    if (selections.length === 0) {
      return res.status(400).json({
        code: "CAMPAIGN_REQUIRED",
        message: "No campaign selected. Please select a campaign before accessing performance data.",
        requestId: `mw_${Date.now()}`,
      });
    }

    const selection = selections[0];

    const campaignStatus = selection.campaignStatus || "active";
    if (campaignStatus === "paused" || campaignStatus === "removed") {
      return res.status(400).json({
        code: "CAMPAIGN_INVALID",
        message: `Campaign "${selection.selectedCampaignName}" is ${campaignStatus}. Please select an active campaign.`,
        campaignStatus,
        requestId: `mw_${Date.now()}`,
      });
    }

    const resolvedCampaignId = selection.selectedCampaignId;
    if (!resolvedCampaignId || resolvedCampaignId === "unscoped_legacy") {
      return res.status(400).json({
        code: "CAMPAIGN_INVALID",
        message: "Invalid campaign ID. Please select a valid campaign.",
        requestId: `mw_${Date.now()}`,
      });
    }

    (req as any).campaignContext = {
      accountId,
      campaignId: resolvedCampaignId,
      campaignName: selection.selectedCampaignName,
      platform: selection.selectedPlatform,
      goalType: selection.campaignGoalType,
      location: selection.campaignLocation || null,
    };

    next();
  } catch (error: any) {
    // W0-T1 (launch-closure): preserve auth-context errors at their declared
    // status. Previously every thrown error became 500 MIDDLEWARE_FAILED, which
    // hid AuthConfigurationError (401, "no account context") behind a generic
    // server-error and falsely suggested an outage when the real cause was a
    // missing/expired session. Honor the declared `status` field on the error
    // when present (AuthConfigurationError sets status=401), fall back to 500
    // for anything else.
    const status = typeof error?.status === "number" ? error.status : 500;
    if (status === 500) {
      console.error("[Campaigns] Middleware error:", error);
    } else {
      console.warn(`[Campaigns] Middleware ${status} | ${error?.name || "Error"}: ${error?.message || ""}`);
    }
    return res.status(status).json({
      code: status === 401 ? "AUTH_REQUIRED" : "MIDDLEWARE_FAILED",
      message: status === 401
        ? (error?.message || "Authentication required.")
        : "Failed to validate campaign context",
      requestId: `mw_err_${Date.now()}`,
    });
  }
}
