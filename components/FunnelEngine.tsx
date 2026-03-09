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

interface FunnelStage {
  name: string;
  purpose: string;
  contentType: string;
  conversionGoal: string;
}

interface TrustPathStep {
  step: number;
  action: string;
  proofType: string;
  audienceState: string;
}

interface ProofPlacement {
  stage: string;
  proofType: string;
  placement: string;
  purpose: string;
}

interface FrictionPoint {
  stage: string;
  frictionType: string;
  severity: number;
  mitigation: string;
}

interface FunnelCandidate {
  funnelName: string;
  funnelType: string;
  stageMap: FunnelStage[];
  trustPath: TrustPathStep[];
  proofPlacements: ProofPlacement[];
  commitmentLevel: string;
  frictionMap: FrictionPoint[];
  funnelStrengthScore: number;
  eligibilityScore: number;
  offerFitScore: number;
  audienceFrictionScore: number;
  trustPathScore: number;
  proofPlacementScore: number;
  commitmentMatchScore: number;
  integrityResult: { passed: boolean; failures: string[] };
  genericFlag: boolean;
}

interface FunnelData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  primaryFunnel?: FunnelCandidate;
  alternativeFunnel?: FunnelCandidate;
  rejectedFunnel?: { funnel: FunnelCandidate; rejectionReason: string };
  funnelStrengthScore?: number;
  trustPathAnalysis?: any;
  proofPlacementLogic?: any;
  frictionMap?: any;
  boundaryCheck?: { passed: boolean; violations: string[] };
  confidenceScore?: number;
  engineVersion?: number;
  selectedOption?: string | null;
  createdAt?: string;
}

