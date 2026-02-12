import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { MetricCard } from '@/components/MetricCard';
import { MiniChart } from '@/components/MiniChart';
import { getApiUrl } from '@/lib/query-client';

function AutopilotPulse({ color }: { color: string }) {
  const pulse = useRef(new RNAnimated.Value(0.5)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.5, duration: 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <RNAnimated.View style={[s.pulseDot, { backgroundColor: color, opacity: pulse }]} />
  );
}

export default function DashboardScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { analytics, weeklyMetrics, contentItems, campaigns, ads, scheduledPosts, metaConnection, isLoading, refreshData, advancedMode, setAdvancedMode } = useApp();

  const [showInsights, setShowInsights] = useState(false);
  const [aiActions, setAiActions] = useState<string[]>([]);
  const [todayFocus, setTodayFocus] = useState('');
  const [riskLevel, setRiskLevel] = useState<'Low' | 'Medium' | 'High'>('Low');
  const [currentObjective, setCurrentObjective] = useState('');

  const baseUrl = getApiUrl();

  const derivedMetrics = useMemo(() => {
    const spend = analytics.totalSpent || 0;
    const conversions = analytics.totalConversions || 0;
    const revenue = conversions * 45;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const cpl = conversions > 0 ? spend / conversions : 0;
    return { spend, conversions, revenue, cpa, roas, cpl };
  }, [analytics]);

  const fetchAIStatus = useCallback(async () => {
    try {
      const res = await fetch(new URL('/api/strategy/dashboard', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        const actions: string[] = [];
        if (data.recentDecisions?.length > 0) {
          data.recentDecisions.slice(0, 3).forEach((d: any) => {
            actions.push(d.description || d.action || 'Optimizing campaign performance');
          });
        }
        if (actions.length === 0) {
          actions.push('Monitoring campaign performance');
          actions.push('Analyzing audience engagement patterns');
          actions.push('Optimizing ad delivery schedule');
        }
        setAiActions(actions);

        const avgCpa = data.averages?.avgCpa || derivedMetrics.cpa;
        if (avgCpa > 20) {
          setCurrentObjective('Lower CPA by 15%');
          setRiskLevel('Medium');
          setTodayFocus('Optimizing targeting to reduce cost per lead');
        } else if (derivedMetrics.roas < 2) {
          setCurrentObjective('Increase ROAS to 2x');
          setRiskLevel('Medium');
          setTodayFocus('Scaling winning audiences safely');
        } else {
          setCurrentObjective('Maintain profitable growth');
          setRiskLevel('Low');
          setTodayFocus('Expanding reach while maintaining efficiency');
        }
      }
    } catch {
      setAiActions([
        'Monitoring campaign performance',
        'Analyzing audience engagement patterns', 
        'Optimizing ad delivery schedule',
      ]);
      setCurrentObjective('Optimize campaign ROI');
      setTodayFocus('Analyzing performance data for optimization');
      setRiskLevel('Low');
    }
  }, [baseUrl, derivedMetrics]);

  useEffect(() => {
    fetchAIStatus();
  }, []);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(0);
  };

  const formatCurrency = (num: number): string => {
    if (num >= 1000) return '$' + (num / 1000).toFixed(1) + 'K';
    return '$' + num.toFixed(2);
  };

  const riskColor = riskLevel === 'Low' ? '#10B981' : riskLevel === 'Medium' ? '#F59E0B' : '#EF4444';

  const pendingCount = scheduledPosts.filter(p => p.status === 'pending').length;
  const publishedCount = scheduledPosts.filter(p => p.status === 'published').length;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 12 : insets.top + 12 },
        ]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={() => { refreshData(); fetchAIStatus(); }} />
        }
      >
        <View style={[s.statusBar, { backgroundColor: isDark ? '#0F172A' : '#F8FAFC', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
          <View style={s.statusLeft}>
            <View style={[s.shieldBadge, { backgroundColor: '#10B981' + '15' }]}>
              <Ionicons name="shield-checkmark" size={16} color="#10B981" />
            </View>
            <View>
              <Text style={[s.statusTitle, { color: colors.text }]}>AI Agency Autopilot</Text>
              <View style={s.statusMeta}>
                <AutopilotPulse color="#10B981" />
                <Text style={[s.statusActive, { color: '#10B981' }]}>ACTIVE</Text>
                <View style={[s.riskBadge, { backgroundColor: riskColor + '15' }]}>
                  <View style={[s.riskDot, { backgroundColor: riskColor }]} />
                  <Text style={[s.riskText, { color: riskColor }]}>{riskLevel} Risk</Text>
                </View>
              </View>
            </View>
          </View>
          <Pressable onPress={() => router.push('/(tabs)/ai-management')}>
            <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        {currentObjective ? (
          <View style={[s.objectiveBar, { backgroundColor: '#8B5CF6' + '08', borderColor: '#8B5CF6' + '18' }]}>
            <Ionicons name="flag" size={14} color="#8B5CF6" />
            <Text style={[s.objectiveText, { color: colors.text }]}>{currentObjective}</Text>
          </View>
        ) : null}

        <View style={[s.mainKpi, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
          <Text style={[s.mainKpiLabel, { color: colors.textSecondary }]}>Revenue (Est.)</Text>
          <Text style={[s.mainKpiValue, { color: colors.text }]}>{formatCurrency(derivedMetrics.revenue)}</Text>
          <View style={s.mainKpiSub}>
            <Text style={[s.mainKpiSubLabel, { color: colors.textMuted }]}>Cost per Result</Text>
            <Text style={[s.mainKpiSubValue, { color: derivedMetrics.cpa < 15 ? '#10B981' : '#F59E0B' }]}>{formatCurrency(derivedMetrics.cpa)}</Text>
          </View>
        </View>

        <View style={s.smallKpis}>
          <View style={[s.smallKpi, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
            <Text style={[s.smallKpiValue, { color: colors.text }]}>{formatCurrency(derivedMetrics.spend)}</Text>
            <Text style={[s.smallKpiLabel, { color: colors.textMuted }]}>Spend</Text>
          </View>
          <View style={[s.smallKpi, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
            <Text style={[s.smallKpiValue, { color: derivedMetrics.roas >= 2 ? '#10B981' : '#F59E0B' }]}>{derivedMetrics.roas.toFixed(1)}x</Text>
            <Text style={[s.smallKpiLabel, { color: colors.textMuted }]}>ROAS</Text>
          </View>
          <View style={[s.smallKpi, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
            <Text style={[s.smallKpiValue, { color: colors.text }]}>{formatNumber(derivedMetrics.conversions)}</Text>
            <Text style={[s.smallKpiLabel, { color: colors.textMuted }]}>Results</Text>
          </View>
        </View>

        {todayFocus ? (
          <View style={[s.focusCard, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
            <View style={s.focusHeader}>
              <Ionicons name="sunny-outline" size={16} color="#F59E0B" />
              <Text style={[s.focusTitle, { color: colors.text }]}>Today's Focus</Text>
            </View>
            <Text style={[s.focusText, { color: colors.textSecondary }]}>{todayFocus}</Text>
          </View>
        ) : null}

        <View style={[s.actionsCard, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
          <View style={s.actionsHeader}>
            <View style={s.actionsHeaderLeft}>
              <Ionicons name="flash" size={16} color="#8B5CF6" />
              <Text style={[s.actionsTitle, { color: colors.text }]}>AI Actions (Last 48h)</Text>
            </View>
            <View style={[s.actionCount, { backgroundColor: '#8B5CF6' + '12' }]}>
              <Text style={[s.actionCountText, { color: '#8B5CF6' }]}>{aiActions.length}</Text>
            </View>
          </View>
          {aiActions.map((action, i) => (
            <View key={i} style={s.actionRow}>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              <Text style={[s.actionText, { color: colors.textSecondary }]}>{action}</Text>
            </View>
          ))}
        </View>

        <View style={s.quickStats}>
          <Pressable style={[s.quickStat, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]} onPress={() => router.push('/(tabs)/calendar')}>
            <Ionicons name="calendar-outline" size={20} color="#3B82F6" />
            <Text style={[s.quickStatValue, { color: colors.text }]}>{pendingCount}</Text>
            <Text style={[s.quickStatLabel, { color: colors.textMuted }]}>Queued</Text>
          </Pressable>
          <Pressable style={[s.quickStat, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]} onPress={() => router.push('/(tabs)/ai-management')}>
            <Ionicons name="checkmark-done-outline" size={20} color="#10B981" />
            <Text style={[s.quickStatValue, { color: colors.text }]}>{publishedCount}</Text>
            <Text style={[s.quickStatLabel, { color: colors.textMuted }]}>Published</Text>
          </Pressable>
          <Pressable style={[s.quickStat, { backgroundColor: isDark ? '#0F172A' : '#fff', borderColor: isDark ? '#1E293B' : '#E2E8F0' }]} onPress={() => router.push('/(tabs)/create')}>
            <Ionicons name="sparkles-outline" size={20} color="#8B5CF6" />
            <Text style={[s.quickStatValue, { color: colors.text }]}>{contentItems.length}</Text>
            <Text style={[s.quickStatLabel, { color: colors.textMuted }]}>Content</Text>
          </Pressable>
        </View>

        <View style={[s.metaRow, { 
          backgroundColor: metaConnection.isConnected ? '#10B981' + '08' : '#F59E0B' + '08',
          borderColor: metaConnection.isConnected ? '#10B981' + '20' : '#F59E0B' + '20',
        }]}>
          <View style={[s.metaDot, { backgroundColor: metaConnection.isConnected ? '#10B981' : '#F59E0B' }]} />
          <Text style={[s.metaText, { color: colors.textSecondary }]}>
            {metaConnection.isConnected ? `Meta: ${metaConnection.pageName || 'Connected'}` : 'Meta: Not connected'}
          </Text>
        </View>

        <Pressable onPress={() => setShowInsights(!showInsights)} style={[s.insightsToggle, { borderColor: isDark ? '#1E293B' : '#E2E8F0' }]}>
          <View style={s.insightsToggleLeft}>
            <Ionicons name="bar-chart-outline" size={16} color={colors.textMuted} />
            <Text style={[s.insightsToggleText, { color: colors.textMuted }]}>Insights & Advanced</Text>
          </View>
          <Ionicons name={showInsights ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
        </Pressable>

        {showInsights && (
          <View style={s.insightsSection}>
            <View style={s.metricsGrid}>
              <View style={s.metricsRow}>
                <MetricCard
                  title="Total Reach"
                  value={formatNumber(analytics.totalReach)}
                  change={analytics.reachChange}
                  icon="eye-outline"
                  isGradient
                />
                <MetricCard
                  title="Engagement"
                  value={formatNumber(analytics.totalEngagement)}
                  change={analytics.engagementChange}
                  icon="heart-outline"
                />
              </View>
            </View>
            <MiniChart 
              data={weeklyMetrics} 
              metric="reach" 
              title="Weekly Performance" 
            />
          </View>
        )}

        <View style={s.modeToggle}>
          <View style={s.modeToggleLeft}>
            <Ionicons name="options-outline" size={16} color={colors.textMuted} />
            <Text style={[s.modeToggleText, { color: colors.textMuted }]}>Advanced Mode</Text>
          </View>
          <Switch
            value={advancedMode}
            onValueChange={(v) => { setAdvancedMode(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            trackColor={{ false: isDark ? '#334155' : '#D1D5DB', true: '#8B5CF6' + '60' }}
            thumbColor={advancedMode ? '#8B5CF6' : isDark ? '#64748B' : '#9CA3AF'}
          />
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },

  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shieldBadge: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statusActive: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  riskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  riskDot: { width: 5, height: 5, borderRadius: 3 },
  riskText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },

  objectiveBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  objectiveText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  mainKpi: { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', marginBottom: 12 },
  mainKpiLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  mainKpiValue: { fontSize: 40, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  mainKpiSub: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mainKpiSubLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  mainKpiSubValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  smallKpis: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  smallKpi: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center' },
  smallKpiValue: { fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  smallKpiLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  focusCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  focusTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  focusText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },

  actionsCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  actionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  actionsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionsTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  actionCount: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  actionCountText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  actionText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 18 },

  quickStats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickStat: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center', gap: 4 },
  quickStatValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  quickStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  metaDot: { width: 6, height: 6, borderRadius: 3 },
  metaText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  insightsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  insightsToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightsToggleText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  insightsSection: { marginBottom: 12 },
  metricsGrid: { gap: 12, marginBottom: 12 },
  metricsRow: { flexDirection: 'row', gap: 12 },

  modeToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 8, marginBottom: 12 },
  modeToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeToggleText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
