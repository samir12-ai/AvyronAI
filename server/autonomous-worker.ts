import { db, pool } from "./db";
import {
  accountState,
  jobQueue,
  strategyDecisions,
  strategyMemory,
  performanceSnapshots,
  guardrailConfig,
  publishedPosts,
  campaignSelections,
  strategicPlans,
  calendarEntries,
  requiredWork,
  userChannelSnapshots,
} from "@shared/schema";
import { ACTIVE_PLAN_STATUSES_SQL } from "./plan-constants";

import { eq, and, sql, desc, gte, lte, ne, notInArray } from "drizzle-orm";
import { NON_STRATEGIC_MEMORY_TYPES_ARR } from "./decision-policy";

const LEGACY_CAMPAIGN = "unscoped_legacy";
import { logAudit } from "./audit";
import { FeatureFlagService } from "./feature-flags";
import { computeRollingBaselines } from "./baselines";
import { runAllGuardrails, checkSafeModeConditions } from "./guardrails";
import { classifyDecisionRisk } from "./risk-classifier";
import { snapshotPreMetrics, evaluatePendingOutcomes, getRecentOutcomesForPrompt, computeSuccessRates } from "./outcome-tracker";
import { calculateConfidence, computeDecisionSuccessRate, getLast2Outcomes, checkSafeModeExitConditions } from "./confidence";
import { aiChat } from "./ai-client";
import { validateAgentDecisionBinding } from "./decision-policy";
import { traceContext } from "./trace-context";
import { randomUUID } from "node:crypto";

const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const CYCLE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;
const MAX_DECISIONS_PER_HOUR = 1;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const IDLE_SKIP_DAYS = 7;
let workerTimer: ReturnType<typeof setInterval> | null = null;

async function acquireLock(accountId: string): Promise<string | null> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_MS);

  const runningJobs = await db.select().from(jobQueue)
    .where(
      sql`${jobQueue.accountId} = ${accountId} AND ${jobQueue.status} = 'running' AND ${jobQueue.lockedAt} > ${staleThreshold}`
    )
    .limit(1);

  if (runningJobs.length > 0) {
    return null;
  }

  await db.update(jobQueue)
    .set({ status: "failed", error: "Stale lock released", completedAt: now })
    .where(
      sql`${jobQueue.accountId} = ${accountId} AND ${jobQueue.status} = 'running' AND ${jobQueue.lockedAt} <= ${staleThreshold}`
    );

  const cycleId = `cycle_${accountId}_${now.getTime()}`;
  const inserted = await db.insert(jobQueue).values({
    accountId,
    status: "running",
    cycleId,
    lockedAt: now,
    startedAt: now,
  }).returning();

  return inserted[0]?.id || null;
}

async function releaseLock(jobId: string, status: "completed" | "failed", error?: string) {
  await db.update(jobQueue)
    .set({
      status,
      completedAt: new Date(),
      error: error || null,
    })
    .where(eq(jobQueue.id, jobId));
}

async function getAccountsDueForProcessing(): Promise<string[]> {
  const threshold = new Date(Date.now() - CYCLE_THRESHOLD_MS);

  const accounts = await db.select()
    .from(accountState)
    .where(
      sql`${accountState.autopilotOn} = true AND (${accountState.lastWorkerRun} IS NULL OR ${accountState.lastWorkerRun} <= ${threshold})`
    );

  return accounts.map(a => a.accountId);
}

async function getActiveCampaignId(accountId: string): Promise<string | null> {
  const [selection] = await db.select({ campaignId: campaignSelections.selectedCampaignId })
    .from(campaignSelections)
    .where(eq(campaignSelections.accountId, accountId))
    .limit(1);
  return selection?.campaignId || null;
}

async function runStrategyAnalysis(
  accountId: string,
  baselines: any,
  guardrailResult: any,
  outcomeContext: string,
  planContext?: { planId: string; planSummary: string; calendarProgress: string } | null,
  userChannelDeltaContext?: string | null
): Promise<Array<{
  trigger: string;
  action: string;
  reason: string;
  objective: string;
  budgetAdjustment: string;
  priority: string;
  aiSuggestedRisk: string;
}>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeCampaignId = await getActiveCampaignId(accountId);

  const [recentPerformance, memoryItems, recentPublished] = await Promise.all([
    db.select()
      .from(performanceSnapshots)
      .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, sevenDaysAgo)))
      .orderBy(desc(performanceSnapshots.fetchedAt))
      .limit(30),
    activeCampaignId
      ? db.select()
          .from(strategyMemory)
          .where(and(
            eq(strategyMemory.accountId, accountId),
            eq(strategyMemory.campaignId, activeCampaignId),
            ne(strategyMemory.campaignId, LEGACY_CAMPAIGN),
            // Exclude operational/non-strategic memory types
            // (content_rhythm, exploration_budget) from the AI-context read.
            notInArray(strategyMemory.memoryType, NON_STRATEGIC_MEMORY_TYPES_ARR),
          ))
          .orderBy(desc(strategyMemory.updatedAt))
          .limit(20)
      : Promise.resolve([]),
    db.select()
      .from(publishedPosts)
      .where(
        sql`${publishedPosts.accountId} = ${accountId} AND ${publishedPosts.status} = 'published' AND ${publishedPosts.publishedAt} >= ${sevenDaysAgo}`
      )
      .orderBy(desc(publishedPosts.publishedAt))
      .limit(20),
  ]);

  const perfSummary = recentPerformance.length > 0
    ? `Recent performance (${recentPerformance.length} data points, 7d): Avg CPA $${baselines.rollingCpa.toFixed(2)}, Avg ROAS ${baselines.rollingRoas.toFixed(2)}, Avg CTR ${(baselines.rollingCtr * 100).toFixed(1)}%, Total Spend $${baselines.rollingSpend.toFixed(2)}`
    : "No recent performance data available.";

  const publishedPostsSummary = recentPublished.length > 0
    ? `Published Posts (${recentPublished.length} in 7d):\n${recentPublished.map(p => 
        `- ${p.platform} | Impressions: ${p.impressions || 0} | Reach: ${p.reach || 0} | Engagement: ${p.engagement || 0} | Clicks: ${p.clicks || 0} | Goal: ${p.goal || 'N/A'}`
      ).join("\n")}`
    : "No published posts in the last 7 days.";

  const memorySummary = memoryItems.length > 0
    ? memoryItems.map(m => `${m.memoryType}: ${m.label} (${m.isWinner ? 'WINNER' : 'LOSER'}, score: ${m.score})`).join("\n")
    : "No strategy memory entries yet.";

  const guardrailContext = guardrailResult.overallEligible
    ? "All guardrails passed — full operational capacity."
    : `GUARDRAIL ALERTS: ${[
        !guardrailResult.budgetCap.passed ? guardrailResult.budgetCap.reason : null,
        !guardrailResult.monthlyBudgetCap.passed ? guardrailResult.monthlyBudgetCap.reason : null,
        !guardrailResult.cpaGuard.passed ? guardrailResult.cpaGuard.reason : null,
        !guardrailResult.roasFloor.passed ? guardrailResult.roasFloor.reason : null,
        !guardrailResult.volatility.passed ? guardrailResult.volatility.reason : null,
      ].filter(Boolean).join("; ")}`;

  const planContextBlock = planContext
    ? `\nACTIVE PLAN BINDING:
Plan ID: ${planContext.planId}
Plan Summary: ${planContext.planSummary}
Calendar Progress: ${planContext.calendarProgress}
IMPORTANT: All decisions MUST reference this planId. Actions must be derived from plan artifacts only.`
    : "\nNO ACTIVE PLAN — decisions are limited to monitoring and optimization only.";

  const userChannelBlock = userChannelDeltaContext
    ? `\nUSER'S OWN CHANNEL PERFORMANCE (weekly delta):\n${userChannelDeltaContext}\nCONSIDER: If engagement or follower deltas are negative, prioritize iteration/retention decisions. If new post count is low, flag execution gap.`
    : "";

  const systemPrompt = `You are a MOAT BUILDER AI Strategy Engine operating in AUTONOMOUS mode. You generate actionable marketing decisions based on performance data, memory, and guardrail state.

RULES:
1. Never suggest budget changes exceeding 15% per cycle
2. If guardrails are triggered, focus on optimization and defensive actions — NOT scaling
3. Prioritize decisions that build brand defensibility (authority, differentiation, competitive moats)
4. Each decision must have a clear, measurable objective
5. Suggest risk level: "low", "medium", or "high" (code will validate and may override)
6. Maximum 3 decisions per cycle
7. Every decision must include a "planId" field referencing the active plan
${planContextBlock}

CONTEXT:
${perfSummary}

PUBLISHED CONTENT PERFORMANCE:
${publishedPostsSummary}

STRATEGY MEMORY:
${memorySummary}

GUARDRAIL STATE:
${guardrailContext}
${userChannelBlock}
${outcomeContext}`;

  const userPrompt = `Analyze current performance and generate autonomous marketing decisions.

Return JSON array of decisions:
[{
  "trigger": "What triggered this decision",
  "action": "Specific action to take",
  "reason": "Data-backed reasoning",
  "objective": "Measurable goal",
  "budgetAdjustment": "e.g. '+10%', '-5%', 'No change'",
  "priority": "low|medium|high",
  "suggestedRisk": "low|medium|high"
}]

Return ONLY the JSON array, no other text.`;

  try {
    const response = await aiChat({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1500,
      accountId,
      endpoint: "autonomous-worker",
    });

    const content = response.choices[0]?.message?.content || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
    }
  } catch (error) {
    console.error("[Worker] AI analysis failed:", error);
  }

  return [];
}

