import React, { useState, useCallback } from 'react';
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

interface Recommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  actionType: string;
  actionTarget: string;
  actionDetails: string;
  evidenceCitations: string;
  whyChanged: string | null;
  confidenceScore: number;
  riskLevel: string;
  impactRangeLow: number;
  impactRangeHigh: number;
  timeframe: string;
  status: string;
}

interface Analysis {
  id: string;
  analysisMonth: string;
  marketOverview: string;
  competitorBreakdown: string;
  strategicGaps: string;
  saturationPatterns: string | null;
  differentiationGaps: string | null;
  offerPositioningGaps: string | null;
  funnelWeaknesses: string | null;
  ctaTrends: string | null;
  authorityGaps: string | null;
  monthDiff: string | null;
  dataCompleteness: number;
  status: string;
  createdAt: string;
}

type CIView = 'overview' | 'competitors' | 'recommendations' | 'timeline';

const CATEGORY_COLORS: Record<string, string> = {
  content_strategy: '#8B5CF6',
  calendar_cadence: '#3B82F6',
  cta_optimization: '#F59E0B',
  offer_positioning: '#10B981',
  authority_building: '#EC4899',
  funnel_strategy: '#6366F1',
  general: '#6B7280',
};

const RISK_COLORS: Record<string, string> = {
  low: '#10B981',
  medium: '#F59E0B',
  high: '#EF4444',
};

function getCtaLabel(competitor: Competitor, analysis?: any): string {
  if (analysis?.warnings?.includes('CTA_DATA_UNAVAILABLE') || analysis?.warnings?.includes('SCRAPE_BLOCKED')) {
    return 'CTA: Unavailable (data not accessible)';
  }

  if (!competitor.ctaPatterns || competitor.ctaPatterns.trim() === '') {
    if (analysis?.intelligence?.storytelling_intelligence?.storytelling_present === true) {
      const mode = analysis?.intelligence?.storytelling_intelligence?.narrative_strategy_mode || 'narrative';
      return `CTA: Not present (Narrative-first strategy: ${mode})`;
    }
    return 'CTA: Not present';
  }

  return 'CTA: Present';
}

