import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl, authFetch } from '@/lib/query-client';

export interface ShellUserProfile {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  role: string;
}

export interface ShellMonitoringState {
  status: 'LIVE' | 'MONITORING' | 'DEGRADED' | 'OFFLINE' | 'NO_SOURCES';
  competitorsCount: number | null;
  lastCheckTimestamp: string | null;
  isScanning: boolean;
}

export interface ShellBadges {
  whatToDoToday: number | null;
  watchtower: number | null;
}

export interface ShellWorkspace {
  id: string;
  name: string;
}

export interface AppShellController {
  userProfile: ShellUserProfile | null;
  activeWorkspace: ShellWorkspace | null;
  workspaces: ShellWorkspace[];
  switchWorkspace: (workspaceId: string) => void;
  monitoring: ShellMonitoringState;
  badges: ShellBadges;
  isLoading: boolean;
  openAccountSwitcher: () => void;
}

export function useAppShellController(): AppShellController {
  const { user, openAccountSwitcher } = useAuth();
  const { campaigns, selectedCampaign, selectCampaign } = useCampaign();
  
  const [monitoring, setMonitoring] = useState<ShellMonitoringState>({
    status: 'OFFLINE',
    competitorsCount: null,
    lastCheckTimestamp: null,
    isScanning: false,
  });
  const [badges, setBadges] = useState<ShellBadges>({
    whatToDoToday: null,
    watchtower: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  // 1. Real User Profile Data
  const userProfile = useMemo<ShellUserProfile | null>(() => {
    if (!user) return null;
    
    // Fallback chain for display name
    let displayName = user.name || (user as any).username || '';
    if (!displayName && user.email) {
      displayName = user.email.split('@')[0];
    }
    if (!displayName) {
      displayName = 'Account User';
    }

    const initials = displayName.charAt(0).toUpperCase();
    
    // Role data source: derive from isAdmin flag as proxy for Founder vs Member 
    // since explicit role string isn't always present on User model
    const role = user.isAdmin ? 'Founder' : 'Workspace Member';
    
    return {
      id: user.id,
      email: user.email,
      displayName,
      initials,
      role,
    };
  }, [user]);

  // Map campaigns to workspaces
  const workspaces = useMemo<ShellWorkspace[]>(() => {
    return campaigns.map(c => ({ id: c.id, name: c.name }));
  }, [campaigns]);

  const activeWorkspace = useMemo<ShellWorkspace | null>(() => {
    if (!selectedCampaign) return null;
    return { id: selectedCampaign.selectedCampaignId, name: selectedCampaign.selectedCampaignName };
  }, [selectedCampaign]);

  const switchWorkspace = (workspaceId: string) => {
    const target = campaigns.find(c => c.id === workspaceId);
    if (target) selectCampaign(target);
  };

  // 2. Real Backend Data Fetching
  useEffect(() => {
    let isMounted = true;
    const selectedCampaignId = selectedCampaign?.selectedCampaignId;
    
    async function fetchShellData() {
      if (!selectedCampaignId) {
        if (isMounted) {
          setMonitoring({ status: 'NO_SOURCES', competitorsCount: null, lastCheckTimestamp: null });
          setBadges({ whatToDoToday: null, watchtower: null });
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const apiUrl = getApiUrl();
        
        // Fetch all dependencies in parallel without blocking main render
        const [monitoringRes, tasksRes, watchtowerRes] = await Promise.all([
          authFetch(new URL(`/api/perception/monitoring?campaignId=${selectedCampaignId}`, apiUrl).toString()),
          authFetch(new URL(`/api/execution/required-work?campaignId=${selectedCampaignId}`, apiUrl).toString()),
          authFetch(new URL(`/api/perception/market-signals?campaignId=${selectedCampaignId}`, apiUrl).toString())
        ]);

        let newMonitoring = { ...monitoring };
        let newBadges = { ...badges };

        // Process Monitoring State
        if (monitoringRes.ok) {
          const mData = await monitoringRes.json();
          if (mData.success && mData.facts) {
             const comps = mData.facts.competitorsWatched ?? 0;
             newMonitoring.competitorsCount = comps > 0 ? comps : null;
             newMonitoring.lastCheckTimestamp = mData.facts.lastScanAt || null;
             
             if (comps === 0) {
               newMonitoring.status = 'NO_SOURCES';
             } else if (!newMonitoring.lastCheckTimestamp) {
               newMonitoring.status = 'DEGRADED';
             } else {
               // Live = recent scan (within 24 hours), otherwise Monitoring
               const lastScan = new Date(newMonitoring.lastCheckTimestamp).getTime();
               const isFresh = (Date.now() - lastScan) < 24 * 3600 * 1000;
               newMonitoring.status = isFresh ? 'LIVE' : 'MONITORING';
             }
          }
        } else {
          newMonitoring.status = 'OFFLINE';
        }

        // Process What To Do Today Badge (Tasks Count)
        if (tasksRes.ok) {
          const tData = await tasksRes.json();
          if (tData.success && tData.fulfillment?.total?.remaining !== undefined) {
             const remaining = tData.fulfillment.total.remaining;
             newBadges.whatToDoToday = remaining > 0 ? remaining : null;
          }
        }

        // Process Watchtower Badge (Unread/Confirmed Market Changes)
        if (watchtowerRes.ok) {
          const wData = await watchtowerRes.json();
          if (wData.success) {
             if (wData.cards) {
               const confirmedCount = wData.cards.filter((c: any) => c.isConfirmed).length; 
               newBadges.watchtower = confirmedCount > 0 ? confirmedCount : null;
             }
             if (wData.flowState?.watchtowerState === 'scanning' || wData.state === 'NO_SIGNALS') {
               newMonitoring.isScanning = true;
             }
          }
        }

        if (isMounted) {
          setMonitoring(newMonitoring);
          setBadges(newBadges);
        }
      } catch (err) {
        if (isMounted) {
          setMonitoring(prev => ({ ...prev, status: 'OFFLINE' }));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchShellData();
    
    // Poll for updates every 60s
    const intervalId = setInterval(fetchShellData, 60000);
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [selectedCampaign?.selectedCampaignId]);

  return {
    userProfile,
    activeWorkspace,
    workspaces,
    switchWorkspace,
    monitoring,
    badges,
    isLoading,
    openAccountSwitcher
  };
}
