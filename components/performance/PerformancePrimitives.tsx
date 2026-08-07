import React, { useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DECISION_OUTCOME_LABELS, DECISION_VERDICT_LABELS, EXECUTION_STATUS_LABELS, LINEAGE_STATE_LABELS, ATTRIBUTION_CONFIDENCE_LABELS, BUSINESS_VERDICT_LABELS } from '@/shared/performance-labels';
import { stateTone } from './SectionStateCard';

const C = { text: '#E8EDF2', muted: '#8892A4', faint: '#4A5568', border: '#1A2030', card: '#0F1419', purple: '#8B5CF6', green: '#34D399', red: '#FF6B6B', amber: '#FFB347' };

export function Panel({ title, icon, children, right }: { title: string; icon: keyof typeof Feather.glyphMap; children: React.ReactNode; right?: React.ReactNode }) {
  return <View style={styles.panel}><View style={styles.panelHead}><View style={styles.panelTitle}><Feather name={icon} size={14} color={C.purple} /><Text style={styles.panelText}>{title}</Text></View>{right}</View>{children}</View>;
}
export function Metric({ label, value, tone = C.text }: { label: string; value: string | number; tone?: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color: tone }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
export function formatEnum(map: Record<string, { label: string; description: string } | string>, value: string | null | undefined) {
  if (!value) return 'Unknown';
  const item = map[value]; return typeof item === 'string' ? item : item?.label || 'Unknown';
}
export function verdictTone(value: string | null | undefined) {
  if (!value) return C.faint;
  if (['WINNER', 'POSITIVE', 'WORKING', 'EXECUTED', 'supported', 'DIRECT', 'SUPPORTED'].includes(value)) return C.green;
  if (['LOSER', 'NEGATIVE', 'DRIFTING', 'NOT_EXECUTED', 'unsupported', 'FAILED'].includes(value)) return C.red;
  if (['INCONCLUSIVE', 'MIXED', 'PARTIALLY_EXECUTED', 'awaiting', 'partially_supported', 'CORRELATED'].includes(value)) return C.amber;
  return C.faint;
}
export function ExpandRow({ title, meta, tone, children }: { title: string; meta?: string; tone?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Pressable onPress={() => setOpen(v => !v)} style={styles.row}><View style={[styles.rowMark, { backgroundColor: tone || C.faint }]} /><View style={styles.rowBody}><View style={styles.rowTop}><Text style={styles.rowTitle}>{title}</Text><Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.faint} /></View>{meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}{open ? <View style={styles.detail}>{children}</View> : null}</View></Pressable>;
}
export const labelMaps = { execution: EXECUTION_STATUS_LABELS, verdict: DECISION_VERDICT_LABELS, outcome: DECISION_OUTCOME_LABELS, attribution: ATTRIBUTION_CONFIDENCE_LABELS, business: BUSINESS_VERDICT_LABELS, lineage: LINEAGE_STATE_LABELS };
export const colors = C;
const styles = StyleSheet.create({
  panel: { backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, panelTitle: { flexDirection: 'row', gap: 8, alignItems: 'center' }, panelText: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: .2 },
  metric: { flex: 1, gap: 3 }, metricValue: { fontSize: 23, fontWeight: '800', letterSpacing: -.5 }, metricLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: .7 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.border }, rowMark: { width: 3, borderRadius: 3 }, rowBody: { flex: 1, gap: 4 }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, rowTitle: { color: C.text, fontSize: 12, fontWeight: '700', flex: 1 }, rowMeta: { color: C.muted, fontSize: 11 }, detail: { gap: 6, marginTop: 6, padding: 9, backgroundColor: '#0A0F14', borderRadius: 9 }, detailText: { color: C.muted, fontSize: 11, lineHeight: 16 },
});
export const DetailText = ({ children }: { children: React.ReactNode }) => <Text style={styles.detailText}>{children}</Text>;