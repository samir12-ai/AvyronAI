import React, { useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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

const contentTypes = [
  { id: 'post', label: 'Post', icon: 'document-text-outline' as const },
  { id: 'caption', label: 'Caption', icon: 'text-outline' as const },
  { id: 'ad', label: 'Ad Copy', icon: 'megaphone-outline' as const },
  { id: 'story', label: 'Story', icon: 'layers-outline' as const },
];

const posterStyles = [
  { id: 'modern', label: 'Modern', color: '#6366F1' },
  { id: 'minimal', label: 'Minimal', color: '#10B981' },
  { id: 'bold', label: 'Bold', color: '#F59E0B' },
  { id: 'elegant', label: 'Elegant', color: '#EC4899' },
  { id: 'vibrant', label: 'Vibrant', color: '#8B5CF6' },
];

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

  const [posterTopic, setPosterTopic] = useState('');
  const [posterStyle, setPosterStyle] = useState('modern');
  const [posterText, setPosterText] = useState('');
  const [generatedPoster, setGeneratedPoster] = useState<string | null>(null);
  const [isGeneratingPoster, setIsGeneratingPoster] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);

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

  const pickPhoto = async () => {
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
      setSelectedPhoto(result.assets[0]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleGeneratePoster = async () => {
    if (!posterTopic.trim()) {
      Alert.alert('Missing Topic', 'Please describe what you want on the poster.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGeneratingPoster(true);

    try {
      const apiUrl = getApiUrl();
      const formData = new FormData();
      formData.append('topic', posterTopic);
      formData.append('style', posterStyle);
      formData.append('text', posterText);
      formData.append('brandName', brandProfile.name || 'Brand');
      formData.append('industry', brandProfile.industry || 'business');

      if (selectedPhoto) {
        if (Platform.OS === 'web' && selectedPhoto.base64) {
          const byteString = atob(selectedPhoto.base64);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: selectedPhoto.mimeType || 'image/jpeg' });
          formData.append('photo', blob, 'photo.jpg');
        } else {
          const photoUri = selectedPhoto.uri;
          const photoName = photoUri.split('/').pop() || 'photo.jpg';
          formData.append('photo', {
            uri: photoUri,
            name: photoName,
            type: selectedPhoto.mimeType || 'image/jpeg',
          } as any);
        }
      }

      const response = await fetch(new URL('/api/generate-poster', apiUrl).toString(), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate poster');
      }

      const data = await response.json();
      setGeneratedPoster(data.imageUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error('Poster generation error:', error);
      Alert.alert('Generation Error', error.message || 'Failed to generate poster. Please try again.');
    } finally {
      setIsGeneratingPoster(false);
    }
  };

  const handleSavePoster = async () => {
    if (!generatedPoster) {
      Alert.alert('No Poster', 'Please generate a poster first.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newMedia: MediaItem = {
      id: generateId(),
      type: 'poster',
      title: posterTopic || 'Marketing Poster',
      uri: generatedPoster,
      platform: platform[0],
      status: 'draft',
      createdAt: new Date().toISOString(),
    };

    await addMediaItem(newMedia);
    
    setPosterTopic('');
    setPosterText('');
    setGeneratedPoster(null);
    setSelectedPhoto(null);
    
    Alert.alert('Saved!', 'Poster saved to your Studio library.');
  };

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
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.cardHeader}>
                  <Ionicons name="color-palette" size={20} color={colors.accent} />
                  <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0 }]}>Poster Style</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.styleRow}>
                    {posterStyles.map(style => (
                      <Pressable
                        key={style.id}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setPosterStyle(style.id);
                        }}
                        style={[
                          styles.styleButton,
                          { 
                            backgroundColor: posterStyle === style.id ? style.color + '20' : colors.inputBackground,
                            borderColor: posterStyle === style.id ? style.color : 'transparent',
                          }
                        ]}
                      >
                        <View style={[styles.styleIndicator, { backgroundColor: style.color }]} />
                        <Text style={[
                          styles.styleLabel,
                          { color: posterStyle === style.id ? style.color : colors.textMuted }
                        ]}>
                          {style.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Poster Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="Describe the marketing poster you want to create..."
                  placeholderTextColor={colors.textMuted}
                  value={posterTopic}
                  onChangeText={setPosterTopic}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.cardHeader}>
                  <Ionicons name="images-outline" size={20} color={colors.accent} />
                  <Text style={[styles.cardTitle, { color: colors.text, marginBottom: 0 }]}>Reference Photo (optional)</Text>
                </View>
                <Text style={[styles.photoHint, { color: colors.textMuted }]}>
                  Upload a photo from your gallery to use as design inspiration
                </Text>
                {selectedPhoto ? (
                  <View style={styles.photoPreviewContainer}>
                    <Image
                      source={{ uri: selectedPhoto.uri }}
                      style={styles.photoPreview}
                      resizeMode="cover"
                    />
                    <View style={styles.photoActions}>
                      <Pressable
                        onPress={pickPhoto}
                        style={[styles.photoActionBtn, { backgroundColor: colors.inputBackground }]}
                      >
                        <Ionicons name="swap-horizontal" size={18} color={colors.text} />
                        <Text style={[styles.photoActionText, { color: colors.text }]}>Change</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setSelectedPhoto(null)}
                        style={[styles.photoActionBtn, { backgroundColor: colors.error + '15' }]}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                        <Text style={[styles.photoActionText, { color: colors.error }]}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={pickPhoto}
                    style={[styles.photoUploadArea, { borderColor: colors.accent + '40', backgroundColor: colors.accent + '08' }]}
                  >
                    <Ionicons name="cloud-upload-outline" size={32} color={colors.accent} />
                    <Text style={[styles.photoUploadText, { color: colors.accent }]}>
                      Tap to select a photo
                    </Text>
                    <Text style={[styles.photoUploadSubtext, { color: colors.textMuted }]}>
                      JPG, PNG up to 10MB
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Text on Poster (optional)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                  placeholder="e.g., 50% OFF - Limited Time!"
                  placeholderTextColor={colors.textMuted}
                  value={posterText}
                  onChangeText={setPosterText}
                />
              </View>

              <Pressable
                onPress={handleGeneratePoster}
                disabled={isGeneratingPoster}
                style={({ pressed }) => [
                  styles.generateButton,
                  { opacity: pressed ? 0.8 : 1 }
                ]}
              >
                <LinearGradient
                  colors={[colors.accent, '#0D9488'] as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradientButton}
                >
                  {isGeneratingPoster ? (
                    <LoadingSpinner size={20} color="#fff" />
                  ) : (
                    <Ionicons name="brush" size={20} color="#fff" />
                  )}
                  <Text style={styles.generateButtonText}>
                    {isGeneratingPoster ? 'Designing...' : 'Generate Poster'}
                  </Text>
                </LinearGradient>
              </Pressable>

              {generatedPoster ? (
                <View style={[styles.posterPreview, { backgroundColor: colors.card, borderColor: colors.accent }]}>
                  <View style={styles.resultHeader}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Text style={[styles.resultTitle, { color: colors.text }]}>Generated Poster</Text>
                  </View>
                  <View style={[styles.posterContainer, { backgroundColor: colors.inputBackground }]}>
                    <Image
                      source={{ uri: generatedPoster }}
                      style={styles.generatedPosterImage}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={styles.posterButtonRow}>
                    <Pressable
                      onPress={() => {
                        setGeneratedPoster(null);
                        handleGeneratePoster();
                      }}
                      style={({ pressed }) => [
                        styles.posterSecondaryBtn,
                        { backgroundColor: colors.inputBackground, opacity: pressed ? 0.7 : 1 }
                      ]}
                    >
                      <Ionicons name="refresh" size={18} color={colors.text} />
                      <Text style={[styles.posterSecondaryText, { color: colors.text }]}>Regenerate</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSavePoster}
                      style={({ pressed }) => [
                        styles.savePosterButton,
                        { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }
                      ]}
                    >
                      <Ionicons name="save" size={18} color="#fff" />
                      <Text style={styles.savePosterText}>Save to Studio</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
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
  styleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  styleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  styleIndicator: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  styleLabel: {
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
  posterPreview: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
    gap: 16,
  },
  posterContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    aspectRatio: 1,
  },
  generatedPosterImage: {
    width: '100%',
    height: '100%',
  },
  photoHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },
  photoUploadArea: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoUploadText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  photoUploadSubtext: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  photoPreviewContainer: {
    gap: 10,
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 10,
  },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  photoActionText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  posterButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  posterSecondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  posterSecondaryText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  savePosterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  savePosterText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
