import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/query-client';

const P = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  orange: '#FFB347',
};

interface RequiredWorkCardProps {
  campaignId: string;
  isDark: boolean;
}

const BRANCH_CONFIG = {
  REELS: { icon: 'videocam' as const, color: P.coral, label: 'Reels' },
  POSTS: { icon: 'image' as const, color: P.blue, label: 'Posts' },
  STORIES: { icon: 'flash' as const, color: P.gold, label: 'Stories' },
};

export function RequiredWorkCard({ campaignId, isDark }: RequiredWorkCardProps) {
  const baseUrl = getApiUrl();
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';

  const { data, isLoading } = useQuery({
    queryKey: ['/api/required-work', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/required-work/${campaignId}`, baseUrl).toString());
      return res.json();
    },
    enabled: !!campaignId,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <ActivityIndicator size="small" color={P.mint} />
      </View>
    );
  }

  if (!data?.hasWork && !data?.branches) return null;

  const totalRemaining = data.remaining ?? 0;
  const todayItems = data.todayWork || [];
  const weekItems = data.weekWork || [];
  const branches = data.branches || {};

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={s.header}>
        <Ionicons name="clipboard-outline" size={18} color={P.mint} />
        <Text style={[s.headerText, { color: textPrimary }]}>Required Work</Text>
        <View style={[s.headerBadge, { backgroundColor: totalRemaining > 0 ? P.coral + '20' : P.neon + '20' }]}>
          <Text style={[s.headerBadgeText, { color: totalRemaining > 0 ? P.coral : P.neon }]}>
            {totalRemaining} remaining
          </Text>
        </View>
      </View>

      {todayItems.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: P.gold }]}>Today</Text>
          {todayItems.map((item: any) => (
            <View key={item.id} style={[s.workItem, { backgroundColor: isDark ? '#151B24' : '#F4F7F5' }]}>
              <Ionicons
                name="document-outline"
                size={14}
                color={textSecondary}
              />
              <Text style={[s.workItemText, { color: textPrimary }]}>{item.title || item.contentType}</Text>
              <Text style={[s.workItemTime, { color: textSecondary }]}>{item.scheduledTime}</Text>
            </View>
          ))}
        </View>
      )}

      {weekItems.length > 0 && todayItems.length === 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: P.blue }]}>This Week ({weekItems.length} items)</Text>
          {weekItems.slice(0, 5).map((item: any) => (
            <View key={item.id} style={[s.workItem, { backgroundColor: isDark ? '#151B24' : '#F4F7F5' }]}>
              <Ionicons
                name="document-outline"
                size={14}
                color={textSecondary}
              />
              <Text style={[s.workItemText, { color: textPrimary }]}>{item.title || item.contentType}</Text>
              <Text style={[s.workItemTime, { color: textSecondary }]}>{item.scheduledDate}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.breakdownGrid}>
        {(['REELS', 'POSTS', 'STORIES'] as const).map((key) => {
          const config = BRANCH_CONFIG[key];
          const branch = branches[key];
          if (!branch) return null;
          const remaining = branch.remaining ?? 0;
          const required = branch.required ?? 0;
          const fulfilled = branch.fulfilled ?? 0;
          return (
            <View key={key} style={[s.breakdownItem, { backgroundColor: isDark ? '#151B24' : '#F4F7F5' }]}>
              <Ionicons name={config.icon} size={16} color={config.color} />
              <Text style={[s.breakdownValue, { color: textPrimary }]}>{remaining}</Text>
              <Text style={[s.breakdownLabel, { color: textSecondary }]}>{config.label}</Text>
              <Text style={[s.breakdownRate, { color: textSecondary }]}>{fulfilled}/{required}</Text>
            </View>
          );
        })}
      </View>

      {data.progressPercent != null && data.progressPercent > 0 && (
        <View style={s.progressContainer}>
          <View style={[s.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={[s.progressFill, { width: `${Math.min(100, data.progressPercent)}%`, backgroundColor: P.mint }]} />
          </View>
          <Text style={[s.progressText, { color: textSecondary }]}>{data.progressPercent}% complete</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerText: { fontSize: 15, fontWeight: '700' as const, flex: 1 },
  headerBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  headerBadgeText: { fontSize: 11, fontWeight: '600' as const },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '600' as const, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  workItem: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, marginBottom: 4 },
  workItemText: { flex: 1, fontSize: 13, fontWeight: '500' as const },
  workItemTime: { fontSize: 11 },
  breakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  breakdownItem: { borderRadius: 10, padding: 10, alignItems: 'center' as const, minWidth: 70, flex: 1 },
  breakdownValue: { fontSize: 20, fontWeight: '700' as const, marginTop: 4 },
  breakdownLabel: { fontSize: 10, textTransform: 'capitalize' as const, marginTop: 2 },
  breakdownRate: { fontSize: 9, marginTop: 1 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' as const },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 10 },
});
