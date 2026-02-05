import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

interface PlatformConnectionProps {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  hint?: string;
}

export function PlatformConnection({ 
  name, 
  icon, 
  color, 
  isConnected, 
  onConnect, 
  onDisconnect,
  hint,
}: PlatformConnectionProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isConnected) {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.left}>
        <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
          <Text style={[styles.status, { color: isConnected ? colors.success : colors.textMuted }]}>
            {isConnected ? 'Connected' : 'Not connected'}
            {hint && isConnected ? ` (${hint})` : ''}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.button,
          { 
            backgroundColor: isConnected ? colors.error + '20' : color + '20',
            opacity: pressed ? 0.8 : 1,
          }
        ]}
      >
        <Text style={[styles.buttonText, { color: isConnected ? colors.error : color }]}>
          {isConnected ? 'Disconnect' : 'Connect'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  status: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  buttonText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
