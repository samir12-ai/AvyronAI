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
}



type CIView = 'overview' | 'competitors' | 'recommendations' | 'timeline';


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
  const [addStep, setAddStep] = useState<'input' | 'review'>('input');
  const [viralInsights, setViralInsights] = useState('');
  const [showManualFields, setShowManualFields] = useState(false);
  const [ccExpanded, setCcExpanded] = useState(false);
  const [ccReelExpanded, setCcReelExpanded] = useState<Record<number, boolean>>({});
  const [profileAnalysis, setProfileAnalysis] = useState<any>(null);
  const [miv3Result, setMiv3Result] = useState<any>(null);

  const [newComp, setNewComp] = useState({
    name: '', profileLink: '', businessType: '', primaryObjective: '',
    platform: 'instagram', postingFrequency: '', contentTypeRatio: '',
    engagementRatio: '', ctaPatterns: '', discountFrequency: '',
    hookStyles: '', messagingTone: '', socialProofPresence: '',
  });

  const { data: competitorsData, isLoading: loadingCompetitors } = useQuery({
    queryKey: ['ci-competitors'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/competitors?accountId=default', baseUrl).toString());
      return res.json();
    },
  });


  const { data: cachedSnapshot } = useQuery({
    queryKey: ['mi-v3-snapshot', activeCampaignId],
    enabled: !!activeCampaignId,
    queryFn: async () => {
      const res = await fetch(new URL(`/api/ci/mi-v3/snapshot/${activeCampaignId}?accountId=default`, baseUrl).toString());
      const data = await res.json();
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
        body: JSON.stringify({ ...comp, accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-competitors'] });
      setShowAddCompetitor(false);
      setAddStep('input');
      setViralInsights('');
      setShowManualFields(false);
      setProfileAnalysis(null);
      setNewComp({ name: '', profileLink: '', businessType: '', primaryObjective: '', platform: 'instagram', postingFrequency: '', contentTypeRatio: '', engagementRatio: '', ctaPatterns: '', discountFrequency: '', hookStyles: '', messagingTone: '', socialProofPresence: '' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  const autoAnalyzeMutation = useMutation({
    mutationFn: async ({ name, profileLink }: { name: string; profileLink: string }) => {
      const res = await fetch(new URL('/api/ci/competitors/analyze-profile', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, profileLink }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data) => {
      setProfileAnalysis(data);
      const m = data.measured;
      const mix = m?.content_mix;
      const mixStr = mix ? `Reels ${Math.round(mix.reels_ratio * 100)}% / Static ${Math.round(mix.static_ratio * 100)}%` : '';
      const ctaInsights = data.inferred?.insights?.filter((ins: any) => ins.category === 'cta_pattern') || [];
      const ctaStr = ctaInsights.length > 0 ? ctaInsights.map((ins: any) => ins.finding).join('; ') : '';
      const ccCtaSignals: string[] = [];
      if (data.creativeCapture?.length > 0) {
        for (const cc of data.creativeCapture) {
          if (cc.interpreted?.ctaSignals?.length > 0) {
            for (const sig of cc.interpreted.ctaSignals) {
              if (sig.text && !ccCtaSignals.includes(sig.text)) ccCtaSignals.push(sig.text);
            }
          }
        }
      }
      const ccCtaStr = ccCtaSignals.length > 0 ? ccCtaSignals.join(', ') : '';
      const combinedCta = [ctaStr, ccCtaStr].filter(Boolean).join('; ');
      const hookInsights = data.inferred?.insights?.filter((ins: any) => ins.category === 'hook_style') || [];
      const hookStr = hookInsights.length > 0 ? hookInsights.map((ins: any) => ins.finding).join('; ') : '';
      const toneInsights = data.inferred?.insights?.filter((ins: any) => ins.category === 'messaging_tone') || [];
      const toneStr = toneInsights.length > 0 ? toneInsights.map((ins: any) => ins.finding).join('; ') : '';
      const proofInsights = data.inferred?.insights?.filter((ins: any) => ins.category === 'social_proof') || [];
      const proofStr = proofInsights.length > 0 ? proofInsights.map((ins: any) => ins.finding).join('; ') : '';
      const hf = data.hydratedFields;
      const finalCta = hf?.ctaPatterns || combinedCta;
      const finalHooks = hf?.hookStyles || hookStr;
      const finalTone = hf?.messagingTone || toneStr;
      const finalProof = hf?.socialProofPresence || proofStr;
      const mappedCategories: string[] = [];
      if (finalCta) mappedCategories.push('cta_pattern');
      if (finalHooks) mappedCategories.push('hook_style');
      if (finalTone) mappedCategories.push('messaging_tone');
      if (finalProof) mappedCategories.push('social_proof');
      console.log('[CI Hydration] Mapped insight categories:', mappedCategories.join(', ') || 'none');
      setNewComp(p => ({
        ...p,
        postingFrequency: m?.avg_posts_per_week_28d?.value?.toString() || m?.posts_last_7d?.value?.toString() || p.postingFrequency,
        contentTypeRatio: mixStr || p.contentTypeRatio,
        engagementRatio: m?.engagement_rate?.value?.toString() || p.engagementRatio,
        ctaPatterns: finalCta || p.ctaPatterns,
        hookStyles: finalHooks || p.hookStyles,
        messagingTone: finalTone || p.messagingTone,
        socialProofPresence: finalProof || p.socialProofPresence,
      }));
      setViralInsights('');
      setAddStep('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Analysis Failed', err.message + '\n\nYou can still add this competitor manually.'),
  });

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
      queryClient.invalidateQueries({ queryKey: ['ci-miv3-history'] });
      queryClient.invalidateQueries({ queryKey: ['mi-v3-snapshot'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Analysis Error', err.message),
  });


  const deleteCompetitorMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(new URL(`/api/ci/competitors/${id}?accountId=default`, baseUrl).toString(), { method: 'DELETE' });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Delete failed'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-competitors'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to remove competitor'),
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
        { key: 'recommendations' as CIView, icon: 'flash-outline' as const, label: 'Actions' },
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

  const renderCompetitorsList = () => (
    <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
      <View style={s.cardHeader}>
        <Ionicons name="people-outline" size={18} color="#8B5CF6" />
        <Text style={[s.cardTitle, { color: colors.text }]}>Competitors</Text>
        <View style={[s.countBadge, { backgroundColor: '#8B5CF6' + '20' }]}>
          <Text style={[s.countText, { color: '#8B5CF6' }]}>{competitors.length}</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); setShowAddCompetitor(true); }}
          style={[s.addBtn, { backgroundColor: '#8B5CF6' }]}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {competitors.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
          <Ionicons name="person-add-outline" size={32} color={colors.textMuted} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>No competitors added yet</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Add your first competitor to start tracking their strategy</Text>
        </View>
      ) : (
        competitors.map((comp: Competitor) => (
          <View key={comp.id} style={[s.breakdownItem, { borderBottomWidth: 1, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }]}>
            <Pressable onPress={() => { Haptics.selectionAsync(); setExpandedCompetitor(expandedCompetitor === comp.id ? null : comp.id); }} style={s.compHeader}>
              <View style={s.compInfo}>
                <View style={s.compNameRow}>
                  <Text style={[s.compName, { color: colors.text }]}>{comp.name}</Text>
                  <View style={[s.evidenceDot, { backgroundColor: comp.evidenceComplete ? '#10B981' : '#F59E0B' }]} />
                </View>
                <Text style={[s.compMeta, { color: colors.textMuted }]}>{comp.platform} • {comp.businessType || 'Unknown type'}</Text>
              </View>
              <View style={s.compRight}>
                <Ionicons name={expandedCompetitor === comp.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
            </Pressable>

            {!comp.evidenceComplete && comp.missingFields?.length > 0 && (
              <View style={[s.missingBar, { backgroundColor: '#F59E0B' + '15' }]}>
                <Ionicons name="warning-outline" size={14} color="#F59E0B" />
                <Text style={[s.missingText, { color: '#F59E0B' }]}>{comp.missingFields.length} missing fields</Text>
              </View>
            )}

            {expandedCompetitor === comp.id && (
              <View style={s.compDetails}>
                {comp.profileLink && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Profile</Text>
                    <Text style={[s.detailValue, { color: colors.text }]} numberOfLines={1}>{comp.profileLink}</Text>
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
                {comp.notes && (
                  <View style={s.detailRow}>
                    <Text style={[s.detailLabel, { color: colors.textMuted }]}>Notes</Text>
                    <Text style={[s.detailValue, { color: colors.text }]}>{comp.notes}</Text>
                  </View>
                )}
                <Pressable
                  onPress={() => { Alert.alert('Remove Competitor', `Remove ${comp.name}?`, [{ text: 'Cancel' }, { text: 'Remove', style: 'destructive', onPress: () => deleteCompetitorMutation.mutate(comp.id) }]); }}
                  style={s.removeBtn}
                >
                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                  <Text style={[s.removeBtnText, { color: '#EF4444' }]}>Remove</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );

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

    return (
      <View>
        {renderCompetitorsList()}
        {miv3Result && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#8B5CF6" />
              <Text style={[s.cardTitle, { color: colors.text }]}>MI V3</Text>
              <View style={[s.intensityBadge, { backgroundColor: miv3Result.executionMode === 'FULL' ? '#10B981' + '20' : miv3Result.executionMode === 'REDUCED' ? '#F59E0B' + '20' : '#6B7280' + '20' }]}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: miv3Result.executionMode === 'FULL' ? '#10B981' : miv3Result.executionMode === 'REDUCED' ? '#F59E0B' : '#6B7280' }}>
                  {miv3Result.executionMode}
                </Text>
              </View>
            </View>

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

            {miv3Result.output?.entryStrategy && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#8B5CF6', marginBottom: 2 }}>Entry Strategy</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary }}>{miv3Result.output.entryStrategy}</Text>
              </View>
            )}

            {miv3Result.output?.defensiveRisks?.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444', marginBottom: 2 }}>Defensive Risks</Text>
                {miv3Result.output.defensiveRisks.map((risk: string, i: number) => (
                  <Text key={i} style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>• {risk}</Text>
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
                  {dom.weaknesses.map((w: string, j: number) => (
                    <Text key={j} style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>- {w}</Text>
                  ))}
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
              source: miv3_snapshot:{miv3Result.snapshotId?.slice(0, 8)} | cached: {miv3Result.cached ? 'yes' : 'no'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderRecommendations = () => {
    const output = miv3Result?.output;
    const entryStrategy = output?.entryStrategy;
    const defensiveRisks = output?.defensiveRisks || [];
    const missingSignals = output?.missingSignalFlags || [];
    const confidence = output?.confidence;
    const intentMap = output?.competitorIntentMap || [];
    const trajectory = miv3Result?.trajectoryData;

    return (
      <View>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>MI V3 Actions</Text>
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
            <Ionicons name="flash-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No Actions Available</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Run MI V3 from the Overview tab to generate strategic actions</Text>
          </View>
        ) : (
          <View>
            {entryStrategy && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="compass-outline" size={18} color="#8B5CF6" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Entry Strategy</Text>
                </View>
                <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 20 }}>{entryStrategy}</Text>
              </View>
            )}

            {defensiveRisks.length > 0 && (
              <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={s.cardHeader}>
                  <Ionicons name="warning-outline" size={18} color="#EF4444" />
                  <Text style={[s.cardTitle, { color: colors.text }]}>Defensive Risks</Text>
                </View>
                {defensiveRisks.map((risk: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 6, alignItems: 'flex-start' }}>
                    <Ionicons name="alert-circle" size={14} color="#EF4444" style={{ marginTop: 2 }} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, flex: 1, lineHeight: 18 }}>{risk}</Text>
                  </View>
                ))}
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
                  return (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: i < intentMap.length - 1 ? 1 : 0, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{intent.competitorName}</Text>
                        {intent.degraded && <Text style={{ fontSize: 10, color: '#F59E0B' }}>Degraded: {intent.degradeReason}</Text>}
                      </View>
                      <View style={[s.threatBadge, { backgroundColor: intentColor + '20' }]}>
                        <Text style={{ fontSize: 10, fontWeight: '600', color: intentColor }}>{intent.intentCategory?.replace(/_/g, ' ')}</Text>
                      </View>
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
                  <View key={i} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.textMuted }}>{idx.label}</Text>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: idx.color }}>{((idx.value || 0) * 100).toFixed(0)}%</Text>
                    </View>
                    <View style={[s.qualityBar]}>
                      <View style={[s.qualityFill, { width: `${(idx.value || 0) * 100}%`, backgroundColor: idx.color }]} />
                    </View>
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
                source: miv3_snapshot:{miv3Result?.snapshotId?.slice(0, 8)} | guard: {confidence?.guardDecision} | mode: {miv3Result?.executionMode}
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
      {activeView === 'recommendations' && renderRecommendations()}
      {activeView === 'timeline' && renderTimeline()}

      <Modal visible={showAddCompetitor} animationType="slide" transparent onRequestClose={() => { setShowAddCompetitor(false); setAddStep('input'); setShowManualFields(false); }}>
        <View style={s.modalOverlay}>
          <View style={[s.modalContent, { backgroundColor: isDark ? '#0F1419' : '#fff' }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>
                {addStep === 'input' ? 'Add Competitor' : 'Review AI Analysis'}
              </Text>
              <Pressable onPress={() => { setShowAddCompetitor(false); setAddStep('input'); setShowManualFields(false); }}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
              {addStep === 'input' ? (
                <>
                  <View style={[s.aiHintCard, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
                    <Ionicons name="sparkles" size={18} color="#8B5CF6" />
                    <Text style={[s.aiHintText, { color: colors.textSecondary }]}>
                      Just enter the company name and profile URL. AI will auto-analyze their content strategy from their top viral posts.
                    </Text>
                  </View>

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

                  <Pressable
                    onPress={() => {
                      if (!newComp.name || !newComp.profileLink) {
                        Alert.alert('Required', 'Enter company name and profile URL');
                        return;
                      }
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      autoAnalyzeMutation.mutate({ name: newComp.name, profileLink: newComp.profileLink });
                    }}
                    style={[s.autoAnalyzeBtn, { opacity: autoAnalyzeMutation.isPending ? 0.7 : 1 }]}
                    disabled={autoAnalyzeMutation.isPending}
                  >
                    {autoAnalyzeMutation.isPending ? (
                      <>
                        <ActivityIndicator size="small" color="#fff" />
                        <Text style={s.autoAnalyzeBtnText}>Analyzing viral content...</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={18} color="#fff" />
                        <Text style={s.autoAnalyzeBtnText}>Auto-Analyze with AI</Text>
                      </>
                    )}
                  </Pressable>

                  {autoAnalyzeMutation.isPending && (
                    <View style={s.analyzingSteps}>
                      <Text style={[s.analyzingStep, { color: colors.textMuted }]}>
                        <Ionicons name="checkmark-circle" size={13} color="#8B5CF6" /> Scanning profile...
                      </Text>
                      <Text style={[s.analyzingStep, { color: colors.textMuted }]}>
                        <Ionicons name="videocam" size={13} color="#8B5CF6" /> Analyzing 3-5 viral posts...
                      </Text>
                      <Text style={[s.analyzingStep, { color: colors.textMuted }]}>
                        <Ionicons name="analytics" size={13} color="#8B5CF6" /> Extracting patterns...
                      </Text>
                    </View>
                  )}

                  <Pressable
                    onPress={() => setShowManualFields(!showManualFields)}
                    style={s.manualToggle}
                  >
                    <Ionicons name={showManualFields ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                    <Text style={[s.manualToggleText, { color: colors.textMuted }]}>
                      {showManualFields ? 'Hide manual entry' : 'Or fill in manually'}
                    </Text>
                  </Pressable>

                  {showManualFields && (
                    <>
                      <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Business Type *</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                        value={newComp.businessType}
                        onChangeText={v => setNewComp(p => ({ ...p, businessType: v }))}
                        placeholder="E-commerce, Service, Local..."
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

                      <View style={[s.sectionDivider, { borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                        <Text style={[s.sectionDividerText, { color: '#8B5CF6' }]}>Evidence Fields</Text>
                      </View>

                      <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Posts/Week</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                        value={newComp.postingFrequency}
                        onChangeText={v => setNewComp(p => ({ ...p, postingFrequency: v }))}
                        placeholder="e.g. 5"
                        keyboardType="numeric"
                        placeholderTextColor={colors.textMuted}
                      />

                      <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Engagement Ratio (%)</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                        value={newComp.engagementRatio}
                        onChangeText={v => setNewComp(p => ({ ...p, engagementRatio: v }))}
                        placeholder="e.g. 3.5"
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors.textMuted}
                      />

                      <Text style={[s.fieldLabel, { color: colors.textMuted }]}>CTA Patterns</Text>
                      <TextInput
                        style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                        value={newComp.ctaPatterns}
                        onChangeText={v => setNewComp(p => ({ ...p, ctaPatterns: v }))}
                        placeholder="Book Now, Shop Now, DM to Order..."
                        placeholderTextColor={colors.textMuted}
                      />

                      <Pressable
                        onPress={() => {
                          if (!newComp.name || !newComp.profileLink || !newComp.businessType || !newComp.primaryObjective) {
                            Alert.alert('Required Fields', 'Name, Profile Link, Business Type, and Primary Objective are required');
                            return;
                          }
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                          addCompetitorMutation.mutate(newComp);
                        }}
                        style={[s.submitBtn, { opacity: addCompetitorMutation.isPending ? 0.6 : 1 }]}
                        disabled={addCompetitorMutation.isPending}
                      >
                        {addCompetitorMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> :
                          <Text style={s.submitBtnText}>Add Manually</Text>
                        }
                      </Pressable>
                    </>
                  )}
                </>
              ) : (
                <>
                  {profileAnalysis && (
                    <>
                      <View style={[s.aiResultHeader, {
                        backgroundColor: profileAnalysis.status === 'VALID' ? '#10B981' + '12' : '#F59E0B' + '12',
                        borderColor: profileAnalysis.status === 'VALID' ? '#10B981' + '30' : '#F59E0B' + '30',
                      }]}>
                        <Ionicons
                          name={profileAnalysis.status === 'VALID' ? 'checkmark-circle' : 'alert-circle'}
                          size={20}
                          color={profileAnalysis.status === 'VALID' ? '#10B981' : '#F59E0B'}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.aiResultTitle, { color: colors.text }]}>
                            {profileAnalysis.status === 'VALID' ? 'Profile Verified' : 'Partial Data'}
                          </Text>
                          <Text style={[s.aiResultSub, { color: colors.textMuted }]}>
                            {profileAnalysis.scannedPosts} posts scanned via {profileAnalysis.collection_method_used?.replace(/_/g, ' ').toLowerCase()}
                          </Text>
                        </View>
                      </View>

                      {profileAnalysis.warnings?.length > 0 && (
                        <View style={{ gap: 4, marginBottom: 8 }}>
                          {profileAnalysis.warningDetails?.map((w: string, i: number) => (
                            <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingHorizontal: 4 }}>
                              <Ionicons name="warning-outline" size={13} color="#F59E0B" style={{ marginTop: 1 }} />
                              <Text style={{ fontSize: 11, color: '#F59E0B', flex: 1, lineHeight: 16 }}>{w}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      <View style={[s.sectionDivider, { borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="shield-checkmark" size={14} color="#10B981" />
                          <Text style={[s.sectionDividerText, { color: '#10B981' }]}>MEASURED (Verified)</Text>
                        </View>
                      </View>

                      {profileAnalysis.measured?.followers && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>Followers</Text>
                          <Text style={[s.measuredValue, { color: colors.text }]}>{profileAnalysis.measured.followers.value.toLocaleString()}</Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>source: {profileAnalysis.measured.followers.source}</Text>
                        </View>
                      )}

                      {profileAnalysis.measured?.posts_last_7d && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>Posts (last 7 days)</Text>
                          <Text style={[s.measuredValue, { color: colors.text }]}>{profileAnalysis.measured.posts_last_7d.value}</Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>from {profileAnalysis.measured.posts_last_7d.sampleSize} scanned posts</Text>
                        </View>
                      )}

                      {profileAnalysis.measured?.reels_last_7d && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>Reels (last 7 days)</Text>
                          <Text style={[s.measuredValue, { color: colors.text }]}>{profileAnalysis.measured.reels_last_7d.value}</Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>from {profileAnalysis.measured.reels_last_7d.sampleSize} scanned posts</Text>
                        </View>
                      )}

                      {profileAnalysis.measured?.avg_posts_per_week_28d && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>Avg posts/week (28d)</Text>
                          <Text style={[s.measuredValue, { color: colors.text }]}>{profileAnalysis.measured.avg_posts_per_week_28d.value}</Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>from {profileAnalysis.measured.avg_posts_per_week_28d.sampleSize} scanned posts</Text>
                        </View>
                      )}

                      {profileAnalysis.measured?.content_mix && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>Content Mix (n={profileAnalysis.measured.content_mix.sampleSize} scanned posts)</Text>
                          <Text style={[s.measuredValue, { color: colors.text }]}>
                            Reels {Math.round(profileAnalysis.measured.content_mix.reels_ratio * 100)}% / Static {Math.round(profileAnalysis.measured.content_mix.static_ratio * 100)}%
                          </Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>based on all {profileAnalysis.measured.content_mix.sampleSize} scanned posts, not time-filtered</Text>
                        </View>
                      )}

                      {profileAnalysis.measured?.engagement_rate && (
                        <View style={s.measuredRow}>
                          <Text style={[s.measuredLabel, { color: colors.textMuted }]}>
                            Engagement ({profileAnalysis.measured.engagement_rate.timeframe}, n={profileAnalysis.measured.engagement_rate.sampleSize})
                          </Text>
                          <Text style={[s.measuredValue, { color: colors.text, opacity: profileAnalysis.measured?.posts_last_7d?.value === 0 ? 0.5 : 1 }]}>
                            {profileAnalysis.measured.engagement_rate.value}%
                          </Text>
                          <Text style={[s.measuredMeta, { color: colors.textMuted }]}>
                            ({profileAnalysis.measured.engagement_rate.avgLikes.toLocaleString()} avg likes + {profileAnalysis.measured.engagement_rate.avgComments.toLocaleString()} avg comments) / {profileAnalysis.measured.engagement_rate.followers.toLocaleString()} followers
                          </Text>
                          {profileAnalysis.measured?.posts_last_7d?.value === 0 && (
                            <Text style={{ fontSize: 10, color: '#F59E0B', marginTop: 2, fontStyle: 'italic' }}>
                              Note: 0 posts in last 7d — engagement is based on older posts in the scanned sample
                            </Text>
                          )}
                        </View>
                      )}

                      {profileAnalysis.inferred && profileAnalysis.inferred.insights?.length > 0 && (
                        <>
                          <View style={[s.sectionDivider, { borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Ionicons name="sparkles" size={14} color="#F59E0B" />
                              <Text style={[s.sectionDividerText, { color: '#F59E0B' }]}>INFERRED (AI Insight)</Text>
                            </View>
                          </View>

                          {profileAnalysis.inferred.insights.map((insight: any, i: number) => (
                            <View key={i} style={[s.insightsCard, { backgroundColor: '#F59E0B' + '08', borderColor: '#F59E0B' + '20' }]}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <Ionicons name="sparkles" size={12} color="#F59E0B" />
                                <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                                  {insight.category?.replace(/_/g, ' ')}
                                </Text>
                              </View>
                              <Text style={[s.insightsBody, { color: colors.textSecondary }]}>{insight.finding}</Text>
                              {insight.evidencePermalinks?.length > 0 && (
                                <View style={{ marginTop: 4 }}>
                                  <Text style={{ fontSize: 10, color: colors.textMuted }}>
                                    Evidence: {insight.evidencePermalinks.length} reel{insight.evidencePermalinks.length > 1 ? 's' : ''} analyzed
                                  </Text>
                                </View>
                              )}
                            </View>
                          ))}
                        </>
                      )}

                      {profileAnalysis.creativeCapture && profileAnalysis.creativeCapture.length > 0 && (
                        <>
                          <Pressable
                            onPress={() => setCcExpanded(!ccExpanded)}
                            style={[s.sectionDivider, { borderColor: isDark ? '#1A2030' : '#E2E8E4', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Ionicons name="videocam" size={14} color="#8B5CF6" />
                              <Text style={[s.sectionDividerText, { color: '#8B5CF6' }]}>CREATIVE CAPTURE ({profileAnalysis.creativeCapture.length} reels)</Text>
                            </View>
                            <Ionicons name={ccExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#8B5CF6" />
                          </Pressable>

                          {profileAnalysis.creativeCapture.map((cc: any, ci: number) => {
                            const summaryParts: string[] = [];
                            const sources = new Set<string>();
                            if (cc.interpreted?.hookCandidates?.length > 0) {
                              cc.interpreted.hookCandidates.forEach((h: any) => sources.add(h.source));
                              summaryParts.push(`Hook: MEASURED (${[...sources].join(' + ')})`);
                            }
                            sources.clear();
                            if (cc.interpreted?.ctaSignals?.length > 0) {
                              cc.interpreted.ctaSignals.forEach((c: any) => sources.add(c.source));
                              summaryParts.push(`CTA: MEASURED (${[...sources].join(' + ')})`);
                            }
                            sources.clear();
                            if (cc.interpreted?.offerSignals?.length > 0) {
                              cc.interpreted.offerSignals.forEach((o: any) => sources.add(o.source));
                              summaryParts.push(`Offer: MEASURED (${[...sources].join(' + ')})`);
                            }
                            if (cc.interpreted?.unavailable?.length > 0) {
                              summaryParts.push(`${cc.interpreted.unavailable.length} UNAVAILABLE`);
                            }
                            const summaryLine = summaryParts.length > 0 ? summaryParts.join(' | ') : 'No signals detected';
                            const isReelExpanded = ccReelExpanded[ci] || false;
                            const cb = cc.evidencePack?.confidenceBreakdown;

                            return (
                              <View key={ci} style={[s.insightsCard, { backgroundColor: isDark ? '#1A1A2E' : '#F8F7FF', borderColor: '#8B5CF6' + '30', marginBottom: 8 }]}>
                                <Pressable
                                  onPress={() => setCcReelExpanded(prev => ({ ...prev, [ci]: !prev[ci] }))}
                                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}
                                >
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6' }}>Reel {ci + 1}</Text>
                                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cc.evidencePack?.status === 'COMPLETE' ? '#10B981' : '#F59E0B' }} />
                                    <Text style={{ fontSize: 9, color: cc.evidencePack?.status === 'COMPLETE' ? '#10B981' : '#F59E0B', fontWeight: '600' }}>
                                      {cc.evidencePack?.status}
                                    </Text>
                                  </View>
                                  <Ionicons name={isReelExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#8B5CF6" />
                                </Pressable>

                                <Text style={{ fontSize: 10, color: colors.text, lineHeight: 15 }} numberOfLines={2}>
                                  {summaryLine}
                                </Text>

                                {cb && (
                                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                                    {cb.ocr_confidence !== null && (
                                      <Text style={{ fontSize: 8, color: colors.textMuted }}>OCR: {Math.round(cb.ocr_confidence * 100)}%</Text>
                                    )}
                                    {cb.transcript_confidence !== null && (
                                      <Text style={{ fontSize: 8, color: colors.textMuted }}>Transcript: {Math.round(cb.transcript_confidence * 100)}%</Text>
                                    )}
                                    <Text style={{ fontSize: 8, color: colors.textMuted }}>Rules: {cb.rule_confidence === 1 ? '100%' : '0%'}</Text>
                                    <Text style={{ fontSize: 8, color: colors.textMuted }}>Quality: {Math.round(cb.overall_data_quality * 100)}%</Text>
                                  </View>
                                )}

                                {(ccExpanded || isReelExpanded) && (
                                  <View style={{ marginTop: 8 }}>
                                    <View style={{ marginBottom: 6 }}>
                                      <Text style={{ fontSize: 9, color: colors.textMuted }}>
                                        Sources: {cc.evidencePack?.sourcesSucceeded?.join(', ') || 'none'} ({cc.evidencePack?.sourcesSucceeded?.length || 0}/{cc.evidencePack?.sourcesAttempted?.length || 0})
                                      </Text>
                                      {cc.evidencePack?.asset_ttl_hours && (
                                        <Text style={{ fontSize: 8, color: colors.textMuted, marginTop: 2 }}>
                                          Asset TTL: {cc.evidencePack.asset_ttl_hours}h | Purge: {cc.evidencePack.purge_scheduled_at ? new Date(cc.evidencePack.purge_scheduled_at).toLocaleTimeString() : 'N/A'}
                                        </Text>
                                      )}
                                    </View>

                                    {cc.evidencePack?.warnings?.length > 0 && (
                                      <View style={{ marginBottom: 6 }}>
                                        {cc.evidencePack.warnings.map((w: any, wi: number) => (
                                          <Text key={wi} style={{ fontSize: 9, color: '#F59E0B', fontStyle: 'italic' }}>
                                            {w.code}: {w.reason}
                                          </Text>
                                        ))}
                                      </View>
                                    )}

                                    {cc.interpreted?.hookCandidates?.length > 0 && (
                                      <View style={{ marginBottom: 4 }}>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#10B981', marginBottom: 2 }}>Hook Candidates</Text>
                                        {cc.interpreted.hookCandidates.map((h: any, hi: number) => (
                                          <View key={hi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                            <View style={{ backgroundColor: '#10B981' + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                                              <Text style={{ fontSize: 8, color: '#10B981', fontWeight: '600' }}>MEASURED</Text>
                                            </View>
                                            <Text style={{ fontSize: 10, color: colors.text, flex: 1 }} numberOfLines={2}>{h.text}</Text>
                                            <Text style={{ fontSize: 8, color: colors.textMuted }}>{h.source} ({Math.round(h.confidence * 100)}%)</Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}

                                    {cc.interpreted?.ctaSignals?.length > 0 && (
                                      <View style={{ marginBottom: 4 }}>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#3B82F6', marginBottom: 2 }}>CTA Signals</Text>
                                        {cc.interpreted.ctaSignals.map((c: any, csi: number) => (
                                          <View key={csi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                            <View style={{ backgroundColor: '#3B82F6' + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                                              <Text style={{ fontSize: 8, color: '#3B82F6', fontWeight: '600' }}>MEASURED</Text>
                                            </View>
                                            <Text style={{ fontSize: 10, color: colors.text }}>{c.text}</Text>
                                            <Text style={{ fontSize: 8, color: colors.textMuted }}>{c.source}</Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}

                                    {cc.interpreted?.offerSignals?.length > 0 && (
                                      <View style={{ marginBottom: 4 }}>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B', marginBottom: 2 }}>Offer Signals</Text>
                                        {cc.interpreted.offerSignals.map((o: any, oi: number) => (
                                          <View key={oi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                            <View style={{ backgroundColor: '#F59E0B' + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                                              <Text style={{ fontSize: 8, color: '#F59E0B', fontWeight: '600' }}>MEASURED</Text>
                                            </View>
                                            <Text style={{ fontSize: 10, color: colors.text }}>{o.text}</Text>
                                            <Text style={{ fontSize: 8, color: colors.textMuted }}>{o.source}</Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}

                                    {cc.interpreted?.proofSignals?.length > 0 && (
                                      <View style={{ marginBottom: 4 }}>
                                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#EC4899', marginBottom: 2 }}>Proof Signals</Text>
                                        {cc.interpreted.proofSignals.map((p: any, pi: number) => (
                                          <View key={pi} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                            <View style={{ backgroundColor: '#EC4899' + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                                              <Text style={{ fontSize: 8, color: '#EC4899', fontWeight: '600' }}>MEASURED</Text>
                                            </View>
                                            <Text style={{ fontSize: 10, color: colors.text }}>{p.text}</Text>
                                            <Text style={{ fontSize: 8, color: colors.textMuted }}>{p.source}</Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}

                                    {cc.interpreted?.unavailable?.length > 0 && (
                                      <View style={{ marginTop: 4 }}>
                                        {cc.interpreted.unavailable.map((u: any, ui: number) => (
                                          <View key={ui} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                            <View style={{ backgroundColor: '#6B7280' + '20', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                                              <Text style={{ fontSize: 8, color: '#6B7280', fontWeight: '600' }}>UNAVAILABLE</Text>
                                            </View>
                                            <Text style={{ fontSize: 9, color: colors.textMuted, flex: 1 }}>
                                              {u.signal}: {u.reason}
                                            </Text>
                                          </View>
                                        ))}
                                      </View>
                                    )}

                                    {cc.evidencePack?.ocrTopLines?.length > 0 && (
                                      <View style={{ marginTop: 4, padding: 4, backgroundColor: isDark ? '#0D1117' : '#F0F0F0', borderRadius: 4 }}>
                                        <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textMuted, marginBottom: 2 }}>OCR Text (deduplicated)</Text>
                                        <Text style={{ fontSize: 9, color: colors.text }} numberOfLines={3}>
                                          {cc.evidencePack.ocrTopLines.slice(0, 5).join(' | ')}
                                        </Text>
                                      </View>
                                    )}

                                    {cc.evidencePack?.transcript && (
                                      <View style={{ marginTop: 4, padding: 4, backgroundColor: isDark ? '#0D1117' : '#F0F0F0', borderRadius: 4 }}>
                                        <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textMuted, marginBottom: 2 }}>
                                          Transcript (confidence: {cc.evidencePack.transcriptConfidence ? Math.round(cc.evidencePack.transcriptConfidence * 100) + '%' : 'N/A'})
                                        </Text>
                                        <Text style={{ fontSize: 9, color: colors.text }} numberOfLines={3}>
                                          {cc.evidencePack.transcript.substring(0, 200)}
                                        </Text>
                                      </View>
                                    )}

                                    {cc.evidencePack?.pinnedCommentText && (
                                      <View style={{ marginTop: 4, padding: 4, backgroundColor: isDark ? '#0D1117' : '#F0F0F0', borderRadius: 4 }}>
                                        <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textMuted, marginBottom: 2 }}>Pinned Comment</Text>
                                        <Text style={{ fontSize: 9, color: colors.text }} numberOfLines={2}>
                                          {cc.evidencePack.pinnedCommentText.substring(0, 200)}
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </>
                      )}

                      <View style={{ marginTop: 8, padding: 8, borderRadius: 6, backgroundColor: isDark ? '#1A2030' + '60' : '#F5F7FA' }}>
                        <Text style={{ fontSize: 10, color: colors.textMuted, lineHeight: 15 }}>
                          Audit: {profileAnalysis.attempts?.join(' → ')} | Method: {profileAnalysis.collection_method_used} | Source: {profileAnalysis.source_type}
                        </Text>
                      </View>
                    </>
                  )}

                  <View style={[s.sectionDivider, { borderColor: isDark ? '#1A2030' : '#E2E8E4', marginTop: 12 }]}>
                    <Text style={[s.sectionDividerText, { color: '#8B5CF6' }]}>Competitor Details</Text>
                  </View>

                  <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Company Name</Text>
                  <TextInput
                    style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                    value={newComp.name}
                    onChangeText={v => setNewComp(p => ({ ...p, name: v }))}
                    placeholderTextColor={colors.textMuted}
                  />

                  <Text style={[s.fieldLabel, { color: colors.textMuted }]}>Business Type *</Text>
                  <TextInput
                    style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}
                    value={newComp.businessType}
                    onChangeText={v => setNewComp(p => ({ ...p, businessType: v }))}
                    placeholder="E-commerce, Agency, F&B..."
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

                  <View style={s.reviewBtns}>
                    <Pressable
                      onPress={() => { setAddStep('input'); setShowManualFields(false); setProfileAnalysis(null); }}
                      style={[s.backBtn, { borderColor: isDark ? '#333' : '#ddd' }]}
                    >
                      <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
                      <Text style={[s.backBtnText, { color: colors.textMuted }]}>Back</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (!newComp.name || !newComp.profileLink || !newComp.businessType || !newComp.primaryObjective) {
                          Alert.alert('Required Fields', 'Name, Profile Link, Business Type, and Primary Objective are required');
                          return;
                        }
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        addCompetitorMutation.mutate(newComp);
                      }}
                      style={[s.saveBtn, { opacity: addCompetitorMutation.isPending ? 0.6 : 1 }]}
                      disabled={addCompetitorMutation.isPending}
                    >
                      {addCompetitorMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color="#fff" />
                          <Text style={s.saveBtnText}>Save Competitor</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
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
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 8 },
  removeBtnText: { fontSize: 12, fontWeight: '600' },
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
  analyzingSteps: { gap: 6, marginTop: 14, paddingLeft: 4 },
  analyzingStep: { fontSize: 12, lineHeight: 18 },
  manualToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 20, paddingVertical: 8 },
  manualToggleText: { fontSize: 13 },
  aiResultHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  aiResultTitle: { fontSize: 14, fontWeight: '700' },
  aiResultSub: { fontSize: 12, marginTop: 2 },
  insightsCard: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  insightsTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  insightsBody: { fontSize: 12, lineHeight: 18 },
  aiFilledInput: { borderLeftWidth: 3, borderLeftColor: '#8B5CF6' },
  measuredRow: { paddingVertical: 6, paddingHorizontal: 4, gap: 2 },
  measuredLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  measuredValue: { fontSize: 16, fontWeight: '700' },
  measuredMeta: { fontSize: 10, lineHeight: 14 },
  reviewBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  backBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 8, borderWidth: 1 },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  saveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 8 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
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
