import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  useColorScheme,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { getApiUrl } from '@/lib/query-client';

type StrategyView = 'overview' | 'insights' | 'decisions' | 'memory' | 'growth' | 'reports' | 'sniper';

interface DashboardData {
  averages: any;
  recentInsights: any[];
  recentDecisions: any[];
  memory: { winners: any[]; losers: any[]; total: number };
  activeCampaigns: any[];
  latestReport: any;
}

function MetricPill({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  return (
    <View style={[s.metricPill, { backgroundColor: color + '12', borderColor: color + '25' }]}>
      <Ionicons name={icon as any} size={14} color={color} />
      <Text style={[s.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[s.metricLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function GlowDot({ color, size = 8 }: { color: string; size?: number }) {
  const anim = useRef(new RNAnimated.Value(0.4)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        RNAnimated.timing(anim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return <RNAnimated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: anim }} />;
}

export default function StrategyHub() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { t } = useLanguage();

  const [activeView, setActiveView] = useState<StrategyView>('overview');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const [insights, setInsights] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [memoryItems, setMemoryItems] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);

  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [campaignBudget, setCampaignBudget] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [advancingCampaign, setAdvancingCampaign] = useState<string | null>(null);

  const [showSniper, setShowSniper] = useState(false);
  const [sniperGoal, setSniperGoal] = useState('');
  const [sniperProduct, setSniperProduct] = useState('');
  const [sniperBudget, setSniperBudget] = useState('');
  const [sniping, setSniping] = useState(false);
  const [sniperResult, setSniperResult] = useState<any>(null);

  const [generatingReport, setGeneratingReport] = useState(false);

  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [expandedDecision, setExpandedDecision] = useState<number | null>(null);

  const baseUrl = getApiUrl();

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(new URL('/api/strategy/dashboard', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setDashboard(data);
      }
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const handleSyncPerformance = async () => {
    setSyncing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(new URL('/api/strategy/sync-performance', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        Alert.alert('Data Synced', `${data.synced} performance records loaded.${data.demo ? ' (Demo mode)' : ''}`);
        fetchDashboard();
      }
    } catch {
      Alert.alert('Error', 'Failed to sync performance data.');
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await fetch(new URL('/api/strategy/analyze', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setAnalysisResult(data);
        fetchDashboard();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Analysis Failed', data.error || 'Could not complete analysis');
      }
    } catch {
      Alert.alert('Error', 'Strategy analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const fetchInsights = async () => {
    try {
      const res = await fetch(new URL('/api/strategy/insights', baseUrl).toString());
      if (res.ok) setInsights(await res.json());
    } catch {}
  };

  const fetchDecisions = async () => {
    try {
      const res = await fetch(new URL('/api/strategy/decisions', baseUrl).toString());
      if (res.ok) setDecisions(await res.json());
    } catch {}
  };

  const fetchMemory = async () => {
    try {
      const res = await fetch(new URL('/api/strategy/memory', baseUrl).toString());
      if (res.ok) setMemoryItems(await res.json());
    } catch {}
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(new URL('/api/strategy/growth-campaigns', baseUrl).toString());
      if (res.ok) setCampaigns(await res.json());
    } catch {}
  };

  const fetchReports = async () => {
    try {
      const res = await fetch(new URL('/api/strategy/weekly-reports', baseUrl).toString());
      if (res.ok) setReports(await res.json());
    } catch {}
  };

  useEffect(() => {
    if (activeView === 'insights') fetchInsights();
    if (activeView === 'decisions') fetchDecisions();
    if (activeView === 'memory') fetchMemory();
    if (activeView === 'growth') fetchCampaigns();
    if (activeView === 'reports') fetchReports();
  }, [activeView]);

  const handleCreateCampaign = async () => {
    setCreatingCampaign(true);
    try {
      const res = await fetch(new URL('/api/strategy/growth-campaign', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: campaignName, budget: parseFloat(campaignBudget) || 0 }),
      });
      if (res.ok) {
        setShowNewCampaign(false);
        setCampaignName('');
        setCampaignBudget('');
        fetchCampaigns();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {} finally { setCreatingCampaign(false); }
  };

  const handleAdvanceCampaign = async (id: string) => {
    setAdvancingCampaign(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await fetch(new URL(`/api/strategy/growth-campaign/${id}/advance`, baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        fetchCampaigns();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {} finally { setAdvancingCampaign(null); }
  };

  const handleAudienceSnipe = async () => {
    setSniping(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await fetch(new URL('/api/strategy/audience-snipe', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignGoal: sniperGoal, product: sniperProduct, budget: sniperBudget }),
      });
      const data = await res.json();
      if (data.success) {
        setSniperResult(data);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {} finally { setSniping(false); }
  };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const res = await fetch(new URL('/api/strategy/weekly-report', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        fetchReports();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {} finally { setGeneratingReport(false); }
  };

  const handleUpdateDecision = async (id: string, status: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await fetch(new URL(`/api/strategy/decisions/${id}`, baseUrl).toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      fetchDecisions();
    } catch {}
  };

  const navItems: { key: StrategyView; icon: string; label: string }[] = [
    { key: 'overview', icon: 'analytics', label: 'Overview' },
    { key: 'insights', icon: 'bulb', label: 'Patterns' },
    { key: 'decisions', icon: 'git-branch', label: 'Decisions' },
    { key: 'memory', icon: 'hardware-chip', label: 'Memory' },
    { key: 'growth', icon: 'rocket', label: 'Growth' },
    { key: 'reports', icon: 'document-text', label: 'Reports' },
    { key: 'sniper', icon: 'locate', label: 'Sniper' },
  ];

  const formatNum = (n: number | null | undefined) => {
    if (n == null) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return typeof n === 'number' ? n.toFixed(n % 1 === 0 ? 0 : 1) : '0';
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'testing': return '#F59E0B';
      case 'optimization': return '#3B82F6';
      case 'authority': return '#10B981';
      default: return colors.textMuted;
    }
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'high': return colors.error;
      case 'medium': return colors.accent;
      case 'low': return colors.success;
      default: return colors.textMuted;
    }
  };

  const renderOverview = () => {
    if (loading && !dashboard) {
      return (
        <View style={s.centerLoad}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }

    const hasData = dashboard && dashboard.averages && dashboard.averages.totalPosts > 0;

    return (
      <View>
        {!hasData && (
          <View style={[s.syncCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={s.syncCardTop}>
              <View style={[s.syncIcon, { backgroundColor: '#3B82F6' + '15' }]}>
                <Ionicons name="cloud-download-outline" size={24} color="#3B82F6" />
              </View>
              <View style={s.syncInfo}>
                <Text style={[s.syncTitle, { color: colors.text }]}>Sync Performance Data</Text>
                <Text style={[s.syncDesc, { color: colors.textSecondary }]}>
                  Load your Meta analytics or use demo data to start the strategy engine
                </Text>
              </View>
            </View>
            <Pressable onPress={handleSyncPerformance} disabled={syncing} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <LinearGradient colors={['#3B82F6', '#6366F1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtn}>
                {syncing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="sync" size={18} color="#fff" />}
                <Text style={s.actionBtnText}>{syncing ? 'Syncing...' : 'Sync Now'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {hasData && (
          <>
            <View style={s.metricsGrid}>
              <MetricPill label="Avg Reach" value={formatNum(dashboard?.averages?.avgReach)} icon="eye-outline" color="#3B82F6" />
              <MetricPill label="Avg CTR" value={`${(dashboard?.averages?.avgCtr || 0).toFixed(1)}%`} icon="finger-print-outline" color="#10B981" />
              <MetricPill label="Avg CPA" value={`$${(dashboard?.averages?.avgCpa || 0).toFixed(0)}`} icon="cash-outline" color="#F59E0B" />
              <MetricPill label="Avg ROAS" value={`${(dashboard?.averages?.avgRoas || 0).toFixed(1)}x`} icon="trending-up-outline" color="#8B5CF6" />
              <MetricPill label="Posts" value={formatNum(dashboard?.averages?.totalPosts)} icon="layers-outline" color="#EC4899" />
              <MetricPill label="Retention" value={`${(dashboard?.averages?.avgRetention || 0).toFixed(0)}%`} icon="timer-outline" color="#06B6D4" />
            </View>

            <View style={s.row}>
              <Pressable onPress={handleSyncPerformance} disabled={syncing} style={({ pressed }) => [s.halfBtn, { opacity: pressed ? 0.8 : 1 }]}>
                <View style={[s.outlineBtn, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
                  {syncing ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons name="sync" size={16} color={colors.primary} />}
                  <Text style={[s.outlineBtnText, { color: colors.primary }]}>{syncing ? 'Syncing...' : 'Re-sync'}</Text>
                </View>
              </Pressable>
              <Pressable onPress={handleAnalyze} disabled={analyzing} style={({ pressed }) => [s.halfBtn, { opacity: pressed ? 0.8 : 1 }]}>
                <LinearGradient colors={['#8B5CF6', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.analyzeBtn}>
                  {analyzing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="sparkles" size={16} color="#fff" />}
                  <Text style={s.analyzeBtnText}>{analyzing ? 'Thinking...' : 'Run AI Analysis'}</Text>
                </LinearGradient>
              </Pressable>
            </View>

            {analysisResult && (
              <View style={[s.summaryCard, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '25' }]}>
                <View style={s.summaryHeader}>
                  <Ionicons name="sparkles" size={18} color="#8B5CF6" />
                  <Text style={[s.summaryTitle, { color: colors.text }]}>AI Strategic Summary</Text>
                </View>
                <Text style={[s.summaryText, { color: colors.textSecondary }]}>
                  {analysisResult.executiveSummary}
                </Text>
                <View style={s.summaryStats}>
                  <View style={[s.summaryStatBadge, { backgroundColor: '#10B981' + '15' }]}>
                    <Text style={[s.summaryStatText, { color: '#10B981' }]}>{analysisResult.insights?.length || 0} patterns</Text>
                  </View>
                  <View style={[s.summaryStatBadge, { backgroundColor: '#3B82F6' + '15' }]}>
                    <Text style={[s.summaryStatText, { color: '#3B82F6' }]}>{analysisResult.decisions?.length || 0} decisions</Text>
                  </View>
                  <View style={[s.summaryStatBadge, { backgroundColor: '#F59E0B' + '15' }]}>
                    <Text style={[s.summaryStatText, { color: '#F59E0B' }]}>{analysisResult.memoryUpdates?.length || 0} memories</Text>
                  </View>
                </View>
              </View>
            )}

            {(dashboard?.recentInsights?.length || 0) > 0 && (
              <View style={s.sectionBlock}>
                <Text style={[s.sectionTitle, { color: colors.text }]}>Recent Insights</Text>
                {dashboard!.recentInsights.slice(0, 3).map((ins: any, i: number) => (
                  <View key={ins.id || i} style={[s.miniCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <View style={[s.categoryDot, { backgroundColor: getCategoryColor(ins.category) }]} />
                    <Text style={[s.miniCardText, { color: colors.text }]} numberOfLines={2}>{ins.insight}</Text>
                  </View>
                ))}
              </View>
            )}

            {(dashboard?.activeCampaigns?.length || 0) > 0 && (
              <View style={s.sectionBlock}>
                <Text style={[s.sectionTitle, { color: colors.text }]}>Active Growth Campaigns</Text>
                {dashboard!.activeCampaigns.map((c: any) => (
                  <View key={c.id} style={[s.campaignCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <View style={s.campaignRow}>
                      <GlowDot color={getStageColor(c.stage)} size={10} />
                      <Text style={[s.campaignName, { color: colors.text }]}>{c.name}</Text>
                      <View style={[s.stageBadge, { backgroundColor: getStageColor(c.stage) + '20' }]}>
                        <Text style={[s.stageText, { color: getStageColor(c.stage) }]}>{c.stage}</Text>
                      </View>
                    </View>
                    <View style={s.campaignProgress}>
                      <View style={[s.progressTrack, { backgroundColor: colors.inputBackground }]}>
                        <View style={[s.progressFill, { width: `${((c.dayNumber || 1) / (c.totalDays || 30)) * 100}%`, backgroundColor: getStageColor(c.stage) }]} />
                      </View>
                      <Text style={[s.progressLabel, { color: colors.textMuted }]}>Day {c.dayNumber}/{c.totalDays}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case 'pattern': return '#3B82F6';
      case 'hook': return '#EC4899';
      case 'format': return '#F59E0B';
      case 'audience': return '#10B981';
      case 'objection': return '#EF4444';
      default: return colors.textMuted;
    }
  };

  const renderInsights = () => (
    <View>
      {insights.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="bulb-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Insights Yet</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>Run AI Analysis on the Overview tab to generate pattern insights</Text>
        </View>
      ) : (
        insights.map((ins, i) => (
          <Pressable key={ins.id || i} onPress={() => setExpandedInsight(expandedInsight === i ? null : i)}>
            <View style={[s.insightCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={s.insightHeader}>
                <View style={s.insightLeft}>
                  <View style={[s.categoryBadge, { backgroundColor: getCategoryColor(ins.category) + '15' }]}>
                    <Text style={[s.categoryText, { color: getCategoryColor(ins.category) }]}>{ins.category}</Text>
                  </View>
                  <View style={[s.confidenceBadge, { backgroundColor: ins.confidence >= 0.7 ? '#10B981' + '15' : '#F59E0B' + '15' }]}>
                    <Text style={[s.confidenceText, { color: ins.confidence >= 0.7 ? '#10B981' : '#F59E0B' }]}>
                      {Math.round((ins.confidence || 0) * 100)}%
                    </Text>
                  </View>
                </View>
                <Ionicons name={expandedInsight === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
              <Text style={[s.insightText, { color: colors.text }]} numberOfLines={expandedInsight === i ? undefined : 2}>
                {ins.insight}
              </Text>
              {expandedInsight === i && ins.relatedMetric && (
                <View style={[s.metricRow, { backgroundColor: colors.background }]}>
                  <Text style={[s.metricRowLabel, { color: colors.textSecondary }]}>{ins.relatedMetric}:</Text>
                  <Text style={[s.metricRowValue, { color: colors.text }]}>{ins.metricValue?.toFixed(1)}</Text>
                  <Text style={[s.metricRowAvg, { color: colors.textMuted }]}>avg: {ins.accountAverage?.toFixed(1)}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))
      )}
    </View>
  );

  const renderDecisions = () => (
    <View>
      {decisions.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="git-branch-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Decisions Yet</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>The Decision Engine generates action items from pattern analysis</Text>
        </View>
      ) : (
        decisions.map((dec, i) => (
          <Pressable key={dec.id || i} onPress={() => setExpandedDecision(expandedDecision === i ? null : i)}>
            <View style={[s.decisionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={s.decisionHeader}>
                <View style={[s.priorityDot, { backgroundColor: getPriorityColor(dec.priority) }]} />
                <Text style={[s.decisionAction, { color: colors.text }]} numberOfLines={expandedDecision === i ? undefined : 1}>
                  {dec.action}
                </Text>
                <View style={[s.statusBadge, {
                  backgroundColor: dec.status === 'executed' ? '#10B981' + '15'
                    : dec.status === 'rejected' ? '#EF4444' + '15' : '#F59E0B' + '15'
                }]}>
                  <Text style={[s.statusText, {
                    color: dec.status === 'executed' ? '#10B981'
                      : dec.status === 'rejected' ? '#EF4444' : '#F59E0B'
                  }]}>{dec.status}</Text>
                </View>
              </View>
              {expandedDecision === i && (
                <View style={s.decisionExpanded}>
                  <Text style={[s.decisionLabel, { color: colors.textSecondary }]}>Trigger</Text>
                  <Text style={[s.decisionDetail, { color: colors.text }]}>{dec.trigger}</Text>
                  <Text style={[s.decisionLabel, { color: colors.textSecondary }]}>Reason</Text>
                  <Text style={[s.decisionDetail, { color: colors.text }]}>{dec.reason}</Text>
                  {dec.objective && (
                    <>
                      <Text style={[s.decisionLabel, { color: colors.textSecondary }]}>Objective</Text>
                      <Text style={[s.decisionDetail, { color: colors.text }]}>{dec.objective}</Text>
                    </>
                  )}
                  {dec.budgetAdjustment && (
                    <View style={[s.budgetBadge, { backgroundColor: '#F59E0B' + '10' }]}>
                      <Ionicons name="cash-outline" size={14} color="#F59E0B" />
                      <Text style={[s.budgetText, { color: '#F59E0B' }]}>{dec.budgetAdjustment}</Text>
                    </View>
                  )}
                  {dec.status === 'pending' && (
                    <View style={s.decisionActions}>
                      <Pressable onPress={() => handleUpdateDecision(dec.id, 'executed')} style={[s.decisionBtn, { backgroundColor: '#10B981' + '15' }]}>
                        <Ionicons name="checkmark" size={16} color="#10B981" />
                        <Text style={[s.decisionBtnText, { color: '#10B981' }]}>Execute</Text>
                      </Pressable>
                      <Pressable onPress={() => handleUpdateDecision(dec.id, 'rejected')} style={[s.decisionBtn, { backgroundColor: '#EF4444' + '15' }]}>
                        <Ionicons name="close" size={16} color="#EF4444" />
                        <Text style={[s.decisionBtnText, { color: '#EF4444' }]}>Reject</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        ))
      )}
    </View>
  );

  const renderMemory = () => (
    <View>
      {memoryItems.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="hardware-chip-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>Memory Bank Empty</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>The system learns from each analysis, building a knowledge base over time</Text>
        </View>
      ) : (
        <>
          <View style={s.memorySection}>
            <Text style={[s.memorySectionTitle, { color: '#10B981' }]}>
              <Ionicons name="trophy" size={16} color="#10B981" /> Winners
            </Text>
            {memoryItems.filter(m => m.isWinner).map((m, i) => (
              <View key={m.id || i} style={[s.memoryCard, { backgroundColor: '#10B981' + '08', borderColor: '#10B981' + '20' }]}>
                <View style={s.memoryHeader}>
                  <Text style={[s.memoryType, { color: '#10B981' }]}>{(m.memoryType || '').replace(/_/g, ' ')}</Text>
                  <Text style={[s.memoryScore, { color: '#10B981' }]}>{((m.score || 0) * 100).toFixed(0)}%</Text>
                </View>
                <Text style={[s.memoryLabel, { color: colors.text }]}>{m.label}</Text>
                {m.details && <Text style={[s.memoryDetails, { color: colors.textSecondary }]} numberOfLines={2}>{m.details}</Text>}
              </View>
            ))}
            {memoryItems.filter(m => m.isWinner).length === 0 && (
              <Text style={[s.noItems, { color: colors.textMuted }]}>No winners recorded yet</Text>
            )}
          </View>

          <View style={s.memorySection}>
            <Text style={[s.memorySectionTitle, { color: '#EF4444' }]}>
              <Ionicons name="flag" size={16} color="#EF4444" /> Avoid
            </Text>
            {memoryItems.filter(m => !m.isWinner).map((m, i) => (
              <View key={m.id || i} style={[s.memoryCard, { backgroundColor: '#EF4444' + '06', borderColor: '#EF4444' + '15' }]}>
                <View style={s.memoryHeader}>
                  <Text style={[s.memoryType, { color: '#EF4444' }]}>{(m.memoryType || '').replace(/_/g, ' ')}</Text>
                  <Text style={[s.memoryScore, { color: '#EF4444' }]}>{((m.score || 0) * 100).toFixed(0)}%</Text>
                </View>
                <Text style={[s.memoryLabel, { color: colors.text }]}>{m.label}</Text>
                {m.details && <Text style={[s.memoryDetails, { color: colors.textSecondary }]} numberOfLines={2}>{m.details}</Text>}
              </View>
            ))}
            {memoryItems.filter(m => !m.isWinner).length === 0 && (
              <Text style={[s.noItems, { color: colors.textMuted }]}>No items to avoid yet</Text>
            )}
          </View>
        </>
      )}
    </View>
  );

  const renderGrowth = () => (
    <View>
      <Pressable onPress={() => setShowNewCampaign(true)} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
        <LinearGradient colors={['#F59E0B', '#EF4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.newCampaignBtn}>
          <Ionicons name="add-circle-outline" size={20} color="#fff" />
          <Text style={s.newCampaignText}>New 30-Day Growth Campaign</Text>
        </LinearGradient>
      </Pressable>

      {campaigns.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="rocket-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Growth Campaigns</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>Launch a 30-day AI-managed campaign with testing, optimization, and authority phases</Text>
        </View>
      ) : (
        campaigns.map(c => (
          <View key={c.id} style={[s.growthCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={s.growthHeader}>
              <View style={s.growthLeft}>
                <GlowDot color={getStageColor(c.stage)} size={12} />
                <View>
                  <Text style={[s.growthName, { color: colors.text }]}>{c.name}</Text>
                  <Text style={[s.growthMeta, { color: colors.textSecondary }]}>
                    Day {c.dayNumber}/{c.totalDays} {c.budget > 0 ? `- $${c.budget}` : ''}
                  </Text>
                </View>
              </View>
              <View style={[s.stageBadgeLg, { backgroundColor: getStageColor(c.stage) + '15' }]}>
                <Text style={[s.stageLgText, { color: getStageColor(c.stage) }]}>
                  {c.stage?.charAt(0).toUpperCase() + c.stage?.slice(1)}
                </Text>
              </View>
            </View>

            <View style={s.growthProgress}>
              <View style={[s.progressTrackLg, { backgroundColor: colors.inputBackground }]}>
                <View style={[s.progressFillLg, { width: `${((c.dayNumber || 1) / (c.totalDays || 30)) * 100}%`, backgroundColor: getStageColor(c.stage) }]} />
              </View>
              <View style={s.phaseMarkers}>
                <Text style={[s.phaseLabel, { color: c.dayNumber <= 10 ? getStageColor('testing') : colors.textMuted }]}>Test</Text>
                <Text style={[s.phaseLabel, { color: c.dayNumber > 10 && c.dayNumber <= 20 ? getStageColor('optimization') : colors.textMuted }]}>Optimize</Text>
                <Text style={[s.phaseLabel, { color: c.dayNumber > 20 ? getStageColor('authority') : colors.textMuted }]}>Authority</Text>
              </View>
            </View>

            {c.results && (
              <Text style={[s.growthResults, { color: colors.textSecondary }]} numberOfLines={3}>
                {c.results}
              </Text>
            )}

            <Pressable
              onPress={() => handleAdvanceCampaign(c.id)}
              disabled={advancingCampaign === c.id}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: 12 }]}
            >
              <View style={[s.advanceBtn, { borderColor: getStageColor(c.stage) + '40', backgroundColor: getStageColor(c.stage) + '08' }]}>
                {advancingCampaign === c.id ? (
                  <ActivityIndicator color={getStageColor(c.stage)} size="small" />
                ) : (
                  <Ionicons name="play" size={16} color={getStageColor(c.stage)} />
                )}
                <Text style={[s.advanceBtnText, { color: getStageColor(c.stage) }]}>
                  {advancingCampaign === c.id ? 'Advancing...' : 'Advance Day'}
                </Text>
              </View>
            </Pressable>
          </View>
        ))
      )}

      <Modal visible={showNewCampaign} transparent animationType="slide" onRequestClose={() => setShowNewCampaign(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: colors.background }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>New Growth Campaign</Text>
              <Pressable onPress={() => setShowNewCampaign(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <Text style={[s.inputLabel, { color: colors.text }]}>Campaign Name</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder="e.g. Q1 Product Launch"
              placeholderTextColor={colors.textMuted}
              value={campaignName}
              onChangeText={setCampaignName}
            />
            <Text style={[s.inputLabel, { color: colors.text }]}>Budget (optional)</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder="$1000"
              placeholderTextColor={colors.textMuted}
              value={campaignBudget}
              onChangeText={setCampaignBudget}
              keyboardType="numeric"
            />
            <Pressable onPress={handleCreateCampaign} disabled={!campaignName.trim() || creatingCampaign} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: 20 }]}>
              <LinearGradient colors={!campaignName.trim() ? [colors.textMuted, colors.textMuted] : ['#F59E0B', '#EF4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.createBtn}>
                {creatingCampaign ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="rocket" size={18} color="#fff" />}
                <Text style={s.createBtnText}>{creatingCampaign ? 'Creating...' : 'Launch Campaign'}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );

  const renderReports = () => (
    <View>
      <Pressable onPress={handleGenerateReport} disabled={generatingReport} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
        <LinearGradient colors={['#06B6D4', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.genReportBtn}>
          {generatingReport ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="document-text" size={18} color="#fff" />}
          <Text style={s.genReportText}>{generatingReport ? 'Generating Report...' : 'Generate Weekly Report'}</Text>
        </LinearGradient>
      </Pressable>

      {reports.length === 0 ? (
        <View style={[s.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Reports Yet</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>Generate your first weekly strategic report to track performance trends</Text>
        </View>
      ) : (
        reports.map((r, i) => (
          <View key={r.id || i} style={[s.reportCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={s.reportHeader}>
              <Ionicons name="calendar-outline" size={16} color={colors.primary} />
              <Text style={[s.reportDate, { color: colors.text }]}>
                {new Date(r.weekStart).toLocaleDateString()} - {new Date(r.weekEnd).toLocaleDateString()}
              </Text>
            </View>
            {r.summary && <Text style={[s.reportSummary, { color: colors.textSecondary }]}>{r.summary}</Text>}

            {[
              { label: 'What Worked', value: r.whatWorked, color: '#10B981', icon: 'checkmark-circle' },
              { label: 'What Failed', value: r.whatFailed, color: '#EF4444', icon: 'close-circle' },
              { label: 'Root Cause', value: r.whyItHappened, color: '#F59E0B', icon: 'help-circle' },
              { label: 'Scale This', value: r.whatToScale, color: '#3B82F6', icon: 'trending-up' },
              { label: 'Stop This', value: r.whatToStop, color: '#EF4444', icon: 'ban' },
              { label: 'Next Week Focus', value: r.nextWeekFocus, color: '#8B5CF6', icon: 'navigate' },
            ].filter(item => item.value).map((item, j) => (
              <View key={j} style={[s.reportSection, { borderLeftColor: item.color }]}>
                <View style={s.reportSectionHeader}>
                  <Ionicons name={item.icon as any} size={14} color={item.color} />
                  <Text style={[s.reportSectionLabel, { color: item.color }]}>{item.label}</Text>
                </View>
                <Text style={[s.reportSectionText, { color: colors.text }]}>{item.value}</Text>
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );

  const renderSniper = () => (
    <View>
      {!sniperResult ? (
        <View style={[s.sniperForm, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={s.sniperFormHeader}>
            <Ionicons name="locate" size={22} color="#EF4444" />
            <Text style={[s.sniperFormTitle, { color: colors.text }]}>Audience Sniper</Text>
          </View>
          <Text style={[s.sniperFormDesc, { color: colors.textSecondary }]}>
            AI detects micro-audience segments, interest stacking strategies, and objection-handling content using your performance data
          </Text>

          <Text style={[s.inputLabel, { color: colors.text }]}>Campaign Goal</Text>
          <TextInput
            style={[s.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
            placeholder="e.g. maximize conversions for skincare launch"
            placeholderTextColor={colors.textMuted}
            value={sniperGoal}
            onChangeText={setSniperGoal}
            multiline
          />
          <Text style={[s.inputLabel, { color: colors.text }]}>Product/Service</Text>
          <TextInput
            style={[s.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
            placeholder="e.g. anti-aging serum"
            placeholderTextColor={colors.textMuted}
            value={sniperProduct}
            onChangeText={setSniperProduct}
          />
          <Text style={[s.inputLabel, { color: colors.text }]}>Budget (optional)</Text>
          <TextInput
            style={[s.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
            placeholder="$500/month"
            placeholderTextColor={colors.textMuted}
            value={sniperBudget}
            onChangeText={setSniperBudget}
          />

          <Pressable onPress={handleAudienceSnipe} disabled={!sniperGoal.trim() || sniping} style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginTop: 20 }]}>
            <LinearGradient colors={!sniperGoal.trim() ? [colors.textMuted, colors.textMuted] : ['#EF4444', '#EC4899']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sniperBtn}>
              {sniping ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="locate" size={18} color="#fff" />}
              <Text style={s.sniperBtnText}>{sniping ? 'Analyzing Audiences...' : 'Launch Sniper'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <View>
          <Pressable onPress={() => setSniperResult(null)} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[s.backBtnText, { color: colors.primary }]}>New Analysis</Text>
          </Pressable>

          {sniperResult.summary && (
            <View style={[s.sniperSummary, { backgroundColor: '#EF4444' + '08', borderColor: '#EF4444' + '20' }]}>
              <Text style={[s.sniperSummaryText, { color: colors.text }]}>{sniperResult.summary}</Text>
            </View>
          )}

          {sniperResult.microSegments?.length > 0 && (
            <View style={s.sniperSection}>
              <Text style={[s.sniperSectionTitle, { color: colors.text }]}>Micro-Segments</Text>
              {sniperResult.microSegments.map((seg: any, i: number) => (
                <View key={i} style={[s.segmentCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={s.segmentHeader}>
                    <Text style={[s.segmentName, { color: colors.text }]}>{seg.name}</Text>
                    <View style={[s.matchBadge, { backgroundColor: '#10B981' + '15' }]}>
                      <Text style={[s.matchText, { color: '#10B981' }]}>{seg.matchScore}%</Text>
                    </View>
                  </View>
                  <Text style={[s.segmentDesc, { color: colors.textSecondary }]}>{seg.description}</Text>
                  <Text style={[s.segmentSize, { color: colors.textMuted }]}>Est. size: {seg.estimatedSize}</Text>
                </View>
              ))}
            </View>
          )}

          {sniperResult.interestStacks?.length > 0 && (
            <View style={s.sniperSection}>
              <Text style={[s.sniperSectionTitle, { color: colors.text }]}>Interest Stacking</Text>
              {sniperResult.interestStacks.map((stack: any, i: number) => (
                <View key={i} style={[s.stackCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[s.stackPrimary, { color: colors.primary }]}>{stack.primary}</Text>
                  <View style={s.stackTags}>
                    {(stack.stacked || []).map((s2: string, j: number) => (
                      <View key={j} style={[s.stackTag, { backgroundColor: colors.primary + '12' }]}>
                        <Text style={[s.stackTagText, { color: colors.primary }]}>+ {s2}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[s.stackRationale, { color: colors.textSecondary }]}>{stack.rationale}</Text>
                </View>
              ))}
            </View>
          )}

          {sniperResult.objectionHandling?.length > 0 && (
            <View style={s.sniperSection}>
              <Text style={[s.sniperSectionTitle, { color: colors.text }]}>Objection Handling</Text>
              {sniperResult.objectionHandling.map((obj: any, i: number) => (
                <View key={i} style={[s.objectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[s.objectionLabel, { color: '#EF4444' }]}>"{obj.objection}"</Text>
                  <Text style={[s.objectionSuggestion, { color: colors.text }]}>{obj.contentSuggestion}</Text>
                  <View style={[s.formatBadge, { backgroundColor: '#8B5CF6' + '12' }]}>
                    <Text style={[s.formatText, { color: '#8B5CF6' }]}>{obj.format}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );

  const renderActiveView = () => {
    switch (activeView) {
      case 'overview': return renderOverview();
      case 'insights': return renderInsights();
      case 'decisions': return renderDecisions();
      case 'memory': return renderMemory();
      case 'growth': return renderGrowth();
      case 'reports': return renderReports();
      case 'sniper': return renderSniper();
    }
  };

  return (
    <View style={s.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.navBar} contentContainerStyle={s.navContent}>
        {navItems.map(item => (
          <Pressable
            key={item.key}
            onPress={() => { Haptics.selectionAsync(); setActiveView(item.key); }}
            style={[s.navItem, activeView === item.key && { backgroundColor: colors.primary + '15' }]}
          >
            <Ionicons
              name={(item.icon + (activeView === item.key ? '' : '-outline')) as any}
              size={18}
              color={activeView === item.key ? colors.primary : colors.textMuted}
            />
            <Text style={[s.navLabel, { color: activeView === item.key ? colors.primary : colors.textMuted }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
        {renderActiveView()}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  navBar: { flexGrow: 0, marginBottom: 12 },
  navContent: { paddingHorizontal: 0, gap: 6 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  navLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  body: { paddingBottom: 20 },
  centerLoad: { alignItems: 'center', paddingVertical: 60 },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  metricPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  metricValue: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  metricLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  syncCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  syncCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 14 },
  syncIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  syncInfo: { flex: 1 },
  syncTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  syncDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  halfBtn: { flex: 1 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 12, borderWidth: 1 },
  outlineBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  analyzeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  summaryCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  summaryTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  summaryText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginBottom: 12 },
  summaryStats: { flexDirection: 'row', gap: 8 },
  summaryStatBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  summaryStatText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  sectionBlock: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 10 },
  miniCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  categoryDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  miniCardText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 18 },

  campaignCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  campaignRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campaignName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  stageText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const },
  campaignProgress: { marginTop: 10 },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden' as const },
  progressFill: { height: '100%', borderRadius: 2 },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },

  emptyState: { alignItems: 'center', padding: 36, borderRadius: 16, borderWidth: 1, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' as const, lineHeight: 18 },

  insightCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  insightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  insightLeft: { flexDirection: 'row', gap: 8 },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const },
  confidenceBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  confidenceText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  insightText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 10, borderRadius: 8 },
  metricRowLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  metricRowValue: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  metricRowAvg: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  decisionCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  decisionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  decisionAction: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const },
  decisionExpanded: { marginTop: 12 },
  decisionLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 4, marginTop: 8 },
  decisionDetail: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  budgetBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, marginTop: 10 },
  budgetText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  decisionActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  decisionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  decisionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  memorySection: { marginBottom: 20 },
  memorySectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 10 },
  memoryCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  memoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  memoryType: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const },
  memoryScore: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  memoryLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  memoryDetails: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  noItems: { fontSize: 13, fontFamily: 'Inter_400Regular', fontStyle: 'italic' as const },

  newCampaignBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginBottom: 16 },
  newCampaignText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  growthCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  growthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  growthLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  growthName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  growthMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  stageBadgeLg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  stageLgText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  growthProgress: { marginTop: 14 },
  progressTrackLg: { height: 6, borderRadius: 3, overflow: 'hidden' as const },
  progressFillLg: { height: '100%', borderRadius: 3 },
  phaseMarkers: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  phaseLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  growthResults: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginTop: 10 },
  advanceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  advanceBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  genReportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginBottom: 16 },
  genReportText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  reportCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  reportDate: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  reportSummary: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginBottom: 14 },
  reportSection: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 12 },
  reportSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  reportSectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  reportSectionText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  sniperForm: { borderRadius: 16, borderWidth: 1, padding: 16 },
  sniperFormHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  sniperFormTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  sniperFormDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18, marginBottom: 16 },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 8, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  sniperBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  sniperBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  backBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  sniperSummary: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 16 },
  sniperSummaryText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  sniperSection: { marginBottom: 16 },
  sniperSectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 10 },

  segmentCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  segmentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  segmentName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
  matchBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  matchText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  segmentDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginBottom: 4 },
  segmentSize: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  stackCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  stackPrimary: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  stackTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  stackTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  stackTagText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  stackRationale: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },

  objectionCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  objectionLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', fontStyle: 'italic' as const, marginBottom: 6 },
  objectionSuggestion: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18, marginBottom: 6 },
  formatBadge: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  formatText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  createBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
