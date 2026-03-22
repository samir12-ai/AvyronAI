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
import { getApiUrl, safeApiJson, authFetch } from '@/lib/query-client';
import { useColorScheme } from 'react-native';

interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

interface SignalProvenance {
  signalId: string;
  signalSource: string;
  signalOriginEngine: string;
  signalStrength: number;
  evidenceReference: string;
}

interface ClaimValidation {
  claim: string;
  source: string;
  evidenceType: string;
  evidenceStrength: number;
  supportingSignals: string[];
  contradictingSignals: string[];
  validated: boolean;
  isHypothesis?: boolean;
  signalProvenance?: SignalProvenance | null;
  signalTraceId?: string | null;
  signalPath?: string[];
  parentSignalId?: string | null;
  originEngine?: string | null;
  hopDepth?: number;
}

interface DataReliability {
  signalDensity: number;
  signalDiversity: number;
  narrativeStability: number;
  competitorValidity: number;
  marketMaturityConfidence: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
}

interface ConfidenceExplanation {
  score: number;
  state: string;
  reasoning: string;
  factors: string[];
  actionImplication: "PROCEED" | "PROCEED_WITH_CAUTION" | "HOLD" | "BLOCKED";
}

interface StatisticalValidationData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  claimConfidenceScore?: number;
  evidenceStrength?: number;
  validationState?: "validated" | "provisional" | "weak" | "rejected";
  assumptionFlags?: string[];
  claimValidations?: ClaimValidation[];
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  dataReliability?: DataReliability;
  engineVersion?: number;
  executionTimeMs?: number;
  createdAt?: string;
  hypothesisCount?: number;
  signalBackedClaimCount?: number;
  signalBackedClaimRatio?: number;
  unmappedSignals?: string[];
  lowConfidenceSignals?: string[];
  confidenceExplanation?: ConfidenceExplanation;
}

const LAYER_LABELS: Record<string, string> = {
  evidence_density_assessment: "Evidence Density",
  claim_signal_alignment: "Claim-Signal Alignment",
  narrative_vs_signal_check: "Narrative vs Signal",
  assumption_detection: "Assumption Detection",
  cross_engine_consistency: "Cross-Engine Consistency",
  proof_strength_validation: "Proof Strength",
  confidence_calibration: "Confidence Calibration",
};

const LAYER_ICONS: Record<string, string> = {
  evidence_density_assessment: "stats-chart",
  claim_signal_alignment: "git-compare",
  narrative_vs_signal_check: "swap-horizontal",
  assumption_detection: "alert-circle",
  cross_engine_consistency: "grid",
  proof_strength_validation: "shield-checkmark",
  confidence_calibration: "speedometer",
};

const STATE_CONFIG: Record<string, { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  validated: { color: '#10B981', label: 'Validated', icon: 'checkmark-circle' },
  provisional: { color: '#F59E0B', label: 'Provisional', icon: 'time' },
  weak: { color: '#EF4444', label: 'Weak', icon: 'warning' },
  rejected: { color: '#DC2626', label: 'Rejected', icon: 'close-circle' },
};

const EVIDENCE_TYPE_COLORS: Record<string, string> = {
  signal: '#10B981',
  structured_inference: '#06B6D4',
  narrative: '#3B82F6',
  assumption: '#F59E0B',
  inferred: '#8B5CF6',
};

const PROVENANCE_ENGINE_LABELS: Record<string, string> = {
  market_intelligence: "Market Intelligence",
  audience: "Audience Engine",
  offer: "Offer Engine",
  persuasion: "Persuasion Engine",
  awareness: "Awareness Engine",
  funnel: "Funnel Engine",
};

const PROVENANCE_SOURCE_LABELS: Record<string, string> = {
  market_opportunity: "Market Opportunity",
  market_threat: "Market Threat",
  audience_pain: "Audience Pain",
  audience_desire: "Audience Desire",
  audience_objection: "Objection",
  emotional_driver: "Emotional Driver",
  narrative_objection: "Narrative Objection",
};

const PRIMARY_COLOR = '#06B6D4';
const PRIMARY_DARK = '#0891B2';

