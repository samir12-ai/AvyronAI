import React, { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppShellController } from '@/hooks/useAppShellController';
import { GlobalHeader } from '@/components/GlobalHeader';
import { apiRequest } from '@/lib/query-client';

export interface PerformanceLoopOverview {
  campaignId: string;
  accountId: string | null;
  currentStrategyRootId: string | null;
  currentStrategyRootVersion: number;
  currentStrategyName?: string;
  businessUnderstanding: {
    snapshotId: string;
    businessIdentity: string;
    primaryOffering: string;
    businessModel: string;
    category: string;
    targetRoles: Array<{ roleTitle?: string; roleType?: string; rationale?: string } | string>;
    productTruthCapabilities: Array<{ verifiedCapability?: string; capability?: string; statement?: string } | string>;
    verifiedCapabilities: string[];
    boundaryLimitations: string[];
    userConfirmedFacts: string[];
    websiteEstablishedFacts: string[];
    unknownElements: string[];
    confidence: string;
    updatedAt: string;
  } | null;
  planPerformance: {
    contextId: string;
    mode: 'BUILD' | 'OPTIMIZE' | 'UNKNOWN';
    strategyRootId: string | null;
    strategyRootVersion: number;
    strategyName?: string;
    planId?: string | null;
    planVersion?: number;
    planSummary?: string;
    currentReality: string;
    primaryBottleneck: string | null;
    hasBottleneck: boolean;
    weakestSignals: string[];
    proofGaps: string[];
    strongestSignals: string[];
    activeChannels: Array<{ channel: string; status: string; statusLabel: string }>;
    recentTrend: string;
    confidence: string;
    freshness: string;
    evidenceIds: string[];
    warningsCount: number;
    updatedAt: string;
  } | null;
}

