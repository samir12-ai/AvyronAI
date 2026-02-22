import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import BuildThePlan from '@/components/BuildThePlan';
import CompetitiveIntelligence from '@/components/CompetitiveIntelligence';
import DominanceEngine from '@/components/DominanceEngine';

interface PlanData {
  id: string;
  status: string;
  executionStatus: string;
  emergencyStopped: boolean;
  totalCalendarEntries: number;
  totalStudioItems: number;
  totalFailed: number;
  totalCanceled: number;
  createdAt: string;
  planSummary?: string | null;
  emergencyStoppedReason?: string | null;
}

interface AccountData {
  totalPlans: number;
  activePlans: number;
  totalRequired: number;
  totalPublished: number;
  totalScheduled: number;
  totalReady: number;
  totalDraft: number;
  totalFailed: number;
  totalCanceled: number;
  overallProgress: number;
}

interface ProgressData {
  progressPercent: number;
  totalRequired: number;
  calendarGenerated: number;
  studioTotal: number;
  published: number;
  scheduled: number;
  ready: number;
  draft: number;
  failed: number;
  canceled: number;
}

interface CalendarEntry {
  id: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  status: string;
}

type StepStatus = 'completed' | 'in_progress' | 'ready' | 'locked';
type IntelTab = 'analysis' | 'dominance';

const STEPS = [
  { key: 'build', title: 'BUILD STRATEGY', subtitle: 'Create your strategic blueprint', icon: 'construct-outline' as const, gradient: ['#EC4899', '#8B5CF6'] as [string, string] },
  { key: 'approval', title: 'APPROVAL', subtitle: 'Review and approve execution plans', icon: 'checkmark-done-circle-outline' as const, gradient: ['#34D399', '#10B981'] as [string, string] },
  { key: 'execution', title: 'EXECUTION PIPELINE', subtitle: 'Calendar, creatives, and publishing', icon: 'rocket-outline' as const, gradient: ['#A78BFA', '#7C3AED'] as [string, string] },
  { key: 'intel', title: 'COMPETITOR INTELLIGENCE', subtitle: 'Analysis and dominance strategy', icon: 'telescope-outline' as const, gradient: ['#3B82F6', '#1D4ED8'] as [string, string] },
];

const EXECUTION_STAGES = ['Approved', 'Calendar', 'Creatives', 'Review', 'Scheduled', 'Published'];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#8A96A8',
  READY_FOR_REVIEW: '#FFB347',
  APPROVED: '#34D399',
  REJECTED: '#FF6B6B',
  GENERATED_TO_CALENDAR: '#A78BFA',
};

function getStageIndex(status: string): number {
  switch (status) {
    case 'APPROVED': return 1;
    case 'GENERATED_TO_CALENDAR': return 2;
    case 'CREATIVE_GENERATED': return 3;
    case 'REVIEW': return 4;
    case 'SCHEDULED': return 5;
    case 'PUBLISHED': return 6;
    default: return 0;
  }
}

