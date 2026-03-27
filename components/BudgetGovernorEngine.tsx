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
import { getApiUrl, safeApiJson , authFetch } from '@/lib/query-client';
import { useColorScheme } from 'react-native';

interface BudgetRange {
  min: number;
  max: number;
  recommended: number;
  currency: string;
}

interface DataSourceStatisticalValidity {
  isStatisticallyValid: boolean;
  confidenceLevel: number;
  conversions: number;
  minimumConversions: number;
  spend?: number;
  minimumSpend?: number;
}

interface DataSourceTransitionEligibility {
  eligible: boolean;
  currentMode: string;
  recommendedMode: string;
}

interface DataSource {
  isBenchmark: boolean;
  confidence?: number | null;
  benchmarkLabel?: string;
  anomalies?: Array<{ severity: string; message: string }>;
  warnings?: string[];
  isProjectionOnly?: boolean;
  switchReason?: string;
  statisticalValidity?: DataSourceStatisticalValidity;
  transitionEligibility?: DataSourceTransitionEligibility;
}

interface BudgetGovernorData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  decision?: { action: "test" | "scale" | "hold" | "halt"; reasoning: string };
  testBudgetRange?: BudgetRange;
  scaleBudgetRange?: BudgetRange;
  expansionPermission?: {
    allowed: boolean;
    maxScaleFactor: number;
    conditions: string[];
    blockers: string[];
  };
  killFlag?: boolean;
  killReasons?: string[];
  guardResult?: { passed: boolean; violations: string[]; warnings: string[]; overrides: string[] };
  riskAssessment?: { overallRisk: number; riskFactors: string[]; mitigations: string[] };
  cacAssumptionCheck?: {
    realistic: boolean;
    estimatedCAC: number;
    industryBenchmarkCAC: number;
    deviation: number;
    warnings: string[];
  };
  boundaryCheck?: { passed: boolean; violations: string[] };
  structuralWarnings?: string[];
  confidenceScore?: number;
  executionTimeMs?: number;
  engineVersion?: number;
  layerDiagnostics?: Record<string, any>;
  dataSource?: DataSource | null;
}

const DECISION_CONFIG: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  test: { color: '#3B82F6', icon: 'flask', label: 'Test' },
  scale: { color: '#10B981', icon: 'trending-up', label: 'Scale' },
  hold: { color: '#F59E0B', icon: 'pause-circle', label: 'Hold' },
  halt: { color: '#EF4444', icon: 'stop-circle', label: 'Halt' },
};

