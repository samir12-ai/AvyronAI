import { db } from "../db";
import { strategicPlans, requiredWork, calendarEntries, businessDataLayer } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { aiChat } from "../ai-client";
import type { OrchestratorConfig } from "./index";
import type { EngineId, EngineStepResult } from "./priority-matrix";

export interface SynthesizedPlan {
  strategicSummary: {
    strategy: string;
    targetAudience: string;
    growthObjective: string;
    rationale: string;
  };
  monthlyObjective: {
    objective: string;
    type: string;
    targetMetric: string;
    targetValue: string;
  };
  kpiStructure: {
    primaryKPI: { name: string; target: string; cadence: string };
    secondaryKPI: { name: string; target: string; cadence: string };
    performanceExpectations: string;
  };
  contentDistribution: {
    reelsPerWeek: number;
    postsPerWeek: number;
    storiesPerDay: number;
    carouselsPerWeek: number;
    videosPerWeek: number;
    rationale: string;
    contentPillars: Array<{ pillar: string; percentage: string; examples: string[] }>;
  };
  creativeTesting: {
    tests: Array<{ testName: string; variable: string; duration: string; rationale: string }>;
  };
  budgetAllocation: {
    totalBudget: string;
    breakdown: Array<{ category: string; percentage: number; purpose: string }>;
  };
  kpiMonitoring: {
    metrics: Array<{ kpi: string; target: string; frequency: string; alertThreshold: string }>;
    reportingCadence: string;
  };
  competitiveWatch: {
    targets: Array<{ competitor: string; watchMetrics: string[]; checkFrequency: string }>;
  };
  riskTriggers: {
    triggers: Array<{ trigger: string; condition: string; action: string; severity: string }>;
    escalationPath: string[];
  };
}

