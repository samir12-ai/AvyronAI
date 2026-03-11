import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useCampaign } from '@/context/CampaignContext';
import { getApiUrl, safeApiJson } from '@/lib/query-client';
import { normalizeEngineSnapshot, isEngineReady } from '@/lib/engine-snapshot';
import { useColorScheme } from 'react-native';

interface DifferentiationPillar {
  name: string;
  description: string;
  uniqueness: number;
  proofability: number;
  trustAlignment: number;
  positioningAlignment: number;
  objectionCoverage: number;
  overallScore: number;
  territory: string;
  supportingProof: string[];
}

interface ClaimStructure {
  claim: string;
  territory: string;
  distinctiveness: number;
  believability: number;
  defensibility: number;
  relevance: number;
  overallScore: number;
  collisionRisk: number;
  proofBasis: string[];
}

interface ProofAsset {
  category: string;
  description: string;
  feasibility: number;
  impactScore: number;
}

interface TrustGap {
  objection: string;
  severity: number;
  relevanceToTerritory: number;
  priorityRank: number;
}

interface ClaimCollision {
  candidateClaim: string;
  competitorClaim: string;
  collisionRisk: number;
  competitorSource: string;
}

interface DifferentiationData {
  exists: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  differentiationPillars?: DifferentiationPillar[];
  proofArchitecture?: ProofAsset[];
  claimStructures?: ClaimStructure[];
  authorityMode?: { mode: string; rationale: string };
  mechanismFraming?: { name: string | null; description: string; supported: boolean; type: string };
  trustPriorityMap?: TrustGap[];
  claimScores?: { averageScore: number; highestCollision: number; totalClaims: number };
  collisionDiagnostics?: ClaimCollision[];
  stabilityResult?: { stable: boolean; failures: string[] };
  confidenceScore?: number;
  executionTimeMs?: number;
  engineVersion?: number;
  createdAt?: string;
  positioningSnapshotId?: string;
}

type DepStatus = 'ready' | 'not_ready' | 'loading';

