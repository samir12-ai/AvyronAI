import React from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ExecutionTaskItem } from '@/hooks/useWhatToDoToday';

interface TaskDetailModalProps {
  task: ExecutionTaskItem | null;
  visible: boolean;
  onClose: () => void;
  onUpdateStatus: (taskId: string, status: ExecutionTaskItem['status']) => Promise<void>;
  onStartTask?: (task: ExecutionTaskItem) => void;
}

export function TaskDetailModal({ task, visible, onClose, onUpdateStatus, onStartTask }: TaskDetailModalProps) {
  if (!task) return null;

  const isDone = task.status === 'DONE';
  const isActive = task.status === 'ACTIVE';

  const getChannelIcon = (ch: string) => {
    switch (ch.toUpperCase()) {
      case 'YOUTUBE': return 'video';
      case 'INSTAGRAM': return 'instagram';
      case 'TIKTOK': return 'film';
      case 'FACEBOOK': return 'facebook';
      case 'X': return 'twitter';
      default: return 'globe';
    }
  };

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'MUST_DO': return { bg: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.4)', text: '#FCA5A5' };
      case 'SHOULD_DO': return { bg: 'rgba(245, 158, 11, 0.2)', border: 'rgba(245, 158, 11, 0.4)', text: '#FCD34D' };
      case 'WAITING_BLOCKED': return { bg: 'rgba(100, 116, 139, 0.2)', border: 'rgba(100, 116, 139, 0.4)', text: '#CBD5E1' };
      default: return { bg: '#0F172A', border: '#334155', text: '#94A3B8' };
    }
  };

  const pColor = getPriorityBadgeColor(task.priority);

  const handleStatusChange = async (newStatus: ExecutionTaskItem['status']) => {
    try {
      await onUpdateStatus(task.id, newStatus);
    } catch (err) {
      console.warn('[TaskDetailModal] Status change error:', err);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <View style={styles.badgeRow}>
                <View style={[styles.channelBadge, task.channelRole === 'PRIMARY' && styles.primaryChannelBadge]}>
                  <Feather
                    name={getChannelIcon(task.channel) as any}
                    size={14}
                    color={task.channelRole === 'PRIMARY' ? '#C4B5FD' : '#94A3B8'}
                  />
                  <Text style={[styles.channelBadgeText, task.channelRole === 'PRIMARY' && styles.primaryChannelBadgeText]}>
                    {task.channel} • {task.channelRole}
                  </Text>
                </View>

                <View style={[styles.priorityBadge, { backgroundColor: pColor.bg, borderColor: pColor.border }]}>
                  <Text style={[styles.priorityBadgeText, { color: pColor.text }]}>
                    {task.priority.replace('_', ' ')}
                  </Text>
                </View>

                {task.estimatedEffort && (
                  <View style={styles.effortBadge}>
                    <Feather name="clock" size={12} color="#94A3B8" />
                    <Text style={styles.effortBadgeText}>{task.estimatedEffort}</Text>
                  </View>
                )}
              </View>

              <Text style={styles.taskTitle}>{task.title}</Text>
            </View>

            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Body */}
          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={true}>
            {/* Description */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>EXECUTION OVERVIEW</Text>
              <Text style={styles.descriptionText}>{task.description}</Text>
            </View>

            {/* Strategic Alignment */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionLabel}>STRATEGIC OBJECTIVE & ALIGNMENT</Text>
              
              {task.objective && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Objective:</Text>
                  <Text style={styles.fieldValue}>{task.objective}</Text>
                </View>
              )}

              {task.reason && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Why This Matters:</Text>
                  <Text style={styles.fieldValue}>{task.reason}</Text>
                </View>
              )}

              {task.expectedOutcome && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Expected Deliverable:</Text>
                  <Text style={styles.fieldValue}>{task.expectedOutcome}</Text>
                </View>
              )}

              {task.sourceAuthority && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Grounded In:</Text>
                  <View style={styles.authorityPill}>
                    <Text style={styles.authorityPillText}>Authority: {task.sourceAuthority}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Actionable Approach */}
            {task.executionApproach && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>STEP-BY-STEP EXECUTION APPROACH</Text>
                <Text style={styles.approachText}>{task.executionApproach}</Text>
              </View>
            )}

            {/* Proof & Funnel */}
            {(task.proofRequired || task.ctaDestination) && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>PROOF & FUNNEL DESTINATION</Text>

                {task.proofRequired && (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Proof / Evidence Needed:</Text>
                    <Text style={styles.fieldValue}>{task.proofRequired}</Text>
                  </View>
                )}

                {task.ctaDestination && (
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Call To Action / Destination:</Text>
                    <Text style={styles.fieldValueHighlight}>{task.ctaDestination}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Dependencies */}
            {Array.isArray(task.dependencies) && task.dependencies.length > 0 && (
              <View style={[styles.sectionCard, styles.dependencyCard]}>
                <View style={styles.cardHeaderWithIcon}>
                  <Feather name="link" size={14} color="#F59E0B" />
                  <Text style={[styles.sectionLabel, { color: '#FCD34D', marginBottom: 0 }]}>PREREQUISITES & DEPENDENCIES</Text>
                </View>
                {task.dependencies.map((dep, i) => (
                  <Text key={i} style={styles.dependencyItem}>• {dep}</Text>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.modalFooter}>
            <View style={styles.statusIndicator}>
              <Text style={styles.statusIndicatorLabel}>Status:</Text>
              <Text style={[
                styles.statusIndicatorValue,
                isDone && { color: '#10B981' },
                isActive && { color: '#A78BFA' }
              ]}>
                {task.status}
              </Text>
            </View>

            <View style={styles.actionButtonsRow}>
              {!isDone && !isActive && (
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => {
                    handleStatusChange('ACTIVE');
                    if (onStartTask) onStartTask(task);
                  }}
                >
                  <Feather name="play" size={14} color="#C4B5FD" />
                  <Text style={styles.btnSecondaryText}>Start Task & Open Script</Text>
                </Pressable>
              )}

              {isActive && onStartTask && (
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => onStartTask(task)}
                >
                  <Feather name="film" size={14} color="#C4B5FD" />
                  <Text style={styles.btnSecondaryText}>Open Shooting Script</Text>
                </Pressable>
              )}

              {!isDone ? (
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => handleStatusChange('DONE')}
                >
                  <Feather name="check" size={14} color="#FFFFFF" />
                  <Text style={styles.btnPrimaryText}>Mark as Done</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.btn, styles.btnOutline]}
                  onPress={() => handleStatusChange('PLANNED')}
                >
                  <Feather name="rotate-ccw" size={14} color="#94A3B8" />
                  <Text style={styles.btnOutlineText}>Reopen Task</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '90%',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...Platform.select({
      web: {
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      },
    }),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    backgroundColor: '#0F172A',
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  channelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  primaryChannelBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  channelBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  primaryChannelBadgeText: {
    color: '#C4B5FD',
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  effortBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  effortBadgeText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  taskTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    lineHeight: 24,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalBody: {
    padding: 20,
    backgroundColor: '#1E293B',
  },
  sectionCard: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 16,
  },
  dependencyCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  cardHeaderWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  descriptionText: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  fieldRow: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
  },
  fieldValueHighlight: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C4B5FD',
    lineHeight: 18,
  },
  approachText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 20,
  },
  authorityPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  authorityPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  dependencyItem: {
    fontSize: 13,
    color: '#FCD34D',
    lineHeight: 18,
    marginBottom: 4,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    backgroundColor: '#0F172A',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusIndicatorLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  statusIndicatorValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnPrimary: {
    backgroundColor: '#10B981',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  btnSecondaryText: {
    color: '#C4B5FD',
    fontSize: 13,
    fontWeight: '600',
  },
  btnOutline: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  btnOutlineText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
});
