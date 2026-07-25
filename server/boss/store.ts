/**
 * Phase 3 — boss_runs persistence helpers.
 */
import { db } from "../db";
import { bossRuns } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import type { BossRun } from "@shared/schema";

export function newBossRunId(): string {
  return `boss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function insertBossRun(row: typeof bossRuns.$inferInsert): Promise<BossRun> {
  const [r] = await db.insert(bossRuns).values(row).returning();
  return r;
}

export async function updateBossRun(
  id: string,
  patch: Partial<typeof bossRuns.$inferInsert>,
): Promise<void> {
  await db.update(bossRuns).set(patch).where(eq(bossRuns.id, id));
}

export async function getBossRun(id: string): Promise<BossRun | null> {
  const [row] = await db.select().from(bossRuns).where(eq(bossRuns.id, id));
  return row ?? null;
}

export async function listBossRuns(filters: {
  accountId?: string;
  campaignId?: string;
  status?: string;
  limit?: number;
}): Promise<BossRun[]> {
  const wh = [];
  if (filters.accountId) wh.push(eq(bossRuns.accountId, filters.accountId));
  if (filters.campaignId) wh.push(eq(bossRuns.campaignId, filters.campaignId));
  if (filters.status) wh.push(eq(bossRuns.status, filters.status));
  const q = db.select().from(bossRuns);
  const rows = wh.length ? await q.where(and(...wh)).orderBy(desc(bossRuns.createdAt)).limit(filters.limit ?? 50)
                         : await q.orderBy(desc(bossRuns.createdAt)).limit(filters.limit ?? 50);
  return rows;
}
