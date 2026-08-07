import React from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SECTION_STATE_LABELS } from '@/shared/performance-labels';
import type { SectionState } from '@/hooks/usePerformanceConsole';

const COLORS = { bg: '#0F1419', border: '#1A2030', text: '#E8EDF2', muted: '#8892A4', purple: '#8B5CF6', amber: '#FFB347', red: '#FF6B6B' };

export function stateTone(state: SectionState) {
  if (state === 'ready') return '#34D399';
  if (state === 'failed') return COLORS.red;
  if (state === 'not_configured' || state === 'insufficient_evidence') return COLORS.amber;
  return '#8892A4';
}

export function StateBadge({ state }: { state: SectionState }) {
  const info = SECTION_STATE_LABELS[state] || SECTION_STATE_LABELS.unavailable;
  const tone = stateTone(state);
  return (
    <View style={[styles.badge, { borderColor: `${tone}55`, backgroundColor: `${tone}14` }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.badgeText, { color: tone }]}>{info.label}</Text>
    </View>
  );
}

export function SectionStateCard({ state, reason, title, icon = 'activity', action }: {
  state: SectionState; reason?: string | null; title: string; icon?: keyof typeof Feather.glyphMap; action?: { label: string; onPress: () => void };
}) {
  const info = SECTION_STATE_LABELS[state] || SECTION_STATE_LABELS.unavailable;
  return (
    <View style={styles.card}>
      <View style={[styles.icon, { backgroundColor: `${stateTone(state)}18` }]}>
        <Feather name={icon} size={16} color={stateTone(state)} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}><Text style={styles.title}>{title}</Text><StateBadge state={state} /></View>
        <Text style={styles.description}>{reason || info.description}</Text>
        {action ? <Pressable onPress={action.onPress} style={styles.action}><Text style={styles.actionText}>{action.label}</Text><Feather name="arrow-up-right" size={13} color={COLORS.purple} /></Pressable> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.bg, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 7 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  title: { color: COLORS.text, fontSize: 13, fontWeight: '700', flexShrink: 1 }, description: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3 }, badgeText: { fontSize: 10, fontWeight: '700' }, action: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  actionText: { color: COLORS.purple, fontSize: 12, fontWeight: '700' },
});