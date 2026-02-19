import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  useColorScheme, 
  Platform,
  Pressable,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { PlatformPicker } from '@/components/PlatformPicker';
import { generateId } from '@/lib/storage';
import { getApiUrl } from '@/lib/query-client';
import type { MediaItem } from '@/lib/types';

const mediaTypes = [
  { id: 'video', label: 'Video', icon: 'videocam-outline' as const },
  { id: 'image', label: 'Image', icon: 'image-outline' as const },
  { id: 'poster', label: 'Poster', icon: 'easel-outline' as const },
];

export default function StudioScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { mediaItems, addMediaItem, removeMediaItem } = useApp();
  const { t } = useLanguage();

  const [showModal, setShowModal] = useState(false);
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaType, setMediaType] = useState<'video' | 'image'>('video');
  const [mediaPlatform, setMediaPlatform] = useState<string[]>(['Instagram']);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [mediaGoal, setMediaGoal] = useState('');
  const [mediaAudience, setMediaAudience] = useState('');
  const [mediaCta, setMediaCta] = useState('');
  const [mediaSeries, setMediaSeries] = useState('');
  const [mediaOffer, setMediaOffer] = useState('');
  const [isSubmittingCase, setIsSubmittingCase] = useState(false);

  const videos = mediaItems.filter(m => m.type === 'video');
  const images = mediaItems.filter(m => m.type === 'image');
  const posters = mediaItems.filter(m => m.type === 'poster');

  const handlePickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaType === 'video' 
          ? ImagePicker.MediaTypeOptions.Videos 
          : ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking media:', error);
      setSelectedUri('placeholder');
    }
  };

  const handleAddMedia = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowModal(true);
    setMediaTitle('');
    setMediaType('video');
    setMediaPlatform(['Instagram']);
    setSelectedUri(null);
    setMediaGoal('');
    setMediaAudience('');
    setMediaCta('');
    setMediaSeries('');
    setMediaOffer('');
  };

  const handleSaveMedia = async () => {
    if (!mediaTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your media.');
      return;
    }
    if (!mediaGoal.trim() || !mediaAudience.trim() || !mediaCta.trim()) {
      Alert.alert('Missing Info', 'Goal, Audience, and CTA are required for AI-powered publishing.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmittingCase(true);

    const newMedia: MediaItem = {
      id: generateId(),
      type: mediaType,
      title: mediaTitle,
      uri: selectedUri || 'placeholder',
      platform: mediaPlatform[0],
      status: 'draft',
      createdAt: new Date().toISOString(),
      goal: mediaGoal,
      audience: mediaAudience,
      cta: mediaCta,
      series: mediaSeries || undefined,
      offer: mediaOffer || undefined,
    };

    try {
      const apiUrl = getApiUrl();
      const res = await fetch(new URL('/api/studio/case', apiUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: 'default',
          mediaId: newMedia.id,
          title: newMedia.title,
          platform: newMedia.platform,
          goal: mediaGoal,
          audience: mediaAudience,
          cta: mediaCta,
          series: mediaSeries || undefined,
          offer: mediaOffer || undefined,
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        newMedia.serverPostId = data.postId;
        newMedia.autoCaption = data.winningCaption;
        newMedia.status = 'scheduled';
      }
    } catch (err) {
      console.log('Publishing pipeline unavailable, saving locally');
    }

    await addMediaItem(newMedia);
    setIsSubmittingCase(false);
    setShowModal(false);
    Alert.alert('Added', `${mediaType === 'video' ? 'Video' : 'Image'} added with AI captions generated.`);
  };

  const handleDeleteMedia = async (id: string, title: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await removeMediaItem(id);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return colors.accent;
      case 'published': return colors.success;
      default: return colors.textMuted;
    }
  };

  const renderMediaCard = (item: MediaItem) => (
    <View 
      key={item.id}
      style={[styles.mediaCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
    >
      <View style={[styles.mediaThumbnail, { backgroundColor: colors.inputBackground }]}>
        <Ionicons 
          name={item.type === 'video' ? 'videocam' : item.type === 'poster' ? 'easel' : 'image'} 
          size={32} 
          color={colors.textMuted} 
        />
      </View>
      <View style={styles.mediaInfo}>
        <Text style={[styles.mediaTitle, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.mediaMetaRow}>
          <Text style={[styles.mediaPlatform, { color: colors.textSecondary }]}>
            {item.platform}
          </Text>
          <View style={[styles.mediaStatus, { backgroundColor: getStatusColor(item.status) + '20' }]}>
            <Text style={[styles.mediaStatusText, { color: getStatusColor(item.status) }]}>
              {item.status}
            </Text>
          </View>
        </View>
        {item.scheduledDate && (
          <Text style={[styles.mediaSchedule, { color: colors.accent }]}>
            {t('studio.scheduledLabel')} {new Date(item.scheduledDate).toLocaleDateString()}
          </Text>
        )}
        {item.autoCaption && (
          <Text style={[styles.mediaSchedule, { color: colors.success }]} numberOfLines={1}>
            AI Caption attached
          </Text>
        )}
        {item.goal && (
          <Text style={[styles.mediaSchedule, { color: colors.textMuted }]} numberOfLines={1}>
            {item.goal}
          </Text>
        )}
      </View>
      <Pressable
        onPress={() => handleDeleteMedia(item.id, item.title)}
        style={styles.deleteBtn}
      >
        <Ionicons name="trash-outline" size={18} color={colors.error} />
      </Pressable>
    </View>
  );

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
            <Text style={[styles.title, { color: colors.text }]}>{t('studio.title')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('studio.subtitle')}
            </Text>
          </View>
          <Pressable
            onPress={handleAddMedia}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>

        <View>
            <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.stat}>
                <Ionicons name="videocam" size={20} color={colors.primary} />
                <Text style={[styles.statValue, { color: colors.text }]}>{videos.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('studio.videos')}</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.stat}>
                <Ionicons name="image" size={20} color={colors.accent} />
                <Text style={[styles.statValue, { color: colors.text }]}>{images.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('studio.images')}</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.stat}>
                <Ionicons name="easel" size={20} color={colors.accentOrange} />
                <Text style={[styles.statValue, { color: colors.text }]}>{posters.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>{t('studio.posters')}</Text>
              </View>
            </View>

            {videos.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="videocam" size={20} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('studio.videos')}</Text>
                </View>
                <View style={styles.mediaList}>
                  {videos.map(renderMediaCard)}
                </View>
              </View>
            )}

            {images.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="image" size={20} color={colors.accent} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('studio.images')}</Text>
                </View>
                <View style={styles.mediaList}>
                  {images.map(renderMediaCard)}
                </View>
              </View>
            )}

            {posters.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="easel" size={20} color={colors.accentOrange} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('studio.aiPosters')}</Text>
                </View>
                <View style={styles.mediaList}>
                  {posters.map(renderMediaCard)}
                </View>
              </View>
            )}

            {mediaItems.length === 0 && (
              <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Ionicons name="film-outline" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('studio.emptyTitle')}</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  {t('studio.emptyDesc')}
                </Text>
                <Pressable
                  onPress={handleAddMedia}
                  style={({ pressed }) => [
                    styles.emptyButton,
                    { opacity: pressed ? 0.8 : 1 }
                  ]}
                >
                  <LinearGradient
                    colors={colors.primaryGradient as [string, string]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gradientButton}
                  >
                    <Ionicons name="cloud-upload" size={20} color="#fff" />
                    <Text style={styles.emptyButtonText}>{t('studio.uploadMedia')}</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('studio.addMedia')}</Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('studio.mediaType')}</Text>
              <View style={styles.typeRow}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setMediaType('video');
                  }}
                  style={[
                    styles.typeButton,
                    { 
                      backgroundColor: mediaType === 'video' ? colors.primary + '20' : colors.inputBackground,
                      borderColor: mediaType === 'video' ? colors.primary : 'transparent',
                    }
                  ]}
                >
                  <Ionicons 
                    name="videocam-outline" 
                    size={24} 
                    color={mediaType === 'video' ? colors.primary : colors.textMuted} 
                  />
                  <Text style={[
                    styles.typeLabel,
                    { color: mediaType === 'video' ? colors.primary : colors.textMuted }
                  ]}>
                    {t('studio.videoType')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setMediaType('image');
                  }}
                  style={[
                    styles.typeButton,
                    { 
                      backgroundColor: mediaType === 'image' ? colors.accent + '20' : colors.inputBackground,
                      borderColor: mediaType === 'image' ? colors.accent : 'transparent',
                    }
                  ]}
                >
                  <Ionicons 
                    name="image-outline" 
                    size={24} 
                    color={mediaType === 'image' ? colors.accent : colors.textMuted} 
                  />
                  <Text style={[
                    styles.typeLabel,
                    { color: mediaType === 'image' ? colors.accent : colors.textMuted }
                  ]}>
                    {t('studio.imageType')}
                  </Text>
                </Pressable>
              </View>

              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('studio.titleLabel')}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('studio.titlePlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={mediaTitle}
                onChangeText={setMediaTitle}
              />

              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('create.platform')}</Text>
              <PlatformPicker selected={mediaPlatform} onChange={setMediaPlatform} single />

              <View style={[styles.metadataSection, { borderColor: colors.cardBorder }]}>
                <View style={styles.metadataBadge}>
                  <Ionicons name="flash" size={14} color={colors.primary} />
                  <Text style={[styles.metadataBadgeText, { color: colors.primary }]}>AI Publishing Metadata</Text>
                </View>

                <Text style={[styles.inputLabel, { color: colors.text }]}>Goal *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g. Drive sales, Build awareness, Get leads"
                  placeholderTextColor={colors.textMuted}
                  value={mediaGoal}
                  onChangeText={setMediaGoal}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>Target Audience *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g. Dubai entrepreneurs, 25-40, tech-savvy"
                  placeholderTextColor={colors.textMuted}
                  value={mediaAudience}
                  onChangeText={setMediaAudience}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>Call to Action *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g. Book now, Shop the link, DM us"
                  placeholderTextColor={colors.textMuted}
                  value={mediaCta}
                  onChangeText={setMediaCta}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>Content Series</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g. Monday Motivation, Behind the Scenes"
                  placeholderTextColor={colors.textMuted}
                  value={mediaSeries}
                  onChangeText={setMediaSeries}
                />

                <Text style={[styles.inputLabel, { color: colors.text }]}>Offer / Promotion</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g. 20% off this week, Free consultation"
                  placeholderTextColor={colors.textMuted}
                  value={mediaOffer}
                  onChangeText={setMediaOffer}
                />
              </View>

              <Pressable
                onPress={handlePickMedia}
                style={[styles.uploadArea, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
              >
                {selectedUri ? (
                  <View style={styles.uploadedState}>
                    <Ionicons name="checkmark-circle" size={32} color={colors.success} />
                    <Text style={[styles.uploadedText, { color: colors.success }]}>
                      {t('studio.selected').replace('{{type}}', mediaType === 'video' ? t('studio.videoType') : t('studio.imageType'))}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={40} color={colors.textMuted} />
                    <Text style={[styles.uploadText, { color: colors.textMuted }]}>
                      Tap to select {mediaType === 'video' ? t('studio.videoType').toLowerCase() : t('studio.imageType').toLowerCase()}
                    </Text>
                    <Text style={[styles.uploadHint, { color: colors.textMuted }]}>
                      {t('studio.fromDevice')}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>

            <Pressable
              onPress={handleSaveMedia}
              disabled={isSubmittingCase}
              style={({ pressed }) => [styles.saveMediaButton, { opacity: pressed || isSubmittingCase ? 0.6 : 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Ionicons name={isSubmittingCase ? "hourglass" : "flash"} size={20} color="#fff" />
                <Text style={styles.saveMediaText}>{isSubmittingCase ? 'Generating AI Captions...' : 'Create & Auto-Caption'}</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSelector: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    marginBottom: 20,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  modeTabText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  statsRow: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  statDivider: {
    width: 1,
    marginHorizontal: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  mediaList: {
    gap: 12,
  },
  mediaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  mediaThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInfo: {
    flex: 1,
    gap: 4,
  },
  mediaTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  mediaMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mediaPlatform: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  mediaStatus: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  mediaStatusText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  mediaSchedule: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  deleteBtn: {
    padding: 8,
  },
  emptyState: {
    alignItems: 'center',
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
    paddingHorizontal: 20,
  },
  emptyButton: {
    marginTop: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    gap: 10,
  },
  emptyButtonText: {
    fontSize: 15,
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
    maxHeight: '80%',
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
  inputLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    marginBottom: 10,
    marginTop: 16,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
    gap: 8,
  },
  typeLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  uploadArea: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 32,
    marginTop: 16,
    gap: 8,
  },
  uploadText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  uploadHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  uploadedState: {
    alignItems: 'center',
    gap: 8,
  },
  uploadedText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  saveMediaButton: {
    marginTop: 8,
  },
  saveMediaText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  metadataSection: {
    marginTop: 20,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  metadataBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  metadataBadgeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
});
