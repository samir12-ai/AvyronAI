import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';
import { useColorScheme } from 'react-native';

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

export default function PositioningStrategy() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaignId } = useCampaign();

  const [snapshot, setSnapshot] = useState<PositioningSnapshot | null>(null);
  const [miSnapshot, setMiSnapshot] = useState<any>(null);
  const [audienceSnapshot, setAudienceSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const baseUrl = getApiUrl();
      const [posRes, miRes, audRes] = await Promise.all([
        fetch(new URL(`/api/positioning-engine/latest?campaignId=${selectedCampaignId}`, baseUrl).toString()),
        fetch(new URL(`/api/ci/mi-v3/snapshot/${selectedCampaignId}`, baseUrl).toString()),
        fetch(new URL(`/api/audience-engine/latest?campaignId=${selectedCampaignId}`, baseUrl).toString()),
      ]);
      if (posRes.ok) { const d = await posRes.json(); setSnapshot(d); }
      if (miRes.ok) { const d = await miRes.json(); setMiSnapshot(d?.snapshot || d); }
      if (audRes.ok) { const d = await audRes.json(); setAudienceSnapshot(d); }
    } catch {}
    setLoading(false);
  }, [selectedCampaignId]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasMI = !!miSnapshot?.id;
  const hasAudience = !!audienceSnapshot?.id;
  const hasDependencies = hasMI && hasAudience;

  const runAnalysis = async () => {
    if (!selectedCampaignId || !hasDependencies) return;
    setAnalyzing(true);
    try {
      const res = await fetch(new URL('/api/positioning-engine/analyze', getApiUrl()).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaignId,
          miSnapshotId: miSnapshot.id,
          audienceSnapshotId: audienceSnapshot.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
        throw new Error(err.error || 'Analysis failed');
      }
      const data = await res.json();
      setSnapshot(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Positioning Error', err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    setAnalyzing(false);
  };

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.depRow}>
        <View style={[s.depChip, { backgroundColor: hasMI ? '#10B98118' : '#EF444418' }]}>
          <Ionicons name={hasMI ? "checkmark-circle" : "close-circle"} size={14} color={hasMI ? '#10B981' : '#EF4444'} />
          <Text style={[s.depText, { color: hasMI ? '#10B981' : '#EF4444' }]}>MI v3</Text>
        </View>
        <View style={[s.depChip, { backgroundColor: hasAudience ? '#10B98118' : '#EF444418' }]}>
          <Ionicons name={hasAudience ? "checkmark-circle" : "close-circle"} size={14} color={hasAudience ? '#10B981' : '#EF4444'} />
          <Text style={[s.depText, { color: hasAudience ? '#10B981' : '#EF4444' }]}>Audience v3</Text>
        </View>
        <View style={[s.depChip, { backgroundColor: snapshot ? '#10B98118' : '#3B82F618' }]}>
          <Ionicons name={snapshot ? "checkmark-circle" : "ellipse-outline"} size={14} color={snapshot ? '#10B981' : '#3B82F6'} />
          <Text style={[s.depText, { color: snapshot ? '#10B981' : '#3B82F6' }]}>Positioning</Text>
        </View>
      </View>

      <Pressable
        style={[s.analyzeButton, { opacity: (!hasDependencies || analyzing) ? 0.5 : 1 }]}
        onPress={runAnalysis}
        disabled={!hasDependencies || analyzing}
      >
        <LinearGradient colors={[colors.primary, '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.analyzeGradient}>
          {analyzing ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="compass" size={18} color="#FFFFFF" />
          )}
          <Text style={s.analyzeText}>
            {analyzing ? 'Analyzing...' : snapshot ? 'Re-analyze Positioning' : 'Run Positioning Engine'}
          </Text>
        </LinearGradient>
      </Pressable>

      {!hasDependencies && (
        <View style={[s.depWarning, { backgroundColor: isDark ? '#1A1A2E' : '#FFF8E1' }]}>
          <Ionicons name="link" size={18} color="#F59200" />
          <Text style={[s.depWarningText, { color: colors.textSecondary }]}>
            {!hasMI ? 'Run Market Intelligence (Intelligence tab) first. ' : ''}
            {!hasAudience ? 'Run Audience Engine (Audience tab) first.' : ''}
          </Text>
        </View>
      )}

      {snapshot && (
        <>
          <StatusBanner status={snapshot.status} message={snapshot.statusMessage} colors={colors} isDark={isDark} />

          {snapshot.inputSummary && (
            <View style={[s.metaRow, { backgroundColor: isDark ? '#141C28' : '#F8FAF9' }]}>
              <MetaItem label="Category" value={snapshot.inputSummary.detectedCategory} colors={colors} />
              <MetaItem label="Competitors" value={String(snapshot.inputSummary.competitorCount)} colors={colors} />
              <MetaItem label="Signals" value={String(snapshot.inputSummary.signalCount)} colors={colors} />
              <MetaItem label="Flanking" value={snapshot.inputSummary.flankingMode ? 'Yes' : 'No'} colors={colors} />
            </View>
          )}

          {snapshot.strategyCards.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Strategy Cards</Text>
              {snapshot.strategyCards.map((card, i) => (
                <StrategyCardView key={i} card={card} colors={colors} isDark={isDark} />
              ))}
            </View>
          )}

          {snapshot.opportunityGaps.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Opportunity Gaps</Text>
              {snapshot.opportunityGaps.slice(0, 6).map((gap, i) => (
                <OpportunityRow key={i} gap={gap} colors={colors} isDark={isDark} />
              ))}
            </View>
          )}

          {snapshot.marketPowerAnalysis.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Market Power</Text>
              {snapshot.marketPowerAnalysis.slice(0, 5).map((entry, i) => (
                <MarketPowerRow key={i} entry={entry} colors={colors} isDark={isDark} />
              ))}
            </View>
          )}

          {snapshot.stabilityResult && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Stability Guard</Text>
              <View style={[s.stabilityCard, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
                <View style={s.stabilityHeader}>
                  <Ionicons
                    name={snapshot.stabilityResult.isStable ? "shield-checkmark" : "shield-half"}
                    size={18}
                    color={snapshot.stabilityResult.isStable ? '#10B981' : '#F59200'}
                  />
                  <Text style={{ color: snapshot.stabilityResult.isStable ? '#10B981' : '#F59200', fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
                    {snapshot.stabilityResult.isStable ? 'Stable Positioning' : 'Stability Concerns'}
                  </Text>
                </View>
                {snapshot.stabilityResult.fallbackApplied && (
                  <Text style={{ color: '#F59200', fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 6 }}>{snapshot.stabilityResult.fallbackReason}</Text>
                )}
                {snapshot.stabilityResult.checks?.slice(0, 6).map((check, i) => (
                  <View key={i} style={s.checkRow}>
                    <Ionicons name={check.passed ? "checkmark-circle" : "close-circle"} size={14} color={check.passed ? '#10B981' : '#EF4444'} />
                    <Text style={[s.checkText, { color: colors.textSecondary }]} numberOfLines={2}>{check.name}: {check.detail}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {snapshot.differentiationVector && snapshot.differentiationVector.length > 0 && (
            <View style={s.section}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Differentiation Axes</Text>
              <View style={s.axisWrap}>
                {snapshot.differentiationVector.map((axis, i) => (
                  <View key={i} style={[s.axisPill, { backgroundColor: isDark ? '#1A2636' : '#E8F5E9' }]}>
                    <Ionicons name="locate" size={13} color={colors.primary} />
                    <Text style={[s.axisText, { color: colors.text }]}>{axis.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      {!snapshot && hasDependencies && (
        <View style={s.emptyState}>
          <Ionicons name="compass-outline" size={40} color={colors.textSecondary} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Positioning Data</Text>
          <Text style={[s.emptySubtitle, { color: colors.textSecondary }]}>
            Run the positioning engine to discover strategic territories.
          </Text>
        </View>
      )}
    </View>
  );
}

function MetaItem({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={s.metaItem}>
      <Text style={[s.metaValue, { color: colors.text }]}>{value}</Text>
      <Text style={[s.metaLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function StatusBanner({ status, message, colors, isDark }: { status: string; message: string | null; colors: any; isDark: boolean }) {
  const cfg: Record<string, { icon: any; bg: string; text: string }> = {
    COMPLETE: { icon: 'checkmark-circle', bg: '#10B98120', text: '#10B981' },
    UNSTABLE: { icon: 'warning', bg: '#F5920020', text: '#F59200' },
    MISSING_DEPENDENCY: { icon: 'alert-circle', bg: '#EF444420', text: '#EF4444' },
    INSUFFICIENT_SIGNALS: { icon: 'information-circle', bg: '#3B82F620', text: '#3B82F6' },
  };
  const c = cfg[status] || cfg.COMPLETE;
  return (
    <View style={[s.statusBanner, { backgroundColor: c.bg }]}>
      <Ionicons name={c.icon as any} size={16} color={c.text} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{status.replace(/_/g, ' ')}</Text>
        {message && <Text style={{ color: c.text, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 }}>{message}</Text>}
      </View>
    </View>
  );
}

function StrategyCardView({ card, colors, isDark }: { card: StrategyCard; colors: any; isDark: boolean }) {
  return (
    <View style={[s.strategyCard, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: card.isPrimary ? colors.primary : isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      {card.isPrimary && (
        <LinearGradient colors={[colors.primary, '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.primaryBadge}>
          <Text style={s.primaryBadgeText}>PRIMARY</Text>
        </LinearGradient>
      )}
      <Text style={[s.cardTerritory, { color: colors.text }]}>{card.territoryName}</Text>
      <View style={s.cardSection}>
        <View style={s.cardLabelRow}>
          <Ionicons name="flash" size={13} color={colors.primary} />
          <Text style={[s.cardLabel, { color: colors.textSecondary }]}>Enemy</Text>
        </View>
        <Text style={[s.cardValue, { color: colors.text }]}>{card.enemyDefinition}</Text>
      </View>
      <View style={s.cardSection}>
        <View style={s.cardLabelRow}>
          <Ionicons name="megaphone" size={13} color={colors.primary} />
          <Text style={[s.cardLabel, { color: colors.textSecondary }]}>Narrative</Text>
        </View>
        <Text style={[s.cardValue, { color: colors.text }]}>{card.narrativeDirection}</Text>
      </View>
      {card.evidenceSignals.length > 0 && (
        <View style={s.cardSection}>
          <View style={s.cardLabelRow}>
            <Ionicons name="document-text" size={13} color={colors.primary} />
            <Text style={[s.cardLabel, { color: colors.textSecondary }]}>Evidence</Text>
          </View>
          <View style={s.evidenceList}>
            {card.evidenceSignals.slice(0, 3).map((sig, i) => (
              <View key={i} style={[s.evidenceChip, { backgroundColor: isDark ? '#1A2636' : '#F0F4F2' }]}>
                <Text style={[s.evidenceText, { color: colors.textSecondary }]} numberOfLines={1}>{sig}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={s.cardFooter}>
        <View style={[s.confidencePill, { backgroundColor: card.confidenceScore > 0.5 ? '#10B98115' : '#F5920015' }]}>
          <Ionicons name={card.confidenceScore > 0.5 ? "checkmark-circle" : "alert-circle"} size={13} color={card.confidenceScore > 0.5 ? '#10B981' : '#F59200'} />
          <Text style={{ color: card.confidenceScore > 0.5 ? '#10B981' : '#F59200', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
            {(card.confidenceScore * 100).toFixed(0)}%
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
    <View style={[s.oppRow, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      <View style={s.oppHeader}>
        <Text style={[s.oppTerritory, { color: colors.text }]} numberOfLines={1}>{gap.territory}</Text>
        <View style={[s.oppScore, { backgroundColor: Number(oppPct) > 50 ? '#10B98120' : '#3B82F620' }]}>
          <Text style={{ color: Number(oppPct) > 50 ? '#10B981' : '#3B82F6', fontSize: 11, fontFamily: 'Inter_700Bold' }}>{oppPct}%</Text>
        </View>
      </View>
      <View style={s.oppMeta}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>Sat: {satPct}%</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: 'Inter_400Regular' }}>Demand: {(gap.audienceDemand * 100).toFixed(0)}%</Text>
      </View>
    </View>
  );
}

function MarketPowerRow({ entry, colors, isDark }: { entry: MarketPowerEntry; colors: any; isDark: boolean }) {
  return (
    <View style={[s.powerRow, { backgroundColor: isDark ? '#141C28' : '#FFFFFF', borderColor: isDark ? '#1E2A3A' : '#E8ECF0' }]}>
      <Text style={[s.powerName, { color: colors.text }]} numberOfLines={1}>{entry.competitorName}</Text>
      <View style={s.powerBars}>
        <View style={s.powerBarGroup}>
          <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: 'Inter_400Regular', width: 55 }}>Authority</Text>
          <View style={[s.powerBarTrack, { backgroundColor: isDark ? '#1A2636' : '#E8ECF0' }]}>
            <View style={[s.powerBarFill, { width: `${Math.min(100, entry.authorityScore * 100)}%`, backgroundColor: '#3B82F6' }]} />
          </View>
        </View>
        <View style={s.powerBarGroup}>
          <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: 'Inter_400Regular', width: 55 }}>Content</Text>
          <View style={[s.powerBarTrack, { backgroundColor: isDark ? '#1A2636' : '#E8ECF0' }]}>
            <View style={[s.powerBarFill, { width: `${Math.min(100, entry.contentDominanceScore * 100)}%`, backgroundColor: '#8B5CF6' }]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { paddingTop: 4 },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  depRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  depChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  depText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  analyzeButton: { marginBottom: 12, borderRadius: 10, overflow: 'hidden' },
  analyzeGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  analyzeText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  depWarning: { borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  depWarningText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  statusBanner: { borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  metaRow: { flexDirection: 'row', borderRadius: 10, padding: 12, marginBottom: 14, justifyContent: 'space-between' },
  metaItem: { alignItems: 'center', flex: 1 },
  metaValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  metaLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  strategyCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  primaryBadge: { alignSelf: 'flex-start', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8 },
  primaryBadgeText: { color: '#FFFFFF', fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  cardTerritory: { fontSize: 15, fontFamily: 'Inter_700Bold', marginBottom: 10 },
  cardSection: { marginBottom: 10 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  cardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  evidenceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 3 },
  evidenceChip: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '48%' as any },
  evidenceText: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  cardFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 },
  confidencePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  oppRow: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 6 },
  oppHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  oppTerritory: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1, marginRight: 8 },
  oppScore: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  oppMeta: { flexDirection: 'row', gap: 14, marginTop: 4 },
  powerRow: { borderRadius: 8, borderWidth: 1, padding: 10, marginBottom: 6 },
  powerName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  powerBars: { gap: 4 },
  powerBarGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  powerBarTrack: { flex: 1, height: 5, borderRadius: 3 },
  powerBarFill: { height: 5, borderRadius: 3 },
  stabilityCard: { borderRadius: 10, borderWidth: 1, padding: 12 },
  stabilityHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 5 },
  checkText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1 },
  axisWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  axisPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  axisText: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'capitalize' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptySubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 260, lineHeight: 18 },
});
