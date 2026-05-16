/**
 * Seal #2 (Task #20) — F1.8 per-account AI generation rate limit.
 *
 * Sliding 1-hour window keyed by `(accountId, route)`. Prevents a single
 * tenant from exhausting the OpenAI/Gemini quota (cost-amplification +
 * neighbour-noise). Pattern mirrors the IP rate-limiter in `server/auth.ts`
 * and the per-user gate referenced at `server/veo-routes.ts:178`. Honors
 * `Retry-After` per HTTP RFC.
 *
 * Budget is configurable via env `AI_RATE_LIMIT_PER_HOUR` (default 50).
 */
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { recordAIRateLimit429 } from "../operations-guardian/ai-pressure-stats";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_BUDGET = Number(process.env.AI_RATE_LIMIT_PER_HOUR) || 50;

const buckets = new Map<string, number[]>();

export function aiRateLimitPerAccount(maxPerHour: number = DEFAULT_BUDGET) {
  return function aiRateLimitMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    const accountId = req.accountId;
    if (!accountId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const route = req.route?.path || req.path;
    const key = `${accountId}:${route}`;
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const hits = (buckets.get(key) || []).filter(t => t > cutoff);

    if (hits.length >= maxPerHour) {
      const retryAfterSec = Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      console.warn(`[AIRateLimit] EXCEEDED | account=${accountId} | route=${route} | hits=${hits.length} | budget=${maxPerHour}`);
      // Task #59 / Phase 1C — feed the Guardian aggregator. Wrapped because
      // a recorder failure must NEVER prevent the 429 response.
      try {
        recordAIRateLimit429();
      } catch (err) {
        console.error("[OperationsGuardian] AI_RATE_LIMIT_RECORD_FAILED", err);
      }
      return res.status(429).json({
        error: "AI_RATE_LIMIT_EXCEEDED",
        message: "Hourly AI generation budget exceeded for this account.",
        retryAfterSec,
      });
    }

    hits.push(now);
    buckets.set(key, hits);

    // Cheap GC: when bucket map gets large, sweep stale buckets.
    if (buckets.size > 5000 && Math.random() < 0.01) {
      for (const [k, v] of buckets.entries()) {
        const live = v.filter(t => t > cutoff);
        if (live.length === 0) buckets.delete(k);
        else buckets.set(k, live);
      }
    }

    next();
  };
}

/** Test-only: drain the bucket map. */
export function __resetAiRateLimitBuckets() {
  buckets.clear();
}
