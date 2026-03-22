import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl, authFetch } from '@/lib/query-client';

interface EngineCheck {
  engineId: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'BLOCKED';
  receivedValidSignals: boolean;
  outputTraceable: boolean;
  signalMappingComplete: boolean;
  noRawDataPassthrough: boolean;
  alignedWithUpstream: boolean;
  leakageDetected: boolean;
  orphanOutputs: string[];
  details: string[];
}

interface AlignmentCheck {
  sourceEngine: string;
  targetEngine: string;
  aligned: boolean;
  alignmentScore: number;
  mismatches: string[];
}

interface IntegrityReport {
  reportId: string;
  timestamp: string;
  overallStatus: 'PASS' | 'FAIL' | 'PARTIAL';
  engineChecks: EngineCheck[];
  crossEngineAlignment: AlignmentCheck[];
  signalFlowVerified: boolean;
  traceabilityComplete: boolean;
  zeroLeakage: boolean;
  noOrphanOutputs: boolean;
  signalCoverageComplete: boolean;
  summary: string;
  failureReasons: string[];
  sglTraceToken: string | null;
}

function StatusBadge({ status, isDark }: { status: string; isDark: boolean }) {
  const colors: Record<string, { bg: string; text: string }> = {
    PASS: { bg: '#22c55e20', text: '#22c55e' },
    FAIL: { bg: '#ef444420', text: '#ef4444' },
    PARTIAL: { bg: '#f59e0b20', text: '#f59e0b' },
    SKIPPED: { bg: isDark ? '#33333340' : '#e5e7eb40', text: isDark ? '#888' : '#999' },
    BLOCKED: { bg: '#ef444410', text: '#f87171' },
  };
  const c = colors[status] || colors.SKIPPED;
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.text }]}>{status}</Text>
    </View>
  );
}

function CheckIcon({ passed, isDark }: { passed: boolean; isDark: boolean }) {
  return (
    <Ionicons
      name={passed ? 'checkmark-circle' : 'close-circle'}
      size={14}
      color={passed ? '#22c55e' : '#ef4444'}
    />
  );
}

