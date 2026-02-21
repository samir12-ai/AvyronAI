import { logAudit } from "./audit";

interface MetaApiCallRecord {
  timestamp: number;
  success: boolean;
  latencyMs: number;
  errorType?: string;
}

interface AccountMetrics {
  calls: MetaApiCallRecord[];
  consecutiveFailures: number;
}

const metricsStore = new Map<string, AccountMetrics>();
const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function ensureAccount(accountId: string): AccountMetrics {
  let metrics = metricsStore.get(accountId);
  if (!metrics) {
    metrics = { calls: [], consecutiveFailures: 0 };
    metricsStore.set(accountId, metrics);
  }
  return metrics;
}

function pruneExpiredCalls(metrics: AccountMetrics): void {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  metrics.calls = metrics.calls.filter(c => c.timestamp > cutoff);
}

export function recordMetaApiCall(
  accountId: string,
  success: boolean,
  latencyMs: number,
  errorType?: string
): void {
  const metrics = ensureAccount(accountId);

  metrics.calls.push({
    timestamp: Date.now(),
    success,
    latencyMs,
    errorType,
  });

  if (success) {
    metrics.consecutiveFailures = 0;
  } else {
    metrics.consecutiveFailures++;
  }

  if (metrics.calls.length > 5000) {
    pruneExpiredCalls(metrics);
  }
}

export interface MetaDiagnostics {
  accountId: string;
  rollingWindow24h: {
    totalCalls: number;
    failures: number;
    failureRate: number;
    avgLatencyMs: number;
  };
  consecutiveFailures: number;
  oldestCallTimestamp: string | null;
  newestCallTimestamp: string | null;
}

export function getMetaMetrics(accountId: string): MetaDiagnostics {
  const metrics = ensureAccount(accountId);
  pruneExpiredCalls(metrics);

  const calls = metrics.calls;
  const totalCalls = calls.length;
  const failures = calls.filter(c => !c.success).length;
  const failureRate = totalCalls > 0 ? failures / totalCalls : 0;
  const avgLatencyMs = totalCalls > 0
    ? Math.round(calls.reduce((sum, c) => sum + c.latencyMs, 0) / totalCalls)
    : 0;

  return {
    accountId,
    rollingWindow24h: {
      totalCalls,
      failures,
      failureRate: Math.round(failureRate * 10000) / 10000,
      avgLatencyMs,
    },
    consecutiveFailures: metrics.consecutiveFailures,
    oldestCallTimestamp: calls.length > 0 ? new Date(calls[0].timestamp).toISOString() : null,
    newestCallTimestamp: calls.length > 0 ? new Date(calls[calls.length - 1].timestamp).toISOString() : null,
  };
}

export function getAllMetrics(): MetaDiagnostics[] {
  const results: MetaDiagnostics[] = [];
  for (const accountId of metricsStore.keys()) {
    results.push(getMetaMetrics(accountId));
  }
  return results;
}

function runCleanup(): void {
  for (const [accountId, metrics] of metricsStore.entries()) {
    pruneExpiredCalls(metrics);
    if (metrics.calls.length === 0 && metrics.consecutiveFailures === 0) {
      metricsStore.delete(accountId);
    }
  }
}

export function initMetaMetrics(): void {
  if (initialized) return;
  initialized = true;

  logAudit("system", "METRICS_RESET", {
    details: {
      reason: "Server restart — in-memory metrics cleared",
      timestamp: new Date().toISOString(),
    },
  }).catch(() => {});

  console.log("[MetaMetrics] Initialized — in-memory metrics reset logged");

  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
}

export function stopMetaMetrics(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
