import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl, authFetch, queryClient } from '@/lib/query-client';
import { useAuth } from './AuthContext';

interface CampaignInfo {
  id: string;
  name: string;
  platform: string;
  goalType: string;
  status: string;
  budget?: string;
  startDate?: string;
  location?: string;
  dataSourceMode?: string;
}

interface CampaignSelection {
  selectedCampaignId: string;
  selectedCampaignName: string;
  selectedPlatform: string;
  campaignGoalType: string;
  campaignStatus: string;
  campaignLocation?: string;
  dataSourceMode?: string;
}

interface CampaignWarning {
  type: string;
  message: string;
  campaignStatus: string;
}

export interface ProductAnchorInput {
  name: string;
  type: string;
  keyAttributes: string[];
  coreProblemSolved: string;
  differentiatingFeature: string;
}

interface CreateCampaignInput {
  name: string;
  objective: string;
  location: string;
  platform?: string;
  notes?: string;
  dataSourceMode?: string;
  productAnchor?: ProductAnchorInput | null;
}

interface CampaignContextValue {
  campaigns: CampaignInfo[];
  selectedCampaign: CampaignSelection | null;
  selectedCampaignId: string | null;
  dataSourceMode: string;
  warning: CampaignWarning | null;
  isLoading: boolean;
  isCampaignSelected: boolean;
  selectCampaign: (campaign: CampaignInfo) => Promise<void>;
  createCampaign: (input: CreateCampaignInput) => Promise<void>;
  getProductAnchor: (campaignId: string) => Promise<ProductAnchorInput | null>;
  updateProductAnchor: (campaignId: string, anchor: ProductAnchorInput | null) => Promise<void>;
  deleteCampaign: (campaignId: string) => Promise<void>;
  clearSelection: () => Promise<void>;
  refreshCampaigns: () => Promise<void>;
  refreshSelection: () => Promise<void>;
}

