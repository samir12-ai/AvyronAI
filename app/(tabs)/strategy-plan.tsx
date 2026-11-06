import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { getApiUrl, safeApiJson, authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import { GlobalHeader } from '@/components/GlobalHeader';
import { useAudiencePositioning } from '@/hooks/useAudiencePositioning';

import BuyerConversionJourneyView from '@/components/strategy-plan/BuyerConversionJourneyView';
import DifferentiationSectionView from '@/components/strategy-plan/DifferentiationSectionView';
import MechanismSectionView from '@/components/strategy-plan/MechanismSectionView';
import OfferSectionView from '@/components/strategy-plan/OfferSectionView';
import AwarenessSectionView from '@/components/strategy-plan/AwarenessSectionView';
import ChannelsBudgetSectionView from '@/components/strategy-plan/ChannelsBudgetSectionView';

import { LiveStrategyRunModal } from '@/components/strategy-plan/LiveStrategyRunModal';
import { StrategicProposalModal, StrategicProposalData } from '@/components/strategy-plan/StrategicProposalModal';
import { LiveTargetedUpdateModal, TargetedUpdateResult } from '@/components/strategy-plan/LiveTargetedUpdateModal';
import { StrategyActivityTimelineModal, ActivityItem } from '@/components/strategy-plan/StrategyActivityTimelineModal';
import { StrategyVersionHistoryModal, StrategyVersionItem } from '@/components/strategy-plan/StrategyVersionHistoryModal';
import { BusinessStageProgress } from '@/server/strategy-experience/service';

const C = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  teal: '#14B8A6',
};

type StrategyTab =
  | 'overview'
  | 'differentiation'
  | 'mechanism'
  | 'offer'
  | 'awareness'
  | 'journey'
  | 'channels';

const STRATEGY_TABS: Array<{ id: StrategyTab; label: string; icon: any; authorityKey?: string }> = [
  { id: 'overview', label: 'Overview', icon: 'compass' },
  { id: 'differentiation', label: 'Differentiation', icon: 'shield', authorityKey: 'DIFFERENTIATION' },
  { id: 'mechanism', label: 'Mechanism', icon: 'cpu', authorityKey: 'MECHANISM' },
  { id: 'offer', label: 'Offer', icon: 'gift', authorityKey: 'OFFER' },
  { id: 'awareness', label: 'Awareness', icon: 'eye', authorityKey: 'AWARENESS' },
  { id: 'journey', label: 'Buyer Journey', icon: 'git-merge', authorityKey: 'FUNNEL' },
  { id: 'channels', label: 'Channels & Budget', icon: 'share-2', authorityKey: 'CHANNEL_SELECTION' },
];

