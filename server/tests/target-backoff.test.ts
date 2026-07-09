/**
 * T006 — adaptive per-target backoff unit tests.
 *
 * Covers the pure streak/cooldown logic in target-backoff.ts:
 *   - cooldown curve (threshold gate, exponential growth, cap, jitter)
 *   - lazy expiry that KEEPS the streak (escalation, not curve restart)
 *   - success clearing
 *   - hydration precedence (live state wins over persisted rows)
 *   - state isolation across (accountId, platform, targetKey)
 *
 * Jitter is neutralized by pinning Math.random to 0.5 (jitter factor = 1)
 * so curve assertions are exact.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeCooldownMs,
  checkTargetCooling,
  recordTargetFailure,
  recordTargetSuccess,
  hydrateTargetState,
  getTargetBackoffSnapshot,
  _resetTargetBackoffForTesting,
} from "../competitive-intelligence/target-backoff";
import { POOL_CONFIG } from "../competitive-intelligence/pool-config";

const ACCOUNT_A = "acct-backoff-a";
const ACCOUNT_B = "acct-backoff-b";

describe("Target Backoff — T006", () => {
  beforeEach(() => {
    _resetTargetBackoffForTesting();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter factor = exactly 1
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    _resetTargetBackoffForTesting();
  });

  describe("computeCooldownMs — curve shape", () => {
    it("returns 0 below the platform failureThreshold", () => {
      // reviews + website have threshold 2 → a single failure never cools.
      expect(computeCooldownMs("reviews", 1)).toBe(0);
      expect(computeCooldownMs("website", 1)).toBe(0);
      expect(computeCooldownMs("instagram", 0)).toBe(0);
    });

    it("returns exactly backoffBaseMs at the threshold (jitter pinned)", () => {
      expect(computeCooldownMs("instagram", 1)).toBe(POOL_CONFIG.instagram.backoffBaseMs);
      expect(computeCooldownMs("tiktok", 1)).toBe(POOL_CONFIG.tiktok.backoffBaseMs);
      expect(computeCooldownMs("reviews", 2)).toBe(POOL_CONFIG.reviews.backoffBaseMs);
      expect(computeCooldownMs("website", 2)).toBe(POOL_CONFIG.website.backoffBaseMs);
    });

    it("grows exponentially by backoffFactor per failure past the threshold", () => {
      const base = POOL_CONFIG.instagram.backoffBaseMs;
      const factor = POOL_CONFIG.instagram.backoffFactor;
      expect(computeCooldownMs("instagram", 2)).toBe(base * factor);
      expect(computeCooldownMs("instagram", 3)).toBe(base * factor * factor);
    });

    it("is capped at backoffMaxMs regardless of streak depth", () => {
      expect(computeCooldownMs("instagram", 50)).toBe(POOL_CONFIG.instagram.backoffMaxMs);
      expect(computeCooldownMs("website", 50)).toBe(POOL_CONFIG.website.backoffMaxMs);
    });

    it("applies bounded jitter (±backoffJitterFraction) around the raw value", () => {
      vi.restoreAllMocks(); // real Math.random for this case
      const base = POOL_CONFIG.tiktok.backoffBaseMs;
      const frac = POOL_CONFIG.tiktok.backoffJitterFraction;
      for (let i = 0; i < 25; i++) {
        const v = computeCooldownMs("tiktok", 1);
        expect(v).toBeGreaterThanOrEqual(Math.floor(base * (1 - frac)));
        expect(v).toBeLessThanOrEqual(Math.ceil(base * (1 + frac)));
      }
    });
  });

  describe("failure recording + cooling gate", () => {
    it("unknown target reads as not-cooling with streak 0", () => {
      const check = checkTargetCooling(ACCOUNT_A, "instagram", "never_seen");
      expect(check.cooling).toBe(false);
      expect(check.retryAfterMs).toBe(0);
      expect(check.failureStreak).toBe(0);
    });

    it("a failure below the threshold tracks the streak but does NOT cool", () => {
      const state = recordTargetFailure(ACCOUNT_A, "reviews", "cafe milano", "RATE_LIMIT");
      expect(state.failureStreak).toBe(1);
      expect(state.cooldownUntil).toBeNull();
      const check = checkTargetCooling(ACCOUNT_A, "reviews", "cafe milano");
      expect(check.cooling).toBe(false);
      expect(check.failureStreak).toBe(1);
    });

    it("a failure at the threshold cools immediately (instagram threshold=1)", () => {
      const state = recordTargetFailure(ACCOUNT_A, "instagram", "some_handle", "PROXY_BLOCKED");
      expect(state.failureStreak).toBe(1);
      expect(state.cooldownUntil).not.toBeNull();
      const check = checkTargetCooling(ACCOUNT_A, "instagram", "some_handle");
      expect(check.cooling).toBe(true);
      expect(check.retryAfterMs).toBeGreaterThan(0);
      expect(check.retryAfterMs).toBeLessThanOrEqual(POOL_CONFIG.instagram.backoffBaseMs);
    });

    it("lazy expiry clears the gate but KEEPS the streak for escalation", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-09T12:00:00Z"));
      // re-pin Math.random after useFakeTimers (spy survives, but be explicit)
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      recordTargetFailure(ACCOUNT_A, "instagram", "expiring_handle", "PROXY_BLOCKED");
      expect(checkTargetCooling(ACCOUNT_A, "instagram", "expiring_handle").cooling).toBe(true);

      // Advance past the base cooldown — gate opens, streak survives.
      vi.advanceTimersByTime(POOL_CONFIG.instagram.backoffBaseMs + 1000);
      const afterExpiry = checkTargetCooling(ACCOUNT_A, "instagram", "expiring_handle");
      expect(afterExpiry.cooling).toBe(false);
      expect(afterExpiry.failureStreak).toBe(1);

      // Next failure escalates to streak 2 → cooldown = base × factor.
      const escalated = recordTargetFailure(ACCOUNT_A, "instagram", "expiring_handle", "PROXY_BLOCKED");
      expect(escalated.failureStreak).toBe(2);
      const expected = POOL_CONFIG.instagram.backoffBaseMs * POOL_CONFIG.instagram.backoffFactor;
      expect(escalated.cooldownUntil).toBe(Date.now() + expected);
    });

    it("success clears a non-zero streak and reports it; no-op otherwise", () => {
      expect(recordTargetSuccess(ACCOUNT_A, "tiktok", "clean_handle")).toBe(false);
      recordTargetFailure(ACCOUNT_A, "tiktok", "dirty_handle", "RATE_LIMIT");
      expect(recordTargetSuccess(ACCOUNT_A, "tiktok", "dirty_handle")).toBe(true);
      // Fully reset: next failure restarts the curve at streak 1.
      const check = checkTargetCooling(ACCOUNT_A, "tiktok", "dirty_handle");
      expect(check.cooling).toBe(false);
      expect(check.failureStreak).toBe(0);
    });

    it("state is isolated per (accountId, platform, targetKey)", () => {
      recordTargetFailure(ACCOUNT_A, "instagram", "shared_handle", "PROXY_BLOCKED");
      // Same handle, different tenant → untouched.
      expect(checkTargetCooling(ACCOUNT_B, "instagram", "shared_handle").cooling).toBe(false);
      // Same tenant + handle, different platform → untouched.
      expect(checkTargetCooling(ACCOUNT_A, "tiktok", "shared_handle").cooling).toBe(false);
      // Same tenant + platform, different handle → untouched.
      expect(checkTargetCooling(ACCOUNT_A, "instagram", "other_handle").cooling).toBe(false);
    });
  });

  describe("hydration precedence", () => {
    it("hydrateTargetState installs a persisted row for an unseen target", () => {
      hydrateTargetState({
        accountId: ACCOUNT_A,
        platform: "instagram",
        targetKey: "persisted_handle",
        failureStreak: 3,
        cooldownUntil: Date.now() + 60_000,
        lastBlockClass: "PROXY_BLOCKED",
        lastFailureAt: Date.now() - 1000,
      });
      const check = checkTargetCooling(ACCOUNT_A, "instagram", "persisted_handle");
      expect(check.cooling).toBe(true);
      expect(check.failureStreak).toBe(3);
    });

    it("hydrateTargetState NEVER overwrites fresher live state", () => {
      recordTargetFailure(ACCOUNT_A, "instagram", "live_handle", "RATE_LIMIT");
      hydrateTargetState({
        accountId: ACCOUNT_A,
        platform: "instagram",
        targetKey: "live_handle",
        failureStreak: 9,
        cooldownUntil: Date.now() + 999_999,
        lastBlockClass: "CHECKPOINT",
        lastFailureAt: Date.now(),
      });
      // Live streak (1) wins over the stale persisted row (9).
      expect(checkTargetCooling(ACCOUNT_A, "instagram", "live_handle").failureStreak).toBe(1);
    });
  });

  describe("snapshot surface", () => {
    it("reports per-entry cooling flags and remaining time, never negative", () => {
      recordTargetFailure(ACCOUNT_A, "instagram", "snap_cooling", "PROXY_BLOCKED"); // cools (threshold 1)
      recordTargetFailure(ACCOUNT_A, "reviews", "snap_tracked", "RATE_LIMIT"); // tracked, not cooling (threshold 2)
      const snapshot = getTargetBackoffSnapshot();
      expect(snapshot).toHaveLength(2);
      const cooling = snapshot.find((e) => e.targetKey === "snap_cooling");
      const tracked = snapshot.find((e) => e.targetKey === "snap_tracked");
      expect(cooling?.cooling).toBe(true);
      expect(cooling?.retryAfterMs).toBeGreaterThan(0);
      expect(tracked?.cooling).toBe(false);
      expect(tracked?.retryAfterMs).toBe(0);
      for (const entry of snapshot) {
        expect(entry.retryAfterMs).toBeGreaterThanOrEqual(0);
        expect(entry.failureStreak).toBeGreaterThan(0);
      }
    });
  });
});
