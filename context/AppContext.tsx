import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import type { BrandProfile, ContentItem, Campaign, AnalyticsData, DailyMetric } from '@/lib/types';
import * as storage from '@/lib/storage';

interface AppContextValue {
  brandProfile: BrandProfile;
  setBrandProfile: (profile: BrandProfile) => Promise<void>;
  contentItems: ContentItem[];
  addContentItem: (item: ContentItem) => Promise<void>;
  updateContentItem: (item: ContentItem) => Promise<void>;
  removeContentItem: (id: string) => Promise<void>;
  campaigns: Campaign[];
  addCampaign: (campaign: Campaign) => Promise<void>;
  updateCampaign: (campaign: Campaign) => Promise<void>;
  removeCampaign: (id: string) => Promise<void>;
  analytics: AnalyticsData;
  weeklyMetrics: DailyMetric[];
  isLoading: boolean;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function generateMockAnalytics(campaigns: Campaign[]): AnalyticsData {
  const totalReach = campaigns.reduce((sum, c) => sum + c.reach, 0) || 24580;
  const totalEngagement = campaigns.reduce((sum, c) => sum + c.engagement, 0) || 3420;
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0) || 156;
  const totalSpent = campaigns.reduce((sum, c) => sum + c.spent, 0) || 1250;
  
  return {
    totalReach,
    reachChange: 12.5,
    totalEngagement,
    engagementChange: 8.3,
    totalConversions,
    conversionsChange: 15.2,
    totalSpent,
    spentChange: -5.4,
  };
}

function generateMockWeeklyMetrics(): DailyMetric[] {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map(day => ({
    date: day,
    reach: Math.floor(Math.random() * 3000) + 2000,
    engagement: Math.floor(Math.random() * 500) + 300,
    conversions: Math.floor(Math.random() * 30) + 10,
  }));
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [brandProfile, setBrandProfileState] = useState<BrandProfile>({
    name: '',
    industry: '',
    tone: 'Professional',
    targetAudience: '',
    platforms: ['Instagram', 'Facebook'],
  });
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [weeklyMetrics] = useState<DailyMetric[]>(generateMockWeeklyMetrics());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [profile, items, campaignList] = await Promise.all([
        storage.getBrandProfile(),
        storage.getContentItems(),
        storage.getCampaigns(),
      ]);
      setBrandProfileState(profile);
      setContentItems(items);
      setCampaigns(campaignList);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const setBrandProfile = async (profile: BrandProfile) => {
    setBrandProfileState(profile);
    await storage.saveBrandProfile(profile);
  };

  const addContentItem = async (item: ContentItem) => {
    setContentItems(prev => [item, ...prev]);
    await storage.saveContentItem(item);
  };

  const updateContentItem = async (item: ContentItem) => {
    setContentItems(prev => prev.map(i => i.id === item.id ? item : i));
    await storage.saveContentItem(item);
  };

  const removeContentItem = async (id: string) => {
    setContentItems(prev => prev.filter(i => i.id !== id));
    await storage.deleteContentItem(id);
  };

  const addCampaign = async (campaign: Campaign) => {
    setCampaigns(prev => [campaign, ...prev]);
    await storage.saveCampaign(campaign);
  };

  const updateCampaign = async (campaign: Campaign) => {
    setCampaigns(prev => prev.map(c => c.id === campaign.id ? campaign : c));
    await storage.saveCampaign(campaign);
  };

  const removeCampaign = async (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id));
    await storage.deleteCampaign(id);
  };

  const analytics = useMemo(() => generateMockAnalytics(campaigns), [campaigns]);

  const value = useMemo(() => ({
    brandProfile,
    setBrandProfile,
    contentItems,
    addContentItem,
    updateContentItem,
    removeContentItem,
    campaigns,
    addCampaign,
    updateCampaign,
    removeCampaign,
    analytics,
    weeklyMetrics,
    isLoading,
    refreshData: loadData,
  }), [brandProfile, contentItems, campaigns, analytics, weeklyMetrics, isLoading]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
