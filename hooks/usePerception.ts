import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  id: string;
  status: string;
  kind: string;
  label: string;
  severity: "mild" | "medium" | "major";
  scope: "single_competitor" | "several_competitors" | "market_wide";
  scopeCompetitorCount: number;
  competitor: string | null;
  competitorIds?: string[];
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

// ── Market insight (AI Interpretation Layer — grounded, judge-approved) ──────
export interface MarketInsightResponse {
  success: true;
  state: "ready";
  source: "ai" | "deterministic";
  headline: string;
  narrative: string;
  signalGroups: Array<{ title: string; signals: string[]; observation: string }>;
  strongestObservations: string[];
  uncertainObservations: string[];
  generatedAt: string;
  windowDays: number;
  basedOn: { confirmedShifts: number; posts: number; competitors: number };
}

export function useMarketInsight(campaignId: string | null | undefined, windowDays: 7 | 30 | 90 = 30) {
  const active = useIsAppActive();
  return useQuery<MarketInsightResponse>({
    queryKey: ["/api/perception/market-insight", campaignId, windowDays],
    queryFn: () => fetchJson<MarketInsightResponse>(`/api/perception/market-insight?campaignId=${campaignId}&window=${windowDays}`),
    enabled: !!campaignId,
    staleTime: 15 * 60_000,          // server reuses insight via payload fingerprint; poll gently
    refetchInterval: active ? 15 * 60_000 : false,
  });
}

// ── Strategic Reasoning Cards (P-4 — evidence-cited, judge-approved) ─────────
export interface ReasoningCardItem {
  cardType:
    | "market_direction"
    | "market_momentum"
    | "recurring_pattern"
    | "strategic_context"
    | "competitive_pressure"
    | "evidence_summary"
    | "confidence"
    | "uncertainty";
  title: string;
  body: string;
  evidenceRefs: string[];
  confidence: "high" | "medium" | "low";
}

export interface ReasoningCardsResponse {
  success: true;
  state: "ready" | "no_history";
  source: "ai" | "deterministic";
  cards: ReasoningCardItem[];
  evidence: Array<{ ref: string; type: string; label: string }>;
  generatedAt: string;
}

export function useReasoningCards(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<ReasoningCardsResponse>({
    queryKey: ["/api/perception/reasoning-cards", campaignId],
    queryFn: () => fetchJson<ReasoningCardsResponse>(`/api/perception/reasoning-cards?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 30 * 60_000,          // server reuses cards via context fingerprint
    refetchInterval: active ? 30 * 60_000 : false,
  });
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

// ── Strategic Briefs (Watchtower Strategic Interpretation Layer) ────────────────
export interface StrategicBriefResponse {
  success: boolean;
  data: {
    id?: string;
    eventId: string;
    status: "awaiting_analysis" | "queued" | "generating" | "validating" | "ready" | "insufficient_evidence" | "failed";
    brief?: {
      eventId: string;
      executiveSummary: string;
      strategicInterpretation: string;
      likelyStrategicObjective: string;
      directionOfMovement: string;
      affectedStrategyAreas: string[];
      impactOnOurStrategy: string;
      marketSignificance: string;
      strategicImportance: "low" | "medium" | "high";
      recommendation: "ignore" | "monitor" | "review";
      modelProposedConfidence: number;
      evidenceRefs: string[];
      missingEvidence: string[];
      assumptions: string[];
      claims: Array<{
        claimId: string;
        claimText: string;
        claimType: string;
        evidenceRefs: string[];
        criticality: "critical" | "secondary";
        factuality: "observed" | "calculated" | "inferred";
      }>;
    };
    evidenceRegistry?: Array<{
      ref: string;
      origin: string;
      timestamp: string;
      engine: string;
      table: string;
      recordId: string | null;
      factType: "observed" | "calculated" | "inferred";
      age: string;
      freshnessStatus: string;
      confidence: string | null;
      relevanceScore: number;
      inclusionReason: string;
      detail: string;
      label: string;
    }>;
    contextLineage?: Array<{
      recordId: string;
      table: string;
      engine: string;
      verdict: "included" | "excluded";
      exclusionReason: string | null;
      relevanceScore: number;
      freshnessState: string;
      tokenCostEstimate: number;
    }>;
    sourceVersions?: Record<string, string>;
    finalValidatedConfidence?: number;
    modelProposedConfidence?: number;
    confidenceAdjustmentReasons?: string[];
    completedAt?: string | null;
    isLatest?: boolean;
    failureCode?: string | null;
    failureDetails?: {
      stage: string;
      message: string;
      retryability: boolean;
      timestamp: string;
      category: string;
    } | null;
  };
}

async function postJson<T>(path: string, body?: any): Promise<T> {
  const res = await authFetch(new URL(path, getApiUrl()).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(`${path} not-success`);
  return data as T;
}

export function useStrategicBrief(campaignId: string | null | undefined, eventId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<StrategicBriefResponse>({
    queryKey: ["/api/strategic-briefs/event", campaignId, eventId],
    queryFn: () => fetchJson<StrategicBriefResponse>(`/api/strategic-briefs/event/${eventId}?campaignId=${campaignId}`),
    enabled: !!campaignId && !!eventId,
    staleTime: 10 * 1000, // Poll more frequently while building
    refetchInterval: (query) => {
      // React Query v5: callback receives the Query object, not the data directly.
      // Data lives at query.state.data — using the old v4 (data) => signature
      // silently disables polling (status always undefined → always returns false).
      const status = (query.state.data as StrategicBriefResponse | undefined)?.data?.status;
      if (status === "queued" || status === "generating" || status === "validating") {
        return active ? 3000 : false; // Poll every 3s if app active and job in progress
      }
      return false; // Stop polling when in final state
    },
  });
}

export function useGenerateStrategicBrief(campaignId: string | null | undefined, eventId: string | null | undefined) {
  return useMutation<any, Error, void>({
    mutationFn: () => postJson<any>(`/api/strategic-briefs/event/${eventId}/generate?campaignId=${campaignId}`),
  });
}

export function useRetryStrategicBrief(campaignId: string | null | undefined, briefId: string | null | undefined) {
  return useMutation<any, Error, void>({
    mutationFn: () => postJson<any>(`/api/strategic-briefs/${briefId}/retry?campaignId=${campaignId}`),
  });
}
