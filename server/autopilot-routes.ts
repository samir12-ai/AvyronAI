import { Router } from "express";
import { db } from "./db";
import {
  accountState,
  auditLog,
  jobQueue,
  guardrailConfig,
  strategyDecisions,
  strategicPlans,
  calendarEntries,
  requiredWork,
  strategyInsights,
  performanceSnapshots,
} from "@shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { logAudit } from "./audit";
import { requireCampaign } from "./campaign-routes";
import { ACTIVE_PLAN_STATUSES_SQL } from "./plan-constants";
import { calculateConfidence, computeDecisionSuccessRate } from "./confidence";

import { resolveAccountId } from "./auth";
const router = Router();

async function ensureAccountState(accountId: string) {
  const existing = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(accountState).values({ accountId });
    const created = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    return created[0];
  }
  return existing[0];
}

async function ensureGuardrailConfig(accountId: string) {
  const existing = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, accountId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(guardrailConfig).values({ accountId });
  }
}

async function resolveActivePlan(accountId: string, campaignId: string) {
  const plans = await db
    .select()
    .from(strategicPlans)
    .where(
      and(
        eq(strategicPlans.accountId, accountId),
        eq(strategicPlans.campaignId, campaignId),
        sql`${strategicPlans.status} IN (${sql.raw(ACTIVE_PLAN_STATUSES_SQL)})`
      )
    )
    .orderBy(desc(strategicPlans.createdAt))
    .limit(1);

  return plans[0] || null;
}

router.get("/api/autopilot/status", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    const campaignContext = (req as any).campaignContext;
    const campaignId = campaignContext?.campaignId || "";
    const state = await ensureAccountState(accountId);

    const activePlan = await resolveActivePlan(accountId, campaignId);

    let planBinding: {
      state: "CONNECTED" | "BLOCKED";
      planId: string | null;
      planStatus: string | null;
      reason: string | null;
      lastDecisionAt: string | null;
      executionProgress: any | null;
    };

    if (!activePlan) {
      planBinding = {
        state: "BLOCKED",
        planId: null,
        planStatus: null,
        reason: "NO_APPROVED_PLAN",
        lastDecisionAt: null,
        executionProgress: null,
      };
    } else {
      const [entries, work] = await Promise.all([
        db.select().from(calendarEntries).where(eq(calendarEntries.planId, activePlan.id)),
        db.select().from(requiredWork).where(eq(requiredWork.planId, activePlan.id)).limit(1),
      ]);

      const totalRequired = work[0]?.totalContentPieces || 0;
      const generated = entries.filter(e => e.status === "AI_GENERATED").length;
      const draft = entries.filter(e => e.status === "DRAFT").length;
      const failed = entries.filter(e => e.status === "FAILED").length;

      const recentDecision = await db
        .select({ createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.accountId, accountId),
            sql`${auditLog.eventType} IN ('AUTONOMOUS_DECISION', 'AUTOPILOT_DECISION', 'AI_CREATIVE_GENERATED')`
          )
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);

      planBinding = {
        state: "CONNECTED",
        planId: activePlan.id,
        planStatus: activePlan.status,
        reason: null,
        lastDecisionAt: recentDecision[0]?.createdAt?.toISOString() || null,
        executionProgress: {
          totalRequired,
          calendarEntries: entries.length,
          generated,
          draft,
          failed,
          progressPercent: totalRequired > 0 ? Math.round(((entries.length - draft - failed) / totalRequired) * 100) : 0,
        },
      };
    }

    const config = await db.select().from(guardrailConfig)
      .where(eq(guardrailConfig.accountId, accountId))
      .limit(1);
    const volThreshold = config[0]?.volatilityThreshold ?? 0.15;

    const { successRate: decSuccessRate, total: decTotal } = await computeDecisionSuccessRate(accountId);

    const confidenceResult = calculateConfidence({
      volatilityIndex: state.volatilityIndex || 0,
      volatilityThreshold: volThreshold,
      decisionSuccessRate: decSuccessRate,
      totalDecisions: decTotal,
      driftFlag: state.driftFlag || false,
      guardrailTriggers24h: state.guardrailTriggers24h || 0,
      currentState: state.state || "ACTIVE",
    });

    let liveScore = confidenceResult.score;

    if (state.metaMode !== "REAL") {
      liveScore -= 40;
    }

    if (planBinding.state === "BLOCKED") {
      liveScore -= 15;
    }

    liveScore = Math.max(10, Math.min(100, liveScore));

    let liveStatus: "Stable" | "Caution" | "Unstable";
    if (liveScore >= 80) {
      liveStatus = "Stable";
    } else if (liveScore >= 60) {
      liveStatus = "Caution";
    } else {
      liveStatus = "Unstable";
    }

    if (state.confidenceScore !== liveScore || state.confidenceStatus !== liveStatus) {
      await db.update(accountState)
        .set({ confidenceScore: liveScore, confidenceStatus: liveStatus, updatedAt: new Date() })
        .where(eq(accountState.accountId, accountId));
    }

    res.json({
      autopilotOn: state.autopilotOn,
      state: state.state,
      volatilityIndex: state.volatilityIndex,
      driftFlag: state.driftFlag,
      consecutiveFailures: state.consecutiveFailures,
      guardrailTriggers24h: state.guardrailTriggers24h,
      lastWorkerRun: state.lastWorkerRun,
      confidenceScore: liveScore,
      confidenceStatus: liveStatus,
      planBinding,
    });
  } catch (error) {
    console.error("[Autopilot] Error getting status:", error);
    res.status(500).json({ error: "Failed to get autopilot status" });
  }
});

