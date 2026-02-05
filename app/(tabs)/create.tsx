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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { PlatformPicker } from '@/components/PlatformPicker';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { generateId } from '@/lib/storage';
import { apiRequest } from '@/lib/query-client';
import type { ContentItem } from '@/lib/types';

const contentTypes = [
  { id: 'post', label: 'Post', icon: 'document-text-outline' as const },
  { id: 'caption', label: 'Caption', icon: 'text-outline' as const },
  { id: 'ad', label: 'Ad Copy', icon: 'megaphone-outline' as const },
  { id: 'story', label: 'Story', icon: 'layers-outline' as const },
];

export default function CreateScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { brandProfile, addContentItem } = useApp();

  const [contentType, setContentType] = useState<string>('post');
  const [platform, setPlatform] = useState<string[]>(['Instagram']);
  const [topic, setTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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
          <Text style={[styles.title, { color: colors.text }]}>AI Content Studio</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Create engaging content with AI assistance
          </Text>

          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>Content Type</Text>
            <View style={styles.typeGrid}>
              {contentTypes.map(type => (
                <Pressable
                  key={type.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setContentType(type.id);
                  }}
                  style={[
                    styles.typeButton,
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
                    styles.typeLabel,
                    { color: contentType === type.id ? colors.primary : colors.textMuted }
                  ]}>
                    {type.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>Platform</Text>
            <PlatformPicker selected={platform} onChange={setPlatform} single />
          </View>

          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>Topic or Idea</Text>
            <TextInput
              style={[
                styles.input,
                { 
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                }
              ]}
              placeholder="e.g., Summer sale promotion, New product launch..."
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
              { opacity: pressed || isGenerating ? 0.8 : 1 }
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
                {isGenerating ? 'Generating...' : 'Generate with AI'}
              </Text>
            </LinearGradient>
          </Pressable>

          {generatedContent ? (
            <View style={styles.section}>
              <Text style={[styles.label, { color: colors.text }]}>Generated Content</Text>
              <View style={[styles.contentCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <TextInput
                  style={[styles.contentText, { color: colors.text }]}
                  value={generatedContent}
                  onChangeText={setGeneratedContent}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.actionButtons}>
                <Pressable
                  onPress={() => handleSave('draft')}
                  style={[styles.actionButton, { backgroundColor: colors.inputBackground }]}
                >
                  <Ionicons name="document-outline" size={18} color={colors.text} />
                  <Text style={[styles.actionButtonText, { color: colors.text }]}>Save Draft</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleSave('scheduled')}
                  style={[styles.actionButton, { backgroundColor: colors.accent }]}
                >
                  <Ionicons name="calendar-outline" size={18} color="#fff" />
                  <Text style={[styles.actionButtonText, { color: '#fff' }]}>Schedule</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={{ height: 100 }} />
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
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 12,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1.5,
  },
  typeLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 100,
  },
  generateButton: {
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
  generateButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  contentCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
  },
  contentText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
