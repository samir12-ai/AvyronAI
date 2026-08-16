import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  FlatList,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useAppShellController } from '@/hooks/useAppShellController';
import { GlobalHeader } from '@/components/GlobalHeader';
import {
  useMarketSignals,
  useStrategicBrief,
  useGenerateStrategicBrief,
  useRetryStrategicBrief,
  type MarketSignal,
} from '@/hooks/usePerception';

// ── helpers ─────────────────────────────────────────────────────────────────

function severityColor(s: string) {
  const v = s?.toLowerCase() || '';
  if (v === 'major' || v === 'high') return '#EF4444';
  if (v === 'medium') return '#F59E0B';
  return '#3B82F6';
}

function statusMeta(status: string): { label: string; color: string; bg: string } {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    awaiting_analysis: { label: 'Awaiting Analysis', color: '#6B7280', bg: '#6B728018' },
    queued:            { label: 'Queued',             color: '#8B5CF6', bg: '#8B5CF618' },
    generating:        { label: 'Generating…',        color: '#8B5CF6', bg: '#8B5CF618' },
    validating:        { label: 'Validating…',        color: '#A78BFA', bg: '#A78BFA18' },
    ready:             { label: 'Analysis Ready',     color: '#10B981', bg: '#10B98118' },
    insufficient_evidence: { label: 'Low Evidence',   color: '#6B7280', bg: '#6B728018' },
    failed:            { label: 'Failed',             color: '#EF4444', bg: '#EF444418' },
  };
  return map[status] || { label: status, color: '#9CA3AF', bg: '#9CA3AF18' };
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function confidenceColor(n: number) {
  if (n >= 70) return '#10B981';
  if (n >= 50) return '#F59E0B';
  return '#EF4444';
}

function inArray(val: string, arr: string[]) {
  return arr.includes(val);
}

// ── component ────────────────────────────────────────────────────────────────

