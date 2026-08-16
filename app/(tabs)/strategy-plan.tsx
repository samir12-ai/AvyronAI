import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { getApiUrl, safeApiJson, authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import { GlobalHeader } from '@/components/GlobalHeader';

const C = {
  mint: '#8B5CF6',
  neon: '#39FF14',
  coral: '#FF6B6B',
  gold: '#FFD700',
  blue: '#4C9AFF',
  teal: '#14B8A6',
};

export default function StrategyPlanScreen() {
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planData, setPlanData] = useState<any>(null);

  const cardBg = isDark ? '#0F1419' : '#FFFFFF';
  const cardBorder = isDark ? '#1F2937' : '#E2E8F0';
  const textPrimary = isDark ? '#E8EDF2' : '#1A2332';
  const textSecondary = isDark ? '#8892A4' : '#546478';

  const fetchPlan = useCallback(async () => {
    const campaignId = selectedCampaign?.selectedCampaignId || '';
    if (!campaignId) {
      setError('Please select a campaign in the Overview tab first.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const activeUrl = getApiUrl(`/api/plans/active/${encodeURIComponent(campaignId)}`);
      const activeRes = await authFetch(activeUrl);
      const activeData = await safeApiJson(activeRes);

      if (!activeRes.ok || !activeData.hasPlan) {
        setError('No active plan found. Please go to the Operations tab and build a plan first.');
        setLoading(false);
        return;
      }

      setPlanData(activeData.plan);
    } catch (err: any) {
      setError(err.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [selectedCampaign]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  if (loading) {
    return (
      <View style={[st.container, { backgroundColor: colors.background }]}>
        <GlobalHeader title="Strategy Plan" />
        <View style={st.stateContainer}>
          <ActivityIndicator size="large" color={C.mint} />
          <Text style={[st.stateText, { color: textSecondary }]}>Loading Strategy Plan...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[st.container, { backgroundColor: colors.background }]}>
        <GlobalHeader title="Strategy Plan" />
        <View style={st.stateContainer}>
          <Ionicons name="alert-circle-outline" size={32} color={C.coral} />
          <Text style={[st.stateText, { color: textSecondary, marginVertical: 12, textAlign: 'center' }]}>{error}</Text>
          <Pressable onPress={fetchPlan} style={st.retryBtn}>
            <Ionicons name="refresh" size={14} color="#FFFFFF" />
            <Text style={st.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const sections = planData?.sections || {};
  const businessRep = sections.businessRepresentation;
  const stratSummary = sections.strategicSummary;

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <GlobalHeader title="Strategy Plan" />
      <ScrollView contentContainerStyle={st.scrollContent}>
        
        {/* Header Summary Card */}
        <View style={[st.headerCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={st.headerRow}>
            <Ionicons name="rocket-outline" size={24} color={C.mint} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[st.headerTitle, { color: textPrimary }]}>Consolidated Strategic Brain</Text>
              <Text style={{ fontSize: 11, color: textSecondary, marginTop: 2 }}>
                Active Strategy · Version {planData?.version || 1}
              </Text>
            </View>
          </View>
        </View>

        {/* 1. Business Representation */}
        {businessRep && (
          <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={st.cardHeader}>
              <Ionicons name="business-outline" size={18} color={C.mint} />
              <Text style={[st.sectionTitle, { color: textPrimary }]}>Business Language Layer</Text>
            </View>
            <View style={st.cardBody}>
              {businessRep.strategicSummary && (
                <View style={st.sectionGroup}>
                  <Text style={st.fieldLabel}>Growth Strategy</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.strategicSummary.strategy}</Text>
                  
                  <Text style={st.fieldLabel}>Target Audience Description</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.strategicSummary.targetAudience}</Text>

                  <Text style={st.fieldLabel}>Growth Objective</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.strategicSummary.growthObjective}</Text>

                  <Text style={st.fieldLabel}>Core Rationale</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.strategicSummary.rationale}</Text>
                </View>
              )}

              {businessRep.contentDistribution && (
                <View style={st.sectionGroup}>
                  <Text style={st.fieldLabel}>Distribution Approach</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.contentDistribution.rationale}</Text>
                </View>
              )}

              {businessRep.executionBlueprintDnaLink && (
                <View style={st.sectionGroup}>
                  <Text style={st.fieldLabel}>Weekly Playbook Rhythm</Text>
                  <Text style={[st.fieldValue, { color: textPrimary }]}>{businessRep.executionBlueprintDnaLink.weeklyDnaApplication}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* 2. Canonical Decisions */}
        {stratSummary && (
          <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={st.cardHeader}>
              <Ionicons name="shield-checkmark-outline" size={18} color={C.mint} />
              <Text style={[st.sectionTitle, { color: textPrimary }]}>Canonical Strategy (Source of Truth)</Text>
            </View>
            <View style={st.cardBody}>
              <View style={st.sectionGroup}>
                <Text style={st.fieldLabel}>Approved Strategy Statement</Text>
                <Text style={[st.fieldValue, { color: textPrimary }]}>{stratSummary.strategy}</Text>

                <Text style={st.fieldLabel}>Target Segment ID</Text>
                <Text style={[st.fieldValue, { color: textPrimary }]}>{stratSummary.targetAudience}</Text>

                <Text style={st.fieldLabel}>Objective Metrics</Text>
                <Text style={[st.fieldValue, { color: textPrimary }]}>{stratSummary.growthObjective}</Text>

                <Text style={st.fieldLabel}>Doctrine Rationale</Text>
                <Text style={[st.fieldValue, { color: textPrimary }]}>{stratSummary.rationale}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 3. Engine Parameters & Locks */}
        {planData?.lockedDecisionLabels && planData.lockedDecisionLabels.length > 0 && (
          <View style={[st.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={st.cardHeader}>
              <Ionicons name="lock-closed-outline" size={18} color={C.mint} />
              <Text style={[st.sectionTitle, { color: textPrimary }]}>Locked Pipeline Decisions</Text>
            </View>
            <View style={st.cardBody}>
              <Text style={{ fontSize: 12, color: textSecondary, marginBottom: 10, lineHeight: 18 }}>
                The following parameters are computed by upstream engines, validated by judges, and locked into Plan Synthesis:
              </Text>
              <View style={st.chipContainer}>
                {planData.lockedDecisionLabels.map((lbl: string, idx: number) => (
                  <View key={idx} style={st.chip}>
                    <Text style={st.chipText}>{lbl}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  stateText: { fontSize: 14, textAlign: 'center', marginTop: 12 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#8B5CF6', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, marginTop: 4 },
  retryBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  headerCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  card: { borderRadius: 14, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: '#1F293720' },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  cardBody: { padding: 14 },
  sectionGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#8B5CF6', letterSpacing: 0.5, marginBottom: 4, marginTop: 8 },
  fieldValue: { fontSize: 12, lineHeight: 18 },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#8B5CF620', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#8B5CF640' },
  chipText: { fontSize: 10, color: '#8B5CF6', fontWeight: '600' },
});
