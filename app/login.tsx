import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvyronLogo from '@/components/AvyronLogo';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, register, setIsAddingAccount } = useAuth();
  const { addAccount } = useLocalSearchParams<{ addAccount?: string }>();
  const isAddingAccount = addAccount === '1';
  const { t } = useLanguage();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Fade-in on mount
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
    return () => { setIsAddingAccount(false); };
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError(t('loginPage.errorRequired'));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);
    setError('');
    const result = mode === 'login'
      ? await login(email.trim(), password)
      : await register(email.trim(), password);
    setIsLoading(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (isAddingAccount) { setIsAddingAccount(false); router.replace('/(tabs)'); }
    } else {
      setError(result.error || t('loginPage.errorGeneric'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleCancel = () => {
    Haptics.selectionAsync();
    setIsAddingAccount(false);
    router.back();
  };

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login');
    setError('');
    Haptics.selectionAsync();
  };

  return (
    <View style={styles.container}>
      {/* Deep background */}
      <LinearGradient
        colors={['#080612', '#0C0A1A', '#0A0818']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Top-right violet orb */}
      <View style={styles.orbTopRight} />
      {/* Bottom-left indigo orb */}
      <View style={styles.orbBottomLeft} />
      {/* Center soft ambient */}
      <View style={styles.orbCenter} />

      {/* Subtle grid lines (decorative) */}
      <View style={styles.gridLine1} />
      <View style={styles.gridLine2} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Platform.OS === 'web' ? 60 : insets.top + 32, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

            {/* Logo section */}
            <View style={styles.logoSection}>
              {/* Outer glow ring */}
              <View style={styles.logoRingOuter}>
                <View style={styles.logoRingInner}>
                  <LinearGradient
                    colors={['rgba(139,92,246,0.20)', 'rgba(109,40,217,0.08)']}
                    style={styles.logoGradientBox}
                  >
                    <AvyronLogo size={48} />
                  </LinearGradient>
                </View>
              </View>

              <Text style={styles.brandName}>Avyron</Text>
              <View style={styles.taglineRow}>
                <View style={styles.taglineLine} />
                <Text style={styles.brandSub}>{t('loginPage.brandSub')}</Text>
                <View style={styles.taglineLine} />
              </View>
            </View>

            {/* Cancel row */}
            {isAddingAccount && (
              <Pressable onPress={handleCancel} style={styles.cancelRow}>
                <Ionicons name="arrow-back" size={16} color="#6B7280" />
                <Text style={styles.cancelText}>{t('loginPage.cancel')}</Text>
              </Pressable>
            )}

            {/* Form card — glass morphism */}
            {/* Gradient border wrapper */}
            <LinearGradient
              colors={['rgba(139,92,246,0.35)', 'rgba(139,92,246,0.06)', 'rgba(79,70,229,0.20)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardBorderGradient}
            >
              <View style={styles.formCard}>
                {/* Card inner header accent */}
                <View style={styles.cardHeaderAccent} />

                <Text style={styles.formTitle}>
                  {isAddingAccount ? t('loginPage.addAccount') : mode === 'login' ? t('loginPage.welcomeBack') : t('loginPage.getStarted')}
                </Text>
                <Text style={styles.formSubtitle}>
                  {isAddingAccount ? t('loginPage.addAccountDesc') : mode === 'login' ? t('loginPage.welcomeBackDesc') : t('loginPage.getStartedDesc')}
                </Text>

                {/* Error */}
                {error ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle" size={15} color="#F87171" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Email input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('loginPage.email')}</Text>
                  <LinearGradient
                    colors={emailFocused
                      ? ['rgba(139,92,246,0.5)', 'rgba(109,40,217,0.3)']
                      : ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.04)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.inputBorderGradient}
                  >
                    <View style={[styles.inputWrap, emailFocused && styles.inputWrapFocused]}>
                      <Ionicons
                        name="mail-outline"
                        size={16}
                        color={emailFocused ? '#A78BFA' : '#4B5563'}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        value={email}
                        onChangeText={setEmail}
                        placeholder={t('loginPage.emailPlaceholder')}
                        placeholderTextColor="#374151"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => setEmailFocused(false)}
                        testID="email-input"
                      />
                    </View>
                  </LinearGradient>
                </View>

                {/* Password input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('loginPage.password')}</Text>
                  <LinearGradient
                    colors={passwordFocused
                      ? ['rgba(139,92,246,0.5)', 'rgba(109,40,217,0.3)']
                      : ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.04)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.inputBorderGradient}
                  >
                    <View style={[styles.inputWrap, passwordFocused && styles.inputWrapFocused]}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={16}
                        color={passwordFocused ? '#A78BFA' : '#4B5563'}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder={mode === 'signup' ? t('loginPage.passwordPlaceholderSignup') : t('loginPage.passwordPlaceholderLogin')}
                        placeholderTextColor="#374151"
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        onFocus={() => setPasswordFocused(true)}
                        onBlur={() => setPasswordFocused(false)}
                        testID="password-input"
                      />
                      <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={16}
                          color={passwordFocused ? '#A78BFA' : '#4B5563'}
                        />
                      </Pressable>
                    </View>
                  </LinearGradient>
                </View>

                {/* Submit button */}
                <Pressable
                  onPress={handleSubmit}
                  disabled={isLoading}
                  style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
                  testID="submit-button"
                >
                  {/* Outer glow layer */}
                  <View style={styles.btnGlowWrap}>
                    <LinearGradient
                      colors={['#9333EA', '#7C3AED', '#6D28D9']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.submitBtn}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="rgba(255,255,255,0.9)" size="small" />
                      ) : (
                        <View style={styles.submitBtnInner}>
                          <Text style={styles.submitText}>
                            {mode === 'login' ? t('loginPage.signIn') : t('loginPage.createAccount')}
                          </Text>
                          <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.8)" />
                        </View>
                      )}
                    </LinearGradient>
                  </View>
                </Pressable>

                {mode === 'signup' && (
                  <Text style={styles.trialNote}>{t('loginPage.trialNote')}</Text>
                )}
              </View>
            </LinearGradient>

            {/* Toggle row */}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleText}>
                {mode === 'login' ? t('loginPage.toggleToSignup') : t('loginPage.toggleToLogin')}
              </Text>
              <Pressable onPress={toggleMode} testID="toggle-mode">
                <Text style={styles.toggleLink}>
                  {mode === 'login' ? t('loginPage.linkSignUp') : t('loginPage.linkSignIn')}
                </Text>
              </Pressable>
            </View>

            {/* Bottom trust badge */}
            <View style={styles.trustRow}>
              <Ionicons name="shield-checkmark-outline" size={12} color="#374151" />
              <Text style={styles.trustText}>256-bit encrypted · No card required</Text>
            </View>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080612',
  },

  // Ambient orbs
  orbTopRight: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: '#7C3AED',
    opacity: 0.11,
    // soft blur simulated by large radius
  },
  orbBottomLeft: {
    position: 'absolute',
    bottom: -140,
    left: -100,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#4F46E5',
    opacity: 0.09,
  },
  orbCenter: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#6D28D9',
    opacity: 0.04,
  },

  // Decorative grid lines
  gridLine1: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '33%',
    width: 1,
    backgroundColor: 'rgba(139,92,246,0.04)',
  },
  gridLine2: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 1,
    backgroundColor: 'rgba(139,92,246,0.04)',
  },

  keyboardView: { flex: 1 },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  // Logo section
  logoSection: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoRingOuter: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: 'rgba(139,92,246,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.12)',
  },
  logoRingInner: {
    width: 80,
    height: 80,
    borderRadius: 22,
    overflow: 'hidden',
  },
  logoGradientBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    marginBottom: 10,
  },
  taglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  taglineLine: {
    width: 24,
    height: 1,
    backgroundColor: 'rgba(139,92,246,0.4)',
  },
  brandSub: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#7C3AED',
    letterSpacing: 5,
  },

  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    paddingVertical: 4,
  },
  cancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#6B7280',
  },

  // Card gradient border
  cardBorderGradient: {
    borderRadius: 26,
    padding: 1,
  },
  formCard: {
    backgroundColor: 'rgba(13,10,28,0.92)',
    borderRadius: 25,
    padding: 28,
    overflow: 'hidden',
  },
  cardHeaderAccent: {
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 1,
    backgroundColor: 'rgba(139,92,246,0.5)',
  },
  formTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F9FAFB',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  formSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginBottom: 24,
    lineHeight: 19,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.18)',
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#F87171',
    flex: 1,
  },

  // Inputs
  inputGroup: { marginBottom: 16 },
  inputLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#6B7280',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  inputBorderGradient: {
    borderRadius: 14,
    padding: 1,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(9,7,20,0.95)',
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  inputWrapFocused: {
    backgroundColor: 'rgba(13,10,28,0.98)',
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#E5E7EB',
    paddingVertical: 14,
  },
  eyeBtn: {
    padding: 6,
    marginLeft: 4,
  },

  // Submit button
  btnGlowWrap: {
    borderRadius: 15,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
  },
  submitBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  trialNote: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#7C3AED',
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: 0.2,
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
  },
  toggleText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
  },
  toggleLink: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#8B5CF6',
  },

  // Trust badge
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
  },
  trustText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#374151',
    letterSpacing: 0.2,
  },
});
