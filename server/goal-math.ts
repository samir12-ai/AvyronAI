import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  goalDecompositions,
  growthSimulations,
  businessDataLayer,
  growthCampaigns,
} from "../shared/schema";
import { aiChat } from "./ai-client";
import { computeStrategyHash } from "./root-bundle";

interface NormalizedGoal {
  goalType: string;
  target: number;
  label: string;
  timeHorizonDays: number;
  successConstraints: string[];
}

const GOAL_TYPE_MAP: Record<string, string> = {
  SALES: "customer_acquisition",
  LEADS: "lead_generation",
  AWARENESS: "reach_growth",
  RETENTION: "retention",
  REVENUE: "revenue_growth",
  FOLLOWERS: "audience_growth",
};

export function normalizeGoal(campaign: any, bizData: any): NormalizedGoal {
  const objective = campaign?.objective || bizData?.funnelObjective || "AWARENESS";
  const goalType = GOAL_TYPE_MAP[objective.toUpperCase()] || "reach_growth";
  const totalDays = campaign?.totalDays || 90;

  let target = 0;
  let label = "";

  switch (goalType) {
    case "customer_acquisition":
      target = parseInt(campaign?.targetCustomers) || 100;
      label = `Acquire ${target} customers in ${totalDays} days`;
      break;
    case "lead_generation":
      target = parseInt(campaign?.targetLeads) || 200;
      label = `Generate ${target} leads in ${totalDays} days`;
      break;
    case "revenue_growth":
      target = parseInt(campaign?.targetRevenue) || 10000;
      label = `Generate $${target} revenue in ${totalDays} days`;
      break;
    case "audience_growth":
      target = parseInt(campaign?.targetFollowers) || 5000;
      label = `Grow audience by ${target} in ${totalDays} days`;
      break;
    default:
      target = parseInt(campaign?.targetReach) || 50000;
      label = `Reach ${target.toLocaleString()} people in ${totalDays} days`;
  }

  return {
    goalType,
    target,
    label,
    timeHorizonDays: totalDays,
    successConstraints: [
      `Budget: ${bizData?.monthlyBudget || "Not specified"}`,
      `Channel: ${bizData?.primaryConversionChannel || "Not specified"}`,
      `Business: ${bizData?.businessType || "Not specified"}`,
    ],
  };
}

export function computeFunnelMath(goal: NormalizedGoal, bizData: any): {
  topOfFunnel: number;
  middleFunnel: number;
  bottomFunnel: number;
  requiredReach: number;
  requiredLeads: number;
  requiredQualifiedLeads: number;
  closeRate: number;
  conversionRate: number;
  contentToLeadRate: number;
} {
  const closeRate = parseFloat(bizData?.closeRate) || 0.10;
  const conversionRate = parseFloat(bizData?.conversionRate) || 0.02;
  const contentToLeadRate = 0.02;

  let requiredCustomers = goal.target;
  if (goal.goalType === "lead_generation") requiredCustomers = Math.ceil(goal.target * closeRate);
  if (goal.goalType === "reach_growth") requiredCustomers = 0;

  const requiredQualifiedLeads = requiredCustomers > 0 ? Math.ceil(requiredCustomers / closeRate) : 0;
  const requiredLeads = requiredQualifiedLeads > 0 ? Math.ceil(requiredQualifiedLeads / 0.2) : goal.target;
  const requiredReach = Math.ceil(requiredLeads / contentToLeadRate);

  return {
    topOfFunnel: requiredReach,
    middleFunnel: requiredLeads,
    bottomFunnel: requiredQualifiedLeads,
    requiredReach,
    requiredLeads,
    requiredQualifiedLeads,
    closeRate,
    conversionRate,
    contentToLeadRate,
  };
}

