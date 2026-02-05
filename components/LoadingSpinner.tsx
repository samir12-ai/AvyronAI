import React from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import Colors from '@/constants/colors';

interface LoadingSpinnerProps {
  size?: number;
  color?: string;
}

export function LoadingSpinner({ size = 24, color }: LoadingSpinnerProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const spinnerColor = color || colors.primary;

  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View 
        style={[
          styles.spinner, 
          animatedStyle,
          { 
            width: size, 
            height: size, 
            borderColor: spinnerColor + '30',
            borderTopColor: spinnerColor,
          }
        ]} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    borderWidth: 3,
    borderRadius: 999,
  },
});
