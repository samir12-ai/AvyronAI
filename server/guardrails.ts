import { db } from "./db";
import {
  performanceSnapshots,
  guardrailConfig,
  accountState,
  strategyDecisions,
  baselineHistory,
} from "@shared/schema";
import { eq, desc, gte, sql, and } from "drizzle-orm";
import { logAudit } from "./audit";

export interface GuardrailCheckResult {
  budgetCap: { passed: boolean; reason?: string };
  monthlyBudgetCap: { passed: boolean; reason?: string; monthlySpend?: number; limit?: number };
  cpaGuard: { passed: boolean; reason?: string; currentCpa?: number; thresholdCpa?: number };
  roasFloor: { passed: boolean; reason?: string; currentRoas?: number; floor?: number };
  volatility: { passed: boolean; reason?: string; index?: number; threshold?: number };
  fatigue: { detected: boolean; reason?: string };
  overallEligible: boolean;
  triggeredCount: number;
}

async function getConfig(accountId: string) {
  const configs = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, accountId))
    .limit(1);

  if (configs.length > 0) return configs[0];

  const defaultConfigs = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, "default"))
    .limit(1);

  return defaultConfigs[0] || null;
}

async function checkDailyBudgetCap(accountId: string, config: any): Promise<{ passed: boolean; reason?: string }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const spendResult = await db.select({
    totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
  }).from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, todayStart)));

  const todaySpend = Number(spendResult[0]?.totalSpend) || 0;
  const limit = config?.dailyBudgetLimit || 100;

  if (todaySpend >= limit) {
    return { passed: false, reason: `Daily spend $${todaySpend.toFixed(2)} >= limit $${limit}` };
  }
  return { passed: true };
}

async function checkMonthlyBudgetCap(accountId: string, config: any): Promise<{ passed: boolean; reason?: string; monthlySpend?: number; limit?: number }> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const spendResult = await db.select({
    totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
  }).from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, monthStart)));

  const monthlySpend = Number(spendResult[0]?.totalSpend) || 0;
  const limit = config?.monthlyBudgetLimit || 2000;

  if (monthlySpend >= limit) {
    await logAudit(accountId, "MONTHLY_CAP_BLOCKED", {
      details: {
        monthlySpend: monthlySpend.toFixed(2),
        limit,
        month: monthStart.toISOString().slice(0, 7),
      },
    });
    return { passed: false, reason: `Monthly spend $${monthlySpend.toFixed(2)} >= limit $${limit}`, monthlySpend, limit };
  }
  return { passed: true, monthlySpend, limit };
}

async function checkCpaGuard(accountId: string, config: any): Promise<{ passed: boolean; reason?: string; currentCpa?: number; thresholdCpa?: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [rollingResult, currentResult] = await Promise.all([
    db.select({
      avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    }).from(performanceSnapshots)
      .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, sevenDaysAgo))),
    db.select({
      avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    }).from(performanceSnapshots)
      .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, oneDayAgo))),
  ]);

  const rolling7dCpa = Number(rollingResult[0]?.avgCpa) || 0;
  const currentCpa = Number(currentResult[0]?.avgCpa) || 0;
  const multiplier = config?.cpaGuardMultiplier || 1.25;
  const threshold = rolling7dCpa * multiplier;

  if (rolling7dCpa > 0 && currentCpa > threshold) {
    return {
      passed: false,
      reason: `CPA $${currentCpa.toFixed(2)} > threshold $${threshold.toFixed(2)} (7d avg $${rolling7dCpa.toFixed(2)} × ${multiplier})`,
      currentCpa,
      thresholdCpa: threshold,
    };
  }
  return { passed: true, currentCpa, thresholdCpa: threshold };
}

async function checkRoasFloor(accountId: string, config: any): Promise<{ passed: boolean; reason?: string; currentRoas?: number; floor?: number }> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const roasResult = await db.select({
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
  }).from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, fortyEightHoursAgo)));

  const currentRoas = Number(roasResult[0]?.avgRoas) || 0;
  const floor = config?.roasFloor || 1.5;

  if (currentRoas > 0 && currentRoas < floor) {
    return {
      passed: false,
      reason: `ROAS ${currentRoas.toFixed(2)} < floor ${floor} for 48h`,
      currentRoas,
      floor,
    };
  }
  return { passed: true, currentRoas, floor };
}

