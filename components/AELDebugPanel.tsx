import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl } from '@/lib/query-client';

interface AELSection {
  label: string;
  key: string;
  icon: string;
}

const AEL_SECTIONS: AELSection[] = [
  { label: 'Root Causes', key: 'root_causes', icon: 'search-outline' },
  { label: 'Causal Chains', key: 'causal_chains', icon: 'git-merge-outline' },
  { label: 'Buying Barriers', key: 'buying_barriers', icon: 'hand-left-outline' },
  { label: 'Pain Types', key: 'pain_types', icon: 'heart-dislike-outline' },
  { label: 'Mechanism Gaps', key: 'mechanism_gaps', icon: 'construct-outline' },
  { label: 'Trust Gaps', key: 'trust_gaps', icon: 'shield-outline' },
  { label: 'Contradictions', key: 'contradiction_flags', icon: 'swap-horizontal-outline' },
  { label: 'Priority Ranking', key: 'priority_ranking', icon: 'podium-outline' },
  { label: 'Confidence', key: 'confidence_notes', icon: 'analytics-outline' },
];

function RootCauseCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const confColor = item.confidenceLevel === 'high' ? '#22c55e' : item.confidenceLevel === 'medium' ? '#f59e0b' : '#ef4444';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.insightHeader}>
        <View style={[s.confBadge, { backgroundColor: confColor + '22' }]}>
          <Text style={[s.confText, { color: confColor }]}>{item.confidenceLevel}</Text>
        </View>
      </View>
      <Text style={[s.surfaceLabel, { color: muted }]}>Surface signal:</Text>
      <Text style={[s.surfaceText, { color: text }]}>{item.surfaceSignal}</Text>
      <Text style={[s.deepLabel, { color: '#7c5cfc' }]}>Deep cause:</Text>
      <Text style={[s.deepText, { color: text }]}>{item.deepCause}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Reasoning:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.causalReasoning}</Text>
      {item.sourceData && <Text style={[s.evidenceText, { color: muted }]}>Evidence: {item.sourceData}</Text>}
    </View>
  );
}

function CausalChainCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const arrow = isDark ? '#7c5cfc' : '#6c4ce6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.chainRow}>
        <Text style={[s.chainStep, { color: '#ef4444' }]}>{item.pain}</Text>
        <Ionicons name="arrow-forward" size={12} color={arrow} />
        <Text style={[s.chainStep, { color: '#f59e0b' }]}>{item.cause}</Text>
        <Ionicons name="arrow-forward" size={12} color={arrow} />
        <Text style={[s.chainStep, { color: '#3b82f6' }]}>{item.impact}</Text>
      </View>
      <View style={s.chainRow}>
        <Ionicons name="arrow-forward" size={12} color={arrow} />
        <Text style={[s.chainStep, { color: '#8b5cf6' }]}>{item.behavior}</Text>
      </View>
      <Text style={[s.conversionText, { color: text }]}>Conversion effect: {item.conversionEffect}</Text>
    </View>
  );
}

function BarrierCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const sevColor = item.severity === 'blocking' ? '#ef4444' : item.severity === 'major' ? '#f59e0b' : '#3b82f6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.insightHeader}>
        <View style={[s.confBadge, { backgroundColor: sevColor + '22' }]}>
          <Text style={[s.confText, { color: sevColor }]}>{item.severity}</Text>
        </View>
      </View>
      <Text style={[s.deepText, { color: text, fontWeight: '600' as const }]}>{item.barrier}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Root cause:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.rootCause}</Text>
      <Text style={[s.reasonLabel, { color: '#7c5cfc' }]}>Buyer thinking:</Text>
      <Text style={[s.quoteText, { color: text }]}>"{item.userThinking}"</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Resolution needed:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.requiredResolution}</Text>
    </View>
  );
}

function PriorityCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const impactColor = item.impactOnConversion === 'critical' ? '#ef4444' : item.impactOnConversion === 'high' ? '#f59e0b' : '#3b82f6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.priorityRow}>
        <View style={[s.rankBadge, { backgroundColor: impactColor + '22' }]}>
          <Text style={[s.rankText, { color: impactColor }]}>#{item.rank}</Text>
        </View>
        <Text style={[s.deepText, { color: text, flex: 1 }]}>{item.insight}</Text>
      </View>
      <View style={s.tagRow}>
        <View style={[s.tag, { backgroundColor: impactColor + '15' }]}><Text style={[s.tagText, { color: impactColor }]}>{item.impactOnConversion}</Text></View>
        <View style={[s.tag, { backgroundColor: '#6c4ce622' }]}><Text style={[s.tagText, { color: '#7c5cfc' }]}>{item.frequency}</Text></View>
        <View style={[s.tag, { backgroundColor: '#22c55e22' }]}><Text style={[s.tagText, { color: '#22c55e' }]}>{item.actionability}</Text></View>
      </View>
    </View>
  );
}

function GenericInsightCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <Text style={[s.reasonText, { color: text }]}>
        {typeof item === 'string' ? item : JSON.stringify(item, null, 2)}
      </Text>
    </View>
  );
}

function PainTypeCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const sevColor = item.severity === 'critical' ? '#ef4444' : item.severity === 'moderate' ? '#f59e0b' : '#3b82f6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.insightHeader}>
        <View style={[s.confBadge, { backgroundColor: sevColor + '22' }]}><Text style={[s.confText, { color: sevColor }]}>{item.severity}</Text></View>
        <View style={[s.tag, { backgroundColor: '#7c5cfc22' }]}><Text style={[s.tagText, { color: '#7c5cfc' }]}>{item.painType}</Text></View>
      </View>
      <Text style={[s.deepText, { color: text }]}>{item.painPoint}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Underlying cause:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.underlyingCause}</Text>
      <Text style={[s.evidenceText, { color: muted }]}>Evidence: {item.evidence}</Text>
    </View>
  );
}

function MechanismGapCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const sevColor = item.gapSeverity === 'critical' ? '#ef4444' : item.gapSeverity === 'moderate' ? '#f59e0b' : '#3b82f6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={s.insightHeader}>
        <View style={[s.confBadge, { backgroundColor: sevColor + '22' }]}><Text style={[s.confText, { color: sevColor }]}>{item.gapSeverity}</Text></View>
      </View>
      <Text style={[s.deepText, { color: text, fontWeight: '600' as const }]}>{item.area}</Text>
      <Text style={[s.reasonLabel, { color: '#ef4444' }]}>User doesn't understand:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.whatUserDoesNotUnderstand}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Why it matters:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.whyItMatters}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Current belief: "{item.currentPerception}"</Text>
      <Text style={[s.reasonLabel, { color: '#22c55e' }]}>Needs to understand: "{item.idealPerception}"</Text>
    </View>
  );
}

function ContradictionCard({ item, isDark }: { item: any; isDark: boolean }) {
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const sevColor = item.severity === 'blocking' ? '#ef4444' : item.severity === 'concerning' ? '#f59e0b' : '#3b82f6';
  return (
    <View style={[s.insightCard, { backgroundColor: bg }]}>
      <View style={[s.confBadge, { backgroundColor: sevColor + '22', marginBottom: 4 }]}><Text style={[s.confText, { color: sevColor }]}>{item.severity}</Text></View>
      <Text style={[s.reasonLabel, { color: '#ef4444' }]}>Surface says:</Text>
      <Text style={[s.quoteText, { color: text }]}>"{item.surfaceSignal}"</Text>
      <Text style={[s.reasonLabel, { color: '#22c55e' }]}>Actually:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.actualReality}</Text>
      <Text style={[s.reasonLabel, { color: muted }]}>Why misleading:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.whyMisleading}</Text>
      <Text style={[s.deepLabel, { color: '#7c5cfc' }]}>Correct interpretation:</Text>
      <Text style={[s.reasonText, { color: text }]}>{item.correctInterpretation}</Text>
    </View>
  );
}

function renderInsightItem(key: string, item: any, index: number, isDark: boolean) {
  switch (key) {
    case 'root_causes': return <RootCauseCard key={index} item={item} isDark={isDark} />;
    case 'causal_chains': return <CausalChainCard key={index} item={item} isDark={isDark} />;
    case 'buying_barriers': return <BarrierCard key={index} item={item} isDark={isDark} />;
    case 'pain_types': return <PainTypeCard key={index} item={item} isDark={isDark} />;
    case 'mechanism_gaps': return <MechanismGapCard key={index} item={item} isDark={isDark} />;
    case 'contradiction_flags': return <ContradictionCard key={index} item={item} isDark={isDark} />;
    case 'priority_ranking': return <PriorityCard key={index} item={item} isDark={isDark} />;
    default: return <GenericInsightCard key={index} item={item} isDark={isDark} />;
  }
}

