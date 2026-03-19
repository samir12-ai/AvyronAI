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
import { getApiUrl } from '@/lib/query-client';

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
}

interface EngineEntry {
  id: string;
  name: string;
  status: string;
  durationMs?: number;
  confidence?: number;
  grade?: string;
}

function statusIcon(status: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'COMPLETED' || s === 'COMPLETE') return { name: 'checkmark-circle', color: '#10B981' };
  if (s.includes('FAIL') || s === 'ERROR') return { name: 'close-circle', color: '#F43F5E' };
  if (s === 'SKIPPED') return { name: 'remove-circle-outline', color: '#8892A4' };
  if (s === 'RUNNING' || s === 'IN_PROGRESS') return { name: 'hourglass-outline', color: '#F59E0B' };
  return { name: 'ellipse-outline', color: '#8892A4' };
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

export default function EngineTableModal({ visible, onClose, campaignId }: Props) {
  const isDark = useColorScheme() === 'dark';
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [overallStatus, setOverallStatus] = useState('');
  const [totalDuration, setTotalDuration] = useState(0);

  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const cardBg = isDark ? P.darkCard : P.lightCard;
  const borderColor = isDark ? P.darkCardBorder : P.lightCardBorder;
  const bg = isDark ? P.darkBg : P.lightBg;

  useEffect(() => {
    if (!visible || !campaignId) return;
    setLoading(true);
    const url = new URL(`/api/orchestrator/latest/${campaignId}`, getApiUrl());
    fetch(url.toString())
      .then(r => r.json())
      .then(data => {
        const sections = data?.sections || data?.engines || [];
        const mapped: EngineEntry[] = ENGINE_ORDER.map((engineId, idx) => {
          const found = sections.find((s: any) => s.id === engineId || s.engineId === engineId);
          return {
            id: engineId,
            name: ENGINE_META[engineId]?.shortName || engineId,
            status: found?.status || 'PENDING',
            durationMs: found?.durationMs || found?.duration,
            confidence: found?.confidence,
            grade: found?.grade,
          };
        });
        setEngines(mapped);
        setOverallStatus(data?.status || '');
        setTotalDuration(data?.durationMs || 0);
      })
      .catch(() => setEngines([]))
      .finally(() => setLoading(false));
  }, [visible, campaignId]);

  const successCount = engines.filter(e => ['SUCCESS', 'COMPLETED', 'COMPLETE'].includes(e.status.toUpperCase())).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[s.container, { backgroundColor: bg }]}>
        <View style={[s.header, { borderBottomColor: borderColor }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: textPrimary }]}>Engine Status Table</Text>
            <Text style={[s.subtitle, { color: textSec }]}>
              {successCount}/{engines.length} engines completed
              {totalDuration > 0 ? ` · ${(totalDuration / 1000).toFixed(1)}s` : ''}
            </Text>
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
              const si = statusIcon(engine.status);
              return (
                <View key={engine.id} style={[s.row, { backgroundColor: cardBg, borderColor }]}>
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
                      {engine.status === 'SUCCESS' || engine.status === 'COMPLETED' || engine.status === 'COMPLETE' ? 'OK' : engine.status}
                    </Text>
                  </View>
                  <Text style={[s.colTime, { color: textSec }]}>
                    {engine.durationMs ? `${(engine.durationMs / 1000).toFixed(1)}s` : '—'}
                  </Text>
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
});
