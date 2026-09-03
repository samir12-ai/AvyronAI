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
import { BusinessStageProgress } from '@/server/strategy-experience/service';

interface LiveStrategyRunModalProps {
  visible: boolean;
  onClose: () => void;
  runStatus: string | null;
  stages: BusinessStageProgress[];
  currentStage: string | null;
  progressPercent: number;
  completedCount: number;
  totalCount: number;
  isCompleted: boolean;
  isFailed: boolean;
  completionData?: {
    version: number;
    generatedAt: string;
    primaryDirection: string;
    primaryChannel: string;
    lanesCount: number;
  } | null;
  onViewStrategy: () => void;
  onRetry?: () => void;
}

export function LiveStrategyRunModal({
  visible,
  onClose,
  runStatus,
  stages,
  currentStage,
  progressPercent,
  completedCount,
  totalCount,
  isCompleted,
  isFailed,
  completionData,
  onViewStrategy,
  onRetry,
}: LiveStrategyRunModalProps) {
  if (!visible) return null;

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
                    ? 'STRATEGY READY'
                    : isFailed
                    ? 'STRATEGY GENERATION NEEDS ATTENTION'
                    : 'LIVE STRATEGY ORCHESTRATION'}
                </Text>
              </View>
              <Text style={st.headerTitle}>
                {isCompleted
                  ? 'Your Strategy is Ready'
                  : isFailed
                  ? 'Orchestration Paused'
                  : 'Generating Your Strategy'}
              </Text>
              <Text style={st.headerSubtitle}>
                {isCompleted
                  ? 'Avyron has analyzed your business, market, buyers, and constructed a verified strategy.'
                  : isFailed
                  ? 'We encountered an inconsistency and could not validate with enough confidence.'
                  : 'Avyron is analyzing your business, market, buyers, and strategic options in real time.'}
              </Text>
            </View>
            <Pressable onPress={onClose} style={st.closeBtn}>
              <Feather name="x" size={18} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Progress Bar */}
          {!isCompleted && !isFailed && (
            <View style={st.progressSection}>
              <View style={st.progressHeader}>
                <Text style={st.progressLabel}>
                  {currentStage ? `Currently: ${currentStage}` : 'Initializing pipeline...'}
                </Text>
                <Text style={st.progressCount}>
                  {completedCount} of {totalCount} completed ({progressPercent}%)
                </Text>
              </View>
              <View style={st.progressBarTrack}>
                <View style={[st.progressBarFill, { width: `${Math.max(5, progressPercent)}%` }]} />
              </View>
            </View>
          )}

          {/* Completion Celebration Card */}
          {isCompleted && completionData && (
            <View style={st.completionCard}>
              <View style={st.completionIconBox}>
                <Feather name="check-circle" size={32} color="#10B981" />
              </View>
              <Text style={st.completionHeadline}>Strategy Version {completionData.version} is now active</Text>
              <Text style={st.completionSub}>
                Algorithmic authority locked and ready for execution governance.
              </Text>

              <View style={st.summaryGrid}>
                <View style={st.summaryItem}>
                  <Text style={st.summaryLabel}>PRIMARY DIRECTION</Text>
                  <Text style={st.summaryValue} numberOfLines={2}>
                    {completionData.primaryDirection || 'Simplicity & Ease'}
                  </Text>
                </View>
                <View style={st.summaryItem}>
                  <Text style={st.summaryLabel}>PRIMARY CHANNEL</Text>
                  <Text style={st.summaryValue}>{completionData.primaryChannel || 'Multi-Channel'}</Text>
                </View>
                <View style={st.summaryItem}>
                  <Text style={st.summaryLabel}>STRATEGIC LANES</Text>
                  <Text style={st.summaryValue}>{completionData.lanesCount} Approved Lanes</Text>
                </View>
                <View style={st.summaryItem}>
                  <Text style={st.summaryLabel}>GENERATED AT</Text>
                  <Text style={st.summaryValue}>
                    {completionData.generatedAt || new Date().toLocaleTimeString()}
                  </Text>
                </View>
              </View>

              <Pressable style={st.viewStrategyBtn} onPress={onViewStrategy}>
                <Feather name="map" size={16} color="#FFFFFF" />
                <Text style={st.viewStrategyText}>VIEW STRATEGY PLAN</Text>
                <Feather name="arrow-right" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          )}

          {/* Live Stage List */}
          {!isCompleted && (
            <ScrollView style={st.stageList} contentContainerStyle={{ paddingBottom: 20 }}>
              {stages.map((stage, idx) => {
                const isRunning = stage.status === 'RUNNING';
                const isValidating = stage.status === 'VALIDATING';
                const isRefining = stage.status === 'REFINING';
                const isDone = stage.status === 'COMPLETED';
                const isPartial = stage.status === 'PARTIAL';
                const isWaiting = stage.status === 'WAITING';
                const isError = stage.status === 'FAILED';
                const isBlocked = stage.status === 'BLOCKED';

                return (
                  <View
                    key={stage.id}
                    style={[
                      st.stageRow,
                      isRunning && st.stageRowRunning,
                      isRefining && st.stageRowRefining,
                      isDone && st.stageRowDone,
                    ]}
                  >
                    <View style={st.stageIndexCol}>
                      <Text style={st.stageIndexText}>
                        {idx + 1 < 10 ? `0${idx + 1}` : idx + 1}
                      </Text>
                    </View>

                    <View style={st.stageInfoCol}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={st.stageCategoryText}>{stage.category}</Text>
                        <Text style={st.stageNameText}>{stage.name}</Text>
                      </View>
                      <Text style={st.stageMessageText} numberOfLines={2}>
                        {stage.displayMessage}
                      </Text>
                    </View>

                    <View style={st.stageStatusCol}>
                      {isRunning && (
                        <View style={[st.statusPill, st.statusPillRunning]}>
                          <ActivityIndicator size="small" color="#60A5FA" />
                          <Text style={[st.statusPillText, { color: '#60A5FA' }]}>RUNNING</Text>
                        </View>
                      )}
                      {isValidating && (
                        <View style={[st.statusPill, st.statusPillValidating]}>
                          <Feather name="shield" size={11} color="#A78BFA" />
                          <Text style={[st.statusPillText, { color: '#A78BFA' }]}>VALIDATING</Text>
                        </View>
                      )}
                      {isRefining && (
                        <View style={[st.statusPill, st.statusPillRefining]}>
                          <Feather name="refresh-cw" size={11} color="#FBBF24" />
                          <Text style={[st.statusPillText, { color: '#FCD34D' }]}>REFINING</Text>
                        </View>
                      )}
                      {isDone && (
                        <View style={[st.statusPill, st.statusPillDone]}>
                          <Feather name="check" size={12} color="#34D399" />
                          <Text style={[st.statusPillText, { color: '#34D399' }]}>COMPLETED</Text>
                        </View>
                      )}
                      {isPartial && (
                        <View style={[st.statusPill, st.statusPillPartial]}>
                          <Feather name="alert-triangle" size={11} color="#F59E0B" />
                          <Text style={[st.statusPillText, { color: '#F59E0B' }]}>PARTIAL</Text>
                        </View>
                      )}
                      {isWaiting && (
                        <View style={[st.statusPill, st.statusPillWaiting]}>
                          <Text style={[st.statusPillText, { color: '#64748B' }]}>WAITING</Text>
                        </View>
                      )}
                      {isBlocked && (
                        <View style={[st.statusPill, st.statusPillBlocked]}>
                          <Feather name="lock" size={11} color="#94A3B8" />
                          <Text style={[st.statusPillText, { color: '#94A3B8' }]}>BLOCKED</Text>
                        </View>
                      )}
                      {isError && (
                        <View style={[st.statusPill, st.statusPillError]}>
                          <Feather name="alert-octagon" size={11} color="#F87171" />
                          <Text style={[st.statusPillText, { color: '#F87171' }]}>FAILED</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Failure action footer */}
          {isFailed && (
            <View style={st.failureFooter}>
              <Text style={st.failureText}>
                We couldn't validate all strategic engines with sufficient confidence.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  style={[st.retryBtn, { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155' }]}
                  onPress={onClose}
                >
                  <Text style={[st.retryBtnText, { color: '#94A3B8' }]}>DISMISS</Text>
                </Pressable>
                <Pressable style={st.retryBtn} onPress={onRetry || onClose}>
                  <Ionicons name="refresh" size={14} color="#FFFFFF" />
                  <Text style={st.retryBtnText}>TRY AGAIN</Text>
                </Pressable>
              </View>
            </View>
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
    maxWidth: 720,
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
  progressSection: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#0F141F',
    borderBottomWidth: 1,
    borderColor: '#1E2535',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  progressCount: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#1E2535',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 3,
  },
  stageList: {
    flex: 1,
    padding: 16,
  },
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#111622',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 8,
  },
  stageRowRunning: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E3A8A18',
  },
  stageRowRefining: {
    borderColor: '#F59E0B',
    backgroundColor: '#78350F18',
  },
  stageRowDone: {
    borderColor: '#10B98135',
    backgroundColor: '#064E3B10',
  },
  stageIndexCol: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageIndexText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  stageInfoCol: {
    flex: 1,
    paddingHorizontal: 8,
  },
  stageCategoryText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  stageNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  stageMessageText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    lineHeight: 16,
  },
  stageStatusCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusPillRunning: {
    backgroundColor: '#3B82F615',
    borderColor: '#3B82F640',
  },
  statusPillValidating: {
    backgroundColor: '#8B5CF615',
    borderColor: '#8B5CF640',
  },
  statusPillRefining: {
    backgroundColor: '#F59E0B15',
    borderColor: '#F59E0B40',
  },
  statusPillDone: {
    backgroundColor: '#10B98115',
    borderColor: '#10B98140',
  },
  statusPillPartial: {
    backgroundColor: '#F59E0B15',
    borderColor: '#F59E0B40',
  },
  statusPillWaiting: {
    backgroundColor: '#1E2535',
    borderColor: '#334155',
  },
  statusPillBlocked: {
    backgroundColor: '#1E2535',
    borderColor: '#475569',
  },
  statusPillError: {
    backgroundColor: '#EF444415',
    borderColor: '#EF444440',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  completionCard: {
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#0F141F',
  },
  completionIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#10B98118',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  completionHeadline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  completionSub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 18,
  },
  summaryGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#161E2E',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  viewStrategyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  viewStrategyText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  failureFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderColor: '#1E2535',
    backgroundColor: '#161B26',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  failureText: {
    flex: 1,
    fontSize: 12,
    color: '#FCA5A5',
    marginRight: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
});
