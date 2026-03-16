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
import { normalizeEngineSnapshot, isEngineReady } from '@/lib/engine-snapshot';
import { useColorScheme } from 'react-native';

interface OfferDepthScores {
  outcomeClarity: number;
  mechanismCredibility: number;
  proofStrength: number;
  differentiationSupport: number;
  marketDemandAlignment: number;
  audienceTrustCompatibility: number;
  executionFeasibility: number;
  buyerFrictionLevel: number;
}

interface OfferCandidate {
  offerName: string;
  coreOutcome: string;
  mechanismDescription: string;
  deliverables: string[];
  proofAlignment: string[];
  audienceFitExplanation: string;
  offerStrengthScore: number;
  riskNotes: string[];
  problemStatement?: string;
  proofPath?: string[];
  objectionHandling?: string[];
  completeness: { complete: boolean; missingLayers: string[] };
  genericFlag: boolean;
  integrityResult: { passed: boolean; failures: string[] };
  frictionLevel: number;
  depthScores: OfferDepthScores;
}

interface SourceContext {
  selectedAxis: string;
  selectedPain: string;
  selectedDesire: string;
  selectedMechanism: string;
  selectedTransformation: string;
  selectedProofTypes: string[];
  selectedObjections: string[];
}

interface IntegrityChecks {
  rootSynced: boolean;
  axisAligned: boolean;
  painAligned: boolean;
  mechanismAligned: boolean;
  proofAligned: boolean;
  integrityPassed: boolean;
}

interface LayerDiagnostics {
  mechanismEngineConsumed?: boolean;
  axisEnrichment?: { original: string; enriched: string; mechanismAxis: string; emphasis: string[] };
  sourceContext?: SourceContext;
  integrityChecks?: IntegrityChecks;
  strategyRoot?: any;
  [key: string]: any;
}

interface OfferData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  primaryOffer?: OfferCandidate;
  alternativeOffer?: OfferCandidate;
  rejectedOffer?: { offer: OfferCandidate; rejectionReason: string };
  offerStrengthScore?: number;
  positioningConsistency?: { consistent: boolean; contradictions: string[] };
  hookMechanismAlignment?: { aligned: boolean; failures: string[]; hookAxis: string | null; mechanismAxis: string | null };
  boundaryCheck?: { passed: boolean; violations: string[] };
  confidenceScore?: number;
  engineVersion?: number;
  selectedOption?: string | null;
  structuralWarnings?: string[];
  layerDiagnostics?: LayerDiagnostics;
  mechanismSnapshotId?: string;
  strategyRootId?: string;
  createdAt?: string;
  rootSyncStatus?: 'synced' | 'stale' | 'no_root';
  activeRootId?: string | null;
  activeRootHash?: string | null;
}

