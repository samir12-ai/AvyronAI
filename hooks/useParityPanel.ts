import { useQuery } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";
import { isOperatorSurfaceEnabled } from "@/hooks/useOperatorSurface";

// Task #91 / Phase 4-C — Operator-visible Parity Gate surface (client).
//
// Mirrors the canonical shape of `/healthz/orchestrator-parity`. Strict
// types — every field is required at the type boundary so the panel can
// render a deterministic badge row without `?? false` substitutions
// (D2/D3 doctrine).

export type ParityPathShape =
  | "clean"
  | "gate_retry"
  | "budget_downgrade"
  | "scoped_rerun"
  | "blocked_by_integrity"
  | "needs_input"
  | "error";

export interface ParityAutoRevertRow {
  at: string;
  moduleId: string;
  moduleFlag: string;
  reason: string;
  suppressed: boolean;
}

export interface ParityDivergencePathRow {
  divergenceClass: string;
  path: string;
  count: number;
}

export interface ParityHealthData {
  readyForCutover: boolean;
  blockers: string[];
  cassetteCount: number;
  oldestCassetteAgeH: number;
  divergencesByClassLast24h: Record<string, number>;
  divergencePathsByClassLast24h: ParityDivergencePathRow[];
  autoRevertsLast24h: ParityAutoRevertRow[];
  modulesAtCandidate: string[];
  modulesAwaitingBurnIn: Array<{ moduleId: string; daysAtCandidate: number | null }>;
  modulesBlocked: string[];
  modulesShadowOnly: string[];
  pathShapeCoverage: Record<string, { count: number; covered: boolean }>;
  lastTickAt: string | null;
  candidateWiringDeferred: boolean;
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
