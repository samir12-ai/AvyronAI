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

interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

interface ChannelCandidate {
  channelName: string;
  channelType: string;
  fitScore: number;
  audienceDensityScore: number;
  persuasionCompatibility: number;
  costEfficiency: number;
  riskLevel: string;
  riskNotes: string[];
  rejectionReason: string | null;
  estimatedCac: number | null;
  recommendedBudgetAllocation: number;
}

interface ChannelSelectionData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  primaryChannel?: ChannelCandidate;
  secondaryChannel?: ChannelCandidate;
  rejectedChannels?: ChannelCandidate[];
  channelFitScore?: number;
  channelRiskNotes?: string[];
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  confidenceScore?: number;
  engineVersion?: number;
  executionTimeMs?: number;
  createdAt?: string;
}

const ACCENT = '#3B82F6';
const ACCENT_DARK = '#2563EB';

const LAYER_LABELS: Record<string, string> = {
  audience_density_assessment: "Audience Density",
  awareness_channel_mapping: "Awareness Channel Mapping",
  persuasion_mode_compatibility: "Persuasion Compatibility",
  budget_constraint_check: "Budget Constraint Check",
  cost_efficiency_scoring: "Cost Efficiency Scoring",
  risk_assessment: "Risk Assessment",
  channel_fit_scoring: "Channel Fit Scoring",
  guard_layer: "Guard Layer",
};

const LAYER_ICONS: Record<string, string> = {
  audience_density_assessment: "people",
  awareness_channel_mapping: "map",
  persuasion_mode_compatibility: "magnet",
  budget_constraint_check: "wallet",
  cost_efficiency_scoring: "trending-down",
  risk_assessment: "shield-checkmark",
  channel_fit_scoring: "analytics",
  guard_layer: "lock-closed",
};

const CHANNEL_TYPE_LABELS: Record<string, string> = {
  social_organic: "Social Organic",
  social_paid: "Social Paid",
  search_paid: "Search Paid",
  search_organic: "Search Organic",
  email: "Email",
  referral: "Referral",
  direct: "Direct",
  community: "Community",
  partnerships: "Partnerships",
  content_platform: "Content Platform",
};

const RISK_COLORS: Record<string, string> = {
  low: '#10B981',
  moderate: '#F59E0B',
  high: '#EF4444',
  critical: '#DC2626',
};

