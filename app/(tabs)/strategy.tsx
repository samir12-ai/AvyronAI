import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';
import { CampaignBar, CampaignGuard } from '@/components/CampaignSelector';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Territory {
  name: string;
  opportunityScore: number;
  narrativeDistanceScore: number;
  painAlignment: string[];
  desireAlignment: string[];
  enemyDefinition: string;
  contrastAxis: string;
  narrativeDirection: string;
  isStable: boolean;
  stabilityNotes: string[];
  evidenceSignals: string[];
  confidenceScore: number;
}

interface StrategyCard {
  territoryName: string;
  enemyDefinition: string;
  narrativeDirection: string;
  evidenceSignals: string[];
  confidenceScore: number;
  isPrimary: boolean;
}

interface MarketPowerEntry {
  competitorName: string;
  authorityScore: number;
  contentDominanceScore: number;
  narrativeOwnershipIndex: number;
  engagementStrength: number;
}

interface OpportunityGap {
  territory: string;
  saturationLevel: number;
  audienceDemand: number;
  competitorAuthority: number;
  opportunityScore: number;
}

interface StabilityResult {
  isStable: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  fallbackApplied: boolean;
  fallbackReason?: string;
}

interface PositioningSnapshot {
  id: string;
  status: string;
  statusMessage: string | null;
  territory: Territory | null;
  territories: Territory[];
  strategyCards: StrategyCard[];
  marketPowerAnalysis: MarketPowerEntry[];
  opportunityGaps: OpportunityGap[];
  narrativeSaturation: Record<string, number>;
  stabilityResult: StabilityResult;
  enemyDefinition: string;
  contrastAxis: string;
  narrativeDirection: string;
  differentiationVector: string[];
  confidenceScore: number;
  inputSummary: {
    competitorCount: number;
    signalCount: number;
    executionTimeMs: number;
    flankingMode: boolean;
    detectedCategory: string;
  };
  createdAt: string;
}

