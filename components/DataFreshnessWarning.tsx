import React from 'react';
import { View, Text, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

interface FreshnessMetadata {
  freshnessClass: string;
  ageInDays: number;
  trustScore: number;
  stalenessCoefficient: number;
  warning: string | null;
  blockedForStrategy: boolean;
  schemaCompatible: boolean;
  schemaRecommendation: string;
}

interface DataFreshnessWarningProps {
  freshnessMetadata: FreshnessMetadata | null | undefined;
  onRefresh?: () => void;
  compact?: boolean;
}

export default function DataFreshnessWarning({ freshnessMetadata, onRefresh, compact = false }: DataFreshnessWarningProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  if (!freshnessMetadata) return null;

  const { freshnessClass, ageInDays, warning, blockedForStrategy, schemaRecommendation } = freshnessMetadata;

  if (freshnessClass === 'FRESH' && schemaRecommendation === 'USE') return null;
  if (freshnessClass === 'AGING' && ageInDays < 3 && schemaRecommendation === 'USE') return null;

  let iconName: keyof typeof Ionicons.glyphMap = 'information-circle';
  let bgColor = '#FFF3CD';
  let borderColor = '#FFCA28';
  let textColor = '#856404';

  if (blockedForStrategy || freshnessClass === 'INCOMPATIBLE') {
    iconName = 'warning';
    bgColor = isDark ? '#3D1F1F' : '#FDDEDE';
    borderColor = '#EF5350';
    textColor = isDark ? '#FF8A80' : '#C62828';
  } else if (freshnessClass === 'NEEDS_REFRESH') {
    iconName = 'alert-circle';
    bgColor = isDark ? '#3D2E1F' : '#FFF3CD';
    borderColor = '#FF9800';
    textColor = isDark ? '#FFB74D' : '#E65100';
  } else if (freshnessClass === 'AGING' || freshnessClass === 'PARTIAL') {
    iconName = 'time-outline';
    bgColor = isDark ? '#2E3B1F' : '#FFF8E1';
    borderColor = '#FFCA28';
    textColor = isDark ? '#FFD54F' : '#856404';
  } else if (schemaRecommendation === 'USE_WITH_CAUTION') {
    iconName = 'code-working-outline';
    bgColor = isDark ? '#1F2E3D' : '#E3F2FD';
    borderColor = '#42A5F5';
    textColor = isDark ? '#64B5F6' : '#1565C0';
  }

  const displayAge = Math.round(ageInDays);
  const cleanWarning = warning && (warning.includes('partial data') || warning.includes('Some signals may be missing'))
    ? null
    : warning;
  const message = cleanWarning || getDefaultMessage(freshnessClass, displayAge, schemaRecommendation);

  if (compact) {
    return (
      <View style={[styles.compactContainer, { backgroundColor: bgColor, borderColor }]}>
        <Ionicons name={iconName} size={14} color={textColor} />
        <Text style={[styles.compactText, { color: textColor }]} numberOfLines={1}>
          {displayAge}d old
          {blockedForStrategy ? ' — Blocked' : ''}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor, borderColor }]}>
      <View style={styles.row}>
        <Ionicons name={iconName} size={18} color={textColor} />
        <Text style={[styles.message, { color: textColor }]}>{message}</Text>
      </View>
      {onRefresh && blockedForStrategy && (
        <Pressable onPress={onRefresh} style={[styles.refreshBtn, { borderColor: textColor }]}>
          <Ionicons name="refresh" size={14} color={textColor} />
          <Text style={[styles.refreshText, { color: textColor }]}>Re-run Analysis</Text>
        </Pressable>
      )}
    </View>
  );
}

function getDefaultMessage(freshnessClass: string, ageInDays: number, schemaRecommendation: string): string {
  if (freshnessClass === 'INCOMPATIBLE') return 'Data schema is incompatible with the current engine. Re-run analysis.';
  if (freshnessClass === 'NEEDS_REFRESH') return `Data is ${ageInDays} days old and needs a refresh for accurate results.`;
  if (freshnessClass === 'AGING') return `Data is ${ageInDays} days old. Consider refreshing for the latest insights.`;
  if (freshnessClass === 'PARTIAL') return 'Analysis used all available data sources. More sources can improve depth.';
  if (freshnessClass === 'RESTORED') return 'Data was restored from a previous state. Verify accuracy.';
  if (schemaRecommendation === 'USE_WITH_CAUTION') return 'Data schema has minor differences from the current engine version.';
  return `Data is ${ageInDays} days old.`;
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  refreshText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  compactText: {
    fontSize: 11,
    fontWeight: '500' as const,
  },
});
