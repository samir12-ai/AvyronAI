import { loadMemoryBlock, serializeMemoryBlockForPrompt, makeStrategyFingerprint } from "../memory-system/manager";
import type { MemoryBlock, MemorySlot, MemoryContext, PerformanceSnapshot, ResultsOverrideResult } from "../memory-system/types";

const FORMAT_KEYWORDS: Record<string, string[]> = {
  reels: ["reel", "reels", "video reel", "short video"],
  carousels: ["carousel", "carousels", "slide", "slides", "swipe"],
  stories: ["story", "stories"],
  posts: ["post", "posts", "static post", "image post"],
};

export interface FormatConstraints {
  boostedFormats: string[];
  reducedFormats: string[];
  reason: Record<string, string>;
}

export interface MemoryOverride {
  field: string;
  originalValue: number;
  correctedValue: number;
  memoryLabel: string;
}

export function extractFormatConstraints(block: MemoryBlock): FormatConstraints {
  const boostedFormats: string[] = [];
  const reducedFormats: string[] = [];
  const reason: Record<string, string> = {};

  for (const slot of block.reinforceSlots) {
    if (!slot.isWinner || slot.score === 0) continue;
    const lbl = (slot.label + " " + (slot.details ?? "")).toLowerCase();
    for (const [fmt, keywords] of Object.entries(FORMAT_KEYWORDS)) {
      if (keywords.some(k => lbl.includes(k)) && !boostedFormats.includes(fmt)) {
        boostedFormats.push(fmt);
        reason[fmt] = slot.label;
      }
    }
  }

  for (const slot of block.avoidSlots) {
    if (slot.isWinner || slot.score >= 0) continue;
    const lbl = (slot.label + " " + (slot.details ?? "")).toLowerCase();
    for (const [fmt, keywords] of Object.entries(FORMAT_KEYWORDS)) {
      if (keywords.some(k => lbl.includes(k)) && !reducedFormats.includes(fmt)) {
        reducedFormats.push(fmt);
        reason[fmt] = slot.label;
      }
    }
  }

  return { boostedFormats, reducedFormats, reason };
}

const MAX_DELTA = 2;

function clampedAdjust(value: number, delta: number, min: number = 0): number {
  return Math.max(min, value + Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta)));
}

type FormatDistribution = {
  reelsPerWeek?: number;
  carouselsPerWeek?: number;
  storiesPerDay?: number;
  postsPerWeek?: number;
};

type FormatDistributionKey = keyof FormatDistribution;

function setDistributionField(
  result: FormatDistribution,
  key: FormatDistributionKey,
  value: number,
): void {
  result[key] = value;
}

export function applyMemoryConstraints<T extends FormatDistribution>(
  distribution: T,
  block: MemoryBlock,
  baseline?: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number } | null,
): { adjusted: T; overrides: MemoryOverride[] } {
  const constraints = extractFormatConstraints(block);
  const overrides: MemoryOverride[] = [];
  const result: T = { ...distribution };

  const base: Required<FormatDistribution> = baseline ?? {
    reelsPerWeek: 3,
    carouselsPerWeek: 2,
    storiesPerDay: 2,
    postsPerWeek: 3,
  };

  const fmtToFieldKey: Record<string, FormatDistributionKey> = {
    reels: "reelsPerWeek",
    carousels: "carouselsPerWeek",
    stories: "storiesPerDay",
    posts: "postsPerWeek",
  };

  for (const fmt of constraints.reducedFormats) {
    const fieldKey = fmtToFieldKey[fmt];
    if (!fieldKey) continue;

    const current = result[fieldKey] ?? base[fieldKey];
    const baselineVal = base[fieldKey];

    if (current > baselineVal) {
      const corrected = clampedAdjust(current, -(current - baselineVal), 0);
      if (corrected !== current) {
        setDistributionField(result, fieldKey, corrected);
        overrides.push({ field: fieldKey, originalValue: current, correctedValue: corrected, memoryLabel: constraints.reason[fmt] });
      }
    }
  }

  for (const fmt of constraints.boostedFormats) {
    const fieldKey = fmtToFieldKey[fmt];
    if (!fieldKey) continue;

    const current = result[fieldKey] ?? base[fieldKey];
    const baselineVal = base[fieldKey];

    if (current < baselineVal) {
      const corrected = clampedAdjust(current, baselineVal - current, 0);
      if (corrected !== current) {
        setDistributionField(result, fieldKey, corrected);
        overrides.push({ field: fieldKey, originalValue: current, correctedValue: corrected, memoryLabel: constraints.reason[fmt] });
      }
    }
  }

  return { adjusted: result, overrides };
}

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
  const base = serializeMemoryBlockForPrompt(block);
  if (!base) return base;
  return `[MEMORY SYSTEM — HARD CONSTRAINTS]\nThe following content format rules are already applied to your output by the system. Your generated content format allocations (reels, carousels, stories, posts/week) must not contradict these constraints — they are hard limits enforced at the system level and will be reflected in the final plan:\n\n${base}`;
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
