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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planData, setPlanData] = useState<any>(null);

  // Strategy Experience State
  const [strategyMeta, setStrategyMeta] = useState<{
    hasStrategy: boolean;
    status: string;
    canonicalVersion: number | null;
    primaryAxis: string | null;
    changedAuthorities: string[];
    preservedAuthorities: string[];
    pendingProposalCount: number;
    pendingProposals: StrategicProposalData[];
    lastUpdated: string | null;
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
  const { data: intelligenceData } = useAudiencePositioning(campaignId);

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
      if (metaRes.ok) {
        const metaData = await safeApiJson(metaRes);
        setStrategyMeta(metaData);
      }

      // 2. Fetch active plan details
      const activeUrl = getApiUrl(`/api/plans/active/${encodeURIComponent(campaignId)}`);
      const activeRes = await authFetch(activeUrl);
      const activeData = await safeApiJson(activeRes);

      if (activeRes.ok && activeData.hasPlan) {
        setPlanData(activeData.plan);
        setError(null);
      } else {
        setPlanData(null);
      }
    } catch (err: any) {
      console.error('[StrategyPlan] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    setLoading(true);
    fetchPlanAndMeta();
  }, [fetchPlanAndMeta]);

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

        if (data.status === 'COMPLETED') {
          setIsRunCompleted(true);
          setIsRunFailed(false);
          setCompletionData({
            version: strategyMeta?.canonicalVersion ? strategyMeta.canonicalVersion + 1 : 1,
            generatedAt: new Date().toLocaleTimeString(),
            primaryDirection: planData?.sections?.brandSpine?.contrastAxis || 'Verified Signal Integrity',
            primaryChannel: 'Multi-Channel',
            lanesCount: planData?.sections?.approvedLanes?.length || 3,
          });
          clearInterval(intervalId);
          fetchPlanAndMeta();
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
    intervalId = setInterval(pollStatus, 2000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeJobId, runModalVisible, fetchPlanAndMeta, strategyMeta?.canonicalVersion, planData]);

  // Trigger Generate Strategy
  const handleGenerateStrategy = async () => {
    if (!campaignId) return;

    try {
      const url = getApiUrl(`/api/strategy/generate/${encodeURIComponent(campaignId)}`);
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true }),
      });

      const data = await safeApiJson(res);

      if (res.status === 409 || data.status === 'ALREADY_RUNNING') {
        setActiveJobId(data.jobId);
        setIsRunCompleted(false);
        setIsRunFailed(false);
        setRunModalVisible(true);
        return;
      }

      if (data.jobId) {
        setActiveJobId(data.jobId);
        setIsRunCompleted(false);
        setIsRunFailed(false);
        setProgressPercent(0);
        setCompletedCount(0);
        setRunModalVisible(true);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to start strategy generation.');
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
      activeCampaignId &&
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
        const url = getApiUrl(`/api/strategy/acknowledge-change/${encodeURIComponent(activeCampaignId)}`);
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

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <GlobalHeader title="Strategy Plan" />

      {/* ── PERSISTENT LIVE STRATEGY STATUS HEADER ── */}
      <View style={st.strategyStatusHeader}>
        <View style={st.statusLeft}>
          <View style={st.statusLivePill}>
            <View style={st.statusLiveDot} />
            <Text style={st.statusLiveText}>LIVE</Text>
          </View>
          <View style={st.versionBadge}>
            <Text style={st.versionBadgeText}>
              Strategy v{strategyMeta?.canonicalVersion || planData?.version || 1}
            </Text>
          </View>
          <Text style={st.monitoringText}>
            Monitoring market & business performance
          </Text>
        </View>

        <View style={st.statusRight}>
          <Pressable style={st.historyBtn} onPress={handleOpenTimeline}>
            <Feather name="clock" size={13} color="#94A3B8" />
            <Text style={st.historyBtnText}>Activity</Text>
          </Pressable>

          <Pressable style={st.historyBtn} onPress={handleOpenHistory}>
            <Feather name="layers" size={13} color="#94A3B8" />
            <Text style={st.historyBtnText}>History</Text>
          </Pressable>

          <Pressable style={st.generateBtn} onPress={handleGenerateStrategy}>
            <Feather name="refresh-cw" size={13} color="#FFFFFF" />
            <Text style={st.generateBtnText}>
              {planData ? 'Regenerate Strategy' : 'Generate Strategy'}
            </Text>
          </Pressable>
        </View>
      </View>

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
            <Feather name="map" size={48} color="#64748B" />
            <Text style={st.emptyPlanTitle}>No Active Strategy Plan</Text>
            <Text style={st.emptyPlanSub}>
              Complete your campaign setup to generate a comprehensive, algorithmic strategy tailored strictly to your business facts.
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
              <Pressable style={st.primaryGenerateBtn} onPress={handleGenerateStrategy}>
                <Feather name="zap" size={16} color="#FFFFFF" />
                <Text style={st.primaryGenerateText}>GENERATE STRATEGY</Text>
              </Pressable>
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[st.headerTitle, { color: '#F1F5F9' }]}>Consolidated Strategic Brain</Text>
                        <View style={st.statusLiveBadge}>
                          <View style={st.statusLiveDot} />
                          <Text style={st.statusLiveText}>LIVE</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                        Active Strategy Blueprint · Version {strategyMeta?.canonicalVersion || planData?.version || 1}
                      </Text>
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
                      <View style={st.activePill}>
                        <View style={st.activeDot} />
                        <Text style={st.activePillText}>Business Layer · Active</Text>
                      </View>
                    </View>

                    <View style={st.cardHero}>
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

                {/* 2. Canonical Strategy Authority */}
                {stratSummary && (
                  <View style={[st.card, { backgroundColor: '#0F1419', borderColor: '#1F2937' }]}>
                    <View style={st.cardHeader}>
                      <View style={[st.cardTagPill, { backgroundColor: '#10B98118', borderColor: '#10B98135' }]}>
                        <Feather name="shield" size={13} color="#34D399" />
                        <Text style={[st.cardTagText, { color: '#34D399' }]}>CANONICAL STRATEGY AUTHORITY</Text>
                      </View>
                      <View style={[st.activePill, { backgroundColor: '#10B98115', borderColor: '#10B98130' }]}>
                        <View style={[st.activeDot, { backgroundColor: '#10B981' }]} />
                        <Text style={[st.activePillText, { color: '#34D399' }]}>Source of Truth · Engine Verified</Text>
                      </View>
                    </View>

                    <View style={st.cardHero}>
                      <Text style={[st.heroCategory, { color: '#34D399' }]}>ALGORITHMICALLY APPROVED STATEMENT</Text>
                      <View style={st.quoteBox}>
                        <Text style={st.quoteText}>"{stratSummary.strategy}"</Text>
                      </View>

                      {stratSummary.rationale && (
                        <View style={[st.rationaleBox, { borderColor: '#10B98130', backgroundColor: '#064E3B18' }]}>
                          <View style={st.rationaleHeader}>
                            <Feather name="zap" size={13} color="#FBBF24" />
                            <Text style={[st.rationaleTitle, { color: '#FCD34D' }]}>CORE DOCTRINE RATIONALE</Text>
                          </View>
                          <Text style={[st.rationaleText, { color: '#D1FAE5' }]}>{stratSummary.rationale}</Text>
                        </View>
                      )}
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
        onViewStrategy={() => setRunModalVisible(false)}
        onRetry={handleGenerateStrategy}
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