export async function computeVolatilityIndex(accountId: string, config: any): Promise<{ passed: boolean; reason?: string; index?: number; threshold?: number; cpaCv?: number; roasCv?: number; ctrCv?: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const statsResult = await db.select({
    avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    stddevCpa: sql<number>`coalesce(stddev(${performanceSnapshots.cpa}), 0)`,
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
    stddevRoas: sql<number>`coalesce(stddev(${performanceSnapshots.roas}), 0)`,
    avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
    stddevCtr: sql<number>`coalesce(stddev(${performanceSnapshots.ctr}), 0)`,
  }).from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, sevenDaysAgo)));

  const stats = statsResult[0];
  const avgCpa = Number(stats?.avgCpa) || 0;
  const stdCpa = Number(stats?.stddevCpa) || 0;
  const avgRoas = Number(stats?.avgRoas) || 0;
  const stdRoas = Number(stats?.stddevRoas) || 0;
  const avgCtr = Number(stats?.avgCtr) || 0;
  const stdCtr = Number(stats?.stddevCtr) || 0;

  const cpaCv = avgCpa > 0 ? stdCpa / avgCpa : 0;
  const roasCv = avgRoas > 0 ? stdRoas / avgRoas : 0;
  const ctrCv = avgCtr > 0 ? stdCtr / avgCtr : 0;

  const volatilityIndex = (cpaCv + roasCv + ctrCv) / 3;
  const threshold = config?.volatilityThreshold || 0.35;

  await db.update(accountState)
    .set({
      volatilityIndex,
      volatilityCpa: cpaCv,
      volatilityRoas: roasCv,
      volatilityCtr: ctrCv,
      updatedAt: new Date(),
    })
    .where(eq(accountState.accountId, accountId));

  if (volatilityIndex > threshold) {
    return {
      passed: false,
      reason: `Volatility index ${volatilityIndex.toFixed(3)} > threshold ${threshold}`,
      index: volatilityIndex,
      threshold,
      cpaCv, roasCv, ctrCv,
    };
  }
  return { passed: true, index: volatilityIndex, threshold, cpaCv, roasCv, ctrCv };
}

export async function detectCreativeFatigue(accountId: string): Promise<{ detected: boolean; reason?: string }> {
  const recentData = await db.select({
    ctr: performanceSnapshots.ctr,
    impressions: performanceSnapshots.impressions,
    reach: performanceSnapshots.reach,
    fetchedAt: performanceSnapshots.fetchedAt,
  }).from(performanceSnapshots)
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(10);

  if (recentData.length < 6) {
    return { detected: false, reason: "Insufficient data for fatigue analysis" };
  }

  const recent3 = recentData.slice(0, 3);
  const older5 = recentData.slice(3, 8);

  const recent3AvgCtr = recent3.reduce((s, d) => s + (d.ctr || 0), 0) / recent3.length;
  const older5AvgCtr = older5.reduce((s, d) => s + (d.ctr || 0), 0) / older5.length;

  const ctrDropPercent = older5AvgCtr > 0 ? ((older5AvgCtr - recent3AvgCtr) / older5AvgCtr) * 100 : 0;
  const ctrDeclining = ctrDropPercent > 20;

  const recent3AvgImpressions = recent3.reduce((s, d) => s + (d.impressions || 0), 0) / recent3.length;
  const older5AvgImpressions = older5.reduce((s, d) => s + (d.impressions || 0), 0) / older5.length;
  const impressionsRising = recent3AvgImpressions > older5AvgImpressions;

  const recent3AvgReach = recent3.reduce((s, d) => s + (d.reach || 0), 0) / recent3.length;
  const frequency = recent3AvgReach > 0 ? recent3AvgImpressions / recent3AvgReach : 0;
  const frequencyHigh = frequency > 2.5;

  if (ctrDeclining && frequencyHigh && impressionsRising) {
    return {
      detected: true,
      reason: `CTR dropped ${ctrDropPercent.toFixed(1)}% (>20%), frequency ${frequency.toFixed(1)} (>2.5), impressions rising`,
    };
  }

  return { detected: false };
}

