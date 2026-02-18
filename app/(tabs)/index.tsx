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

const P = {
  mint: '#00D09C',
  mintDark: '#00B386',
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
  const [confidenceScore, setConfidenceScore] = useState(100);
  const [confidenceStatus, setConfidenceStatus] = useState<'Stable' | 'Caution' | 'Unstable'>('Stable');

  const headerFade = useRef(new RNAnimated.Value(0)).current;
  const cardSlide = useRef(new RNAnimated.Value(30)).current;
  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.timing(headerFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      RNAnimated.timing(cardSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
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

  const fetchConfidence = useCallback(async () => {
    try {
      const res = await fetch(new URL('/api/autopilot/status', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setConfidenceScore(data.confidenceScore ?? 100);
        const status = data.confidenceStatus ?? 'Stable';
        setConfidenceStatus(status as 'Stable' | 'Caution' | 'Unstable');
      }
    } catch {}
  }, [baseUrl]);

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
    fetchConfidence();
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

  const riskColor = riskLevel === 'Low' ? P.mint : riskLevel === 'Medium' ? P.orange : P.coral;
  const confColor = confidenceStatus === 'Stable' ? P.mint : confidenceStatus === 'Caution' ? P.orange : P.coral;

  const pendingCount = scheduledPosts.filter(p => p.status === 'pending').length;
  const publishedCount = scheduledPosts.filter(p => p.status === 'published').length;

  const bg = isDark ? P.darkBg : P.lightBg;
  const textPrimary = isDark ? P.textDarkPrimary : P.textLightPrimary;
  const textSecondary = isDark ? P.textDarkSec : P.textLightSec;
  const textMuted = isDark ? P.textDarkMuted : P.textLightMuted;
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;

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
            onRefresh={() => { refreshData(); fetchAIStatus(); fetchConfidence(); }}
            tintColor={P.mint}
          />
        }
      >
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
            <Pressable 
              onPress={() => router.push('/(tabs)/ai-management')}
              style={[s.headerBtn, { backgroundColor: isDark ? P.darkSurface : P.lightSurface }]}
            >
              <Feather name="sliders" size={18} color={textSecondary} />
            </Pressable>
          </View>
        </RNAnimated.View>

        <RNAnimated.View style={{ opacity: headerFade, transform: [{ translateY: cardSlide }] }}>
          <LinearGradient
            colors={isDark ? ['#0A2F1F', '#0C1A14', '#0F1419'] : ['#E8F5E9', '#F1F8E9', '#FFFFFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.heroCard, { borderColor: isDark ? P.mint + '18' : P.mint + '20' }]}
          >
            <View style={s.heroTop}>
              <View>
                <Text style={[s.heroLabel, { color: isDark ? P.mint : P.mintDark }]}>TOTAL REVENUE</Text>
                <Text style={[s.heroValue, { color: textPrimary }]}>{formatCurrency(derivedMetrics.revenue)}</Text>
              </View>
              <View style={[s.heroGrowth, { backgroundColor: P.mint + '15' }]}>
                <Ionicons name="arrow-up" size={14} color={P.mint} />
                <Text style={[s.heroGrowthText, { color: P.mint }]}>
                  {derivedMetrics.roas > 0 ? `${derivedMetrics.roas.toFixed(1)}x` : '0x'}
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
                <Text style={[s.heroStatValue, { color: textPrimary }]}>{formatCurrency(derivedMetrics.spend)}</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>Spent</Text>
              </View>
              <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
              <View style={s.heroStat}>
                <View style={[s.heroStatIcon, { backgroundColor: P.mint + '15' }]}>
                  <Ionicons name="flash-outline" size={14} color={P.mint} />
                </View>
                <Text style={[s.heroStatValue, { color: textPrimary }]}>{formatNumber(derivedMetrics.conversions)}</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>Results</Text>
              </View>
              <View style={[s.heroStatDivider, { backgroundColor: isDark ? '#1A2530' : '#E5EBE7' }]} />
              <View style={s.heroStat}>
                <View style={[s.heroStatIcon, { backgroundColor: P.orange + '15' }]}>
                  <Ionicons name="pricetag-outline" size={14} color={P.orange} />
                </View>
                <Text style={[s.heroStatValue, { color: derivedMetrics.cpa < 15 ? P.mint : P.orange }]}>{formatCurrency(derivedMetrics.cpa)}</Text>
                <Text style={[s.heroStatLabel, { color: textMuted }]}>CPA</Text>
              </View>
            </View>
          </LinearGradient>
        </RNAnimated.View>

        <View style={[s.autopilotStrip, { 
          backgroundColor: isDark ? P.darkCard : P.lightCard,
          borderColor: cardBorder,
        }]}>
          <View style={s.autopilotInner}>
            <View style={[s.autopilotDot, { backgroundColor: P.mint + '15' }]}>
              <PulsingDot color={P.mint} size={8} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.autopilotTopRow}>
                <Text style={[s.autopilotTitle, { color: textPrimary }]}>Autopilot Active</Text>
                <View style={[s.riskPill, { backgroundColor: riskColor + '12' }]}>
                  <View style={[s.riskDot, { backgroundColor: riskColor }]} />
                  <Text style={[s.riskText, { color: riskColor }]}>{riskLevel} Risk</Text>
                </View>
              </View>
              {currentObjective ? (
                <Text style={[s.autopilotObj, { color: textMuted }]} numberOfLines={1}>
                  {currentObjective}
                </Text>
              ) : null}
            </View>
            <View style={s.confBlock}>
              <Text style={[s.confValue, { color: confColor }]}>{confidenceScore}%</Text>
              <View style={[s.confBar, { backgroundColor: isDark ? '#1A2030' : '#E5EBE7' }]}>
                <View style={[s.confFill, { width: `${confidenceScore}%`, backgroundColor: confColor }]} />
              </View>
            </View>
          </View>
        </View>

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
              <Text style={[s.quickValue, { color: textPrimary }]}>{contentItems.length}</Text>
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
              <Text style={[s.quickValue, { color: textPrimary }]}>{pendingCount}</Text>
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
              <Text style={[s.quickValue, { color: textPrimary }]}>{publishedCount}</Text>
              <Text style={[s.quickLabel, { color: textMuted }]}>Published</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {todayFocus ? (
          <View style={[s.focusCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={s.focusRow}>
              <View style={[s.focusIcon, { backgroundColor: P.orange + '12' }]}>
                <Feather name="target" size={15} color={P.orange} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.focusTitle, { color: textPrimary }]}>Today's Focus</Text>
                <Text style={[s.focusText, { color: textSecondary }]}>{todayFocus}</Text>
              </View>
            </View>
          </View>
        ) : null}

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
            <View key={i} style={[s.aiAction, i < aiActions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? '#1A2030' : '#F0F3F1' }]}>
              <View style={[s.aiActionDot, { backgroundColor: P.mint }]} />
              <Text style={[s.aiActionText, { color: textSecondary }]}>{action}</Text>
            </View>
          ))}
        </View>

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
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 18 },

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
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  riskDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  riskText: {
    fontSize: 10,
    fontWeight: '600',
  },
  autopilotObj: {
    fontSize: 12,
    marginTop: 2,
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

  focusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  focusIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  focusTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  focusText: {
    fontSize: 13,
    lineHeight: 19,
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
