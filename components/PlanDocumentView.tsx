import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

const SECTION_META: Record<string, { label: string; icon: string; color: string }> = {
  contentDistributionPlan: { label: 'Content Distribution', icon: 'megaphone-outline', color: '#8B5CF6' },
  creativeTestingMatrix: { label: 'Creative Testing', icon: 'flask-outline', color: '#EC4899' },
  budgetAllocationStructure: { label: 'Budget Allocation', icon: 'wallet-outline', color: '#10B981' },
  kpiMonitoringPriority: { label: 'KPI Monitoring', icon: 'analytics-outline', color: '#F59E0B' },
  competitiveWatchTargets: { label: 'Competitive Watch', icon: 'eye-outline', color: '#3B82F6' },
  riskMonitoringTriggers: { label: 'Risk Triggers', icon: 'warning-outline', color: '#EF4444' },
};

const SECTION_KEYS = Object.keys(SECTION_META);

interface PlanDocumentViewProps {
  planId?: string;
  blueprintId?: string;
  onClose?: () => void;
}

export default function PlanDocumentView({ planId, blueprintId, onClose }: PlanDocumentViewProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const fetchDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const campaignId = selectedCampaign?.selectedCampaignId || '';
      let url: string;
      if (planId) {
        url = getApiUrl(`/api/plans/${planId}/document?accountId=default${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}`);
      } else if (blueprintId) {
        url = getApiUrl(`/api/strategic/blueprint/${blueprintId}/document`);
      } else {
        setError('No plan or blueprint ID provided.');
        setLoading(false);
        return;
      }

      const res = await fetch(url);
      const data = await res.json();
      if (res.ok && data.success) {
        setDocument(data.document);
        setPlan(data.plan);
        const initial: Record<string, boolean> = {};
        SECTION_KEYS.forEach(k => { initial[k] = true; });
        setExpandedSections(initial);
      } else {
        setError(data.message || data.error || 'Failed to load plan document.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [planId, blueprintId]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSectionContent = (key: string, data: any) => {
    if (!data || typeof data !== 'object') {
      return <Text style={[s.emptyText, { color: colors.textSecondary }]}>No data available.</Text>;
    }

    switch (key) {
      case 'contentDistributionPlan':
        return renderContentDistribution(data);
      case 'creativeTestingMatrix':
        return renderCreativeTesting(data);
      case 'budgetAllocationStructure':
        return renderBudgetAllocation(data);
      case 'kpiMonitoringPriority':
        return renderKpiMonitoring(data);
      case 'competitiveWatchTargets':
        return renderCompetitiveWatch(data);
      case 'riskMonitoringTriggers':
        return renderRiskTriggers(data);
      default:
        return <Text style={[s.emptyText, { color: colors.textSecondary }]}>{JSON.stringify(data, null, 2)}</Text>;
    }
  };

  const safeStr = (v: any): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const renderContentDistribution = (data: any) => {
    const platforms = data.platforms || [];
    return (
      <View style={s.sectionBody}>
        {platforms.map((p: any, i: number) => (
          <View key={i} style={[s.subCard, { backgroundColor: isDark ? '#1F2937' : '#F9FAFB', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
            <Text style={[s.subCardTitle, { color: colors.text }]}>{safeStr(p.platform)} — {safeStr(p.frequency)}</Text>
            {p.contentTypes?.map((ct: any, j: number) => (
              <View key={j} style={s.listRow}>
                <Text style={[s.listLabel, { color: colors.textSecondary }]}>{safeStr(ct.type)}</Text>
                <Text style={[s.listValue, { color: colors.text }]}>{safeStr(ct.percentage)} • {safeStr(ct.weeklyCount)}/wk</Text>
              </View>
            ))}
            {p.bestPostingTimes && (
              <Text style={[s.metaText, { color: colors.textSecondary }]}>Best times: {Array.isArray(p.bestPostingTimes) ? p.bestPostingTimes.join(', ') : safeStr(p.bestPostingTimes)}</Text>
            )}
          </View>
        ))}
        {platforms.length === 0 && <Text style={[s.emptyText, { color: colors.textSecondary }]}>No distribution data.</Text>}
      </View>
    );
  };

  const renderCreativeTesting = (data: any) => {
    const tests = data.tests || data.experiments || [];
    return (
      <View style={s.sectionBody}>
        {tests.map((t: any, i: number) => (
          <View key={i} style={[s.subCard, { backgroundColor: isDark ? '#1F2937' : '#F9FAFB', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
            <Text style={[s.subCardTitle, { color: colors.text }]}>{safeStr(t.testName || t.name)}</Text>
            <Text style={[s.metaText, { color: colors.textSecondary }]}>Variable: {safeStr(t.variable || t.hypothesis)}</Text>
            <Text style={[s.metaText, { color: colors.textSecondary }]}>Duration: {safeStr(t.duration || t.timeline)}</Text>
            {t.rationale && <Text style={[s.metaText, { color: colors.textSecondary }]}>Why: {safeStr(t.rationale)}</Text>}
          </View>
        ))}
        {tests.length === 0 && <Text style={[s.emptyText, { color: colors.textSecondary }]}>No tests defined.</Text>}
      </View>
    );
  };

  const renderBudgetAllocation = (data: any) => {
    const totalBudget = data.totalBudget || data.total || 'N/A';
    const categories = data.categories || data.breakdown || [];
    return (
      <View style={s.sectionBody}>
        <View style={[s.budgetHeader, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
          <Text style={[s.budgetTotal, { color: isDark ? '#6EE7B7' : '#065F46' }]}>Total: ${safeStr(totalBudget)}</Text>
        </View>
        {categories.map((c: any, i: number) => (
          <View key={i} style={s.listRow}>
            <Text style={[s.listLabel, { color: colors.textSecondary }]}>{safeStr(c.category || c.name)}</Text>
            <Text style={[s.listValue, { color: colors.text }]}>{safeStr(c.percentage || c.percent)}%</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderKpiMonitoring = (data: any) => {
    const primary = data.primaryMetrics || data.primary || [];
    const secondary = data.secondaryMetrics || data.secondary || [];
    return (
      <View style={s.sectionBody}>
        {primary.length > 0 && (
          <>
            <Text style={[s.subSectionLabel, { color: colors.text }]}>Primary</Text>
            {primary.map((m: any, i: number) => (
              <View key={i} style={s.listRow}>
                <Text style={[s.listLabel, { color: colors.textSecondary }]}>{safeStr(m.metric || m.name)}</Text>
                <Text style={[s.listValue, { color: colors.text }]}>Target: {safeStr(m.target)}</Text>
              </View>
            ))}
          </>
        )}
        {secondary.length > 0 && (
          <>
            <Text style={[s.subSectionLabel, { color: colors.text }]}>Secondary</Text>
            {secondary.map((m: any, i: number) => (
              <View key={i} style={s.listRow}>
                <Text style={[s.listLabel, { color: colors.textSecondary }]}>{safeStr(m.metric || m.name)}</Text>
                <Text style={[s.listValue, { color: colors.text }]}>Target: {safeStr(m.target)}</Text>
              </View>
            ))}
          </>
        )}
        {primary.length === 0 && secondary.length === 0 && <Text style={[s.emptyText, { color: colors.textSecondary }]}>No KPIs defined.</Text>}
      </View>
    );
  };

  const renderCompetitiveWatch = (data: any) => {
    const targets = data.competitors || data.targets || [];
    return (
      <View style={s.sectionBody}>
        {targets.map((c: any, i: number) => (
          <View key={i} style={[s.subCard, { backgroundColor: isDark ? '#1F2937' : '#F9FAFB', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
            <Text style={[s.subCardTitle, { color: colors.text }]}>{safeStr(c.competitor || c.name)}</Text>
            {c.metrics && <Text style={[s.metaText, { color: colors.textSecondary }]}>Watch: {Array.isArray(c.metrics) ? c.metrics.join(', ') : safeStr(c.metrics)}</Text>}
            {c.trigger && <Text style={[s.metaText, { color: colors.textSecondary }]}>Trigger: {safeStr(c.trigger)}</Text>}
          </View>
        ))}
        {targets.length === 0 && <Text style={[s.emptyText, { color: colors.textSecondary }]}>No competitive watch targets.</Text>}
      </View>
    );
  };

  const renderRiskTriggers = (data: any) => {
    const risks = data.triggers || data.risks || [];
    return (
      <View style={s.sectionBody}>
        {risks.map((r: any, i: number) => {
          const severity = safeStr(r.severity || 'medium').toLowerCase();
          const sevColor = severity === 'critical' ? '#EF4444' : severity === 'high' ? '#F59E0B' : '#6B7280';
          return (
            <View key={i} style={[s.subCard, { backgroundColor: isDark ? '#1F2937' : '#F9FAFB', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
              <View style={s.riskHeader}>
                <Text style={[s.subCardTitle, { color: colors.text, flex: 1 }]}>{safeStr(r.trigger || r.risk || r.name)}</Text>
                <View style={[s.severityBadge, { backgroundColor: sevColor + '20' }]}>
                  <Text style={[s.severityText, { color: sevColor }]}>{severity}</Text>
                </View>
              </View>
              {(r.action || r.mitigation || r.response) && (
                <Text style={[s.metaText, { color: colors.textSecondary }]}>Action: {safeStr(r.action || r.mitigation || r.response)}</Text>
              )}
            </View>
          );
        })}
        {risks.length === 0 && <Text style={[s.emptyText, { color: colors.textSecondary }]}>No risk triggers.</Text>}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[s.loadingText, { color: colors.textSecondary }]}>Loading plan document...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <Ionicons name="document-text-outline" size={40} color={colors.textMuted} />
        <Text style={[s.errorText, { color: colors.text }]}>{error}</Text>
        <Pressable onPress={fetchDocument} style={s.retryBtn}>
          <Text style={s.retryBtnText}>Retry</Text>
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={[s.retryBtn, { marginTop: 8 }]}>
            <Text style={[s.retryBtnText, { color: '#6B7280' }]}>Close</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!document) return null;

  const contentJson = document.contentJson || {};

  return (
    <ScrollView style={[s.scroll, { backgroundColor: colors.background }]} contentContainerStyle={s.scrollContent}>
      {onClose && (
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={[s.closeBtnText, { color: colors.text }]}>Back</Text>
        </Pressable>
      )}

      <View style={[s.headerCard, { backgroundColor: isDark ? '#1F2937' : '#fff', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
        <View style={s.headerRow}>
          <Ionicons name="document-text" size={24} color="#8B5CF6" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[s.headerTitle, { color: colors.text }]}>Strategic Plan</Text>
            <Text style={[s.headerMeta, { color: colors.textSecondary }]}>
              v{document.version} • {new Date(document.createdAt).toLocaleDateString()}
            </Text>
          </View>
          {plan && (
            <View style={[s.statusBadge, { backgroundColor: plan.status === 'APPROVED' ? '#10B98120' : '#F59E0B20' }]}>
              <Text style={[s.statusText, { color: plan.status === 'APPROVED' ? '#10B981' : '#F59E0B' }]}>
                {plan.status}
              </Text>
            </View>
          )}
        </View>
        {document.isFallback && (
          <View style={[s.fallbackBanner, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="alert-circle" size={14} color="#D97706" />
            <Text style={{ color: '#92400E', fontSize: 12, marginLeft: 6 }}>Skeleton fallback — AI generation was unavailable</Text>
          </View>
        )}
      </View>

      {SECTION_KEYS.map(key => {
        const meta = SECTION_META[key];
        const sectionData = contentJson[key];
        const isExpanded = expandedSections[key];
        const hasData = sectionData && typeof sectionData === 'object' && Object.keys(sectionData).length > 0;

        return (
          <View key={key} style={[s.sectionCard, { backgroundColor: isDark ? '#1F2937' : '#fff', borderColor: isDark ? '#374151' : '#E5E7EB' }]}>
            <Pressable onPress={() => toggleSection(key)} style={s.sectionHeader}>
              <View style={[s.sectionIconWrap, { backgroundColor: meta.color + '15' }]}>
                <Ionicons name={meta.icon as any} size={18} color={meta.color} />
              </View>
              <Text style={[s.sectionTitle, { color: colors.text }]}>{meta.label}</Text>
              {!hasData && <View style={[s.emptyBadge, { backgroundColor: '#6B728020' }]}><Text style={{ fontSize: 10, color: '#6B7280' }}>Empty</Text></View>}
              <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {isExpanded && renderSectionContent(key, sectionData)}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 14 },
  errorText: { marginTop: 12, fontSize: 14, textAlign: 'center' },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#8B5CF620', borderRadius: 8 },
  retryBtnText: { color: '#8B5CF6', fontWeight: '600', fontSize: 13 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  closeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  closeBtnText: { fontSize: 14, fontWeight: '600' },
  headerCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerMeta: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' },
  fallbackBanner: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  sectionCard: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  sectionIconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  emptyBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 4 },
  sectionBody: { paddingHorizontal: 14, paddingBottom: 14 },
  subCard: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  subCardTitle: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  listLabel: { fontSize: 12, flex: 1 },
  listValue: { fontSize: 12, fontWeight: '600' },
  metaText: { fontSize: 11, marginTop: 2 },
  emptyText: { fontSize: 12, fontStyle: 'italic', paddingVertical: 8 },
  budgetHeader: { padding: 10, borderRadius: 8, marginBottom: 8 },
  budgetTotal: { fontSize: 15, fontWeight: '700' },
  subSectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  riskHeader: { flexDirection: 'row', alignItems: 'center' },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  severityText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
});
