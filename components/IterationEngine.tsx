import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Switch,
  ScrollView,
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

interface TestHypothesis {
  hypothesisId: string;
  hypothesis: string;
  variable: string;
  expectedOutcome: string;
  priority: "high" | "medium" | "low";
  riskLevel: "low" | "moderate" | "high";
  testDurationDays: number;
  successMetric: string;
  successThreshold: number;
}

interface OptimizationTarget {
  targetArea: string;
  currentValue: number;
  targetValue: number;
  improvementStrategy: string;
  confidence: number;
  effort: "low" | "medium" | "high";
}

interface FailedStrategyFlag {
  strategyName: string;
  failureReason: string;
  failureDate: string;
  shouldRetry: boolean;
  retryConditions: string[];
}

interface IterationPlanStep {
  stepNumber: number;
  action: string;
  variable: string;
  duration: string;
  successCriteria: string;
  fallbackAction: string;
}

interface IterationData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  nextTestHypotheses?: TestHypothesis[];
  optimizationTargets?: OptimizationTarget[];
  failedStrategyFlags?: FailedStrategyFlag[];
  iterationPlan?: IterationPlanStep[];
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  dataReliability?: {
    signalDensity: number;
    performanceDataQuality: number;
    overallReliability: number;
    isWeak: boolean;
    advisories: string[];
  };
  confidenceScore?: number;
  executionTimeMs?: number;
  engineVersion?: number;
  createdAt?: string;
}

const LAYER_LABELS: Record<string, string> = {
  performance_data_validation: "Performance Data Validation",
  funnel_leak_detection: "Funnel Leak Detection",
  creative_fatigue_analysis: "Creative Fatigue Analysis",
  persuasion_decay_check: "Persuasion Decay Check",
  hypothesis_generation: "Hypothesis Generation",
  optimization_mapping: "Optimization Mapping",
  failure_pattern_detection: "Failure Pattern Detection",
  iteration_plan_assembly: "Iteration Plan Assembly",
};

const LAYER_ICONS: Record<string, string> = {
  performance_data_validation: "stats-chart",
  funnel_leak_detection: "funnel",
  creative_fatigue_analysis: "color-palette",
  persuasion_decay_check: "megaphone",
  hypothesis_generation: "flask",
  optimization_mapping: "trending-up",
  failure_pattern_detection: "alert-circle",
  iteration_plan_assembly: "list",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#10B981',
};

const RISK_COLORS: Record<string, string> = {
  high: '#EF4444',
  moderate: '#F59E0B',
  low: '#10B981',
};

const EFFORT_COLORS: Record<string, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#10B981',
};

const ENGINE_COLOR = '#F43F5E';
const ENGINE_COLOR_DARK = '#E11D48';

interface GateInputs {
  hasExistingAsset: boolean;
  assetDescription: string;
  primaryKpi: string;
  dataWindowDays: string;
}

interface CampaignMetricsData {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number;
  conversions: number;
}

const KPI_OPTIONS = ['CTR', 'ROAS', 'CPA', 'Conversion Rate', 'Revenue', 'Leads', 'Impressions'];
const WINDOW_OPTIONS = ['7', '14', '30', '60'];

