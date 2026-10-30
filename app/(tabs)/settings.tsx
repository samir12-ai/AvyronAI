import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  TextInput,
  Pressable,
  Alert,
  Switch,
  Linking,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { GlobalHeader } from '@/components/GlobalHeader';
import { PlatformConnection } from '@/components/PlatformConnection';
import { BusinessProfileModal } from '@/components/BusinessProfile';
import { getApiUrl, apiRequest , authFetch } from '@/lib/query-client';
import { router, useLocalSearchParams } from 'expo-router';
import { fetch } from 'expo/fetch';

interface MetaStatus {
  metaMode: string;
  fbPublishingEnabled: boolean;
  insightsEnabled: boolean;
  igPublishingEnabled: boolean;
  grantedScopes: string[];
  missingScopes: string[];
  connectedPageId: string | null;
  connectedPageName: string | null;
  igBusinessId: string | null;
  igUsername: string | null;
  tokenExpiresAt: string | null;
  tokenExpiringSoon: boolean;
  tokenDaysRemaining: number | null;
  lastVerifiedAt: string | null;
  lastHealthCheckAt: string | null;
  encryptionConfigured: boolean;
}

interface ManualMetrics {
  spend: number;
  revenue: number;
  leads: number;
  conversions: number;
  impressions: number;
  clicks: number;
  cpa: number;
  roas: number;
}

const META_MODE_COLORS: Record<string, string> = {
  DISCONNECTED: '#8A96A8',
  REAL: '#34D399',
  TOKEN_EXPIRED: '#FF6B6B',
  PERMISSION_MISSING: '#FFB347',
  REVOKED: '#FF6B6B',
  PENDING_APPROVAL: '#FBBF24',
};

const META_MODE_LABELS: Record<string, string> = {
  DISCONNECTED: 'Disconnected',
  REAL: 'Connected',
  TOKEN_EXPIRED: 'Token Expired',
  PERMISSION_MISSING: 'Missing Permissions',
  REVOKED: 'Access Revoked',
  PENDING_APPROVAL: 'Pending Approval',
};

