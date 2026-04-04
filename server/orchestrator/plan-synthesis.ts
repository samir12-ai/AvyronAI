import { db } from "../db";
import { strategicPlans, requiredWork, calendarEntries, businessDataLayer } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { aiChat } from "../ai-client";
import { lockRootBundle } from "../root-bundle";
import { decomposeGoal, generateSimulation, normalizeGoal, computeFunnelMath, checkFeasibility } from "../goal-math";
import { checkPlanReadiness, resolveArchetype } from "../plan-gate";
import { composeTasks } from "../task-composer";
import { logAssumptions, type AssumptionEntry } from "../conflict-resolver";
import { computeAdaptiveRhythm } from "../adaptive-rhythm/engine";
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
    strategyFeed?: Array<{ insight: string; actionableResponse: string; priority: string }>;
  };
  riskTriggers: {
    triggers: Array<{ trigger: string; condition: string; action: string; severity: string; optimizationPlaybook?: string }>;
    escalationPath: string[];
    earlyWarningSystem?: Array<{ signal: string; threshold: string; response: string }>;
  };
  executionBlueprintDnaLink?: {
    contentPillarToDna?: Array<{ pillar: string; dnaElements: string[]; hookApproach: string; ctaStyle: string }>;
    weeklyDnaApplication?: string;
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

function extractLockedDecisions(results: Map<EngineId, EngineStepResult>): string {
  const lines: string[] = [];

  const positioning = results.get("positioning");
  if (positioning?.status === "SUCCESS" && positioning.output) {
    const out = positioning.output;
    const territories = out.territories || [];
    const primary = territories[0];
    if (primary) {
      if (primary.name) lines.push(`  Positioning territory: "${primary.name}"`);
      const enemy = out.enemyDefinition || primary.enemyDefinition;
      if (enemy) lines.push(`  Positioning enemy: "${enemy}"`);
      const contrast = out.contrastAxis || primary.contrastAxis;
      if (contrast) lines.push(`  Contrast axis: "${contrast}"`);
      const narrative = out.narrativeDirection || primary.narrativeDirection;
      if (narrative) lines.push(`  Narrative direction: "${narrative}"`);
    }
  }

  const mechanism = results.get("mechanism");
  if (mechanism?.status === "SUCCESS" && mechanism.output) {
    const out = mechanism.output.output || mechanism.output;
    if (out.mechanismName) lines.push(`  Mechanism name: "${out.mechanismName}"`);
    if (out.mechanismType) lines.push(`  Mechanism type: "${out.mechanismType}"`);
  }

  const offer = results.get("offer");
  if (offer?.status === "SUCCESS" && offer.output) {
    const out = offer.output.output || offer.output;
    if (out.offerName) lines.push(`  Offer name: "${out.offerName}"`);
    if (out.coreOutcome) lines.push(`  Offer core outcome: "${out.coreOutcome}"`);
  }

  const diff = results.get("differentiation");
  if (diff?.status === "SUCCESS" && diff.output) {
    const out = diff.output.output || diff.output;
    if (out.pillars && out.pillars.length > 0) {
      const pillarNames = (out.pillars as any[]).map((p: any) => p.name || p.pillarName).filter(Boolean);
      if (pillarNames.length > 0) {
        lines.push(`  Differentiation pillars: ${pillarNames.map((n: string) => `"${n}"`).join(", ")}`);
      }
    }
    const authorityMode = out.authorityMode?.mode || (typeof out.authorityMode === "string" ? out.authorityMode : null);
    if (authorityMode && authorityMode !== "unknown") lines.push(`  Authority mode: "${authorityMode}"`);
  }

  const persuasion = results.get("persuasion");
  if (persuasion?.status === "SUCCESS" && persuasion.output) {
    const out = persuasion.output.output || persuasion.output;
    if (out.persuasionMode) lines.push(`  Persuasion mode: "${out.persuasionMode}"`);
    const primaryRouteName = out.primaryRoute?.routeName || out.primaryRoute?.name;
    if (primaryRouteName) lines.push(`  Persuasion primary route: "${primaryRouteName}"`);
  }

  const channel = results.get("channel_selection");
  if (channel?.status === "SUCCESS" && channel.output) {
    const out = channel.output.output || channel.output;
    const primaryName = out.primaryChannel?.channelName || out.primaryChannel?.name;
    const primaryRole = out.primaryChannel?.channelRole || out.primaryChannel?.role;
    if (primaryName) lines.push(`  Primary channel: "${primaryName}"${primaryRole ? ` — role: "${primaryRole}"` : ""}`);
    const secondaryName = out.secondaryChannel?.channelName || out.secondaryChannel?.name;
    const secondaryRole = out.secondaryChannel?.channelRole || out.secondaryChannel?.role;
    if (secondaryName) lines.push(`  Secondary channel: "${secondaryName}"${secondaryRole ? ` — role: "${secondaryRole}"` : ""}`);
  }

  const funnel = results.get("funnel");
  if (funnel?.status === "SUCCESS" && funnel.output) {
    const out = funnel.output.output || funnel.output;
    if (out.trustPathScore !== undefined) lines.push(`  Trust path score: ${out.trustPathScore}`);
    const funnelLabel = out.funnelType || out.funnelName;
    if (funnelLabel) lines.push(`  Funnel type: "${funnelLabel}"`);
  }

  return lines.join("\n");
}

async function generatePlanWithAI(
  engineInsights: string,
  businessData: any,
  campaign: any,
  goalMathContext?: { goal: any; funnel: any; feasibility: any; archetype: any } | null,
  lockedDecisions?: string,
  accountId: string = "default",
  memoryContextBlock?: string,
  campaignId: string = "",
  precomputedRhythm?: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number; reasoning: string; performanceBasis: string } | null,
): Promise<SynthesizedPlan> {
  const objective = campaign?.objective || businessData?.funnelObjective || "AWARENESS";
  const businessType = businessData?.businessType || "general";
  const location = campaign?.location || businessData?.geoScope || "Not specified";
  const budget = businessData?.monthlyBudget || "Not specified";

  let goalMathSection = "";
  if (goalMathContext) {
    const { goal, funnel, feasibility, archetype } = goalMathContext;
    goalMathSection = `
GOAL DECOMPOSITION (use these numbers as the source of truth):
  Goal: ${goal.label}
  Type: ${goal.goalType}
  Target: ${goal.target}
  Time Horizon: ${goal.timeHorizonDays} days
  Feasibility: ${feasibility.verdict} (${feasibility.score}/100)

FUNNEL MATH (full acquisition flow):
  Reach: ${funnel.requiredReach.toLocaleString()}
  → Clicks (CTR ${(funnel.ctr * 100).toFixed(1)}%): ${funnel.requiredClicks.toLocaleString()}
  → Conversations (${(funnel.clickToConversationRate * 100).toFixed(0)}%): ${funnel.requiredConversations.toLocaleString()}
  → Leads (${(funnel.conversationToLeadRate * 100).toFixed(0)}%): ${funnel.requiredLeads.toLocaleString()}
  → Qualified Leads (20%): ${funnel.requiredQualifiedLeads.toLocaleString()}
  → Closed Clients (${(funnel.leadToClientRate * 100).toFixed(1)}%): ${funnel.requiredClosedClients}
  Close Rate: ${(funnel.closeRate * 100).toFixed(1)}%${feasibility.budgetAdjustment?.needed ? `\n\nBUDGET ADJUSTMENT REQUIRED:\n  ${feasibility.budgetAdjustment.explanation}\n  Adjustment Type: ${feasibility.budgetAdjustment.type}\n  Affordable Leads: ${feasibility.budgetAdjustment.affordableLeads}` : ""}

BUSINESS ARCHETYPE: ${archetype?.name || businessType}
  Funnel Type: ${archetype?.funnelArchetype || "standard"}
  Trust Requirement: ${archetype?.trustRequirement || 5}/10
  Proof Requirement: ${archetype?.proofRequirement || 5}/10
  Channel Priority: ${archetype?.channelPriority?.join(", ") || "instagram"}
  Content Formats: ${archetype?.typicalFormats?.join(", ") || "reels, posts"}

IMPORTANT: Content volumes and distribution MUST be derived from the funnel math above.
The plan must explain WHY each content type volume was chosen based on the goal decomposition.
`;
  }

  const lockedBlock = lockedDecisions
    ? `LOCKED DECISIONS — These are verbatim strategic outputs from upstream engines. You MUST reference these exact values in your plan. Do NOT rephrase, paraphrase, generalize, or substitute synonyms for any value below. The mechanism name, positioning territory, offer name, differentiation pillars, and channel assignments must appear exactly as stated:
${lockedDecisions}

`
    : "";

  const memoryBlock = memoryContextBlock
    ? `${memoryContextBlock}

`
    : "";

  const rhythmConstraintBlock = precomputedRhythm
    ? `LOCKED CONTENT RHYTHM (adaptive engine output — do NOT override these values):
Reels/week: ${precomputedRhythm.reelsPerWeek}
Carousels/week: ${precomputedRhythm.carouselsPerWeek}
Stories/day: ${precomputedRhythm.storiesPerDay}
Posts/week: ${precomputedRhythm.postsPerWeek}
Basis: ${precomputedRhythm.performanceBasis}
Reasoning: ${precomputedRhythm.reasoning}
INSTRUCTION: Use these exact counts in contentDistribution. Do not derive rhythm from objective, business type, or platform templates. These values are pre-computed and locked.

`
    : "";

  const prompt = `You are a marketing strategist assembling an execution plan from engine outputs. Your job is to ASSEMBLE, not to re-derive strategy.

Business Type: ${businessType}
Location: ${location}
Objective: ${objective}
Monthly Budget: ${budget}
${memoryBlock}${rhythmConstraintBlock}${lockedBlock}${goalMathSection}
Engine Analysis Results (use for volume, timing, and structural decisions):
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
    "targets": [{"competitor":"name","watchMetrics":["metric"],"checkFrequency":"weekly"}],
    "strategyFeed": [{"insight":"competitive insight that should influence your strategy","actionableResponse":"how to respond to this competitive signal","priority":"high|medium|low"}]
  },
  "riskTriggers": {
    "triggers": [{"trigger":"name","condition":"when this triggers","action":"specific optimization action to take","severity":"high|medium|low","optimizationPlaybook":"detailed step-by-step response plan"}],
    "escalationPath": ["step1","step2"],
    "earlyWarningSystem": [{"signal":"what to watch for","threshold":"when to act","response":"immediate action"}]
  },
  "executionBlueprintDnaLink": {
    "contentPillarToDna": [{"pillar":"content pillar name","dnaElements":["which DNA components power this pillar"],"hookApproach":"recommended hook style","ctaStyle":"CTA approach for this pillar"}],
    "weeklyDnaApplication": "How to apply Content DNA rules across the weekly content schedule"
  }
}`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      accountId: accountId,
      endpoint: "orchestrator-plan-synthesis",
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return JSON.parse(content) as SynthesizedPlan;
  } catch (err: any) {
    console.warn(`[PlanSynthesis] AI synthesis failed, using deterministic fallback: ${err.message}`);
    return buildDeterministicPlan(businessData, campaign, objective, campaignId, accountId);
  }
}