export default function StatisticalValidationEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<StatisticalValidationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/strategy/statistical-validation/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await authFetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.result) {
        const r = json.result;
        setData({
          exists: true,
          id: json.id,
          status: json.status,
          statusMessage: json.statusMessage,
          claimConfidenceScore: r.claimConfidenceScore ?? json.confidenceScore,
          evidenceStrength: r.evidenceStrength,
          validationState: r.validationState,
          assumptionFlags: r.assumptionFlags,
          claimValidations: r.claimValidations,
          layerResults: json.layerResults || r.layerResults,
          structuralWarnings: json.structuralWarnings || r.structuralWarnings,
          boundaryCheck: json.boundaryCheck || r.boundaryCheck,
          dataReliability: json.dataReliability || r.dataReliability,
          engineVersion: json.engineVersion,
          executionTimeMs: json.executionTimeMs,
          createdAt: json.createdAt,
          hypothesisCount: r.hypothesisCount,
          signalBackedClaimCount: r.signalBackedClaimCount,
          signalBackedClaimRatio: r.signalBackedClaimRatio,
          unmappedSignals: r.unmappedSignals,
          lowConfidenceSignals: r.lowConfidenceSignals,
          confidenceExplanation: r.confidenceExplanation,
        });
      } else {
        setData(json);
      }
    } catch (err) {
      console.error('[StatisticalValidation] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) fetchLatest();
  }, [isActive, fetchLatest]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) {
      Alert.alert('No Campaign', 'Please select a campaign first.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/strategy/statistical-validation/analyze', getApiUrl());
      const res = await authFetch(url.toString(), {
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

  const renderClaimCard = (claim: ClaimValidation, index: number) => {
    const isHyp = claim.isHypothesis === true;
    const evColor = isHyp ? '#9CA3AF' : (EVIDENCE_TYPE_COLORS[claim.evidenceType] || '#6B7280');
    const strengthPercent = Math.round(claim.evidenceStrength * 100);

    const evLabel = isHyp
      ? 'hypothesis'
      : claim.evidenceType === 'structured_inference'
        ? 'engine signal'
        : claim.evidenceType;

    return (
      <View key={index} style={[styles.claimCard, { backgroundColor: colors.card, borderLeftColor: isHyp ? '#9CA3AF' : (claim.validated ? '#10B981' : '#EF4444') }]}>
        <View style={styles.claimHeader}>
          <Ionicons
            name={isHyp ? "help-circle" : (claim.validated ? "checkmark-circle" : "close-circle")}
            size={14}
            color={isHyp ? '#9CA3AF' : (claim.validated ? '#10B981' : '#EF4444')}
          />
          <Text style={[styles.claimText, { color: colors.text }]} numberOfLines={2}>{claim.claim}</Text>
        </View>
        <View style={styles.claimMeta}>
          <View style={[styles.evidenceTypeBadge, { backgroundColor: evColor + '15' }]}>
            <Text style={[styles.evidenceTypeText, { color: evColor }]}>{evLabel}</Text>
          </View>
          <Text style={[styles.claimSource, { color: colors.textMuted }]}>{claim.source.replace(/_/g, ' ')}</Text>
          {!isHyp && (
            <View style={[styles.strengthPill, { backgroundColor: scoreColor(claim.evidenceStrength) + '15' }]}>
              <Text style={[styles.strengthPillText, { color: scoreColor(claim.evidenceStrength) }]}>{strengthPercent}%</Text>
            </View>
          )}
        </View>
        {claim.signalTraceId && (
          <View style={styles.traceIdRow}>
            <Text style={[styles.traceIdText, { color: colors.textMuted }]}>ID: {claim.signalTraceId}</Text>
            {claim.signalPath && claim.signalPath.length > 0 && (
              <View style={styles.signalPathRow}>
                <Ionicons name="git-branch" size={10} color="#8B5CF6" />
                <Text style={[styles.signalPathText, { color: '#8B5CF6' }]}>
                  {claim.signalPath.map(p => PROVENANCE_ENGINE_LABELS[p] || p).join(' → ')}
                </Text>
              </View>
            )}
          </View>
        )}
        {(claim.parentSignalId || claim.originEngine) && (
          <View style={[styles.lineageRow, { backgroundColor: '#6366F110' }]}>
            <Ionicons name="git-merge" size={10} color="#6366F1" />
            <Text style={[styles.lineageText, { color: '#6366F1' }]} numberOfLines={1}>
              {PROVENANCE_ENGINE_LABELS[claim.originEngine || ''] || claim.originEngine || 'unknown'}
              {claim.parentSignalId ? ` → parent: ${claim.parentSignalId}` : ''}
              {(claim.hopDepth ?? 0) > 0 ? ` (${claim.hopDepth} hop${(claim.hopDepth ?? 0) > 1 ? 's' : ''})` : ' (source)'}
            </Text>
          </View>
        )}
        {claim.signalProvenance && (
          <View style={[styles.provenanceRow, { backgroundColor: '#10B98110' }]}>
            <Ionicons name="link" size={10} color="#10B981" />
            <Text style={[styles.provenanceText, { color: '#10B981' }]} numberOfLines={2}>
              {PROVENANCE_ENGINE_LABELS[claim.signalProvenance.signalOriginEngine] || claim.signalProvenance.signalOriginEngine}
              {' → '}
              {PROVENANCE_SOURCE_LABELS[claim.signalProvenance.signalSource] || claim.signalProvenance.signalSource}
              {': '}
              {claim.signalProvenance.evidenceReference}
            </Text>
          </View>
        )}
        {!isHyp && claim.supportingSignals.length > 0 && (
          <View style={styles.signalSection}>
            {claim.supportingSignals.slice(0, 2).map((s, i) => (
              <View key={i} style={styles.signalRow}>
                <Ionicons name="add-circle" size={10} color="#10B981" />
                <Text style={[styles.signalText, { color: colors.textSecondary }]} numberOfLines={1}>{s}</Text>
              </View>
            ))}
          </View>
        )}
        {claim.contradictingSignals.length > 0 && (
          <View style={styles.signalSection}>
            {claim.contradictingSignals.slice(0, 2).map((s, i) => (
              <View key={i} style={styles.signalRow}>
                <Ionicons name="remove-circle" size={10} color="#EF4444" />
                <Text style={[styles.signalText, { color: colors.textSecondary }]} numberOfLines={1}>{s}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderReliabilitySection = (reliability: DataReliability) => {
    const isExpanded = expandedSection === 'reliability';
    const metrics = [
      { label: 'Signal Density', value: reliability.signalDensity },
      { label: 'Signal Diversity', value: reliability.signalDiversity },
      { label: 'Narrative Stability', value: reliability.narrativeStability },
      { label: 'Competitor Validity', value: reliability.competitorValidity },
      { label: 'Market Maturity', value: reliability.marketMaturityConfidence },
    ];

    return (
      <View style={[styles.reliabilityCard, { backgroundColor: colors.card, borderColor: reliability.isWeak ? '#EF444430' : PRIMARY_COLOR + '30' }]}>
        <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedSection(isExpanded ? null : 'reliability'); }} style={styles.reliabilityHeader}>
          <View style={styles.reliabilityHeaderLeft}>
            <Ionicons name="pulse" size={16} color={reliability.isWeak ? '#EF4444' : PRIMARY_COLOR} />
            <Text style={[styles.reliabilityTitle, { color: colors.text }]}>Data Reliability</Text>
            <View style={[styles.reliabilityBadge, { backgroundColor: (reliability.isWeak ? '#EF4444' : '#10B981') + '15' }]}>
              <Text style={[styles.reliabilityBadgeText, { color: reliability.isWeak ? '#EF4444' : '#10B981' }]}>
                {Math.round(reliability.overallReliability * 100)}%
              </Text>
            </View>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
        </Pressable>

        {isExpanded && (
          <View style={styles.reliabilityDetails}>
            {metrics.map((m, i) => (
              <View key={i} style={styles.reliabilityMetric}>
                <Text style={[styles.reliabilityMetricLabel, { color: colors.textMuted }]}>{m.label}</Text>
                <View style={styles.reliabilityBarContainer}>
                  <View style={[styles.reliabilityBarBg, { backgroundColor: colors.cardBorder }]}>
                    <View style={[styles.reliabilityBarFill, { width: `${Math.round(m.value * 100)}%`, backgroundColor: scoreColor(m.value) }]} />
                  </View>
                  <Text style={[styles.reliabilityMetricValue, { color: scoreColor(m.value) }]}>{Math.round(m.value * 100)}%</Text>
                </View>
              </View>
            ))}
            {reliability.advisories.length > 0 && (
              <View style={styles.advisoriesSection}>
                {reliability.advisories.map((a, i) => (
                  <View key={i} style={styles.advisoryRow}>
                    <Ionicons name="information-circle" size={12} color="#F59E0B" />
                    <Text style={[styles.advisoryText, { color: colors.textSecondary }]}>{a}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderLayerCard = (layer: LayerResult) => {
    const isExpanded = expandedLayer === layer.layerName;
    const icon = LAYER_ICONS[layer.layerName] || "ellipse";
    const label = LAYER_LABELS[layer.layerName] || layer.layerName;
    const scorePercent = Math.round(layer.score * 100);
    const sc = scoreColor(layer.score);

    return (
      <View key={layer.layerName} style={[styles.layerCard, { backgroundColor: colors.card, borderLeftColor: sc }]}>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setExpandedLayer(isExpanded ? null : layer.layerName); }}
          style={styles.layerHeader}
        >
          <View style={styles.layerHeaderLeft}>
            <Ionicons name={icon as any} size={16} color={sc} />
            <Text style={[styles.layerLabel, { color: colors.text }]}>{label}</Text>
          </View>
          <View style={styles.layerHeaderRight}>
            <View style={[styles.layerScorePill, { backgroundColor: sc + '15' }]}>
              <Text style={[styles.layerScoreText, { color: sc }]}>{scorePercent}%</Text>
            </View>
            {layer.passed ? (
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            ) : (
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
            )}
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={styles.layerDetails}>
            {layer.findings.map((f, i) => (
              <View key={`f-${i}`} style={styles.findingRow}>
                <Ionicons name="checkmark" size={12} color="#10B981" />
                <Text style={[styles.findingText, { color: colors.text }]}>{f}</Text>
              </View>
            ))}
            {layer.warnings.map((w, i) => (
              <View key={`w-${i}`} style={styles.findingRow}>
                <Ionicons name="warning" size={12} color="#F59E0B" />
                <Text style={[styles.findingText, { color: '#F59E0B' }]}>{w}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  if (loading && !data) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </View>
    );
  }

  const hasData = data?.exists && data.layerResults;
  const confidencePercent = Math.round((data?.claimConfidenceScore || 0) * 100);
  const evidencePercent = Math.round((data?.evidenceStrength || 0) * 100);
  const validationState = data?.validationState || 'weak';
  const stateConfig = STATE_CONFIG[validationState] || STATE_CONFIG.weak;
  const passedLayers = data?.layerResults?.filter(l => l.passed).length || 0;
  const totalLayers = data?.layerResults?.length || 7;

  const signalBackedClaims = (data?.claimValidations || []).filter(c => !c.isHypothesis);
  const hypothesisClaims = (data?.claimValidations || []).filter(c => c.isHypothesis === true);
  const signalRatioPercent = data?.signalBackedClaimRatio != null
    ? Math.round(data.signalBackedClaimRatio * 100)
    : (data?.claimValidations?.length
      ? Math.round((signalBackedClaims.length / data.claimValidations.length) * 100)
      : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={[PRIMARY_COLOR, PRIMARY_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="stats-chart" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Statistical Validation</Text>
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
              <Text style={styles.headerMetaValue}>{confidencePercent}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Evidence</Text>
              <Text style={styles.headerMetaValue}>{evidencePercent}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>State</Text>
              <Text style={[styles.headerMetaValue, { color: stateConfig.color }]}>{stateConfig.label}</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Signal %</Text>
              <Text style={[styles.headerMetaValue, { color: signalRatioPercent >= 75 ? '#10B981' : '#EF4444' }]}>{signalRatioPercent}%</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="stats-chart-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Statistical Validation</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run statistical validation to verify claims, assess evidence strength, and detect assumptions across your strategy engines.
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing}
        style={[styles.analyzeBtn]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : [PRIMARY_COLOR, PRIMARY_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Validating Claims...</Text>
            </>
          ) : (
            <>
              <Ionicons name="stats-chart" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Re-validate' : 'Run Validation'}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      {hasData && (
        <>
          <View style={[styles.stateCard, { backgroundColor: colors.card, borderColor: stateConfig.color + '30' }]}>
            <View style={styles.stateRow}>
              <View style={[styles.stateBadge, { backgroundColor: stateConfig.color + '15' }]}>
                <Ionicons name={stateConfig.icon} size={16} color={stateConfig.color} />
                <Text style={[styles.stateBadgeText, { color: stateConfig.color }]}>{stateConfig.label}</Text>
              </View>
              <View style={styles.scoreRow}>
                <View style={styles.scoreItem}>
                  <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>Confidence</Text>
                  <Text style={[styles.scoreValue, { color: scoreColor(data?.claimConfidenceScore || 0) }]}>{confidencePercent}%</Text>
                </View>
                <View style={styles.scoreItem}>
                  <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>Evidence</Text>
                  <Text style={[styles.scoreValue, { color: scoreColor(data?.evidenceStrength || 0) }]}>{evidencePercent}%</Text>
                </View>
              </View>
            </View>
          </View>

          {data.confidenceExplanation && (
            <View style={[styles.confidenceExplanationCard, {
              backgroundColor: colors.card,
              borderColor: (
                data.confidenceExplanation.actionImplication === 'PROCEED' ? '#10B981' :
                data.confidenceExplanation.actionImplication === 'PROCEED_WITH_CAUTION' ? '#F59E0B' :
                data.confidenceExplanation.actionImplication === 'HOLD' ? '#FF9500' :
                '#EF4444'
              ) + '30',
            }]}>
              <View style={styles.ceHeader}>
                <Ionicons name="bulb" size={16} color={
                  data.confidenceExplanation.actionImplication === 'PROCEED' ? '#10B981' :
                  data.confidenceExplanation.actionImplication === 'PROCEED_WITH_CAUTION' ? '#F59E0B' :
                  data.confidenceExplanation.actionImplication === 'HOLD' ? '#FF9500' :
                  '#EF4444'
                } />
                <Text style={[styles.ceTitle, { color: colors.text }]}>Confidence Interpretation</Text>
                <View style={[styles.ceImplicationBadge, {
                  backgroundColor: (
                    data.confidenceExplanation.actionImplication === 'PROCEED' ? '#10B981' :
                    data.confidenceExplanation.actionImplication === 'PROCEED_WITH_CAUTION' ? '#F59E0B' :
                    data.confidenceExplanation.actionImplication === 'HOLD' ? '#FF9500' :
                    '#EF4444'
                  ) + '15',
                }]}>
                  <Text style={[styles.ceImplicationText, {
                    color: data.confidenceExplanation.actionImplication === 'PROCEED' ? '#10B981' :
                      data.confidenceExplanation.actionImplication === 'PROCEED_WITH_CAUTION' ? '#F59E0B' :
                      data.confidenceExplanation.actionImplication === 'HOLD' ? '#FF9500' :
                      '#EF4444',
                  }]}>
                    {data.confidenceExplanation.actionImplication.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
              <Text style={[styles.ceReasoning, { color: colors.textSecondary }]}>
                {data.confidenceExplanation.reasoning}
              </Text>
              {data.confidenceExplanation.factors.length > 0 && (
                <View style={styles.ceFactors}>
                  {data.confidenceExplanation.factors.map((f, i) => (
                    <View key={i} style={styles.ceFactorRow}>
                      <View style={[styles.ceFactorDot, { backgroundColor: PRIMARY_COLOR }]} />
                      <Text style={[styles.ceFactorText, { color: colors.textMuted }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {signalRatioPercent < 75 && (
            <View style={[styles.warningBox, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
              <Ionicons name="shield" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#EF4444' }]}>Signal Grounding Below Threshold</Text>
                <Text style={[styles.warningDetail, { color: '#DC2626' }]}>
                  Only {signalRatioPercent}% of claims are signal-backed (minimum 75% required). Strategy remains provisional until additional signal evidence is provided.
                </Text>
              </View>
            </View>
          )}

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

          {data.assumptionFlags && data.assumptionFlags.length > 0 && (
            <View style={[styles.assumptionsCard, { backgroundColor: colors.card, borderColor: '#F59E0B30' }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="flag" size={16} color="#F59E0B" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Assumption Flags ({data.assumptionFlags.length})</Text>
              </View>
              {data.assumptionFlags.map((flag, i) => (
                <View key={i} style={styles.assumptionRow}>
                  <View style={[styles.assumptionDot, { backgroundColor: '#F59E0B' }]} />
                  <Text style={[styles.assumptionText, { color: colors.textSecondary }]}>{flag}</Text>
                </View>
              ))}
            </View>
          )}

          {signalBackedClaims.length > 0 && (
            <View style={styles.claimsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkmark-done" size={16} color="#10B981" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Signal-Backed Claims ({signalBackedClaims.filter(c => c.validated).length}/{signalBackedClaims.length} verified)
                </Text>
              </View>
              {signalBackedClaims.map((claim, i) => renderClaimCard(claim, i))}
            </View>
          )}

          {hypothesisClaims.length > 0 && (
            <View style={styles.claimsSection}>
              <View style={styles.sectionHeader}>
                <Ionicons name="help-circle" size={16} color="#9CA3AF" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Hypotheses ({hypothesisClaims.length}) — excluded from scoring
                </Text>
              </View>
              <View style={[styles.hypothesisNotice, { backgroundColor: '#9CA3AF10' }]}>
                <Text style={[styles.hypothesisNoticeText, { color: colors.textMuted }]}>
                  These claims have no traceable signal chain and are stored as hypotheses. They do not affect validation scores. Ground them with market signals to convert them to validated claims.
                </Text>
              </View>
              {hypothesisClaims.map((claim, i) => renderClaimCard(claim, i))}
            </View>
          )}

          {data.dataReliability && renderReliabilitySection(data.dataReliability)}

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

          {data.unmappedSignals && data.unmappedSignals.length > 0 && (
            <View style={[styles.warningsBox, { backgroundColor: colors.card, borderColor: '#8B5CF630' }]}>
              <View style={styles.warningsHeader}>
                <Ionicons name="git-branch" size={16} color="#8B5CF6" />
                <Text style={[styles.warningsTitle, { color: '#8B5CF6' }]}>
                  Signal Diagnostics — Unmapped ({data.unmappedSignals.length})
                </Text>
              </View>
              <View style={[styles.hypothesisNotice, { backgroundColor: '#8B5CF610' }]}>
                <Text style={[styles.hypothesisNoticeText, { color: colors.textMuted }]}>
                  These claims could not be matched to any canonical signal cluster. They need additional market or audience signals to become grounded.
                </Text>
              </View>
              {data.unmappedSignals.map((us, i) => (
                <View key={i} style={styles.warningRow}>
                  <View style={[styles.warningDot, { backgroundColor: '#8B5CF6' }]} />
                  <Text style={[styles.warningText, { color: colors.textSecondary }]}>{us}</Text>
                </View>
              ))}
            </View>
          )}

          {data.lowConfidenceSignals && data.lowConfidenceSignals.length > 0 && (
            <View style={[styles.warningsBox, { backgroundColor: colors.card, borderColor: '#FF950030' }]}>
              <View style={styles.warningsHeader}>
                <Ionicons name="trending-down" size={16} color="#FF9500" />
                <Text style={[styles.warningsTitle, { color: '#FF9500' }]}>
                  Low-Confidence Signals ({data.lowConfidenceSignals.length})
                </Text>
              </View>
              <View style={[styles.hypothesisNotice, { backgroundColor: '#FF950010' }]}>
                <Text style={[styles.hypothesisNoticeText, { color: colors.textMuted }]}>
                  These signals matched a cluster but fell below the 75% confidence threshold. They are excluded from validation scoring until stronger evidence is available.
                </Text>
              </View>
              {data.lowConfidenceSignals.map((ls, i) => (
                <View key={i} style={styles.warningRow}>
                  <View style={[styles.warningDot, { backgroundColor: '#FF9500' }]} />
                  <Text style={[styles.warningText, { color: colors.textSecondary }]}>{ls}</Text>
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
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 14 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#fff' },
  stateCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  stateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  stateBadgeText: { fontSize: 13, fontWeight: '600' as const },
  scoreRow: { flexDirection: 'row', gap: 16 },
  scoreItem: { alignItems: 'center' },
  scoreLabel: { fontSize: 10, marginBottom: 2 },
  scoreValue: { fontSize: 16, fontWeight: '700' as const },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  assumptionsCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  assumptionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  assumptionDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  assumptionText: { fontSize: 13, flex: 1, lineHeight: 18 },
  claimsSection: { marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '600' as const },
  claimCard: { borderRadius: 10, borderLeftWidth: 3, padding: 12, marginBottom: 8 },
  claimHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  claimText: { fontSize: 13, fontWeight: '500' as const, flex: 1, lineHeight: 18 },
  claimMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  evidenceTypeBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  evidenceTypeText: { fontSize: 10, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  claimSource: { fontSize: 11, flex: 1 },
  strengthPill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  strengthPillText: { fontSize: 11, fontWeight: '600' as const },
  traceIdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 },
  traceIdText: { fontSize: 10 },
  signalPathRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  signalPathText: { fontSize: 10, flex: 1 },
  lineageRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, padding: 6, borderRadius: 6 },
  lineageText: { fontSize: 10, flex: 1 },
  provenanceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6, padding: 6, borderRadius: 6 },
  provenanceText: { fontSize: 11, flex: 1, lineHeight: 16 },
  hypothesisNotice: { padding: 10, borderRadius: 8, marginBottom: 8 },
  hypothesisNoticeText: { fontSize: 12, lineHeight: 17 },
  signalSection: { marginTop: 6 },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  signalText: { fontSize: 11, flex: 1 },
  reliabilityCard: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  reliabilityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  reliabilityHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reliabilityTitle: { fontSize: 14, fontWeight: '600' as const },
  reliabilityBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  reliabilityBadgeText: { fontSize: 11, fontWeight: '600' as const },
  reliabilityDetails: { padding: 14, paddingTop: 0 },
  reliabilityMetric: { marginBottom: 10 },
  reliabilityMetricLabel: { fontSize: 11, marginBottom: 4 },
  reliabilityBarContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reliabilityBarBg: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  reliabilityBarFill: { height: 6, borderRadius: 3 },
  reliabilityMetricValue: { fontSize: 12, fontWeight: '600' as const, width: 36, textAlign: 'right' as const },
  advisoriesSection: { marginTop: 4 },
  advisoryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  advisoryText: { fontSize: 12, flex: 1, lineHeight: 16 },
  layersSection: { marginBottom: 16 },
  layerCard: { borderRadius: 10, borderLeftWidth: 3, marginBottom: 8, overflow: 'hidden' },
  layerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  layerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  layerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  layerLabel: { fontSize: 13, fontWeight: '500' as const },
  layerScorePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  layerScoreText: { fontSize: 11, fontWeight: '600' as const },
  layerDetails: { paddingHorizontal: 12, paddingBottom: 12 },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  findingText: { fontSize: 12, flex: 1, lineHeight: 16 },
  warningsBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  warningsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  warningsTitle: { fontSize: 13, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  warningDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  warningText: { fontSize: 12, flex: 1, lineHeight: 16 },
  confidenceExplanationCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  ceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  ceTitle: { fontSize: 14, fontWeight: '600' as const, flex: 1 },
  ceImplicationBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  ceImplicationText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  ceReasoning: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  ceFactors: { gap: 4 },
  ceFactorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  ceFactorDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 5 },
  ceFactorText: { fontSize: 12, flex: 1, lineHeight: 16 },
});
