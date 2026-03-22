import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { accountState, guardrailConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { FeatureFlagService } from "../feature-flags";
import { getWeeklyTokenUsage, WEEKLY_TOKEN_BUDGET } from "../ai-client";

export type GateResult = { passed: boolean; reason: string };

export async function gateAutopilotEnabled(accountId: string): Promise<GateResult> {
  const acct = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);
  if (!acct[0]?.autopilotOn) {
    return { passed: false, reason: "Autopilot is disabled for this account" };
  }
  return { passed: true, reason: "" };
}

export async function gateNotSafeMode(accountId: string): Promise<GateResult> {
  const acct = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);
  if (acct[0]?.state === "SAFE_MODE") {
    return { passed: false, reason: "Account is in SAFE_MODE — no autonomous actions allowed" };
  }
  return { passed: true, reason: "" };
}

export async function gateAIBudget(accountId: string): Promise<GateResult> {
  const usage = await getWeeklyTokenUsage(accountId);
  if (usage >= WEEKLY_TOKEN_BUDGET) {
    return { passed: false, reason: `Weekly AI token budget exceeded (${usage}/${WEEKLY_TOKEN_BUDGET})` };
  }
  return { passed: true, reason: "" };
}

export async function gateFeatureFlag(accountId: string, flagName: string): Promise<GateResult> {
  const flagService = new FeatureFlagService();
  const flags = await flagService.getAllFlags(accountId);
  const flagValue = (flags as any)[flagName];
  if (!flagValue) {
    return { passed: false, reason: `Feature flag '${flagName}' is disabled` };
  }
  return { passed: true, reason: "" };
}

export async function gateLeadEngineActive(accountId: string): Promise<GateResult> {
  const flagService = new FeatureFlagService();
  const flags = await flagService.getAllFlags(accountId);
  if (flags.lead_engine_global_off) {
    return { passed: false, reason: "Lead engine is globally disabled (kill switch active)" };
  }
  return { passed: true, reason: "" };
}

export async function gateConfidenceAbove(accountId: string, threshold: number): Promise<GateResult> {
  const acct = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);
  const score = acct[0]?.confidenceScore || 0;
  if (score < threshold) {
    return { passed: false, reason: `Confidence score ${score} below threshold ${threshold}` };
  }
  return { passed: true, reason: "" };
}

export async function runGates(accountId: string, gates: Array<() => Promise<GateResult>>): Promise<{ allPassed: boolean; results: GateResult[] }> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const result = await gate();
    results.push(result);
    if (!result.passed) {
      return { allPassed: false, results };
    }
  }
  return { allPassed: true, results };
}

export function requireGates(...gates: Array<(accountId: string) => Promise<GateResult>>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const accountId = (req as any).accountId || "default";
    for (const gate of gates) {
      const result = await gate(accountId);
      if (!result.passed) {
        res.status(403).json({ error: result.reason, gate: "blocked" });
        return;
      }
    }
    next();
  };
}
