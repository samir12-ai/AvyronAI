/**
 * MarketSnapshotCard — Distribution Intelligence Layer (P-3 Enhancement)
 *
 * Shows the current STRUCTURE of the market computed deterministically from
 * competitor_post_classifications: dominant patterns per semantic dimension,
 * emerging patterns (rapid adoption), and declining patterns.
 *
 * Doctrine:
 *   - Market observations only — NO strategic recommendations.
 *   - No internal UUIDs, no raw captions, no AI calls on this surface.
 *   - Honest degradation: thin/insufficient data is labeled, never hidden.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  useMarketSnapshot,
  useMarketInsight,
  type MarketInsight,
  type MarketPattern,
} from '@/hooks/usePerception';

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

const TREND_ICON: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  rising:               { icon: 'trending-up',   color: '#34D399' },
  falling:              { icon: 'trending-down', color: '#F87171' },
  stable:               { icon: 'minus',         color: '#8892A4' },
  new_leader:           { icon: 'refresh-cw',    color: '#FBBF24' },
  insufficient_history: { icon: 'clock',         color: '#8892A4' },
};

// ── dominant pattern row (one per dimension) ─────────────────────────────────
function InsightRow({ insight, isDark }: { insight: MarketInsight; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';
  const rowBg       = isDark ? '#141A28' : '#FAFBFC';
  const rowBorder   = isDark ? '#232C3F' : '#E5E9EF';
  const t = TREND_ICON[insight.trend] ?? TREND_ICON.insufficient_history;

  if (!insight.leader) return null;

  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <View style={[styles.row, { backgroundColor: rowBg, borderColor: rowBorder }]}>
        <View style={styles.rowHead}>
          <View style={styles.rowHeadLeft}>
            <Text style={[styles.dimLabel, { color: textSec }]} numberOfLines={1}>
              {insight.dimensionLabel}
            </Text>
          </View>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={textSec} />
        </View>

        <View style={styles.leaderLine}>
          <Text style={[styles.leaderText, { color: textPrimary }]} numberOfLines={1}>
            {insight.leader}
          </Text>
          <Text style={[styles.shareText, { color: textPrimary }]}>{insight.leaderShare}%</Text>
          <Feather name={t.icon} size={13} color={t.color} />
        </View>

        <Text style={[styles.metaText, { color: textSec }]} numberOfLines={1}>
          {insight.trendLabel}
          {insight.trend !== 'insufficient_history' && insight.trend !== 'new_leader'
            ? ` (${insight.trendDeltaPp >= 0 ? '+' : ''}${insight.trendDeltaPp}pp)` : ''}
          {' · '}{insight.sampleSize} posts · {insight.competitorCount} competitors · {CONFIDENCE_LABEL[insight.confidence]}
        </Text>

        {expanded && (
          <View style={styles.expandBlock}>
            {insight.distribution.map((d) => (
              <View key={d.value} style={styles.distLine}>
                <Text style={[styles.distValue, { color: textPrimary }]} numberOfLines={1}>{d.value}</Text>
                <Text style={[styles.distShare, { color: textSec }]}>{d.share}%</Text>
              </View>
            ))}
            {insight.evidence.map((e, i) => (
              <Text key={i} style={[styles.evidenceText, { color: textSec }]}>• {e}</Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ── emerging / declining pattern chip row ────────────────────────────────────
function PatternRow({ pattern, direction, isDark }: { pattern: MarketPattern; direction: 'emerging' | 'declining'; isDark: boolean }) {
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';
  const accent = direction === 'emerging' ? '#34D399' : '#F87171';
  const bg = direction === 'emerging' ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)';
  const border = direction === 'emerging' ? 'rgba(52, 211, 153, 0.25)' : 'rgba(248, 113, 113, 0.25)';

  return (
    <View style={[styles.patternRow, { backgroundColor: bg, borderColor: border }]}>
      <Feather name={direction === 'emerging' ? 'arrow-up-right' : 'arrow-down-right'} size={13} color={accent} />
      <View style={styles.patternBody}>
        <Text style={[styles.patternValue, { color: textPrimary }]} numberOfLines={1}>
          {pattern.value}
        </Text>
        <Text style={[styles.patternMeta, { color: textSec }]} numberOfLines={1}>
          {pattern.dimensionLabel} · {pattern.previousShare}% → {pattern.currentShare}%
        </Text>
      </View>
      <Text style={[styles.patternDelta, { color: accent }]}>
        {pattern.deltaPp >= 0 ? '+' : ''}{pattern.deltaPp}pp
      </Text>
    </View>
  );
}

// ── analyst read (AI Interpretation Layer — judge-approved or deterministic) ─
function AnalystRead({ campaignId, isDark }: { campaignId: string | null | undefined; isDark: boolean }) {
  const { data } = useMarketInsight(campaignId, 30);
  const [expanded, setExpanded] = useState(false);
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSec     = isDark ? '#8892A4' : '#546478';
  const blockBg     = isDark ? 'rgba(76, 154, 255, 0.07)' : 'rgba(76, 154, 255, 0.05)';
  const blockBorder = isDark ? 'rgba(76, 154, 255, 0.22)' : 'rgba(76, 154, 255, 0.18)';

  if (!data?.success || !data.narrative) return null;

  const hasDetail =
    data.signalGroups.length > 0 || data.strongestObservations.length > 0 || data.uncertainObservations.length > 0;

  return (
    <Pressable onPress={() => hasDetail && setExpanded(!expanded)} disabled={!hasDetail}>
      <View style={[styles.analystBlock, { backgroundColor: blockBg, borderColor: blockBorder }]}>
        <View style={styles.rowHead}>
          <View style={styles.rowHeadLeft}>
            <Feather name={data.source === 'ai' ? 'cpu' : 'file-text'} size={12} color="#4C9AFF" />
            <Text style={[styles.analystTag, { color: '#4C9AFF' }]}>
              {data.source === 'ai' ? 'Analyst read · grounded in verified signals' : 'Verified summary'}
            </Text>
          </View>
          {hasDetail && <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={13} color={textSec} />}
        </View>
        {data.headline ? (
          <Text style={[styles.analystHeadline, { color: textPrimary }]}>{data.headline}</Text>
        ) : null}
        <Text style={[styles.analystNarrative, { color: textPrimary }]}>{data.narrative}</Text>

        {expanded && (
          <View style={styles.expandBlock}>
            {data.signalGroups.map((g, i) => (
              <View key={i} style={styles.analystGroup}>
                <Text style={[styles.analystGroupTitle, { color: textPrimary }]}>{g.title}</Text>
                <Text style={[styles.evidenceText, { color: textSec }]}>{g.observation}</Text>
              </View>
            ))}
            {data.strongestObservations.length > 0 && (
              <Text style={[styles.analystSectionLabel, { color: textSec }]}>Best supported</Text>
            )}
            {data.strongestObservations.map((s, i) => (
              <Text key={`s-${i}`} style={[styles.evidenceText, { color: textSec }]}>• {s}</Text>
            ))}
            {data.uncertainObservations.length > 0 && (
              <Text style={[styles.analystSectionLabel, { color: textSec }]}>Still uncertain</Text>
            )}
            {data.uncertainObservations.map((s, i) => (
              <Text key={`u-${i}`} style={[styles.evidenceText, { color: textSec }]}>• {s}</Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ── main card ─────────────────────────────────────────────────────────────────
export default function MarketSnapshotCard({ campaignId, isDark }: { campaignId: string | null | undefined; isDark: boolean }) {
  const { data, isLoading } = useMarketSnapshot(campaignId, 30);
  const [showAll, setShowAll] = useState(false);

  const cardBg     = isDark ? '#101624' : '#FFFFFF';
  const cardBorder = isDark ? '#1E2637' : '#E5E9EF';
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

  // Building baseline: honest empty state, not silence.
  if (data.state === 'building_baseline') {
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={styles.header}>
          <Feather name="pie-chart" size={15} color={textSec} />
          <Text style={[styles.title, { color: textPrimary }]}>Market snapshot</Text>
        </View>
        <Text style={[styles.emptyText, { color: textSec }]}>
          Building the market picture. Once enough competitor posts are classified
          in the current period, distributions will appear here.
        </Text>
      </View>
    );
  }

  // Only surface insights where a leader exists; low-confidence rows sink to the bottom.
  const ranked = [...(data.insights ?? [])]
    .filter((i) => i.leader)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      return rank[a.confidence] - rank[b.confidence];
    });
  const visible = showAll ? ranked : ranked.slice(0, 4);

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.header}>
        <Feather name="pie-chart" size={15} color="#4C9AFF" />
        <Text style={[styles.title, { color: textPrimary }]}>Market snapshot</Text>
        <Text style={[styles.headerMeta, { color: textSec }]}>last {data.windowDays}d</Text>
      </View>

      {data.dataStatus === 'thin' && (
        <Text style={[styles.thinNote, { color: textSec }]}>
          Limited data this period ({data.totalPosts} classified posts) — treat shares as directional.
        </Text>
      )}

      {/* Analyst read — AI interpretation of verified signals (or deterministic summary). */}
      <AnalystRead campaignId={campaignId} isDark={isDark} />

      {/* Emerging / declining patterns first — the movement is the news. */}
      {data.emerging.map((p, i) => (
        <PatternRow key={`e-${i}`} pattern={p} direction="emerging" isDark={isDark} />
      ))}
      {data.declining.map((p, i) => (
        <PatternRow key={`d-${i}`} pattern={p} direction="declining" isDark={isDark} />
      ))}

      {/* Dominant patterns per dimension */}
      {visible.map((insight) => (
        <InsightRow key={insight.dimension} insight={insight} isDark={isDark} />
      ))}

      {ranked.length > 4 && (
        <Pressable onPress={() => setShowAll(!showAll)}>
          <Text style={[styles.showMore, { color: '#4C9AFF' }]}>
            {showAll ? 'Show less' : `Show all ${ranked.length} dimensions`}
          </Text>
        </Pressable>
      )}

      <Text style={[styles.footer, { color: textSec }]}>
        Based on {data.totalPosts} classified competitor posts from {data.totalCompetitors} competitors.
        Market observations only.
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
  thinNote: { fontSize: 11, fontStyle: 'italic' },
  row: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  dimLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  leaderLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leaderText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  shareText: { fontSize: 14, fontWeight: '700' },
  metaText: { fontSize: 11 },
  expandBlock: { marginTop: 6, gap: 3 },
  distLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  distValue: { fontSize: 12, flexShrink: 1 },
  distShare: { fontSize: 12, fontWeight: '600' },
  evidenceText: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  patternRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  patternBody: { flex: 1, gap: 1 },
  patternValue: { fontSize: 13, fontWeight: '700' },
  patternMeta: { fontSize: 11 },
  patternDelta: { fontSize: 13, fontWeight: '700' },
  showMore: { fontSize: 12, fontWeight: '600', textAlign: 'center', paddingVertical: 4 },
  footer: { fontSize: 10, lineHeight: 14, marginTop: 2 },
  analystBlock: { borderRadius: 10, borderWidth: 1, padding: 11, gap: 5 },
  analystTag: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  analystHeadline: { fontSize: 13, fontWeight: '700' },
  analystNarrative: { fontSize: 12, lineHeight: 17 },
  analystGroup: { gap: 2, marginBottom: 4 },
  analystGroupTitle: { fontSize: 12, fontWeight: '700' },
  analystSectionLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
});