export default function CompetitiveIntelligence() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const queryClient = useQueryClient();
  const baseUrl = getApiUrl();
  const router = useRouter();
  const { setCreativeContext } = useCreativeContext();
  const { brandProfile } = useApp();
  const [loadingReelsFor, setLoadingReelsFor] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<CIView>('overview');
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [applyReason, setApplyReason] = useState('');
  const [expandedRec, setExpandedRec] = useState<string | null>(null);
  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(null);
  const [addStep, setAddStep] = useState<'input' | 'review'>('input');
  const [viralInsights, setViralInsights] = useState('');
  const [showManualFields, setShowManualFields] = useState(false);
  const [ccExpanded, setCcExpanded] = useState(false);
  const [ccReelExpanded, setCcReelExpanded] = useState<Record<number, boolean>>({});
  const [profileAnalysis, setProfileAnalysis] = useState<any>(null);

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

  const { data: analysesData, isLoading: loadingAnalyses } = useQuery({
    queryKey: ['ci-analyses'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/analyses?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const { data: recsData, isLoading: loadingRecs } = useQuery({
    queryKey: ['ci-recommendations'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/recommendations?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const { data: timelineData } = useQuery({
    queryKey: ['ci-timeline'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/strategy-timeline?accountId=default', baseUrl).toString());
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
      const res = await fetch(new URL('/api/ci/analyze', baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-analyses'] });
      queryClient.invalidateQueries({ queryKey: ['ci-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ci-timeline'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Analysis Error', err.message),
  });

  const applyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(new URL(`/api/ci/recommendations/${id}/apply`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', reason }),
      });
      if (!res.ok) throw new Error('Failed to apply');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ci-timeline'] });
      setShowApplyModal(false);
      setSelectedRec(null);
      setApplyReason('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(new URL(`/api/ci/recommendations/${id}/reject`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', reason }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ci-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['ci-timeline'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
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
  const analyses: Analysis[] = analysesData?.analyses || [];
  const recommendations: Recommendation[] = recsData?.recommendations || [];
  const latestAnalysis = analyses[0] || null;
  const pendingRecs = recommendations.filter(r => r.status === 'pending');
  const appliedRecs = recommendations.filter(r => r.status === 'applied');

  const handleCreateReelsFromCI = useCallback(async (comp: Competitor) => {
    setLoadingReelsFor(comp.id);
    try {
      const res = await fetch(new URL(`/api/dominance/analyses?accountId=default`, baseUrl).toString());
      const data = await res.json();
      const allAnalyses = data?.analyses || [];
      const compAnalysis = allAnalyses
        .filter((a: any) => a.competitorName === comp.name || a.competitorUrl === comp.profileLink)
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

      if (!compAnalysis) {
        Alert.alert('No Analysis Found', 'Run a Dominance Analysis for this competitor first (AI Management → Dominance Engine).');
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

  const safeParseJSON = (str: string | null | undefined) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  const handleApplyPress = useCallback((rec: Recommendation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedRec(rec);
    setApplyReason('');
    setShowApplyModal(true);
  }, []);

  const handleConfirmApply = useCallback(() => {
    if (!selectedRec) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    applyMutation.mutate({ id: selectedRec.id, reason: applyReason || 'User approved strategy' });
  }, [selectedRec, applyReason]);

  const renderSubTabs = () => (
    <View style={[s.subTabBar, { backgroundColor: isDark ? '#0A0E14' : '#F5F7FA', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
      {[
        { key: 'overview' as CIView, icon: 'eye-outline' as const, label: 'Overview' },
        { key: 'competitors' as CIView, icon: 'people-outline' as const, label: 'Competitors' },
        { key: 'recommendations' as CIView, icon: 'bulb-outline' as const, label: 'Actions' },
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

  const renderOverview = () => {
    const overview = safeParseJSON(latestAnalysis?.marketOverview);
    const gaps = safeParseJSON(latestAnalysis?.strategicGaps);
    const breakdown = safeParseJSON(latestAnalysis?.competitorBreakdown);

    if (!latestAnalysis) {
      return (
        <View style={s.emptyState}>
          <Ionicons name="telescope-outline" size={48} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Analysis Yet</Text>
          <Text style={[s.emptyDesc, { color: colors.textMuted }]}>
            Add competitors with complete evidence data, then run your first analysis.
          </Text>
        </View>
      );
    }

    return (
      <View>
        <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
          <View style={s.cardHeader}>
            <Ionicons name="globe-outline" size={18} color="#8B5CF6" />
            <Text style={[s.cardTitle, { color: colors.text }]}>Market Overview</Text>
          </View>
          <Text style={[s.cardBody, { color: colors.textSecondary }]}>{overview?.summary || 'Analysis in progress...'}</Text>
          {overview?.competitiveIntensity && (
            <View style={s.intensityRow}>
              <Text style={[s.intensityLabel, { color: colors.textMuted }]}>Competitive Intensity</Text>
              <View style={[s.intensityBadge, { backgroundColor: overview.competitiveIntensity === 'high' ? '#EF4444' + '20' : overview.competitiveIntensity === 'medium' ? '#F59E0B' + '20' : '#10B981' + '20' }]}>
                <Text style={[s.intensityText, { color: overview.competitiveIntensity === 'high' ? '#EF4444' : overview.competitiveIntensity === 'medium' ? '#F59E0B' : '#10B981' }]}>
                  {overview.competitiveIntensity?.toUpperCase()}
                </Text>
              </View>
            </View>
          )}
          {overview?.dominantTrends && (
            <View style={s.trendsWrap}>
              {overview.dominantTrends.map((t: string, i: number) => (
                <View key={i} style={[s.trendChip, { backgroundColor: '#8B5CF6' + '12' }]}>
                  <Text style={[s.trendChipText, { color: '#8B5CF6' }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
          <View style={s.cardHeader}>
            <Ionicons name="bar-chart-outline" size={18} color="#3B82F6" />
            <Text style={[s.cardTitle, { color: colors.text }]}>Data Quality</Text>
          </View>
          <View style={s.qualityBar}>
            <View style={[s.qualityFill, { width: `${(latestAnalysis.dataCompleteness || 0) * 100}%`, backgroundColor: '#10B981' }]} />
          </View>
          <Text style={[s.qualityText, { color: colors.textMuted }]}>{Math.round((latestAnalysis.dataCompleteness || 0) * 100)}% evidence completeness</Text>
        </View>

        {latestAnalysis && (
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 }}>
            <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
              snapshot_id: {latestAnalysis.id} | created: {new Date(latestAnalysis.createdAt).toLocaleString()} | cta_trends: {latestAnalysis.ctaTrends || 'none'}
            </Text>
          </View>
        )}

        {breakdown && Array.isArray(breakdown) && breakdown.length > 0 && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="people-outline" size={18} color="#EC4899" />
              <Text style={[s.cardTitle, { color: colors.text }]}>Competitor Breakdown</Text>
            </View>
            {breakdown.map((comp: any, i: number) => (
              <View key={i} style={[s.breakdownItem, i < breakdown.length - 1 && { borderBottomWidth: 1, borderBottomColor: isDark ? '#1A2030' : '#F0F0F0' }]}>
                <View style={s.breakdownHeader}>
                  <Text style={[s.breakdownName, { color: colors.text }]}>{comp.name}</Text>
                  <View style={[s.threatBadge, { backgroundColor: RISK_COLORS[comp.threatLevel] + '20' }]}>
                    <Text style={[s.threatText, { color: RISK_COLORS[comp.threatLevel] }]}>
                      {comp.threatLevel?.toUpperCase()} THREAT
                    </Text>
                  </View>
                </View>
                <Text style={[s.breakdownInsight, { color: colors.textSecondary }]}>{comp.keyInsight}</Text>
              </View>
            ))}
          </View>
        )}

        {gaps && Array.isArray(gaps) && gaps.length > 0 && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="flash-outline" size={18} color="#F59E0B" />
              <Text style={[s.cardTitle, { color: colors.text }]}>Strategic Gaps</Text>
            </View>
            {gaps.map((gap: any, i: number) => (
              <View key={i} style={[s.gapItem, { borderLeftColor: '#F59E0B' }]}>
                <Text style={[s.gapArea, { color: colors.text }]}>{gap.area}</Text>
                <Text style={[s.gapDesc, { color: colors.textSecondary }]}>{gap.description}</Text>
                <View style={s.gapOpRow}>
                  <Ionicons name="arrow-forward-circle-outline" size={14} color="#10B981" />
                  <Text style={[s.gapOp, { color: '#10B981' }]}>{gap.opportunity}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {latestAnalysis.saturationPatterns && (
          <View style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.cardHeader}>
              <Ionicons name="layers-outline" size={18} color="#6366F1" />
              <Text style={[s.cardTitle, { color: colors.text }]}>Deep Insights</Text>
            </View>
            {[
              { label: 'Saturation', val: latestAnalysis.saturationPatterns },
              { label: 'Differentiation', val: latestAnalysis.differentiationGaps },
              { label: 'Funnel Weaknesses', val: latestAnalysis.funnelWeaknesses },
              { label: 'CTA Trends', val: latestAnalysis.ctaTrends },
              { label: 'Authority Gaps', val: latestAnalysis.authorityGaps },
            ].filter(x => x.val).map((item, i) => (
              <View key={i} style={s.insightRow}>
                <Text style={[s.insightLabel, { color: '#8B5CF6' }]}>{item.label}</Text>
                <Text style={[s.insightVal, { color: colors.textSecondary }]}>{item.val}</Text>
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
              <><Ionicons name="sparkles" size={16} color="#fff" /><Text style={s.analyzeBtnText}>Run New Analysis</Text></>
            }
          </Pressable>
        </View>
      </View>
    );
  };

  const renderCompetitors = () => (
    <View>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color: colors.text }]}>Competitors ({competitors.length}/5)</Text>
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowAddCompetitor(true); }}
          style={[s.addBtn, { backgroundColor: '#8B5CF6' }]}
          disabled={competitors.length >= 5}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={s.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {competitors.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="search-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Competitors Added</Text>
          <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Add competitors to start tracking their strategy</Text>
        </View>
      ) : competitors.map(comp => (
        <View key={comp.id} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
          <Pressable onPress={() => setExpandedCompetitor(expandedCompetitor === comp.id ? null : comp.id)}>
            <View style={s.compHeader}>
              <View style={s.compInfo}>
                <View style={s.compNameRow}>
                  <Text style={[s.compName, { color: colors.text }]}>{comp.name}</Text>
                </View>
                <Text style={[s.compMeta, { color: colors.textMuted }]}>{comp.businessType} · {comp.primaryObjective}</Text>
              </View>
              <View style={s.compRight}>
                <View style={[s.evidenceDot, { backgroundColor: comp.evidenceComplete ? '#10B981' : '#F59E0B' }]} />
                <Ionicons name={expandedCompetitor === comp.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
            </View>
          </Pressable>

          {!comp.evidenceComplete && comp.missingFields.length > 0 && (
            <View style={[s.missingBar, { backgroundColor: '#F59E0B' + '12' }]}>
              <Ionicons name="warning-outline" size={14} color="#F59E0B" />
              <Text style={[s.missingText, { color: '#F59E0B' }]}>
                {comp.missingFields.map((f: string) => {
                  const labels: Record<string, string> = {
                    postingFrequency: 'Posting Frequency: Unavailable (insufficient data)',
                    contentTypeRatio: 'Content Mix: Unavailable (insufficient data)',
                    engagementRatio: 'Engagement Rate: Unavailable (insufficient data)',
                    profileLink: 'Profile Link: Not provided',
                  };
                  return labels[f] || f;
                }).join(' · ')}
              </Text>
            </View>
          )}

          {expandedCompetitor === comp.id && (
            <View style={s.compDetails}>
              {[
                { label: 'Profile', value: comp.profileLink, icon: 'link-outline' as const },
                { label: 'Posts/Week', value: comp.postingFrequency?.toString(), icon: 'calendar-outline' as const },
                { label: 'Content Mix', value: comp.contentTypeRatio, icon: 'pie-chart-outline' as const },
                { label: 'Engagement (scanned posts)', value: comp.engagementRatio ? `${comp.engagementRatio}%` : null, icon: 'heart-outline' as const },
                { label: 'CTA Patterns', value: comp.ctaPatterns || getCtaLabel(comp), icon: 'megaphone-outline' as const },
                { label: 'Discounts', value: comp.discountFrequency, icon: 'pricetag-outline' as const },
                { label: 'Hook Styles', value: comp.hookStyles, icon: 'videocam-outline' as const },
                { label: 'Tone', value: comp.messagingTone, icon: 'chatbubble-outline' as const },
                { label: 'Social Proof', value: comp.socialProofPresence, icon: 'star-outline' as const },
              ].filter(x => x.value).map((item, i) => (
                <View key={i} style={s.detailRow}>
                  <Ionicons name={item.icon} size={14} color="#8B5CF6" />
                  <Text style={[s.detailLabel, { color: colors.textMuted }]}>{item.label}:</Text>
                  <Text style={[s.detailValue, { color: colors.textSecondary }]} numberOfLines={2}>{item.value}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable
                  onPress={() => handleCreateReelsFromCI(comp)}
                  disabled={loadingReelsFor === comp.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#8B5CF6' + '15', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#8B5CF6' + '30', flex: 1 }}
                >
                  {loadingReelsFor === comp.id ? (
                    <ActivityIndicator size="small" color="#8B5CF6" />
                  ) : (
                    <Ionicons name="videocam-outline" size={14} color="#8B5CF6" />
                  )}
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B5CF6' }}>Create Reels Scripts</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      if (confirm(`Remove ${comp.name}?`)) {
                        deleteCompetitorMutation.mutate(comp.id);
                      }
                    } else {
                      Alert.alert('Remove Competitor', `Remove ${comp.name}?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => deleteCompetitorMutation.mutate(comp.id) },
                      ]);
                    }
                  }}
                  style={s.removeBtn}
                  disabled={deleteCompetitorMutation.isPending}
                >
                  {deleteCompetitorMutation.isPending ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                  )}
                  <Text style={[s.removeBtnText, { color: '#EF4444' }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      ))}
    </View>
  );

  const renderRecommendations = () => (
    <View>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color: colors.text }]}>Strategy Recommendations</Text>
        <View style={[s.countBadge, { backgroundColor: '#8B5CF6' + '20' }]}>
          <Text style={[s.countText, { color: '#8B5CF6' }]}>{pendingRecs.length} pending</Text>
        </View>
      </View>

      {recommendations.length === 0 ? (
        <View style={s.emptyState}>
          <Ionicons name="bulb-outline" size={40} color={colors.textMuted} />
          <Text style={[s.emptyTitle, { color: colors.text }]}>No Recommendations</Text>
          <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Run an analysis to generate AI-powered strategy recommendations</Text>
        </View>
      ) : recommendations.map(rec => {
        const citations = safeParseJSON(rec.evidenceCitations) || [];
        const details = safeParseJSON(rec.actionDetails);
        const isExpanded = expandedRec === rec.id;
        const catColor = CATEGORY_COLORS[rec.category] || '#6B7280';

        return (
          <View key={rec.id} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <Pressable onPress={() => setExpandedRec(isExpanded ? null : rec.id)}>
              <View style={s.recHeader}>
                <View style={[s.catDot, { backgroundColor: catColor }]} />
                <View style={{ flex: 1 }}>
                  <View style={s.recTitleRow}>
                    <Text style={[s.recTitle, { color: colors.text }]} numberOfLines={isExpanded ? undefined : 1}>{rec.title}</Text>
                  </View>
                  <View style={s.recMeta}>
                    <View style={[s.catChip, { backgroundColor: catColor + '15' }]}>
                      <Text style={[s.catChipText, { color: catColor }]}>{rec.category.replace(/_/g, ' ')}</Text>
                    </View>
                    <View style={[s.statusChip, { backgroundColor: rec.status === 'pending' ? '#F59E0B' + '15' : rec.status === 'applied' ? '#10B981' + '15' : '#EF4444' + '15' }]}>
                      <Text style={[s.statusChipText, { color: rec.status === 'pending' ? '#F59E0B' : rec.status === 'applied' ? '#10B981' : '#EF4444' }]}>{rec.status}</Text>
                    </View>
                  </View>
                </View>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </View>
            </Pressable>

            <View style={s.metersRow}>
              <View style={s.meter}>
                <Text style={[s.meterLabel, { color: colors.textMuted }]}>Confidence</Text>
                <View style={s.meterBar}>
                  <View style={[s.meterFill, { width: `${(rec.confidenceScore || 0) * 100}%`, backgroundColor: '#3B82F6' }]} />
                </View>
                <Text style={[s.meterVal, { color: '#3B82F6' }]}>{Math.round((rec.confidenceScore || 0) * 100)}%</Text>
              </View>
              <View style={s.meter}>
                <Text style={[s.meterLabel, { color: colors.textMuted }]}>Risk</Text>
                <View style={[s.riskDot, { backgroundColor: RISK_COLORS[rec.riskLevel] }]} />
                <Text style={[s.meterVal, { color: RISK_COLORS[rec.riskLevel] }]}>{rec.riskLevel}</Text>
              </View>
              <View style={s.meter}>
                <Text style={[s.meterLabel, { color: colors.textMuted }]}>Impact</Text>
                <Text style={[s.meterVal, { color: '#10B981' }]}>{rec.impactRangeLow}-{rec.impactRangeHigh}%</Text>
              </View>
            </View>

            {isExpanded && (
              <View style={s.recExpanded}>
                <Text style={[s.recDesc, { color: colors.textSecondary }]}>{rec.description}</Text>

                <View style={s.actionMapCard}>
                  <View style={s.actionMapHeader}>
                    <Ionicons name="navigate-outline" size={14} color="#8B5CF6" />
                    <Text style={[s.actionMapTitle, { color: '#8B5CF6' }]}>Action Map: {rec.actionType.replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={[s.actionMapTarget, { color: colors.textMuted }]}>Target: {rec.actionTarget}</Text>
                  {details && (
                    <>
                      {details.proposedChange && <Text style={[s.actionMapDetail, { color: colors.textSecondary }]}>{details.proposedChange}</Text>}
                      {details.implementation && <Text style={[s.actionMapImpl, { color: colors.textMuted }]}>{details.implementation}</Text>}
                    </>
                  )}
                </View>

                {citations.length > 0 && (
                  <View style={s.citationsSection}>
                    <Text style={[s.citationsTitle, { color: colors.text }]}>Evidence Citations</Text>
                    {citations.map((c: any, i: number) => (
                      <View key={i} style={[s.citationTag, { backgroundColor: catColor + '10', borderColor: catColor + '30' }]}>
                        <Text style={[s.citationName, { color: catColor }]}>[{c.competitorName} — {c.field}]</Text>
                        <Text style={[s.citationValue, { color: colors.textSecondary }]}>{c.value}</Text>
                        <Text style={[s.citationInsight, { color: colors.textMuted }]}>{c.insight}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={s.timeframeRow}>
                  <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                  <Text style={[s.timeframeText, { color: colors.textMuted }]}>Timeframe: {rec.timeframe?.replace(/_/g, ' ')}</Text>
                </View>

                {rec.status === 'pending' && (
                  <View style={s.decisionRow}>
                    <Pressable
                      onPress={() => handleApplyPress(rec)}
                      style={[s.applyBtn]}
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text style={s.applyBtnText}>Apply Strategy</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Alert.alert('Reject Strategy', 'Keep your current plan instead?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Reject', style: 'destructive', onPress: () => rejectMutation.mutate({ id: rec.id, reason: 'User chose to keep current plan' }) },
                        ]);
                      }}
                      style={[s.rejectBtn, { borderColor: isDark ? '#333' : '#ddd' }]}
                    >
                      <Text style={[s.rejectBtnText, { color: colors.textMuted }]}>Keep Current Plan</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  const renderTimeline = () => {
    const timeline = timelineData?.timeline || [];
    return (
      <View>
        <View style={s.sectionHeader}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>Strategy Timeline</Text>
        </View>
        {timeline.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="time-outline" size={40} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>No History</Text>
            <Text style={[s.emptyDesc, { color: colors.textMuted }]}>Your monthly analysis history will appear here</Text>
          </View>
        ) : timeline.map((entry: any, i: number) => (
          <View key={i} style={[s.card, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
            <View style={s.timelineHeader}>
              <View style={[s.timelineDot, { backgroundColor: '#8B5CF6' }]} />
              <Text style={[s.timelineMonth, { color: colors.text }]}>{entry.month}</Text>
              <View style={[s.statusChip, { backgroundColor: '#10B981' + '15' }]}>
                <Text style={[s.statusChipText, { color: '#10B981' }]}>{entry.status}</Text>
              </View>
            </View>
            <Text style={[s.timelineDetail, { color: colors.textMuted }]}>
              Data quality: {Math.round((entry.dataCompleteness || 0) * 100)}%
            </Text>
            {entry.decisions && entry.decisions.length > 0 && (
              <View style={s.timelineDecisions}>
                {entry.decisions.map((d: any, j: number) => (
                  <View key={j} style={s.timelineDecisionRow}>
                    <Ionicons
                      name={d.decision === 'applied' ? 'checkmark-circle' : 'close-circle'}
                      size={14}
                      color={d.decision === 'applied' ? '#10B981' : '#EF4444'}
                    />
                    <Text style={[s.timelineDecisionText, { color: colors.textSecondary }]}>{d.decision}</Text>
                  </View>
                ))}
              </View>
            )}
            {entry.monthDiff && (
              <View style={[s.diffCard, { backgroundColor: isDark ? '#151A22' : '#F8F9FA' }]}>
                <Ionicons name="swap-horizontal-outline" size={14} color="#8B5CF6" />
                <Text style={[s.diffText, { color: colors.textSecondary }]}>
                  Changes from previous month detected
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  if (loadingCompetitors || loadingAnalyses || loadingRecs) {
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

      <Modal visible={showApplyModal} animationType="fade" transparent onRequestClose={() => setShowApplyModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.confirmModal, { backgroundColor: isDark ? '#0F1419' : '#fff' }]}>
            <View style={s.confirmIcon}>
              <Ionicons name="shield-checkmark" size={32} color="#8B5CF6" />
            </View>
            <Text style={[s.confirmTitle, { color: colors.text }]}>Apply Strategy?</Text>
            <Text style={[s.confirmDesc, { color: colors.textSecondary }]}>
              {selectedRec?.title}
            </Text>
            <Text style={[s.confirmWarn, { color: colors.textMuted }]}>
              This will mark the recommendation as applied and log it in your strategy audit trail.
            </Text>
            <TextInput
              style={[s.input, { backgroundColor: isDark ? '#151A22' : '#F5F7FA', color: colors.text, borderColor: isDark ? '#1A2030' : '#E2E8E4', marginTop: 12 }]}
              value={applyReason}
              onChangeText={setApplyReason}
              placeholder="Add a note (optional)..."
              placeholderTextColor={colors.textMuted}
            />
            <View style={s.confirmBtns}>
              <Pressable onPress={() => setShowApplyModal(false)} style={[s.confirmCancel, { borderColor: isDark ? '#333' : '#ddd' }]}>
                <Text style={[s.confirmCancelText, { color: colors.textMuted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmApply}
                style={[s.confirmApply, { opacity: applyMutation.isPending ? 0.6 : 1 }]}
                disabled={applyMutation.isPending}
              >
                {applyMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> :
                  <Text style={s.confirmApplyText}>Confirm & Apply</Text>
                }
              </Pressable>
            </View>
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
});
