import React, { useState, useEffect, useRef } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppShellController } from '@/hooks/useAppShellController';
import { GlobalHeader } from '@/components/GlobalHeader';
import { apiRequest } from '@/lib/query-client';

export interface PerformanceLoopOverview {
  campaignId: string;
  accountId: string | null;
  currentStrategyRootId: string | null;
  currentStrategyRootVersion: number;
  currentStrategyName?: string;
  businessUnderstanding: {
    snapshotId: string;
    businessIdentity: string;
    primaryOffering: string;
    businessModel: string;
    category: string;
    targetRoles: Array<{ roleTitle?: string; roleType?: string; rationale?: string } | string>;
    productTruthCapabilities: Array<{ verifiedCapability?: string; capability?: string; statement?: string } | string>;
    verifiedCapabilities: string[];
    boundaryLimitations: string[];
    userConfirmedFacts: string[];
    websiteEstablishedFacts: string[];
    unknownElements: string[];
    confidence: string;
    updatedAt: string;
  } | null;
  planPerformance: {
    contextId: string;
    mode: 'BUILD' | 'OPTIMIZE' | 'UNKNOWN';
    strategyRootId: string | null;
    strategyRootVersion: number;
    strategyName?: string;
    planId?: string | null;
    planVersion?: number;
    planSummary?: string;
    currentReality: string;
    primaryBottleneck: string | null;
    hasBottleneck: boolean;
    weakestSignals: string[];
    proofGaps: string[];
    strongestSignals: string[];
    activeChannels: Array<{ channel: string; status: string; statusLabel: string }>;
    recentTrend: string;
    confidence: string;
    freshness: string;
    evidenceIds: string[];
    warningsCount: number;
    updatedAt: string;
    ownedChannelEngagement?: {
      campaignCreatedAt: string | null;
      campaignActivatedAt: string | null;
      activePlanActivatedAt: string | null;
      campaignWindowStart: string | null;
      storedOwnedPostsCount: number;
      followersCount: number;
      platformCounts?: Record<string, {
        channelId?: string | null;
        channelUrl?: string | null;
        channelName?: string | null;
        storedUniqueItems: number;
        fetchedWindowItems: number;
        postsSinceCreationItems: number;
        postsSinceActivationItems: number;
        activePlanWindowItems: number;
        inWindowItems: number;
        rolling30dItems: number;
        accountTotalDisplay: number | string;
      }>;
    } | null;
  } | null;
}

