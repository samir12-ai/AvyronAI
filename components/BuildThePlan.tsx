import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  useColorScheme,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import Colors from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';

type Phase = 0 | 1 | 2 | 3 | 4 | 5;
type BlueprintStatus = 'DRAFT' | 'GATE_PASSED' | 'EXTRACTION_COMPLETE' | 'EXTRACTION_FALLBACK' | 'CONFIRMED' | 'ANALYSIS_COMPLETE' | 'VALIDATED' | 'ORCHESTRATED';

interface FieldWithConfidence {
  value: string;
  confidence: number;
}

interface DraftBlueprint {
  detectedLanguage?: string;
  transcribedText?: string | null;
  ocrText?: string | null;
  detectedOffer?: FieldWithConfidence;
  detectedPositioning?: FieldWithConfidence;
  detectedCTA?: FieldWithConfidence;
  detectedAudienceGuess?: FieldWithConfidence;
  detectedFunnelStage?: FieldWithConfidence;
  detectedPriceIfVisible?: FieldWithConfidence;
  extractionFallbackUsed?: boolean;
  parseFailedReason?: string | null;
}

interface CampaignContext {
  campaignId: string;
  campaignName: string;
  objective: string;
  location: string | null;
  platform: string;
  isDemo: boolean;
}

interface ClarificationPrompt {
  field: string;
  label: string;
  currentValue: string;
  questions: string[];
}

interface Blueprint {
  id: string;
  status: BlueprintStatus;
  competitorUrls: string[];
  averageSellingPrice: number;
  campaignContext: CampaignContext | null;
  draftBlueprint: DraftBlueprint | null;
  creativeAnalysis: any;
  confirmedBlueprint: any;
  marketMap: any;
  validationResult: any;
  orchestratorPlan: any;
}

const STATUS_TO_PHASE: Record<BlueprintStatus, Phase> = {
  DRAFT: 0,
  GATE_PASSED: 1,
  EXTRACTION_COMPLETE: 2,
  EXTRACTION_FALLBACK: 2,
  CONFIRMED: 3,
  ANALYSIS_COMPLETE: 4,
  VALIDATED: 5,
  ORCHESTRATED: 5,
};

const PHASE_LABELS = ['Gate', 'Extract', 'Confirm', 'Analyze', 'Validate', 'Execute'];
const PHASE_ICONS: any[] = ['lock-closed', 'scan', 'checkmark-circle', 'analytics', 'shield-checkmark', 'rocket'];

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return '#10B981';
  if (confidence >= 60) return '#F59E0B';
  return '#EF4444';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 80) return 'High';
  if (confidence >= 60) return 'Medium';
  if (confidence > 0) return 'Low';
  return 'Missing';
}