function extractEngineInsights(results: Map<EngineId, EngineStepResult>): string {
  const sections: string[] = [];

  const mi = results.get("market_intelligence");
  if (mi?.status === "SUCCESS" && mi.output) {
    const out = mi.output.output || mi.output;
    const competitors = out.competitors?.length || 0;
    const marketState = out.marketState || "unknown";
    sections.push(`Market Intelligence: ${competitors} competitors analyzed, market state: ${marketState}`);
  }

  const audience = results.get("audience");
  if (audience?.status === "SUCCESS" && audience.output) {
    const pains = audience.output.painProfiles?.length || 0;
    const segments = audience.output.audienceSegments?.length || 0;
    sections.push(`Audience: ${pains} pain profiles, ${segments} segments identified`);
  }

  const positioning = results.get("positioning");
  if (positioning?.status === "SUCCESS" && positioning.output) {
    const territories = positioning.output.territories?.length || 0;
    sections.push(`Positioning: ${territories} territories mapped`);
  }

  const offer = results.get("offer");
  if (offer?.status === "SUCCESS" && offer.output) {
    sections.push(`Offer Engine: structured offer constructed`);
  }

  const funnel = results.get("funnel");
  if (funnel?.status === "SUCCESS" && funnel.output) {
    sections.push(`Funnel: trust path and conversion flow defined`);
  }

  const budget = results.get("budget_governor");
  if (budget?.status === "SUCCESS" && budget.output) {
    const decision = budget.output.decision || "APPROVED";
    sections.push(`Budget Governor: ${decision}`);
  }

  const channel = results.get("channel_selection");
  if (channel?.status === "SUCCESS" && channel.output) {
    const out = channel.output.output || channel.output;
    const primary = out.primaryChannel?.channelName || out.primaryChannel?.name || "unknown";
    const secondary = out.secondaryChannel?.channelName || out.secondaryChannel?.name || "none";
    const rejected = out.rejectedChannels?.length || 0;
    sections.push(`Channel Selection: primary "${primary}", secondary "${secondary}", ${rejected} rejected`);
  }

  const diff = results.get("differentiation");
  if (diff?.status === "SUCCESS" && diff.output) {
    const out = diff.output.output || diff.output;
    const pillars = out.pillars?.length || 0;
    const claims = out.claimStructures?.length || 0;
    const proofAssets = out.proofArchitecture?.length || 0;
    const authorityMode = out.authorityMode?.mode || out.authorityMode || "unknown";
    sections.push(`Differentiation: ${pillars} pillars, ${claims} claim structures, ${proofAssets} proof assets, authority mode: ${authorityMode}`);
  }

  const integrity = results.get("integrity");
  if (integrity?.status === "SUCCESS" && integrity.output) {
    const out = integrity.output.output || integrity.output;
    const score = out.confidenceScore ?? "N/A";
    const warnings = out.structuralWarnings?.length || 0;
    const stable = out.stabilityResult?.stable ?? "unknown";
    sections.push(`Integrity: confidence ${score}, ${warnings} structural warnings, stable: ${stable}`);
  }

  const awareness = results.get("awareness");
  if (awareness?.status === "SUCCESS" && awareness.output) {
    const out = awareness.output.output || awareness.output;
    const primaryRoute = out.primaryRoute?.routeName || out.primaryRoute?.name || "unknown";
    const layers = out.layerResults?.length || 0;
    const confidence = out.confidenceScore ?? "N/A";
    sections.push(`Awareness: primary route "${primaryRoute}", ${layers} layer results, confidence ${confidence}`);
  }

  const persuasion = results.get("persuasion");
  if (persuasion?.status === "SUCCESS" && persuasion.output) {
    const out = persuasion.output.output || persuasion.output;
    const primaryRoute = out.primaryRoute?.routeName || out.primaryRoute?.name || "unknown";
    const altRoute = out.alternativeRoute?.routeName || "none";
    const layers = out.layerResults?.length || 0;
    sections.push(`Persuasion: primary route "${primaryRoute}", alternative "${altRoute}", ${layers} layer results`);
  }

  const statVal = results.get("statistical_validation");
  if (statVal?.status === "SUCCESS" && statVal.output) {
    const out = statVal.output.output || statVal.output;
    const state = out.validationState || "unknown";
    const claimConfidence = out.claimConfidenceScore ?? "N/A";
    const warnings = out.structuralWarnings?.length || 0;
    const claimValidations = out.claimValidations?.length || 0;
    sections.push(`Statistical Validation: state ${state}, claim confidence ${claimConfidence}, ${claimValidations} claims validated, ${warnings} warnings`);
  }

  const iteration = results.get("iteration");
  if (iteration?.status === "SUCCESS" && iteration.output) {
    const out = iteration.output.output || iteration.output;
    const hypotheses = out.nextTestHypotheses?.length || 0;
    const targets = out.optimizationTargets?.length || 0;
    const failedFlags = out.failedStrategyFlags?.length || 0;
    const planSteps = out.iterationPlan?.length || 0;
    sections.push(`Iteration: ${hypotheses} test hypotheses, ${targets} optimization targets, ${planSteps} plan steps, ${failedFlags} failed strategy flags`);
  }

  const retention = results.get("retention");
  if (retention?.status === "SUCCESS" && retention.output) {
    const out = retention.output.output || retention.output;
    const loops = out.retentionLoops?.length || 0;
    const churnRisks = out.churnRiskFlags?.length || 0;
    const ltvPaths = out.ltvExpansionPaths?.length || 0;
    const upsells = out.upsellTriggers?.length || 0;
    const confidence = out.confidenceScore ?? "N/A";
    sections.push(`Retention: ${loops} retention loops, ${churnRisks} churn risk flags, ${ltvPaths} LTV paths, ${upsells} upsell triggers, confidence ${confidence}`);
  }

  return sections.join("\n");
}

