import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getApiUrl } from '@/lib/query-client';

interface NarrativeStep {
  key: string;
  label: string;
  icon: string;
  text: string;
}

interface NarrativeData {
  hasNarrative: boolean;
  steps: NarrativeStep[];
  oneLiner: string;
  engineCount: number;
  completedAt: string | null;
}

const STEP_COLORS = ['#FF6B6B', '#F59E0B', '#8B5CF6', '#3B82F6', '#10B981'];

export default function NarrativeCard({ campaignId, isDark }: { campaignId: string | null; isDark: boolean }) {
  const [data, setData] = useState<NarrativeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const bg = isDark ? '#0F1419' : '#FFFFFF';
  const borderColor = isDark ? '#1E2736' : '#E5E7EB';
  const textPrimary = isDark ? '#E8ECF0' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';
  const lineBg = isDark ? '#1E2736' : '#E5E7EB';

  const fetchNarrative = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const url = new URL(`/api/narrative/${campaignId}`, getApiUrl());
      const resp = await fetch(url.toString());
      if (resp.ok) {
        const json = await resp.json();
        setData(json);
      }
    } catch {}
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchNarrative(); }, [fetchNarrative]);

  if (loading) return null;
  if (!data?.hasNarrative || !data.steps.length) return null;

  return (
    <View style={[s.container, { backgroundColor: bg, borderColor }]}>
      <Pressable onPress={() => setExpanded(!expanded)} style={s.header}>
        <View style={s.headerLeft}>
          <LinearGradient colors={['#F59E0B', '#EF4444']} style={s.headerIcon} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Ionicons name="link-outline" size={16} color="#FFF" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerTitle, { color: textPrimary }]}>Strategic Narrative</Text>
            <Text style={[s.headerSub, { color: textSecondary }]} numberOfLines={1}>
              {data.engineCount} engines connected
            </Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={textSecondary} />
      </Pressable>

      {expanded && (
        <View style={s.stepsContainer}>
          {data.steps.map((step, i) => {
            const color = STEP_COLORS[i % STEP_COLORS.length];
            const isLast = i === data.steps.length - 1;
            return (
              <View key={step.key} style={s.stepRow}>
                <View style={s.stepTimeline}>
                  <View style={[s.stepDot, { backgroundColor: color }]} />
                  {!isLast && <View style={[s.stepLine, { backgroundColor: lineBg }]} />}
                </View>
                <View style={[s.stepContent, !isLast && { paddingBottom: 16 }]}>
                  <Text style={[s.stepLabel, { color }]}>{step.label}</Text>
                  <Text style={[s.stepText, { color: textPrimary }]}>{step.text}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700' as const },
  headerSub: { fontSize: 12, marginTop: 1 },
  stepsContainer: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 0 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepTimeline: { alignItems: 'center', width: 16, paddingTop: 2 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  stepLine: { width: 2, flex: 1, marginTop: 4 },
  stepContent: { flex: 1, paddingTop: 0 },
  stepLabel: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  stepText: { fontSize: 14, lineHeight: 20 },
});
