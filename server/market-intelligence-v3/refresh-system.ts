import type { CompetitorSignalResult, RefreshDecision } from "./types";
import { MI_REFRESH } from "./constants";

function computeVolatilityIndex(signals: CompetitorSignalResult): number {
  const s = signals.signals;
  let volatility = 0;
  let factors = 0;

  if (s.engagementVolatility > 0.5) { volatility += 0.3; factors++; }
  if (Math.abs(s.ctaIntensityShift) > MI_REFRESH.CTA_SHIFT_TRIGGER) { volatility += 0.25; factors++; }
  if (Math.abs(s.postingFrequencyTrend) > 0.3) { volatility += 0.25; factors++; }
  if (Math.abs(s.reviewVelocityChange) > MI_REFRESH.REVIEW_VELOCITY_TRIGGER) { volatility += 0.2; factors++; }

  if (factors === 0) return 0;
  return Math.min(1, volatility);
}

function determineInterval(volatilityIndex: number): number {
  if (volatilityIndex >= MI_REFRESH.HIGH_VOLATILITY_THRESHOLD) return MI_REFRESH.HIGH_VOLATILITY_DAYS;
  if (volatilityIndex >= MI_REFRESH.MODERATE_VOLATILITY_THRESHOLD) return MI_REFRESH.MODERATE_VOLATILITY_DAYS;
  return MI_REFRESH.STABLE_VOLATILITY_DAYS;
}

export function evaluateRefreshDecision(
  signal: CompetitorSignalResult,
  lastRefreshAt: Date | null,
  now: Date = new Date(),
): RefreshDecision {
  const volatilityIndex = computeVolatilityIndex(signal);
  const intervalDays = determineInterval(volatilityIndex);

  const hardCapMs = MI_REFRESH.HARD_CAP_HOURS * 60 * 60 * 1000;
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;

  let shouldRefresh = false;
  let reason = "No refresh needed";

  if (!lastRefreshAt) {
    shouldRefresh = true;
    reason = "No previous refresh recorded";
  } else {
    const timeSinceRefresh = now.getTime() - lastRefreshAt.getTime();
    if (timeSinceRefresh < hardCapMs) {
      shouldRefresh = false;
      reason = `Hard cap: ${MI_REFRESH.HARD_CAP_HOURS}h minimum between refreshes (${Math.round(timeSinceRefresh / 3600000)}h elapsed)`;
    } else if (timeSinceRefresh >= intervalMs) {
      shouldRefresh = true;
      reason = `Interval exceeded: ${intervalDays} days (volatility: ${volatilityIndex.toFixed(2)})`;
    }
  }

  const nextRefreshAt = lastRefreshAt
    ? new Date(Math.max(lastRefreshAt.getTime() + intervalMs, lastRefreshAt.getTime() + hardCapMs))
    : new Date(now.getTime() + intervalMs);

  return {
    competitorId: signal.competitorId,
    shouldRefresh,
    reason,
    nextRefreshAt,
    intervalDays,
    volatilityIndex,
  };
}

export function evaluateAllRefreshDecisions(
  signals: CompetitorSignalResult[],
  lastRefreshMap: Record<string, Date | null>,
  now: Date = new Date(),
): RefreshDecision[] {
  return signals.map(s => evaluateRefreshDecision(s, lastRefreshMap[s.competitorId] || null, now));
}
