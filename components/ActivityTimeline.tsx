import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useActivityTimeline } from '@/hooks/usePerception';
import type { ActivityEvent } from '@shared/perception-translator';

const TONE_COLORS = {
  stable:   { dot: '#85BB65', icon: 'check' as const },
  watching: { dot: '#4C9AFF', icon: 'eye' as const },
  shift:    { dot: '#FFB347', icon: 'trending-up' as const },
  issue:    { dot: '#FF6B6B', icon: 'alert-triangle' as const },
  unknown:  { dot: '#8892A4', icon: 'circle' as const },
};

interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
  maxRows?: number;
}

export default function ActivityTimeline({ campaignId, isDark = true, maxRows = 8 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, error } = useActivityTimeline(campaignId, 168);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const textMuted = isDark ? '#4A5568' : '#8A96A8';

  const events = data?.events ?? [];
  const shown = expanded ? events : events.slice(0, maxRows);

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="activity" size={14} color="#8B5CF6" />
          <Text style={[styles.title, { color: textSec }]}>ACTIVITY · LAST 7 DAYS</Text>
        </View>
        <Text style={[styles.count, { color: textMuted }]}>{events.length}</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#8B5CF6" />
        </View>
      ) : error ? (
        <Text style={[styles.empty, { color: textSec }]}>Activity unavailable</Text>
      ) : events.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Feather name="eye" size={22} color={textMuted} />
          <Text style={[styles.empty, { color: textSec }]}>Watching — no changes detected</Text>
          <Text style={[styles.emptySub, { color: textMuted }]}>
            The system is monitoring your market and plan. We'll log every check here.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.list}>
            {shown.map((e, i) => (
              <Row key={e.id} event={e} isLast={i === shown.length - 1} textPrimary={textPrimary} textSec={textSec} textMuted={textMuted} />
            ))}
          </View>
          {events.length > maxRows ? (
            <Pressable onPress={() => setExpanded(v => !v)} style={styles.expandBtn}>
              <Text style={[styles.expandText, { color: '#8B5CF6' }]}>
                {expanded ? 'Show less' : `Show ${events.length - maxRows} more`}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function Row({ event, isLast, textPrimary, textSec, textMuted }: {
  event: ActivityEvent; isLast: boolean; textPrimary: string; textSec: string; textMuted: string;
}) {
  const c = TONE_COLORS[event.tone];
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: c.dot }]}>
          <Feather name={c.icon} size={9} color="#0B0F14" />
        </View>
        {isLast ? null : <View style={[styles.line, { backgroundColor: 'rgba(136, 146, 164, 0.15)' }]} />}
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: textPrimary }]}>{event.title}</Text>
        {event.detail ? <Text style={[styles.rowDetail, { color: textSec }]}>{event.detail}</Text> : null}
        <Text style={[styles.rowTime, { color: textMuted }]}>{formatRelative(event.at)}</Text>
      </View>
    </View>
  );
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
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  count: { fontSize: 11, fontWeight: '600' },
  list: { gap: 0 },
  row: { flexDirection: 'row', gap: 10 },
  rail: { width: 20, alignItems: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  line: { width: 2, flex: 1, marginTop: 4 },
  rowBody: { flex: 1, paddingBottom: 14 },
  rowTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  rowDetail: { fontSize: 12, lineHeight: 16, marginBottom: 4 },
  rowTime: { fontSize: 11, fontWeight: '500' },
  center: { alignItems: 'center', paddingVertical: 16 },
  empty: { fontSize: 13, textAlign: 'center', marginTop: 8, fontWeight: '600' },
  emptySub: { fontSize: 11, textAlign: 'center', marginTop: 6, paddingHorizontal: 16, lineHeight: 15 },
  emptyBlock: { alignItems: 'center', paddingVertical: 18 },
  expandBtn: { alignItems: 'center', paddingTop: 6 },
  expandText: { fontSize: 12, fontWeight: '600' },
});
