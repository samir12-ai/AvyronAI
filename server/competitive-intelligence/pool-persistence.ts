/**
 * Pool persistence — T006 (2026-07). DB I/O for adaptive per-target backoff
 * state (table scrape_target_backoff, migration 038). Nothing else.
 *
 * Contract (architect-approved):
 *   - Write-through, FIRE-AND-FORGET, on transitions only (failure recorded,
 *     streak cleared). A persistence failure must NEVER block or fail a
 *     scrape (B3 safe degradation) — but it must be LOUD (NO SILENT CATCHES):
 *     `[ProxyPool] BACKOFF_PERSIST_FAILED` + failure counter.
 *   - Lazy hydration per (accountId, platform) guarded by a plain boolean
 *     flag — deliberately NO in-flight promise map (Seal #19 8-AUDIT gate
 *     avoidance). Duplicate concurrent hydration reads are idempotent:
 *     hydrateTargetState() never overwrites fresher live state.
 *   - Only cross-restart-meaningful rows are loaded: cooldown still in the
 *     future OR a non-zero streak recent enough to matter (streaks older than
 *     STALE_STREAK_MS hydrate as noise, not signal — skipped).
 */

import { and, eq, gt, isNotNull, or } from "drizzle-orm";
import { db } from "../db";
import { scrapeTargetBackoff } from "@shared/schema";
import { hydrateTargetState, type TargetBackoffState } from "./target-backoff";
import type { ScrapePlatform } from "./pool-config";
import type { BlockClass } from "./proxy-pool-manager";

/** Streak rows with no cooldown older than this are not worth hydrating. */
const STALE_STREAK_MS = 24 * 60 * 60 * 1000;

const hydratedScopes = new Set<string>();

let persistFailureCount = 0;
let hydrateFailureCount = 0;

export function _poolPersistenceStats(): { persistFailures: number; hydrateFailures: number; hydratedScopes: number } {
  return {
    persistFailures: persistFailureCount,
    hydrateFailures: hydrateFailureCount,
    hydratedScopes: hydratedScopes.size,
  };
}

/** Test helper: reset hydration flags + counters between vitest cases. */
export function _resetPoolPersistenceForTesting(): void {
  hydratedScopes.clear();
  persistFailureCount = 0;
  hydrateFailureCount = 0;
}

/**
 * Lazily hydrates persisted backoff state for one (accountId, platform)
 * scope. Awaited by the facade BEFORE the cooling gate so a fresh boot sees
 * cooldowns that were active when the previous process died. Hydration
 * failure is loud but non-fatal: the scrape proceeds with in-memory state
 * only (B3 — degraded protection beats blocked product).
 */
export async function ensureBackoffHydrated(accountId: string, platform: ScrapePlatform): Promise<void> {
  const scope = `${accountId}|${platform}`;
  if (hydratedScopes.has(scope)) return;
  // Set BEFORE the read: duplicate concurrent callers may race past this
  // line and both read — that is harmless (hydrate is idempotent) and
  // intentionally preferred over an in-flight promise map (8-AUDIT).
  hydratedScopes.add(scope);

  try {
    const now = new Date();
    const staleFloor = new Date(Date.now() - STALE_STREAK_MS);
    const rows = await db
      .select()
      .from(scrapeTargetBackoff)
      .where(
        and(
          eq(scrapeTargetBackoff.accountId, accountId),
          eq(scrapeTargetBackoff.platform, platform),
          or(
            and(isNotNull(scrapeTargetBackoff.cooldownUntil), gt(scrapeTargetBackoff.cooldownUntil, now)),
            and(isNotNull(scrapeTargetBackoff.lastFailureAt), gt(scrapeTargetBackoff.lastFailureAt, staleFloor)),
          ),
        ),
      );

    for (const row of rows) {
      const state: TargetBackoffState = {
        accountId: row.accountId,
        platform: row.platform as ScrapePlatform,
        targetKey: row.targetKey,
        failureStreak: row.failureStreak,
        cooldownUntil: row.cooldownUntil ? row.cooldownUntil.getTime() : null,
        lastBlockClass: (row.lastBlockClass as BlockClass | null) ?? null,
        lastFailureAt: row.lastFailureAt ? row.lastFailureAt.getTime() : null,
      };
      hydrateTargetState(state);
    }
    if (rows.length > 0) {
      console.log(`[ProxyPool] BACKOFF_HYDRATED | account=${accountId} | platform=${platform} | rows=${rows.length}`);
    }
  } catch (err: any) {
    hydrateFailureCount++;
    // Loud, non-fatal: allow retry on next touch by un-flagging the scope.
    hydratedScopes.delete(scope);
    console.error(
      `[ProxyPool] BACKOFF_HYDRATE_FAILED | account=${accountId} | platform=${platform} | ${err?.message || String(err)}`,
    );
  }
}

/**
 * Fire-and-forget write-through after recordTargetFailure(). Callers must
 * NOT await scrape-path latency on this — invoke without await.
 */
export function persistTargetFailure(state: TargetBackoffState): void {
  void db
    .insert(scrapeTargetBackoff)
    .values({
      accountId: state.accountId,
      platform: state.platform,
      targetKey: state.targetKey,
      failureStreak: state.failureStreak,
      cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil) : null,
      lastBlockClass: state.lastBlockClass,
      lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [scrapeTargetBackoff.accountId, scrapeTargetBackoff.platform, scrapeTargetBackoff.targetKey],
      set: {
        failureStreak: state.failureStreak,
        cooldownUntil: state.cooldownUntil ? new Date(state.cooldownUntil) : null,
        lastBlockClass: state.lastBlockClass,
        lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt) : null,
        updatedAt: new Date(),
      },
    })
    .catch((err: any) => {
      persistFailureCount++;
      console.error(
        `[ProxyPool] BACKOFF_PERSIST_FAILED | op=upsert | account=${state.accountId} | platform=${state.platform} | target=${state.targetKey} | ${err?.message || String(err)}`,
      );
    });
}

/**
 * Fire-and-forget row delete after recordTargetSuccess() cleared a streak.
 */
export function persistTargetCleared(accountId: string, platform: ScrapePlatform, targetKey: string): void {
  void db
    .delete(scrapeTargetBackoff)
    .where(
      and(
        eq(scrapeTargetBackoff.accountId, accountId),
        eq(scrapeTargetBackoff.platform, platform),
        eq(scrapeTargetBackoff.targetKey, targetKey),
      ),
    )
    .catch((err: any) => {
      persistFailureCount++;
      console.error(
        `[ProxyPool] BACKOFF_PERSIST_FAILED | op=delete | account=${accountId} | platform=${platform} | target=${targetKey} | ${err?.message || String(err)}`,
      );
    });
}
