import React from 'react';
import { Pressable, Text, StyleSheet, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface QuickActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
}

export function QuickAction({ icon, label, onPress, color }: QuickActionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable 
      onPress={handlePress}
      style={({ pressed }) => [
        styles.container,
        { 
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
          opacity: pressed ? 0.8 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        }
      ]}
    >
      <LinearGradient
        colors={color ? [color, color] : (colors.primaryGradient as [string, string])}
        style={styles.iconContainer}
      >
        <Ionicons name={icon} size={20} color="#fff" />
      </LinearGradient>
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
});
