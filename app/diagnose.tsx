import React from "react";
import { View, Text, StyleSheet, ScrollView, useColorScheme, ActivityIndicator, Pressable } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useCampaign } from "@/context/CampaignContext";
import Colors from "@/constants/colors";
import { useOperatorSurface } from "@/hooks/useOperatorSurface";

type SignalOrigin = "real" | "competitor" | "inferred" | "fallback" | "unknown";
type ValidationState = "validated" | "provisional" | "weak" | "rejected" | "unknown";
type ConfidenceBand = "strong" | "moderate" | "low" | "unknown";

interface Degraded {
  flag: true;
  reason: string;
  source: string;
  signalOrigin: SignalOrigin;
}

interface AudienceLayer {
  status: string | null;
  defensiveMode: boolean;
  confidenceScore: number | null;
  topPains: string[];
  topDesires: string[];
  topObjections: string[];
  inferredCount: number;
  signalOrigin: SignalOrigin;
  degraded: Degraded | null;
}

interface PositioningLayer {
  snapshotStatus: string | null;
  driftDetected: boolean;
  confidenceScore: number | null;
  territoryCount: number;
  primaryTerritory: string | null;
  differentiationStatement: string | null;
  signalOrigin: SignalOrigin;
  degraded: Degraded | null;
}

interface CompetitiveLayer {
  status: string | null;
  marketDiagnosis: string | null;
  confidenceBand: ConfidenceBand;
  realCommentRatio: number | null;
  echoChamberRisk: number | null;
  sampleBiasFlag: boolean;
  signalOrigin: SignalOrigin;
  degraded: Degraded | null;
}

interface DiagnoseProjection {
  campaignId: string;
  generatedAt: string;
  validationState: ValidationState;
  planSource: string;
  fallbackPlanIsolated: boolean;
  contractIncompleteFields: string[];
  signalOrigin: { real: number; competitor: number; inferred: number; fallback: number; unknown: number };
  layers: { audience: AudienceLayer; positioning: PositioningLayer; competitive: CompetitiveLayer };
  narrative: { summary: string; blockers: string[]; nextLooks: string[] };
}

const VALIDATION_COLOR: Record<ValidationState, string> = {
  validated: "#34D399",
  provisional: "#FFB347",
  weak: "#FF8C42",
  rejected: "#FF6B6B",
  unknown: "#8A96A8",
};

const VALIDATION_LABEL: Record<ValidationState, string> = {
  validated: "Validated",
  provisional: "Provisional",
  weak: "Weak evidence",
  rejected: "Rejected",
  unknown: "Unknown",
};

