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
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvyronLogo from '@/components/AvyronLogo';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REMEMBER_ME_KEY = 'avyron_remember_email';

interface LoginScreenProps {
  initialMode?: 'login' | 'signup';
}

export default function LoginScreen({ initialMode = 'login' }: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;

  const { login, register, setIsAddingAccount } = useAuth();
  const { addAccount, mode: paramMode } = useLocalSearchParams<{ addAccount?: string; mode?: string }>();
  const isAddingAccount = addAccount === '1';

  const [mode, setMode] = useState<'login' | 'signup'>(
    paramMode === 'signup' || initialMode === 'signup' ? 'signup' : 'login'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, useNativeDriver: false }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, useNativeDriver: false }),
    ]).start();

    AsyncStorage.getItem(REMEMBER_ME_KEY).then((saved) => {
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    }).catch(() => {});

    return () => {
      setIsAddingAccount(false);
    };
  }, []);

  const validateEmail = (val: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
  };

  const handleSubmit = async () => {
    if (isLoading) return;

    setError('');
    setInfoMessage('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!validateEmail(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setError('Password is required.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup') {
      if (confirmPassword && password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    setIsLoading(true);

    try {
      if (rememberMe && cleanEmail) {
        await AsyncStorage.setItem(REMEMBER_ME_KEY, cleanEmail);
      } else {
        await AsyncStorage.removeItem(REMEMBER_ME_KEY);
      }

      if (mode === 'login') {
        const result = await login(cleanEmail, password);
        setIsLoading(false);

        if (result.success) {
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          if (isAddingAccount) {
            setIsAddingAccount(false);
            router.replace('/(tabs)');
          }
        } else {
          setError(result.error || 'Invalid email or password. Please try again.');
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        }
      } else {
        const result = await register(cleanEmail, password, name.trim() || undefined);
        setIsLoading(false);

        if (result.success) {
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          router.replace('/intro');
        } else {
          setError(result.error || 'Registration failed. Please try again.');
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        }
      }
    } catch (err: any) {
      setIsLoading(false);
      setError('Connection error. Please check your network and try again.');
    }
  };

  const handleForgotPassword = () => {
    setInfoMessage('To reset your credentials, please contact support@avyron.ai or your workspace administrator.');
  };

  const toggleMode = () => {
    setError('');
    setInfoMessage('');
    setMode((prev) => (prev === 'login' ? 'signup' : 'login'));
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
  };

  const handleCancelAddAccount = () => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setIsAddingAccount(false);
    router.back();
  };

  return (
    <View style={styles.rootContainer}>
      <View style={[styles.mainLayout, isDesktop && styles.desktopLayout]}>
        
        {/* LEFT COLUMN: AUTHENTICATION FORM */}
        <View style={[styles.leftColumn, isDesktop ? styles.leftColumnDesktop : styles.leftColumnMobile]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            <ScrollView
              contentContainerStyle={[
                styles.scrollInner,
                {
                  paddingTop: Platform.OS === 'web' ? (isDesktop ? 48 : 32) : insets.top + 24,
                  paddingBottom: insets.bottom + 32,
                },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Animated.View
                style={[
                  styles.formWrapper,
                  {
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                  },
                ]}
              >
                {/* Top-left Brand Logo & Descriptor */}
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

                {/* Cancel add account banner */}
                {isAddingAccount && (
                  <Pressable onPress={handleCancelAddAccount} style={styles.backRow}>
                    <Ionicons name="arrow-back" size={16} color="#94A3B8" />
                    <Text style={styles.backText}>Cancel and return</Text>
                  </Pressable>
                )}

                {/* Main Auth Headline & Subtitle */}
                <View style={styles.headerTextBlock}>
                  <Text style={styles.mainHeadline}>
                    {isAddingAccount
                      ? 'Add another account'
                      : mode === 'login'
                      ? 'Welcome back'
                      : 'Create your account'}
                  </Text>
                  <Text style={styles.subHeadline}>
                    {isAddingAccount
                      ? 'Authenticate with your additional workspace credentials.'
                      : mode === 'login'
                      ? 'Sign in to access your Avyron workspace.'
                      : 'Start your 7-day trial. No credit card required.'}
                  </Text>
                </View>

                {/* Error Banner */}
                {error ? (
                  <View style={styles.errorContainer} testID="auth-error-banner">
                    <Ionicons name="alert-circle" size={18} color="#F87171" style={styles.errorIcon} />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Info / Forgot Password Notice */}
                {infoMessage ? (
                  <View style={styles.infoContainer}>
                    <Ionicons name="information-circle-outline" size={18} color="#A78BFA" style={styles.errorIcon} />
                    <Text style={styles.infoText}>{infoMessage}</Text>
                  </View>
                ) : null}

                {/* FORM FIELDS */}
                <View style={styles.fieldsContainer}>
                  {/* Full Name field (Signup mode only) */}
                  {mode === 'signup' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>Full name</Text>
                      <View
                        style={[
                          styles.inputContainer,
                          nameFocused && styles.inputContainerFocused,
                        ]}
                      >
                        <Ionicons
                          name="person-outline"
                          size={18}
                          color={nameFocused ? '#A78BFA' : '#64748B'}
                          style={styles.fieldIcon}
                        />
                        <TextInput
                          style={styles.textInput}
                          value={name}
                          onChangeText={setName}
                          placeholder="Enter your full name"
                          placeholderTextColor="#475569"
                          autoCapitalize="words"
                          autoComplete="name"
                          onFocus={() => setNameFocused(true)}
                          onBlur={() => setNameFocused(false)}
                          testID="name-input"
                        />
                      </View>
                    </View>
                  )}

                  {/* Email address field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.fieldLabel}>Email address</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        emailFocused && styles.inputContainerFocused,
                      ]}
                    >
                      <Ionicons
                        name="mail-outline"
                        size={18}
                        color={emailFocused ? '#A78BFA' : '#64748B'}
                        style={styles.fieldIcon}
                      />
                      <TextInput
                        style={styles.textInput}
                        value={email}
                        onChangeText={setEmail}
                        placeholder="Enter your email"
                        placeholderTextColor="#475569"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => setEmailFocused(false)}
                        onSubmitEditing={handleSubmit}
                        testID="email-input"
                      />
                    </View>
                  </View>

                  {/* Password field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        passwordFocused && styles.inputContainerFocused,
                      ]}
                    >
                      <Ionicons
                        name="lock-closed-outline"
                        size={18}
                        color={passwordFocused ? '#A78BFA' : '#64748B'}
                        style={styles.fieldIcon}
                      />
                      <TextInput
                        style={[styles.textInput, { flex: 1 }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder={mode === 'signup' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
                        placeholderTextColor="#475569"
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        onFocus={() => setPasswordFocused(true)}
                        onBlur={() => setPasswordFocused(false)}
                        onSubmitEditing={handleSubmit}
                        testID="password-input"
                      />
                      <Pressable
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.eyeButton}
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        hitSlop={8}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={18}
                          color={passwordFocused ? '#A78BFA' : '#64748B'}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Confirm Password (Signup mode only) */}
                  {mode === 'signup' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>Confirm password</Text>
                      <View
                        style={[
                          styles.inputContainer,
                          confirmPasswordFocused && styles.inputContainerFocused,
                        ]}
                      >
                        <Ionicons
                          name="lock-closed-outline"
                          size={18}
                          color={confirmPasswordFocused ? '#A78BFA' : '#64748B'}
                          style={styles.fieldIcon}
                        />
                        <TextInput
                          style={[styles.textInput, { flex: 1 }]}
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                          placeholder="Confirm your password"
                          placeholderTextColor="#475569"
                          secureTextEntry={!showConfirmPassword}
                          autoCapitalize="none"
                          autoCorrect={false}
                          onFocus={() => setConfirmPasswordFocused(true)}
                          onBlur={() => setConfirmPasswordFocused(false)}
                          onSubmitEditing={handleSubmit}
                          testID="confirm-password-input"
                        />
                        <Pressable
                          onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                          style={styles.eyeButton}
                          accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                          hitSlop={8}
                        >
                          <Ionicons
                            name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={18}
                            color={confirmPasswordFocused ? '#A78BFA' : '#64748B'}
                          />
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Options row (Remember me & Forgot password) */}
                  {mode === 'login' && (
                    <View style={styles.optionsRow}>
                      <Pressable
                        onPress={() => setRememberMe(!rememberMe)}
                        style={styles.rememberMeContainer}
                        hitSlop={4}
                      >
                        <View style={[styles.customCheckbox, rememberMe && styles.customCheckboxChecked]}>
                          {rememberMe && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                        </View>
                        <Text style={styles.rememberMeLabel}>Remember me</Text>
                      </Pressable>

                      <Pressable onPress={handleForgotPassword} hitSlop={6}>
                        <Text style={styles.forgotPasswordLink}>Forgot password?</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Primary CTA Button */}
                  <Pressable
                    onPress={handleSubmit}
                    disabled={isLoading}
                    style={({ pressed }) => [
                      styles.submitButtonWrapper,
                      { opacity: pressed ? 0.9 : 1 },
                      isLoading && styles.submitButtonDisabled,
                    ]}
                    testID="submit-button"
                  >
                    <LinearGradient
                      colors={['#7C3AED', '#6D28D9']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.submitGradient}
                    >
                      {isLoading ? (
                        <View style={styles.buttonLoadingRow}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.submitButtonText}>
                            {mode === 'login' ? 'Signing in…' : 'Creating account…'}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.buttonTextRow}>
                          <Text style={styles.submitButtonText}>
                            {mode === 'login' ? 'Sign in' : 'Create account'}
                          </Text>
                          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={styles.buttonArrow} />
                        </View>
                      )}
                    </LinearGradient>
                  </Pressable>
                </View>

                {/* Switch Mode Link */}
                <View style={styles.switchModeContainer}>
                  <Text style={styles.switchModeText}>
                    {mode === 'login'
                      ? "Don't have an account? "
                      : 'Already have an account? '}
                  </Text>
                  <Pressable onPress={toggleMode} testID="toggle-mode" hitSlop={6}>
                    <Text style={styles.switchModeLink}>
                      {mode === 'login' ? 'Create account' : 'Sign in'}
                    </Text>
                  </Pressable>
                </View>

                {/* Minimal Trust Indicator */}
                <View style={styles.trustFooter}>
                  <Ionicons name="shield-checkmark-outline" size={13} color="#475569" style={{ marginRight: 6 }} />
                  <Text style={styles.trustFooterText}>
                    Enterprise-grade encryption · SOC 2 & GDPR compliant architecture
                  </Text>
                </View>
              </Animated.View>
            </ScrollView>
          </KeyboardAvoidingView>
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  formWrapper: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },

  // Brand Header
  brandHeader: {
    marginBottom: 36,
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

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  backText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },

  // Headline
  headerTextBlock: {
    marginBottom: 24,
  },
  mainHeadline: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.6,
    marginBottom: 8,
  },
  subHeadline: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
  },

  // Banners
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  errorIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#F87171',
    lineHeight: 18,
    fontWeight: '500',
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#C4B5FD',
    lineHeight: 18,
    fontWeight: '500',
  },

  // Fields
  fieldsContainer: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    letterSpacing: -0.1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F0B1E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
  },
  inputContainerFocused: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124,58,237,0.04)',
  },
  fieldIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#FFFFFF',
    height: '100%',
    paddingVertical: 0,
    outlineStyle: 'none' as any,
  },
  eyeButton: {
    padding: 4,
    marginLeft: 6,
  },

  // Options row
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 4,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customCheckboxChecked: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  rememberMeLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '400',
  },
  forgotPasswordLink: {
    fontSize: 13,
    fontWeight: '500',
    color: '#A78BFA',
  },

  // Primary Button
  submitButtonWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitGradient: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  buttonArrow: {
    marginLeft: 2,
  },

  // Switch mode footer
  switchModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  switchModeText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  switchModeLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
  },

  // Trust footer
  trustFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  trustFooterText: {
    fontSize: 11,
    color: '#475569',
    letterSpacing: 0.1,
  },

  // RIGHT COLUMN (HERO VISUAL)
  rightColumn: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  heroCardContainer: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    position: 'relative',
    justifyContent: 'flex-end',
    padding: 36,
  },
  heroContentInner: {
    gap: 24,
    maxWidth: 580,
  },
  valueCard: {
    backgroundColor: 'rgba(10,8,22,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: 24,
  },
  valueTitleWhite: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  valueTitlePurple: {
    fontSize: 22,
    fontWeight: '700',
    color: '#C084FC',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  valueTitleBlue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#60A5FA',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  valueSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 12,
    lineHeight: 19,
  },

  // Bottom 3 Pillars
  pillarsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  pillarItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,8,22,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  pillarIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(124,58,237,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillarTextBox: {
    flex: 1,
  },
  pillarTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 2,
  },
  pillarDetail: {
    fontSize: 10,
    color: '#64748B',
    lineHeight: 13,
  },
});
