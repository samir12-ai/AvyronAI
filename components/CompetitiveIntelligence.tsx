import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCreativeContext } from '@/context/CreativeContext';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';
import { normalizeEngineSnapshot } from '@/lib/engine-snapshot';

interface DataCoverage {
  postsCollected: number;
  commentsCollected: number;
  ctaCoverage: number;
  ctaTypes: string;
  followers: number | null;
  engagementRate: number | null;
  postingFrequency: number | null;
  contentMix: string | null;
  dataFreshnessDays: number;
  lastFetchAt: string | null;
  fetchStatus: string;
  fetchMethod: string | null;
}

interface Competitor {
  id: string;
  name: string;
  platform: string;
  profileLink: string;
  businessType: string;
  primaryObjective: string;
  postingFrequency: number | null;
  contentTypeRatio: string | null;
  engagementRatio: number | null;
  ctaPatterns: string | null;
  discountFrequency: string | null;
  hookStyles: string | null;
  messagingTone: string | null;
  socialProofPresence: string | null;
  screenshotUrls: string | null;
  notes: string | null;
  evidenceComplete: boolean;
  missingFields: string[];
  dataCoverage?: DataCoverage;
}



type CIView = 'overview' | 'competitors' | 'threats' | 'timeline';


export default function CompetitiveIntelligence() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const queryClient = useQueryClient();
  const baseUrl = getApiUrl();
  const router = useRouter();
  const { setCreativeContext } = useCreativeContext();
  const { brandProfile } = useApp();
  const { selectedCampaignId: activeCampaignId } = useCampaign();
  const [loadingReelsFor, setLoadingReelsFor] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<CIView>('overview');
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(null);
  const [addAndFetch, setAddAndFetch] = useState(false);
  const [miv3Result, setMiv3Result] = useState<any>(null);
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null);

  const emptyComp = {
    name: '', profileLink: '', businessType: '', primaryObjective: '',
    platform: 'instagram', postingFrequency: '', contentTypeRatio: '',
    engagementRatio: '', ctaPatterns: '', discountFrequency: '',
    hookStyles: '', messagingTone: '', socialProofPresence: '',
  };

  const [newComp, setNewComp] = useState(emptyComp);

  const { data: competitorsData, isLoading: loadingCompetitors } = useQuery({
    queryKey: ['ci-competitors', activeCampaignId],
    enabled: !!activeCampaignId,
    queryFn: async () => {
      const res = await fetch(new URL(`/api/ci/competitors?accountId=default&campaignId=${activeCampaignId}`, baseUrl).toString());
      return res.json();
    },
  });


  const { data: cachedSnapshot } = useQuery({
    queryKey: ['mi-v3-snapshot', activeCampaignId],
    enabled: !!activeCampaignId,
    refetchInterval: (query) => {
      const snap = query.state.data;
      if (snap?.dataStatus === 'ENRICHING') return 30000;
      return false;
    },
    queryFn: async () => {
      const res = await fetch(new URL(`/api/ci/mi-v3/snapshot/${activeCampaignId}?accountId=default`, baseUrl).toString());
      const data = await res.json();
      const normalized = normalizeEngineSnapshot(data, 'mi');
      if (normalized && data.output) return { ...data, snapshot: normalized.snapshot };
      if (data.snapshot && data.output) return data;
      return null;
    },
  });

  useEffect(() => {
    if (cachedSnapshot && cachedSnapshot.snapshot?.campaignId === activeCampaignId) {
      setMiv3Result(cachedSnapshot);
    }
  }, [cachedSnapshot, activeCampaignId]);

  useEffect(() => {
    setMiv3Result(null);
  }, [activeCampaignId]);

  const { data: timelineData } = useQuery({
    queryKey: ['ci-miv3-history', activeCampaignId],
    enabled: !!activeCampaignId,
    queryFn: async () => {
      const res = await fetch(new URL(`/api/ci/mi-v3/history/${activeCampaignId}?accountId=default`, baseUrl).toString());
      return res.json();
    },
  });

  const addCompetitorMutation = useMutation({
    mutationFn: async (comp: any) => {
      const res = await fetch(new URL('/api/ci/competitors', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...comp, accountId: 'default', campaignId: activeCampaignId }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['ci-competitors', activeCampaignId] });
      setShowAddCompetitor(false);
      setNewComp(emptyComp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (addAndFetch && data?.competitor?.id) {
        setAddAndFetch(false);
        setTimeout(() => {
          fetchDataMutation.mutate({ id: data.competitor.id });
        }, 500);
      }
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  const updateCompetitorMutation = useMutation({
    mutationFn: async ({ id, comp }: { id: string; comp: any }) => {
      const res = await fetch(new URL(`/api/ci/competitors/${id}`, baseUrl).toString(), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...comp, accountId: 'default', campaignId: activeCampaignId }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-competitors', activeCampaignId] });
      setShowAddCompetitor(false);
      setEditingCompetitorId(null);
      setNewComp(emptyComp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  const openEditModal = useCallback((comp: Competitor) => {
    setEditingCompetitorId(comp.id);
    setNewComp({
      name: comp.name || '',
      profileLink: comp.profileLink || '',
      businessType: comp.businessType || '',
      primaryObjective: comp.primaryObjective || '',
      platform: comp.platform || 'instagram',
      postingFrequency: comp.postingFrequency != null ? String(comp.postingFrequency) : '',
      contentTypeRatio: comp.contentTypeRatio || '',
      engagementRatio: comp.engagementRatio != null ? String(comp.engagementRatio) : '',
      ctaPatterns: comp.ctaPatterns || '',
      discountFrequency: comp.discountFrequency || '',
      hookStyles: comp.hookStyles || '',
      messagingTone: comp.messagingTone || '',
      socialProofPresence: comp.socialProofPresence || '',
    });
    setShowAddCompetitor(true);
  }, []);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(new URL('/api/ci/mi-v3/analyze', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', campaignId: activeCampaignId || 'default', mode: 'overview' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data: any) => {
      setMiv3Result(data);
      queryClient.invalidateQueries({ queryKey: ['ci-miv3-history', activeCampaignId] });
      queryClient.invalidateQueries({ queryKey: ['mi-v3-snapshot', activeCampaignId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Analysis Error', err.message),
  });


  const deleteCompetitorMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(new URL(`/api/ci/competitors/${id}?accountId=default&campaignId=${activeCampaignId}`, baseUrl).toString(), { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Delete failed'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-competitors', activeCampaignId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to remove competitor'),
  });

  const [isFetchingCampaign, setIsFetchingCampaign] = useState(false);

  const fetchDataMutation = useMutation({
    mutationFn: async () => {
      setIsFetchingCampaign(true);
      const res = await fetch(new URL(`/api/ci/mi-v3/fetch-job`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', campaignId: activeCampaignId }),
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) throw new Error(`DEDUP: ${err.error}`);
        throw new Error(err.error || 'Fetch failed');
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      setIsFetchingCampaign(false);
      queryClient.invalidateQueries({ queryKey: ['ci-competitors', activeCampaignId] });
      if (data.status === 'RUNNING' || data.status === 'QUEUED') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Collection Queued', `Data collection job ${data.status.toLowerCase()}. The system will collect data for all competitors using the Two-Speed pipeline (Fast Pass → Deep Pass).`);
      } else if (data.status === 'COMPLETED') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Data Ready', 'Collection complete. Refresh intelligence to see updated analysis.');
      }
    },
    onError: (err: any) => {
      setIsFetchingCampaign(false);
      if (err.message?.includes('already in progress') || err.message?.includes('DEDUP')) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert('Already Running', 'A data collection job is already active for this campaign.');
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Fetch Error', err.message);
      }
    },
  });

  const competitors: Competitor[] = competitorsData?.competitors || [];

  const handleCreateReelsFromCI = useCallback(async (comp: Competitor) => {
    setLoadingReelsFor(comp.id);
    try {
      const domData = miv3Result?.dominanceData || [];
      const compAnalysis = domData.find((d: any) => d.competitorName === comp.name || d.competitorId === comp.id);

      if (!compAnalysis) {
        Alert.alert('No Analysis Found', 'Run MI V3 analysis first to generate dominance data.');
        return;
      }

      const offer = brandProfile?.industry
        ? `${brandProfile.name || 'Our brand'} — ${brandProfile.industry}`
        : brandProfile?.name || '';
      const icp = brandProfile?.targetAudience || '';

      if (!offer || !icp) {
        Alert.alert('Missing Brand Info', 'Set your brand name/industry and target audience in Settings before generating scripts.');
        return;
      }

      setCreativeContext({
        source: 'CI',
        competitorId: comp.id,
        competitorName: comp.name,
        snapshotId: compAnalysis.id,
        snapshotCreatedAt: compAnalysis.createdAt || new Date().toISOString(),
        intelligence: {
          conversion_intelligence: compAnalysis.contentDissection?.conversion_intelligence || { conversion_style: 'none', cta_presence_score: 0 },
          narrative_intelligence: compAnalysis.contentDissection?.narrative_intelligence || {},
          performance_context: compAnalysis.contentDissection?.performance_context || { dominant_format: 'mixed', engagement_quality_score: 50 },
          storytelling_intelligence: compAnalysis.contentDissection?.storytelling_intelligence || { storytelling_present: false, narrative_strategy_mode: 'none' },
          dominance: compAnalysis.dominanceDelta || { dominance_state: 'NEUTRAL', dominance_score: 50 },
          archetype: compAnalysis.contentDissection?.archetype || { primary: 'unknown' },
        },
        onboarding_context: {
          location: 'Dubai, UAE',
          market_type: brandProfile?.industry || 'general',
          language: 'en',
          primary_objective: comp.primaryObjective || 'engagement',
        },
        blueprint_context: { offer, icp },
      });

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      router.push('/(tabs)/create');
    } catch (err: any) {
      console.error('[CI→Reels] Error:', err);
      Alert.alert('Error', 'Failed to load analysis data.');
    } finally {
      setLoadingReelsFor(null);
    }
  }, [baseUrl, brandProfile, setCreativeContext, router]);



  const renderSubTabs = () => (
    <View style={[s.subTabBar, { backgroundColor: isDark ? '#0A0E14' : '#F5F7FA', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
      {[
        { key: 'overview' as CIView, icon: 'eye-outline' as const, label: 'Overview' },
        { key: 'competitors' as CIView, icon: 'trophy-outline' as const, label: 'Dominance' },
        { key: 'threats' as CIView, icon: 'shield-outline' as const, label: 'Threats' },
        { key: 'timeline' as CIView, icon: 'time-outline' as const, label: 'History' },
      ].map(tab => (
        <Pressable
          key={tab.key}
          onPress={() => { Haptics.selectionAsync(); setActiveView(tab.key); }}
          style={[s.subTab, activeView === tab.key && { backgroundColor: '#8B5CF6' + '18' }]}
        >
          <Ionicons name={tab.icon} size={16} color={activeView === tab.key ? '#8B5CF6' : colors.textMuted} />
          <Text style={[s.subTabText, { color: activeView === tab.key ? '#8B5CF6' : colors.textMuted }]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const qualifiedCount = competitors.filter(c => (c.dataCoverage?.postsCollected || 0) >= 10).length;
  const hasInsufficientData = competitors.length > 0 && (competitors.length < 3 || qualifiedCount < 2);

  const renderCompetitorsList = () => (
    <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
      <View style={s.cardHeader}>
        <Ionicons name="people-outline" size={18} color="#8B5CF6" />
        <Text style={[s.cardTitle, { color: colors.text }]}>Competitors</Text>
        <View style={[s.countBadge, { backgroundColor: '#8B5CF6' + '20' }]}>
          <Text style={[s.countText, { color: '#8B5CF6' }]}>{competitors.length}</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setEditingCompetitorId(null); setNewComp(emptyComp); setShowAddCompetitor(true); }}
          style={[s.addBtn, { backgroundColor: '#8B5CF6' }]}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {hasInsufficientData && (
        <View style={{ backgroundColor: '#F59E0B' + '15', borderRadius: 8, padding: 10, marginBottom: 10, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Ionicons name="warning" size={16} color="#F59E0B" />
          <Text style={{ fontSize: 11, color: '#F59E0B', flex: 1, lineHeight: 16 }}>
            {competitors.length < 3
              ? `Low confidence due to insufficient competitor signals. Add at least ${3 - competitors.length} more competitor(s).`
              : `Low confidence: only ${qualifiedCount} of ${competitors.length} competitors have sufficient data. Fetch data for each competitor individually.`}
          </Text>
        </View>
      )}

      {competitors.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
          <Ionicons name="person-add-outline" size={32} color={colors.textMuted} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>No competitors added yet</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Add at least 3 competitors to start tracking their strategy</Text>
        </View>
      ) : (
        competitors.map((comp: Competitor) => {
          const dc = comp.dataCoverage;
          const isFetching = isFetchingCampaign;
          const anyFetchInProgress = isFetchingCampaign;
          return (
          <View key={comp.id} style={[s.breakdownItem, { borderBottomWidth: 1, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }]}>
            <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedCompetitor(expandedCompetitor === comp.id ? null : comp.id); }} style={s.compHeader}>
              <View style={s.compInfo}>
                <View style={s.compNameRow}>
                  <Text style={[s.compName, { color: colors.text }]}>{comp.name}</Text>
                  <View style={[s.evidenceDot, { backgroundColor: (dc?.postsCollected || 0) >= 10 ? '#10B981' : '#F59E0B' }]} />
                </View>
                <Text style={[s.compMeta, { color: colors.textMuted }]}>
                  {(dc?.postsCollected || 0) > 0
                    ? `${comp.platform} • ${comp.businessType || 'Unknown type'} • ${dc?.postsCollected || 0} posts`
                    : `${comp.platform} • ${comp.businessType || 'Unknown type'} • No data collected`}
                </Text>
              </View>
              <View style={s.compRight}>
                <Ionicons name={expandedCompetitor === comp.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
            </Pressable>

            {expandedCompetitor === comp.id && (
              <View style={s.compDetails}>
                <View style={{ backgroundColor: isDark ? '#1A2030' : '#F8F9FA', borderRadius: 8, padding: 10, gap: 6, marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', marginBottom: 2 }}>DATA COVERAGE</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>Posts collected</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: (dc?.postsCollected || 0) >= 14 ? '#10B981' : '#F97316' }}>{dc?.postsCollected || 0} / 14</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>Comments collected</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: (dc?.commentsCollected || 0) >= 50 ? '#10B981' : '#F97316' }}>{dc?.commentsCollected || 0} / 50</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>CTA coverage</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: (dc?.ctaCoverage || 0) >= 0.5 ? '#10B981' : colors.text }}>{Math.round((dc?.ctaCoverage || 0) * 100)}%</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>Data freshness</Text>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: (dc?.dataFreshnessDays || 999) <= 7 ? '#10B981' : '#F59E0B' }}>{dc?.lastFetchAt ? `${dc.dataFreshnessDays}d ago` : 'Never fetched'}</Text>
                  </View>
                  {dc?.followers != null && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>Followers</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }}>{dc.followers.toLocaleString()}</Text>
                    </View>
                  )}
                  {dc?.engagementRate != null && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>Engagement rate</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }}>{dc.engagementRate}%</Text>
                    </View>
                  )}
                  {dc?.ctaTypes ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>CTA types</Text>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }} numberOfLines={1}>{dc.ctaTypes}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); fetchDataMutation.mutate(); }}
                    disabled={anyFetchInProgress || fetchDataMutation.isPending}
                    style={[s.fetchBtn, { flex: 1, opacity: (anyFetchInProgress || fetchDataMutation.isPending) ? 0.6 : 1 }]}
                  >
                    {isFetching ? (
                      <ActivityIndicator size={12} color="#fff" />
                    ) : (
                      <Ionicons name="cloud-download-outline" size={14} color="#fff" />
                    )}
                    <Text style={s.fetchBtnText}>{isFetching ? 'Collecting...' : (dc?.postsCollected || 0) > 0 ? 'Refresh All Data' : 'Collect All Data'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); openEditModal(comp); }}
                    style={s.editBtn}
                  >
                    <Ionicons name="create-outline" size={14} color="#8B5CF6" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS === 'web') {
                        if (window.confirm(`Remove ${comp.name}?`)) {
                          deleteCompetitorMutation.mutate(comp.id);
                        }
                      } else {
                        Alert.alert('Remove Competitor', `Remove ${comp.name}?`, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => deleteCompetitorMutation.mutate(comp.id) }]);
                      }
                    }}
                    style={s.removeBtn}
                  >
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                  </Pressable>
                </View>

                {comp.profileLink && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Profile</Text>
                    <Text style={[s.detailValue, { color: colors.text }]} numberOfLines={1}>{comp.profileLink}</Text>
                  </View>
                )}
                {comp.businessType && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Type</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.businessType}</Text>
                  </View>
                )}
                {comp.postingFrequency != null && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Frequency</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.postingFrequency}</Text>
                  </View>
                )}
                {comp.engagementRatio != null && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Engagement</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.engagementRatio}</Text>
                  </View>
                )}
                {comp.ctaPatterns && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>CTA</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.ctaPatterns}</Text>
                  </View>
                )}
                {comp.hookStyles && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Hooks</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.hookStyles}</Text>
                  </View>
                )}
                {comp.messagingTone && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Tone</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.messagingTone}</Text>
                  </View>
                )}
                {comp.contentTypeRatio && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Content Mix</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.contentTypeRatio}</Text>
                  </View>
                )}
                {comp.notes && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Notes</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.notes}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          );
        })
      )}
    </View>
  );

  const buildInsightCards = useCallback(() => {
    if (!miv3Result) return { reality: [], weaknesses: [], opportunities: [] };
    const domData = miv3Result?.dominanceData || [];
    const output = miv3Result?.output;
    const confidence = output?.confidence;
    const intentMap = output?.competitorIntentMap || [];
    const missingSignals = output?.missingSignalFlags || [];
    const trajectory = miv3Result?.trajectoryData;

    const reality: { text: string; source: string }[] = [];
    const weaknesses: { text: string; source: string }[] = [];
    const opportunities: { text: string; source: string }[] = [];

    const dominantCompetitors = domData.filter((d: any) => d.dominanceLevel === 'DOMINANT' || d.dominanceLevel === 'STRUCTURALLY_STRONG');
    const weakCompetitors = domData.filter((d: any) => d.dominanceLevel === 'WEAK' || d.dominanceLevel === 'EXPOSED');

    if (dominantCompetitors.length > 0) {
      reality.push({ text: `${dominantCompetitors.length} competitor(s) hold dominant or structurally strong positions`, source: 'dominance_score' });
    }
    if (output?.marketState) {
      reality.push({ text: `Market state: ${output.marketState.replace(/_/g, ' ')}`, source: 'trajectory_engine' });
    }
    if (output?.dominantIntentType) {
      reality.push({ text: `Dominant market intent: ${output.dominantIntentType.replace(/_/g, ' ')}`, source: 'intent_engine' });
    }
    if (confidence) {
      reality.push({ text: `Analysis confidence: ${confidence.level} (${Math.round((confidence.overall || 0) * 100)}%)`, source: 'confidence_engine' });
    }
    if (trajectory?.marketHeatingIndex > 0.6) {
      reality.push({ text: `Market heating index elevated at ${Math.round(trajectory.marketHeatingIndex * 100)}%`, source: 'trajectory_index' });
    }

    domData.forEach((dom: any) => {
      if (dom.weaknesses?.length > 0) {
        dom.weaknesses.forEach((w: string) => {
          weaknesses.push({ text: `${dom.competitorName}: ${w}`, source: 'dominance_analysis' });
        });
      }
      if (dom.engagementWeightBiasRisk) {
        weaknesses.push({ text: `${dom.competitorName}: ${dom.engagementWeightBiasRisk}`, source: 'engagement_bias_detector' });
      }
    });

    if (missingSignals.length > 0) {
      weaknesses.push({ text: `${missingSignals.length} signal gap(s) detected in data coverage`, source: 'signal_guard' });
    }

    if (weakCompetitors.length > 0) {
      opportunities.push({ text: `${weakCompetitors.length} competitor(s) show weak or exposed positioning`, source: 'dominance_score' });
    }
    if (trajectory?.revivalPotential > 0.5) {
      opportunities.push({ text: `Revival potential detected (${Math.round(trajectory.revivalPotential * 100)}%) — declining competitors may leave gaps`, source: 'trajectory_revival' });
    }
    if (trajectory?.angleSaturationLevel < 0.4) {
      opportunities.push({ text: `Low angle saturation (${Math.round(trajectory.angleSaturationLevel * 100)}%) — content differentiation space available`, source: 'trajectory_saturation' });
    }
    if (trajectory?.offerCompressionIndex < 0.3) {
      opportunities.push({ text: `Low offer compression — room for premium positioning`, source: 'trajectory_offer' });
    }

    const aggressiveIntents = intentMap.filter((im: any) => im.intentCategory === 'AGGRESSIVE_SCALING' || im.intentCategory === 'PRICE_WAR');
    if (aggressiveIntents.length > 0) {
      reality.push({ text: `${aggressiveIntents.length} competitor(s) in aggressive or price war stance`, source: 'intent_engine' });
    }

    const decliningIntents = intentMap.filter((im: any) => im.intentCategory === 'DECLINING');
    if (decliningIntents.length > 0) {
      opportunities.push({ text: `${decliningIntents.length} competitor(s) showing declining intent — potential market share capture`, source: 'intent_engine' });
    }

    return { reality, weaknesses, opportunities };
  }, [miv3Result]);

  const renderInsightCards = () => {
    if (!miv3Result) return null;
    const { reality, weaknesses, opportunities } = buildInsightCards();
    const confLevel = miv3Result?.output?.confidence?.level || 'UNKNOWN';
    const confColor = confLevel === 'STRONG' || confLevel === 'MODERATE' ? '#10B981' : confLevel === 'LOW' ? '#F59E0B' : '#EF4444';

    const cards = [
      { title: 'Market Reality', icon: 'eye-outline' as const, color: '#3B82F6', items: reality },
      { title: 'Identified Weaknesses', icon: 'alert-circle-outline' as const, color: '#EF4444', items: weaknesses },
      { title: 'Detected Opportunities', icon: 'bulb-outline' as const, color: '#10B981', items: opportunities },
    ];

    return (
      <View style={{ gap: 10, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Ionicons name="layers-outline" size={16} color="#8B5CF6" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Intelligence Cards</Text>
          <View style={[s.countBadge, { backgroundColor: confColor + '20' }]}>
            <Text style={[s.countText, { color: confColor }]}>{confLevel}</Text>
          </View>
        </View>
        {cards.map((card) => (
          <View key={card.title} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4', borderLeftWidth: 3, borderLeftColor: card.color }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Ionicons name={card.icon} size={16} color={card.color} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: card.color }}>{card.title}</Text>
            </View>
            {card.items.length === 0 ? (
              <Text style={{ fontSize: 11, color: colors.textMuted, fontStyle: 'italic' }}>No evidence detected</Text>
            ) : (
              card.items.map((item, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 6, marginBottom: 5, alignItems: 'flex-start' }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: card.color, marginTop: 5 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 16 }}>{item.text}</Text>
                    <Text style={{ fontSize: 8, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 1 }}>{item.source}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderSimilarityCard = () => {
    const simData = miv3Result?.similarityData || miv3Result?.output?.similarityData;
    if (!miv3Result || !simData) return null;

    const diagnosisColor = simData.diagnosis === 'LOW_SIMILARITY' ? '#10B981'
      : simData.diagnosis === 'SIMILARITY_LIKELY_MARKET_REALITY' ? '#3B82F6'
      : simData.diagnosis === 'SIMILARITY_LIKELY_DATA_LIMITATION' ? '#F59E0B'
      : '#9CA3AF';

    const diagnosisLabel = simData.diagnosis === 'LOW_SIMILARITY' ? 'Low Similarity'
      : simData.diagnosis === 'SIMILARITY_LIKELY_MARKET_REALITY' ? 'Market Reality'
      : simData.diagnosis === 'SIMILARITY_LIKELY_DATA_LIMITATION' ? 'Data Limitation'
      : 'Insufficient Data';

    return (
      <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4', marginBottom: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Ionicons name="git-compare-outline" size={16} color="#8B5CF6" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 }}>Similarity Diagnosis</Text>
          <View style={[s.threatBadge, { backgroundColor: diagnosisColor + '20' }]}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: diagnosisColor }}>{diagnosisLabel}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>Overall Similarity</Text>
          <View style={[s.qualityBar, { flex: 1, marginVertical: 0 }]}>
            <View style={[s.qualityFill, { width: `${Math.round(simData.overallSimilarityIndex * 100)}%`, backgroundColor: diagnosisColor }]} />
          </View>
          <Text style={{ fontSize: 11, fontWeight: '700', color: diagnosisColor }}>{Math.round(simData.overallSimilarityIndex * 100)}%</Text>
        </View>
        {simData.dimensions && Object.entries(simData.dimensions).map(([key, dim]: [string, any]) => (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Text style={{ fontSize: 10, color: colors.textMuted, width: 85 }}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
            <View style={[s.qualityBar, { flex: 1, marginVertical: 0, height: 4 }]}>
              <View style={[s.qualityFill, { width: `${Math.round(dim.score * 100)}%`, backgroundColor: dim.sufficient ? '#3B82F6' : '#9CA3AF' }]} />
            </View>
            <Text style={{ fontSize: 9, fontWeight: '600', color: dim.sufficient ? '#3B82F6' : '#9CA3AF' }}>{Math.round(dim.score * 100)}%</Text>
          </View>
        ))}
        {simData.explanation && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 6, lineHeight: 15, fontStyle: 'italic' }}>{simData.explanation}</Text>
        )}
      </View>
    );
  };

  const renderGoalModeCard = () => {
    if (!miv3Result) return null;
    const goalMode = miv3Result?.goalMode || miv3Result?.output?.goalMode || 'STRATEGY_MODE';
    const modeColor = goalMode === 'REACH_MODE' ? '#3B82F6' : '#8B5CF6';
    const modeLabel = goalMode === 'REACH_MODE' ? 'Reach Mode' : 'Strategy Mode';
    const modeDesc = goalMode === 'REACH_MODE'
      ? 'Engagement and visibility signals weighted higher. Best for brand awareness campaigns.'
      : 'CTA, innovation, and strategic signals weighted equally. Best for conversion-focused campaigns.';

    return (
      <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4', marginBottom: 10 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Ionicons name="options-outline" size={16} color={modeColor} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 }}>Analysis Mode</Text>
          <View style={[s.threatBadge, { backgroundColor: modeColor + '20' }]}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: modeColor }}>{modeLabel}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 11, color: colors.textMuted, lineHeight: 16 }}>{modeDesc}</Text>
      </View>
    );
  };

  const renderOverview = () => {
    if (!miv3Result) {
      return (
        <View>
          {renderCompetitorsList()}
          {competitors.length > 0 ? (
            <View style={s.actionRow}>
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); analyzeMutation.mutate(); }}
                disabled={analyzeMutation.isPending}
                style={[s.analyzeBtn, { opacity: analyzeMutation.isPending ? 0.6 : 1 }]}
              >
                {analyzeMutation.isPending ? (
                  <ActivityIndicator size={16} color="#fff" />
                ) : (
                  <Ionicons name="analytics" size={18} color="#fff" />
                )}
                <Text style={s.analyzeBtnText}>{analyzeMutation.isPending ? 'Running MI V3...' : 'Run MI V3 Analysis'}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="telescope-outline" size={48} color={colors.textMuted} />
              <Text style={[s.emptyTitle, { color: colors.text }]}>No MI V3 Analysis Yet</Text>
              <Text style={[s.emptyDesc, { color: colors.textMuted }]}>
                Add competitors above, then run your first MI V3 analysis.
              </Text>
            </View>
          )}
        </View>
      );
    }

    const dataStatus = miv3Result?.dataStatus || miv3Result?.snapshot?.dataStatus || 'COMPLETE';
    const dataStatusColor = dataStatus === 'LIVE' ? '#3B82F6' : dataStatus === 'ENRICHING' ? '#F59E0B' : '#10B981';
    const dataStatusLabel = dataStatus === 'LIVE' ? 'LIVE' : dataStatus === 'ENRICHING' ? 'ENRICHING' : 'COMPLETE';

    const evCoverage = miv3Result?.output?.evidenceCoverage;
    const coveragePct = evCoverage ? Math.round((evCoverage.competitorsWithSufficientData / Math.max(evCoverage.totalCompetitors, 1)) * 100) : 0;

    const confScore = miv3Result?.output?.confidence?.overall != null ? Math.round(miv3Result.output.confidence.overall * 100) : 0;
    const confLevel = miv3Result?.output?.confidence?.level || 'UNKNOWN';
    const confColor = confLevel === 'STRONG' ? '#10B981' : confLevel === 'MODERATE' ? '#3B82F6' : confLevel === 'LOW' ? '#F59E0B' : '#EF4444';

    const snapshotCreatedAt = miv3Result?.snapshot?.createdAt || miv3Result?.timestamp;
    const updatedAgo = snapshotCreatedAt ? (() => {
      const diffMs = Date.now() - new Date(snapshotCreatedAt).getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    })() : null;

    const marketActivity = miv3Result?.output?.marketActivityLevel ?? miv3Result?.trajectoryData?.marketActivityLevel;
    const demandConf = miv3Result?.output?.demandConfidence ?? miv3Result?.trajectoryData?.demandConfidence;
    const intentSignals: string[] = miv3Result?.output?.audienceIntentSignals || [];

    return (
      <View>
        {renderCompetitorsList()}
        {miv3Result && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#8B5CF6" />
              <Text style={[s.cardTitle, { color: colors.text }]}>MI V3</Text>
              <View style={[s.intensityBadge, { backgroundColor: dataStatusColor + '20' }]}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: dataStatusColor }}>{dataStatusLabel}</Text>
              </View>
              {dataStatus === 'ENRICHING' && (
                <ActivityIndicator size={12} color={dataStatusColor} />
              )}
              {miv3Result.snapshotStatus === 'PARTIAL' && (
                <View style={[s.intensityBadge, { backgroundColor: '#EF444420' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#EF4444' }}>PARTIAL</Text>
                </View>
              )}
              <View style={[s.intensityBadge, { backgroundColor: miv3Result.executionMode === 'FULL' ? '#10B981' + '20' : miv3Result.executionMode === 'REDUCED' ? '#F59E0B' + '20' : '#6B7280' + '20' }]}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: miv3Result.executionMode === 'FULL' ? '#10B981' : miv3Result.executionMode === 'REDUCED' ? '#F59E0B' : '#6B7280' }}>
                  {miv3Result.executionMode}
                </Text>
              </View>
            </View>

            <View style={{ backgroundColor: isDark ? '#1A2030' : '#F8F9FA', borderRadius: 10, padding: 12, marginBottom: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted }}>Evidence Coverage</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: coveragePct >= 70 ? '#10B981' : coveragePct >= 40 ? '#F59E0B' : '#EF4444' }}>{coveragePct}%</Text>
              </View>
              <View style={[s.qualityBar, { marginVertical: 0, height: 5 }]}>
                <View style={[s.qualityFill, { width: `${coveragePct}%`, backgroundColor: coveragePct >= 70 ? '#10B981' : coveragePct >= 40 ? '#F59E0B' : '#EF4444' }]} />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted }}>Confidence</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: confColor }}>{confScore} / 100</Text>
              </View>
              <View style={[s.qualityBar, { marginVertical: 0, height: 5 }]}>
                <View style={[s.qualityFill, { width: `${confScore}%`, backgroundColor: confColor }]} />
              </View>

              {updatedAgo && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>Updated {updatedAgo}</Text>
                </View>
              )}
            </View>

            {(marketActivity != null || demandConf != null) && (
              <View style={{ backgroundColor: isDark ? '#1A2030' : '#F8F9FA', borderRadius: 10, padding: 12, marginBottom: 10, gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', marginBottom: 2 }}>MARKET SIGNALS</Text>
                {marketActivity != null && (
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>Market Activity (posting freq.)</Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#3B82F6' }}>{Math.round(marketActivity * 100)}%</Text>
                    </View>
                    <View style={[s.qualityBar, { marginVertical: 0, height: 4 }]}>
                      <View style={[s.qualityFill, { width: `${Math.round(marketActivity * 100)}%`, backgroundColor: '#3B82F6' }]} />
                    </View>
                  </View>
                )}
                {demandConf != null && (
                  <View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>Market Demand (intent quality)</Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#10B981' }}>{Math.round(demandConf * 100)}%</Text>
                    </View>
                    <View style={[s.qualityBar, { marginVertical: 0, height: 4 }]}>
                      <View style={[s.qualityFill, { width: `${Math.round(demandConf * 100)}%`, backgroundColor: '#10B981' }]} />
                    </View>
                  </View>
                )}
              </View>
            )}

            {intentSignals.length > 0 && (
              <View style={{ backgroundColor: isDark ? '#1A2030' : '#F8F9FA', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', marginBottom: 6 }}>AUDIENCE INTENT SIGNALS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {intentSignals.map((sig: string, idx: number) => (
                    <View key={idx} style={{ backgroundColor: '#8B5CF6' + '15', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '600', color: '#8B5CF6' }}>{sig.replace(/_/g, ' ')}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {miv3Result.cacheInvalidationReason === 'ENGINE_UPGRADE' && (
              <View style={{ backgroundColor: '#3B82F615', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#3B82F6' }}>Analysis refreshed due to engine upgrade.</Text>
              </View>
            )}
            {miv3Result.snapshotStatus === 'PARTIAL' && (
              <View style={{ backgroundColor: '#EF444415', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444' }}>Partial analysis — some analytical fields may be incomplete. Results should not be interpreted as final strategy.</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Market State</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{miv3Result.output?.marketState || 'N/A'}</Text>
              </View>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Trajectory</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{miv3Result.output?.trajectoryDirection || 'N/A'}</Text>
              </View>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Confidence</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: (miv3Result.output?.confidence?.level === 'STRONG' || miv3Result.output?.confidence?.level === 'MODERATE') ? '#10B981' : miv3Result.output?.confidence?.level === 'LOW' ? '#F59E0B' : '#EF4444' }}>
                  {miv3Result.output?.confidence?.level || 'N/A'} ({Math.round((miv3Result.output?.confidence?.overall || 0) * 100)}%)
                </Text>
              </View>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Dominant Intent</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{miv3Result.output?.dominantIntentType || 'N/A'}</Text>
              </View>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Volatility</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{((miv3Result.output?.volatilityIndex || 0) * 100).toFixed(0)}%</Text>
              </View>
              <View style={[s.miv3Stat, { backgroundColor: isDark ? '#1A2030' : '#F8F9FA' }]}>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>Freshness</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{miv3Result.output?.dataFreshnessDays || 0}d</Text>
              </View>
            </View>

            {miv3Result.output?.confidence?.guardDecision && miv3Result.output.confidence.guardDecision !== 'PROCEED' && (
              <View style={{ backgroundColor: miv3Result.output.confidence.guardDecision === 'BLOCK' ? '#EF4444' + '15' : '#F59E0B' + '15', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: miv3Result.output.confidence.guardDecision === 'BLOCK' ? '#EF4444' : '#F59E0B' }}>
                  {miv3Result.output.confidence.guardDecision === 'BLOCK' ? 'BLOCKED' : 'EXPLORATORY MODE'}
                </Text>
                {(miv3Result.output.confidence.guardReasons || []).map((reason: string, i: number) => (
                  <Text key={i} style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>• {reason}</Text>
                ))}
              </View>
            )}

            {miv3Result.output?.marketDiagnosis && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#8B5CF6', marginBottom: 2 }}>Market Diagnosis</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary }}>{miv3Result.output.marketDiagnosis}</Text>
              </View>
            )}

            {miv3Result.output?.threatSignals?.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444', marginBottom: 2 }}>Threat Signals</Text>
                {miv3Result.output.threatSignals.map((threat: string, i: number) => (
                  <Text key={i} style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>• {threat}</Text>
                ))}
              </View>
            )}

            {miv3Result.output?.missingSignalFlags?.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#F59E0B', marginBottom: 2 }}>Missing Signals</Text>
                {miv3Result.output.missingSignalFlags.slice(0, 5).map((flag: string, i: number) => (
                  <Text key={i} style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>• {flag}</Text>
                ))}
                {miv3Result.output.missingSignalFlags.length > 5 && (
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>...and {miv3Result.output.missingSignalFlags.length - 5} more</Text>
                )}
              </View>
            )}

            {!miv3Result.twoRunStatus?.isConfirmed && (
              <View style={{ backgroundColor: '#3B82F6' + '15', borderRadius: 6, padding: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#3B82F6' }}>
                  Two-Run Confirmation: {miv3Result.twoRunStatus?.confirmedRuns || 0}/2 runs completed
                </Text>
                <Text style={{ fontSize: 9, color: colors.textMuted }}>
                  Direction verdict requires 2 independent runs for confirmation
                </Text>
              </View>
            )}

            <View style={{ paddingTop: 4 }}>
              <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                snapshot: {miv3Result.snapshotId?.slice(0, 8)} | cached: {miv3Result.cached ? 'yes' : 'no'} | competitors: {miv3Result.telemetry?.competitorsCount || 0}
              </Text>
            </View>
          </View>
        )}

        {miv3Result?.dominanceData?.length > 0 && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="trophy-outline" size={18} color="#F59E0B" />
              <Text style={[s.cardTitle, { color: colors.text }]}>Dominance Analysis</Text>
            </View>
            {miv3Result.dominanceData.map((dom: any, i: number) => (
              <View key={i} style={[s.breakdownItem, i < miv3Result.dominanceData.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }]}>
                <View style={s.breakdownHeader}>
                  <Text style={[s.breakdownName, { color: colors.text }]}>{dom.competitorName}</Text>
                  <View style={[s.threatBadge, { backgroundColor: dom.dominanceLevel === 'DOMINANT' ? '#EF4444' + '20' : dom.dominanceLevel === 'STRUCTURALLY_STRONG' ? '#F59E0B' + '20' : '#10B981' + '20' }]}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: dom.dominanceLevel === 'DOMINANT' ? '#EF4444' : dom.dominanceLevel === 'STRUCTURALLY_STRONG' ? '#F59E0B' : '#10B981' }}>
                      {dom.dominanceLevel} ({dom.dominanceScore})
                    </Text>
                  </View>
                </View>
                {dom.strengths?.length > 0 && (
                  <View style={{ marginTop: 4 }}>
                    {dom.strengths.map((s2: string, j: number) => (
                      <Text key={j} style={{ fontSize: 10, color: '#10B981' }}>+ {s2}</Text>
                    ))}
                  </View>
                )}
                {dom.weaknesses?.length > 0 && (
                  <View style={{ marginTop: 2 }}>
                    {dom.weaknesses.map((w: string, j: number) => (
                      <Text key={j} style={{ fontSize: 10, color: '#EF4444' }}>- {w}</Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {miv3Result?.deltaReport && miv3Result.deltaReport.hasMeaningfulChanges && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="git-compare-outline" size={18} color="#3B82F6" />
              <Text style={[s.cardTitle, { color: colors.text }]}>What Changed</Text>
              <View style={[s.intensityBadge, { backgroundColor: '#3B82F6' + '20' }]}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: '#3B82F6' }}>DELTA</Text>
              </View>
            </View>

            {miv3Result.deltaReport.intentChanges?.filter((c: any) => c.changed).length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#F59E0B', marginBottom: 4 }}>Intent Changes</Text>
                {miv3Result.deltaReport.intentChanges.filter((c: any) => c.changed).map((c: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }}>{c.competitorName}</Text>
                    <Text style={{ fontSize: 10, color: '#EF4444' }}>{c.previousIntent?.replace(/_/g, ' ')}</Text>
                    <Ionicons name="arrow-forward" size={10} color={colors.textMuted} />
                    <Text style={{ fontSize: 10, color: '#10B981' }}>{c.currentIntent?.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            )}

            {miv3Result.deltaReport.dominanceChanges?.filter((c: any) => c.levelChanged || Math.abs(c.scoreDelta) >= 1).length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#8B5CF6', marginBottom: 4 }}>Dominance Shifts</Text>
                {miv3Result.deltaReport.dominanceChanges.filter((c: any) => c.levelChanged || Math.abs(c.scoreDelta) >= 1).map((c: any, i: number) => (
                  <View key={i} style={{ marginBottom: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.text }}>{c.competitorName}</Text>
                      <Text style={{ fontSize: 10, color: c.scoreDelta > 0 ? '#EF4444' : '#10B981', fontWeight: '700' }}>
                        {c.scoreDelta > 0 ? '+' : ''}{c.scoreDelta.toFixed(0)}
                      </Text>
                    </View>
                    {c.levelChanged && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <Text style={{ fontSize: 9, color: colors.textMuted }}>{c.previousLevel}</Text>
                        <Ionicons name="arrow-forward" size={8} color={colors.textMuted} />
                        <Text style={{ fontSize: 9, color: colors.textMuted }}>{c.currentLevel}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}

            {miv3Result.deltaReport.trajectoryDeltas?.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#3B82F6', marginBottom: 4 }}>Trajectory Shifts</Text>
                {miv3Result.deltaReport.trajectoryDeltas.map((t: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>{t.field.replace(/([A-Z])/g, ' $1').trim()}</Text>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: t.delta > 0 ? '#EF4444' : '#10B981' }}>
                      {t.delta > 0 ? '+' : ''}{(t.delta * 100).toFixed(0)}%
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {miv3Result.deltaReport.signalDeltas?.length > 0 && (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#6B7280', marginBottom: 4 }}>Signal Changes ({miv3Result.deltaReport.signalDeltas.length})</Text>
                {miv3Result.deltaReport.signalDeltas.slice(0, 6).map((sd: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={{ fontSize: 9, color: colors.textMuted, flex: 1 }}>{sd.competitorName} — {sd.signalField}</Text>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: sd.delta > 0 ? '#EF4444' : '#10B981' }}>
                      {sd.delta > 0 ? '+' : ''}{sd.delta.toFixed(3)}
                    </Text>
                  </View>
                ))}
                {miv3Result.deltaReport.signalDeltas.length > 6 && (
                  <Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 2 }}>...and {miv3Result.deltaReport.signalDeltas.length - 6} more</Text>
                )}
              </View>
            )}
          </View>
        )}

        {miv3Result?.contentDnaData && miv3Result.contentDnaData.length > 0 && (
          <View style={[s.card, { backgroundColor: colors.card, marginBottom: 12 }]}>  
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 }}>Content DNA</Text>
            {miv3Result.contentDnaData.map((dna: any, idx: number) => (
              <View key={dna.competitorId || idx} style={{ marginBottom: idx < miv3Result.contentDnaData.length - 1 ? 10 : 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text, flex: 1 }}>{dna.competitorName}</Text>
                  <View style={{ backgroundColor: dna.dnaConfidence > 0.7 ? '#22C55E' : dna.dnaConfidence > 0.4 ? '#F59E0B' : '#EF4444', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff' }}>{Math.round(dna.dnaConfidence * 100)}%</Text>
                  </View>
                </View>
                {dna.hookArchetypes?.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#6B7280', width: '100%' }}>Hooks</Text>
                    {dna.hookArchetypes.map((h: string, i: number) => (
                      <View key={i} style={{ backgroundColor: '#EFF6FF', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: '#3B82F6', fontWeight: '600' }}>{h}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {dna.narrativeFrameworks?.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#6B7280', width: '100%' }}>Narrative</Text>
                    {dna.narrativeFrameworks.map((n: string, i: number) => (
                      <View key={i} style={{ backgroundColor: '#F0FDF4', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: '#22C55E', fontWeight: '600' }}>{n.replace(/_/g, ' → ')}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {dna.ctaFrameworks?.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#6B7280', width: '100%' }}>CTA Style</Text>
                    {dna.ctaFrameworks.map((c: string, i: number) => (
                      <View key={i} style={{ backgroundColor: '#FEF3C7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, color: '#D97706', fontWeight: '600' }}>{c}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {dna.missingSignalFlags?.length > 0 && (
                  <Text style={{ fontSize: 9, color: '#EF4444', fontStyle: 'italic', marginTop: 2 }}>
                    {dna.missingSignalFlags[0]}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {renderInsightCards()}
        {renderSimilarityCard()}
        {renderGoalModeCard()}

        <View style={s.actionRow}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); analyzeMutation.mutate(); }}
            style={[s.analyzeBtn, { opacity: analyzeMutation.isPending ? 0.6 : 1 }]}
            disabled={analyzeMutation.isPending}
          >
            {analyzeMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> :
              <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={s.analyzeBtnText}>Run MI V3</Text></>
            }
          </Pressable>
        </View>
      </View>
    );
  };

  const renderCompetitors = () => {
    const domData = miv3Result?.dominanceData || [];
    const intentMap = miv3Result?.output?.competitorIntentMap || [];

    return (
      <View>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>MI V3 Dominance</Text>
          {miv3Result && (
            <View style={[s.countBadge, { backgroundColor: '#F59E0B' + '20' }]}>
              <Text style={[s.countText, { color: '#F59E0B' }]}>{domData.length} competitors</Text>
            </View>
          )}
        </View>

        {!miv3Result ? (
          <View style={s.emptyState}>
            <Ionicons name="trophy-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No Dominance Data</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Run MI V3 from the Overview tab to generate dominance scores</Text>
          </View>
        ) : domData.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="analytics-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No Competitors in Snapshot</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Add competitors and run analysis to see dominance rankings</Text>
          </View>
        ) : domData.map((dom: any, i: number) => {
          const intent = intentMap.find((im: any) => im.competitorId === dom.competitorId);
          const domColor = dom.dominanceLevel === 'DOMINANT' ? '#EF4444' : dom.dominanceLevel === 'STRUCTURALLY_STRONG' ? '#F59E0B' : dom.dominanceLevel === 'EFFICIENT' ? '#3B82F6' : '#10B981';

          return (
            <View key={dom.competitorId || i} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
              <View style={s.breakdownHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.breakdownName, { color: colors.text }]}>{dom.competitorName}</Text>
                  {intent && (
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Intent: {intent.intentCategory}{intent.degraded ? ' (degraded)' : ''}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={[s.threatBadge, { backgroundColor: domColor + '20' }]}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: domColor }}>{dom.dominanceLevel}</Text>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: domColor, marginTop: 4 }}>{dom.dominanceScore}</Text>
                </View>
              </View>

              {dom.strengths?.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#10B981', marginBottom: 2 }}>Strengths</Text>
                  {dom.strengths.map((str: string, j: number) => (
                    <Text key={j} style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>+ {str}</Text>
                  ))}
                </View>
              )}

              {dom.weaknesses?.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#EF4444', marginBottom: 2 }}>Weaknesses</Text>
                  {dom.weaknesses.map((w: string, j: number) => {
                    const signalMap: Record<string, string> = {
                      'Declining posting frequency': 'postingFrequencyTrend < -0.2 — fewer posts over time',
                      'Unstable engagement': 'engagementVolatility > 0.6 — inconsistent audience response',
                      'Weakening CTA presence': 'ctaIntensityShift < -0.1 — reduced calls to action',
                      'Frequent offer changes (instability)': 'offerLanguageChange > 0.3 — shifting pricing/value messaging',
                      'High hashtag drift (unclear positioning)': 'hashtagDriftScore > 0.6 — repositioning or unfocused strategy',
                      'Declining audience sentiment': 'sentimentDrift < -0.1 — audience becoming more negative',
                      'Low content innovation': 'contentExperimentRate < 0.1 — stagnant content approach',
                    };
                    const explanation = signalMap[w];
                    return (
                      <View key={j} style={{ marginTop: 3 }}>
                        <Text style={{ fontSize: 10, color: colors.textMuted }}>- {w}</Text>
                        {explanation && (
                          <Text style={{ fontSize: 8, color: '#EF4444', marginLeft: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 1 }}>{explanation}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {dom.engagementWeightBiasRisk && (
                <View style={{ marginTop: 6, backgroundColor: '#F59E0B' + '10', borderRadius: 6, padding: 6 }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: '#F59E0B' }}>Engagement Bias Risk</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>{dom.engagementWeightBiasRisk}</Text>
                </View>
              )}

              {intent && (
                <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: isDark ? '#1A2030' : '#F0F0F0' }}>
                  <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                    intent_score: {intent.intentScore?.toFixed(3)} | source: miv3_snapshot
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        {miv3Result && (
          <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
            <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
              source: miv3_snapshot:{miv3Result.snapshotId?.slice(0, 8)} | cached: {miv3Result.cached ? 'yes' : 'no'} | snapshotSource: {miv3Result.snapshotSource || 'N/A'} | fetchExecuted: {miv3Result.fetchExecuted === false ? 'no' : 'yes'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const getIndexInterpretation = (label: string, value: number): string => {
    const pct = Math.round(value * 100);
    switch (label) {
      case 'Market Heating':
        return pct > 60 ? 'Competitive posting activity is above baseline levels across tracked accounts.'
          : pct < 20 ? 'Posting activity is below typical category density.'
          : 'Posting activity is within normal competitive range.';
      case 'Narrative Convergence':
        return pct > 50 ? 'Majority of analyzed competitors are using similar messaging themes.'
          : 'Messaging patterns remain structurally varied across competitors.';
      case 'Offer Compression':
        return pct > 40 ? 'Offer language and pricing signals are converging across competitors.'
          : 'Offers remain structurally differentiated across competitors.';
      case 'Angle Saturation':
        return pct > 40 ? 'Majority of analyzed hooks repeat similar creative angles.'
          : 'Creative angle diversity remains present in the competitive set.';
      case 'Revival Potential':
        return pct > 60 ? 'Previously dormant competitors show signals of returning to active posting.'
          : 'No significant dormant competitor re-entry signals detected.';
      default:
        return '';
    }
  };

  const renderThreats = () => {
    const output = miv3Result?.output;
    const marketDiagnosis = output?.marketDiagnosis;
    const threatSignals = output?.threatSignals || [];
    const opportunitySignals = output?.opportunitySignals || [];
    const missingSignals = output?.missingSignalFlags || [];
    const confidence = output?.confidence;
    const intentMap = output?.competitorIntentMap || [];
    const trajectory = miv3Result?.trajectoryData;
    const evidenceCoverage = output?.evidenceCoverage;
    const contentDna = miv3Result?.contentDnaData || [];

    const getDnaForCompetitor = (competitorId: string) => contentDna.find((d: any) => d.competitorId === competitorId);

    const formatDnaList = (items: string[]) => items.length > 0 ? items.map((s: string) => s.replace(/_/g, ' ')).join(', ') : 'Not detected';

    return (
      <View>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>Threat Signals</Text>
          {confidence && (
            <View style={[s.countBadge, { backgroundColor: confidence.guardDecision === 'PROCEED' ? '#10B981' + '20' : confidence.guardDecision === 'DOWNGRADE' ? '#F59E0B' + '20' : '#EF4444' + '20' }]}>
              <Text style={[s.countText, { color: confidence.guardDecision === 'PROCEED' ? '#10B981' : confidence.guardDecision === 'DOWNGRADE' ? '#F59E0B' : '#EF4444' }]}>
                {confidence.guardDecision}
              </Text>
            </View>
          )}
        </View>

        {!miv3Result ? (
          <View style={s.emptyState}>
            <Ionicons name="shield-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No Threat Data</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Run MI V3 from the Overview tab to detect market threats</Text>
          </View>
        ) : (
          <View>
            <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
              <View style={s.cardHeader}>
                <Ionicons name="shield-outline" size={18} color="#EF4444" />
                <Text style={[s.cardTitle, { color: colors.text }]}>Observed Threat Signals</Text>
                {threatSignals.length > 0 && (
                  <View style={[s.countBadge, { backgroundColor: '#EF4444' + '20', marginLeft: 8 }]}>
                    <Text style={[s.countText, { color: '#EF4444' }]}>{threatSignals.length}</Text>
                  </View>
                )}
              </View>
              {threatSignals.length > 0 ? (
                threatSignals.map((threat: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'flex-start' }}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" style={{ marginTop: 2 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1, lineHeight: 18 }}>{threat}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ fontSize: 12, color: colors.textMuted }}>No structural threat signals detected in current data window.</Text>
              )}
            </View>

            <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
              <View style={s.cardHeader}>
                <Ionicons name="leaf-outline" size={18} color="#10B981" />
                <Text style={[s.cardTitle, { color: colors.text }]}>Opportunity Signals</Text>
                {opportunitySignals.length > 0 && (
                  <View style={[s.countBadge, { backgroundColor: '#10B981' + '20', marginLeft: 8 }]}>
                    <Text style={[s.countText, { color: '#10B981' }]}>{opportunitySignals.length}</Text>
                  </View>
                )}
              </View>
              {opportunitySignals.length > 0 ? (
                opportunitySignals.map((opp: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'flex-start' }}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" style={{ marginTop: 2 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1, lineHeight: 18 }}>{opp}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ fontSize: 12, color: colors.textMuted }}>No opportunity signals detected in current data window.</Text>
              )}
            </View>

            {marketDiagnosis && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="pulse-outline" size={18} color="#8B5CF6" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Market Diagnosis</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>{marketDiagnosis}</Text>
              </View>
            )}

            {evidenceCoverage && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="analytics-outline" size={18} color="#3B82F6" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Evidence Coverage</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{evidenceCoverage.postsAnalyzed}</Text>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>Posts</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{evidenceCoverage.commentsAnalyzed}</Text>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>Comments</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{evidenceCoverage.competitorsWithSufficientData}/{evidenceCoverage.totalCompetitors}</Text>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>Sufficient Data</Text>
                  </View>
                  {output?.signalNoiseRatio !== undefined && (
                    <View>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{(output.signalNoiseRatio * 100).toFixed(0)}%</Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted }}>Signal Quality</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {intentMap.length > 0 && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="git-branch-outline" size={18} color="#3B82F6" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Competitor Intent Map</Text>
                </View>
                {intentMap.map((intent: any, i: number) => {
                  const intentColor = intent.intentCategory === 'AGGRESSIVE_SCALING' || intent.intentCategory === 'PRICE_WAR' ? '#EF4444' : intent.intentCategory === 'DEFENSIVE' ? '#F59E0B' : intent.intentCategory === 'TESTING' || intent.intentCategory === 'POSITIONING_SHIFT' ? '#3B82F6' : '#10B981';
                  const dna = getDnaForCompetitor(intent.competitorId);
                  return (
                    <View key={i} style={{ paddingVertical: 8, borderBottomWidth: i < intentMap.length - 1 ? 1 : 0, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{intent.competitorName}</Text>
                        <View style={[s.threatBadge, { backgroundColor: intentColor + '20' }]}>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: intentColor }}>{intent.intentCategory?.replace(/_/g, ' ')}</Text>
                        </View>
                      </View>
                      {intent.degraded && <Text style={{ fontSize: 10, color: '#F59E0B', marginTop: 2 }}>Degraded: {intent.degradeReason}</Text>}
                      {dna && (
                        <View style={{ marginTop: 4, gap: 2 }}>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>
                            <Text style={{ fontWeight: '600' }}>Narrative: </Text>{formatDnaList(dna.narrativeFrameworks || [])}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>
                            <Text style={{ fontWeight: '600' }}>Hook Style: </Text>{formatDnaList(dna.hookArchetypes || [])}
                          </Text>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>
                            <Text style={{ fontWeight: '600' }}>CTA Pattern: </Text>{formatDnaList(dna.ctaFrameworks || [])}
                          </Text>
                        </View>
                      )}
                      {!dna && (
                        <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2, fontStyle: 'italic' }}>Content DNA not available — insufficient post data</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {trajectory && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="trending-up-outline" size={18} color="#8B5CF6" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Market Trajectory Indices</Text>
                </View>
                {[
                  { label: 'Market Heating', value: trajectory.marketHeatingIndex, color: '#EF4444' },
                  { label: 'Narrative Convergence', value: trajectory.narrativeConvergenceScore, color: '#F59E0B' },
                  { label: 'Offer Compression', value: trajectory.offerCompressionIndex, color: '#3B82F6' },
                  { label: 'Angle Saturation', value: trajectory.angleSaturationLevel, color: '#8B5CF6' },
                  { label: 'Revival Potential', value: trajectory.revivalPotential, color: '#10B981' },
                ].map((idx, i) => (
                  <View key={i} style={{ marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>{idx.label}</Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: idx.color }}>{((idx.value || 0) * 100).toFixed(0)}%</Text>
                    </View>
                    <View style={[s.qualityBar]}>
                      <View style={[s.qualityFill, { width: `${(idx.value || 0) * 100}%`, backgroundColor: idx.color }]} />
                    </View>
                    <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                      → {getIndexInterpretation(idx.label, idx.value || 0)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {missingSignals.length > 0 && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="help-circle-outline" size={18} color="#F59E0B" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Missing Signals</Text>
                </View>
                {missingSignals.slice(0, 8).map((flag: string, i: number) => (
                  <Text key={i} style={{ fontSize: 11, color: colors.textMuted, marginBottom: 3 }}>• {flag}</Text>
                ))}
                {missingSignals.length > 8 && (
                  <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>...and {missingSignals.length - 8} more</Text>
                )}
              </View>
            )}

            <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
              <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                source: miv3_snapshot:{miv3Result?.snapshotId?.slice(0, 8)} | guard: {confidence?.guardDecision} | mode: {miv3Result?.executionMode} | dataSource: {miv3Result?.snapshotSource || 'N/A'} | fetched: {miv3Result?.fetchExecuted === false ? 'no' : 'yes'}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderTimeline = () => {
    const history = timelineData?.history || [];
    return (
      <View>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>MI V3 History</Text>
          {history.length > 0 && (
            <View style={[s.countBadge, { backgroundColor: '#8B5CF6' + '20' }]}>
              <Text style={[s.countText, { color: '#8B5CF6' }]}>{history.length} snapshots</Text>
            </View>
          )}
        </View>
        {history.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="time-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No MI V3 History</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Run MI V3 from the Overview tab to create your first snapshot</Text>
          </View>
        ) : history.map((entry: any, i: number) => {
          const confColor = entry.confidenceLevel === 'STRONG' || entry.confidenceLevel === 'MODERATE' ? '#10B981' : entry.confidenceLevel === 'LOW' ? '#F59E0B' : '#EF4444';
          const modeColor = entry.executionMode === 'FULL' ? '#10B981' : entry.executionMode === 'REDUCED' ? '#F59E0B' : '#6B7280';
          return (
            <View key={entry.id} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
              <View style={s.timelineHeader}>
                <View style={[s.timelineDot, { backgroundColor: confColor }]} />
                <Text style={[s.timelineMonth, { color: colors.text }]}>v{entry.version}</Text>
                <View style={[s.statusChip, { backgroundColor: confColor + '15' }]}>
                  <Text style={[s.statusChipText, { color: confColor }]}>{entry.confidenceLevel}</Text>
                </View>
                <View style={[s.statusChip, { backgroundColor: modeColor + '15', marginLeft: 4 }]}>
                  <Text style={[s.statusChipText, { color: modeColor }]}>{entry.executionMode}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>Market: <Text style={{ color: colors.text, fontWeight: '600' }}>{entry.marketState || 'N/A'}</Text></Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>Confidence: <Text style={{ color: confColor, fontWeight: '600' }}>{Math.round((entry.overallConfidence || 0) * 100)}%</Text></Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>Volatility: <Text style={{ color: colors.text, fontWeight: '600' }}>{((entry.volatilityIndex || 0) * 100).toFixed(0)}%</Text></Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>Freshness: <Text style={{ color: colors.text, fontWeight: '600' }}>{entry.dataFreshnessDays || 0}d</Text></Text>
              </View>
              <Text style={{ fontSize: 9, color: colors.textMuted, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                {entry.id?.slice(0, 8)} | {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  if (loadingCompetitors) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[s.loadingText, { color: colors.textMuted }]}>Loading intelligence data...</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      {renderSubTabs()}
      {activeView === 'overview' && renderOverview()}
      {activeView === 'competitors' && renderCompetitors()}
      {activeView === 'threats' && renderThreats()}
      {activeView === 'timeline' && renderTimeline()}

      <Modal visible={showAddCompetitor} animationType="slide" transparent onRequestClose={() => { setShowAddCompetitor(false); setEditingCompetitorId(null); setNewComp(emptyComp); }}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: isDark ? '#0F1419' : '#fff' }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>{editingCompetitorId ? 'Edit Competitor' : 'Add Competitor'}</Text>
              <Pressable onPress={() => { setShowAddCompetitor(false); setEditingCompetitorId(null); setNewComp(emptyComp); }}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
              {!editingCompetitorId && (
                <View style={[s.aiHintCard, { backgroundColor: '#10B981' + '10', borderColor: '#10B981' + '30' }]}>
                  <Ionicons name="cloud-download-outline" size={18} color="#10B981" />
                  <Text style={[s.aiHintText, { color: colors.textSecondary }]}>
                    Add the competitor, then use Auto-Fetch on their card to collect posts, comments, and signals automatically.
                  </Text>
                </View>
              )}
              {editingCompetitorId && (
                <View style={[s.aiHintCard, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
                  <Ionicons name="create-outline" size={18} color="#8B5CF6" />
                  <Text style={[s.aiHintText, { color: colors.textSecondary }]}>
                    Update competitor details to fix missing fields and improve analysis accuracy.
                  </Text>
                </View>
              )}

              <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Company Name *</Text>
              <TextInput
                style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                value={newComp.name}
                onChangeText={v => setNewComp(p => ({ ...p, name: v }))}
                placeholder="e.g. Socialeyez"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Profile URL *</Text>
              <TextInput
                style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                value={newComp.profileLink}
                onChangeText={v => setNewComp(p => ({ ...p, profileLink: v }))}
                placeholder="https://instagram.com/socialeyez"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="url"
              />

              <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Business Type *</Text>
              <TextInput
                style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                value={newComp.businessType}
                onChangeText={v => setNewComp(p => ({ ...p, businessType: v }))}
                placeholder="E-commerce, Agency, F&B, Service..."
                placeholderTextColor={colors.textMuted}
              />

              <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Primary Objective *</Text>
              <TextInput
                style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                value={newComp.primaryObjective}
                onChangeText={v => setNewComp(p => ({ ...p, primaryObjective: v }))}
                placeholder="Sales, Leads, Brand awareness..."
                placeholderTextColor={colors.textMuted}
              />

              {editingCompetitorId ? (
                <Pressable
                  onPress={() => {
                    if (!newComp.name || !newComp.profileLink || !newComp.businessType || !newComp.primaryObjective) {
                      Alert.alert('Required Fields', 'Name, Profile URL, Business Type, and Primary Objective are required');
                      return;
                    }
                    if (!editingCompetitorId) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    updateCompetitorMutation.mutate({ id: editingCompetitorId, comp: newComp });
                  }}
                  style={[s.autoAnalyzeBtn, { opacity: updateCompetitorMutation.isPending ? 0.7 : 1 }]}
                  disabled={updateCompetitorMutation.isPending}
                >
                  {updateCompetitorMutation.isPending ? (
                    <>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={s.autoAnalyzeBtnText}>Saving changes...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#fff" />
                      <Text style={s.autoAnalyzeBtnText}>Save Changes</Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={() => {
                      if (!newComp.name || !newComp.profileLink || !newComp.businessType || !newComp.primaryObjective) {
                        Alert.alert('Required Fields', 'Name, Profile URL, Business Type, and Primary Objective are required');
                        return;
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      setAddAndFetch(true);
                      addCompetitorMutation.mutate(newComp);
                    }}
                    style={[s.autoAnalyzeBtn, { opacity: addCompetitorMutation.isPending ? 0.7 : 1 }]}
                    disabled={addCompetitorMutation.isPending}
                  >
                    {addCompetitorMutation.isPending ? (
                      <>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={s.autoAnalyzeBtnText}>Adding competitor...</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="add-circle" size={18} color="#fff" />
                        <Text style={s.autoAnalyzeBtnText}>Add & Auto-Fetch Data</Text>
                      </>
                    )}
                  </Pressable>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }} />
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>or</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }} />
                  </View>

                  <Pressable
                    onPress={() => {
                      if (!newComp.name || !newComp.profileLink || !newComp.businessType || !newComp.primaryObjective) {
                        Alert.alert('Required Fields', 'Name, Profile URL, Business Type, and Primary Objective are required');
                        return;
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setAddAndFetch(false);
                      addCompetitorMutation.mutate(newComp);
                    }}
                    style={[s.submitBtn, { opacity: addCompetitorMutation.isPending ? 0.6 : 1 }]}
                    disabled={addCompetitorMutation.isPending}
                  >
                    {addCompetitorMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> :
                      <Text style={s.submitBtnText}>Add Only (Fetch Later)</Text>
                    }
                  </Pressable>
                </>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 0 },
  loadingWrap: { padding: 40, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13 },
  subTabBar: { flexDirection: 'row', borderRadius: 10, padding: 3, marginBottom: 12, borderWidth: 1 },
  subTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8 },
  subTabText: { fontSize: 12, fontWeight: '600' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  cardBody: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  intensityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  intensityLabel: { fontSize: 12 },
  intensityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  intensityText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  trendsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  trendChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  trendChipText: { fontSize: 11, fontWeight: '600' },
  qualityBar: { height: 6, borderRadius: 3, backgroundColor: '#E5E7EB', marginVertical: 8, overflow: 'hidden' },
  qualityFill: { height: '100%', borderRadius: 3 },
  qualityText: { fontSize: 11 },
  breakdownItem: { paddingVertical: 10 },
  breakdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  breakdownName: { fontSize: 14, fontWeight: '600' },
  breakdownInsight: { fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  threatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  threatText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  gapItem: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 10 },
  gapArea: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  gapDesc: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  gapOpRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gapOp: { fontSize: 12, fontWeight: '600', flex: 1 },
  insightRow: { marginBottom: 10 },
  insightLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  insightVal: { fontSize: 12, lineHeight: 18 },
  actionRow: { alignItems: 'center', marginTop: 8 },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#8B5CF6', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  analyzeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardAnalyzeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  cardAnalyzeBtnText: { fontSize: 12, fontWeight: '600', color: '#8B5CF6' },
  emptyAnalyzeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#8B5CF6', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 16 },
  emptyAnalyzeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  compHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compInfo: { flex: 1 },
  compNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compName: { fontSize: 14, fontWeight: '700' },
  compMeta: { fontSize: 11, marginTop: 2 },
  compRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  evidenceDot: { width: 8, height: 8, borderRadius: 4 },
  missingBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 8 },
  missingText: { fontSize: 11, flex: 1 },
  compDetails: { marginTop: 12, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  detailLabel: { fontSize: 11, fontWeight: '600', width: 80 },
  detailValue: { fontSize: 11, flex: 1 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#8B5CF6' + '15', borderRadius: 8 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#EF4444' + '15', borderRadius: 8 },
  removeBtnText: { fontSize: 12, fontWeight: '600' },
  fetchBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: '#8B5CF6', borderRadius: 8, paddingVertical: 8 },
  fetchBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' as const },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countText: { fontSize: 11, fontWeight: '700' },
  recHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  catDot: { width: 4, height: 24, borderRadius: 2, marginTop: 2 },
  recTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  recTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  recMeta: { flexDirection: 'row', gap: 6, marginTop: 4 },
  catChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  catChipText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusChipText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  metersRow: { flexDirection: 'row', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1A2030' + '40' },
  meter: { flex: 1, alignItems: 'center', gap: 3 },
  meterLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },
  meterBar: { width: '100%', height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 2 },
  meterVal: { fontSize: 11, fontWeight: '700' },
  riskDot: { width: 8, height: 8, borderRadius: 4 },
  recExpanded: { marginTop: 12, gap: 10 },
  recDesc: { fontSize: 12, lineHeight: 20 },
  actionMapCard: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#8B5CF6' + '25', backgroundColor: '#8B5CF6' + '06' },
  actionMapHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  actionMapTitle: { fontSize: 12, fontWeight: '700' },
  actionMapTarget: { fontSize: 11, marginBottom: 4 },
  actionMapDetail: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  actionMapImpl: { fontSize: 11, lineHeight: 17 },
  citationsSection: { gap: 6 },
  citationsTitle: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  citationTag: { padding: 8, borderRadius: 6, borderWidth: 1, gap: 2 },
  citationName: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  citationValue: { fontSize: 11, fontWeight: '600' },
  citationInsight: { fontSize: 11, fontStyle: 'italic' },
  timeframeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeframeText: { fontSize: 11 },
  decisionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  applyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#10B981', paddingVertical: 10, borderRadius: 8 },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  rejectBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  rejectBtnText: { fontSize: 13, fontWeight: '600' },
  emptyState: { alignItems: 'center', padding: 30, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptyDesc: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  timelineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  timelineMonth: { fontSize: 15, fontWeight: '700', flex: 1 },
  timelineDetail: { fontSize: 12, marginTop: 4, marginLeft: 18 },
  timelineDecisions: { marginTop: 6, marginLeft: 18, gap: 4 },
  timelineDecisionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timelineDecisionText: { fontSize: 12 },
  diffCard: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 6, marginTop: 8, marginLeft: 18 },
  diffText: { fontSize: 11, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%', padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalScroll: {},
  fieldLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4, marginTop: 8, letterSpacing: 0.3 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  sectionDivider: { borderTopWidth: 1, marginTop: 16, paddingTop: 12, marginBottom: 4 },
  sectionDividerText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  submitBtn: { backgroundColor: '#8B5CF6', alignItems: 'center', paddingVertical: 14, borderRadius: 10, marginTop: 16 },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aiHintCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  aiHintText: { fontSize: 13, lineHeight: 19, flex: 1 },
  autoAnalyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#8B5CF6', paddingVertical: 14, borderRadius: 10, marginTop: 16 },
  autoAnalyzeBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  confirmModal: { margin: 20, borderRadius: 16, padding: 24, alignItems: 'center' },
  confirmIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#8B5CF6' + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  confirmDesc: { fontSize: 14, textAlign: 'center', marginBottom: 4 },
  confirmWarn: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  confirmBtns: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  confirmCancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1 },
  confirmCancelText: { fontSize: 14, fontWeight: '600' },
  confirmApply: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 8, backgroundColor: '#10B981' },
  confirmApplyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  miv3Stat: { borderRadius: 8, padding: 8, minWidth: 100, flex: 1 },
});
