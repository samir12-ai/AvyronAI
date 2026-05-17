import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useWatchtower } from '@/hooks/usePerception';
import type { WatchtowerLine } from '@shared/perception-translator';

const TONE_COLORS = {
  stable:   { bg: 'rgba(133, 187, 101, 0.10)', border: 'rgba(133, 187, 101, 0.30)', accent: '#85BB65', icon: 'check-circle' as const },
  watching: { bg: 'rgba(76, 154, 255, 0.10)',  border: 'rgba(76, 154, 255, 0.30)',  accent: '#4C9AFF', icon: 'eye' as const },
  shift:    { bg: 'rgba(255, 179, 71, 0.12)',  border: 'rgba(255, 179, 71, 0.35)',  accent: '#FFB347', icon: 'trending-up' as const },
  issue:    { bg: 'rgba(255, 107, 107, 0.12)', border: 'rgba(255, 107, 107, 0.35)', accent: '#FF6B6B', icon: 'alert-triangle' as const },
  unknown:  { bg: 'rgba(136, 146, 164, 0.10)', border: 'rgba(136, 146, 164, 0.30)', accent: '#8892A4', icon: 'help-circle' as const },
};

interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
  onPress?: () => void;
}

const LINE_LABELS: Record<string, string> = {
  market: 'Market',
  plan: 'Plan',
  freshness: 'Data',
};

function Row({ line, isDark }: { line: { id: string; line: WatchtowerLine }; isDark: boolean }) {
  const c = TONE_COLORS[line.line.tone];
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const label = LINE_LABELS[line.id] ?? line.id;
  return (
    <View style={[styles.row, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.accent + '22' }]}>
        <Feather name={c.icon} size={14} color={c.accent} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={[styles.rowLabel, { color: c.accent }]}>{label.toUpperCase()}</Text>
          <Text style={[styles.rowHeadline, { color: textPrimary }]}>{line.line.headline}</Text>
        </View>
        {line.line.detail ? (
          <Text style={[styles.rowDetail, { color: textSec }]}>{line.line.detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function WatchtowerStrip({ campaignId, isDark = true, onPress }: Props) {
  const { data, isLoading, error } = useWatchtower(campaignId);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textSec = isDark ? '#8892A4' : '#546478';

  const content = (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="radio" size={14} color="#8B5CF6" />
          <Text style={[styles.title, { color: textSec }]}>WATCHTOWER</Text>
        </View>
        {data?.lastCheckedAt ? (
          <Text style={[styles.timestamp, { color: textSec }]}>
            checked {formatRelative(data.lastCheckedAt)}
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#8B5CF6" />
        </View>
      ) : error ? (
        <Text style={[styles.errorText, { color: textSec }]}>Watchtower unavailable</Text>
      ) : (
        <View style={styles.stack}>
          {data?.lines.map((l) => (
            <Row key={l.id} line={l} isDark={isDark} />
          ))}
        </View>
      )}
    </View>
  );

  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

function formatRelative(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ageMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  timestamp: { fontSize: 11, fontWeight: '500' },
  stack: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowHeader: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  rowLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  rowHeadline: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 17 },
  rowDetail: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  loadingRow: { alignItems: 'center', paddingVertical: 16 },
  errorText: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
