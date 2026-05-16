/**
 * Task #54 — GR21 (AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT).
 *
 * Daily USD ceiling per account complementing GR1 (hourly call-count rate
 * limit). GR1 catches a runaway loop within minutes; GR21 catches the
 * slower-burn case where a campaign is legitimately within the call rate
 * but is consuming oversized completions (e.g. 16K-token outputs).
 *
 * The metric `ai_spend_usd_per_account` (G4 from observation-plan.md) is a
 * follow-up — until it ships, we estimate spend from `ai_usage_log.estimated_tokens`
 * × a blended per-model rate. The estimate is intentionally conservative
 * (trips earlier than real spend) so the cap fail-closes rather than
 * fail-opening on an under-estimate.
 *
 * Disabled by default — set `AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT=50` to
 * activate. When unset / 0, this middleware is a no-op.
 *
 * No `??` / `||` semantic fallbacks on the verdict field (`outcome`) — D1–D5.
 */
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logAudit } from "../audit";

// Blended public list-price USD per 1K tokens by model (mid-2025).
// Conservative — we don't split prompt vs completion since the schema only
// stores total estimated_tokens. When in doubt the rate is on the high side
// so we trip BEFORE actual provider invoices land.
const MODEL_PRICE_PER_1K: Record<string, number> = {
  "gpt-4o": 0.010,
  "gpt-4o-mini": 0.0006,
  "gpt-4-turbo": 0.020,
  "gpt-4": 0.040,
  "gpt-3.5-turbo": 0.0015,
  "gemini-2.5-flash": 0.000375,
  "gemini-2.5-pro": 0.005,
  "gemini-1.5-flash": 0.000375,
  "gemini-1.5-pro": 0.005,
};
const DEFAULT_PRICE_PER_1K = 0.010; // unknown models priced as gpt-4o

function getCapUsd(): number {
  const raw = process.env.AI_DAILY_SPEND_CAP_USD_PER_ACCOUNT;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

interface DailySpend {
  totalUsd: number;
  totalTokens: number;
  byModel: Record<string, { tokens: number; usd: number }>;
}

export async function estimateDailySpendUsd(accountId: string): Promise<DailySpend> {
  const result = await db.execute(sql`
    SELECT model, COALESCE(SUM(estimated_tokens), 0)::bigint AS tokens
    FROM ai_usage_log
    WHERE account_id = ${accountId}
      AND created_at > NOW() - INTERVAL '24 hours'
      AND endpoint != 'budget_reservation'
    GROUP BY model
  `);
  const byModel: Record<string, { tokens: number; usd: number }> = {};
  let totalUsd = 0;
  let totalTokens = 0;
  for (const row of result.rows as any[]) {
    const model = String(row.model || "unknown");
    const tokens = Number(row.tokens) || 0;
    const pricePer1K = MODEL_PRICE_PER_1K[model] !== undefined
      ? MODEL_PRICE_PER_1K[model]
      : DEFAULT_PRICE_PER_1K;
    const usd = (tokens / 1000) * pricePer1K;
    byModel[model] = { tokens, usd };
    totalTokens += tokens;
    totalUsd += usd;
  }
  return { totalUsd, totalTokens, byModel };
}

// Short positive-only cache to avoid round-tripping `ai_usage_log` on every
// generate-* call. When an account is well under the cap we cache "admit"
// for 60s; we never cache a deny (so reducing the cap takes effect on the
// next request, not 60s later).
interface AdmitCacheEntry { until: number; }
const admitCache = new Map<string, AdmitCacheEntry>();
const ADMIT_TTL_MS = 60_000;

export function aiSpendCapPerAccount() {
  return async function aiSpendCapMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    const cap = getCapUsd();
    if (cap <= 0) return next();

    const accountId = req.accountId;
    if (!accountId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const cached = admitCache.get(accountId);
    if (cached && cached.until > Date.now()) return next();

    let spend: DailySpend;
    try {
      spend = await estimateDailySpendUsd(accountId);
    } catch (err) {
      // Fail-open on DB error — GR1 still bounds the request rate, and a hard
      // fail-closed here would silently disable the entire AI surface during
      // a DB blip. Operator sees the error log.
      console.error("[AISpendCap] SPEND_QUERY_FAILED — admitting fail-open", (err as Error)?.message);
      return next();
    }

    if (spend.totalUsd >= cap) {
      const retryAfterSec = 3600; // operator decides when to lift; 1h floor
      res.setHeader("Retry-After", String(retryAfterSec));
      console.warn(
        `[AISpendCap] EXCEEDED | account=${accountId} | spendUsd=${spend.totalUsd.toFixed(2)} | cap=${cap.toFixed(2)} | tokens24h=${spend.totalTokens}`,
      );
      try {
        await logAudit(accountId, "AI_SPEND_CAP_EXCEEDED", {
          details: {
            estimatedSpendUsd: Number(spend.totalUsd.toFixed(4)),
            capUsd: cap,
            tokens24h: spend.totalTokens,
            byModel: spend.byModel,
            note: "Spend derived from ai_usage_log.estimated_tokens × per-model blended price. G4 (true cost metric) is a follow-up.",
          },
          riskLevel: "high",
        });
      } catch (err) {
        console.error("[AISpendCap] AUDIT_WRITE_FAILED", (err as Error)?.message);
      }
      return res.status(429).json({
        error: "AI_DAILY_SPEND_CAP_EXCEEDED",
        message: "Daily AI spend cap reached for this account.",
        retryAfterSec,
        estimatedSpendUsd: Number(spend.totalUsd.toFixed(2)),
        capUsd: cap,
      });
    }

    // Cache the admit decision when comfortably under cap (<80%) to absorb
    // bursts without re-querying every request. Above 80% we re-check each
    // request so the cap trips promptly.
    if (spend.totalUsd < cap * 0.8) {
      admitCache.set(accountId, { until: Date.now() + ADMIT_TTL_MS });
    } else {
      admitCache.delete(accountId);
    }

    next();
  };
}

/** Test-only — drain the positive-admit cache. */
export function __resetAiSpendCapCache() {
  admitCache.clear();
}
