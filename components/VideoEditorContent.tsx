import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { getApiUrl , authFetch } from '@/lib/query-client';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface UploadedClip {
  filename: string;
  originalName: string;
  path: string;
  size: number;
  duration: number;
  width: number;
  height: number;
}

interface VideoProject {
  id: string;
  title: string;
  status: string;
  outputUrl?: string;
  duration?: number;
  createdAt: string;
}

type EditStyle = 'cinematic' | 'energetic' | 'minimal' | 'documentary' | 'social' | 'commercial';
type EditMood = 'energetic' | 'calm' | 'dramatic' | 'playful' | 'luxurious' | 'warm';
type EditPace = 'slow' | 'medium' | 'fast';
type VideoType = 'promo' | 'reel' | 'ad' | 'story' | 'recap' | 'tutorial';

const STYLES: { id: EditStyle; icon: string; label: string }[] = [
  { id: 'cinematic', icon: 'film-outline', label: 'Cinematic' },
  { id: 'energetic', icon: 'flash-outline', label: 'Energetic' },
  { id: 'minimal', icon: 'remove-outline', label: 'Minimal' },
  { id: 'documentary', icon: 'videocam-outline', label: 'Documentary' },
  { id: 'social', icon: 'phone-portrait-outline', label: 'Social' },
  { id: 'commercial', icon: 'megaphone-outline', label: 'Commercial' },
];

const MOODS: { id: EditMood; label: string; color: string }[] = [
  { id: 'energetic', label: 'Energetic', color: '#F59E0B' },
  { id: 'calm', label: 'Calm', color: '#3B82F6' },
  { id: 'dramatic', label: 'Dramatic', color: '#EF4444' },
  { id: 'playful', label: 'Playful', color: '#EC4899' },
  { id: 'luxurious', label: 'Luxurious', color: '#8B5CF6' },
  { id: 'warm', label: 'Warm', color: '#F97316' },
];

const VIDEO_TYPES: { id: VideoType; icon: string; label: string; desc: string }[] = [
  { id: 'promo', icon: 'megaphone-outline', label: 'Promo Video', desc: 'Brand or product promotion' },
  { id: 'reel', icon: 'phone-portrait-outline', label: 'Social Reel', desc: 'Short-form for Instagram/TikTok' },
  { id: 'ad', icon: 'pricetag-outline', label: 'Video Ad', desc: 'Paid advertising creative' },
  { id: 'story', icon: 'book-outline', label: 'Brand Story', desc: 'Tell your brand narrative' },
  { id: 'recap', icon: 'calendar-outline', label: 'Event Recap', desc: 'Highlights from events' },
  { id: 'tutorial', icon: 'school-outline', label: 'Tutorial/How-To', desc: 'Educational content' },
];

const QUICK_PROMPTS: { label: string; prompt: string; type: VideoType; style: EditStyle; mood: EditMood; pace: EditPace }[] = [
  {
    label: 'Product Launch Hype',
    prompt: 'Create an exciting product launch video with fast cuts, bold text reveals, and high-energy transitions. Focus on building anticipation and ending with a strong call-to-action.',
    type: 'promo', style: 'energetic', mood: 'energetic', pace: 'fast',
  },
  {
    label: 'Cinematic Brand Film',
    prompt: 'Create a cinematic brand story with smooth transitions, warm color grading, and deliberate pacing. Let each shot breathe and tell a visual narrative with emotional depth.',
    type: 'story', style: 'cinematic', mood: 'warm', pace: 'slow',
  },
  {
    label: 'Instagram Reel',
    prompt: 'Create a punchy social media reel with trending-style edits, quick transitions, and text overlays. Keep it under 30 seconds, fast-paced, and visually engaging from the first frame.',
    type: 'reel', style: 'social', mood: 'playful', pace: 'fast',
  },
  {
    label: 'Luxury Showcase',
    prompt: 'Create an elegant, premium-feel video with slow-motion reveals, sophisticated transitions, and refined color grading. Emphasize quality, craftsmanship, and exclusivity.',
    type: 'promo', style: 'minimal', mood: 'luxurious', pace: 'slow',
  },
  {
    label: 'Event Highlights',
    prompt: 'Compile event footage into a dynamic highlight reel. Mix wide shots with close-ups, add energetic transitions between moments, and capture the atmosphere and excitement.',
    type: 'recap', style: 'documentary', mood: 'energetic', pace: 'medium',
  },
  {
    label: 'Ad Creative',
    prompt: 'Create a conversion-focused video ad with attention-grabbing opening, clear product benefits, social proof moments, and a compelling end card with call-to-action.',
    type: 'ad', style: 'commercial', mood: 'dramatic', pace: 'medium',
  },
];

