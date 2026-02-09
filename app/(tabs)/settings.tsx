import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  TextInput,
  Pressable,
  Alert,
  Switch,
  Linking,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '@/lib/i18n';
import { PlatformConnection } from '@/components/PlatformConnection';
import { getApiUrl } from '@/lib/query-client';
import { router } from 'expo-router';

const platformIcons: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  instagram: { icon: 'logo-instagram', color: '#E1306C' },
  facebook: { icon: 'logo-facebook', color: '#1877F2' },
  twitter: { icon: 'logo-twitter', color: '#1DA1F2' },
  linkedin: { icon: 'logo-linkedin', color: '#0A66C2' },
  tiktok: { icon: 'musical-notes', color: '#000000' },
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { 
    brandProfile, 
    setBrandProfile, 
    platformConnections, 
    updatePlatformConnection,
    postingSchedules,
    updatePostingSchedule,
    metaConnection,
    setMetaConnection,
  } = useApp();
  const { user, logout } = useAuth();
  const { t, locale, setLocale, languages } = useLanguage();

  const [name, setName] = useState(brandProfile.name);
  const [industry, setIndustry] = useState(brandProfile.industry);
  const [tone, setTone] = useState(brandProfile.tone);
  const [targetAudience, setTargetAudience] = useState(brandProfile.targetAudience);
  const [platforms, setPlatforms] = useState<string[]>(brandProfile.platforms);
  const [hasChanges, setHasChanges] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const toneOptions = [
    { key: 'Professional', label: t('settings.professional') },
    { key: 'Casual', label: t('settings.casual') },
    { key: 'Friendly', label: t('settings.friendly') },
    { key: 'Authoritative', label: t('settings.authoritative') },
    { key: 'Playful', label: t('settings.playfulTone') },
    { key: 'Inspirational', label: t('settings.inspirational') },
  ];

  const currentLanguage = SUPPORTED_LANGUAGES.find(l => l.code === locale);

  useEffect(() => {
    setName(brandProfile.name);
    setIndustry(brandProfile.industry);
    setTone(brandProfile.tone);
    setTargetAudience(brandProfile.targetAudience);
    setPlatforms(brandProfile.platforms);
  }, [brandProfile]);

  useEffect(() => {
    const changed = 
      name !== brandProfile.name ||
      industry !== brandProfile.industry ||
      tone !== brandProfile.tone ||
      targetAudience !== brandProfile.targetAudience ||
      JSON.stringify(platforms) !== JSON.stringify(brandProfile.platforms);
    setHasChanges(changed);
  }, [name, industry, tone, targetAudience, platforms, brandProfile]);

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setBrandProfile({
      name,
      industry,
      tone,
      targetAudience,
      platforms,
    });
    setHasChanges(false);
    Alert.alert(t('settings.saved'), t('settings.profileUpdated'));
  };

  const handleConnect = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updatePlatformConnection(id, true);
  };

  const handleDisconnect = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updatePlatformConnection(id, false);
  };

  const handleScheduleToggle = (platform: string, enabled: boolean) => {
    const schedule = postingSchedules.find(s => s.platform === platform);
    if (schedule) {
      updatePostingSchedule({ ...schedule, enabled });
    }
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (Platform.OS === 'web') {
      const confirmed = window.confirm(t('settings.signOutConfirm'));
      if (confirmed) {
        await logout();
        router.replace('/login');
      }
    } else {
      Alert.alert(
        t('settings.signOut'),
        t('settings.signOutConfirm'),
        [
          { text: t('settings.cancel'), style: 'cancel' },
          { 
            text: t('settings.signOut'), 
            style: 'destructive',
            onPress: async () => {
              await logout();
              router.replace('/login');
            }
          },
        ]
      );
    }
  };

  const handleConnectMeta = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    try {
      const apiUrl = getApiUrl();
      const authUrl = `${apiUrl}/api/meta/auth`;
      
      if (Platform.OS === 'web') {
        window.open(authUrl, '_blank', 'width=600,height=700');
      } else {
        await Linking.openURL(authUrl);
      }

      setTimeout(async () => {
        await setMetaConnection({
          isConnected: true,
          pageName: 'Your Business Page',
          connectedAt: new Date().toISOString(),
        });
        
        updatePlatformConnection('facebook', true);
        updatePlatformConnection('instagram', true);
        
        Alert.alert(
          t('settings.metaConnected'),
          t('settings.metaConnectedDesc')
        );
      }, 1000);
    } catch (error) {
      console.error('Meta connection error:', error);
      Alert.alert(t('settings.connectionError'), t('settings.connectionErrorDesc'));
    }
  };

  const handleDisconnectMeta = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    await setMetaConnection({ isConnected: false });
    updatePlatformConnection('facebook', false);
    updatePlatformConnection('instagram', false);
    
    Alert.alert(t('settings.disconnected'), t('settings.metaDisconnected'));
  };

  const handleSelectLanguage = async (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setLocale(code as any);
    setShowLanguageModal(false);
  };

  const connectedCount = platformConnections.filter(p => p.isConnected).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('settings.subtitle')}
        </Text>

        {user && (
          <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.userInfo}>
              <View style={[styles.userAvatar, { backgroundColor: user.provider === 'facebook' ? '#1877F2' : '#E1306C' }]}>
                <Ionicons 
                  name={user.provider === 'facebook' ? 'logo-facebook' : 'logo-instagram'} 
                  size={24} 
                  color="#fff" 
                />
              </View>
              <View style={styles.userDetails}>
                <Text style={[styles.userName, { color: colors.text }]}>{user.name}</Text>
                <Text style={[styles.userProvider, { color: colors.textMuted }]}>
                  {t('settings.signedInWith', { provider: user.provider === 'facebook' ? 'Facebook' : 'Instagram' })}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleLogout}
              style={({ pressed }) => [
                styles.logoutButton,
                { backgroundColor: colors.error + '15', opacity: pressed ? 0.7 : 1 }
              ]}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
              <Text style={[styles.logoutText, { color: colors.error }]}>{t('settings.signOut')}</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setShowLanguageModal(true);
          }}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="globe-outline" size={20} color={colors.primary} />
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.language')}</Text>
              </View>
              <View style={styles.languageSelector}>
                <Text style={[styles.languageFlag, { color: colors.text }]}>{currentLanguage?.flag}</Text>
                <Text style={[styles.languageName, { color: colors.textSecondary }]}>{currentLanguage?.nativeName}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </View>
            <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
              {t('settings.languageDesc')}
            </Text>
          </View>
        </Pressable>

        <View style={[styles.metaCard, { backgroundColor: isDark ? '#1E3A5F' : '#E7F3FF', borderColor: '#1877F2' }]}>
          <View style={styles.metaHeader}>
            <View style={styles.metaLogoRow}>
              <View style={[styles.metaLogo, { backgroundColor: '#1877F2' }]}>
                <Ionicons name="logo-facebook" size={24} color="#fff" />
              </View>
              <View>
                <Text style={[styles.metaTitle, { color: colors.text }]}>{t('settings.metaBusinessSuite')}</Text>
                <Text style={[styles.metaSubtitle, { color: colors.textSecondary }]}>
                  {t('settings.facebookInstagram')}
                </Text>
              </View>
            </View>
            {metaConnection.isConnected && (
              <View style={[styles.connectedBadge, { backgroundColor: colors.success + '20' }]}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={[styles.connectedText, { color: colors.success }]}>{t('settings.connected')}</Text>
              </View>
            )}
          </View>

          {metaConnection.isConnected ? (
            <View style={styles.metaConnectedInfo}>
              <View style={[styles.metaInfoRow, { backgroundColor: colors.card }]}>
                <Ionicons name="business" size={18} color="#1877F2" />
                <Text style={[styles.metaInfoText, { color: colors.text }]}>
                  {metaConnection.pageName || t('settings.businessPageConnected')}
                </Text>
              </View>
              <View style={styles.metaFeatures}>
                <View style={styles.metaFeature}>
                  <Ionicons name="checkmark" size={16} color={colors.success} />
                  <Text style={[styles.metaFeatureText, { color: colors.textSecondary }]}>{t('settings.autoPostFacebook')}</Text>
                </View>
                <View style={styles.metaFeature}>
                  <Ionicons name="checkmark" size={16} color={colors.success} />
                  <Text style={[styles.metaFeatureText, { color: colors.textSecondary }]}>{t('settings.autoPostInstagram')}</Text>
                </View>
                <View style={styles.metaFeature}>
                  <Ionicons name="checkmark" size={16} color={colors.success} />
                  <Text style={[styles.metaFeatureText, { color: colors.textSecondary }]}>{t('settings.manageAds')}</Text>
                </View>
              </View>
              <Pressable
                onPress={handleDisconnectMeta}
                style={[styles.disconnectButton, { backgroundColor: colors.error + '20' }]}
              >
                <Ionicons name="unlink" size={16} color={colors.error} />
                <Text style={[styles.disconnectText, { color: colors.error }]}>{t('settings.disconnect')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.metaConnectSection}>
              <Text style={[styles.metaDescription, { color: colors.textSecondary }]}>
                {t('settings.connectMetaDesc')}
              </Text>
              <View style={styles.metaBenefits}>
                <View style={styles.metaBenefit}>
                  <Ionicons name="flash" size={16} color="#1877F2" />
                  <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.autoPostScheduled')}</Text>
                </View>
                <View style={styles.metaBenefit}>
                  <Ionicons name="analytics" size={16} color="#1877F2" />
                  <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.crossPlatformAdMgmt')}</Text>
                </View>
                <View style={styles.metaBenefit}>
                  <Ionicons name="sync" size={16} color="#1877F2" />
                  <Text style={[styles.metaBenefitText, { color: colors.text }]}>{t('settings.unifiedPublishing')}</Text>
                </View>
              </View>
              <Pressable
                onPress={handleConnectMeta}
                style={({ pressed }) => [styles.metaConnectButton, { opacity: pressed ? 0.8 : 1 }]}
              >
                <LinearGradient
                  colors={['#1877F2', '#0D65D9']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.metaGradient}
                >
                  <Ionicons name="link" size={20} color="#fff" />
                  <Text style={styles.metaConnectText}>{t('settings.connectMetaButton')}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="link" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.connectedPlatforms')}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{connectedCount} {t('settings.active')}</Text>
            </View>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.connectSocialDesc')}
          </Text>
          <View style={styles.connectionsList}>
            {platformConnections.map(connection => {
              const style = platformIcons[connection.id] || { icon: 'globe' as const, color: colors.primary };
              const isMetaPlatform = connection.id === 'facebook' || connection.id === 'instagram';
              return (
                <PlatformConnection
                  key={connection.id}
                  name={connection.name}
                  icon={style.icon}
                  color={style.color}
                  isConnected={connection.isConnected}
                  onConnect={() => isMetaPlatform && !metaConnection.isConnected ? handleConnectMeta() : handleConnect(connection.id)}
                  onDisconnect={() => isMetaPlatform ? handleDisconnectMeta() : handleDisconnect(connection.id)}
                  hint={isMetaPlatform ? t('settings.viaMetaBusiness') : undefined}
                />
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="time" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.autoPublishSchedule')}</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.autoPublishDesc')}
          </Text>
          <View style={styles.scheduleList}>
            {postingSchedules.map(schedule => {
              const connection = platformConnections.find(c => c.name === schedule.platform);
              const isConnected = connection?.isConnected || false;
              return (
                <View 
                  key={schedule.platform}
                  style={[styles.scheduleItem, { backgroundColor: colors.inputBackground }]}
                >
                  <View style={styles.scheduleLeft}>
                    <Text style={[styles.schedulePlatform, { color: colors.text }]}>{schedule.platform}</Text>
                    <Text style={[styles.scheduleInfo, { color: colors.textMuted }]}>
                      {schedule.times.join(', ')} on {schedule.days.join(', ')}
                    </Text>
                  </View>
                  <Switch
                    value={schedule.enabled && isConnected}
                    onValueChange={(value) => handleScheduleToggle(schedule.platform, value)}
                    disabled={!isConnected}
                    trackColor={{ false: colors.inputBorder, true: colors.primary + '50' }}
                    thumbColor={schedule.enabled && isConnected ? colors.primary : colors.textMuted}
                  />
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardTitleRow}>
            <Ionicons name="business" size={20} color={colors.accentOrange} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.brandProfile')}</Text>
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>{t('settings.brandName')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('settings.brandNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>{t('settings.industry')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('settings.industryPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={industry}
              onChangeText={setIndustry}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>{t('settings.targetAudience')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('settings.targetAudiencePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={targetAudience}
              onChangeText={setTargetAudience}
              multiline
              numberOfLines={2}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('settings.brandVoice')}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            {t('settings.selectTone')}
          </Text>
          <View style={styles.toneGrid}>
            {toneOptions.map(option => (
              <Pressable
                key={option.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setTone(option.key);
                }}
                style={[
                  styles.toneButton,
                  { 
                    backgroundColor: tone === option.key ? colors.primary + '20' : colors.inputBackground,
                    borderColor: tone === option.key ? colors.primary : 'transparent',
                  }
                ]}
              >
                <Text style={[
                  styles.toneLabel,
                  { color: tone === option.key ? colors.primary : colors.textMuted }
                ]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {hasChanges && (
          <Pressable
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, { opacity: pressed ? 0.8 : 1 }]}
          >
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientButton}
            >
              <Ionicons name="checkmark" size={20} color="#fff" />
              <Text style={styles.saveButtonText}>{t('settings.saveChanges')}</Text>
            </LinearGradient>
          </Pressable>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showLanguageModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('settings.language')}</Text>
              <Pressable onPress={() => setShowLanguageModal(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {languages.map((lang) => (
                <Pressable
                  key={lang.code}
                  onPress={() => handleSelectLanguage(lang.code)}
                  style={({ pressed }) => [
                    styles.languageItem,
                    { 
                      backgroundColor: lang.code === locale ? colors.primary + '15' : colors.card,
                      borderColor: lang.code === locale ? colors.primary : colors.cardBorder,
                      opacity: pressed ? 0.7 : 1,
                    }
                  ]}
                >
                  <View style={styles.languageItemLeft}>
                    <Text style={styles.languageItemFlag}>{lang.flag}</Text>
                    <View style={styles.languageItemText}>
                      <Text style={[styles.languageItemNative, { color: colors.text }]}>{lang.nativeName}</Text>
                      <Text style={[styles.languageItemEnglish, { color: colors.textMuted }]}>{lang.name}</Text>
                    </View>
                  </View>
                  {lang.code === locale && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 24,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDetails: {
    gap: 2,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  userProvider: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  logoutText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  languageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  languageFlag: {
    fontSize: 16,
  },
  languageName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  metaCard: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
    marginBottom: 16,
  },
  metaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  metaLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  metaSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  connectedText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  metaConnectedInfo: {
    gap: 12,
  },
  metaInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
  },
  metaInfoText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  metaFeatures: {
    gap: 8,
  },
  metaFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaFeatureText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  disconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    marginTop: 4,
  },
  disconnectText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  metaConnectSection: {
    gap: 16,
  },
  metaDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  metaBenefits: {
    gap: 10,
  },
  metaBenefit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaBenefitText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  metaConnectButton: {},
  metaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 10,
  },
  metaConnectText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  cardSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  connectionsList: {
    gap: 12,
  },
  scheduleList: {
    gap: 10,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
  },
  scheduleLeft: {
    flex: 1,
    gap: 2,
  },
  schedulePlatform: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scheduleInfo: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  toneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toneButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  toneLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 24,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  saveButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  modalBody: {
    marginBottom: 16,
  },
  languageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  languageItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  languageItemFlag: {
    fontSize: 20,
  },
  languageItemText: {
    gap: 2,
  },
  languageItemNative: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  languageItemEnglish: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
