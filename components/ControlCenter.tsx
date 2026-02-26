import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useColorScheme,
  Pressable,
  ActivityIndicator,
  Switch,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Colors from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { getApiUrl } from '@/lib/query-client';

type PanelState = 'loading' | 'empty' | 'error' | 'success';

interface GateItem {
  gateName: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  reason: string;
  lastCheckedAt: string;
}

interface AuditItem {
  id: string;
  eventType: string;
  riskLevel: string | null;
  executionStatus: string | null;
  details: Record<string, any>;
  decisionId: string | null;
  createdAt: string;
}

interface AIUsageData {
  summary: {
    used_tokens: number;
    remaining_tokens: number;
    budget_tokens: number;
    usage_pct: number;
    burn_rate: number;
    projected_exhaustion: string;
    total_calls: number;
    total_failures: number;
    failure_rate_pct: number;
    budget_status: string;
  };
  models: { model: string; call_count: number; total_tokens: number; avg_duration_ms: number; failure_count: number }[];
  endpoints: { endpoint: string; call_count: number; total_tokens: number; avg_duration_ms: number }[];
}

interface DecisionItem {
  id: string;
  eventType: string;
  decisionId: string | null;
  riskLevel: string | null;
  executionStatus: string | null;
  details: Record<string, any>;
  guardianApproved: boolean | null;
  createdAt: string;
}

interface JobItem {
  id: string;
  jobType: string;
  status: string;
  payload: Record<string, any>;
  result: Record<string, any> | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

async function apiFetch(path: string, method = 'GET', body?: any) {
  const url = getApiUrl(path);
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Request failed');
  return json.data;
}

export default function ControlCenter() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { advancedMode } = useApp();

  const [refreshing, setRefreshing] = useState(false);

  const [gates, setGates] = useState<GateItem[]>([]);
  const [gatesState, setGatesState] = useState<PanelState>('loading');
  const [gatesError, setGatesError] = useState('');
  const [autopilotOn, setAutopilotOn] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  const [autopilotToggling, setAutopilotToggling] = useState(false);
  const [emergencyStopping, setEmergencyStopping] = useState(false);

  const [planBinding, setPlanBinding] = useState<{
    state: 'CONNECTED' | 'BLOCKED';
    planId: string | null;
    planStatus: string | null;
    reason: string | null;
    lastDecisionAt: string | null;
    executionProgress: any | null;
  } | null>(null);

