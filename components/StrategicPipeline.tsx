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
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

interface PlanData {
  id: string;
  blueprintId: string;
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

const STEPS = [
  { key: 'approval', title: 'APPROVAL', subtitle: 'Review and approve execution plans', icon: 'checkmark-done-circle-outline' as const, gradient: ['#34D399', '#10B981'] as [string, string] },
  { key: 'execution', title: 'EXECUTION PIPELINE', subtitle: 'Calendar, creatives, and publishing', icon: 'rocket-outline' as const, gradient: ['#A78BFA', '#7C3AED'] as [string, string] },
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

interface StrategicPipelineProps {
  onNavigateToCalendar?: () => void;
}

export default function StrategicPipeline({ onNavigateToCalendar }: StrategicPipelineProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();
  const router = useRouter();

  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);

  const fetchDashboard = useCallback(async () => {
    try {
      setFetchError(false);
      const campaignId = selectedCampaign?.selectedCampaignId;
      let url = '/api/execution/dashboard?accountId=default';
      if (campaignId) url += `&campaignId=${encodeURIComponent(campaignId)}`;
      const res = await fetch(getApiUrl(url));
      const data = await res.json();
      if (res.ok && data.success) {
        setPlans(data.plans || []);
        setAccount(data.account || null);
      } else {
        setFetchError(true);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign?.selectedCampaignId]);

  const fetchProgress = useCallback(async (planId: string) => {
    try {
      const [progressRes, calRes] = await Promise.all([
        fetch(getApiUrl(`/api/execution/plans/${planId}/progress`)),
        fetch(getApiUrl(`/api/execution/plans/${planId}/calendar`)),
      ]);
      const [progressData, calData] = await Promise.all([progressRes.json(), calRes.json()]);
      if (progressRes.ok && progressData.success !== false) setProgress(progressData);
      if (calRes.ok && calData.success !== false) setCalendarEntries(calData.entries || []);
    } catch (err) {
      console.error('Progress fetch error:', err);
    }
  }, []);

  useEffect(() => {
    setPlans([]);
    setAccount(null);
    setProgress(null);
    setCalendarEntries([]);
    setFetchError(false);
    setLoading(true);
    fetchDashboard();
  }, [fetchDashboard]);

  const activePlan = plans.find(p => ['APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'REVIEW', 'SCHEDULED', 'PUBLISHED'].includes(p.status)) || plans[0] || null;

  useEffect(() => {
    if (activePlan) {
      fetchProgress(activePlan.id);
    } else {
      setProgress(null);
      setCalendarEntries([]);
    }
  }, [activePlan?.id, fetchProgress]);

  const hasPlans = plans.length > 0;
  const hasApprovedOrBeyond = plans.some(p => !['DRAFT', 'READY_FOR_REVIEW', 'REJECTED'].includes(p.status));

  const getStepStatus = (index: number): StepStatus => {
    switch (index) {
      case 0:
        if (!hasPlans) return 'locked';
        return hasApprovedOrBeyond ? 'completed' : 'in_progress';
      case 1:
        if (!hasApprovedOrBeyond) return 'locked';
        return (progress?.progressPercent ?? 0) >= 100 ? 'completed' : 'in_progress';
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
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Approved', 'Plan approved successfully.');
        fetchDashboard();
      } else {
        Alert.alert('Error', data.message || data.error || `Approval failed (status ${res.status}).`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard]);

  const executeReject = useCallback(async (planId: string) => {
    setActionLoading('reject');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/reject`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by client', decidedBy: 'client' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert('Rejected', 'Plan has been rejected.');
        fetchDashboard();
      } else {
        Alert.alert('Reject Failed', data.message || data.error || `Server returned status ${res.status}.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard]);

  const handleReject = useCallback((planId: string) => {
    Alert.alert('Reject Plan', 'Are you sure you want to reject this plan?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: () => {
          executeReject(planId);
        },
      },
    ]);
  }, [executeReject]);

  const handleExecuteCalendar = useCallback(async (planId: string) => {
    setActionLoading('calendar');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/execute-calendar`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodDays: 30 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Calendar Generated', `Created ${data.calendarEntries || 0} calendar entries.`);
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Error', data.message || data.error || `Calendar generation failed (status ${res.status}).`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);


  const executeEmergencyStop = useCallback(async (planId: string) => {
    setActionLoading('emergency');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/emergency-stop`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual emergency stop by client' }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Stopped', 'All execution paused.');
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Stop Failed', data.message || data.error || `Server returned status ${res.status}.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);

  const handleEmergencyStop = useCallback((planId: string) => {
    Alert.alert('Emergency Stop', 'This will immediately pause all execution. Nothing will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'STOP',
        style: 'destructive',
        onPress: () => {
          executeEmergencyStop(planId);
        },
      },
    ]);
  }, [executeEmergencyStop]);

  const handleResume = useCallback(async (planId: string) => {
    setActionLoading('resume');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/resume`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Resumed', 'Execution has been resumed.');
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Resume Failed', data.message || data.error || `Server returned status ${res.status}.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress]);

  const executeResetFailed = useCallback(async (planId: string) => {
    setActionLoading('reset-failed');
    try {
      const campaignId = selectedCampaign?.selectedCampaignId || '';
      const url = getApiUrl(`/api/execution/plans/${planId}/reset-failed?accountId=default&campaignId=${encodeURIComponent(campaignId)}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Reset Complete', `${data.resetCount} entries reset to draft. Go to Calendar to retry.`);
        fetchDashboard();
        fetchProgress(planId);
      } else {
        Alert.alert('Reset Failed', data.message || data.error || `Server returned status ${res.status}. Please try again.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, [fetchDashboard, fetchProgress, selectedCampaign?.selectedCampaignId]);

  const handleResetFailed = useCallback((planId: string) => {
    Alert.alert(
      'Reset Failed Entries',
      'This will reset all failed entries back to draft so you can retry them from the Calendar.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All Failed',
          style: 'destructive',
          onPress: () => {
            executeResetFailed(planId);
          },
        },
      ]
    );
  }, [executeResetFailed]);

  const handleDownloadPlan = useCallback(async (blueprintId: string) => {
    setActionLoading('download');
    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprintId}/plan-pdf`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Plan Generated', `${data.fileName}\n\nPlan document has been generated and saved.`);
      } else {
        Alert.alert('Error', data.message || data.error || `Plan generation failed (status ${res.status}).`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Network error — could not reach the server.');
    } finally {
      setActionLoading(null);
    }
  }, []);

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
                {onNavigateToCalendar && (
                  <Pressable
                    onPress={onNavigateToCalendar}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#34D399', borderRadius: 8, paddingVertical: 10, marginTop: 12 }}
                  >
                    <Ionicons name="calendar" size={16} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' as const }}>Go to Calendar</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => handleDownloadPlan(plan.blueprintId)}
                  disabled={actionLoading === 'download'}
                  style={[s.downloadPlanBtn, { borderColor: colors.cardBorder, opacity: actionLoading === 'download' ? 0.6 : 1 }]}
                >
                  {actionLoading === 'download' ? (
                    <ActivityIndicator size="small" color="#A78BFA" />
                  ) : (
                    <>
                      <Ionicons name="document-text-outline" size={16} color="#A78BFA" />
                      <Text style={s.downloadPlanBtnText}>Download Plan</Text>
                    </>
                  )}
                </Pressable>
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
              { label: 'Ready', value: progress.ready, color: '#8B5CF6' },
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

        {progress && progress.failed > 0 && (
          <View style={[s.failedBanner, { backgroundColor: '#FF6B6B15', borderColor: '#FF6B6B40' }]}>
            <View style={s.failedBannerHeader}>
              <Ionicons name="warning" size={18} color="#FF6B6B" />
              <Text style={[s.failedBannerTitle, { color: '#FF6B6B' }]}>
                {progress.failed} Failed {progress.failed === 1 ? 'Entry' : 'Entries'}
              </Text>
            </View>
            <Text style={[s.failedBannerDesc, { color: colors.textSecondary }]}>
              Reset failed entries to draft, then retry them one by one from the Calendar tab.
            </Text>
            <View style={s.failedBannerActions}>
              <Pressable
                style={[s.resetFailedBtn, { opacity: actionLoading === 'reset-failed' ? 0.6 : 1 }]}
                onPress={() => executeResetFailed(activePlan.id)}
                disabled={!!actionLoading}
              >
                <LinearGradient colors={['#FF6B6B', '#EF4444']} style={s.resetFailedBtnGrad}>
                  {actionLoading === 'reset-failed' ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color="#fff" />
                      <Text style={s.resetFailedBtnText}>Reset All Failed</Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
              <Pressable
                style={s.goToCalBtn}
                onPress={() => {
                  Platform.OS !== 'web' && Haptics.selectionAsync();
                  router.push('/(tabs)/calendar');
                }}
              >
                <Ionicons name="calendar-outline" size={16} color="#A78BFA" />
                <Text style={[s.goToCalBtnText, { color: '#A78BFA' }]}>Open Calendar</Text>
              </Pressable>
            </View>
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

        {hasApprovedOrBeyond && calendarEntries.length === 0 && (
          <View style={{ marginTop: 12 }}>
            <Pressable
              style={s.openCalendarBtn}
              onPress={() => {
                Platform.OS !== 'web' && Haptics.selectionAsync();
                router.push('/(tabs)/calendar');
              }}
            >
              <LinearGradient colors={['#A78BFA', '#7C3AED']} style={s.openCalendarBtnGrad}>
                <Ionicons name="calendar-outline" size={18} color="#fff" />
                <Text style={s.openCalendarBtnText}>Open Calendar</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

        {calendarEntries.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <View style={[s.summaryCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: colors.cardBorder }]}>
              <View style={s.summaryHeader}>
                <Ionicons name="calendar" size={20} color="#A78BFA" />
                <Text style={[s.summaryTitle, { color: colors.text }]}>
                  {calendarEntries.length} calendar {calendarEntries.length === 1 ? 'entry' : 'entries'} scheduled
                </Text>
              </View>
              <View style={s.summaryStatsRow}>
                {Object.entries(
                  calendarEntries.reduce<Record<string, number>>((acc, e) => {
                    acc[e.contentType] = (acc[e.contentType] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([type, count]) => (
                  <View key={type} style={[s.summaryChip, { backgroundColor: '#A78BFA15' }]}>
                    <Text style={[s.summaryChipText, { color: '#A78BFA' }]}>{type}: {count}</Text>
                  </View>
                ))}
              </View>
              <View style={s.summaryStatsRow}>
                {Object.entries(
                  calendarEntries.reduce<Record<string, number>>((acc, e) => {
                    acc[e.status] = (acc[e.status] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([status, count]) => (
                  <View key={status} style={[s.summaryChip, { backgroundColor: (STATUS_COLORS[status] || '#8A96A8') + '15' }]}>
                    <Text style={[s.summaryChipText, { color: STATUS_COLORS[status] || '#8A96A8' }]}>{status}: {count}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Pressable
              style={s.openCalendarBtn}
              onPress={() => {
                Platform.OS !== 'web' && Haptics.selectionAsync();
                router.push('/(tabs)/calendar');
              }}
            >
              <LinearGradient colors={['#A78BFA', '#7C3AED']} style={s.openCalendarBtnGrad}>
                <Ionicons name="calendar-outline" size={18} color="#fff" />
                <Text style={s.openCalendarBtnText}>Open Calendar</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const renderStepContent = (index: number) => {
    switch (index) {
      case 0: return renderApprovalContent();
      case 1: return renderExecutionContent();
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

  if (fetchError && plans.length === 0) {
    return (
      <View style={s.loadingWrap}>
        <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
        <Text style={[s.loadingText, { color: colors.textMuted }]}>Could not load pipeline data</Text>
        <Pressable onPress={fetchDashboard} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary + '20', borderRadius: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Retry</Text>
        </Pressable>
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
  summaryCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  summaryStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  summaryChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  openCalendarBtn: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  openCalendarBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  openCalendarBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  failedBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
    marginBottom: 6,
  },
  failedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  failedBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  failedBannerDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  failedBannerActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  resetFailedBtn: {
    borderRadius: 8,
    overflow: 'hidden',
    flex: 1,
  },
  resetFailedBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  resetFailedBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  goToCalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  goToCalBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  downloadPlanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
  },
  downloadPlanBtnText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700' as const,
  },
});
