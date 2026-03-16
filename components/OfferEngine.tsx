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
  completeness: { complete: boolean; missingLayers: string[] };
  genericFlag: boolean;
  integrityResult: { passed: boolean; failures: string[] };
  frictionLevel: number;
  depthScores: OfferDepthScores;
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
  createdAt?: string;
}

export default function OfferEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [diffSnapshotId, setDiffSnapshotId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'primary' | 'alternative' | 'rejected'>('primary');
  const [selecting, setSelecting] = useState(false);

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

  const fetchDiffSnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/differentiation-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.id) {
        setDiffSnapshotId(json.id);
      }
    } catch (err) {
      console.error('[OfferEngine] Diff snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchDiffSnapshot();
    }
  }, [isActive, fetchLatest, fetchDiffSnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId || !diffSnapshotId) {
      Alert.alert('Missing Dependency', 'A completed Differentiation Engine analysis is required before running the Offer Engine.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/offer-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId, differentiationSnapshotId: diffSnapshotId }),
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
  }, [selectedCampaignId, diffSnapshotId, fetchLatest]);

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

  const renderScoreBar = (label: string, value: number, maxWidth = 120) => (
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

  const renderOfferCard = (offer: OfferCandidate, variant: 'primary' | 'alternative' | 'rejected') => {
    const borderColor = variant === 'primary' ? '#10B981' : variant === 'alternative' ? '#3B82F6' : '#EF4444';
    const rejectionReason = variant === 'rejected' ? data?.rejectedOffer?.rejectionReason : null;
    const isSelected = data?.selectedOption === variant;

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

        <Text style={[styles.offerName, { color: colors.text }]}>{offer.offerName}</Text>
        <Text style={[styles.offerOutcome, { color: colors.textSecondary }]}>{offer.coreOutcome}</Text>

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

        <Text style={[styles.subSectionTitle, { color: colors.text }]}>Mechanism</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{offer.mechanismDescription}</Text>

        {offer.deliverables.length > 0 && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Deliverables</Text>
            {offer.deliverables.map((d, i) => (
              <View key={i} style={styles.deliverableRow}>
                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                <Text style={[styles.deliverableText, { color: colors.textSecondary }]}>{d}</Text>
              </View>
            ))}
          </>
        )}

        {offer.proofAlignment.length > 0 && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Proof Alignment</Text>
            <View style={styles.tagRow}>
              {offer.proofAlignment.map((p, i) => (
                <View key={i} style={[styles.tag, { backgroundColor: '#3B82F620' }]}>
                  <Text style={[styles.tagText, { color: '#3B82F6' }]}>{p.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {offer.riskNotes.length > 0 && variant !== 'rejected' && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Risk Notes</Text>
            {offer.riskNotes.map((r, i) => (
              <View key={i} style={styles.riskRow}>
                <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                <Text style={[styles.riskText, { color: colors.textMuted }]}>{r}</Text>
              </View>
            ))}
          </>
        )}

        <View style={styles.sectionDivider} />

        <Text style={[styles.subSectionTitle, { color: colors.text }]}>Depth Analysis</Text>
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

  const hasData = data?.exists && data.primaryOffer;
  const currentOffer = activeSection === 'primary' ? data?.primaryOffer
    : activeSection === 'alternative' ? data?.alternativeOffer
    : data?.rejectedOffer?.offer;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F97316', '#FB923C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="pricetag" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Offer Engine V3</Text>
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
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Offer Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Offer Engine to generate structured, market-aligned offers based on your positioning and differentiation data.
          </Text>
          {!diffSnapshotId && (
            <View style={[styles.depWarning, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[styles.depWarningText, { color: '#F59E0B' }]}>
                Complete a Differentiation Engine analysis first
              </Text>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !diffSnapshotId}
        style={[styles.analyzeBtn, (!diffSnapshotId) && styles.analyzeBtnDisabled]}
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
              <Text style={styles.analyzeBtnText}>{hasData ? 'Regenerate Offers' : 'Generate Offers'}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>

      {hasData && (
        <>
          {data.hookMechanismAlignment && !data.hookMechanismAlignment.aligned && (
            <View style={[styles.warningBox, { backgroundColor: '#EF444415', borderColor: '#EF444430' }]}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#EF4444' }]}>Positioning Mismatch</Text>
                <Text style={[styles.warningDetail, { color: '#DC2626' }]}>Hook, outcome, and mechanism do not share the same positioning axis. Offers below may not be strategically coherent. Regenerate to attempt correction.</Text>
                {data.hookMechanismAlignment.failures.map((f, i) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#DC2626', marginTop: 2 }]}>{f}</Text>
                ))}
              </View>
            </View>
          )}

          {data.positioningConsistency && !data.positioningConsistency.consistent && (
            <View style={[styles.warningBox, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#F59E0B' }]}>Positioning Inconsistency</Text>
                {data.positioningConsistency.contradictions.map((c, i) => (
                  <Text key={i} style={[styles.warningDetail, { color: '#D97706' }]}>{c}</Text>
                ))}
              </View>
            </View>
          )}

          {data.boundaryCheck && !data.boundaryCheck.passed && data.boundaryCheck.violations.length > 0 && (
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

          {data.status === 'POSITIONING_MISMATCH' && (
            <View style={[styles.warningBox, { backgroundColor: '#F59E0B12', borderColor: '#F59E0B30' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#D97706' }]}>Positioning Advisory</Text>
                <Text style={[styles.warningDetail, { color: '#92400E' }]}>Hook and mechanism may not fully share the same strategic axis. Review alignment and regenerate if needed.</Text>
              </View>
            </View>
          )}

          <View style={[styles.selectorRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {(['primary', 'alternative', 'rejected'] as const).map(section => {
              const isActive = activeSection === section;
              const sColor = section === 'primary' ? '#10B981' : section === 'alternative' ? '#3B82F6' : '#EF4444';
              return (
                <Pressable
                  key={section}
                  onPress={() => { Haptics.selectionAsync(); setActiveSection(section); }}
                  style={[styles.selectorTab, isActive && { backgroundColor: sColor + '14', borderColor: sColor + '40' }]}
                >
                  <Text style={[styles.selectorText, { color: isActive ? sColor : colors.textMuted }]}>
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  versionBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  versionText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  headerMeta: { flexDirection: 'row', marginTop: 12, gap: 16 },
  headerMetaItem: { flex: 1 },
  headerMetaLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  headerMetaValue: { fontSize: 14, fontWeight: '700', color: '#fff' },
  emptyState: { borderRadius: 12, padding: 24, alignItems: 'center', marginBottom: 12, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  depWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, marginTop: 8 },
  depWarningText: { fontSize: 12, fontWeight: '500' },
  analyzeBtn: { marginBottom: 12 },
  analyzeBtnDisabled: { opacity: 0.5 },
  analyzeBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 14 },
  analyzeBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  warningBox: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  warningTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  warningDetail: { fontSize: 12, lineHeight: 16 },
  selectorRow: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 4, marginBottom: 12, gap: 4 },
  selectorTab: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  selectorText: { fontSize: 13, fontWeight: '600' },
  offerCard: { borderRadius: 12, padding: 16, borderWidth: 1, marginBottom: 12 },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  offerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  selectedBadgeText: { fontSize: 11, fontWeight: '600' },
  offerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  offerBadgeText: { fontSize: 12, fontWeight: '600' },
  warningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  warningBadgeText: { fontSize: 11, fontWeight: '600' },
  offerName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  offerOutcome: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  offerMeta: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, fontWeight: '500' },
  rejectionBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 8, marginBottom: 10, alignItems: 'flex-start' },
  rejectionText: { fontSize: 12, flex: 1, lineHeight: 16 },
  sectionDivider: { height: 1, backgroundColor: 'rgba(128,128,128,0.15)', marginVertical: 12 },
  subSectionTitle: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  bodyText: { fontSize: 13, lineHeight: 18 },
  deliverableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  deliverableText: { fontSize: 12, flex: 1, lineHeight: 16 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' },
  riskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  riskText: { fontSize: 12, flex: 1, lineHeight: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  scoreLabel: { fontSize: 11, width: 130 },
  scoreBarContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreBarBg: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreValue: { fontSize: 11, fontWeight: '600', width: 32, textAlign: 'right' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusText: { fontSize: 12, fontWeight: '500' },
  selectBtn: { marginTop: 8 },
  selectBtnSelected: { opacity: 0.8 },
  selectBtnGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, padding: 12 },
  selectBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
});
