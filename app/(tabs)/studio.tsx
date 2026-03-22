import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';
import { useLanguage } from '@/context/LanguageContext';
import { PlatformPicker } from '@/components/PlatformPicker';
import { generateId } from '@/lib/storage';
import { getApiUrl, apiRequest , authFetch } from '@/lib/query-client';
import { usePersistedState } from '@/hooks/usePersistedState';
import { normalizeMediaType } from '@/lib/media-types';
import type { MediaItem } from '@/lib/types';

interface AutoAnalysisData {
  id: string;
  analysisStatus: string;
  analysisError?: string | null;
  hook?: string | null;
  goal?: string | null;
  keywords?: string | null;
  contentAngle?: string | null;
  suggestedCta?: string | null;
  suggestedCaption?: string | null;
}

type StudioMediaType = 'story' | 'post' | 'reel';

const STUDIO_TYPE_LABELS: Record<StudioMediaType, string> = {
  story: 'Story',
  post: 'Post',
  reel: 'Reel',
};

function normalizeToStudioType(raw: string | undefined | null): StudioMediaType {
  const canonical = normalizeMediaType(raw);
  switch (canonical) {
    case 'VIDEO':
    case 'REEL':
      return 'reel';
    case 'STORY':
      return 'story';
    case 'IMAGE':
    case 'POSTER':
    case 'CAROUSEL':
    case 'POST':
    default:
      return 'post';
  }
}

interface StudioDraftState {
  mediaTitle: string;
  mediaType: StudioMediaType;
  mediaPlatform: string[];
  mediaGoal: string;
  mediaAudience: string;
  mediaCta: string;
  mediaSeries: string;
  mediaOffer: string;
  selectedUri: string | null;
}

const defaultStudioState: StudioDraftState = {
  mediaTitle: '',
  mediaType: 'reel',
  mediaPlatform: ['Instagram'],
  mediaGoal: '',
  mediaAudience: '',
  mediaCta: '',
  mediaSeries: '',
  mediaOffer: '',
  selectedUri: null,
};

const mediaTypes: { id: StudioMediaType; label: string; icon: 'videocam-outline' | 'images-outline' | 'layers-outline' }[] = [
  { id: 'reel', label: 'Reel', icon: 'videocam-outline' },
  { id: 'post', label: 'Post', icon: 'images-outline' },
  { id: 'story', label: 'Story', icon: 'layers-outline' },
];

