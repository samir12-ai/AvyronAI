import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl , authFetch } from '@/lib/query-client';

const P = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
};

interface PlanStatusProps {
  campaignId: string;
  isDark: boolean;
  onBuildPlan: () => void;
  onApprovePlan?: (planId: string) => void;
  onViewPlan?: (planId: string) => void;
  isApproving?: boolean;
}

export function PlanStatus({ campaignId, isDark, onBuildPlan, onApprovePlan, onViewPlan, isApproving }: PlanStatusProps) {
  const baseUrl = getApiUrl();
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';

  const { data, isLoading } = useQuery({
    queryKey: ['/api/plans/active', campaignId],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/plans/active/${campaignId}`, baseUrl).toString());
      return res.json();
    },
    enabled: !!campaignId,
    refetchInterval: 10000,
  });

  const pipelineState = data?.pipelineState;
  const isPipelineBlocked = pipelineState?.isBlocked === true;
  const isPipelineFailed = pipelineState?.isFailed === true;
  const isPlanStale = pipelineState?.isPlanStale === true;

  if (isLoading) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <ActivityIndicator size="small" color={P.mint} />
      </View>
    );
  }

  if (!data?.hasPlan) {
    const noPlanBlocked = data?.pipelineState?.isBlocked === true;
    const noPlanFailed = data?.pipelineState?.isFailed === true;
    const noPlanBlockReason = data?.pipelineState?.blockReason;

    return (
      <View style={[s.card, {
        backgroundColor: cardBg,
        borderColor: (noPlanBlocked || noPlanFailed) ? (P.gold + '40') : cardBorder,
      }]}>
        {(noPlanBlocked || noPlanFailed) && (
          <View style={{
            backgroundColor: isDark ? '#1A1400' : '#FFFBEB',
            borderRadius: 8,
            padding: 10,
            marginBottom: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
          }}>
            <Ionicons name="warning-outline" size={16} color={P.gold} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '600' as const, color: P.gold }}>
                Pipeline {noPlanBlocked ? 'Blocked' : 'Failed'}
              </Text>
              {noPlanBlockReason && (
                <Text style={{ fontSize: 11, color: isDark ? '#8892A4' : '#546478', marginTop: 2 }} numberOfLines={2}>
                  {noPlanBlockReason}
                </Text>
              )}
            </View>
          </View>
        )}
        <View style={s.row}>
          <View style={[s.iconCircle, {
            backgroundColor: (noPlanBlocked || noPlanFailed) ? (P.gold + '15') : (P.mint + '15'),
          }]}>
            <Ionicons
              name={(noPlanBlocked || noPlanFailed) ? 'alert-circle-outline' : 'document-text-outline'}
              size={20}
              color={(noPlanBlocked || noPlanFailed) ? P.gold : P.mint}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: textPrimary }]}>No Active Plan</Text>
            <Text style={[s.subtitle, { color: textSecondary }]}>
              {(noPlanBlocked || noPlanFailed)
                ? 'The pipeline could not generate a plan. Resolve the issues and re-run.'
                : 'Run the orchestrator to generate your strategic plan'}
            </Text>
          </View>
        </View>
        <Pressable style={[s.actionBtn, { backgroundColor: P.mint }]} onPress={onBuildPlan}>
          <Ionicons name="flash" size={16} color="#fff" />
          <Text style={s.actionBtnText}>
            {(noPlanBlocked || noPlanFailed) ? 'Re-run Pipeline' : 'Build The Plan'}
          </Text>
        </Pressable>
      </View>
    );
  }

  const plan = data.plan;
  const work = data.requiredWork;
  const progress = work
    ? Math.round(((work.generated + work.ready + work.published) / Math.max(work.totalPieces, 1)) * 100)
    : 0;

  const statusColor =
    isPlanStale ? P.gold :
    plan.status === 'APPROVED' ? P.neon :
    plan.status === 'REJECTED' ? P.coral :
    P.gold;

  const statusLabel =
    isPlanStale ? 'Previous Run' :
    plan.status === 'APPROVED' ? 'Approved' :
    plan.status === 'REJECTED' ? 'Rejected' :
    'Awaiting Approval';

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: isPlanStale ? (P.gold + '40') : cardBorder }]}>
      {isPlanStale && (
        <View style={{
          backgroundColor: isDark ? '#1A1400' : '#FFFBEB',
          borderRadius: 8,
          padding: 10,
          marginBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          <Ionicons name="warning-outline" size={16} color={P.gold} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: '600' as const, color: P.gold }}>
              Current pipeline is {isPipelineBlocked ? 'blocked' : 'failed'}
            </Text>
            {pipelineState?.blockReason && (
              <Text style={{ fontSize: 11, color: isDark ? '#8892A4' : '#546478', marginTop: 2 }} numberOfLines={2}>
                {pipelineState.blockReason}
              </Text>
            )}
            <Text style={{ fontSize: 11, color: isDark ? '#4A5568' : '#8A96A8', marginTop: 2 }}>
              This plan is from a previous successful run
            </Text>
          </View>
        </View>
      )}
      <View style={s.row}>
        <View style={[s.iconCircle, { backgroundColor: statusColor + '15' }]}>
          <Ionicons
            name={isPlanStale ? 'time-outline' : plan.status === 'APPROVED' ? 'checkmark-circle' : plan.status === 'REJECTED' ? 'close-circle' : 'time'}
            size={20}
            color={statusColor}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.title, { color: textPrimary }]}>{isPlanStale ? 'Previous Plan' : 'The Plan'}</Text>
            <View style={[s.badge, { backgroundColor: statusColor + '20' }]}>
              <Text style={[s.badgeText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
          {plan.summary && (
            <Text style={[s.subtitle, { color: textSecondary }]} numberOfLines={2}>{plan.summary}</Text>
          )}
        </View>
      </View>

      {work && (
        <View style={s.progressSection}>
          <View style={s.progressHeader}>
            <Text style={[s.progressLabel, { color: textSecondary }]}>Plan Progress</Text>
            <Text style={[s.progressValue, { color: P.mint }]}>{progress}%</Text>
          </View>
          <View style={[s.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E5EBE7' }]}>
            <View style={[s.progressFill, { width: `${progress}%`, backgroundColor: P.mint }]} />
          </View>
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={[s.statValue, { color: textPrimary }]}>{work.totalPieces}</Text>
              <Text style={[s.statLabel, { color: textSecondary }]}>Required</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, { color: P.blue }]}>{work.generated + work.ready}</Text>
              <Text style={[s.statLabel, { color: textSecondary }]}>Created</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, { color: P.neon }]}>{work.published}</Text>
              <Text style={[s.statLabel, { color: textSecondary }]}>Published</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statValue, { color: P.coral }]}>{work.remaining}</Text>
              <Text style={[s.statLabel, { color: textSecondary }]}>Remaining</Text>
            </View>
          </View>
        </View>
      )}

      <View style={s.btnRow}>
        {(plan.status === 'DRAFT' || plan.status === 'READY_FOR_REVIEW') && onApprovePlan && (
          <Pressable
            style={[s.actionBtn, { backgroundColor: P.neon, flex: 1, opacity: isApproving ? 0.7 : 1 }]}
            onPress={() => !isApproving && onApprovePlan(plan.id)}
            disabled={isApproving}
          >
            {isApproving
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="checkmark" size={16} color="#000" />
            }
            <Text style={[s.actionBtnText, { color: '#000' }]}>{isApproving ? 'Approving...' : 'Approve'}</Text>
          </Pressable>
        )}
        {onViewPlan && (
          <Pressable
            style={[s.outlineBtn, { borderColor: P.mint + '40', flex: (plan.status === 'DRAFT' || plan.status === 'READY_FOR_REVIEW') ? 1 : undefined }]}
            onPress={() => onViewPlan(plan.id)}
          >
            <Text style={[s.outlineBtnText, { color: P.mint }]}>View Plan</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700' as const },
  subtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '600' as const },
  progressSection: { marginTop: 4 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 12 },
  progressValue: { fontSize: 14, fontWeight: '700' as const },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' as const },
  progressFill: { height: 6, borderRadius: 3 },
  statsRow: { flexDirection: 'row', marginTop: 12, gap: 4 },
  statItem: { flex: 1, alignItems: 'center' as const },
  statValue: { fontSize: 18, fontWeight: '700' as const },
  statLabel: { fontSize: 10, marginTop: 2 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' as const },
  outlineBtn: { borderWidth: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 12, borderRadius: 12, paddingHorizontal: 20 },
  outlineBtnText: { fontSize: 14, fontWeight: '600' as const },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
