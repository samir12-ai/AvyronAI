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

export interface StrategyVersionItem {
  strategyRootId: string;
  version: number;
  isCurrent: boolean;
  status: 'CURRENT' | 'SUPERSEDED';
  primaryAxis: string;
  contrastAxis?: string;
  approvedPromise?: string;
  planSummary?: string;
  changedAuthorities?: string[];
  createdAt: string;
}

interface StrategyVersionHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  history: StrategyVersionItem[];
  onSelectVersion?: (versionItem: StrategyVersionItem) => void;
}

export function StrategyVersionHistoryModal({
  visible,
  onClose,
  history,
  onSelectVersion,
}: StrategyVersionHistoryModalProps) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={st.modalContainer}>
          {/* Header */}
          <View style={st.header}>
            <View style={{ flex: 1 }}>
              <View style={st.headerTag}>
                <Feather name="layers" size={12} color="#A78BFA" />
                <Text style={st.headerTagText}>IMMUTABLE VERSION LINEAGE</Text>
              </View>
              <Text style={st.headerTitle}>Strategy Version History</Text>
              <Text style={st.headerSubtitle}>
                Inspect current and historical strategy versions. Historical versions remain preserved and immutable.
              </Text>
            </View>
            <Pressable onPress={onClose} style={st.closeBtn}>
              <Feather name="x" size={18} color="#94A3B8" />
            </Pressable>
          </View>

          {/* History List */}
          <ScrollView style={st.list} contentContainerStyle={{ paddingBottom: 24 }}>
            {history.map((item, idx) => {
              return (
                <View
                  key={item.strategyRootId || idx}
                  style={[st.versionCard, item.isCurrent && st.versionCardCurrent]}
                >
                  <View style={st.cardTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={st.versionNumber}>Strategy v{item.version}</Text>
                      {item.isCurrent ? (
                        <View style={st.currentBadge}>
                          <View style={st.greenDot} />
                          <Text style={st.currentBadgeText}>CURRENT ACTIVE</Text>
                        </View>
                      ) : (
                        <View style={st.supersededBadge}>
                          <Text style={st.supersededBadgeText}>SUPERSEDED</Text>
                        </View>
                      )}
                    </View>
                    <Text style={st.dateText}>
                      {new Date(item.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>

                  <Text style={st.primaryAxisText}>
                    Axis: <Text style={{ color: '#F1F5F9' }}>{item.primaryAxis}</Text>
                  </Text>

                  {item.contrastAxis && (
                    <Text style={st.contrastAxisText} numberOfLines={2}>
                      "{item.contrastAxis}"
                    </Text>
                  )}

                  {item.changedAuthorities && item.changedAuthorities.length > 0 && (
                    <View style={st.changedRow}>
                      <Text style={st.changedLabel}>Updated:</Text>
                      {item.changedAuthorities.map((auth, aIdx) => (
                        <View key={aIdx} style={st.authPill}>
                          <Text style={st.authPillText}>{auth}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
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
  versionCard: {
    backgroundColor: '#111622',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
    marginBottom: 12,
  },
  versionCardCurrent: {
    borderColor: '#8B5CF640',
    backgroundColor: '#1E1B4B18',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  versionNumber: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#10B98118',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B98135',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  currentBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.5,
  },
  supersededBadge: {
    backgroundColor: '#1E2535',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  supersededBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
  },
  dateText: {
    fontSize: 11,
    color: '#64748B',
  },
  primaryAxisText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A78BFA',
    marginBottom: 4,
  },
  contrastAxisText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 8,
  },
  changedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  changedLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F59E0B',
  },
  authPill: {
    backgroundColor: '#F59E0B18',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  authPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FCD34D',
  },
});
