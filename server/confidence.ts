import { db } from "./db";
import { accountState, auditLog, decisionOutcomes } from "@shared/schema";
import { eq, sql, gte, desc } from "drizzle-orm";

export interface ConfidenceResult {
  score: number;
  status: "Stable" | "Caution" | "Unstable";
  inputs: {
    volatilityPenalty: number;
    successRatePenalty: number;
    driftPenalty: number;
    guardrailPenalty: number;
  };
}

export function calculateConfidence(params: {
  volatilityIndex: number;
  volatilityThreshold: number;
  decisionSuccessRate: number;
  totalDecisions: number;
  driftFlag: boolean;
  guardrailTriggers24h: number;
  currentState: string;
}): ConfidenceResult {
  let score = 100;

  let volatilityPenalty = 0;
  const volRatio = params.volatilityThreshold > 0
    ? params.volatilityIndex / params.volatilityThreshold
    : 0;
  if (volRatio > 1.0) {
    volatilityPenalty = 20;
  } else if (volRatio > 0.7) {
    volatilityPenalty = 10;
  } else if (volRatio > 0.4) {
    volatilityPenalty = 5;
  }

  let successRatePenalty = 0;
  if (params.totalDecisions >= 5) {
    if (params.decisionSuccessRate < 30) {
      successRatePenalty = 30;
    } else if (params.decisionSuccessRate < 50) {
      successRatePenalty = 20;
    } else if (params.decisionSuccessRate < 70) {
      successRatePenalty = 10;
    }
  }

  let driftPenalty = 0;
  if (params.driftFlag) {
    driftPenalty = 15;
  }

  let guardrailPenalty = Math.min(params.guardrailTriggers24h * 5, 20);

  score -= volatilityPenalty;
  score -= successRatePenalty;
  score -= driftPenalty;
  score -= guardrailPenalty;

  if (params.currentState === "SAFE_MODE") {
    score = Math.min(score, 40);
  }

  score = Math.max(score, 10);
  score = Math.min(score, 100);

  let status: "Stable" | "Caution" | "Unstable";
  if (score >= 80) {
    status = "Stable";
  } else if (score >= 60) {
    status = "Caution";
  } else {
    status = "Unstable";
  }

  return {
    score,
    status,
    inputs: {
      volatilityPenalty,
      successRatePenalty,
      driftPenalty,
      guardrailPenalty,
    },
  };
}

export async function computeDecisionSuccessRate(accountId: string): Promise<{
  successRate: number;
  total: number;
}> {
  const outcomes = await db.select({
    outcome: decisionOutcomes.outcome,
  }).from(decisionOutcomes)
    .where(eq(decisionOutcomes.accountId, accountId))
    .orderBy(desc(decisionOutcomes.evaluatedAt))
    .limit(20);

  const evaluated = outcomes.filter(o => o.outcome !== null && o.outcome !== undefined);
  if (evaluated.length === 0) {
    return { successRate: 100, total: 0 };
  }

  const successes = evaluated.filter(o => o.outcome === "success").length;
  return {
    successRate: (successes / evaluated.length) * 100,
    total: evaluated.length,
  };
}

export async function getLast2Outcomes(accountId: string): Promise<string[]> {
  const outcomes = await db.select({
    outcome: decisionOutcomes.outcome,
  }).from(decisionOutcomes)
    .where(
      sql`${decisionOutcomes.accountId} = ${accountId} AND ${decisionOutcomes.outcome} IS NOT NULL`
    )
    .orderBy(desc(decisionOutcomes.evaluatedAt))
    .limit(2);

  return outcomes.map(o => o.outcome || "").filter(Boolean);
}

export function checkSafeModeExitConditions(params: {
  volatilityIndex: number;
  volatilityThreshold: number;
  guardrailTriggers24h: number;
  driftFlag: boolean;
  last2Outcomes: string[];
}): { canExit: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (params.volatilityIndex >= params.volatilityThreshold) {
    reasons.push(`Volatility ${params.volatilityIndex.toFixed(3)} still above threshold ${params.volatilityThreshold}`);
  }

  if (params.guardrailTriggers24h > 0) {
    reasons.push(`${params.guardrailTriggers24h} guardrail trigger(s) in last 24h`);
  }

  if (params.driftFlag) {
    reasons.push("Sustained drift still detected");
  }

  const hasFailures = params.last2Outcomes.some(o => o === "failure");
  if (params.last2Outcomes.length >= 2 && hasFailures) {
    reasons.push("Recent decision outcomes include failures");
  } else if (params.last2Outcomes.length < 2) {
  }

  return {
    canExit: reasons.length === 0,
    reasons,
  };
}
