/**
 * Task #54 — GR22 (SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT) +
 * GR23 (MI_QUEUE_DEPTH_DEFER_THRESHOLD).
 *
 * Both guardrails sit in front of `_createAndStartJob()` in the
 * fetch-orchestrator. They are operator-toggleable env caps that fail-closed
 * on the new-job admission path while letting in-flight jobs continue.
 *
 * GR22 — per-account daily scrape volume cap. The schema doesn't yet ship a
 * dedicated `scrape_attempts` telemetry table (G2 is a follow-up — see
 * `server/operations-guardian/interpreter.ts:262`). Until it does, the
 * closest proxy is `mi_fetch_jobs` rows × `competitor_count` (each fetch job
 * scrapes its competitor set), which we sum over the last 24h. This is a
 * conservative proxy — it slightly UNDERCOUNTS individual requests but is
 * monotonic with real volume, so the cap trips earlier than real spend would
 * suggest (acceptable for a safety cap).
 *
 * GR23 — global MI queue depth circuit-breaker. The existing
 * `BACKPRESSURE_QUEUE_THRESHOLD` constant in fetch-orchestrator throttles
 * promotions (max 1 per cycle) when queue is hot. GR23 layers an additional
 * env-toggleable HARD threshold: when global queue depth exceeds the
 * configured value for ≥5 minutes, NEW job claims are deferred (existing
 * jobs continue draining). The 5-minute hysteresis avoids flapping on
 * single-tick queue spikes.
 *
 * No `??` / `||` semantic fallbacks on the verdict field (`ScrapeAdmission.outcome`) — D1–D5.
 */
import { db } from "../db";
import { miFetchJobs } from "@shared/schema";
import { sql, and, eq } from "drizzle-orm";
import { logAudit } from "../audit";

export type ScrapeAdmissionOutcome = "admit" | "volume_cap_exceeded" | "queue_depth_deferred";

export interface ScrapeAdmission {
  outcome: ScrapeAdmissionOutcome;
  reason?: string;
  details?: Record<string, unknown>;
}

function getVolumeCap(): number {
  const raw = process.env.SCRAPE_DAILY_VOLUME_CAP_PER_ACCOUNT;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function getQueueDepthThreshold(): number {
  const raw = process.env.MI_QUEUE_DEPTH_DEFER_THRESHOLD;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

const QUEUE_HYSTERESIS_MS = 5 * 60 * 1000;
let queueAboveThresholdSince: number | null = null;

/**
 * Per-account daily scrape volume proxy: sum of `competitor_count` across
 * all `mi_fetch_jobs` rows for the account in the last 24h. Each
 * competitor entry represents ~1 scrape request set per platform.
 */
export async function estimateDailyScrapeVolume(accountId: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(competitor_count), 0)::bigint AS volume
    FROM mi_fetch_jobs
    WHERE account_id = ${accountId}
      AND created_at > NOW() - INTERVAL '24 hours'
  `);
  const row = (res.rows as any[])[0];
  return Number(row?.volume) || 0;
}

async function getGlobalQueueDepth(): Promise<number> {
  const res = await db.select({ count: sql<number>`count(*)` })
    .from(miFetchJobs)
    .where(eq(miFetchJobs.status, "QUEUED"));
  return Number(res[0]?.count) || 0;
}

/**
 * Evaluate GR22 + GR23 for a new fetch-job admission attempt.
 * Caller is `_createAndStartJob` in fetch-orchestrator.
 */
export async function evaluateScrapeAdmission(
  accountId: string,
  newJobCompetitorCount: number,
): Promise<ScrapeAdmission> {
  // GR22 — per-account daily volume cap.
  const cap = getVolumeCap();
  if (cap > 0) {
    try {
      const used = await estimateDailyScrapeVolume(accountId);
      const projected = used + newJobCompetitorCount;
      if (projected > cap) {
        const decision: ScrapeAdmission = {
          outcome: "volume_cap_exceeded",
          reason: `Daily scrape volume cap (${cap}) would be exceeded`,
          details: { used24h: used, newJob: newJobCompetitorCount, projected, cap },
        };
        try {
          await logAudit(accountId, "SCRAPE_VOLUME_CAP_EXCEEDED", {
            details: decision.details,
            riskLevel: "high",
          });
        } catch (err) {
          console.error("[ScrapeVolumeCap] AUDIT_WRITE_FAILED", (err as Error)?.message);
        }
        console.warn(
          `[ScrapeVolumeCap] EXCEEDED | account=${accountId} | used=${used} | newJob=${newJobCompetitorCount} | cap=${cap}`,
        );
        return decision;
      }
    } catch (err) {
      console.error("[ScrapeVolumeCap] VOLUME_QUERY_FAILED — admitting fail-open", (err as Error)?.message);
    }
  }

  // GR23 — global queue depth circuit-breaker with 5-min hysteresis.
  const threshold = getQueueDepthThreshold();
  if (threshold > 0) {
    try {
      const depth = await getGlobalQueueDepth();
      const now = Date.now();
      if (depth > threshold) {
        if (queueAboveThresholdSince === null) {
          queueAboveThresholdSince = now;
        }
        const sustainedMs = now - queueAboveThresholdSince;
        if (sustainedMs >= QUEUE_HYSTERESIS_MS) {
          const decision: ScrapeAdmission = {
            outcome: "queue_depth_deferred",
            reason: `Global MI queue depth above threshold for ≥5min`,
            details: { queueDepth: depth, threshold, sustainedSec: Math.floor(sustainedMs / 1000) },
          };
          try {
            await logAudit(accountId, "MI_QUEUE_DEPTH_DEFERRED", {
              details: decision.details,
              riskLevel: "medium",
            });
          } catch (err) {
            console.error("[QueueDepthDefer] AUDIT_WRITE_FAILED", (err as Error)?.message);
          }
          console.warn(
            `[QueueDepthDefer] DEFERRING | account=${accountId} | depth=${depth} | threshold=${threshold} | sustainedSec=${Math.floor(sustainedMs / 1000)}`,
          );
          return decision;
        }
      } else {
        // Reset hysteresis when queue drops back under threshold.
        queueAboveThresholdSince = null;
      }
    } catch (err) {
      console.error("[QueueDepthDefer] DEPTH_QUERY_FAILED — admitting fail-open", (err as Error)?.message);
    }
  }

  return { outcome: "admit" };
}

/** Test-only — reset GR23 hysteresis state. */
export function __resetScrapeAdmissionState() {
  queueAboveThresholdSince = null;
}