export default function DifferentiationEngine() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const { selectedCampaignId: campaignId } = useCampaign();

  const [data, setData] = useState<DifferentiationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [miStatus, setMiStatus] = useState<DepStatus>('loading');
  const [audStatus, setAudStatus] = useState<DepStatus>('loading');
  const [posStatus, setPosStatus] = useState<DepStatus>('loading');
  const [posSnapshotId, setPosSnapshotId] = useState<string | null>(null);

  const checkDependencies = useCallback(async () => {
    if (!campaignId) return;
    setMiStatus('loading');
    setAudStatus('loading');
    setPosStatus('loading');

    try {
      const base = getApiUrl();
      const miRes = await fetch(new URL(`/api/ci/mi-v3/snapshot/${campaignId}`, base).toString());
      const miData = await safeApiJson(miRes);
      const miNorm = normalizeEngineSnapshot(miData, 'mi');
      setMiStatus(isEngineReady(miNorm, campaignId, miData.engineState) ? 'ready' : 'not_ready');

      const audRes = await fetch(new URL(`/api/audience-engine/latest?campaignId=${campaignId}`, base).toString());
      const audData = await safeApiJson(audRes);
      setAudStatus(audData && (audData.id || audData.exists) ? 'ready' : 'not_ready');

      const posRes = await fetch(new URL(`/api/positioning-engine/latest?campaignId=${campaignId}`, base).toString());
      const posData = await safeApiJson(posRes);
      const posReady = posData && posData.id && (posData.status === 'COMPLETE' || posData.status === 'UNSTABLE');
      setPosStatus(posReady ? 'ready' : 'not_ready');
      if (posReady) setPosSnapshotId(posData.id);
    } catch {
      setMiStatus('not_ready');
      setAudStatus('not_ready');
      setPosStatus('not_ready');
    }
  }, [campaignId]);

  const fetchLatest = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const base = getApiUrl();
      const res = await fetch(new URL(`/api/differentiation-engine/latest?campaignId=${campaignId}`, base).toString());
      const json = await safeApiJson(res);
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (campaignId) {
      checkDependencies();
      fetchLatest();
    }
  }, [campaignId, checkDependencies, fetchLatest]);

  const runAnalysis = async () => {
    if (!campaignId || !posSnapshotId) return;
    setAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const base = getApiUrl();
      const res = await fetch(new URL('/api/differentiation-engine/analyze', base).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, positioningSnapshotId: posSnapshotId }),
      });
      const json = await safeApiJson(res);
      if (!res.ok) {
        Alert.alert('Analysis Failed', json.message || json.error || 'Unknown error');
        return;
      }
      await fetchLatest();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const allReady = miStatus === 'ready' && audStatus === 'ready' && posStatus === 'ready';

  const renderDepChip = (label: string, status: DepStatus) => {
    const chipColor = status === 'ready' ? '#10B981' : status === 'loading' ? '#F59E0B' : '#EF4444';
    const icon = status === 'ready' ? 'checkmark-circle' : status === 'loading' ? 'time' : 'close-circle';
    return (
      <View style={[styles.depChip, { borderColor: chipColor + '40', backgroundColor: chipColor + '12' }]}>
        <Ionicons name={icon as any} size={13} color={chipColor} />
        <Text style={[styles.depChipText, { color: chipColor }]}>{label}</Text>
      </View>
    );
  };

  const renderScore = (label: string, value: number, color: string) => (
    <View style={styles.scoreRow}>
      <Text style={[styles.scoreLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.scoreBarBg}>
        <View style={[styles.scoreBarFill, { width: `${Math.round(value * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.scoreValue, { color: colors.text }]}>{(value * 100).toFixed(0)}%</Text>
    </View>
  );

  if (!campaignId) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.card }]}>
        <Ionicons name="layers-outline" size={32} color={colors.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Select a campaign to use the Differentiation Engine</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#8B5CF620', '#6366F110', 'transparent']}
        style={styles.headerGradient}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Differentiation Engine V3</Text>
            <Text style={[styles.headerSub, { color: colors.textSecondary }]}>12-layer proof-backed differentiation</Text>
          </View>
          {data?.confidenceScore != null && (
            <View style={[styles.confidenceBadge, { backgroundColor: data.confidenceScore > 0.6 ? '#10B981' : data.confidenceScore > 0.3 ? '#F59E0B' : '#EF4444' }]}>
              <Text style={styles.confidenceText}>{(data.confidenceScore * 100).toFixed(0)}%</Text>
            </View>
          )}
        </View>

        <View style={styles.depRow}>
          {renderDepChip('MI v3', miStatus)}
          {renderDepChip('Audience v3', audStatus)}
          {renderDepChip('Positioning v3', posStatus)}
        </View>

        <Pressable
          onPress={runAnalysis}
          disabled={!allReady || analyzing}
          style={[
            styles.runBtn,
            { backgroundColor: allReady ? '#8B5CF6' : colors.cardBorder, opacity: allReady && !analyzing ? 1 : 0.5 },
          ]}
        >
          {analyzing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.runBtnText}>Run Differentiation Analysis</Text>
            </>
          )}
        </Pressable>
      </LinearGradient>

      {loading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />}

      {data?.exists && data.status && (
        <View style={styles.results}>
          <View style={[styles.statusBar, { backgroundColor: data.status === 'COMPLETE' ? '#10B98118' : data.status === 'UNSTABLE' ? '#F59E0B18' : '#EF444418' }]}>
            <Ionicons
              name={data.status === 'COMPLETE' ? 'checkmark-circle' : data.status === 'UNSTABLE' ? 'warning' : 'alert-circle'}
              size={16}
              color={data.status === 'COMPLETE' ? '#10B981' : data.status === 'UNSTABLE' ? '#F59E0B' : '#EF4444'}
            />
            <Text style={[styles.statusText, { color: data.status === 'COMPLETE' ? '#10B981' : data.status === 'UNSTABLE' ? '#F59E0B' : '#EF4444' }]}>
              {data.status}{data.statusMessage ? ` — ${data.statusMessage}` : ''}
            </Text>
          </View>

          {data.authorityMode && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#8B5CF6" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Authority Mode</Text>
              </View>
              <View style={[styles.authorityBadge, { backgroundColor: '#8B5CF620' }]}>
                <Text style={[styles.authorityMode, { color: '#8B5CF6' }]}>{data.authorityMode.mode?.replace(/_/g, ' ')?.toUpperCase()}</Text>
              </View>
              <Text style={[styles.rationale, { color: colors.textSecondary }]}>{data.authorityMode.rationale}</Text>
            </View>
          )}

          {data.differentiationPillars && data.differentiationPillars.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="layers-outline" size={16} color="#10B981" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Differentiation Pillars</Text>
              </View>
              {data.differentiationPillars.map((p, i) => (
                <View key={i} style={[styles.pillarCard, { borderColor: colors.cardBorder }]}>
                  <Text style={[styles.pillarName, { color: colors.text }]}>{p.name}</Text>
                  <Text style={[styles.pillarDesc, { color: colors.textSecondary }]}>{p.description}</Text>
                  {renderScore('Uniqueness', p.uniqueness, '#10B981')}
                  {renderScore('Proofability', p.proofability, '#3B82F6')}
                  {renderScore('Trust', p.trustAlignment, '#8B5CF6')}
                  {renderScore('Positioning', p.positioningAlignment, '#F59E0B')}
                  {renderScore('Overall', p.overallScore, '#EC4899')}
                </View>
              ))}
            </View>
          )}

          {data.claimStructures && data.claimStructures.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="bulb-outline" size={16} color="#F59E0B" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Claim Structures</Text>
              </View>
              {data.claimStructures.map((c, i) => (
                <View key={i} style={[styles.claimCard, { borderColor: colors.cardBorder }]}>
                  <Text style={[styles.claimText, { color: colors.text }]}>{c.claim}</Text>
                  <View style={styles.claimMeta}>
                    {renderScore('Distinctiveness', c.distinctiveness, '#10B981')}
                    {renderScore('Believability', c.believability, '#3B82F6')}
                    {renderScore('Defensibility', c.defensibility, '#8B5CF6')}
                    {renderScore('Overall', c.overallScore, '#EC4899')}
                  </View>
                  {c.collisionRisk > 0.5 && (
                    <View style={styles.collisionWarn}>
                      <Ionicons name="warning" size={12} color="#EF4444" />
                      <Text style={styles.collisionWarnText}>Collision risk: {(c.collisionRisk * 100).toFixed(0)}%</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {data.proofArchitecture && data.proofArchitecture.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="document-text-outline" size={16} color="#3B82F6" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Proof Architecture</Text>
              </View>
              {data.proofArchitecture.map((p, i) => (
                <View key={i} style={[styles.proofRow, { borderColor: colors.cardBorder }]}>
                  <View style={[styles.proofCat, { backgroundColor: '#3B82F620' }]}>
                    <Text style={styles.proofCatText}>{p.category.replace(/_/g, ' ')}</Text>
                  </View>
                  <Text style={[styles.proofDesc, { color: colors.textSecondary }]}>{p.description}</Text>
                  {renderScore('Impact', p.impactScore, '#3B82F6')}
                </View>
              ))}
            </View>
          )}

          {data.mechanismFraming && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="cog-outline" size={16} color="#EC4899" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Mechanism Framing</Text>
              </View>
              <View style={[styles.mechBadge, { backgroundColor: data.mechanismFraming.supported ? '#10B98120' : '#EF444420' }]}>
                <Ionicons name={data.mechanismFraming.supported ? 'checkmark-circle' : 'close-circle'} size={14} color={data.mechanismFraming.supported ? '#10B981' : '#EF4444'} />
                <Text style={{ color: data.mechanismFraming.supported ? '#10B981' : '#EF4444', fontSize: 12, fontWeight: '600', marginLeft: 4 }}>
                  {data.mechanismFraming.type?.replace(/_/g, ' ')?.toUpperCase() || 'NONE'}
                </Text>
              </View>
              <Text style={[styles.mechDesc, { color: colors.textSecondary }]}>{data.mechanismFraming.description}</Text>
            </View>
          )}

          {data.trustPriorityMap && data.trustPriorityMap.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="heart-outline" size={16} color="#EF4444" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Trust Priority Map</Text>
              </View>
              {data.trustPriorityMap.slice(0, 5).map((g, i) => (
                <View key={i} style={[styles.trustRow, { borderColor: colors.cardBorder }]}>
                  <View style={styles.trustRank}>
                    <Text style={styles.trustRankText}>#{g.priorityRank}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.trustObj, { color: colors.text }]}>{g.objection}</Text>
                    {renderScore('Severity', g.severity, '#EF4444')}
                  </View>
                </View>
              ))}
            </View>
          )}

          {data.collisionDiagnostics && data.collisionDiagnostics.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="git-compare-outline" size={16} color="#EF4444" />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Collision Diagnostics</Text>
              </View>
              {data.collisionDiagnostics.slice(0, 5).map((c, i) => (
                <View key={i} style={[styles.collisionRow, { borderColor: colors.cardBorder }]}>
                  <Text style={[styles.collisionCandidate, { color: colors.text }]}>{c.candidateClaim}</Text>
                  <View style={styles.collisionArrow}>
                    <Ionicons name="swap-horizontal" size={14} color="#EF4444" />
                    <Text style={styles.collisionRiskText}>{(c.collisionRisk * 100).toFixed(0)}%</Text>
                  </View>
                  <Text style={[styles.collisionComp, { color: colors.textMuted }]}>{c.competitorClaim}</Text>
                </View>
              ))}
            </View>
          )}

          {data.stabilityResult && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="shield-outline" size={16} color={data.stabilityResult.stable ? '#10B981' : '#EF4444'} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Stability Guard</Text>
              </View>
              <View style={[styles.stabilityBadge, { backgroundColor: data.stabilityResult.stable ? '#10B98118' : '#EF444418' }]}>
                <Text style={{ color: data.stabilityResult.stable ? '#10B981' : '#EF4444', fontWeight: '600', fontSize: 12 }}>
                  {data.stabilityResult.stable ? 'STABLE' : 'UNSTABLE'}
                </Text>
              </View>
              {data.stabilityResult.failures?.map((f: string, i: number) => (
                <Text key={i} style={[styles.failureText, { color: '#EF4444' }]}>• {f}</Text>
              ))}
            </View>
          )}

          {data.executionTimeMs != null && (
            <Text style={[styles.execTime, { color: colors.textMuted }]}>
              Engine V{data.engineVersion} • {data.executionTimeMs}ms • {data.createdAt ? new Date(data.createdAt).toLocaleDateString() : ''}
            </Text>
          )}
        </View>
      )}

      {data && !data.exists && !loading && (
        <View style={[styles.empty, { backgroundColor: colors.card }]}>
          <Ionicons name="layers-outline" size={28} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>No differentiation analysis yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>Run the engine to generate proof-backed differentiation pillars</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerGradient: { padding: 16, borderRadius: 12, marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerSub: { fontSize: 12, marginTop: 2 },
  confidenceBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  confidenceText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  depRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  depChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  depChipText: { fontSize: 11, fontWeight: '600' },
  runBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  runBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  results: { gap: 12 },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600', flex: 1 },
  section: { padding: 14, borderRadius: 12, borderWidth: 1, gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  authorityBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  authorityMode: { fontSize: 12, fontWeight: '700' },
  rationale: { fontSize: 12, lineHeight: 18 },
  pillarCard: { paddingVertical: 10, borderBottomWidth: 1, gap: 6 },
  pillarName: { fontSize: 14, fontWeight: '600' },
  pillarDesc: { fontSize: 12, lineHeight: 16 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 },
  scoreLabel: { fontSize: 11, width: 80 },
  scoreBarBg: { flex: 1, height: 6, backgroundColor: '#00000010', borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreValue: { fontSize: 11, fontWeight: '600', width: 32, textAlign: 'right' },
  claimCard: { paddingVertical: 10, borderBottomWidth: 1, gap: 6 },
  claimText: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  claimMeta: { gap: 2 },
  collisionWarn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  collisionWarnText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  proofRow: { paddingVertical: 8, borderBottomWidth: 1, gap: 4 },
  proofCat: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  proofCatText: { color: '#3B82F6', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  proofDesc: { fontSize: 12, lineHeight: 16 },
  mechBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  mechDesc: { fontSize: 12, lineHeight: 16 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1 },
  trustRank: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EF444418', justifyContent: 'center', alignItems: 'center' },
  trustRankText: { color: '#EF4444', fontSize: 11, fontWeight: '700' },
  trustObj: { fontSize: 12, fontWeight: '500', marginBottom: 4 },
  collisionRow: { paddingVertical: 8, borderBottomWidth: 1, gap: 4 },
  collisionCandidate: { fontSize: 12, fontWeight: '500' },
  collisionArrow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  collisionRiskText: { color: '#EF4444', fontSize: 11, fontWeight: '700' },
  collisionComp: { fontSize: 11, fontStyle: 'italic' },
  stabilityBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  failureText: { fontSize: 11, lineHeight: 16 },
  execTime: { fontSize: 11, textAlign: 'center', marginTop: 4 },
  empty: { padding: 32, borderRadius: 12, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  emptySubtext: { fontSize: 12, textAlign: 'center' },
});
