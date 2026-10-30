import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl, authFetch, queryClient } from '@/lib/query-client';
import { useAuth } from './AuthContext';

export interface CampaignInfo {
  id: string;
  name: string;
  platform: string;
  goalType: string;
  status: string;
  budget?: string | { monthlyBudget: number | null; currency: string; budgetMode: string } | null;
  startDate?: string;
  location?: string;
  targetMarket?: string | null;
  dataSourceMode?: string;
  businessId?: string | null;
  businessName?: string | null;
  productId?: string | null;
  productName?: string | null;
  productType?: string | null;
  setupStatus?: string | null;
  setupStep?: string | null;
  isArchived?: boolean;
  activePlan?: {
    id: string;
    version: number;
    status: string;
    isDesignatedActive: boolean;
  } | null;
}

export interface CampaignSelection {
  selectedCampaignId: string;
  selectedCampaignName: string;
  selectedPlatform: string;
  campaignGoalType: string;
  campaignStatus: string;
  campaignLocation?: string;
  targetMarket?: string | null;
  dataSourceMode?: string;
  businessId?: string | null;
  businessName?: string | null;
  productId?: string | null;
  productName?: string | null;
  productType?: string | null;
  setupStatus?: string | null;
  setupStep?: string | null;
  isArchived?: boolean;
  activePlan?: {
    id: string;
    version: number;
    status: string;
    isDesignatedActive: boolean;
  } | null;
  budget?: {
    monthlyBudget: number | null;
    currency: string;
    budgetMode: string;
  } | null;
}

