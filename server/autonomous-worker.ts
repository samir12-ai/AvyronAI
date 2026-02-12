import { db } from "./db";
import {
  accountState,
  jobQueue,
  strategyDecisions,
  strategyMemory,
  performanceSnapshots,
} from "@shared/schema";
import { eq, sql, desc, gte, lte } from "drizzle-orm";
import { logAudit } from "./audit";
import { computeRollingBaselines } from "./baselines";
import { runAllGuardrails, checkSafeModeConditions } from "./guardrails";
import { classifyDecisionRisk } from "./risk-classifier";
import { snapshotPreMetrics, evaluatePendingOutcomes, getRecentOutcomesForPrompt, computeSuccessRates } from "./outcome-tracker";
import OpenAI from "openai";

const WORKER_INTERVAL_MS = 5 * 60 * 1000;
const CYCLE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;
let workerTimer: ReturnType<typeof setInterval> | null = null;

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

async function runStrategyAnalysis(
  accountId: string,
  baselines: any,
  guardrailResult: any,
  outcomeContext: string
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

  const [recentPerformance, memoryItems] = await Promise.all([
    db.select()
      .from(performanceSnapshots)
      .where(gte(performanceSnapshots.fetchedAt, sevenDaysAgo))
      .orderBy(desc(performanceSnapshots.fetchedAt))
      .limit(30),
    db.select()
      .from(strategyMemory)
      .orderBy(desc(strategyMemory.updatedAt))
      .limit(20),
  ]);

  const perfSummary = recentPerformance.length > 0
    ? `Recent performance (${recentPerformance.length} data points, 7d): Avg CPA $${baselines.rollingCpa.toFixed(2)}, Avg ROAS ${baselines.rollingRoas.toFixed(2)}, Avg CTR ${(baselines.rollingCtr * 100).toFixed(1)}%, Total Spend $${baselines.rollingSpend.toFixed(2)}`
    : "No recent performance data available.";

  const memorySummary = memoryItems.length > 0
    ? memoryItems.map(m => `${m.memoryType}: ${m.label} (${m.isWinner ? 'WINNER' : 'LOSER'}, score: ${m.score})`).join("\n")
    : "No strategy memory entries yet.";

  const guardrailContext = guardrailResult.overallEligible
    ? "All guardrails passed — full operational capacity."
    : `GUARDRAIL ALERTS: ${[
        !guardrailResult.budgetCap.passed ? guardrailResult.budgetCap.reason : null,
        !guardrailResult.cpaGuard.passed ? guardrailResult.cpaGuard.reason : null,
        !guardrailResult.roasFloor.passed ? guardrailResult.roasFloor.reason : null,
        !guardrailResult.volatility.passed ? guardrailResult.volatility.reason : null,
      ].filter(Boolean).join("; ")}`;

  const systemPrompt = `You are a MOAT BUILDER AI Strategy Engine operating in AUTONOMOUS mode. You generate actionable marketing decisions based on performance data, memory, and guardrail state.

RULES:
1. Never suggest budget changes exceeding 15% per cycle
2. If guardrails are triggered, focus on optimization and defensive actions — NOT scaling
3. Prioritize decisions that build brand defensibility (authority, differentiation, competitive moats)
4. Each decision must have a clear, measurable objective
5. Suggest risk level: "low", "medium", or "high" (code will validate and may override)
6. Maximum 3 decisions per cycle

CONTEXT:
${perfSummary}

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
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 1500,
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
    const state = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);

    if (!state[0] || !state[0].autopilotOn) {
      await releaseLock(jobId, "completed");
      return;
    }

    const baselines = await computeRollingBaselines(accountId);
    const guardrailResult = await runAllGuardrails(accountId);

    const safeModeCheck = await checkSafeModeConditions(accountId);
    if (safeModeCheck.shouldActivate && state[0].state !== "SAFE_MODE") {
      await db.update(accountState)
        .set({ state: "SAFE_MODE", updatedAt: new Date() })
        .where(eq(accountState.accountId, accountId));

      await logAudit(accountId, "SAFE_MODE_ACTIVATED", {
        details: { reasons: safeModeCheck.reasons },
      });
    } else if (!safeModeCheck.shouldActivate && state[0].state === "SAFE_MODE") {
      await db.update(accountState)
        .set({ state: "ACTIVE", updatedAt: new Date() })
        .where(eq(accountState.accountId, accountId));

      await logAudit(accountId, "SAFE_MODE_CLEARED", {
        details: { message: "All SAFE_MODE conditions resolved" },
      });
    }

    await evaluatePendingOutcomes(accountId);

    const outcomeContext = await getRecentOutcomesForPrompt(accountId);
    const successRates = await computeSuccessRates(accountId);

    const currentState = await db.select().from(accountState)
      .where(eq(accountState.accountId, accountId))
      .limit(1);
    const acctState = currentState[0] || state[0];

    const aiDecisions = await runStrategyAnalysis(accountId, baselines, guardrailResult, outcomeContext);

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
          state: acctState.state || "ACTIVE",
          volatilityIndex: acctState.volatilityIndex || 0,
          driftFlag: acctState.driftFlag || false,
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

      const inserted = await db.insert(strategyDecisions).values({
        accountId,
        trigger: decision.trigger,
        action: decision.action,
        reason: decision.reason,
        objective: decision.objective || null,
        budgetAdjustment: decision.budgetAdjustment || null,
        priority: decision.priority || "medium",
        status: blocked ? "blocked" : (riskResult.autoExecutable ? "pending" : "pending"),
        riskLevel: riskResult.riskLevel,
        autoGenerated: true,
        autoExecutable: riskResult.autoExecutable && !blocked,
      }).returning();

      const decisionId = inserted[0]?.id;

      if (!decisionId) continue;

      if (riskResult.autoExecutable && !blocked && acctState.autopilotOn && acctState.state === "ACTIVE") {
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
          },
        });
      }
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
        safeModeActive: safeModeCheck.shouldActivate,
      },
    });

  } catch (error) {
    console.error(`[Worker] Error processing account ${accountId}:`, error);
    await releaseLock(jobId, "failed", String(error));

    await logAudit(accountId, "JOB_FAILED", {
      details: { jobId, error: String(error) },
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

export function startAutonomousWorker() {
  console.log("[Worker] Starting autonomous worker (5-min interval, 6h cycle threshold)");
  ensureDefaultConfig().catch(err => console.error("[Worker] Failed to seed defaults:", err));
  workerTick();
  workerTimer = setInterval(workerTick, WORKER_INTERVAL_MS);
}

export function stopAutonomousWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[Worker] Autonomous worker stopped");
  }
}
