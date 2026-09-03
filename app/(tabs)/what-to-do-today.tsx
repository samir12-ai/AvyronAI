import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useWhatToDoToday, ExecutionTaskItem, ChannelPlanItem } from '@/hooks/useWhatToDoToday';
import { useAppShellController } from '@/hooks/useAppShellController';
import { GlobalHeader } from '@/components/GlobalHeader';
import { TaskDetailModal } from '@/components/what-to-do-today/TaskDetailModal';
import { TaskExecutionWorkspace } from '@/components/what-to-do-today/TaskExecutionWorkspace';

export default function WhatToDoTodayScreen() {
  const router = useRouter();
  const shellController = useAppShellController();
  const campaignId = shellController.activeWorkspace?.id || 'campaign_1773576062201_6t0oxi';
  const { data, loading, refreshing, error, refetch, forceRegenerate, updateTaskStatus } = useWhatToDoToday(campaignId);
  const [selectedTask, setSelectedTask] = useState<ExecutionTaskItem | null>(null);
  const [activeExecutionTask, setActiveExecutionTask] = useState<ExecutionTaskItem | null>(null);

  const getChannelIcon = (ch: string) => {
    switch (ch.toUpperCase()) {
      case 'YOUTUBE': return 'video';
      case 'INSTAGRAM': return 'instagram';
      case 'TIKTOK': return 'film';
      case 'FACEBOOK': return 'facebook';
      case 'X': return 'twitter';
      default: return 'globe';
    }
  };

  const handleStartTask = async (task: ExecutionTaskItem) => {
    if (task.status === 'PLANNED') {
      await updateTaskStatus(task.id, 'ACTIVE');
      setActiveExecutionTask({ ...task, status: 'ACTIVE' });
    } else {
      setActiveExecutionTask(task);
    }
    setSelectedTask(null);
  };

  const renderTaskCard = (task: ExecutionTaskItem) => {
    const isDone = task.status === 'DONE';
    const isActive = task.status === 'ACTIVE';
    const isBlocked = task.status === 'BLOCKED' || task.priority === 'WAITING_BLOCKED';

    return (
      <Pressable
        key={task.id}
        style={[
          styles.taskCard,
          isDone && styles.taskCardDone,
          isActive && styles.taskCardActive,
          isBlocked && styles.taskCardBlocked,
        ]}
        onPress={() => setSelectedTask(task)}
      >
        <View style={styles.taskCardHeader}>
          <View style={styles.taskCardHeaderLeft}>
            <View style={[styles.channelPill, task.channelRole === 'PRIMARY' && styles.channelPillPrimary]}>
              <Feather
                name={getChannelIcon(task.channel) as any}
                size={12}
                color={task.channelRole === 'PRIMARY' ? '#A78BFA' : '#94A3B8'}
              />
              <Text style={[styles.channelPillText, task.channelRole === 'PRIMARY' && styles.channelPillTextPrimary]}>
                {task.channel} {task.channelRole === 'PRIMARY' && '• PRIMARY'}
              </Text>
            </View>

            {task.estimatedEffort && (
              <View style={styles.effortPill}>
                <Feather name="clock" size={11} color="#94A3B8" />
                <Text style={styles.effortPillText}>{task.estimatedEffort}</Text>
              </View>
            )}

            {isActive && (
              <View style={styles.inProgressBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.inProgressText}>IN PROGRESS</Text>
              </View>
            )}
          </View>

          <Pressable
            style={[styles.statusToggle, isDone && styles.statusToggleDone]}
            onPress={(e) => {
              e.stopPropagation();
              updateTaskStatus(task.id, isDone ? 'PLANNED' : 'DONE');
            }}
          >
            <Feather
              name={isDone ? 'check-circle' : 'circle'}
              size={20}
              color={isDone ? '#10B981' : '#64748B'}
            />
          </Pressable>
        </View>

        <Text style={[styles.taskCardTitle, isDone && styles.taskCardTitleDone]}>
          {task.title}
        </Text>

        {task.reason && (
          <Text style={[styles.taskCardReason, isDone && styles.taskCardReasonDone]} numberOfLines={2}>
            {task.reason}
          </Text>
        )}

        <View style={styles.taskCardFooter}>
          <View style={styles.objectivePill}>
            <Feather name="target" size={12} color="#8B5CF6" />
            <Text style={styles.objectiveText} numberOfLines={1}>
              {task.objective || task.taskType}
            </Text>
          </View>

          <View style={styles.taskCardActions}>
            {!isDone && (
              <Pressable
                style={[styles.startActionBtn, isActive && styles.continueActionBtn]}
                onPress={(e) => {
                  e.stopPropagation();
                  handleStartTask(task);
                }}
              >
                <Feather name={isActive ? 'film' : 'play'} size={12} color="#FFFFFF" />
                <Text style={styles.startActionBtnText}>
                  {isActive ? 'Open Script Studio' : 'Start & View Script'}
                </Text>
              </Pressable>
            )}

            <View style={styles.openDetailLink}>
              <Text style={styles.openDetailText}>Details</Text>
              <Feather name="chevron-right" size={14} color="#A78BFA" />
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  const renderChannelCard = (cp: ChannelPlanItem) => {
    const isPrimary = cp.role === 'PRIMARY';

    return (
      <View key={cp.channel} style={[styles.channelCard, isPrimary && styles.channelCardPrimary]}>
        <View style={styles.channelCardTop}>
          <View style={styles.channelCardIconWrap}>
            <Feather
              name={getChannelIcon(cp.channel) as any}
              size={18}
              color={isPrimary ? '#A78BFA' : '#94A3B8'}
            />
            <Text style={[styles.channelCardName, isPrimary && styles.channelCardNamePrimary]}>
              {cp.channel}
            </Text>
          </View>
          <View style={[styles.roleBadge, isPrimary ? styles.roleBadgePrimary : styles.roleBadgeSupporting]}>
            <Text style={[styles.roleBadgeText, isPrimary ? styles.roleBadgeTextPrimary : styles.roleBadgeTextSupporting]}>
              {cp.role}
            </Text>
          </View>
        </View>

        <Text style={styles.channelIntentText}>{cp.executionIntent}</Text>

        <View style={styles.channelStatusRow}>
          <View style={[styles.coverageDot, cp.coverageState === 'ACTIVE' ? styles.dotActive : styles.dotPending]} />
          <Text style={styles.channelStatusText}>
            {cp.currentTaskTitle ? `Active: ${cp.currentTaskTitle}` : cp.whyToday}
          </Text>
        </View>
      </View>
    );
  };

  if (activeExecutionTask) {
    return (
      <TaskExecutionWorkspace
        task={activeExecutionTask}
        onBack={() => setActiveExecutionTask(null)}
        onUpdateStatus={async (taskId, status) => {
          await updateTaskStatus(taskId, status);
          if (activeExecutionTask.id === taskId) {
            setActiveExecutionTask({ ...activeExecutionTask, status });
          }
        }}
      />
    );
  }

  if (loading && !data) {
    return (
      <View style={styles.screen}>
        <GlobalHeader
          title="What To Do Today"
          subtitle="Daily execution brain grounded in approved strategy"
        />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Assembling Today's Execution Plan…</Text>
        </View>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.screen}>
        <GlobalHeader
          title="What To Do Today"
          subtitle="Daily execution brain grounded in approved strategy"
        />
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={36} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
            <Pressable 
              style={[styles.retryButton, { backgroundColor: '#7C3AED' }]} 
              onPress={() => router.push('/(tabs)/strategy-plan')}
            >
              <Text style={styles.retryButtonText}>Open Strategy Plan</Text>
            </Pressable>
            <Pressable style={styles.retryButton} onPress={() => refetch()}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const { mustDo = [], shouldDo = [], optional = [], waitingBlocked = [], completed = [] } = data?.tasksByPriority || {};

  return (
    <View style={styles.screen}>
      <GlobalHeader
        title="What To Do Today"
        subtitle="Daily execution command center converting strategy to channel-native action"
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor="#8B5CF6" />}
      >
        {/* Header Metadata Ribbon */}
        <View style={styles.ribbon}>
          <View style={styles.ribbonLeft}>
            <View style={styles.dateBadge}>
              <Feather name="calendar" size={13} color="#94A3B8" />
              <Text style={styles.dateBadgeText}>{data?.businessDate || 'Today'}</Text>
            </View>
            <View style={styles.strategyBadge}>
              <Feather name="shield" size={12} color="#34D399" />
              <Text style={styles.strategyBadgeText}>
                Root v{data?.strategyRootVersion} • {data?.strategyName}
              </Text>
            </View>
          </View>

          <View style={styles.primaryChannelBadge}>
            <Feather name="star" size={12} color="#A78BFA" />
            <Text style={styles.primaryChannelBadgeText}>
              Primary Anchor: {data?.primaryChannel}
            </Text>
          </View>
        </View>

        {/* Today's Mission Banner */}
        <View style={styles.missionCard}>
          <View style={styles.missionHeader}>
            <View style={styles.missionIconWrap}>
              <Feather name="compass" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.missionLabel}>TODAY'S MISSION</Text>
          </View>
          <Text style={styles.missionText}>{data?.dailyMission}</Text>
          {data?.executionRationale ? (
            <Text style={styles.rationaleText}>{data?.executionRationale}</Text>
          ) : null}
        </View>

        {/* Section 1: MUST DO TODAY */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWrap}>
              <View style={styles.sectionIndicatorMustDo} />
              <Text style={styles.sectionTitle}>MUST DO TODAY</Text>
              <View style={[styles.countBadge, styles.countBadgeMustDo]}>
                <Text style={styles.countBadgeTextMustDo}>{mustDo.length}</Text>
              </View>
            </View>
            <Text style={styles.sectionSubtitle}>Core strategic priorities for today</Text>
          </View>

          {mustDo.length > 0 ? (
            <View style={styles.taskGrid}>{mustDo.map(renderTaskCard)}</View>
          ) : (
            <View style={styles.emptyCard}>
              <Feather name="check-circle" size={18} color="#10B981" />
              <Text style={styles.emptyText}>All Must-Do priority tasks are completed for today.</Text>
            </View>
          )}
        </View>

        {/* Section 2: SHOULD DO */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWrap}>
              <View style={styles.sectionIndicatorShouldDo} />
              <Text style={styles.sectionTitle}>SHOULD DO</Text>
              <View style={[styles.countBadge, styles.countBadgeShouldDo]}>
                <Text style={styles.countBadgeTextShouldDo}>{shouldDo.length}</Text>
              </View>
            </View>
            <Text style={styles.sectionSubtitle}>Important supporting and distribution tasks</Text>
          </View>

          {shouldDo.length > 0 ? (
            <View style={styles.taskGrid}>{shouldDo.map(renderTaskCard)}</View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No secondary tasks remaining.</Text>
            </View>
          )}
        </View>

        {/* Section 3: CHANNEL EXECUTION ECOSYSTEM */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionTitleWrap}>
              <Feather name="share-2" size={16} color="#8B5CF6" />
              <Text style={styles.sectionTitle}>CHANNEL EXECUTION ECOSYSTEM</Text>
            </View>
            <Text style={styles.sectionSubtitle}>Multi-platform native distribution strategy</Text>
          </View>

          <View style={styles.channelGrid}>
            {data?.channelPlan?.map(renderChannelCard)}
          </View>
        </View>

        {/* Section 4: WAITING / BLOCKED (if any) */}
        {waitingBlocked.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleWrap}>
                <Feather name="pause-circle" size={16} color="#F59E0B" />
                <Text style={[styles.sectionTitle, { color: '#FCD34D' }]}>WAITING / PREREQUISITE</Text>
                <View style={[styles.countBadge, styles.countBadgeBlocked]}>
                  <Text style={styles.countBadgeTextBlocked}>{waitingBlocked.length}</Text>
                </View>
              </View>
              <Text style={styles.sectionSubtitle}>Tasks staged to execute once prerequisites complete</Text>
            </View>

            <View style={styles.taskGrid}>{waitingBlocked.map(renderTaskCard)}</View>
          </View>
        )}

        {/* Section 5: COMPLETED TODAY */}
        {completed.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionTitleWrap}>
                <Feather name="check-circle" size={16} color="#10B981" />
                <Text style={[styles.sectionTitle, { color: '#34D399' }]}>COMPLETED TODAY</Text>
                <View style={[styles.countBadge, styles.countBadgeCompleted]}>
                  <Text style={styles.countBadgeTextCompleted}>{completed.length}</Text>
                </View>
              </View>
            </View>

            <View style={styles.taskGrid}>{completed.map(renderTaskCard)}</View>
          </View>
        )}
      </ScrollView>

      {/* Task Detailed Guidance Modal */}
      <TaskDetailModal
        task={selectedTask}
        visible={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        onStartTask={(task) => handleStartTask(task)}
        onUpdateStatus={async (taskId, status) => {
          await updateTaskStatus(taskId, status);
          if (selectedTask && selectedTask.id === taskId) {
            setSelectedTask({ ...selectedTask, status });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  errorText: {
    marginTop: 12,
    fontSize: 14,
    color: '#F87171',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  ribbon: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    flexWrap: 'wrap',
    gap: 10,
  },
  ribbonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  dateBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  strategyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  strategyBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6EE7B7',
  },
  primaryChannelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  primaryChannelBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  missionCard: {
    backgroundColor: '#1E1B4B',
    borderRadius: 14,
    padding: 20,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#4338CA',
    ...Platform.select({
      web: {
        boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.3)',
      },
    }),
  },
  missionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  missionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  missionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A5B4FC',
    letterSpacing: 1,
  },
  missionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
    lineHeight: 24,
    marginBottom: 8,
  },
  rationaleText: {
    fontSize: 13,
    color: '#C7D2FE',
    lineHeight: 19,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionIndicatorMustDo: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#EF4444',
  },
  sectionIndicatorShouldDo: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: '#F59E0B',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
  },
  countBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeMustDo: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  countBadgeTextMustDo: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  countBadgeShouldDo: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  countBadgeTextShouldDo: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCD34D',
  },
  countBadgeBlocked: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  countBadgeTextBlocked: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCD34D',
  },
  countBadgeCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  countBadgeTextCompleted: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6EE7B7',
  },
  taskGrid: {
    gap: 12,
  },
  taskCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
  },
  taskCardActive: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1E2238',
  },
  taskCardDone: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    opacity: 0.65,
  },
  taskCardBlocked: {
    borderColor: '#B45309',
    backgroundColor: '#261C14',
  },
  taskCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  taskCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  channelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  channelPillPrimary: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  channelPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  channelPillTextPrimary: {
    color: '#C4B5FD',
  },
  effortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  effortPillText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  inProgressBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#A78BFA',
  },
  inProgressText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#C4B5FD',
  },
  statusToggle: {
    padding: 4,
  },
  statusToggleDone: {},
  taskCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    lineHeight: 21,
    marginBottom: 6,
  },
  taskCardTitleDone: {
    textDecorationLine: 'line-through',
    color: '#64748B',
  },
  taskCardReason: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 18,
    marginBottom: 12,
  },
  taskCardReasonDone: {
    color: '#475569',
  },
  taskCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#33415540',
    paddingTop: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  objectivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 150,
  },
  objectiveText: {
    fontSize: 12,
    color: '#C4B5FD',
    fontWeight: '600',
  },
  taskCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  startActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  continueActionBtn: {
    backgroundColor: '#059669',
  },
  startActionBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  openDetailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  openDetailText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A78BFA',
  },
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  channelCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
  },
  channelCardPrimary: {
    borderColor: '#8B5CF6',
    backgroundColor: '#1E2238',
  },
  channelCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  channelCardIconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  channelCardName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  channelCardNamePrimary: {
    color: '#C4B5FD',
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgePrimary: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  roleBadgeSupporting: {
    backgroundColor: '#0F172A',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  roleBadgeTextPrimary: {
    color: '#C4B5FD',
  },
  roleBadgeTextSupporting: {
    color: '#94A3B8',
  },
  channelIntentText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 17,
    marginBottom: 10,
  },
  channelStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#33415540',
    paddingTop: 8,
  },
  coverageDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotActive: {
    backgroundColor: '#10B981',
  },
  dotPending: {
    backgroundColor: '#F59E0B',
  },
  channelStatusText: {
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
  },
});