interface Props {
  colors: typeof Colors.light;
  isDark: boolean;
}

export function VideoEditorContent({ colors, isDark }: Props) {
  const { t } = useLanguage();
  const baseUrl = getApiUrl();

  const [step, setStep] = useState<'brief' | 'upload' | 'configure' | 'processing' | 'result'>('brief');
  const [clips, setClips] = useState<UploadedClip[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);

  const [videoType, setVideoType] = useState<VideoType>('promo');
  const [creativeBrief, setCreativeBrief] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [style, setStyle] = useState<EditStyle>('cinematic');
  const [mood, setMood] = useState<EditMood>('energetic');
  const [pace, setPace] = useState<EditPace>('medium');
  const [addTransitions, setAddTransitions] = useState(true);
  const [addText, setAddText] = useState(false);
  const [textOverlay, setTextOverlay] = useState('');

  const [resultUrl, setResultUrl] = useState('');
  const [resultDuration, setResultDuration] = useState(0);
  const [creativeNotes, setCreativeNotes] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [processingError, setProcessingError] = useState('');

  const applyQuickPrompt = (qp: typeof QUICK_PROMPTS[0]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreativeBrief(qp.prompt);
    setVideoType(qp.type);
    setStyle(qp.style);
    setMood(qp.mood);
    setPace(qp.pace);
  };

  const goToUpload = () => {
    if (!creativeBrief.trim()) {
      Alert.alert('Creative Brief Required', 'Please describe your video vision or pick a quick template to continue.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep('upload');
  };

  const pickVideos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    setUploadStatus(t('videoEditor.preparingUpload'));
    try {
      const formData = new FormData();

      for (const asset of result.assets) {
        const file = new File(asset.uri);
        formData.append('clips', file);
      }

      formData.append('title', keyMessage || creativeBrief.slice(0, 60));
      formData.append('style', style);
      formData.append('mood', mood);

      setUploadStatus(t('videoEditor.uploadingClips').replace('{{count}}', String(result.assets.length)));

      const url = new URL('/api/video/upload-clips', baseUrl);
      const response = await expoFetch(url.toString(), { method: 'POST', body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Upload failed');
      }
      const data = await response.json();
      setClips(data.clips);
      setProject(data.project);
      setStep('configure');
      setUploadStatus('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error('Video upload error:', error);
      setUploadStatus('');
      Alert.alert(t('videoEditor.error'), error.message || t('videoEditor.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const startEditing = async () => {
    if (!project || clips.length === 0) return;

    setStep('processing');
    setProcessing(true);
    setProcessingProgress(0);
    setProcessingError('');

    const progressInterval = setInterval(() => {
      setProcessingProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 8;
      });
    }, 1500);

    try {
      const url = new URL('/api/video/ai-edit', baseUrl);
      console.log('[VideoEditor] Sending clips to AI:', {
        url: url.toString(),
        projectId: project.id,
        clipCount: clips.length,
        clipNames: clips.map(c => c.originalName),
        style, mood, pace, videoType,
        briefLength: creativeBrief.length,
      });

      const response = await expoFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          clips,
          style,
          mood,
          pace,
          addTransitions,
          addText,
          textOverlay,
          creativeBrief,
          videoType,
          targetAudience,
          keyMessage,
        }),
      });

      clearInterval(progressInterval);

      console.log('[VideoEditor] AI response status:', response.status);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errMsg = 'Processing failed';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error || errMsg;
        } catch {
          if (errText) errMsg = errText;
        }
        console.error('[VideoEditor] AI error response:', errMsg);
        throw new Error(errMsg);
      }

      const data = await response.json();
      console.log('[VideoEditor] AI edit success:', {
        outputUrl: data.outputUrl,
        duration: data.duration,
        hasCreativeNotes: !!data.creativeNotes,
      });

      setProcessingProgress(100);
      setResultUrl(data.outputUrl || '');
      setResultDuration(data.duration || 0);
      setCreativeNotes(data.creativeNotes || '');

      setTimeout(() => {
        setStep('result');
        setProcessing(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }, 800);
    } catch (error: any) {
      console.error('[VideoEditor] startEditing error:', error);
      clearInterval(progressInterval);
      setProcessing(false);
      setProcessingError(error.message || 'Video processing failed. Please try again.');
      setStep('result');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const loadProjects = useCallback(async () => {
    try {
      const url = new URL('/api/video/projects', baseUrl);
      const response = await authFetch(url.toString());
      const data = await response.json();
      setProjects(data);
    } catch {}
  }, [baseUrl]);

  const newProject = () => {
    setStep('brief');
    setClips([]);
    setProject(null);
    setResultUrl('');
    setResultDuration(0);
    setCreativeNotes('');
    setProcessingProgress(0);
    setProcessingError('');
    setCreativeBrief('');
    setTargetAudience('');
    setKeyMessage('');
    setTextOverlay('');
    setVideoType('promo');
    setStyle('cinematic');
    setMood('energetic');
    setPace('medium');
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View>
      <View style={styles.veHeader}>
        {step !== 'brief' && step !== 'processing' && (
          <Pressable onPress={() => {
            if (step === 'upload') setStep('brief');
            else if (step === 'configure') setStep('upload');
            else if (step === 'result') newProject();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}>
            <View style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
            </View>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { setShowHistory(!showHistory); if (!showHistory) loadProjects(); }}>
          <View style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="time-outline" size={20} color={colors.text} />
          </View>
        </Pressable>
      </View>

      {/* STEP 1: Creative Brief */}
      {step === 'brief' && !showHistory && (
        <View>
          <View style={styles.briefHeader}>
            <LinearGradient
              colors={['#8B5CF6', '#6366F1', '#4F46E5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.briefBadge}
            >
              <MaterialCommunityIcons name="robot-excited-outline" size={16} color="#fff" />
              <Text style={styles.briefBadgeText}>GPT-5.2 Powered</Text>
            </LinearGradient>
            <Text style={[styles.briefTitle, { color: colors.text }]}>
              {t('videoEditor.briefTitle')}
            </Text>
            <Text style={[styles.briefSubtitle, { color: colors.textSecondary }]}>
              {t('videoEditor.briefSubtitle')}
            </Text>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            {t('videoEditor.quickTemplates')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickPromptScroll}
          >
            {QUICK_PROMPTS.map((qp, i) => (
              <Pressable
                key={i}
                onPress={() => applyQuickPrompt(qp)}
                style={[styles.quickPromptCard, {
                  backgroundColor: creativeBrief === qp.prompt ? colors.accent + '15' : colors.card,
                  borderColor: creativeBrief === qp.prompt ? colors.accent : colors.cardBorder,
                }]}
              >
                <View style={[styles.quickPromptIcon, { backgroundColor: (creativeBrief === qp.prompt ? colors.accent : colors.textMuted) + '15' }]}>
                  <Ionicons
                    name={VIDEO_TYPES.find(v => v.id === qp.type)?.icon as any || 'sparkles-outline'}
                    size={18}
                    color={creativeBrief === qp.prompt ? colors.accent : colors.textMuted}
                  />
                </View>
                <Text style={[styles.quickPromptLabel, {
                  color: creativeBrief === qp.prompt ? colors.accent : colors.text,
                }]} numberOfLines={2}>
                  {qp.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            {t('videoEditor.videoTypeLabel')}
          </Text>
          <View style={styles.videoTypeGrid}>
            {VIDEO_TYPES.map(vt => (
              <Pressable
                key={vt.id}
                onPress={() => { setVideoType(vt.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.videoTypeCard, {
                  backgroundColor: videoType === vt.id ? colors.accent + '12' : colors.card,
                  borderColor: videoType === vt.id ? colors.accent : colors.cardBorder,
                }]}
              >
                <Ionicons name={vt.icon as any} size={22} color={videoType === vt.id ? colors.accent : colors.textMuted} />
                <Text style={[styles.videoTypeLabel, { color: videoType === vt.id ? colors.accent : colors.text }]}>
                  {vt.label}
                </Text>
                <Text style={[styles.videoTypeDesc, { color: colors.textMuted }]} numberOfLines={1}>
                  {vt.desc}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.inputCardHeader}>
              <MaterialCommunityIcons name="movie-open-star-outline" size={18} color={colors.accent} />
              <Text style={[styles.inputCardTitle, { color: colors.text }]}>
                {t('videoEditor.describeVision')}
              </Text>
            </View>
            <TextInput
              style={[styles.briefInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('videoEditor.briefPlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={creativeBrief}
              onChangeText={setCreativeBrief}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.inputCardHeader}>
              <Ionicons name="people-outline" size={18} color={colors.accent} />
              <Text style={[styles.inputCardTitle, { color: colors.text }]}>
                {t('videoEditor.targetAudienceLabel')}
              </Text>
              <Text style={[styles.optionalBadge, { color: colors.textMuted }]}>Optional</Text>
            </View>
            <TextInput
              style={[styles.smallInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('videoEditor.audiencePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={targetAudience}
              onChangeText={setTargetAudience}
            />
          </View>

          <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.inputCardHeader}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.accent} />
              <Text style={[styles.inputCardTitle, { color: colors.text }]}>
                {t('videoEditor.keyMessageLabel')}
              </Text>
              <Text style={[styles.optionalBadge, { color: colors.textMuted }]}>Optional</Text>
            </View>
            <TextInput
              style={[styles.smallInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
              placeholder={t('videoEditor.messagePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={keyMessage}
              onChangeText={setKeyMessage}
            />
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('videoEditor.editStyle')}</Text>
          <View style={styles.styleGrid}>
            {STYLES.map(s => (
              <Pressable
                key={s.id}
                onPress={() => { setStyle(s.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.styleCard, {
                  backgroundColor: style === s.id ? colors.accent + '15' : colors.card,
                  borderColor: style === s.id ? colors.accent : colors.cardBorder,
                }]}
              >
                <Ionicons name={s.icon as any} size={22} color={style === s.id ? colors.accent : colors.textMuted} />
                <Text style={[styles.styleLabel, { color: style === s.id ? colors.accent : colors.textSecondary }]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('videoEditor.mood')}</Text>
          <View style={styles.moodRow}>
            {MOODS.map(m => (
              <Pressable
                key={m.id}
                onPress={() => { setMood(m.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.moodChip, {
                  backgroundColor: mood === m.id ? m.color + '20' : colors.card,
                  borderColor: mood === m.id ? m.color : colors.cardBorder,
                }]}
              >
                <View style={[styles.moodDot, { backgroundColor: m.color }]} />
                <Text style={[styles.moodLabel, { color: mood === m.id ? m.color : colors.textSecondary }]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('videoEditor.pace')}</Text>
          <View style={[styles.paceSelector, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            {(['slow', 'medium', 'fast'] as EditPace[]).map(p => (
              <Pressable
                key={p}
                onPress={() => { setPace(p); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.paceOption, pace === p && { backgroundColor: colors.accent + '15' }]}
              >
                <Ionicons
                  name={p === 'slow' ? 'play-outline' : p === 'medium' ? 'play-forward-outline' : 'flash-outline'}
                  size={18}
                  color={pace === p ? colors.accent : colors.textMuted}
                />
                <Text style={[styles.paceLabel, { color: pace === p ? colors.accent : colors.textSecondary }]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.togglesSection}>
            <Pressable
              onPress={() => setAddTransitions(!addTransitions)}
              style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            >
              <View style={styles.toggleLeft}>
                <Ionicons name="swap-horizontal-outline" size={20} color={colors.accent} />
                <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('videoEditor.transitions')}</Text>
              </View>
              <View style={[styles.toggleSwitch, { backgroundColor: addTransitions ? colors.accent : colors.inputBorder }]}>
                <View style={[styles.toggleKnob, { transform: [{ translateX: addTransitions ? 18 : 0 }] }]} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => setAddText(!addText)}
              style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            >
              <View style={styles.toggleLeft}>
                <Ionicons name="text-outline" size={20} color={colors.accent} />
                <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('videoEditor.addTextOverlay')}</Text>
              </View>
              <View style={[styles.toggleSwitch, { backgroundColor: addText ? colors.accent : colors.inputBorder }]}>
                <View style={[styles.toggleKnob, { transform: [{ translateX: addText ? 18 : 0 }] }]} />
              </View>
            </Pressable>
          </View>

          {addText && (
            <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <TextInput
                style={[styles.smallInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('videoEditor.textOverlayPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={textOverlay}
                onChangeText={setTextOverlay}
              />
            </View>
          )}

          <Pressable onPress={goToUpload} style={{ marginHorizontal: 20, marginTop: 24, marginBottom: 40 }}>
            <LinearGradient colors={['#8B5CF6', '#6366F1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.continueBtn}>
              <Text style={styles.continueBtnText}>{t('videoEditor.continueToUpload')}</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {/* STEP 2: Upload Clips */}
      {step === 'upload' && !showHistory && (
        <View>
          <View style={[styles.briefSummary, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.briefSummaryHeader}>
              <MaterialCommunityIcons name="robot-excited-outline" size={18} color={colors.accent} />
              <Text style={[styles.briefSummaryTitle, { color: colors.text }]}>{t('videoEditor.yourBrief')}</Text>
            </View>
            <Text style={[styles.briefSummaryText, { color: colors.textSecondary }]} numberOfLines={3}>
              {creativeBrief}
            </Text>
            <View style={styles.briefTags}>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>
                  {VIDEO_TYPES.find(v => v.id === videoType)?.label}
                </Text>
              </View>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>{style}</Text>
              </View>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>{mood}</Text>
              </View>
            </View>
          </View>

          <LinearGradient
            colors={isDark ? ['#1a1a2e', '#16213e'] : ['#f0f4ff', '#e8effd']}
            style={styles.uploadArea}
          >
            <View style={[styles.uploadIconCircle, { backgroundColor: colors.accent + '20' }]}>
              <MaterialCommunityIcons name="movie-open-plus-outline" size={40} color={colors.accent} />
            </View>
            <Text style={[styles.uploadTitle, { color: colors.text }]}>{t('videoEditor.uploadTitle')}</Text>
            <Text style={[styles.uploadDesc, { color: colors.textSecondary }]}>{t('videoEditor.uploadDesc')}</Text>

            <Pressable onPress={pickVideos} disabled={uploading}>
              <LinearGradient colors={[colors.accent, '#0EA5E9']} style={[styles.uploadBtn, { opacity: uploading ? 0.7 : 1 }]}>
                {uploading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                )}
                <Text style={styles.uploadBtnText}>
                  {uploading ? t('videoEditor.uploading') : t('videoEditor.selectClips')}
                </Text>
              </LinearGradient>
            </Pressable>

            {uploading && uploadStatus ? (
              <Text style={[styles.uploadStatusText, { color: colors.accent }]}>
                {uploadStatus}
              </Text>
            ) : null}

            <View style={styles.uploadHints}>
              <View style={styles.uploadHint}>
                <Ionicons name="videocam-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.uploadHintText, { color: colors.textMuted }]}>{t('videoEditor.maxClips')}</Text>
              </View>
              <View style={styles.uploadHint}>
                <Ionicons name="resize-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.uploadHintText, { color: colors.textMuted }]}>{t('videoEditor.maxSize')}</Text>
              </View>
            </View>
          </LinearGradient>
        </View>
      )}

      {/* STEP 3: Review & Start */}
      {step === 'configure' && (
        <View>
          <View style={[styles.clipsSection, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.clipsSectionHeader}>
              <Ionicons name="videocam" size={18} color={colors.accent} />
              <Text style={[styles.clipsSectionTitle, { color: colors.text }]}>
                {clips.length} {clips.length === 1 ? t('videoEditor.clip') : t('videoEditor.clips')}
              </Text>
              <Text style={[styles.clipsTotalDuration, { color: colors.textMuted }]}>
                {formatDuration(clips.reduce((sum, c) => sum + c.duration, 0))} {t('videoEditor.total')}
              </Text>
            </View>
            {clips.map((clip, i) => (
              <View key={i} style={[styles.clipRow, { borderTopColor: colors.cardBorder }]}>
                <View style={[styles.clipThumb, { backgroundColor: colors.accent + '10' }]}>
                  <Ionicons name="film-outline" size={20} color={colors.accent} />
                </View>
                <View style={styles.clipInfo}>
                  <Text style={[styles.clipName, { color: colors.text }]} numberOfLines={1}>{clip.originalName}</Text>
                  <Text style={[styles.clipMeta, { color: colors.textMuted }]}>
                    {formatDuration(clip.duration)} | {clip.width}x{clip.height} | {formatBytes(clip.size)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.briefSummary, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.briefSummaryHeader}>
              <MaterialCommunityIcons name="robot-excited-outline" size={18} color={colors.accent} />
              <Text style={[styles.briefSummaryTitle, { color: colors.text }]}>{t('videoEditor.aiWillDo')}</Text>
            </View>
            <Text style={[styles.briefSummaryText, { color: colors.textSecondary }]} numberOfLines={4}>
              {creativeBrief}
            </Text>
            <View style={styles.briefTags}>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>
                  {VIDEO_TYPES.find(v => v.id === videoType)?.label}
                </Text>
              </View>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>{style}</Text>
              </View>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>{mood}</Text>
              </View>
              <View style={[styles.briefTag, { backgroundColor: colors.accent + '15' }]}>
                <Text style={[styles.briefTagText, { color: colors.accent }]}>{pace} pace</Text>
              </View>
              {addTransitions && (
                <View style={[styles.briefTag, { backgroundColor: '#10B981' + '15' }]}>
                  <Text style={[styles.briefTagText, { color: '#10B981' }]}>Transitions</Text>
                </View>
              )}
              {addText && textOverlay && (
                <View style={[styles.briefTag, { backgroundColor: '#F59E0B' + '15' }]}>
                  <Text style={[styles.briefTagText, { color: '#F59E0B' }]}>Text: {textOverlay}</Text>
                </View>
              )}
            </View>
            {targetAudience ? (
              <Text style={[styles.briefMetaLine, { color: colors.textMuted }]}>
                Audience: {targetAudience}
              </Text>
            ) : null}
            {keyMessage ? (
              <Text style={[styles.briefMetaLine, { color: colors.textMuted }]}>
                Key message: {keyMessage}
              </Text>
            ) : null}
          </View>

          <Pressable onPress={startEditing} style={{ marginHorizontal: 20, marginTop: 24, marginBottom: 40 }}>
            <LinearGradient colors={['#8B5CF6', '#6366F1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.startEditBtn}>
              <MaterialCommunityIcons name="movie-open-star-outline" size={22} color="#fff" />
              <Text style={styles.startEditText}>{t('videoEditor.startEditing')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {/* STEP 4: Processing */}
      {step === 'processing' && (
        <View style={styles.processingContainer}>
          <LinearGradient
            colors={isDark ? ['#1a1a2e', '#16213e'] : ['#f0f4ff', '#e8effd']}
            style={styles.processingCard}
          >
            <View style={styles.processingAnimation}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
            <Text style={[styles.processingTitle, { color: colors.text }]}>{t('videoEditor.processingTitle')}</Text>
            <Text style={[styles.processingDesc, { color: colors.textSecondary }]}>{t('videoEditor.processingDesc')}</Text>

            <View style={[styles.progressBarOuter, { backgroundColor: colors.inputBorder }]}>
              <LinearGradient
                colors={['#8B5CF6', '#6366F1']}
                style={[styles.progressBarInner, { width: `${Math.min(processingProgress, 100)}%` as any }]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              {Math.round(processingProgress)}%
            </Text>

            <View style={styles.processingSteps}>
              {[
                { label: t('videoEditor.analyzingClips'), done: processingProgress > 15 },
                { label: t('videoEditor.readingBrief'), done: processingProgress > 25 },
                { label: t('videoEditor.aiPlanning'), done: processingProgress > 45 },
                { label: t('videoEditor.rendering'), done: processingProgress > 65 },
                { label: t('videoEditor.finalizing'), done: processingProgress > 90 },
              ].map((s, i) => (
                <View key={i} style={styles.processingStep}>
                  <Ionicons
                    name={s.done ? "checkmark-circle" : "ellipse-outline"}
                    size={18}
                    color={s.done ? '#10B981' : colors.textMuted}
                  />
                  <Text style={[styles.processingStepText, { color: s.done ? colors.text : colors.textMuted }]}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </View>
      )}

      {/* STEP 5: Result */}
      {step === 'result' && (
        <View>
          {processingError ? (
            <View>
              <LinearGradient
                colors={['#EF4444', '#DC2626']}
                style={styles.resultBanner}
              >
                <Ionicons name="alert-circle" size={40} color="#fff" />
                <Text style={styles.resultTitle}>{t('videoEditor.processingFailed')}</Text>
                <Text style={styles.resultDesc}>{processingError}</Text>
              </LinearGradient>

              <View style={[styles.errorHelpCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.errorHelpRow}>
                  <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
                  <Text style={[styles.errorHelpTitle, { color: colors.text }]}>
                    {t('videoEditor.troubleshootTitle')}
                  </Text>
                </View>
                <View style={styles.errorHelpList}>
                  <View style={styles.errorHelpItem}>
                    <View style={[styles.errorBullet, { backgroundColor: colors.accent }]} />
                    <Text style={[styles.errorHelpText, { color: colors.textSecondary }]}>
                      {t('videoEditor.troubleshoot1')}
                    </Text>
                  </View>
                  <View style={styles.errorHelpItem}>
                    <View style={[styles.errorBullet, { backgroundColor: colors.accent }]} />
                    <Text style={[styles.errorHelpText, { color: colors.textSecondary }]}>
                      {t('videoEditor.troubleshoot2')}
                    </Text>
                  </View>
                  <View style={styles.errorHelpItem}>
                    <View style={[styles.errorBullet, { backgroundColor: colors.accent }]} />
                    <Text style={[styles.errorHelpText, { color: colors.textSecondary }]}>
                      {t('videoEditor.troubleshoot3')}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.resultActions}>
                <Pressable onPress={() => { setProcessingError(''); setStep('configure'); }}>
                  <LinearGradient colors={['#8B5CF6', '#6366F1']} style={styles.resultActionBtn}>
                    <Ionicons name="refresh" size={20} color="#fff" />
                    <Text style={styles.resultActionText}>{t('videoEditor.tryAgain')}</Text>
                  </LinearGradient>
                </Pressable>
                <Pressable onPress={newProject} style={[styles.secondaryActionBtn, { borderColor: colors.cardBorder }]}>
                  <Ionicons name="add" size={20} color={colors.text} />
                  <Text style={[styles.secondaryActionText, { color: colors.text }]}>{t('videoEditor.newProject')}</Text>
                </Pressable>
              </View>
            </View>
          ) : !resultUrl ? (
            <View>
              <View style={[styles.emptyResultCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={[styles.emptyResultIcon, { backgroundColor: colors.accent + '15' }]}>
                  <Ionicons name="film-outline" size={48} color={colors.accent} />
                </View>
                <Text style={[styles.emptyResultTitle, { color: colors.text }]}>
                  {t('videoEditor.noResultYet')}
                </Text>
                <Text style={[styles.emptyResultDesc, { color: colors.textSecondary }]}>
                  {t('videoEditor.noResultDesc')}
                </Text>
              </View>

              <View style={styles.resultActions}>
                <Pressable onPress={newProject}>
                  <LinearGradient colors={[colors.accent, '#0EA5E9']} style={styles.resultActionBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                    <Text style={styles.resultActionText}>{t('videoEditor.newProject')}</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          ) : (
            <View>
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.resultBanner}
              >
                <Ionicons name="checkmark-circle" size={40} color="#fff" />
                <Text style={styles.resultTitle}>{t('videoEditor.resultTitle')}</Text>
                <Text style={styles.resultDesc}>{t('videoEditor.resultDesc')}</Text>
              </LinearGradient>

              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={[styles.resultPreview, { backgroundColor: colors.inputBackground }]}>
                  <Ionicons name="play-circle" size={60} color={colors.accent} />
                  <Text style={[styles.resultPreviewText, { color: colors.textSecondary }]}>
                    {t('videoEditor.videoReady')}
                  </Text>
                </View>

                <View style={styles.resultMeta}>
                  <View style={styles.resultMetaItem}>
                    <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                    <Text style={[styles.resultMetaText, { color: colors.text }]}>
                      {formatDuration(resultDuration)}
                    </Text>
                  </View>
                  <View style={styles.resultMetaItem}>
                    <Ionicons name="film-outline" size={16} color={colors.textMuted} />
                    <Text style={[styles.resultMetaText, { color: colors.text }]}>{clips.length} clips</Text>
                  </View>
                  <View style={styles.resultMetaItem}>
                    <Ionicons name="color-palette-outline" size={16} color={colors.textMuted} />
                    <Text style={[styles.resultMetaText, { color: colors.text }]}>{style}</Text>
                  </View>
                </View>
              </View>

              {creativeNotes ? (
                <View style={[styles.notesCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={styles.notesHeader}>
                    <MaterialCommunityIcons name="robot-excited-outline" size={20} color={colors.accent} />
                    <Text style={[styles.notesTitle, { color: colors.text }]}>{t('videoEditor.aiNotes')}</Text>
                  </View>
                  <Text style={[styles.notesText, { color: colors.textSecondary }]}>{creativeNotes}</Text>
                </View>
              ) : null}

              <View style={styles.resultActions}>
                <Pressable onPress={newProject}>
                  <LinearGradient colors={[colors.accent, '#0EA5E9']} style={styles.resultActionBtn}>
                    <Ionicons name="add" size={20} color="#fff" />
                    <Text style={styles.resultActionText}>{t('videoEditor.newProject')}</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {showHistory && (
        <View style={styles.historySection}>
          <Text style={[styles.historyTitle, { color: colors.text }]}>{t('videoEditor.history')}</Text>
          {projects.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Ionicons name="film-outline" size={36} color={colors.textMuted} />
              <Text style={[styles.historyEmptyText, { color: colors.textSecondary }]}>{t('videoEditor.noProjects')}</Text>
            </View>
          ) : (
            projects.map(p => (
              <View key={p.id} style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.historyCardLeft}>
                  <View style={[styles.historyStatusDot, {
                    backgroundColor: p.status === 'completed' ? '#10B981' : p.status === 'failed' ? '#EF4444' : colors.accent
                  }]} />
                  <View>
                    <Text style={[styles.historyCardTitle, { color: colors.text }]}>{p.title}</Text>
                    <Text style={[styles.historyCardMeta, { color: colors.textMuted }]}>
                      {p.status} {p.duration ? `| ${formatDuration(p.duration)}` : ''}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  veHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  headerBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  briefHeader: { alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
  briefBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, gap: 6, marginBottom: 16 },
  briefBadgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  briefTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', textAlign: 'center', marginBottom: 8 },
  briefSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  sectionLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, marginBottom: 12 },
  quickPromptScroll: { paddingHorizontal: 20, gap: 10, marginBottom: 24 },
  quickPromptCard: { width: 120, padding: 14, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', gap: 10 },
  quickPromptIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickPromptLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  videoTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 24 },
  videoTypeCard: { width: (SCREEN_WIDTH - 52 - 10) / 2, padding: 14, borderRadius: 16, borderWidth: 1.5, gap: 6 },
  videoTypeLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  videoTypeDesc: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  inputCard: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  inputCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  inputCardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', flex: 1 },
  optionalBadge: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  briefInput: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, fontFamily: 'Inter_400Regular', minHeight: 100, lineHeight: 22 },
  smallInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 24 },
  styleCard: { width: (SCREEN_WIDTH - 52 - 20) / 3, alignItems: 'center', paddingVertical: 16, borderRadius: 16, borderWidth: 1.5, gap: 8 },
  styleLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 8, marginBottom: 24 },
  moodChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, gap: 8 },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  moodLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  paceSelector: { flexDirection: 'row', marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 4, marginBottom: 24 },
  paceOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, gap: 6 },
  paceLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  togglesSection: { paddingHorizontal: 20, gap: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, borderWidth: 1 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, padding: 2 },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  continueBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 16, gap: 10 },
  continueBtnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  briefSummary: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  briefSummaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  briefSummaryTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  briefSummaryText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },
  briefTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  briefTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  briefTagText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  briefMetaLine: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 8 },
  uploadArea: { marginHorizontal: 20, borderRadius: 24, padding: 32, alignItems: 'center', gap: 14 },
  uploadIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  uploadDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, gap: 10 },
  uploadBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  uploadStatusText: { fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center' as const, marginTop: 8 },
  uploadHints: { flexDirection: 'row', gap: 20, marginTop: 8 },
  uploadHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  uploadHintText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  clipsSection: { marginHorizontal: 20, borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  clipsSectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  clipsSectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', flex: 1 },
  clipsTotalDuration: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  clipRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderTopWidth: 1, gap: 12 },
  clipThumb: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clipInfo: { flex: 1 },
  clipName: { fontSize: 14, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  clipMeta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  startEditBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 16, gap: 10 },
  startEditText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  processingContainer: { paddingHorizontal: 20 },
  processingCard: { borderRadius: 24, padding: 32, alignItems: 'center', gap: 16 },
  processingAnimation: { marginBottom: 8 },
  processingTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  processingDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  progressBarOuter: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  progressBarInner: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  processingSteps: { width: '100%', gap: 12, marginTop: 16 },
  processingStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  processingStepText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  resultBanner: { marginHorizontal: 20, borderRadius: 20, padding: 28, alignItems: 'center', gap: 10, marginBottom: 16 },
  resultTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
  resultDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.85)', textAlign: 'center' },
  resultCard: { marginHorizontal: 20, borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  resultPreview: { height: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  resultPreviewText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  resultMeta: { flexDirection: 'row', padding: 16, gap: 20 },
  resultMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultMetaText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  notesCard: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  notesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  notesTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  notesText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  resultActions: { paddingHorizontal: 20, gap: 12, marginBottom: 40 },
  resultActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  resultActionText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  secondaryActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10, borderWidth: 1.5 },
  secondaryActionText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  errorHelpCard: { marginHorizontal: 20, borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 16 },
  errorHelpRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  errorHelpTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  errorHelpList: { gap: 10 },
  errorHelpItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 4 },
  errorBullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  errorHelpText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, flex: 1 },
  emptyResultCard: { marginHorizontal: 20, borderRadius: 24, borderWidth: 1, padding: 40, alignItems: 'center', gap: 16, marginBottom: 16 },
  emptyResultIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  emptyResultTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', textAlign: 'center' as const },
  emptyResultDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center' as const, lineHeight: 20, paddingHorizontal: 10 },
  historySection: { paddingHorizontal: 20 },
  historyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginBottom: 16 },
  historyEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  historyEmptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  historyCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  historyCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  historyStatusDot: { width: 10, height: 10, borderRadius: 5 },
  historyCardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  historyCardMeta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
