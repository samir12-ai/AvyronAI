import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';

interface MetricCardProps {
  title: string;
  value: string;
  change: number;
  icon: keyof typeof Ionicons.glyphMap;
  isGradient?: boolean;
}

export function MetricCard({ title, value, change, icon, isGradient }: MetricCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const isPositive = change >= 0;

  const content = (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name={icon} size={20} color={isGradient ? '#fff' : colors.primary} />
      </View>
      <Text style={[styles.title, { color: isGradient ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}>
        {title}
      </Text>
      <Text style={[styles.value, { color: isGradient ? '#fff' : colors.text }]}>
        {value}
      </Text>
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
    </>
  );

  if (isGradient) {
    return (
      <LinearGradient
        colors={colors.primaryGradient as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {content}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
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
  changeText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
