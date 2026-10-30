/**
 * Adaptive Product Read Surfaces & Detail Center
 * 
 * Constitutional Principle:
 * READ MODEL != NEW AUTHORITY.
 * Composes existing canonical data sources for customer-facing UI without creating duplicate truth:
 * - Watchtower: Concise summary-first market intelligence feed.
 * - Performance Loop Overview: Concise summary-first business understanding + plan performance.
 * - Reasoning Center: Full detail center for market event investigations, performance warning investigations,
 *   causal diagnosis, hypotheses, adaptive decisions, and adaptation outcome tracking.
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import {
  adaptWatchtowerEventToAdaptiveSignal,
  adaptPerformanceContextToSignals,
} from "./adapters";
import {
  resolveDesignatedActiveLineage,
  syncCampaignAdaptiveReasoning,
} from "./case-coordinator";
import {
  AdaptiveSignal,
  StrategicAuthorityName,
} from "./contracts";
import { evaluateWindowState } from "../pipeline/eval-windows";
import { evaluateRhythmCompliance } from "../pipeline/lanes/user/rhythm-compliance";

export const adaptiveReadRouter = Router();

/**
 * Standard date formatter to prevent malformed dates globally.
 */
export function formatStandardDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Standard date-time formatter.
 */
export function formatStandardDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Translates signal types into clean, specific, business-facing titles.
 * NEVER returns "NONE" or generic container codes.
 */
