import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";

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

export type ReasoningCardState = "ok" | "degraded" | "insufficient" | "missing";
export type ReasoningProvenance = "live" | "benchmark" | "mixed" | null;

export interface ReasoningCard {
  id:
    | "competitor_scan"
    | "audience_insights"
    | "market_position"
    | "offer_logic"
    | "story_arc"
    | "reasoning_checks";
  label: string;
  state: ReasoningCardState;
  reason: string | null;
  confidence: number | null;
  provenance: ReasoningProvenance;
  lastUpdatedAt: string | null;
  evidence: string | null;
  safe?: boolean | null;
}

export interface ReasoningResponse {
  success: true;
  state: "ready" | "no_data";
  cards: ReasoningCard[];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(`${path} not-success`);
  return data as T;
}

export function useReasoning(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<ReasoningResponse>({
    queryKey: ["/api/perception/reasoning", campaignId],
    queryFn: () => fetchJson<ReasoningResponse>(`/api/perception/reasoning?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 5 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}
