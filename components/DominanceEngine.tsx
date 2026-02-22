import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface DominanceAnalysis {
  id: string;
  competitorName: string;
  competitorUrl: string;
  campaignId?: string;
  location?: string;
  runId?: string;
  runVersion?: number;
  inputsHash?: string;
  topContent: any[] | null;
  contentEvidence: any[] | null;
  contentDissection: any | null;
  weaknessDetection: any | null;
  dominanceStrategy: any | null;
  dominanceDelta: any | null;
  fallbackReason: string[] | null;
  fallbackAcknowledged: boolean;
  modificationStatus: string;
  modelUsed: string;
  status: string;
  createdAt: string;
}

interface DominanceModification {
  id: string;
  analysisId: string;
  basePlan: any;
  adjustedPlan: any;
  diffSummary: any;
  adjustments: any[];
  overallImpact: any;
  competitorTargeted: string;
  lifecycleStatus: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  rollbackAvailable: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

type DominanceView = 'select' | 'dissection' | 'weaknesses' | 'strategy' | 'delta' | 'modifications';

const HOOK_COLORS: Record<string, string> = {
  question: '#3B82F6', promise: '#10B981', shock: '#EF4444', number: '#F59E0B', authority: '#8B5CF6',
};
const SEVERITY_COLORS: Record<string, string> = {
  low: '#10B981', medium: '#F59E0B', high: '#EF4444', critical: '#DC2626',
};
const IMPACT_COLORS: Record<string, string> = {
  low: '#6B7280', medium: '#3B82F6', high: '#10B981', critical: '#EF4444',
};
const LIFECYCLE_COLORS: Record<string, string> = {
  DRAFT: '#6B7280', REVIEW_REQUIRED: '#F59E0B', APPROVED: '#3B82F6', REJECTED: '#EF4444', APPLIED: '#10B981',
};

function getConfVal(field: any): string {
  if (!field) return 'N/A';
  if (typeof field === 'string') return field;
  if (field.value !== undefined) return String(field.value);
  return 'N/A';
}

function getConfScore(field: any): number {
  if (!field || typeof field !== 'object') return -1;
  if (typeof field.confidence === 'number') return field.confidence;
  return -1;
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score < 0) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444';
  return (
    <View style={[cStyles.confBadge, { backgroundColor: color + '18', borderColor: color + '40' }]}>
      <Text style={[cStyles.confText, { color }]}>{pct}%</Text>
    </View>
  );
}

function EvidenceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const color = source === 'metrics' ? '#10B981' : source === 'manual' || source === 'manual/video' ? '#3B82F6' : source === 'estimated' ? '#F59E0B' : '#6B7280';
  return (
    <View style={[cStyles.evBadge, { backgroundColor: color + '15', borderColor: color + '30' }]}>
      <Ionicons name={source === 'metrics' ? 'bar-chart' : source === 'estimated' ? 'help-circle' : 'eye'} size={10} color={color} />
      <Text style={[cStyles.evText, { color }]}>{(source || 'unknown').toUpperCase()}</Text>
    </View>
  );
}

