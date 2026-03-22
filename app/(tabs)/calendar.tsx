import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
  FlatList,
  Animated as RNAnimated,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';
import { useLanguage } from '@/context/LanguageContext';
import { CalendarDay } from '@/components/CalendarDay';
import { ContentCard } from '@/components/ContentCard';
import { PlatformPicker } from '@/components/PlatformPicker';
import { generateId } from '@/lib/storage';
import { getApiUrl , authFetch } from '@/lib/query-client';
import { createRouteForContentType } from '@/lib/media-types';
import type { ScheduledPost } from '@/lib/types';

interface DBCalendarEntry {
  id: string;
  planId: string;
  campaignId: string;
  accountId: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string | null;
  caption: string | null;
  creativeBrief: string | null;
  ctaCopy: string | null;
  status: string;
  studioItemId: string | null;
  aiGeneratedAt: string | null;
  errorReason: string | null;
  sourceLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

const postTypesDef = [
  { id: 'post', labelKey: 'calendar.post', icon: 'document-text-outline' as const },
  { id: 'reel', labelKey: 'calendar.reel', icon: 'videocam-outline' as const },
  { id: 'story', labelKey: 'calendar.storyType', icon: 'layers-outline' as const },
  { id: 'video', labelKey: 'calendar.video', icon: 'play-circle-outline' as const },
];

const timeSlots = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
];

interface AICalendarPost {
  day: number;
  time: string;
  type: 'post' | 'reel' | 'story';
  platform: string;
  content: string;
  strategy_note: string;
}

