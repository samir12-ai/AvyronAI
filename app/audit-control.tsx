import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRunTruthfulness, type StructuralCheckLite, type TruthfulnessHeadline } from "@/hooks/useRunTruthfulness";
import { useCampaign } from "@/context/CampaignContext";
import { colorForIntegrityVerdict } from "@/lib/verdict-colors";
import {
  useContinuityPanel,
  useCampaignContinuityDecision,
  continuityPanelEnabled,
  DECISION_LABELS,
  DECISION_COLORS,
  type ContinuityDecision,
} from "@/hooks/useContinuityPanel";
import {
  useOperationsPanel,
  operationsPanelEnabled,
  type OperationsPanelData,
  type InFlightStats,
  type ContinuityTickStats,
} from "@/hooks/useOperationsPanel";
import {
  useOperatorNotices,
  operatorNoticesEnabled,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  CATEGORY_LABELS,
  type OperatorNotice,
} from "@/hooks/useOperatorNotices";

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

  // Seal #17 / Track #4 — operator-visible continuity surface. Hooks
  // self-disable when EXPO_PUBLIC_METRICS_ADMIN_TOKEN is unset (customer
  // builds), so the panel is invisible in non-operator builds.
  const continuity = useContinuityPanel();
  const campaignDecision = useCampaignContinuityDecision(campaignId);
  const continuityEnabled = continuityPanelEnabled();
  const operations = useOperationsPanel();
  const operatorNotices = useOperatorNotices();
  const operationsEnabled = operationsPanelEnabled();

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

        {/* Seal #17 / Track #4 — Continuity (6th panel). Visible only when
            EXPO_PUBLIC_METRICS_ADMIN_TOKEN is set (operator builds). */}
        {continuityEnabled && (
          <ContinuityPanel
            isDark={isDark}
            campaignId={campaignId}
            panel={continuity.data ?? null}
            panelLoading={continuity.isLoading}
            panelError={continuity.error ? (continuity.error as Error).message : null}
            campaignDecision={campaignDecision.data?.decision ?? null}
            textPrimary={textPrimary}
            textSec={textSec}
          />
        )}

        {/* Operations Guardian — operator notices (interpreted layer).
            Sits between Continuity and Operations: above the raw
            internal-truth Operations panel, below the chain-state
            Continuity panel. Observe-only phase: audience='operator'
            only, no user-facing surfaces, no auto-recovery. Same admin-
            token gate as the other operator panels. */}
        {operatorNoticesEnabled() && (
          <OperatorNoticesPanel
            isDark={isDark}
            notices={operatorNotices.data ?? null}
            isLoading={operatorNotices.isLoading}
            error={operatorNotices.error ? (operatorNotices.error as Error).message : null}
            textPrimary={textPrimary}
            textSec={textSec}
          />
        )}

        {/* Task #52 / Priority #1 — Operations (7th panel). Same admin-
            token gate as the Continuity panel. */}
        {operationsEnabled && (
          <OperationsPanel
            isDark={isDark}
            panel={operations.data ?? null}
            panelLoading={operations.isLoading}
            panelError={operations.error ? (operations.error as Error).message : null}
            textPrimary={textPrimary}
            textSec={textSec}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Seal #17 / Track #4 — Continuity panel (6th panel) ─────────────────
//
// Renders three operator-facing blocks:
//   1. Last tick header — when did the scheduler last fire, how long it took.
//   2. Selected-campaign skip-reason badge — the latest decision for the
//      currently-viewed campaign, using the strict PerCampaignDecision.decision
//      union from useContinuityPanel (no string fallback).
//   3. Window-gap rows + 24h skip-reason histogram + last 10 re-anchors.
//
function ContinuityPanel({
  isDark,
  campaignId,
  panel,
  panelLoading,
  panelError,
  campaignDecision,
  textPrimary,
  textSec,
}: {
  isDark: boolean;
  campaignId: string | null;
  panel: import("@/hooks/useContinuityPanel").ContinuityPanelData | null;
  panelLoading: boolean;
  panelError: string | null;
  campaignDecision: import("@/hooks/useContinuityPanel").CampaignContinuityDecision | null;
  textPrimary: string;
  textSec: string;
}) {
  return (
    <Section title="Continuity" isDark={isDark}>
      {panelLoading && !panel && (
        <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />
      )}
      {panelError && (
        <Text style={[styles.errorText, { color: "#FF6B6B", marginTop: 0 }]}>
          Continuity panel: {panelError}
        </Text>
      )}

      {panel && (
        <>
          {/* Last tick */}
          {panel.lastTick ? (
            <>
              <KV
                label="Last tick"
                value={new Date(panel.lastTick.tickAt).toLocaleString()}
                isDark={isDark}
              />
              <KV
                label="Duration"
                value={`${panel.lastTick.durationMs} ms`}
                isDark={isDark}
              />
              <KV
                label="Scanned / invoked / failed"
                value={`${panel.lastTick.campaignsScanned} / ${panel.lastTick.runsInvoked} / ${panel.lastTick.runsFailed}`}
                isDark={isDark}
                valueColor={panel.lastTick.runsFailed > 0 ? "#FF6B6B" : undefined}
              />
              <KV
                label="Re-anchors / missed / dead"
                value={`${panel.lastTick.reanchorsWritten} / ${panel.lastTick.missedWindowsDetected} / ${panel.lastTick.deadCyclesDetected}`}
                isDark={isDark}
                valueColor={panel.lastTick.deadCyclesDetected > 0 ? "#FF6B6B" : undefined}
              />
            </>
          ) : (
            <Text style={[styles.emptyText, { color: textSec, marginTop: 0 }]}>
              No tick recorded yet (scheduler may be cold-starting).
            </Text>
          )}

          {/* Selected-campaign decision badge */}
          {campaignId && (
            <View style={[styles.shadowBox, { backgroundColor: isDark ? "#0B0F14" : "#F4F7F5", borderColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
              <Text style={[styles.shadowBoxTitle, { color: textSec }]}>This campaign — last decision</Text>
              {campaignDecision ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, flexWrap: "wrap", gap: 8 }}>
                  <ContinuityDecisionBadge decision={campaignDecision.decision} />
                  <Text style={[styles.blockDesc, { color: textPrimary, flex: 1, minWidth: 120 }]} numberOfLines={3}>
                    {campaignDecision.reason ?? DECISION_LABELS[campaignDecision.decision]}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.blockDesc, { color: textSec, marginTop: 6 }]}>
                  No decision recorded for this campaign in the latest tick.
                </Text>
              )}
            </View>
          )}

          {/* 24h skip-reason histogram */}
          <Text style={[styles.sectionTitle, { color: textPrimary, marginTop: 14, marginBottom: 6, fontSize: 11 }]}>
            Last 24h decisions
          </Text>
          {Object.entries(panel.skipReasonHistogram24h)
            .filter(([, count]) => count > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([key, count]) => {
              const isKnown = (Object.keys(DECISION_LABELS) as ContinuityDecision[]).includes(key as ContinuityDecision);
              const label = isKnown ? DECISION_LABELS[key as ContinuityDecision] : `Unknown (${key})`;
              const color = isKnown ? DECISION_COLORS[key as ContinuityDecision] : "#FFB347";
              return (
                <View key={key} style={styles.kvRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                    <Text style={[styles.kvLabel, { color: isDark ? "#E8EDF2" : "#1A2332" }]}>{label}</Text>
                  </View>
                  <Text style={[styles.kvValue, { color: textPrimary }]}>{count}</Text>
                </View>
              );
            })}
          {Object.values(panel.skipReasonHistogram24h).every((c) => c === 0) && (
            <Text style={[styles.emptyText, { color: textSec, marginTop: 4 }]}>No decisions recorded in the last 24h.</Text>
          )}

          {/* Window gaps */}
          {panel.perCampaignWindowGaps.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: textPrimary, marginTop: 14, marginBottom: 6, fontSize: 11 }]}>
                Campaigns with window-index gaps ({panel.perCampaignWindowGaps.length})
              </Text>
              {panel.perCampaignWindowGaps.slice(0, 8).map((g, i) => (
                <View key={`${g.campaignId}-${i}`} style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
                  <View style={styles.blockHead}>
                    <Text style={[styles.blockCode, { color: textPrimary }]}>{g.campaignId.slice(0, 12)}…</Text>
                    <ContinuityDecisionBadge decision={g.decision} />
                  </View>
                  <Text style={[styles.blockDesc, { color: textSec }]} numberOfLines={3}>
                    {g.reason ?? DECISION_LABELS[g.decision]}
                    {typeof g.observedWindowIndex === "number" && typeof g.expectedWindowIndex === "number"
                      ? ` · window ${g.observedWindowIndex}/${g.expectedWindowIndex} (gap ${g.missedWindows})`
                      : ""}
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* Recent re-anchors */}
          {panel.recentReanchors.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: textPrimary, marginTop: 14, marginBottom: 6, fontSize: 11 }]}>
                Recent re-anchors ({panel.recentReanchors.length})
              </Text>
              {panel.recentReanchors.map((r) => (
                <View key={r.id} style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}>
                  <View style={styles.blockHead}>
                    <Text style={[styles.blockCode, { color: textPrimary }]}>{r.campaignId.slice(0, 12)}…</Text>
                    <Text style={[styles.blockSev, { color: textSec }]}>{new Date(r.reanchoredAt).toLocaleString()}</Text>
                  </View>
                  <Text style={[styles.blockDesc, { color: textSec }]} numberOfLines={2}>
                    {r.reason} · {r.source}
                  </Text>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </Section>
  );
}

// ─── Task #52 / Priority #1 — Operations panel ──────────────────────────
//
// Renders four operator-facing blocks:
//   1. In-flight Maps (boss locks / continuity tick / MIv3 active jobs)
//      — Seal #16 zombie-watchdog visibility.
//   2. Retry-loop campaigns — campaigns with ≥3 `failed` decisions in 24h.
//   3. Stuck claims — continuity_window_claims rows older than 2h.
//
// Strict-typed at the prop boundary (D2/D3): no string fallback, no
// optional unions.
function OperationsPanel({
  isDark,
  panel,
  panelLoading,
  panelError,
  textPrimary,
  textSec,
}: {
  isDark: boolean;
  panel: OperationsPanelData | null;
  panelLoading: boolean;
  panelError: string | null;
  textPrimary: string;
  textSec: string;
}) {
  return (
    <Section title="Operations" isDark={isDark}>
      {panelLoading && !panel && (
        <ActivityIndicator color="#7C3AED" style={{ marginVertical: 14 }} />
      )}
      {panelError && (
        <Text style={[styles.errorText, { color: "#FF6B6B", marginTop: 0 }]}>
          Failed to load operations: {panelError}
        </Text>
      )}
      {panel && (
        <>
          {/* In-flight Maps */}
          <Text style={[styles.sectionTitle, { color: textPrimary, marginTop: 0, marginBottom: 6, fontSize: 11 }]}>
            In-flight (zombie watchdogs)
          </Text>
          <InFlightRow
            label="Boss locks"
            stats={panel.bossLocks}
            isDark={isDark}
            textSec={textSec}
          />
          <KV
            label="Continuity tick"
            value={
              panel.continuityTick.inFlight
                ? `running · ${formatAgeMs(panel.continuityTick.ageMs)}`
                : "idle"
            }
            isDark={isDark}
            valueColor={
              panel.continuityTick.zombieEvictions > 0 ||
              isAgeNearMax(panel.continuityTick.ageMs, panel.continuityTick.maxAgeMs)
                ? "#FF6B6B"
                : undefined
            }
          />
          {panel.continuityTick.zombieEvictions > 0 && (
            <KV
              label="↳ tick zombie evictions"
              value={String(panel.continuityTick.zombieEvictions)}
              isDark={isDark}
              valueColor="#FF6B6B"
            />
          )}
          <InFlightRow
            label="MIv3 active jobs"
            stats={panel.miActiveJobs}
            isDark={isDark}
            textSec={textSec}
          />

          {/* Retry-loop campaigns */}
          <Text
            style={[styles.sectionTitle, { color: textPrimary, marginTop: 14, marginBottom: 6, fontSize: 11 }]}
          >
            Retry loops 24h ({panel.retryLoopCampaigns.length})
          </Text>
          {panel.retryLoopCampaigns.length === 0 ? (
            <Text style={[styles.emptyText, { color: textSec, marginTop: 0 }]}>
              No campaigns in a retry loop.
            </Text>
          ) : (
            panel.retryLoopCampaigns.map((c) => (
              <View
                key={c.campaignId}
                style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}
              >
                <View style={styles.blockHead}>
                  <Text style={[styles.blockCode, { color: textPrimary }]}>
                    {c.campaignId.slice(0, 12)}…
                  </Text>
                  <Text style={[styles.blockSev, { color: "#FF6B6B" }]}>
                    {c.failedCount24h} failed
                  </Text>
                </View>
              </View>
            ))
          )}

          {/* Stuck claims */}
          <Text
            style={[styles.sectionTitle, { color: textPrimary, marginTop: 14, marginBottom: 6, fontSize: 11 }]}
          >
            Stuck claims &gt;2h ({panel.stuckClaims.length})
          </Text>
          {panel.stuckClaims.length === 0 ? (
            <Text style={[styles.emptyText, { color: textSec, marginTop: 0 }]}>
              No stuck claim rows.
            </Text>
          ) : (
            panel.stuckClaims.map((c) => (
              <View
                key={`${c.campaignId}:${c.planId}:${c.windowIndex}`}
                style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}
              >
                <View style={styles.blockHead}>
                  <Text style={[styles.blockCode, { color: textPrimary }]}>
                    {c.campaignId.slice(0, 12)}… · w{c.windowIndex}
                  </Text>
                  <Text style={[styles.blockSev, { color: "#FF6B6B" }]}>
                    {c.ageMinutes} min
                  </Text>
                </View>
                <Text style={[styles.blockDesc, { color: textSec }]} numberOfLines={1}>
                  claimed by {c.claimedBy.slice(0, 16)}…
                </Text>
              </View>
            ))
          )}

          <Text style={[styles.detailsText, { color: textSec, marginTop: 10 }]}>
            Generated {new Date(panel.generatedAt).toLocaleTimeString()}
          </Text>
        </>
      )}
    </Section>
  );
}

// ─── Operations Guardian — operator notices panel ───────────────────────
//
// Renders the interpreted notices written by the Guardian Interpreter
// (server/operations-guardian/interpreter.ts). One row per OPEN notice,
// severity-sorted by the server. Strict-typed at the prop boundary
// (D2/D3): unknown enum values were dropped at the hook layer.
//
// Observe-only phase notes:
//   * Only audience='operator' rows ever reach this panel.
//   * No dismiss / acknowledge actions yet — the panel is informational
//     until we have noise-floor data from production.
//   * Empty-state copy is intentional: "no notices" is the desired
//     steady state, not an error.
function OperatorNoticesPanel({
  isDark,
  notices,
  isLoading,
  error,
  textPrimary,
  textSec,
}: {
  isDark: boolean;
  notices: OperatorNotice[] | null;
  isLoading: boolean;
  error: string | null;
  textPrimary: string;
  textSec: string;
}) {
  const count = notices?.length ?? 0;
  return (
    <Section title={`Operator notices${count > 0 ? ` (${count})` : ""}`} isDark={isDark}>
      {isLoading && !notices && (
        <ActivityIndicator color="#7C3AED" style={{ marginVertical: 12 }} />
      )}
      {error && (
        <Text style={[styles.errorText, { color: "#FF6B6B", marginTop: 0 }]}>
          Failed to load notices: {error}
        </Text>
      )}
      {notices && notices.length === 0 && (
        <Text style={[styles.emptyText, { color: textSec, marginTop: 0 }]}>
          No open operator notices. Steady state.
        </Text>
      )}
      {notices && notices.length > 0 &&
        notices.map((n) => (
          <View
            key={n.id}
            style={[styles.blockRow, { borderBottomColor: isDark ? "#1A2030" : "#E2E8E4" }]}
          >
            <View style={styles.blockHead}>
              <Text style={[styles.blockCode, { color: textPrimary }]}>
                {CATEGORY_LABELS[n.category]}
              </Text>
              <Text style={[styles.blockSev, { color: SEVERITY_COLORS[n.severity] }]}>
                {SEVERITY_LABELS[n.severity]}
              </Text>
            </View>
            <Text style={[styles.blockDesc, { color: textSec }]} numberOfLines={2}>
              {summarizeNotice(n)}
            </Text>
            <Text style={[styles.detailsText, { color: textSec, marginTop: 2 }]}>
              seen {n.observationCount}× · last {formatRelativeTime(n.lastSeenAt)}
              {n.campaignId ? ` · campaign ${n.campaignId.slice(0, 10)}…` : ""}
            </Text>
          </View>
        ))}
      {notices && (
        <Text style={[styles.detailsText, { color: textSec, marginTop: 10 }]}>
          Guardian observe-only mode — no auto-recovery, no user surfaces.
        </Text>
      )}
    </Section>
  );
}

function summarizeNotice(n: OperatorNotice): string {
  const v = n.copyVars ?? {};
  switch (n.category) {
    case "WORKER_STUCK":
      return `Window w${v.windowIndex ?? "?"} stuck for ${v.ageMinutes ?? "?"} min`;
    case "RETRY_LOOP":
      return `${v.failedCount24h ?? "?"} failed runs in last 24h`;
    case "LEAKED_LOCK":
      return `${v.zombieEvictions ?? "?"} zombie evictions on ${v.source ?? "unknown source"}`;
    case "CHAIN_DEGRADED":
    case "CHAIN_DEAD":
      return `${v.chainId ?? "?"} · lag ${formatAgeMs(Number(v.lagMs) || 0)}`;
    case "SCHEDULER_HEARTBEAT_DEAD":
      return `Scheduler lag ${formatAgeMs(Number(v.lagMs) || 0)}`;
    default:
      return n.correlationKey;
  }
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`;
  return `${Math.round(diffMs / 86_400_000)}d ago`;
}

function InFlightRow({
  label,
  stats,
  isDark,
  textSec,
}: {
  label: string;
  stats: InFlightStats;
  isDark: boolean;
  textSec: string;
}) {
  const ageStr = stats.oldestAgeMs === null ? "—" : formatAgeMs(stats.oldestAgeMs);
  const ageWarn = isAgeNearMax(stats.oldestAgeMs, stats.maxAgeMs);
  return (
    <>
      <KV
        label={label}
        value={`size ${stats.size} · oldest ${ageStr}`}
        isDark={isDark}
        valueColor={ageWarn || stats.zombieEvictions > 0 ? "#FF6B6B" : undefined}
      />
      {stats.zombieEvictions > 0 && (
        <KV
          label={`↳ ${label} zombie evictions`}
          value={String(stats.zombieEvictions)}
          isDark={isDark}
          valueColor="#FF6B6B"
        />
      )}
    </>
  );
}

function formatAgeMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function isAgeNearMax(ageMs: number | null, maxAgeMs: number): boolean {
  if (ageMs === null) return false;
  return ageMs > maxAgeMs * 0.8;
}

function ContinuityDecisionBadge({ decision }: { decision: ContinuityDecision }) {
  const color = DECISION_COLORS[decision];
  const label = DECISION_LABELS[decision];
  return (
    <View style={[styles.pill, { backgroundColor: color + "22", borderColor: color + "60" }]}>
      <Text style={[styles.pillText, { color }]} testID={`continuity-decision-${decision}`}>{label}</Text>
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
