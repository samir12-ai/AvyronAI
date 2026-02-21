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
  isDemo?: boolean;
  location?: string;
}

interface CampaignSelection {
  selectedCampaignId: string;
  selectedCampaignName: string;
  selectedPlatform: string;
  campaignGoalType: string;
  campaignStatus: string;
  campaignLocation?: string;
}

interface CampaignWarning {
  type: string;
  message: string;
  campaignStatus: string;
}

interface CampaignContextValue {
  campaigns: CampaignInfo[];
  selectedCampaign: CampaignSelection | null;
  warning: CampaignWarning | null;
  isLoading: boolean;
  isCampaignSelected: boolean;
  selectCampaign: (campaign: CampaignInfo) => Promise<void>;
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

  return (
    <CampaignContext.Provider
      value={{
        campaigns,
        selectedCampaign,
        warning,
        isLoading,
        isCampaignSelected,
        selectCampaign,
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