export function checkFeasibility(
  goal: NormalizedGoal,
  funnel: ReturnType<typeof computeFunnelMath>,
  bizData: any
): { verdict: string; score: number; explanation: string; constraints: string[] } {
  const constraints: string[] = [];
  let score = 100;

  const monthlyBudget = parseFloat(bizData?.monthlyBudget?.replace(/[^0-9.]/g, "") || "0");
  const months = Math.ceil(goal.timeHorizonDays / 30);

  if (monthlyBudget > 0 && funnel.requiredLeads > 0) {
    const expectedCpl = monthlyBudget > 500 ? 5 : 15;
    const affordableLeads = Math.floor((monthlyBudget * months) / expectedCpl);
    if (affordableLeads < funnel.requiredLeads * 0.5) {
      score -= 30;
      constraints.push(`Budget may only support ~${affordableLeads} leads vs ${funnel.requiredLeads} required`);
    } else if (affordableLeads < funnel.requiredLeads) {
      score -= 15;
      constraints.push(`Budget is tight — may support ~${affordableLeads} of ${funnel.requiredLeads} needed leads`);
    }
  }

  if (funnel.requiredReach > 500000) {
    score -= 20;
    constraints.push(`Required reach of ${funnel.requiredReach.toLocaleString()} is very high for organic channels`);
  }

  if (goal.timeHorizonDays < 30 && goal.target > 50) {
    score -= 15;
    constraints.push("Short timeline with aggressive target — may need paid acceleration");
  }

  if (funnel.closeRate < 0.05) {
    score -= 10;
    constraints.push("Low close rate increases required lead volume significantly");
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = "feasible";
  if (score < 40) verdict = "unrealistic";
  else if (score < 70) verdict = "borderline";

  const explanation = verdict === "feasible"
    ? "The goal is achievable with the given resources and timeline."
    : verdict === "borderline"
    ? `The goal is challenging. ${constraints[0] || "Consider adjusting timeline or budget."}`
    : `The goal may not be achievable. ${constraints.join(". ")}.`;

  return { verdict, score, explanation, constraints };
}

export async function generateSimulation(
  campaignId: string,
  accountId: string,
  planId: string | null,
  goal: NormalizedGoal,
  funnel: ReturnType<typeof computeFunnelMath>,
  feasibility: ReturnType<typeof checkFeasibility>,
  bizData: any,
  rootBundleId: string | null = null
) {
  const prompt = `You are a marketing growth simulator. Based on the following business and goal data, generate 3 growth scenarios.

Goal: ${goal.label}
Goal Type: ${goal.goalType}
Target: ${goal.target}
Time Horizon: ${goal.timeHorizonDays} days
Feasibility: ${feasibility.verdict} (${feasibility.score}/100)
Business Type: ${bizData?.businessType || "general"}
Budget: ${bizData?.monthlyBudget || "Not specified"}
Channel: ${bizData?.primaryConversionChannel || "Not specified"}
Required Reach: ${funnel.requiredReach}
Required Leads: ${funnel.requiredLeads}
Close Rate: ${(funnel.closeRate * 100).toFixed(1)}%

Return ONLY valid JSON:
{
  "conservativeCase": {
    "expectedReach": number,
    "expectedLeads": number,
    "expectedCustomers": number,
    "expectedRevenue": number,
    "expectedCac": number,
    "expectedCpl": number,
    "achievementPct": number,
    "summary": "string"
  },
  "baseCase": {
    "expectedReach": number,
    "expectedLeads": number,
    "expectedCustomers": number,
    "expectedRevenue": number,
    "expectedCac": number,
    "expectedCpl": number,
    "achievementPct": number,
    "summary": "string"
  },
  "upsideCase": {
    "expectedReach": number,
    "expectedLeads": number,
    "expectedCustomers": number,
    "expectedRevenue": number,
    "expectedCac": number,
    "expectedCpl": number,
    "achievementPct": number,
    "summary": "string"
  },
  "confidenceScore": number,
  "keyAssumptions": ["string"],
  "bottleneckAlerts": ["string"],
  "constraintSimulation": {
    "bottleneckProbability": number,
    "underDeliveryRisk": "low|medium|high",
    "budgetOverrunRisk": "low|medium|high",
    "capacityOverloadRisk": "low|medium|high"
  }
}

Make numbers realistic for this specific business type and budget level.`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.3,
      accountId,
      endpoint: "goal-math-simulation",
    });

    const raw = response.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw);

    const [sim] = await db.insert(growthSimulations).values({
      campaignId,
      accountId,
      planId,
      goalDecompositionId: null,
      rootBundleId,
      planHash: null,
      conservativeCase: JSON.stringify(parsed.conservativeCase),
      baseCase: JSON.stringify(parsed.baseCase),
      upsideCase: JSON.stringify(parsed.upsideCase),
      confidenceScore: parsed.confidenceScore || feasibility.score,
      keyAssumptions: JSON.stringify(parsed.keyAssumptions || []),
      bottleneckAlerts: JSON.stringify(parsed.bottleneckAlerts || []),
      constraintSimulation: JSON.stringify(parsed.constraintSimulation || {}),
    }).returning();

    return { id: sim.id, ...parsed };
  } catch (err: any) {
    console.warn(`[GoalMath] Simulation AI failed, using deterministic:`, err.message);
    const fallback = buildDeterministicSimulation(goal, funnel, feasibility);
    try {
      const [sim] = await db.insert(growthSimulations).values({
        campaignId,
        accountId,
        planId,
        goalDecompositionId: null,
        rootBundleId,
        planHash: null,
        conservativeCase: JSON.stringify(fallback.conservativeCase),
        baseCase: JSON.stringify(fallback.baseCase),
        upsideCase: JSON.stringify(fallback.upsideCase),
        confidenceScore: fallback.confidenceScore,
        keyAssumptions: JSON.stringify(fallback.keyAssumptions),
        bottleneckAlerts: JSON.stringify(fallback.bottleneckAlerts),
        constraintSimulation: JSON.stringify(fallback.constraintSimulation),
      }).returning();
      return { id: sim.id, ...fallback };
    } catch (persistErr: any) {
      console.warn(`[GoalMath] Failed to persist fallback simulation:`, persistErr.message);
      return fallback;
    }
  }
}

