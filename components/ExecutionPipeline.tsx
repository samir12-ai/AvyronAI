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
  orange: '#FF9500',
};

interface Stage {
  id: string;
  name: string;
  status: string;
  count: number;
}

interface ContentQueueValidation {
  valid: boolean;
  violations: string[];
  formatCounts?: Record<string, number>;
}

interface FunnelFeeding {
  valid: boolean;
  funnelStatus: string;
  violations: string[];
  trafficFlowing: boolean;
  contentGenerated: number;
  contentScheduled: number;
  contentPublished: number;
}

interface ActivationInfo {
  executionStatus: string;
  contentQueue: ContentQueueValidation | null;
  funnelFeeding: FunnelFeeding | null;
  calendarEntryCount: number;
  studioItemCount: number;
}

interface ExecutionPipelineProps {
  campaignId: string;
  isDark: boolean;
}

const STAGE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'goal-math': 'calculator',
  plan: 'document-text',
  roots: 'leaf',
  simulation: 'trending-up',
  'content-dna': 'code-working',
  approval: 'checkmark-circle',
  tasks: 'list',
  calendar: 'calendar',
  creation: 'color-palette',
  review: 'eye',
  publishing: 'cloud-upload',
};

const EXEC_STATUS_CONFIG: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  IDLE: { label: 'Idle', color: '#8892A4', icon: 'pause-circle' },
  ACTIVATING: { label: 'Activating...', color: P.blue, icon: 'sync-circle' },
  ACTIVE: { label: 'Active', color: P.neon, icon: 'checkmark-circle' },
  ACTIVATION_FAILED: { label: 'Activation Failed', color: P.coral, icon: 'alert-circle' },
  STARVED: { label: 'Content Starved', color: P.orange, icon: 'warning' },
};

function ActivationStatusBanner({ activation, isDark }: { activation: ActivationInfo; isDark: boolean }) {
  const config = EXEC_STATUS_CONFIG[activation.executionStatus] || EXEC_STATUS_CONFIG.IDLE;
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const surfaceBg = isDark ? '#151B24' : '#F4F7F5';

  return (
    <View style={[s.activationBanner, { backgroundColor: surfaceBg, borderColor: config.color + '30' }]}>
      <View style={s.activationHeader}>
        <Ionicons name={config.icon} size={16} color={config.color} />
        <Text style={[s.activationLabel, { color: config.color }]}>{config.label}</Text>
        <View style={s.activationCounts}>
          <Text style={[s.activationCount, { color: textSecondary }]}>
            {activation.calendarEntryCount} cal · {activation.studioItemCount} items
          </Text>
        </View>
      </View>

      {activation.contentQueue && !activation.contentQueue.valid && (
        <View style={s.violationsContainer}>
          {activation.contentQueue.violations.map((v, i) => (
            <View key={i} style={s.violationRow}>
              <Ionicons name="close-circle" size={12} color={P.coral} />
              <Text style={[s.violationText, { color: P.coral }]} numberOfLines={2}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      {activation.funnelFeeding && (
        <View style={s.funnelRow}>
          <Ionicons
            name={activation.funnelFeeding.valid ? 'checkmark-circle' : 'alert-circle'}
            size={12}
            color={activation.funnelFeeding.valid ? P.neon : P.gold}
          />
          <Text style={[s.funnelText, { color: activation.funnelFeeding.valid ? P.neon : P.gold }]}>
            Funnel: {activation.funnelFeeding.funnelStatus}
          </Text>
        </View>
      )}
    </View>
  );
}

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
  const activation: ActivationInfo | null = data?.activation || null;

  return (
    <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={s.header}>
        <Ionicons name="git-branch-outline" size={18} color={P.mint} />
        <Text style={[s.headerText, { color: textPrimary }]}>Execution Pipeline</Text>
      </View>

      {activation && activation.executionStatus !== 'IDLE' && (
        <ActivationStatusBanner activation={activation} isDark={isDark} />
      )}

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
  activationBanner: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  activationHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  activationLabel: { fontSize: 13, fontWeight: '600' as const },
  activationCounts: { marginLeft: 'auto' as any },
  activationCount: { fontSize: 11 },
  violationsContainer: { marginTop: 8, gap: 4 },
  violationRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 4,
  },
  violationText: { fontSize: 11, flex: 1 },
  funnelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 6,
  },
  funnelText: { fontSize: 11, fontWeight: '500' as const },
});
