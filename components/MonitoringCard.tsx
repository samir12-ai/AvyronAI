import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMonitoring } from '@/hooks/usePerception';
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
}

function Row({ line, isDark }: { line: WatchtowerLine & { id: string }; isDark: boolean }) {
  const c = TONE_COLORS[line.tone];
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  return (
    <View style={[styles.row, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.bg, borderColor: c.border }]}>
        <Feather name={c.icon} size={14} color={c.accent} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.headline, { color: textPrimary }]} numberOfLines={2}>{line.headline}</Text>
        {line.detail ? (
          <Text style={[styles.detail, { color: textSec }]} numberOfLines={3}>{line.detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function MonitoringCard({ campaignId, isDark = true }: Props) {
  const { data, isLoading, error } = useMonitoring(campaignId);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textSec = isDark ? '#8892A4' : '#546478';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="activity" size={14} color="#8B5CF6" />
          <Text style={[styles.title, { color: textSec }]}>WHAT THE SYSTEM IS DOING</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#8B5CF6" />
        </View>
      ) : error ? (
        <Text style={[styles.errorText, { color: textSec }]}>Monitoring view unavailable</Text>
      ) : (
        <View style={styles.list}>
          {data?.lines.map((l) => (
            <Row key={l.id} line={l} isDark={isDark} />
          ))}
        </View>
      )}
    </View>
  );
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
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 10,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  headline: { fontSize: 13, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  loadingRow: { alignItems: 'center', paddingVertical: 16 },
  errorText: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
