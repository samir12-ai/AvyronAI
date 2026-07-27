import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";

// P-2 Final — read model for GET /api/perception/performance-cycle.
// Customer-safe payload: week number + dates only, no internal ids.

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

export interface PerformanceCycleDecision {
  dimension: string;
  value: string;
  executed: boolean;
  postCount: number;
  verdict: "WINNER" | "LOSER" | "INCONCLUSIVE" | "NOT_EXECUTED" | "NEEDS_MORE_DATA";
  reason: string;
  evidenceStrength: string;
  confidence: number | null;
  confounders: string[];
}

export interface PerformanceCycleNextStep {
  keepDoing: string[];
  stopDoing: string[];
  retryWithBetterData: string[];
  executeWhatWasPlanned: string[];
  nextExperiment: string | null;
  rationale: string;
}

export interface PerformanceCycleResponse {
  success: true;
  state: "ready" | "no_cycle_yet";
  cycle: null | {
    weekNumber: number;
    periodStart: string | null;
    periodEnd: string | null;
    platform: string;
    sales: { before: number | null; after: number | null };
    businessVerdict: string | null;
    attributionConfidence: string | null;
    decisions: PerformanceCycleDecision[];
    verdictCounts: Record<string, number>;
    nextStep: PerformanceCycleNextStep | null;
    review: Record<string, unknown> | null;
    isTestCycle: boolean;
    testLabel: string | null;
    generatedAt: string | null;
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(`${path} not-success`);
  return data as T;
}

export function usePerformanceCycle(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<PerformanceCycleResponse>({
    queryKey: ["/api/perception/performance-cycle", campaignId],
    queryFn: () => fetchJson<PerformanceCycleResponse>(`/api/perception/performance-cycle?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    // The cycle is generated asynchronously after truth submission — poll
    // gently while active so the review appears without a manual refresh.
    refetchInterval: active ? 5 * 60_000 : false,
  });
}
