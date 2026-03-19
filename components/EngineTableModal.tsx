import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  useColorScheme,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { getApiUrl } from "@/lib/query-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const P = {
  purple: "#7C3AED",
  green: "#10B981",
  red: "#EF4444",
  orange: "#F59E0B",
  blue: "#3B82F6",
  darkBg: "#0F1117",
  darkCard: "#1A2030",
  darkBorder: "#252D3D",
  darkText: "#E2E8F0",
  darkSec: "#8892A4",
  lightBg: "#F4F6FA",
  lightCard: "#FFFFFF",
  lightBorder: "#E2E8F0",
  lightText: "#1A202C",
  lightSec: "#64748B",
} as const;

type EngineRow = {
  num: string;
  engine: string;
  status: string;
  keyOutput: string;
  score: string;
  notes: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  campaignId: string;
};

function statusColor(s: string): string {
  if (!s || s === "—") return P.blue;
  const u = s.toUpperCase();
  if (u === "COMPLETE" || u === "COMPLETE_STABLE" || u === "FUNNEL_RECONSTRUCTED") return P.green;
  if (u.includes("FAIL") || u.includes("ERROR")) return P.red;
  if (u.includes("PARTIAL") || u.includes("PROVISIONAL") || u.includes("WARN")) return P.orange;
  return P.blue;
}

function statusLabel(s: string): string {
  if (!s || s === "—") return "—";
  const u = s.toUpperCase();
  if (u === "COMPLETE" || u === "COMPLETE_STABLE") return "Complete";
  if (u === "FUNNEL_RECONSTRUCTED") return "Reconstructed";
  return s.length > 18 ? s.slice(0, 16) + "…" : s;
}

