import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, useColorScheme, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl , authFetch } from '@/lib/query-client';
const P = {
  mint: '#34D399',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  purple: '#8B5CF6',
  orange: '#FF9500',
};

interface MechanismData {
  name: string;
  explanation: string;
}

interface FunnelData {
  top: string;
  middle: string;
  bottom: string;
}

interface ContentDnaData {
  weeklyStructure: { reels: number; carousels: number; stories: number };
  contentTypes: { problems: string; proof: string; education: string; conversion: string };
  contentAngles?: string[];
  hookStyles?: string[];
  messagingThemes?: string[];
  contentMixRatio?: { problemAgitation: number; mechanismEducation: number; proof: number; conversion: number };
  rhythmReasoning?: string;
}

interface ExecutionActionsData {
  daily: string[];
  weekly: string[];
  biweekly: string[];
}

interface KpiRulesData {
  postingFrequency: string;
  contentMix: string;
  conversionTargets: string;
}

interface BuildPlanData {
  positioning: string;
  differentiation: string;
  mechanism: MechanismData;
  offer: string;
  funnel: FunnelData;
  contentDna: ContentDnaData;
  executionActions?: ExecutionActionsData;
  kpiRules: KpiRulesData;
}

interface BuildPlanResponse {
  status: string;
  plan: BuildPlanData | null;
  actionabilityScore: number;
  failedBlocks: string[];
  attempts: number;
  error?: string;
}

interface CardConfig {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradient: [string, string];
}

const PLAN_CARDS: CardConfig[] = [
  { key: 'positioning', title: 'Positioning', icon: 'compass-outline', gradient: ['#6366F1', '#8B5CF6'] },
  { key: 'differentiation', title: 'Differentiation', icon: 'diamond-outline', gradient: ['#EC4899', '#F43F5E'] },
  { key: 'mechanism', title: 'Mechanism', icon: 'cog-outline', gradient: ['#F59E0B', '#F97316'] },
  { key: 'offer', title: 'Offer', icon: 'gift-outline', gradient: ['#10B981', '#34D399'] },
  { key: 'funnel', title: 'Funnel', icon: 'funnel-outline', gradient: ['#3B82F6', '#6366F1'] },
  { key: 'contentDna', title: 'Content DNA', icon: 'color-palette-outline', gradient: ['#8B5CF6', '#A78BFA'] },
  { key: 'executionActions', title: 'Do This Today', icon: 'flash-outline', gradient: ['#EF4444', '#F97316'] },
  { key: 'kpiRules', title: 'Targets & Schedule', icon: 'checkmark-circle-outline', gradient: ['#14B8A6', '#10B981'] },
];

