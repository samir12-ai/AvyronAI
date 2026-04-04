import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { goalDecompositions, growthSimulations, businessDataLayer, growthCampaigns, } from "../shared/schema";
import { aiChat } from "./ai-client";
import { resolveAccountId } from "./auth";
const GOAL_TYPE_MAP = {
    SALES: "customer_acquisition",
    LEADS: "lead_generation",
    AWARENESS: "reach_growth",
    RETENTION: "retention",
    REVENUE: "revenue_growth",
    FOLLOWERS: "audience_growth",
};
export function normalizeGoal(campaign, bizData) {
    const objective = campaign?.objective || bizData?.funnelObjective || "AWARENESS";
    const goalType = GOAL_TYPE_MAP[objective.toUpperCase()] || "reach_growth";
    const totalDays = parseInt(bizData?.goalTimeline) || campaign?.totalDays || 90;
    const userGoalTarget = bizData?.goalTarget ? parseInt(bizData.goalTarget.replace(/[^0-9]/g, "") || "0") : 0;
    const userGoalDesc = bizData?.goalDescription?.trim() || "";
    let target = 0;
    let label = "";
    if (userGoalTarget > 0) {
        target = userGoalTarget;
        label = userGoalDesc || `Achieve ${target} ${goalType.replace(/_/g, " ")} in ${totalDays} days`;
    }
    else {
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
export function computeFunnelMath(goal, bizData) {
    const closeRate = parseFloat(bizData?.closeRate) || 0.10;
    const conversionRate = parseFloat(bizData?.conversionRate) || 0.02;
    const contentToLeadRate = 0.02;
    const ctr = parseFloat(bizData?.ctr) || 0.025;
    const clickToConversationRate = parseFloat(bizData?.clickToConversationRate) || 0.30;
    const conversationToLeadRate = parseFloat(bizData?.conversationToLeadRate) || 0.50;
    const leadToClientRate = closeRate;
    const qualificationRate = 0.2;
    let requiredLeads;
    let requiredQualifiedLeads;
    let requiredClosedClients;
    if (goal.goalType === "lead_generation") {
        requiredLeads = goal.target;
        requiredQualifiedLeads = Math.ceil(requiredLeads * qualificationRate);
        requiredClosedClients = Math.ceil(requiredQualifiedLeads * leadToClientRate);
    }
    else if (goal.goalType === "reach_growth") {
        requiredLeads = 0;
        requiredQualifiedLeads = 0;
        requiredClosedClients = 0;
    }
    else {
        requiredClosedClients = goal.target;
        requiredQualifiedLeads = Math.ceil(requiredClosedClients / leadToClientRate);
        requiredLeads = Math.ceil(requiredQualifiedLeads / qualificationRate);
    }
    const requiredConversations = requiredLeads > 0 ? Math.ceil(requiredLeads / conversationToLeadRate) : 0;
    const requiredClicks = requiredConversations > 0 ? Math.ceil(requiredConversations / clickToConversationRate) : (goal.goalType === "reach_growth" ? goal.target : Math.ceil(requiredLeads / contentToLeadRate));
    const requiredReach = requiredClicks > 0 ? Math.ceil(requiredClicks / ctr) : goal.target;
    return {
        topOfFunnel: requiredReach,
        middleFunnel: requiredLeads,
        bottomFunnel: requiredQualifiedLeads,
        requiredReach,
        requiredClicks,
        requiredConversations,
        requiredLeads,
        requiredQualifiedLeads,
        requiredClosedClients,
        closeRate,
        conversionRate,
        contentToLeadRate,
        ctr,
        clickToConversationRate,
        conversationToLeadRate,
        leadToClientRate,
    };
}
export function checkFeasibility(goal, funnel, bizData) {
    const constraints = [];
    let score = 100;
    const monthlyBudget = parseFloat(bizData?.monthlyBudget?.replace(/[^0-9.]/g, "") || "0");
    const months = Math.ceil(goal.timeHorizonDays / 30);
    let budgetAdjustment = {
        needed: false,
        type: "none",
        originalTarget: goal.target,
        adjustedTarget: goal.target,
        originalTimeline: goal.timeHorizonDays,
        adjustedTimeline: goal.timeHorizonDays,
        requiredBudget: 0,
        affordableLeads: funnel.requiredLeads,
        explanation: "Budget is sufficient for the current plan.",
    };
    if (monthlyBudget > 0 && funnel.requiredLeads > 0) {
        const expectedCpl = monthlyBudget > 500 ? 5 : 15;
        const totalBudget = monthlyBudget * months;
        const affordableLeads = Math.floor(totalBudget / expectedCpl);
        const requiredBudget = Math.ceil(funnel.requiredLeads * expectedCpl);
        if (affordableLeads < funnel.requiredLeads) {
            budgetAdjustment.needed = true;
            budgetAdjustment.affordableLeads = affordableLeads;
            budgetAdjustment.requiredBudget = requiredBudget;
            const budgetGap = requiredBudget - totalBudget;
            const affordableRatio = affordableLeads / funnel.requiredLeads;
            if (affordableRatio < 0.5) {
                score -= 30;
                constraints.push(`Budget can only support ~${affordableLeads} leads vs ${funnel.requiredLeads} required (gap: $${budgetGap})`);
                const adjustedTarget = Math.max(1, Math.floor(goal.target * affordableRatio));
                const extendedMonths = Math.ceil(funnel.requiredLeads / (affordableLeads / months));
                const extendedDays = extendedMonths * 30;
                if (extendedDays <= goal.timeHorizonDays * 3) {
                    budgetAdjustment.type = "extend_timeline";
                    budgetAdjustment.adjustedTimeline = extendedDays;
                    budgetAdjustment.explanation = `Budget supports ${affordableLeads} leads in ${months} months. Extending timeline to ${extendedMonths} months to reach ${funnel.requiredLeads} leads, or increase monthly budget to $${Math.ceil(requiredBudget / months)}.`;
                }
                else {
                    budgetAdjustment.type = "reduce_target";
                    budgetAdjustment.adjustedTarget = adjustedTarget;
                    budgetAdjustment.explanation = `Budget cannot realistically support ${goal.target} target. Adjusted to ${adjustedTarget} (achievable with $${totalBudget} budget at $${expectedCpl} CPL). Alternatively, increase budget to $${Math.ceil(requiredBudget / months)}/month.`;
                }
            }
            else {
                score -= 15;
                constraints.push(`Budget is tight — supports ~${affordableLeads} of ${funnel.requiredLeads} needed leads`);
                budgetAdjustment.type = "increase_budget";
                budgetAdjustment.explanation = `Budget is $${budgetGap} short. Recommend increasing monthly budget to $${Math.ceil(requiredBudget / months)} for full lead coverage.`;
            }
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
    if (score < 40)
        verdict = "unrealistic";
    else if (score < 70)
        verdict = "borderline";
    const explanation = verdict === "feasible"
        ? "The goal is achievable with the given resources and timeline."
        : verdict === "borderline"
            ? `The goal is challenging. ${constraints[0] || "Consider adjusting timeline or budget."}`
            : `The goal may not be achievable. ${constraints.join(". ")}.`;
    return { verdict, score, explanation, constraints, budgetAdjustment };
}
export async function generateSimulation(campaignId, accountId, planId, goal, funnel, feasibility, bizData, rootBundleId = null) {
    const monthlyBudget = parseFloat(bizData?.monthlyBudget?.replace(/[^0-9.]/g, "") || "0");
    const budgetInfo = monthlyBudget > 0
        ? `Current Monthly Budget: $${monthlyBudget}\nBudget x1.5: $${Math.round(monthlyBudget * 1.5)}\nBudget x2: $${Math.round(monthlyBudget * 2)}`
        : `Budget: ${bizData?.monthlyBudget || "Not specified"}`;
    const prompt = `You are a marketing growth simulator. Based on the following business and goal data, generate 3 growth scenarios.

Goal: ${goal.label}
Goal Type: ${goal.goalType}
Target: ${goal.target}
Time Horizon: ${goal.timeHorizonDays} days
Feasibility: ${feasibility.verdict} (${feasibility.score}/100)
Business Type: ${bizData?.businessType || "general"}
${budgetInfo}
Channel: ${bizData?.primaryConversionChannel || "Not specified"}
Full Funnel: Reach=${funnel.requiredReach} → Clicks=${funnel.requiredClicks} → Conversations=${funnel.requiredConversations} → Leads=${funnel.requiredLeads} → QualifiedLeads=${funnel.requiredQualifiedLeads} → Clients=${funnel.requiredClosedClients}
Close Rate: ${(funnel.closeRate * 100).toFixed(1)}%
CTR: ${(funnel.ctr * 100).toFixed(1)}%
${feasibility.budgetAdjustment?.needed ? `Budget Constraint: ${feasibility.budgetAdjustment.explanation}` : ""}

SIMULATION INSTRUCTIONS:
Generate 3 scenarios based on STRATEGIC LEVERS, not just multipliers:
- Conservative: Current budget + current conversion rates (baseline reality)
- Base Case: Current budget + 20% conversion improvement from content optimization
- Upside: Increased budget (1.5x) + improved conversion + accelerated content production

Each scenario must explain WHICH LEVER drives the improvement.

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
    "summary": "string",
    "lever": "string (what strategic lever this scenario assumes)"
  },
  "baseCase": {
    "expectedReach": number,
    "expectedLeads": number,
    "expectedCustomers": number,
    "expectedRevenue": number,
    "expectedCac": number,
    "expectedCpl": number,
    "achievementPct": number,
    "summary": "string",
    "lever": "string"
  },
  "upsideCase": {
    "expectedReach": number,
    "expectedLeads": number,
    "expectedCustomers": number,
    "expectedRevenue": number,
    "expectedCac": number,
    "expectedCpl": number,
    "achievementPct": number,
    "summary": "string",
    "lever": "string"
  },
  "confidenceScore": number,
  "keyAssumptions": ["string"],
  "bottleneckAlerts": ["string"],
  "highestLeverageDriver": "string (identify the single highest-impact growth lever)",
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
    }
    catch (err) {
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
        }
        catch (persistErr) {
            console.warn(`[GoalMath] Failed to persist fallback simulation:`, persistErr.message);
            return fallback;
        }
    }
}
function buildDeterministicSimulation(goal, funnel, feasibility) {
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
            lever: "Current budget + current conversion rates (baseline reality)",
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
            lever: "Current budget + 20% conversion improvement from content optimization",
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
            lever: "Increased budget (1.5x) + improved conversion + accelerated content production",
        },
        confidenceScore: feasibility.score,
        keyAssumptions: feasibility.constraints.length > 0 ? feasibility.constraints : ["Standard conversion rates assumed"],
        bottleneckAlerts: [],
        highestLeverageDriver: "Content optimization and conversion rate improvement",
        constraintSimulation: {
            bottleneckProbability: feasibility.score < 70 ? 0.6 : 0.2,
            underDeliveryRisk: feasibility.score < 50 ? "high" : feasibility.score < 70 ? "medium" : "low",
            budgetOverrunRisk: "low",
            capacityOverloadRisk: "low",
        },
    };
}
export async function decomposeGoal(campaignId, accountId, rootBundleId = null, rootBundleVersion = null) {
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
export async function getLatestGoalDecomposition(campaignId, accountId) {
    const [row] = await db.select().from(goalDecompositions)
        .where(and(eq(goalDecompositions.campaignId, campaignId), eq(goalDecompositions.accountId, accountId), eq(goalDecompositions.status, "active")))
        .orderBy(desc(goalDecompositions.createdAt)).limit(1);
    return row || null;
}
export async function getLatestSimulation(campaignId, accountId) {
    const [row] = await db.select().from(growthSimulations)
        .where(and(eq(growthSimulations.campaignId, campaignId), eq(growthSimulations.accountId, accountId), eq(growthSimulations.status, "active")))
        .orderBy(desc(growthSimulations.createdAt)).limit(1);
    return row || null;
}
const safeJson = (v) => { try {
    return typeof v === "string" ? JSON.parse(v) : v;
}
catch {
    return null;
} };
export function registerGoalMathRoutes(app) {
    app.post("/api/goal-math/decompose", async (req, res) => {
        try {
            const { campaignId } = req.body;
            if (!campaignId)
                return res.status(400).json({ success: false, error: "campaignId required" });
            const accountId = resolveAccountId(req);
            const result = await decomposeGoal(campaignId, accountId);
            res.json({ success: true, ...result });
        }
        catch (err) {
            console.error("[GoalMath] Decompose error:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    app.post("/api/goal-math/simulate", async (req, res) => {
        try {
            const { campaignId, planId } = req.body;
            if (!campaignId)
                return res.status(400).json({ success: false, error: "campaignId required" });
            const accountId = resolveAccountId(req);
            const [bizData] = await db.select().from(businessDataLayer)
                .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
                .orderBy(desc(businessDataLayer.createdAt)).limit(1);
            const [campaign] = await db.select().from(growthCampaigns)
                .where(eq(growthCampaigns.id, campaignId)).limit(1);
            const goal = normalizeGoal(campaign, bizData);
            const funnel = computeFunnelMath(goal, bizData);
            const feasibility = checkFeasibility(goal, funnel, bizData);
            const effectiveGoal = { ...goal };
            if (feasibility.budgetAdjustment.needed && feasibility.budgetAdjustment.type === "reduce_target" && feasibility.budgetAdjustment.adjustedTarget > 0) {
                effectiveGoal.target = feasibility.budgetAdjustment.adjustedTarget;
            }
            const effectiveFunnel = feasibility.budgetAdjustment.needed && feasibility.budgetAdjustment.type === "reduce_target"
                ? computeFunnelMath(effectiveGoal, bizData)
                : funnel;
            const sim = await generateSimulation(campaignId, accountId, planId || null, effectiveGoal, effectiveFunnel, feasibility, bizData);
            res.json({ success: true, simulation: sim });
        }
        catch (err) {
            console.error("[GoalMath] Simulate error:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    app.get("/api/goal-math/:campaignId", async (req, res) => {
        try {
            const campaignId = req.params.campaignId;
            const accountId = resolveAccountId(req);
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
        }
        catch (err) {
            console.error("[GoalMath] Fetch error:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
    console.log("[GoalMath] Routes registered: POST /api/goal-math/decompose, /simulate, GET /api/goal-math/:campaignId");
}
