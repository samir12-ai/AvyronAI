import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";
import type { WatchtowerLine, ActivityEvent, BlockedReason } from "@shared/perception-translator";
export type { WatchtowerLine, ActivityEvent, BlockedReason } from "@shared/perception-translator";

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

// DNA Enrichment Gate (Path B) — the campaign owner's prompt to confirm a
// grounded differentiator when the Positioning/Offer interchangeability judge
// keeps rejecting a generic, reused strategy. engineKind is the canonical engine
// tag; the customer surface maps it to plain English in the card.
export interface DnaEnrichmentPendingItem {
  engineKind: "positioning_claim" | "offer";
  suggestionText: string | null;
  candidateDifferentiator: string | null;
  groundingRefs: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DnaEnrichmentPendingResponse {
  success: true;
  requests: DnaEnrichmentPendingItem[];
}

// ── Market signals (confirmed Watchtower semantic shift events) ───────────────
export interface MarketSignal {
  kind: string;
  label: string;
  severity: "mild" | "medium" | "major";
  scope: "single_competitor" | "several_competitors" | "market_wide";
  scopeCompetitorCount: number;
  competitor: string | null;
  evidence: string[];
  detectedAt: string | null;
}

export interface MarketSignalsResponse {
  success: true;
  state: "ready" | "no_signals";
  signals: MarketSignal[];
}

export function useMarketSignals(campaignId: string | null | undefined, limit = 10) {
  const active = useIsAppActive();
  return useQuery<MarketSignalsResponse>({
    queryKey: ["/api/perception/market-signals", campaignId, limit],
    queryFn: () => fetchJson<MarketSignalsResponse>(`/api/perception/market-signals?campaignId=${campaignId}&limit=${limit}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}

// ── Market snapshot (Distribution Intelligence Layer) ─────────────────────────
export interface MarketDistributionEntry {
  value: string;
  share: number;
  count: number;
}

export interface MarketInsight {
  dimension: string;
  dimensionLabel: string;
  leader: string | null;
  leaderShare: number;
  previousLeader: string | null;
  trend: "rising" | "falling" | "stable" | "new_leader" | "insufficient_history";
  trendLabel: string;
  trendDeltaPp: number;
  distribution: MarketDistributionEntry[];
  sampleSize: number;
  competitorCount: number;
  confidence: "high" | "medium" | "low";
  windowDays: number;
  evidence: string[];
}

export interface MarketPattern {
  dimensionLabel: string;
  value: string;
  currentShare: number;
  previousShare: number;
  deltaPp: number;
  competitorCount: number;
  evidence: string[];
}

export interface MarketAdoptionSeries {
  dimensionLabel: string;
  value: string;
  direction: "emerging" | "declining";
  growthPp: number;
  accelerationPp: number;
  points: Array<{ bucketStart: string; share: number; posts: number }>;
}

export interface MarketSnapshotResponse {
  success: true;
  state: "ready" | "building_baseline";
  windowDays: number;
  generatedAt: string;
  totalPosts: number;
  totalCompetitors: number;
  dataStatus: "ok" | "thin" | "insufficient";
  insights: MarketInsight[];
  emerging: MarketPattern[];
  declining: MarketPattern[];
  adoption: MarketAdoptionSeries[];
}

export function useMarketSnapshot(campaignId: string | null | undefined, windowDays: 7 | 30 | 90 = 30) {
  const active = useIsAppActive();
  return useQuery<MarketSnapshotResponse>({
    queryKey: ["/api/perception/market-snapshot", campaignId, windowDays],
    queryFn: () => fetchJson<MarketSnapshotResponse>(`/api/perception/market-snapshot?campaignId=${campaignId}&window=${windowDays}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}

export function useDnaEnrichment(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<DnaEnrichmentPendingResponse>({
    queryKey: ["/api/dna-enrichment/pending", campaignId],
    queryFn: () => fetchJson<DnaEnrichmentPendingResponse>(`/api/dna-enrichment/pending?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 2 * 60_000,
    refetchInterval: active ? 2 * 60_000 : false,
  });
}