export default function BudgetGovernorEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<BudgetGovernorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [validationSnapshotId, setValidationSnapshotId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/strategy/budget-governor/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await authFetch(url.toString());
      const json = await safeApiJson(res);
      if (json.success && json.snapshot) {
        const s = json.snapshot;
        const r = typeof s.result === 'string' ? JSON.parse(s.result) : (s.result || {});
        setData({
          exists: true,
          id: s.id,
          status: s.status,
          statusMessage: s.statusMessage,
          decision: r.decision,
          testBudgetRange: r.testBudgetRange,
          scaleBudgetRange: r.scaleBudgetRange,
          expansionPermission: r.expansionPermission,
          killFlag: r.killFlag,
          killReasons: r.killReasons,
          guardResult: r.guardResult,
          riskAssessment: r.riskAssessment,
          cacAssumptionCheck: r.cacAssumptionCheck,
          boundaryCheck: typeof s.boundaryCheck === 'string' ? JSON.parse(s.boundaryCheck) : s.boundaryCheck,
          structuralWarnings: typeof s.structuralWarnings === 'string' ? JSON.parse(s.structuralWarnings) : s.structuralWarnings,
          confidenceScore: s.confidenceScore ?? r.confidenceScore,
          executionTimeMs: s.executionTimeMs ?? r.executionTimeMs,
          engineVersion: s.engineVersion ?? r.engineVersion,
          layerDiagnostics: r.layerDiagnostics,
          dataSource: r.dataSource || null,
        });
      } else {
        setData({ exists: false });
      }
    } catch (err) {
      console.error('[BudgetGovernor] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchValidationSnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/strategy/statistical-validation/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await authFetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.id) {
        setValidationSnapshotId(json.id);
      }
    } catch (err) {
      console.error('[BudgetGovernor] Validation snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchValidationSnapshot();
    }
  }, [isActive, fetchLatest, fetchValidationSnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) {
      Alert.alert('Missing Campaign', 'Please select a campaign first.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/strategy/budget-governor/analyze', getApiUrl());
      const res = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaignId,
          validationSnapshotId: validationSnapshotId || undefined,
        }),
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
  }, [selectedCampaignId, validationSnapshotId, fetchLatest]);

  const toggleSection = (section: string) => {
    Haptics.selectionAsync();
    setExpandedSection(expandedSection === section ? null : section);
  };

  const formatCurrency = (amount: number, currency: string) => {
    return `${currency === 'USD' ? '$' : currency}${amount.toLocaleString()}`;
  };

  const riskColor = (risk: number) => {
    if (risk >= 0.7) return '#EF4444';
    if (risk >= 0.4) return '#F59E0B';
    return '#10B981';
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  const hasData = data?.exists && data.decision;
  const decisionAction = data?.decision?.action || 'hold';
  const decisionCfg = DECISION_CONFIG[decisionAction] || DECISION_CONFIG.hold;
  const confidencePercent = data?.confidenceScore ? Math.round(data.confidenceScore * 100) : 0;
  const overallRisk = data?.riskAssessment?.overallRisk ?? 0;
  const riskPercent = Math.round(overallRisk * 100);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F59E0B', '#D97706']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="wallet" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Budget Governor V3</Text>
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
              <Text style={styles.headerMetaLabel}>Decision</Text>
              <Text style={styles.headerMetaValue}>{decisionCfg.label}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Confidence</Text>
              <Text style={styles.headerMetaValue}>{confidencePercent}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Risk</Text>
              <Text style={styles.headerMetaValue}>{riskPercent}%</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="wallet-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Budget Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Budget Governor to get test/scale budget recommendations, expansion permissions, and risk assessments.
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing}
        style={[styles.analyzeBtn]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : ['#F59E0B', '#D97706']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Analyzing Budget...</Text>
            </>
          ) : (
            <>
              <Ionicons name="wallet" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-analyze Budget' : 'Analyze Budget'}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      {hasData && (
        <>
          {data.killFlag && (
            <View style={[styles.killFlagBox, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
              <Ionicons name="alert-circle" size={18} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.killFlagTitle, { color: '#EF4444' }]}>Kill Flag Active</Text>
                {data.killReasons?.map((reason, i) => (
                  <Text key={i} style={[styles.killFlagReason, { color: '#DC2626' }]}>{reason}</Text>
                ))}
              </View>
            </View>
          )}

          {data.boundaryCheck && !data.boundaryCheck.passed && (
            <View style={[styles.killFlagBox, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.killFlagTitle, { color: '#EF4444' }]}>Boundary Violation</Text>
                {data.boundaryCheck.violations.map((v, i) => (
                  <Text key={i} style={[styles.killFlagReason, { color: '#DC2626' }]}>{v}</Text>
                ))}
              </View>
            </View>
          )}

          {data.dataSource && (
            <View style={[styles.dataSourceBanner, { backgroundColor: data.dataSource.isBenchmark ? '#3B82F610' : '#8B5CF610', borderColor: data.dataSource.isBenchmark ? '#3B82F630' : '#8B5CF630' }]}>
              <View style={styles.dataSourceBannerRow}>
                <Ionicons name={data.dataSource.isBenchmark ? 'bar-chart-outline' : 'analytics-outline'} size={14} color={data.dataSource.isBenchmark ? '#3B82F6' : '#8B5CF6'} />
                <Text style={[styles.dataSourceBannerLabel, { color: data.dataSource.isBenchmark ? '#3B82F6' : '#8B5CF6' }]}>
                  {data.dataSource.isBenchmark ? 'Market Benchmark Data' : 'Campaign Metrics Data'}
                </Text>
                {data.dataSource.confidence != null && (
                  <Text style={[styles.dataSourceConfidence, { color: colors.textMuted }]}>
                    {(data.dataSource.confidence * 100).toFixed(0)}% conf
                  </Text>
                )}
              </View>
              {data.dataSource.benchmarkLabel && data.dataSource.isBenchmark && (
                <Text style={[styles.dataSourceDetail, { color: colors.textMuted }]}>{data.dataSource.benchmarkLabel}</Text>
              )}
              {data.dataSource.anomalies && data.dataSource.anomalies.length > 0 && (
                <View style={styles.anomalyList}>
                  {data.dataSource.anomalies.map((a: any, i: number) => (
                    <View key={i} style={[styles.anomalyItem, { backgroundColor: a.severity === 'critical' ? '#EF444415' : '#F59E0B15' }]}>
                      <Ionicons name={a.severity === 'critical' ? 'alert-circle' : 'warning'} size={12} color={a.severity === 'critical' ? '#EF4444' : '#F59E0B'} />
                      <Text style={[styles.anomalyText, { color: a.severity === 'critical' ? '#EF4444' : '#F59E0B' }]}>{a.message}</Text>
                    </View>
                  ))}
                </View>
              )}
              {data.dataSource.warnings && data.dataSource.warnings.length > 0 && (
                <View style={styles.anomalyList}>
                  {data.dataSource.warnings.map((w: string, i: number) => (
                    <Text key={i} style={[styles.dataSourceDetail, { color: '#F59E0B' }]}>{w}</Text>
                  ))}
                </View>
              )}
              {data.dataSource.isProjectionOnly && (
                <View style={[styles.projectionGuard, { backgroundColor: '#F59E0B12' }]}>
                  <Ionicons name="flask-outline" size={12} color="#F59E0B" />
                  <Text style={[styles.projectionGuardText, { color: '#F59E0B' }]}>Projection Only — outputs based on market benchmarks, not verified campaign data</Text>
                </View>
              )}
              {data.dataSource.switchReason && (
                <View style={[styles.switchReasonBox, { backgroundColor: '#8B5CF612' }]}>
                  <Ionicons name="swap-horizontal" size={12} color="#8B5CF6" />
                  <Text style={[styles.switchReasonText, { color: '#8B5CF6' }]}>{data.dataSource.switchReason}</Text>
                </View>
              )}
              {data.dataSource.statisticalValidity && (
                <View style={[styles.statisticalValidityBox, {
                  backgroundColor: data.dataSource.statisticalValidity.isStatisticallyValid ? '#10B98110' : '#EF444410',
                  borderColor: data.dataSource.statisticalValidity.isStatisticallyValid ? '#10B98130' : '#EF444430',
                }]}>
                  <View style={styles.dataSourceBannerRow}>
                    <Ionicons
                      name={data.dataSource.statisticalValidity.isStatisticallyValid ? 'shield-checkmark-outline' : 'shield-outline'}
                      size={13}
                      color={data.dataSource.statisticalValidity.isStatisticallyValid ? '#10B981' : '#EF4444'}
                    />
                    <Text style={[styles.dataSourceBannerLabel, {
                      color: data.dataSource.statisticalValidity.isStatisticallyValid ? '#10B981' : '#EF4444'
                    }]}>
                      {data.dataSource.statisticalValidity.isStatisticallyValid ? 'Statistically Valid' : 'Below Statistical Threshold'}
                    </Text>
                    <Text style={[styles.dataSourceConfidence, { color: colors.textMuted }]}>
                      {(data.dataSource.statisticalValidity.confidenceLevel * 100).toFixed(0)}%
                    </Text>
                  </View>
                  <View style={styles.validityMetrics}>
                    <Text style={[styles.validityMetric, { color: colors.textSecondary }]}>
                      Conversions: {data.dataSource.statisticalValidity.conversions}/{data.dataSource.statisticalValidity.minimumConversions}
                    </Text>
                    <Text style={[styles.validityMetric, { color: colors.textSecondary }]}>
                      Spend: ${data.dataSource.statisticalValidity.spend?.toFixed(0) || '0'}/${data.dataSource.statisticalValidity.minimumSpend || 500}
                    </Text>
                  </View>
                  {!data.dataSource.statisticalValidity.isStatisticallyValid && (
                    <Text style={[styles.validityWarning, { color: '#EF4444' }]}>
                      Scaling decisions blocked until statistical thresholds are met
                    </Text>
                  )}
                </View>
              )}
              {data.dataSource.transitionEligibility && data.dataSource.transitionEligibility.eligible && (
                <View style={[styles.transitionBox, { backgroundColor: '#8B5CF610' }]}>
                  <Ionicons name="arrow-forward-circle-outline" size={12} color="#8B5CF6" />
                  <Text style={[styles.transitionText, { color: '#8B5CF6' }]}>
                    Adaptive switch available: {data.dataSource.transitionEligibility.currentMode} → {data.dataSource.transitionEligibility.recommendedMode}
                  </Text>
                </View>
              )}
            </View>
          )}

          <View style={[styles.decisionCard, { backgroundColor: colors.card, borderColor: decisionCfg.color + '30' }]}>
            <View style={styles.decisionHeader}>
              <View style={[styles.decisionBadge, { backgroundColor: decisionCfg.color + '15' }]}>
                <Ionicons name={decisionCfg.icon} size={20} color={decisionCfg.color} />
                <Text style={[styles.decisionLabel, { color: decisionCfg.color }]}>{decisionCfg.label}</Text>
              </View>
              <View style={[styles.confidencePill, { backgroundColor: riskColor(1 - (data.confidenceScore || 0)) + '15' }]}>
                <Text style={[styles.confidencePillText, { color: riskColor(1 - (data.confidenceScore || 0)) }]}>{confidencePercent}%</Text>
              </View>
            </View>
            {data.decision?.reasoning && (
              <Text style={[styles.decisionReasoning, { color: colors.textSecondary }]}>{data.decision.reasoning}</Text>
            )}
          </View>

          {data.testBudgetRange && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: '#3B82F630' }]}>
              <Pressable onPress={() => toggleSection('test')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons name="flask" size={16} color="#3B82F6" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Test Budget Range</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <Text style={[styles.sectionValue, { color: '#3B82F6' }]}>
                    {formatCurrency(data.testBudgetRange.recommended, data.testBudgetRange.currency)}
                  </Text>
                  <Ionicons name={expandedSection === 'test' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'test' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  <View style={styles.rangeRow}>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Min</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>{formatCurrency(data.testBudgetRange.min, data.testBudgetRange.currency)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Recommended</Text>
                      <Text style={[styles.rangeAmount, { color: '#3B82F6' }]}>{formatCurrency(data.testBudgetRange.recommended, data.testBudgetRange.currency)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Max</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>{formatCurrency(data.testBudgetRange.max, data.testBudgetRange.currency)}</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {data.scaleBudgetRange && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: '#10B98130' }]}>
              <Pressable onPress={() => toggleSection('scale')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons name="trending-up" size={16} color="#10B981" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Scale Budget Range</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <Text style={[styles.sectionValue, { color: '#10B981' }]}>
                    {formatCurrency(data.scaleBudgetRange.recommended, data.scaleBudgetRange.currency)}
                  </Text>
                  <Ionicons name={expandedSection === 'scale' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'scale' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  <View style={styles.rangeRow}>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Min</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>{formatCurrency(data.scaleBudgetRange.min, data.scaleBudgetRange.currency)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Recommended</Text>
                      <Text style={[styles.rangeAmount, { color: '#10B981' }]}>{formatCurrency(data.scaleBudgetRange.recommended, data.scaleBudgetRange.currency)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Max</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>{formatCurrency(data.scaleBudgetRange.max, data.scaleBudgetRange.currency)}</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {data.expansionPermission && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: (data.expansionPermission.allowed ? '#10B981' : '#EF4444') + '30' }]}>
              <Pressable onPress={() => toggleSection('expansion')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons
                    name={data.expansionPermission.allowed ? "shield-checkmark" : "close-circle"}
                    size={16}
                    color={data.expansionPermission.allowed ? '#10B981' : '#EF4444'}
                  />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Expansion Permission</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <View style={[styles.statusPill, { backgroundColor: (data.expansionPermission.allowed ? '#10B981' : '#EF4444') + '15' }]}>
                    <Text style={[styles.statusPillText, { color: data.expansionPermission.allowed ? '#10B981' : '#EF4444' }]}>
                      {data.expansionPermission.allowed ? 'Allowed' : 'Blocked'}
                    </Text>
                  </View>
                  <Ionicons name={expandedSection === 'expansion' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'expansion' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  <View style={[styles.expansionMeta, { backgroundColor: colors.background }]}>
                    <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Max Scale Factor</Text>
                    <Text style={[styles.rangeAmount, { color: colors.text }]}>{data.expansionPermission.maxScaleFactor}x</Text>
                  </View>
                  {data.expansionPermission.conditions.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#F59E0B' }]}>Conditions</Text>
                      {data.expansionPermission.conditions.map((c, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="alert-circle" size={12} color="#F59E0B" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {data.expansionPermission.blockers.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#EF4444' }]}>Blockers</Text>
                      {data.expansionPermission.blockers.map((b, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="close-circle" size={12} color="#EF4444" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{b}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {data.riskAssessment && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: riskColor(overallRisk) + '30' }]}>
              <Pressable onPress={() => toggleSection('risk')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons name="warning" size={16} color={riskColor(overallRisk)} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Risk Assessment</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <View style={[styles.statusPill, { backgroundColor: riskColor(overallRisk) + '15' }]}>
                    <Text style={[styles.statusPillText, { color: riskColor(overallRisk) }]}>{riskPercent}%</Text>
                  </View>
                  <Ionicons name={expandedSection === 'risk' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'risk' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  <View style={[styles.riskBarBg, { backgroundColor: colors.cardBorder }]}>
                    <View style={[styles.riskBarFill, { width: `${riskPercent}%`, backgroundColor: riskColor(overallRisk) }]} />
                  </View>
                  {data.riskAssessment.riskFactors.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#EF4444' }]}>Risk Factors</Text>
                      {data.riskAssessment.riskFactors.map((f, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="alert-circle" size={12} color="#EF4444" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{f}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {data.riskAssessment.mitigations.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#10B981' }]}>Mitigations</Text>
                      {data.riskAssessment.mitigations.map((m, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{m}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {data.cacAssumptionCheck && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: (data.cacAssumptionCheck.realistic ? '#10B981' : '#F59E0B') + '30' }]}>
              <Pressable onPress={() => toggleSection('cac')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons name="calculator" size={16} color={data.cacAssumptionCheck.realistic ? '#10B981' : '#F59E0B'} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>CAC Assumption Check</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <View style={[styles.statusPill, { backgroundColor: (data.cacAssumptionCheck.realistic ? '#10B981' : '#F59E0B') + '15' }]}>
                    <Text style={[styles.statusPillText, { color: data.cacAssumptionCheck.realistic ? '#10B981' : '#F59E0B' }]}>
                      {data.cacAssumptionCheck.realistic ? 'Realistic' : 'Unrealistic'}
                    </Text>
                  </View>
                  <Ionicons name={expandedSection === 'cac' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'cac' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  <View style={styles.rangeRow}>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Estimated CAC</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>${data.cacAssumptionCheck.estimatedCAC.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Benchmark</Text>
                      <Text style={[styles.rangeAmount, { color: colors.text }]}>${data.cacAssumptionCheck.industryBenchmarkCAC.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.rangeItem, { backgroundColor: colors.background }]}>
                      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>Deviation</Text>
                      <Text style={[styles.rangeAmount, { color: data.cacAssumptionCheck.deviation > 0.3 ? '#EF4444' : '#10B981' }]}>
                        {Math.round(data.cacAssumptionCheck.deviation * 100)}%
                      </Text>
                    </View>
                  </View>
                  {data.cacAssumptionCheck.warnings.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#F59E0B' }]}>Warnings</Text>
                      {data.cacAssumptionCheck.warnings.map((w, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="warning" size={12} color="#F59E0B" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{w}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {data.guardResult && (
            <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: (data.guardResult.passed ? '#10B981' : '#EF4444') + '30' }]}>
              <Pressable onPress={() => toggleSection('guard')} style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <Ionicons name="shield-checkmark" size={16} color={data.guardResult.passed ? '#10B981' : '#EF4444'} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Guard Result</Text>
                </View>
                <View style={styles.sectionHeaderRight}>
                  <View style={[styles.statusPill, { backgroundColor: (data.guardResult.passed ? '#10B981' : '#EF4444') + '15' }]}>
                    <Text style={[styles.statusPillText, { color: data.guardResult.passed ? '#10B981' : '#EF4444' }]}>
                      {data.guardResult.passed ? 'Passed' : 'Failed'}
                    </Text>
                  </View>
                  <Ionicons name={expandedSection === 'guard' ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                </View>
              </Pressable>
              {expandedSection === 'guard' && (
                <View style={styles.sectionDetails}>
                  <View style={[styles.rangeDivider, { backgroundColor: colors.cardBorder }]} />
                  {data.guardResult.violations.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#EF4444' }]}>Violations</Text>
                      {data.guardResult.violations.map((v, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="close-circle" size={12} color="#EF4444" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{v}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {data.guardResult.warnings.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#F59E0B' }]}>Warnings</Text>
                      {data.guardResult.warnings.map((w, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="warning" size={12} color="#F59E0B" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{w}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {data.guardResult.overrides.length > 0 && (
                    <View style={styles.listSection}>
                      <Text style={[styles.listTitle, { color: '#8B5CF6' }]}>Overrides</Text>
                      {data.guardResult.overrides.map((o, i) => (
                        <View key={i} style={styles.listRow}>
                          <Ionicons name="swap-horizontal" size={12} color="#8B5CF6" />
                          <Text style={[styles.listText, { color: colors.textSecondary }]}>{o}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
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
  killFlagBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  killFlagTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  killFlagReason: { fontSize: 12, lineHeight: 16 },
  decisionCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 10 },
  decisionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  decisionBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  decisionLabel: { fontSize: 18, fontWeight: '700' as const },
  confidencePill: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  confidencePillText: { fontSize: 13, fontWeight: '600' as const },
  decisionReasoning: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  sectionCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '600' as const },
  sectionValue: { fontSize: 13, fontWeight: '700' as const },
  sectionDetails: { paddingHorizontal: 14, paddingBottom: 14 },
  rangeDivider: { height: 1, marginBottom: 10 },
  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeItem: { flex: 1, borderRadius: 8, padding: 10, alignItems: 'center' },
  rangeLabel: { fontSize: 10, marginBottom: 4 },
  rangeAmount: { fontSize: 14, fontWeight: '700' as const },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 11, fontWeight: '600' as const },
  expansionMeta: { borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 8 },
  listSection: { marginTop: 8 },
  listTitle: { fontSize: 11, fontWeight: '600' as const, marginBottom: 4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 3 },
  listText: { fontSize: 12, lineHeight: 16, flex: 1 },
  riskBarBg: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  riskBarFill: { height: 6, borderRadius: 3 },
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 4 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  warningDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 5 },
  warningText: { fontSize: 12, lineHeight: 16, flex: 1 },
  dataSourceBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  dataSourceBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dataSourceBannerLabel: { fontSize: 12, fontWeight: '600' as const },
  dataSourceConfidence: { fontSize: 11, marginLeft: 'auto' },
  dataSourceDetail: { fontSize: 11, marginTop: 4, lineHeight: 16 },
  anomalyList: { marginTop: 6, gap: 4 },
  anomalyItem: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 6 },
  anomalyText: { fontSize: 11, flex: 1, lineHeight: 14 },
  projectionGuard: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, marginTop: 8 },
  projectionGuardText: { fontSize: 11, flex: 1, lineHeight: 15, fontWeight: '600' as const },
  switchReasonBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, marginTop: 6 },
  switchReasonText: { fontSize: 11, flex: 1, lineHeight: 15 },
  statisticalValidityBox: { borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 8 },
  validityMetrics: { flexDirection: 'row', gap: 12, marginTop: 6 },
  validityMetric: { fontSize: 11 },
  validityWarning: { fontSize: 11, fontWeight: '500' as const, marginTop: 6 },
  transitionBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 8, marginTop: 6 },
  transitionText: { fontSize: 11, flex: 1, lineHeight: 15 },
});
