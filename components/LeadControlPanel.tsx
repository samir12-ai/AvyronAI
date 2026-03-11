import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFeatureFlags, FeatureFlags } from '@/hooks/useFeatureFlags';
import { getApiUrl, safeApiJson } from '@/lib/query-client';
import { fetch } from 'expo/fetch';

interface ModuleConfig {
  key: keyof FeatureFlags;
  label: string;
  description: string;
  icon: string;
  iconFamily: 'ionicons' | 'material';
  dependencies?: (keyof FeatureFlags)[];
  color: string;
}

const MODULES: ModuleConfig[] = [
  {
    key: 'lead_capture_enabled',
    label: 'Lead Capture',
    description: 'Forms, popups & contact collection',
    icon: 'person-add',
    iconFamily: 'ionicons',
    color: '#8B5CF6',
  },
  {
    key: 'conversion_tracking_enabled',
    label: 'Conversion Tracking',
    description: 'Track lead journey & conversions',
    icon: 'analytics',
    iconFamily: 'ionicons',
    color: '#4ECDC4',
  },
  {
    key: 'cta_engine_enabled',
    label: 'CTA Engine',
    description: 'AI-powered call-to-action variants',
    icon: 'megaphone',
    iconFamily: 'ionicons',
    dependencies: ['conversion_tracking_enabled'],
    color: '#FFB347',
  },
  {
    key: 'funnel_logic_enabled',
    label: 'Funnel Logic',
    description: 'Multi-step conversion funnels',
    icon: 'filter',
    iconFamily: 'ionicons',
    dependencies: ['lead_capture_enabled', 'conversion_tracking_enabled'],
    color: '#A78BFA',
  },
  {
    key: 'lead_magnet_enabled',
    label: 'Lead Magnets',
    description: 'AI-generated downloadable assets',
    icon: 'magnet',
    iconFamily: 'ionicons',
    dependencies: ['lead_capture_enabled'],
    color: '#FF6B6B',
  },
  {
    key: 'landing_pages_enabled',
    label: 'Landing Pages',
    description: 'High-converting page builder',
    icon: 'document-text',
    iconFamily: 'ionicons',
    dependencies: ['lead_capture_enabled'],
    color: '#45B7D1',
  },
  {
    key: 'revenue_attribution_enabled',
    label: 'Revenue Attribution',
    description: 'ROI tracking & attribution models',
    icon: 'cash',
    iconFamily: 'ionicons',
    dependencies: ['conversion_tracking_enabled'],
    color: '#34D399',
  },
  {
    key: 'ai_lead_optimization_enabled',
    label: 'AI Optimization',
    description: 'Autonomous lead scoring & routing',
    icon: 'sparkles',
    iconFamily: 'ionicons',
    dependencies: ['lead_capture_enabled', 'conversion_tracking_enabled'],
    color: '#F59E0B',
  },
];

interface LeadStats {
  totalLeads: number;
  leadsThisMonth: number;
  conversionRate: number;
  totalRevenue: number;
  byStatus: Record<string, number>;
}