function PlanCard({ config, plan, isDark }: { config: CardConfig; plan: BuildPlanData; isDark: boolean }) {
  const cardBg = isDark ? '#151B24' : '#FFFFFF';
  const textPrimary = isDark ? '#E8ECF0' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const borderColor = isDark ? '#1E2736' : '#E5E7EB';

  const renderContent = () => {
    switch (config.key) {
      case 'positioning':
        return <Text style={[s.cardValue, { color: textPrimary }]}>{plan.positioning}</Text>;

      case 'differentiation':
        return <Text style={[s.cardValue, { color: textPrimary }]}>{plan.differentiation}</Text>;

      case 'mechanism':
        return (
          <View>
            <Text style={[s.mechanismName, { color: textPrimary }]}>{plan.mechanism.name}</Text>
            <Text style={[s.cardValue, { color: textSecondary }]}>{plan.mechanism.explanation}</Text>
          </View>
        );

      case 'offer':
        return <Text style={[s.cardValue, { color: textPrimary }]}>{plan.offer}</Text>;

      case 'funnel':
        return (
          <View style={s.funnelContainer}>
            <View style={s.funnelStep}>
              <View style={[s.funnelDot, { backgroundColor: '#3B82F6' }]} />
              <View style={s.funnelContent}>
                <Text style={[s.funnelLabel, { color: textSecondary }]}>TOP — Attention</Text>
                <Text style={[s.funnelText, { color: textPrimary }]}>{plan.funnel.top}</Text>
              </View>
            </View>
            <View style={[s.funnelLine, { backgroundColor: borderColor }]} />
            <View style={s.funnelStep}>
              <View style={[s.funnelDot, { backgroundColor: '#8B5CF6' }]} />
              <View style={s.funnelContent}>
                <Text style={[s.funnelLabel, { color: textSecondary }]}>MIDDLE — Trust</Text>
                <Text style={[s.funnelText, { color: textPrimary }]}>{plan.funnel.middle}</Text>
              </View>
            </View>
            <View style={[s.funnelLine, { backgroundColor: borderColor }]} />
            <View style={s.funnelStep}>
              <View style={[s.funnelDot, { backgroundColor: '#10B981' }]} />
              <View style={s.funnelContent}>
                <Text style={[s.funnelLabel, { color: textSecondary }]}>BOTTOM — Conversion</Text>
                <Text style={[s.funnelText, { color: textPrimary }]}>{plan.funnel.bottom}</Text>
              </View>
            </View>
          </View>
        );

      case 'contentDna': {
        const ws = plan.contentDna.weeklyStructure;
        const ct = plan.contentDna.contentTypes;
        const angles = plan.contentDna.contentAngles || [];
        const hooks = plan.contentDna.hookStyles || [];
        const themes = plan.contentDna.messagingThemes || [];
        const mix = plan.contentDna.contentMixRatio;
        const rhythmReasoning = plan.contentDna.rhythmReasoning;
        return (
          <View>
            <View style={s.dnaGrid}>
              <View style={[s.dnaCell, { backgroundColor: isDark ? '#1E2736' : '#F3F4F6' }]}>
                <Text style={[s.dnaCellNum, { color: P.purple }]}>{ws.reels}</Text>
                <Text style={[s.dnaCellLabel, { color: textSecondary }]}>Reels/wk</Text>
              </View>
              <View style={[s.dnaCell, { backgroundColor: isDark ? '#1E2736' : '#F3F4F6' }]}>
                <Text style={[s.dnaCellNum, { color: P.blue }]}>{ws.carousels}</Text>
                <Text style={[s.dnaCellLabel, { color: textSecondary }]}>Carousels/wk</Text>
              </View>
              <View style={[s.dnaCell, { backgroundColor: isDark ? '#1E2736' : '#F3F4F6' }]}>
                <Text style={[s.dnaCellNum, { color: P.mint }]}>{ws.stories}</Text>
                <Text style={[s.dnaCellLabel, { color: textSecondary }]}>Stories/wk</Text>
              </View>
            </View>
            {!!rhythmReasoning && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 2 }}>
                <Ionicons name="analytics-outline" size={12} color={textSecondary} />
                <Text style={{ fontSize: 11, color: textSecondary, flex: 1, lineHeight: 16 }}>{rhythmReasoning}</Text>
              </View>
            )}
            {mix && (
              <View style={[s.mixBar, { backgroundColor: isDark ? '#1E2736' : '#F3F4F6', marginTop: 10, borderRadius: 8, padding: 10 }]}>
                <Text style={[s.dnaCellLabel, { color: textSecondary, marginBottom: 6, fontWeight: '600' as const }]}>Content Mix</Text>
                <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ flex: mix.problemAgitation, backgroundColor: P.coral }} />
                  <View style={{ flex: mix.mechanismEducation, backgroundColor: P.blue }} />
                  <View style={{ flex: mix.proof, backgroundColor: P.mint }} />
                  <View style={{ flex: mix.conversion, backgroundColor: P.gold }} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 8 }}>
                  <Text style={{ fontSize: 10, color: P.coral }}>{mix.problemAgitation}% Problem</Text>
                  <Text style={{ fontSize: 10, color: P.blue }}>{mix.mechanismEducation}% Education</Text>
                  <Text style={{ fontSize: 10, color: P.mint }}>{mix.proof}% Proof</Text>
                  <Text style={{ fontSize: 10, color: P.gold }}>{mix.conversion}% Conversion</Text>
                </View>
              </View>
            )}
            <View style={s.dnaTypes}>
              <DnaTypeRow icon="alert-circle-outline" label="Problems" value={ct.problems} color={P.coral} textColor={textPrimary} subColor={textSecondary} />
              <DnaTypeRow icon="shield-checkmark-outline" label="Proof" value={ct.proof} color={P.mint} textColor={textPrimary} subColor={textSecondary} />
              <DnaTypeRow icon="school-outline" label="Education" value={ct.education} color={P.blue} textColor={textPrimary} subColor={textSecondary} />
              <DnaTypeRow icon="cart-outline" label="Conversion" value={ct.conversion} color={P.gold} textColor={textPrimary} subColor={textSecondary} />
            </View>
            {angles.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={[s.dnaCellLabel, { color: textSecondary, fontWeight: '600' as const, marginBottom: 4 }]}>Content Angles</Text>
                {angles.map((a, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
                    <Ionicons name="arrow-forward-outline" size={12} color={P.purple} style={{ marginTop: 3, marginRight: 6 }} />
                    <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{a}</Text>
                  </View>
                ))}
              </View>
            )}
            {hooks.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={[s.dnaCellLabel, { color: textSecondary, fontWeight: '600' as const, marginBottom: 4 }]}>Hook Styles</Text>
                {hooks.map((h, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
                    <Ionicons name="flash-outline" size={12} color={P.orange} style={{ marginTop: 3, marginRight: 6 }} />
                    <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{h}</Text>
                  </View>
                ))}
              </View>
            )}
            {themes.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={[s.dnaCellLabel, { color: textSecondary, fontWeight: '600' as const, marginBottom: 4 }]}>Messaging Themes</Text>
                {themes.map((t, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 }}>
                    <Ionicons name="chatbubble-outline" size={12} color={P.blue} style={{ marginTop: 3, marginRight: 6 }} />
                    <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      }

      case 'executionActions': {
        const actions = plan.executionActions;
        if (!actions) return <Text style={[s.cardValue, { color: textSecondary }]}>Run the plan to see your daily actions</Text>;
        const accentColor = isDark ? '#1E2736' : '#FEF2F2';
        return (
          <View>
            <View style={[{ backgroundColor: accentColor, borderRadius: 8, padding: 10, marginBottom: 8 }]}>
              <Text style={[s.dnaCellLabel, { color: P.coral, fontWeight: '700' as const, marginBottom: 6 }]}>DAILY</Text>
              {actions.daily.map((a, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Ionicons name="checkbox-outline" size={14} color={P.coral} style={{ marginTop: 2, marginRight: 6 }} />
                  <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{a}</Text>
                </View>
              ))}
            </View>
            <View style={[{ backgroundColor: isDark ? '#1E2736' : '#EFF6FF', borderRadius: 8, padding: 10, marginBottom: 8 }]}>
              <Text style={[s.dnaCellLabel, { color: P.blue, fontWeight: '700' as const, marginBottom: 6 }]}>WEEKLY</Text>
              {actions.weekly.map((a, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Ionicons name="checkbox-outline" size={14} color={P.blue} style={{ marginTop: 2, marginRight: 6 }} />
                  <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{a}</Text>
                </View>
              ))}
            </View>
            <View style={[{ backgroundColor: isDark ? '#1E2736' : '#F0FDF4', borderRadius: 8, padding: 10 }]}>
              <Text style={[s.dnaCellLabel, { color: P.mint, fontWeight: '700' as const, marginBottom: 6 }]}>EVERY 2 WEEKS</Text>
              {actions.biweekly.map((a, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Ionicons name="checkbox-outline" size={14} color={P.mint} style={{ marginTop: 2, marginRight: 6 }} />
                  <Text style={[s.dnaTypeValue, { color: textPrimary, flex: 1 }]}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      }

      case 'kpiRules':
        return (
          <View style={s.kpiContainer}>
            <KpiRow icon="time-outline" label="Schedule" value={plan.kpiRules.postingFrequency} textColor={textPrimary} subColor={textSecondary} />
            <KpiRow icon="pie-chart-outline" label="Content Split" value={plan.kpiRules.contentMix} textColor={textPrimary} subColor={textSecondary} />
            <KpiRow icon="trending-up-outline" label="Targets" value={plan.kpiRules.conversionTargets} textColor={textPrimary} subColor={textSecondary} />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor }]}>
      <View style={s.cardHeader}>
        <LinearGradient colors={config.gradient} style={s.cardIconBg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Ionicons name={config.icon} size={16} color="#FFF" />
        </LinearGradient>
        <Text style={[s.cardTitle, { color: textPrimary }]}>{config.title}</Text>
      </View>
      <View style={s.cardBody}>
        {renderContent()}
      </View>
    </View>
  );
}

function DnaTypeRow({ icon, label, value, color, textColor, subColor }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string; textColor: string; subColor: string }) {
  return (
    <View style={s.dnaTypeRow}>
      <Ionicons name={icon} size={14} color={color} style={s.dnaTypeIcon} />
      <View style={s.dnaTypeContent}>
        <Text style={[s.dnaTypeLabel, { color: subColor }]}>{label}</Text>
        <Text style={[s.dnaTypeValue, { color: textColor }]}>{value}</Text>
      </View>
    </View>
  );
}

function KpiRow({ icon, label, value, textColor, subColor }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; textColor: string; subColor: string }) {
  return (
    <View style={s.kpiRow}>
      <Ionicons name={icon} size={16} color={P.mint} style={s.kpiIcon} />
      <View style={s.kpiContent}>
        <Text style={[s.kpiLabel, { color: subColor }]}>{label}</Text>
        <Text style={[s.kpiValue, { color: textColor }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function ExecutionPlan({ onPlanGenerated }: { onPlanGenerated?: () => void } = {}) {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const { selectedCampaignId } = useCampaign();
  const [plan, setPlan] = useState<BuildPlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const bg = isDark ? '#0D1117' : '#F8FAFB';
  const textPrimary = isDark ? '#E8ECF0' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const surfaceBg = isDark ? '#151B24' : '#FFFFFF';
  const borderColor = isDark ? '#1E2736' : '#E5E7EB';

  const loadLatestPlan = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/build-plan-layer/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const resp = await authFetch(url.toString());
      if (!resp.ok) return;
      const data: BuildPlanResponse = await resp.json();
      if ((data.status === 'SUCCESS' || data.status === 'ACTIONABILITY_FAILED') && data.plan) {
        setPlan(data.plan);
        setStatus(data.status);
        if (data.status === 'ACTIONABILITY_FAILED') {
          setError(`Some decisions need more specificity (${data.failedBlocks?.join(', ') || 'unknown'})`);
        }
      }
    } catch {}
  }, [selectedCampaignId]);

  useEffect(() => {
    if (selectedCampaignId) {
      loadLatestPlan();
    }
  }, [selectedCampaignId, loadLatestPlan]);

  const generatePlan = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    setStatus(null);

    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const url = new URL('/api/build-plan-layer/generate', getApiUrl());
      const resp = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId,  }),
      });

      const data: BuildPlanResponse = await resp.json();
      setStatus(data.status);

      if (data.status === 'SUCCESS' && data.plan) {
        setPlan(data.plan);
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onPlanGenerated?.();
      } else if (data.status === 'ACTIONABILITY_FAILED' && data.plan) {
        setPlan(data.plan);
        setError(`Some decisions need more specificity (${data.failedBlocks.join(', ')})`);
        onPlanGenerated?.();
      } else if (data.status === 'INSUFFICIENT_DATA') {
        setError(data.error || 'Not enough engine data. Run the strategy engines first.');
      } else {
        setError(data.error || 'Failed to generate execution plan');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  if (!selectedCampaignId) {
    return null;
  }

  return (
    <View style={[s.container, { backgroundColor: bg }]}>
      <View style={[s.header, { borderBottomColor: borderColor }]}>
        <View style={s.headerLeft}>
          <LinearGradient colors={['#6366F1', '#8B5CF6']} style={s.headerIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name="rocket-outline" size={18} color="#FFF" />
          </LinearGradient>
          <View>
            <Text style={[s.headerTitle, { color: textPrimary }]}>Execution Plan</Text>
            <Text style={[s.headerSub, { color: textSecondary }]}>Clear decisions — ready to execute</Text>
          </View>
        </View>
      </View>

      {!plan && !loading && !error && (
        <View style={[s.emptyState, { backgroundColor: surfaceBg, borderColor }]}>
          <Ionicons name="bulb-outline" size={32} color={P.purple} />
          <Text style={[s.emptyTitle, { color: textPrimary }]}>Generate Your Execution Plan</Text>
          <Text style={[s.emptyDesc, { color: textSecondary }]}>
            Convert all strategy engine outputs into clear, actionable decisions and daily actions
          </Text>
          <Pressable onPress={generatePlan} style={s.generateBtn}>
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={s.generateBtnInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Ionicons name="flash-outline" size={18} color="#FFF" />
              <Text style={s.generateBtnText}>Generate Plan</Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {loading && (
        <View style={[s.loadingState, { backgroundColor: surfaceBg, borderColor }]}>
          <ActivityIndicator size="large" color={P.purple} />
          <Text style={[s.loadingText, { color: textSecondary }]}>Building execution plan from engine outputs...</Text>
        </View>
      )}

      {error && (
        <View style={[s.errorState, { backgroundColor: surfaceBg, borderColor: P.coral + '30' }]}>
          <Ionicons name="warning-outline" size={20} color={P.coral} />
          <Text style={[s.errorText, { color: P.coral }]}>{error}</Text>
          {status !== 'INSUFFICIENT_DATA' && (
            <Pressable onPress={generatePlan} style={s.retryBtn}>
              <Text style={[s.retryText, { color: P.purple }]}>Retry</Text>
            </Pressable>
          )}
        </View>
      )}

      {plan && (
        <View style={s.planCards}>
          {PLAN_CARDS.map(cardConfig => (
            <PlanCard key={cardConfig.key} config={cardConfig} plan={plan} isDark={isDark} />
          ))}

          <Pressable onPress={() => router.push('/(tabs)/calendar')} style={s.calendarCta}>
            <LinearGradient colors={['#10B981', '#34D399']} style={s.calendarCtaInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Ionicons name="calendar-outline" size={20} color="#FFF" />
              <Text style={s.calendarCtaText}>Generate Calendar</Text>
              <Ionicons name="arrow-forward" size={18} color="#FFF" />
            </LinearGradient>
          </Pressable>

          <Pressable onPress={generatePlan} style={[s.regenerateBtn, { borderColor }]}>
            <Ionicons name="refresh-outline" size={16} color={textSecondary} />
            <Text style={[s.regenerateText, { color: textSecondary }]}>Regenerate Plan</Text>
          </Pressable>
        </View>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  container: { marginTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' as const },
  headerSub: { fontSize: 12, marginTop: 1 },
  emptyState: { margin: 16, padding: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600' as const },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },
  generateBtn: { marginTop: 8, borderRadius: 10, overflow: 'hidden' },
  generateBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  generateBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' as const },
  loadingState: { margin: 16, padding: 32, borderRadius: 14, borderWidth: 1, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13 },
  errorState: { margin: 16, padding: 16, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  errorText: { fontSize: 13, flex: 1 },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { fontSize: 13, fontWeight: '600' as const },
  planCards: { padding: 16, gap: 12 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, paddingBottom: 8 },
  cardIconBg: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '600' as const },
  cardBody: { paddingHorizontal: 14, paddingBottom: 14 },
  cardValue: { fontSize: 14, lineHeight: 20 },
  mechanismName: { fontSize: 15, fontWeight: '700' as const, marginBottom: 4 },
  funnelContainer: { gap: 0 },
  funnelStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  funnelDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  funnelContent: { flex: 1 },
  funnelLabel: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.5, marginBottom: 2 },
  funnelText: { fontSize: 13, lineHeight: 18 },
  funnelLine: { width: 1, height: 12, marginLeft: 4.5 },
  dnaGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  dnaCell: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center' },
  dnaCellNum: { fontSize: 22, fontWeight: '700' as const },
  dnaCellLabel: { fontSize: 10, marginTop: 2 },
  mixBar: {},
  dnaTypes: { gap: 10 },
  dnaTypeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dnaTypeIcon: { marginTop: 2 },
  dnaTypeContent: { flex: 1 },
  dnaTypeLabel: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3, marginBottom: 1 },
  dnaTypeValue: { fontSize: 13, lineHeight: 18 },
  kpiContainer: { gap: 12 },
  kpiRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  kpiIcon: { marginTop: 2 },
  kpiContent: { flex: 1 },
  kpiLabel: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3, marginBottom: 2 },
  kpiValue: { fontSize: 13, lineHeight: 18 },
  calendarCta: { borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  calendarCtaInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: 12 },
  calendarCtaText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  regenerateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderWidth: 1, borderRadius: 10 },
  regenerateText: { fontSize: 13 },
});
