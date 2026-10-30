import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { getApiUrl, authFetch, safeApiJson, queryClient } from '@/lib/query-client';

export type DemoScenarioState =
  | 'READY_TO_GENERATE'
  | 'GENERATION'
  | 'STRATEGY_READY'
  | 'MARKET_CHANGE_DETECTED'
  | 'INVESTIGATION_AND_RESPONSE'
  | 'SIMULATED_FOLLOW_UP';

interface ScenarioMeta {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  recommendedRoute: string;
}

interface DemoStatusPayload {
  demoMode: boolean;
  currentState?: DemoScenarioState;
  scenarioMeta?: ScenarioMeta;
  allScenarios?: Record<DemoScenarioState, ScenarioMeta>;
  campaignId?: string;
  accountId?: string;
  brandName?: string;
  offeringName?: string;
  planStatus?: string | null;
  planVersion?: number | null;
  activeRootVersion?: number | null;
  pendingProposalId?: string | null;
  latestJob?: {
    id: string;
    status: string;
    stageIndex: number;
    currentStage: string | null;
  } | null;
  watchtowerEventsCount?: number;
  historicalPerformanceCasesCount?: number;
  pendingProposalsCount?: number;
  appliedProposalsCount?: number;
  deepReasoningScenarios?: Array<{
    scenarioId: string;
    eventId: string;
    proposalId: string;
    reasoningCaseId: string;
    title: string;
    status: string;
    appliedVersion: number | null;
  }>;
}

const SCENARIO_ORDER: DemoScenarioState[] = [
  'READY_TO_GENERATE',
  'GENERATION',
  'STRATEGY_READY',
  'MARKET_CHANGE_DETECTED',
  'INVESTIGATION_AND_RESPONSE',
  'SIMULATED_FOLLOW_UP',
];