export default function IterationEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<IterationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const [gateStatus, setGateStatus] = useState<'locked' | 'unlocked' | 'loading'>('loading');
  const [gateMissing, setGateMissing] = useState<string[]>([]);
  const [gateInputs, setGateInputs] = useState<GateInputs>({
    hasExistingAsset: false, assetDescription: '', primaryKpi: '', dataWindowDays: '',
  });
  const [campaignMetrics, setCampaignMetrics] = useState<CampaignMetricsData | null>(null);
  const [savingGate, setSavingGate] = useState(false);

  const fetchGateStatus = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL(`/api/campaigns/${selectedCampaignId}/iteration-gate`, getApiUrl());
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setGateStatus(json.gateStatus === 'unlocked' ? 'unlocked' : 'locked');
      setGateMissing(json.missingRequirements || []);
      setCampaignMetrics(json.campaignMetrics || null);
      if (json.inputs) {
        setGateInputs({
          hasExistingAsset: json.inputs.hasExistingAsset || false,
          assetDescription: json.inputs.assetDescription || '',
          primaryKpi: json.inputs.primaryKpi || '',
          dataWindowDays: json.inputs.dataWindowDays?.toString() || '',
        });
      }
    } catch (err) {
      console.error('[IterationEngine] Gate fetch error:', err);
      setGateStatus('locked');
      setGateMissing(["Failed to load gate status"]);
    }
  }, [selectedCampaignId]);

  const saveGateInputs = useCallback(async () => {
    if (!selectedCampaignId) return;
    setSavingGate(true);
    try {
      const url = new URL(`/api/campaigns/${selectedCampaignId}/iteration-gate`, getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasExistingAsset: gateInputs.hasExistingAsset,
          assetDescription: gateInputs.assetDescription,
          primaryKpi: gateInputs.primaryKpi,
          dataWindowDays: gateInputs.dataWindowDays || null,
        }),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        setGateStatus(json.gateStatus === 'unlocked' ? 'unlocked' : 'locked');
        setGateMissing(json.missingRequirements || []);
        setCampaignMetrics(json.campaignMetrics || null);
        Haptics.notificationAsync(
          json.gateStatus === 'unlocked'
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning
        );
      }
    } catch (err: any) {
      Alert.alert('Error', 'Failed to save gate inputs');
    } finally {
      setSavingGate(false);
    }
  }, [selectedCampaignId, gateInputs]);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/strategy/iteration-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch (err) {
      console.error('[IterationEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchGateStatus();
      fetchLatest();
    }
  }, [isActive, fetchGateStatus, fetchLatest]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) return;
    if (gateStatus !== 'unlocked') {
      Alert.alert('Gate Locked', 'Please complete all required inputs before running analysis.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/strategy/iteration-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await fetchLatest();
      } else if (json.error === 'INPUT_GATE_LOCKED') {
        setGateStatus('locked');
        setGateMissing(json.missingRequirements || []);
        Alert.alert('Gate Locked', json.message);
      } else {
        Alert.alert('Analysis Failed', json.message || json.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedCampaignId, fetchLatest, gateStatus]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderHypothesisCard = (hyp: TestHypothesis, index: number) => {
    const priorityColor = PRIORITY_COLORS[hyp.priority] || '#6B7280';
    const riskColor = RISK_COLORS[hyp.riskLevel] || '#6B7280';

    return (
      <View key={hyp.hypothesisId || index} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: priorityColor + '30' }]}>
        <View style={styles.itemCardHeader}>
          <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '15' }]}>
            <Ionicons name="flag" size={10} color={priorityColor} />
            <Text style={[styles.priorityText, { color: priorityColor }]}>{hyp.priority}</Text>
          </View>
          <View style={[styles.riskBadge, { backgroundColor: riskColor + '15' }]}>
            <Text style={[styles.riskText, { color: riskColor }]}>Risk: {hyp.riskLevel}</Text>
          </View>
        </View>
        <Text style={[styles.hypothesisText, { color: colors.text }]}>{hyp.hypothesis}</Text>
        <View style={styles.hypothesisMetaGrid}>
          <View style={[styles.hypothesisMetaItem, { backgroundColor: colors.background }]}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Variable</Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>{hyp.variable}</Text>
          </View>
          <View style={[styles.hypothesisMetaItem, { backgroundColor: colors.background }]}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Duration</Text>
            <Text style={[styles.metaValue, { color: colors.text }]}>{hyp.testDurationDays}d</Text>
          </View>
        </View>
        <View style={[styles.expectedOutcome, { backgroundColor: colors.background }]}>
          <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Expected Outcome</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{hyp.expectedOutcome}</Text>
        </View>
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={12} color="#10B981" />
          <Text style={[styles.successMetric, { color: colors.textSecondary }]}>
            {hyp.successMetric}: {Math.round(hyp.successThreshold * 100)}%
          </Text>
        </View>
      </View>
    );
  };

  const renderOptimizationCard = (target: OptimizationTarget, index: number) => {
    const effortColor = EFFORT_COLORS[target.effort] || '#6B7280';
    const confPercent = Math.round(target.confidence * 100);
    const improvement = target.targetValue - target.currentValue;
    const improvementPercent = target.currentValue > 0 ? Math.round((improvement / target.currentValue) * 100) : 0;

    return (
      <View key={index} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.itemCardHeader}>
          <Text style={[styles.targetArea, { color: colors.text }]}>{target.targetArea.replace(/_/g, ' ')}</Text>
          <View style={[styles.effortBadge, { backgroundColor: effortColor + '15' }]}>
            <Text style={[styles.effortText, { color: effortColor }]}>{target.effort} effort</Text>
          </View>
        </View>
        <View style={styles.valueRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Current</Text>
            <Text style={[styles.valueText, { color: '#EF4444' }]}>{target.currentValue.toFixed(2)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
          <View style={styles.valueItem}>
            <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Target</Text>
            <Text style={[styles.valueText, { color: '#10B981' }]}>{target.targetValue.toFixed(2)}</Text>
          </View>
          {improvementPercent !== 0 && (
            <View style={[styles.improvementBadge, { backgroundColor: '#10B98115' }]}>
              <Ionicons name="trending-up" size={10} color="#10B981" />
              <Text style={[styles.improvementText, { color: '#10B981' }]}>+{improvementPercent}%</Text>
            </View>
          )}
        </View>
        <Text style={[styles.strategyText, { color: colors.textSecondary }]}>{target.improvementStrategy}</Text>
        <View style={styles.confidenceRow}>
          <View style={[styles.confBar, { backgroundColor: colors.cardBorder }]}>
            <View style={[styles.confBarFill, { width: `${confPercent}%`, backgroundColor: scoreColor(target.confidence) }]} />
          </View>
          <Text style={[styles.confText, { color: scoreColor(target.confidence) }]}>{confPercent}%</Text>
        </View>
      </View>
    );
  };

  const renderFailedFlag = (flag: FailedStrategyFlag, index: number) => (
    <View key={index} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: '#EF444430' }]}>
      <View style={styles.itemCardHeader}>
        <View style={styles.failedHeaderLeft}>
          <Ionicons name="close-circle" size={16} color="#EF4444" />
          <Text style={[styles.failedName, { color: colors.text }]}>{flag.strategyName}</Text>
        </View>
        {flag.shouldRetry && (
          <View style={[styles.retryBadge, { backgroundColor: '#3B82F615' }]}>
            <Ionicons name="refresh" size={10} color="#3B82F6" />
            <Text style={[styles.retryText, { color: '#3B82F6' }]}>Retryable</Text>
          </View>
        )}
      </View>
      <Text style={[styles.failureReason, { color: colors.textSecondary }]}>{flag.failureReason}</Text>
      <Text style={[styles.failureDate, { color: colors.textMuted }]}>{flag.failureDate}</Text>
      {flag.retryConditions.length > 0 && (
        <View style={styles.retryConditions}>
          {flag.retryConditions.map((c, i) => (
            <View key={i} style={styles.conditionRow}>
              <Ionicons name="ellipse" size={6} color={colors.textMuted} />
              <Text style={[styles.conditionText, { color: colors.textSecondary }]}>{c}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderPlanStep = (step: IterationPlanStep, index: number) => (
    <View key={index} style={[styles.planStep, { backgroundColor: colors.card, borderColor: ENGINE_COLOR + '20' }]}>
      <View style={[styles.stepNumber, { backgroundColor: ENGINE_COLOR + '15' }]}>
        <Text style={[styles.stepNumberText, { color: ENGINE_COLOR }]}>{step.stepNumber}</Text>
      </View>
      <View style={styles.stepContent}>
        <Text style={[styles.stepAction, { color: colors.text }]}>{step.action}</Text>
        <View style={styles.stepMetaRow}>
          <View style={[styles.stepMetaBadge, { backgroundColor: colors.background }]}>
            <Ionicons name="flask" size={10} color={colors.textMuted} />
            <Text style={[styles.stepMetaText, { color: colors.textSecondary }]}>{step.variable}</Text>
          </View>
          <View style={[styles.stepMetaBadge, { backgroundColor: colors.background }]}>
            <Ionicons name="time" size={10} color={colors.textMuted} />
            <Text style={[styles.stepMetaText, { color: colors.textSecondary }]}>{step.duration}</Text>
          </View>
        </View>
        <View style={[styles.stepCriteria, { backgroundColor: colors.background }]}>
          <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Success Criteria</Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>{step.successCriteria}</Text>
        </View>
        {step.fallbackAction && (
          <View style={styles.fallbackRow}>
            <Ionicons name="git-branch" size={10} color="#F59E0B" />
            <Text style={[styles.fallbackText, { color: colors.textSecondary }]}>{step.fallbackAction}</Text>
          </View>
        )}
      </View>
    </View>
  );

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

  const renderCollapsibleSection = (key: string, title: string, icon: keyof typeof Ionicons.glyphMap, count: number, content: React.ReactNode) => {
    const isExpanded = expandedSection === key;
    return (
      <View style={styles.collapsibleSection}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setExpandedSection(isExpanded ? null : key);
          }}
          style={[styles.collapsibleHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        >
          <View style={styles.collapsibleHeaderLeft}>
            <Ionicons name={icon} size={16} color={ENGINE_COLOR} />
            <Text style={[styles.collapsibleTitle, { color: colors.text }]}>{title}</Text>
            <View style={[styles.countBadge, { backgroundColor: ENGINE_COLOR + '15' }]}>
              <Text style={[styles.countText, { color: ENGINE_COLOR }]}>{count}</Text>
            </View>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
        </Pressable>
        {isExpanded && content}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={ENGINE_COLOR} />
      </View>
    );
  }

  const hasData = data?.exists && data.layerResults;
  const hypotheses = data?.nextTestHypotheses || [];
  const targets = data?.optimizationTargets || [];
  const failedFlags = data?.failedStrategyFlags || [];
  const plan = data?.iterationPlan || [];
  const confScore = data?.confidenceScore ? Math.round(data.confidenceScore * 100) : 0;
  const passedLayers = data?.layerResults?.filter(l => l.passed).length || 0;
  const totalLayers = data?.layerResults?.length || 8;

  return (
    <View style={styles.container}>
      <LinearGradient colors={[ENGINE_COLOR, ENGINE_COLOR_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="repeat" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Iteration Engine</Text>
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
              <Text style={styles.headerMetaValue}>{confScore}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Layers</Text>
              <Text style={styles.headerMetaValue}>{passedLayers}/{totalLayers}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Hypotheses</Text>
              <Text style={styles.headerMetaValue}>{hypotheses.length}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Plan Steps</Text>
              <Text style={styles.headerMetaValue}>{plan.length}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      <View style={[styles.gateCard, { backgroundColor: colors.card, borderColor: gateStatus === 'unlocked' ? '#10B98130' : '#F59E0B30' }]}>
        <View style={styles.gateHeader}>
          <View style={styles.gateHeaderLeft}>
            <Ionicons name={gateStatus === 'unlocked' ? "lock-open" : "lock-closed"} size={16} color={gateStatus === 'unlocked' ? '#10B981' : '#F59E0B'} />
            <Text style={[styles.gateTitle, { color: colors.text }]}>Input Gate</Text>
          </View>
          <View style={[styles.gateStatusBadge, { backgroundColor: gateStatus === 'unlocked' ? '#10B98120' : '#F59E0B20' }]}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: gateStatus === 'unlocked' ? '#10B981' : '#F59E0B' }}>
              {gateStatus === 'loading' ? 'Loading...' : gateStatus === 'unlocked' ? 'Unlocked' : 'Locked'}
            </Text>
          </View>
        </View>

        {gateMissing.length > 0 && gateStatus === 'locked' && (
          <View style={styles.gateMissingBox}>
            {gateMissing.map((m, i) => (
              <View key={i} style={styles.gateMissingRow}>
                <Ionicons name="close-circle" size={12} color="#EF4444" />
                <Text style={[styles.gateMissingText, { color: colors.textSecondary }]}>{m}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.gateRow}>
          <Text style={[styles.gateLabel, { color: colors.text }]}>Has existing campaign/asset?</Text>
          <Switch
            value={gateInputs.hasExistingAsset}
            onValueChange={(v) => setGateInputs(prev => ({ ...prev, hasExistingAsset: v }))}
            trackColor={{ false: '#76768020', true: ENGINE_COLOR + '40' }}
            thumbColor={gateInputs.hasExistingAsset ? ENGINE_COLOR : '#f4f3f4'}
          />
        </View>

        {gateInputs.hasExistingAsset && (
          <TextInput
            style={[styles.gateInput, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.background }]}
            placeholder="Describe the asset (e.g., Facebook campaign, landing page)"
            placeholderTextColor={colors.textMuted}
            value={gateInputs.assetDescription}
            onChangeText={(v) => setGateInputs(prev => ({ ...prev, assetDescription: v }))}
          />
        )}

        <Text style={[styles.gateLabel, { color: colors.text, marginTop: 12 }]}>Primary KPI</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gateChipRow}>
          {KPI_OPTIONS.map(kpi => (
            <Pressable
              key={kpi}
              onPress={() => setGateInputs(prev => ({ ...prev, primaryKpi: kpi }))}
              style={[styles.gateChip, gateInputs.primaryKpi === kpi && { backgroundColor: ENGINE_COLOR + '20', borderColor: ENGINE_COLOR }]}
            >
              <Text style={[styles.gateChipText, { color: gateInputs.primaryKpi === kpi ? ENGINE_COLOR : colors.textSecondary }]}>{kpi}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={[styles.gateLabel, { color: colors.text, marginTop: 12 }]}>Data Window (days)</Text>
        <View style={styles.gateChipRowWrap}>
          {WINDOW_OPTIONS.map(w => (
            <Pressable
              key={w}
              onPress={() => setGateInputs(prev => ({ ...prev, dataWindowDays: w }))}
              style={[styles.gateChip, gateInputs.dataWindowDays === w && { backgroundColor: ENGINE_COLOR + '20', borderColor: ENGINE_COLOR }]}
            >
              <Text style={[styles.gateChipText, { color: gateInputs.dataWindowDays === w ? ENGINE_COLOR : colors.textSecondary }]}>{w}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.gateLabel, { color: colors.text, marginTop: 12 }]}>Campaign Performance Data</Text>
        {campaignMetrics ? (
          <View style={[styles.gateConnectedBox, { backgroundColor: '#10B98110' }]}>
            <View style={styles.gateConnectedHeader}>
              <Ionicons name="checkmark-circle" size={14} color="#10B981" />
              <Text style={[styles.gateConnectedText, { color: '#10B981' }]}>Connected from Campaign Metrics</Text>
            </View>
            <View style={styles.gateMetricsGrid}>
              {([
                ['Spend', campaignMetrics.spend],
                ['Impressions', campaignMetrics.impressions],
                ['Clicks', campaignMetrics.clicks],
                ['Leads', campaignMetrics.leads],
                ['Revenue', campaignMetrics.revenue],
                ['Conversions', campaignMetrics.conversions],
              ] as [string, number][]).map(([label, val]) => (
                <View key={label} style={styles.gateMetricItem}>
                  <Text style={[styles.gateMetricLabel, { color: colors.textSecondary }]}>{label}</Text>
                  <View style={[styles.gateMetricDisplay, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.gateMetricValue, { color: val > 0 ? '#10B981' : colors.textMuted }]}>
                      {label === 'Spend' || label === 'Revenue' ? `$${val.toLocaleString()}` : val.toLocaleString()}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={[styles.gateConnectedBox, { backgroundColor: '#EF444410' }]}>
            <View style={styles.gateConnectedHeader}>
              <Ionicons name="alert-circle" size={14} color="#EF4444" />
              <Text style={[styles.gateConnectedText, { color: '#EF4444' }]}>No campaign metrics found</Text>
            </View>
            <Text style={[styles.gateConnectedSubtext, { color: colors.textMuted }]}>
              Enter performance data in Settings → Campaign Metrics to unlock this requirement.
            </Text>
          </View>
        )}

        <Pressable
          onPress={saveGateInputs}
          disabled={savingGate}
          style={[styles.gateSaveBtn, { borderColor: ENGINE_COLOR }]}
        >
          {savingGate ? (
            <ActivityIndicator size="small" color={ENGINE_COLOR} />
          ) : (
            <>
              <Ionicons name="save-outline" size={14} color={ENGINE_COLOR} />
              <Text style={[styles.gateSaveBtnText, { color: ENGINE_COLOR }]}>Save Inputs</Text>
            </>
          )}
        </Pressable>
      </View>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="repeat-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Iteration Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            {gateStatus === 'locked'
              ? 'Complete the input gate above to unlock the Iteration Engine.'
              : 'Run the Iteration Engine to generate test hypotheses, optimization targets, and a step-by-step iteration plan for your campaign.'}
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || gateStatus !== 'unlocked'}
        style={[styles.analyzeBtn, (analyzing || gateStatus !== 'unlocked') && styles.analyzeBtnDisabled]}
      >
        <LinearGradient
          colors={analyzing || gateStatus !== 'unlocked' ? ['#9CA3AF', '#6B7280'] : [ENGINE_COLOR, ENGINE_COLOR_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Running Iteration Analysis...</Text>
            </>
          ) : gateStatus !== 'unlocked' ? (
            <>
              <Ionicons name="lock-closed" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>Gate Locked — Complete Inputs</Text>
            </>
          ) : (
            <>
              <Ionicons name="repeat" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-analyze Iteration' : 'Analyze Iteration'}</Text>
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

          {data.dataReliability && data.dataReliability.isWeak && (
            <View style={[styles.warningBox, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#F59E0B' }]}>Low Data Reliability</Text>
                {data.dataReliability.advisories.map((a, i) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#D97706' }]}>{a}</Text>
                ))}
              </View>
            </View>
          )}

          {hypotheses.length > 0 && renderCollapsibleSection(
            'hypotheses',
            'Test Hypotheses',
            'flask',
            hypotheses.length,
            <View style={styles.sectionContent}>
              {hypotheses.map((h, i) => renderHypothesisCard(h, i))}
            </View>
          )}

          {targets.length > 0 && renderCollapsibleSection(
            'targets',
            'Optimization Targets',
            'trending-up',
            targets.length,
            <View style={styles.sectionContent}>
              {targets.map((t, i) => renderOptimizationCard(t, i))}
            </View>
          )}

          {failedFlags.length > 0 && renderCollapsibleSection(
            'failed',
            'Failed Strategy Flags',
            'close-circle',
            failedFlags.length,
            <View style={styles.sectionContent}>
              {failedFlags.map((f, i) => renderFailedFlag(f, i))}
            </View>
          )}

          {plan.length > 0 && renderCollapsibleSection(
            'plan',
            'Iteration Plan',
            'list',
            plan.length,
            <View style={styles.sectionContent}>
              {plan.map((s, i) => renderPlanStep(s, i))}
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
  headerMeta: { flexDirection: 'row', marginTop: 12, gap: 12 },
  headerMetaItem: { flex: 1 },
  headerMetaLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  headerMetaValue: { fontSize: 14, fontWeight: '700' as const, color: '#fff' },
  emptyState: { borderRadius: 12, padding: 24, alignItems: 'center', marginBottom: 12, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' as const },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  analyzeBtn: { marginBottom: 12 },
  analyzeBtnDisabled: { opacity: 0.5 },
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 14 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  collapsibleSection: { marginBottom: 12 },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1 },
  collapsibleHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapsibleTitle: { fontSize: 14, fontWeight: '600' as const },
  countBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontSize: 11, fontWeight: '700' as const },
  sectionContent: { marginTop: 8 },
  itemCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  itemCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  priorityBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  priorityText: { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  riskBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskText: { fontSize: 11, fontWeight: '500' as const },
  hypothesisText: { fontSize: 13, fontWeight: '500' as const, lineHeight: 18, marginBottom: 10 },
  hypothesisMetaGrid: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  hypothesisMetaItem: { flex: 1, borderRadius: 8, padding: 8 },
  metaLabel: { fontSize: 10, fontWeight: '500' as const, marginBottom: 2 },
  metaValue: { fontSize: 12, fontWeight: '600' as const },
  expectedOutcome: { borderRadius: 8, padding: 8, marginBottom: 8 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  successMetric: { fontSize: 11, fontWeight: '500' as const },
  targetArea: { fontSize: 14, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  effortBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  effortText: { fontSize: 11, fontWeight: '500' as const, textTransform: 'capitalize' as const },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  valueItem: { alignItems: 'center' },
  valueText: { fontSize: 16, fontWeight: '700' as const },
  improvementBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  improvementText: { fontSize: 11, fontWeight: '600' as const },
  strategyText: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confBar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  confBarFill: { height: '100%', borderRadius: 2 },
  confText: { fontSize: 11, fontWeight: '700' as const, width: 32, textAlign: 'right' as const },
  failedHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  failedName: { fontSize: 13, fontWeight: '600' as const },
  retryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  retryText: { fontSize: 11, fontWeight: '500' as const },
  failureReason: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  failureDate: { fontSize: 10, marginTop: 4 },
  retryConditions: { marginTop: 8 },
  conditionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  conditionText: { fontSize: 11, lineHeight: 15 },
  planStep: { flexDirection: 'row', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 13, fontWeight: '700' as const },
  stepContent: { flex: 1 },
  stepAction: { fontSize: 13, fontWeight: '600' as const, marginBottom: 6 },
  stepMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  stepMetaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  stepMetaText: { fontSize: 11 },
  stepCriteria: { borderRadius: 8, padding: 8, marginBottom: 6 },
  fallbackRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fallbackText: { fontSize: 11, fontStyle: 'italic' as const },
  layersSection: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  layerCard: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  layerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  layerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  layerLabel: { fontSize: 13, fontWeight: '500' as const },
  layerScore: { fontSize: 13, fontWeight: '700' as const },
  layerDetails: { paddingHorizontal: 12, paddingBottom: 12 },
  scoreBarBg: { height: 4, borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 2 },
  layerSection: { marginBottom: 8 },
  layerSectionTitle: { fontSize: 12, fontWeight: '600' as const, marginBottom: 4 },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 3 },
  findingText: { fontSize: 12, lineHeight: 16, flex: 1 },
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  warningDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  warningText: { fontSize: 12, lineHeight: 16, flex: 1 },
  gateCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  gateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  gateHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gateTitle: { fontSize: 14, fontWeight: '600' as const },
  gateStatusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  gateMissingBox: { borderRadius: 8, padding: 10, marginBottom: 12, backgroundColor: '#EF444410' },
  gateMissingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  gateMissingText: { fontSize: 12, lineHeight: 16, flex: 1 },
  gateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  gateLabel: { fontSize: 13, fontWeight: '500' as const },
  gateInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 8 },
  gateChipRow: { marginBottom: 4 },
  gateChipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  gateChip: { borderWidth: 1, borderColor: '#76768030', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6 },
  gateChipText: { fontSize: 12, fontWeight: '500' as const },
  gateMetricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  gateMetricItem: { width: '30%' as any, minWidth: 90 },
  gateMetricLabel: { fontSize: 11, fontWeight: '500' as const, marginBottom: 4 },
  gateMetricDisplay: { borderWidth: 1, borderRadius: 8, padding: 8, alignItems: 'center' as const },
  gateMetricValue: { fontSize: 13, fontWeight: '600' as const },
  gateConnectedBox: { borderRadius: 10, padding: 12, marginBottom: 12 },
  gateConnectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  gateConnectedText: { fontSize: 12, fontWeight: '600' as const },
  gateConnectedSubtext: { fontSize: 12, lineHeight: 16, marginTop: 4 },
  gateSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 10, padding: 12 },
  gateSaveBtnText: { fontSize: 13, fontWeight: '600' as const },
});
