import { db } from "./db";
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
} from "@shared/schema";
import { ACTIVE_PLAN_STATUSES_SQL } from "./plan-constants";

import { eq, and, sql, desc, gte, lte, ne } from "drizzle-orm";

const LEGACY_CAMPAIGN = "unscoped_legacy";
import { logAudit } from "./audit";
import { FeatureFlagService } from "./feature-flags";
import { computeRollingBaselines } from "./baselines";
import { runAllGuardrails, checkSafeModeConditions } from "./guardrails";
import { classifyDecisionRisk } from "./risk-classifier";
import { snapshotPreMetrics, evaluatePendingOutcomes, getRecentOutcomesForPrompt, computeSuccessRates } from "./outcome-tracker";
import { calculateConfidence, computeDecisionSuccessRate, getLast2Outcomes, checkSafeModeExitConditions } from "./confidence";
import { aiChat } from "./ai-client";

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
  planContext?: { planId: string; planSummary: string; calendarProgress: string } | null
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
            ne(strategyMemory.campaignId, LEGACY_CAMPAIGN)
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
  return recentPosts.length === 0 && recentSnapshots.length === 0;
}

async function processAccount(accountId: string) {
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
    } else {
      console.log(`[Worker] Account ${accountId}: No active campaign — autopilot BLOCKED`);
      await releaseLock(jobId, "completed");
      await logAudit(accountId, "AUTOPILOT_BLOCKED_NO_PLAN", {
        details: { reason: "NO_ACTIVE_CAMPAIGN" },
      });
      return;
    }

    const baselines = await computeRollingBaselines(accountId);
    const guardrailResult = await runAllGuardrails(accountId);
    await evaluatePendingOutcomes(accountId);

    const volThreshold = await getVolatilityThreshold(accountId);
    const { successRate: decSuccessRate, total: decTotal } = await computeDecisionSuccessRate(accountId);
    const last2Outcomes = await getLast2Outcomes(accountId);

    const currentAcct = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    const acctState = currentAcct[0] || state[0];
    const currentMode = acctState.state || "ACTIVE";
    let prevRecoveryCycles = acctState.recoveryCyclesStable || 0;

    const confidenceResult = calculateConfidence({
      volatilityIndex: acctState.volatilityIndex || 0,
      volatilityThreshold: volThreshold,
      decisionSuccessRate: decSuccessRate,
      totalDecisions: decTotal,
      driftFlag: acctState.driftFlag || false,
      guardrailTriggers24h: acctState.guardrailTriggers24h || 0,
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
        volatilityIndex: acctState.volatilityIndex || 0,
        volatilityThreshold: volThreshold,
        guardrailTriggers24h: acctState.guardrailTriggers24h || 0,
        driftFlag: acctState.driftFlag || false,
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
          volatilityIndex: acctState.volatilityIndex || 0,
          volatilityThreshold: volThreshold,
          guardrailTriggers24h: acctState.guardrailTriggers24h || 0,
          driftFlag: acctState.driftFlag || false,
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
    const finalState = refreshedState[0] || acctState;
    const activeMode = finalState.state || "ACTIVE";
    const finalConfidence = finalState.confidenceScore || confidenceResult.score;

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

    const aiDecisions = await runStrategyAnalysis(accountId, baselines, guardrailResult, outcomeContext, activePlanContext);

    for (const decision of aiDecisions) {
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
          volatilityIndex: finalState.volatilityIndex || 0,
          driftFlag: finalState.driftFlag || false,
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

      const inserted = await db.insert(strategyDecisions).values({
        accountId,
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
      }).returning();

      const decisionId = inserted[0]?.id;
      if (!decisionId) continue;

      const canExec = riskResult.autoExecutable && !blocked && finalState.autopilotOn && canAutoExecute;

      if (canExec) {
        await db.update(strategyDecisions)
          .set({ status: "executed", executedAt: new Date() })
          .where(eq(strategyDecisions.id, decisionId));

        await snapshotPreMetrics(decisionId, accountId, decisionType);

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

async function workerTick() {
  try {
    const accountIds = await getAccountsDueForProcessing();

    if (accountIds.length === 0) {
      return;
    }

    console.log(`[Worker] Processing ${accountIds.length} account(s): ${accountIds.join(", ")}`);

    for (const accountId of accountIds) {
      await processAccount(accountId);
    }
  } catch (error) {
    console.error("[Worker] Tick error:", error);
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

const CI_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let ciTimer: ReturnType<typeof setInterval> | null = null;

async function runMonthlyCompetitiveIntelligence() {
  try {
    const flagService = new FeatureFlagService();
    const accounts = await db.select().from(accountState);

    for (const account of accounts) {
      const accountId = account.accountId;
      const enabled = await flagService.isEnabled("competitive_intelligence_enabled", accountId);
      if (!enabled) continue;

      const { miSnapshots } = await import("@shared/schema");
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const recentSnapshot = await db.select().from(miSnapshots)
        .where(sql`${miSnapshots.accountId} = ${accountId} AND ${miSnapshots.createdAt} > ${thirtyDaysAgo.toISOString()}`)
        .limit(1);

      if (recentSnapshot.length > 0) continue;

      console.log(`[CI Worker] MIv3 snapshot stale for account: ${accountId} — manual refresh via /api/ci/mi-v3/analyze recommended`);
    }
  } catch (error) {
    console.error("[CI Worker] Monthly check error:", error);
  }
}

export function startAutonomousWorker() {
  console.log("[Worker] Starting autonomous worker (5-min interval, 6h cycle threshold)");
  ensureDefaultConfig().catch(err => console.error("[Worker] Failed to seed defaults:", err));
  workerTick();
  workerTimer = setInterval(workerTick, WORKER_INTERVAL_MS);
  
  setTimeout(() => runMonthlyCompetitiveIntelligence(), 30000);
  ciTimer = setInterval(runMonthlyCompetitiveIntelligence, CI_CHECK_INTERVAL_MS);
  console.log("[CI Worker] Monthly competitive intelligence checker started (daily check, 30-day cycle)");
}

export function stopAutonomousWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[Worker] Autonomous worker stopped");
  }
  if (ciTimer) {
    clearInterval(ciTimer);
    ciTimer = null;
    console.log("[CI Worker] Competitive intelligence checker stopped");
  }
}
