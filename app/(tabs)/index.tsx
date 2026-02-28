import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  RefreshControl,
  Pressable,
  Switch,
  Animated as RNAnimated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCampaign } from '@/context/CampaignContext';
import { MetricCard } from '@/components/MetricCard';
import { CampaignBar } from '@/components/CampaignSelector';
import { getApiUrl } from '@/lib/query-client';
import { BusinessProfileModal, ProfileButton } from '@/components/BusinessProfile';

const { width: SCREEN_W } = Dimensions.get('window');

const P = {
  mint: '#8B5CF6',
  mintDark: '#7C3AED',
  neon: '#39FF14',
  money: '#85BB65',
  gold: '#FFD700',
  goldMuted: '#C9A84C',
  deepGreen: '#064E3B',
  darkBg: '#080C10',
  darkCard: '#0F1419',
  darkCardBorder: '#1A2030',
  darkSurface: '#151B24',
  lightBg: '#F4F7F5',
  lightCard: '#FFFFFF',
  lightCardBorder: '#E2E8E4',
  lightSurface: '#EDF2EE',
  coral: '#FF6B6B',
  blue: '#4C9AFF',
  purple: '#A78BFA',
  orange: '#FFB347',
  silver: '#8892A4',
  textDarkPrimary: '#E8EDF2',
  textDarkSec: '#8892A4',
  textDarkMuted: '#4A5568',
  textLightPrimary: '#1A2332',
  textLightSec: '#546478',
  textLightMuted: '#8A96A8',
};

function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const pulse = useRef(new RNAnimated.Value(0.3)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.3, duration: 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <RNAnimated.View style={{
        width: size + 10,
        height: size + 10,
        borderRadius: (size + 10) / 2,
        backgroundColor: color + '25',
        position: 'absolute',
        opacity: pulse,
      }} />
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }} />
    </View>
  );
}

function MiniBarChart({ isDark }: { isDark: boolean }) {
  const bars = [0.4, 0.6, 0.35, 0.8, 0.55, 0.9, 0.7];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 32 }}>
      {bars.map((h, i) => (
        <View
          key={i}
          style={{
            width: 4,
            height: 32 * h,
            borderRadius: 2,
            backgroundColor: i === bars.length - 1 ? P.mint : (isDark ? P.mint + '30' : P.mint + '25'),
          }}
        />
      ))}
    </View>
  );
}

type DashboardMetrics = {
  revenue: number;
  roas: number;
  spent: number;
  results: number;
  cpa: number;
  contentCount: number;
  queuedCount: number;
  publishedCount: number;
  reach: number;
  engagement: number;
};

type AIAction = {
  id: string;
  action: string;
  evidenceMetric: string;
  evidenceTimeframe: string;
  sourceTag: string;
  priority: string;
  priorityJustification: string;
};

