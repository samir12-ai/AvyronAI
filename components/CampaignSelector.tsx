import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCampaign } from '@/context/CampaignContext';

const GOAL_TYPE_COLORS: Record<string, string> = {
  LEADS: '#10B981',
  AWARENESS: '#6366F1',
  RETARGETING: '#F59E0B',
  SALES: '#EF4444',
  TESTING: '#8B5CF6',
};

const GOAL_TYPE_ICONS: Record<string, string> = {
  LEADS: 'people',
  AWARENESS: 'megaphone',
  RETARGETING: 'reload',
  SALES: 'cart',
  TESTING: 'flask',
};

function CampaignBlocker() {
  const { campaigns, selectCampaign, isLoading, refreshCampaigns } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const handleSelect = async (campaign: any) => {
    if (campaign.status === 'paused') return;
    setSelecting(true);
    try {
      await selectCampaign(campaign);
      setShowModal(false);
    } catch (err) {
      console.error('Failed to select campaign:', err);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <View style={styles.blockerContainer}>
      <View style={styles.blockerContent}>
        <View style={styles.blockerIconCircle}>
          <Ionicons name="analytics" size={32} color="#8B5CF6" />
        </View>
        <Text style={styles.blockerTitle}>Select a Campaign to Continue</Text>
        <Text style={styles.blockerDescription}>
          All analytics, strategy, and optimization are scoped to a single campaign for accuracy. Choose which campaign to analyze.
        </Text>
        <TouchableOpacity
          style={styles.blockerButton}
          onPress={() => {
            refreshCampaigns();
            setShowModal(true);
          }}
        >
          <Ionicons name="list" size={18} color="#fff" />
          <Text style={styles.blockerButtonText}>Choose Campaign</Text>
        </TouchableOpacity>
      </View>

      <CampaignListModal
        visible={showModal}
        campaigns={campaigns}
        onSelect={handleSelect}
        onClose={() => setShowModal(false)}
        selecting={selecting}
      />
    </View>
  );
}

function CampaignWarningBanner() {
  const { warning, campaigns, selectCampaign, refreshCampaigns } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);

  if (!warning) return null;

  const handleSelect = async (campaign: any) => {
    if (campaign.status === 'paused') return;
    setSelecting(true);
    try {
      await selectCampaign(campaign);
      setShowModal(false);
    } catch (err) {
      console.error('Failed to select campaign:', err);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <>
      <View style={styles.warningBanner}>
        <Ionicons name="warning" size={18} color="#F59E0B" />
        <Text style={styles.warningText} numberOfLines={2}>
          {warning.message}
        </Text>
        <TouchableOpacity
          style={styles.warningButton}
          onPress={() => {
            refreshCampaigns();
            setShowModal(true);
          }}
        >
          <Text style={styles.warningButtonText}>Re-select</Text>
        </TouchableOpacity>
      </View>
      <CampaignListModal
        visible={showModal}
        campaigns={campaigns}
        onSelect={handleSelect}
        onClose={() => setShowModal(false)}
        selecting={selecting}
      />
    </>
  );
}

function CampaignBar() {
  const { selectedCampaign, campaigns, selectCampaign, clearSelection, refreshCampaigns } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);

  if (!selectedCampaign) return null;

  const goalColor = GOAL_TYPE_COLORS[selectedCampaign.campaignGoalType] || '#6B7280';
  const goalIcon = GOAL_TYPE_ICONS[selectedCampaign.campaignGoalType] || 'help-circle';

  const handleSelect = async (campaign: any) => {
    if (campaign.status === 'paused') return;
    setSelecting(true);
    try {
      await selectCampaign(campaign);
      setShowModal(false);
    } catch (err) {
      console.error('Failed to select campaign:', err);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.campaignBar}
        onPress={() => {
          refreshCampaigns();
          setShowModal(true);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.barLeft}>
          <View style={[styles.goalDot, { backgroundColor: goalColor }]} />
          <View style={styles.barInfo}>
            <Text style={styles.barName} numberOfLines={1}>
              {selectedCampaign.selectedCampaignName}
            </Text>
            <View style={styles.barMeta}>
              <View style={[styles.goalBadge, { backgroundColor: goalColor + '20' }]}>
                <Ionicons name={goalIcon as any} size={10} color={goalColor} />
                <Text style={[styles.goalBadgeText, { color: goalColor }]}>
                  {selectedCampaign.campaignGoalType}
                </Text>
              </View>
              {selectedCampaign.campaignLocation ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Ionicons name="location-outline" size={10} color="#6B7280" />
                  <Text style={styles.barPlatform}>{selectedCampaign.campaignLocation}</Text>
                </View>
              ) : null}
              <Text style={styles.barPlatform}>
                {selectedCampaign.selectedPlatform?.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-down" size={16} color="#6B7280" />
      </TouchableOpacity>

      <CampaignListModal
        visible={showModal}
        campaigns={campaigns}
        onSelect={handleSelect}
        onClose={() => setShowModal(false)}
        selecting={selecting}
        currentId={selectedCampaign.selectedCampaignId}
      />
    </>
  );
}

function CampaignListModal({
  visible,
  campaigns,
  onSelect,
  onClose,
  selecting,
  currentId,
}: {
  visible: boolean;
  campaigns: any[];
  onSelect: (c: any) => void;
  onClose: () => void;
  selecting: boolean;
  currentId?: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Campaign</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            All data and AI analysis will be scoped to the selected campaign
          </Text>

          {selecting && (
            <View style={styles.selectingOverlay}>
              <ActivityIndicator color="#8B5CF6" />
            </View>
          )}

          <FlatList
            data={campaigns}
            keyExtractor={(item) => item.id}
            scrollEnabled={!!campaigns.length}
            renderItem={({ item }) => {
              const goalColor = GOAL_TYPE_COLORS[item.goalType] || '#6B7280';
              const goalIcon = GOAL_TYPE_ICONS[item.goalType] || 'help-circle';
              const isSelected = item.id === currentId;
              const isPaused = item.status === 'paused';

              return (
                <TouchableOpacity
                  style={[
                    styles.campaignItem,
                    isSelected && styles.campaignItemSelected,
                    isPaused && styles.campaignItemPaused,
                  ]}
                  onPress={() => onSelect(item)}
                  disabled={isPaused || selecting}
                  activeOpacity={0.7}
                >
                  <View style={styles.campaignItemLeft}>
                    <View style={[styles.campaignGoalIcon, { backgroundColor: goalColor + '20' }]}>
                      <Ionicons name={goalIcon as any} size={16} color={isPaused ? '#6B7280' : goalColor} />
                    </View>
                    <View style={styles.campaignItemInfo}>
                      <Text
                        style={[styles.campaignItemName, isPaused && styles.textPaused]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <View style={styles.campaignItemMeta}>
                        <View style={[styles.goalBadge, { backgroundColor: isPaused ? '#374151' : goalColor + '20' }]}>
                          <Text style={[styles.goalBadgeText, { color: isPaused ? '#6B7280' : goalColor }]}>
                            {item.goalType}
                          </Text>
                        </View>
                        {item.location && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 6 }}>
                            <Ionicons name="location-outline" size={11} color="#9CA3AF" style={{ marginRight: 2 }} />
                            <Text style={styles.campaignBudget}>{item.location}</Text>
                          </View>
                        )}
                        {item.budget && (
                          <Text style={styles.campaignBudget}>{item.budget}</Text>
                        )}
                        {isPaused && (
                          <View style={styles.pausedBadge}>
                            <Text style={styles.pausedBadgeText}>PAUSED</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />
                  )}
                </TouchableOpacity>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            style={styles.campaignList}
          />

          <View style={styles.modalFooter}>
            <Text style={styles.footerNote}>
              {campaigns.filter(c => c.isDemo).length > 0
                ? 'Demo campaigns shown. Connect Meta Ads API for real data.'
                : `${campaigns.length} campaigns available`}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function CampaignGuard({ children }: { children: React.ReactNode }) {
  const { isCampaignSelected, warning, isLoading } = useCampaign();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  return (
    <>
      {warning && <CampaignWarningBanner />}
      {!isCampaignSelected ? <CampaignBlocker /> : children}
    </>
  );
}

export { CampaignBar, CampaignBlocker, CampaignWarningBanner };

const styles = StyleSheet.create({
  blockerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#0A0E14',
  },
  blockerContent: {
    alignItems: 'center',
    maxWidth: 340,
  },
  blockerIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#8B5CF620',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  blockerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 10,
  },
  blockerDescription: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  blockerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  blockerButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#78350F20',
    borderWidth: 1,
    borderColor: '#78350F40',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#F59E0B',
    lineHeight: 16,
  },
  warningButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  warningButtonText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  campaignBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#151A22',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  barLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  goalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  barInfo: {
    flex: 1,
  },
  barName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  barMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  barPlatform: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  goalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  goalBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#151A22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  modalClose: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  selectingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  campaignList: {
    paddingHorizontal: 16,
  },
  campaignItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  campaignItemSelected: {
    backgroundColor: '#8B5CF610',
    borderWidth: 1,
    borderColor: '#8B5CF630',
  },
  campaignItemPaused: {
    opacity: 0.5,
  },
  campaignItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  campaignGoalIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  campaignItemInfo: {
    flex: 1,
  },
  campaignItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  textPaused: {
    color: '#6B7280',
  },
  campaignItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  campaignBudget: {
    fontSize: 11,
    color: '#6B7280',
  },
  pausedBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
  },
  pausedBadgeText: {
    fontSize: 9,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: '#1F293720',
    marginHorizontal: 4,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    marginTop: 8,
  },
  footerNote: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0E14',
  },
});
