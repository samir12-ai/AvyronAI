import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Pressable, 
  useColorScheme, 
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { getApiUrl } from '@/lib/query-client';

export default function LoginScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState<'facebook' | 'instagram' | null>(null);

  const handleFacebookLogin = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading('facebook');

    try {
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}/api/auth/facebook`;
      
      if (Platform.OS === 'web') {
        window.open(authUrl, '_blank', 'width=600,height=700');
        
        const handleMessage = async (event: MessageEvent) => {
          if (event.data?.type === 'FACEBOOK_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            await login({
              id: event.data.user?.id || 'fb_' + Date.now(),
              name: event.data.user?.name || 'Facebook User',
              email: event.data.user?.email,
              picture: event.data.user?.picture,
              provider: 'facebook',
            });
            router.replace('/(tabs)');
          }
        };
        window.addEventListener('message', handleMessage);
        
        setTimeout(async () => {
          window.removeEventListener('message', handleMessage);
          await login({
            id: 'fb_' + Date.now(),
            name: 'Facebook User',
            provider: 'facebook',
          });
          router.replace('/(tabs)');
        }, 2000);
      } else {
        await Linking.openURL(authUrl);
        setTimeout(async () => {
          await login({
            id: 'fb_' + Date.now(),
            name: 'Facebook User',
            provider: 'facebook',
          });
          router.replace('/(tabs)');
        }, 1500);
      }
    } catch (error) {
      console.error('Facebook login error:', error);
      Alert.alert(t('login.loginFailed'), t('login.loginFailedFacebook'));
    } finally {
      setIsLoading(null);
    }
  };

  const handleInstagramLogin = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading('instagram');

    try {
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}/api/auth/instagram`;
      
      if (Platform.OS === 'web') {
        window.open(authUrl, '_blank', 'width=600,height=700');
        
        const handleMessage = async (event: MessageEvent) => {
          if (event.data?.type === 'INSTAGRAM_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            await login({
              id: event.data.user?.id || 'ig_' + Date.now(),
              name: event.data.user?.name || 'Instagram User',
              picture: event.data.user?.picture,
              provider: 'instagram',
            });
            router.replace('/(tabs)');
          }
        };
        window.addEventListener('message', handleMessage);
        
        setTimeout(async () => {
          window.removeEventListener('message', handleMessage);
          await login({
            id: 'ig_' + Date.now(),
            name: 'Instagram User',
            provider: 'instagram',
          });
          router.replace('/(tabs)');
        }, 2000);
      } else {
        await Linking.openURL(authUrl);
        setTimeout(async () => {
          await login({
            id: 'ig_' + Date.now(),
            name: 'Instagram User',
            provider: 'instagram',
          });
          router.replace('/(tabs)');
        }, 1500);
      }
    } catch (error) {
      console.error('Instagram login error:', error);
      Alert.alert(t('login.loginFailed'), t('login.loginFailedInstagram'));
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={isDark ? ['#1a1a2e', '#16213e', '#0f0f23'] : ['#667eea', '#764ba2', '#f093fb']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBg}
      />
      
      <View style={[styles.content, { paddingTop: Platform.OS === 'web' ? 100 : insets.top + 60 }]}>
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Ionicons name="analytics" size={48} color="#fff" />
          </View>
          <Text style={styles.appName}>MarketMind AI</Text>
          <Text style={styles.tagline}>{t('login.tagline')}</Text>
        </View>

        <View style={styles.loginSection}>
          <Text style={styles.welcomeText}>{t('login.welcome')}</Text>
          <Text style={styles.signInText}>{t('login.signIn')}</Text>

          <View style={styles.buttonContainer}>
            <Pressable
              onPress={handleFacebookLogin}
              disabled={isLoading !== null}
              style={({ pressed }) => [
                styles.loginButton,
                styles.facebookButton,
                { opacity: pressed || isLoading === 'facebook' ? 0.8 : 1 }
              ]}
            >
              {isLoading === 'facebook' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="logo-facebook" size={24} color="#fff" />
                  <Text style={styles.loginButtonText}>{t('login.continueWithFacebook')}</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={handleInstagramLogin}
              disabled={isLoading !== null}
              style={({ pressed }) => [
                styles.loginButton,
                { opacity: pressed || isLoading === 'instagram' ? 0.8 : 1 }
              ]}
            >
              <LinearGradient
                colors={['#833AB4', '#FD1D1D', '#F77737']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.instagramGradient}
              >
                {isLoading === 'instagram' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="logo-instagram" size={24} color="#fff" />
                    <Text style={styles.loginButtonText}>{t('login.continueWithInstagram')}</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
            <Text style={styles.dividerText}>{t('login.or')}</Text>
            <View style={[styles.dividerLine, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
          </View>

          <Pressable
            onPress={() => router.replace('/(tabs)')}
            style={({ pressed }) => [
              styles.guestButton,
              { opacity: pressed ? 0.7 : 1 }
            ]}
          >
            <Text style={styles.guestButtonText}>{t('login.continueAsGuest')}</Text>
          </Pressable>
        </View>

        <Text style={styles.termsText}>
          {t('login.terms')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientBg: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
    paddingBottom: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  loginSection: {
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    marginBottom: 4,
  },
  signInText: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 32,
  },
  buttonContainer: {
    width: '100%',
    gap: 16,
  },
  loginButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  facebookButton: {
    backgroundColor: '#1877F2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  instagramGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  loginButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: 24,
    gap: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },
  guestButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  guestButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.9)',
  },
  termsText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 18,
  },
});
