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
import { getApiUrl, safeApiJson , authFetch } from '@/lib/query-client';
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

const GOAL_TIMELINES = [
  { value: '30', label: '30 days', icon: 'timer-outline' as const },
  { value: '60', label: '60 days', icon: 'time-outline' as const },
  { value: '90', label: '90 days', icon: 'calendar-outline' as const },
  { value: '180', label: '6 months', icon: 'calendar-number-outline' as const },
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
  productCategory: string;
  coreProblemSolved: string;
  uniqueMechanism: string;
  strategicAdvantage: string;
  targetDecisionMaker: string;
  goalTarget: string;
  goalTimeline: string;
  goalDescription: string;
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
  productCategory: '',
  coreProblemSolved: '',
  uniqueMechanism: '',
  strategicAdvantage: '',
  targetDecisionMaker: '',
  goalTarget: '',
  goalTimeline: '',
  goalDescription: '',
};

const PERF_FORMATS = [
  { key: 'reel', label: 'Reel', icon: 'film-outline' as const },
  { key: 'carousel', label: 'Carousel', icon: 'albums-outline' as const },
  { key: 'story', label: 'Story', icon: 'aperture-outline' as const },
  { key: 'post', label: 'Post', icon: 'image-outline' as const },
] as const;

interface PerfEntry {
  avgReach: string;
  savesRate: string;
  avgEngagementRate: string;
}

const EMPTY_PERF: PerfEntry = { avgReach: '', savesRate: '', avgEngagementRate: '' };