function LifecycleBadge({ status }: { status: string }) {
  const color = LIFECYCLE_COLORS[status] || '#6B7280';
  return (
    <View style={[cStyles.lcBadge, { backgroundColor: color + '15', borderColor: color + '40' }]}>
      <View style={[cStyles.lcDot, { backgroundColor: color }]} />
      <Text style={[cStyles.lcText, { color }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}

const cStyles = StyleSheet.create({
  confBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  confText: { fontSize: 9, fontWeight: '800' },
  evBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  evText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  lcBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  lcDot: { width: 6, height: 6, borderRadius: 3 },
  lcText: { fontSize: 10, fontWeight: '700' },
});

export default function DominanceEngine() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const queryClient = useQueryClient();
  const baseUrl = getApiUrl();

  const [activeView, setActiveView] = useState<DominanceView>('select');
  const [selectedAnalysis, setSelectedAnalysis] = useState<DominanceAnalysis | null>(null);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [gateError, setGateError] = useState<{ currentCount: number; requiredCount: number } | null>(null);

  const { data: competitorsData, isLoading: loadingCompetitors } = useQuery({
    queryKey: ['ci-competitors'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/competitors?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const { data: analysesData, isLoading: loadingAnalyses } = useQuery({
    queryKey: ['dominance-analyses'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/dominance/analyses?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const { data: modsData, refetch: refetchMods } = useQuery({
    queryKey: ['dominance-mods', selectedAnalysis?.id],
    queryFn: async () => {
      if (!selectedAnalysis?.id) return { modifications: [] };
      const res = await fetch(new URL(`/api/dominance/${selectedAnalysis.id}/modifications?accountId=default`, baseUrl).toString());
      return res.json();
    },
    enabled: !!selectedAnalysis?.id,
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async (competitorId: string) => {
      const res = await fetch(new URL('/api/dominance/analyze', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', competitorId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'COMPETITOR_GATE_FAILED') {
          setGateError({ currentCount: data.currentCount, requiredCount: data.requiredCount });
          throw new Error(data.message);
        }
        throw new Error(data.error || data.message);
      }
      return data;
    },
    onSuccess: (data) => {
      setGateError(null);
      if (data.analysis) { setSelectedAnalysis(data.analysis); setActiveView('dissection'); }
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => {
      if (!gateError) Alert.alert('Analysis Failed', err.message);
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const res = await fetch(new URL(`/api/dominance/${analysisId}/retry`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.analysis) { setSelectedAnalysis(data.analysis); }
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert('Retry Failed', err.message),
  });

  const acknowledgeFallbackMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const res = await fetch(new URL(`/api/dominance/${analysisId}/acknowledge-fallback`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      if (selectedAnalysis) setSelectedAnalysis({ ...selectedAnalysis, fallbackAcknowledged: true });
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
    },
  });

  const generateModsMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const basePlan = {
        contentDistribution: { channels: ['instagram', 'facebook'], frequency: 'daily', contentTypes: ['reels', 'carousels', 'stories'] },
        creativeTestingFramework: { abTests: 3, variants: 2, minSampleSize: 500 },
        kpiMonitoring: { metrics: ['engagement_rate', 'reach', 'conversions'], reviewCycle: 'weekly' },
      };
      const res = await fetch(new URL(`/api/dominance/${analysisId}/generate-modifications`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', basePlan }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'FALLBACK_NOT_ACKNOWLEDGED') throw new Error(data.message);
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: () => {
      refetchMods();
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      setActiveView('modifications');
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  const approveModMutation = useMutation({
    mutationFn: async (modId: string) => {
      const res = await fetch(new URL(`/api/dominance/modifications/${modId}/approve`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      refetchMods();
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const applyModMutation = useMutation({
    mutationFn: async (modId: string) => {
      const res = await fetch(new URL(`/api/dominance/modifications/${modId}/apply`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      refetchMods();
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      Alert.alert('Applied', 'Modifications have been applied to your plan.');
    },
  });

  const rejectModMutation = useMutation({
    mutationFn: async (modId: string) => {
      const res = await fetch(new URL(`/api/dominance/modifications/${modId}/reject`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', reason: 'User rejected modifications' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      refetchMods();
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
    },
  });

  const rollbackModMutation = useMutation({
    mutationFn: async (modId: string) => {
      const res = await fetch(new URL(`/api/dominance/modifications/${modId}/rollback`, baseUrl).toString(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data) => {
      refetchMods();
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      Alert.alert('Rolled Back', data.message || 'Plan restored to previous version.');
    },
  });

  const competitors = competitorsData?.competitors || [];
  const analyses: DominanceAnalysis[] = analysesData?.analyses || [];
  const modifications: DominanceModification[] = modsData?.modifications || [];

  const handleSelectAnalysis = useCallback((analysis: DominanceAnalysis) => {
    setSelectedAnalysis(analysis);
    setActiveView('dissection');
    setExpandedItem(null);
  }, []);

  const renderFallbackBanner = () => {
    if (!selectedAnalysis) return null;
    const hasFallback = selectedAnalysis.status === 'partial' && selectedAnalysis.fallbackReason;
    if (!hasFallback) return null;
    const reasons = Array.isArray(selectedAnalysis.fallbackReason) ? selectedAnalysis.fallbackReason : [selectedAnalysis.fallbackReason];
    const acknowledged = selectedAnalysis.fallbackAcknowledged;

    return (
      <View style={[styles.fallbackBannerLarge, { backgroundColor: '#F59E0B' + '12', borderColor: '#F59E0B' + '40' }]}>
        <View style={styles.fbRow}>
          <Ionicons name="alert-circle" size={20} color="#F59E0B" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.fbTitle, { color: '#F59E0B' }]}>Partial Analysis — Fallback Data Used</Text>
            {reasons.map((r: string, i: number) => (
              <Text key={i} style={[styles.fbReason, { color: colors.textSecondary }]}>{r}</Text>
            ))}
          </View>
        </View>
        {!acknowledged && (
          <View style={styles.fbActions}>
            <Pressable
              style={[styles.fbBtn, { backgroundColor: '#F59E0B' }]}
              onPress={() => acknowledgeFallbackMutation.mutate(selectedAnalysis.id)}
              disabled={acknowledgeFallbackMutation.isPending}
            >
              {acknowledgeFallbackMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Ionicons name="checkmark" size={14} color="#fff" /><Text style={styles.fbBtnText}>Acknowledge & Proceed</Text></>
              )}
            </Pressable>
            <Pressable
              style={[styles.fbBtn, { backgroundColor: '#3B82F6' }]}
              onPress={() => retryMutation.mutate(selectedAnalysis.id)}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Ionicons name="refresh" size={14} color="#fff" /><Text style={styles.fbBtnText}>Retry Analysis</Text></>
              )}
            </Pressable>
          </View>
        )}
        {acknowledged && (
          <View style={[styles.fbAcked, { backgroundColor: '#10B981' + '15' }]}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={{ color: '#10B981', fontSize: 11, fontWeight: '600' }}>Fallback acknowledged — you can generate plan modifications</Text>
          </View>
        )}
      </View>
    );
  };

  const renderNavTabs = () => {
    if (!selectedAnalysis) return null;
    const tabs: { key: DominanceView; label: string; icon: string }[] = [
      { key: 'dissection', label: 'Dissection', icon: 'analytics' },
      { key: 'weaknesses', label: 'Weaknesses', icon: 'warning' },
      { key: 'strategy', label: 'Dominance', icon: 'rocket' },
      { key: 'delta', label: 'Delta', icon: 'trending-up' },
      { key: 'modifications', label: 'Plan Mods', icon: 'git-compare' },
    ];
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.navContainer}>
        <Pressable
          style={[styles.navTab, activeView === 'select' && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
          onPress={() => { setActiveView('select'); setSelectedAnalysis(null); }}
        >
          <Ionicons name="arrow-back" size={14} color={activeView === 'select' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.navText, { color: activeView === 'select' ? colors.primary : colors.textSecondary }]}>Back</Text>
        </Pressable>
        {tabs.map(tab => (
          <Pressable
            key={tab.key}
            style={[styles.navTab, activeView === tab.key && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
            onPress={() => setActiveView(tab.key)}
          >
            <Ionicons name={tab.icon as any} size={14} color={activeView === tab.key ? colors.primary : colors.textSecondary} />
            <Text style={[styles.navText, { color: activeView === tab.key ? colors.primary : colors.textSecondary }]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    );
  };

  const renderCompetitorSelect = () => (
    <View>
      <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.headerRow}>
          <Ionicons name="flash" size={24} color="#EF4444" />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Competitive Dominance Engine v2</Text>
        </View>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
          Deep content dissection with evidence-based ranking, weakness detection, dominance strategy with Dominance Delta, and controlled plan modifications with state machine lifecycle.
        </Text>
      </View>

      {gateError && (
        <View style={[styles.gateCard, { backgroundColor: '#EF4444' + '10', borderColor: '#EF4444' + '40' }]}>
          <Ionicons name="lock-closed" size={24} color="#EF4444" />
          <Text style={[styles.gateTitle, { color: '#EF4444' }]}>Competitor Gate — {gateError.currentCount}/{gateError.requiredCount} Required</Text>
          <Text style={[styles.gateSub, { color: colors.textSecondary }]}>
            Add at least {gateError.requiredCount} competitors with profile URLs in the Intelligence tab before running the Dominance Engine.
          </Text>
        </View>
      )}

      {competitors.length === 0 && !loadingCompetitors && (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="people-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>Add competitors in the Competitive Intelligence tab first</Text>
        </View>
      )}

      {loadingCompetitors && <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />}

      {competitors.map((comp: any) => {
        const existing = analyses.find((a: DominanceAnalysis) => a.competitorName === comp.name && a.status !== 'failed');
        return (
          <Pressable
            key={comp.id}
            style={[styles.competitorCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={() => existing ? handleSelectAnalysis(existing) : runAnalysisMutation.mutate(comp.id)}
          >
            <View style={styles.compRow}>
              <View style={[styles.compIcon, { backgroundColor: '#EF4444' + '20' }]}>
                <Ionicons name="skull" size={20} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.compName, { color: colors.text }]}>{comp.name}</Text>
                <Text style={[styles.compPlatform, { color: colors.textSecondary }]}>{comp.platform} {comp.businessType ? `\u00B7 ${comp.businessType}` : ''}</Text>
              </View>
              {existing ? (
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={[styles.statusBadge, { backgroundColor: existing.status === 'completed' ? '#10B981' + '20' : existing.status === 'partial' ? '#F59E0B' + '20' : '#6B7280' + '20' }]}>
                    <Text style={{ color: existing.status === 'completed' ? '#10B981' : existing.status === 'partial' ? '#F59E0B' : '#6B7280', fontSize: 11, fontWeight: '600' }}>
                      {existing.status === 'completed' ? 'Analyzed' : existing.status === 'partial' ? 'Partial' : existing.status}
                    </Text>
                  </View>
                  {existing.runVersion && existing.runVersion > 1 && (
                    <Text style={{ color: colors.textMuted, fontSize: 9 }}>v{existing.runVersion}</Text>
                  )}
                </View>
              ) : (
                <View style={[styles.statusBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Ionicons name="play" size={12} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '600', marginLeft: 4 }}>Analyze</Text>
                </View>
              )}
            </View>
            {runAnalysisMutation.isPending && (
              <View style={styles.loadingBar}>
                <ActivityIndicator size="small" color="#EF4444" />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Running 4-step analysis with GPT-5.2...</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {analyses.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Previous Analyses</Text>
          {analyses.map((a: DominanceAnalysis) => (
            <Pressable
              key={a.id}
              style={[styles.analysisItem, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => handleSelectAnalysis(a)}
            >
              <View style={styles.compRow}>
                <Ionicons name="document-text" size={18} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[styles.analysisName, { color: colors.text }]}>{a.competitorName}</Text>
                  <Text style={[styles.analysisMeta, { color: colors.textMuted }]}>
                    {new Date(a.createdAt).toLocaleDateString()} {'\u00B7'} {a.modelUsed} {a.runVersion && a.runVersion > 1 ? `\u00B7 v${a.runVersion}` : ''} {'\u00B7'} {a.location || 'Dubai'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <View style={[styles.statusBadge, { backgroundColor: a.status === 'completed' ? '#10B981' + '20' : a.status === 'partial' ? '#F59E0B' + '20' : '#6B7280' + '20' }]}>
                    <Text style={{ color: a.status === 'completed' ? '#10B981' : a.status === 'partial' ? '#F59E0B' : '#6B7280', fontSize: 10, fontWeight: '600' }}>
                      {a.status?.toUpperCase()}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  const renderDissection = () => {
    if (!selectedAnalysis?.contentDissection) {
      return <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No dissection data available</Text>
      </View>;
    }
    const dissection = selectedAnalysis.contentDissection;
    const dissections = dissection?.dissections || [];
    const pattern = dissection?.overallPattern;

    return (
      <View>
        {renderFallbackBanner()}
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="analytics" size={20} color="#3B82F6" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8, flex: 1, marginBottom: 0 }]}>Deep Content Dissection</Text>
          {selectedAnalysis.runVersion && selectedAnalysis.runVersion > 1 && (
            <Text style={{ color: colors.textMuted, fontSize: 10 }}>v{selectedAnalysis.runVersion}</Text>
          )}
        </View>

        {pattern && (
          <View style={[styles.patternCard, { backgroundColor: '#3B82F6' + '10', borderColor: '#3B82F6' + '30' }]}>
            <Text style={[styles.patternLabel, { color: '#3B82F6' }]}>OVERALL PATTERN</Text>
            <Text style={[styles.patternFormula, { color: colors.text }]}>{getConfVal(pattern.contentFormula) || 'N/A'}</Text>
            <View style={styles.patternTags}>
              {pattern.dominantHookType && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={[styles.tag, { backgroundColor: HOOK_COLORS[getConfVal(pattern.dominantHookType)] || '#6B7280' }]}>
                    <Text style={styles.tagText}>Hook: {getConfVal(pattern.dominantHookType)}</Text>
                  </View>
                  <ConfidenceBadge score={getConfScore(pattern.dominantHookType)} />
                </View>
              )}
              {pattern.dominantPsychTrigger && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={[styles.tag, { backgroundColor: '#8B5CF6' }]}><Text style={styles.tagText}>Trigger: {getConfVal(pattern.dominantPsychTrigger)}</Text></View>
                  <ConfidenceBadge score={getConfScore(pattern.dominantPsychTrigger)} />
                </View>
              )}
              {pattern.dominantCTA && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={[styles.tag, { backgroundColor: '#F59E0B' }]}><Text style={styles.tagText}>CTA: {getConfVal(pattern.dominantCTA)}</Text></View>
                  <ConfidenceBadge score={getConfScore(pattern.dominantCTA)} />
                </View>
              )}
            </View>
          </View>
        )}

        {dissections.map((item: any, index: number) => {
          const isExpanded = expandedItem === index;
          const evidence = item.evidence;
          return (
            <Pressable
              key={index}
              style={[styles.dissectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
              onPress={() => setExpandedItem(isExpanded ? null : index)}
            >
              <View style={styles.compRow}>
                <View style={[styles.rankBadge, { backgroundColor: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32' }]}>
                  <Text style={styles.rankText}>#{item.contentRank || index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.dissectionType, { color: colors.text }]}>{(item.contentType || 'content').toUpperCase()}</Text>
                    {evidence && <EvidenceBadge source={evidence.evidenceSource} />}
                    {evidence && <ConfidenceBadge score={evidence.confidenceScore} />}
                  </View>
                  <Text style={[styles.dissectionHook, { color: colors.textSecondary }]}>
                    Hook: {getConfVal(item.hookType)} {'\u00B7'} Trigger: {getConfVal(item.psychologicalTrigger?.primary)}
                  </Text>
                </View>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </View>

              {evidence && isExpanded && (
                <View style={[styles.evidenceCard, { backgroundColor: colors.inputBackground, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.evidenceTitle, { color: colors.primary }]}>EVIDENCE</Text>
                  <Text style={[styles.evidenceReason, { color: colors.textSecondary }]}>{evidence.selectionReason}</Text>
                  <View style={styles.metricsRow}>
                    {evidence.metricsSnapshot?.views != null && <Text style={[styles.metricChip, { color: colors.textMuted }]}>Views: {evidence.metricsSnapshot.views?.toLocaleString()}</Text>}
                    {evidence.metricsSnapshot?.likes != null && <Text style={[styles.metricChip, { color: colors.textMuted }]}>Likes: {evidence.metricsSnapshot.likes?.toLocaleString()}</Text>}
                    {evidence.metricsSnapshot?.comments != null && <Text style={[styles.metricChip, { color: colors.textMuted }]}>Comments: {evidence.metricsSnapshot.comments?.toLocaleString()}</Text>}
                    {evidence.metricsSnapshot?.shares != null && <Text style={[styles.metricChip, { color: colors.textMuted }]}>Shares: {evidence.metricsSnapshot.shares?.toLocaleString()}</Text>}
                    {evidence.metricsSnapshot?.saves != null && <Text style={[styles.metricChip, { color: colors.textMuted }]}>Saves: {evidence.metricsSnapshot.saves?.toLocaleString()}</Text>}
                  </View>
                </View>
              )}

              {isExpanded && (
                <View style={styles.expandedContent}>
                  <View style={styles.metricRow}>
                    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Hook Strength</Text>
                    <View style={[styles.scoreBar, { backgroundColor: colors.inputBackground }]}>
                      <View style={[styles.scoreFill, { width: `${(item.hookType?.strengthScore || 0) * 100}%`, backgroundColor: '#3B82F6' }]} />
                    </View>
                    <Text style={[styles.metricVal, { color: colors.text }]}>{((item.hookType?.strengthScore || 0) * 100).toFixed(0)}%</Text>
                    <ConfidenceBadge score={getConfScore(item.hookType)} />
                  </View>
                  <View style={styles.metricRow}>
                    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Emotional Intensity</Text>
                    <View style={[styles.scoreBar, { backgroundColor: colors.inputBackground }]}>
                      <View style={[styles.scoreFill, { width: `${(item.psychologicalTrigger?.emotionalIntensity || 0) * 100}%`, backgroundColor: '#8B5CF6' }]} />
                    </View>
                    <Text style={[styles.metricVal, { color: colors.text }]}>{((item.psychologicalTrigger?.emotionalIntensity || 0) * 100).toFixed(0)}%</Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.primary }]}>Offer Mechanics</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>Price: {getConfVal(item.offerMechanics?.priceVisibility)}</Text>
                        <ConfidenceBadge score={getConfScore(item.offerMechanics?.priceVisibility)} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Text style={[styles.detailText, { color: colors.textSecondary }]}>Urgency: {getConfVal(item.offerMechanics?.urgencyLevel)}</Text>
                        <ConfidenceBadge score={getConfScore(item.offerMechanics?.urgencyLevel)} />
                      </View>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.primary }]}>CTA Mechanics</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        Type: {getConfVal(item.ctaMechanics?.type)} {'\u00B7'} Placement: {getConfVal(item.ctaMechanics?.placement)} {'\u00B7'} Friction: {getConfVal(item.ctaMechanics?.frictionLevel)}
                      </Text>
                      <ConfidenceBadge score={getConfScore(item.ctaMechanics?.type)} />
                    </View>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>Path: {item.ctaMechanics?.conversionPath || 'N/A'}</Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.primary }]}>Creative Structure</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        Format: {getConfVal(item.creativeStructure?.format)} {'\u00B7'} Pacing: {getConfVal(item.creativeStructure?.pacing)} {'\u00B7'} Framing: {getConfVal(item.creativeStructure?.framingStyle)}
                      </Text>
                      <ConfidenceBadge score={getConfScore(item.creativeStructure?.format)} />
                    </View>
                  </View>

                  {item.performanceDrivers?.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailLabel, { color: colors.primary }]}>Performance Drivers</Text>
                      {item.performanceDrivers.map((d: any, i: number) => (
                        <View key={i} style={styles.driverRow}>
                          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                          <Text style={[styles.driverText, { color: colors.textSecondary }]}>{getConfVal(d)}</Text>
                          <ConfidenceBadge score={getConfScore(d)} />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderWeaknesses = () => {
    if (!selectedAnalysis?.weaknessDetection) {
      return <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No weakness data available</Text>
      </View>;
    }
    const detection = selectedAnalysis.weaknessDetection;
    const weaknesses = detection?.weaknesses || [];
    const globalWeaknesses = detection?.globalWeaknesses || [];
    const vulnScore = detection?.vulnerabilityScore;

    return (
      <View>
        {renderFallbackBanner()}
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="warning" size={20} color="#EF4444" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8, marginBottom: 0 }]}>Weakness Detection</Text>
        </View>

        {vulnScore != null && (
          <View style={[styles.vulnCard, { backgroundColor: '#EF4444' + '10', borderColor: '#EF4444' + '30' }]}>
            <Text style={[styles.vulnLabel, { color: '#EF4444' }]}>VULNERABILITY SCORE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.vulnScore, { color: '#EF4444' }]}>
                {((typeof vulnScore === 'object' ? vulnScore.value : vulnScore) * 100).toFixed(0)}%
              </Text>
              <ConfidenceBadge score={typeof vulnScore === 'object' ? vulnScore.confidence : -1} />
            </View>
            <Text style={[styles.vulnOpp, { color: colors.text }]}>{getConfVal(detection.biggestOpportunity)}</Text>
          </View>
        )}

        {weaknesses.map((w: any, index: number) => (
          <View key={index} style={[styles.weaknessCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.weaknessHeader}>
              <View style={[styles.rankBadge, { backgroundColor: SEVERITY_COLORS[getConfVal(w.weaknessNotAddressed?.severity)] || '#6B7280' }]}>
                <Text style={styles.rankText}>#{w.contentRank || index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.weaknessTitle, { color: colors.text }]}>{getConfVal(w.strengthExploited)}</Text>
                  <ConfidenceBadge score={getConfScore(w.strengthExploited)} />
                </View>
                <View style={[styles.catBadge, { backgroundColor: (SEVERITY_COLORS[getConfVal(w.weaknessNotAddressed?.severity)] || '#6B7280') + '20' }]}>
                  <Text style={{ color: SEVERITY_COLORS[getConfVal(w.weaknessNotAddressed?.severity)] || '#6B7280', fontSize: 10, fontWeight: '700' }}>
                    {(getConfVal(w.weaknessNotAddressed?.severity) || 'unknown').toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.weaknessSection, { borderLeftColor: '#EF4444' }]}>
              <Text style={[styles.weaknessSectionLabel, { color: '#EF4444' }]}>WEAKNESS</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                <Text style={[styles.weaknessSectionText, { color: colors.textSecondary, flex: 1 }]}>
                  {getConfVal(w.weaknessNotAddressed)}
                </Text>
                <ConfidenceBadge score={getConfScore(w.weaknessNotAddressed)} />
              </View>
              <Text style={[styles.weaknessCat, { color: colors.textMuted }]}>
                Category: {(getConfVal(w.weaknessNotAddressed?.category) || 'unknown').replace(/_/g, ' ')}
              </Text>
            </View>

            <View style={[styles.weaknessSection, { borderLeftColor: '#10B981' }]}>
              <Text style={[styles.weaknessSectionLabel, { color: '#10B981' }]}>OPPORTUNITY</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                <Text style={[styles.weaknessSectionText, { color: colors.textSecondary, flex: 1 }]}>
                  {getConfVal(w.opportunityVector)}
                </Text>
                <ConfidenceBadge score={getConfScore(w.opportunityVector)} />
              </View>
              <View style={styles.oppMeta}>
                <Text style={[styles.oppMetaText, { color: IMPACT_COLORS[getConfVal(w.opportunityVector?.expectedImpact)] || '#6B7280' }]}>
                  Impact: {getConfVal(w.opportunityVector?.expectedImpact) || 'unknown'}
                </Text>
                <Text style={[styles.oppMetaText, { color: colors.textMuted }]}>
                  Difficulty: {getConfVal(w.opportunityVector?.implementationDifficulty) || 'unknown'}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {globalWeaknesses.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.globalWeaknessTitle, { color: colors.text }]}>Global Weakness Patterns</Text>
            {globalWeaknesses.map((gw: any, i: number) => (
              <View key={i} style={[styles.globalWeaknessCard, { backgroundColor: '#EF4444' + '08', borderColor: '#EF4444' + '20' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.gwPattern, { color: '#EF4444' }]}>{getConfVal(gw.pattern)}</Text>
                  <ConfidenceBadge score={getConfScore(gw.pattern)} />
                </View>
                <Text style={[styles.gwDesc, { color: colors.textSecondary }]}>{gw.description || 'N/A'}</Text>
                <Text style={[styles.gwExploit, { color: colors.primary }]}>Exploit: {gw.exploitStrategy || 'N/A'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderStrategy = () => {
    if (!selectedAnalysis?.dominanceStrategy) {
      return <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No dominance strategy available</Text>
      </View>;
    }
    const strategy = selectedAnalysis.dominanceStrategy;
    const variants = strategy?.upgradedVariants || [];
    const playbook = strategy?.overallDominancePlaybook;

    return (
      <View>
        {renderFallbackBanner()}
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="rocket" size={20} color="#8B5CF6" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8, marginBottom: 0 }]}>Dominance Strategy</Text>
        </View>

        {playbook && (
          <View style={[styles.playbookCard, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
            <Text style={[styles.playbookLabel, { color: '#8B5CF6' }]}>DOMINANCE PLAYBOOK</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.playbookPrimary, { color: colors.text, flex: 1 }]}>{getConfVal(playbook.primaryStrategy)}</Text>
              <ConfidenceBadge score={getConfScore(playbook.primaryStrategy)} />
            </View>
            {playbook.keyDifferentiators?.length > 0 && (
              <View style={styles.diffTags}>
                {playbook.keyDifferentiators.map((d: any, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <View style={[styles.tag, { backgroundColor: '#8B5CF6' }]}><Text style={styles.tagText}>{getConfVal(d)}</Text></View>
                    <ConfidenceBadge score={getConfScore(d)} />
                  </View>
                ))}
              </View>
            )}
            {playbook.expectedOutcomeRange && (
              <Text style={[styles.outcomeText, { color: colors.textSecondary }]}>
                Expected: {playbook.expectedOutcomeRange.conservative || '?'} to {playbook.expectedOutcomeRange.optimistic || '?'}
              </Text>
            )}
          </View>
        )}

        {variants.map((v: any, index: number) => (
          <View key={index} style={[styles.variantCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Text style={[styles.variantTitle, { color: colors.text, marginBottom: 0 }]}>Variant #{v.targetContentRank || index + 1}</Text>
              <ConfidenceBadge score={getConfScore(v.originalStrength)} />
            </View>
            <Text style={[styles.variantOriginal, { color: colors.textMuted }]}>Original: {getConfVal(v.originalStrength)}</Text>
            {v.superiorityStatement && (
              <View style={[styles.superiorityBanner, { backgroundColor: '#10B981' + '10', borderColor: '#10B981' + '30' }]}>
                <Ionicons name="trophy" size={14} color="#10B981" />
                <Text style={[styles.superiorityText, { color: '#10B981' }]}>{v.superiorityStatement}</Text>
              </View>
            )}

            {v.upgradedHookLogic && (
              <View style={styles.upgradeSection}>
                <View style={styles.upgradeRow}>
                  <View style={[styles.upgradeLabel, { backgroundColor: '#EF4444' + '15' }]}>
                    <Ionicons name="close-circle" size={12} color="#EF4444" />
                    <Text style={[styles.upgradeLabelText, { color: '#EF4444' }]}>ORIGINAL HOOK</Text>
                  </View>
                  <Text style={[styles.upgradeText, { color: colors.textSecondary }]}>{v.upgradedHookLogic.original || 'N/A'}</Text>
                </View>
                <View style={styles.upgradeRow}>
                  <View style={[styles.upgradeLabel, { backgroundColor: '#10B981' + '15' }]}>
                    <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                    <Text style={[styles.upgradeLabelText, { color: '#10B981' }]}>UPGRADED HOOK</Text>
                  </View>
                  <Text style={[styles.upgradeText, { color: colors.text }]}>{v.upgradedHookLogic.upgraded || 'N/A'}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.whyBetter, { color: '#3B82F6' }]}>Why: {getConfVal(v.upgradedHookLogic.whyBetter)}</Text>
                  <ConfidenceBadge score={getConfScore(v.upgradedHookLogic.whyBetter)} />
                </View>
              </View>
            )}

            {v.strongerConversionMechanics && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>Conversion Mechanics</Text>
                <Text style={[styles.upgradeCompare, { color: colors.textMuted }]}>Before: {v.strongerConversionMechanics.original || 'N/A'}</Text>
                <Text style={[styles.upgradeCompare, { color: colors.text }]}>After: {v.strongerConversionMechanics.upgraded || 'N/A'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.liftText, { color: '#10B981' }]}>Expected lift: {getConfVal(v.strongerConversionMechanics.expectedLift)}</Text>
                  <ConfidenceBadge score={getConfScore(v.strongerConversionMechanics.expectedLift)} />
                </View>
              </View>
            )}

            {v.ctaOptimization && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>CTA Optimization</Text>
                <Text style={[styles.upgradeCompare, { color: colors.textMuted }]}>Before: {v.ctaOptimization.original || 'N/A'}</Text>
                <Text style={[styles.upgradeCompare, { color: colors.text }]}>After: {v.ctaOptimization.upgraded || 'N/A'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: '#3B82F6', fontSize: 11 }}>Friction reduction: {getConfVal(v.ctaOptimization.frictionReduction)}</Text>
                  <ConfidenceBadge score={getConfScore(v.ctaOptimization.frictionReduction)} />
                </View>
              </View>
            )}

            {v.structuralUpgrades?.length > 0 && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>Structural Upgrades</Text>
                {v.structuralUpgrades.map((su: any, i: number) => (
                  <View key={i} style={styles.structUpgrade}>
                    <Text style={[styles.structTiming, { color: '#F59E0B' }]}>{su.timing || '?'}</Text>
                    <Text style={[styles.structAction, { color: colors.text }]}>{su.action || 'N/A'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={[styles.structReason, { color: colors.textMuted }]}>{getConfVal(su.reason)}</Text>
                      <ConfidenceBadge score={getConfScore(su.reason)} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}

        {playbook?.implementationPriority?.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <Text style={[styles.globalWeaknessTitle, { color: colors.text }]}>Implementation Priority</Text>
            {playbook.implementationPriority.map((ip: any, i: number) => (
              <View key={i} style={[styles.priorityItem, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.compRow}>
                  <View style={[styles.impactDot, { backgroundColor: IMPACT_COLORS[ip.impact] || '#6B7280' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.priorityAction, { color: colors.text }]}>{ip.action || 'N/A'}</Text>
                    <Text style={[styles.priorityMeta, { color: colors.textMuted }]}>
                      Impact: {ip.impact || '?'} | Effort: {ip.effort || '?'} | {ip.timeline || '?'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={[styles.genModsBtn, { backgroundColor: '#EF4444' }]}
          onPress={() => selectedAnalysis && generateModsMutation.mutate(selectedAnalysis.id)}
          disabled={generateModsMutation.isPending}
        >
          {generateModsMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="git-compare" size={18} color="#fff" />
              <Text style={styles.genModsBtnText}>Generate Plan Modifications</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  };

  const renderDelta = () => {
    if (!selectedAnalysis?.dominanceDelta) {
      return <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Ionicons name="trending-up" size={40} color={colors.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No Dominance Delta data available</Text>
        <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Run analysis first to compute how our approach is categorically superior.</Text>
      </View>;
    }
    const delta = selectedAnalysis.dominanceDelta;
    const deltas = delta?.deltas || [];
    const overallScore = delta?.overallDominanceScore;

    return (
      <View>
        {renderFallbackBanner()}
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="trending-up" size={20} color="#10B981" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8, marginBottom: 0 }]}>Dominance Delta</Text>
        </View>

        {overallScore && (
          <View style={[styles.deltaScoreCard, { backgroundColor: '#10B981' + '10', borderColor: '#10B981' + '30' }]}>
            <Text style={[styles.deltaScoreLabel, { color: '#10B981' }]}>OVERALL DOMINANCE SCORE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
              <Text style={[styles.deltaScoreVal, { color: '#10B981' }]}>
                {((typeof overallScore === 'object' ? overallScore.value : overallScore) * 100).toFixed(0)}%
              </Text>
              <ConfidenceBadge score={typeof overallScore === 'object' ? overallScore.confidence : -1} />
            </View>
            {delta.dominanceSummary && (
              <Text style={[styles.deltaSummary, { color: colors.text }]}>{delta.dominanceSummary}</Text>
            )}
          </View>
        )}

        {deltas.map((d: any, index: number) => (
          <View key={index} style={[styles.deltaCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <View style={[styles.rankBadge, { backgroundColor: '#10B981' }]}>
                <Text style={styles.rankText}>#{d.targetContentRank || index + 1}</Text>
              </View>
              <Text style={[styles.deltaCardTitle, { color: colors.text }]}>Content Delta</Text>
            </View>

            <View style={[styles.deltaSection, { borderLeftColor: '#3B82F6' }]}>
              <Text style={[styles.deltaSectionLabel, { color: '#3B82F6' }]}>COMPETITOR STRENGTH</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                <Text style={[styles.deltaSectionText, { color: colors.textSecondary, flex: 1 }]}>{getConfVal(d.competitorStrength)}</Text>
                <ConfidenceBadge score={getConfScore(d.competitorStrength)} />
              </View>
            </View>

            <View style={[styles.deltaSection, { borderLeftColor: '#EF4444' }]}>
              <Text style={[styles.deltaSectionLabel, { color: '#EF4444' }]}>COMPETITOR GAP</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                <Text style={[styles.deltaSectionText, { color: colors.textSecondary, flex: 1 }]}>{getConfVal(d.competitorGap)}</Text>
                <ConfidenceBadge score={getConfScore(d.competitorGap)} />
              </View>
            </View>

            <View style={[styles.deltaSection, { borderLeftColor: '#10B981' }]}>
              <Text style={[styles.deltaSectionLabel, { color: '#10B981' }]}>DOMINANCE UPGRADE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                <Text style={[styles.deltaSectionText, { color: colors.text, flex: 1, fontWeight: '600' }]}>{getConfVal(d.dominanceUpgrade)}</Text>
                <ConfidenceBadge score={getConfScore(d.dominanceUpgrade)} />
              </View>
            </View>

            {d.implementationSteps?.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={[styles.deltaSectionLabel, { color: colors.primary }]}>IMPLEMENTATION STEPS</Text>
                {d.implementationSteps.map((step: any, i: number) => (
                  <View key={i} style={styles.implStep}>
                    <View style={[styles.implPriority, { backgroundColor: (step.priority === 'critical' ? '#EF4444' : step.priority === 'high' ? '#F59E0B' : '#3B82F6') + '15' }]}>
                      <Text style={{ color: step.priority === 'critical' ? '#EF4444' : step.priority === 'high' ? '#F59E0B' : '#3B82F6', fontSize: 9, fontWeight: '700' }}>
                        {(step.priority || 'medium').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={[styles.implStepText, { color: colors.textSecondary }]}>{step.step}</Text>
                    <View style={[styles.implCat, { backgroundColor: colors.inputBackground }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 8, fontWeight: '600' }}>{(step.category || '').toUpperCase()}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {d.superiorityProof && (
              <View style={[styles.proofBanner, { backgroundColor: '#10B981' + '10', borderColor: '#10B981' + '30' }]}>
                <Ionicons name="shield-checkmark" size={14} color="#10B981" />
                <Text style={[styles.proofText, { color: '#10B981' }]}>{d.superiorityProof}</Text>
              </View>
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderModifications = () => {
    const latestMod = modifications.length > 0 ? modifications[0] : null;

    if (!latestMod) {
      return (
        <View>
          {renderFallbackBanner()}
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="git-compare-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No plan modifications generated yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              Go to the Dominance tab and generate modifications from the strategy analysis.
            </Text>
          </View>
        </View>
      );
    }

    const adjustments = latestMod.adjustments || [];

    return (
      <View>
        {renderFallbackBanner()}
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="git-compare" size={20} color="#EF4444" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8, flex: 1, marginBottom: 0 }]}>Plan Modifications</Text>
          <LifecycleBadge status={latestMod.lifecycleStatus} />
        </View>

        <View style={[styles.modSummaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.modSummaryRow}>
            <Text style={[styles.modSummaryLabel, { color: colors.textMuted }]}>TARGET</Text>
            <Text style={[styles.modSummaryText, { color: colors.text }]}>{latestMod.competitorTargeted || 'Unknown'}</Text>
          </View>
          {latestMod.overallImpact && (
            <View style={[styles.impactAssessment, { backgroundColor: colors.inputBackground }]}>
              <Text style={[styles.impactLabel, { color: colors.textMuted }]}>
                Risk: {getConfVal(latestMod.overallImpact.riskLevel)} | Confidence: {((latestMod.overallImpact.confidenceScore || 0) * 100).toFixed(0)}%
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.impactLift, { color: '#10B981' }]}>{getConfVal(latestMod.overallImpact.expectedLift)}</Text>
                <ConfidenceBadge score={getConfScore(latestMod.overallImpact.expectedLift)} />
              </View>
            </View>
          )}
          {latestMod.fallbackUsed && (
            <View style={[styles.modFallbackNote, { backgroundColor: '#F59E0B' + '10' }]}>
              <Ionicons name="alert-circle" size={12} color="#F59E0B" />
              <Text style={{ color: '#F59E0B', fontSize: 10, flex: 1 }}>Generated with fallback data — review carefully</Text>
            </View>
          )}
        </View>

        <Text style={[styles.adjustmentsTitle, { color: colors.text }]}>Adjustments ({adjustments.length})</Text>
        {adjustments.map((adj: any, i: number) => (
          <View key={i} style={[styles.adjustmentCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.adjHeader}>
              <View style={[styles.impactBadge, { backgroundColor: (IMPACT_COLORS[adj.impactLevel] || '#6B7280') + '20' }]}>
                <Text style={{ color: IMPACT_COLORS[adj.impactLevel] || '#6B7280', fontSize: 10, fontWeight: '700' }}>
                  {(adj.impactLevel || 'unknown').toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.adjSection, { color: colors.text }]}>{(adj.section || 'general').replace(/_/g, ' ').toUpperCase()}</Text>
              <ConfidenceBadge score={getConfScore(adj.reason)} />
            </View>

            <View style={[styles.compareBlock, { borderLeftColor: '#EF4444' }]}>
              <Text style={[styles.compareLabel, { color: '#EF4444' }]}>ORIGINAL</Text>
              <Text style={[styles.compareText, { color: colors.textSecondary }]}>
                {typeof adj.originalValue === 'object' ? JSON.stringify(adj.originalValue, null, 2) : (adj.originalValue || 'N/A')}
              </Text>
            </View>
            <View style={[styles.compareBlock, { borderLeftColor: '#10B981' }]}>
              <Text style={[styles.compareLabel, { color: '#10B981' }]}>ADJUSTED</Text>
              <Text style={[styles.compareText, { color: colors.text }]}>
                {typeof adj.adjustedValue === 'object' ? JSON.stringify(adj.adjustedValue, null, 2) : (adj.adjustedValue || 'N/A')}
              </Text>
            </View>
            <Text style={[styles.adjReason, { color: colors.textMuted }]}>{getConfVal(adj.reason)}</Text>
            {adj.competitiveAdvantage && (
              <Text style={[styles.adjAdvantage, { color: '#10B981' }]}>Advantage: {adj.competitiveAdvantage}</Text>
            )}
            {adj.diffSummary && (
              <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>Diff: {adj.diffSummary}</Text>
            )}
          </View>
        ))}

        {latestMod.lifecycleStatus === 'REVIEW_REQUIRED' && (
          <View style={styles.approvalSection}>
            <Text style={[styles.approvalNote, { color: colors.textSecondary }]}>
              These modifications require your explicit approval before they can be applied.
            </Text>
            <View style={styles.approvalBtns}>
              <Pressable
                style={[styles.approveBtn, { backgroundColor: '#10B981' }]}
                onPress={() => approveModMutation.mutate(latestMod.id)}
                disabled={approveModMutation.isPending}
              >
                {approveModMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={styles.approveBtnText}>Approve</Text></>
                )}
              </Pressable>
              <Pressable
                style={[styles.rejectBtn, { backgroundColor: '#EF4444' }]}
                onPress={() => rejectModMutation.mutate(latestMod.id)}
                disabled={rejectModMutation.isPending}
              >
                {rejectModMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="close-circle" size={18} color="#fff" /><Text style={styles.approveBtnText}>Reject</Text></>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {latestMod.lifecycleStatus === 'APPROVED' && (
          <View style={styles.approvalSection}>
            <View style={[styles.statusBanner, { backgroundColor: '#3B82F6' + '15', borderColor: '#3B82F6' + '40' }]}>
              <Ionicons name="checkmark-circle" size={20} color="#3B82F6" />
              <Text style={[styles.statusBannerText, { color: '#3B82F6' }]}>Approved — ready to apply</Text>
            </View>
            <Pressable
              style={[styles.approveBtn, { backgroundColor: '#10B981', marginTop: 8 }]}
              onPress={() => applyModMutation.mutate(latestMod.id)}
              disabled={applyModMutation.isPending}
            >
              {applyModMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                <><Ionicons name="rocket" size={18} color="#fff" /><Text style={styles.approveBtnText}>Apply to Plan</Text></>
              )}
            </Pressable>
          </View>
        )}

        {latestMod.lifecycleStatus === 'APPLIED' && (
          <View style={styles.approvalSection}>
            <View style={[styles.statusBanner, { backgroundColor: '#10B981' + '15', borderColor: '#10B981' + '40' }]}>
              <Ionicons name="checkmark-done-circle" size={20} color="#10B981" />
              <Text style={[styles.statusBannerText, { color: '#10B981' }]}>Modifications applied to plan</Text>
            </View>
            {latestMod.rollbackAvailable && (
              <Pressable
                style={[styles.rejectBtn, { backgroundColor: '#F59E0B', marginTop: 8 }]}
                onPress={() => {
                  Alert.alert('Rollback', 'Are you sure? This will restore the previous plan version.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Rollback', style: 'destructive', onPress: () => rollbackModMutation.mutate(latestMod.id) },
                  ]);
                }}
                disabled={rollbackModMutation.isPending}
              >
                {rollbackModMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="arrow-undo" size={18} color="#fff" /><Text style={styles.approveBtnText}>Rollback to Previous Plan</Text></>
                )}
              </Pressable>
            )}
          </View>
        )}

        {latestMod.lifecycleStatus === 'REJECTED' && (
          <View style={[styles.statusBanner, { backgroundColor: '#EF4444' + '15', borderColor: '#EF4444' + '40', marginTop: 12 }]}>
            <Ionicons name="close-circle" size={20} color="#EF4444" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusBannerText, { color: '#EF4444' }]}>Modifications rejected</Text>
              {latestMod.rejectedReason && (
                <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{latestMod.rejectedReason}</Text>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      {renderNavTabs()}
      {activeView === 'select' && renderCompetitorSelect()}
      {activeView === 'dissection' && renderDissection()}
      {activeView === 'weaknesses' && renderWeaknesses()}
      {activeView === 'strategy' && renderStrategy()}
      {activeView === 'delta' && renderDelta()}
      {activeView === 'modifications' && renderModifications()}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  navContainer: { flexDirection: 'row', marginBottom: 16, maxHeight: 40 },
  navTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'transparent', marginRight: 8, gap: 4 },
  navText: { fontSize: 12, fontWeight: '600' },
  headerCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 13, lineHeight: 18 },
  gateCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16, alignItems: 'center', gap: 8 },
  gateTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  gateSub: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  emptyCard: { padding: 30, borderRadius: 12, borderWidth: 1, alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  emptySubtext: { fontSize: 12, textAlign: 'center' },
  competitorCard: { padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  compName: { fontSize: 15, fontWeight: '600' },
  compPlatform: { fontSize: 12, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  loadingBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  loadingText: { fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  analysisItem: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  analysisName: { fontSize: 14, fontWeight: '600' },
  analysisMeta: { fontSize: 11, marginTop: 2 },
  patternCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  patternLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  patternFormula: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  patternTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  tagText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  dissectionCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  dissectionType: { fontSize: 13, fontWeight: '700' },
  dissectionHook: { fontSize: 11, marginTop: 2 },
  evidenceCard: { marginTop: 10, padding: 10, borderRadius: 8, borderWidth: 1 },
  evidenceTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  evidenceReason: { fontSize: 11, lineHeight: 16, marginBottom: 6 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricChip: { fontSize: 10 },
  expandedContent: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  metricLabel: { fontSize: 11, width: 110 },
  scoreBar: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 3 },
  metricVal: { fontSize: 11, fontWeight: '700', width: 32, textAlign: 'right' },
  detailSection: { marginTop: 10 },
  detailLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  detailText: { fontSize: 12, lineHeight: 17 },
  driverRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  driverText: { fontSize: 12, flex: 1 },
  fallbackBannerLarge: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  fbRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  fbTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  fbReason: { fontSize: 11, lineHeight: 16 },
  fbActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  fbBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, flex: 1, justifyContent: 'center' },
  fbBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  fbAcked: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 6, marginTop: 10 },
  vulnCard: { padding: 16, borderRadius: 10, borderWidth: 1, marginBottom: 12, alignItems: 'center' },
  vulnLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  vulnScore: { fontSize: 36, fontWeight: '800', marginVertical: 4 },
  vulnOpp: { fontSize: 13, textAlign: 'center', fontWeight: '500' },
  weaknessCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  weaknessHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  weaknessTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start', marginTop: 4 },
  weaknessSection: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 10 },
  weaknessSectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  weaknessSectionText: { fontSize: 12, lineHeight: 17 },
  weaknessCat: { fontSize: 10, marginTop: 4 },
  oppMeta: { flexDirection: 'row', gap: 16, marginTop: 4 },
  oppMetaText: { fontSize: 10, fontWeight: '600' },
  globalWeaknessTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  globalWeaknessCard: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 8 },
  gwPattern: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  gwDesc: { fontSize: 12, marginBottom: 4 },
  gwExploit: { fontSize: 11, fontWeight: '600' },
  playbookCard: { padding: 16, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  playbookLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  playbookPrimary: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  diffTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  outcomeText: { fontSize: 12 },
  variantCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  variantTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  variantOriginal: { fontSize: 12, marginBottom: 10 },
  superiorityBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 10 },
  superiorityText: { fontSize: 12, fontWeight: '600', flex: 1 },
  upgradeSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E5E7EB' },
  upgradeRow: { marginBottom: 6 },
  upgradeLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start', marginBottom: 4 },
  upgradeLabelText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  upgradeText: { fontSize: 12, lineHeight: 17 },
  whyBetter: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  upgradeSectionTitle: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  upgradeCompare: { fontSize: 12, lineHeight: 17 },
  liftText: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  structUpgrade: { marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#F59E0B' },
  structTiming: { fontSize: 10, fontWeight: '700' },
  structAction: { fontSize: 12, marginTop: 2 },
  structReason: { fontSize: 11, marginTop: 2 },
  genModsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10, marginTop: 16 },
  genModsBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  priorityItem: { padding: 12, borderRadius: 8, borderWidth: 1, marginBottom: 6 },
  priorityAction: { fontSize: 13, fontWeight: '600' },
  priorityMeta: { fontSize: 11, marginTop: 2 },
  impactDot: { width: 8, height: 8, borderRadius: 4 },
  deltaScoreCard: { padding: 16, borderRadius: 10, borderWidth: 1, marginBottom: 12, alignItems: 'center' },
  deltaScoreLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  deltaScoreVal: { fontSize: 36, fontWeight: '800', marginVertical: 4 },
  deltaSummary: { fontSize: 13, textAlign: 'center', fontWeight: '500', marginTop: 4 },
  deltaCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  deltaCardTitle: { fontSize: 14, fontWeight: '700' },
  deltaSection: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 10 },
  deltaSectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  deltaSectionText: { fontSize: 12, lineHeight: 17 },
  implStep: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  implPriority: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  implStepText: { fontSize: 11, flex: 1 },
  implCat: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  proofBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, marginTop: 10 },
  proofText: { fontSize: 12, fontWeight: '600', flex: 1 },
  modSummaryCard: { padding: 16, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  modSummaryRow: { paddingVertical: 8 },
  modSummaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  modSummaryText: { fontSize: 13 },
  modFallbackNote: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 6, marginTop: 8 },
  impactAssessment: { padding: 10, borderRadius: 8, marginTop: 8 },
  impactLabel: { fontSize: 11 },
  impactLift: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  adjustmentsTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  adjustmentCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  adjHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  impactBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  adjSection: { fontSize: 12, fontWeight: '700', flex: 1 },
  compareBlock: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 8 },
  compareLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  compareText: { fontSize: 12, lineHeight: 17 },
  adjReason: { fontSize: 11, marginTop: 4 },
  adjAdvantage: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  approvalSection: { marginTop: 16 },
  approvalNote: { fontSize: 12, textAlign: 'center', marginBottom: 12 },
  approvalBtns: { gap: 10 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10 },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10 },
  approveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  statusBannerText: { fontSize: 13, fontWeight: '600' },
});
