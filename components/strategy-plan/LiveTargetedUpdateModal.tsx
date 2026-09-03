import React from 'react';
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

export interface TargetedUpdateResult {
  executionStatus: 'STRATEGY_UPDATED' | 'NO_CHANGE_CONFIRMED' | 'FAILED';
  changedAuthorities: string[];
  preservedAuthorities: string[];
  newRoot?: any;
  summary: string;
}

interface LiveTargetedUpdateModalProps {
  visible: boolean;
  onClose: () => void;
  isRunning: boolean;
  activeAuthority: string;
  result: TargetedUpdateResult | null;
  onViewUpdatedStrategy: () => void;
}

export function LiveTargetedUpdateModal({
  visible,
  onClose,
  isRunning,
  activeAuthority,
  result,
  onViewUpdatedStrategy,
}: LiveTargetedUpdateModalProps) {
  if (!visible) return null;

  const isCompleted = result !== null && !isRunning;
  const isStrategyUpdated = result?.executionStatus === 'STRATEGY_UPDATED';
  const isNoChange = result?.executionStatus === 'NO_CHANGE_CONFIRMED';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modalContainer}>
          {/* Header */}
          <View style={st.header}>
            <View style={{ flex: 1 }}>
              <View style={st.headerTag}>
                <View style={[st.pulseDot, isCompleted && { backgroundColor: '#10B981' }]} />
                <Text style={st.headerTagText}>
                  {isCompleted
                    ? isStrategyUpdated
                      ? 'STRATEGY UPDATED'
                      : 'REEVALUATION VERIFIED'
                    : 'LIVE TARGETED RECOMPUTE'}
                </Text>
              </View>
              <Text style={st.headerTitle}>
                {isCompleted
                  ? isStrategyUpdated
                    ? 'Targeted Update Complete'
                    : 'Current Strategy Verified'
                  : 'Updating Your Strategy'}
              </Text>
              <Text style={st.headerSubtitle}>
                {isCompleted
                  ? isStrategyUpdated
                    ? 'Avyron recomputed only the affected authority and preserved the rest of your strategic core.'
                    : 'Avyron reevaluated the authority against market evidence and confirmed your current strategy remains optimal.'
                  : 'Avyron is changing ONLY what needs to change.'}
              </Text>
            </View>
            {isCompleted && (
              <Pressable onPress={onClose} style={st.closeBtn}>
                <Feather name="x" size={18} color="#94A3B8" />
              </Pressable>
            )}
          </View>

          {/* Running State */}
          {isRunning && (
            <View style={st.runningBody}>
              <ActivityIndicator size="large" color="#8B5CF6" style={{ marginBottom: 16 }} />
              <Text style={st.runningStageText}>Reevaluating {activeAuthority}...</Text>
              <Text style={st.runningSubText}>
                {"Generator proposing grounded contrast -> Judge validating against canonical facts"}
              </Text>

              <View style={st.liveStatusList}>
                <View style={[st.liveRow, st.liveRowActive]}>
                  <Feather name="refresh-cw" size={14} color="#60A5FA" />
                  <Text style={[st.liveRowText, { color: '#60A5FA' }]}>
                    {activeAuthority}: Reevaluating with latest market evidence
                  </Text>
                </View>
                <View style={st.liveRow}>
                  <Feather name="shield" size={14} color="#10B981" />
                  <Text style={[st.liveRowText, { color: '#94A3B8' }]}>
                    Positioning & Audience: Preserved (No recalculation needed)
                  </Text>
                </View>
                <View style={st.liveRow}>
                  <Feather name="layers" size={14} color="#A78BFA" />
                  <Text style={[st.liveRowText, { color: '#94A3B8' }]}>
                    Plan Synthesis: Waiting to reassemble approved truth
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Completed State */}
          {isCompleted && result && (
            <ScrollView style={st.completedBody} contentContainerStyle={{ paddingBottom: 20 }}>
              {isStrategyUpdated ? (
                <>
                  <View style={st.badgeBox}>
                    <Feather name="check-circle" size={28} color="#10B981" />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={st.badgeBoxTitle}>
                        New Strategy Version Activated
                      </Text>
                      <Text style={st.badgeBoxSub}>
                        Strategy Plan reassembled with refreshed {result.changedAuthorities.join(', ')}.
                      </Text>
                    </View>
                  </View>

                  {/* WHAT CHANGED */}
                  <View style={st.diffCard}>
                    <View style={st.diffHeader}>
                      <Feather name="edit-3" size={13} color="#F59E0B" />
                      <Text style={[st.diffTitle, { color: '#FCD34D' }]}>WHAT CHANGED</Text>
                    </View>
                    <View style={st.diffPillsContainer}>
                      {result.changedAuthorities.map((auth, idx) => (
                        <View key={idx} style={st.diffPill}>
                          <Text style={st.diffPillText}>{auth} Updated</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={st.diffSummaryText}>{result.summary}</Text>
                  </View>

                  {/* WHAT STAYED THE SAME */}
                  <View style={st.preservedCard}>
                    <View style={st.diffHeader}>
                      <Feather name="shield" size={13} color="#10B981" />
                      <Text style={[st.diffTitle, { color: '#6EE7B7' }]}>WHAT STAYED THE SAME</Text>
                    </View>
                    <View style={st.preservedPillsContainer}>
                      {(result.preservedAuthorities || ['Positioning', 'Audience', 'Funnel', 'Channels']).map(
                        (auth, idx) => (
                          <View key={idx} style={st.preservedPill}>
                            <Feather name="check" size={10} color="#10B981" />
                            <Text style={st.preservedPillText}>{auth}</Text>
                          </View>
                        )
                      )}
                    </View>
                  </View>
                </>
              ) : (
                <View style={st.noChangeCard}>
                  <Feather name="check-shield" size={32} color="#10B981" />
                  <Text style={st.noChangeTitle}>No Strategic Changes Required</Text>
                  <Text style={st.noChangeText}>
                    Our engines reevaluated {activeAuthority} and verified that your current strategic position
                    remains completely defensible against competitor changes.
                  </Text>
                </View>
              )}

              <Pressable style={st.viewBtn} onPress={onViewUpdatedStrategy}>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
                <Text style={st.viewBtnText}>VIEW UPDATED STRATEGY</Text>
              </Pressable>
            </ScrollView>
          )}
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
    maxWidth: 640,
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
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8B5CF6',
  },
  headerTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
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
  runningBody: {
    padding: 32,
    alignItems: 'center',
  },
  runningStageText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  runningSubText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
  },
  liveStatusList: {
    width: '100%',
    gap: 10,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#111622',
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  liveRowActive: {
    backgroundColor: '#1E3A8A15',
    borderColor: '#3B82F640',
  },
  liveRowText: {
    fontSize: 12,
    fontWeight: '600',
  },
  completedBody: {
    padding: 20,
  },
  badgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#064E3B18',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B98135',
    marginBottom: 16,
  },
  badgeBoxTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6EE7B7',
  },
  badgeBoxSub: {
    fontSize: 12,
    color: '#D1D5DB',
    marginTop: 2,
  },
  diffCard: {
    backgroundColor: '#78350F15',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B35',
    padding: 14,
    marginBottom: 14,
  },
  diffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  diffTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  diffPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  diffPill: {
    backgroundColor: '#F59E0B25',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  diffPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FCD34D',
  },
  diffSummaryText: {
    fontSize: 12,
    color: '#E2E8F0',
    lineHeight: 18,
  },
  preservedCard: {
    backgroundColor: '#064E3B15',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B98135',
    padding: 14,
    marginBottom: 20,
  },
  preservedPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  preservedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#10B98118',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  preservedPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A7F3D0',
  },
  noChangeCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#111622',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 20,
  },
  noChangeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
    marginTop: 12,
    marginBottom: 6,
  },
  noChangeText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingVertical: 12,
    borderRadius: 10,
  },
  viewBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