function buildDeterministicSimulation(
  goal: NormalizedGoal,
  funnel: ReturnType<typeof computeFunnelMath>,
  feasibility: ReturnType<typeof checkFeasibility>
) {
  const base = goal.target;
  const conservative = Math.round(base * 0.7);
  const upside = Math.round(base * 1.15);

  return {
    conservativeCase: {
      expectedReach: Math.round(funnel.requiredReach * 0.7),
      expectedLeads: Math.round(funnel.requiredLeads * 0.7),
      expectedCustomers: conservative,
      expectedRevenue: 0,
      expectedCac: 0,
      expectedCpl: 0,
      achievementPct: 70,
      summary: "Conservative estimate assuming below-average performance",
    },
    baseCase: {
      expectedReach: funnel.requiredReach,
      expectedLeads: funnel.requiredLeads,
      expectedCustomers: base,
      expectedRevenue: 0,
      expectedCac: 0,
      expectedCpl: 0,
      achievementPct: 100,
      summary: "Base case with average conversion rates",
    },
    upsideCase: {
      expectedReach: Math.round(funnel.requiredReach * 1.15),
      expectedLeads: Math.round(funnel.requiredLeads * 1.15),
      expectedCustomers: upside,
      expectedRevenue: 0,
      expectedCac: 0,
      expectedCpl: 0,
      achievementPct: 115,
      summary: "Upside case with optimized performance",
    },
    confidenceScore: feasibility.score,
    keyAssumptions: feasibility.constraints.length > 0 ? feasibility.constraints : ["Standard conversion rates assumed"],
    bottleneckAlerts: [],
    constraintSimulation: {
      bottleneckProbability: feasibility.score < 70 ? 0.6 : 0.2,
      underDeliveryRisk: feasibility.score < 50 ? "high" : feasibility.score < 70 ? "medium" : "low",
      budgetOverrunRisk: "low",
      capacityOverloadRisk: "low",
    },
  };
}

