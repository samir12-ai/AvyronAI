/**
 * Adaptive per-target backoff — T006 (2026-07).
 *
 * Tracks consecutive transport-level failures per (accountId, platform,
 * targetKey) and computes an exponential, jittered cooldown from the
 * platform's PoolProfile. Pure streak/cooldown logic + in-memory state ONLY —
 * DB persistence lives in pool-persistence.ts, transport gating lives in
 * proxy-pool-manager.ts (the facade).
 *
 * Doctrine notes:
 *   - D2: a cooling target is signalled by the facade throwing a typed
 *     TargetBackoffActiveError — NEVER by returning null (null already means
 *     "unconfigured" on the pool paths).
 *   - No new scheduler / lock / in-flight promise map (Seal #19 8-AUDIT gate
 *     avoidance): state is a plain LRU; expiry is checked lazily on read.
 */

import { LRUCache } from "lru-cache";
import { getPoolProfile, type ScrapePlatform } from "./pool-config";
import type { BlockClass } from "./proxy-pool-manager";

export interface TargetBackoffState {
  accountId: string;
  platform: ScrapePlatform;
  targetKey: string;
  failureStreak: number;
  /** Epoch ms until which the target is cooling; null = not cooling. */
  cooldownUntil: number | null;
  lastBlockClass: BlockClass | null;
  lastFailureAt: number | null;
}

const MAX_TRACKED_TARGETS = parseInt(process.env.SCRAPE_BACKOFF_MAX_TARGETS || "5000", 10);
const STATE_TTL_MS = parseInt(process.env.SCRAPE_BACKOFF_STATE_TTL_MS || String(24 * 60 * 60 * 1000), 10);

const targetStates = new LRUCache<string, TargetBackoffState>({
  max: MAX_TRACKED_TARGETS,
  ttl: STATE_TTL_MS,
  updateAgeOnGet: true,
});

function stateKey(accountId: string, platform: ScrapePlatform, targetKey: string): string {
  return `${accountId}|${platform}|${targetKey}`;
}

/**
 * Pure cooldown computation: base × factor^(streak − threshold), capped, with
 * ±jitter. Streaks below the platform's failureThreshold return 0 (no
 * cooldown yet).
 */
export function computeCooldownMs(platform: ScrapePlatform, failureStreak: number): number {
  const profile = getPoolProfile(platform);
  if (failureStreak < profile.failureThreshold) return 0;
  const exponent = failureStreak - profile.failureThreshold;
  const raw = profile.backoffBaseMs * Math.pow(profile.backoffFactor, exponent);
  const capped = Math.min(raw, profile.backoffMaxMs);
  const jitter = 1 + (Math.random() * 2 - 1) * profile.backoffJitterFraction;
  return Math.round(capped * jitter);
}

export interface CoolingCheck {
  cooling: boolean;
  retryAfterMs: number;
  failureStreak: number;
}

/** Lazy-expiry read: a past-due cooldownUntil reads as not-cooling. */
export function checkTargetCooling(
  accountId: string,
  platform: ScrapePlatform,
  targetKey: string,
): CoolingCheck {
  const state = targetStates.get(stateKey(accountId, platform, targetKey));
  if (!state || state.cooldownUntil === null) {
    return { cooling: false, retryAfterMs: 0, failureStreak: state?.failureStreak ?? 0 };
  }
  const remaining = state.cooldownUntil - Date.now();
  if (remaining <= 0) {
    // Cooldown elapsed — clear the gate but KEEP the streak so the next
    // failure escalates instead of restarting the curve.
    state.cooldownUntil = null;
    return { cooling: false, retryAfterMs: 0, failureStreak: state.failureStreak };
  }
  return { cooling: true, retryAfterMs: remaining, failureStreak: state.failureStreak };
}

/**
 * Records a transport-level failure. Returns the updated state so the caller
 * (facade) can hand it to pool-persistence for write-through.
 */
export function recordTargetFailure(
  accountId: string,
  platform: ScrapePlatform,
  targetKey: string,
  blockClass: BlockClass | null,
): TargetBackoffState {
  const key = stateKey(accountId, platform, targetKey);
  const now = Date.now();
  const prev = targetStates.get(key);
  const failureStreak = (prev?.failureStreak ?? 0) + 1;
  const cooldownMs = computeCooldownMs(platform, failureStreak);
  const state: TargetBackoffState = {
    accountId,
    platform,
    targetKey,
    failureStreak,
    cooldownUntil: cooldownMs > 0 ? now + cooldownMs : null,
    lastBlockClass: blockClass,
    lastFailureAt: now,
  };
  targetStates.set(key, state);
  if (state.cooldownUntil) {
    console.log(
      `[TargetBackoff] COOLDOWN_SET | account=${accountId} | platform=${platform} | target=${targetKey} | streak=${failureStreak} | cooldownMs=${cooldownMs} | blockClass=${blockClass ?? "NONE"}`,
    );
  }
  return state;
}

/**
 * Records a transport-level success. Returns true when a non-zero streak was
 * cleared (the caller should delete the persisted row).
 */
export function recordTargetSuccess(
  accountId: string,
  platform: ScrapePlatform,
  targetKey: string,
): boolean {
  const key = stateKey(accountId, platform, targetKey);
  const prev = targetStates.get(key);
  if (!prev || prev.failureStreak === 0) return false;
  targetStates.delete(key);
  console.log(
    `[TargetBackoff] STREAK_CLEARED | account=${accountId} | platform=${platform} | target=${targetKey} | previousStreak=${prev.failureStreak}`,
  );
  return true;
}

/**
 * Hydration entry point for pool-persistence: installs a persisted row into
 * the in-memory store WITHOUT overwriting fresher live state (a row loaded
 * from the DB can never be newer than a state produced this process-lifetime).
 */
export function hydrateTargetState(state: TargetBackoffState): void {
  const key = stateKey(state.accountId, state.platform, state.targetKey);
  if (targetStates.has(key)) return;
  targetStates.set(key, state);
}

export interface TargetBackoffSnapshotEntry {
  accountId: string;
  platform: ScrapePlatform;
  targetKey: string;
  failureStreak: number;
  cooling: boolean;
  retryAfterMs: number;
  lastBlockClass: BlockClass | null;
  lastFailureAt: number | null;
}

/** Snapshot for the operator status endpoint + hourly summary. */
export function getTargetBackoffSnapshot(): TargetBackoffSnapshotEntry[] {
  const now = Date.now();
  const entries: TargetBackoffSnapshotEntry[] = [];
  for (const state of targetStates.values()) {
    const remaining = state.cooldownUntil !== null ? state.cooldownUntil - now : 0;
    entries.push({
      accountId: state.accountId,
      platform: state.platform,
      targetKey: state.targetKey,
      failureStreak: state.failureStreak,
      cooling: remaining > 0,
      retryAfterMs: Math.max(0, remaining),
      lastBlockClass: state.lastBlockClass,
      lastFailureAt: state.lastFailureAt,
    });
  }
  return entries;
}

/** Test helper: drops all backoff state (used between vitest cases). */
export function _resetTargetBackoffForTesting(): void {
  targetStates.clear();
}
