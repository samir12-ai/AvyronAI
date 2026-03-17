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

interface LayerResult {
  layerName: string;
  passed: boolean;
  score: number;
  findings: string[];
  warnings: string[];
}

interface TrustBarrier {
  barrierType: string;
  severity: string;
  source: string;
  persuasionImplication: string;
}

interface AwarenessStageProperty {
  propertyType: string;
  readinessStage: string;
  description: string;
  handlingLayer: string;
}

interface AutoCorrection {
  wasApplied: boolean;
  originalMode: string;
  correctedMode: string;
  correctionReason: string;
}

interface ObjectionProofLink {
  objectionCategory: string;
  objectionDetail: string;
  requiredProofType: string;
  proofAvailable: boolean;
  confidence: number;
}

interface PersuasionRoute {
  routeName: string;
  persuasionMode: string;
  primaryInfluenceDrivers: string[];
  objectionPriorities: string[];
  trustSequence: string[];
  messageOrderLogic: string[];
  persuasionStrengthScore: number;
  frictionNotes: string[];
  rejectionReason: string | null;
  trustBarriers?: TrustBarrier[];
  awarenessStageProperties?: AwarenessStageProperty[];
  objectionProofLinks?: ObjectionProofLink[];
  readinessAlignment?: {
    stage: string;
    educationFirst: boolean;
    proofRole: string;
    hardCtaBlocked?: boolean;
    commitmentDisabled?: boolean;
    blockedTactics?: string[];
  };
  scarcityValidation?: {
    allowed: boolean;
    blockedReasons: string[];
  };
}

interface PersuasionData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  primaryRoute?: PersuasionRoute;
  alternativeRoute?: PersuasionRoute;
  rejectedRoute?: PersuasionRoute;
  layerResults?: LayerResult[];
  structuralWarnings?: string[];
  boundaryCheck?: { passed: boolean; violations: string[] };
  dataReliability?: any;
  engineVersion?: number;
  persuasionStrengthScore?: number;
  executionTimeMs?: number;
  createdAt?: string;
  autoCorrection?: AutoCorrection;
  confidenceNormalized?: boolean;
}

const LAYER_LABELS: Record<string, string> = {
  awareness_to_persuasion_fit: "Awareness \u2192 Persuasion Fit",
  objection_detection: "Objection Detection",
  trust_barrier_mapping: "Trust Barrier Mapping",
  influence_driver_selection: "Influence Driver Selection",
  proof_priority_mapping: "Proof Priority Mapping",
  message_order_logic: "Message Order Logic",
  anti_hype_guard: "Anti-Hype Guard",
  persuasion_strength_scoring: "Persuasion Strength Scoring",
};

const LAYER_ICONS: Record<string, string> = {
  awareness_to_persuasion_fit: "git-compare",
  objection_detection: "warning",
  trust_barrier_mapping: "shield-checkmark",
  influence_driver_selection: "people",
  proof_priority_mapping: "ribbon",
  message_order_logic: "list",
  anti_hype_guard: "ban",
  persuasion_strength_scoring: "analytics",
};

const MODE_LABELS: Record<string, string> = {
  authority_led: "Authority-Led",
  proof_led: "Proof-Led",
  reciprocity_led: "Reciprocity-Led",
  scarcity_led: "Scarcity-Led",
  social_proof_led: "Social Proof-Led",
  empathy_led: "Empathy-Led",
  logic_led: "Logic-Led",
  contrast_led: "Contrast-Led",
  education_led: "Education-Led",
  diagnostic_led: "Diagnostic-Led",
};

const MODE_COLORS: Record<string, string> = {
  authority_led: "#8B5CF6",
  proof_led: "#10B981",
  reciprocity_led: "#F59E0B",
  scarcity_led: "#EF4444",
  social_proof_led: "#3B82F6",
  empathy_led: "#EC4899",
  logic_led: "#6366F1",
  contrast_led: "#F97316",
  education_led: "#14B8A6",
  diagnostic_led: "#06B6D4",
};

