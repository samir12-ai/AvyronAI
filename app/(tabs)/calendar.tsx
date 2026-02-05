import React, { useState, useMemo } from 'react';
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
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { CalendarDay } from '@/components/CalendarDay';
import { ContentCard } from '@/components/ContentCard';
import { PlatformPicker } from '@/components/PlatformPicker';
import { generateId } from '@/lib/storage';
import type { ScheduledPost } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

const postTypes = [
  { id: 'post', label: 'Post', icon: 'document-text-outline' as const },
  { id: 'reel', label: 'Reel', icon: 'videocam-outline' as const },
  { id: 'story', label: 'Story', icon: 'layers-outline' as const },
  { id: 'video', label: 'Video', icon: 'play-circle-outline' as const },
];

const timeSlots = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'
];

export default function CalendarScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { contentItems, removeContentItem, scheduledPosts, addScheduledPost, removeScheduledPost, mediaItems } = useApp();

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(today.getDate());
  const [currentMonth] = useState(today.getMonth());
  const [currentYear] = useState(today.getFullYear());
  const [showModal, setShowModal] = useState(false);

  const [postType, setPostType] = useState<string>('post');
  const [postContent, setPostContent] = useState('');
  const [postTime, setPostTime] = useState('09:00');
  const [postPlatform, setPostPlatform] = useState<string[]>(['Instagram']);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push({ date: 0, key: `empty-${i}` });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: i, key: `day-${i}` });
    }
    return days;
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
    return dates;
  }, [contentItems, scheduledPosts, currentMonth, currentYear]);

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
      Alert.alert('Missing Content', 'Please enter content for your post.');
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
    Alert.alert('Scheduled!', `Your ${postType} is scheduled for ${MONTHS[currentMonth]} ${selectedDate} at ${postTime}`);
  };

  const handleDeleteScheduled = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await removeScheduledPost(id);
  };

  const getPostTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'reel': return 'videocam';
      case 'story': return 'layers';
      case 'video': return 'play-circle';
      default: return 'document-text';
    }
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
            <Text style={[styles.title, { color: colors.text }]}>Content Calendar</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Schedule posts, reels, and videos
            </Text>
          </View>
          <Pressable
            onPress={handleAddSchedule}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="add" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={[styles.calendarCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.monthHeader}>
            <Text style={[styles.monthTitle, { color: colors.text }]}>
              {MONTHS[currentMonth]} {currentYear}
            </Text>
          </View>

          <View style={styles.weekDays}>
            {DAYS.map(day => (
              <Text key={day} style={[styles.weekDay, { color: colors.textMuted }]}>
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
              {MONTHS[currentMonth]} {selectedDate}
            </Text>
            <Pressable
              onPress={handleAddSchedule}
              style={[styles.smallAddButton, { backgroundColor: colors.primary + '20' }]}
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text style={[styles.smallAddText, { color: colors.primary }]}>Add</Text>
            </Pressable>
          </View>

          {selectedScheduled.length > 0 ? (
            <View style={styles.scheduleList}>
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
                        {post.content || 'Video content'}
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
          ) : selectedContent.length > 0 ? (
            <View style={styles.contentList}>
              {selectedContent.map(item => (
                <ContentCard
                  key={item.id}
                  content={item}
                  onDelete={() => removeContentItem(item.id)}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No content scheduled for this day
              </Text>
              <Pressable
                onPress={handleAddSchedule}
                style={[styles.emptyButton, { backgroundColor: colors.primary + '20' }]}
              >
                <Ionicons name="add" size={16} color={colors.primary} />
                <Text style={[styles.emptyButtonText, { color: colors.primary }]}>Schedule Content</Text>
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
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Schedule for {MONTHS[currentMonth]} {selectedDate}
              </Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={[styles.inputLabel, { color: colors.text }]}>Content Type</Text>
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

              <Text style={[styles.inputLabel, { color: colors.text }]}>Platform</Text>
              <PlatformPicker selected={postPlatform} onChange={setPostPlatform} single />

              <Text style={[styles.inputLabel, { color: colors.text, marginTop: 16 }]}>Time</Text>
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
                  <Text style={[styles.inputLabel, { color: colors.text, marginTop: 16 }]}>Select Video from Studio</Text>
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
                {postType === 'video' ? 'Caption (optional)' : 'Content'}
              </Text>
              <TextInput
                style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder }]}
                placeholder={postType === 'video' ? 'Add a caption for your video...' : 'Enter your content...'}
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
                <Text style={styles.scheduleButtonText}>Schedule {postType.charAt(0).toUpperCase() + postType.slice(1)}</Text>
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
});
