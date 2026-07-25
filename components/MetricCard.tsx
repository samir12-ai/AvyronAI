import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';
import { DataProvenance, type ProvenanceKind } from '@/components/DataProvenance';

// P1-5 (launch-closure W3): MetricCard now respects the upstream
// integrityVerdict from useRunTruthfulness. When verdict !== PASS the trend
// arrow + percentage are hidden and the card is dimmed, with an "Unverified"
// provenance badge. Trend deltas based on shadowed/untrusted/stale runs are
// no longer displayed as if they were real growth.
//
// P1-6: optional `provenance` prop renders a DataProvenance watermark
// distinguishing META vs PLAN vs MANUAL vs BENCHMARK vs UNVERIFIED data.
export type MetricCardVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'SHADOWED' | 'UNTRUSTED' | 'STALE' | 'UNKNOWN';

interface MetricCardProps {
  title: string;
  value: string;
  change: number;
  icon: keyof typeof Ionicons.glyphMap;
  isGradient?: boolean;
  /** Upstream integrity verdict from useRunTruthfulness(). Default 'PASS' for
   *  call-sites that have not yet wired the hook. Anything other than PASS
   *  hides the trend delta and dims the card. */
  integrityVerdict?: MetricCardVerdict;
  /** Optional provenance watermark — renders a small badge under the title. */
  provenance?: ProvenanceKind;
}

export function MetricCard({ title, value, change, icon, isGradient, integrityVerdict = 'PASS', provenance }: MetricCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const isPositive = change >= 0;
  const verdictTrusted = integrityVerdict === 'PASS';
  const cardOpacity = verdictTrusted ? 1 : 0.55;

  const content = (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={20} color={isGradient ? '#fff' : colors.primary} />
      </View>
      <Text style={[styles.title, { color: isGradient ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}>
        {title}
      </Text>
      {provenance && (
        <View style={styles.provenanceRow}>
          <DataProvenance kind={provenance} compact />
        </View>
      )}
      <Text style={[styles.value, { color: isGradient ? '#fff' : colors.text }]}>
        {value}
      </Text>
      {verdictTrusted ? (
        <View style={styles.changeContainer}>
          <Ionicons
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={14}
            color={isGradient ? (isPositive ? '#86EFAC' : '#FCA5A5') : (isPositive ? colors.success : colors.error)}
          />
          <Text style={[
            styles.changeText,
            { color: isGradient ? (isPositive ? '#86EFAC' : '#FCA5A5') : (isPositive ? colors.success : colors.error) }
          ]}>
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </Text>
        </View>
      ) : (
        <View style={styles.changeContainer}>
          <DataProvenance kind="unverified" compact />
        </View>
      )}
    </>
  );

  if (isGradient) {
    return (
      <LinearGradient
        colors={colors.primaryGradient as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { opacity: cardOpacity }]}
      >
        {content}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder, opacity: cardOpacity }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 150,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },
  value: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  changeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  provenanceRow: {
    marginBottom: 6,
  },
  changeText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