const DEPTH_GATE_ENGINES = ['positioning', 'differentiation', 'mechanism', 'offer', 'funnel', 'awareness', 'persuasion'];
const DEPTH_STATUS_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  DEPTH_PASSED: { color: '#22c55e', icon: 'checkmark-circle', label: 'PASSED' },
  DEPTH_FAILED: { color: '#ef4444', icon: 'close-circle', label: 'FAILED' },
  DEPTH_BLOCKED: { color: '#f59e0b', icon: 'ban', label: 'BLOCKED' },
  SIGNAL_PASSED: { color: '#22c55e', icon: 'shield-checkmark', label: 'SIGNAL OK' },
  SIGNAL_REQUIRED: { color: '#ef4444', icon: 'close-circle', label: 'SIGNALS MISSING' },
  SIGNAL_DRIFT: { color: '#ef4444', icon: 'warning', label: 'SIGNAL DRIFT' },
  SIGNAL_GROUNDING_FAILED: { color: '#ef4444', icon: 'alert-circle', label: 'GROUNDING FAILED' },
  SIGNAL_BLOCKED: { color: '#f59e0b', icon: 'ban', label: 'SIG BLOCKED' },
  REGENERATING: { color: '#3b82f6', icon: 'reload-circle', label: 'REGENERATING' },
  PENDING: { color: '#888', icon: 'ellipse-outline', label: 'PENDING' },
};

