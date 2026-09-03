import { useState, useEffect, useCallback } from 'react';
import { apiRequest, safeApiJson } from '@/lib/query-client';

export interface ExecutionTaskItem {
  id: string;
  executionDayId: string;
  campaignId: string;
  strategyRootId: string;
  laneId?: string | null;
  title: string;
  description: string;
  taskType: string;
  priority: 'MUST_DO' | 'SHOULD_DO' | 'OPTIONAL' | 'WAITING_BLOCKED';
  status: 'PLANNED' | 'ACTIVE' | 'DONE' | 'MISSED' | 'BLOCKED' | 'DEFERRED' | 'STALE' | 'CANCELLED' | 'REPLACED';
  channel: string;
  channelRole: 'PRIMARY' | 'SUPPORTING' | 'TESTING';
  objective?: string | null;
  reason?: string | null;
  expectedOutcome?: string | null;
  sourceAuthority?: string | null;
  sourceDecisionIds?: string[] | null;
  estimatedEffort?: string | null;
  sequenceOrder: number;
  dependencies?: string[] | null;
  executionApproach?: string | null;
  proofRequired?: string | null;
  ctaDestination?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface ChannelPlanItem {
  channel: string;
  role: string;
  executionIntent: string;
  whyToday: string;
  currentTaskTitle?: string | null;
  coverageState: string;
  recentTaskCount?: number;
  recentCompletedTaskCount?: number;
}

export interface ExecutionDayData {
  executionDayId: string;
  campaignId: string;
  accountId: string;
  businessDate: string;
  strategyRootId: string;
  strategyRootVersion: number;
  strategicPlanId: string;
  strategicPlanVersion: number;
  strategyName: string;
  dailyMission: string;
  executionRationale: string;
  status: string;
  primaryChannel: string;
  tasks: ExecutionTaskItem[];
  tasksByPriority: {
    mustDo: ExecutionTaskItem[];
    shouldDo: ExecutionTaskItem[];
    optional: ExecutionTaskItem[];
    waitingBlocked: ExecutionTaskItem[];
    completed: ExecutionTaskItem[];
  };
  channelPlan: ChannelPlanItem[];
  generatedAt: string;
}

export function useWhatToDoToday(campaignId?: string | null) {
  const [data, setData] = useState<ExecutionDayData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(async (isRefresh: boolean = false, force: boolean = false) => {
    if (!campaignId) {
      setLoading(false);
      return;
    }

    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const url = `/api/what-to-do-today/today/${campaignId}${force ? '?force=true' : ''}`;
      const res = await apiRequest('GET', url);
      const json = await safeApiJson(res);
      if (json && json.executionDayId) {
        setData(json);
      } else {
        setError(json?.error || 'Failed to load execution plan');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred loading today\'s execution plan');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const updateTaskStatus = async (taskId: string, newStatus: ExecutionTaskItem['status']) => {
    if (!data) return;

    // Optimistic UI update
    const previousData = { ...data };
    const updatedTasks = data.tasks.map(t =>
      t.id === taskId
        ? { ...t, status: newStatus, completedAt: newStatus === 'DONE' ? new Date().toISOString() : null }
        : t
    );

    const mustDo = updatedTasks.filter(t => t.priority === 'MUST_DO' && t.status !== 'DONE');
    const shouldDo = updatedTasks.filter(t => t.priority === 'SHOULD_DO' && t.status !== 'DONE');
    const optional = updatedTasks.filter(t => t.priority === 'OPTIONAL' && t.status !== 'DONE');
    const waitingBlocked = updatedTasks.filter(t => t.priority === 'WAITING_BLOCKED' || t.status === 'BLOCKED');
    const completed = updatedTasks.filter(t => t.status === 'DONE');

    setData({
      ...data,
      tasks: updatedTasks,
      tasksByPriority: {
        mustDo,
        shouldDo,
        optional,
        waitingBlocked,
        completed,
      },
    });

    try {
      const res = await apiRequest('POST', `/api/what-to-do-today/tasks/${taskId}/status`, { status: newStatus });
      await safeApiJson(res);
    } catch (err: any) {
      console.warn('[useWhatToDoToday] Failed to persist task status change:', err);
      // Revert optimistic update on failure
      setData(previousData);
    }
  };

  return {
    data,
    loading,
    refreshing,
    error,
    refetch: () => fetchPlan(true, false),
    forceRegenerate: () => fetchPlan(true, true),
    updateTaskStatus,
  };
}
