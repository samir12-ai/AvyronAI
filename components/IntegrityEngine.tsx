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
import { getApiUrl, safeApiJson, authFetch } from '@/lib/query-client';
import { useColorScheme } from 'react-native';

interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

interface IntegrityData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  overallIntegrityScore?: number;
  safeToExecute?: boolean;
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  flaggedInconsistencies?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  engineVersion?: number;
  executionTimeMs?: number;
  createdAt?: string;
}

const LAYER_LABELS: Record<string, string> = {
  strategic_consistency: "Strategic Consistency",
  audience_offer_alignment: "Audience–Offer Alignment",
  positioning_differentiation_compatibility: "Positioning–Differentiation",
  offer_funnel_compatibility: "Offer–Funnel Compatibility",
  trust_path_continuity: "Trust Path Continuity",
  proof_sufficiency: "Proof Sufficiency",
  conversion_feasibility: "Conversion Feasibility",
  system_coherence: "System Coherence",
};

const LAYER_ICONS: Record<string, string> = {
  strategic_consistency: "git-compare",
  audience_offer_alignment: "people",
  positioning_differentiation_compatibility: "swap-horizontal",
  offer_funnel_compatibility: "git-network",
  trust_path_continuity: "shield-checkmark",
  proof_sufficiency: "document-text",
  conversion_feasibility: "trending-up",
  system_coherence: "analytics",
};

