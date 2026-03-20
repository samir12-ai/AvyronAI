import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

export default function IntroScreen() {
  const insets = useSafeAreaInsets();
  const { markIntroSeen, trialDaysRemaining } = useAuth();

  const handleContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await markIntroSeen();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0F0B1E', '#1A1035', '#0F0B1E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      <View style={[styles.content, {
        paddingTop: Platform.OS === 'web' ? 100 : insets.top + 60,
        paddingBottom: Platform.OS === 'web' ? 60 : insets.bottom + 40,
      }]}>
        <View style={styles.topSection}>
          <Image
            source={require('@/assets/images/logo.jpeg')}
            style={styles.logo}
          />

          <View style={styles.trialBadge}>
            <Ionicons name="gift-outline" size={14} color="#8B5CF6" />
            <Text style={styles.trialBadgeText}>{trialDaysRemaining}-day free trial active</Text>
          </View>
        </View>

        <View style={styles.heroSection}>
          <Text style={styles.headline}>Build your marketing{'\n'}system with AI</Text>
          <Text style={styles.subline}>
            Strategy, content, and execution — powered by 15 intelligent engines working together.
          </Text>
        </View>

        <View style={styles.bottomSection}>
          <Pressable
            onPress={handleContinue}
            style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
            testID="intro-continue"
          >
            <LinearGradient
              colors={['#8B5CF6', '#7C3AED']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaButton}
            >
              <Text style={styles.ctaText}>Let's Go</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>

          <Text style={styles.footnote}>
            Full access during your trial · No credit card needed
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0B1E',
  },
  glowTop: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#8B5CF6',
    opacity: 0.06,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#7C3AED',
    opacity: 0.05,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  topSection: {
    alignItems: 'center',
    gap: 20,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 22,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(139,92,246,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.2)',
  },
  trialBadgeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8B5CF6',
  },
  heroSection: {
    alignItems: 'center',
  },
  headline: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  bottomSection: {
    alignItems: 'center',
    gap: 16,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 48,
    width: '100%',
  },
  ctaText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  footnote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    textAlign: 'center',
  },
});
