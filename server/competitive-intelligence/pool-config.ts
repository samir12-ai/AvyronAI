/**
 * Pool configuration registry — T006 multi-pool upgrade (2026-07).
 *
 * Each scrape platform gets its own named pool profile: cooldown behaviour,
 * per-target adaptive backoff curve, and a concurrency ceiling. Adding a new
 * pool is a CONFIGURATION change (new entry below), not a code change —
 * target-backoff.ts and proxy-pool-manager.ts read profiles generically.
 *
 * Doctrine notes:
 *   - D3: platform is a strict union backed by a const tuple; unknown platform
 *     strings are rejected by `isScrapePlatform` (fail-closed, never coerced).
 *   - Concurrency limits are OBSERVE-ONLY until after Phase 4 live
 *     verification (architect ruling: Phase 4 must verify an unperturbed
 *     transport path). Violations log CONCURRENCY_EXCEEDED, never block.
 */

export const SCRAPE_PLATFORMS = ["instagram", "tiktok", "reviews", "website"] as const;
export type ScrapePlatform = (typeof SCRAPE_PLATFORMS)[number];

export function isScrapePlatform(value: string): value is ScrapePlatform {
  return (SCRAPE_PLATFORMS as readonly string[]).includes(value);
}

export interface PoolProfile {
  /** Adaptive per-target backoff: first-failure cooldown. */
  backoffBaseMs: number;
  /** Adaptive per-target backoff: exponential growth factor per consecutive failure. */
  backoffFactor: number;
  /** Adaptive per-target backoff: hard ceiling. */
  backoffMaxMs: number;
  /** ± jitter fraction applied to every computed cooldown (0.2 = ±20%). */
  backoffJitterFraction: number;
  /**
   * Consecutive transport-level failures required before a target enters
   * cooldown at all. 1 = first failure already cools (strictest).
   */
  failureThreshold: number;
  /** Observe-only in-flight request ceiling for this pool (see header note). */
  concurrencyLimit: number;
}

/**
 * Per-platform tuning. Rationale:
 *   - instagram: aggressive anti-bot; medium base, deep cap.
 *   - tiktok: strictest anti-bot of the four; higher base + threshold 1.
 *   - reviews (Google Maps): rate-limits fast but recovers fast; medium base,
 *     tolerate one stray failure before cooling (searches are noisy).
 *   - website (generic sites): most tolerant; short base, shallow cap — a
 *     generic site 500 is usually transient, not a block.
 */
export const POOL_CONFIG: Readonly<Record<ScrapePlatform, PoolProfile>> = Object.freeze({
  instagram: {
    backoffBaseMs: 5 * 60 * 1000,
    backoffFactor: 2,
    backoffMaxMs: 2 * 60 * 60 * 1000,
    backoffJitterFraction: 0.2,
    failureThreshold: 1,
    concurrencyLimit: 4,
  },
  tiktok: {
    backoffBaseMs: 8 * 60 * 1000,
    backoffFactor: 2,
    backoffMaxMs: 2 * 60 * 60 * 1000,
    backoffJitterFraction: 0.2,
    failureThreshold: 1,
    concurrencyLimit: 3,
  },
  reviews: {
    backoffBaseMs: 5 * 60 * 1000,
    backoffFactor: 2,
    backoffMaxMs: 90 * 60 * 1000,
    backoffJitterFraction: 0.2,
    failureThreshold: 2,
    concurrencyLimit: 3,
  },
  website: {
    backoffBaseMs: 2 * 60 * 1000,
    backoffFactor: 2,
    backoffMaxMs: 30 * 60 * 1000,
    backoffJitterFraction: 0.2,
    failureThreshold: 2,
    concurrencyLimit: 6,
  },
});

export function getPoolProfile(platform: ScrapePlatform): PoolProfile {
  return POOL_CONFIG[platform];
}