export default function BuildThePlan() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { metaConnection } = useApp();
  const { refreshCampaigns, refreshSelection } = useCampaign();

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [currentPhase, setCurrentPhase] = useState<Phase>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clarifications, setClarifications] = useState<ClarificationPrompt[]>([]);

  const [competitorUrls, setCompetitorUrls] = useState<string[]>(['', '']);
  const [avgPrice, setAvgPrice] = useState('');

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<any>(null);

  const [piData, setPiData] = useState<any>(null);
  const [piLoading, setPiLoading] = useState(false);
  const [piExpanded, setPiExpanded] = useState(false);

  const isMetaReal = metaConnection?.isConnected === true;

  const seedDemoCampaign = useCallback(async () => {
    setSeeding(true);
    setError('');
    setSeedResult(null);
    try {
      const res = await fetch(getApiUrl('/api/demo/seed-campaign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName: 'SWA',
          window: 'last_30_days',
          spend: 3.21,
          reach: 88,
          impressions: 114,
          messagingConversations: 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSeedResult(data);
        await refreshCampaigns();
        await refreshSelection();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Demo Campaign Seeded',
          `"${data.campaignContext.name}" is now active with 30 days of seeded performance data.\n\nLocation: ${data.campaignContext.location}\nSpend: $${data.seededData.totalSpend}\nReach: ${data.seededData.totalReach}\nConversions: 0\n\nGate is ready — add competitors + price to proceed.`,
        );
      } else {
        setError(data.error || 'Failed to seed demo campaign');
      }
    } catch (err: any) {
      setError(err.message || 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }, [refreshCampaigns, refreshSelection]);

  const pulseAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const addCompetitorUrl = useCallback(() => {
    if (competitorUrls.length < 5) {
      setCompetitorUrls(prev => [...prev, '']);
    }
  }, [competitorUrls]);

  const updateCompetitorUrl = useCallback((index: number, value: string) => {
    setCompetitorUrls(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const removeCompetitorUrl = useCallback((index: number) => {
    if (competitorUrls.length > 2) {
      setCompetitorUrls(prev => prev.filter((_, i) => i !== index));
    }
  }, [competitorUrls]);

  const passGate = useCallback(async () => {
    setError('');
    const validUrls = competitorUrls.filter(u => u.trim().length > 0);
    if (validUrls.length < 2) {
      setError('Enter at least 2 competitor URLs');
      return;
    }
    if (!avgPrice || parseFloat(avgPrice) <= 0) {
      setError('Enter a valid average selling price');
      return;
    }

    setLoading(true);
    try {
      const initUrl = getApiUrl('/api/strategic/init');
      console.log('[BuildThePlan] Gate request URL:', initUrl);
      const res = await fetch(initUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorUrls: validUrls,
          averageSellingPrice: parseFloat(avgPrice),
          metaConnected: false,
        }),
      });
      console.log('[BuildThePlan] Gate response status:', res.status);
      const data = await res.json();
      if (!data.success) {
        setError(data.message || data.error || 'Gate failed');
        return;
      }

      const bpUrl = getApiUrl(`/api/strategic/blueprint/${data.blueprintId}`);
      const bpRes = await fetch(bpUrl);
      const bpData = await bpRes.json();
      setBlueprint(bpData.blueprint);
      setCurrentPhase(1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      const failedUrl = getApiUrl('/api/strategic/init');
      const domain = process.env.EXPO_PUBLIC_DOMAIN || 'NOT_SET';
      const diagMsg = `${err.message || 'Network error'}\n\nDiagnostics:\nURL: ${failedUrl}\nDomain: ${domain}\nPlatform: ${Platform.OS}`;
      console.error('[BuildThePlan] Gate fetch failed:', diagMsg);
      setError(diagMsg);
    } finally {
      setLoading(false);
    }
  }, [competitorUrls, avgPrice]);

  const analyzeCreative = useCallback(async () => {
    if (!blueprint) return;
    setError('');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'video/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;
      const file = result.assets[0];

      setLoading(true);
      const formData = new FormData();
      formData.append('blueprintId', blueprint.id);

      if (Platform.OS === 'web') {
        const response = await globalThis.fetch(file.uri);
        const blob = await response.blob();
        formData.append('media', blob, file.name || 'creative.jpg');
      } else {
        formData.append('media', {
          uri: file.uri,
          name: file.name || 'creative.jpg',
          type: file.mimeType || 'image/jpeg',
        } as any);
      }

      const uploadUrl = getApiUrl('/api/strategic/analyze-creative');
      console.log('[BuildThePlan] Upload URL:', uploadUrl, 'File:', file.name, 'Type:', file.mimeType);
      const res = await globalThis.fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });
      console.log('[BuildThePlan] Upload response status:', res.status);
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Analysis failed');
        return;
      }

      const extractionStatus = data.extractionFallbackUsed ? 'EXTRACTION_FALLBACK' : 'EXTRACTION_COMPLETE';
      setBlueprint(prev => prev ? {
        ...prev,
        status: extractionStatus as BlueprintStatus,
        draftBlueprint: data.draftBlueprint,
        creativeAnalysis: data.draftBlueprint,
        confirmedBlueprint: null,
      } : null);
      setClarifications([]);
      setCurrentPhase(2);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const confirmBlueprint = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/confirm`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (data.needsClarification) {
        setClarifications(data.clarificationPrompts || []);
        setError('Some fields need your input before confirming. See the highlighted fields below.');
        return;
      }
      if (!data.success) {
        setError(data.message || data.error || 'Confirmation failed');
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'CONFIRMED' as BlueprintStatus,
        confirmedBlueprint: data.confirmedBlueprint,
      } : null);
      setClarifications([]);
      setCurrentPhase(3);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const saveFieldEdit = useCallback(async () => {
    if (!blueprint || !editingField) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/edit`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [editingField]: editValue } }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.statusReset) {
          setBlueprint(prev => prev ? {
            ...prev,
            status: 'EXTRACTION_COMPLETE' as BlueprintStatus,
            draftBlueprint: data.draftBlueprint,
            creativeAnalysis: data.draftBlueprint,
            confirmedBlueprint: null,
            marketMap: null,
            validationResult: null,
            orchestratorPlan: null,
          } : null);
          setCurrentPhase(2);
          Alert.alert(
            'Blueprint Reset',
            'Editing after confirmation resets all downstream analysis. Please re-confirm and re-validate.',
          );
        } else {
          setBlueprint(prev => prev ? {
            ...prev,
            draftBlueprint: data.draftBlueprint,
            creativeAnalysis: data.draftBlueprint,
          } : null);
        }
        setClarifications(data.pendingClarifications || []);
        setEditingField(null);
        setEditValue('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [blueprint, editingField, editValue]);

  const runMarketAnalysis = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/analyze`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || data.error || 'Analysis failed');
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'ANALYSIS_COMPLETE' as BlueprintStatus,
        marketMap: data.marketMap,
      } : null);
      setCurrentPhase(4);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const runValidation = useCallback(async () => {
    if (!blueprint) return;
    if (!blueprint.marketMap) {
      setError('Market analysis must be completed before validation. Please go back to Phase 3.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const url = getApiUrl(`/api/strategic/blueprint/${blueprint.id}/validate`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        setError(`Validation failed: server returned status ${res.status} with no body`);
        return;
      }

      if (!res.ok || !data.success) {
        const code = res.status;
        const msg = data.message || data.error || 'Unknown validation error';
        setError(`Validation failed (${code}): ${msg}`);
        console.warn(`[Validate] API error ${code}:`, JSON.stringify(data));
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'VALIDATED' as BlueprintStatus,
        validationResult: data.validationResult,
      } : null);
      setCurrentPhase(5);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(`Validation request failed: ${err.message}`);
      console.error('[Validate] Network/fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const runOrchestrator = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/orchestrate`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const statusPrefix = !res.ok ? `[HTTP ${res.status}] ` : '';
        setError(statusPrefix + (data.message || data.error || 'Orchestrator failed'));
        return;
      }

      if (!data.orchestratorPlan || typeof data.orchestratorPlan !== 'object') {
        setError('Server returned an empty execution plan. Please retry.');
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'ORCHESTRATED' as BlueprintStatus,
        orchestratorPlan: data.orchestratorPlan,
      } : null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const renderCampaignBadge = () => {
    const ctx = blueprint?.campaignContext;
    if (!ctx) return null;

    return (
      <View style={[s.campaignBadge, { backgroundColor: ctx.isDemo ? '#F59E0B15' : '#10B98115', borderColor: ctx.isDemo ? '#F59E0B30' : '#10B98130' }]}>
        <Ionicons name={ctx.isDemo ? 'flask' : 'megaphone'} size={14} color={ctx.isDemo ? '#F59E0B' : '#10B981'} />
        <View style={{ flex: 1 }}>
          <Text style={[s.campaignBadgeName, { color: ctx.isDemo ? '#F59E0B' : '#10B981' }]} numberOfLines={1}>
            {ctx.isDemo ? 'DEMO MODE' : ctx.campaignName}
          </Text>
          <Text style={[s.campaignBadgeDetail, { color: colors.textMuted }]}>
            {ctx.objective}{ctx.location ? ` · ${ctx.location}` : ''}
          </Text>
        </View>
      </View>
    );
  };

  const renderPhaseIndicator = () => (
    <View style={[s.phaseBar, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      {PHASE_LABELS.map((label, i) => {
        const isActive = i === currentPhase;
        const isComplete = i < currentPhase || (blueprint?.status === 'ORCHESTRATED' && i <= 5);
        const phaseColor = isComplete ? '#10B981' : isActive ? colors.accent : colors.textMuted + '40';
        return (
          <View key={i} style={s.phaseStep}>
            <View style={[s.phaseCircle, { backgroundColor: phaseColor }]}>
              {isComplete ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : (
                <Ionicons name={PHASE_ICONS[i]} size={12} color={isActive ? '#fff' : colors.textMuted} />
              )}
            </View>
            <Text style={[s.phaseLabel, { color: isActive ? colors.text : colors.textMuted }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const renderPhase0 = () => (
    <View style={s.phaseContent}>
      <LinearGradient colors={['#8B5CF620', '#6366F110']} style={[s.phaseCard, { borderColor: colors.cardBorder }]}>
        <View style={s.phaseHeader}>
          <View style={[s.phaseIconWrap, { backgroundColor: '#8B5CF620' }]}>
            <Ionicons name="lock-closed" size={20} color="#8B5CF6" />
          </View>
          <View style={s.phaseHeaderText}>
            <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 0: Strategic Gate</Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              Competitor intel + pricing required to unlock AI analysis
            </Text>
          </View>
        </View>

        {!isMetaReal && !seedResult && (
          <Pressable
            onPress={seedDemoCampaign}
            disabled={seeding}
            style={[s.seedBtn, { opacity: seeding ? 0.6 : 1 }]}
          >
            <LinearGradient colors={['#EC4899', '#F43F5E']} style={s.seedBtnGrad}>
              {seeding ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="flask" size={16} color="#fff" />
                  <Text style={s.seedBtnText}>Seed Demo Campaign (Manual Metrics)</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        )}

        {seedResult && (
          <View style={[s.seedBadge, { backgroundColor: '#10B98115', borderColor: '#10B98130' }]}>
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
            <Text style={[s.seedBadgeText, { color: '#10B981' }]}>
              DEMO: "{seedResult.campaignContext.name}" seeded — {seedResult.seededData.performanceSnapshots} days of data
            </Text>
          </View>
        )}

        <Text style={[s.sectionLabel, { color: colors.text }]}>Competitor URLs (min 2)</Text>
        {competitorUrls.map((url, index) => (
          <View key={index} style={s.urlRow}>
            <TextInput
              style={[s.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.cardBorder }]}
              placeholder={`competitor${index + 1}.com`}
              placeholderTextColor={colors.textMuted}
              value={url}
              onChangeText={(v) => updateCompetitorUrl(index, v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {competitorUrls.length > 2 && (
              <Pressable onPress={() => removeCompetitorUrl(index)} style={s.removeBtn}>
                <Ionicons name="close-circle" size={22} color={colors.error || '#EF4444'} />
              </Pressable>
            )}
          </View>
        ))}

        {competitorUrls.length < 5 && (
          <Pressable onPress={addCompetitorUrl} style={[s.addUrlBtn, { borderColor: colors.accent + '40' }]}>
            <Ionicons name="add" size={18} color={colors.accent} />
            <Text style={[s.addUrlText, { color: colors.accent }]}>Add competitor</Text>
          </Pressable>
        )}

        <Text style={[s.sectionLabel, { color: colors.text, marginTop: 16 }]}>Average Selling Price ($)</Text>
        <TextInput
          style={[s.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.cardBorder }]}
          placeholder="e.g. 49.99"
          placeholderTextColor={colors.textMuted}
          value={avgPrice}
          onChangeText={setAvgPrice}
          keyboardType="decimal-pad"
        />

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <Pressable
          onPress={passGate}
          disabled={loading}
          style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
        >
          <LinearGradient colors={['#8B5CF6', '#6366F1']} style={s.actionBtnGrad}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="lock-open" size={18} color="#fff" />
                <Text style={s.actionBtnText}>Unlock Analysis</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </LinearGradient>
    </View>
  );

  const renderPhase1 = () => (
    <View style={s.phaseContent}>
      {renderCampaignBadge()}
      <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={s.phaseHeader}>
          <View style={[s.phaseIconWrap, { backgroundColor: '#0EA5E920' }]}>
            <Ionicons name="scan" size={20} color="#0EA5E9" />
          </View>
          <View style={s.phaseHeaderText}>
            <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 1: Creative Analysis</Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              Upload a campaign creative — AI will extract offer, positioning, CTA, and audience with per-field confidence
            </Text>
          </View>
        </View>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <Pressable
          onPress={analyzeCreative}
          disabled={loading}
          style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
        >
          <LinearGradient colors={['#0EA5E9', '#3B82F6']} style={s.actionBtnGrad}>
            {loading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={s.actionBtnText}>Analyzing creative...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="cloud-upload" size={18} color="#fff" />
                <Text style={s.actionBtnText}>Upload Creative</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );

  const renderExtractionField = (label: string, fieldKey: string, fieldData: FieldWithConfidence | any, icon: string) => {
    const isEditing = editingField === fieldKey;
    const hasClarification = clarifications.some(c => c.field === fieldKey);

    let displayValue: string;
    let confidence: number;
    let isInsufficient = false;

    if (fieldData && typeof fieldData === 'object' && 'value' in fieldData) {
      displayValue = fieldData.value === 'INSUFFICIENT_DATA' ? '' : String(fieldData.value ?? '');
      confidence = typeof fieldData.confidence === 'number' ? fieldData.confidence : 0;
      isInsufficient = fieldData.value === 'INSUFFICIENT_DATA';
    } else {
      displayValue = fieldData === null || fieldData === undefined ? '' : String(fieldData);
      confidence = displayValue ? 50 : 0;
      isInsufficient = !displayValue;
    }

    const confColor = getConfidenceColor(confidence);
    const confLabel = getConfidenceLabel(confidence);
    const needsAttention = isInsufficient || confidence < 60 || hasClarification;
    const clarification = clarifications.find(c => c.field === fieldKey);

    return (
      <View style={[s.fieldCard, { backgroundColor: colors.card, borderColor: needsAttention ? '#F59E0B50' : colors.cardBorder }]}>
        <View style={s.fieldHeader}>
          <View style={s.fieldLabelRow}>
            <Ionicons name={icon as any} size={16} color={needsAttention ? '#F59E0B' : colors.accent} />
            <Text style={[s.fieldLabel, { color: colors.text }]}>{label}</Text>
            <View style={[s.badge, { backgroundColor: confColor + '20' }]}>
              <Text style={[s.badgeText, { color: confColor }]}>
                {isInsufficient ? 'Missing' : `${confidence}% ${confLabel}`}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => {
              if (isEditing) {
                saveFieldEdit();
              } else {
                setEditingField(fieldKey);
                setEditValue(displayValue);
              }
            }}
          >
            <Ionicons name={isEditing ? 'checkmark' : 'pencil'} size={18} color={colors.accent} />
          </Pressable>
        </View>

        {isEditing ? (
          <TextInput
            style={[s.editInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.accent + '40' }]}
            value={editValue}
            onChangeText={setEditValue}
            autoFocus
            multiline
          />
        ) : (
          <Text style={[s.fieldValue, { color: isInsufficient ? '#EF4444' : colors.text }]}>
            {isInsufficient ? 'INSUFFICIENT DATA — Tap pencil to provide input' : displayValue || 'Not detected'}
          </Text>
        )}

        {clarification && !isEditing && (
          <View style={[s.clarificationBox, { backgroundColor: '#F59E0B10', borderColor: '#F59E0B30' }]}>
            <Ionicons name="help-circle" size={14} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              {clarification.questions.map((q, i) => (
                <Text key={i} style={[s.clarificationText, { color: colors.textSecondary }]}>{q}</Text>
              ))}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderPhase2 = () => {
    const draft = blueprint?.draftBlueprint;
    if (!draft) return null;

    const isConfirmed = blueprint?.status === 'CONFIRMED';
    const isFallback = blueprint?.status === 'EXTRACTION_FALLBACK' || draft.extractionFallbackUsed;
    const fallbackReasonLabel = draft.parseFailedReason === 'TRUNCATED'
      ? 'AI response was cut off (too long)'
      : draft.parseFailedReason === 'INVALID_JSON'
        ? 'AI returned unparseable output'
        : draft.parseFailedReason === 'EMPTY_RESPONSE'
          ? 'AI returned an empty response'
          : draft.parseFailedReason === 'EMPTY_FIELDS'
            ? 'AI could not extract any fields'
            : 'Unknown extraction issue';

    return (
      <View style={s.phaseContent}>
        {renderCampaignBadge()}

        <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={s.phaseHeader}>
            <View style={[s.phaseIconWrap, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            </View>
            <View style={s.phaseHeaderText}>
              <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 2: Review & Confirm</Text>
              <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
                {isConfirmed
                  ? 'Blueprint confirmed. Editing any field will reset downstream analysis.'
                  : isFallback
                    ? 'AI extraction failed. Fill in the fields manually, or retry the extraction.'
                    : 'Review AI extraction results. Edit fields with low confidence, then confirm.'}
              </Text>
            </View>
          </View>

          {isFallback && !isConfirmed && (
            <View style={[s.statusBanner, { backgroundColor: '#EF444415', borderWidth: 1, borderColor: '#EF444430' }]}>
              <Ionicons name="warning" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[s.statusBannerText, { color: '#EF4444', fontWeight: '700' }]}>
                  AI extraction failed — switched to manual mode
                </Text>
                <Text style={[s.statusBannerText, { color: '#EF4444', fontSize: 12, marginTop: 2 }]}>
                  Reason: {fallbackReasonLabel}
                </Text>
              </View>
            </View>
          )}

          {isFallback && !isConfirmed && (
            <Pressable
              onPress={() => { setCurrentPhase(1); }}
              style={{ marginTop: 8, marginBottom: 4, alignSelf: 'flex-start' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#3B82F615', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F630' }}>
                <Ionicons name="refresh" size={16} color="#3B82F6" />
                <Text style={{ color: '#3B82F6', fontWeight: '600', fontSize: 14, marginLeft: 6 }}>Retry Extraction</Text>
              </View>
            </Pressable>
          )}

          {isConfirmed && (
            <View style={[s.statusBanner, { backgroundColor: '#10B98115' }]}>
              <Ionicons name="checkmark-done" size={16} color="#10B981" />
              <Text style={[s.statusBannerText, { color: '#10B981' }]}>Confirmed — Source of truth for all downstream phases</Text>
            </View>
          )}

          {!isConfirmed && clarifications.length > 0 && (
            <View style={[s.statusBanner, { backgroundColor: '#F59E0B15' }]}>
              <Ionicons name="alert-circle" size={16} color="#F59E0B" />
              <Text style={[s.statusBannerText, { color: '#F59E0B' }]}>
                {clarifications.length} field{clarifications.length > 1 ? 's' : ''} need{clarifications.length === 1 ? 's' : ''} your input before confirming
              </Text>
            </View>
          )}
        </View>

        {renderExtractionField('Detected Offer', 'detectedOffer', draft.detectedOffer, 'pricetag')}
        {renderExtractionField('Positioning', 'detectedPositioning', draft.detectedPositioning, 'trending-up')}
        {renderExtractionField('Call to Action', 'detectedCTA', draft.detectedCTA, 'megaphone')}
        {renderExtractionField('Target Audience', 'detectedAudienceGuess', draft.detectedAudienceGuess, 'people')}
        {renderExtractionField('Funnel Stage', 'detectedFunnelStage', draft.detectedFunnelStage, 'funnel')}
        {renderExtractionField('Detected Price', 'detectedPriceIfVisible', draft.detectedPriceIfVisible, 'cash')}

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        {!isConfirmed && (
          <Pressable
            onPress={confirmBlueprint}
            disabled={loading}
            style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
          >
            <LinearGradient colors={['#10B981', '#059669']} style={s.actionBtnGrad}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : (
                <>
                  <Ionicons name="checkmark-done" size={18} color="#fff" />
                  <Text style={s.actionBtnText}>Confirm Blueprint</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        )}
      </View>
    );
  };

  const renderPhase3 = () => {
    const fallbackUsed = blueprint?.draftBlueprint?.extractionFallbackUsed;

    return (
    <View style={s.phaseContent}>
      {renderCampaignBadge()}
      <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={s.phaseHeader}>
          <View style={[s.phaseIconWrap, { backgroundColor: '#6366F120' }]}>
            <Ionicons name="analytics" size={20} color="#6366F1" />
          </View>
          <View style={s.phaseHeaderText}>
            <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 3: Market Analysis</Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              AI maps competitors, pricing bands, and gap opportunities using your confirmed blueprint
            </Text>
          </View>
        </View>

        {fallbackUsed && (
          <View style={[s.statusBanner, { backgroundColor: '#F59E0B15', borderWidth: 1, borderColor: '#F59E0B30' }]}>
            <Ionicons name="warning" size={16} color="#F59E0B" />
            <Text style={[s.statusBannerText, { color: '#F59E0B' }]}>
              AI extraction used fallback — analysis may be less accurate. Consider retrying extraction in Phase 2.
            </Text>
          </View>
        )}

        {blueprint?.marketMap ? renderMarketMap() : null}

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        {!blueprint?.marketMap && (
          <Pressable
            onPress={runMarketAnalysis}
            disabled={loading}
            style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
          >
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={s.actionBtnGrad}>
              {loading ? (
                <View style={s.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={s.actionBtnText}>Analyzing market...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="analytics" size={18} color="#fff" />
                  <Text style={s.actionBtnText}>Run Market Analysis</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        )}
      </View>
    </View>
    );
  };

  const renderMarketMap = () => {
    const map = blueprint?.marketMap;
    if (!map) return null;

    return (
      <View style={s.mapResults}>
        <View style={[s.mapCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
          <Text style={[s.mapCardTitle, { color: colors.text }]}>Market Position</Text>
          <View style={s.mapRow}>
            <Text style={[s.mapLabel, { color: colors.textSecondary }]}>Client Position:</Text>
            <View style={[s.badge, { backgroundColor: map.clientPricePosition === 'premium' ? '#8B5CF620' : '#10B98120' }]}>
              <Text style={[s.badgeText, { color: map.clientPricePosition === 'premium' ? '#8B5CF6' : '#10B981' }]}>
                {map.clientPricePosition?.replace('_', ' ')}
              </Text>
            </View>
          </View>
          <View style={s.mapRow}>
            <Text style={[s.mapLabel, { color: colors.textSecondary }]}>Saturation:</Text>
            <View style={[s.badge, { backgroundColor: map.saturationLevel === 'high' || map.saturationLevel === 'oversaturated' ? '#EF444420' : '#10B98120' }]}>
              <Text style={[s.badgeText, { color: map.saturationLevel === 'high' || map.saturationLevel === 'oversaturated' ? '#EF4444' : '#10B981' }]}>
                {map.saturationLevel}
              </Text>
            </View>
          </View>
        </View>

        {map.gapAngles?.length > 0 && (
          <View style={[s.mapCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
            <Text style={[s.mapCardTitle, { color: colors.text }]}>Gap Opportunities</Text>
            {map.gapAngles.slice(0, 3).map((gap: any, i: number) => (
              <View key={i} style={s.gapItem}>
                <View style={[s.gapDot, { backgroundColor: gap.potentialImpact === 'high' ? '#10B981' : '#F59E0B' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.gapAngle, { color: colors.text }]}>{gap.angle}</Text>
                  <Text style={[s.gapOpp, { color: colors.textSecondary }]}>{gap.opportunity}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {map.riskExposure?.length > 0 && (
          <View style={[s.mapCard, { backgroundColor: colors.background, borderColor: colors.cardBorder }]}>
            <Text style={[s.mapCardTitle, { color: colors.text }]}>Risk Exposure</Text>
            {map.riskExposure.slice(0, 3).map((risk: any, i: number) => (
              <View key={i} style={s.riskItem}>
                <View style={[s.badge, {
                  backgroundColor: risk.severity === 'critical' ? '#EF444420' : risk.severity === 'high' ? '#F59E0B20' : '#10B98120',
                }]}>
                  <Text style={[s.badgeText, {
                    color: risk.severity === 'critical' ? '#EF4444' : risk.severity === 'high' ? '#F59E0B' : '#10B981',
                  }]}>
                    {risk.severity}
                  </Text>
                </View>
                <Text style={[s.riskText, { color: colors.text }]}>{risk.risk}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={runValidation}
          disabled={loading}
          style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
        >
          <LinearGradient colors={['#F59E0B', '#D97706']} style={s.actionBtnGrad}>
            {loading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={s.actionBtnText}>Validating...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color="#fff" />
                <Text style={s.actionBtnText}>Validate Strategy</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    );
  };

  const renderPhase4 = () => {
    const val = blueprint?.validationResult;
    const hasAnalysis = !!blueprint?.marketMap;
    const fallbackUsedP4 = blueprint?.draftBlueprint?.extractionFallbackUsed;

    if (!val) {
      return (
        <View style={s.phaseContent}>
          {renderCampaignBadge()}
          <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={s.phaseHeader}>
              <View style={[s.phaseIconWrap, { backgroundColor: '#F59E0B20' }]}>
                <Ionicons name="shield-checkmark" size={20} color="#F59E0B" />
              </View>
              <View style={s.phaseHeaderText}>
                <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 4: Strategy Validation</Text>
                <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
                  AI checks your confirmed blueprint for contradictions, risks, and strategic coherence
                </Text>
              </View>
            </View>

            {fallbackUsedP4 && (
              <View style={[s.statusBanner, { backgroundColor: '#F59E0B15', borderWidth: 1, borderColor: '#F59E0B30' }]}>
                <Ionicons name="warning" size={16} color="#F59E0B" />
                <Text style={[s.statusBannerText, { color: '#F59E0B' }]}>
                  AI extraction used fallback — validation results may be less reliable. Consider retrying extraction in Phase 2.
                </Text>
              </View>
            )}

            {!hasAnalysis && (
              <View style={[s.statusBanner, { backgroundColor: '#F59E0B15' }]}>
                <Ionicons name="lock-closed" size={16} color="#F59E0B" />
                <Text style={[s.statusBannerText, { color: '#F59E0B' }]}>
                  Market analysis (Phase 3) must be completed before validation can run.
                </Text>
              </View>
            )}

            {hasAnalysis && !loading && (
              <View style={[s.statusBanner, { backgroundColor: '#6366F115' }]}>
                <Ionicons name="information-circle" size={16} color="#6366F1" />
                <Text style={[s.statusBannerText, { color: '#6366F1' }]}>
                  Validation has not been run yet. Tap the button below to check your strategy for issues.
                </Text>
              </View>
            )}

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <Pressable
              onPress={runValidation}
              disabled={loading || !hasAnalysis}
              style={[s.actionBtn, { opacity: loading || !hasAnalysis ? 0.6 : 1 }]}
            >
              <LinearGradient colors={hasAnalysis ? ['#F59E0B', '#D97706'] : ['#6B7280', '#4B5563']} style={s.actionBtnGrad}>
                {loading ? (
                  <View style={s.loadingRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={s.actionBtnText}>Validating strategy...</Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={18} color="#fff" />
                    <Text style={s.actionBtnText}>
                      {hasAnalysis ? 'Run Validation' : 'Complete Analysis First'}
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      );
    }

    return (
      <View style={s.phaseContent}>
        {renderCampaignBadge()}
        <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={s.phaseHeader}>
            <View style={[s.phaseIconWrap, { backgroundColor: '#F59E0B20' }]}>
              <Ionicons name="shield-checkmark" size={20} color="#F59E0B" />
            </View>
            <View style={s.phaseHeaderText}>
              <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 4: Validation Results</Text>
              <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
                Strategy coherence check against confirmed blueprint
              </Text>
            </View>
          </View>

          {fallbackUsedP4 && (
            <View style={[s.statusBanner, { backgroundColor: '#F59E0B15', borderWidth: 1, borderColor: '#F59E0B30' }]}>
              <Ionicons name="warning" size={16} color="#F59E0B" />
              <Text style={[s.statusBannerText, { color: '#F59E0B' }]}>
                These results are based on fallback data. Consider retrying extraction for more accurate validation.
              </Text>
            </View>
          )}

          <View style={s.valGrid}>
            <View style={[s.valMetric, { backgroundColor: colors.background }]}>
              <Text style={[s.valMetricLabel, { color: colors.textSecondary }]}>Assessment</Text>
              <View style={[s.badge, {
                backgroundColor: val.overallAssessment === 'strong' ? '#10B98120' : val.overallAssessment === 'moderate' ? '#F59E0B20' : '#EF444420',
              }]}>
                <Text style={[s.badgeText, {
                  color: val.overallAssessment === 'strong' ? '#10B981' : val.overallAssessment === 'moderate' ? '#F59E0B' : '#EF4444',
                }]}>
                  {val.overallAssessment}
                </Text>
              </View>
            </View>
            <View style={[s.valMetric, { backgroundColor: colors.background }]}>
              <Text style={[s.valMetricLabel, { color: colors.textSecondary }]}>Risk Score</Text>
              <Text style={[s.valMetricValue, { color: val.riskScore > 60 ? '#EF4444' : val.riskScore > 30 ? '#F59E0B' : '#10B981' }]}>
                {val.riskScore}/100
              </Text>
            </View>
            <View style={[s.valMetric, { backgroundColor: colors.background }]}>
              <Text style={[s.valMetricLabel, { color: colors.textSecondary }]}>Confidence</Text>
              <Text style={[s.valMetricValue, { color: val.confidenceScore >= 70 ? '#10B981' : '#F59E0B' }]}>
                {val.confidenceScore}%
              </Text>
            </View>
          </View>

          {val.contradictions?.length > 0 && (
            <View style={[s.warnSection, { borderColor: '#EF444430' }]}>
              <Text style={[s.warnTitle, { color: '#EF4444' }]}>Contradictions Found</Text>
              {val.contradictions.map((c: any, i: number) => (
                <View key={i} style={s.warnItem}>
                  <Ionicons name="warning" size={14} color="#EF4444" />
                  <Text style={[s.warnText, { color: colors.text }]}>{c.description}</Text>
                </View>
              ))}
            </View>
          )}

          {val.campaignAlignment && !val.campaignAlignment.aligned && (
            <View style={[s.warnSection, { borderColor: '#EF444430' }]}>
              <Text style={[s.warnTitle, { color: '#EF4444' }]}>Campaign Alignment Issue</Text>
              <Text style={[s.warnText, { color: colors.text }]}>
                Objective: {val.campaignAlignment.objective} — {val.campaignAlignment.details}
              </Text>
            </View>
          )}

          {val.warnings?.length > 0 && (
            <View style={[s.warnSection, { borderColor: '#F59E0B30' }]}>
              <Text style={[s.warnTitle, { color: '#F59E0B' }]}>Warnings</Text>
              {val.warnings.map((w: string, i: number) => (
                <View key={i} style={s.warnItem}>
                  <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                  <Text style={[s.warnText, { color: colors.text }]}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          <Pressable
            onPress={runOrchestrator}
            disabled={loading || !val.canProceed}
            style={[s.actionBtn, { opacity: loading || !val.canProceed ? 0.6 : 1 }]}
          >
            <LinearGradient colors={val.canProceed ? ['#10B981', '#059669'] : ['#6B7280', '#4B5563']} style={s.actionBtnGrad}>
              {loading ? (
                <View style={s.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={s.actionBtnText}>Building execution plan...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="rocket" size={18} color="#fff" />
                  <Text style={s.actionBtnText}>
                    {val.canProceed ? 'Generate Execution Plans' : 'Cannot proceed — fix issues'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderPhase5 = () => {
    let plan = blueprint?.orchestratorPlan;
    if (typeof plan === 'string') {
      try { plan = JSON.parse(plan); } catch { plan = null; }
    }

    const renderPhase5Header = () => (
      <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={s.phaseHeader}>
          <View style={[s.phaseIconWrap, { backgroundColor: '#10B98120' }]}>
            <Ionicons name="rocket" size={20} color="#10B981" />
          </View>
          <View style={s.phaseHeaderText}>
            <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 5: Execution Plans</Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              {plan ? '6 structured plans ready for deployment' : 'Generate your AI execution plans'}
            </Text>
          </View>
        </View>
      </View>
    );

    if (loading) {
      return (
        <View style={s.phaseContent}>
          {renderCampaignBadge()}
          {renderPhase5Header()}
          <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 40 }]}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={[s.phaseDesc, { color: colors.textSecondary, marginTop: 16 }]}>
              Building execution plans...
            </Text>
          </View>
        </View>
      );
    }

    if (error) {
      return (
        <View style={s.phaseContent}>
          {renderCampaignBadge()}
          {renderPhase5Header()}
          <View style={[s.phaseCard, { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="alert-circle" size={20} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>Execution Plan Failed</Text>
            </View>
            <Text style={{ color: '#991B1B', fontSize: 13, lineHeight: 18 }}>{error}</Text>
          </View>
          <Pressable onPress={runOrchestrator} style={[s.actionBtn, { marginTop: 12 }]}>
            <LinearGradient colors={['#EF4444', '#DC2626']} style={s.actionBtnGrad}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={s.actionBtnText}>Retry Execution Plan</Text>
            </LinearGradient>
          </Pressable>
        </View>
      );
    }

    if (!plan) {
      return (
        <View style={s.phaseContent}>
          {renderCampaignBadge()}
          {renderPhase5Header()}
          <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 32 }]}>
            <Ionicons name="document-text-outline" size={40} color={colors.textSecondary} />
            <Text style={[s.phaseTitle, { color: colors.text, marginTop: 12, textAlign: 'center' }]}>
              Execution plan has not been generated yet.
            </Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary, marginTop: 4, textAlign: 'center' }]}>
              Generate 6 structured execution plans from your validated blueprint.
            </Text>
          </View>
          <Pressable onPress={runOrchestrator} disabled={blueprint?.status !== 'VALIDATED'} style={[s.actionBtn, { marginTop: 12, opacity: blueprint?.status !== 'VALIDATED' ? 0.6 : 1 }]}>
            <LinearGradient colors={blueprint?.status === 'VALIDATED' ? ['#10B981', '#059669'] : ['#6B7280', '#4B5563']} style={s.actionBtnGrad}>
              <Ionicons name="rocket" size={18} color="#fff" />
              <Text style={s.actionBtnText}>
                {blueprint?.status === 'VALIDATED' ? 'Generate Execution Plan' : 'Blueprint must be validated first'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      );
    }

    const sections = [
      { key: 'contentDistributionPlan', title: 'Content Distribution', icon: 'share-social', color: '#3B82F6' },
      { key: 'creativeTestingMatrix', title: 'Creative Testing', icon: 'flask', color: '#8B5CF6' },
      { key: 'budgetAllocationStructure', title: 'Budget Allocation', icon: 'wallet', color: '#10B981' },
      { key: 'kpiMonitoringPriority', title: 'KPI Monitoring', icon: 'bar-chart', color: '#F59E0B' },
      { key: 'competitiveWatchTargets', title: 'Competitive Watch', icon: 'eye', color: '#EF4444' },
      { key: 'riskMonitoringTriggers', title: 'Risk Triggers', icon: 'warning', color: '#EC4899' },
    ];

    const populatedSections = sections.filter(sec => plan[sec.key]);

    return (
      <View style={s.phaseContent}>
        {renderCampaignBadge()}
        {renderPhase5Header()}

        {populatedSections.length === 0 && (
          <View style={[s.phaseCard, { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="warning" size={18} color="#F59E0B" />
              <Text style={{ color: '#92400E', fontSize: 13, fontWeight: '600' }}>
                Execution plan was generated but contains no structured sections. Consider retrying.
              </Text>
            </View>
          </View>
        )}

        {populatedSections.map(sec => {
          const data = plan[sec.key];

          return (
            <View key={sec.key} style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={s.execHeader}>
                <View style={[s.phaseIconWrap, { backgroundColor: sec.color + '20' }]}>
                  <Ionicons name={sec.icon as any} size={18} color={sec.color} />
                </View>
                <Text style={[s.execTitle, { color: colors.text }]}>{sec.title}</Text>
              </View>

              {sec.key === 'contentDistributionPlan' && (
                data.platforms && data.platforms.length > 0 ? data.platforms.map((p: any, i: number) => (
                  <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <View style={s.execItemHeader}>
                      <Text style={[s.execItemTitle, { color: colors.text }]}>{p.platform}</Text>
                      <View style={[s.badge, { backgroundColor: p.priority === 'primary' ? '#10B98120' : '#6366F120' }]}>
                        <Text style={[s.badgeText, { color: p.priority === 'primary' ? '#10B981' : '#6366F1' }]}>{p.priority}</Text>
                      </View>
                    </View>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                      {p.frequency} · {Array.isArray(p.contentTypes) ? p.contentTypes.join(', ') : ''}
                    </Text>
                  </View>
                )) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No distribution platforms available.</Text>
                  </View>
                )
              )}

              {sec.key === 'creativeTestingMatrix' && (
                data.tests && data.tests.length > 0 ? data.tests.map((t: any, i: number) => (
                  <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemTitle, { color: colors.text }]}>{t.testName}</Text>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                      Variable: {t.variable} · {t.duration}
                    </Text>
                  </View>
                )) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No creative tests available.</Text>
                  </View>
                )
              )}

              {sec.key === 'budgetAllocationStructure' && (
                <>
                  <Text style={[s.budgetTotal, { color: colors.accent }]}>
                    Recommended: {data.totalRecommended}
                  </Text>
                  {data.breakdown?.map((b: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <View style={s.budgetRow}>
                        <Text style={[s.execItemTitle, { color: colors.text }]}>{b.category}</Text>
                        <Text style={[s.budgetPct, { color: colors.accent }]}>{b.percentage}%</Text>
                      </View>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>{b.purpose}</Text>
                    </View>
                  ))}
                </>
              )}

              {sec.key === 'kpiMonitoringPriority' && (
                data.primaryKPIs && data.primaryKPIs.length > 0 ? data.primaryKPIs.map((k: any, i: number) => (
                  <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemTitle, { color: colors.text }]}>{k.kpi}</Text>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                      Target: {k.target} · Check: {k.frequency}
                    </Text>
                  </View>
                )) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No KPIs available.</Text>
                  </View>
                )
              )}

              {sec.key === 'competitiveWatchTargets' && (
                data.targets && data.targets.length > 0 ? data.targets.map((t: any, i: number) => (
                  <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemTitle, { color: colors.text }]}>{t.competitor || 'Unknown competitor'}</Text>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                      Watch: {Array.isArray(t.watchMetrics) ? t.watchMetrics.join(', ') : 'No metrics specified'}
                    </Text>
                  </View>
                )) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No competitive watch targets available. Consider retrying generation.</Text>
                  </View>
                )
              )}

              {sec.key === 'riskMonitoringTriggers' && (
                data.triggers && data.triggers.length > 0 ? data.triggers.map((t: any, i: number) => (
                  <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <View style={s.execItemHeader}>
                      <Text style={[s.execItemTitle, { color: colors.text }]}>{t.trigger}</Text>
                      <View style={[s.badge, {
                        backgroundColor: t.severity === 'critical' ? '#EF444420' : t.severity === 'high' ? '#F59E0B20' : '#10B98120',
                      }]}>
                        <Text style={[s.badgeText, {
                          color: t.severity === 'critical' ? '#EF4444' : t.severity === 'high' ? '#F59E0B' : '#10B981',
                        }]}>
                          {t.severity}
                        </Text>
                      </View>
                    </View>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                      Action: {t.action}
                    </Text>
                  </View>
                )) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No risk triggers available.</Text>
                  </View>
                )
              )}
            </View>
          );
        })}

        {renderPerformanceIntelligence()}
      </View>
    );
  };

  const loadPerformanceIntelligence = async () => {
    setPiLoading(true);
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/strategy/dashboard', baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setPiData(data);
      }
    } catch (err) {
      console.log('[PI] Load failed:', err);
    } finally {
      setPiLoading(false);
    }
  };

  const renderPerformanceIntelligence = () => {
    return (
      <View style={{ marginTop: 16 }}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setPiExpanded(!piExpanded);
            if (!piExpanded && !piData) loadPerformanceIntelligence();
          }}
          style={[s.execCard, { backgroundColor: colors.card, borderColor: '#6366F140' }]}
        >
          <View style={s.execHeader}>
            <View style={[s.phaseIconWrap, { backgroundColor: '#6366F120' }]}>
              <Ionicons name="pulse" size={18} color="#6366F1" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.execTitle, { color: colors.text }]}>Performance Intelligence</Text>
              <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                Signal layer from past performance data
              </Text>
            </View>
            <Ionicons
              name={piExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textSecondary}
            />
          </View>
        </Pressable>

        {piExpanded && (
          <View style={{ gap: 10 }}>
            {piLoading ? (
              <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 24 }]}>
                <ActivityIndicator size="small" color="#6366F1" />
                <Text style={[s.execItemDesc, { color: colors.textSecondary, marginTop: 8 }]}>Loading signals...</Text>
              </View>
            ) : piData ? (
              <>
                {piData.recentInsights?.length > 0 && (
                  <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <View style={s.execHeader}>
                      <Ionicons name="bulb" size={16} color="#F59E0B" />
                      <Text style={[s.execTitle, { color: colors.text }]}>Recent Insights ({piData.recentInsights.length})</Text>
                    </View>
                    {piData.recentInsights.slice(0, 5).map((ins: any, i: number) => (
                      <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[s.badge, { backgroundColor: '#F59E0B20' }]}>
                            <Text style={[s.badgeText, { color: '#F59E0B' }]}>{ins.category}</Text>
                          </View>
                          {ins.confidence >= 0.7 && (
                            <View style={[s.badge, { backgroundColor: '#10B98120' }]}>
                              <Text style={[s.badgeText, { color: '#10B981' }]}>{Math.round(ins.confidence * 100)}%</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[s.execItemDesc, { color: colors.textSecondary, marginTop: 4 }]}>{ins.insight}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {(piData.memory?.winners?.length > 0 || piData.memory?.losers?.length > 0) && (
                  <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <View style={s.execHeader}>
                      <Ionicons name="library" size={16} color="#8B5CF6" />
                      <Text style={[s.execTitle, { color: colors.text }]}>Strategic Memory</Text>
                    </View>
                    {piData.memory.winners?.slice(0, 3).map((m: any, i: number) => (
                      <View key={`w${i}`} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                          <Text style={[s.execItemTitle, { color: '#10B981' }]}>{m.label}</Text>
                        </View>
                        <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>{m.memoryType}</Text>
                      </View>
                    ))}
                    {piData.memory.losers?.slice(0, 3).map((m: any, i: number) => (
                      <View key={`l${i}`} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="close-circle" size={14} color="#EF4444" />
                          <Text style={[s.execItemTitle, { color: '#EF4444' }]}>{m.label}</Text>
                        </View>
                        <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>{m.memoryType}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {piData.recentDecisions?.length > 0 && (
                  <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                    <View style={s.execHeader}>
                      <Ionicons name="flash" size={16} color="#EC4899" />
                      <Text style={[s.execTitle, { color: colors.text }]}>Recent Recommendations ({piData.recentDecisions.length})</Text>
                    </View>
                    {piData.recentDecisions.slice(0, 3).map((d: any, i: number) => (
                      <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                        <Text style={[s.execItemTitle, { color: colors.text }]}>{d.action}</Text>
                        <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>{d.reason}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {piData.activePlanId && (
                  <View style={[s.execCard, { backgroundColor: '#6366F110', borderColor: '#6366F130' }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="link" size={14} color="#6366F1" />
                      <Text style={{ color: '#6366F1', fontSize: 12, fontWeight: '600' }}>
                        Signals feeding active plan
                      </Text>
                    </View>
                  </View>
                )}

                {!piData.recentInsights?.length && !piData.memory?.total && !piData.recentDecisions?.length && (
                  <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 20 }]}>
                    <Ionicons name="analytics-outline" size={32} color={colors.textMuted} />
                    <Text style={[s.execItemDesc, { color: colors.textSecondary, marginTop: 8, textAlign: 'center' }]}>
                      No performance signals yet. Sync performance data and run analysis to generate insights.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, alignItems: 'center', paddingVertical: 20 }]}>
                <Ionicons name="analytics-outline" size={32} color={colors.textMuted} />
                <Text style={[s.execItemDesc, { color: colors.textSecondary, marginTop: 8, textAlign: 'center' }]}>
                  No performance data available.
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderCurrentPhase = () => {
    if (blueprint?.status === 'ORCHESTRATED') return renderPhase5();
    switch (currentPhase) {
      case 0: return renderPhase0();
      case 1: return renderPhase1();
      case 2: return renderPhase2();
      case 3: return renderPhase3();
      case 4: return renderPhase4();
      case 5: return renderPhase5();
      default: return renderPhase0();
    }
  };

  return (
    <View>
      {renderPhaseIndicator()}
      {renderCurrentPhase()}
    </View>
  );
}

const s = StyleSheet.create({
  campaignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  campaignBadgeName: {
    fontSize: 13,
    fontWeight: '700',
  },
  campaignBadgeDetail: {
    fontSize: 11,
    marginTop: 1,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 8,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  clarificationBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  clarificationText: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 2,
  },
  phaseBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    height: 62,
    borderBottomWidth: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
  },
  phaseStep: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 46,
    gap: 3,
  },
  phaseCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseLabel: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
  },
  phaseContent: {
    padding: 16,
    gap: 12,
  },
  phaseCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  phaseIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  phaseHeaderText: {
    flex: 1,
  },
  phaseTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  phaseDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  removeBtn: {
    marginLeft: 8,
    padding: 4,
  },
  addUrlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 6,
  },
  addUrlText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 4,
  },
  actionBtn: {
    marginTop: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  fieldValue: {
    fontSize: 14,
    lineHeight: 20,
  },
  editInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    minHeight: 40,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  confidenceBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  confidenceText: {
    fontSize: 14,
    fontWeight: '700',
  },
  mapResults: {
    gap: 12,
    marginTop: 12,
  },
  mapCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  mapCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  mapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  mapLabel: {
    fontSize: 13,
  },
  gapItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  gapDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  gapAngle: {
    fontSize: 13,
    fontWeight: '600',
  },
  gapOpp: {
    fontSize: 12,
    marginTop: 2,
  },
  riskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  riskText: {
    fontSize: 13,
    flex: 1,
  },
  valGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  valMetric: {
    flex: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  valMetricLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  valMetricValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  warnSection: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  warnTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  warnItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  warnText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  execCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  execHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  execTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 10,
  },
  execItem: {
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  execItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  execItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  execItemDesc: {
    fontSize: 12,
    marginTop: 3,
  },
  budgetTotal: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetPct: {
    fontSize: 14,
    fontWeight: '700',
  },
  seedBtn: {
    marginBottom: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  seedBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 8,
  },
  seedBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  seedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  seedBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
});