export default function ReasoningEvidenceScreen() {
  const { user } = useAuth();
  const shellController = useAppShellController();
  const campaignId = shellController.activeWorkspace?.id;

  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedEvidenceRef, setExpandedEvidenceRef] = useState<string | null>(null);

  const { data: signalsData, isLoading: signalsLoading, refetch: refetchSignals } =
    useMarketSignals(campaignId, 50);

  const confirmedSignals = (signalsData?.signals || []).filter((s) => s.status === 'confirmed');

  useEffect(() => {
    if (confirmedSignals.length > 0 && !selectedEventId) {
      setSelectedEventId(confirmedSignals[0].id);
    }
  }, [confirmedSignals]);

  const { data: briefData, isLoading: briefLoading, refetch: refetchBrief } =
    useStrategicBrief(campaignId, selectedEventId);

  const generateMutation = useGenerateStrategicBrief(campaignId, selectedEventId);
  const retryMutation = useRetryStrategicBrief(campaignId, briefData?.data?.id);

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync();
      refetchBrief();
    } catch (e) {
      console.error('Failed to trigger brief generation:', e);
    }
  };

  const handleRetry = async () => {
    try {
      await retryMutation.mutateAsync();
      refetchBrief();
    } catch (e) {
      console.error('Failed to retry brief generation:', e);
    }
  };

  const status = briefData?.data?.status || 'awaiting_analysis';
  const brief = briefData?.data?.brief;
  const registry = briefData?.data?.evidenceRegistry || [];
  const failureDetails = briefData?.data?.failureDetails;
  const finalConf = briefData?.data?.finalValidatedConfidence || 0;
  const modelConf = briefData?.data?.modelProposedConfidence || 0;
  const sm = statusMeta(status);

  return (
    <View style={styles.root}>
      <GlobalHeader title="REASONING EVIDENCE" />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconWrap}>
            <Feather name="cpu" size={16} color="#7C3AED" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Strategic Interpretation Console</Text>
            <Text style={styles.headerSub}>
              Traceable business implications from confirmed Watchtower signals
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {/* Confidence badge when ready */}
          {status === 'ready' && (
            <View style={[styles.confBadge, { borderColor: confidenceColor(finalConf) + '40', backgroundColor: confidenceColor(finalConf) + '12' }]}>
              <Feather name="shield" size={11} color={confidenceColor(finalConf)} />
              <Text style={[styles.confBadgeText, { color: confidenceColor(finalConf) }]}>
                {finalConf}% confidence
              </Text>
            </View>
          )}
          {/* status pill */}
          <View style={[styles.statusPill, { backgroundColor: sm.bg, borderColor: sm.color + '40' }]}>
            {inArray(status, ['queued', 'generating', 'validating']) && (
              <ActivityIndicator size="small" color={sm.color} style={{ transform: [{ scale: 0.6 }], marginRight: -2 }} />
            )}
            <Text style={[styles.statusPillText, { color: sm.color }]}>{sm.label}</Text>
          </View>

          <Pressable onPress={() => refetchSignals()} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={14} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {/* ── WORKSPACE (3 columns) ── */}
      <View style={styles.workspace}>

        {/* LEFT COLUMN — Confirmed event inbox */}
        <View style={[styles.inboxCol, !isDesktop && { display: selectedEventId ? 'none' : 'flex' }]}>
          <View style={styles.colHeader}>
            <Text style={styles.colTitle}>Confirmed Signals</Text>
            <View style={styles.colCountPill}>
              <Text style={styles.colCountText}>{confirmedSignals.length}</Text>
            </View>
          </View>

          {signalsLoading ? (
            <View style={styles.colLoading}>
              <ActivityIndicator size="small" color="#7C3AED" />
            </View>
          ) : confirmedSignals.length === 0 ? (
            <View style={styles.colEmpty}>
              <View style={styles.colEmptyIcon}>
                <Feather name="check-circle" size={22} color="#374151" />
              </View>
              <Text style={styles.colEmptyText}>No confirmed signals yet</Text>
              <Text style={styles.colEmptySubtext}>
                Watchtower events appear here once validated
              </Text>
            </View>
          ) : (
            <FlatList
              data={confirmedSignals}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 12, paddingBottom: 60 }}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedEventId;
                const sColor = severityColor(item.severity);
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedEventId(item.id);
                      setExpandedEvidenceRef(null);
                    }}
                    style={[styles.eventCard, isSelected && styles.eventCardSelected]}
                  >
                    {/* severity bar */}
                    <View style={[styles.eventSeverityBar, { backgroundColor: sColor }]} />

                    <View style={styles.eventCardBody}>
                      <View style={styles.eventCardTop}>
                        <Text style={styles.eventCompetitor} numberOfLines={1}>
                          {item.competitor || 'Unknown'}
                        </Text>
                        <View style={[styles.severityChip, { backgroundColor: sColor + '20', borderColor: sColor + '40' }]}>
                          <Text style={[styles.severityChipText, { color: sColor }]}>
                            {(item.severity || 'low').toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.eventLabel} numberOfLines={2}>
                        {item.label}
                      </Text>
                      <View style={styles.eventMeta}>
                        <Feather name="clock" size={11} color="#4B5563" />
                        <Text style={styles.eventTime}>
                          {relativeDate(item.detectedAt)}
                        </Text>
                        {item.scope && (
                          <>
                            <View style={styles.metaDot} />
                            <Text style={styles.eventTime}>
                              {item.scope.replace(/_/g, ' ')}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </View>

        {/* CENTER COLUMN — Strategic Brief */}
        {(isDesktop || selectedEventId) ? (
          <View style={[styles.briefCol, !isDesktop && { flex: 1 }]}>
            <ScrollView
              contentContainerStyle={styles.briefScroll}
              showsVerticalScrollIndicator={false}
            >
              {!selectedEventId ? (
                <View style={styles.centerPlaceholder}>
                  <View style={styles.placeholderIcon}>
                    <Feather name="zap" size={28} color="#374151" />
                  </View>
                  <Text style={styles.placeholderTitle}>Select a signal</Text>
                  <Text style={styles.placeholderBody}>
                    Choose a confirmed Watchtower event from the inbox to run a strategic brief.
                  </Text>
                </View>
              ) : (
                <>
                  {/* ── Awaiting ── */}
                  {status === 'awaiting_analysis' && (
                    <View style={styles.actionState}>
                      <View style={styles.actionStateIcon}>
                        <Feather name="shield" size={30} color="#4B5563" />
                      </View>
                      <Text style={styles.actionStateTitle}>Analysis not yet run</Text>
                      <Text style={styles.actionStateBody}>
                        This event is confirmed. Generate a strategic brief to understand its business implications, affected areas, and recommended response.
                      </Text>
                      <Pressable
                        onPress={handleGenerate}
                        disabled={generateMutation.isPending}
                        style={styles.generateBtn}
                      >
                        {generateMutation.isPending ? (
                          <ActivityIndicator size="small" color="#0F131A" />
                        ) : (
                          <>
                            <Feather name="zap" size={15} color="#0F131A" />
                            <Text style={styles.generateBtnText}>Generate Strategic Brief</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}

                  {/* ── In-progress ── */}
                  {inArray(status, ['queued', 'generating', 'validating']) && (
                    <View style={styles.actionState}>
                      <View style={[styles.actionStateIcon, { backgroundColor: '#7C3AED18', borderColor: '#7C3AED30' }]}>
                        <ActivityIndicator size="large" color="#7C3AED" />
                      </View>
                      <Text style={styles.actionStateTitle}>
                        {status === 'queued' ? 'Queued for analysis…' : status === 'generating' ? 'Generating brief…' : 'Validating grounding…'}
                      </Text>
                      <Text style={styles.actionStateBody}>
                        {status === 'validating'
                          ? 'Running claim-level validation rules and grounding judge. Almost done.'
                          : 'Collecting context, running LLM interpretation, and verifying evidence. Usually 5–15 seconds.'}
                      </Text>
                      {/* progress steps */}
                      <View style={styles.progressSteps}>
                        <ProgressStep done label="Context collection" active={status === 'queued'} />
                        <ProgressStep done={inArray(status, ['validating'])} label="LLM interpretation" active={status === 'generating'} />
                        <ProgressStep done={false} label="Grounding judge" active={status === 'validating'} />
                      </View>
                    </View>
                  )}

                  {/* ── Failed ── */}
                  {status === 'failed' && (
                    <View style={styles.actionState}>
                      <View style={[styles.actionStateIcon, { backgroundColor: '#EF444418', borderColor: '#EF444430' }]}>
                        <Feather name="alert-octagon" size={28} color="#EF4444" />
                      </View>
                      <Text style={[styles.actionStateTitle, { color: '#EF4444' }]}>Brief generation failed</Text>
                      <Text style={styles.actionStateBody}>
                        {failureDetails?.message || 'Validation rules or grounding judge rejected the output.'}
                      </Text>
                      {failureDetails?.stage && (
                        <View style={styles.failedStage}>
                          <Text style={styles.failedStageText}>Failed at: {failureDetails.stage}</Text>
                        </View>
                      )}
                      <Pressable
                        onPress={handleRetry}
                        disabled={retryMutation.isPending}
                        style={styles.retryBtn}
                      >
                        {retryMutation.isPending ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <>
                            <Feather name="refresh-cw" size={14} color="#fff" />
                            <Text style={styles.retryBtnText}>Retry Analysis</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}

                  {/* ── Insufficient evidence ── */}
                  {status === 'insufficient_evidence' && (
                    <View style={styles.actionState}>
                      <View style={[styles.actionStateIcon, { backgroundColor: '#6B728018', borderColor: '#6B728030' }]}>
                        <Feather name="database" size={28} color="#6B7280" />
                      </View>
                      <Text style={styles.actionStateTitle}>Insufficient evidence</Text>
                      <Text style={styles.actionStateBody}>
                        Context adapters ran but found too little data to form a grounded strategic brief without guessing.
                      </Text>
                      {(brief?.missingEvidence || []).length > 0 && (
                        <View style={styles.missingBox}>
                          <Text style={styles.missingTitle}>Evidence gaps:</Text>
                          {(brief?.missingEvidence || []).map((m: string, i: number) => (
                            <Text key={i} style={styles.missingItem}>· {m}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {/* ── Ready Brief ── */}
                  {status === 'ready' && brief && (
                    <View style={styles.briefSections}>

                      {/* Executive Summary card */}
                      <View style={[styles.section, styles.sectionSummary]}>
                        <View style={styles.sectionLabelRow}>
                          <Feather name="file-text" size={13} color="#3B82F6" />
                          <Text style={[styles.sectionLabel, { color: '#3B82F6' }]}>Executive Summary</Text>
                        </View>
                        <Text style={styles.summaryText}>{brief.executiveSummary}</Text>
                      </View>

                      {/* Two-column: Strategic Interpretation + Direction */}
                      <View style={styles.row2}>
                        <BriefCard icon="trending-up" label="Strategic Interpretation" text={brief.strategicInterpretation} flex />
                        <BriefCard icon="arrow-right" label="Direction of Movement" text={brief.directionOfMovement} flex />
                      </View>

                      {/* Likely objective */}
                      <BriefCard icon="target" label="Likely Strategic Objective" text={brief.likelyStrategicObjective} />

                      {/* Impact on our strategy */}
                      <View style={[styles.section, styles.sectionImpact]}>
                        <View style={styles.sectionLabelRow}>
                          <Feather name="alert-triangle" size={13} color="#F59E0B" />
                          <Text style={[styles.sectionLabel, { color: '#F59E0B' }]}>Impact on Our Strategy</Text>
                        </View>
                        <Text style={styles.sectionBody}>{brief.impactOnOurStrategy}</Text>
                      </View>

                      {/* Affected strategy areas */}
                      {(brief.affectedStrategyAreas || []).length > 0 && (
                        <View style={styles.section}>
                          <View style={styles.sectionLabelRow}>
                            <Feather name="layers" size={13} color="#9CA3AF" />
                            <Text style={styles.sectionLabel}>Affected Strategy Areas</Text>
                          </View>
                          <View style={styles.tagRow}>
                            {(brief.affectedStrategyAreas || []).map((area: string, i: number) => (
                              <View key={i} style={styles.tag}>
                                <Text style={styles.tagText}>{area}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      {/* Market significance */}
                      {brief.marketSignificance && (
                        <BriefCard icon="globe" label="Market Significance" text={brief.marketSignificance} />
                      )}

                      {/* Missing evidence */}
                      {(brief.missingEvidence || []).length > 0 && (
                        <View style={[styles.section, { borderColor: '#F59E0B30' }]}>
                          <View style={styles.sectionLabelRow}>
                            <Feather name="info" size={13} color="#F59E0B" />
                            <Text style={[styles.sectionLabel, { color: '#F59E0B' }]}>Uncertainties</Text>
                          </View>
                          {(brief.missingEvidence || []).map((m: string, i: number) => (
                            <Text key={i} style={styles.bulletItem}>· {m}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        ) : null}

        {/* RIGHT COLUMN — Trust & Lineage rail */}
        {isDesktop && selectedEventId && (
          <View style={styles.trustCol}>
            <ScrollView contentContainerStyle={styles.trustScroll} showsVerticalScrollIndicator={false}>

              {/* Confidence meter */}
              {status === 'ready' && (
                <View style={styles.trustCard}>
                  <View style={styles.trustCardHeader}>
                    <Feather name="shield" size={13} color="#9CA3AF" />
                    <Text style={styles.trustCardTitle}>Confidence Score</Text>
                  </View>
                  <View style={styles.confMeterRow}>
                    <Text style={[styles.confScore, { color: confidenceColor(finalConf) }]}>
                      {finalConf}%
                    </Text>
                    <View style={styles.confTrack}>
                      <View style={[styles.confFill, { width: `${finalConf}%` as any, backgroundColor: confidenceColor(finalConf) }]} />
                    </View>
                  </View>
                  <Text style={styles.confSub}>Model proposed: {modelConf}%</Text>
                  {(briefData?.data?.confidenceAdjustmentReasons || []).length > 0 && (
                    <View style={styles.adjList}>
                      {(briefData?.data?.confidenceAdjustmentReasons || []).map((r: string, i: number) => (
                        <View key={i} style={styles.adjRow}>
                          <Feather name="minus" size={10} color="#6B7280" />
                          <Text style={styles.adjText}>{r}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Claim-level grounding */}
              {status === 'ready' && brief && (brief.claims || []).length > 0 && (
                <View style={styles.trustCard}>
                  <View style={styles.trustCardHeader}>
                    <Feather name="check-square" size={13} color="#9CA3AF" />
                    <Text style={styles.trustCardTitle}>Claim Grounding</Text>
                    <View style={styles.judgeVerdict}>
                      <Text style={[styles.judgeVerdictText, {
                        color: (briefData?.data as any)?.judgeResult?.verdict === 'PASS' ? '#10B981' : '#EF4444'
                      }]}>
                        {(briefData?.data as any)?.judgeResult?.verdict || '—'}
                      </Text>
                    </View>
                  </View>
                  {(brief.claims || []).map((claim: any, i: number) => {
                    const jc = ((briefData?.data as any)?.judgeResult?.claims || []).find(
                      (c: any) => c.claimId === claim.claimId
                    );
                    const supported = jc?.verdict === 'supported';
                    return (
                      <View key={i} style={styles.claimRow}>
                        <View style={[styles.claimDot, { backgroundColor: supported ? '#10B981' : '#F59E0B' }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.claimText}>{claim.claimText}</Text>
                          <Text style={styles.claimMeta}>
                            {claim.factuality} · refs: {(claim.evidenceRefs || []).join(', ')}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Evidence Registry */}
              {registry.length > 0 && (
                <View style={styles.trustCard}>
                  <View style={styles.trustCardHeader}>
                    <Feather name="database" size={13} color="#9CA3AF" />
                    <Text style={styles.trustCardTitle}>Evidence Registry</Text>
                    <View style={styles.regCount}>
                      <Text style={styles.regCountText}>{registry.length}</Text>
                    </View>
                  </View>
                  {registry.map((item: any, i: number) => {
                    const expanded = expandedEvidenceRef === item.ref;
                    return (
                      <View key={i} style={styles.regItem}>
                        <Pressable
                          onPress={() => setExpandedEvidenceRef(expanded ? null : item.ref)}
                          style={styles.regRow}
                        >
                          <Text style={styles.regRef}>[{item.ref}]</Text>
                          <Text style={styles.regLabel} numberOfLines={1}>{item.label}</Text>
                          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={11} color="#4B5563" />
                        </Pressable>
                        {expanded && (
                          <View style={styles.regDetail}>
                            <Text style={styles.regDetailText}>{item.detail}</Text>
                            <Text style={styles.regSource}>
                              {item.sourceEngine} · {item.table} · {item.freshnessStatus}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Pipeline versions */}
              {briefData?.data && (
                <View style={styles.trustCard}>
                  <View style={styles.trustCardHeader}>
                    <Feather name="git-branch" size={13} color="#9CA3AF" />
                    <Text style={styles.trustCardTitle}>Pipeline Versions</Text>
                  </View>
                  {[
                    ['Generator', briefData.data.sourceVersions?.generatorVersion],
                    ['Prompt', briefData.data.sourceVersions?.promptVersion],
                    ['Judge', briefData.data.sourceVersions?.judgeVersion],
                    ['Fingerprint', (briefData.data as any).contextFingerprint
                      ? (briefData.data as any).contextFingerprint.slice(0, 14) + '…'
                      : 'pending'],
                  ].map(([k, v]) => (
                    <View key={k} style={styles.versionRow}>
                      <Text style={styles.versionKey}>{k}</Text>
                      <Text style={styles.versionVal}>{v || '—'}</Text>
                    </View>
                  ))}
                </View>
              )}

            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BriefCard({
  icon, label, text, flex,
}: {
  icon: string; label: string; text?: string; flex?: boolean;
}) {
  return (
    <View style={[briefCardStyles.card, flex && { flex: 1 }]}>
      <View style={briefCardStyles.labelRow}>
        <Feather name={icon as any} size={12} color="#6B7280" />
        <Text style={briefCardStyles.label}>{label}</Text>
      </View>
      <Text style={briefCardStyles.body}>{text || '—'}</Text>
    </View>
  );
}

function ProgressStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <View style={progStyles.row}>
      <View style={[
        progStyles.dot,
        done && progStyles.dotDone,
        active && progStyles.dotActive,
      ]}>
        {done && <Feather name="check" size={9} color="#0F131A" />}
        {active && !done && <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.5 }] }} />}
      </View>
      <Text style={[progStyles.label, active && progStyles.labelActive, done && progStyles.labelDone]}>
        {label}
      </Text>
    </View>
  );
}

// ── StyleSheets ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0F13' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#070B12',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#7C3AED18',
    borderWidth: 1,
    borderColor: '#7C3AED30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#F9FAFB', letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: '#4B5563', marginTop: 2 },

  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  confBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  confBadgeText: { fontSize: 12, fontWeight: '700' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillText: { fontSize: 11, fontWeight: '600' },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
  },

  workspace: { flex: 1, flexDirection: 'row' },

  // Inbox column
  inboxCol: {
    width: 280,
    borderRightWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#070B12',
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#111827',
  },
  colTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  colCountPill: {
    backgroundColor: '#1E2535',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  colCountText: { fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  colLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  colEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  colEmptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  colEmptyText: { fontSize: 14, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
  colEmptySubtext: { fontSize: 12, color: '#374151', textAlign: 'center', lineHeight: 18 },

  // Event cards in inbox
  eventCard: {
    flexDirection: 'row',
    backgroundColor: '#0A0F18',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 8,
    overflow: 'hidden',
  },
  eventCardSelected: {
    borderColor: '#7C3AED60',
    backgroundColor: '#7C3AED08',
  },
  eventSeverityBar: { width: 3, borderRadius: 1 },
  eventCardBody: { flex: 1, padding: 12 },
  eventCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  eventCompetitor: { fontSize: 12, fontWeight: '700', color: '#F9FAFB', flex: 1, marginRight: 6 },
  severityChip: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  severityChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  eventLabel: { fontSize: 12, color: '#D1D5DB', lineHeight: 17, marginBottom: 7 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eventTime: { fontSize: 11, color: '#4B5563' },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#374151' },

  // Brief column
  briefCol: {
    flex: 1,
    borderRightWidth: 1,
    borderColor: '#111827',
  },
  briefScroll: { padding: 20, paddingBottom: 60 },

  // Center placeholder
  centerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  placeholderIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  placeholderTitle: { fontSize: 16, fontWeight: '700', color: '#6B7280' },
  placeholderBody: { fontSize: 13, color: '#374151', textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  // Action states (awaiting / in-progress / failed)
  actionState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 14,
  },
  actionStateIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  actionStateTitle: { fontSize: 18, fontWeight: '700', color: '#F9FAFB', textAlign: 'center' },
  actionStateBody: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 400,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#10B981',
    marginTop: 4,
  },
  generateBtnText: { fontSize: 14, fontWeight: '700', color: '#0F131A' },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    marginTop: 4,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  failedStage: {
    backgroundColor: '#EF444412',
    borderWidth: 1,
    borderColor: '#EF444430',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  failedStageText: { fontSize: 12, color: '#EF4444' },
  missingBox: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#0F1520',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 16,
    gap: 6,
  },
  missingTitle: { fontSize: 12, fontWeight: '700', color: '#9CA3AF' },
  missingItem: { fontSize: 13, color: '#6B7280', lineHeight: 19 },

  // Progress steps
  progressSteps: { gap: 10, marginTop: 4, alignSelf: 'stretch', maxWidth: 360 },

  // Ready brief sections
  briefSections: { gap: 14 },
  section: {
    backgroundColor: '#0A0F18',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
  },
  sectionSummary: { borderColor: '#3B82F630', backgroundColor: '#3B82F608' },
  sectionImpact: { borderColor: '#F59E0B30', backgroundColor: '#F59E0B06' },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionBody: { fontSize: 14, color: '#E5E7EB', lineHeight: 22 },
  summaryText: { fontSize: 15, color: '#93C5FD', lineHeight: 24, fontWeight: '500' },

  row2: { flexDirection: 'row', gap: 12 },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1E2535',
    borderWidth: 1,
    borderColor: '#374151',
  },
  tagText: { fontSize: 12, color: '#D1D5DB', fontWeight: '500' },

  bulletItem: { fontSize: 13, color: '#9CA3AF', lineHeight: 20, marginBottom: 2 },

  // Trust column
  trustCol: {
    width: 240,
    backgroundColor: '#070B12',
  },
  trustScroll: { padding: 14, gap: 12, paddingBottom: 60 },
  trustCard: {
    backgroundColor: '#0A0F18',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 14,
    marginBottom: 12,
  },
  trustCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  trustCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    flex: 1,
  },

  // Confidence
  confMeterRow: { marginBottom: 6 },
  confScore: { fontSize: 30, fontWeight: '800', marginBottom: 8 },
  confTrack: {
    height: 4,
    backgroundColor: '#1E2535',
    borderRadius: 2,
    overflow: 'hidden',
  },
  confFill: { height: 4, borderRadius: 2 },
  confSub: { fontSize: 11, color: '#4B5563', marginTop: 6 },
  adjList: { marginTop: 10, gap: 5, borderTopWidth: 1, borderColor: '#1E2535', paddingTop: 8 },
  adjRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  adjText: { fontSize: 11, color: '#6B7280', flex: 1, lineHeight: 16 },

  // Judge verdict
  judgeVerdict: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: '#10B98118',
  },
  judgeVerdictText: { fontSize: 10, fontWeight: '800' },

  // Claims
  claimRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  claimDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 4 },
  claimText: { fontSize: 12, color: '#D1D5DB', lineHeight: 17 },
  claimMeta: { fontSize: 10, color: '#4B5563', marginTop: 2 },

  // Registry
  regCount: { backgroundColor: '#1E2535', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  regCountText: { fontSize: 10, fontWeight: '700', color: '#9CA3AF' },
  regItem: { borderTopWidth: 1, borderColor: '#111827', paddingVertical: 8 },
  regRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  regRef: { fontSize: 11, fontWeight: '700', color: '#3B82F6' },
  regLabel: { flex: 1, fontSize: 11, color: '#9CA3AF' },
  regDetail: {
    marginTop: 6,
    backgroundColor: '#070B12',
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  regDetailText: { fontSize: 11, color: '#6B7280', lineHeight: 16 },
  regSource: { fontSize: 10, color: '#374151' },

  // Versions
  versionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  versionKey: { fontSize: 11, color: '#4B5563' },
  versionVal: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
});

const briefCardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#0A0F18',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  body: { fontSize: 14, color: '#E5E7EB', lineHeight: 22 },
});

const progStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#1E2535',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: '#10B981', borderColor: '#10B981' },
  dotActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  label: { fontSize: 13, color: '#4B5563' },
  labelActive: { color: '#A78BFA', fontWeight: '600' },
  labelDone: { color: '#10B981', fontWeight: '600' },
});
