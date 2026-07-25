import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useBlockedReasons } from '@/hooks/usePerception';
import type { BlockedReason, BlockedReasonAction } from '@shared/perception-translator';

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
  onSubmitTruth?: () => void;
}

// Each blocked-reason action either routes to a known surface in the app
// OR delegates to the parent (only submit_user_truth has an inline form on
// the dashboard). Unknown actions fall through to no-op so the card never
// crashes on a new action enum.
function routeForAction(action: BlockedReasonAction, onSubmitTruth?: () => void) {
  return () => {
    switch (action) {
      case 'submit_user_truth':
        onSubmitTruth?.();
        return;
      case 'configure_rhythm':
        router.push('/(tabs)/ai-management?tab=buildplan');
        return;
      case 'connect_accounts':
        router.push('/(tabs)/ai-management?tab=publisher');
        return;
      case 'approve_plan':
        router.push('/(tabs)/ai-management?tab=buildplan');
        return;
      case 'wait_for_system':
        return;
    }
  };
}

function ReasonRow({ reason, isDark, onPress }: { reason: BlockedReason; isDark: boolean; onPress: () => void }) {
  const c = TONE_COLORS[reason.tone];
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec = isDark ? '#8892A4' : '#546478';
  const interactive = !!reason.cta && reason.action !== 'wait_for_system';

  const Content = (
    <View style={[styles.row, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.accent + '22' }]}>
        <Feather name={c.icon} size={14} color={c.accent} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowHeadline, { color: textPrimary }]}>{reason.headline}</Text>
        <Text style={[styles.rowDetail, { color: textSec }]}>{reason.detail}</Text>
        {reason.cta ? (
          <View style={styles.ctaRow}>
            <Text style={[styles.ctaText, { color: c.accent }]}>{reason.cta}</Text>
            {interactive ? <Feather name="arrow-right" size={12} color={c.accent} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  return interactive ? <Pressable onPress={onPress}>{Content}</Pressable> : Content;
}

export default function BlockedReasonsCard({ campaignId, isDark = true, onSubmitTruth }: Props) {
  const { data, isLoading } = useBlockedReasons(campaignId);

  // Empty state: nothing to ask the user. Render NOTHING so the dashboard
  // stays clean when the lifecycle is healthy. (Loading also hides; a brief
  // flash on first paint is better than a permanent skeleton placeholder.)
  if (isLoading) return null;
  if (!data || (data.reasons.length === 0 && !data.truthDue)) return null;

  // If truthDue but no concrete user_truth_missing in warnings (e.g. window
  // just opened and boss hasn't run yet), inject a synthetic CTA so the
  // user always sees the ask the moment a window is open.
  const reasons: BlockedReason[] = [...data.reasons];
  const hasTruthReason = reasons.some((r) => r.action === 'submit_user_truth');
  if (data.truthDue && !hasTruthReason) {
    reasons.unshift({
      code: 'truth_due_window_open',
      action: 'submit_user_truth',
      tone: data.truthDue.isLate ? 'shift' : 'watching',
      headline: data.truthDue.isLate ? "Last week's numbers are late" : 'Tell me how last week went',
      detail: 'Enter the 4 numbers from last week so I can score the plan.',
      cta: data.truthDue.isLate ? 'Submit late numbers' : 'Submit weekly numbers',
    });
  }

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textSec = isDark ? '#8892A4' : '#546478';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="alert-circle" size={14} color="#FFB347" />
          <Text style={[styles.title, { color: textSec }]}>ACTION ITEMS</Text>
        </View>
        <Text style={[styles.subtitle, { color: textSec }]}>{reasons.length} to address</Text>
      </View>
      <View style={styles.stack}>
        {reasons.map((r) => (
          <ReasonRow
            key={r.code + ':' + r.action}
            reason={r}
            isDark={isDark}
            onPress={routeForAction(r.action, onSubmitTruth)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  subtitle: { fontSize: 11, fontWeight: '500' },
  stack: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowHeadline: { fontSize: 13, fontWeight: '600', lineHeight: 17 },
  rowDetail: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  ctaText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