const CampaignContext = createContext<CampaignContextValue | null>(null);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSelection | null>(null);
  const [warning, setWarning] = useState<CampaignWarning | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // SECURITY: the LIVE auth identity is mirrored into a ref so async
  // fetchers can compare their captured-at-dispatch userId against the
  // CURRENT identity at commit time. Comparing closure-captured userId to
  // itself (`issuedFor !== userId` where both come from the same closure)
  // is meaningless — only a ref reflects the post-switch value.
  const currentUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    currentUserIdRef.current = userId;
  }, [userId]);

  const refreshCampaigns = useCallback(async () => {
    const issuedFor = userId;
    try {
      const res = await authFetch(getApiUrl('/api/campaigns'));
      if (!res.ok) return;
      const data = await res.json();
      if (currentUserIdRef.current !== issuedFor) return;
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error('[CampaignContext] Failed to fetch campaigns:', err);
    }
  }, [userId]);

  const refreshSelection = useCallback(async () => {
    const issuedFor = userId;
    try {
      const res = await authFetch(getApiUrl('/api/campaigns/selected'));
      if (!res.ok) return;
      const data = await res.json();
      if (currentUserIdRef.current !== issuedFor) return;
      if (data.selected && data.selection) {
        setSelectedCampaign(data.selection);
        setWarning(data.warning || null);
      } else {
        setSelectedCampaign(null);
        setWarning(null);
      }
    } catch (err) {
      console.error('[CampaignContext] Failed to fetch selection:', err);
    }
  }, [userId]);

  // SECURITY: every mutation handler — like the loaders above — captures the
  // userId at dispatch and gates its setState commits on the LIVE ref. If the
  // user switches accounts mid-flight, the response cannot paint into the
  // new account's context.
  const selectCampaign = useCallback(async (campaign: CampaignInfo) => {
    const issuedFor = userId;
    try {
      const res = await authFetch(getApiUrl('/api/campaigns/select'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          campaignName: campaign.name,
          platform: campaign.platform,
          goalType: campaign.goalType,
          campaignLocation: campaign.location,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (currentUserIdRef.current !== issuedFor) return;
        setSelectedCampaign(data.selection);
        setWarning(null);
        // P1 isolation seal: invalidate every campaign-scoped cache entry so
        // queries keyed off `selectedCampaignId` re-fetch under the new
        // campaign and cannot show stale data from the previous selection.
        try {
          await queryClient.cancelQueries();
          queryClient.clear();
        } catch (e) {
          console.warn('[CampaignContext] queryClient.clear failed on selectCampaign:', e);
        }
      } else {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to select campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to select campaign:', err);
      throw err;
    }
  }, [userId]);

  const createCampaign = useCallback(async (input: CreateCampaignInput) => {
    const issuedFor = userId;
    try {
      const res = await authFetch(getApiUrl('/api/campaigns/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        const data = await res.json();
        if (currentUserIdRef.current !== issuedFor) return;
        setSelectedCampaign(data.selection);
        setWarning(null);
        const newCampaign: CampaignInfo = data.campaign;
        setCampaigns(prev => [newCampaign, ...prev]);
      } else {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to create campaign:', err);
      throw err;
    }
  }, [userId]);

  // Product anchor (Phase 0) read/write. These do not paint into context state,
  // so no account-switch guard is needed — they return/throw to the caller.
  const getProductAnchor = useCallback(async (campaignId: string): Promise<ProductAnchorInput | null> => {
    const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}/product-anchor`));
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to load product identity');
    }
    const data = await res.json();
    return data.productAnchor ?? null;
  }, []);

  const updateProductAnchor = useCallback(async (campaignId: string, anchor: ProductAnchorInput | null) => {
    const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}/product-anchor`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productAnchor: anchor }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to update product identity');
    }
    // Keep the degraded-state banner (and any other reader of the anchor
    // query) honest immediately after a save/clear — the default 5-min
    // staleTime would otherwise leave the banner showing stale state.
    queryClient.invalidateQueries({ queryKey: ['/api/campaigns', campaignId, 'product-anchor'] });
  }, []);

  const deleteCampaign = useCallback(async (campaignId: string) => {
    const issuedFor = userId;
    try {
      const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}`), {
        method: 'DELETE',
      });

      if (res.ok) {
        if (currentUserIdRef.current !== issuedFor) return;
        setCampaigns(prev => prev.filter(c => c.id !== campaignId));
        if (selectedCampaign?.selectedCampaignId === campaignId) {
          setSelectedCampaign(null);
          setWarning(null);
        }
      } else {
        const err = await res.json();
        throw new Error(err.message || 'Failed to delete campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to delete campaign:', err);
      throw err;
    }
  }, [selectedCampaign, userId]);

  const clearSelection = useCallback(async () => {
    const issuedFor = userId;
    try {
      await authFetch(getApiUrl('/api/campaigns/selected'), { method: 'DELETE' });
      if (currentUserIdRef.current !== issuedFor) return;
      setSelectedCampaign(null);
      setWarning(null);
      // P1 isolation seal: drop all campaign-scoped cached data on
      // deselection so the dashboard cannot render the previous campaign's
      // KPIs against an empty selection.
      try {
        await queryClient.cancelQueries();
        queryClient.clear();
      } catch (e) {
        console.warn('[CampaignContext] queryClient.clear failed on clearSelection:', e);
      }
    } catch (err) {
      console.error('[CampaignContext] Failed to clear selection:', err);
    }
  }, [userId]);

  // SECURITY: keyed on `userId` (not just `isAuthenticated`) so account
  // switches re-run the effect. Before this fix, switching from User A to
  // User B left `selectedCampaign` and `campaigns` populated with User A's
  // data because `isAuthenticated` stayed `true` across the swap, causing a
  // cross-account leak visible to the user.
  useEffect(() => {
    if (authLoading) return;
    // Reset to a clean slate FIRST so React paints empty state for one frame
    // instead of flashing the previous account's data while the fetch is in
    // flight.
    setCampaigns([]);
    setSelectedCampaign(null);
    setWarning(null);
    if (!isAuthenticated || !userId) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function init() {
      setIsLoading(true);
      await Promise.all([refreshCampaigns(), refreshSelection()]);
      if (!cancelled) setIsLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, [refreshCampaigns, refreshSelection, isAuthenticated, authLoading, userId]);

  const isCampaignSelected = !!selectedCampaign && !warning;
  const selectedCampaignId = selectedCampaign?.selectedCampaignId ?? null;
  const dataSourceMode = selectedCampaign?.dataSourceMode || "benchmark";

  return (
    <CampaignContext.Provider
      value={{
        campaigns,
        selectedCampaign,
        selectedCampaignId,
        dataSourceMode,
        warning,
        isLoading,
        isCampaignSelected,
        selectCampaign,
        createCampaign,
        getProductAnchor,
        updateProductAnchor,
        deleteCampaign,
        clearSelection,
        refreshCampaigns,
        refreshSelection,
      }}
    >
      {children}
    </CampaignContext.Provider>
  );
}

export function useCampaign() {
  const context = useContext(CampaignContext);
  if (!context) {
    throw new Error('useCampaign must be used within a CampaignProvider');
  }
  return context;
}