function AIPulse({ color }: { color: string }) {
  const pulseAnim = useRef(new RNAnimated.Value(0.4)).current;
  useEffect(() => {
    const pulse = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);
  return (
    <RNAnimated.View style={[styles.aiPulseDot, { backgroundColor: color, opacity: pulseAnim }]} />
  );
}

export default function CalendarScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { contentItems, removeContentItem, scheduledPosts, addScheduledPost, removeScheduledPost, mediaItems, brandProfile } = useApp();
  const { selectedCampaign } = useCampaign();
  const { t } = useLanguage();
  const router = useRouter();

  const [dbCalendarEntries, setDbCalendarEntries] = useState<DBCalendarEntry[]>([]);
  const [dbEntriesLoading, setDbEntriesLoading] = useState(false);
  const [dbPlanId, setDbPlanId] = useState<string | null>(null);
  const [generatingEntryId, setGeneratingEntryId] = useState<string | null>(null);

  const fetchCalendarEntries = useCallback(async () => {
    if (!selectedCampaign?.selectedCampaignId) {
      setDbCalendarEntries([]);
      setDbPlanId(null);
      setDbEntriesLoading(false);
      return;
    }
    setDbEntriesLoading(true);
    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/execution/calendar-entries', baseUrl);
      url.searchParams.set('campaignId', selectedCampaign.selectedCampaignId);
      const response = await authFetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        setDbCalendarEntries(data.entries || []);
        setDbPlanId(data.planId || null);
      }
    } catch (err) {
      console.error('[Calendar] Failed to fetch DB entries:', err);
    } finally {
      setDbEntriesLoading(false);
    }
  }, [selectedCampaign?.selectedCampaignId]);

  useEffect(() => {
    setDbCalendarEntries([]);
    setDbPlanId(null);
    setDbEntriesLoading(true);
    fetchCalendarEntries();
  }, [fetchCalendarEntries]);

  const handleGenerateEntry = useCallback((entryId: string) => {
    const entry = dbCalendarEntries.find(e => e.id === entryId);
    if (!entry) return;

    const route = createRouteForContentType(entry.contentType);
    const pathname = '/(tabs)/create';

    if (__DEV__) {
      console.log('NAV_CREATE', { entryId, contentType: entry.contentType, pathname, tab: route.tab });
    }

    Platform.OS !== 'web' && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    router.navigate({
      pathname: pathname as any,
      params: {
        calendarEntryId: entryId,
        calendarContentType: entry.contentType || 'post',
        calendarTab: route.tab,
        calendarTopic: entry.title || '',
      },
    });
  }, [dbCalendarEntries, router]);

  const [resettingFailed, setResettingFailed] = useState(false);

  const dbEntryStats = useMemo(() => {
    const total = dbCalendarEntries.length;
    const generated = dbCalendarEntries.filter(e => !['DRAFT', 'FAILED'].includes(e.status)).length;
    const failed = dbCalendarEntries.filter(e => e.status === 'FAILED').length;
    return { total, generated, failed, remaining: total - generated - failed };
  }, [dbCalendarEntries]);

  const handleResetAllFailed = useCallback(async () => {
    if (!dbPlanId) {
      Alert.alert('No Plan', 'No active plan found to reset entries for.');
      return;
    }
    if (dbEntryStats.failed === 0) {
      Alert.alert('No Failed Entries', 'There are no failed entries to reset.');
      return;
    }
    Alert.alert(
      'Reset Failed Entries',
      `This will reset ${dbEntryStats.failed} failed entries back to draft so you can retry creating them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All',
          style: 'destructive',
          onPress: async () => {
            setResettingFailed(true);
            try {
              const baseUrl = getApiUrl();
              const resetUrl = new URL(`/api/execution/plans/${dbPlanId}/reset-failed`, baseUrl);
              if (selectedCampaign?.selectedCampaignId) {
                resetUrl.searchParams.set('campaignId', selectedCampaign.selectedCampaignId);
              }
              const res = await authFetch(resetUrl.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              const data = await res.json();
              if (res.ok && data.success) {
                Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Done', data.message || `Reset ${data.resetCount || 0} entries to draft.`);
                fetchCalendarEntries();
              } else {
                const errorMsg = data.message || data.error || 'Reset failed';
                Alert.alert('Reset Failed', errorMsg);
              }
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Network error — could not reset entries.');
            } finally {
              setResettingFailed(false);
            }
          },
        },
      ]
    );
  }, [dbPlanId, dbEntryStats.failed, fetchCalendarEntries, selectedCampaign?.selectedCampaignId]);

  const postTypes = postTypesDef.map(pt => ({ ...pt, label: t(pt.labelKey) }));
  const days = Array.from({length: 7}, (_, i) => t(`calendar.days.${i}`));
  const months = Array.from({length: 12}, (_, i) => t(`calendar.months.${i}`));

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(today.getDate());
  const [currentMonth] = useState(today.getMonth());
  const [currentYear] = useState(today.getFullYear());
  const [showModal, setShowModal] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);

  const [postType, setPostType] = useState<string>('post');
  const [postContent, setPostContent] = useState('');
  const [postTime, setPostTime] = useState('09:00');
  const [postPlatform, setPostPlatform] = useState<string[]>(['Instagram']);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);

  const [aiStep, setAiStep] = useState(0);
  const [aiGoals, setAiGoals] = useState('');
  const [aiProducts, setAiProducts] = useState('');
  const [aiPlatforms, setAiPlatforms] = useState<string[]>(['Instagram']);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCalendar, setAiCalendar] = useState<AICalendarPost[]>([]);
  const [aiError, setAiError] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const calendarDays = useMemo(() => {
    const daysArr = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      daysArr.push({ date: 0, key: `empty-${i}` });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      daysArr.push({ date: i, key: `day-${i}` });
    }
    return daysArr;
  }, [firstDayOfMonth, daysInMonth]);

  const scheduledDates = useMemo(() => {
    const dates = new Set<number>();
    contentItems.forEach(item => {
      if (item.scheduledDate) {
        const date = new Date(item.scheduledDate);
        if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
          dates.add(date.getDate());
        }
      }
    });
    scheduledPosts.forEach(post => {
      const date = new Date(post.scheduledDate);
      if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
        dates.add(date.getDate());
      }
    });
    dbCalendarEntries.forEach(entry => {
      const parts = entry.scheduledDate.split('-');
      if (parts.length === 3) {
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[0], 10);
        const day = parseInt(parts[2], 10);
        if (month === currentMonth && year === currentYear) {
          dates.add(day);
        }
      }
    });
    return dates;
  }, [contentItems, scheduledPosts, dbCalendarEntries, currentMonth, currentYear]);

  const selectedContent = useMemo(() => {
    return contentItems.filter(item => {
      if (item.scheduledDate) {
        const date = new Date(item.scheduledDate);
        return date.getDate() === selectedDate && 
               date.getMonth() === currentMonth && 
               date.getFullYear() === currentYear;
      }
      return false;
    });
  }, [contentItems, selectedDate, currentMonth, currentYear]);

  const selectedScheduled = useMemo(() => {
    return scheduledPosts.filter(post => {
      const date = new Date(post.scheduledDate);
      return date.getDate() === selectedDate && 
             date.getMonth() === currentMonth && 
             date.getFullYear() === currentYear;
    });
  }, [scheduledPosts, selectedDate, currentMonth, currentYear]);

  const selectedDbEntries = useMemo(() => {
    return dbCalendarEntries.filter(entry => {
      const parts = entry.scheduledDate.split('-');
      if (parts.length !== 3) return false;
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return day === selectedDate && month === currentMonth && year === currentYear;
    });
  }, [dbCalendarEntries, selectedDate, currentMonth, currentYear]);

  const availableVideos = useMemo(() => {
    return mediaItems.filter(m => m.type === 'video' && m.status === 'draft');
  }, [mediaItems]);

  const handleAddSchedule = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowModal(true);
    setPostType('post');
    setPostContent('');
    setPostTime('09:00');
    setPostPlatform(['Instagram']);
    setSelectedMediaId(null);
  };

  const handleCreateSchedule = async () => {
    if (!postContent.trim() && postType !== 'video') {
      Alert.alert(t('calendar.missingContent'), t('calendar.enterContent'));
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const scheduledDate = new Date(currentYear, currentMonth, selectedDate);
    
    const newPost: ScheduledPost = {
      id: generateId(),
      type: postType as ScheduledPost['type'],
      content: postContent,
      mediaId: selectedMediaId || undefined,
      platform: postPlatform[0],
      scheduledDate: scheduledDate.toISOString(),
      scheduledTime: postTime,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await addScheduledPost(newPost);
    setShowModal(false);
    Alert.alert(t('calendar.scheduled'), `${months[currentMonth]} ${selectedDate} - ${postTime}`);
  };

  const handleDeleteScheduled = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await removeScheduledPost(id);
  };

  const handleOpenAIAssistant = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowAIAssistant(true);
    setAiStep(0);
    setAiGoals('');
    setAiProducts('');
    setAiPlatforms(brandProfile.platforms.length > 0 ? brandProfile.platforms : ['Instagram']);
    setAiCalendar([]);
    setAiError('');
    setShowPreview(false);
  };

  const handleAINext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (aiStep === 0 && !aiGoals.trim()) return;
    if (aiStep === 1 && !aiProducts.trim()) return;
    setAiStep(prev => prev + 1);
  };

  const handleAIBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAiStep(prev => prev - 1);
  };

  const handleBuildCalendar = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setAiLoading(true);
    setAiError('');

    try {
      const baseUrl = getApiUrl();
      const url = new URL('/api/generate-calendar', baseUrl);
      const response = await authFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: brandProfile.name,
          industry: brandProfile.industry,
          tone: brandProfile.tone,
          targetAudience: brandProfile.targetAudience,
          platforms: aiPlatforms,
          goals: aiGoals,
          products: aiProducts,
          month: MONTHS[currentMonth],
          year: currentYear,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate');
      }

      const data = await response.json();
      if (data.calendar && Array.isArray(data.calendar)) {
        setAiCalendar(data.calendar);
        setAiStep(3);
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      setAiError(t('calendar.generationFailed'));
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddAllToCalendar = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    for (const post of aiCalendar) {
      const day = Math.min(Math.max(post.day, 1), daysInMonth);
      const scheduledDate = new Date(currentYear, currentMonth, day);
      const validType = ['post', 'reel', 'story'].includes(post.type) ? post.type : 'post';
      
      const newPost: ScheduledPost = {
        id: generateId(),
        type: validType as ScheduledPost['type'],
        content: post.content,
        platform: post.platform || aiPlatforms[0],
        scheduledDate: scheduledDate.toISOString(),
        scheduledTime: post.time || '09:00',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await addScheduledPost(newPost);
    }

    setShowAIAssistant(false);
    Alert.alert(
      t('calendar.addedToCalendar'),
      `${aiCalendar.length} ${t('calendar.addedToCalendarDesc')}`
    );
  };

  const getPostTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'reel': return 'videocam';
      case 'story': return 'layers';
      case 'video': return 'play-circle';
      case 'carousel': return 'albums';
      default: return 'document-text';
    }
  };

  const getDbStatusColor = (status: string) => {
    switch (status) {
      case 'DRAFT': return { bg: colors.accent + '20', text: colors.accent };
      case 'AI_GENERATED': return { bg: colors.primary + '20', text: colors.primary };
      case 'READY': return { bg: colors.success + '20', text: colors.success };
      case 'PUBLISHED': return { bg: colors.success + '20', text: colors.success };
      case 'SCHEDULED': return { bg: '#3B82F6' + '20', text: '#3B82F6' };
      case 'FAILED': return { bg: colors.error + '20', text: colors.error };
      case 'CANCELED': return { bg: colors.textMuted + '20', text: colors.textMuted };
      default: return { bg: colors.textMuted + '20', text: colors.textMuted };
    }
  };

  const renderAIStep = () => {
    if (aiLoading) {
      return (
        <View style={styles.aiLoadingContainer}>
          <LinearGradient
            colors={colors.primaryGradient as [string, string]}
            style={styles.aiLoadingCircle}
          >
            <ActivityIndicator size="large" color="#fff" />
          </LinearGradient>
          <Text style={[styles.aiLoadingTitle, { color: colors.text }]}>
            {t('calendar.building')}
          </Text>
          <Text style={[styles.aiLoadingDesc, { color: colors.textSecondary }]}>
            {t('calendar.buildingDesc')}
          </Text>
          <View style={styles.aiLoadingDots}>
            <AIPulse color={colors.primary} />
            <AIPulse color={colors.accent} />
            <AIPulse color={colors.primary} />
          </View>
        </View>
      );
    }

    if (aiStep === 3 && aiCalendar.length > 0) {
      return (
        <View style={styles.aiResultContainer}>
          <View style={styles.aiResultHeader}>
            <LinearGradient
              colors={[colors.success + '20', colors.success + '05']}
              style={styles.aiResultBadge}
            >
              <Ionicons name="checkmark-circle" size={32} color={colors.success} />
            </LinearGradient>
            <Text style={[styles.aiResultTitle, { color: colors.text }]}>
              {t('calendar.calendarReady')}
            </Text>
            <Text style={[styles.aiResultDesc, { color: colors.textSecondary }]}>
              {aiCalendar.length} {t('calendar.calendarReadyDesc')}
            </Text>
          </View>

          <View style={styles.aiPreviewStats}>
            {['post', 'reel', 'story'].map(type => {
              const count = aiCalendar.filter(p => p.type === type).length;
              if (count === 0) return null;
              return (
                <View key={type} style={[styles.aiStatChip, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Ionicons name={getPostTypeIcon(type)} size={16} color={colors.primary} />
                  <Text style={[styles.aiStatText, { color: colors.text }]}>
                    {count} {type === 'post' ? t('calendar.post') : type === 'reel' ? t('calendar.reel') : t('calendar.storyType')}
                  </Text>
                </View>
              );
            })}
          </View>

          <Pressable
            onPress={() => setShowPreview(!showPreview)}
            style={[styles.aiPreviewToggle, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          >
            <Ionicons name={showPreview ? 'chevron-up' : 'eye-outline'} size={20} color={colors.primary} />
            <Text style={[styles.aiPreviewToggleText, { color: colors.primary }]}>
              {t('calendar.viewPreview')}
            </Text>
          </Pressable>

          {showPreview && (
            <FlatList
              data={aiCalendar.sort((a, b) => a.day - b.day)}
              keyExtractor={(_, i) => `ai-${i}`}
              style={styles.aiPreviewList}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={[styles.aiPreviewCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={styles.aiPreviewCardHeader}>
                    <View style={[styles.aiPreviewDay, { backgroundColor: colors.primary + '15' }]}>
                      <Text style={[styles.aiPreviewDayNum, { color: colors.primary }]}>{item.day}</Text>
                    </View>
                    <View style={styles.aiPreviewMeta}>
                      <View style={styles.aiPreviewMetaRow}>
                        <Ionicons name={getPostTypeIcon(item.type)} size={14} color={colors.textMuted} />
                        <Text style={[styles.aiPreviewType, { color: colors.textSecondary }]}>
                          {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                        </Text>
                        <Text style={[styles.aiPreviewTime, { color: colors.textMuted }]}>{item.time}</Text>
                        <Text style={[styles.aiPreviewPlatform, { color: colors.textMuted }]}>{item.platform}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={[styles.aiPreviewContent, { color: colors.text }]} numberOfLines={3}>
                    {item.content}
                  </Text>
                  {item.strategy_note && (
                    <View style={[styles.aiStrategyNote, { backgroundColor: colors.accent + '10' }]}>
                      <Ionicons name="bulb-outline" size={12} color={colors.accent} />
                      <Text style={[styles.aiStrategyText, { color: colors.accent }]} numberOfLines={1}>
                        {item.strategy_note}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            />
          )}

          <View style={styles.aiResultActions}>
            <Pressable
              onPress={handleAddAllToCalendar}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, flex: 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.aiAddAllButton}
              >
                <Ionicons name="calendar" size={20} color="#fff" />
                <Text style={styles.aiAddAllText}>{t('calendar.addToCalendar')}</Text>
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable
            onPress={() => { setAiStep(0); setAiCalendar([]); setShowPreview(false); }}
            style={styles.aiStartOverBtn}
          >
            <Text style={[styles.aiStartOverText, { color: colors.textMuted }]}>
              {t('calendar.startOver')}
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.aiStepContainer}
        keyboardVerticalOffset={100}
      >
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.aiGreetingRow}>
            <LinearGradient
              colors={colors.primaryGradient as [string, string]}
              style={styles.aiAvatar}
            >
              <Ionicons name="sparkles" size={20} color="#fff" />
            </LinearGradient>
            <View style={[styles.aiGreetingBubble, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Text style={[styles.aiGreetingText, { color: colors.text }]}>
                {aiStep === 0
                  ? t('calendar.aiGreeting')
                  : aiStep === 1
                  ? t('calendar.questionProducts')
                  : t('calendar.questionPlatforms')
                }
              </Text>
            </View>
          </View>

          <View style={styles.aiStepIndicator}>
            {[0, 1, 2].map(s => (
              <View 
                key={s}
                style={[
                  styles.aiStepDot,
                  { backgroundColor: s <= aiStep ? colors.primary : colors.inputBackground }
                ]}
              />
            ))}
            <Text style={[styles.aiStepLabel, { color: colors.textMuted }]}>
              {t('calendar.step')} {aiStep + 1} {t('calendar.of')} 3
            </Text>
          </View>

          {aiStep === 0 && (
            <View style={styles.aiInputSection}>
              <Text style={[styles.aiInputLabel, { color: colors.text }]}>
                {t('calendar.questionGoals')}
              </Text>
              <TextInput
                style={[styles.aiTextInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('calendar.goalsPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={aiGoals}
                onChangeText={setAiGoals}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

          {aiStep === 1 && (
            <View style={styles.aiInputSection}>
              <Text style={[styles.aiInputLabel, { color: colors.text }]}>
                {t('calendar.questionProducts')}
              </Text>
              <TextInput
                style={[styles.aiTextInput, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={t('calendar.productsPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={aiProducts}
                onChangeText={setAiProducts}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

          {aiStep === 2 && (
            <View style={styles.aiInputSection}>
              <Text style={[styles.aiInputLabel, { color: colors.text }]}>
                {t('calendar.questionPlatforms')}
              </Text>
              <PlatformPicker selected={aiPlatforms} onChange={setAiPlatforms} />
              
              <View style={[styles.aiSummaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.aiSummaryRow}>
                  <Ionicons name="flag-outline" size={16} color={colors.primary} />
                  <Text style={[styles.aiSummaryLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                    {aiGoals}
                  </Text>
                </View>
                <View style={styles.aiSummaryRow}>
                  <Ionicons name="cube-outline" size={16} color={colors.accent} />
                  <Text style={[styles.aiSummaryLabel, { color: colors.textSecondary }]} numberOfLines={2}>
                    {aiProducts}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {aiError ? (
            <View style={[styles.aiErrorBox, { backgroundColor: colors.error + '15' }]}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={[styles.aiErrorText, { color: colors.error }]}>{aiError}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.aiNavRow}>
          {aiStep > 0 ? (
            <Pressable
              onPress={handleAIBack}
              style={[styles.aiBackBtn, { borderColor: colors.cardBorder }]}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
              <Text style={[styles.aiBackText, { color: colors.text }]}>{t('calendar.back')}</Text>
            </Pressable>
          ) : (
            <View />
          )}

          {aiStep < 2 ? (
            <Pressable
              onPress={handleAINext}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
              disabled={(aiStep === 0 && !aiGoals.trim()) || (aiStep === 1 && !aiProducts.trim())}
            >
              <LinearGradient
                colors={
                  ((aiStep === 0 && !aiGoals.trim()) || (aiStep === 1 && !aiProducts.trim()))
                    ? [colors.textMuted, colors.textMuted]
                    : colors.primaryGradient as [string, string]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.aiNextBtn}
              >
                <Text style={styles.aiNextText}>{t('calendar.next')}</Text>
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleBuildCalendar}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.aiNextBtn}
              >
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.aiNextText}>{t('calendar.buildCalendar')}</Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    );
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
            <Text style={[styles.title, { color: colors.text }]}>{t('calendar.title')}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('calendar.subtitle')}
            </Text>
          </View>
          <Pressable
            onPress={handleAddSchedule}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={[styles.aiPlanBanner, { backgroundColor: isDark ? '#10B981' + '10' : '#10B981' + '08', borderColor: '#10B981' + '25' }]}>
          <View style={styles.aiPlanBannerLeft}>
            <Ionicons name="shield-checkmark" size={16} color="#10B981" />
            <Text style={[styles.aiPlanBannerText, { color: '#10B981' }]}>AI Content Plan Active</Text>
          </View>
          <Pressable onPress={handleOpenAIAssistant}>
            <Text style={[styles.aiPlanBannerAction, { color: '#10B981' }]}>Generate</Text>
          </Pressable>
        </View>

        <Pressable onPress={handleOpenAIAssistant} testID="ai-assistant-card">
          <LinearGradient
            colors={colors.primaryGradient as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.aiCard}
          >
            <View style={styles.aiCardContent}>
              <View style={styles.aiCardIcon}>
                <Ionicons name="sparkles" size={24} color="#fff" />
              </View>
              <View style={styles.aiCardText}>
                <Text style={styles.aiCardTitle}>AI Calendar Planner</Text>
                <Text style={styles.aiCardDesc}>Let AI build your monthly content plan</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.7)" />
            </View>
          </LinearGradient>
        </Pressable>

        <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.monthHeader}>
            <Text style={[styles.monthTitle, { color: colors.text }]}>
              {months[currentMonth]} {currentYear}
            </Text>
          </View>

          <View style={styles.weekDays}>
            {days.map((day, i) => (
              <Text key={i} style={[styles.weekDay, { color: colors.textMuted }]}>
                {day}
              </Text>
            ))}
          </View>

          <View style={styles.daysGrid}>
            {calendarDays.map(item => (
              <CalendarDay
                key={item.key}
                date={item.date}
                isSelected={item.date === selectedDate}
                isToday={item.date === today.getDate() && currentMonth === today.getMonth()}
                hasContent={scheduledDates.has(item.date)}
                onPress={() => {
                  if (item.date > 0) {
                    Haptics.selectionAsync();
                    setSelectedDate(item.date);
                  }
                }}
              />
            ))}
          </View>
        </View>

        <View style={styles.selectedSection}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {months[currentMonth]} {selectedDate}
            </Text>
            <Pressable
              onPress={handleAddSchedule}
              style={[styles.smallAddButton, { backgroundColor: colors.primary + '20' }]}
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={[styles.smallAddText, { color: colors.primary }]}>{t('calendar.add')}</Text>
            </Pressable>
          </View>

          {selectedDbEntries.length > 0 && (
            <View style={styles.scheduleList}>
              {dbPlanId && (
                <View>
                  <View style={[styles.dbEntriesHeader, { backgroundColor: colors.primary + '08', borderColor: colors.primary + '20' }]}>
                    <Ionicons name="git-branch-outline" size={14} color={colors.primary} />
                    <Text style={[styles.dbEntriesHeaderText, { color: colors.primary }]}>
                      Plan-driven content
                    </Text>
                    {dbEntryStats.total > 0 && (
                      <Text style={[styles.dbEntriesCounter, { color: colors.textMuted }]}>
                        {dbEntryStats.generated}/{dbEntryStats.total} generated
                      </Text>
                    )}
                  </View>
                  {dbEntryStats.failed > 0 && (
                    <View style={[styles.failedResetBar, { backgroundColor: '#FF6B6B10', borderColor: '#FF6B6B30' }]}>
                      <View style={styles.failedResetInfo}>
                        <Ionicons name="warning" size={14} color="#FF6B6B" />
                        <Text style={{ color: '#FF6B6B', fontSize: 12, fontWeight: '600' }}>
                          {dbEntryStats.failed} failed
                        </Text>
                      </View>
                      <Pressable
                        onPress={handleResetAllFailed}
                        disabled={resettingFailed}
                        style={[styles.resetAllBtn, { opacity: resettingFailed ? 0.6 : 1 }]}
                      >
                        {resettingFailed ? (
                          <ActivityIndicator size="small" color="#FF6B6B" />
                        ) : (
                          <>
                            <Ionicons name="refresh" size={13} color="#FF6B6B" />
                            <Text style={{ color: '#FF6B6B', fontSize: 12, fontWeight: '700' }}>Reset All Failed</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
              {selectedDbEntries.map(entry => {
                const statusColor = getDbStatusColor(entry.status);
                const isGenerating = generatingEntryId === entry.id;
                const isDraft = entry.status === 'DRAFT';
                const isFailed = entry.status === 'FAILED';
                return (
                  <View
                    key={entry.id}
                    style={[styles.scheduleCard, { backgroundColor: colors.card, borderColor: isFailed ? '#FF6B6B40' : colors.cardBorder }]}
                  >
                    <View style={styles.scheduleLeft}>
                      <View style={[styles.scheduleIcon, { backgroundColor: colors.primary + '15' }]}>
                        <Ionicons name={getPostTypeIcon(entry.contentType)} size={20} color={colors.primary} />
                      </View>
                      <View style={[styles.scheduleInfo, { flex: 1 }]}>
                        <Text style={[styles.scheduleType, { color: colors.text }]}>
                          {entry.title || (entry.contentType.charAt(0).toUpperCase() + entry.contentType.slice(1))}
                        </Text>
                        {entry.caption ? (
                          <Text style={[styles.scheduleContent, { color: colors.textSecondary }]} numberOfLines={2}>
                            {entry.caption}
                          </Text>
                        ) : null}
                        {isFailed && entry.errorReason ? (
                          <Text style={{ color: '#FF6B6B', fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                            {entry.errorReason}
                          </Text>
                        ) : null}
                        <View style={styles.scheduleMetaRow}>
                          <Text style={[styles.scheduleMeta, { color: colors.textMuted }]}>
                            {entry.scheduledTime} • {entry.contentType}
                          </Text>
                          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                            <Text style={[styles.statusText, { color: statusColor.text }]}>
                              {entry.status}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                    {(isDraft || isFailed) && (
                      <Pressable
                        onPress={() => handleGenerateEntry(entry.id)}
                        style={[styles.generateEntryBtn]}
                      >
                        <Ionicons name="arrow-forward-circle" size={14} color="#7C3AED" />
                        <Text style={styles.generateEntryBtnText}>
                          Create
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {selectedScheduled.length > 0 && (
            <View style={[styles.scheduleList, selectedDbEntries.length > 0 ? { marginTop: 12 } : undefined]}>
              {selectedDbEntries.length > 0 && (
                <View style={[styles.dbEntriesHeader, { backgroundColor: colors.accent + '08', borderColor: colors.accent + '20' }]}>
                  <Ionicons name="create-outline" size={14} color={colors.accent} />
                  <Text style={[styles.dbEntriesHeaderText, { color: colors.accent }]}>
                    Manually scheduled
                  </Text>
                </View>
              )}
              {selectedScheduled.map(post => (
                <View 
                  key={post.id}
                  style={[styles.scheduleCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                >
                  <View style={styles.scheduleLeft}>
                    <View style={[styles.scheduleIcon, { backgroundColor: colors.primary + '20' }]}>
                      <Ionicons name={getPostTypeIcon(post.type)} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.scheduleInfo}>
                      <Text style={[styles.scheduleType, { color: colors.text }]}>
                        {post.type.charAt(0).toUpperCase() + post.type.slice(1)}
                      </Text>
                      <Text style={[styles.scheduleContent, { color: colors.textSecondary }]} numberOfLines={1}>
                        {post.content || t('calendar.videoContent')}
                      </Text>
                      <View style={styles.scheduleMetaRow}>
                        <Text style={[styles.scheduleMeta, { color: colors.textMuted }]}>
                          {post.scheduledTime} • {post.platform}
                        </Text>
                        <View style={[
                          styles.statusBadge, 
                          { backgroundColor: post.status === 'pending' ? colors.accent + '20' : colors.success + '20' }
                        ]}>
                          <Text style={[
                            styles.statusText,
                            { color: post.status === 'pending' ? colors.accent : colors.success }
                          ]}>
                            {post.status}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => handleDeleteScheduled(post.id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {selectedScheduled.length === 0 && selectedDbEntries.length === 0 && selectedContent.length > 0 && (
            <View style={styles.contentList}>
              {selectedContent.map(item => (
                <ContentCard
                  key={item.id}
                  content={item}
                  onDelete={() => removeContentItem(item.id)}
                />
              ))}
            </View>
          )}

          {selectedScheduled.length === 0 && selectedDbEntries.length === 0 && selectedContent.length === 0 && (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                {t('calendar.noContentScheduled')}
              </Text>
              <Pressable
                onPress={handleAddSchedule}
                style={[styles.emptyButton, { backgroundColor: colors.primary + '20' }]}
              >
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={[styles.emptyButtonText, { color: colors.primary }]}>{t('calendar.scheduleContent')}</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={showAIAssistant}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAIAssistant(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.aiModalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <View style={styles.aiModalTitleRow}>
                <LinearGradient
                  colors={colors.primaryGradient as [string, string]}
                  style={styles.aiModalIcon}
                >
                  <Ionicons name="sparkles" size={14} color="#fff" />
                </LinearGradient>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {t('calendar.aiAssistant')}
                </Text>
              </View>
              <Pressable onPress={() => setShowAIAssistant(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            {renderAIStep()}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {t('calendar.scheduleFor')} {months[currentMonth]} {selectedDate}
              </Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('calendar.contentType')}</Text>
              <View style={styles.typeGrid}>
                {postTypes.map(type => (
                  <Pressable
                    key={type.id}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setPostType(type.id);
                    }}
                    style={[
                      styles.typeButton,
                      { 
                        backgroundColor: postType === type.id ? colors.primary + '20' : colors.inputBackground,
                        borderColor: postType === type.id ? colors.primary : 'transparent',
                      }
                    ]}
                  >
                    <Ionicons 
                      name={type.icon} 
                      size={20} 
                      color={postType === type.id ? colors.primary : colors.textMuted} 
                    />
                    <Text style={[
                      styles.typeLabel,
                      { color: postType === type.id ? colors.primary : colors.textMuted }
                    ]}>
                      {type.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.inputLabel, { color: colors.text }]}>{t('create.platform')}</Text>
              <PlatformPicker selected={postPlatform} onChange={setPostPlatform} single />

              <Text style={[styles.inputLabel, { color: colors.text, marginTop: 16 }]}>{t('calendar.time')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.timeRow}>
                  {timeSlots.map(time => (
                    <Pressable
                      key={time}
                      onPress={() => setPostTime(time)}
                      style={[
                        styles.timeButton,
                        { 
                          backgroundColor: postTime === time ? colors.primary : colors.inputBackground,
                        }
                      ]}
                    >
                      <Text style={[
                        styles.timeText,
                        { color: postTime === time ? '#fff' : colors.textMuted }
                      ]}>
                        {time}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {postType === 'video' && availableVideos.length > 0 && (
                <>
                  <Text style={[styles.inputLabel, { color: colors.text, marginTop: 16 }]}>{t('calendar.selectVideoFromStudio')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.videoRow}>
                      {availableVideos.map(video => (
                        <Pressable
                          key={video.id}
                          onPress={() => setSelectedMediaId(video.id)}
                          style={[
                            styles.videoThumb,
                            { 
                              backgroundColor: colors.inputBackground,
                              borderColor: selectedMediaId === video.id ? colors.primary : 'transparent',
                            }
                          ]}
                        >
                          <Ionicons name="videocam" size={24} color={colors.textMuted} />
                          <Text style={[styles.videoTitle, { color: colors.text }]} numberOfLines={1}>
                            {video.title}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </>
              )}

              <Text style={[styles.inputLabel, { color: colors.text, marginTop: 16 }]}>
                {postType === 'video' ? t('calendar.captionOptional') : t('calendar.content')}
              </Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={postType === 'video' ? t('calendar.captionPlaceholder') : t('calendar.contentPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={postContent}
                onChangeText={setPostContent}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </ScrollView>

            <Pressable
              onPress={handleCreateSchedule}
              style={({ pressed }) => [styles.scheduleButton, { opacity: pressed ? 0.8 : 1 }]}
            >
              <LinearGradient
                colors={colors.primaryGradient as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Ionicons name="calendar" size={20} color="#fff" />
                <Text style={styles.scheduleButtonText}>{t(`calendar.schedule${postType.charAt(0).toUpperCase() + postType.slice(1)}`)}</Text>
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
  aiPlanBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  aiPlanBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiPlanBannerText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  aiPlanBannerAction: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCard: {
    borderRadius: 20,
    marginBottom: 20,
    overflow: 'hidden',
  },
  aiCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 14,
  },
  aiCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCardText: {
    flex: 1,
  },
  aiCardTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    marginBottom: 2,
  },
  aiCardDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.8)',
  },
  calendarCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  monthTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  weekDays: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  weekDay: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    width: 36,
    textAlign: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  selectedSection: {},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  smallAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  smallAddText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  scheduleList: {
    gap: 12,
  },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  scheduleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  scheduleIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleInfo: {
    flex: 1,
    gap: 2,
  },
  scheduleType: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  scheduleContent: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  scheduleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  scheduleMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  deleteButton: {
    padding: 8,
  },
  contentList: {
    gap: 16,
  },
  dbEntriesHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 4,
  },
  dbEntriesHeaderText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  dbEntriesCounter: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  failedResetBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  failedResetInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  resetAllBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#FF6B6B15',
  },
  generateEntryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#7C3AED15',
  },
  generateEntryBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#7C3AED',
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
    marginTop: 4,
  },
  emptyButtonText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
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
  aiModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '92%',
    flex: 1,
    marginTop: 60,
  },
  aiModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiModalIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  typeLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  timeButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  timeText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  videoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  videoThumb: {
    width: 100,
    height: 80,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    gap: 6,
  },
  videoTitle: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    paddingHorizontal: 4,
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
  scheduleButton: {},
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  scheduleButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  aiStepContainer: {
    flex: 1,
  },
  aiGreetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  aiAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGreetingBubble: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    borderTopLeftRadius: 4,
  },
  aiGreetingText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  aiStepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  aiStepDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
  },
  aiStepLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginLeft: 8,
  },
  aiInputSection: {
    marginBottom: 16,
  },
  aiInputLabel: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 12,
  },
  aiTextInput: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    minHeight: 110,
    textAlignVertical: 'top',
  },
  aiNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
  },
  aiBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  aiBackText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
  },
  aiNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  aiNextText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  aiSummaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 20,
    gap: 12,
  },
  aiSummaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  aiSummaryLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    flex: 1,
    lineHeight: 18,
  },
  aiLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  aiLoadingCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  aiLoadingTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  aiLoadingDesc: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 40,
    marginBottom: 24,
  },
  aiLoadingDots: {
    flexDirection: 'row',
    gap: 8,
  },
  aiPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  aiResultContainer: {
    flex: 1,
  },
  aiResultHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  aiResultBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  aiResultTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  aiResultDesc: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  aiPreviewStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 16,
  },
  aiStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  aiStatText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  aiPreviewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
  },
  aiPreviewToggleText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  aiPreviewList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  aiPreviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  aiPreviewCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  aiPreviewDay: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiPreviewDayNum: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  aiPreviewMeta: {
    flex: 1,
  },
  aiPreviewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiPreviewType: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  aiPreviewTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  aiPreviewPlatform: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  aiPreviewContent: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  aiStrategyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  aiStrategyText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  aiResultActions: {
    flexDirection: 'row',
    gap: 12,
  },
  aiAddAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  aiAddAllText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  aiStartOverBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  aiStartOverText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  aiErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  aiErrorText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
});
