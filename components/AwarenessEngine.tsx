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
import { getApiUrl, safeApiJson } from '@/lib/query-client';
import { useColorScheme } from 'react-native';

interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

interface AwarenessRoute {
  routeName: string;
  entryMechanismType: string;
  targetReadinessStage: string;
  triggerClass: string;
  trustRequirement: string;
  funnelCompatibility: string;
  awarenessStrengthScore: number;
  frictionNotes: string[];
  rejectionReason: string | null;
}

interface AwarenessData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  primaryRoute?: AwarenessRoute;
  alternativeRoute?: AwarenessRoute;
  rejectedRoute?: AwarenessRoute;
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  engineVersion?: number;
  executionTimeMs?: number;
  createdAt?: string;
}

const LAYER_LABELS: Record<string, string> = {
  market_entry_detection: "Market Entry Detection",
  awareness_readiness_mapping: "Awareness Readiness Mapping",
  attention_trigger_mapping: "Attention Trigger Mapping",
  narrative_entry_alignment: "Narrative Entry Alignment",
  awareness_funnel_fit: "Awareness–Funnel Fit",
  trust_readiness_guard: "Trust Readiness Guard",
  generic_awareness_detector: "Generic Awareness Detector",
  awareness_strength_scoring: "Awareness Strength Scoring",
};

const LAYER_ICONS: Record<string, string> = {
  market_entry_detection: "navigate",
  awareness_readiness_mapping: "map",
  attention_trigger_mapping: "flash",
  narrative_entry_alignment: "git-compare",
  awareness_funnel_fit: "funnel",
  trust_readiness_guard: "shield-checkmark",
  generic_awareness_detector: "search",
  awareness_strength_scoring: "analytics",
};

const READINESS_COLORS: Record<string, string> = {
  unaware: '#EF4444',
  problem_aware: '#F59E0B',
  solution_aware: '#3B82F6',
  product_aware: '#8B5CF6',
  most_aware: '#10B981',
};

const ENTRY_LABELS: Record<string, string> = {
  pain_entry: "Pain Entry",
  opportunity_entry: "Opportunity Entry",
  myth_breaker_entry: "Myth Breaker",
  authority_entry: "Authority Entry",
  proof_led_entry: "Proof-Led Entry",
  diagnostic_entry: "Diagnostic Entry",
};

const READINESS_LABELS: Record<string, string> = {
  unaware: "Unaware",
  problem_aware: "Problem Aware",
  solution_aware: "Solution Aware",
  product_aware: "Product Aware",
  most_aware: "Most Aware",
};

