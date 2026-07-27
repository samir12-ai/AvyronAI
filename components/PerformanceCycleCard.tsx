import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePerformanceCycle, type PerformanceCycleDecision } from '@/hooks/usePerformanceCycle';

interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
}

// P-2 Final — the weekly review artifact. Shows the latest COMPLETE
// performance cycle: what was recommended, what was executed, what happened
// to sales (the ONLY primary metric), the per-decision verdict, and the next
// step. Renders nothing until the first cycle exists.
//
// Honesty rules mirrored from the server: verdicts are correlations unless
// stated otherwise; never-executed recommendations are shown as "not tried",
// never as failures; missing data reads as "needs more data", never as 0.

// Runtime belt: the server normalizes JSON shapes, but the card must never
// crash the dashboard on an unexpected payload.
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

const VERDICT_META: Record<string, { color: string; icon: keyof typeof Feather.glyphMap; label: string }> = {
  WINNER: { color: '#34D399', icon: 'trending-up', label: 'Winner' },
  LOSER: { color: '#F87171', icon: 'trending-down', label: 'Not working' },
  INCONCLUSIVE: { color: '#FBBF24', icon: 'help-circle', label: 'Unclear' },
  NOT_EXECUTED: { color: '#8892A4', icon: 'minus-circle', label: 'Not tried' },
  NEEDS_MORE_DATA: { color: '#4C9AFF', icon: 'clock', label: 'Needs more data' },
};

export default function PerformanceCycleCard({ campaignId, isDark = true }: Props) {
  const { data } = usePerformanceCycle(campaignId);
  const [expanded, setExpanded] = useState(false);

  const cycle = data?.state === 'ready' ? data.cycle : null;
  if (!cycle) return null;

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const chipBg = isDark ? '#1A2030' : '#F4F6F8';

  const before = cycle.sales.before;
  const after = cycle.sales.after;
  const salesLabel =
    before === null || after === null
      ? 'sales data incomplete'
      : `paying customers ${before} → ${after}`;
  const accent =
    before !== null && after !== null && after > before ? '#34D399'
    : before !== null && after !== null && after < before ? '#F87171'
    : '#4C9AFF';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconWrap, { backgroundColor: accent + '22' }]}>
            <Feather name="bar-chart-2" size={14} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.title, { color: textPrimary }]}>Weekly review — week {cycle.weekNumber}</Text>
              {cycle.isTestCycle ? (
                <View style={[styles.testBadge, { borderColor: '#FFB347' }]}>
                  <Text style={styles.testBadgeText}>TEST</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.subtitle, { color: textSec }]}>{salesLabel}</Text>
          </View>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={textSec} />
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {cycle.isTestCycle ? (
            <Text style={[styles.testNote, { color: '#FFB347' }]}>
              System-verification cycle — these are not real campaign results.
            </Text>
          ) : null}

          {(Array.isArray(cycle.decisions) ? cycle.decisions : []).map((d) => (
            <DecisionRow key={`${d.dimension}:${d.value}`} d={d} textPrimary={textPrimary} textSec={textSec} chipBg={chipBg} />
          ))}

          {cycle.nextStep ? (
            <View style={[styles.nextStep, { backgroundColor: chipBg }]}>
              <Text style={[styles.nextTitle, { color: textPrimary }]}>Next week</Text>
              {asList(cycle.nextStep.keepDoing).length > 0 ? (
                <Text style={[styles.nextLine, { color: textSec }]}>Keep doing: {asList(cycle.nextStep.keepDoing).join(', ')}</Text>
              ) : null}
              {asList(cycle.nextStep.stopDoing).length > 0 ? (
                <Text style={[styles.nextLine, { color: textSec }]}>Stop: {asList(cycle.nextStep.stopDoing).join(', ')}</Text>
              ) : null}
              {asList(cycle.nextStep.executeWhatWasPlanned).length > 0 ? (
                <Text style={[styles.nextLine, { color: textSec }]}>Actually try: {asList(cycle.nextStep.executeWhatWasPlanned).join(', ')}</Text>
              ) : null}
              {asList(cycle.nextStep.retryWithBetterData).length > 0 ? (
                <Text style={[styles.nextLine, { color: textSec }]}>Retry with better data: {asList(cycle.nextStep.retryWithBetterData).join(', ')}</Text>
              ) : null}
              {typeof cycle.nextStep.nextExperiment === 'string' && cycle.nextStep.nextExperiment ? (
                <Text style={[styles.nextLine, { color: textSec }]}>Experiment: {cycle.nextStep.nextExperiment}</Text>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.honesty, { color: textSec }]}>
            Verdicts come only from the paying-customer numbers you report. Likes and reach never decide a verdict.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DecisionRow({ d, textPrimary, textSec, chipBg }: {
  d: PerformanceCycleDecision; textPrimary: string; textSec: string; chipBg: string;
}) {
  const meta = VERDICT_META[d.verdict] ?? VERDICT_META.INCONCLUSIVE;
  return (
    <View style={styles.decision}>
      <View style={styles.decisionHead}>
        <Text style={[styles.decisionName, { color: textPrimary }]} numberOfLines={1}>
          {d.value.replace(/_/g, ' ')}
        </Text>
        <View style={[styles.verdictChip, { backgroundColor: chipBg }]}>
          <Feather name={meta.icon} size={11} color={meta.color} />
          <Text style={[styles.verdictText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>
      <Text style={[styles.decisionReason, { color: textSec }]}>{d.reason}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 11, marginTop: 2 },
  testBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  testBadgeText: { color: '#FFB347', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  testNote: { fontSize: 11 },
  body: { marginTop: 12, gap: 12 },
  decision: { gap: 4 },
  decisionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  decisionName: { fontSize: 13, fontWeight: '600', flex: 1 },
  verdictChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  verdictText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  decisionReason: { fontSize: 11, lineHeight: 16 },
  nextStep: { borderRadius: 10, padding: 10, gap: 4 },
  nextTitle: { fontSize: 12, fontWeight: '700' },
  nextLine: { fontSize: 11, lineHeight: 16 },
  honesty: { fontSize: 10, fontStyle: 'italic', lineHeight: 14 },
});
