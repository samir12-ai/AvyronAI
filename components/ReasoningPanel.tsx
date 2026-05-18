import React from "react";
import { View, Text, StyleSheet, useColorScheme, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReasoning, type ReasoningCard as Card, type ReasoningCardState } from "@/hooks/useReasoning";

const TONE = {
  ok:           { fg: "#10B981", bg: "rgba(16,185,129,0.10)", icon: "checkmark-circle" as const, label: "Looks good" },
  degraded:     { fg: "#F59E0B", bg: "rgba(245,158,11,0.10)", icon: "alert-circle" as const,     label: "Partial" },
  insufficient: { fg: "#8892A4", bg: "rgba(136,146,164,0.10)", icon: "time-outline" as const,    label: "Gathering" },
  missing:      { fg: "#546478", bg: "rgba(84,100,120,0.10)",  icon: "ellipse-outline" as const, label: "Not yet" },
} as const;

function tone(state: ReasoningCardState) {
  return TONE[state] ?? TONE.missing;
}

function ProvenanceBadge({ kind, isDark }: { kind: Card["provenance"]; isDark: boolean }) {
  if (!kind) return null;
  const labelByKind = { live: "Live data", benchmark: "Benchmark", mixed: "Mixed" } as const;
  const fg = kind === "live" ? "#10B981" : kind === "benchmark" ? "#8B5CF6" : "#4C9AFF";
  return (
    <View style={[styles.badge, { backgroundColor: fg + "18", borderColor: fg + "30" }]}>
      <View style={[styles.badgeDot, { backgroundColor: fg }]} />
      <Text style={[styles.badgeText, { color: fg }]}>{labelByKind[kind]}</Text>
    </View>
  );
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function ReasoningCardRow({ card, isDark }: { card: Card; isDark: boolean }) {
  const t = tone(card.state);
  const bg = isDark ? "#0F1419" : "#FFFFFF";
  const border = isDark ? "#1A2030" : "#E2E8E4";
  const textPrimary = isDark ? "#E8EDF2" : "#1A2332";
  const textMuted = isDark ? "#8892A4" : "#8A96A8";
  const conf = card.confidence;
  const ago = formatRelative(card.lastUpdatedAt);

  return (
    <View style={[styles.card, { backgroundColor: bg, borderColor: border }]} testID={`reasoning-card-${card.id}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.cardIcon, { backgroundColor: t.bg }]}>
            <Ionicons name={t.icon} size={14} color={t.fg} />
          </View>
          <Text style={[styles.cardLabel, { color: textPrimary }]}>{card.label}</Text>
        </View>
        <Text style={[styles.cardState, { color: t.fg }]}>{t.label}</Text>
      </View>

      {card.reason ? (
        <Text style={[styles.cardReason, { color: textMuted }]}>{card.reason}</Text>
      ) : null}

      {card.evidence ? (
        <Text style={[styles.cardEvidence, { color: textMuted }]}>{card.evidence}</Text>
      ) : null}

      <View style={styles.cardFooter}>
        {typeof conf === "number" ? (
          <View style={styles.confRow}>
            <View style={[styles.confTrack, { backgroundColor: isDark ? "#1A2030" : "#EEF1F4" }]}>
              <View style={[styles.confFill, { width: `${Math.round(conf * 100)}%`, backgroundColor: t.fg }]} />
            </View>
            <Text style={[styles.confText, { color: textMuted }]}>{Math.round(conf * 100)}%</Text>
          </View>
        ) : <View style={{ flex: 1 }} />}
        <ProvenanceBadge kind={card.provenance} isDark={isDark} />
        {ago ? <Text style={[styles.cardAgo, { color: textMuted }]}>{ago}</Text> : null}
      </View>
    </View>
  );
}

export default function ReasoningPanel({ campaignId }: { campaignId: string | null | undefined }) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const { data, isLoading, isError } = useReasoning(campaignId);
  const textPrimary = isDark ? "#E8EDF2" : "#1A2332";
  const textMuted = isDark ? "#8892A4" : "#8A96A8";

  if (!campaignId) return null;

  return (
    <View style={styles.wrapper} testID="reasoning-panel">
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: textPrimary }]}>How the system is thinking</Text>
        <Text style={[styles.subtitle, { color: textMuted }]}>Updated continuously</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={isDark ? "#8B5CF6" : "#7C3AED"} />
          <Text style={[styles.loadingText, { color: textMuted }]}>Reading the latest run…</Text>
        </View>
      ) : isError ? (
        <Text style={[styles.loadingText, { color: textMuted }]}>Reasoning view will appear after the next run.</Text>
      ) : !data?.cards?.length || data.state === "no_data" ? (
        <Text style={[styles.loadingText, { color: textMuted }]}>The first run is still gathering signals.</Text>
      ) : (
        <View style={styles.list}>
          {data.cards.map((c) => (
            <ReasoningCardRow key={c.id} card={c} isDark={isDark} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 14, marginBottom: 14 },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
  title: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 11 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 12 },
  list: { gap: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  cardIcon: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardLabel: { fontSize: 13, fontWeight: "600" },
  cardState: { fontSize: 11, fontWeight: "600" },
  cardReason: { fontSize: 12, marginBottom: 4 },
  cardEvidence: { fontSize: 11, marginBottom: 8 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  confRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  confTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  confFill: { height: "100%", borderRadius: 2 },
  confText: { fontSize: 10, minWidth: 28, textAlign: "right" },
  cardAgo: { fontSize: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeDot: { width: 5, height: 5, borderRadius: 2.5 },
  badgeText: { fontSize: 10, fontWeight: "600" },
});