export async function checkSafeModeConditions(accountId: string): Promise<{
  shouldActivate: boolean;
  reasons: string[];
}> {
  const state = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);

  if (!state[0]) return { shouldActivate: false, reasons: [] };

  const s = state[0];
  const reasons: string[] = [];

  const config = await getConfig(accountId);
  const volThreshold = config?.volatilityThreshold || 0.35;
  if ((s.volatilityIndex || 0) > volThreshold) {
    reasons.push(`Volatility ${(s.volatilityIndex || 0).toFixed(3)} > threshold ${volThreshold}`);
  }

  if (s.driftFlag) {
    reasons.push("Sustained baseline drift detected (3+ cycles)");
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lastReset = s.lastGuardrailReset || twentyFourHoursAgo;
  if (lastReset < twentyFourHoursAgo) {
    await db.update(accountState)
      .set({ guardrailTriggers24h: 0, lastGuardrailReset: new Date(), updatedAt: new Date() })
      .where(eq(accountState.accountId, accountId));
  }

  if ((s.guardrailTriggers24h || 0) >= 3) {
    reasons.push(`${s.guardrailTriggers24h} guardrail triggers in 24h (>= 3)`);
  }

  if ((s.consecutiveFailures || 0) >= 2) {
    reasons.push(`${s.consecutiveFailures} consecutive failed auto-decisions (>= 2)`);
  }

  return {
    shouldActivate: reasons.length > 0,
    reasons,
  };
}

export async function runAllGuardrails(accountId: string): Promise<GuardrailCheckResult> {
  const config = await getConfig(accountId);

  const [budgetCap, monthlyBudgetCap, cpaGuard, roasFloor, volatility, fatigue] = await Promise.all([
    checkDailyBudgetCap(accountId, config),
    checkMonthlyBudgetCap(accountId, config),
    checkCpaGuard(accountId, config),
    checkRoasFloor(accountId, config),
    computeVolatilityIndex(accountId, config),
    detectCreativeFatigue(accountId),
  ]);

  const triggeredCount = [
    !budgetCap.passed,
    !monthlyBudgetCap.passed,
    !cpaGuard.passed,
    !roasFloor.passed,
    !volatility.passed,
  ].filter(Boolean).length;

  const overallEligible = budgetCap.passed && monthlyBudgetCap.passed && cpaGuard.passed && roasFloor.passed && volatility.passed;

  if (triggeredCount > 0) {
    await db.update(accountState)
      .set({
        guardrailTriggers24h: sql`${accountState.guardrailTriggers24h} + ${triggeredCount}`,
        updatedAt: new Date(),
      })
      .where(eq(accountState.accountId, accountId));

    const triggeredRules: string[] = [];
    if (!budgetCap.passed) triggeredRules.push("BUDGET_CAP");
    if (!monthlyBudgetCap.passed) triggeredRules.push("MONTHLY_BUDGET_CAP");
    if (!cpaGuard.passed) triggeredRules.push("CPA_GUARD");
    if (!roasFloor.passed) triggeredRules.push("ROAS_FLOOR");
    if (!volatility.passed) triggeredRules.push("VOLATILITY");

    await logAudit(accountId, "GUARDRAIL_TRIGGER", {
      details: {
        triggeredRules,
        budgetCap: budgetCap.reason,
        monthlyBudgetCap: monthlyBudgetCap.reason,
        cpaGuard: cpaGuard.reason,
        roasFloor: roasFloor.reason,
        volatility: volatility.reason,
      },
    });
  }

  if (fatigue.detected) {
    await logAudit(accountId, "FATIGUE_DETECTED", {
      details: { reason: fatigue.reason },
    });

    await db.insert(strategyDecisions).values({
      accountId,
      trigger: "Creative fatigue detected by algorithmic analysis",
      action: "Refresh creative assets — new hooks, visuals, and angles needed",
      reason: fatigue.reason || "CTR declining with rising frequency and impressions",
      objective: "Restore engagement by combating ad fatigue",
      budgetAdjustment: "No change",
      priority: "high",
      riskLevel: "low",
      autoGenerated: true,
      autoExecutable: true,
    });
  }

  if (!cpaGuard.passed) {
    await db.update(accountState)
      .set({ state: "UNSTABLE", updatedAt: new Date() })
      .where(eq(accountState.accountId, accountId));
  }

  return {
    budgetCap,
    monthlyBudgetCap,
    cpaGuard,
    roasFloor,
    volatility,
    fatigue,
    overallEligible,
    triggeredCount,
  };
}
