import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
  Switch,
  Animated as RNAnimated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';
import { usePersistedState } from '@/hooks/usePersistedState';
import LeadControlPanel from '@/components/LeadControlPanel';
import StrategicPipeline from '@/components/StrategicPipeline';
import BuildThePlan from '@/components/BuildThePlan';
import CompetitiveIntelligence from '@/components/CompetitiveIntelligence';
import ControlCenter from '@/components/ControlCenter';
import MarketDatabaseAdmin from '@/components/MarketDatabaseAdmin';
import PositioningStrategy from '@/components/PositioningStrategy';
import DifferentiationEngine from '@/components/DifferentiationEngine';
import MechanismEngine from '@/components/MechanismEngine';
import OfferEngine from '@/components/OfferEngine';
import FunnelEngine from '@/components/FunnelEngine';
import IntegrityEngine from '@/components/IntegrityEngine';
import AwarenessEngine from '@/components/AwarenessEngine';
import PersuasionEngine from '@/components/PersuasionEngine';
import StatisticalValidationEngine from '@/components/StatisticalValidationEngine';
import BudgetGovernorEngine from '@/components/BudgetGovernorEngine';
import ChannelSelectionEngine from '@/components/ChannelSelectionEngine';
import IterationEngine from '@/components/IterationEngine';
import RetentionEngine from '@/components/RetentionEngine';
import { CampaignBar, CampaignGuard } from '@/components/CampaignSelector';
import DataFreshnessWarning from '@/components/DataFreshnessWarning';
import AELDebugPanel from '@/components/AELDebugPanel';

interface AIAudience {
  name: string;
  description: string;
  age_min: number;
  age_max: number;
  gender: string;
  locations: string[];
  interests: string[];
  behaviors: string[];
  estimated_size: string;
  placements: string[];
  bid_strategy: string;
  daily_budget_suggestion: string;
  match_score: number;
  reasoning: string;
}

type TabView = 'buildplan' | 'pipeline' | 'intelligence' | 'strategies' | 'positioning' | 'differentiation' | 'mechanism' | 'offers' | 'funnels' | 'integrity' | 'awareness' | 'persuasion' | 'statistical_validation' | 'budget_governor' | 'channel_selection' | 'iteration' | 'retention' | 'control' | 'marketdb' | 'publisher' | 'audience' | 'leads';

interface AIMgmtPersistedState {
  activeTab: TabView;
  audienceGoal: string;
  audienceProduct: string;
  audienceBudget: string;
  generatedAudiences: AIAudience[];
}

const defaultAIMgmtState: AIMgmtPersistedState = {
  activeTab: 'buildplan',
  audienceGoal: '',
  audienceProduct: '',
  audienceBudget: '',
  generatedAudiences: [],
};

