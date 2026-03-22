import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Platform,
  Pressable,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';

interface StudioItemDetail {
  id: string;
  campaignId: string | null;
  accountId: string;
  contentType: string;
  title: string | null;
  caption: string | null;
  creativeBrief: string | null;
  ctaCopy: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
  origin: string | null;
  engineName: string | null;
  analysisStatus: string | null;
  analysisError: string | null;
  hook: string | null;
  goal: string | null;
  keywords: string | null;
  contentAngle: string | null;
  suggestedCta: string | null;
  suggestedCaption: string | null;
  generationId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export default function StudioItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();

  const [item, setItem] = useState<StudioItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const fetchItem = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest('GET', `/api/studio/items/${id}`);
      const data = await res.json();
      setItem(data.item);
    } catch (err: any) {
      setError(err.message || 'Failed to load item');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  useEffect(() => {
    if (!item) return;
    if (item.analysisStatus === 'PENDING' || item.analysisStatus === 'RUNNING') {
      const timer = setInterval(async () => {
        try {
          const res = await apiRequest('GET', `/api/studio/items/${id}/analysis-status`);
          const data = await res.json();
          setItem(prev => prev ? { ...prev, ...data } : prev);
          if (data.analysisStatus !== 'PENDING' && data.analysisStatus !== 'RUNNING') {
            clearInterval(timer);
          }
        } catch {
        }
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [item?.analysisStatus, id]);

  const handleRetry = async () => {
    if (!id) return;
    setRetrying(true);
    try {
      await apiRequest('POST', `/api/studio/items/${id}/retry-analysis`, {  });
      setItem(prev => prev ? { ...prev, analysisStatus: 'PENDING', analysisError: null } : prev);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to retry analysis');
    } finally {
      setRetrying(false);
    }
  };

  const getTypeIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'VIDEO': case 'REEL': return 'videocam';
      case 'IMAGE': case 'CAROUSEL': return 'image';
      case 'POST': case 'STORY': return 'document-text';
      default: return 'document';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETE': return '#10B981';
      case 'RUNNING': case 'PENDING': return colors.primary;
      case 'FAILED': return '#EF4444';
      default: return colors.textMuted;
    }
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </>
    );
  }

  if (error || !item) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.text }]}>{error || 'Item not found'}</Text>
          <Pressable onPress={fetchItem} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const analysisFields = [
    { key: 'hook', label: 'Hook', icon: 'flash', color: '#EF4444', value: item.hook },
    { key: 'goal', label: 'Goal', icon: 'flag', color: '#3B82F6', value: item.goal },
    { key: 'contentAngle', label: 'Content Angle', icon: 'compass', color: '#8B5CF6', value: item.contentAngle },
    { key: 'suggestedCaption', label: 'Suggested Caption', icon: 'chatbubble-ellipses', color: colors.accent, value: item.suggestedCaption },
    { key: 'suggestedCta', label: 'Suggested CTA', icon: 'megaphone', color: '#10B981', value: item.suggestedCta },
    { key: 'keywords', label: 'Keywords', icon: 'pricetag', color: colors.textSecondary, value: item.keywords },
  ].filter(f => f.value);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {item.title || 'Studio Item'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {item.mediaUrl && (
            <View style={[styles.mediaPreview, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <Image
                source={{ uri: item.mediaUrl }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            </View>
          )}

          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.sectionRow}>
              <Ionicons name={getTypeIcon(item.contentType)} size={20} color={colors.primary} />
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Type</Text>
              <Text style={[styles.sectionValue, { color: colors.text }]}>{item.contentType}</Text>
            </View>
            <View style={styles.divider} />

            <View style={styles.sectionRow}>
              <Ionicons name="radio-button-on" size={20} color={getStatusColor(item.status)} />
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Status</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>{item.status}</Text>
              </View>
            </View>
            <View style={styles.divider} />

            {item.engineName && (
              <>
                <View style={styles.sectionRow}>
                  <Ionicons name="sparkles" size={20} color={colors.accent} />
                  <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Engine</Text>
                  <Text style={[styles.sectionValue, { color: colors.text }]}>{item.engineName}</Text>
                </View>
                <View style={styles.divider} />
              </>
            )}

            {item.origin && item.origin !== 'MANUAL' && (
              <>
                <View style={styles.sectionRow}>
                  <Ionicons name="layers" size={20} color={colors.textSecondary} />
                  <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Origin</Text>
                  <Text style={[styles.sectionValue, { color: colors.text }]}>{item.origin}</Text>
                </View>
                <View style={styles.divider} />
              </>
            )}

            <View style={styles.sectionRow}>
              <Ionicons name="time-outline" size={20} color={colors.textMuted} />
              <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Created</Text>
              <Text style={[styles.sectionValue, { color: colors.text }]}>
                {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
              </Text>
            </View>
          </View>

          {item.caption && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
                <Text style={[styles.fieldTitle, { color: colors.text }]}>Caption</Text>
              </View>
              <Text style={[styles.captionText, { color: colors.text }]}>{item.caption}</Text>
            </View>
          )}

          {item.ctaCopy && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Ionicons name="megaphone-outline" size={18} color="#10B981" />
                <Text style={[styles.fieldTitle, { color: colors.text }]}>CTA</Text>
              </View>
              <Text style={[styles.captionText, { color: colors.text }]}>{item.ctaCopy}</Text>
            </View>
          )}

          {item.analysisStatus && item.analysisStatus !== 'NONE' && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name="analytics" size={18} color={colors.primary} />
                <Text style={[styles.fieldTitle, { color: colors.text }]}>AI Analysis</Text>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.analysisStatus) + '20', marginLeft: 'auto' }]}>
                  {(item.analysisStatus === 'PENDING' || item.analysisStatus === 'RUNNING') && (
                    <ActivityIndicator size={10} color={colors.primary} style={{ marginRight: 4 }} />
                  )}
                  <Text style={[styles.statusText, { color: getStatusColor(item.analysisStatus) }]}>
                    {item.analysisStatus}
                  </Text>
                </View>
              </View>

              {item.analysisStatus === 'FAILED' && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: '#EF4444', fontSize: 13, marginBottom: 8 }}>
                    {item.analysisError || 'Unknown error'}
                  </Text>
                  <Pressable
                    onPress={handleRetry}
                    disabled={retrying}
                    style={[styles.retrySmall, { backgroundColor: '#EF444415' }]}
                  >
                    {retrying ? (
                      <ActivityIndicator size={14} color="#EF4444" />
                    ) : (
                      <Ionicons name="refresh" size={14} color="#EF4444" />
                    )}
                    <Text style={{ color: '#EF4444', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Retry Analysis</Text>
                  </Pressable>
                </View>
              )}

              {analysisFields.map(f => (
                <View key={f.key} style={styles.analysisField}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Ionicons name={f.icon as any} size={14} color={f.color} />
                    <Text style={{ color: f.color, fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                      {f.label}
                    </Text>
                  </View>
                  <Text style={[styles.analysisValue, { color: colors.text }]}>{f.value}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: Platform.OS === 'web' ? 34 : insets.bottom + 20 }} />
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  mediaPreview: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  mediaImage: {
    width: '100%',
    aspectRatio: 1,
  },
  section: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    width: 72,
  },
  sectionValue: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    flex: 1,
    textAlign: 'right',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(128,128,128,0.1)',
    marginVertical: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase' as const,
  },
  fieldTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  captionText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  analysisField: {
    marginBottom: 12,
  },
  analysisValue: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
    paddingLeft: 20,
  },
  retrySmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
