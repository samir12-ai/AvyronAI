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
  topContent: any[] | null;
  contentDissection: any | null;
  weaknessDetection: any | null;
  dominanceStrategy: any | null;
  planModifications: any | null;
  modificationStatus: string;
  modelUsed: string;
  status: string;
  createdAt: string;
}

type DominanceView = 'select' | 'dissection' | 'weaknesses' | 'strategy' | 'modifications';

const HOOK_COLORS: Record<string, string> = {
  question: '#3B82F6',
  promise: '#10B981',
  shock: '#EF4444',
  number: '#F59E0B',
  authority: '#8B5CF6',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: '#10B981',
  medium: '#F59E0B',
  high: '#EF4444',
  critical: '#DC2626',
};

const IMPACT_COLORS: Record<string, string> = {
  low: '#6B7280',
  medium: '#3B82F6',
  high: '#10B981',
  critical: '#EF4444',
};

export default function DominanceEngine() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const queryClient = useQueryClient();
  const baseUrl = getApiUrl();

  const [activeView, setActiveView] = useState<DominanceView>('select');
  const [selectedAnalysis, setSelectedAnalysis] = useState<DominanceAnalysis | null>(null);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);

  const { data: competitorsData, isLoading: loadingCompetitors } = useQuery({
    queryKey: ['ci-competitors'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/ci/competitors?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const { data: analysesData, isLoading: loadingAnalyses, refetch: refetchAnalyses } = useQuery({
    queryKey: ['dominance-analyses'],
    queryFn: async () => {
      const res = await fetch(new URL('/api/dominance/analyses?accountId=default', baseUrl).toString());
      return res.json();
    },
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async (competitorId: string) => {
      const res = await fetch(new URL('/api/dominance/analyze', baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', competitorId }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.analysis) {
        setSelectedAnalysis(data.analysis);
        setActiveView('dissection');
      }
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => {
      Alert.alert('Analysis Failed', err.message);
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', basePlan }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: (data) => {
      if (selectedAnalysis) {
        setSelectedAnalysis({ ...selectedAnalysis, planModifications: data.modifications, modificationStatus: 'pending_approval' });
        setActiveView('modifications');
      }
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
    },
    onError: (err: any) => Alert.alert('Error', err.message),
  });

  const approveModsMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const res = await fetch(new URL(`/api/dominance/${analysisId}/approve-modifications`, baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      if (selectedAnalysis) setSelectedAnalysis({ ...selectedAnalysis, modificationStatus: 'approved' });
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Approved', 'Dominance modifications have been approved and will be applied to your plan.');
    },
  });

  const rejectModsMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      const res = await fetch(new URL(`/api/dominance/${analysisId}/reject-modifications`, baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: 'default', reason: 'User rejected modifications' }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
      return res.json();
    },
    onSuccess: () => {
      if (selectedAnalysis) setSelectedAnalysis({ ...selectedAnalysis, modificationStatus: 'rejected' });
      queryClient.invalidateQueries({ queryKey: ['dominance-analyses'] });
      Alert.alert('Rejected', 'Modifications rejected. Base plan remains unchanged.');
    },
  });

  const competitors = competitorsData?.competitors || [];
  const analyses: DominanceAnalysis[] = analysesData?.analyses || [];

  const handleSelectAnalysis = useCallback((analysis: DominanceAnalysis) => {
    setSelectedAnalysis(analysis);
    setActiveView('dissection');
    setExpandedItem(null);
  }, []);

  const renderNavTabs = () => {
    if (!selectedAnalysis) return null;
    const tabs: { key: DominanceView; label: string; icon: string }[] = [
      { key: 'dissection', label: 'Dissection', icon: 'analytics' },
      { key: 'weaknesses', label: 'Weaknesses', icon: 'warning' },
      { key: 'strategy', label: 'Dominance', icon: 'rocket' },
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Competitive Dominance Engine</Text>
        </View>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
          Deep content dissection, weakness detection, and dominance strategy generation. Not imitation — controlled strategic superiority.
        </Text>
      </View>

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
                <Text style={[styles.compPlatform, { color: colors.textSecondary }]}>{comp.platform} • {comp.businessType}</Text>
              </View>
              {existing ? (
                <View style={[styles.statusBadge, { backgroundColor: existing.status === 'completed' ? '#10B981' + '20' : '#F59E0B' + '20' }]}>
                  <Text style={{ color: existing.status === 'completed' ? '#10B981' : '#F59E0B', fontSize: 11, fontWeight: '600' }}>
                    {existing.status === 'completed' ? 'Analyzed' : existing.status}
                  </Text>
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
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Running deep content analysis with GPT-5.2...</Text>
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
                    {new Date(a.createdAt).toLocaleDateString()} • {a.modelUsed}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="analytics" size={20} color="#3B82F6" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>Deep Content Dissection — {selectedAnalysis.competitorName}</Text>
        </View>

        {pattern && (
          <View style={[styles.patternCard, { backgroundColor: '#3B82F6' + '10', borderColor: '#3B82F6' + '30' }]}>
            <Text style={[styles.patternLabel, { color: '#3B82F6' }]}>OVERALL PATTERN</Text>
            <Text style={[styles.patternFormula, { color: colors.text }]}>{pattern.contentFormula || 'N/A'}</Text>
            <View style={styles.patternTags}>
              {pattern.dominantHookType && <View style={[styles.tag, { backgroundColor: HOOK_COLORS[pattern.dominantHookType] || '#6B7280' }]}><Text style={styles.tagText}>Hook: {pattern.dominantHookType}</Text></View>}
              {pattern.dominantPsychTrigger && <View style={[styles.tag, { backgroundColor: '#8B5CF6' }]}><Text style={styles.tagText}>Trigger: {pattern.dominantPsychTrigger}</Text></View>}
              {pattern.dominantCTA && <View style={[styles.tag, { backgroundColor: '#F59E0B' }]}><Text style={styles.tagText}>CTA: {pattern.dominantCTA}</Text></View>}
            </View>
          </View>
        )}

        {dissections.map((item: any, index: number) => {
          const isExpanded = expandedItem === index;
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
                  <Text style={[styles.dissectionType, { color: colors.text }]}>{(item.contentType || 'content').toUpperCase()}</Text>
                  <Text style={[styles.dissectionHook, { color: colors.textSecondary }]}>
                    Hook: {item.hookType?.primary || 'unknown'} • Trigger: {item.psychologicalTrigger?.primary || 'unknown'}
                  </Text>
                </View>
                <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </View>

              {isExpanded && (
                <View style={styles.expandedContent}>
                  <View style={styles.metricRow}>
                    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>Hook Strength</Text>
                    <View style={[styles.scoreBar, { backgroundColor: colors.inputBackground }]}>
                      <View style={[styles.scoreFill, { width: `${(item.hookType?.strengthScore || 0) * 100}%`, backgroundColor: '#3B82F6' }]} />
                    </View>
                    <Text style={[styles.metricVal, { color: colors.text }]}>{((item.hookType?.strengthScore || 0) * 100).toFixed(0)}%</Text>
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
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      Price: {item.offerMechanics?.priceVisibility || 'N/A'} | Urgency: {item.offerMechanics?.urgencyLevel || 'N/A'} | Proof: {item.offerMechanics?.socialProofType || 'N/A'}
                    </Text>
                    {item.offerMechanics?.scarcitySignals?.length > 0 && (
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>Scarcity: {item.offerMechanics.scarcitySignals.join(', ')}</Text>
                    )}
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.primary }]}>CTA Mechanics</Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      Type: {item.ctaMechanics?.type || 'N/A'} | Placement: {item.ctaMechanics?.placement || 'N/A'} | Friction: {item.ctaMechanics?.frictionLevel || 'N/A'}
                    </Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>Path: {item.ctaMechanics?.conversionPath || 'N/A'}</Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={[styles.detailLabel, { color: colors.primary }]}>Creative Structure</Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      Format: {item.creativeStructure?.format || 'N/A'} | Pacing: {item.creativeStructure?.pacing || 'N/A'} | Framing: {item.creativeStructure?.framingStyle || 'N/A'}
                    </Text>
                  </View>

                  {item.performanceDrivers?.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={[styles.detailLabel, { color: colors.primary }]}>Performance Drivers</Text>
                      {item.performanceDrivers.map((d: string, i: number) => (
                        <View key={i} style={styles.driverRow}>
                          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                          <Text style={[styles.driverText, { color: colors.textSecondary }]}>{d}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
        {dissection._fallback && (
          <View style={[styles.fallbackBanner, { backgroundColor: '#F59E0B' + '15', borderColor: '#F59E0B' + '40' }]}>
            <Ionicons name="alert-circle" size={16} color="#F59E0B" />
            <Text style={[styles.fallbackText, { color: '#F59E0B' }]}>AI analysis unavailable — showing fallback data. Manual review recommended.</Text>
          </View>
        )}
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

    return (
      <View>
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="warning" size={20} color="#EF4444" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>Weakness Detection — {selectedAnalysis.competitorName}</Text>
        </View>

        {detection.vulnerabilityScore != null && (
          <View style={[styles.vulnCard, { backgroundColor: '#EF4444' + '10', borderColor: '#EF4444' + '30' }]}>
            <Text style={[styles.vulnLabel, { color: '#EF4444' }]}>VULNERABILITY SCORE</Text>
            <Text style={[styles.vulnScore, { color: '#EF4444' }]}>{(detection.vulnerabilityScore * 100).toFixed(0)}%</Text>
            <Text style={[styles.vulnOpp, { color: colors.text }]}>{detection.biggestOpportunity || 'No opportunity identified'}</Text>
          </View>
        )}

        {weaknesses.map((w: any, index: number) => (
          <View key={index} style={[styles.weaknessCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.weaknessHeader}>
              <View style={[styles.rankBadge, { backgroundColor: SEVERITY_COLORS[w.weaknessNotAddressed?.severity] || '#6B7280' }]}>
                <Text style={styles.rankText}>#{w.contentRank || index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.weaknessTitle, { color: colors.text }]}>{w.strengthExploited?.description || 'Unknown strength'}</Text>
                <View style={[styles.catBadge, { backgroundColor: SEVERITY_COLORS[w.weaknessNotAddressed?.severity] + '20' || '#6B7280' + '20' }]}>
                  <Text style={{ color: SEVERITY_COLORS[w.weaknessNotAddressed?.severity] || '#6B7280', fontSize: 10, fontWeight: '700' }}>
                    {(w.weaknessNotAddressed?.severity || 'unknown').toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <View style={[styles.weaknessSection, { borderLeftColor: '#EF4444' }]}>
              <Text style={[styles.weaknessSectionLabel, { color: '#EF4444' }]}>WEAKNESS</Text>
              <Text style={[styles.weaknessSectionText, { color: colors.textSecondary }]}>
                {w.weaknessNotAddressed?.description || 'N/A'}
              </Text>
              <Text style={[styles.weaknessCat, { color: colors.textMuted }]}>
                Category: {(w.weaknessNotAddressed?.category || 'unknown').replace(/_/g, ' ')}
              </Text>
            </View>

            <View style={[styles.weaknessSection, { borderLeftColor: '#10B981' }]}>
              <Text style={[styles.weaknessSectionLabel, { color: '#10B981' }]}>OPPORTUNITY</Text>
              <Text style={[styles.weaknessSectionText, { color: colors.textSecondary }]}>
                {w.opportunityVector?.description || 'N/A'}
              </Text>
              <View style={styles.oppMeta}>
                <Text style={[styles.oppMetaText, { color: IMPACT_COLORS[w.opportunityVector?.expectedImpact] || '#6B7280' }]}>
                  Impact: {w.opportunityVector?.expectedImpact || 'unknown'}
                </Text>
                <Text style={[styles.oppMetaText, { color: colors.textMuted }]}>
                  Difficulty: {w.opportunityVector?.implementationDifficulty || 'unknown'}
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
                <Text style={[styles.gwPattern, { color: '#EF4444' }]}>{gw.pattern || 'Pattern'}</Text>
                <Text style={[styles.gwDesc, { color: colors.textSecondary }]}>{gw.description || 'N/A'}</Text>
                <Text style={[styles.gwExploit, { color: colors.primary }]}>Exploit: {gw.exploitStrategy || 'N/A'}</Text>
              </View>
            ))}
          </View>
        )}
        {detection._fallback && (
          <View style={[styles.fallbackBanner, { backgroundColor: '#F59E0B' + '15', borderColor: '#F59E0B' + '40' }]}>
            <Ionicons name="alert-circle" size={16} color="#F59E0B" />
            <Text style={[styles.fallbackText, { color: '#F59E0B' }]}>AI analysis unavailable — showing fallback data.</Text>
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
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="rocket" size={20} color="#8B5CF6" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>Dominance Strategy — {selectedAnalysis.competitorName}</Text>
        </View>

        {playbook && (
          <View style={[styles.playbookCard, { backgroundColor: '#8B5CF6' + '10', borderColor: '#8B5CF6' + '30' }]}>
            <Text style={[styles.playbookLabel, { color: '#8B5CF6' }]}>DOMINANCE PLAYBOOK</Text>
            <Text style={[styles.playbookPrimary, { color: colors.text }]}>{playbook.primaryStrategy || 'N/A'}</Text>
            {playbook.keyDifferentiators?.length > 0 && (
              <View style={styles.diffTags}>
                {playbook.keyDifferentiators.map((d: string, i: number) => (
                  <View key={i} style={[styles.tag, { backgroundColor: '#8B5CF6' }]}><Text style={styles.tagText}>{d}</Text></View>
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
            <Text style={[styles.variantTitle, { color: colors.text }]}>Upgraded Variant #{v.targetContentRank || index + 1}</Text>
            <Text style={[styles.variantOriginal, { color: colors.textMuted }]}>Original: {v.originalStrength || 'N/A'}</Text>

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
                <Text style={[styles.whyBetter, { color: '#3B82F6' }]}>Why: {v.upgradedHookLogic.whyBetter || 'N/A'}</Text>
              </View>
            )}

            {v.strongerConversionMechanics && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>Conversion Mechanics</Text>
                <Text style={[styles.upgradeCompare, { color: colors.textMuted }]}>Before: {v.strongerConversionMechanics.original || 'N/A'}</Text>
                <Text style={[styles.upgradeCompare, { color: colors.text }]}>After: {v.strongerConversionMechanics.upgraded || 'N/A'}</Text>
                <Text style={[styles.liftText, { color: '#10B981' }]}>Expected lift: {v.strongerConversionMechanics.expectedLift || 'N/A'}</Text>
              </View>
            )}

            {v.ctaOptimization && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>CTA Optimization</Text>
                <Text style={[styles.upgradeCompare, { color: colors.textMuted }]}>Before: {v.ctaOptimization.original || 'N/A'}</Text>
                <Text style={[styles.upgradeCompare, { color: colors.text }]}>After: {v.ctaOptimization.upgraded || 'N/A'}</Text>
              </View>
            )}

            {v.structuralUpgrades?.length > 0 && (
              <View style={styles.upgradeSection}>
                <Text style={[styles.upgradeSectionTitle, { color: colors.primary }]}>Structural Upgrades</Text>
                {v.structuralUpgrades.map((su: any, i: number) => (
                  <View key={i} style={styles.structUpgrade}>
                    <Text style={[styles.structTiming, { color: '#F59E0B' }]}>{su.timing || '?'}</Text>
                    <Text style={[styles.structAction, { color: colors.text }]}>{su.action || 'N/A'}</Text>
                    <Text style={[styles.structReason, { color: colors.textMuted }]}>{su.reason || ''}</Text>
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

  const renderModifications = () => {
    if (!selectedAnalysis?.planModifications) {
      return (
        <View>
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="git-compare-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No plan modifications generated yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Run a dominance strategy analysis first, then generate modifications.</Text>
          </View>
        </View>
      );
    }

    const mods = selectedAnalysis.planModifications;
    const adjustments = mods?.adjustments || [];
    const status = selectedAnalysis.modificationStatus;

    return (
      <View>
        <View style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Ionicons name="git-compare" size={20} color="#EF4444" />
          <Text style={[styles.sectionTitle, { color: colors.text, marginLeft: 8 }]}>Plan Modifications — {selectedAnalysis.competitorName}</Text>
        </View>

        <View style={[styles.modSummaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.modSummaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modSummaryLabel, { color: colors.textMuted }]}>BASE PLAN</Text>
              <Text style={[styles.modSummaryText, { color: colors.text }]}>{mods.basePlanSummary || 'Original orchestrator plan'}</Text>
            </View>
          </View>
          <View style={[styles.modDivider, { backgroundColor: colors.divider }]} />
          <View style={styles.modSummaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modSummaryLabel, { color: '#EF4444' }]}>DOMINANCE-ADJUSTED PLAN</Text>
              <Text style={[styles.modSummaryText, { color: colors.text }]}>{mods.adjustedPlanSummary || 'Adjusted plan with competitive modifications'}</Text>
            </View>
          </View>
          {mods.overallImpactAssessment && (
            <View style={[styles.impactAssessment, { backgroundColor: colors.inputBackground }]}>
              <Text style={[styles.impactLabel, { color: colors.textMuted }]}>
                Risk: {mods.overallImpactAssessment.riskLevel || '?'} | Confidence: {((mods.overallImpactAssessment.confidenceScore || 0) * 100).toFixed(0)}%
              </Text>
              <Text style={[styles.impactLift, { color: '#10B981' }]}>{mods.overallImpactAssessment.expectedLift || ''}</Text>
            </View>
          )}
        </View>

        <Text style={[styles.adjustmentsTitle, { color: colors.text }]}>Adjustments ({adjustments.length})</Text>
        {adjustments.map((adj: any, i: number) => (
          <View key={i} style={[styles.adjustmentCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.adjHeader}>
              <View style={[styles.impactBadge, { backgroundColor: IMPACT_COLORS[adj.impactLevel] + '20' || '#6B7280' + '20' }]}>
                <Text style={{ color: IMPACT_COLORS[adj.impactLevel] || '#6B7280', fontSize: 10, fontWeight: '700' }}>
                  {(adj.impactLevel || 'unknown').toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.adjSection, { color: colors.text }]}>{(adj.section || 'general').replace(/_/g, ' ').toUpperCase()}</Text>
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

            <Text style={[styles.adjReason, { color: colors.textMuted }]}>{adj.reason || ''}</Text>
            {adj.competitiveAdvantage && (
              <Text style={[styles.adjAdvantage, { color: '#10B981' }]}>Advantage: {adj.competitiveAdvantage}</Text>
            )}
          </View>
        ))}

        {status === 'pending_approval' && (
          <View style={styles.approvalSection}>
            <Text style={[styles.approvalNote, { color: colors.textSecondary }]}>
              These modifications require your explicit approval before being applied to the orchestrator plan.
            </Text>
            <View style={styles.approvalBtns}>
              <Pressable
                style={[styles.approveBtn, { backgroundColor: '#10B981' }]}
                onPress={() => selectedAnalysis && approveModsMutation.mutate(selectedAnalysis.id)}
                disabled={approveModsMutation.isPending}
              >
                {approveModsMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={styles.approveBtnText}>Approve Modifications</Text></>
                )}
              </Pressable>
              <Pressable
                style={[styles.rejectBtn, { backgroundColor: '#EF4444' }]}
                onPress={() => selectedAnalysis && rejectModsMutation.mutate(selectedAnalysis.id)}
                disabled={rejectModsMutation.isPending}
              >
                {rejectModsMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : (
                  <><Ionicons name="close-circle" size={18} color="#fff" /><Text style={styles.approveBtnText}>Reject — Keep Base Plan</Text></>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {status === 'approved' && (
          <View style={[styles.statusBanner, { backgroundColor: '#10B981' + '15', borderColor: '#10B981' + '40' }]}>
            <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            <Text style={[styles.statusBannerText, { color: '#10B981' }]}>Modifications approved and applied to plan</Text>
          </View>
        )}
        {status === 'rejected' && (
          <View style={[styles.statusBanner, { backgroundColor: '#EF4444' + '15', borderColor: '#EF4444' + '40' }]}>
            <Ionicons name="close-circle" size={20} color="#EF4444" />
            <Text style={[styles.statusBannerText, { color: '#EF4444' }]}>Modifications rejected — base plan unchanged</Text>
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
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  fallbackText: { fontSize: 12, flex: 1 },
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
  modSummaryCard: { padding: 16, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  modSummaryRow: { paddingVertical: 8 },
  modSummaryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  modSummaryText: { fontSize: 13 },
  modDivider: { height: 1, marginVertical: 4 },
  impactAssessment: { padding: 10, borderRadius: 8, marginTop: 8 },
  impactLabel: { fontSize: 11 },
  impactLift: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  adjustmentsTitle: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  adjustmentCard: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  adjHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  impactBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  adjSection: { fontSize: 12, fontWeight: '700' },
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