export default function StudioScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { mediaItems, addMediaItem, removeMediaItem, updateMediaItem } = useApp();
  const { selectedCampaignId } = useCampaign();
  const { t } = useLanguage();

  const { state: ps, updateState, isLoading: psLoading, isSaving, saveError, resetState, hydrationVersion } = usePersistedState<StudioDraftState>('studio', defaultStudioState);

  const [showModal, setShowModal] = useState(false);
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaType, setMediaType] = useState<StudioMediaType>('reel');
  const [mediaPlatform, setMediaPlatform] = useState<string[]>(['Instagram']);
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [mediaGoal, setMediaGoal] = useState('');
  const [mediaAudience, setMediaAudience] = useState('');
  const [mediaCta, setMediaCta] = useState('');
  const [mediaSeries, setMediaSeries] = useState('');
  const [mediaOffer, setMediaOffer] = useState('');
  const [isSubmittingCase, setIsSubmittingCase] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [metadataFilled, setMetadataFilled] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{ [key: string]: any }>({});
  const [applyToggles, setApplyToggles] = useState<{ [itemId: string]: { hook: boolean; caption: boolean; cta: boolean; angle: boolean; keywords: boolean } }>({});
  const [autoAnalysis, setAutoAnalysis] = useState<{ [studioItemId: string]: AutoAnalysisData }>({});
  const pollingIdsRef = useRef<Set<string>>(new Set());
  const lastHydrationRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAnalysisStatus = useCallback(async (studioItemId: string) => {
    try {
      const res = await apiRequest('GET', `/api/studio/items/${studioItemId}/analysis-status`);
      const data: AutoAnalysisData = await res.json();
      setAutoAnalysis(prev => ({ ...prev, [studioItemId]: data }));
      if (data.analysisStatus !== 'PENDING' && data.analysisStatus !== 'RUNNING') {
        pollingIdsRef.current.delete(studioItemId);
        if (pollingIdsRef.current.size === 0 && pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch (err) {
      console.warn('[Studio] Failed to fetch analysis status:', err);
    }
  }, []);

  const startPolling = useCallback((studioItemId: string) => {
    pollingIdsRef.current.add(studioItemId);
    if (!pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => {
        pollingIdsRef.current.forEach(id => fetchAnalysisStatus(id));
      }, 3000);
    }
  }, [fetchAnalysisStatus]);

  useEffect(() => {
    const itemsWithStudioId = mediaItems.filter(m => m.studioItemId);
    for (const item of itemsWithStudioId) {
      if (!autoAnalysis[item.studioItemId!]) {
        fetchAnalysisStatus(item.studioItemId!);
        startPolling(item.studioItemId!);
      }
    }
  }, [mediaItems]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (hydrationVersion > 0 && hydrationVersion !== lastHydrationRef.current) {
      const isFirstHydration = lastHydrationRef.current === 0;
      lastHydrationRef.current = hydrationVersion;
      const hasDraft = ps.mediaTitle !== '' || ps.mediaGoal !== '' || ps.mediaAudience !== '' || ps.mediaCta !== '' || ps.selectedUri !== null;
      if (hasDraft) {
        setMediaTitle(ps.mediaTitle);
        setMediaType(ps.mediaType);
        setMediaPlatform(ps.mediaPlatform);
        setMediaGoal(ps.mediaGoal);
        setMediaAudience(ps.mediaAudience);
        setMediaCta(ps.mediaCta);
        setMediaSeries(ps.mediaSeries);
        setMediaOffer(ps.mediaOffer);
        setSelectedUri(ps.selectedUri);
        setDraftRestored(true);
        setTimeout(() => setDraftRestored(false), 3000);
      } else if (!isFirstHydration) {
        setMediaTitle('');
        setMediaType('reel');
        setMediaPlatform(['Instagram']);
        setMediaGoal('');
        setMediaAudience('');
        setMediaCta('');
        setMediaSeries('');
        setMediaOffer('');
        setSelectedUri(null);
      }
    }
  }, [hydrationVersion, ps]);

  const reels = mediaItems.filter(m => normalizeToStudioType(m.type) === 'reel');
  const posts = mediaItems.filter(m => normalizeToStudioType(m.type) === 'post');
  const stories = mediaItems.filter(m => normalizeToStudioType(m.type) === 'story');

  const handlePickMedia = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: mediaType === 'reel' 
          ? ['videos'] as ImagePicker.MediaType[]
          : ['images'] as ImagePicker.MediaType[],
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedUri(result.assets[0].uri);
        updateState({ selectedUri: result.assets[0].uri });
      }
    } catch (error) {
      console.error('Error picking media:', error);
      setSelectedUri('placeholder');
      updateState({ selectedUri: 'placeholder' });
    }
  };

  const handleAddMedia = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const hasDraft = mediaTitle !== '' || mediaGoal !== '' || mediaAudience !== '' || mediaCta !== '' || selectedUri !== null;
    if (!hasDraft) {
      setMediaTitle('');
      setMediaType('reel');
      setMediaPlatform(['Instagram']);
      setSelectedUri(null);
      setMediaGoal('');
      setMediaAudience('');
      setMediaCta('');
      setMediaSeries('');
      setMediaOffer('');
    }
    setShowModal(true);
  };

  const studioTypeToCanonical = (st: StudioMediaType): string => {
    switch (st) {
      case 'reel': return 'REEL';
      case 'story': return 'STORY';
      case 'post': return 'POST';
      default: return 'POST';
    }
  };

  const handleAIAutoFill = async () => {
    if (!mediaTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a title first so AI can suggest the best metadata.');
      return;
    }
    setIsAutoFilling(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const apiUrl = getApiUrl();
      const res = await authFetch(new URL('/api/studio/ai-metadata', apiUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          
          title: mediaTitle.trim(),
          mediaType: mediaType,
          platform: mediaPlatform[0] || 'Instagram',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMediaGoal(data.goal || '');
          setMediaAudience(data.audience || '');
          setMediaCta(data.cta || '');
          setMediaSeries(data.series || '');
          setMediaOffer(data.offer || '');
          updateState({ mediaGoal: data.goal || '', mediaAudience: data.audience || '', mediaCta: data.cta || '', mediaSeries: data.series || '', mediaOffer: data.offer || '' });
          setMetadataFilled(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert('AI Error', data.error || 'Could not generate metadata.');
        }
      } else {
        Alert.alert('Error', 'Could not reach AI service. Please fill manually.');
      }
    } catch (err) {
      Alert.alert('Error', 'Network error. Please fill fields manually.');
    } finally {
      setIsAutoFilling(false);
    }
  };

  const handleSaveMedia = async () => {
    if (!selectedCampaignId) {
      Alert.alert('No Campaign Selected', 'Please select a campaign before saving media.');
      return;
    }
    if (!mediaTitle.trim()) {
      Alert.alert('Missing Title', 'Please enter a title for your media.');
      return;
    }
    if (!mediaGoal.trim() || !mediaAudience.trim() || !mediaCta.trim()) {
      Alert.alert('Missing Metadata', 'Please tap "AI Auto-Fill" to generate metadata, or fill Goal, Audience, and CTA manually.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmittingCase(true);

    const canonicalType = studioTypeToCanonical(mediaType);

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
      const res = await authFetch(new URL('/api/studio/case', apiUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          
          campaignId: selectedCampaignId,
          mediaItemId: newMedia.id,
          mediaType: canonicalType,
          title: newMedia.title,
          platform: newMedia.platform,
          goal: mediaGoal,
          audience: mediaAudience,
          cta: mediaCta,
          series: mediaSeries || undefined,
          offer: mediaOffer || undefined,
          scheduledDate: new Date(Date.now() + 3600000).toISOString(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        newMedia.serverPostId = data.postId;
        newMedia.studioItemId = data.studioItemId;
        newMedia.autoCaption = data.caption;
        newMedia.status = 'scheduled';
      }
    } catch (err) {
      console.log('Publishing pipeline unavailable, saving locally');
    }

    await addMediaItem(newMedia);
    resetState();
    setMediaTitle('');
    setMediaType('reel');
    setMediaPlatform(['Instagram']);
    setSelectedUri(null);
    setMediaGoal('');
    setMediaAudience('');
    setMediaCta('');
    setMediaSeries('');
    setMediaOffer('');
    setIsSubmittingCase(false);
    setMetadataFilled(false);
    setShowModal(false);
    Alert.alert('Added', `${STUDIO_TYPE_LABELS[mediaType] || mediaType} added with AI captions generated.`);
  };

  const handleDeleteMedia = async (id: string, title: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const item = mediaItems.find(m => m.id === id);
    if (item?.studioItemId) {
      try {
        const apiUrl = getApiUrl();
        await authFetch(new URL(`/api/studio/items/${item.studioItemId}`, apiUrl).toString(), {
          method: 'DELETE',
        });
      } catch (err) {
        console.log('Failed to delete studio item from server:', err);
      }
    }
    await removeMediaItem(id);
  };

  const handleAnalyzeVideo = async (item: MediaItem) => {
    if (analyzingId) return;
    setAnalyzingId(item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const apiUrl = getApiUrl();
      const res = await authFetch(new URL('/api/studio/video-analyze', apiUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          
          title: item.title,
          platform: item.platform,
          goal: item.goal || '',
          audience: item.audience || '',
          cta: item.cta || '',
          series: item.series || '',
          offer: item.offer || '',
          mediaType: item.type,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Analysis failed' }));
        Alert.alert('Analysis Failed', err.error || 'Could not analyze video.');
        return;
      }

      const data = await res.json();
      setAnalysisResult(prev => ({ ...prev, [item.id]: data }));
      setApplyToggles(prev => ({
        ...prev,
        [item.id]: { hook: true, caption: true, cta: true, angle: true, keywords: true },
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Error', 'Could not connect to analysis service.');
    } finally {
      setAnalyzingId(null);
    }
  };

  const toggleApplyField = (itemId: string, field: 'hook' | 'caption' | 'cta' | 'angle' | 'keywords') => {
    setApplyToggles(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { hook: true, caption: true, cta: true, angle: true, keywords: true }), [field]: !prev[itemId]?.[field] },
    }));
  };

  const handleApplyAnalysis = async (item: MediaItem) => {
    const analysis = analysisResult[item.id];
    const toggles = applyToggles[item.id];
    if (!analysis || !toggles) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const patch: Partial<MediaItem> = {};
    if (toggles.hook && analysis.hookSuggestion) patch.title = `${analysis.hookSuggestion.slice(0, 60)}`;
    if (toggles.caption && analysis.captionDraft) patch.autoCaption = analysis.captionDraft;
    if (toggles.cta && analysis.ctaSuggestion) patch.cta = analysis.ctaSuggestion;
    if (toggles.angle && analysis.contentAngle) patch.goal = analysis.contentAngle;
    if (toggles.keywords && analysis.keywords?.length > 0) patch.series = analysis.keywords.join(', ');

    const appliedCount = Object.keys(patch).length;
    if (appliedCount === 0) {
      Alert.alert('Nothing Selected', 'Toggle at least one field to apply.');
      return;
    }

    const updatedItem: MediaItem = { ...item, ...patch };
    await updateMediaItem(updatedItem);

    setAnalysisResult(prev => ({
      ...prev,
      [item.id]: { ...prev[item.id], applied: true },
    }));

    Alert.alert('Applied', `${appliedCount} field${appliedCount > 1 ? 's' : ''} applied to "${item.title}".`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return colors.accent;
      case 'published': return colors.success;
      default: return colors.textMuted;
    }
  };

  const renderAnalysisPanel = (item: MediaItem) => {
    const analysis = analysisResult[item.id];
    if (!analysis) return null;
    const toggles = applyToggles[item.id] || { hook: true, caption: true, cta: true, angle: true, keywords: true };

    const sectionHeader = (icon: string, label: string, color: string) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 4 }}>
        <Ionicons name={icon as any} size={14} color={color} />
        <Text style={{ color, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</Text>
      </View>
    );

    return (
      <View style={[styles.analysisPanel, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '30' }]}>
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>Production Script</Text>

        {analysis.hook ? (
          <>
            {sectionHeader('flash', 'Hook (First 3 Seconds)', '#EF4444')}
            <Pressable style={styles.analysisRow} onPress={() => toggleApplyField(item.id, 'hook')}>
              <Ionicons name={toggles.hook ? "checkbox" : "square-outline"} size={16} color={colors.primary} />
              <View style={styles.analysisContent}>
                <Text style={[styles.analysisLabel, { color: colors.primary }]}>Apply as Title</Text>
                <Text style={[styles.analysisValue, { color: colors.text }]}>{analysis.hook}</Text>
              </View>
            </Pressable>
          </>
        ) : null}

        {analysis.fullScript ? (
          <>
            {sectionHeader('document-text', 'Full Spoken Script', colors.accent)}
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 20, paddingHorizontal: 4 }}>{analysis.fullScript}</Text>
          </>
        ) : null}

        {analysis.scenes?.length > 0 ? (
          <>
            {sectionHeader('film', 'Scene Breakdown', '#8B5CF6')}
            {analysis.scenes.map((scene: any, i: number) => (
              <View key={i} style={{ backgroundColor: colors.card, borderRadius: 8, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.cardBorder }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ color: '#8B5CF6', fontSize: 12, fontWeight: '700' }}>Scene {scene.sceneNumber || i + 1}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{scene.duration}</Text>
                </View>
                {scene.visualDirection ? <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 3 }}>{scene.visualDirection}</Text> : null}
                {scene.onScreenText ? (
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 3 }}>
                    <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '600' }}>TEXT:</Text>
                    <Text style={{ color: colors.text, fontSize: 12, flex: 1 }}>{scene.onScreenText}</Text>
                  </View>
                ) : null}
                {scene.voiceover ? (
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 3 }}>
                    <Text style={{ color: '#3B82F6', fontSize: 11, fontWeight: '600' }}>VO:</Text>
                    <Text style={{ color: colors.text, fontSize: 12, flex: 1, fontStyle: 'italic' as const }}>{scene.voiceover}</Text>
                  </View>
                ) : null}
                {scene.bRollSuggestion ? (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '600' }}>B-ROLL:</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>{scene.bRollSuggestion}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {analysis.cameraDirections ? (
          <>
            {sectionHeader('camera', 'Camera Directions', '#F59E0B')}
            <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 }}>{analysis.cameraDirections}</Text>
          </>
        ) : null}

        {analysis.onScreenTextSummary?.length > 0 ? (
          <>
            {sectionHeader('text', 'On-Screen Text', '#F59E0B')}
            {analysis.onScreenTextSummary.map((t: string, i: number) => (
              <Text key={i} style={{ color: colors.text, fontSize: 12, paddingHorizontal: 4, marginBottom: 2 }}>• {t}</Text>
            ))}
          </>
        ) : null}

        {analysis.bRollList?.length > 0 ? (
          <>
            {sectionHeader('images', 'B-Roll Shots', '#10B981')}
            {analysis.bRollList.map((b: string, i: number) => (
              <Text key={i} style={{ color: colors.textSecondary, fontSize: 12, paddingHorizontal: 4, marginBottom: 2 }}>• {b}</Text>
            ))}
          </>
        ) : null}

        {analysis.ctaLine ? (
          <>
            {sectionHeader('megaphone', 'CTA Line', colors.success)}
            <Pressable style={styles.analysisRow} onPress={() => toggleApplyField(item.id, 'cta')}>
              <Ionicons name={toggles.cta ? "checkbox" : "square-outline"} size={16} color={colors.success} />
              <View style={styles.analysisContent}>
                <Text style={[styles.analysisLabel, { color: colors.success }]}>Apply as CTA</Text>
                <Text style={[styles.analysisValue, { color: colors.text }]}>{analysis.ctaLine}</Text>
              </View>
            </Pressable>
          </>
        ) : null}

        {analysis.captionDraft ? (
          <>
            {sectionHeader('chatbubble-ellipses', 'Caption Draft', colors.accent)}
            <Pressable style={styles.analysisRow} onPress={() => toggleApplyField(item.id, 'caption')}>
              <Ionicons name={toggles.caption ? "checkbox" : "square-outline"} size={16} color={colors.accent} />
              <View style={styles.analysisContent}>
                <Text style={[styles.analysisLabel, { color: colors.accent }]}>Apply Caption</Text>
                <Text style={[styles.analysisValue, { color: colors.text }]}>{analysis.captionDraft}</Text>
              </View>
            </Pressable>
          </>
        ) : null}

        {analysis.hashtags?.length > 0 ? (
          <>
            {sectionHeader('pricetag', 'Hashtags', colors.textSecondary)}
            <Pressable style={styles.analysisRow} onPress={() => toggleApplyField(item.id, 'keywords')}>
              <Ionicons name={toggles.keywords ? "checkbox" : "square-outline"} size={16} color={colors.textSecondary} />
              <View style={styles.analysisContent}>
                <Text style={[styles.analysisLabel, { color: colors.textSecondary }]}>Apply as Tags</Text>
                <Text style={[styles.analysisValue, { color: colors.textMuted }]}>{analysis.hashtags.map((h: string) => h.startsWith('#') ? h : `#${h}`).join(' ')}</Text>
              </View>
            </Pressable>
          </>
        ) : null}

        {!analysis.applied && (
          <Pressable
            onPress={() => handleApplyAnalysis(item)}
            style={[styles.applyDraftBtn, { backgroundColor: colors.primary, marginTop: 12 }]}
          >
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={styles.applyDraftBtnText}>Apply Selected to Draft</Text>
          </Pressable>
        )}
        {analysis.applied && (
          <View style={[styles.applyDraftBtn, { backgroundColor: colors.success + '20', marginTop: 12 }]}>
            <Ionicons name="checkmark-done" size={16} color={colors.success} />
            <Text style={[styles.applyDraftBtnText, { color: colors.success }]}>Applied</Text>
          </View>
        )}
      </View>
    );
  };

  const handleRetryAnalysis = async (studioItemId: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await apiRequest('POST', `/api/studio/items/${studioItemId}/retry-analysis`, {  });
      setAutoAnalysis(prev => ({ ...prev, [studioItemId]: { ...prev[studioItemId], analysisStatus: 'PENDING', analysisError: null } }));
      startPolling(studioItemId);
    } catch (err) {
      console.warn('[Studio] Retry analysis failed:', err);
    }
  };

  const handleApplyAutoField = (item: MediaItem, field: string, value: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = { ...item };
    if (field === 'caption') updated.autoCaption = value;
    if (field === 'cta') updated.cta = value;
    if (field === 'goal') updated.goal = value;
    updateMediaItem(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const renderAutoAnalysisPanel = (item: MediaItem) => {
    if (!item.studioItemId) return null;
    const analysis = autoAnalysis[item.studioItemId];
    if (!analysis) return null;
    if (analysis.analysisStatus === 'NONE') return null;

    if (analysis.analysisStatus === 'PENDING' || analysis.analysisStatus === 'RUNNING') {
      return (
        <View style={[styles.analysisPanel, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_500Medium' }}>
              AI analyzing content...
            </Text>
          </View>
        </View>
      );
    }

    if (analysis.analysisStatus === 'FAILED') {
      return (
        <View style={[styles.analysisPanel, { backgroundColor: '#EF444410', borderColor: '#EF444430' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Ionicons name="warning-outline" size={16} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 }}>
              Analysis failed: {analysis.analysisError || 'Unknown error'}
            </Text>
          </View>
          <Pressable
            onPress={() => handleRetryAnalysis(item.studioItemId!)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#EF444415', borderRadius: 8, alignSelf: 'flex-start' }}
          >
            <Ionicons name="refresh" size={14} color="#EF4444" />
            <Text style={{ color: '#EF4444', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (analysis.analysisStatus !== 'COMPLETE') return null;

    const suggestions = [
      { key: 'hook', label: 'Hook', icon: 'flash', color: '#EF4444', value: analysis.hook },
      { key: 'goal', label: 'Goal', icon: 'flag', color: '#3B82F6', value: analysis.goal, applyable: true },
      { key: 'contentAngle', label: 'Content Angle', icon: 'compass', color: '#8B5CF6', value: analysis.contentAngle },
      { key: 'suggestedCaption', label: 'Caption', icon: 'chatbubble-ellipses', color: colors.accent, value: analysis.suggestedCaption, applyable: true },
      { key: 'suggestedCta', label: 'CTA', icon: 'megaphone', color: colors.success, value: analysis.suggestedCta, applyable: true },
      { key: 'keywords', label: 'Keywords', icon: 'pricetag', color: colors.textSecondary, value: analysis.keywords },
    ].filter(s => s.value);

    if (suggestions.length === 0) return null;

    return (
      <View style={[styles.analysisPanel, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Ionicons name="sparkles" size={14} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>AI Analysis</Text>
        </View>
        {suggestions.map(s => (
          <View key={s.key} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Ionicons name={s.icon as any} size={12} color={s.color} />
              <Text style={{ color: s.color, fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                {s.label}
              </Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 12, lineHeight: 18, paddingLeft: 16 }} numberOfLines={3}>
              {s.value}
            </Text>
            {s.applyable && (
              <Pressable
                onPress={() => handleApplyAutoField(item, s.key === 'suggestedCaption' ? 'caption' : s.key === 'suggestedCta' ? 'cta' : s.key, s.value!)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: s.color + '15', borderRadius: 6, alignSelf: 'flex-start', marginLeft: 16, marginTop: 4 }}
              >
                <Ionicons name="add-circle-outline" size={12} color={s.color} />
                <Text style={{ color: s.color, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>Apply</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    );
  };

  const router = useRouter();

  const handleOpenStudioItem = (item: MediaItem) => {
    if (item.studioItemId) {
      router.push(`/studio/${item.studioItemId}`);
    }
  };

  const renderMediaCard = (item: MediaItem) => (
    <Pressable
      key={item.id}
      onPress={() => handleOpenStudioItem(item)}
      disabled={!item.studioItemId}
      style={[styles.mediaCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, opacity: item.studioItemId ? 1 : 0.85 }]}
    >
      <View style={styles.mediaCardRow}>
        <View style={[styles.mediaThumbnail, { backgroundColor: colors.inputBackground }]}>
          <Ionicons 
            name={normalizeToStudioType(item.type) === 'reel' ? 'videocam' : normalizeToStudioType(item.type) === 'story' ? 'layers' : 'images'} 
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
        <View style={styles.cardActions}>
          {item.type === 'video' && (
            <Pressable
              onPress={() => handleAnalyzeVideo(item)}
              disabled={analyzingId === item.id}
              style={[styles.analyzeBtn, { backgroundColor: colors.primary + '15' }]}
            >
              <Ionicons
                name={analyzingId === item.id ? "hourglass-outline" : "sparkles-outline"}
                size={16}
                color={colors.primary}
              />
            </Pressable>
          )}
          <Pressable
            onPress={() => handleDeleteMedia(item.id, item.title)}
            style={styles.deleteBtn}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>
      {renderAutoAnalysisPanel(item)}
      {renderAnalysisPanel(item)}
    </Pressable>
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
        {draftRestored && (
          <View style={[styles.draftBanner, { backgroundColor: colors.accent + '20' }]}>
            <Ionicons name="document-text-outline" size={14} color={colors.accent} />
            <Text style={[styles.draftBannerText, { color: colors.accent }]}>Unsaved draft restored</Text>
          </View>
        )}
        {saveError && (
          <View style={[styles.draftBanner, { backgroundColor: colors.error + '20' }]}>
            <Ionicons name="warning-outline" size={14} color={colors.error} />
            <Text style={[styles.draftBannerText, { color: colors.error }]}>{saveError}</Text>
          </View>
        )}
        {isSaving && (
          <View style={[styles.draftBanner, { backgroundColor: colors.textMuted + '10' }]}>
            <Ionicons name="cloud-upload-outline" size={14} color={colors.textMuted} />
            <Text style={[styles.draftBannerText, { color: colors.textMuted }]}>Saving draft...</Text>
          </View>
        )}
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
                <Text style={[styles.statValue, { color: colors.text }]}>{reels.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>Reels</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.stat}>
                <Ionicons name="images" size={20} color={colors.accentOrange} />
                <Text style={[styles.statValue, { color: colors.text }]}>{posts.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>Posts</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.cardBorder }]} />
              <View style={styles.stat}>
                <Ionicons name="layers" size={20} color="#A78BFA" />
                <Text style={[styles.statValue, { color: colors.text }]}>{stories.length}</Text>
                <Text style={[styles.statLabel, { color: colors.textMuted }]}>Stories</Text>
              </View>
            </View>

            {reels.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="videocam" size={20} color={colors.primary} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Reels</Text>
                </View>
                <View style={styles.mediaList}>
                  {reels.map(renderMediaCard)}
                </View>
              </View>
            )}

            {posts.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="images" size={20} color={colors.accentOrange} />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Posts</Text>
                </View>
                <View style={styles.mediaList}>
                  {posts.map(renderMediaCard)}
                </View>
              </View>
            )}

            {stories.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="layers" size={20} color="#A78BFA" />
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Stories</Text>
                </View>
                <View style={styles.mediaList}>
                  {stories.map(renderMediaCard)}
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
                <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.primary + '10', borderRadius: 10, borderWidth: 1, borderColor: colors.primary + '20' }}>
                  <Ionicons name="sparkles" size={16} color={colors.primary} />
                  <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
                    Upload videos to unlock AI Analysis — auto-extract hooks, captions, CTAs, and keywords
                  </Text>
                </View>
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
                {mediaTypes.map((mt) => {
                  const isSelected = mediaType === mt.id;
                  const accentColor = mt.id === 'video' ? colors.primary : mt.id === 'poster' ? (colors as any).accentOrange || '#F59E0B' : colors.accent;
                  return (
                    <Pressable
                      key={mt.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setMediaType(mt.id);
                        updateState({ mediaType: mt.id });
                      }}
                      style={[
                        styles.typeButton,
                        {
                          backgroundColor: isSelected ? accentColor + '20' : colors.inputBackground,
                          borderColor: isSelected ? accentColor : 'transparent',
                        }
                      ]}
                    >
                      <Ionicons
                        name={mt.icon}
                        size={24}
                        color={isSelected ? accentColor : colors.textMuted}
                      />
                      <Text style={[
                        styles.typeLabel,
                        { color: isSelected ? accentColor : colors.textMuted }
                      ]}>
                        {mt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('studio.titleLabel')}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('studio.titlePlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={mediaTitle}
                onChangeText={(v) => { setMediaTitle(v); updateState({ mediaTitle: v }); }}
              />

              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('create.platform')}</Text>
              <PlatformPicker selected={mediaPlatform} onChange={(v) => { setMediaPlatform(v); updateState({ mediaPlatform: v }); }} single />

              <View style={[styles.metadataSection, { borderColor: metadataFilled ? colors.success + '40' : colors.cardBorder }]}>
                <View style={styles.metadataBadge}>
                  <Ionicons name={metadataFilled ? "checkmark-circle" : "flash"} size={14} color={metadataFilled ? colors.success : colors.primary} />
                  <Text style={[styles.metadataBadgeText, { color: metadataFilled ? colors.success : colors.primary }]}>
                    {metadataFilled ? 'AI Metadata Ready — Edit if needed' : 'AI Publishing Metadata'}
                  </Text>
                </View>

                {!metadataFilled && !mediaGoal.trim() ? (
                  <Pressable
                    onPress={handleAIAutoFill}
                    disabled={isAutoFilling}
                    style={({ pressed }) => [
                      {
                        backgroundColor: isAutoFilling ? colors.primary + '30' : colors.primary + '15',
                        borderRadius: 12,
                        padding: 16,
                        alignItems: 'center' as const,
                        justifyContent: 'center' as const,
                        gap: 8,
                        borderWidth: 1,
                        borderColor: colors.primary + '30',
                        borderStyle: 'dashed' as const,
                        opacity: pressed ? 0.7 : 1,
                        marginVertical: 4,
                      },
                    ]}
                  >
                    <Ionicons name={isAutoFilling ? "hourglass-outline" : "sparkles"} size={28} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' as const, textAlign: 'center' as const }}>
                      {isAutoFilling ? 'AI is analyzing your content...' : 'Tap to Auto-Fill with AI'}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' as const }}>
                      {isAutoFilling ? 'Generating goal, audience, CTA & more' : 'AI will suggest Goal, Audience, CTA, and more based on your title'}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 }}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Goal</Text>
                      {metadataFilled && <View style={{ backgroundColor: colors.success + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}><Text style={{ color: colors.success, fontSize: 10, fontWeight: '600' as const }}>AI</Text></View>}
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: metadataFilled ? colors.success + '30' : colors.inputBorder }]}
                      placeholder="e.g. Drive sales, Build awareness, Get leads"
                      placeholderTextColor={colors.textMuted}
                      value={mediaGoal}
                      onChangeText={(v) => { setMediaGoal(v); updateState({ mediaGoal: v }); }}
                    />

                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 }}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Target Audience</Text>
                      {metadataFilled && <View style={{ backgroundColor: colors.success + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}><Text style={{ color: colors.success, fontSize: 10, fontWeight: '600' as const }}>AI</Text></View>}
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: metadataFilled ? colors.success + '30' : colors.inputBorder }]}
                      placeholder="e.g. Dubai entrepreneurs, 25-40, tech-savvy"
                      placeholderTextColor={colors.textMuted}
                      value={mediaAudience}
                      onChangeText={(v) => { setMediaAudience(v); updateState({ mediaAudience: v }); }}
                    />

                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 }}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Call to Action</Text>
                      {metadataFilled && <View style={{ backgroundColor: colors.success + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}><Text style={{ color: colors.success, fontSize: 10, fontWeight: '600' as const }}>AI</Text></View>}
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: metadataFilled ? colors.success + '30' : colors.inputBorder }]}
                      placeholder="e.g. Book now, Shop the link, DM us"
                      placeholderTextColor={colors.textMuted}
                      value={mediaCta}
                      onChangeText={(v) => { setMediaCta(v); updateState({ mediaCta: v }); }}
                    />

                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 }}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Content Series</Text>
                      {metadataFilled && mediaSeries.trim() !== '' && <View style={{ backgroundColor: colors.success + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}><Text style={{ color: colors.success, fontSize: 10, fontWeight: '600' as const }}>AI</Text></View>}
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: metadataFilled && mediaSeries.trim() ? colors.success + '30' : colors.inputBorder }]}
                      placeholder="e.g. Monday Motivation, Behind the Scenes"
                      placeholderTextColor={colors.textMuted}
                      value={mediaSeries}
                      onChangeText={(v) => { setMediaSeries(v); updateState({ mediaSeries: v }); }}
                    />

                    <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 4 }}>
                      <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 0 }]}>Offer / Promotion</Text>
                      {metadataFilled && mediaOffer.trim() !== '' && <View style={{ backgroundColor: colors.success + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}><Text style={{ color: colors.success, fontSize: 10, fontWeight: '600' as const }}>AI</Text></View>}
                    </View>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: metadataFilled && mediaOffer.trim() ? colors.success + '30' : colors.inputBorder }]}
                      placeholder="e.g. 20% off this week, Free consultation"
                      placeholderTextColor={colors.textMuted}
                      value={mediaOffer}
                      onChangeText={(v) => { setMediaOffer(v); updateState({ mediaOffer: v }); }}
                    />

                    {metadataFilled && (
                      <Pressable
                        onPress={handleAIAutoFill}
                        disabled={isAutoFilling}
                        style={{ flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 8, marginTop: 4 }}
                      >
                        <Ionicons name={isAutoFilling ? "hourglass-outline" : "refresh"} size={14} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '600' as const }}>
                          {isAutoFilling ? 'Regenerating...' : 'Regenerate AI Suggestions'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>

              <Pressable
                onPress={handlePickMedia}
                style={[styles.uploadArea, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
              >
                {selectedUri ? (
                  <View style={styles.uploadedState}>
                    <Ionicons name="checkmark-circle" size={32} color={colors.success} />
                    <Text style={[styles.uploadedText, { color: colors.success }]}>
                      {(STUDIO_TYPE_LABELS[mediaType] || mediaType) + ' selected'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={40} color={colors.textMuted} />
                    <Text style={[styles.uploadText, { color: colors.textMuted }]}>
                      Tap to select {(STUDIO_TYPE_LABELS[mediaType] || mediaType).toLowerCase()}
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
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  mediaCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardActions: {
    alignItems: 'center',
    gap: 4,
  },
  analyzeBtn: {
    padding: 8,
    borderRadius: 10,
  },
  analysisPanel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 8,
    marginTop: 4,
  },
  analysisRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  analysisContent: {
    flex: 1,
    gap: 2,
  },
  analysisLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  analysisValue: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  applyDraftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 4,
  },
  applyDraftBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
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
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 8,
  },
  draftBannerText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