export default function AwarenessEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<AwarenessData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [integritySnapshotId, setIntegritySnapshotId] = useState<string | null>(null);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/awareness-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch (err) {
      console.error('[AwarenessEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchIntegritySnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/integrity-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.id) {
        setIntegritySnapshotId(json.id);
      }
    } catch (err) {
      console.error('[AwarenessEngine] Integrity snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchIntegritySnapshot();
    }
  }, [isActive, fetchLatest, fetchIntegritySnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId || !integritySnapshotId) {
      Alert.alert('Missing Dependency', 'A completed Integrity Engine analysis is required before running the Awareness Engine.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/awareness-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId, integritySnapshotId }),
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
  }, [selectedCampaignId, integritySnapshotId, fetchLatest]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderRouteCard = (route: AwarenessRoute, type: 'primary' | 'alternative' | 'rejected') => {
    const isExpanded = expandedRoute === type;
    const isRejected = type === 'rejected';
    const typeColors = {
      primary: '#10B981',
      alternative: '#3B82F6',
      rejected: '#EF4444',
    };
    const typeLabels = {
      primary: 'Primary Route',
      alternative: 'Alternative Route',
      rejected: 'Rejected Route',
    };
    const typeIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
      primary: 'checkmark-circle',
      alternative: 'swap-horizontal',
      rejected: 'close-circle',
    };
    const cardColor = typeColors[type];
    const readinessColor = READINESS_COLORS[route.targetReadinessStage] || '#6B7280';
    const scorePercent = Math.round(route.awarenessStrengthScore * 100);

    return (
      <View key={type} style={[styles.routeCard, { backgroundColor: colors.card, borderColor: cardColor + '30' }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setExpandedRoute(isExpanded ? null : type);
          }}
          style={styles.routeHeader}
        >
          <View style={styles.routeHeaderLeft}>
            <Ionicons name={typeIcons[type]} size={18} color={cardColor} />
            <View>
              <Text style={[styles.routeTypeLabel, { color: cardColor }]}>{typeLabels[type]}</Text>
              <Text style={[styles.routeName, { color: colors.text }]}>{route.routeName}</Text>
            </View>
          </View>
          <View style={styles.routeHeaderRight}>
            {!isRejected && (
              <View style={[styles.scorePill, { backgroundColor: scoreColor(route.awarenessStrengthScore) + '20' }]}>
                <Text style={[styles.scorePillText, { color: scoreColor(route.awarenessStrengthScore) }]}>{scorePercent}%</Text>
              </View>
            )}
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={styles.routeDetails}>
            <View style={[styles.routeDivider, { backgroundColor: colors.cardBorder }]} />

            <View style={styles.routeMetaGrid}>
              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Entry Mechanism</Text>
                <View style={[styles.routeMetaBadge, { backgroundColor: '#8B5CF6' + '15' }]}>
                  <Ionicons name="navigate" size={12} color="#8B5CF6" />
                  <Text style={[styles.routeMetaBadgeText, { color: '#8B5CF6' }]}>
                    {ENTRY_LABELS[route.entryMechanismType] || route.entryMechanismType}
                  </Text>
                </View>
              </View>

              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Readiness Stage</Text>
                <View style={[styles.routeMetaBadge, { backgroundColor: readinessColor + '15' }]}>
                  <View style={[styles.readinessDot, { backgroundColor: readinessColor }]} />
                  <Text style={[styles.routeMetaBadgeText, { color: readinessColor }]}>
                    {READINESS_LABELS[route.targetReadinessStage] || route.targetReadinessStage}
                  </Text>
                </View>
              </View>

              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Trigger Class</Text>
                <Text style={[styles.routeMetaValue, { color: colors.text }]}>
                  {route.triggerClass.replace(/_/g, ' ')}
                </Text>
              </View>

              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Trust Req.</Text>
                <Text style={[styles.routeMetaValue, { color: colors.text }]}>
                  {route.trustRequirement.replace(/_/g, ' ')}
                </Text>
              </View>
            </View>

            <View style={[styles.routeMetaFullRow, { backgroundColor: colors.background }]}>
              <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Funnel Compatibility</Text>
              <Text style={[styles.routeMetaValue, { color: colors.text }]}>{route.funnelCompatibility}</Text>
            </View>

            {route.frictionNotes.length > 0 && (
              <View style={styles.frictionSection}>
                <Text style={[styles.frictionTitle, { color: '#F59E0B' }]}>Friction Notes</Text>
                {route.frictionNotes.map((note, i) => (
                  <View key={i} style={styles.frictionRow}>
                    <Ionicons name="warning" size={12} color="#F59E0B" />
                    <Text style={[styles.frictionText, { color: colors.textSecondary }]}>{note}</Text>
                  </View>
                ))}
              </View>
            )}

            {isRejected && route.rejectionReason && (
              <View style={[styles.rejectionBox, { backgroundColor: '#EF444410' }]}>
                <Ionicons name="close-circle" size={14} color="#EF4444" />
                <Text style={[styles.rejectionText, { color: '#EF4444' }]}>{route.rejectionReason}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
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
  const primaryScore = data?.primaryRoute ? Math.round(data.primaryRoute.awarenessStrengthScore * 100) : 0;
  const passedLayers = data?.layerResults?.filter(l => l.passed).length || 0;
  const totalLayers = data?.layerResults?.length || 8;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F97316', '#EA580C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="eye" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Awareness Engine V3</Text>
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
              <Text style={styles.headerMetaLabel}>Strength</Text>
              <Text style={styles.headerMetaValue}>{primaryScore}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Layers</Text>
              <Text style={styles.headerMetaValue}>{passedLayers}/{totalLayers}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Routes</Text>
              <Text style={styles.headerMetaValue}>3</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="eye-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Awareness Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Awareness Engine to map entry routes, readiness stages, and attention triggers for your strategic positioning.
          </Text>
          {!integritySnapshotId && (
            <View style={[styles.depWarning, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[styles.depWarningText, { color: '#F59E0B' }]}>
                Complete an Integrity Engine analysis first
              </Text>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !integritySnapshotId}
        style={[styles.analyzeBtn, (!integritySnapshotId) && styles.analyzeBtnDisabled]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : ['#F97316', '#EA580C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Mapping Awareness Routes...</Text>
            </>
          ) : (
            <>
              <Ionicons name="eye" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-analyze Awareness' : 'Analyze Awareness'}</Text>
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

          <View style={styles.routesSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="navigate" size={16} color={colors.text} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Awareness Routes</Text>
            </View>
            {data.primaryRoute && renderRouteCard(data.primaryRoute, 'primary')}
            {data.alternativeRoute && renderRouteCard(data.alternativeRoute, 'alternative')}
            {data.rejectedRoute && renderRouteCard(data.rejectedRoute, 'rejected')}
          </View>

          <View style={styles.layersSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="layers" size={16} color={colors.text} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Layer Analysis ({passedLayers}/{totalLayers} passed)</Text>
            </View>
            {data.layerResults && data.layerResults.map(layer => renderLayerCard(layer))}
          </View>

          {data.structuralWarnings && data.structuralWarnings.length > 0 && (
            <View style={[styles.warningsBox, { backgroundColor: colors.card, borderColor: '#F59E0B30' }]}>
              <View style={styles.warningsHeader}>
                <Ionicons name="flag" size={16} color="#F59E0B" />
                <Text style={[styles.warningsTitle, { color: '#F59E0B' }]}>
                  Structural Warnings ({data.structuralWarnings.length})
                </Text>
              </View>
              {data.structuralWarnings.map((w, i) => (
                <View key={i} style={styles.warningRow}>
                  <View style={[styles.warningDot, { backgroundColor: '#F59E0B' }]} />
                  <Text style={[styles.warningText, { color: colors.textSecondary }]}>{w}</Text>
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
  routesSection: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  routeCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  routeHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  routeHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeTypeLabel: { fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  routeName: { fontSize: 13, fontWeight: '600' as const, marginTop: 1 },
  scorePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  scorePillText: { fontSize: 12, fontWeight: '700' as const },
  routeDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  routeDivider: { height: 1, marginBottom: 12 },
  routeMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  routeMetaItem: { borderRadius: 8, padding: 10, minWidth: '46%' as any, flex: 1 },
  routeMetaLabel: { fontSize: 10, fontWeight: '500' as const, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  routeMetaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, alignSelf: 'flex-start' },
  routeMetaBadgeText: { fontSize: 11, fontWeight: '600' as const },
  readinessDot: { width: 6, height: 6, borderRadius: 3 },
  routeMetaValue: { fontSize: 12, fontWeight: '500' as const, textTransform: 'capitalize' as const },
  routeMetaFullRow: { borderRadius: 8, padding: 10, marginBottom: 8 },
  frictionSection: { marginTop: 4 },
  frictionTitle: { fontSize: 11, fontWeight: '600' as const, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  frictionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4, paddingLeft: 4 },
  frictionText: { fontSize: 12, lineHeight: 16, flex: 1 },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, marginTop: 4 },
  rejectionText: { fontSize: 12, lineHeight: 16, flex: 1, fontWeight: '500' as const },
  layersSection: { marginBottom: 8 },
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
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 4 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  warningDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  warningText: { fontSize: 12, lineHeight: 16, flex: 1 },
});