export default function EngineTableModal({ visible, onClose, campaignId }: Props) {
  const isDark = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();

  const bg = isDark ? P.darkBg : P.lightBg;
  const card = isDark ? P.darkCard : P.lightCard;
  const border = isDark ? P.darkBorder : P.lightBorder;
  const textPrimary = isDark ? P.darkText : P.lightText;
  const textSec = isDark ? P.darkSec : P.lightSec;

  const [rows, setRows] = useState<EngineRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchTable = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`/api/engines/table-summary`, getApiUrl());
      url.searchParams.set("campaignId", campaignId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  const handleShow = useCallback(() => {
    setRows([]);
    setExpanded(null);
    setCopied(false);
    fetchTable();
  }, [fetchTable]);

  const buildPlainText = useCallback(() => {
    const lines: string[] = [];
    const sep = "─".repeat(120);
    lines.push("MarketMind AI — 15-Engine Strategic Analysis");
    lines.push(sep);
    const header = pad("#", 4) + pad("Engine", 26) + pad("Status", 20) + pad("Score", 8) + "Key Output";
    lines.push(header);
    lines.push(sep);
    for (const r of rows) {
      const mainLine = pad(r.num, 4) + pad(r.engine, 26) + pad(statusLabel(r.status), 20) + pad(r.score, 8) + r.keyOutput;
      lines.push(mainLine);
      if (r.notes && r.notes.trim()) {
        lines.push(pad("", 60) + "Note: " + r.notes.slice(0, 120));
      }
    }
    lines.push(sep);
    return lines.join("\n");
  }, [rows]);

  function pad(s: string, n: number): string {
    return (s + " ".repeat(n)).slice(0, n);
  }

  const handleCopy = useCallback(async () => {
    const txt = buildPlainText();
    await Clipboard.setStringAsync(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [buildPlainText]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onShow={handleShow}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={[s.root, { backgroundColor: bg, paddingTop: topPad }]}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: border }]}>
          <View>
            <Text style={[s.title, { color: textPrimary }]}>Engine Analysis Table</Text>
            <Text style={[s.subtitle, { color: textSec }]}>15 engines · tap a row to expand</Text>
          </View>
          <View style={s.headerActions}>
            <Pressable
              onPress={handleCopy}
              style={[s.copyBtn, { backgroundColor: copied ? P.green : P.purple }]}
            >
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={14}
                color="#fff"
              />
              <Text style={s.copyBtnText}>{copied ? "Copied!" : "Copy Table"}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={[s.closeBtn, { backgroundColor: isDark ? "#252D3D" : "#F0F0F5" }]}>
              <Ionicons name="close" size={18} color={textSec} />
            </Pressable>
          </View>
        </View>

        {/* Body */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={P.purple} size="large" />
            <Text style={[s.loadingText, { color: textSec }]}>Loading all 15 engines…</Text>
          </View>
        ) : error ? (
          <View style={s.center}>
            <Ionicons name="alert-circle-outline" size={32} color={P.red} />
            <Text style={[s.errorText, { color: P.red }]}>{error}</Text>
            <Pressable onPress={fetchTable} style={[s.retryBtn, { backgroundColor: P.purple }]}>
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={s.scroll}
            contentContainerStyle={{ paddingBottom: botPad + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Column header */}
            <View style={[s.colHeader, { backgroundColor: isDark ? "#131825" : "#EEF2FA", borderBottomColor: border }]}>
              <Text style={[s.colHeaderNum, { color: textSec }]}>#</Text>
              <Text style={[s.colHeaderEngine, { color: textSec }]}>Engine</Text>
              <Text style={[s.colHeaderStatus, { color: textSec }]}>Status</Text>
              <Text style={[s.colHeaderScore, { color: textSec }]}>Score</Text>
            </View>

            {rows.map((row) => {
              const isExpanded = expanded === row.num;
              const c = statusColor(row.status);
              return (
                <Pressable
                  key={row.num}
                  onPress={() => setExpanded(isExpanded ? null : row.num)}
                  style={[
                    s.row,
                    {
                      backgroundColor: isExpanded ? (isDark ? "#1E2840" : "#F0F4FF") : card,
                      borderBottomColor: border,
                    },
                  ]}
                >
                  {/* Collapsed row */}
                  <View style={s.rowMain}>
                    <Text style={[s.rowNum, { color: textSec }]}>{row.num}</Text>
                    <View style={s.rowNameWrap}>
                      <Text style={[s.rowName, { color: textPrimary }]} numberOfLines={1}>
                        {row.engine}
                      </Text>
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: c + "20" }]}>
                      <Text style={[s.statusText, { color: c }]} numberOfLines={1}>
                        {statusLabel(row.status)}
                      </Text>
                    </View>
                    <Text style={[s.rowScore, { color: c }]}>{row.score}</Text>
                    <Ionicons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={textSec}
                      style={{ marginLeft: 4 }}
                    />
                  </View>

                  {/* Expanded content */}
                  {isExpanded && (
                    <View style={[s.expanded, { borderTopColor: border }]}>
                      <Text style={[s.expandedLabel, { color: textSec }]}>KEY OUTPUT</Text>
                      <Text style={[s.expandedOutput, { color: textPrimary }]}>{row.keyOutput}</Text>
                      {!!row.notes && row.notes !== "null" && row.notes !== "—" && (
                        <>
                          <Text style={[s.expandedLabel, { color: textSec, marginTop: 10 }]}>NOTES</Text>
                          <Text style={[s.expandedNotes, { color: textSec }]}>{row.notes}</Text>
                        </>
                      )}
                    </View>
                  )}
                </Pressable>
              );
            })}

            {rows.length === 0 && !loading && (
              <View style={s.center}>
                <Ionicons name="bar-chart-outline" size={36} color={textSec} />
                <Text style={[s.emptyText, { color: textSec }]}>No engine data found. Run the pipeline first.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  copyBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flex: 1 },
  colHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  colHeaderNum: { width: 32, fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
  colHeaderEngine: { flex: 1, fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
  colHeaderStatus: { width: 110, fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
  colHeaderScore: { width: 52, fontSize: 10, fontWeight: "600", letterSpacing: 0.5, textAlign: "right" },
  row: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  rowNum: { width: 32, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  rowNameWrap: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: "600" },
  statusBadge: {
    width: 110,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: { fontSize: 11, fontWeight: "600" },
  rowScore: { width: 52, fontSize: 12, fontWeight: "700", textAlign: "right", fontVariant: ["tabular-nums"] },
  expanded: {
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  expandedLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 5,
  },
  expandedOutput: {
    fontSize: 13,
    lineHeight: 20,
  },
  expandedNotes: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: "italic",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 14,
  },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText: { fontSize: 14, textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#fff", fontWeight: "600" },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
