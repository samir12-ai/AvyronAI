import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch } from 'expo/fetch';
import { getApiUrl } from '@/lib/query-client';

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

interface CreateCampaignInput {
  name: string;
  objective: string;
  location: string;
  platform?: string;
  notes?: string;
  dataSourceMode?: string;
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
  deleteCampaign: (campaignId: string) => Promise<void>;
  clearSelection: () => Promise<void>;
  refreshCampaigns: () => Promise<void>;
  refreshSelection: () => Promise<void>;
}

const CampaignContext = createContext<CampaignContextValue | null>(null);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignSelection | null>(null);
  const [warning, setWarning] = useState<CampaignWarning | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshCampaigns = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/campaigns'));
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error('[CampaignContext] Failed to fetch campaigns:', err);
    }
  }, []);

  const refreshSelection = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/campaigns/selected'));
      if (res.ok) {
        const data = await res.json();
        if (data.selected && data.selection) {
          setSelectedCampaign(data.selection);
          setWarning(data.warning || null);
        } else {
          setSelectedCampaign(null);
          setWarning(null);
        }
      }
    } catch (err) {
      console.error('[CampaignContext] Failed to fetch selection:', err);
    }
  }, []);

  const selectCampaign = useCallback(async (campaign: CampaignInfo) => {
    try {
      const res = await fetch(getApiUrl('/api/campaigns/select'), {
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
        setSelectedCampaign(data.selection);
        setWarning(null);
      } else {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Failed to select campaign');
      }
    } catch (err: any) {
      console.error('[CampaignContext] Failed to select campaign:', err);
      throw err;
    }
  }, []);

  const createCampaign = useCallback(async (input: CreateCampaignInput) => {
    try {
      const res = await fetch(getApiUrl('/api/campaigns/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        const data = await res.json();
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
  }, []);

  const deleteCampaign = useCallback(async (campaignId: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/campaigns/${campaignId}`), {
        method: 'DELETE',
      });

      if (res.ok) {
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
  }, [selectedCampaign]);

  const clearSelection = useCallback(async () => {
    try {
      await fetch(getApiUrl('/api/campaigns/selected'), { method: 'DELETE' });
      setSelectedCampaign(null);
      setWarning(null);
    } catch (err) {
      console.error('[CampaignContext] Failed to clear selection:', err);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      await Promise.all([refreshCampaigns(), refreshSelection()]);
      setIsLoading(false);
    }
    init();
  }, [refreshCampaigns, refreshSelection]);

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
