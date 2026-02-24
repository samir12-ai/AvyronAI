import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  useColorScheme,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

const FUNNEL_OBJECTIVES = [
  { value: 'AWARENESS', label: 'Awareness', icon: 'eye-outline' as const },
  { value: 'LEADS', label: 'Leads', icon: 'people-outline' as const },
  { value: 'SALES', label: 'Sales', icon: 'cart-outline' as const },
  { value: 'AUTHORITY', label: 'Authority', icon: 'shield-checkmark-outline' as const },
] as const;

const CONVERSION_CHANNELS = [
  { value: 'WHATSAPP', label: 'WhatsApp', icon: 'chatbubble-outline' as const },
  { value: 'WEBSITE', label: 'Website', icon: 'globe-outline' as const },
  { value: 'DM', label: 'Direct Message', icon: 'mail-outline' as const },
  { value: 'FORM', label: 'Form', icon: 'document-text-outline' as const },
] as const;

interface BusinessData {
  businessLocation: string;
  businessType: string;
  coreOffer: string;
  priceRange: string;
  targetAudienceAge: string;
  targetAudienceSegment: string;
  monthlyBudget: string;
  funnelObjective: string;
  primaryConversionChannel: string;
}

const EMPTY_DATA: BusinessData = {
  businessLocation: '',
  businessType: '',
  coreOffer: '',
  priceRange: '',
  targetAudienceAge: '',
  targetAudienceSegment: '',
  monthlyBudget: '',
  funnelObjective: '',
  primaryConversionChannel: '',
};

interface Props {
  onComplete?: (data: BusinessData) => void;
  onDataChange?: (isComplete: boolean) => void;
}