export default function LeadControlPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const {
    flags,
    loading,
    error,
    toggleFlag,
    globalKill,
    globalResume,
    refresh,
    isGlobalOff,
    enabledCount,
  } = useFeatureFlags();
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/leads/stats', baseUrl);
      const res = await fetch(url.toString(), { credentials: 'include' });
      if (res.ok) {
        const data = await safeApiJson(res);
        if (data.stats) setStats(data.stats);
      }
    } catch {} finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), fetchStats()]);
    setRefreshing(false);
  }, [refresh, fetchStats]);

  const handleToggle = async (mod: ModuleConfig, newValue: boolean) => {
    if (isGlobalOff) {
      Alert.alert('Engine Disabled', 'The Lead Engine is globally disabled. Resume it first.');
      return;
    }

    if (newValue && mod.dependencies) {
      const missing = mod.dependencies.filter(d => !flags[d]);
      if (missing.length > 0) {
        const names = missing.map(m => MODULES.find(mod => mod.key === m)?.label || m).join(', ');
        Alert.alert(
          'Dependencies Required',
          `Enable ${names} first. This module will run in safe mode without them.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Enable Anyway (Safe Mode)',
              onPress: async () => {
                setToggling(mod.key);
                await toggleFlag(mod.key, true, 'Enabled in safe mode');
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setToggling(null);
              },
            },
          ]
        );
        return;
      }
    }

    setToggling(mod.key);
    await toggleFlag(mod.key, newValue);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setToggling(null);
  };

  const handleKillSwitch = () => {
    Alert.alert(
      'Emergency Stop',
      'This will immediately disable ALL lead engine modules. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable All',
          style: 'destructive',
          onPress: async () => {
            await globalKill('Emergency stop from control panel');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const handleResume = async () => {
    await globalResume('Resumed from control panel');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const getDependencyStatus = (mod: ModuleConfig): 'ok' | 'safe_mode' | 'off' => {
    if (!flags[mod.key]) return 'off';
    if (!mod.dependencies) return 'ok';
    const missing = mod.dependencies.filter(d => !flags[d]);
    return missing.length > 0 ? 'safe_mode' : 'ok';
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading Lead Engine...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isGlobalOff && (
        <LinearGradient
          colors={['#FF4444', '#CC0000']}
          style={styles.killBanner}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <View style={styles.killBannerContent}>
            <Ionicons name="warning" size={20} color="#FFF" />
            <Text style={styles.killBannerText}>Lead Engine DISABLED</Text>
          </View>
          <Pressable onPress={handleResume} style={styles.resumeButton}>
            <Ionicons name="play" size={16} color="#FFF" />
            <Text style={styles.resumeText}>Resume</Text>
          </Pressable>
        </LinearGradient>
      )}

      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lead Engine</Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            {enabledCount}/8 modules active
          </Text>
        </View>
        {!isGlobalOff && (
          <Pressable onPress={handleKillSwitch} style={styles.killButton}>
            <Ionicons name="power" size={18} color="#FF4444" />
          </Pressable>
        )}
      </View>

      {!statsLoading && stats && (
        <View style={styles.statsRow}>
          <StatCard label="Total Leads" value={stats.totalLeads.toString()} color={colors.primary} isDark={isDark} />
          <StatCard label="This Month" value={stats.leadsThisMonth.toString()} color="#4ECDC4" isDark={isDark} />
          <StatCard label="Conv. Rate" value={`${stats.conversionRate.toFixed(1)}%`} color="#FFB347" isDark={isDark} />
          <StatCard label="Revenue" value={`$${stats.totalRevenue.toLocaleString()}`} color="#34D399" isDark={isDark} />
        </View>
      )}

      <View style={styles.modulesGrid}>
        {MODULES.map((mod) => {
          const status = getDependencyStatus(mod);
          const isEnabled = flags[mod.key];
          const isToggling = toggling === mod.key;

          return (
            <View
              key={mod.key}
              style={[
                styles.moduleCard,
                {
                  backgroundColor: isDark ? '#0F1419' : '#FFFFFF',
                  borderColor: isEnabled
                    ? status === 'safe_mode'
                      ? '#FFB347'
                      : mod.color + '40'
                    : isDark ? '#1A2030' : '#E2E8E4',
                  borderWidth: 1,
                  opacity: isGlobalOff ? 0.5 : 1,
                },
              ]}
            >
              <View style={styles.moduleHeader}>
                <View style={[styles.moduleIconWrap, { backgroundColor: mod.color + '18' }]}>
                  <Ionicons name={mod.icon as any} size={20} color={mod.color} />
                </View>
                <View style={styles.moduleInfo}>
                  <Text style={[styles.moduleName, { color: colors.text }]} numberOfLines={1}>
                    {mod.label}
                  </Text>
                  {status === 'safe_mode' && (
                    <View style={styles.safeModeTag}>
                      <Text style={styles.safeModeText}>SAFE MODE</Text>
                    </View>
                  )}
                </View>
                {isToggling ? (
                  <ActivityIndicator size="small" color={mod.color} />
                ) : (
                  <Switch
                    value={isEnabled}
                    onValueChange={(v) => handleToggle(mod, v)}
                    trackColor={{ false: isDark ? '#2A2A3A' : '#D1D5DB', true: mod.color + '80' }}
                    thumbColor={isEnabled ? mod.color : isDark ? '#6B7280' : '#9CA3AF'}
                    disabled={isGlobalOff}
                  />
                )}
              </View>
              <Text style={[styles.moduleDesc, { color: colors.textSecondary }]} numberOfLines={2}>
                {mod.description}
              </Text>
              {mod.dependencies && mod.dependencies.length > 0 && (
                <View style={styles.depRow}>
                  <Ionicons name="link" size={12} color={colors.textMuted} />
                  <Text style={[styles.depText, { color: colors.textMuted }]}>
                    Requires: {mod.dependencies.map(d => MODULES.find(m => m.key === d)?.label).join(', ')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

    </View>
  );
}

function StatCard({ label, value, color, isDark }: { label: string; value: string; color: string; isDark: boolean }) {
  return (
    <View style={[styles.statCard, { backgroundColor: isDark ? '#0F1419' : '#FFFFFF', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: isDark ? '#8892A4' : '#546478' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 0 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText: { marginTop: 12, fontSize: 14 },
  killBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  killBannerContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  killBannerText: { color: '#FFF', fontSize: 14, fontWeight: '700' as const },
  resumeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resumeText: { color: '#FFF', fontSize: 12, fontWeight: '600' as const },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 22, fontWeight: '700' as const },
  sectionSub: { fontSize: 13, marginTop: 2 },
  killButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,68,68,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  statValue: { fontSize: 16, fontWeight: '700' as const },
  statLabel: { fontSize: 10, marginTop: 4 },
  modulesGrid: {
    paddingHorizontal: 16,
    gap: 10,
  },
  moduleCard: {
    borderRadius: 14,
    padding: 14,
  },
  moduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  moduleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moduleInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  moduleName: { fontSize: 15, fontWeight: '600' as const },
  safeModeTag: {
    backgroundColor: '#FFB34720',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  safeModeText: { color: '#FFB347', fontSize: 9, fontWeight: '700' as const },
  moduleDesc: { fontSize: 12, marginLeft: 46, lineHeight: 16 },
  depRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 46 },
  depText: { fontSize: 10 },
});
