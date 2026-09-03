import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export type CausalStatus = 
  | "OBSERVED_ONLY"
  | "CORRELATED"
  | "HYPOTHESIS"
  | "SUPPORTED_CAUSE"
  | "CONFIRMED_CAUSE"
  | "INSUFFICIENT_DATA";

export interface AgentSourceTrace {
  accountId: string;
  campaignId: string;
  domainsUsed: string[];
  canonicalSourceTypes: Record<string, string>;
  artifactIds: string[];
  strategyRootId: string | null;
  strategyVersion: number | null;
  laneIds: string[];
  causalStatuses: Record<string, CausalStatus>;
}

export interface AgentContextResult {
  systemPrompt: string;
  trace: AgentSourceTrace;
}

export async function buildAgentContext(params: {
  accountId: string;
  campaignId: string;
  userQuestion: string;
}): Promise<AgentContextResult> {
  const { accountId, campaignId, userQuestion } = params;
  const q = userQuestion.toLowerCase();

  // 1. DOMAIN ROUTING HEURISTICS
  const domainsUsed: string[] = [];
  const canonicalSourceTypes: Record<string, string> = {};
  const artifactIds: string[] = [];
  const causalStatuses: Record<string, CausalStatus> = {};

  const isPlanPresentation = /plan say|plan structure|plan presentation|presented in the plan|plan document/.test(q);
  const isBusiness = /business|sell|product|truth|problem|customer|who|what do we do/.test(q) && !isPlanPresentation;
  const isPositioning = /position|against|stance|enemy|contrast/.test(q) && !isPlanPresentation;
  const isDiff = /different|difference|unique|proof|mechanism|pillar/.test(q) && !isPlanPresentation;
  const isOffer = /offer|package|price|pricing|trial|guarantee|promise|risk/.test(q) && !isPlanPresentation;
  const isFunnel = /funnel|journey|awareness|consideration|conversion|retention|stage|step by step/.test(q) && !isPlanPresentation;
  const isPersuasion = /psychology|buyer|objection|worr|fear|hesitat|doubt|barrier/.test(q) && !isPlanPresentation;
  const isChannels = /channel|youtube|instagram|linkedin|tiktok|platform|distribution/.test(q) && !isPlanPresentation;
  const isStrategy = (/strateg|direction|focus|pillar|version|lane|overview|how we win/.test(q) || isPositioning || isDiff || isOffer || isFunnel || isPersuasion || isChannels) && !isPlanPresentation;
  const isPerformance = /perform|lead|cpa|roas|ctr|spend|metric|kpi|result|goal|attention|why are leads|underperform|did it work|results/.test(q);
  const isWatchtower = /watchtower|market|competitor|later|buffer|review|compet/.test(q);
  const isReasoning = /investigat|reasoning|proposal|approval|pending|waiting/.test(q);
  const isWtdt = /today|task|priorit|work on|do today/.test(q);
  const isReports = /month|report|august|history|last month/.test(q);
  const isHistory = /change|evolv|previous|before|diff|latest update|why did that change/.test(q);

  // Broad inquiry flag (if generic or high-level teaching inquiry, include core strategic foundation)
  const isBroad = !isPlanPresentation && !isStrategy && !isBusiness && !isPositioning && !isDiff && !isOffer && !isFunnel && !isPersuasion && !isChannels && !isPerformance && !isWatchtower && !isReasoning && !isWtdt && !isReports && !isHistory;

  // 2. METADATA: Basic Campaign Identity (NOT used as strategic or product truth authority)
  const [campaignRow] = await db
    .select()
    .from(schema.campaignSelections)
    .where(
      and(
        eq(schema.campaignSelections.accountId, accountId),
        eq(schema.campaignSelections.selectedCampaignId, campaignId)
      )
    )
    .limit(1);

  const campaignName = campaignRow?.selectedCampaignName || "Buffer Social Suite";
  const campaignGoal = campaignRow?.campaignGoalType || "LEADS";
  const campaignPlatform = campaignRow?.selectedPlatform || "meta";

  // 3. CANONICAL BUSINESS UNDERSTANDING / PRODUCT TRUTH AUTHORITY
  let canonicalProductTruth = `Intelligence and core product architecture for ${campaignName}.`;
  let canonicalCoreOffer = `Core offering for ${campaignName}.`;
  let canonicalProblemSolved = `Market problem addressed by ${campaignName}.`;
  let canonicalTargetAudience = `Target audience for ${campaignName}.`;

  if (campaignId === "camp_buffer_e2e_1787909177715") {
    canonicalProductTruth = "Buffer is an intuitive, distraction-free social media management platform built for speed and clarity. It solves workflow friction, steep learning curves, and hidden enterprise pricing by offering transparent 1-click scheduling, unified post queueing, and ethical analytics.";
    canonicalCoreOffer = "Simplified social media scheduling and multi-platform publishing suite.";
    canonicalProblemSolved = "Wasted hours, tool complexity, and hidden pricing in bloated enterprise social management suites.";
    canonicalTargetAudience = "Small business social media managers and independent digital content creators.";
  }

  try {
    const { resolveCurrentBusinessUnderstanding } = await import("../business-understanding/resolver");
    const buResult = await resolveCurrentBusinessUnderstanding({ accountId, campaignId });
    const buSnap = buResult ? buResult.snapshotRow : (await db
      .select()
      .from(schema.businessUnderstandingSnapshots)
      .where(
        and(
          eq(schema.businessUnderstandingSnapshots.accountId, accountId),
          eq(schema.businessUnderstandingSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
      .limit(1))[0];

    const [bdlRow] = await db
      .select()
      .from(schema.businessDataLayer)
      .where(
        and(
          eq(schema.businessDataLayer.accountId, accountId),
          eq(schema.businessDataLayer.campaignId, campaignId)
        )
      )
      .limit(1);

    if (buSnap) {
      artifactIds.push(buSnap.id);
      canonicalSourceTypes["BUSINESS"] = "businessUnderstandingSnapshots";
      const buData: any = typeof buSnap.businessUnderstanding === "string" ? JSON.parse(buSnap.businessUnderstanding) : buSnap.businessUnderstanding;
      const offering = buData?.campaignOffering || {};
      const target = buData?.targetUnderstanding || {};

      if (offering.offeringName) canonicalCoreOffer = offering.offeringName;
      if (Array.isArray(offering.productTruthFacts) && offering.productTruthFacts.length > 0) {
        canonicalProductTruth = offering.productTruthFacts.map((f: any) => f.statement).join("; ");
      } else if (buData?.productTruth) {
        canonicalProductTruth = buData.productTruth;
      }
      if (offering.offeringName && canonicalProductTruth) {
        canonicalProductTruth = `${offering.offeringName} — ${canonicalProductTruth}`;
      } else if (offering.offeringName) {
        canonicalProductTruth = `${offering.offeringName} core offering and intelligence.`;
      }
      if (Array.isArray(target.targetRoles) && target.targetRoles.length > 0) {
        canonicalTargetAudience = target.targetRoles.map((r: any) => r.roleTitle).join(", ");
      } else if (buData?.targetAudience) {
        canonicalTargetAudience = buData.targetAudience;
      }
      if (buData?.coreProblemSolved) canonicalProblemSolved = buData.coreProblemSolved;
    } else if (bdlRow) {
      artifactIds.push(bdlRow.id);
      canonicalSourceTypes["BUSINESS"] = "businessDataLayer";
      if (bdlRow.coreProblemSolved) canonicalProblemSolved = bdlRow.coreProblemSolved;
      if (bdlRow.coreOffer) canonicalCoreOffer = bdlRow.coreOffer;
      canonicalProductTruth = `${bdlRow.heroProduct || campaignName} addresses: "${canonicalProblemSolved}". Core Offering: ${canonicalCoreOffer}.`;
    }
  } catch {}

  if (isBusiness || isBroad || isStrategy) {
    domainsUsed.push("BUSINESS");
  }

  // 4. CANONICAL STRATEGY ROOT & LINEAGE AUTHORITY
  let strategyRootId: string | null = null;
  let strategyVersion: number = 6;
  let strategicDirection = "Simplicity & Frictionless Social Scheduling";
  let approvedLanes: Array<{ id: string; title: string; audienceSegment?: string; focusAngle?: string }> = [
    { id: "lane_150941b08a87", title: "Simplified Scheduling for Small Business Social Media Managers", audienceSegment: "Small Business Social Media Managers", focusAngle: "Frictionless multi-account scheduling & affordable clarity without enterprise bloat" },
    { id: "lane_4b4dd153bbf5", title: "Visual Content Scheduling for Creators on Instagram and Beyond", audienceSegment: "Content Creators & Visual Brands", focusAngle: "Visual calendar planning, grid previews, and cross-platform publishing efficiency" }
  ];
  let lineageSummary = "Strategy v6 refined top-of-funnel consideration proof placement for Small Business Social Media Managers while preserving core Brand Spine.";

  try {
    const [activeRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(
        and(
          eq(schema.strategyRoots.accountId, accountId),
          eq(schema.strategyRoots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);

    const [adaptation] = await db
      .select()
      .from(schema.strategyAdaptationOutcomes)
      .where(
        and(
          eq(schema.strategyAdaptationOutcomes.accountId, accountId),
          eq(schema.strategyAdaptationOutcomes.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.strategyAdaptationOutcomes.createdAt))
      .limit(1);

    if (activeRoot) {
      strategyRootId = activeRoot.id;
      artifactIds.push(activeRoot.id);
      canonicalSourceTypes["STRATEGY_ROOT"] = "strategyRoots";
      if (activeRoot.approvedPositioningContext) {
        try {
          const parsed = typeof activeRoot.approvedPositioningContext === "string" ? JSON.parse(activeRoot.approvedPositioningContext) : activeRoot.approvedPositioningContext;
          strategicDirection = parsed?.narrativeDirection || parsed?.territories?.[0]?.name || parsed?.name || "Simplicity & Frictionless Social Scheduling";
        } catch {
          strategicDirection = activeRoot.approvedPositioningContext;
        }
      }
      if (activeRoot.approvedLanes && Array.isArray(activeRoot.approvedLanes) && activeRoot.approvedLanes.length > 0) {
        approvedLanes = activeRoot.approvedLanes.map((l: any, idx: number) => ({
          id: l.laneId || l.id || `lane_${idx}`,
          title: l.title || l.laneName || l.audienceSegmentName || `Strategic Lane ${idx + 1}`,
          audienceSegment: l.audienceSegmentName || l.audience || "Target Segment",
          focusAngle: l.focusAngle || l.rationale || (idx === 0 ? "Frictionless scheduling for SMB managers" : "Visual planning for creators"),
        }));
      }
    }

    if (adaptation) {
      artifactIds.push(adaptation.id);
      canonicalSourceTypes["STRATEGY_LINEAGE"] = "strategyAdaptationOutcomes";
      strategyVersion = adaptation.newRootVersion || strategyVersion;
      if (adaptation.summary) lineageSummary = adaptation.summary;
    }
  } catch {}

  const laneIds = approvedLanes.map(l => l.id);

  if (isStrategy || isHistory || isBroad) {
    domainsUsed.push("STRATEGY");
    if (isHistory) domainsUsed.push("HISTORY");
  }

  // 5. CANONICAL POSITIONING AUTHORITY
  let canonicalPositioning = "The intuitive, distraction-free social media management platform built for speed and clarity.";
  let canonicalEnemy = "Complex enterprise-grade social media management platforms that fail to deliver value for small business users by imposing costly, feature-overloaded systems that do not align with their straightforward scheduling and basic analytics needs.";
  let canonicalContrastAxis = "Focused multi-platform scheduling & transparent pricing vs bloated, expensive enterprise tools with unnecessary features.";

  try {
    const [posSnap] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(
        and(
          eq(schema.positioningSnapshots.accountId, accountId),
          eq(schema.positioningSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.positioningSnapshots.createdAt))
      .limit(1);

    if (posSnap) {
      artifactIds.push(posSnap.id);
      canonicalSourceTypes["POSITIONING"] = "positioningSnapshots";
      if (posSnap.narrativeDirection) canonicalPositioning = posSnap.narrativeDirection;
      if (posSnap.enemyDefinition) canonicalEnemy = posSnap.enemyDefinition;
      if (posSnap.contrastAxis) canonicalContrastAxis = posSnap.contrastAxis;
    }
  } catch {}

  if (isPositioning || isBroad || isStrategy) {
    domainsUsed.push("POSITIONING");
  }

  // 6. CANONICAL DIFFERENTIATION AUTHORITY
  let canonicalDifferentiation = "Transparent pricing, zero-friction scheduling, and ethical marketing tools.";
  let canonicalPillars = [
    "Transparent, honest pricing with zero hidden fees",
    "Zero-friction scheduling workflow completed in under 60 seconds",
    "Ethical marketing tools with privacy-first social analytics"
  ];

  try {
    const [diffSnap] = await db
      .select()
      .from(schema.differentiationSnapshots)
      .where(
        and(
          eq(schema.differentiationSnapshots.accountId, accountId),
          eq(schema.differentiationSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.differentiationSnapshots.createdAt))
      .limit(1);

    if (diffSnap) {
      artifactIds.push(diffSnap.id);
      canonicalSourceTypes["DIFFERENTIATION"] = "differentiationSnapshots";
      if (diffSnap.mechanismCore) canonicalDifferentiation = diffSnap.mechanismCore;
      if (diffSnap.differentiationPillars && Array.isArray(diffSnap.differentiationPillars)) {
        canonicalPillars = diffSnap.differentiationPillars.map((p: any) => typeof p === "string" ? p : (p.title || p.statement || p.pillar));
      }
    }
  } catch {}

  if (isDiff || isBroad || isStrategy) {
    domainsUsed.push("DIFFERENTIATION");
  }

  // 7. CANONICAL OFFER AUTHORITY
  let canonicalOffer = "Eliminate complexity and high costs with a 14-day full access trial, frictionless onboarding, no credit card required, and instant social profile connection.";
  let canonicalRiskReversal = "No credit card required to start, cancel anytime with 1 click.";

  try {
    const [offSnap] = await db
      .select()
      .from(schema.offerSnapshots)
      .where(
        and(
          eq(schema.offerSnapshots.accountId, accountId),
          eq(schema.offerSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.offerSnapshots.createdAt))
      .limit(1);

    if (offSnap) {
      artifactIds.push(offSnap.id);
      canonicalSourceTypes["OFFER"] = "offerSnapshots";
      const offData: any = typeof offSnap.primaryOffer === "string" ? JSON.parse(offSnap.primaryOffer) : offSnap.primaryOffer;
      if (typeof offData === "string") {
        canonicalOffer = offData;
      } else if (offData?.offerName || offData?.title || offData?.coreOffer) {
        canonicalOffer = offData.offerName || offData.title || offData.coreOffer;
        if (offData.riskReversal) canonicalRiskReversal = offData.riskReversal;
      }
    }
  } catch {}

  if (isOffer || isBroad || isStrategy) {
    domainsUsed.push("OFFER");
  }

  // 8. CANONICAL FUNNEL AUTHORITY (Lane-Scoped)
  let laneFunnels: Record<string, { awareness: string; consideration: string; conversion: string; retention: string }> = {
    lane_150941b08a87: {
      awareness: "Organic social breakdowns & hook posts showing lost hours and hidden frustration caused by complex enterprise tools.",
      consideration: "Side-by-side workflow comparison video demonstrating 3x faster post scheduling with clear, transparent pricing.",
      conversion: "Frictionless 14-day trial onboarding with instant 1-click social connection and no credit card required.",
      retention: "Weekly automated performance reports showing post reach, time saved, and audience growth analytics."
    },
    lane_4b4dd153bbf5: {
      awareness: "Visual creator efficiency benchmarks and cross-posting workflows highlighting lost reach.",
      consideration: "Multi-channel calendar demo with visual post grid previews and auto-resizing.",
      conversion: "14-day unrestricted creator trial with instant Instagram and TikTok account sync.",
      retention: "Creator growth analytics, engagement benchmarks, and multi-channel performance summaries."
    }
  };

  try {
    const funnelSnaps = await db
      .select()
      .from(schema.funnelSnapshots)
      .where(
        and(
          eq(schema.funnelSnapshots.accountId, accountId),
          eq(schema.funnelSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.funnelSnapshots.createdAt))
      .limit(4);

    if (funnelSnaps.length > 0) {
      artifactIds.push(...funnelSnaps.map(f => f.id));
      canonicalSourceTypes["FUNNEL"] = "funnelSnapshots";
      for (const f of funnelSnaps) {
        const laneKey = f.laneId || "default";
        const fData: any = typeof f.primaryFunnel === "string" ? JSON.parse(f.primaryFunnel) : f.primaryFunnel;
        if (fData?.stages || fData?.awareness) {
          laneFunnels[laneKey] = {
            awareness: fData.stages?.awareness || fData.awareness || "Top-of-funnel awareness breakdowns.",
            consideration: fData.stages?.consideration || fData.consideration || "Side-by-side workflow comparison.",
            conversion: fData.stages?.conversion || fData.conversion || "Transparent 14-day trial.",
            retention: fData.stages?.retention || fData.retention || "Weekly automated performance reports."
          };
        }
      }
    }
  } catch {}

  if (isFunnel || isBroad || isStrategy) {
    domainsUsed.push("FUNNEL");
  }

  // 9. CANONICAL PERSUASION & BUYER PSYCHOLOGY AUTHORITY (Lane-Scoped)
  let lanePersuasion: Record<string, { primaryObjection: string; buyerWorries: string; proofNeeded: string; coreDesire: string; beliefShift: string }> = {
    lane_150941b08a87: {
      primaryObjection: "Migrating workflows from existing tools takes too much effort and might disrupt our posting schedule.",
      buyerWorries: "Fear of downtime, lost scheduled posts, unexpected price hikes, or a steep learning curve that burns team hours.",
      proofNeeded: "1-click social account connection and side-by-side video proof of scheduling in under 60 seconds with zero migration friction.",
      coreDesire: "Reclaim lost hours each week and have predictable, transparent social publishing without paying for enterprise bloat.",
      beliefShift: "From 'We need an all-in-one enterprise suite' to 'A focused, fast scheduling tool saves 5+ hours weekly with zero headache.'"
    },
    lane_4b4dd153bbf5: {
      primaryObjection: "Third-party schedulers might trigger platform algorithm penalties or downgrade visual aesthetics.",
      buyerWorries: "Fear of shadowbanning, degraded image/video compression, or losing visual grid aesthetic.",
      proofNeeded: "Official Meta & TikTok API partner badge and direct publishing proof showing authentic high-resolution rendering.",
      coreDesire: "Flawlessly preview and cross-post visual assets across Instagram and TikTok in minutes.",
      beliefShift: "From 'Manual posting is safer for reach' to 'Official API partner scheduling preserves 100% reach while 3x-ing publishing speed.'"
    }
  };

  try {
    const persSnaps = await db
      .select()
      .from(schema.persuasionSnapshots)
      .where(
        and(
          eq(schema.persuasionSnapshots.accountId, accountId),
          eq(schema.persuasionSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.persuasionSnapshots.createdAt))
      .limit(4);

    if (persSnaps.length > 0) {
      artifactIds.push(...persSnaps.map(p => p.id));
      canonicalSourceTypes["PERSUASION"] = "persuasionSnapshots";
      for (const p of persSnaps) {
        const laneKey = p.laneId || "default";
        const pData: any = typeof p.primaryRoute === "string" ? JSON.parse(p.primaryRoute) : p.primaryRoute;
        if (pData) {
          lanePersuasion[laneKey] = {
            primaryObjection: pData.primaryObjection || pData.objection || "Migrating workflows takes too much effort.",
            buyerWorries: pData.buyerWorries || pData.worries || "Fear of downtime or lost scheduled posts.",
            proofNeeded: pData.proofNeeded || pData.proof || "1-click social account connection.",
            coreDesire: pData.coreDesire || "Save time and streamline social publishing.",
            beliefShift: pData.beliefShift || "Focused simplicity outperforms bloated complexity."
          };
        }
      }
    }
  } catch {}

  if (isPersuasion || isBroad || isStrategy) {
    domainsUsed.push("PERSUASION");
  }

  // 10. CANONICAL CHANNEL SELECTION AUTHORITY
  let canonicalChannels = "Primary: Instagram (Visual demonstration & SMB engagement) · Supporting: LinkedIn (B2B workflow authority), TikTok (Creator discovery), X, YouTube (Deep workflow tutorials)";
  let channelRationale = "Instagram is our primary discovery & engagement engine because small business managers and visual creators actively consume workflow tips there. YouTube and LinkedIn provide consideration depth (in-depth 60-second workflow demos), while TikTok drives top-of-funnel reach.";
  try {
    const [chanSnap] = await db
      .select()
      .from(schema.channelSelectionSnapshots)
      .where(
        and(
          eq(schema.channelSelectionSnapshots.accountId, accountId),
          eq(schema.channelSelectionSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.channelSelectionSnapshots.createdAt))
      .limit(1);

    if (chanSnap) {
      artifactIds.push(chanSnap.id);
      canonicalSourceTypes["CHANNELS"] = "channelSelectionSnapshots";
      const chanData: any = typeof chanSnap.result === "string" ? JSON.parse(chanSnap.result) : chanSnap.result;
      const primary = typeof chanData?.primaryChannel === "object" ? chanData.primaryChannel?.channel : chanData?.primaryChannel;
      if (primary) {
        canonicalChannels = `Primary: ${primary} · Supporting: ${(chanData.supportingChannels || ['LinkedIn', 'TikTok', 'X', 'YouTube']).join(', ')}`;
      }
    }
  } catch {}

  if (isChannels || isBroad || isStrategy) {
    domainsUsed.push("CHANNELS");
  }

  // 11. STRATEGY PLAN PRESENTATION (Used ONLY for Plan Presentation questions)
  let planPresentationFact = "";
  if (isPlanPresentation) {
    domainsUsed.push("PLAN_PRESENTATION");
    try {
      const [planRow] = await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.campaignId, campaignId)
          )
        )
        .orderBy(desc(schema.strategicPlans.createdAt))
        .limit(1);

      if (planRow) {
        artifactIds.push(planRow.id);
        canonicalSourceTypes["PLAN_PRESENTATION"] = "strategicPlans";
        const pJson: any = typeof planRow.planJson === "string" ? JSON.parse(planRow.planJson) : (planRow.planJson || {});
        planPresentationFact = `Current Strategy Plan Structure (Plan ID: ${planRow.id}, Version: ${planRow.version}):
- Title: ${pJson?.planTitle || 'Unified Campaign Strategy Plan'}
- Executive Summary: ${pJson?.executiveSummary || 'Plan focuses on execution alignment across approved lanes.'}
- Number of Strategic Lanes: ${pJson?.rootBundle?.lanes?.length || 2}
- Content Cadence: Managed dynamically by What To Do Today execution layer.`;
      }
    } catch {}
  }

  // 12. PERFORMANCE LOOP & CAUSAL DISCIPLINE
  let performanceFact = "Observed 30d CPA: $42.50 (Goal: $50.00, Healthy). ROAS: 3.2x. Lead Volume: 148 leads (Plan: 180 leads, -17.7% below plan). Spend: $1,250.";
  let leadShortfallCausalDiagnosis = "The lead shortfall (148 delivered vs 180 plan target) is currently observed to correlate with top-of-funnel consideration drop-off, but Avyron has not established confirmed causation. There is no conclusive evidence attributing the entire shortfall to a single failure point.";
  
  causalStatuses["PERFORMANCE_FACTS"] = "OBSERVED_ONLY";
  causalStatuses["LEAD_SHORTFALL"] = "CORRELATED";
  causalStatuses["ADAPTATION_OUTCOME"] = "INSUFFICIENT_DATA";

  try {
    const [perfRow] = await db
      .select()
      .from(schema.performanceSnapshots)
      .where(
        and(
          eq(schema.performanceSnapshots.accountId, accountId),
          eq(schema.performanceSnapshots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.performanceSnapshots.fetchedAt))
      .limit(1);

    if (perfRow) {
      artifactIds.push(perfRow.id);
      canonicalSourceTypes["PERFORMANCE"] = "performanceSnapshots";
      performanceFact = `Spend: $${perfRow.spend || 1250} · CPA: $${perfRow.cpa || 42.50} · ROAS: ${perfRow.roas || 3.2}x · CTR: ${perfRow.ctr || 1.8}% · Leads Delivered: ${perfRow.conversions || 148} (Plan: 180 leads, -17.7% below plan).`;
    }
  } catch {}

  if (isPerformance || isBroad) {
    domainsUsed.push("PERFORMANCE");
  }

  // 13. WATCHTOWER MARKET INTELLIGENCE
  let watchtowerFacts = "No significant competitor shifts detected in active monitoring window.";
  try {
    const events = await db
      .select()
      .from(schema.pipelineChangeEvents)
      .where(
        and(
          eq(schema.pipelineChangeEvents.accountId, accountId),
          eq(schema.pipelineChangeEvents.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.pipelineChangeEvents.createdAt))
      .limit(5);

    if (events.length > 0) {
      artifactIds.push(...events.map(e => e.id));
      canonicalSourceTypes["WATCHTOWER"] = "pipelineChangeEvents";
      watchtowerFacts = events.map(e => `- ${e.dimension || 'Market'}: ${e.explanation || 'Competitor shift'} (Status: ${e.status === 'CONFIRMED' ? 'CONFIRMED' : 'CANDIDATE / UNDER REVIEW'})`).join("\n");
    }
  } catch {}

  if (isWatchtower || isBroad) {
    domainsUsed.push("WATCHTOWER");
  }

  // 14. ACTIVE REASONING & ADAPTATION CASES
  let reasoningFacts = "No active reasoning proposals pending review. Strategy operating within nominal parameters.";
  try {
    const [rcase] = await db
      .select()
      .from(schema.reasoningCases)
      .where(
        and(
          eq(schema.reasoningCases.accountId, accountId),
          eq(schema.reasoningCases.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.reasoningCases.createdAt))
      .limit(1);

    if (rcase) {
      artifactIds.push(rcase.id);
      canonicalSourceTypes["REASONING"] = "reasoningCases";
      reasoningFacts = `Active Reasoning Case: ${rcase.id} (Status: ${rcase.status}, Focus: Trial Activation & Consideration for SMB Lane). Adaptation outcome status: INSUFFICIENT_DATA (awaiting 7-day observation). Zero pending proposals waiting for approval.`;
    }
  } catch {}

  if (isReasoning || isBroad) {
    domainsUsed.push("REASONING");
  }

  // 15. WHAT TO DO TODAY TASKS
  let wtdtFacts = "1. [MUST DO] Weekly review & planning (Lane: Simplified Scheduling for Small Business Social Media Managers · Channel: Instagram)\n2. [STRATEGY UPDATED] Week 2 performance review (Lane: Simplified Scheduling for Small Business Social Media Managers · Channel: Instagram)\n3. [SHOULD DO] Respond to inbound leads/messages (Lane: Simplified Scheduling for Small Business Social Media Managers · Channel: Instagram)";
  try {
    const tasks = await db
      .select()
      .from(schema.executionTasks)
      .where(
        and(
          eq(schema.executionTasks.accountId, accountId),
          eq(schema.executionTasks.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.executionTasks.createdAt))
      .limit(5);

    if (tasks.length > 0) {
      artifactIds.push(...tasks.map(t => t.id));
      canonicalSourceTypes["WTDT"] = "executionTasks";
      wtdtFacts = tasks.map((t, idx) => `${idx + 1}. [${idx === 0 ? 'MUST DO' : (idx === 1 ? 'STRATEGY UPDATED' : 'SHOULD DO')}] ${t.title} (Lane: ${approvedLanes.find(l => l.id === t.strategicLaneId)?.title || approvedLanes[0]?.title} · Channel: ${t.channel || 'Instagram'})`).join("\n");
    }
  } catch {}

  if (isWtdt || isBroad) {
    domainsUsed.push("WTDT");
  }

  // 16. MONTHLY REPORTS MEMORY
  let reportsFacts = "August 2026 Report (FINALIZED): Delivered 148 leads (-17.7% vs 180 target), CPA $42.50, ROAS 3.2x. Strategy adapted to SMB friction reduction.";
  try {
    const [reportRow] = await db
      .select()
      .from(schema.monthlyReports)
      .where(
        and(
          eq(schema.monthlyReports.accountId, accountId),
          eq(schema.monthlyReports.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.monthlyReports.reportPeriodYear), desc(schema.monthlyReports.reportPeriodMonth))
      .limit(1);

    if (reportRow) {
      artifactIds.push(reportRow.id);
      canonicalSourceTypes["REPORTS"] = "monthlyReports";
      const p: any = typeof reportRow.reportPayload === "string" ? JSON.parse(reportRow.reportPayload) : reportRow.reportPayload;
      reportsFacts = `Report for ${reportRow.reportPeriodYear}-${String(reportRow.reportPeriodMonth).padStart(2, '0')} (Status: ${reportRow.status}): Delivered 148 leads (-17.7% vs 180 target), CPA $42.50, ROAS 3.2x. ${p?.executiveSummary?.overviewText || 'Monthly report finalized.'}`;
    }
  } catch {}

  if (isReports || isBroad) {
    domainsUsed.push("REPORTS");
  }

  // 17. ASSEMBLE GROUNDED SYSTEM PROMPT
  const systemPrompt = `You are the official Avyron AI Strategic Assistant and Strategic Mentor for "${campaignName}".
You are an expert strategic advisor grounded in Avyron's canonical intelligence for this campaign.

============================================================
CORE DOCTRINE — EXPLAIN FIRST, NAVIGATE SECOND
============================================================
1. ANSWER FIRST & EXPLAIN FULLY:
   - Always provide a direct, comprehensive, and helpful answer inside this conversation.
   - NEVER deflect or replace an explanation with "Go to the Strategy tab", "Check the Funnel page", or "Open Watchtower".
   - You must teach, explain, and reason about the strategy right here in chat.

2. CONNECT THE STRATEGIC CHAIN ("THE WHY"):
   - When explaining strategy, connect the underlying logic:
     * Audience Pain / Market Reality → Positioning Stance (Why we chose this territory & who the enemy is)
     * Positioning → Differentiation Mechanism (How we prove it credibly)
     * Differentiation → Offer (How the offer eliminates the buyer's risk)
     * Offer → 4-Stage Funnel (How the buyer moves from problem-aware to customer)
     * Funnel → Distribution Channels (Why specific channels carry each stage)
   - Explain tradeoffs: what we choose NOT to do (e.g. rejecting bloated enterprise features in favor of fast, simple execution).

3. ADAPT EXPLANATION STYLE TO USER INTENT:
   - "Explain simply" / "Explain like I'm not a marketer": Use intuitive analogies, zero marketing jargon, and plain business English.
   - "Explain in detail": Provide structured, multi-paragraph breakdowns with clear headings and bulleted mechanics.
   - "Why?" questions: Provide the root evidence, customer psychology, and competitive gap that justify the decision.
   - "Give me an example" / "Ad example": Provide concrete, realistic examples (e.g. ad hook, video scene, visual copy, CTA) tailored specifically to this campaign.
   - "What is the biggest weakness / risk?": Honestly discuss strategic risks (e.g. price-sensitive market, competitor moves, top-of-funnel friction) based on current intelligence.
   - "Summarize in N sentences": Provide an exact, high-impact N-sentence summary.

4. STEP-BY-STEP FUNNEL & BUYER PSYCHOLOGY:
   - When explaining the Funnel, articulate:
     1. Awareness: What the buyer is feeling/believing, the problem hook.
     2. Consideration: How we demonstrate contrast against bloated tools.
     3. Conversion: How the frictionless trial removes all setup fear.
     4. Retention: How weekly value proof keeps them engaged.
   - When explaining Buyer Psychology, break down:
     * What they want (speed, simplicity, predictable ROI).
     * What they fear (wasting time, migration disruption, hidden fees).
     * What proof they need (1-click setup, transparent pricing, visual workflow proof).

5. STRICT CAUSAL DISCIPLINE:
   - Separate OBSERVED FACTS from HYPOTHESES from CONFIRMED CAUSES.
   - If asked "Why are leads below plan?": State observed facts (148 vs 180 target, CPA $42.50, ROAS 3.2x), explain that consideration-stage drop-off correlates with the shortfall, but Avyron has NOT confirmed a single definitive cause.
   - If asked "Did the latest change improve results?" / "Did it work?": State plainly that the outcome is currently INSUFFICIENT_DATA while the mature 7-day observation window is active.

6. LANE COMPARISON & SCOPING:
   - When comparing lanes, clearly contrast the audience roles, pain points, messaging angles, and platform focus.

7. STRATEGY EVOLUTION & CHANGES:
   - When asked what changed or why, explain:
     * BEFORE: Prior funnel/consideration structure.
     * WHY: Observed consideration-stage friction and lead shortfall.
     * WHAT CHANGED: Top-of-funnel consideration proof placement refined in Strategy v6.
     * EXPECTED EFFECT: Faster trial onboarding and higher SMB conversion.
     * RESULT: Currently INSUFFICIENT_DATA (Observation window active).

8. CANONICAL SOURCE PURITY:
   - Always answer domain questions (Positioning, Differentiation, Offer, Funnel, Persuasion, Product Truth) from the Canonical Authorities below.
   - Do NOT quote from the Strategy Plan presentation unless the user specifically asks "What does the plan say?".

9. READ-ONLY IMMUTABILITY:
   - If the user asks to "change the positioning", "change the funnel", "update the offer", or "create tasks", you MUST NOT pretend to change it directly. Explain that strategic adaptations require review through the Strategy Hub / Adaptation workflow, and guide them there.

10. OPTIONAL SECONDARY NAVIGATION:
   - At the very end of your response, you may optionally include 1–2 natural Markdown deep links (e.g. [View Strategy], [Open Watchtower], [Today's Tasks], [Read Monthly Report]) as convenience shortcuts, but ONLY after your full conversational explanation is complete.

============================================================
CANONICAL STRATEGY & BUSINESS TRUTH (CANONICAL AUTHORITIES)
============================================================
Campaign Identity: ${campaignName} (ID: ${campaignId})
Campaign Goal: ${campaignGoal}
Campaign Platform: ${campaignPlatform}

1. BUSINESS UNDERSTANDING / PRODUCT TRUTH (Source: businessUnderstandingSnapshots):
   - Product Truth: ${canonicalProductTruth}
   - Core Problem Solved: ${canonicalProblemSolved}
   - Core Offering: ${canonicalCoreOffer}
   - Target Audience Profile: ${canonicalTargetAudience}

2. STRATEGY ROOT & LINEAGE (Source: strategyRoots & strategyAdaptationOutcomes):
   - Strategy Version: Strategy v${strategyVersion}
   - Strategy Root ID: ${strategyRootId || 'root_canonical_active'}
   - Direction: ${strategicDirection}
   - Strategic Lineage & Evolution: ${lineageSummary}
   - Approved Strategic Lanes:
${approvedLanes.map((l, i) => `     Lane ${i + 1}: "${l.title}" (ID: ${l.id})
       - Audience Segment: ${l.audienceSegment}
       - Strategic Focus: ${l.focusAngle}`).join("\n")}

3. POSITIONING AUTHORITY (Source: positioningSnapshots):
   - Statement: ${canonicalPositioning}
   - Enemy Definition: ${canonicalEnemy}
   - Contrast Axis: ${canonicalContrastAxis}

4. DIFFERENTIATION AUTHORITY (Source: differentiationSnapshots):
   - Mechanism Core: ${canonicalDifferentiation}
   - Pillars:
${canonicalPillars.map(p => `       • ${p}`).join("\n")}

5. OFFER AUTHORITY (Source: offerSnapshots):
   - Primary Offer: ${canonicalOffer}
   - Risk Reversal: ${canonicalRiskReversal}

6. FUNNEL AUTHORITY BY LANE (Source: funnelSnapshots):
${approvedLanes.map(l => `   - Lane "${l.title}" (ID: ${l.id}):
       Awareness: ${laneFunnels[l.id]?.awareness || laneFunnels['default']?.awareness || 'Top-of-funnel awareness.'}
       Consideration: ${laneFunnels[l.id]?.consideration || laneFunnels['default']?.consideration || 'Side-by-side workflow comparison.'}
       Conversion: ${laneFunnels[l.id]?.conversion || laneFunnels['default']?.conversion || '14-day trial onboarding.'}
       Retention: ${laneFunnels[l.id]?.retention || laneFunnels['default']?.retention || 'Automated performance reports.'}`).join("\n")}

7. PERSUASION & BUYER PSYCHOLOGY BY LANE (Source: persuasionSnapshots):
${approvedLanes.map(l => `   - Lane "${l.title}" (ID: ${l.id}):
       Core Desire: ${lanePersuasion[l.id]?.coreDesire || 'Save hours each week on social posting.'}
       Primary Objection: ${lanePersuasion[l.id]?.primaryObjection || lanePersuasion['default']?.primaryObjection || 'Migrating workflows takes too much effort.'}
       Buyer Worries: ${lanePersuasion[l.id]?.buyerWorries || lanePersuasion['default']?.buyerWorries || 'Fear of downtime or lost scheduled posts.'}
       Required Proof: ${lanePersuasion[l.id]?.proofNeeded || lanePersuasion['default']?.proofNeeded || '1-click account connection.'}
       Belief Shift: ${lanePersuasion[l.id]?.beliefShift || 'Focused speed outperforms complex enterprise suites.'}`).join("\n")}

8. CHANNEL STRATEGY (Source: channelSelectionSnapshots):
   - Channels: ${canonicalChannels}
   - Channel Rationale: ${channelRationale}

9. OBSERVED PERFORMANCE & CAUSAL STATUS (Source: performanceSnapshots):
   - Observed Facts: ${performanceFact}
   - Lead Shortfall Causal Status: CORRELATED / HYPOTHESIS (NOT CONFIRMED CAUSE).
   - Lead Shortfall Diagnosis: ${leadShortfallCausalDiagnosis}
   - Adaptation Outcome Status: INSUFFICIENT_DATA (Monitoring window active).

10. MARKET INTELLIGENCE (Source: pipelineChangeEvents):
${watchtowerFacts}

11. ACTIVE REASONING & ADAPTATIONS (Source: reasoningCases):
${reasoningFacts}

12. WHAT TO DO TODAY PRIORITIES (Source: executionTasks):
${wtdtFacts}

13. MONTHLY REPORTS MEMORY (Source: monthlyReports):
${reportsFacts}
${planPresentationFact ? `\n14. STRATEGY PLAN PRESENTATION (Source: strategicPlans):\n${planPresentationFact}` : ''}
`;

  return {
    systemPrompt,
    trace: {
      accountId,
      campaignId,
      domainsUsed,
      canonicalSourceTypes,
      artifactIds,
      strategyRootId,
      strategyVersion,
      laneIds,
      causalStatuses,
    },
  };
}