type PanelState = 'loading' | 'empty' | 'error' | 'success' | 'no_data';

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { metaConnection, advancedMode, setAdvancedMode } = useApp();
  const { selectedCampaignId } = useCampaign();

  const [showInsights, setShowInsights] = useState(false);

  const [metricsState, setMetricsState] = useState<PanelState>('loading');
  const [metricsError, setMetricsError] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [dataSource, setDataSource] = useState<'META' | 'MANUAL' | 'PLAN' | 'NONE'>('NONE');
  const [planMetrics, setPlanMetrics] = useState<{ plannedPieces: number; generatedPieces: number; failedPieces: number; pendingGeneration: number; completionPct: number; nextScheduledDate: string | null; hasPlan: boolean; planStatus: string | null } | null>(null);

  const [actionsState, setActionsState] = useState<PanelState>('loading');
  const [actionsError, setActionsError] = useState<number | null>(null);
  const [aiActions, setAiActions] = useState<AIAction[]>([]);
  const [actionsGated, setActionsGated] = useState(false);

  const [confidenceScore, setConfidenceScore] = useState(0);
  const [confidenceStatus, setConfidenceStatus] = useState<'Stable' | 'Caution' | 'Unstable'>('Stable');
  const [confidenceLoaded, setConfidenceLoaded] = useState(false);
  const [planBindingState, setPlanBindingState] = useState<'CONNECTED' | 'BLOCKED' | null>(null);
  const [planBindingId, setPlanBindingId] = useState<string | null>(null);
  const [planBindingReason, setPlanBindingReason] = useState<string | null>(null);

  const [dataMode, setDataMode] = useState<'REAL' | 'MANUAL' | 'UNKNOWN'>('UNKNOWN');
  const [refreshing, setRefreshing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const prevCampaignRef = useRef<string | null | undefined>(undefined);

  const headerFade = useRef(new RNAnimated.Value(0)).current;
  const cardSlide = useRef(new RNAnimated.Value(30)).current;
  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.timing(headerFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      RNAnimated.timing(cardSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  const baseUrl = getApiUrl();

  const activeCampaignRef = useRef<string | null>(selectedCampaignId);
  useEffect(() => { activeCampaignRef.current = selectedCampaignId; }, [selectedCampaignId]);

  const fetchMetrics = useCallback(async () => {
    const requestCampaign = selectedCampaignId;
    if (!requestCampaign) {
      setMetricsState('empty');
      setMetrics(null);
      return;
    }
    setMetricsState('loading');
    try {
      const res = await fetch(new URL(`/api/dashboard/metrics?accountId=default&campaignId=${requestCampaign}`, baseUrl).toString());
      if (activeCampaignRef.current !== requestCampaign) return;
      if (!res.ok) {
        setMetricsState('error');
        setMetricsError(res.status);
        return;
      }
      const data = await res.json();
      if (activeCampaignRef.current !== requestCampaign) return;
      if (!data.success) {
        setMetricsState('error');
        setMetricsError(500);
        return;
      }
      setMetrics(data.metrics);
      setDataSource(data.dataSource || 'NONE');
      setPlanMetrics(data.planMetrics || null);
      setMetricsState(data.dataSource === 'PLAN' ? 'no_data' : (data.hasData ? 'success' : 'no_data'));
      setMetricsError(null);
    } catch {
      if (activeCampaignRef.current !== requestCampaign) return;
      setMetricsState('error');
      setMetricsError(0);
    }
  }, [baseUrl, selectedCampaignId]);

  const fetchActions = useCallback(async () => {
    const requestCampaign = selectedCampaignId;
    if (!requestCampaign) {
      setActionsState('empty');
      setAiActions([]);
      return;
    }
    setActionsState('loading');
    try {
      const res = await fetch(new URL(`/api/dashboard/ai-actions?accountId=default&campaignId=${requestCampaign}`, baseUrl).toString());
      if (activeCampaignRef.current !== requestCampaign) return;
      if (!res.ok) {
        setActionsState('error');
        setActionsError(res.status);
        return;
      }
      const data = await res.json();
      if (activeCampaignRef.current !== requestCampaign) return;
      if (data.gated) {
        setActionsGated(true);
        setAiActions([]);
        setActionsState('empty');
        return;
      }
      setActionsGated(false);
      setAiActions(data.actions || []);
      setActionsState(data.actions?.length > 0 ? 'success' : 'no_data');
      setActionsError(null);
    } catch {
      if (activeCampaignRef.current !== requestCampaign) return;
      setActionsState('error');
      setActionsError(0);
    }
  }, [baseUrl, selectedCampaignId]);

  const fetchConfidence = useCallback(async () => {
    try {
      const res = await fetch(new URL('/api/autopilot/status', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setConfidenceScore(data.confidenceScore ?? 0);
        setConfidenceStatus((data.confidenceStatus ?? 'Stable') as 'Stable' | 'Caution' | 'Unstable');
        setConfidenceLoaded(true);
        if (data.planBinding) {
          setPlanBindingState(data.planBinding.state);
          setPlanBindingId(data.planBinding.planId);
          setPlanBindingReason(data.planBinding.reason);
        }
      }
    } catch {}
  }, [baseUrl]);

  const fetchDataMode = useCallback(async () => {
    try {
      const res = await fetch(new URL('/api/dashboard/mode', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setDataMode(data.mode || 'UNKNOWN');
      }
    } catch {}
  }, [baseUrl]);

  useEffect(() => {
    const isSwitch = prevCampaignRef.current !== undefined && prevCampaignRef.current !== selectedCampaignId;
    prevCampaignRef.current = selectedCampaignId;

    if (isSwitch) {
      setMetrics(null);
      setMetricsState('loading');
      setMetricsError(null);
      setDataSource('NONE');
      setPlanMetrics(null);
      setAiActions([]);
      setActionsState('loading');
      setActionsError(null);
      setActionsGated(false);
      setConfidenceScore(0);
      setConfidenceStatus('Stable');
      setConfidenceLoaded(false);
      setPlanBindingState(null);
      setPlanBindingId(null);
      setPlanBindingReason(null);
      setDataMode('UNKNOWN');
    }

    fetchMetrics();
    fetchActions();
    fetchConfidence();
    fetchDataMode();
  }, [selectedCampaignId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchMetrics(), fetchActions(), fetchConfidence(), fetchDataMode()]);
    setRefreshing(false);
  }, [fetchMetrics, fetchActions, fetchConfidence, fetchDataMode]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(0);
  };

  const formatCurrency = (num: number): string => {
    if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
    return '$' + num.toFixed(2);
  };

  const confColor = confidenceStatus === 'Stable' ? P.mint : confidenceStatus === 'Caution' ? P.orange : P.coral;

  const bg = isDark ? P.darkBg : P.lightBg;
  const textPrimary = isDark ? P.textDarkPrimary : P.textLightPrimary;
  const textSecondary = isDark ? P.textDarkSec : P.textLightSec;
  const textMuted = isDark ? P.textDarkMuted : P.textLightMuted;
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;

  const sourceTagColor = (tag: string) => {
    switch (tag) {
      case 'PERFORMANCE': return P.mint;
      case 'PLAN': return P.blue;
      case 'PLAN_PROGRESS': return P.blue;
      case 'MANUAL_METRICS': return P.orange;
      case 'HYBRID': return P.purple;
      case 'GATES': return P.orange;
      case 'PUBLISH': return P.purple;
      default: return P.silver;
    }
  };

  const renderMetricsPanel = () => {
    if (metricsState === 'loading') {
      return (
        <View style={[s.heroCard, { borderColor: cardBorder, backgroundColor: cardBg, padding: 40, alignItems: 'center' }]}>
          <ActivityIndicator size="small" color={P.mint} />
          <Text style={[{ fontSize: 12, color: textMuted, marginTop: 8 }]}>Loading metrics...</Text>
        </View>
      );
    }
    if (metricsState === 'empty') {
      return (
        <View style={[s.heroCard, { borderColor: cardBorder, backgroundColor: cardBg, padding: 30, alignItems: 'center' }]}>
          <Ionicons name="analytics-outline" size={28} color={textMuted} />
          <Text style={[{ fontSize: 14, fontWeight: '600', color: textPrimary, marginTop: 10 }]}>No campaign selected</Text>
          <Text style={[{ fontSize: 12, color: textMuted, marginTop: 4, textAlign: 'center' }]}>Select a campaign to view performance metrics</Text>
        </View>
      );
    }
    if (metricsState === 'error') {
      return (
        <View style={[s.heroCard, { borderColor: P.coral + '30', backgroundColor: cardBg, padding: 30, alignItems: 'center' }]}>
          <Ionicons name="warning-outline" size={28} color={P.coral} />
          <Text style={[{ fontSize: 14, fontWeight: '600', color: P.coral, marginTop: 10 }]}>Failed to load metrics</Text>
          <Text style={[{ fontSize: 11, color: textMuted, marginTop: 4 }]}>Error {metricsError || 'unknown'}</Text>
          <Pressable onPress={fetchMetrics} style={{ marginTop: 10, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: P.coral + '15', borderRadius: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: P.coral }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (metricsState === 'no_data') {
      const pm = planMetrics;
      if (pm && pm.hasPlan) {
        return (
          <View>
            <LinearGradient
              colors={isDark ? ['#0A2F1F', '#0C1A14', '#0F1419'] : ['#E8F5E9', '#F1F8E9', '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[s.heroCard, { borderColor: isDark ? P.mint + '18' : P.mint + '20' }]}
            >
              <View style={s.heroTop}>
                <View>
                  <Text style={[s.heroLabel, { color: isDark ? P.mint : P.mintDark }]}>PLAN PROGRESS</Text>
                  <Text style={[s.heroValue, { color: textPrimary }]}>{pm.completionPct}%</Text>
                </View>
                <View style={[s.heroGrowth, { backgroundColor: P.blue + '15' }]}>
                  <Ionicons name="document-text" size={14} color={P.blue} />
                  <Text style={[s.heroGrowthText, { color: P.blue }]}>{pm.planStatus}</Text>
                </View>
              </View>
              <View style={[s.heroDivider, { backgroundColor: isDark ? P.mint + '12' : P.mint + '15' }]} />
              <View style={s.heroStats}>
                <View style={s.heroStat}>
                  <Text style={[s.heroStatValue, { color: P.mint }]}>{pm.plannedPieces}</Text>
                  <Text style={[s.heroStatLabel, { color: textMuted }]}>Required</Text>
                </View>
                <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
                <View style={s.heroStat}>
                  <Text style={[s.heroStatValue, { color: P.blue }]}>{pm.generatedPieces}</Text>
                  <Text style={[s.heroStatLabel, { color: textMuted }]}>Fulfilled</Text>
                </View>
                <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
                <View style={s.heroStat}>
                  <Text style={[s.heroStatValue, { color: pm.pendingGeneration > 0 ? P.orange : P.mint }]}>{pm.pendingGeneration}</Text>
                  <Text style={[s.heroStatLabel, { color: textMuted }]}>Remaining</Text>
                </View>
              </View>
            </LinearGradient>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginTop: 6, marginBottom: 4 }}>
              <Ionicons name="information-circle-outline" size={14} color={P.blue} />
              <Text style={{ fontSize: 11, color: P.blue }}>
                Meta not connected — numbers from your plan & studio
              </Text>
            </View>
          </View>
        );
      }
      return (
        <View>
          <LinearGradient
            colors={isDark ? ['#0A2F1F', '#0C1A14', '#0F1419'] : ['#E8F5E9', '#F1F8E9', '#FFFFFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.heroCard, { borderColor: isDark ? P.mint + '18' : P.mint + '20' }]}
          >
            <View style={s.heroTop}>
              <View>
                <Text style={[s.heroLabel, { color: isDark ? P.mint : P.mintDark }]}>PLAN PROGRESS</Text>
                <Text style={[s.heroValue, { color: textPrimary }]}>0%</Text>
              </View>
              <View style={[s.heroGrowth, { backgroundColor: P.orange + '15' }]}>
                <Ionicons name="alert-circle" size={14} color={P.orange} />
                <Text style={[s.heroGrowthText, { color: P.orange }]}>No Plan</Text>
              </View>
            </View>
            <View style={[s.heroDivider, { backgroundColor: isDark ? P.mint + '12' : P.mint + '15' }]} />
            <View style={s.heroStats}>
              <View style={s.heroStat}>
                <Text style={[s.heroStatValue, { color: textMuted }]}>0</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>Required</Text>
              </View>
              <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
              <View style={s.heroStat}>
                <Text style={[s.heroStatValue, { color: textMuted }]}>0</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>Fulfilled</Text>
              </View>
              <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
              <View style={s.heroStat}>
                <Text style={[s.heroStatValue, { color: textMuted }]}>0</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>Remaining</Text>
              </View>
            </View>
          </LinearGradient>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, marginTop: 6, marginBottom: 4 }}>
            <Ionicons name="rocket-outline" size={14} color={P.orange} />
            <Text style={{ fontSize: 11, color: P.orange }}>
              Go to AI Content &gt; Build The Plan to create your strategic plan
            </Text>
          </View>
        </View>
      );
    }

    const m = metrics!;
    return (
      <LinearGradient
        colors={isDark ? ['#0A2F1F', '#0C1A14', '#0F1419'] : ['#E8F5E9', '#F1F8E9', '#FFFFFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroCard, { borderColor: isDark ? P.mint + '18' : P.mint + '20' }]}
      >
        <View style={s.heroTop}>
          <View>
            <Text style={[s.heroLabel, { color: isDark ? P.mint : P.mintDark }]}>TOTAL REVENUE</Text>
            <Text style={[s.heroValue, { color: textPrimary }]}>{formatCurrency(m.revenue)}</Text>
          </View>
          <View style={[s.heroGrowth, { backgroundColor: P.mint + '15' }]}>
            <Ionicons name="arrow-up" size={14} color={P.mint} />
            <Text style={[s.heroGrowthText, { color: P.mint }]}>
              {m.roas > 0 ? `${m.roas.toFixed(1)}x` : '0x'}
            </Text>
            <Text style={[s.heroGrowthLabel, { color: textMuted }]}>ROAS</Text>
          </View>
        </View>
        <View style={[s.heroDivider, { backgroundColor: isDark ? P.mint + '12' : P.mint + '15' }]} />
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <View style={[s.heroStatIcon, { backgroundColor: P.blue + '15' }]}>
              <Ionicons name="wallet-outline" size={14} color={P.blue} />
            </View>
            <Text style={[s.heroStatValue, { color: textPrimary }]}>{formatCurrency(m.spent)}</Text>
            <Text style={[s.heroStatLabel, { color: textMuted }]}>Spent</Text>
          </View>
          <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
          <View style={s.heroStat}>
            <View style={[s.heroStatIcon, { backgroundColor: P.mint + '15' }]}>
              <Ionicons name="flash-outline" size={14} color={P.mint} />
            </View>
            <Text style={[s.heroStatValue, { color: textPrimary }]}>{formatNumber(m.results)}</Text>
            <Text style={[s.heroStatLabel, { color: textMuted }]}>Results</Text>
          </View>
          <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
          <View style={s.heroStat}>
            <View style={[s.heroStatIcon, { backgroundColor: P.orange + '15' }]}>
              <Ionicons name="pricetag-outline" size={14} color={P.orange} />
            </View>
            <Text style={[s.heroStatValue, { color: m.cpa < 15 ? P.mint : P.orange }]}>{formatCurrency(m.cpa)}</Text>
            <Text style={[s.heroStatLabel, { color: textMuted }]}>CPA</Text>
          </View>
        </View>
      </LinearGradient>
    );
  };

  const renderActionsPanel = () => {
    if (actionsState === 'loading') {
      return (
        <View style={[s.aiCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={s.aiCardHeader}>
            <View style={s.aiCardLeft}>
              <View style={[s.aiCardIcon, { backgroundColor: isDark ? '#1F1135' : '#F3EEFF' }]}>
                <Ionicons name="flash" size={15} color={P.purple} />
              </View>
              <Text style={[s.aiCardTitle, { color: textPrimary }]}>AI Actions</Text>
            </View>
          </View>
          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={P.purple} />
          </View>
        </View>
      );
    }
    if (actionsState === 'error') {
      return (
        <View style={[s.aiCard, { backgroundColor: cardBg, borderColor: P.coral + '30' }]}>
          <View style={s.aiCardHeader}>
            <View style={s.aiCardLeft}>
              <Ionicons name="warning-outline" size={15} color={P.coral} />
              <Text style={[s.aiCardTitle, { color: P.coral }]}>AI Actions</Text>
            </View>
          </View>
          <Text style={[{ fontSize: 12, color: textMuted }]}>Failed to load (Error {actionsError || 'unknown'})</Text>
          <Pressable onPress={fetchActions} style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: P.coral + '15', borderRadius: 6, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: P.coral }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (actionsGated) {
      return (
        <View style={[s.aiCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={s.aiCardHeader}>
            <View style={s.aiCardLeft}>
              <View style={[s.aiCardIcon, { backgroundColor: isDark ? '#1F1135' : '#F3EEFF' }]}>
                <Ionicons name="lock-closed" size={15} color={P.silver} />
              </View>
              <Text style={[s.aiCardTitle, { color: textMuted }]}>AI Actions</Text>
            </View>
          </View>
          <Text style={[{ fontSize: 12, color: textMuted, paddingVertical: 4 }]}>
            Requires an approved plan. Build and approve a strategic plan to unlock AI-driven actions.
          </Text>
        </View>
      );
    }
    if (actionsState === 'empty' || actionsState === 'no_data') {
      return (
        <View style={[s.aiCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={s.aiCardHeader}>
            <View style={s.aiCardLeft}>
              <View style={[s.aiCardIcon, { backgroundColor: isDark ? '#1F1135' : '#F3EEFF' }]}>
                <Ionicons name="flash" size={15} color={P.purple} />
              </View>
              <Text style={[s.aiCardTitle, { color: textPrimary }]}>AI Actions</Text>
            </View>
          </View>
          <Text style={[{ fontSize: 12, color: textMuted, paddingVertical: 4 }]}>
            {selectedCampaignId ? 'No actions available yet' : 'Select a campaign to view AI actions'}
          </Text>
        </View>
      );
    }

    return (
      <View style={[s.aiCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.aiCardHeader}>
          <View style={s.aiCardLeft}>
            <View style={[s.aiCardIcon, { backgroundColor: isDark ? '#1F1135' : '#F3EEFF' }]}>
              <Ionicons name="flash" size={15} color={P.purple} />
            </View>
            <Text style={[s.aiCardTitle, { color: textPrimary }]}>AI Actions</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MiniBarChart isDark={isDark} />
            <View style={[s.actionCount, { backgroundColor: P.purple + '12' }]}>
              <Text style={[s.actionCountText, { color: P.purple }]}>{aiActions.length}</Text>
            </View>
          </View>
        </View>
        {aiActions.map((action, i) => (
          <View key={action.id} style={[s.aiAction, i < aiActions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? '#1A2030' : '#F0F3F1' }]}>
            <View style={[s.aiActionDot, { backgroundColor: sourceTagColor(action.sourceTag) }]} />
            <View style={{ flex: 1 }}>
              <Text style={[s.aiActionText, { color: textSecondary }]}>{action.action}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                <View style={{ paddingHorizontal: 5, paddingVertical: 1, backgroundColor: sourceTagColor(action.sourceTag) + '15', borderRadius: 4 }}>
                  <Text style={{ fontSize: 9, fontWeight: '600', color: sourceTagColor(action.sourceTag) }}>{action.sourceTag}</Text>
                </View>
                <Text style={{ fontSize: 10, color: textMuted }}>{action.evidenceMetric}</Text>
                <Text style={{ fontSize: 10, color: textMuted }}>{action.evidenceTimeframe}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 8 : insets.top + 8 },
        ]}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            tintColor={P.mint}
          />
        }
      >
        {dataMode === 'MANUAL' && (
          <View style={[s.manualBanner, { backgroundColor: P.mint + '18', borderColor: P.mint + '30' }]}>
            <Ionicons name="create-outline" size={16} color={P.mint} />
            <Text style={[s.manualBannerText, { color: P.mint }]}>Manual Data — Enter metrics in Settings</Text>
          </View>
        )}

        <RNAnimated.View style={{ opacity: headerFade }}>
          <View style={s.headerRow}>
            <View style={s.headerLeft}>
              <View style={[s.logoMark, { backgroundColor: P.mint }]}>
                <Ionicons name="trending-up" size={16} color="#fff" />
              </View>
              <View>
                <Text style={[s.brandName, { color: textPrimary }]}>MarketMind</Text>
                <Text style={[s.brandSub, { color: P.mint }]}>AI MARKETING</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ProfileButton onPress={() => setShowProfile(true)} />
              <Pressable 
                onPress={() => router.push('/(tabs)/ai-management')}
                style={[s.headerBtn, { backgroundColor: isDark ? P.darkSurface : P.lightSurface }]}
              >
                <Feather name="sliders" size={18} color={textSecondary} />
              </Pressable>
            </View>
          </View>
        </RNAnimated.View>

        <CampaignBar />

        <RNAnimated.View style={{ opacity: headerFade, transform: [{ translateY: cardSlide }] }}>
          {renderMetricsPanel()}
        </RNAnimated.View>

        {confidenceLoaded && selectedCampaignId ? (
          <View style={[s.autopilotStrip, { 
            backgroundColor: isDark ? P.darkCard : P.lightCard,
            borderColor: planBindingState === 'BLOCKED' ? '#F59E0B40' : cardBorder,
          }]}>
            <View style={s.autopilotInner}>
              <View style={[s.autopilotDot, { backgroundColor: (planBindingState === 'BLOCKED' ? '#F59E0B' : P.mint) + '15' }]}>
                <PulsingDot color={planBindingState === 'BLOCKED' ? '#F59E0B' : P.mint} size={8} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.autopilotTopRow}>
                  <Text style={[s.autopilotTitle, { color: textPrimary }]}>
                    {planBindingState === 'BLOCKED' ? 'Autopilot Blocked' : 'Autopilot Connected'}
                  </Text>
                </View>
                {planBindingState === 'BLOCKED' ? (
                  <Text style={{ color: '#F59E0B', fontSize: 10, marginTop: 2 }}>No Approved Plan</Text>
                ) : planBindingId ? (
                  <Text style={{ color: P.mint, fontSize: 10, marginTop: 2 }}>Plan {planBindingId.slice(0, 8)}</Text>
                ) : null}
              </View>
              {planBindingState !== 'BLOCKED' && (
                <View style={s.confBlock}>
                  <Text style={[s.confValue, { color: confColor }]}>{confidenceScore}%</Text>
                  <View style={[s.confBar, { backgroundColor: isDark ? '#1A2030' : '#E5EBE7' }]}>
                    <View style={[s.confFill, { width: `${confidenceScore}%`, backgroundColor: confColor }]} />
                  </View>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {metricsState === 'success' && planMetrics?.hasPlan ? (
          <View style={{ marginTop: 12, backgroundColor: cardBg, borderRadius: 16, borderWidth: 1, borderColor: isDark ? P.mint + '18' : P.mint + '20', padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="document-text" size={16} color={P.mint} />
                <Text style={{ fontSize: 13, fontWeight: '700' as const, color: isDark ? P.mint : P.mintDark, letterSpacing: 1 }}>PLAN PROGRESS</Text>
              </View>
              <Text style={{ fontSize: 22, fontWeight: '800' as const, color: textPrimary }}>{planMetrics.completionPct}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: isDark ? '#1A2530' : '#E5EBE7', borderRadius: 3, overflow: 'hidden' as const, marginBottom: 14 }}>
              <View style={{ height: 6, backgroundColor: P.mint, borderRadius: 3, width: `${planMetrics.completionPct}%` }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' as const }}>
                <Text style={{ fontSize: 20, fontWeight: '700' as const, color: P.mint }}>{planMetrics.plannedPieces}</Text>
                <Text style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Required</Text>
              </View>
              <View style={{ width: 1, backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }} />
              <View style={{ alignItems: 'center' as const }}>
                <Text style={{ fontSize: 20, fontWeight: '700' as const, color: P.blue }}>{planMetrics.generatedPieces}</Text>
                <Text style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Fulfilled</Text>
              </View>
              <View style={{ width: 1, backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }} />
              <View style={{ alignItems: 'center' as const }}>
                <Text style={{ fontSize: 20, fontWeight: '700' as const, color: planMetrics.pendingGeneration > 0 ? P.orange : P.mint }}>{planMetrics.pendingGeneration}</Text>
                <Text style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Remaining</Text>
              </View>
            </View>
          </View>
        ) : null}

        {metricsState === 'success' && metrics ? (
          <View style={s.quickGrid}>
            <Pressable 
              style={[s.quickCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/(tabs)/create')}
            >
              <LinearGradient
                colors={[P.purple + '18', P.purple + '05']}
                style={s.quickCardGradient}
              >
                <View style={[s.quickIcon, { backgroundColor: P.purple + '18' }]}>
                  <Ionicons name="sparkles" size={18} color={P.purple} />
                </View>
                <Text style={[s.quickValue, { color: textPrimary }]}>{metrics.contentCount}</Text>
                <Text style={[s.quickLabel, { color: textMuted }]}>Content</Text>
              </LinearGradient>
            </Pressable>
            <Pressable 
              style={[s.quickCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/(tabs)/calendar')}
            >
              <LinearGradient
                colors={[P.blue + '18', P.blue + '05']}
                style={s.quickCardGradient}
              >
                <View style={[s.quickIcon, { backgroundColor: P.blue + '18' }]}>
                  <Ionicons name="calendar-outline" size={18} color={P.blue} />
                </View>
                <Text style={[s.quickValue, { color: textPrimary }]}>{metrics.queuedCount}</Text>
                <Text style={[s.quickLabel, { color: textMuted }]}>Queued</Text>
              </LinearGradient>
            </Pressable>
            <Pressable 
              style={[s.quickCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/(tabs)/ai-management')}
            >
              <LinearGradient
                colors={[P.mint + '18', P.mint + '05']}
                style={s.quickCardGradient}
              >
                <View style={[s.quickIcon, { backgroundColor: P.mint + '18' }]}>
                  <Ionicons name="checkmark-done" size={18} color={P.mint} />
                </View>
                <Text style={[s.quickValue, { color: textPrimary }]}>{metrics.publishedCount}</Text>
                <Text style={[s.quickLabel, { color: textMuted }]}>Published</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : null}

        {renderActionsPanel()}

        <View style={[s.metaStrip, { 
          backgroundColor: metaConnection.isConnected 
            ? (isDark ? P.mint + '08' : P.mint + '06')
            : (isDark ? P.orange + '08' : P.orange + '06'),
          borderColor: metaConnection.isConnected ? P.mint + '15' : P.orange + '15',
        }]}>
          <View style={[s.metaIcon, { backgroundColor: metaConnection.isConnected ? P.mint + '15' : P.orange + '15' }]}>
            <Ionicons name={metaConnection.isConnected ? "logo-facebook" : "link-outline"} size={14} color={metaConnection.isConnected ? P.mint : P.orange} />
          </View>
          <Text style={[s.metaText, { color: textSecondary }]}>
            {metaConnection.isConnected ? `Meta Connected  ·  ${metaConnection.pageName || 'Active'}` : 'Meta  ·  Not connected'}
          </Text>
          {!metaConnection.isConnected && (
            <Pressable 
              onPress={() => router.push('/(tabs)/settings')}
              style={[s.metaConnectBtn, { backgroundColor: P.orange + '15' }]}
            >
              <Text style={[s.metaConnectText, { color: P.orange }]}>Connect</Text>
            </Pressable>
          )}
        </View>

        {metricsState === 'success' && metrics ? (
          <>
            <Pressable 
              onPress={() => { setShowInsights(!showInsights); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} 
              style={[s.insightsToggle, { 
                backgroundColor: cardBg, 
                borderColor: showInsights ? P.mint + '30' : cardBorder,
              }]}
            >
              <View style={s.insightsToggleLeft}>
                <View style={[s.insightsIcon, { backgroundColor: isDark ? '#0F2518' : '#E8F5E9' }]}>
                  <Feather name="bar-chart-2" size={14} color={P.mint} />
                </View>
                <Text style={[s.insightsToggleText, { color: textSecondary }]}>Advanced Insights</Text>
              </View>
              <Ionicons 
                name={showInsights ? 'chevron-up' : 'chevron-down'} 
                size={16} 
                color={textMuted} 
              />
            </Pressable>

            {showInsights && (
              <View style={s.insightsSection}>
                <View style={s.metricsGrid}>
                  <View style={s.metricsRow}>
                    <MetricCard
                      title="Total Reach"
                      value={formatNumber(metrics.reach)}
                      change={0}
                      icon="eye-outline"
                      isGradient
                    />
                    <MetricCard
                      title="Engagement"
                      value={formatNumber(metrics.engagement)}
                      change={0}
                      icon="heart-outline"
                    />
                  </View>
                </View>
              </View>
            )}
          </>
        ) : null}

        <View style={[s.modeRow, { borderColor: cardBorder }]}>
          <View style={s.modeLeft}>
            <View style={[s.modeIcon, { backgroundColor: isDark ? P.purple + '10' : P.purple + '08' }]}>
              <Ionicons name="options-outline" size={14} color={P.purple} />
            </View>
            <Text style={[s.modeLabel, { color: textSecondary }]}>Advanced Mode</Text>
          </View>
          <Switch
            value={advancedMode}
            onValueChange={(v) => { setAdvancedMode(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            trackColor={{ false: isDark ? '#1A2030' : '#D8DDD9', true: P.mint + '50' }}
            thumbColor={advancedMode ? P.mint : isDark ? '#4A5568' : '#B0B8B2'}
          />
        </View>

        <View style={{ height: Platform.OS === 'web' ? 34 + 60 : 100 }} />
      </ScrollView>

      <BusinessProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 18 },

  manualBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  manualBannerText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingHorizontal: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  brandSub: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 1,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
    marginBottom: 14,
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  heroValue: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  heroGrowth: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  heroGrowthText: {
    fontSize: 16,
    fontWeight: '800',
  },
  heroGrowthLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 2,
  },
  heroDivider: {
    height: 1,
    marginBottom: 16,
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  heroStatIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroStatLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  heroStatDivider: {
    width: 1,
    height: 32,
  },

  autopilotStrip: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  autopilotInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  autopilotDot: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autopilotTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autopilotTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  confBlock: {
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 54,
  },
  confValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  confBar: {
    height: 3,
    borderRadius: 2,
    width: 54,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%' as any,
    borderRadius: 2,
  },

  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  quickCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  quickCardGradient: {
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  quickValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  quickLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  aiCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  aiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  aiCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiCardIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  actionCount: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  actionCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  aiAction: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
  },
  aiActionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  aiActionText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },

  metaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  metaIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  metaConnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
  },
  metaConnectText: {
    fontSize: 11,
    fontWeight: '600',
  },

  insightsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  insightsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  insightsIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightsToggleText: {
    fontSize: 13,
    fontWeight: '500',
  },

  insightsSection: {
    marginBottom: 12,
  },
  metricsGrid: {
    gap: 12,
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },

  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});
