import { db } from "../db";
import { strategyMemory, contentPerformanceSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { MemoryBlock } from "../memory-system/types";

export interface ExplorationBudget {
  explorationRate: number;
  exploitationRate: number;
  explorationSlots: number;
  totalWeeklySlots: number;
  rationale: string;
  confidenceScore: number;
  basis: "performance_driven" | "memory_driven" | "default";
}

const MIN_EXPLORATION_RATE = 0.10;
const MAX_EXPLORATION_RATE = 0.40;
const DEFAULT_EXPLORATION_RATE = 0.20;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function explorationRateFromConfidence(avgConfidence: number): number {
  if (avgConfidence >= 0.8) return 0.10;
  if (avgConfidence >= 0.6) return 0.15;
  if (avgConfidence >= 0.4) return 0.20;
  if (avgConfidence >= 0.2) return 0.30;
  return 0.40;
}

export async function computeExplorationBudget(
  campaignId: string,
  accountId: string,
  memoryBlock: MemoryBlock,
  totalWeeklySlots: number,
): Promise<ExplorationBudget> {

  const reinforceSlots = memoryBlock.reinforceSlots;
  const avoidSlots = memoryBlock.avoidSlots;

  const perfSnapshots = await db
    .select()
    .from(contentPerformanceSnapshots)
    .where(
      and(
        eq(contentPerformanceSnapshots.accountId, accountId),
        eq(contentPerformanceSnapshots.campaignId, campaignId),
      )
    )
    .orderBy(desc(contentPerformanceSnapshots.createdAt))
    .limit(10);

  let explorationRate = DEFAULT_EXPLORATION_RATE;
  let basis: "performance_driven" | "memory_driven" | "default" = "default";
  let rationale = "No performance data or memory context — using default 20% exploration.";

  if (perfSnapshots.length >= 2) {
    const avgSmoothed = perfSnapshots.reduce((sum, s) => sum + (s.smoothedPerformanceScore ?? 0), 0) / perfSnapshots.length;

    if (avgSmoothed >= 0.75) {
      explorationRate = 0.10;
      rationale = `High performance (avg score ${avgSmoothed.toFixed(2)}) — exploit proven patterns, minimal exploration.`;
    } else if (avgSmoothed >= 0.50) {
      explorationRate = 0.20;
      rationale = `Moderate performance (avg score ${avgSmoothed.toFixed(2)}) — balanced exploration.`;
    } else if (avgSmoothed >= 0.25) {
      explorationRate = 0.30;
      rationale = `Below-average performance (avg score ${avgSmoothed.toFixed(2)}) — increase exploration.`;
    } else {
      explorationRate = 0.40;
      rationale = `Low performance (avg score ${avgSmoothed.toFixed(2)}) — maximize exploration to find better patterns.`;
    }
    basis = "performance_driven";
  } else if (reinforceSlots.length > 0) {
    const avgConf = reinforceSlots.reduce((s, r) => s + r.confidenceScore, 0) / reinforceSlots.length;
    explorationRate = explorationRateFromConfidence(avgConf);
    rationale = `Memory-driven: ${reinforceSlots.length} reinforced patterns (avg confidence ${avgConf.toFixed(2)}) — exploration at ${Math.round(explorationRate * 100)}%.`;
    basis = "memory_driven";
  }

  if (avoidSlots.length > 0) {
    explorationRate = clamp(explorationRate + 0.05 * Math.min(3, avoidSlots.length), MIN_EXPLORATION_RATE, MAX_EXPLORATION_RATE);
    rationale += ` ${avoidSlots.length} avoid-patterns detected — exploration slightly increased.`;
  }

  explorationRate = clamp(explorationRate, MIN_EXPLORATION_RATE, MAX_EXPLORATION_RATE);
  const exploitationRate = 1 - explorationRate;
  const explorationSlots = Math.max(1, Math.round(totalWeeklySlots * explorationRate));
  const confidenceScore = basis === "performance_driven" ? 0.8 : basis === "memory_driven" ? 0.55 : 0.3;

  await persistExplorationBudget(campaignId, accountId, {
    explorationRate, exploitationRate, explorationSlots, totalWeeklySlots, rationale, confidenceScore, basis,
  });

  console.log(`[ExplorationBudget] campaign=${campaignId} rate=${explorationRate.toFixed(2)} slots=${explorationSlots}/${totalWeeklySlots} basis=${basis}`);

  return { explorationRate, exploitationRate, explorationSlots, totalWeeklySlots, rationale, confidenceScore, basis };
}

async function persistExplorationBudget(
  campaignId: string,
  accountId: string,
  budget: ExplorationBudget,
): Promise<void> {
  const label = `Exploration ${Math.round(budget.explorationRate * 100)}% / Exploitation ${Math.round(budget.exploitationRate * 100)}%`;
  const details = JSON.stringify({
    explorationSlots: budget.explorationSlots,
    totalWeeklySlots: budget.totalWeeklySlots,
    basis: budget.basis,
    rationale: budget.rationale,
  });

  const existing = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        eq(strategyMemory.memoryType, "exploration_budget"),
        eq(strategyMemory.engineName, "exploration-budget"),
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(strategyMemory)
      .set({ label, details, score: budget.confidenceScore, performance: budget.rationale, updatedAt: new Date() })
      .where(eq(strategyMemory.id, existing[0].id));
  } else {
    const memId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await db.insert(strategyMemory).values({
      id: memId,
      accountId,
      campaignId,
      memoryType: "exploration_budget",
      engineName: "exploration-budget",
      label,
      details,
      performance: budget.rationale,
      score: budget.confidenceScore,
      isWinner: false,
    });
  }
}