function EngineCheckRow({ check, isDark }: { check: EngineCheck; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const bg = isDark ? '#1e1e36' : '#f8f8ff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';

  const engineLabels: Record<string, string> = {
    market_intelligence: 'Market Intelligence',
    audience: 'Audience',
    positioning: 'Positioning',
    differentiation: 'Differentiation',
    mechanism: 'Mechanism',
    offer: 'Offer',
    funnel: 'Funnel',
    awareness: 'Awareness',
    persuasion: 'Persuasion',
  };

  return (
    <Pressable onPress={() => setExpanded(!expanded)} style={[s.engineRow, { backgroundColor: bg }]}>
      <View style={s.engineRowHeader}>
        <Text style={[s.engineName, { color: text }]}>{engineLabels[check.engineId] || check.engineId}</Text>
        <StatusBadge status={check.status} isDark={isDark} />
      </View>
      {expanded && check.status !== 'SKIPPED' && (
        <View style={s.engineDetail}>
          <View style={s.checkRow}>
            <CheckIcon passed={check.receivedValidSignals} isDark={isDark} />
            <Text style={[s.checkLabel, { color: muted }]}>Valid Signals Received</Text>
          </View>
          <View style={s.checkRow}>
            <CheckIcon passed={check.outputTraceable} isDark={isDark} />
            <Text style={[s.checkLabel, { color: muted }]}>Output Traceable</Text>
          </View>
          <View style={s.checkRow}>
            <CheckIcon passed={check.signalMappingComplete} isDark={isDark} />
            <Text style={[s.checkLabel, { color: muted }]}>Signal Mapping Complete</Text>
          </View>
          <View style={s.checkRow}>
            <CheckIcon passed={check.noRawDataPassthrough} isDark={isDark} />
            <Text style={[s.checkLabel, { color: muted }]}>No Raw Data Leakage</Text>
          </View>
          <View style={s.checkRow}>
            <CheckIcon passed={check.alignedWithUpstream} isDark={isDark} />
            <Text style={[s.checkLabel, { color: muted }]}>Aligned with Upstream</Text>
          </View>
          {check.orphanOutputs.length > 0 && (
            <View style={s.orphanSection}>
              <Text style={[s.orphanTitle, { color: '#f59e0b' }]}>Orphan Outputs ({check.orphanOutputs.length})</Text>
              {check.orphanOutputs.map((o, i) => (
                <Text key={i} style={[s.orphanText, { color: muted }]} numberOfLines={1}>{o}</Text>
              ))}
            </View>
          )}
          {check.details.length > 0 && (
            <View style={s.detailSection}>
              {check.details.map((d, i) => (
                <Text key={i} style={[s.detailText, { color: muted }]} numberOfLines={2}>{d}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

export default function SystemIntegrityPanel() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { activeCampaignId } = useCampaign();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bg = isDark ? '#12121f' : '#ffffff';
  const text = isDark ? '#e0e0e0' : '#333';
  const muted = isDark ? '#999' : '#777';
  const border = isDark ? '#2a2a3d' : '#e5e7eb';
  const headerBg = isDark ? '#1a1a2e' : '#f0f0ff';

  useEffect(() => {
    if (!activeCampaignId) return;
    setLoading(true);
    setError(null);
    const url = new URL(`/api/system-integrity/${activeCampaignId}`, getApiUrl());
    authFetch(url.toString())
      .then(r => r.json())
      .then(data => {
        if (data.hasReport) {
          setReport(data.report);
        } else {
          setReport(null);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeCampaignId]);

  const statusIcon = report?.overallStatus === 'PASS' ? 'shield-checkmark' :
    report?.overallStatus === 'PARTIAL' ? 'warning' : 'shield';
  const statusColor = report?.overallStatus === 'PASS' ? '#22c55e' :
    report?.overallStatus === 'PARTIAL' ? '#f59e0b' : '#ef4444';

  return (
    <View style={[s.container, { backgroundColor: bg, borderColor: border }]}>
      <Pressable onPress={() => setCollapsed(!collapsed)} style={[s.header, { backgroundColor: headerBg }]}>
        <View style={s.headerLeft}>
          <Ionicons name="shield-checkmark-outline" size={18} color={report ? statusColor : muted} />
          <Text style={[s.title, { color: text }]}>System Integrity</Text>
          {report && <StatusBadge status={report.overallStatus} isDark={isDark} />}
        </View>
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={16} color={muted} />
      </Pressable>

      {!collapsed && (
        <View style={s.content}>
          {loading && <ActivityIndicator size="small" color={muted} />}
          {error && <Text style={[s.errorText, { color: '#ef4444' }]}>{error}</Text>}
          {!loading && !report && !error && (
            <Text style={[s.emptyText, { color: muted }]}>No integrity report available. Run the orchestrator to generate one.</Text>
          )}
          {report && (
            <>
              <View style={s.summaryGrid}>
                <View style={s.summaryItem}>
                  <CheckIcon passed={report.signalFlowVerified} isDark={isDark} />
                  <Text style={[s.summaryLabel, { color: muted }]}>Signal Flow</Text>
                </View>
                <View style={s.summaryItem}>
                  <CheckIcon passed={report.traceabilityComplete} isDark={isDark} />
                  <Text style={[s.summaryLabel, { color: muted }]}>Traceability</Text>
                </View>
                <View style={s.summaryItem}>
                  <CheckIcon passed={report.zeroLeakage} isDark={isDark} />
                  <Text style={[s.summaryLabel, { color: muted }]}>Zero Leakage</Text>
                </View>
                <View style={s.summaryItem}>
                  <CheckIcon passed={report.noOrphanOutputs} isDark={isDark} />
                  <Text style={[s.summaryLabel, { color: muted }]}>No Orphans</Text>
                </View>
                <View style={s.summaryItem}>
                  <CheckIcon passed={report.signalCoverageComplete} isDark={isDark} />
                  <Text style={[s.summaryLabel, { color: muted }]}>Coverage</Text>
                </View>
              </View>

              {report.sglTraceToken && (
                <Text style={[s.traceToken, { color: muted }]}>
                  Trace: {report.sglTraceToken}
                </Text>
              )}

              <Text style={[s.sectionTitle, { color: text }]}>Engine Checks</Text>
              {report.engineChecks.map((check) => (
                <EngineCheckRow key={check.engineId} check={check} isDark={isDark} />
              ))}

              {report.crossEngineAlignment.length > 0 && (
                <>
                  <Text style={[s.sectionTitle, { color: text, marginTop: 12 }]}>Cross-Engine Alignment</Text>
                  {report.crossEngineAlignment.map((a, i) => (
                    <View key={i} style={[s.alignmentRow, { backgroundColor: isDark ? '#1e1e36' : '#f8f8ff' }]}>
                      <View style={s.alignmentHeader}>
                        <Text style={[s.alignmentLabel, { color: muted }]}>
                          {a.sourceEngine} → {a.targetEngine}
                        </Text>
                        <CheckIcon passed={a.aligned} isDark={isDark} />
                      </View>
                      <View style={s.alignmentBar}>
                        <View style={[s.alignmentFill, { width: `${Math.min(100, a.alignmentScore * 100)}%`, backgroundColor: a.aligned ? '#22c55e' : '#ef4444' }]} />
                      </View>
                    </View>
                  ))}
                </>
              )}

              {report.failureReasons.length > 0 && (
                <>
                  <Text style={[s.sectionTitle, { color: '#ef4444', marginTop: 12 }]}>Failures</Text>
                  {report.failureReasons.map((r, i) => (
                    <Text key={i} style={[s.failureText, { color: '#f87171' }]} numberOfLines={2}>{r}</Text>
                  ))}
                </>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 16, marginHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '600' },
  content: { padding: 14, paddingTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  summaryItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryLabel: { fontSize: 12 },
  traceToken: { fontSize: 10, marginBottom: 10, fontFamily: 'monospace' },
  sectionTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  engineRow: { borderRadius: 8, padding: 10, marginBottom: 6 },
  engineRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  engineName: { fontSize: 13, fontWeight: '500' },
  engineDetail: { marginTop: 8, gap: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkLabel: { fontSize: 12 },
  orphanSection: { marginTop: 6 },
  orphanTitle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  orphanText: { fontSize: 10, paddingLeft: 8 },
  detailSection: { marginTop: 6 },
  detailText: { fontSize: 10, paddingLeft: 4 },
  alignmentRow: { borderRadius: 8, padding: 8, marginBottom: 4 },
  alignmentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  alignmentLabel: { fontSize: 12 },
  alignmentBar: { height: 4, backgroundColor: '#33333340', borderRadius: 2, overflow: 'hidden' },
  alignmentFill: { height: '100%', borderRadius: 2 },
  failureText: { fontSize: 11, marginBottom: 4, paddingLeft: 4 },
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  errorText: { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
});