export function DemoControlPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<DemoStatusPayload | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [busyState, setBusyState] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch(getApiUrl('/api/demo/status'));
      if (!res.ok) return;
      const data = await safeApiJson(res);
      setStatus(data);
    } catch {
      // Ignore transient errors during startup
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, pathname]);

  // Poll status lightly while generation is running or panel is open
  useEffect(() => {
    if (!status?.demoMode) return;
    const isGenerating = status.currentState === 'GENERATION' || status.latestJob?.status === 'RUNNING';
    if (!isGenerating && !isOpen) return;

    const timer = setInterval(fetchStatus, isGenerating ? 1500 : 4000);
    return () => clearInterval(timer);
  }, [status?.demoMode, status?.currentState, status?.latestJob?.status, isOpen, fetchStatus]);

  // Listen to external state changes (e.g., approving plan from Strategy Plan screen)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = () => {
      fetchStatus();
      queryClient.invalidateQueries();
    };
    window.addEventListener('avyron-demo-state-changed', handler);
    return () => window.removeEventListener('avyron-demo-state-changed', handler);
  }, [fetchStatus]);

  const notifyDemoStateChanged = (detail: any) => {
    queryClient.invalidateQueries();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('avyron-demo-state-changed', { detail }));
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  const handleApplyScenario = async (targetState: DemoScenarioState, navigateToRecommended = false) => {
    if (busyState) return;
    setBusyState(targetState);
    try {
      const res = await authFetch(getApiUrl('/api/demo/scenario'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState }),
      });
      const data = await safeApiJson(res);
      if (data?.status) {
        setStatus(data.status);
      } else {
        await fetchStatus();
      }
      notifyDemoStateChanged({ state: targetState, jobId: data?.jobId, status: data?.status });
      const label = status?.allScenarios?.[targetState]?.label || targetState;
      showToast(`Loaded ${label}`);

      if (navigateToRecommended || targetState === 'GENERATION') {
        const route = data?.status?.scenarioMeta?.recommendedRoute || status?.allScenarios?.[targetState]?.recommendedRoute;
        if (route) {
          setIsOpen(false);
          router.push(route as any);
        }
      }
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to switch scenario'}`);
    } finally {
      setBusyState(null);
    }
  };

  const handleReset = async () => {
    if (busyState) return;
    setBusyState('RESET');
    try {
      const res = await authFetch(getApiUrl('/api/demo/reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'MARKET_CHANGE_DETECTED' }),
      });
      const data = await safeApiJson(res);
      if (data?.status) {
        setStatus(data.status);
      } else {
        await fetchStatus();
      }
      notifyDemoStateChanged({ state: 'MARKET_CHANGE_DETECTED', status: data?.status, reset: true });
      showToast('Reset to Recording Baseline: Strategy v1 · 10 events · 3 pending scenarios');
    } catch (err: any) {
      showToast(`Reset error: ${err.message}`);
    } finally {
      setBusyState(null);
    }
  };

  if (!status?.demoMode) {
    return null;
  }

  const currentCode = status.scenarioMeta?.code || 'C';
  const currentShort = status.scenarioMeta?.shortLabel || 'Demo Mode';

  return (
    <View style={styles.rootOverlay} pointerEvents="box-none">
      {/* Toast Notification */}
      {toastMsg && (
        <View style={styles.toastBox}>
          <Feather name="check-circle" size={13} color="#10B981" />
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      )}

      {/* Expanded Control Drawer */}
      {isOpen && (
        <View style={styles.panelCard}>
          {/* Header */}
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderLeft}>
              <View style={styles.demoDot} />
              <View>
                <Text style={styles.panelTitle}>DEMO RECORDING CONTROLS</Text>
                <Text style={styles.panelSubtitle}>
                  {status.brandName || 'Zeytun Atelier'} · Isolated Neon Branch
                </Text>
              </View>
            </View>
            <Pressable onPress={() => setIsOpen(false)} style={styles.closeBtn}>
              <Feather name="x" size={16} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Current Status Strip */}
          <View style={styles.statusStrip}>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillLabel}>STATE {currentCode}</Text>
              <Text style={styles.statusPillValue}>{currentShort}</Text>
            </View>
            <View style={styles.statusMetaRight}>
              <Text style={styles.statusMetaText}>
                Plan: {status.planStatus || 'NONE'}{' '}
                {status.activeRootVersion ? `(v${status.activeRootVersion})` : ''}
              </Text>
            </View>
          </View>

          {/* Live Deep Reasoning Scenario Status */}
          {Array.isArray(status.deepReasoningScenarios) && status.deepReasoningScenarios.length > 0 && (
            <View style={styles.scenarioStatusBox}>
              <Text style={styles.sectionHeading}>
                RECORDING STATE · {status.watchtowerEventsCount ?? 0} EVENTS · {status.historicalPerformanceCasesCount ?? 0} PERF CASES
              </Text>
              {status.deepReasoningScenarios.map((s) => {
                const applied = s.status === 'APPLIED';
                return (
                  <View key={s.scenarioId} style={styles.scenarioStatusRow}>
                    <Text style={styles.scenarioStatusId}>{s.scenarioId.replace('SCENARIO_', '').split('_')[0]}</Text>
                    <Text style={styles.scenarioStatusTitle} numberOfLines={1}>{s.title}</Text>
                    <Text style={[styles.scenarioStatusValue, applied && { color: '#34D399' }]}>
                      {applied ? `APPLIED v${s.appliedVersion ?? ''}` : s.status === 'PENDING_USER_APPROVAL' ? 'INVESTIGATED' : 'PENDING'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Quick Recording Actions */}
          <View style={styles.quickActionsGrid}>
            <Pressable
              style={[styles.quickBtn, styles.quickBtnReset, { width: '100%', borderColor: '#8B5CF6' }]}
              onPress={handleReset}
              disabled={!!busyState}
            >
              {busyState === 'RESET' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="rotate-ccw" size={12} color="#F8FAFC" />
              )}
              <Text style={styles.quickBtnText}>Reset to Recording Baseline (v1 + 10 Events + 3 Pending)</Text>
            </Pressable>

            <Pressable
              style={[styles.quickBtn, styles.quickBtnGen]}
              onPress={() => handleApplyScenario('GENERATION', true)}
              disabled={!!busyState}
            >
              <Feather name="play" size={12} color="#E9D5FF" />
              <Text style={[styles.quickBtnText, { color: '#E9D5FF' }]}>Run Generation (B)</Text>
            </Pressable>

            <Pressable
              style={[styles.quickBtn, styles.quickBtnMarket]}
              onPress={() => handleApplyScenario('MARKET_CHANGE_DETECTED', true)}
              disabled={!!busyState}
            >
              <Feather name="eye" size={12} color="#FDE68A" />
              <Text style={[styles.quickBtnText, { color: '#FDE68A' }]}>Trigger Market Event (D)</Text>
            </Pressable>

            <Pressable
              style={[styles.quickBtn, styles.quickBtnFollowUp]}
              onPress={() => handleApplyScenario('SIMULATED_FOLLOW_UP', true)}
              disabled={!!busyState}
            >
              <Feather name="trending-up" size={12} color="#A7F3D0" />
              <Text style={[styles.quickBtnText, { color: '#A7F3D0' }]}>Advance Follow-Up (F)</Text>
            </Pressable>
          </View>

          {/* Scenario Jump List */}
          <Text style={styles.sectionHeading}>JUMP TO SCENARIO STATE</Text>
          <ScrollView style={styles.scenarioList} showsVerticalScrollIndicator={false}>
            {SCENARIO_ORDER.map((stateKey) => {
              const meta = status.allScenarios?.[stateKey];
              if (!meta) return null;
              const isCurrent = status.currentState === stateKey;
              const isBusy = busyState === stateKey;

              return (
                <View
                  key={stateKey}
                  style={[styles.scenarioRow, isCurrent && styles.scenarioRowActive]}
                >
                  <View style={styles.scenarioInfo}>
                    <View style={styles.scenarioTitleRow}>
                      <View style={[styles.codeBadge, isCurrent && styles.codeBadgeActive]}>
                        <Text style={[styles.codeBadgeText, isCurrent && styles.codeBadgeTextActive]}>
                          {meta.code}
                        </Text>
                      </View>
                      <Text style={[styles.scenarioLabel, isCurrent && styles.scenarioLabelActive]}>
                        {meta.shortLabel}
                      </Text>
                      {isCurrent && (
                        <View style={styles.activeTag}>
                          <Text style={styles.activeTagText}>ACTIVE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.scenarioDesc} numberOfLines={2}>
                      {meta.description}
                    </Text>
                  </View>

                  <View style={styles.scenarioActions}>
                    <Pressable
                      style={[styles.loadBtn, isCurrent && styles.loadBtnActive]}
                      onPress={() => handleApplyScenario(stateKey, false)}
                      disabled={!!busyState}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.loadBtnText}>{isCurrent ? 'Reload' : 'Load'}</Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={styles.goBtn}
                      onPress={() => handleApplyScenario(stateKey, true)}
                      disabled={!!busyState}
                    >
                      <Feather name="arrow-up-right" size={13} color="#C4B5FD" />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footerNote}>
            <Feather name="shield" size={11} color="#64748B" />
            <Text style={styles.footerNoteText}>
              Zero external LLM/Apify calls · Synthetic dataset only
            </Text>
          </View>
        </View>
      )}

      {/* Discreet Persistent Demo Badge */}
      <Pressable
        style={[styles.badgeButton, isOpen && styles.badgeButtonActive]}
        onPress={() => setIsOpen((prev) => !prev)}
      >
        <View style={styles.badgePulseDot} />
        <Text style={styles.badgeLabel}>DEMO</Text>
        <View style={styles.badgeDivider} />
        <Text style={styles.badgeStateText}>
          {currentCode}: {currentShort}
        </Text>
        <Feather
          name={isOpen ? 'chevron-down' : 'sliders'}
          size={12}
          color="#C4B5FD"
          style={{ marginLeft: 4 }}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rootOverlay: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'flex-end',
  },
  toastBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#10B98150',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  toastText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  badgeButtonActive: {
    backgroundColor: '#1E1B4B',
    borderColor: '#8B5CF6',
  },
  badgePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  badgeLabel: {
    color: '#E9D5FF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  badgeDivider: {
    width: 1,
    height: 11,
    backgroundColor: 'rgba(148, 163, 184, 0.35)',
  },
  badgeStateText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
  panelCard: {
    width: 390,
    maxHeight: 540,
    backgroundColor: '#0B0F17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  panelHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  demoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
  },
  panelTitle: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  panelSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPillLabel: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: 'rgba(139, 92, 246, 0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusPillValue: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
  },
  statusMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusMetaText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  scenarioStatusBox: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
  },
  scenarioStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  scenarioStatusId: {
    color: '#C4B5FD',
    fontSize: 10,
    fontWeight: '800',
    width: 14,
  },
  scenarioStatusTitle: {
    color: '#CBD5E1',
    fontSize: 10,
    flex: 1,
  },
  scenarioStatusValue: {
    color: '#FBBF24',
    fontSize: 9,
    fontWeight: '800',
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  quickBtn: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
  },
  quickBtnReset: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  quickBtnGen: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderColor: 'rgba(139, 92, 246, 0.45)',
  },
  quickBtnMarket: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  quickBtnFollowUp: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  quickBtnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionHeading: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  scenarioList: {
    maxHeight: 260,
  },
  scenarioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    gap: 8,
  },
  scenarioRowActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    borderColor: '#8B5CF6',
  },
  scenarioInfo: {
    flex: 1,
  },
  scenarioTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  codeBadge: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBadgeActive: {
    backgroundColor: '#8B5CF6',
  },
  codeBadgeText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
  },
  codeBadgeTextActive: {
    color: '#FFFFFF',
  },
  scenarioLabel: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  scenarioLabelActive: {
    color: '#FFFFFF',
  },
  activeTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activeTagText: {
    color: '#10B981',
    fontSize: 9,
    fontWeight: '800',
  },
  scenarioDesc: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 14,
  },
  scenarioActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  loadBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  loadBtnActive: {
    backgroundColor: '#4C1D95',
    borderColor: '#7C3AED',
  },
  loadBtnText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '700',
  },
  goBtn: {
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
    padding: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  footerNoteText: {
    color: '#64748B',
    fontSize: 10,
  },
});
