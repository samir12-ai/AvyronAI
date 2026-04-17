import { useQuery } from '@tanstack/react-query';
import { getApiUrl, authFetch } from '@/lib/query-client';

export interface RunAnchor {
  runId: string | null;
  isLatest: boolean;
  isStale: boolean;
  completedAt: string | null;
  hasPlan?: boolean;
}

export function useRunAnchor(campaignId: string | null | undefined, requestedRunId?: string | null) {
  const baseUrl = getApiUrl();
  return useQuery<RunAnchor>({
    queryKey: ['run-anchor', campaignId, requestedRunId || null],
    queryFn: async () => {
      const url = new URL(`/api/plans/active/${campaignId}`, baseUrl);
      if (requestedRunId) url.searchParams.set('runId', requestedRunId);
      const res = await authFetch(url.toString());
      const json = await res.json();
      return {
        runId: json.runId ?? null,
        isLatest: json.isLatest ?? true,
        isStale: json.isStale ?? false,
        completedAt: json.completedAt ?? null,
        hasPlan: json.hasPlan ?? false,
      };
    },
    enabled: !!campaignId,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}