export async function decomposeGoal(campaignId: string, accountId: string, rootBundleId: string | null = null, rootBundleVersion: number | null = null) {
  const [bizData] = await db.select().from(businessDataLayer)
    .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
    .orderBy(desc(businessDataLayer.createdAt)).limit(1);

  const [campaign] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId)).limit(1);

  const goal = normalizeGoal(campaign, bizData);
  const funnel = computeFunnelMath(goal, bizData);
  const feasibility = checkFeasibility(goal, funnel, bizData);

  const [decomp] = await db.insert(goalDecompositions).values({
    campaignId,
    accountId,
    rootBundleId,
    rootBundleVersion,
    goalType: goal.goalType,
    goalTarget: goal.target,
    goalLabel: goal.label,
    timeHorizonDays: goal.timeHorizonDays,
    feasibility: feasibility.verdict,
    feasibilityScore: feasibility.score,
    feasibilityExplanation: feasibility.explanation,
    funnelMath: JSON.stringify(funnel),
    assumptions: JSON.stringify(feasibility.constraints),
    confidenceScore: feasibility.score,
  }).returning();

  console.log(`[GoalMath] Decomposed goal: ${goal.label} → ${feasibility.verdict} (${feasibility.score}/100)`);

  return {
    id: decomp.id,
    goal,
    funnel,
    feasibility,
  };
}

export async function getLatestGoalDecomposition(campaignId: string, accountId: string) {
  const [row] = await db.select().from(goalDecompositions)
    .where(and(eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.status, "active")))
    .orderBy(desc(goalDecompositions.createdAt)).limit(1);
  return row || null;
}

export async function getLatestSimulation(campaignId: string, accountId: string) {
  const [row] = await db.select().from(growthSimulations)
    .where(and(eq(growthSimulations.campaignId, campaignId), eq(growthSimulations.accountId, accountId), eq(growthSimulations.status, "active")))
    .orderBy(desc(growthSimulations.createdAt)).limit(1);
  return row || null;
}

const safeJson = (v: any) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };

export function registerGoalMathRoutes(app: Express) {
  app.post("/api/goal-math/decompose", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;
      if (!campaignId) return res.status(400).json({ success: false, error: "campaignId required" });
      const accountId = req.body.accountId || "default";

      const result = await decomposeGoal(campaignId, accountId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("[GoalMath] Decompose error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/goal-math/simulate", async (req: Request, res: Response) => {
    try {
      const { campaignId, planId } = req.body;
      if (!campaignId) return res.status(400).json({ success: false, error: "campaignId required" });
      const accountId = req.body.accountId || "default";

      const [bizData] = await db.select().from(businessDataLayer)
        .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
        .orderBy(desc(businessDataLayer.createdAt)).limit(1);

      const [campaign] = await db.select().from(growthCampaigns)
        .where(eq(growthCampaigns.id, campaignId)).limit(1);

      const goal = normalizeGoal(campaign, bizData);
      const funnel = computeFunnelMath(goal, bizData);
      const feasibility = checkFeasibility(goal, funnel, bizData);

      const sim = await generateSimulation(campaignId, accountId, planId || null, goal, funnel, feasibility, bizData);
      res.json({ success: true, simulation: sim });
    } catch (err: any) {
      console.error("[GoalMath] Simulate error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/goal-math/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      const accountId = (req.query.accountId as string) || "default";

      const decomp = await getLatestGoalDecomposition(campaignId, accountId);
      const sim = await getLatestSimulation(campaignId, accountId);

      res.json({
        success: true,
        goalDecomposition: decomp ? {
          ...decomp,
          funnelMath: safeJson(decomp.funnelMath),
          channelFit: safeJson(decomp.channelFit),
          contentSystem: safeJson(decomp.contentSystem),
          budgetDecomposition: safeJson(decomp.budgetDecomposition),
          assumptions: safeJson(decomp.assumptions),
        } : null,
        simulation: sim ? {
          ...sim,
          conservativeCase: safeJson(sim.conservativeCase),
          baseCase: safeJson(sim.baseCase),
          upsideCase: safeJson(sim.upsideCase),
          keyAssumptions: safeJson(sim.keyAssumptions),
          bottleneckAlerts: safeJson(sim.bottleneckAlerts),
          constraintSimulation: safeJson(sim.constraintSimulation),
        } : null,
      });
    } catch (err: any) {
      console.error("[GoalMath] Fetch error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[GoalMath] Routes registered: POST /api/goal-math/decompose, /simulate, GET /api/goal-math/:campaignId");
}
