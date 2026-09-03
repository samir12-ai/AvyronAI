import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

export interface ActivityItem {
  id: string;
  timestamp: string;
  type: 'MARKET_EVENT' | 'REASONING' | 'PROPOSAL' | 'APPROVAL' | 'REJECTION' | 'RECOMPUTE' | 'ACTIVATION';
  title: string;
  description: string;
  authorities?: string[];
}

interface StrategyActivityTimelineModalProps {
  visible: boolean;
  onClose: () => void;
  activities: ActivityItem[];
}

export function StrategyActivityTimelineModal({
  visible,
  onClose,
  activities,
}: StrategyActivityTimelineModalProps) {
  if (!visible) return null;

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'MARKET_EVENT':
        return { name: 'eye', color: '#60A5FA', bg: '#1E3A8A25' };
      case 'REASONING':
        return { name: 'cpu', color: '#A78BFA', bg: '#5B21B625' };
      case 'PROPOSAL':
        return { name: 'alert-circle', color: '#FBBF24', bg: '#78350F25' };
      case 'APPROVAL':
        return { name: 'check-circle', color: '#34D399', bg: '#064E3B25' };
      case 'REJECTION':
        return { name: 'x-circle', color: '#F87171', bg: '#7F1D1D25' };
      case 'ACTIVATION':
        return { name: 'zap', color: '#38BDF8', bg: '#0369A125' };
      default:
        return { name: 'activity', color: '#94A3B8', bg: '#1E2535' };
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modalContainer}>
          {/* Header */}
          <View style={st.header}>
            <View style={{ flex: 1 }}>
              <View style={st.headerTag}>
                <Feather name="clock" size={12} color="#A78BFA" />
                <Text style={st.headerTagText}>AUDIT HISTORY & STRATEGY TIMELINE</Text>
              </View>
              <Text style={st.headerTitle}>Strategy Activity</Text>
              <Text style={st.headerSubtitle}>
                Verified chronological record of market signals, reasoning investigations, proposals, approvals, and strategy activations.
              </Text>
            </View>
            <Pressable onPress={onClose} style={st.closeBtn}>
              <Feather name="x" size={18} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Activity List */}
          <ScrollView style={st.list} contentContainerStyle={{ paddingBottom: 24 }}>
            {activities.length === 0 ? (
              <View style={st.emptyState}>
                <Feather name="inbox" size={32} color="#64748B" />
                <Text style={st.emptyText}>No strategy activity recorded yet.</Text>
              </View>
            ) : (
              activities.map((item, idx) => {
                const iconInfo = getActivityIcon(item.type);
                const isLast = idx === activities.length - 1;

                return (
                  <View key={item.id || idx} style={st.timelineRow}>
                    {/* Left Icon & Line */}
                    <View style={st.timelineLeft}>
                      <View style={[st.iconBox, { backgroundColor: iconInfo.bg }]}>
                        <Feather name={iconInfo.name as any} size={14} color={iconInfo.color} />
                      </View>
                      {!isLast && <View style={st.timelineLine} />}
                    </View>

                    {/* Right Content */}
                    <View style={st.timelineContent}>
                      <View style={st.itemHeader}>
                        <Text style={st.itemTitle}>{item.title}</Text>
                        <Text style={st.itemTime}>
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <Text style={st.itemDescription}>{item.description}</Text>
                      {item.authorities && item.authorities.length > 0 && (
                        <View style={st.authoritiesRow}>
                          {item.authorities.map((auth, aIdx) => (
                            <View key={aIdx} style={st.authPill}>
                              <Text style={st.authPillText}>{auth}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
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
  list: {
    padding: 20,
  },
  timelineRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  timelineLeft: {
    width: 36,
    alignItems: 'center',
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#1E2535',
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 16,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  itemTime: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  itemDescription: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
  },
  authoritiesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  authPill: {
    backgroundColor: '#1E2535',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  authPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A78BFA',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 12,
  },
});
