import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Pressable,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import Colors from '@/constants/colors';
import { useLanguage } from '@/context/LanguageContext';
import { getApiUrl } from '@/lib/query-client';

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

export default function VideoEditorScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const baseUrl = getApiUrl();

  const [step, setStep] = useState<'upload' | 'configure' | 'processing' | 'result'>('upload');
  const [clips, setClips] = useState<UploadedClip[]>([]);
  const [project, setProject] = useState<VideoProject | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [title, setTitle] = useState('');

  const [style, setStyle] = useState<EditStyle>('cinematic');
  const [mood, setMood] = useState<EditMood>('energetic');
  const [pace, setPace] = useState<EditPace>('medium');
  const [addTransitions, setAddTransitions] = useState(true);
  const [addText, setAddText] = useState(false);

  const [resultUrl, setResultUrl] = useState('');
  const [resultDuration, setResultDuration] = useState(0);
  const [creativeNotes, setCreativeNotes] = useState('');

  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const pickVideos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;

    setUploading(true);
    try {
      const formData = new FormData();
      for (const asset of result.assets) {
        const filename = asset.uri.split('/').pop() || 'video.mp4';
        formData.append('clips', {
          uri: asset.uri,
          name: filename,
          type: asset.mimeType || 'video/mp4',
        } as any);
      }
      formData.append('title', title || 'My Video Project');
      formData.append('style', style);
      formData.append('mood', mood);

      const url = new URL('/api/video/upload-clips', baseUrl);
      const response = await fetch(url.toString(), { method: 'POST', body: formData });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Upload failed');
      }
      const data = await response.json();
      setClips(data.clips);
      setProject(data.project);
      setStep('configure');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
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

    const progressInterval = setInterval(() => {
      setProcessingProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 8;
      });
    }, 1500);

    try {
      const url = new URL('/api/video/ai-edit', baseUrl);
      const response = await fetch(url.toString(), {
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
        }),
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Processing failed');
      }

      const data = await response.json();
      setProcessingProgress(100);
      setResultUrl(data.outputUrl);
      setResultDuration(data.duration);
      setCreativeNotes(data.creativeNotes || '');

      setTimeout(() => {
        setStep('result');
        setProcessing(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }, 800);
    } catch (error: any) {
      clearInterval(progressInterval);
      setProcessing(false);
      setStep('configure');
      Alert.alert(t('videoEditor.error'), error.message || t('videoEditor.processingFailed'));
    }
  };

  const loadProjects = useCallback(async () => {
    try {
      const url = new URL('/api/video/projects', baseUrl);
      const response = await fetch(url.toString());
      const data = await response.json();
      setProjects(data);
    } catch {}
  }, [baseUrl]);

  const newProject = () => {
    setStep('upload');
    setClips([]);
    setProject(null);
    setResultUrl('');
    setResultDuration(0);
    setCreativeNotes('');
    setProcessingProgress(0);
    setTitle('');
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
            <Text style={[styles.title, { color: colors.text }]}>{t('videoEditor.title')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('videoEditor.subtitle')}</Text>
          </View>
          <Pressable onPress={() => { setShowHistory(!showHistory); if (!showHistory) loadProjects(); }}>
            <View style={[styles.historyBtn, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="time-outline" size={20} color={colors.text} />
            </View>
          </Pressable>
        </View>

        {step === 'upload' && !showHistory && (
          <View>
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
                <LinearGradient colors={[colors.accent, '#0EA5E9']} style={styles.uploadBtn}>
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

            <View style={styles.howItWorks}>
              <Text style={[styles.howTitle, { color: colors.text }]}>{t('videoEditor.howItWorks')}</Text>
              {[
                { icon: 'cloud-upload-outline', title: t('videoEditor.step1Title'), desc: t('videoEditor.step1Desc') },
                { icon: 'sparkles-outline', title: t('videoEditor.step2Title'), desc: t('videoEditor.step2Desc') },
                { icon: 'film-outline', title: t('videoEditor.step3Title'), desc: t('videoEditor.step3Desc') },
              ].map((item, i) => (
                <View key={i} style={[styles.howStep, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={[styles.howStepNum, { backgroundColor: colors.accent + '15' }]}>
                    <Text style={[styles.howStepNumText, { color: colors.accent }]}>{i + 1}</Text>
                  </View>
                  <View style={styles.howStepContent}>
                    <Text style={[styles.howStepTitle, { color: colors.text }]}>{item.title}</Text>
                    <Text style={[styles.howStepDesc, { color: colors.textSecondary }]}>{item.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

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
            </View>

            <Pressable onPress={startEditing} style={{ marginHorizontal: 20, marginTop: 24 }}>
              <LinearGradient colors={['#8B5CF6', '#6366F1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.startEditBtn}>
                <MaterialCommunityIcons name="movie-open-star-outline" size={22} color="#fff" />
                <Text style={styles.startEditText}>{t('videoEditor.startEditing')}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}

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
                  { label: t('videoEditor.aiPlanning'), done: processingProgress > 35 },
                  { label: t('videoEditor.rendering'), done: processingProgress > 65 },
                  { label: t('videoEditor.finalizing'), done: processingProgress > 90 },
                ].map((s, i) => (
                  <View key={i} style={styles.processingStep}>
                    <Ionicons
                      name={s.done ? "checkmark-circle" : "ellipse-outline"}
                      size={18}
                      color={s.done ? colors.success : colors.textMuted}
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

        {step === 'result' && (
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

            {creativeNotes && (
              <View style={[styles.notesCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.notesHeader}>
                  <MaterialCommunityIcons name="robot-excited-outline" size={20} color={colors.accent} />
                  <Text style={[styles.notesTitle, { color: colors.text }]}>{t('videoEditor.aiNotes')}</Text>
                </View>
                <Text style={[styles.notesText, { color: colors.textSecondary }]}>{creativeNotes}</Text>
              </View>
            )}

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
                      backgroundColor: p.status === 'completed' ? colors.success : p.status === 'failed' ? colors.error : colors.accent
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

        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 20 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  historyBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  uploadArea: { marginHorizontal: 20, borderRadius: 24, padding: 32, alignItems: 'center', gap: 14 },
  uploadIconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  uploadDesc: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, paddingHorizontal: 10 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, gap: 10 },
  uploadBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  uploadHints: { flexDirection: 'row', gap: 20, marginTop: 8 },
  uploadHint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  uploadHintText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  howItWorks: { paddingHorizontal: 20, marginTop: 32 },
  howTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', marginBottom: 16 },
  howStep: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10, gap: 14 },
  howStepNum: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  howStepNumText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  howStepContent: { flex: 1 },
  howStepTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  howStepDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  clipsSection: { marginHorizontal: 20, borderRadius: 20, borderWidth: 1, overflow: 'hidden', marginBottom: 24 },
  clipsSectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  clipsSectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', flex: 1 },
  clipsTotalDuration: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  clipRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderTopWidth: 1, gap: 12 },
  clipThumb: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  clipInfo: { flex: 1 },
  clipName: { fontSize: 14, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  clipMeta: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  sectionLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 20, marginBottom: 12 },
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
  togglesSection: { paddingHorizontal: 20 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 10 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, padding: 2 },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
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
  resultActions: { paddingHorizontal: 20, gap: 12 },
  resultActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10 },
  resultActionText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
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
