/**
 * ReasoningCardsPanel — Strategic Reasoning Layer (P-4)
 *
 * Renders evidence-cited Reasoning Cards produced by the Strategic Reasoning
 * Engine: market direction, momentum, recurring patterns, strategic context,
 * competitive pressure, evidence summary, confidence, and uncertainty.
 *
 * Doctrine:
 *   - Observations and context only — NO strategic recommendations.
 *   - Every card cites evidence refs; tapping a card reveals the evidence labels.
 *   - No internal UUIDs, no raw captions on this surface.
 *   - Honest degradation: deterministic fallback is labeled, never hidden.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReasoningCards, type ReasoningCardItem } from '@/hooks/usePerception';

const CARD_META: Record<ReasoningCardItem['cardType'], { icon: keyof typeof Feather.glyphMap; label: string }> = {
  market_direction:     { icon: 'compass',     label: 'Market direction' },
  market_momentum:      { icon: 'activity',    label: 'Momentum' },
  recurring_pattern:    { icon: 'rotate-cw',   label: 'Recurring pattern' },
  strategic_context:    { icon: 'briefcase',   label: 'Strategic context' },
  competitive_pressure: { icon: 'users',       label: 'Competitive pressure' },
  evidence_summary:     { icon: 'layers',      label: 'Evidence' },
  confidence:           { icon: 'check-circle', label: 'Confidence' },
  uncertainty:          { icon: 'help-circle', label: 'Uncertainty' },
};

const CONF_COLOR: Record<string, string> = { high: '#34D399', medium: '#FBBF24', low: '#8892A4' };

function CardRow({
  card,
  evidenceLabels,
  isDark,
}: {
  card: ReasoningCardItem;
  evidenceLabels: Map<string, string>;
  isDark: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';
  const rowBg       = isDark ? '#141A28' : '#FAFBFC';
  const rowBorder   = isDark ? '#232C3F' : '#E5E9EF';
  const meta = CARD_META[card.cardType];
  const cited = card.evidenceRefs
    .map((ref) => evidenceLabels.get(ref))
    .filter((l): l is string => !!l);

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <View style={[styles.row, { backgroundColor: rowBg, borderColor: rowBorder }]}>
        <View style={styles.rowHead}>
          <View style={styles.rowHeadLeft}>
            <Feather name={meta.icon} size={12} color="#4C9AFF" />
            <Text style={[styles.typeLabel, { color: textSec }]}>{meta.label}</Text>
          </View>
          <View style={styles.rowHeadRight}>
            <View style={[styles.confDot, { backgroundColor: CONF_COLOR[card.confidence] }]} />
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={textSec} />
          </View>
        </View>
        <Text style={[styles.cardTitle, { color: textPrimary }]}>{card.title}</Text>
        <Text style={[styles.cardBody, { color: textPrimary }]}>{card.body}</Text>
        {expanded && cited.length > 0 && (
          <View style={styles.expandBlock}>
            <Text style={[styles.sectionLabel, { color: textSec }]}>Based on</Text>
            {cited.map((label, i) => (
              <Text key={i} style={[styles.evidenceText, { color: textSec }]}>• {label}</Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function ReasoningCardsPanel({ campaignId, isDark }: { campaignId: string | null | undefined; isDark: boolean }) {
  const { data, isLoading } = useReasoningCards(campaignId);
  const cardBg      = isDark ? '#101624' : '#FFFFFF';
  const cardBorder  = isDark ? '#1E2637' : '#E5E9EF';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';

  if (!campaignId) return null;
  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <ActivityIndicator size="small" color={textSec} />
      </View>
    );
  }
  if (!data?.success) return null;

  if (data.state === 'no_history' || data.cards.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.header}>
          <Feather name="git-merge" size={15} color={textSec} />
          <Text style={[styles.title, { color: textPrimary }]}>Strategic reasoning</Text>
        </View>
        <Text style={[styles.emptyText, { color: textSec }]}>
          Strategic reasoning activates once validated market insights start
          accumulating in memory. Check back after the next market snapshot.
        </Text>
      </View>
    );
  }

  const evidenceLabels = new Map(data.evidence.map((e) => [e.ref, e.label]));

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <Feather name="git-merge" size={15} color="#4C9AFF" />
        <Text style={[styles.title, { color: textPrimary }]}>Strategic reasoning</Text>
        <Text style={[styles.headerMeta, { color: textSec }]}>
          {data.source === 'ai' ? 'grounded read' : 'verified facts'}
        </Text>
      </View>

      {data.cards.map((card) => (
        <CardRow key={card.cardType} card={card} evidenceLabels={evidenceLabels} isDark={isDark} />
      ))}

      <Text style={[styles.footer, { color: textSec }]}>
        Every card cites verified evidence — market memory, performance outcomes,
        and your business context. Observations only, no recommendations.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 14, fontWeight: '700', flex: 1 },
  headerMeta: { fontSize: 11, fontWeight: '500' },
  emptyText: { fontSize: 12, lineHeight: 17 },
  row: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  rowHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  confDot: { width: 7, height: 7, borderRadius: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700' },
  cardBody: { fontSize: 12, lineHeight: 17 },
  expandBlock: { marginTop: 6, gap: 3 },
  sectionLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  evidenceText: { fontSize: 11, lineHeight: 15 },
  footer: { fontSize: 10, lineHeight: 14, marginTop: 2 },
});
