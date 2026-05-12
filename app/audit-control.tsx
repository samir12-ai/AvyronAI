import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRunTruthfulness, type StructuralCheckLite, type TruthfulnessHeadline } from "@/hooks/useRunTruthfulness";
import { useCampaign } from "@/context/CampaignContext";
import { colorForIntegrityVerdict } from "@/lib/verdict-colors";

// Per-check status colors (NOT verdict colors). These are operational check
// states (PASS/FAIL/STALE/TIMEOUT/etc.) emitted by useRunTruthfulness — they
// are already canonical at the hook boundary and do not have a "legacy"
// fallback to coerce. Verdict-shaped fields (verdict.verdict, headline) go
// through `colorForIntegrityVerdict` instead.
const STATUS_COLORS: Record<string, string> = {
  PASS: "#85BB65",
  FAIL: "#FF6B6B",
  BLOCK: "#FF6B6B",
  STALE: "#FFB347",
  TIMEOUT: "#FFB347",
  NOT_REACHED: "#FFB347",
  UNKNOWN: "#8892A4",
  SKIPPED: "#8892A4",
};

const HEADLINE_LABEL: Record<TruthfulnessHeadline, string> = {
  no_run: "No completed run",
  shadowed: "Newer run failed — older shown",
  system_untrusted: "Verdict unverified",
  needs_reconciliation: "Cross-engine contradiction",
  review_required: "Human review required",
  blocked: "Execution blocked",
  downgrade: "Execution downgraded",
  repair: "Auto-repair active",
  ok: "Verdict trusted",
};

