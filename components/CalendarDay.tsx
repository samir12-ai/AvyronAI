import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import Colors from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface CalendarDayProps {
  date: number;
  isToday: boolean;
  isSelected: boolean;
  hasContent: boolean;
  onPress: () => void;
}

export function CalendarDay({ date, isToday, isSelected, hasContent, onPress }: CalendarDayProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  const handlePress = () => {
    Haptics.selectionAsync();
    onPress();
  };

  return (
    <Pressable 
      onPress={handlePress}
      style={[
        styles.container,
        isSelected && { backgroundColor: colors.primary },
        isToday && !isSelected && { borderColor: colors.primary, borderWidth: 2 },
      ]}
    >
      <Text style={[
        styles.date,
        { color: isSelected ? '#fff' : colors.text },
        isToday && !isSelected && { color: colors.primary },
      ]}>
        {date}
      </Text>
      {hasContent && (
        <View style={[
          styles.dot, 
          { backgroundColor: isSelected ? '#fff' : colors.accent }
        ]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    gap: 2,
  },
  date: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
