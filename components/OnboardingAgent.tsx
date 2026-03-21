import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Image,
  Platform,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '@/context/OnboardingContext';

const BUBBLE_SIZE = 56;
const PANEL_WIDTH = Math.min(340, Dimensions.get('window').width - 40);

export default function OnboardingAgent() {
  const {
    currentStepData,
    currentStep,
    totalSteps,
    isVisible,
    progress,
    next,
    skip,
    dismiss,
  } = useOnboarding();

  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isVisible && currentStepData) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVisible, currentStepData]);

  if (!isVisible || !currentStepData) return null;

  const isLastStep = currentStep === totalSteps - 1;
  const isFirstStep = currentStep === 0;

  const handleDeepLink = () => {
    if (currentStepData.deepLink) {
      router.push(currentStepData.deepLink as any);
    }
  };

  const handleNext = () => {
    next();
  };

  const handleSkip = () => {
    skip();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [
            {
              translateY: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [100, 0],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.panel, { transform: [{ scale: pulseAnim }] }]}>
        <View style={styles.header}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarContainer}>
              <Image
                source={require('@/assets/images/logo.jpeg')}
                style={styles.avatar}
              />
              <View style={styles.statusDot} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.agentName}>MarketMind Agent</Text>
              <Text style={styles.stepIndicator}>
                Step {currentStep + 1} of {totalSteps}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={dismiss}
            style={styles.closeButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${((currentStep + 1) / totalSteps) * 100}%` }]} />
        </View>

        <View style={styles.body}>
          <Text style={styles.stepTitle}>{currentStepData.title}</Text>
          <Text style={styles.message}>{currentStepData.message}</Text>
        </View>

        {currentStepData.deepLink && (
          <TouchableOpacity style={styles.deepLinkButton} onPress={handleDeepLink} activeOpacity={0.7}>
            <Ionicons name="navigate-outline" size={16} color="#7C3AED" />
            <Text style={styles.deepLinkText}>{currentStepData.deepLinkLabel || 'Take me there'}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.footer}>
          {!isLastStep ? (
            <TouchableOpacity onPress={handleSkip} style={styles.skipButton} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip guide</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <TouchableOpacity onPress={handleNext} style={styles.nextButton} activeOpacity={0.8}>
            <Text style={styles.nextText}>
              {isLastStep ? 'Get Started' : 'Next'}
            </Text>
            <Ionicons
              name={isLastStep ? 'checkmark' : 'arrow-forward'}
              size={16}
              color="#fff"
            />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 100 : 110,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
    zIndex: 9999,
    pointerEvents: 'box-none' as const,
  },
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.12)',
    overflow: 'hidden' as const,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  avatarRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  avatarContainer: {
    position: 'relative' as const,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  statusDot: {
    position: 'absolute' as const,
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  headerText: {
    gap: 2,
  },
  agentName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  stepIndicator: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500' as const,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  progressBar: {
    height: 3,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#0F172A',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 21,
  },
  deepLinkButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#F5F3FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.1)',
  },
  deepLinkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#7C3AED',
  },
  footer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },
  skipButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  skipText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500' as const,
  },
  nextButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#7C3AED',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  nextText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
});