async function getVolatilityThreshold(accountId: string): Promise<number> {
  const config = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, accountId))
    .limit(1);
  return (config[0] as any)?.volatilityThreshold || 0.35;
}

function enforceRecoveryModeLimits(decision: any): { blocked: boolean; reason: string } {
  const action = (decision.action || "").toLowerCase();
  const budgetAdj = decision.budgetAdjustment || "";

  const isNewCampaign = action.includes("launch") || action.includes("new campaign") || action.includes("create campaign");
  if (isNewCampaign) {
    return { blocked: true, reason: "RECOVERY_MODE: New campaign launches are blocked" };
  }

  const percentMatch = budgetAdj.match(/[+]?\s*(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    const pct = parseFloat(percentMatch[1]);
    if (pct > 10) {
      return { blocked: true, reason: `RECOVERY_MODE: Scaling ${pct}% exceeds 10% hard cap` };
    }
  }

  return { blocked: false, reason: "" };
}

async function getWorkerLimits(accountId: string): Promise<{ maxDecisionsPerHour: number; circuitBreakerThreshold: number; idleSkipDays: number }> {
  const config = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, accountId))
    .limit(1);
  return {
    maxDecisionsPerHour: config[0]?.maxDecisionsPerHour ?? MAX_DECISIONS_PER_HOUR,
    circuitBreakerThreshold: config[0]?.circuitBreakerThreshold ?? CIRCUIT_BREAKER_THRESHOLD,
    idleSkipDays: config[0]?.idleSkipDays ?? IDLE_SKIP_DAYS,
  };
}

async function checkHourlyDecisionCap(accountId: string, limit: number): Promise<{ allowed: boolean; count: number; limit: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.select()
    .from(strategyDecisions)
    .where(
      sql`${strategyDecisions.accountId} = ${accountId} AND ${strategyDecisions.autoGenerated} = true AND ${strategyDecisions.createdAt} >= ${oneHourAgo}`
    );
  return { allowed: recent.length < limit, count: recent.length, limit };
}

async function checkCircuitBreaker(accountId: string, threshold: number): Promise<{ tripped: boolean; failures: number }> {
  const acct = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);
  const failures = acct[0]?.consecutiveFailures || 0;
  return { tripped: failures >= threshold, failures };
}

async function checkIdleAccount(accountId: string, days: number): Promise<boolean> {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const recentPosts = await db.select()
    .from(publishedPosts)
    .where(
      sql`${publishedPosts.accountId} = ${accountId} AND ${publishedPosts.createdAt} >= ${threshold}`
    )
    .limit(1);
  const recentSnapshots = await db.select()
    .from(performanceSnapshots)
    .where(
      sql`${performanceSnapshots.accountId} = ${accountId} AND ${performanceSnapshots.fetchedAt} >= ${threshold}`
    )
    .limit(1);

  // Not idle if there's recent publishing or performance activity
  if (recentPosts.length > 0 || recentSnapshots.length > 0) return false;

  // Not idle if the account has an active strategic plan (pre-publish phase).
  // Accounts in strategy/approval phase have no published posts yet but are
  // actively being worked on and must receive autonomous analysis.
  const activePlan = await db.select({ id: strategicPlans.id })
    .from(strategicPlans)
    .where(
      sql`${strategicPlans.accountId} = ${accountId} AND ${strategicPlans.status} IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED')`
    )
    .limit(1);

  if (activePlan.length > 0) return false;

  return true;
}

