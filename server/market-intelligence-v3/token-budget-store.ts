/**
 * Seal #11 / Task #29 / F6.1 — Cross-process token-budget persistence.
 *
 * Pre-fix: token-budget.ts was a pure in-memory function. Each call
 * recomputed the projection from competitor/comment/post counts. If the
 * worker crashed mid-run and restarted, the recomputed projection (now
 * against partial data, since some scrapes had already landed) could pick
 * a DIFFERENT selectedMode than the original run — silently downgrading
 * a FULL run to REDUCED, or vice-versa. There was no shared truth across
 * processes either: two workers operating on the same job concurrently
 * could pick different modes.
 *
 * Now: budgets are persisted to `ai_token_budget` keyed by (jobId, provider).
 * `getOrComputeBudget()` is a read-through cache — the FIRST writer wins
 * via INSERT … ON CONFLICT DO NOTHING, all subsequent callers (including
 * a restarted worker) read the same row. Rows expire after 7d; the
 * snapshot-cleanup-worker sweeps them.
 */
import { db } from "../db";
import { aiTokenBudget } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";
import type { TokenBudgetEstimate } from "./types";
import { computeTokenBudget } from "./token-budget";

export interface TokenBudgetKey {
  jobId: string;
  provider: string;
}

export interface BudgetInputs {
  competitorCount: number;
  totalComments: number;
  totalPosts: number;
}

export async function loadTokenBudget(
  key: TokenBudgetKey,
): Promise<TokenBudgetEstimate | null> {
  try {
    const [row] = await db
      .select()
      .from(aiTokenBudget)
      .where(and(eq(aiTokenBudget.jobId, key.jobId), eq(aiTokenBudget.provider, key.provider)))
      .limit(1);
    if (!row) return null;
    return {
      projectedTokens: row.projectedTokens,
      ceiling: row.ceiling,
      selectedMode: row.selectedMode as TokenBudgetEstimate["selectedMode"],
      downgradeReason: row.downgradeReason,
    };
  } catch (err: any) {
    console.error(`[TokenBudgetStore] LOAD_ERROR | job=${key.jobId} | provider=${key.provider} | ${err?.message || err}`);
    return null;
  }
}

export async function persistTokenBudget(
  key: TokenBudgetKey,
  estimate: TokenBudgetEstimate,
): Promise<TokenBudgetEstimate> {
  try {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db
      .insert(aiTokenBudget)
      .values({
        jobId: key.jobId,
        provider: key.provider,
        projectedTokens: estimate.projectedTokens,
        ceiling: estimate.ceiling,
        selectedMode: estimate.selectedMode,
        downgradeReason: estimate.downgradeReason,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [aiTokenBudget.jobId, aiTokenBudget.provider],
      });
    // First-writer-wins. Re-read so callers get the canonical row even if
    // a concurrent process inserted first (their values, not ours, win).
    const loaded = await loadTokenBudget(key);
    return loaded ?? estimate;
  } catch (err: any) {
    console.error(`[TokenBudgetStore] PERSIST_ERROR | job=${key.jobId} | provider=${key.provider} | ${err?.message || err}`);
    return estimate;
  }
}

/**
 * Read-through compute. If a row exists for (jobId, provider) it wins.
 * Otherwise computes deterministically from inputs and persists.
 */
export async function getOrComputeBudget(
  key: TokenBudgetKey | null | undefined,
  inputs: BudgetInputs,
): Promise<TokenBudgetEstimate> {
  const fresh = computeTokenBudget(inputs.competitorCount, inputs.totalComments, inputs.totalPosts);
  if (!key || !key.jobId || !key.provider) return fresh;
  const existing = await loadTokenBudget(key);
  if (existing) {
    if (existing.selectedMode !== fresh.selectedMode) {
      console.log(`[TokenBudgetStore] CACHE_HIT_DIVERGED | job=${key.jobId} | provider=${key.provider} | persisted=${existing.selectedMode} | recomputed=${fresh.selectedMode} | usingPersisted`);
    }
    return existing;
  }
  return persistTokenBudget(key, fresh);
}

export async function purgeExpiredTokenBudgets(): Promise<number> {
  try {
    const now = new Date();
    const deleted = await db
      .delete(aiTokenBudget)
      .where(lt(aiTokenBudget.expiresAt, now))
      .returning({ jobId: aiTokenBudget.jobId });
    return deleted.length;
  } catch (err: any) {
    console.error(`[TokenBudgetStore] PURGE_ERROR | ${err?.message || err}`);
    return 0;
  }
}
