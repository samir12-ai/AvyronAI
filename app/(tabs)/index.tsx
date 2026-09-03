import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  TextInput,
  Modal,
  Animated,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCampaign } from '@/context/CampaignContext';
import { useAuth } from '@/context/AuthContext';
import { authFetch, getApiUrl } from '@/lib/query-client';
import { DashboardAgentPanel } from '@/components/DashboardAgentPanel';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: string;
  targetRoute: string;
  isRead: boolean;
  createdAt: string;
}

interface DashboardOverviewData {
  user: {
    firstName: string;
    fullName: string;
    role: string;
    email?: string;
  };
  lastUpdated: string;
  businessPulse: {
    strategy: {
      version: number;
      status: string;
      label: string;
    };
    market: {
      confirmedChangesMonthCount: number;
      candidatesMonthCount: number;
      label: string;
      subtext: string;
    };
    performance: {
      status: string;
      headline: string;
      subtext: string;
      severity?: string;
    };
    execution: {
      tasksTodayCount: number;
      completedTodayCount: number;
      label: string;
    };
  };
  aiSummaryStrip: {
    text: string;
    priorityLevel: string;
  };
  whatToDoTodayCard: {
    count: number;
    tasks: Array<{
      id: string;
      order: number;
      title: string;
      priorityBadge: string;
      priorityColor: 'red' | 'orange' | 'blue';
      status: string;
      laneTitle?: string;
      channel?: string;
    }>;
  };
  strategyPlanCard: {
    version: number;
    status: string;
    primaryDirection: string;
    activeLanesCount: number;
    latestMaterialChange: {
      summary: string;
      authority: string;
      laneTitle?: string;
      occurredAt?: string;
      relativeTime: string;
      isAcknowledged: boolean;
    } | null;
  };
  performanceCard: {
    kpis: Array<{
      name: string;
      metricKey: string;
      actual: number | string | null;
      planTarget: number | string | null;
      unit: string;
      variancePercent: number | null;
      status: string;
      direction: 'up' | 'down' | 'neutral';
    }>;
    mainConcernOrInsight: string;
    status: string;
    isHealthy: boolean;
  };
  watchtowerCard: {
    confirmedCount: number;
    candidatesCount: number;
    recentConfirmedEvents: Array<{
      id: string;
      competitorName: string;
      kind: string;
      title: string;
      oldValue?: string;
      newValue?: string;
      occurredAt: string;
    }>;
  };
  reasoningCard: {
    activeInvestigationsCount: number;
    investigationState: string;
    headline: string;
    summary: string;
    statusLabel: string;
    proposalId?: string;
  };
  reportsCard: {
    latestReport: {
      id: string;
      periodLabel: string;
      performanceSummary: string;
      strategyChangesCount: number;
      marketChangesCount: number;
      executionCompletionPercent: number;
      status: string;
    } | null;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    icon: string;
    iconColor: string;
    relativeTime: string;
    title: string;
    subtitle: string;
    targetRoute: string;
  }>;
}