async function generatePlanWithAI(
  engineInsights: string,
  businessData: any,
  campaign: any,
): Promise<SynthesizedPlan> {
  const objective = campaign?.objective || businessData?.funnelObjective || "AWARENESS";
  const businessType = businessData?.businessType || "general";
  const location = campaign?.location || businessData?.geoScope || "Not specified";
  const budget = businessData?.monthlyBudget || "Not specified";

  const prompt = `You are a marketing strategist synthesizing engine outputs into a coherent execution plan.

Business Type: ${businessType}
Location: ${location}
Objective: ${objective}
Monthly Budget: ${budget}

Engine Analysis Results:
${engineInsights}

Generate a complete execution plan with these 9 sections. Return ONLY valid JSON matching this exact structure:
{
  "strategicSummary": {
    "strategy": "What the strategy is",
    "targetAudience": "Who it targets",
    "growthObjective": "What the growth objective is",
    "rationale": "Why this path was selected"
  },
  "monthlyObjective": {
    "objective": "Clear business objective",
    "type": "leads|sales|authority|retention",
    "targetMetric": "Primary metric name",
    "targetValue": "Target value"
  },
  "kpiStructure": {
    "primaryKPI": { "name": "KPI name", "target": "target value", "cadence": "weekly|daily" },
    "secondaryKPI": { "name": "KPI name", "target": "target value", "cadence": "weekly" },
    "performanceExpectations": "Expected performance"
  },
  "contentDistribution": {
    "reelsPerWeek": 3,
    "postsPerWeek": 3,
    "storiesPerDay": 2,
    "carouselsPerWeek": 1,
    "videosPerWeek": 0,
    "rationale": "Why this content mix",
    "contentPillars": [{"pillar":"name","percentage":"40%","examples":["example"]}]
  },
  "creativeTesting": {
    "tests": [{"testName":"name","variable":"what varies","duration":"2 weeks","rationale":"why"}]
  },
  "budgetAllocation": {
    "totalBudget": "${budget}",
    "breakdown": [{"category":"name","percentage":40,"purpose":"why"}]
  },
  "kpiMonitoring": {
    "metrics": [{"kpi":"name","target":"value","frequency":"weekly","alertThreshold":"condition"}],
    "reportingCadence": "Weekly review, monthly deep-dive"
  },
  "competitiveWatch": {
    "targets": [{"competitor":"name","watchMetrics":["metric"],"checkFrequency":"weekly"}]
  },
  "riskTriggers": {
    "triggers": [{"trigger":"name","condition":"when","action":"what","severity":"high"}],
    "escalationPath": ["step1","step2"]
  }
}`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      accountId: "default",
      endpoint: "orchestrator-plan-synthesis",
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return JSON.parse(content) as SynthesizedPlan;
  } catch (err: any) {
    console.warn(`[PlanSynthesis] AI synthesis failed, using deterministic fallback: ${err.message}`);
    return buildDeterministicPlan(businessData, campaign, objective);
  }
}

