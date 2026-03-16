import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl, safeApiJson } from '@/lib/query-client';
import { useQuery } from '@tanstack/react-query';
import { useColorScheme } from 'react-native';

interface MechanismOutput {
  mechanismName: string;
  mechanismType: string;
  mechanismDescription: string;
  mechanismSteps: string[];
  mechanismPromise: string;
  mechanismProblem: string;
  mechanismLogic: string;
  axisAlignment: {
    primaryAxis: string;
    axisEmphasis: string[];
    axisConfidence: number;
  };
  structuralFrame: string;
  differentiationLink: string;
}

interface Props {
  isActive: boolean;
}

export default function MechanismEngine({ isActive }: Props) {
  const { selectedCampaignId } = useCampaign();
  const baseUrl = getApiUrl();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [analyzing, setAnalyzing] = useState(false);
  const [strategyRoot, setStrategyRoot] = useState<any>(null);

  const fetchStrategyRoot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/strategy-root/active', baseUrl);
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setStrategyRoot(json);
    } catch (err) {
      console.error('[MechanismEngine] Strategy root fetch error:', err);
    }
  }, [selectedCampaignId, baseUrl]);

  useEffect(() => {
    if (isActive && selectedCampaignId) {
      fetchStrategyRoot();
    }
  }, [isActive, selectedCampaignId, fetchStrategyRoot]);

  const { data: latestData, refetch } = useQuery({
    queryKey: ['mechanism-engine-latest', selectedCampaignId],
    enabled: !!selectedCampaignId && isActive,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(new URL(`/api/mechanism-engine/latest?campaignId=${selectedCampaignId}&accountId=default`, baseUrl).toString());
      return safeApiJson(res);
    },
  });

  const { data: diffData } = useQuery({
    queryKey: ['diff-engine-latest', selectedCampaignId],
    enabled: !!selectedCampaignId && isActive,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(new URL(`/api/differentiation-engine/latest?campaignId=${selectedCampaignId}&accountId=default`, baseUrl).toString());
      return safeApiJson(res);
    },
  });

  const hasDiffData = !!diffData?.id;

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId || !hasDiffData) return;
    setAnalyzing(true);
    try {
      const res = await fetch(new URL('/api/mechanism-engine/analyze', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaignId,
          accountId: 'default',
          differentiationSnapshotId: diffData.id,
        }),
      });
      const data = await safeApiJson(res);
      if (!res.ok) throw new Error(data.message || data.error || 'Analysis failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refetch();
      fetchStrategyRoot();
    } catch (err: any) {
      Alert.alert('Analysis Error', err.message);
    } finally {
      setAnalyzing(false);
    }
  }, [selectedCampaignId, hasDiffData, diffData, baseUrl, refetch, fetchStrategyRoot]);

  const mechanism: MechanismOutput | null = latestData?.primaryMechanism || null;
  const axisConsistency = latestData?.axisConsistency;
  const hasData = latestData?.exists && mechanism;

  const renderMechanismCard = (mech: MechanismOutput, title: string) => (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <View style={styles.cardHeader}>
        <View style={styles.mechBadge}>
          <Ionicons name="construct" size={14} color="#D946EF" />
          <Text style={styles.mechBadgeText}>{mech.mechanismType.toUpperCase()}</Text>
        </View>
        <Text style={[styles.cardTitle, isDark && styles.textLight]}>{title}</Text>
      </View>

      <Text style={[styles.mechName, isDark && styles.textLight]}>{mech.structuralFrame || mech.mechanismName}</Text>
      <Text style={[styles.mechDesc, isDark && styles.textMuted]}>{mech.mechanismDescription}</Text>

      {mech.axisAlignment && (
        <View style={styles.axisRow}>
          <View style={[styles.axisBadge, axisConsistency?.consistent ? styles.axisBadgeGreen : styles.axisBadgeAmber]}>
            <Ionicons name={axisConsistency?.consistent ? "checkmark-circle" : "warning"} size={12} color={axisConsistency?.consistent ? "#10B981" : "#F59E0B"} />
            <Text style={[styles.axisBadgeText, { color: axisConsistency?.consistent ? "#10B981" : "#F59E0B" }]}>
              {mech.axisAlignment.primaryAxis.replace(/_/g, ' ')}
            </Text>
          </View>
          {mech.axisAlignment.axisEmphasis.slice(0, 3).map((e, i) => (
            <View key={i} style={styles.emphasisTag}>
              <Text style={styles.emphasisText}>{e}</Text>
            </View>
          ))}
        </View>
      )}

      {mech.mechanismSteps.length > 0 && (
        <View style={styles.stepsSection}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>Mechanism Steps</Text>
          {mech.mechanismSteps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={[styles.stepText, isDark && styles.textLight]}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {mech.mechanismPromise && (
        <View style={styles.promiseSection}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>Promise</Text>
          <Text style={[styles.promiseText, isDark && styles.textLight]}>{mech.mechanismPromise}</Text>
        </View>
      )}

      {mech.mechanismProblem && (
        <View style={styles.promiseSection}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>Problem it Solves</Text>
          <Text style={[styles.promiseText, isDark && styles.textLight]}>{mech.mechanismProblem}</Text>
        </View>
      )}

      {mech.mechanismLogic && (
        <View style={styles.promiseSection}>
          <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>Logic</Text>
          <Text style={[styles.promiseText, isDark && styles.textLight]}>{mech.mechanismLogic}</Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <LinearGradient colors={['#D946EF', '#A855F7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <Ionicons name="construct" size={28} color="#fff" />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Mechanism Engine</Text>
            <Text style={styles.headerSubtitle}>Axis-aligned mechanism generation</Text>
          </View>
          {latestData?.engineVersion && (
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>v{latestData.engineVersion}</Text>
            </View>
          )}
        </View>
        {hasData && (
          <View style={styles.headerMeta}>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Confidence</Text>
              <Text style={styles.headerMetaValue}>{((latestData.confidenceScore || 0) * 100).toFixed(0)}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Status</Text>
              <Text style={styles.headerMetaValue}>{latestData.status}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Time</Text>
              <Text style={styles.headerMetaValue}>{latestData.executionTimeMs || 0}ms</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasDiffData && !hasData && !analyzing && (
        <View style={[styles.emptyState, isDark && styles.cardDark, { borderColor: '#F59E0B40', borderWidth: 1 }]}>
          <Ionicons name="git-branch-outline" size={48} color="#F59E0B" />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>Differentiation Engine Required</Text>
          <Text style={[styles.emptyDesc, isDark && styles.textMuted]}>
            The Mechanism Engine builds on your differentiation output. Run the Differentiation Engine in the Pipeline tab first, then return here to generate axis-aligned mechanisms.
          </Text>
        </View>
      )}

      <Pressable
        style={[styles.analyzeBtn, (analyzing || !hasDiffData) && styles.analyzeBtnDisabled]}
        onPress={runAnalysis}
        disabled={analyzing || !hasDiffData}
      >
        {analyzing ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name="flash" size={18} color="#fff" />
        )}
        <Text style={styles.analyzeBtnText}>
          {analyzing ? 'Generating Mechanism...' : !hasDiffData ? 'Waiting for Differentiation Data' : hasData ? 'Regenerate Mechanism' : 'Generate Mechanism'}
        </Text>
      </Pressable>

      {!hasData && hasDiffData && !analyzing && (
        <View style={[styles.emptyState, isDark && styles.cardDark]}>
          <Ionicons name="construct-outline" size={48} color="#D946EF" />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>Ready to Generate</Text>
          <Text style={[styles.emptyDesc, isDark && styles.textMuted]}>
            Differentiation data is available. Generate an axis-aligned mechanism that ensures strategic coherence across Hook, Outcome, Mechanism, and Proof.
          </Text>
        </View>
      )}

      {hasData && mechanism && (
        <>
          {axisConsistency && (
            <View style={[styles.consistencyBanner, axisConsistency.consistent ? styles.consistencyGreen : styles.consistencyAmber]}>
              <Ionicons
                name={axisConsistency.consistent ? "checkmark-circle" : "warning"}
                size={18}
                color={axisConsistency.consistent ? "#065F46" : "#92400E"}
              />
              <Text style={[styles.consistencyText, { color: axisConsistency.consistent ? "#065F46" : "#92400E" }]}>
                {axisConsistency.consistent
                  ? `Axis Consistent — mechanism aligned with ${axisConsistency.primaryAxis.replace(/_/g, ' ')} positioning`
                  : `Axis Warning — ${(axisConsistency.failures?.[0] && !axisConsistency.failures[0].includes('is not iterable') && !axisConsistency.failures[0].includes('Cannot read')) ? axisConsistency.failures[0] : 'mechanism may not fully align with positioning axis'}`
                }
              </Text>
            </View>
          )}

          {renderMechanismCard(mechanism, 'Primary Mechanism')}

          {latestData.alternativeMechanism && renderMechanismCard(latestData.alternativeMechanism, 'Alternative Mechanism')}

          {mechanism.differentiationLink && (
            <View style={[styles.card, isDark && styles.cardDark]}>
              <View style={styles.cardHeader}>
                <Ionicons name="link" size={14} color="#3B82F6" />
                <Text style={[styles.cardTitle, isDark && styles.textLight]}>Differentiation Link</Text>
              </View>
              <Text style={[styles.mechDesc, isDark && styles.textMuted]}>{mechanism.differentiationLink}</Text>
            </View>
          )}

          <View style={[styles.card, isDark && styles.cardDark]}>
            <View style={styles.cardHeader}>
              <Ionicons name="git-network" size={14} color="#8B5CF6" />
              <Text style={[styles.cardTitle, isDark && styles.textLight]}>Axis Propagation</Text>
            </View>
            <Text style={[styles.mechDesc, isDark && styles.textMuted]}>
              This mechanism's axis and emphasis keywords are automatically propagated to the Offer Engine for strategic coherence.
            </Text>
            <View style={styles.propChain}>
              <View style={styles.propNode}>
                <Ionicons name="layers" size={12} color="#6366F1" />
                <Text style={styles.propNodeText}>Differentiation</Text>
              </View>
              <Ionicons name="arrow-forward" size={10} color="#9CA3AF" />
              <View style={[styles.propNode, styles.propNodeActive]}>
                <Ionicons name="construct" size={12} color="#D946EF" />
                <Text style={[styles.propNodeText, { color: '#D946EF' }]}>Mechanism</Text>
              </View>
              <Ionicons name="arrow-forward" size={10} color="#9CA3AF" />
              <View style={styles.propNode}>
                <Ionicons name="pricetag" size={12} color="#F97316" />
                <Text style={styles.propNodeText}>Offers</Text>
              </View>
              <Ionicons name="arrow-forward" size={10} color="#9CA3AF" />
              <View style={styles.propNode}>
                <Ionicons name="funnel" size={12} color="#10B981" />
                <Text style={styles.propNodeText}>Funnels</Text>
              </View>
            </View>
          </View>

          {strategyRoot?.exists && (
            <View style={[styles.card, isDark && styles.cardDark]}>
              <View style={styles.cardHeader}>
                <Ionicons name="git-network" size={14} color="#06B6D4" />
                <Text style={[styles.cardTitle, isDark && styles.textLight]}>Strategy Root</Text>
                <View style={[styles.mechBadge, { backgroundColor: '#06B6D415', marginLeft: 'auto' as any }]}>
                  <Ionicons name="checkmark-circle" size={10} color="#06B6D4" />
                  <Text style={[styles.mechBadgeText, { color: '#06B6D4' }]}>ACTIVE</Text>
                </View>
              </View>
              <Text style={[styles.mechDesc, isDark && styles.textMuted]}>
                Unified source of truth binding all 5 engines. Downstream engines will reference this root for axis, mechanism, and audience alignment.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <View style={styles.emphasisTag}>
                  <Text style={styles.emphasisText}>Hash: {strategyRoot.rootHash?.substring(0, 10)}</Text>
                </View>
                <View style={styles.emphasisTag}>
                  <Text style={styles.emphasisText}>Run: {strategyRoot.runId?.split('_')[1] || '—'}</Text>
                </View>
                {strategyRoot.primaryAxis && (
                  <View style={[styles.emphasisTag, { backgroundColor: '#D946EF15' }]}>
                    <Text style={[styles.emphasisText, { color: '#D946EF' }]}>
                      {strategyRoot.primaryAxis.replace(/_/g, ' ')}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingBottom: 40 },
  headerGradient: { padding: 20, borderRadius: 16, margin: 16, marginBottom: 12 },
  headerContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  versionBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  versionText: { fontSize: 11, fontWeight: '600' as const, color: '#fff' },
  headerMeta: { flexDirection: 'row', marginTop: 12, gap: 16 },
  headerMetaItem: { flex: 1 },
  headerMetaLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  headerMetaValue: { fontSize: 14, fontWeight: '700' as const, color: '#fff' },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700' as const, color: '#fff' },
  headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#D946EF', paddingVertical: 14, borderRadius: 12, marginHorizontal: 16, marginBottom: 16 },
  analyzeBtnDisabled: { opacity: 0.6 },
  analyzeBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' as const },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardDark: { backgroundColor: '#1C1C1E' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: '600' as const, color: '#374151' },
  mechBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FAF5FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  mechBadgeText: { fontSize: 10, fontWeight: '700' as const, color: '#D946EF' },
  mechName: { fontSize: 18, fontWeight: '700' as const, color: '#111827', marginBottom: 6 },
  mechDesc: { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 12 },
  axisRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  axisBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  axisBadgeGreen: { backgroundColor: '#ECFDF5' },
  axisBadgeAmber: { backgroundColor: '#FFFBEB' },
  axisBadgeText: { fontSize: 11, fontWeight: '600' as const },
  emphasisTag: { backgroundColor: '#F3E8FF', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  emphasisText: { fontSize: 10, color: '#7C3AED', fontWeight: '500' as const },
  stepsSection: { marginTop: 4, marginBottom: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '600' as const, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#D946EF', alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 11, fontWeight: '700' as const, color: '#fff' },
  stepText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 18 },
  promiseSection: { marginTop: 4, marginBottom: 8 },
  promiseText: { fontSize: 13, color: '#374151', lineHeight: 20 },
  consistencyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 16, marginBottom: 12, borderRadius: 10 },
  consistencyGreen: { backgroundColor: '#ECFDF5' },
  consistencyAmber: { backgroundColor: '#FFFBEB' },
  consistencyText: { flex: 1, fontSize: 12, fontWeight: '500' as const },
  metaCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  metaLabel: { fontSize: 13, color: '#9CA3AF' },
  metaValue: { fontSize: 13, fontWeight: '600' as const, color: '#374151' },
  propChain: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  propNode: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  propNodeActive: { backgroundColor: '#FAF5FF', borderWidth: 1, borderColor: '#D946EF40' },
  propNodeText: { fontSize: 10, fontWeight: '600' as const, color: '#6B7280' },
  emptyState: { alignItems: 'center', padding: 32, margin: 16, backgroundColor: '#fff', borderRadius: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600' as const, color: '#374151', marginTop: 12, marginBottom: 6 },
  emptyDesc: { fontSize: 13, color: '#9CA3AF', textAlign: 'center' as const, lineHeight: 20 },
  textLight: { color: '#E5E7EB' },
  textMuted: { color: '#9CA3AF' },
});