const platformIcons: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  instagram: { icon: 'logo-instagram', color: '#E1306C' },
  facebook: { icon: 'logo-facebook', color: '#1877F2' },
  twitter: { icon: 'logo-twitter', color: '#1DA1F2' },
  linkedin: { icon: 'logo-linkedin', color: '#0A66C2' },
  tiktok: { icon: 'musical-notes', color: '#000000' },
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { 
    brandProfile, 
    setBrandProfile, 
    platformConnections, 
    updatePlatformConnection,
    postingSchedules,
    updatePostingSchedule,
    metaConnection,
    setMetaConnection,
  } = useApp();
  const { user, logout, openAccountSwitcher, savedAccounts } = useAuth();
  const { selectedCampaignId } = useCampaign();
  const { t, locale, setLocale, languages } = useLanguage();
  const params = useLocalSearchParams<{ openBrandProfile?: string }>();

  const [name, setName] = useState(brandProfile.name);
  const [industry, setIndustry] = useState(brandProfile.industry);
  const [tone, setTone] = useState(brandProfile.tone);
  const [targetAudience, setTargetAudience] = useState(brandProfile.targetAudience);
  const [platforms, setPlatforms] = useState<string[]>(brandProfile.platforms);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    if (params.openBrandProfile === '1') {
      setShowProfileModal(true);
    }
  }, [params.openBrandProfile]);

  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaActionLoading, setMetaActionLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [manualSpend, setManualSpend] = useState('');
  const [manualRevenue, setManualRevenue] = useState('');
  const [manualLeads, setManualLeads] = useState('');
  const [manualConversions, setManualConversions] = useState('');
  const [manualImpressions, setManualImpressions] = useState('');
  const [manualClicks, setManualClicks] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDerived, setManualDerived] = useState({ cpa: 0, roas: 0 });
  const isMetaConnected = metaStatus?.metaMode === 'REAL';

  const [retTotalCustomers, setRetTotalCustomers] = useState('');
  const [retTotalPurchases, setRetTotalPurchases] = useState('');
  const [retReturningCustomers, setRetReturningCustomers] = useState('');
  const [retAvgOrderValue, setRetAvgOrderValue] = useState('');
  const [retRefundCount, setRetRefundCount] = useState('');
  const [retMonthlyCustomers, setRetMonthlyCustomers] = useState('');
  const [retDataWindow, setRetDataWindow] = useState('30');
  const [retSaving, setRetSaving] = useState(false);

  // Campaign Competitors State
  const [campaignCompetitors, setCampaignCompetitors] = useState<Array<{
    id: string;
    name: string;
    websiteUrl: string;
    platform?: string;
    websiteUrl?: string;
    tier?: string;
    monitoringStatus?: string;
    lastFetchedAt?: string | null;
    nextScheduledAt?: string | null;
    sources?: Record<string, {
      platform: string;
      url: string | null;
      status: string;
      verificationMethod?: string;
      detail?: string;
    }>;
  }>>([]);
  const [refreshingCompId, setRefreshingCompId] = useState<string | null>(null);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);
  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [newCompUrl, setNewCompUrl] = useState('');
  const [addingComp, setAddingComp] = useState(false);

  const currencyOptions = ['USD', 'AED', 'SAR', 'EUR', 'GBP', 'QAR', 'KWD'];
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState('');
  const [currencyInput, setCurrencyInput] = useState('USD');
  const [isBudgetSaving, setIsBudgetSaving] = useState(false);
  const [isBudgetUpdating, setIsBudgetUpdating] = useState(false);
  const [isBudgetOutdated, setIsBudgetOutdated] = useState(false);
  const [budgetSaveMessage, setBudgetSaveMessage] = useState('');
  const [latestBudgetRecommendation, setLatestBudgetRecommendation] = useState<any>(null);

  // Owned Social & Website Channels State
  const [ownedChannels, setOwnedChannels] = useState<Array<{
    id?: string;
    platform: string;
    handle: string | null;
    url: string | null;
    accountType?: string | null;
    identityStatus: string;
    lifecycleStatus?: string;
    statusLabel?: string;
    scrapeStatus: string;
    scrapeError: string | null;
    isConfirmedEmpty?: boolean;
    lastScrapedAt: string | null;
    nextScrapeDueAt?: string | null;
    followersCount: number;
    storedPostsCount: number;
    channelId?: string | null;
    channelName?: string | null;
    profileDossier?: any;
    lastTaskId?: string | null;
    lastProviderRunId?: string | null;
    scheduleHealth?: string;
  }>>([]);
  const [ownedInstagramInput, setOwnedInstagramInput] = useState('');
  const [ownedTiktokInput, setOwnedTiktokInput] = useState('');
  const [ownedYoutubeInput, setOwnedYoutubeInput] = useState('');
  const [ownedLinkedinInput, setOwnedLinkedinInput] = useState('');
  const [ownedWebsiteInput, setOwnedWebsiteInput] = useState('');
  const [ownedChannelsLoading, setOwnedChannelsLoading] = useState(Boolean(selectedCampaignId));
  const [ownedChannelsLoaded, setOwnedChannelsLoaded] = useState(false);
  const [ownedChannelsLoadError, setOwnedChannelsLoadError] = useState('');
  const [ownedChannelsSaving, setOwnedChannelsSaving] = useState(false);
  const [removingChannelPlatform, setRemovingChannelPlatform] = useState<string | null>(null);
  const [ownedChannelsMessage, setOwnedChannelsMessage] = useState('');
  const [ownedChannelsError, setOwnedChannelsError] = useState('');

  const [loadedChannelUrls, setLoadedChannelUrls] = useState<Record<string, string>>({
    instagram: '',
    tiktok: '',
    youtube: '',
    linkedin: '',
    website: '',
  });
  const [dirtyChannelFields, setDirtyChannelFields] = useState<Record<string, boolean>>({});
  const dirtyChannelFieldsRef = useRef<Record<string, boolean>>({});

  const activeContextKey = `${user?.id || 'anon'}:${selectedCampaignId || 'none'}`;
  const activeContextKeyRef = useRef<string>(activeContextKey);
  const prevContextKeyRef = useRef<string>(activeContextKey);
  activeContextKeyRef.current = activeContextKey;

  const markChannelDirty = useCallback((platform: string, isDirty: boolean) => {
    dirtyChannelFieldsRef.current = {
      ...dirtyChannelFieldsRef.current,
      [platform]: isDirty,
    };
    setDirtyChannelFields((prev) => ({
      ...prev,
      [platform]: isDirty,
    }));
  }, []);

  // Reset Owned Channels state immediately on account or campaign switch to prevent cross-campaign/account leakage
  useEffect(() => {
    if (prevContextKeyRef.current !== activeContextKey) {
      prevContextKeyRef.current = activeContextKey;
      setOwnedChannels([]);
      setOwnedInstagramInput('');
      setOwnedTiktokInput('');
      setOwnedYoutubeInput('');
      setOwnedLinkedinInput('');
      setOwnedWebsiteInput('');
      setLoadedChannelUrls({
        instagram: '',
        tiktok: '',
        youtube: '',
        linkedin: '',
        website: '',
      });
      dirtyChannelFieldsRef.current = {};
      setDirtyChannelFields({});
      setOwnedChannelsLoaded(false);
      setOwnedChannelsLoading(Boolean(selectedCampaignId));
      setOwnedChannelsLoadError('');
      setOwnedChannelsMessage('');
      setOwnedChannelsError('');
    }
  }, [activeContextKey, selectedCampaignId]);

  const applyCanonicalChannelsToState = useCallback(
    (chs: any[], fallbackWebsiteUrl: string, forceOverwriteAll: boolean = false) => {
      setOwnedChannels(chs);
      const findUrl = (plat: string) => {
        const row = chs.find((c) => String(c.platform || '').toLowerCase() === plat);
        return row?.url || row?.handle || '';
      };
      const canonicalMap: Record<string, string> = {
        instagram: findUrl('instagram'),
        tiktok: findUrl('tiktok'),
        youtube: findUrl('youtube'),
        linkedin: findUrl('linkedin'),
        website: findUrl('website') || fallbackWebsiteUrl || '',
      };
      setLoadedChannelUrls(canonicalMap);

      if (forceOverwriteAll || !dirtyChannelFieldsRef.current.instagram) {
        setOwnedInstagramInput(canonicalMap.instagram);
      }
      if (forceOverwriteAll || !dirtyChannelFieldsRef.current.tiktok) {
        setOwnedTiktokInput(canonicalMap.tiktok);
      }
      if (forceOverwriteAll || !dirtyChannelFieldsRef.current.youtube) {
        setOwnedYoutubeInput(canonicalMap.youtube);
      }
      if (forceOverwriteAll || !dirtyChannelFieldsRef.current.linkedin) {
        setOwnedLinkedinInput(canonicalMap.linkedin);
      }
      if (forceOverwriteAll || !dirtyChannelFieldsRef.current.website) {
        setOwnedWebsiteInput(canonicalMap.website);
      }
      if (forceOverwriteAll) {
        dirtyChannelFieldsRef.current = {};
        setDirtyChannelFields({});
      }
    },
    []
  );

  const fetchCampaignCompetitors = useCallback(
    async (opts?: { forceOverwriteChannels?: boolean }) => {
      if (!selectedCampaignId) {
        setOwnedChannelsLoading(false);
        return;
      }
      const requestContextKey = `${user?.id || 'anon'}:${selectedCampaignId}`;
      setLoadingCompetitors(true);
      setOwnedChannelsLoading(true);
      setOwnedChannelsLoadError('');
      try {
        const apiUrl = getApiUrl();
        const url = new URL(`/api/settings/campaign/${selectedCampaignId}`, apiUrl);
        const res = await authFetch(url.toString(), { credentials: 'include' });
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          throw new Error(`HTTP ${res.status}: Failed to parse campaign settings response.`);
        }
        // Discard stale response if user or campaign changed while in flight
        if (activeContextKeyRef.current !== requestContextKey) {
          return;
        }
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `HTTP ${res.status}: Failed to load campaign settings.`);
        }
        if (data.campaign?.competitors) {
          setCampaignCompetitors(data.campaign.competitors);
        }
        const canonicalChannels = (data.campaign?.ownedChannels ?? data.campaign?.channels) as any[] | undefined;
        const fallbackWebsite = data.campaign?.websiteUrl || data.campaign?.domain || '';
        if (Array.isArray(canonicalChannels)) {
          applyCanonicalChannelsToState(
            canonicalChannels,
            fallbackWebsite,
            Boolean(opts?.forceOverwriteChannels)
          );
          setOwnedChannelsLoaded(true);
          setOwnedChannelsLoadError('');
        } else {
          throw new Error('Campaign settings response is missing canonical channels.');
        }
        if (data.campaign?.budget) {
          const b = data.campaign.budget;
          setMonthlyBudgetInput(b.monthlyBudget != null ? String(b.monthlyBudget) : '');
          setCurrencyInput(b.currency || 'USD');
          setIsBudgetOutdated(b.isOutdated ?? false);
          setLatestBudgetRecommendation(b.latestRecommendation ?? null);
        }
      } catch (err: any) {
        if (activeContextKeyRef.current !== requestContextKey) {
          return;
        }
        console.error('Failed to fetch campaign settings:', err);
        setOwnedChannelsLoadError(err?.message || 'Failed to load saved channels.');
      } finally {
        if (activeContextKeyRef.current === requestContextKey) {
          setLoadingCompetitors(false);
          setOwnedChannelsLoading(false);
        }
      }
    },
    [selectedCampaignId, user?.id, applyCanonicalChannelsToState]
  );

  const handleSaveOwnedChannels = async (triggerSync: boolean = true) => {
    if (!selectedCampaignId || !ownedChannelsLoaded || ownedChannelsLoading || ownedChannelsSaving) {
      return;
    }
    setOwnedChannelsMessage('');
    setOwnedChannelsError('');

    const currentInputs: Record<string, string> = {
      instagram: ownedInstagramInput.trim(),
      tiktok: ownedTiktokInput.trim(),
      youtube: ownedYoutubeInput.trim(),
      linkedin: ownedLinkedinInput.trim(),
      website: ownedWebsiteInput.trim(),
    };

    // Blank/unloaded fields must NEVER silently disconnect an existing channel
    const blankedExistingPlatforms: string[] = [];
    for (const plat of ['instagram', 'tiktok', 'youtube', 'linkedin', 'website']) {
      if (!currentInputs[plat] && loadedChannelUrls[plat]) {
        blankedExistingPlatforms.push(plat);
      }
    }
    if (blankedExistingPlatforms.length > 0) {
      // Restore canonical URLs in the blanked inputs and explain explicit removal
      if (!currentInputs.instagram && loadedChannelUrls.instagram) setOwnedInstagramInput(loadedChannelUrls.instagram);
      if (!currentInputs.tiktok && loadedChannelUrls.tiktok) setOwnedTiktokInput(loadedChannelUrls.tiktok);
      if (!currentInputs.youtube && loadedChannelUrls.youtube) setOwnedYoutubeInput(loadedChannelUrls.youtube);
      if (!currentInputs.linkedin && loadedChannelUrls.linkedin) setOwnedLinkedinInput(loadedChannelUrls.linkedin);
      if (!currentInputs.website && loadedChannelUrls.website) setOwnedWebsiteInput(loadedChannelUrls.website);
      for (const plat of blankedExistingPlatforms) {
        markChannelDirty(plat, false);
      }
      setOwnedChannelsError(
        `Blank fields cannot disconnect an existing channel (${blankedExistingPlatforms.join(', ')}). Restored saved URL(s). Use the explicit "Remove" button next to a channel to disconnect it.`
      );
      return;
    }

    // Collect only intentionally changed non-empty fields
    const channelsToSend: Array<{ platform: string; url: string }> = [];
    for (const plat of ['instagram', 'tiktok', 'youtube', 'linkedin', 'website']) {
      const val = currentInputs[plat];
      if (!val) continue;
      const wasEdited = Boolean(dirtyChannelFieldsRef.current[plat]) || val !== (loadedChannelUrls[plat] || '');
      if (wasEdited) {
        channelsToSend.push({ platform: plat, url: val });
      }
    }

    // If user clicked Save & Sync without editing text, check if any channel needs retry/sync (CONFIGURED or FAILED)
    if (channelsToSend.length === 0) {
      for (const row of ownedChannels) {
        const plat = String(row.platform || '').toLowerCase();
        const val = currentInputs[plat];
        if (
          val &&
          (row.lifecycleStatus === 'CONFIGURED' ||
            row.lifecycleStatus === 'FAILED' ||
            row.scrapeStatus === 'FAILED' ||
            row.scrapeStatus === 'CONFIGURED')
        ) {
          channelsToSend.push({ platform: plat, url: val });
        }
      }
    }

    // If still empty and LinkedIn is in Needs full LinkedIn URL state, surface actionable validation message
    if (channelsToSend.length === 0) {
      const liRow = ownedChannels.find((c) => String(c.platform || '').toLowerCase() === 'linkedin');
      if (liRow && (liRow.identityStatus === 'UNRESOLVED' || liRow.lifecycleStatus === 'NEEDS_FULL_URL')) {
        setOwnedChannelsError(
          'LinkedIn needs a full /company/<slug> or /in/<slug> URL before it can be synced. Enter the full URL and click Save & Sync Channels.'
        );
        return;
      }
      setOwnedChannelsMessage('All configured channels are already saved and up to date.');
      return;
    }

    setOwnedChannelsSaving(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/settings/campaign/${selectedCampaignId}/owned-channels`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          channels: channelsToSend,
          triggerScrape: triggerSync,
        }),
      });
      const data = await res.json();
      const updatedList = (data.ownedChannels ?? data.channels) as any[] | undefined;

      if (data.validationErrors && Object.keys(data.validationErrors).length > 0) {
        const msgs = Object.values(data.validationErrors).join(' ');
        setOwnedChannelsError(msgs);
      } else if (!res.ok || !data.success) {
        setOwnedChannelsError(data.error || 'Failed to save owned channels.');
      } else {
        if (Array.isArray(updatedList)) {
          // Clear dirty flags for platforms that were just saved
          for (const item of channelsToSend) {
            dirtyChannelFieldsRef.current[item.platform] = false;
          }
          setDirtyChannelFields({ ...dirtyChannelFieldsRef.current });
          applyCanonicalChannelsToState(
            updatedList,
            data.websiteUrl || data.domain || loadedChannelUrls.website || '',
            false
          );
        }
        // Refresh canonical campaign query to keep scheduleHealth & all state in sync
        await fetchCampaignCompetitors({ forceOverwriteChannels: false });

        // Check if any saved channel experienced a downstream acquisition error (while preserving the saved URL)
        const failedSaved = (updatedList || []).filter(
          (c) =>
            channelsToSend.some((sent) => sent.platform === String(c.platform || '').toLowerCase()) &&
            (c.lifecycleStatus === 'FAILED' || c.scrapeStatus === 'FAILED')
        );
        if (failedSaved.length > 0) {
          const errDetail = failedSaved
            .map((c) => `${String(c.platform).toUpperCase()}: ${c.scrapeError || 'Acquisition failed'}`)
            .join(' | ');
          setOwnedChannelsMessage('Channel URL saved and preserved.');
          setOwnedChannelsError(`Saved identity preserved, but live acquisition reported an error: ${errDetail}`);
        } else {
          setOwnedChannelsMessage(
            triggerSync
              ? `Saved & synced (${channelsToSend.map((c) => c.platform).join(', ')}). Performance Loop updated.`
              : 'Owned channels saved.'
          );
        }
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (err: any) {
      setOwnedChannelsError(err.message || 'Failed to save owned channels.');
    } finally {
      setOwnedChannelsSaving(false);
    }
  };

  const handleRemoveOwnedChannel = async (platform: string, label: string) => {
    if (!selectedCampaignId || removingChannelPlatform || ownedChannelsSaving) return;

    const performRemove = async () => {
      setRemovingChannelPlatform(platform);
      setOwnedChannelsMessage('');
      setOwnedChannelsError('');
      try {
        const apiUrl = getApiUrl();
        const url = new URL(`/api/settings/campaign/${selectedCampaignId}/owned-channels/${platform}`, apiUrl);
        const res = await authFetch(url.toString(), {
          method: 'DELETE',
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to remove ${label}.`);
        }
        markChannelDirty(platform, false);
        const updatedList = (data.ownedChannels ?? data.channels ?? []) as any[];
        applyCanonicalChannelsToState(updatedList, data.websiteUrl || data.domain || '', false);
        if (platform === 'instagram') setOwnedInstagramInput('');
        if (platform === 'tiktok') setOwnedTiktokInput('');
        if (platform === 'youtube') setOwnedYoutubeInput('');
        if (platform === 'linkedin') setOwnedLinkedinInput('');
        if (platform === 'website') setOwnedWebsiteInput(data.websiteUrl || '');
        setOwnedChannelsMessage(`${label} channel removed.`);
      } catch (err: any) {
        setOwnedChannelsError(err.message || `Failed to remove ${label}.`);
      } finally {
        setRemovingChannelPlatform(null);
      }
    };

    if (Platform.OS === 'web') {
      const ok = window.confirm(`Remove ${label} from this campaign's tracked owned channels?`);
      if (ok) {
        await performRemove();
      }
    } else {
      Alert.alert(
        `Remove ${label}`,
        `Are you sure you want to remove ${label} from this campaign's tracked owned channels?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => void performRemove() },
        ]
      );
    }
  };

  const handleSaveBudgetSettings = async () => {
    if (!selectedCampaignId) return;
    setIsBudgetSaving(true);
    setBudgetSaveMessage('');
    try {
      const parsed = monthlyBudgetInput.trim() === '' ? null : parseFloat(monthlyBudgetInput.trim());
      const apiUrl = getApiUrl();
      const url = new URL(`/api/settings/campaign/${selectedCampaignId}/budget`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyBudget: parsed !== null && !isNaN(parsed) ? parsed : null,
          currency: currencyInput || 'USD',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBudgetSaveMessage('Budget settings saved.');
        setIsBudgetOutdated(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Error', data.error || 'Failed to save budget settings.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save budget settings.');
    } finally {
      setIsBudgetSaving(false);
    }
  };

  const handleUpdateBudgetDistribution = async () => {
    if (!selectedCampaignId) return;
    setIsBudgetUpdating(true);
    setBudgetSaveMessage('');
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/settings/campaign/${selectedCampaignId}/update-budget-distribution`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success && data.recommendation) {
        setLatestBudgetRecommendation(data.recommendation);
        setIsBudgetOutdated(false);
        setBudgetSaveMessage('Budget distribution updated with latest channels!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Update Failed', data.error || 'Could not update budget distribution.');
      }
    } catch (err: any) {
      Alert.alert('Update Error', err.message || 'Failed to update budget distribution.');
    } finally {
      setIsBudgetUpdating(false);
    }
  };

  useEffect(() => {
    fetchCampaignCompetitors();
  }, [fetchCampaignCompetitors]);

  const handleAddCompetitor = async () => {
    if (!newCompName.trim() || !newCompUrl.trim()) {
      Alert.alert('Missing Fields', 'Please enter both company name and website URL.');
      return;
    }
    setAddingComp(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/settings/campaign/${selectedCampaignId}/add-competitor`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newCompName.trim(),
          websiteUrl: newCompUrl.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setNewCompName('');
        setNewCompUrl('');
        setShowAddCompetitorModal(false);
        await fetchCampaignCompetitors();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Competitor Added', 'Competitor added to campaign monitoring.');
      } else {
        Alert.alert('Error', data.error || 'Failed to add competitor.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error');
    } finally {
      setAddingComp(false);
    }
  };

  const handleRemoveCompetitor = async (competitorId: string, compName: string) => {
    Alert.alert(
      'Remove Competitor',
      `Are you sure you want to stop monitoring ${compName} for this campaign?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const apiUrl = getApiUrl();
              const url = new URL(`/api/settings/campaign/${selectedCampaignId}/remove-competitor`, apiUrl);
              const res = await authFetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ competitorId })
              });
              const data = await res.json();
              if (data.success) {
                await fetchCampaignCompetitors();
                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              } else {
                Alert.alert('Error', data.error || 'Failed to remove competitor.');
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Network error');
            }
          }
        }
      ]
    );
  };

  const handleRefreshSources = async (competitorId: string) => {
    if (!selectedCampaignId) return;
    setRefreshingCompId(competitorId);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/settings/campaign/${selectedCampaignId}/competitor/${competitorId}/refresh-sources`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'POST',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        await fetchCampaignCompetitors();
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        Alert.alert('Sources Refreshed', 'Competitor multi-source discovery completed.');
      } else {
        Alert.alert('Error', data.error || 'Failed to refresh competitor sources.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error');
    } finally {
      setRefreshingCompId(null);
    }
  };
  const [retDerived, setRetDerived] = useState({ ltv: 0, churnRisk: 0, retentionStrength: 0, repeatPurchaseRate: 0 });

  const fetchManualMetrics = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/manual-metrics`, apiUrl);
      const res = await authFetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.metrics) {
        const m = data.metrics;
        setManualSpend(m.spend > 0 ? String(m.spend) : '');
        setManualRevenue(m.revenue > 0 ? String(m.revenue) : '');
        setManualLeads(m.leads > 0 ? String(m.leads) : '');
        setManualConversions(m.conversions > 0 ? String(m.conversions) : '');
        setManualImpressions(m.impressions > 0 ? String(m.impressions) : '');
        setManualClicks(m.clicks > 0 ? String(m.clicks) : '');
        setManualDerived({ cpa: m.cpa || 0, roas: m.roas || 0 });
      }
    } catch (error) {
      console.error('Failed to fetch manual metrics:', error);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchManualMetrics();
  }, [fetchManualMetrics]);

  useEffect(() => {
    const spend = parseFloat(manualSpend) || 0;
    const revenue = parseFloat(manualRevenue) || 0;
    const conversions = parseInt(manualConversions) || 0;
    const cpa = conversions > 0 ? +(spend / conversions).toFixed(2) : 0;
    const roas = spend > 0 ? +(revenue / spend).toFixed(2) : 0;
    setManualDerived({ cpa, roas });
  }, [manualSpend, manualRevenue, manualConversions]);

  const handleSaveManualMetrics = async () => {
    if (!selectedCampaignId) {
      Alert.alert('No Campaign', 'Please select a campaign first.');
      return;
    }
    setManualSaving(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/manual-metrics`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          spend: parseFloat(manualSpend) || 0,
          revenue: parseFloat(manualRevenue) || 0,
          leads: parseInt(manualLeads) || 0,
          conversions: parseInt(manualConversions) || 0,
          impressions: parseInt(manualImpressions) || 0,
          clicks: parseInt(manualClicks) || 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved', 'Campaign metrics updated. Dashboard will reflect these numbers.');
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save metrics');
    } finally {
      setManualSaving(false);
    }
  };

  const fetchRetentionMetrics = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/retention-metrics`, apiUrl);
      const res = await authFetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.metrics) {
        const m = data.metrics;
        setRetTotalCustomers(m.totalCustomers > 0 ? String(m.totalCustomers) : '');
        setRetTotalPurchases(m.totalPurchases > 0 ? String(m.totalPurchases) : '');
        setRetReturningCustomers(m.returningCustomers > 0 ? String(m.returningCustomers) : '');
        setRetAvgOrderValue(m.averageOrderValue > 0 ? String(m.averageOrderValue) : '');
        setRetRefundCount(m.refundCount > 0 ? String(m.refundCount) : '');
        setRetMonthlyCustomers(m.monthlyCustomers > 0 ? String(m.monthlyCustomers) : '');
        setRetDataWindow(m.dataWindowDays > 0 ? String(m.dataWindowDays) : '30');
      }
      if (data.derived) {
        setRetDerived({
          ltv: data.derived.estimatedLTV || 0,
          churnRisk: data.derived.churnRiskEstimate || 0,
          retentionStrength: data.derived.retentionStrengthScore || 0,
          repeatPurchaseRate: data.derived.repeatPurchaseRate || 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch retention metrics:', error);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchRetentionMetrics();
  }, [fetchRetentionMetrics]);

  useEffect(() => {
    const tc = parseInt(retTotalCustomers) || 0;
    const tp = parseInt(retTotalPurchases) || 0;
    const rc = parseInt(retReturningCustomers) || 0;
    const aov = parseFloat(retAvgOrderValue) || 0;
    const rfc = parseInt(retRefundCount) || 0;
    const dw = parseInt(retDataWindow) || 30;

    const rpr = tc > 0 ? Math.min(rc / tc, 1) : 0;
    const pf = tc > 0 ? tp / tc : 1;
    const refundRate = tp > 0 ? Math.min(rfc / tp, 1) : 0;
    const monthsInWindow = Math.max(dw / 30, 1);
    const estLifespan = rpr > 0.1 ? Math.round(1 / (1 - rpr) * monthsInWindow) : 6;
    const annualFreq = pf * (12 / monthsInWindow);
    const ltv = aov * annualFreq * (estLifespan / 12);
    const churnRisk = Math.min(1 - rpr + (refundRate * 0.3), 1);
    const retentionStrength = (rpr * 0.3) + ((1 - refundRate) * 0.2) + (Math.min(pf / 4, 1) * 0.25) + (Math.min((parseInt(retMonthlyCustomers) || 0) / 100, 1) * 0.25);

    setRetDerived({
      ltv: +ltv.toFixed(2),
      churnRisk: +churnRisk.toFixed(2),
      retentionStrength: +Math.min(Math.max(retentionStrength, 0), 1).toFixed(2),
      repeatPurchaseRate: +rpr.toFixed(3),
    });
  }, [retTotalCustomers, retTotalPurchases, retReturningCustomers, retAvgOrderValue, retRefundCount, retMonthlyCustomers, retDataWindow]);

  const handleSaveRetentionMetrics = async () => {
    if (!selectedCampaignId) {
      Alert.alert('No Campaign', 'Please select a campaign first.');
      return;
    }
    setRetSaving(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/retention-metrics`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          totalCustomers: parseInt(retTotalCustomers) || 0,
          totalPurchases: parseInt(retTotalPurchases) || 0,
          returningCustomers: parseInt(retReturningCustomers) || 0,
          averageOrderValue: parseFloat(retAvgOrderValue) || 0,
          refundCount: parseInt(retRefundCount) || 0,
          monthlyCustomers: parseInt(retMonthlyCustomers) || 0,
          dataWindowDays: parseInt(retDataWindow) || 30,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.derived) {
          setRetDerived({
            ltv: data.derived.estimatedLTV || 0,
            churnRisk: data.derived.churnRiskEstimate || 0,
            retentionStrength: data.derived.retentionStrengthScore || 0,
            repeatPurchaseRate: data.derived.repeatPurchaseRate || 0,
          });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved', 'Retention data saved. Derived metrics computed automatically by the system.');
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to save retention metrics');
    } finally {
      setRetSaving(false);
    }
  };

  const fetchMetaStatus = useCallback(async () => {
    try {
      const apiUrl = getApiUrl();
      const url = new URL('/api/meta/status', apiUrl);
      const res = await authFetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.status) {
        setMetaStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to fetch meta status:', error);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetaStatus();
  }, [fetchMetaStatus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startOAuthPolling = useCallback(() => {
    stopPolling();
    let elapsed = 0;
    pollTimerRef.current = setInterval(async () => {
      elapsed += 3000;
      if (elapsed > 120000) {
        stopPolling();
        return;
      }
      try {
        const apiUrl = getApiUrl();
        const url = new URL('/api/meta/status', apiUrl);
        const res = await authFetch(url.toString(), { credentials: 'include' });
        const data = await res.json();
        if (data.success && data.status) {
          setMetaStatus(data.status);
          if (data.status.metaMode === 'REAL') {
            stopPolling();
            setMetaActionLoading(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch {}
    }, 3000);
  }, [stopPolling]);

  const handleConnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}api/meta/auth`;
      if (Platform.OS === 'web') {
        window.open(authUrl, '_blank', 'width=600,height=700');
      } else {
        await Linking.openURL(authUrl);
      }
      startOAuthPolling();
    } catch (error) {
      console.error('Meta connection error:', error);
      setMetaActionLoading(false);
      Alert.alert('Connection Error', 'Failed to open Meta authorization. Please try again.');
    }
  }, [startOAuthPolling]);

  const handleDisconnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      await apiRequest('POST', '/api/meta/disconnect', {});
      await fetchMetaStatus();
    } catch (error) {
      console.error('Meta disconnect error:', error);
      Alert.alert('Error', 'Failed to disconnect Meta integration.');
    } finally {
      setMetaActionLoading(false);
    }
  }, [fetchMetaStatus]);

  const handleReconnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      await apiRequest('POST', '/api/meta/reconnect', {});
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}api/meta/auth`;
      if (Platform.OS === 'web') {
        window.open(authUrl, '_blank', 'width=600,height=700');
      } else {
        await Linking.openURL(authUrl);
      }
      startOAuthPolling();
    } catch (error) {
      console.error('Meta reconnect error:', error);
      setMetaActionLoading(false);
      Alert.alert('Error', 'Failed to initiate reconnection. Please try again.');
    }
  }, [fetchMetaStatus, startOAuthPolling]);

  const getTokenDaysRemaining = useCallback((): number | null => {
    if (!metaStatus?.tokenExpiresAt) return null;
    const expires = new Date(metaStatus.tokenExpiresAt);
    const now = new Date();
    return Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [metaStatus?.tokenExpiresAt]);

  const toneOptions = [
    { key: 'Professional', label: t('settings.professional') },
    { key: 'Casual', label: t('settings.casual') },
    { key: 'Friendly', label: t('settings.friendly') },
    { key: 'Authoritative', label: t('settings.authoritative') },
    { key: 'Playful', label: t('settings.playfulTone') },
    { key: 'Inspirational', label: t('settings.inspirational') },
  ];

  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === locale);

  useEffect(() => {
    setName(brandProfile.name);
    setIndustry(brandProfile.industry);
    setTone(brandProfile.tone);
    setTargetAudience(brandProfile.targetAudience);
    setPlatforms(brandProfile.platforms);
  }, [brandProfile]);

  useEffect(() => {
    const changed = 
      name !== brandProfile.name ||
      industry !== brandProfile.industry ||
      tone !== brandProfile.tone ||
      targetAudience !== brandProfile.targetAudience ||
      JSON.stringify(platforms) !== JSON.stringify(brandProfile.platforms);
    setHasChanges(changed);
  }, [name, industry, tone, targetAudience, platforms, brandProfile]);

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setBrandProfile({
      name,
      industry,
      tone,
      targetAudience,
      platforms,
    });
    setHasChanges(false);
    Alert.alert(t('settings.saved'), t('settings.profileUpdated'));
  };

  const handleConnect = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updatePlatformConnection(id, true);
  };

  const handleDisconnect = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updatePlatformConnection(id, false);
  };

  const handleScheduleToggle = (platform: string, enabled: boolean) => {
    const schedule = postingSchedules.find(s => s.platform === platform);
    if (schedule) {
      updatePostingSchedule({ ...schedule, enabled });
    }
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(t('settings.signOutConfirm'));
      if (confirmed) {
        await logout();
        router.replace('/login');
      }
    } else {
      Alert.alert(
        t('settings.signOut'),
        t('settings.signOutConfirm'),
        [
          { text: t('settings.cancel'), style: 'cancel' },
          { 
            text: t('settings.signOut'), 
            style: 'destructive',
            onPress: async () => {
              await logout();
              router.replace('/login');
            }
          },
        ]
      );
    }
  };

  const handleSelectLanguage = async (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setLocale(code as any);
    setShowLanguageModal(false);
  };

  const connectedCount = platformConnections.filter(p => p.isConnected).length;

  return (
    <View style={[styles.container, { backgroundColor: '#0F0F13' }]}>
      <GlobalHeader title="SETTINGS" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : 16 },
        ]}
        keyboardShouldPersistTaps="handled"
      >

        {user && (
          <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.userInfo}>
              <View style={[styles.userAvatar, { backgroundColor: '#7C3AED' }]}>
                <Text style={styles.userAvatarText}>
                  {user.email ? user.email.slice(0, 2).toUpperCase() : '??'}
                </Text>
              </View>
              <View style={styles.userDetails}>
                <Text style={[styles.userName, { color: colors.text }]}>{user.name || user.email?.split('@')[0]}</Text>
                <Text style={[styles.userProvider, { color: colors.textMuted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              </View>
            </View>
            <View style={styles.userActions}>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); openAccountSwitcher(); }}
                style={({ pressed }) => [
                  styles.switchAccountBtn,
                  { backgroundColor: colors.primary + '15', opacity: pressed ? 0.7 : 1 }
                ]}
              >
                <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
                <Text style={[styles.switchAccountText, { color: colors.primary }]}>
                  Switch{savedAccounts.length > 1 ? ` (${savedAccounts.length})` : ''}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [
                  styles.logoutButton,
                  { backgroundColor: colors.error + '15', opacity: pressed ? 0.7 : 1 }
                ]}
              >
                <Ionicons name="log-out-outline" size={18} color={colors.error} />
                <Text style={[styles.logoutText, { color: colors.error }]}>{t('settings.signOut')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setShowLanguageModal(true);
          }}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="globe-outline" size={20} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.language')}</Text>
              </View>
              <View style={styles.languageSelector}>
                <Text style={[styles.languageFlag, { color: colors.text }]}>{currentLanguage?.flag}</Text>
                <Text style={[styles.languageName, { color: colors.textSecondary }]}>{currentLanguage?.nativeName}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t('settings.languageDesc')}
            </Text>
          </View>
        </Pressable>

        {/* Marketing Budget Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="wallet-outline" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Marketing Budget</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Set your monthly marketing budget and currency. Used to generate intelligent channel distribution recommendations.
          </Text>

          {/* Currency selection chips */}
          <Text style={[styles.fieldLabel, { color: colors.text, marginTop: 14, marginBottom: 8 }]}>Currency</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {currencyOptions.map((c) => {
              const isSelected = (currencyInput || 'USD').toUpperCase() === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setCurrencyInput(c);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    backgroundColor: isSelected ? colors.primary : (isDark ? '#1E293B' : '#F1F5F9'),
                    borderColor: isSelected ? colors.primary : (isDark ? '#334155' : '#CBD5E1'),
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    fontFamily: isSelected ? 'Inter_700Bold' : 'Inter_500Medium',
                    color: isSelected ? '#FFFFFF' : (isDark ? '#94A3B8' : '#475569'),
                  }}>
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Monthly Budget input */}
          <Text style={[styles.fieldLabel, { color: colors.text, marginBottom: 8 }]}>Monthly Marketing Budget</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <View style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isDark ? '#334155' : '#E2E8F0',
              backgroundColor: isDark ? '#1E293B' : '#F8FAFC',
              paddingHorizontal: 12,
            }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14, marginRight: 6, fontFamily: 'Inter_600SemiBold' }}>
                {currencyInput || 'USD'}
              </Text>
              <TextInput
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  fontSize: 14,
                  color: colors.text,
                  fontFamily: 'Inter_500Medium',
                }}
                value={monthlyBudgetInput}
                onChangeText={setMonthlyBudgetInput}
                placeholder="e.g. 5000 (optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
              />
            </View>
            <Pressable
              onPress={handleSaveBudgetSettings}
              disabled={isBudgetSaving}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 10,
                paddingHorizontal: 16,
                paddingVertical: 11,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isBudgetSaving ? 0.7 : 1,
              }}
            >
              {isBudgetSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Save</Text>
              )}
            </Pressable>
          </View>

          {budgetSaveMessage ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: '#10B981', fontFamily: 'Inter_500Medium' }}>
                {budgetSaveMessage}
              </Text>
            </View>
          ) : null}

          {/* Outdated banner & re-run recommendation button */}
          {isBudgetOutdated && (
            <View style={{
              backgroundColor: isDark ? '#332B00' : '#FFFBEB',
              borderWidth: 1,
              borderColor: isDark ? '#78350F' : '#FDE68A',
              borderRadius: 10,
              padding: 12,
              marginBottom: 14,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Ionicons name="warning-outline" size={16} color="#F59E0B" />
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: isDark ? '#FBBF24' : '#B45309' }}>
                  Budget Changed
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: isDark ? '#D1D5DB' : '#78350F', marginBottom: 10 }}>
                Your budget settings were updated. Re-run distribution to align allocations with your new budget.
              </Text>
              <Pressable
                onPress={handleUpdateBudgetDistribution}
                disabled={isBudgetUpdating}
                style={{
                  backgroundColor: '#F59E0B',
                  borderRadius: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {isBudgetUpdating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={14} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                      Update budget distribution
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {/* Latest recommendation breakdown */}
          {latestBudgetRecommendation && (
            <View style={{
              marginTop: 6,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: isDark ? '#334155' : '#E2E8F0',
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text }}>
                  Recommended Distribution
                </Text>
                <View style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  backgroundColor: latestBudgetRecommendation.status === 'COMPLETE' ? '#10B98120' : '#F59E0B20',
                }}>
                  <Text style={{
                    fontSize: 11,
                    fontFamily: 'Inter_700Bold',
                    color: latestBudgetRecommendation.status === 'COMPLETE' ? '#10B981' : '#F59E0B',
                  }}>
                    {latestBudgetRecommendation.status}
                  </Text>
                </View>
              </View>

              {latestBudgetRecommendation.overallRationale ? (
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10, fontStyle: 'italic' }}>
                  "{latestBudgetRecommendation.overallRationale}"
                </Text>
              ) : null}

              {Array.isArray(latestBudgetRecommendation.allocations) && latestBudgetRecommendation.allocations.length > 0 ? (
                <View style={{
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: isDark ? '#334155' : '#E2E8F0',
                  overflow: 'hidden',
                  marginBottom: 10,
                }}>
                  {/* Table Header */}
                  <View style={{
                    flexDirection: 'row',
                    backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: isDark ? '#334155' : '#E2E8F0',
                  }}>
                    <Text style={{ flex: 2, fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary }}>PLATFORM</Text>
                    <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textAlign: 'center' }}>SHARE</Text>
                    <Text style={{ flex: 1.5, fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, textAlign: 'right' }}>MONTHLY</Text>
                    <Text style={{ flex: 3, fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.textSecondary, paddingLeft: 8 }}>WHY</Text>
                  </View>
                  {/* Table Rows */}
                  {latestBudgetRecommendation.allocations.map((alloc: any, i: number) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: 'row',
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderBottomWidth: i < latestBudgetRecommendation.allocations.length - 1 ? 1 : 0,
                        borderBottomColor: isDark ? '#1E293B' : '#F1F5F9',
                        backgroundColor: i % 2 === 0 ? 'transparent' : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                      }}
                    >
                      <Text style={{ flex: 2, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.text }}>
                        {alloc.channel}
                      </Text>
                      <Text style={{ flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.primary, textAlign: 'center' }}>
                        {alloc.sharePercentage ? `${alloc.sharePercentage.toFixed(1)}%` : '0%'}
                      </Text>
                      <Text style={{ flex: 1.5, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.text, textAlign: 'right' }}>
                        {alloc.allocatedAmount != null ? `${currencyInput} ${alloc.allocatedAmount.toLocaleString()}` : '-'}
                      </Text>
                      <Text style={{ flex: 3, fontSize: 11, color: colors.textSecondary, paddingLeft: 8 }}>
                        {alloc.rationale || '-'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
                  {latestBudgetRecommendation.status === 'BUDGET_NOT_PROVIDED'
                    ? 'No monthly budget entered. Enter an amount above to see channel distribution.'
                    : latestBudgetRecommendation.status === 'ZERO_BUDGET'
                    ? 'Monthly budget is 0. Organic/unpaid channels are prioritized.'
                    : latestBudgetRecommendation.status === 'MISSING_CHANNELS'
                    ? 'No channels selected yet. Run Channel Selection first.'
                    : 'No channel allocations available.'}
                </Text>
              )}
            </View>
          )}

          {/* Disclaimer */}
          <View style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 8,
            backgroundColor: isDark ? '#131D2E' : '#F0F9FF',
            borderWidth: 1,
            borderColor: isDark ? '#1E3A5F' : '#BAE6FD',
          }}>
            <Text style={{ fontSize: 11, color: isDark ? '#7DD3FC' : '#0369A1', fontFamily: 'Inter_500Medium', textAlign: 'center' }}>
              Recommended allocation only — no money is spent automatically.
            </Text>
          </View>
        </View>

        <View style={[styles.metaCard, { backgroundColor: isDark ? '#1E3A5F' : '#E7F3FF', borderColor: '#1877F2' }]}>
          {metaStatus && metaStatus.metaMode !== 'REAL' && !metaLoading && (
            <View style={[styles.metaWarningBanner, { backgroundColor: (isDark ? '#332B00' : '#FFF8E1') }]}>
              <Ionicons name="warning-outline" size={14} color="#F59E0B" />
              <Text style={[styles.metaWarningText, { color: isDark ? '#FBBF24' : '#92400E' }]}>
                Meta features are limited until you complete the connection
              </Text>
            </View>
          )}

          <View style={styles.metaHeader}>
            <View style={styles.metaLogoRow}>
              <View style={[styles.metaLogo, { backgroundColor: '#1877F2' }]}>
                <Ionicons name="logo-facebook" size={24} color="#fff" />
              </View>
              <View>
                <Text style={[styles.metaTitle, { color: colors.text }]}>{t('settings.metaBusinessSuite')}</Text>
                <Text style={[styles.metaSubtitle, { color: colors.textSecondary }]}>
                  {t('settings.facebookInstagram')}
                </Text>
              </View>
            </View>
            {metaStatus && (
              <View style={[styles.connectedBadge, { backgroundColor: (META_MODE_COLORS[metaStatus.metaMode] || '#8A96A8') + '20' }]}>
                <View style={[styles.statusDot, { backgroundColor: META_MODE_COLORS[metaStatus.metaMode] || '#8A96A8' }]} />
                <Text style={[styles.connectedText, { color: META_MODE_COLORS[metaStatus.metaMode] || '#8A96A8' }]}>
                  {META_MODE_LABELS[metaStatus.metaMode] || metaStatus.metaMode}
                </Text>
              </View>
            )}
          </View>

          {metaLoading ? (
            <View style={styles.metaLoadingContainer}>
              <ActivityIndicator size="small" color="#1877F2" />
              <Text style={[styles.metaLoadingText, { color: colors.textMuted }]}>Loading status...</Text>
            </View>
          ) : metaStatus ? (
            <View style={styles.metaConnectedInfo}>
              <View style={styles.metaCapabilities}>
                <Text style={[styles.metaCapLabel, { color: colors.textSecondary }]}>Capabilities</Text>
                <View style={styles.metaCapRow}>
                  <View style={styles.metaCapItem}>
                    <Ionicons
                      name={metaStatus.fbPublishingEnabled ? 'checkmark-circle' : 'close-circle'}
                      size={16}
                      color={metaStatus.fbPublishingEnabled ? colors.success : colors.error}
                    />
                    <Text style={[styles.metaCapText, { color: colors.text }]}>FB Publishing</Text>
                  </View>
                  <View style={styles.metaCapItem}>
                    <Ionicons
                      name={metaStatus.igPublishingEnabled ? 'checkmark-circle' : 'close-circle'}
                      size={16}
                      color={metaStatus.igPublishingEnabled ? colors.success : colors.error}
                    />
                    <Text style={[styles.metaCapText, { color: colors.text }]}>IG Publishing</Text>
                  </View>
                  <View style={styles.metaCapItem}>
                    <Ionicons
                      name={metaStatus.insightsEnabled ? 'checkmark-circle' : 'close-circle'}
                      size={16}
                      color={metaStatus.insightsEnabled ? colors.success : colors.error}
                    />
                    <Text style={[styles.metaCapText, { color: colors.text }]}>Insights</Text>
                  </View>
                </View>
              </View>

              {metaStatus.metaMode === 'REAL' && (
                <View style={styles.metaRealInfo}>
                  {metaStatus.connectedPageName && (
                    <View style={[styles.metaInfoRow, { backgroundColor: colors.card }]}>
                      <Ionicons name="business" size={18} color="#1877F2" />
                      <Text style={[styles.metaInfoText, { color: colors.text }]}>
                        {metaStatus.connectedPageName}
                      </Text>
                    </View>
                  )}
                  {metaStatus.igUsername && (
                    <View style={[styles.metaInfoRow, { backgroundColor: colors.card }]}>
                      <Ionicons name="logo-instagram" size={18} color="#E1306C" />
                      <Text style={[styles.metaInfoText, { color: colors.text }]}>
                        @{metaStatus.igUsername}
                      </Text>
                    </View>
                  )}

                  {metaStatus.tokenExpiringSoon && metaStatus.tokenDaysRemaining !== null && (
                    <View style={[styles.metaInfoRow, { backgroundColor: '#FFB34720', borderWidth: 1, borderColor: '#FFB347', borderRadius: 8 }]}>
                      <Ionicons name="warning" size={18} color="#FFB347" />
                      <Text style={[styles.metaInfoText, { color: '#FFB347', fontWeight: '600' }]}>
                        Token expires in {metaStatus.tokenDaysRemaining} day{metaStatus.tokenDaysRemaining !== 1 ? 's' : ''} — auto-extension will be attempted
                      </Text>
                    </View>
                  )}

                  {metaStatus.tokenExpiresAt && (() => {
                    const daysLeft = metaStatus.tokenDaysRemaining ?? getTokenDaysRemaining();
                    const isWarning = daysLeft !== null && daysLeft < 14;
                    return (
                      <View style={[styles.metaInfoRow, { backgroundColor: isWarning ? (colors.error + '10') : colors.card }]}>
                        <Ionicons
                          name={isWarning ? 'warning' : 'time-outline'}
                          size={18}
                          color={isWarning ? colors.error : colors.textMuted}
                        />
                        <Text style={[styles.metaInfoText, { color: isWarning ? colors.error : colors.text }]}>
                          Token expires {new Date(metaStatus.tokenExpiresAt!).toLocaleDateString()}
                          {isWarning && daysLeft !== null ? ` (${daysLeft}d left)` : ''}
                        </Text>
                      </View>
                    );
                  })()}

                  {metaStatus.lastVerifiedAt && (
                    <View style={[styles.metaInfoRow, { backgroundColor: colors.card }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
                      <Text style={[styles.metaInfoText, { color: colors.textMuted }]}>
                        Verified {new Date(metaStatus.lastVerifiedAt).toLocaleString()}
                      </Text>
                    </View>
                  )}

                  <View style={[styles.metaInfoRow, { backgroundColor: colors.card }]}>
                    <Ionicons name="key-outline" size={18} color={colors.textMuted} />
                    <Text style={[styles.metaInfoText, { color: colors.textMuted }]}>
                      {metaStatus.grantedScopes.length} scopes granted (9 required)
                    </Text>
                  </View>

                  <Pressable
                    onPress={handleDisconnectMeta}
                    disabled={metaActionLoading}
                    style={[styles.disconnectButton, { backgroundColor: colors.error + '20', opacity: metaActionLoading ? 0.5 : 1 }]}
                  >
                    {metaActionLoading ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <>
                        <Ionicons name="unlink" size={16} color={colors.error} />
                        <Text style={[styles.disconnectText, { color: colors.error }]}>{t('settings.disconnect')}</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}

              {metaStatus.metaMode === 'PERMISSION_MISSING' && (
                <View style={styles.metaConnectSection}>
                  {metaStatus.missingScopes.length > 0 && (
                    <View style={styles.metaMissingScopesSection}>
                      <Text style={[styles.metaMissingScopesTitle, { color: colors.error }]}>Missing Scopes:</Text>
                      {metaStatus.missingScopes.map((scope) => (
                        <View key={scope} style={styles.metaScopeItem}>
                          <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                          <Text style={[styles.metaScopeText, { color: colors.textSecondary }]}>{scope}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Pressable
                    onPress={handleReconnectMeta}
                    disabled={metaActionLoading}
                    style={({ pressed }) => [styles.metaConnectButton, { opacity: (pressed || metaActionLoading) ? 0.6 : 1 }]}
                  >
                    <LinearGradient
                      colors={['#FFB347', '#FF9500']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.metaGradient}
                    >
                      {metaActionLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="key" size={20} color="#fff" />
                          <Text style={styles.metaConnectText}>Reconnect with Permissions</Text>
                        </>
                      )}
                    </LinearGradient>
                  </Pressable>
                </View>
              )}

              {(metaStatus.metaMode === 'TOKEN_EXPIRED' || metaStatus.metaMode === 'REVOKED') && (
                <View style={styles.metaConnectSection}>
                  <Text style={[styles.metaDescription, { color: colors.textSecondary }]}>
                    {metaStatus.metaMode === 'TOKEN_EXPIRED'
                      ? 'Your access token has expired. Please reconnect to restore Meta features.'
                      : 'Meta app access has been revoked. Please reconnect to restore access.'}
                  </Text>
                  {metaStatus.missingScopes.length > 0 && (
                    <View style={styles.metaMissingScopesSection}>
                      <Text style={[styles.metaMissingScopesTitle, { color: colors.error }]}>Missing Scopes:</Text>
                      {metaStatus.missingScopes.map((scope) => (
                        <View key={scope} style={styles.metaScopeItem}>
                          <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                          <Text style={[styles.metaScopeText, { color: colors.textSecondary }]}>{scope}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <Pressable
                    onPress={handleReconnectMeta}
                    disabled={metaActionLoading}
                    style={({ pressed }) => [styles.metaConnectButton, { opacity: (pressed || metaActionLoading) ? 0.6 : 1 }]}
                  >
                    <LinearGradient
                      colors={['#FF6B6B', '#E53E3E']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.metaGradient}
                    >
                      {metaActionLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="refresh" size={20} color="#fff" />
                          <Text style={styles.metaConnectText}>Reconnect</Text>
                        </>
                      )}
                    </LinearGradient>
                  </Pressable>
                </View>
              )}

              {(metaStatus.metaMode === 'DISCONNECTED' || metaStatus.metaMode === 'PENDING_APPROVAL') && (
                <View style={styles.metaConnectSection}>
                  <Text style={[styles.metaDescription, { color: colors.textSecondary }]}>
                    {t('settings.connectMetaDesc')}
                  </Text>
                  <View style={styles.metaBenefits}>
                    <View style={styles.metaBenefit}>
                      <Ionicons name="flash" size={16} color="#1877F2" />
                      <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.autoPostScheduled')}</Text>
                    </View>
                    <View style={styles.metaBenefit}>
                      <Ionicons name="analytics" size={16} color="#1877F2" />
                      <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.crossPlatformAdMgmt')}</Text>
                    </View>
                    <View style={styles.metaBenefit}>
                      <Ionicons name="sync" size={16} color="#1877F2" />
                      <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.unifiedPublishing')}</Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={handleConnectMeta}
                    disabled={metaActionLoading}
                    style={({ pressed }) => [styles.metaConnectButton, { opacity: (pressed || metaActionLoading) ? 0.6 : 1 }]}
                  >
                    <LinearGradient
                      colors={['#1877F2', '#0D65D9']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.metaGradient}
                    >
                      {metaActionLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="link" size={20} color="#fff" />
                          <Text style={styles.metaConnectText}>{t('settings.connectMetaButton')}</Text>
                        </>
                      )}
                    </LinearGradient>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}
        </View>


        {/* OWNED SOCIAL & WEBSITE CHANNELS (CANONICAL RECORD) */}
        <View
          testID="owned-channels-card"
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="share-social-outline" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Owned Social & Website Channels</Text>
            </View>
            <View style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: 'rgba(124,58,237,0.16)',
              borderWidth: 1,
              borderColor: 'rgba(124,58,237,0.35)',
            }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: '#C4B5FD' }}>
                PUBLIC CHANNEL TRACKING
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary, marginBottom: 8 }]}>
            Canonical owned channels shared across Setup, Settings, daily 24-hour acquisition, and Performance Loop. Saved URLs are never erased on validation or scrape failure.
          </Text>
          <View style={{
            backgroundColor: '#131D2E',
            borderWidth: 1,
            borderColor: '#1E3A5F',
            borderRadius: 8,
            padding: 8,
            marginBottom: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}>
            <Ionicons name="information-circle-outline" size={15} color="#7DD3FC" />
            <Text style={{ fontSize: 11, color: '#BAE6FD', flex: 1 }}>
              Tracks public profiles & website pages independently from Meta/LinkedIn OAuth publishing integrations above.
            </Text>
          </View>

          {/* Explicit Loading State */}
          {ownedChannelsLoading && !ownedChannelsLoaded ? (
            <View
              testID="owned-channels-loading-banner"
              style={{
                backgroundColor: '#1E293B',
                borderWidth: 1,
                borderColor: '#334155',
                borderRadius: 10,
                padding: 12,
                marginBottom: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.textSecondary, fontFamily: 'Inter_500Medium' }}>
                Loading saved owned channels for this campaign...
              </Text>
            </View>
          ) : null}

          {/* Explicit Load Error + Retry State */}
          {ownedChannelsLoadError ? (
            <View
              testID="owned-channels-load-error-banner"
              style={{
                backgroundColor: '#3B1219',
                borderWidth: 1,
                borderColor: '#EF4444',
                borderRadius: 10,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
                <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FCA5A5' }}>
                  Unable to Load Canonical Channels
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: '#FECACA', marginBottom: 10 }}>
                {ownedChannelsLoadError} Saving is disabled until channel loading succeeds so existing channels cannot be overwritten.
              </Text>
              <Pressable
                testID="retry-load-owned-channels-btn"
                onPress={() => fetchCampaignCompetitors({ forceOverwriteChannels: false })}
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: '#EF4444',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Ionicons name="refresh" size={14} color="#fff" />
                <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>
                  Retry Loading Channels
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* LinkedIn Identity Unresolved Banner when applicable */}
          {(() => {
            const liRow = ownedChannels.find((c) => String(c.platform || '').toLowerCase() === 'linkedin');
            if (liRow && (liRow.identityStatus === 'UNRESOLVED' || liRow.lifecycleStatus === 'NEEDS_FULL_URL')) {
              return (
                <View
                  testID="linkedin-unresolved-banner"
                  style={{
                    backgroundColor: '#332409',
                    borderWidth: 1,
                    borderColor: '#D97706',
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 14,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name="warning" size={16} color="#FBBF24" />
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FBBF24' }}>
                      Needs full LinkedIn URL — Slug Required Once
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#FDE68A', lineHeight: 18 }}>
                    Your LinkedIn connection was saved ({liRow.url || 'https://linkedin.com/company'}), but only the generic /company root was stored without a slug. Enter your full LinkedIn URL below (e.g. https://www.linkedin.com/company/your-slug or https://www.linkedin.com/in/your-slug) and click Save & Sync Channels.
                  </Text>
                </View>
              );
            }
            return null;
          })()}

          {[
            {
              key: 'instagram',
              label: 'Instagram',
              icon: 'logo-instagram' as const,
              color: '#E1306C',
              value: ownedInstagramInput,
              setter: setOwnedInstagramInput,
              placeholder: 'https://www.instagram.com/yourhandle or @yourhandle',
            },
            {
              key: 'tiktok',
              label: 'TikTok',
              icon: 'musical-notes-outline' as const,
              color: '#38BDF8',
              value: ownedTiktokInput,
              setter: setOwnedTiktokInput,
              placeholder: 'https://www.tiktok.com/@yourhandle or @yourhandle',
            },
            {
              key: 'youtube',
              label: 'YouTube',
              icon: 'logo-youtube' as const,
              color: '#EF4444',
              value: ownedYoutubeInput,
              setter: setOwnedYoutubeInput,
              placeholder: 'https://www.youtube.com/@yourchannel',
            },
            {
              key: 'linkedin',
              label: 'LinkedIn (Company or Personal)',
              icon: 'logo-linkedin' as const,
              color: '#0A66C2',
              value: ownedLinkedinInput,
              setter: setOwnedLinkedinInput,
              placeholder: 'https://www.linkedin.com/company/your-slug or /in/your-slug',
            },
            {
              key: 'website',
              label: 'Website Domain',
              icon: 'globe-outline' as const,
              color: '#10B981',
              value: ownedWebsiteInput,
              setter: setOwnedWebsiteInput,
              placeholder: 'https://yourdomain.com',
            },
          ].map((item) => {
            const row = ownedChannels.find((c) => String(c.platform || '').toLowerCase() === item.key);
            const isUnresolved =
              row?.identityStatus === 'UNRESOLVED' || row?.lifecycleStatus === 'NEEDS_FULL_URL';
            const lifecycle = row?.lifecycleStatus || (
              isUnresolved
                ? 'NEEDS_FULL_URL'
                : row?.scrapeStatus === 'FAILED'
                  ? 'FAILED'
                  : row?.isConfirmedEmpty
                    ? 'VERIFIED_EMPTY'
                    : row?.scrapeStatus === 'SUCCESS' || row?.scrapeStatus === 'PARTIAL' || (row?.storedPostsCount || 0) > 0
                      ? 'FETCHED'
                      : row?.url || row?.handle
                        ? 'CONFIGURED'
                        : 'NOT_CONNECTED'
            );

            let statusText = 'NOT CONNECTED';
            let badgeColor = '#64748B';

            if (!ownedChannelsLoaded && ownedChannelsLoading) {
              statusText = 'LOADING...';
              badgeColor = '#94A3B8';
            } else if (!ownedChannelsLoaded && ownedChannelsLoadError) {
              statusText = 'LOAD ERROR';
              badgeColor = '#EF4444';
            } else if (lifecycle === 'NEEDS_FULL_URL') {
              statusText = 'Needs full LinkedIn URL';
              badgeColor = '#F59E0B';
            } else if (lifecycle === 'QUEUED') {
              statusText = 'QUEUED';
              badgeColor = '#38BDF8';
            } else if (lifecycle === 'FETCHING') {
              statusText = 'FETCHING';
              badgeColor = '#60A5FA';
            } else if (lifecycle === 'FAILED') {
              statusText = 'FAILED';
              badgeColor = '#EF4444';
            } else if (lifecycle === 'VERIFIED_EMPTY') {
              statusText = 'VERIFIED EMPTY (0 posts)';
              badgeColor = '#94A3B8';
            } else if (lifecycle === 'FETCHED') {
              statusText =
                item.key === 'website'
                  ? 'FETCHED'
                  : `FETCHED (${row?.storedPostsCount || 0} posts)`;
              badgeColor = '#10B981';
            } else if (lifecycle === 'CONFIGURED') {
              statusText = 'CONFIGURED';
              badgeColor = '#60A5FA';
            }

            const hasStoredChannel = Boolean(row && (row.url || row.handle));
            const isDirty = Boolean(dirtyChannelFields[item.key]);

            return (
              <View key={item.key} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Ionicons name={item.icon} size={16} color={item.color} />
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.text }}>
                      {item.label}
                    </Text>
                    {row?.accountType ? (
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>
                        ({row.accountType})
                      </Text>
                    ) : null}
                    {isDirty ? (
                      <Text style={{ fontSize: 10, color: '#C4B5FD', fontFamily: 'Inter_600SemiBold' }}>
                        • Unsaved edit
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View
                      testID={`owned-channel-status-${item.key}`}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 6,
                        backgroundColor: badgeColor + '20',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: badgeColor }}>
                        {statusText}
                      </Text>
                    </View>
                    {hasStoredChannel && ownedChannelsLoaded ? (
                      <Pressable
                        testID={`remove-owned-channel-${item.key}`}
                        onPress={() => handleRemoveOwnedChannel(item.key, item.label)}
                        disabled={Boolean(removingChannelPlatform) || ownedChannelsSaving}
                        style={{
                          paddingHorizontal: 7,
                          paddingVertical: 3,
                          borderRadius: 6,
                          backgroundColor: 'rgba(239,68,68,0.14)',
                          borderWidth: 1,
                          borderColor: 'rgba(239,68,68,0.35)',
                          opacity: removingChannelPlatform === item.key ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#FCA5A5' }}>
                          {removingChannelPlatform === item.key ? 'Removing...' : 'Remove'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                <TextInput
                  testID={`owned-channel-input-${item.key}`}
                  editable={ownedChannelsLoaded && !ownedChannelsSaving}
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: isUnresolved
                      ? '#F59E0B'
                      : lifecycle === 'FAILED'
                        ? '#EF4444'
                        : isDirty
                          ? colors.primary
                          : '#334155',
                    backgroundColor: '#1E293B',
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    fontSize: 13,
                    color: colors.text,
                    fontFamily: 'Inter_500Medium',
                    opacity: ownedChannelsLoaded ? 1 : 0.6,
                  }}
                  value={item.value}
                  onChangeText={(text) => {
                    item.setter(text);
                    markChannelDirty(item.key, text.trim() !== (loadedChannelUrls[item.key] || ''));
                  }}
                  placeholder={item.placeholder}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {row && (row.lastScrapedAt || row.scrapeError || row.followersCount > 0) ? (
                  <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 }}>
                    {row.lastScrapedAt ? (
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>
                        Last scraped: {new Date(row.lastScrapedAt).toLocaleString()}
                        {row.nextScrapeDueAt ? ` • Next due (24h): ${new Date(row.nextScrapeDueAt).toLocaleString()}` : ''}
                        {row.followersCount > 0 ? ` • ${row.followersCount.toLocaleString()} followers` : ''}
                      </Text>
                    ) : null}
                    {row.scrapeError ? (
                      <Text
                        testID={`owned-channel-error-${item.key}`}
                        style={{
                          fontSize: 11,
                          color: lifecycle === 'FAILED' ? '#FCA5A5' : '#FBBF24',
                          flexShrink: 1,
                        }}
                      >
                        {row.scrapeError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {ownedChannelsError ? (
            <View
              testID="owned-channels-save-error"
              style={{
                backgroundColor: '#3B1219',
                borderWidth: 1,
                borderColor: '#EF4444',
                borderRadius: 8,
                padding: 10,
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 12, color: '#FCA5A5', fontFamily: 'Inter_500Medium' }}>
                {ownedChannelsError}
              </Text>
            </View>
          ) : null}

          {ownedChannelsMessage ? (
            <View
              testID="owned-channels-save-success"
              style={{
                backgroundColor: '#064E3B',
                borderWidth: 1,
                borderColor: '#10B981',
                borderRadius: 8,
                padding: 10,
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 12, color: '#6EE7B7', fontFamily: 'Inter_500Medium' }}>
                {ownedChannelsMessage}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              testID="save-sync-owned-channels-btn"
              onPress={() => handleSaveOwnedChannels(true)}
              disabled={!ownedChannelsLoaded || ownedChannelsLoading || ownedChannelsSaving}
              style={{
                flex: 1,
                backgroundColor: colors.primary,
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: !ownedChannelsLoaded || ownedChannelsLoading || ownedChannelsSaving ? 0.5 : 1,
              }}
            >
              {ownedChannelsSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="sync-outline" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    {!ownedChannelsLoaded
                      ? ownedChannelsLoading
                        ? 'Loading Channels...'
                        : 'Load Channels First to Save'
                      : 'Save & Sync Channels'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        {/* CAMPAIGN COMPETITORS & MULTI-SOURCE MONITORING */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="shield-half-outline" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Competitors & Data Sources</Text>
            </View>
            <Pressable
              onPress={() => setShowAddCompetitorModal(true)}
              style={styles.addCompHeaderBtn}
              hitSlop={8}
            >
              <Ionicons name="add-circle" size={16} color={colors.primary} />
              <Text style={[styles.addCompHeaderBtnText, { color: colors.primary }]}>Add Competitor</Text>
            </Pressable>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary, marginBottom: 16 }]}>
            Verified multi-source intelligence, fallback discovery, and continuous Watchtower monitoring.
          </Text>

          {loadingCompetitors ? (
            <View style={styles.compLoadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.compLoadingText, { color: colors.textMuted }]}>Loading competitors...</Text>
            </View>
          ) : campaignCompetitors.length === 0 ? (
            <View style={styles.emptyCompsBox}>
              <Ionicons name="search-outline" size={24} color={colors.textMuted} />
              <Text style={[styles.emptyCompsText, { color: colors.textMuted }]}>
                No competitors configured for this campaign yet.
              </Text>
            </View>
          ) : (
            <View style={styles.compListContainer}>
              {campaignCompetitors.map((comp) => {
                const isRefreshing = refreshingCompId === comp.id;
                const sources = comp.sources || {
                  website: { platform: 'website', url: comp.websiteUrl, status: 'VERIFIED' },
                  instagram: { platform: 'instagram', url: null, status: 'NOT_FOUND' },
                  tiktok: { platform: 'tiktok', url: null, status: 'NOT_FOUND' },
                  linkedin: { platform: 'linkedin', url: null, status: 'NOT_FOUND' },
                  x: { platform: 'x', url: null, status: 'NOT_FOUND' },
                  google_search: { platform: 'google_search', url: null, status: 'ACTIVE' },
                  reviews: { platform: 'reviews', url: null, status: 'NOT_FOUND' },
                  blog: { platform: 'blog', url: null, status: 'NOT_FOUND' },
                };

                const sourceList = [
                  { key: 'website', label: 'Website', icon: 'globe-outline', ...sources.website },
                  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram', ...sources.instagram },
                  { key: 'tiktok', label: 'TikTok', icon: 'musical-notes-outline', ...sources.tiktok },
                  { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin', ...sources.linkedin },
                  { key: 'x', label: 'X (Twitter)', icon: 'logo-twitter', ...sources.x },
                  { key: 'google_search', label: 'Google Search', icon: 'search-outline', ...sources.google_search },
                  { key: 'reviews', label: 'Reviews', icon: 'star-half-outline', ...sources.reviews },
                  { key: 'blog', label: 'Blog / Content', icon: 'newspaper-outline', ...sources.blog },
                ];

                return (
                  <View key={comp.id} style={[styles.compCardItem, { backgroundColor: isDark ? '#0D0A1A' : '#F8FAFC', borderColor: colors.cardBorder }]}>
                    <View style={styles.compItemHeader}>
                      <View style={styles.compNameCol}>
                        <View style={styles.compNameRow}>
                          <Text style={[styles.compNameText, { color: colors.text }]}>{comp.name}</Text>
                          <View style={[styles.compTierBadge, { backgroundColor: comp.tier === 'A' ? colors.primary + '20' : '#47556920' }]}>
                            <Text style={[styles.compTierText, { color: comp.tier === 'A' ? colors.primary : '#94A3B8' }]}>
                              Tier {comp.tier || 'B'}
                            </Text>
                          </View>
                          <View style={styles.compActiveDotBadge}>
                            <View style={[styles.activeDot, { backgroundColor: '#34D399' }]} />
                            <Text style={styles.compActiveText}>Monitoring</Text>
                          </View>
                        </View>
                        <Text style={[styles.compWebsiteText, { color: colors.textMuted }]}>{comp.websiteUrl}</Text>
                      </View>

                      <View style={styles.compActionButtons}>
                        <Pressable
                          onPress={() => handleRefreshSources(comp.id)}
                          disabled={isRefreshing}
                          style={({ pressed }) => [
                            styles.compRefreshBtn,
                            { backgroundColor: colors.primary + '15', opacity: (pressed || isRefreshing) ? 0.6 : 1 }
                          ]}
                          hitSlop={6}
                        >
                          {isRefreshing ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <>
                              <Ionicons name="refresh" size={13} color={colors.primary} />
                              <Text style={[styles.compRefreshBtnText, { color: colors.primary }]}>Refresh</Text>
                            </>
                          )}
                        </Pressable>

                        <Pressable
                          onPress={() => handleRemoveCompetitor(comp.id, comp.name)}
                          style={styles.compRemoveBtn}
                          hitSlop={6}
                        >
                          <Ionicons name="trash-outline" size={14} color={colors.error} />
                        </Pressable>
                      </View>
                    </View>

                    {/* SOURCE BREAKDOWN GRID */}
                    <View style={styles.sourcesGrid}>
                      {sourceList.map((s) => {
                        const isVerified = s.status === 'VERIFIED' || s.status === 'ACTIVE';
                        const isUnavailable = s.status === 'PROVIDER_UNAVAILABLE';

                        const badgeColor = isVerified ? '#34D399' : isUnavailable ? '#FBBF24' : '#64748B';
                        const badgeBg = isVerified ? 'rgba(52,211,153,0.12)' : isUnavailable ? 'rgba(251,191,36,0.12)' : 'rgba(100,116,139,0.1)';

                        return (
                          <View key={s.key} style={[styles.sourcePill, { backgroundColor: isDark ? '#141026' : '#FFFFFF', borderColor: isVerified ? 'rgba(124,58,237,0.3)' : colors.cardBorder }]}>
                            <Ionicons name={s.icon as any} size={14} color={isVerified ? colors.primary : colors.textMuted} />
                            <View style={styles.sourcePillContent}>
                              <Text style={[styles.sourcePillLabel, { color: colors.text }]}>{s.label}</Text>
                              {s.url && (
                                <Text style={styles.sourcePillUrl} numberOfLines={1}>
                                  {s.url.replace(/^https?:\/\/(www\.)?/, '')}
                                </Text>
                              )}
                            </View>
                            <View style={[styles.sourceStatusBadge, { backgroundColor: badgeBg }]}>
                              <Text style={[styles.sourceStatusText, { color: badgeColor }]}>
                                {s.status === 'VERIFIED' ? 'Verified' : s.status === 'ACTIVE' ? 'Active' : s.status === 'PROVIDER_UNAVAILABLE' ? 'Unavailable' : 'Not Found'}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>

                    {/* TIMESTAMPS FOOTER */}
                    <View style={styles.compFooterRow}>
                      <Text style={[styles.compFooterText, { color: colors.textMuted }]}>
                        Last fetch: {comp.lastFetchedAt ? new Date(comp.lastFetchedAt).toLocaleDateString() : 'Baseline captured'}
                      </Text>
                      {comp.nextScheduledAt && (
                        <Text style={[styles.compFooterText, { color: colors.textMuted }]}>
                          Next cycle: {new Date(comp.nextScheduledAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setShowProfileModal(true);
          }}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="person-circle" size={20} color="#6366F1" />
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.brandProfile')}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[{ fontSize: 13, color: colors.textMuted }]}>Edit</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              Manage your business profile, audience, pricing, and funnel settings
            </Text>
          </View>
        </Pressable>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.brandVoice')}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.selectTone')}
          </Text>
          <View style={styles.toneGrid}>
            {toneOptions.map(option => (
              <Pressable
                key={option.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setTone(option.key);
                }}
                style={[
                  styles.toneButton,
                  { 
                    backgroundColor: tone === option.key ? colors.primary + '20' : colors.inputBackground,
                    borderColor: tone === option.key ? colors.primary : 'transparent',
                  }
                ]}
              >
                <Text style={[
                  styles.toneLabel,
                  { color: tone === option.key ? colors.primary : colors.textMuted }
                ]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {hasChanges && (
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, { opacity: pressed ? 0.8 : 1 }]}
          >
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>{t('settings.saveChanges')}</Text>
            </LinearGradient>
          </Pressable>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <BusinessProfileModal
        visible={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />

      <Modal
        visible={showLanguageModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.language')}</Text>
              <Pressable onPress={() => setShowLanguageModal(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {languages.map((lang) => (
                <Pressable
                  key={lang.code}
                  onPress={() => handleSelectLanguage(lang.code)}
                  style={({ pressed }) => [
                    styles.languageItem,
                    { 
                      backgroundColor: lang.code === locale ? colors.primary + '15' : colors.card,
                      borderColor: lang.code === locale ? colors.primary : colors.cardBorder,
                      opacity: pressed ? 0.7 : 1,
                    }
                  ]}
                >
                  <View style={styles.languageItemLeft}>
                    <Text style={styles.languageItemFlag}>{lang.flag}</Text>
                    <View style={styles.languageItemText}>
                      <Text style={[styles.languageItemNative, { color: colors.text }]}>{lang.nativeName}</Text>
                      <Text style={[styles.languageItemEnglish, { color: colors.textMuted }]}>{lang.name}</Text>
                    </View>
                  </View>
                  {lang.code === locale && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 24,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  userDetails: {
    gap: 2,
    flex: 1,
    maxWidth: 140,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  userProvider: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  userActions: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  switchAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  switchAccountText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  logoutText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  languageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  languageFlag: {
    fontSize: 16,
  },
  languageName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  metaWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  metaWarningText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metaLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  metaLoadingText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  metaCapabilities: {
    gap: 8,
  },
  metaCapLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  metaCapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaCapItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaCapText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  metaRealInfo: {
    gap: 8,
    marginTop: 4,
  },
  metaMissingScopesSection: {
    gap: 6,
  },
  metaMissingScopesTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  metaScopeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
  },
  metaScopeText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  metaCard: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
    marginBottom: 16,
  },
  metaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  metaLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  metaSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  connectedText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  metaConnectedInfo: {
    gap: 12,
  },
  metaInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  metaInfoText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  metaFeatures: {
    gap: 8,
  },
  metaFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaFeatureText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    marginTop: 4,
  },
  disconnectText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  metaConnectSection: {
    gap: 16,
  },
  metaDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  metaBenefits: {
    gap: 10,
  },
  metaBenefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaBenefitText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  metaConnectButton: {},
  metaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  metaConnectText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  cardSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  connectionsList: {
    gap: 12,
  },
  scheduleList: {
    gap: 10,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
  },
  scheduleLeft: {
    flex: 1,
    gap: 2,
  },
  schedulePlatform: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scheduleInfo: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  derivedMetric: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center' as const,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  toneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toneButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  toneLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 24,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  modalBody: {
    marginBottom: 16,
  },
  languageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  languageItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  languageItemFlag: {
    fontSize: 20,
  },
  languageItemText: {
    gap: 2,
  },
  languageItemNative: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  languageItemEnglish: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },

  addCompHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  addCompHeaderBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  compLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  compLoadingText: {
    fontSize: 13,
  },
  emptyCompsBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyCompsText: {
    fontSize: 13,
    textAlign: 'center',
  },
  compListContainer: {
    gap: 16,
  },
  compCardItem: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  compItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  compNameCol: {
    flex: 1,
    gap: 4,
  },
  compNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  compNameText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  compTierBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  compTierText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  compActiveDotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  compActiveText: {
    fontSize: 11,
    color: '#34D399',
    fontFamily: 'Inter_500Medium',
  },
  compWebsiteText: {
    fontSize: 12,
  },
  compActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  compRefreshBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  compRemoveBtn: {
    padding: 4,
  },
  sourcesGrid: {
    gap: 8,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  sourcePillContent: {
    flex: 1,
  },
  sourcePillLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  sourcePillUrl: {
    fontSize: 11,
    color: '#94A3B8',
  },
  sourceStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sourceStatusText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  compFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  compFooterText: {
    fontSize: 11,
  },
  modalInputGroup: {
    gap: 6,
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  addCompSubmitBtn: {
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 8,
  },
  addCompGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  addCompSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },

});