export default function StrategicPipeline() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();

  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [showCalendarEntries, setShowCalendarEntries] = useState(false);
  const [intelTab, setIntelTab] = useState<IntelTab>('analysis');

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/execution/dashboard?accountId=default'));
      const data = await res.json();
      if (data.success) {
        setPlans(data.plans || []);
        setAccount(data.account || null);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProgress = useCallback(async (planId: string) => {
    try {
      const [progressRes, calRes] = await Promise.all([
        fetch(getApiUrl(`/api/execution/plans/${planId}/progress`)),
        fetch(getApiUrl(`/api/execution/plans/${planId}/calendar`)),
      ]);
      const [progressData, calData] = await Promise.all([progressRes.json(), calRes.json()]);
      if (progressData.success !== false) setProgress(progressData);
      if (calData.success !== false) setCalendarEntries(calData.entries || []);
    } catch (err) {
      console.error('Progress fetch error:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const activePlan = plans.find(p => ['APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'REVIEW', 'SCHEDULED', 'PUBLISHED'].includes(p.status)) || plans[0] || null;

  useEffect(() => {
    if (activePlan) {
      fetchProgress(activePlan.id);
    }
  }, [activePlan?.id, fetchProgress]);

  const hasPlans = plans.length > 0;
  const hasApprovedOrBeyond = plans.some(p => !['DRAFT', 'READY_FOR_REVIEW', 'REJECTED'].includes(p.status));

  const getStepStatus = (index: number): StepStatus => {
    switch (index) {
      case 0:
        return hasPlans ? 'completed' : 'ready';
      case 1:
        if (!hasPlans) return 'locked';
        return hasApprovedOrBeyond ? 'completed' : 'in_progress';
      case 2:
        if (!hasApprovedOrBeyond) return 'locked';
        return (progress?.progressPercent ?? 0) >= 100 ? 'completed' : 'in_progress';
      case 3:
        return 'ready';
      default:
        return 'locked';
    }
  };

  const getStatusLabel = (status: StepStatus): string => {
    switch (status) {
      case 'completed': return 'Completed';
      case 'in_progress': return 'In Progress';
      case 'ready': return 'Ready';
      case 'locked': return 'Locked';
    }
  };

  const getStatusColor = (status: StepStatus): string => {
    switch (status) {
      case 'completed': return '#34D399';
      case 'in_progress': return '#A78BFA';
      case 'ready': return colors.primary;
      case 'locked': return colors.textMuted;
    }
  };

  const toggleStep = (index: number) => {
    const status = getStepStatus(index);
    if (status === 'locked') return;
    Platform.OS !== 'web' && Haptics.selectionAsync();
    setExpandedStep(expandedStep === index ? null : index);
  };

  const handleApprove = useCallback(async (planId: string) => {
    setActionLoading('approve');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/approve`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decidedBy: 'client' }),
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Approved', 'Plan approved successfully.');
        fetchDashboard();
      } else {
        Alert.alert('Error', data.message || data.error || 'Approval failed');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard]);

  const handleReject = useCallback(async (planId: string) => {
    Alert.alert('Reject Plan', 'Are you sure you want to reject this plan?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setActionLoading('reject');
          try {
            const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/reject`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Rejected by client', decidedBy: 'client' }),
            });
            const data = await res.json();
            if (data.success) {
              Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              fetchDashboard();
            }
          } catch (err: any) {
            Alert.alert('Error', err.message);
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  }, [fetchDashboard]);

  const handleExecuteCalendar = useCallback(async (planId: string) => {
    setActionLoading('calendar');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/execute-calendar`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: 30 }),
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Calendar Generated', `Created ${data.calendarEntries || 0} calendar entries.`);
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Error', data.message || data.error || 'Calendar generation failed');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);

  const handleExecuteCreative = useCallback(async (planId: string) => {
    setActionLoading('creative');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/execute-creative`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Creative Execution', `Created ${data.studioItemsCreated || 0} studio items.`);
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Error', data.message || data.error || 'Creative execution failed');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);

  const handleEmergencyStop = useCallback(async (planId: string) => {
    Alert.alert('Emergency Stop', 'This will immediately pause all execution. Nothing will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'STOP',
        style: 'destructive',
        onPress: async () => {
          setActionLoading('emergency');
          try {
            const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/emergency-stop`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Manual emergency stop by client' }),
            });
            const data = await res.json();
            if (data.success) {
              Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Stopped', 'All execution paused.');
              fetchDashboard();
              fetchProgress(planId);
            }
          } catch (err: any) {
            Alert.alert('Error', err.message);
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  }, [fetchDashboard, fetchProgress]);

  const handleResume = useCallback(async (planId: string) => {
    setActionLoading('resume');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/resume`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        fetchDashboard();
        fetchProgress(planId);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);

  const renderApprovalContent = () => {
    if (loading) {
      return (
        <View style={s.centerWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (!hasPlans) {
      return (
        <View style={s.centerWrap}>
          <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Plans Yet</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>
            Complete the Build Strategy step first to generate execution plans.
          </Text>
        </View>
      );
    }

    const pendingPlans = plans.filter(p => ['DRAFT', 'READY_FOR_REVIEW'].includes(p.status));
    const approvedPlans = plans.filter(p => !['DRAFT', 'READY_FOR_REVIEW', 'REJECTED'].includes(p.status));

    return (
      <View>
        {pendingPlans.length > 0 && (
          <View>
            <Text style={[s.sectionLabel, { color: colors.text }]}>Pending Approval</Text>
            {pendingPlans.map(plan => (
              <View key={plan.id} style={[s.planCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}>
                <View style={s.planCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.planId, { color: colors.text }]}>Plan {plan.id.slice(0, 8)}</Text>
                    <View style={s.planStatusRow}>
                      <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[plan.status] || '#8A96A8' }]} />
                      <Text style={[s.planStatus, { color: STATUS_COLORS[plan.status] || colors.textMuted }]}>
                        {plan.status === 'READY_FOR_REVIEW' ? 'Ready for Review' : plan.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={[s.planDate, { color: colors.textMuted }]}>
                    {new Date(plan.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={s.approvalActions}>
                  <Pressable
                    style={[s.approveBtn, { opacity: actionLoading === 'approve' ? 0.6 : 1 }]}
                    onPress={() => handleApprove(plan.id)}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === 'approve' ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={16} color="#fff" />
                        <Text style={s.approveBtnText}>Approve</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={[s.rejectBtn, { opacity: actionLoading === 'reject' ? 0.6 : 1 }]}
                    onPress={() => handleReject(plan.id)}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === 'reject' ? (
                      <ActivityIndicator size="small" color="#FF6B6B" />
                    ) : (
                      <>
                        <Ionicons name="close" size={16} color="#FF6B6B" />
                        <Text style={s.rejectBtnText}>Reject</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {approvedPlans.length > 0 && (
          <View style={{ marginTop: pendingPlans.length > 0 ? 16 : 0 }}>
            <Text style={[s.sectionLabel, { color: colors.text }]}>Approval History</Text>
            {approvedPlans.map(plan => (
              <View key={plan.id} style={[s.planCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}>
                <View style={s.planCardHeader}>
                  <View style={s.approvedRow}>
                    <View style={[s.approvedCheck, { backgroundColor: '#34D39920' }]}>
                      <Ionicons name="checkmark-circle" size={20} color="#34D399" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.planId, { color: colors.text }]}>Plan {plan.id.slice(0, 8)}</Text>
                      <Text style={[s.approvedDate, { color: '#34D399' }]}>
                        Approved {new Date(plan.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                  <View style={[s.statusDot, { backgroundColor: STATUS_COLORS[plan.status] || '#34D399' }]} />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderExecutionContent = () => {
    if (!activePlan || !hasApprovedOrBeyond) {
      return (
        <View style={s.centerWrap}>
          <Ionicons name="rocket-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Active Execution</Text>
          <Text style={[s.emptyDesc, { color: colors.textSecondary }]}>
            Approve a plan first to start the execution pipeline.
          </Text>
        </View>
      );
    }

    const stageIdx = getStageIndex(activePlan.status);
    const pct = progress?.progressPercent ?? 0;

    return (
      <View>
        <View style={[s.stageRow, { backgroundColor: isDark ? '#0F1419' : '#F8FAFC', borderColor: colors.cardBorder }]}>
          {EXECUTION_STAGES.map((stage, i) => {
            const done = i < stageIdx;
            const current = i === stageIdx;
            return (
              <View key={i} style={s.stageItem}>
                <View style={[s.stageCircle, {
                  backgroundColor: done ? '#34D399' : current ? '#A78BFA' : colors.cardBorder,
                }]}>
                  {done ? (
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  ) : (
                    <Text style={[s.stageNum, { color: current ? '#fff' : colors.textMuted }]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[s.stageLabel, { color: done ? '#34D399' : current ? '#A78BFA' : colors.textMuted }]} numberOfLines={1}>
                  {stage}
                </Text>
                {i < EXECUTION_STAGES.length - 1 && (
                  <View style={[s.stageLine, { backgroundColor: done ? '#34D399' : colors.cardBorder }]} />
                )}
              </View>
            );
          })}
        </View>

        <View style={[s.progressCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}>
          <View style={s.progressHeader}>
            <Text style={[s.progressTitle, { color: colors.text }]}>Execution Progress</Text>
            <Text style={[s.progressPct, { color: '#A78BFA' }]}>{pct}%</Text>
          </View>
          <View style={[s.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <LinearGradient
              colors={['#A78BFA', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[s.progressFill, { width: `${Math.min(100, Math.max(0, pct))}%` }]}
            />
          </View>
        </View>

        {progress && (
          <View style={s.statsGrid}>
            {[
              { label: 'Required', value: progress.totalRequired, color: colors.text },
              { label: 'Calendar', value: progress.calendarGenerated, color: '#A78BFA' },
              { label: 'Ready', value: progress.ready, color: '#00D09C' },
              { label: 'Published', value: progress.published, color: '#34D399' },
              { label: 'Failed', value: progress.failed, color: '#FF6B6B' },
            ].map((stat, i) => (
              <View key={i} style={[s.statBox, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}>
                <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={[s.statLabel, { color: colors.textMuted }]}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.execActions}>
          {activePlan.status === 'APPROVED' && (
            <Pressable
              style={[s.execBtn, { opacity: actionLoading === 'calendar' ? 0.6 : 1 }]}
              onPress={() => handleExecuteCalendar(activePlan.id)}
              disabled={!!actionLoading}
            >
              <LinearGradient colors={['#A78BFA', '#7C3AED']} style={s.execBtnGrad}>
                {actionLoading === 'calendar' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="calendar-outline" size={16} color="#fff" />
                    <Text style={s.execBtnText}>Generate Calendar</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          )}

          {activePlan.status === 'GENERATED_TO_CALENDAR' && (
            <Pressable
              style={[s.execBtn, { opacity: actionLoading === 'creative' ? 0.6 : 1 }]}
              onPress={() => handleExecuteCreative(activePlan.id)}
              disabled={!!actionLoading}
            >
              <LinearGradient colors={['#EC4899', '#8B5CF6']} style={s.execBtnGrad}>
                {actionLoading === 'creative' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="color-palette-outline" size={16} color="#fff" />
                    <Text style={s.execBtnText}>Generate Creatives</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          )}

          {activePlan.emergencyStopped ? (
            <Pressable
              style={[s.execBtn, { opacity: actionLoading === 'resume' ? 0.6 : 1 }]}
              onPress={() => handleResume(activePlan.id)}
              disabled={!!actionLoading}
            >
              <LinearGradient colors={['#34D399', '#10B981']} style={s.execBtnGrad}>
                {actionLoading === 'resume' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="play" size={16} color="#fff" />
                    <Text style={s.execBtnText}>Resume Execution</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          ) : null}

          {!activePlan.emergencyStopped && hasApprovedOrBeyond && (
            <Pressable
              style={[s.emergencyBtn, { opacity: actionLoading === 'emergency' ? 0.6 : 1 }]}
              onPress={() => handleEmergencyStop(activePlan.id)}
              disabled={!!actionLoading}
            >
              {actionLoading === 'emergency' ? (
                <ActivityIndicator size="small" color="#FF6B6B" />
              ) : (
                <>
                  <Ionicons name="stop-circle" size={16} color="#FF6B6B" />
                  <Text style={s.emergencyBtnText}>Emergency Stop</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        {calendarEntries.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Pressable
              onPress={() => {
                Platform.OS !== 'web' && Haptics.selectionAsync();
                setShowCalendarEntries(!showCalendarEntries);
              }}
              style={[s.calendarToggle, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}
            >
              <Ionicons name="calendar" size={16} color="#A78BFA" />
              <Text style={[s.calendarToggleText, { color: colors.text }]}>
                Calendar Entries ({calendarEntries.length})
              </Text>
              <Ionicons name={showCalendarEntries ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {showCalendarEntries && calendarEntries.map(entry => (
              <View key={entry.id} style={[s.calEntry, { backgroundColor: isDark ? '#0F1419' : '#F8FAFC', borderColor: colors.cardBorder }]}>
                <View style={s.calEntryHeader}>
                  <Text style={[s.calEntryTitle, { color: colors.text }]} numberOfLines={1}>{entry.title}</Text>
                  <View style={[s.calEntryBadge, { backgroundColor: (STATUS_COLORS[entry.status] || '#8A96A8') + '20' }]}>
                    <Text style={[s.calEntryStatus, { color: STATUS_COLORS[entry.status] || '#8A96A8' }]}>{entry.status}</Text>
                  </View>
                </View>
                <Text style={[s.calEntryMeta, { color: colors.textMuted }]}>
                  {entry.scheduledDate} {entry.scheduledTime} - {entry.contentType}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderIntelContent = () => (
    <View>
      <View style={[s.intelTabs, { backgroundColor: isDark ? '#0F1419' : '#F5F7FA', borderColor: colors.cardBorder }]}>
        <Pressable
          style={[s.intelTab, intelTab === 'analysis' && { backgroundColor: '#3B82F6' + '18' }]}
          onPress={() => {
            Platform.OS !== 'web' && Haptics.selectionAsync();
            setIntelTab('analysis');
          }}
        >
          <Ionicons name="analytics-outline" size={16} color={intelTab === 'analysis' ? '#3B82F6' : colors.textMuted} />
          <Text style={[s.intelTabText, { color: intelTab === 'analysis' ? '#3B82F6' : colors.textMuted }]}>Analysis</Text>
        </Pressable>
        <Pressable
          style={[s.intelTab, intelTab === 'dominance' && { backgroundColor: '#EF4444' + '18' }]}
          onPress={() => {
            Platform.OS !== 'web' && Haptics.selectionAsync();
            setIntelTab('dominance');
          }}
        >
          <Ionicons name="flash-outline" size={16} color={intelTab === 'dominance' ? '#EF4444' : colors.textMuted} />
          <Text style={[s.intelTabText, { color: intelTab === 'dominance' ? '#EF4444' : colors.textMuted }]}>Dominance</Text>
        </Pressable>
      </View>
      {intelTab === 'analysis' ? <CompetitiveIntelligence /> : <DominanceEngine />}
    </View>
  );

  const renderStepContent = (index: number) => {
    switch (index) {
      case 0: return <BuildThePlan />;
      case 1: return renderApprovalContent();
      case 2: return renderExecutionContent();
      case 3: return renderIntelContent();
      default: return null;
    }
  };

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.loadingText, { color: colors.textMuted }]}>Loading pipeline...</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {STEPS.map((step, index) => {
        const status = getStepStatus(index);
        const isLocked = status === 'locked';
        const isExpanded = expandedStep === index;
        const isLast = index === STEPS.length - 1;

        return (
          <View key={step.key}>
            <View style={s.stepRow}>
              <View style={s.stepLeft}>
                <View style={s.stepCircleWrap}>
                  {isLocked ? (
                    <View style={[s.stepCircle, { backgroundColor: colors.cardBorder }]}>
                      <Text style={[s.stepNum, { color: colors.textMuted }]}>{index + 1}</Text>
                    </View>
                  ) : status === 'completed' ? (
                    <View style={[s.stepCircle, { backgroundColor: '#34D399' }]}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                    </View>
                  ) : (
                    <LinearGradient colors={step.gradient} style={s.stepCircle}>
                      <Text style={s.stepNumActive}>{index + 1}</Text>
                    </LinearGradient>
                  )}
                </View>
                {!isLast && (
                  <View style={[
                    s.connector,
                    {
                      backgroundColor: isLocked ? 'transparent' : colors.cardBorder,
                      borderStyle: isLocked ? 'dashed' : 'solid',
                      borderLeftWidth: isLocked ? 2 : 0,
                      borderLeftColor: isLocked ? colors.cardBorder : 'transparent',
                    },
                    isExpanded && { minHeight: 40 },
                  ]} />
                )}
              </View>

              <Pressable
                style={[s.stepCard, {
                  backgroundColor: isDark ? '#0F1419' : '#fff',
                  borderColor: isExpanded ? step.gradient[0] + '60' : colors.cardBorder,
                  opacity: isLocked ? 0.5 : 1,
                }]}
                onPress={() => toggleStep(index)}
                disabled={isLocked}
              >
                <View style={s.stepCardContent}>
                  <View style={[s.stepIcon, { backgroundColor: isLocked ? colors.cardBorder + '40' : step.gradient[0] + '15' }]}>
                    <Ionicons name={step.icon} size={20} color={isLocked ? colors.textMuted : step.gradient[0]} />
                  </View>
                  <View style={s.stepInfo}>
                    <Text style={[s.stepTitle, { color: isLocked ? colors.textMuted : colors.text }]}>{step.title}</Text>
                    <Text style={[s.stepSubtitle, { color: colors.textMuted }]}>{step.subtitle}</Text>
                  </View>
                  <View style={s.stepRight}>
                    <Text style={[s.stepStatus, { color: getStatusColor(status) }]}>{getStatusLabel(status)}</Text>
                    {!isLocked && (
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                    )}
                  </View>
                </View>
              </Pressable>
            </View>

            {isExpanded && (
              <View style={s.expandedContent}>
                {renderStepContent(index)}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepLeft: {
    width: 44,
    alignItems: 'center',
  },
  stepCircleWrap: {
    zIndex: 1,
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: {
    fontSize: 14,
    fontWeight: '700',
  },
  stepNumActive: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  connector: {
    width: 2,
    minHeight: 20,
    flexGrow: 1,
  },
  stepCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    marginLeft: 8,
    marginBottom: 8,
  },
  stepCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stepSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  stepRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  stepStatus: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  expandedContent: {
    marginLeft: 52,
    marginRight: 0,
    marginBottom: 12,
    padding: 16,
    paddingTop: 8,
  },
  centerWrap: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  planCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planId: {
    fontSize: 14,
    fontWeight: '700',
  },
  planStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  planStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  planDate: {
    fontSize: 11,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#34D399',
    borderRadius: 8,
    paddingVertical: 10,
  },
  approveBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FF6B6B15',
    borderRadius: 8,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FF6B6B40',
  },
  rejectBtnText: {
    color: '#FF6B6B',
    fontSize: 13,
    fontWeight: '700',
  },
  approvedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  approvedCheck: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvedDate: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  stageItem: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  stageCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stageNum: {
    fontSize: 9,
    fontWeight: '700',
  },
  stageLabel: {
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  stageLine: {
    position: 'absolute',
    top: 10,
    right: -8,
    width: 16,
    height: 2,
  },
  progressCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressPct: {
    fontSize: 20,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    alignItems: 'center',
    minWidth: 60,
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  execActions: {
    gap: 8,
  },
  execBtn: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  execBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  execBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FF6B6B15',
    borderWidth: 1,
    borderColor: '#FF6B6B40',
  },
  emergencyBtnText: {
    color: '#FF6B6B',
    fontSize: 14,
    fontWeight: '700',
  },
  calendarToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  calendarToggleText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  calEntry: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
  },
  calEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  calEntryTitle: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  calEntryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  calEntryStatus: {
    fontSize: 9,
    fontWeight: '700',
  },
  calEntryMeta: {
    fontSize: 11,
    marginTop: 4,
  },
  intelTabs: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    marginBottom: 12,
  },
  intelTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  intelTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
