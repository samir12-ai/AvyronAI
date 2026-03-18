import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';

interface SignalCluster {
  id: string;
  label: string;
  frequency: number;
  confidence: number;
  evidence: string[];
  sourceLayer: "surface" | "pattern" | "interpretation";
}

interface StructuredSignals {
  pain_clusters: SignalCluster[];
  desire_clusters: SignalCluster[];
  pattern_clusters: SignalCluster[];
  root_causes: SignalCluster[];
  psychological_drivers: SignalCluster[];
}

interface SignalTraceability {
  totalSignalsAvailable: number;
  signalsUsed: string[];
  signalCoverage: number;
  unmappedElements: string[];
  validationPassed: boolean;
}

const SIGNAL_CATEGORIES: { key: keyof StructuredSignals; label: string; icon: string; color: string }[] = [
  { key: 'pain_clusters', label: 'Pain Clusters', icon: 'heart-dislike-outline', color: '#ef4444' },
  { key: 'desire_clusters', label: 'Desire Clusters', icon: 'sparkles-outline', color: '#22c55e' },
  { key: 'pattern_clusters', label: 'Pattern Clusters', icon: 'grid-outline', color: '#3b82f6' },
  { key: 'root_causes', label: 'Root Causes', icon: 'search-outline', color: '#f59e0b' },
  { key: 'psychological_drivers', label: 'Psychological Drivers', icon: 'bulb-outline', color: '#a855f7' },
];

function layerBadgeColor(layer: string): string {
  if (layer === 'surface') return '#3b82f6';
  if (layer === 'pattern') return '#f59e0b';
  return '#a855f7';
}

