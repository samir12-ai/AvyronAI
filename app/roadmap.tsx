import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, useColorScheme, Pressable, Platform } from "react-native";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useCampaign } from "@/context/CampaignContext";
import BuildThePlan from "@/components/BuildThePlan";
import ExecutionPlan from "@/components/ExecutionPlan";
import PlanDocumentView from "@/components/PlanDocumentView";
import { BusinessProfileModal } from "@/components/BusinessProfile";

type RoadmapSection = "build" | "execute" | "document";

const SECTIONS: { key: RoadmapSection; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "build",    label: "Build",    icon: "construct-outline" },
  { key: "execute",  label: "Execute",  icon: "rocket-outline" },
  { key: "document", label: "Document", icon: "document-text-outline" },
];

/**
 * RoadmapScreen — Phase 9 merged Roadmap renderer.
 *
 * Combines BuildThePlan (strategic plan generation + clarifications) +
 * ExecutionPlan (calendar / content pipeline) + PlanDocumentView (rendered
 * plan document for the active campaign) behind a single segmented control.
 *
 * The three sub-renderers share campaign context via CampaignContext and
 * coordinate cross-section navigation via the segmented header.
 */
export default function RoadmapScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { selectedCampaignId } = useCampaign();

  const [section, setSection] = useState<RoadmapSection>("build");
  const [showProfile, setShowProfile] = useState(false);

  const switchTo = (next: RoadmapSection) => {
    Haptics.selectionAsync();
    setSection(next);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky header — survives the three sub-renderers, which each have their own ScrollView */}
      <View
        style={[
          styles.header,
          { paddingTop: Platform.OS === "web" ? 67 : insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.cardBorder },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>Roadmap</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Build · Execute · Document
            </Text>
          </View>
          <Pressable
            onPress={() => { Haptics.selectionAsync(); router.push("/calendar" as never); }}
            hitSlop={12}
            style={[styles.calBtn, { backgroundColor: colors.primary + "15" }]}
          >
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={[styles.calBtnText, { color: colors.primary }]}>Calendar</Text>
          </Pressable>
        </View>

        <View style={[styles.segmented, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          {SECTIONS.map(s => {
            const active = section === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => switchTo(s.key)}
                style={[
                  styles.segment,
                  active && { backgroundColor: colors.primary },
                ]}
              >
                <Ionicons name={s.icon} size={15} color={active ? "#fff" : colors.textSecondary} />
                <Text style={[styles.segmentText, { color: active ? "#fff" : colors.textSecondary }]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!selectedCampaignId ? (
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 100 }}>
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="map-outline" size={32} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Select a campaign to see your roadmap.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Mounting all three keeps internal state (clarifications, blueprint, document fetch) across switches.
              `display: none` keeps unmounted sections cheap rather than tearing down their state on every tab change. */}
          <View style={{ flex: 1, display: section === "build" ? "flex" : "none" }}>
            <BuildThePlan
              onNavigateToCI={() => router.push({ pathname: "/(tabs)/ai-management", params: { tab: "intelligence", ts: String(Date.now()) } } as never)}
              onNavigateToCalendar={() => router.push("/calendar" as never)}
              onOpenProfile={() => setShowProfile(true)}
            />
          </View>
          <View style={{ flex: 1, display: section === "execute" ? "flex" : "none" }}>
            <ExecutionPlan onPlanGenerated={() => switchTo("document")} />
          </View>
          <View style={{ flex: 1, display: section === "document" ? "flex" : "none" }}>
            <PlanDocumentView onClose={() => switchTo("build")} />
          </View>
        </View>
      )}

      <BusinessProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        onComplete={() => setShowProfile(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, marginTop: 2 },
  calBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  calBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginLeft: 6 },
  segmented: { flexDirection: "row", padding: 4, borderRadius: 10, borderWidth: 1 },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 8, gap: 6 },
  segmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  emptyCard: { padding: 28, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  emptyText: { fontSize: 14, marginTop: 12, textAlign: "center" },
});