export interface WorkspaceEntitlementInfo {
  tier: string;
  displayName?: string;
  maxActiveCampaigns: number;
  activeCampaignCount: number;
  canCreateOrActivate: boolean;
  proposedPriceUsdMonthly: number;
  isTestEntitlement?: boolean;
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
  entitlement: WorkspaceEntitlementInfo | null;
  dataSourceMode: string;
  warning: CampaignWarning | null;
  isLoading: boolean;
  isSwitchingCampaign: boolean;
  isCampaignSelected: boolean;
  selectCampaign: (campaign: CampaignInfo | { id: string; name?: string; platform?: string; goalType?: string; location?: string }) => Promise<void>;
  toggleCampaignStatus: (campaignId: string, status: 'active' | 'paused' | 'archived') => Promise<void>;
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
  const [entitlement, setEntitlement] = useState<WorkspaceEntitlementInfo | null>(null);
  const [warning, setWarning] = useState<CampaignWarning | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitchingCampaign, setIsSwitchingCampaign] = useState(false);
  const switchGenerationRef = useRef<number>(0);

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
      if (data.entitlement) {
        setEntitlement(data.entitlement);
      }
    } catch (err) {
      console.error('[CampaignContext] Failed to fetch campaigns:', err);
    }
  }, [userId]);

  const refreshSelection = useCallback(async () => {
    const issuedFor = userId;
    try {
      let preferredId: string | null = null;
      if (userId) {
        try {
          preferredId = await AsyncStorage.getItem(`avyron_selected_campaign_${userId}`);
        } catch {}
      }
      const url = preferredId
        ? getApiUrl(`/api/campaigns/selected?campaignId=${encodeURIComponent(preferredId)}`)
        : getApiUrl('/api/campaigns/selected');
      const res = await authFetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (currentUserIdRef.current !== issuedFor) return;
      if (data.selected && data.selection) {
        setSelectedCampaign(data.selection);
        setWarning(data.warning || null);
        if (userId && data.selection.selectedCampaignId) {
          AsyncStorage.setItem(`avyron_selected_campaign_${userId}`, data.selection.selectedCampaignId).catch(() => {});
        }
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
  const selectCampaign = useCallback(async (campaign: CampaignInfo | { id: string; name?: string; platform?: string; goalType?: string; location?: string }) => {
    const issuedFor = userId;
    const gen = ++switchGenerationRef.current;
    setIsSwitchingCampaign(true);
    try {
      // Cancel in-flight queries immediately when switching campaigns so stale
      // responses from the previous campaign cannot overwrite the UI.
      try {
        await queryClient.cancelQueries();
      } catch {}

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
        if (currentUserIdRef.current !== issuedFor || switchGenerationRef.current !== gen) return;
        setSelectedCampaign(data.selection);
        setWarning(null);
        if (userId && data.selection?.selectedCampaignId) {
          AsyncStorage.setItem(`avyron_selected_campaign_${userId}`, data.selection.selectedCampaignId).catch(() => {});
        }
        // P1 isolation seal: invalidate every campaign-scoped cache entry so
        // queries keyed off `selectedCampaignId` re-fetch under the new
        // campaign and cannot show stale data from the previous selection.
        try {
          await queryClient.cancelQueries();
          queryClient.clear();
        } catch (e) {
          console.warn('[CampaignContext] queryClient.clear failed on selectCampaign:', e);
        }
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('avyron-campaign-changed', { detail: { campaignId: campaign.id } }));
        }
      } else {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to select campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to select campaign:', err);
      throw err;
    } finally {
      if (switchGenerationRef.current === gen) {
        setIsSwitchingCampaign(false);
      }
    }
  }, [userId]);

  const toggleCampaignStatus = useCallback(async (campaignId: string, status: 'active' | 'paused' | 'archived') => {
    const issuedFor = userId;
    const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}/status`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Failed to update campaign status');
    }
    if (currentUserIdRef.current !== issuedFor) return;
    await refreshCampaigns();
    if (selectedCampaign?.selectedCampaignId === campaignId) {
      await refreshSelection();
    }
  }, [userId, refreshCampaigns, refreshSelection, selectedCampaign?.selectedCampaignId]);

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
        if (userId && data.selection?.selectedCampaignId) {
          AsyncStorage.setItem(`avyron_selected_campaign_${userId}`, data.selection.selectedCampaignId).catch(() => {});
        }
        const newCampaign: CampaignInfo = data.campaign;
        setCampaigns(prev => [newCampaign, ...prev]);
        await refreshCampaigns();
      } else {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to create campaign:', err);
      throw err;
    }
  }, [userId, refreshCampaigns]);

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
        await refreshCampaigns();
        await refreshSelection();
      } else {
        const err = await res.json();
        throw new Error(err.message || 'Failed to delete campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to delete campaign:', err);
      throw err;
    }
  }, [selectedCampaign, userId, refreshCampaigns, refreshSelection]);

  const clearSelection = useCallback(async () => {
    const issuedFor = userId;
    try {
      await authFetch(getApiUrl('/api/campaigns/selected'), { method: 'DELETE' });
      if (currentUserIdRef.current !== issuedFor) return;
      setSelectedCampaign(null);
      setWarning(null);
      if (userId) {
        AsyncStorage.removeItem(`avyron_selected_campaign_${userId}`).catch(() => {});
      }
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

  useEffect(() => {
    if (authLoading) return;
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
      try {
        let preferredId: string | null = null;
        try {
          preferredId = await AsyncStorage.getItem(`avyron_selected_campaign_${userId}`);
        } catch {}
        const selectedUrl = preferredId
          ? getApiUrl(`/api/campaigns/selected?campaignId=${encodeURIComponent(preferredId)}`)
          : getApiUrl('/api/campaigns/selected');
        const [cRes, sRes] = await Promise.all([
          authFetch(getApiUrl('/api/campaigns')).then(r => r.ok ? r.json() : { campaigns: [] }).catch(() => ({ campaigns: [] })),
          authFetch(selectedUrl).then(r => r.ok ? r.json() : { selected: false }).catch(() => ({ selected: false })),
        ]);
        if (currentUserIdRef.current !== userId) return;
        const fetchedCampaigns = cRes.campaigns || [];
        setCampaigns(fetchedCampaigns);
        if (cRes.entitlement) {
          setEntitlement(cRes.entitlement);
        }
        if (sRes.selected && sRes.selection) {
          setSelectedCampaign(sRes.selection);
          setWarning(sRes.warning || null);
          if (sRes.selection.selectedCampaignId) {
            AsyncStorage.setItem(`avyron_selected_campaign_${userId}`, sRes.selection.selectedCampaignId).catch(() => {});
          }
        } else if (fetchedCampaigns.length > 0) {
          const first = fetchedCampaigns[0];
          try {
            const selRes = await authFetch(getApiUrl('/api/campaigns/select'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                campaignId: first.id,
                campaignName: first.name,
                platform: first.platform,
                goalType: first.goalType,
                campaignLocation: first.location,
              }),
            });
            if (selRes.ok) {
              const selData = await selRes.json();
              if (currentUserIdRef.current === userId) {
                setSelectedCampaign(selData.selection);
                setWarning(null);
              }
            }
          } catch (e) {
            console.warn('[CampaignContext] auto-select first campaign error:', e);
          }
        } else {
          setSelectedCampaign(null);
          setWarning(null);
        }
      } catch (err) {
        console.error('[CampaignContext] init error:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, [refreshCampaigns, refreshSelection, isAuthenticated, authLoading, userId]);

  const isCampaignSelected = !!selectedCampaign;
  const selectedCampaignId = selectedCampaign?.selectedCampaignId ?? null;
  const dataSourceMode = selectedCampaign?.dataSourceMode || "benchmark";

  return (
    <CampaignContext.Provider
      value={{
        campaigns,
        selectedCampaign,
        selectedCampaignId,
        entitlement,
        dataSourceMode,
        warning,
        isLoading,
        isSwitchingCampaign,
        isCampaignSelected,
        selectCampaign,
        toggleCampaignStatus,
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
