import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
import { useCampaign } from "@/context/CampaignContext";
import { BusinessProfileModal } from "@/components/BusinessProfile";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";

interface MetaStatus {
  metaMode: string;
  connectedPageName: string | null;
  igUsername: string | null;
  tokenExpiresAt: string | null;
  tokenExpiringSoon: boolean;
  tokenDaysRemaining: number | null;
  missingScopes: string[];
}

const META_MODE_COLORS: Record<string, string> = {
  DISCONNECTED: "#8A96A8",
  REAL: "#34D399",
  TOKEN_EXPIRED: "#FF6B6B",
  PERMISSION_MISSING: "#FFB347",
  REVOKED: "#FF6B6B",
  PENDING_APPROVAL: "#FBBF24",
};

const META_MODE_LABELS: Record<string, string> = {
  DISCONNECTED: "Not connected",
  REAL: "Connected",
  TOKEN_EXPIRED: "Token expired",
  PERMISSION_MISSING: "Missing permissions",
  REVOKED: "Access revoked",
  PENDING_APPROVAL: "Pending approval",
};

export default function ConnectScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { brandProfile } = useApp();
  const { selectedCampaignId } = useCampaign();

  // ----- Meta status / OAuth -----
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaActionLoading, setMetaActionLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetaStatus = useCallback(async () => {
    try {
      const apiUrl = getApiUrl();
      const url = new URL("/api/meta/status", apiUrl);
      const res = await authFetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (data.success && data.status) setMetaStatus(data.status);
    } catch (err) {
      console.error("Failed to fetch meta status:", err);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => { fetchMetaStatus(); }, [fetchMetaStatus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startOAuthPolling = useCallback(() => {
    stopPolling();
    let elapsed = 0;
    pollTimerRef.current = setInterval(async () => {
      elapsed += 3000;
      if (elapsed > 120000) { stopPolling(); return; }
      try {
        const apiUrl = getApiUrl();
        const url = new URL("/api/meta/status", apiUrl);
        const res = await authFetch(url.toString(), { credentials: "include" });
        const data = await res.json();
        if (data.success && data.status) {
          setMetaStatus(data.status);
          if (data.status.metaMode === "REAL") {
            stopPolling();
            setMetaActionLoading(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }
      } catch {
        // polling errors are silent — next tick retries
      }
    }, 3000);
  }, [stopPolling]);

  const handleConnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}api/meta/auth`;
      if (Platform.OS === "web") {
        window.open(authUrl, "_blank", "width=600,height=700");
      } else {
        await Linking.openURL(authUrl);
      }
      startOAuthPolling();
    } catch (err) {
      console.error("Meta connect error:", err);
      setMetaActionLoading(false);
      Alert.alert("Connection error", "Failed to open Meta authorization.");
    }
  }, [startOAuthPolling]);

  const handleDisconnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      await apiRequest("POST", "/api/meta/disconnect", {});
      await fetchMetaStatus();
    } catch (err) {
      console.error("Meta disconnect error:", err);
      Alert.alert("Error", "Failed to disconnect Meta.");
    } finally {
      setMetaActionLoading(false);
    }
  }, [fetchMetaStatus]);

  const handleReconnectMeta = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMetaActionLoading(true);
    try {
      await apiRequest("POST", "/api/meta/reconnect", {});
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}api/meta/auth`;
      if (Platform.OS === "web") window.open(authUrl, "_blank", "width=600,height=700");
      else await Linking.openURL(authUrl);
      startOAuthPolling();
    } catch (err) {
      console.error("Meta reconnect error:", err);
      setMetaActionLoading(false);
      Alert.alert("Error", "Failed to start reconnect.");
    }
  }, [startOAuthPolling]);

  // ----- Manual metrics -----
  const [manualSpend, setManualSpend] = useState("");
  const [manualRevenue, setManualRevenue] = useState("");
  const [manualLeads, setManualLeads] = useState("");
  const [manualConversions, setManualConversions] = useState("");
  const [manualImpressions, setManualImpressions] = useState("");
  const [manualClicks, setManualClicks] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDerived, setManualDerived] = useState({ cpa: 0, roas: 0 });

  const fetchManualMetrics = useCallback(async () => {
    if (!selectedCampaignId) return;
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/manual-metrics`, apiUrl);
      const res = await authFetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (data.success && data.metrics) {
        const m = data.metrics;
        setManualSpend(m.spend > 0 ? String(m.spend) : "");
        setManualRevenue(m.revenue > 0 ? String(m.revenue) : "");
        setManualLeads(m.leads > 0 ? String(m.leads) : "");
        setManualConversions(m.conversions > 0 ? String(m.conversions) : "");
        setManualImpressions(m.impressions > 0 ? String(m.impressions) : "");
        setManualClicks(m.clicks > 0 ? String(m.clicks) : "");
        setManualDerived({ cpa: m.cpa || 0, roas: m.roas || 0 });
      }
    } catch (err) {
      console.error("Failed to fetch manual metrics:", err);
    }
  }, [selectedCampaignId]);

  useEffect(() => { fetchManualMetrics(); }, [fetchManualMetrics]);

  useEffect(() => {
    const spend = parseFloat(manualSpend) || 0;
    const revenue = parseFloat(manualRevenue) || 0;
    const conv = parseInt(manualConversions) || 0;
    setManualDerived({
      cpa: conv > 0 ? +(spend / conv).toFixed(2) : 0,
      roas: spend > 0 ? +(revenue / spend).toFixed(2) : 0,
    });
  }, [manualSpend, manualRevenue, manualConversions]);

  const handleSaveManualMetrics = useCallback(async () => {
    if (!selectedCampaignId) {
      Alert.alert("No campaign", "Please select a campaign first.");
      return;
    }
    setManualSaving(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/campaigns/${selectedCampaignId}/manual-metrics`, apiUrl);
      const res = await authFetch(url.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          spend: parseFloat(manualSpend) || 0,
          revenue: parseFloat(manualRevenue) || 0,
          leads: parseInt(manualLeads) || 0,
          conversions: parseInt(manualConversions) || 0,
          impressions: parseInt(manualImpressions) || 0,
          clicks: parseInt(manualClicks) || 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Saved", "Campaign metrics updated.");
      } else {
        throw new Error(data.error || "Save failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save metrics";
      Alert.alert("Error", msg);
    } finally {
      setManualSaving(false);
    }
  }, [selectedCampaignId, manualSpend, manualRevenue, manualLeads, manualConversions, manualImpressions, manualClicks]);

  // ----- Brand profile modal -----
  const [showProfileModal, setShowProfileModal] = useState(false);

  const metaMode = metaStatus?.metaMode || "DISCONNECTED";
  const metaModeColor = META_MODE_COLORS[metaMode] || META_MODE_COLORS.DISCONNECTED;
  const metaModeLabel = META_MODE_LABELS[metaMode] || metaMode;
  const isMetaConnected = metaMode === "REAL";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === "web" ? 83 : insets.top + 16, paddingBottom: insets.bottom + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>Connect</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Hook up data sources so the engine speaks from real signal
        </Text>

        {/* META */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Meta (Facebook & Instagram)</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: metaModeColor }]} />
                <Text style={[styles.statusText, { color: metaModeColor }]}>{metaModeLabel}</Text>
              </View>
            </View>
            <Ionicons name="logo-facebook" size={26} color="#1877F2" />
          </View>

          {metaLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
          ) : (
            <>
              {isMetaConnected && (
                <View style={{ marginTop: 10 }}>
                  {metaStatus?.connectedPageName && (
                    <Text style={[styles.metaInfo, { color: colors.textSecondary }]}>Page: {metaStatus.connectedPageName}</Text>
                  )}
                  {metaStatus?.igUsername && (
                    <Text style={[styles.metaInfo, { color: colors.textSecondary }]}>Instagram: @{metaStatus.igUsername}</Text>
                  )}
                  {metaStatus?.tokenExpiringSoon && metaStatus.tokenDaysRemaining !== null && (
                    <Text style={[styles.metaInfo, { color: colors.warning }]}>
                      Token expires in {metaStatus.tokenDaysRemaining} day{metaStatus.tokenDaysRemaining === 1 ? "" : "s"}
                    </Text>
                  )}
                </View>
              )}

              {metaMode === "PERMISSION_MISSING" && (metaStatus?.missingScopes?.length || 0) > 0 && (
                <Text style={[styles.metaInfo, { color: colors.warning, marginTop: 8 }]}>
                  Missing: {metaStatus!.missingScopes.join(", ")}
                </Text>
              )}

              <View style={styles.metaActions}>
                {!isMetaConnected ? (
                  <Pressable
                    onPress={handleConnectMeta}
                    disabled={metaActionLoading}
                    style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: metaActionLoading ? 0.6 : 1 }]}
                  >
                    {metaActionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Connect Meta</Text>}
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={handleReconnectMeta}
                      disabled={metaActionLoading}
                      style={[styles.secondaryBtn, { borderColor: colors.cardBorder, opacity: metaActionLoading ? 0.6 : 1 }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Reconnect</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleDisconnectMeta}
                      disabled={metaActionLoading}
                      style={[styles.secondaryBtn, { borderColor: colors.error, opacity: metaActionLoading ? 0.6 : 1 }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.error }]}>Disconnect</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </>
          )}
        </View>

        {/* MANUAL METRICS */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Manual campaign metrics</Text>
              <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
                Used when Meta is not connected. CPA and ROAS are derived.
              </Text>
            </View>
            <Ionicons name="create-outline" size={24} color={colors.primary} />
          </View>

          {!selectedCampaignId && (
            <Text style={[styles.metaInfo, { color: colors.warning, marginTop: 10 }]}>
              Select a campaign to enter manual metrics.
            </Text>
          )}

          {selectedCampaignId && (
            <>
              <View style={styles.formGrid}>
                <ManualInput label="Spend" value={manualSpend} onChange={setManualSpend} colors={colors} keyboardType="decimal-pad" />
                <ManualInput label="Revenue" value={manualRevenue} onChange={setManualRevenue} colors={colors} keyboardType="decimal-pad" />
                <ManualInput label="Conversions" value={manualConversions} onChange={setManualConversions} colors={colors} keyboardType="number-pad" />
                <ManualInput label="Leads" value={manualLeads} onChange={setManualLeads} colors={colors} keyboardType="number-pad" />
                <ManualInput label="Impressions" value={manualImpressions} onChange={setManualImpressions} colors={colors} keyboardType="number-pad" />
                <ManualInput label="Clicks" value={manualClicks} onChange={setManualClicks} colors={colors} keyboardType="number-pad" />
              </View>

              <View style={styles.derivedRow}>
                <Text style={[styles.derivedText, { color: colors.textMuted }]}>
                  CPA: <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>${manualDerived.cpa.toFixed(2)}</Text>
                </Text>
                <Text style={[styles.derivedText, { color: colors.textMuted }]}>
                  ROAS: <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{manualDerived.roas.toFixed(2)}x</Text>
                </Text>
              </View>

              <Pressable
                onPress={handleSaveManualMetrics}
                disabled={manualSaving}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 12, opacity: manualSaving ? 0.6 : 1 }]}
              >
                {manualSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save metrics</Text>}
              </Pressable>
            </>
          )}
        </View>

        {/* BRAND PROFILE */}
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setShowProfileModal(true); }}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        >
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Brand profile</Text>
              <Text style={[styles.cardSub, { color: colors.textSecondary }]} numberOfLines={2}>
                {brandProfile.name || "Unnamed brand"} · {brandProfile.industry || "no industry"} · {brandProfile.tone || "no tone"}
              </Text>
            </View>
            <Ionicons name="color-palette-outline" size={24} color={colors.primary} />
          </View>
        </Pressable>

        {/* COMPETITORS — links to existing screen */}
        <Pressable
          onPress={() => { Haptics.selectionAsync(); router.push({ pathname: "/(tabs)/ai-management", params: { tab: "intelligence", ts: String(Date.now()) } } as never); }}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        >
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Competitors</Text>
              <Text style={[styles.cardSub, { color: colors.textSecondary }]}>Add competitor handles for intelligence tracking</Text>
            </View>
            <Ionicons name="people-outline" size={24} color={colors.primary} />
          </View>
        </Pressable>
      </ScrollView>

      <BusinessProfileModal
        visible={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onComplete={() => setShowProfileModal(false)}
      />
    </View>
  );
}

interface ManualInputColors {
  text: string;
  textSecondary: string;
  cardBorder: string;
  background: string;
}

function ManualInput({ label, value, onChange, colors, keyboardType }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ManualInputColors;
  keyboardType: "decimal-pad" | "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, { color: colors.text, borderColor: colors.cardBorder, backgroundColor: colors.background }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center" },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  metaInfo: { fontSize: 12, marginTop: 4 },
  metaActions: { flexDirection: "row", marginTop: 14, gap: 10 },
  primaryBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10, alignItems: "center", flex: 1 },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  secondaryBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10, alignItems: "center", flex: 1, borderWidth: 1 },
  secondaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  formGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, marginHorizontal: -6 },
  field: { width: "50%", paddingHorizontal: 6, marginBottom: 10 },
  fieldLabel: { fontSize: 11, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === "ios" ? 10 : 8, fontSize: 14 },
  derivedRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  derivedText: { fontSize: 12 },
});
