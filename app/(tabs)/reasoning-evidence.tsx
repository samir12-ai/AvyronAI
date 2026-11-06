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
  caseCategory?: 'EXPLANATION' | 'PROPOSED_CHANGE';
  isActionableProposal?: boolean;
  targetType?: 'STRATEGY' | 'EXECUTION' | 'NONE';
  openedAt: string;
  resolvedAt?: string | null;
  marketEventCount: number;
  performanceWarningCount: number;
  evidenceCount: number;
  linkedMarketEvents: Array<{ eventId: string; title: string; competitorName: string; severity: string }>;
  linkedPerformanceWarnings: Array<{ warningId: string; title: string; severity: string }>;
  evidenceIds: string[];
  resolvedEvidenceItems?: Array<{
    evidenceId: string;
    sourceType: string;
    title: string;
    summary: string;
    observedAt: string | null;
    url: string | null;
  }>;
  explanationDetails?: {
    whatWasObserved: string;
    whatItMayMean: string;
    evidenceAndUncertainty: string;
    whyNoActionProposed: string;
    whatWouldJustifyReconsideration: string;
    sharedOriginGroup?: {
      key: string;
      siblingEventIds: string[];
      runId?: string | null;
      confirmedByRunId?: string | null;
      note: string;
    } | null;
  };
  proposalDetails?: {
    targetType: 'STRATEGY' | 'EXECUTION';
    whyActionWarranted: string;
    targetLabel: string;
    targetIds: string[];
    diffs: Array<{
      sectionName?: string;
      section?: string;
      fieldLabel?: string;
      authority?: string;
      beforeText?: string;
      before?: string;
      afterText?: string;
      after?: string;
      rationale?: string;
    }>;
    expectedEffectHypothesis: string;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
    whatRemainsUnchanged: string[];
    approvalActionLabel: string;
  } | null;
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
    targetType?: 'STRATEGY' | 'EXECUTION' | 'NONE';
    isActionableProposal?: boolean;
    affectedAuthority?: string | null;
    businessAction?: string;
    actionDescription?: string;
    statusBadge?: string;
    proposalId?: string | null;
    proposalStatus?: string | null;
    appliedVersion?: number | null;
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
  const searchParams = useLocalSearchParams<{
    tab?: string;
    eventId?: string;
    warningId?: string;
    investigateEventId?: string;
    scenarioId?: string;
  }>();
  const shell = useAppShellController();
  const campaignId = shell.activeWorkspace?.id ?? null;

  const [activeTab, setActiveTab] = useState<'events' | 'warnings' | 'deep_reasoning'>('events');
  const [events, setEvents] = useState<MarketEventItem[]>([]);
  const [warnings, setWarnings] = useState<PerformanceWarningItem[]>([]);
  const [cases, setCases] = useState<DeepReasoningCaseItem[]>([]);
  const [pendingScenarios, setPendingScenarios] = useState<any[]>([]);
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
  const [approvingProposal, setApprovingProposal] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [investigatingTarget, setInvestigatingTarget] = useState<string | null>(null);
  const [investigationProgressStep, setInvestigationProgressStep] = useState<string | null>(null);
  const [lastApprovalConfirmation, setLastApprovalConfirmation] = useState<{
    proposalId: string;
    targetType: 'STRATEGY' | 'EXECUTION';
    newStrategyVersion: number | null;
    appliedScenarios: string[];
    title: string;
    affectedPlanItems: string[];
  } | null>(null);

  const openEvidenceUrl = (url: string) => {
    if (typeof window !== 'undefined' && window.open) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const fetchData = async (preferredCaseId?: string | null) => {
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
      const fetchedCases: DeepReasoningCaseItem[] = casesJson.cases || [];
      setCases(fetchedCases);
      setPendingScenarios(casesJson.pendingActionableScenarios || []);

      if (preferredCaseId && fetchedCases.some((c) => c.reasoningCaseId === preferredCaseId)) {
        setSelectedCaseId(preferredCaseId);
      } else if (fetchedCases.length > 0 && (!selectedCaseId || !fetchedCases.some((c) => c.reasoningCaseId === selectedCaseId))) {
        setSelectedCaseId(fetchedCases[0].reasoningCaseId);
      }
    } catch (err: any) {
      console.error('[ReasoningScreen] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRunDeepReasoning = async (eventIdOrScenarioId: string) => {
    if (!eventIdOrScenarioId || investigatingTarget) return;
    setSelectedEventId(null);
    setActiveTab('deep_reasoning');
    setInvestigatingTarget(eventIdOrScenarioId);
    setInvestigationProgressStep('Step 1/3 · Verifying Watchtower snapshot diff & corroborating evidence sources…');
    try {
      await new Promise((r) => setTimeout(r, 320));
      setInvestigationProgressStep('Step 2/3 · Evaluating competing causal hypotheses & affected strategic assumption…');
      await new Promise((r) => setTimeout(r, 340));
      setInvestigationProgressStep('Step 3/3 · Computing surgical BEFORE / AFTER strategy patch (no changes applied yet)…');
      const res = await apiRequest('POST', `/api/demo/investigate/${encodeURIComponent(eventIdOrScenarioId)}`);
      const resJson = await res.json();
      await fetchData(resJson.reasoningCaseId || null);
      if (resJson.reasoningCaseId) {
        setSelectedCaseId(resJson.reasoningCaseId);
      }
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail: { investigated: eventIdOrScenarioId } }));
      }
    } catch (err) {
      console.error('[ReasoningScreen] Run Deep Reasoning error:', err);
    } finally {
      setInvestigatingTarget(null);
      setInvestigationProgressStep(null);
    }
  };

  const handleApproveCaseProposal = async (proposalId?: string | null) => {
    if (approvingProposal) return;
    setApprovalError(null);
    const currentCaseDecision: any = selectedCase?.adaptiveDecision || {};
    const targetProposalId = proposalId || currentCaseDecision?.proposalId || null;

    if (!targetProposalId || !selectedCase?.isActionableProposal) {
      setApprovalError('No actionable proposal with a concrete semantic diff is attached to this investigation.');
      return;
    }

    const expectedTargetType =
      selectedCase?.targetType === 'EXECUTION' || currentCaseDecision?.targetType === 'EXECUTION'
        ? 'EXECUTION'
        : 'STRATEGY';

    setApprovingProposal(true);
    try {
      const res = await apiRequest(
        'POST',
        `/api/strategy/change-proposals/${encodeURIComponent(targetProposalId)}/approve`,
        {
          options: {
            expectedTargetType,
            expectedVersion: selectedCase?.strategyRootVersion,
          },
        },
      );
      const resJson = await res.json().catch(() => ({}));
      if (!res.ok || resJson.error) {
        setApprovalError(resJson.message || resJson.error || 'Proposal approval was rejected by backend validation.');
        return;
      }

      const confirmedNewVersion =
        typeof resJson.appliedVersion === 'number'
          ? resJson.appliedVersion
          : typeof resJson.newVersion === 'number'
            ? resJson.newVersion
            : typeof resJson.newStrategyVersion === 'number'
              ? resJson.newStrategyVersion
              : null;

      setLastApprovalConfirmation({
        proposalId: targetProposalId,
        targetType: expectedTargetType,
        newStrategyVersion: confirmedNewVersion,
        appliedScenarios: resJson.appliedScenarios || [],
        title:
          (selectedCase as any)?.caseTitle ||
          currentCaseDecision.businessAction ||
          (expectedTargetType === 'EXECUTION' ? 'Execution Adjustment Applied' : 'Strategy Patch Applied'),
        affectedPlanItems: Array.isArray(currentCaseDecision.affectedPlanItems)
          ? currentCaseDecision.affectedPlanItems
          : [],
      });
      await fetchData(selectedCase?.reasoningCaseId || null);
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(
          new CustomEvent('avyron-demo-state-changed', { detail: { approvedProposalId: targetProposalId } }),
        );
      }
    } catch (err: any) {
      console.error('[ReasoningScreen] Approve proposal error:', err);
      setApprovalError(err?.message || 'Failed to apply proposal.');
    } finally {
      setApprovingProposal(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleDemoChange = () => {
      fetchData();
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('avyron-demo-state-changed', handleDemoChange);
    }
    return () => {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('avyron-demo-state-changed', handleDemoChange);
      }
    };
  }, [campaignId]);

  // Handle URL query parameters for direct routing into details or triggering Deep Reasoning
  useEffect(() => {
    if (searchParams.tab === 'events' || searchParams.tab === 'warnings' || searchParams.tab === 'deep_reasoning') {
      setActiveTab(searchParams.tab);
    } else if (searchParams.tab === 'cases') {
      setActiveTab('deep_reasoning');
    }
    if (searchParams.investigateEventId || searchParams.scenarioId) {
      const target = searchParams.investigateEventId || searchParams.scenarioId;
      if (target) {
        handleRunDeepReasoning(target);
      }
      return;
    }
    if (searchParams.eventId) {
      setActiveTab('events');
      handleOpenEventDetail(searchParams.eventId);
    }
    if (searchParams.warningId) {
      setActiveTab('warnings');
      handleOpenWarningDetail(searchParams.warningId);
    }
  }, [searchParams.tab, searchParams.eventId, searchParams.warningId, searchParams.investigateEventId, searchParams.scenarioId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData(selectedCaseId);
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
          {(cases.length > 0 || pendingScenarios.length > 0) && (
            <View style={[styles.countBadge, { backgroundColor: cases.length > 0 ? '#10B981' : '#F59E0B' }]}>
              <Text style={styles.countBadgeText}>
                {cases.length > 0 ? `${cases.length} Open` : `${pendingScenarios.length} Ready`}
              </Text>
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
              {events.map((evt) => {
                const rawEvt = evt as any;
                const evtAny: any = {
                  ...rawEvt,
                  customTitle: rawEvt.businessFriendlyType,
                  product: rawEvt.productReferenced,
                  segment: rawEvt.segmentName,
                  lane: rawEvt.laneTitle,
                  nextActionBadge: rawEvt.nextActionLabel,
                  supportingEvidenceLinks: (Array.isArray(rawEvt.evidenceUrls) ? rawEvt.evidenceUrls : []).map(
                    (url: string, i: number) => ({
                      id: url,
                      url,
                      label: (url.split('/').pop() || `source-${i + 1}`),
                    }),
                  ),
                };
                const linkedCase = cases.find((c) => c.linkedMarketEvents?.some((m) => m.eventId === evt.sourceArtifactId));
                const isApplied =
                  linkedCase?.adaptationOutcome != null ||
                  (linkedCase?.adaptiveDecision as any)?.proposalStatus === 'APPLIED';
                const isActionable = Boolean(linkedCase?.isActionableProposal);
                const caseBadge =
                  linkedCase?.adaptiveDecision?.statusBadge ||
                  (linkedCase?.status === 'INSUFFICIENT_EVIDENCE' ? 'MONITORING' : 'NO_CHANGE');
                return (
                  <Pressable
                    key={evt.signalId}
                    style={({ hovered }: any) => [
                      styles.card,
                      styles.clickableCard,
                      isActionable && { borderColor: isApplied ? '#10B981' : '#F59E0B' },
                      hovered && styles.cardHovered,
                    ]}
                    onPress={() => handleOpenEventDetail(evt.sourceArtifactId)}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={styles.cardOverline}>
                          {evt.competitorName || 'MARKET COMPETITOR'} • {rawEvt.categoryType || 'Market change'}
                        </Text>
                        <Text style={styles.cardTitle}>{evtAny.customTitle || evt.businessFriendlyType}</Text>
                      </View>
                      <View style={[
                        styles.pill,
                        isActionable && !isApplied ? styles.pillPreliminary : styles.pillConfirmed,
                      ]}>
                        <Text style={[
                          styles.pillText,
                          isActionable && !isApplied && { color: '#FCD34D' },
                          (!isActionable || isApplied) && { color: '#6EE7B7' },
                        ]}>
                          {isApplied
                            ? (linkedCase?.targetType === 'EXECUTION' ? 'Execution Adjustment Applied' : 'Strategy Patch Applied')
                            : linkedCase && isActionable
                              ? 'Actionable Proposal Ready'
                              : linkedCase
                                ? `Investigated · ${caseBadge}`
                                : (evtAny.nextActionBadge || 'Intelligence Ready')}
                        </Text>
                      </View>
                    </View>

                    {/* Product / Segment / Lane metadata */}
                    {(evtAny.product || evtAny.segment || evtAny.lane) && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {evtAny.product && (
                          <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                            <Text style={{ fontSize: 11, color: '#CBD5E1' }}>Product: {evtAny.product}</Text>
                          </View>
                        )}
                        {evtAny.segment && (
                          <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                            <Text style={{ fontSize: 11, color: '#CBD5E1' }}>Segment: {evtAny.segment}</Text>
                          </View>
                        )}
                        {evtAny.lane && (
                          <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                            <Text style={{ fontSize: 11, color: '#A5B4FC', fontWeight: '600' }}>{evtAny.lane}</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* INTELLIGENCE SUMMARY */}
                    <Text style={styles.summaryText}>{evt.summary}</Text>

                    {/* Before / After diff preview */}
                    {(evtAny.beforeState || evtAny.afterState) && (
                      <View style={{ backgroundColor: '#0F172A', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#1E293B', gap: 4 }}>
                        {evtAny.beforeState && (
                          <Text style={{ fontSize: 12, color: '#94A3B8' }} numberOfLines={2}>
                            <Text style={{ fontWeight: '700', color: '#F87171' }}>BEFORE: </Text>
                            {evtAny.beforeState}
                          </Text>
                        )}
                        {evtAny.afterState && (
                          <Text style={{ fontSize: 12, color: '#E2E8F0' }} numberOfLines={2}>
                            <Text style={{ fontWeight: '700', color: '#34D399' }}>AFTER: </Text>
                            {evtAny.afterState}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Business Relevance */}
                    {(evtAny.businessRelevance || evtAny.strategicInterpretation) && (
                      <View style={{ marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1E253540' }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Business Relevance & Strategic Impact
                        </Text>
                        <Text style={[styles.summaryText, { fontSize: 12, color: '#A5B4FC' }]} numberOfLines={3}>
                          {evtAny.businessRelevance || evtAny.strategicInterpretation}
                        </Text>
                      </View>
                    )}

                    {/* Supporting Synthetic Evidence Links */}
                    {Array.isArray(evtAny.supportingEvidenceLinks) && evtAny.supportingEvidenceLinks.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        {evtAny.supportingEvidenceLinks.map((evLink: any, idx: number) => (
                          <Pressable
                            key={evLink.id || idx}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 6,
                              backgroundColor: 'rgba(56, 189, 248, 0.1)',
                              borderWidth: 1,
                              borderColor: 'rgba(56, 189, 248, 0.3)',
                              paddingHorizontal: 10,
                              paddingVertical: 5,
                              borderRadius: 6,
                            }}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              openEvidenceUrl(evLink.url);
                            }}
                          >
                            <Feather name="external-link" size={12} color="#38BDF8" />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#7DD3FC' }}>
                              Evidence: {evLink.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}

                    <View style={styles.cardFooterRow}>
                      <View style={[styles.metaRow, { flexWrap: 'wrap' }]}>
                        <Text style={styles.metaText}>ID: {evt.sourceArtifactId}</Text>
                        <Text style={styles.metaText}>Severity: {evt.severity}</Text>
                        <Text style={styles.metaText}>Confidence: {Math.round(evt.confidence * 100)}%</Text>
                        <Text style={styles.metaText}>Observed: {evt.observedAtFormatted || new Date(evt.observedAt).toLocaleDateString()}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {(linkedCase || evtAny.linkedScenarioId) && (
                          <Pressable
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 6,
                              backgroundColor: isApplied ? '#065F46' : isActionable ? '#D97706' : '#334155',
                              paddingHorizontal: 12,
                              paddingVertical: 7,
                              borderRadius: 6,
                            }}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              if (linkedCase) {
                                setSelectedCaseId(linkedCase.reasoningCaseId);
                                setActiveTab('deep_reasoning');
                              } else {
                                handleRunDeepReasoning(evt.sourceArtifactId);
                              }
                            }}
                          >
                            <Feather name="cpu" size={13} color="#FFFFFF" />
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                              {isApplied
                                ? 'View Applied Response'
                                : linkedCase && isActionable
                                  ? 'Review Proposed Change'
                                  : linkedCase
                                    ? 'View Reasoning Explanation'
                                    : 'Run Deep Reasoning Investigation'}
                            </Text>
                          </Pressable>
                        )}
                        <View style={styles.viewDetailAction}>
                          <Text style={styles.viewDetailActionText}>Event Dossier</Text>
                          <Feather name="arrow-right" size={14} color="#8B5CF6" />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )
        ) : activeTab === 'warnings' ? (
          /* ========================================================================= */
          /* 2B. WARNINGS (DISCRETE CURRENT PERFORMANCE INVESTIGATIONS)                */
          /* ========================================================================= */
          (() => {
            const activeWarnings = warnings.filter(w => !(w as any).isHistorical && (w as any).status !== 'HISTORICAL');
            const historicalWarnings = warnings.filter(w => (w as any).isHistorical || (w as any).status === 'HISTORICAL');

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
                                HISTORICAL INVESTIGATION
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
          /* 2C. DEEP REASONING (COMBINED INVESTIGATION & SURGICAL PATCH CENTER)       */
          /* ========================================================================= */
          <View style={styles.deepReasoningLayout}>
            {/* Deterministic Analysis Progression Banner */}
            {investigatingTarget && (
              <View style={[styles.card, { backgroundColor: '#1E1B4B', borderColor: '#8B5CF6', borderWidth: 2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <ActivityIndicator size="small" color="#A78BFA" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      Running Event-Specific Deep Reasoning Engine ({investigatingTarget})
                    </Text>
                    <Text style={{ fontSize: 14, color: '#F8FAFC', marginTop: 4, fontWeight: '600' }}>
                      {investigationProgressStep || 'Synthesizing market evidence and strategic impact…'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Approval Error Banner */}
            {approvalError && (
              <View style={[styles.card, { backgroundColor: 'rgba(127, 29, 29, 0.4)', borderColor: '#EF4444', borderWidth: 1.5 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <Feather name="alert-triangle" size={18} color="#FCA5A5" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#FCA5A5', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                        PROPOSAL APPLY BLOCKED BY VALIDATION
                      </Text>
                      <Text style={{ fontSize: 13, color: '#FEE2E2', marginTop: 2 }}>
                        {approvalError}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setApprovalError(null)} style={{ padding: 4 }}>
                    <Feather name="x" size={16} color="#FCA5A5" />
                  </Pressable>
                </View>
              </View>
            )}

            {/* Approval Confirmation Banner */}
            {lastApprovalConfirmation && (
              <View style={[styles.card, { backgroundColor: 'rgba(6, 78, 59, 0.45)', borderColor: '#10B981', borderWidth: 1.5 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <Feather name="check-circle" size={20} color="#34D399" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#6EE7B7', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                        {lastApprovalConfirmation.targetType === 'EXECUTION'
                          ? 'EXECUTION ADJUSTMENT APPROVED & PERSISTED (STRATEGY ROOT PRESERVED)'
                          : `STRATEGY PATCH APPROVED & PERSISTED${lastApprovalConfirmation.newStrategyVersion ? ` • ACTIVE ROOT v${lastApprovalConfirmation.newStrategyVersion}` : ''}`}
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#F8FAFC', marginTop: 2 }}>
                        {lastApprovalConfirmation.title}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setLastApprovalConfirmation(null)} style={{ padding: 4 }}>
                    <Feather name="x" size={16} color="#A7F3D0" />
                  </Pressable>
                </View>
                {lastApprovalConfirmation.affectedPlanItems.length > 0 && (
                  <View style={{ marginTop: 6, gap: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#A7F3D0' }}>
                      Updated Target Sections & Execution Actions:
                    </Text>
                    {lastApprovalConfirmation.affectedPlanItems.map((item, idx) => (
                      <Text key={idx} style={{ fontSize: 12, color: '#D1FAE5', lineHeight: 18 }}>
                        • {item}
                      </Text>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                  {lastApprovalConfirmation.targetType === 'STRATEGY' && (
                    <Pressable
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: '#10B981',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 6,
                      }}
                      onPress={() => router.push('/(tabs)/strategy-plan' as any)}
                    >
                      <Feather name="layers" size={14} color="#052E16" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#052E16' }}>
                        {lastApprovalConfirmation.newStrategyVersion
                          ? `Inspect Updated Strategy v${lastApprovalConfirmation.newStrategyVersion} →`
                          : 'Inspect Strategy Plan →'}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      borderWidth: 1,
                      borderColor: '#10B981',
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 6,
                    }}
                    onPress={() => router.push('/(tabs)/execution' as any)}
                  >
                    <Feather name="check-square" size={14} color="#6EE7B7" />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#6EE7B7' }}>
                      View Updated "What to do today" Tasks →
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Pending Strategic Scenarios Ready for Investigation */}
            {pendingScenarios.length > 0 && (
              <View style={[styles.card, { backgroundColor: '#131C31', borderColor: '#3B82F660' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="zap" size={18} color="#F59E0B" />
                    <Text style={styles.cardTitle}>
                      Strategic Watchtower Signals Pending Deep Reasoning ({pendingScenarios.length})
                    </Text>
                  </View>
                  <View style={[styles.pill, styles.pillPreliminary]}>
                    <Text style={[styles.pillText, { color: '#FCD34D' }]}>Awaiting User Investigation Click</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: '#94A3B8', lineHeight: 19 }}>
                  Click "Run Deep Reasoning Investigation" on any strategic signal below to inspect corroborating evidence, evaluate competing hypotheses, and preview the exact BEFORE / AFTER strategy patch before deciding whether to apply it.
                </Text>
                <View style={{ gap: 10, marginTop: 4 }}>
                  {pendingScenarios.map((sc) => (
                    <View
                      key={sc.scenarioId}
                      style={{
                        backgroundColor: '#0F172A',
                        borderRadius: 10,
                        padding: 14,
                        borderWidth: 1,
                        borderColor: '#334155',
                        gap: 8,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {sc.scenarioId} • EVENT {sc.eventId} • {sc.relevantLaneTitle}
                          </Text>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: '#F8FAFC', marginTop: 2 }}>
                            {sc.title}
                          </Text>
                        </View>
                        <Pressable
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            backgroundColor: '#8B5CF6',
                            paddingHorizontal: 14,
                            paddingVertical: 9,
                            borderRadius: 8,
                            opacity: investigatingTarget ? 0.6 : 1,
                          }}
                          disabled={!!investigatingTarget}
                          onPress={() => handleRunDeepReasoning(sc.eventId)}
                        >
                          <Feather name="cpu" size={14} color="#FFFFFF" />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                            Run Deep Reasoning Investigation
                          </Text>
                        </Pressable>
                      </View>
                      <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18 }}>
                        {sc.whatChanged}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>Audience: {sc.relevantAudience}</Text>
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>Offering: {sc.relevantOffering}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {cases.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="cpu" size={32} color="#8B5CF6" />
                <Text style={styles.emptyTitle}>No Deep Reasoning Investigations Opened Yet</Text>
                <Text style={styles.emptySubtitle}>
                  All 3 actionable strategic scenarios are ready above (and in Watchtower / Events). Click "Run Deep Reasoning Investigation" on any scenario above to run the deterministic causal analysis and preview its BEFORE / AFTER strategy patch.
                </Text>
              </View>
            ) : (() => {
              const proposedChangeCases = cases.filter(
                (c) => Boolean(c.isActionableProposal) || c.caseCategory === 'PROPOSED_CHANGE',
              );
              const explanationOnlyCases = cases.filter(
                (c) => !c.isActionableProposal && c.caseCategory !== 'PROPOSED_CHANGE',
              );

              return (
                <>
                  {/* SECTION B: PROPOSED CHANGES SELECTOR */}
                  <View style={[styles.card, { backgroundColor: '#131C31', borderColor: proposedChangeCases.length > 0 ? '#F59E0B' : '#334155' }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Feather name="sliders" size={16} color={proposedChangeCases.length > 0 ? '#F59E0B' : '#64748B'} />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#F8FAFC' }}>
                          Proposed Changes ({proposedChangeCases.length})
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                        Only concrete, justified proposals targeting an authorized strategy section or execution task
                      </Text>
                    </View>
                    {proposedChangeCases.length === 0 ? (
                      <Text style={{ fontSize: 12, color: '#94A3B8', lineHeight: 18 }}>
                        No actionable strategy or execution patches are currently proposed. All evaluated signals below are explanations, monitoring records, or execution diagnostics that do not mutate Strategy Root v{cases[0]?.strategyRootVersion || 13}.
                      </Text>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.caseSelectorScroll}>
                        {proposedChangeCases.map((c) => {
                          const decAny = c.adaptiveDecision as any;
                          const isCaseApplied =
                            c.adaptationOutcome != null || decAny?.proposalStatus === 'APPLIED';
                          const chipBadge =
                            decAny?.statusBadge ||
                            (isCaseApplied
                              ? 'APPLIED'
                              : c.targetType === 'EXECUTION'
                                ? 'PENDING EXECUTION APPROVAL'
                                : 'PENDING STRATEGY APPROVAL');
                          return (
                            <Pressable
                              key={c.reasoningCaseId}
                              style={[
                                styles.caseChip,
                                selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipActive,
                                isCaseApplied ? { borderColor: '#10B981' } : { borderColor: '#F59E0B' },
                              ]}
                              onPress={() => {
                                setApprovalError(null);
                                setSelectedCaseId(c.reasoningCaseId);
                              }}
                            >
                              <Text
                                style={[
                                  styles.caseChipText,
                                  selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipTextActive,
                                ]}
                              >
                                {(c as any).caseTitle || c.adaptiveDecision?.businessAction || c.rootBadgeLabel} ({chipBadge})
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>

                  {/* SECTION A: INVESTIGATIONS & EXPLANATIONS SELECTOR */}
                  <View style={[styles.card, { backgroundColor: '#0F172A', borderColor: '#334155' }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Feather name="book-open" size={16} color="#38BDF8" />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#F8FAFC' }}>
                          Investigations & Explanations ({explanationOnlyCases.length})
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                        NO_CHANGE, MONITORING, insufficient/contradicted evidence & diagnostic explanations (no strategy mutation)
                      </Text>
                    </View>
                    {explanationOnlyCases.length === 0 ? (
                      <Text style={{ fontSize: 12, color: '#94A3B8' }}>No explanation-only investigations recorded.</Text>
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.caseSelectorScroll}>
                        {explanationOnlyCases.map((c) => {
                          const badge =
                            c.adaptiveDecision?.statusBadge ||
                            (c.status === 'INSUFFICIENT_EVIDENCE' ? 'MONITORING' : 'NO_CHANGE');
                          return (
                            <Pressable
                              key={c.reasoningCaseId}
                              style={[
                                styles.caseChip,
                                selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipActive,
                              ]}
                              onPress={() => {
                                setApprovalError(null);
                                setSelectedCaseId(c.reasoningCaseId);
                              }}
                            >
                              <Text
                                style={[
                                  styles.caseChipText,
                                  selectedCase?.reasoningCaseId === c.reasoningCaseId && styles.caseChipTextActive,
                                ]}
                              >
                                {(c as any).caseTitle || c.adaptiveDecision?.businessAction || c.rootBadgeLabel} ({badge})
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>

                  {selectedCase && (() => {
                    const caseAny: any = selectedCase;
                    const decAny: any = {
                      ...caseAny,
                      ...(selectedCase.adaptiveDecision || {}),
                      scenarioTitle: caseAny.caseTitle,
                      affectedLane: caseAny.relevantLaneTitle,
                      proposedResponseSummary: caseAny.proposedResponse,
                    };
                    const isActionable = Boolean(selectedCase.isActionableProposal) || selectedCase.caseCategory === 'PROPOSED_CHANGE';
                    const isApplied =
                      isActionable &&
                      (selectedCase.adaptationOutcome != null || decAny.proposalStatus === 'APPLIED');
                    const statusBadgeLabel =
                      decAny.statusBadge ||
                      (selectedCase.status === 'INSUFFICIENT_EVIDENCE' ? 'MONITORING' : 'NO_CHANGE');
                    const expDetails = selectedCase.explanationDetails;
                    const propDetails = selectedCase.proposalDetails;

                    return (
                      <View style={styles.sectionGrid}>
                        {/* Executive Header Banner */}
                        <View
                          style={[
                            styles.card,
                            {
                              backgroundColor: isActionable ? '#1E1B4B' : '#0F172A',
                              borderColor: isApplied
                                ? '#10B981'
                                : isActionable
                                  ? '#F59E0B'
                                  : statusBadgeLabel === 'MONITORING'
                                    ? '#38BDF8'
                                    : '#475569',
                            },
                          ]}
                        >
                          <View style={styles.cardHeader}>
                            <View style={{ flex: 1, paddingRight: 10 }}>
                              <Text style={[styles.cardOverline, { color: isActionable ? '#FCD34D' : '#7DD3FC' }]}>
                                {isActionable
                                  ? `${selectedCase.targetType === 'EXECUTION' ? 'PROPOSED EXECUTION ADJUSTMENT' : 'PROPOSED STRATEGY CHANGE'} • ${selectedCase.rootBadgeLabel}`
                                  : `INVESTIGATION & EXPLANATION • ${selectedCase.rootBadgeLabel} • CASE ${selectedCase.reasoningCaseId}`}
                              </Text>
                              <Text style={styles.cardTitle}>
                                {decAny.scenarioTitle || selectedCase.adaptiveDecision?.businessAction || 'Causal Investigation'}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.statusPill,
                                isApplied
                                  ? { backgroundColor: 'rgba(16, 185, 129, 0.25)', borderColor: '#10B981', borderWidth: 1 }
                                  : isActionable
                                    ? { backgroundColor: 'rgba(245, 158, 11, 0.2)', borderColor: '#F59E0B', borderWidth: 1 }
                                    : { backgroundColor: 'rgba(56, 189, 248, 0.14)', borderColor: '#38BDF8', borderWidth: 1 },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusPillText,
                                  isApplied
                                    ? { color: '#6EE7B7' }
                                    : isActionable
                                      ? { color: '#FDE68A' }
                                      : { color: '#7DD3FC' },
                                ]}
                              >
                                {statusBadgeLabel}
                              </Text>
                            </View>
                          </View>

                          <Text style={[styles.summaryText, { color: '#E2E8F0' }]}>
                            {isActionable
                              ? (propDetails?.whyActionWarranted || decAny.whatChanged || selectedCase.adaptiveDecision?.rationale)
                              : (expDetails?.whatWasObserved || decAny.whatChanged || selectedCase.adaptiveDecision?.actionDescription)}
                          </Text>

                          {/* Audience, Offering & Lane Context */}
                          {(decAny.relevantAudience || decAny.relevantOffering || decAny.affectedLane) && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                              {decAny.relevantAudience && (
                                <View style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                                  <Text style={{ fontSize: 11, color: '#CBD5E1' }}>Audience: {decAny.relevantAudience}</Text>
                                </View>
                              )}
                              {decAny.relevantOffering && (
                                <View style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                                  <Text style={{ fontSize: 11, color: '#CBD5E1' }}>Offering: {decAny.relevantOffering}</Text>
                                </View>
                              )}
                              {decAny.affectedLane && (
                                <View style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}>
                                  <Text style={{ fontSize: 11, color: '#A5B4FC', fontWeight: '700' }}>Lane: {decAny.affectedLane}</Text>
                                </View>
                              )}
                            </View>
                          )}
                        </View>

                        {/* ===================================================================== */}
                        {/* CASE TYPE A: INVESTIGATION / EXPLANATION VIEW (NO ACTIONABLE PATCH)   */}
                        {/* ===================================================================== */}
                        {!isActionable && (
                          <View style={[styles.card, { borderColor: '#38BDF8', borderWidth: 1 }]}>
                            <View style={[styles.cardHeader, { justifyContent: 'space-between' }]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Feather name="info" size={18} color="#38BDF8" />
                                <Text style={styles.cardTitle}>Investigation Assessment & Explanation (No Strategy Patch)</Text>
                              </View>
                              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(56, 189, 248, 0.14)', borderWidth: 1, borderColor: '#38BDF8' }}>
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#7DD3FC', letterSpacing: 0.6 }}>
                                  {statusBadgeLabel} • STRATEGY UNCHANGED
                                </Text>
                              </View>
                            </View>

                            {/* 1. What Was Observed */}
                            <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', gap: 4 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#38BDF8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                1. What Was Observed
                              </Text>
                              <Text style={{ fontSize: 13, color: '#F8FAFC', lineHeight: 19 }}>
                                {expDetails?.whatWasObserved || decAny.whatChanged || 'Signal observed and evaluated against active campaign context.'}
                              </Text>
                            </View>

                            {/* 2. What It May Mean */}
                            <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', gap: 4 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#A5B4FC', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                2. What It May Mean
                              </Text>
                              <Text style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 19 }}>
                                {expDetails?.whatItMayMean || selectedCase.adaptiveDecision?.rationale || 'Evaluated competing causal interpretations.'}
                              </Text>
                            </View>

                            {/* 3. Evidence & Uncertainty */}
                            <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', gap: 6 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#FBBF24', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                3. Evidence & Uncertainty
                              </Text>
                              <Text style={{ fontSize: 13, color: '#FDE68A', lineHeight: 19 }}>
                                {expDetails?.evidenceAndUncertainty || `Evaluated ${selectedCase.evidenceCount} resolved evidence item(s).`}
                              </Text>
                              {expDetails?.sharedOriginGroup && (
                                <View style={{ marginTop: 4, padding: 10, borderRadius: 6, backgroundColor: 'rgba(139, 92, 246, 0.12)', borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.35)' }}>
                                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#C4B5FD' }}>
                                    Shared Snapshot Origin Linked ({expDetails.sharedOriginGroup.siblingEventIds.join(', ')})
                                  </Text>
                                  <Text style={{ fontSize: 12, color: '#E0E7FF', marginTop: 2, lineHeight: 17 }}>
                                    {expDetails.sharedOriginGroup.note}
                                  </Text>
                                </View>
                              )}
                            </View>

                            {/* 4. Why No Action Is Proposed */}
                            <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.06)', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.25)', gap: 4 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#34D399', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                4. Why No Action Is Proposed
                              </Text>
                              <Text style={{ fontSize: 13, color: '#D1FAE5', lineHeight: 19 }}>
                                {expDetails?.whyNoActionProposed || 'No concrete strategy root or execution mutation is warranted by the current evidence.'}
                              </Text>
                            </View>

                            {/* 5. What New Evidence Would Justify Reconsideration */}
                            <View style={{ backgroundColor: '#0F172A', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#1E293B', gap: 4 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                5. What New Evidence Would Justify Reconsideration
                              </Text>
                              <Text style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 19 }}>
                                {expDetails?.whatWouldJustifyReconsideration || 'Corroborated multi-window performance shifts or verified structural competitor changes.'}
                              </Text>
                            </View>
                          </View>
                        )}

                        {/* ===================================================================== */}
                        {/* CASE TYPE B: ACTIONABLE PROPOSED CHANGE VIEW                          */}
                        {/* ===================================================================== */}
                        {isActionable && selectedCase.adaptiveDecision && (
                          <View style={[styles.card, { borderColor: isApplied ? '#10B981' : '#F59E0B', borderWidth: 1.5 }]}>
                            <View style={[styles.cardHeader, { justifyContent: 'space-between' }]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Feather name="compass" size={18} color={isApplied ? '#10B981' : '#F59E0B'} />
                                <Text style={styles.cardTitle}>
                                  {selectedCase.targetType === 'EXECUTION'
                                    ? 'Proposed Execution Adjustment ("What To Do Today")'
                                    : 'Proposed Strategy Change & Exact Diff'}
                                </Text>
                              </View>
                              <View
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 4,
                                  borderRadius: 999,
                                  backgroundColor: isApplied ? 'rgba(16, 185, 129, 0.16)' : 'rgba(245, 158, 11, 0.16)',
                                  borderWidth: 1,
                                  borderColor: isApplied ? '#10B981' : '#F59E0B',
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontWeight: '700',
                                    color: isApplied ? '#34D399' : '#FBBF24',
                                    letterSpacing: 0.6,
                                  }}
                                >
                                  {statusBadgeLabel}
                                </Text>
                              </View>
                            </View>

                            {/* 1. Why Action Is Warranted & Target Resource */}
                            <View
                              style={{
                                padding: 12,
                                borderRadius: 10,
                                backgroundColor: 'rgba(139, 92, 246, 0.08)',
                                borderWidth: 1,
                                borderColor: 'rgba(139, 92, 246, 0.28)',
                                gap: 6,
                              }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#FBBF24', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                1. Why Action Is Warranted
                              </Text>
                              <Text style={{ fontSize: 13, color: '#FDE68A', lineHeight: 19 }}>
                                {propDetails?.whyActionWarranted || decAny.whyResponseWarranted || selectedCase.adaptiveDecision.rationale}
                              </Text>

                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6 }}>
                                2. Exact Target Section / Execution Task ({selectedCase.targetType || 'STRATEGY'})
                              </Text>
                              <Text style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 19 }}>
                                {propDetails?.targetLabel || (decAny.affectedAuthorities || []).join(', ') || 'Authorized Target'}
                                {propDetails?.targetIds && propDetails.targetIds.length > 0
                                  ? ` (Target IDs: ${propDetails.targetIds.join(', ')})`
                                  : ''}
                              </Text>
                            </View>

                            {/* 3. Current Value -> Proposed Value Diff */}
                            {Array.isArray(decAny.beforeAfterPatchPreview) && decAny.beforeAfterPatchPreview.length > 0 && (
                              <View style={{ gap: 10, marginTop: 4 }}>
                                <Text style={{ fontSize: 12, fontWeight: '800', color: '#38BDF8', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                  3. Current Value → Proposed Value ({decAny.beforeAfterPatchPreview.length} Concrete Diff{decAny.beforeAfterPatchPreview.length === 1 ? '' : 's'})
                                </Text>
                                {decAny.beforeAfterPatchPreview.map((patch: any, idx: number) => (
                                  <View
                                    key={idx}
                                    style={{
                                      backgroundColor: '#0F172A',
                                      borderRadius: 10,
                                      padding: 12,
                                      borderWidth: 1,
                                      borderColor: '#334155',
                                      gap: 8,
                                    }}
                                  >
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#F8FAFC' }}>
                                      {idx + 1}. {patch.sectionName || patch.section}
                                      {patch.fieldLabel ? ` — ${patch.fieldLabel}` : ''}
                                    </Text>
                                    {patch.authority && (
                                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#A5B4FC', letterSpacing: 0.5 }}>
                                        TARGET AUTHORITY: {patch.authority}
                                      </Text>
                                    )}
                                    <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', borderLeftWidth: 3, borderLeftColor: '#EF4444', padding: 8, borderRadius: 6 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#FCA5A5', textTransform: 'uppercase' }}>CURRENT VALUE (BEFORE)</Text>
                                      <Text style={{ fontSize: 12, color: '#E2E8F0', marginTop: 2, lineHeight: 18 }}>{patch.beforeText ?? patch.before}</Text>
                                    </View>
                                    <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', borderLeftWidth: 3, borderLeftColor: '#10B981', padding: 8, borderRadius: 6 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#6EE7B7', textTransform: 'uppercase' }}>PROPOSED VALUE (AFTER)</Text>
                                      <Text style={{ fontSize: 12, color: '#ECFDF5', marginTop: 2, lineHeight: 18 }}>{patch.afterText ?? patch.after}</Text>
                                    </View>
                                    {patch.rationale && (
                                      <Text style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>
                                        Rationale: {patch.rationale}
                                      </Text>
                                    )}
                                  </View>
                                ))}
                              </View>
                            )}

                            {/* 4. Expected Effect as Hypothesis & 6. What Remains Unchanged */}
                            <View
                              style={{
                                padding: 12,
                                borderRadius: 10,
                                backgroundColor: 'rgba(15, 23, 42, 0.7)',
                                borderWidth: 1,
                                borderColor: '#1E293B',
                                gap: 8,
                              }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#38BDF8', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                4. Expected Effect (Hypothesis, Not Guaranteed Outcome)
                              </Text>
                              <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18 }}>
                                {propDetails?.expectedEffectHypothesis ||
                                  'Hypothesized to improve alignment if corroborated over the 14-day post-apply observation window; not a guaranteed outcome.'}
                              </Text>

                              <View style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: '#334155', gap: 4 }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                  5. Supporting & Contradicting Evidence Counts
                                </Text>
                                <Text style={{ fontSize: 12, color: '#CBD5E1' }}>
                                  Supporting Evidence IDs: {(propDetails?.supportingEvidenceIds || selectedCase.evidenceIds || []).length} • Contradicting Evidence IDs: {(propDetails?.contradictingEvidenceIds || []).length}
                                </Text>
                              </View>

                              <View style={{ paddingTop: 6, borderTopWidth: 1, borderTopColor: '#334155', gap: 4 }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                  6. What Remains Unchanged
                                </Text>
                                <Text style={{ fontSize: 12, color: '#94A3B8', lineHeight: 18 }}>
                                  {Array.isArray(propDetails?.whatRemainsUnchanged) && propDetails!.whatRemainsUnchanged.length > 0
                                    ? propDetails!.whatRemainsUnchanged.join(' • ')
                                    : Array.isArray(decAny.unchangedExplanation) && decAny.unchangedExplanation.length > 0
                                      ? decAny.unchangedExplanation.join(' • ')
                                      : 'All non-targeted strategic authorities remain preserved.'}
                                </Text>
                              </View>
                            </View>

                            {/* 7. Target-Appropriate Approval Control */}
                            {!isApplied ? (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                                <Pressable
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 8,
                                    backgroundColor: selectedCase.targetType === 'EXECUTION' ? '#0284C7' : '#10B981',
                                    paddingHorizontal: 18,
                                    paddingVertical: 11,
                                    borderRadius: 8,
                                    opacity: approvingProposal ? 0.7 : 1,
                                  }}
                                  disabled={approvingProposal}
                                  onPress={() => handleApproveCaseProposal(decAny.proposalId)}
                                >
                                  {approvingProposal ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                  ) : (
                                    <Feather name="check-circle" size={15} color="#FFFFFF" />
                                  )}
                                  <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
                                    {approvingProposal
                                      ? 'Applying Approved Change…'
                                      : propDetails?.approvalActionLabel ||
                                        (selectedCase.targetType === 'EXECUTION'
                                          ? 'Approve Execution Adjustment (What To Do Today)'
                                          : 'Approve & Apply Strategy Patch')}
                                  </Text>
                                </Pressable>

                                <Pressable
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 6,
                                    backgroundColor: 'rgba(139, 92, 246, 0.14)',
                                    borderWidth: 1,
                                    borderColor: 'rgba(139, 92, 246, 0.45)',
                                    paddingHorizontal: 14,
                                    paddingVertical: 11,
                                    borderRadius: 8,
                                  }}
                                  onPress={() =>
                                    router.push(
                                      (selectedCase.targetType === 'EXECUTION'
                                        ? '/(tabs)/execution'
                                        : '/(tabs)/strategy-plan') as any,
                                    )
                                  }
                                >
                                  <Feather name="layers" size={14} color="#C4B5FD" />
                                  <Text style={{ color: '#C4B5FD', fontSize: 13, fontWeight: '600' }}>
                                    {selectedCase.targetType === 'EXECUTION'
                                      ? 'Inspect "What To Do Today" →'
                                      : 'Inspect Target Strategy Plan →'}
                                  </Text>
                                </Pressable>
                              </View>
                            ) : (
                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                                {selectedCase.targetType !== 'EXECUTION' && (
                                  <Pressable
                                    style={{
                                      flexDirection: 'row',
                                      alignItems: 'center',
                                      gap: 6,
                                      backgroundColor: 'rgba(16, 185, 129, 0.18)',
                                      borderWidth: 1,
                                      borderColor: '#10B981',
                                      paddingHorizontal: 14,
                                      paddingVertical: 10,
                                      borderRadius: 8,
                                    }}
                                    onPress={() => router.push('/(tabs)/strategy-plan' as any)}
                                  >
                                    <Feather name="layers" size={14} color="#34D399" />
                                    <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '700' }}>
                                      View Updated Strategy Plan →
                                    </Text>
                                  </Pressable>
                                )}
                                <Pressable
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 6,
                                    backgroundColor: 'rgba(56, 189, 248, 0.14)',
                                    borderWidth: 1,
                                    borderColor: '#38BDF8',
                                    paddingHorizontal: 14,
                                    paddingVertical: 10,
                                    borderRadius: 8,
                                  }}
                                  onPress={() => router.push('/(tabs)/execution' as any)}
                                >
                                  <Feather name="check-square" size={14} color="#7DD3FC" />
                                  <Text style={{ color: '#7DD3FC', fontSize: 13, fontWeight: '700' }}>
                                    View Updated "What to do today" →
                                  </Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Drillable Triggers: Market Events, Performance Warnings & Resolved Evidence */}
                        <View style={styles.card}>
                          <View style={styles.cardHeader}>
                            <Feather name="crosshair" size={18} color="#8B5CF6" />
                            <Text style={styles.cardTitle}>Investigated Triggers & Resolved Evidence</Text>
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
                              <Text style={styles.triggerLabel}>Resolved Evidence →</Text>
                            </Pressable>
                          </View>

                          {/* Inline Resolved Evidence Records */}
                          {Array.isArray(selectedCase.resolvedEvidenceItems) && selectedCase.resolvedEvidenceItems.length > 0 && (
                            <View style={{ gap: 8, marginTop: 6 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Resolved Evidence Records ({selectedCase.resolvedEvidenceItems.length})
                              </Text>
                              {selectedCase.resolvedEvidenceItems.map((item, idx) => (
                                <View
                                  key={item.evidenceId || idx}
                                  style={{
                                    backgroundColor: '#0F172A',
                                    padding: 10,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: '#1E293B',
                                    gap: 3,
                                  }}
                                >
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC' }}>
                                      {item.title}
                                    </Text>
                                    <Text style={{ fontSize: 10, color: '#38BDF8', fontWeight: '600' }}>
                                      {item.sourceType} • ID: {item.evidenceId}
                                    </Text>
                                  </View>
                                  <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 17 }}>
                                    {item.summary}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
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
                                  <View
                                    style={[
                                      styles.hypoStatusBadge,
                                      h.status === 'VALIDATED' || h.status === 'SUPPORTED'
                                        ? styles.hypoValidated
                                        : h.status === 'REJECTED'
                                          ? { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#EF4444', borderWidth: 1 }
                                          : styles.hypoProposed,
                                    ]}
                                  >
                                    <Text style={styles.hypoStatusText}>{h.status}</Text>
                                  </View>
                                </View>
                                <Text style={styles.hypothesisExplanation}>{h.explanation}</Text>
                                <View style={[styles.metaRow, { flexWrap: 'wrap' }]}>
                                  <Text style={styles.metaText}>Confidence: {Math.round(h.confidence * 100)}%</Text>
                                  <Text style={styles.metaText}>Supporting Evidence: {h.supportingEvidenceCount}</Text>
                                  <Text style={styles.metaText}>Contradicting Evidence: {h.contradictingEvidenceCount}</Text>
                                </View>
                              </View>
                            ))
                          )}
                        </View>

                        {/* Adaptation Outcome Monitoring */}
                        {selectedCase.adaptationOutcome && (
                          <View style={[styles.card, { borderColor: '#10B981' }]}>
                            <View style={styles.cardHeader}>
                              <Feather name="activity" size={18} color="#10B981" />
                              <Text style={styles.cardTitle}>Strategy Adaptation Lineage</Text>
                            </View>
                            <View style={styles.outcomeRow}>
                              <Text style={styles.detailLabel}>Transition:</Text>
                              <Text style={styles.detailValue}>
                                Root v{selectedCase.adaptationOutcome.previousRootVersion} → Root v{selectedCase.adaptationOutcome.newRootVersion}
                              </Text>
                            </View>
                            <View style={styles.outcomeRow}>
                              <Text style={styles.detailLabel}>Monitoring Status:</Text>
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
                    );
                  })()}
                </>
              );
            })()}
          </View>
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
                <Text style={styles.modalTitle}>{(eventDetail as any)?.customTitle || eventDetail?.businessFriendlyType || 'Event Investigation'}</Text>
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

                {/* Deep Reasoning Action CTA if linkedScenarioId */}
                {(eventDetail as any).linkedScenarioId && (
                  <View style={{
                    backgroundColor: '#1E1B4B',
                    borderRadius: 10,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: '#8B5CF6',
                    marginBottom: 16,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#C4B5FD', textTransform: 'uppercase' }}>
                        Actionable Strategic Signal ({(eventDetail as any).linkedScenarioId})
                      </Text>
                      <Text style={{ fontSize: 13, color: '#E0E7FF', marginTop: 2 }}>
                        Open the event-specific Deep Reasoning investigation to review hypotheses and the BEFORE / AFTER strategy patch.
                      </Text>
                    </View>
                    <Pressable
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        backgroundColor: '#8B5CF6',
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 8,
                      }}
                      onPress={() => handleRunDeepReasoning(eventDetail.eventId)}
                    >
                      <Feather name="cpu" size={14} color="#FFFFFF" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#FFFFFF' }}>
                        Run Deep Reasoning →
                      </Text>
                    </Pressable>
                  </View>
                )}

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

                {/* Supporting Synthetic Evidence Links */}
                {Array.isArray((eventDetail as any).evidenceUrls) && (eventDetail as any).evidenceUrls.length > 0 && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Supporting Synthetic Evidence (Opens in Evidence Inspector)</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {((eventDetail as any).evidenceUrls as string[]).map((url: string, idx: number) => ({
                        id: url,
                        url,
                        label: `Evidence ${idx + 1}: ${url.split('/').pop() || url}`,
                      })).map((evLink: any, idx: number) => (
                        <Pressable
                          key={evLink.id || idx}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            backgroundColor: 'rgba(56, 189, 248, 0.14)',
                            borderWidth: 1,
                            borderColor: '#38BDF8',
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 8,
                          }}
                          onPress={() => openEvidenceUrl(evLink.url)}
                        >
                          <Feather name="external-link" size={13} color="#38BDF8" />
                          <Text style={{ fontSize: 12, fontWeight: '700', color: '#E0F2FE' }}>
                            {evLink.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
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

                {/* 11. Supporting Evidence Sources */}
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
                Array.isArray(selectedCase?.resolvedEvidenceItems) && selectedCase!.resolvedEvidenceItems!.length > 0 ? (
                  selectedCase!.resolvedEvidenceItems!.map((evItem, i) => (
                    <View
                      key={evItem.evidenceId || i}
                      style={[styles.triggerDrillCard, { flexDirection: 'column', alignItems: 'flex-start', gap: 6 }]}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: 4 }}>
                        <Text style={styles.cardOverline}>{evItem.sourceType}</Text>
                        <Text style={{ fontSize: 11, color: '#64748B' }}>ID: {evItem.evidenceId}</Text>
                      </View>
                      <Text style={styles.triggerDrillTitle}>{evItem.title}</Text>
                      <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18 }}>{evItem.summary}</Text>
                      {evItem.observedAt && (
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>Observed: {evItem.observedAt}</Text>
                      )}
                    </View>
                  ))
                ) : selectedCase?.evidenceIds.length === 0 ? (
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