router.get("/api/autopilot/actions", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    const campaignContext = (req as any).campaignContext;
    const campaignId = campaignContext?.campaignId || "";

    const activePlan = await resolveActivePlan(accountId, campaignId);

    if (!activePlan) {
      return res.json({
        success: true,
        gated: true,
        gateReason: "NO_APPROVED_PLAN",
        actions: [],
        planId: null,
      });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [entries, work, insights, snapshots] = await Promise.all([
      db.select().from(calendarEntries).where(eq(calendarEntries.planId, activePlan.id)),
      db.select().from(requiredWork).where(eq(requiredWork.planId, activePlan.id)).limit(1),
      db
        .select()
        .from(strategyInsights)
        .where(
          and(
            eq(strategyInsights.accountId, accountId),
            eq(strategyInsights.campaignId, campaignId),
            eq(strategyInsights.isActive, true),
            gte(strategyInsights.createdAt, weekAgo)
          )
        )
        .orderBy(desc(strategyInsights.confidence))
        .limit(10),
      db
        .select()
        .from(performanceSnapshots)
        .where(
          and(
            eq(performanceSnapshots.campaignId, campaignId),
            eq(performanceSnapshots.accountId, accountId)
          )
        )
        .orderBy(desc(performanceSnapshots.fetchedAt))
        .limit(14),
    ]);

    const totalRequired = work[0]?.totalContentPieces || 0;
    const draftEntries = entries.filter(e => e.status === "DRAFT");
    const failedEntries = entries.filter(e => e.status === "FAILED");
    const generatedEntries = entries.filter(e => e.status === "AI_GENERATED");

    const actions: Array<{
      id: string;
      action: string;
      priority: "high" | "medium" | "low";
      sourceTag: string;
      evidenceMetric: string;
      evidenceTimeframe: string;
      planId: string;
    }> = [];

    if (draftEntries.length > 0) {
      actions.push({
        id: `action_draft_${Date.now()}`,
        action: `Generate content for ${draftEntries.length} draft calendar ${draftEntries.length === 1 ? "entry" : "entries"}. Open Calendar to generate them one by one.`,
        priority: draftEntries.length > totalRequired * 0.5 ? "high" : "medium",
        sourceTag: "CALENDAR_ENTRIES",
        evidenceMetric: `${draftEntries.length}/${totalRequired} entries pending generation`,
        evidenceTimeframe: "current_plan",
        planId: activePlan.id,
      });
    }

    if (failedEntries.length > 0) {
      actions.push({
        id: `action_failed_${Date.now()}`,
        action: `${failedEntries.length} calendar ${failedEntries.length === 1 ? "entry has" : "entries have"} failed generation. Reset and retry from Calendar.`,
        priority: "high",
        sourceTag: "CALENDAR_ENTRIES",
        evidenceMetric: `${failedEntries.length} failed entries`,
        evidenceTimeframe: "current_plan",
        planId: activePlan.id,
      });
    }

    if (generatedEntries.length > 0 && generatedEntries.length === entries.length - failedEntries.length) {
      actions.push({
        id: `action_review_${Date.now()}`,
        action: `All ${generatedEntries.length} entries have generated content. Review in Studio and mark as Ready for publishing.`,
        priority: "medium",
        sourceTag: "STUDIO_ITEMS",
        evidenceMetric: `${generatedEntries.length} items awaiting review`,
        evidenceTimeframe: "current_plan",
        planId: activePlan.id,
      });
    }

    if (insights.length > 0) {
      const topInsight = insights[0];
      actions.push({
        id: `action_insight_${Date.now()}`,
        action: `Strategy insight: ${(topInsight as any).insight || (topInsight as any).summary || "Performance signal detected"}. Confidence: ${topInsight.confidence}%.`,
        priority: topInsight.confidence > 70 ? "high" : "low",
        sourceTag: "STRATEGY_INSIGHTS",
        evidenceMetric: `${insights.length} active insights this week`,
        evidenceTimeframe: "7d",
        planId: activePlan.id,
      });
    }

    if (snapshots.length >= 2) {
      const latest = snapshots[0];
      const previous = snapshots[1];
      const cpaChange = (latest as any).cpa && (previous as any).cpa
        ? (((latest as any).cpa - (previous as any).cpa) / (previous as any).cpa * 100).toFixed(1)
        : null;
      if (cpaChange && Math.abs(parseFloat(cpaChange)) > 10) {
        actions.push({
          id: `action_perf_${Date.now()}`,
          action: `CPA ${parseFloat(cpaChange) > 0 ? "increased" : "decreased"} by ${Math.abs(parseFloat(cpaChange))}% since last snapshot. ${parseFloat(cpaChange) > 0 ? "Review budget allocation." : "Consider scaling."}`,
          priority: Math.abs(parseFloat(cpaChange)) > 25 ? "high" : "medium",
          sourceTag: "PERFORMANCE_SNAPSHOTS",
          evidenceMetric: `CPA delta: ${cpaChange}%`,
          evidenceTimeframe: "latest_vs_previous",
          planId: activePlan.id,
        });
      }
    }

    res.json({
      success: true,
      gated: false,
      planId: activePlan.id,
      planStatus: activePlan.status,
      actions,
    });
  } catch (error) {
    console.error("[Autopilot] Error fetching actions:", error);
    res.status(500).json({ error: "Failed to fetch autopilot actions" });
  }
});