async function processAccount(accountId: string) {
  // Never start a new account-level job after shutdown has begun.
  // Combined with the workerTick gates this guarantees no NEW DB writes
  // begin after SIGTERM; in-flight account work still gets its grace
  // window from the 5s unref'd timer in the signal handler.
  if (isShuttingDown) {
    return;
  }
  const jobId = await acquireLock(accountId);
  if (!jobId) {
    console.log(`[Worker] Account ${accountId} is locked, skipping`);
    return;
  }

  await logAudit(accountId, "JOB_STARTED", {
    details: { jobId },
  });

  try {
    const limits = await getWorkerLimits(accountId);

    const isIdle = await checkIdleAccount(accountId, limits.idleSkipDays);
    if (isIdle) {
      console.log(`[Worker] Account ${accountId} idle for ${limits.idleSkipDays}d, skipping`);
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "JOB_SKIPPED", { details: { reason: "idle_account", threshold_days: limits.idleSkipDays } });
      return;
    }

    const circuitBreaker = await checkCircuitBreaker(accountId, limits.circuitBreakerThreshold);
    if (circuitBreaker.tripped) {
      console.log(`[Worker] Circuit breaker tripped for ${accountId} (${circuitBreaker.failures} consecutive failures, threshold: ${limits.circuitBreakerThreshold})`);
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "JOB_SKIPPED", { details: { reason: "circuit_breaker", consecutive_failures: circuitBreaker.failures, threshold: limits.circuitBreakerThreshold } });
      return;
    }

    const hourlyCheck = await checkHourlyDecisionCap(accountId, limits.maxDecisionsPerHour);
    if (!hourlyCheck.allowed) {
      console.log(`[Worker] Hourly cap reached for ${accountId} (${hourlyCheck.count}/${hourlyCheck.limit})`);
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "JOB_SKIPPED", { details: { reason: "hourly_cap", decisions_this_hour: hourlyCheck.count, limit: hourlyCheck.limit } });
      return;
    }

    const state = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);

    if (!state[0] || !state[0].autopilotOn) {
      await releaseLock(jobId, "completed");
      return;
    }

    const activeCampaign = await getActiveCampaignId(accountId);
    let activePlanContext: { planId: string; planSummary: string; calendarProgress: string } | null = null;
    let capturedPlanEntries: Array<{ status: string }> = [];
    let capturedPlanWork: { totalContentPieces?: number | null } | undefined = undefined;

    if (activeCampaign) {
      let planQuery = await db
        .select()
        .from(strategicPlans)
        .where(
          and(
            eq(strategicPlans.accountId, accountId),
            eq(strategicPlans.campaignId, activeCampaign),
            sql`${strategicPlans.status} IN (${sql.raw(ACTIVE_PLAN_STATUSES_SQL)})`
          )
        )
        .orderBy(desc(strategicPlans.createdAt))
        .limit(1);

      if (planQuery.length === 0) {
        planQuery = await db
          .select()
          .from(strategicPlans)
          .where(
            and(
              eq(strategicPlans.accountId, accountId),
              sql`${strategicPlans.status} IN (${sql.raw(ACTIVE_PLAN_STATUSES_SQL)})`
            )
          )
          .orderBy(desc(strategicPlans.createdAt))
          .limit(1);
      }

      if (planQuery.length === 0) {
        console.log(`[Worker] Account ${accountId}: No approved plan found — autopilot BLOCKED`);
        await releaseLock(jobId, "completed");
        await logAudit(accountId, "AUTOPILOT_BLOCKED_NO_PLAN", {
          details: { campaignId: activeCampaign, reason: "NO_APPROVED_PLAN" },
        });
        return;
      }

      const plan = planQuery[0];
      const [planEntries, planWork] = await Promise.all([
        db.select().from(calendarEntries).where(eq(calendarEntries.planId, plan.id)),
        db.select().from(requiredWork).where(eq(requiredWork.planId, plan.id)).limit(1),
      ]);

      const totalReq = planWork[0]?.totalContentPieces || 0;
      const draftCount = planEntries.filter(e => e.status === "DRAFT").length;
      const generatedCount = planEntries.filter(e => e.status === "AI_GENERATED").length;
      const failedCount = planEntries.filter(e => e.status === "FAILED").length;

      activePlanContext = {
        planId: plan.id,
        planSummary: plan.planSummary || "Active execution plan",
        calendarProgress: `Total required: ${totalReq}, Calendar entries: ${planEntries.length}, Draft: ${draftCount}, Generated: ${generatedCount}, Failed: ${failedCount}`,
      };
      capturedPlanEntries = planEntries;
      capturedPlanWork = planWork[0];
    } else {
      console.log(`[Worker] Account ${accountId}: No active campaign — autopilot BLOCKED`);
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "AUTOPILOT_BLOCKED_NO_PLAN", {
        details: { reason: "NO_ACTIVE_CAMPAIGN" },
      });
      return;
    }

    const baselines = await computeRollingBaselines(accountId);
    const guardrailResult = await runAllGuardrails(accountId, activeCampaign || undefined);
    const compliance = activeCampaign
      ? await computeExecutionCompliance(accountId, activeCampaign, capturedPlanEntries, capturedPlanWork, baselines)
      : null;
    await evaluatePendingOutcomes(accountId);

    const volThreshold = await getVolatilityThreshold(accountId);
    const { successRate: decSuccessRate, total: decTotal } = await computeDecisionSuccessRate(accountId);
    const last2Outcomes = await getLast2Outcomes(accountId);

    const currentAcct = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    const acctRecord = currentAcct[0] || state[0];
    const currentMode = acctRecord.state || "ACTIVE";
    let prevRecoveryCycles = acctRecord.recoveryCyclesStable || 0;

    const confidenceResult = calculateConfidence({
      volatilityIndex: acctRecord.volatilityIndex || 0,
      volatilityThreshold: volThreshold,
      decisionSuccessRate: decSuccessRate,
      totalDecisions: decTotal,
      driftFlag: acctRecord.driftFlag || false,
      guardrailTriggers24h: acctRecord.guardrailTriggers24h || 0,
      currentState: currentMode,
    });

    await db.update(accountState)
      .set({
        confidenceScore: confidenceResult.score,
        confidenceStatus: confidenceResult.status,
        updatedAt: new Date(),
      })
      .where(eq(accountState.accountId, accountId));

    await logAudit(accountId, "CONFIDENCE_UPDATED", {
      details: {
        score: confidenceResult.score,
        status: confidenceResult.status,
        inputs: confidenceResult.inputs,
        mode: currentMode,
      },
    });

    let newMode = currentMode;

    const safeModeCheck = await checkSafeModeConditions(accountId);

    if (currentMode === "SAFE_MODE") {
      const exitCheck = checkSafeModeExitConditions({
        volatilityIndex: acctRecord.volatilityIndex || 0,
        volatilityThreshold: volThreshold,
        guardrailTriggers24h: acctRecord.guardrailTriggers24h || 0,
        driftFlag: acctRecord.driftFlag || false,
        last2Outcomes,
      });

      if (exitCheck.canExit) {
        const newCount = prevRecoveryCycles + 1;
        if (newCount >= 2) {
          newMode = "RECOVERY_MODE";
          await db.update(accountState)
            .set({ state: "RECOVERY_MODE", recoveryCyclesStable: 0, updatedAt: new Date() })
            .where(eq(accountState.accountId, accountId));

          await logAudit(accountId, "STATE_TRANSITION", {
            details: {
              from: "SAFE_MODE",
              to: "RECOVERY_MODE",
              reason: "2 consecutive stable cycles — all exit conditions met",
              exitConditions: "volatility below threshold, no guardrail triggers 24h, no drift, last 2 outcomes not failures",
            },
          });
          prevRecoveryCycles = 0;
        } else {
          await db.update(accountState)
            .set({ recoveryCyclesStable: newCount, updatedAt: new Date() })
            .where(eq(accountState.accountId, accountId));
          prevRecoveryCycles = newCount;
        }
      } else {
        if (prevRecoveryCycles > 0) {
          await db.update(accountState)
            .set({ recoveryCyclesStable: 0, updatedAt: new Date() })
            .where(eq(accountState.accountId, accountId));
        }
        prevRecoveryCycles = 0;
      }
    } else if (currentMode === "RECOVERY_MODE") {
      if (safeModeCheck.shouldActivate || confidenceResult.score < 40) {
        newMode = "SAFE_MODE";
        await db.update(accountState)
          .set({ state: "SAFE_MODE", recoveryCyclesStable: 0, updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));

        await logAudit(accountId, "STATE_TRANSITION", {
          details: {
            from: "RECOVERY_MODE",
            to: "SAFE_MODE",
            reason: "Instability detected during recovery — reverted immediately",
            triggers: safeModeCheck.reasons,
            confidence: confidenceResult.score,
          },
        });
        prevRecoveryCycles = 0;
      } else {
        const exitCheck = checkSafeModeExitConditions({
          volatilityIndex: acctRecord.volatilityIndex || 0,
          volatilityThreshold: volThreshold,
          guardrailTriggers24h: acctRecord.guardrailTriggers24h || 0,
          driftFlag: acctRecord.driftFlag || false,
          last2Outcomes,
        });

        if (exitCheck.canExit) {
          const newCount = prevRecoveryCycles + 1;
          if (newCount >= 2) {
            newMode = "FULL_AUTOPILOT";
            await db.update(accountState)
              .set({ state: "FULL_AUTOPILOT", recoveryCyclesStable: 0, updatedAt: new Date() })
              .where(eq(accountState.accountId, accountId));

            await logAudit(accountId, "STATE_TRANSITION", {
              details: {
                from: "RECOVERY_MODE",
                to: "FULL_AUTOPILOT",
                reason: "2 additional stable cycles in recovery — full autopilot restored",
                confidence: confidenceResult.score,
              },
            });
            prevRecoveryCycles = 0;
          } else {
            await db.update(accountState)
              .set({ recoveryCyclesStable: newCount, updatedAt: new Date() })
              .where(eq(accountState.accountId, accountId));
            prevRecoveryCycles = newCount;
          }
        } else {
          newMode = "SAFE_MODE";
          await db.update(accountState)
            .set({ state: "SAFE_MODE", recoveryCyclesStable: 0, updatedAt: new Date() })
            .where(eq(accountState.accountId, accountId));

          await logAudit(accountId, "STATE_TRANSITION", {
            details: {
              from: "RECOVERY_MODE",
              to: "SAFE_MODE",
              reason: "Recovery conditions no longer met — reverted",
              failedConditions: exitCheck.reasons,
            },
          });
          prevRecoveryCycles = 0;
        }
      }
    } else {
      if (safeModeCheck.shouldActivate || confidenceResult.score < 40) {
        newMode = "SAFE_MODE";
        await db.update(accountState)
          .set({ state: "SAFE_MODE", recoveryCyclesStable: 0, updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));

        const reason = confidenceResult.score < 40
          ? `Confidence ${confidenceResult.score} dropped below 40 — auto-triggered SAFE_MODE`
          : "SAFE_MODE conditions detected";

        await logAudit(accountId, "STATE_TRANSITION", {
          details: {
            from: currentMode,
            to: "SAFE_MODE",
            reason,
            triggers: safeModeCheck.reasons,
            confidence: confidenceResult.score,
          },
        });
      }
    }

    const outcomeContext = await getRecentOutcomesForPrompt(accountId);
    const successRates = await computeSuccessRates(accountId);

    const refreshedState = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    const finalRecord = refreshedState[0] || acctRecord;
    const activeMode = finalRecord.state || "ACTIVE";
    const finalConfidence = finalRecord.confidenceScore || confidenceResult.score;

    const canAutoExecute = activeMode === "ACTIVE" || activeMode === "FULL_AUTOPILOT" || activeMode === "RECOVERY_MODE";
    const isRecovery = activeMode === "RECOVERY_MODE";

    if (activeMode === "SAFE_MODE") {
      await db.update(accountState)
        .set({ lastWorkerRun: new Date(), updatedAt: new Date() })
        .where(eq(accountState.accountId, accountId));
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "JOB_COMPLETED", {
        details: { jobId, mode: "SAFE_MODE", decisionsGenerated: 0, confidence: finalConfidence },
      });
      return;
    }

    // Run user-channel scrape (awaited, within lock lifecycle — fix for concurrency correctness)
    let userChannelDeltaContext: string | null = null;
    try {
      const { needsUserChannelScrape, scrapeUserChannels } = await import("./user-channel-scraper");
      const activeCampaignId = await getActiveCampaignId(accountId);
      if (activeCampaignId) {
        const shouldScrape = await needsUserChannelScrape(accountId, activeCampaignId);
        if (shouldScrape) {
          console.log(`[Worker] Awaiting user channel scrape for account=${accountId} campaign=${activeCampaignId}`);
          await scrapeUserChannels(accountId, activeCampaignId);

          // ── Ingest fresh channel snapshots as primary performance signals ──
          // After scraping completes, convert per-format engagement into
          // content_performance_snapshots (source="channel-scrape") so the
          // memory mutation engine uses them as its PRIMARY truth signal.
          try {
            const { ingestChannelSnapshotAsPerformanceSignals } = await import("./performance-signal/normalizer");
            const { runMemoryMutation } = await import("./memory-mutation/engine");

            // Fetch the snapshots just written (Instagram only — website has no format data)
            const freshSnaps = await db
              .select()
              .from(userChannelSnapshots)
              .where(
                and(
                  eq(userChannelSnapshots.accountId, accountId),
                  eq(userChannelSnapshots.campaignId, activeCampaignId),
                  eq(userChannelSnapshots.platform, "instagram"),
                ),
              )
              .orderBy(desc(userChannelSnapshots.scrapedAt))
              .limit(5);

            let totalSignalsWritten = 0;
            for (const snap of freshSnaps) {
              if (!snap.snapshotData) continue;
              try {
                const parsed = JSON.parse(snap.snapshotData);
                const written = await ingestChannelSnapshotAsPerformanceSignals(
                  activeCampaignId,
                  accountId,
                  parsed,
                );
                totalSignalsWritten += written;
              } catch (parseErr) {
                console.warn(`[Worker] Failed to parse channel snapshot for signal ingest: ${(parseErr as Error).message}`);
              }
            }

            if (totalSignalsWritten > 0) {
              console.log(`[Worker] Channel signal ingest complete: ${totalSignalsWritten} format signal(s) written. Triggering memory mutation.`);
              // Fire-and-forget: channel data is now the primary mutation input
              runMemoryMutation(accountId, activeCampaignId).catch((err: any) =>
                console.warn(`[Worker] Channel-triggered memory mutation error: ${(err as Error).message}`),
              );
            } else {
              console.log(`[Worker] No channel format signals written (insufficient per-type data) — skipping channel mutation trigger.`);
            }
          } catch (signalErr) {
            console.warn(`[Worker] Channel signal ingest/mutation error (non-blocking): ${(signalErr as Error).message}`);
          }
        }
        // Build delta context from the latest snapshot per channel (uses deltaFromPrevious JSON)
        // campaignId filter is required to prevent cross-campaign data contamination
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentSnaps = await db.select()
          .from(userChannelSnapshots)
          .where(and(
            eq(userChannelSnapshots.accountId, accountId),
            eq(userChannelSnapshots.campaignId, activeCampaignId),
            gte(userChannelSnapshots.scrapedAt, sevenDaysAgo)
          ))
          .orderBy(desc(userChannelSnapshots.scrapedAt))
          .limit(20);
        if (recentSnaps.length > 0) {
          const lines: string[] = [];
          // Deduplicate: take the most recent snapshot per platform+handle combination
          const seen = new Set<string>();
          for (const snap of recentSnaps) {
            const key = `${snap.platform}:${snap.handle ?? "unknown"}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!snap.deltaFromPrevious) continue;
            try {
              const delta = JSON.parse(snap.deltaFromPrevious) as {
                isFirstScrape?: boolean;
                newPostsSinceLastSnapshot?: number;
                avgEngagementDelta?: number | null;
                followersDelta?: number | null;
                websiteChangeSummary?: string | null;
              };
              if (delta.isFirstScrape) continue; // skip first-scrape — no meaningful delta
              const eng = delta.avgEngagementDelta != null ? `${delta.avgEngagementDelta >= 0 ? "+" : ""}${delta.avgEngagementDelta}%` : "N/A";
              const followers = delta.followersDelta != null ? `${delta.followersDelta >= 0 ? "+" : ""}${delta.followersDelta}` : "N/A";
              const posts = delta.newPostsSinceLastSnapshot ?? 0;
              lines.push(`${key}: followers ${followers}, engagement ${eng}, new posts +${posts}`);
            } catch { /* malformed JSON — skip */ }
          }
          if (lines.length > 0) userChannelDeltaContext = lines.join("\n");
        }
      }
    } catch (scrapeErr) {
      console.error(`[Worker] User channel scrape/delta error for ${accountId}:`, (scrapeErr as Error).message);
    }

    const aiDecisions = await runStrategyAnalysis(accountId, baselines, guardrailResult, outcomeContext, activePlanContext, userChannelDeltaContext);

    for (const decision of aiDecisions) {
      const planIdBinding = activePlanContext?.planId ?? null;
      const bindingCheck = validateAgentDecisionBinding(decision, planIdBinding);
      if (!bindingCheck.bound) {
        console.error(
          `[Worker] DECISION_REJECTED_UNBOUND | account=${accountId} action="${decision.action.slice(0, 80)}" — ${bindingCheck.reason}. ` +
          `Decision will NOT be persisted. This enforces the requirement that all agent actions reference a validated plan.`,
        );
        await logAudit(accountId, "BLOCKED_DECISION", {
          details: {
            action: decision.action,
            reason: bindingCheck.reason,
            enforcementLayer: "decision-policy-binding",
            mode: activeMode,
          },
        });
        continue;
      }

      const riskResult = classifyDecisionRisk(
        {
          action: decision.action,
          budgetAdjustment: decision.budgetAdjustment,
          priority: decision.priority,
          aiSuggestedRisk: decision.aiSuggestedRisk || (decision as any).suggestedRisk,
        },
        guardrailResult,
        {
          state: activeMode,
          volatilityIndex: finalRecord.volatilityIndex || 0,
          driftFlag: finalRecord.driftFlag || false,
        }
      );

      const decisionType = categorizeDecisionType(decision.action);
      const typeRate = successRates[decisionType];
      let blocked = false;
      let blockReason = "";

      if (typeRate && typeRate.total >= 5 && typeRate.successRate < 40) {
        blocked = true;
        blockReason = `Success rate for '${decisionType}' is ${typeRate.successRate.toFixed(0)}% (< 40% threshold)`;
        riskResult.autoExecutable = false;
      }

      if (isRecovery && !blocked) {
        const recoveryCheck = enforceRecoveryModeLimits(decision);
        if (recoveryCheck.blocked) {
          blocked = true;
          blockReason = recoveryCheck.reason;
          riskResult.autoExecutable = false;
        }
      }

      if (!blocked && finalConfidence >= 60 && finalConfidence < 80) {
        const budgetAdj = decision.budgetAdjustment || "";
        const pctMatch = budgetAdj.match(/[+]?\s*(\d+(?:\.\d+)?)\s*%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          if (pct > 10) {
            decision.budgetAdjustment = `+10%`;
          }
        }
      } else if (!blocked && finalConfidence >= 40 && finalConfidence < 60) {
        const budgetAdj = decision.budgetAdjustment || "";
        const pctMatch = budgetAdj.match(/[+]?\s*(\d+(?:\.\d+)?)\s*%/);
        if (pctMatch) {
          const pct = parseFloat(pctMatch[1]);
          if (pct > 5) {
            decision.budgetAdjustment = `+5%`;
          }
        }
      }

      const insightType = compliance
        ? classifyInsightTypeFromState(compliance, finalRecord.volatilityIndex || 0, finalRecord.driftFlag || false, decision.trigger, decision.action)
        : classifyInsightType(decision.trigger, decision.action);

      const inserted = await db.insert(strategyDecisions).values({
        accountId,
        campaignId: activeCampaign || undefined,
        trigger: decision.trigger,
        action: decision.action,
        reason: decision.reason,
        objective: decision.objective || null,
        budgetAdjustment: decision.budgetAdjustment || null,
        priority: decision.priority || "medium",
        status: blocked ? "blocked" : "pending",
        riskLevel: riskResult.riskLevel,
        autoGenerated: true,
        autoExecutable: riskResult.autoExecutable && !blocked,
        insightType,
      }).returning();

      const decisionId = inserted[0]?.id;
      if (!decisionId) continue;

      const canExec = riskResult.autoExecutable && !blocked && finalRecord.autopilotOn && canAutoExecute;

      if (canExec) {
        await db.update(strategyDecisions)
          .set({ status: "executed", executedAt: new Date() })
          .where(eq(strategyDecisions.id, decisionId));

        await snapshotPreMetrics(decisionId, accountId, decisionType, activeCampaign || undefined);

        await logAudit(accountId, "AUTO_EXECUTION", {
          decisionId,
          riskLevel: riskResult.riskLevel,
          details: {
            action: decision.action,
            budgetAdjustment: decision.budgetAdjustment,
            reason: riskResult.reason,
            mode: activeMode,
            confidence: finalConfidence,
          },
        });

        await db.update(accountState)
          .set({ consecutiveFailures: 0, updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));
      } else if (riskResult.riskLevel === "high" || blocked) {
        await db.update(strategyDecisions)
          .set({ status: "blocked" })
          .where(eq(strategyDecisions.id, decisionId));

        await logAudit(accountId, "BLOCKED_DECISION", {
          decisionId,
          riskLevel: riskResult.riskLevel,
          details: {
            action: decision.action,
            reason: blocked ? blockReason : riskResult.reason,
            mode: activeMode,
          },
        });

        if (isRecovery && blocked) {
          const recoveryCheck = enforceRecoveryModeLimits(decision);
          if (recoveryCheck.blocked) {
            await db.update(accountState)
              .set({ state: "SAFE_MODE", recoveryCyclesStable: 0, updatedAt: new Date() })
              .where(eq(accountState.accountId, accountId));

            await logAudit(accountId, "STATE_TRANSITION", {
              details: {
                from: "RECOVERY_MODE",
                to: "SAFE_MODE",
                reason: `Recovery violation: ${recoveryCheck.reason}`,
              },
            });
            break;
          }
        }
      }
    }

    let leadEngineProcessed = false;
    try {
      const flagService = new FeatureFlagService();
      const flags = await flagService.getAllFlags(accountId);
      if (!flags.lead_engine_global_off) {
        if (flags.ai_lead_optimization_enabled && flags.lead_capture_enabled && flags.conversion_tracking_enabled) {
          await logAudit(accountId, "LEAD_ENGINE_CYCLE", {
            details: { jobId, modules: Object.entries(flags).filter(([k, v]) => v && k !== 'lead_engine_global_off').map(([k]) => k) },
          });
          leadEngineProcessed = true;
        }
      }
    } catch (leadErr) {
      console.error(`[Worker] Lead engine processing error for ${accountId}:`, leadErr);
    }


    await db.update(accountState)
      .set({ lastWorkerRun: new Date(), updatedAt: new Date() })
      .where(eq(accountState.accountId, accountId));

    await releaseLock(jobId, "completed");

    await logAudit(accountId, "JOB_COMPLETED", {
      details: {
        jobId,
        decisionsGenerated: aiDecisions.length,
        guardrailsTriggered: guardrailResult.triggeredCount,
        mode: activeMode,
        confidence: finalConfidence,
        confidenceStatus: confidenceResult.status,
        leadEngineProcessed,
      },
    });

  } catch (error) {
    console.error(`[Worker] Error processing account ${accountId}:`, error);
    await releaseLock(jobId, "failed", String(error));

    const currentState = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    const currentFailures = currentState[0]?.consecutiveFailures || 0;
    await db.update(accountState)
      .set({ consecutiveFailures: currentFailures + 1, updatedAt: new Date() })
      .where(eq(accountState.accountId, accountId));

    await logAudit(accountId, "JOB_FAILED", {
      details: { jobId, error: String(error), consecutiveFailures: currentFailures + 1 },
    });
  }
}

function categorizeDecisionType(action: string): string {
  const lower = action.toLowerCase();
  if (lower.includes("scale") || lower.includes("increase budget") || lower.includes("boost")) return "scaling";
  if (lower.includes("pause") || lower.includes("stop") || lower.includes("kill")) return "pause";
  if (lower.includes("refresh") || lower.includes("new creative") || lower.includes("new hook")) return "creative_refresh";
  if (lower.includes("audience") || lower.includes("targeting")) return "audience_optimization";
  if (lower.includes("campaign") || lower.includes("launch")) return "campaign_management";
  if (lower.includes("bid") || lower.includes("cpc") || lower.includes("cpm")) return "bid_optimization";
  return "general";
}

type InsightType = "user_execution" | "market_shift" | "strategy_gap" | "measurement_gap";

function classifyInsightType(trigger: string, action: string): InsightType {
  const t = (trigger + " " + action).toLowerCase();

  const isMarketShift =
    t.includes("competitor") ||
    t.includes("market") ||
    t.includes("format share") ||
    t.includes("positioning") ||
    t.includes("competitive") ||
    t.includes("velocity") ||
    t.includes("industry") ||
    t.includes("rival");

  if (isMarketShift) return "market_shift";

  const isStrategyGap =
    t.includes("strategy") ||
    t.includes("plan") ||
    t.includes("misalign") ||
    t.includes("contradict") ||
    t.includes("mismatch") ||
    t.includes("rebuild") ||
    t.includes("repositi") ||
    t.includes("funnel") ||
    t.includes("offer");

  if (isStrategyGap) return "strategy_gap";

  const isMeasurementGap =
    t.includes("no data") ||
    t.includes("no signal") ||
    t.includes("insufficient") ||
    t.includes("measurement") ||
    t.includes("baseline") ||
    t.includes("tracking") ||
    t.includes("signal quality") ||
    t.includes("no performance") ||
    t.includes("incomplete");

  if (isMeasurementGap) return "measurement_gap";

  return "user_execution";
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION COMPLIANCE — deterministic, data-driven. No AI involved.
// Uses data already collected by processAccount (plan entries + baselines).
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionCompliance {
  state: "COMPLIANT" | "LOW_CADENCE" | "NO_EXECUTION";
  publishedCount7d: number;
  cadenceFloor: number;
  calendarTotal: number;
  calendarGenerated: number;
  hasPerformanceData: boolean;
  explanation: string;
}

async function computeExecutionCompliance(
  accountId: string,
  campaignId: string,
  planEntries: Array<{ status: string }>,
  planWork: { totalContentPieces?: number | null } | undefined,
  baselines: { rollingRoas: number; rollingCtr: number; rollingSpend: number },
): Promise<ExecutionCompliance> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recentPublished, rhythmMem] = await Promise.all([
    db
      .select({ id: publishedPosts.id })
      .from(publishedPosts)
      .where(
        sql`${publishedPosts.accountId} = ${accountId} AND ${publishedPosts.status} = 'published' AND ${publishedPosts.publishedAt} >= ${sevenDaysAgo}`,
      )
      .limit(50),
    db
      .select({ details: strategyMemory.details })
      .from(strategyMemory)
      .where(
        and(
          eq(strategyMemory.accountId, accountId),
          eq(strategyMemory.campaignId, campaignId),
          eq(strategyMemory.memoryType, "content_rhythm"),
        ),
      )
      .orderBy(desc(strategyMemory.updatedAt))
      .limit(1),
  ]);

  const publishedCount7d = recentPublished.length;

  let cadenceFloor = 3;
  if (rhythmMem[0]?.details) {
    try {
      const rhythm =
        typeof rhythmMem[0].details === "string"
          ? JSON.parse(rhythmMem[0].details)
          : rhythmMem[0].details;
      const weeklyTarget =
        (rhythm.reelsPerWeek || 0) +
        (rhythm.carouselsPerWeek || 0) +
        (rhythm.postsPerWeek || 0);
      if (weeklyTarget > 0) {
        cadenceFloor = Math.max(1, Math.floor(weeklyTarget * 0.4));
      }
    } catch {}
  }

  const calendarTotal = planEntries.length;
  const calendarGenerated = planEntries.filter(
    (e) =>
      e.status === "AI_GENERATED" ||
      e.status === "GENERATED" ||
      e.status === "PUBLISHED",
  ).length;
  const hasPerformanceData = baselines.rollingSpend > 0 || baselines.rollingRoas > 0;

  let state: ExecutionCompliance["state"];
  let explanation: string;

  if (publishedCount7d === 0) {
    state = "NO_EXECUTION";
    explanation = `No published posts in the last 7 days. Execution has not started or has stopped completely.`;
  } else if (publishedCount7d < cadenceFloor) {
    state = "LOW_CADENCE";
    explanation = `${publishedCount7d} post(s) published in 7 days vs. cadence floor of ${cadenceFloor}. Execution is below minimum threshold.`;
  } else {
    state = "COMPLIANT";
    explanation = `${publishedCount7d} post(s) published in 7 days (cadence floor: ${cadenceFloor}). Execution is on track.`;
  }

  return {
    state,
    publishedCount7d,
    cadenceFloor,
    calendarTotal,
    calendarGenerated,
    hasPerformanceData,
    explanation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE-DRIVEN INSIGHT CLASSIFIER
// Uses real system state as the primary signal.
// Text matching (classifyInsightType) is kept only as a final-step refinement.
// Decision tree:
//   1. No execution → user_execution (always)
//   2. Low cadence → user_execution (execution, not strategy)
//   3. Executed but no performance data → measurement_gap
//   4. Market signals active (volatility / drift) → market_shift
//   5. Compliant + data + stable market → text refinement between
//      measurement_gap and strategy_gap, defaulting to strategy_gap
// ─────────────────────────────────────────────────────────────────────────────

function classifyInsightTypeFromState(
  compliance: ExecutionCompliance,
  volatilityIndex: number,
  driftFlag: boolean,
  triggerText: string,
  actionText: string,
): InsightType {
  if (compliance.state === "NO_EXECUTION") return "user_execution";
  if (compliance.state === "LOW_CADENCE") return "user_execution";

  if (!compliance.hasPerformanceData) return "measurement_gap";

  if (volatilityIndex > 0.35 || driftFlag) return "market_shift";

  const t = (triggerText + " " + actionText).toLowerCase();
  const hasMeasurementSignal =
    t.includes("no data") ||
    t.includes("no signal") ||
    t.includes("measurement") ||
    t.includes("tracking") ||
    t.includes("baseline") ||
    t.includes("insufficient signal");

  if (hasMeasurementSignal) return "measurement_gap";

  return "strategy_gap";
}

/** Number of accounts processed in parallel per worker tick. */
const WORKER_CONCURRENCY = 3;

// F6.4 — Postgres SESSION-scoped advisory lock + ±30s tick jitter so only
// one replica runs a tick at a time. Acquire AND release MUST share the
// SAME pinned PoolClient (lock is session-scoped); workerTick checks out
// one client for its lifetime and releases it in finally.
const WORKER_TICK_LOCK_KEY = 0x4F574EAF;
const WORKER_TICK_JITTER_MS = 30_000;
let workerJitterTimer: ReturnType<typeof setTimeout> | null = null;

async function tryAcquireWorkerLockOn(client: import("pg").PoolClient): Promise<boolean> {
  try {
    const r = await client.query<{ got: boolean }>(
      `SELECT pg_try_advisory_lock(${WORKER_TICK_LOCK_KEY}) AS got`,
    );
    return r.rows[0]?.got === true;
  } catch (err) {
    console.error("[Worker] Advisory-lock acquire failed:", (err as Error)?.message || err);
    return false;
  }
}

async function releaseWorkerLockOn(client: import("pg").PoolClient): Promise<void> {
  try {
    const r = await client.query<{ released: boolean }>(
      `SELECT pg_advisory_unlock(${WORKER_TICK_LOCK_KEY}) AS released`,
    );
    if (r.rows[0]?.released !== true) {
      console.error("[Worker] Advisory-lock release returned false (lock not held by this session)");
    }
  } catch (err) {
    console.error("[Worker] Advisory-lock release failed:", (err as Error)?.message || err);
  }
}

async function workerTick() {
  // Per-tick traceId so worker logs/Sentry carry the same observability
  // contract as HTTP requests.
  return traceContext.run({ traceId: `worker-autonomous-${randomUUID()}` }, async () => {
    let client: import("pg").PoolClient | null = null;
    try {
      client = await pool.connect();
    } catch (err) {
      console.error("[Worker] Could not acquire pool client for advisory lock:", (err as Error)?.message || err);
      return;
    }
    try {
      const acquired = await tryAcquireWorkerLockOn(client);
      if (!acquired) {
        console.log("[Worker] Tick skipped — another replica holds the advisory lock");
        const { recordWorkerTick } = await import("./observability/otel");
        recordWorkerTick("autonomous", "skipped");
        return;
      }
      try {
        await workerTickBody();
      } finally {
        await releaseWorkerLockOn(client);
      }
    } finally {
      // Releasing the client back to the pool ALSO drops any
      // session-held advisory locks as a defense-in-depth, so even if
      // releaseWorkerLockOn fails we cannot leak the lock past the next
      // pool checkout cycle.
      try { client.release(); } catch (e) {
        console.error("[Worker] PoolClient release failed:", (e as Error)?.message || e);
      }
    }
  });
}

async function workerTickBody() {
  // Explicit shutdown gate at the top of every tick AND between batches.
  // Without these two checks the
  // `installShutdownHandlers()` flag was inert against in-flight ticks.
  if (isShuttingDown) {
    const { recordWorkerTick } = await import("./observability/otel");
    recordWorkerTick("autonomous", "skipped");
    return;
  }
  try {
    const accountIds = await getAccountsDueForProcessing();
    const { recordWorkerTick, setWorkerQueueDepth } = await import("./observability/otel");
    setWorkerQueueDepth("autonomous", accountIds.length);

    if (accountIds.length === 0) {
      recordWorkerTick("autonomous", "skipped");
      return;
    }

    console.log(`[Worker] Processing ${accountIds.length} account(s) across ${WORKER_CONCURRENCY} parallel lane(s): ${accountIds.join(", ")}`);

    for (let i = 0; i < accountIds.length; i += WORKER_CONCURRENCY) {
      if (isShuttingDown) {
        console.log(`[Worker] Shutdown detected mid-tick — skipping remaining ${accountIds.length - i} account(s).`);
        recordWorkerTick("autonomous", "skipped");
        return;
      }
      const batch = accountIds.slice(i, i + WORKER_CONCURRENCY);
      await Promise.all(batch.map((accountId) => processAccount(accountId)));
    }
    recordWorkerTick("autonomous", "ok");
    setWorkerQueueDepth("autonomous", 0);
  } catch (error) {
    console.error("[Worker] Tick error:", error);
    const { recordWorkerTick } = await import("./observability/otel");
    recordWorkerTick("autonomous", "error");
  }
}

async function ensureDefaultConfig() {
  const { guardrailConfig, accountState: acctStateTable } = await import("@shared/schema");
  
  const existing = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, "default"))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(guardrailConfig).values({ accountId: "default" });
    console.log("[Worker] Default guardrail config created");
  }

  const existingState = await db.select().from(acctStateTable)
    .where(eq(acctStateTable.accountId, "default"))
    .limit(1);

  if (existingState.length === 0) {
    await db.insert(acctStateTable).values({ accountId: "default" });
    console.log("[Worker] Default account state created");
  }
}

const CI_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CI_MAX_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48 hours
const SHARED_POOL_STALE_HOURS = 24;
const SHARED_POOL_MAX_SCRAPES_PER_RUN = 3;
const FOUNDER_ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";
let ciTimer: ReturnType<typeof setTimeout> | null = null;

/** Returns a random interval between CI_MIN and CI_MAX to avoid fixed-pattern scheduling. */
function getNextCIIntervalMs(): number {
  return CI_MIN_INTERVAL_MS + Math.random() * (CI_MAX_INTERVAL_MS - CI_MIN_INTERVAL_MS);
}
// F6.10 — Promise-based concurrency gate so SIGTERM can await in-flight
// shared-pool refresh before the process exits.
let sharedPoolRunningPromise: Promise<void> | null = null;

async function runSharedPoolRefresh(): Promise<void> {
  if (sharedPoolRunningPromise) {
    console.log("[CI Worker] Shared pool refresh already running — skipping this tick");
    return sharedPoolRunningPromise;
  }
  sharedPoolRunningPromise = (async () => {
  try {
    const { getStaleSharedProfiles, fanOutSharedReuse } = await import("./competitive-intelligence/shared-profile-store");
    const { fetchCompetitorData } = await import("./competitive-intelligence/data-acquisition");
    const { acquireStickySession, releaseStickySession } = await import("./competitive-intelligence/proxy-pool-manager");
    const flagService = new FeatureFlagService();

    const staleProfiles = await getStaleSharedProfiles(SHARED_POOL_STALE_HOURS);

    if (staleProfiles.length === 0) {
      console.log("[CI Worker] Shared pool refresh: all profiles are fresh — nothing to do");
      return;
    }

    console.log(`[CI Worker] Shared pool refresh: ${staleProfiles.length} stale profile(s) found (>${SHARED_POOL_STALE_HOURS}h old)`);

    let scraped = 0;

    for (const profile of staleProfiles) {
      if (scraped >= SHARED_POOL_MAX_SCRAPES_PER_RUN) {
        console.log(`[CI Worker] Shared pool refresh: reached per-run scrape cap (${SHARED_POOL_MAX_SCRAPES_PER_RUN}). Remaining handles deferred to next cycle.`);
        break;
      }

      const { sharedProfileId, normalizedHandle, linkedCompetitors, ageHours } = profile;

      const ciEnabledCompetitors: typeof linkedCompetitors = [];
      for (const comp of linkedCompetitors) {
        const enabled = await flagService.isEnabled("competitive_intelligence_enabled", comp.accountId);
        if (enabled) ciEnabledCompetitors.push(comp);
      }

      if (ciEnabledCompetitors.length === 0) {
        console.log(`[CI Worker] @${normalizedHandle}: no CI-enabled accounts linked — skipping`);
        continue;
      }

      const founderComp = ciEnabledCompetitors.find(c => c.accountId === FOUNDER_ACCOUNT_ID);
      const canonicalComp = founderComp ?? ciEnabledCompetitors[0];

      console.log(`[CI Worker] Refreshing @${normalizedHandle} (${ageHours}h stale) via account=${canonicalComp.accountId}, competitor=${canonicalComp.name}`);

      let proxyCtx: import("./competitive-intelligence/proxy-pool-manager").StickySessionContext | null = null;
      try {
        proxyCtx = await acquireStickySession(normalizedHandle);
      } catch {
        console.warn(`[CI Worker] Could not acquire proxy session for @${normalizedHandle} — proceeding without proxy`);
      }

      try {
        const fetchResult = await fetchCompetitorData(
          canonicalComp.competitorId,
          canonicalComp.accountId,
          true,
          proxyCtx ?? undefined,
          "FAST_PASS"
        );

        console.log(`[CI Worker] @${normalizedHandle} fresh scrape: status=${fetchResult.status}, posts=${fetchResult.postsCollected}, method=${fetchResult.fetchMethod}`);
        scraped++;

        if (fetchResult.status === "SUCCESS" || fetchResult.status === "PARTIAL") {
          const { fanned, skipped } = await fanOutSharedReuse(
            sharedProfileId,
            canonicalComp.competitorId,
            canonicalComp.accountId
          );
          console.log(`[CI Worker] @${normalizedHandle} fan-out: fanned=${fanned} accounts, skipped=${skipped}`);
        } else {
          console.warn(`[CI Worker] @${normalizedHandle} scrape did not succeed (status=${fetchResult.status}) — skipping fan-out`);
        }
      } catch (err) {
        console.error(`[CI Worker] Error refreshing @${normalizedHandle}:`, err);
      } finally {
        if (proxyCtx) {
          try { releaseStickySession(proxyCtx); } catch {}
        }
      }

      await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
    }

    console.log(`[CI Worker] Shared pool refresh complete — ${scraped} handle(s) re-scraped this cycle`);

    try {
      const { scrapeTiktokForCompetitor } = await import("./competitive-intelligence/tiktok-scraper");
      const { db: workerDb } = await import("./db");
      const { ciCompetitors: ciComp } = await import("@shared/schema");
      const { eq: eqOp, and: andOp, sql: sqlOp } = await import("drizzle-orm");

      const tiktokCompetitors = await workerDb.execute(
        sqlOp`SELECT id, account_id, campaign_id, name FROM ci_competitors WHERE tiktok_url IS NOT NULL AND tiktok_url != '' AND is_active = true LIMIT 20`
      );

      let tiktokScraped = 0;
      for (const comp of (tiktokCompetitors as any).rows || tiktokCompetitors || []) {
        if (tiktokScraped >= 5) break;
        try {
          const result = await scrapeTiktokForCompetitor(comp.id, comp.account_id, comp.campaign_id);
          // F7.3 (validator-#3 propagation): surface degraded outcomes so
          // downstream coverage gates / freshness telemetry can distinguish
          // empty-OK runs from genuinely-failed scrapes. Persisting
          // degradation onto MI v3 snapshot _provenance is tracked as a
          // follow-up (no MI snapshot is written from this worker today).
          const _degTag = result.degraded ? `DEGRADED(${result.degradedReason})` : "OK";
          console.log(`[CI Worker] TikTok scrape: competitor=${comp.name} | campaign=${comp.campaign_id} | ${_degTag} | fetched=${result.postsFetched} | inserted=${result.postsInserted} | source=${result.source}`);
          tiktokScraped++;
        } catch (tktErr) {
          console.error(`[CI Worker] TikTok scrape error for ${comp.name} (campaign=${comp.campaign_id}): ${(tktErr as Error).message}`);
        }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
      }

      if (tiktokScraped > 0) {
        console.log(`[CI Worker] TikTok auto-scrape complete: ${tiktokScraped} competitor(s) processed`);
      }
    } catch (tiktokErr) {
      console.error(`[CI Worker] TikTok auto-scraping module error (non-blocking): ${(tiktokErr as Error).message}`);
    }

    try {
      const { db: workerDb } = await import("./db");
      const { sql: sqlOp } = await import("drizzle-orm");

      const reviewCompetitors = await workerDb.execute(
        sqlOp`SELECT id, account_id, campaign_id, name FROM ci_competitors WHERE google_maps_url IS NOT NULL AND google_maps_url != '' AND is_active = true LIMIT 20`
      );

      let reviewsScraped = 0;
      for (const comp of (reviewCompetitors as any).rows || reviewCompetitors || []) {
        if (reviewsScraped >= 5) break;
        try {
          const reviewsRoute = await import("./competitive-intelligence/reviews-tiktok-routes");
          if (typeof (reviewsRoute as any).scrapeReviewsForCompetitor === "function") {
            const result = await (reviewsRoute as any).scrapeReviewsForCompetitor(comp.id, comp.account_id, comp.campaign_id);
            console.log(`[CI Worker] Reviews scrape: competitor=${comp.name} | result=${JSON.stringify(result).slice(0, 200)}`);
            reviewsScraped++;
          } else {
            console.log(`[CI Worker] Reviews scrape: scrapeReviewsForCompetitor not exported — skipping`);
            break;
          }
        } catch (revErr) {
          console.error(`[CI Worker] Reviews scrape error for ${comp.name}: ${(revErr as Error).message}`);
        }
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));
      }

      if (reviewsScraped > 0) {
        console.log(`[CI Worker] Reviews auto-scrape complete: ${reviewsScraped} competitor(s) processed`);
      }
    } catch (reviewErr) {
      console.error(`[CI Worker] Reviews auto-scraping module error (non-blocking): ${(reviewErr as Error).message}`);
    }
  } catch (error) {
    console.error("[CI Worker] Shared pool refresh error:", error);
  }
  })();
  try {
    await sharedPoolRunningPromise;
  } finally {
    sharedPoolRunningPromise = null;
  }
}

export function isSharedPoolRefreshRunning(): boolean {
  return sharedPoolRunningPromise !== null;
}

/**
 * Schedules the next CI refresh with a randomized 24–48h interval.
 * Using recursive setTimeout (rather than setInterval) ensures each cycle
 * picks a fresh random delay, breaking fixed-pattern scheduling.
 */
function scheduleCIRefresh() {
  const nextMs = getNextCIIntervalMs();
  const nextHours = (nextMs / 3600000).toFixed(1);
  console.log(`[CI Worker] Next shared pool refresh in ${nextHours}h`);
  ciTimer = setTimeout(async () => {
    await runSharedPoolRefresh();
    scheduleCIRefresh();
  }, nextMs);
}

export function startAutonomousWorker() {
  console.log(`[Worker] Starting autonomous worker (5-min tick, 6h cycle threshold, ${WORKER_CONCURRENCY} parallel lanes)`);
  installShutdownHandlers();
  ensureDefaultConfig().catch(err => console.error("[Worker] Failed to seed defaults:", err));
  workerTick();
  // Seal #11 / Task #29 / F6.4 — jittered self-rescheduling tick.
  // Replaces fixed setInterval so two replicas booted within seconds of
  // each other don't tick on the exact same wall-clock boundary forever.
  const scheduleNextTick = () => {
    if (isShuttingDown) return;
    const jitter = (Math.random() * 2 - 1) * WORKER_TICK_JITTER_MS; // ±30s
    const delay = WORKER_INTERVAL_MS + jitter;
    workerJitterTimer = setTimeout(async () => {
      await workerTick();
      scheduleNextTick();
    }, delay);
  };
  scheduleNextTick();

  setTimeout(async () => {
    await runSharedPoolRefresh();
    scheduleCIRefresh();
  }, 60000);
  console.log("[CI Worker] Shared pool refresh worker started (24–48h randomized interval, initial run in 60s)");
}

export async function stopAutonomousWorker(): Promise<void> {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[Worker] Autonomous worker stopped");
  }
  if (workerJitterTimer) {
    clearTimeout(workerJitterTimer);
    workerJitterTimer = null;
  }
  if (ciTimer) {
    clearTimeout(ciTimer);
    ciTimer = null;
    console.log("[CI Worker] Competitive intelligence checker stopped");
  }
  // F6.10 — await any in-flight shared-pool refresh before exit.
  if (sharedPoolRunningPromise) {
    console.log("[CI Worker] Awaiting in-flight shared pool refresh before exit…");
    try {
      await sharedPoolRunningPromise;
    } catch (err) {
      console.error("[CI Worker] In-flight refresh errored during shutdown:", (err as Error)?.message || err);
    }
  }
}

// F6.11 — SIGTERM/SIGINT handler. Sets isShuttingDown, stops timers, then
// gives in-flight ticks ~5s to reach their releaseLock finally-block.
// Idempotent. Read by workerTick/processAccount to short-circuit new work.
let isShuttingDown = false;
export function isWorkerShuttingDown(): boolean {
  return isShuttingDown;
}
let signalHandlersInstalled = false;
export function installShutdownHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const onSignal = (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Worker] Received ${signal} — initiating graceful shutdown.`);
    // Fire-and-await: stopAutonomousWorker is now async (awaits in-flight
    // shared-pool refresh per F6.10). Must not throw out of the signal
    // handler.
    stopAutonomousWorker().catch((err: any) => {
      console.error(`[Worker] Error during stopAutonomousWorker on ${signal}:`, (err as Error)?.message || err);
    });
    // Give in-flight ticks ~5s to finish their finally-block work
    // (releaseLock, audit writes). Replit's default kill window is 15s so
    // we stay well inside it.
    setTimeout(() => {
      console.log(`[Worker] Graceful shutdown grace period elapsed (${signal}).`);
    }, 5000).unref();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}