export default function ChannelSelectionEngine() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<ChannelSelectionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/strategy/channel-selection/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      if (res.status === 404) {
        setData({ exists: false });
        return;
      }
      const json = await res.json();
      const r = json.result || {};
      setData({
        exists: true,
        id: json.snapshotId,
        status: json.status,
        statusMessage: json.statusMessage,
        primaryChannel: r.primaryChannel,
        secondaryChannel: r.secondaryChannel,
        rejectedChannels: r.rejectedChannels,
        channelFitScore: r.channelFitScore ?? json.confidenceScore,
        channelRiskNotes: r.channelRiskNotes,
        layerResults: json.layerResults || r.layerResults,
        structuralWarnings: json.structuralWarnings || r.structuralWarnings,
        boundaryCheck: json.boundaryCheck || r.boundaryCheck,
        confidenceScore: json.confidenceScore ?? r.confidenceScore,
        engineVersion: json.engineVersion,
        executionTimeMs: json.executionTimeMs,
        createdAt: json.createdAt,
      });
    } catch (err) {
      console.error('[ChannelSelectionEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) return;
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/strategy/channel-selection/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      const json = await res.json();
      if (res.ok && json.snapshotId) {
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
  }, [selectedCampaignId, fetchLatest]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderChannelCard = (channel: ChannelCandidate, type: 'primary' | 'secondary' | 'rejected') => {
    const isExpanded = expandedChannel === `${type}-${channel.channelName}`;
    const key = `${type}-${channel.channelName}`;
    const isRejected = type === 'rejected';
    const typeColors = {
      primary: '#10B981',
      secondary: '#3B82F6',
      rejected: '#EF4444',
    };
    const typeLabels = {
      primary: 'Primary Channel',
      secondary: 'Secondary Channel',
      rejected: 'Rejected',
    };
    const typeIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
      primary: 'checkmark-circle',
      secondary: 'swap-horizontal',
      rejected: 'close-circle',
    };
    const cardColor = typeColors[type];
    const riskColor = RISK_COLORS[channel.riskLevel] || '#6B7280';
    const fitPercent = Math.round(channel.fitScore * 100);

    return (
      <View key={key} style={[styles.channelCard, { backgroundColor: colors.card, borderColor: cardColor + '30' }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setExpandedChannel(isExpanded ? null : key);
          }}
          style={styles.channelHeader}
        >
          <View style={styles.channelHeaderLeft}>
            <Ionicons name={typeIcons[type]} size={18} color={cardColor} />
            <View>
              <Text style={[styles.channelTypeLabel, { color: cardColor }]}>{typeLabels[type]}</Text>
              <Text style={[styles.channelName, { color: colors.text }]}>{channel.channelName}</Text>
            </View>
          </View>
          <View style={styles.channelHeaderRight}>
            {!isRejected && (
              <View style={[styles.scorePill, { backgroundColor: scoreColor(channel.fitScore) + '20' }]}>
                <Text style={[styles.scorePillText, { color: scoreColor(channel.fitScore) }]}>{fitPercent}%</Text>
              </View>
            )}
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={styles.channelDetails}>
            <View style={[styles.channelDivider, { backgroundColor: colors.cardBorder }]} />

            <View style={styles.channelMetaGrid}>
              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Channel Type</Text>
                <View style={[styles.channelMetaBadge, { backgroundColor: ACCENT + '15' }]}>
                  <Ionicons name="radio" size={12} color={ACCENT} />
                  <Text style={[styles.channelMetaBadgeText, { color: ACCENT }]}>
                    {CHANNEL_TYPE_LABELS[channel.channelType] || channel.channelType}
                  </Text>
                </View>
              </View>

              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Risk Level</Text>
                <View style={[styles.channelMetaBadge, { backgroundColor: riskColor + '15' }]}>
                  <View style={[styles.riskDot, { backgroundColor: riskColor }]} />
                  <Text style={[styles.channelMetaBadgeText, { color: riskColor }]}>
                    {channel.riskLevel.charAt(0).toUpperCase() + channel.riskLevel.slice(1)}
                  </Text>
                </View>
              </View>

              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Audience Density</Text>
                <Text style={[styles.channelMetaValue, { color: scoreColor(channel.audienceDensityScore) }]}>
                  {Math.round(channel.audienceDensityScore * 100)}%
                </Text>
              </View>

              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Persuasion Fit</Text>
                <Text style={[styles.channelMetaValue, { color: scoreColor(channel.persuasionCompatibility) }]}>
                  {Math.round(channel.persuasionCompatibility * 100)}%
                </Text>
              </View>
            </View>

            <View style={styles.channelMetaGrid}>
              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Cost Efficiency</Text>
                <Text style={[styles.channelMetaValue, { color: scoreColor(channel.costEfficiency) }]}>
                  {Math.round(channel.costEfficiency * 100)}%
                </Text>
              </View>

              <View style={[styles.channelMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Budget Allocation</Text>
                <Text style={[styles.channelMetaValue, { color: colors.text }]}>
                  {Math.round(channel.recommendedBudgetAllocation * 100)}%
                </Text>
              </View>
            </View>

            {channel.estimatedCac !== null && (
              <View style={[styles.channelMetaFullRow, { backgroundColor: colors.background }]}>
                <Text style={[styles.channelMetaLabel, { color: colors.textMuted }]}>Est. CAC</Text>
                <Text style={[styles.channelMetaValue, { color: colors.text }]}>${channel.estimatedCac.toFixed(2)}</Text>
              </View>
            )}

            {channel.riskNotes.length > 0 && (
              <View style={styles.riskSection}>
                <Text style={[styles.riskTitle, { color: '#F59E0B' }]}>Risk Notes</Text>
                {channel.riskNotes.map((note, i) => (
                  <View key={i} style={styles.riskRow}>
                    <Ionicons name="warning" size={12} color="#F59E0B" />
                    <Text style={[styles.riskText, { color: colors.textSecondary }]}>{note}</Text>
                  </View>
                ))}
              </View>
            )}

            {isRejected && channel.rejectionReason && (
              <View style={[styles.rejectionBox, { backgroundColor: '#EF444410' }]}>
                <Ionicons name="close-circle" size={14} color="#EF4444" />
                <Text style={[styles.rejectionText, { color: '#EF4444' }]}>{channel.rejectionReason}</Text>
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
  const fitScore = data?.channelFitScore ? Math.round(data.channelFitScore * 100) : 0;
  const passedLayers = data?.layerResults?.filter(l => l.passed).length || 0;
  const totalLayers = data?.layerResults?.length || 8;
  const rejectedCount = data?.rejectedChannels?.length || 0;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[ACCENT, ACCENT_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="git-branch" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Channel Selection V3</Text>
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
              <Text style={styles.headerMetaLabel}>Fit Score</Text>
              <Text style={styles.headerMetaValue}>{fitScore}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Layers</Text>
              <Text style={styles.headerMetaValue}>{passedLayers}/{totalLayers}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Rejected</Text>
              <Text style={styles.headerMetaValue}>{rejectedCount}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="git-branch-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Channel Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Channel Selection Engine to identify optimal marketing channels based on audience density, budget constraints, and persuasion compatibility.
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing}
        style={[styles.analyzeBtn]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : [ACCENT, ACCENT_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Analyzing Channels...</Text>
            </>
          ) : (
            <>
              <Ionicons name="git-branch" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-analyze Channels' : 'Analyze Channels'}</Text>
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

          <View style={styles.channelsSection}>
            <View style={styles.sectionHeader}>
              <Ionicons name="radio" size={16} color={colors.text} />
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Channel Recommendations</Text>
            </View>
            {data.primaryChannel && renderChannelCard(data.primaryChannel, 'primary')}
            {data.secondaryChannel && renderChannelCard(data.secondaryChannel, 'secondary')}
            {data.rejectedChannels && data.rejectedChannels.map(ch => renderChannelCard(ch, 'rejected'))}
          </View>

          {data.channelRiskNotes && data.channelRiskNotes.length > 0 && (
            <View style={[styles.riskNotesBox, { backgroundColor: colors.card, borderColor: '#F59E0B30' }]}>
              <View style={styles.riskNotesHeader}>
                <Ionicons name="warning" size={16} color="#F59E0B" />
                <Text style={[styles.riskNotesTitle, { color: '#F59E0B' }]}>
                  Channel Risk Notes ({data.channelRiskNotes.length})
                </Text>
              </View>
              {data.channelRiskNotes.map((note, i) => (
                <View key={i} style={styles.riskNoteRow}>
                  <View style={[styles.riskNoteDot, { backgroundColor: '#F59E0B' }]} />
                  <Text style={[styles.riskNoteText, { color: colors.textSecondary }]}>{note}</Text>
                </View>
              ))}
            </View>
          )}

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
  analyzeBtn: { marginBottom: 12 },
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 14 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  channelsSection: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  channelCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  channelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  channelHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  channelHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  channelTypeLabel: { fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  channelName: { fontSize: 13, fontWeight: '600' as const, marginTop: 1 },
  scorePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  scorePillText: { fontSize: 12, fontWeight: '700' as const },
  channelDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  channelDivider: { height: 1, marginBottom: 12 },
  channelMetaGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  channelMetaItem: { flex: 1, borderRadius: 8, padding: 10 },
  channelMetaLabel: { fontSize: 10, marginBottom: 4 },
  channelMetaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  channelMetaBadgeText: { fontSize: 11, fontWeight: '600' as const },
  channelMetaValue: { fontSize: 13, fontWeight: '700' as const },
  channelMetaFullRow: { borderRadius: 8, padding: 10, marginBottom: 8 },
  riskDot: { width: 6, height: 6, borderRadius: 3 },
  riskSection: { marginTop: 4 },
  riskTitle: { fontSize: 12, fontWeight: '600' as const, marginBottom: 6 },
  riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  riskText: { fontSize: 12, flex: 1, lineHeight: 16 },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, marginTop: 8 },
  rejectionText: { fontSize: 12, flex: 1, lineHeight: 16, fontWeight: '500' as const },
  riskNotesBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  riskNotesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  riskNotesTitle: { fontSize: 13, fontWeight: '600' as const },
  riskNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  riskNoteDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 5 },
  riskNoteText: { fontSize: 12, flex: 1, lineHeight: 16 },
  layersSection: { marginBottom: 16 },
  layerCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  layerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  layerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  layerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  layerLabel: { fontSize: 13, fontWeight: '500' as const },
  layerScore: { fontSize: 13, fontWeight: '700' as const },
  layerDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  scoreBarBg: { height: 4, borderRadius: 2, marginBottom: 12 },
  scoreBarFill: { height: 4, borderRadius: 2 },
  layerSection: { marginBottom: 8 },
  layerSectionTitle: { fontSize: 11, fontWeight: '600' as const, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  findingText: { fontSize: 12, flex: 1, lineHeight: 16 },
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  warningDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 5 },
  warningText: { fontSize: 12, flex: 1, lineHeight: 16 },
});