function SignalClusterCard({ cluster, isDark, isUsed }: { cluster: SignalCluster; isDark: boolean; isUsed: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f8f8ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const badgeColor = layerBadgeColor(cluster.sourceLayer);

  return (
    <View style={[s.clusterCard, { backgroundColor: bg, borderLeftColor: isUsed ? '#22c55e' : (isDark ? '#333' : '#ddd') }]}>
      <View style={s.clusterHeader}>
        <Text style={[s.clusterLabel, { color: text }]} numberOfLines={2}>{cluster.label}</Text>
        <View style={s.clusterBadges}>
          {isUsed && (
            <View style={[s.badge, { backgroundColor: '#22c55e22' }]}>
              <Ionicons name="checkmark-circle" size={10} color="#22c55e" />
              <Text style={[s.badgeText, { color: '#22c55e' }]}>used</Text>
            </View>
          )}
          <View style={[s.badge, { backgroundColor: badgeColor + '22' }]}>
            <Text style={[s.badgeText, { color: badgeColor }]}>{cluster.sourceLayer}</Text>
          </View>
        </View>
      </View>
      <View style={s.clusterMeta}>
        <Text style={[s.metaText, { color: muted }]}>freq: {cluster.frequency}</Text>
        <Text style={[s.metaText, { color: muted }]}>conf: {(cluster.confidence * 100).toFixed(0)}%</Text>
        <Text style={[s.metaText, { color: muted }]}>id: {cluster.id}</Text>
      </View>
      {cluster.evidence.length > 0 && (
        <View style={s.evidenceContainer}>
          {cluster.evidence.slice(0, 2).map((ev, i) => (
            <Text key={i} style={[s.evidenceText, { color: muted }]} numberOfLines={1}>"{ev}"</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function TraceabilitySummary({ trace, isDark }: { trace: SignalTraceability; isDark: boolean }) {
  const bg = isDark ? '#1a1a2e' : '#f0f9ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const statusColor = trace.validationPassed ? '#22c55e' : '#ef4444';

  return (
    <View style={[s.traceCard, { backgroundColor: bg }]}>
      <View style={s.traceHeader}>
        <Ionicons name={trace.validationPassed ? "checkmark-circle" : "alert-circle"} size={18} color={statusColor} />
        <Text style={[s.traceTitle, { color: text }]}>
          Signal Traceability: {trace.validationPassed ? 'PASSED' : 'FAILED'}
        </Text>
      </View>
      <View style={s.traceStats}>
        <View style={s.traceStat}>
          <Text style={[s.traceStatValue, { color: text }]}>{trace.signalsUsed.length}</Text>
          <Text style={[s.traceStatLabel, { color: muted }]}>Signals Used</Text>
        </View>
        <View style={s.traceStat}>
          <Text style={[s.traceStatValue, { color: text }]}>{trace.totalSignalsAvailable}</Text>
          <Text style={[s.traceStatLabel, { color: muted }]}>Available</Text>
        </View>
        <View style={s.traceStat}>
          <Text style={[s.traceStatValue, { color: text }]}>{(trace.signalCoverage * 100).toFixed(0)}%</Text>
          <Text style={[s.traceStatLabel, { color: muted }]}>Coverage</Text>
        </View>
        <View style={s.traceStat}>
          <Text style={[s.traceStatValue, { color: trace.unmappedElements.length > 0 ? '#f59e0b' : text }]}>{trace.unmappedElements.length}</Text>
          <Text style={[s.traceStatLabel, { color: muted }]}>Unmapped</Text>
        </View>
      </View>
      {trace.unmappedElements.length > 0 && (
        <View style={s.unmappedSection}>
          <Text style={[s.unmappedTitle, { color: '#f59e0b' }]}>Unmapped Elements:</Text>
          {trace.unmappedElements.slice(0, 3).map((el, i) => (
            <Text key={i} style={[s.unmappedItem, { color: muted }]} numberOfLines={1}>• {el}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default function SignalFlowPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { activeCampaign } = useCampaign();
  const [expanded, setExpanded] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signals, setSignals] = useState<StructuredSignals | null>(null);
  const [traceability, setTraceability] = useState<SignalTraceability | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bg = isDark ? '#12122a' : '#ffffff';
  const headerBg = isDark ? '#1a1a3e' : '#f5f5ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#888' : '#777';
  const border = isDark ? '#2a2a4e' : '#e0e0f0';

  useEffect(() => {
    if (!expanded || !activeCampaign?.id) return;
    fetchData();
  }, [expanded, activeCampaign?.id]);

  async function fetchData() {
    if (!activeCampaign?.id) return;
    setLoading(true);
    setError(null);
    try {
      const baseUrl = getApiUrl();
      const audRes = await fetch(new URL(`/api/audience-engine/latest?campaignId=${activeCampaign.id}`, baseUrl).toString());
      if (!audRes.ok) throw new Error('No audience snapshot available');
      const audData = await audRes.json();
      if (!audData) throw new Error('No audience snapshot available');
      setSignals(audData.structuredSignals || null);

      const posRes = await fetch(new URL(`/api/positioning-engine/latest?campaignId=${activeCampaign.id}`, baseUrl).toString());
      if (posRes.ok) {
        const posData = await posRes.json();
        setTraceability(posData?.signalTraceability || null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load signal flow data');
    } finally {
      setLoading(false);
    }
  }

  const totalSignals = signals
    ? signals.pain_clusters.length + signals.desire_clusters.length + signals.pattern_clusters.length + signals.root_causes.length + signals.psychological_drivers.length
    : 0;

  const usedSignalIds = new Set(traceability?.signalsUsed || []);

  return (
    <View style={[s.container, { backgroundColor: bg, borderColor: border }]}>
      <Pressable onPress={() => setExpanded(!expanded)} style={[s.header, { backgroundColor: headerBg }]}>
        <View style={s.headerLeft}>
          <Ionicons name="git-network-outline" size={18} color="#7c5cfc" />
          <Text style={[s.headerTitle, { color: text }]}>Signal Flow</Text>
          {totalSignals > 0 && (
            <View style={[s.badge, { backgroundColor: '#7c5cfc22' }]}>
              <Text style={[s.badgeText, { color: '#7c5cfc' }]}>{totalSignals} signals</Text>
            </View>
          )}
          {traceability && (
            <View style={[s.badge, { backgroundColor: traceability.validationPassed ? '#22c55e22' : '#ef444422' }]}>
              <Ionicons
                name={traceability.validationPassed ? "checkmark-circle" : "alert-circle"}
                size={10}
                color={traceability.validationPassed ? '#22c55e' : '#ef4444'}
              />
              <Text style={[s.badgeText, { color: traceability.validationPassed ? '#22c55e' : '#ef4444' }]}>
                {traceability.validationPassed ? 'traced' : 'gaps'}
              </Text>
            </View>
          )}
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={muted} />
      </Pressable>

      {expanded && (
        <View style={s.body}>
          {loading && <ActivityIndicator size="small" color="#7c5cfc" style={s.loader} />}
          {error && <Text style={[s.errorText, { color: '#ef4444' }]}>{error}</Text>}

          {!loading && !error && !signals && (
            <Text style={[s.emptyText, { color: muted }]}>No structured signals available. Run Audience Intelligence first.</Text>
          )}

          {!loading && signals && (
            <ScrollView style={s.scrollBody} nestedScrollEnabled>
              {traceability && <TraceabilitySummary trace={traceability} isDark={isDark} />}

              {SIGNAL_CATEGORIES.map(cat => {
                const clusters = signals[cat.key];
                if (clusters.length === 0) return null;
                const isExpanded = expandedCategory === cat.key;
                return (
                  <View key={cat.key}>
                    <Pressable
                      onPress={() => setExpandedCategory(isExpanded ? null : cat.key)}
                      style={[s.categoryRow, { borderBottomColor: border }]}
                    >
                      <View style={s.categoryLeft}>
                        <Ionicons name={cat.icon as any} size={16} color={cat.color} />
                        <Text style={[s.categoryLabel, { color: text }]}>{cat.label}</Text>
                        <View style={[s.badge, { backgroundColor: cat.color + '22' }]}>
                          <Text style={[s.badgeText, { color: cat.color }]}>{clusters.length}</Text>
                        </View>
                      </View>
                      <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={muted} />
                    </Pressable>
                    {isExpanded && clusters.map((cluster: SignalCluster) => (
                      <SignalClusterCard
                        key={cluster.id}
                        cluster={cluster}
                        isDark={isDark}
                        isUsed={usedSignalIds.has(cluster.id)}
                      />
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  headerTitle: { fontSize: 14, fontWeight: '600' as const },
  body: { paddingHorizontal: 8, paddingBottom: 8 },
  scrollBody: { maxHeight: 500 },
  loader: { marginVertical: 16 },
  errorText: { fontSize: 12, padding: 12 },
  emptyText: { fontSize: 12, padding: 12, textAlign: 'center' as const },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 10, fontWeight: '600' as const },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1 },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryLabel: { fontSize: 13, fontWeight: '500' as const },
  clusterCard: { marginHorizontal: 4, marginVertical: 4, padding: 10, borderRadius: 8, borderLeftWidth: 3 },
  clusterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  clusterLabel: { fontSize: 12, fontWeight: '500' as const, flex: 1, marginRight: 8 },
  clusterBadges: { flexDirection: 'row', gap: 4 },
  clusterMeta: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  metaText: { fontSize: 10 },
  evidenceContainer: { marginTop: 4, gap: 2 },
  evidenceText: { fontSize: 10, fontStyle: 'italic' as const },
  traceCard: { margin: 4, padding: 12, borderRadius: 8, marginBottom: 8 },
  traceHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  traceTitle: { fontSize: 13, fontWeight: '600' as const },
  traceStats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  traceStat: { alignItems: 'center' as const },
  traceStatValue: { fontSize: 18, fontWeight: '700' as const },
  traceStatLabel: { fontSize: 10 },
  unmappedSection: { marginTop: 4 },
  unmappedTitle: { fontSize: 11, fontWeight: '600' as const, marginBottom: 4 },
  unmappedItem: { fontSize: 10, marginLeft: 8 },
});