export default function StrategyPlanScreen() {
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign, selectedCampaignId } = useCampaign();
  const searchParams = useLocalSearchParams();
  const router = useRouter();

  const campaignId = selectedCampaign?.selectedCampaignId || selectedCampaignId || '';
  const initialTab = (searchParams.tab as StrategyTab) || 'overview';
  const [activeTab, setActiveTab] = useState<StrategyTab>(initialTab);
  const [previewPlanId, setPreviewPlanId] = useState<string | null>((searchParams.planId as string) || null);
  const [candidateDraftInfo, setCandidateDraftInfo] = useState<any>(null);
  const [designatedActiveInfo, setDesignatedActiveInfo] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planData, setPlanData] = useState<any>(null);

  // Strategy Experience State
  const [strategyMeta, setStrategyMeta] = useState<{
    hasStrategy: boolean;
    status: string;
    canonicalVersion: number | null;
    planVersion?: number | null;
    bundleVersion?: number | null;
    jobId?: string | null;
    strategyRootId?: string | null;
    rootBundleId?: string | null;
    strategicPlanId?: string | null;
    designatedActivePlanId?: string | null;
    candidateDraftPlanId?: string | null;
    selectedSnapshotIds?: Record<string, string> | null;
    positioningEpistemicStatus?: string | null;
    positioningEpistemicLabel?: string | null;
    positioningComparisonStatus?: string | null;
    primaryAxis: string | null;
    contrastAxis?: string | null;
    changedAuthorities: string[];
    preservedAuthorities: string[];
    pendingProposalCount: number;
    pendingProposals: StrategicProposalData[];
    lastUpdated: string | null;
    continuationPlan?: any | null;
  } | null>(null);

  // Modals & Live Orchestration State
  const [runModalVisible, setRunModalVisible] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [runStages, setRunStages] = useState<BusinessStageProgress[]>([]);
  const [currentStageName, setCurrentStageName] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [isRunCompleted, setIsRunCompleted] = useState(false);
  const [isRunFailed, setIsRunFailed] = useState(false);
  const [completionData, setCompletionData] = useState<any>(null);
  const [continuationPlan, setContinuationPlan] = useState<any>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const continuingRef = useRef(false);

  // Proposal Review State
  const [proposalModalVisible, setProposalModalVisible] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<StrategicProposalData | null>(null);

  // Targeted Update State
  const [targetedModalVisible, setTargetedModalVisible] = useState(false);
  const [isTargetedRunning, setIsTargetedRunning] = useState(false);
  const [targetedAuthority, setTargetedAuthority] = useState('Differentiation');
  const [targetedResult, setTargetedResult] = useState<TargetedUpdateResult | null>(null);

  // Timeline & History Modals
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<StrategyVersionItem[]>([]);

  // Fetch Audience & Positioning intelligence data for downstream section context
  const { data: intelligenceData } = useAudiencePositioning(campaignId, {
    planId: planData?.id,
    runId: planData?.jobId,
  });

  const textSecondary = isDark ? '#8892A4' : '#546478';

  // Setup completeness
  const [isSetupComplete, setIsSetupComplete] = useState<boolean>(true);

  // Fetch Strategy Plan and Active Metadata
  const fetchPlanAndMeta = useCallback(async () => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    try {
      // 0. Fetch setup status
      const setupUrl = getApiUrl(`/api/setup/status`);
      const setupRes = await authFetch(setupUrl);
      if (setupRes.ok) {
        const sData = await safeApiJson(setupRes);
        if (sData.success) {
          setIsSetupComplete(!!sData.isComplete);
        }
      }

      // 1. Fetch active strategy meta & proposals
      const metaUrl = getApiUrl(`/api/strategy/active/${encodeURIComponent(campaignId)}`);
      const metaRes = await authFetch(metaUrl);
      let latestJobFromMeta: any = null;
      if (metaRes.ok) {
        const metaData = await safeApiJson(metaRes);
        setStrategyMeta(metaData);
        if (metaData?.continuationPlan !== undefined) {
          setContinuationPlan(metaData.continuationPlan);
        }
        latestJobFromMeta = metaData?.latestJob || null;
      }

      // 2. Fetch active (or previewed candidate draft) plan details
      const planQuery = previewPlanId ? `?planId=${encodeURIComponent(previewPlanId)}` : '';
      const activeUrl = getApiUrl(`/api/plans/active/${encodeURIComponent(campaignId)}${planQuery}`);
      const activeRes = await authFetch(activeUrl);
      const activeData = await safeApiJson(activeRes);

      if (activeRes.ok && activeData.hasPlan) {
        setPlanData(activeData.plan);
        setCandidateDraftInfo(activeData.candidateDraftPlan || null);
        setDesignatedActiveInfo(activeData.designatedActivePlan || null);
        setError(null);
      } else {
        setPlanData(null);
      }

      // 2b. Restore the live run modal after a refresh (running, or stopped with no plan yet)
      if (latestJobFromMeta?.id) {
        const jobStatus = latestJobFromMeta.status;
        const hasPlanNow = Boolean(activeRes.ok && activeData.hasPlan);
        if (jobStatus === 'RUNNING') {
          setActiveJobId(latestJobFromMeta.id);
          setIsRunCompleted(false);
          setIsRunFailed(false);
          setRunModalVisible(true);
        } else if (!hasPlanNow && (jobStatus === 'BLOCKED' || jobStatus === 'FAILED')) {
          setActiveJobId(latestJobFromMeta.id);
          setRunModalVisible(true);
        }
      }

      // 3. Check if a demo generation run is currently active
      try {
        const demoRes = await authFetch(getApiUrl('/api/demo/status'));
        if (demoRes.ok) {
          const demoData = await safeApiJson(demoRes);
          if (demoData?.demoMode && demoData?.latestJob?.status === 'RUNNING' && demoData?.latestJob?.id) {
            setActiveJobId(demoData.latestJob.id);
            setIsRunCompleted(false);
            setIsRunFailed(false);
            setRunModalVisible(true);
          }
        }
      } catch {
        // Ignore non-demo or transient check errors
      }
    } catch (err: any) {
      console.error('[StrategyPlan] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, previewPlanId]);

  useEffect(() => {
    if (typeof searchParams.planId === 'string' && searchParams.planId.trim()) {
      setPreviewPlanId(searchParams.planId.trim());
    }
  }, [searchParams.planId]);

  useEffect(() => {
    setLoading(true);
    fetchPlanAndMeta();
  }, [fetchPlanAndMeta]);

  // Listen to Demo Control Panel scenario switches
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handleDemoStateChanged = (evt: any) => {
      const detail = evt?.detail;
      if (detail?.state === 'GENERATION' && detail?.jobId) {
        setActiveJobId(detail.jobId);
        setIsRunCompleted(false);
        setIsRunFailed(false);
        setProgressPercent(0);
        setCompletedCount(0);
        setRunModalVisible(true);
      }
      fetchPlanAndMeta();
    };
    window.addEventListener('avyron-demo-state-changed', handleDemoStateChanged);
    return () => window.removeEventListener('avyron-demo-state-changed', handleDemoStateChanged);
  }, [fetchPlanAndMeta]);

  const [approvingPlan, setApprovingPlan] = useState(false);

  const handleApproveDraftPlan = async () => {
    if (approvingPlan) return;
    setApprovingPlan(true);
    try {
      const demoApproveUrl = getApiUrl('/api/demo/approve-plan');
      let res = await authFetch(demoApproveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok && planData?.id) {
        const planApproveUrl = getApiUrl(`/api/plans/${encodeURIComponent(planData.id)}/approve`);
        res = await authFetch(planApproveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      }

      await fetchPlanAndMeta();
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail: { approvedPlan: true } }));
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to approve strategy plan.');
    } finally {
      setApprovingPlan(false);
    }
  };

  // Polling loop for active orchestration run
  useEffect(() => {
    if (!activeJobId || !runModalVisible) return;

    let intervalId: any = null;
    const pollStatus = async () => {
      try {
        const url = getApiUrl(`/api/strategy/runs/${encodeURIComponent(activeJobId)}`);
        const res = await authFetch(url);
        if (!res.ok) return;

        const data = await safeApiJson(res);
        setRunStages(data.stages || []);
        setCurrentStageName(data.currentStage);
        setProgressPercent(data.progressPercent || 0);
        setCompletedCount(data.completedCount || 0);
        if (data.continuationPlan !== undefined) {
          setContinuationPlan(data.continuationPlan);
        }

        if (data.status === 'COMPLETED') {
          setIsRunCompleted(true);
          setIsRunFailed(false);
          setContinuationPlan(null);
          await fetchPlanAndMeta();
          setCompletionData({
            version: strategyMeta?.canonicalVersion ? strategyMeta.canonicalVersion : 1,
            generatedAt: new Date().toLocaleTimeString(),
            primaryDirection:
              planData?.sections?.brandSpine?.contrastAxis ||
              'Verified Strategic Direction',
            primaryChannel:
              planData?.sections?.contentDistribution?.channels?.[0]?.channel ||
              'Multi-Channel Distribution',
            lanesCount: planData?.sections?.approvedLanes?.length || 1,
          });
          clearInterval(intervalId);
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail: { runCompleted: true } }));
          }
        } else if (data.status === 'FAILED' || data.status === 'BLOCKED') {
          setIsRunFailed(true);
          setIsRunCompleted(false);
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error('[StrategyPlan] Polling error:', err);
      }
    };

    pollStatus();
    intervalId = setInterval(pollStatus, 800);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeJobId, runModalVisible, fetchPlanAndMeta, strategyMeta?.canonicalVersion, planData]);

  // Trigger Continue Pipeline (validated continuation from first unfinished stage)
  const handleContinuePipeline = async (fromStage?: string) => {
    if (!campaignId || continuingRef.current) return;
    continuingRef.current = true;
    setIsContinuing(true);

    try {
      const url = getApiUrl(`/api/strategy/continue/${encodeURIComponent(campaignId)}`);
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(fromStage ? { fromStage } : {}),
        }),
      });

      const data = await safeApiJson(res);
      if (data?.continuationPlan) {
        setContinuationPlan(data.continuationPlan);
      }

      if (res.status === 409 && data?.status === 'CANNOT_CONTINUE') {
        Alert.alert(
          'Cannot Continue Pipeline',
          data.explanation || data.message || 'Please start a fresh strategy run.'
        );
        return;
      }

      if (data?.jobId) {
        setActiveJobId(data.jobId);
        setIsRunCompleted(false);
        setIsRunFailed(false);
        setRunModalVisible(true);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(
            new CustomEvent('avyron-demo-state-changed', {
              detail: { state: 'GENERATION', jobId: data.jobId },
            })
          );
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to continue strategy pipeline.');
    } finally {
      continuingRef.current = false;
      setIsContinuing(false);
    }
  };

  // Trigger Generate Strategy
  const handleGenerateStrategy = async (rawOptions?: {
    forceRefresh?: boolean;
    recoveryMode?: 'REUSE_EVIDENCE_RECOMPUTE_ANALYSIS' | 'FULL_REFRESH';
    fromStage?: string;
  } | any) => {
    if (!campaignId || continuingRef.current) return;

    const options =
      rawOptions && typeof rawOptions === 'object' && !('nativeEvent' in rawOptions)
        ? rawOptions
        : undefined;
    const recoveryMode =
      options?.recoveryMode ||
      (options?.forceRefresh === false ? 'REUSE_EVIDENCE_RECOMPUTE_ANALYSIS' : 'FULL_REFRESH');
    const forceRefresh = recoveryMode === 'FULL_REFRESH' && options?.forceRefresh !== false;

    if (!forceRefresh && recoveryMode === 'REUSE_EVIDENCE_RECOMPUTE_ANALYSIS') {
      return handleContinuePipeline(options?.fromStage);
    }

    continuingRef.current = true;
    setIsContinuing(true);
    try {
      const url = getApiUrl(`/api/strategy/generate/${encodeURIComponent(campaignId)}`);
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRefresh,
          recoveryMode,
          ...(options?.fromStage ? { fromStage: options.fromStage } : {}),
        }),
      });

      const data = await safeApiJson(res);

      if (res.status === 409 || data.status === 'ALREADY_RUNNING') {
        if (data.jobId) {
          setActiveJobId(data.jobId);
          setIsRunCompleted(false);
          setIsRunFailed(false);
          setRunModalVisible(true);
        }
        return;
      }

      if (data.jobId) {
        setActiveJobId(data.jobId);
        setIsRunCompleted(false);
        setIsRunFailed(false);
        setProgressPercent(0);
        setCompletedCount(0);
        setRunModalVisible(true);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail: { state: 'GENERATION', jobId: data.jobId } }));
        }
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to start strategy generation.');
    } finally {
      continuingRef.current = false;
      setIsContinuing(false);
    }
  };

  // Open Proposal Review
  const handleOpenProposal = (proposal: StrategicProposalData) => {
    setSelectedProposal(proposal);
    setProposalModalVisible(true);
  };

  // Approve Proposal
  const handleApproveProposal = async (proposalId: string) => {
    setProposalModalVisible(false);
    setTargetedAuthority(selectedProposal?.affectedAuthorities?.[0] || 'Differentiation');
    setIsTargetedRunning(true);
    setTargetedResult(null);
    setTargetedModalVisible(true);

    try {
      const url = getApiUrl(`/api/strategy/change-proposals/${encodeURIComponent(proposalId)}/approve`);
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await safeApiJson(res);

      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve proposal.');
      }

      setTargetedResult({
        executionStatus: data.executionStatus,
        changedAuthorities: data.changedAuthorities || [targetedAuthority],
        preservedAuthorities: data.preservedAuthorities || ['Positioning', 'Audience', 'Funnel', 'Channels'],
        newRoot: data.newRoot,
        summary: data.summary || `Targeted recompute successfully completed for ${targetedAuthority}.`,
      });

      fetchPlanAndMeta();
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail: { approvedProposalId: proposalId } }));
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to apply strategic update.');
      setTargetedModalVisible(false);
    } finally {
      setIsTargetedRunning(false);
    }
  };

  // Reject Proposal
  const handleRejectProposal = async (proposalId: string) => {
    try {
      const url = getApiUrl(`/api/strategy/change-proposals/${encodeURIComponent(proposalId)}/reject`);
      await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Customer selected: Keep Current Strategy' }),
      });

      fetchPlanAndMeta();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reject proposal.');
    }
  };

  // Open Activity Timeline
  const handleOpenTimeline = async () => {
    try {
      const url = getApiUrl(`/api/strategy/activity/${encodeURIComponent(campaignId)}`);
      const res = await authFetch(url);
      if (res.ok) {
        const data = await safeApiJson(res);
        setActivities(data.activities || []);
      }
      setTimelineVisible(true);
    } catch (err: any) {
      console.error('[StrategyPlan] Activity fetch error:', err);
      setTimelineVisible(true);
    }
  };

  // Open Version History
  const handleOpenHistory = async () => {
    try {
      const url = getApiUrl(`/api/strategy/history/${encodeURIComponent(campaignId)}`);
      const res = await authFetch(url);
      if (res.ok) {
        const data = await safeApiJson(res);
        setHistoryItems(data.history || []);
      }
      setHistoryVisible(true);
    } catch (err: any) {
      console.error('[StrategyPlan] History fetch error:', err);
      setHistoryVisible(true);
    }
  };

  // Sync tab from URL if present
  useEffect(() => {
    if (searchParams.tab && typeof searchParams.tab === 'string') {
      const valid = STRATEGY_TABS.find((t) => t.id === searchParams.tab);
      if (valid) {
        setActiveTab(valid.id);
      }
    }
  }, [searchParams.tab]);

  const handleTabChange = async (tabId: StrategyTab) => {
    setActiveTab(tabId);

    const tabConfig = STRATEGY_TABS.find((t) => t.id === tabId);
    if (
      tabConfig?.authorityKey &&
      strategyMeta?.changedAuthorities?.includes(tabConfig.authorityKey) &&
      campaignId &&
      strategyMeta?.strategyRootId
    ) {
      const authKey = tabConfig.authorityKey;
      const updatedAuthorities = (strategyMeta.changedAuthorities || []).filter(
        (a) => a !== authKey
      );
      setStrategyMeta({
        ...strategyMeta,
        changedAuthorities: updatedAuthorities,
      });

      try {
        const url = getApiUrl(`/api/strategy/acknowledge-change/${encodeURIComponent(campaignId)}`);
        await authFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authority: authKey,
            strategyRootId: strategyMeta.strategyRootId,
            rootBundleVersion: strategyMeta.canonicalVersion,
          }),
        });
      } catch (err) {
        console.warn('[StrategyPlan] Failed to persist acknowledgement:', err);
      }
    }
  };

  const changedAuthorities = strategyMeta?.changedAuthorities || [];

  if (loading) {
    return (
      <View style={[st.container, { backgroundColor: colors.background }]}>
        <GlobalHeader title="Strategy Plan" />
        <View style={st.stateContainer}>
          <ActivityIndicator size="large" color={C.mint} />
          <Text style={[st.stateText, { color: textSecondary }]}>Loading active strategy plan...</Text>
        </View>
      </View>
    );
  }

  const sections = planData?.sections || {};
  const businessRep = sections.businessRepresentation;
  const stratSummary = sections.strategicSummary;

  const resolvedPlanRev =
    planData?.activePlanVersion ?? planData?.version ?? strategyMeta?.activePlanVersion ?? strategyMeta?.planVersion ?? 1;
  const resolvedBundleVer =
    planData?.rootBundleVersion ?? strategyMeta?.rootBundleVersion ?? strategyMeta?.bundleVersion ?? strategyMeta?.canonicalVersion ?? 1;
  const resolvedTotalRevisions =
    planData?.totalPlanRevisions ?? strategyMeta?.totalPlanRevisions ?? null;
  const resolvedRunId =
    planData?.jobId ?? sections?._provenance?.jobId ?? strategyMeta?.jobId ?? strategyMeta?.latestJob?.id ?? null;
  const resolvedStrategyRootId =
    planData?.strategyRootId ??
    strategyMeta?.strategyRootId ??
    sections?.governance?.strategyRoot?.rootId ??
    sections?._provenance?.strategyRootId ??
    null;

  const resolvedPlanLifecycle =
    planData?.status === 'APPROVED' &&
    (planData?.isDesignatedActive || planData?.executionStatus === 'ACTIVE' || strategyMeta?.status === 'LIVE')
      ? 'Approved · Active'
      : planData?.status === 'APPROVED'
      ? 'Approved'
      : planData?.status === 'SUPERSEDED'
      ? 'Superseded'
      : 'Draft';

  const resolvedEpistemicStatus =
    businessRep?.strategicSummary?.epistemicStatus ||
    stratSummary?.epistemicStatus ||
    sections?.positioning?.epistemicStatus ||
    strategyMeta?.positioningEpistemicStatus ||
    intelligenceData?.positioning?.epistemicStatus ||
    'STRATEGIC_HYPOTHESIS';

  const resolvedEpistemicLabel =
    businessRep?.strategicSummary?.epistemicLabel ||
    stratSummary?.epistemicLabel ||
    sections?.positioning?.epistemicLabel ||
    strategyMeta?.positioningEpistemicLabel ||
    intelligenceData?.positioning?.epistemicLabel ||
    'Proposed Strategic Hypothesis — Requires Market Validation';

  const resolvedComparisonStatus =
    businessRep?.strategicSummary?.comparisonStatus ||
    stratSummary?.comparisonStatus ||
    sections?.positioning?.comparisonStatus ||
    strategyMeta?.positioningComparisonStatus ||
    intelligenceData?.positioning?.semanticCollision?.comparisonStatus ||
    'COMPETITIVE_COMPARISON_UNAVAILABLE';

  const isHypothesis =
    String(resolvedEpistemicStatus).toUpperCase().includes('HYPOTHESIS') ||
    String(resolvedEpistemicStatus).toUpperCase().includes('PROPOSED');
  const isComparisonUnavailable =
    String(resolvedComparisonStatus).toUpperCase().includes('UNAVAILABLE') ||
    String(resolvedComparisonStatus).toUpperCase().includes('NO_COMPETITOR');
  const hasProductFacts = (sections?.consistencyValidation?.inputCoverage?.verifiedFactCount ?? 1) > 0;
  const hasCompetitorSignals =
    (Array.isArray(sections?.approvedLanes) &&
      sections.approvedLanes.some((l: any) => JSON.stringify(l).includes('COMPETITOR_SPECIFIC'))) ||
    Boolean(intelligenceData?.coreBuyingPain?.evidenceCount);

  const canonicalPositioningTerritory =
    sections?.positioning?.territory ||
    sections?.brandSpine?.umbrellaPositionName ||
    strategyMeta?.primaryAxis ||
    intelligenceData?.positioning?.umbrellaPosition ||
    '';
  const canonicalContrastAxis =
    sections?.positioning?.contrastAxis ||
    sections?.brandSpine?.contrastAxis ||
    strategyMeta?.contrastAxis ||
    intelligenceData?.positioning?.contrastAxis ||
    '';
  const canonicalStatement =
    sections?.positioning?.narrativeDirection || stratSummary?.strategy || '';
  const isDistinctRationale = (candidate: string | undefined | null): boolean => {
    if (!candidate || typeof candidate !== 'string') return false;
    const trimmed = candidate.trim();
    if (!trimmed) return false;
    if (trimmed === canonicalStatement.trim()) return false;
    if (trimmed === canonicalContrastAxis.trim()) return false;
    if (/^from\s+.+(?:->|→)\s*to\s+/i.test(trimmed)) return false;
    return true;
  };
  const canonicalDoctrineRationale =
    (isDistinctRationale(sections?.positioning?.rationale)
      ? sections.positioning.rationale
      : null) ||
    (isDistinctRationale(intelligenceData?.positioning?.rationale)
      ? intelligenceData.positioning.rationale
      : null) ||
    (isDistinctRationale(stratSummary?.rationale) ? stratSummary.rationale : '') ||
    '';

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <GlobalHeader title="Strategy Plan" />

      {/* ── PERSISTENT LIVE STRATEGY STATUS HEADER ── */}
      <View style={st.strategyStatusHeader}>
        <View style={st.statusLeft}>
          {planData && strategyMeta?.status === 'LIVE' ? (
            <>
              <View style={st.statusLivePill}>
                <View style={st.statusLiveDot} />
                <Text style={st.statusLiveText}>{resolvedPlanLifecycle.toUpperCase()}</Text>
              </View>
              <View style={st.versionBadge}>
                <Text style={st.versionBadgeText}>
                  Plan v{resolvedPlanRev} · Bundle v{resolvedBundleVer}
                  {resolvedTotalRevisions ? ` (${resolvedTotalRevisions} revisions)` : ''}
                </Text>
              </View>
              <Text style={st.monitoringText}>
                Monitoring market & business performance
              </Text>
            </>
          ) : planData && strategyMeta?.status === 'REVIEW_REQUIRED' ? (
            <>
              <View style={[st.statusLivePill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B50' }]}>
                <View style={[st.statusLiveDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={[st.statusLiveText, { color: '#F59E0B' }]}>REVIEW REQUIRED</Text>
              </View>
              <View style={st.versionBadge}>
                <Text style={st.versionBadgeText}>
                  Plan v{resolvedPlanRev} · Bundle v{resolvedBundleVer}
                  {resolvedTotalRevisions ? ` (${resolvedTotalRevisions} revisions)` : ''}
                </Text>
              </View>
              <Text style={[st.monitoringText, { color: '#F59E0B' }]}>
                Strategy modified by upstream signals — review required
              </Text>
            </>
          ) : planData && strategyMeta?.status === 'DRAFT' ? (
            <>
              <View style={[st.statusLivePill, { backgroundColor: '#8B5CF618', borderColor: '#8B5CF650' }]}>
                <View style={[st.statusLiveDot, { backgroundColor: '#8B5CF6' }]} />
                <Text style={[st.statusLiveText, { color: '#8B5CF6' }]}>DRAFT</Text>
              </View>
              <View style={st.versionBadge}>
                <Text style={st.versionBadgeText}>
                  Plan v{resolvedPlanRev} · Bundle v{resolvedBundleVer}
                  {resolvedTotalRevisions ? ` (${resolvedTotalRevisions} revisions)` : ''}
                </Text>
              </View>
              <Text style={[st.monitoringText, { color: '#A78BFA' }]}>
                Candidate strategy generated — awaiting approval
              </Text>
            </>
          ) : planData && (strategyMeta?.status === 'HISTORICAL_ONLY' || strategyMeta?.hasStrategy) ? (
            <>
              <View style={[st.statusLivePill, { backgroundColor: '#3B82F618', borderColor: '#3B82F650' }]}>
                <View style={[st.statusLiveDot, { backgroundColor: '#3B82F6' }]} />
                <Text style={[st.statusLiveText, { color: '#3B82F6' }]}>HISTORICAL ONLY</Text>
              </View>
              <View style={st.versionBadge}>
                <Text style={st.versionBadgeText}>
                  Plan v{resolvedPlanRev} · Bundle v{resolvedBundleVer}
                  {resolvedTotalRevisions ? ` (${resolvedTotalRevisions} revisions)` : ''}
                </Text>
              </View>
              <Text style={st.monitoringText}>
                Historical baseline — not currently active for execution
              </Text>
            </>
          ) : continuationPlan?.canContinue ? (
            <>
              <View style={[st.statusLivePill, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B50' }]}>
                <View style={[st.statusLiveDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={[st.statusLiveText, { color: '#F59E0B' }]}>PIPELINE PAUSED</Text>
              </View>
              <Text style={[st.monitoringText, { color: '#FCD34D' }]}>
                {continuationPlan.explanation ||
                  `Continue from ${continuationPlan.resumeFromStageLabel || 'next stage'}. ${continuationPlan.reusedStages?.length || 0} completed stages will be reused.`}
              </Text>
            </>
          ) : (
            <>
              <View style={[st.statusLivePill, { backgroundColor: '#1E293B', borderColor: '#475569' }]}>
                <View style={[st.statusLiveDot, { backgroundColor: '#94A3B8' }]} />
                <Text style={[st.statusLiveText, { color: '#94A3B8' }]}>NO ACTIVE PLAN</Text>
              </View>
              <Text style={st.monitoringText}>
                Ready to generate algorithmic strategy
              </Text>
            </>
          )}
        </View>

        <View style={st.statusRight}>
          {planData && (
            <>
              <Pressable style={st.historyBtn} onPress={handleOpenTimeline}>
                <Feather name="clock" size={13} color="#94A3B8" />
                <Text style={st.historyBtnText}>Activity</Text>
              </Pressable>

              <Pressable style={st.historyBtn} onPress={handleOpenHistory}>
                <Feather name="layers" size={13} color="#94A3B8" />
                <Text style={st.historyBtnText}>History</Text>
              </Pressable>
            </>
          )}

          {planData && strategyMeta?.status === 'DRAFT' && (
            <Pressable
              style={[st.generateBtn, { backgroundColor: '#10B981' }]}
              onPress={handleApproveDraftPlan}
              disabled={approvingPlan}
            >
              <Feather name="check-circle" size={13} color="#FFFFFF" />
              <Text style={st.generateBtnText}>
                {approvingPlan ? 'Approving...' : 'Approve & Activate Plan'}
              </Text>
            </Pressable>
          )}

          {continuationPlan?.canContinue && (
            <Pressable
              style={[
                st.generateBtn,
                { backgroundColor: '#10B981' },
                isContinuing && { opacity: 0.6 },
              ]}
              onPress={() => handleContinuePipeline(continuationPlan?.missingPrerequisite?.engineId || continuationPlan?.resumeFromStage || undefined)}
              disabled={isContinuing}
            >
              <Feather name="play" size={13} color="#FFFFFF" />
              <Text style={st.generateBtnText}>
                {isContinuing ? 'Continuing...' : 'Continue Pipeline'}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={[
              st.generateBtn,
              continuationPlan?.canContinue && {
                backgroundColor: '#1E293B',
                borderWidth: 1,
                borderColor: '#475569',
              },
            ]}
            onPress={() =>
              handleGenerateStrategy({
                forceRefresh: true,
                recoveryMode: 'FULL_REFRESH',
              })
            }
            disabled={isContinuing}
          >
            <Feather name="refresh-cw" size={13} color="#FFFFFF" />
            <Text style={st.generateBtnText}>
              {planData
                ? 'Regenerate Strategy'
                : continuationPlan?.canContinue
                ? 'Start Fresh'
                : 'Generate Strategy'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── INTERRUPTED PIPELINE CONTINUATION BANNER ── */}
      {continuationPlan?.canContinue && (
        <View
          style={[
            st.proposalBanner,
            {
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              borderColor: 'rgba(16, 185, 129, 0.45)',
            },
          ]}
        >
          <View style={st.proposalBannerLeft}>
            <View
              style={[
                st.proposalIconBox,
                { backgroundColor: 'rgba(16, 185, 129, 0.25)' },
              ]}
            >
              <Feather name="fast-forward" size={16} color="#34D399" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.proposalBannerTitle, { color: '#6EE7B7' }]}>
                INTERRUPTED PIPELINE READY TO CONTINUE · {continuationPlan.reusedStages?.length || 0} COMPLETED STAGES PRESERVED
              </Text>
              <Text style={[st.proposalBannerSub, { color: '#D1FAE5' }]}>
                {continuationPlan.explanation}
                {continuationPlan.interruptionDiagnostics?.isProviderInterruption
                  ? ` (${continuationPlan.interruptionDiagnostics.category}: ${continuationPlan.interruptionDiagnostics.userMessage})`
                  : ''}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={[
                st.reviewBtn,
                {
                  backgroundColor: '#1E293B',
                  borderColor: '#475569',
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                },
              ]}
              onPress={() => setRunModalVisible(true)}
            >
              <Feather name="list" size={12} color="#CBD5E1" />
              <Text style={[st.reviewBtnText, { color: '#CBD5E1' }]}>Inspect Stages</Text>
            </Pressable>
            <Pressable
              style={[
                st.reviewBtn,
                {
                  backgroundColor: '#10B981',
                  borderColor: '#059669',
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                },
                isContinuing && { opacity: 0.6 },
              ]}
              onPress={() =>
                handleContinuePipeline(
                  continuationPlan?.missingPrerequisite?.engineId ||
                    continuationPlan?.resumeFromStage ||
                    undefined
                )
              }
              disabled={isContinuing}
            >
              <Feather name="play" size={13} color="#FFFFFF" />
              <Text style={[st.reviewBtnText, { color: '#FFFFFF', fontWeight: '800' }]}>
                {isContinuing ? 'Continuing...' : 'Continue Pipeline'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── CANDIDATE DRAFT PREVIEW SWITCHER BANNER ── */}
      {designatedActiveInfo && candidateDraftInfo && designatedActiveInfo.id !== candidateDraftInfo.id && (
        <View
          style={[
            st.proposalBanner,
            {
              backgroundColor: planData?.id === candidateDraftInfo.id ? 'rgba(245, 158, 11, 0.14)' : 'rgba(56, 189, 248, 0.10)',
              borderColor: planData?.id === candidateDraftInfo.id ? 'rgba(245, 158, 11, 0.5)' : 'rgba(56, 189, 248, 0.4)',
            },
          ]}
        >
          <View style={st.proposalBannerLeft}>
            <View
              style={[
                st.proposalIconBox,
                { backgroundColor: planData?.id === candidateDraftInfo.id ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.22)' },
              ]}
            >
              <Feather name="eye" size={16} color={planData?.id === candidateDraftInfo.id ? '#FBBF24' : '#38BDF8'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.proposalBannerTitle, { color: planData?.id === candidateDraftInfo.id ? '#FDE68A' : '#BAE6FD' }]}>
                {planData?.id === candidateDraftInfo.id
                  ? `PREVIEWING UNAPPROVED CANDIDATE DRAFT (Plan v${candidateDraftInfo.version || 3} · Bundle v${candidateDraftInfo.rootBundleVersion || 14} · DRAFT / IDLE)`
                  : `DESIGNATED ACTIVE PLAN v${designatedActiveInfo.version || 4} (Bundle v${designatedActiveInfo.rootBundleVersion || 13} · APPROVED) — CANDIDATE DRAFT v${candidateDraftInfo.version || 3} AVAILABLE`}
              </Text>
              <Text style={[st.proposalBannerSub, { color: '#CBD5E1' }]} numberOfLines={2}>
                {planData?.id === candidateDraftInfo.id
                  ? `Read-only preview of Candidate Draft ${candidateDraftInfo.id}. Live execution remains strictly pinned to Approved Plan ${designatedActiveInfo.id} (v${designatedActiveInfo.version || 4}).`
                  : `Inspect the unapproved Candidate Draft (${candidateDraftInfo.id}) budget & channel refinements without approving or activating it.`}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={[
                st.reviewBtn,
                {
                  backgroundColor: planData?.id === designatedActiveInfo.id ? '#10B981' : 'rgba(15, 23, 42, 0.8)',
                  borderColor: planData?.id === designatedActiveInfo.id ? '#059669' : '#334155',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                },
              ]}
              onPress={() => setPreviewPlanId(null)}
            >
              <Text style={[st.reviewBtnText, { color: '#FFFFFF', fontWeight: '700' }]}>
                Active Plan v{designatedActiveInfo.version || 4}
              </Text>
            </Pressable>
            <Pressable
              style={[
                st.reviewBtn,
                {
                  backgroundColor: planData?.id === candidateDraftInfo.id ? '#D97706' : 'rgba(15, 23, 42, 0.8)',
                  borderColor: planData?.id === candidateDraftInfo.id ? '#F59E0B' : '#334155',
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                },
              ]}
              onPress={() => setPreviewPlanId(candidateDraftInfo.id)}
            >
              <Text style={[st.reviewBtnText, { color: '#FFFFFF', fontWeight: '700' }]}>
                Preview Draft v{candidateDraftInfo.version || 3}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── DRAFT STRATEGY APPROVAL BANNER ── */}
      {planData && strategyMeta?.status === 'DRAFT' && (
        <View
          style={[
            st.proposalBanner,
            {
              backgroundColor: 'rgba(139, 92, 246, 0.12)',
              borderColor: 'rgba(139, 92, 246, 0.45)',
            },
          ]}
        >
          <View style={st.proposalBannerLeft}>
            <View
              style={[
                st.proposalIconBox,
                { backgroundColor: 'rgba(139, 92, 246, 0.25)' },
              ]}
            >
              <Feather name="check-square" size={16} color="#C4B5FD" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.proposalBannerTitle, { color: '#DDD6FE' }]}>
                CANDIDATE STRATEGY v{strategyMeta?.canonicalVersion || planData?.version || 1} READY FOR APPROVAL
              </Text>
              <Text style={[st.proposalBannerSub, { color: '#C4B5FD' }]} numberOfLines={1}>
                Review the 7 strategic authorities below, then approve to lock Strategy v{strategyMeta?.canonicalVersion || 1} for execution & Watchtower monitoring.
              </Text>
            </View>
          </View>
          <Pressable
            style={[
              st.reviewBtn,
              {
                backgroundColor: '#10B981',
                borderColor: '#059669',
                paddingHorizontal: 14,
                paddingVertical: 8,
              },
            ]}
            onPress={handleApproveDraftPlan}
            disabled={approvingPlan}
          >
            <Feather name="check-circle" size={13} color="#FFFFFF" />
            <Text style={[st.reviewBtnText, { color: '#FFFFFF', fontWeight: '800' }]}>
              {approvingPlan ? 'Approving...' : 'Approve & Lock Strategy v1'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── PENDING STRATEGIC UPDATE BANNER ── */}
      {strategyMeta && strategyMeta.pendingProposalCount > 0 && strategyMeta.pendingProposals[0] && (
        <Pressable
          style={st.proposalBanner}
          onPress={() => handleOpenProposal(strategyMeta.pendingProposals[0])}
        >
          <View style={st.proposalBannerLeft}>
            <View style={st.proposalIconBox}>
              <Feather name="alert-circle" size={16} color="#FBBF24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.proposalBannerTitle}>
                {strategyMeta.pendingProposalCount} STRATEGIC UPDATE WAITING FOR REVIEW
              </Text>
              <Text style={st.proposalBannerSub} numberOfLines={1}>
                {strategyMeta.pendingProposals[0].summary}
              </Text>
            </View>
          </View>
          <View style={st.reviewBtn}>
            <Text style={st.reviewBtnText}>Review Change</Text>
            <Feather name="arrow-right" size={13} color="#FCD34D" />
          </View>
        </Pressable>
      )}

      {/* ── UNIFIED STRATEGIC TAB NAVIGATION ── */}
      <View style={st.tabBarWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={st.tabScroll}
          contentContainerStyle={st.tabScrollContent}
        >
          {STRATEGY_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const isUpdated = tab.authorityKey && changedAuthorities.includes(tab.authorityKey);

            return (
              <Pressable
                key={tab.id}
                style={[st.tabBtn, isActive && st.tabBtnActive]}
                onPress={() => handleTabChange(tab.id)}
              >
                <Feather
                  name={tab.icon}
                  size={13}
                  color={isActive ? '#FFFFFF' : '#9CA3AF'}
                  style={{ marginRight: 6 }}
                />
                <Text style={[st.tabText, isActive && st.tabTextActive]}>
                  {tab.label}
                </Text>
                {isUpdated && (
                  <View style={st.updatedTabBadge}>
                    <Text style={st.updatedTabBadgeText}>UPDATED</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── TAB CONTENT CONTAINER ── */}
      <View style={st.tabContentArea}>
        {!planData ? (
          <View style={st.emptyPlanContainer}>
            <Feather
              name={continuationPlan?.canContinue ? 'fast-forward' : 'map'}
              size={48}
              color={continuationPlan?.canContinue ? '#10B981' : '#64748B'}
            />
            <Text style={st.emptyPlanTitle}>
              {continuationPlan?.canContinue
                ? 'Interrupted Strategy Pipeline Ready to Continue'
                : 'No Active Strategy Plan'}
            </Text>
            <Text style={st.emptyPlanSub}>
              {continuationPlan?.canContinue
                ? `${continuationPlan.explanation}${
                    continuationPlan.interruptionDiagnostics?.userMessage
                      ? ` ${continuationPlan.interruptionDiagnostics.userMessage}`
                      : ''
                  }`
                : 'Complete your campaign setup to generate a comprehensive, algorithmic strategy tailored strictly to your business facts.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
              {!isSetupComplete && (
                <Pressable 
                  style={[st.primaryGenerateBtn, { backgroundColor: '#7C3AED' }]} 
                  onPress={() => router.push('/setup')}
                >
                  <Feather name="arrow-right-circle" size={16} color="#FFFFFF" />
                  <Text style={st.primaryGenerateText}>GO TO SETUP PAGE</Text>
                </Pressable>
              )}
              {continuationPlan?.canContinue ? (
                <>
                  <Pressable
                    style={[
                      st.primaryGenerateBtn,
                      { backgroundColor: '#10B981' },
                      isContinuing && { opacity: 0.6 },
                    ]}
                    onPress={() =>
                      handleContinuePipeline(
                        continuationPlan?.missingPrerequisite?.engineId ||
                          continuationPlan?.resumeFromStage ||
                          undefined
                      )
                    }
                    disabled={isContinuing}
                  >
                    <Feather name="play" size={16} color="#FFFFFF" />
                    <Text style={st.primaryGenerateText}>
                      {isContinuing ? 'CONTINUING PIPELINE...' : 'CONTINUE PIPELINE'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      st.primaryGenerateBtn,
                      { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569' },
                    ]}
                    onPress={() =>
                      handleGenerateStrategy({
                        forceRefresh: true,
                        recoveryMode: 'FULL_REFRESH',
                      })
                    }
                    disabled={isContinuing}
                  >
                    <Feather name="rotate-ccw" size={16} color="#CBD5E1" />
                    <Text style={[st.primaryGenerateText, { color: '#CBD5E1' }]}>
                      START FRESH (FULL REFRESH)
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={st.primaryGenerateBtn} onPress={handleGenerateStrategy}>
                  <Feather name="zap" size={16} color="#FFFFFF" />
                  <Text style={st.primaryGenerateText}>GENERATE STRATEGY</Text>
                </Pressable>
              )}
            </View>
          </View>
        ) : (
          <>
            {activeTab === 'overview' && (
              <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Header Summary Card */}
                <View style={[st.headerCard, { backgroundColor: '#0B0F17', borderColor: '#1F2937' }]}>
                  <View style={st.headerRow}>
                    <View style={st.headerIconBox}>
                      <Feather name="cpu" size={20} color="#8B5CF6" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <Text style={[st.headerTitle, { color: '#F1F5F9' }]}>Consolidated Strategic Brain</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {strategyMeta?.status === 'LIVE' ? (
                            <View style={st.statusLiveBadge}>
                              <View style={st.statusLiveDot} />
                              <Text style={st.statusLiveText}>{resolvedPlanLifecycle.toUpperCase()}</Text>
                            </View>
                          ) : strategyMeta?.status === 'REVIEW_REQUIRED' ? (
                            <View style={[st.statusLiveBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B35' }]}>
                              <View style={[st.statusLiveDot, { backgroundColor: '#F59E0B' }]} />
                              <Text style={[st.statusLiveText, { color: '#F59E0B' }]}>REVIEW REQUIRED</Text>
                            </View>
                          ) : (
                            <View style={[st.statusLiveBadge, { backgroundColor: '#3B82F618', borderColor: '#3B82F635' }]}>
                              <View style={[st.statusLiveDot, { backgroundColor: '#3B82F6' }]} />
                              <Text style={[st.statusLiveText, { color: '#3B82F6' }]}>{resolvedPlanLifecycle.toUpperCase()}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                        Plan Rev {resolvedPlanRev} · Bundle v{resolvedBundleVer}
                        {resolvedRunId ? ` · Run ID: ${resolvedRunId}` : ''}
                        {resolvedStrategyRootId ? ` · Strategy Root ID: ${resolvedStrategyRootId}` : ''}
                      </Text>

                      {/* Separate Evidence & Claim Status Badges */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        <View style={[st.activePill, { backgroundColor: '#10B98115', borderColor: '#10B98135' }]}>
                          <View style={[st.activeDot, { backgroundColor: '#10B981' }]} />
                          <Text style={[st.activePillText, { color: '#34D399' }]}>
                            Lifecycle: {resolvedPlanLifecycle}
                          </Text>
                        </View>
                        {hasProductFacts && (
                          <View style={[st.activePill, { backgroundColor: '#3B82F615', borderColor: '#3B82F635' }]}>
                            <View style={[st.activeDot, { backgroundColor: '#60A5FA' }]} />
                            <Text style={[st.activePillText, { color: '#93C5FD' }]}>
                              Supported by Product Facts
                            </Text>
                          </View>
                        )}
                        {hasCompetitorSignals && (
                          <View style={[st.activePill, { backgroundColor: '#8B5CF615', borderColor: '#8B5CF635' }]}>
                            <View style={[st.activeDot, { backgroundColor: '#A78BFA' }]} />
                            <Text style={[st.activePillText, { color: '#C4B5FD' }]}>
                              Customer-Reported Competitor Signal
                            </Text>
                          </View>
                        )}
                        {isHypothesis && (
                          <View style={[st.activePill, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B35' }]}>
                            <View style={[st.activeDot, { backgroundColor: '#FBBF24' }]} />
                            <Text style={[st.activePillText, { color: '#FCD34D' }]}>
                              Proposed Strategic Hypothesis
                            </Text>
                          </View>
                        )}
                        {isComparisonUnavailable && (
                          <View style={[st.activePill, { backgroundColor: '#64748B20', borderColor: '#64748B45' }]}>
                            <View style={[st.activeDot, { backgroundColor: '#94A3B8' }]} />
                            <Text style={[st.activePillText, { color: '#CBD5E1' }]}>
                              Competitor Comparison Unavailable
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </View>

                {/* 1. Executive Growth Blueprint */}
                {businessRep && (
                  <View style={[st.card, { backgroundColor: '#0F1419', borderColor: '#1F2937' }]}>
                    <View style={st.cardHeader}>
                      <View style={st.cardTagPill}>
                        <Feather name="compass" size={13} color="#A78BFA" />
                        <Text style={st.cardTagText}>EXECUTIVE BLUEPRINT</Text>
                      </View>
                      <View
                        style={[
                          st.activePill,
                          isHypothesis
                            ? { backgroundColor: '#F59E0B15', borderColor: '#F59E0B35' }
                            : { backgroundColor: '#10B98115', borderColor: '#10B98135' },
                        ]}
                      >
                        <View
                          style={[
                            st.activeDot,
                            { backgroundColor: isHypothesis ? '#FBBF24' : '#10B981' },
                          ]}
                        />
                        <Text
                          style={[
                            st.activePillText,
                            { color: isHypothesis ? '#FCD34D' : '#34D399' },
                          ]}
                        >
                          {resolvedPlanLifecycle} · {isHypothesis ? 'Proposed Strategic Hypothesis' : 'Supported by Product Facts'}
                        </Text>
                      </View>
                    </View>

                    <View style={st.cardHero}>
                      {isHypothesis && resolvedEpistemicLabel ? (
                        <View
                          style={{
                            backgroundColor: '#F59E0B12',
                            borderColor: '#F59E0B35',
                            borderWidth: 1,
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            paddingVertical: 7,
                            marginBottom: 12,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#FCD34D' }}>
                            {resolvedEpistemicLabel}
                          </Text>
                        </View>
                      ) : null}

                      <Text style={st.heroCategory}>OVERARCHING GROWTH STRATEGY</Text>
                      <Text style={st.heroHeadline}>
                        {businessRep.strategicSummary?.strategy ||
                          'Strategic growth positioning aligned to verified market demand.'}
                      </Text>

                      {businessRep.strategicSummary?.rationale && (
                        <View style={st.rationaleBox}>
                          <View style={st.rationaleHeader}>
                            <Feather name="book-open" size={13} color="#A78BFA" />
                            <Text style={st.rationaleTitle}>STRATEGIC RATIONALE & THESIS</Text>
                          </View>
                          <Text style={st.rationaleText}>{businessRep.strategicSummary.rationale}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {/* 2. Canonical Strategy Authority (distinct upstream positioning authority, contrast axis, and doctrine rationale) */}
                {(stratSummary || canonicalPositioningTerritory || canonicalContrastAxis) && (
                  <View style={[st.card, { backgroundColor: '#0F1419', borderColor: '#1F2937' }]}>
                    <View style={st.cardHeader}>
                      <View style={[st.cardTagPill, { backgroundColor: '#10B98118', borderColor: '#10B98135' }]}>
                        <Feather name="shield" size={13} color="#34D399" />
                        <Text style={[st.cardTagText, { color: '#34D399' }]}>CANONICAL STRATEGY AUTHORITY</Text>
                      </View>
                      <View
                        style={[
                          st.activePill,
                          {
                            backgroundColor:
                              strategyMeta?.status === 'DEGRADED' || isHypothesis ? '#F59E0B15' : '#10B98115',
                            borderColor:
                              strategyMeta?.status === 'DEGRADED' || isHypothesis ? '#F59E0B30' : '#10B98130',
                          },
                        ]}
                      >
                        <View
                          style={[
                            st.activeDot,
                            {
                              backgroundColor:
                                strategyMeta?.status === 'DEGRADED' || isHypothesis ? '#F59E0B' : '#10B981',
                            },
                          ]}
                        />
                        <Text
                          style={[
                            st.activePillText,
                            {
                              color:
                                strategyMeta?.status === 'DEGRADED' || isHypothesis ? '#FBBF24' : '#34D399',
                            },
                          ]}
                        >
                          {strategyMeta?.status === 'DEGRADED'
                            ? 'Degraded Fallback · Review Required'
                            : isHypothesis
                            ? `Proposed Strategic Hypothesis${isComparisonUnavailable ? ' · Competitor Comparison Unavailable' : ''}`
                            : 'Supported by Product Facts'}
                        </Text>
                      </View>
                    </View>

                    <View style={st.cardHero}>
                      {canonicalPositioningTerritory ? (
                        <View style={{ marginBottom: 10 }}>
                          <Text style={[st.heroCategory, { color: '#34D399' }]}>
                            CANONICAL POSITIONING TERRITORY & CONTRAST AXIS
                          </Text>
                          <Text style={[st.heroHeadline, { fontSize: 15, marginBottom: 4 }]}>
                            {canonicalPositioningTerritory}
                          </Text>
                          {canonicalContrastAxis ? (
                            <Text style={{ fontSize: 12, color: '#94A3B8' }}>
                              Contrast Axis: {canonicalContrastAxis}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}

                      {canonicalStatement ? (
                        <>
                          <Text style={[st.heroCategory, { color: '#34D399' }]}>
                            CANONICAL POSITIONING & STRATEGY STATEMENT
                          </Text>
                          <View style={st.quoteBox}>
                            <Text style={st.quoteText}>"{canonicalStatement}"</Text>
                          </View>
                        </>
                      ) : null}

                      {canonicalDoctrineRationale ? (
                        <View style={[st.rationaleBox, { borderColor: '#10B98130', backgroundColor: '#064E3B18' }]}>
                          <View style={st.rationaleHeader}>
                            <Feather name="zap" size={13} color="#FBBF24" />
                            <Text style={[st.rationaleTitle, { color: '#FCD34D' }]}>CORE DOCTRINE RATIONALE</Text>
                          </View>
                          <Text style={[st.rationaleText, { color: '#D1FAE5' }]}>{canonicalDoctrineRationale}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}
              </ScrollView>
            )}

            {activeTab === 'differentiation' && (
              <View style={st.tabFullView}>
                <DifferentiationSectionView planData={planData} intelligenceData={intelligenceData} />
              </View>
            )}

            {activeTab === 'mechanism' && (
              <View style={st.tabFullView}>
                <MechanismSectionView planData={planData} intelligenceData={intelligenceData} />
              </View>
            )}

            {activeTab === 'offer' && (
              <View style={st.tabFullView}>
                <OfferSectionView planData={planData} intelligenceData={intelligenceData} />
              </View>
            )}

            {activeTab === 'awareness' && (
              <View style={st.tabFullView}>
                <AwarenessSectionView planData={planData} intelligenceData={intelligenceData} />
              </View>
            )}

            {activeTab === 'journey' && (
              <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
                <BuyerConversionJourneyView
                  journeys={sections.buyerConversionJourneys || sections.businessRepresentation?.buyerConversionJourneys}
                  legacyJourney={sections.buyerConversionJourney || sections.businessRepresentation?.buyerConversionJourney}
                  legacyPersuasion={sections.persuasionStrategy || sections.businessRepresentation?.persuasionStrategy}
                  approvedLanes={sections.approvedLanes}
                  pains={sections.pains || sections.canonicalPains}
                />
              </ScrollView>
            )}

            {activeTab === 'channels' && (
              <View style={st.tabFullView}>
                <ChannelsBudgetSectionView planData={planData} intelligenceData={intelligenceData} />
              </View>
            )}
          </>
        )}
      </View>

      {/* ── MODALS ── */}
      <LiveStrategyRunModal
        visible={runModalVisible}
        onClose={() => setRunModalVisible(false)}
        runStatus={null}
        stages={runStages}
        currentStage={currentStageName}
        progressPercent={progressPercent}
        completedCount={completedCount}
        totalCount={runStages.length || 15}
        isCompleted={isRunCompleted}
        isFailed={isRunFailed}
        completionData={completionData}
        continuationPlan={continuationPlan}
        isContinuing={isContinuing}
        onViewStrategy={() => setRunModalVisible(false)}
        onContinuePipeline={(fromStage) => handleContinuePipeline(fromStage)}
        onRetry={() => handleContinuePipeline()}
        onStartFresh={() =>
          handleGenerateStrategy({
            forceRefresh: true,
            recoveryMode: 'FULL_REFRESH',
          })
        }
      />

      <StrategicProposalModal
        visible={proposalModalVisible}
        onClose={() => setProposalModalVisible(false)}
        proposal={selectedProposal}
        onApprove={handleApproveProposal}
        onReject={handleRejectProposal}
      />

      <LiveTargetedUpdateModal
        visible={targetedModalVisible}
        onClose={() => setTargetedModalVisible(false)}
        isRunning={isTargetedRunning}
        activeAuthority={targetedAuthority}
        result={targetedResult}
        onViewUpdatedStrategy={() => setTargetedModalVisible(false)}
      />

      <StrategyActivityTimelineModal
        visible={timelineVisible}
        onClose={() => setTimelineVisible(false)}
        activities={activities}
      />

      <StrategyVersionHistoryModal
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        history={historyItems}
      />
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },

  // Strategy Status Persistent Header
  strategyStatusHeader: {
    backgroundColor: '#0F141F',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2535',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#10B98118',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B98135',
  },
  statusLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusLiveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.5,
  },
  versionBadge: {
    backgroundColor: '#8B5CF618',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8B5CF635',
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  monitoringText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  statusRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#161B26',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  historyBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  generateBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Proposal Banner
  proposalBanner: {
    backgroundColor: '#78350F20',
    borderBottomWidth: 1,
    borderBottomColor: '#F59E0B40',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  proposalBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 12,
  },
  proposalIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F59E0B25',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proposalBannerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.5,
  },
  proposalBannerSub: {
    fontSize: 11,
    color: '#FEF3C7',
    marginTop: 1,
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F59E0B25',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B40',
  },
  reviewBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCD34D',
  },

  // Tabs
  tabBarWrapper: {
    backgroundColor: '#11161F',
    borderBottomWidth: 1,
    borderBottomColor: '#1E2535',
  },
  tabScroll: {
    maxHeight: 52,
  },
  tabScrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  tabBtnActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  updatedTabBadge: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 6,
  },
  updatedTabBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#000000',
  },

  tabContentArea: {
    flex: 1,
  },
  tabFullView: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  scrollContent: { padding: 16, paddingBottom: 48 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  stateText: { fontSize: 14, textAlign: 'center', marginTop: 12 },

  // Empty Plan State
  emptyPlanContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyPlanTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 16,
  },
  emptyPlanSub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
    maxWidth: 400,
  },
  primaryGenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryGenerateText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // Cards
  headerCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerIconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#8B5CF618', borderWidth: 1, borderColor: '#8B5CF635', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  statusLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#10B98118', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#10B98135' },
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: '#1F2937', backgroundColor: '#111827' },
  cardTagPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#8B5CF618', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#8B5CF630' },
  cardTagText: { fontSize: 11, fontWeight: '800', color: '#A78BFA', letterSpacing: 0.8, textTransform: 'uppercase' },
  activePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#8B5CF615', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#8B5CF630' },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6' },
  activePillText: { fontSize: 10, fontWeight: '700', color: '#C4B5FD' },
  cardHero: { padding: 16, backgroundColor: '#0B0F17', borderBottomWidth: 1, borderColor: '#1F2937' },
  heroCategory: { fontSize: 10, fontWeight: '800', color: '#A78BFA', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 },
  heroHeadline: { fontSize: 16, fontWeight: '800', color: '#F8FAFC', lineHeight: 24, marginBottom: 12 },
  quoteBox: { backgroundColor: '#10B98112', borderLeftWidth: 3, borderColor: '#10B981', padding: 12, borderRadius: 8, marginBottom: 12 },
  quoteText: { fontSize: 14, fontWeight: '600', color: '#F1F5F9', lineHeight: 22, fontStyle: 'italic' },
  rationaleBox: { backgroundColor: '#1E1B4B30', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#8B5CF630', marginTop: 4 },
  rationaleHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  rationaleTitle: { fontSize: 10, fontWeight: '800', color: '#A78BFA', letterSpacing: 0.6, textTransform: 'uppercase' },
  rationaleText: { fontSize: 12, color: '#DDD6FE', lineHeight: 18 },
});
