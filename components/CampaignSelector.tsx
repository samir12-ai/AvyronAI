import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
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
  const { campaigns, selectCampaign, deleteCampaign, isLoading, refreshCampaigns } = useCampaign();
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
        onDelete={(id) => deleteCampaign(id).catch(() => {})}
        onClose={() => setShowModal(false)}
        selecting={selecting}
      />
    </View>
  );
}

function CampaignWarningBanner() {
  const { warning, campaigns, selectCampaign, deleteCampaign, refreshCampaigns } = useCampaign();
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
        onDelete={(id) => deleteCampaign(id).catch(() => {})}
        onClose={() => setShowModal(false)}
        selecting={selecting}
      />
    </>
  );
}

function CampaignBar() {
  const { selectedCampaign, campaigns, selectCampaign, deleteCampaign, clearSelection, refreshCampaigns } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showCreateInModal, setShowCreateInModal] = useState(false);

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

  const openModal = () => {
    refreshCampaigns();
    setShowModal(true);
  };

  if (!selectedCampaign) {
    return (
      <>
        <TouchableOpacity
          style={[styles.campaignBar, { borderColor: '#8B5CF630', borderStyle: 'dashed' }]}
          onPress={openModal}
          activeOpacity={0.7}
          testID="campaign-bar-empty"
        >
          <View style={styles.barLeft}>
            <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: '#8B5CF620', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="add" size={16} color="#8B5CF6" />
            </View>
            <View style={styles.barInfo}>
              <Text style={[styles.barName, { color: '#8B5CF6' }]}>Select or Create Campaign</Text>
              <Text style={[styles.barPlatform, { marginTop: 1 }]}>Tap to get started</Text>
            </View>
          </View>
          <Ionicons name="chevron-down" size={16} color="#8B5CF6" />
        </TouchableOpacity>

        <CampaignListModal
          visible={showModal}
          campaigns={campaigns}
          onSelect={handleSelect}
          onDelete={(id) => deleteCampaign(id).catch(() => {})}
          onClose={() => setShowModal(false)}
          selecting={selecting}
        />
      </>
    );
  }

  const goalColor = GOAL_TYPE_COLORS[selectedCampaign.campaignGoalType] || '#6B7280';
  const goalIcon = GOAL_TYPE_ICONS[selectedCampaign.campaignGoalType] || 'help-circle';

  return (
    <>
      <TouchableOpacity
        style={styles.campaignBar}
        onPress={openModal}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => { setShowModal(true); setShowCreateInModal(true); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.6}
          >
            <View style={styles.plusButton}>
              <Ionicons name="add" size={16} color="#10B981" />
            </View>
          </TouchableOpacity>
          <Ionicons name="chevron-down" size={16} color="#6B7280" />
        </View>
      </TouchableOpacity>

      <CampaignListModal
        visible={showModal}
        campaigns={campaigns}
        onSelect={handleSelect}
        onDelete={(id) => deleteCampaign(id).catch(() => {})}
        onClose={() => { setShowModal(false); setShowCreateInModal(false); }}
        selecting={selecting}
        currentId={selectedCampaign.selectedCampaignId}
        initialCreate={showCreateInModal}
      />
    </>
  );
}

const OBJECTIVE_OPTIONS = [
  { value: 'LEADS', label: 'Leads', icon: 'people' as const, color: '#10B981' },
  { value: 'AWARENESS', label: 'Awareness', icon: 'megaphone' as const, color: '#6366F1' },
  { value: 'SALES', label: 'Sales', icon: 'cart' as const, color: '#EF4444' },
  { value: 'RETARGETING', label: 'Retargeting', icon: 'reload' as const, color: '#F59E0B' },
  { value: 'TESTING', label: 'Testing', icon: 'flask' as const, color: '#8B5CF6' },
];

function NewCampaignForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { createCampaign } = useCampaign();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('Campaign name is required'); return; }
    if (!objective) { setError('Select an objective'); return; }
    if (!location.trim()) { setError('Location is required'); return; }

    setSaving(true);
    try {
      await createCampaign({ name: name.trim(), objective, location: location.trim(), notes: notes.trim() || undefined });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView style={formStyles.container} keyboardShouldPersistTaps="handled">
        <View style={formStyles.field}>
          <Text style={formStyles.label}>Campaign Name *</Text>
          <TextInput
            style={formStyles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Summer Brand Launch"
            placeholderTextColor="#4B5563"
            autoFocus
            testID="campaign-name-input"
          />
        </View>

        <View style={formStyles.field}>
          <Text style={formStyles.label}>Objective *</Text>
          <View style={formStyles.objectiveGrid}>
            {OBJECTIVE_OPTIONS.map(opt => {
              const selected = objective === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[formStyles.objectiveChip, selected && { backgroundColor: opt.color + '25', borderColor: opt.color }]}
                  onPress={() => setObjective(opt.value)}
                  testID={`objective-${opt.value}`}
                >
                  <Ionicons name={opt.icon} size={14} color={selected ? opt.color : '#6B7280'} />
                  <Text style={[formStyles.objectiveText, selected && { color: opt.color }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={formStyles.field}>
          <Text style={formStyles.label}>Location *</Text>
          <TextInput
            style={formStyles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Dubai, UAE"
            placeholderTextColor="#4B5563"
            testID="campaign-location-input"
          />
        </View>

        <View style={formStyles.field}>
          <Text style={formStyles.label}>Notes (optional)</Text>
          <TextInput
            style={[formStyles.input, { height: 64, textAlignVertical: 'top' }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Any additional context..."
            placeholderTextColor="#4B5563"
            multiline
          />
        </View>

        {error && (
          <View style={formStyles.errorBox}>
            <Ionicons name="alert-circle" size={14} color="#EF4444" />
            <Text style={formStyles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[formStyles.saveButton, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
          testID="save-campaign-button"
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={formStyles.saveButtonText}>Create Campaign</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={formStyles.cancelButton} onPress={onCancel} disabled={saving}>
          <Text style={formStyles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CampaignListModal({
  visible,
  campaigns,
  onSelect,
  onDelete,
  onClose,
  selecting,
  currentId,
  initialCreate,
}: {
  visible: boolean;
  campaigns: any[];
  onSelect: (c: any) => void;
  onDelete: (campaignId: string) => void;
  onClose: () => void;
  selecting: boolean;
  currentId?: string;
  initialCreate?: boolean;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    if (visible && initialCreate) {
      setShowCreateForm(true);
    }
  }, [visible, initialCreate]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleClose = () => {
    setShowCreateForm(false);
    setConfirmDeleteId(null);
    onClose();
  };

  const handleCreated = () => {
    setShowCreateForm(false);
    onClose();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await onDelete(confirmDeleteId);
    } catch {} finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{showCreateForm ? 'New Campaign' : 'Select Campaign'}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {showCreateForm ? (
            <NewCampaignForm onCreated={handleCreated} onCancel={() => setShowCreateForm(false)} />
          ) : (
            <>
              <Text style={styles.modalSubtitle}>
                All data and AI analysis will be scoped to the selected campaign
              </Text>

              <TouchableOpacity
                style={formStyles.newCampaignButton}
                onPress={() => setShowCreateForm(true)}
                testID="new-campaign-button"
              >
                <View style={formStyles.newCampaignIcon}>
                  <Ionicons name="add" size={18} color="#8B5CF6" />
                </View>
                <Text style={formStyles.newCampaignText}>New Campaign</Text>
              </TouchableOpacity>

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
                    <View
                      style={[
                        styles.campaignItem,
                        isSelected && styles.campaignItemSelected,
                        isPaused && styles.campaignItemPaused,
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.campaignItemLeft}
                        onPress={() => onSelect(item)}
                        disabled={isPaused || selecting}
                        activeOpacity={0.7}
                      >
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
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {isSelected && (
                          <Ionicons name="checkmark-circle" size={20} color="#8B5CF6" />
                        )}
                        <TouchableOpacity
                          onPress={() => {
                            setConfirmDeleteId(item.id);
                            setConfirmDeleteName(item.name);
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.deleteButton}
                          testID={`delete-campaign-${item.id}`}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                style={styles.campaignList}
              />

              {confirmDeleteId && (
                <View style={styles.confirmDeleteBar}>
                  <Text style={styles.confirmDeleteText} numberOfLines={2}>
                    Delete "{confirmDeleteName}"? This removes all metrics.
                  </Text>
                  <View style={styles.confirmDeleteActions}>
                    <TouchableOpacity
                      style={styles.confirmDeleteCancel}
                      onPress={() => setConfirmDeleteId(null)}
                    >
                      <Text style={styles.confirmDeleteCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmDeleteBtn}
                      onPress={handleConfirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.confirmDeleteBtnText}>Delete</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.modalFooter}>
                <Text style={styles.footerNote}>
                  {`${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''} available`}
                </Text>
              </View>
            </>
          )}
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
  plusButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#10B98115',
    borderWidth: 1,
    borderColor: '#10B98140',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
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
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#EF444410',
    justifyContent: 'center',
    alignItems: 'center',
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

const formStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  field: {
    marginBottom: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#E5E7EB',
  },
  objectiveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  objectiveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
  },
  objectiveText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7F1D1D20',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    flex: 1,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#6B7280',
    fontSize: 14,
  },
  newCampaignButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8B5CF630',
    borderStyle: 'dashed',
    backgroundColor: '#8B5CF608',
  },
  newCampaignIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#8B5CF620',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newCampaignText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  confirmDeleteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#7F1D1D',
    borderTopWidth: 1,
    borderColor: '#EF444460',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  confirmDeleteText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#FCA5A5',
  },
  confirmDeleteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmDeleteCancel: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#9CA3AF60',
  },
  confirmDeleteCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  confirmDeleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    minWidth: 60,
    alignItems: 'center',
  },
  confirmDeleteBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});