function DepthGateStatusPanel({ campaignId, isDark }: { campaignId: string; isDark: boolean }) {
  const [gateData, setGateData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';

  const fetchGateData = async () => {
    setLoading(true);
    try {
      const url = new URL('/api/orchestrator/latest/' + campaignId, getApiUrl());
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.hasRun && data.sections) {
        const gates: Record<string, any> = {};
        for (const section of data.sections) {
          if (DEPTH_GATE_ENGINES.includes(section.engineId)) {
            const output = section.output;
            const depthGateResult = output?.depthGateResult;

            let status = 'PENDING';
            if (section.engineId === 'positioning') {
              if (output?.status === 'SIGNAL_REQUIRED') status = 'SIGNAL_REQUIRED';
              else if (output?.status === 'SIGNAL_DRIFT') status = 'SIGNAL_DRIFT';
              else if (output?.status === 'COMPLETE' || output?.status === 'UNSTABLE') status = 'SIGNAL_PASSED';
              else if (section.status === 'SIGNAL_BLOCKED') status = 'SIGNAL_BLOCKED';
            } else if (output?.status === 'SIGNAL_GROUNDING_FAILED') {
              status = 'SIGNAL_GROUNDING_FAILED';
            } else if (section.status === 'SIGNAL_BLOCKED') {
              status = 'SIGNAL_BLOCKED';
            } else if (section.status === 'DEPTH_BLOCKED') {
              status = 'DEPTH_BLOCKED';
            } else if (output?.status === 'DEPTH_FAILED') {
              status = 'DEPTH_FAILED';
            } else if (depthGateResult?.passed) {
              status = 'DEPTH_PASSED';
            } else if (depthGateResult) {
              status = 'DEPTH_FAILED';
            }

            gates[section.engineId] = {
              status,
              depthGateResult,
              blockReason: section.blockReason || output?.statusMessage || null,
            };
          }
        }
        setGateData(gates);
      }
    } catch {}
    setLoading(false);
  };

  React.useEffect(() => { fetchGateData(); }, [campaignId]);

  if (loading) return <ActivityIndicator size="small" color="#7c5cfc" style={{ marginVertical: 8 }} />;
  if (!gateData || Object.keys(gateData).length === 0) return null;

  const allPassed = Object.values(gateData).every((g: any) => g.status === 'DEPTH_PASSED' || g.status === 'SIGNAL_PASSED');
  const anyFailed = Object.values(gateData).some((g: any) => g.status === 'DEPTH_FAILED' || g.status === 'DEPTH_BLOCKED' || g.status === 'SIGNAL_REQUIRED' || g.status === 'SIGNAL_DRIFT' || g.status === 'SIGNAL_GROUNDING_FAILED' || g.status === 'SIGNAL_BLOCKED');
  const overallColor = allPassed ? '#22c55e' : anyFailed ? '#ef4444' : '#f59e0b';

  return (
    <View style={[s.celContainer, { backgroundColor: bg, marginTop: 8 }]}>
      <View style={s.celHeader}>
        <Ionicons name="lock-closed-outline" size={14} color={overallColor} />
        <Text style={[s.celTitle, { color: text }]}>Depth & Signal Gate Status</Text>
        <View style={[s.confBadge, { backgroundColor: overallColor + '22' }]}>
          <Text style={[s.confText, { color: overallColor }]}>{allPassed ? 'ALL PASSED' : anyFailed ? 'GATE FAILURES' : 'PENDING'}</Text>
        </View>
      </View>
      {DEPTH_GATE_ENGINES.map((eng) => {
        const gate = gateData[eng];
        if (!gate) return null;
        const cfg = DEPTH_STATUS_CONFIG[gate.status] || DEPTH_STATUS_CONFIG.PENDING;
        const dgr = gate.depthGateResult;
        return (
          <View key={eng} style={[s.insightCard, { backgroundColor: isDark ? '#252542' : '#ffffff', marginTop: 4 }]}>
            <View style={s.insightHeader}>
              <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
              <Text style={[s.sectionLabel, { color: text, fontWeight: '600' as const, marginLeft: 4 }]}>{eng}</Text>
              <View style={[s.confBadge, { backgroundColor: cfg.color + '22', marginLeft: 'auto' as any }]}>
                <Text style={[s.confText, { color: cfg.color }]}>{cfg.label}</Text>
              </View>
            </View>
            {dgr && (
              <View style={{ marginTop: 4 }}>
                <Text style={[s.evidenceText, { color: muted }]}>
                  Attempts: {dgr.attempt}/{dgr.maxAttempts} | Score: {dgr.depthResult?.causalDepthScore !== undefined ? Math.round(dgr.depthResult.causalDepthScore * 100) + '%' : 'N/A'}
                </Text>
                {dgr.regenerationLog?.length > 0 && dgr.regenerationLog.map((log: string, i: number) => (
                  <Text key={i} style={[s.evidenceText, { color: gate.status === 'DEPTH_FAILED' ? '#ef4444' : muted, fontSize: 10 }]}>{log}</Text>
                ))}
              </View>
            )}
            {gate.blockReason && (
              <Text style={[s.evidenceText, { color: '#f59e0b', marginTop: 2 }]}>{gate.blockReason}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function CELCompliancePanel({ campaignId, isDark }: { campaignId: string; isDark: boolean }) {
  const [celData, setCelData] = useState<any>(null);
  const [celLoading, setCelLoading] = useState(false);
  const bg = isDark ? '#1e1e36' : '#f0f0ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';

  const fetchCEL = async () => {
    setCelLoading(true);
    try {
      const url = new URL('/api/cel/report/' + campaignId, getApiUrl());
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.success) setCelData(data);
    } catch {}
    setCelLoading(false);
  };

  React.useEffect(() => { fetchCEL(); }, [campaignId]);

  if (celLoading) return <ActivityIndicator size="small" color="#7c5cfc" style={{ marginVertical: 8 }} />;
  if (!celData?.report) return null;

  const report = celData.report;
  const themes = celData.causalThemes;
  const scoreColor = report.overallScore >= 0.8 ? '#22c55e' : report.overallScore >= 0.5 ? '#f59e0b' : '#ef4444';
  const passColor = report.overallPassed ? '#22c55e' : '#ef4444';

  return (
    <View style={[s.celContainer, { backgroundColor: bg }]}>
      <View style={s.celHeader}>
        <Ionicons name="shield-checkmark-outline" size={14} color={passColor} />
        <Text style={[s.celTitle, { color: text }]}>Causal Enforcement</Text>
        <View style={[s.confBadge, { backgroundColor: passColor + '22' }]}>
          <Text style={[s.confText, { color: passColor }]}>{report.overallPassed ? 'PASS' : 'FAIL'}</Text>
        </View>
        <View style={[s.confBadge, { backgroundColor: scoreColor + '22' }]}>
          <Text style={[s.confText, { color: scoreColor }]}>{Math.round(report.overallScore * 100)}%</Text>
        </View>
      </View>

      {themes?.primaryTheme && (
        <View style={{ marginTop: 4 }}>
          <Text style={[s.reasonLabel, { color: muted }]}>Primary causal theme:</Text>
          <Text style={[s.deepText, { color: '#7c5cfc' }]}>{themes.primaryTheme.replace(/_/g, ' ')}</Text>
        </View>
      )}

      {themes?.activeRules?.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={[s.reasonLabel, { color: muted }]}>Active constraint rules:</Text>
          {themes.activeRules.map((rule: any, i: number) => (
            <Text key={i} style={[s.reasonText, { color: text }]}>
              {i + 1}. {rule.description}
            </Text>
          ))}
        </View>
      )}

      {report.engineResults?.map((er: any, i: number) => {
        const depthScore = er.causalDepthScore;
        const hasDepth = depthScore !== undefined;
        const depthColor = depthScore >= 0.6 ? '#22c55e' : depthScore >= 0.3 ? '#f59e0b' : '#ef4444';
        return (
        <View key={i} style={[s.insightCard, { backgroundColor: isDark ? '#252542' : '#ffffff', marginTop: 6 }]}>
          <View style={s.insightHeader}>
            <Text style={[s.sectionLabel, { color: text, fontWeight: '600' as const }]}>{er.engineId}</Text>
            <View style={[s.confBadge, { backgroundColor: (er.passed ? '#22c55e' : '#ef4444') + '22' }]}>
              <Text style={[s.confText, { color: er.passed ? '#22c55e' : '#ef4444' }]}>{er.passed ? 'PASS' : 'FAIL'}</Text>
            </View>
            <Text style={[s.tagText, { color: muted }]}>{Math.round(er.score * 100)}%</Text>
            {hasDepth && (
              <View style={[s.confBadge, { backgroundColor: depthColor + '22' }]}>
                <Text style={[s.confText, { color: depthColor }]}>depth {Math.round(depthScore * 100)}%</Text>
              </View>
            )}
          </View>

          {hasDepth && er.depthDiagnostics && (
            <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {er.depthDiagnostics.hasRootCauseGrounding && (
                <View style={[s.tag, { backgroundColor: '#22c55e22' }]}>
                  <Text style={[s.tagText, { color: '#22c55e' }]}>root causes</Text>
                </View>
              )}
              {er.depthDiagnostics.hasCausalChainUsage && (
                <View style={[s.tag, { backgroundColor: '#22c55e22' }]}>
                  <Text style={[s.tagText, { color: '#22c55e' }]}>causal chains</Text>
                </View>
              )}
              {er.depthDiagnostics.hasBarrierResolution && (
                <View style={[s.tag, { backgroundColor: '#22c55e22' }]}>
                  <Text style={[s.tagText, { color: '#22c55e' }]}>barriers</Text>
                </View>
              )}
              {er.depthDiagnostics.hasBehavioralImpact && (
                <View style={[s.tag, { backgroundColor: '#22c55e22' }]}>
                  <Text style={[s.tagText, { color: '#22c55e' }]}>behavioral</Text>
                </View>
              )}
              {!er.depthDiagnostics.hasRootCauseGrounding && (
                <View style={[s.tag, { backgroundColor: '#ef444422' }]}>
                  <Text style={[s.tagText, { color: '#ef4444' }]}>no root causes</Text>
                </View>
              )}
              {!er.depthDiagnostics.hasCausalChainUsage && (
                <View style={[s.tag, { backgroundColor: '#ef444422' }]}>
                  <Text style={[s.tagText, { color: '#ef4444' }]}>no causal chains</Text>
                </View>
              )}
              {er.depthDiagnostics.genericTermCount > 0 && (
                <View style={[s.tag, { backgroundColor: '#f59e0b22' }]}>
                  <Text style={[s.tagText, { color: '#f59e0b' }]}>{er.depthDiagnostics.genericTermCount} generic</Text>
                </View>
              )}
              {er.depthDiagnostics.shallowPatternCount > 0 && (
                <View style={[s.tag, { backgroundColor: '#f59e0b22' }]}>
                  <Text style={[s.tagText, { color: '#f59e0b' }]}>{er.depthDiagnostics.shallowPatternCount} shallow</Text>
                </View>
              )}
            </View>
          )}

          {hasDepth && (er.rootCauseReferences > 0 || er.causalChainReferences > 0 || er.barrierReferences > 0) && (
            <View style={{ marginTop: 4 }}>
              <Text style={[s.evidenceText, { color: muted }]}>
                Refs: {er.rootCauseReferences} root causes, {er.causalChainReferences} chains, {er.barrierReferences} barriers
              </Text>
            </View>
          )}

          {er.violations?.length > 0 && er.violations.map((v: any, vi: number) => (
            <View key={vi} style={{ marginTop: 4 }}>
              <View style={s.tagRow}>
                <View style={[s.tag, { backgroundColor: (v.severity === 'blocking' ? '#ef4444' : v.severity === 'major' ? '#f59e0b' : '#3b82f6') + '22' }]}>
                  <Text style={[s.tagText, { color: v.severity === 'blocking' ? '#ef4444' : v.severity === 'major' ? '#f59e0b' : '#3b82f6' }]}>{v.severity}</Text>
                </View>
                <View style={[s.tag, { backgroundColor: '#7c5cfc22' }]}>
                  <Text style={[s.tagText, { color: '#7c5cfc' }]}>{v.violationType.replace(/_/g, ' ')}</Text>
                </View>
              </View>
              <Text style={[s.reasonText, { color: text, marginTop: 2 }]}>{v.details}</Text>
              <Text style={[s.evidenceText, { color: muted }]}>Root cause: {v.rootCause}</Text>
              <Text style={[s.evidenceText, { color: '#22c55e' }]}>Required: {v.requiredDirection}</Text>
            </View>
          ))}

          {er.violations?.length === 0 && (
            <Text style={[s.reasonText, { color: '#22c55e', marginTop: 2 }]}>All outputs aligned with causal root causes</Text>
          )}
        </View>
        );
      })}
    </View>
  );
}

export default function AELDebugPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { activeCampaign } = useCampaign();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aelData, setAelData] = useState<any>(null);
  const [aelVersion, setAelVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchAEL = async () => {
    if (!activeCampaign) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/ael/status/' + activeCampaign.id, getApiUrl());
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.hasCachedPackage && data.package) {
        setAelData(data.package);
        setAelVersion(data.version || null);
      } else {
        const buildUrl = new URL('/api/ael/build', getApiUrl());
        const buildRes = await fetch(buildUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: activeCampaign.id,
            accountId: activeCampaign.accountId || 'default',
          }),
        });
        const buildData = await buildRes.json();
        if (buildData.success) {
          setAelData(buildData.package);
          setAelVersion(buildData.version || null);
        } else {
          setError(buildData.message || 'Failed to build AEL');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !aelData && !loading) {
      fetchAEL();
    }
  };

  const getCount = (key: string) => {
    const data = aelData?.[key];
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    return 0;
  };

  const totalInsights = aelData
    ? AEL_SECTIONS.reduce((sum, sec) => sum + getCount(sec.key), 0)
    : 0;

  const bg = isDark ? '#1a1a2e' : '#f8f9ff';
  const cardBg = isDark ? '#252542' : '#ffffff';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const mutedColor = isDark ? '#888' : '#999';
  const accentColor = '#7c5cfc';
  const borderColor = isDark ? '#333' : '#e0e0e0';

  return (
    <View style={[s.container, { backgroundColor: bg, borderColor }]}>
      <Pressable onPress={toggleExpanded} style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name="flask-outline" size={16} color={accentColor} />
          <Text style={[s.headerText, { color: textColor }]}>Deep Analysis Layer</Text>
          {aelData && (
            <>
              <View style={[s.badge, { backgroundColor: accentColor + '22' }]}>
                <Text style={[s.badgeText, { color: accentColor }]}>v{aelVersion || 2}</Text>
              </View>
              <View style={[s.badge, { backgroundColor: totalInsights > 0 ? '#22c55e22' : '#f59e0b22' }]}>
                <Text style={[s.badgeText, { color: totalInsights > 0 ? '#22c55e' : '#f59e0b' }]}>{totalInsights} insights</Text>
              </View>
            </>
          )}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={mutedColor} />
      </Pressable>

      {expanded && (
        <View style={s.body}>
          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={accentColor} />
              <Text style={[s.loadingText, { color: mutedColor }]}>Running deep causal interpretation...</Text>
            </View>
          )}

          {error && (
            <View style={[s.errorRow, { backgroundColor: '#ff4d4f15' }]}>
              <Ionicons name="warning-outline" size={14} color="#ff4d4f" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          {aelData && (
            <ScrollView style={s.sectionList} nestedScrollEnabled>
              {aelData.generatedAt && (
                <Text style={[s.timestamp, { color: mutedColor }]}>
                  Generated: {new Date(aelData.generatedAt).toLocaleString()}
                </Text>
              )}

              {AEL_SECTIONS.map((sec) => {
                const count = getCount(sec.key);
                const isOpen = expandedSection === sec.key;
                const items = aelData[sec.key] || [];

                return (
                  <View key={sec.key}>
                    <Pressable
                      onPress={() => setExpandedSection(isOpen ? null : sec.key)}
                      style={[s.sectionRow, { backgroundColor: cardBg, borderColor }]}
                    >
                      <View style={s.sectionLeft}>
                        <Ionicons name={sec.icon as any} size={14} color={count > 0 ? accentColor : mutedColor} />
                        <Text style={[s.sectionLabel, { color: count > 0 ? textColor : mutedColor }]}>
                          {sec.label}
                        </Text>
                      </View>
                      <View style={s.sectionRight}>
                        <Text style={[s.sectionCount, { color: count > 0 ? accentColor : mutedColor }]}>
                          {count}
                        </Text>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={12} color={mutedColor} />
                      </View>
                    </Pressable>
                    {isOpen && items.length > 0 && (
                      <View style={s.insightList}>
                        {items.map((item: any, i: number) => renderInsightItem(sec.key, item, i, isDark))}
                      </View>
                    )}
                    {isOpen && items.length === 0 && (
                      <Text style={[s.emptyText, { color: mutedColor }]}>No data for this dimension</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          {!loading && !error && !aelData && (
            <Pressable onPress={fetchAEL} style={[s.fetchBtn, { backgroundColor: accentColor }]}>
              <Text style={s.fetchBtnText}>Run Deep Analysis</Text>
            </Pressable>
          )}

          {aelData && activeCampaign && (
            <CELCompliancePanel campaignId={activeCampaign.id} isDark={isDark} />
          )}

          {aelData && activeCampaign && (
            <DepthGateStatusPanel campaignId={activeCampaign.id} isDark={isDark} />
          )}

          {aelData && !loading && (
            <Pressable onPress={fetchAEL} style={[s.refreshBtn, { borderColor: accentColor }]}>
              <Ionicons name="refresh-outline" size={14} color={accentColor} />
              <Text style={[s.refreshBtnText, { color: accentColor }]}>Rebuild</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { borderWidth: 1, borderRadius: 10, marginHorizontal: 16, marginVertical: 8, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' },
  headerText: { fontSize: 13, fontWeight: '600' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  body: { paddingHorizontal: 12, paddingBottom: 12 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 6 },
  errorText: { color: '#ff4d4f', fontSize: 12 },
  sectionList: { maxHeight: 500 },
  timestamp: { fontSize: 10, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, marginBottom: 4 },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  sectionLabel: { fontSize: 12, fontWeight: '500' },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionCount: { fontSize: 12, fontWeight: '700' },
  insightList: { marginLeft: 8, marginBottom: 8 },
  insightCard: { padding: 10, borderRadius: 8, marginBottom: 6 },
  insightHeader: { flexDirection: 'row', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  confBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' as const },
  surfaceLabel: { fontSize: 10, fontWeight: '500', marginTop: 2 },
  surfaceText: { fontSize: 11, fontStyle: 'italic' as const, marginBottom: 4 },
  deepLabel: { fontSize: 10, fontWeight: '600', marginTop: 4 },
  deepText: { fontSize: 12, marginBottom: 2 },
  reasonLabel: { fontSize: 10, fontWeight: '500', marginTop: 4 },
  reasonText: { fontSize: 11, marginBottom: 2 },
  quoteText: { fontSize: 11, fontStyle: 'italic' as const, marginBottom: 2 },
  evidenceText: { fontSize: 10, fontStyle: 'italic' as const, marginTop: 4 },
  chainRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 4 },
  chainStep: { fontSize: 11, fontWeight: '600' },
  conversionText: { fontSize: 11, marginTop: 4, fontWeight: '500' },
  priorityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rankBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 12, fontWeight: '800' },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: 9, fontWeight: '600' },
  emptyText: { fontSize: 11, marginLeft: 20, marginBottom: 6, fontStyle: 'italic' as const },
  fetchBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  fetchBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, marginTop: 8 },
  refreshBtnText: { fontSize: 12, fontWeight: '600' },
  celContainer: { marginTop: 12, padding: 10, borderRadius: 8 },
  celHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  celTitle: { fontSize: 12, fontWeight: '600' },
});
