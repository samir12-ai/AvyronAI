/**
 * Task #64 / Phase 1 — mutation_log dedicated store.
 *
 * Replaces the legacy `db.insert(strategyMemory).values({ memoryType: "mutation_log" })`
 * pattern in memory-mutation/engine.ts. The audit log no longer pollutes
 * strategy_memory; readers (getMemoryHealth, system-control full-report)
 * query mutation_log directly.
 */
import { db } from "../db";
import { mutationLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface MutationLogEntry {
  accountId: string;
  campaignId: string;
  label: string;
  confirmedCount: number;
  challengedCount: number;
  flippedCount: number;
  decayedCount: number;
  totalProcessed: number;
  challengedIds: string[];
  flipped: Array<{ label: string; from: string; to: string }>;
}

export async function recordMutationRun(entry: MutationLogEntry): Promise<string> {
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  await db.insert(mutationLog).values({
    id,
    accountId: entry.accountId,
    campaignId: entry.campaignId,
    label: entry.label,
    confirmedCount: entry.confirmedCount,
    challengedCount: entry.challengedCount,
    flippedCount: entry.flippedCount,
    decayedCount: entry.decayedCount,
    totalProcessed: entry.totalProcessed,
    challengedIds: entry.challengedIds,
    flipped: entry.flipped,
    runAt: new Date(),
  });
  return id;
}

export async function getLatestMutationRun(
  accountId: string,
  campaignId: string,
): Promise<typeof mutationLog.$inferSelect | null> {
  const rows = await db
    .select()
    .from(mutationLog)
    .where(and(eq(mutationLog.accountId, accountId), eq(mutationLog.campaignId, campaignId)))
    .orderBy(desc(mutationLog.createdAt))
    .limit(1);
  return rows[0] ?? null;
}
