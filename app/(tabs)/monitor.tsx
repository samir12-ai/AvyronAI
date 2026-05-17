import React from "react";
import { View, Text, StyleSheet, ScrollView, useColorScheme, ActivityIndicator, Pressable } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useCampaign } from "@/context/CampaignContext";
import Colors from "@/constants/colors";

type EarlyWarningVerdict = "CALM" | "WATCH" | "ACT" | "BLOCK";
type Severity = string;

interface SignalBlock {
  severity?: Severity;
  mode?: string;
  value?: number | null;
  reasonCodes?: string[];
  churnIndicators?: string[];
  signalOrigin: string;
  degraded: { flag: true; reason: string; source: string; signalOrigin: string } | null;
  sourceEndpoint: string;
  deltas?: Array<{ field: string; delta: number; severity: string }>;
}

interface EarlyWarning {
  campaignId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  signalOrigin: { real: number; competitor: number; inferred: number; fallback: number; unknown: number };
  degraded: { flag: true; reason: string } | null;
  validationState: "validated" | "provisional" | "weak" | "rejected" | "unknown";
  planSource: string;
  fallbackPlanIsolated: boolean;
  signals: {
    roas: SignalBlock;
    creativeFatigue: SignalBlock;
    competitorTrajectoryShift: SignalBlock;
    retentionRisk: SignalBlock;
  };
  earlyWarningVerdict: EarlyWarningVerdict;
  earlyWarningRationale: string;
  contractIncompleteFields: string[];
}

const VERDICT_COLOR: Record<EarlyWarningVerdict, string> = {
  CALM: "#34D399",
  WATCH: "#FFB347",
  ACT: "#FF8C42",
  BLOCK: "#FF6B6B",
};

const VERDICT_LABEL: Record<EarlyWarningVerdict, string> = {
  CALM: "All clear",
  WATCH: "Watch closely",
  ACT: "Action needed",
  BLOCK: "Halted",
};

export default function MonitorScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { selectedCampaignId } = useCampaign();
  const campaignId = selectedCampaignId;

  const { data, isLoading, isError, error, refetch } = useQuery<EarlyWarning>({
    queryKey: ["/api/monitor/early-warning", campaignId],
    enabled: !!campaignId,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Monitor</Text>
        <Pressable onPress={() => refetch()} hitSlop={12}>
          <Ionicons name="refresh" size={22} color={colors.text} />
        </Pressable>
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Early warning across revenue, audience, competitors, and retention
      </Text>

      {!campaignId && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.textSecondary }}>Select a campaign to view early-warning signals.</Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      )}

      {isError && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.error }}>{(error as Error)?.message ?? "Failed to load"}</Text>
        </View>
      )}

      {data && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          <View style={[styles.verdictCard, { backgroundColor: VERDICT_COLOR[data.earlyWarningVerdict] + "22", borderColor: VERDICT_COLOR[data.earlyWarningVerdict] }]}>
            <Text style={[styles.verdictLabel, { color: VERDICT_COLOR[data.earlyWarningVerdict] }]}>
              {VERDICT_LABEL[data.earlyWarningVerdict]}
            </Text>
            <Text style={[styles.verdictRationale, { color: colors.text }]}>{data.earlyWarningRationale}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Trust & evidence</Text>
            <KV k="Validation" v={data.validationState.toUpperCase()} isDark={isDark} />
            <KV k="Plan source" v={data.planSource} isDark={isDark} />
            <KV k="Fallback isolated" v={data.fallbackPlanIsolated ? "Yes" : "No"} isDark={isDark} />
            <KV k="Real signals" v={`${Math.round((data.signalOrigin.real + data.signalOrigin.competitor) * 100)}%`} isDark={isDark} />
            {data.contractIncompleteFields.length > 0 && (
              <Text style={[styles.warnText, { color: colors.warning }]}>
                Missing fields: {data.contractIncompleteFields.join(", ")}
              </Text>
            )}
            {data.degraded && (
              <Text style={[styles.warnText, { color: colors.warning }]}>Degraded: {data.degraded.reason}</Text>
            )}
          </View>

          <SignalCard title="Revenue (ROAS)" block={data.signals.roas} extra={data.signals.roas.value != null ? `ROAS ${data.signals.roas.value.toFixed(2)}x · ${data.signals.roas.mode}` : "No revenue data"} isDark={isDark} colors={colors} />
          <SignalCard title="Creative fatigue" block={data.signals.creativeFatigue} extra={data.signals.creativeFatigue.reasonCodes?.join(", ") || "No fatigue indicators"} isDark={isDark} colors={colors} />
          <SignalCard title="Competitor trajectory" block={data.signals.competitorTrajectoryShift} extra={(data.signals.competitorTrajectoryShift.deltas || []).filter(d => d.severity !== "none" && d.severity !== "unknown").map(d => `${d.field} ${d.delta > 0 ? "+" : ""}${d.delta.toFixed(2)}`).join(" · ") || "No meaningful shifts"} isDark={isDark} colors={colors} />
          <SignalCard title="Retention risk" block={data.signals.retentionRisk} extra={data.signals.retentionRisk.churnIndicators?.join(", ") || "No churn indicators"} isDark={isDark} colors={colors} />
        </ScrollView>
      )}
    </View>
  );
}

function KV({ k, v, isDark }: { k: string; v: string; isDark: boolean }) {
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.kvLabel, { color: isDark ? "#8892A4" : "#546478" }]}>{k}</Text>
      <Text style={[styles.kvVal, { color: isDark ? "#E8EDF2" : "#1A2332" }]} numberOfLines={2}>{v}</Text>
    </View>
  );
}

interface SignalColors {
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  error: string;
  warning: string;
  accentOrange: string;
  success: string;
}

function SignalCard({ title, block, extra, isDark, colors }: { title: string; block: SignalBlock; extra: string; isDark: boolean; colors: SignalColors }) {
  const sev = block.severity || "unknown";
  const sevColor = sev === "critical" || sev === "urgent" ? colors.error : sev === "warn" || sev === "risk" ? colors.warning : sev === "watch" ? colors.accentOrange : sev === "none" ? colors.success : colors.textMuted;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.signalHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
        <View style={[styles.sevPill, { backgroundColor: sevColor + "22", borderColor: sevColor }]}>
          <Text style={[styles.sevText, { color: sevColor }]}>{sev.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, marginTop: 6 }}>{extra}</Text>
      <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 11 }}>
        origin: {block.signalOrigin}{block.degraded ? ` · degraded (${block.degraded.source})` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  verdictCard: { padding: 18, borderRadius: 16, borderWidth: 1, marginBottom: 14 },
  verdictLabel: { fontSize: 22, fontFamily: "Inter_700Bold" },
  verdictRationale: { fontSize: 13, marginTop: 6 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  kvLabel: { fontSize: 12 },
  kvVal: { fontSize: 12, fontFamily: "Inter_500Medium", maxWidth: "60%", textAlign: "right" },
  warnText: { fontSize: 12, marginTop: 8 },
  signalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sevPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  sevText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  center: { padding: 40, alignItems: "center" },
});
