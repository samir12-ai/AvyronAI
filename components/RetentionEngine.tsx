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

interface RetentionLoop {
  name: string;
  type: string;
  description: string;
  triggerCondition: string;
  expectedImpact: number;
  implementationDifficulty: number;
  priorityScore: number;
}

interface ChurnRiskFlag {
  riskFactor: string;
  severity: number;
  timeframe: string;
  mitigationStrategy: string;
  dataConfidence: number;
}

interface LTVExpansionPath {
  pathName: string;
  description: string;
  estimatedLTVIncrease: number;
  requiredConditions: string[];
  riskNotes: string[];
  confidenceScore: number;
}

interface UpsellTrigger {
  triggerName: string;
  triggerCondition: string;
  suggestedOffer: string;
  timing: string;
  expectedConversionRate: number;
  priorityRank: number;
}

interface GuardResult {
  passed: boolean;
  flags: string[];
  valueDeliveryClarity: number;
  trustDecayRisk: number;
  retentionMechanismPresence: number;
}

interface RetentionData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  retentionLoops?: RetentionLoop[];
  churnRiskFlags?: ChurnRiskFlag[];
  ltvExpansionPaths?: LTVExpansionPath[];
  upsellTriggers?: UpsellTrigger[];
  guardResult?: GuardResult;
  boundaryCheck?: { passed: boolean; violations: string[] };
  structuralWarnings?: string[];
  confidenceScore?: number;
  engineVersion?: number;
  executionTimeMs?: number;
  createdAt?: string;
}

const LOOP_TYPE_ICONS: Record<string, string> = {
  engagement_loop: "repeat",
  value_reinforcement: "diamond",
  community_loop: "people",
  habit_loop: "sync",
  reward_loop: "gift",
  milestone_loop: "flag",
  feedback_loop: "chatbubbles",
  referral_loop: "share-social",
};

const LOOP_TYPE_LABELS: Record<string, string> = {
  engagement_loop: "Engagement Loop",
  value_reinforcement: "Value Reinforcement",
  community_loop: "Community Loop",
  habit_loop: "Habit Loop",
  reward_loop: "Reward Loop",
  milestone_loop: "Milestone Loop",
  feedback_loop: "Feedback Loop",
  referral_loop: "Referral Loop",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#EF4444',
  high: '#F97316',
  moderate: '#F59E0B',
  low: '#10B981',
};

const ENGINE_COLOR = '#059669';
const ENGINE_COLOR_DARK = '#047857';

