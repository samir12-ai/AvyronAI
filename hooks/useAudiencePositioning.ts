import { useQuery } from '@tanstack/react-query';
import { getApiUrl, authFetch } from '@/lib/query-client';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

export interface UseAudiencePositioningOptions {
  planId?: string | null;
  runId?: string | null;
}

export function useAudiencePositioning(
  campaignId: string | null | undefined,
  options?: UseAudiencePositioningOptions,
) {
  const planId = options?.planId || undefined;
  const runId = options?.runId || undefined;

  return useQuery<AudiencePositioningViewModel>({
    queryKey: ['audience-positioning', campaignId, planId ?? null, runId ?? null],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('campaignId is required');
      }

      const params = new URLSearchParams();
      if (planId) params.set('planId', planId);
      if (runId) params.set('runId', runId);
      const qs = params.toString();
      const url = getApiUrl(
        `/api/intelligence/audience-positioning/${encodeURIComponent(campaignId)}${qs ? `?${qs}` : ''}`,
      );
      const res = await authFetch(url);

      if (!res.ok) {
        throw new Error(`Failed to load intelligence data: ${res.statusText}`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to retrieve audience & positioning intelligence.');
      }

      return json.data as AudiencePositioningViewModel;
    },
    enabled: !!campaignId,
    staleTime: 0,
  });
}
