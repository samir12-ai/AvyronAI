import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, authFetch } from '@/lib/query-client';
import {
  colorForExecutionStatus,
  labelForExecutionStatus,
  isCanonicalExecutionStatus,
} from '@/lib/verdict-colors';

const P = {
  green: '#10B981',
  blue: '#4C9AFF',
  mint: '#8B5CF6',
  pink: '#EC4899',
  purple: '#D946EF',
  orange: '#F97316',
  amber: '#F59E0B',
  teal: '#14B8A6',
  indigo: '#6366F1',
  cyan: '#06B6D4',
  red: '#F43F5E',
  emerald: '#059669',
  darkBg: '#080C10',
  darkCard: '#0F1419',
  darkCardBorder: '#1A2030',
  lightBg: '#F4F7F5',
  lightCard: '#FFFFFF',
  lightCardBorder: '#E2E8E4',
};

const ENGINE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string; shortName: string }> = {
  market_intelligence:    { icon: 'analytics-outline',       color: P.green,   shortName: 'Market Intel' },
  audience:               { icon: 'people-outline',           color: P.blue,    shortName: 'Audience' },
  positioning:            { icon: 'compass-outline',          color: P.mint,    shortName: 'Positioning' },
  differentiation:        { icon: 'layers-outline',           color: P.pink,    shortName: 'Differentiation' },
  mechanism:              { icon: 'construct-outline',        color: P.purple,  shortName: 'Mechanism' },
  offer:                  { icon: 'pricetag-outline',         color: P.orange,  shortName: 'Offer' },
  awareness:              { icon: 'eye-outline',              color: P.amber,   shortName: 'Awareness' },
  funnel:                 { icon: 'funnel-outline',           color: P.teal,    shortName: 'Funnel' },
  persuasion:             { icon: 'megaphone-outline',        color: P.pink,    shortName: 'Persuasion' },
  integrity:              { icon: 'shield-checkmark-outline', color: P.indigo,  shortName: 'Integrity' },
  statistical_validation: { icon: 'stats-chart-outline',     color: P.cyan,    shortName: 'Statistics' },
  budget_governor:        { icon: 'wallet-outline',           color: P.amber,   shortName: 'Budget' },
  channel_selection:      { icon: 'git-branch-outline',      color: P.blue,    shortName: 'Channels' },
  iteration:              { icon: 'repeat-outline',           color: P.red,     shortName: 'Iteration' },
  retention:              { icon: 'heart-outline',            color: P.emerald, shortName: 'Retention' },
};

const ENGINE_ORDER = [
  'market_intelligence', 'audience', 'positioning', 'differentiation', 'mechanism',
  'offer', 'awareness', 'funnel', 'persuasion', 'integrity',
  'statistical_validation', 'budget_governor', 'channel_selection', 'iteration', 'retention',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  campaignId: string;
  jobId?: string | null;
}

interface EngineEntry {
  id: string;
  name: string;
  /** Canonical F1 execution status from `executionStatus`. May fall through to legacy `status`. */
  executionStatus?: string | null;
  /** @deprecated Legacy free-form status (D4). */
  status: string;
  durationMs?: number;
  confidence?: number;
  grade?: string;
  summary?: string | null;
}

/**
 * Status icon driven by canonical executionStatus enum (Seal #6).
 * Legacy SUCCESS/COMPLETE map to amber (PARTIAL) — never green — so a
 * pre-canonical snapshot cannot fake success.
 */
function statusIcon(canonical?: string | null, legacy?: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
  const color = colorForExecutionStatus(canonical, legacy);
  const enumStatus = isCanonicalExecutionStatus(canonical) ? canonical! : (legacy || '').toUpperCase();
  switch (enumStatus) {
    case 'COMPLETED':
      return { name: 'checkmark-circle', color };
    case 'PARTIAL':
    case 'NEEDS_INPUT':
      return { name: 'warning-outline', color };
    case 'PENDING':
      return { name: 'ellipse-outline', color };
    case 'BLOCKED':
    case 'BLOCKED_BY_INTEGRITY':
      return { name: 'remove-circle', color };
    case 'ERROR':
      return { name: 'close-circle', color };
    case 'SUCCESS':
    case 'COMPLETE':
      // Legacy binary success → amber (never green).
      return { name: 'warning-outline', color };
    case 'FAILED':
    case 'FAILURE':
      return { name: 'close-circle', color };
    case 'SKIPPED':
      return { name: 'remove-circle-outline', color };
    case 'RUNNING':
    case 'IN_PROGRESS':
      return { name: 'hourglass-outline', color: '#F59E0B' };
    default:
      return { name: 'ellipse-outline', color };
  }
}

function gradeColor(grade?: string): string {
  if (!grade) return '#8892A4';
  const g = grade.toLowerCase();
  if (g === 'green') return '#10B981';
  if (g === 'yellow') return '#F59E0B';
  if (g === 'orange') return '#F97316';
  if (g === 'red') return '#F43F5E';
  return '#8892A4';
}

