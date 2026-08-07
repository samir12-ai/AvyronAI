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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useAppShellController } from '@/hooks/useAppShellController';
import {
  useMarketSignals,
  useStrategicBrief,
  useGenerateStrategicBrief,
  useRetryStrategicBrief,
  type MarketSignal,
} from '@/hooks/usePerception';

// Severity badge styling helpers
const getSeverityColor = (severity: string) => {
  const s = severity.toLowerCase();
  if (s === 'major' || s === 'high') return '#EF4444';
  if (s === 'medium') return '#F59E0B';
  return '#3B82F6';
};

// Status badge styling helpers
const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    awaiting_analysis: 'Awaiting Analysis',
    queued: 'Queued',
    generating: 'Generating Brief',
    validating: 'Validating Grounding',
    ready: 'Analysis Ready',
    insufficient_evidence: 'Insufficient Evidence',
    failed: 'Analysis Failed',
  };
  return map[status] || status;
};

const getStatusColor = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'ready') return '#10B981';
  if (s === 'generating' || s === 'validating' || s === 'queued') return '#8B5CF6';
  if (s === 'insufficient_evidence') return '#6B7280';
  if (s === 'failed') return '#EF4444';
  return '#3B82F6';
};

export default function ReasoningEvidenceScreen() {
  const { user } = useAuth();
  const shellController = useAppShellController();
  const campaignId = shellController.activeWorkspace?.id;

  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [expandedEvidenceRef, setExpandedEvidenceRef] = useState<string | null>(null);

  // Fetch confirmed Watchtower events (tab: Confirmed)
  const { data: signalsData, isLoading: signalsLoading, refetch: refetchSignals } = useMarketSignals(
    campaignId,
    50
  );

  // Filter only confirmed events
  const confirmedSignals = (signalsData?.signals || []).filter(
    (s) => s.status === 'confirmed'
  );

  // Auto-select first event if none is selected
  useEffect(() => {
    if (confirmedSignals.length > 0 && !selectedEventId) {
      setSelectedEventId(confirmedSignals[0].id);
    }
  }, [confirmedSignals]);

  // Fetch brief details for the selected event
  const {
    data: briefData,
    isLoading: briefLoading,
    refetch: refetchBrief,
  } = useStrategicBrief(campaignId, selectedEventId);

  // Mutations
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
  const lineage = briefData?.data?.contextLineage || [];
  const sourceVersions = briefData?.data?.sourceVersions || {};
  const failureDetails = briefData?.data?.failureDetails;

  return (
    <View style={styles.container}>
      {/* Top Header / Stats Ribbon */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Strategic Interpretation Console</Text>
          <Text style={styles.headerSubtitle}>
            Traceable business implications from confirmed Watchtower signals
          </Text>
        </View>
        <Pressable onPress={() => refetchSignals()} style={styles.refreshButton}>
          <Feather name="refresh-cw" size={16} color="#9CA3AF" />
        </Pressable>
      </View>

      <View style={styles.workspace}>
        {/* LEFT COLUMN: Confirmed Event Inbox (26%) */}
        <View style={[styles.inboxColumn, { flex: isDesktop ? 0.26 : 1 }]}>
          <Text style={styles.sectionTitle}>Confirmed Events</Text>
          {signalsLoading ? (
            <ActivityIndicator size="small" color="#8B5CF6" style={{ marginTop: 20 }} />
          ) : confirmedSignals.length === 0 ? (
            <Text style={styles.emptyText}>No confirmed events found in Watchtower</Text>
          ) : (
            <FlatList
              data={confirmedSignals}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedEventId;
                const severityColor = getSeverityColor(item.severity);
                return (
                  <Pressable
                    onPress={() => {
                      setSelectedEventId(item.id);
                      setExpandedEvidenceRef(null);
                    }}
                    style={[
                      styles.eventCard,
                      isSelected && styles.eventCardSelected,
                    ]}
                  >
                    <View style={styles.eventCardHeader}>
                      <Text style={styles.competitorName}>{item.competitor || 'Unknown Competitor'}</Text>
                      <View style={[styles.severityDot, { backgroundColor: severityColor }]} />
                    </View>
                    <Text style={styles.eventLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.eventTime}>
                      {item.detectedAt ? new Date(item.detectedAt).toLocaleDateString() : 'Just now'}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </View>

        {/* CENTER COLUMN: Strategic Brief (52%) */}
        {(!isDesktop && selectedEventId) || isDesktop ? (
          <View style={[styles.briefColumn, { flex: isDesktop ? 0.52 : 1 }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {selectedEventId ? (
                <>
                  <View style={styles.briefHeader}>
                    <Text style={styles.briefTitle}>Strategic Briefing</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: getStatusColor(status) + '20', borderColor: getStatusColor(status) + '40' },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: getStatusColor(status) }]}>
                        {getStatusLabel(status)}
                      </Text>
                    </View>
                  </View>

                  {/* Awaiting Analysis State */}
                  {status === 'awaiting_analysis' && (
                    <View style={styles.centerState}>
                      <Feather name="shield" size={48} color="#4B5563" style={{ marginBottom: 16 }} />
                      <Text style={styles.stateTitle}>Analysis Awaiting Action</Text>
                      <Text style={styles.stateSubtitle}>
                        This event has been confirmed by Watchtower. Click below to analyze its strategic meaning against your strategy, audience, and performance loop.
                      </Text>
                      <Pressable
                        onPress={handleGenerate}
                        disabled={generateMutation.isPending}
                        style={styles.actionButton}
                      >
                        {generateMutation.isPending ? (
                          <ActivityIndicator size="small" color="#0F131A" />
                        ) : (
                          <>
                            <Feather name="zap" size={16} color="#0F131A" style={{ marginRight: 8 }} />
                            <Text style={styles.actionButtonText}>Generate Strategic Brief</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}

                  {/* Queue & Generation Progress States */}
                  {inArray(status, ['queued', 'generating', 'validating']) && (
                    <View style={styles.centerState}>
                      <ActivityIndicator size="large" color="#8B5CF6" style={{ marginBottom: 20 }} />
                      <Text style={styles.stateTitle}>
                        {status === 'queued'
                          ? 'Queued for Analysis...'
                          : status === 'generating'
                          ? 'Generating Strategic Brief...'
                          : 'Validating Grounding Judge...'}
                      </Text>
                      <Text style={styles.stateSubtitle}>
                        Running context adapters and executing claims-level validation rules. This usually takes 5-10 seconds.
                      </Text>
                    </View>
                  )}

                  {/* Failure State */}
                  {status === 'failed' && (
                    <View style={styles.centerState}>
                      <Feather name="alert-octagon" size={48} color="#EF4444" style={{ marginBottom: 16 }} />
                      <Text style={[styles.stateTitle, { color: '#EF4444' }]}>Brief Generation Failed</Text>
                      <Text style={styles.stateSubtitle}>
                        {failureDetails?.message || 'Grounding validation rules or LLM judge rejected the output.'}
                      </Text>
                      <Text style={styles.stageText}>Failed Stage: {failureDetails?.stage || 'unknown'}</Text>
                      <Pressable
                        onPress={handleRetry}
                        disabled={retryMutation.isPending}
                        style={[styles.actionButton, { backgroundColor: '#EF4444', marginTop: 16 }]}
                      >
                        {retryMutation.isPending ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <Feather name="refresh-cw" size={16} color="#FFFFFF" style={{ marginRight: 8 }} />
                            <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>Retry Analysis</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}

                  {/* Insufficient Evidence State */}
                  {status === 'insufficient_evidence' && (
                    <View style={styles.centerState}>
                      <Feather name="database" size={48} color="#6B7280" style={{ marginBottom: 16 }} />
                      <Text style={styles.stateTitle}>Insufficient Strategic Evidence</Text>
                      <Text style={styles.stateSubtitle}>
                        The context collection adapters ran, but there is not enough relevant data to form a strategic brief without guessing.
                      </Text>
                      <View style={styles.missingEvidenceContainer}>
                        <Text style={styles.missingEvidenceTitle}>Missing Evidence Needed:</Text>
                        {(brief?.missingEvidence || []).map((m, idx) => (
                          <Text key={idx} style={styles.missingEvidenceItem}>
                            • {m}
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Ready Strategic Brief Sections */}
                  {status === 'ready' && brief && (
                    <View style={styles.briefContent}>
                      {/* Section 1: Executive Summary */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Executive Summary</Text>
                        <View style={styles.summaryBox}>
                          <Text style={styles.summaryText}>{brief.executiveSummary}</Text>
                        </View>
                      </View>

                      {/* Section 2: Strategic Interpretation */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Strategic Interpretation</Text>
                        <Text style={styles.bodyText}>{brief.strategicInterpretation}</Text>
                      </View>

                      {/* Section 3: Likely Strategic Objective */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Likely Strategic Objective</Text>
                        <Text style={styles.bodyText}>{brief.likelyStrategicObjective}</Text>
                      </View>

                      {/* Section 4: Direction of Movement */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Direction of Movement</Text>
                        <Text style={styles.bodyText}>{brief.directionOfMovement}</Text>
                      </View>

                      {/* Section 5: Why This Matters to Our Strategy */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Impact on Our Strategy</Text>
                        <Text style={styles.bodyText}>{brief.impactOnOurStrategy}</Text>
                      </View>

                      {/* Section 6: Affected Strategy Areas */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Affected Strategy Areas</Text>
                        <View style={styles.tagContainer}>
                          {(brief.affectedStrategyAreas || []).map((area, idx) => (
                            <View key={idx} style={styles.tag}>
                              <Text style={styles.tagText}>{area}</Text>
                            </View>
                          ))}
                        </View>
                      </View>

                      {/* Section 7: Market Significance */}
                      <View style={styles.sectionContainer}>
                        <Text style={styles.briefLabel}>Market Significance</Text>
                        <Text style={styles.bodyText}>{brief.marketSignificance}</Text>
                      </View>

                      {/* Section 8: Missing Evidence */}
                      {brief.missingEvidence && brief.missingEvidence.length > 0 && (
                        <View style={styles.sectionContainer}>
                          <Text style={styles.briefLabel}>Missing Evidence / Uncertainties</Text>
                          {brief.missingEvidence.map((m, idx) => (
                            <Text key={idx} style={styles.bulletItem}>
                              • {m}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.centerState}>
                  <Text style={styles.stateSubtitle}>Select an event from the inbox to begin</Text>
                </View>
              )}
            </ScrollView>
          </View>
        ) : null}

        {/* RIGHT COLUMN: Trust, Lineage & Validation (22%) */}
        {isDesktop && !rightPanelCollapsed && selectedEventId && (
          <View style={[styles.lineageColumn, { flex: 0.22 }]}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <Text style={styles.sectionTitle}>Trust & Lineage</Text>

              {/* Confidence Meter */}
              {status === 'ready' && (
                <View style={styles.trustBox}>
                  <Text style={styles.trustLabel}>Validated Confidence</Text>
                  <Text style={styles.confidenceScore}>
                    {briefData?.data?.finalValidatedConfidence || 0}%
                  </Text>
                  <Text style={styles.proposedText}>
                    Model proposed: {briefData?.data?.modelProposedConfidence || 0}%
                  </Text>
                  {/* Adjustment reasons */}
                  {(briefData?.data?.confidenceAdjustmentReasons || []).length > 0 && (
                    <View style={styles.adjustments}>
                      {briefData?.data?.confidenceAdjustmentReasons?.map((reason, idx) => (
                        <Text key={idx} style={styles.adjustmentText}>
                          {reason}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Judge Verdicts */}
              {status === 'ready' && brief && (
                <View style={styles.trustBox}>
                  <Text style={styles.trustLabel}>Claim-Level Grounding</Text>
                  {(brief.claims || []).map((claim, idx) => {
                    const judgeClaim = (briefData?.data?.judgeResult?.claims || []).find(
                      (c: any) => c.claimId === claim.claimId
                    );
                    const isSupported = judgeClaim?.verdict === 'supported';
                    return (
                      <View key={idx} style={styles.claimRow}>
                        <Feather
                          name={isSupported ? 'check-circle' : 'alert-circle'}
                          size={14}
                          color={isSupported ? '#10B981' : '#F59E0B'}
                          style={{ marginRight: 8, marginTop: 2 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.claimText}>{claim.claimText}</Text>
                          <Text style={styles.claimMeta}>
                            Refs: {claim.evidenceRefs.join(', ')} • {claim.factuality}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Collapsible Evidence Registry */}
              {registry.length > 0 && (
                <View style={styles.trustBox}>
                  <Text style={styles.trustLabel}>Persisted Evidence Registry</Text>
                  {registry.map((item, idx) => {
                    const isExpanded = expandedEvidenceRef === item.ref;
                    return (
                      <View key={idx} style={styles.registryItem}>
                        <Pressable
                          onPress={() =>
                            setExpandedEvidenceRef(isExpanded ? null : item.ref)
                          }
                          style={styles.registryHeader}
                        >
                          <Text style={styles.registryRef}>[{item.ref}]</Text>
                          <Text style={styles.registryLabel} numberOfLines={1}>
                            {item.label}
                          </Text>
                          <Feather
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={12}
                            color="#9CA3AF"
                          />
                        </Pressable>
                        {isExpanded && (
                          <View style={styles.registryDetailBox}>
                            <Text style={styles.registryDetailText}>{item.detail}</Text>
                            <Text style={styles.registrySource}>
                              Source: {item.sourceEngine} ({item.table}) • {item.freshnessStatus}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Exact Versions */}
              {selectedEventId && (
                <View style={styles.trustBox}>
                  <Text style={styles.trustLabel}>Pipeline Processing Details</Text>
                  <Text style={styles.versionText}>Generator: {briefData?.data?.sourceVersions?.generatorVersion || 'v1.0.0'}</Text>
                  <Text style={styles.versionText}>Prompt: {briefData?.data?.sourceVersions?.promptVersion || 'v1.0.0'}</Text>
                  <Text style={styles.versionText}>Judge: {briefData?.data?.sourceVersions?.judgeVersion || 'v1.0.0'}</Text>
                  <Text style={styles.versionText}>Fingerprint: {briefData?.data?.contextFingerprint ? briefData.data.contextFingerprint.slice(0, 16) + '...' : 'pending'}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

// Check element helper inside inArray logic
function inArray(val: string, arr: string[]) {
  return arr.includes(val);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F131A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: '#1E2535',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  workspace: {
    flex: 1,
    flexDirection: 'row',
  },
  inboxColumn: {
    borderRightWidth: 1,
    borderColor: '#1E2535',
    padding: 20,
  },
  briefColumn: {
    borderRightWidth: 1,
    borderColor: '#1E2535',
    padding: 20,
  },
  lineageColumn: {
    padding: 20,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  eventCard: {
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 10,
  },
  eventCardSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: '#8B5CF610',
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  competitorName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F9FAFB',
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  eventLabel: {
    fontSize: 14,
    color: '#F9FAFB',
    marginBottom: 6,
  },
  eventTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 40,
  },
  briefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  briefTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F9FAFB',
    marginBottom: 8,
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 400,
    marginBottom: 24,
  },
  stageText: {
    fontSize: 12,
    color: '#EF4444',
    fontStyle: 'italic',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#10B981',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F131A',
  },
  missingEvidenceContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#161B22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
  },
  missingEvidenceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F9FAFB',
    marginBottom: 10,
  },
  missingEvidenceItem: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 6,
  },
  briefContent: {
    gap: 20,
  },
  sectionContainer: {
    backgroundColor: '#161B22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 18,
  },
  briefLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 14,
    color: '#F9FAFB',
    lineHeight: 22,
  },
  summaryBox: {
    borderLeftWidth: 3,
    borderColor: '#3B82F6',
    paddingLeft: 12,
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#3B82F6',
    lineHeight: 22,
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#1E2535',
  },
  tagText: {
    fontSize: 12,
    color: '#F9FAFB',
  },
  bulletItem: {
    fontSize: 14,
    color: '#F9FAFB',
    marginBottom: 6,
  },
  trustBox: {
    backgroundColor: '#161B22',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
    marginBottom: 16,
  },
  trustLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  confidenceScore: {
    fontSize: 32,
    fontWeight: '800',
    color: '#10B981',
  },
  proposedText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  adjustments: {
    marginTop: 10,
    gap: 4,
    borderTopWidth: 1,
    borderColor: '#1E2535',
    paddingTop: 8,
  },
  adjustmentText: {
    fontSize: 11,
    color: '#EF4444',
  },
  claimRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  claimText: {
    fontSize: 13,
    color: '#F9FAFB',
    lineHeight: 18,
  },
  claimMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  registryItem: {
    borderBottomWidth: 1,
    borderColor: '#1E2535',
    paddingVertical: 8,
  },
  registryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  registryRef: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3B82F6',
    marginRight: 6,
  },
  registryLabel: {
    fontSize: 13,
    color: '#F9FAFB',
    flex: 1,
  },
  registryDetailBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: '#0F131A',
    borderRadius: 6,
  },
  registryDetailText: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 16,
  },
  registrySource: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
  },
  versionText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
});