function StrategyCardView({ card, colors, isDark }: { card: StrategyCard; colors: any; isDark: boolean }) {
  return (
    <View style={[styles.strategyCard, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: card.isPrimary ? colors.primary : isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      {card.isPrimary && (
        <LinearGradient colors={[colors.primary, '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primaryBadge}>
          <Text style={styles.primaryBadgeText}>PRIMARY</Text>
        </LinearGradient>
      )}
      <Text style={[styles.cardTerritory, { color: colors.text }]}>{card.territoryName}</Text>
      <View style={styles.cardSection}>
        <View style={styles.cardLabelRow}>
          <Ionicons name="flash" size={14} color={colors.primary} />
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Enemy</Text>
        </View>
        <Text style={[styles.cardValue, { color: colors.text }]}>{card.enemyDefinition}</Text>
      </View>
      <View style={styles.cardSection}>
        <View style={styles.cardLabelRow}>
          <Ionicons name="megaphone" size={14} color={colors.primary} />
          <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Narrative Direction</Text>
        </View>
        <Text style={[styles.cardValue, { color: colors.text }]}>{card.narrativeDirection}</Text>
      </View>
      {card.evidenceSignals.length > 0 && (
        <View style={styles.cardSection}>
          <View style={styles.cardLabelRow}>
            <Ionicons name="document-text" size={14} color={colors.primary} />
            <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>Evidence</Text>
          </View>
          <View style={styles.evidenceList}>
            {card.evidenceSignals.slice(0, 3).map((signal, i) => (
              <View key={i} style={[styles.evidenceChip, { backgroundColor: isDark ? '#1A2636' : '#F0F4F2' }]}>
                <Text style={[styles.evidenceText, { color: colors.textSecondary }]} numberOfLines={1}>{signal}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={styles.cardFooter}>
        <View style={[styles.confidencePill, { backgroundColor: card.confidenceScore > 0.5 ? '#10B98115' : '#F5920015' }]}>
          <Ionicons name={card.confidenceScore > 0.5 ? "checkmark-circle" : "alert-circle"} size={14} color={card.confidenceScore > 0.5 ? '#10B981' : '#F59200'} />
          <Text style={{ color: card.confidenceScore > 0.5 ? '#10B981' : '#F59200', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
            {(card.confidenceScore * 100).toFixed(0)}% confidence
          </Text>
        </View>
      </View>
    </View>
  );
}

function OpportunityRow({ gap, colors, isDark }: { gap: OpportunityGap; colors: any; isDark: boolean }) {
  const oppPct = (gap.opportunityScore * 100).toFixed(0);
  const satPct = (gap.saturationLevel * 100).toFixed(0);
  return (
    <View style={[styles.oppRow, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      <View style={styles.oppHeader}>
        <Text style={[styles.oppTerritory, { color: colors.text }]} numberOfLines={1}>{gap.territory}</Text>
        <View style={[styles.oppScore, { backgroundColor: Number(oppPct) > 50 ? '#10B98120' : '#3B82F620' }]}>
          <Text style={{ color: Number(oppPct) > 50 ? '#10B981' : '#3B82F6', fontSize: 12, fontFamily: 'Inter_700Bold' }}>{oppPct}%</Text>
        </View>
      </View>
      <View style={styles.oppMeta}>
        <Text style={[styles.oppMetaText, { color: colors.textSecondary }]}>Saturation: {satPct}%</Text>
        <Text style={[styles.oppMetaText, { color: colors.textSecondary }]}>Demand: {(gap.audienceDemand * 100).toFixed(0)}%</Text>
      </View>
    </View>
  );
}

function MarketPowerRow({ entry, colors, isDark }: { entry: MarketPowerEntry; colors: any; isDark: boolean }) {
  return (
    <View style={[styles.powerRow, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      <Text style={[styles.powerName, { color: colors.text }]} numberOfLines={1}>{entry.competitorName}</Text>
      <View style={styles.powerBars}>
        <View style={styles.powerBarGroup}>
          <Text style={[styles.powerBarLabel, { color: colors.textSecondary }]}>Authority</Text>
          <View style={[styles.powerBarTrack, { backgroundColor: isDark ? '#1A2636' : '#E8ECF0' }]}>
            <View style={[styles.powerBarFill, { width: `${Math.min(100, entry.authorityScore * 100)}%`, backgroundColor: '#3B82F6' }]} />
          </View>
        </View>
        <View style={styles.powerBarGroup}>
          <Text style={[styles.powerBarLabel, { color: colors.textSecondary }]}>Content</Text>
          <View style={[styles.powerBarTrack, { backgroundColor: isDark ? '#1A2636' : '#E8ECF0' }]}>
            <View style={[styles.powerBarFill, { width: `${Math.min(100, entry.contentDominanceScore * 100)}%`, backgroundColor: '#8B5CF6' }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

function StatusBanner({ status, message, colors, isDark }: { status: string; message: string | null; colors: any; isDark: boolean }) {
  const config: Record<string, { icon: any; bg: string; text: string }> = {
    COMPLETE: { icon: 'checkmark-circle', bg: '#10B98120', text: '#10B981' },
    UNSTABLE: { icon: 'warning', bg: '#F5920020', text: '#F59200' },
    MISSING_DEPENDENCY: { icon: 'alert-circle', bg: '#EF444420', text: '#EF4444' },
    INSUFFICIENT_SIGNALS: { icon: 'information-circle', bg: '#3B82F620', text: '#3B82F6' },
  };
  const c = config[status] || config.COMPLETE;
  return (
    <View style={[styles.statusBanner, { backgroundColor: c.bg }]}>
      <Ionicons name={c.icon as any} size={18} color={c.text} />
      <View style={styles.statusTextWrap}>
        <Text style={[styles.statusTitle, { color: c.text }]}>{status.replace(/_/g, ' ')}</Text>
        {message && <Text style={[styles.statusMessage, { color: c.text }]}>{message}</Text>}
      </View>
    </View>
  );
}

export default function StrategyScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const { t } = useLanguage();
  const { activeCampaign } = useCampaign();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const campaignId = activeCampaign?.id;

  const { data: snapshot, isLoading, refetch } = useQuery<PositioningSnapshot | null>({
    queryKey: ['positioning-latest', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/positioning-engine/latest?campaignId=${campaignId}`, getApiUrl()).toString());
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!campaignId,
  });

  const { data: miSnapshot } = useQuery<any>({
    queryKey: ['mi-latest', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/ci/mi-v3/snapshot/${campaignId}`, getApiUrl()).toString());
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!campaignId,
  });

  const { data: audienceSnapshot } = useQuery<any>({
    queryKey: ['audience-latest', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/audience-engine/latest?campaignId=${campaignId}`, getApiUrl()).toString());
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!campaignId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (!campaignId) throw new Error('No campaign selected');
      if (!miSnapshot?.id) throw new Error('Run Market Intelligence first');
      if (!audienceSnapshot?.id) throw new Error('Run Audience Engine first');

      const res = await fetch(new URL('/api/positioning-engine/analyze', getApiUrl()).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          miSnapshotId: miSnapshot.id,
          audienceSnapshotId: audienceSnapshot.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(err.error || 'Analysis failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positioning-latest', campaignId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => {
      Alert.alert('Positioning Error', err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const hasDependencies = !!miSnapshot?.id && !!audienceSnapshot?.id;

  return (
    <CampaignGuard>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: isWeb ? 67 + 12 : insets.top + 12 }]}>
          <CampaignBar />
          <Text style={[styles.title, { color: colors.text }]}>Positioning Strategy</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>AI-powered strategic territory analysis</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 34 + 20 : insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {!hasDependencies && (
            <View style={[styles.depWarning, { backgroundColor: isDark ? '#1A1A2E' : '#FFF8E1' }]}>
              <Ionicons name="link" size={20} color="#F59200" />
              <View style={styles.depWarningText}>
                <Text style={[styles.depTitle, { color: colors.text }]}>Dependencies Required</Text>
                <Text style={[styles.depDetail, { color: colors.textSecondary }]}>
                  {!miSnapshot?.id ? '• Run Market Intelligence first\n' : ''}
                  {!audienceSnapshot?.id ? '• Run Audience Engine first' : ''}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            style={[styles.analyzeButton, { opacity: (!hasDependencies || analyzeMutation.isPending) ? 0.5 : 1 }]}
            onPress={() => analyzeMutation.mutate()}
            disabled={!hasDependencies || analyzeMutation.isPending}
          >
            <LinearGradient colors={[colors.primary, '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.analyzeGradient}>
              {analyzeMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons name="compass" size={20} color="#FFFFFF" />
              )}
              <Text style={styles.analyzeText}>
                {analyzeMutation.isPending ? 'Analyzing...' : snapshot ? 'Re-analyze Positioning' : 'Run Positioning Engine'}
              </Text>
            </LinearGradient>
          </Pressable>

          {isLoading && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}

          {snapshot && (
            <>
              <StatusBanner status={snapshot.status} message={snapshot.statusMessage} colors={colors} isDark={isDark} />

              {snapshot.inputSummary && (
                <View style={[styles.metaRow, { backgroundColor: isDark ? '#141C28' : '#F8FAF9' }]}>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaValue, { color: colors.text }]}>{snapshot.inputSummary.detectedCategory}</Text>
                    <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Category</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaValue, { color: colors.text }]}>{snapshot.inputSummary.competitorCount}</Text>
                    <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Competitors</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaValue, { color: colors.text }]}>{snapshot.inputSummary.signalCount}</Text>
                    <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Signals</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={[styles.metaValue, { color: colors.text }]}>{snapshot.inputSummary.flankingMode ? 'Yes' : 'No'}</Text>
                    <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Flanking</Text>
                  </View>
                </View>
              )}

              {snapshot.strategyCards.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Strategy Cards</Text>
                  {snapshot.strategyCards.map((card, i) => (
                    <StrategyCardView key={i} card={card} colors={colors} isDark={isDark} />
                  ))}
                </View>
              )}

              {snapshot.opportunityGaps.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Opportunity Gaps</Text>
                  {snapshot.opportunityGaps.slice(0, 6).map((gap, i) => (
                    <OpportunityRow key={i} gap={gap} colors={colors} isDark={isDark} />
                  ))}
                </View>
              )}

              {snapshot.marketPowerAnalysis.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Market Power Analysis</Text>
                  {snapshot.marketPowerAnalysis.slice(0, 5).map((entry, i) => (
                    <MarketPowerRow key={i} entry={entry} colors={colors} isDark={isDark} />
                  ))}
                </View>
              )}

              {snapshot.stabilityResult && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Stability Guard</Text>
                  <View style={[styles.stabilityCard, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
                    <View style={styles.stabilityHeader}>
                      <Ionicons
                        name={snapshot.stabilityResult.isStable ? "shield-checkmark" : "shield-half"}
                        size={20}
                        color={snapshot.stabilityResult.isStable ? '#10B981' : '#F59200'}
                      />
                      <Text style={[styles.stabilityTitle, { color: snapshot.stabilityResult.isStable ? '#10B981' : '#F59200' }]}>
                        {snapshot.stabilityResult.isStable ? 'Stable Positioning' : 'Stability Concerns'}
                      </Text>
                    </View>
                    {snapshot.stabilityResult.fallbackApplied && (
                      <Text style={[styles.fallbackNote, { color: '#F59200' }]}>{snapshot.stabilityResult.fallbackReason}</Text>
                    )}
                    {snapshot.stabilityResult.checks?.slice(0, 6).map((check, i) => (
                      <View key={i} style={styles.checkRow}>
                        <Ionicons name={check.passed ? "checkmark-circle" : "close-circle"} size={16} color={check.passed ? '#10B981' : '#EF4444'} />
                        <Text style={[styles.checkText, { color: colors.textSecondary }]} numberOfLines={2}>{check.name}: {check.detail}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {snapshot.differentiationVector && snapshot.differentiationVector.length > 0 && (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Differentiation Axes</Text>
                  <View style={styles.axisWrap}>
                    {snapshot.differentiationVector.map((axis, i) => (
                      <View key={i} style={[styles.axisPill, { backgroundColor: isDark ? '#1A2636' : '#E8F5E9' }]}>
                        <Ionicons name="locate" size={14} color={colors.primary} />
                        <Text style={[styles.axisText, { color: colors.text }]}>{axis.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}

          {!isLoading && !snapshot && hasDependencies && (
            <View style={styles.emptyState}>
              <Ionicons name="compass-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Positioning Data Yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Run the positioning engine to discover strategic territories and build your strategy cards.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </CampaignGuard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 12 },
  subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  depWarning: { borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  depWarningText: { flex: 1 },
  depTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  depDetail: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  analyzeButton: { marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  analyzeGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 8 },
  analyzeText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  statusBanner: { borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  statusTextWrap: { flex: 1 },
  statusTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  statusMessage: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  metaRow: { flexDirection: 'row', borderRadius: 12, padding: 14, marginBottom: 16, justifyContent: 'space-between' },
  metaItem: { alignItems: 'center', flex: 1 },
  metaValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  metaLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 10 },
  strategyCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  primaryBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 10 },
  primaryBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  cardTerritory: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  cardSection: { marginBottom: 12 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  evidenceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  evidenceChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '48%' as any },
  evidenceText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  cardFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  confidencePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  oppRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  oppHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oppTerritory: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1, marginRight: 8 },
  oppScore: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  oppMeta: { flexDirection: 'row', gap: 16, marginTop: 6 },
  oppMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  powerRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  powerName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  powerBars: { gap: 6 },
  powerBarGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  powerBarLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', width: 60 },
  powerBarTrack: { flex: 1, height: 6, borderRadius: 3 },
  powerBarFill: { height: 6, borderRadius: 3 },
  stabilityCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  stabilityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  stabilityTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  fallbackNote: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  checkText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  axisWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  axisPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  axisText: { fontSize: 13, fontFamily: 'Inter_500Medium', textTransform: 'capitalize' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
