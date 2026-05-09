import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useRunTruthfulness, type TruthfulnessHeadline } from "@/hooks/useRunTruthfulness";

interface Props {
  campaignId: string | null | undefined;
  isDark: boolean;
}

interface HeadlineMeta {
  title: string;
  subtitle: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
}

function metaFor(h: TruthfulnessHeadline, t: any): HeadlineMeta {
  switch (h) {
    case "shadowed":
      return {
        title: "Newer run failed",
        subtitle: `Showing older completed run. Newest attempt status: ${t.newerNonResolvableRun?.status || "unknown"}.`,
        color: "#FFB347",
        icon: "warning",
      };
    case "system_untrusted":
      return {
        title: "Verdict unverified",
        subtitle: t.freshness.hasStaleSnapshots
          ? `Stale snapshot evidence (${t.freshness.staleEngines.join(", ") || "1+ engines"}).`
          : "Pipeline incomplete — engine outputs missing or timed out.",
        color: "#FF6B6B",
        icon: "alert-circle",
      };
    case "needs_reconciliation":
      return {
        title: "Cross-engine contradiction",
        subtitle: "Engines disagree — manual reconciliation required.",
        color: "#FF6B6B",
        icon: "git-pull-request",
      };
    case "review_required":
      return {
        title: "Human review required",
        subtitle: "Verdict exceeds the automation envelope.",
        color: "#FFB347",
        icon: "person",
      };
    case "blocked":
      return {
        title: "Execution blocked",
        subtitle: t.verdict?.blockReasons?.[0]?.description || "One or more critical blocks active.",
        color: "#FF6B6B",
        icon: "ban",
      };
    case "downgrade":
      return {
        title: "Execution downgraded",
        subtitle: t.verdict?.executionMode || "Restricted execution mode.",
        color: "#FFB347",
        icon: "arrow-down-circle",
      };
    case "repair":
      return {
        title: "Auto-repair active",
        subtitle: "System Control attempting to recover.",
        color: "#4C9AFF",
        icon: "build",
      };
    case "no_run":
      return {
        title: "No completed run yet",
        subtitle: "Run the strategic engines to generate a verdict.",
        color: "#8892A4",
        icon: "play-circle",
      };
    default:
      return {
        title: "OK",
        subtitle: "",
        color: "#85BB65",
        icon: "checkmark-circle",
      };
  }
}

export function RunTruthfulnessBanner({ campaignId, isDark }: Props) {
  const { data } = useRunTruthfulness(campaignId);

  if (!data || !data.shouldShowBanner) return null;

  const meta = metaFor(data.headline, data);
  const bg = isDark ? "#0F1419" : "#FFFFFF";
  const border = isDark ? "#1A2030" : "#E2E8E4";
  const textPrimary = isDark ? "#E8EDF2" : "#1A2332";
  const textSec = isDark ? "#8892A4" : "#546478";

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/audit-control",
          params: { campaignId: campaignId || "" },
        })
      }
      testID="run-truthfulness-banner"
      style={[styles.container, { backgroundColor: bg, borderColor: border, borderLeftColor: meta.color }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: meta.color + "20" }]}>
        <Ionicons name={meta.icon} size={20} color={meta.color} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: textPrimary }]} numberOfLines={1}>
          {meta.title}
        </Text>
        <Text style={[styles.subtitle, { color: textSec }]} numberOfLines={2}>
          {meta.subtitle}
        </Text>
        {data.verdict && (
          <Text style={[styles.meta, { color: textSec }]} numberOfLines={1}>
            {data.verdict.checksPassed}/{data.verdict.checksTotal} checks · mode {data.verdict.executionMode}
            {data.runId ? ` · run ${data.runId.slice(0, 8)}` : ""}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={textSec} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  meta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },
});
