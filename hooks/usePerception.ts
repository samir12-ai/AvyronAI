import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";
import type { WatchtowerLine, ActivityEvent } from "@shared/perception-translator";

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
  return useQuery<WatchtowerResponse>({
    queryKey: ["/api/perception/watchtower", campaignId],
    queryFn: () => fetchJson<WatchtowerResponse>(`/api/perception/watchtower?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useActivityTimeline(campaignId: string | null | undefined, sinceHours = 168) {
  return useQuery<ActivityResponse>({
    queryKey: ["/api/perception/activity", campaignId, sinceHours],
    queryFn: () => fetchJson<ActivityResponse>(`/api/perception/activity?campaignId=${campaignId}&sinceHours=${sinceHours}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useMonitoring(campaignId: string | null | undefined) {
  return useQuery<MonitoringResponse>({
    queryKey: ["/api/perception/monitoring", campaignId],
    queryFn: () => fetchJson<MonitoringResponse>(`/api/perception/monitoring?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
