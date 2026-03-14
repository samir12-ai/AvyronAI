import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/query-client';

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
}

export function PlanStatus({ campaignId, isDark, onBuildPlan, onApprovePlan, onViewPlan }: PlanStatusProps) {
  const baseUrl = getApiUrl();
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';

  const { data, isLoading } = useQuery({
    queryKey: ['/api/plans/active', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/plans/active/${campaignId}`, baseUrl).toString());
      return res.json();
    },
    enabled: !!campaignId,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <ActivityIndicator size="small" color={P.mint} />
      </View>
    );
  }

  if (!data?.hasPlan) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.row}>
          <View style={[s.iconCircle, { backgroundColor: P.mint + '15' }]}>
            <Ionicons name="document-text-outline" size={20} color={P.mint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: textPrimary }]}>No Active Plan</Text>
            <Text style={[s.subtitle, { color: textSecondary }]}>Run the orchestrator to generate your strategic plan</Text>
          </View>
        </View>
        <Pressable style={[s.actionBtn, { backgroundColor: P.mint }]} onPress={onBuildPlan}>
          <Ionicons name="flash" size={16} color="#fff" />
          <Text style={s.actionBtnText}>Build The Plan</Text>
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
    plan.status === 'APPROVED' ? P.neon :
    plan.status === 'REJECTED' ? P.coral :
    P.gold;

  const statusLabel =
    plan.status === 'APPROVED' ? 'Approved' :
    plan.status === 'REJECTED' ? 'Rejected' :
    'Awaiting Approval';

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={s.row}>
        <View style={[s.iconCircle, { backgroundColor: statusColor + '15' }]}>
          <Ionicons
            name={plan.status === 'APPROVED' ? 'checkmark-circle' : plan.status === 'REJECTED' ? 'close-circle' : 'time'}
            size={20}
            color={statusColor}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.title, { color: textPrimary }]}>The Plan</Text>
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
        {plan.status === 'DRAFT' && onApprovePlan && (
          <Pressable style={[s.actionBtn, { backgroundColor: P.neon, flex: 1 }]} onPress={() => onApprovePlan(plan.id)}>
            <Ionicons name="checkmark" size={16} color="#000" />
            <Text style={[s.actionBtnText, { color: '#000' }]}>Approve</Text>
          </Pressable>
        )}
        {onViewPlan && (
          <Pressable
            style={[s.outlineBtn, { borderColor: P.mint + '40', flex: plan.status === 'DRAFT' ? 1 : undefined }]}
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
