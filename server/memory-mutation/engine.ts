import { db } from "../db";
import { strategyMemory } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { makeStrategyFingerprint } from "../memory-system/manager";
import type { MemoryClass } from "../memory-system/types";

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