async function buildDeterministicPlan(businessData: any, campaign: any, objective: string, campaignId: string, accountId: string): Promise<SynthesizedPlan> {
  const businessType = businessData?.businessType || "general business";
  const location = campaign?.location || "target market";
  const budget = businessData?.monthlyBudget || "available budget";

  let rhythm: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number; reasoning: string; performanceBasis: string } = {
    reelsPerWeek: 4, carouselsPerWeek: 2, storiesPerDay: 2, postsPerWeek: 1,
    reasoning: "default balanced distribution", performanceBasis: "default_balanced",
  };
  try {
    rhythm = await computeAdaptiveRhythm(campaignId, accountId);
  } catch (err: any) {
    console.warn(`[PlanSynthesis] AdaptiveRhythm fallback failed, using default:`, err.message);
  }

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
      reelsPerWeek: rhythm.reelsPerWeek,
      postsPerWeek: rhythm.postsPerWeek,
      storiesPerDay: rhythm.storiesPerDay,
      carouselsPerWeek: rhythm.carouselsPerWeek,
      videosPerWeek: 0,
      rationale: `Adaptive rhythm based on ${rhythm.performanceBasis}: ${rhythm.reasoning}`,
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
      strategyFeed: [
        { insight: "Competitors increasing Reels output", actionableResponse: "Match or exceed Reels volume, focus on differentiated hooks", priority: "high" },
        { insight: "Market shifting toward educational content", actionableResponse: "Add 1 educational carousel per week to content mix", priority: "medium" },
      ],
    },
    riskTriggers: {
      triggers: [
        { trigger: "Engagement Drop", condition: "Below 2% for 2 weeks", action: "Review content mix", severity: "high", optimizationPlaybook: "1. Audit last 10 posts for hook effectiveness 2. A/B test 3 new hook styles 3. Shift 20% of reels to trending formats 4. Re-evaluate posting times" },
        { trigger: "Reach Plateau", condition: "Flat for 3 weeks", action: "Test new formats", severity: "medium", optimizationPlaybook: "1. Introduce carousel content 2. Cross-promote to Stories 3. Test collaboration posts 4. Increase Reels proportion by 20%" },
        { trigger: "Budget Overrun", condition: "Spend exceeds plan by 20%", action: "Pause paid promotion", severity: "critical", optimizationPlaybook: "1. Pause all paid campaigns immediately 2. Audit CPA by channel 3. Reallocate to organic-only for 1 week 4. Resume with tighter daily caps" },
      ],
      escalationPath: ["Content review", "Strategy adjustment", "Full plan revision"],
      earlyWarningSystem: [
        { signal: "Declining save rate", threshold: "Save rate drops 30% week-over-week", response: "Increase value-driven content proportion" },
        { signal: "Rising CPA", threshold: "CPA exceeds target by 15%", response: "Pause lowest-performing ad sets and reallocate" },
      ],
    },
    executionBlueprintDnaLink: {
      contentPillarToDna: [
        { pillar: "Authority", dnaElements: ["messagingCore", "narrativeDna"], hookApproach: "Expertise-led hook", ctaStyle: "Soft authority CTA" },
        { pillar: "Engagement", dnaElements: ["hookDna", "contentAngleDna"], hookApproach: "Pattern interrupt", ctaStyle: "Comment/share CTA" },
        { pillar: "Conversion", dnaElements: ["ctaDna", "executionRules"], hookApproach: "Problem-solution hook", ctaStyle: "Direct action CTA" },
      ],
      weeklyDnaApplication: "Apply messaging core tone to all content. Use hookDna patterns for Reels. Apply ctaDna rules to conversion-focused posts. Follow executionRules always/never lists.",
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
  planId: string,
  rootBundleId: string | null = null,
  rootBundleVersion: number | null = null
): Array<{
  planId: string;
  campaignId: string;
  accountId: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  status: string;
  rootBundleId: string | null;
  rootBundleVersion: number | null;
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
          rootBundleId,
          rootBundleVersion,
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
          rootBundleId,
          rootBundleVersion,
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
          rootBundleId,
          rootBundleVersion,
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
        rootBundleId,
        rootBundleVersion,
      });
    }
  }

  return slots;
}

