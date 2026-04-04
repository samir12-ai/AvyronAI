import { loadMemoryBlock, serializeMemoryBlockForPrompt, makeStrategyFingerprint } from "../memory-system/manager";
import type { MemoryBlock, MemorySlot, MemoryContext, PerformanceSnapshot, ResultsOverrideResult } from "../memory-system/types";

export type { MemoryBlock as MemoryConstraintBlock, MemorySlot as MemoryEntry };

export async function buildMemoryContext(
  campaignId: string,
  accountId: string,
  bizData?: { funnelObjective?: string; businessType?: string; monthlyBudget?: string } | null,
  memoryContext?: MemoryContext | null,
): Promise<MemoryBlock> {
  return loadMemoryBlock(campaignId, accountId, bizData, memoryContext);
}

export function serializeMemoryContextForPrompt(block: MemoryBlock): string {
  return serializeMemoryBlockForPrompt(block);
}

export { makeStrategyFingerprint };

const INDUSTRY_BASELINE_IMPROVEMENT_THRESHOLD = 0.20;
const CONSECUTIVE_SNAPSHOTS_REQUIRED = 3;

export function checkResultsOverrideMemory(
  memoryEntry: MemorySlot,
  recentSnapshots: PerformanceSnapshot[],
): ResultsOverrideResult {
  if (memoryEntry.direction !== "avoid") {
    return {
      override: false,
      reason: "Entry is not marked avoid — no override evaluation needed.",
      newConfidenceDirection: memoryEntry.direction,
    };
  }

  if (recentSnapshots.length < CONSECUTIVE_SNAPSHOTS_REQUIRED) {
    return {
      override: false,
      reason: `Insufficient data: need ${CONSECUTIVE_SNAPSHOTS_REQUIRED} consecutive snapshots, only ${recentSnapshots.length} available.`,
      newConfidenceDirection: memoryEntry.direction,
    };
  }

  const sorted = recentSnapshots
    .slice()
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
    .slice(0, CONSECUTIVE_SNAPSHOTS_REQUIRED);

  let consecutiveOverperformCount = 0;
  for (const snap of sorted) {
    const baseline = snap.industryBaselineScore ?? 0.5;
    const threshold = baseline * (1 + INDUSTRY_BASELINE_IMPROVEMENT_THRESHOLD);
    if (snap.performanceScore > threshold) {
      consecutiveOverperformCount++;
    }
  }

  if (consecutiveOverperformCount >= CONSECUTIVE_SNAPSHOTS_REQUIRED) {
    const avgScore = sorted.reduce((sum, s) => sum + s.performanceScore, 0) / sorted.length;
    const avgBaseline = sorted.reduce((sum, s) => sum + (s.industryBaselineScore ?? 0.5), 0) / sorted.length;
    const improvementPct = Math.round(((avgScore - avgBaseline) / avgBaseline) * 100);

    return {
      override: true,
      reason: `Results override: "${memoryEntry.label}" was marked avoid but has outperformed industry baseline by ${improvementPct}% across ${CONSECUTIVE_SNAPSHOTS_REQUIRED} consecutive snapshots. Direction flip warranted.`,
      newConfidenceDirection: "reinforce",
    };
  }

  return {
    override: false,
    reason: `No override: only ${consecutiveOverperformCount}/${CONSECUTIVE_SNAPSHOTS_REQUIRED} consecutive snapshots exceeded baseline threshold.`,
    newConfidenceDirection: memoryEntry.direction,
  };
}
