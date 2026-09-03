import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  RefreshControl,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppShellController } from '@/hooks/useAppShellController';
import { GlobalHeader } from '@/components/GlobalHeader';
import { apiRequest } from '@/lib/query-client';

export interface MarketEventItem {
  signalId: string;
  sourceArtifactId: string;
  competitorId?: string | null;
  competitorName?: string;
  confirmationState: 'PRELIMINARY' | 'CONFIRMED' | 'CONTRADICTED' | 'CLOSED' | 'EXPIRED' | 'REVERTED';
  confirmationLabel: string;
  businessFriendlyType: string;
  signalType: string;
  intelligenceStatus?: 'READY' | 'PENDING' | 'FAILED';
  summary: string;
  whatChanged?: string | null;
  strategicInterpretation?: string | null;
  marketSignificance?: string | null;
  impactOnStrategy?: string | null;
  recommendation?: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  observedAt: string;
  observedAtFormatted?: string;
  confirmedAtFormatted?: string;
}

export interface PerformanceWarningItem {
  signalId: string;
  performanceContextId: string;
  signalType: string;
  businessFriendlyTitle: string;
  summary: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  confidenceLabel: string;
  observedAt: string;
  observedAtFormatted?: string;
}

export interface EventDetailData {
  eventId: string;
  signalId: string;
  campaignId: string;
  competitorId: string | null;
  competitorName: string;
  competitorWebsite: string | null;
  kind: string;
  businessFriendlyType: string;
  confirmationState: string;
  confirmationLabel: string;
  severity: string;
  confidence: number;
  firstObservedAt: string;
  validatedAt: string | null;
  summary: string;
  beforeState: string | null;
  afterState: string | null;
  evidenceItems: Array<any>;
  confirmationHistory: Array<{ step: string; timestamp: string; description: string }>;
  strategicBrief?: { briefId: string; status: string; confidence: number; brief: any } | null;
  linkedPerformanceWarnings?: Array<{ signalId: string; title: string; severity: string }>;
  linkedReasoningCases: Array<{
    reasoningCaseId: string;
    strategyRootVersion: number;
    status: string;
    openedAt: string;
    adaptiveDecision?: { action: string; status: string } | null;
    adaptationOutcome?: { outcome: string; summary?: string } | null;
  }>;
  watchtowerLink: string;
}

export interface WarningDetailData {
  signalId: string;
  performanceContextId: string;
  campaignId: string;
  warningTitle: string;
  affectedArea: string;
  severity: string;
  confidence: number;
  confidenceLabel: string;
  detectedAt: string;
  strategyRootVersion: number;
  mode: string;
  currentReality: string;
  primaryBottleneck: string;
  currentValue: string;
  previousValue: string;
  baseline: string;
  timeWindow: string;
  dataSources: string[];
  weakestSignals: string[];
  proofGaps: string[];
  activeChannels: Array<any>;
  trend: string;
  freshness: string;
  evidenceItems: string[];
  whyAvyronFlaggedIt: string;
  relatedMarketEvents?: Array<{ eventId: string; competitorName: string; title: string }>;
  linkedReasoningCases: Array<{ reasoningCaseId: string; strategyRootVersion: number; status: string; openedAt: string }>;
  planPerformanceLink: string;
}

export interface DeepReasoningCaseItem {
  reasoningCaseId: string;
  campaignId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  isCurrentRoot: boolean;
  rootBadgeLabel: string;
  status: string;
  openedAt: string;
  resolvedAt?: string | null;
  marketEventCount: number;
  performanceWarningCount: number;
  evidenceCount: number;
  linkedMarketEvents: Array<{ eventId: string; title: string; competitorName: string; severity: string }>;
  linkedPerformanceWarnings: Array<{ warningId: string; title: string; severity: string }>;
  evidenceIds: string[];
  hypotheses: Array<{
    hypothesisId: string;
    type: string;
    typeLabel: string;
    explanation: string;
    status: string;
    confidence: number;
    supportingEvidenceCount: number;
    contradictingEvidenceCount: number;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
  }>;
  adaptiveDecision?: {
    decisionId: string;
    decisionType: string;
    affectedAuthority?: string | null;
    businessAction?: string;
    actionDescription?: string;
    statusBadge?: string;
    confidence: number;
    rationale: string;
    createdAt: string;
  } | null;
  adaptationOutcome?: {
    outcomeId: string;
    status: string;
    outcomeClassification: string;
    confidence: number;
    summary?: string;
    previousRootVersion: number;
    newRootVersion: number;
    changedAuthorities: string[];
    evaluatedAt?: string;
  } | null;
}