export function translateSignalTypeToTitle(signalType?: string | null, summary?: string | null): string {
  // Strip signal prefixes like sig_perf_bottleneck_ or sig_perf_gap_
  let cleanType = (signalType || "")
    .replace(/^sig_perf_bottleneck_/, "")
    .replace(/^sig_perf_gap_/, "")
    .replace(/^sig_perf_/, "")
    .replace(/^sig_/, "");

  // If cleanType has contextId suffix (e.g. pctx_live_001 or pctx_123_0), strip it
  if (cleanType.includes("pctx_")) {
    cleanType = cleanType.split("pctx_")[0].replace(/_+$/, "");
  }

  const normType = cleanType.toLowerCase().trim();
  const normSummary = (summary || "").toLowerCase().trim();

  if (normType === "proof_gap_unmeasured_truth") {
    return summary ? `Unmeasured Baseline Truth: ${summary}` : "Unmeasured Conversion & Business Baseline";
  }

  if (normType.includes("qualified_lead") || normType.includes("lead_pace") || normSummary.includes("lead pace") || normSummary.includes("qualified lead")) {
    return "Qualified Lead Pace Declining";
  }
  if (normType.includes("conversion_friction") || normType.includes("conversion_drop") || normSummary.includes("conversion friction") || normSummary.includes("conversion drop")) {
    return "Funnel Conversion Friction";
  }
  if (normType.includes("offer_friction") || normSummary.includes("offer friction") || normSummary.includes("pricing") || normSummary.includes("offer")) {
    return "Offer Consideration Resistance";
  }
  if (normType.includes("differentiation") || normSummary.includes("differentiat")) {
    return "Differentiation Perception Weakening";
  }
  if (normType.includes("audience_misalignment") || normSummary.includes("buyer role") || normSummary.includes("audience") || normSummary.includes("buyer")) {
    return "Buyer Role Alignment Warning";
  }
  if (normType.includes("social_engagement") || normSummary.includes("social media") || normSummary.includes("instagram") || normSummary.includes("tiktok")) {
    return "Social Engagement Data Missing";
  }
  if (normSummary.includes("sales history") || normSummary.includes("new with no sales") || normSummary.includes("operating history")) {
    return "Early Stage Baseline / Sales History Needed";
  }
  if (normType.includes("reach_bottleneck") || normType === "reach" || normSummary.includes("reach")) {
    return "Top-of-Funnel Reach Bottleneck";
  }
  if (normType.includes("engagement_bottleneck") || normType === "engagement" || normSummary.includes("engagement")) {
    return "Content Engagement Bottleneck";
  }
  if (normType.includes("intent_bottleneck") || normType === "intent" || normSummary.includes("intent")) {
    return "Buyer Intent Conversion Bottleneck";
  }
  if (normType.includes("bottleneck") || normSummary.includes("bottleneck")) {
    return "Funnel Conversion Bottleneck";
  }
  if (normType.includes("gap") || normSummary.includes("gap") || normSummary.includes("proof")) {
    return "Proof & Offer Consideration Gap";
  }

  if (normType && normType !== "none" && normType !== "unknown" && normType !== "performance_state" && normType !== "performance_gap" && !normType.startsWith("pctx")) {
    return normType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  if (summary && summary.length > 5 && !summary.startsWith("Watchtower") && !summary.startsWith("Performance")) {
    return summary.length > 50 ? summary.slice(0, 47) + "..." : summary;
  }

  return "Performance Metric Warning";
}

/**
 * Translates technical Watchtower event kinds into clean, human-readable titles.
 */
export function translateEventTypeToTitle(kind?: string | null): string {
  const norm = (kind || "").toLowerCase().trim();
  if (norm === "competitor_profile_change") return "Competitor Profile Shift";
  if (norm === "offer_type_shift") return "Competitor Offer & Pricing Shift";
  if (norm === "awareness_stage_shift") return "Awareness Strategy Shift";
  if (norm === "positioning_shift") return "Market Positioning Shift";
  if (norm === "mechanism_shift") return "Mechanism & Proof Shift";
  if (norm === "messaging_shift") return "Audience Messaging Shift";
  if (norm === "feature_launch") return "New Feature Launch";
  if (norm === "pricing_change") return "Pricing Model Revision";
  if (norm) return norm.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return "Market Competitor Event";
}

/**
 * Translates technical decision types and authorities into clean, customer-facing business language.
 */
export function translateDecisionToBusinessLanguage(
  decisionType: string,
  affectedAuthority?: StrategicAuthorityName | null
): { label: string; actionDescription: string; statusBadge: string } {
  const authorityNames: Record<string, string> = {
    BUSINESS_UNDERSTANDING: "Business Understanding",
    AUDIENCE: "Target Audience",
    STRATEGIC_PAIN_DECISION: "Core Problem Priority",
    POSITIONING: "Market Positioning",
    DIFFERENTIATION: "Differentiation Strategy",
    MECHANISM: "Mechanism of Action",
    OFFER: "Offer & Pricing Architecture",
    AWARENESS: "Awareness & Trust Stages",
    FUNNEL: "Funnel Journey",
    PERSUASION: "Objection & Proof Playbook",
    CHANNEL_SELECTION: "Distribution Channels",
    PLAN_SYNTHESIS: "Strategic Plan",
  };

  const authLabel = affectedAuthority ? (authorityNames[affectedAuthority] || affectedAuthority) : null;

  switch (decisionType) {
    case "OBSERVE":
      return {
        label: "Maintain Observation",
        actionDescription: "Evidence is noted; current marketing strategy remains supported without changes.",
        statusBadge: "NO_CHANGE",
      };
    case "EXECUTION_RESPONSE":
      return {
        label: "Adjust Execution Cadence",
        actionDescription: "Performance variance indicates a distribution or content adjustment in What To Do Today rather than a strategy change.",
        statusBadge: "EXECUTION_ADJUSTMENT",
      };
    case "REEVALUATE_AUTHORITY":
      return {
        label: authLabel ? `Re-evaluate ${authLabel}` : "Re-evaluate Strategic Authority",
        actionDescription: `Market changes or conversion signals suggest reviewing ${authLabel || "this strategic area"}.`,
        statusBadge: "UNDER_REVIEW",
      };
    case "STRATEGY_CHANGE_REQUIRED":
      return {
        label: authLabel ? `Update ${authLabel}` : "Strategy Update Required",
        actionDescription: `Confirmed evidence warrants updating ${authLabel || "the current strategy"}.`,
        statusBadge: "STRATEGY_UPDATED",
      };
    case "STRATEGIC_REBUILD_REQUIRED":
      return {
        label: "Strategic Foundation Review",
        actionDescription: "Foundational business or audience assumptions require comprehensive re-alignment.",
        statusBadge: "FOUNDATION_REVIEW",
      };
    case "INSUFFICIENT_EVIDENCE":
    default:
      return {
        label: "Monitoring Evidence",
        actionDescription: "Current signals do not yet meet confidence thresholds to justify strategic intervention.",
        statusBadge: "MONITORING",
      };
  }
}

// ============================================================================
// 1. SURFACE A: PERFORMANCE LOOP OVERVIEW (EXECUTIVE SUMMARY)
// ============================================================================
adaptiveReadRouter.get("/performance-loop/overview/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const accountId = (req as any).accountId;

    // 1. Lineage Resolution: Campaign -> Designated Active Strategic Plan -> Root Bundle -> Strategy Root
    const lineage = await resolveDesignatedActiveLineage(campaignId, accountId);
    const activeRoot = lineage.activeRoot;
    const rootBundle = lineage.rootBundle;
    const strategicPlan = lineage.strategicPlan;
    const rootId = lineage.strategyRootId;
    const rootVersion = lineage.strategyRootVersion;

    let strategyName = "Competitor Intelligence Extraction Simplicity_and_Ease";
    if (activeRoot) {
      try {
        const mech = typeof activeRoot.approvedMechanism === "string"
          ? JSON.parse(activeRoot.approvedMechanism)
          : activeRoot.approvedMechanism;
        if (mech?.mechanismName) {
          strategyName = mech.mechanismName;
        } else if (activeRoot.primaryAxis) {
          strategyName = activeRoot.primaryAxis.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }
      } catch {
        if (activeRoot.primaryAxis) {
          strategyName = activeRoot.primaryAxis.split("_").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }
      }
    }

    const planId = strategicPlan?.id || null;
    const planVersion = strategicPlan?.version || 1;
    const planSummary = strategicPlan?.planSummary || null;

    // 2. Fetch canonical Business Understanding matching current offering authority
    const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
    const buResult = accountId ? await resolveCurrentBusinessUnderstanding({ accountId, campaignId }) : null;
    const buSnapshot = buResult ? buResult.snapshotRow : (await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(eq(schema.businessUnderstandingSnapshots.campaignId, campaignId))
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1))[0];

    let buData: any = null;
    if (buSnapshot) {
      const snap = (buSnapshot.businessUnderstanding || (buSnapshot as any).snapshotData || buSnapshot) as any;
      
      // Extract clean statements for core business properties
      const businessIdentity = typeof snap.businessIdentity === "object"
        ? (snap.businessIdentity?.statement || snap.businessName || null)
        : (snap.businessIdentity || snap.businessName || snap.companyName || null);

      const primaryOffering = typeof snap.primaryOffering === "object"
        ? (snap.primaryOffering?.statement || snap.campaignOffering?.offeringName || null)
        : (snap.primaryOffering || snap.campaignOffering?.offeringName || null);

      const category = typeof snap.category === "object"
        ? (snap.category?.statement || snap.generalIndustry || null)
        : (snap.category || snap.generalIndustry || null);

      const businessModel = typeof snap.businessModel === "object"
        ? (snap.businessModel?.statement || null)
        : (snap.businessModel || null);

      // Extract facts from campaignOffering.productTruthFacts, campaignOffering.productTruth.facts, or productTruth.facts
      const allProductFacts: any[] = Array.isArray(snap.campaignOffering?.productTruthFacts)
        ? snap.campaignOffering.productTruthFacts
        : (Array.isArray(snap.campaignOffering?.productTruth?.facts)
            ? snap.campaignOffering.productTruth.facts
            : (Array.isArray(snap.productTruth?.facts)
                ? snap.productTruth.facts
                : (Array.isArray(snap.productTruthFacts) ? snap.productTruthFacts : [])));

      // Extract target roles
      const allTargetRoles: any[] = Array.isArray(snap.targetUnderstanding?.targetRoles)
        ? snap.targetUnderstanding.targetRoles
        : (Array.isArray(snap.targetRoles) ? snap.targetRoles : []);

      // Extract verified capabilities, boundaries, use cases
      const verifiedCapabilities = allProductFacts
        .filter(f => f.factType === "CAPABILITY" || f.capability || f.verifiedCapability)
        .map(f => f.statement || f.capability || f.verifiedCapability);

      const boundaryLimitations = allProductFacts
        .filter(f => f.factType === "BOUNDARY")
        .map(f => f.statement);

      const useCases = allProductFacts
        .filter(f => f.factType === "USE_CASE")
        .map(f => f.statement);

      // Provenance categorization across stored facts
      const combinedFacts = [...allProductFacts, ...allTargetRoles];
      const userConfirmedFacts = combinedFacts.filter(f => f.status === "USER_CONFIRMED");
      const websiteEstablishedFacts = combinedFacts.filter(f => f.status === "WEBSITE_ESTABLISHED" || (!f.status && f.statement));
      const systemInferredFacts = combinedFacts.filter(f => f.status === "SYSTEM_INFERRED");
      const unknownElements = combinedFacts.filter(f => f.status === "UNKNOWN" || f.status === "UNRESOLVED");

      buData = {
        snapshotId: buSnapshot.id,
        businessIdentity,
        primaryOffering,
        businessModel,
        category,
        targetRoles: allTargetRoles,
        productTruthCapabilities: verifiedCapabilities.length > 0 ? verifiedCapabilities : allProductFacts.map(f => f.statement || JSON.stringify(f)),
        verifiedCapabilities,
        boundaryLimitations,
        useCases,
        userConfirmedFacts,
        websiteEstablishedFacts,
        systemInferredFacts,
        unknownElements,
        userConfirmedCount: userConfirmedFacts.length,
        websiteEstablishedCount: websiteEstablishedFacts.length,
        systemInferredCount: systemInferredFacts.length,
        unknownCount: unknownElements.length,
        confidence: snap.confidenceScore ? `${Math.round(snap.confidenceScore * 100)}% Confidence` : (snap.confidence || "WEBSITE_ESTABLISHED"),
        updatedAt: formatStandardDateTime(buSnapshot.createdAt),
      };
    }

    // 3. Fetch Plan Performance from CURRENT ACTIVE performance_context only
    const [perfContext] = await db
      .select()
      .from(schema.performanceContexts)
      .where(eq(schema.performanceContexts.campaignId, campaignId))
      .orderBy(desc(schema.performanceContexts.createdAt))
      .limit(1);

    let planPerformance: any = null;
    if (perfContext || strategicPlan || activeRoot || accountId) {
      const rawBottleneck = (perfContext?.primaryBottleneck || "").toUpperCase().trim();
      const hasRealBottleneck = rawBottleneck && rawBottleneck !== "NONE" && rawBottleneck !== "UNKNOWN" && rawBottleneck !== "NULL";
      const cleanBottleneck = hasRealBottleneck && perfContext ? translateSignalTypeToTitle(perfContext.primaryBottleneck, perfContext.currentReality) : null;
      
      const discreteSignals = perfContext ? adaptPerformanceContextToSignals(perfContext) : [];

      // Clean active channels mapping (prevent conflating UNTESTED/NOT_CONNECTED with ZERO)
      const rawChannels = Array.isArray(perfContext?.activeChannels) ? perfContext.activeChannels : [];
      const channels = rawChannels.map((c: any) => ({
        channel: (c.channel || "").toUpperCase(),
        status: (c.status || "UNTESTED").toUpperCase(),
        statusLabel: c.status === "WINNING" ? "Active / Measured" : (c.status === "NOT_CONNECTED" ? "Not Connected" : "Untested / Setup Phase"),
      }));

      // 3b. Evaluate commercial truth status (awaiting_data vs evaluated), publishing rhythm compliance,
      // and owned-channel engagement so execution telemetry is visible even while awaiting user sales truth.
      let commercialVerdictStatus: "awaiting_data" | "evaluated" = "awaiting_data";
      let truthStatus: "missing" | "submitted" | "late" = "missing";
      let rhythmCompliance: any = null;
      let ownedChannelEngagement: any = null;

      try {
        const effAccountId = accountId || activeRoot?.accountId || strategicPlan?.accountId || perfContext?.accountId;
        if (effAccountId) {
          const ws = await evaluateWindowState(effAccountId, campaignId, new Date());
          if (ws.window && ws.activePlan) {
            const [truthRow] = await db
              .select()
              .from(schema.pipelineUserTruth)
              .where(eq(schema.pipelineUserTruth.windowId, ws.window.id))
              .orderBy(desc(schema.pipelineUserTruth.submittedAt))
              .limit(1);
            if (truthRow) {
              truthStatus = truthRow.wasLate ? "late" : "submitted";
              commercialVerdictStatus = "evaluated";
            }
            rhythmCompliance = await evaluateRhythmCompliance({
              campaignId,
              windowStart: ws.window.windowStart,
              windowEnd: ws.window.windowEnd,
              approvedRhythmJson: ws.activePlan.approvedRhythmJson,
            });
          } else if (strategicPlan?.approvedRhythmJson) {
            const winEnd = new Date();
            const winStart = new Date(winEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
            rhythmCompliance = await evaluateRhythmCompliance({
              campaignId,
              windowStart: winStart,
              windowEnd: winEnd,
              approvedRhythmJson: strategicPlan.approvedRhythmJson,
            });
          }
        }
      } catch {
        // non-fatal
      }

      try {
        const { resolveCampaignLifecycleWindows, calculateOwnedPlatformWindowCounts } = await import("../user-channel-scraper");
        const resolvedAccId = accountId || activeRoot?.accountId || "";
        const lifecycle = resolvedAccId
          ? await resolveCampaignLifecycleWindows(resolvedAccId, campaignId)
          : {
              campaignCreatedAt: null,
              campaignCreatedAtMs: null,
              initialActivatedAt: null,
              initialActivatedAtMs: null,
              activePlanActivatedAt: null,
              activePlanActivatedAtMs: null,
              campaignWindowStart: null,
              campaignWindowStartMs: null,
            };

        const ownedProfiles = await db
          .select()
          .from(schema.userPublicProfiles)
          .where(eq(schema.userPublicProfiles.campaignId, campaignId));
        const ownedSnaps = await db
          .select()
          .from(schema.userChannelSnapshots)
          .where(eq(schema.userChannelSnapshots.campaignId, campaignId))
          .orderBy(desc(schema.userChannelSnapshots.scrapedAt))
          .limit(50);
        const ownedPostRows = await db
          .select()
          .from(schema.ownedPosts)
          .where(eq(schema.ownedPosts.campaignId, campaignId));

        const { parseLinkedInIdentity } = await import("../acquisition/multi-source-providers");
        const parsedSnaps = ownedSnaps.map((s) => {
          let data: any = {};
          try {
            data = s.snapshotData ? JSON.parse(s.snapshotData) : {};
          } catch {}
          return { row: s, data };
        });
        const findBestSnapForPlatform = (plat: string, expectedHandle?: string | null) => {
          const candidates = parsedSnaps.filter((s) => s.row.platform?.toLowerCase() === plat);
          if (expectedHandle) {
            const handleMatches = candidates.filter(
              (s) => s.row.handle === expectedHandle || s.data?.handle === expectedHandle || s.data?.url === expectedHandle
            );
            if (handleMatches.length > 0) {
              return (
                handleMatches.find((s) => s.data.scrapeStatus === "SUCCESS" || s.data.scrapeStatus === "PARTIAL") ||
                handleMatches[0]
              );
            }
          }
          return (
            candidates.find((s) => s.data.scrapeStatus === "SUCCESS" || s.data.scrapeStatus === "PARTIAL") ||
            candidates[0] ||
            null
          );
        };
        const latestSuccessSnap =
          parsedSnaps.find((s) => s.data.scrapeStatus === "SUCCESS" && (s.data.postCount > 0 || s.data.storedHistoricalPostCount > 0)) ||
          parsedSnaps.find((s) => s.data.scrapeStatus === "SUCCESS") ||
          parsedSnaps[0] ||
          null;
        const igProfile = ownedProfiles.find((p) => p.platform === "instagram");
        const ytProfile = ownedProfiles.find((p) => p.platform === "youtube");
        const ttProfile = ownedProfiles.find((p) => p.platform === "tiktok");
        const liProfile = ownedProfiles.find((p) => p.platform === "linkedin");
        const igSnap = findBestSnapForPlatform("instagram", igProfile?.handle || igProfile?.url);
        const ytSnap = findBestSnapForPlatform("youtube", ytProfile?.handle || ytProfile?.url);
        const ttSnap = findBestSnapForPlatform("tiktok", ttProfile?.handle || ttProfile?.url);
        const liSnap = findBestSnapForPlatform("linkedin", liProfile?.handle || liProfile?.url);

        const igPostRows = ownedPostRows.filter((op) => op.platform === "instagram");
        const ytPostRows = ownedPostRows.filter((op) => op.platform === "youtube");
        const ttPostRows = ownedPostRows.filter((op) => op.platform === "tiktok");
        const liPostRows = ownedPostRows.filter((op) => op.platform === "linkedin");
        const igWin = calculateOwnedPlatformWindowCounts(igPostRows, lifecycle);
        const ytWin = calculateOwnedPlatformWindowCounts(ytPostRows, lifecycle);
        const ttWin = calculateOwnedPlatformWindowCounts(ttPostRows, lifecycle);
        const liWin = calculateOwnedPlatformWindowCounts(liPostRows, lifecycle);

        const liIdentityParsed = liProfile ? parseLinkedInIdentity(liProfile.url || liProfile.handle || "") : null;
        const isLiUnresolved =
          Boolean(liProfile && (liProfile.url || liProfile.handle)) &&
          (!liIdentityParsed || !liIdentityParsed.valid);

        ownedChannelEngagement = {
          campaignCreatedAt: lifecycle.campaignCreatedAt,
          campaignActivatedAt: lifecycle.initialActivatedAt,
          activePlanActivatedAt: lifecycle.activePlanActivatedAt,
          campaignWindowStart: lifecycle.campaignWindowStart,
          registeredProfiles: ownedProfiles.map((p) => {
            const pLower = p.platform.toLowerCase();
            const pSnap = findBestSnapForPlatform(pLower, p.handle || p.url);
            const isUnresolvedLi =
              pLower === "linkedin" &&
              !parseLinkedInIdentity(p.url || p.handle || "").valid;
            return {
              id: p.id,
              platform: p.platform,
              handle: p.handle,
              url: p.url,
              channelId: pSnap?.data?.channelId ?? null,
              channelUrl: pSnap?.data?.channelUrl ?? null,
              channelName: pSnap?.data?.channelName ?? null,
              accountType: pSnap?.data?.accountType ?? (p.url?.includes("/in/") || p.handle?.startsWith("in/") ? "personal" : p.url?.includes("/company") || p.handle?.startsWith("company") ? "company" : null),
              identityStatus: isUnresolvedLi ? "UNRESOLVED" : pSnap?.data?.identityStatus ?? "CONFIRMED",
              scrapeStatus: isUnresolvedLi ? "IDENTITY_UNRESOLVED" : pSnap?.data?.scrapeStatus ?? (pSnap?.row?.scrapeSuccess ? "SUCCESS" : "CONFIGURED"),
              scrapeError:
                pSnap?.row?.scrapeError ??
                pSnap?.data?.scrapeError ??
                pSnap?.data?.errorReason ??
                (isUnresolvedLi ? "Saved LinkedIn URL ('https://linkedin.com/company') is missing the company/profile slug. Update it in Settings." : null),
              followersCount: pSnap?.data?.followers ?? (p as any).followersCount ?? 0,
              storedPostsCount: ownedPostRows.filter((op) => op.platform === p.platform).length,
            };
          }),
          latestSnapshotStatus: latestSuccessSnap?.data?.scrapeStatus || "NONE",
          followersCount: igSnap?.data?.followers ?? igProfile?.followersCount ?? latestSuccessSnap?.data?.followers ?? 0,
          postsCount: ownedPostRows.length,
          storedOwnedPostsCount: ownedPostRows.length,
          countMeaning: "stored_unique_items_in_db",
          platformCounts: {
            instagram: {
              storedUniqueItems: igPostRows.length,
              fetchedWindowItems: igSnap?.data?.fetchedWindowPostCount ?? igSnap?.data?.postCount ?? igPostRows.length,
              postsSinceCreationItems: igWin.postsSinceCreationCount,
              postsSinceActivationItems: igWin.postsSinceActivationCount,
              activePlanWindowItems: igWin.activePlanWindowPostCount,
              inWindowItems: igWin.inWindowPostCount,
              rolling30dItems: igWin.rolling30dPostCount,
              accountTotalContent: igSnap?.data?.accountTotalContent ?? null,
              accountTotalDisplay: igSnap?.data?.accountTotalContent ?? "UNKNOWN",
            },
            youtube: {
              channelId: ytSnap?.data?.channelId ?? null,
              channelUrl: ytSnap?.data?.channelUrl ?? null,
              channelName: ytSnap?.data?.channelName ?? null,
              verifiedChannelOwnershipCount: ytSnap?.data?.verifiedChannelOwnershipCount ?? ytPostRows.length,
              storedUniqueItems: ytPostRows.length,
              fetchedWindowItems: ytSnap?.data?.fetchedWindowPostCount ?? ytSnap?.data?.postCount ?? ytPostRows.length,
              postsSinceCreationItems: ytWin.postsSinceCreationCount,
              postsSinceActivationItems: ytWin.postsSinceActivationCount,
              activePlanWindowItems: ytWin.activePlanWindowPostCount,
              inWindowItems: ytWin.inWindowPostCount,
              rolling30dItems: ytWin.rolling30dPostCount,
              accountTotalContent: ytSnap?.data?.accountTotalContent ?? null,
              accountTotalDisplay: ytSnap?.data?.accountTotalContent ?? "UNKNOWN",
            },
            tiktok: {
              storedUniqueItems: ttPostRows.length,
              fetchedWindowItems: ttSnap?.data?.fetchedWindowPostCount ?? ttSnap?.data?.postCount ?? ttPostRows.length,
              postsSinceCreationItems: ttWin.postsSinceCreationCount,
              postsSinceActivationItems: ttWin.postsSinceActivationCount,
              activePlanWindowItems: ttWin.activePlanWindowPostCount,
              inWindowItems: ttWin.inWindowPostCount,
              rolling30dItems: ttWin.rolling30dPostCount,
              accountTotalContent: ttSnap?.data?.accountTotalContent ?? null,
              accountTotalDisplay: ttSnap?.data?.accountTotalContent ?? "UNKNOWN",
            },
            linkedin: {
              connected: Boolean(liProfile && (liProfile.url || liProfile.handle)),
              url: liProfile?.url ?? null,
              handle: liProfile?.handle ?? null,
              channelId: liSnap?.data?.channelId ?? liIdentityParsed?.slug ?? null,
              channelName: liSnap?.data?.channelName ?? liIdentityParsed?.slug ?? null,
              profileDossier: liSnap?.data?.profileDossier ?? null,
              isConfirmedEmpty: liSnap?.data?.isConfirmedEmpty === true && liPostRows.length === 0,
              accountType: liSnap?.data?.accountType ?? liIdentityParsed?.kind ?? (liProfile?.url?.includes("/in/") || liProfile?.handle?.startsWith("in/") ? "personal" : "company"),
              identityStatus: isLiUnresolved ? "UNRESOLVED" : liProfile ? "CONFIRMED" : "NOT_CONNECTED",
              scrapeStatus: isLiUnresolved
                ? "IDENTITY_UNRESOLVED"
                : liSnap?.data?.scrapeStatus ?? (liSnap?.row?.scrapeSuccess ? "FETCHED" : liProfile ? "CONFIGURED" : "NOT_CONNECTED"),
              scrapeError:
                liSnap?.row?.scrapeError ??
                liSnap?.data?.scrapeError ??
                liSnap?.data?.errorReason ??
                (isLiUnresolved ? "Saved LinkedIn URL ('https://linkedin.com/company') is missing the company/profile slug. Enter your full LinkedIn URL in Settings." : null),
              followersCount: liSnap?.data?.followers ?? null,
              storedUniqueItems: liPostRows.length,
              fetchedWindowItems: liSnap?.data?.fetchedWindowPostCount ?? liSnap?.data?.postCount ?? liPostRows.length,
              postsSinceCreationItems: liWin.postsSinceCreationCount,
              postsSinceActivationItems: liWin.postsSinceActivationCount,
              activePlanWindowItems: liWin.activePlanWindowPostCount,
              inWindowItems: liWin.inWindowPostCount,
              rolling30dItems: liWin.rolling30dPostCount,
              accountTotalContent: liSnap?.data?.accountTotalContent ?? null,
              accountTotalDisplay: liSnap?.data?.accountTotalContent ?? (isLiUnresolved ? "IDENTITY_UNRESOLVED" : "UNKNOWN"),
            },
          },
          lastScrapedAt: latestSuccessSnap?.row?.scrapedAt ? formatStandardDateTime(latestSuccessSnap.row.scrapedAt) : null,
        };
      } catch {
        // non-fatal
      }

      const effectiveChannels =
        channels.length > 0
          ? channels
          : (ownedChannelEngagement?.registeredProfiles || []).map((rp: any) => {
              const isUnresolved = rp.identityStatus === "UNRESOLVED";
              const hasMeasured = (rp.storedPostsCount || 0) > 0;
              const status = isUnresolved ? "NOT_CONNECTED" : hasMeasured ? "WINNING" : "UNTESTED";
              return {
                channel: String(rp.platform || "").toUpperCase(),
                status,
                statusLabel:
                  status === "WINNING"
                    ? "Active / Measured"
                    : status === "NOT_CONNECTED"
                      ? "Not Connected"
                      : "Untested / Setup Phase",
              };
            });

      planPerformance = {
        contextId: perfContext?.id || planId || `ctx_${campaignId}`,
        mode: perfContext?.mode || "BUILD",
        strategyRootId: rootId,
        strategyRootVersion: rootVersion,
        strategyName,
        planId,
        planVersion,
        planSummary,
        commercialVerdictStatus,
        truthStatus,
        rhythmCompliance,
        ownedChannelEngagement,
        currentReality: perfContext?.currentReality || "Baseline acquisition measurement",
        primaryBottleneck: cleanBottleneck,
        hasBottleneck: !!cleanBottleneck,
        weakestSignals: (perfContext?.weakestSignals || []).filter((w: string) => w && w !== "NONE" && w !== "UNKNOWN"),
        proofGaps: perfContext?.proofGaps || [],
        strongestSignals: perfContext?.strongestSignals || [],
        activeChannels: effectiveChannels,
        recentTrend: perfContext?.recentTrend || "BASELINE_ESTABLISHING",
        confidence: perfContext?.confidence || "MEDIUM",
        freshness: perfContext?.freshness || "FRESH",
        evidenceIds: perfContext?.evidenceRefIds || [],
        warningsCount: discreteSignals.length,
        updatedAt: formatStandardDateTime(perfContext?.createdAt || strategicPlan?.createdAt || new Date()),
      };
    }

    const { resolveEffectiveNow, resolveCampaignReportingTimezone } = await import("../performance-loop/clock");
    const effectiveNow = resolveEffectiveNow(campaignId, req.query.nowOverride as string | undefined, req);

    const effAccId = accountId || activeRoot?.accountId || (await resolveEffectiveAccountId(undefined, campaignId)) || "";
    let pendingClarificationRequest: any = null;
    let answeredClarificationHistory: any[] = [];
    let weeklyInventory: any = null;
    let completedWeeklyInventories: any[] = [];
    let scheduleHealth: any = null;
    let reportingTimezone = "UTC";
    let activeNotifications: any[] = [];

    const parseStructuredAnswerValue = (val: unknown): any => {
      if (!val) return null;
      if (typeof val === "object") return val;
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return null;
    };

    const baselineFieldsDescriptor = [
      {
        key: "operatingDurationMonths",
        label: "Operating History (Months)",
        unit: "months",
        type: "number",
        whyNeeded: "Determines whether the business is a new launch (<6 months) or an established operation.",
      },
      {
        key: "hasHistoricalPayingCustomers",
        label: "Any Paying Customers Prior to This Campaign Window?",
        unit: "boolean",
        type: "boolean",
        whyNeeded: "Establishes whether the offer has validated historical willingness-to-pay.",
      },
      {
        key: "historicalPayingCustomersCount",
        label: "Historical Paying Customers Count (Optional)",
        unit: "customers",
        type: "number",
        whyNeeded: "Quantifies baseline customer traction prior to the active strategy plan.",
      },
      {
        key: "historicalLeadsCount",
        label: "Historical Leads / Signups Count (Optional)",
        unit: "leads",
        type: "number",
        whyNeeded: "Helps calibrate baseline lead-to-sale conversion expectations.",
      },
    ];

    if (effAccId) {
      try {
        const clarRows = await db
          .select()
          .from(schema.clarificationRequests)
          .where(
            and(
              eq(schema.clarificationRequests.accountId, effAccId),
              eq(schema.clarificationRequests.campaignId, campaignId)
            )
          )
          .orderBy(desc(schema.clarificationRequests.createdAt));

        answeredClarificationHistory = clarRows
          .filter((r) => r.status === "ANSWERED")
          .map((r) => ({
            ...r,
            questionText: (r as any).question || (r as any).questionText || "",
            structuredAnswerParsed: parseStructuredAnswerValue(r.structuredAnswer),
            fields: baselineFieldsDescriptor,
          }));

        // Show pending baseline form ONLY while the canonical baseline request is pending and unanswered
        const pendingRow = answeredClarificationHistory.length === 0
          ? clarRows.find((r) => r.status === "PENDING")
          : null;

        if (pendingRow) {
          pendingClarificationRequest = {
            ...pendingRow,
            questionText: (pendingRow as any).question || (pendingRow as any).questionText || "",
            structuredAnswerParsed: parseStructuredAnswerValue(pendingRow.structuredAnswer),
            whyNeeded:
              "Performance Loop separates one-time historical business baseline facts (operating duration and prior paying customers) from recurring 7-day commercial results so it never confuses 'new launch' with 'failing conversion funnel' or treats unknown data as zero.",
            fields: baselineFieldsDescriptor,
          };
        }
      } catch (clarErr: any) {
        console.warn("[AdaptiveReadRouter] clarification read warning:", clarErr?.message);
      }

      try {
        const {
          getOrCreateWeeklyInventory,
          formatWeeklyInventoryHistoryRow,
        } = await import("../performance-loop/weekly-inventory-engine");
        weeklyInventory = await getOrCreateWeeklyInventory(effAccId, campaignId, effectiveNow);
        reportingTimezone = weeklyInventory?.reportingTimezone || resolveCampaignReportingTimezone(null);

        const histInv = await db
          .select()
          .from(schema.weeklyBusinessInventories)
          .where(
            and(
              eq(schema.weeklyBusinessInventories.accountId, effAccId),
              eq(schema.weeklyBusinessInventories.campaignId, campaignId),
              eq(schema.weeklyBusinessInventories.status, "COMPLETED")
            )
          )
          .orderBy(desc(schema.weeklyBusinessInventories.periodEnd))
          .limit(12);
        completedWeeklyInventories = histInv.map((row) =>
          formatWeeklyInventoryHistoryRow(row, reportingTimezone)
        );
      } catch (invErr: any) {
        console.warn("[AdaptiveReadRouter] weeklyInventory read warning:", invErr?.message);
      }

      try {
        const { syncNotificationsForCampaign } = await import("../notifications-routes");
        await syncNotificationsForCampaign(effAccId, campaignId, effectiveNow);
        const notifRows = await db
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.accountId, effAccId),
              eq(schema.notifications.campaignId, campaignId),
              eq(schema.notifications.isRead, false)
            )
          )
          .orderBy(desc(schema.notifications.createdAt))
          .limit(20);
        activeNotifications = notifRows;
      } catch (notifErr: any) {
        console.warn("[AdaptiveReadRouter] notifications sync warning:", notifErr?.message);
      }

      try {
        const { getUnifiedScheduleHealth } = await import("../watchtower/scheduler");
        scheduleHealth = await getUnifiedScheduleHealth(effAccId, campaignId, effectiveNow);
      } catch (schedErr: any) {
        console.warn("[AdaptiveReadRouter] scheduleHealth read warning:", schedErr?.message);
      }
    }

    const isBaselineDue = Boolean(pendingClarificationRequest && pendingClarificationRequest.status === "PENDING");
    const isWeeklyCheckInDue = Boolean(weeklyInventory?.isDue);
    const dueState = {
      isBaselineDue,
      isWeeklyCheckInDue,
      dueActionsCount: (isBaselineDue ? 1 : 0) + (isWeeklyCheckInDue ? 1 : 0),
      effectiveNow: effectiveNow.toISOString(),
      reportingTimezone,
    };

    if (planPerformance) {
      planPerformance.pendingClarificationRequest = pendingClarificationRequest;
      planPerformance.answeredClarificationHistory = answeredClarificationHistory;
      planPerformance.weeklyInventory = weeklyInventory;
      planPerformance.completedWeeklyInventories = completedWeeklyInventories;
      planPerformance.scheduleHealth = scheduleHealth;
      planPerformance.reportingTimezone = reportingTimezone;
      planPerformance.dueState = dueState;
      planPerformance.activeNotifications = activeNotifications;
    }

    let historicalPerformanceCases: any[] = [];
    if (process.env.AVYRON_DEMO_MODE === "1") {
      const { DEMO_PERFORMANCE_LOOP_CASES } = await import(
        "../demo/scenarios-extension"
      );
      historicalPerformanceCases = DEMO_PERFORMANCE_LOOP_CASES;
    }

    return res.json({
      campaignId,
      accountId: effAccId || null,
      currentStrategyRootId: rootId,
      currentStrategyRootVersion: rootVersion,
      currentStrategyName: strategyName,
      businessUnderstanding: buData,
      planPerformance,
      pendingClarificationRequest,
      answeredClarificationHistory,
      weeklyInventory,
      completedWeeklyInventories,
      scheduleHealth,
      reportingTimezone,
      dueState,
      activeNotifications,
      historicalPerformanceCases,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Performance Loop overview error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 1B. SURFACE: WATCHTOWER TRACE (DETECTION LOG ONLY)
// ============================================================================
// Constitutional Principle: Watchtower is a TRACE — who, what, when, status.
// Full intelligence lives in Reasoning.
adaptiveReadRouter.get("/watchtower/trace/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    const rawEvents = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(eq(schema.pipelineChangeEvents.campaignId, campaignId))
      .orderBy(desc(schema.pipelineChangeEvents.createdAt))
      .limit(50);

    const traceEvents = rawEvents.map(({ event: evt, competitor }) => {
      const signal = adaptWatchtowerEventToAdaptiveSignal(evt);
      return {
        eventId: evt.id,
        competitorName: competitor?.name || (evt as any).competitorName || "Market Competitor",
        eventType: translateEventTypeToTitle(evt.kind || signal.signalType),
        firstObservedAt: formatStandardDate(evt.createdAt),
        confirmedAt: evt.validatedAt ? formatStandardDate(evt.validatedAt) : null,
        status: signal.confirmationState,
        severity: signal.severity,
        // Reasoning link for click-through
        reasoningLink: `/(tabs)/reasoning-evidence?tab=events&eventId=${evt.id}`,
      };
    });

    return res.json({
      campaignId,
      totalCount: traceEvents.length,
      events: traceEvents,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Watchtower trace error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2. SURFACE B: REASONING EVENTS (FULL CONFIRMED MARKET INTELLIGENCE FEED)
// ============================================================================
// Constitutional Principle: Reasoning Events is the customer-facing intelligence feed.
// STRICT CONSTITUTIONAL RULE: ONLY confirmed market events enter Reasoning Events.
// First observations, candidates, archived, and dismissed events remain in Watchtower trace only.
adaptiveReadRouter.get("/reasoning/events/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    const rawEvents = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(
        and(
          eq(schema.pipelineChangeEvents.campaignId, campaignId),
          eq(schema.pipelineChangeEvents.status, "confirmed")
        )
      )
      .orderBy(desc(schema.pipelineChangeEvents.createdAt))
      .limit(50);

    // Batch-fetch all strategic briefs for these events in one query
    const eventIds = rawEvents.map(r => r.event.id);
    const allBriefs = eventIds.length > 0
      ? await db
          .select()
          .from(schema.watchtowerStrategicBriefs)
          .where(inArray(schema.watchtowerStrategicBriefs.eventId, eventIds))
      : [];

    const allProposals = await db
      .select()
      .from(schema.strategyChangeProposals)
      .where(eq(schema.strategyChangeProposals.campaignId, campaignId));

    // Index briefs by eventId (prioritizing ready status, then most recent)
    const briefsByEvent: Record<string, any> = {};
    for (const brief of allBriefs) {
      const existing = briefsByEvent[brief.eventId];
      if (!existing) {
        briefsByEvent[brief.eventId] = brief;
      } else if (brief.status === "ready" && existing.status !== "ready") {
        briefsByEvent[brief.eventId] = brief;
      } else if (brief.status === existing.status && new Date(brief.createdAt) > new Date(existing.createdAt)) {
        briefsByEvent[brief.eventId] = brief;
      }
    }

    const marketSignals = rawEvents.map(({ event: evt, competitor }) => {
      const signal = adaptWatchtowerEventToAdaptiveSignal(evt);
      const briefRow = briefsByEvent[evt.id] || null;
      const brief = briefRow?.brief || null;
      const briefStatus = briefRow?.status || "NO_BRIEF";

      let parsedEv: Record<string, any> = {};
      if (evt.evidence) {
        try {
          parsedEv =
            typeof evt.evidence === "string"
              ? JSON.parse(evt.evidence)
              : (evt.evidence as any) || {};
        } catch {}
      }

      // Explicit intelligence state determination
      let intelligenceStatus: "READY" | "PENDING" | "FAILED" = "PENDING";
      let intelligenceSummary = "";
      let whatChanged: string | null = null;
      let strategicInterpretation: string | null = null;
      let marketSignificance: string | null = null;
      let impactOnStrategy: string | null = null;
      let recommendation: string | null = null;
      let directionOfMovement: string | null = null;

      if (briefStatus === "ready" && brief && (brief.executiveSummary || brief.strategicInterpretation)) {
        intelligenceStatus = "READY";
        intelligenceSummary = brief.executiveSummary || "Confirmed market shift with strategic interpretation.";
        whatChanged = brief.executiveSummary || evt.evidenceSummary || null;
        strategicInterpretation = brief.strategicInterpretation || null;
        marketSignificance = brief.marketSignificance || null;
        impactOnStrategy = brief.impactOnOurStrategy || null;
        recommendation = brief.recommendation || null;
        directionOfMovement = brief.directionOfMovement || null;
      } else if (briefStatus === "failed" || briefStatus === "insufficient_evidence") {
        intelligenceStatus = "FAILED";
        intelligenceSummary = "Strategic intelligence analysis unavailable due to insufficient market telemetry.";
      } else {
        intelligenceStatus = "PENDING";
        intelligenceSummary = "Strategic analysis in progress...";
      }

      const linkedProposal = allProposals.find((p) => {
        const meta = (p.metadata as any) || {};
        return meta.eventId === evt.id || p.id === parsedEv.proposalId;
      });

      return {
        ...signal,
        sourceDomain: "MARKET" as const,
        competitorName:
          competitor?.name ||
          parsedEv.competitorName ||
          (evt as any).competitorName ||
          "Market Competitor",
        confirmationLabel: "Confirmed Change",
        businessFriendlyType:
          parsedEv.title || translateEventTypeToTitle(evt.kind || signal.signalType),
        categoryType: translateEventTypeToTitle(evt.kind || signal.signalType),
        observedAtFormatted: formatStandardDate(signal.observedAt),
        confirmedAtFormatted: evt.validatedAt ? formatStandardDate(evt.validatedAt) : formatStandardDate(signal.observedAt),
        intelligenceStatus,
        summary: intelligenceSummary,
        whatChanged,
        strategicInterpretation,
        marketSignificance,
        impactOnStrategy,
        recommendation,
        directionOfMovement,
        hasBrief: intelligenceStatus === "READY",
        beforeState: parsedEv.beforeState || parsedEv.prev || null,
        afterState: parsedEv.afterState || parsedEv.curr || null,
        productReferenced: parsedEv.productReferenced || null,
        segmentName: parsedEv.segmentName || null,
        laneId: parsedEv.laneId || null,
        laneTitle: parsedEv.laneTitle || null,
        businessRelevance: parsedEv.businessRelevance || marketSignificance || null,
        actionabilityType: parsedEv.actionabilityType || null,
        nextActionLabel: parsedEv.nextActionLabel || null,
        linkedScenarioId: parsedEv.linkedScenarioId || null,
        investigationStatus: linkedProposal
          ? linkedProposal.status
          : parsedEv.investigationStatus ||
            (parsedEv.linkedScenarioId ? "PENDING_INVESTIGATION" : null),
        proposalId: linkedProposal?.id || parsedEv.proposalId || null,
        appliedStrategyVersion:
          linkedProposal?.appliedNewBundleVersion ||
          parsedEv.appliedStrategyVersion ||
          null,
        evidenceUrls: Array.isArray(parsedEv.evidenceUrls)
          ? parsedEv.evidenceUrls
          : [],
      };
    });

    return res.json({
      campaignId,
      totalCount: marketSignals.length,
      events: marketSignals,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Reasoning events error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 2B. EVENT DETAIL INVESTIGATION (FULL 16-POINT TRACEABILITY)
// ============================================================================
adaptiveReadRouter.get(["/reasoning/event-detail/:eventId", "/reasoning/events/:campaignId/:eventId"], async (req: Request, res: Response) => {
  try {
    const { eventId, campaignId } = req.params;

    const [eventRow] = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(eq(schema.pipelineChangeEvents.id, eventId))
      .limit(1);

    if (!eventRow) {
      return res.status(404).json({ error: `Market event "${eventId}" not found.` });
    }

    const { event: evt, competitor } = eventRow;

    // Constitutional Protection: Only confirmed events are retrievable through Reasoning surface
    if (evt.status !== "confirmed") {
      return res.status(404).json({ error: `Market event "${eventId}" is not a confirmed market intelligence event.` });
    }

    // Cross-campaign security check
    if (campaignId && evt.campaignId !== campaignId) {
      return res.status(403).json({ error: "Cross-campaign event access denied." });
    }

    const signal = adaptWatchtowerEventToAdaptiveSignal(evt);

    // Fetch linked strategic brief if exists
    const [briefRow] = await db
      .select()
      .from(schema.watchtowerStrategicBriefs)
      .where(eq(schema.watchtowerStrategicBriefs.eventId, evt.id))
      .orderBy(desc(schema.watchtowerStrategicBriefs.createdAt))
      .limit(1);

    // Fetch linked reasoning cases & adaptive decisions
    const linkedCases = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.campaignId, evt.campaignId))
      .limit(20);

    const matchingCases = linkedCases.filter(c => 
      (c.marketEventIds as string[] || []).includes(evt.id)
    );

    const caseIds = matchingCases.map(c => c.id);
    const linkedDecisions = caseIds.length > 0
      ? await db.select().from(schema.adaptiveDecisions).where(inArray(schema.adaptiveDecisions.reasoningCaseId, caseIds))
      : [];

    const linkedOutcomes = caseIds.length > 0
      ? await db.select().from(schema.strategyAdaptationOutcomes).where(inArray(schema.strategyAdaptationOutcomes.reasoningCaseId, caseIds))
      : [];

    // Fetch active performance warnings for context
    const [activeContext] = await db
      .select()
      .from(schema.performanceContexts)
      .where(eq(schema.performanceContexts.campaignId, evt.campaignId))
      .orderBy(desc(schema.performanceContexts.createdAt))
      .limit(1);

    const linkedWarnings = activeContext ? adaptPerformanceContextToSignals(activeContext).map(w => ({
      signalId: w.signalId,
      title: translateSignalTypeToTitle(w.signalType, w.summary),
      severity: w.severity,
    })) : [];

    const confirmationHistory = [
      {
        step: "First Observation",
        timestamp: formatStandardDateTime(evt.createdAt),
        description: `Potential ${translateEventTypeToTitle(evt.kind)} detected during routine competitor scan.`,
      },
    ];

    if (evt.validatedAt || signal.confirmationState === "CONFIRMED") {
      confirmationHistory.push({
        step: "Confirmation Check",
        timestamp: formatStandardDateTime(evt.validatedAt || evt.updatedAt || evt.createdAt),
        description: "Independent secondary fetch confirmed the same market change.",
      });
    }

    // Extract evidence items and before/after states safely
    let parsedEvidence: any[] = [];
    let parsedEvidenceObj: Record<string, any> = {};
    let beforeStateVal: string | null = (evt as any).beforeState || (evt as any).previousValue || null;
    let afterStateVal: string | null = (evt as any).afterState || (evt as any).currentValue || null;
    if (evt.evidence) {
      if (Array.isArray(evt.evidence)) {
        parsedEvidence = evt.evidence;
      } else if (typeof evt.evidence === "string") {
        try {
          const parsed = JSON.parse(evt.evidence);
          if (Array.isArray(parsed)) {
            parsedEvidence = parsed;
          } else if (parsed && typeof parsed === "object") {
            parsedEvidenceObj = parsed;
            beforeStateVal = beforeStateVal || parsed.beforeState || parsed.prev || null;
            afterStateVal = afterStateVal || parsed.afterState || parsed.curr || null;
            parsedEvidence = Array.isArray(parsed.notes)
              ? parsed.notes
              : [parsed];
          }
        } catch {
          parsedEvidence = [{ note: evt.evidence }];
        }
      }
    }

    let actionableScenario: any = null;
    if (process.env.AVYRON_DEMO_MODE === "1" && parsedEvidenceObj.linkedScenarioId) {
      const { DEMO_DEEP_REASONING_SCENARIOS } = await import(
        "../demo/scenarios-extension"
      );
      const matchedScenario = DEMO_DEEP_REASONING_SCENARIOS.find(
        (s) =>
          s.scenarioId === parsedEvidenceObj.linkedScenarioId ||
          s.eventId === evt.id,
      );
      if (matchedScenario) {
        const [propRow] = await db
          .select()
          .from(schema.strategyChangeProposals)
          .where(eq(schema.strategyChangeProposals.id, matchedScenario.proposalId))
          .limit(1);
        actionableScenario = {
          ...matchedScenario,
          proposalStatus: propRow?.status || "PENDING_INVESTIGATION",
          appliedVersion: propRow?.appliedNewBundleVersion || null,
        };
      }
    }

    return res.json({
      eventId: evt.id,
      signalId: signal.signalId,
      campaignId: evt.campaignId,
      accountId: evt.accountId,
      competitorId: evt.competitorId,
      competitorName:
        competitor?.name || parsedEvidenceObj.competitorName || "Market Competitor",
      competitorWebsite: competitor?.websiteUrl || null,
      kind: evt.kind,
      businessFriendlyType:
        parsedEvidenceObj.title || translateEventTypeToTitle(evt.kind),
      categoryType: translateEventTypeToTitle(evt.kind),
      confirmationState: signal.confirmationState,
      confirmationLabel: signal.confirmationState === "CONFIRMED" ? "Confirmed Change" : "Preliminary Observation",
      severity: (evt.severity || "MEDIUM").toUpperCase(),
      confidence:
        typeof parsedEvidenceObj.confidence === "number"
          ? parsedEvidenceObj.confidence
          : typeof evt.confidence === "number"
          ? evt.confidence
          : 0.85,
      firstObservedAt: formatStandardDateTime(evt.createdAt),
      validatedAt: evt.validatedAt ? formatStandardDateTime(evt.validatedAt) : null,
      // INTELLIGENCE COMPOSITION: Strategic brief is the primary intelligence source
      summary: briefRow?.brief?.executiveSummary || evt.evidenceSummary || signal.summary,
      whatChanged: briefRow?.brief?.executiveSummary || evt.evidenceSummary || null,
      beforeState: beforeStateVal,
      afterState: afterStateVal,
      productReferenced: parsedEvidenceObj.productReferenced || null,
      segmentName: parsedEvidenceObj.segmentName || null,
      laneId: parsedEvidenceObj.laneId || null,
      laneTitle: parsedEvidenceObj.laneTitle || null,
      businessRelevance:
        parsedEvidenceObj.businessRelevance ||
        briefRow?.brief?.marketSignificance ||
        null,
      actionabilityType: parsedEvidenceObj.actionabilityType || null,
      nextActionLabel: parsedEvidenceObj.nextActionLabel || null,
      linkedScenarioId: parsedEvidenceObj.linkedScenarioId || null,
      investigationStatus:
        actionableScenario?.proposalStatus ||
        parsedEvidenceObj.investigationStatus ||
        null,
      evidenceUrls: Array.isArray(parsedEvidenceObj.evidenceUrls)
        ? parsedEvidenceObj.evidenceUrls
        : [],
      actionableScenario,
      // Strategic brief intelligence fields (the real product value)
      strategicInterpretation: briefRow?.brief?.strategicInterpretation || null,
      marketSignificance: briefRow?.brief?.marketSignificance || null,
      directionOfMovement: briefRow?.brief?.directionOfMovement || null,
      likelyStrategicObjective: briefRow?.brief?.likelyStrategicObjective || null,
      impactOnOurStrategy: briefRow?.brief?.impactOnOurStrategy || null,
      recommendation: briefRow?.brief?.recommendation || null,
      assumptions: briefRow?.brief?.assumptions || [],
      missingEvidence: briefRow?.brief?.missingEvidence || [],
      claims: briefRow?.brief?.claims || [],
      // Supporting evidence (backend lineage, NOT the product itself)
      evidenceItems: parsedEvidence,
      confirmationHistory,
      strategicBrief: briefRow ? {
        briefId: briefRow.id,
        status: briefRow.status,
        confidence: briefRow.finalValidatedConfidence || briefRow.modelProposedConfidence,
        brief: briefRow.brief,
      } : null,
      linkedPerformanceWarnings: linkedWarnings,
      linkedReasoningCases: matchingCases.map(c => {
        const dec = linkedDecisions.find(d => d.reasoningCaseId === c.id);
        const out = linkedOutcomes.find(o => o.reasoningCaseId === c.id);
        const trans = dec ? translateDecisionToBusinessLanguage(dec.decisionType, dec.affectedAuthority as any) : null;
        return {
          reasoningCaseId: c.id,
          strategyRootVersion: c.strategyRootVersion,
          status: c.status,
          openedAt: formatStandardDate(c.openedAt),
          adaptiveDecision: trans ? { action: trans.label, status: trans.statusBadge } : null,
          adaptationOutcome: out ? { outcome: out.outcomeClassification, summary: out.summary } : null,
        };
      }),
      watchtowerLink: `/watchtower?competitorId=${evt.competitorId}`,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Event detail error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. SURFACE C: REASONING WARNINGS (DISCRETE CURRENT SIGNALS + INVESTIGATED WARNINGS)
// ============================================================================
adaptiveReadRouter.get("/reasoning/warnings/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // 1. Fetch current active context
    const [activeContext] = await db
      .select()
      .from(schema.performanceContexts)
      .where(eq(schema.performanceContexts.campaignId, campaignId))
      .orderBy(desc(schema.performanceContexts.createdAt))
      .limit(1);

    // 2. Fetch all reasoning cases for campaign to find investigated performance warnings
    const cases = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.campaignId, campaignId));

    const allWarnings: any[] = [];
    const seenTitles = new Set<string>();

    // 3. Extract warnings from active context (Current Active Production Warnings)
    if (activeContext) {
      const extracted = adaptPerformanceContextToSignals(activeContext);
      for (const sig of extracted) {
        const title = translateSignalTypeToTitle(sig.signalType, sig.summary);
        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          allWarnings.push({
            signalId: sig.signalId,
            performanceContextId: sig.sourceArtifactId,
            sourceDomain: "PERFORMANCE" as const,
            signalType: sig.signalType,
            businessFriendlyTitle: title,
            summary: sig.summary,
            severity: sig.severity,
            confidence: sig.confidence,
            confidenceLabel: sig.confidence >= 0.8 ? "High Confidence" : "Moderate Confidence",
            observedAt: sig.observedAt,
            observedAtFormatted: formatStandardDate(sig.observedAt),
            isHistorical: false,
            status: "ACTIVE",
          });
        }
      }
    }

    // 4. Extract warnings investigated in Reasoning Cases (marked as HISTORICAL if from prior root or case investigation)
    for (const c of cases) {
      const warningIds = (c.performanceWarningIds as string[] || []);
      for (const id of warningIds) {
        let title = "Strategic Performance Warning";
        let severity = "HIGH";
        let summary = "Performance metrics indicate strategic friction in the acquisition pathway.";
        let observedAt = c.openedAt instanceof Date ? c.openedAt.toISOString() : (c.openedAt || new Date().toISOString());

        // Historical / fixture ID fallback & semantic token resolution
        if (id.includes("bottleneck")) {
          title = "Funnel Conversion Friction";
          summary = "Conversion metrics across active channels have fallen below expected baselines.";
          severity = "HIGH";
        } else if (id.includes("gap")) {
          title = "Offer Consideration Resistance";
          summary = "Proof and offer considerations are creating hesitation in the conversion pathway.";
          severity = "HIGH";
        } else if (id.includes("lead_pace")) {
          title = "Qualified Lead Pace Declining";
          summary = "Pace of qualified lead inquiries has decreased over the measurement window.";
          severity = "CRITICAL";
        } else if (id.includes("reach")) {
          title = "Top-of-Funnel Reach Bottleneck";
          summary = "Top-of-funnel audience reach has dropped below target thresholds.";
          severity = "HIGH";
        } else if (id.includes("social")) {
          title = "Social Engagement Data Missing";
          summary = "Social media engagement channels lack sufficient performance telemetry.";
          severity = "MEDIUM";
        } else {
          title = translateSignalTypeToTitle(id);
        }

        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          allWarnings.push({
            signalId: id,
            performanceContextId: id,
            sourceDomain: "PERFORMANCE" as const,
            signalType: id.includes("bottleneck") ? "CONVERSION_FRICTION" : (id.includes("gap") ? "OFFER_FRICTION" : "PERFORMANCE_GAP"),
            businessFriendlyTitle: title,
            summary,
            severity,
            confidence: severity === "CRITICAL" ? 0.9 : 0.8,
            confidenceLabel: severity === "CRITICAL" ? "High Confidence" : "Moderate Confidence",
            observedAt,
            observedAtFormatted: formatStandardDate(observedAt),
            isHistorical: true,
            status: "HISTORICAL",
          });
        }
      }
    }

    const activeCount = allWarnings.filter(w => !w.isHistorical).length;
    const historicalCount = allWarnings.filter(w => w.isHistorical).length;

    return res.json({
      campaignId,
      totalCount: allWarnings.length,
      activeCount,
      historicalCount,
      warnings: allWarnings,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Reasoning warnings error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3B. WARNING DETAIL INVESTIGATION (FULL 16-POINT TRACEABILITY)
// ============================================================================
adaptiveReadRouter.get(["/reasoning/warning-detail/:signalId", "/reasoning/warnings/:campaignId/:signalId"], async (req: Request, res: Response) => {
  try {
    const { signalId, campaignId } = req.params;

    // Extract underlying context ID
    let contextId = signalId.replace(/^sig_perf_bottleneck_/, "").replace(/^sig_perf_gap_/, "").replace(/^sig_perf_/, "").replace(/^sig_/, "");
    if (contextId.includes("_")) {
      contextId = contextId.split("_")[0];
    }

    let [perfContext] = await db
      .select()
      .from(schema.performanceContexts)
      .where(eq(schema.performanceContexts.id, contextId))
      .limit(1);

    if (!perfContext && campaignId) {
      [perfContext] = await db
        .select()
        .from(schema.performanceContexts)
        .where(eq(schema.performanceContexts.campaignId, campaignId))
        .orderBy(desc(schema.performanceContexts.createdAt))
        .limit(1);
    }

    if (!perfContext) {
      return res.status(404).json({ error: `Performance warning context for "${signalId}" not found.` });
    }

    // Cross-campaign security check
    if (campaignId && perfContext.campaignId !== campaignId) {
      return res.status(403).json({ error: "Cross-campaign warning access denied." });
    }

    // Fetch active Strategy Root & Root Bundle version through designated active plan
    const warningLineage = await resolveDesignatedActiveLineage(perfContext.campaignId, perfContext.accountId);
    const rootVersion = warningLineage.strategyRootVersion;

    // Fetch all market events for campaign to filter out fixture cases from linked cases
    const campaignEvents = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(eq(schema.pipelineChangeEvents.campaignId, perfContext.campaignId));

    // Fetch linked reasoning cases
    const linkedCases = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.campaignId, perfContext.campaignId))
      .limit(20);

    const validLinkedCases = linkedCases.filter(c => {
      const marketIds = (c.marketEventIds as string[] || []);
      if (marketIds.length > 0) {
        const hasFixtureEvent = marketIds.some(id => !campaignEvents.some(e => e.event.id === id));
        if (hasFixtureEvent) return false;
      }
      return true;
    });

    const matchingCases = validLinkedCases.filter(c =>
      (c.performanceWarningIds as string[] || []).some(id => id === signalId || id === perfContext.id)
    );

    // Fetch related market events
    const relatedEvents = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(eq(schema.pipelineChangeEvents.campaignId, perfContext.campaignId))
      .limit(5);

    let cleanTitle = translateSignalTypeToTitle(perfContext.primaryBottleneck, perfContext.currentReality);
    let affectedArea = perfContext.primaryBottleneck && perfContext.primaryBottleneck !== "NONE" && perfContext.primaryBottleneck !== "UNKNOWN"
      ? perfContext.primaryBottleneck
      : "Funnel Acquisition / Channels";

    if (signalId.includes("_gap_")) {
      const match = signalId.match(/_gap_.*?_(\d+)$/);
      const gapIndex = match ? parseInt(match[1], 10) : 0;
      const rawGap = (perfContext.weakestSignals || [])[gapIndex] || perfContext.weakestSignals?.[0] || "OFFER_FRICTION";
      cleanTitle = translateSignalTypeToTitle("PERFORMANCE_GAP", rawGap);
      affectedArea = "Proof & Offer Friction";
    } else if (signalId.includes("lead_pace")) {
      cleanTitle = "Qualified Lead Pace Declining";
      affectedArea = "Lead Acquisition";
    } else if (signalId.includes("bottleneck")) {
      cleanTitle = "Funnel Conversion Friction";
      affectedArea = "Funnel Conversion";
    }

    return res.json({
      signalId,
      performanceContextId: perfContext.id,
      campaignId: perfContext.campaignId,
      warningTitle: cleanTitle,
      affectedArea,
      severity: perfContext.confidence === "HIGH" ? "CRITICAL" : "HIGH",
      confidence: perfContext.confidence === "HIGH" ? 0.92 : 0.82,
      confidenceLabel: perfContext.confidence === "HIGH" ? "High Confidence" : "Moderate Confidence",
      detectedAt: formatStandardDateTime(perfContext.createdAt),
      strategyRootVersion: rootVersion,
      mode: perfContext.mode || "BUILD",
      currentReality: perfContext.currentReality || "Baseline acquisition measurement",
      primaryBottleneck: cleanTitle,
      currentValue: "Not enough measured data yet.",
      previousValue: "Not enough measured data yet.",
      baseline: "Establishing Initial Baseline",
      timeWindow: "Active Execution Window",
      dataSources: ["User Onboarding Dossier", "Website Audit", "Instagram Connector"],
      weakestSignals: (perfContext.weakestSignals || []).filter((w: string) => w && w !== "NONE" && w !== "UNKNOWN"),
      proofGaps: perfContext.proofGaps || [],
      activeChannels: perfContext.activeChannels || [],
      trend: perfContext.recentTrend || "INSUFFICIENT_DATA",
      freshness: perfContext.freshness || "FRESH",
      evidenceItems: perfContext.evidenceRefIds || [],
      whyAvyronFlaggedIt: perfContext.currentReality
        ? `Performance data indicates: ${perfContext.currentReality}`
        : "Conversion metrics across active channels have fallen below expected strategic baselines.",
      relatedMarketEvents: relatedEvents.map(e => ({
        eventId: e.event.id,
        competitorName: e.competitor?.name || "Competitor",
        title: translateEventTypeToTitle(e.event.kind),
      })),
      linkedReasoningCases: matchingCases.map(c => ({
        reasoningCaseId: c.id,
        strategyRootVersion: c.strategyRootVersion,
        status: c.status,
        openedAt: formatStandardDate(c.openedAt),
      })),
      planPerformanceLink: "/performance?tab=plan_performance",
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Warning detail error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. SURFACE D: DEEP REASONING CASES (COMBINED INVESTIGATION CENTER)
// ============================================================================
adaptiveReadRouter.get("/reasoning/cases/:campaignId", async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;

    // 1. Get current active Strategy Root & Root Bundle version via designated active plan
    const accountId = (req as any).accountId;
    const casesLineage = await resolveDesignatedActiveLineage(campaignId, accountId);
    const currentRootVersion = casesLineage.strategyRootVersion;
    const effAccountId = accountId || casesLineage.activeRoot?.accountId || casesLineage.strategicPlan?.accountId;
    if (effAccountId) {
      try {
        await syncCampaignAdaptiveReasoning({ accountId: effAccountId, campaignId });
      } catch (syncErr: any) {
        console.warn("[AdaptiveReadRouter] syncCampaignAdaptiveReasoning non-fatal warning:", syncErr?.message);
      }
    }

    // 2. Fetch Reasoning Cases for campaign
    const cases = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.campaignId, campaignId))
      .orderBy(desc(schema.reasoningCases.openedAt))
      .limit(20);

    const caseIds = cases.map(c => c.id);
    const hypothesesRows = caseIds.length > 0
      ? await db.select().from(schema.reasoningHypotheses).where(inArray(schema.reasoningHypotheses.reasoningCaseId, caseIds))
      : [];

    const decisionsRows = caseIds.length > 0
      ? await db.select().from(schema.adaptiveDecisions).where(inArray(schema.adaptiveDecisions.reasoningCaseId, caseIds))
      : [];

    const outcomesRows = caseIds.length > 0
      ? await db.select().from(schema.strategyAdaptationOutcomes).where(inArray(schema.strategyAdaptationOutcomes.reasoningCaseId, caseIds))
      : [];

    const proposalsRows = await db
      .select()
      .from(schema.strategyChangeProposals)
      .where(eq(schema.strategyChangeProposals.campaignId, campaignId))
      .orderBy(desc(schema.strategyChangeProposals.createdAt))
      .limit(10);

    // Fetch all market events for campaign to resolve linked event details
    const campaignEvents = await db
      .select({
        event: schema.pipelineChangeEvents,
        competitor: schema.ciCompetitors,
      })
      .from(schema.pipelineChangeEvents)
      .leftJoin(schema.ciCompetitors, eq(schema.pipelineChangeEvents.competitorId, schema.ciCompetitors.id))
      .where(eq(schema.pipelineChangeEvents.campaignId, campaignId));

    // Filter out test-fixture cases that reference ungrounded fixture event IDs (e.g. pce_live_conf_002) not present in campaignEvents
    // and exclude superseded cases from the active investigation list (preserving them in DB history).
    const validCases = cases.filter(c => {
      if (c.status === "CLOSED" && (c.metadata as any)?.superseded === true) {
        return false;
      }
      const marketIds = (c.marketEventIds as string[] || []);
      if (marketIds.length > 0) {
        const hasFixtureEvent = marketIds.some(id => !campaignEvents.some(e => e.event.id === id));
        if (hasFixtureEvent) return false;
      }
      return true;
    });

    // Fetch all performance contexts for campaign
    const campaignContexts = await db
      .select()
      .from(schema.performanceContexts)
      .where(eq(schema.performanceContexts.campaignId, campaignId));

    let demoScenariosCatalog: any[] = [];
    let demoEvidenceMap: Record<string, { id: string; title: string; url: string; sourceType: string }> = {};
    if (process.env.AVYRON_DEMO_MODE === "1") {
      const {
        DEMO_ADDITIONAL_EVIDENCE_RECORDS,
        DEMO_DEEP_REASONING_SCENARIOS,
      } = await import("../demo/scenarios-extension");
      const {
        buildDemoEvidenceUrl,
        DEMO_EVIDENCE_RECORDS,
        DEMO_PRODUCT_FACTS,
      } = await import("../demo/fixtures");
      demoScenariosCatalog = DEMO_DEEP_REASONING_SCENARIOS;
      for (const rec of [...DEMO_EVIDENCE_RECORDS, ...DEMO_ADDITIONAL_EVIDENCE_RECORDS]) {
        demoEvidenceMap[rec.id] = {
          id: rec.id,
          title: rec.title,
          url: buildDemoEvidenceUrl(rec.domainSlug, rec.id),
          sourceType: rec.sourceType,
        };
      }
      for (const fact of DEMO_PRODUCT_FACTS) {
        demoEvidenceMap[fact.factId] = {
          id: fact.factId,
          title: `Product Fact (${fact.factType}): ${fact.statement.slice(0, 72)}...`,
          url: buildDemoEvidenceUrl("zeytun-atelier.demo.invalid", fact.factId),
          sourceType: `FIRST_PARTY_${fact.factType}`,
        };
      }
    }

    const composedCases = validCases.map(c => {
      const hypotheses = hypothesesRows.filter(h => h.reasoningCaseId === c.id);
      const decision = decisionsRows.find(d => d.reasoningCaseId === c.id);
      const outcome = outcomesRows.find(o => o.reasoningCaseId === c.id);
      const matchedDemoScenario = demoScenariosCatalog.find(
        (s) =>
          s.reasoningCaseId === c.id ||
          (c.marketEventIds as string[] || []).includes(s.eventId),
      );

      const isCurrentRoot = c.strategyRootVersion === currentRootVersion;
      const decisionTranslation = decision
        ? translateDecisionToBusinessLanguage(decision.decisionType, decision.affectedAuthority as any)
        : null;

      const linkedMarketEvents = (c.marketEventIds as string[] || []).map(id => {
        const found = campaignEvents.find(e => e.event.id === id);
        let customEvtTitle: string | null = null;
        try {
          const parsedEv =
            typeof found?.event.evidence === "string"
              ? JSON.parse(found.event.evidence)
              : (found?.event.evidence as any);
          if (parsedEv?.title) customEvtTitle = parsedEv.title;
        } catch {}
        return {
          eventId: id,
          title:
            customEvtTitle ||
            matchedDemoScenario?.title ||
            translateEventTypeToTitle(found?.event.kind),
          competitorName: found?.competitor?.name || "Competitor",
          severity: found?.event.severity || "MEDIUM",
        };
      });

      // Robust discrete warning resolution & semantic deduplication for Deep Reasoning
      const rawWarningIds = c.performanceWarningIds as string[] || [];
      const linkedPerformanceWarnings: Array<{ warningId: string; title: string; severity: string }> = [];
      const seenTitles = new Set<string>();

      for (const id of rawWarningIds) {
        const foundCtx = campaignContexts.find(ctx => id.includes(ctx.id) || id === ctx.id);
        let title = "Strategic Performance Warning";
        let severity = "HIGH";

        if (foundCtx) {
          const isUnmeasuredCtx = String(foundCtx.mode || "").toUpperCase() === "UNKNOWN";
          if (id.includes("_gap_")) {
            const match = id.match(/_gap_.*?_(\d+)$/);
            const gapIndex = match ? parseInt(match[1], 10) : 0;
            const rawGap = (foundCtx.weakestSignals || [])[gapIndex] || foundCtx.weakestSignals?.[0] || "OFFER_FRICTION";
            title = translateSignalTypeToTitle(isUnmeasuredCtx ? "PROOF_GAP_UNMEASURED_TRUTH" : "PERFORMANCE_GAP", rawGap);
            severity = isUnmeasuredCtx ? "LOW" : "HIGH";
          } else {
            const rawBottleneck = foundCtx.primaryBottleneck && foundCtx.primaryBottleneck !== "NONE" && foundCtx.primaryBottleneck !== "UNKNOWN"
              ? foundCtx.primaryBottleneck
              : (foundCtx.currentReality || "CONVERSION_FRICTION");
            title = translateSignalTypeToTitle(isUnmeasuredCtx ? "PROOF_GAP_UNMEASURED_TRUTH" : rawBottleneck, foundCtx.currentReality);
            severity = isUnmeasuredCtx ? "LOW" : (foundCtx.confidence === "HIGH" ? "CRITICAL" : "HIGH");
          }
        } else {
          if (id.includes("bottleneck")) {
            title = "Funnel Conversion Friction";
            severity = "HIGH";
          } else if (id.includes("gap")) {
            title = "Offer Consideration Resistance";
            severity = "HIGH";
          } else if (id.includes("lead_pace")) {
            title = "Qualified Lead Pace Declining";
            severity = "CRITICAL";
          } else if (id.includes("reach")) {
            title = "Top-of-Funnel Reach Bottleneck";
            severity = "HIGH";
          } else if (id.includes("social")) {
            title = "Social Engagement Data Missing";
            severity = "MEDIUM";
          } else {
            title = translateSignalTypeToTitle(id);
          }
        }

        if (!seenTitles.has(title)) {
          seenTitles.add(title);
          linkedPerformanceWarnings.push({
            warningId: id,
            title,
            severity,
          });
        }
      }

      const supportingEvidenceLinks = ((c.evidenceIds as string[]) || [])
        .map((eid) => demoEvidenceMap[eid])
        .filter(Boolean);

      return {
        reasoningCaseId: c.id,
        scenarioId: matchedDemoScenario?.scenarioId || null,
        caseTitle:
          matchedDemoScenario?.title ||
          linkedMarketEvents[0]?.title ||
          "Deep Reasoning Investigation",
        campaignId: c.campaignId,
        strategyRootId: c.strategyRootId,
        strategyRootVersion: c.strategyRootVersion,
        isCurrentRoot,
        rootBadgeLabel: isCurrentRoot ? `Strategy Root v${c.strategyRootVersion} (Active)` : `Strategy Root v${c.strategyRootVersion} (Historical)`,
        status: c.status,
        openedAt: formatStandardDateTime(c.openedAt),
        resolvedAt: c.resolvedAt ? formatStandardDateTime(c.resolvedAt) : null,
        marketEventCount: (c.marketEventIds as string[] || []).length,
        performanceWarningCount: (c.performanceWarningIds as string[] || []).length,
        evidenceCount: (c.evidenceIds as string[] || []).length,
        linkedMarketEvents,
        linkedPerformanceWarnings,
        evidenceIds: (c.evidenceIds as string[] || []),
        supportingEvidenceLinks,
        whatChanged: matchedDemoScenario?.whatChanged || null,
        relevantAudience: matchedDemoScenario?.relevantAudience || null,
        relevantOffering: matchedDemoScenario?.relevantOffering || null,
        relevantLaneTitle: matchedDemoScenario?.relevantLaneTitle || null,
        whyResponseWarranted: matchedDemoScenario?.whyResponseWarranted || null,
        proposedResponse: matchedDemoScenario?.proposedResponse || null,
        tradeOffs: matchedDemoScenario?.tradeOffs || [],
        beforeAfterPatchPreview: matchedDemoScenario?.beforeAfterPatchPreview || [],
        unchangedExplanation: matchedDemoScenario?.unchangedExplanation || [],
        hypotheses: hypotheses.map(h => ({
          hypothesisId: h.id,
          type: h.hypothesisType,
          typeLabel: h.hypothesisType.replace(/_/g, " ").toUpperCase(),
          explanation: h.explanation,
          status: h.status,
          confidence: h.confidence,
          supportingEvidenceCount: (h.supportingEvidenceIds as string[] || []).length,
          contradictingEvidenceCount: (h.contradictingEvidenceIds as string[] || []).length,
          supportingEvidenceIds: (h.supportingEvidenceIds as string[] || []),
          contradictingEvidenceIds: (h.contradictingEvidenceIds as string[] || []),
        })),
        adaptiveDecision: decision ? (() => {
          const matchingProposal = proposalsRows.find(p => p.reasoningCaseId === c.id) || null;
          const propMeta = (matchingProposal?.metadata as Record<string, any>) || {};
          const appliedVer = matchingProposal?.appliedNewBundleVersion || outcome?.newRootVersion || 2;
          return {
            decisionId: decision.id,
            decisionType: decision.decisionType,
            affectedAuthority: decision.affectedAuthority,
            affectedAuthorities: (matchingProposal?.affectedAuthorities as string[]) || matchedDemoScenario?.affectedAuthorities || (decision.affectedAuthority ? [decision.affectedAuthority] : []),
            preservedAuthorities: (matchingProposal?.preservedAuthorities as string[]) || matchedDemoScenario?.preservedAuthorities || ["AUDIENCE", "POSITIONING", "DIFFERENTIATION", "OFFER", "FUNNEL", "CHANNELS", "BUDGET"],
            affectedLaneIds: (decision.affectedLaneIds as string[]) || ((decision.metadata as any)?.affectedLaneIds as string[]) || (decision.affectedEntityIds as string[] || []).filter((id: string) => id.startsWith("lane_")),
            businessAction: matchingProposal?.summary || matchedDemoScenario?.proposalSummary || decisionTranslation?.label,
            actionDescription: matchedDemoScenario?.proposedResponse || decisionTranslation?.actionDescription,
            statusBadge: matchingProposal?.status === "PENDING_USER_APPROVAL"
              ? "PENDING USER APPROVAL"
              : matchingProposal?.status === "APPLIED" || outcome
                ? `APPROVED & APPLIED (v${appliedVer})`
                : decisionTranslation?.statusBadge,
            proposalId: matchingProposal?.id || matchedDemoScenario?.proposalId || null,
            proposalStatus: matchingProposal?.status || null,
            appliedVersion: matchingProposal?.appliedNewBundleVersion || null,
            affectedStrategicAssumption:
              matchedDemoScenario?.affectedStrategicAssumption ||
              propMeta.affectedStrategicAssumption ||
              casesLineage.activeRoot?.approvedClaim ||
              casesLineage.activeRoot?.approvedPromise ||
              null,
            relevantAudience:
              matchedDemoScenario?.relevantAudience || propMeta.relevantAudience || null,
            relevantOffering:
              matchedDemoScenario?.relevantOffering || propMeta.relevantOffering || null,
            relevantLaneTitle:
              matchedDemoScenario?.relevantLaneTitle || propMeta.relevantLaneTitle || null,
            whyResponseWarranted:
              matchedDemoScenario?.whyResponseWarranted || matchingProposal?.whyNow || decision.rationale,
            proposedResponse:
              matchedDemoScenario?.proposedResponse || propMeta.proposedResponse || matchingProposal?.summary,
            tradeOffs:
              matchedDemoScenario?.tradeOffs || propMeta.tradeOffs || [],
            beforeAfterPatchPreview:
              matchedDemoScenario?.beforeAfterPatchPreview || propMeta.beforeAfterPatchPreview || [],
            unchangedExplanation:
              matchedDemoScenario?.unchangedExplanation || propMeta.unchangedExplanation || [],
            affectedPlanItems: (
              matchedDemoScenario?.beforeAfterPatchPreview ||
              propMeta.beforeAfterPatchPreview ||
              []
            ).map((p: any) => `${p.sectionName || p.section} — ${p.fieldLabel || "updated"}: ${p.afterText || p.after}`),
            confidence: decision.confidence,
            rationale: decision.rationale,
            createdAt: formatStandardDateTime(decision.createdAt),
          };
        })() : null,
        adaptationOutcome: outcome ? {
          outcomeId: outcome.id,
          status: outcome.status,
          outcomeClassification: outcome.outcomeClassification,
          confidence: outcome.confidence,
          summary: outcome.summary,
          previousRootVersion: outcome.previousRootVersion,
          newRootVersion: outcome.newRootVersion,
          changedAuthorities: outcome.changedAuthorities,
          evaluatedAt: outcome.evaluatedAt ? formatStandardDateTime(outcome.evaluatedAt) : null,
        } : null,
      };
    });

    // Build pendingActionableScenarios for any of the 3 demo scenarios not yet opened in reasoning_cases
    const pendingActionableScenarios = demoScenariosCatalog
      .filter((s) => {
        const eventExists = campaignEvents.some((e) => e.event.id === s.eventId);
        const alreadyOpened = composedCases.some(
          (c) => c.reasoningCaseId === s.reasoningCaseId || c.scenarioId === s.scenarioId,
        );
        return eventExists && !alreadyOpened;
      })
      .map((s) => ({
        scenarioId: s.scenarioId,
        eventId: s.eventId,
        reasoningCaseId: s.reasoningCaseId,
        proposalId: s.proposalId,
        title: s.title,
        whatChanged: s.whatChanged,
        relevantAudience: s.relevantAudience,
        relevantOffering: s.relevantOffering,
        relevantLaneTitle: s.relevantLaneTitle,
        affectedStrategicAssumption: s.affectedStrategicAssumption,
        affectedAuthorities: s.affectedAuthorities,
        preservedAuthorities: s.preservedAuthorities,
        status: "PENDING_INVESTIGATION",
        supportingEvidenceLinks: (s.evidenceIds || [])
          .map((eid: string) => demoEvidenceMap[eid])
          .filter(Boolean),
      }));

    const supersededCases = cases
      .filter(c => c.status === "CLOSED" && (c.metadata as any)?.superseded === true)
      .map(c => {
        const dec = decisionsRows.find(d => d.reasoningCaseId === c.id);
        return {
          reasoningCaseId: c.id,
          status: c.status,
          decisionId: dec?.id || null,
          decisionType: dec?.decisionType || null,
          supersededByCaseId: (c.metadata as any)?.supersededByCaseId || null,
          supersededByDecisionId: (c.metadata as any)?.supersededByDecisionId || null,
          supersededReason: (c.metadata as any)?.supersededReason || null,
        };
      });

    return res.json({
      campaignId,
      currentRootVersion,
      totalCount: composedCases.length,
      cases: composedCases,
      supersededCases,
      pendingActionableScenarios,
    });
  } catch (err: any) {
    console.error("[AdaptiveReadRouter] Deep reasoning cases error:", err);
    return res.status(500).json({ error: err.message });
  }
});

adaptiveReadRouter.get(["/read-surface/:campaignId", "/adaptive/read-surface/:campaignId"], async (req: Request, res: Response) => {
  try {
    const { campaignId } = req.params;
    const accountId = (req as any).accountId;
    const lineage = await resolveDesignatedActiveLineage(campaignId, accountId);
    const effAccountId = accountId || lineage.activeRoot?.accountId || lineage.strategicPlan?.accountId;
    if (effAccountId) {
      try {
        await syncCampaignAdaptiveReasoning({ accountId: effAccountId, campaignId });
      } catch {}
    }
    const allCases = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.campaignId, campaignId))
      .orderBy(desc(schema.reasoningCases.openedAt));
    const allDecisions = await db
      .select()
      .from(schema.adaptiveDecisions)
      .where(eq(schema.adaptiveDecisions.campaignId, campaignId))
      .orderBy(desc(schema.adaptiveDecisions.createdAt));

    const activeCases = allCases.filter(c => !(c.status === "CLOSED" && (c.metadata as any)?.superseded === true));
    const activeDecisions = allDecisions.filter(d => !(d.metadata as any)?.superseded);
    const supersededDecisions = allDecisions.filter(d => (d.metadata as any)?.superseded === true);

    return res.json({
      campaignId,
      strategyRootId: lineage.strategyRootId,
      strategyRootVersion: lineage.strategyRootVersion,
      activePlanId: lineage.planId,
      activePlanVersion: lineage.planVersion,
      casesCount: activeCases.length,
      decisionsCount: activeDecisions.length,
      supersededDecisionsCount: supersededDecisions.length,
      latestCaseId: activeCases[0]?.id || null,
      latestDecisionId: activeDecisions[0]?.id || null,
      latestDecisionType: activeDecisions[0]?.decisionType || null,
      latestDecisionConfidence: activeDecisions[0]?.confidence ?? null,
      latestDecisionRationale: activeDecisions[0]?.rationale || null,
      supersededDecisionIds: supersededDecisions.map(d => d.id),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
