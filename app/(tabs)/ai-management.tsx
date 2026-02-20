import React, { useState, useMemo, useRef, useEffect } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';
import StrategyHub from '@/components/StrategyHub';
import LeadControlPanel from '@/components/LeadControlPanel';
import CompetitiveIntelligence from '@/components/CompetitiveIntelligence';
import { CampaignBar, CampaignGuard } from '@/components/CampaignSelector';

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

type TabView = 'control' | 'publisher' | 'audience' | 'strategy' | 'leads' | 'intel';

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
  const { scheduledPosts, updateScheduledPost, metaConnection, brandProfile, campaigns, advancedMode } = useApp();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<TabView>('control');
  const [autopilotOn, setAutopilotOn] = useState(true);
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [controlData, setControlData] = useState<any>(null);
  const [nextActions, setNextActions] = useState<{action: string; why: string; risk: string}[]>([]);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<any[]>([]);

  const [showAudienceModal, setShowAudienceModal] = useState(false);
  const [audienceGoal, setAudienceGoal] = useState('');
  const [audienceProduct, setAudienceProduct] = useState('');
  const [audienceBudget, setAudienceBudget] = useState('');
  const [generatingAudience, setGeneratingAudience] = useState(false);
  const [audiences, setAudiences] = useState<AIAudience[]>([]);
  const [audienceError, setAudienceError] = useState('');
  const [expandedAudience, setExpandedAudience] = useState<number | null>(null);

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

      if (data.demo) {
        Alert.alert(
          t('aiManagement.demoMode'),
          t('aiManagement.demoModeDesc')
        );
      } else {
        for (const result of (data.results || [])) {
          if (result.status === 'published') {
            const post = scheduledPosts.find(p => p.id === result.postId);
            if (post) {
              await updateScheduledPost({ ...post, status: 'published' });
            }
          }
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      Alert.alert(t('aiManagement.publishFailed'), t('aiManagement.publishFailedDesc'));
    } finally {
      setPublishing(false);
      setSelectedPosts(new Set());
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

  const currentGoal = useMemo(() => {
    const activeCampaigns = campaigns.filter(c => c.status === 'active');
    if (activeCampaigns.length > 0) return `Optimize ${activeCampaigns[0].name}`;
    return 'Maximize campaign ROI';
  }, [campaigns]);

  const budgetInfo = useMemo(() => {
    const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0) || 500;
    const totalSpent = campaigns.reduce((s, c) => s + c.spent, 0) || 0;
    const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
    return { total: totalBudget, spent: totalSpent, pct };
  }, [campaigns]);

  const renderControlCenter = () => (
    <View style={styles.tabContent}>
      <View style={[styles.controlStatusCard, { backgroundColor: isDark ? '#0F1419' : '#F4F7F5', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
        <View style={styles.controlStatusRow}>
          <View style={styles.controlStatusLeft}>
            <View style={[styles.controlShield, { backgroundColor: autopilotOn ? '#00D09C' + '15' : '#FF6B6B' + '15' }]}>
              <Ionicons name="shield-checkmark" size={22} color={autopilotOn ? '#00D09C' : '#FF6B6B'} />
            </View>
            <View>
              <Text style={[styles.controlModeLabel, { color: colors.textMuted }]}>MODE</Text>
              <Text style={[styles.controlModeValue, { color: autopilotOn ? '#00D09C' : '#FF6B6B' }]}>
                {autopilotOn ? 'Autopilot ON' : 'Autopilot OFF'}
              </Text>
            </View>
          </View>
          <Switch
            value={autopilotOn}
            onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setAutopilotOn(v); }}
            trackColor={{ false: '#FF6B6B' + '40', true: '#00D09C' + '60' }}
            thumbColor={autopilotOn ? '#00D09C' : '#FF6B6B'}
          />
        </View>
      </View>

      <View style={[styles.controlGoalCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
        <View style={styles.controlGoalRow}>
          <Ionicons name="flag" size={16} color="#A78BFA" />
          <Text style={[styles.controlGoalLabel, { color: colors.textMuted }]}>Current Goal</Text>
        </View>
        <Text style={[styles.controlGoalValue, { color: colors.text }]}>{currentGoal}</Text>
      </View>

      <View style={[styles.controlBudgetCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
        <View style={styles.controlBudgetHeader}>
          <Ionicons name="wallet-outline" size={16} color="#4C9AFF" />
          <Text style={[styles.controlBudgetLabel, { color: colors.textMuted }]}>Budget Allocation</Text>
          <Text style={[styles.controlBudgetPct, { color: '#4C9AFF' }]}>{budgetInfo.pct}%</Text>
        </View>
        <View style={[styles.controlBudgetTrack, { backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
          <View style={[styles.controlBudgetFill, { width: `${Math.min(budgetInfo.pct, 100)}%` }]} />
        </View>
        <Text style={[styles.controlBudgetText, { color: colors.textSecondary }]}>
          ${budgetInfo.spent.toFixed(0)} / ${budgetInfo.total.toFixed(0)}
        </Text>
      </View>

      <View style={[styles.controlSection, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
        <View style={styles.controlSectionHeader}>
          <Ionicons name="flash" size={16} color="#A78BFA" />
          <Text style={[styles.controlSectionTitle, { color: colors.text }]}>What AI is Doing Now</Text>
        </View>
        <Text style={[styles.controlDoingText, { color: colors.textSecondary }]}>
          {autopilotOn
            ? 'Analyzing performance data and optimizing campaigns for maximum ROI'
            : 'Autopilot is paused. Turn it on to resume AI optimization.'
          }
        </Text>
      </View>

      <View style={[styles.controlSection, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
        <View style={styles.controlSectionHeader}>
          <Ionicons name="list" size={16} color="#FFB347" />
          <Text style={[styles.controlSectionTitle, { color: colors.text }]}>Next Planned Actions</Text>
        </View>
        {nextActions.map((a, i) => (
          <View key={i} style={[styles.controlActionItem, { borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={styles.controlActionTop}>
              <View style={[styles.controlActionNum, { backgroundColor: '#A78BFA' + '12' }]}>
                <Text style={[styles.controlActionNumText, { color: '#A78BFA' }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.controlActionText, { color: colors.text }]}>{a.action}</Text>
              <View style={[styles.controlRiskBadge, { backgroundColor: a.risk === 'Low' ? '#00D09C' + '12' : '#FFB347' + '12' }]}>
                <Text style={[styles.controlRiskText, { color: a.risk === 'Low' ? '#00D09C' : '#FFB347' }]}>{a.risk}</Text>
              </View>
            </View>
            <Text style={[styles.controlActionWhy, { color: colors.textMuted }]}>{a.why}</Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setAutopilotOn(false);
          Alert.alert('Emergency Stop', 'AI Autopilot has been paused. All automated actions stopped.');
        }}
        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: 8 }]}
      >
        <View style={styles.emergencyBtn}>
          <Ionicons name="stop-circle" size={20} color="#EF4444" />
          <Text style={styles.emergencyBtnText}>Emergency Stop</Text>
        </View>
      </Pressable>
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
          <View style={[styles.demoBadge, { backgroundColor: colors.accent }]}>
            <Text style={styles.demoBadgeText}>DEMO</Text>
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

  const renderAudienceManager = () => (
    <View style={styles.tabContent}>
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
      >
        <LinearGradient
          colors={[colors.accent, '#0EA5E9']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.audienceCTA}
        >
          <View style={styles.audienceCTAIcon}>
            <Ionicons name="people" size={24} color="#fff" />
          </View>
          <View style={styles.audienceCTAText}>
            <Text style={styles.audienceCTATitle}>{t('aiManagement.findAudience')}</Text>
            <Text style={styles.audienceCTADesc}>{t('aiManagement.findAudienceDesc')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
        </LinearGradient>
      </Pressable>

      <View style={styles.audienceInfoSection}>
        <Text style={[styles.sectionLabel, { color: colors.text }]}>
          {t('aiManagement.howItWorks')}
        </Text>
        
        {[
          { icon: 'flag-outline' as const, title: t('aiManagement.step1Title'), desc: t('aiManagement.step1Desc') },
          { icon: 'sparkles-outline' as const, title: t('aiManagement.step2Title'), desc: t('aiManagement.step2Desc') },
          { icon: 'people-outline' as const, title: t('aiManagement.step3Title'), desc: t('aiManagement.step3Desc') },
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

      {campaigns.length > 0 && (
        <View style={styles.campaignsOverview}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            {t('aiManagement.activeCampaigns')}
          </Text>
          {campaigns.filter(c => c.status === 'active').slice(0, 3).map(campaign => (
            <View key={campaign.id} style={[styles.campaignMiniCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.campaignMiniLeft}>
                <Ionicons name="megaphone" size={18} color={colors.primary} />
                <View>
                  <Text style={[styles.campaignMiniName, { color: colors.text }]}>{campaign.name}</Text>
                  <Text style={[styles.campaignMiniMeta, { color: colors.textMuted }]}>
                    {campaign.platform} • ${campaign.spent}/${campaign.budget}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  setAudienceGoal(`Optimize ${campaign.name} campaign for better reach and conversions`);
                  setAudienceProduct(brandProfile.industry || '');
                  setAudienceBudget(`$${campaign.budget}`);
                  setShowAudienceModal(true);
                  setAudiences([]);
                  setAudienceError('');
                }}
                style={[styles.optimizeBtn, { backgroundColor: colors.primary + '15' }]}
              >
                <Ionicons name="sparkles" size={14} color={colors.primary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );

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
        </View>

        <CampaignBar />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabBar, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          contentContainerStyle={styles.tabBarContent}
        >
          {([
            { key: 'control' as TabView, icon: 'shield-checkmark-outline' as const, label: 'Control', color: '#8B5CF6', advanced: false },
            { key: 'publisher' as TabView, icon: 'send-outline' as const, label: 'Publish', color: colors.primary, advanced: false },
            { key: 'audience' as TabView, icon: 'people-outline' as const, label: 'Audience', color: colors.primary, advanced: true },
            { key: 'strategy' as TabView, icon: 'analytics-outline' as const, label: 'Strategy', color: colors.primary, advanced: true },
            { key: 'leads' as TabView, icon: 'magnet-outline' as const, label: 'Leads', color: '#00D09C', advanced: true },
            { key: 'intel' as TabView, icon: 'telescope-outline' as const, label: 'Intel', color: '#8B5CF6', advanced: true },
          ] as const)
            .filter(t => !t.advanced || advancedMode)
            .map(t => {
              const isActive = activeTab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => { Haptics.selectionAsync(); setActiveTab(t.key); }}
                  style={[styles.tab, isActive && { backgroundColor: t.color + '14', borderColor: t.color + '30' }]}
                >
                  <Ionicons name={t.icon} size={17} color={isActive ? t.color : colors.textMuted} />
                  <Text style={[styles.tabText, { color: isActive ? t.color : colors.textMuted }]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
        </ScrollView>

        {activeTab === 'control' ? renderControlCenter()
          : activeTab === 'publisher' ? renderPublisher()
          : activeTab === 'audience' ? <CampaignGuard>{renderAudienceManager()}</CampaignGuard>
          : activeTab === 'leads' ? <CampaignGuard><LeadControlPanel /></CampaignGuard>
          : activeTab === 'intel' ? <CampaignGuard><CompetitiveIntelligence /></CampaignGuard>
          : <CampaignGuard><StrategyHub /></CampaignGuard>}

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
                  onChangeText={setAudienceGoal}
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
                  onChangeText={setAudienceProduct}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>
                  {t('aiManagement.budgetOptional')}
                </Text>
                <TextInput
                  style={[styles.textInputSingle, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="$500/month"
                  placeholderTextColor={colors.textMuted}
                  value={audienceBudget}
                  onChangeText={setAudienceBudget}
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
  header: { marginBottom: 20 },
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  tabBar: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 5,
    marginBottom: 20,
  },
  tabBarContent: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 2,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 11,
    gap: 7,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.1 },
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
  demoBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  demoBadgeText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
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
});
