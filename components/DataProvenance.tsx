import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export type ProvenanceKind = 'verified' | 'projected' | 'benchmark' | 'manual' | 'unverified';

interface DataProvenanceProps {
  kind: ProvenanceKind;
  compact?: boolean;
}

// P1-6 (launch-closure W3): visible watermark distinguishing real measured
// data ("verified" — META/published-post-driven) from forward-looking
// estimates ("projected" — plan/forecast), peer benchmarks ("benchmark"),
// user-entered ("manual"), and untrusted runs ("unverified" —
// integrityVerdict !== PASS). Replaces the old single-text-label pattern that
// let users misread projected revenue as actual revenue.
const META: Record<ProvenanceKind, { label: string; icon: keyof typeof Ionicons.glyphMap; tone: 'success' | 'warning' | 'neutral' | 'error' }> = {
  verified:   { label: 'Verified',   icon: 'shield-checkmark', tone: 'success' },
  projected:  { label: 'Projected',  icon: 'trending-up',      tone: 'warning' },
  benchmark:  { label: 'Benchmark',  icon: 'bar-chart',        tone: 'neutral' },
  manual:     { label: 'Manual',     icon: 'create',           tone: 'neutral' },
  unverified: { label: 'Unverified', icon: 'alert-circle',     tone: 'error'   },
};

export function DataProvenance({ kind, compact }: DataProvenanceProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const meta = META[kind];

  const toneColor =
    meta.tone === 'success' ? colors.success :
    meta.tone === 'warning' ? '#F59E0B' :
    meta.tone === 'error'   ? colors.error :
    colors.textSecondary;

  return (
    <View style={[styles.container, compact && styles.compact, { borderColor: toneColor + '40', backgroundColor: toneColor + '14' }]}>
      <Ionicons name={meta.icon} size={compact ? 10 : 12} color={toneColor} />
      <Text style={[styles.label, compact && styles.labelCompact, { color: toneColor }]}>{meta.label}</Text>
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
