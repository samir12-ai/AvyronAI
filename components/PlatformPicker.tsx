import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface PlatformPickerProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
  single?: boolean;
}

const platforms = [
  { id: 'Instagram', icon: 'logo-instagram' as const, color: '#E1306C' },
  { id: 'Facebook', icon: 'logo-facebook' as const, color: '#1877F2' },
  { id: 'Twitter', icon: 'logo-twitter' as const, color: '#1DA1F2' },
  { id: 'LinkedIn', icon: 'logo-linkedin' as const, color: '#0A66C2' },
  { id: 'TikTok', icon: 'musical-notes' as const, color: '#000000' },
];

export function PlatformPicker({ selected, onChange, single }: PlatformPickerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const handleToggle = (id: string) => {
    Haptics.selectionAsync();
    if (single) {
      onChange([id]);
    } else {
      if (selected.includes(id)) {
        onChange(selected.filter(p => p !== id));
      } else {
        onChange([...selected, id]);
      }
    }
  };

  return (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {platforms.map(platform => {
        const isSelected = selected.includes(platform.id);
        return (
          <Pressable
            key={platform.id}
            onPress={() => handleToggle(platform.id)}
            style={[
              styles.platform,
              { 
                backgroundColor: isSelected ? platform.color + '20' : colors.inputBackground,
                borderColor: isSelected ? platform.color : 'transparent',
              }
            ]}
          >
            <Ionicons 
              name={platform.icon} 
              size={20} 
              color={isSelected ? platform.color : colors.textMuted} 
            />
            <Text style={[
              styles.label, 
              { color: isSelected ? platform.color : colors.textMuted }
            ]}>
              {platform.id}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    paddingVertical: 4,
  },
  platform: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
});
