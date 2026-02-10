import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import React from "react";

import Colors from "@/constants/colors";
import { useLanguage } from "@/context/LanguageContext";

function NativeTabLayout() {
  const { t } = useLanguage();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>{t('tabs.dashboard')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="create">
        <Icon sf={{ default: "sparkles", selected: "sparkles" }} />
        <Label>{t('tabs.create')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="studio">
        <Icon sf={{ default: "film", selected: "film.fill" }} />
        <Label>{t('tabs.studio')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>{t('tabs.calendar')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="campaigns">
        <Icon sf={{ default: "megaphone", selected: "megaphone.fill" }} />
        <Label>{t('tabs.campaigns')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ai-management">
        <Icon sf={{ default: "brain", selected: "brain.fill" }} />
        <Label>{t('tabs.aiManagement')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="photography">
        <Icon sf={{ default: "camera", selected: "camera.fill" }} />
        <Label>{t('tabs.photography')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="video-editor">
        <Icon sf={{ default: "video", selected: "video.fill" }} />
        <Label>{t('tabs.videoEditor')}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>{t('tabs.settings')}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const safeAreaInsets = useSafeAreaInsets();
  const isDark = colorScheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : isDark ? "#0F172A" : "#fff",
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: isDark ? "#334155" : "#E5E7EB",
          elevation: 0,
          paddingBottom: isWeb ? 0 : safeAreaInsets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "#0F172A" : "#fff" }]} />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.dashboard'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "stats-chart" : "stats-chart-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: t('tabs.create'),
          tabBarIcon: ({ color }) => (
            <Ionicons name="sparkles" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: t('tabs.studio'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "film" : "film-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: t('tabs.calendar'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: t('tabs.campaigns'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "megaphone" : "megaphone-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai-management"
        options={{
          title: t('tabs.aiManagement'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "hardware-chip" : "hardware-chip-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="photography"
        options={{
          title: t('tabs.photography'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "camera" : "camera-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="video-editor"
        options={{
          title: t('tabs.videoEditor'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "videocam" : "videocam-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "settings" : "settings-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
