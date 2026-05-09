import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  classifyEnvelopeBadge,
  type LiveSnapshotEnvelope,
} from "@/lib/envelope";

interface Props {
  envelope: LiveSnapshotEnvelope | null | undefined;
  onRerun?: () => void;
  compact?: boolean;
  testID?: string;
}

const ICON_BY_KIND: Record<string, keyof typeof Ionicons.glyphMap> = {
  live: "checkmark-circle",
  reused: "refresh-circle",
  stale: "time",
  incomplete: "alert-circle",
  unknown: "help-circle",
};

export function EnvelopeBadge({ envelope, onRerun, compact, testID }: Props) {
  const meta = classifyEnvelopeBadge(envelope);
  if (!meta) return null;

  const icon = ICON_BY_KIND[meta.kind] || "information-circle";
  const showRerun = !!onRerun && (meta.kind === "stale" || meta.kind === "incomplete");

  if (compact) {
    return (
      <View
        testID={testID || "envelope-badge"}
        style={[styles.compactPill, { borderColor: meta.color + "55", backgroundColor: meta.color + "15" }]}
      >
        <Ionicons name={icon} size={11} color={meta.color} />
        <Text style={[styles.compactText, { color: meta.color }]} numberOfLines={1}>
          {meta.label}
        </Text>
      </View>
    );
  }

  return (
    <View
      testID={testID || "envelope-badge"}
      style={[styles.row, { borderColor: meta.color + "40", backgroundColor: meta.color + "10" }]}
    >
      <Ionicons name={icon} size={14} color={meta.color} />
      <View style={styles.body}>
        <Text style={[styles.label, { color: meta.color }]} numberOfLines={1}>
          {meta.label}
        </Text>
        <Text style={[styles.detail, { color: meta.color + "CC" }]} numberOfLines={2}>
          {meta.detail}
        </Text>
      </View>
      {showRerun && (
        <Pressable
          onPress={onRerun}
          style={[styles.rerunBtn, { borderColor: meta.color + "55" }]}
          testID="envelope-badge-rerun"
        >
          <Ionicons name="refresh" size={12} color={meta.color} />
          <Text style={[styles.rerunText, { color: meta.color }]}>Re-run</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  body: { flex: 1 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  detail: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1, lineHeight: 13 },
  rerunBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  rerunText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  compactPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  compactText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
