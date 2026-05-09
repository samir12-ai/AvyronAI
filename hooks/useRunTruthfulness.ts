import { useQuery } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";

export type TruthfulnessHeadline =
  | "no_run"
  | "shadowed"
  | "system_untrusted"
  | "blocked"
  | "needs_reconciliation"
  | "review_required"
  | "downgrade"
  | "repair"
  | "ok";

export interface StructuralCheckLite {
  check: string;
  status: "PASS" | "FAIL" | "BLOCK" | "SKIPPED" | "NOT_REACHED" | "TIMEOUT" | "STALE" | "UNKNOWN";
  passed: boolean;
  details?: string;
  unverifiedReason?: string;
}

export interface BlockReasonLite {
  code: string;
  description: string;
  source: string;
  severity: "critical" | "high";
}

export interface RunTruthfulness {
  campaignId: string;
  runId: string | null;
  runStatus: string | null;
  isLatest: boolean;
  isStale: boolean;
  completedAt: string | null;
  newerNonResolvableRun: {
    runId: string;
    status: string;
    createdAt: string | null;
    completedAt: string | null;
  } | null;
  verdict: {
    id: string;
    jobId: string | null;
    verdict: "PASS" | "DOWNGRADE" | "REPAIR" | "BLOCK";
    executionMode: string;
    blockReasons: BlockReasonLite[];
    downgrades: any[];
    structuralChecks: StructuralCheckLite[];
    contradictions: any[];
    repairActions: any[];
    repairAttempted: boolean;
    checksTotal: number;
    checksPassed: number;
    durationMs: number;
    controlVersion: string;
    createdAt: string;
  } | null;
  freshness: {
    hasStaleSnapshots: boolean;
    staleEngines: string[];
    details: string | null;
  };
  headline: TruthfulnessHeadline;
  shouldShowBanner: boolean;
}

export function useRunTruthfulness(campaignId: string | null | undefined) {
  const baseUrl = getApiUrl();
  return useQuery<RunTruthfulness>({
    queryKey: ["run-truthfulness", campaignId],
    queryFn: async () => {
      const url = new URL(`/api/system-control/run-truthfulness/${campaignId}`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) {
        throw new Error(`run-truthfulness ${res.status}`);
      }
      return res.json();
    },
    enabled: !!campaignId,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}
