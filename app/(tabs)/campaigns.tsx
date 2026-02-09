import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  Pressable,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { CampaignCard } from '@/components/CampaignCard';
import { PlatformPicker } from '@/components/PlatformPicker';
import { AdPreview } from '@/components/AdPreview';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { generateId } from '@/lib/storage';
import { apiRequest } from '@/lib/query-client';
import type { Campaign, Ad } from '@/lib/types';

const ctaOptionKeys = ['campaigns.learnMore', 'campaigns.shopNow', 'campaigns.signUp', 'campaigns.getStarted', 'campaigns.bookNow', 'campaigns.contactUs', 'campaigns.download'];

export default function CampaignsScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { campaigns, addCampaign, updateCampaign, ads, addAd, brandProfile } = useApp();
  const { t } = useLanguage();

  const ctaOptions = ctaOptionKeys.map(key => t(key));

  const [activeTab, setActiveTab] = useState<'campaigns' | 'ads'>('campaigns');
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [platform, setPlatform] = useState<string[]>(['Instagram']);

  const [adHeadline, setAdHeadline] = useState('');
  const [adBody, setAdBody] = useState('');
  const [adCta, setAdCta] = useState('Learn More');
  const [adPlatforms, setAdPlatforms] = useState<string[]>(['Instagram', 'Facebook']);
  const [adBudget, setAdBudget] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCreateCampaign = async () => {
    if (!name.trim()) {
      Alert.alert(t('campaigns.missingName'), t('campaigns.enterCampaignName'));
      return;
    }
    if (!budget.trim() || isNaN(Number(budget))) {
      Alert.alert(t('campaigns.invalidBudget'), t('campaigns.enterValidBudget'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newCampaign: Campaign = {
      id: generateId(),
      name: name.trim(),
      status: 'draft',
      budget: Number(budget),
      spent: 0,
      platform: platform[0],
      platforms: platform,
      startDate: new Date().toISOString(),
      reach: 0,
      engagement: 0,
      conversions: 0,
    };

    await addCampaign(newCampaign);
    setShowCampaignModal(false);
    setName('');
    setBudget('');
    setPlatform(['Instagram']);
  };

  const handleGenerateAd = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGenerating(true);

    try {
      const response = await apiRequest('POST', '/api/generate-ad', {
        brandName: brandProfile.name || 'our brand',
        industry: brandProfile.industry || 'business',
        tone: brandProfile.tone || 'Professional',
        targetAudience: brandProfile.targetAudience || 'general audience',
        platforms: adPlatforms,
      });

      const data = await response.json();
      setAdHeadline(data.headline);
      setAdBody(data.body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Ad generation error:', error);
      Alert.alert(t('campaigns.error'), t('campaigns.generateAdError'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateAd = async () => {
    if (!adHeadline.trim() || !adBody.trim()) {
      Alert.alert(t('campaigns.missingContent'), t('campaigns.addHeadlineBody'));
      return;
    }
    if (!adBudget.trim() || isNaN(Number(adBudget))) {
      Alert.alert(t('campaigns.invalidBudget'), t('campaigns.enterValidBudget'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const newAd: Ad = {
      id: generateId(),
      campaignId: '',
      headline: adHeadline.trim(),
      body: adBody.trim(),
      callToAction: adCta,
      platforms: adPlatforms,
      status: 'draft',
      budget: Number(adBudget),
      spent: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      createdAt: new Date().toISOString(),
    };

    await addAd(newAd);
    setShowAdModal(false);
    setAdHeadline('');
    setAdBody('');
    setAdCta('Learn More');
    setAdPlatforms(['Instagram', 'Facebook']);
    setAdBudget('');
    Alert.alert(t('campaigns.success'), t('campaigns.adCreatedSuccess'));
  };

  const handleToggle = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'active' ? 'paused' : 
                      campaign.status === 'paused' ? 'active' : 
                      campaign.status === 'draft' ? 'active' : campaign.status;
    
    await updateCampaign({
      ...campaign,
      status: newStatus,
      reach: campaign.reach || Math.floor(Math.random() * 5000) + 1000,
      engagement: campaign.engagement || Math.floor(Math.random() * 500) + 100,
      conversions: campaign.conversions || Math.floor(Math.random() * 50) + 10,
      spent: campaign.spent || Math.floor(campaign.budget * 0.3),
    });
  };

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const otherCampaigns = campaigns.filter(c => c.status !== 'active');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
        ]}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>{t('campaigns.title')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('campaigns.subtitle')}
            </Text>
          </View>
        </View>

        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setActiveTab('campaigns')}
            style={[
              styles.tab,
              { 
                backgroundColor: activeTab === 'campaigns' ? colors.primary : colors.inputBackground,
              }
            ]}
          >
            <Ionicons 
              name="megaphone" 
              size={18} 
              color={activeTab === 'campaigns' ? '#fff' : colors.textMuted} 
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'campaigns' ? '#fff' : colors.textMuted }
            ]}>
              {t('campaigns.campaignsTab')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('ads')}
            style={[
              styles.tab,
              { 
                backgroundColor: activeTab === 'ads' ? colors.primary : colors.inputBackground,
              }
            ]}
          >
            <Ionicons 
              name="layers" 
              size={18} 
              color={activeTab === 'ads' ? '#fff' : colors.textMuted} 
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'ads' ? '#fff' : colors.textMuted }
            ]}>
              {t('campaigns.crossPlatformAds')}
            </Text>
          </Pressable>
        </View>

        {activeTab === 'campaigns' ? (
          <>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowCampaignModal(true);
              }}
              style={({ pressed }) => [
                styles.createButton,
                { opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.createButtonText}>{t('campaigns.newCampaign')}</Text>
              </LinearGradient>
            </Pressable>

            {activeCampaigns.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('campaigns.activeCampaigns')}</Text>
                <View style={styles.campaignList}>
                  {activeCampaigns.map(campaign => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      onPress={() => {}}
                      onToggle={() => handleToggle(campaign)}
                    />
                  ))}
                </View>
              </View>
            )}

            {otherCampaigns.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {activeCampaigns.length > 0 ? t('campaigns.otherCampaigns') : t('campaigns.allCampaigns')}
                </Text>
                <View style={styles.campaignList}>
                  {otherCampaigns.map(campaign => (
                    <CampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      onPress={() => {}}
                      onToggle={() => handleToggle(campaign)}
                    />
                  ))}
                </View>
              </View>
            )}

            {campaigns.length === 0 && (
              <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Ionicons name="megaphone-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('campaigns.noCampaigns')}</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  {t('campaigns.noCampaignsDesc')}
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowAdModal(true);
              }}
              style={({ pressed }) => [
                styles.createButton,
                { opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <LinearGradient
                colors={[colors.accent, '#0D9488'] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Ionicons name="sparkles" size={20} color="#fff" />
                <Text style={styles.createButtonText}>{t('campaigns.createCrossPlatformAd')}</Text>
              </LinearGradient>
            </Pressable>

            {ads.length > 0 ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('campaigns.yourAds')}</Text>
                <View style={styles.adsList}>
                  {ads.map(ad => (
                    <View 
                      key={ad.id}
                      style={[styles.adCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                    >
                      <View style={styles.adHeader}>
                        <Text style={[styles.adHeadline, { color: colors.text }]} numberOfLines={1}>
                          {ad.headline}
                        </Text>
                        <View style={[
                          styles.adStatus, 
                          { backgroundColor: ad.status === 'active' ? colors.success + '20' : colors.textMuted + '20' }
                        ]}>
                          <Text style={[
                            styles.adStatusText, 
                            { color: ad.status === 'active' ? colors.success : colors.textMuted }
                          ]}>
                            {ad.status.charAt(0).toUpperCase() + ad.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.adBodyPreview, { color: colors.textSecondary }]} numberOfLines={2}>
                        {ad.body}
                      </Text>
                      <View style={styles.adPlatforms}>
                        {ad.platforms.map(p => (
                          <View key={p} style={[styles.platformTag, { backgroundColor: colors.primary + '20' }]}>
                            <Text style={[styles.platformTagText, { color: colors.primary }]}>{p}</Text>
                          </View>
                        ))}
                      </View>
                      <View style={styles.adMetrics}>
                        <View style={styles.adMetric}>
                          <Text style={[styles.adMetricValue, { color: colors.text }]}>{ad.impressions.toLocaleString()}</Text>
                          <Text style={[styles.adMetricLabel, { color: colors.textMuted }]}>{t('campaigns.impressions')}</Text>
                        </View>
                        <View style={styles.adMetric}>
                          <Text style={[styles.adMetricValue, { color: colors.text }]}>{ad.clicks.toLocaleString()}</Text>
                          <Text style={[styles.adMetricLabel, { color: colors.textMuted }]}>{t('campaigns.clicks')}</Text>
                        </View>
                        <View style={styles.adMetric}>
                          <Text style={[styles.adMetricValue, { color: colors.text }]}>${ad.spent}</Text>
                          <Text style={[styles.adMetricLabel, { color: colors.textMuted }]}>{t('campaigns.spent')}</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Ionicons name="layers-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('campaigns.noAds')}</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  {t('campaigns.noAdsDesc')}
                </Text>
              </View>
            )}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showCampaignModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCampaignModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('campaigns.newCampaign')}</Text>
              <Pressable onPress={() => setShowCampaignModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.campaignName')}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., Summer Sale 2025"
                  placeholderTextColor={colors.textMuted}
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.budget')}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., 1000"
                  placeholderTextColor={colors.textMuted}
                  value={budget}
                  onChangeText={setBudget}
                  keyboardType="numeric"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('create.platform')}</Text>
                <PlatformPicker selected={platform} onChange={setPlatform} single />
              </View>
            </ScrollView>

            <Pressable
              onPress={handleCreateCampaign}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Text style={styles.createButtonText}>{t('campaigns.createCampaign')}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAdModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAdModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.adModal, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('campaigns.createCrossPlatformAd')}</Text>
              <Pressable onPress={() => setShowAdModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.targetPlatforms')}</Text>
                <PlatformPicker selected={adPlatforms} onChange={setAdPlatforms} />
              </View>

              <Pressable
                onPress={handleGenerateAd}
                disabled={isGenerating}
                style={[styles.generateBtn, { backgroundColor: colors.accent + '20' }]}
              >
                {isGenerating ? (
                  <LoadingSpinner size={18} color={colors.accent} />
                ) : (
                  <Ionicons name="sparkles" size={18} color={colors.accent} />
                )}
                <Text style={[styles.generateBtnText, { color: colors.accent }]}>
                  {isGenerating ? t('create.generating') : t('campaigns.generateWithAI')}
                </Text>
              </Pressable>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.headline')}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="Catchy headline for your ad"
                  placeholderTextColor={colors.textMuted}
                  value={adHeadline}
                  onChangeText={setAdHeadline}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.adCopyLabel')}</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="Compelling description for your ad..."
                  placeholderTextColor={colors.textMuted}
                  value={adBody}
                  onChangeText={setAdBody}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.callToAction')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.ctaRow}>
                    {ctaOptions.map(cta => (
                      <Pressable
                        key={cta}
                        onPress={() => setAdCta(cta)}
                        style={[
                          styles.ctaButton,
                          { 
                            backgroundColor: adCta === cta ? colors.primary + '20' : colors.inputBackground,
                            borderColor: adCta === cta ? colors.primary : 'transparent',
                          }
                        ]}
                      >
                        <Text style={[
                          styles.ctaButtonText,
                          { color: adCta === cta ? colors.primary : colors.textMuted }
                        ]}>
                          {cta}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>{t('campaigns.dailyBudget')}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., 50"
                  placeholderTextColor={colors.textMuted}
                  value={adBudget}
                  onChangeText={setAdBudget}
                  keyboardType="numeric"
                />
              </View>

              <AdPreview
                headline={adHeadline}
                body={adBody}
                callToAction={adCta}
                platforms={adPlatforms}
              />

              <View style={{ height: 20 }} />
            </ScrollView>

            <Pressable
              onPress={handleCreateAd}
              style={({ pressed }) => [styles.modalButton, { opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={[colors.accent, '#0D9488'] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Ionicons name="rocket" size={18} color="#fff" />
                <Text style={styles.createButtonText}>{t('campaigns.createAd')}</Text>
              </LinearGradient>
            </Pressable>
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
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  tabBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  tabText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  createButton: {
    marginBottom: 24,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
  },
  createButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 16,
  },
  campaignList: {
    gap: 16,
  },
  adsList: {
    gap: 16,
  },
  adCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  adHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  adHeadline: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
    marginRight: 12,
  },
  adStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  adStatusText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  adBodyPreview: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  adPlatforms: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  platformTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  platformTagText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  adMetrics: {
    flexDirection: 'row',
    marginTop: 4,
  },
  adMetric: {
    flex: 1,
    alignItems: 'center',
  },
  adMetricValue: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  adMetricLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    marginTop: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
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
    maxHeight: '70%',
  },
  adModal: {
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
  },
  modalBody: {
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
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
  textArea: {
    minHeight: 100,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    marginBottom: 20,
  },
  generateBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ctaButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  ctaButtonText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  modalButton: {},
});
