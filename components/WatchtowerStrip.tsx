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

function Cell({ line, isDark }: { line: { id: string; line: WatchtowerLine }; isDark: boolean }) {
  const c = TONE_COLORS[line.line.tone];
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  return (
    <View style={[styles.cell, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={styles.cellHeader}>
        <Feather name={c.icon} size={14} color={c.accent} />
        <Text style={[styles.cellHeadline, { color: textPrimary }]} numberOfLines={1}>{line.line.headline}</Text>
      </View>
      {line.line.detail ? (
        <Text style={[styles.cellDetail, { color: textSec }]} numberOfLines={2}>{line.line.detail}</Text>
      ) : null}
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
        <View style={styles.row}>
          {data?.lines.map((l) => (
            <Cell key={l.id} line={l} isDark={isDark} />
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
  row: { flexDirection: 'row', gap: 8 },
  cell: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    minHeight: 64,
  },
  cellHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cellHeadline: { fontSize: 12, fontWeight: '700', flex: 1 },
  cellDetail: { fontSize: 11, lineHeight: 14 },
  loadingRow: { alignItems: 'center', paddingVertical: 16 },
  errorText: { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