export default function PerformanceScreen() {
  const router = useRouter();
  const shell = useAppShellController();
  const campaignId = shell.activeWorkspace?.id ?? null;

  const [activeTab, setActiveTab] = useState<'business_understanding' | 'plan_performance'>('business_understanding');
  const [data, setData] = useState<PerformanceLoopOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverview = async () => {
    if (!campaignId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await apiRequest('GET', `/api/performance-loop/overview/${campaignId}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('[PerformanceScreen] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [campaignId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverview();
  };

  const bu = data?.businessUnderstanding;
  const perf = data?.planPerformance;

  return (
    <View style={styles.container}>
      <GlobalHeader
        title="Performance Loop"
        subtitle="Canonical business understanding and live strategy performance summary"
      />

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabButton, activeTab === 'business_understanding' && styles.tabButtonActive]}
          onPress={() => setActiveTab('business_understanding')}
        >
          <Feather
            name="briefcase"
            size={16}
            color={activeTab === 'business_understanding' ? '#8B5CF6' : '#9CA3AF'}
          />
          <Text style={[styles.tabText, activeTab === 'business_understanding' && styles.tabTextActive]}>
            Business Understanding
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'plan_performance' && styles.tabButtonActive]}
          onPress={() => setActiveTab('plan_performance')}
        >
          <Feather
            name="trending-up"
            size={16}
            color={activeTab === 'plan_performance' ? '#8B5CF6' : '#9CA3AF'}
          />
          <Text style={[styles.tabText, activeTab === 'plan_performance' && styles.tabTextActive]}>
            Plan Performance
          </Text>
          {perf && perf.warningsCount > 0 && (
            <View style={styles.warningBadge}>
              <Text style={styles.warningBadgeText}>{perf.warningsCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#8B5CF6" />}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingText}>Loading performance summary…</Text>
          </View>
        ) : activeTab === 'business_understanding' ? (
          /* ========================================================================= */
          /* 1A. BUSINESS UNDERSTANDING (CONCISE SUMMARY)                              */
          /* ========================================================================= */
          !bu ? (
            <View style={styles.emptyState}>
              <Feather name="help-circle" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No Business Understanding snapshot recorded yet</Text>
              <Text style={styles.emptySubtitle}>Run onboarding or import business assets to establish canonical truth.</Text>
            </View>
          ) : (
            <View style={styles.sectionGrid}>
              {/* Header Card: Business Identity */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.cardOverline}>CANONICAL BUSINESS TRUTH</Text>
                    <Text style={styles.cardTitle}>{bu.businessIdentity}</Text>
                  </View>
                  <View style={styles.confidencePill}>
                    <Text style={styles.confidencePillText}>Status: {bu.confidence}</Text>
                  </View>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Primary Offering:</Text>
                  <Text style={styles.detailValue}>{bu.primaryOffering}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Category / Model:</Text>
                  <Text style={styles.detailValue}>{bu.category} ({bu.businessModel})</Text>
                </View>
              </View>

              {/* Target Understanding Roles */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="users" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Who Avyron Understands Your Buyers Are</Text>
                </View>
                {bu.targetRoles.length === 0 ? (
                  <Text style={styles.mutedText}>No specific buyer roles established yet.</Text>
                ) : (
                  bu.targetRoles.map((r, i) => (
                    <View key={i} style={styles.roleItem}>
                      <Feather name="user-check" size={14} color="#10B981" style={{ marginTop: 2 }} />
                      <Text style={styles.roleText}>
                        {typeof r === 'string' ? r : (r.roleTitle || r.roleType || JSON.stringify(r))}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {/* Verified Product Capabilities vs Boundary Limitations */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="shield" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Verified Product Truth & Capabilities</Text>
                </View>
                <Text style={styles.cardSubtitle}>What Avyron knows your product reliably accomplishes:</Text>
                {bu.productTruthCapabilities.length === 0 ? (
                  <Text style={styles.mutedText}>No verified capabilities extracted yet.</Text>
                ) : (
                  bu.productTruthCapabilities.map((cap, i) => (
                    <View key={i} style={styles.capabilityItem}>
                      <Feather name="check-circle" size={14} color="#8B5CF6" style={{ marginTop: 2 }} />
                      <Text style={styles.capabilityText}>
                        {typeof cap === 'string' ? cap : (cap.verifiedCapability || cap.capability || cap.statement || JSON.stringify(cap))}
                      </Text>
                    </View>
                  ))
                )}

                {bu.boundaryLimitations.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={[styles.cardSubtitle, { color: '#F59E0B' }]}>Known Boundary Limitations:</Text>
                    {bu.boundaryLimitations.map((lim, i) => (
                      <View key={i} style={styles.capabilityItem}>
                        <Feather name="alert-circle" size={14} color="#F59E0B" style={{ marginTop: 2 }} />
                        <Text style={styles.capabilityText}>{lim}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Provenance: User Confirmed vs Website Established vs Unknown */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="database" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Truth Provenance & Confidence</Text>
                </View>
                <View style={styles.provenanceGrid}>
                  <View style={styles.provenanceBox}>
                    <Text style={styles.provenanceCount}>{bu.userConfirmedFacts.length}</Text>
                    <Text style={styles.provenanceLabel}>User Confirmed Facts</Text>
                  </View>
                  <View style={styles.provenanceBox}>
                    <Text style={styles.provenanceCount}>{bu.websiteEstablishedFacts.length}</Text>
                    <Text style={styles.provenanceLabel}>Website Facts</Text>
                  </View>
                  <View style={styles.provenanceBox}>
                    <Text style={[styles.provenanceCount, { color: '#F59E0B' }]}>{bu.unknownElements.length}</Text>
                    <Text style={styles.provenanceLabel}>Unknown / Gaps</Text>
                  </View>
                </View>
              </View>
            </View>
          )
        ) : (
          /* ========================================================================= */
          /* 1B. PLAN PERFORMANCE (CONCISE EXECUTIVE SUMMARY)                         */
          /* ========================================================================= */
          !perf ? (
            <View style={styles.emptyState}>
              <Feather name="bar-chart-2" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No performance evaluation state detected yet</Text>
              <Text style={styles.emptySubtitle}>Live performance signals will populate once campaign execution commences.</Text>
            </View>
          ) : (
            <View style={styles.sectionGrid}>
              {/* Executive Status Banner */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardOverline}>CURRENT STRATEGY</Text>
                    <Text style={styles.cardTitle}>{perf.strategyName || 'Competitor Intelligence Extraction Simplicity_and_Ease'}</Text>
                  </View>
                  <View style={[styles.statusBadge, perf.mode === 'OPTIMIZE' ? styles.statusOptimize : styles.statusBuild]}>
                    <Text style={styles.statusBadgeText}>Mode: {perf.mode} • Trend: {perf.recentTrend}</Text>
                  </View>
                </View>

                {perf.planSummary && (
                  <View style={{ marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#0F172A', borderRadius: 8, borderWidth: 1, borderColor: '#33415560' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Active Plan Summary</Text>
                    <Text style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 19 }}>{perf.planSummary}</Text>
                  </View>
                )}

                <Text style={[styles.currentRealityText, { marginTop: 12 }]}>{perf.currentReality}</Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: '#C4B5FD', fontWeight: '700' }]}>Strategy Root v{perf.strategyRootVersion}</Text>
                  <Text style={styles.metaText}>Confidence: {perf.confidence}</Text>
                  <Text style={styles.metaText}>Freshness: {perf.freshness}</Text>
                </View>
              </View>

              {/* Primary Bottleneck & Warnings */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="alert-triangle" size={18} color={perf.hasBottleneck ? '#EF4444' : '#10B981'} />
                  <Text style={styles.cardTitle}>Primary Bottleneck & Warnings</Text>
                </View>

                {perf.hasBottleneck ? (
                  <Pressable
                    style={({ hovered }: any) => [
                      styles.bottleneckCard,
                      hovered && styles.bottleneckCardHovered,
                    ]}
                    onPress={() => router.push(`/(tabs)/reasoning-evidence?tab=warnings&warningId=${perf.contextId}` as any)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bottleneckLabel}>Primary Bottleneck:</Text>
                      <Text style={styles.bottleneckValue}>{perf.primaryBottleneck}</Text>
                    </View>
                    <View style={styles.viewDetailAction}>
                      <Text style={[styles.viewDetailActionText, { color: '#F87171' }]}>Investigate in Reasoning</Text>
                      <Feather name="arrow-right" size={14} color="#F87171" />
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.healthyBanner}>
                    <Feather name="check-circle" size={16} color="#10B981" />
                    <Text style={styles.healthyBannerText}>No primary bottleneck identified (Baseline healthy / establishing)</Text>
                  </View>
                )}

                {perf.weakestSignals.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.cardSubtitle}>Observed Warning Areas (Click to investigate):</Text>
                    {perf.weakestSignals.map((ws, i) => (
                      <Pressable
                        key={i}
                        style={styles.weakSignalItem}
                        onPress={() => router.push(`/(tabs)/reasoning-evidence?tab=warnings&warningId=${perf.contextId}` as any)}
                      >
                        <Feather name="trending-down" size={14} color="#EF4444" style={{ marginTop: 2 }} />
                        <Text style={styles.weakSignalText}>{ws}</Text>
                        <Feather name="chevron-right" size={14} color="#EF4444" />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>

              {/* Active Channels & Proven Traction */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="radio" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Distribution Channels</Text>
                </View>
                {perf.activeChannels.length === 0 ? (
                  <Text style={styles.mutedText}>No active channels measured yet.</Text>
                ) : (
                  perf.activeChannels.map((ch, i) => (
                    <View key={i} style={styles.channelRow}>
                      <Text style={styles.channelName}>{ch.channel}</Text>
                      <View style={[
                        styles.channelPill,
                        ch.status === 'WINNING' ? styles.channelWinning : (ch.status === 'NOT_CONNECTED' ? styles.channelDisconnected : styles.channelUntested)
                      ]}>
                        <Text style={styles.channelPillText}>{ch.statusLabel || ch.status}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 8,
  },
  tabButtonActive: {
    borderBottomColor: '#8B5CF6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tabTextActive: {
    color: '#F8FAFC',
  },
  warningBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  warningBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#94A3B8',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    marginVertical: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  sectionGrid: {
    gap: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardOverline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  confidencePill: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  confidencePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  detailLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  roleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  roleText: {
    fontSize: 14,
    color: '#E2E8F0',
    flex: 1,
  },
  capabilityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  capabilityText: {
    fontSize: 13,
    color: '#CBD5E1',
    flex: 1,
  },
  provenanceGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  provenanceBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  provenanceCount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10B981',
  },
  provenanceLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBuild: {
    backgroundColor: '#3B82F620',
  },
  statusOptimize: {
    backgroundColor: '#10B98120',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#93C5FD',
  },
  currentRealityText: {
    fontSize: 14,
    color: '#E2E8F0',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  metaText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  bottleneckCard: {
    backgroundColor: '#450A0A30',
    borderColor: '#7F1D1D',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer' as any,
  },
  bottleneckCardHovered: {
    borderColor: '#EF4444',
    backgroundColor: '#450A0A50',
  },
  bottleneckLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FCA5A5',
  },
  bottleneckValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F87171',
    marginTop: 2,
  },
  viewDetailAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewDetailActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  healthyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#064E3B20',
    borderColor: '#05966950',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  },
  healthyBannerText: {
    fontSize: 13,
    color: '#A7F3D0',
    fontWeight: '600',
  },
  weakSignalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    cursor: 'pointer' as any,
  },
  weakSignalText: {
    fontSize: 13,
    color: '#FCA5A5',
    flex: 1,
  },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  channelName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  channelPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  channelWinning: {
    backgroundColor: '#065F46',
  },
  channelDisconnected: {
    backgroundColor: '#4B556350',
  },
  channelUntested: {
    backgroundColor: '#374151',
  },
  channelPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F8FAFC',
  },
});