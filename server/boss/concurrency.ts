/**
 * Phase 3 — Per-campaign in-flight lock.
 * Single-process only (mirrors Collector decision #2). Cross-process
 * coordination is intentionally out of scope.
 *
 * Track #3 / Seal #15 — silent-degradation hardening.
 *
 * The Map previously stored only the Promise. If `work()` never settled
 * (downstream AI hang, missing internal timeout, deadlocked DB call), the
 * `.finally()` cleanup never fired and the entry permanently blocked all
 * future Boss runs for that campaign — a "zombie in-flight" leak. We now:
 *
 *  1. Track `startedAt` per entry.
 *  2. Track an `ownershipToken` (monotonic counter) per entry. The
 *     `.finally()` cleanup ONLY deletes the entry if the live token
 *     matches the one captured at lock acquisition. Without this, a
 *     zombie eviction followed by a new lock acquisition would race —
 *     the LATE settlement of the old promise would delete the NEW
 *     entry and silently allow concurrent Boss runs (architect-flagged
 *     HIGH-severity regression in the v1 implementation).
 *  3. On every withCampaignLock entry, evict any entry older than
 *     MAX_INFLIGHT_AGE_MS (default 30 min) and log + count the eviction
 *     so operators see zombie sweeps in metrics.
 *  4. Provide test-only helpers for race + watchdog coverage.
 */
import type { BossRunResult } from "./types";

export class BossRunInFlightError extends Error {
  code = "BOSS_RUN_IN_FLIGHT";
  constructor(public campaignId: string) {
    super(`A Boss run is already in flight for campaign ${campaignId}`);
    this.name = "BossRunInFlightError";
  }
}

interface InFlightEntry {
  promise: Promise<BossRunResult>;
  startedAt: number;
  /**
   * Monotonic per-process token. Captured by the `.finally()` closure
   * below at the moment the entry is INSTALLED in the Map. The cleanup
   * only deletes the Map entry if the live entry's token still matches.
   * This closes the race where (1) a zombie entry is evicted, (2) a new
   * entry is installed, (3) the old promise belatedly settles and its
   * `.finally()` runs — without the token check it would erase the new
   * entry and allow a duplicate concurrent Boss run.
   */
  token: number;
}

const inFlight = new Map<string, InFlightEntry>();
let nextToken = 1;

const MAX_INFLIGHT_AGE_MS = (() => {
  const raw = process.env.BOSS_INFLIGHT_MAX_AGE_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000;
})();

let zombieEvictions = 0;

function key(accountId: string, campaignId: string): string {
  return `${accountId}::${campaignId}`;
}

function evictZombies(now: number): void {
  for (const [k, entry] of inFlight) {
    if (now - entry.startedAt > MAX_INFLIGHT_AGE_MS) {
      inFlight.delete(k);
      zombieEvictions += 1;
      console.error(
        `[BossConcurrency] ZOMBIE_INFLIGHT_EVICTED key=${k} ageMs=${
          now - entry.startedAt
        } maxAgeMs=${MAX_INFLIGHT_AGE_MS} totalEvictions=${zombieEvictions}`,
      );
    }
  }
}

export async function withCampaignLock(
  accountId: string,
  campaignId: string,
  work: () => Promise<BossRunResult>,
): Promise<BossRunResult> {
  const k = key(accountId, campaignId);
  const now = Date.now();
  evictZombies(now);
  if (inFlight.has(k)) {
    throw new BossRunInFlightError(campaignId);
  }
  const myToken = nextToken++;
  const promise = work().finally(() => {
    // Token-aware cleanup: only delete if the entry under this key is
    // still ours. A zombie eviction may have already removed it, OR a
    // new caller may have installed a fresher entry under the same key.
    const current = inFlight.get(k);
    if (current && current.token === myToken) {
      inFlight.delete(k);
    }
  });
  inFlight.set(k, { promise, startedAt: now, token: myToken });
  return promise;
}

/** Test-only: release a lock if a previous run leaked it. */
export function _resetCampaignLock(accountId: string, campaignId: string): void {
  inFlight.delete(key(accountId, campaignId));
}

/** Track #3 — observability hooks for the watchdog. */
export function _bossInFlightStats(): {
  size: number;
  zombieEvictions: number;
  maxAgeMs: number;
  oldestAgeMs: number | null;
} {
  const now = Date.now();
  let oldest: number | null = null;
  for (const e of inFlight.values()) {
    const age = now - e.startedAt;
    if (oldest === null || age > oldest) oldest = age;
  }
  return {
    size: inFlight.size,
    zombieEvictions,
    maxAgeMs: MAX_INFLIGHT_AGE_MS,
    oldestAgeMs: oldest,
  };
}

/** Test-only: insert a synthetic stale entry to exercise the eviction path. */
export function _injectStaleInFlightForTest(
  accountId: string,
  campaignId: string,
  ageMs: number,
): void {
  inFlight.set(key(accountId, campaignId), {
    promise: new Promise<BossRunResult>(() => {
      /* never resolves — that is the point */
    }),
    startedAt: Date.now() - ageMs,
    token: nextToken++,
  });
}

/** Test-only: reset eviction counter between cases. */
export function _resetBossInFlightCounters(): void {
  zombieEvictions = 0;
  inFlight.clear();
  nextToken = 1;
}
