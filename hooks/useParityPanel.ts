import { useQuery } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";
import { isOperatorSurfaceEnabled } from "@/hooks/useOperatorSurface";

// Task #91 / Phase 4-C — Operator-visible Replay Regression Suite (client).
//
// Reclassified by Task #93 / Phase 4-E: the cutover-era fields
// (readyForCutover, modules*, autoReverts, candidateWiringDeferred) have
// been removed. The panel now reports CORPUS regression health only.

export type ParityPathShape =
  | "clean"
  | "gate_retry"
  | "budget_downgrade"
  | "scoped_rerun"
  | "blocked_by_integrity"
  | "needs_input"
  | "error";

export interface ParityDivergencePathRow {
  divergenceClass: string;
  path: string;
  count: number;
}

export interface ParityHealthData {
  blockers: string[];
  cassetteCount: number;
  oldestCassetteAgeH: number;
  divergencesByClassLast24h: Record<string, number>;
  divergencePathsByClassLast24h: ParityDivergencePathRow[];
  pathShapeCoverage: Record<string, { count: number; covered: boolean }>;
  lastTickAt: string | null;
  shadowMode: boolean;
  scheduler?: {
    lastTickAt: string | null;
    lastTickDurationMs: number | null;
    cassettesEvaluated: number | null;
    errorsLastTick: number | null;
  } | null;
}

function getAdminToken(): string | null {
  const t = process.env.EXPO_PUBLIC_METRICS_ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function parityPanelEnabled(): boolean {
  return isOperatorSurfaceEnabled();
}

export function useParityPanel() {
  const baseUrl = getApiUrl();
  const token = getAdminToken();
  return useQuery<ParityHealthData>({
    queryKey: ["parity-panel"],
    enabled: token !== null,
    refetchInterval: 60_000,
    queryFn: async () => {
      const url = new URL("/healthz/orchestrator-parity", baseUrl).toString();
      const res = await fetch(url, {
        headers: token ? { "X-Admin-Token": token } : {},
      });
      if (!res.ok) {
        throw new Error(`parity-panel ${res.status}`);
      }
      return res.json() as Promise<ParityHealthData>;
    },
  });
}