export default function OfferEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeSection, setActiveSection] = useState<'primary' | 'alternative' | 'rejected'>('primary');
  const [selecting, setSelecting] = useState(false);
  const [strategyRoot, setStrategyRoot] = useState<any>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/offer-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch (err) {
      console.error('[OfferEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchStrategyRoot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/strategy-root/active', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setStrategyRoot(json);
    } catch (err) {
      console.error('[OfferEngine] Strategy root fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchStrategyRoot();
    }
  }, [isActive, fetchLatest, fetchStrategyRoot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId) return;

    if (!strategyRoot?.exists) {
      Alert.alert('No Strategy Root', 'Complete the full pipeline (Product DNA, MI, Audience, Positioning, Differentiation, Mechanism) to create a Strategy Root before generating offers.');
      return;
    }

    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/offer-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId }),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await fetchLatest();
        await fetchStrategyRoot();
      } else {
        if (json.error === 'NO_ACTIVE_STRATEGY_ROOT') {
          Alert.alert('Strategy Root Required', 'No active Strategy Root found. Run the Mechanism Engine first to create one.');
        } else if (json.error === 'STRATEGY_ROOT_INCOMPLETE') {
          Alert.alert('Incomplete Root', json.message || 'Strategy Root is missing required fields.');
        } else {
          Alert.alert('Analysis Failed', json.message || json.error || 'Unknown error');
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedCampaignId, strategyRoot, fetchLatest, fetchStrategyRoot]);

  const selectOption = useCallback(async (option: 'primary' | 'alternative') => {
    if (!data?.id) return;
    setSelecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const url = new URL('/api/offer-engine/select', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: data.id, selectedOption: option, campaignId: selectedCampaignId }),
      });
      const json = await safeApiJson(res);
      if (json.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setData(prev => prev ? { ...prev, selectedOption: option } : prev);
      } else {
        Alert.alert('Selection Failed', json.message || json.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Selection failed');
    } finally {
      setSelecting(false);
    }
  }, [data?.id, selectedCampaignId]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderScoreBar = (label: string, value: number) => (
    <View style={styles.scoreRow}>
      <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.scoreBarContainer}>
        <View style={[styles.scoreBarBg, { backgroundColor: colors.cardBorder }]}>
          <View style={[styles.scoreBarFill, { width: `${Math.round(value * 100)}%`, backgroundColor: scoreColor(value) }]} />
        </View>
        <Text style={[styles.scoreValue, { color: colors.text }]}>{Math.round(value * 100)}%</Text>
      </View>
    </View>
  );

  const renderIntegrityItem = (label: string, passed: boolean) => (
    <View style={styles.integrityItem}>
      <Ionicons name={passed ? 'checkmark-circle' : 'close-circle'} size={14} color={passed ? '#10B981' : '#EF4444'} />
      <Text style={[styles.integrityLabel, { color: passed ? '#10B981' : '#EF4444' }]}>{label}</Text>
    </View>
  );

  const renderSourceContextCard = () => {
    const ctx = data?.layerDiagnostics?.sourceContext;
    if (!ctx) return null;

    return (
      <View style={[styles.contextCard, { backgroundColor: colors.card, borderColor: '#8B5CF630' }]}>
        <View style={styles.contextHeader}>
          <Ionicons name="layers" size={16} color="#8B5CF6" />
          <Text style={[styles.contextTitle, { color: '#8B5CF6' }]}>Offer Source Context</Text>
        </View>
        <View style={styles.contextGrid}>
          <View style={styles.contextRow}>
            <Text style={[styles.contextKey, { color: colors.textMuted }]}>Axis</Text>
            <Text style={[styles.contextVal, { color: colors.text }]}>{ctx.selectedAxis}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={[styles.contextKey, { color: colors.textMuted }]}>Pain</Text>
            <Text style={[styles.contextVal, { color: colors.text }]} numberOfLines={2}>{ctx.selectedPain}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={[styles.contextKey, { color: colors.textMuted }]}>Desired Outcome</Text>
            <Text style={[styles.contextVal, { color: colors.text }]} numberOfLines={2}>{ctx.selectedDesire}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={[styles.contextKey, { color: colors.textMuted }]}>Mechanism</Text>
            <Text style={[styles.contextVal, { color: colors.text }]}>{ctx.selectedMechanism}</Text>
          </View>
          <View style={styles.contextRow}>
            <Text style={[styles.contextKey, { color: colors.textMuted }]}>Transformation</Text>
            <Text style={[styles.contextVal, { color: colors.text }]} numberOfLines={2}>{ctx.selectedTransformation}</Text>
          </View>
          {Array.isArray(ctx.selectedProofTypes) && ctx.selectedProofTypes.length > 0 && (
            <View style={styles.contextRow}>
              <Text style={[styles.contextKey, { color: colors.textMuted }]}>Proof Path</Text>
              <View style={styles.tagRow}>
                {ctx.selectedProofTypes.slice(0, 4).map((p, i) => (
                  <View key={i} style={[styles.miniTag, { backgroundColor: '#3B82F618' }]}>
                    <Text style={[styles.miniTagText, { color: '#3B82F6' }]}>{p.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderIntegrityStatusCard = () => {
    const checks = data?.layerDiagnostics?.integrityChecks;
    if (!checks) return null;

    const allPassed = checks.integrityPassed;
    const borderColor = allPassed ? '#10B98130' : '#EF444430';
    const headerColor = allPassed ? '#10B981' : '#EF4444';

    return (
      <View style={[styles.contextCard, { backgroundColor: colors.card, borderColor }]}>
        <View style={styles.contextHeader}>
          <Ionicons name={allPassed ? 'shield-checkmark' : 'shield'} size={16} color={headerColor} />
          <Text style={[styles.contextTitle, { color: headerColor }]}>
            {allPassed ? 'Offer Integrity Passed' : 'Offer Integrity Issues'}
          </Text>
        </View>
        <View style={styles.integrityGrid}>
          {renderIntegrityItem('Root Synced', checks.rootSynced)}
          {renderIntegrityItem('Axis Aligned', checks.axisAligned)}
          {renderIntegrityItem('Pain Aligned', checks.painAligned)}
          {renderIntegrityItem('Mechanism Aligned', checks.mechanismAligned)}
          {renderIntegrityItem('Proof Aligned', checks.proofAligned)}
          {renderIntegrityItem('Final Integrity', checks.integrityPassed)}
        </View>
      </View>
    );
  };

  const renderOfferCard = (offer: OfferCandidate, variant: 'primary' | 'alternative' | 'rejected') => {
    const borderColor = variant === 'primary' ? '#10B981' : variant === 'alternative' ? '#3B82F6' : '#EF4444';
    const rejectionReason = variant === 'rejected' ? data?.rejectedOffer?.rejectionReason : null;
    const isSelected = data?.selectedOption === variant;

    const aiOfferData = data?.layerDiagnostics?.aiGeneration as any;
    const offerExtras = aiOfferData?.mode === 'skeleton_refinement' ? true : false;

    return (
      <View style={[styles.offerCard, { backgroundColor: colors.card, borderColor: borderColor + '40' }]}>
        <View style={styles.offerHeader}>
          <View style={styles.offerHeaderLeft}>
            <View style={[styles.offerBadge, { backgroundColor: borderColor + '20' }]}>
              <Ionicons
                name={variant === 'primary' ? 'star' : variant === 'alternative' ? 'swap-horizontal' : 'close-circle'}
                size={14}
                color={borderColor}
              />
              <Text style={[styles.offerBadgeText, { color: borderColor }]}>
                {variant === 'primary' ? 'Primary' : variant === 'alternative' ? 'Alternative' : 'Rejected'}
              </Text>
            </View>
            {isSelected && (
              <View style={[styles.selectedBadge, { backgroundColor: '#10B98120' }]}>
                <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                <Text style={[styles.selectedBadgeText, { color: '#10B981' }]}>Selected</Text>
              </View>
            )}
          </View>
          {offer.genericFlag && (
            <View style={[styles.warningBadge, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="warning" size={12} color="#F59E0B" />
              <Text style={[styles.warningBadgeText, { color: '#F59E0B' }]}>Generic</Text>
            </View>
          )}
        </View>

        <Text style={[styles.structureLabel, { color: '#F97316' }]}>Hook</Text>
        <Text style={[styles.offerName, { color: colors.text }]}>{offer.offerName}</Text>

        {offer.problemStatement ? (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 10 }]}>Problem</Text>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{offer.problemStatement}</Text>
          </>
        ) : null}

        <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 10 }]}>Promise / Outcome</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{offer.coreOutcome}</Text>

        <View style={styles.offerMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="fitness" size={14} color={scoreColor(offer.offerStrengthScore)} />
            <Text style={[styles.metaText, { color: colors.text }]}>
              Strength: {Math.round(offer.offerStrengthScore * 100)}%
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="speedometer" size={14} color={scoreColor(1 - offer.frictionLevel)} />
            <Text style={[styles.metaText, { color: colors.text }]}>
              Friction: {Math.round(offer.frictionLevel * 100)}%
            </Text>
          </View>
        </View>

        {rejectionReason && (
          <View style={[styles.rejectionBox, { backgroundColor: '#EF444410' }]}>
            <Ionicons name="close-circle" size={14} color="#EF4444" />
            <Text style={[styles.rejectionText, { color: '#EF4444' }]}>{rejectionReason}</Text>
          </View>
        )}

        <View style={styles.sectionDivider} />

        <Text style={[styles.structureLabel, { color: '#F97316' }]}>Mechanism</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{offer.mechanismDescription}</Text>

        {offer.deliverables.length > 0 && (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 12 }]}>Deliverables</Text>
            {offer.deliverables.map((d, i) => (
              <View key={i} style={styles.deliverableRow}>
                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                <Text style={[styles.deliverableText, { color: colors.textSecondary }]}>{d}</Text>
              </View>
            ))}
          </>
        )}

        {(offer.proofPath && offer.proofPath.length > 0) ? (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 12 }]}>Proof Path</Text>
            {offer.proofPath.map((p, i) => (
              <View key={i} style={styles.deliverableRow}>
                <Ionicons name="shield-checkmark" size={14} color="#3B82F6" />
                <Text style={[styles.deliverableText, { color: colors.textSecondary }]}>{p}</Text>
              </View>
            ))}
          </>
        ) : offer.proofAlignment.length > 0 ? (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 12 }]}>Proof Path</Text>
            <View style={styles.tagRow}>
              {offer.proofAlignment.map((p, i) => (
                <View key={i} style={[styles.tag, { backgroundColor: '#3B82F620' }]}>
                  <Text style={[styles.tagText, { color: '#3B82F6' }]}>{p.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {(offer.objectionHandling && offer.objectionHandling.length > 0) ? (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 12 }]}>Objection Handling</Text>
            {offer.objectionHandling.map((o, i) => (
              <View key={i} style={styles.riskRow}>
                <Ionicons name="chatbubble-ellipses" size={14} color="#8B5CF6" />
                <Text style={[styles.riskText, { color: colors.textMuted }]}>{o}</Text>
              </View>
            ))}
          </>
        ) : offer.riskNotes.length > 0 && variant !== 'rejected' ? (
          <>
            <Text style={[styles.structureLabel, { color: '#F97316', marginTop: 12 }]}>Risk Notes</Text>
            {offer.riskNotes.map((r, i) => (
              <View key={i} style={styles.riskRow}>
                <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                <Text style={[styles.riskText, { color: colors.textMuted }]}>{r}</Text>
              </View>
            ))}
          </>
        ) : null}

        <View style={styles.sectionDivider} />

        <Text style={[styles.structureLabel, { color: colors.text }]}>Depth Analysis</Text>
        {renderScoreBar('Outcome Clarity', offer.depthScores.outcomeClarity)}
        {renderScoreBar('Mechanism Credibility', offer.depthScores.mechanismCredibility)}
        {renderScoreBar('Proof Strength', offer.depthScores.proofStrength)}
        {renderScoreBar('Differentiation Support', offer.depthScores.differentiationSupport)}
        {renderScoreBar('Market Demand', offer.depthScores.marketDemandAlignment)}
        {renderScoreBar('Audience Trust', offer.depthScores.audienceTrustCompatibility)}
        {renderScoreBar('Execution Feasibility', offer.depthScores.executionFeasibility)}
        {renderScoreBar('Buyer Friction', offer.depthScores.buyerFrictionLevel)}

        <View style={styles.sectionDivider} />

        <View style={styles.statusRow}>
          <Ionicons
            name={offer.completeness.complete ? 'checkmark-circle' : 'warning'}
            size={16}
            color={offer.completeness.complete ? '#10B981' : '#F59E0B'}
          />
          <Text style={[styles.statusText, { color: offer.completeness.complete ? '#10B981' : '#F59E0B' }]}>
            {offer.completeness.complete ? 'All 5 layers complete' : `Missing: ${offer.completeness.missingLayers.join(', ')}`}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Ionicons
            name={offer.integrityResult.passed ? 'shield-checkmark' : 'shield'}
            size={16}
            color={offer.integrityResult.passed ? '#10B981' : '#EF4444'}
          />
          <Text style={[styles.statusText, { color: offer.integrityResult.passed ? '#10B981' : '#EF4444' }]}>
            {offer.integrityResult.passed ? 'Integrity passed' : `Integrity: ${offer.integrityResult.failures.join(', ')}`}
          </Text>
        </View>

        {variant !== 'rejected' && (
          <Pressable
            onPress={() => selectOption(variant)}
            disabled={selecting || isSelected}
            style={[styles.selectBtn, isSelected && styles.selectBtnSelected]}
          >
            <LinearGradient
              colors={isSelected ? ['#10B981', '#059669'] : [borderColor, borderColor + 'CC']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.selectBtnGradient}
            >
              {selecting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name={isSelected ? 'checkmark-circle' : 'hand-left'} size={14} color="#fff" />
                  <Text style={styles.selectBtnText}>
                    {isSelected ? 'Selected' : 'Select This Offer'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
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

  const isStale = data?.rootSyncStatus === 'stale';
  const hasData = data?.exists && data.primaryOffer && !isStale;
  const currentOffer = activeSection === 'primary' ? data?.primaryOffer
    : activeSection === 'alternative' ? data?.alternativeOffer
    : data?.rejectedOffer?.offer;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F97316', '#FB923C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="pricetag" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Offer Engine</Text>
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
              <Text style={styles.headerMetaValue}>{Math.round((data.offerStrengthScore || 0) * 100)}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Confidence</Text>
              <Text style={styles.headerMetaValue}>{Math.round((data.confidenceScore || 0) * 100)}%</Text>
            </View>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Status</Text>
              <Text style={styles.headerMetaValue}>{data.status}</Text>
            </View>
          </View>
        )}
      </LinearGradient>

      {!hasData && !analyzing && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="pricetag-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {isStale ? 'Offers Outdated' : 'No Offer Analysis'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            {isStale
              ? 'The upstream pipeline has changed. Previous offers are invalidated. Regenerate to sync with the current Strategy Root.'
              : 'Run the Offer Engine to generate structured, market-aligned offers based on your positioning and differentiation data.'
            }
          </Text>
          {!strategyRoot?.exists && !isStale && (
            <View style={[styles.depWarning, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[styles.depWarningText, { color: '#F59E0B' }]}>
                Complete the full pipeline and run the Mechanism Engine to create a Strategy Root first
              </Text>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !strategyRoot?.exists}
        style={[styles.analyzeBtn, (!strategyRoot?.exists) && styles.analyzeBtnDisabled]}
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
              <Text style={styles.analyzeBtnText}>Constructing Offers...</Text>
            </>
          ) : (
            <>
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>
                {isStale ? 'Regenerate (Stale)' : hasData ? 'Regenerate Offers' : 'Generate Offers'}
              </Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      {hasData && (
        <>
          {strategyRoot?.exists && (
            <View style={[styles.sourceRow, {
              backgroundColor: colors.card,
              borderColor: data.rootSyncStatus === 'synced' ? '#10B98130' : '#06B6D430',
            }]}>
              <View style={[styles.sourceBadge, {
                backgroundColor: data.rootSyncStatus === 'synced' ? '#10B98115' : '#06B6D415',
              }]}>
                <Ionicons name="git-network" size={12} color={data.rootSyncStatus === 'synced' ? '#10B981' : '#06B6D4'} />
                <Text style={[styles.sourceBadgeText, {
                  color: data.rootSyncStatus === 'synced' ? '#10B981' : '#06B6D4',
                }]}>Strategy Root</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sourceDetail, { color: colors.textMuted }]}>
                  {strategyRoot.primaryAxis ? strategyRoot.primaryAxis.replace(/_/g, ' ') : 'Unified'} axis — synced
                </Text>
                <Text style={[styles.sourceDetail, { color: colors.textMuted, fontSize: 10, marginTop: 2 }]}>
                  Hash: {strategyRoot.rootHash?.substring(0, 10)}... | Run: {strategyRoot.runId?.split('_')[1] || '—'}
                </Text>
              </View>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            </View>
          )}

          {!strategyRoot?.exists && data?.exists && (
            <View style={[styles.warningBox, { backgroundColor: '#EF444412', borderColor: '#EF444425' }]}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#DC2626' }]}>No Active Strategy Root</Text>
                <Text style={[styles.warningDetail, { color: '#991B1B' }]}>
                  Run the Mechanism Engine to create a unified Strategy Root. Offers cannot be generated without an active root.
                </Text>
              </View>
            </View>
          )}

          {data.layerDiagnostics?.strategyRoot?.bound && !data.layerDiagnostics.strategyRoot.bindingValid && (
            <View style={[styles.warningBox, { backgroundColor: '#F59E0B10', borderColor: '#F59E0B30' }]}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#D97706' }]}>Root Binding Mismatch</Text>
                {(data.layerDiagnostics.strategyRoot.bindingIssues || []).map((issue: string, i: number) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#92400E', marginTop: 2 }]}>{issue}</Text>
                ))}
              </View>
            </View>
          )}

          {renderSourceContextCard()}
          {renderIntegrityStatusCard()}

          <View style={[styles.selectorRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {(['primary', 'alternative', 'rejected'] as const).map(section => {
              const isActiveTab = activeSection === section;
              const sColor = section === 'primary' ? '#10B981' : section === 'alternative' ? '#3B82F6' : '#EF4444';
              return (
                <Pressable
                  key={section}
                  onPress={() => { Haptics.selectionAsync(); setActiveSection(section); }}
                  style={[styles.selectorTab, isActiveTab && { backgroundColor: sColor + '14', borderColor: sColor + '40' }]}
                >
                  <Text style={[styles.selectorText, { color: isActiveTab ? sColor : colors.textMuted }]}>
                    {section.charAt(0).toUpperCase() + section.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {currentOffer && renderOfferCard(currentOffer, activeSection)}
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
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sourceBadgeText: { fontSize: 11, fontWeight: '600' as const },
  sourceDetail: { fontSize: 11, flex: 1 },
  contextCard: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 10 },
  contextHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  contextTitle: { fontSize: 13, fontWeight: '600' as const },
  contextGrid: { gap: 6 },
  contextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  contextKey: { fontSize: 11, fontWeight: '600' as const, width: 100 },
  contextVal: { fontSize: 12, flex: 1, lineHeight: 16 },
  integrityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  integrityItem: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '45%' as any },
  integrityLabel: { fontSize: 11, fontWeight: '500' as const },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  selectorRow: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 4, marginBottom: 12, gap: 4 },
  selectorTab: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  selectorText: { fontSize: 13, fontWeight: '600' as const },
  offerCard: { borderRadius: 12, padding: 16, borderWidth: 1, marginBottom: 12 },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  offerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  selectedBadgeText: { fontSize: 11, fontWeight: '600' as const },
  offerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  offerBadgeText: { fontSize: 12, fontWeight: '600' as const },
  warningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  warningBadgeText: { fontSize: 11, fontWeight: '600' as const },
  structureLabel: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  offerName: { fontSize: 16, fontWeight: '700' as const, marginBottom: 4 },
  bodyText: { fontSize: 13, lineHeight: 18 },
  offerMeta: { flexDirection: 'row', gap: 16, marginTop: 10, marginBottom: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, fontWeight: '500' as const },
  rejectionBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 8, marginBottom: 10, alignItems: 'flex-start' },
  rejectionText: { fontSize: 12, flex: 1, lineHeight: 16 },
  sectionDivider: { height: 1, backgroundColor: 'rgba(128,128,128,0.15)', marginVertical: 12 },
  deliverableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  deliverableText: { fontSize: 12, flex: 1, lineHeight: 16 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' as const },
  miniTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  miniTagText: { fontSize: 10, fontWeight: '500' as const },
  riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  riskText: { fontSize: 12, flex: 1, lineHeight: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  scoreLabel: { fontSize: 11, width: 130 },
  scoreBarContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreBarBg: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreValue: { fontSize: 11, fontWeight: '600' as const, width: 32, textAlign: 'right' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusText: { fontSize: 12, fontWeight: '500' as const },
  selectBtn: { marginTop: 8 },
  selectBtnSelected: { opacity: 0.8 },
  selectBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 12 },
  selectBtnText: { fontSize: 13, fontWeight: '600' as const, color: '#fff' },
});
