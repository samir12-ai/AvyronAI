import { Express, Request, Response } from "express";
import { db } from "./db";
import { auditLog, accountState, jobQueue, strategicPlans, featureFlags, aiUsageLog } from "@shared/schema";
import { eq, sql, and, desc, lt, or, inArray, gte, lte } from "drizzle-orm";
import { getWeeklyTokenUsage, WEEKLY_TOKEN_BUDGET } from "./ai-client";
import { logAudit } from "./audit";
import { emergencyStopAllRunningPlans } from "./strategic-core/execution-routes";
import { ACTIVE_PLAN_STATUSES } from "./plan-constants";

const MODULE_EVENT_MAP: Record<string, string[]> = {
  "strategic-core": [
    "PLAN_GENERATED", "PLAN_APPROVED", "PLAN_REJECTED", "PLAN_STATUS_CHANGED",
    "EXECUTION_CREATED", "EXECUTION_STARTED", "EXECUTION_COMPLETED", "EXECUTION_FAILED", "EXECUTION_RESUMED",
    "CALENDAR_CREATED", "CALENDAR_ENTRIES_GENERATED", "REQUIRED_WORK_CALCULATED",
    "STUDIO_ITEMS_CREATED", "STUDIO_ITEM_STATUS_CHANGED",
    "AI_CREATIVE_GENERATED", "AI_CREATIVE_FAILED",
    "EMERGENCY_STOP_TRIGGERED",
  ],
  ci: [
    "INTELLIGENCE_RUN", "DOMINANCE_RUN", "DOMINANCE_ANALYSIS_COMPLETED",
    "DOMINANCE_MOD_PROPOSED", "DOMINANCE_MODIFICATIONS_GENERATED",
    "DOMINANCE_MOD_APPROVED", "DOMINANCE_MODIFICATIONS_APPROVED",
    "DOMINANCE_MOD_REJECTED", "DOMINANCE_MODIFICATIONS_REJECTED",
    "DOMINANCE_MOD_APPLIED", "DOMINANCE_FALLBACK_ACKNOWLEDGED",
    "DOMINANCE_RETRY", "DOMINANCE_ROLLBACK",
  ],
  leads: [
    "LEAD_CAPTURED", "LEAD_STATUS_CHANGED", "CTA_VARIANT_GENERATED", "CTA_AUTO_PROMOTED",
    "CONVERSION_EVENT", "FUNNEL_BOTTLENECK_DETECTED", "LEAD_MAGNET_GENERATED",
    "LANDING_PAGE_PUBLISHED", "REVENUE_ATTRIBUTED", "AI_LEAD_OPTIMIZATION_RUN",
    "LEAD_ENGINE_CYCLE", "LEAD_ENGINE_GLOBAL_KILL",
  ],
  publishing: [
    "PUBLISH_SUCCESS", "PUBLISH_FAILED", "PUBLISH_RETRY_FAILED", "MONTHLY_CAP_BLOCKED",
  ],
  meta: [
    "META_API_ERROR", "META_MODE_TRANSITION", "META_TOKEN_EXCHANGED", "META_TOKEN_EXPIRED",
    "META_TOKEN_REVOKED", "META_PERMISSION_VERIFIED", "META_HEALTH_CHECK",
    "META_AUTO_EXTENSION", "META_DISCONNECTED", "META_CONNECTED",
    "META_TEMPORARY_ERROR", "META_RATE_LIMITED", "META_BACKOFF_APPLIED",
    "METRICS_RESET",
  ],
  worker: [
    "JOB_STARTED", "JOB_COMPLETED", "JOB_FAILED", "JOB_SKIPPED",
    "WORKER_SHUTDOWN", "WORKER_STARTUP",
    "AUTO_EXECUTION", "BLOCKED_DECISION",
  ],
  gates: [
    "GUARDRAIL_TRIGGER", "SAFE_MODE_ACTIVATED", "SAFE_MODE_CLEARED",
    "FEATURE_FLAG_TOGGLED", "FLAG_DEPENDENCY_BLOCKED",
    "AUTOPILOT_TOGGLED", "EMERGENCY_STOP",
    "DRIFT_DETECTED", "DRIFT_CLEARED",
    "VOLATILITY_CHANGE", "CONFIDENCE_UPDATED",
    "FATIGUE_DETECTED", "STATE_CHANGE", "STATE_TRANSITION",
    "OUTCOME_EVALUATED",
    "SIGNAL_SUPPRESSED", "SIGNAL_DOWNGRADED", "DATA_INTEGRITY_WARNING",
    "STRATEGY_RECOMMENDED", "STRATEGY_APPLIED", "STRATEGY_REJECTED",
  ],
};