export default function RetentionEngine() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<RetentionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedLoop, setExpandedLoop] = useState<string | null>(null);
  const [expandedChurn, setExpandedChurn] = useState<string | null>(null);
  const [expandedLTV, setExpandedLTV] = useState<string | null>(null);
  const [expandedUpsell, setExpandedUpsell] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/strategy/retention-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      if (json.found && json.snapshot) {
        const s = json.snapshot;
        const r = typeof s.result === 'string' ? JSON.parse(s.result) : (s.result || {});
        setData({
          exists: true,
          id: s.id,
          status: s.status || r.status,
          statusMessage: s.statusMessage || r.statusMessage,
          retentionLoops: r.retentionLoops || [],
          churnRiskFlags: r.churnRiskFlags || [],
          ltvExpansionPaths: r.ltvExpansionPaths || [],
          upsellTriggers: r.upsellTriggers || [],
          guardResult: r.guardResult,
          boundaryCheck: typeof s.boundaryCheck === 'string' ? JSON.parse(s.boundaryCheck) : s.boundaryCheck,
          structuralWarnings: typeof s.structuralWarnings === 'string' ? JSON.parse(s.structuralWarnings) : (s.structuralWarnings || r.structuralWarnings),
          confidenceScore: s.confidenceScore ?? r.confidenceScore,
          engineVersion: s.engineVersion ?? r.engineVersion,
          executionTimeMs: s.executionTimeMs ?? r.executionTimeMs,
          createdAt: s.createdAt,
        });
      } else {
        setData({ exists: false });
      }
    } catch (err) {
      console.error('[RetentionEngine] Fetch error:', err);
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
      const url = new URL('/api/strategy/retention-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
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
  }, [selectedCampaignId, fetchLatest]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const severityLabel = (severity: number): string => {
    if (severity >= 0.8) return 'Critical';
    if (severity >= 0.6) return 'High';
    if (severity >= 0.4) return 'Moderate';
    return 'Low';
  };

  const severityColor = (severity: number): string => {
    if (severity >= 0.8) return '#EF4444';
    if (severity >= 0.6) return '#F97316';
    if (severity >= 0.4) return '#F59E0B';
    return '#10B981';
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={ENGINE_COLOR} />
      </View>
    );
  }

  const hasData = data?.exists && (data.retentionLoops || data.churnRiskFlags || data.ltvExpansionPaths || data.upsellTriggers);
  const confidence = data?.confidenceScore ? Math.round(data.confidenceScore * 100) : 0;
  const loopCount = data?.retentionLoops?.length || 0;
  const riskCount = data?.churnRiskFlags?.length || 0;
  const pathCount = data?.ltvExpansionPaths?.length || 0;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[ENGINE_COLOR, ENGINE_COLOR_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="refresh-circle" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Retention Engine V3</Text>
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
              <Text style={styles.headerMetaLabel}>Confidence</Text>
              <Text style={styles.headerMetaValue}>{confidence}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Loops</Text>
              <Text style={styles.headerMetaValue}>{loopCount}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Risks</Text>
              <Text style={styles.headerMetaValue}>{riskCount}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>LTV Paths</Text>
              <Text style={styles.headerMetaValue}>{pathCount}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="refresh-circle-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Retention Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Retention Engine to identify retention loops, churn risks, LTV expansion paths, and upsell triggers.
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing}
        style={[styles.analyzeBtn]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : [ENGINE_COLOR, ENGINE_COLOR_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Analyzing Retention...</Text>
            </>
          ) : (
            <>
              <Ionicons name="refresh-circle" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-analyze Retention' : 'Analyze Retention'}</Text>
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

          {data.guardResult && !data.guardResult.passed && (
            <View style={[styles.warningBox, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
              <Ionicons name="shield" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#F59E0B' }]}>Guard Flags</Text>
                {data.guardResult.flags.map((f, i) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#D97706' }]}>{f}</Text>
                ))}
              </View>
            </View>
          )}

          {data.retentionLoops && data.retentionLoops.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="repeat" size={16} color={colors.text} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Retention Loops ({data.retentionLoops.length})</Text>
              </View>
              {data.retentionLoops.map((loop, idx) => {
                const isExpanded = expandedLoop === loop.name;
                const icon = LOOP_TYPE_ICONS[loop.type] || "repeat";
                const typeLabel = LOOP_TYPE_LABELS[loop.type] || loop.type.replace(/_/g, ' ');
                const impactPercent = Math.round(loop.expectedImpact * 100);
                const priorityPercent = Math.round(loop.priorityScore * 100);

                return (
                  <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: ENGINE_COLOR + '30' }]}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExpandedLoop(isExpanded ? null : loop.name);
                      }}
                      style={styles.cardHeader}
                    >
                      <View style={styles.cardHeaderLeft}>
                        <View style={[styles.statusDot, { backgroundColor: ENGINE_COLOR }]} />
                        <Ionicons name={icon as any} size={16} color={ENGINE_COLOR} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardLabel, { color: colors.text }]}>{loop.name}</Text>
                          <Text style={[styles.cardSubLabel, { color: colors.textMuted }]}>{typeLabel}</Text>
                        </View>
                      </View>
                      <View style={styles.cardHeaderRight}>
                        <View style={[styles.scorePill, { backgroundColor: scoreColor(loop.priorityScore) + '20' }]}>
                          <Text style={[styles.scorePillText, { color: scoreColor(loop.priorityScore) }]}>{priorityPercent}%</Text>
                        </View>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                      </View>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.cardDetails}>
                        <View style={[styles.divider, { backgroundColor: colors.cardBorder }]} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>{loop.description}</Text>
                        <View style={styles.metaGrid}>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Trigger</Text>
                            <Text style={[styles.metaValue, { color: colors.text }]}>{loop.triggerCondition}</Text>
                          </View>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Expected Impact</Text>
                            <Text style={[styles.metaValue, { color: scoreColor(loop.expectedImpact) }]}>{impactPercent}%</Text>
                          </View>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Difficulty</Text>
                            <Text style={[styles.metaValue, { color: colors.text }]}>{Math.round(loop.implementationDifficulty * 100)}%</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {data.churnRiskFlags && data.churnRiskFlags.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="warning" size={16} color={colors.text} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Churn Risk Flags ({data.churnRiskFlags.length})</Text>
              </View>
              {data.churnRiskFlags.map((risk, idx) => {
                const isExpanded = expandedChurn === risk.riskFactor;
                const sColor = severityColor(risk.severity);
                const sLabel = severityLabel(risk.severity);

                return (
                  <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: sColor + '30' }]}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExpandedChurn(isExpanded ? null : risk.riskFactor);
                      }}
                      style={styles.cardHeader}
                    >
                      <View style={styles.cardHeaderLeft}>
                        <View style={[styles.statusDot, { backgroundColor: sColor }]} />
                        <Ionicons name="alert-circle" size={16} color={sColor} />
                        <Text style={[styles.cardLabel, { color: colors.text, flex: 1 }]}>{risk.riskFactor}</Text>
                      </View>
                      <View style={styles.cardHeaderRight}>
                        <View style={[styles.scorePill, { backgroundColor: sColor + '20' }]}>
                          <Text style={[styles.scorePillText, { color: sColor }]}>{sLabel}</Text>
                        </View>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                      </View>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.cardDetails}>
                        <View style={[styles.divider, { backgroundColor: colors.cardBorder }]} />
                        <View style={styles.metaGrid}>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Timeframe</Text>
                            <Text style={[styles.metaValue, { color: colors.text }]}>{risk.timeframe}</Text>
                          </View>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Confidence</Text>
                            <Text style={[styles.metaValue, { color: scoreColor(risk.dataConfidence) }]}>{Math.round(risk.dataConfidence * 100)}%</Text>
                          </View>
                        </View>
                        <View style={[styles.mitigationBox, { backgroundColor: ENGINE_COLOR + '10' }]}>
                          <Ionicons name="shield-checkmark" size={14} color={ENGINE_COLOR} />
                          <Text style={[styles.mitigationText, { color: colors.textSecondary }]}>{risk.mitigationStrategy}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {data.ltvExpansionPaths && data.ltvExpansionPaths.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="trending-up" size={16} color={colors.text} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>LTV Expansion Paths ({data.ltvExpansionPaths.length})</Text>
              </View>
              {data.ltvExpansionPaths.map((path, idx) => {
                const isExpanded = expandedLTV === path.pathName;
                const confPercent = Math.round(path.confidenceScore * 100);

                return (
                  <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: '#3B82F6' + '30' }]}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExpandedLTV(isExpanded ? null : path.pathName);
                      }}
                      style={styles.cardHeader}
                    >
                      <View style={styles.cardHeaderLeft}>
                        <View style={[styles.statusDot, { backgroundColor: '#3B82F6' }]} />
                        <Ionicons name="arrow-up-circle" size={16} color="#3B82F6" />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardLabel, { color: colors.text }]}>{path.pathName}</Text>
                          <Text style={[styles.cardSubLabel, { color: colors.textMuted }]}>+{Math.round(path.estimatedLTVIncrease * 100)}% LTV</Text>
                        </View>
                      </View>
                      <View style={styles.cardHeaderRight}>
                        <View style={[styles.scorePill, { backgroundColor: scoreColor(path.confidenceScore) + '20' }]}>
                          <Text style={[styles.scorePillText, { color: scoreColor(path.confidenceScore) }]}>{confPercent}%</Text>
                        </View>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                      </View>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.cardDetails}>
                        <View style={[styles.divider, { backgroundColor: colors.cardBorder }]} />
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>{path.description}</Text>

                        {path.requiredConditions.length > 0 && (
                          <View style={styles.listSection}>
                            <Text style={[styles.listTitle, { color: ENGINE_COLOR }]}>Required Conditions</Text>
                            {path.requiredConditions.map((c, i) => (
                              <View key={i} style={styles.listRow}>
                                <Ionicons name="checkmark-circle" size={12} color={ENGINE_COLOR} />
                                <Text style={[styles.listText, { color: colors.textSecondary }]}>{c}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {path.riskNotes.length > 0 && (
                          <View style={styles.listSection}>
                            <Text style={[styles.listTitle, { color: '#F59E0B' }]}>Risk Notes</Text>
                            {path.riskNotes.map((n, i) => (
                              <View key={i} style={styles.listRow}>
                                <Ionicons name="warning" size={12} color="#F59E0B" />
                                <Text style={[styles.listText, { color: colors.textSecondary }]}>{n}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {data.upsellTriggers && data.upsellTriggers.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="flash" size={16} color={colors.text} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Upsell Triggers ({data.upsellTriggers.length})</Text>
              </View>
              {data.upsellTriggers.map((trigger, idx) => {
                const isExpanded = expandedUpsell === trigger.triggerName;
                const convPercent = Math.round(trigger.expectedConversionRate * 100);

                return (
                  <View key={idx} style={[styles.card, { backgroundColor: colors.card, borderColor: '#8B5CF6' + '30' }]}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExpandedUpsell(isExpanded ? null : trigger.triggerName);
                      }}
                      style={styles.cardHeader}
                    >
                      <View style={styles.cardHeaderLeft}>
                        <View style={[styles.statusDot, { backgroundColor: '#8B5CF6' }]} />
                        <Ionicons name="flash" size={16} color="#8B5CF6" />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.cardLabel, { color: colors.text }]}>{trigger.triggerName}</Text>
                          <Text style={[styles.cardSubLabel, { color: colors.textMuted }]}>Rank #{trigger.priorityRank}</Text>
                        </View>
                      </View>
                      <View style={styles.cardHeaderRight}>
                        <View style={[styles.scorePill, { backgroundColor: '#8B5CF6' + '20' }]}>
                          <Text style={[styles.scorePillText, { color: '#8B5CF6' }]}>{convPercent}% conv</Text>
                        </View>
                        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                      </View>
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.cardDetails}>
                        <View style={[styles.divider, { backgroundColor: colors.cardBorder }]} />
                        <View style={styles.metaGrid}>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Trigger Condition</Text>
                            <Text style={[styles.metaValue, { color: colors.text }]}>{trigger.triggerCondition}</Text>
                          </View>
                          <View style={[styles.metaItem, { backgroundColor: colors.background }]}>
                            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Timing</Text>
                            <Text style={[styles.metaValue, { color: colors.text }]}>{trigger.timing}</Text>
                          </View>
                        </View>
                        <View style={[styles.mitigationBox, { backgroundColor: '#8B5CF6' + '10' }]}>
                          <Ionicons name="pricetag" size={14} color="#8B5CF6" />
                          <Text style={[styles.mitigationText, { color: colors.textSecondary }]}>{trigger.suggestedOffer}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

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
  section: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  cardLabel: { fontSize: 13, fontWeight: '600' as const },
  cardSubLabel: { fontSize: 11, marginTop: 1 },
  scorePill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  scorePillText: { fontSize: 11, fontWeight: '600' as const },
  cardDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  divider: { height: 1, marginBottom: 12 },
  detailText: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metaItem: { borderRadius: 8, padding: 10, minWidth: '45%' as any, flex: 1 },
  metaLabel: { fontSize: 10, fontWeight: '500' as const, marginBottom: 4 },
  metaValue: { fontSize: 12, fontWeight: '600' as const },
  mitigationBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 8, marginTop: 4 },
  mitigationText: { fontSize: 12, lineHeight: 16, flex: 1 },
  listSection: { marginBottom: 8 },
  listTitle: { fontSize: 12, fontWeight: '600' as const, marginBottom: 6 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  listText: { fontSize: 12, lineHeight: 16, flex: 1 },
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  warningDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 5 },
  warningText: { fontSize: 12, lineHeight: 16, flex: 1 },
});
