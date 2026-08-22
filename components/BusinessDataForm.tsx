import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  useColorScheme,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { getApiUrl, safeApiJson, authFetch } from '@/lib/query-client';
import { useCampaign } from '@/context/CampaignContext';

export interface BusinessSetupInput {
  websiteUrl: string;
  campaignOfferingName: string;
  offeringFeaturesAndNotes: string;
}

const EMPTY_DATA: BusinessSetupInput = {
  websiteUrl: '',
  campaignOfferingName: '',
  offeringFeaturesAndNotes: '',
};

interface Props {
  onComplete?: (data: BusinessSetupInput) => void;
  onDataChange?: (isComplete: boolean) => void;
}

export default function BusinessDataForm({ onComplete, onDataChange }: Props) {
  const isDark = true;
  const colors = isDark ? Colors.dark : Colors.light;
  const { selectedCampaign } = useCampaign();
  
  const [data, setData] = useState<BusinessSetupInput>(EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const campaignId = selectedCampaign?.selectedCampaignId;

  const isComplete = useCallback(() => {
    return (
      data.websiteUrl.trim().length > 0 &&
      data.campaignOfferingName.trim().length > 0 &&
      data.offeringFeaturesAndNotes.trim().length > 0
    );
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
        const res = await authFetch(getApiUrl(`/api/business-setup/${campaignId}`));
        const json = await safeApiJson(res);
        if (!cancelled && json.exists && json.data) {
          setData({
            websiteUrl: json.data.websiteUrl || '',
            campaignOfferingName: json.data.campaignOfferingName || '',
            offeringFeaturesAndNotes: json.data.offeringFeaturesAndNotes || '',
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

  const updateField = useCallback((field: keyof BusinessSetupInput, value: string) => {
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
      // POST to new business-setup route
      const res = await authFetch(getApiUrl(`/api/business-setup/${campaignId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await safeApiJson(res);
      if (!res.ok || !json.success) {
        setError(json.message || json.error || 'Failed to save');
        return;
      }
      setSaved(true);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
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

  const renderTextField = (field: keyof BusinessSetupInput, label: string, placeholder: string, icon: any, multiline?: boolean) => {
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
            multiline && { height: 96, textAlignVertical: 'top' as const },
          ]}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={val}
          onChangeText={(v) => updateField(field, v)}
          multiline={multiline}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={s.header}>
        <View style={[s.iconWrap, { backgroundColor: '#6366F120' }]}>
          <Ionicons name="business-outline" size={20} color="#6366F1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>Business Profile</Text>
          <Text style={[s.subtitle, { color: colors.textSecondary }]}>
            Avyron uses this to discover and bind your strategy.
          </Text>
        </View>
      </View>

      {saved && isComplete() && (
        <View style={[s.savedBanner, { backgroundColor: colors.success + '12', borderColor: colors.success + '30' }]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={[s.savedText, { color: colors.success }]}>Business data saved</Text>
        </View>
      )}

      {renderTextField('websiteUrl', 'Website URL *', 'https://yourwebsite.com', 'globe-outline')}
      {renderTextField('campaignOfferingName', 'Primary Product / Service *', 'e.g. Refurbished iPhone 15 Pro, Hair Transplant', 'cube-outline')}
      {renderTextField('offeringFeaturesAndNotes', 'Features / Notes *', 'Any supplementary details, technical constraints, or offline notes for this offering...', 'document-text-outline', true)}

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
              <Text style={s.saveBtnText}>Analyze Business</Text>
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
