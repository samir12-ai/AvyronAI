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
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { MetricCard } from '@/components/MetricCard';
import { MiniChart } from '@/components/MiniChart';
import { getApiUrl } from '@/lib/query-client';

const { width: SCREEN_W } = Dimensions.get('window');

const LUX = {
  gold: '#C9A84C',
  goldLight: '#E8D48B',
  goldDim: '#A68A3E',
  champagne: '#F5E6C8',
  obsidian: '#0A0A0F',
  charcoal: '#141419',
  slate: '#1C1C24',
  graphite: '#26262F',
  silver: '#8E8E9A',
  platinum: '#C4C4CC',
  emerald: '#34D399',
  ruby: '#F87171',
  amber: '#FBBF24',
  sapphire: '#60A5FA',
  cardDark: '#16161E',
  cardLight: '#FFFFFF',
  bgLight: '#F7F5F0',
  textLight: '#2D2A26',
  textLightSec: '#6B6560',
  textLightMuted: '#A09A92',
  cardBorderLight: '#E8E2D8',
};

function GlowDot({ color, size = 8 }: { color: string; size?: number }) {
  const pulse = useRef(new RNAnimated.Value(0.4)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 0.4, duration: 1500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <RNAnimated.View style={{
        width: size + 8,
        height: size + 8,
        borderRadius: (size + 8) / 2,
        backgroundColor: color + '20',
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

function LuxKpiCard({ label, value, valueColor, icon, iconColor, onPress, isDark }: {
  label: string;
  value: string;
  valueColor?: string;
  icon: string;
  iconColor: string;
  onPress?: () => void;
  isDark: boolean;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper 
      style={[s.luxKpi, { 
        backgroundColor: isDark ? LUX.cardDark : LUX.cardLight,
        borderColor: isDark ? LUX.graphite : LUX.cardBorderLight,
      }]}
      {...(onPress ? { onPress } : {})}
    >
      <View style={[s.luxKpiIconWrap, { backgroundColor: iconColor + '12' }]}>
        <Ionicons name={icon as any} size={16} color={iconColor} />
      </View>
      <Text style={[s.luxKpiValue, { color: valueColor || (isDark ? LUX.platinum : LUX.textLight) }]}>{value}</Text>
      <Text style={[s.luxKpiLabel, { color: isDark ? LUX.silver : LUX.textLightMuted }]}>{label}</Text>
    </Wrapper>
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

  const headerFade = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    RNAnimated.timing(headerFade, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []);

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

  const riskColor = riskLevel === 'Low' ? LUX.emerald : riskLevel === 'Medium' ? LUX.amber : LUX.ruby;

  const pendingCount = scheduledPosts.filter(p => p.status === 'pending').length;
  const publishedCount = scheduledPosts.filter(p => p.status === 'published').length;

  const bg = isDark ? LUX.obsidian : LUX.bgLight;
  const textPrimary = isDark ? '#F0ECE3' : LUX.textLight;
  const textSecondary = isDark ? LUX.silver : LUX.textLightSec;
  const textMuted = isDark ? '#5A5A66' : LUX.textLightMuted;
  const cardBg = isDark ? LUX.cardDark : LUX.cardLight;
  const cardBorder = isDark ? LUX.graphite : LUX.cardBorderLight;
  const goldAccent = isDark ? LUX.gold : LUX.goldDim;

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
            refreshing={isLoading} 
            onRefresh={() => { refreshData(); fetchAIStatus(); }}
            tintColor={goldAccent}
          />
        }
      >
        <RNAnimated.View style={{ opacity: headerFade }}>
          <View style={s.headerRow}>
            <View>
              <Text style={[s.brandName, { color: textPrimary }]}>MarketMind</Text>
              <Text style={[s.brandSub, { color: goldAccent }]}>AI AGENCY</Text>
            </View>
            <Pressable 
              onPress={() => router.push('/(tabs)/ai-management')}
              style={[s.headerBtn, { backgroundColor: isDark ? LUX.slate : '#F0EBE1' }]}
            >
              <Feather name="sliders" size={18} color={textSecondary} />
            </Pressable>
          </View>

          <View style={[s.autopilotBar, { 
            backgroundColor: isDark ? LUX.slate + 'CC' : '#F0EBE1',
            borderColor: isDark ? goldAccent + '30' : goldAccent + '25',
          }]}>
            <View style={s.autopilotLeft}>
              <View style={[s.shieldWrap, { backgroundColor: LUX.emerald + '15' }]}>
                <Ionicons name="shield-checkmark" size={18} color={LUX.emerald} />
              </View>
              <View>
                <Text style={[s.autopilotTitle, { color: textPrimary }]}>Autopilot</Text>
                <View style={s.autopilotMeta}>
                  <GlowDot color={LUX.emerald} size={6} />
                  <Text style={[s.autopilotStatus, { color: LUX.emerald }]}>ACTIVE</Text>
                  <View style={s.dividerDot} />
                  <View style={[s.riskPill, { backgroundColor: riskColor + '15' }]}>
                    <View style={[s.riskDotInner, { backgroundColor: riskColor }]} />
                    <Text style={[s.riskLabel, { color: riskColor }]}>{riskLevel}</Text>
                  </View>
                </View>
              </View>
            </View>
            {currentObjective ? (
              <View style={[s.objectivePill, { backgroundColor: isDark ? LUX.graphite : '#E8E2D8' }]}>
                <Ionicons name="flag" size={11} color={goldAccent} />
                <Text style={[s.objectiveText, { color: textSecondary }]} numberOfLines={1}>{currentObjective}</Text>
              </View>
            ) : null}
          </View>
        </RNAnimated.View>

        <LinearGradient
          colors={isDark ? [LUX.charcoal, LUX.slate + '80'] : ['#FEFCF8', '#F5F0E6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.revenueCard, { borderColor: isDark ? goldAccent + '20' : goldAccent + '18' }]}
        >
          <View style={s.revenueTop}>
            <View style={[s.revenueIconWrap, { backgroundColor: goldAccent + '15' }]}>
              <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={20} color={goldAccent} />
            </View>
            <Text style={[s.revenueLabel, { color: textSecondary }]}>ESTIMATED REVENUE</Text>
          </View>
          <Text style={[s.revenueValue, { color: textPrimary }]}>{formatCurrency(derivedMetrics.revenue)}</Text>
          <View style={s.revenueDivider}>
            <View style={[s.dividerLine, { backgroundColor: isDark ? LUX.graphite : '#E8E2D8' }]} />
          </View>
          <View style={s.revenueBottom}>
            <View style={s.revenueSubItem}>
              <Text style={[s.revenueSubLabel, { color: textMuted }]}>Cost / Result</Text>
              <Text style={[s.revenueSubValue, { color: derivedMetrics.cpa < 15 ? LUX.emerald : LUX.amber }]}>
                {formatCurrency(derivedMetrics.cpa)}
              </Text>
            </View>
            <View style={[s.revenueSubDivider, { backgroundColor: isDark ? LUX.graphite : '#E0DAD0' }]} />
            <View style={s.revenueSubItem}>
              <Text style={[s.revenueSubLabel, { color: textMuted }]}>ROAS</Text>
              <Text style={[s.revenueSubValue, { color: derivedMetrics.roas >= 2 ? LUX.emerald : LUX.amber }]}>
                {derivedMetrics.roas.toFixed(1)}x
              </Text>
            </View>
          </View>
        </LinearGradient>

        <View style={s.kpiRow}>
          <LuxKpiCard 
            label="Spend" 
            value={formatCurrency(derivedMetrics.spend)} 
            icon="trending-down-outline"
            iconColor={LUX.sapphire}
            isDark={isDark}
          />
          <LuxKpiCard 
            label="Results" 
            value={formatNumber(derivedMetrics.conversions)} 
            icon="pulse-outline"
            iconColor={LUX.emerald}
            isDark={isDark}
          />
          <LuxKpiCard 
            label="Content" 
            value={String(contentItems.length)} 
            icon="sparkles-outline"
            iconColor={goldAccent}
            onPress={() => router.push('/(tabs)/create')}
            isDark={isDark}
          />
        </View>

        {todayFocus ? (
          <View style={[s.focusCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={s.focusHeader}>
              <View style={[s.focusIconWrap, { backgroundColor: LUX.amber + '12' }]}>
                <Feather name="target" size={14} color={LUX.amber} />
              </View>
              <Text style={[s.focusTitle, { color: textPrimary }]}>Today's Priority</Text>
            </View>
            <Text style={[s.focusText, { color: textSecondary }]}>{todayFocus}</Text>
          </View>
        ) : null}

        <View style={[s.actionsCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={s.actionsHeader}>
            <View style={s.actionsLeft}>
              <View style={[s.actionsIconWrap, { backgroundColor: isDark ? '#8B5CF6' + '12' : '#8B5CF6' + '08' }]}>
                <Ionicons name="flash" size={14} color="#8B5CF6" />
              </View>
              <Text style={[s.actionsTitle, { color: textPrimary }]}>AI Actions</Text>
              <Text style={[s.actions48h, { color: textMuted }]}>48h</Text>
            </View>
            <View style={[s.actionBadge, { backgroundColor: '#8B5CF6' + '12' }]}>
              <Text style={[s.actionBadgeText, { color: '#8B5CF6' }]}>{aiActions.length}</Text>
            </View>
          </View>
          {aiActions.map((action, i) => (
            <View key={i} style={[s.actionItem, i < aiActions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? LUX.graphite : '#F0EBE1' }]}>
              <View style={[s.actionDot, { backgroundColor: LUX.emerald }]} />
              <Text style={[s.actionText, { color: textSecondary }]}>{action}</Text>
            </View>
          ))}
        </View>

        <View style={s.quickNav}>
          <Pressable 
            style={[s.quickNavItem, { backgroundColor: cardBg, borderColor: cardBorder }]} 
            onPress={() => router.push('/(tabs)/calendar')}
          >
            <View style={[s.quickNavIcon, { backgroundColor: LUX.sapphire + '12' }]}>
              <Ionicons name="calendar-outline" size={18} color={LUX.sapphire} />
            </View>
            <View>
              <Text style={[s.quickNavValue, { color: textPrimary }]}>{pendingCount}</Text>
              <Text style={[s.quickNavLabel, { color: textMuted }]}>Queued</Text>
            </View>
          </Pressable>
          <Pressable 
            style={[s.quickNavItem, { backgroundColor: cardBg, borderColor: cardBorder }]} 
            onPress={() => router.push('/(tabs)/ai-management')}
          >
            <View style={[s.quickNavIcon, { backgroundColor: LUX.emerald + '12' }]}>
              <Ionicons name="checkmark-done-outline" size={18} color={LUX.emerald} />
            </View>
            <View>
              <Text style={[s.quickNavValue, { color: textPrimary }]}>{publishedCount}</Text>
              <Text style={[s.quickNavLabel, { color: textMuted }]}>Published</Text>
            </View>
          </Pressable>
        </View>

        <View style={[s.metaStrip, { 
          backgroundColor: metaConnection.isConnected 
            ? (isDark ? LUX.emerald + '08' : LUX.emerald + '06')
            : (isDark ? LUX.amber + '08' : LUX.amber + '06'),
          borderColor: metaConnection.isConnected 
            ? LUX.emerald + '18'
            : LUX.amber + '18',
        }]}>
          <GlowDot color={metaConnection.isConnected ? LUX.emerald : LUX.amber} size={6} />
          <Text style={[s.metaText, { color: textSecondary }]}>
            {metaConnection.isConnected ? `Meta Connected  \u00B7  ${metaConnection.pageName || 'Active'}` : 'Meta  \u00B7  Not connected'}
          </Text>
        </View>

        <Pressable 
          onPress={() => { setShowInsights(!showInsights); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} 
          style={[s.insightsToggle, { 
            backgroundColor: cardBg, 
            borderColor: showInsights ? goldAccent + '30' : cardBorder 
          }]}
        >
          <View style={s.insightsToggleLeft}>
            <Feather name="bar-chart-2" size={15} color={goldAccent} />
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

        <View style={[s.modeRow, { borderColor: cardBorder }]}>
          <View style={s.modeLeft}>
            <View style={[s.modeIcon, { backgroundColor: isDark ? '#8B5CF6' + '10' : '#8B5CF6' + '08' }]}>
              <Ionicons name="options-outline" size={14} color="#8B5CF6" />
            </View>
            <Text style={[s.modeLabel, { color: textSecondary }]}>Advanced Mode</Text>
          </View>
          <Switch
            value={advancedMode}
            onValueChange={(v) => { setAdvancedMode(v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            trackColor={{ false: isDark ? '#2A2A35' : '#D8D2C8', true: goldAccent + '50' }}
            thumbColor={advancedMode ? goldAccent : isDark ? '#5A5A66' : '#B0AAA0'}
          />
        </View>

        <View style={{ height: Platform.OS === 'web' ? 34 + 60 : 100 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 2,
  },
  brandName: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '600',
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

  autopilotBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  autopilotLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shieldWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  autopilotTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  autopilotMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  autopilotStatus: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  dividerDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#5A5A66',
    marginHorizontal: 2,
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  riskDotInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  riskLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  objectivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: 130,
  },
  objectiveText: {
    fontSize: 10,
    fontWeight: '500',
    flex: 1,
  },

  revenueCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    marginBottom: 14,
  },
  revenueTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  revenueIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revenueLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
  },
  revenueValue: {
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1.5,
    marginBottom: 14,
  },
  revenueDivider: {
    marginBottom: 14,
  },
  dividerLine: {
    height: StyleSheet.hairlineWidth,
  },
  revenueBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  revenueSubItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  revenueSubLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  revenueSubValue: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  revenueSubDivider: {
    width: 1,
    height: 28,
  },

  kpiRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  luxKpi: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  luxKpiIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  luxKpiValue: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  luxKpiLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },

  focusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  focusIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  focusText: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    paddingLeft: 38,
  },

  actionsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },
  actionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  actionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  actions48h: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  actionBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 9,
  },
  actionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '400',
    flex: 1,
    lineHeight: 18,
  },

  quickNav: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  quickNavItem: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickNavIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickNavValue: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  quickNavLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginTop: 1,
  },

  metaStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
  },

  insightsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 12,
  },
  insightsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