function Section({ title, children, isDark }: { title: string; children: React.ReactNode; isDark: boolean }) {
  return (
    <View style={[styles.section, { backgroundColor: isDark ? "#0F1419" : "#FFFFFF", borderColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
      <Text style={[styles.sectionTitle, { color: isDark ? "#E8EDF2" : "#1A2332" }]}>{title}</Text>
      {children}
    </View>
  );
}

function KV({ label, value, isDark, valueColor }: { label: string; value: string; isDark: boolean; valueColor?: string }) {
  return (
    <View style={styles.kvRow}>
      <Text style={[styles.kvLabel, { color: isDark ? "#8892A4" : "#546478" }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: valueColor || (isDark ? "#E8EDF2" : "#1A2332") }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "#8892A4";
  return (
    <View style={[styles.pill, { backgroundColor: color + "22", borderColor: color + "60" }]}>
      <Text style={[styles.pillText, { color }]}>{status}</Text>
    </View>
  );
}

function CheckRow({ check, isDark }: { check: StructuralCheckLite; isDark: boolean }) {
  return (
    <View style={[styles.checkRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={[styles.checkName, { color: isDark ? "#E8EDF2" : "#1A2332" }]}>{check.check}</Text>
        {check.details ? (
          <Text style={[styles.checkDetails, { color: isDark ? "#8892A4" : "#546478" }]} numberOfLines={3}>
            {check.details}
          </Text>
        ) : null}
      </View>
      <StatusPill status={check.status} />
    </View>
  );
}

export default function AuditControlScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ campaignId?: string }>();
  const { selectedCampaignId } = useCampaign();
  const campaignId = params.campaignId || selectedCampaignId || null;

  const { data, isLoading, error, refetch, isFetching } = useRunTruthfulness(campaignId);

  const bg = isDark ? "#080C10" : "#F4F7F5";
  const textPrimary = isDark ? "#E8EDF2" : "#1A2332";
  const textSec = isDark ? "#8892A4" : "#546478";

  // Seal #6: derive the headline color from the canonical integrity verdict
  // (`data.verdict.verdict`) when present, mapping the headline to a verdict
  // shape only as a fall-through. This keeps the audit screen consistent
  // with every other verdict-rendering surface and prevents a green pixel
  // for any non-PASS verdict.
  const headlineToVerdict: Record<string, 'PASS' | 'PARTIAL' | 'FAIL'> = {
    ok: 'PASS',
    shadowed: 'PARTIAL',
    downgrade: 'PARTIAL',
    review_required: 'PARTIAL',
    no_run: 'PARTIAL',
    needs_reconciliation: 'PARTIAL',
    repair: 'PARTIAL',
    system_untrusted: 'FAIL',
    blocked: 'FAIL',
  };
  // Map the system-control verdict enum (PASS|DOWNGRADE|REPAIR|BLOCK) to the
  // canonical IntegrityVerdict enum (PASS|PARTIAL|FAIL). Typed: `data` is
  // `RunTruthfulness | undefined` so no `as any` cast is needed (Seal #6 / D3).
  const verdictRaw = data?.verdict?.verdict ?? null;
  const canonicalVerdict: 'PASS' | 'PARTIAL' | 'FAIL' | null =
    verdictRaw === 'PASS' ? 'PASS'
    : verdictRaw === 'BLOCK' ? 'FAIL'
    : verdictRaw === 'DOWNGRADE' || verdictRaw === 'REPAIR' ? 'PARTIAL'
    : null;
  const legacyVerdict = data?.headline ? headlineToVerdict[data.headline] ?? null : null;
  const headlineColor = colorForIntegrityVerdict(canonicalVerdict, legacyVerdict);

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: bg, borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="audit-back">
          <Ionicons name="chevron-back" size={24} color={textPrimary} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.headerTitle, { color: textPrimary }]}>Audit & Control</Text>
          <Text style={[styles.headerSub, { color: textSec }]} numberOfLines={1}>
            {campaignId ? `Campaign ${campaignId.slice(0, 8)}` : "No campaign selected"}
          </Text>
        </View>
        <Pressable onPress={() => refetch()} hitSlop={12} testID="audit-refresh">
          <Ionicons name={isFetching ? "sync-circle" : "refresh"} size={22} color={textPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        {!campaignId && (
          <View style={[styles.section, { backgroundColor: isDark ? "#0F1419" : "#FFFFFF", borderColor: isDark ? "#1A2030" : "#E2E8E4", alignItems: "center" }]}>
            <Ionicons name="layers-outline" size={28} color={textSec} style={{ marginBottom: 8 }} />
            <Text style={[styles.sectionTitle, { color: textPrimary, marginBottom: 6 }]}>No campaign selected</Text>
            <Text style={[styles.detailsText, { color: textSec, textAlign: "center", marginBottom: 12 }]}>
              Pick a campaign from the dashboard to view its truthfulness verdict.
            </Text>
            <Pressable
              onPress={() => router.replace("/(tabs)")}
              style={{ backgroundColor: "#7C3AED", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 }}
              testID="audit-go-dashboard"
            >
              <Text style={{ color: "#FFFFFF", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Go to dashboard</Text>
            </Pressable>
          </View>
        )}
        {campaignId && isLoading && <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />}
        {campaignId && error && (
          <Text style={[styles.errorText, { color: "#FF6B6B" }]}>
            Failed to load truthfulness: {(error as Error).message}
          </Text>
        )}

        {campaignId && data && (
          <>
            {/* Headline */}
            <View style={[styles.headlineCard, { backgroundColor: isDark ? "#0F1419" : "#FFFFFF", borderColor: isDark ? "#1A2030" : "#E2E8E4", borderLeftColor: headlineColor }]}>
              <Text style={[styles.headlineLabel, { color: textSec }]}>Run state</Text>
              <Text style={[styles.headlineValue, { color: headlineColor }]}>{HEADLINE_LABEL[data.headline]}</Text>
              {data.verdict && (
                <Text style={[styles.headlineMeta, { color: textSec }]}>
                  Verdict: {data.verdict.verdict} · {data.verdict.executionMode} · {data.verdict.checksPassed}/{data.verdict.checksTotal} checks pass
                </Text>
              )}
            </View>

            {/* Run resolution */}
            <Section title="Run resolution" isDark={isDark}>
              <KV label="Run ID" value={data.runId || "—"} isDark={isDark} />
              <KV label="Status" value={data.runStatus || "—"} isDark={isDark} />
              <KV label="Completed" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : "—"} isDark={isDark} />
              <KV
                label="Is latest"
                value={data.isLatest ? "yes" : "no"}
                isDark={isDark}
                valueColor={data.isLatest ? "#85BB65" : "#FFB347"}
              />
              <KV
                label="Stale (shadowed)"
                value={data.isStale ? "yes" : "no"}
                isDark={isDark}
                valueColor={data.isStale ? "#FF6B6B" : "#85BB65"}
              />
              {data.newerNonResolvableRun && (
                <View style={[styles.shadowBox, { backgroundColor: "#FF6B6B15", borderColor: "#FF6B6B40" }]}>
                  <Text style={[styles.shadowBoxTitle, { color: "#FF6B6B" }]}>Newer run shadowing</Text>
                  <Text style={[styles.shadowBoxBody, { color: textPrimary }]}>
                    {data.newerNonResolvableRun.runId.slice(0, 12)}… · {data.newerNonResolvableRun.status}
                    {data.newerNonResolvableRun.createdAt ? ` · ${new Date(data.newerNonResolvableRun.createdAt).toLocaleString()}` : ""}
                  </Text>
                </View>
              )}
            </Section>

            {/* Snapshot freshness */}
            <Section title="Snapshot freshness" isDark={isDark}>
              <KV
                label="Has stale snapshots"
                value={data.freshness.hasStaleSnapshots ? "yes" : "no"}
                isDark={isDark}
                valueColor={data.freshness.hasStaleSnapshots ? "#FF6B6B" : "#85BB65"}
              />
              {data.freshness.staleEngines.length > 0 && (
                <KV label="Stale engines" value={data.freshness.staleEngines.join(", ")} isDark={isDark} valueColor="#FFB347" />
              )}
              {data.freshness.details && (
                <Text style={[styles.detailsText, { color: textSec }]}>{data.freshness.details}</Text>
              )}
            </Section>

            {/* Block reasons */}
            {data.verdict && data.verdict.blockReasons.length > 0 && (
              <Section title={`Blocks (${data.verdict.blockReasons.length})`} isDark={isDark}>
                {data.verdict.blockReasons.map((b, i) => (
                  <View key={i} style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
                    <View style={styles.blockHead}>
                      <Text style={[styles.blockCode, { color: "#FF6B6B" }]}>{b.code}</Text>
                      <Text style={[styles.blockSev, { color: textSec }]}>{b.severity} · {b.source}</Text>
                    </View>
                    <Text style={[styles.blockDesc, { color: textPrimary }]}>{b.description}</Text>
                  </View>
                ))}
              </Section>
            )}

            {/* Contradictions */}
            {data.verdict && data.verdict.contradictions.length > 0 && (
              <Section title={`Contradictions (${data.verdict.contradictions.length})`} isDark={isDark}>
                {data.verdict.contradictions.map((c: any, i: number) => (
                  <View key={i} style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
                    <Text style={[styles.blockCode, { color: "#FFB347" }]}>{c.code || c.type || "CONTRADICTION"}</Text>
                    <Text style={[styles.blockDesc, { color: textPrimary }]} numberOfLines={4}>
                      {c.description || c.details || JSON.stringify(c)}
                    </Text>
                  </View>
                ))}
              </Section>
            )}

            {/* Structural checks */}
            {data.verdict && data.verdict.structuralChecks.length > 0 && (
              <Section title={`Structural checks (${data.verdict.checksPassed}/${data.verdict.checksTotal})`} isDark={isDark}>
                {data.verdict.structuralChecks.map((c, i) => (
                  <CheckRow key={i} check={c} isDark={isDark} />
                ))}
              </Section>
            )}

            {!data.verdict && data.headline !== "no_run" && (
              <Text style={[styles.emptyText, { color: textSec }]}>No verdict stored yet for this campaign.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  headlineCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: 12,
  },
  headlineLabel: { fontSize: 11, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  headlineValue: { fontSize: 20, fontFamily: "Inter_700Bold", marginTop: 4 },
  headlineMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6 },
  section: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  kvLabel: { fontSize: 12, fontFamily: "Inter_400Regular", flexShrink: 0 },
  kvValue: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "right", flex: 1 },
  shadowBox: { padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 10 },
  shadowBoxTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  shadowBoxBody: { fontSize: 11, fontFamily: "Inter_500Medium" },
  detailsText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 16 },
  blockRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  blockHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  blockCode: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  blockSev: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  blockDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  checkDetails: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  pillText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  errorText: { fontSize: 13, marginTop: 24, textAlign: "center" },
  emptyText: { fontSize: 12, marginTop: 16, textAlign: "center" },
});
