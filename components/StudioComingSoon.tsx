import React from 'react';
import { View, Text, StyleSheet, useColorScheme, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export const STUDIO_COMING_SOON = true;

export default function StudioComingSoon() {
  const colorScheme = useColorScheme();
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: topInset, paddingBottom: bottomInset },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primary + '18' }]}>
        <Ionicons name="lock-closed" size={40} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Studio</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Coming soon</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>
        We're putting the finishing touches on Studio. Check back soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 12,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
