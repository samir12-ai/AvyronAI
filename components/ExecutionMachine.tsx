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

interface PlanData {
  id: string;
  accountId: string;
  blueprintId: string;
  campaignId: string;
  planJson: string;
  planSummary: string | null;
  status: string;
  executionStatus: string;
  emergencyStopped: boolean;
  emergencyStoppedAt: string | null;
  emergencyStoppedReason: string | null;
  totalCalendarEntries: number;
  totalStudioItems: number;
  totalPublished: number;
  totalFailed: number;
  createdAt: string;
}

interface ProgressData {
  totalRequired: number;
  calendarGenerated: number;
  studioTotal: number;
  published: number;
  scheduled: number;
  ready: number;
  draft: number;
  failed: number;
  progressPercent: number;
}

interface DashboardData {
  totalPlans: number;
  activePlans: number;
  emergencyStoppedPlans: number;
  totalRequired: number;
  totalPublished: number;
  totalScheduled: number;
  totalReady: number;
  totalDraft: number;
  totalFailed: number;
  overallProgress: number;
}

interface CalendarEntry {
  id: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  status: string;
}

type ViewMode = 'dashboard' | 'plan-detail';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#8A96A8',
  READY_FOR_REVIEW: '#FFB347',
  APPROVED: '#34D399',
  REJECTED: '#FF6B6B',
  GENERATED_TO_CALENDAR: '#A78BFA',
  IDLE: '#8A96A8',
  RUNNING: '#00D09C',
  COMPLETED: '#34D399',
  FAILED: '#FF6B6B',
  PAUSED: '#FFB347',
  PUBLISHED: '#34D399',
  SCHEDULED: '#A78BFA',
  READY: '#00D09C',
  AI_GENERATED: '#60A5FA',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  READY_FOR_REVIEW: 'Ready for Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  GENERATED_TO_CALENDAR: 'Calendar Generated',
  IDLE: 'Idle',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  PAUSED: 'Paused',
};

function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const color = STATUS_COLORS[status] || '#8A96A8';
  return (
    <View style={[styles.badge, { backgroundColor: color + '20', borderColor: color }, small && styles.badgeSmall]}>
      <View style={[styles.badgeDot, { backgroundColor: color }, small && styles.badgeDotSmall]} />
      <Text style={[styles.badgeText, { color }, small && styles.badgeTextSmall]}>
        {STATUS_LABELS[status] || status}
      </Text>
    </View>
  );
}

function ProgressBar({ value, color, height = 6 }: { value: number; color: string; height?: number }) {
  return (
    <View style={[styles.progressTrack, { height }]}>
      <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color, height }]} />
    </View>
  );
}

