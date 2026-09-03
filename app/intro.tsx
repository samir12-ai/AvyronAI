import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import AvyronLogo from '@/components/AvyronLogo';

interface OnboardingStepItem {
  number: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const ONBOARDING_STEPS: OnboardingStepItem[] = [
  {
    number: '01',
    title: 'Understand your business',
    description: 'Website profile, business model, and offering catalog',
    icon: 'business-outline',
  },
  {
    number: '02',
    title: 'Choose your market and focus',
    description: 'Target geography, campaign objectives, and customer focus',
    icon: 'globe-outline',
  },
  {
    number: '03',
    title: 'Connect your channels',
    description: 'Owned media channels and historical performance telemetry',
    icon: 'share-social-outline',
  },
  {
    number: '04',
    title: 'Discover your competitors',
    description: 'Multi-source competitor discovery and benchmark tracking',
    icon: 'search-outline',
  },
  {
    number: '05',
    title: 'Build your strategy',
    description: 'Autonomous strategic synthesis, positioning, and action plan',
    icon: 'layers-outline',
  },
];

export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;
  const { markIntroSeen, user } = useAuth();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, useNativeDriver: false }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, useNativeDriver: false }),
    ]).start();
  }, []);

  const handleStartSetup = async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      await markIntroSeen();
    } catch (e) {
      console.warn('[Intro] markIntroSeen error:', e);
    }
    router.replace('/setup');
  };

  return (
    <View style={styles.rootContainer}>
      <View style={[styles.mainLayout, isDesktop && styles.desktopLayout]}>
        
        {/* LEFT COLUMN: ONBOARDING INTRO & PREVIEW */}
        <View style={[styles.leftColumn, isDesktop ? styles.leftColumnDesktop : styles.leftColumnMobile]}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollInner,
              {
                paddingTop: Platform.OS === 'web' ? (isDesktop ? 48 : 32) : insets.top + 24,
                paddingBottom: insets.bottom + 32,
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={[
                styles.contentWrapper,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              {/* Brand Header */}
              <View style={styles.brandHeader}>
                <View style={styles.logoRow}>
                  <AvyronLogo size={32} />
                  <Text style={styles.brandTitle}>Avyron</Text>
                  <View style={styles.headerDivider} />
                  <View style={styles.taglineBox}>
                    <Text style={styles.taglineText}>AI-Powered Strategic Intelligence</Text>
                    <Text style={styles.taglineSubText}>for Modern Marketing Teams</Text>
                  </View>
                </View>
              </View>

              {/* Status Eyebrow Badge */}
              <View style={styles.eyebrowContainer}>
                <View style={styles.eyebrowBadge}>
                  <Ionicons name="checkmark-circle" size={13} color="#A78BFA" style={{ marginRight: 5 }} />
                  <Text style={styles.eyebrowText}>ACCOUNT CREATED</Text>
                </View>
              </View>

              {/* Main Headline & Supporting Paragraphs */}
              <View style={styles.headerTextBlock}>
                <Text style={styles.mainHeadline}>Welcome to Avyron</Text>
                <Text style={styles.subHeadline}>
                  Let's build your market intelligence workspace.
                </Text>
                <Text style={styles.bodyDescription}>
                  We'll learn how your business works, understand your market, connect your channels, and identify the competitors that matter before building your strategy.
                </Text>
              </View>

              {/* Onboarding Steps Preview */}
              <View style={styles.stepsSection}>
                <Text style={styles.stepsSectionTitle}>WHAT WE'LL SET UP NEXT</Text>
                <View style={styles.stepsList}>
                  {ONBOARDING_STEPS.map((step) => (
                    <View key={step.number} style={styles.stepCard}>
                      <View style={styles.stepNumberBadge}>
                        <Text style={styles.stepNumberText}>{step.number}</Text>
                      </View>
                      <View style={styles.stepTextContainer}>
                        <Text style={styles.stepTitleText}>{step.title}</Text>
                        <Text style={styles.stepDescText}>{step.description}</Text>
                      </View>
                      <Ionicons name={step.icon} size={18} color="#64748B" style={styles.stepTrailingIcon} />
                    </View>
                  ))}
                </View>
              </View>

              {/* Primary CTA Button */}
              <View style={styles.ctaSection}>
                <Pressable
                  onPress={handleStartSetup}
                  style={({ pressed }) => [
                    styles.ctaButtonWrapper,
                    pressed && styles.ctaButtonPressed,
                  ]}
                  testID="setup-workspace-cta"
                >
                  <LinearGradient
                    colors={['#8B5CF6', '#7C3AED']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.ctaButtonGradient}
                  >
                    <Text style={styles.ctaButtonText}>Set up my workspace</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={styles.ctaArrowIcon} />
                  </LinearGradient>
                </Pressable>

                {/* Secondary reassurance text */}
                <Text style={styles.secondaryTimeNote}>Takes only a few minutes.</Text>
              </View>

              {/* Trust Footer */}
              <View style={styles.trustFooter}>
                <Ionicons name="shield-checkmark-outline" size={13} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.trustFooterText}>
                  Enterprise-grade encryption · SOC 2 & GDPR compliant architecture
                </Text>
              </View>

            </Animated.View>
          </ScrollView>
        </View>

        {/* RIGHT COLUMN: REALISTIC HERO VISUAL (DESKTOP ONLY) */}
        {isDesktop && (
          <View style={styles.rightColumn}>
            <View style={styles.heroCardContainer}>
              <Image
                source={require('@/assets/images/auth-hero.jpg')}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />

              <LinearGradient
                colors={['rgba(7,4,14,0.2)', 'rgba(7,4,14,0.45)', 'rgba(7,4,14,0.85)']}
                locations={[0, 0.5, 1]}
                style={StyleSheet.absoluteFillObject}
              />

              <View style={styles.heroContentInner}>
                <View style={styles.valueCard}>
                  <Text style={styles.valueTitleWhite}>Know what changed.</Text>
                  <Text style={styles.valueTitlePurple}>Know why it matters.</Text>
                  <Text style={styles.valueTitleBlue}>Know what to do next.</Text>
                  <Text style={styles.valueSubtitle}>
                    Live market intelligence, autonomous strategy, and continuous execution in one unified workspace.
                  </Text>
                </View>

                <View style={styles.pillarsGrid}>
                  <View style={styles.pillarItem}>
                    <View style={styles.pillarIconBox}>
                      <Ionicons name="shield-checkmark" size={16} color="#A78BFA" />
                    </View>
                    <View style={styles.pillarTextBox}>
                      <Text style={styles.pillarTitle}>Enterprise Security</Text>
                      <Text style={styles.pillarDetail}>SOC 2 Type II compliant & GDPR ready</Text>
                    </View>
                  </View>

                  <View style={styles.pillarItem}>
                    <View style={styles.pillarIconBox}>
                      <Ionicons name="bar-chart" size={16} color="#818CF8" />
                    </View>
                    <View style={styles.pillarTextBox}>
                      <Text style={styles.pillarTitle}>Market Intelligence</Text>
                      <Text style={styles.pillarDetail}>Real-time competitor & signal tracking</Text>
                    </View>
                  </View>

                  <View style={styles.pillarItem}>
                    <View style={styles.pillarIconBox}>
                      <Ionicons name="flash" size={16} color="#C084FC" />
                    </View>
                    <View style={styles.pillarTextBox}>
                      <Text style={styles.pillarTitle}>Strategic Engine</Text>
                      <Text style={styles.pillarDetail}>Continuous causal loop optimization</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#07040E',
  },
  mainLayout: {
    flex: 1,
    flexDirection: 'column',
  },
  desktopLayout: {
    flexDirection: 'row',
  },
  leftColumn: {
    flex: 1,
    backgroundColor: '#07040E',
    justifyContent: 'center',
  },
  leftColumnDesktop: {
    maxWidth: '48%',
    minWidth: 440,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
  },
  leftColumnMobile: {
    maxWidth: '100%',
  },
  scrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  contentWrapper: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },

  // Brand Header
  brandHeader: {
    marginBottom: 28,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginLeft: 10,
  },
  headerDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: 14,
  },
  taglineBox: {
    justifyContent: 'center',
  },
  taglineText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
    lineHeight: 14,
  },
  taglineSubText: {
    fontSize: 10,
    fontWeight: '400',
    color: '#64748B',
    lineHeight: 13,
  },

  // Eyebrow
  eyebrowContainer: {
    marginBottom: 16,
  },
  eyebrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  eyebrowText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A78BFA',
    letterSpacing: 1.2,
  },

  // Headline & Description
  headerTextBlock: {
    marginBottom: 28,
  },
  mainHeadline: {
    fontSize: 30,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  subHeadline: {
    fontSize: 16,
    fontWeight: '600',
    color: '#CBD5E1',
    lineHeight: 22,
    marginBottom: 10,
  },
  bodyDescription: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 22,
  },

  // Onboarding Steps Preview
  stepsSection: {
    marginBottom: 32,
  },
  stepsSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  stepsList: {
    gap: 8,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stepNumberBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  stepTextContainer: {
    flex: 1,
  },
  stepTitleText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 2,
  },
  stepDescText: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  stepTrailingIcon: {
    marginLeft: 8,
  },

  // Primary CTA
  ctaSection: {
    marginBottom: 28,
  },
  ctaButtonWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  ctaButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  ctaButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  ctaArrowIcon: {
    marginLeft: 2,
  },
  secondaryTimeNote: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 12,
    fontWeight: '400',
  },

  // Trust Footer
  trustFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  trustFooterText: {
    fontSize: 11,
    color: '#475569',
    textAlign: 'center',
  },

  // RIGHT COLUMN: HERO VISUAL
  rightColumn: {
    flex: 1,
    padding: 24,
    backgroundColor: '#07040E',
    justifyContent: 'center',
  },
  heroCardContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'flex-end',
    backgroundColor: '#0F0B1E',
  },
  heroContentInner: {
    padding: 40,
  },
  valueCard: {
    marginBottom: 32,
  },
  valueTitleWhite: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  valueTitlePurple: {
    fontSize: 28,
    fontWeight: '700',
    color: '#A78BFA',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  valueTitleBlue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#818CF8',
    letterSpacing: -0.6,
    lineHeight: 36,
    marginBottom: 16,
  },
  valueSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 22,
    maxWidth: 440,
  },
  pillarsGrid: {
    gap: 16,
  },
  pillarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,11,30,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 14,
  },
  pillarIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(124,58,237,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  pillarTextBox: {
    flex: 1,
  },
  pillarTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 2,
  },
  pillarDetail: {
    fontSize: 11,
    color: '#64748B',
  },
});
