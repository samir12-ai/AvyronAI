import React, { useState, useRef, useCallback } from 'react';
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
import { PlatformPicker } from '@/components/PlatformPicker';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { generateId } from '@/lib/storage';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import type { ContentItem, MediaItem } from '@/lib/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const contentTypes = [
  { id: 'post', label: 'Post', icon: 'document-text-outline' as const },
  { id: 'caption', label: 'Caption', icon: 'text-outline' as const },
  { id: 'ad', label: 'Ad Copy', icon: 'megaphone-outline' as const },
  { id: 'story', label: 'Story', icon: 'layers-outline' as const },
];

type GenerationMode = 'text-to-image' | 'image-to-image' | 'image-edit';

const generationModes = [
  { id: 'text-to-image' as GenerationMode, label: 'Create', icon: 'sparkles' as const, description: 'From text prompt' },
  { id: 'image-to-image' as GenerationMode, label: 'Transform', icon: 'color-wand' as const, description: 'Reimagine a photo' },
  { id: 'image-edit' as GenerationMode, label: 'Edit', icon: 'crop' as const, description: 'Modify an image' },
];

const visualStyles = [
  { id: 'cinematic', label: 'Cinematic', gradient: ['#1a1a2e', '#16213e', '#0f3460'] as const, icon: 'film-outline' as const },
  { id: 'professional', label: 'Professional', gradient: ['#2c3e50', '#3498db', '#2980b9'] as const, icon: 'briefcase-outline' as const },
  { id: 'commercial', label: 'Commercial', gradient: ['#e74c3c', '#c0392b', '#e74c3c'] as const, icon: 'storefront-outline' as const },
  { id: 'indie', label: 'Indie', gradient: ['#f39c12', '#e67e22', '#d35400'] as const, icon: 'leaf-outline' as const },
  { id: 'minimal', label: 'Minimal', gradient: ['#ecf0f1', '#bdc3c7', '#95a5a6'] as const, icon: 'remove-outline' as const },
  { id: 'vibrant', label: 'Vibrant', gradient: ['#8e44ad', '#9b59b6', '#e91e63'] as const, icon: 'color-palette-outline' as const },
];

const aspectRatios = [
  { id: '1:1', label: 'Square', width: 1, height: 1, icon: 'square-outline' as const },
  { id: '4:5', label: 'Portrait', width: 4, height: 5, icon: 'phone-portrait-outline' as const },
  { id: '16:9', label: 'Landscape', width: 16, height: 9, icon: 'tablet-landscape-outline' as const },
  { id: '9:16', label: 'Story', width: 9, height: 16, icon: 'phone-portrait-outline' as const },
];

const moodOptions = [
  { id: 'energetic', label: 'Energetic' },
  { id: 'calm', label: 'Calm' },
  { id: 'dramatic', label: 'Dramatic' },
  { id: 'playful', label: 'Playful' },
  { id: 'luxurious', label: 'Luxurious' },
  { id: 'warm', label: 'Warm' },
];

interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  style: string;
  createdAt: string;
}

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
            colors={['#14B8A6', '#06B6D4', '#8B5CF6']}
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