export default function IntegrityEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<IntegrityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [funnelSnapshotId, setFunnelSnapshotId] = useState<string | null>(null);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/integrity-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await authFetch(url.toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch (err) {
      console.error('[IntegrityEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchFunnelSnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/funnel-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await authFetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.id) {
        setFunnelSnapshotId(json.id);
      }
    } catch (err) {
      console.error('[IntegrityEngine] Funnel snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchFunnelSnapshot();
    }
  }, [isActive, fetchLatest, fetchFunnelSnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) {
      Alert.alert('No Campaign', 'Please select a campaign first.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/integrity-engine/analyze', getApiUrl());
      const body: any = { campaignId: selectedCampaignId };
      if (funnelSnapshotId) body.funnelSnapshotId = funnelSnapshotId;
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await fetchLatest();
      } else {
        Alert.alert('Analysis Failed', json.message || json.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedCampaignId, funnelSnapshotId, fetchLatest]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderLayerCard = (layer: LayerResult) => {
    const isExpanded = expandedLayer === layer.layerName;
    const icon = LAYER_ICONS[layer.layerName] || "checkmark-circle";
    const label = LAYER_LABELS[layer.layerName] || layer.layerName;
    const statusColor = layer.passed ? '#10B981' : '#EF4444';
    const scorePercent = Math.round(layer.score * 100);

    return (
      <View key={layer.layerName} style={[styles.layerCard, { backgroundColor: colors.card, borderColor: statusColor + '30' }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setExpandedLayer(isExpanded ? null : layer.layerName);
          }}
          style={styles.layerHeader}
        >
          <View style={styles.layerHeaderLeft}>
            <View style={[styles.layerStatusDot, { backgroundColor: statusColor }]} />
            <Ionicons name={icon as any} size={16} color={statusColor} />
            <Text style={[styles.layerLabel, { color: colors.text }]}>{label}</Text>
          </View>
          <View style={styles.layerHeaderRight}>
            <Text style={[styles.layerScore, { color: scoreColor(layer.score) }]}>{scorePercent}%</Text>
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={styles.layerDetails}>
            <View style={[styles.scoreBarBg, { backgroundColor: colors.cardBorder }]}>
              <View style={[styles.scoreBarFill, { width: `${scorePercent}%`, backgroundColor: scoreColor(layer.score) }]} />
            </View>

            {layer.findings.length > 0 && (
              <View style={styles.layerSection}>
                <Text style={[styles.layerSectionTitle, { color: '#10B981' }]}>Findings</Text>
                {layer.findings.map((f, i) => (
                  <View key={i} style={styles.findingRow}>
                    <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                    <Text style={[styles.findingText, { color: colors.textSecondary }]}>{f}</Text>
                  </View>
                ))}
              </View>
            )}

            {layer.warnings.length > 0 && (
              <View style={styles.layerSection}>
                <Text style={[styles.layerSectionTitle, { color: '#F59E0B' }]}>Warnings</Text>
                {layer.warnings.map((w, i) => (
                  <View key={i} style={styles.findingRow}>
                    <Ionicons name="warning" size={12} color="#F59E0B" />
                    <Text style={[styles.findingText, { color: colors.textSecondary }]}>{w}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const hasData = data?.exists && data.layerResults;
  const safeToExecute = data?.safeToExecute;
  const passedLayers = data?.layerResults?.filter(l => l.passed).length || 0;
  const totalLayers = data?.layerResults?.length || 8;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#6366F1', '#4F46E5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="shield" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Integrity Engine V3</Text>
          </View>
          {data?.engineVersion && (
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>v{data.engineVersion}</Text>
            </View>
          )}
        </View>
        {hasData && (
          <View style={styles.headerMeta}>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Integrity</Text>
              <Text style={styles.headerMetaValue}>{Math.round((data.overallIntegrityScore || 0) * 100)}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Layers</Text>
              <Text style={styles.headerMetaValue}>{passedLayers}/{totalLayers}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Status</Text>
              <Text style={styles.headerMetaValue}>
                {safeToExecute ? 'SAFE' : 'REVIEW'}
              </Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {hasData && (
        <View style={[styles.executionStatus, {
          backgroundColor: safeToExecute ? '#10B98110' : '#EF444410',
          borderColor: safeToExecute ? '#10B98130' : '#EF444430',
        }]}>
          <Ionicons
            name={safeToExecute ? "checkmark-shield" : "alert-circle"}
            size={20}
            color={safeToExecute ? '#10B981' : '#EF4444'}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.executionStatusTitle, {
              color: safeToExecute ? '#10B981' : '#EF4444'
            }]}>
              {safeToExecute ? 'Safe to Execute' : 'Review Required'}
            </Text>
            <Text style={[styles.executionStatusDesc, { color: colors.textSecondary }]}>
              {safeToExecute
                ? 'Strategy is internally consistent and ready for execution engines'
                : `${totalLayers - passedLayers} validation layer(s) flagged issues that need attention`
              }
            </Text>
          </View>
        </View>
      )}

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="shield-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Integrity Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Integrity Engine to validate strategic consistency across all upstream engines before execution.
          </Text>
          {!funnelSnapshotId && (
            <View style={[styles.depWarning, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[styles.depWarningText, { color: '#F59E0B' }]}>
                Complete a Funnel Engine analysis first
              </Text>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !funnelSnapshotId}
        style={[styles.analyzeBtn, (!funnelSnapshotId) && styles.analyzeBtnDisabled]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : ['#6366F1', '#4F46E5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Validating Strategy...</Text>
            </>
          ) : (
            <>
              <Ionicons name="shield-checkmark" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-validate Strategy' : 'Validate Strategy'}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      {hasData && (
        <>
          {data.boundaryCheck && !data.boundaryCheck.passed && (
            <View style={[styles.warningBox, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#EF4444' }]}>Boundary Violation</Text>
                {data.boundaryCheck.violations.map((v, i) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#DC2626' }]}>{v}</Text>
                ))}
              </View>
            </View>
          )}

          {data.layerResults && data.layerResults.map(layer => renderLayerCard(layer))}

          {data.flaggedInconsistencies && data.flaggedInconsistencies.length > 0 && (
            <View style={[styles.inconsistenciesBox, { backgroundColor: colors.card, borderColor: '#F59E0B30' }]}>
              <View style={styles.inconsistenciesHeader}>
                <Ionicons name="flag" size={16} color="#F59E0B" />
                <Text style={[styles.inconsistenciesTitle, { color: '#F59E0B' }]}>
                  Flagged Inconsistencies ({data.flaggedInconsistencies.length})
                </Text>
              </View>
              {data.flaggedInconsistencies.map((inc, i) => (
                <View key={i} style={styles.inconsistencyRow}>
                  <View style={[styles.inconsistencyDot, { backgroundColor: '#F59E0B' }]} />
                  <Text style={[styles.inconsistencyText, { color: colors.textSecondary }]}>{inc}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  headerGradient: { borderRadius: 12, padding: 16, marginBottom: 12 },
  headerContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  versionBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  versionText: { fontSize: 11, fontWeight: '600' as const, color: '#fff' },
  headerMeta: { flexDirection: 'row', marginTop: 12, gap: 16 },
  headerMetaItem: { flex: 1 },
  headerMetaLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  headerMetaValue: { fontSize: 14, fontWeight: '700' as const, color: '#fff' },
  executionStatus: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 12, alignItems: 'center' },
  executionStatusTitle: { fontSize: 14, fontWeight: '700' as const, marginBottom: 2 },
  executionStatusDesc: { fontSize: 12, lineHeight: 16 },
  emptyState: { borderRadius: 12, padding: 24, alignItems: 'center', marginBottom: 12, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' as const },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  depWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, marginTop: 8 },
  depWarningText: { fontSize: 12, fontWeight: '500' as const },
  analyzeBtn: { marginBottom: 12 },
  analyzeBtnDisabled: { opacity: 0.5 },
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 14 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  layerCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  layerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  layerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  layerLabel: { fontSize: 13, fontWeight: '600' as const },
  layerScore: { fontSize: 13, fontWeight: '700' as const },
  layerDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  scoreBarBg: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  layerSection: { marginBottom: 8 },
  layerSectionTitle: { fontSize: 11, fontWeight: '600' as const, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4, paddingLeft: 4 },
  findingText: { fontSize: 12, lineHeight: 16, flex: 1 },
  inconsistenciesBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 4 },
  inconsistenciesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  inconsistenciesTitle: { fontSize: 13, fontWeight: '600' as const },
  inconsistencyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  inconsistencyDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  inconsistencyText: { fontSize: 12, lineHeight: 16, flex: 1 },
});