function buildDeterministicPlan(businessData: any, campaign: any, objective: string): SynthesizedPlan {
  const businessType = businessData?.businessType || "general business";
  const location = campaign?.location || "target market";
  const budget = businessData?.monthlyBudget || "available budget";

  return {
    strategicSummary: {
      strategy: `${objective.toLowerCase()}-focused growth strategy for ${businessType}`,
      targetAudience: `Primary audience in ${location} seeking ${businessType} solutions`,
      growthObjective: `Increase ${objective.toLowerCase()} through structured content and engagement`,
      rationale: "Based on market analysis, audience insights, and competitive positioning",
    },
    monthlyObjective: {
      objective: `Drive ${objective.toLowerCase()} growth`,
      type: objective.toLowerCase(),
      targetMetric: objective === "SALES" ? "Revenue" : objective === "LEADS" ? "Lead count" : "Reach",
      targetValue: "+20% month-over-month",
    },
    kpiStructure: {
      primaryKPI: { name: "Engagement Rate", target: "3-5%", cadence: "weekly" },
      secondaryKPI: { name: "Reach Growth", target: "+15% monthly", cadence: "weekly" },
      performanceExpectations: "Steady improvement over 30-day period with weekly benchmarks",
    },
    contentDistribution: {
      reelsPerWeek: 3,
      postsPerWeek: 2,
      storiesPerDay: 1,
      carouselsPerWeek: 1,
      videosPerWeek: 0,
      rationale: `Balanced content mix optimized for ${objective.toLowerCase()} objective`,
      contentPillars: [
        { pillar: "Educational", percentage: "40%", examples: ["How-to content", "Tips and insights"] },
        { pillar: "Social Proof", percentage: "30%", examples: ["Testimonials", "Case studies"] },
        { pillar: "Behind the Scenes", percentage: "20%", examples: ["Process", "Team culture"] },
        { pillar: "Promotional", percentage: "10%", examples: ["Direct offers", "Limited deals"] },
      ],
    },
    creativeTesting: {
      tests: [
        { testName: "Hook Variations", variable: "Opening 3 seconds", duration: "2 weeks", rationale: "Optimize attention capture" },
        { testName: "CTA Placement", variable: "CTA position and format", duration: "2 weeks", rationale: "Maximize conversion" },
        { testName: "Content Format", variable: "Reels vs Carousels", duration: "3 weeks", rationale: "Find best performing format" },
      ],
    },
    budgetAllocation: {
      totalBudget: budget,
      breakdown: [
        { category: "Content Creation", percentage: 40, purpose: "Quality visuals and video" },
        { category: "Paid Promotion", percentage: 30, purpose: "Boosting top performers" },
        { category: "Community", percentage: 15, purpose: "Engagement and partnerships" },
        { category: "Tools & Analytics", percentage: 15, purpose: "Optimization infrastructure" },
      ],
    },
    kpiMonitoring: {
      metrics: [
        { kpi: "Reach", target: "+20% MoM", frequency: "weekly", alertThreshold: "-10% WoW" },
        { kpi: "Engagement Rate", target: "3-5%", frequency: "weekly", alertThreshold: "Below 2%" },
        { kpi: "Profile Visits", target: "+15% monthly", frequency: "weekly", alertThreshold: "2-week decline" },
      ],
      reportingCadence: "Weekly review, monthly deep-dive",
    },
    competitiveWatch: {
      targets: [
        { competitor: "Top competitor", watchMetrics: ["Posting frequency", "Engagement rate", "Content types"], checkFrequency: "weekly" },
      ],
    },
    riskTriggers: {
      triggers: [
        { trigger: "Engagement Drop", condition: "Below 2% for 2 weeks", action: "Review content mix", severity: "high" },
        { trigger: "Reach Plateau", condition: "Flat for 3 weeks", action: "Test new formats", severity: "medium" },
        { trigger: "Budget Overrun", condition: "Spend exceeds plan by 20%", action: "Pause paid promotion", severity: "critical" },
      ],
      escalationPath: ["Content review", "Strategy adjustment", "Full plan revision"],
    },
  };
}

function deriveContentVolume(plan: SynthesizedPlan, periodDays: number) {
  const weeks = Math.ceil(periodDays / 7);
  return {
    reelsPerWeek: plan.contentDistribution.reelsPerWeek,
    postsPerWeek: plan.contentDistribution.postsPerWeek,
    storiesPerDay: plan.contentDistribution.storiesPerDay,
    carouselsPerWeek: plan.contentDistribution.carouselsPerWeek,
    videosPerWeek: plan.contentDistribution.videosPerWeek,
    totalReels: plan.contentDistribution.reelsPerWeek * weeks,
    totalPosts: plan.contentDistribution.postsPerWeek * weeks,
    totalStories: plan.contentDistribution.storiesPerDay * periodDays,
    totalCarousels: plan.contentDistribution.carouselsPerWeek * weeks,
    totalVideos: plan.contentDistribution.videosPerWeek * weeks,
    totalContentPieces:
      plan.contentDistribution.reelsPerWeek * weeks +
      plan.contentDistribution.postsPerWeek * weeks +
      plan.contentDistribution.storiesPerDay * periodDays +
      plan.contentDistribution.carouselsPerWeek * weeks +
      plan.contentDistribution.videosPerWeek * weeks,
  };
}

