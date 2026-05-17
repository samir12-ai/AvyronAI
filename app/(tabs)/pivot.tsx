import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, useColorScheme, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

interface PivotTile {
  key: "connect" | "diagnose" | "roadmap" | "monitor";
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  accent: string;
}

const TILES: PivotTile[] = [
  { key: "connect",  title: "Connect",  subtitle: "Wire up real data — Meta, manual metrics, brand profile, competitors", icon: "link-outline",        route: "/connect",  accent: "#34D399" },
  { key: "diagnose", title: "Diagnose", subtitle: "See what the engine knows, what's degraded, and what blocks the next plan", icon: "pulse-outline",      route: "/diagnose", accent: "#60A5FA" },
  { key: "roadmap",  title: "Roadmap",  subtitle: "Build, review, and approve the strategic plan and execution timeline",     icon: "map-outline",        route: "/roadmap",  accent: "#A78BFA" },
  { key: "monitor",  title: "Monitor",  subtitle: "Early-warning signals: trajectory shifts and audience fatigue",            icon: "radio-outline",      route: "/(tabs)/monitor", accent: "#FBBF24" },
];

export default function PivotHub() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const go = (route: string) => {
    Haptics.selectionAsync();
    router.push(route as never);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Platform.OS === "web" ? 83 : insets.top + 16, paddingBottom: insets.bottom + 100 },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>Pivot</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Connect · Diagnose · Roadmap · Monitor — the four moves
        </Text>

        {TILES.map(tile => (
          <Pressable
            key={tile.key}
            onPress={() => go(tile.route)}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: colors.card, borderColor: colors.cardBorder, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: tile.accent + "22" }]}>
              <Ionicons name={tile.icon} size={24} color={tile.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tileTitle, { color: colors.text }]}>{tile.title}</Text>
              <Text style={[styles.tileSubtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                {tile.subtitle}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, marginTop: 6, marginBottom: 18 },
  tile: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 14 },
  tileTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  tileSubtitle: { fontSize: 12, marginTop: 4 },
});
