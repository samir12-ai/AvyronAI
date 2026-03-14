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
import { PlatformConnection } from '@/components/PlatformConnection';
import { BusinessProfileModal } from '@/components/BusinessProfile';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { router } from 'expo-router';
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
  const isDark = colorScheme === 'dark';
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
  const { user, logout } = useAuth();
  const { selectedCampaignId } = useCampaign();
  const { t, locale, setLocale, languages } = useLanguage();

  const [name, setName] = useState(brandProfile.name);
  const [industry, setIndustry] = useState(brandProfile.industry);
  const [tone, setTone] = useState(brandProfile.tone);
  const [targetAudience, setTargetAudience] = useState(brandProfile.targetAudience);
  const [platforms, setPlatforms] = useState<string[]>(brandProfile.platforms);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

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
  const [retDerived, setRetDerived] = useState({ ltv: 0, churnRisk: 0, retentionStrength: 0, repeatPurchaseRate: 0 });

  const fetchManualMetrics = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/manual-metrics`, apiUrl);
      const res = await fetch(url.toString(), { credentials: 'include' });
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
      const res = await fetch(url.toString(), {
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
      const res = await fetch(url.toString(), { credentials: 'include' });
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
      const res = await fetch(url.toString(), {
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
      const url = new URL('/api/meta/status?accountId=default', apiUrl);
      const res = await fetch(url.toString(), { credentials: 'include' });
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
        const url = new URL('/api/meta/status?accountId=default', apiUrl);
        const res = await fetch(url.toString(), { credentials: 'include' });
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
      await apiRequest('POST', '/api/meta/disconnect', { accountId: 'default' });
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
      await apiRequest('POST', '/api/meta/reconnect', { accountId: 'default' });
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('settings.subtitle')}
        </Text>

        {user && (
          <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.userInfo}>
              <View style={[styles.userAvatar, { backgroundColor: user.provider === 'facebook' ? '#1877F2' : '#E1306C' }]}>
                <Ionicons 
                  name={user.provider === 'facebook' ? 'logo-facebook' : 'logo-instagram'} 
                  size={24} 
                  color="#fff" 
                />
              </View>
              <View style={styles.userDetails}>
                <Text style={[styles.userName, { color: colors.text }]}>{user.name}</Text>
                <Text style={[styles.userProvider, { color: colors.textMuted }]}>
                  {t('settings.signedInWith', { provider: user.provider === 'facebook' ? 'Facebook' : 'Instagram' })}
                </Text>
              </View>
            </View>
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

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="stats-chart" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Campaign Metrics</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: isMetaConnected ? (colors.success + '20') : (colors.accent + '20') }]}>
              <Text style={[styles.badgeText, { color: isMetaConnected ? colors.success : colors.accent }]}>
                {isMetaConnected ? 'Meta Active' : 'Manual Entry'}
              </Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {isMetaConnected
              ? 'Meta is connected — live metrics are used. Manual data is archived.'
              : 'Enter your campaign stats manually. These drive your dashboard, AI actions, and autopilot analysis.'}
          </Text>

          {!selectedCampaignId ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>Select a campaign first to enter metrics</Text>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Spend ($)</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualSpend}
                    onChangeText={setManualSpend}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    editable={!isMetaConnected}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Revenue ($)</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualRevenue}
                    onChangeText={setManualRevenue}
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    editable={!isMetaConnected}
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Leads</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualLeads}
                    onChangeText={setManualLeads}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    editable={!isMetaConnected}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Conversions</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualConversions}
                    onChangeText={setManualConversions}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    editable={!isMetaConnected}
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Impressions</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualImpressions}
                    onChangeText={setManualImpressions}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    editable={!isMetaConnected}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Clicks</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={manualClicks}
                    onChangeText={setManualClicks}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    editable={!isMetaConnected}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <View style={[styles.derivedMetric, { backgroundColor: colors.primary + '10', borderColor: colors.primary + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>CPA (derived)</Text>
                  <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>${manualDerived.cpa.toFixed(2)}</Text>
                </View>
                <View style={[styles.derivedMetric, { backgroundColor: colors.success + '10', borderColor: colors.success + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>ROAS (derived)</Text>
                  <Text style={{ color: colors.success, fontSize: 18, fontWeight: '700' }}>{manualDerived.roas.toFixed(2)}x</Text>
                </View>
              </View>

              {!isMetaConnected && (
                <Pressable
                  onPress={handleSaveManualMetrics}
                  disabled={manualSaving}
                  style={({ pressed }) => [{
                    backgroundColor: colors.primary,
                    padding: 14,
                    borderRadius: 10,
                    alignItems: 'center' as const,
                    marginTop: 6,
                    opacity: (pressed || manualSaving) ? 0.7 : 1,
                  }]}
                >
                  {manualSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Save Campaign Metrics</Text>
                  )}
                </Pressable>
              )}
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="repeat" size={20} color="#8B5CF6" />
              <Text style={[styles.cardTitle, { color: colors.text }]}>Retention Metrics</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#8B5CF6' + '20' }]}>
              <Text style={[styles.badgeText, { color: '#8B5CF6' }]}>Engine Input</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Enter raw business numbers. The system automatically computes retention rate, LTV, churn risk, and retention strength.
          </Text>

          {!selectedCampaignId ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>Select a campaign first to enter retention data</Text>
            </View>
          ) : (
            <View style={{ marginTop: 12, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Total Customers *</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retTotalCustomers}
                    onChangeText={setRetTotalCustomers}
                    placeholder="e.g. 500"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Total Purchases *</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retTotalPurchases}
                    onChangeText={setRetTotalPurchases}
                    placeholder="e.g. 750"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Returning Customers *</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retReturningCustomers}
                    onChangeText={setRetReturningCustomers}
                    placeholder="e.g. 120"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Avg Order Value ($)</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retAvgOrderValue}
                    onChangeText={setRetAvgOrderValue}
                    placeholder="e.g. 45"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Refund Count</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retRefundCount}
                    onChangeText={setRetRefundCount}
                    placeholder="e.g. 15"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Monthly Active</Text>
                  <TextInput
                    style={[styles.textInput, { backgroundColor: colors.inputBg, color: colors.text, borderColor: colors.cardBorder }]}
                    value={retMonthlyCustomers}
                    onChangeText={setRetMonthlyCustomers}
                    placeholder="e.g. 200"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <View style={{ marginTop: 4 }}>
                <Text style={[styles.inputLabel, { color: colors.textSecondary, marginBottom: 6 }]}>Time Window</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[{ label: '30 Days', value: '30' }, { label: '60 Days', value: '60' }, { label: '90 Days', value: '90' }].map(w => (
                    <Pressable
                      key={w.value}
                      onPress={() => setRetDataWindow(w.value)}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: retDataWindow === w.value ? '#8B5CF6' : colors.cardBorder,
                        backgroundColor: retDataWindow === w.value ? '#8B5CF6' + '15' : 'transparent',
                        alignItems: 'center' as const,
                      }}
                    >
                      <Text style={{ color: retDataWindow === w.value ? '#8B5CF6' : colors.textSecondary, fontSize: 13, fontWeight: '500' as const }}>{w.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <View style={[styles.derivedMetric, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Repeat Rate</Text>
                  <Text style={{ color: '#8B5CF6', fontSize: 16, fontWeight: '700' as const }}>{(retDerived.repeatPurchaseRate * 100).toFixed(0)}%</Text>
                </View>
                <View style={[styles.derivedMetric, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Est. LTV</Text>
                  <Text style={{ color: '#8B5CF6', fontSize: 16, fontWeight: '700' as const }}>${retDerived.ltv.toFixed(0)}</Text>
                </View>
                <View style={[styles.derivedMetric, { backgroundColor: (retDerived.churnRisk > 0.5 ? '#EF4444' : '#10B981') + '10', borderColor: (retDerived.churnRisk > 0.5 ? '#EF4444' : '#10B981') + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Churn Risk</Text>
                  <Text style={{ color: retDerived.churnRisk > 0.5 ? '#EF4444' : '#10B981', fontSize: 16, fontWeight: '700' as const }}>{(retDerived.churnRisk * 100).toFixed(0)}%</Text>
                </View>
                <View style={[styles.derivedMetric, { backgroundColor: '#3B82F6' + '10', borderColor: '#3B82F6' + '30' }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Retention</Text>
                  <Text style={{ color: '#3B82F6', fontSize: 16, fontWeight: '700' as const }}>{(retDerived.retentionStrength * 100).toFixed(0)}%</Text>
                </View>
              </View>

              <Pressable
                onPress={handleSaveRetentionMetrics}
                disabled={retSaving}
                style={({ pressed }) => [{
                  backgroundColor: '#8B5CF6',
                  padding: 14,
                  borderRadius: 10,
                  alignItems: 'center' as const,
                  marginTop: 6,
                  opacity: (pressed || retSaving) ? 0.7 : 1,
                }]}
              >
                {retSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '600' as const, fontSize: 15 }}>Save Retention Data</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="link" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.connectedPlatforms')}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{connectedCount} {t('settings.active')}</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.connectSocialDesc')}
          </Text>
          <View style={styles.connectionsList}>
            {platformConnections.map(connection => {
              const style = platformIcons[connection.id] || { icon: 'globe' as const, color: colors.primary };
              const isMetaPlatform = connection.id === 'facebook' || connection.id === 'instagram';
              return (
                <PlatformConnection
                  key={connection.id}
                  name={connection.name}
                  icon={style.icon}
                  color={style.color}
                  isConnected={connection.isConnected}
                  onConnect={() => isMetaPlatform && !metaConnection.isConnected ? handleConnectMeta() : handleConnect(connection.id)}
                  onDisconnect={() => isMetaPlatform ? handleDisconnectMeta() : handleDisconnect(connection.id)}
                  hint={isMetaPlatform ? t('settings.viaMetaBusiness') : undefined}
                />
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="time" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.autoPublishSchedule')}</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.autoPublishDesc')}
          </Text>
          <View style={styles.scheduleList}>
            {postingSchedules.map(schedule => {
              const connection = platformConnections.find(c => c.name === schedule.platform);
              const isConnected = connection?.isConnected || false;
              return (
                <View 
                  key={schedule.platform}
                  style={[styles.scheduleItem, { backgroundColor: colors.inputBackground }]}
                >
                  <View style={styles.scheduleLeft}>
                    <Text style={[styles.schedulePlatform, { color: colors.text }]}>{schedule.platform}</Text>
                    <Text style={[styles.scheduleInfo, { color: colors.textMuted }]}>
                      {schedule.times.join(', ')} on {schedule.days.join(', ')}
                    </Text>
                  </View>
                  <Switch
                    value={schedule.enabled && isConnected}
                    onValueChange={(value) => handleScheduleToggle(schedule.platform, value)}
                    disabled={!isConnected}
                    trackColor={{ false: colors.inputBorder, true: colors.primary + '50' }}
                    thumbColor={schedule.enabled && isConnected ? colors.primary : colors.textMuted}
                  />
                </View>
              );
            })}
          </View>
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
  userDetails: {
    gap: 2,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  userProvider: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  logoutText: {
    fontSize: 13,
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
});