  const [aiUsage, setAiUsage] = useState<AIUsageData | null>(null);
  const [aiState, setAiState] = useState<PanelState>('loading');
  const [aiError, setAiError] = useState('');

  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditState, setAuditState] = useState<PanelState>('loading');
  const [auditError, setAuditError] = useState('');
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditModule, setAuditModule] = useState<string>('all');

  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [decisionsState, setDecisionsState] = useState<PanelState>('loading');
  const [decisionsError, setDecisionsError] = useState('');

  const [jobs, setJobs] = useState<{ running: JobItem[]; recent: JobItem[] }>({ running: [], recent: [] });
  const [jobsState, setJobsState] = useState<PanelState>('loading');
  const [jobsError, setJobsError] = useState('');

  const cardBg = isDark ? '#0F1419' : '#fff';
  const cardBorder = isDark ? '#1A2030' : '#E2E8E4';

  const loadPlanBinding = useCallback(async () => {
    try {
      const url = getApiUrl('/api/autopilot/status');
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.planBinding) {
          setPlanBinding(data.planBinding);
        }
      }
    } catch (e: any) {
      console.error('[ControlCenter] Plan binding fetch error:', e.message);
    }
  }, []);

  const loadGates = useCallback(async () => {
    try {
      setGatesState('loading');
      const data = await apiFetch('/api/audit/gates');
      setGates(data.gates || []);
      setAutopilotOn(data.accountState?.autopilotEnabled ?? false);
      setSafeMode(data.accountState?.safeMode ?? false);
      setGatesState(data.gates?.length ? 'success' : 'empty');
    } catch (e: any) {
      setGatesError(e.message);
      setGatesState('error');
    }
  }, []);

  const loadAIUsage = useCallback(async () => {
    try {
      setAiState('loading');
      const data = await apiFetch('/api/audit/ai-usage');
      setAiUsage(data);
      setAiState(data.summary ? 'success' : 'empty');
    } catch (e: any) {
      setAiError(e.message);
      setAiState('error');
    }
  }, []);

  const loadAudit = useCallback(async (reset = true) => {
    try {
      if (reset) setAuditState('loading');
      const params = new URLSearchParams();
      if (!reset && auditCursor) params.set('cursor', auditCursor);
      if (auditModule !== 'all') params.set('module', auditModule);
      params.set('limit', '20');
      const data = await apiFetch(`/api/audit/feed?${params.toString()}`);
      const items = data.items || [];
      if (reset) {
        setAuditItems(items);
      } else {
        setAuditItems(prev => [...prev, ...items]);
      }
      setAuditCursor(data.nextCursor || null);
      setAuditHasMore(data.hasMore ?? false);
      setAuditState(reset && items.length === 0 ? 'empty' : 'success');
    } catch (e: any) {
      setAuditError(e.message);
      setAuditState('error');
    }
  }, [auditModule, auditCursor]);

  const loadDecisions = useCallback(async () => {
    try {
      setDecisionsState('loading');
      const data = await apiFetch('/api/audit/decisions?limit=15');
      setDecisions(data.items || []);
      setDecisionsState(data.items?.length ? 'success' : 'empty');
    } catch (e: any) {
      setDecisionsError(e.message);
      setDecisionsState('error');
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      setJobsState('loading');
      const data = await apiFetch('/api/audit/jobs');
      setJobs({ running: data.running || [], recent: data.recent || [] });
      const total = (data.running?.length || 0) + (data.recent?.length || 0);
      setJobsState(total > 0 ? 'success' : 'empty');
    } catch (e: any) {
      setJobsError(e.message);
      setJobsState('error');
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadGates(), loadAIUsage(), loadAudit(true), loadDecisions(), loadJobs(), loadPlanBinding()]);
  }, [loadGates, loadAIUsage, loadAudit, loadDecisions, loadJobs, loadPlanBinding]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadAudit(true);
  }, [auditModule]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const handleAutopilotToggle = useCallback(async (value: boolean) => {
    try {
      setAutopilotToggling(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      const data = await apiFetch('/api/audit/autopilot', 'POST', { enabled: value });
      setAutopilotOn(data.autopilotOn);
      loadGates();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setAutopilotToggling(false);
    }
  }, [loadGates]);

  const handleEmergencyStop = useCallback(async () => {
    const doStop = async () => {
      try {
        setEmergencyStopping(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        await apiFetch('/api/audit/emergency-stop', 'POST', { reason: 'Manual emergency stop from Control Center' });
        Alert.alert('Emergency Stop Activated', 'All automated actions have been stopped. Safe mode is ON.');
        loadAll();
      } catch (e: any) {
        Alert.alert('Error', e.message);
      } finally {
        setEmergencyStopping(false);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Activate Emergency Stop? This will pause ALL automated actions immediately.')) {
        doStop();
      }
    } else {
      Alert.alert(
        'Emergency Stop',
        'This will pause ALL automated actions immediately. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Stop Everything', style: 'destructive', onPress: doStop },
        ]
      );
    }
  }, [loadAll]);

  const gateIcon = (status: string) => {
    if (status === 'PASS') return 'checkmark-circle';
    if (status === 'WARN') return 'warning';
    return 'close-circle';
  };
  const gateColor = (status: string) => {
    if (status === 'PASS') return '#10B981';
    if (status === 'WARN') return '#F59E0B';
    return '#EF4444';
  };

  const formatEventType = (et: string) => et.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const riskColor = (risk: string | null) => {
    if (!risk) return '#6B7280';
    const r = risk.toLowerCase();
    if (r === 'low') return '#10B981';
    if (r === 'medium') return '#F59E0B';
    return '#EF4444';
  };

  const renderPanelError = (msg: string, onRetry: () => void) => (
    <View style={[s.panelError, { backgroundColor: '#EF4444' + '10', borderColor: '#EF4444' + '30' }]}>
      <Ionicons name="alert-circle" size={20} color="#EF4444" />
      <Text style={[s.panelErrorText, { color: '#EF4444' }]}>{msg}</Text>
      <Pressable onPress={onRetry} style={s.retryBtn}>
        <Ionicons name="refresh" size={16} color="#EF4444" />
      </Pressable>
    </View>
  );

  const renderPanelEmpty = (icon: string, msg: string) => (
    <View style={s.panelEmpty}>
      <Ionicons name={icon as any} size={28} color={colors.textMuted} />
      <Text style={[s.panelEmptyText, { color: colors.textMuted }]}>{msg}</Text>
    </View>
  );

  const renderPanelLoading = () => (
    <View style={s.panelLoading}>
      <ActivityIndicator size="small" color={colors.accent} />
    </View>
  );

  const modules = ['all', 'strategic-core', 'ci', 'publishing', 'worker', 'gates', 'leads', 'meta'];

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
    >
      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.cardHeaderRow}>
          <View style={[s.iconCircle, { backgroundColor: autopilotOn ? '#8B5CF6' + '15' : '#EF4444' + '15' }]}>
            <Ionicons name="shield-checkmark" size={20} color={autopilotOn ? '#8B5CF6' : '#EF4444'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardHeaderLabel, { color: colors.textMuted }]}>MODE</Text>
            <Text style={[s.cardHeaderValue, { color: autopilotOn ? '#8B5CF6' : '#EF4444' }]}>
              {safeMode ? 'SAFE MODE' : autopilotOn ? 'Autopilot ON' : 'Autopilot OFF'}
            </Text>
          </View>
          <Switch
            value={autopilotOn}
            onValueChange={handleAutopilotToggle}
            disabled={autopilotToggling || safeMode}
            trackColor={{ false: '#EF4444' + '40', true: '#8B5CF6' + '60' }}
            thumbColor={autopilotOn ? '#8B5CF6' : '#EF4444'}
          />
        </View>
        {safeMode && (
          <View style={[s.safeModeBar, { backgroundColor: '#EF4444' + '12' }]}>
            <Ionicons name="warning" size={14} color="#EF4444" />
            <Text style={[s.safeModeText, { color: '#EF4444' }]}>Safe mode active — all execution paused</Text>
          </View>
        )}
      </View>

      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.sectionHeader}>
          <Ionicons name="link" size={16} color={planBinding?.state === 'CONNECTED' ? '#10B981' : '#F59E0B'} />
          <Text style={[s.sectionTitle, { color: colors.text }]}>Plan Binding</Text>
          <View style={[s.gateStatusBadge, { backgroundColor: (planBinding?.state === 'CONNECTED' ? '#10B981' : '#F59E0B') + '15' }]}>
            <Text style={[s.gateStatusText, { color: planBinding?.state === 'CONNECTED' ? '#10B981' : '#F59E0B' }]}>
              {planBinding?.state || 'LOADING'}
            </Text>
          </View>
        </View>
        {planBinding?.state === 'BLOCKED' ? (
          <View style={[s.safeModeBar, { backgroundColor: '#F59E0B12', marginTop: 8 }]}>
            <Ionicons name="alert-circle" size={16} color="#F59E0B" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#F59E0B', fontSize: 13, fontWeight: '700' }}>
                {planBinding.reason === 'NO_APPROVED_PLAN' ? 'No Approved Plan' : planBinding.reason || 'Blocked'}
              </Text>
              <Text style={{ color: '#92400E', fontSize: 11, marginTop: 2 }}>
                Autopilot requires an approved strategic plan. Go to Build The Plan to create and approve one.
              </Text>
            </View>
          </View>
        ) : planBinding?.state === 'CONNECTED' ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            <View style={[s.gateRow, { borderTopWidth: 0 }]}>
              <Ionicons name="document-text" size={16} color="#10B981" />
              <View style={{ flex: 1 }}>
                <Text style={[s.gateName, { color: colors.text }]}>Active Plan</Text>
                <Text style={[s.gateReason, { color: colors.textMuted }]}>{planBinding.planId?.slice(0, 12)}...</Text>
              </View>
              <View style={[s.gateStatusBadge, { backgroundColor: '#10B98115' }]}>
                <Text style={[s.gateStatusText, { color: '#10B981' }]}>{planBinding.planStatus}</Text>
              </View>
            </View>
            {planBinding.executionProgress && (
              <View style={[s.gateRow, { borderTopWidth: 1, borderTopColor: cardBorder }]}>
                <Ionicons name="bar-chart" size={16} color="#8B5CF6" />
                <View style={{ flex: 1 }}>
                  <Text style={[s.gateName, { color: colors.text }]}>Execution Progress</Text>
                  <Text style={[s.gateReason, { color: colors.textMuted }]}>
                    {planBinding.executionProgress.generated}/{planBinding.executionProgress.totalRequired} generated, {planBinding.executionProgress.draft} draft, {planBinding.executionProgress.failed} failed
                  </Text>
                </View>
                <Text style={{ color: '#8B5CF6', fontWeight: '800', fontSize: 16 }}>{planBinding.executionProgress.progressPercent}%</Text>
              </View>
            )}
            {planBinding.lastDecisionAt && (
              <View style={[s.gateRow, { borderTopWidth: 1, borderTopColor: cardBorder }]}>
                <Ionicons name="time" size={16} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.gateName, { color: colors.text }]}>Last Decision</Text>
                  <Text style={[s.gateReason, { color: colors.textMuted }]}>{timeAgo(planBinding.lastDecisionAt)}</Text>
                </View>
              </View>
            )}
          </View>
        ) : (
          renderPanelLoading()
        )}
      </View>

      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.sectionHeader}>
          <Ionicons name="lock-closed" size={16} color="#3B82F6" />
          <Text style={[s.sectionTitle, { color: colors.text }]}>System Gates</Text>
          <Text style={[s.sectionBadge, { color: colors.textMuted }]}>
            {gates.filter(g => g.status === 'PASS').length}/{gates.length}
          </Text>
        </View>
        {gatesState === 'loading' ? renderPanelLoading()
          : gatesState === 'error' ? renderPanelError(gatesError, loadGates)
          : gatesState === 'empty' ? renderPanelEmpty('lock-closed-outline', 'No gates configured')
          : gates.map((g, i) => (
            <View key={i} style={[s.gateRow, i > 0 && { borderTopWidth: 1, borderTopColor: cardBorder }]}>
              <Ionicons name={gateIcon(g.status) as any} size={18} color={gateColor(g.status)} />
              <View style={{ flex: 1 }}>
                <Text style={[s.gateName, { color: colors.text }]}>{g.gateName}</Text>
                <Text style={[s.gateReason, { color: colors.textMuted }]} numberOfLines={2}>{g.reason}</Text>
              </View>
              <View style={[s.gateStatusBadge, { backgroundColor: gateColor(g.status) + '15' }]}>
                <Text style={[s.gateStatusText, { color: gateColor(g.status) }]}>{g.status}</Text>
              </View>
            </View>
          ))
        }
      </View>

      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.sectionHeader}>
          <Ionicons name="wallet-outline" size={16} color="#4C9AFF" />
          <Text style={[s.sectionTitle, { color: colors.text }]}>AI Token Budget</Text>
        </View>
        {aiState === 'loading' ? renderPanelLoading()
          : aiState === 'error' ? renderPanelError(aiError, loadAIUsage)
          : aiState === 'empty' ? renderPanelEmpty('analytics-outline', 'No AI usage data')
          : aiUsage && (
            <View>
              <View style={s.budgetRow}>
                <Text style={[s.budgetLabel, { color: colors.textMuted }]}>Weekly Usage</Text>
                <Text style={[s.budgetValue, { color: aiUsage.summary.usage_pct > 80 ? '#EF4444' : '#10B981' }]}>
                  {aiUsage.summary.usage_pct}%
                </Text>
              </View>
              <View style={[s.budgetTrack, { backgroundColor: isDark ? '#1A2030' : '#E2E8E4' }]}>
                <View style={[s.budgetFill, {
                  width: `${Math.min(aiUsage.summary.usage_pct, 100)}%`,
                  backgroundColor: aiUsage.summary.usage_pct > 80 ? '#EF4444' : aiUsage.summary.usage_pct > 50 ? '#F59E0B' : '#10B981',
                }]} />
              </View>
              <Text style={[s.budgetDetail, { color: colors.textMuted }]}>
                {aiUsage.summary.used_tokens.toLocaleString()} / {aiUsage.summary.budget_tokens.toLocaleString()} tokens
              </Text>

              <View style={[s.statsGrid, { marginTop: 12 }]}>
                <View style={[s.statMini, { backgroundColor: isDark ? '#1A2030' : '#F5F7FA' }]}>
                  <Text style={[s.statMiniValue, { color: colors.text }]}>{aiUsage.summary.total_calls}</Text>
                  <Text style={[s.statMiniLabel, { color: colors.textMuted }]}>Calls</Text>
                </View>
                <View style={[s.statMini, { backgroundColor: isDark ? '#1A2030' : '#F5F7FA' }]}>
                  <Text style={[s.statMiniValue, { color: aiUsage.summary.failure_rate_pct > 20 ? '#EF4444' : colors.text }]}>
                    {aiUsage.summary.failure_rate_pct}%
                  </Text>
                  <Text style={[s.statMiniLabel, { color: colors.textMuted }]}>Failures</Text>
                </View>
                <View style={[s.statMini, { backgroundColor: isDark ? '#1A2030' : '#F5F7FA' }]}>
                  <Text style={[s.statMiniValue, { color: colors.text }]}>{aiUsage.summary.burn_rate.toLocaleString()}</Text>
                  <Text style={[s.statMiniLabel, { color: colors.textMuted }]}>Burn/wk</Text>
                </View>
              </View>

              {aiUsage.summary.budget_status === 'EXHAUSTED' && (
                <View style={[s.budgetAlert, { backgroundColor: '#EF4444' + '12' }]}>
                  <Ionicons name="alert-circle" size={16} color="#EF4444" />
                  <Text style={[s.budgetAlertText, { color: '#EF4444' }]}>Budget exhausted — AI calls blocked</Text>
                </View>
              )}

              {advancedMode && aiUsage.models.length > 0 && (
                <View style={{ marginTop: 12 }}>
                  <Text style={[s.subSectionTitle, { color: colors.text }]}>Model Breakdown</Text>
                  {aiUsage.models.map((m, i) => (
                    <View key={i} style={[s.modelRow, { borderColor: cardBorder }]}>
                      <Text style={[s.modelName, { color: colors.text }]}>{m.model}</Text>
                      <Text style={[s.modelStat, { color: colors.textMuted }]}>{m.call_count} calls</Text>
                      <Text style={[s.modelStat, { color: colors.textMuted }]}>{m.total_tokens.toLocaleString()} tok</Text>
                      {m.failure_count > 0 && (
                        <Text style={[s.modelStat, { color: '#EF4444' }]}>{m.failure_count} fail</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        }
      </View>

      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.sectionHeader}>
          <Ionicons name="time-outline" size={16} color="#A78BFA" />
          <Text style={[s.sectionTitle, { color: colors.text }]}>Recent Activity</Text>
        </View>
        {advancedMode && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {modules.map(mod => (
                <Pressable
                  key={mod}
                  onPress={() => { Haptics.selectionAsync(); setAuditModule(mod); }}
                  style={[s.filterChip, {
                    backgroundColor: auditModule === mod ? '#8B5CF6' + '20' : isDark ? '#1A2030' : '#F5F7FA',
                    borderColor: auditModule === mod ? '#8B5CF6' : 'transparent',
                  }]}
                >
                  <Text style={[s.filterChipText, { color: auditModule === mod ? '#8B5CF6' : colors.textMuted }]}>
                    {mod === 'all' ? 'All' : mod.replace(/-/g, ' ')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
        {auditState === 'loading' ? renderPanelLoading()
          : auditState === 'error' ? renderPanelError(auditError, () => loadAudit(true))
          : auditState === 'empty' ? renderPanelEmpty('document-text-outline', 'No audit events yet')
          : (
            <View>
              {auditItems.map((item, i) => (
                <Pressable
                  key={item.id}
                  onLongPress={async () => {
                    await Clipboard.setStringAsync(JSON.stringify(item, null, 2));
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                  style={[s.auditRow, i > 0 && { borderTopWidth: 1, borderTopColor: cardBorder }]}
                >
                  <View style={[s.auditDot, { backgroundColor: riskColor(item.riskLevel) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.auditEvent, { color: colors.text }]}>{formatEventType(item.eventType)}</Text>
                    {item.details?.competitorName && (
                      <Text style={[s.auditDetail, { color: colors.textMuted }]} numberOfLines={1}>
                        {item.details.competitorName}
                      </Text>
                    )}
                    {item.details?.title && (
                      <Text style={[s.auditDetail, { color: colors.textMuted }]} numberOfLines={1}>
                        {item.details.title}
                      </Text>
                    )}
                  </View>
                  <Text style={[s.auditTime, { color: colors.textMuted }]}>{timeAgo(item.createdAt)}</Text>
                </Pressable>
              ))}
              {auditHasMore && (
                <Pressable
                  onPress={() => loadAudit(false)}
                  style={[s.loadMoreBtn, { borderColor: cardBorder }]}
                >
                  <Text style={[s.loadMoreText, { color: '#8B5CF6' }]}>Load More</Text>
                </Pressable>
              )}
            </View>
          )
        }
      </View>

      <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <View style={s.sectionHeader}>
          <Ionicons name="git-branch-outline" size={16} color="#F59E0B" />
          <Text style={[s.sectionTitle, { color: colors.text }]}>Decisions</Text>
        </View>
        {decisionsState === 'loading' ? renderPanelLoading()
          : decisionsState === 'error' ? renderPanelError(decisionsError, loadDecisions)
          : decisionsState === 'empty' ? renderPanelEmpty('git-branch-outline', 'No autonomous decisions yet')
          : decisions.map((d, i) => (
            <View key={d.id} style={[s.decisionRow, i > 0 && { borderTopWidth: 1, borderTopColor: cardBorder }]}>
              <View style={s.decisionHeader}>
                <Text style={[s.decisionEvent, { color: colors.text }]}>{formatEventType(d.eventType)}</Text>
                {d.riskLevel && (
                  <View style={[s.riskBadge, { backgroundColor: riskColor(d.riskLevel) + '15' }]}>
                    <Text style={[s.riskBadgeText, { color: riskColor(d.riskLevel) }]}>{d.riskLevel}</Text>
                  </View>
                )}
              </View>
              {d.details?.title && (
                <Text style={[s.decisionDetail, { color: colors.textMuted }]} numberOfLines={2}>{d.details.title}</Text>
              )}
              {d.details?.reason && (
                <Text style={[s.decisionDetail, { color: colors.textMuted }]} numberOfLines={2}>{d.details.reason}</Text>
              )}
              <View style={s.decisionMeta}>
                {d.executionStatus && (
                  <View style={[s.statusPill, { backgroundColor: d.executionStatus === 'SUCCESS' ? '#10B981' + '15' : '#EF4444' + '15' }]}>
                    <Text style={[s.statusPillText, { color: d.executionStatus === 'SUCCESS' ? '#10B981' : '#EF4444' }]}>
                      {d.executionStatus}
                    </Text>
                  </View>
                )}
                <Text style={[s.decisionTime, { color: colors.textMuted }]}>{timeAgo(d.createdAt)}</Text>
              </View>
            </View>
          ))
        }
      </View>

      {advancedMode && (
        <View style={[s.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={s.sectionHeader}>
            <Ionicons name="hammer-outline" size={16} color="#06B6D4" />
            <Text style={[s.sectionTitle, { color: colors.text }]}>Worker & Jobs</Text>
          </View>
          {jobsState === 'loading' ? renderPanelLoading()
            : jobsState === 'error' ? renderPanelError(jobsError, loadJobs)
            : jobsState === 'empty' ? renderPanelEmpty('hammer-outline', 'No jobs running or recent')
            : (
              <View>
                {jobs.running.length > 0 && (
                  <View style={{ marginBottom: 10 }}>
                    <Text style={[s.subSectionTitle, { color: '#F59E0B' }]}>Running</Text>
                    {jobs.running.map(j => (
                      <View key={j.id} style={[s.jobRow, { borderColor: cardBorder }]}>
                        <ActivityIndicator size="small" color="#F59E0B" style={{ marginRight: 8 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.jobType, { color: colors.text }]}>{j.jobType}</Text>
                          <Text style={[s.jobTime, { color: colors.textMuted }]}>Started {timeAgo(j.createdAt)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                {jobs.recent.length > 0 && (
                  <View>
                    <Text style={[s.subSectionTitle, { color: colors.textMuted }]}>Recent</Text>
                    {jobs.recent.map(j => (
                      <View key={j.id} style={[s.jobRow, { borderColor: cardBorder }]}>
                        <Ionicons
                          name={j.status === 'completed' ? 'checkmark-circle' : 'close-circle'}
                          size={18}
                          color={j.status === 'completed' ? '#10B981' : '#EF4444'}
                          style={{ marginRight: 8 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[s.jobType, { color: colors.text }]}>{j.jobType}</Text>
                          {j.errorMessage && (
                            <Text style={[s.jobError, { color: '#EF4444' }]} numberOfLines={1}>{j.errorMessage}</Text>
                          )}
                          <Text style={[s.jobTime, { color: colors.textMuted }]}>{timeAgo(j.completedAt || j.createdAt)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          }
        </View>
      )}

      <Pressable
        onPress={handleEmergencyStop}
        disabled={emergencyStopping}
        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1, marginBottom: 40 }]}
      >
        <View style={s.emergencyBtn}>
          {emergencyStopping
            ? <ActivityIndicator size="small" color="#EF4444" />
            : <Ionicons name="stop-circle" size={20} color="#EF4444" />
          }
          <Text style={s.emergencyBtnText}>Emergency Stop</Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardHeaderValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  safeModeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  safeModeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  sectionBadge: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  panelLoading: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  panelEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  panelEmptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  panelError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  panelErrorText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  retryBtn: {
    padding: 4,
  },
  gateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  gateName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  gateReason: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  gateStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gateStatusText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  budgetLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  budgetValue: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  budgetTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  budgetFill: {
    height: '100%',
    borderRadius: 3,
  },
  budgetDetail: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  statMini: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  statMiniValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  statMiniLabel: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  budgetAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  budgetAlertText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  subSectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  modelName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  modelStat: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  auditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  auditEvent: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  auditDetail: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  auditTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
    borderTopWidth: 1,
  },
  loadMoreText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  decisionRow: {
    paddingVertical: 10,
  },
  decisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  decisionEvent: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  riskBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  decisionDetail: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 4,
    lineHeight: 17,
  },
  decisionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  decisionTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  jobType: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  jobError: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  jobTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EF4444',
    paddingVertical: 14,
  },
  emergencyBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#EF4444',
  },
});