export async function synthesizePlan(
  config: OrchestratorConfig,
  ctx: any,
  results: Map<EngineId, EngineStepResult>,
  memoryContextBlock?: string,
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

  let rootBundle: { id: string; version: number; strategyHash: string } | null = null;
  try {
    rootBundle = await lockRootBundle(config.campaignId, config.accountId);
    console.log(`[PlanSynthesis] Root bundle locked: v${rootBundle.version} (${rootBundle.strategyHash})`);
  } catch (rootErr: any) {
    console.warn(`[PlanSynthesis] Root bundle lock failed (non-blocking):`, rootErr.message);
  }

  let goalMathContext: { goal: any; funnel: any; feasibility: any; archetype: any } | null = null;
  let goalDecomp: any = null;

  try {
    goalDecomp = await decomposeGoal(config.campaignId, config.accountId, rootBundle?.id || null, rootBundle?.version || null);
    const archetype = resolveArchetype(bizData?.businessType || "");
    goalMathContext = {
      goal: goalDecomp.goal,
      funnel: goalDecomp.funnel,
      feasibility: goalDecomp.feasibility,
      archetype,
    };
    console.log(`[PlanSynthesis] Goal decomposed: ${goalDecomp.goal.label} → ${goalDecomp.feasibility.verdict} (${goalDecomp.feasibility.score}/100)`);
  } catch (goalErr: any) {
    console.warn(`[PlanSynthesis] Goal decomposition failed (non-blocking):`, goalErr.message);
  }

  let readiness: any = null;
  try {
    readiness = await checkPlanReadiness(config.campaignId, config.accountId);
    console.log(`[PlanSynthesis] Plan gate: ${readiness.gate} (score: ${readiness.overallScore})`);
  } catch (gateErr: any) {
    console.warn(`[PlanSynthesis] Plan gate check failed (non-blocking):`, gateErr.message);
  }

  const engineInsights = extractEngineInsights(results);
  const lockedDecisions = extractLockedDecisions(results);

  let precomputedRhythm = null;
  try {
    precomputedRhythm = await computeAdaptiveRhythm(config.campaignId, config.accountId);
  } catch (rhythmErr: any) {
    console.warn(`[PlanSynthesis] Precomputed rhythm failed (non-blocking):`, rhythmErr.message);
  }

  const synthesized = await generatePlanWithAI(engineInsights, bizData, campaign, goalMathContext, lockedDecisions, config.accountId, memoryContextBlock, config.campaignId, precomputedRhythm);

  const periodDays = goalMathContext?.goal?.timeHorizonDays || 30;
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
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
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
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
  });

  const calendarSlots = generateCalendarSlots(
    synthesized,
    periodDays,
    config.campaignId,
    config.accountId,
    plan.id,
    rootBundle?.id || null,
    rootBundle?.version || null
  );

  if (calendarSlots.length > 0) {
    await db.insert(calendarEntries).values(calendarSlots);
    await db.update(strategicPlans)
      .set({ totalCalendarEntries: calendarSlots.length })
      .where(eq(strategicPlans.id, plan.id));
  }

  console.log(`[PlanSynthesis] Created plan ${plan.id} with ${calendarSlots.length} calendar entries, ${volume.totalContentPieces} required content pieces, root v${rootBundle?.version || "none"}`);

  try {
    const { generateContentDna } = await import("../content-dna-routes");
    await generateContentDna(config.campaignId, config.accountId, plan.id, rootBundle?.id || null, rootBundle?.version || null);
    console.log(`[PlanSynthesis] Content DNA generated for plan ${plan.id}`);
  } catch (dnaErr: any) {
    console.warn(`[PlanSynthesis] Content DNA generation failed (non-blocking):`, dnaErr.message);
  }

  try {
    await composeTasks(plan.id, config.campaignId, config.accountId, synthesized, periodDays, rootBundle?.id || null);
    console.log(`[PlanSynthesis] Execution tasks generated for plan ${plan.id}`);
  } catch (taskErr: any) {
    console.warn(`[PlanSynthesis] Task composition failed (non-blocking):`, taskErr.message);
  }

  if (goalMathContext) {
    try {
      await generateSimulation(
        config.campaignId,
        config.accountId,
        plan.id,
        goalMathContext.goal,
        goalMathContext.funnel,
        goalMathContext.feasibility,
        bizData,
        rootBundle?.id || null
      );
      console.log(`[PlanSynthesis] Growth simulation generated for plan ${plan.id}`);
    } catch (simErr: any) {
      console.warn(`[PlanSynthesis] Simulation failed (non-blocking):`, simErr.message);
    }
  }

  if (readiness && readiness.assumptions.length > 0) {
    try {
      const assumptions: AssumptionEntry[] = readiness.assumptions.map((a: any) => ({
        assumption: a.item,
        confidence: a.confidence as "low" | "medium" | "high",
        impactSeverity: a.impact as "low" | "medium" | "high",
        source: "plan_gate",
        affectedModules: ["plan", "simulation"],
      }));
      await logAssumptions(plan.id, config.campaignId, config.accountId, assumptions);
      console.log(`[PlanSynthesis] ${assumptions.length} assumptions logged for plan ${plan.id}`);
    } catch (assErr: any) {
      console.warn(`[PlanSynthesis] Assumption logging failed (non-blocking):`, assErr.message);
    }
  }

  return { planId: plan.id, plan: synthesized };
}
