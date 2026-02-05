import React from 'react';
import { View, Text, StyleSheet, useColorScheme, Dimensions } from 'react-native';
import Colors from '@/constants/colors';
import type { DailyMetric } from '@/lib/types';

interface MiniChartProps {
  data: DailyMetric[];
  metric: 'reach' | 'engagement' | 'conversions';
  title: string;
}

const { width } = Dimensions.get('window');
const CHART_WIDTH = width - 64;

export function MiniChart({ data, metric, title }: MiniChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const values = data.map(d => d[metric]);
  const maxValue = Math.max(...values);
  const barWidth = (CHART_WIDTH - (data.length - 1) * 8) / data.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <View style={styles.chartContainer}>
        {data.map((item, index) => {
          const height = maxValue > 0 ? (values[index] / maxValue) * 80 : 0;
          return (
            <View key={item.date} style={styles.barContainer}>
              <View 
                style={[
                  styles.bar, 
                  { 
                    height, 
                    width: barWidth,
                    backgroundColor: index === data.length - 1 ? colors.primary : colors.accent,
                    opacity: index === data.length - 1 ? 1 : 0.6,
                  }
                ]} 
              />
              <Text style={[styles.label, { color: colors.textMuted }]}>{item.date}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 100,
    gap: 8,
  },
  barContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  bar: {
    borderRadius: 4,
    marginBottom: 8,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
});
