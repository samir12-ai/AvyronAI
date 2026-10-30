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
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCampaign, type ProductAnchorInput, type CampaignInfo } from '@/context/CampaignContext';

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

function formatBudgetDisplay(budget: any): string | null {
  if (!budget) return null;
  if (typeof budget === 'string') return budget;
  if (typeof budget === 'object') {
    if (budget.monthlyBudget != null && Number(budget.monthlyBudget) > 0) {
      return `${budget.currency || 'USD'} ${Number(budget.monthlyBudget).toLocaleString()}/mo`;
    }
    if (budget.budgetMode === 'ZERO_BUDGET' || budget.monthlyBudget === 0) {
      return 'Organic ($0)';
    }
  }
  return null;
}

function CampaignBlocker() {
  const { campaigns, selectCampaign, deleteCampaign, refreshCampaigns } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const handleSelect = async (campaign: any) => {
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
          All analytics, strategy, and optimization are scoped to a single product campaign for accuracy. Choose which campaign to analyze or create a new one.
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
          <Text style={styles.warningButtonText}>Switch</Text>
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
  const router = useRouter();
  const {
    selectedCampaign,
    campaigns,
    selectCampaign,
    deleteCampaign,
    refreshCampaigns,
    isSwitchingCampaign,
  } = useCampaign();
  const [showModal, setShowModal] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showCreateInModal, setShowCreateInModal] = useState(false);

  const handleSelect = async (campaign: any) => {
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
    setShowCreateInModal(false);
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
              <Text style={[styles.barPlatform, { marginTop: 1 }]}>Tap to choose or launch a product campaign</Text>
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

  const goalColor = GOAL_TYPE_COLORS[selectedCampaign.campaignGoalType] || '#8B5CF6';
  const goalIcon = GOAL_TYPE_ICONS[selectedCampaign.campaignGoalType] || 'layers-outline';
  const marketLabel = selectedCampaign.targetMarket || selectedCampaign.campaignLocation || null;
  const productLabel = selectedCampaign.productName || null;
  const planBadge = selectedCampaign.activePlan
    ? `Plan v${selectedCampaign.activePlan.version} · ${selectedCampaign.activePlan.status}`
    : selectedCampaign.setupStatus === 'IN_SETUP'
      ? 'IN SETUP'
      : null;
  const statusUpper = (selectedCampaign.campaignStatus || 'active').toUpperCase();
  const isPaused = statusUpper === 'PAUSED';
  const budgetText = formatBudgetDisplay(selectedCampaign.budget);

  return (
    <>
      <TouchableOpacity
        style={styles.campaignBar}
        onPress={openModal}
        activeOpacity={0.75}
        testID="campaign-selector-button"
      >
        <View style={styles.barLeft}>
          <View style={[styles.goalDot, { backgroundColor: isPaused ? '#F59E0B' : '#10B981' }]} />
          <View style={styles.barInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.barName} numberOfLines={1}>
                {selectedCampaign.selectedCampaignName}
              </Text>
              {productLabel && (
                <View style={styles.productPill}>
                  <Ionicons name="cube-outline" size={10} color="#C4B5FD" />
                  <Text style={styles.productPillText} numberOfLines={1}>
                    {productLabel}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.statusBadge,
                  isPaused
                    ? { backgroundColor: '#78350F40', borderColor: '#F59E0B50' }
                    : { backgroundColor: '#064E3B40', borderColor: '#10B98150' },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    { color: isPaused ? '#FBBF24' : '#34D399' },
                  ]}
                >
                  {statusUpper}
                </Text>
              </View>
              {planBadge && (
                <View style={styles.planPill}>
                  <Ionicons name="ribbon-outline" size={10} color="#60A5FA" />
                  <Text style={styles.planPillText}>{planBadge}</Text>
                </View>
              )}
            </View>
            <View style={styles.barMeta}>
              <View style={[styles.goalBadge, { backgroundColor: goalColor + '20' }]}>
                <Ionicons name={goalIcon as any} size={10} color={goalColor} />
                <Text style={[styles.goalBadgeText, { color: goalColor }]}>
                  {selectedCampaign.campaignGoalType}
                </Text>
              </View>
              {marketLabel ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name="location-outline" size={11} color="#9CA3AF" />
                  <Text style={styles.barPlatform}>{marketLabel}</Text>
                </View>
              ) : null}
              {budgetText ? (
                <Text style={styles.barPlatform}>• {budgetText}</Text>
              ) : null}
              <Text style={styles.barPlatform}>
                • {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} in workspace
              </Text>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isSwitchingCampaign && <ActivityIndicator size="small" color="#8B5CF6" />}
          <TouchableOpacity
            style={styles.createCampaignChip}
            onPress={() => router.push('/setup?mode=new' as any)}
            testID="header-create-campaign-btn"
          >
            <Ionicons name="add-circle-outline" size={14} color="#A78BFA" />
            <Text style={styles.createCampaignChipText}>Create Campaign</Text>
          </TouchableOpacity>
          <View style={styles.switchBtnChip}>
            <Text style={styles.switchBtnChipText}>Switch</Text>
            <Ionicons name="chevron-down" size={13} color="#D1D5DB" />
          </View>
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

const DATA_SOURCE_OPTIONS = [
  { value: 'benchmark', label: 'Market Benchmarks', icon: 'bar-chart-outline' as const, color: '#3B82F6', desc: 'Uses regional industry benchmarks (recommended for new campaigns)' },
  { value: 'campaign_metrics', label: 'Campaign Metrics', icon: 'analytics-outline' as const, color: '#8B5CF6', desc: 'Uses your actual campaign performance data' },
];

function NewCampaignForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { createCampaign } = useCampaign();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [dataSourceMode, setDataSourceMode] = useState('benchmark');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paName, setPaName] = useState('');
  const [paType, setPaType] = useState('');
  const [paKeyAttrs, setPaKeyAttrs] = useState('');
  const [paCoreProblem, setPaCoreProblem] = useState('');
  const [paDiffFeature, setPaDiffFeature] = useState('');

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('Campaign name is required'); return; }
    if (!objective) { setError('Select an objective'); return; }
    if (!location.trim()) { setError('Location is required'); return; }

    const anchorTouched = !!(paName.trim() || paType.trim() || paKeyAttrs.trim() || paCoreProblem.trim() || paDiffFeature.trim());
    let productAnchor: ProductAnchorInput | undefined;
    if (anchorTouched) {
      if (!paName.trim() || !paType.trim() || !paCoreProblem.trim() || !paDiffFeature.trim()) {
        setError('To set product identity, fill product name, type, core problem, and differentiating feature — or clear all product identity fields.');
        return;
      }
      productAnchor = {
        name: paName.trim(),
        type: paType.trim(),
        keyAttributes: paKeyAttrs.split(',').map(s => s.trim()).filter(Boolean),
        coreProblemSolved: paCoreProblem.trim(),
        differentiatingFeature: paDiffFeature.trim(),
      };
    }

    setSaving(true);
    try {
      await createCampaign({ name: name.trim(), objective, location: location.trim(), notes: notes.trim() || undefined, dataSourceMode, productAnchor });
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
            placeholder="e.g. Corporate Gifting Songs — UAE"
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
          <Text style={formStyles.label}>Target Market / Location *</Text>
          <TextInput
            style={formStyles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. United Arab Emirates"
            placeholderTextColor="#4B5563"
            testID="campaign-location-input"
          />
        </View>

        <View style={formStyles.field}>
          <Text style={formStyles.label}>Data Source Mode</Text>
          <View style={formStyles.objectiveGrid}>
            {DATA_SOURCE_OPTIONS.map(opt => {
              const selected = dataSourceMode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[formStyles.objectiveChip, selected && { backgroundColor: opt.color + '25', borderColor: opt.color }, { width: '100%' }]}
                  onPress={() => setDataSourceMode(opt.value)}
                  testID={`datasource-${opt.value}`}
                >
                  <Ionicons name={opt.icon} size={14} color={selected ? opt.color : '#6B7280'} />
                  <Text style={[formStyles.objectiveText, selected && { color: opt.color }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ color: '#6B7280', fontSize: 11, marginTop: 4 }}>
            {DATA_SOURCE_OPTIONS.find(o => o.value === dataSourceMode)?.desc}
          </Text>
        </View>

        <View style={formStyles.field}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
            <Text style={{ color: '#8B5CF6', fontSize: 13, fontWeight: '600', flex: 1 }}>Product Identity</Text>
          </View>

          <View style={{ marginTop: 10, gap: 12 }}>
            <Text style={{ color: '#6B7280', fontSize: 11, lineHeight: 15 }}>
              Pin the specific product or service this campaign promotes so Avyron reasons at the product level.
            </Text>
            <View>
              <Text style={formStyles.label}>Product / Service Name</Text>
              <TextInput
                style={formStyles.input}
                value={paName}
                onChangeText={setPaName}
                placeholder="e.g. Corporate Team Anthem Packages"
                placeholderTextColor="#4B5563"
                testID="pa-name-input"
              />
            </View>
            <View>
              <Text style={formStyles.label}>Product / Service Type</Text>
              <TextInput
                style={formStyles.input}
                value={paType}
                onChangeText={setPaType}
                placeholder="e.g. B2B Service / Digital Product"
                placeholderTextColor="#4B5563"
                testID="pa-type-input"
              />
            </View>
            <View>
              <Text style={formStyles.label}>Key Attributes (comma-separated)</Text>
              <TextInput
                style={formStyles.input}
                value={paKeyAttrs}
                onChangeText={setPaKeyAttrs}
                placeholder="e.g. bulk licensing, custom lyrics, 48h delivery"
                placeholderTextColor="#4B5563"
                testID="pa-attributes-input"
              />
            </View>
            <View>
              <Text style={formStyles.label}>Core Problem Solved</Text>
              <TextInput
                style={[formStyles.input, { height: 64, textAlignVertical: 'top' }]}
                value={paCoreProblem}
                onChangeText={setPaCoreProblem}
                placeholder="What specific problem does this offering solve?"
                placeholderTextColor="#4B5563"
                multiline
                testID="pa-problem-input"
              />
            </View>
            <View>
              <Text style={formStyles.label}>Differentiating Feature</Text>
              <TextInput
                style={[formStyles.input, { height: 64, textAlignVertical: 'top' }]}
                value={paDiffFeature}
                onChangeText={setPaDiffFeature}
                placeholder="What makes it different from alternatives?"
                placeholderTextColor="#4B5563"
                multiline
                testID="pa-diff-input"
              />
            </View>
          </View>
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
  campaigns: CampaignInfo[];
  onSelect: (c: any) => void;
  onDelete: (campaignId: string) => void;
  onClose: () => void;
  selecting: boolean;
  currentId?: string;
  initialCreate?: boolean;
}) {
  const router = useRouter();
  const { entitlement, toggleCampaignStatus } = useCampaign();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && initialCreate) {
      setShowCreateForm(true);
    }
    if (!visible) {
      setShowCreateForm(false);
      setStatusError(null);
    }
  }, [visible, initialCreate]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleClose = () => {
    setShowCreateForm(false);
    setConfirmDeleteId(null);
    setStatusError(null);
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

  const handleTogglePause = async (item: CampaignInfo) => {
    setStatusError(null);
    setTogglingId(item.id);
    try {
      const nextStatus = item.status === 'paused' ? 'active' : 'paused';
      await toggleCampaignStatus(item.id, nextStatus);
    } catch (err: any) {
      setStatusError(err.message || 'Could not update campaign status');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{showCreateForm ? 'Quick Create Campaign' : 'Workspace Campaigns'}</Text>
              {!showCreateForm && entitlement && (
                <Text style={styles.entitlementSubtitle}>
                  Package:{' '}
                  <Text style={{ color: '#A78BFA', fontWeight: '700' }}>
                    {String((entitlement as any).packageTier || entitlement.tier || 'starter').toUpperCase()}
                  </Text>{' '}
                  • {(entitlement as any).currentActiveCampaigns ?? entitlement.activeCampaignCount ?? 0} /{' '}
                  {entitlement.maxActiveCampaigns ?? 1} active campaigns
                  {((entitlement as any).monthlyPriceUsd ?? entitlement.proposedPriceUsdMonthly ?? 0) > 0
                    ? ` ($${(entitlement as any).monthlyPriceUsd ?? entitlement.proposedPriceUsdMonthly}/mo)`
                    : ' (Isolated Test Entitlement)'}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.modalClose} testID="close-campaign-modal">
              <Ionicons name="close" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {showCreateForm ? (
            <NewCampaignForm onCreated={handleCreated} onCancel={() => setShowCreateForm(false)} />
          ) : (
            <>
              <Text style={styles.modalSubtitle}>
                Each campaign targets a specific product or service with its own market, strategy, evidence, and usage ledger.
              </Text>

              <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 12 }}>
                <TouchableOpacity
                  style={[formStyles.newCampaignButton, { flex: 1, marginHorizontal: 0, marginBottom: 0 }]}
                  onPress={() => {
                    handleClose();
                    router.push('/setup?mode=new' as any);
                  }}
                  testID="launch-product-campaign-wizard-button"
                >
                  <View style={formStyles.newCampaignIcon}>
                    <Ionicons name="sparkles" size={16} color="#8B5CF6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={formStyles.newCampaignText}>+ Create Campaign (Product Setup)</Text>
                    <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Reuses verified company info & discovers product competitors</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {statusError && (
                <View style={[formStyles.errorBox, { marginHorizontal: 16 }]}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={formStyles.errorText}>{statusError}</Text>
                </View>
              )}

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
                  const goalColor = GOAL_TYPE_COLORS[item.goalType] || '#8B5CF6';
                  const goalIcon = GOAL_TYPE_ICONS[item.goalType] || 'layers-outline';
                  const isSelected = item.id === currentId;
                  const isPaused = item.status === 'paused';
                  const market = item.targetMarket || item.location || 'Market Unset';
                  const budgetStr = formatBudgetDisplay(item.budget);
                  const activePlanLabel = item.activePlan
                    ? `Plan v${item.activePlan.version} · ${item.activePlan.status}`
                    : item.setupStatus === 'IN_SETUP'
                      ? `Setup (${item.setupStep || 'In Progress'})`
                      : 'No Plan Yet';

                  return (
                    <View
                      style={[
                        styles.campaignItem,
                        isSelected && styles.campaignItemSelected,
                        isPaused && styles.campaignItemPaused,
                      ]}
                      testID={`campaign-list-item-${item.id}`}
                    >
                      <TouchableOpacity
                        style={styles.campaignItemLeft}
                        onPress={() => onSelect(item)}
                        disabled={selecting}
                        activeOpacity={0.7}
                        testID={`campaign-row-${item.id}`}
                      >
                        <View style={[styles.campaignGoalIcon, { backgroundColor: goalColor + '20' }]}>
                          <Ionicons name={goalIcon as any} size={16} color={isPaused ? '#9CA3AF' : goalColor} />
                        </View>
                        <View style={styles.campaignItemInfo}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text
                              style={[styles.campaignItemName, isPaused && styles.textPaused]}
                              numberOfLines={1}
                            >
                              {item.name}
                            </Text>
                            {item.productName && (
                              <View style={styles.productPill}>
                                <Text style={styles.productPillText}>
                                  {item.productName}
                                  {item.productType ? ` (${item.productType})` : ''}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View style={styles.campaignItemMeta}>
                            <View style={[styles.goalBadge, { backgroundColor: isPaused ? '#374151' : goalColor + '20' }]}>
                              <Text style={[styles.goalBadgeText, { color: isPaused ? '#9CA3AF' : goalColor }]}>
                                {item.goalType}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                              <Ionicons name="location-outline" size={11} color="#9CA3AF" />
                              <Text style={styles.campaignBudget}>{market}</Text>
                            </View>
                            {budgetStr && (
                              <Text style={styles.campaignBudget}>• {budgetStr}</Text>
                            )}
                            <View style={styles.planPill}>
                              <Text style={styles.planPillText}>{activePlanLabel}</Text>
                            </View>
                            <View
                              style={[
                                styles.pausedBadge,
                                !isPaused && { backgroundColor: '#064E3B60' },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.pausedBadgeText,
                                  !isPaused && { color: '#34D399' },
                                ]}
                              >
                                {(item.status || 'active').toUpperCase()}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {item.setupStatus === 'IN_SETUP' && (
                          <TouchableOpacity
                            style={styles.resumeSetupBtn}
                            onPress={() => {
                              handleClose();
                              router.push(`/setup?campaignId=${item.id}` as any);
                            }}
                          >
                            <Text style={styles.resumeSetupBtnText}>Resume</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={() => handleTogglePause(item)}
                          disabled={togglingId === item.id}
                          style={styles.pauseToggleBtn}
                          testID={`toggle-status-${item.id}`}
                        >
                          {togglingId === item.id ? (
                            <ActivityIndicator size="small" color="#9CA3AF" />
                          ) : (
                            <Ionicons
                              name={isPaused ? 'play-outline' : 'pause-outline'}
                              size={15}
                              color={isPaused ? '#10B981' : '#F59E0B'}
                            />
                          )}
                        </TouchableOpacity>
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
                <View style={formStyles.confirmDeleteBar}>
                  <Text style={formStyles.confirmDeleteText} numberOfLines={2}>
                    Delete "{confirmDeleteName}"? This removes all metrics for this campaign.
                  </Text>
                  <View style={formStyles.confirmDeleteActions}>
                    <TouchableOpacity
                      style={formStyles.confirmDeleteCancel}
                      onPress={() => setConfirmDeleteId(null)}
                    >
                      <Text style={formStyles.confirmDeleteCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={formStyles.confirmDeleteBtn}
                      onPress={handleConfirmDelete}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={formStyles.confirmDeleteBtnText}>Delete</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.modalFooter}>
                <Text style={styles.footerNote}>
                  {`${campaigns.length} campaign${campaigns.length !== 1 ? 's' : ''} in workspace • Active strategies are isolated per campaign`}
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
  campaignBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111621',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
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
    fontWeight: '700',
    color: '#F8FAFC',
  },
  barMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 3,
  },
  barPlatform: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  productPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4C1D9540',
    borderWidth: 1,
    borderColor: '#7C3AED50',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  productPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#DDD6FE',
  },
  statusBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  planPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E3A8A35',
    borderWidth: 1,
    borderColor: '#3B82F640',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  planPillText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#93C5FD',
  },
  createCampaignChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4C1D9530',
    borderWidth: 1,
    borderColor: '#8B5CF650',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  createCampaignChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  switchBtnChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  switchBtnChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E5E7EB',
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
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#151A22',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  entitlementSubtitle: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  modalClose: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingHorizontal: 20,
    marginBottom: 14,
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
    backgroundColor: '#8B5CF615',
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  campaignItemPaused: {
    opacity: 0.75,
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
    fontWeight: '700',
    color: '#F8FAFC',
  },
  textPaused: {
    color: '#9CA3AF',
  },
  campaignItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 5,
  },
  campaignBudget: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  pausedBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
  },
  pausedBadgeText: {
    fontSize: 9,
    color: '#D1D5DB',
    fontWeight: '700',
  },
  resumeSetupBtn: {
    backgroundColor: '#4C1D95',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  resumeSetupBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#E9D5FF',
  },
  pauseToggleBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#EF444415',
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    height: 1,
    backgroundColor: '#1F293740',
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
    borderColor: '#8B5CF640',
    borderStyle: 'dashed',
    backgroundColor: '#8B5CF612',
  },
  newCampaignIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#8B5CF625',
    justifyContent: 'center',
    alignItems: 'center',
  },
  newCampaignText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C4B5FD',
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
