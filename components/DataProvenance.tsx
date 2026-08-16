import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';

export type ProvenanceKind = 'verified' | 'projected' | 'benchmark' | 'manual' | 'unverified';

interface DataProvenanceProps {
  kind: ProvenanceKind;
  compact?: boolean;
}

const META: Record<ProvenanceKind, { labelKey: string; icon: keyof typeof Ionicons.glyphMap; tone: 'success' | 'warning' | 'neutral' | 'error' }> = {
  verified:   { labelKey: 'trust.provenanceVerified',   icon: 'shield-checkmark', tone: 'success' },
  projected:  { labelKey: 'trust.provenanceProjected',  icon: 'trending-up',      tone: 'warning' },
  benchmark:  { labelKey: 'trust.provenanceBenchmark',  icon: 'bar-chart',        tone: 'neutral' },
  manual:     { labelKey: 'trust.provenanceManual',     icon: 'create',           tone: 'neutral' },
  unverified: { labelKey: 'trust.provenanceUnverified', icon: 'alert-circle',     tone: 'error'   },
};

export function DataProvenance({ kind, compact }: DataProvenanceProps) {
  const colorScheme = useColorScheme();
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;
  const meta = META[kind];
  const { t } = useLanguage();
  const label = t(meta.labelKey);

  const toneColor =
    meta.tone === 'success' ? colors.success :
    meta.tone === 'warning' ? '#F59E0B' :
    meta.tone === 'error'   ? colors.error :
    colors.textSecondary;

  return (
    <View style={[styles.container, compact && styles.compact, { borderColor: toneColor + '40', backgroundColor: toneColor + '14' }]}>
      <Ionicons name={meta.icon} size={compact ? 10 : 12} color={toneColor} />
      <Text style={[styles.label, compact && styles.labelCompact, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  compact: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 9,
  },
});
