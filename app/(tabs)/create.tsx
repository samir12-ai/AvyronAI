import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  KeyboardAvoidingView,
  Image,
  ActivityIndicator,
  Dimensions,
  Modal,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { useCampaign } from '@/context/CampaignContext';
import { PlatformPicker } from '@/components/PlatformPicker';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { generateId } from '@/lib/storage';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { useCreativeContext } from '@/context/CreativeContext';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentItem, MediaItem } from '@/lib/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const contentTypesDef = [
  { id: 'post', labelKey: 'create.post', icon: 'document-text-outline' as const },
  { id: 'caption', labelKey: 'create.caption', icon: 'text-outline' as const },
  { id: 'ad', labelKey: 'create.adCopy', icon: 'megaphone-outline' as const },
  { id: 'story', labelKey: 'create.story', icon: 'layers-outline' as const },
  { id: 'reel', labelKey: 'create.reels', icon: 'videocam-outline' as const },
];

const reelDurations = [
  { id: '5-9 seconds', label: '5-9s' },
  { id: '15-30 seconds', label: '15-30s' },
  { id: '30-60 seconds', label: '30-60s' },
  { id: '60-90 seconds', label: '60-90s' },
];

const reelGoalsDef = [
  { id: 'engagement', labelKey: 'create.engagement', icon: 'heart-outline' as const },
  { id: 'awareness', labelKey: 'create.awareness', icon: 'eye-outline' as const },
  { id: 'sales', labelKey: 'create.sales', icon: 'cart-outline' as const },
  { id: 'education', labelKey: 'create.education', icon: 'school-outline' as const },
  { id: 'viral', labelKey: 'create.viral', icon: 'trending-up-outline' as const },
];

type GenerationMode = 'text-to-image' | 'image-to-image' | 'image-edit';

const generationModesDef = [
  { id: 'text-to-image' as GenerationMode, labelKey: 'create.createMode', icon: 'sparkles' as const, descKey: 'create.fromTextPrompt' },
  { id: 'image-to-image' as GenerationMode, labelKey: 'create.transformMode', icon: 'color-wand' as const, descKey: 'create.reimaginePhoto' },
  { id: 'image-edit' as GenerationMode, labelKey: 'create.editMode', icon: 'crop' as const, descKey: 'create.modifyImage' },
];

const visualStylesDef = [
  { id: 'cinematic', labelKey: 'create.cinematic', gradient: ['#1a1a2e', '#16213e', '#0f3460'] as const, icon: 'film-outline' as const },
  { id: 'professional', labelKey: 'create.professional', gradient: ['#2c3e50', '#3498db', '#2980b9'] as const, icon: 'briefcase-outline' as const },
  { id: 'commercial', labelKey: 'create.commercial', gradient: ['#e74c3c', '#c0392b', '#e74c3c'] as const, icon: 'storefront-outline' as const },
  { id: 'indie', labelKey: 'create.indie', gradient: ['#f39c12', '#e67e22', '#d35400'] as const, icon: 'leaf-outline' as const },
  { id: 'minimal', labelKey: 'create.minimal', gradient: ['#ecf0f1', '#bdc3c7', '#95a5a6'] as const, icon: 'remove-outline' as const },
  { id: 'vibrant', labelKey: 'create.vibrant', gradient: ['#8e44ad', '#9b59b6', '#e91e63'] as const, icon: 'color-palette-outline' as const },
];

const aspectRatiosDef = [
  { id: '1:1', labelKey: 'create.square', width: 1, height: 1, icon: 'square-outline' as const },
  { id: '4:5', labelKey: 'create.portrait', width: 4, height: 5, icon: 'phone-portrait-outline' as const },
  { id: '16:9', labelKey: 'create.landscape', width: 16, height: 9, icon: 'tablet-landscape-outline' as const },
  { id: '9:16', labelKey: 'create.storyRatio', width: 9, height: 16, icon: 'phone-portrait-outline' as const },
];

const moodOptionsDef = [
  { id: 'energetic', labelKey: 'create.energetic' },
  { id: 'calm', labelKey: 'create.calm' },
  { id: 'dramatic', labelKey: 'create.dramatic' },
  { id: 'playful', labelKey: 'create.playful' },
  { id: 'luxurious', labelKey: 'create.luxurious' },
  { id: 'warm', labelKey: 'create.warm' },
];

interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  style: string;
  createdAt: string;
}

interface CreatePersistedState {
  activeTab: 'content' | 'designer' | 'video';
  topic: string;
  posterTopic: string;
  videoPrompt: string;
  posterText: string;
  aiEngine: 'openai' | 'gemini';
  contentType: string;
  platform: string[];
  reelDuration: string;
  reelGoal: string;
  genMode: GenerationMode;
  posterStyle: string;
  aspectRatio: string;
  mood: string;
  generatedContent: string;
  reelScript: any;
  generatedPoster: string | null;
  videoUrl: string | null;
  generatedImageUrl: string | null;
  veoMode: 'text-to-video' | 'image-to-video';
  videoAspect: string;
  videoDuration: string;
}

const defaultCreateState: CreatePersistedState = {
  activeTab: 'content',
  topic: '',
  posterTopic: '',
  videoPrompt: '',
  posterText: '',
  aiEngine: 'openai',
  contentType: 'post',
  platform: ['Instagram'],
  reelDuration: '30-60 seconds',
  reelGoal: 'engagement',
  genMode: 'text-to-image',
  posterStyle: 'cinematic',
  aspectRatio: '1:1',
  mood: 'energetic',
  generatedContent: '',
  reelScript: null,
  generatedPoster: null,
  videoUrl: null,
  generatedImageUrl: null,
  veoMode: 'text-to-video',
  videoAspect: '16:9',
  videoDuration: '5s',
};