function PulseRing({ color }: { color: string }) {
  const scale = useRef(new RNAnimated.Value(1)).current;
  const opacity = useRef(new RNAnimated.Value(0.6)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.parallel([
        RNAnimated.sequence([
          RNAnimated.timing(scale, { toValue: 1.3, duration: 1200, useNativeDriver: true }),
          RNAnimated.timing(scale, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ]),
        RNAnimated.sequence([
          RNAnimated.timing(opacity, { toValue: 1, duration: 1200, useNativeDriver: true }),
          RNAnimated.timing(opacity, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <RNAnimated.View style={[styles.pulseRing, { borderColor: color, opacity, transform: [{ scale }] }]} />
  );
}

export default function AIManagementScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scheduledPosts, updateScheduledPost, metaConnection, brandProfile, campaigns, advancedMode } = useApp();
  const { t } = useLanguage();

  const { selectedCampaignId, isCampaignSelected, dataSourceMode } = useCampaign();
  const { state: ps, updateState, isLoading: psLoading, isSaving, saveError, hydrationVersion } = usePersistedState('ai-management', defaultAIMgmtState);

  const [activeTab, setActiveTab] = useState<TabView>(ps.activeTab);
  const [visitedTabs, setVisitedTabs] = useState<Set<TabView>>(new Set([ps.activeTab]));

  const handleTabChange = useCallback((tab: TabView) => {
    Haptics.selectionAsync();
    setActiveTab(tab);
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    updateState({ activeTab: tab });
  }, [updateState]);

  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<any[]>([]);

  const [showAudienceModal, setShowAudienceModal] = useState(false);
  const [audienceGoal, setAudienceGoal] = useState(ps.audienceGoal);
  const [audienceProduct, setAudienceProduct] = useState(ps.audienceProduct);
  const [audienceBudget, setAudienceBudget] = useState(ps.audienceBudget);
  const [generatingAudience, setGeneratingAudience] = useState(false);
  const [audiences, setAudiences] = useState<AIAudience[]>(ps.generatedAudiences);
  const [audienceError, setAudienceError] = useState('');
  const [expandedAudience, setExpandedAudience] = useState<number | null>(null);

  const [audienceEngineData, setAudienceEngineData] = useState<any>(null);
  const [audienceEngineLoading, setAudienceEngineLoading] = useState(false);
  const [audienceEngineError, setAudienceEngineError] = useState('');
  const [expandedPersona, setExpandedPersona] = useState<number | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('pains');
  const [controlData, setControlData] = useState<any>(null);
  const [nextActions, setNextActions] = useState<{action: string; why: string; risk: string}[]>([]);

  const prevCampaignRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const isSwitch = prevCampaignRef.current !== undefined && prevCampaignRef.current !== selectedCampaignId;
    prevCampaignRef.current = selectedCampaignId;
    if (isSwitch) {
      setSelectedPosts(new Set());
      setPublishing(false);
      setPublishResults([]);
      setShowAudienceModal(false);
      setGeneratingAudience(false);
      setAudienceError('');
      setExpandedAudience(null);
      setAudienceEngineData(null);
      setAudienceEngineError('');
      setExpandedPersona(null);
      setExpandedSection('pains');
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaignId) return;
    const loadLatestAudience = async () => {
      try {
        const baseUrl = getApiUrl();
        const url = new URL(`/api/audience-engine/latest?campaignId=${selectedCampaignId}`, baseUrl);
        const res = await fetch(url.toString());
        if (res.ok) {
          const data = await res.json();
          setAudienceEngineData(data);
        }
      } catch {}
    };
    loadLatestAudience();
  }, [selectedCampaignId]);

  const lastHydrationRef = useRef(0);
  const skipSyncRef = useRef(false);
  useEffect(() => {
    if (hydrationVersion > 0 && hydrationVersion !== lastHydrationRef.current) {
      lastHydrationRef.current = hydrationVersion;
      skipSyncRef.current = true;
      setActiveTab(ps.activeTab);
      setVisitedTabs(prev => {
        if (prev.has(ps.activeTab)) return prev;
        const next = new Set(prev);
        next.add(ps.activeTab);
        return next;
      });
      setAudienceGoal(ps.audienceGoal);
      setAudienceProduct(ps.audienceProduct);
      setAudienceBudget(ps.audienceBudget);
      setAudiences(ps.generatedAudiences);
      setTimeout(() => { skipSyncRef.current = false; }, 100);
    }
  }, [hydrationVersion, ps]);

  const pendingPosts = useMemo(() => {
    return scheduledPosts
      .filter(p => p.status === 'pending')
      .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
  }, [scheduledPosts]);

  const publishedPosts = useMemo(() => {
    return scheduledPosts.filter(p => p.status === 'published').length;
  }, [scheduledPosts]);

  const togglePostSelection = (id: string) => {
    Haptics.selectionAsync();
    setSelectedPosts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPosts = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (selectedPosts.size === pendingPosts.length) {
      setSelectedPosts(new Set());
    } else {
      setSelectedPosts(new Set(pendingPosts.map(p => p.id)));
    }
  };

  const handlePublishSelected = async () => {
    if (selectedPosts.size === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPublishing(true);
    setPublishResults([]);

    try {
      const postsToPublish = pendingPosts.filter(p => selectedPosts.has(p.id));
      const baseUrl = getApiUrl();
      const url = new URL('/api/auto-publish', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posts: postsToPublish.map(p => ({
            id: p.id,
            content: p.content,
            platform: p.platform,
            type: p.type,
          })),
          accessToken: metaConnection.accessToken,
          pageId: metaConnection.pageId,
        }),
      });

      const data = await response.json();
      setPublishResults(data.results || []);

      for (const result of (data.results || [])) {
        if (result.status === 'published') {
          const post = scheduledPosts.find(p => p.id === result.postId);
          if (post) {
            await updateScheduledPost({ ...post, status: 'published' });
          }
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert(t('aiManagement.publishFailed'), t('aiManagement.publishFailedDesc'));
    } finally {
      setPublishing(false);
      setSelectedPosts(new Set());
    }
  };

  const handleRunAudienceEngine = async () => {
    if (!selectedCampaignId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setAudienceEngineLoading(true);
    setAudienceEngineError('');

    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/audience-engine/analyze', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(err.error || 'Analysis failed');
      }

      const data = await response.json();
      setAudienceEngineData(data);
    } catch (err: any) {
      setAudienceEngineError(err.message || 'Audience analysis failed');
    } finally {
      setAudienceEngineLoading(false);
    }
  };

  const handleGenerateAudience = async () => {
    if (!audienceGoal.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setGeneratingAudience(true);
    setAudienceError('');
    setAudiences([]);

    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/generate-audience', baseUrl);
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignGoal: audienceGoal,
          product: audienceProduct,
          budget: audienceBudget,
          brandName: brandProfile.name,
          industry: brandProfile.industry,
          targetAudience: brandProfile.targetAudience,
        }),
      });

      if (!response.ok) throw new Error('Failed');

      const data = await response.json();
      if (data.audiences && Array.isArray(data.audiences)) {
        setAudiences(data.audiences);
        updateState({ generatedAudiences: data.audiences });
      } else {
        throw new Error('Invalid response');
      }
    } catch {
      setAudienceError(t('aiManagement.audienceFailed'));
    } finally {
      setGeneratingAudience(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  };

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'reel': return 'videocam';
      case 'story': return 'layers';
      case 'video': return 'play-circle';
      default: return 'document-text';
    }
  };

  useEffect(() => {
    const loadControlData = async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await fetch(new URL('/api/strategy/dashboard', baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          setControlData(data);
          const actions: {action: string; why: string; risk: string}[] = [];
          if (data.recentDecisions?.length > 0) {
            data.recentDecisions.slice(0, 3).forEach((d: any) => {
              actions.push({
                action: d.description || d.action || 'Optimizing performance',
                why: d.reasoning || 'Based on recent performance data',
                risk: d.priority === 'high' ? 'Medium' : 'Low',
              });
            });
          }
          if (actions.length === 0) {
            actions.push({ action: 'Analyze audience engagement patterns', why: 'Identify winning segments to scale', risk: 'Low' });
            actions.push({ action: 'Optimize ad creative rotation', why: 'Prevent creative fatigue', risk: 'Low' });
            actions.push({ action: 'Adjust bid strategy for top performers', why: 'Maximize ROAS on winning ads', risk: 'Medium' });
          }
          setNextActions(actions);
        }
      } catch {}
    };
    loadControlData();
  }, []);

  const strategyBranches: { key: TabView; icon: keyof typeof Ionicons.glyphMap; label: string; color: string; description: string }[] = [
    { key: 'positioning', icon: 'compass-outline', label: 'Positioning', color: '#10B981', description: 'Strategic territory discovery and narrative positioning' },
    { key: 'differentiation', icon: 'layers-outline', label: 'Differentiation', color: '#8B5CF6', description: '12-layer proof-backed differentiation analysis' },
    { key: 'mechanism', icon: 'construct-outline', label: 'Mechanism Engine', color: '#D946EF', description: 'Axis-aligned mechanism generation from positioning and differentiation' },
    { key: 'offers', icon: 'pricetag-outline', label: 'Offer Engine', color: '#F97316', description: '5-layer structured offer construction' },
    { key: 'awareness', icon: 'eye-outline', label: 'Awareness Engine', color: '#F97316', description: '8-layer awareness architecture — entry routes, readiness mapping, and trigger classes' },
    { key: 'funnels', icon: 'funnel-outline', label: 'Funnel Engine', color: '#14B8A6', description: '8-layer funnel decision with trust path and proof placement' },
    { key: 'integrity', icon: 'shield-checkmark-outline', label: 'Integrity Engine', color: '#6366F1', description: 'Final validation gate — 8-layer strategic consistency check before execution' },
    { key: 'persuasion', icon: 'megaphone-outline', label: 'Persuasion Engine', color: '#EC4899', description: '8-layer persuasion logic — influence drivers, objection mapping, and trust sequencing' },
    { key: 'statistical_validation', icon: 'stats-chart-outline', label: 'Statistical Validation', color: '#06B6D4', description: 'Evidence density evaluation — validates claims against real MI signals' },
    { key: 'budget_governor', icon: 'wallet-outline', label: 'Budget Governor', color: '#F59E0B', description: 'Multi-factor risk scoring — test/scale/hold/halt budget decisions' },
    { key: 'channel_selection', icon: 'git-branch-outline', label: 'Channel Selection', color: '#3B82F6', description: '16-channel scoring across 8 layers — audience density and mode compatibility' },
    { key: 'iteration', icon: 'repeat-outline', label: 'Iteration Engine', color: '#F43F5E', description: 'Optimization opportunities — test hypotheses and controlled experimentation' },
    { key: 'retention', icon: 'heart-outline', label: 'Retention Engine', color: '#059669', description: 'Retention leverage points — churn risks, LTV expansion, and upsell triggers' },
  ];

  const renderStrategiesBranch = () => (
    <View style={styles.tabContent}>
      <LinearGradient colors={['#F97316', '#FB923C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="map" size={20} color="#fff" />
          <Text style={{ fontSize: 16, fontWeight: '700' as const, color: '#fff' }}>Strategies</Text>
        </View>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 6, lineHeight: 16 }}>
          Strategic engines for positioning, differentiation, and offer construction. Each engine builds on the outputs of the previous stage.
        </Text>
      </LinearGradient>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.cardBorder }} />
        <Text style={{ fontSize: 11, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 1 }}>PIPELINE FLOW</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.cardBorder }} />
      </View>

      {strategyBranches.map((branch, index) => (
        <React.Fragment key={branch.key}>
          {index > 0 && (
            <View style={{ alignItems: 'center', marginVertical: 4 }}>
              <Ionicons name="arrow-down" size={16} color={colors.textMuted} />
            </View>
          )}
          <Pressable
            onPress={() => handleTabChange(branch.key)}
            style={[{
              backgroundColor: colors.card,
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
            }]}
          >
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: branch.color + '15', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name={branch.icon} size={20} color={branch.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600' as const, color: colors.text, marginBottom: 2 }}>{branch.label}</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{branch.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );

  const renderIntelligence = () => (
    <View style={styles.tabContent}>
      <CompetitiveIntelligence />
    </View>
  );

  const renderControlCenter = () => (
    <View style={styles.tabContent}>
      <ControlCenter />
    </View>
  );

  const renderPublisher = () => (
    <View style={styles.tabContent}>
      <View style={[styles.connectionBanner, {
        backgroundColor: metaConnection.isConnected ? colors.success + '15' : colors.accent + '15',
        borderColor: metaConnection.isConnected ? colors.success + '30' : colors.accent + '30',
      }]}>
        <View style={styles.connectionLeft}>
          <View style={styles.connectionDotWrap}>
            <View style={[styles.connectionDot, {
              backgroundColor: metaConnection.isConnected ? colors.success : colors.accent,
            }]} />
            {metaConnection.isConnected && <PulseRing color={colors.success} />}
          </View>
          <View>
            <Text style={[styles.connectionTitle, { color: colors.text }]}>
              {metaConnection.isConnected
                ? t('aiManagement.metaConnected')
                : t('aiManagement.metaNotConnected')
              }
            </Text>
            <Text style={[styles.connectionSub, { color: colors.textSecondary }]}>
              {metaConnection.isConnected
                ? metaConnection.pageName || 'Facebook & Instagram'
                : t('aiManagement.connectInSettings')
              }
            </Text>
          </View>
        </View>
        {!metaConnection.isConnected && (
          <View style={[styles.statusBadge, { backgroundColor: colors.textMuted }]}>
            <Text style={styles.statusBadgeText}>Not Connected</Text>
          </View>
        )}
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="time-outline" size={20} color={colors.accent} />
          <Text style={[styles.statNum, { color: colors.text }]}>{pendingPosts.length}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('aiManagement.queued')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.success} />
          <Text style={[styles.statNum, { color: colors.text }]}>{publishedPosts}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('aiManagement.published')}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="flash-outline" size={20} color={colors.primary} />
          <Text style={[styles.statNum, { color: colors.text }]}>{autoPublishEnabled ? 'ON' : 'OFF'}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('aiManagement.autoMode')}</Text>
        </View>
      </View>

      <View style={[styles.autoPublishRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.autoPublishLeft}>
          <Ionicons name="flash" size={22} color={colors.primary} />
          <View>
            <Text style={[styles.autoPublishTitle, { color: colors.text }]}>
              {t('aiManagement.autoPublish')}
            </Text>
            <Text style={[styles.autoPublishDesc, { color: colors.textSecondary }]}>
              {t('aiManagement.autoPublishDesc')}
            </Text>
          </View>
        </View>
        <Switch
          value={autoPublishEnabled}
          onValueChange={(val) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setAutoPublishEnabled(val);
          }}
          trackColor={{ false: colors.inputBackground, true: colors.primary + '60' }}
          thumbColor={autoPublishEnabled ? colors.primary : colors.textMuted}
        />
      </View>

      {pendingPosts.length > 0 && (
        <View style={styles.queueSection}>
          <View style={styles.queueHeader}>
            <Text style={[styles.queueTitle, { color: colors.text }]}>
              {t('aiManagement.publishQueue')}
            </Text>
            <Pressable onPress={selectAllPosts}>
              <Text style={[styles.selectAllText, { color: colors.primary }]}>
                {selectedPosts.size === pendingPosts.length
                  ? t('aiManagement.deselectAll')
                  : t('aiManagement.selectAll')
                }
              </Text>
            </Pressable>
          </View>

          {pendingPosts.map(post => (
            <Pressable
              key={post.id}
              onPress={() => togglePostSelection(post.id)}
              style={[styles.queueCard, {
                backgroundColor: colors.card,
                borderColor: selectedPosts.has(post.id) ? colors.primary : colors.cardBorder,
              }]}
            >
              <View style={[styles.queueCheck, {
                backgroundColor: selectedPosts.has(post.id) ? colors.primary : 'transparent',
                borderColor: selectedPosts.has(post.id) ? colors.primary : colors.textMuted,
              }]}>
                {selectedPosts.has(post.id) && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <View style={styles.queueInfo}>
                <View style={styles.queueMetaRow}>
                  <Ionicons name={getTypeIcon(post.type)} size={14} color={colors.textMuted} />
                  <Text style={[styles.queueType, { color: colors.textSecondary }]}>
                    {post.type.charAt(0).toUpperCase() + post.type.slice(1)}
                  </Text>
                  <Text style={[styles.queueDate, { color: colors.textMuted }]}>
                    {formatDate(post.scheduledDate)} {post.scheduledTime}
                  </Text>
                </View>
                <Text style={[styles.queueContent, { color: colors.text }]} numberOfLines={2}>
                  {post.content}
                </Text>
                <View style={[styles.queuePlatformBadge, { backgroundColor: colors.primary + '15' }]}>
                  <Text style={[styles.queuePlatformText, { color: colors.primary }]}>{post.platform}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {pendingPosts.length === 0 && (
        <View style={[styles.emptyQueue, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyQueueTitle, { color: colors.text }]}>
            {t('aiManagement.noPostsQueued')}
          </Text>
          <Text style={[styles.emptyQueueDesc, { color: colors.textSecondary }]}>
            {t('aiManagement.noPostsQueuedDesc')}
          </Text>
        </View>
      )}

      {selectedPosts.size > 0 && (
        <View style={styles.publishBarWrap}>
          <Pressable
            onPress={handlePublishSelected}
            disabled={publishing}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
          >
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.publishBar}
            >
              {publishing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
              <Text style={styles.publishBarText}>
                {publishing
                  ? t('aiManagement.publishing')
                  : `${t('aiManagement.publishNow')} (${selectedPosts.size})`
                }
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );

  const renderAudienceSection = (title: string, icon: keyof typeof Ionicons.glyphMap, sectionKey: string, children: React.ReactNode) => (
    <View style={[styles.aeSection, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Pressable
        onPress={() => setExpandedSection(expandedSection === sectionKey ? null : sectionKey)}
        style={styles.aeSectionHeader}
      >
        <View style={styles.aeSectionLeft}>
          <View style={[styles.aeSectionIcon, { backgroundColor: colors.primary + '15' }]}>
            <Ionicons name={icon} size={16} color={colors.primary} />
          </View>
          <Text style={[styles.aeSectionTitle, { color: colors.text }]}>{title}</Text>
        </View>
        <Ionicons
          name={expandedSection === sectionKey ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>
      {expandedSection === sectionKey && (
        <View style={styles.aeSectionBody}>{children}</View>
      )}
    </View>
  );

  const renderSignalItems = (items: any[], colorKey: string) => {
    if (!items || items.length === 0) {
      return <Text style={[styles.aeEmptyText, { color: colors.textMuted }]}>No signals detected — more data needed</Text>;
    }
    const tagColor = colorKey === 'error' ? colors.error : colorKey === 'success' ? colors.success : colorKey === 'accent' ? colors.accent : colors.primary;
    return items.map((item: any, i: number) => (
      <View key={i} style={[styles.aePainRow, { borderColor: colors.divider }]}>
        <View style={styles.aePainHeader}>
          <Text style={[styles.aePainCategory, { color: colors.text }]}>{item.canonical}</Text>
          <View style={[styles.aePainBadge, { backgroundColor: tagColor + '15' }]}>
            <Text style={[styles.aePainFreq, { color: tagColor }]}>{item.frequency}x</Text>
          </View>
        </View>
        {item.confidenceScore != null && (
          <View style={[styles.aeConfidenceRow]}>
            <View style={[styles.aeIntentTrack, { backgroundColor: colors.divider, flex: 1 }]}>
              <View style={[styles.aeIntentFill, { width: `${Math.round(item.confidenceScore * 100)}%`, backgroundColor: tagColor }]} />
            </View>
            <Text style={[styles.aeConfidenceText, { color: colors.textMuted }]}>{Math.round(item.confidenceScore * 100)}%</Text>
          </View>
        )}
        {item.evidence && item.evidence.length > 0 && (
          <Text style={[styles.aePainEvidence, { color: colors.textSecondary }]} numberOfLines={2}>
            &quot;{item.evidence[0]}&quot;
          </Text>
        )}
      </View>
    ));
  };

  const renderIntentBars = (data: any) => {
    if (!data) return null;
    const intentKeys = ['curiosity', 'learning', 'comparison', 'purchaseIntent'];
    const intentColors: Record<string, string> = {
      curiosity: colors.accent,
      learning: colors.primary,
      comparison: '#F59E0B',
      purchaseIntent: colors.success,
    };
    return intentKeys.filter(k => data[k] != null).map(key => {
      const pct = typeof data[key] === 'number' ? data[key] : 0;
      const label = key.replace(/([A-Z])/g, ' $1').replace(/\b\w/g, c => c.toUpperCase()).trim();
      return (
        <View key={key} style={styles.aeIntentRow}>
          <View style={styles.aeIntentLabel}>
            <Text style={[styles.aeIntentText, { color: colors.text }]}>{label}</Text>
            <Text style={[styles.aeIntentPct, { color: colors.textMuted }]}>{pct}%</Text>
          </View>
          <View style={[styles.aeIntentTrack, { backgroundColor: colors.divider }]}>
            <View style={[styles.aeIntentFill, { width: `${pct}%`, backgroundColor: intentColors[key] || colors.primary }]} />
          </View>
        </View>
      );
    });
  };

  const renderAudienceManager = () => {
    const ae = audienceEngineData;
    const hasCachedData = !!ae;

    return (
      <View style={styles.tabContent}>
        <Pressable onPress={handleRunAudienceEngine} disabled={audienceEngineLoading}>
          <LinearGradient
            colors={audienceEngineLoading ? [colors.textMuted, colors.textMuted] : [colors.accent, '#0EA5E9']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.audienceCTA, { flexDirection: 'row', alignItems: 'center', padding: 16 }]}
          >
            <View style={styles.audienceCTAIcon}>
              {audienceEngineLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="analytics" size={24} color="#fff" />
              )}
            </View>
            <View style={styles.audienceCTAText}>
              <Text style={styles.audienceCTATitle}>
                {audienceEngineLoading ? 'Analyzing...' : hasCachedData ? 'Re-Analyze Audience' : 'Analyze Audience'}
              </Text>
              <Text style={styles.audienceCTADesc}>
                {audienceEngineLoading ? 'Processing 12 intelligence layers (3-10s)' : 'V3 — 12-layer audience intelligence engine'}
              </Text>
            </View>
            {!audienceEngineLoading && (
              <Ionicons name="arrow-forward" size={20} color="rgba(255,255,255,0.7)" />
            )}
          </LinearGradient>
        </Pressable>

        {audienceEngineError ? (
          <View style={[styles.errorBox, { backgroundColor: colors.error + '15' }]}>
            <Ionicons name="alert-circle" size={16} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{audienceEngineError}</Text>
          </View>
        ) : null}

        {hasCachedData && (
          <DataFreshnessWarning
            freshnessMetadata={ae.freshnessMetadata}
            onRefresh={handleRunAudienceEngine}
          />
        )}

        {hasCachedData && ae.status === 'DATASET_TOO_SMALL' && (
          <View style={[styles.aeStatusBanner, { backgroundColor: '#F59E0B' + '18', borderColor: '#F59E0B' + '40' }]}>
            <Ionicons name="warning-outline" size={20} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.aeStatusTitle, { color: '#F59E0B' }]}>Dataset Too Small</Text>
              <Text style={[styles.aeStatusDesc, { color: colors.textSecondary }]}>
                {ae.statusMessage || 'Need more competitors, posts, and comments for reliable analysis.'}
              </Text>
            </View>
          </View>
        )}

        {hasCachedData && ae.status === 'INSUFFICIENT_SIGNALS' && (
          <View style={[styles.aeStatusBanner, { backgroundColor: colors.error + '12', borderColor: colors.error + '30' }]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.aeStatusTitle, { color: colors.error }]}>Insufficient Signals</Text>
              <Text style={[styles.aeStatusDesc, { color: colors.textSecondary }]}>
                {ae.statusMessage || 'Not enough signal matches for AI-powered audience segmentation.'}
              </Text>
            </View>
          </View>
        )}

        {hasCachedData && ae.defensiveMode && ae.status !== 'DATASET_TOO_SMALL' && (
          <View style={[styles.aeStatusBanner, { backgroundColor: colors.accent + '12', borderColor: colors.accent + '30' }]}>
            <Ionicons name="shield-outline" size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.aeStatusTitle, { color: colors.accent }]}>Defensive Mode</Text>
              <Text style={[styles.aeStatusDesc, { color: colors.textSecondary }]}>
                Low signal environment detected. Audience intelligence limited. More market data required.
              </Text>
            </View>
          </View>
        )}

        {hasCachedData && ae.inputSummary && (
          <View style={[styles.aeInputSummary, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.aeInputSummaryRow}>
              <View style={styles.aeInputStat}>
                <Text style={[styles.aeInputStatNum, { color: colors.primary }]}>{ae.inputSummary.competitorsAnalyzed}</Text>
                <Text style={[styles.aeInputStatLabel, { color: colors.textMuted }]}>Competitors</Text>
              </View>
              <View style={styles.aeInputStat}>
                <Text style={[styles.aeInputStatNum, { color: colors.primary }]}>{ae.inputSummary.postsAnalyzed}</Text>
                <Text style={[styles.aeInputStatLabel, { color: colors.textMuted }]}>Posts</Text>
              </View>
              <View style={styles.aeInputStat}>
                <Text style={[styles.aeInputStatNum, { color: colors.primary }]}>{ae.inputSummary.commentsAnalyzed}</Text>
                <Text style={[styles.aeInputStatLabel, { color: colors.textMuted }]}>Comments</Text>
              </View>
            </View>
            {ae.executionTimeMs && (
              <Text style={[styles.aeTimestamp, { color: colors.textMuted }]}>
                V3 • {(ae.executionTimeMs / 1000).toFixed(1)}s
                {ae.inputSummary?.sanitizedCount > 0 ? ` • ${ae.inputSummary.sanitizedCount} synthetic filtered` : ''}
                {ae.createdAt ? ` • ${new Date(ae.createdAt).toLocaleDateString()}` : ''}
              </Text>
            )}
          </View>
        )}

        {hasCachedData && (
          <>
            {renderAudienceSection('Language Signals', 'chatbubbles-outline', 'language', (
              <>
                {ae.languageSignals && (
                  <View>
                    {[
                      { label: 'Problem Expressions', count: ae.languageSignals.problemExpressions?.count || 0, color: colors.error },
                      { label: 'Question Patterns', count: ae.languageSignals.questionPatterns?.count || 0, color: colors.accent },
                      { label: 'Goal Expressions', count: ae.languageSignals.goalExpressions?.count || 0, color: colors.success },
                    ].map((item, i) => (
                      <View key={i} style={[styles.aePainRow, { borderColor: colors.divider }]}>
                        <View style={styles.aePainHeader}>
                          <Text style={[styles.aePainCategory, { color: colors.text }]}>{item.label}</Text>
                          <View style={[styles.aePainBadge, { backgroundColor: item.color + '15' }]}>
                            <Text style={[styles.aePainFreq, { color: item.color }]}>{item.count}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                    <Text style={[styles.aeConfidenceText, { color: colors.textMuted, marginTop: 6 }]}>
                      {ae.languageSignals.totalAnalyzed || 0} texts analyzed
                    </Text>
                  </View>
                )}
              </>
            ))}

            {renderAudienceSection('Pain Map', 'medkit-outline', 'pains', (
              <>{renderSignalItems(ae.painMap || ae.audiencePains || [], 'error')}</>
            ))}

            {renderAudienceSection('Desire Map', 'heart-outline', 'desires', (
              <>{renderSignalItems(ae.desireMap || [], 'success')}</>
            ))}

            {renderAudienceSection('Objection Map', 'hand-left-outline', 'objections', (
              <>{renderSignalItems(ae.objectionMap || [], 'accent')}</>
            ))}

            {renderAudienceSection('Transformation Map', 'swap-horizontal-outline', 'transformation', (
              <>{renderSignalItems(ae.transformationMap || [], 'primary')}</>
            ))}

            {renderAudienceSection('Emotional Drivers', 'flame-outline', 'emotions', (
              <>{renderSignalItems(ae.emotionalDrivers || [], 'error')}</>
            ))}

            {renderAudienceSection('Audience Segments', 'people-outline', 'segments', (
              <>
                {(ae.audienceSegments || []).length === 0 ? (
                  <Text style={[styles.aeEmptyText, { color: colors.textMuted }]}>No segments generated</Text>
                ) : (
                  (ae.audienceSegments || []).map((seg: any, i: number) => (
                    <Pressable
                      key={i}
                      onPress={() => setExpandedPersona(expandedPersona === i ? null : i)}
                      style={[styles.aePersonaCard, { borderColor: colors.divider }]}
                    >
                      <View style={styles.aePersonaHeader}>
                        <View style={[styles.aePersonaIcon, { backgroundColor: colors.accent + '15' }]}>
                          <Ionicons name="people" size={16} color={colors.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.aePersonaName, { color: colors.text }]}>{seg.name}</Text>
                          {seg.estimatedPercentage != null && (
                            <Text style={[styles.aePersonaPct, { color: colors.textMuted }]}>{seg.estimatedPercentage}% of audience</Text>
                          )}
                        </View>
                        <Ionicons name={expandedPersona === i ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                      </View>
                      {expandedPersona === i && (
                        <View style={styles.aePersonaBody}>
                          {seg.description && (
                            <Text style={[styles.aePersonaFieldValue, { color: colors.textSecondary, marginBottom: 8 }]}>{seg.description}</Text>
                          )}
                          {seg.painProfile && seg.painProfile.length > 0 && (
                            <View style={styles.aePersonaField}>
                              <Text style={[styles.aePersonaFieldLabel, { color: colors.textMuted }]}>Pain Profile</Text>
                              <View style={styles.audienceTags}>
                                {seg.painProfile.map((p: string, j: number) => (
                                  <View key={j} style={[styles.audienceTag, { backgroundColor: colors.error + '12' }]}>
                                    <Text style={[styles.audienceTagText, { color: colors.error }]}>{p}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                          {seg.desireProfile && seg.desireProfile.length > 0 && (
                            <View style={styles.aePersonaField}>
                              <Text style={[styles.aePersonaFieldLabel, { color: colors.textMuted }]}>Desire Profile</Text>
                              <View style={styles.audienceTags}>
                                {seg.desireProfile.map((d: string, j: number) => (
                                  <View key={j} style={[styles.audienceTag, { backgroundColor: colors.success + '12' }]}>
                                    <Text style={[styles.audienceTagText, { color: colors.success }]}>{d}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                          {seg.objectionProfile && seg.objectionProfile.length > 0 && (
                            <View style={styles.aePersonaField}>
                              <Text style={[styles.aePersonaFieldLabel, { color: colors.textMuted }]}>Objection Profile</Text>
                              <View style={styles.audienceTags}>
                                {seg.objectionProfile.map((o: string, j: number) => (
                                  <View key={j} style={[styles.audienceTag, { backgroundColor: colors.accent + '12' }]}>
                                    <Text style={[styles.audienceTagText, { color: colors.accent }]}>{o}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                          {seg.motivationProfile && seg.motivationProfile.length > 0 && (
                            <View style={styles.aePersonaField}>
                              <Text style={[styles.aePersonaFieldLabel, { color: colors.textMuted }]}>Motivation</Text>
                              <View style={styles.audienceTags}>
                                {seg.motivationProfile.map((m: string, j: number) => (
                                  <View key={j} style={[styles.audienceTag, { backgroundColor: colors.primary + '12' }]}>
                                    <Text style={[styles.audienceTagText, { color: colors.primary }]}>{m}</Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                          {seg.confidenceScore != null && (
                            <Text style={[styles.aeConfidenceText, { color: colors.textMuted, marginTop: 4 }]}>
                              Confidence: {Math.round(seg.confidenceScore * 100)}% • Evidence: {seg.evidenceCount || 0} signals
                            </Text>
                          )}
                        </View>
                      )}
                    </Pressable>
                  ))
                )}
              </>
            ))}

            {renderAudienceSection('Segment Density', 'bar-chart-outline', 'density', (
              <>
                {(ae.segmentDensity || []).length === 0 ? (
                  <Text style={[styles.aeEmptyText, { color: colors.textMuted }]}>No density data</Text>
                ) : (
                  (ae.segmentDensity || []).map((item: any, i: number) => (
                    <View key={i} style={styles.aeIntentRow}>
                      <View style={styles.aeIntentLabel}>
                        <Text style={[styles.aeIntentText, { color: colors.text }]} numberOfLines={1}>{item.segment}</Text>
                        <Text style={[styles.aeIntentPct, { color: colors.textMuted }]}>{item.densityScore}%</Text>
                      </View>
                      <View style={[styles.aeIntentTrack, { backgroundColor: colors.divider }]}>
                        <View style={[styles.aeIntentFill, { width: `${item.densityScore}%`, backgroundColor: colors.accent }]} />
                      </View>
                    </View>
                  ))
                )}
              </>
            ))}

            {renderAudienceSection('Awareness Level', 'eye-outline', 'awareness', (
              <>
                {ae.awarenessLevel && (
                  <View>
                    <View style={styles.aeSophRow}>
                      <Text style={[styles.aeSophLabel, { color: colors.text }]}>Dominant Level</Text>
                      <View style={[styles.aeSophBadge, { backgroundColor: colors.accent + '20' }]}>
                        <Text style={[styles.aeSophValue, { color: colors.accent }]}>
                          {(ae.awarenessLevel.level || '').replace(/_/g, ' ').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    {ae.awarenessLevel.distribution && Object.entries(ae.awarenessLevel.distribution).map(([key, val]: [string, any]) => {
                      const pct = typeof val === 'number' ? val : 0;
                      return (
                        <View key={key} style={styles.aeIntentRow}>
                          <View style={styles.aeIntentLabel}>
                            <Text style={[styles.aeIntentText, { color: colors.text }]}>{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</Text>
                            <Text style={[styles.aeIntentPct, { color: colors.textMuted }]}>{pct}%</Text>
                          </View>
                          <View style={[styles.aeIntentTrack, { backgroundColor: colors.divider }]}>
                            <View style={[styles.aeIntentFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            ))}

            {renderAudienceSection('Maturity Index', 'school-outline', 'maturity', (
              <>
                {ae.maturityIndex && (
                  <View>
                    <View style={styles.aeSophRow}>
                      <Text style={[styles.aeSophLabel, { color: colors.text }]}>Market Maturity</Text>
                      <View style={[styles.aeSophBadge, {
                        backgroundColor: ae.maturityIndex.level === 'mature' ? colors.success + '20'
                          : ae.maturityIndex.level === 'developing' ? colors.accent + '20' : colors.warning + '20',
                      }]}>
                        <Text style={[styles.aeSophValue, {
                          color: ae.maturityIndex.level === 'mature' ? colors.success
                            : ae.maturityIndex.level === 'developing' ? colors.accent : colors.warning,
                        }]}>
                          {(ae.maturityIndex.level || 'unknown').toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    {ae.maturityIndex.indicators && ae.maturityIndex.indicators.length > 0 && (
                      <View style={styles.aeSophIndicators}>
                        {ae.maturityIndex.indicators.slice(0, 5).map((ind: string, i: number) => (
                          <View key={i} style={[styles.audienceTag, { backgroundColor: colors.primary + '12' }]}>
                            <Text style={[styles.audienceTagText, { color: colors.primary }]}>{ind}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    <Text style={[styles.aeConfidenceText, { color: colors.textMuted, marginTop: 6 }]}>
                      Confidence: {Math.round((ae.maturityIndex.confidenceScore || 0) * 100)}% • Evidence: {ae.maturityIndex.evidenceCount || 0}
                    </Text>
                  </View>
                )}
              </>
            ))}

            {renderAudienceSection('Buying Intent', 'cart-outline', 'intents', (
              <View>{renderIntentBars(ae.intentDistribution || ae.audienceIntentDistribution)}</View>
            ))}

            {renderAudienceSection('Ads Targeting', 'megaphone-outline', 'ads', (
              <>
                {(ae.adsTargetingHints || []).length === 0 ? (
                  <Text style={[styles.aeEmptyText, { color: colors.textMuted }]}>No targeting hints generated</Text>
                ) : (
                  (ae.adsTargetingHints || []).map((hint: any, i: number) => (
                    <View key={i} style={[styles.aeAdsCard, { borderColor: colors.divider }]}>
                      {hint.suggestedInterests && hint.suggestedInterests.length > 0 && (
                        <View style={styles.aeAdsField}>
                          <Text style={[styles.aeAdsFieldLabel, { color: colors.textMuted }]}>Interests</Text>
                          <View style={styles.audienceTags}>
                            {hint.suggestedInterests.slice(0, 8).map((interest: string, j: number) => (
                              <View key={j} style={[styles.audienceTag, { backgroundColor: colors.primary + '12' }]}>
                                <Text style={[styles.audienceTagText, { color: colors.primary }]}>{interest}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                      {hint.suggestedBehaviors && hint.suggestedBehaviors.length > 0 && (
                        <View style={styles.aeAdsField}>
                          <Text style={[styles.aeAdsFieldLabel, { color: colors.textMuted }]}>Behaviors</Text>
                          <View style={styles.audienceTags}>
                            {hint.suggestedBehaviors.slice(0, 6).map((b: string, j: number) => (
                              <View key={j} style={[styles.audienceTag, { backgroundColor: colors.accent + '12' }]}>
                                <Text style={[styles.audienceTagText, { color: colors.accent }]}>{b}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                      {hint.suggestedAgeRange && (
                        <View style={styles.aeAdsInline}>
                          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.aeAdsInlineText, { color: colors.text }]}>
                            Age {hint.suggestedAgeRange.min}-{hint.suggestedAgeRange.max} • {hint.suggestedGender || 'all'}
                          </Text>
                        </View>
                      )}
                      {hint.rationale && (
                        <Text style={[styles.aeAdsRationale, { color: colors.textSecondary }]}>{hint.rationale}</Text>
                      )}
                    </View>
                  ))
                )}
              </>
            ))}
          </>
        )}

        {!hasCachedData && !audienceEngineLoading && (
          <View style={styles.audienceInfoSection}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>12-Layer Audience Intelligence</Text>
            {[
              { icon: 'chatbubbles-outline' as const, title: 'Language Analysis', desc: 'Detects problem, question, and goal expressions' },
              { icon: 'medkit-outline' as const, title: 'Pain Intelligence', desc: 'Extracts recurring pain clusters with evidence' },
              { icon: 'heart-outline' as const, title: 'Desire Intelligence', desc: 'Identifies transformation desires from audience' },
              { icon: 'hand-left-outline' as const, title: 'Objection Intelligence', desc: 'Detects purchase barriers and resistance' },
              { icon: 'swap-horizontal-outline' as const, title: 'Transformation Map', desc: 'Maps before/after transformation states' },
              { icon: 'flame-outline' as const, title: 'Emotional Drivers', desc: 'Extracts emotional motivations from language' },
              { icon: 'people-outline' as const, title: 'Audience Segments', desc: 'Builds structured audience segments' },
              { icon: 'bar-chart-outline' as const, title: 'Segment Density', desc: 'Estimates segment dominance in market' },
              { icon: 'eye-outline' as const, title: 'Awareness Level', desc: 'Classifies audience awareness stage' },
              { icon: 'school-outline' as const, title: 'Maturity Index', desc: 'Determines market sophistication level' },
              { icon: 'cart-outline' as const, title: 'Buying Intent', desc: 'Classifies engagement into intent levels' },
              { icon: 'megaphone-outline' as const, title: 'Ads Targeting', desc: 'Translates insights into targeting suggestions' },
            ].map((step, i) => (
              <View key={i} style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={[styles.stepNum, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name={step.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.stepInfo}>
                  <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                  <Text style={[styles.stepDesc, { color: colors.textSecondary }]}>{step.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowAudienceModal(true);
            setAudienceGoal('');
            setAudienceProduct('');
            setAudienceBudget('');
            setAudiences([]);
            setAudienceError('');
            setExpandedAudience(null);
          }}
          style={[styles.aeSecondaryBtn, { borderColor: colors.cardBorder }]}
        >
          <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.aeSecondaryBtnText, { color: colors.textSecondary }]}>Manual Audience Builder</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>AI Control Center</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Your AI agency at work
            </Text>
          </View>
          {isSaving && (
            <View style={styles.saveIndicator}>
              <ActivityIndicator size="small" color={colors.textMuted} />
            </View>
          )}
          {saveError && !isSaving && (
            <View style={styles.saveIndicator}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
            </View>
          )}
        </View>

        <CampaignBar />

        {isCampaignSelected && (
          <View style={[styles.dataSourceBadge, { backgroundColor: dataSourceMode === 'campaign_metrics' ? '#8B5CF620' : '#3B82F620', borderColor: dataSourceMode === 'campaign_metrics' ? '#8B5CF640' : '#3B82F640' }]}>
            <Ionicons
              name={dataSourceMode === 'campaign_metrics' ? 'analytics-outline' : 'bar-chart-outline'}
              size={12}
              color={dataSourceMode === 'campaign_metrics' ? '#8B5CF6' : '#3B82F6'}
            />
            <Text style={[styles.dataSourceBadgeText, { color: dataSourceMode === 'campaign_metrics' ? '#8B5CF6' : '#3B82F6' }]}>
              {dataSourceMode === 'campaign_metrics' ? 'Campaign Metrics Mode' : 'Market Benchmark Mode'}
            </Text>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabBar, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          contentContainerStyle={styles.tabBarContent}
        >
          {([
            { key: 'buildplan' as TabView, icon: 'construct-outline' as const, label: 'Build Plan', color: '#EC4899', advanced: false },
            { key: 'pipeline' as TabView, icon: 'git-merge-outline' as const, label: 'Pipeline', color: '#8B5CF6', advanced: false },
            { key: 'intelligence' as TabView, icon: 'telescope-outline' as const, label: 'Intelligence', color: '#3B82F6', advanced: false },
            { key: 'strategies' as TabView, icon: 'map-outline' as const, label: 'Strategies', color: '#F97316', advanced: false },
            { key: 'control' as TabView, icon: 'shield-checkmark-outline' as const, label: 'Control', color: '#8B5CF6', advanced: false },
            { key: 'marketdb' as TabView, icon: 'server-outline' as const, label: 'Market DB', color: '#F97316', advanced: true },
            { key: 'publisher' as TabView, icon: 'send-outline' as const, label: 'Publish', color: colors.primary, advanced: false },
            { key: 'audience' as TabView, icon: 'people-outline' as const, label: 'Audience', color: colors.primary, advanced: true },
            { key: 'leads' as TabView, icon: 'magnet-outline' as const, label: 'Leads', color: '#8B5CF6', advanced: true },
          ] as const)
            .filter(t => !t.advanced || advancedMode)
            .map(t => {
              const isActive = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => handleTabChange(t.key)}
                  style={[styles.tab, isActive && { backgroundColor: t.color + '14', borderColor: t.color + '30' }]}
                >
                  <Ionicons name={t.icon} size={14} color={isActive ? t.color : colors.textMuted} />
                  <Text style={[styles.tabText, { color: isActive ? t.color : colors.textMuted }]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
        </ScrollView>

        {activeTab === 'buildplan' && <BuildThePlan onNavigateToCI={() => handleTabChange('intelligence')} onNavigateToCalendar={() => router.push('/(tabs)/calendar')} />}
        {activeTab === 'pipeline' && <StrategicPipeline onNavigateToCalendar={() => router.push('/(tabs)/calendar')} />}
        {activeTab === 'intelligence' && renderIntelligence()}
        {activeTab === 'strategies' && (
          <>
            {renderStrategiesBranch()}
            <CampaignGuard><AELDebugPanel /></CampaignGuard>
          </>
        )}
        {activeTab === 'control' && renderControlCenter()}
        {activeTab === 'marketdb' && <MarketDatabaseAdmin />}
        {activeTab === 'publisher' && renderPublisher()}
        {activeTab === 'audience' && <CampaignGuard>{renderAudienceManager()}</CampaignGuard>}
        {activeTab === 'leads' && <CampaignGuard><LeadControlPanel /></CampaignGuard>}

        {visitedTabs.has('positioning') && (
          <View style={{ display: activeTab === 'positioning' ? 'flex' : 'none' }}>
            <CampaignGuard><PositioningStrategy isActive={activeTab === 'positioning'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('differentiation') && (
          <View style={{ display: activeTab === 'differentiation' ? 'flex' : 'none' }}>
            <CampaignGuard><DifferentiationEngine isActive={activeTab === 'differentiation'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('mechanism') && (
          <View style={{ display: activeTab === 'mechanism' ? 'flex' : 'none' }}>
            <CampaignGuard><MechanismEngine isActive={activeTab === 'mechanism'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('offers') && (
          <View style={{ display: activeTab === 'offers' ? 'flex' : 'none' }}>
            <CampaignGuard><OfferEngine isActive={activeTab === 'offers'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('funnels') && (
          <View style={{ display: activeTab === 'funnels' ? 'flex' : 'none' }}>
            <CampaignGuard><FunnelEngine isActive={activeTab === 'funnels'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('integrity') && (
          <View style={{ display: activeTab === 'integrity' ? 'flex' : 'none' }}>
            <CampaignGuard><IntegrityEngine isActive={activeTab === 'integrity'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('awareness') && (
          <View style={{ display: activeTab === 'awareness' ? 'flex' : 'none' }}>
            <CampaignGuard><AwarenessEngine isActive={activeTab === 'awareness'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('persuasion') && (
          <View style={{ display: activeTab === 'persuasion' ? 'flex' : 'none' }}>
            <CampaignGuard><PersuasionEngine isActive={activeTab === 'persuasion'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('statistical_validation') && (
          <View style={{ display: activeTab === 'statistical_validation' ? 'flex' : 'none' }}>
            <CampaignGuard><StatisticalValidationEngine isActive={activeTab === 'statistical_validation'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('budget_governor') && (
          <View style={{ display: activeTab === 'budget_governor' ? 'flex' : 'none' }}>
            <CampaignGuard><BudgetGovernorEngine isActive={activeTab === 'budget_governor'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('channel_selection') && (
          <View style={{ display: activeTab === 'channel_selection' ? 'flex' : 'none' }}>
            <CampaignGuard><ChannelSelectionEngine isActive={activeTab === 'channel_selection'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('iteration') && (
          <View style={{ display: activeTab === 'iteration' ? 'flex' : 'none' }}>
            <CampaignGuard><IterationEngine isActive={activeTab === 'iteration'} /></CampaignGuard>
          </View>
        )}
        {visitedTabs.has('retention') && (
          <View style={{ display: activeTab === 'retention' ? 'flex' : 'none' }}>
            <CampaignGuard><RetentionEngine isActive={activeTab === 'retention'} /></CampaignGuard>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <Modal
        visible={showAudienceModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAudienceModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="people" size={20} color={colors.accent} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {t('aiManagement.audienceBuilder')}
                </Text>
              </View>
              <Pressable onPress={() => setShowAudienceModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            {generatingAudience ? (
              <View style={styles.audienceLoading}>
                <LinearGradient
                  colors={[colors.accent, '#0EA5E9']}
                  style={styles.audienceLoadingCircle}
                >
                  <ActivityIndicator size="large" color="#fff" />
                </LinearGradient>
                <Text style={[styles.audienceLoadingTitle, { color: colors.text }]}>
                  {t('aiManagement.analyzingAudience')}
                </Text>
                <Text style={[styles.audienceLoadingDesc, { color: colors.textSecondary }]}>
                  {t('aiManagement.analyzingAudienceDesc')}
                </Text>
              </View>
            ) : audiences.length > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} style={styles.audienceResults}>
                <Text style={[styles.audienceResultsTitle, { color: colors.text }]}>
                  {t('aiManagement.recommendedAudiences')}
                </Text>

                {audiences.map((audience, index) => (
                  <Pressable
                    key={index}
                    onPress={() => setExpandedAudience(expandedAudience === index ? null : index)}
                    style={[styles.audienceCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                  >
                    <View style={styles.audienceCardHeader}>
                      <View style={styles.audienceCardLeft}>
                        <View style={[styles.audienceScoreBadge, {
                          backgroundColor: audience.match_score >= 80 ? colors.success + '20'
                            : audience.match_score >= 60 ? colors.accent + '20' : colors.warning + '20',
                        }]}>
                          <Text style={[styles.audienceScoreText, {
                            color: audience.match_score >= 80 ? colors.success
                              : audience.match_score >= 60 ? colors.accent : colors.warning,
                          }]}>
                            {audience.match_score}%
                          </Text>
                        </View>
                        <View style={styles.audienceCardInfo}>
                          <Text style={[styles.audienceName, { color: colors.text }]}>{audience.name}</Text>
                          <Text style={[styles.audienceDesc, { color: colors.textSecondary }]} numberOfLines={1}>
                            {audience.description}
                          </Text>
                        </View>
                      </View>
                      <Ionicons
                        name={expandedAudience === index ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={colors.textMuted}
                      />
                    </View>

                    {expandedAudience === index && (
                      <View style={styles.audienceExpanded}>
                        <View style={[styles.audienceDivider, { backgroundColor: colors.divider }]} />
                        
                        <View style={styles.audienceDetailRow}>
                          <Ionicons name="people-outline" size={16} color={colors.primary} />
                          <Text style={[styles.audienceDetailLabel, { color: colors.textSecondary }]}>
                            {t('aiManagement.size')}:
                          </Text>
                          <Text style={[styles.audienceDetailValue, { color: colors.text }]}>
                            {audience.estimated_size}
                          </Text>
                        </View>

                        <View style={styles.audienceDetailRow}>
                          <Ionicons name="male-female-outline" size={16} color={colors.primary} />
                          <Text style={[styles.audienceDetailLabel, { color: colors.textSecondary }]}>
                            {t('aiManagement.demographics')}:
                          </Text>
                          <Text style={[styles.audienceDetailValue, { color: colors.text }]}>
                            {audience.gender === 'all' ? 'All' : audience.gender} {audience.age_min}-{audience.age_max}
                          </Text>
                        </View>

                        <View style={styles.audienceDetailRow}>
                          <Ionicons name="location-outline" size={16} color={colors.primary} />
                          <Text style={[styles.audienceDetailLabel, { color: colors.textSecondary }]}>
                            {t('aiManagement.locations')}:
                          </Text>
                          <Text style={[styles.audienceDetailValue, { color: colors.text }]} numberOfLines={2}>
                            {audience.locations.join(', ')}
                          </Text>
                        </View>

                        <Text style={[styles.audienceTagsLabel, { color: colors.textSecondary }]}>
                          {t('aiManagement.interests')}
                        </Text>
                        <View style={styles.audienceTags}>
                          {audience.interests.slice(0, 8).map((interest, i) => (
                            <View key={i} style={[styles.audienceTag, { backgroundColor: colors.primary + '12' }]}>
                              <Text style={[styles.audienceTagText, { color: colors.primary }]}>{interest}</Text>
                            </View>
                          ))}
                        </View>

                        <Text style={[styles.audienceTagsLabel, { color: colors.textSecondary }]}>
                          {t('aiManagement.behaviors')}
                        </Text>
                        <View style={styles.audienceTags}>
                          {audience.behaviors.slice(0, 6).map((behavior, i) => (
                            <View key={i} style={[styles.audienceTag, { backgroundColor: colors.accent + '12' }]}>
                              <Text style={[styles.audienceTagText, { color: colors.accent }]}>{behavior}</Text>
                            </View>
                          ))}
                        </View>

                        <View style={styles.audienceDetailRow}>
                          <Ionicons name="grid-outline" size={16} color={colors.primary} />
                          <Text style={[styles.audienceDetailLabel, { color: colors.textSecondary }]}>
                            {t('aiManagement.placements')}:
                          </Text>
                          <Text style={[styles.audienceDetailValue, { color: colors.text }]}>
                            {audience.placements.join(', ')}
                          </Text>
                        </View>

                        <View style={styles.audienceDetailRow}>
                          <Ionicons name="cash-outline" size={16} color={colors.success} />
                          <Text style={[styles.audienceDetailLabel, { color: colors.textSecondary }]}>
                            {t('aiManagement.budget')}:
                          </Text>
                          <Text style={[styles.audienceDetailValue, { color: colors.text }]}>
                            {audience.daily_budget_suggestion}/day ({audience.bid_strategy})
                          </Text>
                        </View>

                        <View style={[styles.audienceReasoning, { backgroundColor: colors.accent + '10' }]}>
                          <Ionicons name="bulb-outline" size={14} color={colors.accent} />
                          <Text style={[styles.audienceReasoningText, { color: colors.accent }]}>
                            {audience.reasoning}
                          </Text>
                        </View>
                      </View>
                    )}
                  </Pressable>
                ))}

                <Pressable
                  onPress={() => { setAudiences([]); setExpandedAudience(null); }}
                  style={styles.regenerateBtn}
                >
                  <Text style={[styles.regenerateText, { color: colors.textMuted }]}>
                    {t('aiManagement.regenerate')}
                  </Text>
                </Pressable>
              </ScrollView>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={[styles.inputLabel, { color: colors.text }]}>
                  {t('aiManagement.campaignGoal')}
                </Text>
                <TextInput
                  style={[styles.textInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder={t('aiManagement.campaignGoalPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={audienceGoal}
                  onChangeText={(v) => { setAudienceGoal(v); updateState({ audienceGoal: v }); }}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>
                  {t('aiManagement.productService')}
                </Text>
                <TextInput
                  style={[styles.textInputSingle, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder={t('aiManagement.productPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={audienceProduct}
                  onChangeText={(v) => { setAudienceProduct(v); updateState({ audienceProduct: v }); }}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>
                  {t('aiManagement.budgetOptional')}
                </Text>
                <TextInput
                  style={[styles.textInputSingle, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="$500/month"
                  placeholderTextColor={colors.textMuted}
                  value={audienceBudget}
                  onChangeText={(v) => { setAudienceBudget(v); updateState({ audienceBudget: v }); }}
                />

                {audienceError ? (
                  <View style={[styles.errorBox, { backgroundColor: colors.error + '15' }]}>
                    <Ionicons name="alert-circle" size={16} color={colors.error} />
                    <Text style={[styles.errorText, { color: colors.error }]}>{audienceError}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={handleGenerateAudience}
                  disabled={!audienceGoal.trim()}
                  style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: 20 }]}
                >
                  <LinearGradient
                    colors={!audienceGoal.trim() ? [colors.textMuted, colors.textMuted] : [colors.accent, '#0EA5E9']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.generateBtn}
                  >
                    <Ionicons name="sparkles" size={20} color="#fff" />
                    <Text style={styles.generateBtnText}>{t('aiManagement.generateAudiences')}</Text>
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  dataSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  dataSourceBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  header: { marginBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  saveIndicator: { paddingTop: 4 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  tabBar: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    marginBottom: 16,
    maxHeight: 44,
  },
  tabBarContent: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    height: 32,
  },
  tabText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.1 },
  tabContent: {},
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  connectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connectionDotWrap: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  connectionDot: { width: 10, height: 10, borderRadius: 5 },
  pulseRing: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  connectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  connectionSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    gap: 6,
  },
  statNum: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  autoPublishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  autoPublishLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  autoPublishTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  autoPublishDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  queueSection: {},
  queueHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  queueTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  selectAllText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  queueCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  queueInfo: { flex: 1 },
  queueMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  queueType: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  queueDate: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  queueContent: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 8 },
  queuePlatformBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  queuePlatformText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  emptyQueue: {
    alignItems: 'center',
    padding: 40,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
  },
  emptyQueueTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyQueueDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  publishBarWrap: { marginTop: 16 },
  publishBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  publishBarText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  audienceCTA: { borderRadius: 20, overflow: 'hidden', marginBottom: 20 },
  audienceCTAIcon: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  audienceCTAText: { flex: 1, paddingHorizontal: 14 },
  audienceCTATitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff', marginBottom: 2 },
  audienceCTADesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.8)' },
  audienceInfoSection: { marginBottom: 20 },
  sectionLabel: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 14 },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    gap: 14,
  },
  stepNum: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepInfo: { flex: 1 },
  stepTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  stepDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  campaignsOverview: {},
  campaignMiniCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  campaignMiniLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  campaignMiniName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  campaignMiniMeta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  optimizeBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 20, paddingHorizontal: 20, paddingBottom: 40,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  audienceLoading: { alignItems: 'center', paddingVertical: 60 },
  audienceLoadingCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  audienceLoadingTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  audienceLoadingDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },
  audienceResults: { marginBottom: 20 },
  audienceResultsTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 16 },
  audienceCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  audienceCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audienceCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  audienceScoreBadge: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  audienceScoreText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  audienceCardInfo: { flex: 1 },
  audienceName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  audienceDesc: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  audienceExpanded: { marginTop: 14 },
  audienceDivider: { height: 1, marginBottom: 14 },
  audienceDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  audienceDetailLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', width: 90 },
  audienceDetailValue: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  audienceTagsLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8, marginTop: 4 },
  audienceTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  audienceTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  audienceTagText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  audienceReasoning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 12, marginTop: 4,
  },
  audienceReasoningText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 17 },
  regenerateBtn: { alignItems: 'center', paddingVertical: 14 },
  regenerateText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  inputLabel: { fontSize: 14, fontFamily: 'Inter_500Medium', marginBottom: 10, marginTop: 16 },
  textInput: {
    borderWidth: 1, borderRadius: 14, padding: 14,
    fontSize: 15, fontFamily: 'Inter_400Regular', minHeight: 90, textAlignVertical: 'top',
  },
  textInputSingle: {
    borderWidth: 1, borderRadius: 14, padding: 14,
    fontSize: 15, fontFamily: 'Inter_400Regular',
  },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 12, marginTop: 12 },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 14, gap: 10,
  },
  generateBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  controlStatusCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  controlStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  controlStatusLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  controlShield: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  controlModeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 1, textTransform: 'uppercase' as const },
  controlModeValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  controlGoalCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  controlGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  controlGoalLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  controlGoalValue: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  controlBudgetCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  controlBudgetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  controlBudgetLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', flex: 1, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  controlBudgetPct: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  controlBudgetTrack: { height: 6, borderRadius: 3, overflow: 'hidden' as const, marginBottom: 6 },
  controlBudgetFill: { height: '100%', borderRadius: 3, backgroundColor: '#3B82F6' },
  controlBudgetText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  controlSection: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  controlSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  controlSectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  controlDoingText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  controlActionItem: { borderTopWidth: 1, paddingTop: 10, marginTop: 8 },
  controlActionTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  controlActionNum: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  controlActionNumText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  controlActionText: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  controlRiskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  controlRiskText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  controlActionWhy: { fontSize: 12, fontFamily: 'Inter_400Regular', marginLeft: 32, lineHeight: 17 },
  emergencyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1.5, borderColor: '#EF4444', paddingVertical: 14 },
  emergencyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
  aeSection: { borderRadius: 14, borderWidth: 1, marginBottom: 10, overflow: 'hidden' as const },
  aeSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  aeSectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aeSectionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  aeSectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  aeSectionBody: { paddingHorizontal: 14, paddingBottom: 14 },
  aeInputSummary: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  aeInputSummaryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  aeInputStat: { alignItems: 'center' },
  aeInputStatNum: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  aeInputStatLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  aeTimestamp: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center' as const, marginTop: 8 },
  aeEmptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', fontStyle: 'italic' as const },
  aePainRow: { borderBottomWidth: 1, paddingVertical: 10 },
  aePainHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aePainCategory: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },
  aePainBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  aePainFreq: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  aePainEvidence: { fontSize: 12, fontFamily: 'Inter_400Regular', fontStyle: 'italic' as const, marginTop: 4, lineHeight: 17 },
  aeSophRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  aeSophLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  aeSophBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  aeSophValue: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  aeSophIndicators: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  aeIntentRow: { marginBottom: 12 },
  aeIntentLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  aeIntentText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  aeIntentPct: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  aeIntentTrack: { height: 6, borderRadius: 3, overflow: 'hidden' as const },
  aeIntentFill: { height: '100%', borderRadius: 3 },
  aePersonaCard: { borderBottomWidth: 1, paddingVertical: 10 },
  aePersonaHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aePersonaIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  aePersonaName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  aePersonaPct: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  aePersonaBody: { marginTop: 10, marginLeft: 42 },
  aePersonaField: { marginBottom: 8 },
  aePersonaFieldLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 2 },
  aePersonaFieldValue: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  aeAdsCard: { borderBottomWidth: 1, paddingVertical: 10 },
  aeAdsField: { marginBottom: 10 },
  aeAdsFieldLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  aeAdsInline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aeAdsInlineText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  aeAdsRationale: { fontSize: 12, fontFamily: 'Inter_400Regular', fontStyle: 'italic' as const, lineHeight: 17, marginTop: 4 },
  aeConfidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  aeConfidenceText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  aeStatusBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  aeStatusTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  aeStatusDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  aeSecondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 10 },
  aeSecondaryBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },
});
