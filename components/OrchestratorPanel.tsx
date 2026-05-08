import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useColorScheme,
  Platform,
  Animated as RNAnimated,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { getApiUrl, authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import PlanDocumentView from '@/components/PlanDocumentView';
import EngineTableModal from '@/components/EngineTableModal';

const P = {
  mint: '#8B5CF6',
  mintDark: '#7C3AED',
  coral: '#FF6B6B',
  blue: '#4C9AFF',
  gold: '#FFD700',
  green: '#10B981',
  orange: '#F97316',
  teal: '#14B8A6',
  pink: '#EC4899',
  indigo: '#6366F1',
  cyan: '#06B6D4',
  amber: '#F59E0B',
  red: '#F43F5E',
  emerald: '#059669',
  purple: '#D946EF',
  darkBg: '#080C10',
  darkCard: '#0F1419',
  darkCardBorder: '#1A2030',
  darkSurface: '#151B24',
  lightBg: '#F4F7F5',
  lightCard: '#FFFFFF',
  lightCardBorder: '#E2E8E4',
  textDarkPrimary: '#E8EDF2',
  textDarkSec: '#8892A4',
  textDarkMuted: '#4A5568',
  textLightPrimary: '#1A2332',
  textLightSec: '#546478',
  textLightMuted: '#8A96A8',
};

interface EngineSection {
  id: string;
  name: string;
  status: string;
  summary?: string | null;
}

interface OrchestratorJob {
  hasRun: boolean;
  id?: string;
  status?: string;
  planId?: string;
  durationMs?: number;
  sections?: EngineSection[];
  createdAt?: string;
  completedAt?: string;
  error?: string;
}

interface CommercialJudgement {
  recommendedExecutionMode?: string;
  commercialReadinessAssessment?: string;
  biggestRisk?: string;
  conditionsToUpgrade?: string[];
  principalCall?: string;
  whatHumanReviewerWouldAsk?: string[];
  reasoningSteps?: string[];
  judgeVerdict?: string;
  judgeReason?: string;
}

interface BlockReason {
  code?: string;
  description?: string;
  source?: string;
  severity?: 'critical' | 'high';
  message?: string;
}

interface RecoveryIssue {
  blockCode?: string;
  rootCauseCategory?: string;
  ownerEngine?: string;
  diagnosis?: string;
  repairAction?: string;
  successCriteria?: string;
  requiredProof?: string[];
  nextPossibleMode?: string;
  priority?: number;
  severity?: 'critical' | 'high';
  source?: string;
}

interface RecoveryPlan {
  currentVerdict?: string;
  currentExecutionMode?: string;
  blockCodes?: string[];
  rootCauseSummary?: string;
  issues?: RecoveryIssue[];
  priorityOrder?: string[];
  globalRecoveryPlan?: string[];
  rerunRequirements?: string[];
  humanReviewNeeded?: boolean;
  generatedAt?: string;
  source?: string;
}

interface ControlVerdict {
  hasVerdict: boolean;
  verdict?: {
    verdict?: string;
    executionMode?: string;
    blockReasons?: BlockReason[];
    commercialJudgement?: CommercialJudgement | null;
    recoveryPlan?: RecoveryPlan | null;
    createdAt?: string;
  };
}

interface ActivePlan {
  hasPlan: boolean;
  plan?: {
    id: string;
    status: string;
    summary?: string;
    createdAt?: string;
  };
  calendar?: { total: number; pending: number; completed: number };
  studio?: { total: number; draft: number; ready: number; published: number };
  goalDecomposition?: { feasibility: string; goalLabel: string; feasibilityScore?: number };
}

const ENGINE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; shortName: string }> = {
  market_intelligence:   { icon: 'analytics-outline',        color: P.green,   shortName: 'Market Intel' },
  audience:              { icon: 'people-outline',            color: P.blue,    shortName: 'Audience' },
  positioning:           { icon: 'compass-outline',           color: P.mint,    shortName: 'Positioning' },
  differentiation:       { icon: 'layers-outline',            color: P.pink,    shortName: 'Differentiation' },
  mechanism:             { icon: 'construct-outline',         color: P.purple,  shortName: 'Mechanism' },
  offer:                 { icon: 'pricetag-outline',          color: P.orange,  shortName: 'Offer' },
  awareness:             { icon: 'eye-outline',               color: P.amber,   shortName: 'Awareness' },
  funnel:                { icon: 'funnel-outline',            color: P.teal,    shortName: 'Funnel' },
  persuasion:            { icon: 'megaphone-outline',         color: P.pink,    shortName: 'Persuasion' },
  integrity:             { icon: 'shield-checkmark-outline',  color: P.indigo,  shortName: 'Integrity' },
  statistical_validation:{ icon: 'stats-chart-outline',      color: P.cyan,    shortName: 'Statistics' },
  budget_governor:       { icon: 'wallet-outline',            color: P.amber,   shortName: 'Budget' },
  channel_selection:     { icon: 'git-branch-outline',       color: P.blue,    shortName: 'Channels' },
  iteration:             { icon: 'repeat-outline',            color: P.red,     shortName: 'Iteration' },
  retention:             { icon: 'heart-outline',             color: P.emerald, shortName: 'Retention' },
};

