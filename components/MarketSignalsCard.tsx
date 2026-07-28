/**
 * MarketSignalsCard
 *
 * Surfaces confirmed Watchtower semantic shift events (pipeline_change_events
 * with validatedAt IS NOT NULL) to the customer.
 *
 * P-3 doctrine:
 *   - Detect meaningful market changes only — no strategic recommendations.
 *   - What changed / who / when / confidence (scope) / evidence / severity.
 *   - Signals driven by competitor_post_classifications distributions.
 *   - No internal UUIDs, no raw captions, no AI calls on this surface.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useMarketSignals, type MarketSignal } from '@/hooks/usePerception';
import { translateSignalScope, translateSignalSeverity } from '@shared/perception-translator';

// ── severity → visual treatment ──────────────────────────────────────────────
const SEVERITY_COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  major:  { bg: 'rgba(248, 113, 113, 0.10)', border: 'rgba(248, 113, 113, 0.30)', accent: '#F87171' },
  medium: { bg: 'rgba(251, 191, 36, 0.10)',  border: 'rgba(251, 191, 36, 0.30)',  accent: '#FBBF24' },
  mild:   { bg: 'rgba(76, 154, 255, 0.10)',   border: 'rgba(76, 154, 255, 0.30)',  accent: '#4C9AFF' },
};
const SCOPE_COLORS: Record<string, string> = {
  market_wide:          '#F87171',
  several_competitors:  '#FBBF24',
  single_competitor:    '#8892A4',
};

// ── individual signal row ─────────────────────────────────────────────────────
function SignalRow({ signal, isDark }: { signal: MarketSignal; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';
  const chipBg      = isDark ? '#1A2030' : '#F4F6F8';
  const c = SEVERITY_COLORS[signal.severity] ?? SEVERITY_COLORS.mild;
  const scopeColor = SCOPE_COLORS[signal.scope] ?? '#8892A4';
  const scopeLabel = translateSignalScope(signal.scope);
  const severityLabel = translateSignalSeverity(signal.severity);

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <View style={[styles.row, { backgroundColor: c.bg, borderColor: c.border }]}>
        {/* header line */}
        <View style={styles.rowHead}>
          <View style={styles.rowHeadLeft}>
            <Feather name="trending-up" size={13} color={c.accent} />
            <Text style={[styles.kindLabel, { color: textPrimary }]} numberOfLines={1}>
              {signal.label}
            </Text>
          </View>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={textSec} />
        </View>

        {/* meta chips */}
        <View style={styles.chips}>
          <View style={[styles.chip, { backgroundColor: chipBg }]}>
            <Text style={[styles.chipText, { color: c.accent }]}>{severityLabel}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: chipBg }]}>
            <Text style={[styles.chipText, { color: scopeColor }]}>{scopeLabel}</Text>
          </View>
          {signal.competitor ? (
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <Text style={[styles.chipText, { color: textSec }]} numberOfLines={1}>
                {signal.competitor}
              </Text>
            </View>
          ) : null}
          {signal.detectedAt ? (
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <Text style={[styles.chipText, { color: textSec }]}>
                {formatAge(signal.detectedAt)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* evidence (expanded) */}
        {expanded && signal.evidence.length > 0 ? (
          <View style={[styles.evidence, { borderTopColor: c.border }]}>
            {signal.evidence.map((line, i) => (
              <Text key={i} style={[styles.evidenceLine, { color: textSec }]}>
                {line}
              </Text>
            ))}
            {signal.scopeCompetitorCount > 1 ? (
              <Text style={[styles.evidenceLine, { color: scopeColor, marginTop: 4 }]}>
                {signal.scopeCompetitorCount} competitors confirmed this shift
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── main card ────────────────────────────────────────────────────────────────
interface Props {
  campaignId: string | null | undefined;
  isDark?: boolean;
}

export default function MarketSignalsCard({ campaignId, isDark = true }: Props) {
  const { data, isLoading, error } = useMarketSignals(campaignId, 10);

  const cardBg     = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';
  const textSec    = isDark ? '#8892A4' : '#546478';

  // Don't render the card at all when there are no confirmed signals yet.
  if (!isLoading && !error && data?.state === 'no_signals') return null;

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="activity" size={14} color="#F59E0B" />
          <Text style={[styles.title, { color: textSec }]}>MARKET SHIFTS</Text>
        </View>
        <Text style={[styles.subtitle, { color: textSec }]}>confirmed signals</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#F59E0B" />
        </View>
      ) : error ? (
        <Text style={[styles.errorText, { color: textSec }]}>Market signals unavailable</Text>
      ) : (
        <View style={styles.stack}>
          {(data?.signals ?? []).map((s, i) => (
            <SignalRow key={`${s.kind}:${s.competitor ?? i}:${s.detectedAt}`} signal={s} isDark={isDark} />
          ))}
        </View>
      )}

      <Text style={[styles.footer, { color: textSec }]}>
        Signals are confirmed when two independent scrapes detect the same shift. No strategic recommendations — detection only.
      </Text>
    </View>
  );
}

function formatAge(iso: string): string {
  const ageMs = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ageMs / 3_600_000);
  if (h < 1) return 'just confirmed';
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title:    { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  subtitle: { fontSize: 11, fontWeight: '500' },
  loadingRow: { alignItems: 'center', paddingVertical: 16 },
  errorText:  { fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  stack: { gap: 8 },
  row: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  kindLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: { fontSize: 11, fontWeight: '600' },
  evidence: {
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 3,
  },
  evidenceLine: { fontSize: 11, lineHeight: 16 },
  footer: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 10,
    fontStyle: 'italic',
  },
});
