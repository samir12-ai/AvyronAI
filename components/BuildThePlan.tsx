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
import Colors from '@/constants/colors';
import { getApiUrl, safeApiJson } from '@/lib/query-client';
import { useApp } from '@/context/AppContext';
import { useCampaign } from '@/context/CampaignContext';
import { BusinessProfileModal } from '@/components/BusinessProfile';
import PlanDocumentView from '@/components/PlanDocumentView';
import { normalizeEngineSnapshot, isEngineReady } from '@/lib/engine-snapshot';

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
  hookDirection?: FieldWithConfidence;
  narrativeStructure?: FieldWithConfidence;
  contentAngle?: FieldWithConfidence;
  visualDirection?: FieldWithConfidence;
  formatSuggestion?: FieldWithConfidence;
  extractionFallbackUsed?: boolean;
  parseFailedReason?: string | null;
  generationSource?: string;
}

interface CampaignContext {
  campaignId: string;
  campaignName: string;
  objective: string;
  location: string | null;
  platform: string;
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
  planId?: string | null;
  planStatus?: string | null;
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

const PHASE_LABELS = ['Gate', 'Blueprint', 'Confirm', 'Analyze', 'Validate', 'Execute'];
const PHASE_ICONS: any[] = ['lock-closed', 'bulb', 'checkmark-circle', 'analytics', 'shield-checkmark', 'rocket'];

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

interface CICompetitor {
  id: string;
  name: string;
  profileLink: string;
  platform: string;
  businessType: string;
  engagementRatio?: number | null;
}

interface BuildThePlanProps {
  onNavigateToCI?: () => void;
  onNavigateToCalendar?: () => void;
  onOpenProfile?: () => void;
}

export default function BuildThePlan({ onNavigateToCI, onNavigateToCalendar, onOpenProfile }: BuildThePlanProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { metaConnection } = useApp();
  const { refreshCampaigns, refreshSelection, selectedCampaign } = useCampaign();

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [currentPhase, setCurrentPhase] = useState<Phase>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clarifications, setClarifications] = useState<ClarificationPrompt[]>([]);

  const [ciCompetitors, setCiCompetitors] = useState<CICompetitor[]>([]);
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<Set<string>>(new Set());
  const [ciLoading, setCiLoading] = useState(false);
  const [avgPrice, setAvgPrice] = useState('');

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');


  const [piData, setPiData] = useState<any>(null);
  const [piLoading, setPiLoading] = useState(false);
  const [piExpanded, setPiExpanded] = useState(false);

