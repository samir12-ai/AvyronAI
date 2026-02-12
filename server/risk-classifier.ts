import type { GuardrailCheckResult } from "./guardrails";

export type RiskLevel = "low" | "medium" | "high";

interface DecisionInput {
  action: string;
  budgetAdjustment?: string | null;
  priority?: string | null;
  aiSuggestedRisk?: string | null;
}

interface AccountStateInput {
  state: string;
  volatilityIndex: number;
  driftFlag: boolean;
}

function parseBudgetChangePercent(budgetAdjustment: string | null | undefined): number {
  if (!budgetAdjustment) return 0;
  const match = budgetAdjustment.match(/[+-]?\d+(\.\d+)?%/);
  if (match) {
    return Math.abs(parseFloat(match[0]));
  }
  const numMatch = budgetAdjustment.match(/[+-]?\d+(\.\d+)?/);
  if (numMatch) {
    return Math.abs(parseFloat(numMatch[0]));
  }
  return 0;
}

function isScalingAction(action: string): boolean {
  const scalingKeywords = ["scale", "increase budget", "boost", "expand", "double", "triple", "ramp up"];
  const lower = action.toLowerCase();
  return scalingKeywords.some(k => lower.includes(k));
}

function isPauseAction(action: string): boolean {
  const pauseKeywords = ["pause", "stop", "halt", "suspend", "disable", "kill"];
  const lower = action.toLowerCase();
  return pauseKeywords.some(k => lower.includes(k));
}

function isCampaignLaunch(action: string): boolean {
  const launchKeywords = ["launch campaign", "new campaign", "create campaign", "start campaign"];
  const lower = action.toLowerCase();
  return launchKeywords.some(k => lower.includes(k));
}

function isCreativeRefresh(action: string): boolean {
  const refreshKeywords = ["refresh", "regenerate", "new hook", "new creative", "new angle", "new visual"];
  const lower = action.toLowerCase();
  return refreshKeywords.some(k => lower.includes(k));
}

export function classifyDecisionRisk(
  decision: DecisionInput,
  guardrailResult: GuardrailCheckResult,
  acctState: AccountStateInput
): { riskLevel: RiskLevel; reason: string; autoExecutable: boolean } {
  let risk: RiskLevel = "low";
  const reasons: string[] = [];

  const budgetPercent = parseBudgetChangePercent(decision.budgetAdjustment);

  if (budgetPercent > 30) {
    risk = "high";
    reasons.push(`Budget change ${budgetPercent}% > 30%`);
  } else if (budgetPercent > 15) {
    risk = "medium";
    reasons.push(`Budget change ${budgetPercent}% > 15%`);
  }

  if (isPauseAction(decision.action)) {
    if (risk === "low") risk = "high";
    reasons.push("Campaign pause action");
  }

  if (isCampaignLaunch(decision.action)) {
    if (risk === "low") risk = "medium";
    reasons.push("New campaign launch");
  }

  if (isScalingAction(decision.action) && budgetPercent > 15) {
    if (risk === "low") risk = "medium";
    reasons.push("Scaling action with significant budget increase");
  }

  if (isCreativeRefresh(decision.action) && budgetPercent <= 15) {
    risk = "low";
    reasons.push("Creative refresh with minimal budget impact");
  }

  if (!guardrailResult.overallEligible && risk === "low") {
    risk = "medium";
    reasons.push("Guardrail triggered — minimum risk elevated to MEDIUM");
  }

  if (acctState.state === "UNSTABLE" || acctState.state === "SAFE_MODE") {
    if (risk === "low") {
      risk = "medium";
      reasons.push(`Account in ${acctState.state} — risk floor at MEDIUM`);
    }
  }

  if (acctState.volatilityIndex > 0.35) {
    if (risk === "low") {
      risk = "medium";
      reasons.push("High volatility — risk bumped up");
    } else if (risk === "medium") {
      risk = "high";
      reasons.push("High volatility — risk bumped from MEDIUM to HIGH");
    }
  }

  if (acctState.driftFlag && isScalingAction(decision.action)) {
    if (risk === "low") risk = "medium";
    reasons.push("Baseline drift detected — scaling restricted");
  }

  let autoExecutable = false;
  if (risk === "low" && guardrailResult.overallEligible && acctState.state === "ACTIVE") {
    autoExecutable = true;
  }

  return {
    riskLevel: risk,
    reason: reasons.length > 0 ? reasons.join("; ") : "Default low-risk classification",
    autoExecutable,
  };
}