export default function EngineTableModal({ visible, onClose, campaignId, jobId }: Props) {
  const isDark = useColorScheme() === 'dark';
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  // Canonical execution status (Seal #6 / D2). The legacy `status` is kept
  // as a fall-through ONLY for snapshots that predate the canonical field.
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);
  const [legacyStatus, setLegacyStatus] = useState<string>('');
  const [totalDuration, setTotalDuration] = useState(0);

  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const borderColor = isDark ? P.darkCardBorder : P.lightCardBorder;
  const bg = isDark ? P.darkBg : P.lightBg;

  useEffect(() => {
    if (!visible || !campaignId) return;
    let cancelled = false;
    setLoading(true);
    setEngines([]);
    setExecutionStatus(null);
    setLegacyStatus('');
    setTotalDuration(0);
    const latestUrl = new URL(`/api/orchestrator/latest/${campaignId}`, getApiUrl());
    const summariesUrl = new URL(`/api/orchestrator/summaries/${campaignId}`, getApiUrl());
    if (jobId) {
      latestUrl.searchParams.set('runId', jobId);
      summariesUrl.searchParams.set('runId', jobId);
    }
    Promise.all([
      authFetch(latestUrl.toString()).then(r => r.json()).catch(() => null),
      authFetch(summariesUrl.toString()).then(r => r.json()).catch(() => null),
    ])
      .then(([data, summData]) => {
        if (cancelled || (jobId && data?.id !== jobId) || (jobId && summData?.jobId !== jobId)) return;
        const sections = data?.sections || data?.engines || [];
        const summMap: Record<string, string> = {};
        if (summData?.engines) {
          summData.engines.forEach((e: any) => { if (e.summary) summMap[e.id] = e.summary; });
        }
        const mapped: EngineEntry[] = ENGINE_ORDER.map((engineId, idx) => {
          const found = sections.find((s: any) => s.id === engineId || s.engineId === engineId);
          return {
            id: engineId,
            name: ENGINE_META[engineId]?.shortName || engineId,
            executionStatus: found?.executionStatus ?? null,
            status: found?.status || 'PENDING',
            durationMs: found?.durationMs || found?.duration,
            confidence: found?.confidence,
            grade: found?.grade,
            summary: found?.summary || summMap[engineId] || null,
          };
        });
        setEngines(mapped);
        setExecutionStatus(data?.executionStatus ?? null);
        setLegacyStatus(data?.status || '');
        setTotalDuration(data?.durationMs || 0);
      })
      .catch(() => { if (!cancelled) setEngines([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, campaignId, jobId]);

  // Count only canonical COMPLETED — legacy SUCCESS no longer earns "completed"
  // status here (D4: legacy fields cannot satisfy live decisions / counters).
  const completedCount = engines.filter(e => isCanonicalExecutionStatus(e.executionStatus) && e.executionStatus === 'COMPLETED').length;
  const overallLabel = labelForExecutionStatus(executionStatus, legacyStatus);
  const overallColor = colorForExecutionStatus(executionStatus, legacyStatus);
  const overallCanonical = isCanonicalExecutionStatus(executionStatus);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[s.container, { backgroundColor: bg }]}>
        <View style={[s.header, { borderBottomColor: borderColor }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: textPrimary }]}>Engine Status Table</Text>
            <Text style={[s.subtitle, { color: textSec }]}>
              {completedCount}/{engines.length} engines completed
              {totalDuration > 0 ? ` · ${(totalDuration / 1000).toFixed(1)}s` : ''}
            </Text>
            {(executionStatus || legacyStatus) && (
              <Text style={[s.subtitle, { color: overallColor, marginTop: 2 }]}>
                {overallLabel}{!overallCanonical && legacyStatus ? ' (legacy snapshot)' : ''}
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} style={[s.closeBtn, { backgroundColor: isDark ? '#1A2030' : '#F0F0F5' }]}>
            <Ionicons name="close" size={20} color={textSec} />
          </Pressable>
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={P.mint} />
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <View style={[s.tableHeader, { borderBottomColor: borderColor }]}>
              <Text style={[s.colNum, { color: textSec }]}>#</Text>
              <Text style={[s.colName, { color: textSec }]}>Engine</Text>
              <Text style={[s.colStatus, { color: textSec }]}>Status</Text>
              <Text style={[s.colTime, { color: textSec }]}>Time</Text>
            </View>
            {engines.map((engine, idx) => {
              const meta = ENGINE_META[engine.id] || { icon: 'cube-outline' as any, color: P.blue, shortName: engine.name };
              const si = statusIcon(engine.executionStatus, engine.status);
              // "Complete" = canonical COMPLETED only. Legacy SUCCESS is shown
              // as PARTIAL via the verdict-colors helper.
              const isComplete = isCanonicalExecutionStatus(engine.executionStatus) && engine.executionStatus === 'COMPLETED';
              const rowLabel = labelForExecutionStatus(engine.executionStatus, engine.status);
              return (
                <View key={engine.id} style={[s.row, { backgroundColor: cardBg, borderColor, flexDirection: 'column', alignItems: 'stretch', gap: 0 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[s.colNum, { color: textSec }]}>{idx + 1}</Text>
                    <View style={[s.colName, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[s.iconWrap, { backgroundColor: meta.color + '18' }]}>
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                      </View>
                      <Text style={[s.engineName, { color: textPrimary }]} numberOfLines={1}>{meta.shortName}</Text>
                    </View>
                    <View style={[s.colStatus, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                      <Ionicons name={si.name} size={14} color={si.color} />
                      <Text style={[s.statusText, { color: si.color }]} numberOfLines={1}>
                        {isComplete ? 'OK' : rowLabel}
                      </Text>
                    </View>
                    <Text style={[s.colTime, { color: textSec }]}>
                      {engine.durationMs ? `${(engine.durationMs / 1000).toFixed(1)}s` : '—'}
                    </Text>
                  </View>
                  {isComplete && engine.summary && (
                    <Text style={[s.summaryText, { color: textSec }]} numberOfLines={2}>
                      {engine.summary}
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'web' ? 67 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  colNum: {
    width: 24,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  colName: {
    flex: 1,
  },
  colStatus: {
    width: 90,
  },
  colTime: {
    width: 50,
    textAlign: 'right' as const,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  engineName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  summaryText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
    paddingLeft: 32,
    paddingTop: 4,
    paddingBottom: 2,
  },
});