  const [businessDataComplete, setBusinessDataComplete] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPlanDocument, setShowPlanDocument] = useState(false);
  const [miReady, setMiReady] = useState(false);
  const [miEngineState, setMiEngineState] = useState<string | null>(null);
  const [miFreshnessDays, setMiFreshnessDays] = useState<number | null>(null);
  const [miChecking, setMiChecking] = useState(true);

  const [gateResult, setGateResult] = useState<any>(null);
  const [gateChecking, setGateChecking] = useState(false);

  const isMetaReal = metaConnection?.isConnected === true;
  const profileCampaignId = selectedCampaign?.selectedCampaignId;

  const checkPlanGateReadiness = useCallback(async () => {
    if (!profileCampaignId) return;
    setGateChecking(true);
    try {
      const res = await fetch(getApiUrl('/api/plan-gate/check'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: profileCampaignId, accountId: 'default' }),
      });
      if (res.ok) {
        const data = await safeApiJson(res);
        setGateResult(data);
      }
    } catch (err) {
      console.error('[BuildThePlan] Plan gate check failed:', err);
    } finally {
      setGateChecking(false);
    }
  }, [profileCampaignId]);

  useEffect(() => {
    if (businessDataComplete) {
      checkPlanGateReadiness();
    }
  }, [businessDataComplete, checkPlanGateReadiness]);

  const checkProfileCompleteness = useCallback(async () => {
    if (!profileCampaignId) {
      setBusinessDataComplete(false);
      return;
    }
    try {
      const res = await fetch(getApiUrl(`/api/business-data/${profileCampaignId}?accountId=default`));
      const json = await safeApiJson(res);
      if (json.exists && json.data) {
        const d = json.data;
        const fields = [
          d.businessLocation, d.businessType, d.coreOffer, d.priceRange,
          d.targetAudienceAge, d.targetAudienceSegment, d.monthlyBudget,
          d.funnelObjective, d.primaryConversionChannel,
        ];
        setBusinessDataComplete(fields.every((f: string) => f && f.trim().length > 0));
      } else {
        setBusinessDataComplete(false);
      }
    } catch {
      setBusinessDataComplete(false);
    }
  }, [profileCampaignId]);

  useEffect(() => {
    checkProfileCompleteness();
  }, [checkProfileCompleteness]);

  const checkMIReadiness = useCallback(async () => {
    if (!profileCampaignId) {
      setMiReady(false);
      setMiEngineState(null);
      setMiChecking(false);
      return;
    }
    setMiChecking(true);
    try {
      const res = await fetch(getApiUrl(`/api/ci/mi-v3/snapshot/${profileCampaignId}`));
      if (res.ok) {
        const data = await safeApiJson(res);
        const state = data.engineState || null;
        const freshness = data.engineDiagnostics?.freshnessDays ?? null;
        const normalized = normalizeEngineSnapshot(data, 'mi');
        setMiEngineState(state);
        setMiFreshnessDays(freshness);
        setMiReady(isEngineReady(normalized, profileCampaignId, state));
      } else {
        setMiReady(false);
        setMiEngineState('NO_DATA');
      }
    } catch {
      setMiReady(false);
      setMiEngineState('ERROR');
    }
    setMiChecking(false);
  }, [profileCampaignId]);

  useEffect(() => {
    checkMIReadiness();
  }, [checkMIReadiness]);

  const pulseAnim = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const fetchCICompetitors = useCallback(async () => {
    if (!profileCampaignId) return;
    setCiLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/ci/competitors?accountId=default&campaignId=${profileCampaignId}`));
      const data = await safeApiJson(res);
      if (data.competitors && Array.isArray(data.competitors)) {
        setCiCompetitors(data.competitors);
        const allIds = new Set<string>(data.competitors.map((c: CICompetitor) => c.id));
        setSelectedCompetitorIds(allIds);
      }
    } catch (err) {
      console.error('[BuildThePlan] Failed to fetch CI competitors:', err);
    } finally {
      setCiLoading(false);
    }
  }, [profileCampaignId]);

  useEffect(() => {
    fetchCICompetitors();
  }, [fetchCICompetitors]);

  const toggleCompetitor = useCallback((id: string) => {
    Haptics.selectionAsync();
    setSelectedCompetitorIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const passGate = useCallback(async () => {
    setError('');
    const selected = ciCompetitors.filter(c => selectedCompetitorIds.has(c.id));
    const validUrls = selected.map(c => c.profileLink).filter(u => u.trim().length > 0);
    if (validUrls.length === 0) {
      setError('Select at least one competitor from your Competitor Intelligence');
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
          campaignId: profileCampaignId,
        }),
      });
      console.log('[BuildThePlan] Gate response status:', res.status);
      const data = await safeApiJson(res);
      if (!data.success) {
        setError(data.message || data.error || 'Gate failed');
        return;
      }

      const bpUrl = getApiUrl(`/api/strategic/blueprint/${data.blueprintId}`);
      const bpRes = await fetch(bpUrl);
      const bpData = await safeApiJson(bpRes);
      setBlueprint(bpData.blueprint);
      setCurrentPhase(1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      console.log('[BuildThePlan] Gate passed, auto-generating blueprint for', data.blueprintId);
      try {
        const genUrl = getApiUrl('/api/strategic/generate-creative-blueprint');
        const genRes = await fetch(genUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blueprintId: data.blueprintId }),
        });
        const genData = await safeApiJson(genRes);
        console.log('[BuildThePlan] Auto-generate result:', JSON.stringify({ success: genData.success, fallback: genData.extractionFallbackUsed }));
        if (genData.success) {
          const extractionStatus = genData.extractionFallbackUsed ? 'EXTRACTION_FALLBACK' : 'EXTRACTION_COMPLETE';
          setBlueprint(prev => prev ? {
            ...prev,
            status: extractionStatus as BlueprintStatus,
            draftBlueprint: genData.draftBlueprint,
            creativeAnalysis: genData.draftBlueprint,
            confirmedBlueprint: null,
          } : null);
          setClarifications([]);
          setCurrentPhase(2);
        }
      } catch (genErr: any) {
        console.error('[BuildThePlan] Auto-generate failed:', genErr.message);
      }
    } catch (err: any) {
      const failedUrl = getApiUrl('/api/strategic/init');
      const domain = process.env.EXPO_PUBLIC_DOMAIN || 'NOT_SET';
      const diagMsg = `${err.message || 'Network error'}\n\nDiagnostics:\nURL: ${failedUrl}\nDomain: ${domain}\nPlatform: ${Platform.OS}`;
      console.error('[BuildThePlan] Gate fetch failed:', diagMsg);
      setError(diagMsg);
    } finally {
      setLoading(false);
    }
  }, [ciCompetitors, selectedCompetitorIds, avgPrice]);

  const generateCreativeBlueprint = useCallback(async () => {
    if (!blueprint) {
      console.log('[BuildThePlan] generateCreativeBlueprint: no blueprint');
      return;
    }
    console.log('[BuildThePlan] generateCreativeBlueprint: starting for', blueprint.id);
    setError('');
    setLoading(true);

    try {
      const url = getApiUrl('/api/strategic/generate-creative-blueprint');
      console.log('[BuildThePlan] POST', url);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprintId: blueprint.id }),
      });
      console.log('[BuildThePlan] response status:', res.status);
      const data = await safeApiJson(res);
      console.log('[BuildThePlan] response:', JSON.stringify({ success: data.success, fallback: data.extractionFallbackUsed, reason: data.parseFailedReason, meta: data._meta }));

      if (!data.success) {
        setError(data.error || data.message || 'Blueprint generation failed');
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
      console.error('[BuildThePlan] generateCreativeBlueprint error:', err);
      setError(err.message || 'Blueprint generation failed');
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
      const data = await safeApiJson(res);

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
      const data = await safeApiJson(res);
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
      const data = await safeApiJson(res);
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
        data = await safeApiJson(res);
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

  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [isFallbackPlan, setIsFallbackPlan] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sectionStatuses, setSectionStatuses] = useState<Record<string, string> | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartRef = useRef<number>(0);
  const POLLING_TIMEOUT_MS = 90000;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const pollJobStatus = useCallback(async (jId: string) => {
    try {
      if (Date.now() - pollingStartRef.current > POLLING_TIMEOUT_MS) {
        stopPolling();
        setLoading(false);
        setJobId(null);
        setError('[POLL_TIMEOUT] Generation took too long (90s). The job may still complete — retry to check.');
        return;
      }

      const res = await fetch(getApiUrl(`/api/strategic/orchestrate-status/${jId}`));
      const data = await safeApiJson(res);

      if (data.sectionStatuses) setSectionStatuses(data.sectionStatuses);
      if (data.jobId) setLastRequestId(data.jobId);

      if (data.status === 'COMPLETE') {
        stopPolling();
        setLoading(false);
        setJobId(null);

        const requiredKeys = [
          'contentDistributionPlan',
          'creativeTestingMatrix',
          'budgetAllocationStructure',
          'kpiMonitoringPriority',
          'competitiveWatchTargets',
          'riskMonitoringTriggers',
        ];
        const plan = data.orchestratorPlan;
        const missing = plan ? requiredKeys.filter(k => !plan[k] || typeof plan[k] !== 'object') : requiredKeys;

        if (missing.length > 0) {
          setError(`[SCHEMA_INVALID] Plan missing sections: ${missing.join(', ')}. Retry or contact support.`);
          return;
        }

        if (data.fallback) {
          setIsFallbackPlan(true);
          setFallbackReason(data.fallbackReason || 'AI generation failed — using skeleton plan');
        }

        setBlueprint(prev => prev ? {
          ...prev,
          status: 'ORCHESTRATED' as BlueprintStatus,
          orchestratorPlan: plan,
          planId: data.planId || null,
          planStatus: data.planStatus || 'DRAFT',
        } : null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }

      if (data.status === 'FAILED') {
        stopPolling();
        setLoading(false);
        setJobId(null);
        const code = data.error || 'JOB_FAILED';
        const msg = data.message || 'Generation failed';
        setError(`[${code}] ${msg}`);
        return;
      }
    } catch (err: any) {
      console.warn('[BuildThePlan] Poll error:', err.message);
    }
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  useEffect(() => {
    stopPolling();
    setJobId(null);
    setSectionStatuses(null);
  }, [blueprint?.id, stopPolling]);

  const runOrchestrator = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLastRequestId(null);
    setIsFallbackPlan(false);
    setFallbackReason(null);
    setSectionStatuses(null);
    stopPolling();
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/orchestrate`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await safeApiJson(res);

      if (data.requestId) setLastRequestId(data.requestId);

      if (!res.ok || !data.success) {
        const code = data.error || 'UNKNOWN';
        const msg = data.message || 'Orchestrator failed';
        setError(`[${code}] ${msg}`);
        setLoading(false);
        return;
      }

      if (data.jobId) {
        setJobId(data.jobId);
        setLastRequestId(data.jobId);

        const initialStatuses: Record<string, string> = {
          contentDistributionPlan: 'PENDING',
          creativeTestingMatrix: 'PENDING',
          budgetAllocationStructure: 'PENDING',
          kpiMonitoringPriority: 'PENDING',
          competitiveWatchTargets: 'PENDING',
          riskMonitoringTriggers: 'PENDING',
        };
        setSectionStatuses(initialStatuses);

        pollingStartRef.current = Date.now();
        pollingRef.current = setInterval(() => {
          pollJobStatus(data.jobId);
        }, 2000);
      } else {
        setLoading(false);
      }
    } catch (err: any) {
      setError(`[NETWORK] ${err.message}`);
      setLoading(false);
    }
  }, [blueprint, stopPolling, pollJobStatus]);

  const approvePlan = useCallback(async () => {
    if (!blueprint) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/approve-plan`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await safeApiJson(res);
      if (!res.ok || !data.success) {
        const statusPrefix = !res.ok ? `[HTTP ${res.status}] ` : '';
        setError(statusPrefix + (data.message || data.error || 'Approval failed'));
        return;
      }

      setBlueprint(prev => prev ? {
        ...prev,
        planId: data.planId,
        planStatus: 'APPROVED',
      } : null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Plan Approved', 'Your execution plan is now active. The Pipeline is unlocked.');
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [blueprint]);

  const [autoRetryAfterRegenerate, setAutoRetryAfterRegenerate] = useState(false);

  useEffect(() => {
    if (autoRetryAfterRegenerate && blueprint?.status === 'VALIDATED' && !loading) {
      setAutoRetryAfterRegenerate(false);
      runOrchestrator();
    }
  }, [autoRetryAfterRegenerate, blueprint?.status, loading, runOrchestrator]);

  const regeneratePlan = useCallback(async () => {
    if (!blueprint) return;

    Alert.alert(
      'Regenerate Plan',
      'This will clear the current execution plan and revert to VALIDATED status. Any existing approval will be revoked and the Pipeline will be locked.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setError('');
            setLoading(true);
            try {
              const res = await fetch(getApiUrl(`/api/strategic/blueprint/${blueprint.id}/regenerate-plan`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              const data = await safeApiJson(res);
              if (!res.ok || !data.success) {
                setError((data.message || data.error || 'Regeneration failed'));
                setLoading(false);
                return;
              }

              setBlueprint(prev => prev ? {
                ...prev,
                status: 'VALIDATED' as BlueprintStatus,
                orchestratorPlan: null,
                planId: null,
                planStatus: null,
              } : null);
              setCurrentPhase(5);
              setIsFallbackPlan(false);
              setFallbackReason(null);
              setLoading(false);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setAutoRetryAfterRegenerate(true);
            } catch (err: any) {
              setError(`Network error: ${err.message}`);
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [blueprint]);

  const renderCampaignBadge = () => {
    const ctx = blueprint?.campaignContext;
    if (!ctx) return null;

    return (
      <View style={[s.campaignBadge, { backgroundColor: '#10B98115', borderColor: '#10B98130' }]}>
        <Ionicons name="megaphone" size={14} color="#10B981" />
        <View style={{ flex: 1 }}>
          <Text style={[s.campaignBadgeName, { color: '#10B981' }]} numberOfLines={1}>
            {ctx.campaignName}
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


        {businessDataComplete ? (
          <View style={[s.profileCompleteBadge, { backgroundColor: '#10B98112', borderColor: '#10B98130' }]}>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <View style={{ flex: 1 }}>
              <Text style={[s.profileCompleteText, { color: '#10B981' }]}>Business Profile Complete</Text>
            </View>
            <Pressable
              onPress={() => {
                if (onOpenProfile) {
                  onOpenProfile();
                } else {
                  setShowProfileModal(true);
                }
              }}
              style={s.profileEditBtn}
            >
              <Ionicons name="pencil" size={14} color="#10B981" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              if (onOpenProfile) {
                onOpenProfile();
              } else {
                setShowProfileModal(true);
              }
            }}
            style={[s.profileIncompleteBanner, { backgroundColor: '#F59E0B12', borderColor: '#F59E0B30' }]}
          >
            <Ionicons name="person-circle-outline" size={22} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <Text style={[s.profileIncompleteTitle, { color: '#F59E0B' }]}>Complete Your Profile</Text>
              <Text style={[s.profileIncompleteDesc, { color: colors.textMuted }]}>
                Business profile is required before plan creation
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#F59E0B" />
          </Pressable>
        )}

        <Text style={[s.sectionLabel, { color: colors.text }]}>Market Intelligence</Text>
        {miChecking ? (
          <View style={s.ciLoadingWrap}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[s.ciLoadingText, { color: colors.textSecondary }]}>Checking MI status...</Text>
          </View>
        ) : miReady ? (
          <View style={[s.profileCompleteBadge, { backgroundColor: '#10B98112', borderColor: '#10B98130' }]}>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <View style={{ flex: 1 }}>
              <Text style={[s.profileCompleteText, { color: '#10B981' }]}>
                Market Intelligence Ready{miFreshnessDays !== null ? ` (${miFreshnessDays}d fresh)` : ''}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[s.profileIncompleteBanner, { backgroundColor: '#EF444412', borderColor: '#EF444430' }]}>
            <Ionicons name="alert-circle" size={22} color="#EF4444" />
            <View style={{ flex: 1 }}>
              <Text style={[s.profileIncompleteTitle, { color: '#EF4444' }]}>MI Not Ready</Text>
              <Text style={[s.profileIncompleteDesc, { color: colors.textMuted }]}>
                {miEngineState === 'REFRESH_REQUIRED' ? 'Data is stale — run MI analysis to refresh' :
                 miEngineState === 'REFRESHING' ? 'Analysis in progress — please wait' :
                 miEngineState === 'REFRESH_FAILED' ? 'MI refresh failed — try running analysis again' :
                 miEngineState === 'BLOCKED' ? 'MI data integrity issue — re-run Market Intelligence' :
                 'Run Market Intelligence in the Intelligence tab first'}
              </Text>
            </View>
            {onNavigateToCI && (
              <Pressable onPress={onNavigateToCI}>
                <Ionicons name="chevron-forward" size={18} color="#EF4444" />
              </Pressable>
            )}
          </View>
        )}

        {businessDataComplete && !gateChecking && gateResult && (
          <View style={{ marginTop: 16 }}>
            <Text style={[s.sectionLabel, { color: colors.text }]}>Plan Readiness</Text>
            <View style={[s.profileCompleteBadge, {
              backgroundColor: gateResult.verdict === 'PASS' ? '#10B98112' :
                gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? '#F59E0B12' : '#EF444412',
              borderColor: gateResult.verdict === 'PASS' ? '#10B98130' :
                gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? '#F59E0B30' : '#EF444430',
            }]}>
              <Ionicons
                name={gateResult.verdict === 'PASS' ? 'checkmark-circle' :
                  gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? 'alert-circle' : 'close-circle'}
                size={18}
                color={gateResult.verdict === 'PASS' ? '#10B981' :
                  gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? '#F59E0B' : '#EF4444'}
              />
              <View style={{ flex: 1 }}>
                <Text style={[s.profileCompleteText, {
                  color: gateResult.verdict === 'PASS' ? '#10B981' :
                    gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? '#F59E0B' : '#EF4444',
                }]}>
                  {gateResult.verdict === 'PASS' ? 'Ready to Build' :
                    gateResult.verdict === 'PASS_WITH_ASSUMPTIONS' ? 'Ready (with assumptions)' : 'Missing Information'}
                </Text>
                {gateResult.readinessScore !== undefined && (
                  <Text style={[s.profileIncompleteDesc, { color: colors.textMuted }]}>
                    Score: {gateResult.readinessScore}/100 | {gateResult.archetype?.toUpperCase() || 'Unknown'} archetype
                  </Text>
                )}
              </View>
            </View>
            {gateResult.gaps && gateResult.gaps.length > 0 && (
              <View style={{ marginTop: 6, paddingHorizontal: 4 }}>
                {gateResult.gaps.slice(0, 3).map((gap: string, i: number) => (
                  <Text key={i} style={[{ fontSize: 11, lineHeight: 16, color: colors.textMuted }]}>
                    {'\u2022'} {gap}
                  </Text>
                ))}
              </View>
            )}
            {gateResult.assumptions && gateResult.assumptions.length > 0 && (
              <View style={{ marginTop: 6, paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: '600' as const, color: '#F59E0B', marginBottom: 2, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
                  Assumptions Made
                </Text>
                {gateResult.assumptions.slice(0, 3).map((a: string, i: number) => (
                  <Text key={i} style={[{ fontSize: 11, lineHeight: 16, color: colors.textMuted }]}>
                    {'\u2022'} {a}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        {gateChecking && (
          <View style={[s.ciLoadingWrap, { marginTop: 16 }]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[s.ciLoadingText, { color: colors.textSecondary }]}>Checking plan readiness...</Text>
          </View>
        )}

        <Text style={[s.sectionLabel, { color: colors.text, marginTop: 16 }]}>Competitors</Text>
        {ciLoading ? (
          <View style={s.ciLoadingWrap}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[s.ciLoadingText, { color: colors.textSecondary }]}>Loading competitors...</Text>
          </View>
        ) : ciCompetitors.length === 0 ? (
          <View style={[s.ciEmptyWrap, { backgroundColor: isDark ? '#1A2030' : '#F8FAFC', borderColor: colors.cardBorder }]}>
            <Ionicons name="telescope-outline" size={28} color={colors.textMuted} />
            <Text style={[s.ciEmptyText, { color: colors.textSecondary }]}>
              No competitors added yet. Add competitors in Competitor Intelligence first.
            </Text>
            {onNavigateToCI && (
              <Pressable onPress={onNavigateToCI} style={[s.ciNavBtn, { borderColor: '#3B82F640' }]}>
                <Ionicons name="arrow-forward" size={16} color="#3B82F6" />
                <Text style={[s.ciNavBtnText, { color: '#3B82F6' }]}>Go to Competitor Intelligence</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            {ciCompetitors.map((comp) => {
              const isSelected = selectedCompetitorIds.has(comp.id);
              return (
                <Pressable
                  key={comp.id}
                  onPress={() => toggleCompetitor(comp.id)}
                  style={[s.ciCompRow, {
                    backgroundColor: isSelected ? (isDark ? '#3B82F612' : '#3B82F608') : (isDark ? '#0F1419' : '#FAFAFA'),
                    borderColor: isSelected ? '#3B82F650' : colors.cardBorder,
                  }]}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? '#3B82F6' : colors.textMuted}
                  />
                  <View style={s.ciCompInfo}>
                    <Text style={[s.ciCompName, { color: colors.text }]}>{comp.name}</Text>
                    <Text style={[s.ciCompMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {comp.businessType}{comp.engagementRatio ? ` · ${(comp.engagementRatio * 100).toFixed(1)}% engagement` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            <View style={s.ciFooter}>
              <Text style={[s.ciFooterCount, { color: colors.textSecondary }]}>
                {selectedCompetitorIds.size} of {ciCompetitors.length} selected
              </Text>
              {onNavigateToCI && (
                <Pressable onPress={onNavigateToCI} style={s.ciFooterLink}>
                  <Ionicons name="add-circle-outline" size={16} color="#3B82F6" />
                  <Text style={[s.ciFooterLinkText, { color: '#3B82F6' }]}>Add more in CI</Text>
                </Pressable>
              )}
            </View>
          </>
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
          disabled={loading || !businessDataComplete || !miReady}
          style={[s.actionBtn, { opacity: (loading || !businessDataComplete || !miReady) ? 0.5 : 1 }]}
        >
          <LinearGradient colors={(businessDataComplete && miReady) ? ['#8B5CF6', '#6366F1'] : ['#6B7280', '#4B5563']} style={s.actionBtnGrad}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name={(businessDataComplete && miReady) ? 'lock-open' : 'lock-closed'} size={18} color="#fff" />
                <Text style={s.actionBtnText}>
                  {!businessDataComplete ? 'Complete Business Profile First' :
                   !miReady ? 'Run Market Intelligence First' :
                   'Unlock Analysis'}
                </Text>
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
          <View style={[s.phaseIconWrap, { backgroundColor: '#8B5CF620' }]}>
            <Ionicons name="bulb" size={20} color="#8B5CF6" />
          </View>
          <View style={s.phaseHeaderText}>
            <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 1: Creative Blueprint</Text>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              AI generates creative direction from your market intelligence, competitor signals, and campaign strategy
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 12, marginBottom: 8, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Hook direction and narrative structure</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>CTA and content angle recommendations</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Visual direction and format suggestions</Text>
          </View>
        </View>

        {error ? <Text style={s.errorText}>{error}</Text> : null}

        <Pressable
          onPress={generateCreativeBlueprint}
          disabled={loading}
          style={[s.actionBtn, { opacity: loading ? 0.6 : 1 }]}
        >
          <LinearGradient colors={['#8B5CF6', '#6366F1']} style={s.actionBtnGrad}>
            {loading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={s.actionBtnText}>Generating blueprint...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={s.actionBtnText}>Generate Creative Blueprint</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );

  const ENGINE_SOURCE_LABELS: Record<string, string> = {
    offer_engine: 'Offer Engine',
    positioning_engine: 'Positioning Engine',
    persuasion_engine: 'Persuasion Engine',
    audience_engine: 'Audience Engine',
    funnel_engine: 'Funnel Engine',
    differentiation_engine: 'Differentiation Engine',
    awareness_engine: 'Awareness Engine',
    channel_selection: 'Channel Selection',
    market_intelligence: 'Market Intelligence',
  };

  const renderExtractionField = (label: string, fieldKey: string, fieldData: FieldWithConfidence | any, icon: string) => {
    const isEditing = editingField === fieldKey;
    const hasClarification = clarifications.some(c => c.field === fieldKey);

    let displayValue: string;
    let confidence: number;
    let isInsufficient = false;
    let sourceEngine: string | null = null;

    if (fieldData && typeof fieldData === 'object' && 'value' in fieldData) {
      displayValue = fieldData.value === 'INSUFFICIENT_DATA' ? '' : String(fieldData.value ?? '');
      confidence = typeof fieldData.confidence === 'number' ? fieldData.confidence : 0;
      isInsufficient = fieldData.value === 'INSUFFICIENT_DATA';
      sourceEngine = fieldData.source || null;
    } else {
      displayValue = fieldData === null || fieldData === undefined ? '' : String(fieldData);
      confidence = displayValue ? 50 : 0;
      isInsufficient = !displayValue;
    }

    const confColor = getConfidenceColor(confidence);
    const confLabel = getConfidenceLabel(confidence);
    const needsAttention = isInsufficient || confidence < 60 || hasClarification;
    const clarification = clarifications.find(c => c.field === fieldKey);
    const sourceLabel = sourceEngine ? ENGINE_SOURCE_LABELS[sourceEngine] || sourceEngine : null;

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

        {sourceLabel && !isEditing && !isInsufficient && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Ionicons name="link" size={11} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginLeft: 4 }}>
              Source: {sourceLabel}
            </Text>
          </View>
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
                    ? 'AI generation incomplete. Fill in the fields manually, or regenerate the blueprint.'
                    : 'Review AI-generated creative blueprint. Edit fields with low confidence, then confirm.'}
              </Text>
            </View>
          </View>

          {isFallback && !isConfirmed && (
            <View style={[s.statusBanner, { backgroundColor: '#EF444415', borderWidth: 1, borderColor: '#EF444430' }]}>
              <Ionicons name="warning" size={16} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={[s.statusBannerText, { color: '#EF4444', fontWeight: '700' }]}>
                  AI blueprint generation incomplete — switched to manual mode
                </Text>
                <Text style={[s.statusBannerText, { color: '#EF4444', fontSize: 12, marginTop: 2 }]}>
                  Reason: {fallbackReasonLabel}
                </Text>
              </View>
            </View>
          )}

          {isFallback && !isConfirmed && (
            <Pressable
              onPress={() => { generateCreativeBlueprint(); }}
              disabled={loading}
              style={{ marginTop: 8, marginBottom: 4, alignSelf: 'flex-start', opacity: loading ? 0.6 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#3B82F615', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F630' }}>
                {loading ? <ActivityIndicator color="#3B82F6" size="small" /> : <Ionicons name="refresh" size={16} color="#3B82F6" />}
                <Text style={{ color: '#3B82F6', fontWeight: '600', fontSize: 14, marginLeft: 6 }}>
                  {loading ? 'Regenerating...' : 'Regenerate Blueprint'}
                </Text>
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

        {renderExtractionField('Offer Positioning', 'detectedOffer', draft.detectedOffer, 'pricetag')}
        {renderExtractionField('Brand Positioning', 'detectedPositioning', draft.detectedPositioning, 'trending-up')}
        {renderExtractionField('Call to Action', 'detectedCTA', draft.detectedCTA, 'megaphone')}
        {renderExtractionField('Target Audience', 'detectedAudienceGuess', draft.detectedAudienceGuess, 'people')}
        {renderExtractionField('Funnel Stage', 'detectedFunnelStage', draft.detectedFunnelStage, 'funnel')}

        {draft.hookDirection && renderExtractionField('Hook Direction', 'hookDirection', draft.hookDirection, 'flash')}
        {draft.narrativeStructure && renderExtractionField('Narrative Structure', 'narrativeStructure', draft.narrativeStructure, 'document-text')}
        {draft.contentAngle && renderExtractionField('Content Angle', 'contentAngle', draft.contentAngle, 'compass')}
        {draft.visualDirection && renderExtractionField('Visual Direction', 'visualDirection', draft.visualDirection, 'color-palette')}
        {draft.formatSuggestion && renderExtractionField('Format Suggestion', 'formatSuggestion', draft.formatSuggestion, 'film')}

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
              AI blueprint generation used fallback — analysis may be less accurate. Consider regenerating the blueprint.
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

  const safeStr = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(safeStr).join(', ');
    if (typeof val === 'object') {
      const pick = val.type || val.name || val.label || val.value || val.title || val.text;
      if (typeof pick === 'string') return pick;
      try { return JSON.stringify(val); } catch { return '[object]'; }
    }
    return String(val);
  };

  const safeArr = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.map(safeStr).join(', ');
    return safeStr(val);
  };

  const renderPhase5 = () => {
    let plan = blueprint?.orchestratorPlan;
    if (typeof plan === 'string') {
      try { plan = JSON.parse(plan); } catch { plan = null; }
    }

    const pStatus = blueprint?.planStatus;
    const isApproved = pStatus === 'APPROVED';

    const renderPhase5Header = () => (
      <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={s.phaseHeader}>
          <View style={[s.phaseIconWrap, { backgroundColor: '#10B98120' }]}>
            <Ionicons name="rocket" size={20} color="#10B981" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[s.phaseTitle, { color: colors.text }]}>Phase 5: Execution Plans</Text>
              {plan && (
                <View style={{
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  backgroundColor: isApproved ? '#10B98120' : '#F59E0B20',
                }}>
                  <Text style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: isApproved ? '#10B981' : '#F59E0B',
                    textTransform: 'uppercase',
                  }}>
                    {isApproved ? 'APPROVED' : 'PENDING APPROVAL'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[s.phaseDesc, { color: colors.textSecondary }]}>
              {isApproved ? 'Plan approved — Pipeline unlocked' : plan ? 'Review and approve to unlock Pipeline' : 'Generate your AI execution plans'}
            </Text>
          </View>
        </View>
      </View>
    );

    if (loading) {
      const sectionLabels: Record<string, string> = {
        contentDistributionPlan: 'Content Distribution',
        creativeTestingMatrix: 'Creative Testing',
        budgetAllocationStructure: 'Budget Allocation',
        kpiMonitoringPriority: 'KPI Monitoring',
        competitiveWatchTargets: 'Competitive Watch',
        riskMonitoringTriggers: 'Risk Triggers',
      };
      const sectionColors: Record<string, string> = {
        PENDING: '#6B7280',
        GENERATING: '#3B82F6',
        COMPLETE: '#10B981',
        FALLBACK: '#F59E0B',
      };
      const sectionIcons: Record<string, string> = {
        PENDING: 'ellipse-outline',
        GENERATING: 'sync',
        COMPLETE: 'checkmark-circle',
        FALLBACK: 'warning',
      };

      return (
        <View style={s.phaseContent}>
          {renderCampaignBadge()}
          {renderPhase5Header()}
          <View style={[s.phaseCard, { backgroundColor: colors.card, borderColor: colors.cardBorder, paddingVertical: 24 }]}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <ActivityIndicator size="large" color="#10B981" />
              <Text style={[s.phaseDesc, { color: colors.textSecondary, marginTop: 12 }]}>
                Building execution plans...
              </Text>
              {lastRequestId && (
                <Text selectable style={{ color: '#6B7280', fontSize: 10, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                  Job: {lastRequestId}
                </Text>
              )}
            </View>
            {sectionStatuses && (
              <View style={{ gap: 6 }}>
                {Object.entries(sectionLabels).map(([key, label]) => {
                  const st = sectionStatuses[key] || 'PENDING';
                  const clr = sectionColors[st] || '#6B7280';
                  const icon = sectionIcons[st] || 'ellipse-outline';
                  return (
                    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                      <Ionicons name={icon as any} size={16} color={clr} />
                      <Text style={{ color: clr, fontSize: 13, fontWeight: st === 'PENDING' ? '400' : '600' }}>{label}</Text>
                      <Text style={{ color: clr, fontSize: 10, marginLeft: 'auto', textTransform: 'uppercase' as const }}>{st}</Text>
                    </View>
                  );
                })}
              </View>
            )}
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
            {lastRequestId && (
              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="document-text-outline" size={14} color="#6B7280" />
                <Text selectable style={{ color: '#6B7280', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                  ID: {lastRequestId}
                </Text>
              </View>
            )}
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

        {(isFallbackPlan || plan?.fallback || plan?.partialFallback) && (() => {
          const isFullFallback = plan?.fallback === true && !plan?.partialFallback;
          const aiCount = plan?.aiGeneratedSections || 0;
          const fbCount = plan?.fallbackSections || (isFullFallback ? 6 : 0);
          const bgColor = isFullFallback ? '#FFFBEB' : '#FFF7ED';
          const borderColor = isFullFallback ? '#FCD34D' : '#FDBA74';
          return (
            <View style={[s.phaseCard, { backgroundColor: bgColor, borderColor }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Ionicons name={isFullFallback ? 'construct' : 'checkmark-done'} size={18} color={isFullFallback ? '#D97706' : '#EA580C'} />
                <Text style={{ color: '#92400E', fontSize: 13, fontWeight: '700' }}>
                  {isFullFallback ? 'Skeleton Plan (Full Fallback)' : `Mixed Plan — ${aiCount} AI-generated, ${fbCount} fallback`}
                </Text>
              </View>
              <Text style={{ color: '#78350F', fontSize: 12, lineHeight: 17 }}>
                {isFullFallback
                  ? (fallbackReason || plan?.fallbackReason || 'AI generation failed for all sections. This is a deterministic skeleton plan based on your blueprint data.')
                  : `${aiCount} sections were generated by AI. ${fbCount} sections used deterministic fallback and can be improved by retrying.`}
              </Text>
              <Pressable onPress={regeneratePlan} disabled={loading} style={[s.actionBtn, { marginTop: 10 }]}>
                <LinearGradient colors={isFullFallback ? ['#D97706', '#B45309'] : ['#EA580C', '#C2410C']} style={s.actionBtnGrad}>
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={s.actionBtnText}>{isFullFallback ? 'Retry AI Generation' : 'Retry Fallback Sections'}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          );
        })()}

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
                data.platforms && data.platforms.length > 0 ? data.platforms.map((p: any, i: number) => {
                  const formatContentTypes = (ct: any[]): string => {
                    if (!Array.isArray(ct) || ct.length === 0) return '';
                    return ct.map((item: any) => {
                      if (typeof item === 'string') return item;
                      if (item && typeof item === 'object') return item.type || item.name || item.label || JSON.stringify(item);
                      return String(item);
                    }).join(', ');
                  };
                  return (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <View style={s.execItemHeader}>
                        <Text style={[s.execItemTitle, { color: colors.text }]}>{p.platform}</Text>
                        <View style={[s.badge, { backgroundColor: p.priority === 'primary' ? '#10B98120' : '#6366F120' }]}>
                          <Text style={[s.badgeText, { color: p.priority === 'primary' ? '#10B981' : '#6366F1' }]}>{p.priority}</Text>
                        </View>
                      </View>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                        {p.frequency} · {formatContentTypes(p.contentTypes)}
                      </Text>
                      {Array.isArray(p.contentTypes) && p.contentTypes.length > 0 && typeof p.contentTypes[0] === 'object' && (
                        <View style={{ marginTop: 6, gap: 3 }}>
                          {p.contentTypes.map((ct: any, ci: number) => (
                            <View key={ci} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{ct.type || ct.name || 'Content'}</Text>
                              <Text style={{ color: colors.accent, fontSize: 11 }}>{ct.percentage || ct.weeklyCount ? `${ct.percentage || ''} ${ct.weeklyCount ? `(${ct.weeklyCount}/wk)` : ''}`.trim() : ''}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                }) : (
                  <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                    <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No distribution platforms available.</Text>
                  </View>
                )
              )}

              {sec.key === 'creativeTestingMatrix' && (
                (() => {
                  const tests = data.tests || data.items || (Array.isArray(data) ? data : []);
                  return tests.length > 0 ? tests.map((t: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemTitle, { color: colors.text }]}>{safeStr(t.testName || t.name || t.test)}</Text>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                        Variable: {safeStr(t.variable)} · {safeStr(t.duration)}
                      </Text>
                    </View>
                  )) : (
                    <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No creative tests available.</Text>
                    </View>
                  );
                })()
              )}

              {sec.key === 'budgetAllocationStructure' && (
                <>
                  <Text style={[s.budgetTotal, { color: colors.accent }]}>
                    Recommended: {safeStr(data.totalRecommended || data.total)}
                  </Text>
                  {(data.breakdown || data.allocations || []).map((b: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <View style={s.budgetRow}>
                        <Text style={[s.execItemTitle, { color: colors.text }]}>{safeStr(b.category || b.name)}</Text>
                        <Text style={[s.budgetPct, { color: colors.accent }]}>{b.percentage}%</Text>
                      </View>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>{safeStr(b.purpose || b.description)}</Text>
                    </View>
                  ))}
                </>
              )}

              {sec.key === 'kpiMonitoringPriority' && (
                (() => {
                  const kpis = data.primaryKPIs || data.kpis || data.items || (Array.isArray(data) ? data : []);
                  return kpis.length > 0 ? kpis.map((k: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemTitle, { color: colors.text }]}>{safeStr(k.kpi || k.name || k.metric)}</Text>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                        Target: {safeStr(k.target)} · Check: {safeStr(k.frequency)}
                      </Text>
                    </View>
                  )) : (
                    <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No KPIs available.</Text>
                    </View>
                  );
                })()
              )}

              {sec.key === 'competitiveWatchTargets' && (
                (() => {
                  const targets = data.targets || data.competitors || data.items || (Array.isArray(data) ? data : []);
                  return targets.length > 0 ? targets.map((t: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemTitle, { color: colors.text }]}>{safeStr(t.competitor || t.name || t.target)}</Text>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                        Watch: {safeArr(t.watchMetrics || t.metrics)}
                      </Text>
                    </View>
                  )) : (
                    <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No competitive watch targets available.</Text>
                    </View>
                  );
                })()
              )}

              {sec.key === 'riskMonitoringTriggers' && (
                (() => {
                  const triggers = data.triggers || data.risks || data.items || (Array.isArray(data) ? data : []);
                  return triggers.length > 0 ? triggers.map((t: any, i: number) => (
                    <View key={i} style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <View style={s.execItemHeader}>
                        <Text style={[s.execItemTitle, { color: colors.text }]}>{safeStr(t.trigger || t.risk || t.name)}</Text>
                        <View style={[s.badge, {
                          backgroundColor: t.severity === 'critical' ? '#EF444420' : t.severity === 'high' ? '#F59E0B20' : '#10B98120',
                        }]}>
                          <Text style={[s.badgeText, {
                            color: t.severity === 'critical' ? '#EF4444' : t.severity === 'high' ? '#F59E0B' : '#10B981',
                          }]}>
                            {safeStr(t.severity || 'medium')}
                          </Text>
                        </View>
                      </View>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>
                        Action: {safeStr(t.action || t.response || t.mitigation)}
                      </Text>
                    </View>
                  )) : (
                    <View style={[s.execItem, { borderColor: colors.cardBorder }]}>
                      <Text style={[s.execItemDesc, { color: colors.textSecondary }]}>No risk triggers available.</Text>
                    </View>
                  );
                })()
              )}
            </View>
          );
        })}

        <View style={{ marginTop: 16, gap: 10 }}>
          {!isApproved && (
            <Pressable onPress={approvePlan} disabled={loading} style={[s.actionBtn]}>
              <LinearGradient colors={['#10B981', '#059669']} style={s.actionBtnGrad}>
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={s.actionBtnText}>
                  {loading ? 'Approving...' : 'Approve & Activate Plan'}
                </Text>
              </LinearGradient>
            </Pressable>
          )}

          {isApproved && (
            <View style={[s.phaseCard, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-done-circle" size={22} color="#10B981" />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#065F46', fontWeight: '700', fontSize: 14 }}>Plan Approved</Text>
                  <Text style={{ color: '#047857', fontSize: 12, marginTop: 2 }}>
                    Go to Calendar to view your scheduled content.
                  </Text>
                </View>
              </View>
              {onNavigateToCalendar && (
                <Pressable
                  onPress={onNavigateToCalendar}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#10B981', borderRadius: 8, paddingVertical: 10, marginTop: 12 }}
                >
                  <Ionicons name="calendar" size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Go to Calendar</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable onPress={() => setShowPlanDocument(true)} style={[s.actionBtn]}>
            <LinearGradient colors={['#8B5CF6', '#7C3AED']} style={s.actionBtnGrad}>
              <Ionicons name="document-text" size={18} color="#fff" />
              <Text style={s.actionBtnText}>View Plan Document</Text>
            </LinearGradient>
          </Pressable>

          <Pressable onPress={regeneratePlan} disabled={loading} style={[s.actionBtn]}>
            <LinearGradient colors={['#6B7280', '#4B5563']} style={s.actionBtnGrad}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={s.actionBtnText}>Regenerate Plan</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {showPlanDocument && (
          <View style={{ marginTop: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: isDark ? '#374151' : '#E5E7EB', minHeight: 300 }}>
            <PlanDocumentView
              planId={blueprint?.planId || undefined}
              blueprintId={blueprint?.id}
              onClose={() => setShowPlanDocument(false)}
            />
          </View>
        )}

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
        const data = await safeApiJson(res);
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

      <BusinessProfileModal
        visible={showProfileModal}
        onClose={() => {
          setShowProfileModal(false);
          checkProfileCompleteness();
        }}
        onComplete={() => {
          checkProfileCompleteness();
        }}
      />
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
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  ciLoadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  ciLoadingText: {
    fontSize: 13,
  },
  ciEmptyWrap: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 4,
  },
  ciEmptyText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  ciNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  ciNavBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  ciCompRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  ciCompInfo: {
    flex: 1,
  },
  ciCompName: {
    fontSize: 14,
    fontWeight: '600',
  },
  ciCompMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  ciFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingBottom: 2,
  },
  ciFooterCount: {
    fontSize: 12,
  },
  ciFooterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ciFooterLinkText: {
    fontSize: 12,
    fontWeight: '600',
  },
  gateWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  gateWarningText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
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
  profileCompleteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  profileCompleteText: {
    fontSize: 14,
    fontWeight: '600',
  },
  profileEditBtn: {
    padding: 4,
  },
  profileIncompleteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  profileIncompleteTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  profileIncompleteDesc: {
    fontSize: 12,
    marginTop: 2,
  },
});