function generateCalendarSlots(
  plan: SynthesizedPlan,
  periodDays: number,
  campaignId: string,
  accountId: string,
  planId: string
): Array<{
  planId: string;
  campaignId: string;
  accountId: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  status: string;
}> {
  const slots: any[] = [];
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  const postingTimes: Record<string, string> = {
    REEL: "09:00",
    POST: "12:00",
    STORY: "18:00",
    CAROUSEL: "10:00",
    VIDEO: "11:00",
  };

  for (let day = 0; day < periodDays; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);
    const dateStr = date.toISOString().split("T")[0];
    const dayOfWeek = date.getDay();

    if (dayOfWeek !== 0) {
      const weekIndex = Math.floor(day / 7);

      if (dayOfWeek <= plan.contentDistribution.reelsPerWeek) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "REEL",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.REEL,
          title: `Reel - Week ${weekIndex + 1}`,
          status: "PENDING",
        });
      }

      if (dayOfWeek <= plan.contentDistribution.postsPerWeek && dayOfWeek > 0) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "POST",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.POST,
          title: `Post - Week ${weekIndex + 1}`,
          status: "PENDING",
        });
      }

      if (dayOfWeek <= (plan.contentDistribution.carouselsPerWeek || 0) && dayOfWeek > 0) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "CAROUSEL",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.CAROUSEL,
          title: `Carousel - Week ${weekIndex + 1}`,
          status: "PENDING",
        });
      }
    }

    for (let s = 0; s < plan.contentDistribution.storiesPerDay; s++) {
      slots.push({
        planId,
        campaignId,
        accountId,
        contentType: "STORY",
        scheduledDate: dateStr,
        scheduledTime: s === 0 ? "10:00" : "17:00",
        title: `Story - Day ${day + 1}`,
        status: "PENDING",
      });
    }
  }

  return slots;
}

export async function synthesizePlan(
  config: OrchestratorConfig,
  ctx: any,
  results: Map<EngineId, EngineStepResult>
): Promise<{ planId: string; plan: SynthesizedPlan }> {
  const [bizData] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, config.accountId),
        eq(businessDataLayer.campaignId, config.campaignId)
      )
    )
    .limit(1);

  const { growthCampaigns } = await import("@shared/schema");
  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, config.campaignId))
    .limit(1);

  const engineInsights = extractEngineInsights(results);
  const synthesized = await generatePlanWithAI(engineInsights, bizData, campaign);

  const periodDays = 30;
  const volume = deriveContentVolume(synthesized, periodDays);

  const [plan] = await db.insert(strategicPlans).values({
    accountId: config.accountId,
    blueprintId: "orchestrator-v2",
    campaignId: config.campaignId,
    planJson: JSON.stringify(synthesized),
    planSummary: synthesized.strategicSummary.strategy,
    status: "DRAFT",
    executionStatus: "IDLE",
    totalCalendarEntries: 0,
    totalStudioItems: 0,
    totalPublished: 0,
    totalFailed: 0,
    totalCanceled: 0,
  }).returning();

  await db.insert(requiredWork).values({
    planId: plan.id,
    campaignId: config.campaignId,
    accountId: config.accountId,
    periodDays,
    reelsPerWeek: volume.reelsPerWeek,
    postsPerWeek: volume.postsPerWeek,
    storiesPerDay: volume.storiesPerDay,
    carouselsPerWeek: volume.carouselsPerWeek,
    videosPerWeek: volume.videosPerWeek,
    totalReels: volume.totalReels,
    totalPosts: volume.totalPosts,
    totalStories: volume.totalStories,
    totalCarousels: volume.totalCarousels,
    totalVideos: volume.totalVideos,
    totalContentPieces: volume.totalContentPieces,
    generatedCount: 0,
    readyCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
  });

  const calendarSlots = generateCalendarSlots(
    synthesized,
    periodDays,
    config.campaignId,
    config.accountId,
    plan.id
  );

  if (calendarSlots.length > 0) {
    await db.insert(calendarEntries).values(calendarSlots);
    await db.update(strategicPlans)
      .set({ totalCalendarEntries: calendarSlots.length })
      .where(eq(strategicPlans.id, plan.id));
  }

  console.log(`[PlanSynthesis] Created plan ${plan.id} with ${calendarSlots.length} calendar entries and ${volume.totalContentPieces} required content pieces`);

  try {
    const { generateContentDna } = await import("../content-dna-routes");
    await generateContentDna(config.campaignId, config.accountId, plan.id);
    console.log(`[PlanSynthesis] Content DNA generated for plan ${plan.id}`);
  } catch (dnaErr: any) {
    console.warn(`[PlanSynthesis] Content DNA generation failed (non-blocking):`, dnaErr.message);
  }

  return { planId: plan.id, plan: synthesized };
}
