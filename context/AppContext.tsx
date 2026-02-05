import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import type { BrandProfile, ContentItem, Campaign, Ad, AnalyticsData, DailyMetric, PlatformConnection, PostingSchedule } from '@/lib/types';
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
  ads: Ad[];
  addAd: (ad: Ad) => Promise<void>;
  updateAd: (ad: Ad) => Promise<void>;
  removeAd: (id: string) => Promise<void>;
  platformConnections: PlatformConnection[];
  updatePlatformConnection: (id: string, isConnected: boolean) => Promise<void>;
  postingSchedules: PostingSchedule[];
  updatePostingSchedule: (schedule: PostingSchedule) => Promise<void>;
  analytics: AnalyticsData;
  weeklyMetrics: DailyMetric[];
  isLoading: boolean;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function generateMockAnalytics(campaigns: Campaign[], ads: Ad[]): AnalyticsData {
  const campaignReach = campaigns.reduce((sum, c) => sum + c.reach, 0);
  const adImpressions = ads.reduce((sum, a) => sum + a.impressions, 0);
  const totalReach = campaignReach + adImpressions || 24580;
  
  const campaignEngagement = campaigns.reduce((sum, c) => sum + c.engagement, 0);
  const adClicks = ads.reduce((sum, a) => sum + a.clicks, 0);
  const totalEngagement = campaignEngagement + adClicks || 3420;
  
  const campaignConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);
  const adConversions = ads.reduce((sum, a) => sum + a.conversions, 0);
  const totalConversions = campaignConversions + adConversions || 156;
  
  const campaignSpent = campaigns.reduce((sum, c) => sum + c.spent, 0);
  const adSpent = ads.reduce((sum, a) => sum + a.spent, 0);
  const totalSpent = campaignSpent + adSpent || 1250;
  
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
  const [ads, setAds] = useState<Ad[]>([]);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [postingSchedules, setPostingSchedules] = useState<PostingSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [weeklyMetrics] = useState<DailyMetric[]>(generateMockWeeklyMetrics());

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [profile, items, campaignList, adList, connections, schedules] = await Promise.all([
        storage.getBrandProfile(),
        storage.getContentItems(),
        storage.getCampaigns(),
        storage.getAds(),
        storage.getPlatformConnections(),
        storage.getPostingSchedules(),
      ]);
      setBrandProfileState(profile);
      setContentItems(items);
      setCampaigns(campaignList);
      setAds(adList);
      setPlatformConnections(connections);
      setPostingSchedules(schedules);
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

  const addAd = async (ad: Ad) => {
    setAds(prev => [ad, ...prev]);
    await storage.saveAd(ad);
  };

  const updateAd = async (ad: Ad) => {
    setAds(prev => prev.map(a => a.id === ad.id ? ad : a));
    await storage.saveAd(ad);
  };

  const removeAd = async (id: string) => {
    setAds(prev => prev.filter(a => a.id !== id));
    await storage.deleteAd(id);
  };

  const updatePlatformConnection = async (id: string, isConnected: boolean) => {
    const updated = platformConnections.map(c => 
      c.id === id ? { ...c, isConnected, connectedAt: isConnected ? new Date().toISOString() : undefined } : c
    );
    setPlatformConnections(updated);
    await storage.savePlatformConnections(updated);
  };

  const updatePostingSchedule = async (schedule: PostingSchedule) => {
    const updated = postingSchedules.map(s => 
      s.platform === schedule.platform ? schedule : s
    );
    setPostingSchedules(updated);
    await storage.savePostingSchedules(updated);
  };

  const analytics = useMemo(() => generateMockAnalytics(campaigns, ads), [campaigns, ads]);

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
    ads,
    addAd,
    updateAd,
    removeAd,
    platformConnections,
    updatePlatformConnection,
    postingSchedules,
    updatePostingSchedule,
    analytics,
    weeklyMetrics,
    isLoading,
    refreshData: loadData,
  }), [brandProfile, contentItems, campaigns, ads, platformConnections, postingSchedules, analytics, weeklyMetrics, isLoading]);

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
