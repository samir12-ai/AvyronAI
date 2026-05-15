import { useQuery } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";

// Task #52 / Priority #1 — Operator dashboards (in-app surface).
//
// Surfaces operational signals that were previously operator-grep-only:
//   - in-flight stats for the 3 zombie-watchdog Maps (boss locks,
//     continuity tick lock, MIv3 fetch-orchestrator activeJobs) — Seal #16.
//   - retry-loop campaigns: count of `failed` decisions per campaignId in
//     the last 24h from continuity_ticks notes. ≥3 = retry loop.
//   - stuck claim rows: continuity_window_claims with status='in_progress'
//     and claimed_at older than 2h (would normally complete in seconds).
//
// All values are admin-token-gated by the same X-Admin-Token /
// EXPO_PUBLIC_METRICS_ADMIN_TOKEN pattern as the Continuity panel.
// When the token is unset, the hook is DISABLED (returns no data, no
// error) so customer builds don't show a "Failed to load" red banner.

export interface InFlightStats {
  size: number;
  zombieEvictions: number;
  maxAgeMs: number;
  oldestAgeMs: number | null;
}

export interface ContinuityTickStats {
  inFlight: boolean;
  ageMs: number | null;
  zombieEvictions: number;
  maxAgeMs: number;
}

export interface RetryLoopCampaign {
  campaignId: string;
  failedCount24h: number;
}

export interface StuckClaim {
  campaignId: string;
  planId: string;
  windowIndex: number;
  claimedBy: string;
  claimedAt: string;
  ageMinutes: number;
}

export interface OperationsPanelData {
  bossLocks: InFlightStats;
  continuityTick: ContinuityTickStats;
  miActiveJobs: InFlightStats;
  retryLoopCampaigns: RetryLoopCampaign[];
  stuckClaims: StuckClaim[];
  generatedAt: string;
}

function getAdminToken(): string | null {
  const t = process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function operationsPanelEnabled(): boolean {
  return getAdminToken() !== null;
}

export function useOperationsPanel() {
  const baseUrl = getApiUrl();
  const token = getAdminToken();
  return useQuery<OperationsPanelData>({
    queryKey: ["operations-panel"],
    enabled: token !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const url = new URL("/api/admin/operations/panel", baseUrl).toString();
      const res = await fetch(url, {
        headers: token ? { "X-Admin-Token": token } : {},
      });
      if (!res.ok) {
        throw new Error(`operations-panel ${res.status}`);
      }
      return res.json() as Promise<OperationsPanelData>;
    },
  });
}
