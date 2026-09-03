import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

export interface StrategicProposalData {
  id: string;
  campaignId: string;
  decisionType: string;
  summary: string;
  whyNow: string;
  evidenceSummary: string;
  expectedImpact: string;
  affectedAuthorities: string[];
  affectedLaneIds?: string[];
  affectedLaneNames?: string[];
  preservedLanes?: Array<{ laneId: string; name: string; status?: string }>;
  potentialDependentAuthorities: string[];
  preservedAuthorities: string[];
  createdAt: string;
}

interface StrategicProposalModalProps {
  visible: boolean;
  onClose: () => void;
  proposal: StrategicProposalData | null;
  onApprove: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
}

export function StrategicProposalModal({
  visible,
  onClose,
  proposal,
  onApprove,
  onReject,
}: StrategicProposalModalProps) {
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);

  if (!visible || !proposal) return null;

  const handleApprove = async () => {
    setSubmitting('approve');
    try {
      await onApprove(proposal.id);
    } finally {
      setSubmitting(null);
    }
  };

  const handleReject = async () => {
    setSubmitting('reject');
    try {
      await onReject(proposal.id);
      onClose();
    } finally {
      setSubmitting(null);
    }
  };

  const affectedLaneText = (proposal.affectedLaneNames && proposal.affectedLaneNames.length > 0)
    ? proposal.affectedLaneNames.join(', ')
    : (proposal.affectedLaneIds && proposal.affectedLaneIds.length > 0)
    ? proposal.affectedLaneIds.join(', ')
    : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modalContainer}>
          {/* Header */}
          <View style={st.header}>
            <View style={{ flex: 1 }}>
              <View style={st.headerTag}>
                <View style={st.amberDot} />
                <Text style={st.headerTagText}>STRATEGIC UPDATE PROPOSAL · REVIEW REQUIRED</Text>
              </View>
              <Text style={st.headerTitle}>Market Shift Detected</Text>
              <Text style={st.headerSubtitle}>
                Avyron recommends a targeted strategic reevaluation based on verified market signals.
              </Text>
            </View>
            <Pressable onPress={onClose} style={st.closeBtn} disabled={submitting !== null}>
              <Feather name="x" size={18} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Body Content */}
          <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 24 }}>
            {/* 1. WHAT HAPPENED? */}
            <View style={st.sectionCard}>
              <View style={st.sectionHeader}>
                <Feather name="activity" size={14} color="#60A5FA" />
                <Text style={[st.sectionTitle, { color: '#60A5FA' }]}>1. WHAT HAPPENED?</Text>
              </View>
              <Text style={st.sectionText}>{proposal.whyNow || proposal.summary}</Text>
              {proposal.evidenceSummary && (
                <View style={st.evidenceCallout}>
                  <Feather name="database" size={12} color="#94A3B8" />
                  <Text style={st.evidenceText}>{proposal.evidenceSummary}</Text>
                </View>
              )}
            </View>

            {/* 2. WHY AVYRON THINKS IT MATTERS */}
            <View style={st.sectionCard}>
              <View style={st.sectionHeader}>
                <Feather name="cpu" size={14} color="#A78BFA" />
                <Text style={[st.sectionTitle, { color: '#A78BFA' }]}>2. WHY AVYRON THINKS IT MATTERS</Text>
              </View>
              <Text style={st.sectionText}>{proposal.expectedImpact}</Text>
            </View>

            {/* 3. WHAT AVYRON RECOMMENDS & AFFECTED LANE */}
            <View style={[st.sectionCard, st.highlightCard]}>
              <View style={st.sectionHeader}>
                <Feather name="target" size={14} color="#FBBF24" />
                <Text style={[st.sectionTitle, { color: '#FCD34D' }]}>3. RECOMMENDED REVIEW</Text>
              </View>
              <Text style={st.highlightHeadline}>
                Authority: {(proposal.affectedAuthorities || []).join(', ') || 'Differentiation'} Strategy
              </Text>

              {/* Explicit Affected Lane */}
              <View style={st.laneCard}>
                <Text style={st.laneCardLabel}>AFFECTED LANE</Text>
                <View style={st.laneCardRow}>
                  <Feather name="crosshair" size={14} color="#F59E0B" />
                  <Text style={st.laneCardText}>
                    {affectedLaneText ? `Lane — ${affectedLaneText}` : 'LANE_SCOPE_UNRESOLVED / Core Baseline'}
                  </Text>
                </View>
              </View>

              {/* Other Lanes Preserved */}
              {proposal.preservedLanes && proposal.preservedLanes.length > 0 && (
                <View style={st.preservedLanesBlock}>
                  <Text style={st.preservedLanesTitle}>OTHER LANES (PRESERVED)</Text>
                  {proposal.preservedLanes.map((lane, idx) => (
                    <View key={idx} style={st.preservedLaneRow}>
                      <Feather name="check-circle" size={12} color="#10B981" />
                      <Text style={st.preservedLaneText}>{lane.name} — No change currently recommended</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* 4. WHAT MAY CHANGE VS WHAT REMAINS UNCHANGED */}
            <View style={st.sectionCard}>
              <View style={st.sectionHeader}>
                <Feather name="git-merge" size={14} color="#34D399" />
                <Text style={[st.sectionTitle, { color: '#34D399' }]}>4. POTENTIAL DEPENDENCIES & PRESERVATION</Text>
              </View>

              <View style={st.scopeGrid}>
                {/* May Change */}
                <View style={st.scopeCol}>
                  <Text style={[st.scopeLabel, { color: '#FCD34D' }]}>POTENTIAL DOWNSTREAM REVIEW</Text>
                  {proposal.potentialDependentAuthorities && proposal.potentialDependentAuthorities.length > 0 ? (
                    proposal.potentialDependentAuthorities.map((auth, idx) => (
                      <View key={idx} style={[st.scopePill, st.scopePillWarning]}>
                        <Feather name="refresh-cw" size={11} color="#F59E0B" />
                        <Text style={[st.scopePillText, { color: '#FCD34D' }]}>{auth}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={st.scopeEmptyText}>No downstream dependencies affected</Text>
                  )}
                </View>

                {/* Remains Unchanged */}
                <View style={st.scopeCol}>
                  <Text style={[st.scopeLabel, { color: '#34D399' }]}>CURRENTLY PRESERVED</Text>
                  {proposal.preservedAuthorities && proposal.preservedAuthorities.length > 0 ? (
                    proposal.preservedAuthorities.slice(0, 5).map((auth, idx) => (
                      <View key={idx} style={[st.scopePill, st.scopePillPreserved]}>
                        <Feather name="shield" size={11} color="#10B981" />
                        <Text style={[st.scopePillText, { color: '#6EE7B7' }]}>{auth}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={st.scopeEmptyText}>Core strategic baselines preserved</Text>
                  )}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Approval Action Footer */}
          <View style={st.footer}>
            <Pressable
              style={[st.rejectBtn, submitting === 'reject' && { opacity: 0.7 }]}
              onPress={handleReject}
              disabled={submitting !== null}
            >
              {submitting === 'reject' ? (
                <ActivityIndicator size="small" color="#94A3B8" />
              ) : (
                <Feather name="shield" size={14} color="#94A3B8" />
              )}
              <Text style={st.rejectBtnText}>KEEP CURRENT STRATEGY</Text>
            </Pressable>

            <Pressable
              style={[st.approveBtn, submitting === 'approve' && { opacity: 0.7 }]}
              onPress={handleApprove}
              disabled={submitting !== null}
            >
              {submitting === 'approve' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather name="check" size={16} color="#FFFFFF" />
              )}
              <Text style={st.approveBtnText}>APPLY STRATEGIC UPDATE</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    backgroundColor: '#0B0F17',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#1E2535',
    backgroundColor: '#111622',
  },
  headerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  amberDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  headerTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    lineHeight: 18,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#1E2535',
  },
  body: {
    padding: 20,
  },
  sectionCard: {
    backgroundColor: '#111622',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 14,
    marginBottom: 14,
  },
  highlightCard: {
    backgroundColor: '#78350F15',
    borderColor: '#F59E0B35',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 20,
  },
  evidenceCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#161E2E',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
  },
  evidenceText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  highlightHeadline: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FEF3C7',
    marginBottom: 8,
  },
  laneCard: {
    backgroundColor: '#1E253580',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F59E0B40',
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
  },
  laneCardLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  laneCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  laneCardText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FEF3C7',
  },
  preservedLanesBlock: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#1E2535',
  },
  preservedLanesTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  preservedLaneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  preservedLaneText: {
    fontSize: 11,
    color: '#6EE7B7',
    fontWeight: '600',
  },
  highlightSub: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 18,
  },
  scopeGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  scopeCol: {
    flex: 1,
  },
  scopeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 6,
  },
  scopePillWarning: {
    backgroundColor: '#F59E0B12',
    borderColor: '#F59E0B30',
  },
  scopePillPreserved: {
    backgroundColor: '#10B98112',
    borderColor: '#10B98130',
  },
  scopePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  scopeEmptyText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#1E2535',
    backgroundColor: '#111622',
    gap: 12,
  },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E2535',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rejectBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  approveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
