import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

const SECTION_META: Record<string, { label: string; icon: string; gradient: [string, string] }> = {
  contentDistributionPlan: { label: 'Content Distribution', icon: 'megaphone-outline', gradient: ['#8B5CF6', '#7C3AED'] },
  creativeTestingMatrix: { label: 'Creative Testing', icon: 'flask-outline', gradient: ['#EC4899', '#DB2777'] },
  budgetAllocationStructure: { label: 'Budget Allocation', icon: 'wallet-outline', gradient: ['#10B981', '#059669'] },
  kpiMonitoringPriority: { label: 'KPI Monitoring', icon: 'analytics-outline', gradient: ['#F59E0B', '#D97706'] },
  competitiveWatchTargets: { label: 'Competitive Watch', icon: 'eye-outline', gradient: ['#3B82F6', '#2563EB'] },
  riskMonitoringTriggers: { label: 'Risk Triggers', icon: 'warning-outline', gradient: ['#EF4444', '#DC2626'] },
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
        setExpandedSections({});
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

  const safeStr = (v: any): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  const safeArray = (v: any): any[] => {
    if (Array.isArray(v)) return v;
    return [];
  };

  const renderContentDistribution = (data: any) => {
    const platforms = safeArray(data.platforms);
    const pillars = safeArray(data.contentPillars);
    return (
      <View style={st.sectionBody}>
        {platforms.map((p: any, i: number) => (
          <View key={i} style={[st.detailCard, { backgroundColor: isDark ? '#111827' : '#F8FAFC', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
            <View style={st.detailCardHeader}>
              <View style={[st.platformDot, { backgroundColor: '#8B5CF6' }]} />
              <Text style={[st.detailCardTitle, { color: colors.text }]}>{safeStr(p.platform)}</Text>
              <Text style={[st.detailCardBadge, { color: isDark ? '#A78BFA' : '#7C3AED' }]}>{safeStr(p.frequency)}</Text>
            </View>
            {safeArray(p.contentTypes).map((ct: any, j: number) => (
              <View key={j} style={st.detailRow}>
                <Text style={[st.detailLabel, { color: colors.textSecondary }]}>{safeStr(ct.type)}</Text>
                <View style={st.detailValueWrap}>
                  <Text style={[st.detailValue, { color: colors.text }]}>{safeStr(ct.percentage)}</Text>
                  <Text style={[st.detailSub, { color: colors.textSecondary }]}>{safeStr(ct.weeklyCount)}/wk</Text>
                </View>
              </View>
            ))}
            {p.bestPostingTimes && (
              <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#EDE9FE' }]}>
                <Ionicons name="time-outline" size={12} color="#8B5CF6" />
                <Text style={[st.infoChipText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>
                  {Array.isArray(p.bestPostingTimes) ? p.bestPostingTimes.join(' · ') : safeStr(p.bestPostingTimes)}
                </Text>
              </View>
            )}
          </View>
        ))}
        {pillars.length > 0 && (
          <View style={{ marginTop: 4 }}>
            <Text style={[st.subHeading, { color: colors.text }]}>Content Pillars</Text>
            {pillars.map((pillar: any, i: number) => (
              <View key={i} style={st.detailRow}>
                <Text style={[st.detailLabel, { color: colors.textSecondary }]}>{safeStr(pillar.pillar)}</Text>
                <Text style={[st.detailValue, { color: colors.text }]}>{safeStr(pillar.percentage)}%</Text>
              </View>
            ))}
          </View>
        )}
        {platforms.length === 0 && <Text style={[st.emptyText, { color: colors.textSecondary }]}>No distribution data.</Text>}
      </View>
    );
  };

  const renderCreativeTesting = (data: any) => {
    const tests = safeArray(data.tests || data.experiments);
    return (
      <View style={st.sectionBody}>
        {tests.map((t: any, i: number) => (
          <View key={i} style={[st.detailCard, { backgroundColor: isDark ? '#111827' : '#F8FAFC', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
            <Text style={[st.detailCardTitle, { color: colors.text }]}>{safeStr(t.testName || t.name)}</Text>
            <View style={st.testMeta}>
              <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#FCE7F3' }]}>
                <Ionicons name="flask-outline" size={11} color="#EC4899" />
                <Text style={[st.infoChipText, { color: isDark ? '#F9A8D4' : '#BE185D' }]}>{safeStr(t.variable || t.hypothesis)}</Text>
              </View>
              <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#FEF3C7' }]}>
                <Ionicons name="timer-outline" size={11} color="#F59E0B" />
                <Text style={[st.infoChipText, { color: isDark ? '#FCD34D' : '#92400E' }]}>{safeStr(t.duration || t.timeline)}</Text>
              </View>
            </View>
            {t.rationale && <Text style={[st.rationaleText, { color: colors.textSecondary }]}>{safeStr(t.rationale)}</Text>}
          </View>
        ))}
        {tests.length === 0 && <Text style={[st.emptyText, { color: colors.textSecondary }]}>No tests defined.</Text>}
      </View>
    );
  };

  const renderBudgetAllocation = (data: any) => {
    const total = safeStr(data.totalBudget || data.totalRecommended || data.total || 'N/A');
    const categories = safeArray(data.categories || data.breakdown);
    return (
      <View style={st.sectionBody}>
        <View style={[st.budgetBanner, { backgroundColor: isDark ? '#064E3B' : '#ECFDF5' }]}>
          <Ionicons name="cash-outline" size={18} color={isDark ? '#6EE7B7' : '#059669'} />
          <Text style={[st.budgetAmount, { color: isDark ? '#6EE7B7' : '#065F46' }]}>Total Budget: {total}</Text>
        </View>
        {categories.map((c: any, i: number) => (
          <View key={i} style={st.detailRow}>
            <View style={{ flex: 1 }}>
              <Text style={[st.detailLabel, { color: colors.text }]}>{safeStr(c.category || c.name)}</Text>
              {c.purpose && <Text style={[st.purposeText, { color: colors.textSecondary }]}>{safeStr(c.purpose)}</Text>}
            </View>
            <View style={[st.percentBadge, { backgroundColor: isDark ? '#064E3B' : '#D1FAE5' }]}>
              <Text style={[st.percentText, { color: isDark ? '#6EE7B7' : '#065F46' }]}>{safeStr(c.percentage || c.percent)}%</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  const renderKpiMonitoring = (data: any) => {
    const primary = safeArray(data.primaryKPIs || data.primaryMetrics || data.primary);
    const secondary = safeArray(data.secondaryKPIs || data.secondaryMetrics || data.secondary);
    return (
      <View style={st.sectionBody}>
        {primary.length > 0 && (
          <>
            <Text style={[st.subHeading, { color: colors.text }]}>Primary KPIs</Text>
            {primary.map((m: any, i: number) => (
              <View key={i} style={[st.detailCard, { backgroundColor: isDark ? '#111827' : '#F8FAFC', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
                <Text style={[st.detailCardTitle, { color: colors.text }]}>{safeStr(m.kpi || m.metric || m.name)}</Text>
                <View style={st.kpiRow}>
                  <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#FEF3C7' }]}>
                    <Ionicons name="flag-outline" size={11} color="#F59E0B" />
                    <Text style={[st.infoChipText, { color: isDark ? '#FCD34D' : '#92400E' }]}>{safeStr(m.target)}</Text>
                  </View>
                  {m.frequency && (
                    <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#EDE9FE' }]}>
                      <Ionicons name="sync-outline" size={11} color="#8B5CF6" />
                      <Text style={[st.infoChipText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>{safeStr(m.frequency)}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
        {secondary.length > 0 && (
          <>
            <Text style={[st.subHeading, { color: colors.text, marginTop: 8 }]}>Secondary KPIs</Text>
            {secondary.map((m: any, i: number) => (
              <View key={i} style={st.detailRow}>
                <Text style={[st.detailLabel, { color: colors.textSecondary, flex: 1 }]}>{safeStr(m.kpi || m.metric || m.name)}</Text>
                <Text style={[st.detailValue, { color: colors.text }]}>{safeStr(m.target)}</Text>
              </View>
            ))}
          </>
        )}
        {primary.length === 0 && secondary.length === 0 && <Text style={[st.emptyText, { color: colors.textSecondary }]}>No KPIs defined.</Text>}
      </View>
    );
  };

  const renderCompetitiveWatch = (data: any) => {
    const targets = safeArray(data.competitors || data.targets);
    return (
      <View style={st.sectionBody}>
        {targets.map((c: any, i: number) => (
          <View key={i} style={[st.detailCard, { backgroundColor: isDark ? '#111827' : '#F8FAFC', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
            <Text style={[st.detailCardTitle, { color: colors.text }]}>{safeStr(c.competitor || c.name)}</Text>
            {c.watchMetrics && (
              <View style={st.chipWrap}>
                {safeArray(c.watchMetrics).slice(0, 4).map((m: string, j: number) => (
                  <View key={j} style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#DBEAFE' }]}>
                    <Text style={[st.infoChipText, { color: isDark ? '#93C5FD' : '#1E40AF' }]}>{safeStr(m)}</Text>
                  </View>
                ))}
              </View>
            )}
            {c.checkFrequency && <Text style={[st.purposeText, { color: colors.textSecondary, marginTop: 4 }]}>Check: {safeStr(c.checkFrequency)}</Text>}
          </View>
        ))}
        {targets.length === 0 && <Text style={[st.emptyText, { color: colors.textSecondary }]}>No competitive watch targets.</Text>}
      </View>
    );
  };

  const renderRiskTriggers = (data: any) => {
    const risks = safeArray(data.triggers || data.risks);
    const sevColors: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
      critical: { bg: '#FEE2E2', text: '#991B1B', darkBg: '#450A0A', darkText: '#FCA5A5' },
      high: { bg: '#FEF3C7', text: '#92400E', darkBg: '#451A03', darkText: '#FCD34D' },
      medium: { bg: '#DBEAFE', text: '#1E40AF', darkBg: '#1E1B4B', darkText: '#93C5FD' },
      low: { bg: '#D1FAE5', text: '#065F46', darkBg: '#064E3B', darkText: '#6EE7B7' },
    };
    return (
      <View style={st.sectionBody}>
        {risks.map((r: any, i: number) => {
          const sev = safeStr(r.severity || 'medium').toLowerCase();
          const sc = sevColors[sev] || sevColors.medium;
          return (
            <View key={i} style={[st.detailCard, { backgroundColor: isDark ? '#111827' : '#F8FAFC', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
              <View style={st.riskHeader}>
                <Text style={[st.detailCardTitle, { color: colors.text, flex: 1 }]}>{safeStr(r.trigger)}</Text>
                <View style={[st.severityBadge, { backgroundColor: isDark ? sc.darkBg : sc.bg }]}>
                  <Text style={[st.severityText, { color: isDark ? sc.darkText : sc.text }]}>{sev}</Text>
                </View>
              </View>
              {r.condition && <Text style={[st.purposeText, { color: colors.textSecondary, marginTop: 4 }]}>{safeStr(r.condition)}</Text>}
              {r.action && (
                <View style={[st.infoChip, { backgroundColor: isDark ? '#1E1B4B' : '#EDE9FE', marginTop: 6 }]}>
                  <Ionicons name="arrow-forward-outline" size={11} color="#8B5CF6" />
                  <Text style={[st.infoChipText, { color: isDark ? '#C4B5FD' : '#6D28D9' }]}>{safeStr(r.action)}</Text>
                </View>
              )}
            </View>
          );
        })}
        {risks.length === 0 && <Text style={[st.emptyText, { color: colors.textSecondary }]}>No risk triggers.</Text>}
      </View>
    );
  };

  const renderSectionContent = (key: string, data: any) => {
    if (!data || typeof data !== 'object') {
      return <Text style={[st.emptyText, { color: colors.textSecondary }]}>No data available.</Text>;
    }
    switch (key) {
      case 'contentDistributionPlan': return renderContentDistribution(data);
      case 'creativeTestingMatrix': return renderCreativeTesting(data);
      case 'budgetAllocationStructure': return renderBudgetAllocation(data);
      case 'kpiMonitoringPriority': return renderKpiMonitoring(data);
      case 'competitiveWatchTargets': return renderCompetitiveWatch(data);
      case 'riskMonitoringTriggers': return renderRiskTriggers(data);
      default: return <Text style={[st.emptyText, { color: colors.textSecondary }]}>{JSON.stringify(data, null, 2)}</Text>;
    }
  };

  if (loading) {
    return (
      <View style={st.stateContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[st.stateText, { color: colors.textSecondary }]}>Loading plan...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={st.stateContainer}>
        <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
        <Text style={[st.stateText, { color: colors.textSecondary }]}>{error}</Text>
        <Pressable onPress={fetchDocument} style={[st.retryBtn, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
          <Ionicons name="refresh" size={14} color="#8B5CF6" />
          <Text style={st.retryBtnText}>Retry</Text>
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} style={{ marginTop: 8 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Close</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!document) return null;

  const contentJson = document.contentJson || {};

  const statusLabel = plan?.status?.replace(/_/g, ' ') || 'DRAFT';
  const isActive = ['APPROVED', 'GENERATED_TO_CALENDAR', 'CREATIVE_GENERATED', 'SCHEDULED', 'PUBLISHED'].includes(plan?.status);

  return (
    <View>
      {onClose && (
        <Pressable onPress={onClose} style={st.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
          <Text style={[st.backBtnText, { color: colors.text }]}>Back</Text>
        </Pressable>
      )}

      <View style={[st.headerCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
        <LinearGradient
          colors={isDark ? ['#1E1B4B', '#312E81'] : ['#EDE9FE', '#DDD6FE']}
          style={st.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={st.headerContent}>
            <View style={st.headerIconWrap}>
              <Ionicons name="document-text" size={22} color="#8B5CF6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.headerTitle, { color: isDark ? '#E0E7FF' : '#312E81' }]}>The Plan</Text>
              <Text style={[st.headerSub, { color: isDark ? '#A5B4FC' : '#6D28D9' }]}>
                v{document.version} · {new Date(document.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View style={[st.statusPill, { backgroundColor: isActive ? '#10B98125' : '#F59E0B25' }]}>
              <View style={[st.statusDot, { backgroundColor: isActive ? '#10B981' : '#F59E0B' }]} />
              <Text style={[st.statusLabel, { color: isActive ? '#10B981' : '#F59E0B' }]}>{statusLabel}</Text>
            </View>
          </View>
        </LinearGradient>

        {document.isFallback && (
          <View style={[st.fallbackStrip, { backgroundColor: isDark ? '#451A03' : '#FEF3C7' }]}>
            <Ionicons name="alert-circle" size={13} color="#D97706" />
            <Text style={[st.fallbackText, { color: isDark ? '#FCD34D' : '#92400E' }]}>Fallback plan — AI was unavailable during generation</Text>
          </View>
        )}
      </View>

      {SECTION_KEYS.map(key => {
        const meta = SECTION_META[key];
        const sectionData = contentJson[key];
        const isExpanded = expandedSections[key];
        const hasData = sectionData && typeof sectionData === 'object' && Object.keys(sectionData).length > 0;

        return (
          <View key={key} style={[st.sectionCard, { backgroundColor: isDark ? '#0F1419' : '#fff', borderColor: isDark ? '#1F2937' : '#E2E8F0' }]}>
            <Pressable onPress={() => toggleSection(key)} style={st.sectionHeader}>
              <LinearGradient
                colors={meta.gradient}
                style={st.sectionIconBg}
              >
                <Ionicons name={meta.icon as any} size={15} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={[st.sectionTitle, { color: colors.text }]}>{meta.label}</Text>
              </View>
              {!hasData && (
                <View style={[st.emptyTag, { backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }]}>
                  <Text style={{ fontSize: 9, color: colors.textSecondary, fontWeight: '600' as const }}>EMPTY</Text>
                </View>
              )}
              <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            </Pressable>
            {isExpanded && (
              <View style={[st.sectionContent, { borderTopColor: isDark ? '#1F2937' : '#F1F5F9' }]}>
                {renderSectionContent(key, sectionData)}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  retryBtnText: {
    color: '#8B5CF6',
    fontWeight: '600' as const,
    fontSize: 13,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingVertical: 4,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  headerCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 12,
  },
  headerGradient: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ffffff20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '500' as const,
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fallbackStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  fallbackText: {
    fontSize: 11,
    fontWeight: '500' as const,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  sectionIconBg: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  emptyTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  sectionContent: {
    borderTopWidth: 1,
    paddingTop: 2,
  },
  sectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 8,
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  platformDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  detailCardTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 2,
  },
  detailCardBadge: {
    fontSize: 11,
    fontWeight: '600' as const,
    marginLeft: 'auto',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  detailLabel: {
    fontSize: 12,
  },
  detailValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  detailSub: {
    fontSize: 11,
  },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginTop: 4,
    flexShrink: 1,
  },
  infoChipText: {
    fontSize: 11,
    fontWeight: '500' as const,
    flexShrink: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  subHeading: {
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  testMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  rationaleText: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
    fontStyle: 'italic',
  },
  budgetBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  budgetAmount: {
    fontSize: 16,
    fontWeight: '800' as const,
  },
  purposeText: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  percentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  percentText: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  emptyText: {
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
});
