import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useWatchtowerEventDetail } from '@/hooks/useWatchtowerEventDetail';
import { formatWatchtowerDate } from '@/utils/watchtower-date-formatter';

interface Props {
  campaignId: string | null;
  eventId: string | null;
  onClose: () => void;
}

export default function WatchtowerEventDetail({ campaignId, eventId, onClose }: Props) {
  const router = useRouter();
  const { data: detailData, isLoading, isError, error } = useWatchtowerEventDetail(campaignId, eventId);

  if (!eventId) return null;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.skeletonTitle} />
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={24} color="#9CA3AF" />
            </Pressable>
          </View>
          <View style={styles.skeletonBody} />
        </View>
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </View>
    );
  }

  if (isError || !detailData) {
    const is404 = error?.message === 'EVENT_NOT_FOUND';
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Event Unavailable</Text>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={24} color="#9CA3AF" />
            </Pressable>
          </View>
        </View>
        <View style={styles.errorCenter}>
          <Feather name="alert-triangle" size={48} color="#9CA3AF" style={{ marginBottom: 16 }} />
          <Text style={styles.errorText}>
            {is404 
              ? 'This market observation is no longer available.' 
              : 'Event details could not be loaded.'}
          </Text>
        </View>
      </View>
    );
  }

  const { event, presentation, observation, competitors, lineage, strategicBrief } = detailData;

  const getImpactColor = (impact: string) => {
    const i = (impact || '').toLowerCase();
    if (i.includes('high') || i.includes('major')) return '#DC2626';
    if (i.includes('medium')) return '#F59E0B';
    if (i.includes('low') || i.includes('mild')) return '#3B82F6';
    return '#7C3AED';
  };

  const getStatusColor = (status: string) => {
    const s = (status || '').toLowerCase();
    if (s.includes('confirmed')) return '#10B981';
    if (s.includes('first') || s.includes('candidate') || s.includes('review')) return '#3B82F6';
    if (s.includes('archived') || s.includes('dismissed') || s.includes('closed') || s.includes('superseded')) return '#6B7280'; 
    return '#8B5CF6'; 
  };
  
  const impactColor = getImpactColor(presentation.impactLabel);
  const statusBadgeColor = getStatusColor(presentation.statusLabel);
  const evidenceNotes = observation.evidenceNotes || [];
  const isCandidate = event.status === 'candidate';
  const brief = strategicBrief?.brief;

  return (
    <View style={styles.container}>
      {/* HEADER SECTION */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title} numberOfLines={2}>{presentation.title}</Text>
          <View style={styles.headerRight}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: impactColor + '25', borderColor: impactColor + '40' }]}>
                <Text style={[styles.badgeText, { color: impactColor }]}>
                  {presentation.impactLabel.toUpperCase()}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: statusBadgeColor + '25', borderColor: statusBadgeColor + '40' }]}>
                <Text style={[styles.badgeText, { color: statusBadgeColor, textTransform: 'uppercase' }]}>
                  {presentation.statusLabel === 'First Observation' ? 'UNDER REVIEW' : presentation.statusLabel}
                </Text>
              </View>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Feather name="x" size={24} color="#9CA3AF" />
            </Pressable>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Detected</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{formatWatchtowerDate(event.detectedAt)}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>First Observed</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{formatWatchtowerDate(event.firstObservedAt)}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Confirmed</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {event.confirmedAt ? formatWatchtowerDate(event.confirmedAt) : 'Awaiting 2nd fetch'}
            </Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Category</Text>
            <Text style={styles.metaValue} numberOfLines={1}>{presentation.category}</Text>
          </View>
        </View>
      </View>

      {/* SCROLLABLE CONTENT */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={true}>
        
        {/* REASONING DETAIL LINK BANNER */}
        <Pressable
          style={{
            backgroundColor: '#8B5CF618',
            borderColor: '#8B5CF660',
            borderWidth: 1.5,
            borderRadius: 12,
            padding: 18,
            marginBottom: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer' as any,
          }}
          onPress={() => router.push(`/(tabs)/reasoning-evidence?tab=events&eventId=${eventId}` as any)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <Feather name="cpu" size={20} color="#8B5CF6" />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#E0E7FF', marginBottom: 4 }}>View Full Market Intelligence in Reasoning</Text>
              <Text style={{ fontSize: 12, color: '#A5B4FC' }}>Complete analysis including what changed, strategic interpretation, impact assessment, and adaptive recommendations</Text>
            </View>
          </View>
          <Feather name="arrow-right" size={20} color="#8B5CF6" />
        </Pressable>

        {/* UNDER REVIEW PROVISIONAL NOTICE */}
        {isCandidate && (
          <View style={styles.provisionalNotice}>
            <Feather name="info" size={18} color="#3B82F6" style={{ marginTop: 2 }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.provisionalNoticeTitle}>Under Review (First Observation)</Text>
              <Text style={styles.provisionalNoticeText}>
                This strategic observation is awaiting its scheduled second independent confirmation fetch. Strategic interpretation is provisional until confirmed.
              </Text>
            </View>
          </View>
        )}

        {/* CONFIRMATION LIFECYCLE */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionBlockHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#10B98120' }]}>
              <Feather name="git-commit" size={16} color="#10B981" />
            </View>
            <Text style={styles.sectionBlockTitle}>Confirmation Lifecycle</Text>
          </View>
          <View style={styles.timelineList}>
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: '#6B7280' }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>Signal Detected</Text>
                <Text style={styles.timelineTime}>{formatWatchtowerDate(event.detectedAt)}</Text>
              </View>
            </View>
            <View style={styles.timelineLine} />
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: '#3B82F6' }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>First Observation</Text>
                <Text style={styles.timelineTime}>{formatWatchtowerDate(event.firstObservedAt)}</Text>
              </View>
            </View>
            <View style={styles.timelineLine2} />
            <View style={styles.timelineItem}>
              <View style={[styles.timelineDot, { backgroundColor: event.confirmedAt ? '#10B981' : '#4B5563' }]} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>{event.confirmedAt ? 'Verified & Confirmed' : 'Awaiting Confirmation'}</Text>
                <Text style={styles.timelineTime}>
                  {event.confirmedAt ? formatWatchtowerDate(event.confirmedAt) : 'Pending next scheduled independent fetch'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* FOOTER */}
        <View style={{ marginTop: 24, alignItems: 'center', opacity: 0.6, marginBottom: 40 }}>
          <Text style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>
            Watchtower monitors market changes. Full analysis lives in Reasoning.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F131A',
    borderLeftWidth: 1,
    borderColor: '#1E2535',
  },
  header: {
    padding: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderColor: '#1E2535',
    backgroundColor: '#0F131A',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginRight: 24,
    letterSpacing: 0.3,
    lineHeight: 32,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  closeButton: {
    padding: 8,
    marginLeft: 16,
    borderRadius: 20,
    backgroundColor: '#1E2535',
  },
  metaGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  metaCol: {
    flex: 1,
    paddingHorizontal: 8,
  },
  metaDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#2A3347',
    marginHorizontal: 8,
  },
  metaLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 13,
    color: '#F9FAFB',
    fontWeight: '600',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 32,
    gap: 32,
  },
  provisionalNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1E3A8A25',
    borderColor: '#3B82F640',
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
  },
  provisionalNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#93C5FD',
    marginBottom: 4,
  },
  provisionalNoticeText: {
    fontSize: 13,
    color: '#BFDBFE',
    lineHeight: 20,
  },
  sectionBlock: {
  },
  sectionBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  sectionBlockTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
    letterSpacing: 0.3,
  },
  sectionBlockBody: {
    fontSize: 15,
    color: '#9CA3AF',
    lineHeight: 24,
    marginLeft: 52,
  },
  cardContainer: {
    marginLeft: 52,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 20,
  },
  cardBodyText: {
    fontSize: 14,
    color: '#D1D5DB',
    lineHeight: 22,
  },
  subCard: {
    backgroundColor: '#1C212B',
    padding: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  subCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  subCardBody: {
    fontSize: 14,
    color: '#F3F4F6',
    lineHeight: 20,
  },
  cardGrid: {
    marginLeft: 52,
    flexDirection: 'row',
    gap: 16,
  },
  gridCard: {
    flex: 1,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 16,
  },
  gridCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  gridCardValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F9FAFB',
    lineHeight: 20,
  },
  recommendationBox: {
    backgroundColor: '#10B98115',
    borderWidth: 1,
    borderColor: '#10B98130',
    borderRadius: 6,
    padding: 16,
  },
  recommendationText: {
    fontSize: 14,
    color: '#D1FAE5',
    lineHeight: 22,
    fontWeight: '500',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    marginRight: 10,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 20,
  },
  claimsList: {
    marginLeft: 52,
    gap: 12,
  },
  claimCard: {
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 16,
  },
  claimHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  claimIdText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EC4899',
  },
  claimBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  claimBodyText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 20,
  },
  evidenceList: {
    marginLeft: 52,
    gap: 12,
  },
  evidenceItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#161B22',
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  evidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#8B5CF6',
    marginTop: 8,
    marginRight: 12,
  },
  evidenceText: {
    flex: 1,
    fontSize: 14,
    color: '#D1D5DB',
    lineHeight: 20,
  },
  diffContainer: {
    marginLeft: 52,
    padding: 24,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
  },
  diffText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontStyle: 'italic',
  },
  lineageGrid: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  lineageCol: {
    flex: 1,
    backgroundColor: '#1C212B',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  lineageLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  lineageValue: {
    fontSize: 12,
    color: '#93C5FD',
    fontFamily: 'monospace',
  },
  timelineList: {
    marginLeft: 52,
    position: 'relative',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    marginRight: 16,
    zIndex: 2,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 4,
  },
  timelineTime: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  timelineLine: {
    position: 'absolute',
    left: 5,
    top: 16,
    height: 32,
    width: 2,
    backgroundColor: '#1E2535',
    zIndex: 1,
  },
  timelineLine2: {
    position: 'absolute',
    left: 5,
    top: 64,
    bottom: 24,
    width: 2,
    backgroundColor: '#1E2535',
    zIndex: 1,
  },
  skeletonTitle: {
    height: 32,
    width: '60%',
    backgroundColor: '#1E2535',
    borderRadius: 8,
  },
  skeletonBody: {
    height: 80,
    width: '100%',
    backgroundColor: '#1E2535',
    borderRadius: 8,
  },
  loadingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  }
});
