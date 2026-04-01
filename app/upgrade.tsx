import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AvyronLogo from '@/components/AvyronLogo';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';

const STRIPE_PAYMENT_LINK = process.env.EXPO_PUBLIC_STRIPE_PAYMENT_LINK || '';

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const { logout, user, refreshUser } = useAuth();
  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'no_change'>('idle');

  const handleUpgrade = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (STRIPE_PAYMENT_LINK) {
      const url = user?.id
        ? `${STRIPE_PAYMENT_LINK}?client_reference_id=${user.id}`
        : STRIPE_PAYMENT_LINK;
      await Linking.openURL(url);
    }
  };

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshState('loading');
    try {
      await refreshUser();
      setTimeout(() => {
        setRefreshState('no_change');
        setTimeout(() => setRefreshState('idle'), 4000);
      }, 600);
    } catch {
      setRefreshState('no_change');
      setTimeout(() => setRefreshState('idle'), 4000);
    }
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await logout();
  };

  const features = [
    { icon: 'analytics-outline' as const, label: '15-engine strategic pipeline' },
    { icon: 'bulb-outline' as const, label: 'AI content creation & strategy' },
    { icon: 'people-outline' as const, label: 'Audience intelligence engine' },
    { icon: 'shield-checkmark-outline' as const, label: 'Full control center access' },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0F0B1E', '#1A1035', '#0F0B1E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.content, {
        paddingTop: Platform.OS === 'web' ? 80 : insets.top + 40,
        paddingBottom: Platform.OS === 'web' ? 60 : insets.bottom + 40,
      }]}>
        <View style={styles.topSection}>
          <View style={styles.logo}>
            <AvyronLogo size={46} />
          </View>
          <View style={styles.expiredBadge}>
            <Ionicons name="time-outline" size={14} color="#F59E0B" />
            <Text style={styles.expiredText}>Trial ended</Text>
          </View>
        </View>

        <View style={styles.mainSection}>
          <Text style={styles.headline}>Your system is ready.{'\n'}Activate it.</Text>
          <Text style={styles.subline}>
            Your marketing engine is built and waiting. Unlock full access to keep everything running.
          </Text>

          <View style={styles.featureList}>
            {features.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={styles.featureIconWrap}>
                  <Ionicons name={f.icon} size={18} color="#8B5CF6" />
                </View>
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.bottomSection}>
          {STRIPE_PAYMENT_LINK ? (
            <Pressable
              onPress={handleUpgrade}
              style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
              testID="upgrade-button"
            >
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.upgradeBtn}
              >
                <Ionicons name="diamond-outline" size={20} color="#fff" />
                <Text style={styles.upgradeBtnText}>Activate Full Access</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <View style={styles.setupNote}>
              <Ionicons name="information-circle-outline" size={18} color="#8B5CF6" />
              <Text style={styles.setupNoteText}>
                Payment setup in progress. Contact support for access.
              </Text>
            </View>
          )}

          <Pressable
            onPress={handleRefresh}
            disabled={refreshState === 'loading'}
            style={styles.refreshBtn}
            testID="refresh-status"
          >
            {refreshState === 'loading' ? (
              <ActivityIndicator size="small" color="#8B5CF6" />
            ) : (
              <Ionicons name="refresh-outline" size={16} color="#8B5CF6" />
            )}
            <Text style={styles.refreshText}>
              {refreshState === 'loading'
                ? 'Checking payment status...'
                : refreshState === 'no_change'
                ? 'Payment not yet received — try again shortly'
                : 'Already paid? Refresh status'}
            </Text>
          </Pressable>

          <Pressable onPress={handleLogout} style={styles.logoutBtn} testID="upgrade-logout">
            <Text style={styles.logoutText}>Sign out</Text>
          </Pressable>
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
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  topSection: {
    alignItems: 'center',
    gap: 16,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(124,58,237,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,158,11,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  expiredText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#F59E0B',
  },
  mainSection: {
    alignItems: 'center',
  },
  headline: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  featureList: {
    marginTop: 28,
    gap: 10,
    width: '100%',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.08)',
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(139,92,246,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#D1D5DB',
    flex: 1,
  },
  bottomSection: {
    alignItems: 'center',
    gap: 14,
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
    width: '100%',
  },
  upgradeBtnText: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
  setupNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139,92,246,0.08)',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.15)',
  },
  setupNoteText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#9CA3AF',
    flex: 1,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  refreshText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#8B5CF6',
  },
  logoutBtn: {
    paddingVertical: 8,
  },
  logoutText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
  },
});