const DRIVER_LABELS: Record<string, string> = {
  authority: "Authority",
  social_proof: "Social Proof",
  reciprocity: "Reciprocity",
  scarcity: "Scarcity",
  consistency: "Consistency",
  liking: "Liking",
  proof_of_work: "Proof of Work",
  contrast: "Contrast",
  specificity: "Specificity",
  risk_reversal: "Risk Reversal",
  education: "Education",
  diagnosis: "Diagnosis",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#DC2626",
  high: "#EF4444",
  moderate: "#F59E0B",
  low: "#10B981",
};

export default function PersuasionEngine({ isActive }: { isActive?: boolean }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId } = useCampaign();
  const [data, setData] = useState<PersuasionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [awarenessSnapshotId, setAwarenessSnapshotId] = useState<string | null>(null);
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    setLoading(true);
    try {
      const url = new URL('/api/persuasion-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch (err) {
      console.error('[PersuasionEngine] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  const fetchAwarenessSnapshot = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = new URL('/api/awareness-engine/latest', getApiUrl());
      url.searchParams.set('campaignId', selectedCampaignId);
      const res = await fetch(url.toString());
      const json = await safeApiJson(res);
      if (json.exists && json.id) {
        setAwarenessSnapshotId(json.id);
      }
    } catch (err) {
      console.error('[PersuasionEngine] Awareness snapshot fetch error:', err);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    if (isActive) {
      fetchLatest();
      fetchAwarenessSnapshot();
    }
  }, [isActive, fetchLatest, fetchAwarenessSnapshot]);

  const runAnalysis = useCallback(async () => {
    if (!selectedCampaignId || !awarenessSnapshotId) {
      Alert.alert('Missing Dependency', 'A completed Awareness Engine analysis is required before running the Persuasion Engine.');
      return;
    }
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const url = new URL('/api/persuasion-engine/analyze', getApiUrl());
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId, awarenessSnapshotId }),
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
  }, [selectedCampaignId, awarenessSnapshotId, fetchLatest]);

  const scoreColor = (score: number) => {
    if (score >= 0.7) return '#10B981';
    if (score >= 0.4) return '#F59E0B';
    return '#EF4444';
  };

  const renderAutoCorrectionBanner = (correction: AutoCorrection | undefined) => {
    if (!correction || !correction.wasApplied) return null;
    return (
      <View style={[styles.autoCorrectionCard, { backgroundColor: '#F59E0B' + '12', borderColor: '#F59E0B' + '40' }]}>
        <View style={styles.autoCorrectionHeader}>
          <Ionicons name="refresh-circle" size={16} color="#F59E0B" />
          <Text style={[styles.autoCorrectionTitle, { color: '#F59E0B' }]}>Auto-Correction Applied</Text>
        </View>
        <View style={styles.autoCorrectionModes}>
          <View style={[styles.modeChip, { backgroundColor: '#EF4444' + '15' }]}>
            <Ionicons name="close-circle" size={11} color="#EF4444" />
            <Text style={[styles.modeChipText, { color: '#EF4444' }]}>{MODE_LABELS[correction.originalMode] || correction.originalMode}</Text>
          </View>
          <Ionicons name="arrow-forward" size={12} color={colors.textMuted} />
          <View style={[styles.modeChip, { backgroundColor: '#10B981' + '15' }]}>
            <Ionicons name="checkmark-circle" size={11} color="#10B981" />
            <Text style={[styles.modeChipText, { color: '#10B981' }]}>{MODE_LABELS[correction.correctedMode] || correction.correctedMode}</Text>
          </View>
        </View>
        <Text style={[styles.autoCorrectionReason, { color: colors.textMuted }]}>{correction.correctionReason}</Text>
      </View>
    );
  };

  const renderAwarenessStageProperties = (props: AwarenessStageProperty[] | undefined) => {
    if (!props || props.length === 0) return null;
    const isExpanded = expandedSection === 'awareness_stage_props';
    return (
      <View style={[styles.routeSection]}>
        <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedSection(isExpanded ? null : 'awareness_stage_props'); }} style={styles.collapsibleHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="eye" size={14} color="#14B8A6" />
            <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Awareness Stage Properties ({props.length})</Text>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
        </Pressable>
        {isExpanded && props.map((prop, i) => (
          <View key={i} style={[styles.barrierCard, { backgroundColor: '#14B8A6' + '08', borderLeftColor: '#14B8A6' }]}>
            <View style={styles.barrierHeader}>
              <View style={[styles.severityBadge, { backgroundColor: '#14B8A6' + '20' }]}>
                <Text style={[styles.severityText, { color: '#14B8A6' }]}>STAGE PROPERTY</Text>
              </View>
              <Text style={[styles.barrierType, { color: colors.text }]}>{prop.propertyType.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={[styles.barrierSource, { color: colors.textMuted }]}>Stage: {prop.readinessStage}</Text>
            <Text style={[styles.barrierImplication, { color: colors.text }]}>{prop.description}</Text>
            <Text style={[styles.barrierSource, { color: '#14B8A6' }]}>Handled by: {prop.handlingLayer}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderTrustBarriers = (barriers: TrustBarrier[]) => {
    if (!barriers || barriers.length === 0) return null;
    const isExpanded = expandedSection === 'trust_barriers';
    return (
      <View style={[styles.routeSection]}>
        <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedSection(isExpanded ? null : 'trust_barriers'); }} style={styles.collapsibleHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="shield" size={14} color="#EF4444" />
            <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Trust Barriers ({barriers.length})</Text>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
        </Pressable>
        {isExpanded && barriers.map((b, i) => (
          <View key={i} style={[styles.barrierCard, { backgroundColor: (SEVERITY_COLORS[b.severity] || '#6B7280') + '08', borderLeftColor: SEVERITY_COLORS[b.severity] || '#6B7280' }]}>
            <View style={styles.barrierHeader}>
              <View style={[styles.severityBadge, { backgroundColor: (SEVERITY_COLORS[b.severity] || '#6B7280') + '20' }]}>
                <Text style={[styles.severityText, { color: SEVERITY_COLORS[b.severity] || '#6B7280' }]}>{b.severity.toUpperCase()}</Text>
              </View>
              <Text style={[styles.barrierType, { color: colors.text }]}>{b.barrierType.replace(/_/g, ' ')}</Text>
            </View>
            <Text style={[styles.barrierSource, { color: colors.textMuted }]}>{b.source}</Text>
            <Text style={[styles.barrierImplication, { color: colors.text }]}>{b.persuasionImplication}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderObjectionProofLinks = (links: ObjectionProofLink[]) => {
    if (!links || links.length === 0) return null;
    const isExpanded = expandedSection === 'objection_proof';
    return (
      <View style={styles.routeSection}>
        <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedSection(isExpanded ? null : 'objection_proof'); }} style={styles.collapsibleHeader}>
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name="link" size={14} color="#8B5CF6" />
            <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Objection \u2192 Proof Links ({links.length})</Text>
          </View>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
        </Pressable>
        {isExpanded && links.map((link, i) => (
          <View key={i} style={[styles.proofLinkCard, { backgroundColor: colors.background }]}>
            <View style={styles.proofLinkRow}>
              <View style={styles.proofLinkLeft}>
                <Ionicons name="alert-circle" size={12} color="#F59E0B" />
                <Text style={[styles.proofLinkCategory, { color: colors.text }]}>{link.objectionCategory.replace(/_/g, ' ')}</Text>
              </View>
              <Ionicons name="arrow-forward" size={12} color={colors.textMuted} />
              <View style={styles.proofLinkRight}>
                <Ionicons name={link.proofAvailable ? "checkmark-circle" : "close-circle"} size={12} color={link.proofAvailable ? '#10B981' : '#EF4444'} />
                <Text style={[styles.proofLinkType, { color: link.proofAvailable ? '#10B981' : '#EF4444' }]}>{link.requiredProofType.replace(/_/g, ' ')}</Text>
              </View>
            </View>
            <Text style={[styles.proofLinkDetail, { color: colors.textMuted }]} numberOfLines={2}>{link.objectionDetail}</Text>
            <View style={[styles.confidenceBar, { backgroundColor: colors.cardBorder }]}>
              <View style={[styles.confidenceBarFill, { width: `${Math.round(link.confidence * 100)}%`, backgroundColor: scoreColor(link.confidence) }]} />
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderReadinessAlignment = (alignment: PersuasionRoute['readinessAlignment']) => {
    if (!alignment) return null;
    const isBlocked = alignment.hardCtaBlocked || alignment.commitmentDisabled;
    const cardColor = isBlocked ? '#EF4444' : alignment.educationFirst ? '#14B8A6' : '#10B981';
    return (
      <View style={[styles.readinessCard, { backgroundColor: cardColor + '10', borderColor: cardColor + '30', borderWidth: 1 }]}>
        <View style={styles.readinessRow}>
          <Ionicons name={alignment.educationFirst ? "school" : "checkmark-done"} size={14} color={cardColor} />
          <Text style={[styles.readinessStage, { color: colors.text }]}>
            {alignment.stage.replace(/_/g, ' ')} {alignment.educationFirst ? '(Education-First)' : ''}
          </Text>
        </View>
        <Text style={[styles.readinessProofRole, { color: colors.textMuted }]}>Proof role: {alignment.proofRole}</Text>
        {alignment.hardCtaBlocked && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <Ionicons name="ban" size={12} color="#EF4444" />
            <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '600' as const }}>Hard CTA BLOCKED</Text>
          </View>
        )}
        {alignment.commitmentDisabled && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <Ionicons name="lock-closed" size={12} color="#EF4444" />
            <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '600' as const }}>Commitment Logic DISABLED</Text>
          </View>
        )}
        {alignment.blockedTactics && alignment.blockedTactics.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {alignment.blockedTactics.map((tactic, i) => (
              <View key={i} style={{ backgroundColor: '#EF444415', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 }}>
                <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: '500' as const }}>{tactic.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderScarcityValidation = (validation: PersuasionRoute['scarcityValidation'], isRejected: boolean) => {
    if (!validation) return null;
    if (validation.allowed && !isRejected) return null;
    return (
      <View style={[styles.scarcityCard, { backgroundColor: '#EF4444' + '08' }]}>
        <View style={styles.scarcityHeader}>
          <Ionicons name="ban" size={14} color="#EF4444" />
          <Text style={[styles.scarcityTitle, { color: '#EF4444' }]}>Scarcity Protection</Text>
        </View>
        {validation.blockedReasons.map((reason, i) => (
          <View key={i} style={styles.listItem}>
            <Ionicons name="close" size={10} color="#EF4444" />
            <Text style={[styles.findingText, { color: colors.textMuted }]}>{reason}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderRouteCard = (route: PersuasionRoute, type: 'primary' | 'alternative' | 'rejected') => {
    const isExpanded = expandedRoute === type;
    const isRejected = type === 'rejected';
    const typeColors = { primary: '#10B981', alternative: '#3B82F6', rejected: '#EF4444' };
    const typeLabels = { primary: 'Primary Route', alternative: 'Alternative Route', rejected: 'Rejected Route' };
    const typeIcons: Record<string, keyof typeof Ionicons.glyphMap> = { primary: 'checkmark-circle', alternative: 'swap-horizontal', rejected: 'close-circle' };
    const cardColor = typeColors[type];
    const modeColor = MODE_COLORS[route.persuasionMode] || '#6B7280';
    const scorePercent = Math.round(route.persuasionStrengthScore * 100);

    return (
      <View key={type} style={[styles.routeCard, { backgroundColor: colors.card, borderColor: cardColor + '30' }]}>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setExpandedRoute(isExpanded ? null : type); setExpandedSection(null); }}
          style={styles.routeHeader}
        >
          <View style={styles.routeHeaderLeft}>
            <Ionicons name={typeIcons[type]} size={18} color={cardColor} />
            <View>
              <Text style={[styles.routeTypeLabel, { color: cardColor }]}>{typeLabels[type]}</Text>
              <Text style={[styles.routeName, { color: colors.text }]}>{route.routeName}</Text>
            </View>
          </View>
          <View style={styles.routeHeaderRight}>
            {!isRejected && (
              <View style={[styles.scorePill, { backgroundColor: scoreColor(route.persuasionStrengthScore) + '20' }]}>
                <Text style={[styles.scorePillText, { color: scoreColor(route.persuasionStrengthScore) }]}>{scorePercent}%</Text>
              </View>
            )}
            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </View>
        </Pressable>

        {isExpanded && (
          <View style={styles.routeDetails}>
            <View style={[styles.routeDivider, { backgroundColor: colors.cardBorder }]} />

            <View style={styles.routeMetaGrid}>
              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Persuasion Mode</Text>
                <View style={[styles.routeMetaBadge, { backgroundColor: modeColor + '15' }]}>
                  <Ionicons name="flash" size={12} color={modeColor} />
                  <Text style={[styles.routeMetaBadgeText, { color: modeColor }]}>
                    {MODE_LABELS[route.persuasionMode] || route.persuasionMode}
                  </Text>
                </View>
              </View>

              <View style={[styles.routeMetaItem, { backgroundColor: colors.background }]}>
                <Text style={[styles.routeMetaLabel, { color: colors.textMuted }]}>Strength</Text>
                <View style={[styles.routeMetaBadge, { backgroundColor: scoreColor(route.persuasionStrengthScore) + '15' }]}>
                  <Ionicons name="analytics" size={12} color={scoreColor(route.persuasionStrengthScore)} />
                  <Text style={[styles.routeMetaBadgeText, { color: scoreColor(route.persuasionStrengthScore) }]}>
                    {scorePercent}%
                  </Text>
                </View>
              </View>
            </View>

            {type === 'primary' && renderAutoCorrectionBanner(data?.autoCorrection)}
            {type === 'primary' && renderReadinessAlignment(route.readinessAlignment)}

            {route.primaryInfluenceDrivers.length > 0 && (
              <View style={styles.routeSection}>
                <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Influence Drivers</Text>
                <View style={styles.tagRow}>
                  {route.primaryInfluenceDrivers.map((driver, i) => (
                    <View key={i} style={[styles.tag, { backgroundColor: '#8B5CF6' + '15' }]}>
                      <Text style={[styles.tagText, { color: '#8B5CF6' }]}>{DRIVER_LABELS[driver] || driver}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {route.objectionPriorities.length > 0 && (
              <View style={styles.routeSection}>
                <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Objection Priorities</Text>
                {route.objectionPriorities.map((obj, i) => (
                  <View key={i} style={styles.listItem}>
                    <Ionicons name="alert-circle" size={12} color="#F59E0B" />
                    <Text style={[styles.listItemText, { color: colors.text }]}>{obj}</Text>
                  </View>
                ))}
              </View>
            )}

            {type === 'primary' && renderAwarenessStageProperties(route.awarenessStageProperties)}
            {type === 'primary' && renderTrustBarriers(route.trustBarriers || [])}
            {type === 'primary' && renderObjectionProofLinks(route.objectionProofLinks || [])}

            {route.trustSequence.length > 0 && (
              <View style={styles.routeSection}>
                <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Trust Sequence</Text>
                {route.trustSequence.map((step, i) => (
                  <View key={i} style={styles.sequenceItem}>
                    <View style={[styles.sequenceNumber, { backgroundColor: '#10B981' + '20' }]}>
                      <Text style={[styles.sequenceNumberText, { color: '#10B981' }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.listItemText, { color: colors.text }]}>
                      {step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {route.messageOrderLogic.length > 0 && (
              <View style={styles.routeSection}>
                <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Message Order</Text>
                {route.messageOrderLogic.map((step, i) => {
                  const isSoftStep = step === 'soft_next_step';
                  const isCommitment = step === 'invite_commitment';
                  const stepColor = isSoftStep ? '#14B8A6' : isCommitment ? '#F97316' : '#3B82F6';
                  return (
                    <View key={i} style={styles.sequenceItem}>
                      <View style={[styles.sequenceNumber, { backgroundColor: stepColor + '20' }]}>
                        <Text style={[styles.sequenceNumberText, { color: stepColor }]}>{i + 1}</Text>
                      </View>
                      <Text style={[styles.listItemText, { color: colors.text }]}>
                        {step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </Text>
                      {isSoftStep && (
                        <View style={{ backgroundColor: '#14B8A6' + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 6 }}>
                          <Text style={{ fontSize: 9, color: '#14B8A6', fontWeight: '600' as const }}>SOFT</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {isRejected && route.rejectionReason && (
              <View style={[styles.rejectionBox, { backgroundColor: '#EF4444' + '10' }]}>
                <Ionicons name="close-circle" size={14} color="#EF4444" />
                <Text style={[styles.rejectionText, { color: '#EF4444' }]}>{route.rejectionReason}</Text>
              </View>
            )}

            {renderScarcityValidation(route.scarcityValidation, isRejected)}

            {route.frictionNotes.length > 0 && !isRejected && (
              <View style={styles.routeSection}>
                <Text style={[styles.routeSectionTitle, { color: colors.textMuted }]}>Friction Notes</Text>
                {route.frictionNotes.map((note, i) => (
                  <View key={i} style={styles.listItem}>
                    <Ionicons name="information-circle" size={12} color={colors.textMuted} />
                    <Text style={[styles.listItemText, { color: colors.textMuted }]}>{note}</Text>
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
        <ActivityIndicator size="large" color="#EC4899" />
      </View>
    );
  }

  const hasData = data?.exists && data.primaryRoute;
  const strengthScore = data?.persuasionStrengthScore || data?.primaryRoute?.persuasionStrengthScore || 0;
  const strengthPercent = Math.round(strengthScore * 100);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={['#EC4899', '#F472B6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
        <View style={styles.headerRow}>
          <Ionicons name="megaphone" size={20} color="#fff" />
          <Text style={styles.headerTitle}>Persuasion Engine V3</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          8-layer persuasion logic architecture — influence drivers, objection mapping, and trust sequencing
        </Text>
      </LinearGradient>

      {!awarenessSnapshotId && (
        <View style={[styles.dependencyWarning, { backgroundColor: '#F59E0B' + '15' }]}>
          <Ionicons name="alert-circle" size={16} color="#F59E0B" />
          <Text style={[styles.dependencyText, { color: '#F59E0B' }]}>
            Run Awareness Engine first to enable Persuasion analysis
          </Text>
        </View>
      )}

      <Pressable
        onPress={runAnalysis}
        disabled={analyzing || !awarenessSnapshotId}
        style={[
          styles.analyzeButton,
          { backgroundColor: awarenessSnapshotId ? '#EC4899' : colors.cardBorder },
          analyzing && { opacity: 0.7 },
        ]}
      >
        {analyzing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="flash" size={18} color="#fff" />
        )}
        <Text style={styles.analyzeButtonText}>
          {analyzing ? 'Analyzing...' : hasData ? 'Re-Analyze Persuasion' : 'Analyze Persuasion Logic'}
        </Text>
      </Pressable>

      {hasData && (
        <>
          <View style={[styles.scoreSection, { backgroundColor: colors.card }]}>
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreLabel, { color: colors.textMuted }]}>Persuasion Strength</Text>
              <Text style={[styles.scoreValue, { color: scoreColor(strengthScore) }]}>{strengthPercent}%</Text>
            </View>
            <View style={[styles.scoreBar, { backgroundColor: colors.cardBorder }]}>
              <View style={[styles.scoreBarFill, { width: `${strengthPercent}%`, backgroundColor: scoreColor(strengthScore) }]} />
            </View>
            {data.confidenceNormalized && (
              <View style={styles.normalizedBadge}>
                <Ionicons name="information-circle" size={12} color="#F59E0B" />
                <Text style={[styles.normalizedText, { color: '#F59E0B' }]}>Confidence normalized (weak data)</Text>
              </View>
            )}
          </View>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Persuasion Routes</Text>

          {data.primaryRoute && renderRouteCard(data.primaryRoute, 'primary')}
          {data.alternativeRoute && renderRouteCard(data.alternativeRoute, 'alternative')}
          {data.rejectedRoute && renderRouteCard(data.rejectedRoute, 'rejected')}

          <Text style={[styles.sectionTitle, { color: colors.text }]}>Layer Analysis</Text>

          {(data.layerResults || []).map(renderLayerCard)}

          {data.dataReliability && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Data Reliability</Text>
              <View style={[styles.reliabilityCard, { backgroundColor: colors.card }]}>
                <View style={styles.reliabilityGrid}>
                  {[
                    { label: 'Signal Density', value: data.dataReliability.signalDensity },
                    { label: 'Signal Diversity', value: data.dataReliability.signalDiversity },
                    { label: 'Narrative Stability', value: data.dataReliability.narrativeStability },
                    { label: 'Objection Specificity', value: data.dataReliability.objectionSpecificity },
                    { label: 'Trust Specificity', value: data.dataReliability.trustSpecificity },
                    { label: 'Overall Reliability', value: data.dataReliability.overallReliability },
                  ].map((item, i) => (
                    <View key={i} style={styles.reliabilityItem}>
                      <Text style={[styles.reliabilityLabel, { color: colors.textMuted }]}>{item.label}</Text>
                      <Text style={[styles.reliabilityValue, { color: scoreColor(item.value || 0) }]}>
                        {Math.round((item.value || 0) * 100)}%
                      </Text>
                    </View>
                  ))}
                </View>
                {(data.dataReliability.advisories || []).length > 0 && (
                  <View style={styles.advisories}>
                    {data.dataReliability.advisories.map((adv: string, i: number) => (
                      <View key={i} style={styles.findingRow}>
                        <Ionicons name="information-circle" size={12} color={colors.textMuted} />
                        <Text style={[styles.findingText, { color: colors.textMuted }]}>{adv}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          <View style={[styles.metaInfo, { backgroundColor: colors.card }]}>
            <Text style={[styles.metaText, { color: colors.textMuted }]}>
              Engine V{data.engineVersion} · {data.executionTimeMs}ms · {data.createdAt ? new Date(data.createdAt).toLocaleString() : ''}
            </Text>
          </View>
        </>
      )}

      {!hasData && !loading && (
        <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
          <Ionicons name="megaphone-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Persuasion Analysis Yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Run the Awareness Engine first, then analyze persuasion logic to generate influence architecture.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  headerGradient: { borderRadius: 12, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 6, lineHeight: 16 },
  dependencyWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, marginBottom: 12 },
  dependencyText: { fontSize: 13, flex: 1 },
  analyzeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10, marginBottom: 16 },
  analyzeButtonText: { fontSize: 15, fontWeight: '600' as const, color: '#fff' },
  scoreSection: { borderRadius: 12, padding: 16, marginBottom: 16 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  scoreLabel: { fontSize: 14, fontWeight: '600' as const },
  scoreValue: { fontSize: 28, fontWeight: '700' as const },
  scoreBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  normalizedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  normalizedText: { fontSize: 11 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, marginBottom: 10, marginTop: 8 },
  routeCard: { borderRadius: 10, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  routeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  routeHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  routeTypeLabel: { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  routeName: { fontSize: 13, fontWeight: '500' as const, marginTop: 2 },
  routeHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scorePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  scorePillText: { fontSize: 12, fontWeight: '700' as const },
  routeDetails: { paddingHorizontal: 12, paddingBottom: 12 },
  routeDivider: { height: 1, marginBottom: 10 },
  routeMetaGrid: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  routeMetaItem: { flex: 1, padding: 8, borderRadius: 8 },
  routeMetaLabel: { fontSize: 10, marginBottom: 4 },
  routeMetaBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' as const },
  routeMetaBadgeText: { fontSize: 11, fontWeight: '600' as const },
  routeSection: { marginTop: 10 },
  routeSectionTitle: { fontSize: 11, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 4 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' as const },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  listItemText: { fontSize: 12, flex: 1, lineHeight: 16 },
  sequenceItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sequenceNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sequenceNumberText: { fontSize: 11, fontWeight: '700' as const },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, borderRadius: 8, marginTop: 10 },
  rejectionText: { fontSize: 12, flex: 1, lineHeight: 16 },
  layerCard: { borderRadius: 8, marginBottom: 6, borderLeftWidth: 3, overflow: 'hidden' },
  layerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10 },
  layerHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  layerLabel: { fontSize: 13, fontWeight: '500' as const },
  layerHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  layerScorePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  layerScoreText: { fontSize: 11, fontWeight: '600' as const },
  layerDetails: { paddingHorizontal: 10, paddingBottom: 10 },
  findingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  findingText: { fontSize: 11, flex: 1, lineHeight: 15 },
  reliabilityCard: { borderRadius: 10, padding: 12, marginBottom: 10 },
  reliabilityGrid: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 8 },
  reliabilityItem: { width: '30%' as any, minWidth: 90 },
  reliabilityLabel: { fontSize: 10, marginBottom: 2 },
  reliabilityValue: { fontSize: 16, fontWeight: '700' as const },
  advisories: { marginTop: 10 },
  metaInfo: { borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 20 },
  metaText: { fontSize: 11, textAlign: 'center' as const },
  emptyState: { borderRadius: 12, padding: 32, alignItems: 'center', gap: 8, marginTop: 20 },
  emptyTitle: { fontSize: 16, fontWeight: '600' as const },
  emptySubtitle: { fontSize: 13, textAlign: 'center' as const, lineHeight: 18 },
  collapsibleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barrierCard: { borderRadius: 8, padding: 10, marginBottom: 6, borderLeftWidth: 3 },
  barrierHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  severityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  severityText: { fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  barrierType: { fontSize: 12, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  barrierSource: { fontSize: 11, marginBottom: 4 },
  barrierImplication: { fontSize: 11, lineHeight: 15, fontStyle: 'italic' as const },
  proofLinkCard: { borderRadius: 8, padding: 8, marginBottom: 6 },
  proofLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  proofLinkLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  proofLinkRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  proofLinkCategory: { fontSize: 11, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  proofLinkType: { fontSize: 11, fontWeight: '500' as const },
  proofLinkDetail: { fontSize: 10, marginBottom: 4 },
  confidenceBar: { height: 3, borderRadius: 2, overflow: 'hidden' },
  confidenceBarFill: { height: '100%', borderRadius: 2 },
  readinessCard: { borderRadius: 8, padding: 10, marginBottom: 8 },
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  readinessStage: { fontSize: 12, fontWeight: '600' as const, textTransform: 'capitalize' as const },
  readinessProofRole: { fontSize: 11, fontStyle: 'italic' as const },
  scarcityCard: { borderRadius: 8, padding: 10, marginTop: 8 },
  scarcityHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  scarcityTitle: { fontSize: 12, fontWeight: '600' as const },
  autoCorrectionCard: { borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1 },
  autoCorrectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  autoCorrectionTitle: { fontSize: 13, fontWeight: '700' as const },
  autoCorrectionModes: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  modeChipText: { fontSize: 11, fontWeight: '600' as const },
  autoCorrectionReason: { fontSize: 11, lineHeight: 15, fontStyle: 'italic' as const },
});