export default function BusinessDataForm({ onComplete, onDataChange }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();

  const [data, setData] = useState<BusinessData>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const campaignId = selectedCampaign?.selectedCampaignId;

  const isComplete = useCallback(() => {
    return Object.values(data).every(v => v.trim().length > 0);
  }, [data]);

  useEffect(() => {
    if (!campaignId) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setFetching(true);
      try {
        const res = await fetch(getApiUrl(`/api/business-data/${campaignId}?accountId=default`));
        const json = await res.json();
        if (!cancelled && json.exists && json.data) {
          const d = json.data;
          setData({
            businessLocation: d.businessLocation || '',
            businessType: d.businessType || '',
            coreOffer: d.coreOffer || '',
            priceRange: d.priceRange || '',
            targetAudienceAge: d.targetAudienceAge || '',
            targetAudienceSegment: d.targetAudienceSegment || '',
            monthlyBudget: d.monthlyBudget || '',
            funnelObjective: d.funnelObjective || '',
            primaryConversionChannel: d.primaryConversionChannel || '',
          });
          setSaved(true);
        }
      } catch (err) {
        console.error('[BusinessDataForm] fetch error:', err);
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    onDataChange?.(isComplete() && saved);
  }, [data, saved]);

  const updateField = useCallback((field: keyof BusinessData, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!campaignId) {
      setError('No campaign selected');
      return;
    }
    if (!isComplete()) {
      setError('All fields are required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(getApiUrl(`/api/business-data/${campaignId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, accountId: 'default' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || json.error || 'Failed to save');
        return;
      }
      setSaved(true);
      Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete?.(data);
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [campaignId, data, isComplete, onComplete]);

  if (!campaignId) {
    return (
      <View style={[s.emptyWrap, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
        <Text style={[s.emptyText, { color: colors.textSecondary }]}>
          Select a campaign first to configure business data.
        </Text>
      </View>
    );
  }

  if (fetching) {
    return (
      <View style={[s.emptyWrap, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.emptyText, { color: colors.textSecondary }]}>Loading business profile...</Text>
      </View>
    );
  }

  const renderTextField = (field: keyof BusinessData, label: string, placeholder: string, icon: any, multiline?: boolean) => {
    const val = data[field];
    const filled = val.trim().length > 0;
    return (
      <View style={s.fieldWrap}>
        <View style={s.fieldLabelRow}>
          <Ionicons name={icon} size={15} color={filled ? colors.success : colors.textMuted} />
          <Text style={[s.fieldLabel, { color: colors.text }]}>{label}</Text>
          {filled && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
        </View>
        <TextInput
          style={[
            s.input,
            {
              backgroundColor: colors.inputBackground,
              color: colors.text,
              borderColor: filled ? colors.success + '40' : colors.inputBorder,
            },
            multiline && { height: 72, textAlignVertical: 'top' as const },
          ]}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={val}
          onChangeText={(v) => updateField(field, v)}
          multiline={multiline}
          autoCapitalize="sentences"
        />
      </View>
    );
  };

  const renderChipSelector = (
    field: keyof BusinessData,
    label: string,
    options: readonly { value: string; label: string; icon: any }[],
  ) => {
    const selected = data[field];
    return (
      <View style={s.fieldWrap}>
        <View style={s.fieldLabelRow}>
          <Ionicons name="options-outline" size={15} color={selected ? colors.success : colors.textMuted} />
          <Text style={[s.fieldLabel, { color: colors.text }]}>{label}</Text>
          {selected.length > 0 && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
        </View>
        <View style={s.chipRow}>
          {options.map(opt => {
            const isSelected = selected === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  updateField(field, opt.value);
                  Platform.OS !== 'web' && Haptics.selectionAsync();
                }}
                style={[
                  s.chip,
                  {
                    backgroundColor: isSelected ? colors.primary + '18' : colors.inputBackground,
                    borderColor: isSelected ? colors.primary : colors.inputBorder,
                  },
                ]}
              >
                <Ionicons name={opt.icon} size={14} color={isSelected ? colors.primary : colors.textMuted} />
                <Text style={[s.chipText, { color: isSelected ? colors.primary : colors.textSecondary }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const filledCount = Object.values(data).filter(v => v.trim().length > 0).length;
  const totalFields = 9;

  return (
    <View style={[s.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={s.header}>
        <View style={[s.iconWrap, { backgroundColor: '#6366F120' }]}>
          <Ionicons name="business-outline" size={20} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>Business Profile</Text>
          <Text style={[s.subtitle, { color: colors.textSecondary }]}>
            Required before plan creation
          </Text>
        </View>
        <View style={[s.progressBadge, {
          backgroundColor: filledCount === totalFields ? colors.success + '18' : colors.warning + '18',
          borderColor: filledCount === totalFields ? colors.success + '40' : colors.warning + '40',
        }]}>
          <Text style={[s.progressText, {
            color: filledCount === totalFields ? colors.success : colors.warning,
          }]}>
            {filledCount}/{totalFields}
          </Text>
        </View>
      </View>

      {saved && isComplete() && (
        <View style={[s.savedBanner, { backgroundColor: colors.success + '12', borderColor: colors.success + '30' }]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={[s.savedText, { color: colors.success }]}>Business data saved</Text>
        </View>
      )}

      {renderTextField('businessLocation', 'Business Location', 'e.g. Dubai, UAE', 'location-outline')}
      {renderTextField('businessType', 'Business Type', 'e.g. E-commerce, SaaS, Agency', 'briefcase-outline')}
      {renderTextField('coreOffer', 'Core Offer', 'e.g. Premium photography packages', 'pricetag-outline', true)}
      {renderTextField('priceRange', 'Price Range', 'e.g. $500 - $2,000', 'cash-outline')}
      {renderTextField('targetAudienceAge', 'Target Audience Age', 'e.g. 25-45', 'people-outline')}
      {renderTextField('targetAudienceSegment', 'Target Audience Segment', 'e.g. Small business owners, new mothers', 'person-outline', true)}
      {renderTextField('monthlyBudget', 'Monthly Budget', 'e.g. $1,000', 'wallet-outline')}

      {renderChipSelector('funnelObjective', 'Funnel Objective', FUNNEL_OBJECTIVES)}
      {renderChipSelector('primaryConversionChannel', 'Primary Conversion Channel', CONVERSION_CHANNELS)}

      {error ? (
        <View style={[s.errorWrap, { backgroundColor: colors.error + '12', borderColor: colors.error + '30' }]}>
          <Ionicons name="warning-outline" size={14} color={colors.error} />
          <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={handleSave}
        disabled={loading || !isComplete()}
        style={[s.saveBtn, { opacity: (loading || !isComplete()) ? 0.5 : 1 }]}
      >
        <LinearGradient
          colors={saved && isComplete() ? ['#10B981', '#059669'] : ['#6366F1', '#4F46E5']}
          style={s.saveBtnGrad}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : saved && isComplete() ? (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={s.saveBtnText}>Saved</Text>
            </>
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={s.saveBtnText}>Save Business Data</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  progressBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
  },
  savedText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  fieldWrap: {
    marginBottom: 14,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  errorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  saveBtn: {
    marginTop: 4,
  },
  saveBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  emptyWrap: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center' as const,
  },
});
