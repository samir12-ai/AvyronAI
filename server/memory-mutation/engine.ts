import { db } from "../db";
import { strategyMemory, contentPerformanceSnapshots } from "@shared/schema";
import { eq, and, lt, desc, isNotNull } from "drizzle-orm";
import { makeStrategyFingerprint } from "../memory-system/manager";
import { checkResultsOverrideMemory } from "../orchestrator/memory-context";
import type { MemoryClass, MemoryDirection, MemorySlot, PerformanceSnapshot } from "../memory-system/types";

const DECAY_HALF_LIFE_DAYS = 30;
const DECAY_THRESHOLD = 0.05;

interface MemoryMutationEntry {
  engineName: string;
  memoryType: MemoryClass;
  label: string;
  details?: string | null;
  confidenceScore?: number;
  direction?: "reinforce" | "avoid" | "neutral";
  isWinner?: boolean;
  planId?: string | null;
}

function computeDecay(score: number, daysSinceUpdate: number): number {
  const halfLifeFactor = Math.pow(0.5, daysSinceUpdate / DECAY_HALF_LIFE_DAYS);
  return score * halfLifeFactor;
}

export async function applyMemoryMutation(
  campaignId: string,
  accountId: string,
  entries: MemoryMutationEntry[],
  planId: string,
): Promise<{ written: number; updated: number; decayed: number }> {
  let written = 0;
  let updated = 0;
  let decayed = 0;

  for (const entry of entries) {
    const fingerprint = makeStrategyFingerprint(entry.engineName, entry.label, entry.details);
    const confidence = entry.confidenceScore ?? 0;

    const existing = await db
      .select()
      .from(strategyMemory)
      .where(
        and(
          eq(strategyMemory.accountId, accountId),
          eq(strategyMemory.campaignId, campaignId),
          eq(strategyMemory.strategyFingerprint, fingerprint),
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const prev = existing[0];
      const daysSince = prev.updatedAt
        ? (Date.now() - prev.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      const blendedScore = prev.score !== null
        ? 0.6 * (prev.score ?? 0) + 0.4 * confidence
        : confidence;

      const updatedDirection: "reinforce" | "avoid" | "neutral" = entry.direction
        ?? (entry.isWinner === true ? "reinforce" : entry.isWinner === false ? "avoid" : undefined)
        ?? (prev.direction as "reinforce" | "avoid" | "neutral" | undefined)
        ?? "neutral";
      const updatedIsWinner = updatedDirection === "reinforce";
      const updatedConfidence = entry.confidenceScore
        ?? (updatedDirection === "reinforce" ? 0.85 : updatedDirection === "avoid" ? 0.15 : 0.5);
      await db
        .update(strategyMemory)
        .set({
          label: entry.label,
          details: entry.details ?? prev.details,
          score: blendedScore,
          isWinner: updatedIsWinner,
          confidenceScore: updatedConfidence,
          direction: updatedDirection,
          lastValidatedAt: new Date(),
          planId: planId,
          usageCount: (prev.usageCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(strategyMemory.id, prev.id));
      updated++;
    } else {
      const memId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      const insertDirection: "reinforce" | "avoid" | "neutral" = entry.direction
        ?? (entry.isWinner === true ? "reinforce" : entry.isWinner === false ? "avoid" : undefined)
        ?? "neutral";
      const insertIsWinner = insertDirection === "reinforce";
      const insertConfidence = entry.confidenceScore
        ?? (insertDirection === "reinforce" ? 0.85 : insertDirection === "avoid" ? 0.15 : 0.5);
      await db.insert(strategyMemory).values({
        id: memId,
        accountId,
        campaignId,
        memoryType: entry.memoryType,
        engineName: entry.engineName,
        label: entry.label,
        details: entry.details ?? null,
        score: confidence,
        isWinner: insertIsWinner,
        confidenceScore: insertConfidence,
        direction: insertDirection,
        lastValidatedAt: new Date(),
        planId,
        strategyFingerprint: fingerprint,
      });
      written++;
    }
  }

  decayed = await applyConfidenceDecay(campaignId, accountId);

  console.log(`[MemoryMutation] written=${written} updated=${updated} decayed=${decayed} | campaign=${campaignId}`);
  return { written, updated, decayed };
}

async function applyConfidenceDecay(campaignId: string, accountId: string): Promise<number> {
  const staleThreshold = new Date(Date.now() - DECAY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);

  const staleRows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        lt(strategyMemory.updatedAt, staleThreshold),
      )
    );

  let decayed = 0;
  for (const row of staleRows) {
    if (!row.updatedAt || (row.score ?? 0) < DECAY_THRESHOLD) continue;
    const daysSince = (Date.now() - row.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    const newScore = computeDecay(row.score ?? 0, daysSince);

    if (newScore < DECAY_THRESHOLD) {
      await db
        .update(strategyMemory)
        .set({ score: 0, isWinner: false, confidenceScore: 0.1, direction: "neutral", updatedAt: new Date() })
        .where(eq(strategyMemory.id, row.id));
    } else {
      const decayedConfidence = Math.max(0, Math.min(1, newScore));
      await db
        .update(strategyMemory)
        .set({ score: newScore, confidenceScore: decayedConfidence, updatedAt: new Date() })
        .where(eq(strategyMemory.id, row.id));
    }
    decayed++;
  }

  return decayed;
}

export async function recordWinnerMemory(
  campaignId: string,
  accountId: string,
  entry: MemoryMutationEntry,
  planId: string,
): Promise<void> {
  await applyMemoryMutation(campaignId, accountId, [{ ...entry, direction: "reinforce", isWinner: true, confidenceScore: entry.confidenceScore ?? 0.85 }], planId);
}

export async function recordAvoidMemory(
  campaignId: string,
  accountId: string,
  entry: MemoryMutationEntry,
  planId: string,
): Promise<void> {
  await applyMemoryMutation(campaignId, accountId, [{ ...entry, direction: "avoid", isWinner: false, confidenceScore: entry.confidenceScore ?? 0.15 }], planId);
}

const FORMAT_KEYWORDS: Record<string, string[]> = {
  reel: ["reel", "reels", "video reel", "short video"],
  carousel: ["carousel", "carousels", "slide", "slides", "swipe"],
  story: ["story", "stories"],
  post: ["post", "posts", "static post", "image post"],
};

const MIN_PERIODS_FOR_CONFIDENCE_MOVE = 2;
const MIN_PERIODS_FOR_FLIP = 3;
const BELOW_BASELINE_THRESHOLD = 0.15;
const CONFIDENCE_INCREMENT = 0.05;
const FLIP_RESET_CONFIDENCE = 0.35;
const DECAY_NEUTRAL_THRESHOLD = 0.1;
const INDUSTRY_BASELINE_DEFAULT = 0.5;
const MAX_SNAPSHOTS = 4;

interface MutationSummary {
  confirmed: number;
  challenged: number;
  flipped: Array<{ label: string; from: MemoryDirection; to: MemoryDirection }>;
  decayed: number;
  totalProcessed: number;
}

export interface MemoryMutationResult {
  summary: MutationSummary;
  logEntryId: string;
}

export interface MemoryHealthSummary {
  totalActive: number;
  highConfidenceCount: number;
  challengedCount: number;
  recentlyDecayed: number;
  recentFlips: Array<{ label: string; from: string; to: string }>;
  lastMutationRunAt: Date | null;
}

function detectContentFormat(slot: { label: string; details: string | null }): string | null {
  const lbl = ((slot.label ?? "") + " " + (slot.details ?? "")).toLowerCase();
  for (const [fmt, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some((k) => lbl.includes(k))) return fmt;
  }
  return null;
}

function toPerformanceSnapshots(
  rows: Array<{ smoothedPerformanceScore: number | null; createdAt: Date | null }>,
  industryBaseline: number,
): PerformanceSnapshot[] {
  return rows.map((r) => ({
    contentFormat: "unknown",
    performanceScore: r.smoothedPerformanceScore ?? 0,
    industryBaselineScore: industryBaseline,
    recordedAt: r.createdAt ?? new Date(),
  }));
}

function countConsecutiveConfirmed(
  scores: number[],
  industryBaseline: number,
  direction: "above" | "below",
  thresholdFraction: number = 0,
): number {
  let count = 0;
  for (const score of scores) {
    const threshold =
      direction === "above"
        ? industryBaseline * (1 + thresholdFraction)
        : industryBaseline * (1 - thresholdFraction);
    const passes = direction === "above" ? score >= threshold : score < threshold;
    if (passes) count++;
    else break;
  }
  return count;
}

export async function runMemoryMutation(
  accountId: string,
  campaignId: string,
): Promise<MemoryMutationResult> {
  const memoryRows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        isNotNull(strategyMemory.direction),
        isNotNull(strategyMemory.confidenceScore),
      ),
    )
    .orderBy(desc(strategyMemory.createdAt));

  const eligible = memoryRows.filter(
    (r) =>
      r.direction !== null &&
      r.direction !== "neutral" &&
      r.memoryType !== "mutation_log",
  );

  const summary: MutationSummary = {
    confirmed: 0,
    challenged: 0,
    flipped: [],
    decayed: 0,
    totalProcessed: eligible.length,
  };

  const validatedIds = new Set<string>();

  for (const row of eligible) {
    const fmt = detectContentFormat({ label: row.label, details: row.details ?? null });
    if (!fmt) continue;

    const recentSnaps = await db
      .select({
        smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore,
        createdAt: contentPerformanceSnapshots.createdAt,
      })
      .from(contentPerformanceSnapshots)
      .where(
        and(
          eq(contentPerformanceSnapshots.accountId, accountId),
          eq(contentPerformanceSnapshots.campaignId, campaignId),
          eq(contentPerformanceSnapshots.contentType, fmt),
        ),
      )
      .orderBy(desc(contentPerformanceSnapshots.createdAt))
      .limit(MAX_SNAPSHOTS);

    if (recentSnaps.length < MIN_PERIODS_FOR_CONFIDENCE_MOVE) continue;

    validatedIds.add(row.id);

    const scores = recentSnaps.map((s) => s.smoothedPerformanceScore ?? 0);
    const currentDirection = (row.direction ?? "neutral") as MemoryDirection;
    const currentConfidence = row.confidenceScore ?? 0.5;
    const currentValidationCount = row.validationCount ?? 0;

    if (currentDirection === "reinforce") {
      const consistentAbove = countConsecutiveConfirmed(scores, INDUSTRY_BASELINE_DEFAULT, "above");
      const challengedPeriods = countConsecutiveConfirmed(
        scores,
        INDUSTRY_BASELINE_DEFAULT,
        "below",
        BELOW_BASELINE_THRESHOLD,
      );

      if (consistentAbove >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        const newConfidence = Math.min(1.0, currentConfidence + CONFIDENCE_INCREMENT * consistentAbove);
        await db
          .update(strategyMemory)
          .set({
            confidenceScore: newConfidence,
            validationCount: currentValidationCount + consistentAbove,
            lastValidatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(strategyMemory.id, row.id));
        summary.confirmed++;
      } else if (challengedPeriods >= MIN_PERIODS_FOR_FLIP) {
        await db
          .update(strategyMemory)
          .set({
            direction: "avoid",
            isWinner: false,
            confidenceScore: FLIP_RESET_CONFIDENCE,
            lastValidatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(strategyMemory.id, row.id));
        summary.flipped.push({ label: row.label, from: "reinforce", to: "avoid" });
        summary.challenged++;
      } else if (challengedPeriods >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        summary.challenged++;
      }
    } else if (currentDirection === "avoid") {
      const perfSnaps = toPerformanceSnapshots(recentSnaps, INDUSTRY_BASELINE_DEFAULT);
      const overrideResult = checkResultsOverrideMemory(
        row as unknown as MemorySlot,
        perfSnaps,
      );

      const consistentBelow = countConsecutiveConfirmed(scores, INDUSTRY_BASELINE_DEFAULT, "below");

      if (overrideResult.override) {
        await db
          .update(strategyMemory)
          .set({
            direction: "reinforce",
            isWinner: true,
            confidenceScore: FLIP_RESET_CONFIDENCE,
            lastValidatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(strategyMemory.id, row.id));
        summary.flipped.push({ label: row.label, from: "avoid", to: "reinforce" });
        summary.confirmed++;
      } else if (consistentBelow >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        const newConfidence = Math.min(1.0, currentConfidence + CONFIDENCE_INCREMENT * consistentBelow);
        await db
          .update(strategyMemory)
          .set({
            confidenceScore: newConfidence,
            validationCount: currentValidationCount + consistentBelow,
            lastValidatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(strategyMemory.id, row.id));
        summary.confirmed++;
      }
    }
  }

  for (const row of eligible) {
    if (validatedIds.has(row.id)) continue;
    const currentConfidence = row.confidenceScore ?? 0.5;
    const decayRate = row.decayRate ?? 0.95;
    const effectiveConfidence = currentConfidence * decayRate;

    if (effectiveConfidence < DECAY_NEUTRAL_THRESHOLD) {
      await db
        .update(strategyMemory)
        .set({
          confidenceScore: effectiveConfidence,
          direction: "neutral",
          isWinner: false,
          updatedAt: new Date(),
        })
        .where(eq(strategyMemory.id, row.id));
      summary.decayed++;
    } else {
      await db
        .update(strategyMemory)
        .set({ confidenceScore: effectiveConfidence, updatedAt: new Date() })
        .where(eq(strategyMemory.id, row.id));
    }
  }

  const logId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const logDetails = JSON.stringify({
    confirmed: summary.confirmed,
    challenged: summary.challenged,
    flipped: summary.flipped,
    decayed: summary.decayed,
    totalProcessed: summary.totalProcessed,
    runAt: new Date().toISOString(),
  });

  await db.insert(strategyMemory).values({
    id: logId,
    accountId,
    campaignId,
    memoryType: "mutation_log",
    label: `Mutation — ${summary.confirmed} confirmed, ${summary.challenged} challenged, ${summary.flipped.length} flipped, ${summary.decayed} decayed`,
    details: logDetails,
    score: 0,
    isWinner: false,
    direction: "neutral",
    confidenceScore: 1.0,
    decayRate: 1.0,
    validationCount: 0,
  });

  console.log(
    `[MemoryMutation] RUN_COMPLETE | account=${accountId} campaign=${campaignId} | processed=${summary.totalProcessed} confirmed=${summary.confirmed} challenged=${summary.challenged} flipped=${summary.flipped.length} decayed=${summary.decayed}`,
  );

  return { summary, logEntryId: logId };
}

export async function getMemoryHealth(
  accountId: string,
  campaignId: string,
): Promise<MemoryHealthSummary> {
  const rows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
      ),
    )
    .orderBy(desc(strategyMemory.createdAt));

  const logEntry = rows.find((r) => r.memoryType === "mutation_log");
  const activeEntries = rows.filter(
    (r) => r.memoryType !== "mutation_log" && r.direction !== null && r.direction !== "neutral",
  );

  const highConfidenceCount = activeEntries.filter((r) => (r.confidenceScore ?? 0) > 0.7).length;

  let recentFlips: Array<{ label: string; from: string; to: string }> = [];
  let recentlyDecayed = 0;
  let lastMutationRunAt: Date | null = null;

  if (logEntry) {
    lastMutationRunAt = logEntry.createdAt ?? null;
    try {
      const parsed =
        typeof logEntry.details === "string" ? JSON.parse(logEntry.details) : logEntry.details;
      if (parsed?.flipped) recentFlips = parsed.flipped;
      if (typeof parsed?.decayed === "number") recentlyDecayed = parsed.decayed;
    } catch {}
  }

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  const challengedCount = activeEntries.filter((r) => {
    if (!r.lastValidatedAt) return false;
    return r.lastValidatedAt < fourWeeksAgo;
  }).length;

  return {
    totalActive: activeEntries.length,
    highConfidenceCount,
    challengedCount,
    recentlyDecayed,
    recentFlips,
    lastMutationRunAt,
  };
}