function successResponse(data: any) {
  return { success: true, data };
}

function errorResponse(code: string, message: string, httpStatus: number, res: Response) {
  return res.status(httpStatus).json({ success: false, code, message });
}

export function registerAuditRoutes(app: Express) {

  // ─── 1) GET /api/audit/feed ───────────────────────────────────────
  app.get("/api/audit/feed", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const cursor = req.query.cursor as string | undefined;
      const eventTypes = req.query.event_type ? (req.query.event_type as string).split(",") : undefined;
      const module = req.query.module as string | undefined;
      const riskLevel = req.query.risk_level as string | undefined;
      const fromDate = req.query.from as string | undefined;
      const toDate = req.query.to as string | undefined;

      const conditions: any[] = [eq(auditLog.accountId, accountId)];

      let resolvedEventTypes = eventTypes;
      if (module && MODULE_EVENT_MAP[module]) {
        resolvedEventTypes = MODULE_EVENT_MAP[module];
      }
      if (resolvedEventTypes && resolvedEventTypes.length > 0) {
        conditions.push(inArray(auditLog.eventType, resolvedEventTypes));
      }
      if (riskLevel) {
        conditions.push(eq(auditLog.riskLevel, riskLevel));
      }
      if (fromDate) {
        conditions.push(gte(auditLog.createdAt, new Date(fromDate)));
      }
      if (toDate) {
        conditions.push(lte(auditLog.createdAt, new Date(toDate)));
      }

      if (cursor) {
        const [cursorTime, cursorId] = cursor.split("|");
        if (cursorTime && cursorId) {
          conditions.push(
            sql`(${auditLog.createdAt} < ${new Date(cursorTime)} OR (${auditLog.createdAt} = ${new Date(cursorTime)} AND ${auditLog.id} < ${cursorId}))`
          );
        }
      }

      const items = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit + 1);

      const hasMore = items.length > limit;
      const pageItems = hasMore ? items.slice(0, limit) : items;
      const lastItem = pageItems[pageItems.length - 1];
      const nextCursor = hasMore && lastItem
        ? `${lastItem.createdAt?.toISOString()}|${lastItem.id}`
        : null;

      res.json(successResponse({
        items: pageItems.map(item => ({
          id: item.id,
          eventType: item.eventType,
          riskLevel: item.riskLevel,
          executionStatus: item.executionStatus,
          details: item.details ? safeJsonParse(item.details) : null,
          decisionId: item.decisionId,
          createdAt: item.createdAt,
        })),
        total: pageItems.length,
        nextCursor,
        hasMore,
      }));
    } catch (err: any) {
      errorResponse("AUDIT_FEED_ERROR", err.message || "Failed to fetch audit feed", 500, res);
    }
  });

  // ─── 2) GET /api/audit/ai-usage ───────────────────────────────────
  app.get("/api/audit/ai-usage", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";

      const weeklyUsage = await getWeeklyTokenUsage(accountId);
      const remaining = Math.max(0, WEEKLY_TOKEN_BUDGET - weeklyUsage);
      const usagePct = Math.round((weeklyUsage / WEEKLY_TOKEN_BUDGET) * 100);

      const modelBreakdown = await db.execute(sql`
        SELECT model, 
               COUNT(*) as call_count,
               COALESCE(SUM(estimated_tokens), 0) as total_tokens,
               COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
               COUNT(*) FILTER (WHERE success = false) as failure_count
        FROM ai_usage_log
        WHERE account_id = ${accountId}
          AND created_at > NOW() - INTERVAL '7 days'
          AND endpoint != 'budget_reservation'
        GROUP BY model
        ORDER BY total_tokens DESC
      `);

      const endpointBreakdown = await db.execute(sql`
        SELECT endpoint,
               COUNT(*) as call_count,
               COALESCE(SUM(estimated_tokens), 0) as total_tokens,
               COUNT(*) FILTER (WHERE success = false) as failure_count
        FROM ai_usage_log
        WHERE account_id = ${accountId}
          AND created_at > NOW() - INTERVAL '7 days'
          AND endpoint != 'budget_reservation'
        GROUP BY endpoint
        ORDER BY total_tokens DESC
      `);

      const dailyTrend = await db.execute(sql`
        SELECT DATE(created_at) as day,
               COALESCE(SUM(estimated_tokens), 0) as tokens,
               COUNT(*) as calls
        FROM ai_usage_log
        WHERE account_id = ${accountId}
          AND created_at > NOW() - INTERVAL '7 days'
          AND endpoint != 'budget_reservation'
        GROUP BY DATE(created_at)
        ORDER BY day DESC
      `);

      const lastCall = await db.execute(sql`
        SELECT model, endpoint, estimated_tokens, duration_ms, success, created_at
        FROM ai_usage_log
        WHERE account_id = ${accountId}
          AND endpoint != 'budget_reservation'
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const totalCalls = (modelBreakdown.rows || []).reduce(
        (sum: number, r: any) => sum + Number(r.call_count || 0), 0
      );
      const totalFailures = (modelBreakdown.rows || []).reduce(
        (sum: number, r: any) => sum + Number(r.failure_count || 0), 0
      );
      const failureRate = totalCalls > 0 ? Math.round((totalFailures / totalCalls) * 100) : 0;

      const daysWithData = (dailyTrend.rows || []).length || 1;
      const burnRate = Math.round(weeklyUsage / Math.max(daysWithData, 1));
      const daysRemaining = burnRate > 0 ? Math.ceil(remaining / burnRate) : null;
      const projectedExhaustion = daysRemaining !== null
        ? new Date(Date.now() + daysRemaining * 86400000).toISOString()
        : null;

      res.json(successResponse({
        summary: {
          used_tokens: weeklyUsage,
          remaining_tokens: remaining,
          budget_tokens: WEEKLY_TOKEN_BUDGET,
          usage_pct: usagePct,
          burn_rate: burnRate,
          projected_exhaustion: projectedExhaustion,
          total_calls: totalCalls,
          total_failures: totalFailures,
          failure_rate_pct: failureRate,
          budget_status: weeklyUsage >= WEEKLY_TOKEN_BUDGET ? "LOCKED" : "ACTIVE",
        },
        models: (modelBreakdown.rows || []).map((r: any) => ({
          model: r.model,
          call_count: Number(r.call_count),
          total_tokens: Number(r.total_tokens),
          avg_duration_ms: Math.round(Number(r.avg_duration_ms)),
          failure_count: Number(r.failure_count),
        })),
        endpoints: (endpointBreakdown.rows || []).map((r: any) => ({
          endpoint: r.endpoint,
          call_count: Number(r.call_count),
          total_tokens: Number(r.total_tokens),
          failure_count: Number(r.failure_count),
        })),
        daily_trend: (dailyTrend.rows || []).map((r: any) => ({
          day: r.day,
          tokens: Number(r.tokens),
          calls: Number(r.calls),
        })),
        last_call: lastCall.rows?.[0] ? {
          model: lastCall.rows[0].model,
          endpoint: lastCall.rows[0].endpoint,
          tokens: Number(lastCall.rows[0].estimated_tokens),
          duration_ms: Number(lastCall.rows[0].duration_ms),
          success: lastCall.rows[0].success,
          created_at: lastCall.rows[0].created_at,
        } : null,
      }));
    } catch (err: any) {
      errorResponse("AI_USAGE_ERROR", err.message || "Failed to fetch AI usage stats", 500, res);
    }
  });

  // ─── 3) GET /api/audit/gates ──────────────────────────────────────
  app.get("/api/audit/gates", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const now = new Date();

      const acctRows = await db.select().from(accountState)
        .where(eq(accountState.accountId, accountId))
        .limit(1);
      const acct = acctRows[0] || null;

      const approvedPlans = await db.select({ id: strategicPlans.id, status: strategicPlans.status })
        .from(strategicPlans)
        .where(and(
          eq(strategicPlans.accountId, accountId),
          inArray(strategicPlans.status, [...ACTIVE_PLAN_STATUSES])
        ))
        .limit(1);

      const runningJobs = await db.select({ id: jobQueue.id, status: jobQueue.status })
        .from(jobQueue)
        .where(and(
          eq(jobQueue.accountId, accountId),
          eq(jobQueue.status, "running")
        ))
        .limit(5);

      const weeklyUsage = await getWeeklyTokenUsage(accountId);
      const budgetExceeded = weeklyUsage >= WEEKLY_TOKEN_BUDGET;

      const flagRows = await db.select()
        .from(featureFlags)
        .where(eq(featureFlags.accountId, accountId));
      const flagMap: Record<string, boolean> = {};
      for (const f of flagRows) {
        flagMap[f.flagName] = f.enabled ?? false;
      }

      const gates: Array<{
        gateName: string;
        status: "PASS" | "FAIL" | "WARN";
        reason: string;
        lastCheckedAt: string;
      }> = [];

      gates.push({
        gateName: "hasApprovedPlan",
        status: approvedPlans.length > 0 ? "PASS" : "FAIL",
        reason: approvedPlans.length > 0
          ? `Active approved plan: ${approvedPlans[0].id}`
          : "No approved strategic plan found. Create and approve a plan first.",
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "autopilotEnabled",
        status: acct?.autopilotOn ? "PASS" : "WARN",
        reason: acct?.autopilotOn
          ? "Autopilot is enabled"
          : "Autopilot is disabled — autonomous actions paused",
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "isPaused",
        status: acct?.state === "SAFE_MODE" ? "FAIL" : "PASS",
        reason: acct?.state === "SAFE_MODE"
          ? "Account is in SAFE_MODE — all execution paused"
          : `Account state: ${acct?.state || "ACTIVE"}`,
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "metaMode",
        status: acct?.metaMode === "REAL" ? "PASS" : "FAIL",
        reason: `Meta mode: ${acct?.metaMode || "DISCONNECTED"}`,
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "aiBudgetAvailable",
        status: budgetExceeded ? "FAIL" : (weeklyUsage > WEEKLY_TOKEN_BUDGET * 0.8 ? "WARN" : "PASS"),
        reason: budgetExceeded
          ? `Weekly AI budget EXCEEDED (${weeklyUsage.toLocaleString()}/${WEEKLY_TOKEN_BUDGET.toLocaleString()} tokens)`
          : `AI budget: ${weeklyUsage.toLocaleString()}/${WEEKLY_TOKEN_BUDGET.toLocaleString()} tokens (${Math.round((weeklyUsage / WEEKLY_TOKEN_BUDGET) * 100)}%)`,
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "executionLock",
        status: runningJobs.length > 0 ? "WARN" : "PASS",
        reason: runningJobs.length > 0
          ? `${runningJobs.length} job(s) currently running`
          : "No jobs running — execution available",
        lastCheckedAt: now.toISOString(),
      });

      const fbPublishing = acct?.metaMode === "REAL";
      const igPublishing = acct?.metaMode === "REAL";
      const insightsEnabled = acct?.metaMode === "REAL";

      gates.push({
        gateName: "fb_publishing_enabled",
        status: fbPublishing ? "PASS" : "FAIL",
        reason: fbPublishing ? "Facebook publishing enabled" : "Facebook publishing requires Meta REAL mode",
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "ig_publishing_enabled",
        status: igPublishing ? "PASS" : "FAIL",
        reason: igPublishing ? "Instagram publishing enabled" : "Instagram publishing requires Meta REAL mode",
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "insights_enabled",
        status: insightsEnabled ? "PASS" : "FAIL",
        reason: insightsEnabled ? "Insights data available" : "Insights require Meta REAL mode",
        lastCheckedAt: now.toISOString(),
      });

      gates.push({
        gateName: "confidenceScore",
        status: (acct?.confidenceScore ?? 0) >= 50 ? "PASS" : "WARN",
        reason: `Confidence: ${acct?.confidenceScore ?? 0}/100 (${acct?.confidenceStatus || "Unstable"})`,
        lastCheckedAt: now.toISOString(),
      });

      const leadKillSwitch = flagMap["lead_engine_global_off"] || false;
      gates.push({
        gateName: "leadEngineActive",
        status: leadKillSwitch ? "FAIL" : "PASS",
        reason: leadKillSwitch ? "Lead engine kill switch is ON" : "Lead engine operational",
        lastCheckedAt: now.toISOString(),
      });

      res.json(successResponse({
        gates,
        budgetStatus: budgetExceeded ? "LOCKED" : "ACTIVE",
        accountState: {
          autopilotOn: acct?.autopilotOn ?? false,
          state: acct?.state || "ACTIVE",
          metaMode: acct?.metaMode || "DISCONNECTED",
          confidenceScore: acct?.confidenceScore || 0,
          confidenceStatus: acct?.confidenceStatus || "Unknown",
          volatilityIndex: acct?.volatilityIndex || 0,
          consecutiveFailures: acct?.consecutiveFailures || 0,
          driftFlag: acct?.driftFlag || false,
          lastWorkerRun: acct?.lastWorkerRun || null,
        },
        featureFlags: flagMap,
      }));
    } catch (err: any) {
      errorResponse("GATES_ERROR", err.message || "Failed to fetch gate statuses", 500, res);
    }
  });

  // ─── 4) GET /api/audit/decisions ──────────────────────────────────
  app.get("/api/audit/decisions", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const campaignId = req.query.campaign_id as string | undefined;
      const planId = req.query.plan_id as string | undefined;

      const decisionTypes = [
        "AUTO_EXECUTION", "BLOCKED_DECISION",
        "STRATEGY_RECOMMENDED", "STRATEGY_APPLIED", "STRATEGY_REJECTED",
        "GUARDRAIL_TRIGGER", "SAFE_MODE_ACTIVATED",
        "AUTOPILOT_TOGGLED", "EMERGENCY_STOP",
        "OUTCOME_EVALUATED", "CONFIDENCE_UPDATED",
      ];

      const conditions: any[] = [
        eq(auditLog.accountId, accountId),
        inArray(auditLog.eventType, decisionTypes),
      ];

      if (campaignId) {
        conditions.push(sql`${auditLog.details}::text LIKE ${'%' + campaignId + '%'}`);
      }
      if (planId) {
        conditions.push(sql`${auditLog.details}::text LIKE ${'%' + planId + '%'}`);
      }

      const items = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);

      res.json(successResponse({
        items: items.map(item => ({
          id: item.id,
          eventType: item.eventType,
          decisionId: item.decisionId,
          riskLevel: item.riskLevel,
          executionStatus: item.executionStatus,
          details: item.details ? safeJsonParse(item.details) : null,
          guardrailResult: item.guardrailResult ? safeJsonParse(item.guardrailResult) : null,
          createdAt: item.createdAt,
        })),
        total: items.length,
      }));
    } catch (err: any) {
      errorResponse("DECISIONS_ERROR", err.message || "Failed to fetch decision history", 500, res);
    }
  });

  // ─── 5) GET /api/audit/publish-history ────────────────────────────
  app.get("/api/audit/publish-history", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

      const publishTypes = [
        "PUBLISH_SUCCESS", "PUBLISH_FAILED", "PUBLISH_RETRY_FAILED",
        "META_API_ERROR", "META_RATE_LIMITED", "META_BACKOFF_APPLIED",
        "MONTHLY_CAP_BLOCKED",
      ];

      const items = await db
        .select()
        .from(auditLog)
        .where(and(
          eq(auditLog.accountId, accountId),
          inArray(auditLog.eventType, publishTypes),
        ))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);

      res.json(successResponse({
        items: items.map(item => {
          const details = item.details ? safeJsonParse(item.details) : {};
          return {
            id: item.id,
            eventType: item.eventType,
            status: item.eventType.includes("SUCCESS") ? "success"
              : item.eventType.includes("RATE_LIMITED") ? "rate_limited"
              : item.eventType.includes("BACKOFF") ? "backoff"
              : item.eventType.includes("CAP") ? "capped"
              : "failed",
            errorClassification: details?.errorType || details?.classification || null,
            errorMessage: details?.error || details?.message || item.executionStatus || null,
            retryCount: details?.retryCount || details?.retry_count || 0,
            backoffState: details?.backoff || null,
            postId: details?.postId || details?.post_id || null,
            platform: details?.platform || null,
            createdAt: item.createdAt,
          };
        }),
        total: items.length,
      }));
    } catch (err: any) {
      errorResponse("PUBLISH_HISTORY_ERROR", err.message || "Failed to fetch publish history", 500, res);
    }
  });

  // ─── 6) GET /api/audit/jobs ───────────────────────────────────────
  app.get("/api/audit/jobs", async (req: Request, res: Response) => {
    try {
      const accountId = (req as any).accountId || "default";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

      const runningJobs = await db
        .select()
        .from(jobQueue)
        .where(and(
          eq(jobQueue.accountId, accountId),
          eq(jobQueue.status, "running")
        ))
        .orderBy(desc(jobQueue.startedAt))
        .limit(10);

      const recentJobs = await db
        .select()
        .from(jobQueue)
        .where(and(
          eq(jobQueue.accountId, accountId),
          or(
            eq(jobQueue.status, "completed"),
            eq(jobQueue.status, "failed"),
          )
        ))
        .orderBy(desc(jobQueue.completedAt))
        .limit(limit);

      const runningCount = runningJobs.length;
      const now = Date.now();

      res.json(successResponse({
        running: runningJobs.map(job => {
          const startMs = job.startedAt ? new Date(job.startedAt).getTime() : now;
          const elapsedMs = now - startMs;
          const isTimedOut = elapsedMs > 300000;
          return {
            id: job.id,
            cycleId: job.cycleId,
            status: isTimedOut ? "timed_out" : "running",
            startedAt: job.startedAt,
            elapsedMs,
            isTimedOut,
          };
        }),
        recent: recentJobs.map(job => ({
          id: job.id,
          cycleId: job.cycleId,
          status: job.status,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          durationMs: job.startedAt && job.completedAt
            ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
            : null,
          error: job.error,
        })),
        concurrency: {
          running: runningCount,
        },
        total: runningJobs.length + recentJobs.length,
      }));
    } catch (err: any) {
      errorResponse("JOBS_ERROR", err.message || "Failed to fetch job queue status", 500, res);
    }
  });

  // ─── 7) POST /api/audit/autopilot ─────────────────────────────────
  app.post("/api/audit/autopilot", async (req: Request, res: Response) => {
    try {
      const accountId = (req.body?.accountId as string) || "default";
      const enabled = !!req.body?.enabled;

      const existing = await db.select().from(accountState)
        .where(eq(accountState.accountId, accountId))
        .limit(1);

      if (existing.length > 0) {
        await db.update(accountState)
          .set({ autopilotOn: enabled, updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));
      } else {
        await db.insert(accountState).values({
          accountId,
          autopilotOn: enabled,
          state: "ACTIVE",
        });
      }

      await logAudit(accountId, "AUTOPILOT_TOGGLED", {
        details: { enabled, timestamp: new Date().toISOString() },
        riskLevel: "low",
      });

      res.json(successResponse({
        autopilotOn: enabled,
        message: `Autopilot ${enabled ? "enabled" : "disabled"}`,
      }));
    } catch (err: any) {
      errorResponse("AUTOPILOT_ERROR", err.message || "Failed to toggle autopilot", 500, res);
    }
  });

  // ─── 8) POST /api/audit/emergency-stop ────────────────────────────
  app.post("/api/audit/emergency-stop", async (req: Request, res: Response) => {
    try {
      const accountId = (req.body?.accountId as string) || "default";
      const reason = (req.body?.reason as string) || "Manual emergency stop triggered";

      const existing = await db.select().from(accountState)
        .where(eq(accountState.accountId, accountId))
        .limit(1);

      if (existing.length > 0) {
        await db.update(accountState)
          .set({
            autopilotOn: false,
            state: "SAFE_MODE",
            updatedAt: new Date(),
          })
          .where(eq(accountState.accountId, accountId));
      } else {
        await db.insert(accountState).values({
          accountId,
          autopilotOn: false,
          state: "SAFE_MODE",
        });
      }

      await emergencyStopAllRunningPlans(accountId, reason);

      await logAudit(accountId, "EMERGENCY_STOP", {
        details: { reason, timestamp: new Date().toISOString() },
        riskLevel: "critical",
      });

      res.json(successResponse({
        stopped: true,
        message: "Emergency stop activated. All autonomous actions paused. Execution plans frozen.",
      }));
    } catch (err: any) {
      errorResponse("EMERGENCY_STOP_ERROR", err.message || "Failed to execute emergency stop", 500, res);
    }
  });
}

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
