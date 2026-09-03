import { useQuery } from '@tanstack/react-query';
import { getApiUrl, authFetch } from '@/lib/query-client';
import type {
  MarketIntelligenceBundleViewModel,
  CompetitorDossierViewModel,
} from '@/types/market-intelligence';

export function useMarketIntelligence(campaignId: string | null | undefined, competitorId?: string | null) {
  return useQuery<MarketIntelligenceBundleViewModel>({
    queryKey: ['market-intelligence-bundle', campaignId, competitorId || 'none'],
    queryFn: async () => {
      if (!campaignId) {
        throw new Error('campaignId is required');
      }

      const q = competitorId ? `?competitorId=${encodeURIComponent(competitorId)}` : '';
      const url = getApiUrl(`/api/intelligence/market/${encodeURIComponent(campaignId)}${q}`);
      const res = await authFetch(url);

      if (!res.ok) {
        throw new Error(`Failed to load market intelligence: ${res.statusText}`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to retrieve market intelligence data.');
      }

      return json.data as MarketIntelligenceBundleViewModel;
    },
    enabled: !!campaignId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCompetitorDossier(campaignId: string | null | undefined, competitorId: string | null | undefined) {
  return useQuery<CompetitorDossierViewModel>({
    queryKey: ['competitor-dossier', campaignId, competitorId],
    queryFn: async () => {
      if (!campaignId || !competitorId) {
        throw new Error('campaignId and competitorId are required');
      }

      const url = getApiUrl(`/api/intelligence/market/${encodeURIComponent(campaignId)}/competitor/${encodeURIComponent(competitorId)}`);
      const res = await authFetch(url);

      if (!res.ok) {
        throw new Error(`Failed to load competitor dossier: ${res.statusText}`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to retrieve competitor dossier.');
      }

      return json.data as CompetitorDossierViewModel;
    },
    enabled: !!campaignId && !!competitorId,
    staleTime: 5 * 60 * 1000,
  });
}