function DesignerLoadingOverlay({ isVisible }: { isVisible: boolean }) {
  const pulse = useSharedValue(0.6);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  React.useEffect(() => {
    if (isVisible) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [isVisible]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.95 + pulse.value * 0.05 }],
  }));

  if (!isVisible) return null;

  return (
    <Animated.View entering={FadeIn.duration(200)} style={[styles.loadingOverlay, { backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(248,250,252,0.95)' }]}>
      <Animated.View style={[styles.loadingContent, pulseStyle]}>
        <View style={[styles.loadingIconRing, { borderColor: colors.accent + '30' }]}>
          <LinearGradient
            colors={['#8B5CF6', '#7C3AED', '#34D399']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.loadingIconInner}
          >
            <Ionicons name="brush" size={28} color="#fff" />
          </LinearGradient>
        </View>
        <Text style={[styles.loadingTitle, { color: colors.text }]}>Creating your design</Text>
        <Text style={[styles.loadingSubtitle, { color: colors.textMuted }]}>
          Nano Banana Pro is crafting your vision...
        </Text>
        <View style={styles.loadingDots}>
          <LoadingSpinner size={16} color={colors.accent} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function StyleCard({ style, isSelected, onSelect, colors, label }: {
  style: typeof visualStylesDef[0];
  isSelected: boolean;
  onSelect: () => void;
  colors: any;
  label: string;
}) {
  return (
    <Pressable onPress={onSelect} style={styles.styleCardWrapper}>
      <LinearGradient
        colors={[...style.gradient] as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.styleCard,
          isSelected && { borderWidth: 2.5, borderColor: colors.accent },
        ]}
      >
        <Ionicons name={style.icon} size={20} color="#fff" />
        {isSelected && (
          <View style={styles.styleCardCheck}>
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
          </View>
        )}
      </LinearGradient>
      <Text style={[styles.styleCardLabel, { color: isSelected ? colors.accent : colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ReferencePhotoSlot({ photo, index, onPick, onRemove, colors }: {
  photo: ImagePicker.ImagePickerAsset | null;
  index: number;
  onPick: () => void;
  onRemove: () => void;
  colors: any;
}) {
  if (photo) {
    return (
      <View style={styles.refPhotoFilled}>
        <Image source={{ uri: photo.uri }} style={styles.refPhotoImage} resizeMode="cover" />
        <Pressable onPress={onRemove} style={styles.refPhotoRemoveBtn}>
          <Ionicons name="close-circle" size={22} color="#fff" />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPick}
      style={[styles.refPhotoEmpty, { borderColor: colors.accent + '30', backgroundColor: colors.inputBackground }]}
    >
      <Ionicons name="add" size={22} color={colors.accent} />
    </Pressable>
  );
}

export default function CreateScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { brandProfile, addContentItem, addMediaItem } = useApp();
  const { t } = useLanguage();
  const { creativeContext, clearCreativeContext } = useCreativeContext();
  const queryClient = useQueryClient();
  const { state: ps, updateState, isLoading: psLoading, isSaving, saveError, hydrationVersion } = usePersistedState<CreatePersistedState>('create', defaultCreateState);
  const [ciScriptResult, setCiScriptResult] = useState<any>(null);
  const [ciScriptError, setCiScriptError] = useState<string | null>(null);
  const { selectedCampaignId } = useCampaign();
  const searchParams = useLocalSearchParams<{
    calendarEntryId?: string;
    calendarContentType?: string;
    calendarTab?: string;
    calendarTopic?: string;
  }>();
  const [calendarEntryId, setCalendarEntryId] = useState<string | null>(null);

  const { data: requiredWorkData } = useQuery<{
    success: boolean;
    requiredWork: any;
    branches: { DESIGNER: { total: number; fulfilled: number; remaining: number; label: string }; WRITER: { total: number; fulfilled: number; remaining: number; label: string }; VIDEO: { total: number; fulfilled: number; remaining: number; label: string } };
    fulfillment: { total: { required: number; fulfilled: number; remaining: number } };
  }>({
    queryKey: [`/api/execution/required-work?campaignId=${selectedCampaignId}`],
    enabled: !!selectedCampaignId,
  });

  const contentTypes = contentTypesDef.map(ct => ({ ...ct, label: t(ct.labelKey) }));
  const reelGoals = reelGoalsDef.map(g => ({ ...g, label: t(g.labelKey) }));
  const generationModes = generationModesDef.map(m => ({ ...m, label: t(m.labelKey), description: t(m.descKey) }));
  const visualStyles = visualStylesDef.map(s => ({ ...s, label: t(s.labelKey) }));
  const aspectRatios = aspectRatiosDef.map(r => ({ ...r, label: t(r.labelKey) }));
  const moodOptions = moodOptionsDef.map(m => ({ ...m, label: t(m.labelKey) }));

  const [activeTab, setActiveTab] = useState<'content' | 'designer' | 'video'>(ps.activeTab);
  const [aiEngine, setAiEngine] = useState<'openai' | 'gemini'>(ps.aiEngine);
  
  const [contentType, setContentType] = useState<string>(ps.contentType);
  const [platform, setPlatform] = useState<string[]>(ps.platform);
  const [topic, setTopic] = useState(ps.topic);
  const [generatedContent, setGeneratedContent] = useState(ps.generatedContent);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reelDuration, setReelDuration] = useState(ps.reelDuration);
  const [reelGoal, setReelGoal] = useState(ps.reelGoal);
  const [reelScript, setReelScript] = useState<any>(ps.reelScript);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  const [genMode, setGenMode] = useState<GenerationMode>(ps.genMode);
  const [posterTopic, setPosterTopic] = useState(ps.posterTopic);
  const [posterStyle, setPosterStyle] = useState(ps.posterStyle);
  const [posterText, setPosterText] = useState(ps.posterText);
  const [aspectRatio, setAspectRatio] = useState(ps.aspectRatio);
  const [mood, setMood] = useState(ps.mood);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generatedPoster, setGeneratedPoster] = useState<string | null>(ps.generatedPoster);
  const [isGeneratingPoster, setIsGeneratingPoster] = useState(false);
  const [referencePhotos, setReferencePhotos] = useState<(ImagePicker.ImagePickerAsset | null)[]>([null, null, null]);
  const [generationHistory, setGenerationHistory] = useState<GeneratedImage[]>([]);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  const [veoMode, setVeoMode] = useState<'text-to-video' | 'image-to-video'>(ps.veoMode);
  const [videoPrompt, setVideoPrompt] = useState(ps.videoPrompt);
  const [videoAspect, setVideoAspect] = useState(ps.videoAspect);
  const [videoDuration, setVideoDuration] = useState(ps.videoDuration);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoOperationName, setVideoOperationName] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(ps.videoUrl);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoPolling, setVideoPolling] = useState(false);
  const [videoStartImage, setVideoStartImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(ps.generatedImageUrl);

  const lastHydrationRef = useRef(0);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    if (hydrationVersion > 0 && hydrationVersion !== lastHydrationRef.current) {
      lastHydrationRef.current = hydrationVersion;
      skipSyncRef.current = true;
      setActiveTab(ps.activeTab);
      setAiEngine(ps.aiEngine);
      setContentType(ps.contentType);
      setPlatform(ps.platform);
      setTopic(ps.topic);
      setGeneratedContent(ps.generatedContent);
      setReelDuration(ps.reelDuration);
      setReelGoal(ps.reelGoal);
      setReelScript(ps.reelScript);
      setGenMode(ps.genMode);
      setPosterTopic(ps.posterTopic);
      setPosterStyle(ps.posterStyle);
      setPosterText(ps.posterText);
      setAspectRatio(ps.aspectRatio);
      setMood(ps.mood);
      setGeneratedPoster(ps.generatedPoster);
      setVeoMode(ps.veoMode);
      setVideoPrompt(ps.videoPrompt);
      setVideoAspect(ps.videoAspect);
      setVideoDuration(ps.videoDuration);
      setVideoUrl(ps.videoUrl);
      setGeneratedImageUrl(ps.generatedImageUrl);
      setTimeout(() => { skipSyncRef.current = false; }, 100);
    }
  }, [hydrationVersion, ps]);

  useEffect(() => {
    if (lastHydrationRef.current === 0 || skipSyncRef.current) return;
    updateState({
      activeTab, topic, posterTopic, videoPrompt, posterText,
      aiEngine, contentType, platform, reelDuration, reelGoal, genMode,
      posterStyle, aspectRatio, mood, generatedContent, reelScript,
      generatedPoster, videoUrl, generatedImageUrl, veoMode, videoAspect,
      videoDuration,
    });
  }, [
    activeTab, topic, posterTopic, videoPrompt, posterText,
    aiEngine, contentType, platform, reelDuration, reelGoal, genMode,
    posterStyle, aspectRatio, mood, generatedContent, reelScript,
    generatedPoster, videoUrl, generatedImageUrl, veoMode, videoAspect,
    videoDuration,
  ]);

  useEffect(() => {
    if (creativeContext?.source === 'CI') {
      setContentType('reel');
      setActiveTab('content');
      setCiScriptResult(null);
      setCiScriptError(null);
    }
  }, [creativeContext]);

  useEffect(() => {
    if (searchParams.calendarEntryId && searchParams.calendarTab) {
      const entryId = searchParams.calendarEntryId;
      const tab = searchParams.calendarTab as 'content' | 'designer' | 'video';
      setActiveTab(tab);
      setCalendarEntryId(entryId);
      if (searchParams.calendarContentType) {
        const ct = searchParams.calendarContentType.toLowerCase();
        if (ct === 'reel' || ct === 'video') {
          setContentType('reel');
        } else {
          setContentType('post');
        }
      }
      if (searchParams.calendarTopic) {
        setTopic(searchParams.calendarTopic);
      }
      if (__DEV__) {
        console.log('NAV_CREATE', {
          entryId,
          contentType: searchParams.calendarContentType,
          pathname: '/(tabs)/create',
          tab,
        });
      }

      (async () => {
        try {
          const baseUrl = getApiUrl();
          const res = await fetch(new URL(`/api/execution/calendar-entries/${entryId}`, baseUrl).toString());
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.entry) {
              const entry = data.entry;
              if (entry.title && !searchParams.calendarTopic) setTopic(entry.title);
              if (entry.caption) setPosterTopic(entry.caption);
              if (__DEV__) {
                console.log('CREATE_FROM_CALENDAR hydrated', { entryId, title: entry.title, contentType: entry.contentType });
              }
            }
          }
        } catch (err) {
          if (__DEV__) console.warn('Failed to fetch calendar entry:', err);
        }
      })();
    }
  }, [searchParams.calendarEntryId, searchParams.calendarTab, searchParams.calendarContentType, searchParams.calendarTopic]);

  const handleGenerate = async () => {
    const hasCIContext = creativeContext?.source === 'CI' && contentType === 'reel';

    if (!hasCIContext && !topic.trim()) {
      Alert.alert(t('create.errorTitle'), t('create.topicPlaceholder'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGenerating(true);
    setGeneratedContent('');
    setReelScript(null);
    setCiScriptResult(null);
    setCiScriptError(null);

    try {
      if (contentType === 'reel') {
        const payload: any = {
          topic: topic || `Reel about ${brandProfile.industry || 'our brand'}`,
          platform: platform[0],
          brandName: brandProfile.name || 'our brand',
          tone: brandProfile.tone || 'Professional',
          targetAudience: brandProfile.targetAudience || 'general audience',
          industry: brandProfile.industry || 'business',
          reelDuration,
          reelGoal,
        };

        if (hasCIContext) {
          payload.ciContext = {
            snapshotId: creativeContext.snapshotId,
            intelligence: creativeContext.intelligence,
            creative_layers: creativeContext.creative_layers,
            onboarding_context: creativeContext.onboarding_context,
            blueprint_context: creativeContext.blueprint_context,
          };
        }

        const response = await apiRequest('POST', '/api/generate-reel-script', payload);
        const data = await response.json();

        if (data.missing_fields) {
          setCiScriptError(`Missing fields: ${data.missing_fields.join(', ')}. Update your brand profile in Settings.`);
        } else if (data.status === 'GENERATION_FAILED') {
          setCiScriptError(data.error || data.reason || 'Generation failed');
        } else if (data.mode === 'ci' && data.scripts_batch) {
          setCiScriptResult(data);
        } else if (data.script) {
          setReelScript(data.script);
        } else if (data.rawContent) {
          setGeneratedContent(data.rawContent);
        }
      } else {
        const response = await apiRequest('POST', '/api/generate-content', {
          topic,
          contentType,
          platform: platform[0],
          brandName: brandProfile.name || 'our brand',
          tone: brandProfile.tone || 'Professional',
          targetAudience: brandProfile.targetAudience || 'general audience',
          industry: brandProfile.industry || 'business',
          aiEngine,
        });
        const data = await response.json();
        setGeneratedContent(data.content);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Generation error:', error);
      Alert.alert(t('create.errorTitle'), t('create.errorGenerate'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async (status: 'draft' | 'scheduled') => {
    if (!generatedContent.trim()) {
      Alert.alert(t('create.noContent'), t('create.generateFirst'));
      return;
    }

    if (!selectedCampaignId) {
      Alert.alert('Campaign Required', 'Please select a campaign before saving content.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newItem: ContentItem = {
      id: generateId(),
      type: contentType as ContentItem['type'],
      platform: platform[0],
      content: generatedContent,
      status,
      createdAt: new Date().toISOString(),
    };

    await addContentItem(newItem);

    try {
      const canonicalType = contentType === 'reel' ? 'REEL' : contentType === 'caption' ? 'POST' : contentType === 'story' ? 'STORY' : 'POST';
      await apiRequest('POST', '/api/studio/items', {
        campaignId: selectedCampaignId,
        accountId: 'default',
        contentType: canonicalType,
        title: topic.trim() || generatedContent.slice(0, 50),
        caption: generatedContent,
        calendarEntryId: calendarEntryId || undefined,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/execution/required-work?campaignId=${selectedCampaignId}`] });
    } catch (err) {
      console.warn('[Create] Failed to save studio item:', err);
    }
    
    setTopic('');
    setGeneratedContent('');
    
    Alert.alert(t('create.savedToGallery'), `Content saved as ${status}.`);
  };

  const pickPhoto = async (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Needed', 'Please allow access to your photo library to use this feature.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      const newPhotos = [...referencePhotos];
      newPhotos[index] = result.assets[0];
      setReferencePhotos(newPhotos);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const removePhoto = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newPhotos = [...referencePhotos];
    newPhotos[index] = null;
    setReferencePhotos(newPhotos);
  };

  const handleGeneratePoster = async () => {
    if (!posterTopic.trim() && genMode === 'text-to-image') {
      Alert.alert('Missing Description', 'Please describe what you want to create.');
      return;
    }

    const hasPhotos = referencePhotos.some(p => p !== null);
    if ((genMode === 'image-to-image' || genMode === 'image-edit') && !hasPhotos) {
      Alert.alert('Missing Image', 'Please upload at least one reference image for this mode.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsGeneratingPoster(true);

    try {
      const apiUrl = getApiUrl();
      const formData = new FormData();
      formData.append('topic', posterTopic);
      formData.append('style', posterStyle);
      formData.append('text', posterText);
      formData.append('aspectRatio', aspectRatio);
      formData.append('mood', mood);
      formData.append('mode', genMode);
      formData.append('brandName', brandProfile.name || 'Brand');
      formData.append('industry', brandProfile.industry || 'business');

      const validPhotos = referencePhotos.filter(p => p !== null) as ImagePicker.ImagePickerAsset[];
      for (const photo of validPhotos) {
        if (Platform.OS === 'web' && photo.base64) {
          const byteString = atob(photo.base64);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: photo.mimeType || 'image/jpeg' });
          formData.append('photos', blob, `photo_${validPhotos.indexOf(photo)}.jpg`);
        } else {
          const photoUri = photo.uri;
          const photoName = photoUri.split('/').pop() || 'photo.jpg';
          formData.append('photos', {
            uri: photoUri,
            name: photoName,
            type: photo.mimeType || 'image/jpeg',
          } as any);
        }
      }

      const response = await fetch(new URL('/api/generate-poster', apiUrl).toString(), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate design');
      }

      const data = await response.json();
      setGeneratedPoster(data.imageUrl);

      const historyItem: GeneratedImage = {
        id: generateId(),
        imageUrl: data.imageUrl,
        prompt: posterTopic,
        style: posterStyle,
        createdAt: new Date().toISOString(),
      };
      setGenerationHistory(prev => [historyItem, ...prev].slice(0, 12));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error('Design generation error:', error);
      Alert.alert('Generation Error', error.message || 'Failed to generate design. Please try again.');
    } finally {
      setIsGeneratingPoster(false);
    }
  };

  const saveImageToGallery = async (imageUri: string) => {
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = imageUri;
        link.download = `MarketMind_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Downloaded!', 'Design downloaded to your device.');
        return;
      }

      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Needed',
          'Please allow access to your photo gallery to save designs.',
          [
            { text: 'Cancel', style: 'cancel' },
            ...(Platform.OS !== 'web' ? [{ text: 'Open Settings', onPress: () => {
              try { MediaLibrary.requestPermissionsAsync(); } catch {}
            }}] : []),
          ]
        );
        return;
      }

      const filename = `MarketMind_${Date.now()}.png`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      if (imageUri.startsWith('data:image')) {
        const base64Data = imageUri.split(',')[1];
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        await FileSystem.downloadAsync(imageUri, fileUri);
      }

      await MediaLibrary.saveToLibraryAsync(fileUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved to Gallery!', 'Your design has been saved to your photo gallery.');
    } catch (error: any) {
      console.error('Save to gallery error:', error);
      Alert.alert('Save Failed', 'Could not save to gallery. Please try again.');
    }
  };

  const handleSavePoster = async () => {
    if (!generatedPoster) {
      Alert.alert('No Design', 'Please generate a design first.');
      return;
    }

    if (!selectedCampaignId) {
      Alert.alert('Campaign Required', 'Please select a campaign before saving designs.');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const newMedia: MediaItem = {
        id: generateId(),
        type: 'poster',
        title: posterTopic || 'AI Design',
        uri: generatedPoster,
        platform: platform[0],
        status: 'draft',
        createdAt: new Date().toISOString(),
      };

      await addMediaItem(newMedia);

      try {
        await apiRequest('POST', '/api/studio/items', {
          campaignId: selectedCampaignId,
          accountId: 'default',
          contentType: 'IMAGE',
          title: posterTopic || 'AI Design',
          mediaUrl: generatedPoster,
        });
        queryClient.invalidateQueries({ queryKey: [`/api/execution/required-work?campaignId=${selectedCampaignId}`] });
      } catch (err) {
        console.warn('[Create] Failed to save poster studio item:', err);
      }

      try {
        await saveImageToGallery(generatedPoster);
      } catch (galleryError) {
        console.warn('Gallery save skipped:', galleryError);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Design saved to your Studio library.');
    } catch (error: any) {
      console.error('Save design error:', error);
      Alert.alert('Save Failed', error?.message || 'Could not save design. Please try again.');
    }
  };

  const pickVeoImage = async (setter: (img: ImagePicker.ImagePickerAsset | null) => void) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as ImagePicker.MediaType[],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setter(result.assets[0]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
    }
  };

  const uploadImageForVeo = async (image: ImagePicker.ImagePickerAsset): Promise<{ fileUri: string; mimeType: string } | null> => {
    try {
      const apiUrl = getApiUrl();
      const formData = new FormData();
      const uri = image.uri;
      const filename = uri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        formData.append('image', blob, filename);
      } else {
        formData.append('image', { uri, name: filename, type } as any);
      }

      const res = await fetch(new URL('/api/veo/upload-image', apiUrl).toString(), {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) return null;
      return { fileUri: data.fileUri, mimeType: data.mimeType };
    } catch (err) {
      console.error('Upload image error:', err);
      return null;
    }
  };

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) {
      Alert.alert('Missing Prompt', 'Describe the video you want to create.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGeneratingVideo(true);
    setVideoUrl(null);
    setVideoError(null);
    setVideoStatus('starting');

    try {
      const apiUrl = getApiUrl();
      const body: any = {
        prompt: videoPrompt,
        aspectRatio: videoAspect,
        duration: videoDuration,
      };

      if (veoMode === 'image-to-video' && videoStartImage?.uri) {
        setVideoStatus('uploading image...');
        const uploaded = await uploadImageForVeo(videoStartImage);
        if (!uploaded) {
          setVideoError('Failed to upload image');
          setIsGeneratingVideo(false);
          return;
        }
        body.imageFileUri = uploaded.fileUri;
        body.imageMimeType = uploaded.mimeType;
      }

      setVideoStatus('generating');
      const res = await fetch(new URL('/api/veo/generate-video', apiUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setVideoError(data.error || 'Failed to start generation');
        setIsGeneratingVideo(false);
        return;
      }

      setVideoOperationName(data.operationName);
      setVideoStatus('processing');
      pollVeoStatus(data.operationName);
    } catch (err: any) {
      setVideoError(err.message || 'Network error');
      setIsGeneratingVideo(false);
    }
  };

  const pollVeoStatus = async (operationName: string) => {
    setVideoPolling(true);
    const apiUrl = getApiUrl();
    let attempts = 0;
    const maxAttempts = 120;

    const poll = async () => {
      try {
        const res = await fetch(new URL('/api/veo/status', apiUrl).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationName }),
        });
        const data = await res.json();

        setVideoStatus(data.state);

        if (data.done && data.videoUrl) {
          setVideoUrl(data.videoUrl);
          setIsGeneratingVideo(false);
          setVideoPolling(false);
          setVideoStatus(null);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }

        if (data.state === 'failed') {
          setVideoError('Video generation failed. Please try again.');
          setIsGeneratingVideo(false);
          setVideoPolling(false);
          setVideoStatus(null);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        } else {
          setVideoError('Generation timed out. Please try again.');
          setIsGeneratingVideo(false);
          setVideoPolling(false);
          setVideoStatus(null);
        }
      } catch (err) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        }
      }
    };

    poll();
  };

  const selectedRatio = aspectRatios.find(r => r.id === aspectRatio) || aspectRatios[0];
  const canvasAspect = selectedRatio.width / selectedRatio.height;
  const canvasWidth = SCREEN_WIDTH - 40;
  const canvasHeight = Math.min(canvasWidth / canvasAspect, 500);

  const videoAspectOptions = [
    { id: '16:9', label: 'Landscape', icon: 'tablet-landscape-outline' as const },
    { id: '9:16', label: 'Portrait', icon: 'phone-portrait-outline' as const },
    { id: '1:1', label: 'Square', icon: 'square-outline' as const },
    { id: '4:3', label: '4:3', icon: 'tablet-landscape-outline' as const },
    { id: '3:4', label: '3:4', icon: 'phone-portrait-outline' as const },
    { id: '21:9', label: 'Ultra Wide', icon: 'tablet-landscape-outline' as const },
  ];

  const videoDurationOptions = [
    { id: '5s', label: '5s' },
    { id: '9s', label: '9s' },
    { id: '10s', label: '10s' },
    { id: '15s', label: '15s' },
    { id: '20s', label: '20s' },
  ];

  const veoModeTabs = [
    { id: 'text-to-video' as const, label: 'Text to Video', icon: 'videocam-outline' as const },
    { id: 'image-to-video' as const, label: 'Image to Video', icon: 'images-outline' as const },
  ];

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Platform.OS === 'web' ? 67 + 16 : insets.top + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.text }]}>{t('create.title')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('create.subtitle')}
            </Text>
            {isSaving && (
              <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={{ fontSize: 11, color: colors.textMuted }}>Saving</Text>
              </Animated.View>
            )}
            {saveError && !isSaving && (
              <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="alert-circle" size={14} color="#ef4444" />
                <Text style={{ fontSize: 11, color: '#ef4444' }}>Save error</Text>
              </Animated.View>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder, marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="git-branch-outline" size={18} color={colors.accent} />
              <Text style={{ fontSize: 15, fontWeight: '700' as const, color: colors.text }}>Required Work</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {requiredWorkData?.fulfillment?.total?.remaining ?? requiredWorkData?.requiredWork?.totalContentPieces ?? 0} remaining
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                { key: 'DESIGNER' as const, icon: 'brush-outline' as const, color: '#8B5CF6' },
                { key: 'WRITER' as const, icon: 'create-outline' as const, color: '#10B981' },
                { key: 'VIDEO' as const, icon: 'videocam-outline' as const, color: '#F59E0B' },
              ] as const).map(branch => {
                const branchData = requiredWorkData?.branches?.[branch.key];
                const total = branchData?.remaining ?? branchData?.total ?? 0;
                return (
                  <View key={branch.key} style={{
                    flex: 1,
                    backgroundColor: branch.color + '12',
                    borderRadius: 12,
                    padding: 12,
                    alignItems: 'center' as const,
                    borderWidth: 1,
                    borderColor: branch.color + '25',
                  }}>
                    <View style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: branch.color + '20',
                      alignItems: 'center' as const,
                      justifyContent: 'center' as const,
                      marginBottom: 6,
                    }}>
                      <Ionicons name={branch.icon} size={18} color={branch.color} />
                    </View>
                    <Text style={{ fontSize: 18, fontWeight: '700' as const, color: colors.text }}>{total}</Text>
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {branchData?.label || branch.key}
                    </Text>
                  </View>
                );
              })}
            </View>
            {!requiredWorkData?.requiredWork && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
                <Ionicons name="rocket-outline" size={14} color={colors.accent} />
                <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }}>
                  Build a strategic plan in AI Content to populate work items
                </Text>
              </View>
            )}
          </View>

          <View style={styles.tabBar}>
            <Pressable
              onPress={() => setActiveTab('content')}
              style={[
                styles.tab,
                { 
                  backgroundColor: activeTab === 'content' ? colors.primary : colors.inputBackground,
                }
              ]}
            >
              <Ionicons 
                name="sparkles" 
                size={18} 
                color={activeTab === 'content' ? '#fff' : colors.textMuted} 
              />
              <Text style={[
                styles.tabText,
                { color: activeTab === 'content' ? '#fff' : colors.textMuted }
              ]}>
                {t('create.aiWriter')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('designer')}
              style={[
                styles.tab,
                { 
                  backgroundColor: activeTab === 'designer' ? colors.accent : colors.inputBackground,
                }
              ]}
            >
              <Ionicons 
                name="brush" 
                size={18} 
                color={activeTab === 'designer' ? '#fff' : colors.textMuted} 
              />
              <Text style={[
                styles.tabText,
                { color: activeTab === 'designer' ? '#fff' : colors.textMuted }
              ]}>
                {t('create.aiDesigner')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('video')}
              style={[
                styles.tab,
                { 
                  backgroundColor: activeTab === 'video' ? '#7C3AED' : colors.inputBackground,
                }
              ]}
            >
              <Ionicons 
                name="videocam" 
                size={18} 
                color={activeTab === 'video' ? '#fff' : colors.textMuted} 
              />
              <Text style={[
                styles.tabText,
                { color: activeTab === 'video' ? '#fff' : colors.textMuted }
              ]}>
                AI Video
              </Text>
            </Pressable>
          </View>

          {calendarEntryId && (
            <View style={{ backgroundColor: '#7C3AED' + '15', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#7C3AED' + '30' }}>
              <Ionicons name="calendar" size={18} color="#7C3AED" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#7C3AED', fontSize: 13, fontWeight: '600' as const }}>Creating for Calendar Entry</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>ID: {calendarEntryId.slice(0, 8)}...</Text>
              </View>
              <Pressable onPress={() => setCalendarEntryId(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          {activeTab === 'content' && (
            <>
              <View style={[styles.engineToggle, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setAiEngine('openai'); }}
                  style={[
                    styles.engineBtn,
                    { backgroundColor: aiEngine === 'openai' ? '#10A37F' : colors.inputBackground }
                  ]}
                >
                  <Ionicons name="flash" size={14} color={aiEngine === 'openai' ? '#fff' : colors.textMuted} />
                  <Text style={[styles.engineBtnText, { color: aiEngine === 'openai' ? '#fff' : colors.textMuted }]}>GPT-5.2</Text>
                </Pressable>
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setAiEngine('gemini'); }}
                  style={[
                    styles.engineBtn,
                    { backgroundColor: aiEngine === 'gemini' ? '#4285F4' : colors.inputBackground }
                  ]}
                >
                  <Ionicons name="diamond" size={14} color={aiEngine === 'gemini' ? '#fff' : colors.textMuted} />
                  <Text style={[styles.engineBtnText, { color: aiEngine === 'gemini' ? '#fff' : colors.textMuted }]}>Gemini 3 Pro</Text>
                </Pressable>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('create.contentType')}</Text>
                <View style={styles.contentTypeGrid}>
                  {contentTypes.map(type => (
                    <Pressable
                      key={type.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setContentType(type.id);
                      }}
                      style={[
                        styles.contentTypeButton,
                        { 
                          backgroundColor: contentType === type.id ? colors.primary + '20' : colors.inputBackground,
                          borderColor: contentType === type.id ? colors.primary : 'transparent',
                        }
                      ]}
                    >
                      <Ionicons 
                        name={type.icon} 
                        size={20} 
                        color={contentType === type.id ? colors.primary : colors.textMuted} 
                      />
                      <Text style={[
                        styles.contentTypeLabel,
                        { color: contentType === type.id ? colors.primary : colors.textMuted }
                      ]}>
                        {type.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{t('create.platform')}</Text>
                <PlatformPicker selected={platform} onChange={setPlatform} single />
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {contentType === 'reel' ? t('create.reelConcept') : t('create.topicOrIdea')}
                </Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder={contentType === 'reel' 
                    ? t('create.reelPlaceholder') 
                    : t('create.topicPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={topic}
                  onChangeText={setTopic}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              {contentType === 'reel' && creativeContext?.source === 'CI' && (
                <View style={[styles.card, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <Ionicons name="analytics-outline" size={18} color="#8B5CF6" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#8B5CF6' }}>CI Context Active</Text>
                        <Text style={{ fontSize: 11, color: isDark ? '#A78BFA' : '#7C3AED', marginTop: 2 }}>
                          Competitor: {creativeContext.competitorName} · Snapshot: {creativeContext.snapshotId.slice(0, 8)}…
                        </Text>
                      </View>
                    </View>
                    <Pressable onPress={() => clearCreativeContext()} style={{ padding: 4 }}>
                      <Ionicons name="close-circle-outline" size={20} color="#8B5CF6" />
                    </Pressable>
                  </View>
                </View>
              )}

              {contentType === 'reel' && (
                <>
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{t('create.duration')}</Text>
                    <View style={styles.reelOptionRow}>
                      {reelDurations.map(d => (
                        <Pressable
                          key={d.id}
                          onPress={() => { Haptics.selectionAsync(); setReelDuration(d.id); }}
                          style={[
                            styles.reelChip,
                            { 
                              backgroundColor: reelDuration === d.id ? colors.primary + '20' : colors.inputBackground,
                              borderColor: reelDuration === d.id ? colors.primary : 'transparent',
                            }
                          ]}
                        >
                          <Ionicons name="time-outline" size={14} color={reelDuration === d.id ? colors.primary : colors.textMuted} />
                          <Text style={[styles.reelChipText, { color: reelDuration === d.id ? colors.primary : colors.textMuted }]}>{d.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.cardTitle, { color: colors.text }]}>{t('create.goal')}</Text>
                    <View style={styles.reelOptionRow}>
                      {reelGoals.map(g => (
                        <Pressable
                          key={g.id}
                          onPress={() => { Haptics.selectionAsync(); setReelGoal(g.id); }}
                          style={[
                            styles.reelChip,
                            { 
                              backgroundColor: reelGoal === g.id ? colors.accent + '20' : colors.inputBackground,
                              borderColor: reelGoal === g.id ? colors.accent : 'transparent',
                            }
                          ]}
                        >
                          <Ionicons name={g.icon} size={14} color={reelGoal === g.id ? colors.accent : colors.textMuted} />
                          <Text style={[styles.reelChipText, { color: reelGoal === g.id ? colors.accent : colors.textMuted }]}>{g.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </>
              )}

              <Pressable
                onPress={handleGenerate}
                disabled={isGenerating}
                style={({ pressed }) => [
                  styles.generateButton,
                  { opacity: pressed ? 0.8 : 1 }
                ]}
              >
                <LinearGradient
                  colors={contentType === 'reel' ? ['#E1306C', '#833AB4'] as [string, string] : colors.primaryGradient as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientButton}
                >
                  {isGenerating ? (
                    <LoadingSpinner size={20} color="#fff" />
                  ) : (
                    <Ionicons name={contentType === 'reel' ? 'videocam' : 'sparkles'} size={20} color="#fff" />
                  )}
                  <Text style={styles.generateButtonText}>
                    {isGenerating ? t('create.generating') : contentType === 'reel' ? t('create.generateReelScript') : t('create.generateContent')}
                  </Text>
                </LinearGradient>
              </Pressable>

              {generatedContent ? (
                <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                  <View style={styles.resultHeader}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.resultTitle, { color: colors.text }]}>{t('create.generatedContent')}</Text>
                  </View>
                  <Text style={[styles.resultContent, { color: colors.text }]}>{generatedContent}</Text>
                  <View style={styles.resultActions}>
                    <Pressable
                      onPress={() => handleSave('draft')}
                      style={[styles.saveButton, { backgroundColor: colors.inputBackground }]}
                    >
                      <Ionicons name="bookmark-outline" size={18} color={colors.text} />
                      <Text style={[styles.saveButtonText, { color: colors.text }]}>{t('create.saveDraft')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleSave('scheduled')}
                      style={[styles.saveButton, { backgroundColor: colors.primary }]}
                    >
                      <Ionicons name="calendar-outline" size={18} color="#fff" />
                      <Text style={[styles.saveButtonText, { color: '#fff' }]}>Schedule</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {reelScript && (
                <Animated.View entering={FadeInDown.duration(400)} style={[styles.reelScriptContainer, { backgroundColor: colors.card, borderColor: colors.accent }]}>
                  {/* Title */}
                  <LinearGradient colors={['#E1306C', '#833AB4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.reelTitleBanner}>
                    <Ionicons name="videocam" size={20} color="#fff" />
                    <Text style={styles.reelTitleText}>{reelScript.title || 'Reel Script'}</Text>
                  </LinearGradient>

                  {/* Hook Section */}
                  {reelScript.hook && (
                    <View style={[styles.reelSection, { borderColor: colors.cardBorder }]}>
                      <View style={styles.reelSectionHeader}>
                        <View style={[styles.reelBadge, { backgroundColor: '#E1306C' }]}>
                          <Ionicons name="flash" size={12} color="#fff" />
                          <Text style={styles.reelBadgeText}>{t('create.hookSection')}</Text>
                        </View>
                        <Text style={[styles.reelSectionNote, { color: colors.textMuted }]}>{t('create.firstSeconds')}</Text>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="eye-outline" size={16} color={colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.visualHook')}</Text>
                          <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.hook.visual}</Text>
                        </View>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="text-outline" size={16} color="#E1306C" />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.textOverlay')}</Text>
                          <Text style={[styles.reelHookOverlay, { color: colors.text }]}>{reelScript.hook.text_overlay}</Text>
                        </View>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="mic-outline" size={16} color="#833AB4" />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.voiceover')}</Text>
                          <Text style={[styles.reelDetailValue, { color: colors.text }]}>"{reelScript.hook.voiceover}"</Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Scenes */}
                  {reelScript.scenes?.map((scene: any, idx: number) => (
                    <Pressable
                      key={idx}
                      onPress={() => { Haptics.selectionAsync(); setExpandedScene(expandedScene === idx ? null : idx); }}
                      style={[styles.reelSection, { borderColor: colors.cardBorder }]}
                    >
                      <View style={styles.reelSectionHeader}>
                        <View style={[styles.reelBadge, { backgroundColor: colors.primary }]}>
                          <Text style={styles.reelBadgeText}>{t('create.scene')} {scene.scene_number || idx + 1}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.reelSectionNote, { color: colors.textMuted }]}>{scene.duration}</Text>
                          <Ionicons name={expandedScene === idx ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                        </View>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="camera-outline" size={16} color={colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.visualDirection')}</Text>
                          <Text style={[styles.reelDetailValue, { color: colors.text }]}>{scene.visual_direction}</Text>
                        </View>
                      </View>
                      {expandedScene === idx && (
                        <>
                          {scene.text_overlay && (
                            <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                              <Ionicons name="text-outline" size={16} color="#E1306C" />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.textOverlay')}</Text>
                                <Text style={[styles.reelDetailValue, { color: colors.text }]}>{scene.text_overlay}</Text>
                              </View>
                            </View>
                          )}
                          {scene.voiceover && (
                            <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                              <Ionicons name="mic-outline" size={16} color="#833AB4" />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.voiceover')}</Text>
                                <Text style={[styles.reelDetailValue, { color: colors.text }]}>"{scene.voiceover}"</Text>
                              </View>
                            </View>
                          )}
                          {scene.transition && (
                            <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                              <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.transition')}</Text>
                                <Text style={[styles.reelDetailValue, { color: colors.text }]}>{scene.transition}</Text>
                              </View>
                            </View>
                          )}
                          {scene.b_roll_suggestion && (
                            <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                              <Ionicons name="film-outline" size={16} color={colors.textMuted} />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.bRoll')}</Text>
                                <Text style={[styles.reelDetailValue, { color: colors.text }]}>{scene.b_roll_suggestion}</Text>
                              </View>
                            </View>
                          )}
                        </>
                      )}
                    </Pressable>
                  ))}

                  {/* Closing */}
                  {reelScript.closing && (
                    <View style={[styles.reelSection, { borderColor: colors.cardBorder }]}>
                      <View style={styles.reelSectionHeader}>
                        <View style={[styles.reelBadge, { backgroundColor: '#2ec4b6' }]}>
                          <Ionicons name="flag" size={12} color="#fff" />
                          <Text style={styles.reelBadgeText}>{t('create.closingSection')}</Text>
                        </View>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="camera-outline" size={16} color={colors.accent} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.visual')}</Text>
                          <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.closing.visual}</Text>
                        </View>
                      </View>
                      <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                        <Ionicons name="megaphone-outline" size={16} color="#E1306C" />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.cta')}</Text>
                          <Text style={[styles.reelHookOverlay, { color: colors.text }]}>{reelScript.closing.cta_text}</Text>
                          <Text style={[styles.reelDetailValue, { color: colors.textMuted }]}>"{reelScript.closing.cta_voiceover}"</Text>
                        </View>
                      </View>
                      {reelScript.closing.loop_trick && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="repeat-outline" size={16} color="#833AB4" />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.loopTrick')}</Text>
                            <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.closing.loop_trick}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Production Notes */}
                  {reelScript.production_notes && (
                    <View style={[styles.reelSection, { borderColor: colors.cardBorder }]}>
                      <View style={styles.reelSectionHeader}>
                        <View style={[styles.reelBadge, { backgroundColor: '#555' }]}>
                          <Ionicons name="construct" size={12} color="#fff" />
                          <Text style={styles.reelBadgeText}>{t('create.productionSection')}</Text>
                        </View>
                      </View>
                      {reelScript.production_notes.estimated_duration && (
                        <View style={styles.reelProdRow}>
                          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.reelProdLabel, { color: colors.textMuted }]}>{t('create.durationLabel')}</Text>
                          <Text style={[styles.reelProdValue, { color: colors.text }]}>{reelScript.production_notes.estimated_duration}</Text>
                        </View>
                      )}
                      {reelScript.production_notes.audio_direction && (
                        <View style={styles.reelProdRow}>
                          <Ionicons name="musical-notes-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.reelProdLabel, { color: colors.textMuted }]}>{t('create.audio')}</Text>
                          <Text style={[styles.reelProdValue, { color: colors.text }]}>{reelScript.production_notes.audio_direction}</Text>
                        </View>
                      )}
                      {reelScript.production_notes.lighting && (
                        <View style={styles.reelProdRow}>
                          <Ionicons name="sunny-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.reelProdLabel, { color: colors.textMuted }]}>{t('create.lighting')}</Text>
                          <Text style={[styles.reelProdValue, { color: colors.text }]}>{reelScript.production_notes.lighting}</Text>
                        </View>
                      )}
                      {reelScript.production_notes.props_needed && (
                        <View style={styles.reelProdRow}>
                          <Ionicons name="cube-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.reelProdLabel, { color: colors.textMuted }]}>{t('create.props')}</Text>
                          <Text style={[styles.reelProdValue, { color: colors.text }]}>{reelScript.production_notes.props_needed}</Text>
                        </View>
                      )}
                      {reelScript.production_notes.best_posting_time && (
                        <View style={styles.reelProdRow}>
                          <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                          <Text style={[styles.reelProdLabel, { color: colors.textMuted }]}>{t('create.bestTime')}</Text>
                          <Text style={[styles.reelProdValue, { color: colors.text }]}>{reelScript.production_notes.best_posting_time}</Text>
                        </View>
                      )}
                      {reelScript.production_notes.hashtag_strategy && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="pricetag-outline" size={14} color={colors.accent} />
                          <Text style={[styles.reelDetailValue, { color: colors.accent }]}>{reelScript.production_notes.hashtag_strategy}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Algorithm Optimization */}
                  {reelScript.algorithm_optimization && (
                    <View style={[styles.reelSection, { borderColor: colors.cardBorder }]}>
                      <View style={styles.reelSectionHeader}>
                        <LinearGradient colors={['#E1306C', '#833AB4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.reelBadge, { borderWidth: 0 }]}>
                          <Ionicons name="analytics" size={12} color="#fff" />
                          <Text style={styles.reelBadgeText}>{t('create.algorithmSection')}</Text>
                        </LinearGradient>
                      </View>
                      {reelScript.algorithm_optimization.share_trigger && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="share-social-outline" size={16} color="#E1306C" />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.shareTrigger')}</Text>
                            <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.algorithm_optimization.share_trigger}</Text>
                          </View>
                        </View>
                      )}
                      {reelScript.algorithm_optimization.save_trigger && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="bookmark-outline" size={16} color="#833AB4" />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.saveTrigger')}</Text>
                            <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.algorithm_optimization.save_trigger}</Text>
                          </View>
                        </View>
                      )}
                      {reelScript.algorithm_optimization.engagement_prompt && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="chatbubble-outline" size={16} color="#2ec4b6" />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.engagementPrompt')}</Text>
                            <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.algorithm_optimization.engagement_prompt}</Text>
                          </View>
                        </View>
                      )}
                      {reelScript.algorithm_optimization.repost_strategy && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground }]}>
                          <Ionicons name="layers-outline" size={16} color={colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted }]}>{t('create.repostStrategy')}</Text>
                            <Text style={[styles.reelDetailValue, { color: colors.text }]}>{reelScript.algorithm_optimization.repost_strategy}</Text>
                          </View>
                        </View>
                      )}
                      {reelScript.algorithm_optimization.retention_hooks?.length > 0 && (
                        <View style={[styles.reelDetailRow, { backgroundColor: colors.inputBackground, flexDirection: 'column', alignItems: 'flex-start' }]}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <Ionicons name="pulse-outline" size={16} color="#E1306C" />
                            <Text style={[styles.reelDetailLabel, { color: colors.textMuted, marginBottom: 0 }]}>{t('create.retentionHooks')}</Text>
                          </View>
                          {reelScript.algorithm_optimization.retention_hooks.map((hook: string, i: number) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 4, marginBottom: 4 }}>
                              <Text style={{ color: colors.accent, fontSize: 12 }}>{i + 1}.</Text>
                              <Text style={[styles.reelDetailValue, { color: colors.text, flex: 1 }]}>{hook}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </Animated.View>
              )}

              {ciScriptError && (
                <View style={[styles.card, { backgroundColor: '#EF4444' + '10', borderColor: '#EF4444' + '30' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name="alert-circle" size={16} color="#EF4444" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#EF4444' }}>Generation Error</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#EF4444' }}>{ciScriptError}</Text>
                </View>
              )}

              {ciScriptResult && ciScriptResult.scripts_batch && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: '#8B5CF6' + '40' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Ionicons name="film-outline" size={20} color="#8B5CF6" />
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>CI-Powered Scripts</Text>
                      <View style={{ backgroundColor: '#8B5CF6' + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#8B5CF6' }}>
                          MODE: {ciScriptResult.scripts_batch.mode_used?.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {ciScriptResult.scripts_batch.scripts?.map((script: any, si: number) => (
                      <View key={si} style={{ marginBottom: 14, paddingBottom: 14, borderBottomWidth: si < ciScriptResult.scripts_batch.scripts.length - 1 ? 1 : 0, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 6 }}>{si + 1}. {script.title}</Text>
                        <View style={{ gap: 5 }}>
                          {[
                            { label: '0-2s Hook', value: script.hook_0_2s, color: '#EF4444' },
                            { label: '2-6s Setup', value: script.setup_2_6s, color: '#F59E0B' },
                            { label: '6-12s Tension', value: script.tension_6_12s, color: '#3B82F6' },
                            { label: '12-18s Reveal', value: script.reveal_12_18s, color: '#10B981' },
                            { label: 'Close/CTA', value: script.soft_close_or_cta, color: '#8B5CF6' },
                          ].map((seg, idx) => (
                            <View key={idx} style={{ flexDirection: 'row', gap: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: seg.color, width: 80 }}>{seg.label}:</Text>
                              <Text style={{ fontSize: 11, color: colors.textSecondary, flex: 1 }}>{seg.value}</Text>
                            </View>
                          ))}
                        </View>
                        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 6 }}>Caption: {script.caption_short}</Text>
                        <View style={{ backgroundColor: '#3B82F6' + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: 4 }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: '#3B82F6' }}>KPI: {script.kpi_target?.toUpperCase()}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {ciScriptResult.creative_concepts && (
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: '#F59E0B' + '40' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <Ionicons name="bulb-outline" size={20} color="#F59E0B" />
                        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Creative Concepts</Text>
                        <View style={{ backgroundColor: '#F59E0B' + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B' }}>
                            RISK: {ciScriptResult.creative_concepts.risk_level?.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      {ciScriptResult.creative_concepts.concepts?.map((concept: any, ci: number) => (
                        <View key={ci} style={{ marginBottom: 10, paddingBottom: 10, borderBottomWidth: ci < ciScriptResult.creative_concepts.concepts.length - 1 ? 1 : 0, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }}>{concept.concept_name}</Text>
                          <Text style={{ fontSize: 11, color: '#EC4899', marginBottom: 2 }}>{concept.disruptive_angle}</Text>
                          <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>{concept.visual_metaphor}</Text>
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                            <View style={{ backgroundColor: '#6366F1' + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontWeight: '600', color: '#6366F1' }}>{concept.format?.toUpperCase()}</Text>
                            </View>
                            <View style={{ backgroundColor: '#EC4899' + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontWeight: '600', color: '#EC4899' }}>{concept.emotional_trigger}</Text>
                            </View>
                          </View>
                        </View>
                      ))}

                      {ciScriptResult.creative_concepts.subtle_conversion_layer && (
                        <View style={{ backgroundColor: '#10B981' + '10', padding: 8, borderRadius: 6, marginTop: 4 }}>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: '#10B981', marginBottom: 2 }}>Subtle Conversion Layer</Text>
                          <Text style={{ fontSize: 11, color: colors.textSecondary }}>{ciScriptResult.creative_concepts.subtle_conversion_layer}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </Animated.View>
              )}
            </>
          )}

          {activeTab === 'designer' && (
            <>
              {/* Generation Mode Selector */}
              <View style={[styles.modeBar, { backgroundColor: isDark ? '#1a2332' : '#f1f5f9' }]}>
                {generationModes.map(mode => (
                  <Pressable
                    key={mode.id}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setGenMode(mode.id);
                    }}
                    style={[
                      styles.modeItem,
                      genMode === mode.id && { backgroundColor: colors.accent + '20' },
                    ]}
                  >
                    <Ionicons
                      name={mode.icon}
                      size={18}
                      color={genMode === mode.id ? colors.accent : colors.textMuted}
                    />
                    <Text style={[
                      styles.modeLabel,
                      { color: genMode === mode.id ? colors.accent : colors.textMuted }
                    ]}>
                      {mode.label}
                    </Text>
                    <Text style={[styles.modeDesc, { color: colors.textMuted }]}>{mode.description}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Canvas / Preview Area */}
              {generatedPoster ? (
                <Pressable onPress={() => setFullScreenImage(generatedPoster)}>
                  <View style={[styles.canvasArea, { backgroundColor: isDark ? '#111827' : '#e5e7eb', height: canvasHeight }]}>
                    <Image
                      source={{ uri: generatedPoster }}
                      style={styles.canvasImage}
                      resizeMode="contain"
                    />
                    <View style={styles.canvasOverlayBadge}>
                      <Ionicons name="expand-outline" size={14} color="#fff" />
                      <Text style={styles.canvasOverlayText}>Tap to expand</Text>
                    </View>
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.canvasArea, styles.canvasEmpty, { backgroundColor: isDark ? '#111827' : '#e5e7eb', height: canvasHeight }]}>
                  <LinearGradient
                    colors={isDark ? ['#1e293b', '#0f172a'] : ['#f8fafc', '#e2e8f0']}
                    style={styles.canvasPlaceholder}
                  >
                    <View style={[styles.canvasPlaceholderIcon, { backgroundColor: colors.accent + '15' }]}>
                      <Ionicons name="image-outline" size={36} color={colors.accent} />
                    </View>
                    <Text style={[styles.canvasPlaceholderTitle, { color: colors.textSecondary }]}>
                      {t('create.designPlaceholder')}
                    </Text>
                    <Text style={[styles.canvasPlaceholderSub, { color: colors.textMuted }]}>
                      {aspectRatio} {'\u00B7'} {visualStyles.find(s => s.id === posterStyle)?.label || 'Cinematic'} style
                    </Text>
                  </LinearGradient>
                </View>
              )}

              {/* Quick Actions Bar for Generated Poster */}
              {generatedPoster && (
                <View style={styles.quickActionsBar}>
                  <Pressable
                    onPress={() => {
                      setGeneratedPoster(null);
                      handleGeneratePoster();
                    }}
                    style={[styles.quickAction, { backgroundColor: colors.inputBackground }]}
                  >
                    <Ionicons name="refresh" size={18} color={colors.text} />
                    <Text style={[styles.quickActionLabel, { color: colors.text }]}>Redo</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setFullScreenImage(generatedPoster)}
                    style={[styles.quickAction, { backgroundColor: colors.inputBackground }]}
                  >
                    <Ionicons name="expand" size={18} color={colors.text} />
                    <Text style={[styles.quickActionLabel, { color: colors.text }]}>Preview</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSavePoster}
                    style={[styles.quickAction, { backgroundColor: colors.accent }]}
                  >
                    <Ionicons name="download-outline" size={18} color="#fff" />
                    <Text style={[styles.quickActionLabel, { color: '#fff' }]}>Save</Text>
                  </Pressable>
                </View>
              )}

              {/* Visual Style Grid */}
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('create.style')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.styleGrid}>
                  {visualStyles.map(style => (
                    <StyleCard
                      key={style.id}
                      style={style}
                      isSelected={posterStyle === style.id}
                      onSelect={() => {
                        Haptics.selectionAsync();
                        setPosterStyle(style.id);
                      }}
                      colors={colors}
                      label={style.label}
                    />
                  ))}
                </ScrollView>
              </View>

              {/* Aspect Ratio Picker */}
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('create.aspectRatio')}</Text>
                <View style={styles.ratioRow}>
                  {aspectRatios.map(ratio => (
                    <Pressable
                      key={ratio.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setAspectRatio(ratio.id);
                      }}
                      style={[
                        styles.ratioButton,
                        {
                          backgroundColor: aspectRatio === ratio.id ? colors.accent + '18' : colors.inputBackground,
                          borderColor: aspectRatio === ratio.id ? colors.accent : 'transparent',
                        }
                      ]}
                    >
                      <View style={[
                        styles.ratioPreview,
                        {
                          aspectRatio: ratio.width / ratio.height,
                          borderColor: aspectRatio === ratio.id ? colors.accent : colors.textMuted + '40',
                        }
                      ]} />
                      <Text style={[styles.ratioLabel, { color: aspectRatio === ratio.id ? colors.accent : colors.textMuted }]}>
                        {ratio.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Prompt Input */}
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.text }]}>
                    {genMode === 'text-to-image' ? t('create.describeVision') : genMode === 'image-to-image' ? 'How to transform' : 'What to edit'}
                  </Text>
                </View>
                <TextInput
                  style={[styles.promptInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder={
                    genMode === 'text-to-image'
                      ? 'A stunning product photo with soft lighting, bokeh background, and elegant composition...'
                      : genMode === 'image-to-image'
                      ? 'Transform into a cinematic movie poster with dramatic lighting...'
                      : 'Change the background to a tropical beach setting...'
                  }
                  placeholderTextColor={colors.textMuted}
                  value={posterTopic}
                  onChangeText={setPosterTopic}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {/* Reference Photos */}
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionLabel, { color: colors.text }]}>
                    {t('create.referenceImages')}
                  </Text>
                  <Text style={[styles.sectionHint, { color: colors.textMuted }]}>{t('create.upTo3')}</Text>
                </View>
                <View style={styles.refPhotoRow}>
                  {referencePhotos.map((photo, i) => (
                    <ReferencePhotoSlot
                      key={i}
                      photo={photo}
                      index={i}
                      onPick={() => pickPhoto(i)}
                      onRemove={() => removePhoto(i)}
                      colors={colors}
                    />
                  ))}
                </View>
              </View>

              {/* Advanced Options Toggle */}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowAdvanced(!showAdvanced);
                }}
                style={[styles.advancedToggle, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              >
                <Ionicons name="options-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.advancedToggleText, { color: colors.textSecondary }]}>{t('create.advancedOptions')}</Text>
                <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </Pressable>

              {showAdvanced && (
                <>
                  {/* Mood Selector */}
                  <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('create.mood')}</Text>
                    <View style={styles.chipRow}>
                      {moodOptions.map(m => (
                        <Pressable
                          key={m.id}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setMood(m.id);
                          }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: mood === m.id ? colors.accent + '20' : colors.inputBackground,
                              borderColor: mood === m.id ? colors.accent : 'transparent',
                            }
                          ]}
                        >
                          <Text style={[styles.chipText, { color: mood === m.id ? colors.accent : colors.textMuted }]}>
                            {m.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* Text Overlay */}
                  <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('create.textOverlay')}</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                      placeholder="e.g., SUMMER SALE 50% OFF"
                      placeholderTextColor={colors.textMuted}
                      value={posterText}
                      onChangeText={setPosterText}
                    />
                  </View>
                </>
              )}

              {/* Generate Button */}
              <Pressable
                onPress={handleGeneratePoster}
                disabled={isGeneratingPoster}
                style={({ pressed }) => [
                  styles.generateDesignBtn,
                  { opacity: pressed ? 0.85 : 1 }
                ]}
              >
                <LinearGradient
                  colors={['#8B5CF6', '#7C3AED', '#34D399']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.generateDesignGradient}
                >
                  {isGeneratingPoster ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="flash" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateDesignText}>
                    {isGeneratingPoster ? t('create.generating') : t('create.generateDesign')}
                  </Text>
                </LinearGradient>
              </Pressable>

              {/* Generation History */}
              {generationHistory.length > 0 && (
                <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('create.recentCreations')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
                    {generationHistory.map(item => (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          setGeneratedPoster(item.imageUrl);
                          Haptics.selectionAsync();
                        }}
                        onLongPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          saveImageToGallery(item.imageUrl);
                        }}
                        style={styles.historyThumb}
                      >
                        <Image source={{ uri: item.imageUrl }} style={styles.historyImage} resizeMode="cover" />
                        <Pressable
                          onPress={() => saveImageToGallery(item.imageUrl)}
                          style={styles.historySaveBtn}
                        >
                          <Ionicons name="download-outline" size={14} color="#fff" />
                        </Pressable>
                        {generatedPoster === item.imageUrl && (
                          <View style={[styles.historyActive, { borderColor: colors.accent }]}>
                            <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Powered by badge */}
              <View style={styles.poweredBy}>
                <Text style={[styles.poweredByText, { color: colors.textMuted }]}>
                  {t('create.poweredBy')}
                </Text>
              </View>
            </>
          )}

          {activeTab === 'video' && (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.cardHeader}>
                  <LinearGradient
                    colors={['#7C3AED', '#A855F7', '#7C3AED']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name="videocam" size={20} color="#fff" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0 }]}>Veo 3.1 Video Studio</Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                      Google Veo 3.1 AI Video Generation
                    </Text>
                  </View>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
                {veoModeTabs.map(tab => (
                  <Pressable
                    key={tab.id}
                    onPress={() => { Haptics.selectionAsync(); setVeoMode(tab.id); }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 20,
                      borderWidth: 1.5,
                      backgroundColor: veoMode === tab.id ? '#7C3AED15' : colors.inputBackground,
                      borderColor: veoMode === tab.id ? '#7C3AED' : 'transparent',
                    }}
                  >
                    <Ionicons name={tab.icon} size={16} color={veoMode === tab.id ? '#7C3AED' : colors.textMuted} />
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: veoMode === tab.id ? '#7C3AED' : colors.textMuted }}>{tab.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Describe your video</Text>
                <TextInput
                  style={[styles.promptInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="A cinematic drone shot over a modern city at sunset, golden hour lighting..."
                  placeholderTextColor={colors.textMuted}
                  value={videoPrompt}
                  onChangeText={setVideoPrompt}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {veoMode === 'image-to-video' && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>Reference Image</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
                    Animate this image into a video
                  </Text>
                  {videoStartImage ? (
                    <View style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
                      <Image source={{ uri: videoStartImage.uri }} style={{ width: '100%', height: 180, borderRadius: 14 }} resizeMode="cover" />
                      <Pressable onPress={() => setVideoStartImage(null)} style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="close" size={18} color="#fff" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => pickVeoImage(setVideoStartImage)} style={{ borderWidth: 1.5, borderStyle: 'dashed' as const, borderColor: '#7C3AED40', borderRadius: 14, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBackground, gap: 8 }}>
                      <Ionicons name="image-outline" size={32} color="#7C3AED" />
                      <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: '#7C3AED' }}>Choose Image</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Aspect Ratio</Text>
                <View style={styles.reelOptionRow}>
                  {videoAspectOptions.map(a => (
                    <Pressable
                      key={a.id}
                      onPress={() => { Haptics.selectionAsync(); setVideoAspect(a.id); }}
                      style={[styles.reelChip, { backgroundColor: videoAspect === a.id ? '#7C3AED20' : colors.inputBackground, borderColor: videoAspect === a.id ? '#7C3AED' : 'transparent' }]}
                    >
                      <Ionicons name={a.icon} size={16} color={videoAspect === a.id ? '#7C3AED' : colors.textMuted} />
                      <Text style={[styles.reelChipText, { color: videoAspect === a.id ? '#7C3AED' : colors.textMuted }]}>{a.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Duration</Text>
                <View style={styles.reelOptionRow}>
                  {videoDurationOptions.map(d => (
                    <Pressable
                      key={d.id}
                      onPress={() => { Haptics.selectionAsync(); setVideoDuration(d.id); }}
                      style={[styles.reelChip, { backgroundColor: videoDuration === d.id ? '#7C3AED20' : colors.inputBackground, borderColor: videoDuration === d.id ? '#7C3AED' : 'transparent' }]}
                    >
                      <Text style={[styles.reelChipText, { color: videoDuration === d.id ? '#7C3AED' : colors.textMuted }]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable
                onPress={handleGenerateVideo}
                disabled={isGeneratingVideo || !videoPrompt.trim()}
                style={[styles.generateDesignBtn, { opacity: (isGeneratingVideo || !videoPrompt.trim()) ? 0.5 : 1 }]}
              >
                <LinearGradient
                  colors={['#7C3AED', '#A855F7', '#7C3AED']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.generateDesignGradient}
                >
                  {isGeneratingVideo ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateDesignText}>
                    {isGeneratingVideo ? 'Generating...' : 'Generate Video'}
                  </Text>
                </LinearGradient>
              </Pressable>

              {isGeneratingVideo && videoStatus && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 30 }]}>
                  <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#7C3AED15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <ActivityIndicator size="large" color="#7C3AED" />
                  </View>
                  <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.text, marginBottom: 4 }}>
                    {videoStatus === 'starting' ? 'Starting...' :
                     videoStatus === 'processing' ? 'Rendering video...' :
                     videoStatus === 'generating' ? 'Generating...' :
                     videoStatus.includes('uploading') ? videoStatus :
                     'Processing...'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_400Regular', textAlign: 'center' }}>
                    This usually takes 1-3 minutes. You can wait here.
                  </Text>
                </View>
              )}

              {videoError && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: '#EF444440' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="alert-circle" size={20} color="#EF4444" />
                    <Text style={{ fontSize: 14, color: '#EF4444', fontFamily: 'Inter_500Medium', flex: 1 }}>{videoError}</Text>
                  </View>
                  <Pressable onPress={() => setVideoError(null)} style={{ marginTop: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>Dismiss</Text>
                  </Pressable>
                </View>
              )}

              {videoUrl && (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: '#7C3AED40' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Ionicons name="checkmark-circle" size={20} color="#7C3AED" />
                    <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.text }}>Video Ready</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === 'web') {
                        const link = document.createElement('a');
                        link.href = videoUrl;
                        link.target = '_blank';
                        link.click();
                      } else {
                        Alert.alert('Video URL', videoUrl);
                      }
                    }}
                    style={{ backgroundColor: '#7C3AED15', borderRadius: 12, padding: 16, alignItems: 'center', gap: 8 }}
                  >
                    <Ionicons name="play-circle" size={48} color="#7C3AED" />
                    <Text style={{ fontSize: 14, fontFamily: 'Inter_500Medium', color: '#7C3AED' }}>Open Video</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setVideoUrl(null); setVideoPrompt(''); setVideoOperationName(null); setVideoStatus(null); }}
                    style={{ marginTop: 12, alignItems: 'center', paddingVertical: 10 }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textMuted }}>Generate another video</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.poweredBy}>
                <Text style={[styles.poweredByText, { color: colors.textMuted }]}>
                  Powered by Google Veo 3.1
                </Text>
              </View>
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

        <DesignerLoadingOverlay isVisible={isGeneratingPoster} />

        {/* Full Screen Image Modal */}
        <Modal
          visible={!!fullScreenImage}
          transparent
          animationType="fade"
          onRequestClose={() => setFullScreenImage(null)}
        >
          <View style={styles.fullScreenModal}>
            <Pressable style={styles.fullScreenClose} onPress={() => setFullScreenImage(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            <Pressable
              style={styles.fullScreenSave}
              onPress={() => {
                if (fullScreenImage) saveImageToGallery(fullScreenImage);
              }}
            >
              <Ionicons name="download-outline" size={24} color="#fff" />
            </Pressable>
            {fullScreenImage && (
              <Image
                source={{ uri: fullScreenImage }}
                style={styles.fullScreenImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
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
    marginBottom: 20,
  },
  engineToggle: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  engineBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
  },
  engineBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
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
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 12,
  },
  contentTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  contentTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  contentTypeLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  reelOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  reelChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  reelScriptContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  reelTitleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  reelTitleText: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    flex: 1,
  },
  reelSection: {
    padding: 14,
    borderBottomWidth: 1,
    gap: 8,
  },
  reelSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  reelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reelBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.5,
  },
  reelSectionNote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  reelDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  reelDetailLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginBottom: 3,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  reelDetailValue: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  reelHookOverlay: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    lineHeight: 22,
  },
  reelProdRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    flexWrap: 'wrap',
  },
  reelProdLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  reelProdValue: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  textArea: {
    minHeight: 80,
  },
  generateButton: {
    marginBottom: 20,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  generateButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  resultCard: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  resultContent: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    marginBottom: 16,
  },
  resultActions: {
    flexDirection: 'row',
    gap: 12,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },

  // === AI Designer Styles ===
  modeBar: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  modeItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    gap: 3,
  },
  modeLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  modeDesc: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },

  canvasArea: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  canvasEmpty: {},
  canvasImage: {
    width: '100%',
    height: '100%',
  },
  canvasPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  canvasPlaceholderIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  canvasPlaceholderTitle: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  canvasPlaceholderSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  canvasOverlayBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  canvasOverlayText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#fff',
  },

  quickActionsBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  quickActionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },

  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },

  styleGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingRight: 8,
  },
  styleCardWrapper: {
    alignItems: 'center',
    gap: 6,
  },
  styleCard: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  styleCardCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  styleCardLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },

  ratioRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ratioButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
  },
  ratioPreview: {
    width: 24,
    height: 24,
    maxWidth: 24,
    maxHeight: 24,
    borderWidth: 1.5,
    borderRadius: 4,
  },
  ratioLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },

  promptInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
    lineHeight: 20,
  },

  refPhotoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  refPhotoEmpty: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refPhotoFilled: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  refPhotoImage: {
    width: '100%',
    height: '100%',
  },
  refPhotoRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
  },

  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  advancedToggleText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },

  generateDesignBtn: {
    marginBottom: 16,
  },
  generateDesignGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
  },
  generateDesignText: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.3,
  },

  historyRow: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 8,
  },
  historyThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
  },
  historyImage: {
    width: '100%',
    height: '100%',
  },
  historyActive: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    padding: 2,
  },
  historySaveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  poweredBy: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  poweredByText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  loadingContent: {
    alignItems: 'center',
    gap: 16,
    padding: 40,
  },
  loadingIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIconInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  loadingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  loadingDots: {
    marginTop: 8,
  },

  fullScreenModal: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenSave: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenImage: {
    width: '92%',
    height: '75%',
  },
});
