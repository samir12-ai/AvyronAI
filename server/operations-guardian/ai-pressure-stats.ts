// Operations Guardian — Phase 1C AI / provider pressure aggregator.
//
// In-memory, lock-free counters fed from:
//   * server/ai-client.ts          — aiChat + aiGemini outcomes (success +
//                                    latency, AI_TIMEOUT, AI_CALL_FAILED).
//   * server/middleware/ai-rate-limit.ts — per-account 429 events.
//   * server/analytical-enrichment-layer/engine.ts — every isPartial=true
//                                    return (degraded inference signal).
//
// Doctrine compliance:
//   * Seal #15 (no silent catches) — recorders MUST never throw. Callers
//     in hot paths use a try/catch with console.error tagging at the
//     call sites themselves; this module never swallows.
//   * Seal #16 (wall-clock timing budgets unchanged) — this module does
//     not introduce any new AI calls or new wall-clock waits. It only
//     captures observations about calls that already happened.
//   * D1–D5 — outcome enum is a strict union (`success | timeout |
//     failed`); collector reads return strict-typed numbers + a
//     dedicated `partialReasons` map. No `??`/`||` semantic fallback.
//
// Memory bounds:
//   * Per-window arrays are HARD-CAPPED at MAX_SAMPLES entries. When the
//     cap is reached, the oldest entries are spliced off (FIFO).
//   * `_aiPressureStats` prunes-by-cutoff on every read so steady-state
//     memory stays bounded by the longest window's effective rate.

const TIMEOUT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const PARTIAL_WINDOW_MS = 60 * 60 * 1000;
const LATENCY_WINDOW_MS = 60 * 60 * 1000;

const MAX_SAMPLES = 5_000;
const MAX_LATENCY_SAMPLES_PER_PROVIDER = 500;

export type AICallOutcome = "success" | "timeout" | "failed";

interface OutcomeStamp {
  at: number;
}

interface LatencySample {
  at: number;
  latencyMs: number;
}

interface PartialStamp {
  at: number;
  reason: string;
}

const timeouts: OutcomeStamp[] = [];
const failures: OutcomeStamp[] = [];
const rateLimits: OutcomeStamp[] = [];
const partials: PartialStamp[] = [];
const latencyByProvider = new Map<string, LatencySample[]>();

const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function pruneByCutoff<T extends { at: number }>(arr: T[], cutoff: number): void {
  let i = 0;
  while (i < arr.length && arr[i]!.at < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

function trimToCap<T>(arr: T[], cap: number): void {
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}

export function recordAICallOutcome(args: {
  provider: string;
  outcome: AICallOutcome;
  latencyMs: number;
}): void {
  const now = Date.now();
  if (args.outcome === "success") {
    const list = latencyByProvider.get(args.provider) ?? [];
    list.push({ at: now, latencyMs: args.latencyMs });
    trimToCap(list, MAX_LATENCY_SAMPLES_PER_PROVIDER);
    latencyByProvider.set(args.provider, list);
    return;
  }
  if (args.outcome === "timeout") {
    timeouts.push({ at: now });
    trimToCap(timeouts, MAX_SAMPLES);
    return;
  }
  // outcome === "failed" — non-timeout provider failures (5xx, network
  // resets, AI_CALL_FAILED). Surfaced as its own Guardian category
  // AI_PROVIDER_FAILURE_BURST per D2 doctrine ("every meaning has its
  // own canonical field"). Same 15-min window shape as timeouts.
  failures.push({ at: now });
  trimToCap(failures, MAX_SAMPLES);
}

export function recordAIRateLimit429(): void {
  rateLimits.push({ at: Date.now() });
  trimToCap(rateLimits, MAX_SAMPLES);
}

export function recordInferencePartial(reason: string): void {
  partials.push({ at: Date.now(), reason });
  trimToCap(partials, MAX_SAMPLES);
}

export interface AIPressureStats {
  rateLimit429Count: number;
  timeoutCount: number;
  failureCount: number;
  partialCount: number;
  partialReasons: Record<string, number>;
  latencyByProvider: Record<
    string,
    { p95Ms: number; sampleCount: number }
  >;
}

function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx]!;
}

export function _aiPressureStats(now: number = Date.now()): AIPressureStats {
  pruneByCutoff(timeouts, now - TIMEOUT_WINDOW_MS);
  pruneByCutoff(failures, now - FAILURE_WINDOW_MS);
  pruneByCutoff(rateLimits, now - RATE_LIMIT_WINDOW_MS);
  pruneByCutoff(partials, now - PARTIAL_WINDOW_MS);

  const latency: Record<string, { p95Ms: number; sampleCount: number }> = {};
  const cutoff = now - LATENCY_WINDOW_MS;
  for (const [provider, list] of latencyByProvider.entries()) {
    while (list.length > 0 && list[0]!.at < cutoff) list.shift();
    if (list.length === 0) {
      latencyByProvider.delete(provider);
      continue;
    }
    latency[provider] = {
      p95Ms: p95(list.map((s) => s.latencyMs)),
      sampleCount: list.length,
    };
  }

  const partialReasons: Record<string, number> = {};
  for (const p of partials) {
    partialReasons[p.reason] = (partialReasons[p.reason] ?? 0) + 1;
  }

  return {
    rateLimit429Count: rateLimits.length,
    timeoutCount: timeouts.length,
    failureCount: failures.length,
    partialCount: partials.length,
    partialReasons,
    latencyByProvider: latency,
  };
}

// Test-only: drain every counter. Mirrors the convention used elsewhere
// (`__resetAiRateLimitBuckets`, `_resetCampaignLock`).
export function _resetAIPressureStatsForTest(): void {
  timeouts.length = 0;
  failures.length = 0;
  rateLimits.length = 0;
  partials.length = 0;
  latencyByProvider.clear();
}