export default function PerformanceScreen() {
  const router = useRouter();
  const shell = useAppShellController();
  const campaignId = shell.activeWorkspace?.id ?? null;

  const [activeTab, setActiveTab] = useState<'business_understanding' | 'plan_performance'>('plan_performance');
  const [data, setData] = useState<PerformanceLoopOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Business Baseline Clarification Form & Lifecycle State
  const [operatingMonthsInput, setOperatingMonthsInput] = useState('');
  const [hasPriorCustomersInput, setHasPriorCustomersInput] = useState<'yes' | 'no' | null>(null);
  const [priorCustomersCountInput, setPriorCustomersCountInput] = useState('');
  const [priorLeadsCountInput, setPriorLeadsCountInput] = useState('');
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifyFeedback, setClarifyFeedback] = useState('');
  const clarifyInFlightRef = useRef(false);

  const [isBaselineSummaryExpanded, setIsBaselineSummaryExpanded] = useState(false);
  const [editingBaselineId, setEditingBaselineId] = useState<string | null>(null);
  const [baselineSuccessBanner, setBaselineSuccessBanner] = useState<string | null>(null);

  // Downstream processing / retry state (kept strictly separate from answered baseline/weekly forms)
  const [downstreamDeferredState, setDownstreamDeferredState] = useState<{
    sourceLabel: string;
    errorMessage: string;
  } | null>(null);
  const [retryingDownstream, setRetryingDownstream] = useState(false);

  // 7-Day Reporting Window Inventory Form & Lifecycle State
  const [weeklyLeadsInput, setWeeklyLeadsInput] = useState('');
  const [weeklyConversionsInput, setWeeklyConversionsInput] = useState('');
  const [weeklyRevenueInput, setWeeklyRevenueInput] = useState('');
  const [weeklySpendInput, setWeeklySpendInput] = useState('');
  const [weeklyNotesInput, setWeeklyNotesInput] = useState('');
  const [weeklySubmitting, setWeeklySubmitting] = useState(false);
  const [weeklyFeedback, setWeeklyFeedback] = useState('');
  const weeklyInFlightRef = useRef(false);

  const [activeWeeklyFormTarget, setActiveWeeklyFormTarget] = useState<{
    inventoryId: string;
    mode: 'partial' | 'due_final' | 'history_edit';
    periodLabel: string;
    windowIndex: number;
    currency: string;
    periodEnd?: string | null;
  } | null>(null);
  const [weeklySuccessBanner, setWeeklySuccessBanner] = useState<string | null>(null);
  const [isWeeklyHistoryExpanded, setIsWeeklyHistoryExpanded] = useState(false);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);

  const notifyLifecycleStateChanged = () => {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('avyron-demo-state-changed'));
    }
  };

  const formatLocalDateTimeWithTz = (isoStr: string | null | undefined, tz?: string): string => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    const effectiveTz = tz || (data as any)?.reportingTimezone || 'UTC';
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(d);
      return `${formatted} (${effectiveTz})`;
    } catch {
      return `${d.toLocaleString()} (${effectiveTz})`;
    }
  };

  const formatLocalDateShort = (isoStr: string | null | undefined, tz?: string): string => {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
    const effectiveTz = tz || (data as any)?.reportingTimezone || 'UTC';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: effectiveTz,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(d);
    } catch {
      return d.toLocaleDateString();
    }
  };

  const populateBaselineInputsFromRecord = (rec: any) => {
    const s = rec?.structuredAnswerParsed || (typeof rec?.structuredAnswer === 'object' ? rec.structuredAnswer : null) || {};
    const opMonths = s.operatingDurationMonths ?? s.operatingMonths ?? null;
    setOperatingMonthsInput(opMonths !== null && opMonths !== undefined ? String(opMonths) : '');
    const hasPaid = s.hasHistoricalPayingCustomers ?? s.hasHistoricalPaidCustomers ?? null;
    setHasPriorCustomersInput(hasPaid === true ? 'yes' : hasPaid === false ? 'no' : null);
    const custCount = s.historicalPayingCustomersCount ?? s.historicalPaidCustomersCount ?? null;
    setPriorCustomersCountInput(custCount !== null && custCount !== undefined ? String(custCount) : '');
    const leadsCount = s.historicalLeadsCount ?? null;
    setPriorLeadsCountInput(leadsCount !== null && leadsCount !== undefined ? String(leadsCount) : '');
    setClarifyFeedback('');
  };

  const populateWeeklyInputsFromMetrics = (metricsObj: any) => {
    const m = metricsObj || {};
    setWeeklyLeadsInput(m.leads !== null && m.leads !== undefined ? String(m.leads) : '');
    const convVal = m.conversions ?? m.payingCustomers ?? null;
    setWeeklyConversionsInput(convVal !== null && convVal !== undefined ? String(convVal) : '');
    setWeeklyRevenueInput(m.revenue !== null && m.revenue !== undefined ? String(m.revenue) : '');
    const spendVal = m.adSpend ?? m.spend ?? null;
    setWeeklySpendInput(spendVal !== null && spendVal !== undefined ? String(spendVal) : '');
    setWeeklyNotesInput(m.notes ? String(m.notes) : '');
    setWeeklyFeedback('');
  };

  const fetchOverview = async () => {
    if (!campaignId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await apiRequest('GET', `/api/performance-loop/overview/${campaignId}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('[PerformanceScreen] Fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const parseOperatingMonthsClient = (raw: string): { value: number | null; error?: string } => {
    const str = raw.trim().toLowerCase();
    if (!str) return { value: null };
    if (str === 'pre-launch' || str === 'prelaunch' || str === '0') return { value: 0 };
    if (/^\d+(\.\d+)?$/.test(str)) {
      const n = Number(str);
      if (!Number.isFinite(n) || n < 0 || n > 1200) {
        return { value: null, error: 'Operating duration must be between 0 and 1200 months.' };
      }
      return { value: Math.round(n * 100) / 100 };
    }
    const unitMatch = str.match(/^(\d+(?:\.\d+)?)\s*(m|mo|mos|month|months|y|yr|yrs|year|years|w|wk|wks|week|weeks)$/i);
    if (unitMatch) {
      const rawVal = Number(unitMatch[1]);
      const unit = unitMatch[2].toLowerCase();
      if (!Number.isFinite(rawVal) || rawVal < 0) {
        return { value: null, error: 'Operating duration cannot be negative.' };
      }
      let months = rawVal;
      if (unit.startsWith('y')) months = rawVal * 12;
      else if (unit.startsWith('w')) months = Math.round((rawVal / 4.345) * 10) / 10;
      return { value: Math.round(months * 100) / 100 };
    }
    return {
      value: null,
      error: `Invalid operating duration "${raw}". Enter a non-negative number in months (e.g. "6" or "6 months").`,
    };
  };

  const parseOptionalWholeCountClient = (raw: string, label: string): { value: number | null; error?: string } => {
    const str = raw.trim();
    if (!str) return { value: null };
    if (!/^\d+$/.test(str)) {
      return { value: null, error: `${label} must be a non-negative whole number (or leave blank if unknown).` };
    }
    const n = Number(str);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { value: null, error: `${label} must be a valid non-negative integer.` };
    }
    return { value: n };
  };

  const parseOptionalAmountClient = (raw: string, label: string): { value: number | null; error?: string } => {
    const str = raw.trim().replace(/^[$€£]\s*/, '').replace(/,/g, '');
    if (!str) return { value: null };
    if (!/^\d+(\.\d+)?$/.test(str)) {
      return { value: null, error: `${label} must be a non-negative number (or leave blank if unknown).` };
    }
    const n = Number(str);
    if (!Number.isFinite(n) || n < 0) {
      return { value: null, error: `${label} must be a valid non-negative number.` };
    }
    return { value: Math.round(n * 100) / 100 };
  };

  const extractFriendlyApiError = (err: any, fallback: string): string => {
    const msg = String(err?.message || '');
    const jsonMatch = msg.match(/^\d+:\s*(\{.*\})$/s);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.error) return parsed.error;
      } catch {
        // ignore JSON parse failure
      }
    }
    return msg || fallback;
  };

  const handleRetryDownstreamEvaluation = async () => {
    if (!campaignId || retryingDownstream) return;
    setRetryingDownstream(true);
    try {
      const res = await apiRequest('POST', `/api/performance-intelligence/evaluate/${campaignId}`, {});
      if (res.ok) {
        setDownstreamDeferredState(null);
        await fetchOverview();
        notifyLifecycleStateChanged();
      }
    } catch (err: any) {
      setDownstreamDeferredState((prev) =>
        prev
          ? {
              ...prev,
              errorMessage: extractFriendlyApiError(err, 'Downstream evaluation retry failed. Your saved answers remain intact.'),
            }
          : null
      );
    } finally {
      setRetryingDownstream(false);
    }
  };

  const handleSubmitClarification = async (requestId: string, isEditingSaved: boolean = false) => {
    if (!campaignId || clarifyInFlightRef.current || clarifySubmitting) return;
    if (!requestId) {
      setClarifyFeedback('Cannot submit: missing clarificationRequestId.');
      return;
    }

    const parsedMonths = parseOperatingMonthsClient(operatingMonthsInput);
    if (parsedMonths.error) {
      setClarifyFeedback(parsedMonths.error);
      return;
    }

    const parsedCustCount = parseOptionalWholeCountClient(priorCustomersCountInput, 'Prior Paying Customers count');
    if (parsedCustCount.error) {
      setClarifyFeedback(parsedCustCount.error);
      return;
    }

    const parsedLeadsCount = parseOptionalWholeCountClient(priorLeadsCountInput, 'Prior Leads / Signups count');
    if (parsedLeadsCount.error) {
      setClarifyFeedback(parsedLeadsCount.error);
      return;
    }

    if (
      parsedMonths.value === null &&
      hasPriorCustomersInput === null &&
      parsedCustCount.value === null &&
      parsedLeadsCount.value === null
    ) {
      setClarifyFeedback('Please enter operating history in months or select Yes/No for prior paying customers.');
      return;
    }

    if (hasPriorCustomersInput === 'no' && parsedCustCount.value !== null && parsedCustCount.value > 0) {
      setClarifyFeedback(
        `Contradictory baseline answer: "No — Pre-Revenue / 0 Customers" cannot be combined with a positive customer count (${parsedCustCount.value}).`
      );
      return;
    }

    if (hasPriorCustomersInput === 'yes' && parsedCustCount.value !== null && parsedCustCount.value === 0) {
      setClarifyFeedback(
        'Contradictory baseline answer: "Yes — Had Paying Customers" cannot be combined with 0 paying customers. Leave the count blank if exact count is unknown.'
      );
      return;
    }

    if (parsedMonths.value !== null && operatingMonthsInput.trim() !== String(parsedMonths.value)) {
      setOperatingMonthsInput(String(parsedMonths.value));
    }

    const hasCustomersBool =
      hasPriorCustomersInput === null
        ? parsedCustCount.value !== null
          ? parsedCustCount.value > 0
          : null
        : hasPriorCustomersInput === 'yes';

    const effectiveCustomerCount =
      hasCustomersBool === false
        ? 0
        : parsedCustCount.value; // When Yes is selected and count is left blank, remains null (unknown count)

    clarifyInFlightRef.current = true;
    setClarifySubmitting(true);
    setClarifyFeedback('');
    try {
      const structuredAnswer = {
        operatingDurationMonths: parsedMonths.value,
        hasHistoricalPayingCustomers: hasCustomersBool,
        historicalPayingCustomersCount: effectiveCustomerCount,
        historicalLeadsCount: parsedLeadsCount.value,
      };
      const res = await apiRequest('POST', `/api/performance-intelligence/clarify/${campaignId}`, {
        clarificationRequestId: requestId,
        structuredAnswer,
      });
      const json = await res.json();
      if (json.success || json.saved) {
        setEditingBaselineId(null);
        setClarifyFeedback('');
        setBaselineSuccessBanner(
          isEditingSaved
            ? 'Business baseline updated and saved to history.'
            : 'Business baseline confirmed and saved! This one-time question is now complete.'
        );
        if (json.evaluationStatus === 'DEFERRED_ERROR') {
          setDownstreamDeferredState({
            sourceLabel: 'Business Baseline',
            errorMessage: json.evaluationError || 'Downstream evaluation deferred after saving baseline answer.',
          });
        } else {
          setDownstreamDeferredState(null);
        }
        await fetchOverview();
        notifyLifecycleStateChanged();
      } else {
        setClarifyFeedback(json.error || 'Failed to save clarification answer.');
      }
    } catch (err: any) {
      setClarifyFeedback(extractFriendlyApiError(err, 'Failed to submit clarification answer.'));
    } finally {
      clarifyInFlightRef.current = false;
      setClarifySubmitting(false);
    }
  };

  const handleOpenWeeklyForm = (
    target: {
      inventoryId: string;
      mode: 'partial' | 'due_final' | 'history_edit';
      periodLabel: string;
      windowIndex: number;
      currency: string;
      periodEnd?: string | null;
    },
    existingMetrics?: any
  ) => {
    populateWeeklyInputsFromMetrics(existingMetrics);
    setActiveWeeklyFormTarget(target);
  };

  const handleSubmitWeeklyInventory = async () => {
    if (!campaignId || weeklyInFlightRef.current || weeklySubmitting) return;
    const inv = (data as any)?.weeklyInventory || (data?.planPerformance as any)?.weeklyInventory || null;
    const target = activeWeeklyFormTarget;
    const inventoryId = target?.inventoryId || inv?.inventoryId;
    if (!inventoryId) {
      setWeeklyFeedback('Cannot submit: active 7-day weekly inventoryId is missing.');
      return;
    }

    const parsedLeads = parseOptionalWholeCountClient(weeklyLeadsInput, 'Leads / Inquiries');
    if (parsedLeads.error) {
      setWeeklyFeedback(parsedLeads.error);
      return;
    }
    const parsedConversions = parseOptionalWholeCountClient(weeklyConversionsInput, 'Conversions / Sales');
    if (parsedConversions.error) {
      setWeeklyFeedback(parsedConversions.error);
      return;
    }
    const parsedRevenue = parseOptionalAmountClient(weeklyRevenueInput, 'Revenue');
    if (parsedRevenue.error) {
      setWeeklyFeedback(parsedRevenue.error);
      return;
    }
    const parsedSpend = parseOptionalAmountClient(weeklySpendInput, 'Ad Spend');
    if (parsedSpend.error) {
      setWeeklyFeedback(parsedSpend.error);
      return;
    }

    const notesClean = weeklyNotesInput.trim() || null;
    if (
      parsedLeads.value === null &&
      parsedConversions.value === null &&
      parsedRevenue.value === null &&
      parsedSpend.value === null &&
      !notesClean
    ) {
      setWeeklyFeedback('Please enter at least one 7-day window metric (enter 0 for explicit zero, or leave unknown fields blank).');
      return;
    }

    weeklyInFlightRef.current = true;
    setWeeklySubmitting(true);
    setWeeklyFeedback('');
    try {
      const payload = {
        inventoryId,
        metrics: {
          leads: parsedLeads.value,
          payingCustomers: parsedConversions.value,
          conversions: parsedConversions.value,
          revenue: parsedRevenue.value,
          spend: parsedSpend.value,
          adSpend: parsedSpend.value,
          notes: notesClean ?? undefined,
        },
      };
      const res = await apiRequest('POST', `/api/performance/weekly-inventory/${campaignId}/submit`, payload);
      const json = await res.json();
      if (json.success || json.saved) {
        const mode = target?.mode;
        setActiveWeeklyFormTarget(null);
        setWeeklyFeedback('');

        if (mode === 'history_edit') {
          setWeeklySuccessBanner(
            `Historical check-in (${target?.periodLabel || 'completed period'}) updated. Completed status preserved.`
          );
        } else if (json.windowCompletionSemantics === 'IN_PROGRESS_AS_OF') {
          const tsFormatted = formatLocalDateTimeWithTz(json.submittedAt);
          setWeeklySuccessBanner(
            `Partial numbers saved — Updated through ${tsFormatted}. Final check-in remains scheduled for period end.`
          );
        } else {
          setWeeklySuccessBanner(
            `Weekly check-in completed for ${target?.periodLabel || 'reporting period'}! Due notification resolved and next reporting period scheduled.`
          );
        }

        if (json.evaluationStatus === 'DEFERRED_ERROR') {
          setDownstreamDeferredState({
            sourceLabel: 'Weekly Check-In',
            errorMessage: json.evaluationError || 'Downstream re-evaluation deferred after saving weekly metrics.',
          });
        } else {
          setDownstreamDeferredState(null);
        }
        await fetchOverview();
        notifyLifecycleStateChanged();
      } else {
        setWeeklyFeedback(json.error || 'Failed to submit 7-day metrics.');
      }
    } catch (err: any) {
      setWeeklyFeedback(extractFriendlyApiError(err, 'Failed to submit 7-day metrics.'));
    } finally {
      weeklyInFlightRef.current = false;
      setWeeklySubmitting(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    const handleDemoChange = () => {
      fetchOverview();
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('avyron-demo-state-changed', handleDemoChange);
    }
    return () => {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('avyron-demo-state-changed', handleDemoChange);
      }
    };
  }, [campaignId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverview();
  };

  const bu = data?.businessUnderstanding;
  const perf = data?.planPerformance;
  const pendingClarification = (data as any)?.pendingClarificationRequest || (perf as any)?.pendingClarificationRequest || null;
  const answeredClarifications: any[] = (data as any)?.answeredClarificationHistory || (perf as any)?.answeredClarificationHistory || [];
  const weeklyInventory = (data as any)?.weeklyInventory || (perf as any)?.weeklyInventory || null;
  const completedWeeklyInventories: any[] = (data as any)?.completedWeeklyInventories || (perf as any)?.completedWeeklyInventories || [];
  const scheduleHealth = (data as any)?.scheduleHealth || (perf as any)?.scheduleHealth || null;
  const reportingTimezone: string = (data as any)?.reportingTimezone || (perf as any)?.reportingTimezone || weeklyInventory?.reportingTimezone || 'UTC';
  const dueState = (data as any)?.dueState || (perf as any)?.dueState || {
    isBaselineDue: Boolean(pendingClarification && answeredClarifications.length === 0),
    isWeeklyCheckInDue: Boolean(weeklyInventory?.isDue),
    dueActionsCount:
      (pendingClarification && answeredClarifications.length === 0 ? 1 : 0) +
      (weeklyInventory?.isDue ? 1 : 0),
  };
  const historicalCases: any[] = (data as any)?.historicalPerformanceCases ?? [];
  const primaryAnsweredBaseline = answeredClarifications[0] || null;

  const renderBaselineFormFields = (requestId: string, isEditingSaved: boolean) => (
    <View
      testID={isEditingSaved ? 'baseline-edit-form' : 'baseline-pending-form'}
      style={{ gap: 10, marginTop: 8, backgroundColor: '#0F172A', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#334155' }}
    >
      <View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 4 }}>
          1. Operating History (Months in Operation)
        </Text>
        <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
          Unit: numeric months (also accepts "6 months" or "1 year") • Distinguishes a new launch (&lt;6 months) from an established business.
        </Text>
        <TextInput
          testID="baseline-operating-months-input"
          style={{
            backgroundColor: '#1E293B',
            borderWidth: 1,
            borderColor: '#475569',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            color: '#F8FAFC',
            fontSize: 13,
          }}
          value={operatingMonthsInput}
          onChangeText={setOperatingMonthsInput}
          placeholder="e.g. 6 (enter 0 if pre-launch)"
          placeholderTextColor="#64748B"
          keyboardType="numeric"
        />
      </View>

      <View>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 4 }}>
          2. Any Paying Customers Prior to This Campaign Window?
        </Text>
        <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
          Unit: Yes / No • Establishes whether the offer has prior validated willingness-to-pay.
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {(['yes', 'no'] as const).map((opt) => {
            const selected = hasPriorCustomersInput === opt;
            return (
              <Pressable
                key={opt}
                testID={`baseline-prior-customers-${opt}`}
                onPress={() => setHasPriorCustomersInput(opt)}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: selected ? '#F59E0B' : '#475569',
                  backgroundColor: selected ? '#F59E0B25' : '#1E293B',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? '#FBBF24' : '#CBD5E1' }}>
                  {opt === 'yes' ? 'Yes — Had Paying Customers' : 'No — Pre-Revenue / 0 Customers'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 4 }}>
            3. Prior Paying Customers (Optional)
          </Text>
          <TextInput
            testID="baseline-prior-customers-count-input"
            style={{
              backgroundColor: '#1E293B',
              borderWidth: 1,
              borderColor: '#475569',
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: '#F8FAFC',
              fontSize: 13,
            }}
            value={priorCustomersCountInput}
            onChangeText={setPriorCustomersCountInput}
            placeholder="Count (customers)"
            placeholderTextColor="#64748B"
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 4 }}>
            4. Prior Leads / Signups (Optional)
          </Text>
          <TextInput
            testID="baseline-prior-leads-count-input"
            style={{
              backgroundColor: '#1E293B',
              borderWidth: 1,
              borderColor: '#475569',
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: '#F8FAFC',
              fontSize: 13,
            }}
            value={priorLeadsCountInput}
            onChangeText={setPriorLeadsCountInput}
            placeholder="Count (leads)"
            placeholderTextColor="#64748B"
            keyboardType="numeric"
          />
        </View>
      </View>

      {clarifyFeedback ? (
        <Text
          testID="baseline-form-feedback"
          style={{ fontSize: 12, color: clarifyFeedback.includes('saved') ? '#34D399' : '#F87171', fontWeight: '600' }}
        >
          {clarifyFeedback}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {isEditingSaved && (
          <Pressable
            testID="baseline-cancel-edit-btn"
            onPress={() => {
              setEditingBaselineId(null);
              setClarifyFeedback('');
            }}
            disabled={clarifySubmitting}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#475569',
              backgroundColor: '#1E293B',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#CBD5E1' }}>Cancel</Text>
          </Pressable>
        )}
        <Pressable
          testID="baseline-submit-btn"
          onPress={() => handleSubmitClarification(requestId, isEditingSaved)}
          disabled={clarifySubmitting}
          style={{
            flex: 1,
            backgroundColor: '#F59E0B',
            borderRadius: 8,
            paddingVertical: 11,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: clarifySubmitting ? 0.65 : 1,
          }}
        >
          {clarifySubmitting ? (
            <ActivityIndicator size="small" color="#0F172A" />
          ) : (
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#0F172A' }}>
              {isEditingSaved ? 'Save Updated Baseline' : 'Save Business Baseline'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  const renderWeeklyMetricsSummaryText = (metricsObj: any, currency: string = 'USD'): string => {
    if (!metricsObj) return 'No metrics recorded';
    const parts: string[] = [];
    if (metricsObj.leads !== null && metricsObj.leads !== undefined) parts.push(`Leads: ${metricsObj.leads}`);
    const conv = metricsObj.conversions ?? metricsObj.payingCustomers;
    if (conv !== null && conv !== undefined) parts.push(`Conversions: ${conv}`);
    if (metricsObj.revenue !== null && metricsObj.revenue !== undefined) parts.push(`Revenue: ${currency} ${metricsObj.revenue}`);
    const spend = metricsObj.adSpend ?? metricsObj.spend;
    if (spend !== null && spend !== undefined) parts.push(`Ad Spend: ${currency} ${spend}`);
    if (metricsObj.notes) parts.push(`Notes: ${metricsObj.notes}`);
    return parts.length > 0 ? parts.join(' • ') : 'Metrics saved';
  };

  return (
    <View style={styles.container}>
      <GlobalHeader
        title="Performance Loop"
        subtitle="Canonical business understanding and live strategy performance summary"
      />

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabButton, activeTab === 'business_understanding' && styles.tabButtonActive]}
          onPress={() => setActiveTab('business_understanding')}
        >
          <Feather
            name="briefcase"
            size={16}
            color={activeTab === 'business_understanding' ? '#8B5CF6' : '#9CA3AF'}
          />
          <Text style={[styles.tabText, activeTab === 'business_understanding' && styles.tabTextActive]}>
            Business Understanding
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tabButton, activeTab === 'plan_performance' && styles.tabButtonActive]}
          onPress={() => setActiveTab('plan_performance')}
        >
          <Feather
            name="trending-up"
            size={16}
            color={activeTab === 'plan_performance' ? '#8B5CF6' : '#9CA3AF'}
          />
          <Text style={[styles.tabText, activeTab === 'plan_performance' && styles.tabTextActive]}>
            Plan Performance
          </Text>
          {dueState?.dueActionsCount > 0 && (
            <View
              testID="plan-performance-due-badge"
              style={[styles.warningBadge, { backgroundColor: '#F59E0B' }]}
            >
              <Text style={[styles.warningBadgeText, { color: '#0F172A' }]}>
                {dueState.dueActionsCount} Due
              </Text>
            </View>
          )}
          {perf && perf.warningsCount > 0 && (
            <View style={styles.warningBadge}>
              <Text style={styles.warningBadgeText}>{perf.warningsCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#8B5CF6" />}
      >
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingText}>Loading performance summary…</Text>
          </View>
        ) : activeTab === 'business_understanding' ? (
          /* ========================================================================= */
          /* 1A. BUSINESS UNDERSTANDING (CONCISE SUMMARY)                              */
          /* ========================================================================= */
          !bu ? (
            <View style={styles.emptyState}>
              <Feather name="help-circle" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No Business Understanding snapshot recorded yet</Text>
              <Text style={styles.emptySubtitle}>Run onboarding or import business assets to establish canonical truth.</Text>
            </View>
          ) : (
            <View style={styles.sectionGrid}>
              {/* Header Card: Business Identity */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.cardOverline}>CANONICAL BUSINESS TRUTH</Text>
                    <Text style={styles.cardTitle}>{bu.businessIdentity}</Text>
                  </View>
                  <View style={styles.confidencePill}>
                    <Text style={styles.confidencePillText}>Status: {bu.confidence}</Text>
                  </View>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Primary Offering:</Text>
                  <Text style={styles.detailValue}>{bu.primaryOffering}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Category / Model:</Text>
                  <Text style={styles.detailValue}>{bu.category} ({bu.businessModel})</Text>
                </View>
              </View>

              {/* Target Understanding Roles */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="users" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Who Avyron Understands Your Buyers Are</Text>
                </View>
                {bu.targetRoles.length === 0 ? (
                  <Text style={styles.mutedText}>No specific buyer roles established yet.</Text>
                ) : (
                  bu.targetRoles.map((r, i) => (
                    <View key={i} style={styles.roleItem}>
                      <Feather name="user-check" size={14} color="#10B981" style={{ marginTop: 2 }} />
                      <Text style={styles.roleText}>
                        {typeof r === 'string' ? r : (r.roleTitle || r.roleType || JSON.stringify(r))}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              {/* Verified Product Capabilities vs Boundary Limitations */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="shield" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Verified Product Truth & Capabilities</Text>
                </View>
                <Text style={styles.cardSubtitle}>What Avyron knows your product reliably accomplishes:</Text>
                {bu.productTruthCapabilities.length === 0 ? (
                  <Text style={styles.mutedText}>No verified capabilities extracted yet.</Text>
                ) : (
                  bu.productTruthCapabilities.map((cap, i) => (
                    <View key={i} style={styles.capabilityItem}>
                      <Feather name="check-circle" size={14} color="#8B5CF6" style={{ marginTop: 2 }} />
                      <Text style={styles.capabilityText}>
                        {typeof cap === 'string' ? cap : (cap.verifiedCapability || cap.capability || cap.statement || JSON.stringify(cap))}
                      </Text>
                    </View>
                  ))
                )}

                {bu.boundaryLimitations.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={[styles.cardSubtitle, { color: '#F59E0B' }]}>Known Boundary Limitations:</Text>
                    {bu.boundaryLimitations.map((lim, i) => (
                      <View key={i} style={styles.capabilityItem}>
                        <Feather name="alert-circle" size={14} color="#F59E0B" style={{ marginTop: 2 }} />
                        <Text style={styles.capabilityText}>{lim}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Provenance: User Confirmed vs Website Established vs Unknown */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="database" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Truth Provenance & Confidence</Text>
                </View>
                <View style={styles.provenanceGrid}>
                  <View style={styles.provenanceBox}>
                    <Text style={styles.provenanceCount}>{bu.userConfirmedFacts.length}</Text>
                    <Text style={styles.provenanceLabel}>User Confirmed Facts</Text>
                  </View>
                  <View style={styles.provenanceBox}>
                    <Text style={styles.provenanceCount}>{bu.websiteEstablishedFacts.length}</Text>
                    <Text style={styles.provenanceLabel}>Website Facts</Text>
                  </View>
                  <View style={styles.provenanceBox}>
                    <Text style={[styles.provenanceCount, { color: '#F59E0B' }]}>{bu.unknownElements.length}</Text>
                    <Text style={styles.provenanceLabel}>Unknown / Gaps</Text>
                  </View>
                </View>
              </View>
            </View>
          )
        ) : (
          /* ========================================================================= */
          /* 1B. PLAN PERFORMANCE (CONCISE EXECUTIVE SUMMARY)                         */
          /* ========================================================================= */
          !perf ? (
            <View style={styles.emptyState}>
              <Feather name="bar-chart-2" size={32} color="#6B7280" />
              <Text style={styles.emptyTitle}>No performance evaluation state detected yet</Text>
              <Text style={styles.emptySubtitle}>Live performance signals will populate once campaign execution commences.</Text>
            </View>
          ) : (
            <View style={styles.sectionGrid}>
              {/* Simulated Performance Disclosure Banner — ONLY rendered when demo historical cases are enabled */}
              {historicalCases.length > 0 && (
                <View
                  style={{
                    backgroundColor: 'rgba(139, 92, 246, 0.12)',
                    borderWidth: 1,
                    borderColor: 'rgba(139, 92, 246, 0.4)',
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <Feather name="info" size={16} color="#C4B5FD" style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#E9D5FF', letterSpacing: 0.6 }}>
                      SIMULATED DEMO OBSERVATION WINDOW · NON-CAUSAL ATTRIBUTION
                    </Text>
                    <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18, marginTop: 2 }}>
                      Performance figures below are synthetic demo telemetry. Post-action metrics reflect an observed timeline change during the follow-up window after Strategy v{perf.strategyRootVersion} deployment — not standalone proof that the strategic change alone caused the shift.
                    </Text>
                  </View>
                </View>
              )}

              {/* Executive Status Banner — Primary Results & Insights Focus */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardOverline}>
                      CURRENT STRATEGY • REPORTING TIMEZONE: {reportingTimezone}
                    </Text>
                    <Text style={styles.cardTitle}>{perf.strategyName || 'Active Campaign Strategy'}</Text>
                  </View>
                  <View style={[styles.statusBadge, perf.mode === 'OPTIMIZE' ? styles.statusOptimize : styles.statusBuild]}>
                    <Text style={styles.statusBadgeText}>Mode: {perf.mode} • Trend: {perf.recentTrend}</Text>
                  </View>
                </View>

                {perf.planSummary && (
                  <View style={{ marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#0F172A', borderRadius: 8, borderWidth: 1, borderColor: '#33415560' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B5CF6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Active Plan Summary</Text>
                    <Text style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 19 }}>{perf.planSummary}</Text>
                  </View>
                )}

                <Text style={[styles.currentRealityText, { marginTop: 12 }]}>{perf.currentReality}</Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: '#C4B5FD', fontWeight: '700' }]}>Strategy Root v{perf.strategyRootVersion}</Text>
                  <Text style={styles.metaText}>Confidence: {perf.confidence}</Text>
                  <Text style={styles.metaText}>Freshness: {perf.freshness}</Text>
                  <Text style={styles.metaText}>Timezone: {reportingTimezone}</Text>
                </View>
              </View>

              {/* Brief Success Confirmation Banners */}
              {baselineSuccessBanner && (
                <View
                  testID="baseline-success-banner"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    borderWidth: 1,
                    borderColor: '#10B981',
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Feather name="check-circle" size={16} color="#34D399" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#D1FAE5', flex: 1 }}>
                      {baselineSuccessBanner}
                    </Text>
                  </View>
                  <Pressable onPress={() => setBaselineSuccessBanner(null)}>
                    <Feather name="x" size={16} color="#6EE7B7" />
                  </Pressable>
                </View>
              )}

              {weeklySuccessBanner && (
                <View
                  testID="weekly-success-banner"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    borderWidth: 1,
                    borderColor: '#10B981',
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Feather name="check-circle" size={16} color="#34D399" />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#D1FAE5', flex: 1 }}>
                      {weeklySuccessBanner}
                    </Text>
                  </View>
                  <Pressable onPress={() => setWeeklySuccessBanner(null)}>
                    <Feather name="x" size={16} color="#6EE7B7" />
                  </Pressable>
                </View>
              )}

              {/* Separate Downstream Evaluation Processing / Retry Status (Never Reopens Answered Questions) */}
              {downstreamDeferredState && (
                <View
                  testID="downstream-deferred-banner"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.14)',
                    borderWidth: 1,
                    borderColor: '#F59E0B',
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#FBBF24', textTransform: 'uppercase' }}>
                      DOWNSTREAM EVALUATION DEFERRED • {downstreamDeferredState.sourceLabel.toUpperCase()} SAVED SAFELY
                    </Text>
                    <Text style={{ fontSize: 12, color: '#FDE68A', lineHeight: 18 }}>
                      Your {downstreamDeferredState.sourceLabel.toLowerCase()} answer is persisted and locked in. Downstream evaluation encountered a temporary issue ({downstreamDeferredState.errorMessage}).
                    </Text>
                  </View>
                  <Pressable
                    testID="retry-downstream-eval-btn"
                    onPress={handleRetryDownstreamEvaluation}
                    disabled={retryingDownstream}
                    style={{
                      backgroundColor: '#F59E0B',
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 8,
                      opacity: retryingDownstream ? 0.65 : 1,
                    }}
                  >
                    {retryingDownstream ? (
                      <ActivityIndicator size="small" color="#0F172A" />
                    ) : (
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F172A' }}>Retry Evaluation</Text>
                    )}
                  </Pressable>
                </View>
              )}

              {/* 1. ONE-TIME BUSINESS BASELINE — Shown ONLY while canonical baseline request is PENDING and unanswered */}
              {pendingClarification && answeredClarifications.length === 0 && (
                <View
                  testID="pending-baseline-card"
                  style={[styles.card, { borderColor: '#F59E0B', borderWidth: 1.5, backgroundColor: '#1E1B18' }]}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={[styles.cardOverline, { color: '#FBBF24' }]}>
                        ONE-TIME BUSINESS BASELINE • ACTION DUE
                      </Text>
                      <Text style={styles.cardTitle}>Calibrate Operating History & Baseline Traction</Text>
                    </View>
                    <View style={{ backgroundColor: '#F59E0B25', borderColor: '#F59E0B', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#FBBF24' }}>PENDING BASELINE</Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 13, color: '#FDE68A', lineHeight: 19 }}>
                    {pendingClarification.questionText}
                  </Text>
                  {pendingClarification.whyNeeded && (
                    <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18 }}>
                      Why this is needed: {pendingClarification.whyNeeded}
                    </Text>
                  )}

                  {renderBaselineFormFields(pendingClarification.id, false)}

                  <Text style={styles.metaText}>
                    Requested: {formatLocalDateTimeWithTz(pendingClarification.createdAt, reportingTimezone)} • Cadence: One-time baseline (48h reminder interval, max 2 reminders)
                  </Text>
                </View>
              )}

              {/* 2. WEEKLY CHECK-IN — Lifecycle-Driven Compact Summary (Before Due) vs Due Action Card (When Due) */}
              {weeklyInventory && (
                weeklyInventory.isDue ? (
                  /* 2A. PERIOD ENDED & FINAL FIGURES MISSING -> ONE CLEAR "WEEKLY CHECK-IN DUE" CARD */
                  <View
                    testID="weekly-checkin-due-card"
                    style={[styles.card, { borderColor: '#F59E0B', borderWidth: 1.5, backgroundColor: '#1E1B18' }]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={[styles.cardOverline, { color: '#FBBF24' }]}>
                          WEEKLY CHECK-IN DUE • WINDOW #{weeklyInventory.windowIndex ?? 0}
                        </Text>
                        <Text style={styles.cardTitle}>
                          Weekly check-in due ({formatLocalDateShort(weeklyInventory.periodStart, reportingTimezone)} – {formatLocalDateShort(weeklyInventory.periodEnd, reportingTimezone)})
                        </Text>
                      </View>
                      <View style={{ backgroundColor: '#F59E0B25', borderColor: '#F59E0B', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#FBBF24' }}>CHECK-IN DUE</Text>
                      </View>
                    </View>

                    <Text style={{ fontSize: 13, color: '#FDE68A', lineHeight: 19 }}>
                      Reporting period {formatLocalDateShort(weeklyInventory.periodStart, reportingTimezone)} → {formatLocalDateShort(weeklyInventory.periodEnd, reportingTimezone)} ({reportingTimezone}) has ended and final commercial figures are missing.
                    </Text>

                    {weeklyInventory.status === 'PARTIAL' && weeklyInventory.lastUpdatedThrough && (
                      <View style={{ backgroundColor: '#0F172A', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', gap: 3 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#38BDF8' }}>
                          Mid-week partial numbers on file — Updated through {formatLocalDateTimeWithTz(weeklyInventory.lastUpdatedThrough, reportingTimezone)}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#CBD5E1' }}>
                          {renderWeeklyMetricsSummaryText(weeklyInventory.userMetrics, weeklyInventory.currency)}
                        </Text>
                      </View>
                    )}

                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                      <Text style={styles.metaText}>
                        Due since: {formatLocalDateTimeWithTz(weeklyInventory.periodEnd, reportingTimezone)}
                      </Text>
                      <Pressable
                        testID="open-due-weekly-form-btn"
                        onPress={() => {
                          if (activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'due_final') {
                            setActiveWeeklyFormTarget(null);
                          } else {
                            handleOpenWeeklyForm(
                              {
                                inventoryId: weeklyInventory.inventoryId,
                                mode: 'due_final',
                                periodLabel: `${formatLocalDateShort(weeklyInventory.periodStart, reportingTimezone)} – ${formatLocalDateShort(weeklyInventory.periodEnd, reportingTimezone)}`,
                                windowIndex: weeklyInventory.windowIndex ?? 0,
                                currency: weeklyInventory.currency || 'USD',
                                periodEnd: weeklyInventory.periodEnd,
                              },
                              weeklyInventory.userMetrics
                            );
                          }
                        }}
                        style={{
                          backgroundColor: '#F59E0B',
                          paddingHorizontal: 14,
                          paddingVertical: 9,
                          borderRadius: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Feather
                          name={activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'due_final' ? 'chevron-up' : 'edit-3'}
                          size={14}
                          color="#0F172A"
                        />
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#0F172A' }}>
                          {activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'due_final'
                            ? 'Hide Check-In Form'
                            : 'Complete Weekly Check-In'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  /* 2B. BEFORE REPORTING PERIOD ENDS -> COMPACT SUMMARY CARD (NO AUTOMATIC FORM OR PREMATURE DUE NOTIFICATION) */
                  <View
                    testID="weekly-checkin-compact-summary-card"
                    style={[styles.card, { borderColor: '#334155', borderWidth: 1 }]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={[styles.cardOverline, { color: '#38BDF8' }]}>
                          WEEKLY CHECK-IN SCHEDULE • WINDOW #{weeklyInventory.windowIndex ?? 0}
                        </Text>
                        <Text style={styles.cardTitle}>
                          Current Reporting Period: {formatLocalDateShort(weeklyInventory.periodStart, reportingTimezone)} – {formatLocalDateShort(weeklyInventory.periodEnd, reportingTimezone)}
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: weeklyInventory.status === 'PARTIAL' ? '#10B98120' : '#1E293B',
                          borderColor: weeklyInventory.status === 'PARTIAL' ? '#10B981' : '#475569',
                          borderWidth: 1,
                          borderRadius: 6,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '800', color: weeklyInventory.status === 'PARTIAL' ? '#34D399' : '#94A3B8' }}>
                          {weeklyInventory.status === 'PARTIAL' ? 'PARTIAL SAVED' : 'IN PROGRESS'}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ gap: 4, flex: 1, minWidth: 240 }}>
                        <Text style={{ fontSize: 13, color: '#E2E8F0', fontWeight: '600' }}>
                          Next check-in due: {formatLocalDateTimeWithTz(weeklyInventory.nextCheckInDueAt || weeklyInventory.periodEnd, reportingTimezone)}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#94A3B8' }}>
                          Reporting timezone: {reportingTimezone} • Final check-in opens automatically at period end.
                        </Text>
                        {weeklyInventory.status === 'PARTIAL' && weeklyInventory.lastUpdatedThrough && (
                          <View
                            testID="weekly-partial-updated-through"
                            style={{ marginTop: 4, backgroundColor: '#0F172A', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#10B98150', gap: 2 }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#34D399' }}>
                              Updated through {formatLocalDateTimeWithTz(weeklyInventory.lastUpdatedThrough, reportingTimezone)}
                            </Text>
                            <Text style={{ fontSize: 12, color: '#CBD5E1' }}>
                              {renderWeeklyMetricsSummaryText(weeklyInventory.userMetrics, weeklyInventory.currency)}
                            </Text>
                          </View>
                        )}
                      </View>

                      <Pressable
                        testID="open-partial-weekly-form-btn"
                        onPress={() => {
                          if (activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'partial') {
                            setActiveWeeklyFormTarget(null);
                          } else {
                            handleOpenWeeklyForm(
                              {
                                inventoryId: weeklyInventory.inventoryId,
                                mode: 'partial',
                                periodLabel: `${formatLocalDateShort(weeklyInventory.periodStart, reportingTimezone)} – ${formatLocalDateShort(weeklyInventory.periodEnd, reportingTimezone)}`,
                                windowIndex: weeklyInventory.windowIndex ?? 0,
                                currency: weeklyInventory.currency || 'USD',
                                periodEnd: weeklyInventory.periodEnd,
                              },
                              weeklyInventory.userMetrics
                            );
                          }
                        }}
                        style={{
                          backgroundColor: '#1E293B',
                          borderWidth: 1,
                          borderColor: '#38BDF8',
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Feather
                          name={activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'partial' ? 'x' : 'edit-2'}
                          size={13}
                          color="#38BDF8"
                        />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#38BDF8' }}>
                          {activeWeeklyFormTarget?.inventoryId === weeklyInventory.inventoryId && activeWeeklyFormTarget?.mode === 'partial'
                            ? 'Close Form'
                            : 'Update this week’s numbers'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                )
              )}

              {/* ON-DEMAND WEEKLY CHECK-IN FORM (Partial Update, Due Final Submission, or History Edit) */}
              {activeWeeklyFormTarget && (
                <View
                  testID="weekly-checkin-active-form-card"
                  style={[
                    styles.card,
                    {
                      borderColor: activeWeeklyFormTarget.mode === 'due_final' ? '#F59E0B' : '#38BDF8',
                      borderWidth: 1.5,
                      backgroundColor: '#0F172A',
                    },
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text
                        style={[
                          styles.cardOverline,
                          { color: activeWeeklyFormTarget.mode === 'due_final' ? '#FBBF24' : '#38BDF8' },
                        ]}
                      >
                        {activeWeeklyFormTarget.mode === 'due_final'
                          ? `FINAL WEEKLY CHECK-IN • WINDOW #${activeWeeklyFormTarget.windowIndex}`
                          : activeWeeklyFormTarget.mode === 'history_edit'
                            ? `EDIT COMPLETED CHECK-IN • WINDOW #${activeWeeklyFormTarget.windowIndex}`
                            : `OPTIONAL MID-WEEK PARTIAL UPDATE • WINDOW #${activeWeeklyFormTarget.windowIndex}`}
                      </Text>
                      <Text style={styles.cardTitle}>
                        {activeWeeklyFormTarget.periodLabel} ({reportingTimezone})
                      </Text>
                    </View>
                    <Pressable
                      testID="close-weekly-form-btn"
                      onPress={() => {
                        setActiveWeeklyFormTarget(null);
                        setWeeklyFeedback('');
                      }}
                      style={{ padding: 6 }}
                    >
                      <Feather name="x" size={18} color="#94A3B8" />
                    </Pressable>
                  </View>

                  <Text style={{ fontSize: 12, color: '#CBD5E1', lineHeight: 18 }}>
                    {activeWeeklyFormTarget.mode === 'partial'
                      ? `Save progress numbers through right now. The final end-of-period check-in will remain scheduled for ${formatLocalDateTimeWithTz(activeWeeklyFormTarget.periodEnd, reportingTimezone)}.`
                      : activeWeeklyFormTarget.mode === 'history_edit'
                        ? 'Update the saved commercial figures for this completed period. Editing a historical period keeps it completed and will not reopen it as due.'
                        : 'Enter your final commercial outcomes (leads, conversions, revenue, ad spend) for this completed 7-day reporting period. Leave any unknown field blank or enter 0 for confirmed zero activity.'}
                  </Text>

                  {weeklyInventory?.automaticMetrics && activeWeeklyFormTarget.inventoryId === weeklyInventory.inventoryId && (
                    <View style={{ backgroundColor: '#1E293B', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', gap: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#38BDF8' }}>
                        AUTOMATIC SOCIAL TELEMETRY IN WINDOW ({activeWeeklyFormTarget.periodLabel})
                      </Text>
                      <Text style={{ fontSize: 12, color: '#E2E8F0' }}>
                        Posts in Window: {weeklyInventory.automaticMetrics.windowPostsPublished ?? weeklyInventory.automaticMetrics.postsObserved ?? 0} • Views: {(weeklyInventory.automaticMetrics.windowPublishedPostsViews ?? weeklyInventory.automaticMetrics.views ?? 0).toLocaleString()} • Engagement: {(weeklyInventory.automaticMetrics.windowPublishedPostsEngagement ?? weeklyInventory.automaticMetrics.engagement ?? 0).toLocaleString()}
                      </Text>
                    </View>
                  )}

                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 2 }}>
                          Leads / Inquiries (count)
                        </Text>
                        <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
                          Top-of-funnel demand capture
                        </Text>
                        <TextInput
                          testID="weekly-leads-input"
                          style={{ backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#F8FAFC', fontSize: 13 }}
                          value={weeklyLeadsInput}
                          onChangeText={setWeeklyLeadsInput}
                          placeholder="Blank if unknown (or 0)"
                          placeholderTextColor="#64748B"
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 2 }}>
                          Conversions / Sales (orders)
                        </Text>
                        <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
                          Offer-to-purchase conversion
                        </Text>
                        <TextInput
                          testID="weekly-conversions-input"
                          style={{ backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#F8FAFC', fontSize: 13 }}
                          value={weeklyConversionsInput}
                          onChangeText={setWeeklyConversionsInput}
                          placeholder="Blank if unknown (or 0)"
                          placeholderTextColor="#64748B"
                          keyboardType="numeric"
                        />
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 2 }}>
                          Revenue ({activeWeeklyFormTarget.currency || 'USD'})
                        </Text>
                        <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
                          Commercial return & ROAS
                        </Text>
                        <TextInput
                          testID="weekly-revenue-input"
                          style={{ backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#F8FAFC', fontSize: 13 }}
                          value={weeklyRevenueInput}
                          onChangeText={setWeeklyRevenueInput}
                          placeholder={`Blank if unknown (or 0.00 ${activeWeeklyFormTarget.currency || 'USD'})`}
                          placeholderTextColor="#64748B"
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 2 }}>
                          Ad Spend ({activeWeeklyFormTarget.currency || 'USD'})
                        </Text>
                        <Text style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
                          Paid vs organic traction
                        </Text>
                        <TextInput
                          testID="weekly-spend-input"
                          style={{ backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#F8FAFC', fontSize: 13 }}
                          value={weeklySpendInput}
                          onChangeText={setWeeklySpendInput}
                          placeholder={`Blank if unknown (or 0.00 ${activeWeeklyFormTarget.currency || 'USD'})`}
                          placeholderTextColor="#64748B"
                          keyboardType="numeric"
                        />
                      </View>
                    </View>

                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#F8FAFC', marginBottom: 4 }}>
                        Notes / Context (Optional)
                      </Text>
                      <TextInput
                        testID="weekly-notes-input"
                        style={{ backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#F8FAFC', fontSize: 13 }}
                        value={weeklyNotesInput}
                        onChangeText={setWeeklyNotesInput}
                        placeholder="Optional commercial notes"
                        placeholderTextColor="#64748B"
                      />
                    </View>

                    {weeklyFeedback ? (
                      <Text
                        testID="weekly-form-feedback"
                        style={{ fontSize: 12, color: weeklyFeedback.includes('saved') ? '#34D399' : '#F87171', fontWeight: '600' }}
                      >
                        {weeklyFeedback}
                      </Text>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        testID="weekly-cancel-btn"
                        onPress={() => {
                          setActiveWeeklyFormTarget(null);
                          setWeeklyFeedback('');
                        }}
                        disabled={weeklySubmitting}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 11,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#475569',
                          backgroundColor: '#1E293B',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#CBD5E1' }}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        testID="weekly-submit-btn"
                        onPress={handleSubmitWeeklyInventory}
                        disabled={weeklySubmitting}
                        style={{
                          flex: 1,
                          backgroundColor: activeWeeklyFormTarget.mode === 'due_final' ? '#F59E0B' : '#38BDF8',
                          borderRadius: 8,
                          paddingVertical: 11,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: weeklySubmitting ? 0.65 : 1,
                        }}
                      >
                        {weeklySubmitting ? (
                          <ActivityIndicator size="small" color="#0F172A" />
                        ) : (
                          <Text style={{ fontSize: 13, fontWeight: '800', color: '#0F172A' }}>
                            {activeWeeklyFormTarget.mode === 'due_final'
                              ? 'Submit Final Weekly Check-In'
                              : activeWeeklyFormTarget.mode === 'history_edit'
                                ? 'Save Historical Check-In Changes'
                                : 'Save This Week’s Partial Numbers'}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}

              {/* COLLAPSIBLE "BUSINESS BASELINE" SUMMARY WITH EXPLICIT EDIT ACTION */}
              {primaryAnsweredBaseline && (
                <View
                  testID="business-baseline-summary-card"
                  style={[styles.card, { borderColor: '#334155', borderWidth: 1 }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <Pressable
                      testID="toggle-baseline-summary-btn"
                      onPress={() => setIsBaselineSummaryExpanded((prev) => !prev)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
                    >
                      <Feather name="check-square" size={18} color="#10B981" />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.cardOverline, { color: '#34D399' }]}>
                          BUSINESS BASELINE • CONFIRMED ONE-TIME RECORD
                        </Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#F8FAFC' }}>
                          Business Baseline
                        </Text>
                        <Text style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }} numberOfLines={isBaselineSummaryExpanded ? undefined : 1}>
                          {primaryAnsweredBaseline.userAnswer}
                        </Text>
                      </View>
                      <Feather
                        name={isBaselineSummaryExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#94A3B8"
                      />
                    </Pressable>

                    <Pressable
                      testID="edit-baseline-btn"
                      onPress={() => {
                        if (editingBaselineId === primaryAnsweredBaseline.id) {
                          setEditingBaselineId(null);
                          setClarifyFeedback('');
                        } else {
                          populateBaselineInputsFromRecord(primaryAnsweredBaseline);
                          setEditingBaselineId(primaryAnsweredBaseline.id);
                          setIsBaselineSummaryExpanded(true);
                        }
                      }}
                      style={{
                        backgroundColor: '#1E293B',
                        borderWidth: 1,
                        borderColor: '#475569',
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Feather name="edit-2" size={13} color="#E2E8F0" />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#E2E8F0' }}>
                        {editingBaselineId === primaryAnsweredBaseline.id ? 'Close Edit' : 'Edit'}
                      </Text>
                    </Pressable>
                  </View>

                  {isBaselineSummaryExpanded && (
                    <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#334155', gap: 8 }}>
                      <View style={{ backgroundColor: '#0F172A', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', gap: 4 }}>
                        <Text style={{ fontSize: 12, color: '#E2E8F0', fontWeight: '600' }}>
                          {primaryAnsweredBaseline.userAnswer}
                        </Text>
                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                          Confirmed: {formatLocalDateTimeWithTz(primaryAnsweredBaseline.answeredAt, reportingTimezone)}
                          {primaryAnsweredBaseline.structuredAnswerParsed?._editedAt
                            ? ` • Last edited: ${formatLocalDateTimeWithTz(primaryAnsweredBaseline.structuredAnswerParsed._editedAt, reportingTimezone)}`
                            : ''}
                        </Text>
                      </View>
                    </View>
                  )}

                  {editingBaselineId === primaryAnsweredBaseline.id &&
                    renderBaselineFormFields(primaryAnsweredBaseline.id, true)}
                </View>
              )}

              {/* EXPANDABLE WEEKLY CHECK-IN HISTORY WITH VIEW / EDIT ACTIONS */}
              <View
                testID="weekly-history-card"
                style={[styles.card, { borderColor: '#334155', borderWidth: 1 }]}
              >
                <Pressable
                  testID="toggle-weekly-history-btn"
                  onPress={() => setIsWeeklyHistoryExpanded((prev) => !prev)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                    <Feather name="archive" size={18} color="#38BDF8" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardOverline, { color: '#38BDF8' }]}>
                        COMPLETED REPORTING PERIODS • {reportingTimezone}
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#F8FAFC' }}>
                        Weekly Check-In History ({completedWeeklyInventories.length})
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#94A3B8' }}>
                      {isWeeklyHistoryExpanded ? 'Hide History' : 'Expand History'}
                    </Text>
                    <Feather name={isWeeklyHistoryExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
                  </View>
                </Pressable>

                {isWeeklyHistoryExpanded && (
                  <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#334155', gap: 10 }}>
                    {completedWeeklyInventories.length === 0 ? (
                      <Text style={styles.mutedText}>
                        No completed 7-day check-in periods recorded yet. Completed periods will appear here with View and Edit actions.
                      </Text>
                    ) : (
                      completedWeeklyInventories.map((item: any) => {
                        const itemMetrics = item.userMetrics || {};
                        const periodText = `${formatLocalDateShort(item.periodStart, reportingTimezone)} – ${formatLocalDateShort(item.periodEnd, reportingTimezone)}`;
                        const isViewing = viewingHistoryId === item.id;
                        const isEditingThis =
                          activeWeeklyFormTarget?.inventoryId === item.id &&
                          activeWeeklyFormTarget?.mode === 'history_edit';

                        return (
                          <View
                            key={item.id}
                            testID={`weekly-history-row-${item.id}`}
                            style={{
                              backgroundColor: '#0F172A',
                              padding: 12,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: isEditingThis ? '#38BDF8' : '#334155',
                              gap: 8,
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                              <View style={{ flex: 1, minWidth: 200 }}>
                                <Text style={{ fontSize: 12, fontWeight: '800', color: '#F8FAFC' }}>
                                  Window #{item.windowIndex ?? 0} • {periodText}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }}>
                                  {renderWeeklyMetricsSummaryText(itemMetrics, item.currency || 'USD')}
                                </Text>
                                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                                  Submitted: {formatLocalDateTimeWithTz(item.submittedAt || item.completedAt, reportingTimezone)}
                                  {item.editedAt ? ` • Edited: ${formatLocalDateTimeWithTz(item.editedAt, reportingTimezone)}` : ''}
                                </Text>
                              </View>

                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Pressable
                                  testID={`view-weekly-history-${item.id}`}
                                  onPress={() => setViewingHistoryId(isViewing ? null : item.id)}
                                  style={{
                                    backgroundColor: '#1E293B',
                                    borderWidth: 1,
                                    borderColor: '#475569',
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: 6,
                                  }}
                                >
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#CBD5E1' }}>
                                    {isViewing ? 'Hide' : 'View'}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  testID={`edit-weekly-history-${item.id}`}
                                  onPress={() => {
                                    if (isEditingThis) {
                                      setActiveWeeklyFormTarget(null);
                                    } else {
                                      handleOpenWeeklyForm(
                                        {
                                          inventoryId: item.id,
                                          mode: 'history_edit',
                                          periodLabel: periodText,
                                          windowIndex: item.windowIndex ?? 0,
                                          currency: item.currency || 'USD',
                                          periodEnd: item.periodEnd,
                                        },
                                        itemMetrics
                                      );
                                    }
                                  }}
                                  style={{
                                    backgroundColor: '#1E293B',
                                    borderWidth: 1,
                                    borderColor: '#38BDF8',
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: 6,
                                  }}
                                >
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#38BDF8' }}>
                                    {isEditingThis ? 'Close Edit' : 'Edit'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>

                            {isViewing && (
                              <View
                                testID={`weekly-history-details-${item.id}`}
                                style={{
                                  marginTop: 4,
                                  paddingTop: 8,
                                  borderTopWidth: 1,
                                  borderTopColor: '#1E293B',
                                  gap: 4,
                                }}
                              >
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#38BDF8' }}>
                                  COMPLETED PERIOD BREAKDOWN ({reportingTimezone})
                                </Text>
                                <Text style={{ fontSize: 12, color: '#E2E8F0' }}>
                                  Leads / Inquiries: {itemMetrics.leads ?? 'Not specified'} • Conversions / Sales: {itemMetrics.conversions ?? 'Not specified'}
                                </Text>
                                <Text style={{ fontSize: 12, color: '#E2E8F0' }}>
                                  Revenue: {itemMetrics.revenue != null ? `${item.currency || 'USD'} ${itemMetrics.revenue}` : 'Not specified'} • Ad Spend: {itemMetrics.adSpend != null ? `${item.currency || 'USD'} ${itemMetrics.adSpend}` : 'Not specified'}
                                </Text>
                                {itemMetrics.notes && (
                                  <Text style={{ fontSize: 12, color: '#CBD5E1' }}>Notes: {itemMetrics.notes}</Text>
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })
                    )}
                  </View>
                )}
              </View>

              {/* Observed Positive Signals */}
              {perf.strongestSignals && perf.strongestSignals.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Feather name="trending-up" size={18} color="#10B981" />
                    <Text style={styles.cardTitle}>Observed Signals (Post-Action Window)</Text>
                  </View>
                  {perf.strongestSignals.map((sig, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 5 }}>
                      <Feather name="check-circle" size={14} color="#10B981" style={{ marginTop: 3 }} />
                      <Text style={{ fontSize: 13, color: '#E2E8F0', flex: 1, lineHeight: 19 }}>{sig}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Primary Bottleneck & Warnings */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="alert-triangle" size={18} color={perf.hasBottleneck ? '#EF4444' : '#10B981'} />
                  <Text style={styles.cardTitle}>Primary Bottleneck & Warnings</Text>
                </View>

                {perf.hasBottleneck ? (
                  <Pressable
                    style={({ hovered }: any) => [
                      styles.bottleneckCard,
                      hovered && styles.bottleneckCardHovered,
                    ]}
                    onPress={() => router.push(`/(tabs)/reasoning-evidence?tab=warnings&warningId=${perf.contextId}` as any)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bottleneckLabel}>Primary Bottleneck:</Text>
                      <Text style={styles.bottleneckValue}>{perf.primaryBottleneck}</Text>
                    </View>
                    <View style={styles.viewDetailAction}>
                      <Text style={[styles.viewDetailActionText, { color: '#F87171' }]}>Investigate in Reasoning</Text>
                      <Feather name="arrow-right" size={14} color="#F87171" />
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.healthyBanner}>
                    <Feather name="check-circle" size={16} color="#10B981" />
                    <Text style={styles.healthyBannerText}>No primary bottleneck identified (Baseline healthy / establishing)</Text>
                  </View>
                )}

                {perf.weakestSignals.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.cardSubtitle}>Observed Warning Areas (Click to investigate):</Text>
                    {perf.weakestSignals.map((ws, i) => (
                      <Pressable
                        key={i}
                        style={styles.weakSignalItem}
                        onPress={() => router.push(`/(tabs)/reasoning-evidence?tab=warnings&warningId=${perf.contextId}` as any)}
                      >
                        <Feather name="trending-down" size={14} color="#EF4444" style={{ marginTop: 2 }} />
                        <Text style={styles.weakSignalText}>{ws}</Text>
                        <Feather name="chevron-right" size={14} color="#EF4444" />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>

              {/* Active Channels & Proven Traction */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="radio" size={18} color="#8B5CF6" />
                  <Text style={styles.cardTitle}>Distribution Channels</Text>
                </View>
                {perf.activeChannels.length === 0 ? (
                  <Text style={styles.mutedText}>No active channels measured yet.</Text>
                ) : (
                  perf.activeChannels.map((ch, i) => (
                    <View key={i} style={styles.channelRow}>
                      <Text style={styles.channelName}>{ch.channel}</Text>
                      <View style={[
                        styles.channelPill,
                        ch.status === 'WINNING' ? styles.channelWinning : (ch.status === 'NOT_CONNECTED' ? styles.channelDisconnected : styles.channelUntested)
                      ]}>
                        <Text style={styles.channelPillText}>{ch.statusLabel || ch.status}</Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* Owned Channel Telemetry & Lifecycle Windows */}
              {perf.ownedChannelEngagement?.platformCounts && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Feather name="activity" size={18} color="#38BDF8" />
                    <Text style={styles.cardTitle}>Owned Channel Telemetry & Lifecycle Windows</Text>
                  </View>
                  <Text style={styles.metaText}>
                    Created: {perf.ownedChannelEngagement.campaignCreatedAt?.slice(0, 10) || '—'} · Activated: {perf.ownedChannelEngagement.campaignActivatedAt?.slice(0, 10) || '—'} · Active Plan v{perf.strategyRootVersion}: {perf.ownedChannelEngagement.activePlanActivatedAt?.slice(0, 10) || '—'}
                  </Text>
                  {Object.entries(perf.ownedChannelEngagement.platformCounts).map(([plat, pc]: [string, any]) => {
                    const isUnresolved = pc.identityStatus === 'UNRESOLVED' || pc.scrapeStatus === 'IDENTITY_UNRESOLVED';
                    return (
                      <View key={plat} style={{ backgroundColor: '#0F172A', borderRadius: 8, borderWidth: 1, borderColor: isUnresolved ? '#F59E0B' : '#334155', padding: 12, gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#F8FAFC', textTransform: 'uppercase' }}>
                            {plat} {pc.channelId ? `(${pc.channelId})` : pc.handle ? `(${pc.handle})` : ''}
                          </Text>
                          {pc.scrapeStatus && (
                            <Text style={{ fontSize: 11, fontWeight: '700', color: isUnresolved ? '#FBBF24' : '#34D399' }}>
                              {pc.scrapeStatus}
                            </Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 12, color: '#CBD5E1' }}>
                          Stored Historical: {pc.storedUniqueItems} · Account Total: {String(pc.accountTotalDisplay)} · Rolling 30d: {pc.rolling30dItems}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#94A3B8' }}>
                          Since Creation: {pc.postsSinceCreationItems} · Since Activation: {pc.postsSinceActivationItems} · Active Plan Window: {pc.activePlanWindowItems}
                        </Text>
                        {isUnresolved && (
                          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#332409', padding: 8, borderRadius: 6 }}>
                            <Text style={{ fontSize: 11, color: '#FDE68A', flex: 1 }}>
                              {pc.scrapeError || 'Saved LinkedIn URL is missing the company/profile slug.'}
                            </Text>
                            <Pressable
                              onPress={() => router.push('/(tabs)/settings' as any)}
                              style={{ backgroundColor: '#F59E0B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '800', color: '#0F172A' }}>Fix in Settings</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Automation & Refresh Schedule Health Card */}
              {scheduleHealth && (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Feather name="clock" size={18} color="#C4B5FD" />
                    <Text style={styles.cardTitle}>Automation & Refresh Schedules</Text>
                  </View>
                  {[
                    {
                      title: 'Owned-Channel Refresh',
                      cadence: scheduleHealth.ownedChannelRefresh?.cadenceLabel,
                      lastRun: scheduleHealth.ownedChannelRefresh?.lastSuccessAt,
                      nextDue: scheduleHealth.ownedChannelRefresh?.nextDueAt,
                      status: scheduleHealth.ownedChannelRefresh?.status,
                    },
                    {
                      title: 'Competitor Refresh',
                      cadence: scheduleHealth.competitorRefresh?.cadenceLabel,
                      lastRun: scheduleHealth.competitorRefresh?.lastSuccessAt,
                      nextDue: scheduleHealth.competitorRefresh?.nextDueAt,
                      status: scheduleHealth.competitorRefresh?.status,
                    },
                    {
                      title: 'Performance Evaluation',
                      cadence: scheduleHealth.performanceEvaluation?.cadenceLabel,
                      lastRun: scheduleHealth.performanceEvaluation?.lastSuccessAt,
                      nextDue: scheduleHealth.performanceEvaluation?.nextDueAt,
                      status: scheduleHealth.performanceEvaluation?.status,
                    },
                    {
                      title: 'Business Baseline Clarification',
                      cadence: scheduleHealth.baselineClarification?.cadenceLabel,
                      lastRun: scheduleHealth.baselineClarification?.lastSuccessAt,
                      nextDue: scheduleHealth.baselineClarification?.nextDueAt,
                      status: scheduleHealth.baselineClarification?.status,
                    },
                    {
                      title: '7-Day Period Business Metrics',
                      cadence: scheduleHealth.weeklyPeriodMetrics?.cadenceLabel,
                      lastRun: scheduleHealth.weeklyPeriodMetrics?.lastSuccessAt,
                      nextDue: scheduleHealth.weeklyPeriodMetrics?.nextDueAt,
                      status: scheduleHealth.weeklyPeriodMetrics?.status,
                    },
                    {
                      title: 'Unanswered Reminder Policy',
                      cadence: scheduleHealth.unansweredReminderPolicy?.cadenceLabel,
                      lastRun: scheduleHealth.unansweredReminderPolicy?.lastReminderAt,
                      nextDue: scheduleHealth.unansweredReminderPolicy?.nextDueAt,
                      status: scheduleHealth.unansweredReminderPolicy?.status,
                    },
                  ].map((item, idx) => (
                    <View key={idx} style={{ backgroundColor: '#0F172A', borderRadius: 8, borderWidth: 1, borderColor: '#334155', padding: 10, gap: 3 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#F8FAFC' }}>{item.title}</Text>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: item.status?.includes('ACTION') || item.status?.includes('WAITING') || item.status?.includes('DUE') ? '#FBBF24' : '#34D399' }}>
                          {item.status}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#C4B5FD' }}>Cadence: {item.cadence || '—'}</Text>
                      <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                        Last Run: {item.lastRun ? new Date(item.lastRun).toLocaleString() : 'None yet'} • Next Due: {item.nextDue ? new Date(item.nextDue).toLocaleString() : '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ===================================================================== */}
              {/* HISTORICAL PERFORMANCE LOOP EVALUATIONS (COMPLETED DEMO PERIOD)        */}
              {/* ===================================================================== */}
              {historicalCases.length > 0 && (
                <View style={{ gap: 14 }}>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#C4B5FD', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      Completed Period Evaluations ({historicalCases.length} Historical Actions · Strategy v1 Launch Period)
                    </Text>
                    <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 2, lineHeight: 18 }}>
                      SIMULATED DEMO TELEMETRY. Each case compares a baseline window with a later follow-up window. These are observed timeline changes, not causal proof, and they pre-date any pending Deep Reasoning change.
                    </Text>
                  </View>
                  {historicalCases.map((c) => (
                    <View key={c.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: c.outcomeColor }]}>
                      <View style={styles.cardHeader}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text style={styles.cardOverline}>CASE {c.caseNumber} · {c.strategyVersion} · {c.channel}</Text>
                          <Text style={[styles.cardTitle, { fontSize: 16 }]}>{c.title}</Text>
                        </View>
                        <View style={{ backgroundColor: c.outcomeColor + '22', borderColor: c.outcomeColor, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: c.outcomeColor }}>{c.outcomeBadgeLabel}</Text>
                        </View>
                      </View>

                      <View style={{ backgroundColor: 'rgba(139, 92, 246, 0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#E9D5FF', letterSpacing: 0.5 }}>{c.simulatedDisclosure}</Text>
                      </View>

                      <View style={{ gap: 4 }}>
                        <Text style={styles.cardSubtitle}>Historical action</Text>
                        <Text style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 19 }}>{c.historicalAction}</Text>
                        <Text style={[styles.cardSubtitle, { marginTop: 6 }]}>Hypothesis</Text>
                        <Text style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 19 }}>{c.hypothesis}</Text>
                      </View>

                      <View style={{ gap: 2 }}>
                        <Text style={styles.metaText}>Lane: {c.laneTitle}</Text>
                        <Text style={styles.metaText}>Originating event: {c.originatingEventLabel}</Text>
                        <Text style={styles.metaText}>Baseline: {c.baselinePeriod}</Text>
                        <Text style={styles.metaText}>Follow-up: {c.followUpPeriod}</Text>
                      </View>

                      {c.metrics.map((m: any, i: number) => (
                        <View key={i} style={{ backgroundColor: '#0F172A', borderRadius: 8, borderWidth: 1, borderColor: '#334155', padding: 12, gap: 4 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#F8FAFC' }}>{m.metricName}</Text>
                          <Text style={{ fontSize: 11, color: '#94A3B8' }}>Definition: {m.definition}</Text>
                          <Text style={{ fontSize: 12, color: '#CBD5E1' }}>Baseline: {m.baselineValue} ({m.baselineRawCounts})</Text>
                          <Text style={{ fontSize: 12, color: '#CBD5E1' }}>Follow-up: {m.followUpValue} ({m.followUpRawCounts})</Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: m.direction === 'POSITIVE' ? '#34D399' : m.direction === 'NEGATIVE' ? '#F87171' : '#94A3B8' }}>
                            Change: {m.calculatedDelta}
                          </Text>
                        </View>
                      ))}

                      <View style={{ gap: 4 }}>
                        <Text style={styles.cardSubtitle}>Interpretation</Text>
                        <Text style={{ fontSize: 13, color: '#E2E8F0', lineHeight: 19 }}>{c.interpretation}</Text>
                        <Text style={[styles.cardSubtitle, { marginTop: 6, color: '#F59E0B' }]}>Limitations</Text>
                        <Text style={{ fontSize: 12, color: '#FCD34D', lineHeight: 18 }}>{c.limitations}</Text>
                        <Text style={[styles.cardSubtitle, { marginTop: 6, color: '#38BDF8' }]}>Recommended next step</Text>
                        <Text style={{ fontSize: 13, color: '#BAE6FD', lineHeight: 19 }}>{c.recommendedNextStep}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 8,
  },
  tabButtonActive: {
    borderBottomColor: '#8B5CF6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tabTextActive: {
    color: '#F8FAFC',
  },
  warningBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  warningBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#94A3B8',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    marginVertical: 20,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  sectionGrid: {
    gap: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardOverline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  confidencePill: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  confidencePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4B5FD',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  detailLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  roleItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  roleText: {
    fontSize: 14,
    color: '#E2E8F0',
    flex: 1,
  },
  capabilityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  capabilityText: {
    fontSize: 13,
    color: '#CBD5E1',
    flex: 1,
  },
  provenanceGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  provenanceBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  provenanceCount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#10B981',
  },
  provenanceLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
  mutedText: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBuild: {
    backgroundColor: '#3B82F620',
  },
  statusOptimize: {
    backgroundColor: '#10B98120',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#93C5FD',
  },
  currentRealityText: {
    fontSize: 14,
    color: '#E2E8F0',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  metaText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  bottleneckCard: {
    backgroundColor: '#450A0A30',
    borderColor: '#7F1D1D',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer' as any,
  },
  bottleneckCardHovered: {
    borderColor: '#EF4444',
    backgroundColor: '#450A0A50',
  },
  bottleneckLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FCA5A5',
  },
  bottleneckValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F87171',
    marginTop: 2,
  },
  viewDetailAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewDetailActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  healthyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#064E3B20',
    borderColor: '#05966950',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  },
  healthyBannerText: {
    fontSize: 13,
    color: '#A7F3D0',
    fontWeight: '600',
  },
  weakSignalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    cursor: 'pointer' as any,
  },
  weakSignalText: {
    fontSize: 13,
    color: '#FCA5A5',
    flex: 1,
  },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#33415540',
  },
  channelName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  channelPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  channelWinning: {
    backgroundColor: '#065F46',
  },
  channelDisconnected: {
    backgroundColor: '#4B556350',
  },
  channelUntested: {
    backgroundColor: '#374151',
  },
  channelPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F8FAFC',
  },
});