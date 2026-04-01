import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useColorScheme,
} from 'react-native';
import AvyronLogo from '@/components/AvyronLogo';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOnboarding } from '@/context/OnboardingContext';

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

  const isDark = useColorScheme() === 'dark';
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isVisible && currentStepData) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible, currentStepData]);

  if (!isVisible || !currentStepData) return null;

  const isLastStep = currentStep === totalSteps - 1;

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

  const panelBg = isDark ? '#151B24' : '#FFFFFF';
  const borderC = isDark ? '#1E2736' : '#E2E8F0';
  const textPrimary = isDark ? '#E8ECF0' : '#0F172A';
  const textSecondary = isDark ? '#8892A4' : '#475569';
  const textMuted = isDark ? '#4A5568' : '#94A3B8';
  const progressBg = isDark ? '#1E2736' : '#F1F5F9';
  const deepLinkBg = isDark ? 'rgba(124,58,237,0.12)' : '#F5F3FF';
  const deepLinkBorder = isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.1)';
  const closeBg = isDark ? '#1E2736' : '#F1F5F9';

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={[styles.panel, { backgroundColor: panelBg, borderColor: borderC }]}>
        <View style={styles.header}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarContainer}>
              <View style={styles.avatar}>
                <AvyronLogo size={28} />
              </View>
              <View style={styles.statusDot} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.agentName, { color: textPrimary }]}>Avyron Agent</Text>
              <Text style={[styles.stepIndicator, { color: textMuted }]}>
                Step {currentStep + 1} of {totalSteps}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={dismiss}
            style={[styles.closeButton, { backgroundColor: closeBg }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={textMuted} />
          </TouchableOpacity>
        </View>

        <View style={[styles.progressBar, { backgroundColor: progressBg }]}>
          <View style={[styles.progressFill, { width: `${((currentStep + 1) / totalSteps) * 100}%` }]} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.stepTitle, { color: textPrimary }]}>{currentStepData.title}</Text>
          <Text style={[styles.message, { color: textSecondary }]}>{currentStepData.message}</Text>
        </View>

        {currentStepData.deepLink && (
          <TouchableOpacity style={[styles.deepLinkButton, { backgroundColor: deepLinkBg, borderColor: deepLinkBorder }]} onPress={handleDeepLink} activeOpacity={0.7}>
            <Ionicons name="navigate-outline" size={16} color="#7C3AED" />
            <Text style={styles.deepLinkText}>{currentStepData.deepLinkLabel || 'Take me there'}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.footer}>
          {!isLastStep ? (
            <TouchableOpacity onPress={handleSkip} style={styles.skipButton} activeOpacity={0.7}>
              <Text style={[styles.skipText, { color: textMuted }]}>Skip guide</Text>
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
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
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
    backgroundColor: 'rgba(124,58,237,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
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
    letterSpacing: -0.3,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  progressBar: {
    height: 3,
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
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 14,
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
    borderRadius: 10,
    borderWidth: 1,
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