function PulsingGreenDot() {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0.4,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <View style={styles.pulseContainer}>
      <Animated.View style={[styles.pulseCircle, { opacity: anim }]} />
      <View style={styles.pulseDot} />
    </View>
  );
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return 'Just now';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1080;

  const { selectedCampaign, selectedCampaignId, campaigns, selectCampaign, refreshCampaigns } = useCampaign();
  const { user } = useAuth();

  const [data, setData] = useState<DashboardOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCampaignSwitcher, setShowCampaignSwitcher] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [agentInput, setAgentInput] = useState('');
  const [setupStatus, setSetupStatus] = useState<{
    isComplete: boolean;
    step: string;
    stepNumber: number;
    stepLabel: string;
    campaignId?: string;
  } | null>(null);

  const fetchSetupStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/setup/status`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setSetupStatus(json);
        }
      }
    } catch (err) {
      console.warn('[DashboardScreen] setup status error:', err);
    }
  }, []);

  const fetchOverview = useCallback(async () => {
    if (!selectedCampaignId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch(`${getApiUrl()}/api/dashboard/overview?campaignId=${selectedCampaignId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch dashboard overview (${res.status})`);
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        throw new Error(json.error || 'Invalid overview response');
      }
    } catch (err: any) {
      console.error('[DashboardScreen] fetch error:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchNotifications = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const res = await authFetch(`${getApiUrl()}/api/notifications?campaignId=${selectedCampaignId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setNotifications(json.notifications || []);
          setUnreadCount(json.unreadCount || 0);
        }
      }
    } catch (err) {
      console.warn('[DashboardScreen] notifications fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchOverview();
    fetchNotifications();
    fetchSetupStatus();
  }, [fetchOverview, fetchNotifications, fetchSetupStatus]);

  const handleMarkNotificationRead = async (notif: NotificationItem) => {
    try {
      await authFetch(`${getApiUrl()}/api/notifications/${notif.id}/read?campaignId=${selectedCampaignId}`, {
        method: 'POST',
      });
      setNotifications(prev => prev.map(n => (n.id === notif.id ? { ...n, isRead: true } : n)));
      setUnreadCount(prev => Math.max(0, prev - 1));
      setShowNotifications(false);
      if (notif.targetRoute) {
        router.push(notif.targetRoute as any);
      }
    } catch (err) {
      console.error('Mark read error:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await authFetch(`${getApiUrl()}/api/notifications/read-all?campaignId=${selectedCampaignId}`, {
        method: 'POST',
      });
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Mark all read error:', err);
    }
  };

  const handleSelectCampaign = async (camp: any) => {
    setShowCampaignSwitcher(false);
    try {
      await selectCampaign(camp);
    } catch (err) {
      console.error('Campaign select error:', err);
    }
  };

  const userName = user?.name || user?.username || data?.user?.firstName || 'Leader';
  const lastUpdatedText = formatRelativeTime(data?.lastUpdated);

  if (loading && selectedCampaignId && !data) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>Loading your business pulse...</Text>
      </View>
    );
  }

  if (!selectedCampaignId) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.topHeader}>
          <View style={styles.greetingContainer}>
            <Text style={styles.greetingTitle}>Welcome, {userName} 👋</Text>
            <Text style={styles.greetingSubtitle}>Let's set up your market intelligence workspace.</Text>
          </View>
        </View>

        <View style={styles.emptyWorkspaceCard}>
          <View style={styles.emptyWorkspaceIcon}>
            <Ionicons name="sparkles" size={32} color="#A78BFA" />
          </View>
          <Text style={styles.emptyWorkspaceTitle}>No Active Campaign Selected</Text>
          <Text style={styles.emptyWorkspaceDesc}>
            To start generating market intelligence, competitor tracking, and daily execution tasks, complete your campaign workspace setup.
          </Text>
          <Pressable
            style={styles.emptyWorkspaceBtn}
            onPress={() => router.push('/setup')}
          >
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.emptyWorkspaceGradient}
            >
              <Text style={styles.emptyWorkspaceBtnText}>Start Workspace Setup</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* 1. TOP HEADER */}
      <View style={styles.topHeader}>
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingTitle}>Good morning, {userName} 👋</Text>
          <Text style={styles.greetingSubtitle}>Here's your business pulse for today.</Text>
        </View>

        <View style={styles.headerRight}>
          {/* Finish Setup Action Button when setup is incomplete */}
          {(!setupStatus || !setupStatus.isComplete) && (
            <Pressable
              style={styles.finishSetupHeaderBtn}
              onPress={() => router.push('/setup')}
            >
              <LinearGradient
                colors={['#8B5CF6', '#6D28D9']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.finishSetupHeaderGradient}
              >
                <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                <Text style={styles.finishSetupHeaderText}>Finish Setup</Text>
                <View style={styles.setupStepPill}>
                  <Text style={styles.setupStepPillText}>Step {setupStatus?.stepNumber || 1}/6</Text>
                </View>
              </LinearGradient>
            </Pressable>
          )}

          <View style={styles.lastActivePill}>
            <Text style={styles.lastActiveText}>Updated {lastUpdatedText}</Text>
            <View style={styles.activeDot} />
          </View>

          {/* Campaign Switcher Button */}
          <Pressable
            style={styles.changeCampaignBtn}
            onPress={() => {
              refreshCampaigns();
              setShowCampaignSwitcher(true);
            }}
          >
            <Text style={styles.changeCampaignText}>
              {selectedCampaign?.selectedCampaignName || 'Change Campaign'}
            </Text>
            <Feather name="chevron-down" size={14} color="#94A3B8" />
          </Pressable>

          {/* Notification Bell with Real Badge */}
          <Pressable
            style={styles.notificationBtn}
            onPress={() => setShowNotifications(true)}
          >
            <Feather name="bell" size={18} color="#E2E8F0" />
            {unreadCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* 1.5 SETUP HERO BANNER (When setup is incomplete) */}
      {(!setupStatus || !setupStatus.isComplete) && (
        <View style={styles.setupHeroBanner}>
          <View style={styles.setupHeroContent}>
            <View style={styles.setupHeroIconBox}>
              <Ionicons name="rocket-outline" size={24} color="#A78BFA" />
            </View>
            <View style={styles.setupHeroTextBox}>
              <View style={styles.setupHeroTitleRow}>
                <Text style={styles.setupHeroTitle}>Finish Workspace Setup</Text>
                <View style={styles.setupStepBadge}>
                  <Text style={styles.setupStepBadgeText}>
                    {setupStatus?.stepNumber ? `Step ${setupStatus.stepNumber} of 6: ${setupStatus.stepLabel}` : 'Setup Incomplete'}
                  </Text>
                </View>
              </View>
              <Text style={styles.setupHeroDesc}>
                Complete your campaign setup to activate AI Market Intelligence, Competitor Watchtower, and What To Do Today execution.
              </Text>
            </View>
          </View>
          <Pressable
            style={styles.setupHeroActionBtn}
            onPress={() => router.push('/setup')}
          >
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.setupHeroActionGradient}
            >
              <Text style={styles.setupHeroActionBtnText}>Finish Setup</Text>
              <Feather name="arrow-right" size={15} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {/* 2. BUSINESS PULSE BAR */}
      <View style={styles.pulseGrid}>
        {/* Strategy Pulse */}
        <Pressable
          style={styles.pulseCard}
          onPress={() => router.push('/(tabs)/strategy-plan')}
        >
          <View style={[styles.pulseIconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
            <Feather name="target" size={20} color="#8B5CF6" />
          </View>
          <View style={styles.pulseInfo}>
            <Text style={styles.pulseLabel}>STRATEGY</Text>
            <Text style={styles.pulseValue}>
              {data?.businessPulse?.strategy?.label || 'No active strategy'}
            </Text>
          </View>
        </Pressable>

        {/* Market Pulse */}
        <Pressable
          style={styles.pulseCard}
          onPress={() => router.push('/(tabs)/watchtower')}
        >
          <View style={[styles.pulseIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
            <Feather name="trending-up" size={20} color="#10B981" />
          </View>
          <View style={styles.pulseInfo}>
            <Text style={styles.pulseLabel}>MARKET</Text>
            <Text style={styles.pulseValue}>
              {data?.businessPulse?.market?.label || '0 confirmed changes'}
            </Text>
            <Text style={styles.pulseSubtext}>this month</Text>
          </View>
        </Pressable>

        {/* Performance Pulse */}
        <Pressable
          style={styles.pulseCard}
          onPress={() => router.push('/(tabs)/performance')}
        >
          <View style={[styles.pulseIconBox, { backgroundColor: data?.businessPulse?.performance?.status === 'DEVIATION' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)' }]}>
            <Feather
              name={data?.businessPulse?.performance?.status === 'DEVIATION' ? 'trending-down' : 'trending-up'}
              size={20}
              color={data?.businessPulse?.performance?.status === 'DEVIATION' ? '#EF4444' : '#10B981'}
            />
          </View>
          <View style={styles.pulseInfo}>
            <Text style={styles.pulseLabel}>PERFORMANCE</Text>
            <Text style={styles.pulseValue}>
              {data?.businessPulse?.performance?.headline || 'On Track'}
            </Text>
            <Text style={[styles.pulseSubtext, { color: data?.businessPulse?.performance?.status === 'DEVIATION' ? '#EF4444' : '#94A3B8' }]}>
              {data?.businessPulse?.performance?.subtext || 'Meeting targets'}
            </Text>
          </View>
        </Pressable>

        {/* Execution Pulse */}
        <Pressable
          style={styles.pulseCard}
          onPress={() => router.push('/(tabs)/what-to-do-today')}
        >
          <View style={[styles.pulseIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Feather name="check-square" size={20} color="#3B82F6" />
          </View>
          <View style={styles.pulseInfo}>
            <Text style={styles.pulseLabel}>EXECUTION</Text>
            <Text style={styles.pulseValue}>
              {data?.businessPulse?.execution?.label || '0 tasks today'}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* 3. AI BUSINESS SUMMARY STRIP / SETUP CALLOUT */}
      <View style={[styles.aiSummaryStrip, (!setupStatus || !setupStatus.isComplete) && { borderColor: 'rgba(139, 92, 246, 0.4)', backgroundColor: 'rgba(124, 58, 237, 0.1)' }]}>
        <View style={styles.sparkleBox}>
          <Feather name="zap" size={16} color="#A78BFA" />
        </View>
        <Text style={[styles.aiSummaryText, { flex: 1 }]}>
          {(!setupStatus || !setupStatus.isComplete)
            ? 'Workspace setup is pending. Finish setup to generate tailored market intelligence and strategy.'
            : (data?.aiSummaryStrip?.text || 'Your strategy is active and optimized.')}
        </Text>
        {(!setupStatus || !setupStatus.isComplete) && (
          <Pressable style={{ backgroundColor: '#7C3AED', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }} onPress={() => router.push('/setup')}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Finish Setup</Text>
            <Feather name="arrow-right" size={12} color="#FFFFFF" />
          </Pressable>
        )}
      </View>

      {/* 4. MAIN LAYOUT */}
      <View style={[styles.mainLayout, !isDesktop && styles.mainLayoutStacked]}>
        {/* LEFT / MAIN COLUMN: 6 CARDS (3x2 GRID) */}
        <View style={[styles.cardsGridContainer, !isDesktop && styles.cardsGridContainerFull]}>
          <View style={styles.cardsRow}>
            {/* CARD 1: WHAT TO DO TODAY */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="check-circle" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>WHAT TO DO TODAY</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              {data?.whatToDoTodayCard?.tasks && data.whatToDoTodayCard.tasks.length > 0 ? (
                <>
                  <Text style={styles.cardSubhead}>{data.whatToDoTodayCard.count} Priority Actions Today</Text>
                  <View style={styles.taskList}>
                    {data.whatToDoTodayCard.tasks.map((task) => (
                      <View key={task.id} style={styles.taskItem}>
                        <View style={[styles.taskNumBadge, { backgroundColor: task.priorityColor === 'red' ? '#EF4444' : (task.priorityColor === 'orange' ? '#F59E0B' : '#3B82F6') }]}>
                          <Text style={styles.taskNumText}>{task.order}</Text>
                        </View>
                        <View style={styles.taskContent}>
                          <Text style={styles.taskTitle}>{task.title}</Text>
                          <View style={[styles.statusTag, { backgroundColor: task.priorityColor === 'red' ? 'rgba(239, 68, 68, 0.15)' : (task.priorityColor === 'orange' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)') }]}>
                            <Text style={[styles.statusTagText, { color: task.priorityColor === 'red' ? '#EF4444' : (task.priorityColor === 'orange' ? '#F59E0B' : '#3B82F6') }]}>
                              {task.priorityBadge}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <PulsingGreenDot />
                  <Text style={styles.emptyStateTitle}>You're clear for now</Text>
                  <Text style={styles.emptyStateSub}>No priority execution tasks pending for today.</Text>
                </View>
              )}

              <Pressable
                style={styles.primaryCtaBtn}
                onPress={() => router.push('/(tabs)/what-to-do-today')}
              >
                <Text style={styles.primaryCtaText}>Open Today's Plan</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>

            {/* CARD 2: STRATEGY PLAN */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="target" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>STRATEGY PLAN</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              {data?.strategyPlanCard?.status === 'ACTIVE' ? (
                <>
                  <Text style={[styles.cardSubhead, { color: '#A78BFA' }]}>
                    Current Strategy — v{data.strategyPlanCard.version}
                  </Text>
                  <View style={styles.metaRowList}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Primary Direction</Text>
                      <Text style={styles.metaValue}>{data.strategyPlanCard.primaryDirection}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Active Lanes</Text>
                      <Text style={styles.metaValue}>{data.strategyPlanCard.activeLanesCount}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Latest Change</Text>
                      <Text style={[styles.metaValue, { maxWidth: '55%', textAlign: 'right' }]}>
                        {data.strategyPlanCard.latestMaterialChange?.summary || 'Baseline active'}
                      </Text>
                    </View>
                  </View>
                  {data.strategyPlanCard.latestMaterialChange?.relativeTime && (
                    <View style={styles.timeTagRow}>
                      <Feather name="clock" size={12} color="#64748B" />
                      <Text style={styles.timeTagText}>
                        {data.strategyPlanCard.latestMaterialChange.relativeTime}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <Feather name="map" size={24} color="#8B5CF6" style={{ marginBottom: 8 }} />
                  <Text style={styles.emptyStateTitle}>No Strategy Generated</Text>
                  <Text style={styles.emptyStateSub}>
                    {setupStatus?.isComplete ? 'Generate your autonomous strategy plan based on approved business context.' : 'Complete workspace setup to generate your autonomous strategy plan.'}
                  </Text>
                </View>
              )}

              {data?.strategyPlanCard?.status === 'ACTIVE' ? (
                <Pressable
                  style={styles.secondaryCtaBtn}
                  onPress={() => router.push('/(tabs)/strategy-plan')}
                >
                  <Text style={styles.secondaryCtaText}>View Strategy</Text>
                  <Feather name="arrow-right" size={16} color="#A78BFA" />
                </Pressable>
              ) : setupStatus?.isComplete ? (
                <Pressable
                  style={[styles.primaryCtaBtn, { backgroundColor: '#7C3AED' }]}
                  onPress={() => router.push('/(tabs)/strategy-plan')}
                >
                  <Text style={styles.primaryCtaText}>Generate Strategy</Text>
                  <Feather name="arrow-right" size={16} color="#FFFFFF" />
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.primaryCtaBtn, { backgroundColor: '#7C3AED' }]}
                  onPress={() => router.push('/setup')}
                >
                  <Text style={styles.primaryCtaText}>Finish Setup to Generate Strategy</Text>
                  <Feather name="arrow-right" size={16} color="#FFFFFF" />
                </Pressable>
              )}
            </View>

            {/* CARD 3: PERFORMANCE LOOP */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="trending-up" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>PERFORMANCE LOOP</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              <Text style={styles.cardSubhead}>Performance vs Plan</Text>

              {data?.performanceCard?.kpis && data.performanceCard.kpis.length > 0 ? (
                <>
                  <View style={styles.kpiList}>
                    {data.performanceCard.kpis.map((kpi) => (
                      <View key={kpi.metricKey} style={styles.kpiRow}>
                        <Text style={styles.kpiLabel}>{kpi.name}</Text>
                        <View style={styles.kpiValRow}>
                          <Text style={[styles.kpiValText, { color: kpi.status === 'BELOW_PLAN' ? '#EF4444' : '#10B981' }]}>
                            {kpi.variancePercent !== null ? `${kpi.variancePercent > 0 ? '+' : ''}${kpi.variancePercent}%` : 'N/A'}
                          </Text>
                          <Feather
                            name={kpi.direction === 'down' ? 'arrow-down' : 'arrow-up'}
                            size={14}
                            color={kpi.status === 'BELOW_PLAN' ? '#EF4444' : '#10B981'}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                  <View style={styles.insightCard}>
                    <Text style={styles.insightText}>
                      Main concern: {data.performanceCard.mainConcernOrInsight}
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <PulsingGreenDot />
                  <Text style={styles.emptyStateTitle}>Performance On Track</Text>
                  <Text style={styles.emptyStateSub}>No performance issue needs your attention.</Text>
                </View>
              )}

              <Pressable
                style={styles.secondaryCtaBtn}
                onPress={() => router.push('/(tabs)/performance')}
              >
                <Text style={styles.secondaryCtaText}>Open Performance</Text>
                <Feather name="arrow-right" size={16} color="#A78BFA" />
              </Pressable>
            </View>
          </View>

          <View style={styles.cardsRow}>
            {/* CARD 4: WATCHTOWER / MARKET */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="eye" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>WATCHTOWER / MARKET</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              <Text style={styles.cardSubhead}>Market Watch</Text>

              {data?.watchtowerCard?.confirmedCount && data.watchtowerCard.confirmedCount > 0 ? (
                <>
                  <Text style={styles.confirmedCountHighlight}>
                    {data.watchtowerCard.confirmedCount} Confirmed Changes
                  </Text>
                  <View style={styles.marketEventsList}>
                    {data.watchtowerCard.recentConfirmedEvents.map((ev) => (
                      <View key={ev.id} style={styles.marketEventItem}>
                        <Feather name="volume-2" size={14} color="#F59E0B" style={styles.marketEventIcon} />
                        <View style={styles.marketEventContent}>
                          <Text style={styles.marketEventTitle}>{ev.title}</Text>
                          {ev.oldValue && ev.newValue && (
                            <Text style={styles.marketEventDiff}>{ev.oldValue} → {ev.newValue}</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                  {data.watchtowerCard.candidatesCount > 0 && (
                    <View style={styles.underReviewPill}>
                      <Text style={styles.underReviewText}>
                        {data.watchtowerCard.candidatesCount} change still under review
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <PulsingGreenDot />
                  <Text style={styles.emptyStateTitle}>Market Stable</Text>
                  <Text style={styles.emptyStateSub}>No confirmed market changes right now.</Text>
                </View>
              )}

              <Pressable
                style={styles.secondaryCtaBtn}
                onPress={() => router.push('/(tabs)/watchtower')}
              >
                <Text style={styles.secondaryCtaText}>Open Watchtower</Text>
                <Feather name="arrow-right" size={16} color="#A78BFA" />
              </Pressable>
            </View>

            {/* CARD 5: REASONING & EVIDENCE */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="cpu" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>REASONING & EVIDENCE</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              <Text style={styles.cardSubhead}>Avyron Investigations</Text>

              {data?.reasoningCard?.investigationState !== 'NO_ACTIVE_INVESTIGATION' ? (
                <>
                  <Text style={styles.investigationActiveCount}>
                    {data?.reasoningCard?.activeInvestigationsCount || 1} Active
                  </Text>
                  <View style={styles.reasoningBox}>
                    <Text style={styles.reasoningBoxText}>{data?.reasoningCard?.summary}</Text>
                  </View>
                  <View style={styles.reasoningStatusRow}>
                    <Text style={styles.statusPrefix}>Status:</Text>
                    <View style={styles.deepReasoningTag}>
                      <Text style={styles.deepReasoningTagText}>{data?.reasoningCard?.statusLabel}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <PulsingGreenDot />
                  <Text style={styles.emptyStateTitle}>No Active Investigation</Text>
                  <Text style={styles.emptyStateSub}>All telemetry and strategic alignments are clear.</Text>
                </View>
              )}

              <Pressable
                style={styles.secondaryCtaBtn}
                onPress={() => router.push('/(tabs)/reasoning-evidence')}
              >
                <Text style={styles.secondaryCtaText}>Review Investigation</Text>
                <Feather name="arrow-right" size={16} color="#A78BFA" />
              </Pressable>
            </View>

            {/* CARD 6: REPORTS */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleRow}>
                  <View style={[styles.cardHeaderIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Feather name="file-text" size={16} color="#8B5CF6" />
                  </View>
                  <Text style={styles.cardTitle}>REPORTS</Text>
                </View>
                <Feather name="more-horizontal" size={16} color="#64748B" />
              </View>

              <Text style={styles.cardSubhead}>Latest Report</Text>

              {data?.reportsCard?.latestReport ? (
                <>
                  <Text style={styles.reportPeriodText}>{data.reportsCard.latestReport.periodLabel}</Text>
                  <View style={styles.metaRowList}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Performance:</Text>
                      <Text style={styles.metaValue}>{data.reportsCard.latestReport.performanceSummary}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Strategy Changes:</Text>
                      <Text style={styles.metaValue}>{data.reportsCard.latestReport.strategyChangesCount}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Market Changes:</Text>
                      <Text style={styles.metaValue}>{data.reportsCard.latestReport.marketChangesCount}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Execution Completion:</Text>
                      <Text style={styles.metaValue}>{data.reportsCard.latestReport.executionCompletionPercent}%</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Status:</Text>
                      <View style={styles.finalizedTag}>
                        <Text style={styles.finalizedTagText}>{data.reportsCard.latestReport.status}</Text>
                      </View>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.emptyStateBox}>
                  <Feather name="file-text" size={24} color="#8B5CF6" style={{ marginBottom: 8 }} />
                  <Text style={styles.emptyStateTitle}>No Monthly Report Yet</Text>
                  <Text style={styles.emptyStateSub}>Your first monthly report will appear after the reporting period closes.</Text>
                </View>
              )}

              <Pressable
                style={styles.secondaryCtaBtn}
                onPress={() => router.push('/(tabs)/reports')}
              >
                <Text style={styles.secondaryCtaText}>Read Monthly Report</Text>
                <Feather name="arrow-right" size={16} color="#A78BFA" />
              </Pressable>
            </View>
          </View>
        </View>

        {/* RIGHT RAIL: LIVE UPDATES & AVYRON AI */}
        <View style={[styles.rightRailContainer, !isDesktop && styles.rightRailContainerFull]}>
          {/* LIVE UPDATES / RECENT ACTIVITY */}
          <View style={styles.liveUpdatesCard}>
            <View style={styles.liveUpdatesHeader}>
              <View style={styles.liveUpdatesTitleRow}>
                <Feather name="activity" size={16} color="#A78BFA" />
                <Text style={styles.liveUpdatesTitle}>LIVE UPDATES</Text>
              </View>
              <Pressable onPress={() => router.push('/(tabs)/reports')}>
                <Text style={styles.viewAllText}>View all</Text>
              </Pressable>
            </View>

            <View style={styles.timelineContainer}>
              {data?.recentActivity && data.recentActivity.length > 0 ? (
                data.recentActivity.map((item, idx) => (
                  <Pressable
                    key={item.id}
                    style={styles.timelineItem}
                    onPress={() => router.push(item.targetRoute as any)}
                  >
                    <View style={styles.timelineNodeContainer}>
                      <View style={[styles.timelineNode, { backgroundColor: item.iconColor }]}>
                        <Feather name={item.icon as any} size={12} color="#FFFFFF" />
                      </View>
                      {idx < data.recentActivity.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineBody}>
                      <Text style={styles.timelineTime}>{item.relativeTime}</Text>
                      <Text style={styles.timelineHeading}>{item.title}</Text>
                      <Text style={styles.timelineSub}>{item.subtitle}</Text>
                    </View>
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyTimelineBox}>
                  <Text style={styles.emptyTimelineText}>No recent activity yet.</Text>
                </View>
              )}
            </View>
          </View>

          {/* AVYRON AI LIVE AGENT PANEL */}
          <DashboardAgentPanel userName={userName} />
        </View>
      </View>

      {/* CAMPAIGN SWITCHER MODAL */}
      <Modal
        visible={showCampaignSwitcher}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCampaignSwitcher(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowCampaignSwitcher(false)}
        >
          <View style={styles.campaignModalContent}>
            <View style={styles.campaignModalHeader}>
              <Text style={styles.campaignModalTitle}>Select Campaign</Text>
              <Pressable onPress={() => setShowCampaignSwitcher(false)}>
                <Feather name="x" size={18} color="#94A3B8" />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              {campaigns.map((c) => {
                const isSelected = c.id === selectedCampaignId;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.campaignOptionItem, isSelected && styles.campaignOptionSelected]}
                    onPress={() => handleSelectCampaign(c)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.campaignOptionName, isSelected && { color: '#8B5CF6' }]}>
                        {c.name}
                      </Text>
                      <Text style={styles.campaignOptionMeta}>
                        {c.platform?.toUpperCase()} · {c.goalType}
                      </Text>
                    </View>
                    {isSelected && <Feather name="check" size={16} color="#8B5CF6" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* NOTIFICATIONS DROPDOWN MODAL */}
      <Modal
        visible={showNotifications}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNotifications(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowNotifications(false)}
        >
          <View style={styles.notificationsModalContent}>
            <View style={styles.notificationsModalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="bell" size={16} color="#A78BFA" />
                <Text style={styles.notificationsModalTitle}>Notifications</Text>
              </View>
              {unreadCount > 0 && (
                <Pressable onPress={handleMarkAllRead}>
                  <Text style={styles.markAllReadText}>Mark all as read</Text>
                </Pressable>
              )}
            </View>

            <ScrollView style={{ maxHeight: 380 }}>
              {notifications.length > 0 ? (
                notifications.map((n) => (
                  <Pressable
                    key={n.id}
                    style={[styles.notifItem, !n.isRead && styles.notifItemUnread]}
                    onPress={() => handleMarkNotificationRead(n)}
                  >
                    <View style={styles.notifItemHeader}>
                      <Text style={[styles.notifTitle, !n.isRead && { color: '#FFFFFF', fontWeight: '700' }]}>
                        {n.title}
                      </Text>
                      {!n.isRead && <View style={styles.notifUnreadDot} />}
                    </View>
                    <Text style={styles.notifMessage}>{n.message}</Text>
                    <Text style={styles.notifTime}>{formatRelativeTime(n.createdAt)}</Text>
                  </Pressable>
                ))
              ) : (
                <View style={styles.emptyNotifBox}>
                  <Feather name="check-circle" size={24} color="#10B981" style={{ marginBottom: 8 }} />
                  <Text style={styles.emptyNotifText}>All caught up!</Text>
                  <Text style={styles.emptyNotifSub}>No unread notifications for this campaign.</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 60,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0B0F19',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 12,
    fontSize: 14,
  },

  // 1. Top Header
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    flexWrap: 'wrap',
    gap: 16,
  },
  greetingContainer: {
    flex: 1,
    minWidth: 280,
  },
  greetingTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  greetingSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lastActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131B2E',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 8,
  },
  lastActiveText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  changeCampaignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131B2E',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 8,
  },
  changeCampaignText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  notificationBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#131B2E',
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  // 2. Business Pulse Bar
  pulseGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  pulseCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F293D',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pulseIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseInfo: {
    flex: 1,
  },
  pulseLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  pulseValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pulseSubtext: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },

  // 3. AI Business Summary Strip
  aiSummaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141428',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2D2852',
    marginBottom: 24,
    gap: 12,
  },
  sparkleBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiSummaryText: {
    fontSize: 13,
    color: '#E2E8F0',
    fontWeight: '500',
    flex: 1,
  },

  // 4. Main Layout
  mainLayout: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
  },
  mainLayoutStacked: {
    flexDirection: 'column',
  },
  cardsGridContainer: {
    flex: 3,
    gap: 20,
  },
  cardsGridContainerFull: {
    width: '100%',
  },
  cardsRow: {
    flexDirection: 'row',
    gap: 20,
    flexWrap: 'wrap',
  },
  card: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
    display: 'flex',
    flexDirection: 'column',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  cardSubhead: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },

  // Empty State
  emptyStateBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
    gap: 6,
    flex: 1,
  },
  emptyStateTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    textAlign: 'center',
  },
  emptyStateSub: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 16,
  },
  pulseContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
    position: 'relative',
  },
  pulseCircle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },

  // Task List in Card 1
  taskList: {
    gap: 12,
    marginBottom: 20,
    flex: 1,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  taskNumBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskNumText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 4,
  },
  statusTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusTagText: {
    fontSize: 9,
    fontWeight: '700',
  },

  // Meta Rows in Card 2 & 6
  metaRowList: {
    gap: 10,
    marginBottom: 16,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  timeTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  timeTagText: {
    fontSize: 11,
    color: '#64748B',
  },

  // KPIs in Card 3
  kpiList: {
    gap: 10,
    marginBottom: 14,
  },
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  kpiValRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  kpiValText: {
    fontSize: 13,
    fontWeight: '700',
  },
  insightCard: {
    backgroundColor: '#0D131F',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 20,
  },
  insightText: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },

  // Market Watch in Card 4
  confirmedCountHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: '#EF4444',
    marginBottom: 14,
  },
  marketEventsList: {
    gap: 10,
    marginBottom: 14,
    flex: 1,
  },
  marketEventItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  marketEventIcon: {
    marginTop: 2,
  },
  marketEventContent: {
    flex: 1,
  },
  marketEventTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#E2E8F0',
  },
  marketEventDiff: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  underReviewPill: {
    backgroundColor: '#1E170E',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#382A14',
    marginBottom: 20,
  },
  underReviewText: {
    fontSize: 11,
    color: '#F59E0B',
  },

  // Reasoning in Card 5
  investigationActiveCount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 14,
  },
  reasoningBox: {
    backgroundColor: '#0E1A1A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#183832',
    marginBottom: 14,
    flex: 1,
  },
  reasoningBoxText: {
    fontSize: 12,
    color: '#D1FAE5',
    lineHeight: 18,
  },
  reasoningStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  statusPrefix: {
    fontSize: 12,
    color: '#94A3B8',
  },
  deepReasoningTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  deepReasoningTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },

  // Reports in Card 6
  reportPeriodText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 14,
  },
  finalizedTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  finalizedTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },

  // Buttons
  primaryCtaBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
    marginTop: 'auto',
  },
  primaryCtaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryCtaBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2E2854',
    gap: 8,
    marginTop: 'auto',
  },
  secondaryCtaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
  },

  // Right Rail: Live Updates & Agent
  rightRailContainer: {
    flex: 1,
    minWidth: 280,
    gap: 20,
  },
  rightRailContainerFull: {
    width: '100%',
  },
  liveUpdatesCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  liveUpdatesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  liveUpdatesTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveUpdatesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  viewAllText: {
    fontSize: 12,
    color: '#A78BFA',
    fontWeight: '500',
  },
  timelineContainer: {
    gap: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineNodeContainer: {
    alignItems: 'center',
    width: 24,
  },
  timelineNode: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#1E293B',
    marginTop: 4,
    marginBottom: -8,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 4,
  },
  timelineTime: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
  },
  timelineHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  timelineSub: {
    fontSize: 11,
    color: '#94A3B8',
  },
  emptyTimelineBox: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyTimelineText: {
    fontSize: 12,
    color: '#64748B',
  },

  // Avyron AI Panel
  aiPanelCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F293D',
  },
  aiPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  aiPanelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiPanelTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  aiPanelControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiMessageBubble: {
    flexDirection: 'row',
    backgroundColor: '#181630',
    borderRadius: 10,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2D2854',
  },
  aiSparkleIcon: {
    marginTop: 2,
  },
  aiMessageTextContainer: {
    flex: 1,
  },
  aiMessageGreeting: {
    fontSize: 12,
    color: '#E2E8F0',
    fontWeight: '500',
  },
  aiMessageQuestion: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  aiMessageTime: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 12,
  },
  aiInputRow: {
    flexDirection: 'row',
    backgroundColor: '#0B0F19',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  aiTextInput: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
    paddingVertical: 4,
  },
  aiSendBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiPromptSuggestions: {
    gap: 6,
  },
  aiPromptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#15172C',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#262445',
  },
  aiPromptChipText: {
    fontSize: 11,
    color: '#CBD5E1',
  },

  // Modal Overlays
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  campaignModalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#131B2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 20,
  },
  campaignModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  campaignModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  campaignOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  campaignOptionSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1A1633',
  },
  campaignOptionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  campaignOptionMeta: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },

  // Notifications Modal
  notificationsModalContent: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#131B2E',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1F293D',
    padding: 20,
  },
  notificationsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  notificationsModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  markAllReadText: {
    fontSize: 12,
    color: '#A78BFA',
    fontWeight: '600',
  },
  notifItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  notifItemUnread: {
    borderColor: '#8B5CF660',
    backgroundColor: '#16162E',
  },
  notifItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  notifUnreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8B5CF6',
  },
  notifMessage: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
    marginBottom: 6,
  },
  notifTime: {
    fontSize: 10,
    color: '#64748B',
  },
  emptyNotifBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyNotifText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyNotifSub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  emptyWorkspaceCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F0B1E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 36,
    marginTop: 24,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  emptyWorkspaceIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyWorkspaceTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyWorkspaceDesc: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 440,
  },
  emptyWorkspaceBtn: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyWorkspaceGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyWorkspaceBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  finishSetupHeaderBtn: {
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  finishSetupHeaderGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    paddingHorizontal: 12,
    gap: 6,
  },
  finishSetupHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  setupStepPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  setupStepPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  setupHeroBanner: {
    backgroundColor: '#16112E',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
    borderRadius: 14,
    padding: 18,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 14,
  },
  setupHeroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 260,
  },
  setupHeroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupHeroTextBox: {
    flex: 1,
  },
  setupHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  setupHeroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  setupStepBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  setupStepBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#DDD6FE',
  },
  setupHeroDesc: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  setupHeroActionBtn: {
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  setupHeroActionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    paddingHorizontal: 20,
    gap: 8,
  },
  setupHeroActionBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
