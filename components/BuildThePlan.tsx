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

type Phase = 0 | 1 | 2 | 3 | 4 | 5;
type BlueprintStatus = 'DRAFT' | 'GATE_PASSED' | 'EXTRACTION_COMPLETE' | 'CONFIRMED' | 'ANALYSIS_COMPLETE' | 'VALIDATED' | 'ORCHESTRATED';

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

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [currentPhase, setCurrentPhase] = useState<Phase>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clarifications, setClarifications] = useState<ClarificationPrompt[]>([]);

  const [competitorUrls, setCompetitorUrls] = useState<string[]>(['', '']);
  const [avgPrice, setAvgPrice] = useState('');

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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
      const res = await fetch(getApiUrl() + '/api/strategic/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitorUrls: validUrls,
          averageSellingPrice: parseFloat(avgPrice),
          metaConnected: false,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || data.error || 'Gate failed');
        return;
      }

      const bpRes = await fetch(getApiUrl() + `/api/strategic/blueprint/${data.blueprintId}`);
      const bpData = await bpRes.json();
      setBlueprint(bpData.blueprint);
      setCurrentPhase(1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(err.message || 'Network error');
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
      formData.append('media', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'image/jpeg',
      } as any);

      const res = await fetch(getApiUrl() + '/api/strategic/analyze-creative', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Analysis failed');
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'EXTRACTION_COMPLETE' as BlueprintStatus,
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
      const res = await fetch(getApiUrl() + `/api/strategic/blueprint/${blueprint.id}/confirm`, {
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
      const res = await fetch(getApiUrl() + `/api/strategic/blueprint/${blueprint.id}/edit`, {
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
      const res = await fetch(getApiUrl() + `/api/strategic/blueprint/${blueprint.id}/analyze`, {
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
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl() + `/api/strategic/blueprint/${blueprint.id}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || data.error || 'Validation failed');
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const runOrchestrator = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl() + `/api/strategic/blueprint/${blueprint.id}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || data.error || 'Orchestrator failed');
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        status: 'ORCHESTRATED' as BlueprintStatus,
        orchestratorPlan: data.orchestratorPlan,
      } : null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err: any) {
      setError(err.message);
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
                  : 'Review AI extraction results. Edit fields with low confidence, then confirm.'}
              </Text>
            </View>
          </View>

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

  const renderPhase3 = () => (
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
    if (!val) return null;

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
    const plan = blueprint?.orchestratorPlan;
    if (!plan) return null;

    const sections = [
      { key: 'contentDistributionPlan', title: 'Content Distribution', icon: 'share-social', color: '#3B82F6' },
      { key: 'creativeTestingMatrix', title: 'Creative Testing', icon: 'flask', color: '#8B5CF6' },
      { key: 'budgetAllocationStructure', title: 'Budget Allocation', icon: 'wallet', color: '#10B981' },
      { key: 'kpiMonitoringPriority', title: 'KPI Monitoring', icon: 'bar-chart', color: '#F59E0B' },
      { key: 'competitiveWatchTargets', title: 'Competitive Watch', icon: 'eye', color: '#EF4444' },
      { key: 'riskMonitoringTriggers', title: 'Risk Triggers', icon: 'warning', color: '#EC4899' },
    ];

    return (
      <View style={s.phaseContent}>
        {renderCampaignBadge()}
        <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={s.phaseHeader}>
            <View style={[s.phaseIconWrap, { backgroundColor: '#10B98120' }]}>
              <Ionicons name="rocket" size={20} color="#10B981" />
            </View>
            <View style={s.phaseHeaderText}>
              <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 5: Execution Plans</Text>
              <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
                6 structured plans ready for deployment
              </Text>
            </View>
          </View>
        </View>

        {sections.map(sec => {
          const data = plan[sec.key];
          if (!data) return null;

          return (
            <View key={sec.key} style={[s.execCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={s.execHeader}>
                <View style={[s.phaseIconWrap, { backgroundColor: sec.color + '20' }]}>
                  <Ionicons name={sec.icon as any} size={18} color={sec.color} />
                </View>
                <Text style={[s.execTitle, { color: colors.text }]}>{sec.title}</Text>
              </View>

              {sec.key === 'contentDistributionPlan' && data.platforms?.map((p: any, i: number) => (
                <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                  <View style={s.execItemHeader}>
                    <Text style={[s.execItemTitle, { color: colors.text }]}>{p.platform}</Text>
                    <View style={[s.badge, { backgroundColor: p.priority === 'primary' ? '#10B98120' : '#6366F120' }]}>
                      <Text style={[s.badgeText, { color: p.priority === 'primary' ? '#10B981' : '#6366F1' }]}>{p.priority}</Text>
                    </View>
                  </View>
                  <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                    {p.frequency} · {p.contentTypes?.join(', ')}
                  </Text>
                </View>
              ))}

              {sec.key === 'creativeTestingMatrix' && data.tests?.map((t: any, i: number) => (
                <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                  <Text style={[s.execItemTitle, { color: colors.text }]}>{t.testName}</Text>
                  <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                    Variable: {t.variable} · {t.duration}
                  </Text>
                </View>
              ))}

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

              {sec.key === 'kpiMonitoringPriority' && data.primaryKPIs?.map((k: any, i: number) => (
                <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                  <Text style={[s.execItemTitle, { color: colors.text }]}>{k.kpi}</Text>
                  <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                    Target: {k.target} · Check: {k.frequency}
                  </Text>
                </View>
              ))}

              {sec.key === 'competitiveWatchTargets' && data.targets?.map((t: any, i: number) => (
                <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                  <Text style={[s.execItemTitle, { color: colors.text }]}>{t.competitor}</Text>
                  <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                    Watch: {t.watchMetrics?.join(', ')}
                  </Text>
                </View>
              ))}

              {sec.key === 'riskMonitoringTriggers' && data.triggers?.map((t: any, i: number) => (
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
              ))}
            </View>
          );
        })}
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
    <View style={{ flex: 1 }}>
      {renderPhaseIndicator()}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {renderCurrentPhase()}
      </ScrollView>
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    justifyContent: 'space-between',
  },
  phaseStep: {
    alignItems: 'center',
    flex: 1,
  },
  phaseCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  phaseLabel: {
    fontSize: 10,
    fontWeight: '600',
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
});