export default function FunnelEngine() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [offerSnapshotId, setOfferSnapshotId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'primary' | 'alternative' | 'rejected'>('primary');
  const [selecting, setSelecting] = useState(false);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/funnel-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('[FunnelEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchOfferSnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/offer-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (json.exists && json.id) {
        setOfferSnapshotId(json.id);
      }
    } catch (err) {
      console.error('[FunnelEngine] Offer snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchLatest();
    fetchOfferSnapshot();
  }, [fetchLatest, fetchOfferSnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId || !offerSnapshotId) {
      Alert.alert('Missing Dependency', 'A completed Offer Engine analysis is required before running the Funnel Engine.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/funnel-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId, offerSnapshotId }),
      });
      const json = await res.json();
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
  }, [selectedCampaignId, offerSnapshotId, fetchLatest]);

  const selectOption = useCallback(async (option: 'primary' | 'alternative') => {
    if (!data?.id) return;
    setSelecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const url = new URL('/api/funnel-engine/select', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: data.id, selectedOption: option, campaignId: selectedCampaignId }),
      });
      const json = await res.json();
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

  const renderStageMap = (stages: FunnelStage[]) => {
    if (!Array.isArray(stages) || stages.length === 0) return null;
    return (
      <View style={styles.stageMapContainer}>
        {stages.map((stage, i) => (
          <View key={i} style={styles.stageItem}>
            <View style={[styles.stageConnector, i === 0 && { borderTopWidth: 0 }]}>
              <View style={[styles.stageDot, { backgroundColor: '#14B8A6' }]} />
              {i < stages.length - 1 && <View style={[styles.stageLine, { backgroundColor: '#14B8A640' }]} />}
            </View>
            <View style={[styles.stageContent, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.stageName, { color: colors.text }]}>{stage.name}</Text>
              <Text style={[styles.stageDesc, { color: colors.textSecondary }]}>{stage.purpose}</Text>
              <Text style={[styles.stageDesc, { color: colors.textMuted, fontSize: 11 }]}>
                {stage.contentType} → {stage.conversionGoal}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderFunnelCard = (funnel: FunnelCandidate, variant: 'primary' | 'alternative' | 'rejected') => {
    const borderColor = variant === 'primary' ? '#10B981' : variant === 'alternative' ? '#3B82F6' : '#EF4444';
    const rejectionReason = variant === 'rejected' ? (data?.rejectedFunnel as any)?.rejectionReason : null;
    const isSelected = data?.selectedOption === variant;

    return (
      <View style={[styles.funnelCard, { backgroundColor: colors.card, borderColor: borderColor + '40' }]}>
        <View style={styles.funnelHeader}>
          <View style={styles.funnelHeaderLeft}>
            <View style={[styles.funnelBadge, { backgroundColor: borderColor + '20' }]}>
              <Ionicons
                name={variant === 'primary' ? 'star' : variant === 'alternative' ? 'swap-horizontal' : 'close-circle'}
                size={14}
                color={borderColor}
              />
              <Text style={[styles.funnelBadgeText, { color: borderColor }]}>
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
          {funnel.genericFlag && (
            <View style={[styles.warningBadge, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="warning" size={12} color="#F59E0B" />
              <Text style={[styles.warningBadgeText, { color: '#F59E0B' }]}>Generic</Text>
            </View>
          )}
        </View>

        <Text style={[styles.funnelName, { color: colors.text }]}>{funnel.funnelName}</Text>
        <View style={styles.funnelTypeBadge}>
          <Ionicons name="git-network" size={13} color="#14B8A6" />
          <Text style={[styles.funnelTypeText, { color: colors.textSecondary }]}>{funnel.funnelType}</Text>
        </View>

        <View style={styles.funnelMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="fitness" size={14} color={scoreColor(funnel.funnelStrengthScore)} />
            <Text style={[styles.metaText, { color: colors.text }]}>
              Strength: {Math.round(funnel.funnelStrengthScore * 100)}%
            </Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="shield-checkmark" size={14} color={scoreColor(funnel.trustPathScore)} />
            <Text style={[styles.metaText, { color: colors.text }]}>
              Trust: {Math.round(funnel.trustPathScore * 100)}%
            </Text>
          </View>
        </View>

        <View style={styles.funnelMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="layers" size={14} color="#8B5CF6" />
            <Text style={[styles.metaText, { color: colors.text }]}>
              Commitment: {funnel.commitmentLevel}
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

        <Text style={[styles.subSectionTitle, { color: colors.text }]}>Funnel Stages</Text>
        {funnel.stageMap && renderStageMap(funnel.stageMap)}

        {Array.isArray(funnel.trustPath) && funnel.trustPath.length > 0 && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Trust Path</Text>
            {funnel.trustPath.map((step, i) => (
              <View key={i} style={styles.trustPathRow}>
                <View style={[styles.trustPathNumber, { backgroundColor: '#14B8A620' }]}>
                  <Text style={[styles.trustPathNumberText, { color: '#14B8A6' }]}>{step.step}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.trustPathText, { color: colors.textSecondary }]}>{step.action}</Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{step.proofType.replace(/_/g, ' ')} — {step.audienceState}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {Array.isArray(funnel.proofPlacements) && funnel.proofPlacements.length > 0 && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Proof Placements</Text>
            {funnel.proofPlacements.map((pp, i) => (
              <View key={i} style={styles.proofPlacementRow}>
                <View style={[styles.tag, { backgroundColor: '#14B8A620' }]}>
                  <Text style={[styles.tagText, { color: '#14B8A6' }]}>{pp.stage.replace(/_/g, ' ')}</Text>
                </View>
                <View style={[styles.tag, { backgroundColor: '#3B82F620' }]}>
                  <Text style={[styles.tagText, { color: '#3B82F6' }]}>{pp.proofType.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }}>{pp.purpose}</Text>
              </View>
            ))}
          </>
        )}

        {Array.isArray(funnel.frictionMap) && funnel.frictionMap.length > 0 && (
          <>
            <Text style={[styles.subSectionTitle, { color: colors.text, marginTop: 12 }]}>Friction Map</Text>
            {funnel.frictionMap.map((fp, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                {renderScoreBar(`${fp.stage} — ${fp.frictionType}`, fp.severity)}
                <Text style={{ fontSize: 11, color: colors.textMuted, marginLeft: 130, marginTop: 2 }}>{fp.mitigation}</Text>
              </View>
            ))}
          </>
        )}

        <View style={styles.sectionDivider} />

        <Text style={[styles.subSectionTitle, { color: colors.text }]}>Layer Scores</Text>
        {renderScoreBar('Eligibility', funnel.eligibilityScore)}
        {renderScoreBar('Offer Fit', funnel.offerFitScore)}
        {renderScoreBar('Audience Friction', funnel.audienceFrictionScore)}
        {renderScoreBar('Trust Path', funnel.trustPathScore)}
        {renderScoreBar('Proof Placement', funnel.proofPlacementScore)}
        {renderScoreBar('Commitment Match', funnel.commitmentMatchScore)}

        <View style={styles.sectionDivider} />

        <View style={styles.statusRow}>
          <Ionicons
            name={funnel.integrityResult.passed ? 'shield-checkmark' : 'shield'}
            size={16}
            color={funnel.integrityResult.passed ? '#10B981' : '#EF4444'}
          />
          <Text style={[styles.statusText, { color: funnel.integrityResult.passed ? '#10B981' : '#EF4444' }]}>
            {funnel.integrityResult.passed ? 'Integrity passed' : `Integrity: ${funnel.integrityResult.failures.join(', ')}`}
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
                    {isSelected ? 'Selected' : 'Select This Funnel'}
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

  const hasData = data?.exists && data.primaryFunnel;
  const currentFunnel = activeSection === 'primary' ? data?.primaryFunnel
    : activeSection === 'alternative' ? data?.alternativeFunnel
    : data?.rejectedFunnel?.funnel;

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#14B8A6', '#0D9488']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <Ionicons name="git-network" size={20} color="#fff" />
            <Text style={styles.headerTitle}>Funnel Engine V3</Text>
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
              <Text style={styles.headerMetaValue}>{Math.round((data.funnelStrengthScore || 0) * 100)}%</Text>
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
          <Ionicons name="git-network-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Funnel Analysis</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Funnel Engine to generate optimized conversion funnels based on your offer, positioning, and audience data.
          </Text>
          {!offerSnapshotId && (
            <View style={[styles.depWarning, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[styles.depWarningText, { color: '#F59E0B' }]}>
                Complete an Offer Engine analysis first
              </Text>
            </View>
          )}
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !offerSnapshotId}
        style={[styles.analyzeBtn, (!offerSnapshotId) && styles.analyzeBtnDisabled]}
      >
        <LinearGradient
          colors={analyzing ? ['#9CA3AF', '#6B7280'] : ['#14B8A6', '#0D9488']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.analyzeBtnGradient}
        >
          {analyzing ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.analyzeBtnText}>Building Funnels...</Text>
            </>
          ) : (
            <>
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.analyzeBtnText}>{hasData ? 'Regenerate Funnels' : 'Generate Funnels'}</Text>
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

          {currentFunnel && renderFunnelCard(currentFunnel, activeSection)}
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
  selectorRow: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 4, marginBottom: 12, gap: 4 },
  selectorTab: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  selectorText: { fontSize: 13, fontWeight: '600' as const },
  funnelCard: { borderRadius: 12, padding: 16, borderWidth: 1, marginBottom: 12 },
  funnelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  funnelHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  funnelBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  funnelBadgeText: { fontSize: 12, fontWeight: '600' as const },
  selectedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  selectedBadgeText: { fontSize: 11, fontWeight: '600' as const },
  warningBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  warningBadgeText: { fontSize: 11, fontWeight: '600' as const },
  funnelName: { fontSize: 16, fontWeight: '700' as const, marginBottom: 4 },
  funnelTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  funnelTypeText: { fontSize: 13, fontWeight: '500' as const },
  funnelMeta: { flexDirection: 'row', gap: 16, marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, fontWeight: '500' as const },
  rejectionBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 8, marginBottom: 10, alignItems: 'flex-start' },
  rejectionText: { fontSize: 12, flex: 1, lineHeight: 16 },
  sectionDivider: { height: 1, backgroundColor: 'rgba(128,128,128,0.15)', marginVertical: 12 },
  subSectionTitle: { fontSize: 13, fontWeight: '600' as const, marginBottom: 6 },
  stageMapContainer: { marginBottom: 8 },
  stageItem: { flexDirection: 'row', marginBottom: 4 },
  stageConnector: { width: 24, alignItems: 'center', paddingTop: 8 },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  stageLine: { width: 2, flex: 1, marginTop: 2 },
  stageContent: { flex: 1, borderRadius: 8, borderWidth: 1, padding: 10, marginLeft: 8 },
  stageName: { fontSize: 12, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  stageDesc: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  trustPathRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  trustPathNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  trustPathNumberText: { fontSize: 11, fontWeight: '700' as const },
  trustPathText: { fontSize: 12, flex: 1, lineHeight: 16 },
  proofPlacementRow: { marginBottom: 8 },
  proofStageLabel: { fontSize: 12, fontWeight: '500' as const, marginBottom: 4, textTransform: 'capitalize' as const },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' as const },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  scoreLabel: { fontSize: 11, width: 130, textTransform: 'capitalize' as const },
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