router.patch("/api/autopilot/status", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    const { autopilotOn } = req.body;

    await ensureAccountState(accountId);
    await ensureGuardrailConfig(accountId);

    if (typeof autopilotOn === "boolean") {
      await db.update(accountState)
        .set({ autopilotOn, updatedAt: new Date() })
        .where(eq(accountState.accountId, accountId));

      await logAudit(accountId, "AUTOPILOT_TOGGLED", {
        details: { autopilotOn },
      });
    }

    const updated = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);

    res.json({
      autopilotOn: updated[0]?.autopilotOn,
      state: updated[0]?.state,
      volatilityIndex: updated[0]?.volatilityIndex,
      driftFlag: updated[0]?.driftFlag,
      confidenceScore: updated[0]?.confidenceScore ?? 0,
      confidenceStatus: updated[0]?.confidenceStatus ?? "Unstable",
    });
  } catch (error) {
    console.error("[Autopilot] Error updating status:", error);
    res.status(500).json({ error: "Failed to update autopilot status" });
  }
});

router.post("/api/autopilot/emergency-stop", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);

    await db.update(accountState)
      .set({
        autopilotOn: false,
        state: "SAFE_MODE",
        updatedAt: new Date(),
      })
      .where(eq(accountState.accountId, accountId));

    await db.update(jobQueue)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        error: "Emergency stop triggered",
      })
      .where(
        sql`${jobQueue.accountId} = ${accountId} AND ${jobQueue.status} IN ('pending', 'running')`
      );

    await db.update(strategyDecisions)
      .set({ status: "blocked" })
      .where(
        sql`${strategyDecisions.accountId} = ${accountId} AND ${strategyDecisions.status} = 'pending' AND ${strategyDecisions.autoExecutable} = true`
      );

    await logAudit(accountId, "EMERGENCY_STOP", {
      details: {
        message: "Emergency stop activated — autopilot disabled, all jobs cancelled, pending decisions blocked",
      },
    });

    res.json({
      success: true,
      message: "Emergency stop activated. All automated operations halted.",
      state: "SAFE_MODE",
      autopilotOn: false,
    });
  } catch (error) {
    console.error("[Autopilot] Emergency stop error:", error);
    res.status(500).json({ error: "Failed to execute emergency stop" });
  }
});

router.get("/api/audit-log", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = await db.select().from(auditLog)
      .where(eq(auditLog.accountId, accountId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const countResult = await db.select({
      total: sql<number>`count(*)`,
    }).from(auditLog)
      .where(eq(auditLog.accountId, accountId));

    res.json({
      logs,
      total: Number(countResult[0]?.total) || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[Audit] Error fetching logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

router.get("/api/autopilot/guardrails", requireCampaign, async (req, res) => {
  try {
    const accountId = resolveAccountId(req);
    await ensureGuardrailConfig(accountId);

    const config = await db.select().from(guardrailConfig)
      .where(eq(guardrailConfig.accountId, accountId))
      .limit(1);

    res.json(config[0] || null);
  } catch (error) {
    console.error("[Autopilot] Error fetching guardrails:", error);
    res.status(500).json({ error: "Failed to fetch guardrail config" });
  }
});

export function registerAutopilotRoutes(app: any) {
  app.use(router);
}