export default function DiagnoseScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { selectedCampaignId } = useCampaign();
  const { enabled: isOperator } = useOperatorSurface();

  const { data, isLoading, isError, error, refetch } = useQuery<DiagnoseProjection>({
    queryKey: ["/api/diagnose/projection", selectedCampaignId],
    enabled: !!selectedCampaignId,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Diagnose</Text>
        <Pressable onPress={() => refetch()} hitSlop={12}>
          <Ionicons name="refresh" size={22} color={colors.text} />
        </Pressable>
      </View>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Audience, positioning, and competitive landscape — one connected story
      </Text>

      {!selectedCampaignId && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.textSecondary }}>Select a campaign to see your diagnosis.</Text>
        </View>
      )}

      {isLoading && <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>}

      {isError && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={{ color: colors.error }}>{(error as Error)?.message ?? "Failed to load diagnosis"}</Text>
        </View>
      )}

      {data && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          <View style={[styles.narrativeCard, { backgroundColor: VALIDATION_COLOR[data.validationState] + "1A", borderColor: VALIDATION_COLOR[data.validationState] }]}>
            <Text style={[styles.narrativeLabel, { color: VALIDATION_COLOR[data.validationState] }]}>
              {VALIDATION_LABEL[data.validationState]}
            </Text>
            <Text style={[styles.narrativeSummary, { color: colors.text }]}>{data.narrative.summary}</Text>
            {isOperator ? (
              <Text style={[styles.metaLine, { color: colors.textMuted }]}>
                {data.planSource === "unknown" ? "no plan yet" : `plan: ${data.planSource.replace(/_/g, " ")}`}
                {data.fallbackPlanIsolated ? " · fallback isolated" : ""}
                {" · "}
                {Math.round((data.signalOrigin.real + data.signalOrigin.competitor) * 100)}% trusted signal
              </Text>
            ) : null}
          </View>

          {data.narrative.blockers.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>What's blocking conversion</Text>
              {data.narrative.blockers.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="alert-circle" size={14} color={colors.warning} />
                  <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {data.narrative.nextLooks.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Where to look next</Text>
              {data.narrative.nextLooks.map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="arrow-forward-circle" size={14} color={colors.primary} />
                  <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          <LayerCard
            title="Audience"
            origin={data.layers.audience.signalOrigin}
            degraded={data.layers.audience.degraded}
            colors={colors}
            lines={[
              data.layers.audience.topPains.length > 0 ? `Top pain: ${data.layers.audience.topPains[0]}` : "No pain data",
              data.layers.audience.topDesires.length > 0 ? `Top desire: ${data.layers.audience.topDesires[0]}` : "No desire data",
              data.layers.audience.topObjections.length > 0 ? `Top objection: ${data.layers.audience.topObjections[0]}` : "No objection data",
              data.layers.audience.inferredCount > 0 ? `${data.layers.audience.inferredCount} inferred signals` : null,
              data.layers.audience.confidenceScore !== null ? `Confidence ${Math.round(data.layers.audience.confidenceScore * 100)}%` : null,
            ].filter((x): x is string => !!x)}
          />

          <LayerCard
            title="Positioning"
            origin={data.layers.positioning.signalOrigin}
            degraded={data.layers.positioning.degraded}
            colors={colors}
            lines={[
              data.layers.positioning.primaryTerritory ? `Territory: ${data.layers.positioning.primaryTerritory}` : "No primary territory",
              data.layers.positioning.differentiationStatement ? `Differentiation: ${data.layers.positioning.differentiationStatement}` : null,
              data.layers.positioning.territoryCount > 0 ? `${data.layers.positioning.territoryCount} territories mapped` : null,
              data.layers.positioning.driftDetected ? "Shift since last baseline check" : null,
              data.layers.positioning.confidenceScore !== null ? `Confidence ${Math.round(data.layers.positioning.confidenceScore * 100)}%` : null,
            ].filter((x): x is string => !!x)}
          />

          <LayerCard
            title="Competitive landscape"
            origin={data.layers.competitive.signalOrigin}
            degraded={data.layers.competitive.degraded}
            colors={colors}
            lines={[
              data.layers.competitive.marketDiagnosis ?? "No market diagnosis yet",
              `Evidence: ${data.layers.competitive.confidenceBand}`,
              data.layers.competitive.realCommentRatio !== null ? `Real-comment ratio ${(data.layers.competitive.realCommentRatio * 100).toFixed(0)}%` : null,
              data.layers.competitive.echoChamberRisk !== null ? `Echo chamber risk ${(data.layers.competitive.echoChamberRisk * 100).toFixed(0)}%` : null,
              data.layers.competitive.sampleBiasFlag ? "Sample bias flagged" : null,
            ].filter((x): x is string => !!x)}
          />

          {data.contractIncompleteFields.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>What's missing</Text>
              {data.contractIncompleteFields.map(f => (
                <Text key={f} style={[styles.missing, { color: colors.warning }]}>· {f}</Text>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

interface LayerColors {
  text: string;
  textSecondary: string;
  textMuted: string;
  card: string;
  cardBorder: string;
  warning: string;
}

function LayerCard({ title, origin, degraded, colors, lines }: {
  title: string;
  origin: SignalOrigin;
  degraded: Degraded | null;
  colors: LayerColors;
  lines: string[];
}) {
  const { enabled: isOperator } = useOperatorSurface();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Text style={[styles.cardTitle, { color: colors.text }]}>{title}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={[styles.layerLine, { color: colors.textSecondary }]}>{line}</Text>
      ))}
      {isOperator ? (
        <>
          <Text style={[styles.originLine, { color: colors.textMuted }]}>
            origin: {origin}{degraded ? ` · degraded (${degraded.source})` : ""}
          </Text>
          {degraded && (
            <Text style={[styles.degradedReason, { color: colors.warning }]}>{degraded.reason}</Text>
          )}
        </>
      ) : degraded ? (
        <Text style={[styles.degradedReason, { color: colors.warning }]}>Still gathering more evidence here.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  narrativeCard: { padding: 18, borderRadius: 16, borderWidth: 1, marginBottom: 14 },
  narrativeLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  narrativeSummary: { fontSize: 15, marginTop: 8, lineHeight: 21 },
  metaLine: { fontSize: 11, marginTop: 10 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 8 },
  bulletText: { flex: 1, fontSize: 13, marginLeft: 8, lineHeight: 18 },
  layerLine: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  originLine: { fontSize: 11, marginTop: 8 },
  degradedReason: { fontSize: 11, marginTop: 4 },
  missing: { fontSize: 12, marginTop: 4 },
  center: { padding: 40, alignItems: "center" },
});
