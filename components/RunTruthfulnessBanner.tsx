import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useRunTruthfulness, type TruthfulnessHeadline } from "@/hooks/useRunTruthfulness";
import { useTrustCopy, trustToneColor, type TrustState, type TrustCopy } from "@/lib/copy-helpers";
import { useLanguage } from "@/context/LanguageContext";

interface Props {
  campaignId: string | null | undefined;
  isDark: boolean;
}

const ICON_FOR_STATE: Record<TrustState, keyof typeof Ionicons.glyphMap> = {
  ok: "checkmark-circle",
  validated: "checkmark-circle",
  provisional: "warning",
  weak: "warning",
  partial: "warning",
  degraded: "warning",
  lower_confidence: "warning",
  data_refreshing: "refresh",
  unknown: "help-circle",
  shadowed: "warning",
  system_untrusted: "alert-circle",
  needs_reconciliation: "git-pull-request",
  review_required: "person",
  blocked: "ban",
  downgrade: "arrow-down-circle",
  repair: "build",
  no_run: "play-circle",
};

function headlineToState(h: TruthfulnessHeadline): TrustState {
  switch (h) {
    case "shadowed":             return "shadowed";
    case "system_untrusted":     return "system_untrusted";
    case "needs_reconciliation": return "needs_reconciliation";
    case "review_required":      return "review_required";
    case "blocked":              return "blocked";
    case "downgrade":            return "downgrade";
    case "repair":               return "repair";
    case "no_run":               return "no_run";
    default:                     return "ok";
  }
}

export function RunTruthfulnessBanner({ campaignId, isDark }: Props) {
  const { data } = useRunTruthfulness(campaignId);
  const trustCopy = useTrustCopy();
  const { t } = useLanguage();

  if (!data || !data.shouldShowBanner) return null;

  const state = headlineToState(data.headline);

  // Tailor description for nuanced cases the helper can't see.
  let descOverride: string | undefined;
  if (state === "system_untrusted") {
    descOverride = data.freshness.hasStaleSnapshots
      ? t("trust.awaitingVerificationStale")
      : t("trust.awaitingVerificationDesc");
  } else if (state === "shadowed") {
    descOverride = t("trust.newerFailedDesc");
  } else if (state === "blocked" && data.verdict?.blockReasons?.[0]?.description) {
    // Keep technical reason text suppressed; lean on friendly default.
    descOverride = t("trust.pausedDesc");
  }

  const copy: TrustCopy = trustCopy(state, { description: descOverride });
  const color = trustToneColor(copy.tone);
  const icon = ICON_FOR_STATE[state];

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
      style={[styles.container, { backgroundColor: bg, borderColor: border, borderLeftColor: color }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + "20" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: textPrimary }]} numberOfLines={1}>
          {copy.title}
        </Text>
        <Text style={[styles.subtitle, { color: textSec }]} numberOfLines={2}>
          {copy.description}
        </Text>
        {data.verdict && (
          <Text style={[styles.meta, { color: textSec }]} numberOfLines={1}>
            {t("trust.checksPassed", { passed: data.verdict.checksPassed, total: data.verdict.checksTotal })}
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
