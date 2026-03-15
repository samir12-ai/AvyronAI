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
};

interface Stage {
  id: string;
  name: string;
  status: string;
  count: number;
}

interface ExecutionPipelineProps {
  campaignId: string;
  isDark: boolean;
}

const STAGE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  plan: 'document-text',
  'content-dna': 'code-working',
  approval: 'checkmark-circle',
  calendar: 'calendar',
  creation: 'color-palette',
  review: 'eye',
  publishing: 'cloud-upload',
};

export function ExecutionPipeline({ campaignId, isDark }: ExecutionPipelineProps) {
  const baseUrl = getApiUrl();
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';

  const { data, isLoading } = useQuery({
    queryKey: ['/api/execution-pipeline', campaignId],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/execution-pipeline/${campaignId}`, baseUrl).toString());
      return res.json();
    },
    enabled: !!campaignId,
    refetchInterval: 15000,
  });

  const stages: Stage[] = data?.stages || [];

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={s.header}>
        <Ionicons name="git-branch-outline" size={18} color={P.mint} />
        <Text style={[s.headerText, { color: textPrimary }]}>Execution Pipeline</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="small" color={P.mint} style={{ marginVertical: 16 }} />
      ) : (
        <View style={s.pipeline}>
          {stages.map((stage, i) => {
            const statusColor =
              stage.status === 'COMPLETED' ? P.neon :
              stage.status === 'IN_PROGRESS' ? P.blue :
              stage.status === 'ACTION_NEEDED' ? P.gold :
              stage.status === 'REJECTED' ? P.coral :
              isDark ? '#2A3040' : '#D0D5DD';

            const iconName = STAGE_ICONS[stage.id] || 'ellipse';
            const isActive = stage.status === 'ACTION_NEEDED' || stage.status === 'IN_PROGRESS';
            const isCompleted = stage.status === 'COMPLETED';
            const isLocked = stage.status === 'LOCKED';

            return (
              <View key={stage.id} style={s.stageRow}>
                <View style={s.stageLeft}>
                  <View style={[
                    s.stageIcon,
                    {
                      backgroundColor: statusColor + (isLocked ? '10' : '20'),
                      borderWidth: isActive ? 1.5 : 0,
                      borderColor: isActive ? statusColor : 'transparent',
                    }
                  ]}>
                    <Ionicons
                      name={isCompleted ? 'checkmark' : (iconName as any)}
                      size={isCompleted ? 14 : 16}
                      color={isLocked ? (isDark ? '#3A4050' : '#B0B5BD') : statusColor}
                    />
                  </View>
                  {i < stages.length - 1 && (
                    <View style={[s.connector, {
                      backgroundColor: isCompleted ? P.neon + '30' : (isDark ? '#1A2030' : '#E5EBE7'),
                    }]} />
                  )}
                </View>
                <View style={s.stageContent}>
                  <Text style={[
                    s.stageName,
                    { color: isLocked ? (isDark ? '#3A4050' : '#B0B5BD') : textPrimary }
                  ]}>
                    {stage.name}
                  </Text>
                  {stage.count > 0 && (
                    <View style={[s.countBadge, { backgroundColor: statusColor + '20' }]}>
                      <Text style={[s.countText, { color: statusColor }]}>{stage.count}</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headerText: { fontSize: 15, fontWeight: '700' as const },
  pipeline: { gap: 0 },
  stageRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 40 },
  stageLeft: { width: 36, alignItems: 'center' as const },
  stageIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  connector: { width: 2, flex: 1, marginVertical: 2 },
  stageContent: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingLeft: 8,
    paddingTop: 6,
    paddingBottom: 6,
  },
  stageName: { fontSize: 13, fontWeight: '500' as const },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 11, fontWeight: '600' as const },
});
