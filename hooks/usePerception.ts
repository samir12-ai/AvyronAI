import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";
import type { WatchtowerLine, ActivityEvent, BlockedReason } from "@shared/perception-translator";

// Battery doctrine — pause polling when the app is backgrounded. React
// Query will resume on next foreground (refetch fires immediately if the
// data is stale). Used by all perception hooks below.
function useIsAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      setActive(state === "active");
    });
    return () => sub.remove();
  }, []);
  return active;
}

export interface WatchtowerResponse {
  success: true;
  state: "ready" | "no_data";
  lastCheckedAt: string | null;
  lines: { id: "market" | "plan" | "freshness"; line: WatchtowerLine }[];
}

export interface ActivityResponse {
  success: true;
  state: "ready" | "watching";
  sinceHours: number;
  events: ActivityEvent[];
}

export interface MonitoringResponse {
  success: true;
  state: "ready" | "watching";
  facts: {
    competitorsWatched: number;
    competitorPostsAnalyzed7d: number;
    publishedPosts: number;
    validatedInsights: number;
    baselineStatus: "forming" | "ready";
    lastScanAt: string | null;
    lastReviewAt: string | null;
  };
  lines: (WatchtowerLine & { id: string })[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(`${path} not-success`);
  return data as T;
}

export function useWatchtower(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<WatchtowerResponse>({
    queryKey: ["/api/perception/watchtower", campaignId],
    queryFn: () => fetchJson<WatchtowerResponse>(`/api/perception/watchtower?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}

export function useActivityTimeline(campaignId: string | null | undefined, sinceHours = 168) {
  const active = useIsAppActive();
  return useQuery<ActivityResponse>({
    queryKey: ["/api/perception/activity", campaignId, sinceHours],
    queryFn: () => fetchJson<ActivityResponse>(`/api/perception/activity?campaignId=${campaignId}&sinceHours=${sinceHours}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}

export interface BlockedReasonsResponse {
  success: true;
  state: "ready" | "no_data";
  lastCheckedAt: string | null;
  reasons: BlockedReason[];
  truthDue: { windowId: string; windowEndsAt: string; isLate: boolean } | null;
}

export function useBlockedReasons(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<BlockedReasonsResponse>({
    queryKey: ["/api/perception/blocked-reasons", campaignId],
    queryFn: () => fetchJson<BlockedReasonsResponse>(`/api/perception/blocked-reasons?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 2 * 60_000,
    refetchInterval: active ? 2 * 60_000 : false,
  });
}

export function useMonitoring(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<MonitoringResponse>({
    queryKey: ["/api/perception/monitoring", campaignId],
    queryFn: () => fetchJson<MonitoringResponse>(`/api/perception/monitoring?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}
