import { Router } from "express";
import { db } from "./db";
import { accountState, auditLog, jobQueue, guardrailConfig, strategyDecisions } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { logAudit } from "./audit";

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

router.get("/api/autopilot/status", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "default";
    const state = await ensureAccountState(accountId);

    res.json({
      autopilotOn: state.autopilotOn,
      state: state.state,
      volatilityIndex: state.volatilityIndex,
      driftFlag: state.driftFlag,
      consecutiveFailures: state.consecutiveFailures,
      guardrailTriggers24h: state.guardrailTriggers24h,
      lastWorkerRun: state.lastWorkerRun,
      confidenceScore: state.confidenceScore ?? 100,
      confidenceStatus: state.confidenceStatus ?? "Stable",
    });
  } catch (error) {
    console.error("[Autopilot] Error getting status:", error);
    res.status(500).json({ error: "Failed to get autopilot status" });
  }
});

router.patch("/api/autopilot/status", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";
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
      confidenceScore: updated[0]?.confidenceScore ?? 100,
      confidenceStatus: updated[0]?.confidenceStatus ?? "Stable",
    });
  } catch (error) {
    console.error("[Autopilot] Error updating status:", error);
    res.status(500).json({ error: "Failed to update autopilot status" });
  }
});

router.post("/api/autopilot/emergency-stop", async (req, res) => {
  try {
    const accountId = (req.body.accountId as string) || "default";

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

router.get("/api/audit-log", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "default";
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

router.get("/api/autopilot/guardrails", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "default";
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
