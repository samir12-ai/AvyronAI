import { useQuery } from '@tanstack/react-query';
import { getApiUrl, authFetch } from '@/lib/query-client';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

export function useAudiencePositioning(campaignId: string | null | undefined) {
  return useQuery<AudiencePositioningViewModel>({
    queryKey: ['audience-positioning', campaignId],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('campaignId is required');
      }

      const url = getApiUrl(`/api/intelligence/audience-positioning/${encodeURIComponent(campaignId)}`);
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
