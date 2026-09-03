import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { getApiUrl, authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';
import { GlobalHeader } from '@/components/GlobalHeader';

export default function ReportsScreen() {
  const { selectedCampaign } = useCampaign();
  const campaignId = selectedCampaign?.id || 'camp_buffer_e2e_1787909177715';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportsList, setReportsList] = useState<any[]>([]);
  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const [activeReport, setActiveReport] = useState<any>(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${getApiUrl()}/api/reports/monthly?campaignId=${campaignId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.reports)) {
          setReportsList(data.reports);
          if (data.reports.length > 0) {
            setActiveReport(data.reports[selectedReportIndex] || data.reports[0]);
          }
        }
      }
    } catch (err) {
      console.error('[Reports] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [campaignId, selectedReportIndex]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchReports();
  };

  const handleSelectReport = (index: number) => {
    setSelectedReportIndex(index);
    setActiveReport(reportsList[index]);
  };

  const p = activeReport?.reportPayload;

  return (
    <View style={styles.container}>
      <GlobalHeader title="Monthly Reports" subtitle="Immutable Monthly Business Memory" />

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.tint} />
          <Text style={styles.loadingText}>Loading Monthly Business Memory...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.dark.tint} />}
        >
          {/* ── Period Selector Tabs ──────────────────────────────── */}
          <View style={styles.periodTabsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodTabsContent}>
              {reportsList.map((r, idx) => {
                const isSelected = idx === selectedReportIndex;
                const year = r.reportPeriodYear;
                const month = r.reportPeriodMonth;
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const label = `${monthNames[month - 1]} ${year}`;
                const isFinalized = r.status === 'FINALIZED';

                return (
                  <Pressable
                    key={r.id || idx}
                    onPress={() => handleSelectReport(idx)}
                    style={[styles.periodTab, isSelected && styles.periodTabActive]}
                  >
                    <Text style={[styles.periodTabText, isSelected && styles.periodTabTextActive]}>{label}</Text>
                    <View style={[styles.statusMiniBadge, isFinalized ? styles.badgeFinalized : styles.badgeInProgress]}>
                      <Text style={styles.statusMiniBadgeText}>{isFinalized ? 'FINAL' : 'IN PROGRESS'}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* ── Report Title Banner ───────────────────────────────── */}
          {p ? (
            <>
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={styles.heroPeriodLabel}>{p.periodLabel}</Text>
                    <Text style={styles.heroSubtitle}>Campaign Business Report & Historical Analysis</Text>
                  </View>
                  <View style={[styles.statusPill, p.isFinalized ? styles.statusPillFinal : styles.statusPillProgress]}>
                    <Ionicons
                      name={p.isFinalized ? 'lock-closed' : 'time-outline'}
                      size={14}
                      color={p.isFinalized ? '#10B981' : '#F59E0B'}
                    />
                    <Text style={[styles.statusPillText, { color: p.isFinalized ? '#10B981' : '#F59E0B' }]}>
                      {p.isFinalized ? 'FINALIZED — IMMUTABLE' : 'IN PROGRESS'}
                    </Text>
                  </View>
                </View>

                {/* ── Section 1: Executive Summary ────────────────────────── */}
                <View style={styles.sectionDivider} />
                <View style={styles.sectionHeader}>
                  <Ionicons name="sparkles" size={18} color={Colors.dark.tint} />
                  <Text style={styles.sectionTitle}>1. Executive Summary</Text>
                </View>
                <Text style={styles.execHeadline}>{p.executiveSummary?.headline}</Text>
                <Text style={styles.execNarrative}>{p.executiveSummary?.narrative}</Text>

                <View style={styles.highlightsBox}>
                  <Text style={styles.highlightsHeader}>Key Monthly Highlights:</Text>
                  {p.executiveSummary?.keyHighlights?.map((h: string, i: number) => (
                    <View key={i} style={styles.bulletRow}>
                      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                      <Text style={styles.bulletText}>{h}</Text>
                    </View>
                  ))}
                </View>

                {p.executiveSummary?.keyChallenges?.length > 0 && (
                  <View style={styles.challengesBox}>
                    <Text style={styles.challengesHeader}>Key Challenges Observed:</Text>
                    {p.executiveSummary.keyChallenges.map((c: string, i: number) => (
                      <View key={i} style={styles.bulletRow}>
                        <Ionicons name="alert-circle" size={16} color="#F59E0B" />
                        <Text style={styles.bulletText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Section 2: Performance vs Plan ───────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="trending-up" size={18} color="#38BDF8" />
                    <Text style={styles.sectionTitle}>2. Performance vs Strategic Plan</Text>
                  </View>

                  <View style={styles.kpiGrid}>
                    {p.performanceVsPlan?.kpis?.map((kpi: any, i: number) => {
                      const isAbove = kpi.status === 'ABOVE_PLAN';
                      const isBelow = kpi.status === 'BELOW_PLAN';
                      const isNa = kpi.status === 'NOT_AVAILABLE';

                      return (
                        <View key={i} style={styles.kpiCard}>
                          <View style={styles.kpiTopRow}>
                            <Text style={styles.kpiName}>{kpi.name}</Text>
                            <View
                              style={[
                                styles.kpiStatusBadge,
                                isAbove && styles.kpiBadgeGreen,
                                isBelow && styles.kpiBadgeRed,
                                isNa && styles.kpiBadgeGray,
                              ]}
                            >
                              <Text style={styles.kpiStatusText}>
                                {isNa ? 'N/A' : (kpi.variancePercent > 0 ? `+${kpi.variancePercent}%` : `${kpi.variancePercent}%`)}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.kpiValuesRow}>
                            <View>
                              <Text style={styles.kpiValueLabel}>Actual</Text>
                              <Text style={styles.kpiValueActual}>
                                {kpi.actual !== null ? `${kpi.actual} ${kpi.unit}` : 'NOT CONNECTED'}
                              </Text>
                            </View>
                            {kpi.planTarget !== null && (
                              <View>
                                <Text style={styles.kpiValueLabel}>Plan Target</Text>
                                <Text style={styles.kpiValuePlan}>`${kpi.planTarget} ${kpi.unit}`</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.kpiInterpretation}>{kpi.interpretation}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* ── Section 3: Market & Watchtower ───────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="shield-checkmark" size={18} color="#A78BFA" />
                    <Text style={styles.sectionTitle}>3. Market & Watchtower Intelligence</Text>
                  </View>
                  <Text style={styles.sectionIntro}>{p.marketAndWatchtower?.marketShiftAnalysis}</Text>

                  {p.marketAndWatchtower?.confirmedEvents?.map((ev: any, i: number) => (
                    <View key={i} style={styles.eventCard}>
                      <View style={styles.eventTopRow}>
                        <View style={styles.tagBadge}>
                          <Text style={styles.tagBadgeText}>{ev.competitorName}</Text>
                        </View>
                        <View style={styles.confirmedPill}>
                          <Ionicons name="checkmark-done" size={14} color="#10B981" />
                          <Text style={styles.confirmedPillText}>CONFIRMED MARKET CHANGE</Text>
                        </View>
                      </View>
                      <Text style={styles.eventLabel}>{ev.label}</Text>
                      {ev.oldValue && ev.newValue && (
                        <View style={styles.diffRow}>
                          <Text style={styles.diffOld}>Old: {ev.oldValue}</Text>
                          <Ionicons name="arrow-forward" size={14} color="#94A3B8" />
                          <Text style={styles.diffNew}>New: {ev.newValue}</Text>
                        </View>
                      )}
                      <Text style={styles.whyMattered}>{ev.whyItMattered}</Text>
                      {ev.evidenceNotes?.length > 0 && (
                        <View style={styles.evidenceNotesBox}>
                          <Text style={styles.evidenceLabel}>Evidence Lineage:</Text>
                          {ev.evidenceNotes.map((n: string, ni: number) => (
                            <Text key={ni} style={styles.evidenceText}>• {n}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </View>

                {/* ── Section 4: Strategy Evolution ────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="git-branch" size={18} color="#F43F5E" />
                    <Text style={styles.sectionTitle}>4. Strategy Evolution During the Month</Text>
                  </View>

                  <View style={styles.strategyJourneyBanner}>
                    <View style={styles.strategyJourneyStep}>
                      <Text style={styles.journeyStepLabel}>Period Start</Text>
                      <Text style={styles.journeyStepVal}>Strategy v{p.strategyEvolution?.versionAtPeriodStart}</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={20} color={Colors.dark.tint} />
                    <View style={styles.strategyJourneyStep}>
                      <Text style={styles.journeyStepLabel}>Period End</Text>
                      <Text style={styles.journeyStepVal}>Strategy v{p.strategyEvolution?.versionAtPeriodEnd}</Text>
                    </View>
                  </View>

                  {p.strategyEvolution?.materialUpdates?.map((up: any, i: number) => (
                    <View key={i} style={styles.updateCard}>
                      <View style={styles.updateTopRow}>
                        <View style={styles.updatedBadge}>
                          <Text style={styles.updatedBadgeText}>MATERIAL CHANGE: UPDATED</Text>
                        </View>
                        <Text style={styles.updateDate}>{up.date}</Text>
                      </View>
                      <Text style={styles.updateAuthority}>Authority: {up.affectedAuthority} {up.affectedLaneTitle ? `(${up.affectedLaneTitle})` : ''}</Text>
                      <Text style={styles.updateWhy}>{up.why}</Text>
                      <View style={styles.updateDiffBox}>
                        <Text style={styles.updateDiffTitle}>Summary of Strategic Adjustment:</Text>
                        <Text style={styles.updateDiffBody}>{up.newSummary}</Text>
                      </View>
                    </View>
                  ))}

                  <View style={styles.revalidatedBox}>
                    <Text style={styles.revalidatedTitle}>Revalidated Authorities (Checked — Still Valid):</Text>
                    <View style={styles.revalidatedPillsRow}>
                      {p.strategyEvolution?.revalidatedAuthorities?.map((a: string, i: number) => (
                        <View key={i} style={styles.revalidatedPill}>
                          <Ionicons name="shield-outline" size={12} color="#10B981" />
                          <Text style={styles.revalidatedPillText}>{a}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>

                {/* ── Section 5: Strategic Lanes ───────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="layers" size={18} color="#F59E0B" />
                    <Text style={styles.sectionTitle}>5. Strategic Lane Performance</Text>
                  </View>
                  {p.strategicLanes?.lanes?.map((lane: any, i: number) => (
                    <View key={i} style={styles.laneCard}>
                      <View style={styles.laneTopRow}>
                        <Text style={styles.laneTitle}>{lane.laneTitle}</Text>
                        <View style={styles.roleBadge}>
                          <Text style={styles.roleBadgeText}>{lane.strategicRole}</Text>
                        </View>
                      </View>
                      <Text style={styles.laneRole}>Target Audience: {lane.targetRole}</Text>
                      <Text style={styles.lanePerf}>{lane.performanceSummary}</Text>
                      <View style={styles.laneMetaRow}>
                        <Text style={styles.laneMetaText}>Tasks: {lane.completedTasksCount}/{lane.tasksCount}</Text>
                        <Text style={styles.laneMetaText}>Channels: {lane.primaryChannels?.join(', ')}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* ── Section 6: Execution / WTDT ──────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="checkbox" size={18} color="#10B981" />
                    <Text style={styles.sectionTitle}>6. Execution & Action Summary</Text>
                  </View>
                  <View style={styles.execStatRow}>
                    <View style={styles.execStatBox}>
                      <Text style={styles.execStatNum}>{p.executionSummary?.completionRatePercent}%</Text>
                      <Text style={styles.execStatLabel}>Completion Rate</Text>
                    </View>
                    <View style={styles.execStatBox}>
                      <Text style={styles.execStatNum}>{p.executionSummary?.tasksCompleted}</Text>
                      <Text style={styles.execStatLabel}>Completed</Text>
                    </View>
                    <View style={styles.execStatBox}>
                      <Text style={styles.execStatNum}>{p.executionSummary?.tasksPlanned}</Text>
                      <Text style={styles.execStatLabel}>Planned</Text>
                    </View>
                  </View>
                </View>

                {/* ── Section 7: Adaptation Results ────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="pulse" size={18} color="#EC4899" />
                    <Text style={styles.sectionTitle}>7. Adaptation & Measured Results</Text>
                  </View>
                  {p.adaptationResults?.evaluations?.map((ev: any, i: number) => (
                    <View key={i} style={styles.adaptCard}>
                      <View style={styles.adaptTopRow}>
                        <Text style={styles.adaptAuth}>{ev.authority} Update ({ev.updateDate})</Text>
                        <View style={styles.adaptBadgePending}>
                          <Text style={styles.adaptBadgeText}>{ev.outcome}</Text>
                        </View>
                      </View>
                      <Text style={styles.adaptBody}>Before: {ev.beforeObservation}</Text>
                      <Text style={styles.adaptBody}>After: {ev.afterObservation}</Text>
                    </View>
                  ))}
                </View>

                {/* ── Section 8: Learnings ─────────────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="book" size={18} color="#8B5CF6" />
                    <Text style={styles.sectionTitle}>8. What Avyron Learned This Month</Text>
                  </View>
                  <View style={styles.learningsBox}>
                    {p.monthlyLearnings?.supportedAssumptions?.map((l: string, i: number) => (
                      <View key={i} style={styles.learningRow}>
                        <Ionicons name="bulb-outline" size={16} color="#8B5CF6" />
                        <Text style={styles.learningText}>{l}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* ── Section 9: End-of-Month State ────────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="flag" size={18} color="#06B6D4" />
                    <Text style={styles.sectionTitle}>9. State as of Month Close</Text>
                  </View>
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>Strategy Version: v{p.endOfMonthState?.strategyVersion}</Text>
                    <Text style={styles.stateBrand}>Brand Spine: {p.endOfMonthState?.brandSpine?.positioning}</Text>
                    <Text style={styles.stateLanes}>Active Lanes: {p.endOfMonthState?.activeLaneTitles?.join(', ')}</Text>
                  </View>
                </View>

                {/* ── Section 10: Next Month Attention ─────────────────────── */}
                <View style={styles.cardSection}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="compass" size={18} color="#FBBF24" />
                    <Text style={styles.sectionTitle}>10. Attention Areas for Next Month</Text>
                  </View>
                  {p.nextMonthAttention?.focusAreas?.map((fa: any, i: number) => (
                    <View key={i} style={styles.attentionCard}>
                      <View style={styles.attentionTopRow}>
                        <View style={styles.actionPill}>
                          <Text style={styles.actionPillText}>{fa.actionType}</Text>
                        </View>
                        <Text style={styles.attentionArea}>{fa.area}</Text>
                      </View>
                      <Text style={styles.attentionRationale}>{fa.rationale}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No report data available for this period.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#94A3B8',
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  periodTabsContainer: {
    marginBottom: 16,
  },
  periodTabsContent: {
    gap: 8,
  },
  periodTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  periodTabActive: {
    backgroundColor: '#334155',
    borderColor: Colors.dark.tint,
  },
  periodTabText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14,
  },
  periodTabTextActive: {
    color: '#F8FAFC',
  },
  statusMiniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeFinalized: {
    backgroundColor: '#065F46',
  },
  badgeInProgress: {
    backgroundColor: '#78350F',
  },
  statusMiniBadgeText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  heroPeriodLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusPillFinal: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10B981',
  },
  statusPillProgress: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: '#F59E0B',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  sectionIntro: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  execHeadline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 8,
  },
  execNarrative: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
    marginBottom: 16,
  },
  highlightsBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  highlightsHeader: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  challengesBox: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  challengesHeader: {
    color: '#F59E0B',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
  },
  bulletText: {
    color: '#E2E8F0',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  cardSection: {
    marginTop: 24,
  },
  kpiGrid: {
    gap: 10,
  },
  kpiCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  kpiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kpiName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  kpiStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kpiBadgeGreen: { backgroundColor: '#065F46' },
  kpiBadgeRed: { backgroundColor: '#881337' },
  kpiBadgeGray: { backgroundColor: '#334155' },
  kpiStatusText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  kpiValuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  kpiValueLabel: {
    color: '#94A3B8',
    fontSize: 11,
  },
  kpiValueActual: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  kpiValuePlan: {
    color: '#94A3B8',
    fontSize: 14,
  },
  kpiInterpretation: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  eventCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 10,
  },
  eventTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  tagBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagBadgeText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  confirmedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confirmedPillText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
  },
  eventLabel: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  diffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  diffOld: {
    color: '#EF4444',
    fontSize: 12,
  },
  diffNew: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  whyMattered: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  evidenceNotesBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  evidenceLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  evidenceText: {
    color: '#94A3B8',
    fontSize: 11,
  },
  strategyJourneyBanner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  strategyJourneyStep: {
    alignItems: 'center',
  },
  journeyStepLabel: {
    color: '#94A3B8',
    fontSize: 11,
  },
  journeyStepVal: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  updateCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 10,
  },
  updateTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  updatedBadge: {
    backgroundColor: '#4C1D95',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  updatedBadgeText: {
    color: '#C4B5FD',
    fontSize: 10,
    fontWeight: '800',
  },
  updateDate: {
    color: '#94A3B8',
    fontSize: 12,
  },
  updateAuthority: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  updateWhy: {
    color: '#CBD5E1',
    fontSize: 12,
    marginBottom: 8,
  },
  updateDiffBox: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    padding: 8,
  },
  updateDiffTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  updateDiffBody: {
    color: '#F8FAFC',
    fontSize: 12,
  },
  revalidatedBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#0F172A',
    borderRadius: 8,
  },
  revalidatedTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  revalidatedPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  revalidatedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  revalidatedPillText: {
    color: '#E2E8F0',
    fontSize: 11,
  },
  laneCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  laneTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  laneTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  roleBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  laneRole: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4,
  },
  lanePerf: {
    color: '#CBD5E1',
    fontSize: 12,
    marginBottom: 6,
  },
  laneMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  laneMetaText: {
    color: '#64748B',
    fontSize: 11,
  },
  execStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  execStatBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  execStatNum: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  execStatLabel: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  adaptCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  adaptTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  adaptAuth: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  adaptBadgePending: {
    backgroundColor: '#78350F',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  adaptBadgeText: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '700',
  },
  adaptBody: {
    color: '#CBD5E1',
    fontSize: 12,
    marginTop: 2,
  },
  learningsBox: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  learningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  learningText: {
    color: '#CBD5E1',
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  stateCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  stateTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  stateBrand: {
    color: '#94A3B8',
    fontSize: 12,
  },
  stateLanes: {
    color: '#64748B',
    fontSize: 11,
  },
  attentionCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  attentionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  actionPill: {
    backgroundColor: '#78350F',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  actionPillText: {
    color: '#FDE68A',
    fontSize: 10,
    fontWeight: '800',
  },
  attentionArea: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  attentionRationale: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 16,
  },
  emptyCard: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
});