function MetricBox({ label, value, icon, color, theme }: { label: string; value: number | string; icon: string; color: string; theme: any }) {
  return (
    <View style={[styles.metricBox, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={[styles.metricIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

export default function ExecutionMachine() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaign } = useCampaign();

  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanData | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    distribution: true,
    creative: false,
    budget: false,
    kpi: false,
    competitive: false,
    risk: false,
  });

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiUrl('/api/execution/dashboard?accountId=default'));
      const data = await res.json();
      if (data.success) {
        setDashboard(data.account);
        setPlans(data.plans || []);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlanDetail = useCallback(async (planId: string) => {
    try {
      setLoading(true);
      const [planRes, progressRes, calRes] = await Promise.all([
        fetch(getApiUrl(`/api/execution/plans/${planId}`)),
        fetch(getApiUrl(`/api/execution/plans/${planId}/progress`)),
        fetch(getApiUrl(`/api/execution/plans/${planId}/calendar`)),
      ]);
      const [planData, progressData, calData] = await Promise.all([planRes.json(), progressRes.json(), calRes.json()]);
      if (planData.success) setSelectedPlan(planData.plan);
      if (progressData.success) setProgress(progressData);
      if (calData.success) setCalendarEntries(calData.entries || []);
    } catch (err) {
      console.error('Plan detail error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const generatePlan = useCallback(async (blueprintId: string) => {
    if (!selectedCampaign) {
      Alert.alert('No Campaign', 'Select a campaign first.');
      return;
    }
    setActionLoading('generate');
    try {
      const res = await fetch(getApiUrl('/api/execution/plans/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprintId, campaignId: selectedCampaign.selectedCampaignId, accountId: 'default' }),
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Plan Generated', `Created execution plan with ${data.totals?.totalContentPieces || 0} content pieces.`);
        fetchDashboard();
      } else {
        Alert.alert('Error', data.error || 'Failed to generate plan.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [selectedCampaign, fetchDashboard]);

  const approvePlan = useCallback(async (planId: string) => {
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
        Alert.alert('Approved', 'Plan approved. You can now execute calendar generation.');
        fetchPlanDetail(planId);
      } else {
        Alert.alert('Error', data.message || data.error);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlanDetail]);

  const rejectPlan = useCallback(async (planId: string) => {
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
              fetchPlanDetail(planId);
            }
          } catch (err: any) {
            Alert.alert('Error', err.message);
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  }, [fetchPlanDetail]);

  const emergencyStop = useCallback(async (planId: string) => {
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
              Alert.alert('Stopped', 'All execution paused. Nothing was deleted.');
              fetchPlanDetail(planId);
            }
          } catch (err: any) {
            Alert.alert('Error', err.message);
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  }, [fetchPlanDetail]);

  const resumePlan = useCallback(async (planId: string) => {
    setActionLoading('resume');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/resume`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        fetchPlanDetail(planId);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlanDetail]);

  const executeCalendar = useCallback(async (planId: string) => {
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
        Alert.alert('Calendar Generated', `Created ${data.calendarEntries} calendar entries.`);
        fetchPlanDetail(planId);
      } else {
        Alert.alert('Error', data.message || data.error);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlanDetail]);

  const executeCreative = useCallback(async (planId: string) => {
    setActionLoading('creative');
    try {
      const res = await fetch(getApiUrl(`/api/execution/plans/${planId}/execute-creative`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const msg = data.emergencyStopped
          ? `Stopped mid-execution. Created ${data.studioItemsCreated} items before stop.`
          : `Created ${data.studioItemsCreated} studio items. ${data.failedItems > 0 ? `${data.failedItems} failed.` : ''}`;
        Alert.alert('Creative Execution', msg);
        fetchPlanDetail(planId);
      } else {
        Alert.alert('Error', data.message || data.error);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  }, [fetchPlanDetail]);

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openPlan = (plan: PlanData) => {
    setViewMode('plan-detail');
    setSelectedPlan(plan);
    fetchPlanDetail(plan.id);
  };

  const renderDashboard = () => {
    if (loading && !dashboard) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      );
    }

    if (!dashboard || plans.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="rocket-outline" size={48} color={theme.textMuted} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No Execution Plans</Text>
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            Complete "Build The Plan" first, then generate an execution plan from the orchestrator output.
          </Text>
        </View>
      );
    }

    return (
      <>
        <View style={styles.metricsRow}>
          <MetricBox label="Active Plans" value={dashboard.activePlans} icon="flash-outline" color="#00D09C" theme={theme} />
          <MetricBox label="Total Content" value={dashboard.totalRequired} icon="documents-outline" color="#A78BFA" theme={theme} />
          <MetricBox label="Published" value={dashboard.totalPublished} icon="checkmark-circle-outline" color="#34D399" theme={theme} />
        </View>

        <View style={[styles.progressCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.progressHeader}>
            <Text style={[styles.progressTitle, { color: theme.text }]}>Overall Progress</Text>
            <Text style={[styles.progressPercent, { color: theme.primary }]}>{dashboard.overallProgress}%</Text>
          </View>
          <ProgressBar value={dashboard.overallProgress} color={theme.primary} height={8} />
          <View style={styles.progressLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#34D399' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>Published: {dashboard.totalPublished}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#A78BFA' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>Scheduled: {dashboard.totalScheduled}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#00D09C' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>Ready: {dashboard.totalReady}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#FF6B6B' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>Failed: {dashboard.totalFailed}</Text>
            </View>
          </View>
        </View>

        {dashboard.emergencyStoppedPlans > 0 && (
          <View style={[styles.alertBanner, { backgroundColor: '#FF6B6B15', borderColor: '#FF6B6B' }]}>
            <Ionicons name="warning-outline" size={18} color="#FF6B6B" />
            <Text style={[styles.alertText, { color: '#FF6B6B' }]}>
              {dashboard.emergencyStoppedPlans} plan{dashboard.emergencyStoppedPlans > 1 ? 's' : ''} in emergency stop
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: theme.text }]}>Plans</Text>
        {plans.map((plan) => (
          <Pressable
            key={plan.id}
            style={[styles.planCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
            onPress={() => openPlan(plan)}
          >
            <View style={styles.planCardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planCardTitle, { color: theme.text }]} numberOfLines={1}>
                  Plan {plan.id.slice(0, 8)}
                </Text>
                <Text style={[styles.planCardSummary, { color: theme.textSecondary }]} numberOfLines={2}>
                  {plan.planSummary || 'No summary'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </View>
            <View style={styles.planCardFooter}>
              <StatusBadge status={plan.status} small />
              {plan.emergencyStopped && <StatusBadge status="PAUSED" small />}
              <Text style={[styles.planCardDate, { color: theme.textMuted }]}>
                {new Date(plan.createdAt).toLocaleDateString()}
              </Text>
            </View>
          </Pressable>
        ))}
      </>
    );
  };

  const renderPlanDetail = () => {
    if (!selectedPlan) return null;

    let parsedPlan: any = {};
    try {
      parsedPlan = JSON.parse(selectedPlan.planJson);
    } catch {}

    const canApprove = ['DRAFT', 'READY_FOR_REVIEW'].includes(selectedPlan.status);
    const canExecuteCalendar = selectedPlan.status === 'APPROVED' && selectedPlan.executionStatus !== 'RUNNING';
    const canExecuteCreative = selectedPlan.status === 'GENERATED_TO_CALENDAR' && selectedPlan.executionStatus !== 'RUNNING';
    const canResume = selectedPlan.emergencyStopped;

    const sections = [
      {
        key: 'distribution',
        title: 'Content Distribution',
        icon: 'grid-outline',
        data: parsedPlan.contentDistributionPlan,
      },
      {
        key: 'creative',
        title: 'Creative Testing',
        icon: 'flask-outline',
        data: parsedPlan.creativeTestingMatrix,
      },
      {
        key: 'budget',
        title: 'Budget Allocation',
        icon: 'cash-outline',
        data: parsedPlan.budgetAllocationStructure,
      },
      {
        key: 'kpi',
        title: 'KPI Monitoring',
        icon: 'stats-chart-outline',
        data: parsedPlan.kpiMonitoringPriority,
      },
      {
        key: 'competitive',
        title: 'Competitive Watch',
        icon: 'eye-outline',
        data: parsedPlan.competitiveWatchTargets,
      },
      {
        key: 'risk',
        title: 'Risk Triggers',
        icon: 'shield-outline',
        data: parsedPlan.riskMonitoringTriggers,
      },
    ];

    return (
      <>
        <Pressable style={styles.backBtn} onPress={() => { setViewMode('dashboard'); fetchDashboard(); }}>
          <Ionicons name="arrow-back" size={20} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Back to Dashboard</Text>
        </Pressable>

        <View style={[styles.planHeader, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
          <View style={styles.planHeaderTop}>
            <Text style={[styles.planTitle, { color: theme.text }]}>Execution Plan</Text>
            <View style={styles.badgesRow}>
              <StatusBadge status={selectedPlan.status} />
              {selectedPlan.emergencyStopped && (
                <View style={[styles.badge, { backgroundColor: '#FF6B6B20', borderColor: '#FF6B6B' }]}>
                  <Ionicons name="hand-left" size={12} color="#FF6B6B" />
                  <Text style={[styles.badgeText, { color: '#FF6B6B' }]}>STOPPED</Text>
                </View>
              )}
            </View>
          </View>
          {selectedPlan.planSummary && (
            <Text style={[styles.planSummary, { color: theme.textSecondary }]}>{selectedPlan.planSummary}</Text>
          )}
          {selectedPlan.emergencyStoppedReason && (
            <View style={[styles.alertBanner, { backgroundColor: '#FF6B6B10', borderColor: '#FF6B6B40' }]}>
              <Ionicons name="alert-circle-outline" size={16} color="#FF6B6B" />
              <Text style={[styles.alertText, { color: '#FF6B6B' }]}>{selectedPlan.emergencyStoppedReason}</Text>
            </View>
          )}
        </View>

        {progress && (
          <View style={[styles.progressCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.progressHeader}>
              <Text style={[styles.progressTitle, { color: theme.text }]}>Execution Progress</Text>
              <Text style={[styles.progressPercent, { color: theme.primary }]}>{progress.progressPercent}%</Text>
            </View>
            <ProgressBar value={progress.progressPercent} color={theme.primary} height={8} />
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.text }]}>{progress.totalRequired}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Required</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#A78BFA' }]}>{progress.calendarGenerated}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Calendar</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#00D09C' }]}>{progress.ready}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Ready</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#34D399' }]}>{progress.published}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Published</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#FF6B6B' }]}>{progress.failed}</Text>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Failed</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.actionRow}>
          {canApprove && (
            <>
              <Pressable
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => approvePlan(selectedPlan.id)}
                disabled={!!actionLoading}
              >
                {actionLoading === 'approve' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.actionBtnText}>Approve</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => rejectPlan(selectedPlan.id)}
                disabled={!!actionLoading}
              >
                <Ionicons name="close-circle" size={18} color="#fff" />
                <Text style={styles.actionBtnText}>Reject</Text>
              </Pressable>
            </>
          )}
          {canExecuteCalendar && (
            <Pressable
              style={[styles.actionBtn, styles.executeBtn]}
              onPress={() => executeCalendar(selectedPlan.id)}
              disabled={!!actionLoading}
            >
              {actionLoading === 'calendar' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="calendar" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>Generate Calendar</Text>
                </>
              )}
            </Pressable>
          )}
          {canExecuteCreative && (
            <Pressable
              style={[styles.actionBtn, styles.creativeBtn]}
              onPress={() => executeCreative(selectedPlan.id)}
              disabled={!!actionLoading}
            >
              {actionLoading === 'creative' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.actionBtnText}>AI Creative</Text>
                </>
              )}
            </Pressable>
          )}
          {canResume && (
            <Pressable
              style={[styles.actionBtn, styles.resumeBtn]}
              onPress={() => resumePlan(selectedPlan.id)}
              disabled={!!actionLoading}
            >
              <Ionicons name="play" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>Resume</Text>
            </Pressable>
          )}
        </View>

        {!selectedPlan.emergencyStopped && selectedPlan.status !== 'DRAFT' && selectedPlan.status !== 'REJECTED' && (
          <Pressable
            style={[styles.emergencyBtn]}
            onPress={() => emergencyStop(selectedPlan.id)}
            disabled={!!actionLoading}
          >
            <Ionicons name="hand-left" size={16} color="#FF6B6B" />
            <Text style={styles.emergencyBtnText}>Emergency Stop</Text>
          </Pressable>
        )}

        <View style={styles.viewToggle}>
          <Pressable
            style={[styles.toggleBtn, !showAdvanced && { backgroundColor: theme.primary + '20' }]}
            onPress={() => setShowAdvanced(false)}
          >
            <Text style={[styles.toggleText, { color: !showAdvanced ? theme.primary : theme.textSecondary }]}>Simple</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, showAdvanced && { backgroundColor: theme.primary + '20' }]}
            onPress={() => setShowAdvanced(true)}
          >
            <Text style={[styles.toggleText, { color: showAdvanced ? theme.primary : theme.textSecondary }]}>Advanced</Text>
          </Pressable>
        </View>

        {!showAdvanced ? (
          <View style={[styles.simpleView, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            {parsedPlan.contentDistributionPlan?.weeklyCalendar?.length > 0 ? (
              <>
                <Text style={[styles.simpleTitle, { color: theme.text }]}>Weekly Schedule</Text>
                {parsedPlan.contentDistributionPlan.weeklyCalendar.slice(0, 7).map((item: any, idx: number) => (
                  <View key={idx} style={[styles.scheduleRow, { borderBottomColor: theme.divider }]}>
                    <Text style={[styles.scheduleDay, { color: theme.text }]}>{item.day}</Text>
                    <View style={[styles.contentTypeBadge, { backgroundColor: theme.primary + '15' }]}>
                      <Text style={[styles.contentTypeText, { color: theme.primary }]}>{item.contentType}</Text>
                    </View>
                    <Text style={[styles.scheduleTheme, { color: theme.textSecondary }]} numberOfLines={1}>
                      {item.theme}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No distribution data in plan.</Text>
            )}
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.key} style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <Pressable style={styles.sectionHeader} onPress={() => toggleSection(section.key)}>
                <Ionicons name={section.icon as any} size={18} color={theme.primary} />
                <Text style={[styles.sectionHeaderText, { color: theme.text }]}>{section.title}</Text>
                <Ionicons
                  name={expandedSections[section.key] ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={theme.textMuted}
                />
              </Pressable>
              {expandedSections[section.key] && (
                <View style={styles.sectionContent}>
                  {section.data ? (
                    <Text style={[styles.jsonText, { color: theme.textSecondary }]}>
                      {JSON.stringify(section.data, null, 2)}
                    </Text>
                  ) : (
                    <Text style={[styles.emptyText, { color: theme.textMuted }]}>No data for this section.</Text>
                  )}
                </View>
              )}
            </View>
          ))
        )}

        {calendarEntries.length > 0 && (
          <View style={[styles.sectionCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Pressable style={styles.sectionHeader} onPress={() => toggleSection('calendar')}>
              <Ionicons name="calendar-outline" size={18} color="#A78BFA" />
              <Text style={[styles.sectionHeaderText, { color: theme.text }]}>Calendar ({calendarEntries.length})</Text>
              <Ionicons
                name={expandedSections['calendar'] ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.textMuted}
              />
            </Pressable>
            {expandedSections['calendar'] && (
              <View style={styles.sectionContent}>
                {calendarEntries.slice(0, 20).map((entry) => (
                  <View key={entry.id} style={[styles.calendarItem, { borderBottomColor: theme.divider }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.calendarDate, { color: theme.text }]}>
                        {entry.scheduledDate} @ {entry.scheduledTime}
                      </Text>
                      <Text style={[styles.calendarTitle, { color: theme.textSecondary }]}>{entry.title}</Text>
                    </View>
                    <StatusBadge status={entry.status} small />
                  </View>
                ))}
                {calendarEntries.length > 20 && (
                  <Text style={[styles.moreText, { color: theme.textMuted }]}>
                    + {calendarEntries.length - 20} more entries
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <LinearGradient colors={['#EC4899', '#8B5CF6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGradient}>
          <Ionicons name="rocket" size={22} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Execution Machine</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            {viewMode === 'dashboard' ? 'Strategic plan execution pipeline' : 'Plan detail & controls'}
          </Text>
        </View>
        {viewMode === 'dashboard' && (
          <Pressable onPress={fetchDashboard} style={styles.refreshBtn}>
            {loading ? <ActivityIndicator size="small" color={theme.primary} /> : <Ionicons name="refresh" size={20} color={theme.primary} />}
          </Pressable>
        )}
      </View>

      {viewMode === 'dashboard' ? renderDashboard() : renderPlanDetail()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 0 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  centerContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  headerGradient: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  refreshBtn: { padding: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 8, paddingHorizontal: 32 },
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  metricBox: { flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  metricIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  metricValue: { fontSize: 22, fontWeight: '700' },
  metricLabel: { fontSize: 11, marginTop: 2 },
  progressCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  progressTitle: { fontSize: 15, fontWeight: '600' },
  progressPercent: { fontSize: 20, fontWeight: '700' },
  progressTrack: { width: '100%', backgroundColor: '#E2E8F020', borderRadius: 4, overflow: 'hidden' },
  progressFill: { borderRadius: 4 },
  progressLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  statItem: { alignItems: 'center', minWidth: 56 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 10, marginTop: 2 },
  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 12 },
  alertText: { fontSize: 13, flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, marginTop: 8 },
  planCard: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  planCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCardTitle: { fontSize: 15, fontWeight: '600' },
  planCardSummary: { fontSize: 12, marginTop: 4 },
  planCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  planCardDate: { fontSize: 11, marginLeft: 'auto' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  badgeSmall: { paddingHorizontal: 6, paddingVertical: 2 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeDotSmall: { width: 4, height: 4, borderRadius: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeTextSmall: { fontSize: 9 },
  badgesRow: { flexDirection: 'row', gap: 6 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  backText: { fontSize: 14, fontWeight: '500' },
  planHeader: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  planHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planTitle: { fontSize: 18, fontWeight: '700' },
  planSummary: { fontSize: 13, marginTop: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  approveBtn: { backgroundColor: '#34D399' },
  rejectBtn: { backgroundColor: '#FF6B6B' },
  executeBtn: { backgroundColor: '#A78BFA' },
  creativeBtn: { backgroundColor: '#EC4899' },
  resumeBtn: { backgroundColor: '#00D09C' },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B6B',
    backgroundColor: '#FF6B6B10',
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  emergencyBtnText: { color: '#FF6B6B', fontSize: 12, fontWeight: '600' },
  viewToggle: { flexDirection: 'row', gap: 4, marginBottom: 16, alignSelf: 'flex-start' },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  toggleText: { fontSize: 13, fontWeight: '500' },
  simpleView: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  simpleTitle: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  scheduleDay: { fontSize: 13, fontWeight: '600', width: 70 },
  contentTypeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  contentTypeText: { fontSize: 11, fontWeight: '600' },
  scheduleTheme: { fontSize: 12, flex: 1 },
  sectionCard: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  sectionHeaderText: { fontSize: 14, fontWeight: '600', flex: 1 },
  sectionContent: { padding: 14, paddingTop: 0 },
  jsonText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 16 },
  calendarItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  calendarDate: { fontSize: 12, fontWeight: '600' },
  calendarTitle: { fontSize: 11, marginTop: 2 },
  moreText: { fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