const ENGINE_ORDER = [
  'market_intelligence', 'audience', 'positioning', 'differentiation', 'mechanism',
  'offer', 'awareness', 'funnel', 'persuasion', 'integrity',
  'statistical_validation', 'budget_governor', 'channel_selection', 'iteration', 'retention',
];

function EngineRow({
  id, name, status, index, isRunning, runningIdx, isDark, summary,
}: {
  id: string; name: string; status: string; index: number;
  isRunning: boolean; runningIdx: number; isDark: boolean; summary?: string | null;
}) {
  const meta = ENGINE_META[id] || { icon: 'cube-outline' as any, color: P.blue, shortName: name };
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;
  const textPrimary = isDark ? P.textDarkPrimary : P.textLightPrimary;
  const textMuted = isDark ? P.textDarkMuted : P.textLightMuted;

  const pulse = useRef(new RNAnimated.Value(0.4)).current;
  const isCurrentlyRunning = isRunning && runningIdx === index;
  const isPending = isRunning && runningIdx < index;

  useEffect(() => {
    if (isCurrentlyRunning) {
      const anim = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
          RNAnimated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
    pulse.setValue(1);
  }, [isCurrentlyRunning]);

  let statusColor = textMuted;
  let statusLabel = 'Pending';
  let statusIcon: keyof typeof Ionicons.glyphMap = 'ellipse-outline';

  if (isCurrentlyRunning) {
    statusColor = P.blue;
    statusLabel = 'Running';
    statusIcon = 'sync-outline';
  } else if (isPending) {
    statusColor = textMuted;
    statusLabel = 'Queued';
    statusIcon = 'time-outline';
  } else if (status === 'SUCCESS') {
    statusColor = P.green;
    statusLabel = 'Done';
    statusIcon = 'checkmark-circle';
  } else if (status === 'FAILED' || status === 'DEPTH_FAILED') {
    statusColor = P.coral;
    statusLabel = 'Failed';
    statusIcon = 'close-circle';
  } else if (status === 'BLOCKED' || status === 'DEPTH_CASCADE_BLOCKED') {
    statusColor = P.amber;
    statusLabel = 'Blocked';
    statusIcon = 'alert-circle-outline';
  } else if (status === 'SIGNAL_INSUFFICIENT') {
    statusColor = P.amber;
    statusLabel = 'Low Signal';
    statusIcon = 'warning-outline';
  } else if (status) {
    statusColor = P.teal;
    statusLabel = 'Complete';
    statusIcon = 'checkmark-done-circle-outline';
  }

  const terminalSuccess = ['SUCCESS', 'COMPLETED', 'COMPLETE'].includes(status.toUpperCase());
  const showSummary = !isRunning && !isPending && !!summary && terminalSuccess;

  return (
    <View style={[s.engineRow, {
      backgroundColor: cardBg,
      borderColor: isCurrentlyRunning ? meta.color + '40' : cardBorder,
      borderWidth: isCurrentlyRunning ? 1.5 : 1,
    }]}>
      <View style={[s.engineIconWrap, { backgroundColor: isPending ? textMuted + '10' : meta.color + '15' }]}>
        <Ionicons name={meta.icon} size={18} color={isPending ? textMuted : meta.color} />
      </View>
      <View style={{ flex: 1, gap: showSummary ? 4 : 0 }}>
        <View style={s.engineInfo}>
          <Text style={[s.engineNum, { color: textMuted }]}>{String(index + 1).padStart(2, '0')}</Text>
          <Text style={[s.engineName, { color: textPrimary }]} numberOfLines={1}>{name}</Text>
        </View>
        {showSummary && (
          <Text style={[s.engineSummary, { color: isDark ? P.textDarkSec : P.textLightSec }]} numberOfLines={2}>
            {summary}
          </Text>
        )}
      </View>
      <View style={s.engineStatus}>
        {isCurrentlyRunning ? (
          <ActivityIndicator size="small" color={P.blue} />
        ) : (
          <RNAnimated.View style={{ opacity: pulse }}>
            <Ionicons name={statusIcon} size={18} color={statusColor} />
          </RNAnimated.View>
        )}
        <Text style={[s.engineStatusText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

function ElapsedTimer({ startedAt, running }: { startedAt: number; running: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running, startedAt]);

  if (!running) return null;
  const m = Math.floor(elapsed / 60);
  const s2 = elapsed % 60;
  return (
    <Text style={{ fontSize: 12, color: P.blue, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
      {m > 0 ? `${m}m ` : ''}{s2}s
    </Text>
  );
}

export default function OrchestratorPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { selectedCampaignId } = useCampaign();

  const [job, setJob] = useState<OrchestratorJob | null>(null);
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [controlVerdict, setControlVerdict] = useState<ControlVerdict | null>(null);
  const [showJudgement, setShowJudgement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [showPlan, setShowPlan] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bg = isDark ? P.darkBg : P.lightBg;
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const cardBorder = isDark ? P.darkCardBorder : P.lightCardBorder;
  const textPrimary = isDark ? P.textDarkPrimary : P.textLightPrimary;
  const textSec = isDark ? P.textDarkSec : P.textLightSec;
  const textMuted = isDark ? P.textDarkMuted : P.textLightMuted;

  const fetchLatest = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = getApiUrl(`/api/orchestrator/latest/${encodeURIComponent(selectedCampaignId)}`);
      const res = await authFetch(url);
      if (!res.ok) return;
      const data: OrchestratorJob = await res.json();

      const hasSummariesInSections = (data.sections || []).some((s: any) => !!s.summary);
      if (!hasSummariesInSections && data.status === 'COMPLETED') {
        try {
          const summUrl = getApiUrl(`/api/orchestrator/summaries/${encodeURIComponent(selectedCampaignId)}`);
          const summRes = await authFetch(summUrl);
          if (summRes.ok) {
            const summData = await summRes.json();
            if (summData.hasSummaries && summData.engines) {
              const summMap: Record<string, string> = {};
              summData.engines.forEach((e: any) => { if (e.summary) summMap[e.id] = e.summary; });
              data.sections = (data.sections || []).map((s: any) => ({
                ...s,
                summary: summMap[s.id] || s.summary || null,
              }));
            }
          }
        } catch {}
      }

      setJob(data);
      const terminalStatuses = ['COMPLETED', 'FAILED', 'PARTIAL', 'BLOCKED', 'ERROR'];
      if (terminalStatuses.includes(data.status)) {
        setRunning(false);
      }
    } catch {}
  }, [selectedCampaignId]);

  const fetchActivePlan = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const u = new URL(getApiUrl(`/api/plans/active/${encodeURIComponent(selectedCampaignId)}`));
      const res = await authFetch(u.toString());
      if (!res.ok) return;
      const data: ActivePlan = await res.json();
      setActivePlan(data);
    } catch {}
  }, [selectedCampaignId]);

  const fetchControlVerdict = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const url = getApiUrl(`/api/system-control/latest/${encodeURIComponent(selectedCampaignId)}`);
      const res = await authFetch(url);
      if (!res.ok) return;
      const data: ControlVerdict = await res.json();
      setControlVerdict(data);
    } catch {}
  }, [selectedCampaignId]);

  useEffect(() => {
    if (!selectedCampaignId) { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchLatest(), fetchActivePlan(), fetchControlVerdict()]).finally(() => setLoading(false));
  }, [selectedCampaignId]);

  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(async () => {
        await fetchLatest();
        await fetchActivePlan();
        await fetchControlVerdict();
      }, 3000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [running, fetchLatest, fetchActivePlan, fetchControlVerdict]);

  const handleRunPipeline = useCallback(async () => {
    if (!selectedCampaignId || running) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setRunning(true);
    setRunStartedAt(Date.now());
    setJob(null);
    try {
      const url = getApiUrl('/api/orchestrator/run');
      await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: selectedCampaignId, forceRefresh: true }),
      });
    } catch {
      setRunning(false);
    }
  }, [selectedCampaignId, running]);

  const sections = job?.sections || [];
  const sectionMap: Record<string, EngineSection> = {};
  for (const s2 of sections) sectionMap[s2.id] = s2;

  const completedCount = sections.filter(s2 => s2.status === 'SUCCESS').length;
  const failedCount = sections.filter(s2 => s2.status !== 'SUCCESS').length;

  const runningIdx = running
    ? Math.min(
        Math.floor((Date.now() - runStartedAt) / 11000),
        14
      )
    : -1;

  const lastRunTime = job?.createdAt
    ? new Date(job.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const durationSec = job?.durationMs ? Math.round(job.durationMs / 1000) : null;

  if (!selectedCampaignId) {
    return (
      <View style={[s.empty, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Ionicons name="analytics-outline" size={32} color={textMuted} />
        <Text style={[s.emptyTitle, { color: textPrimary }]}>No Campaign Selected</Text>
        <Text style={[s.emptySub, { color: textMuted }]}>Select a campaign to run the strategic pipeline</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[s.empty, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <ActivityIndicator size="large" color={P.mint} />
        <Text style={[s.emptySub, { color: textMuted, marginTop: 10 }]}>Loading pipeline status...</Text>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: bg }}>
      <LinearGradient
        colors={isDark ? ['#0D0B1A', '#0A1020', '#080C10'] : ['#EDE9FB', '#EEF3FF', '#F4F7F5']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[s.header, { borderColor: isDark ? P.mint + '15' : P.mint + '20' }]}
      >
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <View style={[s.headerIconWrap, { backgroundColor: P.mint + '20' }]}>
              <Ionicons name="git-network-outline" size={22} color={P.mint} />
            </View>
            <View>
              <Text style={[s.headerTitle, { color: textPrimary }]}>Strategic Pipeline</Text>
              <Text style={[s.headerSub, { color: textSec }]}>15-engine analysis system</Text>
            </View>
          </View>
          {running && <ElapsedTimer startedAt={runStartedAt} running={running} />}
          {!running && job?.status === 'COMPLETED' && (
            <View style={[s.statusBadge, { backgroundColor: P.green + '20', borderColor: P.green + '40' }]}>
              <Ionicons name="checkmark-circle" size={12} color={P.green} />
              <Text style={[s.statusBadgeText, { color: P.green }]}>Complete</Text>
            </View>
          )}
          {!running && job?.status === 'BLOCKED' && (
            <View style={[s.statusBadge, { backgroundColor: P.amber + '20', borderColor: P.amber + '40' }]}>
              <Ionicons name="alert-circle" size={12} color={P.amber} />
              <Text style={[s.statusBadgeText, { color: P.amber }]}>Blocked</Text>
            </View>
          )}
          {!running && (job?.status === 'FAILED' || job?.status === 'ERROR') && (
            <View style={[s.statusBadge, { backgroundColor: P.coral + '20', borderColor: P.coral + '40' }]}>
              <Ionicons name="close-circle" size={12} color={P.coral} />
              <Text style={[s.statusBadgeText, { color: P.coral }]}>Failed</Text>
            </View>
          )}
        </View>

        {lastRunTime && !running && (
          <View style={s.metaRow}>
            <Ionicons name="time-outline" size={13} color={textMuted} />
            <Text style={[s.metaText, { color: textMuted }]}>Last run: {lastRunTime}</Text>
            {durationSec && (
              <>
                <Text style={[s.metaDot, { color: textMuted }]}>·</Text>
                <Text style={[s.metaText, { color: textMuted }]}>{durationSec > 60 ? `${Math.round(durationSec / 60)}m` : `${durationSec}s`}</Text>
              </>
            )}
            {sections.length > 0 && (
              <>
                <Text style={[s.metaDot, { color: textMuted }]}>·</Text>
                <Text style={[s.metaText, { color: P.green }]}>{completedCount}/15 passed</Text>
              </>
            )}
          </View>
        )}

        {running && (
          <View style={s.metaRow}>
            <ActivityIndicator size="small" color={P.blue} style={{ transform: [{ scale: 0.7 }] }} />
            <Text style={[s.metaText, { color: P.blue }]}>
              Pipeline running — engine {Math.min(runningIdx + 1, 15)} of 15...
            </Text>
          </View>
        )}

        <Pressable
          onPress={handleRunPipeline}
          disabled={running}
          style={({ pressed }) => [s.runBtn, {
            opacity: running ? 0.6 : pressed ? 0.85 : 1,
          }]}
        >
          <LinearGradient
            colors={running ? [P.blue + 'CC', P.mint + 'CC'] : [P.mint, P.mintDark]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.runBtnGrad}
          >
            {running ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={s.runBtnText}>Pipeline Running...</Text>
              </>
            ) : (
              <>
                <Ionicons name="play-circle-outline" size={18} color="#fff" />
                <Text style={s.runBtnText}>
                  {job?.hasRun ? 'Re-run Pipeline' : 'Run 15-Engine Pipeline'}
                </Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </LinearGradient>

      {!running && job?.status === 'BLOCKED' && (() => {
        const v = controlVerdict?.verdict;
        const cj = v?.commercialJudgement || null;
        const blockReasons = (v?.blockReasons || []).filter(b => b && (b.description || b.message || b.code));
        const amberBg = isDark ? '#1A1400' : '#FFFBEB';
        const amberBgSoft = isDark ? '#2A1F00' : '#FEF3C7';
        const amberBorder = P.amber + '40';
        const principalBg = isDark ? '#1F1500' : '#FFF7E0';
        return (
          <View style={[s.planCard, { backgroundColor: amberBg, borderColor: amberBorder, paddingVertical: 14 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={[s.planIconWrap, { backgroundColor: P.amber + '20' }]}>
                <Ionicons name="warning-outline" size={18} color={P.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.planCardTitle, { color: P.amber }]}>Pipeline Blocked</Text>
                {!cj && (
                  <Text style={[{ fontSize: 12, lineHeight: 18, marginTop: 4, color: textSec }]} numberOfLines={4}>
                    {job.error || 'Pipeline was blocked — check engine results for details'}
                  </Text>
                )}
                {sections.length > 0 && (
                  <Text style={[{ fontSize: 11, marginTop: 4, color: textMuted }]}>
                    {completedCount} of 15 engines completed before block
                    {v?.executionMode ? ` · mode: ${v.executionMode}` : ''}
                  </Text>
                )}
              </View>
            </View>

            {blockReasons.length > 0 && (
              <View style={{ marginTop: 12, gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: P.amber, letterSpacing: 0.4 }}>
                  BLOCK REASONS · {blockReasons.length}
                </Text>
                {blockReasons.slice(0, 6).map((b, i) => {
                  const text = b.description || b.message;
                  const sevColor = b.severity === 'critical' ? P.coral : P.amber;
                  return (
                    <View key={i} style={{
                      flexDirection: 'row', gap: 8, alignItems: 'flex-start',
                      backgroundColor: amberBgSoft, borderRadius: 8, padding: 8,
                      borderLeftWidth: 3, borderLeftColor: sevColor,
                    }}>
                      <Ionicons name="alert-circle" size={13} color={sevColor} style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {b.code && (
                            <Text style={{ fontSize: 10, fontWeight: '700', color: sevColor, letterSpacing: 0.3 }}>
                              {b.code}
                            </Text>
                          )}
                          {b.severity && (
                            <Text style={{
                              fontSize: 9, fontWeight: '700', color: sevColor,
                              backgroundColor: sevColor + '20',
                              paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                              letterSpacing: 0.4, textTransform: 'uppercase',
                            }}>
                              {b.severity}
                            </Text>
                          )}
                          {b.source && (
                            <Text style={{ fontSize: 10, color: textMuted }}>· {b.source}</Text>
                          )}
                        </View>
                        {text && (
                          <Text style={{ fontSize: 12, lineHeight: 17, color: textPrimary, marginTop: 2 }}>
                            {text}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
                {blockReasons.length > 6 && (
                  <Text style={{ fontSize: 11, color: textMuted, fontStyle: 'italic' }}>
                    +{blockReasons.length - 6} more
                  </Text>
                )}
              </View>
            )}

            {cj?.principalCall && (
              <View style={{
                marginTop: 14,
                backgroundColor: principalBg,
                borderRadius: 10, padding: 12,
                borderWidth: 1, borderColor: P.amber + '50',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Ionicons name="person-circle-outline" size={15} color={P.amber} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: P.amber, letterSpacing: 0.5 }}>
                    PRINCIPAL CALL · CMO DIRECTIVE
                  </Text>
                </View>
                <Text style={{ fontSize: 13, lineHeight: 19, color: textPrimary, fontWeight: '500' }}>
                  {cj.principalCall}
                </Text>
              </View>
            )}

            {cj?.commercialReadinessAssessment && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: textSec, letterSpacing: 0.4, marginBottom: 4 }}>
                  COMMERCIAL READINESS
                </Text>
                <Text style={{ fontSize: 12, lineHeight: 18, color: textPrimary }}>
                  {cj.commercialReadinessAssessment}
                </Text>
              </View>
            )}

            {cj?.biggestRisk && (
              <View style={{
                marginTop: 12,
                flexDirection: 'row', gap: 8, alignItems: 'flex-start',
                backgroundColor: isDark ? '#1F0A0A' : '#FEF2F2',
                borderRadius: 8, padding: 10,
                borderLeftWidth: 3, borderLeftColor: P.coral,
              }}>
                <Ionicons name="flame-outline" size={14} color={P.coral} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: P.coral, letterSpacing: 0.4, marginBottom: 2 }}>
                    BIGGEST RISK
                  </Text>
                  <Text style={{ fontSize: 12, lineHeight: 17, color: textPrimary }}>
                    {cj.biggestRisk}
                  </Text>
                </View>
              </View>
            )}

            {Array.isArray(cj?.conditionsToUpgrade) && cj.conditionsToUpgrade.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: P.green, letterSpacing: 0.4, marginBottom: 6 }}>
                  CONDITIONS TO UPGRADE · {cj.conditionsToUpgrade.length}
                </Text>
                {cj.conditionsToUpgrade.map((c, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                    <Ionicons name="square-outline" size={13} color={P.green} style={{ marginTop: 2 }} />
                    <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: textPrimary }}>{c}</Text>
                  </View>
                ))}
              </View>
            )}

            {(Array.isArray(cj?.whatHumanReviewerWouldAsk) && cj.whatHumanReviewerWouldAsk.length > 0
              || Array.isArray(cj?.reasoningSteps) && cj.reasoningSteps.length > 0) && (
              <Pressable
                onPress={() => setShowJudgement(v => !v)}
                style={{
                  marginTop: 12,
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingVertical: 8, paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: isDark ? '#0F1419' : '#F4F7F5',
                  borderWidth: 1, borderColor: cardBorder,
                  alignSelf: 'flex-start',
                }}
              >
                <Ionicons
                  name={showJudgement ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={textSec}
                />
                <Text style={{ fontSize: 11, fontWeight: '600', color: textSec }}>
                  {showJudgement ? 'Hide reviewer detail' : 'Show reviewer detail'}
                </Text>
              </Pressable>
            )}

            {showJudgement && Array.isArray(cj?.whatHumanReviewerWouldAsk) && cj.whatHumanReviewerWouldAsk.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: textSec, letterSpacing: 0.4, marginBottom: 6 }}>
                  WHAT A HUMAN REVIEWER WOULD ASK
                </Text>
                {cj.whatHumanReviewerWouldAsk.map((q, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                    <Ionicons name="help-circle-outline" size={13} color={P.blue} style={{ marginTop: 2 }} />
                    <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: textPrimary }}>{q}</Text>
                  </View>
                ))}
              </View>
            )}

            {showJudgement && Array.isArray(cj?.reasoningSteps) && cj.reasoningSteps.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: textSec, letterSpacing: 0.4, marginBottom: 6 }}>
                  REASONING TRACE · {cj.reasoningSteps.length} STEPS
                </Text>
                {cj.reasoningSteps.map((step, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: textMuted, minWidth: 18, fontVariant: ['tabular-nums'] }}>
                      {i + 1}.
                    </Text>
                    <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: textSec }}>{step}</Text>
                  </View>
                ))}
              </View>
            )}

            {(() => {
              const rp = v?.recoveryPlan || null;
              if (!rp || !Array.isArray(rp.issues) || rp.issues.length === 0) return null;
              const issues = rp.issues;
              const recoveryBg = isDark ? '#0F1A14' : '#F0FDF4';
              const issueBg = isDark ? '#0A1F14' : '#ECFDF5';
              const proofBg = isDark ? '#0F1419' : '#F4F7F5';
              return (
                <View style={{
                  marginTop: 16,
                  backgroundColor: recoveryBg,
                  borderRadius: 10,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: P.green + '40',
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Ionicons name="medkit-outline" size={15} color={P.green} />
                    <Text style={{ fontSize: 10, fontWeight: '700', color: P.green, letterSpacing: 0.5 }}>
                      RECOVERY PLAN · {issues.length} ISSUE{issues.length === 1 ? '' : 'S'} · {(rp.source || 'deterministic').toUpperCase()}
                    </Text>
                    {rp.humanReviewNeeded && (
                      <Text style={{
                        fontSize: 9, fontWeight: '700', color: P.amber,
                        backgroundColor: P.amber + '20',
                        paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
                        letterSpacing: 0.4, textTransform: 'uppercase',
                      }}>
                        Human review
                      </Text>
                    )}
                  </View>

                  {rp.rootCauseSummary && (
                    <Text style={{ fontSize: 12, lineHeight: 17, color: textPrimary, marginBottom: 10 }}>
                      {rp.rootCauseSummary}
                    </Text>
                  )}

                  {issues.map((iss, idx) => {
                    const sevColor = iss.severity === 'critical' ? P.coral : P.amber;
                    return (
                      <View key={idx} style={{
                        backgroundColor: issueBg,
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 8,
                        borderLeftWidth: 3,
                        borderLeftColor: sevColor,
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                          <Text style={{
                            fontSize: 10, fontWeight: '700', color: textPrimary,
                            backgroundColor: isDark ? '#1A2A20' : '#D1FAE5',
                            paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
                            fontVariant: ['tabular-nums'],
                          }}>
                            #{iss.priority || idx + 1}
                          </Text>
                          {iss.ownerEngine && (
                            <Text style={{
                              fontSize: 10, fontWeight: '700', color: P.blue,
                              backgroundColor: P.blue + '20',
                              paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
                              letterSpacing: 0.3,
                            }}>
                              {iss.ownerEngine}
                            </Text>
                          )}
                          {iss.rootCauseCategory && (
                            <Text style={{
                              fontSize: 9, fontWeight: '600', color: textSec,
                              backgroundColor: isDark ? '#1A1F26' : '#E5E7EB',
                              paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
                              letterSpacing: 0.3, textTransform: 'uppercase',
                            }}>
                              {iss.rootCauseCategory.replace(/_/g, ' ')}
                            </Text>
                          )}
                          {iss.blockCode && (
                            <Text style={{ fontSize: 10, fontWeight: '700', color: sevColor, letterSpacing: 0.3 }}>
                              {iss.blockCode}
                            </Text>
                          )}
                        </View>

                        {iss.diagnosis && (
                          <View style={{ marginBottom: 6 }}>
                            <Text style={{ fontSize: 9, fontWeight: '700', color: textMuted, letterSpacing: 0.4, marginBottom: 2 }}>
                              DIAGNOSIS
                            </Text>
                            <Text style={{ fontSize: 12, lineHeight: 17, color: textPrimary }}>
                              {iss.diagnosis}
                            </Text>
                          </View>
                        )}

                        {iss.repairAction && (
                          <View style={{ marginBottom: 6 }}>
                            <Text style={{ fontSize: 9, fontWeight: '700', color: P.green, letterSpacing: 0.4, marginBottom: 2 }}>
                              REPAIR ACTION
                            </Text>
                            <Text style={{ fontSize: 12, lineHeight: 17, color: textPrimary }}>
                              {iss.repairAction}
                            </Text>
                          </View>
                        )}

                        {iss.successCriteria && (
                          <View style={{ marginBottom: 6 }}>
                            <Text style={{ fontSize: 9, fontWeight: '700', color: textMuted, letterSpacing: 0.4, marginBottom: 2 }}>
                              SUCCESS CRITERIA
                            </Text>
                            <Text style={{ fontSize: 11, lineHeight: 16, color: textSec }}>
                              {iss.successCriteria}
                            </Text>
                          </View>
                        )}

                        {Array.isArray(iss.requiredProof) && iss.requiredProof.length > 0 && (
                          <View style={{ marginTop: 4, marginBottom: 6 }}>
                            <Text style={{ fontSize: 9, fontWeight: '700', color: textMuted, letterSpacing: 0.4, marginBottom: 3 }}>
                              REQUIRED PROOF
                            </Text>
                            {iss.requiredProof.map((p, pi) => (
                              <View key={pi} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginBottom: 2 }}>
                                <Ionicons name="document-text-outline" size={11} color={textMuted} style={{ marginTop: 2 }} />
                                <Text style={{ flex: 1, fontSize: 11, lineHeight: 15, color: textSec }}>{p}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {iss.nextPossibleMode && (
                          <View style={{
                            marginTop: 4,
                            alignSelf: 'flex-start',
                            backgroundColor: P.green + '20',
                            paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5,
                            flexDirection: 'row', alignItems: 'center', gap: 4,
                          }}>
                            <Ionicons name="arrow-forward-circle-outline" size={11} color={P.green} />
                            <Text style={{ fontSize: 10, fontWeight: '700', color: P.green, letterSpacing: 0.3 }}>
                              NEXT MODE: {iss.nextPossibleMode}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {Array.isArray(rp.globalRecoveryPlan) && rp.globalRecoveryPlan.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: P.green, letterSpacing: 0.4, marginBottom: 6 }}>
                        GLOBAL RECOVERY SEQUENCE
                      </Text>
                      {rp.globalRecoveryPlan.map((step, i) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: P.green, minWidth: 18, fontVariant: ['tabular-nums'] }}>
                            {i + 1}.
                          </Text>
                          <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: textPrimary }}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {Array.isArray(rp.rerunRequirements) && rp.rerunRequirements.length > 0 && (
                    <View style={{
                      marginTop: 10,
                      backgroundColor: proofBg,
                      borderRadius: 8,
                      padding: 10,
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: textSec, letterSpacing: 0.4, marginBottom: 6 }}>
                        RE-RUN REQUIREMENTS · {rp.rerunRequirements.length}
                      </Text>
                      {rp.rerunRequirements.map((r, i) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                          <Ionicons name="checkbox-outline" size={13} color={textSec} style={{ marginTop: 1 }} />
                          <Text style={{ flex: 1, fontSize: 11, lineHeight: 16, color: textSec }}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        );
      })()}

      {!running && (job?.status === 'FAILED' || job?.status === 'ERROR') && job?.error && (
        <View style={[s.planCard, { backgroundColor: isDark ? '#1A0A0A' : '#FEF2F2', borderColor: P.coral + '40' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={[s.planIconWrap, { backgroundColor: P.coral + '20' }]}>
              <Ionicons name="close-circle-outline" size={18} color={P.coral} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.planCardTitle, { color: P.coral }]}>Pipeline Failed</Text>
              <Text style={[{ fontSize: 12, lineHeight: 18, marginTop: 4, color: textSec }]} numberOfLines={4}>
                {job.error}
              </Text>
            </View>
          </View>
        </View>
      )}

      {activePlan?.hasPlan && (
        <View style={[s.planCard, {
          backgroundColor: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
            ? (isDark ? '#1A1400' : '#FFFBEB')
            : (isDark ? '#0A1F12' : '#ECFDF5'),
          borderColor: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
            ? P.amber + '30'
            : P.green + '30',
        }]}>
          {(job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR') && (
            <View style={{
              backgroundColor: isDark ? P.amber + '15' : P.amber + '10',
              borderRadius: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              marginBottom: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}>
              <Ionicons name="time-outline" size={13} color={P.amber} />
              <Text style={{ fontSize: 11, color: P.amber, fontWeight: '600' }}>
                Showing last successful plan — current pipeline is {job?.status === 'BLOCKED' ? 'blocked' : 'failed'}
              </Text>
            </View>
          )}
          <View style={s.planCardRow}>
            <View style={s.planCardLeft}>
              <View style={[s.planIconWrap, {
                backgroundColor: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
                  ? P.amber + '20' : P.green + '20'
              }]}>
                <Ionicons name="document-text-outline" size={18}
                  color={(job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR') ? P.amber : P.green}
                />
              </View>
              <View>
                <Text style={[s.planCardTitle, { color: textPrimary }]}>
                  {(job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
                    ? 'Previous Plan' : 'Strategic Plan Ready'}
                </Text>
                <Text style={[s.planCardSub, { color: textSec }]}>
                  {activePlan.calendar?.total || 0} calendar entries
                  {activePlan.studio?.total ? ` · ${activePlan.studio.total} content pieces` : ''}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => setShowPlan(true)}
              style={[s.viewPlanBtn, {
                backgroundColor: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
                  ? P.amber + '20' : P.green + '20',
                borderColor: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR')
                  ? P.amber + '40' : P.green + '40',
              }]}
            >
              <Text style={[s.viewPlanText, {
                color: (job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR') ? P.amber : P.green
              }]}>View</Text>
              <Ionicons name="chevron-forward" size={14}
                color={(job?.status === 'BLOCKED' || job?.status === 'FAILED' || job?.status === 'ERROR') ? P.amber : P.green}
              />
            </Pressable>
          </View>
          {activePlan.goalDecomposition?.goalLabel && (
            <Text style={[s.planGoalText, { color: textSec }]} numberOfLines={2}>
              Goal: {activePlan.goalDecomposition.goalLabel}
            </Text>
          )}
        </View>
      )}

      {(sections.length > 0 || running) && (
        <View style={s.enginesSection}>
          <View style={s.enginesSectionHeader}>
            <Text style={[s.enginesSectionTitle, { color: textSec }]}>ENGINE RESULTS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {!running && sections.length > 0 && (
                <View style={s.completionPillRow}>
                  <View style={[s.completionPill, { backgroundColor: P.green + '15', borderColor: P.green + '30' }]}>
                    <Ionicons name="checkmark-circle" size={12} color={P.green} />
                    <Text style={[s.completionPillText, { color: P.green }]}>{completedCount} passed</Text>
                  </View>
                  {failedCount > 0 && (
                    <View style={[s.completionPill, { backgroundColor: P.coral + '15', borderColor: P.coral + '30' }]}>
                      <Ionicons name="close-circle" size={12} color={P.coral} />
                      <Text style={[s.completionPillText, { color: P.coral }]}>{failedCount} issues</Text>
                    </View>
                  )}
                </View>
              )}
              {!running && sections.length > 0 && (
                <Pressable
                  onPress={() => setShowTable(true)}
                  style={[s.tableBtn, { backgroundColor: P.blue + '18', borderColor: P.blue + '40' }]}
                >
                  <Ionicons name="grid-outline" size={13} color={P.blue} />
                  <Text style={[s.tableBtnText, { color: P.blue }]}>Full Table</Text>
                </Pressable>
              )}
            </View>
          </View>

          {ENGINE_ORDER.map((engineId, idx) => {
            const sec = sectionMap[engineId];
            const name = sec?.name || (ENGINE_META[engineId]?.shortName) || engineId;
            const status = sec?.status || (running && runningIdx > idx ? 'SUCCESS' : '');
            return (
              <EngineRow
                key={engineId}
                id={engineId}
                name={name}
                status={status}
                index={idx}
                isRunning={running}
                runningIdx={running ? runningIdx : -1}
                isDark={isDark}
                summary={sec?.summary}
              />
            );
          })}
        </View>
      )}

      {!running && !job?.hasRun && (
        <View style={[s.emptyState, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={[s.emptyIconWrap, { backgroundColor: P.mint + '15' }]}>
            <Ionicons name="git-network-outline" size={28} color={P.mint} />
          </View>
          <Text style={[s.emptyStateTitle, { color: textPrimary }]}>No pipeline run yet</Text>
          <Text style={[s.emptyStateSub, { color: textMuted }]}>
            Run the 15-engine strategic pipeline to generate your marketing plan. Each engine analyzes a different dimension of your market.
          </Text>
        </View>
      )}

      <EngineTableModal
        visible={showTable}
        onClose={() => setShowTable(false)}
        campaignId={selectedCampaignId || ''}
      />

      <Modal visible={showPlan} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.planModal, { backgroundColor: isDark ? P.darkBg : P.lightBg }]}>
          <View style={[s.planModalHeader, { borderBottomColor: isDark ? P.darkCardBorder : P.lightCardBorder }]}>
            <Text style={[s.planModalTitle, { color: textPrimary }]}>Strategic Plan</Text>
            <Pressable onPress={() => setShowPlan(false)} style={[s.closeBtn, { backgroundColor: isDark ? P.darkSurface : '#F0F0F5' }]}>
              <Ionicons name="close" size={20} color={textSec} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <PlanDocumentView onClose={() => setShowPlan(false)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
  },
  metaDot: {
    fontSize: 12,
    marginHorizontal: 1,
  },
  runBtn: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  runBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  runBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  planCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  planCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  planIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  planCardSub: {
    fontSize: 12,
    marginTop: 1,
  },
  viewPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  viewPlanText: {
    fontSize: 12,
    fontWeight: '600',
  },
  planGoalText: {
    fontSize: 12,
    lineHeight: 17,
  },
  enginesSection: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  enginesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  enginesSectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  completionPillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  completionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  completionPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  tableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
  },
  tableBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    gap: 10,
  },
  engineIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  engineInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  engineNum: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
    minWidth: 22,
  },
  engineName: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  engineSummary: {
    fontSize: 11,
    lineHeight: 15,
    paddingLeft: 30,
  },
  engineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 80,
    justifyContent: 'flex-end',
  },
  engineStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyState: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyStateTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  emptyStateSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  empty: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
  },
  planModal: {
    flex: 1,
  },
  planModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    paddingTop: Platform.OS === 'web' ? 80 : 16,
  },
  planModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkSurface: {
    backgroundColor: P.darkSurface,
  },
});