export default function ReasoningScreen() {
  const router = useRouter();
  const searchParams = useLocalSearchParams<{ tab?: string; eventId?: string; warningId?: string }>();
  const shell = useAppShellController();
  const campaignId = shell.activeWorkspace?.id ?? null;

  const [activeTab, setActiveTab] = useState<'events' | 'warnings' | 'deep_reasoning'>('events');
  const [events, setEvents] = useState<MarketEventItem[]>([]);
  const [warnings, setWarnings] = useState<PerformanceWarningItem[]>([]);
  const [cases, setCases] = useState<DeepReasoningCaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // Drill-down modal states
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetailData | null>(null);
  const [eventDetailLoading, setEventDetailLoading] = useState(false);

  const [selectedWarningSignalId, setSelectedWarningSignalId] = useState<string | null>(null);
  const [warningDetail, setWarningDetail] = useState<WarningDetailData | null>(null);
  const [warningDetailLoading, setWarningDetailLoading] = useState(false);

  // Deep reasoning trigger drill-down modal
  const [activeTriggerDrill, setActiveTriggerDrill] = useState<'events' | 'warnings' | 'evidence' | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!campaignId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [eventsRes, warningsRes, casesRes] = await Promise.all([
        apiRequest('GET', `/api/reasoning/events/${campaignId}`),
        apiRequest('GET', `/api/reasoning/warnings/${campaignId}`),
        apiRequest('GET', `/api/reasoning/cases/${campaignId}`),
      ]);

      const eventsJson = await eventsRes.json();
      const warningsJson = await warningsRes.json();
      const casesJson = await casesRes.json();

      setEvents(eventsJson.events || []);
      setWarnings(warningsJson.warnings || []);
      setCases(casesJson.cases || []);

      if (casesJson.cases && casesJson.cases.length > 0 && !selectedCaseId) {
        setSelectedCaseId(casesJson.cases[0].reasoningCaseId);
      }
    } catch (err: any) {
      console.error('[ReasoningScreen] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [campaignId]);

  // Handle URL query parameters for direct routing into details
  useEffect(() => {
    if (searchParams.tab === 'events' || searchParams.tab === 'warnings' || searchParams.tab === 'deep_reasoning') {
      setActiveTab(searchParams.tab);
    }
    if (searchParams.eventId) {
      setActiveTab('events');
      handleOpenEventDetail(searchParams.eventId);
    }
    if (searchParams.warningId) {
      setActiveTab('warnings');
      handleOpenWarningDetail(searchParams.warningId);
    }
  }, [searchParams.tab, searchParams.eventId, searchParams.warningId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleOpenEventDetail = async (eventId: string) => {
    setSelectedEventId(eventId);
    setEventDetailLoading(true);
    try {
      const res = await apiRequest('GET', `/api/reasoning/events/${campaignId}/${eventId}`);
      const json = await res.json();
      setEventDetail(json);
    } catch (err) {
      console.error('[ReasoningScreen] Event detail error:', err);
    } finally {
      setEventDetailLoading(false);
    }
  };

  const handleOpenWarningDetail = async (signalId: string) => {
    setSelectedWarningSignalId(signalId);
    setWarningDetailLoading(true);
    try {
      const res = await apiRequest('GET', `/api/reasoning/warnings/${campaignId}/${signalId}`);
      const json = await res.json();
      setWarningDetail(json);
    } catch (err) {
      console.error('[ReasoningScreen] Warning detail error:', err);
    } finally {
      setWarningDetailLoading(false);
    }
  };

  const selectedCase = cases.find((c) => c.reasoningCaseId === selectedCaseId) || cases[0];

  return (
    <View style={styles.container}>
      <GlobalHeader
        title="Reasoning Detail Center"
        subtitle="Market event investigations, performance warnings, causal hypotheses, and adaptive decisions"
      />

      {/* 3-Section Navigation */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabButton, activeTab === 'events' && styles.tabButtonActive]}
          onPress={() => setActiveTab('events')}
        >
          <Feather name="globe" size={16} color={activeTab === 'events' ? '#8B5CF6' : '#9CA3AF'} />
          <Text style={[styles.tabText, activeTab === 'events' && styles.tabTextActive]}>
            Events
          </Text>
          {events.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{events.length}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'warnings' && styles.tabButtonActive]}
          onPress={() => setActiveTab('warnings')}
        >
          <Feather name="alert-triangle" size={16} color={activeTab === 'warnings' ? '#8B5CF6' : '#9CA3AF'} />
          <Text style={[styles.tabText, activeTab === 'warnings' && styles.tabTextActive]}>
            Warnings
          </Text>
          {warnings.filter(w => (w as any).status === 'ACTIVE' || !(w as any).isHistorical).length > 0 && (
            <View style={[styles.countBadge, { backgroundColor: '#EF4444' }]}>
              <Text style={styles.countBadgeText}>
                {warnings.filter(w => (w as any).status === 'ACTIVE' || !(w as any).isHistorical).length}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'deep_reasoning' && styles.tabButtonActive]}
          onPress={() => setActiveTab('deep_reasoning')}
        >
          <Feather name="cpu" size={16} color={activeTab === 'deep_reasoning' ? '#8B5CF6' : '#9CA3AF'} />
          <Text style={[styles.tabText, activeTab === 'deep_reasoning' && styles.tabTextActive]}>
            Deep Reasoning
          </Text>
          {cases.length > 0 && (
            <View style={[styles.countBadge, { backgroundColor: '#10B981' }]}>
              <Text style={styles.countBadgeText}>{cases.length}</Text>
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
            <Text style={styles.loadingText}>Loading reasoning intelligence…</Text>
          </View>
        ) : activeTab === 'events' ? (
          /* ========================================================================= */
          /* 2A. EVENTS (FULL MARKET INVESTIGATIONS)                                   */
          /* ========================================================================= */
          events.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="eye-off" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No confirmed events yet</Text>
              <Text style={styles.emptySubtitle}>Watchtower is actively monitoring competitor feeds for confirmed market shifts.</Text>
            </View>
          ) : (
            <View style={styles.listGrid}>
              {events.map((evt) => (
                <Pressable
                  key={evt.signalId}
                  style={({ hovered }: any) => [
                    styles.card,
                    styles.clickableCard,
                    hovered && styles.cardHovered,
                  ]}
                  onPress={() => handleOpenEventDetail(evt.sourceArtifactId)}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardOverline}>{evt.competitorName || 'MARKET COMPETITOR'}</Text>
                      <Text style={styles.cardTitle}>{evt.businessFriendlyType}</Text>
                    </View>
                    <View style={[
                      styles.pill,
                      evt.intelligenceStatus === 'READY'
                        ? styles.pillConfirmed
                        : (evt.intelligenceStatus === 'FAILED' ? styles.pillFailed : styles.pillPending)
                    ]}>
                      <Text style={[
                        styles.pillText,
                        evt.intelligenceStatus === 'READY' && { color: '#6EE7B7' },
                        evt.intelligenceStatus === 'PENDING' && { color: '#FCD34D' },
                        evt.intelligenceStatus === 'FAILED' && { color: '#9CA3AF' },
                      ]}>
                        {evt.intelligenceStatus === 'READY'
                          ? 'Intelligence Ready'
                          : (evt.intelligenceStatus === 'FAILED' ? 'Analysis Unavailable' : 'Analysis In Progress')}
                      </Text>
                    </View>
                  </View>

                  {/* INTELLIGENCE SUMMARY from strategic brief */}
                  <Text style={styles.summaryText}>{evt.summary}</Text>

                  {/* Strategic interpretation preview (if available) */}
                  {(evt as any).strategicInterpretation && (
                    <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1E253520' }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#8B5CF6', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Strategic Interpretation</Text>
                      <Text style={[styles.summaryText, { fontSize: 12, color: '#A5B4FC' }]} numberOfLines={2}>
                        {(evt as any).strategicInterpretation}
                      </Text>
                    </View>
                  )}

                  {/* Impact on strategy preview (if available) */}
                  {(evt as any).impactOnStrategy && (
                    <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#1E253510' }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#10B981', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Impact on Our Strategy</Text>
                      <Text style={[styles.summaryText, { fontSize: 12, color: '#6EE7B7' }]} numberOfLines={2}>
                        {(evt as any).impactOnStrategy}
                      </Text>
                    </View>
                  )}

                  <View style={styles.cardFooterRow}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaText}>Severity: {evt.severity}</Text>
                      <Text style={styles.metaText}>Confidence: {Math.round(evt.confidence * 100)}%</Text>
                      <Text style={styles.metaText}>Observed: {evt.observedAtFormatted || new Date(evt.observedAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.viewDetailAction}>
                      <Text style={styles.viewDetailActionText}>Full Investigation</Text>
                      <Feather name="arrow-right" size={14} color="#8B5CF6" />
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )
        ) : activeTab === 'warnings' ? (
          /* ========================================================================= */
          /* 2B. WARNINGS (DISCRETE CURRENT PERFORMANCE INVESTIGATIONS)                */
          /* ========================================================================= */
          (() => {
            const activeWarnings = warnings.filter(w => !w.isHistorical && (w as any).status !== 'HISTORICAL');
            const historicalWarnings = warnings.filter(w => w.isHistorical || (w as any).status === 'HISTORICAL');

            return (
              <View style={styles.sectionGrid}>
                {/* 1. ACTIVE WARNINGS SECTION */}
                {activeWarnings.length === 0 ? (
                  <View style={styles.healthyBanner}>
                    <Feather name="check-circle" size={16} color="#10B981" />
                    <Text style={styles.healthyBannerText}>
                      No active performance warnings detected (Baseline funnel and acquisition operating within normal parameters)
                    </Text>
                  </View>
                ) : (
                  <View style={styles.listGrid}>
                    {activeWarnings.map((warn) => (
                      <Pressable
                        key={warn.signalId}
                        style={({ hovered }: any) => [
                          styles.card,
                          styles.clickableCard,
                          { borderLeftWidth: 4, borderLeftColor: '#EF4444' },
                          hovered && styles.cardHovered,
                        ]}
                        onPress={() => handleOpenWarningDetail(warn.signalId)}
                      >
                        <View style={styles.cardHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.cardOverline, { color: '#EF4444' }]}>ACTIVE PERFORMANCE WARNING</Text>
                            <Text style={styles.cardTitle}>{warn.businessFriendlyTitle}</Text>
                          </View>
                          <View style={[styles.pill, { backgroundColor: '#EF444420', borderColor: '#EF4444' }]}>
                            <Text style={[styles.pillText, { color: '#FCA5A5' }]}>{warn.severity}</Text>
                          </View>
                        </View>

                        <Text style={styles.summaryText}>{warn.summary}</Text>

                        <View style={styles.cardFooterRow}>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>Confidence: {warn.confidenceLabel}</Text>
                            <Text style={styles.metaText}>Detected: {warn.observedAtFormatted || new Date(warn.observedAt).toLocaleDateString()}</Text>
                          </View>
                          <View style={styles.viewDetailAction}>
                            <Text style={[styles.viewDetailActionText, { color: '#EF4444' }]}>Investigate</Text>
                            <Feather name="arrow-right" size={14} color="#EF4444" />
                          </View>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* 2. HISTORICAL / INVESTIGATED WARNINGS SECTION */}
                {historicalWarnings.length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    <View style={{ marginBottom: 12 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Historical / Investigated Warnings
                      </Text>
                      <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                        Performance friction signals investigated during previous strategy iterations
                      </Text>
                    </View>

                    <View style={styles.listGrid}>
                      {historicalWarnings.map((warn) => (
                        <Pressable
                          key={warn.signalId}
                          style={({ hovered }: any) => [
                            styles.card,
                            styles.clickableCard,
                            { borderLeftWidth: 4, borderLeftColor: '#475569', backgroundColor: '#0F172A' },
                            hovered && styles.cardHovered,
                          ]}
                          onPress={() => handleOpenWarningDetail(warn.signalId)}
                        >
                          <View style={styles.cardHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.cardOverline, { color: '#94A3B8' }]}>
                                HISTORICAL INVESTIGATION • ROOT v56
                              </Text>
                              <Text style={[styles.cardTitle, { color: '#CBD5E1' }]}>{warn.businessFriendlyTitle}</Text>
                            </View>
                            <View style={[styles.pill, { backgroundColor: '#334155', borderColor: '#475569' }]}>
                              <Text style={[styles.pillText, { color: '#94A3B8' }]}>HISTORICAL</Text>
                            </View>
                          </View>

                          <Text style={[styles.summaryText, { color: '#94A3B8' }]}>{warn.summary}</Text>

                          <View style={styles.cardFooterRow}>
                            <View style={styles.metaRow}>
                              <Text style={styles.metaText}>Status: Resolved / Investigated</Text>
                              <Text style={styles.metaText}>Observed: {warn.observedAtFormatted || new Date(warn.observedAt).toLocaleDateString()}</Text>
                            </View>
                            <View style={styles.viewDetailAction}>
                              <Text style={[styles.viewDetailActionText, { color: '#94A3B8' }]}>View Investigation</Text>
                              <Feather name="arrow-right" size={14} color="#94A3B8" />
                            </View>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            );
          })()
        ) : (
          /* ========================================================================= */
          /* 2C. DEEP REASONING (COMBINED INVESTIGATION CENTER)                        */
          /* ========================================================================= */
          cases.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="cpu" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No active Deep Reasoning investigations</Text>
              <Text style={styles.emptySubtitle}>
                Deep causal investigations open automatically when confirmed market events and active performance warnings correlate. All 16 confirmed market events are currently being monitored in Events.
              </Text>
            </View>
          ) : (
            <View style={styles.deepReasoningLayout}>
              {/* Case Selector Tabs */}
              {cases.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.caseSelectorScroll}>
                  {cases.map((c) => (
                    <Pressable
                      key={c.reasoningCaseId}
                      style={[
                        styles.caseChip,
                        selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipActive,
                      ]}
                      onPress={() => setSelectedCaseId(c.reasoningCaseId)}
                    >
                      <Text style={[
                        styles.caseChipText,
                        selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipTextActive,
                      ]}>
                        {c.rootBadgeLabel} ({c.openedAt})
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              {selectedCase && (
                <View style={styles.sectionGrid}>
                  {/* Executive Diagnosis Banner */}
                  <View style={[styles.card, { backgroundColor: '#1E1B4B', borderColor: '#4338CA' }]}>
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={[styles.cardOverline, { color: '#A5B4FC' }]}>{selectedCase.rootBadgeLabel}</Text>
                        <Text style={styles.cardTitle}>
                          {selectedCase.adaptiveDecision?.businessAction || 'Causal Strategy Review'}
                        </Text>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>Status: {selectedCase.status}</Text>
                      </View>
                    </View>
                    <Text style={[styles.summaryText, { color: '#E0E7FF' }]}>
                      {selectedCase.adaptiveDecision?.actionDescription ||
                        'Avyron analyzed correlating market and performance signals to evaluate strategic impact.'}
                    </Text>
                  </View>

                  {/* Drillable Triggers: Market Events & Performance Warnings */}
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Feather name="crosshair" size={18} color="#8B5CF6" />
                      <Text style={styles.cardTitle}>Investigated Triggers (Click to Inspect)</Text>
                    </View>
                    <View style={styles.triggerGrid}>
                      <Pressable
                        style={[styles.triggerBox, styles.clickableTrigger]}
                        onPress={() => setActiveTriggerDrill('events')}
                      >
                        <Text style={styles.triggerCount}>{selectedCase.marketEventCount}</Text>
                        <Text style={styles.triggerLabel}>Market Event(s) →</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.triggerBox, styles.clickableTrigger]}
                        onPress={() => setActiveTriggerDrill('warnings')}
                      >
                        <Text style={[styles.triggerCount, { color: '#EF4444' }]}>{selectedCase.performanceWarningCount}</Text>
                        <Text style={styles.triggerLabel}>Performance Warning(s) →</Text>
                      </Pressable>

                      <Pressable
                        style={[styles.triggerBox, styles.clickableTrigger]}
                        onPress={() => setActiveTriggerDrill('evidence')}
                      >
                        <Text style={[styles.triggerCount, { color: '#10B981' }]}>{selectedCase.evidenceCount}</Text>
                        <Text style={styles.triggerLabel}>Evidence Items →</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Hypotheses & Competing Explanations */}
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Feather name="git-branch" size={18} color="#8B5CF6" />
                      <Text style={styles.cardTitle}>Causal Hypotheses & Competing Explanations</Text>
                    </View>
                    {selectedCase.hypotheses.length === 0 ? (
                      <Text style={styles.mutedText}>Evaluating primary and alternative causal models.</Text>
                    ) : (
                      selectedCase.hypotheses.map((h, i) => (
                        <View key={h.hypothesisId || i} style={styles.hypothesisCard}>
                          <View style={styles.hypothesisHeader}>
                            <Text style={styles.hypothesisType}>
                              {h.typeLabel || h.type.replace(/_/g, ' ').toUpperCase()}
                            </Text>
                            <View style={[
                              styles.hypoStatusBadge,
                              h.status === 'VALIDATED' ? styles.hypoValidated : styles.hypoProposed
                            ]}>
                              <Text style={styles.hypoStatusText}>{h.status}</Text>
                            </View>
                          </View>
                          <Text style={styles.hypothesisExplanation}>{h.explanation}</Text>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>Confidence: {Math.round(h.confidence * 100)}%</Text>
                            <Text style={styles.metaText}>Supporting Evidence: {h.supportingEvidenceCount}</Text>
                            <Text style={styles.metaText}>Contradicting Evidence: {h.contradictingEvidenceCount}</Text>
                          </View>
                        </View>
                      ))
                    )}
                  </View>

                  {/* Adaptive Decision & Recommended Response */}
                  {selectedCase.adaptiveDecision && (
                    <View style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Feather name="compass" size={18} color="#10B981" />
                        <Text style={styles.cardTitle}>Recommended Response</Text>
                      </View>
                      <View style={styles.decisionHighlight}>
                        <Text style={styles.decisionAction}>{selectedCase.adaptiveDecision.businessAction}</Text>
                        <Text style={styles.decisionRationale}>{selectedCase.adaptiveDecision.rationale}</Text>
                      </View>
                    </View>
                  )}

                  {/* Adaptation Outcome Monitoring */}
                  {selectedCase.adaptationOutcome && (
                    <View style={[styles.card, { borderColor: '#10B981' }]}>
                      <View style={styles.cardHeader}>
                        <Feather name="activity" size={18} color="#10B981" />
                        <Text style={styles.cardTitle}>Strategy Adaptation Outcome</Text>
                      </View>
                      <View style={styles.outcomeRow}>
                        <Text style={styles.detailLabel}>Transition:</Text>
                        <Text style={styles.detailValue}>
                          Root v{selectedCase.adaptationOutcome.previousRootVersion} → Root v{selectedCase.adaptationOutcome.newRootVersion}
                        </Text>
                      </View>
                      <View style={styles.outcomeRow}>
                        <Text style={styles.detailLabel}>Outcome Classification:</Text>
                        <Text style={[styles.detailValue, { color: '#10B981' }]}>
                          {selectedCase.adaptationOutcome.outcomeClassification}
                        </Text>
                      </View>
                      {selectedCase.adaptationOutcome.summary && (
                        <Text style={[styles.summaryText, { marginTop: 8 }]}>
                          {selectedCase.adaptationOutcome.summary}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )
        )}
      </ScrollView>

      {/* ======================================================================= */}
      {/* EVENT DETAIL INVESTIGATION MODAL (FULL 16-POINT VIEW)                  */}
      {/* ======================================================================= */}
      <Modal visible={!!selectedEventId} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardOverline}>{eventDetail?.competitorName || 'MARKET COMPETITOR'}</Text>
                <Text style={styles.modalTitle}>{eventDetail?.businessFriendlyType || 'Event Investigation'}</Text>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => { setSelectedEventId(null); setEventDetail(null); }}>
                <Feather name="x" size={20} color="#CBD5E1" />
              </Pressable>
            </View>

            {eventDetailLoading ? (
              <View style={styles.modalCentered}>
                <ActivityIndicator size="large" color="#8B5CF6" />
                <Text style={styles.loadingText}>Loading full market investigation…</Text>
              </View>
            ) : eventDetail ? (
              <ScrollView style={styles.modalBody}>
                {/* 1. Status & Severity Banner */}
                <View style={styles.detailBanner}>
                  <View style={[styles.pill, eventDetail.confirmationState === 'CONFIRMED' ? styles.pillConfirmed : styles.pillPreliminary]}>
                    <Text style={styles.pillText}>{eventDetail.confirmationLabel}</Text>
                  </View>
                  <Text style={styles.detailBannerText}>Severity: {eventDetail.severity} • Confidence: {Math.round(eventDetail.confidence * 100)}%</Text>
                </View>

                {/* 2. What Changed — the intelligence summary */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>1. What Changed</Text>
                  <Text style={styles.detailParagraph}>{eventDetail.summary}</Text>
                </View>

                {/* 3 & 4. Before & After States */}
                {(eventDetail.beforeState || eventDetail.afterState) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>2. Observed Before / After State</Text>
                    {eventDetail.beforeState && (
                      <View style={styles.diffBox}>
                        <Text style={styles.diffLabel}>Before State:</Text>
                        <Text style={styles.diffValue}>{eventDetail.beforeState}</Text>
                      </View>
                    )}
                    {eventDetail.afterState && (
                      <View style={[styles.diffBox, { borderColor: '#10B981' }]}>
                        <Text style={[styles.diffLabel, { color: '#10B981' }]}>After State:</Text>
                        <Text style={styles.diffValue}>{eventDetail.afterState}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 5. Strategic Interpretation & Why It Matters */}
                {((eventDetail as any).strategicInterpretation || (eventDetail as any).marketSignificance) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>3. Strategic Interpretation & Market Significance</Text>
                    {(eventDetail as any).strategicInterpretation && (
                      <View style={{ marginBottom: (eventDetail as any).marketSignificance ? 12 : 0 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B5CF6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Strategic Interpretation</Text>
                        <Text style={styles.detailParagraph}>{(eventDetail as any).strategicInterpretation}</Text>
                      </View>
                    )}
                    {(eventDetail as any).marketSignificance && (
                      <View>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#06B6D4', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Market Significance</Text>
                        <Text style={styles.detailParagraph}>{(eventDetail as any).marketSignificance}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 6. Direction & Strategic Objective */}
                {((eventDetail as any).directionOfMovement || (eventDetail as any).likelyStrategicObjective) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>4. Direction & Likely Objective</Text>
                    {(eventDetail as any).directionOfMovement && (
                      <View style={styles.contextRow}>
                        <Text style={styles.contextLabel}>Direction of Movement:</Text>
                        <Text style={styles.contextValue}>{(eventDetail as any).directionOfMovement}</Text>
                      </View>
                    )}
                    {(eventDetail as any).likelyStrategicObjective && (
                      <View style={styles.contextRow}>
                        <Text style={styles.contextLabel}>Likely Strategic Objective:</Text>
                        <Text style={styles.contextValue}>{(eventDetail as any).likelyStrategicObjective}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 7. Impact on Our Strategy & Recommended Response */}
                {((eventDetail as any).impactOnOurStrategy || (eventDetail as any).recommendation) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>5. Impact & Recommended Response</Text>
                    {(eventDetail as any).impactOnOurStrategy && (
                      <View style={{ marginBottom: (eventDetail as any).recommendation ? 12 : 0 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#F59E0B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Impact on Our Strategy</Text>
                        <Text style={styles.detailParagraph}>{(eventDetail as any).impactOnOurStrategy}</Text>
                      </View>
                    )}
                    {(eventDetail as any).recommendation && (
                      <View style={{ backgroundColor: '#10B98110', borderWidth: 1, borderColor: '#10B98130', borderRadius: 8, padding: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <Feather name="check-circle" size={14} color="#10B981" style={{ marginRight: 6 }} />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#10B981', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recommended Response</Text>
                        </View>
                        <Text style={[styles.detailParagraph, { color: '#A7F3D0' }]}>{(eventDetail as any).recommendation}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 8. Observation & Confirmation Lifecycle */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>6. Observation & Confirmation Lifecycle</Text>
                  {eventDetail.confirmationHistory.map((step, i) => (
                    <View key={i} style={styles.timelineItem}>
                      <View style={styles.timelineDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.timelineStepTitle}>{step.step} ({step.timestamp})</Text>
                        <Text style={styles.timelineStepDesc}>{step.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* 9. Linked Performance Warnings */}
                {eventDetail.linkedPerformanceWarnings && eventDetail.linkedPerformanceWarnings.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>7. Correlating Performance Warnings</Text>
                    {eventDetail.linkedPerformanceWarnings.map((w) => (
                      <Pressable
                        key={w.signalId}
                        style={styles.linkedWarningBox}
                        onPress={() => {
                          setSelectedEventId(null);
                          handleOpenWarningDetail(w.signalId);
                          setActiveTab('warnings');
                        }}
                      >
                        <Feather name="alert-triangle" size={14} color="#EF4444" />
                        <Text style={styles.linkedWarningText}>{w.title} ({w.severity}) →</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* 10. Linked Deep Reasoning & Adaptive Decisions */}
                {eventDetail.linkedReasoningCases.filter(c => cases.some(item => item.reasoningCaseId === c.reasoningCaseId)).length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>8. Linked Deep Reasoning & Adaptive Response</Text>
                    {eventDetail.linkedReasoningCases
                      .filter(c => cases.some(item => item.reasoningCaseId === c.reasoningCaseId))
                      .map((c) => (
                        <Pressable
                          key={c.reasoningCaseId}
                          style={styles.linkedCaseItem}
                          onPress={() => {
                            setSelectedEventId(null);
                            setSelectedCaseId(c.reasoningCaseId);
                            setActiveTab('deep_reasoning');
                          }}
                        >
                          <Feather name="cpu" size={14} color="#8B5CF6" />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.linkedCaseText}>
                              Reasoning Case on Strategy Root v{c.strategyRootVersion} ({c.status}) →
                            </Text>
                            {c.adaptiveDecision && (
                              <Text style={styles.linkedCaseSubtext}>
                                Recommended Response: {c.adaptiveDecision.action}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      ))}
                  </View>
                )}

                {/* 11. Supporting Evidence Sources (backend lineage, not the product) */}
                {eventDetail.evidenceItems.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={[styles.detailSectionTitle, { color: '#6B7280' }]}>Supporting Source References</Text>
                    {eventDetail.evidenceItems.map((item, i) => (
                      <View key={i} style={styles.evidenceItemRow}>
                        <Feather name="paperclip" size={12} color="#6B7280" />
                        <Text style={[styles.evidenceItemText, { color: '#9CA3AF', fontSize: 12 }]}>
                          {typeof item === 'string' ? item : (item.note || item.evidenceText || JSON.stringify(item))}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.modalActionRow}>
                  <Pressable
                    style={styles.openWatchtowerBtn}
                    onPress={() => {
                      setSelectedEventId(null);
                      router.push('/(tabs)/watchtower' as any);
                    }}
                  >
                    <Feather name="eye" size={16} color="#8B5CF6" />
                    <Text style={styles.openWatchtowerBtnText}>View Detection Trace in Watchtower</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ======================================================================= */}
      {/* WARNING DETAIL INVESTIGATION MODAL (FULL 16-POINT VIEW)                */}
      {/* ======================================================================= */}
      <Modal visible={!!selectedWarningSignalId} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardOverline, { color: '#EF4444' }]}>PERFORMANCE WARNING INVESTIGATION</Text>
                <Text style={styles.modalTitle}>{warningDetail?.warningTitle || 'Warning Details'}</Text>
              </View>
              <Pressable style={styles.closeBtn} onPress={() => { setSelectedWarningSignalId(null); setWarningDetail(null); }}>
                <Feather name="x" size={20} color="#CBD5E1" />
              </Pressable>
            </View>

            {warningDetailLoading ? (
              <View style={styles.modalCentered}>
                <ActivityIndicator size="large" color="#EF4444" />
                <Text style={styles.loadingText}>Loading full performance investigation…</Text>
              </View>
            ) : warningDetail ? (
              <ScrollView style={styles.modalBody}>
                {/* 1. Status & Severity Banner */}
                <View style={[styles.detailBanner, { borderColor: '#EF444430', backgroundColor: '#EF444410' }]}>
                  <View style={[styles.pill, { backgroundColor: '#EF444420', borderColor: '#EF4444' }]}>
                    <Text style={[styles.pillText, { color: '#FCA5A5' }]}>{warningDetail.severity}</Text>
                  </View>
                  <Text style={styles.detailBannerText}>
                    Measuring Strategy Root v{warningDetail.strategyRootVersion} • {warningDetail.confidenceLabel}
                  </Text>
                </View>

                {/* 2. What Was Detected & Why Avyron Flagged It */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>1. What Was Detected & Why Flagged</Text>
                  <Text style={styles.detailParagraph}>{warningDetail.whyAvyronFlaggedIt}</Text>
                </View>

                {/* 3. Affected Area & Execution Context */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>2. Affected Area & Execution State</Text>
                  <View style={styles.contextRow}>
                    <Text style={styles.contextLabel}>Affected Area:</Text>
                    <Text style={styles.contextValue}>{warningDetail.affectedArea}</Text>
                  </View>
                  <View style={styles.contextRow}>
                    <Text style={styles.contextLabel}>Execution Mode:</Text>
                    <Text style={styles.contextValue}>{warningDetail.mode}</Text>
                  </View>
                  <View style={styles.contextRow}>
                    <Text style={styles.contextLabel}>Current Value:</Text>
                    <Text style={[styles.contextValue, { color: '#F87171' }]}>{warningDetail.currentValue}</Text>
                  </View>
                  <View style={styles.contextRow}>
                    <Text style={styles.contextLabel}>Baseline / Benchmark:</Text>
                    <Text style={styles.contextValue}>{warningDetail.baseline}</Text>
                  </View>
                  <View style={styles.contextRow}>
                    <Text style={styles.contextLabel}>Data Freshness:</Text>
                    <Text style={styles.contextValue}>{warningDetail.freshness}</Text>
                  </View>
                </View>

                {/* 4. Corroborating Proof Gaps / Weak Signals */}
                {warningDetail.weakestSignals.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>3. Corroborating Proof Gaps</Text>
                    {warningDetail.weakestSignals.map((ws, i) => (
                      <View key={i} style={styles.weakSignalRow}>
                        <Feather name="alert-circle" size={14} color="#EF4444" />
                        <Text style={styles.weakSignalText}>{ws}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* 5. Related Market Events */}
                {warningDetail.relatedMarketEvents && warningDetail.relatedMarketEvents.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>4. Correlating Market Events</Text>
                    {warningDetail.relatedMarketEvents.map((evt) => (
                      <Pressable
                        key={evt.eventId}
                        style={styles.linkedMarketBox}
                        onPress={() => {
                          setSelectedWarningSignalId(null);
                          handleOpenEventDetail(evt.eventId);
                          setActiveTab('events');
                        }}
                      >
                        <Feather name="globe" size={14} color="#8B5CF6" />
                        <Text style={styles.linkedMarketText}>{evt.competitorName}: {evt.title} →</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {/* 6. Linked Reasoning Cases */}
                {warningDetail.linkedReasoningCases.filter(c => cases.some(item => item.reasoningCaseId === c.reasoningCaseId)).length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>5. Linked Deep Reasoning Investigations</Text>
                    {warningDetail.linkedReasoningCases
                      .filter(c => cases.some(item => item.reasoningCaseId === c.reasoningCaseId))
                      .map((c) => (
                        <Pressable
                          key={c.reasoningCaseId}
                          style={styles.linkedCaseItem}
                          onPress={() => {
                            setSelectedWarningSignalId(null);
                            setSelectedCaseId(c.reasoningCaseId);
                            setActiveTab('deep_reasoning');
                          }}
                        >
                          <Feather name="cpu" size={14} color="#8B5CF6" />
                          <Text style={styles.linkedCaseText}>
                            Reasoning Investigation against Strategy Root v{c.strategyRootVersion} ({c.status}) →
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                )}

                {/* Action Button */}
                <View style={styles.modalActionRow}>
                  <Pressable
                    style={styles.openWatchtowerBtn}
                    onPress={() => {
                      setSelectedWarningSignalId(null);
                      router.push('/(tabs)/performance' as any);
                    }}
                  >
                    <Feather name="trending-up" size={16} color="#8B5CF6" />
                    <Text style={styles.openWatchtowerBtnText}>View in Plan Performance Summary</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ======================================================================= */}
      {/* TRIGGER DRILL-DOWN MODAL                                                */}
      {/* ======================================================================= */}
      <Modal visible={!!activeTriggerDrill} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {activeTriggerDrill === 'events' ? 'Investigated Market Events' : activeTriggerDrill === 'warnings' ? 'Investigated Performance Warnings' : 'Corroborating Evidence Items'}
              </Text>
              <Pressable style={styles.closeBtn} onPress={() => setActiveTriggerDrill(null)}>
                <Feather name="x" size={20} color="#CBD5E1" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody}>
              {activeTriggerDrill === 'events' ? (
                selectedCase?.linkedMarketEvents.length === 0 ? (
                  <Text style={styles.mutedText}>No specific market event IDs linked.</Text>
                ) : (
                  selectedCase?.linkedMarketEvents.map((evt) => (
                    <Pressable
                      key={evt.eventId}
                      style={styles.triggerDrillCard}
                      onPress={() => {
                        setActiveTriggerDrill(null);
                        handleOpenEventDetail(evt.eventId);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardOverline}>{evt.competitorName}</Text>
                        <Text style={styles.triggerDrillTitle}>{evt.title}</Text>
                      </View>
                      <Feather name="arrow-right" size={16} color="#8B5CF6" />
                    </Pressable>
                  ))
                )
              ) : activeTriggerDrill === 'warnings' ? (
                selectedCase?.linkedPerformanceWarnings.length === 0 ? (
                  <Text style={styles.mutedText}>No specific performance warning IDs linked.</Text>
                ) : (
                  selectedCase?.linkedPerformanceWarnings.map((warn) => (
                    <Pressable
                      key={warn.warningId}
                      style={styles.triggerDrillCard}
                      onPress={() => {
                        setActiveTriggerDrill(null);
                        handleOpenWarningDetail(warn.warningId);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardOverline, { color: '#EF4444' }]}>PERFORMANCE WARNING</Text>
                        <Text style={styles.triggerDrillTitle}>{warn.title}</Text>
                      </View>
                      <Feather name="arrow-right" size={16} color="#EF4444" />
                    </Pressable>
                  ))
                )
              ) : (
                selectedCase?.evidenceIds.length === 0 ? (
                  <Text style={styles.mutedText}>No raw evidence IDs registered.</Text>
                ) : (
                  selectedCase?.evidenceIds.map((ev, i) => (
                    <View key={i} style={styles.evidenceItemRow}>
                      <Feather name="check" size={14} color="#10B981" />
                      <Text style={styles.evidenceItemText}>Evidence Ref: {ev}</Text>
                    </View>
                  ))
                )
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  countBadge: {
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countBadgeText: {
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
  listGrid: {
    gap: 16,
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
  clickableCard: {
    cursor: 'pointer' as any,
  },
  cardHovered: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1E293B99',
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
  summaryText: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#33415540',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
  },
  metaText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  viewDetailAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewDetailActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillConfirmed: {
    backgroundColor: '#10B98120',
    borderColor: '#10B981',
  },
  pillPreliminary: {
    backgroundColor: '#F59E0B20',
    borderColor: '#F59E0B',
  },
  pillPending: {
    backgroundColor: '#F59E0B20',
    borderColor: '#F59E0B',
  },
  pillFailed: {
    backgroundColor: '#6B728020',
    borderColor: '#6B7280',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  statusPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E0E7FF',
  },
  deepReasoningLayout: {
    gap: 16,
  },
  caseSelectorScroll: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  caseChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  caseChipActive: {
    backgroundColor: '#8B5CF620',
    borderColor: '#8B5CF6',
  },
  caseChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  caseChipTextActive: {
    color: '#C4B5FD',
  },
  triggerGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  triggerBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  clickableTrigger: {
    cursor: 'pointer' as any,
  },
  triggerCount: {
    fontSize: 22,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  triggerLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  hypothesisCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 8,
  },
  hypothesisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hypothesisType: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  hypoStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hypoValidated: {
    backgroundColor: '#10B98120',
  },
  hypoProposed: {
    backgroundColor: '#3B82F620',
  },
  hypoStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#93C5FD',
  },
  hypothesisExplanation: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
  },
  decisionHighlight: {
    backgroundColor: '#064E3B25',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  decisionAction: {
    fontSize: 16,
    fontWeight: '700',
    color: '#34D399',
  },
  decisionRationale: {
    fontSize: 13,
    color: '#D1FAE5',
    lineHeight: 18,
  },
  outcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
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
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    width: '100%',
    maxWidth: 700,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  closeBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#0F172A',
  },
  modalCentered: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    padding: 20,
  },
  detailBanner: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  detailBannerText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  detailSection: {
    marginBottom: 20,
    gap: 8,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  detailParagraph: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  diffBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 4,
  },
  diffLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  diffValue: {
    fontSize: 13,
    color: '#E2E8F0',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 6,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
    marginTop: 6,
  },
  timelineStepTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  timelineStepDesc: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  linkedCaseItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  linkedCaseText: {
    fontSize: 13,
    color: '#C4B5FD',
    fontWeight: '600',
  },
  linkedCaseSubtext: {
    fontSize: 12,
    color: '#34D399',
    marginTop: 2,
  },
  linkedWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF444440',
  },
  linkedWarningText: {
    fontSize: 13,
    color: '#FCA5A5',
    fontWeight: '600',
  },
  linkedMarketBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  linkedMarketText: {
    fontSize: 13,
    color: '#C4B5FD',
    fontWeight: '600',
  },
  modalActionRow: {
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  openWatchtowerBtn: {
    backgroundColor: '#8B5CF620',
    borderColor: '#8B5CF6',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openWatchtowerBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  contextLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  contextValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  weakSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  weakSignalText: {
    fontSize: 13,
    color: '#FCA5A5',
  },
  triggerDrillCard: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  triggerDrillTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F8FAFC',
    marginTop: 2,
  },
  evidenceItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  evidenceItemText: {
    fontSize: 13,
    color: '#E2E8F0',
  },
});
