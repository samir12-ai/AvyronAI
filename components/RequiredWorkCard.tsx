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

const CONTENT_TYPE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  reels: { icon: 'videocam', color: P.coral },
  posts: { icon: 'image', color: P.blue },
  stories: { icon: 'flash', color: P.gold },
  carousels: { icon: 'layers', color: P.mint },
  videos: { icon: 'film', color: P.orange },
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

  if (!data?.hasWork) return null;

  const todayItems = data.todayWork || [];
  const weekItems = data.weekWork || [];
  const breakdown = data.breakdown || {};

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={s.header}>
        <Ionicons name="clipboard-outline" size={18} color={P.mint} />
        <Text style={[s.headerText, { color: textPrimary }]}>Required Work</Text>
        <View style={[s.headerBadge, { backgroundColor: P.coral + '20' }]}>
          <Text style={[s.headerBadgeText, { color: P.coral }]}>{data.remaining} remaining</Text>
        </View>
      </View>

      {todayItems.length > 0 && (
        <View style={s.section}>
          <Text style={[s.sectionTitle, { color: P.gold }]}>Today</Text>
          {todayItems.map((item: any) => (
            <View key={item.id} style={[s.workItem, { backgroundColor: isDark ? '#151B24' : '#F4F7F5' }]}>
              <Ionicons
                name={(CONTENT_TYPE_ICONS[item.contentType?.toLowerCase()]?.icon || 'document') as any}
                size={14}
                color={CONTENT_TYPE_ICONS[item.contentType?.toLowerCase()]?.color || textSecondary}
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
                name={(CONTENT_TYPE_ICONS[item.contentType?.toLowerCase()]?.icon || 'document') as any}
                size={14}
                color={CONTENT_TYPE_ICONS[item.contentType?.toLowerCase()]?.color || textSecondary}
              />
              <Text style={[s.workItemText, { color: textPrimary }]}>{item.title || item.contentType}</Text>
              <Text style={[s.workItemTime, { color: textSecondary }]}>{item.scheduledDate}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.breakdownGrid}>
        {Object.entries(breakdown).map(([type, info]: [string, any]) => {
          const config = CONTENT_TYPE_ICONS[type] || { icon: 'document', color: textSecondary };
          return (
            <View key={type} style={[s.breakdownItem, { backgroundColor: isDark ? '#151B24' : '#F4F7F5' }]}>
              <Ionicons name={config.icon as any} size={16} color={config.color} />
              <Text style={[s.breakdownValue, { color: textPrimary }]}>{info.required}</Text>
              <Text style={[s.breakdownLabel, { color: textSecondary }]}>{type}</Text>
              <Text style={[s.breakdownRate, { color: textSecondary }]}>{info.perWeek || info.perDay}/{info.perDay ? 'day' : 'wk'}</Text>
            </View>
          );
        })}
      </View>
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
});