function ContentPerformanceSection({ campaignId, colors, isDark }: { campaignId: string; colors: any; isDark: boolean }) {
  const [entries, setEntries] = useState<Record<string, PerfEntry>>({
    reel: { ...EMPTY_PERF },
    carousel: { ...EMPTY_PERF },
    story: { ...EMPTY_PERF },
    post: { ...EMPTY_PERF },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [lastLogged, setLastLogged] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(getApiUrl(`/api/performance/summary/${campaignId}`));
        const json = await safeApiJson(res);
        if (json.totalFormatsTracked > 0) {
          const latest = Object.values(json.summaryByFormat as Record<string, any>)
            .filter(Boolean)
            .sort((a: any, b: any) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())[0];
          if (latest?.lastUpdated) {
            setLastLogged(new Date(latest.lastUpdated).toLocaleDateString());
          }
        }
      } catch {}
    })();
  }, [campaignId]);

  const updateEntry = (fmt: string, field: keyof PerfEntry, value: string) => {
    setEntries(prev => ({ ...prev, [fmt]: { ...prev[fmt], [field]: value } }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - 6);
      const periodLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

      const promises = PERF_FORMATS.map(({ key }) => {
        const e = entries[key];
        if (!e.avgReach && !e.savesRate && !e.avgEngagementRate) return null;
        return authFetch(getApiUrl('/api/performance/ingest'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            contentType: key,
            periodLabel,
            periodStart: weekStart.toISOString(),
            periodEnd: today.toISOString(),
            avgReach: parseFloat(e.avgReach) || 0,
            savesRate: parseFloat(e.savesRate) / 100 || 0,
            avgEngagementRate: parseFloat(e.avgEngagementRate) / 100 || 0,
            totalPublished: 0,
            source: 'manual',
          }),
        });
      }).filter(Boolean);

      if (promises.length === 0) { setError('Enter at least one format'); setSaving(false); return; }
      const responses = await Promise.all(promises);
      const failed = (responses as any[]).filter((r) => r && !r.ok);
      if (failed.length > 0) {
        const firstErr = await failed[0].json().catch(() => ({}));
        throw new Error(firstErr.error || 'One or more formats failed to save');
      }
      setSaved(true);
      setLastLogged(new Date().toLocaleDateString());
      Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[s.channelsSection, { borderColor: '#F59E0B30', backgroundColor: isDark ? '#1A1300' : '#FFFBEB', marginTop: 16, marginBottom: 4 }]}>
      <View style={s.goalSectionHeader}>
        <Ionicons name="bar-chart-outline" size={16} color="#F59E0B" />
        <Text style={[s.goalSectionTitle, { color: colors.text }]}>Content Performance</Text>
        {saved && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
      </View>
      <Text style={[s.goalSectionSubtitle, { color: colors.textSecondary }]}>
        Log your actual content performance weekly. The adaptive system uses this data to adjust your content rhythm and memory constraints.
        {lastLogged ? ` Last logged: ${lastLogged}.` : ' No data logged yet.'}
      </Text>

      {PERF_FORMATS.map(({ key, label, icon }) => (
        <View key={key} style={{ marginBottom: 12 }}>
          <View style={[s.fieldLabelRow, { marginBottom: 6 }]}>
            <Ionicons name={icon} size={14} color="#F59E0B" />
            <Text style={[s.fieldLabel, { color: colors.text, fontSize: 12 }]}>{label}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[s.input, { flex: 1, backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder, paddingVertical: Platform.OS === 'ios' ? 9 : 7, fontSize: 13 }]}
              placeholder="Avg Reach"
              placeholderTextColor={colors.textMuted}
              value={entries[key].avgReach}
              onChangeText={v => updateEntry(key, 'avgReach', v)}
              keyboardType="numeric"
            />
            <TextInput
              style={[s.input, { flex: 1, backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder, paddingVertical: Platform.OS === 'ios' ? 9 : 7, fontSize: 13 }]}
              placeholder="Saves %"
              placeholderTextColor={colors.textMuted}
              value={entries[key].savesRate}
              onChangeText={v => updateEntry(key, 'savesRate', v)}
              keyboardType="numeric"
            />
            <TextInput
              style={[s.input, { flex: 1, backgroundColor: colors.inputBackground, color: colors.text, borderColor: colors.inputBorder, paddingVertical: Platform.OS === 'ios' ? 9 : 7, fontSize: 13 }]}
              placeholder="Eng. %"
              placeholderTextColor={colors.textMuted}
              value={entries[key].avgEngagementRate}
              onChangeText={v => updateEntry(key, 'avgEngagementRate', v)}
              keyboardType="numeric"
            />
          </View>
        </View>
      ))}

      {error ? (
        <View style={[s.errorWrap, { backgroundColor: colors.error + '12', borderColor: colors.error + '30', marginBottom: 8 }]}>
          <Ionicons name="warning-outline" size={14} color={colors.error} />
          <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={handleSave}
        disabled={saving}
        style={[s.channelsSaveBtn, { opacity: saving ? 0.5 : 1 }]}
      >
        <LinearGradient
          colors={saved ? ['#10B981', '#059669'] : ['#F59E0B', '#D97706']}
          style={s.channelsSaveBtnGrad}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : saved ? (
            <>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={s.channelsSaveBtnText}>Performance Logged</Text>
            </>
          ) : (
            <>
              <Ionicons name="bar-chart-outline" size={16} color="#fff" />
              <Text style={s.channelsSaveBtnText}>Log Performance</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

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

  const [channels, setChannels] = useState({ instagram: '', website: '' });
  const [channelsSaving, setChannelsSaving] = useState(false);
  const [channelsSaved, setChannelsSaved] = useState(false);
  const [channelsError, setChannelsError] = useState('');

  const campaignId = selectedCampaign?.selectedCampaignId;

  const CORE_FIELDS: (keyof BusinessData)[] = [
    'businessLocation', 'businessType', 'coreOffer', 'priceRange',
    'targetAudienceAge', 'targetAudienceSegment', 'monthlyBudget',
    'funnelObjective', 'primaryConversionChannel',
  ];
  const GOAL_FIELDS: (keyof BusinessData)[] = ['goalTarget', 'goalTimeline', 'goalDescription'];

  const isComplete = useCallback(() => {
    return CORE_FIELDS.every(f => data[f].trim().length > 0);
  }, [data]);

  const goalsFilled = GOAL_FIELDS.filter(f => data[f].trim().length > 0).length;

  useEffect(() => {
    if (!campaignId) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setFetching(true);
      try {
        const res = await authFetch(getApiUrl(`/api/business-data/${campaignId}`));
        const json = await safeApiJson(res);
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
            productCategory: d.productCategory || '',
            coreProblemSolved: d.coreProblemSolved || '',
            uniqueMechanism: d.uniqueMechanism || '',
            strategicAdvantage: d.strategicAdvantage || '',
            targetDecisionMaker: d.targetDecisionMaker || '',
            goalTarget: d.goalTarget || '',
            goalTimeline: d.goalTimeline || '',
            goalDescription: d.goalDescription || '',
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

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}/user-channels`));
        const json = await safeApiJson(res);
        if (!cancelled && json.profiles && Array.isArray(json.profiles)) {
          const ig = json.profiles.find((p: any) => p.platform === 'instagram');
          const web = json.profiles.find((p: any) => p.platform === 'website');
          setChannels({
            instagram: ig?.handle ? `@${ig.handle}` : '',
            website: web?.url || '',
          });
          if (ig?.handle || web?.url) setChannelsSaved(true);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  const handleSaveChannels = useCallback(async () => {
    if (!campaignId) return;
    setChannelsSaving(true);
    setChannelsError('');
    try {
      const res = await authFetch(getApiUrl(`/api/campaigns/${campaignId}/user-channels`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instagramHandle: channels.instagram.replace(/^@/, '').trim() || null,
          websiteUrl: channels.website.trim() || null,
        }),
      });
      const json = await safeApiJson(res);
      if (!res.ok || !json.success) {
        setChannelsError(json.message || json.error || 'Failed to save');
        return;
      }
      setChannelsSaved(true);
      Platform.OS !== 'web' && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setChannelsError(err.message || 'Network error');
    } finally {
      setChannelsSaving(false);
    }
  }, [campaignId, channels]);

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
      const res = await authFetch(getApiUrl(`/api/business-data/${campaignId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await safeApiJson(res);
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

  const coreFilledCount = CORE_FIELDS.filter(f => data[f].trim().length > 0).length;
  const filledCount = coreFilledCount + goalsFilled;
  const totalFields = 12;

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

      <View style={[s.goalSection, { borderColor: '#D946EF30' }]}>
        <View style={s.goalSectionHeader}>
          <Ionicons name="flask-outline" size={16} color="#D946EF" />
          <Text style={[s.goalSectionTitle, { color: colors.text }]}>Product DNA</Text>
        </View>
        <Text style={[s.goalSectionSubtitle, { color: colors.textSecondary }]}>
          Define your product identity so all engines generate consistent positioning and offers
        </Text>
        {renderTextField('productCategory', 'Product Category', 'e.g. Online coaching, SaaS tool, Physical product', 'grid-outline')}
        {renderTextField('coreProblemSolved', 'Core Problem Solved', 'e.g. Small businesses struggle to get consistent leads', 'help-circle-outline', true)}
        {renderTextField('uniqueMechanism', 'Unique Mechanism', 'e.g. AI-powered lead scoring system', 'construct-outline', true)}
        {renderTextField('strategicAdvantage', 'Strategic Advantage / Differentiation', 'e.g. Only platform with real-time competitor monitoring', 'trophy-outline', true)}
        {renderTextField('targetDecisionMaker', 'Target Decision Maker', 'e.g. Marketing directors at mid-size agencies', 'person-circle-outline')}
      </View>

      <View style={[s.goalSection, { borderColor: colors.inputBorder + '60' }]}>
        <View style={s.goalSectionHeader}>
          <Ionicons name="flag-outline" size={16} color={goalsFilled === 3 ? colors.success : '#6366F1'} />
          <Text style={[s.goalSectionTitle, { color: colors.text }]}>Goal Planning</Text>
          {goalsFilled === 3 && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
        </View>
        <Text style={[s.goalSectionSubtitle, { color: colors.textSecondary }]}>
          Set a specific target so Avyron can calculate feasibility and build your funnel math
        </Text>
        {renderTextField('goalTarget', 'Goal Target Number', 'e.g. 50 new clients, $10,000 revenue, 500 leads', 'trending-up-outline')}
        {renderChipSelector('goalTimeline', 'Goal Timeline', GOAL_TIMELINES)}
        {renderTextField('goalDescription', 'Goal Description', 'e.g. Get 50 new coaching clients in 90 days through Instagram', 'document-text-outline', true)}
      </View>

      <View style={[s.channelsSection, { borderColor: '#3B82F630', backgroundColor: isDark ? '#0A1628' : '#EFF6FF' }]}>
        <View style={s.goalSectionHeader}>
          <Ionicons name="analytics-outline" size={16} color="#3B82F6" />
          <Text style={[s.goalSectionTitle, { color: colors.text }]}>Your Channels</Text>
          {channelsSaved && (channels.instagram || channels.website) && (
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
          )}
        </View>
        <Text style={[s.goalSectionSubtitle, { color: colors.textSecondary }]}>
          Avyron will scrape your own Instagram and website weekly to compare your performance against market shifts
        </Text>

        <View style={s.channelInputRow}>
          <View style={[s.channelIconWrap, { backgroundColor: '#E1306C15' }]}>
            <Ionicons name="logo-instagram" size={16} color="#E1306C" />
          </View>
          <TextInput
            style={[s.channelInput, { color: colors.text, borderColor: isDark ? '#3B82F630' : '#CBD5E1', backgroundColor: isDark ? '#0F1E30' : '#FFFFFF' }]}
            placeholder="@yourhandle"
            placeholderTextColor={colors.textMuted}
            value={channels.instagram}
            onChangeText={(t) => { setChannels(prev => ({ ...prev, instagram: t })); setChannelsSaved(false); }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={s.channelInputRow}>
          <View style={[s.channelIconWrap, { backgroundColor: '#3B82F615' }]}>
            <Ionicons name="globe-outline" size={16} color="#3B82F6" />
          </View>
          <TextInput
            style={[s.channelInput, { color: colors.text, borderColor: isDark ? '#3B82F630' : '#CBD5E1', backgroundColor: isDark ? '#0F1E30' : '#FFFFFF' }]}
            placeholder="https://yourwebsite.com"
            placeholderTextColor={colors.textMuted}
            value={channels.website}
            onChangeText={(t) => { setChannels(prev => ({ ...prev, website: t })); setChannelsSaved(false); }}
            autoCapitalize="none"
            keyboardType="url"
            autoCorrect={false}
          />
        </View>

        {channelsError ? (
          <View style={[s.errorWrap, { backgroundColor: colors.error + '12', borderColor: colors.error + '30', marginTop: 8 }]}>
            <Ionicons name="warning-outline" size={14} color={colors.error} />
            <Text style={[s.errorText, { color: colors.error }]}>{channelsError}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleSaveChannels}
          disabled={channelsSaving || (!channels.instagram && !channels.website)}
          style={[s.channelsSaveBtn, { opacity: (channelsSaving || (!channels.instagram && !channels.website)) ? 0.5 : 1 }]}
        >
          <LinearGradient
            colors={channelsSaved && (channels.instagram || channels.website) ? ['#10B981', '#059669'] : ['#3B82F6', '#6366F1']}
            style={s.channelsSaveBtnGrad}
          >
            {channelsSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : channelsSaved && (channels.instagram || channels.website) ? (
              <>
                <Ionicons name="checkmark-circle" size={16} color="#fff" />
                <Text style={s.channelsSaveBtnText}>Channels Saved</Text>
              </>
            ) : (
              <>
                <Ionicons name="save-outline" size={16} color="#fff" />
                <Text style={s.channelsSaveBtnText}>Save Channels</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>

      <ContentPerformanceSection campaignId={campaignId} colors={colors} isDark={isDark} />

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
  goalSection: {
    borderTopWidth: 1,
    paddingTop: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  goalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  goalSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    flex: 1,
  },
  goalSectionSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
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
  channelsSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 16,
    marginBottom: 4,
  },
  channelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  channelIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9,
    fontSize: 14,
  },
  channelsSaveBtn: {
    marginTop: 6,
  },
  channelsSaveBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
  },
  channelsSaveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