function StyleCard({ style, isSelected, onSelect, colors }: {
  style: typeof visualStyles[0];
  isSelected: boolean;
  onSelect: () => void;
  colors: any;
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
        {style.label}
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

  const [activeTab, setActiveTab] = useState<'content' | 'designer'>('content');
  
  const [contentType, setContentType] = useState<string>('post');
  const [platform, setPlatform] = useState<string[]>(['Instagram']);
  const [topic, setTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [genMode, setGenMode] = useState<GenerationMode>('text-to-image');
  const [posterTopic, setPosterTopic] = useState('');
  const [posterStyle, setPosterStyle] = useState('cinematic');
  const [posterText, setPosterText] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [mood, setMood] = useState('energetic');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generatedPoster, setGeneratedPoster] = useState<string | null>(null);
  const [isGeneratingPoster, setIsGeneratingPoster] = useState(false);
  const [referencePhotos, setReferencePhotos] = useState<(ImagePicker.ImagePickerAsset | null)[]>([null, null, null]);
  const [generationHistory, setGenerationHistory] = useState<GeneratedImage[]>([]);
  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      Alert.alert('Missing Topic', 'Please enter a topic or idea for your content.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGenerating(true);
    setGeneratedContent('');

    try {
      const response = await apiRequest('POST', '/api/generate-content', {
        topic,
        contentType,
        platform: platform[0],
        brandName: brandProfile.name || 'our brand',
        tone: brandProfile.tone || 'Professional',
        targetAudience: brandProfile.targetAudience || 'general audience',
        industry: brandProfile.industry || 'business',
      });

      const data = await response.json();
      setGeneratedContent(data.content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Generation error:', error);
      Alert.alert('Error', 'Failed to generate content. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async (status: 'draft' | 'scheduled') => {
    if (!generatedContent.trim()) {
      Alert.alert('No Content', 'Please generate content first.');
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
    
    setTopic('');
    setGeneratedContent('');
    
    Alert.alert('Saved!', `Content saved as ${status}.`);
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

      const firstPhoto = referencePhotos.find(p => p !== null);
      if (firstPhoto) {
        if (Platform.OS === 'web' && firstPhoto.base64) {
          const byteString = atob(firstPhoto.base64);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: firstPhoto.mimeType || 'image/jpeg' });
          formData.append('photo', blob, 'photo.jpg');
        } else {
          const photoUri = firstPhoto.uri;
          const photoName = photoUri.split('/').pop() || 'photo.jpg';
          formData.append('photo', {
            uri: photoUri,
            name: photoName,
            type: firstPhoto.mimeType || 'image/jpeg',
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
    await saveImageToGallery(generatedPoster);
  };

  const selectedRatio = aspectRatios.find(r => r.id === aspectRatio) || aspectRatios[0];
  const canvasAspect = selectedRatio.width / selectedRatio.height;
  const canvasWidth = SCREEN_WIDTH - 40;
  const canvasHeight = Math.min(canvasWidth / canvasAspect, 500);

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
          <Text style={[styles.title, { color: colors.text }]}>Content Studio</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Create AI-powered content and designs
          </Text>

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
                AI Writer
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
                AI Designer
              </Text>
            </Pressable>
          </View>

          {activeTab === 'content' ? (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Content Type</Text>
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
                <Text style={[styles.cardTitle, { color: colors.text }]}>Platform</Text>
                <PlatformPicker selected={platform} onChange={setPlatform} single />
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Topic or Idea</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="Describe what you want to create..."
                  placeholderTextColor={colors.textMuted}
                  value={topic}
                  onChangeText={setTopic}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <Pressable
                onPress={handleGenerate}
                disabled={isGenerating}
                style={({ pressed }) => [
                  styles.generateButton,
                  { opacity: pressed ? 0.8 : 1 }
                ]}
              >
                <LinearGradient
                  colors={colors.primaryGradient as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientButton}
                >
                  {isGenerating ? (
                    <LoadingSpinner size={20} color="#fff" />
                  ) : (
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateButtonText}>
                    {isGenerating ? 'Generating...' : 'Generate Content'}
                  </Text>
                </LinearGradient>
              </Pressable>

              {generatedContent ? (
                <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                  <View style={styles.resultHeader}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.resultTitle, { color: colors.text }]}>Generated Content</Text>
                  </View>
                  <Text style={[styles.resultContent, { color: colors.text }]}>{generatedContent}</Text>
                  <View style={styles.resultActions}>
                    <Pressable
                      onPress={() => handleSave('draft')}
                      style={[styles.saveButton, { backgroundColor: colors.inputBackground }]}
                    >
                      <Ionicons name="bookmark-outline" size={18} color={colors.text} />
                      <Text style={[styles.saveButtonText, { color: colors.text }]}>Save Draft</Text>
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
            </>
          ) : (
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
                      Your design will appear here
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
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Style</Text>
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
                    />
                  ))}
                </ScrollView>
              </View>

              {/* Aspect Ratio Picker */}
              <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.sectionLabel, { color: colors.text }]}>Aspect Ratio</Text>
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
                    {genMode === 'text-to-image' ? 'Describe your vision' : genMode === 'image-to-image' ? 'How to transform' : 'What to edit'}
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
                    Reference Images
                  </Text>
                  <Text style={[styles.sectionHint, { color: colors.textMuted }]}>Up to 3</Text>
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
                <Text style={[styles.advancedToggleText, { color: colors.textSecondary }]}>Advanced Options</Text>
                <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </Pressable>

              {showAdvanced && (
                <>
                  {/* Mood Selector */}
                  <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.sectionLabel, { color: colors.text }]}>Mood</Text>
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
                    <Text style={[styles.sectionLabel, { color: colors.text }]}>Text Overlay</Text>
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
                  colors={['#14B8A6', '#06B6D4', '#8B5CF6']}
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
                    {isGeneratingPoster ? 'Creating...' : 'Generate Design'}
                  </Text>
                </LinearGradient>
              </Pressable>

              {/* Generation History */}
              {generationHistory.length > 0 && (
                <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.sectionLabel, { color: colors.text }]}>Recent Creations</Text>
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
                  Powered by Nano Banana Pro
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
