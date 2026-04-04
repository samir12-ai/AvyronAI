import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';
import { getApiUrl, safeApiJson , authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

const C = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  teal: '#14B8A6',
  orange: '#F97316',
};

const FEASIBILITY_COLORS: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  feasible: { bg: '#D1FAE5', text: '#065F46', darkBg: '#064E3B', darkText: '#6EE7B7' },
  borderline: { bg: '#FEF3C7', text: '#92400E', darkBg: '#451A03', darkText: '#FCD34D' },
  unrealistic: { bg: '#FEE2E2', text: '#991B1B', darkBg: '#450A0A', darkText: '#FCA5A5' },
};

interface PlanDocumentViewProps {
  planId?: string;
  blueprintId?: string;
  onClose?: () => void;
}

export default function PlanDocumentView({ planId, blueprintId, onClose }: PlanDocumentViewProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planData, setPlanData] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedRiskIdx, setExpandedRiskIdx] = useState<number | null>(null);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1F2937' : '#E2E8F0';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const surfaceBg = isDark ? '#111827' : '#F8FAFC';

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const campaignId = selectedCampaign?.selectedCampaignId || '';
      if (!campaignId) {
        setError('No campaign selected.');
        setLoading(false);
        return;
      }

      const activeUrl = getApiUrl(`/api/plans/active/${encodeURIComponent(campaignId)}`);
      const activeRes = await authFetch(activeUrl);
      const activeData = await safeApiJson(activeRes);

      if (!activeRes.ok || !activeData.hasPlan) {
        setError('No active plan found. Build a plan first.');
        setLoading(false);
        return;
      }

      let docData: any = null;
      if (activeData.plan?.id) {
        try {
          const docUrl = getApiUrl(`/api/plans/${activeData.plan.id}/document?campaignId=${encodeURIComponent(campaignId)}`);
          const docRes = await authFetch(docUrl);
          const docJson = await safeApiJson(docRes);
          if (docRes.ok && docJson.success) {
            docData = docJson;
          }
        } catch {}
      }

      setPlanData({ ...activeData, documentData: docData });
    } catch (err: any) {
      setError(err.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  const toggle = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const safeStr = (v: any): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const safeArr = (v: any): any[] => Array.isArray(v) ? v : [];

  if (loading) {
    return (
      <View style={st.stateContainer}>
        <ActivityIndicator size="large" color={C.mint} />
        <Text style={[st.stateText, { color: textSecondary }]}>Loading plan...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={st.stateContainer}>
        <Ionicons name="cloud-offline-outline" size={28} color={textSecondary} />
        <Text style={[st.stateText, { color: textSecondary }]}>{error}</Text>
        <Pressable onPress={fetchPlan} style={[st.retryBtn, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
          <Ionicons name="refresh" size={14} color={C.mint} />
          <Text style={st.retryBtnText}>Retry</Text>
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={{ marginTop: 8 }}>
            <Text style={{ color: textSecondary, fontSize: 13 }}>Close</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!planData) return null;

  const plan = planData.plan;
  const goalDecomp = planData.goalDecomposition;
  const simulation = planData.simulation;
  const executionTasks = planData.executionTasks;
  const assumptions = planData.assumptions || [];
  const work = planData.requiredWork;
  const calendar = planData.calendar;
  const docContent = planData.documentData?.document?.contentJson || {};

  const statusLabel = plan?.status?.replace(/_/g, ' ') || 'DRAFT';
  const isActive = ['APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'SCHEDULED', 'PUBLISHED'].includes(plan?.status);
  const feasColor = FEASIBILITY_COLORS[goalDecomp?.feasibility] || FEASIBILITY_COLORS.borderline;

  const renderGoalBlock = () => {
    if (!goalDecomp) return null;
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <LinearGradient
          colors={isDark ? ['#1E1B4B', '#312E81'] : ['#EDE9FE', '#DDD6FE']}
          style={st.cardGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={st.goalHeader}>
            <View style={st.goalIconWrap}>
              <Ionicons name="flag" size={20} color={C.mint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.goalLabel, { color: isDark ? '#E0E7FF' : '#312E81' }]}>{goalDecomp.goalLabel}</Text>
              <View style={st.goalMetaRow}>
                <View style={[st.metaChip, { backgroundColor: '#ffffff20' }]}>
                  <Ionicons name="time-outline" size={11} color={isDark ? '#C4B5FD' : '#6D28D9'} />
                  <Text style={[st.metaChipText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>{goalDecomp.timeHorizonDays} days</Text>
                </View>
                <View style={[st.metaChip, { backgroundColor: '#ffffff20' }]}>
                  <Ionicons name="analytics-outline" size={11} color={isDark ? '#C4B5FD' : '#6D28D9'} />
                  <Text style={[st.metaChipText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>{goalDecomp.goalType?.replace(/_/g, ' ')}</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={st.feasRow}>
            <View style={[st.feasBadge, { backgroundColor: isDark ? feasColor.darkBg : feasColor.bg }]}>
              <Ionicons
                name={goalDecomp.feasibility === 'feasible' ? 'checkmark-circle' : goalDecomp.feasibility === 'borderline' ? 'alert-circle' : 'close-circle'}
                size={13}
                color={isDark ? feasColor.darkText : feasColor.text}
              />
              <Text style={[st.feasText, { color: isDark ? feasColor.darkText : feasColor.text }]}>
                {goalDecomp.feasibility?.toUpperCase()}
              </Text>
            </View>
            <View style={st.scoreRow}>
              <Text style={[st.scoreLabel, { color: isDark ? '#A5B4FC' : '#6D28D9' }]}>Score</Text>
              <Text style={[st.scoreValue, { color: isDark ? '#E0E7FF' : '#312E81' }]}>{goalDecomp.feasibilityScore}/100</Text>
            </View>
            <View style={st.scoreRow}>
              <Text style={[st.scoreLabel, { color: isDark ? '#A5B4FC' : '#6D28D9' }]}>Confidence</Text>
              <Text style={[st.scoreValue, { color: isDark ? '#E0E7FF' : '#312E81' }]}>{goalDecomp.confidenceScore}/100</Text>
            </View>
          </View>
        </LinearGradient>
      </View>
    );
  };

  const renderWhyThisPlan = () => {
    const explanation = goalDecomp?.feasibilityExplanation || plan?.summary;
    if (!explanation) return null;
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.sectionHead}>
          <Ionicons name="bulb-outline" size={18} color={C.gold} />
          <Text style={[st.sectionTitle, { color: textPrimary }]}>Why This Plan Works</Text>
        </View>
        <Text style={[st.bodyText, { color: textSecondary }]}>{explanation}</Text>
        {goalDecomp?.assumptions && safeArr(goalDecomp.assumptions).length > 0 && (
          <View style={{ marginTop: 10 }}>
            <Text style={[st.subLabel, { color: textPrimary }]}>Key Assumptions</Text>
            {safeArr(goalDecomp.assumptions).slice(0, 4).map((a: any, i: number) => (
              <View key={i} style={st.assumptionRow}>
                <View style={[st.assumptionDot, { backgroundColor: C.gold }]} />
                <Text style={[st.assumptionText, { color: textSecondary }]}>{typeof a === 'string' ? a : safeStr(a)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderNumbersThatMatter = () => {
    const funnel = goalDecomp?.funnelMath;
    if (!funnel) return null;

    const pipelineSteps = [
      { label: 'Reach', value: funnel.requiredReach ?? funnel.topOfFunnel ?? 0, icon: 'megaphone-outline', color: C.blue },
      { label: 'Clicks', value: funnel.requiredClicks ?? 0, icon: 'hand-left-outline', color: '#818CF8' },
      { label: 'Conversations', value: funnel.requiredConversations ?? 0, icon: 'chatbubbles-outline', color: C.gold },
      { label: 'Leads', value: funnel.requiredLeads ?? funnel.middleFunnel ?? 0, icon: 'people-outline', color: C.teal },
      { label: 'Qualified', value: funnel.requiredQualifiedLeads ?? 0, icon: 'person-outline', color: C.orange },
      { label: 'Closed', value: funnel.requiredClosedClients ?? 0, icon: 'checkmark-circle-outline', color: C.neon },
    ];

    const rateItems = [
      { label: 'CTR', value: funnel.ctr != null ? `${(funnel.ctr * 100).toFixed(1)}%` : '2.5%', isDefault: funnel.ctr == null },
      { label: 'Click→Conv', value: funnel.clickToConversationRate != null ? `${(funnel.clickToConversationRate * 100).toFixed(0)}%` : '30%', isDefault: funnel.clickToConversationRate == null },
      { label: 'Conv→Lead', value: funnel.conversationToLeadRate != null ? `${(funnel.conversationToLeadRate * 100).toFixed(0)}%` : '50%', isDefault: funnel.conversationToLeadRate == null },
      { label: 'Qualify', value: '20%', isDefault: true },
      { label: 'Close Rate', value: funnel.closeRate != null ? `${(funnel.closeRate * 100).toFixed(1)}%` : '10%', isDefault: funnel.closeRate == null },
    ];

    const hasDefaults = rateItems.some(r => r.isDefault);

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.sectionHead}>
          <Ionicons name="calculator-outline" size={18} color={C.teal} />
          <Text style={[st.sectionTitle, { color: textPrimary }]}>Full Funnel Pipeline</Text>
        </View>
        <View style={st.numbersGrid}>
          {pipelineSteps.map((s, i) => (
            <View key={i} style={[st.numberCard, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
              <Ionicons name={s.icon as any} size={16} color={s.color} />
              <Text style={[st.numberValue, { color: s.value === 0 ? textSecondary : textPrimary }]}>
                {s.value === 0 ? '—' : s.value.toLocaleString()}
              </Text>
              <Text style={[st.numberLabel, { color: textSecondary }]}>{s.label}</Text>
            </View>
          ))}
        </View>
        <View style={[st.rateRow, { borderTopColor: cardBorder }]}>
          {rateItems.map((r, i) => (
            <View key={i} style={st.rateItem}>
              <Text style={[st.rateValue, { color: r.isDefault ? textSecondary : C.mint }]}>{r.value}</Text>
              <Text style={[st.rateLabel, { color: textSecondary }]}>{r.label}</Text>
              {r.isDefault && (
                <Text style={{ fontSize: 8, color: textSecondary, textAlign: 'center' }}>default</Text>
              )}
            </View>
          ))}
        </View>
        {hasDefaults && (
          <Text style={{ fontSize: 11, color: textSecondary, marginTop: 8, fontStyle: 'italic' }}>
            Rates marked "default" use industry averages. Update your Business Profile to refine these numbers.
          </Text>
        )}
      </View>
    );
  };

  const renderGrowthSimulation = () => {
    if (!simulation) return null;
    const scenarios = [
      { key: 'Conservative', data: simulation.conservativeCase, color: C.coral, icon: 'trending-down-outline' },
      { key: 'Base Case', data: simulation.baseCase, color: C.blue, icon: 'remove-outline' },
      { key: 'Upside', data: simulation.upsideCase, color: C.neon, icon: 'trending-up-outline' },
    ].filter(s => s.data);

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.sectionHead}>
          <Ionicons name="bar-chart-outline" size={18} color={C.blue} />
          <Text style={[st.sectionTitle, { color: textPrimary }]}>Growth Simulation</Text>
          <View style={[st.confBadge, { backgroundColor: C.blue + '20' }]}>
            <Text style={[st.confText, { color: C.blue }]}>{simulation.confidenceScore}% conf.</Text>
          </View>
        </View>
        {scenarios.map((sc, i) => {
          const d = sc.data;
          const mainMetric = d.expectedCustomers || d.expectedLeads || d.expectedRevenue || d.expectedReach || 'N/A';
          const achievement = d.achievementPct || (i === 0 ? 70 : i === 1 ? 100 : 115);
          return (
            <View key={i} style={[st.scenarioRow, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
              <View style={[st.scenarioIcon, { backgroundColor: sc.color + '15' }]}>
                <Ionicons name={sc.icon as any} size={16} color={sc.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.scenarioLabel, { color: textPrimary }]}>{sc.key}</Text>
                {d.lever && <Text style={[st.scenarioDesc, { color: textSecondary }]} numberOfLines={2}>{d.lever}</Text>}
                {!d.lever && d.summary && <Text style={[st.scenarioDesc, { color: textSecondary }]} numberOfLines={1}>{d.summary}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' as const }}>
                <Text style={[st.scenarioValue, { color: sc.color }]}>
                  {typeof mainMetric === 'number' ? mainMetric.toLocaleString() : mainMetric}
                </Text>
                <Text style={[st.scenarioPct, { color: textSecondary }]}>{achievement}%</Text>
              </View>
            </View>
          );
        })}
        {simulation.highestLeverageDriver && (
          <View style={[st.leverStrip, { backgroundColor: isDark ? '#064E3B' : '#D1FAE5' }]}>
            <Ionicons name="flash-outline" size={13} color={isDark ? '#6EE7B7' : '#065F46'} />
            <Text style={[st.leverText, { color: isDark ? '#6EE7B7' : '#065F46' }]}>
              Highest Leverage: {simulation.highestLeverageDriver}
            </Text>
          </View>
        )}
        {simulation.bottleneckAlerts && safeArr(simulation.bottleneckAlerts).length > 0 && (
          <View style={[st.alertStrip, { backgroundColor: isDark ? '#451A03' : '#FEF3C7' }]}>
            <Ionicons name="warning-outline" size={13} color={C.gold} />
            <Text style={[st.alertText, { color: isDark ? '#FCD34D' : '#92400E' }]}>
              {safeArr(simulation.bottleneckAlerts).slice(0, 2).join(' · ')}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderContentDistribution = () => {
    const distData = docContent.contentDistributionPlan;
    if (!distData) return null;
    const platforms = safeArr(distData.platforms);
    if (platforms.length === 0) return null;

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Pressable onPress={() => toggle('content')} style={st.sectionHead}>
          <Ionicons name="megaphone-outline" size={18} color={C.mint} />
          <Text style={[st.sectionTitle, { color: textPrimary, flex: 1 }]}>Execution Blueprint</Text>
          <Ionicons name={expandedSections.content ? 'chevron-up' : 'chevron-down'} size={16} color={textSecondary} />
        </Pressable>
        {expandedSections.content && (
          <View style={st.expandedBody}>
            {platforms.map((p: any, i: number) => (
              <View key={i} style={[st.detailCard, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
                <View style={st.platformHeader}>
                  <View style={[st.platformDot, { backgroundColor: C.mint }]} />
                  <Text style={[st.detailTitle, { color: textPrimary }]}>{safeStr(p.platform)}</Text>
                  <Text style={[st.freqLabel, { color: C.mint }]}>{safeStr(p.frequency)}</Text>
                </View>
                {safeArr(p.contentTypes).map((ct: any, j: number) => (
                  <View key={j} style={st.detailRow}>
                    <Text style={[st.detailLabel, { color: textSecondary }]}>{safeStr(ct.type)}</Text>
                    <Text style={[st.detailValue, { color: textPrimary }]}>{safeStr(ct.percentage)} · {safeStr(ct.weeklyCount)}/wk</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderWeeklyRhythm = () => {
    if (!work) return null;
    const items = [
      { label: 'Reels', count: work.reels?.perWeek, icon: 'videocam-outline', color: C.coral },
      { label: 'Posts', count: work.posts?.perWeek, icon: 'image-outline', color: C.blue },
      { label: 'Stories', count: work.stories?.perDay ? `${work.stories.perDay}/day` : 0, icon: 'layers-outline', color: C.teal },
      { label: 'Carousels', count: work.carousels?.perWeek, icon: 'albums-outline', color: C.orange },
      { label: 'Videos', count: work.videos?.perWeek, icon: 'film-outline', color: C.mint },
    ].filter(i => i.count && i.count !== 0);

    if (items.length === 0) return null;

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.sectionHead}>
          <Ionicons name="calendar-outline" size={18} color={C.orange} />
          <Text style={[st.sectionTitle, { color: textPrimary }]}>Weekly Rhythm</Text>
        </View>
        <View style={st.rhythmGrid}>
          {items.map((item, i) => (
            <View key={i} style={[st.rhythmCard, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
              <Ionicons name={item.icon as any} size={16} color={item.color} />
              <Text style={[st.rhythmCount, { color: textPrimary }]}>{item.count}</Text>
              <Text style={[st.rhythmLabel, { color: textSecondary }]}>{item.label}</Text>
            </View>
          ))}
        </View>
        {work && (
          <View style={st.progressSection}>
            <View style={st.progressHeader}>
              <Text style={[st.progressLabel, { color: textSecondary }]}>Overall Progress</Text>
              <Text style={[st.progressValue, { color: C.mint }]}>
                {Math.round(((work.generated + work.ready + work.published) / Math.max(work.totalPieces, 1)) * 100)}%
              </Text>
            </View>
            <View style={[st.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E5EBE7' }]}>
              <View style={[st.progressFill, { width: `${Math.min(100, Math.round(((work.generated + work.ready + work.published) / Math.max(work.totalPieces, 1)) * 100))}%`, backgroundColor: C.mint }]} />
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderTaskQueue = () => {
    if (!executionTasks || executionTasks.total === 0) return null;
    const byStatus = executionTasks.byStatus || {};
    const todayTasks = safeArr(executionTasks.today);

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Pressable onPress={() => toggle('tasks')} style={st.sectionHead}>
          <Ionicons name="list-outline" size={18} color={C.neon} />
          <Text style={[st.sectionTitle, { color: textPrimary, flex: 1 }]}>Task Queue</Text>
          <View style={[st.confBadge, { backgroundColor: C.neon + '20' }]}>
            <Text style={[st.confText, { color: C.neon }]}>{executionTasks.total} tasks</Text>
          </View>
          <Ionicons name={expandedSections.tasks ? 'chevron-up' : 'chevron-down'} size={16} color={textSecondary} />
        </Pressable>

        <View style={st.taskStatusRow}>
          <View style={[st.taskStatusChip, { backgroundColor: C.gold + '15' }]}>
            <Text style={[st.taskStatusNum, { color: C.gold }]}>{byStatus.pending || 0}</Text>
            <Text style={[st.taskStatusLabel, { color: textSecondary }]}>Pending</Text>
          </View>
          <View style={[st.taskStatusChip, { backgroundColor: C.blue + '15' }]}>
            <Text style={[st.taskStatusNum, { color: C.blue }]}>{byStatus.inProgress || 0}</Text>
            <Text style={[st.taskStatusLabel, { color: textSecondary }]}>Active</Text>
          </View>
          <View style={[st.taskStatusChip, { backgroundColor: C.neon + '15' }]}>
            <Text style={[st.taskStatusNum, { color: C.neon }]}>{byStatus.completed || 0}</Text>
            <Text style={[st.taskStatusLabel, { color: textSecondary }]}>Done</Text>
          </View>
          <View style={[st.taskStatusChip, { backgroundColor: C.coral + '15' }]}>
            <Text style={[st.taskStatusNum, { color: C.coral }]}>{byStatus.blocked || 0}</Text>
            <Text style={[st.taskStatusLabel, { color: textSecondary }]}>Blocked</Text>
          </View>
        </View>

        {expandedSections.tasks && todayTasks.length > 0 && (
          <View style={st.expandedBody}>
            <Text style={[st.subLabel, { color: textPrimary }]}>Priority Tasks</Text>
            {todayTasks.map((t: any, i: number) => (
              <View key={i} style={[st.taskItem, { borderColor: cardBorder }]}>
                <View style={[st.taskDot, {
                  backgroundColor: t.status === 'completed' ? C.neon : t.status === 'blocked' ? C.coral : C.gold
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[st.taskTitle, { color: textPrimary }]}>{t.title}</Text>
                  <View style={st.taskMeta}>
                    <Text style={[st.taskType, { color: textSecondary }]}>{t.type?.replace(/_/g, ' ')}</Text>
                    <Text style={[st.taskPriority, { color: t.priority === 'high' ? C.coral : C.blue }]}>
                      {t.priority}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderCalendarSync = () => {
    if (!calendar || calendar.total === 0) return null;
    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.sectionHead}>
          <Ionicons name="calendar-outline" size={18} color={C.blue} />
          <Text style={[st.sectionTitle, { color: textPrimary }]}>Calendar Sync</Text>
        </View>
        <View style={st.calendarRow}>
          <View style={st.calendarStat}>
            <Text style={[st.calendarNum, { color: textPrimary }]}>{calendar.total}</Text>
            <Text style={[st.calendarLabel, { color: textSecondary }]}>Scheduled</Text>
          </View>
          <View style={st.calendarStat}>
            <Text style={[st.calendarNum, { color: C.gold }]}>{calendar.pending}</Text>
            <Text style={[st.calendarLabel, { color: textSecondary }]}>Pending</Text>
          </View>
          <View style={st.calendarStat}>
            <Text style={[st.calendarNum, { color: C.neon }]}>{calendar.completed}</Text>
            <Text style={[st.calendarLabel, { color: textSecondary }]}>Published</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderDiagnostics = () => {
    const planSections = plan?.sections || {};
    const hasCreativeTesting = docContent.creativeTestingMatrix && safeArr(docContent.creativeTestingMatrix.tests || docContent.creativeTestingMatrix.experiments).length > 0;

    const mergeObj = (a: any, b: any) => {
      if (!a) return b || {};
      if (!b) return a;
      const merged: any = { ...a };
      for (const k of Object.keys(b)) {
        if (Array.isArray(b[k]) && b[k].length > 0) {
          merged[k] = Array.isArray(a[k]) && a[k].length > 0 ? a[k] : b[k];
        } else if (b[k] && !merged[k]) {
          merged[k] = b[k];
        }
      }
      return merged;
    };

    const compWatch = mergeObj(docContent.competitiveWatchTargets, planSections.competitiveWatch);
    const hasCompetitiveWatch = safeArr(compWatch.competitors || compWatch.targets).length > 0 || safeArr(compWatch.strategyFeed).length > 0;
    const riskData = mergeObj(docContent.riskMonitoringTriggers, planSections.riskTriggers);
    const hasRiskTriggers = safeArr(riskData.triggers || riskData.risks).length > 0 || safeArr(riskData.earlyWarningSystem).length > 0;
    const budgetData = docContent.budgetAllocationStructure || planSections.budgetAllocation;
    const hasBudget = !!budgetData;
    const kpiData = docContent.kpiMonitoringPriority || planSections.kpiMonitoring;
    const hasKpi = !!kpiData;
    const hasAssumptions = assumptions.length > 0;
    const dnaLinkData = planSections.executionBlueprintDnaLink || docContent.executionBlueprintDnaLink;
    const hasDnaLink = dnaLinkData && safeArr(dnaLinkData.contentPillarToDna).length > 0;

    if (!hasCreativeTesting && !hasCompetitiveWatch && !hasRiskTriggers && !hasBudget && !hasKpi && !hasAssumptions && !hasDnaLink) return null;

    const isExpanded = expandedSections.diagnostics;

    return (
      <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Pressable onPress={() => toggle('diagnostics')} style={st.sectionHead}>
          <Ionicons name="construct-outline" size={18} color={textSecondary} />
          <Text style={[st.sectionTitle, { color: textPrimary, flex: 1 }]}>Diagnostics</Text>
          <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={textSecondary} />
        </Pressable>

        {isExpanded && (
          <View style={st.expandedBody}>
            {hasBudget && renderDiagBudget(budgetData)}
            {hasKpi && renderDiagKpi(kpiData)}
            {hasCompetitiveWatch && renderDiagCompetitive(compWatch)}
            {hasRiskTriggers && renderDiagRisk(riskData)}
            {hasDnaLink && renderDiagDnaLink(dnaLinkData)}
            {hasCreativeTesting && renderDiagTesting(docContent.creativeTestingMatrix)}
            {hasAssumptions && renderDiagAssumptions()}
          </View>
        )}
      </View>
    );
  };

  const renderDiagBudget = (data: any) => {
    const total = safeStr(data.totalBudget || data.totalRecommended || data.total || 'N/A');
    const cats = safeArr(data.categories || data.breakdown);
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="wallet-outline" size={14} color={C.teal} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Budget: {total}</Text>
        </View>
        {cats.map((c: any, i: number) => (
          <View key={i} style={st.detailRow}>
            <Text style={[st.detailLabel, { color: textSecondary }]}>{safeStr(c.category || c.name)}</Text>
            <Text style={[st.detailValue, { color: textPrimary }]}>{safeStr(c.percentage || c.percent)}%</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderDiagKpi = (data: any) => {
    const primary = safeArr(data.primaryKPIs || data.primaryMetrics || data.primary);
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="analytics-outline" size={14} color={C.gold} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>KPI Targets</Text>
        </View>
        {primary.map((m: any, i: number) => (
          <View key={i} style={st.detailRow}>
            <Text style={[st.detailLabel, { color: textSecondary }]}>{safeStr(m.kpi || m.metric || m.name)}</Text>
            <Text style={[st.detailValue, { color: textPrimary }]}>{safeStr(m.target)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderDiagCompetitive = (data: any) => {
    const targets = safeArr(data.competitors || data.targets);
    const strategyFeed = safeArr(data.strategyFeed);
    const priorityColors: Record<string, string> = { high: C.coral, medium: C.gold, low: C.teal };
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="eye-outline" size={14} color={C.blue} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Competitive Watch</Text>
        </View>
        {targets.map((c: any, i: number) => (
          <View key={i} style={st.detailRow}>
            <Text style={[st.detailLabel, { color: textSecondary }]}>{safeStr(c.competitor || c.name)}</Text>
            <Text style={[st.detailValue, { color: textPrimary }]}>{safeStr(c.checkFrequency || 'Weekly')}</Text>
          </View>
        ))}
        {strategyFeed.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[st.subLabel, { color: textPrimary, fontSize: 11 }]}>Strategy Feed</Text>
            {strategyFeed.map((sf: any, i: number) => (
              <View key={i} style={[st.feedCard, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
                <View style={st.feedHeader}>
                  <View style={[st.priorityDot, { backgroundColor: priorityColors[sf.priority] || C.blue }]} />
                  <Text style={[st.feedInsight, { color: textPrimary }]}>{safeStr(sf.insight)}</Text>
                </View>
                <Text style={[st.feedResponse, { color: textSecondary }]}>{safeStr(sf.actionableResponse)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderDiagRisk = (data: any) => {
    const risks = safeArr(data.triggers || data.risks);
    const earlyWarnings = safeArr(data.earlyWarningSystem);
    const sevColors: Record<string, string> = { critical: C.coral, high: C.gold, medium: C.blue, low: C.teal };
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="warning-outline" size={14} color={C.coral} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Risk Triggers</Text>
        </View>
        {risks.map((r: any, i: number) => {
          const sev = safeStr(r.severity || 'medium').toLowerCase();
          const hasPlaybook = !!r.optimizationPlaybook;
          const isOpen = expandedRiskIdx === i;
          return (
            <View key={i}>
              <Pressable onPress={() => hasPlaybook && setExpandedRiskIdx(isOpen ? null : i)} style={st.detailRow}>
                <Text style={[st.detailLabel, { color: textSecondary, flex: 1 }]}>{safeStr(r.trigger)}</Text>
                <Text style={[st.detailValue, { color: sevColors[sev] || C.blue }]}>{sev}</Text>
                {hasPlaybook && <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={12} color={textSecondary} style={{ marginLeft: 4 }} />}
              </Pressable>
              {isOpen && r.optimizationPlaybook && (
                <View style={[st.playbookBox, { backgroundColor: isDark ? '#1E1B4B' : '#EDE9FE', borderColor: cardBorder }]}>
                  <Text style={[st.playbookLabel, { color: isDark ? '#A5B4FC' : '#6D28D9' }]}>Optimization Playbook</Text>
                  <Text style={[st.playbookText, { color: textSecondary }]}>{r.optimizationPlaybook}</Text>
                </View>
              )}
            </View>
          );
        })}
        {earlyWarnings.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[st.subLabel, { color: textPrimary, fontSize: 11 }]}>Early Warning System</Text>
            {earlyWarnings.map((ew: any, i: number) => (
              <View key={i} style={[st.feedCard, { backgroundColor: isDark ? '#451A03' : '#FEF3C7', borderColor: cardBorder }]}>
                <View style={st.feedHeader}>
                  <Ionicons name="radio-outline" size={12} color={C.gold} />
                  <Text style={[st.feedInsight, { color: textPrimary }]}>{safeStr(ew.signal)}</Text>
                </View>
                <Text style={[st.feedResponse, { color: textSecondary }]}>Threshold: {safeStr(ew.threshold)} → {safeStr(ew.response)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderDiagDnaLink = (data: any) => {
    const pillars = safeArr(data.contentPillarToDna);
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="git-merge-outline" size={14} color={C.mint} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Blueprint ↔ DNA</Text>
        </View>
        {pillars.map((p: any, i: number) => (
          <View key={i} style={[st.feedCard, { backgroundColor: surfaceBg, borderColor: cardBorder }]}>
            <Text style={[st.feedInsight, { color: textPrimary }]}>{safeStr(p.pillar)}</Text>
            <View style={st.dnaLinkRow}>
              <Text style={[st.dnaLinkLabel, { color: textSecondary }]}>Hook: {safeStr(p.hookApproach)}</Text>
              <Text style={[st.dnaLinkLabel, { color: textSecondary }]}>CTA: {safeStr(p.ctaStyle)}</Text>
            </View>
            {safeArr(p.dnaElements).length > 0 && (
              <View style={st.dnaChipRow}>
                {safeArr(p.dnaElements).map((el: string, j: number) => (
                  <View key={j} style={[st.dnaChip, { backgroundColor: C.mint + '15' }]}>
                    <Text style={[st.dnaChipText, { color: C.mint }]}>{el}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
        {data.weeklyDnaApplication && (
          <Text style={[st.feedResponse, { color: textSecondary, marginTop: 6 }]}>{data.weeklyDnaApplication}</Text>
        )}
      </View>
    );
  };

  const renderDiagTesting = (data: any) => {
    const tests = safeArr(data.tests || data.experiments);
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="flask-outline" size={14} color={C.mint} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Creative Testing</Text>
        </View>
        {tests.map((t: any, i: number) => (
          <View key={i} style={st.detailRow}>
            <Text style={[st.detailLabel, { color: textSecondary, flex: 1 }]}>{safeStr(t.testName || t.name)}</Text>
            <Text style={[st.detailValue, { color: textPrimary }]}>{safeStr(t.duration || t.timeline)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderDiagAssumptions = () => {
    const highImpact = assumptions.filter((a: any) => a.impactSeverity === 'high');
    const others = assumptions.filter((a: any) => a.impactSeverity !== 'high');
    return (
      <View style={st.diagSection}>
        <View style={st.diagHead}>
          <Ionicons name="help-circle-outline" size={14} color={C.orange} />
          <Text style={[st.diagTitle, { color: textPrimary }]}>Assumptions ({assumptions.length})</Text>
        </View>
        {highImpact.map((a: any, i: number) => (
          <View key={`h${i}`} style={st.assumptionRow}>
            <View style={[st.assumptionDot, { backgroundColor: C.coral }]} />
            <Text style={[st.assumptionText, { color: textSecondary }]}>{a.assumption}</Text>
            <Text style={[st.confBadgeSmall, { color: C.coral }]}>HIGH</Text>
          </View>
        ))}
        {others.slice(0, 3).map((a: any, i: number) => (
          <View key={`o${i}`} style={st.assumptionRow}>
            <View style={[st.assumptionDot, { backgroundColor: C.gold }]} />
            <Text style={[st.assumptionText, { color: textSecondary }]}>{a.assumption}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View>
      {onClose && (
        <Pressable onPress={onClose} style={st.backBtn}>
          <Ionicons name="arrow-back" size={18} color={textPrimary} />
          <Text style={[st.backBtnText, { color: textPrimary }]}>Back</Text>
        </Pressable>
      )}

      <View style={[st.headerStrip, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={st.headerRow}>
          <View style={st.headerIconWrap}>
            <Ionicons name="rocket" size={20} color={C.mint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.headerTitle, { color: textPrimary }]}>Operations Center</Text>
            <Text style={[st.headerSub, { color: textSecondary }]}>
              {planData.documentData?.document?.version ? `v${planData.documentData.document.version} · ` : ''}
              {plan?.createdAt ? new Date(plan.createdAt).toLocaleDateString() : ''}
            </Text>
          </View>
          <View style={[st.statusPill, { backgroundColor: isActive ? C.neon + '20' : C.gold + '20' }]}>
            <View style={[st.statusDot, { backgroundColor: isActive ? C.neon : C.gold }]} />
            <Text style={[st.statusText, { color: isActive ? C.neon : C.gold }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>

      {renderGoalBlock()}
      {renderWhyThisPlan()}
      {renderNumbersThatMatter()}
      {renderGrowthSimulation()}
      {renderContentDistribution()}
      {renderWeeklyRhythm()}
      {renderTaskQueue()}
      {renderCalendarSync()}
      {renderDiagnostics()}
    </View>
  );
}

const st = StyleSheet.create({
  stateContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  stateText: { fontSize: 13, textAlign: 'center' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginTop: 4 },
  retryBtnText: { color: '#8B5CF6', fontWeight: '600' as const, fontSize: 13 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 14, fontWeight: '600' as const },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  cardGradient: { padding: 16 },
  headerStrip: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#8B5CF620', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontWeight: '500' as const, marginTop: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.3 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const },
  bodyText: { fontSize: 13, lineHeight: 20, paddingHorizontal: 14, paddingBottom: 14 },
  subLabel: { fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  goalIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#ffffff20', justifyContent: 'center', alignItems: 'center' },
  goalLabel: { fontSize: 16, fontWeight: '800' as const, letterSpacing: -0.3 },
  goalMetaRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  metaChipText: { fontSize: 11, fontWeight: '500' as const },
  feasRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  feasBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  feasText: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.3 },
  scoreRow: { alignItems: 'center' as const },
  scoreLabel: { fontSize: 10, fontWeight: '500' as const },
  scoreValue: { fontSize: 16, fontWeight: '800' as const },
  numbersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  numberCard: { flex: 1, minWidth: 90, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center' as const, gap: 4 },
  numberValue: { fontSize: 16, fontWeight: '800' as const },
  numberLabel: { fontSize: 10, textAlign: 'center' as const },
  confBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 'auto' as any },
  confText: { fontSize: 11, fontWeight: '600' as const },
  scenarioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 14, marginBottom: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  scenarioIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  scenarioLabel: { fontSize: 13, fontWeight: '700' as const },
  scenarioDesc: { fontSize: 11, marginTop: 2 },
  scenarioValue: { fontSize: 16, fontWeight: '800' as const },
  scenarioPct: { fontSize: 10, marginTop: 1 },
  alertStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, marginHorizontal: 14, marginBottom: 14, borderRadius: 8 },
  alertText: { fontSize: 11, fontWeight: '500' as const, flex: 1 },
  expandedBody: { paddingHorizontal: 14, paddingBottom: 14 },
  detailCard: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  platformHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  platformDot: { width: 8, height: 8, borderRadius: 4 },
  detailTitle: { fontSize: 13, fontWeight: '700' as const },
  freqLabel: { fontSize: 11, fontWeight: '600' as const, marginLeft: 'auto' as any },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12, fontWeight: '700' as const },
  rhythmGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  rhythmCard: { flex: 1, minWidth: 70, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center' as const, gap: 4 },
  rhythmCount: { fontSize: 18, fontWeight: '800' as const },
  rhythmLabel: { fontSize: 10 },
  progressSection: { paddingHorizontal: 14, paddingBottom: 14 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 12 },
  progressValue: { fontSize: 14, fontWeight: '700' as const },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' as const },
  progressFill: { height: 6, borderRadius: 3 },
  taskStatusRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingBottom: 14 },
  taskStatusChip: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' as const },
  taskStatusNum: { fontSize: 18, fontWeight: '800' as const },
  taskStatusLabel: { fontSize: 10, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  taskDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  taskTitle: { fontSize: 13, fontWeight: '600' as const },
  taskMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  taskType: { fontSize: 11 },
  taskPriority: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' },
  calendarRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  calendarStat: { flex: 1, alignItems: 'center' as const },
  calendarNum: { fontSize: 22, fontWeight: '800' as const },
  calendarLabel: { fontSize: 11, marginTop: 2 },
  diagSection: { marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#1F293720' },
  diagHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  diagTitle: { fontSize: 13, fontWeight: '700' as const },
  assumptionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 3 },
  assumptionDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  assumptionText: { fontSize: 12, flex: 1, lineHeight: 17 },
  confBadgeSmall: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.3 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, marginTop: 4, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14 },
  rateItem: { alignItems: 'center' as const, gap: 2 },
  rateValue: { fontSize: 14, fontWeight: '800' as const },
  rateLabel: { fontSize: 10 },
  leverStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, marginHorizontal: 14, marginBottom: 6, borderRadius: 8 },
  leverText: { fontSize: 11, fontWeight: '600' as const, flex: 1 },
  feedCard: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 6 },
  feedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  priorityDot: { width: 7, height: 7, borderRadius: 4 },
  feedInsight: { fontSize: 12, fontWeight: '600' as const, flex: 1 },
  feedResponse: { fontSize: 11, lineHeight: 16 },
  playbookBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginLeft: 12, marginTop: 4, marginBottom: 6 },
  playbookLabel: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  playbookText: { fontSize: 11, lineHeight: 16 },
  dnaLinkRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  dnaLinkLabel: { fontSize: 11 },
  dnaChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  dnaChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  dnaChipText: { fontSize: 10, fontWeight: '600' as const },
});
