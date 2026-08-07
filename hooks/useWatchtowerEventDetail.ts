import { useQuery } from '@tanstack/react-query';
import { WatchtowerEventDetailResponse } from '@/types/watchtower';
import { getApiUrl, authFetch } from '@/lib/query-client';

/**
 * Single source of truth for the Watchtower Event Detail panel.
 * Handles race condition protection natively via React Query's query cancellation 
 * (AbortSignal passed to fetch) and caching by eventId.
 */
export function useWatchtowerEventDetail(campaignId: string | null, eventId: string | null) {
  return useQuery<WatchtowerEventDetailResponse, Error>({
    queryKey: ['watchtower-event', campaignId, eventId],
    queryFn: async ({ signal }) => {
      if (!eventId || !campaignId) {
        throw new Error('Missing identity for detail fetch');
      }

      const url = new URL(`/api/perception/watchtower-events/${eventId}`, getApiUrl());
      
      const res = await authFetch(url.toString(), {
        signal, // Wires up AbortController automatically for rapid selection
      });

      if (res.status === 404) {
        throw new Error('EVENT_NOT_FOUND');
      }

      if (!res.ok) {
        throw new Error('WATCHTOWER_DETAIL_FAILED');
      }

      const payload = await res.json();
      if (!payload.success || !payload.data) {
        throw new Error('Invalid payload from detail endpoint');
      }

      return payload.data as WatchtowerEventDetailResponse;
    },
    enabled: !!eventId && !!campaignId,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error) => {
      if (error.message === 'EVENT_NOT_FOUND') return false;
      return failureCount < 2;
    }
  });
}
