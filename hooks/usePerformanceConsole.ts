import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";

// Read model for GET /api/performance/console — the aggregate payload behind
// the Performance page. Every section carries a truthful `state` key (see
// shared/performance-labels.ts SECTION_STATE_LABELS); nothing is fabricated
// for empty layers.

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

export type SectionState =
  | "ready"
  | "awaiting_user_truth"
  | "awaiting_scrape"
  | "awaiting_classification"
  | "awaiting_lineage"
  | "awaiting_checkpoint_maturity"
  | "insufficient_evidence"
  | "failed"
  | "stale"
  | "unavailable"
  | "not_configured";

export interface ConsoleSetup {
  state: SectionState;
  channels: { platform: string; handle: string | null; url: string | null; addedAt: string | null }[];
  lastScrapeAt: string | null;
  lastScrapeStatus: string | null;
  nextScrapeDueAt: string | null;
  approvedPlanId: string | null;
}

export interface ConsolePostClassification {
  hookArchetype: string | null;
  narrative: string | null;
  contentFormatIntent: string | null;
  primaryGoal: string | null;
  confidence: number | null;
}

export interface ConsolePost {
  id: string;
  platform: string;
  permalink: string | null;
  caption: string | null;
  postedAt: string | null;
  lineageState: string | null;
  matchConfidence: number | null;
  hookStyle: string | null;
  contentAngle: string | null;
  contentType: string | null;
  snapshotCount: number;
  classification: ConsolePostClassification | null;
  classificationStatus: string;
}

export interface ConsolePosts {
  state: SectionState;
  total: number;
  lineageCounts: Record<string, number>;
  classification: { classified: number; failed: number; pending: number };
  recent: ConsolePost[];
}

export interface ConsoleExecutionRow {
  dimension: string;
  value: string;
  executionStatus: "EXECUTED" | "PARTIALLY_EXECUTED" | "NOT_EXECUTED" | "NOT_YET_DUE" | "UNVERIFIED" | "BLOCKED";
  reason: string;
  matchedPostCount: number;
  windowPostCount: number;
  evidencePostIds: string[];
}

export interface ConsoleExecution {
  state: SectionState;
  reason: string | null;
  comparison: null | {
    windowStart: string | null;
    windowEnd: string | null;
    lastSuccessfulScrapeAt: string | null;
    rows: ConsoleExecutionRow[];
  };
}

export interface ConsoleContentScore {
  dimension: string;
  dimensionValue: string;
  verdict: string;
  primaryMetric: string | null;
  measuredValue: number | null;
  baselineValue: number | null;
  relativeDelta: number | null;
  sampleSize: number;
  maturity: string;
  confidence: number | null;
  confounders: string[];
}

export interface ConsoleContentScores {
  state: SectionState;
  scoredAt: string | null;
  scores: ConsoleContentScore[];
}

export interface ConsoleWindow {
  windowIndex: number;
  state: string;
  windowStart: string;
  windowEnd: string;
  truthSubmitted: boolean;
}

export interface ConsoleBusiness {
  state: SectionState;
  openWindow: null | {
    windowIndex: number;
    windowStart: string;
    windowEnd: string;
    truthSubmitted: boolean;
    windowEnded: boolean;
  };
  windows: ConsoleWindow[];
  weeklyScore: null | {
    windowIndex: number;
    businessVerdict: string | null;
    verdictReason: string | null;
    attributionConfidence: string | null;
    leads: number | null;
    qualified: number | null;
    booked: number | null;
    payingCustomers: number | null;
    scoredAt: string | null;
  };
}

export interface ConsoleVerdict {
  dimension: string;
  value: string;
  executed: boolean;
  executedPostCount: number | null;
  verdict: string;
  reason: string | null;
  evidenceStrength: string | null;
  confidence: number | null;
  confounders: string[];
  memoryWriteStatus: string | null;
}

export interface ConsoleOutcome {
  dimension: string;
  value: string;
  executionStatus: string;
  outcome: string;
  confidence: number | null;
  attributionLevel: string | null;
  preMetrics: Record<string, unknown>;
  postMetrics: Record<string, unknown>;
  evaluatedAt: string | null;
}

export interface ConsoleCycle {
  state: SectionState;
  report: null | {
    windowIndex: number;
    platform: string | null;
    status: string;
    salesBefore: number | null;
    salesAfter: number | null;
    businessVerdict: string | null;
    attributionConfidence: string | null;
    verdictCounts: Record<string, number>;
    nextCycleRecommendation: Record<string, unknown>;
    sevenAnswers: Record<string, unknown>;
    interpretationStatus: string | null;
    isTestCycle: boolean;
    completedAt: string | null;
    createdAt: string | null;
  };
  verdicts: ConsoleVerdict[];
  outcomes: ConsoleOutcome[];
  history: {
    windowIndex: number;
    businessVerdict: string | null;
    salesBefore: number | null;
    salesAfter: number | null;
    verdictCounts: Record<string, number>;
    createdAt: string | null;
  }[];
}

// Field names mirror the server-persisted JSON exactly
// (server/performance-loop/interpretation.ts PerformanceEvidenceEntry /
// PerformanceJudgeClaim). Do not rename on the client.
export interface ConsoleTrustEvidence {
  evidenceId: string;
  category: string;
  summary: string;
  [key: string]: unknown;
}

export interface ConsoleTrustClaim {
  claimId: string;
  claimText: string;
  claimType: string;
  criticality: "critical" | "secondary" | string;
  evidenceRefs: string[];
  verdict: "supported" | "partially_supported" | "unsupported" | "contradicted" | string;
  violations: string[];
  judgeReason: string;
  [key: string]: unknown;
}

export interface ConsoleTrust {
  state: SectionState;
  evidenceRegistry: ConsoleTrustEvidence[];
  guardResults: Record<string, unknown> | null;
  judgeClaims: ConsoleTrustClaim[];
  versions: Record<string, unknown> | null;
  interpretationStatus: string | null;
}

export interface ConsoleMemoryRecord {
  label: string;
  direction: string | null;
  details: string | null;
  confidence: number | null;
  decayRate: number | null;
  validationCount: number | null;
  lastValidatedAt: string | null;
  updatedAt: string | null;
  provenanceOrigin: string | null;
}

export interface ConsoleMemory {
  state: SectionState;
  records: ConsoleMemoryRecord[];
}

export interface PerformanceConsoleResponse {
  success: true;
  generatedAt: string;
  setup: ConsoleSetup;
  posts: ConsolePosts;
  execution: ConsoleExecution;
  contentScores: ConsoleContentScores;
  business: ConsoleBusiness;
  cycle: ConsoleCycle;
  trust: ConsoleTrust;
  memory: ConsoleMemory;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await authFetch(new URL(path, getApiUrl()).toString());
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(`${path} not-success`);
  return data as T;
}

export function usePerformanceConsole(campaignId: string | null | undefined) {
  const active = useIsAppActive();
  return useQuery<PerformanceConsoleResponse>({
    queryKey: ["/api/performance/console", campaignId],
    queryFn: () => fetchJson<PerformanceConsoleResponse>(`/api/performance/console?campaignId=${campaignId}`),
    enabled: !!campaignId,
    staleTime: 2 * 60_000,
    refetchInterval: active ? 5 * 60_000 : false,
  });
}
