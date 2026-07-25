import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Platform,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useCampaign, type ProductAnchorInput } from '@/context/CampaignContext';

export function ProductIdentityEditor({
  campaignId,
  campaignName,
  onDone,
  embedded = false,
}: {
  campaignId: string;
  campaignName?: string;
  onDone?: () => void;
  embedded?: boolean;
}) {
  const { getProductAnchor, updateProductAnchor } = useCampaign();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [paName, setPaName] = useState('');
  const [paType, setPaType] = useState('');
  const [paKeyAttrs, setPaKeyAttrs] = useState('');
  const [paCoreProblem, setPaCoreProblem] = useState('');
  const [paDiffFeature, setPaDiffFeature] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSaved(false);
    setLoading(true);
    getProductAnchor(campaignId)
      .then((anchor) => {
        if (cancelled) return;
        setPaName(anchor?.name ?? '');
        setPaType(anchor?.type ?? '');
        setPaKeyAttrs(anchor?.keyAttributes?.join(', ') ?? '');
        setPaCoreProblem(anchor?.coreProblemSolved ?? '');
        setPaDiffFeature(anchor?.differentiatingFeature ?? '');
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message || 'Failed to load product identity');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [campaignId, getProductAnchor]);

  const hasAnyField = !!(paName.trim() || paType.trim() || paKeyAttrs.trim() || paCoreProblem.trim() || paDiffFeature.trim());

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    // All-or-nothing: a product anchor must carry name, type, core problem, and
    // differentiating feature — or be cleared entirely (business-level doctrine).
    if (!paName.trim() || !paType.trim() || !paCoreProblem.trim() || !paDiffFeature.trim()) {
      setError('Fill product name, type, core problem, and differentiating feature — or use Clear to remove product identity.');
      return;
    }
    const anchor: ProductAnchorInput = {
      name: paName.trim(),
      type: paType.trim(),
      keyAttributes: paKeyAttrs.split(',').map(s => s.trim()).filter(Boolean),
      coreProblemSolved: paCoreProblem.trim(),
      differentiatingFeature: paDiffFeature.trim(),
    };
    setSaving(true);
    try {
      await updateProductAnchor(campaignId, anchor);
      if (onDone) {
        onDone();
      } else {
        setSaved(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save product identity');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateProductAnchor(campaignId, null);
      if (onDone) {
        onDone();
      } else {
        setPaName('');
        setPaType('');
        setPaKeyAttrs('');
        setPaCoreProblem('');
        setPaDiffFeature('');
        setSaved(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to clear product identity');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: 'center' }}>
        <ActivityIndicator color="#8B5CF6" />
      </View>
    );
  }

  const body = (
    <>
      <Text style={{ color: '#6B7280', fontSize: 11, lineHeight: 15, marginBottom: 12, paddingHorizontal: embedded ? 0 : 16 }}>
        {campaignName
          ? `Pin the product "${campaignName}" promotes so the AI reasons at product level. Clear it to reason at business level.`
          : 'Pin the product this campaign promotes so the AI reasons at product level.'}
      </Text>
      <View style={pi.field}>
        <Text style={pi.label}>Product Name</Text>
        <TextInput
          style={pi.input}
          value={paName}
          onChangeText={setPaName}
          placeholder="e.g. AcmeFlow Pro"
          placeholderTextColor="#4B5563"
          testID="edit-pa-name-input"
        />
      </View>
      <View style={pi.field}>
        <Text style={pi.label}>Product Type</Text>
        <TextInput
          style={pi.input}
          value={paType}
          onChangeText={setPaType}
          placeholder="e.g. Project management SaaS"
          placeholderTextColor="#4B5563"
          testID="edit-pa-type-input"
        />
      </View>
      <View style={pi.field}>
        <Text style={pi.label}>Key Attributes (comma-separated)</Text>
        <TextInput
          style={pi.input}
          value={paKeyAttrs}
          onChangeText={setPaKeyAttrs}
          placeholder="e.g. real-time sync, offline mode"
          placeholderTextColor="#4B5563"
          testID="edit-pa-attributes-input"
        />
      </View>
      <View style={pi.field}>
        <Text style={pi.label}>Core Problem Solved</Text>
        <TextInput
          style={[pi.input, { height: 64, textAlignVertical: 'top' }]}
          value={paCoreProblem}
          onChangeText={setPaCoreProblem}
          placeholder="What specific problem does it solve?"
          placeholderTextColor="#4B5563"
          multiline
          testID="edit-pa-problem-input"
        />
      </View>
      <View style={pi.field}>
        <Text style={pi.label}>Differentiating Feature</Text>
        <TextInput
          style={[pi.input, { height: 64, textAlignVertical: 'top' }]}
          value={paDiffFeature}
          onChangeText={setPaDiffFeature}
          placeholder="What makes it different from alternatives?"
          placeholderTextColor="#4B5563"
          multiline
          testID="edit-pa-diff-input"
        />
      </View>

      {error && (
        <View style={pi.errorBox}>
          <Ionicons name="alert-circle" size={14} color="#EF4444" />
          <Text style={pi.errorText}>{error}</Text>
        </View>
      )}

      {saved && !error && (
        <View style={pi.savedBox}>
          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
          <Text style={pi.savedText}>Product identity updated.</Text>
        </View>
      )}

      <TouchableOpacity
        style={[pi.saveButton, saving && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={saving}
        testID="save-product-identity-button"
      >
        {saving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={pi.saveButtonText}>Save Product Identity</Text>
          </>
        )}
      </TouchableOpacity>

      {hasAnyField && (
        <TouchableOpacity
          style={[pi.clearButton, saving && { opacity: 0.6 }]}
          onPress={handleClear}
          disabled={saving}
          testID="clear-product-identity-button"
        >
          <Ionicons name="trash-outline" size={16} color="#F59E0B" />
          <Text style={pi.clearButtonText}>Clear (reason at business level)</Text>
        </TouchableOpacity>
      )}

      {!embedded && onDone && (
        <TouchableOpacity style={pi.cancelButton} onPress={onDone} disabled={saving}>
          <Text style={pi.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </>
  );

  if (embedded) {
    return <View>{body}</View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView style={pi.container} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function ProductIdentityDegradedBanner({
  campaignId,
  isDark,
}: {
  campaignId: string | null;
  isDark: boolean;
}) {
  const { campaigns } = useCampaign();
  const [editorOpen, setEditorOpen] = useState(false);

  const { data } = useQuery<{ productAnchor: ProductAnchorInput | null }>({
    queryKey: ['/api/campaigns', campaignId, 'product-anchor'],
    enabled: !!campaignId,
  });

  if (!campaignId || !data || data.productAnchor !== null) return null;

  const campaignName = campaigns.find((c: any) => c.id === campaignId)?.name || '';

  return (
    <>
      <TouchableOpacity
        style={[
          pi.banner,
          {
            backgroundColor: isDark ? '#8B5CF612' : '#8B5CF60D',
            borderColor: isDark ? '#8B5CF640' : '#8B5CF630',
          },
        ]}
        onPress={() => setEditorOpen(true)}
        activeOpacity={0.7}
        testID="product-identity-degraded-banner"
      >
        <Ionicons name="information-circle-outline" size={16} color="#8B5CF6" />
        <Text style={[pi.bannerText, { color: isDark ? '#C4B5FD' : '#7C3AED' }]}>
          AI is reasoning at business level — pin your product identity for sharper results
        </Text>
        <Ionicons name="chevron-forward" size={14} color="#8B5CF6" />
      </TouchableOpacity>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={pi.modalOverlay}>
          <View style={pi.modalContent}>
            <View style={pi.modalHeader}>
              <Text style={pi.modalTitle}>Product Identity</Text>
              <TouchableOpacity onPress={() => setEditorOpen(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
            <ProductIdentityEditor
              campaignId={campaignId}
              campaignName={campaignName}
              onDone={() => setEditorOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const pi = StyleSheet.create({
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
    fontWeight: '600' as const,
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
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B98115',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  savedText: {
    fontSize: 12,
    color: '#10B981',
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
    fontWeight: '600' as const,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F59E0B40',
    backgroundColor: '#F59E0B12',
  },
  clearButtonText: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#6B7280',
    fontSize: 14,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  bannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingBottom: Platform.OS === 'web' ? 34 : 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#F9FAFB',
  },
});
